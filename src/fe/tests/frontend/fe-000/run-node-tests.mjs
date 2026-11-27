/**
 * Compiles and executes FE-000-R1 Node/Mock automated tests without modifying root tsconfig.
 * V01 gate: explicitly fails (non-zero exit code) if test files are missing OR 0 tests execute!
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const compiledDir = path.join(__dirname, '.compiled');

// Allow explicit test file override via --files=... to verify missing/zero-test failure behavior
const filesArg = process.argv.find((a) => a.startsWith('--files='));
const requestedTestSources = filesArg
  ? filesArg
      .slice('--files='.length)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : ['platform-and-core.test.ts'];

if (requestedTestSources.length === 0) {
  console.error('[FE-000 Test Runner] FAIL: 0 test files specified.');
  process.exit(1);
}

for (const rel of requestedTestSources) {
  const full = path.resolve(__dirname, rel);
  if (!fs.existsSync(full)) {
    console.error(`[FE-000 Test Runner] FAIL: Missing required test file: ${full}`);
    process.exit(1);
  }
}

// Clean previous build
fs.rmSync(compiledDir, { recursive: true, force: true });

const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tscBin)) {
  console.error('TypeScript compiler not found at:', tscBin);
  process.exit(2);
}

const compile = spawnSync(process.execPath, [tscBin, '--project', path.join(__dirname, 'tsconfig.json')], {
  cwd: repoRoot,
  encoding: 'utf8',
});

if (compile.status !== 0) {
  console.error('TypeScript compilation failed:\n', compile.stdout, compile.stderr);
  process.exit(compile.status || 1);
}

// Patch relative extensionless imports in compiled .js files for Node ESM execution
function patchDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchDir(full);
    } else if (entry.name.endsWith('.js')) {
      let text = fs.readFileSync(full, 'utf8');
      text = text.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (match, p1, specifier, p3) =>
        specifier.endsWith('.js') || specifier.endsWith('.json') ? match : `${p1}${specifier}.js${p3}`
      );
      fs.writeFileSync(full, text, 'utf8');
    }
  }
}
patchDir(compiledDir);

const compiledTestFiles = requestedTestSources.map((rel) =>
  path.join(compiledDir, 'tests', 'frontend', 'fe-000', rel.replace(/\.ts$/, '.js'))
);

for (const f of compiledTestFiles) {
  if (!fs.existsSync(f)) {
    console.error(`[FE-000 Test Runner] FAIL: Compiled test file missing: ${f}`);
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;

const stream = run({ files: compiledTestFiles, concurrency: false });
stream.on('test:pass', (ev) => {
  if (ev.nesting === 0) passed += 1;
});
stream.on('test:fail', (ev) => {
  if (ev.nesting === 0) failed += 1;
});
stream.on('test:skip', (ev) => {
  if (ev.nesting === 0) skipped += 1;
});

stream.compose(new spec()).pipe(process.stdout);

await new Promise((resolve, reject) => {
  stream.on('end', resolve);
  stream.on('error', reject);
});

const total = passed + failed + skipped;
console.log(`\n[FE-000 Test Summary] total=${total} pass=${passed} fail=${failed} skip=${skipped}`);

// V01 hard gate: zero executed tests MUST fail!
if (total === 0 || passed === 0) {
  console.error('[FE-000 Test Runner] FAIL: 0 tests executed or 0 passed (zero-test guard triggered).');
  process.exit(1);
}
if (failed > 0) {
  console.error(`[FE-000 Test Runner] FAIL: ${failed} test(s) failed.`);
  process.exit(1);
}
process.exit(0);
