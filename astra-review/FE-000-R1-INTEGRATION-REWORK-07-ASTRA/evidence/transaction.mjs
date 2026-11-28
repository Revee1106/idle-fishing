import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const load = rel => import(pathToFileURL(path.resolve(rel)).href);
const base = 'tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/';
const { MemoryFilePort } = await load(base + 'BrowserFilePort.js');
const { SingleWriterSaveCoordinator } = await load(base + 'SingleWriterSaveCoordinator.js');
const { createInitialState, advanceOffline } = await load('packages/game-core/dist/cocos/spike/index.mjs');
const seed = createInitialState({saveEpoch:'astra-capacity',startMs:1700000000000,allowanceMs:28800000});
const pending = advanceOffline(seed, seed.cursorMs + 3600000).state;
for (const fault of ['readback','history','clear','none']) {
  const port = new MemoryFilePort(2304, 'astra-transaction-'+fault);
  let stage='quota';
  let wrote=false;
  const write = port.write.bind(port);
  port.write = async (k,v) => {
    await write(k,v);
    if (k.startsWith('save_slot_')) wrote=true;
  };
  const read = port.read.bind(port);
  port.read=async k=>{
    if (stage==='readback' && wrote && k.startsWith('save_slot_')) throw Error('readback unavailable');
    return read(k);
  };
  const histWrite=port.writeSaveHistoryState?.bind(port) ?? port.writeHistoryState?.bind(port);
  const histKey=typeof port.writeSaveHistoryState==='function'?'writeSaveHistoryState':'writeHistoryState';
  assert.ok(histWrite,'history port');
  port[histKey]=async v=>{
    if (stage==='history') throw Error('history unavailable');
    return histWrite(v);
  };
  const clear=port.clearTxState.bind(port);
  port.clearTxState=async()=>{
    if (stage==='clear') throw Error('clear unavailable');
    return clear();
  };
  const coord=new SingleWriterSaveCoordinator(port);
  const first=await coord.commit(pending,null);
  assert.equal(first.kind,'STORAGE_UNAVAILABLE');
  stage=fault;
  port.maxBytes=1<<20;
  const result=await coord.loadSafe({initialCommitState:pending});
  const marker=await port.readTxState();
  const disk=await read('save_slot_0.json');
  console.log(JSON.stringify({fault,kind:result.kind,classification:result.recoveryClassification,marker:marker&&JSON.parse(marker),diskRevision:disk&&JSON.parse(disk).revision,rawIdentical:result.raw&&JSON.stringify(result.raw)===JSON.stringify(pending)}));
  if (fault==='none'){
    assert.equal(result.kind,'VALID'); assert.deepEqual(result.raw,pending); assert.equal(marker,null);
    assert.equal((await new SingleWriterSaveCoordinator(port).loadSafe()).revision,'1');
  }else{assert.equal(result.kind,'STORAGE_UNAVAILABLE'); assert.ok(marker);}
}

