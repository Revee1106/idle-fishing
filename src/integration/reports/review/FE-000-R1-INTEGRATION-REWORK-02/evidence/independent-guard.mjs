/** Independent P2-05 safe-path-guard audit (runs against snapshot copies only). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap';
const guard = await import(pathToFileURL(path.join(SNAP, 'tests/frontend/fe-000/safe-path-guard.mjs')).href);
const feDir = path.join(SNAP, 'tests/frontend/fe-000');
const buildDir = path.join(SNAP, 'apps/game-client/build');
const results = [];
let current = '';
function begin(n) {
  current = n;
}
function check(c, d) {
  if (!c) throw new Error(`ASSERTION FAILED [${current}]: ${d}`);
}
function run(name, fn) {
  begin(name);
  try {
    fn();
    results.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: e.message });
    console.log(`[FAIL] ${name} :: ${e.message}`);
  }
}
const V = (candidate, opts) => guard.validateDeletableOutputDir(candidate, opts);

run('P2-05/T1 authorized allowlist entries accepted', () => {
  for (const p of ['.compiled', '.compiled-r2-audit', '.compiled-a.b_c']) {
    const v = V(p, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    check(v.ok === true, `${p} rejected: ${JSON.stringify(v)}`);
  }
  for (const p of [path.join(buildDir, 'web-mobile'), path.join(buildDir, 'wechatgame')]) {
    const v = V(p, { mode: 'cocos-build', repoRoot: SNAP });
    check(v.ok === true, `${p} rejected: ${JSON.stringify(v)}`);
  }
  const tmpChild = path.join(os.tmpdir(), 'fe000-r1-chrome-audit123');
  const v = V(tmpChild, { mode: 'chrome-temp', repoRoot: SNAP });
  check(v.ok === true, `${tmpChild} rejected: ${JSON.stringify(v)}`);
});

run('P2-05/T2 rejects roots, UNC, repo, parent, protected dirs, traversal', () => {
  const bads = [
    SNAP,
    path.dirname(SNAP),
    path.join(SNAP, 'apps'),
    path.join(SNAP, 'apps/game-client'),
    path.join(SNAP, 'apps/game-client/build'),
    path.join(SNAP, 'packages'),
    path.join(SNAP, 'tests'),
    path.join(SNAP, 'tests/frontend'),
    feDir,
    path.join(SNAP, 'reports'),
    path.join(SNAP, 'docs'),
    path.join(SNAP, 'config'),
    '../../reports',
    '../../../',
    '..',
    '.',
    'C:\\',
    'E:\\',
    'C:',
    '\\\\server\\share\\evil',
    '//server/share/evil',
    '\\\\?\\E:\\evil',
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    os.tmpdir(),
    '',
    '   ',
    null,
    123,
    'bad\0path',
  ];
  for (const bad of bads) {
    for (const mode of ['compiled-tests', 'cocos-build', 'chrome-temp']) {
      const v = V(bad, { mode, repoRoot: SNAP, baseDir: feDir });
      check(v.ok === false, `mode=${mode} must reject ${JSON.stringify(bad)} but got ${JSON.stringify(v)}`);
    }
  }
});

run('P2-05/T3 build-evil sibling prefix is NOT accepted (string-prefix hole)', () => {
  const evil = path.join(buildDir, 'web-mobile-evil');
  fs.mkdirSync(evil, { recursive: true });
  const canary = path.join(evil, 'canary.txt');
  fs.writeFileSync(canary, 'CANARY', 'utf8');
  try {
    const v = V(evil, { mode: 'cocos-build', repoRoot: SNAP });
    check(v.ok === false && v.code === 'OUTSIDE_BUILD_ALLOWLIST', `build-evil must be rejected: ${JSON.stringify(v)}`);
    assert.throws(() => guard.safeRemoveOutputDir(evil, { mode: 'cocos-build', repoRoot: SNAP }));
    check(fs.existsSync(canary), 'canary inside build-evil must survive');
    // Directory sibling to an allowed cocos output with prefix name
    const evil2 = path.join(buildDir, 'web-mobile.bak');
    fs.mkdirSync(evil2, { recursive: true });
    check(V(evil2, { mode: 'cocos-build', repoRoot: SNAP }).ok === false, 'web-mobile.bak must be rejected');
  } finally {
    fs.rmSync(evil, { recursive: true, force: true });
    fs.rmSync(path.join(buildDir, 'web-mobile.bak'), { recursive: true, force: true });
  }
});

run('P2-05/T4 compiled sibling prefix / wrong basenames rejected', () => {
  const bads = [
    '.compiledx',
    '.compiled-',
    '.compiled.',
    'compiled',
    'fixtures',
    '.compiled/child',
  ];
  for (const b of bads) {
    const v = V(path.join(feDir, b), { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    check(v.ok === false, `${b} must be rejected, got ${JSON.stringify(v)}`);
  }
});

run('P2-05/T5 Windows junction escape rejected and target never deleted', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r2-canary-'));
  const canary = path.join(sandbox, 'must-survive.txt');
  fs.writeFileSync(canary, 'KEEP', 'utf8');
  const junction = path.join(feDir, '.compiled-r2-junction');
  try {
    try {
      if (fs.existsSync(junction)) fs.unlinkSync(junction);
    } catch {}
    fs.symlinkSync(sandbox, junction, 'junction');
    const v = V(junction, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    check(v.ok === false && v.code === 'SYMLINK_OR_JUNCTION_REJECTED', `junction must be rejected: ${JSON.stringify(v)}`);
    assert.throws(() => guard.safeRemoveOutputDir(junction, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir }));
    check(fs.readFileSync(canary, 'utf8') === 'KEEP', 'canary behind junction must survive');
  } finally {
    try {
      if (fs.existsSync(junction)) fs.unlinkSync(junction);
    } catch {}
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

run('P2-05/T6 nested junction inside an allowed dir is not traversed by rm', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r2-nested-'));
  const canary = path.join(sandbox, 'nested-canary.txt');
  fs.writeFileSync(canary, 'KEEP', 'utf8');
  const allowed = path.join(feDir, '.compiled-r2-nested');
  const inner = path.join(allowed, 'inner-link');
  try {
    fs.rmSync(allowed, { recursive: true, force: true });
    fs.mkdirSync(allowed, { recursive: true });
    fs.writeFileSync(path.join(allowed, 'own-file.txt'), 'x', 'utf8');
    fs.symlinkSync(sandbox, inner, 'junction');
    const v = V(allowed, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    check(v.ok === true, `allowed dir with nested junction must validate: ${JSON.stringify(v)}`);
    let rmError = null;
    try {
      guard.safeRemoveOutputDir(allowed, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    } catch (e) {
      rmError = e;
    }
    console.log(`   [evidence] rm of dir containing nested junction error=${rmError ? rmError.code || rmError.message : 'none'} canaryExists=${fs.existsSync(canary)}`);
    check(fs.existsSync(canary), 'canary behind nested junction must survive recursive delete');
    check(!fs.existsSync(allowed), 'allowed dir itself should be removed');
  } finally {
    fs.rmSync(allowed, { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

run('P2-05/T7 symlinked file candidate rejected / dangling junction behaviour', () => {
  const target = path.join(feDir, '.compiled-r2-file-target');
  const link = path.join(feDir, '.compiled-r2-file-link');
  fs.writeFileSync(target, 'x', 'utf8');
  try {
    try {
      if (fs.existsSync(link)) fs.unlinkSync(link);
    } catch {}
    try {
      fs.symlinkSync(target, link, 'file');
    } catch (e) {
      console.log(`   [skip-link] cannot create file symlink: ${e.message}`);
      return;
    }
    const v = V(link, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    check(v.ok === false && v.code === 'SYMLINK_OR_JUNCTION_REJECTED', `file symlink must be rejected: ${JSON.stringify(v)}`);
    check(fs.existsSync(target), 'symlink target must survive');
  } finally {
    try {
      if (fs.existsSync(link)) fs.unlinkSync(link);
    } catch {}
    fs.rmSync(target, { force: true });
  }
});

run('P2-05/T8 relative path resolution & case-insensitivity', () => {
  // Allowed relative path resolved under baseDir
  check(V('.compiled-ok', { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir }).ok === true, 'relative valid rejected');
  // Traversal from feDir to reports
  check(V('../../../reports', { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir }).ok === false, 'traversal accepted');
  // Windows case-insensitive allowlist
  const upper = path.join(SNAP, 'APPS/GAME-CLIENT/BUILD/WEB-MOBILE');
  const v = V(upper, { mode: 'cocos-build', repoRoot: SNAP });
  console.log(`   [evidence] case-variant build path accepted=${v.ok} code=${v.code || ''}`);
  check(v.ok === true, `case-insensitive exact build path should be accepted: ${JSON.stringify(v)}`);
  // Trailing separator and forward slashes
  const fwd = path.join(SNAP, 'apps/game-client/build/web-mobile').replace(/\\/g, '/') + '/';
  const v2 = V(fwd, { mode: 'cocos-build', repoRoot: SNAP });
  check(v2.ok === true, `forward-slash/trailing-sep should be accepted: ${JSON.stringify(v2)}`);
  // Something outside allowlist but inside build dir
  check(V(path.join(buildDir, 'wechatgame2'), { mode: 'cocos-build', repoRoot: SNAP }).ok === false, 'wechatgame2 accepted');
});

// Delegate path guard integration: runner must reject BEFORE deleting; verify canary in reports untouched
run('P2-05/T9 runner --out-dir traversal rejects with zero deletion', () => {
  const canary = path.join(SNAP, 'reports', 'audit-canary.txt');
  fs.mkdirSync(path.dirname(canary), { recursive: true });
  fs.writeFileSync(canary, 'KEEP', 'utf8');
  try {
    const r = spawnSync(process.execPath, [path.join(feDir, 'run-node-tests.mjs'), '--files=fixtures/fixture-passed.test.ts', '--out-dir=../../reports'], {
      cwd: SNAP,
      encoding: 'utf8',
    });
    check(r.status === 1, `runner status=${r.status}`);
    check(/Unsafe --out-dir rejected/.test(r.stderr), `stderr=${r.stderr}`);
    check(fs.readFileSync(canary, 'utf8') === 'KEEP', 'reports canary must survive');
    check(fs.existsSync(path.join(SNAP, 'reports')), 'reports dir must still exist');
  } finally {
    fs.rmSync(canary, { force: true });
  }
});

const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n===== P2-05 SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
if (failed.length) {
  failed.forEach((f) => console.log(`FAILED: ${f.name} :: ${f.detail}`));
  process.exit(1);
}
process.exit(0);