/**
 * P2-05 / N6 + A08 Strict Output Directory Authorization & Safe Deletion Guard.
 *
 * Prevents destructive recursive deletion against unauthorized or unverifiable paths:
 * - Rejects empty/null, UNC (\\server\share), Windows extended/device prefixes (\\?\, \\.\),
 *   drive-relative paths (C:foo), NTFS ADS (:stream), drive/filesystem roots, repo root,
 *   repo parent, apps/, packages/, tests/, reports/, docs/, config/, user Desktop/Documents,
 *   .. escapes, and symlinks / Windows NTFS junctions.
 * - A08 Fail-Closed Metadata Verification: NEVER swallows lstatSync or realpathSync errors
 *   (e.g., EACCES, EPERM, EIO, ELOOP). If realpath or lstat metadata cannot be verified,
 *   returns ok=false with METADATA_UNVERIFIABLE / REALPATH_UNVERIFIABLE (never falls back
 *   to an unverified path).
 * - Uses strict exact allowlists per operation mode ('compiled-tests' | 'cocos-build' | 'chrome-temp').
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

function normalizeForCompare(p) {
  let clean = path.resolve(p);
  if (IS_WIN) {
    clean = clean.replace(/\//g, '\\').toLowerCase();
  }
  const parsedRoot = IS_WIN ? path.parse(clean).root.toLowerCase() : path.parse(clean).root;
  if (clean.length > parsedRoot.length && (clean.endsWith('\\') || clean.endsWith('/'))) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

function isNotFoundCode(err) {
  const code = err && typeof err === 'object' ? err.code : '';
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function errorDetail(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Resolves the canonical realpath of candidatePath fail-closed.
 * - Uses lstatSync (never existsSync) while walking upward so broken symlinks and
 *   permission errors (EACCES/EPERM) are detected instead of treated as missing paths.
 * - Rejects immediately if lstatSync throws any non-ENOENT error or if realpathSync throws.
 * - Flags symlink/junction if the target itself or any existing ancestor is a symlink/junction
 *   or if canonical realpath diverges from normalized abs.
 */
function resolveCanonicalPathFailClosed(rawCandidate, baseDir, fsImpl) {
  const abs = path.isAbsolute(rawCandidate) ? path.normalize(rawCandidate) : path.resolve(baseDir, rawCandidate);

  const tailSegments = [];
  let probe = abs;
  let probeLstat = null;

  while (true) {
    try {
      probeLstat = fsImpl.lstatSync(probe);
      break;
    } catch (err) {
      if (!isNotFoundCode(err)) {
        return {
          ok: false,
          code: 'METADATA_UNVERIFIABLE',
          reason: `lstatSync failed for ${probe} (${err?.code ?? 'UNKNOWN'}): ${errorDetail(err)}`,
        };
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        return {
          ok: false,
          code: 'METADATA_UNVERIFIABLE',
          reason: `Reached filesystem root without existing ancestor for ${abs}`,
        };
      }
      tailSegments.unshift(path.basename(probe));
      probe = parent;
    }
  }

  let isSymlinkOrJunction = false;
  if (probeLstat && typeof probeLstat.isSymbolicLink === 'function' && probeLstat.isSymbolicLink()) {
    isSymlinkOrJunction = true;
  }

  let realAncestor;
  try {
    realAncestor = fsImpl.realpathSync(probe);
  } catch (err) {
    return {
      ok: false,
      code: 'REALPATH_UNVERIFIABLE',
      reason: `realpathSync failed for ${probe} (${err?.code ?? 'UNKNOWN'}): ${errorDetail(err)}`,
    };
  }

  const canonical = tailSegments.length > 0 ? path.join(realAncestor, ...tailSegments) : realAncestor;
  if (normalizeForCompare(canonical) !== normalizeForCompare(abs)) {
    isSymlinkOrJunction = true;
  }
  return { ok: true, abs, canonical, isSymlinkOrJunction, exists: tailSegments.length === 0 };
}

/**
 * Validates whether `candidatePath` is strictly authorized for recursive deletion under `mode`.
 * Modes:
 * - 'compiled-tests': ONLY <repoRoot>/tests/frontend/fe-000/.compiled or .compiled-<safe-id>
 * - 'cocos-build': ONLY <repoRoot>/apps/game-client/build/web-mobile or wechatgame
 * - 'chrome-temp': ONLY direct child of os.tmpdir() matching /^fe000-r1-chrome-[A-Za-z0-9._-]+$/
 */
export function validateDeletableOutputDir(candidatePath, options) {
  const { mode, repoRoot, baseDir = repoRoot, fsImpl = fs } = options || {};
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0 || candidatePath.includes('\0')) {
    return { ok: false, code: 'EMPTY_OR_INVALID', reason: 'Output directory path is empty or contains null bytes' };
  }
  const trimmed = candidatePath.trim();

  // Reject UNC and Windows extended/device paths (\\server\share, //server/share, \\?\, \\.\)
  if (/^(\\\\|\/\/)/.test(trimmed)) {
    return { ok: false, code: 'UNC_REJECTED', reason: `UNC or device paths are strictly forbidden: ${trimmed}` };
  }

  // Reject Windows drive-relative paths (e.g., "C:foo") and NTFS alternate data streams ("foo:stream")
  if (IS_WIN) {
    if (/^[A-Za-z]:(?![\\/])/.test(trimmed)) {
      return { ok: false, code: 'DRIVE_RELATIVE_REJECTED', reason: `Drive-relative path is forbidden: ${trimmed}` };
    }
    const afterDrive = /^[A-Za-z]:/.test(trimmed) ? trimmed.slice(2) : trimmed;
    if (afterDrive.includes(':')) {
      return { ok: false, code: 'ADS_COLON_REJECTED', reason: `Disallowed colon/ADS in Windows path: ${trimmed}` };
    }
  }

  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) {
    return { ok: false, code: 'REPO_ROOT_UNVERIFIABLE', reason: 'repoRoot must be a non-empty string' };
  }

  let canonicalRepoRoot;
  try {
    canonicalRepoRoot = fsImpl.realpathSync(repoRoot);
  } catch (err) {
    return {
      ok: false,
      code: 'REPO_ROOT_UNVERIFIABLE',
      reason: `Cannot verify canonical repoRoot (${repoRoot}): ${errorDetail(err)}`,
    };
  }

  const resolved = resolveCanonicalPathFailClosed(trimmed, baseDir, fsImpl);
  if (!resolved.ok) {
    return resolved;
  }
  const { abs, canonical, isSymlinkOrJunction } = resolved;

  // Reject filesystem / drive roots (e.g., C:\, E:\, /)
  const parsed = path.parse(canonical);
  if (normalizeForCompare(canonical) === normalizeForCompare(parsed.root)) {
    return { ok: false, code: 'DRIVE_ROOT_REJECTED', reason: `Drive or filesystem root is forbidden: ${canonical}` };
  }

  // Reject symlinks or Windows junctions
  if (isSymlinkOrJunction) {
    return {
      ok: false,
      code: 'SYMLINK_OR_JUNCTION_REJECTED',
      reason: `Symlink/junction path rejected (abs=${abs}, real=${canonical})`,
    };
  }

  const normCand = normalizeForCompare(canonical);
  const normRepo = normalizeForCompare(canonicalRepoRoot);
  const normRepoParent = normalizeForCompare(path.dirname(canonicalRepoRoot));

  const forbiddenExact = [
    normRepo,
    normRepoParent,
    normalizeForCompare(path.join(canonicalRepoRoot, 'apps')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'apps/game-client')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'apps/game-client/assets')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'apps/game-client/build')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'packages')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'tests')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'tests/frontend')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'tests/frontend/fe-000')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'reports')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'docs')),
    normalizeForCompare(path.join(canonicalRepoRoot, 'config')),
    normalizeForCompare(os.homedir()),
    normalizeForCompare(path.join(os.homedir(), 'Desktop')),
    normalizeForCompare(path.join(os.homedir(), 'Documents')),
  ];
  if (forbiddenExact.includes(normCand)) {
    return { ok: false, code: 'PROTECTED_DIR_REJECTED', reason: `Protected directory cannot be deleted: ${canonical}` };
  }

  if (mode === 'compiled-tests') {
    const allowedParent = path.join(canonicalRepoRoot, 'tests', 'frontend', 'fe-000');
    const normParent = normalizeForCompare(allowedParent);
    const candParent = normalizeForCompare(path.dirname(canonical));
    const baseName = path.basename(canonical);
    if (candParent !== normParent) {
      return {
        ok: false,
        code: 'OUTSIDE_ALLOWLIST',
        reason: `Compiled test output dir must be a direct child of ${allowedParent}, got ${canonical}`,
      };
    }
    if (!/^\.compiled(?:-[A-Za-z0-9._-]+)?$/.test(baseName)) {
      return {
        ok: false,
        code: 'INVALID_COMPILED_DIR_NAME',
        reason: `Compiled test dir basename must be ".compiled" or ".compiled-<id>", got "${baseName}"`,
      };
    }
    return { ok: true, resolvedPath: abs, canonicalPath: canonical };
  }

  if (mode === 'cocos-build') {
    const allowBuild = [
      normalizeForCompare(path.join(canonicalRepoRoot, 'apps', 'game-client', 'build', 'web-mobile')),
      normalizeForCompare(path.join(canonicalRepoRoot, 'apps', 'game-client', 'build', 'wechatgame')),
    ];
    if (!allowBuild.includes(normCand)) {
      return {
        ok: false,
        code: 'OUTSIDE_BUILD_ALLOWLIST',
        reason: `Only exact web-mobile or wechatgame build outputs are allowed, got ${canonical}`,
      };
    }
    return { ok: true, resolvedPath: abs, canonicalPath: canonical };
  }

  if (mode === 'chrome-temp') {
    let realTmp;
    try {
      realTmp = fsImpl.realpathSync(os.tmpdir());
    } catch (err) {
      return {
        ok: false,
        code: 'REALPATH_UNVERIFIABLE',
        reason: `Cannot verify canonical os.tmpdir(): ${errorDetail(err)}`,
      };
    }
    const candParent = normalizeForCompare(path.dirname(canonical));
    const baseName = path.basename(canonical);
    if (candParent !== normalizeForCompare(realTmp) || !/^fe000-r1-chrome-[A-Za-z0-9._-]+$/.test(baseName)) {
      return {
        ok: false,
        code: 'OUTSIDE_CHROME_TEMP_ALLOWLIST',
        reason: `Only ephemeral fe000-r1-chrome-* dirs inside os.tmpdir() are allowed, got ${canonical}`,
      };
    }
    return { ok: true, resolvedPath: abs, canonicalPath: canonical };
  }

  return { ok: false, code: 'UNKNOWN_MODE', reason: `Unsupported validation mode: ${String(mode)}` };
}

export function assertSafeDeletableOutputDir(candidatePath, options) {
  const verdict = validateDeletableOutputDir(candidatePath, options);
  if (!verdict.ok) {
    throw new Error(`[SafePathGuard:${verdict.code}] ${verdict.reason}`);
  }
  return verdict.canonicalPath;
}

export function safeRemoveOutputDir(candidatePath, options) {
  const { fsImpl = fs } = options || {};
  const canonical = assertSafeDeletableOutputDir(candidatePath, options);
  try {
    const st = fsImpl.lstatSync(canonical);
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) {
      throw new Error(`[SafePathGuard:SYMLINK_OR_JUNCTION_REJECTED] Refusing to delete symlink/junction: ${canonical}`);
    }
  } catch (err) {
    if (isNotFoundCode(err)) {
      return canonical;
    }
    throw err;
  }
  fsImpl.rmSync(canonical, { recursive: true, force: true });
  return canonical;
}
