import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '../../../packages/game-core/src/spike/sha256.ts';
import { canonicalStringify } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { advanceOffline, createInitialState } from '../../../packages/game-core/src/spike/offline.ts';

const DIST_INDEX = fileURLToPath(new URL('../../../packages/game-core/dist/spike/index.js', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const START_MS = 1_700_000_000_000;

async function loadDist(): Promise<Record<string, (...args: never[]) => unknown>> {
  try {
    return (await import(pathToFileURL(DIST_INDEX).href)) as Record<string, (...args: never[]) => unknown>;
  } catch (error) {
    assert.fail(`dist artifact missing; run "npm run build" first (${(error as Error).message})`);
  }
}

test('DIST-01 built ESM artifact runs in Node and matches RNG-01', async () => {
  const mod = await loadDist();
  const xoshiroStep = mod.xoshiroStep as unknown as (w: [number, number, number, number]) => {
    value: number;
    state: [number, number, number, number];
  };
  let state: [number, number, number, number] = [1, 2, 3, 4];
  const values: number[] = [];
  for (let i = 0; i < 5; i++) {
    const step = xoshiroStep(state);
    values.push(step.value);
    state = step.state;
  }
  assert.deepEqual(values, [11520, 0, 5927040, 70819200, 2031721883]);
  assert.deepEqual(state, [15224335, 29364750, 272377353, 1125134346]);

  const sha256HexDist = mod.sha256Hex as unknown as (text: string) => string;
  assert.equal(sha256HexDist('abc'), sha256Hex('abc'));
});

test('DIST-02 built artifact reproduces the same offline states as the source', async () => {
  const mod = await loadDist();
  const create = mod.createInitialState as unknown as typeof createInitialState;
  const advance = mod.advanceOffline as unknown as typeof advanceOffline;
  const canonical = mod.canonicalStringify as unknown as typeof canonicalStringify;

  const fixture = JSON.parse(await readFile(`${FIXTURES}offline-vectors.json`, 'utf8')) as {
    initial: { canonical: string; sha256: string };
    afterOneHour: { canonical: string; sha256: string };
    afterEightHours: { canonical: string; sha256: string };
  };

  const initial = create({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: 24 * 3_600_000 });
  assert.equal(canonical(initial), fixture.initial.canonical);
  assert.equal(sha256Hex(fixture.initial.canonical), fixture.initial.sha256);

  const oneHour = advance(initial, START_MS + 3_600_000).state;
  assert.equal(canonical(oneHour), fixture.afterOneHour.canonical);
  const eightHours = advance(initial, START_MS + 8 * 3_600_000).state;
  assert.equal(canonical(eightHours), fixture.afterEightHours.canonical);

  const sourceEight = advanceOffline(createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: 24 * 3_600_000 }), START_MS + 8 * 3_600_000).state;
  assert.equal(canonicalStringify(sourceEight), fixture.afterEightHours.canonical);
});

test('DIST-03 built artifact exposes the documented spike module surface', async () => {
  const mod = await loadDist();
  for (const name of [
    'xoshiroStep',
    'drawU53',
    'deriveStreamWords',
    'canonicalStringify',
    'sha256Hex',
    'workFromMs',
    'integrateWork',
    'advanceOffline',
    'advanceOfflineSliced',
    'createInitialState',
    'SpikeFileSaveRepository',
    'buildEnvelope',
    'parseEnvelope',
    'migrateSpikeState',
  ]) {
    assert.equal(typeof mod[name], 'function', `missing export ${name}`);
  }
});