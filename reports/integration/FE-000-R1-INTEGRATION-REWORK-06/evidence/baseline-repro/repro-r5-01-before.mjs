import { SingleWriterSaveCoordinator as C } from '../../../../../tests/frontend/fe-000/.compiled-r6-repro/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.js';
import { createInitialState, advanceOffline } from '@idle-fishing/game-core';

const p = {
  kind: 'MEMORY',
  storageKey: 'repro.r5_01.before',
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
const s = createInitialState({ saveEpoch: 'repro.r501', startMs: 1700000000000, allowanceMs: 3600000 });
const t = advanceOffline(s, s.cursorMs + 60000).state;
const out = [];
function record(label, v) {
  const row = {
    label,
    kind: v.kind,
    rev: v.revision ?? null,
    freeze: v.recoveryClassification ?? null,
    marker: p.marker ? JSON.parse(p.marker) : null,
    slots: [...p.disk].map(([k, b]) => [k, JSON.parse(b).revision, JSON.parse(JSON.parse(b).payload).gold]),
  };
  out.push(row);
  console.log(JSON.stringify(row));
}

record('1_seed_rev1', await a.commit(s, null));
record('2_commit_rev2', await a.commit(t, '1'));
record('3_confirmed_load_rev2', await a.loadSafe());
p.hidden = 'save_slot_1.json';
record('4_partial_io_highest_unreadable', await a.loadSafe());
p.disk.delete(p.hidden);
p.hidden = null;
record('5_recover_after_highest_vanished', await a.loadSafe());
record('6_recommit_stale_s_as_rev2', await a.commit(s, '1'));



