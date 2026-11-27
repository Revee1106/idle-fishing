import assert from 'node:assert/strict';
import test from 'node:test';

test('intentional failing test case', () => {
  assert.equal(1, 2, 'expected failure for P1-03 runner guard verification');
});
