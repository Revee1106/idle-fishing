import test from 'node:test';

test('parent test with only skipped child', async (t) => {
  await t.test('skipped child leaf', { skip: true }, () => {});
});
