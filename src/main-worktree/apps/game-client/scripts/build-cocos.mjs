/**
 * Reproducible Cocos Creator 3.8.8 CLI build runner for FE-000.
 * Usage: node scripts/build-cocos.mjs <web-mobile|wechatgame>
 *
 * Records exact command, raw exit code, build duration, and output package sizes.
 * Note: Cocos Creator 3.8 CLI conventionally exits with code 36 on successful build.
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
const subpackDir = path.join(outDir, 'subpackages', 'spike-pack');
const subpackStats = dirSize(subpackDir);

console.log(`[FE-000 Build] Raw Exit Code: ${result.status}`);
console.log(`[FE-000 Build] Duration: ${elapsedMs} ms`);
console.log(`[FE-000 Build] Output Exists: ${exists} (${outDir})`);
console.log(
  `[FE-000 Build] Total Output: ${totalStats.files} files, ${(totalStats.bytes / 1024).toFixed(2)} KB (${totalStats.bytes} bytes)`
);
if (subpackStats.files > 0) {
  console.log(
    `[FE-000 Build] Subpackage spike-pack: ${subpackStats.files} files, ${(subpackStats.bytes / 1024).toFixed(2)} KB (${subpackStats.bytes} bytes)`
  );
}

if (result.stdout) {
  const tail = result.stdout.split(/\r?\n/).slice(-30).join('\n');
  console.log('--- STDOUT TAIL ---\n' + tail);
}
if (result.stderr) {
  const tail = result.stderr.split(/\r?\n/).slice(-30).join('\n');
  console.log('--- STDERR TAIL ---\n' + tail);
}

// Cocos Creator 3.8 CLI returns 36 when build succeeds cleanly, or 0 in some configurations.
const ok = (result.status === 36 || result.status === 0) && exists && totalStats.files > 0;
if (!ok) {
  console.error(`[FE-000 Build] FAILED (status=${result.status}, outputExists=${exists})`);
  process.exit(result.status || 1);
}
console.log(`[FE-000 Build] SUCCESS (Cocos raw status=${result.status})`);
process.exit(0);
