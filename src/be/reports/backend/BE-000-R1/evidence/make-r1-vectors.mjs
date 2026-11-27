/**
 * BE-000-R1 vector update with an explicit, independent diff.
 * The old fixture is preserved in evidence/vectors/offline-vectors.pre-r1.json.
 * This script refuses to write unless every changed path is one of the fields
 * justified by the confirmed I04 checkpoint defect and the I05 attempt lock.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  advanceOffline,
  createInitialState,
} from '../../../../packages/game-core/src/spike/offline.ts';
import { canonicalStringify } from '../../../../packages/game-core/src/spike/canonical-json.ts';
import { buildEnvelope, parseEnvelope } from '../../../../packages/game-core/src/spike/save.ts';
import { workFromMs } from '../../../../packages/game-core/src/spike/time.ts';

const ROOT = new URL('../../../../', import.meta.url);
const OLD_PATH = fileURLToPath(new URL('./vectors/offline-vectors.pre-r1.json', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../../../../tests/backend/be-000/fixtures/offline-vectors.json', import.meta.url));
const START_MS = 1_700_000_000_000;
const HOUR = 3_600_000;

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function diffPaths(oldValue, newValue, prefix = '') {
  if (Object.is(oldValue, newValue)) return [];
  if (
    typeof oldValue !== 'object' || oldValue === null ||
    typeof newValue !== 'object' || newValue === null ||
    Array.isArray(oldValue) !== Array.isArray(newValue)
  ) {
    return [prefix];
  }
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    if (oldValue.length !== newValue.length) return [prefix];
    return oldValue.flatMap((value, index) => diffPaths(value, newValue[index], `${prefix}[${index}]`));
  }
  const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
  return [...keys].flatMap((key) =>
    diffPaths(
      Object.prototype.hasOwnProperty.call(oldValue, key) ? oldValue[key] : undefined,
      Object.prototype.hasOwnProperty.call(newValue, key) ? newValue[key] : undefined,
      prefix ? `${prefix}.${key}` : key
    )
  );
}

const oldFixture = JSON.parse(await readFile(OLD_PATH, 'utf8'));
const initial = createInitialState({ saveEpoch: 'epoch.be000', startMs: START_MS, allowanceMs: 24 * HOUR });
const oneHour = advanceOffline(initial, START_MS + HOUR).state;
const eightHours = advanceOffline(initial, START_MS + 8 * HOUR).state;

const initialCanonical = canonicalStringify(initial);
const oneHourCanonical = canonicalStringify(oneHour);
const eightHourCanonical = canonicalStringify(eightHours);

const initialDiff = diffPaths(JSON.parse(oldFixture.initial.canonical), JSON.parse(initialCanonical));
assert.deepEqual(initialDiff, [], 'initial state must be unchanged by the R1 fixes');
assert.equal(initialCanonical, oldFixture.initial.canonical);

const oneHourDiff = diffPaths(JSON.parse(oldFixture.afterOneHour.canonical), JSON.parse(oneHourCanonical));
assert.deepEqual(oneHourDiff, ['offline.settledUntilMs'], '1h change must be the checkpoint only');
const oldOneHour = JSON.parse(oldFixture.afterOneHour.canonical);
const newOneHour = JSON.parse(oneHourCanonical);
assert.equal(oldOneHour.offline.settledUntilMs, START_MS);
assert.equal(newOneHour.offline.settledUntilMs, START_MS + HOUR);
assert.equal(newOneHour.offline.settledUntilMs, newOneHour.cursorMs);
assert.equal(newOneHour.stage, 'WAITING');
assert.equal(newOneHour.attemptLock, undefined);

const eightHourDiff = diffPaths(JSON.parse(oldFixture.afterEightHours.canonical), JSON.parse(eightHourCanonical));
assert.deepEqual(
  eightHourDiff.sort(),
  ['attemptLock', 'offline.settledUntilMs'].sort(),
  '8h change must be the checkpoint plus the newly persisted FIGHTING plan'
);
const oldEight = JSON.parse(oldFixture.afterEightHours.canonical);
const newEight = JSON.parse(eightHourCanonical);
assert.equal(oldEight.offline.settledUntilMs, START_MS);
assert.equal(newEight.offline.settledUntilMs, START_MS + 8 * HOUR);
assert.equal(newEight.offline.settledUntilMs, newEight.cursorMs);
assert.equal(newEight.stage, 'FIGHTING');
const lock = newEight.attemptLock;
assert.equal(lock.seq, newEight.counters.attempts);
assert.equal(lock.claimKey, `fish:${lock.seq}`);
assert.ok(lock.speciesU >= 0 && lock.speciesU < 1);
assert.ok(lock.captureU >= 0 && lock.captureU < 1);
assert.equal(workFromMs(lock.fightMs), newEight.stageRequired);
for (const key of [
  'big', 'claims', 'counters', 'cursorMs', 'envActivityMicro', 'envNextCheckMs',
  'gold', 'lastTerminalAttemptSeq', 'rng', 'rootSeed', 'saveEpoch', 'schemaVersion',
  'stage', 'stageDone', 'stageRequired', 'stageStartMs',
]) {
  assert.deepEqual(newEight[key], oldEight[key], `8h field ${key} must not change`);
}

const envelope = buildEnvelope(oneHour, '1');
assert.equal(envelope.payload, oneHourCanonical);
const parsed = parseEnvelope(envelope.text);
assert.equal(parsed.ok, true);
const payloadSha256 = sha256(envelope.payload);
const envelopeSha256 = sha256(envelope.text);

const updated = {
  ...oldFixture,
  initial: {
    canonical: initialCanonical,
    sha256: sha256(initialCanonical),
  },
  afterOneHour: {
    ...oldFixture.afterOneHour,
    canonical: oneHourCanonical,
    sha256: sha256(oneHourCanonical),
    counters: oneHour.counters,
    gold: oneHour.gold,
    big: oneHour.big,
    lastTerminalAttemptSeq: oneHour.lastTerminalAttemptSeq,
    envActivityMicro: oneHour.envActivityMicro,
  },
  afterEightHours: {
    ...oldFixture.afterEightHours,
    canonical: eightHourCanonical,
    sha256: sha256(eightHourCanonical),
    counters: eightHours.counters,
    gold: eightHours.gold,
    big: eightHours.big,
    lastTerminalAttemptSeq: eightHours.lastTerminalAttemptSeq,
  },
  saveEnvelope: {
    ...oldFixture.saveEnvelope,
    revision: envelope.envelope.revision,
    payloadSha256,
    envelopeSha256,
  },
};

await writeFile(OUT_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
console.log('R1 vector diff accepted:');
console.log(`  initial changed paths: ${initialDiff.length === 0 ? '(none)' : initialDiff.join(', ')}`);
console.log(`  1h changed paths: ${oneHourDiff.join(', ')}`);
console.log(`  8h changed paths: ${eightHourDiff.join(', ')}`);
console.log(`  initial sha256=${updated.initial.sha256}`);
console.log(`  1h sha256=${updated.afterOneHour.sha256}`);
console.log(`  8h sha256=${updated.afterEightHours.sha256}`);
console.log(`  payload sha256=${payloadSha256}`);
console.log(`  envelope sha256=${envelopeSha256}`);
console.log(`  root=${fileURLToPath(ROOT)}`);