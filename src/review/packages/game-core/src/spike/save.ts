/**
 * SPIKE-ONLY three-slot save protocol.
 * - envelope: magic/format/revision/epoch/payload/sha256
 * - hash input: canonical JSON of [magic, format, revision, epoch, payload]
 * - commit writes + reads back + verifies; uncertain writes are rescanned,
 *   never blindly retried
 * This experiment does not implement deletion markers or real WeChat storage.
 */
import { canonicalStringify, isNat, natToBigInt, natFromBigInt } from './canonical-json.ts';
import { validateRngState } from './prng.ts';
import { sha256Hex } from './sha256.ts';
import type {
  Nat,
  SpikeCommitResult,
  SpikeEnvelope,
  SpikeFilePort,
  SpikeGameState,
  SpikeLoadResult,
  SpikeSaveRepository,
} from './types.ts';

export const SAVE_MAGIC = 'IDLE_FISHING' as const;
export const SAVE_FORMAT = 1 as const;
export const SAVE_SLOT_COUNT = 3;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2];

export const SLOT_PATHS = ['save_slot_0.json', 'save_slot_1.json', 'save_slot_2.json'] as const;

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const STAGES = new Set(['IDLE', 'CASTING', 'WAITING', 'FIGHTING', 'PREPARING']);

export interface StateValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function validateSpikeState(raw: unknown): StateValidationIssue[] {
  const issues: StateValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    add('$', 'state must be an object');
    return issues;
  }
  const s = raw as Record<string, unknown>;
  const schemaVersion = s.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    add('schemaVersion', 'unsupported schemaVersion');
  }
  if (typeof s.saveEpoch !== 'string' || !ID_PATTERN.test(s.saveEpoch)) {
    add('saveEpoch', 'must be a non-empty id');
  }
  if (typeof s.rootSeed !== 'number' || !Number.isInteger(s.rootSeed) || s.rootSeed < 0 || s.rootSeed > 0xffffffff) {
    add('rootSeed', 'must be a uint32');
  }
  if (typeof s.cursorMs !== 'number' || !Number.isSafeInteger(s.cursorMs) || s.cursorMs < 0) {
    add('cursorMs', 'must be a non-negative safe integer');
  }
  if (!isNat(s.gold)) add('gold', 'must be a Nat string');
  const rng = s.rng;
  if (typeof rng !== 'object' || rng === null) {
    add('rng', 'must be an object');
  } else {
    try {
      validateRngState(rng as SpikeGameState['rng']);
    } catch (error) {
      add('rng', (error as Error).message);
    }
  }

  if (schemaVersion === 1) {
    if (typeof s.counter !== 'number' || !Number.isSafeInteger(s.counter) || s.counter < 0) {
      add('counter', 'must be a non-negative safe integer');
    }
    return issues;
  }

  if (typeof s.stage !== 'string' || !STAGES.has(s.stage)) add('stage', 'invalid stage');
  if (typeof s.stageStartMs !== 'number' || !Number.isSafeInteger(s.stageStartMs) || s.stageStartMs < 0) {
    add('stageStartMs', 'must be a non-negative safe integer');
  }
  if (!isNat(s.stageDone)) add('stageDone', 'must be a Nat string');
  if (!isNat(s.stageRequired)) add('stageRequired', 'must be a Nat string');
  if (!isNat(s.big)) add('big', 'must be a Nat string');
  if (!isNat(s.lastTerminalAttemptSeq)) add('lastTerminalAttemptSeq', 'must be a Nat string');
  if (typeof s.envNextCheckMs !== 'number' || !Number.isSafeInteger(s.envNextCheckMs) || s.envNextCheckMs < 0) {
    add('envNextCheckMs', 'must be a non-negative safe integer');
  }
  if (
    typeof s.envActivityMicro !== 'number' ||
    !Number.isSafeInteger(s.envActivityMicro) ||
    s.envActivityMicro <= 0
  ) {
    add('envActivityMicro', 'must be a positive safe integer');
  }
  const counters = s.counters as Record<string, unknown> | undefined;
  if (typeof counters !== 'object' || counters === null) {
    add('counters', 'must be an object');
  } else {
    for (const key of ['attempts', 'casts', 'waits', 'fights', 'prepares', 'cycles', 'envChecks', 'events']) {
      const value = counters[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        add(`counters.${key}`, 'must be a non-negative safe integer');
      }
    }
  }
  if (!Array.isArray(s.claims) || s.claims.some((c) => typeof c !== 'string')) {
    add('claims', 'must be an array of strings');
  } else if (new Set(s.claims).size !== s.claims.length) {
    add('claims', 'claim keys must be unique');
  }
  const offline = s.offline;
  if (offline !== null && offline !== undefined) {
    if (typeof offline !== 'object' || Array.isArray(offline)) {
      add('offline', 'must be null or an object');
    } else {
      const o = offline as Record<string, unknown>;
      for (const key of ['startedMs', 'allowanceMs', 'deadlineMs', 'settledUntilMs']) {
        const value = o[key];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
          add(`offline.${key}`, 'must be a non-negative safe integer');
        }
      }
      if (
        typeof o.startedMs === 'number' &&
        typeof o.allowanceMs === 'number' &&
        o.allowanceMs <= 0
      ) {
        add('offline.allowanceMs', 'must be positive');
      }
    }
  }
  return issues;
}

export function computeEnvelopeHash(
  magic: string,
  format: number,
  revision: string,
  epoch: string,
  payload: string
): string {
  return sha256Hex(canonicalStringify([magic, format, revision, epoch, payload]));
}

export interface BuiltEnvelope {
  readonly envelope: SpikeEnvelope;
  readonly text: string;
  readonly payload: string;
  readonly sha256: string;
}

export function buildEnvelope(state: Readonly<SpikeGameState>, revision: Nat): BuiltEnvelope {
  if (!isNat(revision)) throw new Error(`Invalid revision Nat: ${revision}`);
  const payload = canonicalStringify(state);
  const sha256 = computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, revision, state.saveEpoch, payload);
  const envelope: SpikeEnvelope = {
    magic: SAVE_MAGIC,
    format: SAVE_FORMAT,
    revision,
    epoch: state.saveEpoch,
    payload,
    sha256,
  };
  return { envelope, text: canonicalStringify(envelope), payload, sha256 };
}

export interface ParsedEnvelope {
  readonly envelope: SpikeEnvelope;
  readonly state: unknown;
  readonly schemaVersion: number;
  readonly revision: Nat;
}

export type EnvelopeParse = { ok: true; value: ParsedEnvelope } | { ok: false; detail: string };

export function parseEnvelope(text: string): EnvelopeParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, detail: 'invalid JSON' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'envelope is not an object' };
  }
  const e = raw as Record<string, unknown>;
  if (e.magic !== SAVE_MAGIC) return { ok: false, detail: 'bad magic' };
  if (e.format !== SAVE_FORMAT) return { ok: false, detail: 'bad format' };
  if (!isNat(e.revision)) return { ok: false, detail: 'bad revision' };
  if (typeof e.epoch !== 'string' || e.epoch.length === 0) return { ok: false, detail: 'bad epoch' };
  if (typeof e.payload !== 'string') return { ok: false, detail: 'bad payload' };
  if (typeof e.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.sha256)) {
    return { ok: false, detail: 'bad sha256' };
  }
  const expected = computeEnvelopeHash(SAVE_MAGIC, SAVE_FORMAT, e.revision, e.epoch, e.payload);
  if (expected !== e.sha256) return { ok: false, detail: 'sha256 mismatch' };

  let state: unknown;
  try {
    state = JSON.parse(e.payload);
  } catch {
    return { ok: false, detail: 'payload is not JSON' };
  }
  if (canonicalStringify(state) !== e.payload) {
    return { ok: false, detail: 'payload is not canonical JSON' };
  }
  const schemaVersion = (state as { schemaVersion?: unknown }).schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    return { ok: false, detail: 'missing or invalid schemaVersion' };
  }
  if (SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    const issues = validateSpikeState(state);
    if (issues.length > 0) {
      return { ok: false, detail: `state invalid: ${issues.map((i) => i.path).join(',')}` };
    }
    if ((state as { saveEpoch: unknown }).saveEpoch !== e.epoch) {
      return { ok: false, detail: 'epoch mismatch between envelope and state' };
    }
  }
  return { ok: true, value: { envelope: e as unknown as SpikeEnvelope, state, schemaVersion, revision: e.revision } };
}

interface SlotRead {
  readonly slot: number;
  readonly path: string;
  readonly text: string | null;
  readonly ioError: boolean;
  readonly parsed: ParsedEnvelope | null;
  readonly parseIssue: string | null;
}

export class SpikeFileSaveRepository implements SpikeSaveRepository {
  private readonly port: SpikeFilePort;

  constructor(port: SpikeFilePort) {
    this.port = port;
  }

  private async readSlots(): Promise<SlotRead[]> {
    const slots: SlotRead[] = [];
    for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
      const path = SLOT_PATHS[slot]!;
      let text: string | null = null;
      let ioError = false;
      try {
        text = await this.port.read(path);
      } catch {
        ioError = true;
      }
      if (ioError) {
        slots.push({ slot, path, text: null, ioError: true, parsed: null, parseIssue: 'io error' });
        continue;
      }
      if (text === null) {
        slots.push({ slot, path, text: null, ioError: false, parsed: null, parseIssue: null });
        continue;
      }
      const parsed = parseEnvelope(text);
      if (!parsed.ok) {
        slots.push({ slot, path, text, ioError: false, parsed: null, parseIssue: parsed.detail });
      } else {
        slots.push({ slot, path, text, ioError: false, parsed: parsed.value, parseIssue: null });
      }
    }
    return slots;
  }

  async load(): Promise<SpikeLoadResult> {
    const slots = await this.readSlots();
    const valid = slots
      .filter((s): s is SlotRead & { parsed: ParsedEnvelope } => s.parsed !== null)
      .sort((a, b) => {
        const ra = natToBigInt(a.parsed.revision);
        const rb = natToBigInt(b.parsed.revision);
        if (ra !== rb) return ra > rb ? -1 : 1;
        return a.slot - b.slot;
      });

    if (valid.length === 0) {
      const anyPresent = slots.some((s) => s.ioError || s.text !== null);
      if (!anyPresent) return { kind: 'EMPTY' };
      const reasons = slots
        .filter((s) => s.ioError || s.parseIssue !== null)
        .map((s) => `${s.path}: ${s.parseIssue ?? 'unreadable'}`);
      return { kind: 'CORRUPT', detail: reasons.join('; ') };
    }

    const top = valid[0]!;
    const sameRevision = valid.filter(
      (s) => natToBigInt(s.parsed.revision) === natToBigInt(top.parsed.revision)
    );
    const distinctPayloads = new Set(sameRevision.map((s) => s.parsed.envelope.sha256));
    if (distinctPayloads.size > 1) {
      return { kind: 'CORRUPT', detail: 'multiple valid slots share a revision but differ' };
    }
    const epochs = new Set(valid.map((s) => s.parsed.envelope.epoch));
    if (epochs.size > 1) {
      return { kind: 'CORRUPT', detail: 'multiple valid epochs present' };
    }

    const schemaVersion = top.parsed.schemaVersion;
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
      return { kind: 'UNSUPPORTED', detail: `schema ${schemaVersion}` };
    }

    const warnings: string[] = [];
    let recovered = false;
    for (const s of slots) {
      if (s.ioError) {
        recovered = true;
        warnings.push(`${s.path}: io error`);
      } else if (s.text !== null && s.parsed === null) {
        recovered = true;
        warnings.push(`${s.path}: ${s.parseIssue}`);
      }
    }
    if (valid.length > 1) {
      warnings.push(`selected slot ${top.slot} at revision ${top.parsed.revision}`);
    }

    return {
      kind: 'VALID',
      raw: top.parsed.state,
      schemaVersion,
      epoch: top.parsed.envelope.epoch,
      revision: top.parsed.revision,
      recovered,
      warnings,
    };
  }

  async commit(state: Readonly<SpikeGameState>, expectedRevision: Nat | null): Promise<SpikeCommitResult> {
    const issues = validateSpikeState(state);
    if (issues.length > 0) {
      return { kind: 'FAILED', detail: `state invalid: ${issues.map((i) => i.path).join(',')}` };
    }
    if (expectedRevision !== null && !isNat(expectedRevision)) {
      return { kind: 'FAILED', detail: 'expectedRevision must be a Nat or null' };
    }

    const slots = await this.readSlots();
    const valid = slots
      .filter((s): s is SlotRead & { parsed: ParsedEnvelope } => s.parsed !== null)
      .sort((a, b) => {
        const ra = natToBigInt(a.parsed.revision);
        const rb = natToBigInt(b.parsed.revision);
        if (ra !== rb) return rb > ra ? 1 : -1;
        return a.slot - b.slot;
      });

    if (slots.every((s) => s.ioError)) {
      return { kind: 'FAILED', detail: 'cannot determine current revision: all slot reads failed' };
    }
    if (valid.length === 0) {
      const anyPresent = slots.some((s) => s.text !== null);
      if (anyPresent) {
        return { kind: 'FAILED', detail: 'existing unreadable slots; refusing silent first commit' };
      }
      if (expectedRevision !== null) {
        return { kind: 'CONFLICT', detail: 'expectedRevision set but no valid slot exists' };
      }
    } else {
      const top = valid[0]!;
      if (!SUPPORTED_SCHEMA_VERSIONS.includes(top.parsed.schemaVersion)) {
        return { kind: 'FAILED', detail: `cannot commit over unsupported schema ${top.parsed.schemaVersion}` };
      }
      if (expectedRevision === null) {
        return { kind: 'CONFLICT', detail: 'expectedRevision null but a valid slot exists' };
      }
      if (natToBigInt(expectedRevision) !== natToBigInt(top.parsed.revision)) {
        return { kind: 'CONFLICT', detail: 'expectedRevision does not match highest revision' };
      }
      if (state.saveEpoch !== top.parsed.envelope.epoch) {
        return { kind: 'CONFLICT', detail: 'state epoch differs from current epoch' };
      }
    }

    const newRevision = expectedRevision === null ? 1n : natToBigInt(expectedRevision) + 1n;
    const revisionNat = natFromBigInt(newRevision);
    const built = buildEnvelope(state, revisionNat);

    const writable: SlotRead[] = [];
    for (const s of slots) {
      if (s.ioError) continue;
      if (s.text === null || s.parsed === null) writable.push(s);
    }
    let target: SlotRead | null = null;
    if (writable.length > 0) {
      target = writable[0]!;
    } else {
      const top = valid[0]!;
      const candidates = valid
        .filter((s) => s.slot !== top.slot)
        .sort((a, b) => {
          const ra = natToBigInt(a.parsed.revision);
          const rb = natToBigInt(b.parsed.revision);
          if (ra !== rb) return ra < rb ? -1 : 1;
          return a.slot - b.slot;
        });
      target = candidates[0] ?? null;
    }
    if (target === null) {
      return { kind: 'FAILED', detail: 'no slot can be overwritten without losing the highest revision' };
    }

    try {
      await this.port.write(target.path, built.text);
    } catch {
      return this.resolveUncertainWrite(built.sha256, revisionNat, expectedRevision);
    }

    let readback: string | null;
    try {
      readback = await this.port.read(target.path);
    } catch {
      return this.resolveUncertainWrite(built.sha256, revisionNat, expectedRevision);
    }
    if (readback !== built.text) {
      return this.resolveUncertainWrite(built.sha256, revisionNat, expectedRevision);
    }
    return { kind: 'COMMITTED', revision: revisionNat, slot: target.slot, recoveredFromUncertainWrite: false };
  }

  private async resolveUncertainWrite(
    sha256: string,
    newRevision: Nat,
    expectedRevision: Nat | null
  ): Promise<SpikeCommitResult> {
    let slots: SlotRead[];
    try {
      slots = await this.readSlots();
    } catch {
      return { kind: 'UNCERTAIN', detail: 'write result unknown; rescan failed' };
    }
    const claimed = slots.find(
      (s) =>
        s.parsed !== null &&
        s.parsed.envelope.sha256 === sha256 &&
        natToBigInt(s.parsed.revision) === natToBigInt(newRevision)
    );
    if (claimed !== undefined) {
      return {
        kind: 'COMMITTED',
        revision: newRevision,
        slot: claimed.slot,
        recoveredFromUncertainWrite: true,
      };
    }
    const top = slots
      .filter((s): s is SlotRead & { parsed: ParsedEnvelope } => s.parsed !== null)
      .sort((a, b) => {
        const ra = natToBigInt(a.parsed.revision);
        const rb = natToBigInt(b.parsed.revision);
        return ra === rb ? a.slot - b.slot : rb > ra ? 1 : -1;
      })[0];
    const currentRevision = top ? natToBigInt(top.parsed.revision) : null;
    const expectedBig = expectedRevision === null ? null : natToBigInt(expectedRevision);
    if ((currentRevision === null && expectedBig === null) || (currentRevision !== null && currentRevision === expectedBig)) {
      return { kind: 'FAILED', detail: 'SAVE_IO: write not observed; persisted revision unchanged' };
    }
    return { kind: 'UNCERTAIN', detail: 'write result could not be confirmed' };
  }
}

/** Build a snapshot copy safe for save/restore experiments. */
export function copyStateForCommit(state: Readonly<SpikeGameState>): SpikeGameState {
  return JSON.parse(canonicalStringify(state)) as SpikeGameState;
}