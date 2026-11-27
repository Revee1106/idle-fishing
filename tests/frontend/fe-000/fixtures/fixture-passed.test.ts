import assert from 'node:assert/strict';
import test from 'node:test';

test('single passing test case', () => {
  assert.equal(1 + 1, 2);
});
