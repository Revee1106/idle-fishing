import test from 'node:test';

test('only throwing TODO leaf still triggers zero-pass guard', { todo: true }, () => {
  throw new Error('intentional throwing TODO with zero passing tests');
});
