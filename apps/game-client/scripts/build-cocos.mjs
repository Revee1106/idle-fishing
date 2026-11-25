/**
 * Reproducible Cocos Creator 3.8.8 CLI build runner for FE-000 / FE-000-R1.
 * Usage: node scripts/build-cocos.mjs <web-mobile|wechatgame>
 *
 * Strictly validates build artifacts (not just exit code / non-empty directory):
 * - web-mobile: verifies index.html, src/settings.json, assets/main, assets/resources, assets/spike-pack
 * - wechatgame: verifies game.js, game.json subpackages registration for spike-pack,
 *   subpackage root entry game.js + config.json + manifest + icon assets!
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const target = process.argv[2] || 'web-mobile';

const CONFIG_MAP = {
  'web-mobile': path.join(clientRoot, 'build-configs', 'buildConfig_web-mobile.json'),
  wechatgame: path.join(clientRoot, 'build-configs', 'buildConfig_wechatgame.json'),
};

if (!CONFIG_MAP[target]) {
  console.error(`Unsupported target "${target}". Expected: web-mobile | wechatgame`);
  process.exit(2);
}

const cocosExe =
  process.env.COCOS_CREATOR_EXE ||
  'C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\CocosCreator.exe';

if (!fs.existsSync(cocosExe)) {
  console.error(`CocosCreator.exe not found at: ${cocosExe}`);
  process.exit(3);
}

const configPath = CONFIG_MAP[target];
const args = ['--project', clientRoot, '--build', `configPath=${configPath}`];

console.log(`[FE-000 Build] Target: ${target}`);
console.log(`[FE-000 Build] Exe: ${cocosExe}`);
console.log(`[FE-000 Build] Args: ${JSON.stringify(args)}`);

const t0 = Date.now();
const result = spawnSync(cocosExe, args, {
  cwd: clientRoot,
  encoding: 'utf8',
  windowsHide: true,
});
const elapsedMs = Date.now() - t0;

const outDir = path.join(clientRoot, 'build', target);
const exists = fs.existsSync(outDir);

function dirSize(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirSize(full);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      bytes += fs.statSync(full).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const totalStats = dirSize(outDir);
console.log(`[FE-000 Build] Raw Exit Code: ${result.status}`);
console.log(`[FE-000 Build] Duration: ${elapsedMs} ms`);
console.log(`[FE-000 Build] Output Exists: ${exists} (${outDir})`);
console.log(
  `[FE-000 Build] Total Output: ${totalStats.files} files, ${(totalStats.bytes / 1024).toFixed(2)} KB (${totalStats.bytes} bytes)`
);

const combinedLog = `${result.stdout || ''}\n${result.stderr || ''}`;
const workerExitWarn = /Workers failed to exit gracefully/i.test(combinedLog);
const missingClassErr = /Missing class:|Script .+ is missing or invalid/i.test(combinedLog);
if (workerExitWarn) {
  console.log('[FE-000 Build] Notice: Cocos CLI stderr contained "Workers failed to exit gracefully"');
}
if (missingClassErr) {
  console.error('[FE-000 Build] ERROR: Missing class / invalid scene script detected in Cocos log');
}

if (result.stdout) {
  const tail = result.stdout.split(/\r?\n/).slice(-25).join('\n');
  console.log('--- STDOUT TAIL ---\n' + tail);
}
if (result.stderr) {
  const tail = result.stderr.split(/\r?\n/).slice(-25).join('\n');
  console.log('--- STDERR TAIL ---\n' + tail);
}

const rawOk = (result.status === 36 || result.status === 0) && exists && totalStats.files > 0 && !missingClassErr;
if (!rawOk) {
  console.error(`[FE-000 Build] FAILED (status=${result.status}, outputExists=${exists}, missingClass=${missingClassErr})`);
  process.exit(result.status && result.status !== 36 ? result.status : 1);
}

// Strict artifact manifest validation (V02 + I02)
const errors = [];
if (target === 'web-mobile') {
  for (const rel of ['index.html', 'src/settings.json', 'assets/main', 'assets/resources', 'assets/spike-pack']) {
    if (!fs.existsSync(path.join(outDir, rel))) {
      errors.push(`Missing required web-mobile artifact: ${rel}`);
    }
  }
} else if (target === 'wechatgame') {
  const verifier = path.resolve(clientRoot, '../../tests/frontend/fe-000/verify-wechat-build.mjs');
  if (fs.existsSync(verifier)) {
    const check = spawnSync(process.execPath, [verifier, outDir], { cwd: clientRoot, stdio: 'inherit' });
    if (check.status !== 0) {
      errors.push(`WeChat artifact verifier failed with exit code ${check.status}`);
    }
  } else {
    errors.push(`Missing WeChat artifact verifier: ${verifier}`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`[FE-000 Build] ARTIFACT ERROR: ${e}`);
  process.exit(1);
}

console.log(`[FE-000 Build] SUCCESS (Cocos raw status=${result.status}, artifact checks PASSED)`);
process.exit(0);
