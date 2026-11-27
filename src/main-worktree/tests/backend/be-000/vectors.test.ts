import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { canonicalStringify } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { sha256Hex } from '../../../packages/game-core/src/spike/sha256.ts';
import { ENV_STREAM_NAME, advanceOffline, createInitialState } from '../../../packages/game-core/src/spike/offline.ts';
import { deriveStreamWords, drawU53, newRngState } from '../../../packages/game-core/src/spike/prng.ts';
import { buildEnvelope } from '../../../packages/game-core/src/spike/save.ts';
import type { SpikeGameState } from '../../../packages/game-core/src/spike/types.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const START_MS = 1_700_000_000_000;
const HOUR = 3_600_000;

interface RngFixture {
  rootSeed: number;
  streams: Record<string, number[]>;
  u53WaitFirst10: number[];
  stateAfter10: SpikeGameState['rng'];
}

interface MathFixture {
  cases: { op: 'imul' | 'sqrt' | 'pow' | 'round' | 'quantize'; args: number[]; value: number }[];
}

interface OfflineFixture {
  startMs: number;
  allowanceMs: number;
  initial: { canonical: string; sha256: string };
  afterOneHour: { canonical: string; sha256: string; counters: Record<string, number>; gold: string; big: string };
  afterEightHours: { canonical: string; sha256: string; counters: Record<string, number>; gold: string; big: string };
  saveEnvelope: { revision: string; payloadSha256: string; envelopeSha256: string };
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(`${FIXTURES}${name}`, 'utf8')) as T;
}

test('VEC-01 Math cross-runtime fixtures match this runtime', async () => {
  const fixture = await readJson<MathFixture>('math-vectors.json');
  assert.ok(fixture.cases.length >= 19);
  for (const entry of fixture.cases) {
    const [a, b] = entry.args;
    let actual: number;
    switch (entry.op) {
      case 'imul':
        actual = Math.imul(a as number, b as number);
        break;
      case 'sqrt':
        actual = Math.sqrt(a as number);
        break;
      case 'pow':
        actual = Math.pow(a as number, b as number);
        break;
      case 'round':
        actual = Math.round(a as number);
        break;
      case 'quantize':
        actual = Math.round((a as number) * 1_000_000);
        break;
    }
    assert.ok(
      Object.is(actual, entry.value) || (actual === 0 && entry.value === 0),
      `${entry.op}(${entry.args.join(',')}) drifted`
    );
  }
});

test('VEC-02 Math.imul fixture agrees with an independent BigInt implementation', async () => {
  const fixture = await readJson<MathFixture>('math-vectors.json');
  const toInt32 = (n: number): bigint => BigInt.asIntN(32, BigInt(n));
  for (const entry of fixture.cases.filter((c) => c.op === 'imul')) {
    const [a, b] = entry.args as [number, number];
    const expected = BigInt.asIntN(32, toInt32(a) * toInt32(b));
    assert.equal(BigInt(Math.imul(a, b)), expected, `imul(${a},${b})`);
  }
});

test('VEC-03 exact square roots and half-rounding are IEEE-754 stable', async () => {
  const fixture = await readJson<MathFixture>('math-vectors.json');
  const sqrtSquare = fixture.cases.find((c) => c.op === 'sqrt' && c.args[0] === 15241578750190521);
  assert.equal(sqrtSquare?.value, 123456789);
  const half = fixture.cases.find((c) => c.op === 'round' && c.args[0] === 2.5);
  assert.equal(half?.value, 3);
  const negHalf = fixture.cases.find((c) => c.op === 'round' && c.args[0] === -0.5);
  assert.equal(negHalf?.value, 0, 'JSON normalizes -0 to 0 in the fixture');
  assert.ok(Object.is(Math.round(-0.5), -0));
});

test('VEC-04 RNG fixture matches derivation, U53 sequence and exported state', async () => {
  const fixture = await readJson<RngFixture>('rng-vectors.json');
  assert.deepEqual(fixture.streams.wait, deriveStreamWords(fixture.rootSeed, 'wait'));
  assert.deepEqual(fixture.streams.species, deriveStreamWords(fixture.rootSeed, 'species'));
  assert.deepEqual(fixture.streams.environment, deriveStreamWords(fixture.rootSeed, ENV_STREAM_NAME));

  let state = newRngState();
  const draws: number[] = [];
  for (let i = 0; i < 10; i++) {
    const result = drawU53(state, fixture.rootSeed, 'wait');
    draws.push(result.u);
    state = result.state;
  }
  assert.deepEqual(draws, fixture.u53WaitFirst10);
  assert.equal(canonicalStringify(state), canonicalStringify(fixture.stateAfter10));
});

test('VEC-05 offline/save fixtures are reproducible from the spike source', async () => {
  const fixture = await readJson<OfflineFixture>('offline-vectors.json');
  assert.equal(fixture.startMs, START_MS);
  assert.equal(fixture.allowanceMs, 24 * HOUR);

  const initial = createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: 24 * HOUR });
  const initialCanonical = canonicalStringify(initial);
  assert.equal(initialCanonical, fixture.initial.canonical);
  assert.equal(sha256Hex(initialCanonical), fixture.initial.sha256);

  const oneHour = advanceOffline(initial, START_MS + HOUR).state;
  assert.equal(canonicalStringify(oneHour), fixture.afterOneHour.canonical);
  assert.equal(sha256Hex(fixture.afterOneHour.canonical), fixture.afterOneHour.sha256);
  assert.deepEqual(oneHour.counters, fixture.afterOneHour.counters);
  assert.equal(oneHour.gold, fixture.afterOneHour.gold);
  assert.equal(oneHour.big, fixture.afterOneHour.big);

  const eightHours = advanceOffline(initial, START_MS + 8 * HOUR).state;
  assert.equal(canonicalStringify(eightHours), fixture.afterEightHours.canonical);
  assert.equal(sha256Hex(fixture.afterEightHours.canonical), fixture.afterEightHours.sha256);

  const envelope = buildEnvelope(oneHour, fixture.saveEnvelope.revision);
  assert.equal(sha256Hex(envelope.payload), fixture.saveEnvelope.payloadSha256);
  assert.equal(sha256Hex(envelope.text), fixture.saveEnvelope.envelopeSha256);
});