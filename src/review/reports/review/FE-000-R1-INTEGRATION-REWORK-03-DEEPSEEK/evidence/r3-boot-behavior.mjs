/** BootEntry-level UNCERTAIN halt, queued-destroy cancellation, and A09 concurrent diagnostics. */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const NS = 'idle_fishing_lifecycle_persist_fs';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream' };
function startServer(rootDir) {
  return new Promise((res, rej) => {
    const s = http.createServer((q, r) => {
      const u = (q.url || '/').split('?')[0];
      const f = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
      if (!f.startsWith(rootDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end('nf'); return; }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}
class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.p = new Map(); this.events = []; this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.p.has(m.id)) { const { r, j } = this.p.get(m.id); this.p.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); } else if (m.method) this.events.push(m); }); }
  async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(m, p = {}) { const id = this.id++; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, l) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 120)); } throw new Error('TIMEOUT ' + l); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }
const { server, port } = await startServer(WEB);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r3-extra-'));
const dbg = 9600 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}/`;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const out = { failures: [] };
const WATCH = setTimeout(() => { console.log('[WATCHDOG] 150s elapsed, aborting'); process.exit(3); }, 150000);
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }
const IDB_SLOTS = `(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('idle_fishing_fs_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{return await new Promise((res,rej)=>{const tx=db.transaction('files','readonly');const st=tx.objectStore('files');const o=[null,null,null];for(let i=0;i<3;i++){const q=st.get(${JSON.stringify(NS)}+':save_slot_'+i+'.json');q.onsuccess=()=>{o[i]=q.result??null;};}tx.oncomplete=()=>res(o);tx.onerror=()=>rej(tx.error);});}finally{db.close();}})()`;
async function conn(tid) { const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null; }, 15000, 'target'); const c = new Cdp(info.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); return c; }
async function ready(c, label) { await waitUntil(() => c.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, label); await new Promise((r) => setTimeout(r, 400)); }
let A = null; let B = null;
try {
  const t = await waitHttp(dbg);
  A = await conn(t.id);
  await A.send('Page.navigate', { url: base });
  await ready(A, 'A boot');
  await A.eval(`(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('idle_fishing_fs_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{await new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');const st=tx.objectStore('files');const q=st.getAllKeys();q.onsuccess=()=>{for(const k of q.result){if(String(k).startsWith(${JSON.stringify(NS)}+':'))st.delete(k);}};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}localStorage.clear();})()`);
  await A.send('Page.reload', { ignoreCache: true });
  console.log('[stage] A clean boot');
  await ready(A, 'A clean boot');
  console.log('[stage] T1 start');

  // T1: BootEntry handles coordinator UNCERTAIN -> halt, subsequent HIDE skipped, zero writes
  const t1 = await A.eval(`(async()=>{
    const mod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const proto=mod.SingleWriterSaveCoordinator.prototype;
    const orig=proto.commit; let injected=0;
    proto.commit=function(...args){ if(injected++===0) return Promise.resolve({kind:'UNCERTAIN',detail:'audit injected uncertain'}); return orig.apply(this,args); };
    const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};
    const slotsBefore=await ${IDB_SLOTS};
    try{
      fire('hidden'); fire('visible');
      const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      fire('hidden'); fire('visible');
      const rec2=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const hist=globalThis.__SPIKE_HARNESS__.getCommitHistory();
      const slotsAfter=await ${IDB_SLOTS};
      return {rec:{health:rec.storageHealth,halted:rec.persistenceHalted,last:rec.lastCommitKind},rec2:{halted:rec2.persistenceHalted},hist:hist.map(h=>h.taskState+'/'+h.resultKind),slotsSame:JSON.stringify(slotsBefore)===JSON.stringify(slotsAfter)};
    } finally { proto.commit=orig; }
  })()`);
  console.log('[stage] T1 done');
  check('BootEntry/UNCERTAIN: halted, later HIDE SKIPPED_HALTED, zero writes',
    t1.rec.health === 'STORAGE_UNAVAILABLE' && t1.rec.halted === true && t1.rec.last === 'UNCERTAIN' &&
      t1.hist[t1.hist.length - 1]?.includes('SKIPPED_HALTED') && t1.slotsSame === true,
    JSON.stringify(t1));

  // T2: destroy while first HIDE is paused inside coordinator commit -> both queued tasks cancelled, zero writes
  await A.send('Page.reload', { ignoreCache: true });
  console.log('[stage] T2 reload');
  await ready(A, 'A reload for destroy queue');
  console.log('[stage] T2 start');
  const t2 = await A.eval(`(async()=>{
    const mod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const proto=mod.SingleWriterSaveCoordinator.prototype;
    const orig=proto.commit; let calls=0;
    let releaseBody=null; let entered=null;
    const enteredP=new Promise(r=>{entered=r;});
    proto.commit=function(...args){ calls++; if(calls===1){ const self=this; entered(); return new Promise((res,rej)=>{releaseBody=()=>orig.apply(self,args).then(res,rej);}); } return orig.apply(this,args); };
    const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};
    const slotsBefore=await ${IDB_SLOTS};
    fire('hidden'); fire('visible');
    await enteredP;
    fire('hidden'); fire('visible');
    const cc=globalThis.cc; const boot=cc.director.getScene().getComponentInChildren('BootEntry'); boot.destroy();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    releaseBody();
    await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    const hist=globalThis.__SPIKE_HARNESS__.getCommitHistory();
    const slotsAfter=await ${IDB_SLOTS};
    proto.commit=orig;
    return {hist:hist.map(h=>h.taskState+'/'+h.resultKind),slotsSame:JSON.stringify(slotsBefore)===JSON.stringify(slotsAfter)};
  })()`);
  check('BootEntry/queued destroy: all queued HIDEs CANCELLED, zero writes',
    t2.hist.length === 2 && t2.hist.every((h) => h.startsWith('CANCELLED')) && t2.slotsSame === true,
    JSON.stringify(t2));

  // T3: A09 concurrent diagnostics in two tabs
  await A.send('Page.reload', { ignoreCache: true });
  console.log('[stage] T3 reload');
  await ready(A, 'A reload for A09');
  console.log('[stage] T3 start');
  const { targetId: bId } = await A.send('Target.createTarget', { url: base });
  B = await conn(bId);
  await ready(B, 'B boot for A09');
  const [resA, resB] = await Promise.all([
    A.eval(`globalThis.__SPIKE_HARNESS__.runAllPlatformChecks()`),
    B.eval(`globalThis.__SPIKE_HARNESS__.runAllPlatformChecks()`),
  ]);
  const fsA = resA?.find?.((r) => r.id === 'FS-CRUD') || null;
  const fsB = resB?.find?.((r) => r.id === 'FS-CRUD') || null;
  const count = (r) => (Array.isArray(r) ? r.filter((x) => x.status === 'PASS').length + '/' + r.length : 'n/a');
  console.log('[stage] T3 done');
  check('A09: concurrent platform diagnostics in two tabs both pass', count(resA) === '6/6' && count(resB) === '6/6', JSON.stringify({ a: count(resA), b: count(resB) }));
  out.t1 = t1; out.t2 = t2; out.a09 = { a: count(resA), b: count(resB) };
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/boot-behavior.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  A?.close(); B?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== BOOT BEHAVIOR: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);