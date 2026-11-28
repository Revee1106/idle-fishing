import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const mode = process.argv[2]; // 'standard' | 'confirm'
const webBuildDir = path.resolve(process.argv[3]);
if (mode !== 'standard' && mode !== 'confirm') {
  throw new Error('Usage: node repro-r503-probe-owner.mjs <standard|confirm> <webBuildDir>');
}
const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.cconb': 'application/octet-stream',
};

function startServer(rootDir) {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rsp) => {
      const u = (req.url || '/').split('?')[0];
      const full = path.resolve(rootDir, u === '/' ? 'index.html' : u.replace(/^\/+/, ''));
      if (!full.startsWith(rootDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        rsp.writeHead(404);
        rsp.end('nf');
        return;
      }
      rsp.writeHead(200, {
        'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(full).pipe(rsp);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
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
    await new Promise((r, j) => {
      this.ws.addEventListener('open', r, { once: true });
      this.ws.addEventListener('error', j, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
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
  close() {
    try {
      this.ws.close();
    } catch {}
  }
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
    async readHistoryState(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');let v=null;const q=tx.objectStore(ST).get(ns+':__save_history__');q.onsuccess=()=>{v=q.result??null;};tx.oncomplete=()=>res(v);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async writeTxState(ns,val){const db=await open();try{await new Promise((res,rej)=>{const tx=db.transaction(ST,'readwrite');tx.objectStore(ST).put(val,ns+':__tx_state__');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
    async readSlots(ns){const db=await open();try{return await new Promise((res,rej)=>{const tx=db.transaction(ST,'readonly');const st=tx.objectStore(ST);const out=[null,null,null];for(let i=0;i<3;i++){const q=st.get(ns+':save_slot_'+i+'.json');q.onsuccess=()=>{out[i]=q.result??null;};}tx.oncomplete=()=>res(out);tx.onerror=()=>rej(tx.error);});}finally{db.close();}},
  };
})()`;

const appNs = 'idle_fishing_lifecycle_persist_fs';
const { server, port } = await startServer(webBuildDir);
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r7-probe-'));
const dbg = 9600 + Math.floor(Math.random() * 250);
const baseUrl = `http://127.0.0.1:${port}/`;
const chrome = spawn(
  chromeExe,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${udd}`,
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true }
);

let cdp = null;
let pass = false;
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
  await new Promise((r) => setTimeout(r, 400));

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
  const hide = () =>
    cdp.eval(`(async () => {
      for (const st of ['hidden', 'visible']) {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      return globalThis.__SPIKE_HARNESS__.awaitPendingHideSave();
    })()`);

  const snapshot = () => cdp.eval('globalThis.__SPIKE_HARNESS__.getSnapshot().lifecyclePersistence');
  const slots = () => cdp.eval(`(${IDB_HELPERS}).readSlots(${JSON.stringify(appNs)})`);
  const marker = () => cdp.eval(`(${IDB_HELPERS}).readTxState(${JSON.stringify(appNs)})`);
  const boot = await snapshot();
  await cdp.eval(`(() => {
    const original = IDBObjectStore.prototype.put; globalThis.auditOriginalPut = original;
    IDBObjectStore.prototype.put = function(value,key) {
      if (String(key).startsWith(${JSON.stringify(appNs + ':save_slot_')}) && typeof value === 'string' && value.length > 1000) {
        globalThis.attemptedSlotText = value;
        throw new DOMException('audit slot quota','QuotaExceededError');
      }
      return original.call(this,value,key);
    };
    return true;
  })()`);
  await hide();
  const pending = await cdp.eval('globalThis.attemptedSlotText');
  const beforeReload = await snapshot();
  const markerBefore = await marker();
  if (!pending || !beforeReload.persistenceHalted || !markerBefore || (await slots()).some(Boolean)) throw Error('fixture invalid');
  const {default: assert} = await import('node:assert/strict');
  const history = () => cdp.eval(`(${IDB_HELPERS}).readHistoryState(${JSON.stringify(appNs)})`);
  const snap = () => cdp.eval('__SPIKE_HARNESS__.getSnapshot()');
  const pendingState = JSON.parse(JSON.parse(pending).payload);
  assert.equal(pendingState.gold,'31');
  assert.equal(pendingState.cursorMs,1700000060000);
  assert.equal(await history(),null);
  const rows = [];
  if (process.argv[4] === 'same') {
    await cdp.eval('IDBObjectStore.prototype.put=globalThis.auditOriginalPut;true');
    await clickBtn('BtnRecoverStorage');
    await waitUntil(async () => (await snapshot()).lastRecoveryOutcome === 'RECOVERED_VALID',10000,'same-page recovery');
    const actual = (await slots()).filter(Boolean).map(x=>JSON.parse(x));
    assert.equal(actual.length,1);
    assert.equal(actual[0].revision,'1');
    assert.equal(actual[0].payload,JSON.parse(pending).payload);
    assert.equal(JSON.parse(await history()).confirmedRevision,'1');
    assert.equal(await marker(),null);
    rows.push({step:'same-page recovery',pendingState,readBack:actual[0],history:await history(),app:await snapshot()});
    await hide();
    const rec=await snapshot();
    assert.equal(rec.revision,'2');
    assert.equal(rec.lastCommitKind,'COMMITTED');
    const next=(await slots()).filter(Boolean).map(x=>JSON.parse(x)).find(x=>x.revision==='2');
    assert.ok(next);
    assert.equal(JSON.parse(await history()).confirmedRevision,'2');
    rows.push({step:'next HIDE',revision:rec.revision,gold:rec.gold,cursorMs:rec.cursorMs,readBack:next,history:await history()});
  } else {
    for (let cycle=1;cycle<=2;cycle++) {
      await cdp.send('Page.reload',{ignoreCache:true});
      await waitUntil(()=>cdp.eval('globalThis.__SPIKE_HARNESS__?.ready && __SPIKE_HARNESS__.getSnapshot().recoveryOverlayVisible'),25000,'frozen boot');
      for (let click=1;click<=2;click++) {
        const count=(await snapshot()).recoveryAttemptCount;
        await clickBtn('BtnRecoverStorage');
        await waitUntil(async()=>{const p=await snapshot();return p.recoveryAttemptCount>count && !p.recoveryInProgress && p.lastRecoveryOutcome==='FAILED'},10000,'completed click');
        const state = await snap();
        const p = state.lifecyclePersistence;
        const labels=await cdp.eval(`cc.director.getScene().getComponentsInChildren(cc.Label).filter(label=>label.node.activeInHierarchy && label.string.includes('Original unsaved initial progress')).map(label=>({name:label.node.name,text:label.string}))`);
        const currentSlots=await slots(), currentMarker=await marker(), hist=await history();
        assert.equal(state.recoveryOverlayVisible,true);
        assert.equal(p.persistenceHalted,true);
        assert.equal(p.recoveryClassification,'INITIAL_COMMIT_STATE_UNAVAILABLE');
        assert.equal(p.revision,null);
        assert.equal(hist,null);
        assert.equal(currentMarker,markerBefore);
        assert.equal(currentSlots.filter(Boolean).length,0);
        assert.ok(labels.some(x=>x.text.includes('Writes remain frozen')));
        rows.push({cycle,click,count:p.recoveryAttemptCount,outcome:p.lastRecoveryOutcome,labels,slots:currentSlots,history:hist,markerUnchanged:currentMarker===markerBefore});
      }
    }
  }
  console.log(JSON.stringify({scenario:process.argv[4],rows},null,2));
  pass=true;

} finally {
  cdp?.close();
  try {
    chrome.kill();
  } catch {}
  server.close();
  try {
    fs.rmSync(udd, { recursive: true, force: true });
  } catch {}
}
process.exit(pass ? 0 : 1);
