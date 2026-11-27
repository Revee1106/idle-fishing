// BE-000-R1 reproducible Cocos probe source.
// Copy this file and dist/cocos/spike into a Cocos assets folder, then import
// this module from a scene script. See reports/backend/BE-000-R1/IMPLEMENTATION_REPORT.md.
import {
  advanceOffline,
  buildEnvelope,
  canonicalStringify,
  createInitialState,
  xoshiroStep,
} from './spike/index.mjs';

const step = xoshiroStep([1, 2, 3, 4]);
const initial = createInitialState({
  saveEpoch: 'epoch.be000',
  startMs: 1_700_000_000_000,
  allowanceMs: 86_400_000,
});
const finalState = advanceOffline(initial, initial.cursorMs + 86_400_000).state;
const envelope = buildEnvelope(finalState, '1');

export const spikeProbeValue = step.value;
export const spikeProbeState = canonicalStringify(step.state);

(globalThis as unknown as Record<string, unknown>).__BE000_PROBE__ = {
  value: step.value,
  state: spikeProbeState,
  finalState,
  sha256: envelope.sha256,
  text: envelope.text,
};