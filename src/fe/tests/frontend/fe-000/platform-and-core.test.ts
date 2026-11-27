/**
 * FE-000-R1 Frontend Platform & Shared Core Automated Tests (Node.js + Mock wx / Mock DOM).
 * Explicitly labeled by host: [NODE], [MOCK-WX], [MOCK-DOM].
 * Never substitutes for real Cocos Web, WeChat DevTools, or real device verification.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceOffline,
  advanceOfflineSliced,
  buildEnvelope,
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
import { detectRuntimeEnv } from '../../../apps/game-client/assets/scripts/platform/PlatformTypes';
import { WeChatFilePort, FilePortIoError } from '../../../apps/game-client/assets/scripts/platform/WeChatFilePort';
import { MemoryFilePort } from '../../../apps/game-client/assets/scripts/platform/BrowserFilePort';
import { FaultInjectingFilePort } from '../../../apps/game-client/assets/scripts/platform/FaultInjectingFilePort';
import {
  detectWxPerfMicrosecondUnit,
  MonotonicTimelineGuard,
  VirtualClockProvider,
} from '../../../apps/game-client/assets/scripts/platform/WeChatClockProvider';
import { RuntimeLifecycleProvider } from '../../../apps/game-client/assets/scripts/platform/WeChatLifecycleProvider';
import {
  ExperimentalAdStubCoordinator,
  WeChatRewardedAdAdapter,
} from '../../../apps/game-client/assets/scripts/platform/ExperimentalAdProvider';
import {
  runFileSystemAndSaveSuite,
  runLifecycleClockAndAdSuite,
} from '../../../apps/game-client/assets/scripts/platform/PlatformVerificationSuite';

function createMockWxEnv() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['wxfile://usr']);
  const showListeners = new Set<() => void>();
  const hideListeners = new Set<() => void>();
  let failReadOn: string | null = null;
  let failWriteOn: string | null = null;

  const fs = {
    accessSync(p: string) {
      if (!dirs.has(p) && !files.has(p)) {
        throw new Error(`accessSync:fail no such file or directory ${p}`);
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
      __FE000_MOCK__: true,
      env: { USER_DATA_PATH: 'wxfile://usr' },
      getFileSystemManager: () => fs,
      getPerformance: () => ({ now: () => 12345 }),
      onShow: (cb: () => void) => showListeners.add(cb),
      offShow: (cb: () => void) => showListeners.delete(cb),
      onHide: (cb: () => void) => hideListeners.add(cb),
      offHide: (cb: () => void) => hideListeners.delete(cb),
    },
    files,
    showListeners,
    hideListeners,
    setFailReadOn: (suffix: string | null) => {
      failReadOn = suffix;
    },
    setFailWriteOn: (suffix: string | null) => {
      failWriteOn = suffix;
    },
  };
}

function createMockDocumentEnv() {
  const listeners = new Set<() => void>();
  let visibilityState: 'visible' | 'hidden' = 'visible';
  const doc = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') listeners.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      if (type === 'visibilitychange') listeners.delete(cb);
    },
    dispatchVisibility(next: 'visible' | 'hidden') {
      visibilityState = next;
      for (const cb of Array.from(listeners)) cb();
    },
  };
  return { doc, listeners };
}

test('[NODE/T02/T03] Shared @idle-fishing/game-core golden PRNG, BigInt & BE-000 epoch.be000 hashes', () => {
  assert.equal(detectRuntimeEnv(), 'NODE');

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

  // Exact BE-000 SHARED_MODULE_HANDOFF.md §6.2 golden vectors (pinned commit 358b111)
  const initial = createInitialState({
    saveEpoch: 'epoch.be000',
    startMs: 1_700_000_000_000,
    allowanceMs: 86_400_000,
  });
  assert.equal(
    sha256Hex(canonicalStringify(initial)),
    '79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4'
  );

  const oneHourTarget = initial.cursorMs + 3_600_000;
  const cont1h = advanceOffline(initial, oneHourTarget);
  const sliced1h = advanceOfflineSliced(initial, oneHourTarget, 60_000);
  const canon1h = canonicalStringify(cont1h.state);
  assert.equal(canon1h, canonicalStringify(sliced1h.state));
  assert.equal(sha256Hex(canon1h), 'bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a');
  assert.equal(sha256Hex(buildEnvelope(cont1h.state, '1').text), '2c768fc2d368faa38b841e8b94c55d1e9398c80ff4e894a49cc2644b056ed5ee');

  const eightHour = advanceOffline(initial, initial.cursorMs + 8 * 3_600_000);
  assert.equal(
    sha256Hex(canonicalStringify(eightHour.state)),
    '7da517674df168ca5f88535b949f51a072982e77a0577b362811aa21c430839f'
  );

  const full24h = advanceOffline(initial, initial.cursorMs + 86_400_000);
  assert.equal(
    sha256Hex(buildEnvelope(full24h.state, '1').text),
    '88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536'
  );
});

test('[MOCK-WX/T04] WeChatFilePort CRUD, ENOENT->null, IO/quota errors, path guard & 3-slot save', async () => {
  const mock = createMockWxEnv();
  const prevWx = (globalThis as Record<string, unknown>).wx;
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    // V02 fix: Mock wx under Node must report WECHAT_MOCK, never real WECHAT_DEVICE
    assert.equal(detectRuntimeEnv(), 'WECHAT_MOCK');

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

    // Idempotent remove
    await port.remove('save_slot_0.json');
    await port.remove('save_slot_0.json');
    assert.equal(await port.read('save_slot_0.json'), null);

    // Full 3-slot save suite directly on WeChatFilePort (mock wx FS)
    const suiteRes = await runFileSystemAndSaveSuite(port);
    assert.equal(suiteRes.length, 6);
    for (const r of suiteRes) {
      assert.equal(r.status, 'PASS', `${r.id} failed: ${r.detail}`);
      assert.equal(r.env, 'WECHAT_MOCK');
    }
    // I05: suite owner must release wx listeners after normal exit
    assert.deepEqual([mock.showListeners.size, mock.hideListeners.size], [0, 0]);
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[NODE-MEMORY/T04/T05/T07] MemoryFilePort 3-slot rotation, fault injection & v1->v2 migration', async () => {
  const mem = new MemoryFilePort();
  const fault = new FaultInjectingFilePort(mem);
  const repo = new SpikeFileSaveRepository(fault);

  let state = createInitialState({
    saveEpoch: 'fe000-slot-epoch',
    startMs: 1_700_000_000_000,
    allowanceMs: 8 * 3600 * 1000,
  });

  const c1 = await repo.commit(state, null);
  assert.equal(c1.kind, 'COMMITTED');
  assert.equal(c1.revision, '1');

  state = advanceOffline(state, state.cursorMs + 60_000).state;
  fault.armNextWriteFault('PRE_WRITE_ERROR');
  assert.equal((await repo.commit(state, '1')).kind, 'FAILED');

  fault.armNextWriteFault('PARTIAL_WRITE');
  assert.equal((await repo.commit(state, '1')).kind, 'FAILED');
  const rec = await repo.load();
  assert.equal(rec.kind, 'VALID');
  if (rec.kind === 'VALID') {
    assert.equal(rec.revision, '1');
    assert.equal(rec.recovered, true);
  }

  fault.armNextWriteFault('POST_WRITE_THROW');
  const c2 = await repo.commit(state, '1');
  assert.equal(c2.kind, 'COMMITTED');
  if (c2.kind === 'COMMITTED') {
    assert.equal(c2.revision, '2');
    assert.equal(c2.recoveredFromUncertainWrite, true);
  }

  for (const p of SLOT_PATHS) {
    await mem.write(p, 'CORRUPT_DATA');
  }
  assert.equal((await repo.load()).kind, 'CORRUPT');

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

test('[MOCK-WX/I01/I05/T08] Local unsubscribe keeps siblings alive; suites dispose wx hooks on normal & fault exits', async () => {
  const mock = createMockWxEnv();
  const prevWx = (globalThis as Record<string, unknown>).wx;
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    // 1. Local unsubscribe must NOT break sibling subscriber on same Provider
    const provider = new RuntimeLifecycleProvider();
    const seenA: string[] = [];
    const seenB: string[] = [];
    const unsubFault = provider.subscribe(() => {
      throw new Error('sibling-fault');
    });
    const unsubA = provider.subscribe((ev) => seenA.push(ev));
    const unsubB = provider.subscribe((ev) => seenB.push(ev));

    assert.deepEqual([mock.showListeners.size, mock.hideListeners.size], [1, 1]);
    provider.emit('HIDE', 't1');
    provider.emit('HIDE', 't1-dup');
    provider.emit('SHOW', 't1');

    // Unsubscribe A locally -> B MUST keep receiving events and wx hooks stay attached until owner disposes
    unsubA();
    assert.deepEqual([mock.showListeners.size, mock.hideListeners.size], [1, 1]);
    provider.emit('HIDE', 't2');
    provider.emit('SHOW', 't2');
    assert.deepEqual(seenA, ['HIDE', 'SHOW']);
    assert.deepEqual(seenB, ['HIDE', 'SHOW', 'HIDE', 'SHOW']);
    assert.equal(provider.listenerErrorCount, 4);

    // Owner explicitly disposes provider -> raw wx listener counts return to 0
    unsubB();
    unsubFault();
    provider.dispose();
    assert.deepEqual([mock.showListeners.size, mock.hideListeners.size], [0, 0]);

    // 2. FileSystem suite: post-subscribe injected failure MUST release wx listeners
    const fsPort = new WeChatFilePort('idle_fishing_fault_owner');
    const fsFaultResults = await runFileSystemAndSaveSuite(fsPort, {
      afterLifecycleSubscribe: () => {
        throw new Error('injected post-subscribe fault in FS suite');
      },
    });
    const bgCase = fsFaultResults.find((r) => r.id === 'FS-BG-RECOVERY');
    assert.ok(bgCase && bgCase.status === 'FAIL', 'Injected fault should mark FS-BG-RECOVERY as FAIL');
    assert.deepEqual(
      [mock.showListeners.size, mock.hideListeners.size],
      [0, 0],
      'FS suite leaked wx listeners on post-subscribe failure'
    );

    // 3. Lifecycle suite: normal exit AND post-subscribe injected failure MUST release wx listeners
    const normalLife = await runLifecycleClockAndAdSuite();
    assert.equal(normalLife.find((r) => r.id === 'T08-LIFECYCLE-CLOCK')?.status, 'PASS');
    assert.deepEqual([mock.showListeners.size, mock.hideListeners.size], [0, 0]);

    const faultLife = await runLifecycleClockAndAdSuite({
      afterLifecycleSubscribe: () => {
        throw new Error('injected post-subscribe fault in Lifecycle suite');
      },
    });
    assert.equal(faultLife.find((r) => r.id === 'T08-LIFECYCLE-CLOCK')?.status, 'FAIL');
    assert.deepEqual(
      [mock.showListeners.size, mock.hideListeners.size],
      [0, 0],
      'Lifecycle suite leaked wx listeners on post-subscribe failure'
    );
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-DOM/I05/T08] Suites dispose DOM visibilitychange listeners on normal & post-subscribe fault exits', async () => {
  const mockDoc = createMockDocumentEnv();
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevWx = (globalThis as Record<string, unknown>).wx;
  delete (globalThis as Record<string, unknown>).wx;
  (globalThis as Record<string, unknown>).document = mockDoc.doc;
  try {
    // Real DOM visibilitychange fires through provider
    const p = new RuntimeLifecycleProvider();
    const got: string[] = [];
    const u = p.subscribe((ev) => got.push(ev));
    assert.equal(mockDoc.listeners.size, 1);
    mockDoc.doc.dispatchVisibility('hidden');
    mockDoc.doc.dispatchVisibility('visible');
    assert.deepEqual(got, ['HIDE', 'SHOW']);
    u();
    p.dispose();
    assert.equal(mockDoc.listeners.size, 0);

    // FS suite post-subscribe fault -> 0 DOM listeners leaked
    const mem = new MemoryFilePort();
    await runFileSystemAndSaveSuite(mem, {
      afterLifecycleSubscribe: () => {
        throw new Error('injected DOM FS fault');
      },
    });
    assert.equal(mockDoc.listeners.size, 0, 'FS suite leaked DOM listener on fault');

    // Lifecycle suite post-subscribe fault -> 0 DOM listeners leaked
    await runLifecycleClockAndAdSuite({
      afterLifecycleSubscribe: () => {
        throw new Error('injected DOM Lifecycle fault');
      },
    });
    assert.equal(mockDoc.listeners.size, 0, 'Lifecycle suite leaked DOM listener on fault');
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[NODE/I03/T08] Unsupported monotonic source freezes +48h jump; rollback/recovery & deadline clamp', () => {
  // I03 P1 boundary: monotonicSupported === false MUST freeze and keep cursorMs at 10000
  let wall = 10_000;
  const unsupportedClock = {
    wallNowMs: () => wall,
    monotonicNowMs: () => wall,
    monotonicSupported: false,
    monotonicSource: 'UNSUPPORTED_WALL_FALLBACK',
  };
  const g1 = new MonotonicTimelineGuard(unsupportedClock);
  wall += 48 * 3_600_000;
  const resFrozen = g1.tickForeground(unsupportedClock);
  assert.equal(resFrozen.ok, false);
  assert.equal(resFrozen.code, 'CLOCK_ERROR');
  assert.equal(resFrozen.frozen, true);
  assert.equal(resFrozen.cursorMs, 10_000);

  // Recovery once a monotonic clock is available again
  const recoveredClock = new VirtualClockProvider(wall, 50_000, true);
  const resRecover = g1.tickForeground(recoveredClock);
  assert.equal(resRecover.ok, true);
  assert.equal(resRecover.frozen, false);
  assert.equal(resRecover.cursorMs, 10_000); // Does NOT adopt fake +48h jump!
  recoveredClock.advance(3_000);
  const resAfterRecover = g1.tickForeground(recoveredClock);
  assert.equal(resAfterRecover.ok, true);
  assert.equal(resAfterRecover.cursorMs, 13_000);

  // Normal rollback freeze, recovery, and +48h offline resume deadline clamp
  const t0 = 1_700_000_000_000;
  const deadline = t0 + 8 * 3_600_000;
  const clock = new VirtualClockProvider(t0, 500, true);
  const guard = new MonotonicTimelineGuard(clock, 2000);

  clock.advance(10_000);
  assert.equal(guard.tickForeground(clock).cursorMs, t0 + 10_000);

  clock.setWallMs(t0 - 120_000);
  const rb = guard.tickForeground(clock);
  assert.equal(rb.ok, false);
  assert.equal(rb.code, 'CLOCK_ERROR');
  assert.equal(rb.cursorMs, t0 + 10_000);

  const badRes = guard.lockOfflineResumeTarget(clock, deadline);
  assert.equal(badRes.ok, false);
  assert.equal(badRes.code, 'CLOCK_ERROR');

  clock.setWallMs(t0 + 48 * 3_600_000);
  const clamped = guard.lockOfflineResumeTarget(clock, deadline);
  assert.equal(clamped.ok, true);
  assert.equal(clamped.clampedByDeadline, true);
  assert.equal(clamped.lockedTargetMs, deadline);

  // wx.getPerformance unit heuristic check
  assert.equal(detectWxPerfMicrosecondUnit(1_700_000_000_000_000), true);
  assert.equal(detectWxPerfMicrosecondUnit(12_345), false);
});

test('[MOCK-WX/I04/T09] Ad SDK single-instance guard, load/show reject cleanup, duplicate callback & 5-case stub', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  try {
    // 0. Empty adUnitId unavailable
    const emptyAdapter = new WeChatRewardedAdAdapter('');
    assert.equal(emptyAdapter.isAvailable('SPEED'), false);
    assert.equal((await emptyAdapter.show('req-empty', 'SPEED')).outcome, 'FAILED');

    // 1. I04 P3: load() rejection MUST detach both close and error handlers
    const closeHandlers = new Set<(res?: { isEnded?: boolean }) => void>();
    const errorHandlers = new Set<(err: unknown) => void>();
    (globalThis as Record<string, unknown>).wx = {
      createRewardedVideoAd: () => ({
        onClose: (cb: (res?: { isEnded?: boolean }) => void) => closeHandlers.add(cb),
        offClose: (cb: (res?: { isEnded?: boolean }) => void) => closeHandlers.delete(cb),
        onError: (cb: (err: unknown) => void) => errorHandlers.add(cb),
        offError: (cb: (err: unknown) => void) => errorHandlers.delete(cb),
        load: async () => {
          throw new Error('mock load failure');
        },
        show: async () => {},
      }),
    };
    const rLoad = await new WeChatRewardedAdAdapter('audit').show('req-load-fail', 'SPEED');
    assert.equal(rLoad.outcome, 'FAILED');
    assert.deepEqual([closeHandlers.size, errorHandlers.size], [0, 0]);

    // 2. I04: show() rejection MUST also detach both close and error handlers
    (globalThis as Record<string, unknown>).wx = {
      createRewardedVideoAd: () => ({
        onClose: (cb: (res?: { isEnded?: boolean }) => void) => closeHandlers.add(cb),
        offClose: (cb: (res?: { isEnded?: boolean }) => void) => closeHandlers.delete(cb),
        onError: (cb: (err: unknown) => void) => errorHandlers.add(cb),
        offError: (cb: (err: unknown) => void) => errorHandlers.delete(cb),
        load: async () => {},
        show: async () => {
          throw new Error('mock show failure');
        },
      }),
    };
    const rShow = await new WeChatRewardedAdAdapter('audit').show('req-show-fail', 'SPEED');
    assert.equal(rShow.outcome, 'FAILED');
    assert.deepEqual([closeHandlers.size, errorHandlers.size], [0, 0]);

    // 3. I04 P4: concurrent show for same requestId creates AT MOST 1 instance & cleans up on duplicate callbacks
    let created = 0;
    const ends: ((res?: { isEnded?: boolean }) => void)[] = [];
    (globalThis as Record<string, unknown>).wx = {
      createRewardedVideoAd: () => {
        created += 1;
        return {
          onClose: (cb: (res?: { isEnded?: boolean }) => void) => {
            closeHandlers.add(cb);
            ends.push(cb);
          },
          offClose: (cb: (res?: { isEnded?: boolean }) => void) => closeHandlers.delete(cb),
          onError: (cb: (err: unknown) => void) => errorHandlers.add(cb),
          offError: (cb: (err: unknown) => void) => errorHandlers.delete(cb),
          load: async () => {},
          show: async () => {},
        };
      },
    };
    const ad = new WeChatRewardedAdAdapter('audit');
    const pA = ad.show('same', 'SPEED');
    const pB = ad.show('same', 'SPEED');
    const resB = await pB;
    assert.equal(resB.outcome, 'FAILED');
    assert.match(resB.detail, /AD_IN_PROGRESS/);
    assert.equal(created, 1);

    // Fire duplicate onClose callbacks on the single instance
    for (const done of ends) {
      done({ isEnded: true });
      done({ isEnded: true });
    }
    const resA = await pA;
    assert.equal(resA.outcome, 'COMPLETED');
    assert.equal(created, 1);
    assert.equal(ad.getActiveRequestId(), null);
    assert.deepEqual([closeHandlers.size, errorHandlers.size], [0, 0]);

    // 4. ExperimentalAdStubCoordinator 5-case verification
    const stub = new ExperimentalAdStubCoordinator();
    const s1 = await stub.runScenario('SPEED', 'COMPLETED');
    const s2 = await stub.runScenario('SPEED', 'CANCELLED');
    const s3 = await stub.runScenario('GOLD', 'LOAD_FAILED');
    const s4 = await stub.runScenario('BAIT', 'PLAY_FAILED');
    const s5 = await stub.runScenario('RESET', 'DUPLICATE_CALLBACK');

    assert.equal(s1.record.status, 'REWARDED');
    assert.equal(s1.record.rewardDispatchCount, 1);
    assert.equal(s2.record.status, 'CANCELLED');
    assert.equal(s2.record.rewardDispatchCount, 0);
    assert.equal(s3.record.status, 'FAILED');
    assert.equal(s4.record.status, 'FAILED');
    assert.equal(s5.record.status, 'REWARDED');
    assert.equal(s5.record.rewardDispatchCount, 1);
    assert.equal(s5.ignoredDuplicates, 2);
    assert.equal(stub.getRewardAckCount(), 2);
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});
