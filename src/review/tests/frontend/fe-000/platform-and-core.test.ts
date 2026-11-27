/**
 * FE-000 Frontend Platform & Shared Core Automated Tests (Node.js + Mock wx environment).
 * Clearly labeled as NODE / MOCK tests — never substitutes for Web or real WeChat verification.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceOffline,
  advanceOfflineSliced,
  canonicalStringify,
  createInitialState,
  migrateSpikeState,
  natFromBigInt,
  natToBigInt,
  newRngState,
  sha256Hex,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  xoshiroStep,
  type RngWords,
} from '@idle-fishing/game-core';
import { WeChatFilePort, FilePortIoError } from '../../../apps/game-client/assets/scripts/platform/WeChatFilePort';
import { MemoryFilePort } from '../../../apps/game-client/assets/scripts/platform/BrowserFilePort';
import { FaultInjectingFilePort } from '../../../apps/game-client/assets/scripts/platform/FaultInjectingFilePort';
import {
  MonotonicTimelineGuard,
  VirtualClockProvider,
} from '../../../apps/game-client/assets/scripts/platform/WeChatClockProvider';
import { RuntimeLifecycleProvider } from '../../../apps/game-client/assets/scripts/platform/WeChatLifecycleProvider';
import {
  ExperimentalAdStubCoordinator,
  WeChatRewardedAdAdapter,
} from '../../../apps/game-client/assets/scripts/platform/ExperimentalAdProvider';

function createMockWxFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['wxfile://usr']);
  let failReadOn: string | null = null;
  let failWriteOn: string | null = null;

  const fs = {
    accessSync(p: string) {
      if (!dirs.has(p) && !files.has(p)) {
        const err = new Error(`accessSync:fail no such file or directory ${p}`);
        throw err;
      }
    },
    mkdirSync(p: string) {
      dirs.add(p);
    },
    readFileSync(p: string, _encoding?: string) {
      if (failReadOn && p.endsWith(failReadOn)) {
        throw new Error(`readFileSync:fail permission denied ${p}`);
      }
      if (!files.has(p)) {
        throw new Error(`readFileSync:fail no such file or directory ${p}`);
      }
      return files.get(p)!;
    },
    writeFileSync(p: string, data: string) {
      if (failWriteOn && p.endsWith(failWriteOn)) {
        throw new Error(`writeFileSync:fail maximum size of the file storage limit is exceeded ${p}`);
      }
      files.set(p, data);
    },
    unlinkSync(p: string) {
      if (!files.has(p)) {
        throw new Error(`unlinkSync:fail no such file or directory ${p}`);
      }
      files.delete(p);
    },
    readdirSync(dir: string) {
      const prefix = `${dir}/`;
      const out: string[] = [];
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          out.push(key.slice(prefix.length));
        }
      }
      return out;
    },
  };

  return {
    wx: {
      env: { USER_DATA_PATH: 'wxfile://usr' },
      getFileSystemManager: () => fs,
    },
    files,
    setFailReadOn: (suffix: string | null) => {
      failReadOn = suffix;
    },
    setFailWriteOn: (suffix: string | null) => {
      failWriteOn = suffix;
    },
  };
}

test('[NODE/T02/T03] Shared @idle-fishing/game-core golden PRNG, BigInt & continuous==sliced', () => {
  let words: RngWords = [1, 2, 3, 4];
  const outputs: number[] = [];
  for (let i = 0; i < 5; i++) {
    const step = xoshiroStep(words);
    outputs.push(step.value);
    words = step.state;
  }
  assert.deepEqual(outputs, [11520, 0, 5927040, 70819200, 2031721883]);
  assert.deepEqual(words, [15224335, 29364750, 272377353, 1125134346]);

  const huge = 123_456_789_012_345_678_901_234_567_890n;
  assert.equal(natToBigInt(natFromBigInt(huge)), huge);

  const initial = createInitialState({
    saveEpoch: 'fe000-node-test',
    startMs: 1_700_000_000_000,
    allowanceMs: 24 * 3600 * 1000,
  });
  const target = initial.cursorMs + 3_600_000;
  const cont = advanceOffline(initial, target);
  const sliced = advanceOfflineSliced(initial, target, 60_000);
  assert.equal(canonicalStringify(cont.state), canonicalStringify(sliced.state));
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('[MOCK-WX/T04] WeChatFilePort CRUD, ENOENT->null, IO error->throw, path guard & quota error', async () => {
  const mock = createMockWxFs();
  const prevWx = (globalThis as Record<string, unknown>).wx;
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const port = new WeChatFilePort('idle_fishing');
    assert.equal(await port.read('save_slot_0.json'), null);

    await port.write('save_slot_0.json', '{"v":1}');
    assert.equal(await port.read('save_slot_0.json'), '{"v":1}');

    await port.write('save_slot_0.json', '{"v":2}');
    assert.equal(await port.read('save_slot_0.json'), '{"v":2}');
    assert.deepEqual(await port.list(), ['save_slot_0.json']);

    // Permission / IO error must throw, never return null
    mock.setFailReadOn('save_slot_0.json');
    await assert.rejects(() => port.read('save_slot_0.json'), FilePortIoError);
    mock.setFailReadOn(null);

    // Quota error must throw FilePortIoError
    mock.setFailWriteOn('quota.json');
    await assert.rejects(() => port.write('quota.json', 'x'.repeat(100)), FilePortIoError);
    mock.setFailWriteOn(null);

    // Path traversal blocked
    await assert.rejects(() => port.read('../secret.json'), FilePortIoError);
    await assert.rejects(() => port.write('/abs.json', 'bad'), FilePortIoError);

    // Remove is idempotent
    await port.remove('save_slot_0.json');
    await port.remove('save_slot_0.json');
    assert.equal(await port.read('save_slot_0.json'), null);
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/T04/T05/T07] 3-slot rotation, corrupt backup recovery, fault injection & v1->v2 migration', async () => {
  const mem = new MemoryFilePort();
  const fault = new FaultInjectingFilePort(mem);
  const repo = new SpikeFileSaveRepository(fault);

  let state = createInitialState({
    saveEpoch: 'fe000-slot-epoch',
    startMs: 1_700_000_000_000,
    allowanceMs: 8 * 3600 * 1000,
  });

  // Commit rev 1
  const c1 = await repo.commit(state, null);
  assert.equal(c1.kind, 'COMMITTED');
  assert.equal(c1.revision, '1');

  // Pre-write fault leaves rev 1 intact
  state = advanceOffline(state, state.cursorMs + 60_000).state;
  fault.armNextWriteFault('PRE_WRITE_ERROR');
  const f1 = await repo.commit(state, '1');
  assert.equal(f1.kind, 'FAILED');

  // Partial write corrupts target slot, load recovers rev 1 backup
  fault.armNextWriteFault('PARTIAL_WRITE');
  const f2 = await repo.commit(state, '1');
  assert.equal(f2.kind, 'FAILED');
  const rec = await repo.load();
  assert.equal(rec.kind, 'VALID');
  if (rec.kind === 'VALID') {
    assert.equal(rec.revision, '1');
    assert.equal(rec.recovered, true);
  }

  // Post-write throw (uncertain write) -> rescan claims rev 2 once
  fault.armNextWriteFault('POST_WRITE_THROW');
  const c2 = await repo.commit(state, '1');
  assert.equal(c2.kind, 'COMMITTED');
  if (c2.kind === 'COMMITTED') {
    assert.equal(c2.revision, '2');
    assert.equal(c2.recoveredFromUncertainWrite, true);
  }

  // All slots corrupt -> CORRUPT (never EMPTY)
  for (const p of SLOT_PATHS) {
    await mem.write(p, 'CORRUPT_DATA');
  }
  const allBad = await repo.load();
  assert.equal(allBad.kind, 'CORRUPT');

  // v1 -> v2 migration
  const migrated = migrateSpikeState(
    {
      schemaVersion: 1,
      saveEpoch: 'fe000-v1',
      rootSeed: 0x1234abcd,
      cursorMs: 1_700_000_000_000,
      counter: 12,
      gold: '999',
      rng: newRngState(),
    },
    1,
    2
  );
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.gold, '999');
  assert.equal(migrated.counters.attempts, 12);
});

test('[NODE/T08] Lifecycle dedupe, clock rollback freeze & +48h forward-jump deadline clamp', () => {
  const lc = new RuntimeLifecycleProvider();
  const events: string[] = [];
  const unsub = lc.subscribe((e) => events.push(e));
  lc.emit('HIDE', 't1');
  lc.emit('HIDE', 't2');
  lc.emit('SHOW', 't3');
  lc.emit('SHOW', 't4');
  unsub();
  assert.deepEqual(events, ['HIDE', 'SHOW']);

  const t0 = 1_700_000_000_000;
  const deadline = t0 + 8 * 3600 * 1000;
  const clock = new VirtualClockProvider(t0, 500);
  const guard = new MonotonicTimelineGuard(clock, 2000);

  clock.advance(10_000);
  const ok = guard.tickForeground(clock);
  assert.equal(ok.ok, true);
  assert.equal(ok.cursorMs, t0 + 10_000);

  // Wall rollback -> CLOCK_ERROR freeze, cursor unchanged
  clock.setWallMs(t0 - 120_000);
  const rb = guard.tickForeground(clock);
  assert.equal(rb.ok, false);
  assert.equal(rb.code, 'CLOCK_ERROR');
  assert.equal(rb.cursorMs, t0 + 10_000);

  // Resume rejected while wall < highWater
  const badRes = guard.lockOfflineResumeTarget(clock, deadline);
  assert.equal(badRes.ok, false);
  assert.equal(badRes.code, 'CLOCK_ERROR');

  // Forward jump +48h -> clamped to 8h deadline
  clock.setWallMs(t0 + 48 * 3600 * 1000);
  const clamped = guard.lockOfflineResumeTarget(clock, deadline);
  assert.equal(clamped.ok, true);
  assert.equal(clamped.clampedByDeadline, true);
  assert.equal(clamped.lockedTargetMs, deadline);
});

test('[MOCK/T09] Experimental Ad 5-case stub & empty-adUnitId real adapter guard', async () => {
  const realAdapter = new WeChatRewardedAdAdapter('');
  assert.equal(realAdapter.isAvailable('SPEED'), false);
  const unavail = await realAdapter.show('req-1', 'SPEED');
  assert.equal(unavail.outcome, 'FAILED');

  const stub = new ExperimentalAdStubCoordinator();
  const r1 = await stub.runScenario('SPEED', 'COMPLETED');
  const r2 = await stub.runScenario('SPEED', 'CANCELLED');
  const r3 = await stub.runScenario('GOLD', 'LOAD_FAILED');
  const r4 = await stub.runScenario('BAIT', 'PLAY_FAILED');
  const r5 = await stub.runScenario('RESET', 'DUPLICATE_CALLBACK');

  assert.equal(r1.record.status, 'REWARDED');
  assert.equal(r1.record.rewardDispatchCount, 1);
  assert.equal(r2.record.status, 'CANCELLED');
  assert.equal(r2.record.rewardDispatchCount, 0);
  assert.equal(r3.record.status, 'FAILED');
  assert.equal(r4.record.status, 'FAILED');
  assert.equal(r5.record.status, 'REWARDED');
  assert.equal(r5.record.rewardDispatchCount, 1);
  assert.equal(r5.ignoredDuplicates, 2);
  assert.equal(stub.getRewardAckCount(), 2);
});
