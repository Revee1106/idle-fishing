import {runLifecycleClockAndAdSuite} from './tests/frontend/fe-000/.compiled/owner/PlatformVerificationSuite.js';
import {RuntimeLifecycleProvider as P} from './tests/frontend/fe-000/.compiled/owner/WeChatLifecycleProvider.js';
import assert from 'node:assert/strict';
import test from 'node:test';
function hooks(){let s=new Set(),h=new Set(); globalThis.wx={onShow:x=>s.add(x),onHide:x=>h.add(x),offShow:x=>s.delete(x),offHide:x=>h.delete(x)};return [s,h]}
test('local unsubscribe preserves sibling; dispose detaches both hooks',()=>{let [s,h]=hooks();try{let a=0,b=0;const p=new P(),u=p.subscribe(()=>a++);p.subscribe(()=>b++);u();[...h][0]();assert.deepEqual([a,b,s.size,h.size],[0,1,1,1]);p.dispose();assert.deepEqual([s.size,h.size],[0,0])}finally{delete globalThis.wx}});
for(const fault of [false,true])test('actual suite owner cleanup; fault='+fault,async()=>{let [s,h]=hooks();let orig=P.prototype.emit;try{if(fault)P.prototype.emit=()=>{throw Error('injected after subscribe')};let results=await runLifecycleClockAndAdSuite();let r=results.find(x=>x.id==='T08-LIFECYCLE-CLOCK');assert.equal(r.status,fault?'FAIL':'PASS');if(fault)assert.equal(r.detail,'injected after subscribe');assert.deepEqual([s.size,h.size],[0,0])}finally{P.prototype.emit=orig;delete globalThis.wx}});
