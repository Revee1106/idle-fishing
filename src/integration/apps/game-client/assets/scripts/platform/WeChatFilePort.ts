/**
 * Real WeChat Mini Game FilePort backed by wx.getFileSystemManager() + wx.env.USER_DATA_PATH.
 * Strictly sandboxed under `${USER_DATA_PATH}/idle_fishing/`.
 *
 * P1-01 / N2 Hardening:
 * - Missing wx, missing getFileSystemManager, getFileSystemManager() throwing, missing
 *   USER_DATA_PATH, or missing required FS methods (readFileSync/writeFileSync/unlinkSync/
 *   readdirSync/accessSync/mkdirSync) NEVER throw unhandled in constructor and NEVER degrade
 *   to an in-memory port; instead probeStorage() reports { available: false, reason } and
 *   all I/O methods throw FilePortIoError('STORAGE_UNAVAILABLE', ...).
 * - read() returns null ONLY when the file does not exist (ENOENT) on a healthy FS.
 * - IO / permission errors throw FilePortIoError so corrupt/unreadable slots are never treated as empty.
 */
import type { FilePort } from './PlatformTypes';

interface WxFileSystemManager {
  accessSync(path: string): void;
  mkdirSync(dirPath: string, recursive?: boolean): void;
  readFileSync(filePath: string, encoding?: string): string | ArrayBuffer;
  writeFileSync(filePath: string, data: string, encoding?: string): void;
  unlinkSync(filePath: string): void;
  readdirSync(dirPath: string): string[];
}

interface WxMiniGameGlobal {
  env?: { USER_DATA_PATH?: string };
  getFileSystemManager?: () => WxFileSystemManager;
}

export class FilePortIoError extends Error {
  readonly code: string;
  readonly targetPath: string;

  constructor(code: string, targetPath: string, message: string) {
    super(`[${code}] ${targetPath}: ${message}`);
    this.name = 'FilePortIoError';
    this.code = code;
    this.targetPath = targetPath;
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function sanitizeRelativePath(relPath: string): string {
  const trimmed = relPath.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new FilePortIoError('INVALID_PATH', relPath, 'Path must be relative inside idle_fishing sandbox');
  }
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => !SAFE_SEGMENT.test(p))) {
    throw new FilePortIoError('INVALID_PATH', relPath, 'Path contains disallowed characters');
  }
  return parts.join('/');
}

function isNotFoundError(err: unknown): boolean {
  const msg = String((err as { errMsg?: string; message?: string })?.errMsg ?? (err as Error)?.message ?? err ?? '');
  return /no such file|enoent|not exist|not found/i.test(msg);
}

const REQUIRED_WX_FS_METHODS: readonly (keyof WxFileSystemManager)[] = [
  'accessSync',
  'mkdirSync',
  'readFileSync',
  'writeFileSync',
  'unlinkSync',
  'readdirSync',
];

/**
 * Explicit fail-closed FilePort used when a runtime has no persistent storage capability.
 * Never returns EMPTY or COMMITTED and never simulates persistence in RAM.
 */
export class UnavailableFilePort implements FilePort {
  readonly kind: 'WECHAT_FS' | 'BROWSER_STORAGE_UNAVAILABLE' = 'BROWSER_STORAGE_UNAVAILABLE';
  readonly storageKey: string;
  readonly unavailableReason: string;

  constructor(hostLabel: string, namespace: string, reason: string) {
    this.storageKey = `unavailable:${hostLabel}:${namespace}`;
    this.unavailableReason = reason;
  }

  probeStorage(): { available: boolean; reason: string | null } {
    return { available: false, reason: this.unavailableReason };
  }

  async readTxState(): Promise<string | null> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__tx_state__', this.unavailableReason);
  }

  async writeTxState(): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__tx_state__', this.unavailableReason);
  }

  async clearTxState(): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__tx_state__', this.unavailableReason);
  }

  async readHistoryState(): Promise<string | null> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__save_history__', this.unavailableReason);
  }

  async writeHistoryState(): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__save_history__', this.unavailableReason);
  }

  async clearHistoryState(): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', '__save_history__', this.unavailableReason);
  }

  async read(relPath: string): Promise<string | null> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', relPath, this.unavailableReason);
  }

  async write(relPath: string): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', relPath, this.unavailableReason);
  }

  async remove(relPath: string): Promise<void> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', relPath, this.unavailableReason);
  }

  async list(dir = ''): Promise<string[]> {
    throw new FilePortIoError('STORAGE_UNAVAILABLE', dir || '.', this.unavailableReason);
  }
}

export class WeChatFilePort implements FilePort {
  readonly kind = 'WECHAT_FS' as const;
  readonly storageKey: string;
  private readonly namespaceDir: string;
  private fs: WxFileSystemManager | null = null;
  private rootDir: string | null = null;
  private _storageAvailable = false;
  private _unavailableReason: string | null = null;

  constructor(namespaceDir = 'idle_fishing') {
    this.namespaceDir = sanitizeRelativePath(namespaceDir);
    const wxObj = (globalThis as { wx?: WxMiniGameGlobal }).wx;
    const baseRoot = wxObj?.env?.USER_DATA_PATH ? `${wxObj.env.USER_DATA_PATH}/${this.namespaceDir}` : this.namespaceDir;
    this.storageKey = `wechat:${baseRoot}`;
    this.probeStorage();
  }

  get storageAvailable(): boolean {
    return this._storageAvailable;
  }

  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  probeStorage(): { available: boolean; reason: string | null } {
    const wxObj = (globalThis as { wx?: WxMiniGameGlobal }).wx;
    if (!wxObj || typeof wxObj !== 'object') {
      this.fs = null;
      this.rootDir = null;
      this._storageAvailable = false;
      this._unavailableReason = 'wx global is unavailable';
      return { available: false, reason: this._unavailableReason };
    }
    if (typeof wxObj.getFileSystemManager !== 'function') {
      this.fs = null;
      this.rootDir = null;
      this._storageAvailable = false;
      this._unavailableReason = 'wx.getFileSystemManager is missing';
      return { available: false, reason: this._unavailableReason };
    }
    if (!wxObj.env?.USER_DATA_PATH || typeof wxObj.env.USER_DATA_PATH !== 'string') {
      this.fs = null;
      this.rootDir = null;
      this._storageAvailable = false;
      this._unavailableReason = 'wx.env.USER_DATA_PATH is missing';
      return { available: false, reason: this._unavailableReason };
    }

    let fsm: WxFileSystemManager;
    try {
      fsm = wxObj.getFileSystemManager();
    } catch (err) {
      this.fs = null;
      this.rootDir = null;
      this._storageAvailable = false;
      this._unavailableReason = `wx.getFileSystemManager() threw: ${String((err as { errMsg?: string })?.errMsg ?? err)}`;
      return { available: false, reason: this._unavailableReason };
    }
    if (!fsm || typeof fsm !== 'object') {
      this.fs = null;
      this.rootDir = null;
      this._storageAvailable = false;
      this._unavailableReason = 'wx.getFileSystemManager() returned null/invalid object';
      return { available: false, reason: this._unavailableReason };
    }
    for (const method of REQUIRED_WX_FS_METHODS) {
      if (typeof fsm[method] !== 'function') {
        this.fs = null;
        this.rootDir = null;
        this._storageAvailable = false;
        this._unavailableReason = `wx FileSystemManager missing required method: ${method}`;
        return { available: false, reason: this._unavailableReason };
      }
    }

    this.fs = fsm;
    this.rootDir = `${wxObj.env.USER_DATA_PATH}/${this.namespaceDir}`;
    try {
      this.ensureRootDir();
    } catch (err) {
      this._storageAvailable = false;
      this._unavailableReason = err instanceof Error ? err.message : String(err);
      return { available: false, reason: this._unavailableReason };
    }
    this._storageAvailable = true;
    this._unavailableReason = null;
    return { available: true, reason: null };
  }

  private assertAvailable(relPath: string): { fs: WxFileSystemManager; rootDir: string } {
    if (!this._storageAvailable || !this.fs || !this.rootDir) {
      throw new FilePortIoError(
        'STORAGE_UNAVAILABLE',
        relPath,
        this._unavailableReason ?? 'WeChat FileSystemManager unavailable'
      );
    }
    return { fs: this.fs, rootDir: this.rootDir };
  }

  private ensureRootDir(): void {
    if (!this.fs || !this.rootDir) {
      throw new FilePortIoError('STORAGE_UNAVAILABLE', this.namespaceDir, 'WeChat FS not initialized');
    }
    try {
      this.fs.accessSync(this.rootDir);
    } catch {
      try {
        this.fs.mkdirSync(this.rootDir, true);
      } catch (err) {
        if (!/file already exists|eexist/i.test(String(err))) {
          throw new FilePortIoError('MKDIR_FAILED', this.rootDir, String(err));
        }
      }
    }
  }

  private resolve(rootDir: string, relPath: string): string {
    return `${rootDir}/${sanitizeRelativePath(relPath)}`;
  }

  async read(relPath: string): Promise<string | null> {
    const clean = sanitizeRelativePath(relPath);
    const { fs, rootDir } = this.assertAvailable(clean);
    const full = this.resolve(rootDir, clean);
    try {
      const content = fs.readFileSync(full, 'utf8');
      if (typeof content !== 'string') {
        throw new FilePortIoError('READ_TYPE_ERROR', clean, 'Expected UTF-8 string from readFileSync');
      }
      return content;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw new FilePortIoError('READ_IO_ERROR', clean, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async write(relPath: string, text: string): Promise<void> {
    const clean = sanitizeRelativePath(relPath);
    const { fs, rootDir } = this.assertAvailable(clean);
    this.ensureRootDir();
    const full = this.resolve(rootDir, clean);
    try {
      fs.writeFileSync(full, text, 'utf8');
    } catch (err) {
      throw new FilePortIoError('WRITE_IO_ERROR', clean, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async remove(relPath: string): Promise<void> {
    const clean = sanitizeRelativePath(relPath);
    const { fs, rootDir } = this.assertAvailable(clean);
    const full = this.resolve(rootDir, clean);
    try {
      fs.unlinkSync(full);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw new FilePortIoError('REMOVE_IO_ERROR', clean, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async readTxState(): Promise<string | null> {
    return this.read('__tx_state__.json');
  }

  async writeTxState(text: string): Promise<void> {
    await this.write('__tx_state__.json', text);
    // Verify written marker bytes immediately to catch truncated/short writes before touching save slots
    const readback = await this.read('__tx_state__.json');
    if (readback !== text) {
      throw new FilePortIoError(
        'WRITE_IO_ERROR',
        '__tx_state__.json',
        `WeChat tx marker readback mismatch (expected ${text.length} chars, got ${readback === null ? 'null' : readback.length})`
      );
    }
  }

  async clearTxState(): Promise<void> {
    return this.remove('__tx_state__.json');
  }

  async readHistoryState(): Promise<string | null> {
    return this.read('__save_history__.json');
  }

  async writeHistoryState(text: string): Promise<void> {
    await this.write('__save_history__.json', text);
    const readback = await this.read('__save_history__.json');
    if (readback !== text) {
      throw new FilePortIoError(
        'WRITE_IO_ERROR',
        '__save_history__.json',
        `WeChat history metadata readback mismatch (expected ${text.length} chars, got ${readback === null ? 'null' : readback.length})`
      );
    }
  }

  async clearHistoryState(): Promise<void> {
    return this.remove('__save_history__.json');
  }

  async list(dir = ''): Promise<string[]> {
    const { fs, rootDir } = this.assertAvailable(dir || '.');
    const target = dir ? this.resolve(rootDir, dir) : rootDir;
    try {
      const entries = fs.readdirSync(target);
      return entries
        .filter((e) => e !== '__tx_state__.json' && e !== '__save_history__.json' && e !== '__probe__.tmp')
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw new FilePortIoError('LIST_IO_ERROR', dir || '.', String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }
}
