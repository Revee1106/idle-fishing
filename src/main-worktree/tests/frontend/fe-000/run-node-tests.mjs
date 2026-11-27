/**
 * Compiles and executes FE-000 Node/Mock automated tests without modifying root tsconfig.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const compiledDir = path.join(__dirname, '.compiled');

// Clean previous build
fs.rmSync(compiledDir, { recursive: true, force: true });

// Compile with local TypeScript (using moduleResolution bundler or NodeNext? Let's compile with bundler/esnext for extensionless Cocos imports!)
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tscBin)) {
  console.error('TypeScript compiler not found at:', tscBin);
  process.exit(2);
}

// Compile into .compiled with ESNext modules + Bundler resolution, then run via Node loader or rewrite relative extensionless imports
const compile = spawnSync(
  process.execPath,
  [
    tscBin,
    '--project',
    path.join(__dirname, 'tsconfig.json'),
  ],
  { cwd: repoRoot, encoding: 'utf8' }
);

if (compile.status !== 0) {
  console.error('TypeScript compilation failed:\n', compile.stdout, compile.stderr);
  process.exit(compile.status || 1);
}

// Rewrite relative extensionless imports in compiled .js files to .js for Node ESM execution
function patchDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchDir(full);
    } else if (entry.name.endsWith('.js')) {
      let text = fs.readFileSync(full, 'utf8');
      text = text.replace(
        /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
        (match, p1, spec, p3) => (spec.endsWith('.js') || spec.endsWith('.json') ? match : `${p1}${spec}.js${p3}`)
      );
      fs.writeFileSync(full, text, 'utf8');
    }
  }
}
patchDir(compiledDir);

const testFile = path.join(compiledDir, 'tests', 'frontend', 'fe-000', 'platform-and-core.test.js');
const run = spawnSync(process.execPath, ['--test', testFile], {
  cwd: repoRoot,
  stdio: 'inherit',
});

process.exit(run.status ?? 1);
