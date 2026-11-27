import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const COCOS_DIR = fileURLToPath(new URL('../../../packages/game-core/dist/cocos/spike/', import.meta.url));

test('COCOS-01 .mjs artifact imports in Node and reproduces RNG-01', async () => {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(`${COCOS_DIR}index.mjs`).href)) as Record<string, unknown>;
  } catch (error) {
    assert.fail(`missing dist/cocos/spike; run "npm run build:cocos" first (${(error as Error).message})`);
  }
  const xoshiroStep = mod.xoshiroStep as (w: [number, number, number, number]) => {
    value: number;
    state: [number, number, number, number];
  };
  const step = xoshiroStep([1, 2, 3, 4]);
  assert.equal(step.value, 11520);
});

test('COCOS-02 emitted modules and .d.mts declarations use .mjs specifiers only', async () => {
  const names = await readdir(COCOS_DIR);
  const modules = names.filter((n) => n.endsWith('.mjs'));
  const declarations = names.filter((n) => n.endsWith('.d.mts'));
  assert.ok(modules.length >= 9, `expected spike modules, found ${modules.join(',')}`);
  assert.equal(declarations.length, modules.length, 'each module needs a .d.mts declaration');
  for (const name of modules) {
    const text = await readFile(`${COCOS_DIR}${name}`, 'utf8');
    assert.ok(!/(?:from\s*["']|import\s*\(\s*["'])\.{1,2}\/[^"']+\.js["']/.test(text), `${name} still imports .js`);
    assert.ok(!/\brequire\s*\(|\bmodule\.exports\b/.test(text), `${name} contains CJS syntax`);
    assert.ok(!/from\s+["']node:/.test(text), `${name} imports a Node builtin`);
  }
  for (const name of declarations) {
    const text = await readFile(`${COCOS_DIR}${name}`, 'utf8');
    assert.ok(!/(?:from\s*["']|import\s*\(\s*["'])\.{1,2}\/[^"']+\.ts["']/.test(text), `${name} still imports .ts`);
  }
  assert.ok(modules.includes('index.mjs'));
  assert.ok(names.includes('index.d.mts'), 'strict consumers need a declaration next to index.mjs');
});