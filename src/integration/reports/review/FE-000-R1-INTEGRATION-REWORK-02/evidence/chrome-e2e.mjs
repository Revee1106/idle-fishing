/**
 * Independent reviewer Chrome E2E for P2-04 (cross-tab Web Locks) + P1-01/P1-02 combinations.
 * Runs against the snapshot build produced from the candidate source.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREFIX = 'idle_fishing_lifecycle_persist_fs:';
const LOCK_NAME = 'idle-fishing:save:browser:idle_fishing_lifecycle_persist_fs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream',
};
function startServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); res.end('Not Found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(full).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) this.events.push(msg);
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) throw new Error(`Runtime exception: ${JSON.stringify(res.exceptionDetails).slice(0, 300)}`);
    return res.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`TIMEOUT waiting for ${label}`);
}
async function waitHttp(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome DevTools endpoint timeout');
}

if (!fs.existsSync(path.join(WEB, 'index.html'))) {
  console.error('missing web build');
  process.exit(1);
}
const { server, port } = await startServer(WEB);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r2-audit-chrome-'));
const debugPort = 9400 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}/`;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-precise-memory-info', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let cdpA = null;
let cdpB = null;
let cdpC = null;
const pageTargets = new Set();
async function connectTarget(targetId) {
  const info = await waitUntil(async () => {
    const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await r.json();
    return list.find((t) => t.id === targetId && t.webSocketDebuggerUrl) || null;
  }, 15000, `target ${targetId}`);
  const c = new Cdp(info.webSocketDebuggerUrl);
  await c.open();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  pageTargets.add(targetId);
  return c;
}
async function openTab(controller) {
  const { targetId } = await controller.send('Target.createTarget', { url: baseUrl });
  const c = await connectTarget(targetId);
  await waitUntil(() => c.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'boot ready');
  await new Promise((r) => setTimeout(r, 400));
  return { c, targetId };
}
const H = (c, expr) => c.eval(`globalThis.__SPIKE_HARNESS__.${expr}`);
const diskTop = (c) => c.eval(`(() => { const envs=[0,1,2].map(i=>localStorage.getItem(${JSON.stringify(PREFIX)}+'save_slot_'+i+'.json')).filter(Boolean).map(t=>JSON.parse(t)); const top=envs.sort((a,b)=>Number(b.revision)-Number(a.revision))[0]; return top ? { rev: top.revision, cursorMs: JSON.parse(top.payload).cursorMs, count: envs.length } : { rev: null, cursorMs: null, count: 0 }; })()`);

try {
  const target = await waitHttp(debugPort);
  cdpA = await connectTarget(target.id);
  await cdpA.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdpA.send('Page.navigate', { url: baseUrl });
  await waitUntil(() => cdpA.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'Tab A boot');
  await new Promise((r) => setTimeout(r, 400));

  // T1 boot sanity + Web Locks availability + lock identity
  {
    const info = await cdpA.eval(`(async () => ({
      hasLocks: Boolean(navigator.locks && typeof navigator.locks.request === 'function'),
      storageKey: globalThis.__SPIKE_HARNESS__.getPersistCoordinator().storageKey,
      snapshot: globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence,
    }))()`);
    record('chrome/T1 boot + Web Locks present + shared lock identity', info.hasLocks === true && info.storageKey === 'browser:idle_fishing_lifecycle_persist_fs', JSON.stringify({ hasLocks: info.hasLocks, storageKey: info.storageKey, loadStatus: info.snapshot?.loadStatus }));
  }

  const { c: tabB } = await openTab(cdpA);
  cdpB = tabB;
  await cdpA.send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 400));
  await H(cdpA, 'awaitPendingHideSave()');
  await H(cdpB, 'awaitPendingHideSave()');
  await H(cdpA, 'clearLifecyclePersistence()');
  await H(cdpB, 'reinitializePersistence()');

  // T2 loadSafe (boot) is covered by the cross-tab lock
  {
    await cdpB.eval(`(() => { window.__HOLD__ = false; navigator.locks.request(${JSON.stringify(LOCK_NAME)}, { mode: 'exclusive' }, () => new Promise((r) => { window.__HOLD_REL__ = r; window.__HOLD__ = true; })); return true; })()`);
    await waitUntil(() => cdpB.eval('Boolean(window.__HOLD__)'), 5000, 'Tab B manual lock');
    await cdpA.eval(`globalThis.__AUDIT_MARK__ = 'stale-context'`);
    await cdpA.send('Page.bringToFront');
    await cdpA.send('Page.reload', { ignoreCache: true });
    await waitUntil(async () => {
      try {
        return (await cdpA.eval('globalThis.__AUDIT_MARK__ === undefined')) === true;
      } catch {
        return false;
      }
    }, 15000, 'Tab A new execution context');
    await new Promise((r) => setTimeout(r, 800));
    const readyWhileLocked = await cdpA.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`).catch(() => false);
    await cdpB.eval('window.__HOLD_REL__()');
    await waitUntil(() => cdpA.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'Tab A boot completes after lock release');
    const rec = await H(cdpA, 'getSnapshot().lifecyclePersistence');
    record('chrome/T2 boot loadSafe blocked by cross-tab lock until release', readyWhileLocked === false && rec?.loadStatus === 'EMPTY', JSON.stringify({ readyWhileLocked, after: rec?.loadStatus, rev: rec?.revision }));
  }

  // Reset
  await cdpA.send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 300));
  await H(cdpA, 'awaitPendingHideSave()');
  await H(cdpB, 'awaitPendingHideSave()');
  await H(cdpA, 'clearLifecyclePersistence()');
  await H(cdpB, 'reinitializePersistence()');

  // T3 real dual-tab concurrent race with a deterministic overlap barrier
  {
    await cdpA.eval(`(() => {
      window.__A_HELD = false; window.__A_REL = null;
      window.__A_P = globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(60000, null, async () => {
        window.__A_HELD = true;
        await new Promise((r) => { window.__A_REL = r; });
      });
      return true;
    })()`);
    await waitUntil(() => cdpA.eval('Boolean(window.__A_HELD)'), 10000, 'Tab A holds Web Lock inside commit');
    await cdpB.eval(`(() => {
      window.__B_STATUS = 'pending';
      window.__B_P = globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(180000, null);
      window.__B_P.then((r) => { window.__B_RESULT = r; window.__B_RESULT_JSON = JSON.stringify(r); window.__B_STATUS = 'done'; }).catch((e) => { window.__B_RESULT = { error: String(e) }; window.__B_RESULT_JSON = JSON.stringify({ error: String(e), stack: e && e.stack }); window.__B_STATUS = 'error'; });
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    const bStatusWhileHeld = await cdpB.eval('window.__B_STATUS');
    const slotsWhileHeld = await cdpB.eval(`[0,1,2].map((i) => localStorage.getItem(${JSON.stringify(PREFIX)} + 'save_slot_' + i + '.json'))`);
    await cdpA.eval('window.__A_REL()');
    const aRes = await cdpA.eval('window.__A_P');
    await waitUntil(async () => (await cdpB.eval('window.__B_STATUS')) !== 'pending', 15000, 'Tab B commit resolves');
    await new Promise((r) => setTimeout(r, 200));
    const bStatusFinal = await cdpB.eval('window.__B_STATUS');
    const bResJson = await cdpB.eval('window.__B_RESULT_JSON');
    const bRes = bResJson ? JSON.parse(bResJson).res ?? JSON.parse(bResJson) : null;
    const diskAfterRace = await diskTop(cdpB);
    const bReloaded = await H(cdpB, 'reinitializePersistence()');
    await cdpA.send('Page.bringToFront');
    await cdpA.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdpA.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'Tab A reload after race');
    await new Promise((r) => setTimeout(r, 300));
    const aReloaded = await H(cdpA, 'getSnapshot().lifecyclePersistence');
    const expectCursor = aRes?.candidateCursorMs;
    record(
      'chrome/T3 dual-tab race: Tab B blocked while A holds lock; exactly 1 COMMITTED + 1 CONFLICT; disk holds only winner',
      bStatusWhileHeld === 'pending' && slotsWhileHeld.every((s) => s === null) &&
        aRes?.res?.kind === 'COMMITTED' && aRes?.res?.revision === '1' && bRes?.kind === 'CONFLICT' &&
        diskAfterRace.count === 1 && diskAfterRace.rev === '1' && diskAfterRace.cursorMs === expectCursor &&
        bReloaded?.revision === '1' && bReloaded?.cursorMs === expectCursor &&
        aReloaded?.revision === '1' && aReloaded?.cursorMs === expectCursor,
      JSON.stringify({ bStatusWhileHeld, bStatusFinal, bResJson, a: aRes?.res?.kind + '/' + aRes?.res?.revision, disk: diskAfterRace, bCursor: bReloaded?.cursorMs, aCursor: aReloaded?.cursorMs, expectCursor })
    );
  }

  // T4 same-page concurrent commits serialize (in-process queue)
  {
    const out = await cdpA.eval(`(async () => {
      const h = globalThis.__SPIKE_HARNESS__;
      const p1 = h.commitCandidateViaCoordinator(30000, '1');
      const p2 = h.commitCandidateViaCoordinator(90000, '1');
      const [r1, r2] = await Promise.all([p1, p2]);
      return { kinds: [r1.res.kind, r2.res.kind].sort(), revs: [r1.res.revision || null, r2.res.revision || null] };
    })()`);
    record('chrome/T4 same-page concurrent commits serialize (1 COMMITTED + 1 CONFLICT)', JSON.stringify(out.kinds) === JSON.stringify(['COMMITTED', 'CONFLICT']), JSON.stringify(out));
  }

  // T5 second coordinator instance shares the same lock namespace
  {
    await cdpA.eval(`(() => { window.__H5 = false; navigator.locks.request(${JSON.stringify(LOCK_NAME)}, { mode: 'exclusive' }, () => new Promise((r) => { window.__H5REL = r; window.__H5 = true; })); return true; })()`);
    await waitUntil(() => cdpA.eval('Boolean(window.__H5)'), 5000, 'A holds lock for T5');
    const raced = await cdpB.eval(`(async () => {
      const mod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const bp = await System.import('chunks:///_virtual/BrowserFilePort.ts');
      if (!mod.SingleWriterSaveCoordinator || !bp.BrowserFilePort) return { imported: false, error: 'symbols missing' };
      const port = new bp.BrowserFilePort('idle_fishing_lifecycle_persist_fs');
      const c2 = new mod.SingleWriterSaveCoordinator(port);
      let done = false;
      c2.loadSafe().then(() => { done = true; });
      await new Promise((r) => setTimeout(r, 700));
      return { imported: true, doneAfter700ms: done, storageKey: c2.storageKey };
    })()`);
    await cdpA.eval('window.__H5REL()');
    record('chrome/T5 second coordinator instance shares lock namespace (blocks on same lock)', raced.imported === true && raced.doneAfter700ms === false && raced.storageKey === 'browser:idle_fishing_lifecycle_persist_fs', JSON.stringify(raced));
    await new Promise((r) => setTimeout(r, 300));
  }

  await cdpA.send('Page.bringToFront');
  await H(cdpA, 'reinitializePersistence()');

  // T6 Web Locks missing -> fail-closed with zero slot writes
  {
    const out = await cdpA.eval(`(async () => {
      const orig = navigator.locks;
      let slotWrites = 0;
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith(${JSON.stringify(PREFIX)} + 'save_slot_')) slotWrites++; return origSet.call(this, k, v); };
      try {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
        const res = await globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(60000, rec.revision);
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
        return { kind: res.res?.kind, slotWrites, halted: snap.persistenceHalted, health: snap.storageHealth };
      } finally {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: orig });
        Storage.prototype.setItem = origSet;
      }
    })()`);
    record('chrome/T6 Web Locks missing => STORAGE_UNAVAILABLE, 0 slot writes, halted', out.kind === 'STORAGE_UNAVAILABLE' && out.slotWrites === 0 && out.halted === true && out.health === 'STORAGE_UNAVAILABLE', JSON.stringify(out));
    await H(cdpA, 'reinitializePersistence()');
    const after = await H(cdpA, 'getSnapshot().lifecyclePersistence');
    record('chrome/T6b explicit reinit recovers after lock-unavailable freeze', after?.storageHealth === 'AVAILABLE', JSON.stringify({ health: after?.storageHealth, rev: after?.revision }));
  }

  // T7 Web Locks request rejection -> fail-closed with zero writes
  {
    const out = await cdpA.eval(`(async () => {
      const orig = navigator.locks;
      let slotWrites = 0;
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith(${JSON.stringify(PREFIX)} + 'save_slot_')) slotWrites++; return origSet.call(this, k, v); };
      try {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => Promise.reject(new Error('audit injected lock rejection')) } });
        const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
        const res = await globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(60000, rec.revision);
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
        return { kind: res.res?.kind, slotWrites, halted: snap.persistenceHalted };
      } finally {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: orig });
        Storage.prototype.setItem = origSet;
      }
    })()`);
    record('chrome/T7 Web Locks rejection => STORAGE_UNAVAILABLE, 0 slot writes, halted', out.kind === 'STORAGE_UNAVAILABLE' && out.slotWrites === 0 && out.halted === true, JSON.stringify(out));
    await H(cdpA, 'reinitializePersistence()');
  }

  // T8 rapid sequential cross-tab commits
  {
    const base = await H(cdpA, 'getSnapshot().lifecyclePersistence');
    const a2 = await H(cdpA, `commitCandidateViaCoordinator(30000, ${JSON.stringify(base.revision)})`);
    await H(cdpB, 'reinitializePersistence()');
    const b2 = await H(cdpB, `commitCandidateViaCoordinator(30000, ${JSON.stringify(a2.res.revision)})`);
    record('chrome/T8 rapid sequential A->B commits strictly increment revisions', a2.res?.kind === 'COMMITTED' && b2.res?.kind === 'COMMITTED' && Number(b2.res.revision) === Number(a2.res.revision) + 1, JSON.stringify({ a: a2.res?.kind + '/' + a2.res?.revision, b: b2.res?.kind + '/' + b2.res?.revision }));
  }

  // T9 lock holder tab crash -> auto release -> survivor commits & reload consistent
  {
    const { c: tabC, targetId: tabCTargetId } = await openTab(cdpA);
    cdpC = tabC;
    await cdpC.eval(`(() => { window.__C_HELD = false; navigator.locks.request(${JSON.stringify(LOCK_NAME)}, { mode: 'exclusive' }, () => new Promise(() => {})); setTimeout(() => { window.__C_HELD = true; }, 50); return true; })()`);
    await waitUntil(() => cdpC.eval('Boolean(window.__C_HELD)'), 5000, 'Tab C holding lock');
    cdpC.close();
    cdpC = null;
    await cdpA.send('Target.closeTarget', { targetId: tabCTargetId });
    await new Promise((r) => setTimeout(r, 500));
    const rec = await H(cdpA, 'reinitializePersistence()');
    const c4 = await H(cdpA, `commitCandidateViaCoordinator(30000, ${JSON.stringify(rec.revision)})`);
    await cdpA.send('Page.bringToFront');
    await cdpA.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdpA.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'Tab A reload after crash');
    const reloaded = await H(cdpA, 'getSnapshot().lifecyclePersistence');
    record('chrome/T9 lock holder crash -> Chrome auto-release; survivor commits + reload consistent', c4.res?.kind === 'COMMITTED' && reloaded?.revision === c4.res.revision && reloaded?.cursorMs === c4.candidateCursorMs, JSON.stringify({ preRev: rec?.revision, c4: c4.res?.kind + '/' + c4.res?.revision, reloadedRev: reloaded?.revision, reloadedCursor: reloaded?.cursorMs, c4Cursor: c4.candidateCursorMs }));
  }

  // T10 destroy while HIDE is queued behind a held Web Lock
  {
    const diskBefore = await diskTop(cdpA);
    await cdpA.eval(`(() => { window.__H10 = false; navigator.locks.request(${JSON.stringify(LOCK_NAME)}, { mode: 'exclusive' }, () => new Promise((r) => { window.__H10REL = r; window.__H10 = true; })); return true; })()`);
    await waitUntil(() => cdpA.eval('Boolean(window.__H10)'), 5000, 'A holds lock for T10');
    const queued = await cdpB.eval(`(() => {
      const r1 = globalThis.__SPIKE_HARNESS__.requestHideSaveForTest('audit-lock-wait-1');
      const r2 = globalThis.__SPIKE_HARNESS__.requestHideSaveForTest('audit-lock-wait-2');
      return [r1, r2];
    })()`);
    await new Promise((r) => setTimeout(r, 250));
    await cdpB.eval(`globalThis.__SPIKE_HARNESS__.triggerDestroyForTest()`);
    const rejectedAfter = await cdpB.eval(`globalThis.__SPIKE_HARNESS__.requestHideSaveForTest('audit-after-destroy')`);
    await cdpA.eval('window.__H10REL()');
    const after = await cdpB.eval(`(async () => { await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); return { history: globalThis.__SPIKE_HARNESS__.getCommitHistory() }; })()`);
    const diskAfter = await diskTop(cdpA);
    record(
      'chrome/T10 destroy cancels BOTH queued HIDEs behind held Web Lock (disk unchanged)',
      Array.isArray(queued) && queued[0] === true && queued[1] === true && rejectedAfter === false &&
        after.history?.length >= 2 &&
        after.history.slice(-2).every((h) => h.taskState === 'CANCELLED') &&
        JSON.stringify(diskBefore) === JSON.stringify(diskAfter),
      JSON.stringify({ diskBefore, diskAfter, queued, rejectedAfter, historyTail: after.history?.slice(-2).map((h) => `${h.taskState}/${h.resultKind}`) })
    );
  }

  // T11 storage failure + HIDE, then destroy (combination 1)
  {
    const out = await cdpA.eval(`(async () => {
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith(${JSON.stringify(PREFIX)} + 'save_slot_')) throw new Error('audit injected runtime write failure');
        return origSet.call(this, k, v);
      };
      const fireVis = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      try {
        fireVis('hidden'); fireVis('visible');
        const rec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        globalThis.__SPIKE_HARNESS__.triggerDestroyForTest();
        const rejected = globalThis.__SPIKE_HARNESS__.requestHideSaveForTest('post-destroy-audit');
        const after = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        return { rec, rejected, after };
      } finally {
        Storage.prototype.setItem = origSet;
      }
    })()`);
    record('chrome/T11 storage write failure + HIDE => STORAGE_UNAVAILABLE, halted; destroy rejects new task', out.rec?.storageHealth === 'STORAGE_UNAVAILABLE' && out.rec?.persistenceHalted === true && out.rec?.lastCommitKind === 'STORAGE_UNAVAILABLE' && out.rejected === false && out.after?.persistenceHalted === true, JSON.stringify({ health: out.rec?.storageHealth, halted: out.rec?.persistenceHalted, last: out.rec?.lastCommitKind, rejected: out.rejected }));
  }

  // T12 fresh instance: recovery re-reads disk; stale expectedRevision CONFLICT; fresh commit succeeds
  {
    const { c: tabD } = await openTab(cdpA);
    try {
      const bootRec = await H(tabD, 'getSnapshot().lifecyclePersistence');
      const stale = await H(tabD, `commitCandidateViaCoordinator(60000, ${JSON.stringify(String(Number(bootRec?.revision) - 1))})`);
      const fresh = await H(tabD, `commitCandidateViaCoordinator(60000, ${JSON.stringify(bootRec?.revision)})`);
      record('chrome/T12 fresh instance re-reads disk; stale revision CONFLICT; fresh commit COMMITTED', bootRec?.loadStatus === 'VALID' && stale.res?.kind === 'CONFLICT' && fresh.res?.kind === 'COMMITTED' && Number(fresh.res.revision) === Number(bootRec.revision) + 1, JSON.stringify({ bootRev: bootRec?.revision, bootStatus: bootRec?.loadStatus, stale: stale.res?.kind, fresh: fresh.res?.kind + '/' + fresh.res?.revision }));
    } finally {
      tabD.close();
    }
  }
} catch (err) {
  record('chrome/harness', false, `unexpected harness error: ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  cdpA?.close();
  cdpB?.close();
  cdpC?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n===== CHROME E2E SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length) {
  failed.forEach((f) => console.log(`FAILED: ${f.name} :: ${f.detail}`));
  process.exit(1);
}
process.exit(0);