import assert from 'node:assert/strict';
import test from 'node:test';

test('normal passing leaf alongside throwing TODO', () => {
  assert.strictEqual(1 + 1, 2);
});

test('todo leaf that throws must be counted as todo (not fail) matching Node 24', { todo: true }, () => {
  throw new Error('intentional throwing TODO callback');
});
