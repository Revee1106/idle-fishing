/**
 * Independent REWORK-03 A01 race audit.
 * Real Chrome, production build of the snapshot, two same-origin tabs,
 * two isolated coordinators per tab over the SAME IndexedDB namespace.
 * Runs: empty-disk race + 12 interleaved rounds (6 pre-write barriers, 6 post-write/pre-readback barriers)
 * plus lock missing/rejected fail-closed, A05 task-error classification, and lock-holder crash recovery.
 *
 * Usage: node r3-race.mjs <label>
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LABEL = process.argv[2] || 'run';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.css': 'text/css', '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream',
};
function startServer(rootDir) {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rsp) => {
      const u = (req.url || '/').split('?')[0];
      const full = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        rsp.writeHead(404); rsp.end('nf'); return;
      }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(full).pipe(rsp);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1; this.pending = new Map(); this.events = [];
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(`CDP ${JSON.stringify(m.error)}`)) : resolve(m.result);
      } else if (m.method) this.events.push(m);
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Runtime exception: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function waitUntil(fn, ms, label) {
  const d = Date.now() + ms;
  while (Date.now() < d) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('TIMEOUT ' + label);
}
async function waitHttp(port) {
  return waitUntil(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const l = await r.json();
    return l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
  }, 15000, 'chrome http');
}

if (!fs.existsSync(path.join(WEB, 'index.html'))) {
  console.error('missing snapshot web build'); process.exit(2);
}
const { server, port } = await startServer(WEB);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r3-chrome-'));
const dbg = 9300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/`;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

const failures = [];
function check(name, cond, detail) {
  if (!cond) failures.push(`${name}: ${detail}`);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`);
}
async function conn(targetId) {
  const info = await waitUntil(async () => {
    const r = await fetch(`http://127.0.0.1:${dbg}/json/list`);
    const l = await r.json();
    return l.find((t) => t.id === targetId && t.webSocketDebuggerUrl) || null;
  }, 15000, 'target ' + targetId);
  const c = new Cdp(info.webSocketDebuggerUrl);
  await c.open();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  return c;
}
const IDB = `(() => {
  const DB='idle_fishing_fs_v1', ST='files';
  const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(ST))r.result.createObjectStore(ST);};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  return {
    async slots(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');const st=tx.objectStore(ST);const out=[null,null,null];for(let i=0;i<3;i++){const q=st.get(ns+':save_slot_'+i+'.json');q.onsuccess=()=>{out[i]=q.result??null;};}tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async top(ns){const s=await this.slots(ns);const envs=s.filter(Boolean).map(t=>JSON.parse(t)).sort((a,b)=>Number(b.revision)-Number(a.revision));const t=envs[0]||null;return t?{rev:t.revision,gold:JSON.parse(t.payload).gold,cursorMs:JSON.parse(t.payload).cursorMs}:{rev:null,gold:null,cursorMs:null};},
    async clear(ns){const db=await open();try{await new Promise((res,rej)=>{const tx=db.transaction(ST,'readwrite');const st=tx.objectStore(ST);const q=st.getAllKeys();q.onsuccess=()=>{for(const k of q.result){if(String(k).startsWith(ns+':'))st.delete(k);}};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
  };
})()`;

let A = null; let B = null; let C = null;
try {
  const t = await waitHttp(dbg);
  A = await conn(t.id);
  await A.send('Page.navigate', { url: base });
  await waitUntil(() => A.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'A boot');
  await new Promise((r) => setTimeout(r, 500));
  const { targetId: bId } = await A.send('Target.createTarget', { url: base });
  B = await conn(bId);
  await waitUntil(() => B.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'B boot');
  await A.send('Page.bringToFront');
  await new Promise((r) => setTimeout(r, 400));

  const stamp = Date.now();
  const nsEmpty = `audit_p0_empty_${stamp}`;
  const nsNonEmpty = `audit_p0_nonempty_${stamp}`;
  const setup = `((nsEmpty,nsNonEmpty)=>(async()=>{
    const coordMod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod=await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const coreMod=await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ctx={coordMod,portMod,coreMod,portEmpty:new portMod.BrowserFilePort(nsEmpty),portNonEmpty:new portMod.BrowserFilePort(nsNonEmpty)};
    ctx.coordEmpty=new coordMod.SingleWriterSaveCoordinator(ctx.portEmpty);
    ctx.coordNonEmpty=new coordMod.SingleWriterSaveCoordinator(ctx.portNonEmpty);
    globalThis.__CTX__=ctx;
    return {kind:ctx.portEmpty.kind,keyEmpty:ctx.coordEmpty.storageKey,keyNon:ctx.coordNonEmpty.storageKey};
  })())`;
  const metaA = await A.eval(`${setup}(${JSON.stringify(nsEmpty)},${JSON.stringify(nsNonEmpty)})`);
  const metaB = await B.eval(`${setup}(${JSON.stringify(nsEmpty)},${JSON.stringify(nsNonEmpty)})`);
  check('meta/port is IndexedDB in both tabs', metaA.kind === 'BROWSER_INDEXED_DB' && metaB.kind === 'BROWSER_INDEXED_DB' && metaA.keyNon === metaB.keyNon, JSON.stringify({ metaA, metaB }));

  // ---- Empty-disk race ----
  await A.eval(`globalThis.__CTX__.coordEmpty.loadSafe()`);
  await B.eval(`globalThis.__CTX__.coordEmpty.loadSafe()`);
  await A.eval(`(()=>{const {coordEmpty,coreMod}=globalThis.__CTX__;const b=coreMod.createInitialState({saveEpoch:'audit.p0.empty',startMs:1700000000000,allowanceMs:8*3600000});const c=coreMod.advanceOffline(b,b.cursorMs+60000).state;globalThis.__EH=false;globalThis.__ER=null;globalThis.__EA__=coordEmpty.commit(c,null,{beforeCommitBody:async()=>{globalThis.__EH=true;await new Promise(r=>{globalThis.__ER=r;});}}).then(x=>({res:x,gold:c.gold,cursorMs:c.cursorMs}));return true;})()`);
  await waitUntil(() => A.eval('Boolean(globalThis.__EH)'), 10000, 'A empty lock');
  await B.eval(`(()=>{const {coordEmpty,coreMod}=globalThis.__CTX__;const b=coreMod.createInitialState({saveEpoch:'audit.p0.empty',startMs:1700000000000,allowanceMs:8*3600000});const c=coreMod.advanceOffline(b,b.cursorMs+180000).state;globalThis.__EB__=coordEmpty.commit(c,null).then(x=>({res:x,gold:c.gold,cursorMs:c.cursorMs}));})()`);
  await waitUntil(async () => {
    const q = await A.eval('navigator.locks.query()');
    return q.held.some((l) => l.name.includes(nsEmpty)) && q.pending.some((l) => l.name.includes(nsEmpty));
  }, 10000, 'B empty pending lock');
  const eq = await A.eval('navigator.locks.query()');
  const eHeld = eq.held.find((l) => l.name.includes(nsEmpty))?.clientId;
  const ePend = eq.pending.find((l) => l.name.includes(nsEmpty))?.clientId;
  await A.eval('globalThis.__ER()');
  const ea = await A.eval('globalThis.__EA__');
  const eb = await B.eval('globalThis.__EB__');
  const emptyTopA = await A.eval(`(${IDB}).top(${JSON.stringify(nsEmpty)})`);
  const emptyTopB = await B.eval(`(${IDB}).top(${JSON.stringify(nsEmpty)})`);
  check('A01/empty: exactly one COMMITTED, one CONFLICT, disk=A candidate',
    Boolean(eHeld && ePend && eHeld !== ePend) &&
      ea.res.kind === 'COMMITTED' && ea.res.revision === '1' && eb.res.kind === 'CONFLICT' &&
      emptyTopA.rev === '1' && emptyTopA.gold === ea.gold && emptyTopB.gold === ea.gold,
    JSON.stringify({ eHeld: !!eHeld, ePend: !!ePend, a: ea.res.kind + '/' + ea.res.revision, b: eb.res.kind, topA: emptyTopA, topB: emptyTopB, aGold: ea.gold }));

  // ---- Seed rev 1..8 ----
  const seed = await A.eval(`(async()=>{const {coordNonEmpty,coreMod}=globalThis.__CTX__;await coordNonEmpty.loadSafe();let st=coreMod.createInitialState({saveEpoch:'audit.p0.race',startMs:1700000000000,allowanceMs:24*3600000});let rev=null;for(let i=0;i<8;i++){st=coreMod.advanceOffline(st,st.cursorMs+60000).state;const r=await coordNonEmpty.commit(st,rev);rev=r.revision;}return rev;})()`);
  check('A01/seed rev8', seed === '8', String(seed));

  let syncA = await A.eval('globalThis.__CTX__.coordNonEmpty.loadSafe()');
  let syncB = await B.eval('globalThis.__CTX__.coordNonEmpty.loadSafe()');
  const rounds = [];
  for (let round = 0; round < 12; round++) {
    const readbackBarrier = round >= 6;
    const expectedRev = syncA.revision;
    if (syncA.kind !== 'VALID' || syncB.kind !== 'VALID' || syncA.revision !== syncB.revision) {
      rounds.push({ round, preMismatch: true, a: syncA.revision, b: syncB.revision });
      break;
    }
    if (readbackBarrier) {
      await A.eval(`(()=>{const {portNonEmpty,coordNonEmpty,coreMod}=globalThis.__CTX__;
        const ow=portNonEmpty.write.bind(portNonEmpty), orr=portNonEmpty.read.bind(portNonEmpty);
        let wrote=null; globalThis.__RH=false; globalThis.__RR=null;
        portNonEmpty.write=async(p,t)=>{await ow(p,t);wrote=p;};
        portNonEmpty.read=async(p)=>{if(wrote&&p===wrote){wrote=null;globalThis.__RH=true;await new Promise(r=>{globalThis.__RR=r;});}return orr(p);};
        const c=coreMod.advanceOffline(${JSON.stringify(syncA.raw)},${syncA.raw.cursorMs}+60000).state;
        globalThis.__RA__=coordNonEmpty.commit(c,${JSON.stringify(expectedRev)}).finally(()=>{portNonEmpty.write=ow;portNonEmpty.read=orr;}).then(x=>({res:x,gold:c.gold,cursorMs:c.cursorMs}));
      })()`);
      await waitUntil(() => A.eval('Boolean(globalThis.__RH)'), 10000, `round ${round} readback barrier`);
    } else {
      await A.eval(`(()=>{const {coordNonEmpty,coreMod}=globalThis.__CTX__;globalThis.__RH=false;globalThis.__RR=null;
        const c=coreMod.advanceOffline(${JSON.stringify(syncA.raw)},${syncA.raw.cursorMs}+60000).state;
        globalThis.__RA__=coordNonEmpty.commit(c,${JSON.stringify(expectedRev)},{beforeCommitBody:async()=>{globalThis.__RH=true;await new Promise(r=>{globalThis.__RR=r;});}}).then(x=>({res:x,gold:c.gold,cursorMs:c.cursorMs}));
      })()`);
      await waitUntil(() => A.eval('Boolean(globalThis.__RH)'), 10000, `round ${round} lock barrier`);
    }
    await B.eval(`(()=>{const {coordNonEmpty,coreMod}=globalThis.__CTX__;const c=coreMod.advanceOffline(${JSON.stringify(syncB.raw)},${syncB.raw.cursorMs}+180000).state;globalThis.__RB__=coordNonEmpty.commit(c,${JSON.stringify(expectedRev)}).then(x=>({res:x,gold:c.gold,cursorMs:c.cursorMs}));})()`);
    await waitUntil(async () => {
      const q = await A.eval('navigator.locks.query()');
      return q.held.some((l) => l.name.includes(nsNonEmpty)) && q.pending.some((l) => l.name.includes(nsNonEmpty));
    }, 10000, `round ${round} B pending`);
    const qr = await A.eval('navigator.locks.query()');
    const held = qr.held.find((l) => l.name.includes(nsNonEmpty))?.clientId;
    const pend = qr.pending.find((l) => l.name.includes(nsNonEmpty))?.clientId;
    await A.eval('globalThis.__RR()');
    const ra = await A.eval('globalThis.__RA__');
    const rb = await B.eval('globalThis.__RB__');
    const postA = await A.eval('globalThis.__CTX__.coordNonEmpty.loadSafe()');
    const postB = await B.eval('globalThis.__CTX__.coordNonEmpty.loadSafe()');
    const topA = await A.eval(`(${IDB}).top(${JSON.stringify(nsNonEmpty)})`);
    const topB = await B.eval(`(${IDB}).top(${JSON.stringify(nsNonEmpty)})`);
    syncA = postA; syncB = postB;
    rounds.push({
      round, mode: readbackBarrier ? 'post-write-pre-readback' : 'pre-write',
      distinctClients: Boolean(held && pend && held !== pend),
      expectedRev,
      a: ra.res.kind + '/' + (ra.res.revision ?? '-') + '/s' + (ra.res.slot ?? '-'),
      b: rb.res.kind,
      aGold: ra.gold, bGold: rb.gold,
      postA: postA.revision, postB: postB.revision,
      postAGold: postA.raw?.gold, postBGold: postB.raw?.gold,
      topA, topB,
    });
  }
  const clean = rounds.length === 12 && rounds.every((r) =>
    !r.preMismatch && r.distinctClients && r.a.startsWith('COMMITTED/') && r.b === 'CONFLICT' &&
    r.postA === r.a.split('/')[1] && r.postB === r.a.split('/')[1] &&
    r.postAGold === r.aGold && r.postBGold === r.aGold && r.topA.gold === r.aGold && r.topB.gold === r.aGold
  );
  const doubles = rounds.filter((r) => r.a?.startsWith('COMMITTED') && r.b === 'COMMITTED').length;
  check('A01/12 rounds interleaved: zero double-COMMITTED, unique winner on disk', clean, JSON.stringify({ rounds: rounds.length, doubles, last: rounds[rounds.length - 1] }));

  // ---- A05 task error vs genuine lock rejection (fresh namespace) ----
  const a05 = await B.eval(`(async()=>{
    const {coordMod,portMod,coreMod}=globalThis.__CTX__;
    const ns='audit_a05_'+Date.now();
    const port=new portMod.BrowserFilePort(ns);
    const coord=new coordMod.SingleWriterSaveCoordinator(port);
    await coord.loadSafe();
    const b=coreMod.createInitialState({saveEpoch:'audit.a05',startMs:1700000000000,allowanceMs:3600000});
    const c=coreMod.advanceOffline(b,b.cursorMs+60000).state;
    let msg=null;
    try{await coord.commit(c,null,{beforeCommitBody:async()=>{throw new Error('audit body throw');}});}catch(e){msg=e instanceof Error?e.message:String(e);}
    const healthAfterTaskErr=coord.storageHealth;
    const okAfter=await coord.commit(c,null);
    const orig=navigator.locks;
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(new Error('audit lock reject'))}});
    const rej=await coord.commit(c,'1');
    Object.defineProperty(navigator,'locks',{configurable:true,value:orig});
    await coord.loadSafe();
    Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
    const miss=await coord.commit(c,'1');
    Object.defineProperty(navigator,'locks',{configurable:true,value:orig});
    await coord.loadSafe();
    await port.clearAll();
    return {msg,healthAfterTaskErr,okAfter:okAfter.kind,rejKind:rej.kind,rejDetail:rej.detail,missKind:miss.kind,missDetail:miss.detail};
  })()`);
  check('A05: task error propagates unclassified; genuine lock rejection/missing fail-closed',
    a05.msg === 'audit body throw' && a05.healthAfterTaskErr === 'AVAILABLE' && a05.okAfter === 'COMMITTED' &&
      a05.rejKind === 'STORAGE_UNAVAILABLE' && String(a05.rejDetail).includes('CROSS_TAB_LOCK_REJECTED') &&
      a05.missKind === 'STORAGE_UNAVAILABLE' && String(a05.missDetail).includes('CROSS_TAB_LOCK_UNAVAILABLE'),
    JSON.stringify(a05));

  // ---- Lock-holder crash recovery on the race namespace ----
  const { targetId: cId } = await A.send('Target.createTarget', { url: base });
  C = await conn(cId);
  await waitUntil(() => C.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'C boot');
  await C.eval(`(()=>{globalThis.__CH=false;navigator.locks.request('idle-fishing:save:'+${JSON.stringify(metaA.keyNon)},{mode:'exclusive'},()=>{globalThis.__CH=true;return new Promise(()=>{});});setTimeout(()=>{globalThis.__CH=true;},50);})()`);
  await waitUntil(() => C.eval('Boolean(globalThis.__CH)'), 5000, 'C holds crash lock');
  C.close(); C = null;
  await A.send('Target.closeTarget', { targetId: cId });
  await new Promise((r) => setTimeout(r, 500));
  const crash = await A.eval(`(async()=>{const {coordNonEmpty,coreMod}=globalThis.__CTX__;const l=await coordNonEmpty.loadSafe();const c=coreMod.advanceOffline(l.raw,l.raw.cursorMs+60000).state;const r=await coordNonEmpty.commit(c,l.revision);const re=await coordNonEmpty.loadSafe();return {rev:l.revision,kind:r.kind,newRev:r.revision??null,reload:re.revision??null};})()`);
  check('A01/lock holder crash: Chrome auto-release + survivor commits', crash.rev === '20' && crash.kind === 'COMMITTED' && crash.newRev === '21' && crash.reload === '21', JSON.stringify(crash));

  await A.eval(`(${IDB}).clear(${JSON.stringify(nsEmpty)})`);
  await A.eval(`(${IDB}).clear(${JSON.stringify(nsNonEmpty)})`);
  fs.writeFileSync(path.join('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-audit', `race-${LABEL}.json`), JSON.stringify({ label: LABEL, metaA, metaB, empty: { eHeld: !!eHeld, ePend: !!ePend, a: ea.res.kind, b: eb.res.kind, topA: emptyTopA }, rounds, doubles, a05, crash, failures }, null, 2));
} catch (err) {
  failures.push('harness: ' + (err instanceof Error ? err.stack : String(err)));
  console.log('[FAIL] harness :: ' + (err instanceof Error ? err.message : String(err)));
} finally {
  A?.close(); B?.close(); C?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== RACE ${LABEL}: ${failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (failures.length) { failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);