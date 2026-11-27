/**
 * SPIKE-ONLY: convert the tsc ESM output (dist/spike/*.js) into .mjs files
 * for Cocos Creator asset imports.
 *
 * Cocos Creator 3.8 asset-db treats plain .js assets as CommonJS, which breaks
 * ESM files using import/export. Renaming to .mjs and rewriting relative
 * specifiers was verified against Cocos Creator 3.8.8 web-mobile (see
 * reports/backend/BE-000/SHARED_MODULE_HANDOFF.md). This does not imply
 * WeChat real-device or other platform support.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = fileURLToPath(new URL('../dist/spike/', import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL('../dist/cocos/spike/', import.meta.url));

const RELATIVE_SPECIFIER = /(from\s*["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)\.js(["'])/g;
const REMAINING_JS_SPECIFIER = /(?:from\s*["']|import\s*\(\s*["'])\.{1,2}\/[^"']+\.js["']/;
const DECLARATION_SPECIFIER = /(from\s*["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)\.(?:ts|js)(["'])/g;
const REMAINING_TS_SPECIFIER = /(?:from\s*["']|import\s*\(\s*["'])\.{1,2}\/[^"']+\.ts["']/;

async function main() {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const names = await readdir(SOURCE_DIR);
  let emitted = 0;
  let declarations = 0;
  for (const name of names) {
    if (name.endsWith('.d.ts')) {
      const text = await readFile(`${SOURCE_DIR}${name}`, 'utf8');
      const outName = name.replace(/\.d\.ts$/, '.d.mts');
      const converted = text.replace(DECLARATION_SPECIFIER, '$1$2.mjs$3');
      if (REMAINING_TS_SPECIFIER.test(converted)) {
        throw new Error(`unconverted relative .ts specifier remains in ${outName}`);
      }
      await writeFile(`${OUTPUT_DIR}${outName}`, converted, 'utf8');
      declarations += 1;
      continue;
    }
    if (!name.endsWith('.js')) continue;
    const text = await readFile(`${SOURCE_DIR}${name}`, 'utf8');
    const outName = name.slice(0, -3) + '.mjs';
    const converted = text.replace(RELATIVE_SPECIFIER, '$1$2.mjs$3');
    if (REMAINING_JS_SPECIFIER.test(converted)) {
      throw new Error(`unconverted relative .js specifier remains in ${outName}`);
    }
    if (/\brequire\s*\(|\bmodule\.exports\b/.test(converted)) {
      throw new Error(`CJS syntax found in ${outName}`);
    }
    await writeFile(`${OUTPUT_DIR}${outName}`, converted, 'utf8');
    emitted += 1;
  }

  if (emitted === 0) throw new Error(`no built .js files in ${SOURCE_DIR}; run "npm run build" first`);
  console.log(`cocos artifacts: ${emitted} .mjs + ${declarations} .d.mts -> ${OUTPUT_DIR}`);
}

await main();