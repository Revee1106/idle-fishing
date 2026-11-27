/**
 * SPIKE-ONLY: regenerate deterministic fixtures for BE-000.
 * Run: node tests/backend/be-000/generate-vectors.ts
 * These fixtures are experimental regression locks, not official game data.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { canonicalStringify } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { sha256Hex } from '../../../packages/game-core/src/spike/sha256.ts';
import { deriveStreamWords, drawU53, newRngState } from '../../../packages/game-core/src/spike/prng.ts';
import {
  ENV_STREAM_NAME,
  advanceOffline,
  createInitialState,
} from '../../../packages/game-core/src/spike/offline.ts';
import { buildEnvelope } from '../../../packages/game-core/src/spike/save.ts';

const OUT_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const START_MS = 1_700_000_000_000;
const HOUR = 3_600_000;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const rootSeed = 0x1234abcd;
  let rngState = newRngState();
  const u53: number[] = [];
  for (let i = 0; i < 10; i++) {
    const draw = drawU53(rngState, rootSeed, 'wait');
    u53.push(draw.u);
    rngState = draw.state;
  }
  const rngVectors = {
    note: 'SPIKE-ONLY regression vectors; official RNG vectors are docs/interfaces/20 RNG-01.',
    rootSeed,
    streams: {
      wait: deriveStreamWords(rootSeed, 'wait'),
      species: deriveStreamWords(rootSeed, 'species'),
      capture: deriveStreamWords(rootSeed, 'capture'),
      individual: deriveStreamWords(rootSeed, 'individual'),
      environment: deriveStreamWords(rootSeed, ENV_STREAM_NAME),
    },
    u53WaitFirst10: u53,
    stateAfter10: rngState,
  };

  const mathCases = [
    ['imul', 0x12345678, 0x9abcdef0],
    ['imul', -1, 12345],
    ['imul', 0x7fffffff, 2],
    ['imul', 0xdeadbeef, 0x41c64e6d],
    ['sqrt', 2],
    ['sqrt', 15241578750190521],
    ['sqrt', 0],
    ['sqrt', 1e-7],
    ['pow', 2, 53],
    ['pow', 1.0000001, 1e6],
    ['pow', 0.5, 0.5],
    ['round', 0.5],
    ['round', 1.5],
    ['round', -0.5],
    ['round', 2.5],
    ['round', 0.1 * 1e6],
    ['round', 1.1 * 1e6],
    ['round', 0.005 * 1e6],
    ['quantize', 1.37],
  ] as const;
  const mathVectors = {
    note: 'SPIKE-ONLY cross-runtime Math lock (IEEE-754 double semantics).',
    cases: mathCases.map((entry) => {
      const [op, ...args] = entry;
      let value: number;
      if (op === 'imul') value = Math.imul(args[0] as number, args[1] as number);
      else if (op === 'sqrt') value = Math.sqrt(args[0] as number);
      else if (op === 'pow') value = Math.pow(args[0] as number, args[1] as number);
      else if (op === 'round') value = Math.round(args[0] as number);
      else value = Math.round((args[0] as number) * 1_000_000);
      return { op, args, value };
    }),
  };

  const initial = createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: 24 * HOUR });
  const afterOneHour = advanceOffline(initial, START_MS + HOUR).state;
  const afterEightHours = advanceOffline(initial, START_MS + 8 * HOUR).state;
  const initialCanonical = canonicalStringify(initial);
  const oneHourCanonical = canonicalStringify(afterOneHour);
  const eightHourCanonical = canonicalStringify(afterEightHours);
  const envelope = buildEnvelope(afterOneHour, '1');
  const offlineVectors = {
    note: 'SPIKE-ONLY offline/save vectors with fake durations; not game numbers.',
    startMs: START_MS,
    allowanceMs: 24 * HOUR,
    initial: {
      canonical: initialCanonical,
      sha256: sha256Hex(initialCanonical),
    },
    afterOneHour: {
      canonical: oneHourCanonical,
      sha256: sha256Hex(oneHourCanonical),
      counters: afterOneHour.counters,
      gold: afterOneHour.gold,
      big: afterOneHour.big,
      lastTerminalAttemptSeq: afterOneHour.lastTerminalAttemptSeq,
      envActivityMicro: afterOneHour.envActivityMicro,
    },
    afterEightHours: {
      canonical: eightHourCanonical,
      sha256: sha256Hex(eightHourCanonical),
      counters: afterEightHours.counters,
      gold: afterEightHours.gold,
      big: afterEightHours.big,
      lastTerminalAttemptSeq: afterEightHours.lastTerminalAttemptSeq,
    },
    saveEnvelope: {
      revision: envelope.envelope.revision,
      payloadSha256: sha256Hex(envelope.payload),
      envelopeSha256: sha256Hex(envelope.text),
      slotPaths: ['save_slot_0.json', 'save_slot_1.json', 'save_slot_2.json'],
    },
  };

  await writeFile(`${OUT_DIR}rng-vectors.json`, `${JSON.stringify(rngVectors, null, 2)}\n`, 'utf8');
  await writeFile(`${OUT_DIR}math-vectors.json`, `${JSON.stringify(mathVectors, null, 2)}\n`, 'utf8');
  await writeFile(`${OUT_DIR}offline-vectors.json`, `${JSON.stringify(offlineVectors, null, 2)}\n`, 'utf8');
  console.log(`wrote fixtures to ${OUT_DIR}`);
  console.log(`initial sha256=${offlineVectors.initial.sha256}`);
  console.log(`after1h sha256=${offlineVectors.afterOneHour.sha256}`);
  console.log(`after8h sha256=${offlineVectors.afterEightHours.sha256}`);
}

await main();