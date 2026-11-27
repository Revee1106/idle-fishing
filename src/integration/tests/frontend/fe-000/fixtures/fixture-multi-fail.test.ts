import assert from 'node:assert/strict';
import test from 'node:test';

test('fail leaf 1', () => {
  assert.equal('a', 'b');
});

test('fail leaf 2', () => {
  assert.equal(100, 200);
});
