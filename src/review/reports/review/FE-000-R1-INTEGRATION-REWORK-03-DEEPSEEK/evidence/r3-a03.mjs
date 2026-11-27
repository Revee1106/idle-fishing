/** Independent A03 partial-slot IO recovery audit (real IndexedDB + fault wrapper in Chrome). */
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const SNAP='C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap'; const WEB=path.join(SNAP,'apps/game-client/build/web-mobile');
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.css':'text/css','.wasm':'application/wasm','.bin':'application/octet-stream','.cconb':'application/octet-stream'};
const srv=await new Promise((res,rej)=>{const s=http.createServer((q,r)=>{const u=(q.url||'/').split('?')[0];const f=path.resolve(WEB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(WEB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end('nf');return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'fe000-r3-a03-')); const dbg=9550+Math.floor(Math.random()*40); const base=`http://127.0.0.1:${srv.port}/`;
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${dbg}`,`--user-data-dir=${udd}`,'about:blank'],{stdio:'ignore',windowsHide:true});
class Cdp{constructor(u){this.ws=new WebSocket(u);this.id=1;this.p=new Map();this.ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&this.p.has(m.id)){const{r,j}=this.p.get(m.id);this.p.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}});}async open(){if(this.ws.readyState===WebSocket.OPEN)return;await new Promise((r,j)=>{this.ws.addEventListener('open',r,{once:true});this.ws.addEventListener('error',j,{once:true});});}send(m,p={}){const id=this.id++;return new Promise((r,j)=>{this.p.set(id,{r,j});this.ws.send(JSON.stringify({id,method:m,params:p}));});}async eval(e,a=true){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:a,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?.value;}close(){try{this.ws.close();}catch{}}}
async function waitUntil(fn,ms,l){const d=Date.now()+ms;while(Date.now()<d){const v=await fn().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,120));}throw new Error('TIMEOUT '+l);}
async function waitHttp(p){return waitUntil(async()=>{const r=await fetch(`http://127.0.0.1:${p}/json/list`);const l=await r.json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl)||null;},15000,'http');}
const failures=[]; function check(n,c,d){if(!c)failures.push(n+': '+d);console.log(`[${c?'PASS':'FAIL'}] ${n} :: ${d}`);}
let c=null;
try{
  const t=await waitHttp(dbg); c=new Cdp(t.webSocketDebuggerUrl); await c.open(); await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Page.navigate',{url:base});
  await waitUntil(()=>c.eval(`Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)`),30000,'boot'); await new Promise(r=>setTimeout(r,400));
  const out=await c.eval(`(async()=>{
    const coordMod=await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod=await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const faultMod=await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
    const coreMod=await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns='audit_a03_'+Date.now();
    const basePort=new portMod.BrowserFilePort(ns);
    const fault=new faultMod.FaultInjectingFilePort(basePort);
    let writes=0; const ow=fault.write.bind(fault); fault.write=async(...a)=>{writes++;return ow(...a);};
    const c1=new coordMod.SingleWriterSaveCoordinator(fault);
    const c2=new coordMod.SingleWriterSaveCoordinator(fault);
    const st0=coreMod.createInitialState({saveEpoch:'audit.a03',startMs:1700000000000,allowanceMs:3600000});
    const s1=coreMod.advanceOffline(st0,st0.cursorMs+60000).state;
    const s2=coreMod.advanceOffline(s1,s1.cursorMs+60000).state;
    const s3=coreMod.advanceOffline(s2,s2.cursorMs+60000).state;
    const s4=coreMod.advanceOffline(s3,s3.cursorMs+60000).state;
    // missing -> EMPTY/AVAILABLE
    const empty=await c1.loadSafe();
    const emptyHealth=c1.storageHealth;
    await c1.commit(s1,null); await c1.commit(s2,'1'); await c1.commit(s3,'2');
    // partial IO on newest slot 2
    fault.setReadFault(coreMod.SLOT_PATHS[2],true);
    const partial=await c1.loadSafe();
    const h1=c1.storageHealth, h2=c2.storageHealth, fc=c2.freezeCode;
    const wBefore=writes; const blocked=await c2.commit(s4,'2'); const zeroWrites=(writes===wBefore);
    fault.setReadFault(coreMod.SLOT_PATHS[2],false);
    const full=await c1.loadSafe();
    const h3=c1.storageHealth;
    const c4=await c2.commit(s4,'3');
    // all slots IO -> IO_UNAVAILABLE
    fault.setReadFault(coreMod.SLOT_PATHS[0],true); fault.setReadFault(coreMod.SLOT_PATHS[1],true); fault.setReadFault(coreMod.SLOT_PATHS[2],true);
    const all=await c1.loadSafe();
    const allClass=all.kind==='STORAGE_UNAVAILABLE'?all.recoveryClassification:null;
    fault.setReadFault(coreMod.SLOT_PATHS[0],false); fault.setReadFault(coreMod.SLOT_PATHS[1],false); fault.setReadFault(coreMod.SLOT_PATHS[2],false);
    await c1.loadSafe();
    await basePort.clearAll();
    return {empty:empty.kind,emptyHealth,partialKind:partial.kind,partialClass:partial.recoveryClassification||null,backup:partial.readOnlyBackup?.revision||null,h1,h2,fc,blocked:blocked.kind,zeroWrites,fullKind:full.kind,fullRev:full.kind==='VALID'?full.revision:null,h3,c4:c4.kind+'/'+(c4.revision||''),allClass};
  })()`);
  check('A03 missing -> EMPTY/AVAILABLE', out.empty==='EMPTY'&&out.emptyHealth==='AVAILABLE', JSON.stringify({empty:out.empty,emptyHealth:out.emptyHealth}));
  check('A03 partial IO -> STORAGE_UNAVAILABLE/PARTIAL, readOnlyBackup rev2, health frozen across coordinators, 0 writes',
    out.partialKind==='STORAGE_UNAVAILABLE'&&out.partialClass==='PARTIAL_IO_UNAVAILABLE'&&out.backup==='2'&&out.h1==='STORAGE_UNAVAILABLE'&&out.h2==='STORAGE_UNAVAILABLE'&&out.fc==='PARTIAL_IO_UNAVAILABLE'&&out.blocked==='STORAGE_UNAVAILABLE'&&out.zeroWrites===true, JSON.stringify(out));
  check('A03 all slots IO -> IO_UNAVAILABLE', out.allClass==='IO_UNAVAILABLE', String(out.allClass));
  check('A03 full recovery -> VALID rev3, AVAILABLE, commit rev4', out.fullKind==='VALID'&&out.fullRev==='3'&&out.h3==='AVAILABLE'&&out.c4==='COMMITTED/4', JSON.stringify({fullKind:out.fullKind,fullRev:out.fullRev,h3:out.h3,c4:out.c4}));
  fs.writeFileSync('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-audit/a03.json',JSON.stringify({out,failures},null,2));
}catch(e){failures.push('harness: '+(e instanceof Error?e.message:String(e)));console.log('[FAIL] harness :: '+(e instanceof Error?e.message:String(e)));}
finally{c?.close();try{chrome.kill();}catch{}srv.s.close();try{fs.rmSync(udd,{recursive:true,force:true});}catch{}}
console.log(`\n===== A03: ${failures.length===0?'PASS':'FAIL'} =====`);
if(failures.length){failures.forEach(f=>console.log('FAILED: '+f));process.exit(1);}process.exit(0);