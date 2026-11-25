/**
 * SPIKE-ONLY TYPES — BE-000 technical validation.
 *
 * These types exist to verify runtime, serialization, save-protocol and
 * determinism mechanics. They are a structural subset of
 * docs/interfaces/contracts.ts and must be replaced by the approved
 * packages/contracts types in IF-001. They are NOT production game types.
 */

/** Canonical unsigned decimal integer: /^(0|[1-9][0-9]*)$/. */
export type Nat = string;

export type RngWords = [number, number, number, number];

export interface SpikeRngState {
  algorithm: 'XOSHIRO128SS_V1';
  streams: Record<string, RngWords>;
}

export type SpikeStage = 'IDLE' | 'CASTING' | 'WAITING' | 'FIGHTING' | 'PREPARING';

export interface SpikeCounters {
  attempts: number;
  casts: number;
  waits: number;
  fights: number;
  prepares: number;
  cycles: number;
  envChecks: number;
  events: number;
}

export interface SpikeOfflineSession {
  startedMs: number;
  allowanceMs: number;
  deadlineMs: number;
  settledUntilMs: number;
}

/**
 * SPIKE-ONLY: result locked when a v1 attempt enters FIGHTING, so a migrated
 * in-progress attempt can be resumed without re-drawing. Normal v2 runs do not
 * persist this field (it is optional and absent).
 */
export interface SpikeAttemptLock {
  seq: number;
  claimKey: string;
  speciesU: number;
  captureU: number;
  fightMs: number;
}

/** Save schema v2 (current spike schema). */
export interface SpikeGameState {
  schemaVersion: 2;
  saveEpoch: string;
  rootSeed: number;
  cursorMs: number;
  stage: SpikeStage;
  stageStartMs: number;
  stageDone: Nat;
  stageRequired: Nat;
  counters: SpikeCounters;
  gold: Nat;
  claims: string[];
  lastTerminalAttemptSeq: Nat;
  rng: SpikeRngState;
  big: Nat;
  envNextCheckMs: number;
  envActivityMicro: number;
  offline: SpikeOfflineSession | null;
  attemptLock?: SpikeAttemptLock | null;
}

/**
 * Save schema v1, only used to verify migration. The optional attempt fields
 * are a minimal experimental extension used to prove an in-progress attempt
 * survives migration; real v1 saves do not contain them.
 */
export interface SpikeGameStateV1 {
  schemaVersion: 1;
  saveEpoch: string;
  rootSeed: number;
  cursorMs: number;
  counter: number;
  gold: Nat;
  rng: SpikeRngState;
  attempt?: {
    stage: Exclude<SpikeStage, 'IDLE'>;
    stageStartMs: number;
    stageDone: Nat;
    stageRequired: Nat;
    lock?: SpikeAttemptLock | null;
  };
}

export interface SpikeEnvelope {
  magic: 'IDLE_FISHING';
  format: 1;
  revision: Nat;
  epoch: string;
  payload: string;
  sha256: string;
}

export type SpikeLoadResult =
  | { kind: 'EMPTY' }
  | {
      kind: 'VALID';
      raw: unknown;
      schemaVersion: number;
      epoch: string;
      revision: Nat;
      recovered: boolean;
      warnings: string[];
    }
  | { kind: 'CORRUPT' | 'UNSUPPORTED'; detail: string };

export type SpikeCommitResult =
  | { kind: 'COMMITTED'; revision: Nat; slot: number; recoveredFromUncertainWrite: boolean }
  | { kind: 'CONFLICT' | 'FAILED' | 'UNCERTAIN'; detail: string };

export interface SpikeFilePort {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
}

export interface SpikeSaveRepository {
  load(): Promise<SpikeLoadResult>;
  commit(state: Readonly<SpikeGameState>, expectedRevision: Nat | null): Promise<SpikeCommitResult>;
}