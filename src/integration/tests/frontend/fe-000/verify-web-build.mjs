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
import { safeRemoveOutputDir } from './safe-path-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const webBuildDir = path.join(repoRoot, 'apps/game-client/build/web-mobile');
const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
const evidenceDir = outDirArg
  ? path.resolve(repoRoot, outDirArg.slice('--out-dir='.length))
  : process.env.VERIFY_WEB_OUT_DIR
    ? path.resolve(repoRoot, process.env.VERIFY_WEB_OUT_DIR)
    : path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/web-rework06');

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
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
    this.ws.addEventListener('close', () => {
      for (const [, { reject, timer }] of this.pending) {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket closed unexpectedly'));
      }
      this.pending.clear();
    });
  }
  async waitOpen() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}, timeoutMs = 45000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms) waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
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
  rework06R501MonotonicCrossTabReload: null,
  rework06R502AppUiPersistentQuotaLoop: null,
  rework06R503AppUiRecoveryOwnerLifecycle: null,
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

  const collectErrors = () => {
    for (const ev of cdp.events) {
      if (ev.method === 'Runtime.exceptionThrown') {
        report.uncaughtExceptions.push(ev.params?.exceptionDetails?.text || JSON.stringify(ev.params));
      } else if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
        const msg = (ev.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        report.consoleErrors.push(msg);
      }
    }
    cdp.events.length = 0;
  };

  // 0. P1-03 (A04) Production Web Build Surface Audit: NO destructive save-clearing or raw coordinator hooks exposed!
  const prodAudit = await cdp.evalJson(`(async () => {
    const h = globalThis.__SPIKE_HARNESS__ || {};
    const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const forbidden = [
      'clearLifecyclePersistence',
      'getPersistCoordinator',
      'commitCandidateViaCoordinator',
      'setCommitTestHooks',
      'requestHideSaveForTest',
      'triggerDestroyForTest',
      'advancePersistState',
      'reinitializePersistence',
    ];
    const presentForbidden = forbidden.filter((k) => typeof h[k] !== 'undefined');
    return {
      exposedKeys: Object.keys(h).sort(),
      presentForbidden,
      hasClearSlotsForTestOnCoordinator: typeof coordMod.SingleWriterSaveCoordinator.prototype.clearSlotsForTest !== 'undefined',
    };
  })()`);
  report.productionHarnessAudit = prodAudit;
  assertCheck(
    'web_p1_03_production_harness_no_destructive_save_api',
    prodAudit.presentForbidden.length === 0 && prodAudit.hasClearSlotsForTestOnCoordinator === false,
    JSON.stringify(prodAudit)
  );

  // 1. Verify Page 1 boot snapshot + Shared Core 7/7 + exact 1h/8h hashes
  const bootSnap = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
  report.bootSnapshot = bootSnap;
  const overviewPng = path.join(evidenceDir, 'r1-green-overview.png');
  await cdp.screenshot(overviewPng);
  report.screenshots.push(path.relative(repoRoot, overviewPng).replace(/\\/g, '/'));

  assertCheck('web_boot_env', bootSnap.env === 'WEB', `env=${bootSnap.env}`);
  assertCheck('web_boot_page', bootSnap.page === 'overview', `page=${bootSnap.page}`);
  assertCheck(
    'web_shared_core_7_of_7',
    Boolean(bootSnap.coreReport?.allPassed) && bootSnap.coreReport?.cases?.length === 7,
    `passed=${bootSnap.coreReport?.cases?.filter((c) => c.status === 'PASS').length}/${bootSnap.coreReport?.cases?.length}`
  );
  assertCheck(
    'web_be000_1h_golden_hash',
    bootSnap.coreReport?.summaryState?.canonicalHash ===
      '8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63',
    `hash=${bootSnap.coreReport?.summaryState?.canonicalHash}`
  );
  assertCheck(
    'web_be000_1h_envelope_digests',
    bootSnap.coreReport?.summaryState?.oneHourEnvelopeInnerSha256 ===
      '183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a' &&
      bootSnap.coreReport?.summaryState?.oneHourEnvelopeTextSha256 ===
        '4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6',
    `inner=${bootSnap.coreReport?.summaryState?.oneHourEnvelopeInnerSha256}, text=${bootSnap.coreReport?.summaryState?.oneHourEnvelopeTextSha256}`
  );
  assertCheck(
    'web_be000_8h_golden_and_lock',
    bootSnap.coreReport?.summaryState?.eightHourCanonicalHash ===
      '91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9' &&
      bootSnap.coreReport?.summaryState?.eightHourHasAttemptLock === true &&
      bootSnap.coreReport?.summaryState?.settledUntilMs === 1700003600000,
    `8hHash=${bootSnap.coreReport?.summaryState?.eightHourCanonicalHash}, lock=${bootSnap.coreReport?.summaryState?.eightHourHasAttemptLock}, settledUntilMs=${bootSnap.coreReport?.summaryState?.settledUntilMs}`
  );

  // 2. Direct System.import test of compiled WeChatLifecycleProvider.ts (I01 + I05)
  const bundledLifecycle = await cdp.evalJson(`(async () => {
    const mod = await System.import('chunks:///_virtual/WeChatLifecycleProvider.ts');
    const p = new mod.RuntimeLifecycleProvider();
    const seenA = [];
    const seenB = [];
    const uFault = p.subscribe(() => { throw new Error('web-bundle-fault'); });
    const uA = p.subscribe((e) => seenA.push(e));
    const uB = p.subscribe((e) => seenB.push(e));
    p.emit('HIDE', 'direct-1');
    p.emit('HIDE', 'direct-dup');
    p.emit('SHOW', 'direct-1');
    uA();
    p.emit('HIDE', 'direct-2');
    p.emit('SHOW', 'direct-2');
    const errCount = p.listenerErrorCount;
    uB();
    uFault();
    p.dispose();
    return { seenA, seenB, errCount, remainingSubs: p.getSubscriberCount(), attached: p.isPlatformAttached() };
  })()`);
  report.bundledLifecycleCheck = bundledLifecycle;
  assertCheck(
    'web_bundle_i01_lifecycle_dispatch',
    JSON.stringify(bundledLifecycle.seenA) === '["HIDE","SHOW"]' &&
      JSON.stringify(bundledLifecycle.seenB) === '["HIDE","SHOW","HIDE","SHOW"]' &&
      bundledLifecycle.errCount === 4 &&
      bundledLifecycle.remainingSubs === 0 &&
      bundledLifecycle.attached === false,
    JSON.stringify(bundledLifecycle)
  );

  // 3. Real DOM visibilitychange(hidden) -> BootEntry IndexedDB HIDE commit -> REAL Page.reload() recovery!
  const beforeReload = await cdp.evalJson(`(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const rec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    return rec;
  })()`);
  assertCheck(
    'web_real_visibilitychange_hide_commit',
    beforeReload.revision === '1' &&
      beforeReload.hideCommitCount === 1 &&
      beforeReload.lastHideTriggerSource === 'document.visibilitychange',
    JSON.stringify(beforeReload)
  );

  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after reload');
  await new Promise((r) => setTimeout(r, 500));
  const afterReloadSnap = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
  const restoredRec = afterReloadSnap.lifecyclePersistence;
  report.realHideAndReloadPersistence = { beforeReload, afterReload: restoredRec };
  assertCheck(
    'web_cross_reload_persistence_recovery',
    restoredRec.restoredOnBoot === true &&
      restoredRec.revision === '1' &&
      restoredRec.gold === beforeReload.gold &&
      restoredRec.cursorMs === beforeReload.cursorMs &&
      restoredRec.deadlineMs === beforeReload.deadlineMs,
    JSON.stringify(restoredRec)
  );

  // 3a. P1-01 COMPAT-SAVE-BOOT-UNAVAILABLE on REAL IndexedDB Web bundle:
  // Original valid rev 1 save is in IndexedDB. Fail ONLY IndexedDB __probe__ write on next reload.
  const origSlotsBeforeProbeFault = await cdp.evalJson(
    `(${IDB_HELPERS_EXPR}).readSlots('idle_fishing_lifecycle_persist_fs')`
  );
  const { identifier: probeFaultScriptId } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const origPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').endsWith('__probe__')) {
          throw new DOMException('Injected P1-01 IndexedDB __probe__ write failure', 'QuotaExceededError');
        }
        return origPut.call(this, val, key);
      };
    })();`,
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready during P1-01 probe fault');
  await new Promise((r) => setTimeout(r, 400));
  const p101FaultSnap = await cdp.evalJson(`(async () => {
    const idb = ${IDB_HELPERS_EXPR};
    const slotsAtFaultBoot = await idb.readSlots('idle_fishing_lifecycle_persist_fs');
    const parsed = slotsAtFaultBoot.filter(Boolean).map((t) => JSON.parse(t)).sort((a, b) => Number(b.revision) - Number(a.revision));
    const expectedTopEnv = parsed[0] || null;
    const expectedTopState = expectedTopEnv ? JSON.parse(expectedTopEnv.payload) : null;
    const bootRec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const afterHide = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const slotsAfterFaultHide = await idb.readSlots('idle_fishing_lifecycle_persist_fs');
    return { bootRec, afterHide, slotsAtFaultBoot, slotsAfterFaultHide, expectedTopEnv, expectedTopState };
  })()`);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: probeFaultScriptId });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after P1-01 recovery');
  await new Promise((r) => setTimeout(r, 400));
  const p101Recovered = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
  report.compatBootUnavailable = { origSlot0Len: origSlotsBeforeProbeFault?.[0]?.length ?? 0, p101FaultSnap, p101Recovered };
  const slotsUntouchedDuringFault =
    JSON.stringify(p101FaultSnap.slotsAtFaultBoot) === JSON.stringify(p101FaultSnap.slotsAfterFaultHide);
  assertCheck(
    'web_p1_01_compat_save_boot_unavailable',
    Boolean(origSlotsBeforeProbeFault?.[0]) &&
      p101FaultSnap.slotsAtFaultBoot[0] === origSlotsBeforeProbeFault[0] &&
      Boolean(p101FaultSnap.expectedTopEnv) &&
      p101FaultSnap.bootRec?.loadStatus === 'STORAGE_UNAVAILABLE' &&
      p101FaultSnap.bootRec?.persistenceHalted === true &&
      p101FaultSnap.bootRec?.restoredOnBoot === false &&
      p101FaultSnap.afterHide?.hideCommitCount === 0 &&
      p101FaultSnap.afterHide?.lastCommitKind !== 'COMMITTED' &&
      slotsUntouchedDuringFault &&
      p101Recovered?.loadStatus === 'VALID' &&
      p101Recovered?.restoredOnBoot === true &&
      p101Recovered?.revision === p101FaultSnap.expectedTopEnv?.revision &&
      p101Recovered?.gold === p101FaultSnap.expectedTopState?.gold &&
      p101Recovered?.cursorMs === p101FaultSnap.expectedTopState?.cursorMs,
    JSON.stringify({
      faultStatus: p101FaultSnap.bootRec?.loadStatus,
      faultHalted: p101FaultSnap.bootRec?.persistenceHalted,
      slotsUntouchedDuringFault,
      recoveredRev: p101Recovered?.revision,
      recoveredGold: p101Recovered?.gold,
    })
  );

  // 3b. Real DOM HIDE -> SHOW -> HIDE burst (rev 1 -> 2 -> 3 -> 4 -> 5) & cross-reload consistency
  const p102Burst = await cdp.evalJson(`(async () => {
    const fireVis = (st) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    for (let i = 0; i < 4; i++) {
      fireVis('hidden');
      fireVis('visible');
    }
    const finalRec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    const history = globalThis.__SPIKE_HARNESS__.getCommitHistory();
    return { finalRec, history };
  })()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after burst reload');
  await new Promise((r) => setTimeout(r, 400));
  const p102BurstReloaded = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
  report.compatLifecycleHideShowHide = { p102Burst, p102BurstReloaded };
  assertCheck(
    'web_p1_02_compat_lifecycle_hide_show_hide',
    p102Burst.finalRec?.hideCommitCount === 4 &&
      p102Burst.finalRec?.revision === '5' &&
      p102Burst.history?.length === 4 &&
      p102Burst.history.every((h) => h.resultKind === 'COMMITTED') &&
      p102BurstReloaded?.loadStatus === 'VALID' &&
      p102BurstReloaded?.revision === '5' &&
      p102BurstReloaded?.cursorMs === p102Burst.finalRec?.cursorMs &&
      p102BurstReloaded?.gold === p102Burst.finalRec?.gold,
    JSON.stringify({
      commits: p102Burst.finalRec?.hideCommitCount,
      rev: p102Burst.finalRec?.revision,
      reloadedRev: p102BurstReloaded?.revision,
      reloadedGold: p102BurstReloaded?.gold,
    })
  );

  // 3c. P1-03 (A04) Real production BootEntry.destroy() -> ZERO IndexedDB writes on subsequent HIDE, harness blocked!
  const p103Destroyed = await cdp.evalJson(`(async () => {
    const idb = ${IDB_HELPERS_EXPR};
    const slotsBefore = await idb.readSlots('idle_fishing_lifecycle_persist_fs');
    const cc = globalThis.cc;
    const boot = cc.director.getScene().getComponentInChildren('BootEntry');
    boot.destroy();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    const snapAfterDestroy = globalThis.__SPIKE_HARNESS__.getSnapshot();
    const switchBlocked = globalThis.__SPIKE_HARNESS__.switchPage('platform') === false;
    const coreBlocked = globalThis.__SPIKE_HARNESS__.runCoreChecks() === null;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 250));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const slotsAfter = await idb.readSlots('idle_fishing_lifecycle_persist_fs');
    return {
      destroyed: snapAfterDestroy.destroyed,
      switchBlocked,
      coreBlocked,
      slotsIdentical: JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter),
    };
  })()`);
  report.compatDestroyedBootZeroWrites = p103Destroyed;
  assertCheck(
    'web_p1_03_destroyed_boot_entry_zero_writes',
    p103Destroyed.destroyed === true &&
      p103Destroyed.switchBlocked === true &&
      p103Destroyed.coreBlocked === true &&
      p103Destroyed.slotsIdentical === true,
    JSON.stringify(p103Destroyed)
  );

  // Reload clean BootEntry for remaining isolated-namespace bundle tests
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after destroy test');
  await new Promise((r) => setTimeout(r, 400));

  // 3d. P1-01 (A02) + P1-02 (A03) on ACTUAL compiled Web bundle in Chrome (isolated namespaces):
  //     - UNCERTAIN on coord1 freezes coord2 (0 writes until explicit loadSafe())
  //     - Partial slot IO error on newest slot 2 (rev 3) stays STORAGE_UNAVAILABLE (readOnlyBackup rev 2, 0 writes)
  //       until slot 2 recovers -> loadSafe() returns VALID rev 3 & unfreezes!
  const p101A02A03 = await cdp.evalJson(`(async () => {
    const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const faultMod = await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
    const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const START = 1700000000000;
    const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.web.a02', startMs: START, allowanceMs: 3600000 });
    const s1 = coreMod.advanceOffline(s0, START + 60000).state;
    const s2 = coreMod.advanceOffline(s1, START + 120000).state;
    const s3 = coreMod.advanceOffline(s2, START + 180000).state;
    const s4 = coreMod.advanceOffline(s3, START + 240000).state;

    // Part A (A02): UNCERTAIN cross-coordinator freeze on real IndexedDB BrowserFilePort
    const nsA02 = 'fe000_web_a02_' + Date.now();
    const raw1 = new portMod.BrowserFilePort(nsA02);
    const raw2 = new portMod.BrowserFilePort(nsA02);
    const fault1 = new faultMod.FaultInjectingFilePort(raw1);
    let raw2Writes = 0;
    const origW2 = raw2.write.bind(raw2);
    raw2.write = async (...args) => { raw2Writes += 1; return origW2(...args); };

    const coord1 = new coordMod.SingleWriterSaveCoordinator(fault1);
    const coord2 = new coordMod.SingleWriterSaveCoordinator(raw2);
    await coord1.loadSafe();
    await coord1.commit(s1, null);
    await coord1.commit(s2, '1');
    fault1.setWriteInterceptor(async (p) => {
      if (p === coreMod.SLOT_PATHS[2]) fault1.setReadFault(coreMod.SLOT_PATHS[2], true);
    });
    const uncRes = await coord1.commit(s3, '2');
    const healthAfterUnc1 = coord1.storageHealth;
    const healthAfterUnc2 = coord2.storageHealth;
    const freezeCode2 = coord2.freezeCode;
    fault1.setWriteInterceptor(null);
    fault1.setReadFault(coreMod.SLOT_PATHS[2], false);
    const writesBeforeBlocked = raw2Writes;
    const blockedCoord2 = await coord2.commit(s3, '2');
    const zeroWritesWhileFrozen = raw2Writes === writesBeforeBlocked;
    const recA02 = await coord2.loadSafe();
    const c4A02 = await coord2.commit(s4, '3');

    // Part B (A03): Partial IO failure on newest slot 2 (rev 3) MUST NOT unfreeze on backup rev 2!
    const nsA03 = 'fe000_web_a03_' + Date.now();
    const baseA03 = new portMod.BrowserFilePort(nsA03);
    const faultA03 = new faultMod.FaultInjectingFilePort(baseA03);
    let a03Writes = 0;
    const origW3 = faultA03.write.bind(faultA03);
    faultA03.write = async (...args) => { a03Writes += 1; return origW3(...args); };
    const cA03_1 = new coordMod.SingleWriterSaveCoordinator(faultA03);
    const cA03_2 = new coordMod.SingleWriterSaveCoordinator(faultA03);
    await cA03_1.loadSafe();
    await cA03_1.commit(s1, null);
    await cA03_1.commit(s2, '1');
    await cA03_1.commit(s3, '2');
    faultA03.setReadFault(coreMod.SLOT_PATHS[2], true);
    const partialLoad = await cA03_1.loadSafe();
    const partialHealth2 = cA03_2.storageHealth;
    const wBeforeStale = a03Writes;
    const staleBlocked = await cA03_2.commit(s4, '2');
    const staleZeroWrites = a03Writes === wBeforeStale;
    faultA03.setReadFault(coreMod.SLOT_PATHS[2], false);
    const fullLoad = await cA03_1.loadSafe();
    const c4A03 = await cA03_2.commit(s4, '3');

    // Clean isolated namespaces
    await raw1.clearAll();
    await baseA03.clearAll();

    return {
      portKind: raw1.kind,
      a02: {
        uncKind: uncRes.kind,
        healthAfterUnc1,
        healthAfterUnc2,
        freezeCode2,
        blockedKind: blockedCoord2.kind,
        zeroWritesWhileFrozen,
        recKind: recA02.kind,
        recRev: recA02.kind === 'VALID' ? recA02.revision : null,
        c4Kind: c4A02.kind,
        c4Rev: c4A02.kind === 'COMMITTED' ? c4A02.revision : null,
      },
      a03: {
        partialKind: partialLoad.kind,
        partialClass: partialLoad.recoveryClassification ?? null,
        backupRev: partialLoad.readOnlyBackup?.revision ?? null,
        partialHealth2,
        staleKind: staleBlocked.kind,
        staleZeroWrites,
        fullKind: fullLoad.kind,
        fullRev: fullLoad.kind === 'VALID' ? fullLoad.revision : null,
        c4Kind: c4A03.kind,
        c4Rev: c4A03.kind === 'COMMITTED' ? c4A03.revision : null,
      },
    };
  })()`);
  report.compatUncertainAndPartialIo = p101A02A03;
  assertCheck(
    'web_p1_01_uncertain_cross_coordinator_and_partial_io_freeze',
    p101A02A03.portKind === 'BROWSER_INDEXED_DB' &&
      p101A02A03.a02.uncKind === 'UNCERTAIN' &&
      p101A02A03.a02.healthAfterUnc1 === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a02.healthAfterUnc2 === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a02.freezeCode2 === 'UNCERTAIN_WRITE_PENDING_RECOVERY' &&
      p101A02A03.a02.blockedKind === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a02.zeroWritesWhileFrozen === true &&
      p101A02A03.a02.recKind === 'VALID' &&
      p101A02A03.a02.recRev === '3' &&
      p101A02A03.a02.c4Kind === 'COMMITTED' &&
      p101A02A03.a02.c4Rev === '4' &&
      p101A02A03.a03.partialKind === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a03.partialClass === 'PARTIAL_IO_UNAVAILABLE' &&
      p101A02A03.a03.backupRev === '2' &&
      p101A02A03.a03.partialHealth2 === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a03.staleKind === 'STORAGE_UNAVAILABLE' &&
      p101A02A03.a03.staleZeroWrites === true &&
      p101A02A03.a03.fullKind === 'VALID' &&
      p101A02A03.a03.fullRev === '3' &&
      p101A02A03.a03.c4Kind === 'COMMITTED' &&
      p101A02A03.a03.c4Rev === '4',
    JSON.stringify(p101A02A03)
  );

  // 3e. P1-02 (N3) Queued Cancel Before Physical Write (rev 8 stays 8) & STARTED Completes Cleanly (rev 9)
  const p102N3 = await cdp.evalJson(`(async () => {
    const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
    const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
    const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
    const ns = 'fe000_web_n3_' + Date.now();
    const port = new portMod.BrowserFilePort(ns);
    const coord = new coordMod.SingleWriterSaveCoordinator(port);
    let st = coreMod.createInitialState({ saveEpoch: 'epoch.web.n3', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
    await coord.loadSafe();
    let rev = null;
    for (let i = 0; i < 8; i++) {
      st = coreMod.advanceOffline(st, st.cursorMs + 60000).state;
      const c = await coord.commit(st, rev);
      rev = c.revision;
    }

    // Hold lock at rev 8 -> queue two commits -> mark owner destroyed -> release lock -> BOTH CANCELLED, 0 writes!
    let releaseHold, enteredHold;
    const holdReady = new Promise((r) => { enteredHold = r; });
    const holdP = coord.runExclusive(async () => {
      enteredHold();
      await new Promise((r) => { releaseHold = r; });
    });
    await holdReady;

    let ownerDestroyed = false;
    const cand9 = coreMod.advanceOffline(st, st.cursorMs + 60000).state;
    const q1 = coord.commit(cand9, '8', { shouldCancelBeforeStart: () => ownerDestroyed });
    const q2 = coord.commit(cand9, '8', { shouldCancelBeforeStart: () => ownerDestroyed });
    await new Promise((r) => setTimeout(r, 30));
    ownerDestroyed = true;
    releaseHold();
    await holdP;
    const [r1, r2] = await Promise.all([q1, q2]);
    const afterQueuedCancel = await coord.loadSafe();

    // Now test STARTED: onStarted fires -> owner destroyed mid-commit -> MUST finish COMMITTED rev 9!
    let owner2Destroyed = false;
    let startedSeen = false;
    let releaseStarted, startedReadyResolve;
    const startedReady = new Promise((r) => { startedReadyResolve = r; });
    const pStarted = coord.commit(cand9, '8', {
      shouldCancelBeforeStart: () => owner2Destroyed,
      onStarted: () => { startedSeen = true; startedReadyResolve(); },
      beforeCommitBody: () => new Promise((r) => { releaseStarted = r; }),
    });
    await startedReady;
    owner2Destroyed = true;
    releaseStarted();
    const startedRes = await pStarted;
    const afterStarted = await coord.loadSafe();

    await port.clearAll();
    return {
      revBefore: rev,
      q1Kind: r1.kind,
      q2Kind: r2.kind,
      revAfterCancel: afterQueuedCancel.kind === 'VALID' ? afterQueuedCancel.revision : null,
      startedSeen,
      startedKind: startedRes.kind,
      startedRev: startedRes.kind === 'COMMITTED' ? startedRes.revision : null,
      revAfterStarted: afterStarted.kind === 'VALID' ? afterStarted.revision : null,
    };
  })()`);
  report.compatDestroyQueuedAndStarted = p102N3;
  assertCheck(
    'web_p1_02_destroy_queued_cancel_and_started_complete',
    p102N3.revBefore === '8' &&
      p102N3.q1Kind === 'CANCELLED' &&
      p102N3.q2Kind === 'CANCELLED' &&
      p102N3.revAfterCancel === '8' &&
      p102N3.startedSeen === true &&
      p102N3.startedKind === 'COMMITTED' &&
      p102N3.startedRev === '9' &&
      p102N3.revAfterStarted === '9',
    JSON.stringify(p102N3)
  );

  // 3f. P0 (A01) + A05 REAL CHROME DUAL-TAB DETERMINISTIC INTERLEAVED CONCURRENCY TEST!
  //     Tests BOTH empty-disk race (null -> rev 1) AND 12 consecutive interleaved non-empty rounds
  //     (rev 8 -> 20, including post-write/pre-readback barriers matching Astra's exact repro!),
  //     plus Web Locks missing/rejected, A05 task error classification, and abnormal Tab B close!
  const { targetId: tabBTargetId } = await cdp.send('Target.createTarget', { url: baseUrl });
  let cdpB = null;
  try {
    const tabBInfo = await waitUntil(async () => {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await r.json();
      return list.find((t) => t.id === tabBTargetId && t.webSocketDebuggerUrl) || null;
    }, 15000, 'Tab B CDP target');
    cdpB = new CdpClient(tabBInfo.webSocketDebuggerUrl);
    await cdpB.waitOpen();
    await cdpB.send('Page.enable');
    await cdpB.send('Runtime.enable');
    await waitUntil(() => cdpB.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'Tab B ready');
    await cdp.send('Page.bringToFront');
    await new Promise((r) => setTimeout(r, 300));

    // Load compiled production modules in BOTH Tab A and Tab B
    const setupTabExpr = `((nsEmpty, nsNonEmpty) => (async () => {
      const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
      const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
      globalThis.__P0_CTX__ = {
        coordMod,
        portMod,
        coreMod,
        portEmpty: new portMod.BrowserFilePort(nsEmpty),
        portNonEmpty: new portMod.BrowserFilePort(nsNonEmpty),
      };
      globalThis.__P0_CTX__.coordEmpty = new coordMod.SingleWriterSaveCoordinator(globalThis.__P0_CTX__.portEmpty);
      globalThis.__P0_CTX__.coordNonEmpty = new coordMod.SingleWriterSaveCoordinator(globalThis.__P0_CTX__.portNonEmpty);
      return {
        emptyKey: globalThis.__P0_CTX__.coordEmpty.storageKey,
        nonEmptyKey: globalThis.__P0_CTX__.coordNonEmpty.storageKey,
        portKind: globalThis.__P0_CTX__.portEmpty.kind,
      };
    })())`;

    const nsEmpty = `fe000_p0_empty_${Date.now()}`;
    const nsNonEmpty = `fe000_p0_nonempty_${Date.now()}`;
    const metaA = await cdp.evalJson(`${setupTabExpr}(${JSON.stringify(nsEmpty)}, ${JSON.stringify(nsNonEmpty)})`);
    const metaB = await cdpB.evalJson(`${setupTabExpr}(${JSON.stringify(nsEmpty)}, ${JSON.stringify(nsNonEmpty)})`);

    // Part 1: Empty-disk deterministic race (expectedRevision = null -> rev 1, slot 0)
    // Pre-probe both tabs BEFORE Tab A acquires the exclusive Web Lock (loadSafe also takes the Web Lock!)
    await cdp.evalJson(`globalThis.__P0_CTX__.coordEmpty.loadSafe()`);
    await cdpB.evalJson(`globalThis.__P0_CTX__.coordEmpty.loadSafe()`);

    await cdp.evalJson(`(() => {
      const { coordEmpty, coreMod } = globalThis.__P0_CTX__;
      const base = coreMod.createInitialState({ saveEpoch: 'epoch.p0.empty', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
      const candA = coreMod.advanceOffline(base, base.cursorMs + 60000).state;
      globalThis.__P0_EMPTY_HELD__ = false;
      globalThis.__P0_EMPTY_REL__ = null;
      globalThis.__P0_EMPTY_A__ = coordEmpty.commit(candA, null, {
        beforeCommitBody: async () => {
          globalThis.__P0_EMPTY_HELD__ = true;
          await new Promise((r) => { globalThis.__P0_EMPTY_REL__ = r; });
        },
      }).then((res) => ({ res, gold: candA.gold, cursorMs: candA.cursorMs }));
      return true;
    })()`);
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__P0_EMPTY_HELD__)`), 10000, 'Tab A empty lock held');

    await cdpB.evalJson(`(() => {
      const { coordEmpty, coreMod } = globalThis.__P0_CTX__;
      const base = coreMod.createInitialState({ saveEpoch: 'epoch.p0.empty', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
      const candB = coreMod.advanceOffline(base, base.cursorMs + 180000).state;
      globalThis.__P0_EMPTY_B__ = coordEmpty.commit(candB, null).then((res) => ({ res, gold: candB.gold, cursorMs: candB.cursorMs }));
      return true;
    })()`);
    await waitUntil(async () => {
      const q = await cdp.evalJson(`navigator.locks.query()`);
      return q.held.some((l) => l.name.includes(nsEmpty)) && q.pending.some((l) => l.name.includes(nsEmpty));
    }, 10000, 'Tab B waiting on empty Web Lock');
    const emptyLocks = await cdp.evalJson(`navigator.locks.query()`);
    const emptyHeldClient = emptyLocks.held.find((l) => l.name.includes(nsEmpty))?.clientId;
    const emptyPendingClient = emptyLocks.pending.find((l) => l.name.includes(nsEmpty))?.clientId;

    await cdp.evalJson(`globalThis.__P0_EMPTY_REL__()`);
    const [emptyResA, emptyResB] = await Promise.all([
      cdp.evalJson(`globalThis.__P0_EMPTY_A__`),
      cdpB.evalJson(`globalThis.__P0_EMPTY_B__`),
    ]);
    const emptyLoadA = await cdp.evalJson(`globalThis.__P0_CTX__.coordEmpty.loadSafe()`);
    const emptyLoadB = await cdpB.evalJson(`globalThis.__P0_CTX__.coordEmpty.loadSafe()`);

    // Part 2: Seed rev 1..8, then run 12 consecutive deterministic interleaved races (rev 8->20!)
    // Rounds 0..5: barrier in beforeCommitBody (before write); Rounds 6..11: barrier AFTER physical write, BEFORE readback!
    const seedRev8 = await cdp.evalJson(`(async () => {
      const { coordNonEmpty, coreMod } = globalThis.__P0_CTX__;
      await coordNonEmpty.loadSafe();
      let st = coreMod.createInitialState({ saveEpoch: 'epoch.p0.race', startMs: 1700000000000, allowanceMs: 24 * 3600000 });
      let rev = null;
      for (let i = 0; i < 8; i++) {
        st = coreMod.advanceOffline(st, st.cursorMs + 60000).state;
        const r = await coordNonEmpty.commit(st, rev);
        rev = r.revision;
      }
      return rev;
    })()`);

    const raceRounds = [];
    let syncA = await cdp.evalJson(`globalThis.__P0_CTX__.coordNonEmpty.loadSafe()`);
    let syncB = await cdpB.evalJson(`globalThis.__P0_CTX__.coordNonEmpty.loadSafe()`);
    for (let round = 0; round < 12; round++) {
      const useReadbackBarrier = round >= 6;
      const expectedRev = syncA.revision;
      if (syncA.kind !== 'VALID' || syncB.kind !== 'VALID' || syncA.revision !== syncB.revision) {
        raceRounds.push({ round, preSyncMismatch: true, syncA: syncA.revision, syncB: syncB.revision });
        break;
      }

      if (useReadbackBarrier) {
        // Hold AFTER physical IndexedDB write completes and BEFORE readback begins (Astra astra-browser.mjs barrier!)
        await cdp.evalJson(`(() => {
          const { portNonEmpty, coordNonEmpty, coreMod } = globalThis.__P0_CTX__;
          const origW = portNonEmpty.write.bind(portNonEmpty);
          const origR = portNonEmpty.read.bind(portNonEmpty);
          let wroteTarget = null;
          globalThis.__RB_HELD__ = false;
          globalThis.__RB_REL__ = null;
          portNonEmpty.write = async (p, text) => {
            await origW(p, text);
            wroteTarget = p;
          };
          portNonEmpty.read = async (p) => {
            if (wroteTarget && p === wroteTarget) {
              wroteTarget = null;
              globalThis.__RB_HELD__ = true;
              await new Promise((r) => { globalThis.__RB_REL__ = r; });
            }
            return origR(p);
          };
          const candA = coreMod.advanceOffline(${JSON.stringify(syncA.raw)}, ${syncA.raw.cursorMs} + 60000).state;
          globalThis.__ROUND_A__ = coordNonEmpty.commit(candA, ${JSON.stringify(expectedRev)}).finally(() => {
            portNonEmpty.write = origW;
            portNonEmpty.read = origR;
          }).then((res) => ({ res, gold: candA.gold, cursorMs: candA.cursorMs }));
        })()`);
        await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__RB_HELD__)`), 10000, `Round ${round} readback barrier`);
      } else {
        await cdp.evalJson(`(() => {
          const { coordNonEmpty, coreMod } = globalThis.__P0_CTX__;
          globalThis.__RB_HELD__ = false;
          globalThis.__RB_REL__ = null;
          const candA = coreMod.advanceOffline(${JSON.stringify(syncA.raw)}, ${syncA.raw.cursorMs} + 60000).state;
          globalThis.__ROUND_A__ = coordNonEmpty.commit(candA, ${JSON.stringify(expectedRev)}, {
            beforeCommitBody: async () => {
              globalThis.__RB_HELD__ = true;
              await new Promise((r) => { globalThis.__RB_REL__ = r; });
            },
          }).then((res) => ({ res, gold: candA.gold, cursorMs: candA.cursorMs }));
        })()`);
        await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__RB_HELD__)`), 10000, `Round ${round} lock barrier`);
      }

      // Tab B submits a DIFFERENT candidate (+180s) for the EXACT SAME expectedRevision while Tab A holds the lock!
      await cdpB.evalJson(`(() => {
        const { coordNonEmpty, coreMod } = globalThis.__P0_CTX__;
        const candB = coreMod.advanceOffline(${JSON.stringify(syncB.raw)}, ${syncB.raw.cursorMs} + 180000).state;
        globalThis.__ROUND_B__ = coordNonEmpty.commit(candB, ${JSON.stringify(expectedRev)}).then((res) => ({
          res,
          gold: candB.gold,
          cursorMs: candB.cursorMs,
        }));
      })()`);

      await waitUntil(async () => {
        const q = await cdp.evalJson(`navigator.locks.query()`);
        return q.held.some((l) => l.name.includes(nsNonEmpty)) && q.pending.some((l) => l.name.includes(nsNonEmpty));
      }, 10000, `Round ${round} Tab B pending Web Lock`);
      const qRound = await cdp.evalJson(`navigator.locks.query()`);
      const heldId = qRound.held.find((l) => l.name.includes(nsNonEmpty))?.clientId;
      const pendId = qRound.pending.find((l) => l.name.includes(nsNonEmpty))?.clientId;

      await cdp.evalJson(`globalThis.__RB_REL__()`);
      const [rA, rB] = await Promise.all([
        cdp.evalJson(`globalThis.__ROUND_A__`),
        cdpB.evalJson(`globalThis.__ROUND_B__`),
      ]);
      const postA = await cdp.evalJson(`globalThis.__P0_CTX__.coordNonEmpty.loadSafe()`);
      const postB = await cdpB.evalJson(`globalThis.__P0_CTX__.coordNonEmpty.loadSafe()`);
      syncA = postA;
      syncB = postB;
      raceRounds.push({
        round,
        barrier: useReadbackBarrier ? 'post-write-pre-readback' : 'pre-write',
        expectedRev,
        distinctClients: Boolean(heldId && pendId && heldId !== pendId),
        aKind: rA.res.kind,
        aRev: rA.res.revision ?? null,
        aSlot: rA.res.slot ?? null,
        aGold: rA.gold,
        bKind: rB.res.kind,
        bGold: rB.gold,
        postARev: postA.revision,
        postAGold: postA.raw?.gold,
        postBRev: postB.revision,
        postBGold: postB.raw?.gold,
      });
    }

    // Part 3: A05 task body error vs genuine Web Locks rejection & missing Web Locks + Tab B abnormal close recovery!
    const a05AndLocks = await cdpB.evalJson(`(async () => {
      const { coordNonEmpty, coreMod } = globalThis.__P0_CTX__;
      const cur = await coordNonEmpty.loadSafe();
      const cand = coreMod.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;
      // 3a. A05: Task body throws AFTER acquiring Web Lock -> must propagate original error, NOT freeze as CROSS_TAB_LOCK_REJECTED!
      let taskErrMsg = null;
      try {
        await coordNonEmpty.commit(cand, cur.revision, {
          beforeCommitBody: async () => { throw new Error('audit body real chrome'); },
        });
      } catch (e) {
        taskErrMsg = e instanceof Error ? e.message : String(e);
      }
      const healthAfterTaskErr = coordNonEmpty.storageHealth;

      // 3b. Genuine Web Locks rejection -> STORAGE_UNAVAILABLE + CROSS_TAB_LOCK_REJECTED + frozen!
      const origLocks = navigator.locks;
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: () => Promise.reject(new Error('Injected Web Locks rejection')) },
      });
      const lockRej = await coordNonEmpty.commit(cand, cur.revision);
      const healthAfterRej = coordNonEmpty.storageHealth;
      Object.defineProperty(navigator, 'locks', { configurable: true, value: origLocks });
      await coordNonEmpty.loadSafe();

      // 3c. Missing navigator.locks -> STORAGE_UNAVAILABLE + CROSS_TAB_LOCK_UNAVAILABLE
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
      const lockMiss = await coordNonEmpty.commit(cand, cur.revision);
      Object.defineProperty(navigator, 'locks', { configurable: true, value: origLocks });
      await coordNonEmpty.loadSafe();

      return {
        curRev: cur.revision,
        taskErrMsg,
        healthAfterTaskErr,
        lockRejKind: lockRej.kind,
        lockRejDetail: lockRej.detail,
        healthAfterRej,
        lockMissKind: lockMiss.kind,
        lockMissDetail: lockMiss.detail,
      };
    })()`);

    // Part 4: Tab B holds exclusive Web Lock and closes abnormally -> Chrome auto-releases lock -> Tab A recovers & commits!
    await cdpB.evalJson(`(() => {
      globalThis.__CRASH_HELD__ = false;
      navigator.locks.request('idle-fishing:save:' + globalThis.__P0_CTX__.coordNonEmpty.storageKey, { mode: 'exclusive' }, () => {
        globalThis.__CRASH_HELD__ = true;
        return new Promise(() => {});
      });
    })()`);
    await waitUntil(() => cdpB.evalJson(`Boolean(globalThis.__CRASH_HELD__)`), 10000, 'Tab B holding crash lock');
    cdpB.close();
    cdpB = null;
    await cdp.send('Target.closeTarget', { targetId: tabBTargetId });
    await new Promise((r) => setTimeout(r, 300));

    const afterTabBCrash = await cdp.evalJson(`(async () => {
      const { coordNonEmpty, portEmpty, portNonEmpty, coreMod } = globalThis.__P0_CTX__;
      const loaded = await coordNonEmpty.loadSafe();
      const nextCand = coreMod.advanceOffline(loaded.raw, loaded.raw.cursorMs + 60000).state;
      const committed = await coordNonEmpty.commit(nextCand, loaded.revision);
      const reloaded = await coordNonEmpty.loadSafe();
      await portEmpty.clearAll();
      await portNonEmpty.clearAll();
      return {
        beforeRev: loaded.revision,
        committedKind: committed.kind,
        committedRev: committed.revision ?? null,
        reloadedRev: reloaded.revision ?? null,
      };
    })()`);

    const all12RoundsClean =
      raceRounds.length === 12 &&
      raceRounds.every(
        (r) =>
          !r.preSyncMismatch &&
          r.distinctClients === true &&
          r.aKind === 'COMMITTED' &&
          r.aRev === String(Number(r.expectedRev) + 1) &&
          r.bKind === 'CONFLICT' &&
          r.postARev === r.aRev &&
          r.postBRev === r.aRev &&
          r.postAGold === r.aGold &&
          r.postBGold === r.aGold
      );

    report.compatDualTabP0Interleaved = {
      metaA,
      metaB,
      emptyRace: {
        distinctClients: Boolean(emptyHeldClient && emptyPendingClient && emptyHeldClient !== emptyPendingClient),
        aKind: emptyResA.res.kind,
        aRev: emptyResA.res.revision,
        aSlot: emptyResA.res.slot,
        aGold: emptyResA.gold,
        bKind: emptyResB.res.kind,
        bGold: emptyResB.gold,
        loadAGold: emptyLoadA.raw?.gold,
        loadBGold: emptyLoadB.raw?.gold,
      },
      seedRev8,
      all12RoundsClean,
      raceRounds,
      a05AndLocks,
      afterTabBCrash,
    };

    assertCheck(
      'web_p0_dual_tab_empty_and_12_round_interleaved_race',
      metaA.portKind === 'BROWSER_INDEXED_DB' &&
        metaB.portKind === 'BROWSER_INDEXED_DB' &&
        Boolean(emptyHeldClient && emptyPendingClient && emptyHeldClient !== emptyPendingClient) &&
        emptyResA.res.kind === 'COMMITTED' &&
        emptyResA.res.revision === '1' &&
        emptyResB.res.kind === 'CONFLICT' &&
        emptyLoadA.raw?.gold === emptyResA.gold &&
        emptyLoadB.raw?.gold === emptyResA.gold &&
        seedRev8 === '8' &&
        all12RoundsClean &&
        a05AndLocks.taskErrMsg === 'audit body real chrome' &&
        a05AndLocks.healthAfterTaskErr === 'AVAILABLE' &&
        a05AndLocks.lockRejKind === 'STORAGE_UNAVAILABLE' &&
        String(a05AndLocks.lockRejDetail).includes('CROSS_TAB_LOCK_REJECTED') &&
        a05AndLocks.healthAfterRej === 'STORAGE_UNAVAILABLE' &&
        a05AndLocks.lockMissKind === 'STORAGE_UNAVAILABLE' &&
        String(a05AndLocks.lockMissDetail).includes('CROSS_TAB_LOCK_UNAVAILABLE') &&
        afterTabBCrash.beforeRev === '20' &&
        afterTabBCrash.committedKind === 'COMMITTED' &&
        afterTabBCrash.committedRev === '21' &&
        afterTabBCrash.reloadedRev === '21',
      JSON.stringify({
        portKind: metaA.portKind,
        emptyA: emptyResA.res.kind,
        emptyB: emptyResB.res.kind,
        roundsPass: `${raceRounds.filter((r) => r.aKind === 'COMMITTED' && r.bKind === 'CONFLICT' && r.postAGold === r.aGold && r.postBGold === r.aGold).length}/12`,
        doubleCommitted: raceRounds.filter((r) => r.aKind === 'COMMITTED' && r.bKind === 'COMMITTED').length,
        a05TaskErr: a05AndLocks.taskErrMsg,
        a05HealthAfterTaskErr: a05AndLocks.healthAfterTaskErr,
        lockRejKind: a05AndLocks.lockRejKind,
        lockMissKind: a05AndLocks.lockMissKind,
        postCrashRev: afterTabBCrash.committedRev,
      })
    );
  } finally {
    cdpB?.close();
    try {
      await cdp.send('Target.closeTarget', { targetId: tabBTargetId });
    } catch {}
  }

  // 3g. Fail-closed CORRUPT IndexedDB boot check on real production Web bundle
  await cdp.evalJson(`(async () => {
    const idb = ${IDB_HELPERS_EXPR};
    for (let i = 0; i < 3; i++) {
      await idb.writeSlot('idle_fishing_lifecycle_persist_fs', i, 'CORRUPT_WEB_PROBE_' + i);
    }
  })()`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after corrupt reload');
  await new Promise((r) => setTimeout(r, 400));
  const corruptCheck = await cdp.evalJson(`(async () => {
    const idb = ${IDB_HELPERS_EXPR};
    const snapBefore = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    const slotsAfter = await idb.readSlots('idle_fishing_lifecycle_persist_fs');
    await idb.clearNs('idle_fishing_lifecycle_persist_fs');
    return { snapBefore, slot0After: slotsAfter[0] };
  })()`);
  assertCheck(
    'web_corrupt_save_fail_closed_no_overwrite',
    corruptCheck.snapBefore?.loadStatus === 'CORRUPT' &&
      corruptCheck.snapBefore?.persistenceHalted === true &&
      corruptCheck.snapBefore?.restoredOnBoot === false &&
      corruptCheck.slot0After === 'CORRUPT_WEB_PROBE_0',
    JSON.stringify(corruptCheck)
  );

  // =========================================================================
  // 3h. REWORK-04 A02 REAL CHROME APP-LEVEL CROSS-TAB FREEZE (Scenarios 1-3)
  //     - Tab A normal HIDE -> UNCERTAIN + halt + durable IndexedDB tx marker
  //     - Tab B normal HIDE (unrecovered) -> STORAGE_UNAVAILABLE + halt + 0 writes
  //     - Tab B direct coordinator commit (unrecovered) -> STORAGE_UNAVAILABLE + 0 writes
  //     - Tab A destroy(), Page.reload(), AND Target.closeTarget() -> Tab B STILL blocked (0 writes!)
  //     - Explicit loadSafe() on Tab B recovers VALID rev 1 & clears marker -> next commit rev 2 succeeds
  // =========================================================================
  {
    const appNs = 'idle_fishing_lifecycle_persist_fs';
    await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
    const { targetId: tabATid } = await cdp.send('Target.createTarget', { url: baseUrl });
    let tabBTid = null;
    let cdpA2 = null;
    let cdpB2 = null;
    try {
      const openTab = async (tid, label) => {
        const info = await waitUntil(async () => {
          const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          const list = await r.json();
          return list.find((t) => t.id === tid && t.webSocketDebuggerUrl) || null;
        }, 15000, label);
        const c = new CdpClient(info.webSocketDebuggerUrl);
        await c.waitOpen();
        await c.send('Page.enable');
        await c.send('Runtime.enable');
        await waitUntil(() => c.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, label + ' ready');
        return c;
      };
      cdpA2 = await openTab(tabATid, 'A02-App Tab A');
      // Seed rev 1 via normal BootEntry HIDE on Tab A
      const seedA = await cdpA2.evalJson(`(async () => {
        const fire = (st) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        fire('hidden');
        fire('visible');
        return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      })()`);
      // Open Tab B AFTER rev 1 is committed so it boots from rev 1
      const createdB = await cdp.send('Target.createTarget', { url: baseUrl });
      tabBTid = createdB.targetId;
      cdpB2 = await openTab(tabBTid, 'A02-App Tab B');
      const bBoot = await cdpB2.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);

      // Tab A: inject slot write failure + subsequent slot read failure and trigger normal HIDE -> UNCERTAIN!
      const aUncertain = await cdpA2.evalJson(`(async () => {
        const origPut = IDBObjectStore.prototype.put;
        const origGet = IDBObjectStore.prototype.get;
        let afterSlotWrite = false;
        IDBObjectStore.prototype.put = function(val, key) {
          if (String(key || '').includes(':save_slot_')) {
            afterSlotWrite = true;
            throw new DOMException('REWORK-04 audit slot write failure', 'QuotaExceededError');
          }
          return origPut.call(this, val, key);
        };
        IDBObjectStore.prototype.get = function(key) {
          if (afterSlotWrite && String(key || '').includes(':save_slot_')) {
            throw new DOMException('REWORK-04 audit slot read failure', 'UnknownError');
          }
          return origGet.call(this, key);
        };
        const fire = (st) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        try {
          fire('hidden');
          fire('visible');
          const rec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
          return { last: rec.lastCommitKind, halted: rec.persistenceHalted, health: rec.storageHealth, rev: rec.revision };
        } finally {
          IDBObjectStore.prototype.put = origPut;
          IDBObjectStore.prototype.get = origGet;
        }
      })()`);

      const markerAfterA = await cdpB2.evalJson(`(${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)})`);
      const slotsAfterA = await cdpB2.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);

      // Scenario 2: Tab B normal BootEntry HIDE WITHOUT loadSafe -> MUST be STORAGE_UNAVAILABLE + halt + 0 writes!
      const bNormalHide = await cdpB2.evalJson(`(async () => {
        const fire = (st) => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        fire('hidden');
        fire('visible');
        const rec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const slots = await (${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)});
        return { last: rec.lastCommitKind, halted: rec.persistenceHalted, health: rec.storageHealth, rev: rec.revision, slots };
      })()`);

      // Helper: Tab B fresh direct SingleWriterSaveCoordinator commit WITHOUT recovery
      const tryDirectCommitB = `((ns) => (async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(ns);
        let writeCount = 0;
        const origW = port.write.bind(port);
        port.write = async (...args) => { writeCount += 1; return origW(...args); };
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const s0 = coreMod.createInitialState({ saveEpoch: 'fe000-lifecycle-epoch', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
        const s2 = coreMod.advanceOffline(s0, s0.cursorMs + 180000).state;
        const res = await coord.commit(s2, '1');
        return { kind: res.kind, detail: res.detail ?? null, writeCount };
      })())`;

      // Scenario 1: Tab B direct coordinator commit rejected
      const bDirectBefore = await cdpB2.evalJson(`${tryDirectCommitB}(${JSON.stringify(appNs)})`);

      // Scenario 3a: Tab A destroys BootEntry -> Tab B STILL blocked!
      await cdpA2.send('Page.bringToFront');
      await cdpA2.evalJson(`(async () => {
        const boot = globalThis.cc.director.getScene().getComponentInChildren('BootEntry');
        boot.destroy();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      })()`);
      const bAfterADestroy = await cdpB2.evalJson(`${tryDirectCommitB}(${JSON.stringify(appNs)})`);

      // Scenario 3b: Tab A reloads (`Page.reload`) -> BootEntry boots with clearPendingTxMarker:false ->
      // Tab A MUST stay STORAGE_UNAVAILABLE & marker MUST stay intact -> Tab B STILL blocked!
      await cdpA2.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdpA2.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'A02-App Tab A reload');
      await new Promise((r) => setTimeout(r, 300));
      const aAfterReload = await cdpA2.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence`);
      const markerAfterAReload = await cdpB2.evalJson(`(${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)})`);
      const bAfterAReload = await cdpB2.evalJson(`${tryDirectCommitB}(${JSON.stringify(appNs)})`);

      // Scenario 3c: Tab A closes completely (`Target.closeTarget`) -> Tab B STILL blocked!
      cdpA2.close();
      cdpA2 = null;
      await cdp.send('Target.closeTarget', { targetId: tabATid });
      await new Promise((r) => setTimeout(r, 250));
      const bAfterAClose = await cdpB2.evalJson(`${tryDirectCommitB}(${JSON.stringify(appNs)})`);
      const slotsBeforeRecover = await cdpB2.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);

      // Explicit recovery via loadSafe() on Tab B clears marker & allows committing rev 2!
      const bRecoverAndCommit = await cdpB2.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(${JSON.stringify(appNs)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const loaded = await coord.loadSafe();
        const markerAfter = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        const nextSt = coreMod.advanceOffline(loaded.raw, loaded.raw.cursorMs + 60000).state;
        const c2 = await coord.commit(nextSt, loaded.revision);
        return {
          loadedKind: loaded.kind,
          loadedRev: loaded.revision ?? null,
          markerAfter,
          c2Kind: c2.kind,
          c2Rev: c2.revision ?? null,
        };
      })()`);

      await cdpB2.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
      const slotsUnchangedThroughAllBlocks =
        JSON.stringify(slotsAfterA) === JSON.stringify(bNormalHide.slots) &&
        JSON.stringify(slotsAfterA) === JSON.stringify(slotsBeforeRecover);

      report.rework04A02AppCrossTab = {
        seedRev: seedA.revision,
        bBoot: { status: bBoot.loadStatus, rev: bBoot.revision },
        aUncertain,
        markerPresentAfterA: Boolean(markerAfterA),
        bNormalHide: { last: bNormalHide.last, halted: bNormalHide.halted, health: bNormalHide.health, rev: bNormalHide.rev },
        bDirectBefore,
        bAfterADestroy,
        aAfterReload: { loadStatus: aAfterReload.loadStatus, halted: aAfterReload.persistenceHalted, health: aAfterReload.storageHealth },
        markerPresentAfterAReload: Boolean(markerAfterAReload),
        bAfterAReload,
        bAfterAClose,
        slotsUnchangedThroughAllBlocks,
        bRecoverAndCommit,
      };

      assertCheck(
        'web_rework04_a02_app_hide_cross_tab_freeze_and_lifecycle',
        seedA.revision === '1' &&
          bBoot.loadStatus === 'VALID' &&
          bBoot.revision === '1' &&
          aUncertain.last === 'UNCERTAIN' &&
          aUncertain.halted === true &&
          Boolean(markerAfterA) &&
          bNormalHide.last === 'STORAGE_UNAVAILABLE' &&
          bNormalHide.halted === true &&
          bNormalHide.health === 'STORAGE_UNAVAILABLE' &&
          bDirectBefore.kind === 'STORAGE_UNAVAILABLE' &&
          bDirectBefore.writeCount === 0 &&
          bAfterADestroy.kind === 'STORAGE_UNAVAILABLE' &&
          bAfterADestroy.writeCount === 0 &&
          aAfterReload.loadStatus === 'STORAGE_UNAVAILABLE' &&
          aAfterReload.persistenceHalted === true &&
          Boolean(markerAfterAReload) &&
          bAfterAReload.kind === 'STORAGE_UNAVAILABLE' &&
          bAfterAReload.writeCount === 0 &&
          bAfterAClose.kind === 'STORAGE_UNAVAILABLE' &&
          bAfterAClose.writeCount === 0 &&
          slotsUnchangedThroughAllBlocks === true &&
          bRecoverAndCommit.loadedKind === 'VALID' &&
          // R5-02 Option A: Tab A's quota-induced UNCERTAIN requires write-verified checkpoint commit (rev 1 -> 2, state unchanged)
          bRecoverAndCommit.loadedRev === '2' &&
          bRecoverAndCommit.markerAfter === null &&
          bRecoverAndCommit.c2Kind === 'COMMITTED' &&
          bRecoverAndCommit.c2Rev === '3',
        JSON.stringify(report.rework04A02AppCrossTab)
      );
    } finally {
      cdpA2?.close();
      cdpB2?.close();
      try { await cdp.send('Target.closeTarget', { targetId: tabATid }); } catch {}
      if (tabBTid) { try { await cdp.send('Target.closeTarget', { targetId: tabBTid }); } catch {} }
      try { await cdp.send('Page.bringToFront'); } catch {}
    }
  }

  // =========================================================================
  // 3i. REWORK-04 A02 REAL CHROME FAULT & CRASH MATRIX (Scenarios 4-12)
  //     - Scenario 4: Marker write failure -> STORAGE_UNAVAILABLE, 0 save slot writes
  //     - Scenario 5: Marker written, page crash BEFORE slot write -> Tab B blocked -> loadSafe recovers
  //     - Scenario 6: Slot written, page crash BEFORE readback -> Tab B blocked -> loadSafe discovers new rev
  //     - Scenario 7: Commit succeeds on disk, marker clear fails -> UNCERTAIN -> Tab B blocked -> loadSafe recovers
  //     - Scenario 8: Partial slot IO failure during recovery -> stays frozen, Tab B blocked
  //     - Scenario 9: Unreadable tx marker during recovery -> TX_STATE_UNREADABLE, Tab B blocked
  //     - Scenarios 10 & 11: Post-recovery commit succeeds on latest rev; stale instance gets CONFLICT
  //     - Scenario 12: Separate save domain completely unaffected while primary domain is frozen
  // =========================================================================
  {
    const nsM = `fe000_r4_matrix_${Date.now()}`;
    const nsOther = `fe000_r4_other_${Date.now()}`;
    const openIsolatedTab = async (label) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: baseUrl });
      const info = await waitUntil(async () => {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const list = await r.json();
        return list.find((t) => t.id === targetId && t.webSocketDebuggerUrl) || null;
      }, 15000, label);
      const client = new CdpClient(info.webSocketDebuggerUrl);
      await client.waitOpen();
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      await waitUntil(() => client.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, label + ' ready');
      return { targetId, client };
    };

    const tabObserver = await openIsolatedTab('R4-Matrix Observer');
    let tabCrash1 = null;
    let tabCrash2 = null;
    try {
      // Seed rev 1 in nsM
      await tabObserver.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r4.matrix', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
        const s1 = coreMod.advanceOffline(s0, s0.cursorMs + 60000).state;
        await coord.loadSafe();
        const c1 = await coord.commit(s1, null);
        if (c1.kind !== 'COMMITTED') throw new Error('Seed failed: ' + JSON.stringify(c1));
      })()`);

      // Scenario 4: Marker write failure -> STORAGE_UNAVAILABLE & 0 save slot writes
      const sc4 = await tabObserver.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const cur = await coord.loadSafe();
        const cand = coreMod.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;
        const slotsBefore = await (${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(nsM)});
        let slotWriteCalls = 0;
        const origPortW = port.write.bind(port);
        port.write = async (...args) => { slotWriteCalls += 1; return origPortW(...args); };
        const origPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(val, key) {
          if (String(key || '').endsWith(':__tx_state__')) {
            throw new DOMException('Injected marker write failure', 'QuotaExceededError');
          }
          return origPut.call(this, val, key);
        };
        let res;
        try {
          res = await coord.commit(cand, cur.revision);
        } finally {
          IDBObjectStore.prototype.put = origPut;
          port.write = origPortW;
        }
        const slotsAfter = await (${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(nsM)});
        await coord.loadSafe();
        return {
          kind: res.kind,
          detail: res.detail ?? null,
          slotWriteCalls,
          slotsIdentical: JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter),
        };
      })()`);

      // Scenario 5: Marker written, then Tab crashes (Target.closeTarget) BEFORE save slot write!
      tabCrash1 = await openIsolatedTab('R4-Matrix CrashPreWrite');
      await tabCrash1.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const cur = await coord.loadSafe();
        const cand = coreMod.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;
        globalThis.__PRE_WRITE_PAUSED__ = false;
        const origW = port.write.bind(port);
        port.write = async () => {
          globalThis.__PRE_WRITE_PAUSED__ = true;
          await new Promise(() => {}); // Hang forever until Target.closeTarget kills tab
        };
        void coord.commit(cand, cur.revision);
      })()`);
      await waitUntil(() => tabCrash1.client.evalJson(`Boolean(globalThis.__PRE_WRITE_PAUSED__)`), 15000, 'CrashPreWrite pause');
      tabCrash1.client.close();
      await cdp.send('Target.closeTarget', { targetId: tabCrash1.targetId });
      tabCrash1 = null;
      await new Promise((r) => setTimeout(r, 300));

      // Observer Tab (separate realm!) tries commit -> MUST be blocked (STORAGE_UNAVAILABLE, 0 writes),
      // while separate domain nsOther commits cleanly (Scenario 12!), then explicit loadSafe recovers rev 1!
      const sc5And12 = await tabObserver.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const markerBefore = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(nsM)});
        const portM = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coordM = new coordMod.SingleWriterSaveCoordinator(portM);
        const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r4.matrix', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
        const s2 = coreMod.advanceOffline(s0, s0.cursorMs + 120000).state;
        const blocked = await coordM.commit(s2, '1');

        // Scenario 12: Separate save domain nsOther MUST remain completely unaffected!
        const portOther = new portMod.BrowserFilePort(${JSON.stringify(nsOther)});
        const coordOther = new coordMod.SingleWriterSaveCoordinator(portOther);
        const otherLoad = await coordOther.loadSafe();
        const otherCommit = await coordOther.commit(s2, null);
        await portOther.clearAll();

        // Explicit recovery on nsM confirms rev 1 & clears PENDING marker
        const recovered = await coordM.loadSafe();
        const markerAfter = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(nsM)});
        return {
          markerState: markerBefore ? JSON.parse(markerBefore).state : null,
          blockedKind: blocked.kind,
          otherLoadKind: otherLoad.kind,
          otherCommitKind: otherCommit.kind,
          recoveredKind: recovered.kind,
          recoveredRev: recovered.revision ?? null,
          markerAfter,
        };
      })()`);

      // Scenario 6 + 10 + 11: Slot written to disk (rev 2), then Tab crashes BEFORE readback completes!
      tabCrash2 = await openIsolatedTab('R4-Matrix CrashPreReadback');
      await tabCrash2.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const cur = await coord.loadSafe();
        const cand = coreMod.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;
        globalThis.__PRE_RB_PAUSED__ = false;
        let wroteSlot = null;
        const origW = port.write.bind(port);
        const origR = port.read.bind(port);
        port.write = async (p, text) => {
          await origW(p, text);
          wroteSlot = p;
        };
        port.read = async (p) => {
          if (wroteSlot && p === wroteSlot) {
            globalThis.__PRE_RB_PAUSED__ = true;
            await new Promise(() => {}); // Hang before readback until killed!
          }
          return origR(p);
        };
        void coord.commit(cand, cur.revision);
      })()`);
      await waitUntil(() => tabCrash2.client.evalJson(`Boolean(globalThis.__PRE_RB_PAUSED__)`), 15000, 'CrashPreReadback pause');
      tabCrash2.client.close();
      await cdp.send('Target.closeTarget', { targetId: tabCrash2.targetId });
      tabCrash2 = null;
      await new Promise((r) => setTimeout(r, 300));

      const sc6And10And11 = await tabObserver.client.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const portM = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
        const coordM = new coordMod.SingleWriterSaveCoordinator(portM);
        const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r4.matrix', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
        const staleCand = coreMod.advanceOffline(s0, s0.cursorMs + 180000).state;

        // Before recovery: MUST be STORAGE_UNAVAILABLE
        const blocked = await coordM.commit(staleCand, '1');
        // Explicit recovery discovers newly written rev 2!
        const recovered = await coordM.loadSafe();
        // Scenario 11: Stale instance still submitting expectedRevision='1' MUST get CONFLICT (0 writes)!
        const staleConflict = await coordM.commit(staleCand, '1');
        // Scenario 10: Fresh commit based on latest rev 2 succeeds -> rev 3!
        const nextCand = coreMod.advanceOffline(recovered.raw, recovered.raw.cursorMs + 60000).state;
        const freshCommit = await coordM.commit(nextCand, recovered.revision);
        return {
          blockedKind: blocked.kind,
          recoveredKind: recovered.kind,
          recoveredRev: recovered.revision ?? null,
          staleConflictKind: staleConflict.kind,
          freshCommitKind: freshCommit.kind,
          freshCommitRev: freshCommit.revision ?? null,
        };
      })()`);

      // Scenarios 7, 8, 9: Marker clear failure after commit (Sc7), partial slot IO during recovery (Sc8),
      // and unreadable tx marker during recovery (Sc9)
      const tabSecond = await openIsolatedTab('R4-Matrix SecondTab');
      try {
        const sc7_8_9 = await tabObserver.client.evalJson(`(async () => {
          const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
          const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
          const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
          const portM = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
          const coordM = new coordMod.SingleWriterSaveCoordinator(portM);
          const cur = await coordM.loadSafe();
          const cand4 = coreMod.advanceOffline(cur.raw, cur.raw.cursorMs + 60000).state;

          // Scenario 7: Commit rev 4 succeeds on disk, but deleting :__tx_state__ throws!
          const origDel = IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete = function(key) {
            if (String(key || '').endsWith(':__tx_state__')) {
              throw new DOMException('Injected tx marker delete failure', 'UnknownError');
            }
            return origDel.call(this, key);
          };
          let sc7Commit;
          try {
            sc7Commit = await coordM.commit(cand4, cur.revision);
          } finally {
            IDBObjectStore.prototype.delete = origDel;
          }
          const markerStillThere = Boolean(await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(nsM)}));

          // Scenario 8: Partial slot IO failure during recovery keeps frozen & preserves marker
          const origGet = IDBObjectStore.prototype.get;
          IDBObjectStore.prototype.get = function(key) {
            if (String(key || '').endsWith(':save_slot_0.json')) {
              throw new DOMException('Injected partial slot IO failure during recovery', 'UnknownError');
            }
            return origGet.call(this, key);
          };
          let sc8Recovery;
          try {
            sc8Recovery = await coordM.loadSafe();
          } finally {
            IDBObjectStore.prototype.get = origGet;
          }

          // Scenario 9: Unreadable tx marker during recovery returns TX_STATE_UNREADABLE & stays frozen
          IDBObjectStore.prototype.get = function(key) {
            if (String(key || '').endsWith(':__tx_state__')) {
              throw new DOMException('Injected tx marker read failure during recovery', 'UnknownError');
            }
            return origGet.call(this, key);
          };
          let sc9Recovery;
          try {
            sc9Recovery = await coordM.loadSafe();
          } finally {
            IDBObjectStore.prototype.get = origGet;
          }
          return {
            sc7CommitKind: sc7Commit.kind,
            sc7Detail: sc7Commit.detail ?? null,
            markerStillThere,
            sc8Kind: sc8Recovery.kind,
            sc8Class: sc8Recovery.recoveryClassification ?? null,
            sc9Kind: sc9Recovery.kind,
            sc9Class: sc9Recovery.recoveryClassification ?? null,
          };
        })()`);

        // Second tab (separate realm!) MUST be blocked during Sc7/8/9, then recovers rev 4 & commits rev 5!
        const sc7SecondTab = await tabSecond.client.evalJson(`(async () => {
          const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
          const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
          const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
          const port = new portMod.BrowserFilePort(${JSON.stringify(nsM)});
          const coord = new coordMod.SingleWriterSaveCoordinator(port);
          const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r4.matrix', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
          const cand = coreMod.advanceOffline(s0, s0.cursorMs + 300000).state;
          const blockedBeforeRecover = await coord.commit(cand, '3');
          const recovered = await coord.loadSafe();
          const cand5 = coreMod.advanceOffline(recovered.raw, recovered.raw.cursorMs + 60000).state;
          const c5 = await coord.commit(cand5, recovered.revision);
          await port.clearAll();
          return {
            blockedBeforeRecoverKind: blockedBeforeRecover.kind,
            recoveredKind: recovered.kind,
            recoveredRev: recovered.revision ?? null,
            c5Kind: c5.kind,
            c5Rev: c5.revision ?? null,
          };
        })()`);

        report.rework04A02FaultCrashMatrix = { sc4, sc5And12, sc6And10And11, sc7_8_9, sc7SecondTab };
        assertCheck(
          'web_rework04_a02_marker_faults_and_crash_matrix',
          sc4.kind === 'STORAGE_UNAVAILABLE' &&
            sc4.slotWriteCalls === 0 &&
            sc4.slotsIdentical === true &&
            sc5And12.markerState === 'PENDING' &&
            sc5And12.blockedKind === 'STORAGE_UNAVAILABLE' &&
            sc5And12.otherLoadKind === 'EMPTY' &&
            sc5And12.otherCommitKind === 'COMMITTED' &&
            sc5And12.recoveredKind === 'VALID' &&
            sc5And12.recoveredRev === '1' &&
            sc5And12.markerAfter === null &&
            sc6And10And11.blockedKind === 'STORAGE_UNAVAILABLE' &&
            sc6And10And11.recoveredKind === 'VALID' &&
            sc6And10And11.recoveredRev === '2' &&
            sc6And10And11.staleConflictKind === 'CONFLICT' &&
            sc6And10And11.freshCommitKind === 'COMMITTED' &&
            sc6And10And11.freshCommitRev === '3' &&
            sc7_8_9.sc7CommitKind === 'UNCERTAIN' &&
            sc7_8_9.markerStillThere === true &&
            sc7_8_9.sc8Kind === 'STORAGE_UNAVAILABLE' &&
            sc7_8_9.sc8Class === 'PARTIAL_IO_UNAVAILABLE' &&
            sc7_8_9.sc9Kind === 'STORAGE_UNAVAILABLE' &&
            sc7_8_9.sc9Class === 'TX_STATE_UNREADABLE' &&
            sc7SecondTab.blockedBeforeRecoverKind === 'STORAGE_UNAVAILABLE' &&
            sc7SecondTab.recoveredKind === 'VALID' &&
            sc7SecondTab.recoveredRev === '4' &&
            sc7SecondTab.c5Kind === 'COMMITTED' &&
            sc7SecondTab.c5Rev === '5',
          JSON.stringify(report.rework04A02FaultCrashMatrix)
        );
      } finally {
        tabSecond.client.close();
        try { await cdp.send('Target.closeTarget', { targetId: tabSecond.targetId }); } catch {}
      }
    } finally {
      tabObserver.client.close();
      try { await cdp.send('Target.closeTarget', { targetId: tabObserver.targetId }); } catch {}
      if (tabCrash1) {
        tabCrash1.client.close();
        try { await cdp.send('Target.closeTarget', { targetId: tabCrash1.targetId }); } catch {}
      }
      if (tabCrash2) {
        tabCrash2.client.close();
        try { await cdp.send('Target.closeTarget', { targetId: tabCrash2.targetId }); } catch {}
      }
      try { await cdp.send('Page.bringToFront'); } catch {}
    }
  }

  // =========================================================================
  // 3j. REWORK-04 P2 REAL CHROME INDEXEDDB UNAVAILABLE & LEGACY LOCALSTORAGE POLICY
  //     - IndexedDB available + legacy localStorage save present:
  //       does NOT resurrect, does NOT overwrite/delete, explicitly reports DETECTED_IGNORED_NO_AUTO_MIGRATION
  //     - IndexedDB unavailable (window.indexedDB = undefined) + legacy localStorage save present:
  //       strictly fails closed (STORAGE_UNAVAILABLE, persistenceHalted=true), 0 localStorage writes,
  //       does NOT resurrect or delete legacy save, and NEVER misclassifies Chrome as Node even with opt-in!
  // =========================================================================
  {
    const appNs = 'idle_fishing_lifecycle_persist_fs';
    const legacyKey = `${appNs}:save_slot_0.json`;
    const legacyEnv = await cdp.evalJson(`(async () => {
      const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
      await (${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)});
      const s0 = coreMod.createInitialState({ saveEpoch: 'fe000-legacy-ls', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
      const s1 = coreMod.advanceOffline(s0, s0.cursorMs + 300000).state;
      // Seed legacy localStorage slot directly (simulating pre-IDB experimental localStorage save)
      const saveMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      void saveMod;
      const tmpPort = new (await System.import('chunks:///_virtual/BrowserFilePort.ts')).BrowserFilePort('tmp_legacy_gen_' + Date.now());
      const tmpCoord = new (await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts')).SingleWriterSaveCoordinator(tmpPort);
      await tmpCoord.commit(s1, null);
      const envText = await tmpPort.read('save_slot_0.json');
      await tmpPort.clearAll();
      localStorage.setItem(${JSON.stringify(legacyKey)}, envText);
      return envText;
    })()`);

    // Subcase A: IndexedDB available -> BootEntry ignores legacy localStorage, reports detected, preserves untouched
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'P2 IDB-on reload');
    await new Promise((r) => setTimeout(r, 350));
    const p2IdbOn = await cdp.evalJson(`(async () => {
      const bootRec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
      const lsAfterBoot = localStorage.getItem(${JSON.stringify(legacyKey)});
      return { bootRec, lsIntact: lsAfterBoot === ${JSON.stringify(legacyEnv)} };
    })()`);

    // Subcase B: IndexedDB disabled (`window.indexedDB = undefined`) -> fail-closed STORAGE_UNAVAILABLE,
    // ZERO localStorage writes, legacy save NOT resurrected & NOT deleted, opt-in ignored in real Chrome!
    const { identifier: disableIdbScriptId } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });`,
    });
    let p2IdbOff = null;
    try {
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'P2 IDB-off reload');
      await new Promise((r) => setTimeout(r, 350));
      p2IdbOff = await cdp.evalJson(`(async () => {
        const lsKeysBefore = Object.keys(localStorage).sort();
        const bootRec = globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence;
        // Normal HIDE must NOT fall back to localStorage
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        const afterHide = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));

        // Even with allowLocalStorageMockInNode: true, real Chrome MUST NOT be misclassified as Node!
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const optInPort = new portMod.BrowserFilePort('r4_chrome_optin_blocked', undefined, { allowLocalStorageMockInNode: true });
        const optInCoord = new coordMod.SingleWriterSaveCoordinator(optInPort);
        const optInProbe = await optInPort.probeStorage();
        const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r4.no_idb', startMs: 1700000000000, allowanceMs: 3600000 });
        const optInCommit = await optInCoord.commit(s0, null);
        const lsKeysAfter = Object.keys(localStorage).sort();
        const lsIntact = localStorage.getItem(${JSON.stringify(legacyKey)}) === ${JSON.stringify(legacyEnv)};
        return {
          isNodeHost: portMod.isNodeTestHost(),
          bootRec,
          afterHide: { last: afterHide.lastCommitKind, count: afterHide.hideCommitCount, halted: afterHide.persistenceHalted },
          optInPortKind: optInPort.kind,
          optInProbeAvailable: optInProbe.available,
          optInCommitKind: optInCommit.kind,
          lsKeysIdentical: JSON.stringify(lsKeysBefore) === JSON.stringify(lsKeysAfter),
          lsIntact,
        };
      })()`);
    } finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: disableIdbScriptId });
    }
    // Restore clean page & remove legacy localStorage key
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'P2 restore reload');
    await cdp.evalJson(`localStorage.removeItem(${JSON.stringify(legacyKey)})`);
    await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);

    report.rework04P2IdbAndLegacy = { p2IdbOn, p2IdbOff };
    assertCheck(
      'web_rework04_p2_idb_unavailable_and_legacy_localstorage',
      p2IdbOn.bootRec?.loadStatus === 'EMPTY' &&
        p2IdbOn.bootRec?.legacyExperimentalSave?.detected === true &&
        p2IdbOn.bootRec?.legacyExperimentalSave?.policy === 'DETECTED_IGNORED_NO_AUTO_MIGRATION' &&
        p2IdbOn.lsIntact === true &&
        p2IdbOff.isNodeHost === false &&
        p2IdbOff.bootRec?.loadStatus === 'STORAGE_UNAVAILABLE' &&
        p2IdbOff.bootRec?.persistenceHalted === true &&
        p2IdbOff.bootRec?.restoredOnBoot === false &&
        p2IdbOff.bootRec?.legacyExperimentalSave?.detected === true &&
        p2IdbOff.bootRec?.legacyExperimentalSave?.policy === 'DETECTED_IGNORED_NO_AUTO_MIGRATION' &&
        p2IdbOff.afterHide?.count === 0 &&
        p2IdbOff.optInPortKind === 'BROWSER_STORAGE_UNAVAILABLE' &&
        p2IdbOff.optInProbeAvailable === false &&
        p2IdbOff.optInCommitKind === 'STORAGE_UNAVAILABLE' &&
        p2IdbOff.lsKeysIdentical === true &&
        p2IdbOff.lsIntact === true,
      JSON.stringify({
        idbOnStatus: p2IdbOn.bootRec?.loadStatus,
        idbOnLegacy: p2IdbOn.bootRec?.legacyExperimentalSave?.policy,
        idbOffStatus: p2IdbOff.bootRec?.loadStatus,
        idbOffLegacy: p2IdbOff.bootRec?.legacyExperimentalSave?.policy,
        isNodeHost: p2IdbOff.isNodeHost,
        optInPortKind: p2IdbOff.optInPortKind,
        optInCommitKind: p2IdbOff.optInCommitKind,
        lsKeysIdentical: p2IdbOff.lsKeysIdentical,
        lsIntact: p2IdbOff.lsIntact,
      })
    );
  }

  // =========================================================================
  // 3k. REWORK-05 REV4-01 & REV4-03 REAL CHROME SAVE RECOVERY SAFETY MATRIX
  //     - Prior rev 1 + PENDING + all slots deleted -> SAVE_DISAPPEARED_PENDING_RECOVERY (stays frozen)
  //     - Partial IO FROZEN marker (preserving backup rev 2) + all slots deleted -> stays frozen
  //     - Unknown prior history (legacy expectedRevision=null) + EMPTY -> stays frozen
  //     - Confirmed initial create (CONFIRMED_EMPTY_INITIAL_CREATE) + EMPTY -> safely recovers EMPTY
  //     - Valid rev 1 < confirmed historical rev 2 -> REVISION_REGRESSION_PENDING_RECOVERY (stays frozen)
  //     - Corrupt marker + EMPTY -> TX_STATE_CORRUPT, canConfirmRecovery=false, confirm REJECTED
  //     - Corrupt marker + VALID rev 1 -> TX_STATE_CORRUPT, concurrent mutation REJECTED, fresh confirm succeeds
  //     - Marker read IO error -> TX_STATE_UNREADABLE, controlled recovery REJECTED
  // =========================================================================
  {
    const r5Safety = await cdp.evalJson(`(async () => {
      const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
      const faultMod = await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
      const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
      const idb = ${IDB_HELPERS_EXPR};
      const START = 1700000000000;
      const s0 = coreMod.createInitialState({ saveEpoch: 'epoch.r5.web.safety', startMs: START, allowanceMs: 8 * 3600000 });
      const s1 = coreMod.advanceOffline(s0, START + 60000).state;
      const s2 = coreMod.advanceOffline(s1, START + 120000).state;
      const s3 = coreMod.advanceOffline(s2, START + 180000).state;
      const ts = Date.now();

      // 1. Prior rev 1 + PENDING(expectedRevision='1') + all 3 slots deleted -> MUST stay frozen!
      const ns1 = 'r5_lost_valid_' + ts;
      const p1 = new portMod.BrowserFilePort(ns1);
      const c1 = new coordMod.SingleWriterSaveCoordinator(p1);
      await c1.commit(s1, null);
      await idb.writeTxState(ns1, JSON.stringify({
        version: 1, storageKey: p1.storageKey, txId: 'tx_lost_1', state: 'PENDING',
        expectedRevision: '1', targetRevision: '2', createdAtMs: START, updatedAtMs: START, reason: 'lost slots'
      }));
      for (let i = 0; i < 3; i++) await idb.deleteSlot(ns1, i);
      const resLost = await c1.loadSafe();
      const markerLostAfter = Boolean(await idb.readTxState(ns1));
      await p1.clearAll();

      // 2. Partial IO FROZEN marker preserving backup rev=2 + all slots deleted -> MUST stay frozen!
      const ns2 = 'r5_frozen_backup_lost_' + ts;
      const p2 = new portMod.BrowserFilePort(ns2);
      const f2 = new faultMod.FaultInjectingFilePort(p2);
      const c2 = new coordMod.SingleWriterSaveCoordinator(f2);
      await c2.commit(s1, null);
      await c2.commit(s2, '1');
      await c2.commit(s3, '2');
      f2.setReadFault(coreMod.SLOT_PATHS[2], true);
      const partialRes = await c2.loadSafe();
      f2.setReadFault(coreMod.SLOT_PATHS[2], false);
      const frozenMarkerObj = JSON.parse(await idb.readTxState(ns2));
      for (let i = 0; i < 3; i++) await idb.deleteSlot(ns2, i);
      const resFrozenLost = await c2.loadSafe();
      const frozenMarkerStill = Boolean(await idb.readTxState(ns2));
      await p2.clearAll();

      // 3. Unknown prior history (legacy expectedRevision=null) + EMPTY -> MUST stay frozen!
      const ns3 = 'r5_unknown_empty_' + ts;
      const p3 = new portMod.BrowserFilePort(ns3);
      const c3 = new coordMod.SingleWriterSaveCoordinator(p3);
      await idb.writeTxState(ns3, JSON.stringify({
        version: 1, storageKey: p3.storageKey, txId: 'tx_unknown_null', state: 'FROZEN',
        expectedRevision: null, targetRevision: null, createdAtMs: START, updatedAtMs: START, reason: 'unknown'
      }));
      const resUnknownEmpty = await c3.loadSafe();
      const unknownMarkerStill = Boolean(await idb.readTxState(ns3));
      await p3.clearAll();

      // 4. Confirmed initial create (CONFIRMED_EMPTY_INITIAL_CREATE) + EMPTY -> safely recovers EMPTY!
      const ns4 = 'r5_confirmed_initial_' + ts;
      const p4 = new portMod.BrowserFilePort(ns4);
      const c4 = new coordMod.SingleWriterSaveCoordinator(p4);
      await idb.writeTxState(ns4, JSON.stringify({
        version: 1, storageKey: p4.storageKey, txId: 'tx_init_create', state: 'PENDING',
        expectedRevision: null, targetRevision: '1', priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE',
        confirmedRevision: null, createdAtMs: START, updatedAtMs: START, reason: 'initial create'
      }));
      const resInitial = await c4.loadSafe();
      const initialMarkerAfter = await idb.readTxState(ns4);
      await p4.clearAll();

      // 5. Valid rev 1 < confirmed historical rev 2 -> REVISION_REGRESSION_PENDING_RECOVERY (stays frozen!)
      const ns5 = 'r5_rev_regression_' + ts;
      const p5 = new portMod.BrowserFilePort(ns5);
      const c5 = new coordMod.SingleWriterSaveCoordinator(p5);
      await c5.commit(s1, null);
      await c5.commit(s2, '1');
      await idb.writeTxState(ns5, JSON.stringify({
        version: 1, storageKey: p5.storageKey, txId: 'tx_rev2_reg', state: 'PENDING',
        expectedRevision: '2', targetRevision: '3', priorSaveHistory: 'CONFIRMED_VALID',
        confirmedRevision: '2', createdAtMs: START, updatedAtMs: START, reason: 'rev 2 commit'
      }));
      await idb.deleteSlot(ns5, 1); // delete rev 2 slot leaving rev 1
      const resReg = await c5.loadSafe();
      const regMarkerStill = Boolean(await idb.readTxState(ns5));
      await p5.clearAll();

      // 6 & 7 & 8. Corrupt marker + EMPTY (rejected), Corrupt marker + VALID (concurrent rejected -> confirm succeeds), Read IO error (rejected)
      const ns6 = 'r5_corrupt_ctrl_' + ts;
      const p6 = new portMod.BrowserFilePort(ns6);
      const f6 = new faultMod.FaultInjectingFilePort(p6);
      const c6 = new coordMod.SingleWriterSaveCoordinator(f6);
      await idb.writeTxState(ns6, '{corrupt-empty-disk');
      const corrEmptyLoad = await c6.loadSafe();
      const corrEmptyConfirm = await c6.recoverFromCorruptTxMarker({
        expectedCorruptMarkerSha256: corrEmptyLoad.corruptMarkerRecoveryPreview.corruptMarkerSha256,
        expectedValidRevision: '1',
        expectedSlotsSnapshotSha256: '0'.repeat(64),
      });
      await p6.clearTxState();
      await c6.loadSafe();
      await c6.commit(s1, null);
      const slot0Before = await p6.read(coreMod.SLOT_PATHS[0]);
      await idb.writeTxState(ns6, '{corrupt-valid-v1');
      const corrValidLoad1 = await c6.loadSafe();
      // Mutate corrupt marker between preview & confirm -> CONCURRENT_RECOVERY_STATE_CHANGED!
      await idb.writeTxState(ns6, '{corrupt-valid-v2');
      const corrStaleConfirm = await c6.recoverFromCorruptTxMarker({
        expectedCorruptMarkerSha256: corrValidLoad1.corruptMarkerRecoveryPreview.corruptMarkerSha256,
        expectedValidRevision: corrValidLoad1.corruptMarkerRecoveryPreview.verifiedRevision,
        expectedSlotsSnapshotSha256: corrValidLoad1.corruptMarkerRecoveryPreview.slotsSnapshotSha256,
      });
      // Re-preview & confirm cleanly -> recovers VALID rev 1, slot0 untouched!
      const corrValidLoad2 = await c6.loadSafe();
      const corrOkConfirm = await c6.recoverFromCorruptTxMarker({
        expectedCorruptMarkerSha256: corrValidLoad2.corruptMarkerRecoveryPreview.corruptMarkerSha256,
        expectedValidRevision: corrValidLoad2.corruptMarkerRecoveryPreview.verifiedRevision,
        expectedSlotsSnapshotSha256: corrValidLoad2.corruptMarkerRecoveryPreview.slotsSnapshotSha256,
      });
      const slot0After = await p6.read(coreMod.SLOT_PATHS[0]);
      // Marker read IO failure -> TX_STATE_UNREADABLE & controlled confirm rejected!
      f6.setTxMarkerFault('READ', true);
      const readIoLoad = await c6.loadSafe();
      const readIoConfirm = await c6.recoverFromCorruptTxMarker({
        expectedCorruptMarkerSha256: '0'.repeat(64),
        expectedValidRevision: '1',
        expectedSlotsSnapshotSha256: '0'.repeat(64),
      });
      f6.setTxMarkerFault('READ', false);
      await p6.clearAll();

      return {
        resLost: { kind: resLost.kind, cls: resLost.recoveryClassification, markerLostAfter },
        resFrozenLost: {
          partialCls: partialRes.recoveryClassification,
          frozenConfirmedRev: frozenMarkerObj.confirmedRevision,
          kind: resFrozenLost.kind,
          cls: resFrozenLost.recoveryClassification,
          frozenMarkerStill,
        },
        resUnknownEmpty: { kind: resUnknownEmpty.kind, cls: resUnknownEmpty.recoveryClassification, unknownMarkerStill },
        resInitial: { kind: resInitial.kind, initialMarkerAfter },
        resReg: { kind: resReg.kind, cls: resReg.recoveryClassification, backupRev: resReg.readOnlyBackup?.revision ?? null, regMarkerStill },
        corrupt: {
          emptyCls: corrEmptyLoad.recoveryClassification,
          emptyCanConfirm: corrEmptyLoad.corruptMarkerRecoveryPreview?.canConfirmRecovery ?? null,
          emptyConfirmCls: corrEmptyConfirm.recoveryClassification,
          staleConfirmCls: corrStaleConfirm.recoveryClassification,
          okKind: corrOkConfirm.kind,
          okRev: corrOkConfirm.kind === 'VALID' ? corrOkConfirm.revision : null,
          slot0Preserved: slot0Before === slot0After,
          readIoLoadCls: readIoLoad.recoveryClassification,
          readIoConfirmCls: readIoConfirm.recoveryClassification,
        },
      };
    })()`);

    report.rework05Rev401And03Safety = r5Safety;
    assertCheck(
      'web_rework05_rev4_01_03_recovery_safety_matrix',
      r5Safety.resLost.kind === 'STORAGE_UNAVAILABLE' &&
        r5Safety.resLost.cls === 'SAVE_DISAPPEARED_PENDING_RECOVERY' &&
        r5Safety.resLost.markerLostAfter === true &&
        r5Safety.resFrozenLost.partialCls === 'PARTIAL_IO_UNAVAILABLE' &&
        r5Safety.resFrozenLost.frozenConfirmedRev === '3' &&
        r5Safety.resFrozenLost.kind === 'STORAGE_UNAVAILABLE' &&
        r5Safety.resFrozenLost.cls === 'SAVE_DISAPPEARED_PENDING_RECOVERY' &&
        r5Safety.resFrozenLost.frozenMarkerStill === true &&
        r5Safety.resUnknownEmpty.kind === 'STORAGE_UNAVAILABLE' &&
        r5Safety.resUnknownEmpty.cls === 'SAVE_DISAPPEARED_PENDING_RECOVERY' &&
        r5Safety.resUnknownEmpty.unknownMarkerStill === true &&
        r5Safety.resInitial.kind === 'EMPTY' &&
        r5Safety.resInitial.initialMarkerAfter === null &&
        r5Safety.resReg.kind === 'STORAGE_UNAVAILABLE' &&
        r5Safety.resReg.cls === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
        r5Safety.resReg.backupRev === '1' &&
        r5Safety.resReg.regMarkerStill === true &&
        r5Safety.corrupt.emptyCls === 'TX_STATE_CORRUPT' &&
        r5Safety.corrupt.emptyCanConfirm === false &&
        r5Safety.corrupt.emptyConfirmCls === 'CORRUPT_MARKER_NO_VALID_SAVE' &&
        r5Safety.corrupt.staleConfirmCls === 'CONCURRENT_RECOVERY_STATE_CHANGED' &&
        r5Safety.corrupt.okKind === 'VALID' &&
        r5Safety.corrupt.okRev === '1' &&
        r5Safety.corrupt.slot0Preserved === true &&
        r5Safety.corrupt.readIoLoadCls === 'TX_STATE_UNREADABLE' &&
        r5Safety.corrupt.readIoConfirmCls === 'TX_STATE_UNREADABLE',
      JSON.stringify(r5Safety)
    );
  }

  // =========================================================================
  // 3l. REWORK-05 REV4-02 & REV4-04 REAL CHROME APPLICATION-LEVEL UI RECOVERY LOOP
  //     Strictly exercises the REAL Spike UI buttons (`BtnRecoverStorage`) via real CDP pointer clicks!
  //     Covers:
  //     1. Normal HIDE -> UNCERTAIN -> StorageRecoveryOverlay visible (+ screenshot!)
  //     2. Page.reload() -> stays frozen (PENDING_RECOVERY_REQUIRED) & overlay visible
  //     3. Recovery while storage still failing -> stays frozen & displays failure reason
  //     4. Fault cleared -> user clicks real BtnRecoverStorage -> recovers VALID rev 1 & overlay hides
  //     5. Normal HIDE after UI recovery -> COMMITTED rev 2
  //     6. Cross-tab recovery + stale memory guard: Tab A halted at rev 2, Tab B recovers via UI & commits rev 3 ->
  //        Tab A clicks BtnRecoverStorage -> loads rev 3 (Tab B's gold!) -> next HIDE commits rev 4
  //     7. Duplicate rapid clicks (3x) + SHOW/HIDE interleaving during in-flight recovery -> deduped & serialized cleanly -> rev 5
  //     8. Destroy BootEntry during in-flight recovery -> stays destroyed, never reactivated, 0 subsequent writes
  //     9. REV4-04 QUOTA failure -> conservative freeze -> space freed -> real UI BtnRecoverStorage recovers -> rev 6
  // =========================================================================
  {
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

    await cdp.send('Page.bringToFront');
    await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 UI clean boot');
    await new Promise((r) => setTimeout(r, 350));

    // Step 1: Seed rev 1 via normal HIDE, then trigger UNCERTAIN via normal HIDE -> overlay visible!
    const seed1 = await cdp.evalJson(`(async () => {
      const fire = (st) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      fire('hidden'); fire('visible');
      return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    })()`);

    const unc1 = await cdp.evalJson(`(async () => {
      const origPut = IDBObjectStore.prototype.put;
      const origGet = IDBObjectStore.prototype.get;
      let afterSlotWrite = false;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').includes(':save_slot_')) {
          afterSlotWrite = true;
          throw new DOMException('R5 UI UNCERTAIN slot write fail', 'QuotaExceededError');
        }
        return origPut.call(this, val, key);
      };
      IDBObjectStore.prototype.get = function(key) {
        if (afterSlotWrite && String(key || '').includes(':save_slot_')) {
          throw new DOMException('R5 UI UNCERTAIN slot read fail', 'UnknownError');
        }
        return origGet.call(this, key);
      };
      const fire = (st) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      try {
        fire('hidden'); fire('visible');
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        return globalThis.__SPIKE_HARNESS__.getSnapshot();
      } finally {
        IDBObjectStore.prototype.put = origPut;
        IDBObjectStore.prototype.get = origGet;
      }
    })()`);

    // Step 2: Reload -> MUST stay frozen with StorageRecoveryOverlay visible!
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 UI reload frozen');
    await new Promise((r) => setTimeout(r, 350));
    const afterReloadFrozen = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
    const recoveryPng = path.join(evidenceDir, 'r5-recovery-overlay.png');
    await cdp.screenshot(recoveryPng);
    report.screenshots.push(path.relative(repoRoot, recoveryPng).replace(/\\/g, '/'));

    // Step 3: Storage still unavailable (probe fails) -> user clicks REAL BtnRecoverStorage -> stays frozen!
    await cdp.evalJson(`(() => {
      globalThis.__R5_ORIG_PUT__ = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').endsWith(':__probe__')) {
          throw new DOMException('R5 storage still unavailable on retry', 'QuotaExceededError');
        }
        return globalThis.__R5_ORIG_PUT__.call(this, val, key);
      };
    })()`);
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await new Promise((r) => setTimeout(r, 150));
    const failedUiRecovery = await cdp.evalJson(`(async () => {
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      IDBObjectStore.prototype.put = globalThis.__R5_ORIG_PUT__;
      return globalThis.__SPIKE_HARNESS__.getSnapshot();
    })()`);

    // Step 4: Fault cleared -> user clicks REAL BtnRecoverStorage -> recovers VALID rev 1 & overlay hides!
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await new Promise((r) => setTimeout(r, 150));
    const okUiRecovery1 = await cdp.evalJson(`(async () => {
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      return globalThis.__SPIKE_HARNESS__.getSnapshot();
    })()`);

    // Step 5: Normal HIDE after UI recovery -> COMMITTED rev 2!
    const hideAfterUiRec1 = await cdp.evalJson(`(async () => {
      const fire = (st) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
        document.dispatchEvent(new Event('visibilitychange'));
      };
      fire('hidden'); fire('visible');
      return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    })()`);

    // Step 6: Cross-tab UI recovery & stale memory guard (Tab A frozen at rev 2; Tab B recovers via UI & commits rev 3 -> Tab A recovers rev 3 via UI -> commits rev 4!)
    const { targetId: tabBUiTid } = await cdp.send('Target.createTarget', { url: baseUrl });
    let cdpBUi = null;
    let crossTabUiRes = null;
    try {
      const tabBInfo = await waitUntil(async () => {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const list = await r.json();
        return list.find((t) => t.id === tabBUiTid && t.webSocketDebuggerUrl) || null;
      }, 15000, 'R5 Tab B UI');
      cdpBUi = new CdpClient(tabBInfo.webSocketDebuggerUrl);
      await cdpBUi.waitOpen();
      await cdpBUi.send('Page.enable');
      await cdpBUi.send('Runtime.enable');
      await cdpBUi.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await waitUntil(() => cdpBUi.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 Tab B UI ready');
      await new Promise((r) => setTimeout(r, 300));

      // Let any automatic Chrome tab-switch visibilitychange settle on Tab A, then sync Tab B via reload
      const tabASettled = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()`);
      await cdpBUi.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdpBUi.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 Tab B synced reload');
      await new Promise((r) => setTimeout(r, 300));
      const baseCrossRev = Number(tabASettled.revision);

      // Tab A gets UNCERTAIN on HIDE (do NOT bring Tab A to front so Tab B does not receive an unintended browser HIDE)
      const tabAUncRes = await cdp.evalJson(`(async () => {
        const origPut = IDBObjectStore.prototype.put;
        const origGet = IDBObjectStore.prototype.get;
        let afterW = false;
        IDBObjectStore.prototype.put = function(val, key) {
          if (String(key || '').includes(':save_slot_')) { afterW = true; throw new DOMException('TabA cross-tab UNCERTAIN', 'QuotaExceededError'); }
          return origPut.call(this, val, key);
        };
        IDBObjectStore.prototype.get = function(key) {
          if (afterW && String(key || '').includes(':save_slot_')) throw new DOMException('TabA cross-tab read fail', 'UnknownError');
          return origGet.call(this, key);
        };
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        try {
          fire('visible');
          fire('hidden');
          fire('visible');
          return await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        }
        finally { IDBObjectStore.prototype.put = origPut; IDBObjectStore.prototype.get = origGet; }
      })()`);

      // Tab B (already in foreground) normal HIDE -> STORAGE_UNAVAILABLE & overlay visible -> Tab B clicks REAL BtnRecoverStorage -> Tab B HIDE commits baseCrossRev+1!
      const tabBHalted = await cdpBUi.evalJson(`(async () => {
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('visible');
        fire('hidden');
        fire('visible');
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        return globalThis.__SPIKE_HARNESS__.getSnapshot();
      })()`);
      await clickUiBtn(cdpBUi, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 150));
      const tabBCommittedNext = await cdpBUi.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('visible');
        fire('hidden');
        fire('visible');
        return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      })()`);

      // Now Tab A (which was halted at baseCrossRev!) clicks REAL BtnRecoverStorage -> MUST reload baseCrossRev+1 & Tab B's gold -> next HIDE commits baseCrossRev+2!
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 150));
      const tabARecoveredNext = await cdp.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        return globalThis.__SPIKE_HARNESS__.getSnapshot();
      })()`);
      const tabACommittedAfter = await cdp.evalJson(`(async () => {
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('visible');
        fire('hidden');
        fire('visible');
        return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      })()`);
      crossTabUiRes = {
        baseCrossRev: String(baseCrossRev),
        tabAUncKind: tabAUncRes.lastCommitKind,
        tabBHaltedOverlay: tabBHalted.recoveryOverlayVisible,
        tabBCommittedRev: tabBCommittedNext.revision,
        tabBCommittedGold: tabBCommittedNext.gold,
        tabARecoveredRev: tabARecoveredNext.lifecyclePersistence.revision,
        tabARecoveredGold: tabARecoveredNext.lifecyclePersistence.gold,
        tabACommittedRev: tabACommittedAfter.revision,
      };
    } finally {
      cdpBUi?.close();
      try { await cdp.send('Target.closeTarget', { targetId: tabBUiTid }); } catch {}
      await cdp.send('Page.bringToFront');
    }

    // Step 7: Duplicate rapid clicks (3x) + SHOW/HIDE interleaving during in-flight recovery!
    // Freeze Tab A again (UNCERTAIN), pause inside loadSafe, click BtnRecoverStorage 3x, dispatch SHOW & HIDE, release!
    await cdp.evalJson(`(async () => {
      const origPut = IDBObjectStore.prototype.put;
      const origGet = IDBObjectStore.prototype.get;
      let afterW = false;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').includes(':save_slot_')) { afterW = true; throw new DOMException('R5 dup-click UNCERTAIN', 'QuotaExceededError'); }
        return origPut.call(this, val, key);
      };
      IDBObjectStore.prototype.get = function(key) {
        if (afterW && String(key || '').includes(':save_slot_')) throw new DOMException('R5 dup-click read fail', 'UnknownError');
        return origGet.call(this, key);
      };
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      try { fire('hidden'); fire('visible'); await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); }
      finally { IDBObjectStore.prototype.put = origPut; IDBObjectStore.prototype.get = origGet; }

      const mod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const proto = mod.SingleWriterSaveCoordinator.prototype;
      globalThis.__R5_ORIG_LOAD__ = proto.loadSafe;
      globalThis.__R5_LOAD_CALLS__ = 0;
      globalThis.__R5_LOAD_ENTERED__ = false;
      globalThis.__R5_LOAD_REL__ = null;
      proto.loadSafe = function(...args) {
        globalThis.__R5_LOAD_CALLS__ += 1;
        globalThis.__R5_LOAD_ENTERED__ = true;
        const self = this;
        return new Promise((res, rej) => {
          globalThis.__R5_LOAD_REL__ = () => {
            proto.loadSafe = globalThis.__R5_ORIG_LOAD__;
            globalThis.__R5_ORIG_LOAD__.apply(self, args).then(res, rej);
          };
        });
      };
    })()`);

    const recBtnCoord = await clickUiBtn(cdp, 'BtnRecoverStorage');
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__R5_LOAD_ENTERED__)`), 10000, 'R5 recovery entered');
    // 2 extra rapid clicks while recovery is in-flight + SHOW + HIDE interleaving!
    await cdp.click(recBtnCoord.x, recBtnCoord.y);
    await cdp.click(recBtnCoord.x, recBtnCoord.y);
    const interleaveMid = await cdp.evalJson(`(() => {
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      fire('visible'); // SHOW during recovery must not unfreeze
      fire('hidden');  // HIDE queued strictly behind recovery
      fire('visible');
      const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
      return {
        loadCalls: globalThis.__R5_LOAD_CALLS__,
        dupIgnored: snap.lifecyclePersistence.recoveryDuplicateClicksIgnored,
        haltedMid: snap.lifecyclePersistence.persistenceHalted,
        inProgressMid: snap.lifecyclePersistence.recoveryInProgress,
      };
    })()`);
    await cdp.evalJson(`globalThis.__R5_LOAD_REL__()`);
    const interleaveDone = await cdp.evalJson(`(async () => {
      const rec = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      return {
        loadCalls: globalThis.__R5_LOAD_CALLS__,
        rev: rec.revision,
        halted: rec.persistenceHalted,
        lastCommitKind: rec.lastCommitKind,
      };
    })()`);

    // Step 8: Destroy BootEntry during in-flight recovery -> stays destroyed, NEVER reactivated, 0 subsequent writes!
    await cdp.evalJson(`(async () => {
      const origPut = IDBObjectStore.prototype.put;
      const origGet = IDBObjectStore.prototype.get;
      let afterW = false;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').includes(':save_slot_')) { afterW = true; throw new DOMException('R5 destroy-mid-rec UNCERTAIN', 'QuotaExceededError'); }
        return origPut.call(this, val, key);
      };
      IDBObjectStore.prototype.get = function(key) {
        if (afterW && String(key || '').includes(':save_slot_')) throw new DOMException('R5 destroy-mid-rec read fail', 'UnknownError');
        return origGet.call(this, key);
      };
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      try { fire('hidden'); fire('visible'); await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave(); }
      finally { IDBObjectStore.prototype.put = origPut; IDBObjectStore.prototype.get = origGet; }

      const mod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
      const proto = mod.SingleWriterSaveCoordinator.prototype;
      globalThis.__R5_ORIG_LOAD2__ = proto.loadSafe;
      globalThis.__R5_LOAD2_ENTERED__ = false;
      globalThis.__R5_LOAD2_REL__ = null;
      proto.loadSafe = function(...args) {
        globalThis.__R5_LOAD2_ENTERED__ = true;
        const self = this;
        return new Promise((res, rej) => {
          globalThis.__R5_LOAD2_REL__ = () => {
            proto.loadSafe = globalThis.__R5_ORIG_LOAD2__;
            globalThis.__R5_ORIG_LOAD2__.apply(self, args).then(res, rej);
          };
        });
      };
    })()`);
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__R5_LOAD2_ENTERED__)`), 10000, 'R5 destroy-mid-rec entered');
    const destroyMidRec = await cdp.evalJson(`(async () => {
      const idb = ${IDB_HELPERS_EXPR};
      const slotsBefore = await idb.readSlots(${JSON.stringify(appNs)});
      const markerBefore = await idb.readTxState(${JSON.stringify(appNs)});
      const boot = globalThis.cc.director.getScene().getComponentInChildren('BootEntry');
      boot.destroy();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      globalThis.__R5_LOAD2_REL__();
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const snapAfter = globalThis.__SPIKE_HARNESS__.getSnapshot();
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      fire('hidden'); fire('visible');
      await new Promise((r) => setTimeout(r, 250));
      const slotsAfter = await idb.readSlots(${JSON.stringify(appNs)});
      const markerAfter = await idb.readTxState(${JSON.stringify(appNs)});
      return {
        destroyed: snapAfter.destroyed,
        lastRecoveryOutcome: snapAfter.lifecyclePersistence.lastRecoveryOutcome,
        haltedAfter: snapAfter.lifecyclePersistence.persistenceHalted,
        slotsIdentical: JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter),
        markerStillIntact: Boolean(markerBefore) && markerAfter === markerBefore,
      };
    })()`);

    // Step 9: Reload after Step 8 -> Step 8's UNCERTAIN marker is STILL intact (R5-03!), so explicitly
    // recover it via real UI BtnRecoverStorage first, then run REV4-04 QUOTA failure -> recovery -> HIDE!
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 quota boot');
    await new Promise((r) => setTimeout(r, 300));
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await new Promise((r) => setTimeout(r, 150));
    await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()`);
    const quotaFailSnap = await cdp.evalJson(`(async () => {
      const origPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(val, key) {
        if (String(key || '').includes(':save_slot_')) {
          throw new DOMException('Simulated disk quota full', 'QuotaExceededError');
        }
        return origPut.call(this, val, key);
      };
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      try {
        fire('hidden'); fire('visible');
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const marker = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        return { snap: globalThis.__SPIKE_HARNESS__.getSnapshot(), markerState: marker ? JSON.parse(marker).state : null };
      } finally {
        IDBObjectStore.prototype.put = origPut;
      }
    })()`);
    // Space freed -> click REAL BtnRecoverStorage -> recovers rev 5 -> next HIDE commits rev 6!
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await new Promise((r) => setTimeout(r, 150));
    const quotaRecovered = await cdp.evalJson(`(async () => {
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const snapRec = globalThis.__SPIKE_HARNESS__.getSnapshot();
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      fire('hidden'); fire('visible');
      const committed = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      return {
        recRev: snapRec.lifecyclePersistence.revision,
        recHalted: snapRec.lifecyclePersistence.persistenceHalted,
        recOverlay: snapRec.recoveryOverlayVisible,
        nextKind: committed.lastCommitKind,
        nextRev: committed.revision,
      };
    })()`);

    report.rework05AppUiRecoveryLoop = {
      seed1Rev: seed1.revision,
      unc1Overlay: unc1.recoveryOverlayVisible,
      unc1Last: unc1.lifecyclePersistence.lastCommitKind,
      afterReloadFrozen: {
        status: afterReloadFrozen.lifecyclePersistence.loadStatus,
        cls: afterReloadFrozen.lifecyclePersistence.recoveryClassification,
        overlay: afterReloadFrozen.recoveryOverlayVisible,
      },
      failedUiRecovery: {
        halted: failedUiRecovery.lifecyclePersistence.persistenceHalted,
        outcome: failedUiRecovery.lifecyclePersistence.lastRecoveryOutcome,
        overlay: failedUiRecovery.recoveryOverlayVisible,
      },
      okUiRecovery1: {
        halted: okUiRecovery1.lifecyclePersistence.persistenceHalted,
        rev: okUiRecovery1.lifecyclePersistence.revision,
        outcome: okUiRecovery1.lifecyclePersistence.lastRecoveryOutcome,
        overlay: okUiRecovery1.recoveryOverlayVisible,
      },
      hideAfterUiRec1Rev: hideAfterUiRec1.revision,
      crossTabUiRes,
      interleaveMid,
      interleaveDone,
      destroyMidRec,
      quotaFail: {
        lastKind: quotaFailSnap.snap.lifecyclePersistence.lastCommitKind,
        halted: quotaFailSnap.snap.lifecyclePersistence.persistenceHalted,
        overlay: quotaFailSnap.snap.recoveryOverlayVisible,
        markerState: quotaFailSnap.markerState,
      },
      quotaRecovered,
    };

    const baseCrossNum = Number(crossTabUiRes.baseCrossRev);
    // R5-02 Option A: Recovering from write-failure freezes executes a safe zero-gain checkpoint commit (+1 rev).
    // Step 4 (recover from Step 1 quota-UNCERTAIN): rev 1 -> checkpoint rev 2 -> Step 5 HIDE commits rev 3!
    // Step 6 (Tab B recovers from Tab A quota-UNCERTAIN -> checkpoint base+1, Tab B HIDE -> base+2;
    //         Tab A recovers clean disk -> base+2, Tab A HIDE -> base+3)
    // Step 7 (recover from quota-UNCERTAIN -> checkpoint base+4, queued HIDE -> base+5)
    // Step 8 preserved UNCERTAIN marker on destroy -> Step 9 boot recovery checkpoint base+6
    // Step 9 (quota fail -> recover checkpoint base+7, next HIDE -> base+8)
    // 3m (corrupt marker confirm keeps rev base+8, next HIDE -> base+9)
    const expectedAfterTabB = String(baseCrossNum + 2);
    const expectedAfterTabA = String(baseCrossNum + 3);
    const expectedAfterInterleave = String(baseCrossNum + 5);
    const expectedAfterQuotaRec = String(baseCrossNum + 7);
    const expectedAfterQuota = String(baseCrossNum + 8);
    const expectedAfterCorruptConfirm = String(baseCrossNum + 9);

    assertCheck(
      'web_rework05_rev4_02_04_app_ui_recovery_loop',
      seed1.revision === '1' &&
        unc1.recoveryOverlayVisible === true &&
        unc1.lifecyclePersistence.lastCommitKind === 'UNCERTAIN' &&
        afterReloadFrozen.lifecyclePersistence.loadStatus === 'STORAGE_UNAVAILABLE' &&
        afterReloadFrozen.lifecyclePersistence.recoveryClassification === 'PENDING_RECOVERY_REQUIRED' &&
        afterReloadFrozen.recoveryOverlayVisible === true &&
        failedUiRecovery.lifecyclePersistence.persistenceHalted === true &&
        failedUiRecovery.lifecyclePersistence.lastRecoveryOutcome === 'FAILED' &&
        failedUiRecovery.recoveryOverlayVisible === true &&
        okUiRecovery1.lifecyclePersistence.persistenceHalted === false &&
        okUiRecovery1.lifecyclePersistence.revision === '2' &&
        okUiRecovery1.lifecyclePersistence.gold === seed1.gold &&
        okUiRecovery1.lifecyclePersistence.cursorMs === seed1.cursorMs &&
        okUiRecovery1.lifecyclePersistence.lastRecoveryOutcome === 'RECOVERED_VALID' &&
        okUiRecovery1.recoveryOverlayVisible === false &&
        hideAfterUiRec1.revision === '3' &&
        crossTabUiRes.tabAUncKind === 'UNCERTAIN' &&
        crossTabUiRes.tabBHaltedOverlay === true &&
        crossTabUiRes.tabBCommittedRev === expectedAfterTabB &&
        crossTabUiRes.tabARecoveredRev === expectedAfterTabB &&
        crossTabUiRes.tabARecoveredGold === crossTabUiRes.tabBCommittedGold &&
        crossTabUiRes.tabACommittedRev === expectedAfterTabA &&
        interleaveMid.loadCalls === 1 &&
        interleaveMid.dupIgnored >= 2 &&
        interleaveMid.haltedMid === true &&
        interleaveDone.loadCalls === 1 &&
        interleaveDone.rev === expectedAfterInterleave &&
        interleaveDone.halted === false &&
        interleaveDone.lastCommitKind === 'COMMITTED' &&
        destroyMidRec.destroyed === true &&
        destroyMidRec.lastRecoveryOutcome === 'CANCELLED_DESTROYED' &&
        destroyMidRec.haltedAfter === true &&
        destroyMidRec.slotsIdentical === true &&
        destroyMidRec.markerStillIntact === true &&
        quotaFailSnap.snap.lifecyclePersistence.lastCommitKind === 'STORAGE_UNAVAILABLE' &&
        quotaFailSnap.snap.lifecyclePersistence.persistenceHalted === true &&
        quotaFailSnap.snap.recoveryOverlayVisible === true &&
        quotaFailSnap.markerState === 'FROZEN' &&
        quotaRecovered.recRev === expectedAfterQuotaRec &&
        quotaRecovered.recHalted === false &&
        quotaRecovered.recOverlay === false &&
        quotaRecovered.nextKind === 'COMMITTED' &&
        quotaRecovered.nextRev === expectedAfterQuota,
      JSON.stringify(report.rework05AppUiRecoveryLoop)
    );

    // =========================================================================
    // 3m. REWORK-05 REV4-03 REAL CHROME APP UI CONTROLLED CORRUPT-MARKER CONFIRMATION
    //     - Corrupt tx marker + valid rev 6 save -> reload shows TX_STATE_CORRUPT & BtnConfirmCorruptMarkerRecovery
    //     - Clicking ordinary BtnRecoverStorage keeps frozen (does NOT auto-discard corrupt marker!)
    //     - Clicking separate BtnConfirmCorruptMarkerRecovery clears ONLY corrupt marker, recovers rev 6, next HIDE -> rev 7!
    // =========================================================================
    await cdp.evalJson(`(${IDB_HELPERS_EXPR}).writeTxState(${JSON.stringify(appNs)}, '{"version":1,"corrupt_truncated')`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 corrupt marker UI boot');
    await new Promise((r) => setTimeout(r, 350));
    const corruptBootSnap = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);

    // Ordinary recovery button MUST keep frozen (TX_STATE_CORRUPT)!
    await clickUiBtn(cdp, 'BtnRecoverStorage');
    await new Promise((r) => setTimeout(r, 150));
    const afterOrdinaryBtn = await cdp.evalJson(`(async () => {
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      return globalThis.__SPIKE_HARNESS__.getSnapshot();
    })()`);

    // Separate controlled confirm button recovers rev 6 & next HIDE commits rev 7!
    await clickUiBtn(cdp, 'BtnConfirmCorruptMarkerRecovery');
    await new Promise((r) => setTimeout(r, 150));
    const afterConfirmBtn = await cdp.evalJson(`(async () => {
      await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      const snapRec = globalThis.__SPIKE_HARNESS__.getSnapshot();
      const markerAfter = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
      const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
      fire('hidden'); fire('visible');
      const nextCommit = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      return {
        recRev: snapRec.lifecyclePersistence.revision,
        recHalted: snapRec.lifecyclePersistence.persistenceHalted,
        recOverlay: snapRec.recoveryOverlayVisible,
        markerAfter,
        nextKind: nextCommit.lastCommitKind,
        nextRev: nextCommit.revision,
      };
    })()`);

    // Clean app namespace & reload clean healthy EMPTY state before Step 4 UI clicks!
    await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'R5 clean boot before Step 4');
    await new Promise((r) => setTimeout(r, 350));

    report.rework05AppUiCorruptMarkerConfirm = {
      bootCls: corruptBootSnap.lifecyclePersistence.recoveryClassification,
      bootBackupRev: corruptBootSnap.lifecyclePersistence.readOnlyBackup?.revision ?? null,
      bootConfirmVisible: corruptBootSnap.corruptConfirmButtonVisible,
      afterOrdinaryHalted: afterOrdinaryBtn.lifecyclePersistence.persistenceHalted,
      afterOrdinaryCls: afterOrdinaryBtn.lifecyclePersistence.recoveryClassification,
      afterConfirmBtn,
    };

    assertCheck(
      'web_rework05_rev4_03_app_ui_corrupt_marker_confirm',
      corruptBootSnap.lifecyclePersistence.recoveryClassification === 'TX_STATE_CORRUPT' &&
        corruptBootSnap.lifecyclePersistence.readOnlyBackup?.revision === expectedAfterQuota &&
        corruptBootSnap.corruptConfirmButtonVisible === true &&
        afterOrdinaryBtn.lifecyclePersistence.persistenceHalted === true &&
        afterOrdinaryBtn.lifecyclePersistence.recoveryClassification === 'TX_STATE_CORRUPT' &&
        afterConfirmBtn.recRev === expectedAfterQuota &&
        afterConfirmBtn.recHalted === false &&
        afterConfirmBtn.recOverlay === false &&
        afterConfirmBtn.markerAfter === null &&
        afterConfirmBtn.nextKind === 'COMMITTED' &&
        afterConfirmBtn.nextRev === expectedAfterCorruptConfirm,
      JSON.stringify(report.rework05AppUiCorruptMarkerConfirm)
    );

    // =========================================================================
    // 3n. REWORK-06 R5-01 REAL CHROME MONOTONIC CONFIRMED REVISION FLOOR
  console.log('[Web E2E] Starting REWORK-06 R5-01/R5-02/R5-03 checks...');
    //     Astra R5-01 exact counterexample across: same coordinator, new coordinator,
    //     second Chrome tab, AND real Page.reload()!
    // =========================================================================
    {
      const nsR501 = `r6_r501_web_${Date.now()}`;
      const r501Phase1 = await cdp.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const faultMod = await System.import('chunks:///_virtual/FaultInjectingFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const idb = ${IDB_HELPERS_EXPR};
        const START = 1700000000000;
        const s = coreMod.createInitialState({ saveEpoch: 'epoch.r6.web.r501', startMs: START, allowanceMs: 8 * 3600000 });
        const t = coreMod.advanceOffline(s, START + 60000).state;
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsR501)});
        const fault = new faultMod.FaultInjectingFilePort(port);
        const coordA = new coordMod.SingleWriterSaveCoordinator(fault);

        const c1 = await coordA.commit(s, null);
        const c2 = await coordA.commit(t, '1');
        const confirmed2 = await coordA.loadSafe();

        // Hide highest slot (save_slot_1.json rev 2) -> FROZEN marker MUST retain confirmedRevision='2'!
        fault.setReadFault(coreMod.SLOT_PATHS[1], true);
        const partial = await coordA.loadSafe();
        fault.setReadFault(coreMod.SLOT_PATHS[1], false);
        const frozenMarker = JSON.parse(await idb.readTxState(${JSON.stringify(nsR501)}));

        // Highest slot vanishes -> same coord & new coord MUST reject rollback to rev 1 and refuse recommitting s as rev 2!
        await idb.deleteSlot(${JSON.stringify(nsR501)}, 1);
        const slotsBefore = await idb.readSlots(${JSON.stringify(nsR501)});
        const regSame = await coordA.loadSafe();
        const staleSame = await coordA.commit(s, '1');

        const coordNew = new coordMod.SingleWriterSaveCoordinator(new portMod.BrowserFilePort(${JSON.stringify(nsR501)}));
        const regNew = await coordNew.loadSafe();
        const staleNew = await coordNew.commit(s, '1');
        const slotsAfter = await idb.readSlots(${JSON.stringify(nsR501)});

        return {
          c1: c1.kind + '/' + c1.revision,
          c2: c2.kind + '/' + c2.revision,
          confirmed2: confirmed2.kind + '/' + confirmed2.revision,
          partialCls: partial.recoveryClassification ?? null,
          partialBackupRev: partial.readOnlyBackup?.revision ?? null,
          frozenConfirmedRev: frozenMarker.confirmedRevision,
          regSameCls: regSame.recoveryClassification ?? null,
          regSameBackupRev: regSame.readOnlyBackup?.revision ?? null,
          staleSameKind: staleSame.kind,
          regNewCls: regNew.recoveryClassification ?? null,
          staleNewKind: staleNew.kind,
          slotsUnchanged: JSON.stringify(slotsBefore) === JSON.stringify(slotsAfter),
        };
      })()`);

      // Verify in a SECOND Chrome tab (separate JS realm!)
      const { targetId: r501Tab2Id } = await cdp.send('Target.createTarget', { url: baseUrl });
      let cdpR501Tab2 = null;
      let r501Tab2Res = null;
      try {
        const t2Info = await waitUntil(async () => {
          const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          return (await r.json()).find((x) => x.id === r501Tab2Id && x.webSocketDebuggerUrl) || null;
        }, 15000, 'R5-01 Tab 2');
        cdpR501Tab2 = new CdpClient(t2Info.webSocketDebuggerUrl);
        await cdpR501Tab2.waitOpen();
        await cdpR501Tab2.send('Page.enable');
        await cdpR501Tab2.send('Runtime.enable');
        await waitUntil(() => cdpR501Tab2.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-01 Tab 2 ready');
        r501Tab2Res = await cdpR501Tab2.evalJson(`(async () => {
          const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
          const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
          const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
          const s = coreMod.createInitialState({ saveEpoch: 'epoch.r6.web.r501', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
          const coord = new coordMod.SingleWriterSaveCoordinator(new portMod.BrowserFilePort(${JSON.stringify(nsR501)}));
          const reg = await coord.loadSafe();
          const stale = await coord.commit(s, '1');
          return {
            regCls: reg.recoveryClassification ?? null,
            backupRev: reg.readOnlyBackup?.revision ?? null,
            staleKind: stale.kind,
          };
        })()`);
      } finally {
        cdpR501Tab2?.close();
        try { await cdp.send('Target.closeTarget', { targetId: r501Tab2Id }); } catch {}
        await cdp.send('Page.bringToFront');
      }

      // Verify after REAL Page.reload() (even if marker were cleared externally, persisted __save_history__ still holds floor!)
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-01 reload ready');
      const r501ReloadRes = await cdp.evalJson(`(async () => {
        const coordMod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const coreMod = await System.import('chunks:///_virtual/SharedCoreBridge.ts');
        const s = coreMod.createInitialState({ saveEpoch: 'epoch.r6.web.r501', startMs: 1700000000000, allowanceMs: 8 * 3600000 });
        const port = new portMod.BrowserFilePort(${JSON.stringify(nsR501)});
        const coord = new coordMod.SingleWriterSaveCoordinator(port);
        const reg = await coord.loadSafe();
        const stale = await coord.commit(s, '1');
        await port.clearAll();
        return {
          regCls: reg.recoveryClassification ?? null,
          backupRev: reg.readOnlyBackup?.revision ?? null,
          staleKind: stale.kind,
        };
      })()`);

      report.rework06R501MonotonicCrossTabReload = { r501Phase1, r501Tab2Res, r501ReloadRes };
      assertCheck(
        'web_rework06_r5_01_confirmed_revision_monotonic_cross_tab_reload',
        r501Phase1.c1 === 'COMMITTED/1' &&
          r501Phase1.c2 === 'COMMITTED/2' &&
          r501Phase1.confirmed2 === 'VALID/2' &&
          r501Phase1.partialCls === 'PARTIAL_IO_UNAVAILABLE' &&
          r501Phase1.partialBackupRev === '1' &&
          r501Phase1.frozenConfirmedRev === '2' &&
          r501Phase1.regSameCls === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
          r501Phase1.regSameBackupRev === '1' &&
          r501Phase1.staleSameKind === 'STORAGE_UNAVAILABLE' &&
          r501Phase1.regNewCls === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
          r501Phase1.staleNewKind === 'STORAGE_UNAVAILABLE' &&
          r501Phase1.slotsUnchanged === true &&
          r501Tab2Res?.regCls === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
          r501Tab2Res?.backupRev === '1' &&
          r501Tab2Res?.staleKind === 'STORAGE_UNAVAILABLE' &&
          r501ReloadRes.regCls === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
          r501ReloadRes.backupRev === '1' &&
          r501ReloadRes.staleKind === 'STORAGE_UNAVAILABLE',
        JSON.stringify(report.rework06R501MonotonicCrossTabReload)
      );
    }

    // =========================================================================
    // 3o. REWORK-06 R5-02 REAL CHROME APP UI PERSISTENT QUOTA RECOVERY LOOP
    //     Astra R5-02 exact counterexample:
    //     1. Persistent QUOTA on :save_slot_ puts (reads/probe/txState all succeed!)
    //     2. Click real UI BtnRecoverStorage while fault STILL enabled -> MUST stay frozen
    //        (WRITE_CAPABILITY_UNAVAILABLE, readOnlyBackup rev 1, overlay visible, marker intact!)
    //     3. Next HIDE while frozen -> SKIPPED_HALTED
    //     4. Disable quota fault -> click real UI BtnRecoverStorage -> recovers via zero-gain
    //        checkpoint commit (rev 2, EXACT same gold/cursorMs/deadlineMs, marker=null!)
    //     5. Next normal HIDE -> COMMITTED rev 3!
    // =========================================================================
    {
      await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-02 clean boot');
      await new Promise((r) => setTimeout(r, 350));

      const r502Seed = await cdp.evalJson(`(async () => {
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('hidden'); fire('visible');
        return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
      })()`);

      const r502Frozen = await cdp.evalJson(`(async () => {
        globalThis.__R6_ORIG_PUT__ = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(val, key) {
          if (String(key || '').includes(':save_slot_')) {
            throw new DOMException('R6 persistent quota full', 'QuotaExceededError');
          }
          return globalThis.__R6_ORIG_PUT__.call(this, val, key);
        };
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('hidden'); fire('visible');
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
        const marker = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        return { snap, marker: marker ? JSON.parse(marker) : null };
      })()`);

      // Click REAL UI BtnRecoverStorage while quota fault is STILL active!
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 200));
      const r502StillFrozen = await cdp.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
        const marker = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        // HIDE while still frozen must be skipped (0 writes)
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('hidden'); fire('visible');
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const hist = globalThis.__SPIKE_HARNESS__.getCommitHistory();
        return {
          halted: snap.lifecyclePersistence.persistenceHalted,
          overlay: snap.recoveryOverlayVisible,
          cls: snap.lifecyclePersistence.recoveryClassification,
          outcome: snap.lifecyclePersistence.lastRecoveryOutcome,
          backupRev: snap.lifecyclePersistence.readOnlyBackup?.revision ?? null,
          markerState: marker ? JSON.parse(marker).state : null,
          lastHistKind: hist[hist.length - 1]?.resultKind ?? null,
        };
      })()`);

      // Clear quota fault -> click REAL UI BtnRecoverStorage -> recovers via zero-gain checkpoint commit!
      await cdp.evalJson(`IDBObjectStore.prototype.put = globalThis.__R6_ORIG_PUT__; true`);
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 200));
      const r502Recovered = await cdp.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snapRec = globalThis.__SPIKE_HARNESS__.getSnapshot();
        const markerAfter = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        const fire = (st) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st }); document.dispatchEvent(new Event('visibilitychange')); };
        fire('hidden'); fire('visible');
        const nextHide = await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        return {
          halted: snapRec.lifecyclePersistence.persistenceHalted,
          overlay: snapRec.recoveryOverlayVisible,
          outcome: snapRec.lifecyclePersistence.lastRecoveryOutcome,
          recRev: snapRec.lifecyclePersistence.revision,
          recGold: snapRec.lifecyclePersistence.gold,
          recCursorMs: snapRec.lifecyclePersistence.cursorMs,
          recDeadlineMs: snapRec.lifecyclePersistence.deadlineMs,
          markerAfter,
          nextHideKind: nextHide.lastCommitKind,
          nextHideRev: nextHide.revision,
          nextHideGold: nextHide.gold,
        };
      })()`);

      report.rework06R502AppUiPersistentQuotaLoop = {
        seed: { rev: r502Seed.revision, gold: r502Seed.gold, cursorMs: r502Seed.cursorMs, deadlineMs: r502Seed.deadlineMs },
        frozenMarkerState: r502Frozen.marker?.state ?? null,
        frozenRequiresWriteVerify: r502Frozen.marker?.requiresWriteVerification ?? null,
        r502StillFrozen,
        r502Recovered,
      };
      assertCheck(
        'web_rework06_r5_02_app_ui_persistent_quota_recovery_loop',
        r502Seed.revision === '1' &&
          r502Frozen.marker?.state === 'FROZEN' &&
          r502Frozen.marker?.requiresWriteVerification === true &&
          r502StillFrozen.halted === true &&
          r502StillFrozen.overlay === true &&
          r502StillFrozen.cls === 'WRITE_CAPABILITY_UNAVAILABLE' &&
          r502StillFrozen.outcome === 'FAILED' &&
          r502StillFrozen.backupRev === '1' &&
          r502StillFrozen.markerState === 'FROZEN' &&
          r502StillFrozen.lastHistKind === 'SKIPPED_HALTED' &&
          r502Recovered.halted === false &&
          r502Recovered.overlay === false &&
          r502Recovered.outcome === 'RECOVERED_VALID' &&
          r502Recovered.recRev === '2' &&
          r502Recovered.recGold === r502Seed.gold &&
          r502Recovered.recCursorMs === r502Seed.cursorMs &&
          r502Recovered.recDeadlineMs === r502Seed.deadlineMs &&
          r502Recovered.markerAfter === null &&
          r502Recovered.nextHideKind === 'COMMITTED' &&
          r502Recovered.nextHideRev === '3',
        JSON.stringify(report.rework06R502AppUiPersistentQuotaLoop)
      );
    }

    // =========================================================================
    // 3p. REWORK-06 R5-03 REAL CHROME APP UI RECOVERY OWNER & LIFECYCLE
    //     1. Astra R5-03 exact counterexample: Tab A holds Web Lock -> Tab B clicks real UI
    //        BtnConfirmCorruptMarkerRecovery (+ duplicate click) -> waiting on Web Lock ->
    //        destroy Tab B BootEntry -> Tab A releases lock -> CANCELLED_DESTROYED,
    //        corrupt marker "{bad" & all 3 save slots 100% BYTE-IDENTICAL!
    //     2. Cross-tab STANDARD BtnRecoverStorage waiting on Web Lock (+ interleaved HIDE) ->
    //        destroy Tab B BootEntry -> release lock -> CANCELLED_DESTROYED, FROZEN marker & slots identical!
    //     3. Destroy BootEntry AFTER onMutationStarted() (paused inside clearTxState) ->
    //        legitimately started mutation completes safely, marker=null, outcome=COMPLETED_AFTER_DESTROY
    //        (NOT disguised as CANCELLED_DESTROYED), destroyed BootEntry stays permanently inactive!
    //     4. Exception during recovery -> caught cleanly, queue unpoisoned, next recovery succeeds!
    // =========================================================================
    {
      const lockName = `idle-fishing:save:browser:${appNs}`;

      // Subcase 1: Cross-tab CONFIRM_CORRUPT_MARKER waiting on Web Lock -> destroyed -> 0 disk mutations!
      await cdp.evalJson(`(${IDB_HELPERS_EXPR}).writeTxState(${JSON.stringify(appNs)}, '{bad')`);
      const slotsBeforeCorruptCancel = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);
      const { targetId: tabBR503aId } = await cdp.send('Target.createTarget', { url: baseUrl });
      let cdpB503a = null;
      let r503CorruptCancel = null;
      try {
        const bInfo = await waitUntil(async () => {
          const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          return (await r.json()).find((x) => x.id === tabBR503aId && x.webSocketDebuggerUrl) || null;
        }, 15000, 'R5-03a Tab B');
        cdpB503a = new CdpClient(bInfo.webSocketDebuggerUrl);
        await cdpB503a.waitOpen();
        await cdpB503a.send('Page.enable');
        await cdpB503a.send('Runtime.enable');
        await cdpB503a.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await waitUntil(() => cdpB503a.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-03a Tab B ready');
        await new Promise((r) => setTimeout(r, 300));

        // Tab A holds exclusive Web Lock
        await cdp.evalJson(`(() => {
          globalThis.__R6_LOCK_HELD__ = false;
          globalThis.__R6_LOCK_REL__ = null;
          navigator.locks.request(${JSON.stringify(lockName)}, { mode: 'exclusive' }, () => {
            globalThis.__R6_LOCK_HELD__ = true;
            return new Promise((r) => { globalThis.__R6_LOCK_REL__ = r; });
          });
          return true;
        })()`);
        await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__R6_LOCK_HELD__)`), 10000, 'R5-03a Tab A lock held');

        // Tab B clicks REAL UI BtnConfirmCorruptMarkerRecovery + duplicate click while waiting on Web Lock!
        const cCoord = await clickUiBtn(cdpB503a, 'BtnConfirmCorruptMarkerRecovery');
        await waitUntil(
          () => cdpB503a.evalJson(`navigator.locks.query().then((q) => q.pending.some((l) => l.name === ${JSON.stringify(lockName)}))`),
          10000,
          'R5-03a Tab B lock pending'
        );
        // Destroy Tab B BootEntry while waiting on Web Lock!
        await cdpB503a.evalJson(`(async () => {
          const boot = globalThis.cc.director.getScene().getComponentInChildren('BootEntry');
          boot.destroy();
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        })()`);
        const markerBeforeRelease = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)})`);
        // Tab A releases lock!
        await cdp.evalJson(`globalThis.__R6_LOCK_REL__(); true`);
        await cdpB503a.evalJson(`globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()`);
        const snapAfter = await cdpB503a.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
        const markerAfterRelease = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)})`);
        const slotsAfter = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);
        r503CorruptCancel = {
          clicked: Boolean(cCoord),
          markerBeforeRelease,
          markerAfterRelease,
          slotsIdentical: JSON.stringify(slotsBeforeCorruptCancel) === JSON.stringify(slotsAfter),
          destroyed: snapAfter.destroyed,
          halted: snapAfter.lifecyclePersistence.persistenceHalted,
          outcome: snapAfter.lifecyclePersistence.lastRecoveryOutcome,
        };
      } finally {
        cdpB503a?.close();
        try { await cdp.send('Target.closeTarget', { targetId: tabBR503aId }); } catch {}
        await cdp.send('Page.bringToFront');
      }

      // Subcase 2: Cross-tab STANDARD BtnRecoverStorage waiting on Web Lock (+ duplicate clicks + queued HIDE) -> destroyed!
      const stdFrozenMarker = JSON.stringify({
        version: 1,
        storageKey: `browser:${appNs}`,
        txId: 'tx_r503_std_frozen',
        state: 'FROZEN',
        expectedRevision: '3',
        targetRevision: '4',
        priorSaveHistory: 'CONFIRMED_VALID',
        confirmedRevision: '3',
        requiresWriteVerification: false,
        createdAtMs: 1700000000000,
        updatedAtMs: 1700000000000,
        reason: 'R5-03 standard lock-wait destroy test',
      });
      await cdp.evalJson(`(${IDB_HELPERS_EXPR}).writeTxState(${JSON.stringify(appNs)}, ${JSON.stringify(stdFrozenMarker)})`);
      const slotsBeforeStdCancel = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);
      const { targetId: tabBR503bId } = await cdp.send('Target.createTarget', { url: baseUrl });
      let cdpB503b = null;
      let r503StdCancel = null;
      try {
        const bInfo = await waitUntil(async () => {
          const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
          return (await r.json()).find((x) => x.id === tabBR503bId && x.webSocketDebuggerUrl) || null;
        }, 15000, 'R5-03b Tab B');
        cdpB503b = new CdpClient(bInfo.webSocketDebuggerUrl);
        await cdpB503b.waitOpen();
        await cdpB503b.send('Page.enable');
        await cdpB503b.send('Runtime.enable');
        await cdpB503b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await waitUntil(() => cdpB503b.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-03b Tab B ready');
        await new Promise((r) => setTimeout(r, 300));

        await cdp.evalJson(`(() => {
          globalThis.__R6_LOCK2_HELD__ = false;
          globalThis.__R6_LOCK2_REL__ = null;
          navigator.locks.request(${JSON.stringify(lockName)}, { mode: 'exclusive' }, () => {
            globalThis.__R6_LOCK2_HELD__ = true;
            return new Promise((r) => { globalThis.__R6_LOCK2_REL__ = r; });
          });
          return true;
        })()`);
        await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__R6_LOCK2_HELD__)`), 10000, 'R5-03b Tab A lock held');

        const sCoord = await clickUiBtn(cdpB503b, 'BtnRecoverStorage');
        // Rapid duplicate clicks while waiting on Web Lock + queued HIDE!
        await cdpB503b.click(sCoord.x, sCoord.y);
        await cdpB503b.click(sCoord.x, sCoord.y);
        await waitUntil(
          () => cdpB503b.evalJson(`navigator.locks.query().then((q) => q.pending.some((l) => l.name === ${JSON.stringify(lockName)}))`),
          10000,
          'R5-03b Tab B lock pending'
        );
        await cdpB503b.evalJson(`(async () => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
          const boot = globalThis.cc.director.getScene().getComponentInChildren('BootEntry');
          boot.destroy();
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        })()`);
        await cdp.evalJson(`globalThis.__R6_LOCK2_REL__(); true`);
        await cdpB503b.evalJson(`globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()`);
        const snapAfter = await cdpB503b.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
        const markerAfter = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)})`);
        const slotsAfter = await cdp.evalJson(`(${IDB_HELPERS_EXPR}).readSlots(${JSON.stringify(appNs)})`);
        const lastHist = snapAfter.commitHistory[snapAfter.commitHistory.length - 1];
        r503StdCancel = {
          dupIgnored: snapAfter.lifecyclePersistence.recoveryDuplicateClicksIgnored,
          markerIdentical: markerAfter === stdFrozenMarker,
          slotsIdentical: JSON.stringify(slotsBeforeStdCancel) === JSON.stringify(slotsAfter),
          outcome: snapAfter.lifecyclePersistence.lastRecoveryOutcome,
          halted: snapAfter.lifecyclePersistence.persistenceHalted,
          queuedHideKind: lastHist?.resultKind ?? null,
        };
      } finally {
        cdpB503b?.close();
        try { await cdp.send('Target.closeTarget', { targetId: tabBR503bId }); } catch {}
        await cdp.send('Page.bringToFront');
      }

      // Subcase 3: Destroyed AFTER onMutationStarted() (paused inside clearTxState) -> COMPLETED_AFTER_DESTROY!
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-03c reload');
      await new Promise((r) => setTimeout(r, 300));
      await cdp.evalJson(`(async () => {
        const portMod = await System.import('chunks:///_virtual/BrowserFilePort.ts');
        const proto = portMod.BrowserFilePort.prototype;
        globalThis.__R6_ORIG_CLEAR__ = proto.clearTxState;
        globalThis.__R6_CLEAR_ENTERED__ = false;
        globalThis.__R6_CLEAR_REL__ = null;
        proto.clearTxState = function(...args) {
          globalThis.__R6_CLEAR_ENTERED__ = true;
          const self = this;
          return new Promise((res, rej) => {
            globalThis.__R6_CLEAR_REL__ = () => {
              proto.clearTxState = globalThis.__R6_ORIG_CLEAR__;
              globalThis.__R6_ORIG_CLEAR__.apply(self, args).then(res, rej);
            };
          });
        };
      })()`);
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__R6_CLEAR_ENTERED__)`), 10000, 'R5-03c clearTxState entered');
      const r503AfterMutationStart = await cdp.evalJson(`(async () => {
        const boot = globalThis.cc.director.getScene().getComponentInChildren('BootEntry');
        boot.destroy();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        globalThis.__R6_CLEAR_REL__();
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
        const markerAfter = await (${IDB_HELPERS_EXPR}).readTxState(${JSON.stringify(appNs)});
        return {
          destroyed: snap.destroyed,
          halted: snap.lifecyclePersistence.persistenceHalted,
          outcome: snap.lifecyclePersistence.lastRecoveryOutcome,
          markerAfter,
        };
      })()`);

      // Subcase 4: Unexpected exception during recovery -> caught cleanly, queue unpoisoned, next recovery succeeds!
      await cdp.evalJson(`(${IDB_HELPERS_EXPR}).writeTxState(${JSON.stringify(appNs)}, ${JSON.stringify(stdFrozenMarker)})`);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R5-03d reload');
      await new Promise((r) => setTimeout(r, 300));
      await cdp.evalJson(`(async () => {
        const mod = await System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts');
        const proto = mod.SingleWriterSaveCoordinator.prototype;
        globalThis.__R6_ORIG_LOAD_THROW__ = proto.loadSafe;
        proto.loadSafe = async function() {
          proto.loadSafe = globalThis.__R6_ORIG_LOAD_THROW__;
          throw new Error('R5-03 injected recovery exception');
        };
      })()`);
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 200));
      const r503AfterThrow = await cdp.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
        return {
          halted: snap.lifecyclePersistence.persistenceHalted,
          outcome: snap.lifecyclePersistence.lastRecoveryOutcome,
          detail: snap.lifecyclePersistence.lastRecoveryDetail,
        };
      })()`);
      await clickUiBtn(cdp, 'BtnRecoverStorage');
      await new Promise((r) => setTimeout(r, 200));
      const r503AfterRetry = await cdp.evalJson(`(async () => {
        await globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
        const snap = globalThis.__SPIKE_HARNESS__.getSnapshot();
        return {
          halted: snap.lifecyclePersistence.persistenceHalted,
          outcome: snap.lifecyclePersistence.lastRecoveryOutcome,
          rev: snap.lifecyclePersistence.revision,
        };
      })()`);

      // Clean app namespace & reload clean healthy EMPTY state before Step 4 UI clicks!
      await cdp.evalJson(`(${IDB_HELPERS_EXPR}).clearNs(${JSON.stringify(appNs)})`);
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__?.ready)`), 25000, 'R6 clean boot before Step 4');
      await new Promise((r) => setTimeout(r, 350));

      report.rework06R503AppUiRecoveryOwnerLifecycle = {
        r503CorruptCancel,
        r503StdCancel,
        r503AfterMutationStart,
        r503AfterThrow,
        r503AfterRetry,
      };
      assertCheck(
        'web_rework06_r5_03_app_ui_recovery_owner_lifecycle',
        r503CorruptCancel?.markerBeforeRelease === '{bad' &&
          r503CorruptCancel?.markerAfterRelease === '{bad' &&
          r503CorruptCancel?.slotsIdentical === true &&
          r503CorruptCancel?.destroyed === true &&
          r503CorruptCancel?.halted === true &&
          r503CorruptCancel?.outcome === 'CANCELLED_DESTROYED' &&
          r503StdCancel?.dupIgnored >= 2 &&
          r503StdCancel?.markerIdentical === true &&
          r503StdCancel?.slotsIdentical === true &&
          r503StdCancel?.outcome === 'CANCELLED_DESTROYED' &&
          r503StdCancel?.halted === true &&
          r503StdCancel?.queuedHideKind === 'SKIPPED_DESTROYED' &&
          r503AfterMutationStart.destroyed === true &&
          r503AfterMutationStart.halted === true &&
          r503AfterMutationStart.outcome === 'COMPLETED_AFTER_DESTROY' &&
          r503AfterMutationStart.markerAfter === null &&
          r503AfterThrow.halted === true &&
          r503AfterThrow.outcome === 'FAILED' &&
          String(r503AfterThrow.detail).includes('R5-03 injected recovery exception') &&
          r503AfterRetry.halted === false &&
          r503AfterRetry.outcome === 'RECOVERED_VALID' &&
          r503AfterRetry.rev === '3',
        JSON.stringify(report.rework06R503AppUiRecoveryOwnerLifecycle)
      );
    }
  }

  // 4. Real pointer click to open Modal + screenshot + close Modal + click to switch to Page 2
  console.log('[Web E2E] Completed REWORK-06 checks; starting Modal/Platform/Perf24h...');
  const btnCoords = await cdp.evalJson(`(() => {
    const cc = globalThis.cc;
    const canvas = cc.director.getScene().getChildByName('Canvas');
    const find = (root, name) => {
      if (root.name === name) return root;
      for (const ch of root.children) { const r = find(ch, name); if (r) return r; }
      return null;
    };
    const toCss = (node) => {
      const cam = canvas.getComponent(cc.Canvas).cameraComponent;
      const wp = node.getWorldPosition();
      const sp = cam.worldToScreen(wp);
      const rect = document.getElementById('GameCanvas').getBoundingClientRect();
      const dpr = cc.view.getDevicePixelRatio();
      return {
        x: Math.round(rect.left + sp.x / dpr),
        y: Math.round(rect.top + rect.height - sp.y / dpr),
      };
    };
    return {
      openModal: toCss(find(canvas, 'BtnOpenModal')),
      toPlatform: toCss(find(canvas, 'BtnToPlatform')),
    };
  })()`);

  await cdp.click(btnCoords.openModal.x, btnCoords.openModal.y);
  await new Promise((r) => setTimeout(r, 400));
  const modalOpened = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.isModalVisible()`);
  const modalPng = path.join(evidenceDir, 'r1-green-modal.png');
  await cdp.screenshot(modalPng);
  report.screenshots.push(path.relative(repoRoot, modalPng).replace(/\\/g, '/'));

  const closeCoord = await cdp.evalJson(`(() => {
    const cc = globalThis.cc;
    const canvas = cc.director.getScene().getChildByName('Canvas');
    const find = (root, name) => {
      if (root.name === name) return root;
      for (const ch of root.children) { const r = find(ch, name); if (r) return r; }
      return null;
    };
    const cam = canvas.getComponent(cc.Canvas).cameraComponent;
    const wp = find(canvas, 'ModalCloseBtn').getWorldPosition();
    const sp = cam.worldToScreen(wp);
    const rect = document.getElementById('GameCanvas').getBoundingClientRect();
    const dpr = cc.view.getDevicePixelRatio();
    return { x: Math.round(rect.left + sp.x / dpr), y: Math.round(rect.top + rect.height - sp.y / dpr) };
  })()`);
  await cdp.click(closeCoord.x, closeCoord.y);
  await new Promise((r) => setTimeout(r, 300));
  const modalClosed = !(await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.isModalVisible()`));
  report.modalClickCheck = { modalOpened, modalClosed, openCoord: btnCoords.openModal, closeCoord };
  assertCheck('web_click_modal_open_close', modalOpened && modalClosed, JSON.stringify(report.modalClickCheck));

  // Click to switch to Page 2 (Platform)
  await cdp.click(btnCoords.toPlatform.x, btnCoords.toPlatform.y);
  await new Promise((r) => setTimeout(r, 400));
  const activePage = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getCurrentPage()`);
  assertCheck('web_click_switch_to_platform', activePage === 'platform', `page=${activePage}`);

  // 5. Run all Platform checks on Page 2
  await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.runAllPlatformChecks()`);
  await new Promise((r) => setTimeout(r, 500));
  const platSnap = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot()`);
  report.platformChecks = {
    fsResults: platSnap.fsResults,
    platformResults: platSnap.platformResults,
    subpackResult: platSnap.subpackResult,
  };
  const platPng = path.join(evidenceDir, 'r1-green-platform.png');
  await cdp.screenshot(platPng);
  report.screenshots.push(path.relative(repoRoot, platPng).replace(/\\/g, '/'));

  const fsAllPass = platSnap.fsResults.length === 6 && platSnap.fsResults.every((r) => r.status === 'PASS');
  assertCheck(
    'web_platform_fs_6_of_6',
    fsAllPass,
    platSnap.fsResults.map((r) => `${r.id}=${r.status}`).join(', ')
  );
  const t08Pass =
    platSnap.platformResults.filter((r) => r.id.startsWith('T08')).length === 2 &&
    platSnap.platformResults.filter((r) => r.id.startsWith('T08')).every((r) => r.status === 'PASS');
  assertCheck(
    'web_platform_t08_2_of_2',
    t08Pass,
    platSnap.platformResults
      .filter((r) => r.id.startsWith('T08'))
      .map((r) => `${r.id}=${r.status}`)
      .join(', ')
  );
  const t09StubPass = platSnap.platformResults.some((r) => r.id === 'T09-AD-STUB-5' && r.status === 'PASS');
  const t09RealBlocked = platSnap.platformResults.some((r) => r.id === 'T09-REAL-AD' && r.status === 'BLOCKED');
  assertCheck('web_platform_t09_stub_pass_real_blocked', t09StubPass && t09RealBlocked, `stub=${t09StubPass}, realBlocked=${t09RealBlocked}`);
  assertCheck(
    'web_t10_local_bundle_loaded',
    platSnap.subpackResult?.status === 'PASS' && platSnap.subpackResult?.iconLoaded === true,
    JSON.stringify(platSnap.subpackResult)
  );

  // 6. Real mouse wheel scroll on Page 2 ScrollView
  const scrollBefore = await cdp.evalJson(`(() => {
    const cc = globalThis.cc;
    const find = (root, name) => {
      if (root.name === name) return root;
      for (const ch of root.children) { const r = find(ch, name); if (r) return r; }
      return null;
    };
    const sv = find(cc.director.getScene(), 'PlatformResultScrollList').getComponent(cc.ScrollView);
    return { y: sv.getScrollOffset().y, maxY: sv.getMaxScrollOffset().y };
  })()`);
  await cdp.wheel(195, 620, 400);
  await new Promise((r) => setTimeout(r, 350));
  const scrollAfter = await cdp.evalJson(`(() => {
    const cc = globalThis.cc;
    const find = (root, name) => {
      if (root.name === name) return root;
      for (const ch of root.children) { const r = find(ch, name); if (r) return r; }
      return null;
    };
    const sv = find(cc.director.getScene(), 'PlatformResultScrollList').getComponent(cc.ScrollView);
    return { y: Math.round(sv.getScrollOffset().y), maxY: Math.round(sv.getMaxScrollOffset().y) };
  })()`);
  report.scrollOffsetCheck = { before: scrollBefore, after: scrollAfter };
  assertCheck('web_scrollview_wheel_scroll', scrollAfter.y > 0, JSON.stringify(report.scrollOffsetCheck));

  // 7. Landscape resize adaptation check (844x390)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 350));
  const landscapeMetrics = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.getSnapshot().viewport`);
  report.landscapeViewport = landscapeMetrics;
  assertCheck('web_responsive_landscape_resize', landscapeMetrics.orientation === 'LANDSCAPE', JSON.stringify(landscapeMetrics));

  // Restore portrait and switch back to Page 1 for 24h benchmark
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 300));
  await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.switchPage('overview')`);
  await new Promise((r) => setTimeout(r, 300));

  // 8. Representative 24h Offline Benchmark (T06)
  const perf = await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.run24hPerf()`);
  report.perf24h = perf;
  const perfPng = path.join(evidenceDir, 'r1-green-perf24h.png');
  await cdp.screenshot(perfPng);
  report.screenshots.push(path.relative(repoRoot, perfPng).replace(/\\/g, '/'));

  assertCheck(
    'web_t06_24h_single_equals_sliced',
    perf.singleEqualsSliced === true &&
      perf.matchesBe000Golden24hEnvelope === true &&
      perf.envelopeInnerSha256 === '9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d' &&
      perf.envelopeHashRev1 === '0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f',
    `single=${perf.singleShotMs}ms, sliced=${perf.slicedComputeMs}ms, maxSlice=${perf.maxSliceMs}ms, slices=${perf.sliceCount}, rafMax=${perf.slicedRafStats?.maxFrameMs}ms, inner=${perf.envelopeInnerSha256?.slice(0, 12)}, text=${perf.envelopeHashRev1?.slice(0, 12)}, goldenMatch=${perf.matchesBe000Golden24hEnvelope}`
  );

  collectErrors();
  assertCheck('web_zero_console_errors', report.consoleErrors.length === 0, `count=${report.consoleErrors.length}`);
  assertCheck('web_zero_uncaught_exceptions', report.uncaughtExceptions.length === 0, `count=${report.uncaughtExceptions.length}`);
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

report.assertions = assertions;
report.failures = failures;
fs.mkdirSync(evidenceDir, { recursive: true });
const outJson = path.join(evidenceDir, 'r1-green-web-results.json');
fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');

console.log(`[Web E2E] Assertions: ${assertions.length - failures.length}/${assertions.length} PASS`);
console.log(`[Web E2E] Saved JSON evidence: ${outJson}`);
for (const a of assertions) {
  console.log(`  [${a.status}] ${a.name} — ${a.detail}`);
}

if (assertions.length === 0 || failures.length > 0) {
  console.error(`[Web E2E] FAILED (${failures.length} failure(s))`);
  process.exit(1);
}
process.exit(0);
