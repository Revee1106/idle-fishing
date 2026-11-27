/**
 * SPIKE-ONLY save-schema migration (v1 -> v2).
 * Verifies the old shape first, performs a pure step, and never touches files;
 * the caller commits the result as a new revision so the old slot is retained.
 */
import { isNat } from './canonical-json.ts';
import { cloneRngState, validateRngState } from './prng.ts';
import { validateSpikeState } from './save.ts';
import type { SpikeGameState, SpikeGameStateV1 } from './types.ts';

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
  return {
    schemaVersion: 2,
    saveEpoch: v1.saveEpoch,
    rootSeed: v1.rootSeed,
    cursorMs: v1.cursorMs,
    stage: 'IDLE',
    stageStartMs: 0,
    stageDone: '0',
    stageRequired: '0',
    counters: {
      attempts: v1.counter,
      casts: 0,
      waits: 0,
      fights: 0,
      prepares: 0,
      cycles: 0,
      envChecks: 0,
      events: 0,
    },
    gold: v1.gold,
    claims: [],
    lastTerminalAttemptSeq: '0',
    rng: cloneRngState(v1.rng),
    big: '0',
    envNextCheckMs: v1.cursorMs + 300_000,
    envActivityMicro: 1_000_000,
    offline: null,
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
  };
}