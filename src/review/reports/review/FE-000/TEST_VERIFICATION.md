# FE-000 独立测试验证

2026-11-25。以下为审核方实测。公开测试入口运行 0 项，独立调用现有 Node runner 运行 5 项且全部通过。实际 Web 运行另发现两个失败用例，4 个补充边界用例全部失败。

## 环境与快照

Windows 10.0.19045 x64，PowerShell 7.6.9，Git 2.50.1.windows.1，Node v24.20.0，npm 11.4.2，TS 5.9.3，Cocos Creator 3.8.8。Chrome 158.0.8127.37，无头移动视口 390×844 和 844×390。微信开发者工具注册表版本 2.01.2510280。

隔离目录 `C:\Users\WANGWE~1\AppData\Local\Temp\idle-fe-review-646144a1e47b4fa9bda7db02d73e28b7`。在 `E:\idle-fishing` 使用下列清单取源，不复制 node_modules、dist、Cocos library、temp、build 或前一次测试产物。按相对路径逐文件复制并记录 SHA-256。94 项清单摘要为 `1867219BAC21F306A3A5A7711608DAF4D1C4DDD92105A89CBD80956FD6983F4B`，复测后 94 个原文件哈希一致。仓库中被忽略的修前日志另行只读检查。[审核输入清单](evidence/snapshot.sha256)

```powershell
git -c core.quotepath=false ls-files --cached --others --exclude-standard -- apps/game-client tests/frontend reports/frontend package.json package-lock.json tsconfig.base.json packages/game-core
```

## 命令与退出码

以下 npm 和 Node 命令均在隔离副本根目录运行。构建包装脚本调用已安装的 CocosCreator.exe，分别读取两个 build-configs 配置。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npm ci --offline --ignore-scripts --no-audit --no-fund`、`npm run build:cocos` | 0 / 0 | 锁文件安装成功。共享包编译并产出 9 个 .mjs 与 9 个声明。客户端以 file 依赖引用同一共享包。 |
| `npm --prefix apps/game-client run test:frontend` | 0 | **0 tests、0 pass**。*.test.mjs 未匹配实际的 .test.ts。 |
| `node tests/frontend/fe-000/run-node-tests.mjs` | 0 | 测试子集 tsc 成功，5/5。包含 RNG/BigInt/分片、Mock wx CRUD、内存三槽和故障注入/迁移、虚拟时钟、广告桩。测试名中的 MOCK-WX 三槽用例实际使用 MemoryFilePort。 |
| `node node_modules/typescript/bin/tsc --noEmit -p apps/game-client/tsconfig.json` | 2 | Cocos 生成配置默认 ES2015，客户端的 includes、BigInt/字面量、Label 命名空间失败，另外还有引擎声明诊断。 |
| 上一命令增加 `--skipLibCheck --target ES2020` | 2 | 仍有 CodeFirstFactory.ts:118、119 两个 TS2702；由此排除所有错误都来自引擎声明的解释。 |
| `npm --prefix apps/game-client run build:web` | 包装 0 / Cocos 36 | 171,935 ms；36 文件，2,064,993 B。页面实际启动，非仅目录存在。 |
| `npm --prefix apps/game-client run build:wechat` | 包装 0 / Cocos 36 | 426,715 ms；41 文件，1,974,190 B。生成 game.js、game.json、project.config.json；首次日志另有 Workers failed to exit gracefully。 |
| `npm --prefix apps/game-client run build:all` | 0 / 两次 Cocos 36 | 再次构建 Web 和微信分别耗时 152,280、137,571 ms，文件数与字节数分别与首次相同。仅对重复产出和大小作结论。 |
| `node audit-web.mjs` | 0 | 新建本地静态服务、隔离 Chrome profile，从 CDP 打开实际 Web 构建，在 Boot 就绪后调用页面提供的验证入口并读取明细。采集器退出 0；明细中有两个 FAIL 和一个 BLOCKED。 |
| `node audit-click.mjs` | 1 | 对可见按钮发送真实鼠标按下/释放，确认弹窗及切页。随后直接订阅打包模块的 HIDE/SHOW，得到 []，断言失败。首次连接旧浏览器配置遇到 ECONNREFUSED，改用新 profile 后取得此业务断言。 |
| `node audit-raf.mjs` | 首次 1，复跑 0 | 首次在重新构建期间 Boot 未就绪。产物可读后重跑，取得帧间隔、列表及滚动结果。 |
| `node --test audit-edge.mjs` | 1 | 4 个边界断言均失败，源码见下。 |
| 微信 CLI 的 `islogin` 与 `open --project <隔离目录>/apps/game-client/build/wechatgame` | 均 0 | 两次都输出 IDE service port disabled。对启用安全服务端口的提示选择 N 后工具退出。命令未返回登录态或游戏启动证据，未将退出码计为模拟器启动。 |

## 实际 Web 运行与对照

Web 加载后通过 `globalThis.__SPIKE_HARNESS__` 核实如下结果。阅读 [Web 实测明细](evidence/web-results.json)、[启动页](evidence/overview.png)、[实际点击打开的弹窗](evidence/modal.png) 和 [平台检查结果页](evidence/platform-results.png)。

| 验证 | 本次观察 |
|---|---|
| Code First 及资源 | 390×844 画布完成启动，共享检查 7/7。点击 (93,220) 打开弹窗，关闭后点击 (291,220) 切到平台页。返回概览成功。横屏后指标为 720×333、scale=0.26。平台结果列表在鼠标滚动后偏移 0→102，等于该次最大可滚动值。Web 的本地 spike-pack manifest 与图标加载通过。 |
| T02/T03 | 固定向量 11520、0、5927040、70819200、2031721883；恢复和跨流抽样成功，BigInt 与序列化通过。一小时连续与分片结果相同，金币 3116。 |
| T04/T05 | Web 的 FS-CRUD、T04-ROTATE、T04-CORRUPT、T05-FAULTS、FS-SIZE-PROBE 通过；FS-BG-RECOVERY 失败：HIDE callback did not fire。仅测浏览器临时 profile 的 localStorage。 |
| T08/T09 | 单调能力探针 PASS，T08-LIFECYCLE-CLOCK 失败，预期 hide/show=2/2，实际 0/0。实验广告桩 PASS，真实广告 BLOCKED。 |
| 打包后根因 | 页面 System.import 加载 chunks:///_virtual/WeChatLifecycleProvider.ts。订阅一个函数，依次 emit HIDE 和 SHOW。实得 []。产物把源码 `[...this.listeners]` 编译为 `[].concat(this.listeners)`，Set 作为一个元素被调用，异常被 catch 捕获。 |
| T06 | 24h，14,935 节点、2,930 次尝试、金币 85,366。连续 177.1 ms；60 片计算共 156.3 ms，含让出事件循环的墙钟 508.8 ms，最大单片 11.6 ms；该次 jsHeap 20.19/33.56 MB。Node 对同输入独立计算，与 Web 终态 SHA-256 同为 `406c327d50f8f0f49cd6553dd88c9846ce0156e3481389a5521d4d73c67f9036`。 |
| 帧观测 | 第二轮在 requestAnimationFrame 窗口内运行 24h 探针，记录 19 个时间间隔，最长 149.9 ms，该轮连续计算 158.9 ms，最大单片 8.5 ms。桌面软件渲染；该整段观测包含连续和分片计算，不能由此推断某个分片或目标手机的帧率。 |
| 微信分包 | game.json 仅含 deviceOrientation、networkTimeout。无 subpackages/subPackages 条目；assets/spike-pack 为 7 文件、2,597 B。project.config.json 的 compileType 为 game 且使用 touristappid。重复打包仍不能证明微信按需分包加载。 |

在 Web 构建目录启动本地静态服务后，可在同一页面执行以下检查。独立浏览器命令使用 CDP Runtime.evaluate 对同一 API 取值。

```js
const h = globalThis.__SPIKE_HARNESS__;
h.switchPage('platform');
await h.runAllPlatformChecks();
console.table([...h.getSnapshot().fsResults, ...h.getSnapshot().platformResults]);
const { RuntimeLifecycleProvider } = await System.import('chunks:///_virtual/WeChatLifecycleProvider.ts');
const provider = new RuntimeLifecycleProvider();
const events = [];
const unsubscribe = provider.subscribe(e => events.push(e));
provider.emit('HIDE'); provider.emit('SHOW'); unsubscribe(); provider.dispose();
console.log(events); // 正常应为 ['HIDE','SHOW']，本次为 []
```

## 独立边界用例

先运行上表的前端 Node runner，随后将下列文件保存为隔离根目录 audit-edge.mjs，执行 `node --test audit-edge.mjs`。P1 实际游标 172810000，预期保持 10000。P2 三轮后 wx 上仍有三对监听器。P3 load 拒绝后 close/error 各留一个处理器。P4 同请求创建两个广告实例。以上均为控制输入的适配器验证。

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {WeChatRewardedAdAdapter} from './tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/ExperimentalAdProvider.js';
import {RuntimeLifecycleProvider} from './tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/WeChatLifecycleProvider.js';
import {MonotonicTimelineGuard} from './tests/frontend/fe-000/.compiled/apps/game-client/assets/scripts/platform/WeChatClockProvider.js';
test('P1 unsupported monotonic source cannot grant a 48h foreground jump',()=>{
  let wall=10000;const c={wallNowMs:()=>wall,monotonicNowMs:()=>wall,monotonicSupported:false,monotonicSource:'UNSUPPORTED_WALL_FALLBACK'};
  const g=new MonotonicTimelineGuard(c);wall+=48*3600000;const t=g.tickForeground(c);assert.equal(t.cursorMs,10000);
});
test('P2 suite subscription must release platform hooks at end of run',()=>{
  const show=new Set(),hide=new Set();globalThis.wx={onShow:x=>show.add(x),onHide:x=>hide.add(x),offShow:x=>show.delete(x),offHide:x=>hide.delete(x)};
  try {for(let i=0;i<3;i++){const p=new RuntimeLifecycleProvider();const unsub=p.subscribe(()=>{});unsub()}assert.deepEqual([show.size,hide.size],[0,0])}finally{delete globalThis.wx}
});
test('P3 rejected SDK load releases error and close handlers',async()=>{
  const close=new Set(),error=new Set();globalThis.wx={createRewardedVideoAd:()=>({onClose:x=>close.add(x),offClose:x=>close.delete(x),onError:x=>error.add(x),offError:x=>error.delete(x),load:async()=>{throw Error('mock load failure')},show:async()=>{}})};
  try {const r=await new WeChatRewardedAdAdapter('audit').show('req','SPEED');assert.equal(r.outcome,'FAILED');assert.deepEqual([close.size,error.size],[0,0])}finally{delete globalThis.wx}
});
test('P4 concurrent show for a single request must create at most one instance',async()=>{
  let created=0;const ends=[];globalThis.wx={createRewardedVideoAd:()=>{created++;return {onClose:f=>ends.push(f),onError:()=>{},load:async()=>{},show:async()=>{}}}};
  try {const ad=new WeChatRewardedAdAdapter('audit');const a=ad.show('same','SPEED'),b=ad.show('same','SPEED');for(const done of ends)done({isEnded:true});await Promise.allSettled([a,b]);assert.equal(created,1)}finally{delete globalThis.wx}
});
```

## 未执行与真实性界限

未确认微信开发工具模拟器内启动、有效 AppID 权限、真机文件与配额、真实进程强退恢复、真机帧/内存和真实广告。T13 修前日志包含 BootEntry missing，修前截图为开发侧材料，当前可运行 Web 和四份审核报告为审核方材料。缺少开发侧修复版本及修后测试归档，不能反推出完整开发历史。
