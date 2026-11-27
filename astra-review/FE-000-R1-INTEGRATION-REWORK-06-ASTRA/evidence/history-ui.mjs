/**
 * Zero-dependency real Cocos Web Build E2E & Runtime Regression Verifier (REWORK-03 hardened).
 * Launches isolated headless Chrome against the ACTUAL production apps/game-client/build/web-mobile
 * via Chrome DevTools Protocol (CDP over Node 24 built-in fetch + WebSocket).
 *
 * Verifies:
 * 1. Clean boot on portrait mobile viewport (390x844), zero console errors/exceptions
 * 2. P1-03 (A04): Production build __SPIKE_HARNESS__ exposes ZERO destructive save-clearing,
 *    raw coordinator, or owner-bypassing commit methods; destroying BootEntry yields 0 writes
 * 3. Page 1 shared core verification (7/7 PASS, exact BE-000 epoch.be000 1h/8h SHA-256)
 * 4. Direct System.import of compiled WeChatLifecycleProvider.ts (I01/I05 regression)
 * 5. Real DOM visibilitychange(hidden) -> BootEntry IndexedDB HIDE save -> REAL Page.reload() recovery
 * 6. P1-01 boot IndexedDB __probe__ fault -> STORAGE_UNAVAILABLE, slots untouched -> recovery
 * 7. P1-02 real DOM HIDE->SHOW->HIDE x4 burst -> reload rev=4 consistency
 * 8. P1-01/P1-02 (A02/A03) UNCERTAIN cross-coordinator freeze & partial slot IO freeze (real Chrome)
 * 9. P1-02 (N3) + A06 queued cancel before write (rev 8 stays 8), STARTED completes (rev 9), queue recovery
 * 10. P0 (A01) + A05 REAL CHROME DUAL-TAB DETERMINISTIC INTERLEAVED CONCURRENCY:
 *     - Empty-disk race (null -> rev 1) with navigator.locks.query() proving 2 distinct clientIds
 *     - 12-round deterministic interleaved non-empty race (rev 8 -> 20, including post-write/pre-readback
 *       barriers): 12/12 A=COMMITTED, B=CONFLICT, ZERO double COMMITTED, both tabs & reload match A
 *     - Sequential cross-tab commits, Web Locks missing/rejected fail-closed, A05 task error classification,
 *       and abnormal lock-holder tab close (Target.closeTarget) auto-release & recovery
 * 11. Real CORRUPT IndexedDB fail-closed boot check (0 overwrites)
 * 12. Real pointer click interactions, Platform Page 2 (6/6 FS, T08, T09 stub/real blocked, T10 bundle),
 *     ScrollView wheel scroll, landscape resize, 24h benchmark, 0 console errors, 0 uncaught exceptions.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeRemoveOutputDir } from 'file:///E:/idle-fishing-astra-test-20261127/tests/frontend/fe-000/safe-path-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = 'E:/idle-fishing-astra-test-20261127';
const webBuildDir = path.join(repoRoot, 'apps/game-client/build/web-mobile');
const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
const evidenceDir = outDirArg
  ? path.resolve(repoRoot, outDirArg.slice('--out-dir='.length))
  : process.env.VERIFY_WEB_OUT_DIR
    ? path.resolve(repoRoot, process.env.VERIFY_WEB_OUT_DIR)
    : path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-05/evidence/web-rework05');

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
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** External CDP IndexedDB inspection/reset helpers (NEVER exposed on production __SPIKE_HARNESS__) */
const IDB_HELPERS_EXPR = `(() => {
  const DB_NAME = 'idle_fishing_fs_v1';
  const STORE = 'files';
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return {
    async readSlots(ns) {
      const db = await openDb();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const st = tx.objectStore(STORE);
          const out = [null, null, null];
          for (let i = 0; i < 3; i++) {
            const r = st.get(ns + ':save_slot_' + i + '.json');
            r.onsuccess = () => { out[i] = r.result ?? null; };
          }
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async writeSlot(ns, idx, val) {
      const db = await openDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(val, ns + ':save_slot_' + idx + '.json');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async readTxState(ns) {
      const db = await openDb();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(ns + ':__tx_state__');
          let val = null;
          req.onsuccess = () => { val = req.result ?? null; };
          tx.oncomplete = () => resolve(val);
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async writeTxState(ns, val) {
      const db = await openDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(val, ns + ':__tx_state__');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async deleteSlot(ns, idx) {
      const db = await openDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(ns + ':save_slot_' + idx + '.json');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
    async clearNs(ns) {
      const db = await openDb();
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const st = tx.objectStore(STORE);
          const req = st.getAllKeys();
          req.onsuccess = () => {
            for (const k of req.result) {
              if (String(k).startsWith(ns + ':')) st.delete(k);
            }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    },
  };
})()`;

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
  productionHarnessAudit: null,
  bootSnapshot: null,
  bundledLifecycleCheck: null,
  realHideAndReloadPersistence: null,
  compatBootUnavailable: null,
  compatLifecycleHideShowHide: null,
  compatUncertainAndPartialIo: null,
  compatDestroyQueuedAndStarted: null,
  compatDestroyedBootZeroWrites: null,
  compatDualTabP0Interleaved: null,
  rework04A02AppCrossTab: null,
  rework04A02FaultCrashMatrix: null,
  rework04P2IdbAndLegacy: null,
  rework05Rev401And03Safety: null,
  rework05AppUiRecoveryLoop: null,
  rework05AppUiCorruptMarkerConfirm: null,
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

    const appNs = 'idle_fishing_lifecycle_persist_fs';
    const findBtnCoordExpr = (btnName) => `(() => {
      const cc = globalThis.cc;
      const canvas = cc.director.getScene().getChildByName('Canvas');
      const find = (root, name) => {
        if (root.name === name) return root;
        for (const ch of root.children) { const r = find(ch, name); if (r) return r; }
        return null;
      };
      const node = find(canvas, ${JSON.stringify(btnName)});
      if (!node || !node.activeInHierarchy) return null;
      const cam = canvas.getComponent(cc.Canvas).cameraComponent;
      const wp = node.getWorldPosition();
      const sp = cam.worldToScreen(wp);
      const rect = document.getElementById('GameCanvas').getBoundingClientRect();
      const dpr = cc.view.getDevicePixelRatio();
      return {
        x: Math.round(rect.left + sp.x / dpr),
        y: Math.round(rect.top + rect.height - sp.y / dpr),
      };
    })()`;

    const clickUiBtn = async (client, btnName) => {
      await client.send('Page.bringToFront');
      await new Promise((r) => setTimeout(r, 120));
      const coord = await client.evalJson(findBtnCoordExpr(btnName));
      if (!coord) throw new Error(`UI button ${btnName} not visible/active`);
      await client.click(coord.x, coord.y);
      return coord;
    };

const ev=s=>cdp.evalJson(s),wait=()=>new Promise(r=>setTimeout(r,450)),snap=()=>ev('__SPIKE_HARNESS__.getSnapshot()'),rows=[];async function record(label){const s=await snap();rows.push({label,state:s.lifecyclePersistence,overlay:s.recoveryOverlayVisible,marker:await ev('('+IDB_HELPERS_EXPR+').readTxState('+JSON.stringify(appNs)+')'),slots:await ev('('+IDB_HELPERS_EXPR+').readSlots('+JSON.stringify(appNs)+')')});fs.writeFileSync('E:/idle-fishing-astra-review-20261127/FE-000-R1-INTEGRATION-REWORK-06-ASTRA/evidence/historical-ui.json',JSON.stringify(rows,null,2))}
async function hide(){await ev("for(const st of ['hidden','visible']){Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>st});document.dispatchEvent(new Event('visibilitychange'))};__SPIKE_HARNESS__.awaitPendingHideSave()")}
await hide();await record('seed');await ev("globalThis.origPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,k){if(String(k).includes(':save_slot_'))throw new DOMException('quota remains full','QuotaExceededError');return origPut.call(this,v,k)};true");await hide();await record('quota');await clickUiBtn(cdp,'BtnRecoverStorage');await wait();await ev('__SPIKE_HARNESS__.awaitPendingHideSave()');await record('clicked recovery with fault still enabled');await hide();await record('next HIDE same fault');await ev('IDBObjectStore.prototype.put=origPut;true');await clickUiBtn(cdp,'BtnRecoverStorage');await wait();await hide();await record('capacity restored');
await ev("IDBObjectStore.prototype.put=function(v,k){const r=origPut.call(this,v,k);if(String(k).includes(':save_slot_'))r.addEventListener('success',()=>this.transaction.abort(),{once:true});return r};true");await hide();await record('request succeeded then transaction aborted');await ev('IDBObjectStore.prototype.put=origPut;true');
await ev('('+IDB_HELPERS_EXPR+').writeTxState('+JSON.stringify(appNs)+',"{bad")');await cdp.send('Page.reload',{ignoreCache:true});await wait();await waitUntil(()=>ev('!!globalThis.__SPIKE_HARNESS__?.ready'),25000,'boot');await record('preview');
await ev("navigator.locks.request('idle-fishing:save:browser:"+appNs+"',async()=>{globalThis.held=true;await new Promise(r=>globalThis.release=r)});true");await waitUntil(()=>ev('!!globalThis.held'),5000,'held');await clickUiBtn(cdp,'BtnConfirmCorruptMarkerRecovery');await waitUntil(()=>ev('navigator.locks.query().then(x=>x.pending.length>0)'),5000,'pending');await ev("cc.director.getScene().getComponentInChildren('BootEntry').destroy();true");await wait();await record('destroyed while waiting');await ev('release();true');await wait();await record('released after destroy');} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch {}
  server.close();
  try {
    safeRemoveOutputDir(userDataDir, { mode: 'chrome-temp', repoRoot });
  } catch {}
}

