/**
 * Independent REWORK-03 A02 cross-tab audit.
 * UNCERTAIN is created in Tab A (real IndexedDB port, write fails before landing + reads fail),
 * then Tab B (separate realm, healthy port, same storageKey) is asked to commit WITHOUT loadSafe.
 * Also checks same-page second coordinator is frozen, and recovery semantics.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
  constructor(u) { this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.events = []; this.ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method) this.events.push(m); }); }
  async open() { if (this.ws.readyState === WebSocket.OPEN) return; await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(m, p = {}) { const id = this.id++; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method: m, params: p })); }); }
  async eval(e, a = true) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: a, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result?.value; }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, l) { const d = Date.now() + ms; while (Date.now() < d) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 120)); } throw new Error('TIMEOUT ' + l); }
async function waitHttp(port) { return waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${port}/json/list`); const l = await r.json(); return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null; }, 15000, 'http'); }

const { server, port } = await startServer(WEB);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r3-a02-'));
const dbg = 9800 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${port}/`;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

const out = { failures: [] };
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }
async function conn(tid) { const info = await waitUntil(async () => { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const l = await r.json(); return l.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null; }, 15000, 'target'); const c = new Cdp(info.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); return c; }

const IDB_TOP = `(() => {
  const DB='idle_fishing_fs_v1',ST='files';
  return async (ns)=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(ST))r.result.createObjectStore(ST);};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');const st=tx.objectStore(ST);const o=[null,null,null];for(let i=0;i<3;i++){const q=st.get(ns+':save_slot_'+i+'.json');q.onsuccess=()=>{o[i]=q.result??null;};}tx.oncomplete=()=>{const e=o.filter(Boolean).map(t=>JSON.parse(t)).sort((a,b)=>Number(b.revision)-Number(a.revision));res(e[0]?{rev:e[0].revision,gold:JSON.parse(e[0].payload).gold}:{rev:null,gold:null});};tx.onerror=()=>rej(tx.error);});}finally{db.close();}};
})()`;

let A = null; let B = null;
try {
  const t = await waitHttp(dbg);
  A = await conn(t.id);
  await A.send('Page.navigate', { url: base });
  await waitUntil(() => A.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'A boot');
  const { targetId: bId } = await A.send('Target.createTarget', { url: base });
  B = await conn(bId);
  await waitUntil(() => B.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'B boot');
  await A.send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 300));

  const ns = `audit_a02_${Date.now()}`;
  const setupA = `(async()=>{
    const coordMod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod=await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const faultMod=await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
    const errMod=await System.import('chunks:///_virtual/WeChatFilePort.ts');
    const coreMod=await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const inner=new portMod.BrowserFilePort(${JSON.stringify(ns)});
    let armed=false, afterWrite=false;
    const wrapper={kind:'FAULT_WRAPPER',storageKey:inner.storageKey,probeStorage:()=>inner.probeStorage(),
      read:async(p)=>{if(armed&&afterWrite)throw new errMod.FilePortIoError('READ_IO_ERROR',p,'audit read failure');return inner.read(p);},
      write:async(p,t)=>{if(armed){afterWrite=true;throw new errMod.FilePortIoError('WRITE_IO_ERROR',p,'audit write failure before landing');}return inner.write(p,t);},
      remove:(p)=>inner.remove(p),list:(d)=>inner.list(d)};
    const coord1=new coordMod.SingleWriterSaveCoordinator(wrapper);
    const coord2=new coordMod.SingleWriterSaveCoordinator(new portMod.BrowserFilePort(${JSON.stringify(ns)}));
    const s0=coreMod.createInitialState({saveEpoch:'audit.a02',startMs:1700000000000,allowanceMs:3600000});
    const s1=coreMod.advanceOffline(s0,s0.cursorMs+60000).state;
    const s2=coreMod.advanceOffline(s1,s1.cursorMs+60000).state;
    const s3=coreMod.advanceOffline(s2,s2.cursorMs+60000).state;
    globalThis.__A02__={wrapper,coord1,coord2,s1,s2,s3,armed:false,setArmed:(v)=>{armed=v;},readInner:inner};
    await coord1.loadSafe();
    const c1=await coord1.commit(s1,null);
    const c2=await coord1.commit(s2,'1');
    return {seed1:c1.kind,seed2:c2.kind,key:coord1.storageKey,innerKind:inner.kind};
  })()`;
  const seed = await A.eval(setupA);
  check('setup: two commits over IndexedDB', seed.seed1 === 'COMMITTED' && seed.seed2 === 'COMMITTED' && seed.innerKind === 'BROWSER_INDEXED_DB', JSON.stringify(seed));

  // Arm failure: write fails BEFORE landing; reads fail afterwards -> repo.commit cannot confirm
  const uncertain = await A.eval(`(async()=>{
    const {coord1,coord2,s3,setArmed,wrapper}=globalThis.__A02__;
    setArmed(true);
    const r=await coord1.commit(s3,'2');
    const health1=coord1.storageHealth;
    const freeze1=coord1.freezeCode;
    const health2=coord2.storageHealth;
    const disk=await (${IDB_TOP})(${JSON.stringify(ns)});
    return {kind:r.kind,detail:r.detail,health1,freeze1,health2,disk};
  })()`);
  console.log('[evidence] Tab A UNCERTAIN:', JSON.stringify(uncertain));
  check('Tab A UNCERTAIN and A-local freeze; write did not land', uncertain.kind === 'UNCERTAIN' && uncertain.health1 === 'STORAGE_UNAVAILABLE' && uncertain.freeze1 === 'UNCERTAIN_WRITE_PENDING_RECOVERY' && uncertain.disk.rev === '2', JSON.stringify(uncertain));
  check('same-page second coordinator frozen', uncertain.health2 === 'STORAGE_UNAVAILABLE', String(uncertain.health2));

  // Same-page second coordinator commit must be blocked (0 writes)
  const samePage = await A.eval(`(async()=>{
    const {coord2,s3}=globalThis.__A02__;
    const r=await coord2.commit(s3,'2');
    const disk=await (${IDB_TOP})(${JSON.stringify(ns)});
    return {kind:r.kind,disk};
  })()`);
  check('same-page second coordinator commit blocked by shared freeze', samePage.kind === 'STORAGE_UNAVAILABLE' && samePage.disk.rev === '2', JSON.stringify(samePage));

  // Tab B (separate realm) healthy coordinator WITHOUT loadSafe commit
  const crossTab = await B.eval(`(async()=>{
    const coordMod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod=await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const coreMod=await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const port=new portMod.BrowserFilePort(${JSON.stringify(ns)});
    const coord=new coordMod.SingleWriterSaveCoordinator(port);
    const healthBefore=coord.storageHealth;
    const freezeBefore=coord.freezeCode;
    const s0=coreMod.createInitialState({saveEpoch:'audit.a02',startMs:1700000000000,allowanceMs:3600000});
    const s1=coreMod.advanceOffline(s0,s0.cursorMs+60000).state;
    const s2=coreMod.advanceOffline(s1,s1.cursorMs+60000).state;
    const s3=coreMod.advanceOffline(s2,s2.cursorMs+60000).state;
    const r=await coord.commit(s3,'2');
    const healthAfter=coord.storageHealth;
    const disk=await (${IDB_TOP})(${JSON.stringify(ns)});
    return {healthBefore,freezeBefore,kind:r.kind,revision:r.revision??null,detail:r.detail??null,healthAfter,disk};
  })()`);
  console.log('[evidence] Tab B cross-tab commit after A UNCERTAIN:', JSON.stringify(crossTab));
  const bypass = crossTab.kind === 'COMMITTED' && crossTab.disk.rev === '3';
  check('A02 CROSS-TAB: Tab B without loadSafe MUST be STORAGE_UNAVAILABLE with zero writes',
    crossTab.kind === 'STORAGE_UNAVAILABLE' && crossTab.disk.rev === '2',
    `actual B=${crossTab.kind} diskRev=${crossTab.disk.rev} (bypass=${bypass}) healthBefore=${crossTab.healthBefore}/${crossTab.freezeBefore}`);

  // A recovers explicitly after evidence
  const recover = await A.eval(`(async()=>{
    const {coord1,coord2,s1,setArmed}=globalThis.__A02__;
    setArmed(false);
    const l=await coord1.loadSafe();
    return {kind:l.kind,rev:l.kind==='VALID'?l.revision:null,health:coord1.storageHealth,health2:coord2.storageHealth};
  })()`);
  check('explicit loadSafe re-reads real disk after cross-tab write', recover.kind === 'VALID' && recover.rev === '3' && recover.health === 'AVAILABLE', JSON.stringify(recover));

  out.uncertain = uncertain;
  out.samePage = samePage;
  out.crossTab = crossTab;
  out.recover = recover;
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/a02-cross-tab.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  A?.close(); B?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== A02 CROSS-TAB: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);