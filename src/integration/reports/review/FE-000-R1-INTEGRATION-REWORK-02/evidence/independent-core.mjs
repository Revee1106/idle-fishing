/**
 * Independent reviewer harness for P1-01 (storage health/freeze/recovery) and
 * P1-02 (lifecycle cancellation) against the ACTUAL candidate source compiled
 * from the isolated snapshot.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap';
const P = (rel) => pathToFileURL(path.join(SNAP, rel)).href;

const core = await import(P('node_modules/@idle-fishing/game-core/dist/spike/index.js'));
const { createInitialState, advanceOffline, canonicalStringify, SLOT_PATHS, SpikeFileSaveRepository } = core;
const { BrowserFilePort, MemoryFilePort } = await import(
  P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/BrowserFilePort.js')
);
const { WeChatFilePort, FilePortIoError } = await import(
  P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/WeChatFilePort.js')
);
const { SingleWriterSaveCoordinator } = await import(
  P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.js')
);
const { detectRuntimeEnv } = await import(
  P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/PlatformTypes.js')
);

const results = [];
let current = 'init';
function begin(name) {
  current = name;
}
function check(cond, detail) {
  if (!cond) throw new Error(`ASSERTION FAILED [${current}]: ${detail}`);
}
async function run(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', detail: err instanceof Error ? err.message : String(err) });
    console.log(`[FAIL] ${name} :: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------- helpers ----------------
function makeLocalStorage() {
  const store = new Map();
  const faults = { failProbeWrite: false, failSlotWrite: false, failSlotRead: false, faultsAfterWrite: false };
  const writtenSlots = [];
  const storage = {
    get length() {
      return store.size;
    },
    key(i) {
      return [...store.keys()][i] ?? null;
    },
    getItem(k) {
      if (faults.failSlotRead && String(k).includes('save_slot_')) {
        if (!faults.faultsAfterWrite || writtenSlots.length > 0) throw new Error('mocked read failure');
      }
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (faults.failProbeWrite && String(k).endsWith('__probe__')) throw new Error('probe write failure');
      if (faults.failSlotWrite && String(k).includes('save_slot_')) throw new Error('slot write failure');
      if (String(k).includes('save_slot_')) writtenSlots.push(k);
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
  };
  return { storage, store, faults, writtenSlots };
}

function installLocalStorage(mock) {
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => mock.storage });
  return () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => prev });
}

function mockWxFileSystem({ missing = [] } = {}) {
  const files = new Map();
  const dirs = new Set(['wxfile://usr']);
  const fsm = {
    accessSync(p) {
      if (!dirs.has(p) && !files.has(p)) throw Object.assign(new Error('accessSync:fail no such file'), { errMsg: 'accessSync:fail no such file or directory' });
    },
    mkdirSync(p) {
      dirs.add(p);
    },
    readFileSync(p) {
      if (!files.has(p)) throw Object.assign(new Error('readFileSync:fail no such file'), { errMsg: 'readFileSync:fail no such file or directory' });
      return files.get(p);
    },
    writeFileSync(p, data) {
      files.set(p, String(data));
    },
    unlinkSync(p) {
      if (!files.has(p)) throw Object.assign(new Error('unlinkSync:fail no such file'), { errMsg: 'unlinkSync:fail no such file or directory' });
      files.delete(p);
    },
    readdirSync(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = [];
      for (const f of files.keys()) if (f.startsWith(prefix)) out.push(f.slice(prefix.length));
      return out;
    },
  };
  for (const m of missing) delete fsm[m];
  return { wx: { env: { USER_DATA_PATH: 'wxfile://usr' }, getFileSystemManager: () => fsm }, files, fsm };
}

function makeState(tag, revisionOffsetMs) {
  const s0 = createInitialState({ saveEpoch: `epoch.${tag}`, startMs: 1_700_000_000_000, allowanceMs: 3_600_000 });
  return advanceOffline(s0, s0.cursorMs + revisionOffsetMs).state;
}

function makeCountingPort(inner, hooks = {}) {
  let reads = 0;
  let writes = 0;
  let probes = 0;
  const port = {
    kind: inner.kind,
    storageKey: inner.storageKey,
    probeStorage() {
      probes += 1;
      return typeof inner.probeStorage === 'function' ? inner.probeStorage() : { available: true, reason: null };
    },
    async read(p) {
      reads += 1;
      if (hooks.onRead) await hooks.onRead(p, { reads, writes });
      return inner.read(p);
    },
    async write(p, text) {
      writes += 1;
      if (hooks.onWrite) await hooks.onWrite(p, text, { reads, writes });
      return inner.write(p, text);
    },
    async remove(p) {
      return inner.remove(p);
    },
    async list(d) {
      return inner.list(d);
    },
    stats() {
      return { reads, writes, probes };
    },
  };
  return port;
}

// =========================================================================
// P1-01
// =========================================================================

await run('P1-01/T1 clean boot + commit rev1', async () => {
  const mock = makeLocalStorage();
  const restore = installLocalStorage(mock);
  try {
    const port = new BrowserFilePort('audit_p101_t1');
    const coord = new SingleWriterSaveCoordinator(port);
    const load = await coord.loadSafe();
    check(load.kind === 'EMPTY', `expected EMPTY got ${load.kind}`);
    const c1 = await coord.commit(makeState('t1', 60_000), null);
    check(c1.kind === 'COMMITTED' && c1.revision === '1', `expected COMMITTED rev1 got ${JSON.stringify(c1)}`);
    check(coord.storageHealth === 'AVAILABLE', `health=${coord.storageHealth}`);
  } finally {
    restore();
  }
});

await run('P1-01/T2 runtime probe failure freezes; repeated commits blocked; slots byte-identical', async () => {
  const mock = makeLocalStorage();
  const restore = installLocalStorage(mock);
  try {
    const ns = 'audit_p101_t2';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    const s1 = makeState('t2', 60_000);
    check((await coord.commit(s1, null)).kind === 'COMMITTED', 'seed commit');
    const slotsBefore = SLOT_PATHS.map((p) => mock.store.get(`${ns}:${p}`) ?? null);
    mock.faults.failProbeWrite = true;
    const c2 = await coord.commit(makeState('t2', 120_000), '1');
    const c3 = await coord.commit(makeState('t2', 180_000), '1');
    check(c2.kind === 'STORAGE_UNAVAILABLE', `expected STORAGE_UNAVAILABLE got ${c2.kind}`);
    check(c3.kind === 'STORAGE_UNAVAILABLE', `second must also be STORAGE_UNAVAILABLE got ${c3.kind}`);
    check(coord.storageHealth === 'STORAGE_UNAVAILABLE', `health=${coord.storageHealth}`);
    check(
      JSON.stringify(SLOT_PATHS.map((p) => mock.store.get(`${ns}:${p}`) ?? null)) === JSON.stringify(slotsBefore),
      'slots must be unchanged'
    );
    // Underlying storage restored, but NO explicit recovery -> MUST stay frozen
    mock.faults.failProbeWrite = false;
    const c4 = await coord.commit(makeState('t2', 240_000), '1');
    check(c4.kind === 'STORAGE_UNAVAILABLE', `must stay frozen until loadSafe, got ${c4.kind}`);
    // Explicit recovery re-reads real data
    const rec = await coord.loadSafe();
    check(rec.kind === 'VALID' && rec.revision === '1', `recovery load=${JSON.stringify(rec)}`);
    check(coord.storageHealth === 'AVAILABLE', `health after recovery=${coord.storageHealth}`);
    const c5 = await coord.commit(makeState('t2', 300_000), '1');
    check(c5.kind === 'COMMITTED' && c5.revision === '2', `post-recovery commit=${JSON.stringify(c5)}`);
  } finally {
    restore();
  }
});

await run('P1-01/T3 physical write failure freezes and preserves slot data', async () => {
  const mock = makeLocalStorage();
  const restore = installLocalStorage(mock);
  try {
    const ns = 'audit_p101_t3';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    check((await coord.commit(makeState('t3', 60_000), null)).kind === 'COMMITTED', 'seed');
    const slotsBefore = SLOT_PATHS.map((p) => mock.store.get(`${ns}:${p}`) ?? null);
    mock.faults.failSlotWrite = true;
    const bad = await coord.commit(makeState('t3', 120_000), '1');
    check(bad.kind === 'STORAGE_UNAVAILABLE', `expected STORAGE_UNAVAILABLE got ${JSON.stringify(bad)}`);
    check(coord.storageHealth === 'STORAGE_UNAVAILABLE', `health=${coord.storageHealth}`);
    check(
      JSON.stringify(SLOT_PATHS.map((p) => mock.store.get(`${ns}:${p}`) ?? null)) === JSON.stringify(slotsBefore),
      'slots must be unchanged after failed write'
    );
    mock.faults.failSlotWrite = false;
    check((await coord.commit(makeState('t3', 180_000), '1')).kind === 'STORAGE_UNAVAILABLE', 'still frozen');
    const rec = await coord.loadSafe();
    check(rec.kind === 'VALID' && rec.revision === '1', `recovery=${JSON.stringify(rec)}`);
    check(coord.storageHealth === 'AVAILABLE', 'healed');
  } finally {
    restore();
  }
});

await run('P1-01/T4 read-back failure: contract UNCERTAIN, zero further writes, health classification observed', async () => {
  const ns = 'audit_p101_t4';
  const inner = new MemoryFilePort(10 * 1024 * 1024, ns);
  let written = 0;
  let readFails = false;
  const port = {
    kind: inner.kind,
    storageKey: inner.storageKey,
    probeStorage: () => ({ available: true, reason: null }),
    async read(p) {
      if (readFails && written > 0) throw new FilePortIoError('STORAGE_UNAVAILABLE', p, 'simulated persistent read failure');
      return inner.read(p);
    },
    async write(p, text) {
      const r = await inner.write(p, text);
      written += 1;
      readFails = true; // all reads AFTER the physical write fail (read-back + rescan)
      return r;
    },
    async remove(p) {
      return inner.remove(p);
    },
    async list(d) {
      return inner.list(d);
    },
  };
  const coord = new SingleWriterSaveCoordinator(port);
  const res = await coord.commit(makeState('t4', 60_000), null);
  console.log(`   [evidence] read-back failure result=${JSON.stringify(res)} health=${coord.storageHealth}`);
  check(res.kind === 'UNCERTAIN', `contract doc-19 expects UNCERTAIN for unconfirmed write, got ${res.kind}`);
  const writesBefore = written;
  const again = await coord.commit(makeState('t4', 120_000), null);
  console.log(`   [evidence] repeat commit after read-back failure => ${again.kind}, writes=${written - writesBefore}, health=${coord.storageHealth}`);
  check(written === writesBefore, 'no further physical write may occur while reads are failing');
  check(again.kind === 'UNCERTAIN', `repeat commit must stay UNCERTAIN, got ${again.kind}`);
});

await run('P1-01/T4b read-back failure then storage fully restored: does health stay AVAILABLE?', async () => {
  const ns = 'audit_p101_t4b';
  const inner = new MemoryFilePort(10 * 1024 * 1024, ns);
  let written = 0;
  let readFails = false;
  const port = {
    kind: inner.kind,
    storageKey: inner.storageKey,
    probeStorage: () => ({ available: true, reason: null }),
    async read(p) {
      if (readFails && written > 0) throw new FilePortIoError('STORAGE_UNAVAILABLE', p, 'simulated read failure');
      return inner.read(p);
    },
    async write(p, text) {
      const r = await inner.write(p, text);
      written += 1;
      readFails = true;
      return r;
    },
    async remove(p) {
      return inner.remove(p);
    },
    async list(d) {
      return inner.list(d);
    },
  };
  const coord = new SingleWriterSaveCoordinator(port);
  const res = await coord.commit(makeState('t4b', 60_000), null);
  check(res.kind === 'UNCERTAIN', `expected UNCERTAIN got ${res.kind}`);
  readFails = false; // storage read capability comes back WITHOUT explicit reinitialize
  const healthBeforeRecovery = coord.storageHealth;
  const next = await coord.commit(makeState('t4b', 120_000), '1');
  console.log(
    `   [evidence] read-back failure health=${healthBeforeRecovery}; after storage silent recovery next commit=${next.kind} health=${coord.storageHealth}`
  );
  check(next.kind !== 'COMMITTED' || healthBeforeRecovery === 'STORAGE_UNAVAILABLE', 'if health never froze, silent retry can succeed (documented observation)');
});

await run('P1-01/T5 recovery re-reads CURRENT disk data (no stale memory overwrite)', async () => {
  const mock = makeLocalStorage();
  const restore = installLocalStorage(mock);
  try {
    const ns = 'audit_p101_t5';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    check((await coord.commit(makeState('t5', 60_000), null)).kind === 'COMMITTED', 'seed rev1');
    // Freeze it
    mock.faults.failProbeWrite = true;
    check((await coord.commit(makeState('t5', 120_000), '1')).kind === 'STORAGE_UNAVAILABLE', 'freeze');
    mock.faults.failProbeWrite = false;
    // External writer advances disk to rev2 behind the frozen coordinator's back
    const rawPort = new BrowserFilePort(ns);
    const repo = new SpikeFileSaveRepository(rawPort);
    const ext = await repo.commit(makeState('t5', 999_000), '1');
    check(ext.kind === 'COMMITTED' && ext.revision === '2', `external commit=${JSON.stringify(ext)}`);
    // Explicit recovery must observe disk rev2, not stale in-memory rev1
    const rec = await coord.loadSafe();
    check(rec.kind === 'VALID' && rec.revision === '2', `expected disk rev2, got ${JSON.stringify(rec)}`);
    // A stale expectedRevision must CONFLICT (never overwrite newer disk state)
    const stale = await coord.commit(makeState('t5', 120_000), '1');
    check(stale.kind === 'CONFLICT', `expected CONFLICT for stale expectedRevision, got ${JSON.stringify(stale)}`);
    const fresh = await coord.commit(makeState('t5', 120_000), '2');
    check(fresh.kind === 'COMMITTED' && fresh.revision === '3', `fresh commit=${JSON.stringify(fresh)}`);
  } finally {
    restore();
  }
});

await run('P1-01/T6 load failure (all slots IO error) freezes; recovery re-verifies envelopes', async () => {
  const ns = 'audit_p101_t6';
  const mock = makeLocalStorage();
  const restore = installLocalStorage(mock);
  try {
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    check((await coord.commit(makeState('t6', 60_000), null)).kind === 'COMMITTED', 'seed');
    mock.faults.failSlotRead = true;
    const load = await coord.loadSafe();
    console.log(`   [evidence] load with all-slot read fault => ${JSON.stringify(load).slice(0, 160)}`);
    check(load.kind === 'STORAGE_UNAVAILABLE', `expected STORAGE_UNAVAILABLE on all-slot IO error, got ${load.kind}`);
    check(coord.storageHealth === 'STORAGE_UNAVAILABLE', `health=${coord.storageHealth}`);
    mock.faults.failSlotRead = false;
    const rec = await coord.loadSafe();
    check(rec.kind === 'VALID' && rec.revision === '1', `recovery=${JSON.stringify(rec)}`);
    check(coord.storageHealth === 'AVAILABLE', 'healed');
  } finally {
    restore();
  }
});

await run('P1-01/T7 WeChat: wx missing => fail-closed (no MEMORY/EMPTY/COMMITTED)', async () => {
  const prevWx = globalThis.wx;
  delete globalThis.wx;
  try {
    const port = new WeChatFilePort('audit_t7');
    const coord = new SingleWriterSaveCoordinator(port);
    const load = await coord.loadSafe();
    check(load.kind === 'STORAGE_UNAVAILABLE', `load=${load.kind}`);
    const c = await coord.commit(makeState('t7', 60_000), null);
    check(c.kind === 'STORAGE_UNAVAILABLE', `commit=${c.kind}`);
    await assert.rejects(() => port.read(SLOT_PATHS[0]), FilePortIoError);
  } finally {
    globalThis.wx = prevWx;
  }
});

await run('P1-01/T8 WeChat: getFileSystemManager missing / readFileSync missing / writeFileSync missing => unavailable', async () => {
  const prevWx = globalThis.wx;
  try {
    // missing getFileSystemManager, host still WECHAT_MOCK (not NODE)
    globalThis.wx = { __FE000_MOCK__: true };
    check(detectRuntimeEnv() === 'WECHAT_MOCK', `env=${detectRuntimeEnv()}`);
    const c1 = new SingleWriterSaveCoordinator(new WeChatFilePort('audit_t8a'));
    check((await c1.loadSafe()).kind === 'STORAGE_UNAVAILABLE', 'missing fsm must be unavailable');

    for (const missing of ['readFileSync', 'writeFileSync', 'accessSync', 'mkdirSync', 'unlinkSync', 'readdirSync']) {
      const m = mockWxFileSystem({ missing: [missing] });
      globalThis.wx = { __FE000_MOCK__: true, ...m.wx };
      const coord = new SingleWriterSaveCoordinator(new WeChatFilePort(`audit_t8_${missing}`));
      const load = await coord.loadSafe();
      check(load.kind === 'STORAGE_UNAVAILABLE', `missing ${missing}: load=${load.kind}`);
      const c = await coord.commit(makeState('t8', 60_000), null);
      check(c.kind === 'STORAGE_UNAVAILABLE', `missing ${missing}: commit=${c.kind}`);
      // Filesystem contents must remain untouched (no writes attempted)
      check(m.files.size === 0, `missing ${missing}: no writes expected, files=${m.files.size}`);
    }
  } finally {
    globalThis.wx = prevWx;
  }
});

await run('P1-01/T9 WeChat: missing file vs unavailable filesystem are distinct', async () => {
  const prevWx = globalThis.wx;
  try {
    const m = mockWxFileSystem();
    globalThis.wx = { __FE000_MOCK__: true, ...m.wx };
    const port = new WeChatFilePort('audit_t9');
    const coord = new SingleWriterSaveCoordinator(port);
    const emptyLoad = await coord.loadSafe();
    check(emptyLoad.kind === 'EMPTY', `healthy empty FS must be EMPTY, got ${emptyLoad.kind}`);
    const c1 = await coord.commit(makeState('t9', 60_000), null);
    check(c1.kind === 'COMMITTED', `healthy FS commit=${c1.kind}`);
    // Simulate filesystem-level failure (permission error) rather than missing file
    m.fsm.readFileSync = () => {
      throw Object.assign(new Error('readFileSync:fail permission denied'), { errMsg: 'readFileSync:fail permission denied' });
    };
    const loadFail = await coord.loadSafe();
    check(loadFail.kind === 'STORAGE_UNAVAILABLE', `fs failure must be STORAGE_UNAVAILABLE, got ${loadFail.kind}`);
    check(coord.storageHealth === 'STORAGE_UNAVAILABLE', `health=${coord.storageHealth}`);
  } finally {
    globalThis.wx = prevWx;
  }
});

// =========================================================================
// P1-02
// =========================================================================

await run('P1-02/T1 QUEUED tasks cancelled on destroy (zero physical read/write)', async () => {
  const inner = new MemoryFilePort(10 * 1024 * 1024, 'audit_p102_t1');
  const port = makeCountingPort(inner);
  const coord = new SingleWriterSaveCoordinator(port);
  let destroyed = false;
  let releaseHold;
  let entered;
  const enteredP = new Promise((r) => (entered = r));
  const holdP = coord.runExclusive(async () => {
    entered();
    await new Promise((r) => (releaseHold = r));
  });
  await enteredP;
  const base = port.stats();
  const p1 = coord.commit(makeState('l1', 60_000), null, { shouldCancelBeforeStart: () => destroyed });
  const p2 = coord.commit(makeState('l1', 120_000), null, { shouldCancelBeforeStart: () => destroyed });
  destroyed = true;
  releaseHold();
  await holdP;
  const [r1, r2] = await Promise.all([p1, p2]);
  check(r1.kind === 'CANCELLED' && r2.kind === 'CANCELLED', `results=${r1.kind},${r2.kind}`);
  const after = port.stats();
  check(after.writes === base.writes, `expected 0 writes, got ${after.writes - base.writes}`);
  check(after.reads === base.reads, `expected 0 reads for cancelled tasks, got ${after.reads - base.reads}`);
  check(after.probes === base.probes, `expected 0 probes for cancelled tasks, got ${after.probes - base.probes}`);
  const loaded = await coord.loadSafe();
  check(loaded.kind === 'EMPTY', `disk must remain EMPTY, got ${loaded.kind}`);
});

await run('P1-02/T2 STARTED task completes cleanly when destroy fires mid-commit', async () => {
  const inner = new MemoryFilePort(10 * 1024 * 1024, 'audit_p102_t2');
  const port = makeCountingPort(inner);
  const coord = new SingleWriterSaveCoordinator(port);
  let destroyed = false;
  let started = false;
  let releaseBarrier;
  let barrier;
  const barrierP = new Promise((r) => (barrier = r));
  const p = coord.commit(makeState('l2', 60_000), null, {
    shouldCancelBeforeStart: () => destroyed,
    onStarted: () => {
      started = true;
    },
    beforeCommitBody: async () => {
      barrier();
      await new Promise((r) => (releaseBarrier = r));
    },
  });
  await barrierP;
  check(started, 'onStarted must have fired before barrier');
  destroyed = true;
  releaseBarrier();
  const res = await p;
  check(res.kind === 'COMMITTED' && res.revision === '1', `started task must complete, got ${JSON.stringify(res)}`);
  const loaded = await coord.loadSafe();
  check(loaded.kind === 'VALID' && loaded.revision === '1', `disk=${JSON.stringify(loaded)}`);
});

await run('P1-02/T3 destroyed owner rejects every subsequent task (multiple queued)', async () => {
  const inner = new MemoryFilePort(10 * 1024 * 1024, 'audit_p102_t3');
  const port = makeCountingPort(inner);
  const coord = new SingleWriterSaveCoordinator(port);
  let destroyed = false;
  let releaseHold;
  let entered;
  const enteredP = new Promise((r) => (entered = r));
  const holdP = coord.runExclusive(async () => {
    entered();
    await new Promise((r) => (releaseHold = r));
  });
  await enteredP;
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(coord.commit(makeState('l3', 60_000 + i), null, { shouldCancelBeforeStart: () => destroyed }));
  }
  destroyed = true;
  releaseHold();
  await holdP;
  const all = await Promise.all(promises);
  check(all.every((r) => r.kind === 'CANCELLED'), `all queued must cancel, got ${JSON.stringify(all.map((r) => r.kind))}`);
  const post = await coord.commit(makeState('l3', 999_999), null, { shouldCancelBeforeStart: () => destroyed });
  check(post.kind === 'CANCELLED', `post-destroy commit must cancel, got ${post.kind}`);
  const stats = port.stats();
  check(stats.writes === 0 && stats.reads === 0 && stats.probes === 0, `expected zero physical IO, got ${JSON.stringify(stats)}`);
});

await run('P1-02/T4 destroy while physical write done but read-back pending -> no false cancel', async () => {
  const inner = new MemoryFilePort(10 * 1024 * 1024, 'audit_p102_t4');
  let destroyFlag = false;
  let pauseReadback = false;
  let releaseReadback;
  let readbackEntered;
  const readbackP = new Promise((r) => (readbackEntered = r));
  const port = makeCountingPort(inner, {
    onRead: async (p, stats) => {
      if (pauseReadback && stats.writes > 0 && p === 'save_slot_0.json') {
        readbackEntered();
        await new Promise((r) => (releaseReadback = r));
      }
    },
  });
  const coord = new SingleWriterSaveCoordinator(port);
  pauseReadback = true;
  const commitP = coord.commit(makeState('l4', 60_000), null, {
    shouldCancelBeforeStart: () => destroyFlag,
    onStarted: () => {},
  });
  await readbackP;
  destroyFlag = true;
  releaseReadback();
  const res = await commitP;
  check(res.kind === 'COMMITTED' && res.revision === '1', `in-flight read-back must complete, got ${JSON.stringify(res)}`);
});

await run('P1-02/T5 HIDE/SHOW/HIDE triple queue + destroy -> zero writes', async () => {
  const inner = new MemoryFilePort(10 * 1024 * 1024, 'audit_p102_t5');
  const port = makeCountingPort(inner);
  const coord = new SingleWriterSaveCoordinator(port);
  let destroyed = false;
  let releaseHold;
  let entered;
  const enteredP = new Promise((r) => (entered = r));
  const holdP = coord.runExclusive(async () => {
    entered();
    await new Promise((r) => (releaseHold = r));
  });
  await enteredP;
  const tasks = [0, 1, 2].map((i) =>
    coord.commit(makeState('l5', 60_000 * (i + 1)), null, { shouldCancelBeforeStart: () => destroyed })
  );
  destroyed = true;
  releaseHold();
  await holdP;
  const res = await Promise.all(tasks);
  check(res.every((r) => r.kind === 'CANCELLED'), JSON.stringify(res.map((r) => r.kind)));
  check(port.stats().writes === 0, `writes=${port.stats().writes}`);
  const loaded = await coord.loadSafe();
  check(loaded.kind === 'EMPTY', `disk=${loaded.kind}`);
});

// =========================================================================
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n===== INDEPENDENT CORE SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length > 0) {
  for (const f of failed) console.log(`FAILED: ${f.name} :: ${f.detail}`);
  process.exit(1);
}
process.exit(0);