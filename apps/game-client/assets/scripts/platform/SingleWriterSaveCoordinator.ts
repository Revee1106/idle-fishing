/**
 * Application-layer Single-Writer Save Coordinator (Design Doc 11 / Interface 19 / REWORK-06).
 *
 * Distinct responsibilities (NEVER conflated):
 * 1. Cross-Tab Shared Persistent Transaction & Recovery Barrier (A02 / REWORK-04):
 *    - Before ANY save slot write can mutate persistent storage, writes a durable write-ahead
 *      `SharedTxMarker` (`state='PENDING'`) into the SAME shared persistent storage domain
 *      (IndexedDB `${namespace}:__tx_state__` in browsers, `${rootDir}/__tx_state__.json` on WeChat,
 *      or MemoryFilePort tx slot in tests) INSIDE the exclusive lock.
 *    - Every commit entry reads the REAL persisted `SharedTxMarker` inside the exclusive lock.
 * 2. Monotonic Confirmed Revision Floor & Anti-Silent-Reset Gate (REV4-01 / REWORK-06 R5-01):
 *    - Persists monotonic `SaveHistoryMeta` (`confirmedRevision`) inside the SAME storage domain
 *      (`${namespace}:__save_history__` in IndexedDB, `${rootDir}/__save_history__.json` on WeChat,
 *      MemoryFilePort history slot, or storageKey-scoped fallback for custom ports) INSIDE the
 *      exclusive lock and commit confirmation boundary.
 *    - A commit NEVER returns `COMMITTED` if persisting monotonic `SaveHistoryMeta` fails.
 *    - Unconfirmed `targetRevision` is NEVER promoted to `confirmedRevision`.
 *    - Partial IO failures and marker updates NEVER lower `confirmedRevision` to a smaller backup.
 *    - During `loadSafe()` / `recoverFromCorruptTxMarker()`:
 *      (a) EMPTY scan with any confirmed revision floor OR non-initial-create marker -> stays FROZEN
 *          (`SAVE_DISAPPEARED_PENDING_RECOVERY`), NEVER silently resets.
 *      (b) VALID scan with revision LOWER than `max(history.confirmedRevision, marker.confirmedRevision,
 *          marker.expectedRevision)` -> stays FROZEN (`REVISION_REGRESSION_PENDING_RECOVERY`),
 *          exposes lower save strictly as `readOnlyBackup`, NEVER unfreezes or reuses old revisions.
 *    - Corrupt or unreadable history metadata fails closed (`HISTORY_STATE_CORRUPT` /
 *      `HISTORY_STATE_UNREADABLE`) and NEVER silently initializes to a lower revision.
 * 3. Write-Capability Verification Before Unfreezing Write-Failure Freezes (REV4-04 / REWORK-06 R5-02):
 *    - Distinguishes save read success, save write-capability restoration, and full application recovery.
 *    - Freezes caused by real write failures (`QUOTA_EXCEEDED`, `WRITE_IO_ERROR`, etc.) persist
 *      `requiresWriteVerification: true` in `SharedTxMarker`.
 *    - Recovering a `VALID` save from a write-failure freeze executes a safe recovery checkpoint
 *      commit (Option A) using the EXACT verified persisted state (0 gold/xp/fish/time/offline change)
 *      through the existing 3-slot protocol + readback verification; unfreezes ONLY after full success.
 *    - Recovering a confirmed `EMPTY` initial-create freeze verifies real slot-path write+readback+remove
 *      (`save_slot_write_probe.tmp`) before unfreezing.
 *    - If real slot write still fails, returns `WRITE_CAPABILITY_UNAVAILABLE` with `readOnlyBackup`
 *      and remains frozen.
 * 4. Recovery Task Owner & Lifecycle Cancellation Guard (REWORK-06 R5-03):
 *    - Both `loadSafe()` (STANDARD) and `recoverFromCorruptTxMarker()` (CONFIRM_CORRUPT_MARKER)
 *      accept `RecoveryLifecycleHooks` (`shouldCancelBeforeMutation`, `onMutationStarted`).
 *    - Checks owner cancellation AFTER acquiring in-process queue + Web Lock (before any read/probe)
 *      AND AGAIN immediately before ANY persistent mutation (with zero `await` gap).
 *    - Tasks cancelled before mutation return `{ kind: 'CANCELLED' }` with ZERO disk modifications.
 *    - Once `onMutationStarted()` fires, legitimately started persistent mutations finish safely so
 *      callers accurately distinguish true cancellation from completed-after-destroy side effects.
 * 5. Distinct Marker Fault Classification & Controlled Corrupt-Marker Recovery (REV4-03 / REWORK-05):
 *    - Strictly distinguishes `TX_STATE_UNREADABLE` vs `TX_STATE_CORRUPT` vs `PENDING_RECOVERY_REQUIRED`.
 *    - Controlled corrupt-marker recovery re-verifies marker + 3-slot hashes + history floor inside lock,
 *      never modifies save slots, and clears ONLY the corrupt marker.
 */
import {
  isNat,
  natFromBigInt,
  natToBigInt,
  sha256Hex,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  validateSpikeState,
  type Nat,
  type SpikeCommitResult,
  type SpikeGameState,
  type SpikeLoadResult,
} from '@idle-fishing/game-core';
import {
  clearIndexedDbTxStateForNamespace,
  readIndexedDbHistoryStateForNamespace,
  readIndexedDbTxStateForNamespace,
  writeIndexedDbHistoryStateForNamespace,
  writeIndexedDbTxStateForNamespace,
} from './BrowserFilePort';
import type { FilePort, StorageHealthState, StorageProbeResult } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

export type RecoveryFailureClassification =
  | 'PROBE_FAILED'
  | 'IO_UNAVAILABLE'
  | 'PARTIAL_IO_UNAVAILABLE'
  | 'LOCK_UNAVAILABLE'
  | 'TX_STATE_UNREADABLE'
  | 'TX_STATE_CORRUPT'
  | 'TX_STATE_CLEAR_FAILED'
  | 'HISTORY_STATE_UNREADABLE'
  | 'HISTORY_STATE_CORRUPT'
  | 'HISTORY_STATE_WRITE_FAILED'
  | 'WRITE_CAPABILITY_UNAVAILABLE'
  | 'PENDING_RECOVERY_REQUIRED'
  | 'SAVE_DISAPPEARED_PENDING_RECOVERY'
  | 'REVISION_REGRESSION_PENDING_RECOVERY'
  | 'CONCURRENT_RECOVERY_STATE_CHANGED'
  | 'CORRUPT_MARKER_NO_VALID_SAVE';

export interface ReadOnlyBackupInfo {
  readonly revision: Nat;
  readonly schemaVersion: number;
  readonly epoch: string;
  readonly warnings: readonly string[];
}

export interface CorruptMarkerRecoveryPreview {
  readonly canConfirmRecovery: boolean;
  readonly corruptMarkerSha256: string;
  readonly verifiedRevision: Nat | null;
  readonly slotsSnapshotSha256: string | null;
  readonly warning: string;
}

export interface ControlledCorruptMarkerRecoveryConfirmation {
  readonly expectedCorruptMarkerSha256: string;
  readonly expectedValidRevision: Nat;
  readonly expectedSlotsSnapshotSha256: string;
}

export interface RecoveryLifecycleHooks {
  /**
   * Checked AFTER acquiring in-process queue + Web Lock (before any probe/read)
   * AND AGAIN immediately before ANY persistent mutation (with zero await gap).
   */
  shouldCancelBeforeMutation?: () => boolean;
  /**
   * Invoked synchronously immediately before the first persistent side effect begins
   * (writing/clearing tx marker, writing history meta, or writing a recovery checkpoint).
   */
  onMutationStarted?: () => void;
  /**
   * Optional async barrier invoked inside the exclusive lock after initial owner check
   * for deterministic interleaving tests.
   */
  beforeRecoveryBody?: () => Promise<void>;
}

export interface SafeLoadOptions {
  /**
   * When true (default, explicit recovery), a verified complete scan clears a valid pending/uncertain
   * marker ONLY if prior-save history invariants and write-capability checks hold.
   * When false (automatic boot/reload), any existing shared pending/uncertain/frozen marker is preserved
   * fail-closed (`PENDING_RECOVERY_REQUIRED`) until explicit user recovery is triggered.
   */
  readonly clearPendingTxMarker?: boolean;
  /** Optional owner lifecycle cancellation hooks (R5-03). */
  readonly hooks?: RecoveryLifecycleHooks;
  /**
   * R5-02 (REWORK-07): Optional legitimate initial state to persist via the existing 3-slot commit +
   * readback + monotonic history protocol when recovering from a write-failure freeze on a confirmed
   * empty initial-create domain. If absent or invalid when empty-domain write verification is required,
   * recovery remains FROZEN (`WRITE_CAPABILITY_UNAVAILABLE`) and NEVER unfreezes via a synthetic probe.
   */
  readonly initialCommitState?: Readonly<SpikeGameState> | null;
}

export type SafeSaveLoadResult =
  | SpikeLoadResult
  | {
      readonly kind: 'CANCELLED';
      readonly detail: string;
      /**
       * R5-03 (REWORK-07): True if any persistent side effect (such as a storage probe put/delete)
       * had already legitimately started before cancellation. False guarantees 0 persistent mutations.
       */
      readonly persistentMutationOccurred?: boolean;
    }
  | {
      readonly kind: 'STORAGE_UNAVAILABLE';
      readonly detail: string;
      readonly recoveryClassification?: RecoveryFailureClassification;
      readonly unreadableSlots?: readonly string[];
      readonly readOnlyBackup?: ReadOnlyBackupInfo | null;
      readonly corruptMarkerRecoveryPreview?: CorruptMarkerRecoveryPreview | null;
    };

export type SafeSaveCommitResult =
  | SpikeCommitResult
  | { readonly kind: 'STORAGE_UNAVAILABLE'; readonly detail: string }
  | { readonly kind: 'CANCELLED'; readonly detail: string };

export interface CommitLifecycleHooks {
  /** Checked AFTER acquiring exclusive lock(s) and BEFORE any repository read or write. */
  shouldCancelBeforeStart?: () => boolean;
  /** Invoked synchronously when the task transitions QUEUED -> STARTED. */
  onStarted?: () => void;
  /** Optional hook invoked after acquiring exclusive lock(s) & starting, right before physical commit. */
  beforeCommitBody?: () => Promise<void>;
}

export type NamespaceFreezeCode =
  | 'NONE'
  | 'STORAGE_IO_UNAVAILABLE'
  | 'UNCERTAIN_WRITE_PENDING_RECOVERY'
  | 'PARTIAL_IO_UNAVAILABLE'
  | 'CROSS_TAB_LOCK_UNAVAILABLE'
  | 'TX_STATE_CORRUPT'
  | 'SAVE_HISTORY_MISMATCH';

export type SharedTxMarkerState = 'PENDING' | 'UNCERTAIN' | 'FROZEN';
export type PriorSaveHistory = 'CONFIRMED_EMPTY_INITIAL_CREATE' | 'CONFIRMED_VALID' | 'UNKNOWN';

export interface SharedTxMarker {
  readonly version: 1;
  readonly storageKey: string;
  readonly txId: string;
  readonly state: SharedTxMarkerState;
  readonly expectedRevision: string | null;
  readonly targetRevision: string | null;
  readonly priorSaveHistory: PriorSaveHistory;
  readonly confirmedRevision: string | null;
  readonly requiresWriteVerification?: boolean;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly reason: string | null;
}

export interface SaveHistoryMeta {
  readonly version: 1;
  readonly storageKey: string;
  readonly confirmedRevision: string;
  readonly updatedAtMs: number;
}

interface NamespaceHealthRecord {
  health: StorageHealthState;
  freezeCode: NamespaceFreezeCode;
  reason: string | null;
}

const namespaceQueues = new Map<string, Promise<void>>();
const namespaceHealth = new Map<string, NamespaceHealthRecord>();
const fallbackTxMarkers = new Map<string, string>();
const fallbackHistoryStates = new Map<string, string>();
const anonymousPortIds = new WeakMap<FilePort, string>();
let nextAnonymousId = 1;
let nextTxSeq = 1;

const FATAL_STORAGE_ERROR_CODES = new Set<string>([
  'STORAGE_UNAVAILABLE',
  'WX_UNAVAILABLE',
  'MKDIR_FAILED',
  'QUOTA_EXCEEDED',
  'WRITE_IO_ERROR',
  'REMOVE_IO_ERROR',
  'LIST_IO_ERROR',
]);

export function resolvePortStorageKey(port: FilePort): string {
  if (port.storageKey) return port.storageKey;
  let id = anonymousPortIds.get(port);
  if (!id) {
    id = `anon:${port.kind}:${nextAnonymousId++}`;
    anonymousPortIds.set(port, id);
  }
  return id;
}

function getOrInitHealth(storageKey: string): NamespaceHealthRecord {
  let rec = namespaceHealth.get(storageKey);
  if (!rec) {
    rec = { health: 'AVAILABLE', freezeCode: 'NONE', reason: null };
    namespaceHealth.set(storageKey, rec);
  }
  return rec;
}

function markStorageUnavailable(storageKey: string, freezeCode: NamespaceFreezeCode, reason: string): void {
  namespaceHealth.set(storageKey, { health: 'STORAGE_UNAVAILABLE', freezeCode, reason });
}

function markStorageAvailable(storageKey: string): void {
  namespaceHealth.set(storageKey, { health: 'AVAILABLE', freezeCode: 'NONE', reason: null });
}

function isBrowserContext(): boolean {
  const g = globalThis as Record<string, unknown>;
  return typeof g.window === 'object' && g.window !== null && typeof g.document === 'object' && g.document !== null;
}

interface WebLockManagerLike {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

function getWebLocks(): WebLockManagerLike | null {
  const nav = (globalThis as { navigator?: { locks?: WebLockManagerLike } }).navigator;
  if (nav && nav.locks && typeof nav.locks.request === 'function') {
    return nav.locks;
  }
  return null;
}

function enqueueInProcess<T>(storageKey: string, task: () => Promise<T>): Promise<T> {
  const prev = namespaceQueues.get(storageKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => current);
  namespaceQueues.set(storageKey, chained);

  return prev.then(async () => {
    try {
      return await task();
    } finally {
      release();
      if (namespaceQueues.get(storageKey) === chained) {
        namespaceQueues.delete(storageKey);
      }
    }
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function createTxId(): string {
  return `tx_${Date.now()}_${nextTxSeq++}_${Math.floor(Math.random() * 1_000_000)}`;
}

function computeTargetRevision(expectedRevision: Nat | null): string | null {
  if (expectedRevision === null) return '1';
  try {
    return natFromBigInt(natToBigInt(expectedRevision) + 1n);
  } catch {
    return null;
  }
}

function maxNatString(a: string | null | undefined, b: string | null | undefined): string | null {
  const validA = typeof a === 'string' && isNat(a) ? a : null;
  const validB = typeof b === 'string' && isNat(b) ? b : null;
  if (validA === null) return validB;
  if (validB === null) return validA;
  return natToBigInt(validA) >= natToBigInt(validB) ? validA : validB;
}

function inferLegacyRequiresWriteVerification(state: SharedTxMarkerState, reason: string | null): boolean {
  if (state !== 'FROZEN' || !reason) return false;
  return /QUOTA_EXCEEDED|WRITE_IO_ERROR|REMOVE_IO_ERROR|MKDIR_FAILED|Runtime storage write failure|WRITE_CAPABILITY_UNAVAILABLE/i.test(
    reason
  );
}

function markerRequiresWriteVerification(marker: SharedTxMarker): boolean {
  if (typeof marker.requiresWriteVerification === 'boolean') {
    return marker.requiresWriteVerification;
  }
  return inferLegacyRequiresWriteVerification(marker.state, marker.reason);
}

function mergePriorHistory(
  existing: SharedTxMarker | null,
  knownHistoryFloor: string | null,
  observedValidRev: string | null
): { priorSaveHistory: PriorSaveHistory; confirmedRevision: string | null } {
  const existingMax = existing ? maxNatString(existing.confirmedRevision, existing.expectedRevision) : null;
  const mergedRev = maxNatString(maxNatString(existingMax, knownHistoryFloor), observedValidRev);
  if (mergedRev !== null) {
    return { priorSaveHistory: 'CONFIRMED_VALID', confirmedRevision: mergedRev };
  }
  if (existing && existing.priorSaveHistory === 'CONFIRMED_VALID') {
    return { priorSaveHistory: 'CONFIRMED_VALID', confirmedRevision: existing.confirmedRevision };
  }
  if (existing && existing.priorSaveHistory === 'CONFIRMED_EMPTY_INITIAL_CREATE') {
    return { priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE', confirmedRevision: null };
  }
  return { priorSaveHistory: 'UNKNOWN', confirmedRevision: null };
}

interface ParsedTxMarkerResult {
  readonly status: 'ABSENT' | 'VALID' | 'READ_IO_ERROR' | 'CORRUPT';
  readonly marker: SharedTxMarker | null;
  readonly rawText: string | null;
  readonly rawSha256: string | null;
  readonly detail: string | null;
}

interface ParsedHistoryMetaResult {
  readonly status: 'ABSENT' | 'VALID' | 'READ_IO_ERROR' | 'CORRUPT';
  readonly meta: SaveHistoryMeta | null;
  readonly detail: string | null;
}

function parseSaveHistoryMeta(raw: string, expectedStorageKey: string): ParsedHistoryMetaResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: 'SAVE_HISTORY_META_CORRUPT: save history metadata is invalid JSON',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: 'SAVE_HISTORY_META_CORRUPT: save history metadata must be a JSON object',
    };
  }
  const m = parsed as Record<string, unknown>;
  if (m.version !== 1) {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: `SAVE_HISTORY_META_CORRUPT: unsupported save history version: ${String(m.version)}`,
    };
  }
  if (m.storageKey !== expectedStorageKey) {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: `SAVE_HISTORY_META_CORRUPT: storageKey mismatch (${String(m.storageKey)} !== ${expectedStorageKey})`,
    };
  }
  if (typeof m.confirmedRevision !== 'string' || !isNat(m.confirmedRevision)) {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: `SAVE_HISTORY_META_CORRUPT: invalid confirmedRevision (${String(m.confirmedRevision)})`,
    };
  }
  if (typeof m.updatedAtMs !== 'number' || !Number.isFinite(m.updatedAtMs)) {
    return {
      status: 'CORRUPT',
      meta: null,
      detail: 'SAVE_HISTORY_META_CORRUPT: invalid updatedAtMs',
    };
  }
  return {
    status: 'VALID',
    meta: {
      version: 1,
      storageKey: expectedStorageKey,
      confirmedRevision: m.confirmedRevision,
      updatedAtMs: m.updatedAtMs,
    },
    detail: null,
  };
}

function parseSharedTxMarker(raw: string, expectedStorageKey: string): ParsedTxMarkerResult {
  const rawSha256 = sha256Hex(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: shared tx marker is invalid JSON',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: shared tx marker must be a JSON object',
    };
  }
  const m = parsed as Record<string, unknown>;
  if (m.version !== 1) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: `SHARED_TX_STATE_CORRUPT: unsupported tx marker version: ${String(m.version)}`,
    };
  }
  if (m.storageKey !== expectedStorageKey) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: `SHARED_TX_STATE_CORRUPT: tx marker storageKey mismatch (${String(m.storageKey)} !== ${expectedStorageKey})`,
    };
  }
  const txId = m.txId;
  if (typeof txId !== 'string' || txId.length === 0) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker missing valid txId',
    };
  }
  const state = m.state;
  if (state !== 'PENDING' && state !== 'UNCERTAIN' && state !== 'FROZEN') {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: `SHARED_TX_STATE_CORRUPT: tx marker invalid state: ${String(state)}`,
    };
  }
  const expectedRevision = m.expectedRevision;
  if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !isNat(expectedRevision))) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid expectedRevision',
    };
  }
  const targetRevision = m.targetRevision;
  if (targetRevision !== null && (typeof targetRevision !== 'string' || !isNat(targetRevision))) {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid targetRevision',
    };
  }
  const createdAtMs = m.createdAtMs;
  const updatedAtMs = m.updatedAtMs;
  if (typeof createdAtMs !== 'number' || typeof updatedAtMs !== 'number') {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid timestamps',
    };
  }
  const reason = m.reason;
  if (reason !== null && typeof reason !== 'string') {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid reason',
    };
  }
  if (typeof m.requiresWriteVerification !== 'undefined' && typeof m.requiresWriteVerification !== 'boolean') {
    return {
      status: 'CORRUPT',
      marker: null,
      rawText: raw,
      rawSha256,
      detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid requiresWriteVerification',
    };
  }

  // REV4-01 conservative parsing of priorSaveHistory & confirmedRevision:
  // Legacy v1 markers missing these fields NEVER default to CONFIRMED_EMPTY_INITIAL_CREATE!
  let priorSaveHistory: PriorSaveHistory;
  let confirmedRevision: string | null;
  if (typeof m.priorSaveHistory === 'undefined') {
    if (expectedRevision !== null) {
      priorSaveHistory = 'CONFIRMED_VALID';
      confirmedRevision = String(expectedRevision);
    } else {
      priorSaveHistory = 'UNKNOWN';
      confirmedRevision = null;
    }
  } else {
    if (
      m.priorSaveHistory !== 'CONFIRMED_EMPTY_INITIAL_CREATE' &&
      m.priorSaveHistory !== 'CONFIRMED_VALID' &&
      m.priorSaveHistory !== 'UNKNOWN'
    ) {
      return {
        status: 'CORRUPT',
        marker: null,
        rawText: raw,
        rawSha256,
        detail: `SHARED_TX_STATE_CORRUPT: tx marker invalid priorSaveHistory: ${String(m.priorSaveHistory)}`,
      };
    }
    priorSaveHistory = m.priorSaveHistory;
    if (typeof m.confirmedRevision === 'undefined' || m.confirmedRevision === null) {
      confirmedRevision = expectedRevision === null ? null : String(expectedRevision);
    } else if (typeof m.confirmedRevision === 'string' && isNat(m.confirmedRevision)) {
      confirmedRevision = maxNatString(String(m.confirmedRevision), expectedRevision === null ? null : String(expectedRevision));
    } else {
      return {
        status: 'CORRUPT',
        marker: null,
        rawText: raw,
        rawSha256,
        detail: 'SHARED_TX_STATE_CORRUPT: tx marker invalid confirmedRevision',
      };
    }
    if (priorSaveHistory === 'CONFIRMED_EMPTY_INITIAL_CREATE' && (expectedRevision !== null || confirmedRevision !== null)) {
      return {
        status: 'CORRUPT',
        marker: null,
        rawText: raw,
        rawSha256,
        detail: 'SHARED_TX_STATE_CORRUPT: contradictory CONFIRMED_EMPTY_INITIAL_CREATE with non-null revision',
      };
    }
  }

  const requiresWriteVerification =
    typeof m.requiresWriteVerification === 'boolean'
      ? m.requiresWriteVerification
      : inferLegacyRequiresWriteVerification(state, reason === null ? null : String(reason));

  return {
    status: 'VALID',
    rawText: raw,
    rawSha256,
    detail: null,
    marker: {
      version: 1,
      storageKey: expectedStorageKey,
      txId,
      state,
      expectedRevision: expectedRevision === null ? null : String(expectedRevision),
      targetRevision: targetRevision === null ? null : String(targetRevision),
      priorSaveHistory,
      confirmedRevision,
      requiresWriteVerification,
      createdAtMs,
      updatedAtMs,
      reason: reason === null ? null : String(reason),
    },
  };
}

export class SingleWriterSaveCoordinator {
  readonly port: FilePort;
  readonly storageKey: string;
  private readonly requiresCrossTabLock: boolean;

  constructor(port: FilePort) {
    this.port = port;
    this.storageKey = resolvePortStorageKey(port);
    this.requiresCrossTabLock = this.storageKey.startsWith('browser:') && isBrowserContext();
  }

  get storageHealth(): StorageHealthState {
    return getOrInitHealth(this.storageKey).health;
  }

  get freezeCode(): NamespaceFreezeCode {
    return getOrInitHealth(this.storageKey).freezeCode;
  }

  get storageUnavailableReason(): string | null {
    return getOrInitHealth(this.storageKey).reason;
  }

  private getBrowserNamespace(): string | null {
    if (!this.requiresCrossTabLock || !this.storageKey.startsWith('browser:')) return null;
    return this.storageKey.slice('browser:'.length);
  }

  private async readRawTxState(): Promise<string | null> {
    if (typeof this.port.readTxState === 'function') {
      return this.port.readTxState();
    }
    const browserNs = this.getBrowserNamespace();
    if (browserNs !== null) {
      return readIndexedDbTxStateForNamespace(browserNs);
    }
    return fallbackTxMarkers.has(this.storageKey) ? fallbackTxMarkers.get(this.storageKey)! : null;
  }

  private async writeRawTxState(text: string): Promise<void> {
    if (typeof this.port.writeTxState === 'function') {
      await this.port.writeTxState(text);
      return;
    }
    const browserNs = this.getBrowserNamespace();
    if (browserNs !== null) {
      await writeIndexedDbTxStateForNamespace(browserNs, text);
      return;
    }
    fallbackTxMarkers.set(this.storageKey, text);
  }

  private async clearRawTxState(): Promise<void> {
    if (typeof this.port.clearTxState === 'function') {
      await this.port.clearTxState();
      return;
    }
    const browserNs = this.getBrowserNamespace();
    if (browserNs !== null) {
      await clearIndexedDbTxStateForNamespace(browserNs);
      return;
    }
    fallbackTxMarkers.delete(this.storageKey);
  }

  private async readRawHistoryState(): Promise<string | null> {
    if (typeof this.port.readHistoryState === 'function') {
      return this.port.readHistoryState();
    }
    const browserNs = this.getBrowserNamespace();
    if (browserNs !== null) {
      return readIndexedDbHistoryStateForNamespace(browserNs);
    }
    return fallbackHistoryStates.has(this.storageKey) ? fallbackHistoryStates.get(this.storageKey)! : null;
  }

  private async writeRawHistoryState(text: string): Promise<void> {
    if (typeof this.port.writeHistoryState === 'function') {
      await this.port.writeHistoryState(text);
      return;
    }
    const browserNs = this.getBrowserNamespace();
    if (browserNs !== null) {
      await writeIndexedDbHistoryStateForNamespace(browserNs, text);
      return;
    }
    fallbackHistoryStates.set(this.storageKey, text);
  }

  private async readSharedTxMarker(): Promise<ParsedTxMarkerResult> {
    let raw: string | null;
    try {
      raw = await this.readRawTxState();
    } catch (err) {
      return {
        status: 'READ_IO_ERROR',
        marker: null,
        rawText: null,
        rawSha256: null,
        detail: `SHARED_TX_STATE_UNREADABLE: ${errorMessage(err)}`,
      };
    }
    if (raw === null) {
      return { status: 'ABSENT', marker: null, rawText: null, rawSha256: null, detail: null };
    }
    return parseSharedTxMarker(raw, this.storageKey);
  }

  private async readSaveHistoryMeta(): Promise<ParsedHistoryMetaResult> {
    let raw: string | null;
    try {
      raw = await this.readRawHistoryState();
    } catch (err) {
      return {
        status: 'READ_IO_ERROR',
        meta: null,
        detail: `SAVE_HISTORY_META_UNREADABLE: ${errorMessage(err)}`,
      };
    }
    if (raw === null) {
      return { status: 'ABSENT', meta: null, detail: null };
    }
    return parseSaveHistoryMeta(raw, this.storageKey);
  }

  /**
   * Monotonically persists confirmedRevision floor inside the exclusive lock.
   * NEVER writes a lower revision than `existingFloor`.
   */
  private async persistMonotonicHistoryMeta(confirmedRevision: string, existingFloor: string | null): Promise<string> {
    const monotonicRev = maxNatString(existingFloor, confirmedRevision);
    if (monotonicRev === null) {
      throw new FilePortIoError('WRITE_IO_ERROR', '__save_history__', 'Invalid confirmedRevision for history metadata');
    }
    if (existingFloor !== null && natToBigInt(monotonicRev) === natToBigInt(existingFloor)) {
      return monotonicRev;
    }
    const meta: SaveHistoryMeta = {
      version: 1,
      storageKey: this.storageKey,
      confirmedRevision: monotonicRev,
      updatedAtMs: Date.now(),
    };
    await this.writeRawHistoryState(JSON.stringify(meta));
    return monotonicRev;
  }

  private async writeSharedTxMarker(marker: SharedTxMarker): Promise<void> {
    await this.writeRawTxState(JSON.stringify(marker));
  }

  private async clearSharedTxMarker(): Promise<void> {
    await this.clearRawTxState();
  }

  /**
   * Scans all 3 save slots through an observing FilePort, capturing per-slot IO errors AND
   * raw slot bytes for snapshot digest verification (without modifying backend SpikeFileSaveRepository).
   */
  private async scanAllSlotsObserved(): Promise<{
    res: SpikeLoadResult;
    ioErrorSlots: { path: string; detail: string }[];
    rawSlotTexts: (string | null)[];
    slotsSnapshotSha256: string;
  }> {
    const ioErrorSlots: { path: string; detail: string }[] = [];
    const slotMap = new Map<string, string | null>();
    const observedPort: FilePort = {
      kind: this.port.kind,
      storageKey: this.port.storageKey,
      probeStorage: this.port.probeStorage ? (opts) => this.port.probeStorage!(opts) : undefined,
      read: async (p) => {
        try {
          const val = await this.port.read(p);
          slotMap.set(p, val);
          return val;
        } catch (err) {
          ioErrorSlots.push({ path: p, detail: errorMessage(err) });
          throw err;
        }
      },
      write: (p, text) => this.port.write(p, text),
      remove: (p) => this.port.remove(p),
      list: (dir) => this.port.list(dir),
    };
    const repo = new SpikeFileSaveRepository(observedPort);
    const res = await repo.load();
    const rawSlotTexts = SLOT_PATHS.map((p) => (slotMap.has(p) ? slotMap.get(p)! : null));
    const slotsSnapshotSha256 = sha256Hex(JSON.stringify(rawSlotTexts));
    return { res, ioErrorSlots, rawSlotTexts, slotsSnapshotSha256 };
  }

  /**
   * Acquires BOTH the in-process namespace queue AND (for browser persistent storage)
   * the cross-tab W3C Web Lock (`navigator.locks.request`).
   */
  private async withExclusiveLock<T>(
    task: () => Promise<T>,
    onLockUnavailable: (detail: string) => T
  ): Promise<T> {
    return enqueueInProcess(this.storageKey, async () => {
      if (!this.requiresCrossTabLock) {
        return task();
      }
      const locks = getWebLocks();
      if (!locks) {
        const detail = 'CROSS_TAB_LOCK_UNAVAILABLE: navigator.locks Web Locks API is unavailable in browser runtime';
        markStorageUnavailable(this.storageKey, 'CROSS_TAB_LOCK_UNAVAILABLE', detail);
        return onLockUnavailable(detail);
      }
      const lockName = `idle-fishing:save:${this.storageKey}`;
      try {
        return await locks.request(lockName, { mode: 'exclusive' }, async () => {
          try {
            return await task();
          } catch (taskErr) {
            throw new CoordinatorTaskError(taskErr);
          }
        });
      } catch (err) {
        if (err instanceof CoordinatorTaskError) {
          throw err.cause;
        }
        const detail = `CROSS_TAB_LOCK_REJECTED: ${errorMessage(err)}`;
        markStorageUnavailable(this.storageKey, 'CROSS_TAB_LOCK_UNAVAILABLE', detail);
        return onLockUnavailable(detail);
      }
    });
  }

  /**
   * Executes a critical section exclusively for this storage namespace (in-process + cross-tab when in browser).
   */
  runExclusive<T>(task: () => Promise<T>): Promise<T> {
    return this.withExclusiveLock(task, (detail) => {
      throw new FilePortIoError('STORAGE_UNAVAILABLE', this.storageKey, detail);
    });
  }

  /**
   * R5-02 Option A: Verifies real save-slot write capability on a confirmed VALID save by executing
   * a safe recovery checkpoint commit through the existing 3-slot protocol + readback verification
   * using the EXACT verified persisted state (zero business gain, zero time advancement).
   */
  private async executeSafeCheckpointCommit(
    res: Extract<SpikeLoadResult, { kind: 'VALID' }>,
    existingMarker: SharedTxMarker,
    knownConfirmedFloor: string | null,
    persistedHistoryFloor: string | null
  ): Promise<SafeSaveLoadResult> {
    const readOnlyBackup: ReadOnlyBackupInfo = {
      revision: res.revision,
      schemaVersion: res.schemaVersion,
      epoch: res.epoch,
      warnings: res.warnings,
    };
    const floorBefore = maxNatString(knownConfirmedFloor, res.revision);

    if (res.schemaVersion !== 2 || typeof res.raw !== 'object' || res.raw === null) {
      const reason = `WRITE_CAPABILITY_UNAVAILABLE: cannot run recovery checkpoint commit for unsupported schemaVersion=${res.schemaVersion}`;
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
        unreadableSlots: [],
        readOnlyBackup,
        corruptMarkerRecoveryPreview: null,
      };
    }

    const verifiedState = res.raw as SpikeGameState;
    const ckptTxId = createTxId();
    const ckptTargetRev = computeTargetRevision(res.revision);
    const now = Date.now();

    // Update durable marker to PENDING before touching the next rotation slot, preserving confirmed floor!
    try {
      await this.writeSharedTxMarker({
        version: 1,
        storageKey: this.storageKey,
        txId: ckptTxId,
        state: 'PENDING',
        expectedRevision: res.revision,
        targetRevision: ckptTargetRev,
        priorSaveHistory: 'CONFIRMED_VALID',
        confirmedRevision: floorBefore,
        requiresWriteVerification: true,
        createdAtMs: existingMarker.createdAtMs,
        updatedAtMs: now,
        reason: `Recovery write-capability checkpoint commit from verified rev=${res.revision}`,
      });
    } catch (err) {
      const reason = `WRITE_CAPABILITY_UNAVAILABLE: failed to update tx marker before recovery checkpoint commit: ${errorMessage(err)}`;
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
        unreadableSlots: [],
        readOnlyBackup,
        corruptMarkerRecoveryPreview: null,
      };
    }

    let committedCkpt: Extract<SpikeCommitResult, { kind: 'COMMITTED' }> | null = null;
    let failDetail = 'checkpoint commit returned no result';
    try {
      const repo = new SpikeFileSaveRepository(this.port);
      const ckptRes = await repo.commit(verifiedState, res.revision);
      if (ckptRes.kind === 'COMMITTED') {
        committedCkpt = ckptRes;
      } else {
        failDetail = `${ckptRes.kind}: ${ckptRes.detail}`;
      }
    } catch (err) {
      failDetail = `threw ${errorMessage(err)}`;
    }

    if (committedCkpt === null) {
      const reason = `WRITE_CAPABILITY_UNAVAILABLE: save backup rev=${res.revision} is readable, but real save-slot write capability is still failing (${failDetail}); writes remain frozen`;
      try {
        await this.writeSharedTxMarker({
          version: 1,
          storageKey: this.storageKey,
          txId: ckptTxId,
          state: 'FROZEN',
          expectedRevision: res.revision,
          targetRevision: ckptTargetRev,
          priorSaveHistory: 'CONFIRMED_VALID',
          confirmedRevision: floorBefore,
          requiresWriteVerification: true,
          createdAtMs: existingMarker.createdAtMs,
          updatedAtMs: Date.now(),
          reason,
        });
      } catch {
        // Durable PENDING/FROZEN marker remains on disk
      }
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
        unreadableSlots: [],
        readOnlyBackup,
        corruptMarkerRecoveryPreview: null,
      };
    }

    // Checkpoint committed & readback-verified! Persist monotonic SaveHistoryMeta BEFORE clearing marker & unfreezing!
    try {
      await this.persistMonotonicHistoryMeta(committedCkpt.revision, persistedHistoryFloor);
    } catch (err) {
      const reason = `HISTORY_STATE_WRITE_FAILED: recovery checkpoint committed rev=${committedCkpt.revision}, but failed to persist monotonic save history metadata: ${errorMessage(err)}`;
      try {
        await this.writeSharedTxMarker({
          version: 1,
          storageKey: this.storageKey,
          txId: ckptTxId,
          state: 'FROZEN',
          expectedRevision: committedCkpt.revision,
          targetRevision: null,
          priorSaveHistory: 'CONFIRMED_VALID',
          confirmedRevision: maxNatString(floorBefore, committedCkpt.revision),
          requiresWriteVerification: true,
          createdAtMs: existingMarker.createdAtMs,
          updatedAtMs: Date.now(),
          reason,
        });
      } catch {
        // Durable PENDING marker remains on disk
      }
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'HISTORY_STATE_WRITE_FAILED',
        unreadableSlots: [],
        readOnlyBackup: {
          revision: committedCkpt.revision,
          schemaVersion: res.schemaVersion,
          epoch: res.epoch,
          warnings: res.warnings,
        },
        corruptMarkerRecoveryPreview: null,
      };
    }

    // Clear marker only after BOTH checkpoint commit and history metadata are durably confirmed
    try {
      await this.clearSharedTxMarker();
    } catch (err) {
      const reason = `TX_STATE_CLEAR_FAILED: recovery checkpoint committed rev=${committedCkpt.revision}, but failed to clear shared tx marker: ${errorMessage(err)}`;
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'TX_STATE_CLEAR_FAILED',
        unreadableSlots: [],
        readOnlyBackup: {
          revision: committedCkpt.revision,
          schemaVersion: res.schemaVersion,
          epoch: res.epoch,
          warnings: res.warnings,
        },
        corruptMarkerRecoveryPreview: null,
      };
    }

    markStorageAvailable(this.storageKey);
    return {
      kind: 'VALID',
      revision: committedCkpt.revision,
      schemaVersion: res.schemaVersion,
      epoch: res.epoch,
      raw: verifiedState,
      recovered: res.recovered,
      warnings: [
        ...res.warnings,
        `recovery checkpoint committed rev=${committedCkpt.revision} (slot=${committedCkpt.slot}, state unchanged)`,
      ],
    };
  }

  /**
   * R5-02 (REWORK-07): Verifies real initial-save persistence capability on a confirmed empty
   * initial-create write-failure freeze by committing the caller's actual valid initial state
   * through the existing 3-slot commit + readback + monotonic history + tx marker protocol.
   * Zero fabricated business data, zero business gain, zero time advancement, zero synthetic 2KB probe.
   */
  private async executeSafeInitialSaveCommit(
    initialState: Readonly<SpikeGameState>,
    existingMarker: SharedTxMarker,
    persistedHistoryFloor: string | null
  ): Promise<SafeSaveLoadResult> {
    const initTxId = createTxId();
    const now = Date.now();

    // Update durable marker to PENDING before touching slot 0, preserving initial-create provenance!
    try {
      await this.writeSharedTxMarker({
        version: 1,
        storageKey: this.storageKey,
        txId: initTxId,
        state: 'PENDING',
        expectedRevision: null,
        targetRevision: '1',
        priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE',
        confirmedRevision: null,
        requiresWriteVerification: true,
        createdAtMs: existingMarker.createdAtMs,
        updatedAtMs: now,
        reason: 'Recovery initial-save write verification commit on confirmed empty domain',
      });
    } catch (err) {
      const reason = `WRITE_CAPABILITY_UNAVAILABLE: failed to update tx marker before recovery initial-save commit: ${errorMessage(err)}`;
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
        unreadableSlots: [],
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
      };
    }

    let committedInit: Extract<SpikeCommitResult, { kind: 'COMMITTED' }> | null = null;
    let failKind: 'FAILED' | 'UNCERTAIN' | 'CONFLICT' | 'THREW' = 'FAILED';
    let failDetail = 'initial-save recovery commit returned no result';
    try {
      const repo = new SpikeFileSaveRepository(this.port);
      const initRes = await repo.commit(initialState, null);
      if (initRes.kind === 'COMMITTED') {
        committedInit = initRes;
      } else {
        failKind = initRes.kind;
        failDetail = `${initRes.kind}: ${initRes.detail}`;
      }
    } catch (err) {
      failKind = 'THREW';
      failDetail = `threw ${errorMessage(err)}`;
    }

    if (committedInit === null) {
      const reason = `WRITE_CAPABILITY_UNAVAILABLE: confirmed empty domain failed real initial-save persistence verification (${failDetail}); writes remain frozen`;
      try {
        await this.writeSharedTxMarker({
          version: 1,
          storageKey: this.storageKey,
          txId: initTxId,
          state: failKind === 'UNCERTAIN' ? 'UNCERTAIN' : 'FROZEN',
          expectedRevision: null,
          targetRevision: '1',
          priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE',
          confirmedRevision: null,
          requiresWriteVerification: true,
          createdAtMs: existingMarker.createdAtMs,
          updatedAtMs: Date.now(),
          reason,
        });
      } catch {
        // Durable PENDING/FROZEN marker remains on disk
      }
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
        unreadableSlots: [],
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
      };
    }

    // Initial save committed & readback-verified! Persist monotonic SaveHistoryMeta BEFORE clearing marker & unfreezing!
    try {
      await this.persistMonotonicHistoryMeta(committedInit.revision, persistedHistoryFloor);
    } catch (err) {
      const reason = `HISTORY_STATE_WRITE_FAILED: recovery initial save committed rev=${committedInit.revision}, but failed to persist monotonic save history metadata: ${errorMessage(err)}`;
      try {
        await this.writeSharedTxMarker({
          version: 1,
          storageKey: this.storageKey,
          txId: initTxId,
          state: 'FROZEN',
          expectedRevision: committedInit.revision,
          targetRevision: null,
          priorSaveHistory: 'CONFIRMED_VALID',
          confirmedRevision: maxNatString(persistedHistoryFloor, committedInit.revision),
          requiresWriteVerification: true,
          createdAtMs: existingMarker.createdAtMs,
          updatedAtMs: Date.now(),
          reason,
        });
      } catch {
        // Durable PENDING marker remains on disk
      }
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'HISTORY_STATE_WRITE_FAILED',
        unreadableSlots: [],
        readOnlyBackup: {
          revision: committedInit.revision,
          schemaVersion: initialState.schemaVersion,
          epoch: initialState.saveEpoch,
          warnings: [],
        },
        corruptMarkerRecoveryPreview: null,
      };
    }

    // Clear marker only after BOTH initial save commit and history metadata are durably confirmed
    try {
      await this.clearSharedTxMarker();
    } catch (err) {
      const reason = `TX_STATE_CLEAR_FAILED: recovery initial save committed rev=${committedInit.revision}, but failed to clear shared tx marker: ${errorMessage(err)}`;
      markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
      return {
        kind: 'STORAGE_UNAVAILABLE',
        detail: reason,
        recoveryClassification: 'TX_STATE_CLEAR_FAILED',
        unreadableSlots: [],
        readOnlyBackup: {
          revision: committedInit.revision,
          schemaVersion: initialState.schemaVersion,
          epoch: initialState.saveEpoch,
          warnings: [],
        },
        corruptMarkerRecoveryPreview: null,
      };
    }

    markStorageAvailable(this.storageKey);
    return {
      kind: 'VALID',
      revision: committedInit.revision,
      schemaVersion: initialState.schemaVersion,
      epoch: initialState.saveEpoch,
      raw: initialState,
      recovered: false,
      warnings: [
        `recovery initial save committed rev=${committedInit.revision} (slot=${committedInit.slot}, state unchanged)`,
      ],
    };
  }

  /**
   * Probes storage health, validates shared transaction marker and monotonic history metadata,
   * scans ALL 3 save slots inside the exclusive lock, and enforces R5-01 / R5-02 / R5-03 invariants.
   */
  loadSafe(options?: SafeLoadOptions): Promise<SafeSaveLoadResult> {
    const clearPendingTxMarker = options?.clearPendingTxMarker !== false;
    const hooks = options?.hooks;
    const initialCommitState = options?.initialCommitState ?? null;
    return this.withExclusiveLock<SafeSaveLoadResult>(
      async () => {
        let probeMutationOccurred = false;

        // R5-03 Check #1: Cancel immediately upon acquiring lock BEFORE any probe, read, or mutation!
        if (hooks?.shouldCancelBeforeMutation?.()) {
          return {
            kind: 'CANCELLED',
            detail: 'Recovery cancelled after acquiring lock before any probe or read (owner destroyed)',
            persistentMutationOccurred: false,
          };
        }
        if (hooks?.beforeRecoveryBody) {
          await hooks.beforeRecoveryBody();
          if (hooks.shouldCancelBeforeMutation?.()) {
            return {
              kind: 'CANCELLED',
              detail: 'Recovery cancelled before probe/scan after async wait (owner destroyed)',
              persistentMutationOccurred: false,
            };
          }
        }

        if (typeof this.port.probeStorage === 'function') {
          let probe: StorageProbeResult;
          try {
            probe = await this.port.probeStorage({
              shouldCancelBeforeMutation: hooks?.shouldCancelBeforeMutation,
              onMutationStarted: () => {
                probeMutationOccurred = true;
                hooks?.onMutationStarted?.();
              },
            });
          } catch (err) {
            const reason = `Persistent storage probe threw: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'PROBE_FAILED',
              unreadableSlots: [...SLOT_PATHS],
              readOnlyBackup: null,
              corruptMarkerRecoveryPreview: null,
            };
          }
          if (probe.mutated === true && !probeMutationOccurred) {
            probeMutationOccurred = true;
            hooks?.onMutationStarted?.();
          }
          if (probe.cancelled === true && !probeMutationOccurred) {
            return {
              kind: 'CANCELLED',
              detail: probe.reason ?? 'Recovery cancelled before storage probe write (owner destroyed)',
              persistentMutationOccurred: false,
            };
          }
          if (!probe.available) {
            const reason = probe.reason ?? 'Persistent storage probe failed';
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'PROBE_FAILED',
              unreadableSlots: [...SLOT_PATHS],
              readOnlyBackup: null,
              corruptMarkerRecoveryPreview: null,
            };
          }
          if (hooks?.shouldCancelBeforeMutation?.()) {
            return {
              kind: 'CANCELLED',
              detail: probeMutationOccurred
                ? 'Storage probe write/cleanup completed after owner destroy; aborted before save-domain mutation'
                : 'Recovery cancelled after storage probe before save-domain scan (owner destroyed)',
              persistentMutationOccurred: probeMutationOccurred,
            };
          }
        }

        // REV4-03: Distinguish marker read IO failure vs readable-but-corrupt marker vs valid marker
        const markerRead = await this.readSharedTxMarker();
        if (markerRead.status === 'READ_IO_ERROR') {
          const detail = markerRead.detail ?? 'SHARED_TX_STATE_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'TX_STATE_UNREADABLE',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }

        // R5-01: Read persisted monotonic confirmed-revision history metadata (conservative fail-closed)
        const historyRead = await this.readSaveHistoryMeta();
        if (historyRead.status === 'READ_IO_ERROR') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'HISTORY_STATE_UNREADABLE',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }
        if (historyRead.status === 'CORRUPT') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_CORRUPT';
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'HISTORY_STATE_CORRUPT',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }

        const persistedHistoryFloor = historyRead.meta?.confirmedRevision ?? null;
        const { res, ioErrorSlots, slotsSnapshotSha256 } = await this.scanAllSlotsObserved();

        // REV4-03 + R5-01: Corrupt marker -> keep frozen, NEVER auto-clear; inspect slots read-only to build
        // controlled recovery preview ONLY when 0 slot IO errors, VALID save exists, and no revision regression!
        if (markerRead.status === 'CORRUPT') {
          const unreadablePaths = ioErrorSlots.map((s) => s.path);
          const regressedBelowHistory =
            res.kind === 'VALID' &&
            persistedHistoryFloor !== null &&
            natToBigInt(res.revision) < natToBigInt(persistedHistoryFloor);
          const canConfirm = ioErrorSlots.length === 0 && res.kind === 'VALID' && !regressedBelowHistory;
          const readOnlyBackup: ReadOnlyBackupInfo | null =
            res.kind === 'VALID'
              ? {
                  revision: res.revision,
                  schemaVersion: res.schemaVersion,
                  epoch: res.epoch,
                  warnings: res.warnings,
                }
              : null;
          const preview: CorruptMarkerRecoveryPreview = {
            canConfirmRecovery: canConfirm,
            corruptMarkerSha256: markerRead.rawSha256 ?? '',
            verifiedRevision: canConfirm && res.kind === 'VALID' ? res.revision : null,
            slotsSnapshotSha256: canConfirm ? slotsSnapshotSha256 : null,
            warning: regressedBelowHistory && res.kind === 'VALID'
              ? `Controlled recovery disabled: scanned save rev=${res.revision} is lower than confirmed historical revision (${persistedHistoryFloor}).`
              : canConfirm && res.kind === 'VALID'
                ? `Shared transaction marker is corrupt; prior transaction history cannot be confirmed. Confirming will discard ONLY the corrupt marker and recover verified save rev=${res.revision} (uncommitted progress may be rolled back).`
                : ioErrorSlots.length > 0
                  ? `Controlled recovery disabled: slot IO errors present (${unreadablePaths.join(', ')}).`
                  : `Controlled recovery disabled: no verified VALID save found (disk status=${res.kind}).`,
          };
          const detail = `${markerRead.detail ?? 'SHARED_TX_STATE_CORRUPT'}; ${preview.warning}`;
          markStorageUnavailable(this.storageKey, 'TX_STATE_CORRUPT', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'TX_STATE_CORRUPT',
            unreadableSlots: unreadablePaths,
            readOnlyBackup,
            corruptMarkerRecoveryPreview: preview,
          };
        }

        const existingMarker = markerRead.marker;
        const markerFloor = existingMarker
          ? maxNatString(existingMarker.confirmedRevision, existingMarker.expectedRevision)
          : null;
        const knownConfirmedFloor = maxNatString(persistedHistoryFloor, markerFloor);

        // Partial or full slot IO error -> preserve highest KNOWN confirmed floor (R5-01!)
        if (ioErrorSlots.length > 0) {
          const allUnreadable = ioErrorSlots.length >= SLOT_PATHS.length;
          const unreadablePaths = ioErrorSlots.map((s) => s.path);
          const classification: RecoveryFailureClassification = allUnreadable
            ? 'IO_UNAVAILABLE'
            : 'PARTIAL_IO_UNAVAILABLE';
          const readOnlyBackup: ReadOnlyBackupInfo | null =
            res.kind === 'VALID'
              ? {
                  revision: res.revision,
                  schemaVersion: res.schemaVersion,
                  epoch: res.epoch,
                  warnings: res.warnings,
                }
              : null;
          const reason = allUnreadable
            ? `All save slots unreadable due to storage IO error (${unreadablePaths.join(', ')}): ${ioErrorSlots.map((s) => `${s.path}: ${s.detail}`).join('; ')}`
            : `Partial save slot IO unavailable (${unreadablePaths.join(', ')}); cannot confirm highest physical revision; writes remain frozen${readOnlyBackup ? ` (read-only backup rev=${readOnlyBackup.revision})` : ''}`;

          // R5-01: Merge existing marker + persisted confirmed history floor + readable backup (strictly monotonic!)
          const merged = mergePriorHistory(
            existingMarker,
            knownConfirmedFloor,
            readOnlyBackup ? readOnlyBackup.revision : null
          );
          const preservedWriteVerify = existingMarker ? markerRequiresWriteVerification(existingMarker) : false;
          const shouldWriteOrUpgradeMarker =
            !existingMarker ||
            existingMarker.priorSaveHistory !== merged.priorSaveHistory ||
            existingMarker.confirmedRevision !== merged.confirmedRevision;
          if (shouldWriteOrUpgradeMarker) {
            if (hooks?.shouldCancelBeforeMutation?.()) {
              return {
                kind: 'CANCELLED',
                detail: 'Recovery cancelled before persisting partial-IO freeze marker (owner destroyed)',
                persistentMutationOccurred: probeMutationOccurred,
              };
            }
            hooks?.onMutationStarted?.();
            const now = Date.now();
            try {
              await this.writeSharedTxMarker({
                version: 1,
                storageKey: this.storageKey,
                txId: existingMarker ? existingMarker.txId : createTxId(),
                state: existingMarker ? existingMarker.state : 'FROZEN',
                expectedRevision: existingMarker ? existingMarker.expectedRevision : merged.confirmedRevision,
                targetRevision: existingMarker ? existingMarker.targetRevision : null,
                priorSaveHistory: merged.priorSaveHistory,
                confirmedRevision: merged.confirmedRevision,
                requiresWriteVerification: preservedWriteVerify,
                createdAtMs: existingMarker ? existingMarker.createdAtMs : now,
                updatedAtMs: now,
                reason,
              });
            } catch {
              // Local freeze still enforces fail-closed if marker persistence fails
            }
          }

          markStorageUnavailable(
            this.storageKey,
            allUnreadable ? 'STORAGE_IO_UNAVAILABLE' : 'PARTIAL_IO_UNAVAILABLE',
            reason
          );
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail: reason,
            recoveryClassification: classification,
            unreadableSlots: unreadablePaths,
            readOnlyBackup,
            corruptMarkerRecoveryPreview: null,
          };
        }

        // Automatic boot/reload (`clearPendingTxMarker: false`) MUST NOT silently clear an unrecovered
        // shared PENDING/UNCERTAIN/FROZEN marker so refreshing Tab A cannot let Tab B bypass recovery.
        if (existingMarker !== null && !clearPendingTxMarker) {
          const readOnlyBackup: ReadOnlyBackupInfo | null =
            res.kind === 'VALID'
              ? {
                  revision: res.revision,
                  schemaVersion: res.schemaVersion,
                  epoch: res.epoch,
                  warnings: res.warnings,
                }
              : null;
          const reason = `PENDING_RECOVERY_REQUIRED: shared save domain has unrecovered ${existingMarker.state} transaction (${existingMarker.txId}, priorHistory=${existingMarker.priorSaveHistory}, confirmedRev=${knownConfirmedFloor ?? 'none'}); explicit user recovery required before writing`;
          markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail: reason,
            recoveryClassification: 'PENDING_RECOVERY_REQUIRED',
            unreadableSlots: [],
            readOnlyBackup,
            corruptMarkerRecoveryPreview: null,
          };
        }

        // R5-01 + REV4-01: EMPTY scan is ONLY safe when BOTH history floor is null AND any existing marker
        // EXPLICITLY proves `CONFIRMED_EMPTY_INITIAL_CREATE` with null prior revisions!
        if (res.kind === 'EMPTY') {
          const disappearedWithHistory = knownConfirmedFloor !== null;
          const disappearedWithMarker =
            existingMarker !== null &&
            !(
              existingMarker.priorSaveHistory === 'CONFIRMED_EMPTY_INITIAL_CREATE' &&
              existingMarker.expectedRevision === null &&
              existingMarker.confirmedRevision === null
            );
          if (disappearedWithHistory || disappearedWithMarker) {
            const reason = `SAVE_DISAPPEARED_PENDING_RECOVERY: all save slots scanned EMPTY, but confirmed history floor=${knownConfirmedFloor ?? 'unknown'} / tx marker (${existingMarker?.txId ?? 'none'}, priorSaveHistory=${existingMarker?.priorSaveHistory ?? 'CONFIRMED_VALID'}) proves prior save existence; refusing silent unfreeze as empty save`;
            const needsFreezeMarker =
              existingMarker === null ||
              (knownConfirmedFloor !== null && existingMarker.confirmedRevision !== knownConfirmedFloor);
            if (needsFreezeMarker) {
              if (hooks?.shouldCancelBeforeMutation?.()) {
                return {
                  kind: 'CANCELLED',
                  detail: 'Recovery cancelled before persisting save-disappeared freeze marker (owner destroyed)',
                  persistentMutationOccurred: probeMutationOccurred,
                };
              }
              hooks?.onMutationStarted?.();
              const now = Date.now();
              try {
                await this.writeSharedTxMarker({
                  version: 1,
                  storageKey: this.storageKey,
                  txId: existingMarker ? existingMarker.txId : createTxId(),
                  state: existingMarker ? existingMarker.state : 'FROZEN',
                  expectedRevision: existingMarker ? existingMarker.expectedRevision : knownConfirmedFloor,
                  targetRevision: existingMarker ? existingMarker.targetRevision : null,
                  priorSaveHistory: 'CONFIRMED_VALID',
                  confirmedRevision: knownConfirmedFloor,
                  requiresWriteVerification: existingMarker ? markerRequiresWriteVerification(existingMarker) : false,
                  createdAtMs: existingMarker ? existingMarker.createdAtMs : now,
                  updatedAtMs: now,
                  reason,
                });
              } catch {
                // Local freeze still enforces fail-closed
              }
            }
            markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'SAVE_DISAPPEARED_PENDING_RECOVERY',
              unreadableSlots: [],
              readOnlyBackup: null,
              corruptMarkerRecoveryPreview: null,
            };
          }
        }

        // R5-01 + REV4-01: VALID scan with revision LOWER than confirmed historical floor (from EITHER
        // persisted SaveHistoryMeta OR SharedTxMarker) MUST NOT unfreeze! Exposes lower save read-only.
        if (res.kind === 'VALID' && knownConfirmedFloor !== null && natToBigInt(res.revision) < natToBigInt(knownConfirmedFloor)) {
          const readOnlyBackup: ReadOnlyBackupInfo = {
            revision: res.revision,
            schemaVersion: res.schemaVersion,
            epoch: res.epoch,
            warnings: res.warnings,
          };
          const reason = `REVISION_REGRESSION_PENDING_RECOVERY: scanned valid save revision (${res.revision}) is lower than confirmed historical revision floor (${knownConfirmedFloor}); refusing silent rollback or unfreeze`;
          const needsFreezeMarker =
            existingMarker === null || existingMarker.confirmedRevision !== knownConfirmedFloor;
          if (needsFreezeMarker) {
            if (hooks?.shouldCancelBeforeMutation?.()) {
              return {
                kind: 'CANCELLED',
                detail: 'Recovery cancelled before persisting revision-regression freeze marker (owner destroyed)',
                persistentMutationOccurred: probeMutationOccurred,
              };
            }
            hooks?.onMutationStarted?.();
            const now = Date.now();
            try {
              await this.writeSharedTxMarker({
                version: 1,
                storageKey: this.storageKey,
                txId: existingMarker ? existingMarker.txId : createTxId(),
                state: existingMarker ? existingMarker.state : 'FROZEN',
                expectedRevision: existingMarker ? existingMarker.expectedRevision : knownConfirmedFloor,
                targetRevision: existingMarker ? existingMarker.targetRevision : null,
                priorSaveHistory: 'CONFIRMED_VALID',
                confirmedRevision: knownConfirmedFloor,
                requiresWriteVerification: existingMarker ? markerRequiresWriteVerification(existingMarker) : false,
                createdAtMs: existingMarker ? existingMarker.createdAtMs : now,
                updatedAtMs: now,
                reason,
              });
            } catch {
              // Local freeze still enforces fail-closed
            }
          }
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', reason);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail: reason,
            recoveryClassification: 'REVISION_REGRESSION_PENDING_RECOVERY',
            unreadableSlots: [],
            readOnlyBackup,
            corruptMarkerRecoveryPreview: null,
          };
        }

        // R5-03 Check #2: Final owner cancellation guard right before ANY persistent mutation or completion!
        if (hooks?.shouldCancelBeforeMutation?.()) {
          return {
            kind: 'CANCELLED',
            detail: 'Recovery cancelled after scan before any persistent mutation (owner destroyed)',
            persistentMutationOccurred: probeMutationOccurred,
          };
        }

        // Only VALID or verified-safe EMPTY with 0 IO errors reaches here.
        if (res.kind === 'VALID' || res.kind === 'EMPTY') {
          const needsWriteVerification = existingMarker !== null && markerRequiresWriteVerification(existingMarker);

          // R5-02 (REWORK-07): Confirmed empty initial-create write-failure freeze CANNOT unfreeze via a
          // fixed-size synthetic probe! It MUST persist the caller's actual valid initial state via the
          // existing 3-slot + readback + monotonic history protocol; without a valid initialCommitState,
          // stay FROZEN (0 disk mutations) and NEVER falsely report EMPTY/recovered.
          if (res.kind === 'EMPTY' && needsWriteVerification && existingMarker !== null) {
            const initialValidationErrors =
              initialCommitState && typeof initialCommitState === 'object'
                ? validateSpikeState(initialCommitState)
                : ['missing initialCommitState'];
            if (!initialCommitState || initialValidationErrors.length > 0) {
              const reason = `WRITE_CAPABILITY_UNAVAILABLE: confirmed empty initial-create write-failure freeze requires a valid initial save state to persist and verify real write capability (${initialValidationErrors.join('; ')}); keeping storage frozen`;
              markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
              return {
                kind: 'STORAGE_UNAVAILABLE',
                detail: reason,
                recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE',
                unreadableSlots: [],
                readOnlyBackup: null,
                corruptMarkerRecoveryPreview: null,
              };
            }
            // Zero await gap between Check #2 and onMutationStarted() -> point of no return!
            hooks?.onMutationStarted?.();
            return this.executeSafeInitialSaveCommit(initialCommitState, existingMarker, persistedHistoryFloor);
          }

          const needsHistoryUpgrade =
            res.kind === 'VALID' &&
            (persistedHistoryFloor === null || natToBigInt(res.revision) > natToBigInt(persistedHistoryFloor));
          const willMutatePersistentState =
            existingMarker !== null || needsWriteVerification || needsHistoryUpgrade;

          // Zero await gap between Check #2 and onMutationStarted() -> point of no return!
          if (willMutatePersistentState) {
            hooks?.onMutationStarted?.();
          }

          // R5-02: Real write-failure freeze on VALID save executes zero-gain safe checkpoint commit!
          if (needsWriteVerification && existingMarker !== null && res.kind === 'VALID') {
            return this.executeSafeCheckpointCommit(
              res,
              existingMarker,
              knownConfirmedFloor,
              persistedHistoryFloor
            );
          }

          // R5-01: Persist monotonic SaveHistoryMeta if VALID save has a higher (or first-time) confirmed revision
          if (res.kind === 'VALID' && needsHistoryUpgrade) {
            try {
              await this.persistMonotonicHistoryMeta(res.revision, persistedHistoryFloor);
            } catch (err) {
              const reason = `HISTORY_STATE_WRITE_FAILED: verified VALID save rev=${res.revision}, but failed to persist monotonic save history metadata: ${errorMessage(err)}`;
              markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
              return {
                kind: 'STORAGE_UNAVAILABLE',
                detail: reason,
                recoveryClassification: 'HISTORY_STATE_WRITE_FAILED',
                unreadableSlots: [],
                readOnlyBackup: {
                  revision: res.revision,
                  schemaVersion: res.schemaVersion,
                  epoch: res.epoch,
                  warnings: res.warnings,
                },
                corruptMarkerRecoveryPreview: null,
              };
            }
          }

          if (existingMarker !== null) {
            try {
              await this.clearSharedTxMarker();
            } catch (err) {
              const reason = `TX_STATE_CLEAR_FAILED: recovery verified ${res.kind}, but failed to clear shared tx marker (${existingMarker.txId}): ${errorMessage(err)}`;
              markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
              return {
                kind: 'STORAGE_UNAVAILABLE',
                detail: reason,
                recoveryClassification: 'TX_STATE_CLEAR_FAILED',
                unreadableSlots: [],
                readOnlyBackup:
                  res.kind === 'VALID'
                    ? {
                        revision: res.revision,
                        schemaVersion: res.schemaVersion,
                        epoch: res.epoch,
                        warnings: res.warnings,
                      }
                    : null,
                corruptMarkerRecoveryPreview: null,
              };
            }
          }
          markStorageAvailable(this.storageKey);
        }
        return res;
      },
      (detail) => ({
        kind: 'STORAGE_UNAVAILABLE',
        detail,
        recoveryClassification: 'LOCK_UNAVAILABLE',
        unreadableSlots: [...SLOT_PATHS],
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
      })
    );
  }

  /**
   * REV4-03 + R5-01 + R5-03 Controlled Corrupt-Marker Recovery:
   * Executes inside the SAME exclusive lock. Checks owner cancellation BEFORE any read/probe AND AGAIN
   * immediately before clearing the corrupt marker. Re-verifies corrupt marker digest, 3-slot snapshot
   * digest, and monotonic confirmed history floor. Clears ONLY the corrupt marker (never touches save slots).
   */
  recoverFromCorruptTxMarker(
    confirmation: ControlledCorruptMarkerRecoveryConfirmation,
    hooks?: RecoveryLifecycleHooks
  ): Promise<SafeSaveLoadResult> {
    return this.withExclusiveLock<SafeSaveLoadResult>(
      async () => {
        let probeMutationOccurred = false;

        // R5-03 Check #1: Cancel immediately after acquiring lock BEFORE any probe, read, or mutation!
        if (hooks?.shouldCancelBeforeMutation?.()) {
          return {
            kind: 'CANCELLED',
            detail: 'Controlled corrupt-marker recovery cancelled after acquiring lock before any read or mutation (owner destroyed)',
            persistentMutationOccurred: false,
          };
        }
        if (hooks?.beforeRecoveryBody) {
          await hooks.beforeRecoveryBody();
          if (hooks.shouldCancelBeforeMutation?.()) {
            return {
              kind: 'CANCELLED',
              detail: 'Controlled corrupt-marker recovery cancelled before probe/scan after async wait (owner destroyed)',
              persistentMutationOccurred: false,
            };
          }
        }

        if (typeof this.port.probeStorage === 'function') {
          let probe: StorageProbeResult;
          try {
            probe = await this.port.probeStorage({
              shouldCancelBeforeMutation: hooks?.shouldCancelBeforeMutation,
              onMutationStarted: () => {
                probeMutationOccurred = true;
                hooks?.onMutationStarted?.();
              },
            });
          } catch (err) {
            const reason = `Persistent storage probe threw during corrupt-marker recovery: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'PROBE_FAILED',
              unreadableSlots: [...SLOT_PATHS],
              readOnlyBackup: null,
              corruptMarkerRecoveryPreview: null,
            };
          }
          if (probe.mutated === true && !probeMutationOccurred) {
            probeMutationOccurred = true;
            hooks?.onMutationStarted?.();
          }
          if (probe.cancelled === true && !probeMutationOccurred) {
            return {
              kind: 'CANCELLED',
              detail:
                probe.reason ??
                'Controlled corrupt-marker recovery cancelled before storage probe write (owner destroyed)',
              persistentMutationOccurred: false,
            };
          }
          if (!probe.available) {
            const reason = probe.reason ?? 'Persistent storage probe failed during corrupt-marker recovery';
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'PROBE_FAILED',
              unreadableSlots: [...SLOT_PATHS],
              readOnlyBackup: null,
              corruptMarkerRecoveryPreview: null,
            };
          }
          if (hooks?.shouldCancelBeforeMutation?.()) {
            return {
              kind: 'CANCELLED',
              detail: probeMutationOccurred
                ? 'Storage probe write/cleanup completed after owner destroy during corrupt-marker recovery; aborted before save-domain mutation'
                : 'Controlled corrupt-marker recovery cancelled after storage probe before save-domain scan (owner destroyed)',
              persistentMutationOccurred: probeMutationOccurred,
            };
          }
        }

        // Re-verify marker state inside lock (reject IO error, absent, valid, or concurrently altered marker)
        const markerRead = await this.readSharedTxMarker();
        if (markerRead.status === 'READ_IO_ERROR') {
          const detail = markerRead.detail ?? 'SHARED_TX_STATE_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'TX_STATE_UNREADABLE',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }
        if (markerRead.status !== 'CORRUPT') {
          const detail = `CONCURRENT_RECOVERY_STATE_CHANGED: expected CORRUPT marker before discarding, but observed status=${markerRead.status}`;
          markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'CONCURRENT_RECOVERY_STATE_CHANGED',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }
        if (markerRead.rawSha256 !== confirmation.expectedCorruptMarkerSha256) {
          const detail = `CONCURRENT_RECOVERY_STATE_CHANGED: corrupt marker digest changed between preview and confirmation`;
          markStorageUnavailable(this.storageKey, 'TX_STATE_CORRUPT', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'CONCURRENT_RECOVERY_STATE_CHANGED',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }

        // R5-01: Verify monotonic confirmed history floor as well
        const historyRead = await this.readSaveHistoryMeta();
        if (historyRead.status === 'READ_IO_ERROR') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'HISTORY_STATE_UNREADABLE',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }
        if (historyRead.status === 'CORRUPT') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_CORRUPT';
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'HISTORY_STATE_CORRUPT',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }
        const persistedHistoryFloor = historyRead.meta?.confirmedRevision ?? null;

        // Re-scan ALL 3 save slots inside lock & reject IO errors, non-VALID saves, or concurrent disk changes
        const { res, ioErrorSlots, slotsSnapshotSha256 } = await this.scanAllSlotsObserved();
        if (ioErrorSlots.length > 0) {
          const allUnreadable = ioErrorSlots.length >= SLOT_PATHS.length;
          const unreadablePaths = ioErrorSlots.map((s) => s.path);
          const detail = `Controlled corrupt-marker recovery refused: slot IO error (${unreadablePaths.join(', ')})`;
          markStorageUnavailable(
            this.storageKey,
            allUnreadable ? 'STORAGE_IO_UNAVAILABLE' : 'PARTIAL_IO_UNAVAILABLE',
            detail
          );
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: allUnreadable ? 'IO_UNAVAILABLE' : 'PARTIAL_IO_UNAVAILABLE',
            unreadableSlots: unreadablePaths,
            readOnlyBackup:
              res.kind === 'VALID'
                ? {
                    revision: res.revision,
                    schemaVersion: res.schemaVersion,
                    epoch: res.epoch,
                    warnings: res.warnings,
                  }
                : null,
            corruptMarkerRecoveryPreview: null,
          };
        }

        if (res.kind !== 'VALID') {
          const detail = `CORRUPT_MARKER_NO_VALID_SAVE: controlled corrupt-marker recovery requires a verified VALID save, but disk scanned ${res.kind}`;
          markStorageUnavailable(this.storageKey, 'TX_STATE_CORRUPT', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'CORRUPT_MARKER_NO_VALID_SAVE',
            unreadableSlots: [],
            readOnlyBackup: null,
            corruptMarkerRecoveryPreview: null,
          };
        }

        if (persistedHistoryFloor !== null && natToBigInt(res.revision) < natToBigInt(persistedHistoryFloor)) {
          const detail = `REVISION_REGRESSION_PENDING_RECOVERY: controlled corrupt-marker recovery refused because scanned rev=${res.revision} is lower than confirmed historical floor (${persistedHistoryFloor})`;
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'REVISION_REGRESSION_PENDING_RECOVERY',
            unreadableSlots: [],
            readOnlyBackup: {
              revision: res.revision,
              schemaVersion: res.schemaVersion,
              epoch: res.epoch,
              warnings: res.warnings,
            },
            corruptMarkerRecoveryPreview: null,
          };
        }

        if (
          res.revision !== confirmation.expectedValidRevision ||
          slotsSnapshotSha256 !== confirmation.expectedSlotsSnapshotSha256
        ) {
          const detail = `CONCURRENT_RECOVERY_STATE_CHANGED: save slots changed between preview (rev=${confirmation.expectedValidRevision}) and confirmation (rev=${res.revision}); please re-check before confirming`;
          markStorageUnavailable(this.storageKey, 'TX_STATE_CORRUPT', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'CONCURRENT_RECOVERY_STATE_CHANGED',
            unreadableSlots: [],
            readOnlyBackup: {
              revision: res.revision,
              schemaVersion: res.schemaVersion,
              epoch: res.epoch,
              warnings: res.warnings,
            },
            corruptMarkerRecoveryPreview: {
              canConfirmRecovery: true,
              corruptMarkerSha256: markerRead.rawSha256 ?? '',
              verifiedRevision: res.revision,
              slotsSnapshotSha256,
              warning: `Disk state changed concurrently; confirm again to recover verified save rev=${res.revision}.`,
            },
          };
        }

        // R5-03 Check #2: Final owner cancellation guard with ZERO await gap before persistent mutation!
        if (hooks?.shouldCancelBeforeMutation?.()) {
          return {
            kind: 'CANCELLED',
            detail: 'Controlled corrupt-marker recovery cancelled right before clearing tx marker (owner destroyed)',
            persistentMutationOccurred: probeMutationOccurred,
          };
        }
        hooks?.onMutationStarted?.();

        // Persist monotonic history metadata if needed before clearing corrupt marker
        if (persistedHistoryFloor === null || natToBigInt(res.revision) > natToBigInt(persistedHistoryFloor)) {
          try {
            await this.persistMonotonicHistoryMeta(res.revision, persistedHistoryFloor);
          } catch (err) {
            const detail = `HISTORY_STATE_WRITE_FAILED: verified VALID save rev=${res.revision}, but failed to persist monotonic history metadata: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail,
              recoveryClassification: 'HISTORY_STATE_WRITE_FAILED',
              unreadableSlots: [],
              readOnlyBackup: {
                revision: res.revision,
                schemaVersion: res.schemaVersion,
                epoch: res.epoch,
                warnings: res.warnings,
              },
              corruptMarkerRecoveryPreview: null,
            };
          }
        }

        // All invariants verified inside lock -> clear ONLY the corrupt tx marker (zero save slot modifications!)
        try {
          await this.clearSharedTxMarker();
        } catch (err) {
          const detail = `TX_STATE_CLEAR_FAILED: verified VALID save rev=${res.revision}, but failed to clear corrupt tx marker: ${errorMessage(err)}`;
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail,
            recoveryClassification: 'TX_STATE_CLEAR_FAILED',
            unreadableSlots: [],
            readOnlyBackup: {
              revision: res.revision,
              schemaVersion: res.schemaVersion,
              epoch: res.epoch,
              warnings: res.warnings,
            },
            corruptMarkerRecoveryPreview: null,
          };
        }

        markStorageAvailable(this.storageKey);
        return res;
      },
      (detail) => ({
        kind: 'STORAGE_UNAVAILABLE',
        detail,
        recoveryClassification: 'LOCK_UNAVAILABLE',
        unreadableSlots: [...SLOT_PATHS],
        readOnlyBackup: null,
        corruptMarkerRecoveryPreview: null,
      })
    );
  }

  /**
   * Serializes commit across in-process callers and same-origin browser tabs with a durable
   * write-ahead shared transaction marker and monotonic confirmed-revision history metadata
   * inside the exclusive lock.
   */
  commit(
    state: Readonly<SpikeGameState>,
    expectedRevision: Nat | null,
    hooks?: CommitLifecycleHooks
  ): Promise<SafeSaveCommitResult> {
    return this.withExclusiveLock<SafeSaveCommitResult>(
      async () => {
        // P1-02 N3: Cancel queued tasks BEFORE starting any physical read or write
        if (hooks?.shouldCancelBeforeStart?.()) {
          return {
            kind: 'CANCELLED',
            detail: 'Commit cancelled before physical execution started (owner destroyed or halted)',
          };
        }

        // Local realm fast-fail if already frozen in this JS realm
        const currentHealth = getOrInitHealth(this.storageKey);
        if (currentHealth.health === 'STORAGE_UNAVAILABLE') {
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail:
              currentHealth.reason ??
              `Storage frozen (${currentHealth.freezeCode}); explicit verified loadSafe() recovery required`,
          };
        }

        // A02 Requirement 1 & 2: Read REAL persisted shared tx marker inside the exclusive lock.
        const markerRead = await this.readSharedTxMarker();
        if (markerRead.status === 'READ_IO_ERROR') {
          const detail = markerRead.detail ?? 'SHARED_TX_STATE_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return { kind: 'STORAGE_UNAVAILABLE', detail };
        }
        if (markerRead.status === 'CORRUPT') {
          const detail = markerRead.detail ?? 'SHARED_TX_STATE_CORRUPT';
          markStorageUnavailable(this.storageKey, 'TX_STATE_CORRUPT', detail);
          return { kind: 'STORAGE_UNAVAILABLE', detail };
        }
        if (markerRead.marker !== null) {
          const m = markerRead.marker;
          const reason = `SHARED_FREEZE_PENDING_RECOVERY: shared save domain has unrecovered ${m.state} marker (${m.txId}, targetRev=${m.targetRevision ?? 'unknown'}); explicit verified loadSafe() required (${m.reason ?? 'no detail'})`;
          markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
          return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
        }

        // R5-01: Read persisted monotonic confirmed-revision history metadata inside lock (fail-closed!)
        const historyRead = await this.readSaveHistoryMeta();
        if (historyRead.status === 'READ_IO_ERROR') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_UNREADABLE';
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', detail);
          return { kind: 'STORAGE_UNAVAILABLE', detail };
        }
        if (historyRead.status === 'CORRUPT') {
          const detail = historyRead.detail ?? 'SAVE_HISTORY_META_CORRUPT';
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', detail);
          return { kind: 'STORAGE_UNAVAILABLE', detail };
        }
        const persistedHistoryFloor = historyRead.meta?.confirmedRevision ?? null;

        // Re-verify storage health before writing
        if (typeof this.port.probeStorage === 'function') {
          let probe: StorageProbeResult;
          try {
            probe = await this.port.probeStorage({
              shouldCancelBeforeMutation: hooks?.shouldCancelBeforeStart,
            });
          } catch (err) {
            const reason = `Persistent storage probe threw during commit: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
          }
          if (probe.cancelled === true && probe.mutated !== true) {
            return {
              kind: 'CANCELLED',
              detail: probe.reason ?? 'Commit cancelled before storage probe write (owner destroyed or halted)',
            };
          }
          if (!probe.available) {
            const reason = probe.reason ?? 'Persistent storage probe failed during commit';
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
          }
        }

        // Transition QUEUED -> STARTED (lock held, shared marker clean, history readable, storage healthy, owner alive)
        hooks?.onStarted?.();
        if (hooks?.beforeCommitBody) {
          await hooks.beforeCommitBody();
        }

        const txId = createTxId();
        const txCreatedAtMs = Date.now();
        const targetRevision = computeTargetRevision(expectedRevision);
        const fatalErrors: FilePortIoError[] = [];
        let markerWritten = false;
        let markerWriteError: unknown = null;
        let historyRegressionError: string | null = null;
        const txStateBox: { pendingMarker: SharedTxMarker | null } = { pendingMarker: null };

        // Observe underlying FilePortIoErrors and enforce BOTH monotonic history floor AND write-ahead
        // PENDING marker right before any physical slot mutation without modifying backend SpikeFileSaveRepository.
        const observedPort: FilePort = {
          kind: this.port.kind,
          storageKey: this.port.storageKey,
          probeStorage: this.port.probeStorage ? (opts) => this.port.probeStorage!(opts) : undefined,
          read: async (p) => {
            try {
              return await this.port.read(p);
            } catch (err) {
              if (err instanceof FilePortIoError && err.code === 'STORAGE_UNAVAILABLE') {
                fatalErrors.push(err);
              }
              throw err;
            }
          },
          write: async (p, text) => {
            // At this point SpikeFileSaveRepository has ALREADY read all 3 slots with 0 IO errors
            // and confirmed disk top revision === expectedRevision (or all 3 slots absent if expectedRevision===null).
            // Note: ordinary stale-revision CONFLICT never enters write()!
            if (
              persistedHistoryFloor !== null &&
              (expectedRevision === null || natToBigInt(expectedRevision) < natToBigInt(persistedHistoryFloor))
            ) {
              historyRegressionError = `REVISION_REGRESSION_PENDING_RECOVERY: refusing commit at expectedRevision=${expectedRevision ?? 'null'} because persisted confirmed history floor is ${persistedHistoryFloor}`;
              throw new FilePortIoError('STORAGE_UNAVAILABLE', p, historyRegressionError);
            }

            if (!markerWritten) {
              const priorSaveHistory: PriorSaveHistory =
                expectedRevision === null && persistedHistoryFloor === null
                  ? 'CONFIRMED_EMPTY_INITIAL_CREATE'
                  : 'CONFIRMED_VALID';
              const confirmedRevision: string | null = maxNatString(
                persistedHistoryFloor,
                expectedRevision === null ? null : String(expectedRevision)
              );
              const pendingMarker: SharedTxMarker = {
                version: 1,
                storageKey: this.storageKey,
                txId,
                state: 'PENDING',
                expectedRevision,
                targetRevision,
                priorSaveHistory,
                confirmedRevision,
                requiresWriteVerification: false,
                createdAtMs: txCreatedAtMs,
                updatedAtMs: Date.now(),
                reason: `Pending save slot write (${p})`,
              };
              try {
                await this.writeSharedTxMarker(pendingMarker);
                markerWritten = true;
                txStateBox.pendingMarker = pendingMarker;
              } catch (err) {
                markerWriteError = err;
                throw new FilePortIoError(
                  'STORAGE_UNAVAILABLE',
                  '__tx_state__',
                  `SHARED_TX_MARKER_WRITE_FAILED: ${errorMessage(err)}`
                );
              }
            }
            try {
              await this.port.write(p, text);
            } catch (err) {
              if (err instanceof FilePortIoError && FATAL_STORAGE_ERROR_CODES.has(err.code)) {
                fatalErrors.push(err);
              }
              throw err;
            }
          },
          remove: (p) => this.port.remove(p),
          list: (dir) => this.port.list(dir),
        };

        const repo = new SpikeFileSaveRepository(observedPort);
        let result: SpikeCommitResult;
        try {
          result = await repo.commit(state, expectedRevision);
        } catch (unexpectedErr) {
          // A02 Requirement 5: Preserve durable marker & monotonic confirmed history on unexpected exception.
          const pendingSnapshot = txStateBox.pendingMarker;
          if (markerWritten && pendingSnapshot !== null) {
            const reason = `Unexpected commit exception after pending marker (${txId}): ${errorMessage(unexpectedErr)}`;
            try {
              await this.writeSharedTxMarker({
                ...pendingSnapshot,
                state: 'UNCERTAIN',
                confirmedRevision: maxNatString(persistedHistoryFloor, pendingSnapshot.confirmedRevision),
                requiresWriteVerification: fatalErrors.length > 0,
                updatedAtMs: Date.now(),
                reason,
              });
            } catch {
              // Durable PENDING marker remains on disk
            }
            markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
          }
          throw unexpectedErr;
        }

        // R5-01: Regression intercepted before touching any save slot -> freeze with confirmed floor!
        if (historyRegressionError !== null) {
          try {
            await this.writeSharedTxMarker({
              version: 1,
              storageKey: this.storageKey,
              txId,
              state: 'FROZEN',
              expectedRevision: persistedHistoryFloor,
              targetRevision: null,
              priorSaveHistory: 'CONFIRMED_VALID',
              confirmedRevision: persistedHistoryFloor,
              requiresWriteVerification: false,
              createdAtMs: txCreatedAtMs,
              updatedAtMs: Date.now(),
              reason: historyRegressionError,
            });
          } catch {
            // Local freeze still enforces fail-closed
          }
          markStorageUnavailable(this.storageKey, 'SAVE_HISTORY_MISMATCH', historyRegressionError);
          return { kind: 'STORAGE_UNAVAILABLE', detail: historyRegressionError };
        }

        // A02 Requirement 3: Marker write failed BEFORE any save slot write was attempted -> deterministic STORAGE_UNAVAILABLE.
        if (markerWriteError !== null) {
          const reason = `SHARED_TX_MARKER_WRITE_FAILED: aborted before save slot write (0 slot writes): ${errorMessage(markerWriteError)}`;
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
          return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
        }

        // A02 Requirement 4 + R5-01 Requirement 7: Persist monotonic SaveHistoryMeta INSIDE lock BEFORE
        // clearing PENDING marker and BEFORE returning COMMITTED! Metadata confirmation failure MUST NOT return COMMITTED.
        if (result.kind === 'COMMITTED') {
          const confirmedFloorAfterCommit = maxNatString(persistedHistoryFloor, result.revision)!;
          try {
            await this.persistMonotonicHistoryMeta(result.revision, persistedHistoryFloor);
          } catch (err) {
            const isFatalHist =
              err instanceof FilePortIoError && FATAL_STORAGE_ERROR_CODES.has(err.code);
            const reason = `COMMIT_HISTORY_META_WRITE_FAILED: save slot ${result.slot} committed & readback-verified (rev=${result.revision}), but failed to confirm monotonic save history metadata (${txId}); refusing false COMMITTED: ${errorMessage(err)}`;
            try {
              await this.writeSharedTxMarker({
                version: 1,
                storageKey: this.storageKey,
                txId,
                state: 'UNCERTAIN',
                expectedRevision: result.revision,
                targetRevision: null,
                priorSaveHistory: 'CONFIRMED_VALID',
                confirmedRevision: confirmedFloorAfterCommit,
                requiresWriteVerification: isFatalHist,
                createdAtMs: txCreatedAtMs,
                updatedAtMs: Date.now(),
                reason,
              });
            } catch {
              // Pre-written PENDING marker remains durably on disk
            }
            markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
            return { kind: 'UNCERTAIN', detail: reason };
          }

          if (markerWritten) {
            try {
              await this.clearSharedTxMarker();
            } catch (err) {
              const reason = `COMMIT_TX_MARKER_CLEAR_FAILED: save slot ${result.slot} committed & readback-verified (rev=${result.revision}), but failed to clear shared pending tx marker (${txId}); explicit loadSafe() recovery required: ${errorMessage(err)}`;
              markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
              return { kind: 'UNCERTAIN', detail: reason };
            }
          }
          return result;
        }

        // A02 Requirement 5 & 6 + R5-01 + R5-02: UNCERTAIN MUST preserve monotonic history floor and
        // never promote unconfirmed targetRevision to confirmedRevision!
        if (result.kind === 'UNCERTAIN') {
          const reason = `Uncertain commit requires explicit verified loadSafe() recovery before any further write: ${result.detail}`;
          const pendingSnapshot = txStateBox.pendingMarker;
          const confirmedRevision = maxNatString(
            persistedHistoryFloor,
            pendingSnapshot !== null
              ? pendingSnapshot.confirmedRevision
              : expectedRevision !== null
                ? String(expectedRevision)
                : null
          );
          const priorSaveHistory: PriorSaveHistory =
            confirmedRevision !== null
              ? 'CONFIRMED_VALID'
              : pendingSnapshot !== null
                ? pendingSnapshot.priorSaveHistory
                : 'UNKNOWN';
          try {
            await this.writeSharedTxMarker({
              version: 1,
              storageKey: this.storageKey,
              txId,
              state: 'UNCERTAIN',
              expectedRevision,
              targetRevision,
              priorSaveHistory,
              confirmedRevision,
              requiresWriteVerification: fatalErrors.length > 0,
              createdAtMs: txCreatedAtMs,
              updatedAtMs: Date.now(),
              reason,
            });
          } catch {
            // If markerWritten was true, the pre-written PENDING marker remains durably on disk.
          }
          markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
          return result;
        }

        // REV4-04 + R5-01 + R5-02: Conservative freeze on real storage IO/quota write failures,
        // preserving monotonic confirmed floor and requiring real write verification before unfreeze!
        if (fatalErrors.length > 0 && result.kind === 'FAILED') {
          const fatal = fatalErrors[0];
          const reason = `Runtime storage write failure (${fatal.code}): ${fatal.message}. Free storage space or restore permissions, then trigger explicit storage recovery.`;
          const pendingSnapshot = txStateBox.pendingMarker;
          const confirmedRevision = maxNatString(
            persistedHistoryFloor,
            pendingSnapshot !== null
              ? pendingSnapshot.confirmedRevision
              : expectedRevision !== null
                ? String(expectedRevision)
                : null
          );
          const priorSaveHistory: PriorSaveHistory =
            confirmedRevision !== null
              ? 'CONFIRMED_VALID'
              : pendingSnapshot !== null
                ? pendingSnapshot.priorSaveHistory
                : 'UNKNOWN';
          try {
            await this.writeSharedTxMarker({
              version: 1,
              storageKey: this.storageKey,
              txId,
              state: 'FROZEN',
              expectedRevision,
              targetRevision,
              priorSaveHistory,
              confirmedRevision,
              requiresWriteVerification: true,
              createdAtMs: txCreatedAtMs,
              updatedAtMs: Date.now(),
              reason,
            });
          } catch {
            // Pre-written PENDING marker remains durably on disk
          }
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
          return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
        }

        // Deterministic non-fatal FAILED (e.g., INJECTED_PRE_WRITE / INJECTED_PARTIAL_WRITE where
        // backend rescan confirmed 0 IO errors and unchanged revision) -> clear marker cleanly without promoting targetRevision.
        if (result.kind === 'FAILED' && markerWritten) {
          try {
            await this.clearSharedTxMarker();
          } catch (err) {
            const reason = `TX_MARKER_CLEAR_FAILED_AFTER_FAILED_COMMIT: ${result.detail}; marker clear failed (${txId}): ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
            return { kind: 'UNCERTAIN', detail: reason };
          }
        }

        // CONFLICT never reaches observedPort.write (markerWritten === false) -> returns cleanly.
        return result;
      },
      (detail) => ({ kind: 'STORAGE_UNAVAILABLE', detail })
    );
  }
}

class CoordinatorTaskError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('Coordinator task error');
    this.cause = cause;
  }
}
