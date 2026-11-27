/**
 * FE-000 / SPIKE-001 Platform adapter interfaces aligned with docs/interfaces/19.
 * Distinguishes runtime hosts explicitly so Node/Mock/Web never masquerade as real WeChat.
 */

export type RuntimeEnvKind = 'WECHAT_DEVICE' | 'WECHAT_DEVTOOLS' | 'WECHAT_MOCK' | 'WEB' | 'NODE';

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
  readonly kind: 'WECHAT_FS' | 'BROWSER_LOCAL_STORAGE_FALLBACK' | 'MEMORY' | 'FAULT_WRAPPER';
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

  if (
    typeof g.wx === 'object' &&
    g.wx !== null &&
    typeof (g.wx as Record<string, unknown>).getFileSystemManager === 'function'
  ) {
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
