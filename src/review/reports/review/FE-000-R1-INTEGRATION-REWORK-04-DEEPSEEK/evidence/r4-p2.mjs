/**
 * Independent REWORK-04 P2 verification in real Chrome:
 * - real browser with indexedDB missing / open throwing / transaction failure must fail closed (0 localStorage writes)
 * - Node mock opt-in must be ignored in a real browser
 * - legacy localStorage saves are detected, preserved, never resurrected/migrated/deleted
 * - both IDB and legacy LS present -> IDB wins, LS intact
 * - repeated startup stable
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const NS = 'idle_fishing_lifecycle_persist_fs';
const LEGACY_KEY = `${NS}:save_slot_0.json`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };
const srv = await new Promise((res, rej) => { const s = http.createServer((q, r) => { const u = (q.url || '/').split('?')[0]; const f = path.resolve(WEB, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(r); }); s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port })); });
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r4-p2-'));
const dbg = 9700 + Math.floor(Math.random() * 80);
const base = `http://127.0.0.1:${srv.port}/`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
class Cdp { constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); } async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); } send(m, p = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); } async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result?.value; } close() { try { this.ws.close(); } catch {} } }
async function waitUntil(fn, ms, l) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 120)); } throw new Error('TIMEOUT ' + l); }

const out = { failures: [], evidence: {} };
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }
const idbClear = `(async (ns) => { const db = await new Promise((res, rej) => { const r = indexedDB.open('idle_fishing_fs_v1', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); try { await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); const st = tx.objectStore('files'); const q = st.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (String(k).startsWith(ns + ':')) st.delete(k); }; tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); } finally { db.close(); } })`;

let page = null;
let scriptIds = [];
try {
  const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http');
  page = new Cdp(info.webSocketDebuggerUrl); await page.open(); await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: base });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'boot');

  // Build a valid legacy envelope using the real build, then seed localStorage + IDB save.
  const seeded = await page.eval(`(async () => {
    localStorage.removeItem(${JSON.stringify(LEGACY_KEY)});
    await (${idbClear})(${JSON.stringify(NS)});
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const tmp = new pm.BrowserFilePort('r4_p2_tmp_' + Date.now());
    const tc = new cm.SingleWriterSaveCoordinator(tmp);
    const s0 = core.createInitialState({ saveEpoch: 'fe000-legacy-ls', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 300000).state;
    await tc.loadSafe();
    await tc.commit(s1, null);
    const envText = await tmp.read('save_slot_0.json');
    await tmp.clearAll();
    localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, envText);
    // Seed a DIFFERENT valid IndexedDB save in the real app namespace (rev1).
    const appPort = new pm.BrowserFilePort(${JSON.stringify(NS)});
    const appCoord = new cm.SingleWriterSaveCoordinator(appPort);
    const s2 = core.advanceOffline(s0, s0.cursorMs + 600000).state;
    await appCoord.loadSafe();
    const c = await appCoord.commit(s2, null);
    return { envText, idbCommit: c.kind, legacyLen: localStorage.getItem(${JSON.stringify(LEGACY_KEY)})?.length ?? 0 };
  })()`);
  check('seed: IDB rev1 + valid legacy LS present', seeded.idbCommit === 'COMMITTED' && seeded.legacyLen > 0, JSON.stringify({ idb: seeded.idbCommit, legacyLen: seeded.legacyLen }));

  // 1. Both present: IDB wins, legacy detected & intact, no migration.
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'both reload');
  await new Promise((r) => setTimeout(r, 400));
  const both = await page.eval(`(() => { const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence; return { status: rec.loadStatus, rev: rec.revision, gold: rec.gold, legacy: rec.legacyExperimentalSave, lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)} }; })()`);
  check('both IDB+LS: IDB wins, legacy reported & untouched', both.status === 'VALID' && both.rev === '1' && both.legacy?.detected === true && both.legacy?.policy === 'DETECTED_IGNORED_NO_AUTO_MIGRATION' && both.lsIntact === true, JSON.stringify(both));

  // 2. Legacy-only (IDB cleared): EMPTY with explicit ignored status; LS intact; repeated boot stable.
  await page.eval(`(${idbClear})(${JSON.stringify(NS)})`);
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'legacy-only reload');
  await new Promise((r) => setTimeout(r, 300));
  const legacyOnly = await page.eval(`(() => { const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence; return { status: rec.loadStatus, halted: rec.persistenceHalted, legacy: rec.legacyExperimentalSave, lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)}, lsCount: Object.keys(localStorage).length }; })()`);
  check('legacy-only: ignored, not resurrected, not deleted, not EMPTY-reset', legacyOnly.status === 'EMPTY' && legacyOnly.halted === false && legacyOnly.legacy?.detected === true && legacyOnly.lsIntact === true, JSON.stringify(legacyOnly));
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'legacy-only reload2');
  await new Promise((r) => setTimeout(r, 300));
  const legacyOnly2 = await page.eval(`(() => { const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence; return { status: rec.loadStatus, legacy: rec.legacyExperimentalSave, lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)} }; })()`);
  check('repeated startup remains stable', legacyOnly2.status === 'EMPTY' && legacyOnly2.legacy?.detected === true && legacyOnly2.lsIntact === true, JSON.stringify(legacyOnly2));

  // 3. indexDB missing: fail closed, no LS writes, opt-in ignored. Restore page after.
  const disableIdb = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });` });
  scriptIds.push(disableIdb.identifier);
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'no-idb reload');
  await new Promise((r) => setTimeout(r, 350));
  const noIdb = await page.eval(`(async () => {
    const before = Object.keys(localStorage).sort();
    const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    const fire = (s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); };
    fire('hidden'); fire('visible'); const after = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const optIn = new pm.BrowserFilePort('r4_p2_optin_' + Date.now(), undefined, { allowLocalStorageMockInNode: true });
    const probe = await optIn.probeStorage();
    const optCoord = new cm.SingleWriterSaveCoordinator(optIn);
    const c = await optCoord.commit(core.createInitialState({ saveEpoch: 'audit.p2', startMs: 1700000000000, allowanceMs: 3600000 }), null);
    return { isNode: pm.isNodeTestHost(), status: rec.loadStatus, halted: rec.persistenceHalted, restored: rec.restoredOnBoot, legacy: rec.legacyExperimentalSave, hide: { last: after.lastCommitKind, count: after.hideCommitCount, halted: after.persistenceHalted }, optKind: optIn.kind, optProbe: probe.available, optCommit: c.kind, lsKeysIdentical: JSON.stringify(before) === JSON.stringify(Object.keys(localStorage).sort()), lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)} };
  })()`);
  check('indexedDB missing: fail-closed boot, 0 writes, opt-in ignored, LS untouched', noIdb.isNode === false && noIdb.status === 'STORAGE_UNAVAILABLE' && noIdb.halted === true && noIdb.restored === false && noIdb.legacy?.detected === true && noIdb.hide.count === 0 && noIdb.optKind === 'BROWSER_STORAGE_UNAVAILABLE' && noIdb.optProbe === false && noIdb.optCommit === 'STORAGE_UNAVAILABLE' && noIdb.lsKeysIdentical === true && noIdb.lsIntact === true, JSON.stringify(noIdb));

  // 4. indexedDB.open throws (initialization failure): fail closed, no LS writes.
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: disableIdb.identifier }); scriptIds = scriptIds.filter((x) => x !== disableIdb.identifier);
  const openThrows = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open: function () { throw new Error('audit indexedDB.open failure'); } } });` });
  scriptIds.push(openThrows.identifier);
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'open-throw reload');
  await new Promise((r) => setTimeout(r, 350));
  const openFail = await page.eval(`(async () => { const before = Object.keys(localStorage).sort(); const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence; const fire = (s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }; fire('hidden'); fire('visible'); const after = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); return { status: rec.loadStatus, halted: rec.persistenceHalted, legacy: rec.legacyExperimentalSave, hideCount: after.hideCommitCount, lsKeysIdentical: JSON.stringify(before) === JSON.stringify(Object.keys(localStorage).sort()), lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)} }; })()`);
  check('indexedDB.open throws: fail-closed, 0 writes, LS untouched', openFail.status === 'STORAGE_UNAVAILABLE' && openFail.halted === true && openFail.legacy?.detected === true && openFail.hideCount === 0 && openFail.lsKeysIdentical === true && openFail.lsIntact === true, JSON.stringify(openFail));

  // 5. Transaction abort / security failure on probe: fail closed.
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: openThrows.identifier }); scriptIds = scriptIds.filter((x) => x !== openThrows.identifier);
  const txFail = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `const __origPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (String(k || '').includes(':__probe__')) throw new DOMException('audit permission failure', 'SecurityError'); return __origPut.call(this, v, k); };` });
  scriptIds.push(txFail.identifier);
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'tx-fail reload');
  await new Promise((r) => setTimeout(r, 350));
  const txFailRes = await page.eval(`(async () => { const before = Object.keys(localStorage).sort(); const rec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence; const fire = (s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }; fire('hidden'); fire('visible'); const after = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); return { status: rec.loadStatus, halted: rec.persistenceHalted, detail: rec.storageUnavailableReason, legacy: rec.legacyExperimentalSave, hideCount: after.hideCommitCount, lsKeysIdentical: JSON.stringify(before) === JSON.stringify(Object.keys(localStorage).sort()), lsIntact: localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) === ${JSON.stringify(seeded.envText)} }; })()`);
  check('probe transaction SecurityError: fail-closed, 0 writes, LS untouched', txFailRes.status === 'STORAGE_UNAVAILABLE' && txFailRes.halted === true && txFailRes.legacy?.detected === true && txFailRes.hideCount === 0 && txFailRes.lsKeysIdentical === true && txFailRes.lsIntact === true, JSON.stringify(txFailRes));

  // Cleanup: remove injection, reload, remove legacy key and IDB namespace.
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: txFail.identifier }); scriptIds = scriptIds.filter((x) => x !== txFail.identifier);
  await page.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'cleanup reload');
  await page.eval(`(async () => { localStorage.removeItem(${JSON.stringify(LEGACY_KEY)}); await (${idbClear})(${JSON.stringify(NS)}); })()`);

  out.evidence = { seeded: { idbCommit: seeded.idbCommit, legacyLen: seeded.legacyLen }, both, legacyOnly, legacyOnly2, noIdb, openFail, txFail: txFailRes };
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-audit/p2.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  page?.close();
  try { chrome.kill(); } catch {}
  srv.server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== P2 R4: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);