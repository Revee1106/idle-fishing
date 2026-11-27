/**
 * SPIKE-ONLY shared module entry point (BE-000 / SPIKE-001 backend part).
 *
 * WARNING: this module verifies runtime mechanics (PRNG, canonical JSON,
 * SHA-256, integer work, save rotation, offline advancement). It does not
 * implement the eight production models, the real fishing state machine, or
 * any official numeric rules. Replace it with approved modules in IF-001+.
 */
export * from './types.ts';
export * from './canonical-json.ts';
export * from './sha256.ts';
export * from './prng.ts';
export * from './time.ts';
export * from './offline.ts';
export * from './save.ts';
export * from './migration.ts';