import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
describe('S1', () => {
  test('p1', async (t) => {
    await t.test('child-pass', () => assert.ok(true));
    await t.test('child-skip', { skip: true }, () => {});
    await t.test('child-todo', { todo: true }, () => {});
  });
  test('p2', () => assert.ok(true));
});
test.skip('top-skip', () => {});
test.todo('top-todo');
