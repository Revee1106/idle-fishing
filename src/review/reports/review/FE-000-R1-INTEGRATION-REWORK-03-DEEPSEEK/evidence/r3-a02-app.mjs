/** A02 app-level cross-tab bypass: Tab A normal HIDE -> UNCERTAIN/halt; Tab B normal HIDE commits without recovery. */
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const SNAP='C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap'; const WEB=path.join(SNAP,'apps/game-client/build/web-mobile'); const NS='idle_fishing_lifecycle_persist_fs';
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.css':'text/css','.wasm':'application/wasm','.bin':'application/octet-stream','.cconb':'application/octet-stream'};
const srv=await new Promise((res,rej)=>{const s=http.createServer((q,r)=>{const u=(q.url||'/').split('?')[0];const f=path.resolve(WEB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(WEB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'fe000-r3-a02app-')); const dbg=9350+Math.floor(Math.random()*60); const base=`http://127.0.0.1:${srv.port}/`;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${dbg}`,`--user-data-dir=${udd}`,'about:blank'],{stdio:'ignore',windowsHide:true});
class Cdp{constructor(u){this.ws=new WebSocket(u);this.id=1;this.p=new Map();this.events=[];this.ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&this.p.has(m.id)){const{r,j}=this.p.get(m.id);this.p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}else if(m.method)this.events.push(m);});}async open(){if(this.ws.readyState===WebSocket.OPEN)return;await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}send(m,p={}){const id=this.id++;return new Promise((r,j)=>{this.p.set(id,{r,j});this.ws.send(JSON.stringify({id,method:m,params:p}));});}async eval(e,a=true){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?.value;}close(){try{this.ws.close();}catch{}}}
async function waitUntil(fn,ms,l){const d=Date.now()+ms;while(Date.now()<d){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,120));}throw new Error('TIMEOUT '+l);}
async function waitHttp(p){return waitUntil(async()=>{const r=await fetch(`http://127.0.0.1:${p}/json/list`);const l=await r.json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||null;},15000,'http');}
async function conn(tid){const info=await waitUntil(async()=>{const r=await fetch(`http://127.0.0.1:${dbg}/json/list`);const l=await r.json();return l.find(t=>t.id===tid&&t.webSocketDebuggerUrl)||null;},15000,'target');const c=new Cdp(info.webSocketDebuggerUrl);await c.open();await c.send('Page.enable');await c.send('Runtime.enable');return c;}
const failures=[]; function check(n,c,d){if(!c)failures.push(n+': '+d);console.log(`[${c?'PASS':'FAIL'}] ${n} :: ${d}`);}
const fire=`const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};`;
const top=`(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('idle_fishing_fs_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{return await new Promise((res,rej)=>{const tx=db.transaction('files','readonly');const st=tx.objectStore('files');const o=[null,null,null];for(let i=0;i<3;i++){const q=st.get(${JSON.stringify(NS)}+':save_slot_'+i+'.json');q.onsuccess=()=>{o[i]=q.result??null;};}tx.oncomplete=()=>{const e=o.filter(Boolean).map(t=>JSON.parse(t)).sort((a,b)=>Number(b.revision)-Number(a.revision));res(e[0]?{rev:e[0].revision,gold:JSON.parse(e[0].payload).gold}:{rev:null,gold:null});};tx.onerror=()=>rej(tx.error);});}finally{db.close();}})()`;
let A=null,B=null;
try{
  const t=await waitHttp(dbg); A=await conn(t.id); await A.send('Page.navigate',{url:base});
  await waitUntil(()=>A.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'A boot'); await new Promise(r=>setTimeout(r,400));
  // clean via page IDB helper
  await A.eval(`(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('idle_fishing_fs_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{await new Promise((res,rej)=>{const tx=db.transaction('files','readwrite');const st=tx.objectStore('files');const q=st.getAllKeys();q.onsuccess=()=>{for(const k of q.result){if(String(k).startsWith(${JSON.stringify(NS)}+':'))st.delete(k);}};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}})()`);
  await A.send('Page.reload',{ignoreCache:true}); await waitUntil(()=>A.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'A clean'); await new Promise(r=>setTimeout(r,300));
  // seed rev1 in A
  const seed=await A.eval(`(async()=>{${fire}fire('hidden');fire('visible');return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();})()`);
  check('seed rev1', seed.revision==='1', JSON.stringify({rev:seed.revision,gold:seed.gold}));
  // open B now so it loads rev1
  const {targetId:bId}=await A.send('Target.createTarget',{url:base}); B=await conn(bId);
  await waitUntil(()=>B.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'B boot'); await new Promise(r=>setTimeout(r,400));
  const bBoot=await B.eval(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
  check('Tab B boot loads rev1', bBoot.loadStatus==='VALID'&&bBoot.revision==='1', JSON.stringify({status:bBoot.loadStatus,rev:bBoot.revision}));
  // A: arm IDB faults (slot write fails before landing; subsequent slot reads fail) and HIDE -> UNCERTAIN
  const aUnc=await A.eval(`(async()=>{
    const oPut=IDBObjectStore.prototype.put, oGet=IDBObjectStore.prototype.get; let afterWrite=false;
    IDBObjectStore.prototype.put=function(v,k){if(String(k||'').includes(':save_slot_')){afterWrite=true;throw new DOMException('audit write before landing','QuotaExceededError');}return oPut.call(this,v,k);};
    IDBObjectStore.prototype.get=function(k){if(afterWrite&&String(k||'').includes(':save_slot_'))throw new DOMException('audit read failure','UnknownError');return oGet.call(this,k);};
    ${fire}
    try{ fire('hidden');fire('visible'); const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); return {rev:rec.revision,last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth}; }
    finally{ IDBObjectStore.prototype.put=oPut; IDBObjectStore.prototype.get=oGet; }
  })()`);
  const diskAfterA=await A.eval(`(${top})`);
  check('Tab A normal HIDE -> UNCERTAIN and halt, disk unchanged rev1', aUnc.last==='UNCERTAIN'&&aUnc.halted===true&&aUnc.health==='STORAGE_UNAVAILABLE'&&diskAfterA.rev==='1', JSON.stringify({aUnc,diskAfterA}));
  // B: normal HIDE -> commits rev2 without any recovery
  const bHide=await B.eval(`(async()=>{${fire}fire('hidden');fire('visible');const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();const top=await ${top};return {rev:rec.revision,last:rec.lastCommitKind,halted:rec.persistenceHalted,disk:top};})()`);
  check('A02 APP CROSS-TAB: Tab B MUST NOT write before recovery', bHide.last!=='COMMITTED'&&bHide.disk.rev==='1', JSON.stringify(bHide));
  const aStill=await A.eval(`(async()=>{${fire}fire('hidden');fire('visible');const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();return {rev:rec.revision,last:rec.lastCommitKind,halted:rec.persistenceHalted};})()`);
  console.log('[evidence] Tab A after B write:', JSON.stringify({aUnc,diskAfterA,bHide,aStill}));
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/a02-app-cross-tab.json',JSON.stringify({seed:{rev:seed.revision},bBoot:{status:bBoot.loadStatus,rev:bBoot.revision},aUnc,diskAfterA,bHide,aStill,failures},null,2));
}catch(e){failures.push('harness: '+(e instanceof Error?e.stack:String(e)));console.log('[FAIL] harness :: '+(e instanceof Error?e.message:String(e)));}
finally{A?.close();B?.close();try{chrome.kill();}catch{}srv.s.close();try{fs.rmSync(udd,{recursive:true,force:true});}catch{}}
console.log(`\n===== A02 APP: ${failures.length===0?'PASS':'FAIL'} =====`);
if(failures.length){failures.forEach(f=>console.log('FAILED: '+f));process.exit(1);}process.exit(0);