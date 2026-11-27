import { SingleWriterSaveCoordinator as C } from '../../../../../tests/frontend/fe-000/.compiled-r6-verify/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.js';
import { createInitialState, advanceOffline } from '@idle-fishing/game-core';

const p = {
  kind: 'MEMORY',
  storageKey: 'verify.r5_01.after',
  disk: new Map(),
  marker: null,
  hidden: null,
  readTxState() { return this.marker; },
  writeTxState(t) { this.marker = t; },
  clearTxState() { this.marker = null; },
  async read(k) {
    if (k === this.hidden) throw new Error('temporary IO');
    return this.disk.get(k) ?? null;
  },
  async write(k, v) { this.disk.set(k, v); },
  async remove(k) { this.disk.delete(k); },
  async list() { return [...this.disk.keys()]; },
};

const a = new C(p);
const s = createInitialState({ saveEpoch: 'verify.r501', startMs: 1700000000000, allowanceMs: 3600000 });
const t = advanceOffline(s, s.cursorMs + 60000).state;
function record(label, v) {
  console.log(JSON.stringify({
    label,
    kind: v.kind,
    rev: v.revision ?? null,
    freeze: v.recoveryClassification ?? null,
    backupRev: v.readOnlyBackup?.revision ?? null,
    marker: p.marker ? JSON.parse(p.marker) : null,
    slots: [...p.disk].map(([k, b]) => [k, JSON.parse(b).revision, JSON.parse(JSON.parse(b).payload).gold]),
  }));
}

const r1 = await a.commit(s, null); record('1_seed_rev1', r1);
const r2 = await a.commit(t, '1'); record('2_commit_rev2', r2);
const r3 = await a.loadSafe(); record('3_confirmed_load_rev2', r3);
p.hidden = 'save_slot_1.json';
const r4 = await a.loadSafe(); record('4_partial_io_highest_unreadable', r4);
p.disk.delete(p.hidden);
p.hidden = null;
const r5 = await a.loadSafe(); record('5_recover_after_highest_vanished', r5);
const r6 = await a.commit(s, '1'); record('6_recommit_stale_s_as_rev2', r6);

const ok =
  r1.kind === 'COMMITTED' && r1.revision === '1' &&
  r2.kind === 'COMMITTED' && r2.revision === '2' &&
  r3.kind === 'VALID' && r3.revision === '2' &&
  r4.kind === 'STORAGE_UNAVAILABLE' && r4.recoveryClassification === 'PARTIAL_IO_UNAVAILABLE' &&
  r4.readOnlyBackup?.revision === '1' && JSON.parse(p.marker).confirmedRevision === '2' &&
  r5.kind === 'STORAGE_UNAVAILABLE' && r5.recoveryClassification === 'REVISION_REGRESSION_PENDING_RECOVERY' &&
  r5.readOnlyBackup?.revision === '1' &&
  r6.kind === 'STORAGE_UNAVAILABLE' && p.disk.size === 1;
console.log(JSON.stringify({ R5_01_AFTER_PASS: ok }));
process.exit(ok ? 0 : 1);
