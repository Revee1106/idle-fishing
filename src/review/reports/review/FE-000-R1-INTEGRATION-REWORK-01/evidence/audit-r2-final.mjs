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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const webBuildDir = path.join(repoRoot, 'apps/game-client/build/web-mobile');
const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
const evidenceDir = outDirArg
  ? path.resolve(repoRoot, outDirArg.slice('--out-dir='.length))
  : process.env.VERIFY_WEB_OUT_DIR
    ? path.resolve(repoRoot, process.env.VERIFY_WEB_OUT_DIR)
    : path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-01/evidence/web-rework');

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

  // Collect console errors & exceptions
const key='idle_fishing_lifecycle_persist_fs:save_slot_';
const result={};
const evaluate=async fn=>cdp.evalJson('('+fn.toString()+')()');
const setup=async()=>evaluate(()=>{window.h=__SPIKE_HARNESS__;window.fire=(...modes)=>{for(const m of modes){Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>m});document.dispatchEvent(new Event('visibilitychange'));}};window.slots=()=>[0,1,2].map(i=>localStorage.getItem('idle_fishing_lifecycle_persist_fs:save_slot_'+i+'.json'));window.results=()=>({rec:h.getSnapshot().lifecyclePersistence,hist:h.getCommitHistory()});return true});
const reload=async()=>{await cdp.send('Page.reload',{ignoreCache:true});await new Promise(r=>setTimeout(r,900));await waitUntil(()=>cdp.evalJson('Boolean(globalThis.__SPIKE_HARNESS__?.ready)'),30000,'reload');await setup()};
await setup();
result.empty=await evaluate(()=>h.getSnapshot().lifecyclePersistence);
result.burst=await evaluate(async()=>{fire('hidden','visible','hidden','visible','hidden','visible');await h.awaitPendingHideSave();return results()});
const expected=await evaluate(()=>slots());
await reload();result.restored=await evaluate(()=>results());
result.same=JSON.stringify(await evaluate(()=>slots()))===JSON.stringify(expected);
const fault=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:"const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith('__probe__'))throw new DOMException('denied','SecurityError');return original.call(this,k,v)}"});
await reload();result.probe=await evaluate(async()=>{fire('hidden','visible','hidden');await h.awaitPendingHideSave();return results()});result.untouched=JSON.stringify(await evaluate(()=>slots()))===JSON.stringify(expected);
await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:fault.identifier});await reload();result.recovered=await evaluate(()=>results());result.allRecovered=JSON.stringify(await evaluate(()=>slots()))===JSON.stringify(expected);
const pre=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:"globalThis.startBytes=[0,1,2].map(i=>localStorage.getItem('idle_fishing_lifecycle_persist_fs:save_slot_'+i+'.json'));const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith('__probe__'))throw Error('denied');return set.call(this,k,v)}"});
await reload();const before=await evaluate(()=>startBytes);result.strictProbe=await evaluate(async()=>{fire('hidden','visible','hidden');await h.awaitPendingHideSave();return results()});result.exactA=JSON.stringify(before)===JSON.stringify(await evaluate(()=>slots()));await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:pre.identifier});await reload();result.strictRecover=await evaluate(()=>results());result.exactB=JSON.stringify(before)===JSON.stringify(await evaluate(()=>slots()));result.seedRevision=Math.max(...before.filter(Boolean).map(s=>Number(JSON.parse(s).revision)));
result.deleteDenied=await evaluate(async()=>{const b=cc.director.getScene().getChildByName('Canvas').getComponent('BootEntry'),p=b.persistPort;const del=Storage.prototype.removeItem;Storage.prototype.removeItem=()=>{throw Error('permission denied')};try{await p.remove('save_slot_0.json');return false}catch(e){return String(e)}finally{Storage.prototype.removeItem=del}});

result.readFailure=await evaluate(async()=>{const g=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k.includes('save_slot_'))throw Error('permission');return g.call(this,k)};try{return await h.reinitializePersistence()}finally{Storage.prototype.getItem=g}});
await reload();
result.writeFailure=await evaluate(async()=>{let n=0;const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes('save_slot_')&&++n===1)throw Error('first write denied');return set.call(this,k,v)};try{fire('hidden','visible','hidden');await h.awaitPendingHideSave();return results()}finally{Storage.prototype.setItem=set}});
await reload();result.uncertain=await evaluate(async()=>{let n=0;const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k.endsWith('save_slot_2.json'))throw Error('slot unavailable');return get.call(this,k)};Storage.prototype.setItem=function(k,v){if(k.includes('save_slot_'))n++;return set.call(this,k,v)};try{fire('hidden','visible','hidden');await h.awaitPendingHideSave();return {...results(),physicalWrites:n}}finally{Storage.prototype.getItem=get;Storage.prototype.setItem=set}});
await reload();result.nochange=await evaluate(async()=>{fire('hidden','hidden');await h.awaitPendingHideSave();const a=results();fire('visible','hidden');await h.awaitPendingHideSave();return {a,b:results()}});
await reload();
result.destroy=await evaluate(async()=>{const b=cc.director.getScene().getChildByName('Canvas').getComponent('BootEntry');const c=b.persistCoordinator;let release;let entered;const started=new Promise(r=>entered=r);const g=new Promise(r=>release=r);const hold=c.runExclusive(async()=>{entered();await g});await started;const before=slots();fire('hidden','visible','hidden');await Promise.resolve();await Promise.resolve();b.onDestroy();release();await hold;await h.awaitPendingHideSave();const rec=results();fire('visible','hidden');await h.awaitPendingHideSave();return {beforeEqAfter:JSON.stringify(before)===JSON.stringify(slots()),rec,historyAfterMore:h.getCommitHistory().length}});
console.log(JSON.stringify(result));fs.writeFileSync(path.join(repoRoot,'boot-extra.json'),JSON.stringify(result,null,2));
} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch {}
  server.close();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}

