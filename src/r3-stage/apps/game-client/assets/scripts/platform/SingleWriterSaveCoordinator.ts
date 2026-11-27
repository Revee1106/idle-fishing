/**
 * Application-layer Single-Writer Save Coordinator (Design Doc 11 / Interface 19 / REWORK-03).
 *
 * Distinct responsibilities (NEVER conflated):
 * 1. Shared Storage Fault Isolation & Recovery Barrier (P1-01 A02 & P1-02 A03):
 *    Tracks storage health & freeze cause per shared `storageKey` namespace across ALL
 *    coordinator instances:
 *    - Any real storage failure (probe failure, missing API, WRITE_IO_ERROR, QUOTA_EXCEEDED,
 *      cross-tab lock acquisition failure) OR ANY `UNCERTAIN` commit freezes the ENTIRE shared
 *      namespace so NO other coordinator instance or direct commit entry can write until an
 *      explicit, complete `loadSafe()` succeeds.
 *    - `loadSafe()` strictly distinguishes:
 *      (a) FILE_NOT_FOUND (`read() === null`) -> empty slot, safe
 *      (b) INVALID_CONTENT (all slot reads succeeded, bytes corrupt) -> corrupt slot; valid
 *          older backup can be safely promoted because no slot is IO-unreadable
 *      (c) IO_UNAVAILABLE / PARTIAL_IO_UNAVAILABLE (1, 2, or 3 slots threw an IO error) ->
 *          highest physical revision CANNOT be confirmed; namespace REMAINS FROZEN
 *          (`STORAGE_UNAVAILABLE`), NEVER unfreezes on older backup, and exposes optional
 *          `readOnlyBackup` metadata for read-only inspection only
 *      (d) RECOVERY_VERIFICATION_FAILED (probe failed / CORRUPT / UNSUPPORTED) -> stays frozen
 *          if previously frozen, never marks writable.
 *    - Ordinary deterministic single-attempt faults (`INJECTED_PRE_WRITE`, `INJECTED_PARTIAL_WRITE`,
 *      `CONFLICT`) return `FAILED`/`CONFLICT` without permanently freezing healthy storage.
 * 2. Task Cancellation / Ownership Boundary (P1-02 N3):
 *    Checks `hooks.shouldCancelBeforeStart()` AFTER acquiring locks and BEFORE any physical read/write.
 *    `QUEUED` tasks cancelled before start return `CANCELLED` with 0 reads/writes; `STARTED` tasks
 *    run to completion without false cancellation.
 * 3. Cross-Tab Linearizable Mutual Exclusion (P0 A01 & P2 A05):
 *    For browser persistent storage (`browser:*` in browser context), acquires an exclusive W3C
 *    Web Lock (`navigator.locks.request`) paired with linearizable IndexedDB storage (BrowserFilePort).
 *    Errors thrown inside the already-locked task body are rethrown as task errors (`CoordinatorTaskError`)
 *    and NEVER misclassified as `CROSS_TAB_LOCK_REJECTED` (A05). Missing/rejected Web Locks fail
 *    closed with `STORAGE_UNAVAILABLE` and 0 writes.
 * 4. Production Safety (P1-03 A04):
 *    No destructive `clearSlotsForTest()` method is exposed on the coordinator.
 */
import {
  SLOT_PATHS,
  SpikeFileSaveRepository,
  type Nat,
  type SpikeCommitResult,
  type SpikeGameState,
  type SpikeLoadResult,
} from '@idle-fishing/game-core';
import type { FilePort, StorageHealthState } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

export type RecoveryFailureClassification =
  | 'PROBE_FAILED'
  | 'IO_UNAVAILABLE'
  | 'PARTIAL_IO_UNAVAILABLE'
  | 'LOCK_UNAVAILABLE';

export interface ReadOnlyBackupInfo {
  readonly revision: Nat;
  readonly schemaVersion: number;
  readonly epoch: string;
  readonly warnings: readonly string[];
}

export type SafeSaveLoadResult =
  | SpikeLoadResult
  | {
      readonly kind: 'STORAGE_UNAVAILABLE';
      readonly detail: string;
      readonly recoveryClassification?: RecoveryFailureClassification;
      readonly unreadableSlots?: readonly string[];
      readonly readOnlyBackup?: ReadOnlyBackupInfo | null;
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
  | 'CROSS_TAB_LOCK_UNAVAILABLE';

interface NamespaceHealthRecord {
  health: StorageHealthState;
  freezeCode: NamespaceFreezeCode;
  reason: string | null;
}

const namespaceQueues = new Map<string, Promise<void>>();
const namespaceHealth = new Map<string, NamespaceHealthRecord>();
const anonymousPortIds = new WeakMap<FilePort, string>();
let nextAnonymousId = 1;

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

  /**
   * Acquires BOTH the in-process namespace queue AND (for browser persistent storage)
   * the cross-tab W3C Web Lock (`navigator.locks.request`).
   *
   * A05 Fix: Exceptions thrown INSIDE the locked `task()` callback are wrapped in
   * `CoordinatorTaskError` and rethrown as real task exceptions — NEVER misclassified
   * as `CROSS_TAB_LOCK_REJECTED` and NEVER falsely freezing healthy storage.
   * Only genuine Web Locks unavailability or lock-acquisition rejection fails closed
   * with `STORAGE_UNAVAILABLE`.
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
   * Probes storage health and scans ALL 3 save slots inside the exclusive lock.
   *
   * P1-02 (A03) Recovery Gate:
   * - Distinguishes FILE_NOT_FOUND (`null`), INVALID_CONTENT (corrupt bytes),
   *   IO_UNAVAILABLE / PARTIAL_IO_UNAVAILABLE (slot read threw IO error), and
   *   RECOVERY_VERIFICATION_FAILED (probe failed / CORRUPT / UNSUPPORTED).
   * - Unfreezes (`AVAILABLE`) ONLY when probe succeeds AND zero slots experienced IO errors
   *   AND the repository result is `VALID` or `EMPTY`.
   * - If ANY slot fails to read with an IO error (even if an older backup slot is valid),
   *   the highest physical revision cannot be confirmed: the namespace STAYS FROZEN
   *   (`STORAGE_UNAVAILABLE`) and returns optional `readOnlyBackup` metadata without
   *   granting write authorization.
   */
  loadSafe(): Promise<SafeSaveLoadResult> {
    return this.withExclusiveLock<SafeSaveLoadResult>(
      async () => {
        if (typeof this.port.probeStorage === 'function') {
          let probe: { readonly available: boolean; readonly reason: string | null };
          try {
            probe = await this.port.probeStorage();
          } catch (err) {
            const reason = `Persistent storage probe threw: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return {
              kind: 'STORAGE_UNAVAILABLE',
              detail: reason,
              recoveryClassification: 'PROBE_FAILED',
              unreadableSlots: [...SLOT_PATHS],
              readOnlyBackup: null,
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
            };
          }
        }

        // Observe EVERY slot read so partial IO failures are never mistaken for missing/corrupt files
        const ioErrorSlots: { path: string; detail: string }[] = [];
        const observedPort: FilePort = {
          kind: this.port.kind,
          storageKey: this.port.storageKey,
          probeStorage: this.port.probeStorage ? () => this.port.probeStorage!() : undefined,
          read: async (p) => {
            try {
              return await this.port.read(p);
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
          };
        }

        // All 3 slots were physically readable (either present or cleanly ENOENT/null).
        // Only VALID or EMPTY authorizes unlocking the namespace for writes.
        if (res.kind === 'VALID' || res.kind === 'EMPTY') {
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
      })
    );
  }

  /**
   * Serializes commit across in-process callers and same-origin browser tabs.
   * - P1-02 (N3): Checks hooks.shouldCancelBeforeStart() AFTER acquiring lock and BEFORE any read/write.
   * - P1-01 (A02): Honors shared namespace freeze (STORAGE_IO_UNAVAILABLE, PARTIAL_IO_UNAVAILABLE,
   *   CROSS_TAB_LOCK_UNAVAILABLE, AND UNCERTAIN_WRITE_PENDING_RECOVERY) across ALL coordinator
   *   instances sharing `storageKey` until explicit complete `loadSafe()` succeeds.
   * - Any `UNCERTAIN` result from `SpikeFileSaveRepository.commit()` immediately freezes the shared
   *   namespace before returning `UNCERTAIN` so no other coordinator instance can write blindly.
   * - Preserves ordinary deterministic single-attempt failures (INJECTED_PRE_WRITE /
   *   INJECTED_PARTIAL_WRITE / CONFLICT) without freezing healthy storage.
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

        // P1-01 (N1 + A02): Honor shared namespace freeze across ALL coordinator instances
        const currentHealth = getOrInitHealth(this.storageKey);
        if (currentHealth.health === 'STORAGE_UNAVAILABLE') {
          return {
            kind: 'STORAGE_UNAVAILABLE',
            detail:
              currentHealth.reason ??
              `Storage frozen (${currentHealth.freezeCode}); explicit verified loadSafe() recovery required`,
          };
        }

        // Re-verify storage health before writing
        if (typeof this.port.probeStorage === 'function') {
          let probe: { readonly available: boolean; readonly reason: string | null };
          try {
            probe = await this.port.probeStorage();
          } catch (err) {
            const reason = `Persistent storage probe threw during commit: ${errorMessage(err)}`;
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
          }
          if (!probe.available) {
            const reason = probe.reason ?? 'Persistent storage probe failed during commit';
            markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
            return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
          }
        }

        // Transition QUEUED -> STARTED (lock held, storage healthy, owner alive)
        hooks?.onStarted?.();
        if (hooks?.beforeCommitBody) {
          await hooks.beforeCommitBody();
        }

        // Observe underlying FilePortIoErrors without modifying backend SpikeFileSaveRepository
        const fatalErrors: FilePortIoError[] = [];
        const observedPort: FilePort = {
          kind: this.port.kind,
          storageKey: this.port.storageKey,
          probeStorage: this.port.probeStorage ? () => this.port.probeStorage!() : undefined,
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
        const result = await repo.commit(state, expectedRevision);

        // P1-01 (A02): UNCERTAIN write MUST freeze the ENTIRE shared storage namespace so no
        // other coordinator instance or direct commit entry can write until explicit verified loadSafe().
        if (result.kind === 'UNCERTAIN') {
          const reason = `Uncertain commit requires explicit verified loadSafe() recovery before any further write: ${result.detail}`;
          markStorageUnavailable(this.storageKey, 'UNCERTAIN_WRITE_PENDING_RECOVERY', reason);
          return result;
        }

        if (fatalErrors.length > 0 && result.kind === 'FAILED') {
          const fatal = fatalErrors[0];
          const reason = `Runtime storage write failure (${fatal.code}): ${fatal.message}`;
          markStorageUnavailable(this.storageKey, 'STORAGE_IO_UNAVAILABLE', reason);
          return { kind: 'STORAGE_UNAVAILABLE', detail: reason };
        }
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
