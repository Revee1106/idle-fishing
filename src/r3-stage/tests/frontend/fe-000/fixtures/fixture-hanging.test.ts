import test from 'node:test';

test('hanging worker with active timer must be killed by worker timeout guard', async () => {
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      // Keep event loop alive past worker timeout
    }, 500);
    setTimeout(() => {
      clearInterval(timer);
      resolve(undefined);
    }, 60_000);
  });
});
