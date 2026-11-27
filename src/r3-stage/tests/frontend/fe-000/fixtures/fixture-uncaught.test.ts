import test from 'node:test';

test('uncaught async exception', async () => {
  setTimeout(() => {
    throw new Error('Intentional uncaught async exception for P1-03 verification');
  }, 10);
  await new Promise((r) => setTimeout(r, 100));
});
