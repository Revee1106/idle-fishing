import test from 'node:test';

test('parent test with only todo child', async (t) => {
  await t.test('todo child leaf', { todo: true }, () => {});
});
