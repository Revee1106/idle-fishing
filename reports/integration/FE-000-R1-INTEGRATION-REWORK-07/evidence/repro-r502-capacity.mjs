import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const { MemoryFilePort } = await import(
  pathToFileURL(
    path.join(repoRoot, 'tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/BrowserFilePort.js')
  ).href
);
const { SingleWriterSaveCoordinator } = await import(
  pathToFileURL(
    path.join(
      repoRoot,
      'tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.js'
    )
  ).href
);
const { createInitialState, advanceOffline } = await import(
  pathToFileURL(path.join(repoRoot, 'packages/game-core/dist/cocos/spike/index.mjs')).href
);

// Exact Astra REWORK-06 capacity counterexample (2304 limit vs 2552 byte valid state)
const seed = createInitialState({ saveEpoch: 'astra-capacity', startMs: 1700000000000, allowanceMs: 28800000 });
const state = advanceOffline(seed, seed.cursorMs + 3600000).state;
const reference = new MemoryFilePort(10 * 1024 * 1024, 'astra-size');
const valid = await new SingleWriterSaveCoordinator(reference).commit(state, null);
const bytes = Buffer.byteLength(await reference.read('save_slot_0.json'));
if (valid.kind !== 'COMMITTED' || bytes <= 2304) {
  throw new Error(`Inapplicable fixture: valid=${valid.kind}, bytes=${bytes}`);
}

const port = new MemoryFilePort(2304, 'astra-capacity');
const coord = new SingleWriterSaveCoordinator(port);
const first = await coord.commit(state, null);
const markerBefore = await port.readTxState();
const recoveredNoState = await coord.loadSafe();
const markerAfterNoState = await port.readTxState();
const recoveredWithState = await coord.loadSafe({ initialCommitState: state });
const markerAfterWithState = await port.readTxState();
const retry = await coord.commit(state, null);

const out = {
  fullSlotBytes: bytes,
  limit: 2304,
  first: first.kind,
  markerBefore: Boolean(markerBefore),
  recoveredNoState: recoveredNoState.kind,
  recoveredNoStateClassification:
    recoveredNoState.kind === 'STORAGE_UNAVAILABLE' ? recoveredNoState.recoveryClassification ?? null : null,
  markerAfterNoState: Boolean(markerAfterNoState),
  recoveredWithState: recoveredWithState.kind,
  recoveredWithStateClassification:
    recoveredWithState.kind === 'STORAGE_UNAVAILABLE' ? recoveredWithState.recoveryClassification ?? null : null,
  markerAfterWithState: Boolean(markerAfterWithState),
  retry: retry.kind,
};
console.log(JSON.stringify(out, null, 2));

if (
  (recoveredNoState.kind === 'EMPTY' && retry.kind !== 'COMMITTED') ||
  (recoveredWithState.kind === 'EMPTY' && retry.kind !== 'COMMITTED') ||
  recoveredNoState.kind !== 'STORAGE_UNAVAILABLE' ||
  recoveredWithState.kind !== 'STORAGE_UNAVAILABLE' ||
  !markerAfterNoState ||
  !markerAfterWithState
) {
  process.exitCode = 1;
}
