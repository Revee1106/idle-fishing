/**
 * SPIKE-ONLY integer work / virtual-time helpers.
 * Business time is a safe-integer millisecond count; work is BigInt micro-units.
 * Rates are quantized once per event boundary, never per frame.
 */
import { CanonicalJsonError, natFromBigInt, natToBigInt } from './canonical-json.ts';
import type { Nat } from './types.ts';

export const MICRO_PER_MS = 1_000_000n;

export function assertSafeMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CanonicalJsonError(`${label} must be a non-negative safe integer ms: ${value}`);
  }
}

/** Add millisecond values only when the result remains a representable safe integer. */
export function safeAddMs(a: number, b: number, label = 'millisecond sum'): number {
  assertSafeMs(a, `${label} left operand`);
  assertSafeMs(b, `${label} right operand`);
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new CanonicalJsonError(`${label} exceeds the safe millisecond range: ${a} + ${b}`);
  }
  return sum;
}

/** round(ms * 1e6); a positive value that rounds to 0 becomes 1 micro-unit. */
export function workFromMs(ms: number): Nat {
  if (!Number.isFinite(ms) || ms < 0) throw new CanonicalJsonError(`Invalid work ms: ${ms}`);
  let micro = BigInt(Math.round(ms * 1_000_000));
  if (micro === 0n && ms > 0) micro = 1n;
  return natFromBigInt(micro);
}

/** Execution rate in micro-units per real millisecond, quantized once. */
export function rateFromSpeed(speedMultiplier: number): bigint {
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    throw new CanonicalJsonError(`Invalid speed multiplier: ${speedMultiplier}`);
  }
  const micro = BigInt(Math.round(speedMultiplier * 1_000_000));
  return micro < 1n ? 1n : micro;
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new CanonicalJsonError('ceilDiv divisor must be positive');
  return (a + b - 1n) / b;
}

export function addWork(done: Nat, dtMs: number, rate: bigint): Nat {
  assertSafeMs(dtMs, 'dtMs');
  return natFromBigInt(natToBigInt(done) + BigInt(dtMs) * rate);
}

export interface IntegrationResult {
  done: Nat;
  completedAtMs: number | null;
}

/**
 * Integrate work over [startMs, untilMs). If the requirement is reached inside
 * the interval, returns the exact completion millisecond; surplus work is
 * discarded (it never carries into the next stage).
 */
export function integrateWork(
  done: Nat,
  required: Nat,
  startMs: number,
  untilMs: number,
  rate: bigint
): IntegrationResult {
  assertSafeMs(startMs, 'startMs');
  assertSafeMs(untilMs, 'untilMs');
  if (untilMs < startMs) throw new CanonicalJsonError('untilMs precedes startMs');
  const doneBig = natToBigInt(done);
  const requiredBig = natToBigInt(required);
  if (requiredBig <= 0n) throw new CanonicalJsonError('required work must be positive');
  const dt = untilMs - startMs;
  const total = doneBig + BigInt(dt) * rate;
  if (total >= requiredBig) {
    const needed = requiredBig - doneBig;
    if (needed <= 0n) return { done: required, completedAtMs: startMs };
    const elapsed = Number(ceilDiv(needed, rate));
    if (!Number.isSafeInteger(elapsed) || elapsed > dt) {
      throw new CanonicalJsonError('Internal: completion outside interval');
    }
    return { done: required, completedAtMs: safeAddMs(startMs, elapsed, 'completion time') };
  }
  return { done: natFromBigInt(total), completedAtMs: null };
}

/** Millisecond timestamp at which `required` work is reached, or null if unreachable. */
export function completionTimeMs(
  done: Nat,
  required: Nat,
  startMs: number,
  rate: bigint
): number | null {
  const doneBig = natToBigInt(done);
  const requiredBig = natToBigInt(required);
  if (requiredBig <= 0n) return startMs;
  if (doneBig >= requiredBig) return startMs;
  const elapsed = ceilDiv(requiredBig - doneBig, rate);
  const ms = Number(elapsed);
  if (!Number.isSafeInteger(ms)) return null;
  assertSafeMs(startMs, 'startMs');
  const result = startMs + ms;
  return Number.isSafeInteger(result) ? result : null;
}

/**
 * Positive Nat times a finite multiplier, using the millionth quantization from
 * interface doc 15: q = round(m * 1e6), result = (v*q + 500000) / 1000000.
 */
export function mulNatByMultiplier(value: Nat, multiplier: number, mode: 'round' | 'floor' | 'ceil' = 'round'): Nat {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new CanonicalJsonError(`Invalid multiplier: ${multiplier}`);
  }
  const q = BigInt(Math.round(multiplier * 1_000_000));
  const v = natToBigInt(value);
  const product = v * q;
  if (mode === 'floor') return natFromBigInt(product / 1_000_000n);
  if (mode === 'ceil') return natFromBigInt(ceilDiv(product, 1_000_000n));
  return natFromBigInt((product + 500_000n) / 1_000_000n);
}