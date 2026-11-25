/**
 * SPIKE-ONLY 24h offline performance measurement.
 * Run: node tests/backend/be-000/perf.ts
 * There are no official thresholds in BE-000; numbers are environment-specific.
 */
import { performance } from 'node:perf_hooks';
import { canonicalStringify } from '../../../packages/game-core/src/spike/canonical-json.ts';
import { sha256Hex } from '../../../packages/game-core/src/spike/sha256.ts';
import {
  advanceOffline,
  advanceOfflineSliced,
  createInitialState,
} from '../../../packages/game-core/src/spike/offline.ts';
import { copyStateForCommit, buildEnvelope, SpikeFileSaveRepository } from '../../../packages/game-core/src/spike/save.ts';
import type { SpikeGameState } from '../../../packages/game-core/src/spike/types.ts';
import { MemoryFilePort } from './helpers.ts';

const START_MS = 1_700_000_000_000;
const DAY = 24 * 3_600_000;
const TARGET = START_MS + DAY;

function initial(): SpikeGameState {
  return createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: DAY });
}

function bytes(state: SpikeGameState): number {
  return Buffer.byteLength(canonicalStringify(state), 'utf8');
}

function measure(run: () => SpikeGameState, repeats: number): { ms: number; state: SpikeGameState; nodes: number } {
  let best = Number.POSITIVE_INFINITY;
  let state = initial();
  let nodes = 0;
  for (let i = 0; i < repeats + 1; i++) {
    const before = performance.now();
    const result = run();
    const elapsed = performance.now() - before;
    if (i > 0 && elapsed < best) best = elapsed;
    state = result;
  }
  return { ms: best, state, nodes };
}

async function main(): Promise<void> {
  const reference = advanceOffline(initial(), TARGET);
  const referenceHash = sha256Hex(canonicalStringify(reference.state));
  const referenceNodes = reference.processedNodes;
  const finalBytes = bytes(reference.state);

  const continuous = measure(() => advanceOffline(initial(), TARGET).state, 5);

  let currentNodes = 0;
  let nodes60 = 0;
  let budgetNodes = 0;

  const sliced600 = measure(() => {
    const result = advanceOfflineSliced(initial(), TARGET, 600_000);
    currentNodes = result.processedNodes;
    return result.state;
  }, 3);

  const sliced60 = measure(() => {
    const result = advanceOfflineSliced(initial(), TARGET, 60_000);
    nodes60 = result.processedNodes;
    return result.state;
  }, 3);

  const budget = measure(() => {
    let state = initial();
    let total = 0;
    while (state.cursorMs < TARGET) {
      const result = advanceOffline(state, TARGET, { maxNodes: 64 });
      total += result.processedNodes;
      state = result.state;
      if (result.processedNodes === 0 && !result.reachedTarget) throw new Error('budget made no progress');
    }
    budgetNodes = total;
    return state;
  }, 3);

  const checkpointStart = performance.now();
  const half = advanceOffline(initial(), START_MS + 12 * 3_600_000).state;
  const port = new MemoryFilePort();
  const repo = new SpikeFileSaveRepository(port);
  const commit = await repo.commit(half, null);
  if (commit.kind !== 'COMMITTED') throw new Error(`checkpoint commit failed: ${JSON.stringify(commit)}`);
  const loaded = await repo.load();
  if (loaded.kind !== 'VALID') throw new Error(`checkpoint load failed: ${JSON.stringify(loaded)}`);
  const resumed = advanceOffline(copyStateForCommit(loaded.raw as SpikeGameState), TARGET).state;
  const checkpointMs = performance.now() - checkpointStart;
  const checkpointHash = sha256Hex(canonicalStringify(resumed));

  const serializeStart = performance.now();
  const envelope = buildEnvelope(reference.state, '1');
  const serializeMs = performance.now() - serializeStart;

  const checks = {
    continuousMatchesReference: sha256Hex(canonicalStringify(continuous.state)) === referenceHash,
    sliced600MatchesReference: sha256Hex(canonicalStringify(sliced600.state)) === referenceHash,
    sliced60MatchesReference: sha256Hex(canonicalStringify(sliced60.state)) === referenceHash,
    budgetMatchesReference: sha256Hex(canonicalStringify(budget.state)) === referenceHash,
    checkpointMatchesReference: checkpointHash === referenceHash,
  };
  const counters = reference.state.counters;
  const report = {
    note: 'SPIKE-ONLY measurements; no official performance thresholds exist in BE-000.',
    environment: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: process.env.PROCESSOR_IDENTIFIER ?? 'unknown',
    },
    simulatedMs: DAY,
    simulatedHours: 24,
    eventNodes: referenceNodes,
    attempts: counters.attempts,
    events: counters.events,
    envChecks: counters.envChecks,
    finalStateBytes: finalBytes,
    compute: {
      continuousMs: Number(continuous.ms.toFixed(3)),
      sliced600sMs: Number(sliced600.ms.toFixed(3)),
      sliced60sMs: Number(sliced60.ms.toFixed(3)),
      nodeBudget64Ms: Number(budget.ms.toFixed(3)),
      checkpointSaveLoadResumeMs: Number(checkpointMs.toFixed(3)),
      serializeEnvelopeMs: Number(serializeMs.toFixed(3)),
    },
    slicedNodes: { sliced600: currentNodes, sliced60: nodes60, budget64: budgetNodes },
    memory: {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      note: 'single-process RSS/heap after all runs; not a per-save leak measurement',
    },
    checks,
    envelopeSha256: sha256Hex(envelope.text),
  };

  console.log(`24h nodes=${referenceNodes} attempts=${counters.attempts} events=${counters.events} envChecks=${counters.envChecks}`);
  console.log(`state=${finalBytes} bytes continuous=${report.compute.continuousMs}ms 600s-slices=${report.compute.sliced600sMs}ms 60s-slices=${report.compute.sliced60sMs}ms budget64=${report.compute.nodeBudget64Ms}ms`);
  console.log(`checkpoint=${report.compute.checkpointSaveLoadResumeMs}ms serialize=${report.compute.serializeEnvelopeMs}ms`);
  console.log('PERF_RESULT_JSON');
  console.log(JSON.stringify(report, null, 2));

  if (!Object.values(checks).every(Boolean)) {
    console.error('FAILED: one or more equality checks differ');
    process.exitCode = 1;
  }
}

await main();