/**
 * SPIKE-ONLY save-schema migration (v1 -> v2).
 * Verifies the old shape first, performs a pure step, and never touches files;
 * the caller commits the result as a new revision so the old slot is retained.
 */
import { isNat } from './canonical-json.ts';
import { cloneRngState, validateRngState } from './prng.ts';
import { validateSpikeState } from './save.ts';
import { safeAddMs, workFromMs } from './time.ts';
import type { SpikeGameState, SpikeGameStateV1, SpikeStage, SpikeAttemptLock } from './types.ts';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function migrateSpikeState(raw: unknown, from: number, to: number): SpikeGameState {
  if (from === to) {
    if (from === 2) return deepCopyV2(raw);
    throw new MigrationError(`No migration step for schema ${from}`);
  }
  if (!(from === 1 && to === 2)) {
    throw new MigrationError(`Unsupported migration path ${from} -> ${to}`);
  }
  const issues = validateSpikeState(raw);
  if (issues.length > 0) {
    throw new MigrationError(`v1 state invalid: ${issues.map((i) => i.path).join(',')}`);
  }
  const v1 = raw as SpikeGameStateV1;
  if (v1.schemaVersion !== 1) throw new MigrationError('expected schemaVersion 1');
  if (!isNat(v1.gold)) throw new MigrationError('v1 gold must be Nat');
  const attempt = readV1Attempt(v1);
  let envNextCheckMs: number;
  try {
    envNextCheckMs = safeAddMs(v1.cursorMs, 300_000, 'v1 environment check time');
  } catch (error) {
    throw new MigrationError((error as Error).message);
  }
  const stageLevel = attempt === null ? 0 : ATTEMPT_DEPTH[attempt.stage];
  // PREPARING means the current attempt was already settled (design doc 12), so
  // the terminal seq and its claim key must survive migration; v1 gold already
  // contains that reward and must not be granted again.
  const settledAttemptSeq = attempt?.stage === 'PREPARING' ? v1.counter : null;
  return {
    schemaVersion: 2,
    saveEpoch: v1.saveEpoch,
    rootSeed: v1.rootSeed,
    cursorMs: v1.cursorMs,
    stage: attempt?.stage ?? 'IDLE',
    stageStartMs: attempt?.stageStartMs ?? 0,
    stageDone: attempt?.stageDone ?? '0',
    stageRequired: attempt?.stageRequired ?? '0',
    counters: {
      attempts: v1.counter,
      casts: stageLevel >= 1 ? 1 : 0,
      waits: stageLevel >= 2 ? 1 : 0,
      fights: stageLevel >= 3 ? 1 : 0,
      prepares: stageLevel >= 4 ? 1 : 0,
      cycles: 0,
      envChecks: 0,
      events: settledAttemptSeq === null ? 0 : 1,
    },
    gold: v1.gold,
    claims: settledAttemptSeq === null ? [] : [`fish:${settledAttemptSeq}`],
    lastTerminalAttemptSeq: settledAttemptSeq === null ? '0' : String(settledAttemptSeq),
    rng: cloneRngState(v1.rng),
    big: '0',
    envNextCheckMs,
    envActivityMicro: 1_000_000,
    offline: null,
    ...(attempt?.lock ? { attemptLock: { ...attempt.lock } } : {}),
  };
}

const ATTEMPT_DEPTH: Record<SpikeStage, number> = {
  IDLE: 0,
  CASTING: 1,
  WAITING: 2,
  FIGHTING: 3,
  PREPARING: 4,
};

interface V1Attempt {
  readonly stage: Exclude<SpikeStage, 'IDLE'>;
  readonly stageStartMs: number;
  readonly stageDone: string;
  readonly stageRequired: string;
  readonly lock: SpikeAttemptLock | null;
}

function readV1Attempt(v1: SpikeGameStateV1): V1Attempt | null {
  const raw = v1.attempt;
  if (raw === undefined) return null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MigrationError('v1 attempt must be an object');
  }
  const a = raw as Record<string, unknown>;
  const stage = a.stage;
  if (stage !== 'CASTING' && stage !== 'WAITING' && stage !== 'FIGHTING' && stage !== 'PREPARING') {
    throw new MigrationError('v1 attempt.stage is invalid');
  }
  if (v1.counter <= 0) throw new MigrationError('v1 in-progress attempt requires a positive counter');
  if (typeof a.stageStartMs !== 'number' || !Number.isSafeInteger(a.stageStartMs) || a.stageStartMs < 0) {
    throw new MigrationError('v1 attempt.stageStartMs must be a non-negative safe integer');
  }
  if (a.stageStartMs > v1.cursorMs) throw new MigrationError('v1 attempt.stageStartMs exceeds cursorMs');
  if (!isNat(a.stageDone) || !isNat(a.stageRequired)) {
    throw new MigrationError('v1 attempt work fields must be Nat strings');
  }
  if (BigInt(a.stageRequired) <= 0n) throw new MigrationError('v1 attempt.stageRequired must be positive');
  if (BigInt(a.stageDone) > BigInt(a.stageRequired)) {
    throw new MigrationError('v1 attempt.stageDone exceeds stageRequired');
  }

  const rawLock = a.lock;
  let lock: SpikeAttemptLock | null = null;
  if (rawLock !== undefined && rawLock !== null) {
    if (typeof rawLock !== 'object' || Array.isArray(rawLock)) {
      throw new MigrationError('v1 attempt.lock must be an object');
    }
    const l = rawLock as Record<string, unknown>;
    if (stage !== 'FIGHTING') throw new MigrationError('v1 attempt.lock is only valid for FIGHTING');
    if (l.seq !== v1.counter) throw new MigrationError('v1 attempt.lock sequence mismatch');
    if (l.claimKey !== `fish:${v1.counter}`) throw new MigrationError('v1 attempt.lock claim key mismatch');
    for (const key of ['speciesU', 'captureU'] as const) {
      const value = l[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
        throw new MigrationError(`v1 attempt.lock.${key} must be a U53 in [0,1)`);
      }
    }
    if (typeof l.fightMs !== 'number' || !Number.isSafeInteger(l.fightMs) || l.fightMs < 0) {
      throw new MigrationError('v1 attempt.lock.fightMs must be a non-negative safe integer');
    }
    if (workFromMs(l.fightMs) !== a.stageRequired) {
      throw new MigrationError('v1 attempt.lock.fightMs does not match stageRequired');
    }
    lock = {
      seq: l.seq as number,
      claimKey: l.claimKey as string,
      speciesU: l.speciesU as number,
      captureU: l.captureU as number,
      fightMs: l.fightMs,
    };
  } else if (stage === 'FIGHTING') {
    throw new MigrationError('v1 FIGHTING attempt requires a locked result');
  }

  return {
    stage,
    stageStartMs: a.stageStartMs,
    stageDone: a.stageDone,
    stageRequired: a.stageRequired,
    lock,
  };
}

function deepCopyV2(raw: unknown): SpikeGameState {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== 2) throw new MigrationError(`expected schemaVersion 2, got ${String(version)}`);
  const issues = validateSpikeState(raw);
  if (issues.length > 0) throw new MigrationError(`v2 state invalid: ${issues.map((i) => i.path).join(',')}`);
  const state = raw as SpikeGameState;
  validateRngState(state.rng);
  return {
    ...state,
    counters: { ...state.counters },
    claims: [...state.claims],
    rng: cloneRngState(state.rng),
    offline: state.offline ? { ...state.offline } : null,
    ...(state.attemptLock !== undefined
      ? { attemptLock: state.attemptLock === null ? null : { ...state.attemptLock } }
      : {}),
  };
}