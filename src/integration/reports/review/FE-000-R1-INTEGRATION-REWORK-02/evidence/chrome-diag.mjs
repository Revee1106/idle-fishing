/** Focused diagnostics for T3 (cross-tab result) and T9 (crash recovery reload). */
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };
function startServer(rootDir) { return new Promise((res, rej) => { const s = http.createServer((req, rsp) => { const u = (req.url || '/').split('?')[0]; const full = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(full).pipe(rsp); }); s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port })); }); }
class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.p = new Map(); this.events = []; this.ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method) this.events.push(m); }); }
  async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.p.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e, awaitPromise = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, label) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error('TIMEOUT ' + label); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }

const { s: server, port } = await startServer(WEB);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r2-diag-'));
const dbg = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const base = `http://127.0.0.1:${port}/`;
async function conn(tid) { const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null; }, 15000, 'target'); const c = new Cdp(info.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); return c; }
async function openTab(a) { const { targetId } = await a.send('Target.createTarget', { url: base }); const c = await conn(targetId); await waitUntil(() => c.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 30000, 'boot'); await new Promise((r) => setTimeout(r, 400)); return { c, targetId }; }
const H = (c, e) => c.eval(`globalThis.__SPIKE_HARNESS__.${e}`);
const disk = (c) => c.eval(`(() => { const e=[0,1,2].map(i=>localStorage.getItem(${JSON.stringify(PREFIX)}+'save_slot_'+i+'.json')).filter(Boolean).map(t=>JSON.parse(t)); const t=e.sort((a,b)=>Number(b.revision)-Number(a.revision))[0]; return t?{rev:t.revision,count:e.length}:{rev:null,count:0}; })()`);

let A = null;
let B = null;
try {
  const t = await waitHttp(dbg);
  A = await conn(t.id);
  await A.send('Page.navigate', { url: base });
  await waitUntil(() => A.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 30000, 'A boot');
  await new Promise((r) => setTimeout(r, 400));
  const { c: Bt } = await openTab(A);
  B = Bt;
  await A.send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 300));
  await H(A, 'awaitPendingHideSave()');
  await H(B, 'awaitPendingHideSave()');
  await H(A, 'clearLifecyclePersistence()');
  await H(B, 'reinitializePersistence()');

  console.log('--- T3 diag ---');
  await A.eval(`(() => { window.__A_HELD=false; window.__A_REL=null; window.__A_P=globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(60000,null,async()=>{window.__A_HELD=true;await new Promise(r=>{window.__A_REL=r;});}); return true; })()`);
  await waitUntil(() => A.eval('Boolean(window.__A_HELD)'), 10000, 'A holds');
  await B.eval(`(() => { window.__B_STATUS='pending'; window.__B_P=globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(180000,null); window.__B_P.then(r=>{window.__B_RESULT=r;window.__B_STATUS='done';}).catch(e=>{window.__B_RESULT={error:String(e),stack:e&&e.stack};window.__B_STATUS='error';}); return true; })()`);
  await new Promise((r) => setTimeout(r, 700));
  console.log('B status while held:', await B.eval('window.__B_STATUS'));
  await A.eval('window.__A_REL()');
  const aRes = await A.eval('window.__A_P');
  await waitUntil(async () => (await B.eval('window.__B_STATUS')) !== 'pending', 15000, 'B resolves');
  console.log('A result:', JSON.stringify(aRes));
  console.log('B status:', await B.eval('window.__B_STATUS'));
  console.log('B result raw:', JSON.stringify(await B.eval('window.__B_RESULT')));
  console.log('disk:', JSON.stringify(await disk(B)));

  console.log('--- T9 diag ---');
  const { c: C, targetId: cid } = await openTab(A);
  await C.eval(`(() => { window.__C_HELD=false; navigator.locks.request(${JSON.stringify(LOCK_NAME)},{mode:'exclusive'},()=>new Promise(()=>{})); setTimeout(()=>{window.__C_HELD=true;},50); return true; })()`);
  await waitUntil(() => C.eval('Boolean(window.__C_HELD)'), 5000, 'C holds');
  C.close();
  await A.send('Target.closeTarget', { targetId: cid });
  await new Promise((r) => setTimeout(r, 800));
  const rec = await H(A, 'reinitializePersistence()');
  console.log('reinit after crash:', JSON.stringify(rec));
  const c4 = await H(A, `commitCandidateViaCoordinator(30000, ${JSON.stringify(rec.revision)})`);
  console.log('commit after crash:', JSON.stringify(c4));
  const markBefore = await A.eval(`globalThis.__DIAG_MARK__='old'`);
  await A.send('Page.reload', { ignoreCache: true });
  try {
    await waitUntil(async () => {
      try { return (await A.eval('globalThis.__DIAG_MARK__ === undefined')) === true; } catch { return false; }
    }, 15000, 'new context');
    console.log('new context established');
  } catch (e) {
    console.log('reload context error:', e.message);
    console.log('console/exception events:', JSON.stringify(A.events.filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Runtime.consoleAPICalled').slice(-6)).slice(0, 1200));
  }
  try {
    await waitUntil(() => A.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 20000, 'A ready');
    const snap = await H(A, 'getSnapshot().lifecyclePersistence');
    console.log('A after reload snapshot:', JSON.stringify(snap));
  } catch (e) {
    console.log('A ready timeout:', e.message);
    console.log('doc readyState:', await A.eval('document.readyState').catch((x) => 'eval-fail ' + x.message));
    console.log('harness keys:', await A.eval('Object.keys(globalThis.__SPIKE_HARNESS__||{})').catch((x) => 'eval-fail'));
    console.log('exceptions:', JSON.stringify(A.events.filter((e) => e.method === 'Runtime.exceptionThrown').slice(-3)).slice(0, 1500));
    console.log('console errors:', JSON.stringify(A.events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error').slice(-3)).slice(0, 1500));
  }
} finally {
  A?.close(); B?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}