/** Runtime probe/write failure through BootEntry (real IndexedDB), verifying app-level halt & zero writes. */
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const SNAP='C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap'; const WEB=path.join(SNAP,'apps/game-client/build/web-mobile'); const NS='idle_fishing_lifecycle_persist_fs';
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.css':'text/css','.wasm':'application/wasm','.bin':'application/octet-stream','.cconb':'application/octet-stream'};
const srv=await new Promise((res,rej)=>{const s=http.createServer((q,r)=>{const u=(q.url||'/').split('?')[0];const f=path.resolve(WEB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(WEB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'fe000-r3-runtime-')); const dbg=9450+Math.floor(Math.random()*60); const base=`http://127.0.0.1:${srv.port}/`;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${dbg}`,`--user-data-dir=${udd}`,'about:blank'],{stdio:'ignore',windowsHide:true});
class Cdp{constructor(u){this.ws=new WebSocket(u);this.id=1;this.p=new Map();this.ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&this.p.has(m.id)){const{r,j}=this.p.get(m.id);this.p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}});}async open(){if(this.ws.readyState===WebSocket.OPEN)return;await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}send(m,p={}){const id=this.id++;return new Promise((r,j)=>{this.p.set(id,{r,j});this.ws.send(JSON.stringify({id,method:m,params:p}));});}async eval(e,a=true){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?.value;}close(){try{this.ws.close();}catch{}}}
async function waitUntil(fn,ms,l){const d=Date.now()+ms;while(Date.now()<d){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,120));}throw new Error('TIMEOUT '+l);}
async function waitHttp(p){return waitUntil(async()=>{const r=await fetch(`http://127.0.0.1:${p}/json/list`);const l=await r.json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||null;},15000,'http');}
const failures=[]; function check(n,c,d){if(!c)failures.push(n+': '+d);console.log(`[${c?'PASS':'FAIL'}] ${n} :: ${d}`);}
const SLOTS=`(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('idle_fishing_fs_v1',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files');};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});try{return await new Promise((res,rej)=>{const tx=db.transaction('files','readonly');const st=tx.objectStore('files');const o=[null,null,null];for(let i=0;i<3;i++){const q=st.get(${JSON.stringify(NS)}+':save_slot_'+i+'.json');q.onsuccess=()=>{o[i]=q.result??null;};}tx.oncomplete=()=>res(o);tx.onerror=()=>rej(tx.error);});}finally{db.close();}})()`;
let c=null;
try{
  const t=await waitHttp(dbg); c=new Cdp(t.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Page.navigate',{url:base});
  await waitUntil(()=>c.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'boot'); await new Promise(r=>setTimeout(r,400));
  // Probe failure on runtime HIDE
  const probeFail=await c.eval(`(async()=>{
    const orig=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(v,k){if(String(k||'').endsWith('__probe__'))throw new DOMException('audit probe failure','QuotaExceededError');return orig.call(this,v,k);};
    const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};
    const before=await ${SLOTS};
    try{
      fire('hidden');fire('visible');
      const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      fire('hidden');fire('visible');
      const rec2=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const hist=globalThis.__SPIKE_HARNESS__.getCommitHistory();
      const after=await ${SLOTS};
      return {rec:{last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth},rec2:{halted:rec2.persistenceHalted},hist:hist.map(h=>h.taskState+'/'+h.resultKind),slotsSame:JSON.stringify(before)===JSON.stringify(after)};
    } finally { IDBObjectStore.prototype.put=orig; }
  })()`);
  check('Runtime probe failure through BootEntry: STORAGE_UNAVAILABLE, halt, later HIDE skipped, zero writes',
    probeFail.rec.last==='STORAGE_UNAVAILABLE'&&probeFail.rec.halted===true&&probeFail.rec2.halted===true&&
    probeFail.hist[probeFail.hist.length-1]?.includes('SKIPPED_HALTED')&&probeFail.slotsSame===true, JSON.stringify(probeFail));

  // Write failure on runtime HIDE (fresh reload)
  await c.send('Page.reload',{ignoreCache:true}); await waitUntil(()=>c.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'reload'); await new Promise(r=>setTimeout(r,400));
  const writeFail=await c.eval(`(async()=>{
    const orig=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(v,k){if(String(k||'').includes(':save_slot_'))throw new DOMException('audit write failure','QuotaExceededError');return orig.call(this,v,k);};
    const fire=(st)=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'));};
    const before=await ${SLOTS};
    try{
      fire('hidden');fire('visible');
      const rec=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      fire('hidden');fire('visible');
      const rec2=await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const hist=globalThis.__SPIKE_HARNESS__.getCommitHistory();
      const after=await ${SLOTS};
      return {rec:{last:rec.lastCommitKind,halted:rec.persistenceHalted,health:rec.storageHealth},rec2:{halted:rec2.persistenceHalted},hist:hist.map(h=>h.taskState+'/'+h.resultKind),slotsSame:JSON.stringify(before)===JSON.stringify(after)};
    } finally { IDBObjectStore.prototype.put=orig; }
  })()`);
  check('Runtime slot write failure through BootEntry: STORAGE_UNAVAILABLE + halt, zero writes',
    writeFail.rec.last==='STORAGE_UNAVAILABLE'&&writeFail.rec.halted===true&&writeFail.rec2.halted===true&&writeFail.slotsSame===true, JSON.stringify(writeFail));
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/runtime-failure.json',JSON.stringify({probeFail,writeFail,failures},null,2));
}catch(e){failures.push('harness: '+(e instanceof Error?e.message:String(e)));console.log('[FAIL] harness :: '+(e instanceof Error?e.message:String(e)));}
finally{c?.close();try{chrome.kill();}catch{}srv.s.close();try{fs.rmSync(udd,{recursive:true,force:true});}catch{}}
console.log(`\n===== RUNTIME FAILURE: ${failures.length===0?'PASS':'FAIL'} =====`);
if(failures.length){failures.forEach(f=>console.log('FAILED: '+f));process.exit(1);}process.exit(0);