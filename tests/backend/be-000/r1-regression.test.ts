import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SAVE_MAGIC,
  SAVE_FORMAT,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  buildEnvelope,
  computeEnvelopeHash,
  copyStateForCommit,
} from '../../../packages/game-core/src/spike/save.ts';
import {
  advanceOffline,
  advanceOfflineSliced,
  createInitialState,
} from '../../../packages/game-core/src/spike/offline.ts';
import { canonicalStringify, natToBigInt } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { completionTimeMs, safeAddMs } from '../../../packages/game-core/src/spike/time.ts';
import type { SpikeGameState } from '../../../packages/game-core/src/spike/types.ts';
import { MemoryFilePort, type WriteBehavior } from './helpers.ts';

const START_MS = 1_700_000_000_000;
const HOUR = 3_600_000;
const DEADLINE = START_MS + 2 * HOUR;

function state(gold = '0'): SpikeGameState {
  const s = createInitialState({ saveEpoch: 'epoch.r1', startMs: START_MS, allowanceMs: 2 * HOUR });
  s.gold = gold;
  return s;
}

function writeEnvelope(port: MemoryFilePort, slot: number, raw: unknown, revision: string): void {
  const payload = canonicalStringify(raw);
  const text = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision,
    epoch: 'epoch.r1',
    payload,
    sha256: computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, revision, 'epoch.r1', payload),
  });
  port.files.set(SLOT_PATHS[slot] as string, text);
}

test('R1-SAVE-01 an unreadable slot blocks commit even when an older backup is readable', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await repo.commit(state('1'), null);
  await repo.commit(state('2'), '1');

  port.readErrors.set(SLOT_PATHS[1] as string, 'busy');
  const before = new Map(port.files);
  const result = await repo.commit(state('3'), '2');
  assert.equal(result.kind, 'UNCERTAIN');
  assert.equal(port.writeCount, 2, 'no new write may be attempted');
  assert.deepEqual(port.files, before);

  const backup = await repo.load();
  assert.equal(backup.kind, 'VALID');
  if (backup.kind === 'VALID') {
    assert.equal(backup.revision, '1');
    assert.equal(backup.recovered, true);
  }

  port.readErrors.clear();
  const recovered = await repo.load();
  assert.equal(recovered.kind, 'VALID');
  if (recovered.kind === 'VALID') assert.equal(recovered.revision, '2');
});

test('R1-SAVE-02 valid checksum with a null payload is isolated and backup is recovered', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await repo.commit(state('5'), null);
  writeEnvelope(port, 1, null, '2');

  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  assert.equal(loaded.revision, '1');
  assert.equal(loaded.recovered, true);
  assert.ok(loaded.warnings.some((w) => w.includes('save_slot_1.json')));
});

test('R1-SAVE-03 same revision with different content blocks commit without writing', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const a = state('7');
  const b = state('8');
  writeEnvelope(port, 0, a, '7');
  writeEnvelope(port, 1, b, '7');

  assert.equal((await repo.load()).kind, 'CORRUPT');
  const before = new Map(port.files);
  const result = await repo.commit(state('9'), '7');
  assert.equal(result.kind, 'FAILED');
  assert.equal(port.writeCount, 0);
  assert.deepEqual(port.files, before);
});

test('R1-SAVE-04 a hidden higher revision forbids a new first commit', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  writeEnvelope(port, 0, state('9'), '9');
  port.readErrors.set(SLOT_PATHS[0] as string, 'busy');

  const result = await repo.commit(state('1'), null);
  assert.equal(result.kind, 'UNCERTAIN');
  assert.equal(port.writeCount, 0);

  port.readErrors.clear();
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind === 'VALID') {
    assert.equal(loaded.revision, '9');
    assert.equal((loaded.raw as SpikeGameState).gold, '9');
  }
});

test('R1-SAVE-05 durable write whose target becomes unreadable stays UNCERTAIN', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await repo.commit(state('1'), null);

  port.writeBehavior = (path: string): WriteBehavior => {
    port.readErrors.set(path, 'busy');
    return { kind: 'WRITE_THEN_THROW' };
  };
  const result = await repo.commit(state('8'), '1');
  assert.equal(result.kind, 'UNCERTAIN');
  assert.ok((result as { detail: string }).detail.includes('unreadable'));

  port.readErrors.clear();
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind === 'VALID') {
    assert.equal(loaded.revision, '2');
    assert.equal((loaded.raw as SpikeGameState).gold, '8');
  }
});

test('R1-CHK-01 persistence records cursor, rewards, RNG and checkpoint before, at and past the deadline', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const initial = state('0');

  const first = await repo.commit(initial, null);
  assert.equal(first.kind, 'COMMITTED');

  const before = advanceOffline(initial, DEADLINE - 1000).state;
  assert.equal(before.offline?.settledUntilMs, DEADLINE - 1000);
  assert.equal(before.cursorMs, DEADLINE - 1000);
  const second = await repo.commit(before, '1');
  assert.equal(second.kind, 'COMMITTED');

  const exact = advanceOffline(before, DEADLINE).state;
  assert.equal(exact.offline?.settledUntilMs, DEADLINE);
  assert.equal(exact.cursorMs, DEADLINE);
  const third = await repo.commit(exact, '2');
  assert.equal(third.kind, 'COMMITTED');

  const past = advanceOffline(exact, DEADLINE + 5000).state;
  assert.equal(past.offline?.settledUntilMs, DEADLINE);
  assert.equal(past.cursorMs, DEADLINE + 5000);
  assert.deepEqual(past.claims, exact.claims);
  assert.equal(past.gold, exact.gold);
  assert.equal(past.counters.attempts, exact.counters.attempts);
  const fourth = await repo.commit(past, '3');
  assert.equal(fourth.kind, 'COMMITTED');

  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  assert.equal(loaded.revision, '4');
  const restored = copyStateForCommit(loaded.raw as SpikeGameState);
  assert.equal(canonicalStringify(restored), canonicalStringify(past));
  assert.equal(restored.offline?.settledUntilMs, DEADLINE);
  assert.equal(restored.offline?.deadlineMs, DEADLINE);
  assert.equal(restored.cursorMs, DEADLINE + 5000);
  assert.equal(restored.gold, past.gold);
  assert.deepEqual(restored.claims, past.claims);
  assert.equal(canonicalStringify(restored.rng), canonicalStringify(past.rng));
});

test('R1-TIME-01 completion and slices reject unrepresentable millisecond results', () => {
  assert.equal(completionTimeMs('0', '1', Number.MAX_SAFE_INTEGER - 1, 1n), Number.MAX_SAFE_INTEGER);
  assert.equal(completionTimeMs('0', '2', Number.MAX_SAFE_INTEGER - 1, 1n), null);
  assert.equal(completionTimeMs('0', '1', Number.MAX_SAFE_INTEGER, 1n), null);
  assert.throws(() => safeAddMs(Number.MAX_SAFE_INTEGER, 1), /safe millisecond range/);
  assert.throws(
    () => createInitialState({ saveEpoch: 'epoch.r1', startMs: Number.MAX_SAFE_INTEGER, allowanceMs: 1 }),
    /safe millisecond range/
  );

  assert.throws(
    () => createInitialState({
      saveEpoch: 'epoch.r1',
      startMs: Number.MAX_SAFE_INTEGER - 1000,
      allowanceMs: 1000,
    }),
    /initial environment check time.*safe millisecond range/
  );

  const near = createInitialState({
    saveEpoch: 'epoch.r1',
    startMs: Number.MAX_SAFE_INTEGER - 400_000,
    allowanceMs: 400_000,
  });
  const sliced = advanceOfflineSliced(near, Number.MAX_SAFE_INTEGER, 100, { maxNodes: 1 });
  assert.ok(Number.isSafeInteger(sliced.state.cursorMs));
  assert.ok(natToBigInt(sliced.state.gold) >= 0n);
});