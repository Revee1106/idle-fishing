// Strict TS consumer of the actual Cocos .mjs entry (pre-rework repro).
import { xoshiroStep } from '../../../../../packages/game-core/dist/cocos/spike/index.mjs';

const step = xoshiroStep([1, 2, 3, 4]);
export const value: number = step.value;