import test from 'node:test';

test('abnormal process termination', () => {
  process.kill(process.pid, 'SIGTERM');
});
