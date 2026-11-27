/**
 * EXPERIMENTAL_WEB_FALLBACK_ONLY FilePort for browser verification,
 * plus an explicit MemoryFilePort for isolated Node/unit tests.
 *
 * P0 (A01) Cross-Renderer Linearizability Fix:
 * - In Chromium multi-process browsers, `localStorage` maintains an async per-renderer
 *   CachedStorageArea synchronized over a separate Mojo IPC pipe from `navigator.locks`.
 *   Consequently, Tab B can acquire a Web Lock AFTER Tab A writes `localStorage` and still
 *   read stale pre-write data, causing double COMMITTED on the same revision/slot.
 * - When `globalThis.indexedDB` is present (real browsers), BrowserFilePort uses W3C IndexedDB
 *   (`idle_fishing_fs_v1` / store `files`) as its authoritative, zero-RAM-cache store.
 *   Every read/write/remove/list executes in a fresh IndexedDB transaction committed by the
 *   central Browser process (`tx.oncomplete`), guaranteeing strict linearizability across
 *   same-origin renderer processes when coordinated by W3C Web Locks.
 * - In Node unit tests where `indexedDB` is absent and only mocked `localStorage` exists,
 *   BrowserFilePort operates fail-closed over `localStorage` without ever degrading to RAM.
 * - Explicit in-memory testing must construct MemoryFilePort directly.
 */
import type { FilePort, StorageProbeResult } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

export const BROWSER_IDB_NAME = 'idle_fishing_fs_v1';
export const BROWSER_IDB_STORE = 'files';
export const BROWSER_IDB_VERSION = 1;

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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message);
  }
  return String(err);
}

function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? '';
  const msg = errorMessage(err);
  return name === 'QuotaExceededError' || /quota/i.test(msg);
}

function getIndexedDbFactory(): IDBFactory | null {
  const g = globalThis as { indexedDB?: IDBFactory };
  if (g.indexedDB && typeof g.indexedDB.open === 'function') {
    return g.indexedDB;
  }
  return null;
}

export class BrowserFilePort implements FilePort {
  readonly kind: 'BROWSER_INDEXED_DB' | 'BROWSER_LOCAL_STORAGE_FALLBACK';
  readonly namespace: string;
  readonly storageKey: string;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly useIndexedDb: boolean;
  private _storageAvailable = false;
  private _unavailableReason: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(namespace = 'idle_fishing_spike_fs', maxBytes = 2 * 1024 * 1024) {
    this.namespace = namespace;
    this.storageKey = `browser:${namespace}`;
    this.prefix = `${namespace}:`;
    this.maxBytes = maxBytes;
    this.useIndexedDb = getIndexedDbFactory() !== null;
    this.kind = this.useIndexedDb ? 'BROWSER_INDEXED_DB' : 'BROWSER_LOCAL_STORAGE_FALLBACK';
    if (!this.useIndexedDb) {
      this.probeLocalStorageSync();
    } else {
      // IndexedDB is verified asynchronously via probeStorage() before loadSafe()/commit().
      this._storageAvailable = true;
      this._unavailableReason = null;
    }
  }

  get storageAvailable(): boolean {
    return this._storageAvailable;
  }

  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  private openDb(relPath: string): Promise<IDBDatabase> {
    const idb = getIndexedDbFactory();
    if (!idb) {
      this._storageAvailable = false;
      this._unavailableReason = 'indexedDB is unavailable in current runtime';
      return Promise.reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, this._unavailableReason));
    }
    if (this.dbPromise) return this.dbPromise;
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = idb.open(BROWSER_IDB_NAME, BROWSER_IDB_VERSION);
      } catch (err) {
        reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, `indexedDB.open threw: ${errorMessage(err)}`));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BROWSER_IDB_STORE)) {
          db.createObjectStore(BROWSER_IDB_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore close error
          }
          if (this.dbPromise === p) this.dbPromise = null;
        };
        db.onclose = () => {
          if (this.dbPromise === p) this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        const err = req.error ?? new Error('indexedDB.open failed');
        reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, `indexedDB.open error: ${errorMessage(err)}`));
      };
      req.onblocked = () => {
        reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, 'indexedDB.open blocked by another connection'));
      };
    });
    this.dbPromise = p;
    p.catch(() => {
      if (this.dbPromise === p) this.dbPromise = null;
    });
    return p;
  }

  private probeLocalStorageSync(): StorageProbeResult {
    try {
      if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
        this._storageAvailable = false;
        this._unavailableReason = 'localStorage is undefined in current runtime';
        return { available: false, reason: this._unavailableReason };
      }
      const probe = `${this.prefix}__probe__`;
      globalThis.localStorage.setItem(probe, '1');
      const readBack = globalThis.localStorage.getItem(probe);
      globalThis.localStorage.removeItem(probe);
      if (readBack !== '1') {
        this._storageAvailable = false;
        this._unavailableReason = 'localStorage probe readback mismatch';
        return { available: false, reason: this._unavailableReason };
      }
      this._storageAvailable = true;
      this._unavailableReason = null;
      return { available: true, reason: null };
    } catch (err) {
      this._storageAvailable = false;
      this._unavailableReason = `localStorage probe failed: ${errorMessage(err)}`;
      return { available: false, reason: this._unavailableReason };
    }
  }

  private async probeIndexedDbAsync(): Promise<StorageProbeResult> {
    const probeKey = `${this.prefix}__probe__`;
    try {
      const db = await this.openDb('__probe__');
      // 1. Committed write of __probe__
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
        const store = tx.objectStore(BROWSER_IDB_STORE);
        const putReq = store.put('1', probeKey);
        putReq.onerror = () => reject(putReq.error ?? new Error('IndexedDB probe put failed'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB probe write tx failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB probe write tx aborted'));
      });
      // 2. Fresh readonly transaction readback of __probe__
      const readBack = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(BROWSER_IDB_STORE, 'readonly');
        const store = tx.objectStore(BROWSER_IDB_STORE);
        const getReq = store.get(probeKey);
        let value: unknown = undefined;
        getReq.onsuccess = () => {
          value = getReq.result;
        };
        getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB probe get failed'));
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB probe read tx failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB probe read tx aborted'));
      });
      // 3. Clean up __probe__
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
        const store = tx.objectStore(BROWSER_IDB_STORE);
        const delReq = store.delete(probeKey);
        delReq.onerror = () => reject(delReq.error ?? new Error('IndexedDB probe delete failed'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB probe delete tx failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB probe delete tx aborted'));
      });
      if (readBack !== '1') {
        this._storageAvailable = false;
        this._unavailableReason = 'IndexedDB probe readback mismatch';
        return { available: false, reason: this._unavailableReason };
      }
      this._storageAvailable = true;
      this._unavailableReason = null;
      return { available: true, reason: null };
    } catch (err) {
      this._storageAvailable = false;
      this._unavailableReason = `IndexedDB probe failed: ${errorMessage(err)}`;
      return { available: false, reason: this._unavailableReason };
    }
  }

  /**
   * Probes actual storage read/write capability without altering any real save slot.
   * Returns a Promise in IndexedDB browser mode and synchronously in localStorage-only Node mock mode.
   * Never silently falls back to ephemeral memory on failure.
   */
  probeStorage(): StorageProbeResult | Promise<StorageProbeResult> {
    if (this.useIndexedDb) {
      return this.probeIndexedDbAsync();
    }
    return this.probeLocalStorageSync();
  }

  private assertLocalStorageAvailable(relPath: string): Storage {
    if (!this._storageAvailable || typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
      throw new FilePortIoError(
        'STORAGE_UNAVAILABLE',
        relPath,
        this._unavailableReason ?? 'localStorage is unavailable'
      );
    }
    return globalThis.localStorage;
  }

  private totalStoredBytesLocalStorage(storage: Storage, excludeKey?: string): number {
    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(this.prefix) && k !== excludeKey) {
        total += (storage.getItem(k) ?? '').length;
      }
    }
    return total;
  }

  async read(relPath: string): Promise<string | null> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.useIndexedDb) {
      const db = await this.openDb(clean);
      try {
        return await new Promise<string | null>((resolve, reject) => {
          const tx = db.transaction(BROWSER_IDB_STORE, 'readonly');
          const store = tx.objectStore(BROWSER_IDB_STORE);
          const req = store.get(key);
          let val: unknown = undefined;
          req.onsuccess = () => {
            val = req.result;
          };
          req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'));
          tx.oncomplete = () => {
            if (val === undefined || val === null) resolve(null);
            else if (typeof val === 'string') resolve(val);
            else reject(new FilePortIoError('READ_IO_ERROR', clean, 'Expected string value from IndexedDB'));
          };
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read tx failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read tx aborted'));
        });
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('READ_IO_ERROR', clean, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageAvailable(clean);
    try {
      return storage.getItem(key);
    } catch (err) {
      throw new FilePortIoError('READ_IO_ERROR', clean, errorMessage(err));
    }
  }

  async write(relPath: string, text: string): Promise<void> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.useIndexedDb) {
      const db = await this.openDb(clean);
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
          const store = tx.objectStore(BROWSER_IDB_STORE);
          const range =
            typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(this.prefix, `${this.prefix}\uffff`) : undefined;
          const cursorReq = store.openCursor(range);
          let totalOtherBytes = 0;
          let abortedForQuota = false;

          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              const k = String(cursor.key);
              if (k.startsWith(this.prefix) && k !== key && typeof cursor.value === 'string') {
                totalOtherBytes += cursor.value.length;
              }
              cursor.continue();
              return;
            }
            if (totalOtherBytes + text.length > this.maxBytes) {
              abortedForQuota = true;
              try {
                tx.abort();
              } catch {
                // ignore abort error
              }
              reject(new FilePortIoError('QUOTA_EXCEEDED', clean, `Exceeded experimental limit ${this.maxBytes} bytes`));
              return;
            }
            const putReq = store.put(text, key);
            putReq.onerror = () => reject(putReq.error ?? new Error('IndexedDB put failed'));
          };
          cursorReq.onerror = () => reject(cursorReq.error ?? new Error('IndexedDB cursor failed'));
          tx.oncomplete = () => resolve();
          tx.onerror = () => {
            if (!abortedForQuota) reject(tx.error ?? new Error('IndexedDB write tx failed'));
          };
          tx.onabort = () => {
            if (!abortedForQuota) reject(tx.error ?? new Error('IndexedDB write tx aborted'));
          };
        });
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError(isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR', clean, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageAvailable(clean);
    try {
      if (this.totalStoredBytesLocalStorage(storage, key) + text.length > this.maxBytes) {
        throw new FilePortIoError('QUOTA_EXCEEDED', clean, `Exceeded experimental limit ${this.maxBytes} bytes`);
      }
      storage.setItem(key, text);
    } catch (err) {
      if (err instanceof FilePortIoError) throw err;
      throw new FilePortIoError(isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR', clean, errorMessage(err));
    }
  }

  async remove(relPath: string): Promise<void> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.useIndexedDb) {
      const db = await this.openDb(clean);
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
          const store = tx.objectStore(BROWSER_IDB_STORE);
          const delReq = store.delete(key);
          delReq.onerror = () => reject(delReq.error ?? new Error('IndexedDB delete failed'));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB remove tx failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB remove tx aborted'));
        });
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('REMOVE_IO_ERROR', clean, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageAvailable(clean);
    try {
      storage.removeItem(key);
    } catch (err) {
      throw new FilePortIoError('REMOVE_IO_ERROR', clean, errorMessage(err));
    }
  }

  async list(dir = ''): Promise<string[]> {
    const subPrefix = dir ? `${this.prefix}${validatePath(dir)}/` : this.prefix;
    if (this.useIndexedDb) {
      const db = await this.openDb(dir || '.');
      try {
        const names = await new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction(BROWSER_IDB_STORE, 'readonly');
          const store = tx.objectStore(BROWSER_IDB_STORE);
          const range =
            typeof IDBKeyRange !== 'undefined' ? IDBKeyRange.bound(subPrefix, `${subPrefix}\uffff`) : undefined;
          const req = store.getAllKeys(range);
          let out: string[] = [];
          req.onsuccess = () => {
            out = (req.result as IDBValidKey[])
              .map((k) => String(k))
              .filter((k) => k.startsWith(subPrefix))
              .map((k) => k.slice(subPrefix.length));
          };
          req.onerror = () => reject(req.error ?? new Error('IndexedDB getAllKeys failed'));
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB list tx failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB list tx aborted'));
        });
        return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('LIST_IO_ERROR', dir || '.', errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageAvailable(dir || '.');
    const names: string[] = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(subPrefix)) {
          names.push(k.slice(subPrefix.length));
        }
      }
    } catch (err) {
      throw new FilePortIoError('LIST_IO_ERROR', dir || '.', errorMessage(err));
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

let nextMemoryPortId = 1;

export class MemoryFilePort implements FilePort {
  readonly kind = 'MEMORY' as const;
  readonly storageKey: string;
  private readonly files = new Map<string, string>();
  private readonly maxBytes: number;

  constructor(maxBytes = 10 * 1024 * 1024, namespace?: string) {
    this.storageKey = namespace ? `memory:${namespace}` : `memory:instance_${nextMemoryPortId++}`;
    this.maxBytes = maxBytes;
  }

  probeStorage(): StorageProbeResult {
    return { available: true, reason: null };
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
