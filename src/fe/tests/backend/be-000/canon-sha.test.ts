import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  CanonicalJsonError,
  canonicalStringify,
  isNat,
  natFromBigInt,
  natToBigInt,
  utf8Bytes,
} from '../../../packages/game-core/src/spike/canonical-json.ts';
import { sha256Hex, sha256HexOfBytes } from '../../../packages/game-core/src/spike/sha256.ts';

test('CANON-01 sorts object keys by UTF-16 code unit and keeps array order', () => {
  assert.equal(canonicalStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalStringify({ a: [3, 1, 2] }), '{"a":[3,1,2]}');
  assert.equal(canonicalStringify({ Z: 1, a: 2, '10': 3, '2': 4 }), '{"10":3,"2":4,"Z":1,"a":2}');
  assert.equal(canonicalStringify({ nested: { y: true, x: null } }), '{"nested":{"x":null,"y":true}}');
});

test('CANON-02 rejects values that cannot round-trip', () => {
  assert.throws(() => canonicalStringify({ v: Number.NaN }), CanonicalJsonError);
  assert.throws(() => canonicalStringify({ v: Number.POSITIVE_INFINITY }), CanonicalJsonError);
  assert.throws(() => canonicalStringify({ v: -0 }), CanonicalJsonError);
  assert.throws(() => canonicalStringify({ v: 1n }), CanonicalJsonError);
  assert.throws(() => canonicalStringify({ v: undefined }), CanonicalJsonError);
  assert.throws(() => canonicalStringify({ v: 2 ** 53 }), CanonicalJsonError);
  assert.throws(() => canonicalStringify(JSON.parse('{"__proto__":1}')), /Forbidden key/);
  assert.throws(() => canonicalStringify(JSON.parse('{"constructor":1}')), /Forbidden key/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalStringify(cyclic), /Circular/);
});

test('CANON-03 Nat helpers enforce canonical decimal strings', () => {
  assert.ok(isNat('0'));
  assert.ok(isNat('123456789012345678901234567890'));
  assert.ok(!isNat('01'));
  assert.ok(!isNat('-1'));
  assert.ok(!isNat(''));
  assert.ok(!isNat(1 as unknown));
  assert.equal(natFromBigInt(123456789012345678901234567890n), '123456789012345678901234567890');
  assert.equal(natToBigInt('123456789012345678901234567890'), 123456789012345678901234567890n);
  assert.throws(() => natFromBigInt(-1n));
  assert.throws(() => natToBigInt('1.5'));
});

test('CANON-04 UTF-8 encoder matches Node Buffer for ASCII, CJK and emoji', () => {
  const samples = [
    '',
    'abc',
    '鱼',
    '体色：金色',
    '🎣 idle-fishing',
    'a\u00e9\u4e2d\ud83d\ude00z',
  ];
  for (const sample of samples) {
    const expected = new Uint8Array(Buffer.from(sample, 'utf8'));
    const actual = utf8Bytes(sample);
    assert.deepEqual([...actual], [...expected], `utf8 mismatch for ${JSON.stringify(sample)}`);
  }
  assert.throws(() => utf8Bytes('\ud800'), /Lone high surrogate/);
  assert.throws(() => utf8Bytes('\udc00'), /Lone low surrogate/);
});

test('SHA-01 matches node:crypto for block-boundary messages', () => {
  const samples = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'a'.repeat(1000),
    'idle-fishing 结算事务 🎣',
  ];
  for (const sample of samples) {
    const expected = createHash('sha256').update(Buffer.from(sample, 'utf8')).digest('hex');
    assert.equal(sha256Hex(sample), expected, `sha mismatch for length ${sample.length}`);
  }
});

test('SHA-02 byte-level hashing matches for binary input', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  assert.equal(sha256HexOfBytes(bytes), expected);
});

test('SHA-03 canonical payload hash is stable across key insertion order', () => {
  const first = { revision: 3, payload: { b: [1, 2], a: 'x' } };
  const second = { payload: { a: 'x', b: [1, 2] }, revision: 3 };
  assert.equal(sha256Hex(canonicalStringify(first)), sha256Hex(canonicalStringify(second)));
});