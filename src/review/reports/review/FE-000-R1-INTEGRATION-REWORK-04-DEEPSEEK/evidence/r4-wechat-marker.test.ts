/**
 * Independent REWORK-04 WeChat transaction-marker regression (MOCK-WX ONLY; NOT real WeChat).
 * Covers marker round-trip, read/write/clear failures, truncation, deterministic slot failure,
 * cross-coordinator freeze/recovery, and list filtering.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceOffline, createInitialState, SLOT_PATHS, type SpikeGameState } from '@idle-fishing/game-core';
import { WeChatFilePort } from '../../../apps/game-client/assets/scripts/platform/WeChatFilePort';
import { FaultInjectingFilePort } from '../../../apps/game-client/assets/scripts/platform/FaultInjectingFilePort';
import { SingleWriterSaveCoordinator } from '../../../apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator';
import type { FilePort } from '../../../apps/game-client/assets/scripts/platform/PlatformTypes';

interface MockWx {
  wx: Record<string, unknown>;
  files: Map<string, string>;
  setFailReadOn(v: string | null): void;
  setFailWriteOn(v: string | null): void;
  setFailUnlinkOn(v: string | null): void;
  slotWrites: string[];
}

function createMockWx(): MockWx {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['wxfile://usr']);
  let failReadOn: string | null = null;
  let failWriteOn: string | null = null;
  let failUnlinkOn: string | null = null;
  const slotWrites: string[] = [];
  const fs = {
    accessSync(p: string) {
      if (!dirs.has(p) && !files.has(p)) throw new Error(`accessSync:fail no such file or directory ${p}`);
    },
    mkdirSync(p: string) {
      dirs.add(p);
    },
    readFileSync(p: string) {
      if (failReadOn && p.endsWith(failReadOn)) throw new Error(`readFileSync:fail permission denied ${p}`);
      if (!files.has(p)) throw new Error(`readFileSync:fail no such file or directory ${p}`);
      return files.get(p)!;
    },
    writeFileSync(p: string, data: string) {
      if (failWriteOn && p.endsWith(failWriteOn)) throw new Error(`writeFileSync:fail quota exceeded ${p}`);
      files.set(p, data);
      if (p.includes('save_slot_')) slotWrites.push(p);
    },
    unlinkSync(p: string) {
      if (failUnlinkOn && p.endsWith(failUnlinkOn)) throw new Error(`unlinkSync:fail permission denied ${p}`);
      if (!files.has(p)) throw new Error(`unlinkSync:fail no such file or directory ${p}`);
      files.delete(p);
    },
    readdirSync(dir: string) {
      const prefix = `${dir}/`;
      const out: string[] = [];
      for (const key of files.keys()) if (key.startsWith(prefix)) out.push(key.slice(prefix.length));
      return out;
    },
  };
  return {
    wx: { __FE000_MOCK__: true, env: { USER_DATA_PATH: 'wxfile://usr' }, getFileSystemManager: () => fs },
    files,
    setFailReadOn: (v) => { failReadOn = v; },
    setFailWriteOn: (v) => { failWriteOn = v; },
    setFailUnlinkOn: (v) => { failUnlinkOn = v; },
    slotWrites,
  };
}

function withMock<T>(fn: (mock: MockWx) => Promise<T>): Promise<T> {
  const prev = (globalThis as Record<string, unknown>).wx;
  const mock = createMockWx();
  (globalThis as Record<string, unknown>).wx = mock.wx;
  return fn(mock).finally(() => { (globalThis as Record<string, unknown>).wx = prev; });
}

function states(): { s0: SpikeGameState; s1: SpikeGameState; s2: SpikeGameState; s3: SpikeGameState } {
  const START = 1_700_000_000_000;
  const s0 = createInitialState({ saveEpoch: 'audit.r4.wx', startMs: START, allowanceMs: 3_600_000 });
  const s1 = advanceOffline(s0, START + 60_000).state;
  const s2 = advanceOffline(s1, START + 120_000).state;
  const s3 = advanceOffline(s2, START + 180_000).state;
  return { s0, s1, s2, s3 };
}

test('[MOCK-WX/REWORK-04/A02-MARKER-ROUNDTRIP] tx marker write/read/clear and list filtering', async () => {
  await withMock(async (mock) => {
    const port = new WeChatFilePort('r4_wx_marker_rt');
    assert.equal(await port.readTxState(), null);
    await port.writeTxState('marker-payload');
    assert.equal(await port.readTxState(), 'marker-payload');
    assert.deepEqual(await port.list(), []);
    assert.equal(mock.files.has('wxfile://usr/r4_wx_marker_rt/__tx_state__.json'), true);
    await port.clearTxState();
    assert.equal(await port.readTxState(), null);
  });
});

test('[MOCK-WX/REWORK-04/A02-MARKER-WRITE-FAIL] marker write failure -> STORAGE_UNAVAILABLE, zero slot writes', async () => {
  await withMock(async (mock) => {
    const { s0, s1, s2, s3 } = states();
    const port = new WeChatFilePort('r4_wx_marker_fail');
    const fault = new FaultInjectingFilePort(port);
    let slotWrites = 0;
    const counting: FilePort = {
      kind: 'FAULT_WRAPPER', storageKey: port.storageKey,
      readTxState: () => fault.readTxState(), writeTxState: (t) => fault.writeTxState(t), clearTxState: () => fault.clearTxState(),
      read: (p) => fault.read(p),
      write: async (p, t) => { if (p.includes('save_slot_')) slotWrites += 1; return fault.write(p, t); },
      remove: (p) => fault.remove(p), list: (d) => fault.list(d),
    };
    const coord = new SingleWriterSaveCoordinator(counting);
    assert.equal((await coord.loadSafe()).kind, 'EMPTY');
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    const before = slotWrites;
    mock.setFailWriteOn('__tx_state__.json');
    const res = await coord.commit(s2, '1');
    mock.setFailWriteOn(null);
    assert.equal(res.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(slotWrites, before, 'marker write failure must perform zero SLOT writes');
    const rec = await coord.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '1');
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');
  });
});

test('[MOCK-WX/REWORK-04/A02-MARKER-READ-FAIL] marker read failure -> commit/recovery fail-closed, zero writes', async () => {
  await withMock(async (mock) => {
    const { s1, s2 } = states();
    const port = new WeChatFilePort('r4_wx_marker_readfail');
    let slotWrites = 0;
    const counting: FilePort = {
      kind: 'WECHAT_FS', storageKey: port.storageKey,
      readTxState: () => port.readTxState(), writeTxState: (t) => port.writeTxState(t), clearTxState: () => port.clearTxState(),
      read: (p) => port.read(p),
      write: async (p, t) => { if (p.includes('save_slot_')) slotWrites += 1; return port.write(p, t); },
      remove: (p) => port.remove(p), list: (d) => port.list(d),
    };
    const coord = new SingleWriterSaveCoordinator(counting);
    await coord.loadSafe();
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    mock.setFailReadOn('__tx_state__.json');
    const before = slotWrites;
    const c = await coord.commit(s2, '1');
    const l = await coord.loadSafe();
    mock.setFailReadOn(null);
    assert.equal(c.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.kind === 'STORAGE_UNAVAILABLE' ? l.recoveryClassification : null, 'TX_STATE_UNREADABLE');
    assert.equal(slotWrites, before);
    const healed = await coord.loadSafe();
    assert.equal(healed.kind, 'VALID');
  });
});

test('[MOCK-WX/REWORK-04/A02-MARKER-CORRUPT] truncated/corrupt marker fails closed; commit blocked with zero writes', async () => {
  await withMock(async (mock) => {
    const { s1, s2 } = states();
    const port = new WeChatFilePort('r4_wx_marker_corrupt');
    const coord = new SingleWriterSaveCoordinator(port);
    await coord.loadSafe();
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    await port.write('__tx_state__.json', '{"version":1,"storageKey":"wechat:');
    const l = await coord.loadSafe();
    const c = await coord.commit(s2, '1');
    assert.equal(l.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(l.kind === 'STORAGE_UNAVAILABLE' ? l.recoveryClassification : null, 'TX_STATE_UNREADABLE');
    assert.equal(c.kind, 'STORAGE_UNAVAILABLE');
    const markerStill = await port.readTxState();
    assert.ok(markerStill && markerStill.length > 0);
    // The coordinator/loadSafe API cannot discard a corrupt marker; only raw-port deletion recovers.
    const l2 = await coord.loadSafe();
    assert.equal(l2.kind, 'STORAGE_UNAVAILABLE');
    await port.clearTxState();
    const l3 = await coord.loadSafe();
    assert.equal(l3.kind, 'VALID');
    assert.equal(mock.slotWrites.length, 1);
  });
});

test('[MOCK-WX/REWORK-04/A02-MARKER-CLEAR-FAIL] committed-but-clear-failed -> UNCERTAIN, marker retained, next commit blocked', async () => {
  await withMock(async (mock) => {
    const { s1, s2, s3 } = states();
    const port = new WeChatFilePort('r4_wx_marker_clearfail');
    const coord = new SingleWriterSaveCoordinator(port);
    await coord.loadSafe();
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    mock.setFailUnlinkOn('__tx_state__.json');
    const r = await coord.commit(s2, '1');
    mock.setFailUnlinkOn(null);
    assert.equal(r.kind, 'UNCERTAIN');
    assert.ok(await port.readTxState());
    assert.equal((await coord.commit(s3, '2')).kind, 'STORAGE_UNAVAILABLE');
    const rec = await coord.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '2');
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s3, '2')).kind, 'COMMITTED');
  });
});

test('[MOCK-WX/REWORK-04/A02-DETERMINISTIC-PREWRITE] slot pre-write fault -> FAILED, no freeze, marker cleared, retry works', async () => {
  await withMock(async (mock) => {
    const { s1, s2 } = states();
    const port = new WeChatFilePort('r4_wx_prewrite');
    const fault = new FaultInjectingFilePort(port);
    const coord = new SingleWriterSaveCoordinator(fault);
    await coord.loadSafe();
    assert.equal((await coord.commit(s1, null)).kind, 'COMMITTED');
    fault.armNextWriteFault('PRE_WRITE_ERROR');
    const r = await coord.commit(s2, '1');
    assert.equal(r.kind, 'FAILED');
    assert.equal(coord.storageHealth, 'AVAILABLE');
    assert.equal(await port.readTxState(), null);
    assert.equal((await coord.commit(s2, '1')).kind, 'COMMITTED');
  });
});

test('[MOCK-WX/REWORK-04/A02-CROSS-COORDINATOR] UNCERTAIN freezes second coordinator; explicit recovery then stale write CONFLICT', async () => {
  await withMock(async (mock) => {
    const { s1, s2, s3 } = states();
    const base = new WeChatFilePort('r4_wx_cross');
    let armed = false;
    let afterWrite = false;
    let slotWrites = 0;
    const wrapper: FilePort = {
      kind: 'WECHAT_FS', storageKey: base.storageKey,
      readTxState: () => base.readTxState(), writeTxState: (t) => base.writeTxState(t), clearTxState: () => base.clearTxState(),
      read: async (p) => {
        if (armed && afterWrite) throw new Error('read fault');
        return base.read(p);
      },
      write: async (p, t) => {
        if (p.includes('save_slot_')) slotWrites += 1;
        if (armed) { afterWrite = true; throw new Error('write fault before landing'); }
        return base.write(p, t);
      },
      remove: (p) => base.remove(p), list: (d) => base.list(d),
    };
    const port2 = new WeChatFilePort('r4_wx_cross');
    const coord1 = new SingleWriterSaveCoordinator(wrapper);
    const coord2 = new SingleWriterSaveCoordinator(port2);
    assert.equal(await coord1.storageKey, coord2.storageKey);
    await coord1.loadSafe();
    assert.equal((await coord1.commit(s1, null)).kind, 'COMMITTED');
    assert.equal((await coord1.commit(s2, '1')).kind, 'COMMITTED');
    armed = true;
    const unc = await coord1.commit(s3, '2');
    assert.equal(unc.kind, 'UNCERTAIN');
    assert.equal(coord1.storageHealth, 'STORAGE_UNAVAILABLE');
    assert.equal(coord2.storageHealth, 'STORAGE_UNAVAILABLE');
    const before = slotWrites;
    const blocked = await coord2.commit(s3, '2');
    assert.equal(blocked.kind, 'STORAGE_UNAVAILABLE');
    assert.equal(slotWrites, before);
    armed = false;
    const rec = await coord2.loadSafe();
    assert.equal(rec.kind, 'VALID');
    assert.equal(rec.kind === 'VALID' ? rec.revision : null, '2');
    assert.equal(await base.readTxState(), null);
    assert.equal((await coord2.commit(s3, '2')).kind, 'COMMITTED');
    const stale = await coord2.commit(s3, '2');
    assert.equal(stale.kind, 'CONFLICT');
    void SLOT_PATHS;
    void mock;
  });
});