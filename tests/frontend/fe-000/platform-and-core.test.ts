/**
 * FE-000-R1 Frontend Platform & Shared Core Automated Tests (Node.js + Mock wx / Mock DOM).
 * Explicitly labeled by host: [NODE], [MOCK-WX], [MOCK-DOM].
 * Never substitutes for real Cocos Web, WeChat DevTools, or real device verification.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  advanceOffline,
  advanceOfflineSliced,
  buildEnvelope,
  canonicalStringify,
  computeEnvelopeHash,
  createInitialState,
  migrateSpikeState,
  natFromBigInt,
  natToBigInt,
  newRngState,
  SAVE_FORMAT,
  SAVE_MAGIC,
  sha256Hex,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  validateSpikeState,
  workFromMs,
  xoshiroStep,
  type RngWords,
  type SpikeGameState,
  type SpikeGameStateV1,
} from '@idle-fishing/game-core';
import { detectRuntimeEnv, type FilePort } from '../../../apps/game-client/assets/scripts/platform/PlatformTypes';
import { WeChatFilePort, FilePortIoError } from '../../../apps/game-client/assets/scripts/platform/WeChatFilePort';
import { BrowserFilePort, MemoryFilePort } from '../../../apps/game-client/assets/scripts/platform/BrowserFilePort';
import { FaultInjectingFilePort } from '../../../apps/game-client/assets/scripts/platform/FaultInjectingFilePort';
import { SingleWriterSaveCoordinator } from '../../../apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator';
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
  createRuntimeFilePort,
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

  // Authoritative BE-000-R1-P2 golden vectors (reviewed backend commit 5bcc9ac).
  // Explicitly distinguishes:
  // (a) state canonical JSON SHA-256
  // (b) envelope inner sha256 field (computeEnvelopeHash([magic,format,rev,epoch,payload]))
  // (c) full envelope text SHA-256 (sha256Hex(built.text))
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
  assert.equal(cont1h.state.offline?.settledUntilMs, oneHourTarget);
  assert.equal(cont1h.state.gold, '3116');
  assert.equal(cont1h.state.big, '13580246791358024679135802467900');
  assert.equal(sha256Hex(canon1h), '8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63');
  const env1h = buildEnvelope(cont1h.state, '1');
  assert.equal(env1h.sha256, '183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a');
  assert.equal(sha256Hex(env1h.text), '4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6');

  const eightHour = advanceOffline(initial, initial.cursorMs + 8 * 3_600_000);
  assert.equal(eightHour.state.stage, 'FIGHTING');
  assert.equal(eightHour.state.attemptLock?.claimKey, 'fish:970');
  assert.equal(eightHour.state.gold, '27911');
  assert.equal(
    sha256Hex(canonicalStringify(eightHour.state)),
    '91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9'
  );

  const full24h = advanceOffline(initial, initial.cursorMs + 86_400_000);
  assert.equal(full24h.state.gold, '85366');
  const env24h = buildEnvelope(full24h.state, '1');
  assert.equal(env24h.sha256, '9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d');
  assert.equal(sha256Hex(env24h.text), '0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f');
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

test('[NODE/COMPAT-SAVE] 5bcc9ac save protocol: UNCERTAIN, unknown slot, post-write unreadable, conflict, mixed epoch, UNSUPPORTED & lock mismatch', async () => {
  const baseMem = new MemoryFilePort();
  const fault = new FaultInjectingFilePort(baseMem);
  const repo = new SpikeFileSaveRepository(fault);

  // 1. EMPTY -> VALID -> COMMITTED
  assert.equal((await repo.load()).kind, 'EMPTY');
  const s0 = createInitialState({ saveEpoch: 'compat.save', startMs: 1_700_000_000_000, allowanceMs: 3_600_000 });
  const c1 = await repo.commit(s0, null);
  assert.equal(c1.kind, 'COMMITTED');
  assert.equal(c1.revision, '1');

  // 2. CONFLICT on stale expectedRevision
  const s1 = advanceOffline(s0, s0.cursorMs + 30_000).state;
  const conflictRes = await repo.commit(s1, null);
  assert.equal(conflictRes.kind, 'CONFLICT');

  // 3. Unknown slot read error -> UNCERTAIN with ZERO write attempts
  const writeCountBeforeUnknown = fault.trace.filter((e) => e.startsWith('WRITE_')).length;
  fault.setReadFault(SLOT_PATHS[2], true);
  const unknownRes = await repo.commit(s1, '1');
  fault.setReadFault(SLOT_PATHS[2], false);
  const writeCountAfterUnknown = fault.trace.filter((e) => e.startsWith('WRITE_')).length;
  assert.equal(unknownRes.kind, 'UNCERTAIN');
  assert.equal(writeCountAfterUnknown, writeCountBeforeUnknown, 'Unknown slot read must execute 0 writes');

  // 4. Written-then-unreadable target slot -> UNCERTAIN; once readable again, load recovers committed rev=2 without duplicate settlement
  fault.armNextWriteFault('POST_WRITE_THROW');
  // Target for rev 2 is save_slot_1.json; make it unreadable right after write by intercepting via custom wrapper
  const postUnreadablePort = new (class extends MemoryFilePort {
    unreadableSlot1 = false;
    override async write(p: string, text: string): Promise<void> {
      await super.write(p, text);
      if (p === SLOT_PATHS[1]) {
        this.unreadableSlot1 = true;
        throw new FilePortIoError('POST_WRITE_IO', p, 'post-write io failure');
      }
    }
    override async read(p: string): Promise<string | null> {
      if (p === SLOT_PATHS[1] && this.unreadableSlot1) {
        throw new FilePortIoError('READ_AFTER_WRITE_IO', p, 'slot unreadable after write');
      }
      return super.read(p);
    }
  })();
  const postRepo = new SpikeFileSaveRepository(postUnreadablePort);
  assert.equal((await postRepo.commit(s0, null)).kind, 'COMMITTED');
  const uncertainWrite = await postRepo.commit(s1, '1');
  assert.equal(uncertainWrite.kind, 'UNCERTAIN', 'Written-but-unreadable target must stay UNCERTAIN, not FAILED');
  // Restore readability -> rev 2 is safely loaded
  postUnreadablePort.unreadableSlot1 = false;
  const recoveredPost = await postRepo.load();
  assert.equal(recoveredPost.kind, 'VALID');
  if (recoveredPost.kind === 'VALID') {
    assert.equal(recoveredPost.revision, '2');
    assert.equal((recoveredPost.raw as SpikeGameState).gold, s1.gold);
  }

  // 5. Single-slot illegal payload ("null") isolated; valid backup recovered
  const isoMem = new MemoryFilePort();
  const isoRepo = new SpikeFileSaveRepository(isoMem);
  assert.equal((await isoRepo.commit(s0, null)).kind, 'COMMITTED');
  const badNullPayload = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision: '2',
    epoch: s0.saveEpoch,
    payload: 'null',
    sha256: computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, '2', s0.saveEpoch, 'null'),
  });
  await isoMem.write(SLOT_PATHS[1], badNullPayload);
  const isoLoaded = await isoRepo.load();
  assert.equal(isoLoaded.kind, 'VALID');
  if (isoLoaded.kind === 'VALID') {
    assert.equal(isoLoaded.revision, '1');
    assert.equal(isoLoaded.recovered, true);
  }

  // 6. Same revision with different content -> load=CORRUPT, commit=FAILED with 0 writes
  const dupMem = new MemoryFilePort();
  const dupFault = new FaultInjectingFilePort(dupMem);
  const dupRepo = new SpikeFileSaveRepository(dupFault);
  await dupMem.write(SLOT_PATHS[0], buildEnvelope(s0, '1').text);
  await dupMem.write(SLOT_PATHS[1], buildEnvelope(s1, '1').text);
  assert.equal((await dupRepo.load()).kind, 'CORRUPT');
  const dupCommit = await dupRepo.commit(s1, '1');
  assert.equal(dupCommit.kind, 'FAILED');
  assert.equal(dupFault.trace.filter((e) => e.startsWith('WRITE_')).length, 0);

  // 7. Mixed epochs -> load=CORRUPT, commit=FAILED with 0 writes
  const mixMem = new MemoryFilePort();
  const mixFault = new FaultInjectingFilePort(mixMem);
  const mixRepo = new SpikeFileSaveRepository(mixFault);
  const sOtherEpoch = createInitialState({ saveEpoch: 'compat.other', startMs: 1_700_000_000_000, allowanceMs: 3_600_000 });
  await mixMem.write(SLOT_PATHS[0], buildEnvelope(s0, '1').text);
  await mixMem.write(SLOT_PATHS[1], buildEnvelope(sOtherEpoch, '2').text);
  assert.equal((await mixRepo.load()).kind, 'CORRUPT');
  const mixCommit = await mixRepo.commit(s1, '2');
  assert.equal(mixCommit.kind, 'FAILED');
  assert.equal(mixFault.trace.filter((e) => e.startsWith('WRITE_')).length, 0);

  // 8. Unsupported future schema -> load=UNSUPPORTED, commit=FAILED with 0 overwrites (never silently wiped)
  const futMem = new MemoryFilePort();
  const futFault = new FaultInjectingFilePort(futMem);
  const futRepo = new SpikeFileSaveRepository(futFault);
  const futurePayload = canonicalStringify({ schemaVersion: 99, saveEpoch: 'compat.future', futureField: true });
  const futureEnv = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision: '5',
    epoch: 'compat.future',
    payload: futurePayload,
    sha256: computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, '5', 'compat.future', futurePayload),
  });
  await futMem.write(SLOT_PATHS[0], futureEnv);
  assert.equal((await futRepo.load()).kind, 'UNSUPPORTED');
  assert.equal((await futRepo.commit(s0, '5')).kind, 'FAILED');
  assert.equal(await futMem.read(SLOT_PATHS[0]), futureEnv, 'Unsupported schema slot must remain untouched');
  assert.equal(futFault.trace.filter((e) => e.startsWith('WRITE_')).length, 0);

  // 9. P2 R1-N02: tampered attemptLock.fightMs !== stageRequired rejected by validate & commit (0 writes)
  const fighting = advanceOffline(s0, s0.cursorMs + 8 * 3_600_000).state;
  const s8h = advanceOffline(
    createInitialState({ saveEpoch: 'epoch.be000', startMs: 1_700_000_000_000, allowanceMs: 86_400_000 }),
    1_700_000_000_000 + 8 * 3_600_000
  ).state;
  assert.equal(s8h.stage, 'FIGHTING');
  assert.ok(s8h.attemptLock);
  const tampered: SpikeGameState = {
    ...s8h,
    attemptLock: { ...s8h.attemptLock, fightMs: s8h.attemptLock.fightMs + 1 },
  };
  assert.ok(validateSpikeState(tampered).some((i) => i.path === 'attemptLock.fightMs'));
  const lockMem = new MemoryFilePort();
  const lockFault = new FaultInjectingFilePort(lockMem);
  const lockRepo = new SpikeFileSaveRepository(lockFault);
  assert.equal((await lockRepo.commit(tampered, null)).kind, 'FAILED');
  assert.equal(lockFault.trace.filter((e) => e.startsWith('WRITE_')).length, 0);
  void fighting;
});

test('[NODE/COMPAT-OFFLINE-MIGRATION] 5bcc9ac offline checkpoints, overflow/allowance guards & in-progress FIGHTING/PREPARING migration', async () => {
  const START = 1_700_000_000_000;
  const ALLOW = 3_600_000;
  const DEADLINE = START + ALLOW;

  // 1. P2 R1-N03 & I08: allowanceMs <= 0 and custom fixture rejected
  assert.throws(() => createInitialState({ saveEpoch: 'inv.zero', startMs: START, allowanceMs: 0 }), /positive/i);
  assert.throws(() => createInitialState({ saveEpoch: 'inv.neg', startMs: START, allowanceMs: -1 }), /safe|positive/i);
  assert.throws(
    () =>
      createInitialState({
        saveEpoch: 'inv.fix',
        startMs: START,
        allowanceMs: ALLOW,
        fixture: { castMs: 17 },
      } as unknown as Parameters<typeof createInitialState>[0]),
    /Custom offline fixtures/i
  );

  // 2. settledUntilMs before, exactly at, and after deadline
  const s0 = createInitialState({ saveEpoch: 'compat.deadline', startMs: START, allowanceMs: ALLOW });
  const before = advanceOffline(s0, DEADLINE - 1).state;
  assert.equal(before.offline?.settledUntilMs, DEADLINE - 1);
  const atDeadline = advanceOffline(before, DEADLINE).state;
  assert.equal(atDeadline.offline?.settledUntilMs, DEADLINE);
  const after = advanceOffline(atDeadline, DEADLINE + 600_000).state;
  assert.equal(after.offline?.settledUntilMs, DEADLINE, 'settledUntilMs must freeze at deadline');
  assert.equal(after.gold, atDeadline.gold, 'No fishing rewards after deadline');
  assert.equal(after.counters.attempts, atDeadline.counters.attempts);

  // 3. Safe integer timestamp overflow guard
  assert.throws(
    () => createInitialState({ saveEpoch: 'inv.overflow', startMs: Number.MAX_SAFE_INTEGER - 100, allowanceMs: 1000 }),
    /safe/i
  );

  // 4. Experimental v1 -> v2 in-progress FIGHTING migration: preserves lock, RNG, v1 slot, settles once
  const fightMs = 9500;
  const v1Fight: SpikeGameStateV1 = {
    schemaVersion: 1,
    saveEpoch: 'compat.mig.fight',
    rootSeed: 0x1234abcd,
    cursorMs: START + 20_000,
    counter: 5,
    gold: '1000',
    rng: newRngState(),
    attempt: {
      stage: 'FIGHTING',
      stageStartMs: START + 15_000,
      stageDone: workFromMs(5_000),
      stageRequired: workFromMs(fightMs),
      lock: {
        seq: 5,
        claimKey: 'fish:5',
        speciesU: 0.25,
        captureU: 0.5,
        fightMs,
      },
    },
  };
  const v1FightPort = new MemoryFilePort();
  const v1FightRepo = new SpikeFileSaveRepository(v1FightPort);
  const rawV1FightPayload = canonicalStringify(v1Fight);
  const rawV1FightEnv = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision: '1',
    epoch: v1Fight.saveEpoch,
    payload: rawV1FightPayload,
    sha256: computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, '1', v1Fight.saveEpoch, rawV1FightPayload),
  });
  await v1FightPort.write(SLOT_PATHS[0], rawV1FightEnv);
  const loadedV1Fight = await v1FightRepo.load();
  assert.equal(loadedV1Fight.kind, 'VALID');
  const migFight = migrateSpikeState(loadedV1Fight.raw, 1, 2);
  assert.equal(migFight.stage, 'FIGHTING');
  assert.deepEqual(migFight.attemptLock, v1Fight.attempt?.lock);
  assert.equal(validateSpikeState(migFight).length, 0);
  const commitV2Fight = await v1FightRepo.commit(migFight, '1');
  assert.equal(commitV2Fight.kind, 'COMMITTED');
  assert.equal(await v1FightPort.read(SLOT_PATHS[0]), rawV1FightEnv, 'Original v1 slot must remain intact');

  // Settle migrated fight once -> fish:5 claimed once
  const settledFight = advanceOffline(migFight, migFight.cursorMs + 5_000).state;
  assert.equal(settledFight.lastTerminalAttemptSeq, '5');
  assert.equal(settledFight.claims.filter((k) => k === 'fish:5').length, 1);
  assert.ok(BigInt(settledFight.gold) > 1000n);
  // Attempting to replay a forged FIGHTING state with already-claimed fish:5 must throw
  assert.throws(() =>
    advanceOffline(
      { ...migFight, claims: ['fish:5'], lastTerminalAttemptSeq: '5' },
      migFight.cursorMs + 5_000
    )
  );

  // 5. P2 R1-N01: Experimental v1 -> v2 PREPARING migration: already settled, no duplicate reward, v1 slot preserved
  const v1Prep: SpikeGameStateV1 = {
    schemaVersion: 1,
    saveEpoch: 'compat.mig.prep',
    rootSeed: 0x1234abcd,
    cursorMs: START + 25_000,
    counter: 7,
    gold: '4200',
    rng: newRngState(),
    attempt: {
      stage: 'PREPARING',
      stageStartMs: START + 24_000,
      stageDone: workFromMs(1_000),
      stageRequired: workFromMs(2_500),
    },
  };
  const v1PrepPort = new MemoryFilePort();
  const v1PrepRepo = new SpikeFileSaveRepository(v1PrepPort);
  const rawV1PrepPayload = canonicalStringify(v1Prep);
  const rawV1PrepEnv = canonicalStringify({
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision: '1',
    epoch: v1Prep.saveEpoch,
    payload: rawV1PrepPayload,
    sha256: computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, '1', v1Prep.saveEpoch, rawV1PrepPayload),
  });
  await v1PrepPort.write(SLOT_PATHS[0], rawV1PrepEnv);
  const migPrep = migrateSpikeState(v1Prep, 1, 2);
  assert.equal(validateSpikeState(migPrep).length, 0);
  assert.deepEqual(migPrep.claims, ['fish:7']);
  assert.equal(migPrep.lastTerminalAttemptSeq, '7');
  assert.equal(migPrep.counters.events, 1);
  assert.equal((await v1PrepRepo.commit(migPrep, '1')).kind, 'COMMITTED');
  assert.equal(await v1PrepPort.read(SLOT_PATHS[0]), rawV1PrepEnv, 'Original v1 PREPARING slot must remain intact');
  const afterPrep = advanceOffline(migPrep, migPrep.cursorMs + 2_000).state;
  assert.equal(afterPrep.gold, '4200', 'Migrated PREPARING must not double-grant gold');
  assert.equal(afterPrep.claims.filter((k) => k === 'fish:7').length, 1);
});

test('[NODE/COMPAT-LEGACY-358B111] Real pre-R1 (358b111) v2 Spike saves load & advance cleanly on 5bcc9ac', async () => {
  let repoRoot = process.cwd();
  while (!fs.existsSync(path.join(repoRoot, 'packages', 'game-core'))) {
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  const fixturePath = path.resolve(
    repoRoot,
    'reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json'
  );
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Missing legacy 358b111 fixture file: ${fixturePath}`);
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    generatedByBackendCommit: string;
    cases: {
      IDLE: { envelopeText: string; state: SpikeGameState };
      FIGHTING: { envelopeText: string; state: SpikeGameState; hasAttemptLock: boolean };
      PREPARING: { envelopeText: string; state: SpikeGameState };
      POST_DEADLINE: { envelopeText: string; state: SpikeGameState; deadlineMs: number };
      CORRUPT_WITH_VALID_BACKUP: { slots: Record<string, string | null>; expectedBackupRevision: string; validBackupGold: string };
    };
  };
  assert.equal(fixture.generatedByBackendCommit, '358b11105cfdee9bd076049c86a34d8f0aaa00e7');
  assert.equal(fixture.cases.FIGHTING.hasAttemptLock, false);

  for (const key of ['IDLE', 'FIGHTING', 'PREPARING', 'POST_DEADLINE'] as const) {
    const entry = fixture.cases[key];
    const port = new MemoryFilePort();
    await port.write(SLOT_PATHS[0], entry.envelopeText);
    const repo = new SpikeFileSaveRepository(port);
    const loaded = await repo.load();
    assert.equal(loaded.kind, 'VALID', `Legacy ${key} save must load VALID on 5bcc9ac`);
    if (loaded.kind === 'VALID') {
      const st = loaded.raw as SpikeGameState;
      const adv = advanceOffline(st, st.cursorMs + 60_000);
      assert.equal(validateSpikeState(adv.state).length, 0);
      if (key === 'POST_DEADLINE') {
        assert.equal(adv.state.gold, st.gold, 'Legacy POST_DEADLINE save must not settle new rewards past deadline');
        assert.equal(adv.state.offline?.settledUntilMs, fixture.cases.POST_DEADLINE.deadlineMs);
      } else {
        assert.equal(adv.state.offline?.settledUntilMs, st.cursorMs + 60_000);
      }
      const c2 = await repo.commit(adv.state, loaded.revision);
      assert.equal(c2.kind, 'COMMITTED', `Legacy ${key} save must commit cleanly after advancing on 5bcc9ac`);
    }
  }

  // Corrupt rev 2 + valid rev 1 backup from 358b111
  const backupPort = new MemoryFilePort();
  for (const [slotPath, content] of Object.entries(fixture.cases.CORRUPT_WITH_VALID_BACKUP.slots)) {
    if (content !== null) await backupPort.write(slotPath, content);
  }
  const backupRepo = new SpikeFileSaveRepository(backupPort);
  const backupLoaded = await backupRepo.load();
  assert.equal(backupLoaded.kind, 'VALID');
  if (backupLoaded.kind === 'VALID') {
    assert.equal(backupLoaded.recovered, true);
    assert.equal(backupLoaded.revision, fixture.cases.CORRUPT_WITH_VALID_BACKUP.expectedBackupRevision);
    assert.equal((backupLoaded.raw as SpikeGameState).gold, fixture.cases.CORRUPT_WITH_VALID_BACKUP.validBackupGold);
  }
});

function createMockLocalStorage() {
  const store = new Map<string, string>();
  let failProbeWrite = false;
  const storage = {
    get length() {
      return store.size;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    setItem(k: string, v: string) {
      if (failProbeWrite && k.endsWith('__probe__')) {
        throw new Error('QuotaExceededError: simulated __probe__ write failure');
      }
      store.set(k, String(v));
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
  return {
    storage,
    store,
    setFailProbeWrite(v: boolean) {
      failProbeWrite = v;
    },
  };
}

test('[NODE/P1-01/COMPAT-SAVE-BOOT-UNAVAILABLE] Storage probe failure returns STORAGE_UNAVAILABLE (never EMPTY or false COMMITTED) and recovers original save', async () => {
  const mockLs = createMockLocalStorage();
  const prevLs = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = mockLs.storage;
  try {
    const ns = 'compat_p1_01_boot_unavailable';

    // 0. True EMPTY check: clean persistent storage still initializes normally
    const cleanPort = new BrowserFilePort(ns, undefined, { allowLocalStorageMockInNode: true });
    const cleanCoord = new SingleWriterSaveCoordinator(cleanPort);
    assert.equal(cleanPort.storageAvailable, true);
    assert.equal((await cleanCoord.loadSafe()).kind, 'EMPTY');

    // 1. Write a valid save (rev 1) and snapshot original envelope + revision + gold
    const s0 = createInitialState({ saveEpoch: 'epoch.p101', startMs: 1_700_000_000_000, allowanceMs: 3_600_000 });
    const s1 = advanceOffline(s0, s0.cursorMs + 120_000).state;
    const c1 = await cleanCoord.commit(s1, null);
    assert.equal(c1.kind, 'COMMITTED');
    assert.equal(c1.revision, '1');
    const origSlotKey = `${ns}:${SLOT_PATHS[0]}`;
    const origEnvelope = mockLs.store.get(origSlotKey);
    assert.ok(origEnvelope, 'Original rev 1 envelope must exist in localStorage');

    // 2. Fail ONLY __probe__ write (real slot remains readable in localStorage — exact Astra F1 repro)
    mockLs.setFailProbeWrite(true);
    const blockedPort = new BrowserFilePort(ns, undefined, { allowLocalStorageMockInNode: true });
    const blockedCoord = new SingleWriterSaveCoordinator(blockedPort);
    assert.equal(blockedPort.storageAvailable, false);
    assert.ok(blockedPort.unavailableReason);

    // 3. Boot load MUST return STORAGE_UNAVAILABLE (NEVER EMPTY), direct reads must throw FilePortIoError
    const blockedLoad = await blockedCoord.loadSafe();
    assert.equal(blockedLoad.kind, 'STORAGE_UNAVAILABLE', `Expected STORAGE_UNAVAILABLE, got ${JSON.stringify(blockedLoad)}`);
    await assert.rejects(() => blockedPort.read(SLOT_PATHS[0]), FilePortIoError);

    // 4. Commit attempt while unavailable MUST return STORAGE_UNAVAILABLE (never COMMITTED) and keep slot untouched
    const blockedCommit = await blockedCoord.commit(s0, null);
    assert.notEqual(blockedCommit.kind, 'COMMITTED');
    assert.equal(blockedCommit.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(mockLs.store.get(origSlotKey), origEnvelope, 'Original rev 1 envelope must remain byte-identical');

    // 5. Restore storage capability -> re-boot recovers original rev 1 save with zero data loss
    mockLs.setFailProbeWrite(false);
    const recoveredPort = new BrowserFilePort(ns, undefined, { allowLocalStorageMockInNode: true });
    const recoveredCoord = new SingleWriterSaveCoordinator(recoveredPort);
    const recoveredLoad = await recoveredCoord.loadSafe();
    assert.equal(recoveredLoad.kind, 'VALID');
    if (recoveredLoad.kind === 'VALID') {
      assert.equal(recoveredLoad.revision, '1');
      const restored = recoveredLoad.raw as SpikeGameState;
      assert.equal(restored.gold, s1.gold);
      assert.equal(restored.cursorMs, s1.cursorMs);
      assert.equal(canonicalStringify(restored), canonicalStringify(s1));
    }
  } finally {
    (globalThis as Record<string, unknown>).localStorage = prevLs;
  }
});

test('[NODE/P2-04/COMPAT-SAVE-CONCURRENT-COMMIT] SingleWriterSaveCoordinator prevents double COMMITTED across same & shared-namespace callers', async () => {
  const START = 1_700_000_000_000;
  const base = createInitialState({ saveEpoch: 'epoch.p204', startMs: START, allowanceMs: 3_600_000 });
  const candA = advanceOffline(base, START + 60_000).state;
  const candB = advanceOffline(base, START + 180_000).state;
  assert.notEqual(canonicalStringify(candA), canonicalStringify(candB));

  // 1. Same coordinator instance with controlled mid-write async barrier (second commit arrives while first is in write())
  const mem1 = new MemoryFilePort(10 * 1024 * 1024, 'p204_same_instance');
  const fault1 = new FaultInjectingFilePort(mem1);
  const coord1 = new SingleWriterSaveCoordinator(fault1);
  let releaseFirstWrite!: () => void;
  let firstWriteEntered!: () => void;
  const firstEnteredPromise = new Promise<void>((r) => {
    firstWriteEntered = r;
  });
  let writeCalls = 0;
  fault1.setWriteInterceptor(async () => {
    writeCalls += 1;
    if (writeCalls === 1) {
      firstWriteEntered();
      await new Promise<void>((r) => {
        releaseFirstWrite = r;
      });
    }
  });

  const pA = coord1.commit(candA, null);
  await firstEnteredPromise;
  // Launch Candidate B while Candidate A is actively paused inside physical write()
  const pB = coord1.commit(candB, null);
  releaseFirstWrite();
  const [resA, resB] = await Promise.all([pA, pB]);

  assert.equal(resA.kind, 'COMMITTED');
  assert.equal(resB.kind, 'CONFLICT', `Second concurrent candidate must receive CONFLICT, got ${JSON.stringify(resB)}`);
  assert.equal(writeCalls, 1, 'Conflicting candidate must perform 0 physical writes');

  const final1 = await coord1.loadSafe();
  assert.equal(final1.kind, 'VALID');
  if (final1.kind === 'VALID') {
    assert.equal(final1.revision, '1');
    assert.equal(canonicalStringify(final1.raw), canonicalStringify(candA));
  }

  // 2. Two SEPARATE coordinator instances sharing the same persistent BrowserFilePort namespace
  const mockLs = createMockLocalStorage();
  const prevLs = (globalThis as Record<string, unknown>).localStorage;
  (globalThis as Record<string, unknown>).localStorage = mockLs.storage;
  try {
    const sharedNs = 'p204_shared_browser_ns';
    const portX = new FaultInjectingFilePort(new BrowserFilePort(sharedNs, undefined, { allowLocalStorageMockInNode: true }));
    const portY = new FaultInjectingFilePort(new BrowserFilePort(sharedNs, undefined, { allowLocalStorageMockInNode: true }));
    const coordX = new SingleWriterSaveCoordinator(portX);
    const coordY = new SingleWriterSaveCoordinator(portY);
    assert.equal(coordX.storageKey, coordY.storageKey);

    // Seed rev 1 first, then race two different rev 2 candidates via separate coordinator instances
    const seed = await coordX.commit(base, null);
    assert.equal(seed.kind, 'COMMITTED');

    portX.setWriteInterceptor(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
    const [rx, ry] = await Promise.all([coordX.commit(candA, '1'), coordY.commit(candB, '1')]);
    const kinds = [rx.kind, ry.kind].sort();
    assert.deepEqual(kinds, ['COMMITTED', 'CONFLICT'], `Expected exactly 1 COMMITTED + 1 CONFLICT, got ${JSON.stringify([rx, ry])}`);
    const winner = rx.kind === 'COMMITTED' ? candA : candB;
    const verified = await coordY.loadSafe();
    assert.equal(verified.kind, 'VALID');
    if (verified.kind === 'VALID') {
      assert.equal(verified.revision, '2');
      assert.equal(canonicalStringify(verified.raw), canonicalStringify(winner));
    }
  } finally {
    (globalThis as Record<string, unknown>).localStorage = prevLs;
  }

  // 3. First commit fails (PRE_WRITE_ERROR) -> queued second commit acquires lock cleanly and succeeds
  const mem3 = new MemoryFilePort(10 * 1024 * 1024, 'p204_fail_then_succeed');
  const fault3 = new FaultInjectingFilePort(mem3);
  const coord3 = new SingleWriterSaveCoordinator(fault3);
  fault3.armNextWriteFault('PRE_WRITE_ERROR');
  const [failFirst, okSecond] = await Promise.all([coord3.commit(candA, null), coord3.commit(candB, null)]);
  assert.equal(failFirst.kind, 'FAILED');
  assert.equal(okSecond.kind, 'COMMITTED');
  const afterFail = await coord3.loadSafe();
  assert.equal(afterFail.kind, 'VALID');
  if (afterFail.kind === 'VALID') {
    assert.equal(afterFail.revision, '1');
    assert.equal(canonicalStringify(afterFail.raw), canonicalStringify(candB));
  }
});

test('[NODE/P1-03/COMPAT-RUNNER-ZERO-AND-SKIP-GUARD] Supervised Node 24 runner accurately counts nested leaves and blocks early exit / unsafe out-dir', () => {
  let repoRoot = process.cwd();
  while (!fs.existsSync(path.join(repoRoot, 'packages', 'game-core'))) {
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  const runner = path.join(repoRoot, 'tests/frontend/fe-000/run-node-tests.mjs');
  const runFixture = (filesFlag: string, outDir = '.compiled-p103-selfcheck') =>
    spawnSync(process.execPath, [runner, `--files=${filesFlag}`, `--out-dir=${outDir}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

  try {
    // 1. Empty file -> EXIT non-zero, total=0 pass=0
    const rEmpty = runFixture('fixtures/fixture-empty.test.ts');
    assert.notEqual(rEmpty.status, 0);
    assert.match(rEmpty.stdout, /total=0 pass=0 fail=0 skip=0 todo=0/);

    // 2. Single skip -> EXIT non-zero, total=1 pass=0 skip=1
    const rSkip = runFixture('fixtures/fixture-skipped.test.ts');
    assert.notEqual(rSkip.status, 0);
    assert.match(rSkip.stdout, /total=1 pass=0 fail=0 skip=1 todo=0/);

    // 3. Single todo -> EXIT non-zero, total=1 pass=0 todo=1
    const rTodo = runFixture('fixtures/fixture-todo.test.ts');
    assert.notEqual(rTodo.status, 0);
    assert.match(rTodo.stdout, /total=1 pass=0 fail=0 skip=0 todo=1/);

    // 4. Parent with ONLY skipped child -> EXIT non-zero, total=1 pass=0 skip=1 (N4 fix!)
    const rParentSkip = runFixture('fixtures/fixture-parent-only-skip.test.ts');
    assert.notEqual(rParentSkip.status, 0);
    assert.match(rParentSkip.stdout, /total=1 pass=0 fail=0 skip=1 todo=0/);

    // 5. Parent with ONLY todo child -> EXIT non-zero, total=1 pass=0 todo=1 (N4 fix!)
    const rParentTodo = runFixture('fixtures/fixture-parent-only-todo.test.ts');
    assert.notEqual(rParentTodo.status, 0);
    assert.match(rParentTodo.stdout, /total=1 pass=0 fail=0 skip=0 todo=1/);

    // 6. Parent with 1 passing leaf -> EXIT 0, total=1 pass=1
    const rParentPass = runFixture('fixtures/fixture-parent-one-pass.test.ts');
    assert.equal(rParentPass.status, 0);
    assert.match(rParentPass.stdout, /total=1 pass=1 fail=0 skip=0 todo=0/);

    // 7. Deeply nested describe + test + subtest -> EXIT 0, total=2 pass=2 (N4 fix!)
    const rDeep = runFixture('fixtures/fixture-deep-nested.test.ts');
    assert.equal(rDeep.status, 0);
    assert.match(rDeep.stdout, /total=2 pass=2 fail=0 skip=0 todo=0/);

    // 8. Multi-file nested (fixture-passed [1 pass] + fixture-multi-nested [2 pass, 2 fail, 1 skip, 1 todo]) -> EXIT 1, exact 3/2/1/1!
    const rMulti = runFixture('fixtures/fixture-passed.test.ts,fixtures/fixture-multi-nested.test.ts');
    assert.notEqual(rMulti.status, 0);
    assert.match(rMulti.stdout, /total=7 pass=3 fail=2 skip=1 todo=1/);

    // 9. Multiple failing leaves -> EXIT 1, total=2 fail=2
    const rMultiFail = runFixture('fixtures/fixture-multi-fail.test.ts');
    assert.notEqual(rMultiFail.status, 0);
    assert.match(rMultiFail.stdout, /total=2 pass=0 fail=2 skip=0 todo=0/);

    // 10. Mixed pass/skip/todo/fail -> EXIT 1, total=4 pass=1 fail=1 skip=1 todo=1
    const rMixedFail = runFixture('fixtures/fixture-mixed-fail.test.ts');
    assert.notEqual(rMixedFail.status, 0);
    assert.match(rMixedFail.stdout, /total=4 pass=1 fail=1 skip=1 todo=1/);

    // 11. Module load crash -> EXIT 1
    const rCrash = runFixture('fixtures/fixture-load-crash.test.ts');
    assert.notEqual(rCrash.status, 0);

    // 12. Premature process.exit(0) -> EXIT 1 (N5 fix!)
    const rEarlyExit = runFixture('fixtures/fixture-early-exit.test.ts');
    assert.notEqual(rEarlyExit.status, 0);
    assert.match(rEarlyExit.stderr, /WITHOUT completing test runner|procErr|process\/runtime error/i);

    // 13. Uncaught async exception -> EXIT 1
    const rUncaught = runFixture('fixtures/fixture-uncaught.test.ts');
    assert.notEqual(rUncaught.status, 0);

    // 14. Abnormal termination (SIGTERM) -> EXIT 1
    const rTerm = runFixture('fixtures/fixture-terminated.test.ts');
    assert.notEqual(rTerm.status, 0);

    // 15. Single passing & mixed pass+skip -> EXIT 0
    const rPass = runFixture('fixtures/fixture-passed.test.ts');
    assert.equal(rPass.status, 0);
    assert.match(rPass.stdout, /total=1 pass=1 fail=0 skip=0 todo=0/);
    const rMixed = runFixture('fixtures/fixture-mixed.test.ts');
    assert.equal(rMixed.status, 0);
    assert.match(rMixed.stdout, /total=2 pass=1 fail=0 skip=1 todo=0/);

    // 15b. A07: Throwing TODO alongside passing leaf matches Node 24 (pass=1, todo=1, fail=0, EXIT 0)
    const rTodoThrows = runFixture('fixtures/fixture-todo-throws.test.ts');
    assert.equal(rTodoThrows.status, 0, `Throwing TODO alongside pass must exit 0: ${rTodoThrows.stdout}\n${rTodoThrows.stderr}`);
    assert.match(rTodoThrows.stdout, /total=2 pass=1 fail=0 skip=0 todo=1/);

    // 15c. A07: Only throwing TODO (0 passing) STILL fails zero-pass guard (pass=0, todo=1, fail=0, EXIT 1)
    const rOnlyTodoThrows = runFixture('fixtures/fixture-only-todo-throws.test.ts');
    assert.notEqual(rOnlyTodoThrows.status, 0);
    assert.match(rOnlyTodoThrows.stdout, /total=1 pass=0 fail=0 skip=0 todo=1/);

    // 15d. A07: Hanging worker with active timer is deterministically killed by --worker-timeout-ms -> EXIT 1, procErr=1
    const tHang0 = Date.now();
    const rHang = spawnSync(
      process.execPath,
      [runner, '--files=fixtures/fixture-hanging.test.ts', '--out-dir=.compiled-p103-selfcheck', '--worker-timeout-ms=1200'],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    const hangElapsed = Date.now() - tHang0;
    assert.notEqual(rHang.status, 0, 'Hanging worker must exit non-zero');
    assert.match(rHang.stdout, /procErr=1/);
    assert.match(rHang.stderr, /timed out after 1200ms/i);
    assert.ok(hangElapsed < 15_000, `Worker timeout took too long: ${hangElapsed}ms`);

    // 16. Empty --files=, missing file, and unsafe --out-dir -> all EXIT 1
    assert.notEqual(runFixture('').status, 0);
    assert.notEqual(runFixture('fixtures/does-not-exist.test.ts').status, 0);
    const rBadOut = runFixture('fixtures/fixture-passed.test.ts', '../../reports');
    assert.notEqual(rBadOut.status, 0);
    assert.match(rBadOut.stderr, /Unsafe --out-dir rejected/);
  } finally {
    fs.rmSync(path.join(repoRoot, 'tests/frontend/fe-000/.compiled-p103-selfcheck'), {
      recursive: true,
      force: true,
    });
  }
});

test('[NODE/P1-01/TEST-01-A-B-C-D-E] Runtime storage freeze/recovery & WeChat missing-FS fail-closed (N1+N2)', async () => {
  const prevLs = (globalThis as Record<string, unknown>).localStorage;
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const START = 1_700_000_000_000;

  try {
    // --- TEST-01-A & TEST-01-C: Runtime probe failure persistently freezes until explicit loadSafe() recovery ---
    const mockLs = createMockLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = mockLs.storage;
    delete (globalThis as Record<string, unknown>).wx;

    const nsA = 'p101_runtime_probe_freeze';
    const portA = new BrowserFilePort(nsA, undefined, { allowLocalStorageMockInNode: true });
    const coordA = new SingleWriterSaveCoordinator(portA);
    assert.equal((await coordA.loadSafe()).kind, 'EMPTY');
    const s0 = createInitialState({ saveEpoch: 'epoch.n1a', startMs: START, allowanceMs: 3_600_000 });
    const s1 = advanceOffline(s0, START + 60_000).state;
    const c1 = await coordA.commit(s1, null);
    assert.equal(c1.kind, 'COMMITTED');
    const snapshotSlotsA = SLOT_PATHS.map((p) => mockLs.store.get(`${nsA}:${p}`) ?? null);

    // Inject runtime probe failure -> commit returns STORAGE_UNAVAILABLE & persistently freezes namespace
    mockLs.setFailProbeWrite(true);
    const s2 = advanceOffline(s1, START + 120_000).state;
    const fail1 = await coordA.commit(s2, '1');
    const fail2 = await coordA.commit(s2, '1');
    assert.equal(fail1.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(fail2.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(coordA.storageHealth, 'STORAGE_UNAVAILABLE');

    // Even AFTER storage capability returns, commit MUST stay frozen until explicit loadSafe() recovery!
    mockLs.setFailProbeWrite(false);
    const stillFrozen = await coordA.commit(s2, '1');
    assert.equal(stillFrozen.kind, 'STORAGE_UNAVAILABLE', 'Must remain frozen until explicit loadSafe() recovery');
    assert.deepEqual(
      SLOT_PATHS.map((p) => mockLs.store.get(`${nsA}:${p}`) ?? null),
      snapshotSlotsA,
      'Original slots must remain byte-identical during freeze'
    );

    // Explicit recovery via loadSafe() re-probes, reloads real rev 1, and unfreezes
    const recoveredA = await coordA.loadSafe();
    assert.equal(recoveredA.kind, 'VALID');
    assert.equal(coordA.storageHealth, 'AVAILABLE');
    if (recoveredA.kind === 'VALID') {
      assert.equal(recoveredA.revision, '1');
      assert.equal((recoveredA.raw as SpikeGameState).gold, s1.gold);
    }
    const c2AfterRecover = await coordA.commit(s2, '1');
    assert.equal(c2AfterRecover.kind, 'COMMITTED');

    // --- TEST-01-B: Runtime physical write IO failure (WRITE_IO_ERROR) enters STORAGE_UNAVAILABLE freeze ---
    const nsB = 'p101_runtime_write_fail';
    let failSlotWrite = false;
    const origSet = mockLs.storage.setItem.bind(mockLs.storage);
    mockLs.storage.setItem = (k: string, v: string) => {
      if (failSlotWrite && k.startsWith(`${nsB}:save_slot_`)) {
        throw new Error('QuotaExceededError: disk full');
      }
      origSet(k, v);
    };
    const portB = new BrowserFilePort(nsB, undefined, { allowLocalStorageMockInNode: true });
    const coordB = new SingleWriterSaveCoordinator(portB);
    assert.equal((await coordB.loadSafe()).kind, 'EMPTY');
    assert.equal((await coordB.commit(s1, null)).kind, 'COMMITTED');
    failSlotWrite = true;
    const writeFailRes = await coordB.commit(s2, '1');
    assert.equal(writeFailRes.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(coordB.storageHealth, 'STORAGE_UNAVAILABLE');
    failSlotWrite = false;
    // Still frozen until explicit loadSafe()
    assert.equal((await coordB.commit(s2, '1')).kind, 'STORAGE_UNAVAILABLE');
    assert.equal((await coordB.loadSafe()).kind, 'VALID');
    assert.equal(coordB.storageHealth, 'AVAILABLE');

    // --- TEST-01-D: WeChat missing FS capabilities MUST fail-closed (never degrade to MEMORY / EMPTY / COMMITTED) ---
    // D1: wx missing completely
    delete (globalThis as Record<string, unknown>).wx;
    const wxNoGlobal = new WeChatFilePort('wx_missing_global');
    const cWx1 = new SingleWriterSaveCoordinator(wxNoGlobal);
    assert.equal((await cWx1.loadSafe()).kind, 'STORAGE_UNAVAILABLE');
    assert.equal((await cWx1.commit(s1, null)).kind, 'STORAGE_UNAVAILABLE');

    // D2: wx exists (with getSystemInfoSync) WITHOUT getFileSystemManager -> detectRuntimeEnv is WECHAT_MOCK, NOT NODE!
    (globalThis as Record<string, unknown>).wx = {
      __FE000_MOCK__: true,
      getSystemInfoSync: () => ({ platform: 'ios' }),
    };
    assert.equal(detectRuntimeEnv(), 'WECHAT_MOCK');
    const rtPortD2 = createRuntimeFilePort('wx_missing_fsm');
    assert.equal(rtPortD2.kind, 'WECHAT_FS');
    const cWx2 = new SingleWriterSaveCoordinator(rtPortD2);
    assert.equal((await cWx2.loadSafe()).kind, 'STORAGE_UNAVAILABLE');
    assert.equal((await cWx2.commit(s1, null)).kind, 'STORAGE_UNAVAILABLE');

    // D3: wx.getFileSystemManager() throws -> does not crash constructor, loadSafe() returns STORAGE_UNAVAILABLE
    (globalThis as Record<string, unknown>).wx = {
      __FE000_MOCK__: true,
      env: { USER_DATA_PATH: 'wxfile://usr' },
      getFileSystemManager: () => {
        throw new Error('getFileSystemManager:fail internal error');
      },
    };
    const rtPortD3 = createRuntimeFilePort('wx_fsm_throws');
    const cWx3 = new SingleWriterSaveCoordinator(rtPortD3);
    assert.equal((await cWx3.loadSafe()).kind, 'STORAGE_UNAVAILABLE');

    // D4: FileSystemManager missing readFileSync
    const mockBase = createMockWxEnv();
    const fsmNoRead = { ...mockBase.wx.getFileSystemManager(), readFileSync: undefined };
    (globalThis as Record<string, unknown>).wx = {
      ...mockBase.wx,
      getFileSystemManager: () => fsmNoRead,
    };
    const cWx4 = new SingleWriterSaveCoordinator(createRuntimeFilePort('wx_no_read'));
    assert.equal((await cWx4.loadSafe()).kind, 'STORAGE_UNAVAILABLE');

    // D5: FileSystemManager missing writeFileSync
    const fsmNoWrite = { ...mockBase.wx.getFileSystemManager(), writeFileSync: undefined };
    (globalThis as Record<string, unknown>).wx = {
      ...mockBase.wx,
      getFileSystemManager: () => fsmNoWrite,
    };
    const cWx5 = new SingleWriterSaveCoordinator(createRuntimeFilePort('wx_no_write'));
    assert.equal((await cWx5.loadSafe()).kind, 'STORAGE_UNAVAILABLE');

    // D6: Bare Node runtime createRuntimeFilePort() fails closed instead of silently returning MemoryFilePort
    delete (globalThis as Record<string, unknown>).wx;
    const nodePort = createRuntimeFilePort('node_no_silent_mem');
    assert.notEqual(nodePort.kind, 'MEMORY');
    assert.equal((await new SingleWriterSaveCoordinator(nodePort).loadSafe()).kind, 'STORAGE_UNAVAILABLE');

    // --- TEST-01-E: Normal healthy WeChat FS still returns true EMPTY and commits cleanly ---
    (globalThis as Record<string, unknown>).wx = mockBase.wx;
    const healthyWxCoord = new SingleWriterSaveCoordinator(createRuntimeFilePort('wx_healthy_empty'));
    assert.equal((await healthyWxCoord.loadSafe()).kind, 'EMPTY');
    assert.equal((await healthyWxCoord.commit(s1, null)).kind, 'COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).localStorage = prevLs;
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[NODE/P2-05/COMPAT-SAFE-PATH-GUARD] Output dir deletion guard enforces exact allowlist and blocks traversal, roots, UNC & Windows junctions', async () => {
  let repoRoot = process.cwd();
  while (!fs.existsSync(path.join(repoRoot, 'packages', 'game-core'))) {
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }
  const guardMod = (await import(
    pathToFileURL(path.join(repoRoot, 'tests/frontend/fe-000/safe-path-guard.mjs')).href
  )) as {
    validateDeletableOutputDir: (
      candidate: string,
      opts: { mode: string; repoRoot: string; baseDir?: string; fsImpl?: unknown }
    ) => { ok: boolean; code?: string; reason?: string; canonicalPath?: string };
    safeRemoveOutputDir: (
      candidate: string,
      opts: { mode: string; repoRoot: string; baseDir?: string; fsImpl?: unknown }
    ) => string;
  };
  const feTestDir = path.join(repoRoot, 'tests/frontend/fe-000');

  // 1. Authorized paths accepted (including uncreated allowlisted compiled dir)
  assert.equal(
    guardMod.validateDeletableOutputDir(path.join(repoRoot, 'apps/game-client/build/web-mobile'), {
      mode: 'cocos-build',
      repoRoot,
    }).ok,
    true
  );
  assert.equal(
    guardMod.validateDeletableOutputDir(path.join(repoRoot, 'apps/game-client/build/wechatgame'), {
      mode: 'cocos-build',
      repoRoot,
    }).ok,
    true
  );
  assert.equal(
    guardMod.validateDeletableOutputDir('.compiled-safe-sandbox', {
      mode: 'compiled-tests',
      repoRoot,
      baseDir: feTestDir,
    }).ok,
    true
  );

  // 1b. A08: Fail-closed metadata verification — realpathSync / lstatSync EACCES on an otherwise valid dir MUST be rejected!
  const fakeEacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const existingAllowDir = path.join(feTestDir, '.compiled-metadata-probe');
  fs.mkdirSync(existingAllowDir, { recursive: true });
  try {
    const vRealpathFail = guardMod.validateDeletableOutputDir(existingAllowDir, {
      mode: 'compiled-tests',
      repoRoot,
      baseDir: feTestDir,
      fsImpl: {
        lstatSync: fs.lstatSync,
        realpathSync: (p: string) => {
          if (path.resolve(p).toLowerCase() === path.resolve(existingAllowDir).toLowerCase()) {
            throw fakeEacces;
          }
          return fs.realpathSync(p);
        },
        rmSync: fs.rmSync,
      },
    });
    assert.equal(vRealpathFail.ok, false, 'realpathSync EACCES must fail closed (A08)');
    assert.equal(vRealpathFail.code, 'REALPATH_UNVERIFIABLE');

    const vLstatFail = guardMod.validateDeletableOutputDir(existingAllowDir, {
      mode: 'compiled-tests',
      repoRoot,
      baseDir: feTestDir,
      fsImpl: {
        lstatSync: (p: string) => {
          if (path.resolve(p).toLowerCase() === path.resolve(existingAllowDir).toLowerCase()) {
            throw fakeEacces;
          }
          return fs.lstatSync(p);
        },
        realpathSync: fs.realpathSync,
        rmSync: fs.rmSync,
      },
    });
    assert.equal(vLstatFail.ok, false, 'lstatSync EACCES must fail closed (A08)');
    assert.equal(vLstatFail.code, 'METADATA_UNVERIFIABLE');

    const vRepoFail = guardMod.validateDeletableOutputDir(existingAllowDir, {
      mode: 'compiled-tests',
      repoRoot,
      baseDir: feTestDir,
      fsImpl: {
        lstatSync: fs.lstatSync,
        realpathSync: () => {
          throw fakeEacces;
        },
        rmSync: fs.rmSync,
      },
    });
    assert.equal(vRepoFail.ok, false, 'repoRoot realpathSync EACCES must fail closed');
    assert.equal(vRepoFail.code, 'REPO_ROOT_UNVERIFIABLE');
  } finally {
    fs.rmSync(existingAllowDir, { recursive: true, force: true });
  }

  // 2. Dangerous / unauthorized paths MUST all be rejected
  const rejectedCases = [
    repoRoot,
    path.dirname(repoRoot),
    path.join(repoRoot, 'apps/game-client/assets'),
    path.join(repoRoot, 'apps/game-client/build'),
    path.join(repoRoot, 'reports'),
    path.join(repoRoot, 'tests'),
    feTestDir,
    '../../reports',
    '../../../',
    'C:\\',
    'E:\\',
    '\\\\fileserver\\share\\dangerous',
    '\\\\?\\E:\\idle-fishing-integration\\tests\\frontend\\fe-000\\.compiled',
    'E:.compiled',
    '.compiled:stream',
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Documents'),
    os.tmpdir(),
  ];
  for (const bad of rejectedCases) {
    const vComp = guardMod.validateDeletableOutputDir(bad, { mode: 'compiled-tests', repoRoot, baseDir: feTestDir });
    assert.equal(vComp.ok, false, `compiled-tests must reject: ${bad}`);
    const vBuild = guardMod.validateDeletableOutputDir(bad, { mode: 'cocos-build', repoRoot });
    assert.equal(vBuild.ok, false, `cocos-build must reject: ${bad}`);
  }

  // 3. Real sandbox test with canary file + Windows directory junction escape -> ZERO deletion!
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'fe000-p205-canary-'));
  const canaryFile = path.join(sandbox, 'canary-must-survive.txt');
  fs.writeFileSync(canaryFile, 'DO_NOT_DELETE', 'utf8');
  const junctionLink = path.join(feTestDir, '.compiled-junction-probe');
  try {
    // Reject arbitrary temp sandbox directly without deleting canary
    assert.throws(() => guardMod.safeRemoveOutputDir(sandbox, { mode: 'compiled-tests', repoRoot, baseDir: feTestDir }));
    assert.equal(fs.readFileSync(canaryFile, 'utf8'), 'DO_NOT_DELETE');

    // Create a real Windows junction inside feTestDir pointing to sandbox outside allowlist
    if (fs.existsSync(junctionLink)) fs.unlinkSync(junctionLink);
    fs.symlinkSync(sandbox, junctionLink, 'junction');
    const vJunc = guardMod.validateDeletableOutputDir(junctionLink, {
      mode: 'compiled-tests',
      repoRoot,
      baseDir: feTestDir,
    });
    assert.equal(vJunc.ok, false, 'Junction escape must be rejected');
    assert.equal(vJunc.code, 'SYMLINK_OR_JUNCTION_REJECTED');
    assert.throws(() =>
      guardMod.safeRemoveOutputDir(junctionLink, { mode: 'compiled-tests', repoRoot, baseDir: feTestDir })
    );
    assert.equal(fs.readFileSync(canaryFile, 'utf8'), 'DO_NOT_DELETE', 'Canary behind junction must survive');
  } finally {
    try {
      if (fs.existsSync(junctionLink)) fs.unlinkSync(junctionLink);
    } catch {}
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});


test('[NODE/P1-01/A02-UNCERTAIN-CROSS-COORDINATOR-FREEZE] UNCERTAIN freezes the entire shared namespace across ALL coordinator instances until explicit verified loadSafe()', async () => {
  const START = 1_700_000_000_000;
  const baseMem = new MemoryFilePort(10 * 1024 * 1024, 'a02_uncertain_shared_domain');
  const fault1 = new FaultInjectingFilePort(baseMem);
  let writeCount = 0;
  const countingPort2: FilePort = {
    kind: 'MEMORY',
    storageKey: baseMem.storageKey,
    probeStorage: () => baseMem.probeStorage(),
    readTxState: () => baseMem.readTxState(),
    writeTxState: (t) => baseMem.writeTxState(t),
    clearTxState: () => baseMem.clearTxState(),
    read: (p) => baseMem.read(p),
    write: async (p, text) => {
      writeCount += 1;
      return baseMem.write(p, text);
    },
    remove: (p) => baseMem.remove(p),
    list: (dir) => baseMem.list(dir),
  };

  const coord1 = new SingleWriterSaveCoordinator(fault1);
  const coord2 = new SingleWriterSaveCoordinator(countingPort2);
  assert.equal(coord1.storageKey, coord2.storageKey);

  const s0 = createInitialState({ saveEpoch: 'epoch.a02', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;
  const s4 = advanceOffline(s3, START + 240_000).state;

  assert.equal((await coord1.loadSafe()).kind, 'EMPTY');
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  assert.equal((await coord1.commit(s2, '1')).kind, 'COMMITTED');

  // Inject readback IO failure on slot 2 (rev 3 writes physically, then readback fails -> UNCERTAIN!)
  fault1.setWriteInterceptor(async (p) => {
    if (p === SLOT_PATHS[2]) {
      fault1.setReadFault(SLOT_PATHS[2], true);
    }
  });
  const uncertainRes = await coord1.commit(s3, '2');
  assert.equal(uncertainRes.kind, 'UNCERTAIN', `Expected UNCERTAIN, got ${JSON.stringify(uncertainRes)}`);

  // BOTH coordinators sharing the same storageKey MUST be frozen immediately!
  assert.equal(coord1.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal(coord2.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal(coord1.freezeCode, 'UNCERTAIN_WRITE_PENDING_RECOVERY');
  assert.equal(coord2.freezeCode, 'UNCERTAIN_WRITE_PENDING_RECOVERY');

  // Even after clearing read fault, WITHOUT explicit loadSafe(), coord2 & coord1 MUST refuse writes with 0 writes!
  fault1.setWriteInterceptor(null);
  fault1.setReadFault(SLOT_PATHS[2], false);
  const writesBefore = writeCount;
  const blockedCoord2 = await coord2.commit(s3, '2');
  const blockedCoord1 = await coord1.commit(s3, '2');
  assert.equal(blockedCoord2.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(blockedCoord1.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(writeCount, writesBefore, 'Frozen cross-coordinator commit must perform 0 physical writes');

  // Explicit complete loadSafe() scans all 3 slots, finds committed rev 3, and unfreezes BOTH coordinators
  const recovered = await coord2.loadSafe();
  assert.equal(recovered.kind, 'VALID');
  if (recovered.kind === 'VALID') {
    assert.equal(recovered.revision, '3');
    assert.equal((recovered.raw as SpikeGameState).gold, s3.gold);
  }
  assert.equal(coord1.storageHealth, 'AVAILABLE');
  assert.equal(coord2.storageHealth, 'AVAILABLE');

  // Commit rev 4 now succeeds cleanly
  const c4 = await coord2.commit(s4, '3');
  assert.equal(c4.kind, 'COMMITTED');
  if (c4.kind === 'COMMITTED') {
    assert.equal(c4.revision, '4');
  }

  // Deterministic single-attempt PRE_WRITE_ERROR still returns FAILED without permanently freezing coord2
  fault1.armNextWriteFault('PRE_WRITE_ERROR');
  const s5 = advanceOffline(s4, START + 300_000).state;
  const detFail = await coord1.commit(s5, '4');
  assert.equal(detFail.kind, 'FAILED');
  assert.equal(coord1.storageHealth, 'AVAILABLE');
  assert.equal(coord2.storageHealth, 'AVAILABLE');
  assert.equal((await coord2.commit(s5, '4')).kind, 'COMMITTED');
});

test('[NODE/P1-02/A03-PARTIAL-IO-NO-PREMATURE-UNFREEZE] Partial slot IO unavailability stays frozen and distinguishes missing vs corrupt vs IO error', async () => {
  const START = 1_700_000_000_000;
  const baseMem = new MemoryFilePort(10 * 1024 * 1024, 'a03_partial_io_domain');
  const fault = new FaultInjectingFilePort(baseMem);
  let writeCount = 0;
  const monitoredPort: FilePort = {
    kind: 'FAULT_WRAPPER',
    storageKey: baseMem.storageKey,
    probeStorage: () => fault.probeStorage(),
    readTxState: () => fault.readTxState(),
    writeTxState: (t) => fault.writeTxState(t),
    clearTxState: () => fault.clearTxState(),
    read: (p) => fault.read(p),
    write: async (p, text) => {
      writeCount += 1;
      return fault.write(p, text);
    },
    remove: (p) => fault.remove(p),
    list: (dir) => fault.list(dir),
  };

  const coord1 = new SingleWriterSaveCoordinator(monitoredPort);
  const coord2 = new SingleWriterSaveCoordinator(monitoredPort);
  const s0 = createInitialState({ saveEpoch: 'epoch.a03', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;
  const s4 = advanceOffline(s3, START + 240_000).state;

  // 1. Missing slots (FILE_NOT_FOUND) -> clean EMPTY & AVAILABLE
  assert.equal((await coord1.loadSafe()).kind, 'EMPTY');
  assert.equal(coord1.storageHealth, 'AVAILABLE');

  // Seed rev 1 (slot 0), rev 2 (slot 1), rev 3 (slot 2)
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  assert.equal((await coord1.commit(s2, '1')).kind, 'COMMITTED');
  assert.equal((await coord1.commit(s3, '2')).kind, 'COMMITTED');

  // 2. Partial IO error on newest slot 2 (rev 3) while slot 0 & slot 1 are readable:
  //    MUST stay STORAGE_UNAVAILABLE (NEVER unfreeze to AVAILABLE on backup rev 2!)
  fault.setReadFault(SLOT_PATHS[2], true);
  const partialLoad = await coord1.loadSafe();
  assert.equal(partialLoad.kind, 'STORAGE_UNAVAILABLE', `Partial slot IO error must return STORAGE_UNAVAILABLE, got ${JSON.stringify(partialLoad)}`);
  if (partialLoad.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(partialLoad.recoveryClassification, 'PARTIAL_IO_UNAVAILABLE');
    assert.deepEqual(partialLoad.unreadableSlots, [SLOT_PATHS[2]]);
    assert.equal(partialLoad.readOnlyBackup?.revision, '2');
  }
  assert.equal(coord1.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal(coord2.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal(coord2.freezeCode, 'PARTIAL_IO_UNAVAILABLE');

  // Attempting to commit over stale rev 2 from coord2 MUST be rejected with 0 writes!
  const writesBeforeStaleAttempt = writeCount;
  const staleCommit = await coord2.commit(s4, '2');
  assert.equal(staleCommit.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(writeCount, writesBeforeStaleAttempt, 'Stale commit during partial IO freeze must perform 0 writes');

  // 3. All 3 slots IO-unreadable -> IO_UNAVAILABLE classification, stays frozen
  fault.setReadFault(SLOT_PATHS[0], true);
  fault.setReadFault(SLOT_PATHS[1], true);
  const allIoLoad = await coord1.loadSafe();
  assert.equal(allIoLoad.kind, 'STORAGE_UNAVAILABLE');
  if (allIoLoad.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(allIoLoad.recoveryClassification, 'IO_UNAVAILABLE');
    assert.equal(allIoLoad.readOnlyBackup, null);
  }

  // 4. Clear all IO faults -> complete loadSafe() confirms highest rev 3 and unfreezes to AVAILABLE
  fault.setReadFault(SLOT_PATHS[0], false);
  fault.setReadFault(SLOT_PATHS[1], false);
  fault.setReadFault(SLOT_PATHS[2], false);
  const fullRecover = await coord1.loadSafe();
  assert.equal(fullRecover.kind, 'VALID');
  if (fullRecover.kind === 'VALID') {
    assert.equal(fullRecover.revision, '3');
    assert.equal((fullRecover.raw as SpikeGameState).gold, s3.gold);
  }
  assert.equal(coord1.storageHealth, 'AVAILABLE');
  assert.equal(coord2.storageHealth, 'AVAILABLE');
  assert.equal((await coord2.commit(s4, '3')).kind, 'COMMITTED');

  // 5. Contrast: INVALID_CONTENT (corrupt bytes on readable slot, zero IO errors) IS allowed to recover backup & unfreeze
  const corruptMem = new MemoryFilePort(10 * 1024 * 1024, 'a03_corrupt_content_contrast');
  const corruptCoord = new SingleWriterSaveCoordinator(corruptMem);
  assert.equal((await corruptCoord.commit(s1, null)).kind, 'COMMITTED');
  assert.equal((await corruptCoord.commit(s2, '1')).kind, 'COMMITTED');
  await corruptMem.write(SLOT_PATHS[2], '{corrupt-non-json');
  const corruptRecovered = await corruptCoord.loadSafe();
  assert.equal(corruptRecovered.kind, 'VALID');
  if (corruptRecovered.kind === 'VALID') {
    assert.equal(corruptRecovered.revision, '2');
    assert.equal(corruptRecovered.recovered, true);
  }
  assert.equal(corruptCoord.storageHealth, 'AVAILABLE');
});

test('[NODE/A05/CROSS-TAB-LOCK-VS-TASK-ERROR-CLASSIFICATION] Task exception inside Web Lock is not misclassified as CROSS_TAB_LOCK_REJECTED', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevWin = g.window;
  const prevDoc = g.document;
  const prevNav = g.navigator;
  const prevLs = g.localStorage;
  const mockLs = createMockLocalStorage();

  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.a05', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;

  try {
    g.window = {};
    g.document = {};
    g.localStorage = mockLs.storage;
    Object.defineProperty(g, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        locks: {
          request: async <T>(_name: string, _opts: { mode: 'exclusive' }, cb: () => Promise<T>) => cb(),
        },
      },
    });

    // 1. Task body throws AFTER acquiring Web Lock -> must propagate original Error, NOT freeze as CROSS_TAB_LOCK_REJECTED!
    const port1 = new BrowserFilePort('a05_task_body_throw', undefined, { allowLocalStorageMockInNode: true });
    const coord1 = new SingleWriterSaveCoordinator(port1);
    assert.equal((await coord1.loadSafe()).kind, 'EMPTY');
    await assert.rejects(
      () =>
        coord1.commit(s1, null, {
          beforeCommitBody: async () => {
            throw new Error('audit body exception');
          },
        }),
      /audit body exception/
    );
    assert.equal(coord1.storageHealth, 'AVAILABLE', 'Task body exception must NOT falsely freeze healthy storage');
    assert.equal(coord1.freezeCode, 'NONE');
    // Subsequent healthy commit succeeds cleanly
    assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');

    // 2. Genuine navigator.locks.request rejection -> fails closed with CROSS_TAB_LOCK_REJECTED & freezes namespace
    Object.defineProperty(g, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        locks: {
          request: async () => {
            throw new Error('simulated lock manager failure');
          },
        },
      },
    });
    const port2 = new BrowserFilePort('a05_lock_rejected', undefined, { allowLocalStorageMockInNode: true });
    const coord2 = new SingleWriterSaveCoordinator(port2);
    const rejRes = await coord2.commit(s1, null);
    assert.equal(rejRes.kind, 'STORAGE_UNAVAILABLE');
    if (rejRes.kind === 'STORAGE_UNAVAILABLE') {
      assert.match(rejRes.detail, /CROSS_TAB_LOCK_REJECTED/);
    }
    assert.equal(coord2.storageHealth, 'STORAGE_UNAVAILABLE');
    assert.equal(coord2.freezeCode, 'CROSS_TAB_LOCK_UNAVAILABLE');

    // 3. Missing navigator.locks -> fails closed with CROSS_TAB_LOCK_UNAVAILABLE & freezes namespace
    Object.defineProperty(g, 'navigator', {
      configurable: true,
      writable: true,
      value: {},
    });
    const port3 = new BrowserFilePort('a05_lock_missing', undefined, { allowLocalStorageMockInNode: true });
    const coord3 = new SingleWriterSaveCoordinator(port3);
    const missRes = await coord3.commit(s1, null);
    assert.equal(missRes.kind, 'STORAGE_UNAVAILABLE');
    if (missRes.kind === 'STORAGE_UNAVAILABLE') {
      assert.match(missRes.detail, /CROSS_TAB_LOCK_UNAVAILABLE/);
    }
    assert.equal(coord3.storageHealth, 'STORAGE_UNAVAILABLE');
    assert.equal(coord3.freezeCode, 'CROSS_TAB_LOCK_UNAVAILABLE');
  } finally {
    g.window = prevWin;
    g.document = prevDoc;
    g.localStorage = prevLs;
    Object.defineProperty(g, 'navigator', { configurable: true, writable: true, value: prevNav });
  }
});

test('[NODE/REWORK-04/A02-SHARED-TX-MARKER-PROTOCOL] Persistent tx marker enforces write-ahead gate, fault isolation, crash/reload survival, recovery & domain isolation', async () => {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r4.a02', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;
  const s4 = advanceOffline(s3, START + 240_000).state;

  // 1. Pending marker write fails -> STORAGE_UNAVAILABLE with ZERO save slot writes
  const mem1 = new MemoryFilePort(10 * 1024 * 1024, 'r4_a02_marker_write_fail');
  const fault1 = new FaultInjectingFilePort(mem1);
  let slotWrites1 = 0;
  const countPort1: FilePort = {
    kind: 'FAULT_WRAPPER',
    storageKey: mem1.storageKey,
    probeStorage: () => fault1.probeStorage(),
    readTxState: () => fault1.readTxState(),
    writeTxState: (t) => fault1.writeTxState(t),
    clearTxState: () => fault1.clearTxState(),
    read: (p) => fault1.read(p),
    write: async (p, text) => {
      slotWrites1 += 1;
      return fault1.write(p, text);
    },
    remove: (p) => fault1.remove(p),
    list: (d) => fault1.list(d),
  };
  const coord1 = new SingleWriterSaveCoordinator(countPort1);
  assert.equal((await coord1.loadSafe()).kind, 'EMPTY');
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  const writesBeforeMarkerFail = slotWrites1;
  fault1.setTxMarkerFault('WRITE', true);
  const markerFailRes = await coord1.commit(s2, '1');
  fault1.setTxMarkerFault('WRITE', false);
  assert.equal(markerFailRes.kind, 'STORAGE_UNAVAILABLE');
  assert.match(markerFailRes.detail, /SHARED_TX_MARKER_WRITE_FAILED/);
  assert.equal(slotWrites1, writesBeforeMarkerFail, 'Failed tx marker write must perform 0 save slot writes');
  assert.equal((await coord1.loadSafe()).kind, 'VALID');

  // 2. Shared tx marker persisted in storage blocks a DIFFERENT coordinator with clean local memory
  //    (simulates separate JS realm / browser tab reading shared persistent storage!)
  const mem2 = new MemoryFilePort(10 * 1024 * 1024, 'r4_a02_realm_a');
  const coordA = new SingleWriterSaveCoordinator(mem2);
  assert.equal((await coordA.commit(s1, null)).kind, 'COMMITTED');
  // Simulate Tab A leaving a durable PENDING marker on disk while Tab B starts with an isolated storageKey
  // reading the exact same shared backing store (so Tab B has clean in-memory namespaceHealth!)
  await mem2.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: 'memory:r4_a02_realm_b_view',
      txId: 'tx_crashed_tab_a',
      state: 'PENDING',
      expectedRevision: '1',
      targetRevision: '2',
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'Simulated mid-write crash',
    })
  );
  let realmBWrites = 0;
  const realmBPort: FilePort = {
    kind: 'MEMORY',
    storageKey: 'memory:r4_a02_realm_b_view',
    probeStorage: () => mem2.probeStorage(),
    readTxState: () => mem2.readTxState(),
    writeTxState: (t) => mem2.writeTxState(t),
    clearTxState: () => mem2.clearTxState(),
    read: (p) => mem2.read(p),
    write: async (p, text) => {
      realmBWrites += 1;
      return mem2.write(p, text);
    },
    remove: (p) => mem2.remove(p),
    list: (d) => mem2.list(d),
  };
  const coordB = new SingleWriterSaveCoordinator(realmBPort);
  assert.equal(coordB.storageHealth, 'AVAILABLE', 'Simulated separate realm starts with clean local health');

  // Automatic boot load (clearPendingTxMarker: false) MUST preserve marker and stay STORAGE_UNAVAILABLE!
  const bootLoadB = await coordB.loadSafe({ clearPendingTxMarker: false });
  assert.equal(bootLoadB.kind, 'STORAGE_UNAVAILABLE');
  if (bootLoadB.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(bootLoadB.recoveryClassification, 'PENDING_RECOVERY_REQUIRED');
    assert.equal(bootLoadB.readOnlyBackup?.revision, '1');
  }
  assert.ok(await mem2.readTxState(), 'Automatic boot load must NOT clear pending tx marker');

  // Fresh realm C with clean local map attempting commit MUST read shared marker and fail closed with 0 writes!
  const realmCPort: FilePort = { ...realmBPort, storageKey: 'memory:r4_a02_realm_b_view' };
  const coordC = new SingleWriterSaveCoordinator(realmCPort);
  const blockedC = await coordC.commit(s2, '1');
  assert.equal(blockedC.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(realmBWrites, 0, 'Pending shared marker must block commit with 0 physical writes');

  // Explicit recovery (clearPendingTxMarker: true default) verifies all 3 slots, clears marker, unfreezes!
  const recoveredB = await coordB.loadSafe();
  assert.equal(recoveredB.kind, 'VALID');
  if (recoveredB.kind === 'VALID') {
    assert.equal(recoveredB.revision, '1');
  }
  assert.equal(await mem2.readTxState(), null, 'Explicit loadSafe recovery must clear pending marker');
  assert.equal((await coordB.commit(s2, '1')).kind, 'COMMITTED');
  // Stale writer attempting to commit with old revision '1' is rejected with CONFLICT (0 writes)
  const writesBeforeConflict = realmBWrites;
  const staleRes = await coordB.commit(s3, '1');
  assert.equal(staleRes.kind, 'CONFLICT');
  assert.equal(realmBWrites, writesBeforeConflict);

  // 3. Commit succeeds on disk, but clearing tx marker fails -> UNCERTAIN, marker remains, next commit blocked until loadSafe!
  const mem3 = new MemoryFilePort(10 * 1024 * 1024, 'r4_a02_clear_fail');
  const fault3 = new FaultInjectingFilePort(mem3);
  const coord3 = new SingleWriterSaveCoordinator(fault3);
  assert.equal((await coord3.commit(s1, null)).kind, 'COMMITTED');
  fault3.setTxMarkerFault('CLEAR', true);
  const clearFailCommit = await coord3.commit(s2, '1');
  assert.equal(clearFailCommit.kind, 'UNCERTAIN');
  assert.match(clearFailCommit.detail, /COMMIT_TX_MARKER_CLEAR_FAILED/);
  assert.ok(await mem3.readTxState(), 'Marker must remain on disk when clear fails');
  assert.equal(coord3.storageHealth, 'STORAGE_UNAVAILABLE');
  // Recovery while CLEAR still fails -> stays frozen (TX_STATE_CLEAR_FAILED)
  const recWhileClearFail = await coord3.loadSafe();
  assert.equal(recWhileClearFail.kind, 'STORAGE_UNAVAILABLE');
  if (recWhileClearFail.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recWhileClearFail.recoveryClassification, 'TX_STATE_CLEAR_FAILED');
  }
  // Once CLEAR fault heals, explicit recovery discovers committed rev 2 & clears marker!
  fault3.setTxMarkerFault('CLEAR', false);
  const recAfterClearHeal = await coord3.loadSafe();
  assert.equal(recAfterClearHeal.kind, 'VALID');
  if (recAfterClearHeal.kind === 'VALID') {
    assert.equal(recAfterClearHeal.revision, '2');
  }
  assert.equal(await mem3.readTxState(), null);
  assert.equal((await coord3.commit(s3, '2')).kind, 'COMMITTED');

  // 4. Shared tx marker unreadable (READ fault) or corrupt JSON during recovery & commit -> fail-closed
  fault3.setTxMarkerFault('READ', true);
  const recReadFail = await coord3.loadSafe();
  assert.equal(recReadFail.kind, 'STORAGE_UNAVAILABLE');
  if (recReadFail.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recReadFail.recoveryClassification, 'TX_STATE_UNREADABLE');
  }
  assert.equal((await coord3.commit(s4, '3')).kind, 'STORAGE_UNAVAILABLE');
  fault3.setTxMarkerFault('READ', false);

  await mem3.writeTxState('{broken-tx-marker-json');
  const recCorruptMarker = await coord3.loadSafe();
  assert.equal(recCorruptMarker.kind, 'STORAGE_UNAVAILABLE');
  if (recCorruptMarker.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recCorruptMarker.recoveryClassification, 'TX_STATE_CORRUPT');
  }
  await mem3.clearTxState();
  assert.equal((await coord3.loadSafe()).kind, 'VALID');

  // 5. Domain isolation: freezing domain X does NOT affect domain Y
  const memOther = new MemoryFilePort(10 * 1024 * 1024, 'r4_a02_other_domain');
  const coordOther = new SingleWriterSaveCoordinator(memOther);
  fault3.setTxMarkerFault('READ', true);
  assert.equal((await coord3.loadSafe()).kind, 'STORAGE_UNAVAILABLE');
  assert.equal((await coordOther.loadSafe()).kind, 'EMPTY');
  assert.equal((await coordOther.commit(s1, null)).kind, 'COMMITTED');
  fault3.setTxMarkerFault('READ', false);
});

test('[NODE/REWORK-04/P2-IDB-UNAVAILABLE-AND-LEGACY-LOCALSTORAGE] Missing IndexedDB fails closed, never misclassifies browser as Node, and preserves/reports legacy localStorage saves', async () => {
  const g = globalThis as Record<string, unknown>;
  const prevLs = g.localStorage;
  const prevIdb = g.indexedDB;
  const mockLs = createMockLocalStorage();
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r4.p2', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const legacyEnvText = buildEnvelope(s1, '1').text;

  try {
    delete g.indexedDB;
    g.localStorage = mockLs.storage;

    // Seed a legacy experimental localStorage save for namespace
    const ns = 'r4_p2_legacy_ns';
    const legacyKey = `${ns}:${SLOT_PATHS[0]}`;
    mockLs.store.set(legacyKey, legacyEnvText);

    // 1. Without explicit allowLocalStorageMockInNode -> fail-closed even in Node, detects & preserves legacy save
    const portNoOpt = new BrowserFilePort(ns);
    assert.equal(portNoOpt.kind, 'BROWSER_STORAGE_UNAVAILABLE');
    assert.equal(portNoOpt.storageAvailable, false);
    const probeNoOpt = await portNoOpt.probeStorage();
    assert.equal(probeNoOpt.available, false);
    assert.match(probeNoOpt.reason ?? '', /INDEXED_DB_UNAVAILABLE/);

    const legacyStatus = portNoOpt.getLegacyStorageStatus();
    assert.equal(legacyStatus.detected, true);
    assert.equal(legacyStatus.policy, 'DETECTED_IGNORED_NO_AUTO_MIGRATION');
    assert.deepEqual(legacyStatus.keys, [legacyKey]);

    const coordNoOpt = new SingleWriterSaveCoordinator(portNoOpt);
    const loadNoOpt = await coordNoOpt.loadSafe();
    assert.equal(loadNoOpt.kind, 'STORAGE_UNAVAILABLE', 'Must NEVER resurrect legacy localStorage save or return EMPTY');
    const commitNoOpt = await coordNoOpt.commit(s0, null);
    assert.equal(commitNoOpt.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(mockLs.store.get(legacyKey), legacyEnvText, 'Legacy localStorage save must remain byte-identical');
    assert.equal(mockLs.store.size, 1, 'Zero new localStorage keys may be written when IndexedDB is unavailable');

    // 2. Explicit allowLocalStorageMockInNode works ONLY in authentic Node test host
    const portNodeMock = new BrowserFilePort('r4_p2_explicit_node_mock', undefined, {
      allowLocalStorageMockInNode: true,
    });
    assert.equal(portNodeMock.kind, 'BROWSER_LOCAL_STORAGE_FALLBACK');
    assert.equal((await portNodeMock.probeStorage()).available, true);
  } finally {
    g.localStorage = prevLs;
    if (typeof prevIdb === 'undefined') delete g.indexedDB;
    else g.indexedDB = prevIdb;
  }
});

test('[NODE/REWORK-05/REV4-01-RECOVERY-SAFETY-MATRIX] Prior-valid EMPTY, partial-IO FROZEN EMPTY, unknown EMPTY, initial-create EMPTY & revision regression', async () => {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r5.rev401', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;

  // 1. Prior valid rev 1 + PENDING(expectedRevision='1') + all 3 slots disappear -> MUST stay frozen & keep marker!
  const mem1 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev401_lost_slots');
  const coord1 = new SingleWriterSaveCoordinator(mem1);
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  await mem1.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: mem1.storageKey,
      txId: 'tx_lost_slots_v1',
      state: 'PENDING',
      expectedRevision: '1',
      targetRevision: '2',
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'Simulated in-flight commit before slots vanished (legacy v1 marker without priorSaveHistory)',
    })
  );
  for (const p of SLOT_PATHS) await mem1.remove(p);
  const resLost = await coord1.loadSafe();
  assert.equal(resLost.kind, 'STORAGE_UNAVAILABLE');
  if (resLost.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(resLost.recoveryClassification, 'SAVE_DISAPPEARED_PENDING_RECOVERY');
  }
  assert.ok(await mem1.readTxState(), 'Marker MUST be preserved when prior valid save disappeared');
  assert.equal(coord1.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal((await coord1.commit(s0, null)).kind, 'STORAGE_UNAVAILABLE');

  // 2. Partial IO creates FROZEN marker preserving highest valid backup rev=2 -> slots vanish -> MUST stay frozen!
  const mem2 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev401_frozen_backup_lost');
  const fault2 = new FaultInjectingFilePort(mem2);
  const coord2 = new SingleWriterSaveCoordinator(fault2);
  assert.equal((await coord2.commit(s1, null)).kind, 'COMMITTED');
  assert.equal((await coord2.commit(s2, '1')).kind, 'COMMITTED');
  assert.equal((await coord2.commit(s3, '2')).kind, 'COMMITTED');
  fault2.setReadFault(SLOT_PATHS[2], true);
  const partialRes = await coord2.loadSafe();
  assert.equal(partialRes.kind, 'STORAGE_UNAVAILABLE');
  if (partialRes.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(partialRes.recoveryClassification, 'PARTIAL_IO_UNAVAILABLE');
    assert.equal(partialRes.readOnlyBackup?.revision, '2');
  }
  const frozenRaw = await mem2.readTxState();
  assert.ok(frozenRaw, 'Partial IO must persist FROZEN marker');
  const frozenParsed = JSON.parse(frozenRaw!);
  assert.equal(frozenParsed.priorSaveHistory, 'CONFIRMED_VALID');
  // R5-01: rev 3 was already confirmed before partial IO hid slot 2 -> floor MUST stay '3', never drop to backup '2'!
  assert.equal(frozenParsed.confirmedRevision, '3');
  // Now clear IO fault and delete all 3 slots -> loadSafe() MUST NOT unfreeze as EMPTY!
  fault2.setReadFault(SLOT_PATHS[2], false);
  for (const p of SLOT_PATHS) await mem2.remove(p);
  const afterFrozenLost = await coord2.loadSafe();
  assert.equal(afterFrozenLost.kind, 'STORAGE_UNAVAILABLE');
  if (afterFrozenLost.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(afterFrozenLost.recoveryClassification, 'SAVE_DISAPPEARED_PENDING_RECOVERY');
  }
  assert.ok(await mem2.readTxState());

  // 3. Unknown prior history (expectedRevision=null, priorSaveHistory='UNKNOWN' or legacy null) + EMPTY -> MUST stay frozen!
  const mem3 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev401_unknown_empty');
  const coord3 = new SingleWriterSaveCoordinator(mem3);
  await mem3.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: mem3.storageKey,
      txId: 'tx_unknown_legacy_null',
      state: 'FROZEN',
      expectedRevision: null,
      targetRevision: null,
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'Legacy marker with expectedRevision=null and unknown history',
    })
  );
  const unknownEmptyRes = await coord3.loadSafe();
  assert.equal(unknownEmptyRes.kind, 'STORAGE_UNAVAILABLE');
  if (unknownEmptyRes.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(unknownEmptyRes.recoveryClassification, 'SAVE_DISAPPEARED_PENDING_RECOVERY');
  }
  assert.ok(await mem3.readTxState(), 'expectedRevision=null alone MUST NEVER authorize silent EMPTY unfreeze');

  // 4. Explicit CONFIRMED_EMPTY_INITIAL_CREATE + EMPTY -> SAFELY recovers as EMPTY & clears marker!
  const mem4 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev401_confirmed_initial_create');
  const coord4 = new SingleWriterSaveCoordinator(mem4);
  await mem4.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: mem4.storageKey,
      txId: 'tx_initial_create_crash',
      state: 'PENDING',
      expectedRevision: null,
      targetRevision: '1',
      priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE',
      confirmedRevision: null,
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'Confirmed empty initial create crashed before slot write',
    })
  );
  const initialRecover = await coord4.loadSafe();
  assert.equal(initialRecover.kind, 'EMPTY');
  assert.equal(await mem4.readTxState(), null);
  assert.equal(coord4.storageHealth, 'AVAILABLE');
  assert.equal((await coord4.commit(s1, null)).kind, 'COMMITTED');

  // 5. VALID save on disk with revision LOWER than confirmed historical revision in marker -> MUST NOT silently unfreeze!
  const mem5 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev401_rev_regression');
  const coord5 = new SingleWriterSaveCoordinator(mem5);
  assert.equal((await coord5.commit(s1, null)).kind, 'COMMITTED');
  assert.equal((await coord5.commit(s2, '1')).kind, 'COMMITTED');
  // Marker confirms rev 2 existed; now slot 1 (rev 2) vanishes leaving only rev 1 on disk!
  await mem5.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: mem5.storageKey,
      txId: 'tx_rev2_to_rev3',
      state: 'PENDING',
      expectedRevision: '2',
      targetRevision: '3',
      priorSaveHistory: 'CONFIRMED_VALID',
      confirmedRevision: '2',
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'In-flight commit from rev 2',
    })
  );
  await mem5.remove(SLOT_PATHS[1]); // delete rev 2 slot, leaving only valid rev 1
  const regRes = await coord5.loadSafe();
  assert.equal(regRes.kind, 'STORAGE_UNAVAILABLE');
  if (regRes.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(regRes.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
    assert.equal(regRes.readOnlyBackup?.revision, '1');
  }
  assert.ok(await mem5.readTxState(), 'Marker MUST be preserved on revision regression');
  assert.equal(coord5.storageHealth, 'STORAGE_UNAVAILABLE');
});

test('[NODE/REWORK-05/REV4-03-CONTROLLED-CORRUPT-MARKER-RECOVERY] Distinguishes IO vs corrupt vs valid marker and enforces controlled re-verified recovery', async () => {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r5.rev403', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;

  // 1. Corrupt marker + VALID rev 1 -> loadSafe() returns TX_STATE_CORRUPT + preview; controlled confirm recovers rev 1!
  const mem1 = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev403_corrupt_valid');
  const fault1 = new FaultInjectingFilePort(mem1);
  const coord1 = new SingleWriterSaveCoordinator(fault1);
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  const origSlot0 = await mem1.read(SLOT_PATHS[0]);
  await mem1.writeTxState('{"version":1,"truncated');

  const inspect1 = await coord1.loadSafe();
  assert.equal(inspect1.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(inspect1.recoveryClassification, 'TX_STATE_CORRUPT');
  assert.equal(inspect1.readOnlyBackup?.revision, '1');
  assert.ok(inspect1.corruptMarkerRecoveryPreview?.canConfirmRecovery);
  const preview = inspect1.corruptMarkerRecoveryPreview!;
  assert.equal(preview.verifiedRevision, '1');
  assert.ok(preview.corruptMarkerSha256.length === 64);
  assert.ok(preview.slotsSnapshotSha256 && preview.slotsSnapshotSha256.length === 64);

  // Concurrent marker mutation between preview and confirm -> REJECTED!
  await mem1.writeTxState('{"version":1,"different_corrupt');
  const staleConfirm = await coord1.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: preview.corruptMarkerSha256,
    expectedValidRevision: preview.verifiedRevision!,
    expectedSlotsSnapshotSha256: preview.slotsSnapshotSha256!,
  });
  assert.equal(staleConfirm.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(staleConfirm.recoveryClassification, 'CONCURRENT_RECOVERY_STATE_CHANGED');

  // Re-inspect & test clear failure -> TX_STATE_CLEAR_FAILED stays frozen
  const inspect2 = await coord1.loadSafe();
  assert.equal(inspect2.kind, 'STORAGE_UNAVAILABLE');
  const preview2 = inspect2.corruptMarkerRecoveryPreview!;
  fault1.setTxMarkerFault('CLEAR', true);
  const clearFailConfirm = await coord1.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: preview2.corruptMarkerSha256,
    expectedValidRevision: preview2.verifiedRevision!,
    expectedSlotsSnapshotSha256: preview2.slotsSnapshotSha256!,
  });
  fault1.setTxMarkerFault('CLEAR', false);
  assert.equal(clearFailConfirm.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(clearFailConfirm.recoveryClassification, 'TX_STATE_CLEAR_FAILED');
  assert.ok(await mem1.readTxState());

  // Clean controlled confirmation -> recovers VALID rev 1, slot 0 untouched, corrupt marker cleared, rev 2 commits!
  const confirmed = await coord1.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: preview2.corruptMarkerSha256,
    expectedValidRevision: preview2.verifiedRevision!,
    expectedSlotsSnapshotSha256: preview2.slotsSnapshotSha256!,
  });
  assert.equal(confirmed.kind, 'VALID');
  assert.equal(confirmed.revision, '1');
  assert.equal(await mem1.read(SLOT_PATHS[0]), origSlot0, 'Controlled recovery MUST NOT delete or alter valid save slots');
  assert.equal(await mem1.readTxState(), null);
  assert.equal((await coord1.commit(s2, '1')).kind, 'COMMITTED');

  // 2. Corrupt marker + EMPTY disk -> controlled recovery FORBIDDEN!
  const memEmpty = new MemoryFilePort(10 * 1024 * 1024, 'r5_rev403_corrupt_empty');
  const coordEmpty = new SingleWriterSaveCoordinator(memEmpty);
  await memEmpty.writeTxState('{corrupt-empty');
  const inspEmpty = await coordEmpty.loadSafe();
  assert.equal(inspEmpty.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(inspEmpty.recoveryClassification, 'TX_STATE_CORRUPT');
  assert.equal(inspEmpty.corruptMarkerRecoveryPreview?.canConfirmRecovery, false);
  const rejEmpty = await coordEmpty.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: inspEmpty.corruptMarkerRecoveryPreview!.corruptMarkerSha256,
    expectedValidRevision: '1',
    expectedSlotsSnapshotSha256: '0'.repeat(64),
  });
  assert.equal(rejEmpty.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(rejEmpty.recoveryClassification, 'CORRUPT_MARKER_NO_VALID_SAVE');
  assert.ok(await memEmpty.readTxState());

  // 3. Marker read IO error -> TX_STATE_UNREADABLE (distinct from TX_STATE_CORRUPT!), controlled recovery FORBIDDEN!
  fault1.setTxMarkerFault('READ', true);
  const ioLoad = await coord1.loadSafe();
  assert.equal(ioLoad.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(ioLoad.recoveryClassification, 'TX_STATE_UNREADABLE');
  assert.equal(ioLoad.corruptMarkerRecoveryPreview, null);
  const ioConfirm = await coord1.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: '0'.repeat(64),
    expectedValidRevision: '2',
    expectedSlotsSnapshotSha256: '0'.repeat(64),
  });
  fault1.setTxMarkerFault('READ', false);
  assert.equal(ioConfirm.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(ioConfirm.recoveryClassification, 'TX_STATE_UNREADABLE');
});

// =========================================================================
// REV4-08: Formal [MOCK-WX] WeChat Transaction-Marker & Recovery Regression
// Explicitly mocked wx.getFileSystemManager() — NEVER substitutes for real WeChat DevTools/device!
// =========================================================================
function createMockWxWithUnlinkAndTruncate() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['wxfile://usr']);
  let failReadOn: string | null = null;
  let failWriteOn: string | null = null;
  let failUnlinkOn: string | null = null;
  let truncateWriteOn: string | null = null;
  const slotWrites: string[] = [];
  const fsObj = {
    accessSync(p: string) {
      if (!dirs.has(p) && !files.has(p)) throw new Error(`accessSync:fail no such file or directory ${p}`);
    },
    mkdirSync(p: string) {
      dirs.add(p);
    },
    readFileSync(p: string) {
      if (failReadOn && p.endsWith(failReadOn)) throw new Error(`readFileSync:fail permission denied ${p}`);
      if (!files.has(p)) throw new Error(`readFileSync:fail no such file or directory ${p}`);
      return files.get(p)!;
    },
    writeFileSync(p: string, data: string) {
      if (failWriteOn && p.endsWith(failWriteOn)) throw new Error(`writeFileSync:fail maximum size of the file storage limit is exceeded ${p}`);
      const stored = truncateWriteOn && p.endsWith(truncateWriteOn) ? data.slice(0, Math.max(1, Math.floor(data.length / 2))) : data;
      files.set(p, stored);
      if (p.includes('save_slot_')) slotWrites.push(p);
    },
    unlinkSync(p: string) {
      if (failUnlinkOn && p.endsWith(failUnlinkOn)) throw new Error(`unlinkSync:fail permission denied ${p}`);
      if (!files.has(p)) throw new Error(`unlinkSync:fail no such file or directory ${p}`);
      files.delete(p);
    },
    readdirSync(dir: string) {
      const prefix = `${dir}/`;
      const out: string[] = [];
      for (const key of files.keys()) if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
      return out;
    },
  };
  return {
    wx: { __FE000_MOCK__: true, env: { USER_DATA_PATH: 'wxfile://usr' }, getFileSystemManager: () => fsObj },
    files,
    slotWrites,
    setFailReadOn: (v: string | null) => { failReadOn = v; },
    setFailWriteOn: (v: string | null) => { failWriteOn = v; },
    setFailUnlinkOn: (v: string | null) => { failUnlinkOn = v; },
    setTruncateWriteOn: (v: string | null) => { truncateWriteOn = v; },
  };
}

function makeWxStates() {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r5.wx', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;
  return { s0, s1, s2, s3 };
}

test('[MOCK-WX/REV4-08/1-MARKER-ROUNDTRIP-AND-TRUNCATION] WeChat tx marker roundtrip, list filter & truncated write detection', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const port = new WeChatFilePort('r5_wx_rt_trunc');
    assert.equal(await port.readTxState(), null);
    await port.writeTxState('{"ok":true}');
    assert.equal(await port.readTxState(), '{"ok":true}');
    assert.deepEqual(await port.list(), []);
    assert.equal(mock.files.has('wxfile://usr/r5_wx_rt_trunc/__tx_state__.json'), true);
    await port.clearTxState();
    assert.equal(await port.readTxState(), null);

    // Truncated write on __tx_state__.json is immediately detected by writeTxState readback -> 0 slot writes!
    const { s1, s2 } = makeWxStates();
    const coord = new SingleWriterSaveCoordinator(port);
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    const writesBefore = mock.slotWrites.length;
    mock.setTruncateWriteOn('__tx_state__.json');
    const truncRes = await coord.commit(s2, '1');
    mock.setTruncateWriteOn(null);
    assert.equal(truncRes.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(mock.slotWrites.length, writesBefore, 'Truncated wx marker write must perform 0 slot writes');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/2-MARKER-WRITE-FAIL] WeChat marker write failure -> STORAGE_UNAVAILABLE, zero slot writes, recovers rev 1', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2 } = makeWxStates();
    const port = new WeChatFilePort('r5_wx_write_fail');
    const coord = new SingleWriterSaveCoordinator(port);
    assert.equal((await coord.loadSafe()).kind, 'EMPTY');
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    const before = mock.slotWrites.length;
    mock.setFailWriteOn('__tx_state__.json');
    const res = await coord.commit(s2, '1');
    mock.setFailWriteOn(null);
    assert.equal(res.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(mock.slotWrites.length, before);
    const rec = await coord.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '1');
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/3-MARKER-READ-FAIL] WeChat marker read failure -> TX_STATE_UNREADABLE, zero slot writes', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2 } = makeWxStates();
    const port = new WeChatFilePort('r5_wx_read_fail');
    const coord = new SingleWriterSaveCoordinator(port);
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    const before = mock.slotWrites.length;
    mock.setFailReadOn('__tx_state__.json');
    const c = await coord.commit(s2, '1');
    const l = await coord.loadSafe();
    mock.setFailReadOn(null);
    assert.equal(c.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.kind === 'STORAGE_UNAVAILABLE' ? l.recoveryClassification : null, 'TX_STATE_UNREADABLE');
    assert.equal(mock.slotWrites.length, before);
    assert.equal((await coord.loadSafe()).kind, 'VALID');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/4-MARKER-CORRUPT-CONTROLLED-RECOVERY] WeChat truncated marker -> TX_STATE_CORRUPT -> controlled recovery preserves slots', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2 } = makeWxStates();
    const port = new WeChatFilePort('r5_wx_corrupt_ctrl');
    const coord = new SingleWriterSaveCoordinator(port);
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    await port.write('__tx_state__.json', '{"version":1,"storageKey":"wechat:');
    const l = await coord.loadSafe();
    assert.equal(l.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.recoveryClassification, 'TX_STATE_CORRUPT');
    assert.ok(l.corruptMarkerRecoveryPreview?.canConfirmRecovery);
    assert.equal((await coord.commit(s2, '1')).kind, 'STORAGE_UNAVAILABLE');
    const p = l.corruptMarkerRecoveryPreview!;
    const recovered = await coord.recoverFromCorruptTxMarker({
      expectedCorruptMarkerSha256: p.corruptMarkerSha256,
      expectedValidRevision: p.verifiedRevision!,
      expectedSlotsSnapshotSha256: p.slotsSnapshotSha256!,
    });
    assert.equal(recovered.kind, 'VALID');
    assert.equal(recovered.revision, '1');
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/5-MARKER-CLEAR-FAIL] WeChat committed-but-unlink-failed -> UNCERTAIN, marker retained, recovers rev 2', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2, s3 } = makeWxStates();
    const port = new WeChatFilePort('r5_wx_clear_fail');
    const coord = new SingleWriterSaveCoordinator(port);
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    mock.setFailUnlinkOn('__tx_state__.json');
    const r = await coord.commit(s2, '1');
    mock.setFailUnlinkOn(null);
    assert.equal(r.kind, 'UNCERTAIN');
    assert.ok(await port.readTxState());
    assert.equal((await coord.commit(s3, '2')).kind, 'STORAGE_UNAVAILABLE');
    const rec = await coord.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '2');
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s3, '2')).kind, 'COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/6-PREWRITE-VS-QUOTA-RECOVERY] WeChat deterministic PRE_WRITE_ERROR vs conservative QUOTA freeze + explicit recovery', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2, s3 } = makeWxStates();
    const port = new WeChatFilePort('r5_wx_prewrite_quota');
    const fault = new FaultInjectingFilePort(port);
    const coord = new SingleWriterSaveCoordinator(fault);
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');

    // Deterministic PRE_WRITE_ERROR -> FAILED, no freeze, marker cleared
    fault.armNextWriteFault('PRE_WRITE_ERROR');
    assert.equal((await coord.commit(s2, '1')).kind, 'FAILED');
    assert.equal(coord.storageHealth, 'AVAILABLE');
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');

    // Real QUOTA / writeFileSync failure -> conservative freeze (FROZEN marker with requiresWriteVerification=true)
    mock.setFailWriteOn('save_slot_2.json');
    const quotaRes = await coord.commit(s3, '2');
    assert.equal(quotaRes.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(coord.storageHealth, 'STORAGE_UNAVAILABLE');
    assert.ok(await port.readTxState());
    // R5-02: While real slot write failure persists, loadSafe() MUST NOT unfreeze!
    const stillFailingRec = await coord.loadSafe();
    assert.equal(stillFailingRec.kind, 'STORAGE_UNAVAILABLE');
    if (stillFailingRec.kind === 'STORAGE_UNAVAILABLE') {
      assert.equal(stillFailingRec.recoveryClassification, 'WRITE_CAPABILITY_UNAVAILABLE');
      assert.equal(stillFailingRec.readOnlyBackup?.revision, '2');
    }
    assert.equal(coord.storageHealth, 'STORAGE_UNAVAILABLE');
    assert.ok(await port.readTxState(), 'FROZEN marker must stay on disk while write fault persists');

    // Clear write fault -> still frozen until explicit recovery; explicit loadSafe() executes safe checkpoint commit
    mock.setFailWriteOn(null);
    assert.equal((await coord.commit(s3, '2')).kind, 'STORAGE_UNAVAILABLE');
    const rec = await coord.loadSafe();
    assert.equal(rec.kind, 'VALID');
    if (rec.kind === 'VALID') {
      // Option A safe checkpoint commit advances revision 2 -> 3 with ZERO game-state mutation
      assert.equal(rec.revision, '3');
      assert.equal(canonicalStringify(rec.raw), canonicalStringify(s2));
    }
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s3, '3')).kind, 'COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

test('[MOCK-WX/REV4-08/7-CROSS-COORDINATOR-AND-EMPTY-GUARD] WeChat cross-coordinator UNCERTAIN freeze, lost-slots EMPTY guard & stale CONFLICT', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2, s3 } = makeWxStates();
    const base = new WeChatFilePort('r5_wx_cross_empty');
    let armed = false;
    let afterWrite = false;
    const wrapper: FilePort = {
      kind: 'WECHAT_FS',
      storageKey: base.storageKey,
      readTxState: () => base.readTxState(),
      writeTxState: (t) => base.writeTxState(t),
      clearTxState: () => base.clearTxState(),
      read: async (p) => {
        if (armed && afterWrite) throw new Error('wx read fault');
        return base.read(p);
      },
      write: async (p, t) => {
        if (armed) {
          afterWrite = true;
          throw new Error('wx write fault before landing');
        }
        return base.write(p, t);
      },
      remove: (p) => base.remove(p),
      list: (d) => base.list(d),
    };
    const coord1 = new SingleWriterSaveCoordinator(wrapper);
    const coord2 = new SingleWriterSaveCoordinator(new WeChatFilePort('r5_wx_cross_empty'));
    assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
    assert.equal((await coord1.commit(s2, '1')).kind, 'COMMITTED');

    armed = true;
    const unc = await coord1.commit(s3, '2');
    assert.equal(unc.kind, 'UNCERTAIN');
    assert.equal((await coord2.commit(s3, '2')).kind, 'STORAGE_UNAVAILABLE');
    armed = false;

    // If slots vanish while UNCERTAIN marker exists -> MUST stay frozen (SAVE_DISAPPEARED_PENDING_RECOVERY)
    const backupSlot0 = await base.read(SLOT_PATHS[0]);
    const backupSlot1 = await base.read(SLOT_PATHS[1]);
    await base.remove(SLOT_PATHS[0]);
    await base.remove(SLOT_PATHS[1]);
    const lost = await coord2.loadSafe();
    assert.equal(lost.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(lost.recoveryClassification, 'SAVE_DISAPPEARED_PENDING_RECOVERY');
    // Restore slots -> explicit recovery succeeds rev 2, then rev 3 commits, stale rev 2 -> CONFLICT
    await base.write(SLOT_PATHS[0], backupSlot0!);
    await base.write(SLOT_PATHS[1], backupSlot1!);
    const rec = await coord2.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '2');
    assert.equal((await coord2.commit(s3, '2')).kind, 'COMMITTED');
    assert.equal((await coord2.commit(s3, '2')).kind, 'CONFLICT');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

// =========================================================================
// REWORK-06: Formal Regression Suite for R5-01, R5-02, R5-03 Security Invariants
// =========================================================================

test('[NODE/REWORK-06/R5-01-CONFIRMED-REVISION-MONOTONIC-GUARD] Confirmed revision floor never regresses across partial IO, slot loss, new coordinator, history-write failure, or corrupt metadata', async () => {
  const START = 1_700_000_000_000;
  const s = createInitialState({ saveEpoch: 'epoch.r6.r501', startMs: START, allowanceMs: 3_600_000 });
  const t = advanceOffline(s, START + 60_000).state;
  const u = advanceOffline(t, START + 120_000).state;

  // 1. Astra R5-01 exact counterexample on custom FilePort without readHistoryState/writeHistoryState
  const customDisk = new Map<string, string>();
  let customMarker: string | null = null;
  let customHidden: string | null = null;
  let customWriteCount = 0;
  const customPort: FilePort = {
    kind: 'MEMORY',
    storageKey: `r6.r501.astra.exact.${Date.now()}`,
    readTxState: async () => customMarker,
    writeTxState: async (txt) => { customMarker = txt; },
    clearTxState: async () => { customMarker = null; },
    read: async (k) => {
      if (k === customHidden) throw new Error('temporary IO');
      return customDisk.get(k) ?? null;
    },
    write: async (k, v) => {
      customWriteCount += 1;
      customDisk.set(k, v);
    },
    remove: async (k) => { customDisk.delete(k); },
    list: async () => [...customDisk.keys()],
  };
  const coordCustom = new SingleWriterSaveCoordinator(customPort);
  assert.equal((await coordCustom.commit(s, null)).kind, 'COMMITTED');
  assert.equal((await coordCustom.commit(t, '1')).kind, 'COMMITTED');
  const confirmed2 = await coordCustom.loadSafe();
  assert.equal(confirmed2.kind, 'VALID');
  assert.equal(confirmed2.kind === 'VALID' ? confirmed2.revision : null, '2');

  customHidden = SLOT_PATHS[1];
  const partialRes = await coordCustom.loadSafe();
  assert.equal(partialRes.kind, 'STORAGE_UNAVAILABLE');
  if (partialRes.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(partialRes.recoveryClassification, 'PARTIAL_IO_UNAVAILABLE');
    assert.equal(partialRes.readOnlyBackup?.revision, '1');
  }
  assert.ok(customMarker, 'Partial IO must persist FROZEN marker');
  const parsedCustomMarker = JSON.parse(customMarker!);
  assert.equal(parsedCustomMarker.state, 'FROZEN');
  assert.equal(parsedCustomMarker.confirmedRevision, '2', 'FROZEN marker MUST preserve confirmed rev 2, NOT drop to backup rev 1');

  // Highest slot vanishes -> same coordinator & brand-new coordinator MUST reject rollback to rev 1!
  customDisk.delete(SLOT_PATHS[1]);
  customHidden = null;
  const writesBefore = customWriteCount;
  const regSame = await coordCustom.loadSafe();
  assert.equal(regSame.kind, 'STORAGE_UNAVAILABLE');
  if (regSame.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(regSame.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
    assert.equal(regSame.readOnlyBackup?.revision, '1');
  }
  assert.ok(customMarker, 'Marker MUST remain on disk after regression refusal');
  const staleRecommit = await coordCustom.commit(s, '1');
  assert.equal(staleRecommit.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(customWriteCount, writesBefore, 'Stale rev 1 MUST NOT reclaim rev 2 (0 slot writes)');

  const coordCustomFresh = new SingleWriterSaveCoordinator(customPort);
  const regFresh = await coordCustomFresh.loadSafe();
  assert.equal(regFresh.kind, 'STORAGE_UNAVAILABLE');
  if (regFresh.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(regFresh.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
    assert.equal(regFresh.readOnlyBackup?.revision, '1');
  }

  // 2. Multiple consecutive faults (partial IO -> all IO -> slot vanishes) on MemoryFilePort + new coordinator
  const mem2 = new MemoryFilePort(10 * 1024 * 1024, 'r6_r501_multi_fault');
  const fault2 = new FaultInjectingFilePort(mem2);
  const c2a = new SingleWriterSaveCoordinator(fault2);
  assert.equal((await c2a.commit(s, null)).kind, 'COMMITTED');
  assert.equal((await c2a.commit(t, '1')).kind, 'COMMITTED');
  fault2.setReadFault(SLOT_PATHS[1], true);
  assert.equal((await c2a.loadSafe()).kind, 'STORAGE_UNAVAILABLE');
  fault2.setReadFault(SLOT_PATHS[0], true);
  fault2.setReadFault(SLOT_PATHS[2], true);
  const allIo = await c2a.loadSafe();
  assert.equal(allIo.kind, 'STORAGE_UNAVAILABLE');
  if (allIo.kind === 'STORAGE_UNAVAILABLE') assert.equal(allIo.recoveryClassification, 'IO_UNAVAILABLE');
  fault2.setReadFault(SLOT_PATHS[0], false);
  fault2.setReadFault(SLOT_PATHS[1], false);
  fault2.setReadFault(SLOT_PATHS[2], false);
  await mem2.remove(SLOT_PATHS[1]);
  const c2b = new SingleWriterSaveCoordinator(mem2);
  const reg2b = await c2b.loadSafe();
  assert.equal(reg2b.kind, 'STORAGE_UNAVAILABLE');
  if (reg2b.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(reg2b.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
    assert.equal(reg2b.readOnlyBackup?.revision, '1');
  }
  // Even a corrupt tx marker CANNOT bypass persisted confirmed history floor!
  await mem2.writeTxState('{corrupt-bypass-attempt');
  const corruptReg = await c2b.loadSafe();
  assert.equal(corruptReg.kind, 'STORAGE_UNAVAILABLE');
  if (corruptReg.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(corruptReg.recoveryClassification, 'TX_STATE_CORRUPT');
    assert.equal(corruptReg.corruptMarkerRecoveryPreview?.canConfirmRecovery, false);
  }
  const confirmReg = await c2b.recoverFromCorruptTxMarker({
    expectedCorruptMarkerSha256: sha256Hex('{corrupt-bypass-attempt'),
    expectedValidRevision: '1',
    expectedSlotsSnapshotSha256: '0'.repeat(64),
  });
  assert.equal(confirmReg.kind, 'STORAGE_UNAVAILABLE');
  if (confirmReg.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(confirmReg.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
  }

  // 3. History metadata write failure during commit MUST NOT return false COMMITTED; recovers once healed!
  const mem3 = new MemoryFilePort(10 * 1024 * 1024, 'r6_r501_hist_write_fail');
  const fault3 = new FaultInjectingFilePort(mem3);
  const c3 = new SingleWriterSaveCoordinator(fault3);
  assert.equal((await c3.commit(s, null)).kind, 'COMMITTED');
  fault3.setHistoryFault('WRITE', true);
  const histFailCommit = await c3.commit(t, '1');
  assert.equal(histFailCommit.kind, 'UNCERTAIN', 'History metadata confirmation failure MUST NOT return false COMMITTED');
  assert.equal(c3.storageHealth, 'STORAGE_UNAVAILABLE');
  // While history write still fails, loadSafe() MUST stay frozen
  const histStillFail = await c3.loadSafe();
  assert.equal(histStillFail.kind, 'STORAGE_UNAVAILABLE');
  if (histStillFail.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(histStillFail.recoveryClassification, 'HISTORY_STATE_WRITE_FAILED');
  }
  // Heal history write -> loadSafe() confirms saved state `t` via write-verified checkpoint & persists monotonic history floor -> unfreezes!
  fault3.setHistoryFault('WRITE', false);
  const histHealed = await c3.loadSafe();
  assert.equal(histHealed.kind, 'VALID');
  if (histHealed.kind === 'VALID') {
    assert.equal(canonicalStringify(histHealed.raw), canonicalStringify(t));
    assert.equal(JSON.parse((await mem3.readHistoryState())!).confirmedRevision, histHealed.revision);
  }

  // 4. Corrupt / legacy-invalid / unreadable SaveHistoryMeta -> conservative fail-closed (never silently lowered!)
  await mem3.writeHistoryState('{"version":99,"confirmedRevision":"0"}');
  const badHistLoad = await c3.loadSafe();
  assert.equal(badHistLoad.kind, 'STORAGE_UNAVAILABLE');
  if (badHistLoad.kind === 'STORAGE_UNAVAILABLE') assert.equal(badHistLoad.recoveryClassification, 'HISTORY_STATE_CORRUPT');
  assert.equal((await c3.commit(u, '2')).kind, 'STORAGE_UNAVAILABLE');
  fault3.setHistoryFault('READ', true);
  const unreadHist = await c3.loadSafe();
  fault3.setHistoryFault('READ', false);
  assert.equal(unreadHist.kind, 'STORAGE_UNAVAILABLE');
  if (unreadHist.kind === 'STORAGE_UNAVAILABLE') assert.equal(unreadHist.recoveryClassification, 'HISTORY_STATE_UNREADABLE');

  // 5. Normal initial create, deterministic PRE_WRITE_ERROR, ordinary CONFLICT, and confirmed != unconfirmed target!
  const mem4 = new MemoryFilePort(10 * 1024 * 1024, 'r6_r501_adjacent');
  const fault4 = new FaultInjectingFilePort(mem4);
  const c4 = new SingleWriterSaveCoordinator(fault4);
  assert.equal((await c4.loadSafe()).kind, 'EMPTY');
  assert.equal((await c4.commit(s, null)).kind, 'COMMITTED');
  assert.equal(JSON.parse((await mem4.readHistoryState())!).confirmedRevision, '1');
  // Deterministic PRE_WRITE_ERROR -> FAILED, history floor MUST stay '1' (not promoted to target '2')!
  fault4.armNextWriteFault('PRE_WRITE_ERROR');
  assert.equal((await c4.commit(t, '1')).kind, 'FAILED');
  assert.equal(JSON.parse((await mem4.readHistoryState())!).confirmedRevision, '1');
  assert.equal((await c4.commit(t, '1')).kind, 'COMMITTED');
  assert.equal(JSON.parse((await mem4.readHistoryState())!).confirmedRevision, '2');
  // Ordinary CONFLICT (stale expectedRevision='1' when disk has rev 2) -> CONFLICT, NOT STORAGE_UNAVAILABLE!
  assert.equal((await c4.commit(u, '1')).kind, 'CONFLICT');
  assert.equal(c4.storageHealth, 'AVAILABLE');
  // Confirmed rev '2' != unconfirmed target '3' (UNCERTAIN before rev 3 lands) -> recovers rev '2' cleanly!
  await mem4.writeTxState(
    JSON.stringify({
      version: 1,
      storageKey: mem4.storageKey,
      txId: 'tx_unconfirmed_target_3',
      state: 'UNCERTAIN',
      expectedRevision: '2',
      targetRevision: '3',
      priorSaveHistory: 'CONFIRMED_VALID',
      confirmedRevision: '2',
      requiresWriteVerification: false,
      createdAtMs: START,
      updatedAtMs: START,
      reason: 'Unconfirmed rev 3 attempt never landed',
    })
  );
  const recTargetDiff = await c4.loadSafe();
  assert.equal(recTargetDiff.kind, 'VALID');
  assert.equal(recTargetDiff.kind === 'VALID' ? recTargetDiff.revision : null, '2');
  assert.equal((await c4.commit(u, '2')).kind, 'COMMITTED');
});

test('[NODE/REWORK-06/R5-02-WRITE-CAPABILITY-CHECKPOINT-RECOVERY] Persistent slot write failure keeps frozen until real write capability recovers via zero-gain checkpoint commit', async () => {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r6.r502', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;

  // 1. VALID save frozen by persistent QUOTA_EXCEEDED on save_slot_* writes (reads/probe/txState all work!)
  const mem = new MemoryFilePort(10 * 1024 * 1024, 'r6_r502_quota_valid');
  let quotaFull = false;
  const quotaPort: FilePort = {
    kind: 'MEMORY',
    storageKey: mem.storageKey,
    probeStorage: () => mem.probeStorage(),
    readTxState: () => mem.readTxState(),
    writeTxState: (txt) => mem.writeTxState(txt),
    clearTxState: () => mem.clearTxState(),
    readHistoryState: () => mem.readHistoryState(),
    writeHistoryState: (txt) => mem.writeHistoryState(txt),
    clearHistoryState: () => mem.clearHistoryState(),
    read: (p) => mem.read(p),
    write: async (p, text) => {
      if (quotaFull && p.startsWith('save_slot_')) {
        throw new FilePortIoError('QUOTA_EXCEEDED', p, 'Simulated persistent disk quota full');
      }
      return mem.write(p, text);
    },
    remove: (p) => mem.remove(p),
    list: (d) => mem.list(d),
  };
  const coord = new SingleWriterSaveCoordinator(quotaPort);
  assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');

  quotaFull = true;
  const failCommit = await coord.commit(s2, '1');
  assert.equal(failCommit.kind, 'STORAGE_UNAVAILABLE');
  assert.equal(coord.storageHealth, 'STORAGE_UNAVAILABLE');
  const frozenMarker = JSON.parse((await mem.readTxState())!);
  assert.equal(frozenMarker.state, 'FROZEN');
  assert.equal(frozenMarker.requiresWriteVerification, true);

  // Recovery while quota fault STILL active -> MUST stay frozen with WRITE_CAPABILITY_UNAVAILABLE & readOnlyBackup!
  const recWhileFull = await coord.loadSafe();
  assert.equal(recWhileFull.kind, 'STORAGE_UNAVAILABLE');
  if (recWhileFull.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recWhileFull.recoveryClassification, 'WRITE_CAPABILITY_UNAVAILABLE');
    assert.equal(recWhileFull.readOnlyBackup?.revision, '1');
  }
  assert.equal(coord.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.ok(await mem.readTxState(), 'FROZEN marker must remain when write capability is still unavailable');
  assert.equal((await coord.commit(s2, '1')).kind, 'STORAGE_UNAVAILABLE');

  // Clear quota fault -> recovery executes Option A safe checkpoint commit (rev 1 -> rev 2, ZERO business gain!)
  quotaFull = false;
  const recAfterHeal = await coord.loadSafe();
  assert.equal(recAfterHeal.kind, 'VALID');
  if (recAfterHeal.kind === 'VALID') {
    assert.equal(recAfterHeal.revision, '2');
    const st = recAfterHeal.raw as SpikeGameState;
    assert.equal(st.gold, s1.gold, 'Recovery checkpoint MUST NOT add gold');
    assert.equal(st.cursorMs, s1.cursorMs, 'Recovery checkpoint MUST NOT advance game time');
    assert.equal(canonicalStringify(st), canonicalStringify(s1), 'Recovery checkpoint MUST preserve exact verified state');
  }
  assert.equal(await mem.readTxState(), null);
  assert.equal(coord.storageHealth, 'AVAILABLE');
  assert.equal(JSON.parse((await mem.readHistoryState())!).confirmedRevision, '2');

  // Subsequent normal commit advances cleanly rev 2 -> rev 3
  const nextCommit = await coord.commit(s2, '2');
  assert.equal(nextCommit.kind, 'COMMITTED');
  if (nextCommit.kind === 'COMMITTED') assert.equal(nextCommit.revision, '3');

  // 2. Confirmed EMPTY initial-create freeze by persistent QUOTA_EXCEEDED -> REWORK-07 R5-02:
  //    NEVER unfreezes via synthetic probe or without valid initialCommitState; requires persisting actual initial state!
  const memEmpty = new MemoryFilePort(10 * 1024 * 1024, 'r6_r502_quota_empty');
  let emptyQuotaFull = true;
  const emptyQuotaPort: FilePort = {
    kind: 'MEMORY',
    storageKey: memEmpty.storageKey,
    probeStorage: (opts) => memEmpty.probeStorage(opts),
    readTxState: () => memEmpty.readTxState(),
    writeTxState: (txt) => memEmpty.writeTxState(txt),
    clearTxState: () => memEmpty.clearTxState(),
    readHistoryState: () => memEmpty.readHistoryState(),
    writeHistoryState: (txt) => memEmpty.writeHistoryState(txt),
    clearHistoryState: () => memEmpty.clearHistoryState(),
    read: (p) => memEmpty.read(p),
    write: async (p, text) => {
      if (emptyQuotaFull && p.startsWith('save_slot_')) {
        throw new FilePortIoError('QUOTA_EXCEEDED', p, 'Initial create disk full');
      }
      return memEmpty.write(p, text);
    },
    remove: (p) => memEmpty.remove(p),
    list: (d) => memEmpty.list(d),
  };
  const coordEmpty = new SingleWriterSaveCoordinator(emptyQuotaPort);
  assert.equal((await coordEmpty.commit(s1, null)).kind, 'STORAGE_UNAVAILABLE');
  const emptyStillFullNoState = await coordEmpty.loadSafe();
  assert.equal(emptyStillFullNoState.kind, 'STORAGE_UNAVAILABLE');
  if (emptyStillFullNoState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(emptyStillFullNoState.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  const emptyStillFullWithState = await coordEmpty.loadSafe({ initialCommitState: s1 });
  assert.equal(emptyStillFullWithState.kind, 'STORAGE_UNAVAILABLE');
  if (emptyStillFullWithState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(emptyStillFullWithState.recoveryClassification, 'WRITE_CAPABILITY_UNAVAILABLE');
  }
  assert.ok(await memEmpty.readTxState(), 'FROZEN marker must stay while initial-save write fails');

  // Even after quota clears, loadSafe() WITHOUT initialCommitState MUST stay frozen (cannot substitute default!)
  emptyQuotaFull = false;
  const emptyHealedWithoutState = await coordEmpty.loadSafe();
  assert.equal(emptyHealedWithoutState.kind, 'STORAGE_UNAVAILABLE');
  if (emptyHealedWithoutState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(emptyHealedWithoutState.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  assert.ok(await memEmpty.readTxState(), 'Marker must stay frozen when no valid initialCommitState is supplied');

  // Supplying the actual valid initial state commits rev 1 via 3-slot + readback + history meta -> unfreezes!
  const emptyHealed = await coordEmpty.loadSafe({ initialCommitState: s1 });
  assert.equal(emptyHealed.kind, 'VALID');
  if (emptyHealed.kind === 'VALID') {
    assert.equal(emptyHealed.revision, '1');
    assert.equal(canonicalStringify(emptyHealed.raw), canonicalStringify(s1));
  }
  assert.equal(await memEmpty.readTxState(), null);
  assert.equal(JSON.parse((await memEmpty.readHistoryState())!).confirmedRevision, '1');
  assert.equal((await coordEmpty.commit(s2, '1')).kind, 'COMMITTED');
});

test('[NODE/REWORK-06/R5-03-RECOVERY-OWNER-CANCELLATION] Queued STANDARD & CONFIRM_CORRUPT_MARKER cancel with zero disk mutation when owner destroyed before mutation', async () => {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'epoch.r6.r503', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;

  // 1. CONFIRM_CORRUPT_MARKER waiting on exclusive lock when owner destroyed -> CANCELLED, corrupt marker & slots byte-identical!
  const mem1 = new MemoryFilePort(10 * 1024 * 1024, 'r6_r503_corrupt_cancel');
  const coord1 = new SingleWriterSaveCoordinator(mem1);
  assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
  const slot0Before = await mem1.read(SLOT_PATHS[0]);
  await mem1.writeTxState('{bad');
  const previewLoad = await coord1.loadSafe();
  assert.equal(previewLoad.kind, 'STORAGE_UNAVAILABLE');
  const preview = previewLoad.kind === 'STORAGE_UNAVAILABLE' ? previewLoad.corruptMarkerRecoveryPreview! : null;
  assert.ok(preview?.canConfirmRecovery);

  let releaseLock1!: () => void;
  let lockHeld1!: () => void;
  const heldPromise1 = new Promise<void>((r) => { lockHeld1 = r; });
  const holder1 = coord1.runExclusive(async () => {
    lockHeld1();
    await new Promise<void>((r) => { releaseLock1 = r; });
  });
  await heldPromise1;

  let ownerDestroyed1 = false;
  let mutationStarted1 = false;
  const queuedConfirm = coord1.recoverFromCorruptTxMarker(
    {
      expectedCorruptMarkerSha256: preview!.corruptMarkerSha256,
      expectedValidRevision: preview!.verifiedRevision!,
      expectedSlotsSnapshotSha256: preview!.slotsSnapshotSha256!,
    },
    {
      shouldCancelBeforeMutation: () => ownerDestroyed1,
      onMutationStarted: () => { mutationStarted1 = true; },
    }
  );
  // Destroy owner WHILE queued behind holder1
  ownerDestroyed1 = true;
  releaseLock1();
  await holder1;
  const cancelRes1 = await queuedConfirm;
  assert.equal(cancelRes1.kind, 'CANCELLED');
  assert.equal(mutationStarted1, false);
  assert.equal(await mem1.readTxState(), '{bad', 'Cancelled corrupt-marker recovery MUST NOT clear marker');
  assert.equal(await mem1.read(SLOT_PATHS[0]), slot0Before, 'Save slots MUST remain byte-identical');

  // 2. STANDARD loadSafe waiting on lock AND destroyed mid-scan before mutation -> CANCELLED, marker intact!
  const mem2 = new MemoryFilePort(10 * 1024 * 1024, 'r6_r503_std_cancel');
  const coord2 = new SingleWriterSaveCoordinator(mem2);
  assert.equal((await coord2.commit(s1, null)).kind, 'COMMITTED');
  const frozenJson = JSON.stringify({
    version: 1,
    storageKey: mem2.storageKey,
    txId: 'tx_r503_std',
    state: 'FROZEN',
    expectedRevision: '1',
    targetRevision: '2',
    priorSaveHistory: 'CONFIRMED_VALID',
    confirmedRevision: '1',
    requiresWriteVerification: false,
    createdAtMs: START,
    updatedAtMs: START,
    reason: 'Frozen for R5-03 std cancel test',
  });
  await mem2.writeTxState(frozenJson);

  let ownerDestroyed2 = false;
  let mutationStarted2 = false;
  const midScanCancel = await coord2.loadSafe({
    clearPendingTxMarker: true,
    hooks: {
      shouldCancelBeforeMutation: () => ownerDestroyed2,
      onMutationStarted: () => { mutationStarted2 = true; },
      beforeRecoveryBody: async () => {
        ownerDestroyed2 = true; // Destroyed after acquiring lock, before mutation!
      },
    },
  });
  assert.equal(midScanCancel.kind, 'CANCELLED');
  assert.equal(mutationStarted2, false);
  assert.equal(await mem2.readTxState(), frozenJson, 'Mid-scan cancelled recovery MUST leave FROZEN marker untouched');

  // 3. Destroyed AFTER onMutationStarted() -> transaction completes safely, onMutationStarted===true (not disguised as CANCELLED!)
  let ownerDestroyed3 = false;
  let mutationStarted3 = false;
  const afterStartPort: FilePort = {
    kind: 'MEMORY',
    storageKey: mem2.storageKey,
    probeStorage: () => mem2.probeStorage(),
    readTxState: () => mem2.readTxState(),
    writeTxState: (t) => mem2.writeTxState(t),
    clearTxState: async () => {
      // Simulate owner destroyed right during marker clear (after onMutationStarted!)
      ownerDestroyed3 = true;
      await mem2.clearTxState();
    },
    readHistoryState: () => mem2.readHistoryState(),
    writeHistoryState: (t) => mem2.writeHistoryState(t),
    read: (p) => mem2.read(p),
    write: (p, t) => mem2.write(p, t),
    remove: (p) => mem2.remove(p),
    list: (d) => mem2.list(d),
  };
  const coord3 = new SingleWriterSaveCoordinator(afterStartPort);
  const completedRes = await coord3.loadSafe({
    clearPendingTxMarker: true,
    hooks: {
      shouldCancelBeforeMutation: () => ownerDestroyed3,
      onMutationStarted: () => { mutationStarted3 = true; },
    },
  });
  assert.equal(mutationStarted3, true);
  assert.equal(completedRes.kind, 'VALID', 'Legitimately started mutation MUST complete safely and report VALID, not CANCELLED');
  assert.equal(await mem2.readTxState(), null);
});

test('[MOCK-WX/REWORK-06/R5-01-02-03-WECHAT-INVARIANTS] WeChat FilePort enforces monotonic history, truncated history detection, write-verified recovery & owner cancel', async () => {
  const prevWx = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWxWithUnlinkAndTruncate();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  try {
    const { s1, s2 } = makeWxStates();
    const port = new WeChatFilePort('r6_wx_invariants');
    const coord = new SingleWriterSaveCoordinator(port);

    // R5-01: commit rev 1 -> rev 2 -> __save_history__.json persisted & hidden from list()
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');
    assert.equal(mock.files.has('wxfile://usr/r6_wx_invariants/__save_history__.json'), true);
    assert.equal((await port.list()).includes('__save_history__.json'), false);

    // Partial IO on slot 1 (rev 2) -> FROZEN marker keeps confirmedRevision='2' -> slot 1 deleted -> rollback refused!
    mock.setFailReadOn('save_slot_1.json');
    const wxPartial = await coord.loadSafe();
    mock.setFailReadOn(null);
    assert.equal(wxPartial.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(JSON.parse((await port.readTxState())!).confirmedRevision, '2');
    const savedSlot1 = await port.read(SLOT_PATHS[1]);
    await port.remove(SLOT_PATHS[1]);
    const wxReg = await coord.loadSafe();
    assert.equal(wxReg.kind, 'STORAGE_UNAVAILABLE');
    if (wxReg.kind === 'STORAGE_UNAVAILABLE') {
      assert.equal(wxReg.recoveryClassification, 'REVISION_REGRESSION_PENDING_RECOVERY');
      assert.equal(wxReg.readOnlyBackup?.revision, '1');
    }

    // Restore slot 1 -> R5-03 owner cancel leaves marker intact -> live recovery succeeds rev 2
    await port.write(SLOT_PATHS[1], savedSlot1!);
    const wxCancel = await coord.loadSafe({
      clearPendingTxMarker: true,
      hooks: { shouldCancelBeforeMutation: () => true },
    });
    assert.equal(wxCancel.kind, 'CANCELLED');
    assert.ok(await port.readTxState(), 'Cancelled WeChat recovery must not clear marker');
    const wxRec = await coord.loadSafe();
    assert.equal(wxRec.kind, 'VALID');
    assert.equal(wxRec.kind === 'VALID' ? wxRec.revision : null, '2');

    // Truncated __save_history__.json write during commit MUST NOT return false COMMITTED!
    mock.setTruncateWriteOn('__save_history__.json');
    const truncHistCommit = await coord.commit(s2, '2');
    mock.setTruncateWriteOn(null);
    assert.equal(truncHistCommit.kind, 'UNCERTAIN', 'Truncated WeChat history metadata write must not return COMMITTED');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

// =========================================================================
// REWORK-07: Formal Regression Suite for Astra P2 Counterexamples (R5-02 & R5-03)
// =========================================================================

test('[NODE/REWORK-07/R5-02-EMPTY-CAPACITY-COUNTEREXAMPLE] Astra 2304/2552 constant-quota initial-create stays frozen until actual initial state persists cleanly', async () => {
  const seed = createInitialState({ saveEpoch: 'astra-capacity', startMs: 1_700_000_000_000, allowanceMs: 28_800_000 });
  const state = advanceOffline(seed, seed.cursorMs + 3_600_000).state;
  const nextState = advanceOffline(state, state.cursorMs + 60_000).state;

  // Measure actual full slot size on generous port (must remain > 2304, exact Astra fixture = 2552 bytes)
  const reference = new MemoryFilePort(10 * 1024 * 1024, 'r7_astra_size');
  const validRef = await new SingleWriterSaveCoordinator(reference).commit(state, null);
  assert.equal(validRef.kind, 'COMMITTED');
  const fullSlotBytes = Buffer.byteLength((await reference.read(SLOT_PATHS[0]))!);
  assert.ok(fullSlotBytes > 2304, `Expected real initial save > 2304 bytes, got ${fullSlotBytes}`);

  // 1. Exact Astra counterexample: constant 2304-byte quota where small synthetic probes (< 2304) succeed
  //    but real 2552-byte initial save fails -> loadSafe() (with OR without initialCommitState) MUST NOT unfreeze!
  const port2304 = new MemoryFilePort(2304, 'r7_astra_capacity_2304');
  const coord2304 = new SingleWriterSaveCoordinator(port2304);
  const first = await coord2304.commit(state, null);
  assert.equal(first.kind, 'STORAGE_UNAVAILABLE');
  const markerBefore = await port2304.readTxState();
  assert.ok(markerBefore, 'Failed initial save must persist FROZEN tx marker');

  // Verify small probe writes CAN succeed on this 2304-byte port (confirming small probes are insufficient)
  await port2304.write('small_probe.tmp', 'x'.repeat(2048));
  assert.equal(await port2304.read('small_probe.tmp'), 'x'.repeat(2048));
  await port2304.remove('small_probe.tmp');

  // Recovery without initialCommitState -> stays FROZEN (INITIAL_COMMIT_STATE_UNAVAILABLE), marker preserved!
  const recNoState = await coord2304.loadSafe();
  assert.equal(recNoState.kind, 'STORAGE_UNAVAILABLE');
  if (recNoState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recNoState.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  assert.ok(await port2304.readTxState(), 'Marker must remain when initialCommitState is absent');

  // Recovery WITH the real 2552-byte initial state under 2304 quota -> STILL stays FROZEN, marker preserved!
  const recWithState = await coord2304.loadSafe({ initialCommitState: state });
  assert.equal(recWithState.kind, 'STORAGE_UNAVAILABLE');
  if (recWithState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recWithState.recoveryClassification, 'WRITE_CAPABILITY_UNAVAILABLE');
  }
  assert.ok(await port2304.readTxState(), 'Marker must remain when real initial save exceeds quota');
  assert.deepEqual(await port2304.list(), [], 'No stray probe or slot files may remain');

  // Invalid initialCommitState -> rejected with 0 mutations & marker preserved!
  const recBadState = await coord2304.loadSafe({ initialCommitState: { invalid: true } as unknown as SpikeGameState });
  assert.equal(recBadState.kind, 'STORAGE_UNAVAILABLE');
  if (recBadState.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(recBadState.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  assert.ok(await port2304.readTxState());

  // Retry commit while still frozen -> STORAGE_UNAVAILABLE (never falsely unfrozen!)
  const retry = await coord2304.commit(state, null);
  assert.equal(retry.kind, 'STORAGE_UNAVAILABLE');

  // 2. Dynamic quota port: 2304 bytes -> fails & stays frozen -> raise quota to 64KB -> actual initial save persists rev 1 -> next commit rev 2 -> fresh coordinator reloads rev 2!
  const backing = new MemoryFilePort(64 * 1024, 'r7_astra_capacity_dynamic');
  let activeLimit = 2304;
  const dynamicQuotaPort: FilePort = {
    kind: 'MEMORY',
    storageKey: backing.storageKey,
    probeStorage: (opts) => backing.probeStorage(opts),
    readTxState: () => backing.readTxState(),
    writeTxState: (t) => backing.writeTxState(t),
    clearTxState: () => backing.clearTxState(),
    readHistoryState: () => backing.readHistoryState(),
    writeHistoryState: (t) => backing.writeHistoryState(t),
    clearHistoryState: () => backing.clearHistoryState(),
    read: (p) => backing.read(p),
    write: async (p, text) => {
      const files = await backing.list();
      let otherBytes = 0;
      for (const f of files) {
        if (f !== p) otherBytes += Buffer.byteLength((await backing.read(f)) ?? '');
      }
      if (otherBytes + Buffer.byteLength(text) > activeLimit) {
        throw new FilePortIoError('QUOTA_EXCEEDED', p, `Exceeded dynamic quota ${activeLimit} bytes`);
      }
      return backing.write(p, text);
    },
    remove: (p) => backing.remove(p),
    list: (d) => backing.list(d),
  };
  const coordDyn = new SingleWriterSaveCoordinator(dynamicQuotaPort);
  assert.equal((await coordDyn.commit(state, null)).kind, 'STORAGE_UNAVAILABLE');
  assert.equal((await coordDyn.loadSafe({ initialCommitState: state })).kind, 'STORAGE_UNAVAILABLE');

  // Quota recovers -> loadSafe({ initialCommitState: state }) persists exact state at rev 1 (zero gain/time change)
  activeLimit = 64 * 1024;
  const recovered = await coordDyn.loadSafe({ initialCommitState: state });
  assert.equal(recovered.kind, 'VALID');
  if (recovered.kind === 'VALID') {
    assert.equal(recovered.revision, '1');
    assert.equal(canonicalStringify(recovered.raw), canonicalStringify(state));
    assert.equal((recovered.raw as SpikeGameState).gold, state.gold);
    assert.equal((recovered.raw as SpikeGameState).cursorMs, state.cursorMs);
  }
  assert.equal(await backing.readTxState(), null, 'Tx marker must clear after verified initial-save commit');
  assert.equal(JSON.parse((await backing.readHistoryState())!).confirmedRevision, '1');

  // Subsequent normal commit advances cleanly rev 1 -> rev 2, and fresh coordinator reloads rev 2
  const c2 = await coordDyn.commit(nextState, '1');
  assert.equal(c2.kind, 'COMMITTED');
  if (c2.kind === 'COMMITTED') assert.equal(c2.revision, '2');
  const freshReload = await new SingleWriterSaveCoordinator(dynamicQuotaPort).loadSafe();
  assert.equal(freshReload.kind, 'VALID');
  if (freshReload.kind === 'VALID') {
    assert.equal(freshReload.revision, '2');
    assert.equal(canonicalStringify(freshReload.raw), canonicalStringify(nextState));
  }
});

test('[NODE/REWORK-07/R5-03-PRE-PROBE-CANCELLATION-BOUNDARY] Pre-probe cancellation executes 0 probe writes, post-start probe records mutation truthfully, and probe failure cleans up', async () => {
  const START = 1_700_000_000_000;
  const s1 = advanceOffline(createInitialState({ saveEpoch: 'epoch.r7.r503', startMs: START, allowanceMs: 3_600_000 }), START + 60_000).state;

  // Build an async probe-capable FilePort mirroring BrowserFilePort's openDb -> check -> put/read/delete boundary
  function createAsyncProbePort(ns: string) {
    const inner = new MemoryFilePort(10 * 1024 * 1024, ns);
    const probeOps: string[] = [];
    let probeStoreValue: string | null = null;
    let pauseOpen: (() => Promise<void>) | null = null;
    let onPutStarted: (() => void) | null = null;
    let failReadBack = false;

    const port: FilePort = {
      kind: 'MEMORY',
      storageKey: inner.storageKey,
      probeStorage: async (options) => {
        if (options?.shouldCancelBeforeMutation?.()) {
          return { available: false, cancelled: true, mutated: false, reason: 'cancelled before open' };
        }
        if (pauseOpen) {
          await pauseOpen();
        }
        if (options?.shouldCancelBeforeMutation?.()) {
          return { available: false, cancelled: true, mutated: false, reason: 'cancelled after open before put' };
        }
        let mutated = true;
        options?.onMutationStarted?.();
        let wrote = false;
        let opErr: unknown = null;
        try {
          probeOps.push('put');
          probeStoreValue = '1';
          wrote = true;
          onPutStarted?.();
          await Promise.resolve();
          if (failReadBack) {
            throw new Error('Injected probe readback failure');
          }
          if (probeStoreValue !== '1') {
            throw new Error('Probe readback mismatch');
          }
        } catch (err) {
          opErr = err;
        }
        if (wrote) {
          probeOps.push('delete');
          probeStoreValue = null;
        }
        if (opErr !== null) {
          return { available: false, mutated, reason: opErr instanceof Error ? opErr.message : String(opErr) };
        }
        return { available: true, mutated, reason: null };
      },
      readTxState: () => inner.readTxState(),
      writeTxState: (t) => inner.writeTxState(t),
      clearTxState: () => inner.clearTxState(),
      readHistoryState: () => inner.readHistoryState(),
      writeHistoryState: (t) => inner.writeHistoryState(t),
      clearHistoryState: () => inner.clearHistoryState(),
      read: (p) => inner.read(p),
      write: (p, t) => inner.write(p, t),
      remove: (p) => inner.remove(p),
      list: (d) => inner.list(d),
    };
    return {
      inner,
      port,
      probeOps,
      getProbeStoreValue: () => probeStoreValue,
      setPauseOpen: (fn: (() => Promise<void>) | null) => { pauseOpen = fn; },
      setOnPutStarted: (fn: (() => void) | null) => { onPutStarted = fn; },
      setFailReadBack: (v: boolean) => { failReadBack = v; },
    };
  }

  // 1. STANDARD & CONFIRM_CORRUPT_MARKER: owner destroyed during async openDb BEFORE probe put -> 0 put, 0 delete!
  const envStd = createAsyncProbePort('r7_r503_std');
  const coordStd = new SingleWriterSaveCoordinator(envStd.port);
  assert.equal((await coordStd.commit(s1, null)).kind, 'COMMITTED');
  const slotBefore = await envStd.inner.read(SLOT_PATHS[0]);
  const histBefore = await envStd.inner.readHistoryState();
  const frozenMarker = JSON.stringify({
    version: 1,
    storageKey: envStd.inner.storageKey,
    txId: 'tx_r7_std',
    state: 'FROZEN',
    expectedRevision: '1',
    targetRevision: '2',
    priorSaveHistory: 'CONFIRMED_VALID',
    confirmedRevision: '1',
    requiresWriteVerification: false,
    createdAtMs: START,
    updatedAtMs: START,
    reason: 'r7 pre-probe cancel test',
  });
  await envStd.inner.writeTxState(frozenMarker);
  envStd.probeOps.length = 0;

  let destroyedStd = false;
  let mutatedStd = false;
  envStd.setPauseOpen(async () => {
    destroyedStd = true; // Destroyed while awaiting async DB open, before probe put!
  });
  const resStd = await coordStd.loadSafe({
    clearPendingTxMarker: true,
    hooks: {
      shouldCancelBeforeMutation: () => destroyedStd,
      onMutationStarted: () => { mutatedStd = true; },
    },
  });
  assert.equal(resStd.kind, 'CANCELLED');
  if (resStd.kind === 'CANCELLED') assert.equal(resStd.persistentMutationOccurred, false);
  assert.equal(mutatedStd, false);
  assert.deepEqual(envStd.probeOps, [], 'Pre-probe cancel MUST execute 0 put and 0 delete ops');
  assert.equal(await envStd.inner.readTxState(), frozenMarker);
  assert.equal(await envStd.inner.read(SLOT_PATHS[0]), slotBefore);
  assert.equal(await envStd.inner.readHistoryState(), histBefore);

  // CONFIRM_CORRUPT_MARKER destroyed during async openDb before probe put -> 0 put, 0 delete!
  await envStd.inner.writeTxState('{bad');
  envStd.setPauseOpen(null);
  const previewRes = await coordStd.loadSafe();
  assert.equal(previewRes.kind, 'STORAGE_UNAVAILABLE');
  const preview = previewRes.kind === 'STORAGE_UNAVAILABLE' ? previewRes.corruptMarkerRecoveryPreview! : null;
  assert.ok(preview?.canConfirmRecovery);
  envStd.probeOps.length = 0;

  let destroyedConfirm = false;
  let mutatedConfirm = false;
  envStd.setPauseOpen(async () => {
    destroyedConfirm = true;
  });
  const resConfirm = await coordStd.recoverFromCorruptTxMarker(
    {
      expectedCorruptMarkerSha256: preview!.corruptMarkerSha256,
      expectedValidRevision: preview!.verifiedRevision!,
      expectedSlotsSnapshotSha256: preview!.slotsSnapshotSha256!,
    },
    {
      shouldCancelBeforeMutation: () => destroyedConfirm,
      onMutationStarted: () => { mutatedConfirm = true; },
    }
  );
  assert.equal(resConfirm.kind, 'CANCELLED');
  if (resConfirm.kind === 'CANCELLED') assert.equal(resConfirm.persistentMutationOccurred, false);
  assert.equal(mutatedConfirm, false);
  assert.deepEqual(envStd.probeOps, [], 'CONFIRM pre-probe cancel MUST execute 0 put and 0 delete ops');
  assert.equal(await envStd.inner.readTxState(), '{bad');

  // 2. Owner destroyed AFTER probe put legitimately started -> probe cleans up (put+delete),
  //    aborts before save-domain mutation, AND sets persistentMutationOccurred === true (never disguised as unexecuted!)
  envStd.setPauseOpen(null);
  envStd.probeOps.length = 0;
  let destroyedAfterPut = false;
  let mutatedAfterPut = false;
  envStd.setOnPutStarted(() => {
    destroyedAfterPut = true;
  });
  const resAfterPut = await coordStd.recoverFromCorruptTxMarker(
    {
      expectedCorruptMarkerSha256: preview!.corruptMarkerSha256,
      expectedValidRevision: preview!.verifiedRevision!,
      expectedSlotsSnapshotSha256: preview!.slotsSnapshotSha256!,
    },
    {
      shouldCancelBeforeMutation: () => destroyedAfterPut,
      onMutationStarted: () => { mutatedAfterPut = true; },
    }
  );
  assert.equal(resAfterPut.kind, 'CANCELLED');
  if (resAfterPut.kind === 'CANCELLED') {
    assert.equal(resAfterPut.persistentMutationOccurred, true, 'Must truthfully report that probe mutation occurred');
  }
  assert.equal(mutatedAfterPut, true);
  assert.deepEqual(envStd.probeOps, ['put', 'delete']);
  assert.equal(envStd.getProbeStoreValue(), null, 'Probe key must be cleaned up');
  assert.equal(await envStd.inner.readTxState(), '{bad', 'Corrupt marker must stay untouched after post-probe abort');

  // 3. Probe readback exception cleans up probe key and returns STORAGE_UNAVAILABLE (PROBE_FAILED)
  envStd.setOnPutStarted(null);
  envStd.setFailReadBack(true);
  envStd.probeOps.length = 0;
  const resProbeFail = await coordStd.loadSafe();
  assert.equal(resProbeFail.kind, 'STORAGE_UNAVAILABLE');
  if (resProbeFail.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(resProbeFail.recoveryClassification, 'PROBE_FAILED');
  }
  assert.deepEqual(envStd.probeOps, ['put', 'delete'], 'Probe readback error must still clean up probe key');
  assert.equal(envStd.getProbeStoreValue(), null);

  // 4. WeChatFilePort probeStorage cancels before mkdirSync when owner is already destroyed (0 FS mutations)
  const prevWx = (globalThis as Record<string, unknown>).wx;
  let mkdirCalls = 0;
  const mockWx = {
    __FE000_MOCK__: true,
    env: { USER_DATA_PATH: 'wxfile://usr' },
    getFileSystemManager: () => ({
      accessSync: () => {
        throw new Error('ENOENT');
      },
      mkdirSync: () => {
        mkdirCalls += 1;
      },
      readFileSync: () => '',
      writeFileSync: () => {},
      unlinkSync: () => {},
      readdirSync: () => [],
    }),
  };
  (globalThis as Record<string, unknown>).wx = mockWx;
  try {
    const wxPort = new WeChatFilePort('r7_wx_preprobe_cancel');
    mkdirCalls = 0; // Reset after constructor probe
    let wxMutated = false;
    const wxProbeRes = wxPort.probeStorage({
      shouldCancelBeforeMutation: () => true,
      onMutationStarted: () => { wxMutated = true; },
    });
    assert.equal(wxProbeRes.cancelled, true);
    assert.equal(wxProbeRes.mutated, false);
    assert.equal(wxMutated, false);
    assert.equal(mkdirCalls, 0, 'Cancelled WeChat probe must not call mkdirSync');
  } finally {
    (globalThis as Record<string, unknown>).wx = prevWx;
  }
});

// =========================================================================
// REWORK-08: Formal Regression for R5-02 Cross-Refresh Initial-State Guard
// =========================================================================

test('[NODE/REWORK-08/R5-02-CROSS-REFRESH-INITIAL-STATE-UNAVAILABLE] Lost pending initial state across reload/new coordinator stays frozen (INITIAL_COMMIT_STATE_UNAVAILABLE) without substituting default state', async () => {
  const START = 1_700_000_000_000;
  const bootDefault = createInitialState({
    saveEpoch: 'fe000-lifecycle-epoch',
    startMs: START,
    allowanceMs: 8 * 3600 * 1000,
  });
  const firstHideState = advanceOffline(bootDefault, START + 60_000).state;
  const secondHideState = advanceOffline(firstHideState, firstHideState.cursorMs + 60_000).state;
  assert.equal(firstHideState.gold, '31');
  assert.equal(firstHideState.cursorMs, START + 60_000);

  // 1. First save fails on quota -> FROZEN marker persisted, 0 slots written
  const backing = new MemoryFilePort(10 * 1024 * 1024, 'r8_cross_refresh');
  let failSlotWrite = true;
  const port: FilePort = {
    kind: 'MEMORY',
    storageKey: backing.storageKey,
    probeStorage: (opts) => backing.probeStorage(opts),
    readTxState: () => backing.readTxState(),
    writeTxState: (t) => backing.writeTxState(t),
    clearTxState: () => backing.clearTxState(),
    readHistoryState: () => backing.readHistoryState(),
    writeHistoryState: (t) => backing.writeHistoryState(t),
    clearHistoryState: () => backing.clearHistoryState(),
    read: (p) => backing.read(p),
    write: async (p, text) => {
      if (failSlotWrite && p.startsWith('save_slot_')) {
        throw new FilePortIoError('QUOTA_EXCEEDED', p, 'Simulated first-save quota failure');
      }
      return backing.write(p, text);
    },
    remove: (p) => backing.remove(p),
    list: (d) => backing.list(d),
  };

  const coord1 = new SingleWriterSaveCoordinator(port);
  const firstFail = await coord1.commit(firstHideState, null);
  assert.equal(firstFail.kind, 'STORAGE_UNAVAILABLE');
  const markerBefore = await backing.readTxState();
  assert.ok(markerBefore);
  assert.deepEqual(await backing.list(), []);

  // 2. Simulate page reload (storage fault cleared, new coordinator, memory pendingInitialCommitState lost -> null)
  failSlotWrite = false;
  const coordAfterReload1 = new SingleWriterSaveCoordinator(port);
  const bootAfterReload1 = await coordAfterReload1.loadSafe({ clearPendingTxMarker: false });
  assert.equal(bootAfterReload1.kind, 'STORAGE_UNAVAILABLE');
  if (bootAfterReload1.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(bootAfterReload1.recoveryClassification, 'PENDING_RECOVERY_REQUIRED');
  }

  // Explicit recovery without original pending state MUST stay frozen with INITIAL_COMMIT_STATE_UNAVAILABLE!
  const rec1 = await coordAfterReload1.loadSafe({ clearPendingTxMarker: true, initialCommitState: null });
  assert.equal(rec1.kind, 'STORAGE_UNAVAILABLE');
  if (rec1.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(rec1.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  assert.equal(coordAfterReload1.storageHealth, 'STORAGE_UNAVAILABLE');
  assert.equal(await backing.readTxState(), markerBefore, 'Pending tx marker must remain intact');
  assert.equal(await backing.readHistoryState(), null, 'No default revision 1 history may be confirmed');
  assert.deepEqual(await backing.list(), [], 'No default save slot may be written');

  // Repeated recovery clicks / second reload (third coordinator) MUST NOT bypass freeze!
  const rec2 = await coordAfterReload1.loadSafe({ clearPendingTxMarker: true, initialCommitState: null });
  assert.equal(rec2.kind, 'STORAGE_UNAVAILABLE');
  if (rec2.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(rec2.recoveryClassification, 'INITIAL_COMMIT_STATE_UNAVAILABLE');
  }
  const coordAfterReload2 = new SingleWriterSaveCoordinator(port);
  const bootAfterReload2 = await coordAfterReload2.loadSafe({ clearPendingTxMarker: false });
  assert.equal(bootAfterReload2.kind, 'STORAGE_UNAVAILABLE');
  if (bootAfterReload2.kind === 'STORAGE_UNAVAILABLE') {
    assert.equal(bootAfterReload2.recoveryClassification, 'PENDING_RECOVERY_REQUIRED');
  }
  assert.equal(await backing.readTxState(), markerBefore);
  assert.deepEqual(await backing.list(), []);

  // 3. Same-session recovery WITH the exact original pending state persists 31 gold & +60s cursor at rev 1, then rev 2!
  const recOriginal = await coordAfterReload2.loadSafe({
    clearPendingTxMarker: true,
    initialCommitState: firstHideState,
  });
  assert.equal(recOriginal.kind, 'VALID');
  if (recOriginal.kind === 'VALID') {
    assert.equal(recOriginal.revision, '1');
    assert.equal((recOriginal.raw as SpikeGameState).gold, '31');
    assert.equal((recOriginal.raw as SpikeGameState).cursorMs, START + 60_000);
    assert.equal(canonicalStringify(recOriginal.raw), canonicalStringify(firstHideState));
  }
  assert.equal(await backing.readTxState(), null);
  assert.equal(JSON.parse((await backing.readHistoryState())!).confirmedRevision, '1');
  const nextCommit = await coordAfterReload2.commit(secondHideState, '1');
  assert.equal(nextCommit.kind, 'COMMITTED');
  if (nextCommit.kind === 'COMMITTED') assert.equal(nextCommit.revision, '2');

  // 4. Normal clean new domain (no marker, no history) still boots EMPTY & commits rev 1 cleanly!
  const cleanPort = new MemoryFilePort(10 * 1024 * 1024, 'r8_clean_new_domain');
  const cleanCoord = new SingleWriterSaveCoordinator(cleanPort);
  assert.equal((await cleanCoord.loadSafe({ clearPendingTxMarker: false })).kind, 'EMPTY');
  const cleanCommit = await cleanCoord.commit(firstHideState, null);
  assert.equal(cleanCommit.kind, 'COMMITTED');
  if (cleanCommit.kind === 'COMMITTED') assert.equal(cleanCommit.revision, '1');
});
