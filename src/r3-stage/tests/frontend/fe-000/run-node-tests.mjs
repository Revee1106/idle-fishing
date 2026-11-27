/**
 * Supervised Frontend Node/Mock Test Runner (P1-03 / N4+N5+A07 & P2-05 / N6+A08 hardened).
 *
 * Guarantees:
 * 1. P2-05 (N6+A08): Any --out-dir is strictly authorized via safe-path-guard.mjs BEFORE any deletion.
 * 2. P1-03 (N4+A07): Counts ONLY true executed leaf test cases across ALL nesting depths using
 *    the worker's DFS event tree, matching Node 24 TODO semantics (including throwing TODOs)
 *    while enforcing total > 0 and passed > 0.
 * 3. P1-03 (N5+A07): Executes each compiled test file in an isolated supervised child process
 *    with a mandatory bounded timeout (`--worker-timeout-ms`, default 180000ms) and completion
 *    sentinel; module load crashes, process.exit(0) early exits, uncaught exceptions, hanging
 *    workers, and abnormal signals ALL fail non-zero.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeDeletableOutputDir, safeRemoveOutputDir } from './safe-path-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const defaultCompiledDir = path.join(__dirname, '.compiled');
const workerScript = path.join(__dirname, 'node-test-worker.mjs');

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

const timeoutArg = process.argv.find((a) => a.startsWith('--worker-timeout-ms='));
const rawTimeout = timeoutArg
  ? timeoutArg.slice('--worker-timeout-ms='.length)
  : process.env.FE000_WORKER_TIMEOUT_MS || '180000';
const workerTimeoutMs = Number(rawTimeout);
if (!Number.isFinite(workerTimeoutMs) || workerTimeoutMs < 200 || workerTimeoutMs > 600_000) {
  console.error(`[FE-000 Test Runner] FAIL: Invalid --worker-timeout-ms value: ${rawTimeout} (must be 200..600000)`);
  process.exit(1);
}

for (const rel of requestedTestSources) {
  const full = path.resolve(__dirname, rel);
  if (!fs.existsSync(full)) {
    console.error(`[FE-000 Test Runner] FAIL: Missing required test file: ${full}`);
    process.exit(1);
  }
}

// P2-05: Validate --out-dir against strict allowlist BEFORE any deletion!
const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
const rawOutDir = outDirArg ? outDirArg.slice('--out-dir='.length) : defaultCompiledDir;
let activeCompiledDir;
try {
  activeCompiledDir = assertSafeDeletableOutputDir(rawOutDir, {
    mode: 'compiled-tests',
    repoRoot,
    baseDir: __dirname,
  });
  safeRemoveOutputDir(activeCompiledDir, {
    mode: 'compiled-tests',
    repoRoot,
    baseDir: __dirname,
  });
} catch (err) {
  console.error(`[FE-000 Test Runner] FAIL: Unsafe --out-dir rejected: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tscBin)) {
  console.error('TypeScript compiler not found at:', tscBin);
  process.exit(2);
}

const compile = spawnSync(
  process.execPath,
  [tscBin, '--project', path.join(__dirname, 'tsconfig.json'), '--outDir', activeCompiledDir],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
  }
);

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
patchDir(activeCompiledDir);

const compiledTestFiles = requestedTestSources.map((rel) => {
  const relNorm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return path.join(activeCompiledDir, 'tests', 'frontend', 'fe-000', relNorm.replace(/\.ts$/, '.js'));
});

for (const f of compiledTestFiles) {
  if (!fs.existsSync(f)) {
    console.error(`[FE-000 Test Runner] FAIL: Compiled test file missing: ${f}`);
    process.exit(1);
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;
let todo = 0;
let containerFailures = 0;
let processErrors = 0;

const ipcTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-worker-ipc-'));
try {
  for (let i = 0; i < compiledTestFiles.length; i++) {
    const testFile = compiledTestFiles[i];
    const resultJsonPath = path.join(ipcTmpDir, `result-${i}.json`);
    const child = spawnSync(process.execPath, [workerScript, testFile, resultJsonPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: workerTimeoutMs,
      killSignal: 'SIGKILL',
    });

    if (child.stdout) process.stdout.write(child.stdout);
    if (child.stderr) process.stderr.write(child.stderr);

    if (child.error) {
      const code = child.error.code || '';
      if (code === 'ETIMEDOUT') {
        console.error(
          `[FE-000 Test Runner] FAIL: Worker timed out after ${workerTimeoutMs}ms and was terminated: ${testFile}`
        );
      } else {
        console.error(`[FE-000 Test Runner] FAIL: Worker spawn error for ${testFile}: ${child.error.message}`);
      }
      processErrors += 1;
      continue;
    }

    if (child.signal) {
      console.error(`[FE-000 Test Runner] FAIL: Test process terminated abnormally by signal ${child.signal}: ${testFile}`);
      processErrors += 1;
      continue;
    }

    if (!fs.existsSync(resultJsonPath)) {
      console.error(
        `[FE-000 Test Runner] FAIL: Test process exited (code=${child.status}) WITHOUT completing test runner (possible premature process.exit() or module crash): ${testFile}`
      );
      processErrors += 1;
      continue;
    }

    let report;
    try {
      report = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
    } catch (err) {
      console.error(`[FE-000 Test Runner] FAIL: Corrupted worker report for ${testFile}: ${err}`);
      processErrors += 1;
      continue;
    }

    if (report.completed !== true) {
      console.error(`[FE-000 Test Runner] FAIL: Incomplete test execution sentinel for ${testFile}`);
      processErrors += 1;
      continue;
    }

    passed += Number(report.passed || 0);
    failed += Number(report.failed || 0);
    skipped += Number(report.skipped || 0);
    todo += Number(report.todo || 0);
    containerFailures += Number(report.containerFailures || 0);

    if (report.streamError || report.uncaughtError) {
      console.error(`[FE-000 Test Runner] FAIL: Worker error in ${testFile}: ${report.streamError || report.uncaughtError}`);
      processErrors += 1;
    } else if (child.status !== 0 && Number(report.failed || 0) === 0 && Number(report.containerFailures || 0) === 0) {
      console.error(`[FE-000 Test Runner] FAIL: Worker exited non-zero (${child.status}) for ${testFile}`);
      processErrors += 1;
    }
  }
} finally {
  fs.rmSync(ipcTmpDir, { recursive: true, force: true });
}

const total = passed + failed + skipped + todo;
console.log(
  `\n[FE-000 Test Summary] total=${total} pass=${passed} fail=${failed} skip=${skipped} todo=${todo} containerFail=${containerFailures} procErr=${processErrors}`
);

if (processErrors > 0) {
  console.error(`[FE-000 Test Runner] FAIL: ${processErrors} test process/runtime error(s) detected.`);
  process.exit(1);
}
if (containerFailures > 0) {
  console.error(`[FE-000 Test Runner] FAIL: ${containerFailures} suite/container failure(s) detected.`);
  process.exit(1);
}
if (total === 0) {
  console.error('[FE-000 Test Runner] FAIL: 0 leaf test cases registered/executed (empty test file guard triggered).');
  process.exit(1);
}
if (passed === 0) {
  console.error(
    `[FE-000 Test Runner] FAIL: 0 leaf tests passed (total=${total}, skip=${skipped}, todo=${todo}, fail=${failed}).`
  );
  process.exit(1);
}
if (failed > 0) {
  console.error(`[FE-000 Test Runner] FAIL: ${failed} leaf test(s) failed.`);
  process.exit(1);
}
process.exit(0);
