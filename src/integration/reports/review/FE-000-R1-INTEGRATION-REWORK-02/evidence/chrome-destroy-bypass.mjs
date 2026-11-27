import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const WEB=path.join('C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap','apps/game-client/build/web-mobile');
const MIME={'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.css':'text/css','.wasm':'application/wasm','.bin':'application/octet-stream','.cconb':'application/octet-stream'};
const srv=await new Promise((res,rej)=>{const s=http.createServer((q,r)=>{const u=(q.url||'/').split('?')[0];const f=path.resolve(WEB,u==='/'?'index.html':u.replace(/^\/+/,''));if(!f.startsWith(WEB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});
const udd=fs.mkdtempSync(path.join(os.tmpdir(),'fe000-dstr-')); const dbg=9990+Math.floor(Math.random()*50);
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${dbg}`,`--user-data-dir=${udd}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const base=`http://127.0.0.1:${srv.port}/`;
const wait=async(f,ms,l)=>{const d=Date.now()+ms;while(Date.now()<d){const v=await f().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,150));}throw new Error('TIMEOUT '+l);};
let ws;
try{
  await wait(async()=>{const r=await fetch(`http://127.0.0.1:${dbg}/json/list`);const l=await r.json();return l.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);},15000,'chrome');
  const info=await (async()=>{const r=await fetch(`http://127.0.0.1:${dbg}/json/list`);return (await r.json()).find(t=>t.type==='page'&&t.webSocketDebuggerUrl);})();
  ws=new WebSocket(info.webSocketDebuggerUrl); await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let id=1; const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)); if(m.id&&pend.has(m.id)){const {r,j}=pend.get(m.id);pend.delete(m.id);m.error?j(new Error(JSON.stringify(m.error))):r(m.result);}});
  const send=(method,params={})=>new Promise((r,j)=>{const i=id++;pend.set(i,{r,j});ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,300));return r.result?.value;};
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate',{url:base});
  await wait(()=>ev('Boolean(globalThis.__SPIKE_HARNESS__&&globalThis.__SPIKE_HARNESS__.ready)'),30000,'boot');
  await new Promise(r=>setTimeout(r,300));
  await ev('globalThis.__SPIKE_HARNESS__.clearLifecyclePersistence()');
  const out=await ev(`(async()=>{
    const h=globalThis.__SPIKE_HARNESS__;
    const seed=await h.commitCandidateViaCoordinator(60000,null);
    h.triggerDestroyForTest();
    const rejectedHide=h.requestHideSaveForTest('after-destroy');
    const postDestroyCommit=await h.commitCandidateViaCoordinator(60000,'1');
    const snap=h.getSnapshot();
    return { seedKind:seed.res.kind, seedRev:seed.res.revision, destroyed:snap.destroyed, rejectedHide, postKind:postDestroyCommit.res.kind, postRev:postDestroyCommit.res.revision||null };
  })()`);
  console.log(JSON.stringify(out));
  process.exit(0);
}finally{try{ws.close();}catch{};try{chrome.kill();}catch{};srv.s.close();try{fs.rmSync(udd,{recursive:true,force:true});}catch{}}
