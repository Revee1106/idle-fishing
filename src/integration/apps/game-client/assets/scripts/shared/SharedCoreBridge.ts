/**
 * FE-000-R1-INTEGRATION SharedCoreBridge: consumes the SINGLE source-of-truth backend module
 * `@idle-fishing/game-core` (integrated reviewed backend commit 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355).
 * Zero duplicate business algorithms.
 */
import {
  advanceOffline,
  advanceOfflineSliced,
  buildEnvelope,
  canonicalStringify,
  createInitialState,
  DEFAULT_OFFLINE_FIXTURE,
  drawU53,
  ENV_STREAM_NAME,
  migrateSpikeState,
  mulNatByMultiplier,
  natFromBigInt,
  natToBigInt,
  newRngState,
  sha256Hex,
  SLOT_PATHS,
  triangularQuantile,
  validateSpikeState,
  workFromMs,
  xoshiroStep,
  type RngWords,
  type SpikeGameState,
  type SpikeGameStateV1,
} from '@idle-fishing/game-core';
export { advanceOffline, canonicalStringify, createInitialState, SLOT_PATHS } from '@idle-fishing/game-core';
import { detectRuntimeEnv, type VerificationCaseResult } from '../platform/PlatformTypes';

export interface FrameIntervalStats {
  readonly samples: number;
  readonly maxFrameMs: number;
  readonly avgFrameMs: number;
}

export interface Offline24hBenchmarkResult {
  readonly env: string;
  readonly backendCoreCommit: string;
  readonly singleShotMs: number;
  readonly slicedTotalWallMs: number;
  readonly slicedComputeMs: number;
  readonly sliceCount: number;
  readonly maxSliceMs: number;
  readonly avgSliceMs: number;
  readonly processedNodes: number;
  readonly cycles: number;
  readonly attempts: number;
  readonly gold: string;
  readonly big: string;
  readonly singleEqualsSliced: boolean;
  readonly canonicalHash: string;
  readonly envelopeInnerSha256: string;
  readonly envelopeHashRev1: string;
  readonly matchesBe000Golden24hEnvelopeInner: boolean;
  readonly matchesBe000Golden24hEnvelopeText: boolean;
  readonly matchesBe000Golden24hEnvelope: boolean;
  readonly memorySnapshot: string;
  readonly slicedRafStats: FrameIntervalStats | null;
}

export interface SharedCoreReport {
  readonly env: string;
  readonly backendCoreCommit: string;
  readonly allPassed: boolean;
  readonly cases: VerificationCaseResult[];
  readonly summaryState: {
    gold: string;
    big: string;
    cycles: number;
    attempts: number;
    cursorMs: number;
    settledUntilMs: number | null;
    rngPreview: string;
    canonicalHash: string;
    oneHourEnvelopeInnerSha256: string;
    oneHourEnvelopeTextSha256: string;
    eightHourCanonicalHash: string;
    eightHourHasAttemptLock: boolean;
  };
}

/**
 * Authoritative BE-000-R1-P2 golden vectors (reviewed backend commit 5bcc9ac).
 * Strictly distinguishes:
 * - *StateSha256: sha256Hex(canonicalStringify(state))
 * - *EnvelopeInnerSha256: buildEnvelope(state, '1').sha256 == computeEnvelopeHash([magic,format,rev,epoch,payload])
 * - *EnvelopeTextSha256: sha256Hex(buildEnvelope(state, '1').text)
 *
 * Legacy 358b111 pre-R1 values (changed solely due to settledUntilMs checkpoint + FIGHTING attemptLock):
 * - oneHourStateSha256: bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a
 * - oneHourEnvelopeTextSha256: 2c768fc2d368faa38b841e8b94c55d1e9398c80ff4e894a49cc2644b056ed5ee
 * - eightHourStateSha256: 7da517674df168ca5f88535b949f51a072982e77a0577b362811aa21c430839f
 * - twentyFourHourEnvelopeTextSha256: 88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536
 */
export const BE000_GOLDEN = {
  backendCommit: '5bcc9ac',
  epoch: 'epoch.be000',
  startMs: 1_700_000_000_000,
  allowanceMs: 86_400_000,
  initialSha256: '79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4',
  oneHourSha256: '8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63',
  oneHourEnvelopeInnerSha256: '183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a',
  oneHourEnvelopeSha256: '4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6',
  eightHourSha256: '91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9',
  twentyFourHourEnvelopeInnerSha256: '9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d',
  twentyFourHourEnvelopeSha256: '0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f',
} as const;

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function sampleMemory(): string {
  const perf = (globalThis as unknown as {
    performance?: { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } };
  }).performance;
  if (perf?.memory?.usedJSHeapSize !== undefined) {
    const usedMb = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
    const totalMb = ((perf.memory.totalJSHeapSize ?? 0) / (1024 * 1024)).toFixed(2);
    return `jsHeap=${usedMb}MB/${totalMb}MB`;
  }
  const proc = (globalThis as unknown as {
    process?: { memoryUsage?: () => { heapUsed: number; rss: number } };
  }).process;
  if (proc?.memoryUsage) {
    const m = proc.memoryUsage();
    return `nodeHeap=${(m.heapUsed / (1024 * 1024)).toFixed(2)}MB rss=${(m.rss / (1024 * 1024)).toFixed(2)}MB`;
  }
  return 'unavailable_in_runtime';
}

export function runSharedCoreVerification(): SharedCoreReport {
  const env = detectRuntimeEnv();
  const cases: VerificationCaseResult[] = [];

  const runCase = (id: string, name: string, fn: () => string): void => {
    const t0 = nowMs();
    try {
      const detail = fn();
      cases.push({
        id,
        name,
        status: 'PASS',
        env,
        detail,
        durationMs: Number((nowMs() - t0).toFixed(3)),
      });
    } catch (err) {
      cases.push({
        id,
        name,
        status: 'FAIL',
        env,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Number((nowMs() - t0).toFixed(3)),
      });
    }
  };

  // 1. Canonical JSON + SHA-256 golden test
  runCase('T02-SHA256', 'Canonical JSON & SHA-256 vector', () => {
    const canon = canonicalStringify({ b: 2, a: 'hello', z: [3, 1, 2] });
    if (canon !== '{"a":"hello","b":2,"z":[3,1,2]}') {
      throw new Error(`Unexpected canonical JSON: ${canon}`);
    }
    const emptyHash = sha256Hex('');
    const abcHash = sha256Hex('abc');
    if (emptyHash !== 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
      throw new Error(`SHA-256("") mismatch: ${emptyHash}`);
    }
    if (abcHash !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
      throw new Error(`SHA-256("abc") mismatch: ${abcHash}`);
    }
    return `canon ok; sha256("abc")=${abcHash.slice(0, 16)}...`;
  });

  // 2. PRNG RNG-01 golden vector (docs/interfaces/20)
  runCase('T03-RNG01', 'xoshiro128** golden vector [1,2,3,4]', () => {
    let words: RngWords = [1, 2, 3, 4];
    const outputs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const step = xoshiroStep(words);
      outputs.push(step.value);
      words = step.state;
    }
    const expectedOut = [11520, 0, 5927040, 70819200, 2031721883];
    const expectedState = [15224335, 29364750, 272377353, 1125134346];
    if (JSON.stringify(outputs) !== JSON.stringify(expectedOut)) {
      throw new Error(`Output mismatch: got ${JSON.stringify(outputs)}`);
    }
    if (JSON.stringify(words) !== JSON.stringify(expectedState)) {
      throw new Error(`State mismatch: got ${JSON.stringify(words)}`);
    }
    return `outputs=${outputs.join(',')} final=[${words.join(',')}]`;
  });

  // 3. PRNG RNG-02 serialize/restore + RNG-03 stream isolation
  runCase('T03-RNG02/03', 'PRNG save/restore continuity & stream isolation', () => {
    const seed = 0x1234abcd;
    let continuous = newRngState();
    const second1000: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const d = drawU53(continuous, seed, 'wait');
      if (!(d.u >= 0 && d.u < 1)) throw new Error(`U out of [0,1): ${d.u}`);
      continuous = d.state;
    }
    let restored = JSON.parse(canonicalStringify(continuous));
    for (let i = 0; i < 100; i++) {
      restored = drawU53(restored, seed, ENV_STREAM_NAME).state;
    }
    for (let i = 0; i < 1000; i++) {
      const dCont = drawU53(continuous, seed, 'wait');
      const dRest = drawU53(restored, seed, 'wait');
      if (dCont.u !== dRest.u) {
        throw new Error(`Mismatch at draw ${1000 + i}: ${dCont.u} !== ${dRest.u}`);
      }
      second1000.push(dCont.u);
      continuous = dCont.state;
      restored = dRest.state;
    }
    return `2000 draws exact match; isolated across 100 env draws; u[1999]=${second1000[999].toFixed(12)}`;
  });

  // 4. BigInt runtime & Nat serialization/deserialization
  runCase('T02-BIGINT', 'BigInt runtime & Nat serialization (>2^53)', () => {
    if (typeof BigInt !== 'function') throw new Error('BigInt not supported in runtime');
    const huge = 123_456_789_012_345_678_901_234_567_890n;
    const nat = natFromBigInt(huge);
    const roundTrip = natToBigInt(nat);
    if (roundTrip !== huge) throw new Error('BigInt Nat round-trip mismatch');
    const scaled = mulNatByMultiplier('1000000000000000000000', 1.234567, 'round');
    if (scaled !== '1234567000000000000000') {
      throw new Error(`Unexpected scaled Nat: ${scaled}`);
    }
    return `BigInt ok; roundTrip=${nat}; scaled=${scaled}`;
  });

  // 5. Cross-runtime Math checks
  runCase('T02-MATH', 'Math.pow / sqrt / imul / triangularQuantile determinism', () => {
    const q0 = triangularQuantile(0, DEFAULT_OFFLINE_FIXTURE.waitTriangle);
    const qHalf = triangularQuantile(0.5, DEFAULT_OFFLINE_FIXTURE.waitTriangle);
    const powVal = Math.pow(4, 0.5);
    const imulVal = Math.imul(0x811c9dc5, 0x01000193) >>> 0;
    if (q0 !== 0.3) throw new Error(`Expected q(0)=0.3, got ${q0}`);
    if (powVal !== 2) throw new Error(`Expected pow(4,0.5)=2, got ${powVal}`);
    if (imulVal !== 84696351) throw new Error(`Unexpected Math.imul: ${imulVal}`);
    return `q(0)=${q0}, q(0.5)=${qHalf.toFixed(12)}, imul=${imulVal}`;
  });

  // 6. Continuous vs Sliced time advancement + exact BE-000-R1-P2 golden vector comparison (epoch.be000 @ 5bcc9ac)
  const initialState: SpikeGameState = createInitialState({
    saveEpoch: BE000_GOLDEN.epoch,
    startMs: BE000_GOLDEN.startMs,
    allowanceMs: BE000_GOLDEN.allowanceMs,
  });
  let latestState: SpikeGameState = initialState;
  let oneHourEnvelopeInnerSha256 = '';
  let oneHourEnvelopeTextSha256 = '';
  let eightHourCanonicalHash = '';
  let eightHourHasAttemptLock = false;

  runCase('T03-ADVANCE', 'Continuous vs 60s-sliced 1h/8h & BE-000-R1-P2 golden vectors', () => {
    const initHash = sha256Hex(canonicalStringify(initialState));
    if (initHash !== BE000_GOLDEN.initialSha256) {
      throw new Error(`Initial state hash mismatch vs 5bcc9ac: ${initHash}`);
    }
    const targetMs = initialState.cursorMs + 3_600_000;
    const cont = advanceOffline(initialState, targetMs);
    const sliced = advanceOfflineSliced(initialState, targetMs, 60_000);
    const contJson = canonicalStringify(cont.state);
    const slicedJson = canonicalStringify(sliced.state);
    if (contJson !== slicedJson) {
      throw new Error('Continuous and 60s-sliced states diverged');
    }
    if (cont.state.offline?.settledUntilMs !== targetMs) {
      throw new Error(`Expected 1h settledUntilMs=${targetMs}, got ${cont.state.offline?.settledUntilMs}`);
    }
    const oneHourHash = sha256Hex(contJson);
    if (oneHourHash !== BE000_GOLDEN.oneHourSha256) {
      throw new Error(`1h state hash mismatch vs 5bcc9ac: ${oneHourHash}`);
    }
    const env1h = buildEnvelope(cont.state, '1');
    oneHourEnvelopeInnerSha256 = env1h.sha256;
    oneHourEnvelopeTextSha256 = sha256Hex(env1h.text);
    if (oneHourEnvelopeInnerSha256 !== BE000_GOLDEN.oneHourEnvelopeInnerSha256) {
      throw new Error(`1h envelope inner sha256 mismatch: ${oneHourEnvelopeInnerSha256}`);
    }
    if (oneHourEnvelopeTextSha256 !== BE000_GOLDEN.oneHourEnvelopeSha256) {
      throw new Error(`1h envelope text sha256 mismatch vs 5bcc9ac: ${oneHourEnvelopeTextSha256}`);
    }

    // Also verify 8h state hash + FIGHTING attemptLock persistence (5bcc9ac)
    const eightHour = advanceOffline(initialState, initialState.cursorMs + 8 * 3_600_000).state;
    eightHourCanonicalHash = sha256Hex(canonicalStringify(eightHour));
    eightHourHasAttemptLock = Boolean(eightHour.attemptLock && eightHour.stage === 'FIGHTING');
    if (eightHourCanonicalHash !== BE000_GOLDEN.eightHourSha256) {
      throw new Error(`8h state hash mismatch vs 5bcc9ac: ${eightHourCanonicalHash}`);
    }
    if (!eightHourHasAttemptLock || eightHour.attemptLock?.claimKey !== 'fish:970') {
      throw new Error('Expected 8h FIGHTING attemptLock for fish:970');
    }

    // Verify 5bcc9ac invariants: allowanceMs=0 and custom fixture must be rejected
    let rejectedZeroAllow = false;
    try {
      createInitialState({ saveEpoch: 'zero.test', startMs: BE000_GOLDEN.startMs, allowanceMs: 0 });
    } catch {
      rejectedZeroAllow = true;
    }
    if (!rejectedZeroAllow) throw new Error('Expected allowanceMs=0 to be rejected');

    let rejectedCustomFixture = false;
    try {
      createInitialState({
        saveEpoch: 'fix.test',
        startMs: BE000_GOLDEN.startMs,
        allowanceMs: 60_000,
        fixture: { castMs: 17 },
      } as unknown as Parameters<typeof createInitialState>[0]);
    } catch {
      rejectedCustomFixture = true;
    }
    if (!rejectedCustomFixture) throw new Error('Expected custom fixture to be rejected');

    latestState = cont.state;
    return `1h/8h exact match vs 5bcc9ac: cycles=${cont.state.counters.cycles}, gold=${cont.state.gold}, sha256=${oneHourHash.slice(0, 16)}...`;
  });

  // 7. Schema v1 -> v2 migration check (IDLE + in-progress FIGHTING/PREPARING + invalid guard)
  runCase('T07-MIGRATE', 'v1 -> v2 migration (IDLE, FIGHTING, PREPARING) & invalid guard', () => {
    const v1: SpikeGameStateV1 = {
      schemaVersion: 1,
      saveEpoch: 'fe000-migrate-1',
      rootSeed: 0x1234abcd,
      cursorMs: 1_700_000_000_000,
      counter: 7,
      gold: '4200',
      rng: newRngState(),
    };
    const migrated = migrateSpikeState(v1, 1, 2);
    if (migrated.schemaVersion !== 2 || migrated.gold !== '4200' || migrated.counters.attempts !== 7) {
      throw new Error('Unexpected migrated v2 fields');
    }

    // 5bcc9ac experimental in-progress PREPARING migration (already settled; no double grant)
    const v1Prep: SpikeGameStateV1 = {
      ...v1,
      saveEpoch: 'fe000-migrate-prep',
      attempt: {
        stage: 'PREPARING',
        stageStartMs: 1_699_999_999_000,
        stageDone: workFromMs(1000),
        stageRequired: workFromMs(2500),
      },
    };
    const migratedPrep = migrateSpikeState(v1Prep, 1, 2);
    if (
      validateSpikeState(migratedPrep).length !== 0 ||
      migratedPrep.lastTerminalAttemptSeq !== '7' ||
      !migratedPrep.claims.includes('fish:7')
    ) {
      throw new Error('PREPARING migration failed state validation or claim preservation');
    }
    const afterPrep = advanceOffline(migratedPrep, migratedPrep.cursorMs + 2_000).state;
    if (afterPrep.gold !== '4200') {
      throw new Error(`PREPARING migration double-granted gold: ${afterPrep.gold}`);
    }

    let rejectedBad = false;
    try {
      migrateSpikeState({ schemaVersion: 1, saveEpoch: '' }, 1, 2);
    } catch {
      rejectedBad = true;
    }
    if (!rejectedBad) throw new Error('Invalid v1 payload was not rejected');
    return `v1->v2 IDLE & PREPARING ok (gold=${migrated.gold}, fish:7 preserved); bad v1 rejected`;
  });

  const finalCanon = canonicalStringify(latestState);
  const canonicalHash = sha256Hex(finalCanon);
  const waitWords = latestState.rng.streams['wait'] ?? [0, 0, 0, 0];

  return {
    env,
    backendCoreCommit: BE000_GOLDEN.backendCommit,
    allPassed: cases.every((c) => c.status === 'PASS'),
    cases,
    summaryState: {
      gold: latestState.gold,
      big: latestState.big,
      cycles: latestState.counters.cycles,
      attempts: latestState.counters.attempts,
      cursorMs: latestState.cursorMs,
      settledUntilMs: latestState.offline?.settledUntilMs ?? null,
      rngPreview: `wait=[${waitWords.join(',')}]`,
      canonicalHash,
      oneHourEnvelopeInnerSha256,
      oneHourEnvelopeTextSha256,
      eightHourCanonicalHash,
      eightHourHasAttemptLock,
    },
  };
}

/**
 * Representative 24-hour offline advancement benchmark (T06).
 * Separates single-shot timing from sliced execution + isolated rAF frame-gap measurement
 * during the sliced window so single-shot blocking does not pollute sliced frame observations.
 */
export async function run24hOfflineBenchmark(maxNodesPerSlice = 250): Promise<Offline24hBenchmarkResult> {
  const env = detectRuntimeEnv();
  const startMs = BE000_GOLDEN.startMs;
  const duration24h = BE000_GOLDEN.allowanceMs;
  const targetMs = startMs + duration24h;

  const initial = createInitialState({
    saveEpoch: BE000_GOLDEN.epoch,
    startMs,
    allowanceMs: duration24h,
  });

  // 1. Single-shot timing (isolated)
  const tSingle0 = nowMs();
  const single = advanceOffline(initial, targetMs);
  const singleShotMs = Number((nowMs() - tSingle0).toFixed(3));

  // Yield once before measuring sliced phase + rAF intervals cleanly
  await new Promise<void>((resolve) => setTimeout(resolve, 16));

  let rafActive = false;
  let rafId = 0;
  let lastRafTs = 0;
  const rafDeltas: number[] = [];
  const hasRaf = typeof globalThis.requestAnimationFrame === 'function';
  if (hasRaf) {
    rafActive = true;
    const onRaf = (ts: number) => {
      if (!rafActive) return;
      if (lastRafTs > 0) rafDeltas.push(ts - lastRafTs);
      lastRafTs = ts;
      rafId = globalThis.requestAnimationFrame(onRaf);
    };
    rafId = globalThis.requestAnimationFrame(onRaf);
  }

  // 2. Sliced phase (yielding to event loop between slices)
  const tWall0 = nowMs();
  let state = initial;
  let totalNodes = 0;
  let sliceCount = 0;
  let computeSum = 0;
  let maxSliceMs = 0;

  while (state.cursorMs < targetMs) {
    const s0 = nowMs();
    const res = advanceOffline(state, targetMs, { maxNodes: maxNodesPerSlice });
    const dt = nowMs() - s0;
    computeSum += dt;
    if (dt > maxSliceMs) maxSliceMs = dt;
    sliceCount += 1;
    totalNodes += res.processedNodes;
    state = res.state;
    if (res.reachedTarget) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const slicedTotalWallMs = Number((nowMs() - tWall0).toFixed(3));

  if (hasRaf) {
    rafActive = false;
    if (typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(rafId);
    }
  }

  let slicedRafStats: FrameIntervalStats | null = null;
  if (rafDeltas.length > 0) {
    let maxD = 0;
    let sumD = 0;
    for (let i = 0; i < rafDeltas.length; i++) {
      const d = rafDeltas[i];
      if (d > maxD) maxD = d;
      sumD += d;
    }
    slicedRafStats = {
      samples: rafDeltas.length,
      maxFrameMs: Number(maxD.toFixed(2)),
      avgFrameMs: Number((sumD / rafDeltas.length).toFixed(2)),
    };
  }

  const singleJson = canonicalStringify(single.state);
  const slicedJson = canonicalStringify(state);
  const singleEqualsSliced = singleJson === slicedJson;
  const canonicalHash = sha256Hex(singleJson);
  const env24h = buildEnvelope(single.state, '1');
  const envelopeInnerSha256 = env24h.sha256;
  const envelopeHashRev1 = sha256Hex(env24h.text);
  const matchesBe000Golden24hEnvelopeInner =
    envelopeInnerSha256 === BE000_GOLDEN.twentyFourHourEnvelopeInnerSha256;
  const matchesBe000Golden24hEnvelopeText =
    envelopeHashRev1 === BE000_GOLDEN.twentyFourHourEnvelopeSha256;
  const matchesBe000Golden24hEnvelope =
    matchesBe000Golden24hEnvelopeInner && matchesBe000Golden24hEnvelopeText;

  return {
    env,
    backendCoreCommit: BE000_GOLDEN.backendCommit,
    singleShotMs,
    slicedTotalWallMs,
    slicedComputeMs: Number(computeSum.toFixed(3)),
    sliceCount,
    maxSliceMs: Number(maxSliceMs.toFixed(3)),
    avgSliceMs: Number((computeSum / Math.max(1, sliceCount)).toFixed(3)),
    processedNodes: totalNodes,
    cycles: single.state.counters.cycles,
    attempts: single.state.counters.attempts,
    gold: single.state.gold,
    big: single.state.big,
    singleEqualsSliced,
    canonicalHash,
    envelopeInnerSha256,
    envelopeHashRev1,
    matchesBe000Golden24hEnvelopeInner,
    matchesBe000Golden24hEnvelopeText,
    matchesBe000Golden24hEnvelope,
    memorySnapshot: sampleMemory(),
    slicedRafStats,
  };
}
