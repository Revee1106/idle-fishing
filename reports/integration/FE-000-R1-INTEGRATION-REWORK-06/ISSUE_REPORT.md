# FE-000-R1-INTEGRATION-REWORK-06 问题台账与边界说明（ISSUE_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-06`
- **日期**：2026-11-27
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（等待 GPT-6.2 Astra High 定向独立复审；**不代表独立复审通过或 `GATE-01` 已批准**）

---

## 一、本轮 Astra 复审阻塞项处置台账

| 编号 | 严重级 | 问题描述 | 整改前复现 | 整改措施 | 开发方自检状态 |
|---|---|---|---|---|---|
| `R5-01` | P1 | 已确认 `rev=2` 在部分 IO 后新建 `FROZEN` 标记仅记备份 `rev=1`，最高槽消失后恢复接受 `rev=1` 且旧状态可重占 `rev=2` | 已通过 `repro-r5-01-before.mjs` 100% 复现 | 引入域级持久化单调 `SaveHistoryMeta` 纳入互斥与提交确认边界；部分 IO 与恢复判定统一取 `max(historyFloor, markerFloor, backup)`；元数据确认失败绝不返 `COMMITTED` | **FIXED_PENDING_ASTRA_REVIEW**（独立复验 + Node/Mock-WX/2×Chrome 跨页刷新全绿） |
| `R5-02` | P2 | 真实槽位写入持续报 `QuotaExceededError` 时，仅凭读盘与 `__probe__` 成功即点击恢复提前解冻 | 已通过 `repro-r5-02-03-before.mjs` 在真实 Chrome UI 100% 复现 | 真实写失败冻结持久化 `requiresWriteVerification=true`；恢复采用方案 A 执行零收益/零时间推进的三槽检查点提交（空盘执行槽路径写回读删探针），失败返回 `WRITE_CAPABILITY_UNAVAILABLE` 并保留只读备份与冻结 | **FIXED_PENDING_ASTRA_REVIEW**（独立复验 + Node/Mock-WX/2×Chrome 真实按钮点击全绿） |
| `R5-03` | P2 | 确认损坏标记（或普通恢复）等待 Web Lock 期间销毁 `BootEntry`，释放锁后仍执行清标并误报 `CANCELLED_DESTROYED` | 已通过 `repro-r5-02-03-before.mjs` 在真实 Chrome UI 100% 复现 | 为 `loadSafe` / `recoverFromCorruptTxMarker` 引入 `RecoveryLifecycleHooks`（锁后读前 + 写前零 `await` 间隙双检查，基于 `WeakSet<BootEntry>`）；写前取消返 `CANCELLED`（0 副作用），已开始写后销毁安全完成并如实记 `COMPLETED_AFTER_DESTROY` | **FIXED_PENDING_ASTRA_REVIEW**（独立复验 + Node/Mock-WX/2×Chrome 跨页等锁/写中/抛错全绿） |

---

## 二、测试设施观察项（非设计缺陷）

| 编号 | 类别 | 现象与原因 | 处理方式 |
|---|---|---|---|
| `OBS-R6-01` | 上轮移植 `race.mjs` 超时 | Astra 上轮移植的 REWORK-03 `race.mjs` 在无后台防节流参数、无 CDP 单步超时、串行等待后台标签页情况下被 240s 外部超时中止 | 新增兼容的独立竞争脚本 `r6-isolated-race.mjs`（补齐 `--disable-background-timer-throttling`、`--disable-renderer-backgrounding`、30s CDP 超时与并发 `Promise.all`），两套独立 Profile 实测 49.8s / 27.2s 全绿，同时完整保留 `verify-web-build.mjs` 既有 12 轮竞争覆盖 |
| `OBS-R6-02` | `run-node-tests.mjs` 默认 worker 超时 | `P1-03` 串联执行 21 次 `tsc` 子编译，随正式测试增多耗时约 163–171s，逼近原 180s 默认上限 | 在 `run-node-tests.mjs` 中保持有界超时校验（`200..600000ms`）并将默认值调整为 `300000ms`；A07 挂起回归（`--worker-timeout-ms=1200`）仍严格 1.2s 强杀 |

---

## 三、既有非阻塞限制与外部平台阻塞（诚实保留）

| 编号 | 状态 | 说明 |
|---|---|---|
| 微信开发者工具运行时验证 | `BLOCKED / NOT_RUN` | 当前未接入真实微信开发者工具运行时；本轮仅完成真实 Cocos 微信构建与 10 项静态审计及 8 项 `[MOCK-WX]` 适配器测试 |
| 微信小游戏真机运行、物理持久性与硬件断电原子性 | `BLOCKED / NOT_RUN` | 无真机环境；`WeChatFilePort` 的即时回读自检仅提供软件层读回验证，不声称硬件断电原子替换 |
| 真实激励视频广告（`T09-REAL-AD`） | `BLOCKED / NOT_RUN` | 无正式 `adUnitId` 与真机环境，仍由实验性 Stub 覆盖 5 场景协议 |
| `A09` / `REV4-06` 后台标签页完整诊断并发 | `ACCEPTED_NOT_RUN` | 沿用初审及复审已接受的非阻塞限制；日常诊断已按随机命名空间隔离 |
| 本地全量数据与元数据均遭外部擦除 | `KNOWN_CAPABILITY_BOUNDARY` | 无服务端/云端备份前提下，若外部进程同时删除全部 3 个存档槽、全部 `__save_history__` 与 `__tx_state__`，前端无法凭空恢复已物理擦除的历史数据或下限 |
| `REV3-03` 旧 `localStorage` 实验档 | `ACCEPTED_POLICY` | 维持只读检测、不删除、不复活、不自动迁移策略；真实浏览器缺失 IndexedDB 时严格 fail-closed 拒写 |
