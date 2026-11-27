# FE-000 / FE-000-R1 前端测试报告（TEST_REPORT）

## 1. 测试基线与环境信息

| 字段 | 实测值 |
|---|---|
| 任务 | `FE-000` / `FE-000-R1` |
| 工作区 / 分支 | `E:/idle-fishing-frontend` / `feature/fe-000` |
| 整改基准提交（HEAD） | `43f666ba3ca2f0b004602c259e0ffb5c0dc81f97` |
| 固定共享核心提交 | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 操作系统 | Windows 10.0.19045 x64 |
| Git / Node / npm / TS | Git `2.50.1.windows.1` / Node `v24.20.0` / npm `11.4.2` / TypeScript `5.9.3` |
| Cocos Creator | `3.8.8`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`） |
| 浏览器宿主（Web 实测） | Google Chrome `158.0.8127.37`（无头 CDP，端口临时分配 `127.0.0.1`） |
| 微信开发者工具 | `2.01.2510280`（已安装，**服务端口关闭**；AppID 为游客 `touristappid`） |
| 微信真机 / 真实广告位 | **不具备**（无测试真机、无正式 AppID、无真实 `adUnitId`） |

> **宿主区分原则**：本报告严格区分 **Node**、**Mock（`MOCK-WX` / `MOCK-DOM` / `NODE-MEMORY`）**、**Web（真实构建的 `build/web-mobile`）**、**微信构建产物静态审计（`build/wechatgame`）**、**微信开发者工具运行态（`BLOCKED`）** 与 **微信真机（`BLOCKED`）**。任何 Node/Mock/Web 结果**不替代**微信真机或真实广告验收。

---

## 2. 执行命令与结果总表

### 2.1 整改前 RED 基线复现（在 `43f666b` 上执行）

| 项目 | 执行命令 / 来源 | 退出码 | 宿主 | 结果摘要 | 证据路径 |
|---|---|---:|---|---|---|
| 首审 Web `I01` 缺陷 | 首审独立验证记录 | — | `Web` | `FS-BG-RECOVERY=FAIL`、`T08-LIFECYCLE-CLOCK=FAIL`（编译后 `Set` 展开失效） | `E:/idle-fishing-review/reports/review/FE-000/evidence/web-results.json` |
| `V01` 零用例假绿 | `npm --prefix apps/game-client run test:frontend`（整改前） | `0` | `Node` | `tests 0, pass 0` 却退出 `0`（判定验收失败） | `reports/frontend/FE-000/evidence/r1-red-v01-test-entry.log` |
| `I03/I04/I05` 边界复现 | 基线源码隔离探针 | `1`（断言失败） | `Node / Mock` | `I03` 接受 +48h（`cursorMs=172810000`）；`I04a` 残留 `close=1 error=1`；`I04b` 创建 2 实例；`I05` 残留 `show=3 hide=3` | `reports/frontend/FE-000/evidence/r1-red-edge-cases.log` |
| `I02` 微信分包缺失 | 整改前 `build:wechat` + `verify-wechat-build.mjs` | `1` | `Cocos CLI / 产物审计` | `game.json` 无 `subpackages`；`subpackages/spike-pack` 不存在；`assets.subpackages=[]` | `reports/frontend/FE-000/evidence/r1-red-i02-wechat-build.log` |
| `T13` 初始白屏缺陷 | 初始 `Boot.scene` 手写类名构建 | `0`（运行时 `Error 3817`） | `Web` | `BootEntry` 类缺失导致白屏/黑屏 | `reports/frontend/FE-000/evidence/t13-before-build.log`、`t13-before-blank-canvas.png` |

### 2.2 整改后 GREEN 全量回归（当前工作区 `E:/idle-fishing-frontend`）

| 项目 | 实际执行命令 | 退出码 | 实际用例/断言数 | 实测宿主 | 证据路径 |
|---|---|---:|---|---|---|
| 依赖安装与共享构建 | `npm ci --offline --ignore-scripts --no-audit --no-fund && npm run build:cocos` | `0` | 9 `.mjs` + 9 `.d.ts` | `Node` | 本地终端执行记录 |
| 客户端全量 `tsc` | `npm --prefix apps/game-client run typecheck` | `0` | `0 errors`（覆盖启动/UI/平台/共享桥接） | `Node (tsc 5.9.3)` | `reports/frontend/FE-000/evidence/r1-green-typecheck.log` |
| 客户端工程 `tsc` | `node node_modules/typescript/bin/tsc --noEmit -p apps/game-client/tsconfig.json` | `0` | `0 errors` | `Node (tsc 5.9.3)` | 本地验证通过 |
| 前端单测与 Mock 套件 | `npm --prefix apps/game-client run test:frontend` | `0` | **7/7 PASS, 0 FAIL**（`559.88 ms`） | `Node / MOCK-WX / MOCK-DOM / NODE-MEMORY` | `reports/frontend/FE-000/evidence/r1-green-node-tests.log` |
| 零用例负向校验 | `node tests/frontend/fe-000/run-node-tests.mjs --files=` | `1` | `0 tests -> FAIL`（符合门禁） | `Node` | 终端验证退出码 `1` |
| 缺文件负向校验 | `node tests/frontend/fe-000/run-node-tests.mjs --files=missing.test.ts` | `1` | `Missing file -> FAIL`（符合门禁） | `Node` | 终端验证退出码 `1` |
| Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | `0`（Cocos 原始 `36`） | 36 文件 / `2024.74 KB` | `Cocos CLI 3.8.8` | `reports/frontend/FE-000/evidence/r1-green-web-build.log` |
| 真实 Web 产物端到端验证 | `npm --prefix apps/game-client run verify:web` | `0` | **18/18 PASS, 0 FAIL**（0 console errors） | `Web (Chrome 158 CDP on build/web-mobile)` | `reports/frontend/FE-000/evidence/r1-green-web-e2e.log`、`r1-green-web-results.json`、4 张 `.png` |
| Cocos 微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | `0`（Cocos 原始 `36`） | 41 文件 / `1936.20 KB`（含自动审计） | `Cocos CLI 3.8.8` | `reports/frontend/FE-000/evidence/r1-green-wechat-build.log` |
| 微信产物分包审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs apps/game-client/build/wechatgame reports/frontend/FE-000/evidence/r1-green-wechat-audit.json` | `0` | **10/10 PASS, 0 FAIL** | `Node (产物静态审计)` | `reports/frontend/FE-000/evidence/r1-green-wechat-audit.log`、`r1-green-wechat-audit.json` |
| 微信开发者工具 CLI 探测 | `echo N \| & "...cli.bat" islogin` | `0`（未开启端口后退出） | 确认服务端口关闭 | `WeChat DevTools 2.01.2510280` | `reports/frontend/FE-000/evidence/r1-wechat-cli-check.log` |

> **日志与证据版本管理说明**：虽然根目录 `.gitignore` 默认忽略 `*.log`，但本次在不修改根 `.gitignore` 的前提下，已通过 `git add -f` 将 `reports/frontend/FE-000/evidence/` 下的全部关键红/绿验证日志（`.log`）、机器可读结果（`.json`）及截图（`.png`）一并纳入 Git 版本管理，避免证据仅停留在本地工作区。

---

## 3. T01–T13 分项验收矩阵（按宿主拆分）

| 用例 | 验证内容 | Node / Mock | Web（真实 `build/web-mobile`） | 微信产物静态审计（`build/wechatgame`） | 微信开发者工具 / 微信真机 | 备注与实测细节 |
|---|---|---|---|---|---|---|
| **T01** | 工具链、Cocos 3.8.8 命令行构建与运行 | N/A | **PASS**（36 文件 `2024.74 KB`，Chrome 实跑 0 错） | **PASS**（41 文件 `1936.20 KB`，`game.js` / `project.config.json` / `game.json` 齐全） | **BLOCKED**（IDE 服务端口关闭、`touristappid`、无真机） | Cocos CLI 无需打开 GUI 即可完成双目标构建，原始成功退出码 `36` |
| **T02** | 共享模块加载、`BigInt`、`Nat` 序列化、SHA-256、数学确定性 | **PASS**（`[NODE/T02/T03]`） | **PASS**（`T02-SHA256`、`T02-BIGINT`、`T02-MATH` 全通过） | N/A | **BLOCKED**（待微信真机/IDE 运行态实测） | `sha256("abc")=ba7816bf8f01cfea...`；`Nat` 30 位大数 `123456789012345678901234567890` 无损往返 |
| **T03** | PRNG 黄金向量、跨恢复连续性、多流隔离、1h 连续 vs 分片一致 | **PASS**（与 `BE-000` `epoch.be000` 黄金哈希完全一致） | **PASS**（`T03-RNG01`、`T03-RNG02/03`、`T03-ADVANCE` 全通过） | N/A | **BLOCKED**（待微信运行态复核） | Node 与 Web 1h `canonicalHash` 均为 `bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a`；1h envelope 哈希 `2c768fc2...` 精确一致 |
| **T04** | 文件 CRUD、3 槽轮转、单槽损坏回退、全槽损坏 fail-closed、容量探测 | **PASS**（`MOCK-WX` `WeChatFilePort` + `NODE-MEMORY`） | **PASS**（`FS-CRUD`、`T04-ROTATE`、`T04-CORRUPT`、`FS-SIZE-PROBE` 64KB/256KB，底层为 `BROWSER_LOCAL_STORAGE_FALLBACK`） | N/A | **BLOCKED**（真实 `wx.getFileSystemManager()`、`USER_DATA_PATH` 与真实配额限制未在微信设备实测） | Web 环境仅验证适配层与三槽逻辑，**不代表**微信真实 FS 配额与文件系统行为 |
| **T05** | 写前失败、半写中断、写后状态未知认领、后台保存与恢复 | **PASS**（`NODE-MEMORY` 故障注入 + `MOCK-WX` `HIDE` 回调保存） | **PASS**（`T05-FAULTS`、`FS-BG-RECOVERY`；并完成真实 DOM `visibilitychange` 落盘 + `Page.reload()` 跨刷新恢复） | N/A | **BLOCKED**（微信真机切换后台与系统强杀进程恢复未实测） | 详见第 5 节：明确区分手动 `emit`、真实浏览器 `visibilitychange` + 跨 `Page.reload()`、以及未测的真机强退 |
| **T06** | 24h 离线推进性能、单次 vs 分片一致、内存与帧耗时 | **PASS**（`epoch.be000` 24h 哈希一致） | **PASS（桌面 Web 参考值）**：单次 `105.2 ms`，分片纯计算 `116.4 ms`（60 片，max `3.8 ms`，avg `1.94 ms`），总耗时 `2345.5 ms`，`jsHeap=16.61/34.63 MB`，分片 rAF max `50.1 ms` | N/A | **BLOCKED**（中低端微信真机耗时、帧耗时与 5x 压力基线未实测） | 24h `singleEqualsSliced=true`，`envelopeHashRev1=88cb5751...` 与 `BE-000` 精确一致；详见第 6 节 |
| **T07** | `v1 -> v2` 存档结构迁移与非法输入拒绝 | **PASS**（`NODE-MEMORY/T04/T05/T07`） | **PASS**（`T07-MIGRATE`） | N/A | **BLOCKED** | `v1 -> v2` 保留 `gold=4200, attempts=7`；非法 `v1` 稳定拒绝 |
| **T08** | 生命周期派发/退订/隔离/释放、无单调冻结、回拨恢复、+48h 钳制 | **PASS**（`MOCK-WX` 与 `MOCK-DOM` 均验证正常与订阅后故障退出原始监听 `[0,0]`；`NODE/I03/T08` 全通过） | **PASS**（`T08-MONO-PROBE`、`T08-LIFECYCLE-CLOCK` + 直接 `System.import` 真实编译 bundle 验证 `I01`） | N/A | **BLOCKED**（真机锁屏/切后台及 `wx.getPerformance().now()` 实际微秒/毫秒返回值未在真机采样） | `I01`、`I03`、`I05` 全部有独立红/绿证据 |
| **T09** | 激励广告接口：单实例、异常解绑、重复回调防重与 5 场景桩 | **PASS**（`MOCK-WX/I04/T09`：同 `requestId` 单实例、`load`/`show` 拒绝解绑、重复回调去重、5 场景桩 0 资产篡改） | **PASS（实验桩）** / **BLOCKED（真实广告）**：`T09-AD-STUB-5=PASS`，`T09-REAL-AD=BLOCKED` | N/A | **BLOCKED**（无真实微信 `adUnitId` 与真机广告拉取/关闭回调） | 桩代码显式标 `EXPERIMENTAL_STUB`，绝不直接增发玩家资产 |
| **T10** | 微信分包配置、产物结构、清单与资源加载 | N/A | **PASS（Web Bundle 加载）**：`spike-pack` 运行时加载 `manifest=spike-pack-v1` + `64x64` PNG（`416.3 ms`） | **PASS（10/10）**：`game.json` 注册 `subpackages/spike-pack/`，含 `game.js`、`config.json`、manifest、313B PNG，`settings.json` 注册 `["spike-pack"]` | **BLOCKED**（微信 IDE/真机 `wx.loadSubpackage` 运行时拉取未实测） | 严格分开报告“Web Bundle 加载”、“微信分包产物审计”与“微信运行态分包加载（BLOCKED）” |
| **T11** | Code First 11 项能力验证（2 页动态生成） | N/A | **PASS**（节点/按钮/文字/图片/横纵布局/滚轮滚动 `0->100/102`/弹窗真实点击开关/切页/Tween 动画/横竖屏适配 `390x844 <-> 844x390`/共享数据刷新） | N/A | **BLOCKED**（微信真机渲染未实测） | 附 4 张真实 Web 截图（第 7 节） |
| **T12** | 前后端共享单一数据源一致性与所有权隔离 | **PASS**（直接引用 `packages/game-core/dist/cocos`，无复制代码） | **PASS**（Node 与 Web 固定输入输出及哈希 100% 相同） | N/A | **NOT_RUN / BLOCKED**（待 `BE-000-R1` 复审后重新同步并复测） | 当前固定在 `358b111`；`git diff` 零越权文件 |
| **T13** | 端到端缺陷复现、源码修复与真实产物回归 | **PASS**（`I03/I04/I05/V01` 红绿闭环） | **PASS**（`BootEntry` 白屏闭环 + `I01` Web 编译产物红绿闭环） | **PASS**（`I02` 微信分包红绿闭环） | N/A | 所有闭环均留存修前失败与修后通过证据 |

---

## 4. 关键验证详情（`I01 / I03 / I04 / I05 / V01`）

### 4.1 真实编译 Web 包内的 `I01` 生命周期派发（`verify-web-build.mjs`）
- 通过 Chrome CDP 在真实加载的 `build/web-mobile` 页面内直接调用 `System.import('chunks:///_virtual/WeChatLifecycleProvider.ts')`，验证打包后的最终 JS 代码：
  - 订阅者 A、B 与抛错订阅者 C 同时注册；派发 `HIDE` -> `SHOW`（含重复 `HIDE` 去重）；局部取消 A 订阅后再次派发 `HIDE` -> `SHOW`，最后 `dispose()`。
  - 实测结果：`seenA=["HIDE","SHOW"]`、`seenB=["HIDE","SHOW","HIDE","SHOW"]`、`errCount=4`（异常被隔离，未中断 B）、`remainingSubs=0`、`attached=false`。

### 4.2 `I05` 所有者释放与原始监听归零（`platform-and-core.test.ts`）
- **局部退订语义保留**：退订 `subA` 后，同 `RuntimeLifecycleProvider` 上的 `subB` 继续收到 `HIDE`/`SHOW` 且底层 `wx`/`DOM` 监听仍处于挂载状态（`showCount=1, hideCount=1`）。
- **所有者释放（正常与异常路径）**：
  - `MOCK-WX`：`runFileSystemAndSaveSuite` 与 `runLifecycleClockAndAdSuite` 在正常退出及通过 `afterLifecycleSubscribe` 注入异常退出后，原始 `wx` 监听计数均归零（`show=0, hide=0`）。
  - `MOCK-DOM`：两套件在正常退出及订阅后注入异常退出后，原始 `document.visibilitychange` 监听计数均归零（`count=0`）。

### 4.3 `I03` 时钟边界与 `I04` 广告单请求语义
- **时钟边界（`[NODE/I03/T08]`）**：
  - `monotonicSupported: false` + 设备时间跳变 `+48h` -> `ok: false, code: 'CLOCK_ERROR', frozen: true`，`cursorMs` 保持 `10000` 不变。
  - 恢复 `monotonicSupported: true` 且 `wall >= highWaterMs` -> 安全重锚并恢复正常推进（不采纳期间伪造跳变）。
  - 正常离线 `+48h` -> 被精确钳制至 `8h` 离线窗口上限。
- **广告适配器（`[MOCK-WX/I04/T09]`）**：
  - 同一 `requestId` 并发调用 `show()`：第二次立即拒绝返回 `FAILED / AD_IN_PROGRESS`，底层 `wx.createRewardedVideoAd` 仅创建 `1` 次；
  - `load()` 拒绝、`show()` 拒绝、正常 `onClose`、重复 `onClose` 回调后，`closeHandlers.size === 0` 且 `errorHandlers.size === 0`。

---

## 5. 后台保存与恢复边界说明（严格区分三种测试层级）

| 层级 | 事件触发来源 | 持久化机制 | 实测结果 | 能证明什么 / 不能证明什么 |
|---|---|---|---|---|
| 1. 套件内 `FS-BG-RECOVERY` | 套件内 `lifecycle.emit('HIDE')`（回调内触发 `repo.commit`） | 同进程新建第二个 `SpikeFileSaveRepository` 实例回读（Node 为 `MemoryFilePort`；Web 为 `localStorage`） | **PASS**（Node & Web） | 证明 `HIDE` 回调链路可驱动 `SpikeFileSaveRepository` 提交并由新仓储实例还原；**不证明**跨进程/跨刷新恢复 |
| 2. Web 真实 `visibilitychange` + 跨 `Page.reload()` | `verify-web-build.mjs` 在 Chrome 真实 Web 页面派发 `document.visibilitychange`（`visibilityState='hidden'`） | `BootEntry` 真实监听该 DOM 事件并提交至 `localStorage` 槽位（`lastHideTriggerSource="document.visibilitychange"`, `revision="1"`, `gold="31"`, `cursorMs=1700000060000`），随后执行真实 `Page.reload()`，新页面重新启动 `BootEntry` 回读恢复（`restoredOnBoot=true`，全部字段一致） | **PASS**（`r1-green-web-results.json` L126–149） | 证明 Web 浏览器页签隐藏回调落盘 + 完整页面重载后状态恢复闭环；**不证明**微信真机 OS 后台强杀行为 |
| 3. 微信真机切后台与强杀恢复 | 真实微信 `wx.onHide` + 系统强杀小程序后冷启动 | `wx.getFileSystemManager()` 写入 `USER_DATA_PATH/idle_fishing` | **BLOCKED** | 受限于无真机与无正式 AppID，待补真实设备验证 |

---

## 6. 24h 离线推进性能数据（对照 `R1/HANDOFF.md` 实验目标）

| 指标 | 实验目标（`R1/HANDOFF.md` `BE-D02`/`FE-D01`） | Node（`358b111` 基准） | Web 实测（Chrome 158 桌面无头，软件渲染） | 微信中低端真机 |
|---|---|---|---|---|
| 负载规模 | 标准 24h（`86,400 s`） | `14,935` 节点 / `2,929` 周期 / `2,930` 尝试 | `14,935` 节点 / `2,929` 周期 / `2,930` 尝试 | **BLOCKED** |
| 单次 24h 耗时 | ≤ 3,000 ms（待批目标） | ~140 ms | **`105.2 ms`** | **BLOCKED** |
| 60 分片纯计算耗时 | — | — | **`116.4 ms`**（60 片，均值 `1.94 ms`） | **BLOCKED** |
| 单片最大耗时 | 目标 ≤ `8 ms`（警戒 `16 ms`） | — | **`3.8 ms`**（满足 ≤ 8 ms） | **BLOCKED** |
| 60 分片墙钟总耗时 | ≤ 3,000 ms | — | **`2,345.5 ms`**（含 60 次 `rAF` 调度间隔） | **BLOCKED** |
| 连续 vs 分片一致性 | 100% 字节一致 | **PASS** | **PASS**（`singleEqualsSliced=true`，`envelopeHashRev1=88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536`，匹配 `BE-000` 黄金哈希） | **BLOCKED** |
| 额外 JS 堆内存 | ≤ 32 MB（可测时记录） | 未单独采集 | `jsHeap = 16.61 MB / 34.63 MB`（运行后总已用/总分配） | **BLOCKED** |
| 分片阶段 `rAF` 帧间隔 | 仅 Web 桌面参考 | N/A | 68 采样，`avg=33.82 ms`，`max=50.1 ms`（无头软件渲染，非真机帧预算） | **BLOCKED** |
| 5 倍事件压力负载 | ≤ 10,000 ms | **NOT_RUN**（待 `BE-000-R1` 复审后提供标准 5x 夹具） | **NOT_RUN** | **BLOCKED** |

---

## 7. 真实 Web 产物可视化截图索引

所有截图均由 `verify-web-build.mjs` 直接截取自 `apps/game-client/build/web-mobile` 在无头 Chrome（`390x844` 竖屏）下的真实运行帧：

1. **Page 1 概览与共享核心验证**：[r1-green-overview.png](file:///E:/idle-fishing-frontend/reports/frontend/FE-000/evidence/r1-green-overview.png)
2. **Code First 动态弹窗（真实点击打开）**：[r1-green-modal.png](file:///E:/idle-fishing-frontend/reports/frontend/FE-000/evidence/r1-green-modal.png)
3. **Page 2 平台验证、滚动列表与本地分包加载**：[r1-green-platform.png](file:///E:/idle-fishing-frontend/reports/frontend/FE-000/evidence/r1-green-platform.png)
4. **Page 1 24h 离线性能实测结果展示**：[r1-green-perf24h.png](file:///E:/idle-fishing-frontend/reports/frontend/FE-000/evidence/r1-green-perf24h.png)
5. **T13 修复前白屏/黑屏故障现场对比**：[t13-before-blank-canvas.png](file:///E:/idle-fishing-frontend/reports/frontend/FE-000/evidence/t13-before-blank-canvas.png)
