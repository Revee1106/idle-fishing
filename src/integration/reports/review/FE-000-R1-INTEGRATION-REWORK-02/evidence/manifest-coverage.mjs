import fs from 'node:fs';
import { execSync } from 'node:child_process';
const root = 'E:/idle-fishing-integration';
process.chdir(root);
const man = new Set(
  fs
    .readFileSync('reports/integration/FE-000-R1-INTEGRATION-REWORK-02/FILES-REWORK.sha256', 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.replace(/^[0-9a-f]{64}\s+/, '').replace(/\\/g, '/'))
);
const changed = execSync('git diff --name-only && git ls-files --others --exclude-standard', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const relevant = changed.filter(
  (p) =>
    p.startsWith('apps/game-client/assets/') ||
    p.startsWith('tests/frontend/fe-000/') ||
    p.startsWith('reports/integration/FE-000-R1-INTEGRATION-REWORK-02/')
);
const missing = relevant.filter((p) => !man.has(p));
const extra = [...man].filter(
  (p) => !relevant.includes(p) && !p.startsWith('reports/integration/FE-000-R1-INTEGRATION-REWORK-02/logs/')
);
console.log('manifest entries:', man.size);
console.log('relevant changed/untracked:', relevant.length);
console.log('missing from manifest:', missing.length);
missing.forEach((x) => console.log('  MISSING ' + x));
console.log('manifest paths not in changed list (excl logs):', extra.length);
extra.forEach((x) => console.log('  EXTRA ' + x));