/**
 * SPIKE-ONLY deterministic PRNG: xoshiro128** v1 with the project's
 * FNV-1a stream-name derivation (docs/interfaces/19, E09).
 * No Math.random. Every draw consumes exactly two next32 calls.
 */
import { utf8Bytes } from './canonical-json.ts';
import type { RngWords, SpikeRngState } from './types.ts';

export const PRNG_ALGORITHM = 'XOSHIRO128SS_V1' as const;

export class PrngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrngError';
  }
}

export function rotl32(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  const bytes = utf8Bytes(text);
  for (const byte of bytes) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mix32(value: number): number {
  let v = value >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x85ebca6b) >>> 0;
  v = Math.imul(v ^ (v >>> 13), 0xc2b2ae35) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return v;
}

export function deriveStreamWords(rootSeed: number, streamName: string): RngWords {
  if (!Number.isInteger(rootSeed) || rootSeed < 0 || rootSeed > 0xffffffff) {
    throw new PrngError(`rootSeed must be a uint32: ${rootSeed}`);
  }
  if (streamName.length === 0) throw new PrngError('stream name must be non-empty');
  let z = (rootSeed ^ fnv1a32(streamName)) >>> 0;
  const words: number[] = [];
  for (let i = 0; i < 4; i++) {
    z = (z + 0x9e3779b9) >>> 0;
    words.push(mix32(z));
  }
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0) words[0] = 1;
  return [words[0]!, words[1]!, words[2]!, words[3]!];
}

/** One xoshiro128** step; returns output and next state without mutating input. */
export function xoshiroStep(words: RngWords): { value: number; state: RngWords } {
  const [s0, s1, s2, s3] = words;
  const result = Math.imul(rotl32(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (s1 << 9) >>> 0;
  const n2 = (s2 ^ s0) >>> 0;
  const n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;
  const final2 = (n2 ^ t) >>> 0;
  const final3 = rotl32(n3, 11);
  return { value: result, state: [n0, n1, final2, final3] };
}

export function nextU53FromWords(words: RngWords): { u: number; state: RngWords } {
  const a = xoshiroStep(words);
  const b = xoshiroStep(a.state);
  const hi = a.value >>> 5;
  const lo = b.value >>> 6;
  return { u: (hi * 67108864 + lo) / 9007199254740992, state: b.state };
}

export function validateRngState(state: SpikeRngState): void {
  if (state.algorithm !== PRNG_ALGORITHM) throw new PrngError('Unsupported RNG algorithm');
  // Streams are initialized lazily, so an empty map is valid for a fresh state.
  const names = Object.keys(state.streams);
  for (const name of names) {
    if (name.length === 0) throw new PrngError('Empty stream name');
    const words = state.streams[name]!;
    if (!Array.isArray(words) || words.length !== 4) throw new PrngError(`Bad stream words: ${name}`);
    for (const w of words) {
      if (!Number.isInteger(w) || w < 0 || w > 0xffffffff) throw new PrngError(`Bad word: ${name}`);
    }
    if (words.every((w) => w === 0)) throw new PrngError(`All-zero stream: ${name}`);
  }
}

export function cloneRngState(state: Readonly<SpikeRngState>): SpikeRngState {
  const streams: Record<string, RngWords> = {};
  for (const name of Object.keys(state.streams)) {
    const w = state.streams[name]!;
    streams[name] = [w[0], w[1], w[2], w[3]];
  }
  return { algorithm: PRNG_ALGORITHM, streams };
}

/** Draw one U53. Initializes the stream lazily on a copy; other streams are untouched. */
export function drawU53(
  state: Readonly<SpikeRngState>,
  rootSeed: number,
  streamName: string
): { u: number; state: SpikeRngState } {
  validateRngState(state);
  const current = state.streams[streamName] ?? deriveStreamWords(rootSeed, streamName);
  const { u, state: nextWords } = nextU53FromWords(current);
  const streams: Record<string, RngWords> = {};
  for (const name of Object.keys(state.streams)) {
    if (name !== streamName) {
      const w = state.streams[name]!;
      streams[name] = [w[0], w[1], w[2], w[3]];
    }
  }
  streams[streamName] = nextWords;
  return { u, state: { algorithm: PRNG_ALGORITHM, streams } };
}

export function newRngState(): SpikeRngState {
  return { algorithm: PRNG_ALGORITHM, streams: {} };
}