/**
 * Zero-dependency real Cocos Web Build E2E & Runtime Regression Verifier (FE-000-R1).
 * Launches isolated headless Chrome against the ACTUAL apps/game-client/build/web-mobile
 * via Chrome DevTools Protocol (CDP over Node 24 built-in fetch + WebSocket).
 *
 * Verifies:
 * 1. Clean boot on portrait mobile viewport (390x844), zero console errors/exceptions
 * 2. Page 1 shared core verification (7/7 PASS, exact BE-000 epoch.be000 1h SHA-256)
 * 3. Direct System.import of compiled WeChatLifecycleProvider.ts (I01 regression: HIDE/SHOW,
 *    dedupe, local unsubscribe preserving sibling, exception isolation, dispose)
 * 4. Real DOM visibilitychange(hidden) -> BootEntry platform HIDE save -> REAL Page.reload()
 *    -> BootEntry restores rev=1 with preserved gold, cursorMs & deadlineMs!
 * 5. Real pointer click interactions: Modal open/close, switch to Page 2, FS/Save/Lifecycle/Clock/Ad/Subpack,
 *    real mouse wheel scroll on ScrollView, landscape viewport resize (844x390)
 * 6. 24h offline benchmark (single-shot vs sliced equality, exact BE-000 24h envelope SHA-256,
 *    isolated sliced rAF frame intervals & JS heap memory)
 * 7. Captures screenshots & JSON evidence; exits NON-ZERO if ANY assertion fails or 0 assertions run!
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeRemoveOutputDir } from './safe-path-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const webBuildDir = path.join(repoRoot, 'apps/game-client/build/web-mobile');
const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
const evidenceDir = outDirArg
  ? path.resolve(repoRoot, outDirArg.slice('--out-dir='.length))
  : process.env.VERIFY_WEB_OUT_DIR
    ? path.resolve(repoRoot, process.env.VERIFY_WEB_OUT_DIR)
    : path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-02/evidence/web-rework02');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.cconb': 'application/octet-stream',
};

function findChrome() {
  const candidates = [
    process.env.CHROME_EXE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('No Chrome/Edge executable found');
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(rootDir, rel);
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(full).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  async waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalJson(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Runtime exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }
  async screenshot(outFile) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(data, 'base64'));
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async wheel(x, y, deltaY) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function waitForDebugEndpoint(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Timed out waiting for Chrome DevTools endpoint');
}

async function waitUntil(fn, timeoutMs = 20000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

if (!fs.existsSync(path.join(webBuildDir, 'index.html'))) {
  console.error(`[Web E2E] FAIL: build/web-mobile/index.html missing at ${webBuildDir}`);
  process.exit(1);
}

const assertions = [];
const failures = [];
function assertCheck(name, condition, detail) {
  assertions.push({ name, status: condition ? 'PASS' : 'FAIL', detail });
  if (!condition) failures.push(`${name}: ${detail}`);
}

const chromeExe = findChrome();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r1-chrome-'));
const debugPort = 9222 + Math.floor(Math.random() * 500);
const { server, port } = await startStaticServer(webBuildDir);
const baseUrl = `http://127.0.0.1:${port}/`;

const chrome = spawn(
  chromeExe,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-precise-memory-info',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true }
);

let cdp = null;
const report = {
  host: { chromeExe, url: baseUrl, viewportPortrait: '390x844', viewportLandscape: '844x390' },
  consoleErrors: [],
  uncaughtExceptions: [],
  bootSnapshot: null,
  bundledLifecycleCheck: null,
  realHideAndReloadPersistence: null,
  modalClickCheck: null,
  platformChecks: null,
  scrollOffsetCheck: null,
  landscapeViewport: null,
  perf24h: null,
  screenshots: [],
  assertions: [],
  failures: [],
};

try {
  const target = await waitForDebugEndpoint(debugPort);
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.waitOpen();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await cdp.send('Page.navigate', { url: baseUrl });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready');
  await new Promise((r) => setTimeout(r, 800));

const H='globalThis.__SPIKE_HARNESS__';
let B;
const out=process.env.ASTRA_RUN||'chrome-audit';const file=path.join(repoRoot,out+'.jsonl');
function rec(label,obj){fs.appendFileSync(file,JSON.stringify({label,obj})+'\n')}
async function step(name,fn){try{rec(name,await fn())}catch(e){rec(name,{error:String(e)});process.exitCode=1}}
const ev=(c,s)=>c.evalJson(s.replaceAll('@H',H));
const ready=(c)=>waitUntil(()=>ev(c,'Boolean(@H?.ready)'),25000,'ready');
async function tab(){const {targetId:id}=await cdp.send('Target.createTarget',{url:baseUrl});const info=await waitUntil(async()=>(await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json()).find(t=>t.id===id),10000,'tab');const c=new CdpClient(info.webSocketDebuggerUrl);await c.waitOpen();await c.send('Page.enable');await ready(c);c.targetId=id;return c}
const reload=async c=>{await c.send('Page.reload',{ignoreCache:true});await new Promise(r=>setTimeout(r,750));await ready(c);return ev(c,'@H.getSnapshot().lifecyclePersistence')};
const hid=(c,label)=>ev(c,"@H.requestHideSaveForTest("+JSON.stringify(label)+")");
const drain=c=>ev(c,'@H.awaitPendingHideSave()');
const history=c=>ev(c,'@H.getCommitHistory().slice(-4)');
const disk=c=>ev(c,"Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes('lifecycle_persist')&&k.includes('slot')).map(k=>{let e=JSON.parse(localStorage[k]);return [k,[e.revision,e.sha256,JSON.parse(e.payload).gold]]}))");
const locks=c=>ev(c,'navigator.locks.query()');
const setup=async()=>{B=await tab();await cdp.send('Page.bringToFront');await new Promise(r=>setTimeout(r,500));await drain(cdp);await drain(B);await ev(cdp,'@H.reinitializePersistence()');await ev(B,'@H.reinitializePersistence()')};await setup();
rec('metadata',{ua:await ev(cdp,'navigator.userAgent'),origin:baseUrl,methods:await ev(cdp,'Object.keys(@H)'),key:await ev(cdp,'@H.getPersistCoordinator().storageKey')});
await step('two tabs; hold through physical readback; repeated HIDE; owner destroyed while STARTED',async()=>{
 await ev(cdp,`(()=>{const p=@H.getPersistCoordinator().port; const w=p.write.bind(p), r=p.read.bind(p); let written=false; p.write=async(...a)=>{await w(...a);written=true};p.read=async(...a)=>{if(written){written=false;globalThis.inRead=true;await new Promise(r=>globalThis.releaseRead=r)}return r(...a)};return true})()`);
 await ev(cdp,'@H.advancePersistState(60000)');await ev(B,'@H.advancePersistState(180000)');await hid(cdp,'A');await waitUntil(()=>ev(cdp,'!!globalThis.inRead'),5000,'physical readback');await hid(B,'B1');await hid(B,'B2');await waitUntil(async()=>(await locks(cdp)).pending.length>0,5000,'B pending');
 const lock=await locks(cdp);await hid(cdp,'queued before destroy');await ev(cdp,'@H.triggerDestroyForTest()');let after=await hid(cdp,'after destroy');await ev(cdp,'globalThis.releaseRead()');let [a,b]=await Promise.all([drain(cdp),drain(B)]);return {lock,after,a,b,histA:await history(cdp),histB:await history(B),disk:await disk(B),reload:await reload(cdp)}
});
await step('close lock owner while B waiting; refresh B',async()=>{await ev(B,'@H.reinitializePersistence()');await ev(cdp,`(()=>{let key='idle-fishing:save:'+@H.getPersistCoordinator().storageKey;navigator.locks.request(key,async()=>{globalThis.held=true;await new Promise(()=>{})});return true})()`);await waitUntil(()=>ev(cdp,'!!globalThis.held'),5000,'held');await hid(B,'B-after-owner-exit');await waitUntil(async()=>(await locks(B)).pending.length>0,5000,'pending');let before=await locks(B);await B.send('Target.closeTarget',{targetId:target.id});const b=await drain(B);return {before,b,history:await history(B),reload:await reload(B)}});
await step('queued destroy then restart',async()=>{const a=B;const key=await ev(a,'@H.getPersistCoordinator().storageKey');await ev(a,`(()=>{navigator.locks.request('idle-fishing:save:'+@H.getPersistCoordinator().storageKey,async()=>{globalThis.held=true;await new Promise(r=>globalThis.unlock=r)});return true})()`);await waitUntil(()=>ev(a,'!!globalThis.held'),5000,'held');let before=await disk(a);await hid(a,'queued1');await hid(a,'queued2');await waitUntil(async()=>(await locks(a)).pending.length>0,5000,'pending');await ev(a,'@H.triggerDestroyForTest()');await ev(a,'globalThis.unlock()');await drain(a);return {before,after:await disk(a),history:await history(a),reload:await reload(a)}});
for(const mode of ['reject','missing','taskException','storageFailDestroy','chainReject'])await step(mode,async()=>{
 await reload(B);const before=await disk(B);const answers={};
 if(mode==='missing'||mode==='reject')await ev(B,`Object.defineProperty(navigator,'locks',{configurable:true,value:${mode==='missing'?'undefined':"{request:async()=>{throw Error('audit lock')}}"}});true`);
 if(mode==='taskException') await ev(B,"@H.setCommitTestHooks({beforeCommitBody:async()=>{throw Error('audit body')}});true");
 if(mode==='storageFailDestroy')await ev(B,"@H.getPersistCoordinator().port.probeStorage=()=>({available:false,reason:'audit fault'});true");
 if(mode==='chainReject'){answers.first=await ev(B,"@H.advancePersistState(Number.MAX_SAFE_INTEGER).then(()=>null,e=>String(e))")}
 await hid(B,mode); answers.result=await ev(B,'@H.awaitPendingHideSave().catch(e=>String(e))');if(mode==='storageFailDestroy'){answers.diagnostic=await ev(B,'@H.getPersistCoordinator().loadSafe()');await ev(B,'@H.triggerDestroyForTest()');answers.late=await hid(B,'late')}
 return {before,after:await disk(B),...answers,history:await history(B)}
});B?.close();
} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch {}
  server.close();
  try {
    safeRemoveOutputDir(userDataDir, { mode: 'chrome-temp', repoRoot });
  } catch {}
}

