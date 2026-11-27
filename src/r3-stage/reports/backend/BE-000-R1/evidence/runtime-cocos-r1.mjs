/**
 * BE-000-R1 Cocos Web <-> Node cross-host check.
 * Usage: node reports/backend/BE-000-R1/evidence/runtime-cocos-r1.mjs <build/web-mobile>
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {
  advanceOffline,
  createInitialState,
} from '../../../../packages/game-core/src/spike/offline.ts';
import { buildEnvelope } from '../../../../packages/game-core/src/spike/save.ts';

const root = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('pass the Cocos web-mobile build directory');
const math = JSON.parse(await readFile(new URL('../../../../tests/backend/be-000/fixtures/math-vectors.json', import.meta.url), 'utf8'));

const initial = createInitialState({ saveEpoch: 'epoch.be000', startMs: 1_700_000_000_000, allowanceMs: 86_400_000 });
const finalState = advanceOffline(initial, initial.cursorMs + 86_400_000).state;
const envelope = buildEnvelope(finalState, '1');
const node = {
  sha256: envelope.sha256,
  text: envelope.text,
  gold: finalState.gold,
  big: finalState.big,
  canonicalSha256: createHash('sha256').update(envelope.payload, 'utf8').digest('hex'),
  stateHash: createHash('sha256').update(envelope.text, 'utf8').digest('hex'),
};

const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.bin': 'application/octet-stream',
};
const server = http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${route === '/' ? '/index.html' : decodeURIComponent(route)}`);
    if (!file.startsWith(root + path.sep)) throw new Error('path');
    let data = await readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    if (file === path.join(root, 'index.html')) {
      data = data.toString().replace('</body>', '</body>');
    }
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
await rm(path.resolve('chrome-r1'), { recursive: true, force: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless', '--no-first-run', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--remote-debugging-port=0', '--user-data-dir=' + path.resolve('chrome-r1'), 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    await sleep(250);
    try {
      port = (await readFile('chrome-r1/DevToolsActivePort', 'utf8')).split('\n')[0];
    } catch {}
  }
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  const waits = new Map();
  let id = 0;
  const call = (method, params = {}) => new Promise((resolve) => {
    waits.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      waits.get(message.id)?.(message.result);
      waits.delete(message.id);
    } else if (message.method === 'Runtime.exceptionThrown') {
      console.log(message.params.exceptionDetails.exception?.description?.slice(0, 300));
    }
  };
  await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html?probe=1` });
  let probe;
  for (let i = 0; i < 100 && !probe; i++) {
    await sleep(800);
    probe = (await call('Runtime.evaluate', {
      expression: 'globalThis.__BE000_PROBE__', returnByValue: true,
    })).result?.value;
  }
  assert.ok(probe, 'Cocos probe did not initialize');
  assert.equal(probe.value, 11520);
  assert.equal(probe.state, '[7,0,1026,12288]');
  assert.equal(probe.sha256, node.sha256, 'Cocos envelope hash differs from Node');
  assert.equal(probe.text, node.text, 'Cocos 24h envelope text differs from Node');
  assert.equal(probe.finalState.gold, node.gold);
  assert.equal(probe.finalState.big, node.big);

  const modulePath = await call('Runtime.evaluate', {
    expression: `(async()=>{for (const p of ['chunks:///_virtual/index.mjs','chunks:///_virtual/spike/index.mjs']) {
      try { const m=await System.import(p); if (m && m.xoshiroStep) return p; } catch {}
    } return null})()`,
    awaitPromise: true, returnByValue: true,
  });
  const browserMath = modulePath.result?.value
    ? (await call('Runtime.evaluate', {
        expression: `(async()=>{const m=await System.import(${JSON.stringify(modulePath.result.value)});const cases=${JSON.stringify(math.cases)};const bad=cases.filter(x=>(x.op==='quantize'?Math.round(x.args[0]*1e6):Math[x.op](...x.args))!==x.value);return {bad,module:${JSON.stringify(modulePath.result.value)}}})()`,
        awaitPromise: true, returnByValue: true,
      })).result?.value
    : null;
  if (browserMath !== null) {
    assert.deepEqual(browserMath.bad, [], 'Cocos Math vectors drifted');
  }
  console.log(JSON.stringify({
    probe: { value: probe.value, state: probe.state },
    node: { sha256: node.sha256, stateHash: node.stateHash, gold: node.gold, big: node.big },
    cocos: { sha256: probe.sha256, gold: probe.finalState.gold, big: probe.finalState.big },
    mathModule: browserMath?.module ?? null,
    mathCases: browserMath === null ? 'not imported' : math.cases.length,
    result: 'PASS',
  }, null, 2));
} finally {
  ws?.close();
  chrome.kill();
  server.closeAllConnections();
  server.close();
}