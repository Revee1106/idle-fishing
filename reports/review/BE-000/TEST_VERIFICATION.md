# BE-000 独立测试验证

**2026-11-25。** 开发用例 64/64 通过；独立边界用例 1/8 通过、7/8 失败。两组用例分别计数。独立严格类型消费者另有 1 个编译失败。

## 环境与复现入口

Windows 10.0.19045 x64，PowerShell 7.6.9，Git 2.50.1.windows.1，Node v24.20.0，npm 11.4.2，TypeScript 5.9.3。Cocos Creator 3.8.8，Chrome 158.0.8127.37。测试使用本机 CPU Intel64 Family 6 Model 142 Stepping 10。隔离目录为 `C:\Users\WANGWE~1\AppData\Local\Temp\idle-be000-review-8792224d4f714e22b58224c339cf6bfd`。原开发树中的 node_modules、dist 与前端实现均未用于 Node 测试。

隔离目录由 Git 当前跟踪清单加未跟踪且未忽略的 BE 文件创建。取样命令为 `git -c core.quotepath=false ls-files --cached --others --exclude-standard -- package.json package-lock.json tsconfig.base.json tsconfig.test.json packages/game-core tests/backend/be-000 docs reports/backend`。按输出逐文件复制到空目录，相对路径保持一致。每行以大写 SHA-256、两个空格、仓库相对路径记入 snapshot.sha256。共 63 行，清单 SHA-256 为 `02B96573E518424107751B7B4F8E0022102C95C2B18C0AD216F78D1B6CC947EE`。开发侧被忽略的日志另从原工作区只读检查。复审应重新取样。

| 实际命令 / 操作 | 退出码 | 独立结果 |
|---|---:|---|
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | 0 | 使用锁文件及本机 npm 缓存安装成功。 |
| `npm run verify` | 0 | 实际串行执行 typecheck、build:cocos（包括 tsc 构建）和 npm test，三步均成功；9 个 .mjs、9 个 .d.ts，9 个 .test.ts 文件，64 项通过，失败/跳过/取消均为 0。覆盖真实临时目录读写、内存故障注入、SHA-256 对照、三槽轮换、迁移、分片与固定向量。 |
| `npm run test:perf` | 0 | 模拟 86,400,000 ms；14,935 节点、2,930 次尝试、2,929 个终止事件、288 次环境检查、35,006 B 终态。五个一致性结果均为 true。 |
| `npm test`，仅在隔离副本把 prng.ts 的 xoshiro 输出乘数 9 改为 8 | 1 | 58 通过、6 失败。按原字节恢复该文件，再执行同一命令返回 0，64 通过。开发侧红绿日志亦记录 1→0。 |
| `node --test review.test.mjs`（下附完整代码） | 1 | A1–A6、A8 失败，A7 通过。 |
| `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution Bundler cocos-type-audit.mts` | 2 | 消费者仅有 `import { xoshiroStep } from './packages/game-core/dist/cocos/spike/index.mjs'; xoshiroStep([1,2,3,4]);`。出现 TS7016，该 .mjs 解析不到类型声明。 |
| CocosCreator.exe --project "<隔离目录>/cocos" --build "platform=web-mobile;debug=true" | 36 | 使用开发侧临时探针工程 idle-fishing-be000-cocos-mjs-2006 的 assets/settings/profiles/package.json/tsconfig.json，替换为独立构建出的共享模块。从无缓存工程启动构建，日志出现 build Task (web-mobile) Finished，生成 index.html 和主包。CLI 对 debug 参数类型和默认压缩设置有警告。 |
| `node runtime-audit.mjs`（Chrome --dump-dom 首次采样） | 1 | Chrome 退出 0，但取样时探针为空，未据此判定产物可运行。 |
| `node runtime-cdp.mjs`（独立脚本，启动本地静态服务及 Chrome，等待场景探针） | 0 | 实际打开上述新构建页面，读得 value=11520、state="[7,0,1026,12288]"。通过页面 System.import 取实际打包模块，19 个数学向量匹配，24h 状态与 Node 对照一致。 |
| Node 额外 RNG 恢复验证（下附命令） | 0 | 运行 1,000 次 wait 抽样后序列化恢复，后续 1,000 个 U53 和最终流状态逐项相同。 |
| 自定义 fixture 对照（下附命令） | 0 | 诊断命令正常完成。传入 castMs=17，17 ms 时实得 CASTING，未使用指定抛竿时长。 |

### 性能记录

连续 110.230 ms，600 s 分片 116.189 ms，60 s 分片 139.741 ms，64 节点预算 142.882 ms，检查点保存/加载/恢复 335.714 ms，单次 Envelope 序列化 9.398 ms。进程 RSS 93,392,896 B，heapUsed 22,592,880 B。perf 的 `sha256Hex(envelope.text)` 为 `88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536`，与开发报告相同。性能脚本比较相同输入下的多条路径；这些路径都保留旧 settledUntil，A5 独立检出了该问题。

### Web 与 Node 的对照方法

Web 页面加载后读取 `globalThis.__BE000_PROBE__`。随后从 `await System.import('chunks:///_virtual/index.mjs')` 取得 m。Node 从 `./packages/game-core/dist/spike/index.js` 导入同样的导出。两端执行下列代码，返回相同的 Envelope 内部哈希 `2bdf2360c4d6fa36a8e8e83b2a2fdddd83e9b92ed1722b72b0311600940d3811`、金币 85366、大整数 361604935017160493501716049349810。这里测量内部字段，perf 上述摘要计算整个 Envelope 文本。

```js
const s = m.createInitialState({saveEpoch:'epoch.be000', startMs:1700000000000, allowanceMs:86400000});
const f = m.advanceOffline(s, s.cursorMs + 86400000).state;
console.log(m.buildEnvelope(f, '1').sha256, f.gold, f.big);
```

数学对照读取 math-vectors.json 的 19 个 cases，对 imul、sqrt、pow、round 执行对应 Math 操作，对 quantize 执行 Math.round(x*1e6)，逐项与夹具比较。此结论限本次 Chrome/Cocos Web 运行时。

## 独立用例结果

| 用例 | 预期 | 实际 |
|---|---|---|
| A1 隐藏现有 revision 9 | 禁止以新档写入 | 在另一个槽写入 revision 1，返回 COMMITTED |
| A2 完整落盘后暂时不可读 | 未证实的结果返回 UNCERTAIN | 返回 FAILED；解除读取故障后加载到 revision 2 |
| A3 同 revision、不同有效载荷 | 已判定冲突的槽不得继续写入 | load 返回 CORRUPT，随后 commit 却返回 COMMITTED revision 8 |
| A4 单槽 payload 为 null，另有有效备份 | 隔离无效槽，恢复 revision 1 | TypeError 中断整次 load |
| A5 会话内推进到 4500 ms | 已结算游标也到 4500 | cursorMs=4500，settledUntilMs=0 |
| A6 起点和增量各自安全、和溢出 | 返回可表示时间或明确拒绝 | 返回 9007199254740992 |
| A7 截止时刻恰完成对抗 | 发一次奖励，截止后不开新尝试 | 通过 |
| A8 已含奖励键的进行中状态 | 写前拒绝，或恢复后不再发奖 | 真实保存/加载接受该状态，金币由 100 增至 131，键仍仅一个 |

将下列代码保存为隔离目录根的 `review.test.mjs` 即可复跑。A8 是故障夹具，验证被仓库实际接受的状态；没有据此推断所有正常存档都会重复发奖。

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryFilePort } from './tests/backend/be-000/helpers.ts';
import { createInitialState, advanceOffline, buildEnvelope, SpikeFileSaveRepository, SLOT_PATHS, computeEnvelopeHash, completionTimeMs } from './packages/game-core/src/spike/index.ts';
const state = () => createInitialState({saveEpoch:'audit',startMs:0,allowanceMs:10000});
const setup = () => { const port = new MemoryFilePort(); return {port, repo:new SpikeFileSaveRepository(port)} };
test('A1 unknown slot cannot authorize a new save',async()=>{
  const {port,repo}=setup(); port.files.set(SLOT_PATHS[0],buildEnvelope(state(),'9').text);
  port.readErrors.set(SLOT_PATHS[0],'busy');
  const result=await repo.commit(state(),null);
  assert.equal(port.writeCount,0,JSON.stringify(result));
});
test('A2 durable write with unreadable target stays uncertain',async()=>{
  const {port,repo}=setup(); await repo.commit(state(),null);
  port.writeBehavior=(path)=>{port.readErrors.set(path,'busy');return {kind:'WRITE_THEN_THROW'}};
  const result=await repo.commit({...state(),gold:'8'},'1');
  port.readErrors.clear(); const loaded=await repo.load(); assert.equal(loaded.revision,'2');
  assert.equal(result.kind,'UNCERTAIN');
});
test('A3 conflicting highest slots cannot authorize a write',async()=>{
  const {port,repo}=setup();
  port.files.set(SLOT_PATHS[0],buildEnvelope(state(),'7').text);
  port.files.set(SLOT_PATHS[1],buildEnvelope({...state(),gold:'9'},'7').text);
  assert.equal((await repo.load()).kind,'CORRUPT');
  const result=await repo.commit(state(),'7'); assert.equal(port.writeCount,0,JSON.stringify(result));
});
test('A4 invalid payload in one slot still allows backup recovery',async()=>{
  const {port,repo}=setup(); await repo.commit(state(),null);
  const e=buildEnvelope(state(),'2').envelope; const payload='null';
  port.files.set(SLOT_PATHS[1],JSON.stringify({...e,payload,sha256:computeEnvelopeHash(e.magic,e.format,e.revision,e.epoch,payload)}));
  const loaded=await repo.load(); assert.equal(loaded.kind,'VALID'); assert.equal(loaded.revision,'1');
});
test('A5 offline checkpoint records time already settled',()=>{
  const s=advanceOffline(state(),4500).state;
  assert.equal(s.cursorMs,4500); assert.equal(s.offline.settledUntilMs,4500);
});
test('A6 resulting time must remain a safe millisecond',()=>{
  const value=completionTimeMs('0','2',Number.MAX_SAFE_INTEGER-1,1n);
  assert.ok(value===null || Number.isSafeInteger(value),String(value));
});
test('A7 exact fight completion at deadline issues one reward',()=>{
  const s=state(); const stop=s.offline.deadlineMs;
  Object.assign(s,{stage:'FIGHTING',stageStartMs:0,stageDone:'0',stageRequired:String(BigInt(stop)*1000000n)});
  s.counters.attempts=1;
  const at=advanceOffline(s,stop).state, after=advanceOffline(at,stop+1).state;
  assert.deepEqual(at.claims,['fish:1']); assert.equal(after.gold,at.gold); assert.equal(after.counters.attempts,1);
});
test('A8 previously claimed reward must not be paid by restored fight',async()=>{
  const {port,repo}=setup(); const s=state();
  Object.assign(s,{stage:'FIGHTING',stageRequired:'1000000',gold:'100',claims:['fish:1'],lastTerminalAttemptSeq:'1'});
  s.counters.attempts=1;
  const result=await repo.commit(s,null); if(result.kind!=='COMMITTED') {assert.equal(port.writeCount,0);return;}
  const loaded=await repo.load(); assert.equal(loaded.kind,'VALID');
  const next=advanceOffline(loaded.raw,1).state;
  assert.equal(next.gold,'100',JSON.stringify({gold:next.gold,claims:next.claims}));
});
```

RNG 和 fixture 独立命令在同一目录执行：

```powershell
node --input-type=module -e "import assert from 'node:assert/strict';import * as m from './packages/game-core/dist/spike/index.js';const next=s=>m.drawU53(s,305441741,'wait');let r=m.newRngState();for(let i=0;i<1000;i++)r=next(r).state;let restored=JSON.parse(m.canonicalStringify(r));for(let i=0;i<1000;i++){const a=next(r),b=next(restored);assert.equal(a.u,b.u);assert.ok(a.u>=0&&a.u<1);r=a.state;restored=b.state}assert.deepEqual(r,restored)"
node --input-type=module -e "import * as m from './packages/game-core/dist/spike/index.js';const custom={...m.DEFAULT_OFFLINE_FIXTURE,castMs:17};const t=m.createInitialState({saveEpoch:'audit',startMs:0,allowanceMs:99999,fixture:custom});console.log(m.advanceOffline(t,17).state.stage)"
```

## 未执行与证据限制

微信开发者工具、真机文件系统/强退、广告、分包、帧阻塞和长期内存观测属于前端或负责人联合验证，本次没有对应设备或账号验收证据。没有更早的 BE 实现提交可做历史代码差分回归。旧 Cocos 场景及日志可在本机核验，但未纳入该提交；丢失临时目录后需按交接说明重建探针。独立审核未重新生成固定向量。
