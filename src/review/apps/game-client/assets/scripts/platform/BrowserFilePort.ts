/**
 * EXPERIMENTAL_WEB_FALLBACK_ONLY FilePort backed by browser localStorage or in-memory map.
 * Used ONLY for Web/Node verification comparisons — NEVER substitutes for real WeChat FS verification.
 */
import type { FilePort } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function validatePath(relPath: string): string {
  const trimmed = relPath.trim();
  if (!trimmed || trimmed.includes('..') || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new FilePortIoError('INVALID_PATH', relPath, 'Path must stay inside sandbox');
  }
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => !SAFE_SEGMENT.test(p))) {
    throw new FilePortIoError('INVALID_PATH', relPath, 'Disallowed path segment');
  }
  return parts.join('/');
}

export class BrowserFilePort implements FilePort {
  readonly kind = 'BROWSER_LOCAL_STORAGE_FALLBACK' as const;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly memoryFallback = new Map<string, string>();
  private readonly useLocalStorage: boolean;

  constructor(namespace = 'idle_fishing_spike_fs', maxBytes = 2 * 1024 * 1024) {
    this.prefix = `${namespace}:`;
    this.maxBytes = maxBytes;
    let available = false;
    try {
      if (typeof globalThis.localStorage !== 'undefined') {
        const probe = `${this.prefix}__probe__`;
        globalThis.localStorage.setItem(probe, '1');
        globalThis.localStorage.removeItem(probe);
        available = true;
      }
    } catch {
      available = false;
    }
    this.useLocalStorage = available;
  }

  private totalStoredBytes(excludeKey?: string): number {
    let total = 0;
    if (this.useLocalStorage) {
      for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        if (k && k.startsWith(this.prefix) && k !== excludeKey) {
          total += (globalThis.localStorage.getItem(k) ?? '').length;
        }
      }
    } else {
      for (const [k, v] of this.memoryFallback.entries()) {
        if (k !== excludeKey) total += v.length;
      }
    }
    return total;
  }

  async read(relPath: string): Promise<string | null> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.useLocalStorage) {
      return globalThis.localStorage.getItem(key);
    }
    return this.memoryFallback.has(key) ? this.memoryFallback.get(key)! : null;
  }

  async write(relPath: string, text: string): Promise<void> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.totalStoredBytes(key) + text.length > this.maxBytes) {
      throw new FilePortIoError('QUOTA_EXCEEDED', clean, `Exceeded experimental limit ${this.maxBytes} bytes`);
    }
    try {
      if (this.useLocalStorage) {
        globalThis.localStorage.setItem(key, text);
      } else {
        this.memoryFallback.set(key, text);
      }
    } catch (err) {
      throw new FilePortIoError('WRITE_IO_ERROR', clean, String(err));
    }
  }

  async remove(relPath: string): Promise<void> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.useLocalStorage) {
      globalThis.localStorage.removeItem(key);
    } else {
      this.memoryFallback.delete(key);
    }
  }

  async list(dir = ''): Promise<string[]> {
    const subPrefix = dir ? `${this.prefix}${validatePath(dir)}/` : this.prefix;
    const names: string[] = [];
    if (this.useLocalStorage) {
      for (let i = 0; i < globalThis.localStorage.length; i++) {
        const k = globalThis.localStorage.key(i);
        if (k && k.startsWith(subPrefix)) {
          names.push(k.slice(subPrefix.length));
        }
      }
    } else {
      for (const k of this.memoryFallback.keys()) {
        if (k.startsWith(subPrefix)) {
          names.push(k.slice(subPrefix.length));
        }
      }
    }
    return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async clearAll(): Promise<void> {
    const files = await this.list();
    for (const f of files) {
      await this.remove(f);
    }
  }
}

export class MemoryFilePort implements FilePort {
  readonly kind = 'MEMORY' as const;
  private readonly files = new Map<string, string>();
  private readonly maxBytes: number;

  constructor(maxBytes = 10 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  async read(relPath: string): Promise<string | null> {
    const clean = validatePath(relPath);
    return this.files.has(clean) ? this.files.get(clean)! : null;
  }

  async write(relPath: string, text: string): Promise<void> {
    const clean = validatePath(relPath);
    let total = text.length;
    for (const [k, v] of this.files.entries()) {
      if (k !== clean) total += v.length;
    }
    if (total > this.maxBytes) {
      throw new FilePortIoError('QUOTA_EXCEEDED', clean, `Exceeded memory limit ${this.maxBytes} bytes`);
    }
    this.files.set(clean, text);
  }

  async remove(relPath: string): Promise<void> {
    const clean = validatePath(relPath);
    this.files.delete(clean);
  }

  async list(dir = ''): Promise<string[]> {
    const prefix = dir ? `${validatePath(dir)}/` : '';
    const out: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }
}
