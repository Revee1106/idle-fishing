// Independent recomputation of the design-issued golden vectors G01/G02.
// Source literals: E:/idle-fishing-review/reports/review/DESIGN_VECTOR_SUPPLEMENT.md
// Uses node:crypto only and never imports the spike implementation.
import { createHash } from 'node:crypto';

const G01_OUTER = '["IDLE_FISHING",1,"7","epoch.audit","{\\"gold\\":\\"0\\"}"]';
const G02_OUTER =
  '["IDLE_FISHING",1,"7","epoch.audit","{\\"name\\":\\"黄金鲤鱼\\\\\\"A\\\\\\"\\",\\"note\\":\\"第一行\\\\n第二行\\\\t完\\",\\"path\\":\\"C:\\\\\\\\fish\\\\\\\\存档\\"}"]';

const vectors = [
  {
    name: 'G01',
    outerText: G01_OUTER,
    expectedBytes: 55,
    expectedSha256: '7322a23453d23eca40a924d1b24105c95a157f3931430cc4c56ac82862c40a27',
  },
  {
    name: 'G02',
    outerText: G02_OUTER,
    expectedBytes: 150,
    expectedSha256: '431dafc1a07776a1bb9d80357a62323176faabc7c38385da0e13a80daf8b5354',
  },
];

let ok = true;
for (const v of vectors) {
  const bytes = Buffer.from(v.outerText, 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const match = bytes.length === v.expectedBytes && sha256 === v.expectedSha256;
  ok = ok && match;
  console.log(`${v.name} outerText=${v.outerText}`);
  console.log(
    `${v.name} bytes=${bytes.length} expectedBytes=${v.expectedBytes} sha256=${sha256} expectedSha256=${v.expectedSha256} match=${match}`
  );
}
console.log(`RESULT=${ok ? 'PASS' : 'FAIL'}`);
if (!ok) process.exitCode = 1;