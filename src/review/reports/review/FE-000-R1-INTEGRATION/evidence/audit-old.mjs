import * as old from './old/packages/game-core/src/spike/index.ts';
import * as m from './packages/game-core/src/spike/index.ts';
import {MemoryFilePort} from './tests/backend/be-000/helpers.ts';
import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p)),f=read('tests/backend/be-000/fixtures/offline-vectors.json'),c=read('reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json').cases;
const initial=lib=>lib.createInitialState({saveEpoch:'epoch.legacy358',startMs:f.startMs,allowanceMs:f.allowanceMs});
for(const [name,s] of Object.entries(c)){let port=new MemoryFilePort();let o=initial(old);
if(s.state){if(s.cursorMs!==o.cursorMs)o=old.advanceOffline(o,s.cursorMs).state;assert.deepEqual(o,s.state);assert.equal(old.buildEnvelope(o,'1').text,s.envelopeText);await port.write(m.SLOT_PATHS[0],s.envelopeText)}
else {for(const [k,v] of Object.entries(s.slots))if(v!==null)await port.write(k,v);assert.equal(s.slots[m.SLOT_PATHS[0]],old.buildEnvelope(o,'1').text)}
const repo=new m.SpikeFileSaveRepository(port),l=await repo.load();assert.deepEqual(l.raw,o);assert.deepEqual((await repo.load()).raw,o);
const next=m.advanceOffline(l.raw,o.cursorMs+60000).state;let result=await repo.commit(next,'1');assert.equal(result.revision,'2');assert.deepEqual((await repo.load()).raw,next);assert.equal(new Set(next.claims).size,next.claims.length);console.log(name,'old bytes, full-state, advance, rev2 reload OK');}
const s=m.createInitialState({saveEpoch:'epoch.be000',startMs:f.startMs,allowanceMs:f.allowanceMs});const hash=v=>createHash('sha256').update(v).digest('hex');const hashes={};for(const h of [0,1,8,24]){const t=h?m.advanceOffline(s,s.cursorMs+h*3600000).state:s;const e=m.buildEnvelope(t,'1');hashes[h]=[hash(m.canonicalStringify(t)),e.sha256,hash(e.text)];if(h===0||h===1||h===8)assert.equal(hashes[h][0],f[{0:'initial',1:'afterOneHour',8:'afterEightHours'}[h]].sha256)}
console.log(JSON.stringify(hashes));fs.writeFileSync('hashes.json',JSON.stringify(hashes));
const port=new MemoryFilePort(),repo=new m.SpikeFileSaveRepository(port);const b=m.advanceOffline(s,s.cursorMs+60000).state;const res=await Promise.all([repo.commit(s,null),repo.commit(b,null)]);console.log('parallel',JSON.stringify(res), (await repo.load()).raw?.cursorMs)
