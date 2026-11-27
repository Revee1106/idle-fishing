import assert from 'node:assert/strict';
import test from 'node:test';

test('passing test in mixed fixture', () => {
  assert.equal(2 + 2, 4);
});

test.skip('skipped test in mixed fixture', () => {
  // must be reported as skip=1, never counted in pass
});
