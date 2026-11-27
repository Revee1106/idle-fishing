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
const evidenceDir = path.join(repoRoot, 'reports/frontend/FE-000/evidence');

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
  const collectErrors = () => {
    for (const ev of cdp.events) {
      if (ev.method === 'Runtime.consoleAPICalled' && ev.params?.type === 'error') {
        report.consoleErrors.push(JSON.stringify(ev.params.args));
      }
      if (ev.method === 'Runtime.exceptionThrown') {
        report.uncaughtExceptions.push(JSON.stringify(ev.params.exceptionDetails));
      }
    }
    cdp.events.length = 0;
  };
  collectErrors();

  // 1. Boot snapshot & Page 1 overview screenshot
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
      'bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a',
    `hash=${bootSnap.coreReport?.summaryState?.canonicalHash}`
  );

  // 2. Direct System.import test of compiled WeChatLifecycleProvider.ts (I01 + I05 regression on ACTUAL Web bundle!)
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

  // 3. Real DOM visibilitychange(hidden) -> platform HIDE callback save -> REAL Page.reload() recovery!
  await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.clearLifecyclePersistence()`);
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

  // Real browser page reload!
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.evalJson(`Boolean(globalThis.__SPIKE_HARNESS__ && globalThis.__SPIKE_HARNESS__.ready)`), 25000, 'BootEntry ready after reload');
  await new Promise((r) => setTimeout(r, 600));
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
  // Clean lifecycle persistence store after test
  await cdp.evalJson(`globalThis.__SPIKE_HARNESS__.clearLifecyclePersistence()`);

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

  // 5. Run all Platform checks on Page 2 (FS 6/6, Lifecycle/Clock 2/2, Ad Stub PASS, Real Ad BLOCKED, Subpack PASS)
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
    perf.singleEqualsSliced === true && perf.matchesBe000Golden24hEnvelope === true,
    `single=${perf.singleShotMs}ms, sliced=${perf.slicedComputeMs}ms, maxSlice=${perf.maxSliceMs}ms, slices=${perf.sliceCount}, rafMax=${perf.slicedRafStats?.maxFrameMs}ms, goldenMatch=${perf.matchesBe000Golden24hEnvelope}`
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
    fs.rmSync(userDataDir, { recursive: true, force: true });
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
