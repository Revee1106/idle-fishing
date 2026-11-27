import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_OFFLINE_FIXTURE,
  advanceOffline,
  advanceOfflineSliced,
  cloneState,
  createInitialState,
  triangularQuantile,
} from '../../../packages/game-core/src/spike/offline.ts';
import { canonicalStringify, natToBigInt } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { validateRngState } from '../../../packages/game-core/src/spike/prng.ts';
import { SpikeFileSaveRepository, copyStateForCommit } from '../../../packages/game-core/src/spike/save.ts';
import type { SpikeGameState } from '../../../packages/game-core/src/spike/types.ts';
import { MemoryFilePort } from './helpers.ts';

const START_MS = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function initialState(): SpikeGameState {
  return createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: DAY });
}

test('OFF-01 8h continuous, 60s-sliced and 37s-sliced advancement are identical', () => {
  const target = START_MS + 8 * HOUR;
  const continuous = advanceOffline(initialState(), target);
  assert.equal(continuous.reachedTarget, true);
  assert.equal(continuous.state.cursorMs, target);

  const sixty = advanceOfflineSliced(initialState(), target, 60_000);
  const thirtySeven = advanceOfflineSliced(initialState(), target, 37_000);

  assert.equal(thirtySeven.state.cursorMs, target);
  assert.equal(canonicalStringify(sixty.state), canonicalStringify(continuous.state));
  assert.equal(canonicalStringify(thirtySeven.state), canonicalStringify(continuous.state));
});

test('OFF-02 checkpoint save/restore in the middle continues identically', async () => {
  const target = START_MS + 8 * HOUR;
  const continuous = advanceOffline(initialState(), target);
  const firstHalf = advanceOffline(initialState(), START_MS + 3 * HOUR + 1234);

  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const committed = await repo.commit(firstHalf.state, null);
  assert.equal(committed.kind, 'COMMITTED');

  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  const restored = copyStateForCommit(loaded.raw as SpikeGameState);
  assert.equal(canonicalStringify(restored), canonicalStringify(firstHalf.state));

  const resumed = advanceOffline(restored, target);
  assert.equal(canonicalStringify(resumed.state), canonicalStringify(continuous.state));
});

test('OFF-03 node-budget slices produce the same final state', () => {
  const target = START_MS + 2 * HOUR;
  const continuous = advanceOffline(initialState(), target);

  let current = initialState();
  let calls = 0;
  while (current.cursorMs < target) {
    const result = advanceOffline(current, target, { maxNodes: 3 });
    current = result.state;
    calls += 1;
    assert.ok(calls < 10_000, 'node-budget loop must terminate');
    if (result.processedNodes === 0 && !result.reachedTarget) {
      assert.fail('maxNodes=3 must always make progress');
    }
  }
  assert.equal(canonicalStringify(current), canonicalStringify(continuous.state));
});

test('OFF-04 no fishing attempt starts at or after the offline deadline', () => {
  const deadline = START_MS + DAY;
  const atDeadline = advanceOffline(initialState(), deadline);
  const pastDeadline = advanceOffline(atDeadline.state, deadline + HOUR);

  assert.equal(pastDeadline.state.cursorMs, deadline + HOUR);
  assert.deepEqual(pastDeadline.state.counters, {
    ...atDeadline.state.counters,
    envChecks: pastDeadline.state.counters.envChecks,
  });
  assert.equal(pastDeadline.state.gold, atDeadline.state.gold);
  assert.deepEqual(pastDeadline.state.claims, atDeadline.state.claims);
  assert.ok(pastDeadline.state.counters.envChecks > atDeadline.state.counters.envChecks, 'world time continues');
  assert.equal(pastDeadline.state.offline?.deadlineMs, deadline);
});

test('OFF-05 huge BigInt savings survive canonical JSON round-trip', () => {
  const result = advanceOffline(initialState(), START_MS + HOUR);
  const big = natToBigInt(result.state.big);
  assert.ok(big > BigInt(2) ** BigInt(53), 'spike state must hold values beyond 2^53');
  const roundTrip = JSON.parse(canonicalStringify(result.state)) as SpikeGameState;
  assert.equal(roundTrip.big, result.state.big);
  assert.equal(natToBigInt(roundTrip.big), big);
});

test('OFF-06 RNG streams are lazy, named and valid after advancement', () => {
  const start = initialState();
  assert.deepEqual(start.rng.streams, {});
  const result = advanceOffline(start, START_MS + HOUR);
  validateRngState(result.state.rng);
  for (const name of ['wait', 'species', 'capture', 'individual']) {
    assert.equal(result.state.rng.streams[name]?.length, 4, `missing stream ${name}`);
  }
  const envName = JSON.stringify(['environment', 'spike-config-v1', 'region.pond']);
  assert.equal(result.state.rng.streams[envName]?.length, 4);
});

test('OFF-07 activity stays inside the spike band and changes over time', () => {
  const result = advanceOffline(initialState(), START_MS + 2 * HOUR);
  assert.ok(result.state.envActivityMicro >= 800_000 && result.state.envActivityMicro <= 1_200_000);
  assert.notEqual(result.state.envActivityMicro, 1_000_000);
  assert.ok(result.state.counters.envChecks >= 24);
});

test('OFF-08 attempt sequence advances monotonically and each terminal attempt is claimed once', () => {
  const result = advanceOffline(initialState(), START_MS + 6 * HOUR);
  const c = result.state.counters;
  assert.ok(c.attempts > 0);
  assert.ok(c.attempts >= c.casts && c.casts >= c.waits && c.waits >= c.fights);
  assert.ok(c.fights >= c.prepares && c.prepares >= c.cycles);
  assert.ok(c.attempts - c.cycles <= 1, 'at most one attempt may be in flight');
  assert.equal(result.state.claims.length, c.fights, 'one claim per settled fight');
  assert.equal(new Set(result.state.claims).size, result.state.claims.length);
  assert.equal(natToBigInt(result.state.lastTerminalAttemptSeq), BigInt(c.fights));
});

test('OFF-09 same-time deadline settlement does not leave a half-finished stage', () => {
  const result = advanceOffline(initialState(), START_MS + DAY);
  assert.ok(result.state.cursorMs >= result.state.offline!.deadlineMs);
  if (result.state.cursorMs > result.state.offline!.deadlineMs) {
    assert.equal(result.state.stage, 'IDLE', 'no stage may be in progress past the deadline');
  }
  assert.ok(natToBigInt(result.state.stageDone) <= natToBigInt(result.state.stageRequired));
});

test('OFF-10 input state is never mutated', () => {
  const start = initialState();
  const before = canonicalStringify(start);
  advanceOffline(start, START_MS + HOUR);
  advanceOfflineSliced(start, START_MS + HOUR, 10_000);
  const copy = cloneState(start);
  copy.gold = '123';
  assert.equal(canonicalStringify(start), before);
});

test('OFF-11 triangle quantile honours bounds and approximates mean 1', () => {
  const triangle = DEFAULT_OFFLINE_FIXTURE.waitTriangle;
  assert.equal(triangularQuantile(0, triangle), triangle.a);
  const nearEnd = triangularQuantile(0.999999999999, triangle);
  assert.ok(nearEnd <= triangle.b && nearEnd > triangle.mode);
  let sum = 0;
  const samples = 20_000;
  for (let i = 0; i < samples; i++) sum += triangularQuantile((i + 0.5) / samples, triangle);
  const mean = sum / samples;
  assert.ok(Math.abs(mean - 1) < 0.01, `triangle mean drifted: ${mean}`);
  assert.throws(() => triangularQuantile(1, triangle));
  assert.throws(() => triangularQuantile(0.5, { a: 2, mode: 1, b: 3 }));
});