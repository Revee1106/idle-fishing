/**
 * Real WeChat Mini Game FilePort backed by wx.getFileSystemManager() + wx.env.USER_DATA_PATH.
 * Strictly sandboxed under `${USER_DATA_PATH}/idle_fishing/`.
 * Aligned with docs/interfaces/19 §1:
 * - read() returns null ONLY when the file does not exist (ENOENT)
 * - IO / permission errors throw FilePortIoError so corrupt/unreadable slots are never treated as empty
 * - write() replaces full UTF-8 content
 * - remove() is idempotent when missing
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

export class WeChatFilePort implements FilePort {
  readonly kind = 'WECHAT_FS' as const;
  private readonly fs: WxFileSystemManager;
  private readonly rootDir: string;

  constructor(namespaceDir = 'idle_fishing') {
    const wxObj = (globalThis as { wx?: WxMiniGameGlobal }).wx;
    if (!wxObj || typeof wxObj.getFileSystemManager !== 'function' || !wxObj.env?.USER_DATA_PATH) {
      throw new FilePortIoError('WX_UNAVAILABLE', namespaceDir, 'wx.getFileSystemManager or USER_DATA_PATH unavailable');
    }
    this.fs = wxObj.getFileSystemManager();
    this.rootDir = `${wxObj.env.USER_DATA_PATH}/${sanitizeRelativePath(namespaceDir)}`;
  }

  private ensureRootDir(): void {
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

  private resolve(relPath: string): string {
    return `${this.rootDir}/${sanitizeRelativePath(relPath)}`;
  }

  async read(relPath: string): Promise<string | null> {
    const full = this.resolve(relPath);
    try {
      const content = this.fs.readFileSync(full, 'utf8');
      if (typeof content !== 'string') {
        throw new FilePortIoError('READ_TYPE_ERROR', relPath, 'Expected UTF-8 string from readFileSync');
      }
      return content;
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw new FilePortIoError('READ_IO_ERROR', relPath, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async write(relPath: string, text: string): Promise<void> {
    this.ensureRootDir();
    const full = this.resolve(relPath);
    try {
      this.fs.writeFileSync(full, text, 'utf8');
    } catch (err) {
      throw new FilePortIoError('WRITE_IO_ERROR', relPath, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async remove(relPath: string): Promise<void> {
    const full = this.resolve(relPath);
    try {
      this.fs.unlinkSync(full);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw new FilePortIoError('REMOVE_IO_ERROR', relPath, String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }

  async list(dir = ''): Promise<string[]> {
    const target = dir ? this.resolve(dir) : this.rootDir;
    try {
      const entries = this.fs.readdirSync(target);
      return [...entries].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw new FilePortIoError('LIST_IO_ERROR', dir || '.', String((err as { errMsg?: string })?.errMsg ?? err));
    }
  }
}
