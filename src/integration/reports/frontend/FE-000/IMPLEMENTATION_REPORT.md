# FE-000 / FE-000-R1 前端实现报告（IMPLEMENTATION_REPORT）

## 1. 任务与基线元信息

| 项目 | 值 |
|---|---|
| 任务编号 | `FE-000` / `FE-000-R1`（对应 `SPIKE-001` 前端技术验证及首审整改） |
| 开发角色 | 前端开发执行工程师（Cocos Creator + TypeScript + Code First） |
| 实际工作区 | `E:/idle-fishing-frontend` |
| Git 分支 | `feature/fe-000` |
| 整改基准提交（HEAD） | `43f666ba3ca2f0b004602c259e0ffb5c0dc81f97`（`Preserve pre-R1 frontend snapshot`） |
| 固定的后端依赖提交 | `358b11105cfdee9bd076049c86a34d8f0aaa00e7`（`Preserve pre-R1 backend snapshot`，整改前共享核心版本） |
| 共同设计基线（main） | `2106ce19d991ec47555cdbf207454c36d8cd104a` |
| 所有权边界 | 仅修改 `apps/game-client/`、`tests/frontend/`、`reports/frontend/`；未触碰后端共享核心、根构建配置、设计文档、公共契约与正式数值 |
| 交付状态 | **`DEVELOPMENT_COMPLETED_PENDING_REVIEW`**（不依赖后端整改的前端整改项 `I01–I06`、`V01–V03` 已完成本地验证，等待 Codex 独立复审及负责人下发已复审的 `BE-000-R1` 共享模块后再做联调复测；本报告不构成正式验收通过） |

---

## 2. 本阶段完成工作总览

### 2.1 最小 Cocos Creator 3.8.8 Code First 工程
- **最小启动场景**：`apps/game-client/assets/scenes/Boot.scene` 仅包含 `Canvas`、`Camera` 与挂载 `BootEntry`（压缩类 UUID `be27bNR3gtAJby1so+o2Y8/`）的最小入口节点，未采用编辑器手工拖拽搭建业务页面。
- **Code First 页面构建**：`apps/game-client/assets/scripts/ui/CodeFirstFactory.ts` 与 `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` 通过纯 TypeScript 动态构建 2 个实验性验证页面（Page 1：`overview` 核心与性能页；Page 2：`platform` 平台与分包验证页），覆盖全部 11 项 Code First 能力：
  1. 动态创建节点（`createNode` / `ensureTransform`）
  2. 动态创建按钮与事件绑定（`createButton`）
  3. 动态创建文字（`createLabel`）
  4. 动态创建图片与纯色面板（`createSprite` / `createPanel`，含程序化 `1x1` 白图纹理与本地 `64x64` PNG 测试图标 `assets/resources/textures/fish-icon.png`）
  5. 动态创建横向与纵向布局（`createHorizontalLayout` / `createVerticalLayout`）
  6. 动态创建滚动列表（`createScrollList`，支持鼠标滚轮/触摸滚动与动态追加结果项）
  7. 动态创建弹窗（`createModal`，含遮罩拦截与打开/关闭回调）
  8. 代码控制页面切换（`switchPage('overview' | 'platform')`）
  9. 简单 Tween 动画（顶部呼吸方块脉冲动画 + 弹窗缩放淡入/淡出 Tween）
  10. 基础屏幕尺寸适配（监听 `view.on('canvas-resize')` 实时更新视口宽高、缩放与 `PORTRAIT`/`LANDSCAPE` 状态）
  11. 根据共享后端模块数据刷新界面（Page 1 展示 `@idle-fishing/game-core` 的 1h 确定性状态、BigInt、PRNG 与 24h 性能汇总）

### 2.2 共享后端模块接入（固定于 `358b111`）
- 按 `reports/backend/BE-000/SHARED_MODULE_HANDOFF.md` 方案，通过 `apps/game-client/package.json` 的本地包依赖 `"@idle-fishing/game-core": "file:../../packages/game-core"` 接入**同一份共享源码的自动构建产物**（`packages/game-core/dist/cocos/*.mjs`，由 `npm run build:cocos` 生成），未复制源码、未重新实现核心算法。
- `apps/game-client/assets/scripts/shared/SharedCoreBridge.ts` 接入并验证：
  - Canonical JSON 与 SHA-256 黄金向量
  - `xoshiro128**` 黄金向量（`[1,2,3,4]`）、跨保存/恢复 2000 次连续性及多流隔离
  - `BigInt` 运行时与超大 `Nat`（`> 2^53`）序列化反序列化
  - `Math.pow` / `Math.sqrt` / `Math.imul` / `triangularQuantile` 确定性
  - 连续推进 vs 60s 分片推进 1h 一致性，并与 `BE-000` `epoch.be000` 黄金哈希对齐（1h `canonicalHash`、1h `envelopeSha256`、24h `envelopeSha256`）
  - 24h 单次与 60 分片离线推进基准测试（分离单次执行与分片阶段 rAF 采样）
  - `v1 -> v2` 存档结构迁移与非法输入拒绝

### 2.3 平台适配、存档、时间、广告与分包
- **文件系统与三槽存档**：`WeChatFilePort.ts`（优先适配 `wx.getFileSystemManager()` 与 `wx.env.USER_DATA_PATH/idle_fishing`，Web 环境下明确标注 `BROWSER_LOCAL_STORAGE_FALLBACK`）、`MemoryFilePort.ts`（含可注入写前/半写/写后未知异常故障）与 `SpikeSaveRepository.ts`（3 槽轮转、SHA-256 校验、单槽损坏回退、全槽损坏 fail-closed、不确定提交认领）。
- **生命周期与跨刷新持久化**：`WeChatLifecycleProvider.ts` 统一封装 `wx.onHide`/`wx.onShow` 与浏览器 `document.visibilitychange`；`BootEntry.ts` 持有顶层生命周期实例并在真实平台 `HIDE` 回调中异步提交 `SpikeGameState` 至 `idle_fishing_lifecycle_persist`，重新加载页面时恢复 `revision/gold/cursorMs/deadlineMs`，`onDestroy()` 中显式释放 `dispose()`。
- **时钟与单调防篡改**：`WeChatClockProvider.ts` 封装 `wx.getPerformance().now()`（含微秒/毫秒单位探测函数 `detectWxPerfMicrosecondUnit`）与 `performance.now()`，`MonotonicTimelineGuard` 防护无单调源跳变、时钟回拨/恢复及设备时间前跳 48h 钳制。
- **激励广告实验适配**：`ExperimentalAdProvider.ts` 实现 `WeChatRewardedAdAdapter`（同请求单实例保护、全退出路径解绑 `offClose`/`offError`、不直接发放玩家资产）与 `ExperimentalStubAdProvider`（明确 `EXPERIMENTAL_STUB` 标识，覆盖 5 场景及重复回调去重）。
- **微信小游戏分包**：`assets/subpackages/spike-pack` 经 Cocos 3.8.8 原生 `directory` importer `ver: 1.2.0` + `settings/v2/packages/builder.json`（`bundleConfigID: "auto_05wYOSxc5MVIWgbcnp3w7x"`）配置为 `wechatgame` `subpackage`（Web 为 `merge_dep`），包含 `manifest.json`（`spike-pack-v1`）与 `subpack-icon.png`（`64x64` PNG），由 `verify-wechat-build.mjs` 自动审计。

---

## 3. 首审问题闭环矩阵（`I01–I06`、`V01–V03`）

| 编号 | 首审问题描述 | 根因 | 修复文件与方案 | 整改前后证据 | 状态 |
|---|---|---|---|---|---|
| `I01` | Cocos Web 构建产物中 `WeChatLifecycleProvider` 的 `HIDE/SHOW` 监听器收到 0 次，导致 `FS-BG-RECOVERY` 与 `T08-LIFECYCLE-CLOCK` 在真实 Web 包失败 | Cocos 3.8.8 内置 Babel `loose: true` 将 `[...this.listeners]` 编译为 `[].concat(this.listeners)`，使 `Set` 被当作单元素放入数组而非展开遍历 | `WeChatLifecycleProvider.ts` 改用 `this.listeners.forEach(l => snapshot.push(l))`；`WeChatFilePort.ts` 改用 `entries.slice()`；在 `BootEntry.ts` 绑定真实 `visibilitychange`/`wx.onHide` 回调落盘并实现跨 `Page.reload()` 恢复 | RED: 首审 `E:/idle-fishing-review/reports/review/FE-000/evidence/web-results.json`（2 项 FAIL）<br>GREEN: `reports/frontend/FE-000/evidence/r1-green-web-results.json`（`18/18 PASS`，含直接 `System.import` 真实 Web bundle 验证及真实 `visibilitychange` + `Page.reload()` 恢复） | **CLOSED（Web/Node/Mock 已闭环；微信真机强退另记 BLOCKED）** |
| `I02` | 微信构建产物 `game.json` 未注册 `subpackages`，`spike-pack` 仍留在主包 `assets/spike-pack/` | `spike-pack.meta` 此前写法不适配 Cocos 3.8.8 `ver: 1.2.0` 的 `bundleConfigID` 机制，且 `buildConfig_wechatgame.json` 中存在空 `bundleConfigs: []` 覆盖 | 通过 Cocos 3.8.8 原生迁移生成 `ver: 1.2.0` + `bundleConfigID: "auto_05wYOSxc5MVIWgbcnp3w7x"` 及 `settings/v2/packages/builder.json`（`wechatgame.compressionType = "subpackage"`）；移除空 `bundleConfigs`；在 `build-cocos.mjs` 强制调用 `verify-wechat-build.mjs` 审计产物 | RED: `r1-red-i02-wechat-build.log`（`game.json` 无 `subpackages`，`assets.subpackages=[]`，校验 `EXIT=1`）<br>GREEN: `r1-green-wechat-build.log` + `r1-green-wechat-audit.json`（`10/10 PASS`，`game.json` 注册 `{"name":"spike-pack","root":"subpackages/spike-pack/"}`，分包 7 文件 `2.54 KB`） | **CLOSED（构建产物审计与 Web bundle 加载已闭环；微信运行态加载另记 BLOCKED）** |
| `I03` | `MonotonicTimelineGuard` 在 `monotonicSupported === false` 时仍采用 `wall` 差值推进 +48h，未进入异常冻结 | `tickForeground()` 未优先判断 `!clock.monotonicSupported` | `WeChatClockProvider.ts` 首行检查 `!clock.monotonicSupported` 时立即返回 `ok: false, code: 'CLOCK_ERROR', frozen: true` 且不推进 `cursorMs`；补充回拨冻结及恢复单调能力后的安全重锚恢复用例 | RED: `r1-red-edge-cases.log`（`I03_RED_UNSUPPORTED_MONO: cursorMs=172810000`）<br>GREEN: `r1-green-node-tests.log`（`[NODE/I03/T08] PASS`）+ `r1-green-web-results.json`（`T08-LIFECYCLE-CLOCK PASS`） | **CLOSED** |
| `I04` | `WeChatRewardedAdAdapter` 在 `load()`/`show()` 拒绝时未解绑监听器；同 `requestId` 并发调用会创建两个 SDK 实例 | 缺少活跃请求锁，且 `offClose`/`offError` 仅在部分回调分支执行 | `ExperimentalAdProvider.ts` 增加 `activeRequestId` 单实例保护（并发直接返回 `FAILED / AD_IN_PROGRESS`），所有退出路径（`onClose`、`onError`、`load` 拒绝、`show` 拒绝、重复回调）统一走 `finish()` 解绑 `offClose`/`offError` | RED: `r1-red-edge-cases.log`（`I04a_RED_LOAD_REJECT_LEAK: close=1 error=1`；`I04b_RED_CONCURRENT_INSTANCES: created=2`）<br>GREEN: `r1-green-node-tests.log`（`[MOCK-WX/I04/T09] PASS`） | **CLOSED（Mock SDK 闭环；真实微信广告位另记 BLOCKED）** |
| `I05` | `PlatformVerificationSuite` 创建 `RuntimeLifecycleProvider` 后未显式 `dispose()`，导致正常与异常退出后残留 `wx`/DOM 原始监听 | 套件只调用局部 `unsubscribe()`，未承担 Provider 所有者的生命周期释放职责 | 保持 `unsubscribe()` 局部退订语义不变（同 Provider 其余订阅继续工作）；`runFileSystemAndSaveSuite` 与 `runLifecycleClockAndAdSuite` 均用 `try { ... } finally { unsub?.(); lifecycle.dispose(); }` 释放，并注入订阅后异常钩子验证 `wx` 与 `DOM` 原始监听均归零 | RED: `r1-red-edge-cases.log`（`I05_RED_NO_DISPOSE_LEAK: show=3 hide=3`）<br>GREEN: `r1-green-node-tests.log`（`[MOCK-WX/I01/I05/T08]` 与 `[MOCK-DOM/I05/T08]` 均 `PASS`，原始监听 `[0, 0]`） | **CLOSED** |
| `I06` | `tsc --noEmit` 对客户端全量检查失败（`Label.HorizontalAlign`/`Label.Overflow` 类型引用错误、`target` 不支持 `BigInt`） | `CodeFirstFactory.ts` 错误使用命名空间类型；`tsconfig.json` 未声明 ES2020/DOM | 改为从 `'cc'` 直接导入 `HorizontalTextAlignment`、`VerticalTextAlignment`、`Overflow`；更新 `apps/game-client/tsconfig.json` 并新增覆盖启动/UI/平台/共享桥接的全量 `tsconfig.typecheck.json` | GREEN: `r1-green-typecheck.log`（`npm --prefix apps/game-client run typecheck` `EXIT=0`；`tsc --noEmit -p apps/game-client/tsconfig.json` `EXIT=0`） | **CLOSED** |
| `V01` | `npm --prefix apps/game-client run test:frontend` 执行 `0` 项测试仍退出码 `0` | 脚本错误匹配 `*.test.mjs`，且未将零用例视为失败 | `apps/game-client/package.json` 指向 `node ../../tests/frontend/fe-000/run-node-tests.mjs`；运行器通过 `node:test` `run()` 精确计数，缺失文件或 `total === 0` 或 `passed === 0` 或 `failed > 0` 均以退出码 `1` 失败 | RED: `r1-red-v01-test-entry.log`（`tests 0, pass 0, EXIT=0`）<br>GREEN: `r1-green-node-tests.log`（`7/7 PASS, EXIT=0`）+ 负向验证 `--files=missing.test.ts` 与 `--files=` 均 `EXIT=1` | **CLOSED** |
| `V02` | 缺少正式 Web 打包产物自动化验证脚本，且运行环境未严格区分 `WECHAT_MOCK` / `WECHAT_DEVTOOLS` / `WECHAT_DEVICE` | 此前未在仓库落盘真实 Web E2E 验证与微信产物审计脚本 | 新增 `tests/frontend/fe-000/verify-web-build.mjs`（零外部依赖 Chrome CDP，18 项断言 + 4 截图 + JSON）与 `verify-wechat-build.mjs`（10 项产物审计）；`PlatformTypes.ts` 区分 `WECHAT_DEVICE` / `WECHAT_DEVTOOLS` / `WECHAT_MOCK` / `WEB` / `NODE` | GREEN: `r1-green-web-e2e.log`（`18/18 PASS, EXIT=0`）、`r1-green-wechat-audit.log`（`10/10 PASS, EXIT=0`） | **CLOSED** |
| `V03` | 缺失四份 FE-000 交付报告及 `DEVELOPMENT_STATUS.md` | 首审前尚未补齐正式报告 | 本轮在 `reports/frontend/` 完整补齐 5 份报告及全部红/绿证据文件 | 本套交付文档及 `reports/frontend/FE-000/evidence/` | **CLOSED** |

---

## 4. 新增与修改文件清单（严格限定前端所有权范围）

### 4.1 `apps/game-client/`（修改 15 个，新增 1 个）
- `apps/game-client/assets/scripts/bootstrap/BootEntry.ts`（修改）：持有顶层 `RuntimeLifecycleProvider`，绑定真实平台 `HIDE` 自动提交存档与跨重启恢复，暴露自动化只读/控制桥 `__SPIKE_HARNESS__`，在 `onDestroy()` 释放资源。
- `apps/game-client/assets/scripts/platform/WeChatLifecycleProvider.ts`（修改）：修复 Babel `Set` 展开缺陷（改用 `.forEach` 快照），记录 `lastEventSource`、`listenerErrorCount`、`lastListenerError`、`getSubscriberCount()`、`isPlatformAttached()`，严格保持局部 `unsubscribe()` 与所有者 `dispose()` 语义分离。
- `apps/game-client/assets/scripts/platform/WeChatFilePort.ts`（修改）：`[...entries]` 改为 `entries.slice()` 避免 Babel 展开风险。
- `apps/game-client/assets/scripts/platform/WeChatClockProvider.ts`（修改）：`MonotonicTimelineGuard` 优先检查 `!clock.monotonicSupported` 并冻结，`detectWxPerfMicrosecondUnit()` 显式导出供单位审计。
- `apps/game-client/assets/scripts/platform/ExperimentalAdProvider.ts`（修改）：`WeChatRewardedAdAdapter` 增加单实例并发防护与全退出路径 `offClose`/`offError` 清理。
- `apps/game-client/assets/scripts/platform/PlatformTypes.ts`（修改）：细分 `RuntimeEnvKind` 为 `WECHAT_DEVICE | WECHAT_DEVTOOLS | WECHAT_MOCK | WEB | NODE`。
- `apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`（修改）：两个套件在 `try/finally` 中显式释放自建 `RuntimeLifecycleProvider`，支持故障注入钩子；`FS-BG-RECOVERY` 改为在真实 `HIDE` 回调内执行 `repo.commit()`。
- `apps/game-client/assets/scripts/shared/SharedCoreBridge.ts`（修改）：对齐 `BE-000` `epoch.be000` 黄金哈希（1h 状态哈希、1h/24h envelope 文本哈希）；隔离 24h 分片阶段 rAF 统计。
- `apps/game-client/assets/scripts/ui/CodeFirstFactory.ts`（修改）：修复 `HorizontalTextAlignment`、`VerticalTextAlignment`、`Overflow` 从 `'cc'` 的正式类型导入。
- `apps/game-client/assets/subpackages/spike-pack.meta`（修改）：升级为 Cocos 3.8.8 原生 `ver: 1.2.0` + `bundleConfigID: "auto_05wYOSxc5MVIWgbcnp3w7x"`。
- `apps/game-client/settings/v2/packages/builder.json`（修改）：写入 Cocos 3.8.8 原生分包配置（`wechatgame.compressionType = "subpackage"`、`isRemote = false`、`web = "merge_dep"`）。
- `apps/game-client/build-configs/buildConfig_wechatgame.json`（修改）：移除空 `"bundleConfigs": []` 覆盖项。
- `apps/game-client/scripts/build-cocos.mjs`（修改）：强制校验 Web/WeChat 产物清单并自动调用 `verify-wechat-build.mjs`，记录 Cocos 原始退出码（36）及异常/worker 提示。
- `apps/game-client/package.json`（修改）：修复 `test:frontend`，新增 `typecheck`、`verify:wechat`、`verify:web`。
- `apps/game-client/tsconfig.json`（修改）：补充 `ES2020`、`DOM` 与 `skipLibCheck: true`。
- `apps/game-client/tsconfig.typecheck.json`（新增）：全量客户端类型检查配置，覆盖 `assets/scripts/**/*.ts`（启动、UI、平台、共享桥接）。

### 4.2 `tests/frontend/`（修改 2 个，新增 2 个）
- `tests/frontend/fe-000/run-node-tests.mjs`（修改）：零用例/缺失文件强制返回退出码 `1`，汇总执行总数。
- `tests/frontend/fe-000/platform-and-core.test.ts`（修改）：扩展至 7 组测试，覆盖 `I01/I03/I04/I05`、Mock `wx`/DOM 原始监听归零（含订阅后故障注入）、`BE-000` 黄金哈希。
- `tests/frontend/fe-000/verify-wechat-build.mjs`（新增）：微信小游戏实际产物 10 项审计脚本（`game.json` 分包注册、入口 `game.js`、`config.json`、`manifest`、`PNG`、`settings.json` 与主/分包字节统计）。
- `tests/frontend/fe-000/verify-web-build.mjs`（新增）：真实 `build/web-mobile` 无头 Chrome CDP 端到端回归脚本（18 项断言、真实点击/滚轮/切屏/`visibilitychange` + `Page.reload()` 恢复、4 张截图与 JSON 证据）。

### 4.3 `reports/frontend/`（本次补齐 5 份报告 + 证据文件）
- `reports/frontend/FE-000/IMPLEMENTATION_REPORT.md`
- `reports/frontend/FE-000/TEST_REPORT.md`
- `reports/frontend/FE-000/ISSUE_REPORT.md`
- `reports/frontend/FE-000/PLATFORM_HANDOFF.md`
- `reports/frontend/DEVELOPMENT_STATUS.md`
- `reports/frontend/FE-000-R1/TASK.md`（整改任务书）
- `reports/frontend/FE-000/evidence/`：保留红/绿截图（5 张 `.png`）、机器可读结果（2 份 `.json`）以及全部关键验证与构建日志（12 份 `.log`，未修改根 `.gitignore`，通过 `git add -f` 显式纳入版本管理）。

---

## 5. 工具链版本、构建命令与产物体积

| 工具 / 组件 | 实际版本 / 路径 |
|---|---|
| 操作系统 | Windows 10.0.19045 x64 |
| Git | `2.50.1.windows.1` |
| Node.js / npm | `v24.20.0` / `11.4.2` |
| TypeScript | `5.9.3`（本地 `node_modules/typescript`） |
| Cocos Creator | `3.8.8`（`C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`） |
| Google Chrome | `158.0.8127.37`（无头 CDP 实测 Web 构建产物） |
| 微信开发者工具 | `2.01.2510280`（`E:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，服务端口当前关闭） |

| 目标 | 执行命令（工作目录 `E:/idle-fishing-frontend`） | 退出码 | 产物目录 | 文件数与字节体积 |
|---|---|---:|---|---|
| 共享核心构建 | `npm run build:cocos` | `0` | `packages/game-core/dist/cocos` | 9 `.mjs` + 9 `.d.ts`（固定 `358b111`） |
| 客户端全量类型检查 | `npm --prefix apps/game-client run typecheck` | `0` | 无输出（`--noEmit`） | 0 errors |
| Node / Mock 自动化测试 | `npm --prefix apps/game-client run test:frontend` | `0` | `tests/frontend/fe-000/.compiled`（gitignored） | **7/7 PASS** |
| Cocos Web Mobile 构建 | `npm --prefix apps/game-client run build:web` | `0`（Cocos CLI 原始退出码 `36`） | `apps/game-client/build/web-mobile` | **36 文件，2024.74 KB（2,073,333 bytes）**，耗时 `158.3s` |
| Cocos 微信小游戏构建 + 产物审计 | `npm --prefix apps/game-client run build:wechat` | `0`（Cocos CLI 原始退出码 `36`） | `apps/game-client/build/wechatgame` | **41 文件，1936.20 KB（1,982,670 bytes）**<br>• 主包：**34 文件，1933.67 KB（1,980,073 bytes）**<br>• 分包 `subpackages/spike-pack/`：**7 文件，2.54 KB（2,597 bytes）**，耗时 `162.1s` |
| 真实 Web 产物端到端回归 | `npm --prefix apps/game-client run verify:web` | `0` | `reports/frontend/FE-000/evidence/r1-green-web-results.json` | **18/18 PASS**，4 张截图，0 控制台错误 |

---

## 6. T13 端到端缺陷闭环链路（可追溯 RED -> FIX -> GREEN）

本阶段完整记录两条真实可追溯的缺陷闭环链路：

### 链路 A（初始 Cocos 场景类绑定缺陷，`43f666b` 前）
1. **RED（故障现场）**：`Boot.scene` 中手写 `"__type__": "BootEntry"` 导致 Cocos 3.8.8 运行时报错 `Error 3817`（组件类未找到），Web 页面白屏/黑屏无 UI。证据：`reports/frontend/FE-000/evidence/t13-before-build.log`、`reports/frontend/FE-000/evidence/t13-before-blank-canvas.png`。
2. **FIX（源码修正）**：在 `apps/game-client/assets/scenes/Boot.scene` 中将组件 `__type__` 修正为 Cocos 3.8.8 压缩脚本 UUID `"be27bNR3gtAJby1so+o2Y8/"`。
3. **GREEN（真实产物回归）**：重建 `build/web-mobile` 后，无头 Chrome 成功挂载 `BootEntry` 并渲染完整 Code First 页面（`r1-green-overview.png`）。

### 链路 B（FE-000-R1 首审真实产物与边界缺陷闭环）
1. **RED（基线 `43f666b` 实测复现）**：
   - `I01`：首审实测 `E:/idle-fishing-review/reports/review/FE-000/evidence/web-results.json` 显示真实 Web 产物 `FS-BG-RECOVERY=FAIL`、`T08-LIFECYCLE-CLOCK=FAIL`（`HIDE/SHOW` 监听器在编译后产物中收到 0 次）。
   - `I02`：`reports/frontend/FE-000/evidence/r1-red-i02-wechat-build.log` 复现 `game.json` 无 `subpackages` 注册、`assets.subpackages=[]`，审计脚本退出码 `1`。
   - `I03/I04/I05`：`reports/frontend/FE-000/evidence/r1-red-edge-cases.log` 复现无单调源接受 +48h（`cursorMs=172810000`）、广告 `load` 拒绝泄露监听（`close=1 error=1`）、并发 `show` 创建 2 实例（`created=2`）、套件未 `dispose` 残留 `wx` 监听（`show=3 hide=3`）。
   - `V01`：`reports/frontend/FE-000/evidence/r1-red-v01-test-entry.log` 复现 `test:frontend` 执行 `0` 项返回 `EXIT=0`。
2. **FIX（源码与配置修正）**：按第 3 节修复 `WeChatLifecycleProvider.ts`、`WeChatClockProvider.ts`、`ExperimentalAdProvider.ts`、`PlatformVerificationSuite.ts`、`BootEntry.ts`、`CodeFirstFactory.ts`、`spike-pack.meta`、`builder.json`、`run-node-tests.mjs`、`build-cocos.mjs` 等 18 个前端文件。
3. **GREEN（修后全量回归）**：
   - `test:frontend`：`7/7 PASS`（`r1-green-node-tests.log`），零用例/缺文件负向退出码 `1`。
   - `typecheck`：`0 errors`（`r1-green-typecheck.log`）。
   - `build:wechat` + `verify:wechat`：`10/10 PASS`（`r1-green-wechat-audit.json`）。
   - `build:web` + `verify:web`：`18/18 PASS`（`r1-green-web-results.json` + 4 张截图）。

---

## 7. 后端共享模块依赖确认与跨机恢复方法

| 确认项 | 实际情况 |
|---|---|
| 当前使用的后端共享模块提交 SHA | `358b11105cfdee9bd076049c86a34d8f0aaa00e7`（`Preserve pre-R1 backend snapshot`，为当前 `feature/fe-000` 历史父提交固定版本） |
| 共享模块源码及构建产物来源 | 源码来自本分支 `packages/game-core/src/`（`358b111`），由 `npm run build:cocos` 生成至 `packages/game-core/dist/cocos/`（9 `.mjs` + 9 `.d.ts`）；前端通过 `apps/game-client/package.json` 的 `"@idle-fishing/game-core": "file:../../packages/game-core"` 引用 |
| 是否已接入 `BE-000-R1` 整改后版本 | **否（NO）**。`BE-000-R1` 尚未通过 Codex 独立复审，本分支严格保持 `358b111` 依赖，未擅自合并 `r1/be-000`，亦不将其标记为正式验收基线 |
| 当前前端测试使用的实际后端版本 | 全部 Node/Mock、Cocos Web 与微信产物测试均基于 `358b11105cfdee9bd076049c86a34d8f0aaa00e7` 构建出的 `@idle-fishing/game-core` |

### 7.1 其他电脑恢复相同依赖与重新构建的方法
因为 `feature/fe-000` 的父提交已固定 `packages/game-core/`（`358b111`）及根 `package-lock.json`，在任意具备 Node.js 24+、Cocos Creator 3.8.8 与 Chrome 的电脑上执行以下命令即可 100% 恢复相同依赖并重跑构建与测试：

```powershell
git clone https://github.com/Revee1106/idle-fishing.git
cd idle-fishing
git checkout feature/fe-000
npm ci --ignore-scripts --no-audit --no-fund
npm run build:cocos
npm --prefix apps/game-client run typecheck
npm --prefix apps/game-client run test:frontend
npm --prefix apps/game-client run build:web
npm --prefix apps/game-client run verify:web
npm --prefix apps/game-client run build:wechat
npm --prefix apps/game-client run verify:wechat
```

### 7.2 后续待后端复审后必须重跑的联调测试（当前暂停点）
待 `BE-000-R1` 通过 Codex 独立复审并由负责人下发正式共享模块版本后，前端需执行以下联调复测（当前**未**擅自合入未审核后端代码，亦**未**启动 `FE-001`）：
1. 切换至负责人指定的已复审共享核心版本，重新执行 `npm run build:cocos`。
2. 对齐 `BE-000-R1` 变更后的信封规范序列化与 SHA-256 规则（设计待批准事项 `BE-D01`，含 `G01`/`G02` 向量及任何 API 签名更新）。
3. 接入 `BE-000-R1` 新增的 5 倍事件压力负载测试夹具（对应 `BE-D02`/`FE-D01` 10s 实验目标），在 Node、Web 及后续微信真机上重新采集性能与堆内存数据。
4. 重新执行全套 `typecheck`、`test:frontend`、`build:web`、`verify:web`、`build:wechat`、`verify:wechat`，提交联合复审。
