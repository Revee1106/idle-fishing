import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SLOT_PATHS,
  SpikeFileSaveRepository,
  parseEnvelope,
} from '../../../packages/game-core/src/spike/save.ts';
import { MigrationError, migrateSpikeState } from '../../../packages/game-core/src/spike/migration.ts';
import { canonicalStringify, natToBigInt } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { advanceOffline } from '../../../packages/game-core/src/spike/offline.ts';
import type { SpikeGameState, SpikeGameStateV1 } from '../../../packages/game-core/src/spike/types.ts';
import { MemoryFilePort } from './helpers.ts';

function v1Fixture(): SpikeGameStateV1 {
  return {
    schemaVersion: 1,
    saveEpoch: 'epoch.be000',
    rootSeed: 0x1234abcd,
    cursorMs: 1_700_000_000_000,
    counter: 7,
    gold: '42',
    rng: {
      algorithm: 'XOSHIRO128SS_V1',
      streams: { wait: [2370583620, 3926777320, 586938497, 161005436] },
    },
  };
}

function v1AttemptFixture(): SpikeGameStateV1 {
  return {
    ...v1Fixture(),
    attempt: {
      stage: 'FIGHTING',
      stageStartMs: 1_700_000_000_000 - 4_000,
      stageDone: '5000000000',
      stageRequired: '9362000000',
      lock: {
        seq: 7,
        claimKey: 'fish:7',
        speciesU: 0.09688973893848996,
        captureU: 0.4494557859023359,
        fightMs: 9_362,
      },
    },
  };
}

test('MIG-01 v1 loads, migrates to v2 and is committed as a new revision', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const first = await repo.commit(v1Fixture() as unknown as SpikeGameState, null);
  assert.equal(first.kind, 'COMMITTED');

  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  assert.equal(loaded.schemaVersion, 1);

  const migrated = migrateSpikeState(loaded.raw, 1, 2);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.saveEpoch, 'epoch.be000');
  assert.equal(migrated.rootSeed, 0x1234abcd);
  assert.equal(migrated.cursorMs, 1_700_000_000_000);
  assert.equal(migrated.counters.attempts, 7);
  assert.equal(migrated.counters.casts, 0);
  assert.deepEqual(migrated.claims, []);
  assert.equal(migrated.lastTerminalAttemptSeq, '0');
  assert.equal(migrated.big, '0');
  assert.equal(migrated.envNextCheckMs, 1_700_000_000_000 + 300_000);
  assert.equal(migrated.envActivityMicro, 1_000_000);
  assert.equal(migrated.offline, null);
  assert.deepEqual(migrated.rng.streams.wait, [2370583620, 3926777320, 586938497, 161005436]);

  const second = await repo.commit(migrated, loaded.revision);
  assert.equal(second.kind, 'COMMITTED');

  const reloaded = await repo.load();
  assert.equal(reloaded.kind, 'VALID');
  if (reloaded.kind !== 'VALID') return;
  assert.equal(reloaded.schemaVersion, 2);
  assert.equal((reloaded.raw as SpikeGameState).counters.attempts, 7);
  assert.equal(reloaded.revision, '2');

  const oldSlot = parseEnvelope(port.files.get(SLOT_PATHS[0] as string) as string);
  assert.ok(oldSlot.ok);
  assert.equal(oldSlot.value.schemaVersion, 1);
});

test('MIG-02 invalid v1 is rejected without touching persisted data', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await repo.commit(v1Fixture() as unknown as SpikeGameState, null);
  const before = new Map(port.files);

  const broken = { ...v1Fixture(), counter: -1 };
  assert.throws(() => migrateSpikeState(broken, 1, 2), MigrationError);
  const brokenGold = { ...v1Fixture(), gold: '01' };
  assert.throws(() => migrateSpikeState(brokenGold, 1, 2), MigrationError);
  const brokenRng = { ...v1Fixture(), rng: { algorithm: 'OTHER', streams: {} } };
  assert.throws(() => migrateSpikeState(brokenRng, 1, 2), MigrationError);

  assert.deepEqual(port.files, before);
  const load = await repo.load();
  assert.equal(load.kind, 'VALID');
  if (load.kind === 'VALID') assert.equal(load.schemaVersion, 1);
});

test('MIG-05 in-progress v1 attempt keeps progress, lock and RNG and settles once', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const source = v1AttemptFixture();
  const first = await repo.commit(source as unknown as SpikeGameState, null);
  assert.equal(first.kind, 'COMMITTED');
  const originalV1Text = port.files.get(SLOT_PATHS[0] as string) as string;

  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind !== 'VALID') return;
  assert.equal(loaded.schemaVersion, 1);

  const migrated = migrateSpikeState(loaded.raw, 1, 2);
  assert.equal(migrated.stage, 'FIGHTING');
  assert.equal(migrated.stageStartMs, source.attempt!.stageStartMs);
  assert.equal(migrated.stageDone, source.attempt!.stageDone);
  assert.equal(migrated.stageRequired, source.attempt!.stageRequired);
  assert.equal(migrated.counters.attempts, 7);
  assert.equal(migrated.counters.casts, 1);
  assert.equal(migrated.counters.waits, 1);
  assert.equal(migrated.counters.fights, 1);
  assert.deepEqual(migrated.claims, []);
  assert.equal(migrated.lastTerminalAttemptSeq, '0');
  assert.deepEqual(migrated.attemptLock, source.attempt!.lock);
  assert.equal(canonicalStringify(migrated.rng), canonicalStringify(source.rng));
  assert.equal(migrated.rng.streams.species, undefined, 'migration must not re-draw');
  const rngBefore = canonicalStringify(migrated.rng);

  const second = await repo.commit(migrated, loaded.revision);
  assert.equal(second.kind, 'COMMITTED');
  assert.equal(port.files.get(SLOT_PATHS[0] as string), originalV1Text, 'old v1 slot must remain readable');

  const reloaded = await repo.load();
  assert.equal(reloaded.kind, 'VALID');
  if (reloaded.kind !== 'VALID') return;
  assert.equal(reloaded.schemaVersion, 2);
  const resumed = reloaded.raw as SpikeGameState;
  assert.equal(canonicalStringify(resumed.rng), rngBefore);

  const target = resumed.cursorMs + 5_000;
  const settled = advanceOffline(resumed, target).state;
  assert.equal(settled.stage, 'PREPARING');
  assert.deepEqual(settled.claims, ['fish:7']);
  assert.equal(settled.lastTerminalAttemptSeq, '7');
  assert.equal(settled.counters.events, 1);
  assert.equal(settled.attemptLock, undefined);
  assert.ok(natToBigInt(settled.gold) > natToBigInt(source.gold));
  const settledGold = settled.gold;
  const settledBig = settled.big;

  const saved = await repo.commit(settled, reloaded.revision);
  assert.equal(saved.kind, 'COMMITTED');
  const afterSave = await repo.load();
  assert.equal(afterSave.kind, 'VALID');
  if (afterSave.kind !== 'VALID') return;
  const restored = afterSave.raw as SpikeGameState;
  const replay = advanceOffline(restored, restored.cursorMs + 100).state;
  assert.equal(replay.gold, settledGold, 'settlement must happen only once');
  assert.equal(replay.big, settledBig);
  assert.deepEqual(replay.claims.filter((key) => key === 'fish:7'), ['fish:7']);
  assert.equal(replay.counters.events, 1);
});

test('MIG-06 invalid in-progress v1 leaves the original slot bytes untouched', async () => {
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  await repo.commit(v1AttemptFixture() as unknown as SpikeGameState, null);
  const before = new Map(port.files);

  const badLock = v1AttemptFixture();
  badLock.attempt!.lock = { ...badLock.attempt!.lock!, fightMs: 9_363 };
  assert.throws(() => migrateSpikeState(badLock, 1, 2), /does not match stageRequired/);

  const missingLock = v1AttemptFixture();
  delete missingLock.attempt!.lock;
  assert.throws(() => migrateSpikeState(missingLock, 1, 2), /requires a locked result/);

  assert.deepEqual(port.files, before);
  const loaded = await repo.load();
  assert.equal(loaded.kind, 'VALID');
  if (loaded.kind === 'VALID') assert.equal(loaded.schemaVersion, 1);
});

test('MIG-03 unsupported migration paths are refused', () => {
  assert.throws(() => migrateSpikeState(v1Fixture(), 2, 1), /Unsupported migration path/);
  assert.throws(() => migrateSpikeState(v1Fixture(), 0, 2), /Unsupported migration path/);
  assert.throws(() => migrateSpikeState(v1Fixture(), 2, 2), /expected schemaVersion 2/);
});

test('MIG-04 same-version migration returns an independent deep copy', () => {
  const source: SpikeGameState = {
    schemaVersion: 2,
    saveEpoch: 'epoch.be000',
    rootSeed: 1,
    cursorMs: 5,
    stage: 'IDLE',
    stageStartMs: 0,
    stageDone: '0',
    stageRequired: '0',
    counters: { attempts: 0, casts: 0, waits: 0, fights: 0, prepares: 0, cycles: 0, envChecks: 0, events: 0 },
    gold: '0',
    claims: ['a'],
    lastTerminalAttemptSeq: '0',
    rng: { algorithm: 'XOSHIRO128SS_V1', streams: {} },
    big: '0',
    envNextCheckMs: 300005,
    envActivityMicro: 1_000_000,
    offline: null,
  };
  const copy = migrateSpikeState(source, 2, 2);
  assert.equal(canonicalStringify(copy), canonicalStringify(source));
  copy.claims.push('b');
  copy.counters.attempts = 3;
  assert.deepEqual(source.claims, ['a']);
  assert.equal(source.counters.attempts, 0);
});