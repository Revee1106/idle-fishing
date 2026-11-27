import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

describe('multi-file nested suite', () => {
  test('pass leaf A', () => {
    assert.ok(true);
  });
  test('fail leaf A', () => {
    assert.equal(1, 2);
  });
  test('nested group', async (t) => {
    await t.test('pass leaf B', () => {
      assert.ok(true);
    });
    await t.test('fail leaf B', () => {
      assert.equal(3, 4);
    });
    await t.test('skip leaf C', { skip: true }, () => {});
    await t.test('todo leaf D', { todo: true }, () => {});
  });
});
