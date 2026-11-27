import assert from 'node:assert/strict';
import test from 'node:test';

test('parent test with one passing leaf', async (t) => {
  await t.test('passing child leaf', () => {
    assert.equal(2 + 3, 5);
  });
});
