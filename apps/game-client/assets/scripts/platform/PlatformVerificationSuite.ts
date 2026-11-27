/**
 * FE-000 Platform Verification Suite (R1 hardened for I01, I03, I04, I05, V02):
 * - Every RuntimeLifecycleProvider created by a suite is owned and disposed in try/finally
 *   so wx/DOM platform listeners never leak on normal or failure exits.
 * - Local unsubscribe() semantics stay strictly local (sibling subscribers continue receiving events).
 * - Clearly distinguishes simulated emit / same-process reload / real platform callback / blocked real device items.
 */
import {
  advanceOffline,
  canonicalStringify,
  createInitialState,
  SLOT_PATHS,
  type SpikeGameState,
} from '@idle-fishing/game-core';
import { BrowserFilePort, MemoryFilePort } from './BrowserFilePort';
import { ExperimentalAdStubCoordinator } from './ExperimentalAdProvider';
import { FaultInjectingFilePort } from './FaultInjectingFilePort';
import { detectRuntimeEnv, isWeChatRealEnv, type FilePort, type VerificationCaseResult } from './PlatformTypes';
import { SingleWriterSaveCoordinator } from './SingleWriterSaveCoordinator';
import { MonotonicTimelineGuard, RuntimeClockProvider, VirtualClockProvider } from './WeChatClockProvider';
import { FilePortIoError, UnavailableFilePort, WeChatFilePort } from './WeChatFilePort';
import { RuntimeLifecycleProvider } from './WeChatLifecycleProvider';

/**
 * Returns the persistent storage FilePort for the current runtime host.
 * P1-01 N2: NEVER silently downgrades to MemoryFilePort when persistent storage is missing.
 * Explicit in-memory tests must construct new MemoryFilePort() directly.
 */
export function createRuntimeFilePort(namespace = 'idle_fishing_spike'): FilePort {
  const env = detectRuntimeEnv();
  if (isWeChatRealEnv(env) || env === 'WECHAT_MOCK') {
    return new WeChatFilePort(namespace);
  }
  if (env === 'WEB') {
    return new BrowserFilePort(`${namespace}_fs`);
  }
  return new UnavailableFilePort(
    env,
    namespace,
    `No persistent runtime storage available for host ${env}; pass explicit MemoryFilePort for in-memory experiments`
  );
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
  if (typeof port.clearTxState === 'function') {
    await port.clearTxState();
  }
  if (typeof port.clearHistoryState === 'function') {
    await port.clearHistoryState();
  }
}

export interface SuiteTestHooks {
  /** Optional test hook invoked immediately after lifecycle.subscribe() to verify try/finally disposal on fault. */
  afterLifecycleSubscribe?: (lifecycle: RuntimeLifecycleProvider) => void;
}

export async function runFileSystemAndSaveSuite(
  customPort?: FilePort,
  hooks?: SuiteTestHooks
): Promise<VerificationCaseResult[]> {
  const env = detectRuntimeEnv();
  // A09: Isolate each default diagnostic run in its own ephemeral namespace so concurrent tabs
  // running diagnostics never interfere with each other or with idle_fishing_lifecycle_persist.
  const ephemeralNamespace = `idle_fishing_spike_diag_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const ownsEphemeralPort = !customPort;
  const basePort = customPort ?? createRuntimeFilePort(ephemeralNamespace);
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

  try {
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

  // 2. Multi-slot rotation (T04) via unified SingleWriterSaveCoordinator
  await run('T04-ROTATE', '3-slot rotation & highest revision load', async () => {
    await cleanSlots(basePort);
    const repo = new SingleWriterSaveCoordinator(basePort);
    const empty = await repo.loadSafe();
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
    const loaded = await repo.loadSafe();
    if (loaded.kind !== 'VALID' || loaded.revision !== '5') {
      throw new Error(`Expected VALID rev=5, got ${loaded.kind}`);
    }
    if (canonicalStringify(loaded.raw) !== canonicalStringify(state)) {
      throw new Error('Loaded state differs from committed state');
    }
    return `5 commits rotated across 3 slots; loaded rev=${loaded.revision}, gold=${state.gold}`;
  });

  // 3. Corrupt single older/uncommitted slot -> recover valid highest rev=5; all slots corrupt -> CORRUPT (never EMPTY)
  await run('T04-CORRUPT', 'Corrupt slot fallback & all-corrupt fail-closed', async () => {
    const repo = new SingleWriterSaveCoordinator(basePort);
    // Corrupt slot 2 (older rev=3 / simulated partial rev=6 write) without regressing confirmed rev=5
    await basePort.write(SLOT_PATHS[2], '{"broken":true');
    const recovered = await repo.loadSafe();
    if (recovered.kind !== 'VALID' || !recovered.recovered || recovered.revision !== '5') {
      throw new Error(`Expected verified rev=5 recovered=true, got ${JSON.stringify(recovered)}`);
    }
    await basePort.write(SLOT_PATHS[0], 'BAD0');
    await basePort.write(SLOT_PATHS[1], 'BAD1');
    await basePort.write(SLOT_PATHS[2], 'BAD2');
    const allBad = await repo.loadSafe();
    if (allBad.kind !== 'CORRUPT') {
      throw new Error(`All-corrupt must return CORRUPT (not EMPTY), got ${allBad.kind}`);
    }
    return `Single-slot corruption recovered rev=5; all-corrupt returned CORRUPT (${allBad.detail.slice(0, 60)})`;
  });

  // 4. Write failure, Fault injection & 5bcc9ac UNCERTAIN save-protocol checks (T05)
  await run('T05-FAULTS', 'Fault injection: pre-write / partial / uncertain / unknown-slot guard', async () => {
    await cleanSlots(basePort);
    const faultPort = new FaultInjectingFilePort(basePort);
    const repo = new SingleWriterSaveCoordinator(faultPort);
    let state = createInitialState({
      saveEpoch: 'fe000-fault-epoch',
      startMs: 1_700_000_000_000,
      allowanceMs: 8 * 3600 * 1000,
    });
    const c1 = await repo.commit(state, null);
    if (c1.kind !== 'COMMITTED') throw new Error('Initial commit failed');

    state = advanceOffline(state, state.cursorMs + 30_000).state;
    faultPort.armNextWriteFault('PRE_WRITE_ERROR');
    const fPre = await repo.commit(state, '1');
    if (fPre.kind !== 'FAILED') throw new Error(`Expected FAILED on pre-write, got ${fPre.kind}`);

    faultPort.armNextWriteFault('PARTIAL_WRITE');
    const fPartial = await repo.commit(state, '1');
    if (fPartial.kind !== 'FAILED') throw new Error(`Expected FAILED on partial write, got ${fPartial.kind}`);
    const afterPartial = await repo.loadSafe();
    if (afterPartial.kind !== 'VALID' || afterPartial.revision !== '1' || !afterPartial.recovered) {
      throw new Error(`Expected rev=1 recovered=true after partial write, got ${afterPartial.kind}`);
    }

    // 5bcc9ac I01: unknown slot read MUST return UNCERTAIN with ZERO write attempts
    const writesBeforeUnknown = faultPort.trace.filter((e) => e.startsWith('WRITE_')).length;
    faultPort.setReadFault(SLOT_PATHS[2], true);
    const fUnknown = await repo.commit(state, '1');
    faultPort.setReadFault(SLOT_PATHS[2], false);
    const writesAfterUnknown = faultPort.trace.filter((e) => e.startsWith('WRITE_')).length;
    if (fUnknown.kind !== 'UNCERTAIN' || writesAfterUnknown !== writesBeforeUnknown) {
      throw new Error(
        `Unknown slot must return UNCERTAIN with 0 writes, got kind=${fUnknown.kind} writes=${writesAfterUnknown - writesBeforeUnknown}`
      );
    }

    // A02: UNCERTAIN freezes the shared namespace until explicit verified loadSafe() recovery
    const blockedBeforeRecover = await repo.commit(state, '1');
    if (blockedBeforeRecover.kind !== 'STORAGE_UNAVAILABLE') {
      throw new Error(`Expected STORAGE_UNAVAILABLE before explicit recovery, got ${JSON.stringify(blockedBeforeRecover)}`);
    }
    const recoveredAfterUnknown = await repo.loadSafe();
    if (recoveredAfterUnknown.kind !== 'VALID' || recoveredAfterUnknown.revision !== '1') {
      throw new Error(`Expected VALID rev=1 on explicit recovery, got ${JSON.stringify(recoveredAfterUnknown)}`);
    }

    faultPort.armNextWriteFault('POST_WRITE_THROW');
    const fPost = await repo.commit(state, '1');
    if (fPost.kind !== 'COMMITTED' || !fPost.recoveredFromUncertainWrite || fPost.revision !== '2') {
      throw new Error(`Expected COMMITTED recoveredFromUncertainWrite=true rev=2, got ${JSON.stringify(fPost)}`);
    }
    return `Pre-write=FAILED, Partial=recovered rev 1, Unknown-slot=UNCERTAIN(0 writes), Post-write throw=claimed rev 2 once`;
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

  // 6. HIDE callback triggered save + fresh repository reload (I01 + I05 owner try/finally disposal)
  await run('FS-BG-RECOVERY', 'HIDE callback save & same-process repo reload', async () => {
    await cleanSlots(basePort);
    const repo = new SingleWriterSaveCoordinator(basePort);
    const lifecycle = new RuntimeLifecycleProvider();
    let unsub: (() => void) | null = null;
    try {
      let state = createInitialState({
        saveEpoch: 'fe000-bg-epoch',
        startMs: 1_700_000_000_000,
        allowanceMs: 8 * 3600 * 1000,
      });
      const c1 = await repo.commit(state, null);
      if (c1.kind !== 'COMMITTED') throw new Error('Seed commit failed');

      const pendingCommits: Promise<{ kind: string; revision?: string }>[] = [];
      unsub = lifecycle.subscribe((ev) => {
        if (ev === 'HIDE') {
          state = advanceOffline(state, state.cursorMs + 120_000).state;
          pendingCommits.push(repo.commit(state, '1'));
        }
      });

      // Allow test harness to inject post-subscribe fault to prove owner try/finally disposal
      hooks?.afterLifecycleSubscribe?.(lifecycle);

      lifecycle.emit('HIDE', 'suite-simulated-hide');
      if (pendingCommits.length === 0) throw new Error('HIDE callback did not fire');
      const c2 = await pendingCommits[0];
      if (c2.kind !== 'COMMITTED') throw new Error(`Hide callback commit failed: ${c2.kind}`);

      // Same-process fresh coordinator load (real cross-reload verified separately in Web E2E; real kill BLOCKED on device)
      const freshRepo = new SingleWriterSaveCoordinator(basePort);
      const reloaded = await freshRepo.loadSafe();
      if (reloaded.kind !== 'VALID' || reloaded.revision !== '2') {
        throw new Error(`Expected rev=2 after repo reload, got ${reloaded.kind}`);
      }
      const restoredState = reloaded.raw as SpikeGameState;
      if (restoredState.offline?.deadlineMs !== state.offline?.deadlineMs) {
        throw new Error('Offline deadline changed across reload recovery');
      }
      return `HIDE callback committed rev=2 on ${basePort.kind}; fresh repo restored deadlineMs=${restoredState.offline?.deadlineMs} (same-process; real kill requires device)`;
    } finally {
      unsub?.();
      lifecycle.dispose();
    }
  });

  } finally {
    await cleanSlots(basePort).catch(() => {
      // Ignore cleanup error if storage became unavailable during fault test
    });
    if (ownsEphemeralPort && 'clearAll' in basePort && typeof (basePort as { clearAll?: () => Promise<void> }).clearAll === 'function') {
      await (basePort as { clearAll: () => Promise<void> }).clearAll().catch(() => {});
    }
  }
  return results;
}

export async function runLifecycleClockAndAdSuite(hooks?: SuiteTestHooks): Promise<VerificationCaseResult[]> {
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

  // 2. Lifecycle dispatch, local unsubscribe, dedupe, exception isolation, owner disposal,
  //    unsupported monotonic freeze, wall rollback + recovery, and +48h deadline clamp
  await run('T08-LIFECYCLE-CLOCK', 'Lifecycle dispatch/isolation & clock guard boundaries', async () => {
    const lifecycle = new RuntimeLifecycleProvider();
    let unsubA: (() => void) | null = null;
    let unsubB: (() => void) | null = null;
    let unsubFaulty: (() => void) | null = null;
    try {
      const eventsA: string[] = [];
      const eventsB: string[] = [];
      unsubFaulty = lifecycle.subscribe(() => {
        throw new Error('intentional faulty listener');
      });
      unsubA = lifecycle.subscribe((ev) => eventsA.push(ev));
      unsubB = lifecycle.subscribe((ev) => eventsB.push(ev));

      // Allow test harness to inject post-subscribe fault to prove owner try/finally disposal
      hooks?.afterLifecycleSubscribe?.(lifecycle);

      lifecycle.emit('HIDE', 'suite-1');
      lifecycle.emit('HIDE', 'suite-dup'); // deduped
      lifecycle.emit('SHOW', 'suite-1');
      lifecycle.emit('SHOW', 'suite-dup'); // deduped

      // Local unsubscribe on A must NOT break sibling B
      unsubA();
      unsubA = null;
      lifecycle.emit('HIDE', 'suite-2');
      lifecycle.emit('SHOW', 'suite-2');

      if (eventsA.join(',') !== 'HIDE,SHOW') {
        throw new Error(`Expected A=[HIDE,SHOW], got [${eventsA.join(',')}]`);
      }
      if (eventsB.join(',') !== 'HIDE,SHOW,HIDE,SHOW') {
        throw new Error(`Expected sibling B=[HIDE,SHOW,HIDE,SHOW], got [${eventsB.join(',')}]`);
      }
      if (lifecycle.listenerErrorCount !== 4) {
        throw new Error(`Expected 4 isolated listener errors, got ${lifecycle.listenerErrorCount}`);
      }
    } finally {
      unsubA?.();
      unsubB?.();
      unsubFaulty?.();
      lifecycle.dispose();
    }

    // Unsupported monotonic clock must freeze foreground jump (I03)
    const start = 1_700_000_000_000;
    const deadline = start + 8 * 3600 * 1000;
    const noMonoClock = new VirtualClockProvider(start, 0, false);
    const noMonoGuard = new MonotonicTimelineGuard(noMonoClock, 2000);
    noMonoClock.setWallMs(start + 48 * 3600 * 1000);
    const frozenRes = noMonoGuard.tickForeground(noMonoClock);
    if (frozenRes.ok || frozenRes.code !== 'CLOCK_ERROR' || frozenRes.cursorMs !== start) {
      throw new Error(`Unsupported monotonic must freeze cursor: ${JSON.stringify(frozenRes)}`);
    }

    // Normal monotonic + rollback freeze + recovery + forward jump deadline clamp
    const vClock = new VirtualClockProvider(start, 1000, true);
    const guard = new MonotonicTimelineGuard(vClock, 2000);
    vClock.advance(5000);
    const okTick = guard.tickForeground(vClock);
    if (!okTick.ok || okTick.cursorMs !== start + 5000) throw new Error('Normal foreground tick failed');

    vClock.setWallMs(start - 600_000);
    const rollbackTick = guard.tickForeground(vClock);
    if (rollbackTick.ok || rollbackTick.code !== 'CLOCK_ERROR' || rollbackTick.cursorMs !== start + 5000) {
      throw new Error(`Rollback should freeze without rewind: ${JSON.stringify(rollbackTick)}`);
    }

    const badResume = guard.lockOfflineResumeTarget(vClock, deadline);
    if (badResume.ok || badResume.code !== 'CLOCK_ERROR') {
      throw new Error('Resume rollback should be rejected');
    }

    // Wall clock recovers to >= highWaterMs -> foreground unfreezes without rewinding or adopting fake jump
    vClock.setWallMs(start + 6000);
    vClock.setMonoMs(7000);
    const recoveredTick = guard.tickForeground(vClock);
    if (!recoveredTick.ok || recoveredTick.frozen || recoveredTick.cursorMs !== start + 5000) {
      throw new Error(`Expected clean freeze recovery at cursor=${start + 5000}: ${JSON.stringify(recoveredTick)}`);
    }

    // Forward jump +48h on resume -> clamped strictly to 8h deadline
    vClock.setWallMs(start + 48 * 3600 * 1000);
    const clampedResume = guard.lockOfflineResumeTarget(vClock, deadline);
    if (!clampedResume.ok || !clampedResume.clampedByDeadline || clampedResume.lockedTargetMs !== deadline) {
      throw new Error(`Expected 48h jump clamped to 8h deadline: ${JSON.stringify(clampedResume)}`);
    }
    return `dispatch/dedupe/unsub/isolation ok; unsupported-mono frozen; rollback+recovery ok; +48h clamped to 8h`;
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
    detail: 'BLOCKED: no real WeChat Mini Game adUnitId / real device available in FE-000-R1',
    durationMs: 0,
  });

  return results;
}
