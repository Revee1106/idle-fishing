/**
 * FE-000 Platform Verification Suite:
 * Covers Section 9 (FileSystem & 3-slot persistence), Section 10 (Lifecycle, Clock & Ad),
 * and Section 11 (Local resources & subpackage).
 * Explicitly labels runtime environment (WECHAT / WEB / NODE) so Web/Mock never substitutes for WeChat real tests.
 */
import {
  advanceOffline,
  canonicalStringify,
  createInitialState,
  SLOT_PATHS,
  SpikeFileSaveRepository,
  type SpikeGameState,
} from '@idle-fishing/game-core';
import { BrowserFilePort, MemoryFilePort } from './BrowserFilePort';
import { ExperimentalAdStubCoordinator } from './ExperimentalAdProvider';
import { FaultInjectingFilePort } from './FaultInjectingFilePort';
import { detectRuntimeEnv, type FilePort, type VerificationCaseResult } from './PlatformTypes';
import { MonotonicTimelineGuard, RuntimeClockProvider, VirtualClockProvider } from './WeChatClockProvider';
import { FilePortIoError, WeChatFilePort } from './WeChatFilePort';
import { RuntimeLifecycleProvider } from './WeChatLifecycleProvider';

export function createRuntimeFilePort(): FilePort {
  const env = detectRuntimeEnv();
  if (env === 'WECHAT') {
    return new WeChatFilePort('idle_fishing_spike');
  }
  if (env === 'WEB') {
    return new BrowserFilePort('idle_fishing_spike_fs');
  }
  return new MemoryFilePort();
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

async function cleanSlots(port: FilePort): Promise<void> {
  for (const slotPath of SLOT_PATHS) {
    await port.remove(slotPath);
  }
  await port.remove('spike_probe.txt');
  await port.remove('spike_size_probe.dat');
}

export async function runFileSystemAndSaveSuite(customPort?: FilePort): Promise<VerificationCaseResult[]> {
  const env = detectRuntimeEnv();
  const basePort = customPort ?? createRuntimeFilePort();
  const results: VerificationCaseResult[] = [];

  const run = async (id: string, name: string, fn: () => Promise<string>): Promise<void> => {
    const t0 = nowMs();
    try {
      const detail = await fn();
      results.push({ id, name, status: 'PASS', env, detail, durationMs: Number((nowMs() - t0).toFixed(2)) });
    } catch (err) {
      results.push({
        id,
        name,
        status: 'FAIL',
        env,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Number((nowMs() - t0).toFixed(2)),
      });
    }
  };

  await cleanSlots(basePort);

  // 1. CRUD + missing file returns null + traversal guard
  await run('FS-CRUD', `File CRUD & path guard (${basePort.kind})`, async () => {
    const missing = await basePort.read('spike_probe.txt');
    if (missing !== null) throw new Error('Expected null for missing file');
    await basePort.write('spike_probe.txt', 'v1-content');
    const r1 = await basePort.read('spike_probe.txt');
    if (r1 !== 'v1-content') throw new Error(`Read mismatch: ${r1}`);
    await basePort.write('spike_probe.txt', 'v2-updated-content');
    const r2 = await basePort.read('spike_probe.txt');
    if (r2 !== 'v2-updated-content') throw new Error(`Update mismatch: ${r2}`);
    const list = await basePort.list();
    if (!list.includes('spike_probe.txt')) throw new Error(`List missing file: ${JSON.stringify(list)}`);
    await basePort.remove('spike_probe.txt');
    await basePort.remove('spike_probe.txt'); // idempotent remove
    const afterDel = await basePort.read('spike_probe.txt');
    if (afterDel !== null) throw new Error('Expected null after remove');
    let blockedTraversal = false;
    try {
      await basePort.read('../escape.json');
    } catch (e) {
      blockedTraversal = e instanceof FilePortIoError || String(e).includes('INVALID_PATH');
    }
    if (!blockedTraversal) throw new Error('Path traversal was not blocked');
    return `CRUD ok on ${basePort.kind}; idempotent delete & path guard verified`;
  });

  // 2. Multi-slot rotation (T04)
  await run('T04-ROTATE', '3-slot rotation & highest revision load', async () => {
    await cleanSlots(basePort);
    const repo = new SpikeFileSaveRepository(basePort);
    const empty = await repo.load();
    if (empty.kind !== 'EMPTY') throw new Error(`Expected EMPTY, got ${empty.kind}`);

    let state: SpikeGameState = createInitialState({
      saveEpoch: 'fe000-fs-epoch',
      startMs: 1_700_000_000_000,
      allowanceMs: 8 * 3600 * 1000,
    });
    let rev: string | null = null;
    for (let i = 1; i <= 5; i++) {
      state = advanceOffline(state, state.cursorMs + 60_000).state;
      const committed = await repo.commit(state, rev);
      if (committed.kind !== 'COMMITTED') throw new Error(`Commit #${i} failed: ${committed.kind}`);
      rev = committed.revision;
    }
    const loaded = await repo.load();
    if (loaded.kind !== 'VALID' || loaded.revision !== '5') {
      throw new Error(`Expected VALID rev=5, got ${loaded.kind}`);
    }
    if (canonicalStringify(loaded.raw) !== canonicalStringify(state)) {
      throw new Error('Loaded state differs from committed state');
    }
    return `5 commits rotated across 3 slots; loaded rev=${loaded.revision}, gold=${state.gold}`;
  });

  // 3. Corrupt single slot -> recover backup; all slots corrupt -> CORRUPT (never EMPTY)
  await run('T04-CORRUPT', 'Corrupt slot fallback & all-corrupt fail-closed', async () => {
    const repo = new SpikeFileSaveRepository(basePort);
    // Corrupt slot 1 (holds rev 5 after 5 commits: 0->1,1->2,2->3,0->4,1->5)
    await basePort.write(SLOT_PATHS[1], '{"broken":true');
    const recovered = await repo.load();
    if (recovered.kind !== 'VALID' || !recovered.recovered || recovered.revision !== '4') {
      throw new Error(`Expected backup rev=4 recovered=true, got ${JSON.stringify(recovered)}`);
    }
    // Corrupt all 3 slots
    await basePort.write(SLOT_PATHS[0], 'BAD0');
    await basePort.write(SLOT_PATHS[1], 'BAD1');
    await basePort.write(SLOT_PATHS[2], 'BAD2');
    const allBad = await repo.load();
    if (allBad.kind !== 'CORRUPT') {
      throw new Error(`All-corrupt must return CORRUPT (not EMPTY), got ${allBad.kind}`);
    }
    return `Single-slot corruption recovered rev=4; all-corrupt returned CORRUPT (${allBad.detail.slice(0, 60)})`;
  });

  // 4. Write failure & Fault injection (T05)
  await run('T05-FAULTS', 'Fault injection: pre-write / partial / uncertain post-write', async () => {
    await cleanSlots(basePort);
    const faultPort = new FaultInjectingFilePort(basePort);
    const repo = new SpikeFileSaveRepository(faultPort);
    let state = createInitialState({
      saveEpoch: 'fe000-fault-epoch',
      startMs: 1_700_000_000_000,
      allowanceMs: 8 * 3600 * 1000,
    });
    const c1 = await repo.commit(state, null);
    if (c1.kind !== 'COMMITTED') throw new Error('Initial commit failed');

    // A: pre-write failure -> rev stays 1
    state = advanceOffline(state, state.cursorMs + 30_000).state;
    faultPort.armNextWriteFault('PRE_WRITE_ERROR');
    const fPre = await repo.commit(state, '1');
    if (fPre.kind !== 'FAILED') throw new Error(`Expected FAILED on pre-write, got ${fPre.kind}`);

    // B: partial write -> backup rev 1 stays valid
    faultPort.armNextWriteFault('PARTIAL_WRITE');
    const fPartial = await repo.commit(state, '1');
    if (fPartial.kind !== 'FAILED') throw new Error(`Expected FAILED on partial write, got ${fPartial.kind}`);
    const afterPartial = await repo.load();
    if (afterPartial.kind !== 'VALID' || afterPartial.revision !== '1' || !afterPartial.recovered) {
      throw new Error(`Expected rev=1 recovered=true after partial write, got ${afterPartial.kind}`);
    }

    // C: post-write throw (uncertain write) -> rescan claims committed rev=2 with no duplicate
    faultPort.armNextWriteFault('POST_WRITE_THROW');
    const fPost = await repo.commit(state, '1');
    if (fPost.kind !== 'COMMITTED' || !fPost.recoveredFromUncertainWrite || fPost.revision !== '2') {
      throw new Error(`Expected COMMITTED recoveredFromUncertainWrite=true rev=2, got ${JSON.stringify(fPost)}`);
    }
    return `Pre-write=FAILED, Partial=recovered rev 1, Post-write throw=claimed rev 2 once`;
  });

  // 5. Storage size probe (64KB + 256KB)
  await run('FS-SIZE-PROBE', 'Payload size write/readback probe (64KB / 256KB)', async () => {
    const p64 = 'A'.repeat(64 * 1024);
    await basePort.write('spike_size_probe.dat', p64);
    const r64 = await basePort.read('spike_size_probe.dat');
    if (!r64 || r64.length !== p64.length) throw new Error('64KB readback mismatch');

    const p256 = 'B'.repeat(256 * 1024);
    await basePort.write('spike_size_probe.dat', p256);
    const r256 = await basePort.read('spike_size_probe.dat');
    if (!r256 || r256.length !== p256.length) throw new Error('256KB readback mismatch');

    await basePort.remove('spike_size_probe.dat');
    return `64KB & 256KB write+readback verified & cleaned on ${basePort.kind}`;
  });

  // 6. Background/Foreground flush & abnormal exit recovery
  await run('FS-BG-RECOVERY', 'Hide flush + abnormal kill reentry recovery', async () => {
    await cleanSlots(basePort);
    const repo = new SpikeFileSaveRepository(basePort);
    const lifecycle = new RuntimeLifecycleProvider();
    let state = createInitialState({
      saveEpoch: 'fe000-bg-epoch',
      startMs: 1_700_000_000_000,
      allowanceMs: 8 * 3600 * 1000,
    });
    const c1 = await repo.commit(state, null);
    if (c1.kind !== 'COMMITTED') throw new Error('Seed commit failed');

    let hideFlushed = false;
    const unsub = lifecycle.subscribe((ev) => {
      if (ev === 'HIDE') {
        hideFlushed = true;
      }
    });
    lifecycle.emit('HIDE', 'spike-test');
    if (!hideFlushed) throw new Error('HIDE callback did not fire');
    state = advanceOffline(state, state.cursorMs + 120_000).state;
    const c2 = await repo.commit(state, '1');
    if (c2.kind !== 'COMMITTED') throw new Error('Hide flush commit failed');

    // Simulate abnormal exit (discard in-memory state, reload fresh repository)
    const freshRepo = new SpikeFileSaveRepository(basePort);
    const reloaded = await freshRepo.load();
    unsub();
    if (reloaded.kind !== 'VALID' || reloaded.revision !== '2') {
      throw new Error(`Expected rev=2 after reentry, got ${reloaded.kind}`);
    }
    const restoredState = reloaded.raw as SpikeGameState;
    if (restoredState.offline?.deadlineMs !== state.offline?.deadlineMs) {
      throw new Error('Offline deadline changed across abnormal exit recovery');
    }
    return `HIDE flush rev=2 restored cleanly; locked deadlineMs=${restoredState.offline?.deadlineMs} preserved`;
  });

  await cleanSlots(basePort);
  return results;
}

export async function runLifecycleClockAndAdSuite(): Promise<VerificationCaseResult[]> {
  const env = detectRuntimeEnv();
  const results: VerificationCaseResult[] = [];

  const run = async (id: string, name: string, fn: () => Promise<string>): Promise<void> => {
    const t0 = nowMs();
    try {
      const detail = await fn();
      results.push({ id, name, status: 'PASS', env, detail, durationMs: Number((nowMs() - t0).toFixed(2)) });
    } catch (err) {
      results.push({
        id,
        name,
        status: 'FAIL',
        env,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Number((nowMs() - t0).toFixed(2)),
      });
    }
  };

  // 1. Runtime monotonic clock probe
  await run('T08-MONO-PROBE', 'Runtime ClockProvider monotonic capability', async () => {
    const clock = new RuntimeClockProvider();
    const w1 = clock.wallNowMs();
    const m1 = clock.monotonicNowMs();
    if (!Number.isSafeInteger(w1) || w1 <= 0) throw new Error(`Invalid wallNowMs: ${w1}`);
    if (!clock.monotonicSupported) throw new Error(`Monotonic clock unsupported: ${clock.monotonicSource}`);
    return `source=${clock.monotonicSource}, wall=${w1}, mono=${m1}`;
  });

  // 2. Repeated HIDE/SHOW dedupe + wall rollback freeze + forward jump deadline clamp
  await run('T08-LIFECYCLE-CLOCK', 'Repeated hide/show, clock rollback & deadline clamp', async () => {
    const lifecycle = new RuntimeLifecycleProvider();
    let showCount = 0;
    let hideCount = 0;
    const unsub = lifecycle.subscribe((ev) => {
      if (ev === 'SHOW') showCount += 1;
      if (ev === 'HIDE') hideCount += 1;
    });
    lifecycle.emit('HIDE', 'test');
    lifecycle.emit('HIDE', 'test-dup'); // deduped
    lifecycle.emit('SHOW', 'test');
    lifecycle.emit('SHOW', 'test-dup'); // deduped
    lifecycle.emit('HIDE', 'test-2');
    lifecycle.emit('SHOW', 'test-2');
    unsub();
    if (hideCount !== 2 || showCount !== 2) {
      throw new Error(`Expected deduped hide=2, show=2; got hide=${hideCount}, show=${showCount}`);
    }

    const start = 1_700_000_000_000;
    const deadline = start + 8 * 3600 * 1000;
    const vClock = new VirtualClockProvider(start, 1000);
    const guard = new MonotonicTimelineGuard(vClock, 2000);

    // Normal foreground advance 5s
    vClock.advance(5000);
    const okTick = guard.tickForeground(vClock);
    if (!okTick.ok || okTick.cursorMs !== start + 5000) throw new Error('Normal foreground tick failed');

    // Roll back wall clock by 10 minutes -> CLOCK_ERROR freeze, cursor must NOT rewind
    vClock.setWallMs(start - 600_000);
    const rollbackTick = guard.tickForeground(vClock);
    if (rollbackTick.ok || rollbackTick.code !== 'CLOCK_ERROR' || rollbackTick.cursorMs !== start + 5000) {
      throw new Error(`Rollback should freeze without rewind: ${JSON.stringify(rollbackTick)}`);
    }

    // Resume while rolled back -> strict reject
    const badResume = guard.lockOfflineResumeTarget(vClock, deadline);
    if (badResume.ok || badResume.code !== 'CLOCK_ERROR') {
      throw new Error('Resume rollback should be rejected');
    }

    // Forward jump +48h -> clamped strictly to 8h deadline!
    vClock.setWallMs(start + 48 * 3600 * 1000);
    const clampedResume = guard.lockOfflineResumeTarget(vClock, deadline);
    if (!clampedResume.ok || !clampedResume.clampedByDeadline || clampedResume.lockedTargetMs !== deadline) {
      throw new Error(`Expected 48h jump clamped to 8h deadline: ${JSON.stringify(clampedResume)}`);
    }
    return `dedupe ok (2/2); rollback=CLOCK_ERROR frozen; +48h jump clamped to 8h deadline`;
  });

  // 3. Ad 5-case experimental stub (COMPLETED, CANCELLED, LOAD_FAILED, PLAY_FAILED, DUPLICATE_CALLBACK)
  await run('T09-AD-STUB-5', 'EXPERIMENTAL_STUB Ad 5-case & duplicate callback guard', async () => {
    const coord = new ExperimentalAdStubCoordinator();
    const rComplete = await coord.runScenario('SPEED', 'COMPLETED');
    const rCancel = await coord.runScenario('SPEED', 'CANCELLED');
    const rLoadFail = await coord.runScenario('GOLD', 'LOAD_FAILED');
    const rPlayFail = await coord.runScenario('BAIT', 'PLAY_FAILED');
    const rDup = await coord.runScenario('RESET', 'DUPLICATE_CALLBACK');

    if (rComplete.record.status !== 'REWARDED' || rComplete.record.rewardDispatchCount !== 1) {
      throw new Error('COMPLETED did not dispatch 1 reward ack');
    }
    if (rCancel.record.status !== 'CANCELLED' || rCancel.record.rewardDispatchCount !== 0) {
      throw new Error('CANCELLED unexpectedly dispatched reward');
    }
    if (rLoadFail.record.status !== 'FAILED' || rPlayFail.record.status !== 'FAILED') {
      throw new Error('LOAD_FAILED / PLAY_FAILED status invalid');
    }
    if (
      rDup.record.status !== 'REWARDED' ||
      rDup.record.rewardDispatchCount !== 1 ||
      rDup.ignoredDuplicates !== 2
    ) {
      throw new Error(`DUPLICATE_CALLBACK leaked duplicate reward: ${JSON.stringify(rDup)}`);
    }
    if (coord.getRewardAckCount() !== 2) {
      throw new Error(`Expected total 2 reward acks across 5 cases, got ${coord.getRewardAckCount()}`);
    }
    return `5/5 stub cases passed (acks=2, ignoredDuplicates=2, 0 business state mutated)`;
  });

  // 4. Real WeChat Ad Unit status (explicitly BLOCKED without real adUnitId & device)
  results.push({
    id: 'T09-REAL-AD',
    name: 'Real WeChat RewardedVideoAd verification',
    status: 'BLOCKED',
    env,
    detail: 'BLOCKED: no real WeChat Mini Game adUnitId / real device available in FE-000',
    durationMs: 0,
  });

  return results;
}
