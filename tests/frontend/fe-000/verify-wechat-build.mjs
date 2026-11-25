/**
 * Strict WeChat Mini Game artifact & subpackage verifier for FE-000-R1 (I02 + V02 + T10).
 * Checks ACTUAL Cocos wechatgame build outputs:
 * - game.json subpackages registration (`spike-pack` name + root)
 * - Subpackage root directory, entry game.js, bundle config.json, manifest JSON & icon PNG
 * - project.config.json (compileType=game, appid), main game.js, src/settings.json
 * - Computes exact total / main / subpackage byte counts and exits non-zero on ANY missing item.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBuildDir = path.resolve(__dirname, '../../../apps/game-client/build/wechatgame');
const buildDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultBuildDir;
const reportOut = process.argv[3] ? path.resolve(process.argv[3]) : null;

const errors = [];
const checks = [];

function addCheck(name, ok, detail) {
  checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) errors.push(`${name}: ${detail}`);
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push({ full, rel: path.relative(dir, full).replace(/\\/g, '/'), size: fs.statSync(full).size });
    }
  }
  return out;
}

addCheck('wechatgame_dir_exists', fs.existsSync(buildDir), buildDir);
if (!fs.existsSync(buildDir)) {
  console.error(`[WeChat Audit] FAIL: build directory not found: ${buildDir}`);
  process.exit(1);
}

// 1. Verify main entry & project.config.json
const mainGameJs = path.join(buildDir, 'game.js');
addCheck('main_game_js', fs.existsSync(mainGameJs), mainGameJs);

const projCfgPath = path.join(buildDir, 'project.config.json');
let projCfg = null;
if (fs.existsSync(projCfgPath)) {
  try {
    projCfg = JSON.parse(fs.readFileSync(projCfgPath, 'utf8'));
    addCheck(
      'project_config_json',
      projCfg.compileType === 'game' && typeof projCfg.appid === 'string' && projCfg.appid.length > 0,
      `compileType=${projCfg.compileType}, appid=${projCfg.appid}`
    );
  } catch (err) {
    addCheck('project_config_json', false, `JSON parse error: ${err.message}`);
  }
} else {
  addCheck('project_config_json', false, 'Missing project.config.json');
}

// 2. Verify game.json subpackages registration
const gameJsonPath = path.join(buildDir, 'game.json');
let gameJson = null;
let subpackEntry = null;
if (fs.existsSync(gameJsonPath)) {
  try {
    gameJson = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    const subpackages = gameJson.subpackages ?? gameJson.subPackages ?? [];
    subpackEntry = Array.isArray(subpackages)
      ? subpackages.find((s) => s && (s.name === 'spike-pack' || String(s.root || '').includes('spike-pack')))
      : null;
    addCheck(
      'game_json_subpackages_registered',
      Boolean(subpackEntry && subpackEntry.root),
      subpackEntry ? JSON.stringify(subpackEntry) : `game.json keys=${Object.keys(gameJson).join(',')} (no spike-pack subpackage)`
    );
  } catch (err) {
    addCheck('game_json_subpackages_registered', false, `JSON parse error: ${err.message}`);
  }
} else {
  addCheck('game_json_subpackages_registered', false, 'Missing game.json');
}

// 3. Verify subpackage root directory, entry script, bundle config, manifest JSON, and icon PNG
let subpackFiles = [];
let subpackRootRel = subpackEntry?.root ? String(subpackEntry.root).replace(/^\/+|\/+$/g, '') : 'subpackages/spike-pack';
const subpackFullDir = path.join(buildDir, subpackRootRel);
addCheck('subpackage_root_exists', fs.existsSync(subpackFullDir), subpackRootRel);

if (fs.existsSync(subpackFullDir)) {
  subpackFiles = walkFiles(subpackFullDir);
  const hasEntryGameJs = subpackFiles.some((f) => f.rel === 'game.js' || f.rel === 'index.js');
  const configFile = subpackFiles.find((f) => /(^|\/)(cc\.)?config\.json$/i.test(f.rel));
  const pngFile = subpackFiles.find((f) => /\.png$/i.test(f.rel));
  let manifestReferenced = false;
  let iconReferenced = false;
  let configDetail = 'missing config.json';

  if (configFile) {
    try {
      const cfgText = fs.readFileSync(configFile.full, 'utf8');
      const cfg = JSON.parse(cfgText);
      const pathsStr = JSON.stringify(cfg.paths ?? {});
      manifestReferenced = pathsStr.includes('subpack_manifest');
      iconReferenced = pathsStr.includes('subpack_icon');
      configDetail = `file=${configFile.rel}, name=${cfg.name}, manifestInPaths=${manifestReferenced}, iconInPaths=${iconReferenced}`;
    } catch (err) {
      configDetail = `parse error: ${err.message}`;
    }
  }

  // Also check that manifest JSON content is actually inside the subpackage directory
  const hasManifestPayload = subpackFiles.some((f) => {
    if (!/\.json$/i.test(f.rel)) return false;
    try {
      return fs.readFileSync(f.full, 'utf8').includes('spike-pack-v1');
    } catch {
      return false;
    }
  });

  addCheck('subpackage_entry_js', hasEntryGameJs, subpackFiles.map((f) => f.rel).join(', '));
  addCheck('subpackage_bundle_config', Boolean(configFile) && manifestReferenced && iconReferenced, configDetail);
  addCheck('subpackage_manifest_asset', hasManifestPayload, hasManifestPayload ? 'Found spike-pack-v1 payload inside subpackage' : 'Missing spike-pack-v1 JSON inside subpackage');
  addCheck('subpackage_icon_png', Boolean(pngFile), pngFile ? `${pngFile.rel} (${pngFile.size} B)` : 'No PNG asset found inside subpackage');
}

// 4. Verify src/settings.json registers subpackage bundle
const settingsPath = path.join(buildDir, 'src', 'settings.json');
if (fs.existsSync(settingsPath)) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const subList = settings?.assets?.subpackages ?? [];
    const registeredInSettings = Array.isArray(subList) && subList.includes('spike-pack');
    addCheck(
      'settings_json_subpackages',
      registeredInSettings,
      `assets.subpackages=${JSON.stringify(subList)}`
    );
  } catch (err) {
    addCheck('settings_json_subpackages', false, `parse error: ${err.message}`);
  }
} else {
  addCheck('settings_json_subpackages', false, 'Missing src/settings.json');
}

// 5. Compute exact Total / Subpackage / Main byte sizes
const allFiles = walkFiles(buildDir);
const totalBytes = allFiles.reduce((s, f) => s + f.size, 0);
const subpackBytes = subpackFiles.reduce((s, f) => s + f.size, 0);
const mainFilesCount = allFiles.length - subpackFiles.length;
const mainBytes = totalBytes - subpackBytes;

const summary = {
  buildDir,
  status: errors.length === 0 ? 'PASS' : 'FAIL',
  appid: projCfg?.appid ?? null,
  compileType: projCfg?.compileType ?? null,
  gameJson,
  sizes: {
    totalFiles: allFiles.length,
    totalBytes,
    totalKB: Number((totalBytes / 1024).toFixed(2)),
    mainFiles: mainFilesCount,
    mainBytes,
    mainKB: Number((mainBytes / 1024).toFixed(2)),
    subpackageRoot: subpackRootRel,
    subpackageFiles: subpackFiles.length,
    subpackageBytes: subpackBytes,
    subpackageKB: Number((subpackBytes / 1024).toFixed(2)),
  },
  subpackageFileList: subpackFiles.map((f) => ({ rel: f.rel, bytes: f.size })),
  checks,
  errors,
};

if (reportOut) {
  fs.mkdirSync(path.dirname(reportOut), { recursive: true });
  fs.writeFileSync(reportOut, JSON.stringify(summary, null, 2), 'utf8');
}

console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  console.error(`\n[WeChat Audit] FAIL (${errors.length} error(s))`);
  process.exit(1);
}
console.log(`\n[WeChat Audit] PASS (${checks.length}/${checks.length} checks passed)`);
process.exit(0);
