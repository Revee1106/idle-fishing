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
    : path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-03/evidence/web-rework03');

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

  // 4. Real pointer click to open Modal + screenshot + close Modal + click to switch to Page 2
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
