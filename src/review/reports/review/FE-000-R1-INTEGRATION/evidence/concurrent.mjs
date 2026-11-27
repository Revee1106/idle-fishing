import {MemoryFilePort} from './tests/backend/be-000/helpers.ts';import * as m from './packages/game-core/src/spike/index.ts';
const p=new MemoryFilePort(),base=p.write.bind(p), gate=Promise.withResolvers(),both=Promise.withResolvers();let n=0;
p.write=async(k,v)=>{if(++n===1)await both.promise;else {both.resolve();await gate.promise}await base(k,v)};
const r=new m.SpikeFileSaveRepository(p),a=m.createInitialState({saveEpoch:'concurrent',startMs:0,allowanceMs:86400000}),b=m.advanceOffline(a,60000).state;
const x=r.commit(a,null),y=r.commit(b,null);const first=await x;gate.resolve();const second=await y; console.log(JSON.stringify({first,second,loadedCursor:(await r.load()).raw.cursorMs}));