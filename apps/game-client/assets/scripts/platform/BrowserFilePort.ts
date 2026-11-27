/**
 * EXPERIMENTAL_WEB_FALLBACK_ONLY FilePort for browser verification,
 * plus an explicit MemoryFilePort for isolated Node/unit tests.
 *
 * P0 (A01) + A02 + P2 Policy (FE-000-R1-INTEGRATION-REWORK-04):
 * - When `globalThis.indexedDB` is present (real browsers), BrowserFilePort uses W3C IndexedDB
 *   (`idle_fishing_fs_v1` / store `files`, version 1) as its authoritative, zero-RAM-cache store.
 *   Every read/write/remove/list/txState operation executes in a fresh IndexedDB transaction
 *   committed by the central Browser process (`tx.oncomplete`), guaranteeing strict linearizability
 *   across same-origin renderer processes when coordinated by W3C Web Locks.
 * - Real Browser IndexedDB Unavailable Policy (REWORK-04 P2):
 *   When `indexedDB` is missing in a real browser host, BrowserFilePort STRICTLY FAILS CLOSED
 *   (`kind='BROWSER_STORAGE_UNAVAILABLE'`, `probeStorage().available=false`, all I/O throws
 *   `STORAGE_UNAVAILABLE`). It NEVER silently falls back to non-linearizable `localStorage` writes
 *   and NEVER resurrects, overwrites, or deletes legacy `localStorage` experimental saves.
 * - Node Mock Policy (REWORK-04 P2):
 *   Explicit `localStorage` mock testing is ONLY permitted when BOTH `isNodeTestHost() === true`
 *   AND the caller explicitly passes `{ allowLocalStorageMockInNode: true }`. A real browser host
 *   is NEVER misclassified as a Node test host even if `allowLocalStorageMockInNode: true` is passed.
 * - Legacy Experimental `localStorage` Saves (REWORK-04 P2):
 *   Read-only inspection detects existing `${namespace}:save_slot_0/1/2.json` keys and explicitly
 *   reports `DETECTED_IGNORED_NO_AUTO_MIGRATION` without auto-migrating, resurrecting, or deleting.
 */
import { SLOT_PATHS } from '@idle-fishing/game-core';
import type { FilePort, LegacyLocalStorageStatus, StorageProbeOptions, StorageProbeResult } from './PlatformTypes';
import { FilePortIoError } from './WeChatFilePort';

export const BROWSER_IDB_NAME = 'idle_fishing_fs_v1';
export const BROWSER_IDB_STORE = 'files';
export const BROWSER_IDB_VERSION = 1;
export const BROWSER_TX_STATE_KEY_SUFFIX = '__tx_state__';
export const BROWSER_HISTORY_STATE_KEY_SUFFIX = '__save_history__';

const INTERNAL_KEY_SUFFIXES = new Set<string>([
  '__probe__',
  BROWSER_TX_STATE_KEY_SUFFIX,
  BROWSER_HISTORY_STATE_KEY_SUFFIX,
]);
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export interface BrowserFilePortOptions {
  /**
   * Explicit opt-in to allow injected `localStorage` mock backend in Node unit tests ONLY.
   * Ignored (strictly fail-closed) in real browser runtimes.
   */
  readonly allowLocalStorageMockInNode?: boolean;
}

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

/**
 * Strictly identifies an authentic Node.js test runtime (requires process.versions.node,
 * process.release.name === 'node', and process.cwd function). Real browsers never satisfy this.
 */
export function isNodeTestHost(): boolean {
  const g = globalThis as {
    process?: { versions?: { node?: unknown }; release?: { name?: unknown }; cwd?: unknown };
  };
  return (
    typeof g.process === 'object' &&
    g.process !== null &&
    typeof g.process.versions === 'object' &&
    g.process.versions !== null &&
    typeof g.process.versions.node === 'string' &&
    g.process.versions.node.length > 0 &&
    g.process.release?.name === 'node' &&
    typeof g.process.cwd === 'function'
  );
}

function openEphemeralIndexedDb(relPath: string): Promise<IDBDatabase> {
  const idb = getIndexedDbFactory();
  if (!idb) {
    return Promise.reject(
      new FilePortIoError('STORAGE_UNAVAILABLE', relPath, 'indexedDB is unavailable in current runtime')
    );
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
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
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      const err = req.error ?? new Error('indexedDB.open failed');
      reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, `indexedDB.open error: ${errorMessage(err)}`));
    };
    req.onblocked = () => {
      reject(new FilePortIoError('STORAGE_UNAVAILABLE', relPath, 'indexedDB.open blocked by another connection'));
    };
  });
}

function idbReadStringKey(db: IDBDatabase, key: string, relPath: string): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
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
      else reject(new FilePortIoError('READ_IO_ERROR', relPath, 'Expected string value from IndexedDB'));
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB read tx aborted'));
  });
}

function idbWriteStringKey(db: IDBDatabase, key: string, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
    const store = tx.objectStore(BROWSER_IDB_STORE);
    const req = store.put(text, key);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write tx aborted'));
  });
}

function idbDeleteKey(db: IDBDatabase, key: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BROWSER_IDB_STORE, 'readwrite');
    const store = tx.objectStore(BROWSER_IDB_STORE);
    const req = store.delete(key);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete tx aborted'));
  });
}

/**
 * Shared IndexedDB transaction-state helpers bound to a browser namespace (`${namespace}:__tx_state__`).
 * Used by SingleWriterSaveCoordinator when a custom FilePort wrapper (without readTxState/writeTxState)
 * targets a `browser:<namespace>` storage domain in a real browser.
 */
export async function readIndexedDbTxStateForNamespace(namespace: string): Promise<string | null> {
  const db = await openEphemeralIndexedDb(BROWSER_TX_STATE_KEY_SUFFIX);
  try {
    return await idbReadStringKey(db, `${namespace}:${BROWSER_TX_STATE_KEY_SUFFIX}`, BROWSER_TX_STATE_KEY_SUFFIX);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError('READ_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

export async function writeIndexedDbTxStateForNamespace(namespace: string, text: string): Promise<void> {
  const db = await openEphemeralIndexedDb(BROWSER_TX_STATE_KEY_SUFFIX);
  try {
    await idbWriteStringKey(db, `${namespace}:${BROWSER_TX_STATE_KEY_SUFFIX}`, text);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError(
      isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
      BROWSER_TX_STATE_KEY_SUFFIX,
      errorMessage(err)
    );
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

export async function clearIndexedDbTxStateForNamespace(namespace: string): Promise<void> {
  const db = await openEphemeralIndexedDb(BROWSER_TX_STATE_KEY_SUFFIX);
  try {
    await idbDeleteKey(db, `${namespace}:${BROWSER_TX_STATE_KEY_SUFFIX}`);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

/**
 * Shared IndexedDB confirmed-revision history metadata helpers (`${namespace}:__save_history__`).
 * Used by SingleWriterSaveCoordinator (REWORK-06 R5-01) so confirmed revision floors survive
 * new coordinator instances, cross-tab access, page reloads, and restarts.
 */
export async function readIndexedDbHistoryStateForNamespace(namespace: string): Promise<string | null> {
  const db = await openEphemeralIndexedDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
  try {
    return await idbReadStringKey(db, `${namespace}:${BROWSER_HISTORY_STATE_KEY_SUFFIX}`, BROWSER_HISTORY_STATE_KEY_SUFFIX);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError('READ_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

export async function writeIndexedDbHistoryStateForNamespace(namespace: string, text: string): Promise<void> {
  const db = await openEphemeralIndexedDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
  try {
    await idbWriteStringKey(db, `${namespace}:${BROWSER_HISTORY_STATE_KEY_SUFFIX}`, text);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError(
      isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
      BROWSER_HISTORY_STATE_KEY_SUFFIX,
      errorMessage(err)
    );
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

export async function clearIndexedDbHistoryStateForNamespace(namespace: string): Promise<void> {
  const db = await openEphemeralIndexedDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
  try {
    await idbDeleteKey(db, `${namespace}:${BROWSER_HISTORY_STATE_KEY_SUFFIX}`);
  } catch (err) {
    if (err instanceof FilePortIoError) throw err;
    throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
  } finally {
    try {
      db.close();
    } catch {
      // ignore close error
    }
  }
}

export class BrowserFilePort implements FilePort {
  readonly kind: 'BROWSER_INDEXED_DB' | 'BROWSER_STORAGE_UNAVAILABLE' | 'BROWSER_LOCAL_STORAGE_FALLBACK';
  readonly namespace: string;
  readonly storageKey: string;
  readonly legacyLocalStorageStatus: LegacyLocalStorageStatus;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly backend: 'INDEXED_DB' | 'LOCAL_STORAGE_MOCK' | 'UNAVAILABLE';
  private _storageAvailable = false;
  private _unavailableReason: string | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    namespace = 'idle_fishing_spike_fs',
    maxBytes = 2 * 1024 * 1024,
    options?: BrowserFilePortOptions
  ) {
    this.namespace = namespace;
    this.storageKey = `browser:${namespace}`;
    this.prefix = `${namespace}:`;
    this.maxBytes = maxBytes;

    const hasIdb = getIndexedDbFactory() !== null;
    if (hasIdb) {
      this.backend = 'INDEXED_DB';
      this.kind = 'BROWSER_INDEXED_DB';
      // IndexedDB is verified asynchronously via probeStorage() before loadSafe()/commit().
      this._storageAvailable = true;
      this._unavailableReason = null;
      this.legacyLocalStorageStatus = this.inspectLegacyLocalStorageSaves();
    } else if (options?.allowLocalStorageMockInNode === true && isNodeTestHost()) {
      // Explicit Node unit-test mock opt-in ONLY; real browser hosts NEVER enter this branch.
      this.backend = 'LOCAL_STORAGE_MOCK';
      this.kind = 'BROWSER_LOCAL_STORAGE_FALLBACK';
      this.legacyLocalStorageStatus = { detected: false, keys: [], policy: 'NONE', detail: null };
      this.probeLocalStorageSync();
    } else {
      // REWORK-04 P2 Fail-Closed: Never automatically fall back to localStorage in browsers,
      // and never resurrect or delete legacy localStorage saves.
      this.backend = 'UNAVAILABLE';
      this.kind = 'BROWSER_STORAGE_UNAVAILABLE';
      this._storageAvailable = false;
      this._unavailableReason =
        'INDEXED_DB_UNAVAILABLE: IndexedDB is unavailable in current runtime; automatic fallback to non-linearizable localStorage is prohibited';
      this.legacyLocalStorageStatus = this.inspectLegacyLocalStorageSaves();
    }
  }

  get storageAvailable(): boolean {
    return this._storageAvailable;
  }

  get unavailableReason(): string | null {
    return this._unavailableReason;
  }

  /**
   * Read-only detection of legacy experimental localStorage saves (`${namespace}:save_slot_0..2.json`).
   * Never modifies, deletes, migrates, or resurrects legacy saves.
   */
  inspectLegacyLocalStorageSaves(): LegacyLocalStorageStatus {
    try {
      const ls = (globalThis as { localStorage?: Storage }).localStorage;
      if (typeof ls === 'undefined' || ls === null) {
        return { detected: false, keys: [], policy: 'NONE', detail: null };
      }
      const found: string[] = [];
      for (const slotPath of SLOT_PATHS) {
        const key = `${this.prefix}${slotPath}`;
        if (ls.getItem(key) !== null) {
          found.push(key);
        }
      }
      if (found.length > 0) {
        return {
          detected: true,
          keys: found,
          policy: 'DETECTED_IGNORED_NO_AUTO_MIGRATION',
          detail: `Detected ${found.length} legacy experimental localStorage save slot(s) (${found.join(', ')}); preserved untouched without auto-migration or resurrection`,
        };
      }
      return { detected: false, keys: [], policy: 'NONE', detail: null };
    } catch (err) {
      return {
        detected: false,
        keys: [],
        policy: 'UNINSPECTABLE',
        detail: `Could not inspect localStorage for legacy experimental saves: ${errorMessage(err)}`,
      };
    }
  }

  getLegacyStorageStatus(): LegacyLocalStorageStatus {
    if (this.backend === 'LOCAL_STORAGE_MOCK') {
      return { detected: false, keys: [], policy: 'NONE', detail: null };
    }
    return this.inspectLegacyLocalStorageSaves();
  }

  private openDb(relPath: string): Promise<IDBDatabase> {
    if (this.backend !== 'INDEXED_DB') {
      return Promise.reject(
        new FilePortIoError(
          'STORAGE_UNAVAILABLE',
          relPath,
          this._unavailableReason ?? 'IndexedDB backend is unavailable'
        )
      );
    }
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

  private probeLocalStorageSync(options?: StorageProbeOptions): StorageProbeResult {
    if (options?.shouldCancelBeforeMutation?.()) {
      return {
        available: false,
        cancelled: true,
        mutated: false,
        reason: 'localStorage probe cancelled before write (owner destroyed)',
      };
    }
    let probeMutationStarted = false;
    try {
      if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
        this._storageAvailable = false;
        this._unavailableReason = 'localStorage is undefined in current runtime';
        return { available: false, mutated: false, reason: this._unavailableReason };
      }
      const probe = `${this.prefix}__probe__`;
      // R5-03: Zero await gap between cancellation check and first persistent probe write
      if (options?.shouldCancelBeforeMutation?.()) {
        return {
          available: false,
          cancelled: true,
          mutated: false,
          reason: 'localStorage probe cancelled before write (owner destroyed)',
        };
      }
      probeMutationStarted = true;
      options?.onMutationStarted?.();
      globalThis.localStorage.setItem(probe, '1');
      let readBack: string | null = null;
      try {
        readBack = globalThis.localStorage.getItem(probe);
      } finally {
        globalThis.localStorage.removeItem(probe);
      }
      if (readBack !== '1') {
        this._storageAvailable = false;
        this._unavailableReason = 'localStorage probe readback mismatch';
        return { available: false, mutated: probeMutationStarted, reason: this._unavailableReason };
      }
      this._storageAvailable = true;
      this._unavailableReason = null;
      return { available: true, mutated: probeMutationStarted, reason: null };
    } catch (err) {
      this._storageAvailable = false;
      this._unavailableReason = `localStorage probe failed: ${errorMessage(err)}`;
      return { available: false, mutated: probeMutationStarted, reason: this._unavailableReason };
    }
  }

  private async probeIndexedDbAsync(options?: StorageProbeOptions): Promise<StorageProbeResult> {
    const probeKey = `${this.prefix}__probe__`;
    let probeMutationStarted = false;
    try {
      // R5-03 Check #1: Cancel before opening DB if owner already destroyed
      if (options?.shouldCancelBeforeMutation?.()) {
        return {
          available: false,
          cancelled: true,
          mutated: false,
          reason: 'IndexedDB probe cancelled before opening database (owner destroyed)',
        };
      }
      const db = await this.openDb('__probe__');
      // R5-03 Check #2: Re-check owner IMMEDIATELY after openDb resolves with ZERO await gap
      // before initiating the first persistent IndexedDB put transaction!
      if (options?.shouldCancelBeforeMutation?.()) {
        return {
          available: false,
          cancelled: true,
          mutated: false,
          reason: 'IndexedDB probe cancelled after opening database before first write (owner destroyed)',
        };
      }
      // Point of no return for probe persistence mutation: zero await gap before idbWriteStringKey!
      probeMutationStarted = true;
      options?.onMutationStarted?.();
      let writeSucceeded = false;
      let readBack: string | null = null;
      let opError: unknown = null;
      try {
        await idbWriteStringKey(db, probeKey, '1');
        writeSucceeded = true;
        readBack = await idbReadStringKey(db, probeKey, '__probe__');
      } catch (err) {
        opError = err;
      }
      if (writeSucceeded) {
        try {
          await idbDeleteKey(db, probeKey);
        } catch (delErr) {
          if (opError === null) opError = delErr;
        }
      }
      if (opError !== null) {
        throw opError;
      }
      if (readBack !== '1') {
        this._storageAvailable = false;
        this._unavailableReason = 'IndexedDB probe readback mismatch';
        return { available: false, mutated: probeMutationStarted, reason: this._unavailableReason };
      }
      this._storageAvailable = true;
      this._unavailableReason = null;
      return { available: true, mutated: probeMutationStarted, reason: null };
    } catch (err) {
      this._storageAvailable = false;
      this._unavailableReason = `IndexedDB probe failed: ${errorMessage(err)}`;
      return { available: false, mutated: probeMutationStarted, reason: this._unavailableReason };
    }
  }

  /**
   * Probes actual storage read/write capability without altering any real save slot or tx marker.
   * Never silently falls back to localStorage or ephemeral memory on failure.
   */
  probeStorage(options?: StorageProbeOptions): StorageProbeResult | Promise<StorageProbeResult> {
    if (this.backend === 'INDEXED_DB') {
      return this.probeIndexedDbAsync(options);
    }
    if (this.backend === 'LOCAL_STORAGE_MOCK') {
      return this.probeLocalStorageSync(options);
    }
    if (options?.shouldCancelBeforeMutation?.()) {
      return {
        available: false,
        cancelled: true,
        mutated: false,
        reason: 'Storage probe cancelled before execution (owner destroyed)',
      };
    }
    return {
      available: false,
      mutated: false,
      reason: this._unavailableReason ?? 'INDEXED_DB_UNAVAILABLE',
    };
  }

  private assertLocalStorageMockAvailable(relPath: string): Storage {
    if (
      this.backend !== 'LOCAL_STORAGE_MOCK' ||
      !this._storageAvailable ||
      typeof globalThis.localStorage === 'undefined' ||
      globalThis.localStorage === null
    ) {
      throw new FilePortIoError(
        'STORAGE_UNAVAILABLE',
        relPath,
        this._unavailableReason ?? 'Persistent storage is unavailable'
      );
    }
    return globalThis.localStorage;
  }

  async readTxState(): Promise<string | null> {
    const key = `${this.prefix}${BROWSER_TX_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_TX_STATE_KEY_SUFFIX);
      try {
        return await idbReadStringKey(db, key, BROWSER_TX_STATE_KEY_SUFFIX);
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('READ_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_TX_STATE_KEY_SUFFIX);
    try {
      return storage.getItem(key);
    } catch (err) {
      throw new FilePortIoError('READ_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
    }
  }

  async writeTxState(text: string): Promise<void> {
    const key = `${this.prefix}${BROWSER_TX_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_TX_STATE_KEY_SUFFIX);
      try {
        await idbWriteStringKey(db, key, text);
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError(
          isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
          BROWSER_TX_STATE_KEY_SUFFIX,
          errorMessage(err)
        );
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_TX_STATE_KEY_SUFFIX);
    try {
      storage.setItem(key, text);
    } catch (err) {
      throw new FilePortIoError(
        isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
        BROWSER_TX_STATE_KEY_SUFFIX,
        errorMessage(err)
      );
    }
  }

  async clearTxState(): Promise<void> {
    const key = `${this.prefix}${BROWSER_TX_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_TX_STATE_KEY_SUFFIX);
      try {
        await idbDeleteKey(db, key);
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_TX_STATE_KEY_SUFFIX);
    try {
      storage.removeItem(key);
    } catch (err) {
      throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_TX_STATE_KEY_SUFFIX, errorMessage(err));
    }
  }

  async readHistoryState(): Promise<string | null> {
    const key = `${this.prefix}${BROWSER_HISTORY_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
      try {
        return await idbReadStringKey(db, key, BROWSER_HISTORY_STATE_KEY_SUFFIX);
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('READ_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_HISTORY_STATE_KEY_SUFFIX);
    try {
      return storage.getItem(key);
    } catch (err) {
      throw new FilePortIoError('READ_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
    }
  }

  async writeHistoryState(text: string): Promise<void> {
    const key = `${this.prefix}${BROWSER_HISTORY_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
      try {
        await idbWriteStringKey(db, key, text);
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError(
          isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
          BROWSER_HISTORY_STATE_KEY_SUFFIX,
          errorMessage(err)
        );
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_HISTORY_STATE_KEY_SUFFIX);
    try {
      storage.setItem(key, text);
    } catch (err) {
      throw new FilePortIoError(
        isQuotaError(err) ? 'QUOTA_EXCEEDED' : 'WRITE_IO_ERROR',
        BROWSER_HISTORY_STATE_KEY_SUFFIX,
        errorMessage(err)
      );
    }
  }

  async clearHistoryState(): Promise<void> {
    const key = `${this.prefix}${BROWSER_HISTORY_STATE_KEY_SUFFIX}`;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(BROWSER_HISTORY_STATE_KEY_SUFFIX);
      try {
        await idbDeleteKey(db, key);
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(BROWSER_HISTORY_STATE_KEY_SUFFIX);
    try {
      storage.removeItem(key);
    } catch (err) {
      throw new FilePortIoError('REMOVE_IO_ERROR', BROWSER_HISTORY_STATE_KEY_SUFFIX, errorMessage(err));
    }
  }

  private totalStoredBytesLocalStorage(storage: Storage, excludeKey?: string): number {
    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(this.prefix) && k !== excludeKey) {
        const rel = k.slice(this.prefix.length);
        if (INTERNAL_KEY_SUFFIXES.has(rel)) continue;
        total += (storage.getItem(k) ?? '').length;
      }
    }
    return total;
  }

  async read(relPath: string): Promise<string | null> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(clean);
      try {
        return await idbReadStringKey(db, key, clean);
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('READ_IO_ERROR', clean, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(clean);
    try {
      return storage.getItem(key);
    } catch (err) {
      throw new FilePortIoError('READ_IO_ERROR', clean, errorMessage(err));
    }
  }

  async write(relPath: string, text: string): Promise<void> {
    const clean = validatePath(relPath);
    const key = this.prefix + clean;
    if (this.backend === 'INDEXED_DB') {
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
            try {
              const cursor = cursorReq.result;
              if (cursor) {
                const k = String(cursor.key);
                if (k.startsWith(this.prefix) && k !== key && typeof cursor.value === 'string') {
                  const rel = k.slice(this.prefix.length);
                  if (!INTERNAL_KEY_SUFFIXES.has(rel)) {
                    totalOtherBytes += cursor.value.length;
                  }
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
            } catch (syncErr) {
              abortedForQuota = true;
              try {
                tx.abort();
              } catch {
                // ignore abort error
              }
              reject(syncErr);
            }
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
    const storage = this.assertLocalStorageMockAvailable(clean);
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
    if (this.backend === 'INDEXED_DB') {
      const db = await this.openDb(clean);
      try {
        await idbDeleteKey(db, key);
        return;
      } catch (err) {
        if (err instanceof FilePortIoError) throw err;
        throw new FilePortIoError('REMOVE_IO_ERROR', clean, errorMessage(err));
      }
    }
    const storage = this.assertLocalStorageMockAvailable(clean);
    try {
      storage.removeItem(key);
    } catch (err) {
      throw new FilePortIoError('REMOVE_IO_ERROR', clean, errorMessage(err));
    }
  }

  async list(dir = ''): Promise<string[]> {
    const subPrefix = dir ? `${this.prefix}${validatePath(dir)}/` : this.prefix;
    if (this.backend === 'INDEXED_DB') {
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
              .map((k) => k.slice(subPrefix.length))
              .filter((rel) => dir !== '' || !INTERNAL_KEY_SUFFIXES.has(rel));
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
    const storage = this.assertLocalStorageMockAvailable(dir || '.');
    const names: string[] = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(subPrefix)) {
          const rel = k.slice(subPrefix.length);
          if (dir === '' && INTERNAL_KEY_SUFFIXES.has(rel)) continue;
          names.push(rel);
        }
      }
    } catch (err) {
      throw new FilePortIoError('LIST_IO_ERROR', dir || '.', errorMessage(err));
    }
    return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async clearAll(): Promise<void> {
    if (this.backend === 'UNAVAILABLE') return;
    const files = await this.list();
    for (const f of files) {
      await this.remove(f);
    }
    await this.clearTxState();
    await this.clearHistoryState();
  }
}

let nextMemoryPortId = 1;

export class MemoryFilePort implements FilePort {
  readonly kind = 'MEMORY' as const;
  readonly storageKey: string;
  private readonly files = new Map<string, string>();
  private txState: string | null = null;
  private historyState: string | null = null;
  private readonly maxBytes: number;

  constructor(maxBytes = 10 * 1024 * 1024, namespace?: string) {
    this.storageKey = namespace ? `memory:${namespace}` : `memory:instance_${nextMemoryPortId++}`;
    this.maxBytes = maxBytes;
  }

  probeStorage(options?: StorageProbeOptions): StorageProbeResult {
    if (options?.shouldCancelBeforeMutation?.()) {
      return {
        available: false,
        cancelled: true,
        mutated: false,
        reason: 'Memory storage probe cancelled (owner destroyed)',
      };
    }
    return { available: true, mutated: false, reason: null };
  }

  async readTxState(): Promise<string | null> {
    return this.txState;
  }

  async writeTxState(text: string): Promise<void> {
    this.txState = text;
  }

  async clearTxState(): Promise<void> {
    this.txState = null;
  }

  async readHistoryState(): Promise<string | null> {
    return this.historyState;
  }

  async writeHistoryState(text: string): Promise<void> {
    this.historyState = text;
  }

  async clearHistoryState(): Promise<void> {
    this.historyState = null;
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
