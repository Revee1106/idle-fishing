/**
 * Independent REWORK-03 audit: A04 (production harness + real Cocos destroy), A06 (queue poisoning),
 * and IndexedDB/localStorage compatibility matrix (no migration, both-present, IDB open failure,
 * IDB absent fallback / resurrection).
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap';
const WEB = path.join(SNAP, 'apps/game-client/build/web-mobile');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const NS = 'idle_fishing_lifecycle_persist_fs';
const LPREFIX = NS + ':';
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
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r3-a04-'));
const dbg = 9900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}/`;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

const out = { failures: [] };
function check(name, cond, detail) { if (!cond) out.failures.push(`${name}: ${detail}`); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`); }
const IDB = `(() => {
  const DB='idle_fishing_fs_v1',ST='files';
  const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(ST))r.result.createObjectStore(ST);};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  return {
    async slots(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');const st=tx.objectStore(ST);const o=[null,null,null];for(let i=0;i<3;i++){const q=st.get(ns+':save_slot_'+i+'.json');q.onsuccess=()=>{o[i]=q.result??null;};}tx.oncomplete=()=>res(o);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async clear(ns){const db=await open();try{await new Promise((res,rej)=>{const tx=db.transaction(ST,'readwrite');const st=tx.objectStore(ST);const q=st.getAllKeys();q.onsuccess=()=>{for(const k of q.result){if(String(k).startsWith(ns+':'))st.delete(k);}};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
  };
})()`;

let c = null;
let scriptIds = [];
async function reloadAndReady(label) {
  await c.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => c.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, label);
  await new Promise((r) => setTimeout(r, 400));
}
async function addInitScript(source) {
  const { identifier } = await c.send('Page.addScriptToEvaluateOnNewDocument', { source });
  scriptIds.push(identifier);
  return identifier;
}
async function removeScript(id) {
  try { await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch {}
  scriptIds = scriptIds.filter((x) => x !== id);
}
try {
  const t = await waitHttp(dbg);
  c = new Cdp(t.webSocketDebuggerUrl);
  await c.open();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url: base });
  await waitUntil(() => c.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'boot');
  await new Promise((r) => setTimeout(r, 500));
  await c.eval(`(${IDB}).clear(${JSON.stringify(NS)})`);
  await c.eval(`localStorage.clear()`);
  await reloadAndReady('clean boot');

  // ---------- A04: production surface audit ----------
  const audit = await c.eval(`(async()=>{
    const h=globalThis.__SPIKE_HARNESS__||{};
    const mod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const forbidden=['clearLifecyclePersistence','getPersistCoordinator','commitCandidateViaCoordinator','setCommitTestHooks','requestHideSaveForTest','triggerDestroyForTest','advancePersistState','reinitializePersistence'];
    return {keys:Object.keys(h).sort(),present:forbidden.filter(k=>typeof h[k]!=='undefined'),
      protoClear:typeof mod.SingleWriterSaveCoordinator.prototype.clearSlotsForTest!=='undefined',
      ownMethods:Object.getOwnPropertyNames(mod.SingleWriterSaveCoordinator.prototype)};
  })()`);
  check('A04/1 production harness exposes no destructive/owner-bypass API', audit.present.length === 0 && audit.protoClear === false, JSON.stringify(audit));

  // Seed rev1 via real HIDE
  const seed = await c.eval(`(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();})()`);
  check('A04/seed rev1 via real HIDE', seed?.revision === '1', JSON.stringify(seed));

  // Real Cocos destroy + HIDE zero writes
  const destroyed = await c.eval(`(async()=>{
    const idb=${IDB};
    const before=await idb.slots(${JSON.stringify(NS)});
    const cc=globalThis.cc;
    const boot=cc.director.getScene().getComponentInChildren('BootEntry');
    const propsBefore={coord:!!boot.persistCoordinator,port:!!boot.persistPort,state:!!boot.persistState};
    boot.destroy();
    await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const snap=globalThis.__SPIKE_HARNESS__.getSnapshot();
    const blockedSwitch=globalThis.__SPIKE_HARNESS__.switchPage('platform')===false;
    const blockedCore=globalThis.__SPIKE_HARNESS__.runCoreChecks()===null;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r)=>setTimeout(r,350));
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
    const after=await idb.slots(${JSON.stringify(NS)});
    return {propsBefore,propsAfter:{coord:boot.persistCoordinator??null,port:boot.persistPort??null,state:boot.persistState??null},destroyed:snap.destroyed,blockedSwitch,blockedCore,slotsSame:JSON.stringify(before)===JSON.stringify(after)};
  })()`);
  check('A04/2 real Cocos destroy severs refs and yields zero writes on HIDE',
    destroyed.destroyed === true && destroyed.blockedSwitch && destroyed.blockedCore && destroyed.slotsSame === true,
    JSON.stringify(destroyed));

  // ---------- A06: queue poisoning ----------
  await reloadAndReady('reload for A06');
  const a06 = await c.eval(`(async()=>{
    const mod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const proto=mod.SingleWriterSaveCoordinator.prototype;
    const orig=proto.commit;
    let injected=0;
    proto.commit=function(...args){ if(injected++===0){ return Promise.reject(new Error('audit injected queue task error')); } return orig.apply(this,args); };
    try{
      const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};
      fire('hidden'); fire('visible');
      const afterFail=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const hist1=globalThis.__SPIKE_HARNESS__.getCommitHistory();
      proto.commit=orig;
      fire('hidden'); fire('visible');
      const afterOk=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const hist2=globalThis.__SPIKE_HARNESS__.getCommitHistory();
      const idb=${IDB};
      const top=(await idb.slots(${JSON.stringify(NS)})).filter(Boolean).map(t=>JSON.parse(t)).sort((a,b)=>Number(b.revision)-Number(a.revision))[0];
      return {afterFail:{rev:afterFail.revision,halted:afterFail.persistenceHalted,last:afterFail.lastCommitKind},hist1:hist1.map(h=>h.resultKind),afterOk:{rev:afterOk.revision,last:afterOk.lastCommitKind},hist2len:hist2.length,diskRev:top?top.revision:null};
    } finally { proto.commit=orig; }
  })()`);
  check('A06: single queue task error is recorded and does not poison subsequent HIDE',
    a06.hist1.length >= 1 && a06.hist1[a06.hist1.length - 1] === 'FAILED' &&
      a06.afterOk.last === 'COMMITTED' && Number(a06.afterOk.rev) >= 2 &&
      a06.hist2len > a06.hist1.length,
    JSON.stringify(a06));

  // ---------- Compatibility matrix ----------
  // 1) Old localStorage-only save is ignored (no migration), not deleted
  await c.eval(`(${IDB}).clear(${JSON.stringify(NS)})`);
  await c.eval(`localStorage.clear()`);
  await reloadAndReady('empty for migration');
  const seed1 = await c.eval(`(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();})()`);
  const legacy = await c.eval(`(async()=>{
    const idb=${IDB};
    const slots=await idb.slots(${JSON.stringify(NS)});
    const text=slots.find(Boolean);
    const env=JSON.parse(text);
    localStorage.setItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json',text);
    await idb.clear(${JSON.stringify(NS)});
    return {rev:env.revision,gold:JSON.parse(env.payload).gold,len:text.length};
  })()`);
  await reloadAndReady('boot with old localStorage only');
  const legacyBoot = await c.eval(`(async()=>{
    const rec=globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    const ls=localStorage.getItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json');
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));
    const after=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    const idb=${IDB};const slots=await idb.slots(${JSON.stringify(NS)});const top=slots.filter(Boolean).map(t=>JSON.parse(t)).sort((a,b)=>Number(b.revision)-Number(a.revision))[0];
    return {loadStatus:rec.loadStatus,restored:rec.restoredOnBoot,bootGold:rec.gold,lsStillPresent:ls!==null,afterRev:after.revision,idbRev:top?top.revision:null,idbGold:top?JSON.parse(top.payload).gold:null,lsGoldAfter:JSON.parse(localStorage.getItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json')).payload?JSON.parse(JSON.parse(localStorage.getItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json')).payload).gold:null};
  })()`);
  out.legacy = { seeded: { rev: legacy.rev, gold: legacy.gold }, boot: legacyBoot };
  check('§7 old localStorage save is NOT migrated (boot EMPTY/new save) and NOT deleted',
    legacyBoot.loadStatus === 'EMPTY' && legacyBoot.restored === false &&
      legacyBoot.lsStillPresent === true && legacyBoot.idbRev === '1',
    JSON.stringify({ legacy, legacyBoot }));
  // 2) Both present -> IndexedDB wins
  const both = await c.eval(`(async()=>{
    const fire=()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));};
    fire(); const r2=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    return {rev:r2.revision,gold:r2.gold};
  })()`);
  await reloadAndReady('both-present boot');
  const bothBoot = await c.eval(`(()=>{const rec=globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;return {loadStatus:rec.loadStatus,rev:rec.revision,gold:rec.gold,lsPresent:localStorage.getItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json')!==null};})()`);
  out.both = { idb: both, boot: bothBoot };
  check('§7 when both stores exist IndexedDB wins; localStorage untouched',
    bothBoot.loadStatus === 'VALID' && bothBoot.rev === both.rev && bothBoot.gold === both.gold && bothBoot.lsPresent === true,
    JSON.stringify(out.both));

  // 3) IndexedDB open failure -> STORAGE_UNAVAILABLE (never EMPTY)
  const idFailId = await addInitScript(`(()=>{const p=IDBFactory.prototype.open;IDBFactory.prototype.open=function(){throw new DOMException('audit idb blocked','UnknownError');};window.__AUDIT_IDB_OPEN_PATCHED__=true;})();`);
  await reloadAndReady('IDB open failure boot');
  const idbFailBoot = await c.eval(`(async()=>{
    const rec=globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    const h=globalThis.__SPIKE_HARNESS__;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));
    const after=await h.awaitPendingHideSave();
    return {patched:Boolean(window.__AUDIT_IDB_OPEN_PATCHED__),loadStatus:rec.loadStatus,halted:rec.persistenceHalted,restored:rec.restoredOnBoot,hide:after.hideCommitCount,last:after.lastCommitKind};
  })()`);
  await removeScript(idFailId);
  check('§7 IndexedDB initialization failure is STORAGE_UNAVAILABLE (not EMPTY), zero HIDE commits',
    idbFailBoot.patched === true && idbFailBoot.loadStatus === 'STORAGE_UNAVAILABLE' && idbFailBoot.halted === true && idbFailBoot.restored === false && idbFailBoot.hide === 0 && idbFailBoot.last !== 'COMMITTED',
    JSON.stringify(idbFailBoot));
  out.idbFail = idbFailBoot;

  // 4) indexedDB absent -> silent localStorage fallback (and resurrection of old localStorage save)
  await c.eval(`localStorage.clear()`);
  const idAbsentId = await addInitScript(`(()=>{try{Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});}catch(e){} window.__AUDIT_IDB_ABSENT__=true;})();`);
  await reloadAndReady('IDB absent boot');
  const absentBoot = await c.eval(`(async()=>{
    const portMod=await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const p=new portMod.BrowserFilePort('audit_probe');
    const rec=globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));
    const after=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    const lsKeys=Object.keys(localStorage).filter(k=>k.startsWith(${JSON.stringify(LPREFIX)}+'save_slot_')).length;
    await p.clearAll();
    return {absent:Boolean(window.__AUDIT_IDB_ABSENT__),portKind:p.kind,loadStatus:rec.loadStatus,rev:after.revision,last:after.lastCommitKind,lsSlotKeys:lsKeys};
  })()`);
  out.idbAbsent = absentBoot;
  check('§7 with IndexedDB absent: silent localStorage fallback performs writes (observed)',
    absentBoot.absent === true && absentBoot.portKind === 'BROWSER_LOCAL_STORAGE_FALLBACK' && absentBoot.last === 'COMMITTED' && absentBoot.lsSlotKeys > 0,
    JSON.stringify(absentBoot));

  // 5) Resurrection: old localStorage save becomes active when IDB is unavailable
  await removeScript(idAbsentId);
  await reloadAndReady('normal boot for resurrection seed');
  await c.eval(`(async()=>{const idb=${IDB};await idb.clear(${JSON.stringify(NS)});localStorage.clear();})()`);
  await c.eval(`location.reload()`);
  await new Promise((r) => setTimeout(r, 800));
  await waitUntil(() => c.eval(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 30000, 'clean state before resurrection seed');
  await new Promise((r) => setTimeout(r, 300));
  await c.eval(`(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();})()`);
  const legacyText = await c.eval(`(async()=>{const idb=${IDB};const s=await idb.slots(${JSON.stringify(NS)});const t=s.find(Boolean);localStorage.setItem(${JSON.stringify(LPREFIX)}+'save_slot_0.json',t);await idb.clear(${JSON.stringify(NS)});return t;})()`);
  const idAbsentId2 = await addInitScript(`(()=>{try{Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});}catch(e){} window.__AUDIT_IDB_ABSENT__=true;})();`);
  await reloadAndReady('IDB absent with legacy localStorage');
  const resurrect = await c.eval(`(()=>{const rec=globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;return {loadStatus:rec.loadStatus,restored:rec.restoredOnBoot,rev:rec.revision,gold:rec.gold};})()`);
  await removeScript(idAbsentId2);
  out.resurrect = resurrect;
  check('§7 fallback mode resurrects old localStorage save ignored by IndexedDB mode',
    resurrect.loadStatus === 'VALID' && resurrect.restored === true && resurrect.rev === '1' && resurrect.rev !== null,
    JSON.stringify(resurrect));

  const uncaught = c.events.filter((e) => e.method === 'Runtime.exceptionThrown').length;
  out.uncaught = uncaught;
  check('no uncaught page exceptions during A04/A06/migration run', uncaught === 0, String(uncaught));
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/a04-a06-migration.json', JSON.stringify(out, null, 2));
} catch (e) {
  out.failures.push('harness: ' + (e instanceof Error ? e.stack : String(e)));
  console.log('[FAIL] harness :: ' + (e instanceof Error ? e.message : String(e)));
} finally {
  for (const id of scriptIds) { try { await c?.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: id }); } catch {} }
  c?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}
console.log(`\n===== A04/A06/MIGRATION: ${out.failures.length === 0 ? 'PASS' : 'FAIL'} =====`);
if (out.failures.length) { out.failures.forEach((f) => console.log('FAILED: ' + f)); process.exit(1); }
process.exit(0);