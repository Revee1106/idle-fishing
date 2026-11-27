/**
 * Independent REWORK-04 crash matrix in real Chrome:
 * - Tab dies AFTER durable PENDING marker but BEFORE the save slot write.
 * - Tab dies AFTER the save slot write but BEFORE readback verification.
 * In both cases another realm must be blocked until explicit verified recovery.
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
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r4-crash-'));
const dbg = 9600 + Math.floor(Math.random() * 80);
const base = `http://127.0.0.1:${srv.port}/`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
class Cdp { constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); } async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); } send(m, p = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); } async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result?.value; } close() { try { this.ws.close(); } catch {} } }
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

let observer = null;
try {
  const t0 = await waitHttp(dbg);
  observer = await conn(t0.id);
  await observer.send('Page.navigate', { url: base });
  await waitUntil(() => observer.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'observer boot');

  const runCase = async (kind) => {
    const ns = `r4_audit_crash_${kind}_${Date.now()}`;
    const seed = await observer.eval(`(async () => {
      const H = ${idb};
      const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
      const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
      const port = new pm.BrowserFilePort(${JSON.stringify(ns)});
      const coord = new cm.SingleWriterSaveCoordinator(port);
      const s0 = core.createInitialState({ saveEpoch: 'audit.r4.crash', startMs: 1700000000000, allowanceMs: 3600000 });
      const s1 = core.advanceOffline(s0, s0.cursorMs + 60000).state;
      await coord.loadSafe();
      const c = await coord.commit(s1, null);
      return { kind: c.kind, rev: c.revision ?? null, disk: await H(${JSON.stringify(ns)}) };
    })()`);

    const { targetId } = await observer.send('Target.createTarget', { url: base });
    const crasher = await conn(targetId);
    try {
      await waitUntil(() => crasher.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'crasher boot');
      await crasher.eval(`(async () => {
        const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new pm.BrowserFilePort(${JSON.stringify(ns)});
        const coord = new cm.SingleWriterSaveCoordinator(port);
        const cur = await coord.loadSafe();
        const cand = core.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;
        globalThis.__PAUSED__ = false;
        const origW = port.write.bind(port);
        const origR = port.read.bind(port);
        let wrotePath = null;
        port.write = async (p, t) => {
          if (${JSON.stringify(kind)} === 'prewrite') { globalThis.__PAUSED__ = true; await new Promise(() => {}); }
          await origW(p, t);
          wrotePath = p;
        };
        port.read = async (p) => {
          if (${JSON.stringify(kind)} === 'prereadback' && wrotePath && p === wrotePath) { globalThis.__PAUSED__ = true; await new Promise(() => {}); }
          return origR(p);
        };
        void coord.commit(cand, cur.revision);
      })()`);
      await waitUntil(() => crasher.eval(`Boolean(globalThis.__PAUSED__)`), 15000, 'pause ' + kind);
      crasher.close();
      await observer.send('Target.closeTarget', { targetId });
      await new Promise((r) => setTimeout(r, 400));

      const afterCrash = await observer.eval(`(${idb})(${JSON.stringify(ns)})`);
      const marker = afterCrash.marker ? JSON.parse(afterCrash.marker) : null;
      const blocked = await observer.eval(`(async () => {
        const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new pm.BrowserFilePort(${JSON.stringify(ns)});
        const coord = new cm.SingleWriterSaveCoordinator(port);
        const s0 = core.createInitialState({ saveEpoch: 'audit.r4.crash', startMs: 1700000000000, allowanceMs: 3600000 });
        const cand = core.advanceOffline(s0, s0.cursorMs + 120000).state;
        let writes = 0; const orig = port.write.bind(port); port.write = async (...a) => { writes++; return orig(...a); };
        const r = await coord.commit(cand, '1');
        return { kind: r.kind, writes };
      })()`);
      const recovery = await observer.eval(`(async () => {
        const cm = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const pm = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const core = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new pm.BrowserFilePort(${JSON.stringify(ns)});
        const coord = new cm.SingleWriterSaveCoordinator(port);
        const l = await coord.loadSafe();
        const markerAfter = await (${idb})(${JSON.stringify(ns)});
        const s0 = core.createInitialState({ saveEpoch: 'audit.r4.crash', startMs: 1700000000000, allowanceMs: 3600000 });
        const rec = l.kind === 'VALID' ? l.revision : null;
        let staleKind = 'SKIPPED_NEW_SAVE';
        if (rec !== '1') staleKind = (await coord.commit(core.advanceOffline(s0, s0.cursorMs + 180000).state, '1')).kind;
        const fresh = await coord.commit(core.advanceOffline(s0, s0.cursorMs + 240000).state, rec);
        return { loadKind: l.kind, loadRev: rec, markerAfter: markerAfter.marker, staleKind, freshKind: fresh.kind, freshRev: fresh.revision ?? null };
      })()`);
      return { ns, seed, afterCrash: { rev: afterCrash.rev, gold: afterCrash.gold }, markerState: marker?.state ?? null, markerStorageKey: marker?.storageKey ?? null, blocked, recovery };
    } finally {
      try { await observer.send('Target.closeTarget', { targetId }); } catch {}
    }
  };

  const pre = await runCase('prewrite');
  out.evidence.prewrite = pre;
  check('pre-write crash: durable PENDING marker remains', pre.markerState === 'PENDING' && pre.seed.disk.rev === '1' && pre.afterCrash.rev === '1', JSON.stringify(pre));
  check('pre-write crash: other realm blocked with 0 writes', pre.blocked.kind === 'STORAGE_UNAVAILABLE' && pre.blocked.writes === 0, JSON.stringify(pre.blocked));
  check('pre-write crash: explicit recovery -> VALID rev1, marker cleared, commit rev2', pre.recovery.loadKind === 'VALID' && pre.recovery.loadRev === '1' && pre.recovery.markerAfter === null && pre.recovery.freshKind === 'COMMITTED' && pre.recovery.freshRev === '2', JSON.stringify(pre.recovery));

  const rb = await runCase('prereadback');
  out.evidence.prereadback = rb;
  check('pre-readback crash: slot rev2 written, PENDING marker remains', rb.markerState === 'PENDING' && rb.afterCrash.rev === '2', JSON.stringify(rb));
  check('pre-readback crash: other realm blocked with 0 writes', rb.blocked.kind === 'STORAGE_UNAVAILABLE' && rb.blocked.writes === 0, JSON.stringify(rb.blocked));
  check('pre-readback crash: recovery discovers rev2; stale conf; fresh rev3', rb.recovery.loadKind === 'VALID' && rb.recovery.loadRev === '2' && rb.recovery.markerAfter === null && rb.recovery.staleKind === 'CONFLICT' && rb.recovery.freshKind === 'COMMITTED' && rb.recovery.freshRev === '3', JSON.stringify(rb.recovery));

  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-audit/a02-crash.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  observer?.close();
  try { chrome.kill(); } catch {}
  srv.server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== A02 CRASH R4: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);