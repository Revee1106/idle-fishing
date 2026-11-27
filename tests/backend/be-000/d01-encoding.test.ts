import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalStringify, utf8Bytes } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { computeEnvelopeHash } from '../../../packages/game-core/src/spike/save.ts';

// Local D01 vectors. Byte counts and digests were produced by an independent
// Python 3 run (`json.dumps(..., ensure_ascii=False, separators=(',',':'))` +
// `hashlib.sha256`, no BOM), not by this implementation.
const VECTOR_A_PAYLOAD = '{"name":"Alice"}';
const VECTOR_A_OUTER = '["IDLE_FISHING",1,"7","epoch.audit","{\\"name\\":\\"Alice\\"}"]';
const VECTOR_A_BYTES = 59;
const VECTOR_A_SHA = '052166960a60184b98f25faadf00fc99bf6c60028c305a53e7e220fb625b92ae';

const VECTOR_B_PAYLOAD =
  '{"name":"He said \\"hi\\"","note":"line1\\nline2\\tend","path":"C:\\\\tmp\\\\f.txt","tail":"\u9c7c\ud83d\udc1f"}';
const VECTOR_B_BYTES = 158;
const VECTOR_B_SHA = '2148014d02842b5d0f071476bda16004bc0e1971d4ec6264d343caa9411c7936';

test('D01-01 envelope hash covers the fixed outer array and matches an independent UTF-8 SHA-256', () => {
  assert.equal(canonicalStringify({ name: 'Alice' }), VECTOR_A_PAYLOAD);
  const outer = canonicalStringify(['IDLE_FISHING', 1, '7', 'epoch.audit', VECTOR_A_PAYLOAD]);
  assert.equal(outer, VECTOR_A_OUTER);
  assert.equal(utf8Bytes(outer).length, VECTOR_A_BYTES);
  assert.equal(computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', VECTOR_A_PAYLOAD), VECTOR_A_SHA);
});

test('D01-02 quotes, backslashes, control escapes and non-ASCII match the independent vector', () => {
  const payload = canonicalStringify({
    tail: '\u9c7c\ud83d\udc1f',
    path: 'C:\\tmp\\f.txt',
    note: 'line1\nline2\tend',
    name: 'He said "hi"',
  });
  assert.equal(payload, VECTOR_B_PAYLOAD);
  assert.equal(utf8Bytes(payload).length, 93);
  assert.equal(computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', payload), VECTOR_B_SHA);
  const outer = canonicalStringify(['IDLE_FISHING', 1, '7', 'epoch.audit', payload]);
  assert.equal(utf8Bytes(outer).length, VECTOR_B_BYTES);
});

test('D01-03 object keys sort by UTF-16 code unit, arrays keep order, no Unicode normalization', () => {
  const astralFirst = '\ud800\udc00';
  const bmpHigh = '\ue000';
  assert.equal(canonicalStringify({ [bmpHigh]: 1, [astralFirst]: 2 }), `{"${astralFirst}":2,"${bmpHigh}":1}`);
  assert.equal(canonicalStringify(['b', 'a']), '["b","a"]');

  const composed = 'é';
  const decomposed = 'e\u0301';
  assert.notEqual(canonicalStringify(composed), canonicalStringify(decomposed));
  assert.notEqual(
    computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', composed),
    computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', decomposed)
  );
  assert.equal(utf8Bytes(composed).length, 2);
  assert.equal(utf8Bytes(decomposed).length, 3);
});

// Design-issued golden vectors G01/G02 (reports/review/DESIGN_VECTOR_SUPPLEMENT.md).
// Expected payload text, outer bytes and SHA-256 are fixed design inputs; they must
// never be derived from the implementation under test.
const G01_PAYLOAD = '{"gold":"0"}';
const G01_OUTER = '["IDLE_FISHING",1,"7","epoch.audit","{\\"gold\\":\\"0\\"}"]';
const G01_OUTER_BYTES = 55;
const G01_SHA = '7322a23453d23eca40a924d1b24105c95a157f3931430cc4c56ac82862c40a27';

const G02_PAYLOAD =
  '{"name":"黄金鲤鱼\\"A\\"","note":"第一行\\n第二行\\t完","path":"C:\\\\fish\\\\存档"}';
const G02_OUTER =
  '["IDLE_FISHING",1,"7","epoch.audit","{\\"name\\":\\"黄金鲤鱼\\\\\\"A\\\\\\"\\",\\"note\\":\\"第一行\\\\n第二行\\\\t完\\",\\"path\\":\\"C:\\\\\\\\fish\\\\\\\\存档\\"}"]';
const G02_OUTER_BYTES = 150;
const G02_SHA = '431dafc1a07776a1bb9d80357a62323176faabc7c38385da0e13a80daf8b5354';

test('D01-04 G01 design golden vector: fixed outer bytes and SHA-256', () => {
  assert.equal(canonicalStringify({ gold: '0' }), G01_PAYLOAD);
  const outer = canonicalStringify(['IDLE_FISHING', 1, '7', 'epoch.audit', G01_PAYLOAD]);
  assert.equal(outer, G01_OUTER);
  assert.equal(utf8Bytes(outer).length, G01_OUTER_BYTES);
  assert.equal(computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', G01_PAYLOAD), G01_SHA);
});

test('D01-05 G02 design golden vector: escapes, UTF-16 key order and non-ASCII bytes', () => {
  const payload = canonicalStringify({
    path: 'C:\\fish\\存档',
    note: '第一行\n第二行\t完',
    name: '黄金鲤鱼"A"',
  });
  assert.equal(payload, G02_PAYLOAD);
  const outer = canonicalStringify(['IDLE_FISHING', 1, '7', 'epoch.audit', payload]);
  assert.equal(outer, G02_OUTER);
  assert.equal(utf8Bytes(outer).length, G02_OUTER_BYTES);
  assert.equal(computeEnvelopeHash('IDLE_FISHING', 1, '7', 'epoch.audit', payload), G02_SHA);
});