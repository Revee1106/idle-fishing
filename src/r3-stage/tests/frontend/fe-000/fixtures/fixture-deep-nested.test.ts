import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

describe('outer suite', () => {
  describe('inner suite', () => {
    test('nested leaf 1', () => {
      assert.equal(10, 10);
    });
    test('nested parent', async (t) => {
      await t.test('deep leaf 2', () => {
        assert.equal(20, 20);
      });
    });
  });
});
