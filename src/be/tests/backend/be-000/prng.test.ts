import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRNG_ALGORITHM,
  deriveStreamWords,
  drawU53,
  newRngState,
  nextU53FromWords,
  validateRngState,
  xoshiroStep,
} from '../../../packages/game-core/src/spike/prng.ts';
import type { SpikeRngState } from '../../../packages/game-core/src/spike/types.ts';
import { canonicalStringify } from '../../../packages/game-core/src/spike/canonical-json.ts';

const ROOT_SEED = 0x1234abcd;

test('RNG-01 golden vector from docs/interfaces/20 matches', () => {
  let state: [number, number, number, number] = [1, 2, 3, 4];
  const values: number[] = [];
  for (let i = 0; i < 5; i++) {
    const step = xoshiroStep(state);
    values.push(step.value);
    state = step.state;
  }
  assert.deepEqual(values, [11520, 0, 5927040, 70819200, 2031721883]);
  assert.deepEqual(state, [15224335, 29364750, 272377353, 1125134346]);
});

test('RNG-02 stream derivation is stable and independent of other streams', () => {
  assert.deepEqual(deriveStreamWords(ROOT_SEED, 'wait'), [2370583620, 3926777320, 586938497, 161005436]);
  assert.deepEqual(deriveStreamWords(ROOT_SEED, 'species'), [3773152318, 2615558824, 956036534, 2244261048]);
  const envName = JSON.stringify(['environment', 'spike-config-v1', 'region.pond']);
  assert.deepEqual(deriveStreamWords(ROOT_SEED, envName), [2352234015, 1738211158, 2913089538, 3797021700]);
});

test('RNG-03 U53 stream regression vector', () => {
  let state = newRngState();
  const draws: number[] = [];
  for (let i = 0; i < 10; i++) {
    const result = drawU53(state, ROOT_SEED, 'wait');
    draws.push(result.u);
    state = result.state;
  }
  assert.deepEqual(draws, [
    0.2187637452505511,
    0.2844302949931077,
    0.32334171421613433,
    0.88980201123913,
    0.595368491469635,
    0.7102907807958421,
    0.46438931418890306,
    0.19985182065682783,
    0.6846419646166612,
    0.0761884691542879,
  ]);
  for (const u of draws) {
    assert.ok(u >= 0 && u < 1, `U53 out of range: ${u}`);
  }
});

test('RNG-04 state export/restore continues the exact same stream', () => {
  let state = newRngState();
  for (let i = 0; i < 10; i++) state = drawU53(state, ROOT_SEED, 'wait').state;

  const exported = canonicalStringify(state);
  const restored = JSON.parse(exported) as SpikeRngState;
  validateRngState(restored);

  let running = restored;
  let uninterrupted = state;
  const restoredDraws: number[] = [];
  const continuousDraws: number[] = [];
  for (let i = 0; i < 50; i++) {
    const a = drawU53(running, ROOT_SEED, 'wait');
    const b = drawU53(uninterrupted, ROOT_SEED, 'wait');
    restoredDraws.push(a.u);
    continuousDraws.push(b.u);
    running = a.state;
    uninterrupted = b.state;
  }
  assert.deepEqual(restoredDraws, continuousDraws);
  assert.equal(canonicalStringify(running), canonicalStringify(uninterrupted));
});

test('RNG-05 drawing other streams does not shift the wait stream', () => {
  let baseline = newRngState();
  for (let i = 0; i < 10; i++) baseline = drawU53(baseline, ROOT_SEED, 'wait').state;

  const clean = JSON.parse(canonicalStringify(baseline)) as SpikeRngState;
  const noisy = JSON.parse(canonicalStringify(baseline)) as SpikeRngState;

  let cleanState = clean;
  const cleanDraws: number[] = [];
  for (let i = 0; i < 10; i++) {
    const result = drawU53(cleanState, ROOT_SEED, 'wait');
    cleanDraws.push(result.u);
    cleanState = result.state;
  }

  let noisyState = noisy;
  for (let i = 0; i < 100; i++) noisyState = drawU53(noisyState, ROOT_SEED, 'environment').state;
  for (let i = 0; i < 7; i++) noisyState = drawU53(noisyState, ROOT_SEED, 'species').state;
  const noisyDraws: number[] = [];
  for (let i = 0; i < 10; i++) {
    const result = drawU53(noisyState, ROOT_SEED, 'wait');
    noisyDraws.push(result.u);
    noisyState = result.state;
  }

  assert.deepEqual(noisyDraws, cleanDraws);
  assert.deepEqual(noisyState.streams.wait, cleanState.streams.wait);
});

test('RNG-06 each U53 consumes exactly two uint32 steps', () => {
  const words = deriveStreamWords(ROOT_SEED, 'wait');
  const one = xoshiroStep(words);
  const two = xoshiroStep(one.state);
  const expected = ((one.value >>> 5) * 67108864 + (two.value >>> 6)) / 9007199254740992;
  const draw = nextU53FromWords(words);
  assert.equal(draw.u, expected);
  assert.deepEqual(draw.state, two.state);
  assert.equal(PRNG_ALGORITHM, 'XOSHIRO128SS_V1');
});

test('RNG-07 invalid root seed is rejected', () => {
  assert.throws(() => deriveStreamWords(-1, 'wait'));
  assert.throws(() => deriveStreamWords(0x100000000, 'wait'));
  assert.throws(() => deriveStreamWords(1.5, 'wait'));
  assert.throws(() => deriveStreamWords(1, ''));
});