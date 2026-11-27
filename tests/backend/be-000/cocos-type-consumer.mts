// Strict TypeScript consumer for the actual Cocos .mjs entry point.
// This file is compiled by tsconfig.cocos-consumer.json after build:cocos.
import {
  advanceOffline,
  buildEnvelope,
  createInitialState,
  xoshiroStep,
} from '../../../packages/game-core/dist/cocos/spike/index.mjs';

const step = xoshiroStep([1, 2, 3, 4]);
if (step.value !== 11520) throw new Error('unexpected xoshiro step');

const initial = createInitialState({
  saveEpoch: 'epoch.consumer',
  startMs: 1_700_000_000_000,
  allowanceMs: 3_600_000,
});
const advanced = advanceOffline(initial, initial.cursorMs + 1000).state;
const envelope = buildEnvelope(advanced, '1');

export const consumerProbe = {
  value: step.value,
  stage: advanced.stage,
  sha256: envelope.sha256,
};