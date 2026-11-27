/**
 * FE-000 / SPIKE-001 Platform adapter interfaces aligned with docs/interfaces/19.
 * These are verification ports; no production game rules live here.
 */

export type RuntimeEnvKind = 'WECHAT' | 'WEB' | 'NODE';

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

export function detectRuntimeEnv(): RuntimeEnvKind {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.wx === 'object' && g.wx !== null && typeof (g.wx as Record<string, unknown>).getFileSystemManager === 'function') {
    return 'WECHAT';
  }
  if (typeof g.window === 'object' && g.window !== null && typeof g.document === 'object') {
    return 'WEB';
  }
  return 'NODE';
}
