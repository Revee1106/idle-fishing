// BE-000-R1 pre-rework reproduction.
// Copied from the independent reviewer's TEST_VERIFICATION.md (A1-A8), only
// relative import paths were adjusted. Run against the unmodified 358b111 tree.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFilePort } from '../../../../../tests/backend/be-000/helpers.ts';
import {
  createInitialState,
  advanceOffline,
  buildEnvelope,
  SpikeFileSaveRepository,
  SLOT_PATHS,
  computeEnvelopeHash,
  completionTimeMs,
} from '../../../../../packages/game-core/src/spike/index.ts';

const state = () => createInitialState({ saveEpoch: 'audit', startMs: 0, allowanceMs: 10000 });
const setup = () => {
  const port = new MemoryFilePort();
  return { port, repo: new SpikeFileSaveRepository(port) };
};

test('A1 unknown slot cannot authorize a new save', async () => {
  const { port, repo } = setup();
  port.files.set(SLOT_PATHS[0], buildEnvelope(state(), '9').text);
  port.readErrors.set(SLOT_PATHS[0], 'busy');
  const result = await repo.commit(state(), null);
  assert.equal(port.writeCount, 0, JSON.stringify(result));
});

test('A2 durable write with unreadable target stays uncertain', async () => {
  const { port, repo } = setup();
  await repo.commit(state(), null);
  port.writeBehavior = (path) => {
    port.readErrors.set(path, 'busy');
    return { kind: 'WRITE_THEN_THROW' };
  };
  const result = await repo.commit({ ...state(), gold: '8' }, '1');
  port.readErrors.clear();
  const loaded = await repo.load();
  assert.equal(loaded.revision, '2');
  assert.equal(result.kind, 'UNCERTAIN');
});

test('A3 conflicting highest slots cannot authorize a write', async () => {
  const { port, repo } = setup();
  port.files.set(SLOT_PATHS[0], buildEnvelope(state(), '7').text);
  port.files.set(SLOT_PATHS[1], buildEnvelope({ ...state(), gold: '9' }, '7').text);
  assert.equal((await repo.load()).kind, 'CORRUPT');
  const result = await repo.commit(state(), '7');
  assert.equal(port.writeCount, 0, JSON.stringify(result));
});

test('A4 invalid payload in one slot still allows backup recovery', async () => {
  const { port, repo } = setup();
  await repo.commit(state(), null);
  const e = buildEnvelope(state(), '2').envelope;
  const payload = 'null';
  port.files.set(
    SLOT_PATHS[1],
    JSON.stringify({ ...e, payload, sha256: computeEnvelopeHash(e.magic, e.format, e.revision, e.epoch, payload) })
  );
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  assert.equal(loaded.revision, '1');
});

test('A5 offline checkpoint records time already settled', () => {
  const s = advanceOffline(state(), 4500).state;
  assert.equal(s.cursorMs, 4500);
  assert.equal(s.offline.settledUntilMs, 4500);
});

test('A6 resulting time must remain a safe millisecond', () => {
  const value = completionTimeMs('0', '2', Number.MAX_SAFE_INTEGER - 1, 1n);
  assert.ok(value === null || Number.isSafeInteger(value), String(value));
});

test('A7 exact fight completion at deadline issues one reward', () => {
  const s = state();
  const stop = s.offline.deadlineMs;
  Object.assign(s, {
    stage: 'FIGHTING',
    stageStartMs: 0,
    stageDone: '0',
    stageRequired: String(BigInt(stop) * 1000000n),
  });
  s.counters.attempts = 1;
  const at = advanceOffline(s, stop).state;
  const after = advanceOffline(at, stop + 1).state;
  assert.deepEqual(at.claims, ['fish:1']);
  assert.equal(after.gold, at.gold);
  assert.equal(after.counters.attempts, 1);
});

test('A8 previously claimed reward must not be paid by restored fight', async () => {
  const { port, repo } = setup();
  const s = state();
  Object.assign(s, {
    stage: 'FIGHTING',
    stageRequired: '1000000',
    gold: '100',
    claims: ['fish:1'],
    lastTerminalAttemptSeq: '1',
  });
  s.counters.attempts = 1;
  const result = await repo.commit(s, null);
  if (result.kind !== 'COMMITTED') {
    assert.equal(port.writeCount, 0);
    return;
  }
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  const next = advanceOffline(loaded.raw, 1).state;
  assert.equal(next.gold, '100', JSON.stringify({ gold: next.gold, claims: next.claims }));
});