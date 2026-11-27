import assert from 'node:assert/strict';
import test from 'node:test';

test('mixed pass', () => {
  assert.ok(true);
});
test.skip('mixed skip', () => {});
test.todo('mixed todo');
test('mixed fail', () => {
  assert.equal(1, 0);
});
