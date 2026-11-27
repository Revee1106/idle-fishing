/** Independent boot-time STORAGE_UNAVAILABLE fail-closed check on the real Web build. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PREFIX = 'idle_fishing_lifecycle_persist_fs:';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };
function startServer(rootDir) { return new Promise((res, rej) => { const s = http.createServer((req, rsp) => { const u = (req.url || '/').split('?')[0]; const full = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, '')); if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(full).pipe(rsp); }); s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port })); }); }
class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.p = new Map(); this.ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }); }
  async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(method, params = {}) { const id = this.id++; return new Promise((res, rej) => { this.p.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(e, awaitPromise = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, label) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error('TIMEOUT ' + label); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }

const { s: server, port } = await startServer(WEB);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r2-boot-'));
const dbg = 9850 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const base = `http://127.0.0.1:${port}/`;
let c = null;
try {
  const t = await waitHttp(dbg);
  c = new Cdp(t.webSocketDebuggerUrl);
  await c.open();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url: base });
  await waitUntil(() => c.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 30000, 'initial boot');
  await new Promise((r) => setTimeout(r, 300));
  await c.eval('globalThis.__SPIKE_HARNESS__.clearLifecyclePersistence()');
  // Seed rev1
  await c.eval(`(async () => { Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'}); document.dispatchEvent(new Event('visibilitychange')); await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); })()`);
  const seeded = await c.eval('globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence');
  const slotsBefore = await c.eval(`[0,1,2].map(i=>localStorage.getItem(${JSON.stringify(PREFIX)}+'save_slot_'+i+'.json'))`);
  // Fail ONLY the probe key write on every new document => next boot must be STORAGE_UNAVAILABLE, not EMPTY
  const { identifier } = await c.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (String(k).endsWith('__probe__')) throw new Error('audit probe failure'); return orig.call(this, k, v); }; })();`,
  });
  await c.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => c.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 30000, 'faulted boot');
  await new Promise((r) => setTimeout(r, 300));
  const faulted = await c.eval('globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence');
  const afterHideAttempt = await c.eval(`(async () => {
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
    return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
  })()`);
  const slotsDuring = await c.eval(`[0,1,2].map(i=>localStorage.getItem(${JSON.stringify(PREFIX)}+'save_slot_'+i+'.json'))`);
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await c.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => c.eval('Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)'), 30000, 'recovered boot');
  await new Promise((r) => setTimeout(r, 300));
  const recovered = await c.eval('globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence');
  const slotsAfter = await c.eval(`[0,1,2].map(i=>localStorage.getItem(${JSON.stringify(PREFIX)}+'save_slot_'+i+'.json'))`);

  const pass =
    seeded?.revision === '1' &&
    faulted?.loadStatus === 'STORAGE_UNAVAILABLE' &&
    faulted?.storageHealth === 'STORAGE_UNAVAILABLE' &&
    faulted?.persistenceHalted === true &&
    faulted?.restoredOnBoot === false &&
    afterHideAttempt?.hideCommitCount === 0 &&
    afterHideAttempt?.lastCommitKind !== 'COMMITTED' &&
    JSON.stringify(slotsBefore) === JSON.stringify(slotsDuring) &&
    JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter) &&
    recovered?.loadStatus === 'VALID' &&
    recovered?.revision === '1' &&
    recovered?.restoredOnBoot === true;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] chrome/T13 boot with failing storage probe is fail-closed, zero writes, then recovers exact save`);
  console.log(JSON.stringify({ seededRev: seeded?.revision, faultedStatus: faulted?.loadStatus, health: faulted?.storageHealth, halted: faulted?.persistenceHalted, hideCommits: afterHideAttempt?.hideCommitCount, slotsUnchanged: JSON.stringify(slotsBefore) === JSON.stringify(slotsDuring), recoveredRev: recovered?.revision, recoveredStatus: recovered?.loadStatus }));
  process.exit(pass ? 0 : 1);
} finally {
  c?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}