/**
 * SPIKE-ONLY minimal event-driven "offline load" state machine.
 *
 * This is NOT the real fishing state machine and uses fake durations/values.
 * Its only purpose is to verify:
 * - event-boundary advancement with integer micro-work and BigInt accumulation
 * - continuous vs batched (sliced) advancement equality
 * - checkpoint save/restore equality, including RNG stream state
 * - a representative 24h offline workload for timing measurement
 */
import { natFromBigInt, natToBigInt } from './canonical-json.ts';
import { drawU53, newRngState, cloneRngState } from './prng.ts';
import { assertSafeMs, safeAddMs, workFromMs } from './time.ts';
import type { Nat, SpikeAttemptLock, SpikeCounters, SpikeGameState, SpikeOfflineSession } from './types.ts';

export interface SpikeOfflineFixture {
  readonly rootSeed: number;
  readonly castMs: number;
  readonly waitMeanMs: number;
  readonly waitTriangle: { a: number; mode: number; b: number };
  readonly fightBaseMs: number;
  readonly fightVarianceMs: number;
  readonly prepareMs: number;
  readonly envCheckEveryMs: number;
  readonly fishGoldBase: bigint;
  readonly fishGoldRange: bigint;
  readonly bigIncrement: bigint;
}

export const DEFAULT_OFFLINE_FIXTURE: SpikeOfflineFixture = {
  rootSeed: 0x1234abcd,
  castMs: 1500,
  waitMeanMs: 12_000,
  waitTriangle: { a: 0.3, mode: 0.8, b: 1.9 },
  fightBaseMs: 9_000,
  fightVarianceMs: 12_000,
  prepareMs: 2_500,
  envCheckEveryMs: 300_000,
  fishGoldBase: 10n,
  fishGoldRange: 40n,
  bigIncrement: 123_456_789_012_345_678_901_234_567_890n,
};

export const ENV_STREAM_NAME = JSON.stringify(['environment', 'spike-config-v1', 'region.pond']);

const EMPTY_COUNTERS: SpikeCounters = {
  attempts: 0,
  casts: 0,
  waits: 0,
  fights: 0,
  prepares: 0,
  cycles: 0,
  envChecks: 0,
  events: 0,
};

export interface CreateInitialOptions {
  readonly saveEpoch: string;
  readonly startMs: number;
  readonly allowanceMs: number;
}

export function createInitialState(options: CreateInitialOptions): SpikeGameState {
  const unsupported = options as CreateInitialOptions & { fixture?: unknown };
  if (unsupported.fixture !== undefined) {
    throw new Error('Custom offline fixtures are not supported by this experimental entry point');
  }
  const fixture = DEFAULT_OFFLINE_FIXTURE;
  assertSafeMs(options.startMs, 'startMs');
  assertSafeMs(options.allowanceMs, 'allowanceMs');
  if (options.allowanceMs <= 0) {
    throw new Error('allowanceMs must be positive');
  }
  const session: SpikeOfflineSession = {
    startedMs: options.startMs,
    allowanceMs: options.allowanceMs,
    deadlineMs: safeAddMs(options.startMs, options.allowanceMs, 'offline deadline'),
    settledUntilMs: options.startMs,
  };
  return {
    schemaVersion: 2,
    saveEpoch: options.saveEpoch,
    rootSeed: fixture.rootSeed,
    cursorMs: options.startMs,
    stage: 'IDLE',
    stageStartMs: 0,
    stageDone: '0',
    stageRequired: '0',
    counters: { ...EMPTY_COUNTERS },
    gold: '0',
    claims: [],
    lastTerminalAttemptSeq: '0',
    rng: newRngState(),
    big: '0',
    envNextCheckMs: safeAddMs(options.startMs, fixture.envCheckEveryMs, 'initial environment check time'),
    envActivityMicro: 1_000_000,
    offline: session,
  };
}

export function cloneState(state: Readonly<SpikeGameState>): SpikeGameState {
  return {
    schemaVersion: state.schemaVersion,
    saveEpoch: state.saveEpoch,
    rootSeed: state.rootSeed,
    cursorMs: state.cursorMs,
    stage: state.stage,
    stageStartMs: state.stageStartMs,
    stageDone: state.stageDone,
    stageRequired: state.stageRequired,
    counters: { ...state.counters },
    gold: state.gold,
    claims: [...state.claims],
    lastTerminalAttemptSeq: state.lastTerminalAttemptSeq,
    rng: cloneRngState(state.rng),
    big: state.big,
    envNextCheckMs: state.envNextCheckMs,
    envActivityMicro: state.envActivityMicro,
    offline: state.offline ? { ...state.offline } : null,
    ...(state.attemptLock !== undefined
      ? { attemptLock: state.attemptLock === null ? null : { ...state.attemptLock } }
      : {}),
  };
}

export function triangularQuantile(u: number, t: { a: number; mode: number; b: number }): number {
  if (!(u >= 0 && u < 1)) throw new Error(`U must be in [0,1): ${u}`);
  const { a, mode, b } = t;
  if (!(a > 0 && a <= mode && mode <= b)) throw new Error('Invalid triangle');
  if (a === b && b === mode) return a;
  const c = (mode - a) / (b - a);
  if (u < c) return a + Math.sqrt(u * (b - a) * (mode - a));
  return b - Math.sqrt((1 - u) * (b - a) * (b - mode));
}

export interface AdvanceOptions {
  readonly maxNodes?: number;
}

export interface AdvanceResult {
  readonly state: SpikeGameState;
  readonly processedNodes: number;
  readonly reachedTarget: boolean;
}

function advanceSettledCheckpoint(state: SpikeGameState): void {
  if (state.offline === null) return;
  const effectiveUntil = Math.min(state.cursorMs, state.offline.deadlineMs);
  if (effectiveUntil > state.offline.settledUntilMs) {
    state.offline.settledUntilMs = effectiveUntil;
  }
}

function completionTime(done: Nat, required: Nat, startMs: number, rate: bigint): number | null {
  const doneBig = natToBigInt(done);
  const requiredBig = natToBigInt(required);
  if (requiredBig <= 0n) return startMs;
  if (doneBig >= requiredBig) return startMs;
  const elapsed = Number((requiredBig - doneBig + rate - 1n) / rate);
  if (!Number.isSafeInteger(elapsed)) return null;
  const completion = startMs + elapsed;
  return Number.isSafeInteger(completion) ? completion : null;
}

function integrateTo(
  state: SpikeGameState,
  untilMs: number,
  rate: bigint
): { completedAtMs: number | null } {
  if (state.stage === 'IDLE') return { completedAtMs: null };
  const doneBig = natToBigInt(state.stageDone);
  const requiredBig = natToBigInt(state.stageRequired);
  const dt = untilMs - state.cursorMs;
  const total = doneBig + BigInt(dt) * rate;
  if (total < requiredBig) {
    state.stageDone = natFromBigInt(total);
    return { completedAtMs: null };
  }
  const elapsed = Number((requiredBig - doneBig + rate - 1n) / rate);
  if (!Number.isSafeInteger(elapsed)) return { completedAtMs: null };
  const completion = state.cursorMs + elapsed;
  if (!Number.isSafeInteger(completion)) return { completedAtMs: null };
  state.stageDone = state.stageRequired;
  return { completedAtMs: completion };
}

/**
 * Advance the spike machine to `targetMs`. Deterministic and pure: the input
 * state is never mutated. `maxNodes` bounds one call (slice budget), not the
 * simulated duration.
 */
export function advanceOffline(
  state: Readonly<SpikeGameState>,
  targetMs: number,
  options: AdvanceOptions = {}
): AdvanceResult {
  assertSafeMs(targetMs, 'targetMs');
  if (targetMs < state.cursorMs) throw new Error('targetMs precedes cursorMs');
  const fixture = DEFAULT_OFFLINE_FIXTURE;
  const maxNodes = options.maxNodes ?? Number.MAX_SAFE_INTEGER;
  const s = cloneState(state);
  let processedNodes = 0;

  while (s.cursorMs < targetMs) {
    if (processedNodes >= maxNodes) {
      return { state: s, processedNodes, reachedTarget: false };
    }
    const deadline = s.offline ? s.offline.deadlineMs : Number.MAX_SAFE_INTEGER;
    const fishingActive = s.cursorMs < deadline;

    if (s.stage === 'IDLE' && fishingActive) {
      s.stage = 'CASTING';
      s.stageStartMs = s.cursorMs;
      s.stageDone = '0';
      s.stageRequired = workFromMs(fixture.castMs);
      s.counters.attempts += 1;
      processedNodes += 1;
      continue;
    }

    const rate = BigInt(s.envActivityMicro);
    let nextT = targetMs;
    let stageCompletion: number | null = null;

    if (s.stage !== 'IDLE' && fishingActive) {
      stageCompletion = completionTime(s.stageDone, s.stageRequired, s.cursorMs, rate);
      if (stageCompletion !== null && stageCompletion < nextT) nextT = stageCompletion;
    }
    if (fishingActive && deadline < nextT) nextT = deadline;
    if (s.envNextCheckMs < s.cursorMs) {
      nextT = s.cursorMs;
    } else if (s.envNextCheckMs < nextT) {
      nextT = s.envNextCheckMs;
    }
    if (nextT < s.cursorMs) nextT = s.cursorMs;

    if (s.stage !== 'IDLE' && fishingActive) {
      const integrated = integrateTo(s, nextT, rate);
      if (integrated.completedAtMs !== null && integrated.completedAtMs <= nextT) {
        stageCompletion = integrated.completedAtMs;
      } else {
        stageCompletion = null;
      }
    }

    const previousCursor = s.cursorMs;
    s.cursorMs = nextT;
    advanceSettledCheckpoint(s);

    if (s.envNextCheckMs <= s.cursorMs) {
      s.counters.envChecks += 1;
      const draw = drawU53(s.rng, s.rootSeed, ENV_STREAM_NAME);
      s.rng = draw.state;
      s.envActivityMicro = Math.round((0.8 + 0.4 * draw.u) * 1_000_000);
      s.envNextCheckMs = safeAddMs(s.cursorMs, fixture.envCheckEveryMs, 'next environment check');
      processedNodes += 1;
    }

    if (
      s.stage !== 'IDLE' &&
      s.cursorMs <= deadline &&
      natToBigInt(s.stageDone) >= natToBigInt(s.stageRequired)
    ) {
      completeStage(s, fixture);
      processedNodes += 1;
    }

    if (s.cursorMs === previousCursor) {
      // No time and no state transition: only possible when an event was due
      // exactly at the cursor and has just been consumed. The next loop either
      // makes progress or returns.
      if (s.cursorMs >= targetMs) break;
    }
  }

  return { state: s, processedNodes, reachedTarget: s.cursorMs >= targetMs };
}

function completeStage(state: SpikeGameState, fixture: SpikeOfflineFixture): void {
  switch (state.stage) {
    case 'CASTING': {
      state.counters.casts += 1;
      const draw = drawU53(state.rng, state.rootSeed, 'wait');
      state.rng = draw.state;
      const q = triangularQuantile(draw.u, fixture.waitTriangle);
      state.stage = 'WAITING';
      state.stageStartMs = state.cursorMs;
      state.stageDone = '0';
      state.stageRequired = workFromMs(fixture.waitMeanMs * q);
      break;
    }
    case 'WAITING': {
      state.counters.waits += 1;
      const species = drawU53(state.rng, state.rootSeed, 'species');
      state.rng = species.state;
      const capture = drawU53(state.rng, state.rootSeed, 'capture');
      state.rng = capture.state;
      const fightMs = fixture.fightBaseMs + Math.round(fixture.fightVarianceMs * Math.pow(species.u, 1.5));
      const seq = state.counters.attempts;
      const lock: SpikeAttemptLock = {
        seq,
        claimKey: `fish:${seq}`,
        speciesU: species.u,
        captureU: capture.u,
        fightMs,
      };
      state.attemptLock = lock;
      state.stage = 'FIGHTING';
      state.stageStartMs = state.cursorMs;
      state.stageDone = '0';
      state.stageRequired = workFromMs(fightMs);
      state.counters.fights += 1;
      break;
    }
    case 'FIGHTING': {
      const seq = state.counters.attempts;
      if (seq <= 0) throw new Error('FIGHTING requires a positive attempt sequence');
      const locked = state.attemptLock;
      let claimKey = `fish:${seq}`;
      if (locked !== undefined && locked !== null) {
        if (locked.seq !== seq || locked.claimKey !== claimKey) {
          throw new Error(`Locked attempt ${locked.seq} does not match current attempt ${seq}`);
        }
        if (workFromMs(locked.fightMs) !== state.stageRequired) {
          throw new Error('Locked fight duration does not match stageRequired');
        }
        claimKey = locked.claimKey;
      }
      if (
        state.claims.includes(claimKey) ||
        natToBigInt(state.lastTerminalAttemptSeq) >= BigInt(seq)
      ) {
        throw new Error(`Attempt ${seq} already settled; refusing duplicate reward ${claimKey}`);
      }
      state.counters.events += 1;
      const individual = drawU53(state.rng, state.rootSeed, 'individual');
      state.rng = individual.state;
      const gain = fixture.fishGoldBase + BigInt(Math.floor(individual.u * Number(fixture.fishGoldRange)));
      state.gold = natFromBigInt(natToBigInt(state.gold) + gain);
      state.big = natFromBigInt(natToBigInt(state.big) + fixture.bigIncrement);
      state.lastTerminalAttemptSeq = String(seq);
      state.claims.push(claimKey);
      state.stage = 'PREPARING';
      state.stageStartMs = state.cursorMs;
      state.stageDone = '0';
      state.stageRequired = workFromMs(fixture.prepareMs);
      delete state.attemptLock;
      state.counters.prepares += 1;
      break;
    }
    case 'PREPARING': {
      state.counters.cycles += 1;
      state.stage = 'IDLE';
      state.stageStartMs = 0;
      state.stageDone = '0';
      state.stageRequired = '0';
      break;
    }
    case 'IDLE':
      throw new Error('completeStage called while IDLE');
  }
}

/** Convenience: advance in fixed slices and return the final state plus total nodes. */
export function advanceOfflineSliced(
  state: Readonly<SpikeGameState>,
  targetMs: number,
  sliceMs: number,
  options: AdvanceOptions = {}
): { state: SpikeGameState; processedNodes: number } {
  assertSafeMs(sliceMs, 'sliceMs');
  if (sliceMs <= 0) throw new Error('sliceMs must be positive');
  let current = cloneState(state);
  let nodes = 0;
  while (current.cursorMs < targetMs) {
    const step = Math.min(sliceMs, targetMs - current.cursorMs);
    const next = safeAddMs(current.cursorMs, step, 'slice target');
    const result = advanceOffline(current, next, options);
    nodes += result.processedNodes;
    current = result.state;
    if (!result.reachedTarget) break;
  }
  return { state: current, processedNodes: nodes };
}