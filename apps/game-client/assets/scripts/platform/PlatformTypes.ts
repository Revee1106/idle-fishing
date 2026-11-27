/**
 * FE-000 / SPIKE-001 Platform adapter interfaces aligned with docs/interfaces/19.
 * Distinguishes runtime hosts explicitly so Node/Mock/Web never masquerade as real WeChat.
 */

export type RuntimeEnvKind = 'WECHAT_DEVICE' | 'WECHAT_DEVTOOLS' | 'WECHAT_MOCK' | 'WEB' | 'NODE';

/** Persistent storage health state, strictly distinct from save-slot content state (EMPTY/VALID/CORRUPT/UNSUPPORTED). */
export type StorageHealthState = 'AVAILABLE' | 'STORAGE_UNAVAILABLE';

export interface StorageProbeOptions {
  /**
   * Optional owner cancellation predicate checked right before any persistent probe write
   * with zero await gap between check and mutation start (R5-03 / REWORK-07).
   */
  readonly shouldCancelBeforeMutation?: () => boolean;
  /**
   * Invoked synchronously immediately before the first persistent probe write begins.
   */
  readonly onMutationStarted?: () => void;
}

export interface StorageProbeResult {
  readonly available: boolean;
  readonly reason: string | null;
  /** True ONLY when cancelled before any persistent probe mutation started (0 put/delete side effects). */
  readonly cancelled?: boolean;
  /** True when the probe actually initiated a persistent write/mutation during this call. */
  readonly mutated?: boolean;
}

/** Read-only report for legacy experimental localStorage saves (never auto-migrated, resurrected, or deleted). */
export interface LegacyLocalStorageStatus {
  readonly detected: boolean;
  readonly keys: readonly string[];
  readonly policy: 'DETECTED_IGNORED_NO_AUTO_MIGRATION' | 'NONE' | 'UNINSPECTABLE';
  readonly detail: string | null;
}

export type VerificationStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

export interface VerificationCaseResult {
  readonly id: string;
  readonly name: string;
  readonly status: VerificationStatus;
  readonly env: RuntimeEnvKind;
  readonly detail: string;
  readonly durationMs: number;
}

export interface FilePort {
  readonly kind:
    | 'WECHAT_FS'
    | 'BROWSER_INDEXED_DB'
    | 'BROWSER_STORAGE_UNAVAILABLE'
    | 'BROWSER_LOCAL_STORAGE_FALLBACK'
    | 'MEMORY'
    | 'FAULT_WRAPPER';
  /** Stable single-runtime storage namespace key used by SingleWriterSaveCoordinator. */
  readonly storageKey?: string;
  /** Optional explicit persistence availability check (sync or async; unavailable storage is never EMPTY). */
  probeStorage?(options?: StorageProbeOptions): StorageProbeResult | Promise<StorageProbeResult>;
  /** Optional shared persistent transaction marker operations bound to this storage domain (REWORK-04 A02). */
  readTxState?(): Promise<string | null>;
  writeTxState?(text: string): Promise<void>;
  clearTxState?(): Promise<void>;
  /** Optional shared persistent monotonic confirmed-revision history metadata bound to this storage domain (REWORK-06 R5-01). */
  readHistoryState?(): Promise<string | null>;
  writeHistoryState?(text: string): Promise<void>;
  clearHistoryState?(): Promise<void>;
  /** Optional read-only inspection of legacy experimental localStorage saves (REWORK-04 P2). */
  getLegacyStorageStatus?(): LegacyLocalStorageStatus;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir?: string): Promise<string[]>;
}

export interface ClockProvider {
  wallNowMs(): number;
  monotonicNowMs(): number;
  readonly monotonicSupported: boolean;
  readonly monotonicSource: string;
}

export type LifecycleEvent = 'SHOW' | 'HIDE';

export interface LifecycleProvider {
  subscribe(listener: (event: LifecycleEvent) => void): () => void;
}

export type AdOutcome = 'COMPLETED' | 'CANCELLED' | 'FAILED';

export type ExperimentalAdScenario =
  | 'COMPLETED'
  | 'CANCELLED'
  | 'LOAD_FAILED'
  | 'PLAY_FAILED'
  | 'DUPLICATE_CALLBACK';

export interface AdProvider {
  readonly isStub: boolean;
  isAvailable(placement: string): boolean;
  show(requestId: string, placement: string): Promise<{ outcome: AdOutcome; detail: string }>;
}

export function isWeChatRealEnv(env: RuntimeEnvKind): boolean {
  return env === 'WECHAT_DEVICE' || env === 'WECHAT_DEVTOOLS';
}

export function detectRuntimeEnv(): RuntimeEnvKind {
  const g = globalThis as Record<string, unknown>;
  const isNodeProcess =
    typeof g.process === 'object' &&
    g.process !== null &&
    typeof (g.process as { versions?: { node?: string } }).versions?.node === 'string';

  // Host detection is strictly decoupled from FileSystemManager capability (P1-01 N2):
  // A WeChat host with a missing or failing getFileSystemManager is STILL a WeChat host
  // and must enter STORAGE_UNAVAILABLE rather than silently falling back to NODE/MEMORY.
  if (typeof g.wx === 'object' && g.wx !== null) {
    const wxObj = g.wx as {
      __FE000_MOCK__?: boolean;
      getSystemInfoSync?: () => { platform?: string };
    };
    if (wxObj.__FE000_MOCK__ || isNodeProcess) {
      return 'WECHAT_MOCK';
    }
    try {
      const info = typeof wxObj.getSystemInfoSync === 'function' ? wxObj.getSystemInfoSync() : null;
      if (info && info.platform === 'devtools') {
        return 'WECHAT_DEVTOOLS';
      }
    } catch {
      // Ignore probe error and fall back to WECHAT_DEVICE
    }
    return 'WECHAT_DEVICE';
  }
  if (typeof g.window === 'object' && g.window !== null && typeof g.document === 'object') {
    return 'WEB';
  }
  return 'NODE';
}
