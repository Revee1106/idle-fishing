import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = 'E:/idle-fishing-integration';
const webBuildDir = path.join(repoRoot, 'apps/game-client/build/web-mobile');
const outJson = path.join(repoRoot, 'reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.json');
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm', '.bin': 'application/octet-stream', '.cconb': 'application/octet-stream',
};

function startServer(rootDir) {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rsp) => {
      const u = (req.url || '/').split('?')[0];
      const full = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        rsp.writeHead(404); rsp.end('nf'); return;
      }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(full).pipe(rsp);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1; this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result?.value;
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitUntil(fn, ms, label) {
  const d = Date.now() + ms;
  while (Date.now() < d) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('TIMEOUT ' + label);
}

const IDB_HELPERS = `(() => {
  const DB='idle_fishing_fs_v1', ST='files';
  const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(ST))r.result.createObjectStore(ST);};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  return {
    async readTxState(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');let v=null;const q=tx.objectStore(ST).get(ns+':__tx_state__');q.onsuccess=()=>{v=q.result??null;};tx.oncomplete=()=>res(v);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async writeTxState(ns,val){const db=await open();try{await new Promise((res,rej)=>{const tx=db.transaction(ST,'readwrite');tx.objectStore(ST).put(val,ns+':__tx_state__');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async readSlots(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');const st=tx.objectStore(ST);const out=[null,null,null];for(let i=0;i<3;i++){const q=st.get(ns+':save_slot_'+i+'.json');q.onsuccess=()=>{out[i]=q.result??null;};}tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
  };
})()`;

const appNs = 'idle_fishing_lifecycle_persist_fs';
const { server, port } = await startServer(webBuildDir);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r6-repro-'));
const dbg = 9400 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}/`;
const chrome = spawn(chromeExe, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${dbg}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

let cdp = null;
const rows = [];
try {
  const target = await waitUntil(async () => {
    const r = await fetch(`http://127.0.0.1:${dbg}/json/list`);
    return (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
  }, 15000, 'chrome');
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitUntil(() => cdp.eval('Boolean(globalThis.__SPIKE_HARNESS__?.ready)'), 25000, 'ready');
  await new Promise((r) => setTimeout(r, 500));

  const clickBtn = async (btnName) => {
    const coord = await cdp.eval(`(() => {
      const cc = globalThis.cc;
      const canvas = cc.director.getScene().getChildByName('Canvas');
      const find = (root, name) => { if (root.name === name) return root; for (const ch of root.children) { const r = find(ch, name); if (r) return r; } return null; };
      const node = find(canvas, ${JSON.stringify(btnName)});
      if (!node || !node.activeInHierarchy) return null;
      const cam = canvas.getComponent(cc.Canvas).cameraComponent;
      const sp = cam.worldToScreen(node.getWorldPosition());
      const rect = document.getElementById('GameCanvas').getBoundingClientRect();
      const dpr = cc.view.getDevicePixelRatio();
      return { x: Math.round(rect.left + sp.x / dpr), y: Math.round(rect.top + rect.height - sp.y / dpr) };
    })()`);
    if (!coord) throw new Error('Button not visible: ' + btnName);
    await cdp.click(coord.x, coord.y);
  };
  const hide = () => cdp.eval(`(async () => {
    for (const st of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
  })()`);
  const record = async (label) => {
    const snap = await cdp.eval('globalThis.__SPIKE_HARNESS__.getSnapshot()');
    const marker = await cdp.eval(`(${IDB_HELPERS}).readTxState(${JSON.stringify(appNs)})`);
    const slots = await cdp.eval(`(${IDB_HELPERS}).readSlots(${JSON.stringify(appNs)})`);
    const row = {
      label,
      halted: snap.lifecyclePersistence.persistenceHalted,
      outcome: snap.lifecyclePersistence.lastRecoveryOutcome,
      rev: snap.lifecyclePersistence.revision,
      overlay: snap.recoveryOverlayVisible,
      marker,
      slotRevs: slots.map((s) => (s ? JSON.parse(s).revision : null)),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  };

  // --- R5-02 Repro ---
  await hide();
  await record('r502_seed_rev1');
  await cdp.eval(`(() => {
    globalThis.__ORIG_PUT__ = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(v, k) {
      if (String(k).includes(':save_slot_')) throw new DOMException('quota remains full', 'QuotaExceededError');
      return globalThis.__ORIG_PUT__.call(this, v, k);
    };
    return true;
  })()`);
  await hide();
  await record('r502_quota_frozen');
  await clickBtn('BtnRecoverStorage');
  await new Promise((r) => setTimeout(r, 400));
  await cdp.eval('globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()');
  await record('r502_clicked_recovery_while_quota_still_active');
  await cdp.eval('IDBObjectStore.prototype.put = globalThis.__ORIG_PUT__; true');

  // --- R5-03 Repro ---
  await cdp.eval(`(${IDB_HELPERS}).writeTxState(${JSON.stringify(appNs)}, '{bad')`);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitUntil(() => cdp.eval('Boolean(globalThis.__SPIKE_HARNESS__?.ready)'), 25000, 'reload');
  await new Promise((r) => setTimeout(r, 400));
  await record('r503_corrupt_marker_preview');
  await cdp.eval(`navigator.locks.request('idle-fishing:save:browser:${appNs}', async () => { globalThis.__HELD__ = true; await new Promise((r) => { globalThis.__REL__ = r; }); }); true`);
  await waitUntil(() => cdp.eval('Boolean(globalThis.__HELD__)'), 5000, 'lock held');
  await clickBtn('BtnConfirmCorruptMarkerRecovery');
  await waitUntil(() => cdp.eval('navigator.locks.query().then((x) => x.pending.length > 0)'), 5000, 'lock pending');
  await cdp.eval(`cc.director.getScene().getComponentInChildren('BootEntry').destroy(); true`);
  await new Promise((r) => setTimeout(r, 300));
  await record('r503_destroyed_while_waiting_lock');
  await cdp.eval('globalThis.__REL__(); true');
  await cdp.eval('globalThis.__SPIKE_HARNESS__.awaitPendingHideSave()');
  await new Promise((r) => setTimeout(r, 200));
  await record('r503_after_lock_released');

  fs.writeFileSync(outJson, JSON.stringify(rows, null, 2));
} finally {
  cdp?.close();
  try { chrome.kill(); } catch {}
  server.close();
  try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
}

