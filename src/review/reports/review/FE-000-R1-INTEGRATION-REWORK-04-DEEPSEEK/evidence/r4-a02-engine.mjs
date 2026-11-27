/**
 * Independent REWORK-04 engine-level A02 verification (real Chrome + real IndexedDB + Web Locks).
 * Covers: write-ahead marker ordering, EMPTY-with-prior-valid-marker recovery boundary,
 * corrupt/unreadable marker, partial IO recovery, marker-clear failure, deterministic failure,
 * normal CONFLICT, auto-boot non-clearing, stale/frozen writers, domain isolation, recovery interleaving.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };
const srv = await new Promise((res, rej) => { const s = http.createServer((q, r) => { const u = (q.url || '/').split('?')[0]; const f = path.resolve(WEB, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; } r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(f).pipe(r); }); s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port })); });
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r4-eng-'));
const dbg = 9500 + Math.floor(Math.random() * 80);
const base = `http://127.0.0.1:${srv.port}/`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
class Cdp { constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); } async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); } send(m, p = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); } async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result?.value; } close() { try { this.ws.close(); } catch {} } }
async function waitUntil(fn, ms, l) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 120)); } throw new Error('TIMEOUT ' + l); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }
async function conn(tid) { const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null; }, 15000, 'target'); const c = new Cdp(info.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); return c; }

const out = { failures: [], evidence: {} };
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }

const helpers = `({
  open: async () => await new Promise((res, rej) => { const r = indexedDB.open('idle_fishing_fs_v1', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('files')) r.result.createObjectStore('files'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  readSlots: async (db, ns) => await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const st = tx.objectStore('files'); const o = [null, null, null]; for (let i = 0; i < 3; i++) { const q = st.get(ns + ':save_slot_' + i + '.json'); q.onsuccess = () => { o[i] = q.result ?? null; }; } tx.oncomplete = () => { const v = o.filter(Boolean).map((t) => JSON.parse(t)).sort((a, b) => Number(b.revision) - Number(a.revision)); res({ rev: v[0]?.revision ?? null, gold: v[0] ? JSON.parse(v[0].payload).gold : null }); }; tx.onerror = () => rej(tx.error); }),
  readMarker: async (db, ns) => await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const st = tx.objectStore('files'); const q = st.get(ns + ':__tx_state__'); q.onsuccess = () => res(q.result ?? null); tx.oncomplete = () => {}; tx.onerror = () => rej(tx.error); })
})`;
const state = (coord) => `({ health: coord.storageHealth, freeze: coord.freezeCode })`;

let page = null;
try {
  const t0 = await waitHttp(dbg);
  page = await conn(t0.id);
  await page.send('Page.navigate', { url: base });
  await waitUntil(() => page.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'page boot');
  await new Promise((r) => setTimeout(r, 300));

  const run = async (name, expr) => { const r = await page.eval(expr); out.evidence[name] = r; return r; };

  // A. Write-ahead ordering + normal COMMITTED / CONFLICT / deterministic PRE_WRITE
  const normal = await run('normal', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const fm = await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_normal_' + Date.now();
    const inner = new pm.BrowserFilePort(ns);
    const fault = new fm.FaultInjectingFilePort(inner);
    const coord = new cm.SingleWriterSaveCoordinator(fault);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    await coord.loadSafe();
    let markerAtSlotWrite = null;
    const origWrite = inner.write.bind(inner);
    inner.write = async (p, t) => {
      if (String(p).includes('save_slot_')) markerAtSlotWrite = await H.readMarker(db, ns);
      return origWrite(p, t);
    };
    const c1 = await coord.commit(s1, null);
    inner.write = origWrite;
    const markerAfter = await H.readMarker(db, ns);
    const conflict = await coord.commit(s1, null);
    const healthAfterConflict = ${state('coord')};
    fault.armNextWriteFault('PRE_WRITE_ERROR');
    const det = await coord.commit(s2, '1');
    const healthAfterDet = ${state('coord')};
    const markerAfterDet = await H.readMarker(db, ns);
    const c3 = await coord.commit(s2, '1');
    const disk = await H.readSlots(db, ns);
    db.close();
    return {
      c1: { kind: c1.kind, rev: c1.revision ?? null },
      markerAtSlotWrite: markerAtSlotWrite ? JSON.parse(markerAtSlotWrite) : null,
      markerAfter,
      conflictKind: conflict.kind,
      healthAfterConflict,
      detKind: det.kind,
      healthAfterDet,
      markerAfterDet,
      c3: { kind: c3.kind, rev: c3.revision ?? null },
      disk,
      ns,
    };
  })()`);
  check('normal COMMITTED rev1', normal.c1.kind === 'COMMITTED' && normal.c1.rev === '1', JSON.stringify(normal.c1));
  check('PENDING marker durably visible BEFORE first slot write', normal.markerAtSlotWrite && normal.markerAtSlotWrite.state === 'PENDING' && normal.markerAtSlotWrite.targetRevision === '1', JSON.stringify(normal.markerAtSlotWrite));
  check('marker cleared after COMMITTED', normal.markerAfter === null, String(normal.markerAfter));
  check('normal CONFLICT does not freeze and leaves no marker', normal.conflictKind === 'CONFLICT' && normal.healthAfterConflict.health === 'AVAILABLE' && normal.markerAfter === null, JSON.stringify({ kind: normal.conflictKind, health: normal.healthAfterConflict }));
  check('deterministic PRE_WRITE failure -> FAILED, no freeze, marker cleared', normal.detKind === 'FAILED' && normal.healthAfterDet.health === 'AVAILABLE' && normal.markerAfterDet === null, JSON.stringify({ kind: normal.detKind, health: normal.healthAfterDet, marker: normal.markerAfterDet }));
  check('retry after deterministic failure commits rev2', normal.c3.kind === 'COMMITTED' && normal.c3.rev === '2' && normal.disk.rev === '2', JSON.stringify({ c3: normal.c3, disk: normal.disk }));

  // A2. PENDING marker write failure must yield ZERO slot writes
  const markerFail = await run('markerWriteFail', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_markerfail_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    let slotWrites = 0; const origW = port.write.bind(port); port.write = async (...a) => { slotWrites++; return origW(...a); };
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    await coord.loadSafe();
    await coord.commit(s1, null);
    const before = await H.readSlots(db, ns);
    const writesBefore = slotWrites;
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(v, k) { if (String(k || '').endsWith(':__tx_state__')) throw new DOMException('audit marker write failure', 'QuotaExceededError'); return origPut.call(this, v, k); };
    let r; try { r = await coord.commit(s2, '1'); } finally { IDBObjectStore.prototype.put = origPut; }
    const marker = await H.readMarker(db, ns);
    const after = await H.readSlots(db, ns);
    const health = ${state('coord')};
    const recovered = await coord.loadSafe();
    db.close();
    return { kind: r.kind, detail: r.detail ?? null, slotWrites: slotWrites - writesBefore, before, after, marker, health, recoveredKind: recovered.kind, recoveredRev: recovered.revision ?? null, ns };
  })()`);
  check('PENDING marker write failure -> STORAGE_UNAVAILABLE with zero slot writes', markerFail.kind === 'STORAGE_UNAVAILABLE' && markerFail.slotWrites === 0 && markerFail.before.rev === '1' && markerFail.after.rev === '1' && markerFail.marker === null, JSON.stringify(markerFail));
  check('marker write failure is recoverable via loadSafe (storage healthy)', markerFail.recoveredKind === 'VALID' && markerFail.recoveredRev === '1', JSON.stringify({ kind: markerFail.recoveredKind, rev: markerFail.recoveredRev }));

  // B. EMPTY-with-prior-valid-marker recovery boundary (task 5.4)
  const empt = await run('emptyAfterPriorValid', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_empty_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    await coord.loadSafe();
    const c1 = await coord.commit(s1, null);
    const before = await H.readSlots(db, ns);
    // Simulate an unexplained disappearance of all previously valid slots while a PENDING marker for rev2 exists.
    await port.writeTxState(JSON.stringify({ version: 1, storageKey: coord.storageKey, txId: 'tx_audit_lost_slots', state: 'PENDING', expectedRevision: '1', targetRevision: '2', createdAtMs: 1700000000000, updatedAtMs: 1700000000000, reason: 'audit simulated lost slots' }));
    for (const p of ['save_slot_0.json','save_slot_1.json','save_slot_2.json']) await port.remove(p);
    const afterDelete = await H.readSlots(db, ns);
    const markerBefore = await H.readMarker(db, ns);
    const rec = await coord.loadSafe();
    const markerAfter = await H.readMarker(db, ns);
    const healthAfter = ${state('coord')};
    db.close();
    return { c1: c1.kind, before, afterDelete, markerBefore, recKind: rec.kind, recRev: rec.revision ?? null, recClass: rec.recoveryClassification ?? null, markerAfter, healthAfter, ns };
  })()`);
  out.evidence.emptyAfterPriorValid = empt;
  console.log('[evidence] EMPTY after prior VALID + PENDING:', JSON.stringify(empt));
  check('domain previously holding VALID rev1 + PENDING(expectedRevision=1) must NOT be silently reset by EMPTY', !(empt.recKind === 'EMPTY' && empt.markerAfter === null), JSON.stringify(empt));

  // C. Corrupt marker: fail-closed and recoverability via public API
  const corrupt = await run('corruptMarker', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_corrupt_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    await coord.loadSafe();
    const c1 = await coord.commit(s1, null);
    await port.writeTxState('{broken-marker-json');
    const l1 = await coord.loadSafe();
    const c2 = await coord.commit(s1, '1');
    const markerStill = await H.readMarker(db, ns);
    // No public API exists to discard a corrupt marker; a second loadSafe cannot recover either.
    const l2 = await coord.loadSafe();
    db.close();
    return { c1: c1.kind, l1Kind: l1.kind, l1Class: l1.recoveryClassification ?? null, c2Kind: c2.kind, markerStill, l2Kind: l2.kind, l2Class: l2.recoveryClassification ?? null, ns };
  })()`);
  check('corrupt marker fails closed and commit is blocked', corrupt.l1Kind === 'STORAGE_UNAVAILABLE' && corrupt.l1Class === 'TX_STATE_UNREADABLE' && corrupt.c2Kind === 'STORAGE_UNAVAILABLE' && Boolean(corrupt.markerStill), JSON.stringify(corrupt));
  check('corrupt marker is recoverable through public loadSafe() without manual raw-port deletion', corrupt.l2Kind !== 'STORAGE_UNAVAILABLE', JSON.stringify({ l2Kind: corrupt.l2Kind, l2Class: corrupt.l2Class }));

  // D. Marker clear failure after COMMITTED
  const clearFail = await run('clearFail', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_clear_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    await coord.loadSafe();
    await coord.commit(s1, null);
    const origDel = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(k) { if (String(k || '').endsWith(':__tx_state__')) throw new DOMException('audit clear failure', 'UnknownError'); return origDel.call(this, k); };
    let r; try { r = await coord.commit(s2, '1'); } finally { IDBObjectStore.prototype.delete = origDel; }
    const marker = await H.readMarker(db, ns);
    const rec = await coord.loadSafe();
    const disk = await H.readSlots(db, ns);
    const markerAfter = await H.readMarker(db, ns);
    db.close();
    return { commitKind: r.kind, detail: r.detail ?? null, marker: marker ? JSON.parse(marker) : null, recKind: rec.kind, recRev: rec.revision ?? null, disk, markerAfter, ns };
  })()`);
  check('marker-clear failure -> UNCERTAIN, marker retained, rev2 on disk', clearFail.commitKind === 'UNCERTAIN' && clearFail.marker && clearFail.marker.state === 'PENDING' && clearFail.disk.rev === '2', JSON.stringify({ kind: clearFail.commitKind, marker: clearFail.marker, disk: clearFail.disk }));
  check('explicit loadSafe after clear heals -> VALID rev2, marker cleared', clearFail.recKind === 'VALID' && clearFail.recRev === '2' && clearFail.markerAfter === null, JSON.stringify({ rec: clearFail.recKind, rev: clearFail.recRev, marker: clearFail.markerAfter }));

  // E. Partial IO during recovery
  const partial = await run('partialIo', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_partial_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    const s3 = core.advanceOffline(s2, s2.cursorMs + 60000).state;
    await coord.loadSafe();
    await coord.commit(s1, null); await coord.commit(s2, '1'); await coord.commit(s3, '2');
    const origGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function(k) { if (String(k || '').endsWith(':save_slot_2.json')) throw new DOMException('audit partial read failure', 'UnknownError'); return origGet.call(this, k); };
    let rec; try { rec = await coord.loadSafe(); } finally { IDBObjectStore.prototype.get = origGet; }
    const marker = await H.readMarker(db, ns);
    const health = ${state('coord')};
    const rec2 = await coord.loadSafe();
    const disk = await H.readSlots(db, ns);
    db.close();
    return { recKind: rec.kind, recClass: rec.recoveryClassification ?? null, backupRev: rec.readOnlyBackup?.revision ?? null, marker, health, rec2Kind: rec2.kind, rec2Rev: rec2.revision ?? null, disk, ns };
  })()`);
  check('partial slot IO during recovery -> STORAGE_UNAVAILABLE PARTIAL, frozen, marker retained', partial.recKind === 'STORAGE_UNAVAILABLE' && partial.recClass === 'PARTIAL_IO_UNAVAILABLE' && partial.health.health === 'STORAGE_UNAVAILABLE' && Boolean(partial.marker), JSON.stringify(partial));
  check('after IO heals, explicit recovery reads real rev3', partial.rec2Kind === 'VALID' && partial.rec2Rev === '3' && partial.disk.rev === '3', JSON.stringify({ rec2: partial.rec2Kind, rev: partial.rec2Rev, disk: partial.disk }));

  // F. Auto boot non-clearing + stale/frozen writers + domain isolation
  const misc = await run('misc', `(async () => {
    const H = ${helpers};
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_misc_' + Date.now();
    const ns2 = 'r4_audit_other_' + Date.now();
    const port = new pm.BrowserFilePort(ns);
    const coord = new cm.SingleWriterSaveCoordinator(port);
    const db = await H.open();
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    const s3 = core.advanceOffline(s2, s2.cursorMs + 60000).state;
    await coord.loadSafe();
    await coord.commit(s1, null);
    await port.writeTxState(JSON.stringify({ version: 1, storageKey: coord.storageKey, txId: 'tx_audit_boot', state: 'PENDING', expectedRevision: '1', targetRevision: '2', createdAtMs: 1700000000000, updatedAtMs: 1700000000000, reason: 'audit' }));
    const boot = await coord.loadSafe({ clearPendingTxMarker: false });
    const markerAfterBoot = await H.readMarker(db, ns);
    const rec = await coord.loadSafe();
    const markerAfterRec = await H.readMarker(db, ns);
    // fresh commit based on recovered revision, then a stale expectedRevision
    const fresh = await coord.commit(s2, '1');
    const stale = await coord.commit(s3, '1');
    // frozen old coordinator: create UNCERTAIN on a second domain then recover from a healthy one
    const ns3 = 'r4_audit_frozen_' + Date.now();
    const port3 = new pm.BrowserFilePort(ns3);
    const coord3 = new cm.SingleWriterSaveCoordinator(port3);
    const db3 = await H.open();
    await coord3.loadSafe();
    await coord3.commit(s1, null);
    // inject a durable UNCERTAIN marker directly, then recover with a NEW coordinator
    await port3.writeTxState(JSON.stringify({ version: 1, storageKey: coord3.storageKey, txId: 'tx_audit_frozen', state: 'UNCERTAIN', expectedRevision: '1', targetRevision: '2', createdAtMs: 1700000000000, updatedAtMs: 1700000000000, reason: 'audit' }));
    const frozenOld = await coord3.commit(s2, '1');
    const healthyNew = new cm.SingleWriterSaveCoordinator(new pm.BrowserFilePort(ns3));
    const recNew = await healthyNew.loadSafe();
    const fresh2 = await healthyNew.commit(s2, '1');
    const oldAfterRecovery = await coord3.commit(s3, '1');
    const freshStale = await healthyNew.commit(s3, '1');
    // domain isolation
    const other = new cm.SingleWriterSaveCoordinator(new pm.BrowserFilePort(ns2));
    const otherLoad = await other.loadSafe();
    const otherCommit = await other.commit(s1, null);
    const currentHealth = ${state('coord')};
    db.close(); db3.close();
    return { bootKind: boot.kind, bootClass: boot.recoveryClassification ?? null, markerAfterBoot: Boolean(markerAfterBoot), recKind: rec.kind, markerAfterRec, freshKind: fresh.kind, freshRev: fresh.revision ?? null, staleKind: stale.kind, frozenOldKind: frozenOld.kind, recNewKind: recNew.kind, oldAfterRecoveryKind: oldAfterRecovery.kind, fresh2Kind: fresh2.kind, fresh2Rev: fresh2.revision ?? null, freshStaleKind: freshStale.kind, otherLoadKind: otherLoad.kind, otherCommitKind: otherCommit.kind, currentHealth, ns };
  })()`);
  check('auto boot with marker does NOT clear it', misc.bootKind === 'STORAGE_UNAVAILABLE' && misc.bootClass === 'PENDING_RECOVERY_REQUIRED' && misc.markerAfterBoot === true, JSON.stringify({ boot: misc.bootKind, cls: misc.bootClass, marker: misc.markerAfterBoot }));
  check('explicit recovery clears marker', misc.recKind === 'VALID' && misc.markerAfterRec === null, JSON.stringify({ rec: misc.recKind, marker: misc.markerAfterRec }));
  check('fresh commit after recovery uses recovered revision', misc.freshKind === 'COMMITTED' && misc.freshRev === '2', JSON.stringify({ fresh: misc.freshKind, rev: misc.freshRev }));
  check('stale expectedRevision after recovery -> CONFLICT', misc.staleKind === 'CONFLICT', String(misc.staleKind));
  check('old frozen coordinator after recovery cannot overwrite newer save', misc.frozenOldKind === 'STORAGE_UNAVAILABLE' && misc.recNewKind === 'VALID' && misc.fresh2Kind === 'COMMITTED' && misc.fresh2Rev === '2' && misc.oldAfterRecoveryKind === 'CONFLICT' && misc.freshStaleKind === 'CONFLICT', JSON.stringify({ old: misc.frozenOldKind, rec: misc.recNewKind, fresh2: misc.fresh2Kind, rev: misc.fresh2Rev, oldAfter: misc.oldAfterRecoveryKind, stale: misc.freshStaleKind }));
  check('separate domain unaffected by frozen domain', misc.otherLoadKind === 'EMPTY' && misc.otherCommitKind === 'COMMITTED', JSON.stringify({ load: misc.otherLoadKind, commit: misc.otherCommitKind }));

  // G. Recovery interleaved with a waiting commit (Web Lock serialization)
  const inter = await run('interleave', `(async () => {
    const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'r4_audit_inter_' + Date.now();
    const holder = new cm.SingleWriterSaveCoordinator(new pm.BrowserFilePort(ns));
    const waiter = new cm.SingleWriterSaveCoordinator(new pm.BrowserFilePort(ns));
    const recover = new cm.SingleWriterSaveCoordinator(new pm.BrowserFilePort(ns));
    const s0 = core.createInitialState({ saveEpoch: 'audit.r4', startMs: 1700000000000, allowanceMs: 3600000 });
    const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
    const s2 = core.advanceOffline(s1, s1.cursorMs + 60000).state;
    await holder.loadSafe();
    await holder.commit(s1, null);
    // leave a PENDING marker, then hold the lock while both a commit and a recovery queue up
    await holder.port.writeTxState(JSON.stringify({ version: 1, storageKey: holder.storageKey, txId: 'tx_audit_inter', state: 'PENDING', expectedRevision: '1', targetRevision: '2', createdAtMs: 1700000000000, updatedAtMs: 1700000000000, reason: 'audit' }));
    let release; const gate = new Promise((r) => { release = r; });
    const holding = holder.runExclusive(async () => { await gate; return 'held'; });
    const commitP = waiter.commit(s2, '1');
    const recoverP = recover.loadSafe();
    await new Promise((r) => setTimeout(r, 150));
    release();
    await holding;
    const c = await commitP;
    const l = await recoverP;
    return { commitKind: c.kind, commitRev: c.revision ?? null, loadKind: l.kind, loadRev: l.revision ?? null, markerAfter: await holder.port.readTxState(), ns };
  })()`);
  check('interleaved recovery/commit never writes under an unrecovered marker', (inter.commitKind === 'STORAGE_UNAVAILABLE' || (inter.commitKind === 'COMMITTED' && inter.commitRev === '2' && inter.loadKind === 'VALID')) && inter.markerAfter === null, JSON.stringify(inter));

  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-audit/a02-engine.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  page?.close();
  try { chrome.kill(); } catch {}
  srv.server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== A02 ENGINE R4: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);