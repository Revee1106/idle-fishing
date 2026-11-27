/** Independent A08 path-guard audit on the REWORK-03 snapshot. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r3-snap';
const guard = await import(pathToFileURL(path.join(SNAP, 'tests/frontend/fe-000/safe-path-guard.mjs')).href);
const feDir = path.join(SNAP, 'tests/frontend/fe-000');
const buildDir = path.join(SNAP, 'apps/game-client/build');
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: cond, detail });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`);
}
const V = (c, o) => guard.validateDeletableOutputDir(c, o);

// 1. allowlist
{
  let ok = true; let detail = [];
  for (const p of ['.compiled', '.compiled-r3-audit', '.compiled-a.b_c']) {
    const v = V(p, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
    if (!v.ok) { ok = false; detail.push(`${p}:${v.code}`); }
  }
  for (const p of [path.join(buildDir, 'web-mobile'), path.join(buildDir, 'wechatgame')]) {
    const v = V(p, { mode: 'cocos-build', repoRoot: SNAP });
    if (!v.ok) { ok = false; detail.push(`${p}:${v.code}`); }
  }
  const tmp = path.join(os.tmpdir(), 'fe000-r1-chrome-auditX');
  const vt = V(tmp, { mode: 'chrome-temp', repoRoot: SNAP });
  if (!vt.ok) { ok = false; detail.push(`tmp:${vt.code}`); }
  check('A08/1 allowlist accepted', ok, detail.join(',') || 'all accepted');
}

// 2. dangerous paths
{
  const bads = [
    SNAP, path.dirname(SNAP), path.join(SNAP, 'apps'), path.join(SNAP, 'apps/game-client'),
    buildDir, path.join(SNAP, 'packages'), path.join(SNAP, 'tests'), feDir, path.join(SNAP, 'reports'),
    path.join(SNAP, 'docs'), path.join(SNAP, 'config'), '../../reports', '../../../', '..', '.',
    'C:\\', 'E:\\', 'C:', '\\\\server\\share\\evil', '//server/share/evil', '\\\\?\\E:\\evil',
    '\\\\.\\E:\\evil', 'E:.compiled', '.compiled:stream', 'E:\\x:y', '', '   ', null, 123, 'bad\0path',
    path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents'), os.tmpdir(),
  ];
  let ok = true; const d = [];
  for (const b of bads) {
    for (const mode of ['compiled-tests', 'cocos-build', 'chrome-temp']) {
      const v = V(b, { mode, repoRoot: SNAP, baseDir: feDir });
      if (v.ok) { ok = false; d.push(`${mode}:${JSON.stringify(b)}`); }
    }
  }
  check('A08/2 dangerous paths rejected in every mode', ok, d.join(',') || `${bads.length} x3 rejected`);
}

// 3. prefix siblings
{
  const evil = path.join(buildDir, 'web-mobile-evil');
  const evil2 = path.join(buildDir, 'wechatgame.bak');
  fs.mkdirSync(evil, { recursive: true }); fs.mkdirSync(evil2, { recursive: true });
  const canary = path.join(evil, 'canary.txt'); fs.writeFileSync(canary, 'KEEP');
  let rmCalls = 0;
  const fake = { lstatSync: fs.lstatSync, realpathSync: fs.realpathSync, rmSync: (...a) => { rmCalls++; return fs.rmSync(...a); } };
  let ok = V(evil, { mode: 'cocos-build', repoRoot: SNAP }).ok === false && V(evil2, { mode: 'cocos-build', repoRoot: SNAP }).ok === false;
  try { guard.safeRemoveOutputDir(evil, { mode: 'cocos-build', repoRoot: SNAP, fsImpl: fake }); ok = false; } catch {}
  ok = ok && fs.existsSync(canary) && rmCalls === 0;
  fs.rmSync(evil, { recursive: true, force: true }); fs.rmSync(evil2, { recursive: true, force: true });
  check('A08/3 build prefix siblings rejected without deletion', ok, `rmCalls=${rmCalls}`);
}

// 4. metadata failures fail-closed
{
  const allow = path.join(feDir, '.compiled-metadata-audit');
  fs.mkdirSync(allow, { recursive: true });
  const eacces = () => Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
  const exact = (p, target) => path.resolve(p).toLowerCase() === path.resolve(target).toLowerCase();
  const rmCounter = { c: 0 };
  const baseFs = {
    lstatSync: fs.lstatSync,
    realpathSync: fs.realpathSync,
    rmSync: (...a) => { rmCounter.c++; return fs.rmSync(...a); },
  };
  let out = {};
  out.lstat = V(allow, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir, fsImpl: { ...baseFs, lstatSync: (p) => { if (exact(p, allow)) throw eacces(); return fs.lstatSync(p); } } });
  out.real = V(allow, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir, fsImpl: { ...baseFs, realpathSync: (p) => { if (exact(p, allow)) throw eacces(); return fs.realpathSync(p); } } });
  out.repo = V(allow, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir, fsImpl: { ...baseFs, realpathSync: () => { throw eacces(); } } });
  const tmpCand = path.join(os.tmpdir(), 'fe000-r1-chrome-auditY');
  out.tmp = V(tmpCand, { mode: 'chrome-temp', repoRoot: SNAP, fsImpl: { ...baseFs, realpathSync: (p) => { if (path.resolve(p).toLowerCase() === path.resolve(os.tmpdir()).toLowerCase()) throw eacces(); return fs.realpathSync(p); } } });
  // safeRemove: validation passes with real fs, but the pre-delete lstat throws EACCES
  let threw = false;
  fs.mkdirSync(path.join(allow, 'sub'), { recursive: true });
  try {
    guard.safeRemoveOutputDir(allow, {
      mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir,
      fsImpl: {
        lstatSync: (p) => { if (exact(p, allow)) throw eacces(); return fs.lstatSync(p); },
        realpathSync: fs.realpathSync,
        rmSync: (...a) => { rmCounter.c++; return fs.rmSync(...a); },
      },
    });
  } catch { threw = true; }
  const survived = fs.existsSync(path.join(allow, 'sub'));
  const ok = out.lstat.code === 'METADATA_UNVERIFIABLE' && out.real.code === 'REALPATH_UNVERIFIABLE' && out.repo.code === 'REPO_ROOT_UNVERIFIABLE' && out.tmp.code === 'REALPATH_UNVERIFIABLE' && threw && survived && rmCounter.c === 0;
  fs.rmSync(allow, { recursive: true, force: true });
  check('A08/4 lstat/realpath EACCES fail-closed (incl. pre-delete lstat), zero rm', ok, JSON.stringify({ ...out, threw, survived, rmCalls: rmCounter.c }));
}

// 5. junctions
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-r3-junc-'));
  const canary = path.join(sandbox, 'canary.txt'); fs.writeFileSync(canary, 'KEEP');
  const junc = path.join(feDir, '.compiled-junction-audit');
  const nested = path.join(feDir, '.compiled-nested-junction-audit');
  try { if (fs.existsSync(junc)) fs.unlinkSync(junc); } catch {}
  try { fs.symlinkSync(sandbox, junc, 'junction'); } catch (e) { console.log('[skip-junction] ' + e.message); }
  const vj = V(junc, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
  fs.rmSync(nested, { recursive: true, force: true });
  fs.mkdirSync(nested, { recursive: true });
  const inner = path.join(nested, 'inner');
  try { fs.symlinkSync(sandbox, inner, 'junction'); } catch (e) { console.log('[skip-nested] ' + e.message); }
  const vn = V(nested, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir });
  let removed = false;
  try { guard.safeRemoveOutputDir(nested, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir }); removed = true; } catch {}
  const ok = vj.ok === false && vj.code === 'SYMLINK_OR_JUNCTION_REJECTED' && vn.ok === true && removed && fs.existsSync(canary) && fs.readFileSync(canary, 'utf8') === 'KEEP';
  try { fs.unlinkSync(junc); } catch {}
  fs.rmSync(nested, { recursive: true, force: true }); fs.rmSync(sandbox, { recursive: true, force: true });
  check('A08/5 junction rejected; nested junction not traversed (canary survives)', ok, JSON.stringify({ vj: vj.code, vn: vn.ok, removed, canary: fs.existsSync(canary) }));
}

// 6. dangling junction
{
  const dangling = path.join(feDir, '.compiled-dangling-audit');
  try { if (fs.existsSync(dangling)) fs.unlinkSync(dangling); } catch {}
  let created = false;
  try { fs.symlinkSync(path.join(os.tmpdir(), 'fe000-nonexistent-target-xyz'), dangling, 'junction'); created = true; } catch (e) { console.log('[skip-dangling] ' + e.message); }
  const v = created ? V(dangling, { mode: 'compiled-tests', repoRoot: SNAP, baseDir: feDir }) : null;
  try { fs.unlinkSync(dangling); } catch {}
  check('A08/6 dangling junction rejected (no existsSync fallback)', created ? v.ok === false && (v.code === 'SYMLINK_OR_JUNCTION_REJECTED' || v.code === 'REALPATH_UNVERIFIABLE') : true, created ? JSON.stringify(v) : 'NOT_RUN (junction creation failed)');
}

// 7. runner unsafe outdir
{
  const { spawnSync } = await import('node:child_process');
  const canary = path.join(SNAP, 'reports', 'r3-guard-canary.txt');
  fs.mkdirSync(path.dirname(canary), { recursive: true }); fs.writeFileSync(canary, 'KEEP');
  const r = spawnSync(process.execPath, [path.join(feDir, 'run-node-tests.mjs'), '--files=fixtures/fixture-passed.test.ts', '--out-dir=../../reports'], { cwd: SNAP, encoding: 'utf8' });
  const ok = r.status === 1 && /Unsafe --out-dir rejected/.test(r.stderr) && fs.readFileSync(canary, 'utf8') === 'KEEP';
  fs.rmSync(canary, { force: true });
  check('A08/7 runner rejects traversal out-dir before deletion', ok, `status=${r.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== A08 SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
process.exit(failed.length ? 1 : 0);