# FE-000 / FE-000-R1 前端问题与阻塞报告（ISSUE_REPORT）

## 1. 首审缺陷闭环汇总（`I01–I06`、`V01–V03`）

| 编号 | 级别 | 问题摘要 | 当前状态 | 复核依据 |
|---|---|---|---|---|
| `I01` | 阻塞（首审） | Cocos Web 构建产物中 `WeChatLifecycleProvider` 使用 `[...this.listeners]` 在 Babel `loose` 模式下失效，导致 `HIDE/SHOW` 监听器收到 0 次 | **已修复（Web/Node/Mock 已闭环）** | `r1-green-web-results.json`（直接 `System.import` 打包产物 + 真实 `visibilitychange` + `Page.reload()` 全部 `PASS`） |
| `I02` | 阻塞（首审） | 微信构建产物 `game.json` 未注册 `subpackages`，`spike-pack` 留在主包 | **已修复（产物审计 10/10 PASS）** | `r1-green-wechat-audit.json`（`game.json` 注册 `subpackages/spike-pack/`，7 文件 `2.54 KB`） |
| `I03` | 高 | `MonotonicTimelineGuard` 在无单调时钟能力时未冻结 +48h 跳变 | **已修复** | `r1-green-node-tests.log`（`[NODE/I03/T08] PASS`） |
| `I04` | 高 | `WeChatRewardedAdAdapter` 在 `load/show` 拒绝时残留事件监听、同请求并发创建多实例 | **已修复（Mock SDK 闭环）** | `r1-green-node-tests.log`（`[MOCK-WX/I04/T09] PASS`） |
| `I05` | 高 | 测试套件未作为 Provider 所有者释放 `RuntimeLifecycleProvider`，导致正常/异常退出残留 `wx`/DOM 监听 | **已修复（保持局部 `unsubscribe()` 语义不变）** | `r1-green-node-tests.log`（`MOCK-WX` 与 `MOCK-DOM` 均 `[0,0]`） |
| `I06` | 中 | 全量客户端 `tsc --noEmit` 报错（`Label` 对齐类型与 `ES2020` `BigInt` 目标） | **已修复** | `r1-green-typecheck.log`（`EXIT=0`） |
| `V01` | 阻塞（首审） | `test:frontend` 匹配空文件列表、执行 0 项仍退出 `0` | **已修复** | `r1-green-node-tests.log`（`7/7 PASS`；空列表/缺文件负向返回 `EXIT=1`） |
| `V02` | 中 | 缺少真实 Web 产物自动化验证与微信产物审计脚本，环境标识未细分 | **已修复** | `verify-web-build.mjs`（`18/18`）、`verify-wechat-build.mjs`（`10/10`）、`PlatformTypes.ts` |
| `V03` | 高 | 缺少四份交付报告与前端开发状态更新 | **已修复** | 本套 `reports/frontend/` 5 份交付文档 |

---

## 2. 当前未决阻塞项（真实微信平台条件限制 — `BLOCKED`）

以下阻塞均源于外部平台权限、IDE 安全端口开关与真机硬件条件缺失，前端已如实记录，**未**擅自开启服务端口、**未**购买设备或服务、**未**以 Mock/Web 结果替代验收：

| 编号 | 影响用例 | 阻塞原因 | 所需解锁条件（需负责人或环境提供） |
|---|---|---|---|
| `FE-BLK-01` | `T01`（微信运行态）、`T10`（微信分包运行时加载） | 本机已安装微信开发者工具 `2.01.2510280`，但 CLI 服务端口处于关闭状态（实测 `r1-wechat-cli-check.log`：`[error] 工具的服务端口已关闭`），且当前使用游客 `touristappid` | 在微信开发者工具手动开启 `设置 -> 安全设置 -> 服务端口`，登录开发者账号并导入 `apps/game-client/build/wechatgame`，替换为正式测试 AppID |
| `FE-BLK-02` | `T04`（真机 FS 与配额）、`T05`（切后台与系统强杀恢复）、`T08`（真机 `wx.onHide`/`wx.onShow` 与 `wx.getPerformance().now()` 实测单位） | 无可用微信真机测试设备与正式 AppID | 负责人或测试人员提供至少一台代表性中低端手机（Android/iOS），通过真机预览/体验版执行文件系统、强退恢复与时钟探针实测 |
| `FE-BLK-03` | `T06`（中低端微信真机 24h 性能、帧耗时与额外内存） | 无微信真机硬件条件；当前仅有 Node 与桌面 Chrome 无头参考值 | 真机运行 Page 1 `Run 24h Offline Perf` 并采集耗时、单片最大耗时与内存峰值，供 `GATE-01` 正式性能预算审批 |
| `FE-BLK-04` | `T09`（真实激励视频广告拉取、完整播放、提前关闭与网络失败） | 无正式微信小游戏 AppID 及已审核的真实 `adUnitId` | 申请并配置测试/正式激励视频 `adUnitId`，在微信真机上替换 `EXPERIMENTAL_STUB` 执行真机广告用例 |

---

## 3. 已知技术注意事项与平台观察（非阻塞）

| 编号 | 类别 | 现象与影响 | 应对措施与建议 |
|---|---|---|---|
| `FE-OBS-01` | 引擎工具链（Cocos 3.8.8） | Cocos Creator 3.8.8 CLI 构建成功返回原始退出码 **`36`**（非 `0`），偶发 stderr 提示 `Workers failed to exit gracefully`（产物文件与清单完整） | `apps/game-client/scripts/build-cocos.mjs` 已将原始码 `36` 映射为脚本成功，但强制结合关键错误关键字检测与实际产物清单/分包审计脚本共同判定成败 |
| `FE-OBS-02` | 引擎编译差异（Babel `loose`） | Cocos 3.8.8 内置 Babel `loose: true` 会将 `[...set]` 编译为 `[].concat(set)`，在 Node 下完全通过但在 Web/微信小游戏打包后静默失效 | 规范要求前端及任何共享模块禁止对 `Set`/`Map` 使用数组展开语法，统一使用 `forEach` 或 `Array.from`（并经真实构建产物回归） |
| `FE-OBS-03` | 微信计时 API 单位差异 | 微信小游戏不同基础库/系统（iOS vs Android vs DevTools）中 `wx.getPerformance().now()` 曾存在微秒（us）与毫秒（ms）差异 | `WeChatClockProvider.ts` 已实现 `detectWxPerfMicrosecondUnit(sample)` 启发式换算，但**必须**在真机解锁后（`FE-BLK-02`）用连续采样实测确认真实返回值量级，防止错误缩放 |
| `FE-OBS-04` | 仓库 `.gitignore` 规则 | 根目录 `.gitignore` 默认忽略 `*.log`，常规 `git add` 不会自动跟踪 `.log` 证据文件 | 未越权修改根 `.gitignore`；本次通过 `git add -f` 将 `reports/frontend/FE-000/evidence/*.log` 与 `.json`/`.png` 一并纳入版本管理，确保远端完整可复核 |

---

## 4. 跨角色交接与待协调事项（不越权修改）

### 4.1 需与后端（`BE-000-R1`）对接事项
1. **已复审共享模块版本下发**：前端当前固定于整改前共享核心 `358b11105cfdee9bd076049c86a34d8f0aaa00e7`。待 `BE-000-R1` 通过独立审核后，需由负责人指定共享模块提交 SHA，前端再执行同步与联合回归。
2. **信封规范化与哈希契约（`BE-D01`）**：当前 `358b111` 中 `generate-vectors.ts` 的 `envelopeSha256` 对整个外层序列化 JSON 文本计算哈希；`R1/HANDOFF.md` 已给出 `BE-D01` 待批方案（外层数组 `[magic,format,revision,epoch,payload]` 的无 BOM UTF-8 字节哈希及 `G01`/`G02` 向量）。待后端按批准方案更新共享模块后，前端同步更新 `SharedCoreBridge.ts` 与前端单测断言。
3. **5 倍事件压力夹具（`BE-D02` / `FE-D01`）**：`R1/HANDOFF.md` 提及 5 倍事件压力负载 10s 实验目标。建议由后端在共享测试夹具中提供标准化 5x 压力配置，保证前后端在 Node、Web 与微信真机测得同一工作负载。

### 4.2 需由负责人/根工具链维护方协调事项
1. **根目录 `package.json` 聚合脚本（可选）**：当前前端未触碰根目录 `package.json`，所有前端校验通过 `npm --prefix apps/game-client run <script>` 执行（`test:frontend`、`typecheck`、`build:web`、`build:wechat`、`verify:web`、`verify:wechat`）。若后续 `GATE-01` 需要在仓库根目录提供统一 `test:all` / `verify:fe` 入口，请由根配置责任方统一添加。
2. **正式设计基线/契约**：本轮前端未修改任何 `docs/`、`packages/contracts/` 或 `config/` 文件；已注意到 `docs/interfaces/` 存在待批事项，前端后续 `FE-001` 将严格等待 `GATE-01` 放行与正式冻结版本。
