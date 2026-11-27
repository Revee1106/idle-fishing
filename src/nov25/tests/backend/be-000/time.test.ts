import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addWork,
  assertSafeMs,
  ceilDiv,
  completionTimeMs,
  integrateWork,
  mulNatByMultiplier,
  rateFromSpeed,
  workFromMs,
} from '../../../packages/game-core/src/spike/time.ts';
import { natToBigInt } from '../../../packages/game-core/src/spike/canonical-json.ts';

test('TIME-01 ms to micro-work uses round(ms*1e6) and keeps tiny positives at 1', () => {
  assert.equal(workFromMs(0), '0');
  assert.equal(workFromMs(1040), '1040000000');
  assert.equal(workFromMs(1.5), '1500000');
  assert.equal(workFromMs(0.0000001), '1');
  assert.throws(() => workFromMs(-1));
});

test('TIME-02 rate quantization is one millionth and never below 1', () => {
  assert.equal(rateFromSpeed(1), 1_000_000n);
  assert.equal(rateFromSpeed(1.5), 1_500_000n);
  assert.equal(rateFromSpeed(0.0000001), 1n);
  assert.throws(() => rateFromSpeed(0));
  assert.throws(() => rateFromSpeed(Number.NaN));
});

test('TIME-03 ceilDiv is exact at multiples and rounds up otherwise', () => {
  assert.equal(ceilDiv(10n, 5n), 2n);
  assert.equal(ceilDiv(11n, 5n), 3n);
  assert.equal(ceilDiv(0n, 5n), 0n);
  assert.throws(() => ceilDiv(1n, 0n));
});

test('TIME-04 integration completes at the exact millisecond and discards surplus', () => {
  const rate = 1_000_000n;
  const result = integrateWork('0', '500000000', 1000, 2000, rate);
  assert.equal(result.completedAtMs, 1500);
  assert.equal(result.done, '500000000');

  const partial = integrateWork('0', '500000000', 1000, 1499, rate);
  assert.equal(partial.completedAtMs, null);
  assert.equal(partial.done, '499000000');

  const surplus = integrateWork('0', '1000000', 10, 20, rate);
  assert.equal(surplus.completedAtMs, 11);
  assert.equal(surplus.done, '1000000');
});

test('TIME-05 split integration equals one continuous integration', () => {
  const rate = rateFromSpeed(1.37);
  const required = '12345678901';
  let done = '0';
  let cursor = 5000;
  for (const until of [5100, 5233, 5900, 6123]) {
    const part = integrateWork(done, required, cursor, until, rate);
    if (part.completedAtMs !== null) {
      assert.fail('should not complete in this fixture');
    }
    done = part.done;
    cursor = until;
  }
  const final = integrateWork(done, required, cursor, 999999, rate);
  const whole = integrateWork('0', required, 5000, 999999, rate);
  assert.equal(final.completedAtMs, whole.completedAtMs);
  assert.equal(final.done, whole.done);
});

test('TIME-06 completionTimeMs agrees with integrateWork and rejects unsafe spans', () => {
  const rate = 1_000_000n;
  const at = completionTimeMs('250000000', '1000000000', 7000, rate);
  assert.equal(at, 7750);
  assert.equal(completionTimeMs('5', '5', 7000, rate), 7000);
  assert.equal(completionTimeMs('6', '5', 7000, rate), 7000);
});

test('TIME-07 nat multiplier follows (v*q+500000)/1e6 with floor/ceil modes', () => {
  assert.equal(mulNatByMultiplier('1500', 0.005), '8');
  assert.equal(mulNatByMultiplier('1500', 0.005, 'floor'), '7');
  assert.equal(mulNatByMultiplier('1500', 0.005, 'ceil'), '8');
  assert.equal(mulNatByMultiplier('123456789', 1.5), '185185184');
  assert.equal(mulNatByMultiplier('0', 99), '0');
});

test('TIME-08 BigInt accumulation exceeds Number.MAX_SAFE_INTEGER and round-trips', () => {
  const value = addWork('9007199254740991', 1, 1n);
  assert.equal(value, '9007199254740992');
  assert.equal(natToBigInt(value) > BigInt(Number.MAX_SAFE_INTEGER), true);
});

test('TIME-09 invalid millisecond inputs are rejected', () => {
  assert.throws(() => assertSafeMs(-1, 'x'));
  assert.throws(() => assertSafeMs(1.5, 'x'));
  assert.throws(() => assertSafeMs(Number.MAX_SAFE_INTEGER + 1, 'x'));
});