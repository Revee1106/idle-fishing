/**
 * FE-000 SharedCoreBridge: consumes the SINGLE source-of-truth backend module
 * `@idle-fishing/game-core` built by BE-000. Zero duplicate business algorithms.
 */
import {
  advanceOffline,
  advanceOfflineSliced,
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
  triangularQuantile,
  xoshiroStep,
  type RngWords,
  type SpikeGameState,
  type SpikeGameStateV1,
} from '@idle-fishing/game-core';
import { detectRuntimeEnv, type VerificationCaseResult } from '../platform/PlatformTypes';

export interface Offline24hBenchmarkResult {
  readonly env: string;
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
  readonly memorySnapshot: string;
}

export interface SharedCoreReport {
  readonly env: string;
  readonly allPassed: boolean;
  readonly cases: VerificationCaseResult[];
  readonly summaryState: {
    gold: string;
    big: string;
    cycles: number;
    attempts: number;
    cursorMs: number;
    rngPreview: string;
    canonicalHash: string;
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function sampleMemory(): string {
  const perf = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } } })
    .performance;
  if (perf?.memory?.usedJSHeapSize !== undefined) {
    const usedMb = (perf.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2);
    const totalMb = ((perf.memory.totalJSHeapSize ?? 0) / (1024 * 1024)).toFixed(2);
    return `jsHeap=${usedMb}MB/${totalMb}MB`;
  }
  const proc = (globalThis as { process?: { memoryUsage?: () => { heapUsed: number; rss: number } } }).process;
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
    const first1000: number[] = [];
    const second1000: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const d = drawU53(continuous, seed, 'wait');
      if (!(d.u >= 0 && d.u < 1)) throw new Error(`U out of [0,1): ${d.u}`);
      first1000.push(d.u);
      continuous = d.state;
    }
    // Serialize mid-run and restore
    let restored = JSON.parse(canonicalStringify(continuous));
    // Interleave 100 draws on environment stream (isolation check RNG-03)
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

  // 6. Continuous vs Sliced time advancement (1 hour = 3,600,000 ms)
  let latestState: SpikeGameState = createInitialState({
    saveEpoch: 'fe000-epoch-1',
    startMs: 1_700_000_000_000,
    allowanceMs: 24 * 3600 * 1000,
  });

  runCase('T03-ADVANCE', 'Continuous vs 60s-sliced 1h advancement equality', () => {
    const targetMs = latestState.cursorMs + 3_600_000;
    const cont = advanceOffline(latestState, targetMs);
    const sliced = advanceOfflineSliced(latestState, targetMs, 60_000);
    const contJson = canonicalStringify(cont.state);
    const slicedJson = canonicalStringify(sliced.state);
    if (contJson !== slicedJson) {
      throw new Error('Continuous and 60s-sliced states diverged');
    }
    latestState = cont.state;
    return `1h exact match: cycles=${cont.state.counters.cycles}, gold=${cont.state.gold}, nodes=${cont.processedNodes}`;
  });

  // 7. Schema v1 -> v2 migration check (T07 bridge check)
  runCase('T07-MIGRATE', 'v1 -> v2 schema migration & invalid input guard', () => {
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
    let rejectedBad = false;
    try {
      migrateSpikeState({ schemaVersion: 1, saveEpoch: '' }, 1, 2);
    } catch {
      rejectedBad = true;
    }
    if (!rejectedBad) throw new Error('Invalid v1 payload was not rejected');
    return `v1->v2 ok (gold=${migrated.gold}, attempts=${migrated.counters.attempts}); bad v1 rejected`;
  });

  const finalCanon = canonicalStringify(latestState);
  const canonicalHash = sha256Hex(finalCanon);
  const waitWords = latestState.rng.streams['wait'] ?? [0, 0, 0, 0];

  return {
    env,
    allPassed: cases.every((c) => c.status === 'PASS'),
    cases,
    summaryState: {
      gold: latestState.gold,
      big: latestState.big,
      cycles: latestState.counters.cycles,
      attempts: latestState.counters.attempts,
      cursorMs: latestState.cursorMs,
      rngPreview: `wait=[${waitWords.join(',')}]`,
      canonicalHash,
    },
  };
}

/**
 * Representative 24-hour offline advancement benchmark (T06).
 * Runs both single-shot and frame-sliced (`maxNodes` per macrotask tick) and asserts exact canonical equality.
 */
export async function run24hOfflineBenchmark(maxNodesPerSlice = 250): Promise<Offline24hBenchmarkResult> {
  const env = detectRuntimeEnv();
  const startMs = 1_700_000_000_000;
  const duration24h = 24 * 60 * 60 * 1000;
  const targetMs = startMs + duration24h;

  const initial = createInitialState({
    saveEpoch: 'fe000-perf-24h',
    startMs,
    allowanceMs: duration24h,
  });

  // 1. Single-shot timing
  const tSingle0 = nowMs();
  const single = advanceOffline(initial, targetMs);
  const singleShotMs = Number((nowMs() - tSingle0).toFixed(3));

  // 2. Sliced (yielding to event loop between slices to measure frame blocking)
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

  const singleJson = canonicalStringify(single.state);
  const slicedJson = canonicalStringify(state);
  const singleEqualsSliced = singleJson === slicedJson;
  const canonicalHash = sha256Hex(singleJson);

  return {
    env,
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
    memorySnapshot: sampleMemory(),
  };
}
