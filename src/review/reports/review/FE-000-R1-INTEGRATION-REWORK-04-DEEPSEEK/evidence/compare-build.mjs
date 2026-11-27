import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const snap = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r4-snap';
const manPath = 'E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-04/evidence/web-rework04-build-manifest.json';
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
let ok = 0, bad = 0, missing = 0;
for (const f of man.files) {
  const p = path.join(snap, 'apps/game-client/build/web-mobile', f.path.replace(/\\/g, '/'));
  if (!fs.existsSync(p)) { console.log('MISSING', f.path); missing++; continue; }
  const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  if (h === f.sha256) ok++;
  else { bad++; console.log('DIFF', f.path, h, f.sha256); }
}
console.log(JSON.stringify({ ok, bad, missing, total: man.files.length, fileCount: man.fileCount, totalBytes: man.totalBytes }));