/** Additional edge cases: partial-slot IO, recovery with recurring failure, freeze bypass surface. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const SNAP = 'C:/Users/WANGWENJIE10/AppData/Local/Temp/fe000-r2-snap';
const P = (rel) => pathToFileURL(path.join(SNAP, rel)).href;
const core = await import(P('node_modules/@idle-fishing/game-core/dist/spike/index.js'));
const { createInitialState, advanceOffline, SLOT_PATHS } = core;
const { BrowserFilePort } = await import(P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/BrowserFilePort.js'));
const { FilePortIoError } = await import(P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/WeChatFilePort.js'));
const { SingleWriterSaveCoordinator } = await import(P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.js'));

function mkLs() {
  const store = new Map();
  const faults = { failPaths: new Set() };
  const storage = {
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
    getItem(k) {
      if (faults.failPaths.has(String(k))) throw new Error('read fault');
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); },
  };
  return { storage, store, faults };
}
function own(ls) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => ls.storage });
  return () => {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
    else delete globalThis.localStorage;
  };
}
const state = (tag, d) => {
  const s0 = createInitialState({ saveEpoch: `epoch.${tag}`, startMs: 1_700_000_000_000, allowanceMs: 3_600_000 });
  return advanceOffline(s0, s0.cursorMs + d).state;
};
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: cond, detail });
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name} :: ${detail}`);
}

// E1: one slot unreadable, other two valid -> loadSafe VALID recovered=true, health AVAILABLE, commit blocks UNCERTAIN with 0 writes
{
  const ls = mkLs();
  const restore = own(ls);
  try {
    const ns = 'audit_e1';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    assert.equal((await coord.commit(state('e1', 60_000), null)).kind, 'COMMITTED');
    assert.equal((await coord.commit(state('e1', 120_000), '1')).kind, 'COMMITTED');
    ls.faults.failPaths.add(`${ns}:save_slot_1.json`);
    const load = await coord.loadSafe();
    const writesBefore = [...ls.store.keys()].length;
    const c2 = await coord.commit(state('e1', 180_000), '2');
    const writesAfter = [...ls.store.keys()].length;
    check('E1 partial-slot IO: load VALID recovered + health AVAILABLE + commit UNCERTAIN 0 writes',
      load.kind === 'VALID' && load.recovered === true && coord.storageHealth === 'AVAILABLE' && c2.kind === 'UNCERTAIN' && writesBefore === writesAfter,
      JSON.stringify({ loadKind: load.kind, recovered: load.recovered, health: coord.storageHealth, commitKind: c2.kind, writesBefore, writesAfter }));
  } finally { restore(); }
}

// E2: recovery with all slots corrupt (not IO) -> CORRUPT, health unchanged; commit refused without silent first-commit
{
  const ls = mkLs();
  const restore = own(ls);
  try {
    const ns = 'audit_e2';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    for (const p of SLOT_PATHS) ls.store.set(`${ns}:${p}`, '{not-json');
    const load = await coord.loadSafe();
    const c = await coord.commit(state('e2', 60_000), null);
    check('E2 corrupt slots: load CORRUPT, commit FAILED (no silent first commit)',
      load.kind === 'CORRUPT' && c.kind === 'FAILED' && !ls.store.get(`${ns}:save_slot_0.json`)?.startsWith('{"magic"'),
      JSON.stringify({ loadKind: load.kind, commitKind: c.kind }));
  } finally { restore(); }
}

// E3: freeze -> storage recovers -> write failure recurs -> frozen again, loadSafe later re-reads true data
{
  const ls = mkLs();
  const restore = own(ls);
  try {
    const ns = 'audit_e3';
    const coord = new SingleWriterSaveCoordinator(new BrowserFilePort(ns));
    await coord.loadSafe();
    assert.equal((await coord.commit(state('e3', 60_000), null)).kind, 'COMMITTED');
    // probe failure freeze
    const origSet = ls.storage.setItem.bind(ls.storage);
    ls.storage.setItem = (k, v) => { if (String(k).endsWith('__probe__')) throw new Error('probe'); return origSet(k, v); };
    assert.equal((await coord.commit(state('e3', 120_000), '1')).kind, 'STORAGE_UNAVAILABLE');
    // probe restored; explicit recovery succeeds
    ls.storage.setItem = origSet;
    assert.equal((await coord.loadSafe()).kind, 'VALID');
    // then write fails on the slot -> freeze again
    ls.storage.setItem = (k, v) => { if (String(k).includes('save_slot_')) throw new Error('slot write'); return origSet(k, v); };
    const again = await coord.commit(state('e3', 180_000), '1');
    const frozen = coord.storageHealth;
    ls.storage.setItem = origSet;
    const rec = await coord.loadSafe();
    check('E3 freeze->recovery->recurring write failure -> frozen again; final load re-reads rev1',
      again.kind === 'STORAGE_UNAVAILABLE' && frozen === 'STORAGE_UNAVAILABLE' && rec.kind === 'VALID' && rec.revision === '1' && coord.storageHealth === 'AVAILABLE',
      JSON.stringify({ again: again.kind, frozen, recRev: rec.revision, finalHealth: coord.storageHealth }));
  } finally { restore(); }
}

// E4: UnavailableFilePort (unknown host) - probe false, reads throw, no EMPTY/COMMITTED
{
  const { UnavailableFilePort } = await import(P('tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/WeChatFilePort.js'));
  const port = new UnavailableFilePort('NODE', 'audit_e4', 'no persistent storage');
  const coord = new SingleWriterSaveCoordinator(port);
  const load = await coord.loadSafe();
  const c = await coord.commit(state('e4', 60_000), null);
  let readThrew = false;
  try { await port.read(SLOT_PATHS[0]); } catch (e) { readThrew = e instanceof FilePortIoError; }
  check('E4 UnavailableFilePort fail-closed: load/commit STORAGE_UNAVAILABLE, direct read throws',
    load.kind === 'STORAGE_UNAVAILABLE' && c.kind === 'STORAGE_UNAVAILABLE' && readThrew && coord.storageHealth === 'STORAGE_UNAVAILABLE',
    JSON.stringify({ load: load.kind, commit: c.kind, readThrew, health: coord.storageHealth }));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n===== EDGE SUMMARY: ${results.length - failed.length}/${results.length} PASS =====`);
process.exit(failed.length ? 1 : 0);