import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const root = 'E:/idle-fishing-integration';
process.chdir(root);
const readManifest = (p) =>
  fs
    .readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = l.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      return m ? { hash: m[1], path: m[2].replace(/\\/g, '/') } : null;
    })
    .filter(Boolean);

const m3 = readManifest('reports/integration/FE-000-R1-INTEGRATION-REWORK-03/FILES-REWORK.sha256');
const m2 = readManifest('reports/integration/FE-000-R1-INTEGRATION-REWORK-02/FILES-REWORK.sha256');
const man3 = new Set(m3.map((e) => e.path));
const map2 = new Map(m2.map((e) => [e.path, e.hash]));

console.log('manifest3 entries:', m3.length);

const changed = execSync('git diff --name-only && git ls-files --others --exclude-standard', { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const relevant = changed.filter(
  (p) =>
    p.startsWith('apps/game-client/assets/') ||
    p.startsWith('tests/frontend/fe-000/') ||
    p.startsWith('reports/integration/FE-000-R1-INTEGRATION-REWORK-03/')
);
const missing = relevant.filter((p) => !man3.has(p));
const extra = [...man3].filter(
  (p) => !relevant.includes(p) && !p.startsWith('reports/integration/FE-000-R1-INTEGRATION-REWORK-03/logs/')
);
console.log('relevant=', relevant.length, 'missing=', missing.length, 'extra(excl logs)=', extra.length);
missing.forEach((x) => console.log('  MISSING ' + x));
extra.forEach((x) => console.log('  EXTRA ' + x));

// Which relevant files are byte-identical to REWORK-02 manifest?
const same = [];
const changedSince2 = [];
const newFiles = [];
for (const p of relevant) {
  if (p === 'reports/integration/FE-000-R1-INTEGRATION-REWORK-03/FILES-REWORK.sha256') continue;
  const full = path.join(root, p);
  const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  if (!map2.has(p)) newFiles.push(p);
  else if (map2.get(p) === h) same.push(p);
  else changedSince2.push(p);
}
console.log('\nunchanged since REWORK-02:', same.length);
same.forEach((x) => console.log('  SAME ' + x));
console.log('\nchanged since REWORK-02:', changedSince2.length);
changedSince2.forEach((x) => console.log('  CHG  ' + x));
console.log('\nnot in REWORK-02 manifest:', newFiles.length);
newFiles.forEach((x) => console.log('  NEW  ' + x));

// Logs referenced in TEST_REPORT exist?
const logs = fs.readdirSync('reports/integration/FE-000-R1-INTEGRATION-REWORK-03/logs');
console.log('\nlogs on disk:', logs.length);
for (const f of logs.sort()) {
  const txt = fs.readFileSync(path.join('reports/integration/FE-000-R1-INTEGRATION-REWORK-03/logs', f), 'utf8');
  const cmd = (txt.match(/^COMMAND:\s*(.*)$/m) || [])[1] || '(no command header)';
  const ec = (txt.match(/^EXIT_CODE:\s*(.*)$/m) || [])[1] || '(no exit header)';
  console.log(`  ${f} | exit=${ec} | ${cmd.slice(0, 90)}`);
}