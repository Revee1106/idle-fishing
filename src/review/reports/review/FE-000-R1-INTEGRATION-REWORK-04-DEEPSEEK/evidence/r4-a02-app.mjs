/**
 * Independent REWORK-04 A02 app-level cross-tab audit.
 * Tab A normal HIDE -> UNCERTAIN with durable marker; Tab B normal HIDE / direct commit MUST be blocked
 * across destroy / reload / close of Tab A. Then explicit coordinator recovery is checked, and it is
 * verified whether the APP has any recovery entry (BootEntry remains halted; harness has none).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const NS = 'idle_fishing_lifecycle_persist_fs';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };

const srv = await new Promise((res, rej) => {
  const s = http.createServer((q, r) => {
    const u = (q.url || '/').split('?')[0];
    const f = path.resolve(WEB, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(r);
  });
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
});
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r4-a02app-'));
const dbg = 9400 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${srv.port}/`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.events = []; this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method) this.events.push(m); }); }
  async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(m, p = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 700)); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, l) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 120)); } throw new Error('TIMEOUT ' + l); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }
async function conn(tid) { const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null; }, 15000, 'target'); const c = new Cdp(info.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); return c; }

const out = { failures: [], evidence: {} };
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }

const idb = `(async (ns) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('idle_fishing_fs_v1', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    const slots = await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const st = tx.objectStore('files'); const o = [null, null, null]; for (let i = 0; i < 3; i++) { const q = st.get(ns + ':save_slot_' + i + '.json'); q.onsuccess = () => { o[i] = q.result ?? null; }; } tx.oncomplete = () => res(o); tx.onerror = () => rej(tx.error); });
    const marker = await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const st = tx.objectStore('files'); const q = st.get(ns + ':__tx_state__'); q.onsuccess = () => res(q.result ?? null); tx.oncomplete = () => {}; tx.onerror = () => rej(tx.error); });
    const valid = slots.filter(Boolean).map((t) => JSON.parse(t)).sort((a, b) => Number(b.revision) - Number(a.revision));
    return { rev: valid[0]?.revision ?? null, gold: valid[0] ? JSON.parse(valid[0].payload).gold : null, marker };
  } finally { db.close(); }
})`;
const fire = `const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};`;
const directCommit = `(ns) => (async () => {
  const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
  const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
  const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
  const port = new portMod.BrowserFilePort(ns);
  let writes = 0; const orig = port.write.bind(port); port.write = async (...a) => { writes++; return orig(...a); };
  const coord = new coordMod.SingleWriterSaveCoordinator(port);
  const s0 = coreMod.createInitialState({ saveEpoch: 'fe000-lifecycle-epoch', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
  const s2 = coreMod.advanceOffline(s0, s0.cursorMs + 180000).state;
  const r = await coord.commit(s2, '1');
  return { kind: r.kind, detail: r.detail ?? null, writes };
})()`;

let A = null; let B = null;
try {
  const t0 = await waitHttp(dbg);
  A = await conn(t0.id);
  await A.send('Page.navigate', { url: base });
  await waitUntil(() => A.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'A boot');
  await new Promise((r) => setTimeout(r, 400));
  await A.eval(`(async () => { const db = await new Promise((res, rej) => { const r = indexedDB.open('idle_fishing_fs_v1', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); try { await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); const st = tx.objectStore('files'); const q = st.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (String(k).startsWith(${JSON.stringify(NS)} + ':')) st.delete(k); }; tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); } finally { db.close(); } })()`);
  await A.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => A.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'A clean');
  await new Promise((r) => setTimeout(r, 300));

  const seed = await A.eval(`(async()=>{${fire}fire('hidden');fire('visible');return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();})()`);
  check('seed rev1 via normal HIDE', seed.revision === '1' && seed.lastCommitKind === 'COMMITTED', JSON.stringify(seed));

  const created = await A.send('Target.createTarget', { url: base });
  B = await conn(created.targetId);
  await waitUntil(() => B.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'B boot');
  await new Promise((r) => setTimeout(r, 400));
  const bBoot = await B.eval(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
  check('Tab B boots VALID rev1', bBoot.loadStatus === 'VALID' && bBoot.revision === '1', JSON.stringify({ status: bBoot.loadStatus, rev: bBoot.revision }));

  const aUnc = await A.eval(`(async()=>{
    const oPut=IDBObjectStore.prototype.put, oGet=IDBObjectStore.prototype.get; let afterWrite=false;
    IDBObjectStore.prototype.put=function(v,k){if(String(k||'').includes(':save_slot_')){afterWrite=true;throw new DOMException('audit write before landing','QuotaExceededError');}return oPut.call(this,v,k);};
    IDBObjectStore.prototype.get=function(k){if(afterWrite&&String(k||'').includes(':save_slot_'))throw new DOMException('audit read failure','UnknownError');return oGet.call(this,k);};
    ${fire}
    try{ fire('hidden');fire('visible'); const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); return {rev:rec.revision,last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth,detail:rec.lastCommitDetail}; }
    finally{ IDBObjectStore.prototype.put=oPut; IDBObjectStore.prototype.get=oGet; }
  })()`);
  const diskAfterA = await B.eval(`(${idb})(${JSON.stringify(NS)})`);
  const markerObj = diskAfterA.marker ? JSON.parse(diskAfterA.marker) : null;
  check('Tab A normal HIDE -> UNCERTAIN, halt, disk rev1, durable marker', aUnc.last === 'UNCERTAIN' && aUnc.halted === true && aUnc.health === 'STORAGE_UNAVAILABLE' && diskAfterA.rev === '1' && markerObj && (markerObj.state === 'UNCERTAIN' || markerObj.state === 'PENDING'), JSON.stringify({ aUnc, rev: diskAfterA.rev, marker: markerObj && { state: markerObj.state, storageKey: markerObj.storageKey } }));

  const bHide = await B.eval(`(async()=>{${fire}fire('hidden');fire('visible');const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();const top=await (${idb})(${JSON.stringify(NS)});return {rev:rec.revision,last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth,diskRev:top.rev,marker:top.marker};})()`);
  check('Tab B normal HIDE blocked, 0 writes, marker intact', bHide.last === 'STORAGE_UNAVAILABLE' && bHide.halted === true && bHide.diskRev === '1' && Boolean(bHide.marker), JSON.stringify(bHide));

  const bDirect = await B.eval(`(${directCommit})(${JSON.stringify(NS)})`);
  const diskAfterDirect = await B.eval(`(${idb})(${JSON.stringify(NS)})`);
  check('Tab B direct coordinator blocked, 0 writes', bDirect.kind === 'STORAGE_UNAVAILABLE' && bDirect.writes === 0 && diskAfterDirect.rev === '1', JSON.stringify({ bDirect, rev: diskAfterDirect.rev }));

  await A.send('Page.bringToFront');
  await A.eval(`(async()=>{const boot=globalThis.cc.director.getScene().getComponentInChildren('BootEntry');boot.destroy();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));})()`);
  const bAfterDestroy = await B.eval(`(${directCommit})(${JSON.stringify(NS)})`);
  check('after Tab A destroy, Tab B still blocked', bAfterDestroy.kind === 'STORAGE_UNAVAILABLE' && bAfterDestroy.writes === 0, JSON.stringify(bAfterDestroy));

  await A.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => A.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'A reload');
  await new Promise((r) => setTimeout(r, 400));
  const aReload = await A.eval(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
  const markerAfterReload = await B.eval(`(${idb})(${JSON.stringify(NS)})`);
  const bAfterReload = await B.eval(`(${directCommit})(${JSON.stringify(NS)})`);
  check('after Tab A reload: A stays halted, marker intact, B still blocked', aReload.loadStatus === 'STORAGE_UNAVAILABLE' && aReload.persistenceHalted === true && Boolean(markerAfterReload.marker) && bAfterReload.kind === 'STORAGE_UNAVAILABLE' && bAfterReload.writes === 0 && markerAfterReload.rev === '1', JSON.stringify({ aReload: { status: aReload.loadStatus, halted: aReload.persistenceHalted }, marker: Boolean(markerAfterReload.marker), bAfterReload, rev: markerAfterReload.rev }));

  // Try every exposed non-destructive application action after reload; none may clear the marker.
  const harnessActions = await A.eval(`(async()=>{const keys=Object.keys(globalThis.__SPIKE_HARNESS__);const recoverLike=keys.filter(k=>/recover|repair|retry|clear|reset|restore/i.test(k));return {keys,recoverLike};})()`);
  check('application harness exposes NO recovery-like entry', harnessActions.recoverLike.length === 0, JSON.stringify(harnessActions.recoverLike));

  A.close(); A = null;
  await (async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); void r; })();
  await B.send('Target.closeTarget', { targetId: t0.id }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const bAfterClose = await B.eval(`(${directCommit})(${JSON.stringify(NS)})`);
  check('after Tab A close, Tab B still blocked', bAfterClose.kind === 'STORAGE_UNAVAILABLE' && bAfterClose.writes === 0, JSON.stringify(bAfterClose));

  const recover = await B.eval(`(async () => {
    const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const port = new portMod.BrowserFilePort(${JSON.stringify(NS)});
    const coord = new coordMod.SingleWriterSaveCoordinator(port);
    const l = await coord.loadSafe();
    const markerAfter = await (${idb})(${JSON.stringify(NS)});
    const s0 = coreMod.createInitialState({ saveEpoch: 'fe000-lifecycle-epoch', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
    const s2 = coreMod.advanceOffline(s0, s0.cursorMs + 180000).state;
    const c = await coord.commit(s2, l.kind === 'VALID' ? l.revision : null);
    const after = await (${idb})(${JSON.stringify(NS)});
    return { loadKind: l.kind, loadRev: l.revision ?? null, markerAfter: markerAfter.marker, commitKind: c.kind, commitRev: c.revision ?? null, diskRev: after.rev };
  })()`);
  check('explicit coordinator recovery clears marker & commits rev2', recover.loadKind === 'VALID' && recover.loadRev === '1' && recover.markerAfter === null && recover.commitKind === 'COMMITTED' && recover.commitRev === '2' && recover.diskRev === '2', JSON.stringify(recover));

  // The APP-level question: after the domain is recovered by another tab, can the still-open BootEntry tab ever save again?
  const appAfterExternalRecovery = await B.eval(`(async()=>{${fire}fire('hidden');fire('visible');const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();return {last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth};})()`);
  out.evidence.appAfterExternalRecovery = appAfterExternalRecovery;
  console.log('[evidence] BootEntry after external recovery:', JSON.stringify(appAfterExternalRecovery));

  out.evidence = { seed: { rev: seed.revision }, bBoot: { status: bBoot.loadStatus, rev: bBoot.revision }, aUnc, markerAfterA: markerObj ? { state: markerObj.state } : null, bHide, bDirect, bAfterDestroy, aReload: { status: aReload.loadStatus, halted: aReload.persistenceHalted }, bAfterReload, bAfterClose, recover, appAfterExternalRecovery, harnessActions, ...out.evidence };
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-audit/a02-app.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  A?.close(); B?.close();
  try { chrome.kill(); } catch {}
  srv.server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== A02 APP R4: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);