import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SAVE_MAGIC,
  SAVE_FORMAT,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  buildEnvelope,
  computeEnvelopeHash,
  copyStateForCommit,
  parseEnvelope,
  validateSpikeState,
} from '../../../packages/game-core/src/spike/save.ts';
import { createInitialState, advanceOffline } from '../../../packages/game-core/src/spike/offline.ts';
import { canonicalStringify, natToBigInt } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { workFromMs } from '../../../packages/game-core/src/spike/time.ts';
import type { SpikeGameState, SpikeGameStateV1 } from '../../../packages/game-core/src/spike/types.ts';
import { MemoryFilePort, createTempPort, type WriteBehavior } from './helpers.ts';

const START_MS = 1_700_000_000_000;
const ALLOWANCE_MS = 24 * 60 * 60 * 1000;

function freshState(gold = '0'): SpikeGameState {
  const state = createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: ALLOWANCE_MS });
  state.gold = gold;
  return state;
}

async function commitRevision(
  repo: SpikeFileSaveRepository,
  gold: string,
  expected: string | null
) {
  return repo.commit(freshState(gold), expected);
}

function corrupt(path: string, port: MemoryFilePort): void {
  port.files.set(path, '{"not":"a valid envelope"');
}

function advanceToStage(state: SpikeGameState, stage: SpikeGameState['stage'], targetMs: number): SpikeGameState {
  let current = state;
  for (let guard = 0; current.stage !== stage; guard++) {
    assert.ok(guard < 1_000_000, `stage ${stage} must be reached`);
    current = advanceOffline(current, targetMs, { maxNodes: 1 }).state;
  }
  return current;
}

test('SAVE-T01 three slots rotate and never overwrite the highest revision', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);

  const first = await commitRevision(repo, '0', null);
  assert.deepEqual(first, { kind: 'COMMITTED', revision: '1', slot: 0, recoveredFromUncertainWrite: false });
  const second = await commitRevision(repo, '10', '1');
  assert.equal(second.kind === 'COMMITTED' && second.slot, 1);
  const third = await commitRevision(repo, '20', '2');
  assert.equal(third.kind === 'COMMITTED' && third.slot, 2);
  const fourth = await commitRevision(repo, '30', '3');
  assert.deepEqual(fourth, { kind: 'COMMITTED', revision: '4', slot: 0, recoveredFromUncertainWrite: false });

  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind !== 'VALID') return;
  assert.equal(load.revision, '4');
  assert.equal((load.raw as SpikeGameState).gold, '30');
  assert.deepEqual(load.warnings, ['selected slot 0 at revision 4'], 'three valid slots are reported');

  const revisions = SLOT_PATHS.map((path) => {
    const parsed = parseEnvelope(port.files.get(path) as string);
    assert.ok(parsed.ok);
    return parsed.value.revision;
  });
  assert.deepEqual(revisions, ['4', '2', '3']);
});

test('SAVE-T02 corrupt newest slot falls back; all corrupt refuses silent overwrite', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);
  await commitRevision(repo, '2', '1');
  await commitRevision(repo, '3', '2');

  corrupt(SLOT_PATHS[2] as string, port);
  const recovered = await repo.load();
  assert.equal(recovered.kind, 'VALID');
  if (recovered.kind === 'VALID') {
    assert.equal(recovered.revision, '2');
    assert.equal(recovered.recovered, true);
    assert.equal((recovered.raw as SpikeGameState).gold, '2');
    assert.ok(recovered.warnings.some((w) => w.includes('save_slot_2.json')));
  }

  corrupt(SLOT_PATHS[0] as string, port);
  corrupt(SLOT_PATHS[1] as string, port);
  const broken = await repo.load();
  assert.equal(broken.kind, 'CORRUPT');

  const snapshot = new Map(port.files);
  const refused = await repo.commit(freshState('999'), null);
  assert.equal(refused.kind, 'FAILED');
  assert.deepEqual(port.files, snapshot, 'corrupt files must be left untouched');
});

test('SAVE-T03 future schema returns UNSUPPORTED without overwriting', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  const futurePayload = canonicalStringify({ schemaVersion: 99, saveEpoch: 'epoch.be000', futureField: true });
  const sha = computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, '2', 'epoch.be000', futurePayload);
  const futureText = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision: '2',
    epoch: 'epoch.be000',
    payload: futurePayload,
    sha256: sha,
  });
  port.files.set(SLOT_PATHS[1] as string, futureText);

  const load = await repo.load();
  assert.equal(load.kind, 'UNSUPPORTED');
  if (load.kind === 'UNSUPPORTED') assert.match(load.detail, /99/);

  const refused = await repo.commit(freshState('5'), '2');
  assert.equal(refused.kind, 'FAILED');
  assert.equal(port.files.get(SLOT_PATHS[1] as string), futureText, 'newer slot must not be overwritten');
});

test('SAVE-T04a write failure before bytes is FAILED and old save survives', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  port.writeBehavior = (): WriteBehavior => ({ kind: 'THROW_BEFORE' });
  const failed = await commitRevision(repo, '2', '1');
  assert.equal(failed.kind, 'FAILED');
  port.writeBehavior = null;

  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') assert.equal(load.revision, '1');
});

test('SAVE-T04b partial write is FAILED and detected as corruption', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  port.writeBehavior = (): WriteBehavior => ({ kind: 'PARTIAL_THEN_THROW' });
  const failed = await commitRevision(repo, '2', '1');
  assert.equal(failed.kind, 'FAILED');
  port.writeBehavior = null;

  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') {
    assert.equal(load.revision, '1');
    assert.equal(load.recovered, true);
  }
});

test('SAVE-T04c full write followed by an exception is recovered as COMMITTED', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  port.writeBehavior = (): WriteBehavior => ({ kind: 'WRITE_THEN_THROW' });
  const result = await commitRevision(repo, '2', '1');
  assert.deepEqual(result, { kind: 'COMMITTED', revision: '2', slot: 1, recoveredFromUncertainWrite: true });
  port.writeBehavior = null;

  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') assert.equal(load.revision, '2');
});

test('SAVE-T04d silent short write is not reported as success and does not lose old data', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  port.writeBehavior = (): WriteBehavior => ({ kind: 'SILENT_TRUNCATE' });
  const result = await commitRevision(repo, '2', '1');
  assert.equal(result.kind, 'FAILED');
  port.writeBehavior = null;

  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') assert.equal(load.revision, '1');
});

test('SAVE-T04e unobservable write with a concurrent higher revision is UNCERTAIN', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  const other = freshState('777');
  other.saveEpoch = 'epoch.other';
  port.writeBehavior = (): WriteBehavior => {
    port.files.set(SLOT_PATHS[2] as string, buildEnvelope(other, '9').text);
    return { kind: 'THROW_BEFORE' };
  };
  const result = await commitRevision(repo, '2', '1');
  assert.equal(result.kind, 'UNCERTAIN');
  port.writeBehavior = null;
});

test('SAVE-T05 real FIGHTING settlement is idempotent across save/load and rejects replay', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const fighting = freshState('100');
  fighting.stage = 'FIGHTING';
  fighting.stageStartMs = fighting.cursorMs;
  fighting.stageDone = '0';
  fighting.stageRequired = '1000000';
  fighting.counters.attempts = 1;

  const settled = advanceOffline(fighting, fighting.cursorMs + 1).state;
  assert.equal(settled.stage, 'PREPARING');
  assert.deepEqual(settled.claims, ['fish:1']);
  assert.equal(settled.lastTerminalAttemptSeq, '1');
  assert.equal(settled.counters.events, 1);
  assert.ok(natToBigInt(settled.gold) > 100n);
  assert.ok(natToBigInt(settled.big) > 0n);
  const settledGold = settled.gold;
  const settledBig = settled.big;

  const committed = await repo.commit(settled, null);
  assert.equal(committed.kind, 'COMMITTED');
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  const restored = copyStateForCommit(loaded.raw as SpikeGameState);
  assert.equal(restored.gold, settledGold);
  assert.equal(restored.big, settledBig);
  assert.deepEqual(restored.claims, ['fish:1']);
  assert.equal(canonicalStringify(restored.rng), canonicalStringify(settled.rng));

  const replayed = advanceOffline(restored, restored.cursorMs + 1000).state;
  assert.equal(replayed.gold, settledGold, 'restored settlement must not pay again');
  assert.equal(replayed.big, settledBig);
  assert.deepEqual(replayed.claims, ['fish:1']);
  assert.equal(replayed.counters.events, 1);

  const forged = copyStateForCommit(restored);
  Object.assign(forged, {
    stage: 'FIGHTING',
    stageStartMs: forged.cursorMs,
    stageDone: '999999',
    stageRequired: '1000000',
    counters: { ...forged.counters, attempts: 1, events: 1 },
    claims: ['fish:1'],
    lastTerminalAttemptSeq: '1',
    gold: '100',
    big: '0',
  });
  assert.throws(
    () => advanceOffline(forged, forged.cursorMs + 1),
    /already settled/
  );
  const beforeReject = new Map(port.files);
  const refused = await repo.commit(forged, loaded.revision);
  assert.equal(refused.kind, 'FAILED');
  assert.deepEqual(port.files, beforeReject, 'invalid replay state must not be written');
  assert.equal(natToBigInt(forged.gold), 100n);
  assert.equal(forged.big, '0');
  assert.deepEqual(forged.claims, ['fish:1']);
});

test('SAVE-T06 revision and epoch conflicts are rejected without writing', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);
  const before = new Map(port.files);

  const wrongRevision = await commitRevision(repo, '2', '0');
  assert.equal(wrongRevision.kind, 'CONFLICT');

  const wrongEpochState = freshState('2');
  wrongEpochState.saveEpoch = 'epoch.other';
  const wrongEpoch = await repo.commit(wrongEpochState, '1');
  assert.equal(wrongEpoch.kind, 'CONFLICT');

  assert.deepEqual(port.files, before, 'conflicts must not touch the filesystem');
});

test('SAVE-T07 all slot reads failing is CORRUPT; commit stays UNCERTAIN and writes nothing', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);
  const before = new Map(port.files);
  const writes = port.writeCount;
  for (const path of SLOT_PATHS) port.readErrors.set(path, 'disk error');

  const load = await repo.load();
  assert.equal(load.kind, 'CORRUPT');

  const commit = await repo.commit(freshState('2'), '1');
  assert.equal(commit.kind, 'UNCERTAIN');
  assert.equal(port.writeCount, writes, 'unknown slots must not trigger a write');
  assert.deepEqual(port.files, before);
});

test('SAVE-T08 mixed epochs across valid slots is CORRUPT', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  const other = freshState('50');
  other.saveEpoch = 'epoch.other';
  port.files.set(SLOT_PATHS[1] as string, buildEnvelope(other, '2').text);

  const load = await repo.load();
  assert.equal(load.kind, 'CORRUPT');
});

test('SAVE-T09 initial commit over EMPTY slots only; expectedRevision null with existing save conflicts', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const empty = await repo.load();
  assert.deepEqual(empty, { kind: 'EMPTY' });
  await commitRevision(repo, '1', null);
  const second = await commitRevision(repo, '2', null);
  assert.equal(second.kind, 'CONFLICT');
});

test('SAVE-T10 3-slot rotation works on a real filesystem adapter', async () => {
  const { port, cleanup } = await createTempPort();
  try {
    const repo = new SpikeFileSaveRepository(port);
    await commitRevision(repo, '1', null);
    await commitRevision(repo, '2', '1');
    await commitRevision(repo, '3', '2');

    const reloaded = new SpikeFileSaveRepository(port);
    const load = await reloaded.load();
    assert.equal(load.kind, 'VALID');
    if (load.kind === 'VALID') {
      assert.equal(load.revision, '3');
      assert.equal((load.raw as SpikeGameState).gold, '3');
    }

    await port.write(SLOT_PATHS[2] as string, 'torn');
    const fallback = await new SpikeFileSaveRepository(port).load();
    assert.equal(fallback.kind, 'VALID');
    if (fallback.kind === 'VALID') {
      assert.equal(fallback.revision, '2');
      assert.equal(fallback.recovered, true);
    }
  } finally {
    await cleanup();
  }
});

test('SAVE-T11 v1 envelope loads as VALID and reports schema 1', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const v1: SpikeGameStateV1 = {
    schemaVersion: 1,
    saveEpoch: 'epoch.be000',
    rootSeed: 0x1234abcd,
    cursorMs: START_MS,
    counter: 7,
    gold: '42',
    rng: { algorithm: 'XOSHIRO128SS_V1', streams: {} },
  };
  const first = await repo.commit(v1 as unknown as SpikeGameState, null);
  assert.equal(first.kind, 'COMMITTED');
  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') {
    assert.equal(load.schemaVersion, 1);
    assert.equal((load.raw as SpikeGameStateV1).counter, 7);
  }
});

test('SAVE-T12 rollback after uncertain write keeps the previously committed revision loadable', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await commitRevision(repo, '1', null);

  port.writeBehavior = (): WriteBehavior => ({ kind: 'PARTIAL_THEN_THROW' });
  await commitRevision(repo, '2', '1');
  port.writeBehavior = null;

  const freshRepo = new SpikeFileSaveRepository(port);
  const retry = await freshRepo.commit(freshState('3'), '1');
  assert.equal(retry.kind, 'COMMITTED');
  const load = await freshRepo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') {
    assert.equal(natToBigInt(load.revision), 2n);
    assert.equal((load.raw as SpikeGameState).gold, '3');
  }
});

test('SAVE-T13 attemptLock fightMs must match stageRequired before commit and load', async () => {
  const fighting = advanceToStage(freshState('0'), 'FIGHTING', START_MS + 3_600_000);
  assert.deepEqual(validateSpikeState(fighting), []);
  const lock = fighting.attemptLock;
  if (lock === undefined || lock === null) assert.fail('real FIGHTING state must carry a locked result');
  assert.equal(workFromMs(lock.fightMs), fighting.stageRequired);

  const tampered = copyStateForCommit(fighting);
  tampered.attemptLock = { ...lock, fightMs: lock.fightMs + 1 };
  const issues = validateSpikeState(tampered);
  assert.ok(
    issues.some((issue) => issue.path === 'attemptLock.fightMs'),
    'duration mismatch must be reported by state validation'
  );
  assert.notEqual(tampered.attemptLock.fightMs, lock.fightMs);

  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const accepted = await repo.commit(fighting, null);
  if (accepted.kind !== 'COMMITTED') assert.fail(`legal FIGHTING state must commit: ${accepted.detail}`);
  const writes = port.writeCount;
  const snapshot = new Map(port.files);
  const rejected = await repo.commit(tampered, accepted.revision);
  if (rejected.kind !== 'FAILED') assert.fail('tampered lock must be refused');
  assert.match(rejected.detail, /attemptLock\.fightMs/);
  assert.equal(port.writeCount, writes, 'invalid state must not trigger a write');
  assert.deepEqual(port.files, snapshot);

  const tamperedPort = new MemoryFilePort();
  tamperedPort.files.set(SLOT_PATHS[0] as string, buildEnvelope(tampered, '1').text);
  const loaded = await new SpikeFileSaveRepository(tamperedPort).load();
  assert.equal(loaded.kind, 'CORRUPT', 'a persisted inconsistent lock must not load as VALID');
});