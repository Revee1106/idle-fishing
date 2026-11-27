# FE-000-R1-INTEGRATION-REWORK-01 问题与边界报告（ISSUE_REPORT）

## 1. 复审发现项闭环状态（来自 Astra `CODE_REVIEW.md`）

| 复审编号 | 任务编号 | 问题摘要 | 本轮处理 | 开发方回归状态 |
|---|---|---|---|---|
| `F1` | `P1-01` | `BrowserFilePort` 探针失败静默降级至内存 `Map`，导致 `BootEntry` 将已有存档误判为 `EMPTY` 并假报 `COMMITTED` | 移除静默内存降级；`BrowserFilePort` 抛 `STORAGE_UNAVAILABLE`；`SingleWriterSaveCoordinator.loadSafe()` 返回 `STORAGE_UNAVAILABLE`；`BootEntry` 冻结写入并支持恢复后重载原存档 | **FIXED_PENDING_REVIEW**（Node + 真实 Web `web_p1_01_compat_save_boot_unavailable` 已通过） |
| `F2` | `P1-02` | `BootEntry` 同步捕获旧状态与旧 `revision`，导致 `HIDE -> SHOW -> HIDE` 第二次提交返回 `CONFLICT` 丢进度 | `HIDE` 入队后在执行时读取最新确认状态、最新 `revision`、停机与销毁标志，并串行化 `advancePersistState` 与提交 | **FIXED_PENDING_REVIEW**（真实 Web `web_p1_02_compat_lifecycle_hide_show_hide` 与 `web_p1_02_queued_hide_after_uncertain_halts` 已通过） |
| `F3` | `P1-03` | `run-node-tests.mjs` 将空文件或全跳过测试误报 `pass=1` 且退出 `0`；旧零用例日志为空 | 修正计数规则仅统计真实执行叶用例，剔除文件包装、skip、todo；空/全跳过/失败/缺文件/空参均非零退出；补齐 5 夹具与 7 份完整非空日志 | **FIXED_PENDING_REVIEW**（7 场景独立日志与自检全通过） |
| `F4` | `P2-04` | 同库或共享存储并发提交产生双 `COMMITTED / rev1 / slot0` 静默覆盖 | 新增应用层 `SingleWriterSaveCoordinator`（进程级按 `storageKey` 独占队列），统一接入 `BootEntry` 与 `PlatformVerificationSuite`，未修改后端受保护源码 | **FIXED_PENDING_REVIEW**（`COMPAT-SAVE-CONCURRENT-COMMIT` 3 组交错测试全通过） |
| `F5` | 非独立阻塞 | 全新干净 worktree 未构建 Cocos 时缺少 `temp/declarations/cc.d.ts`，直接运行客户端 `typecheck` 返回 `2` | 保留 `typecheck` 真实失败码与配置；在 `REWORK_HANDOFF.md` 明确干净目录需先运行一次 `build:web` 生成 `cc.d.ts` 再执行 `typecheck` | **DOCUMENTED** |

---

## 2. 架构与并发能力边界（显式声明）

1. **单写者调用前置条件**：
   - 前端所有业务与测试持久化写入必须通过 `SingleWriterSaveCoordinator`（按 `storageKey` 共享同一独占队列）。
   - 底层后端 `packages/game-core/src/spike/save.ts`（`SpikeFileSaveRepository`）为已审核受保护源码，未在本轮修改；若外部调用方绕过协调层直接对底层 `SpikeFileSaveRepository` 发起并行 `commit()`，后端本身不提供锁。如未来正式引擎需支持多写者原子性，应由后端共享模块所有者评估。
2. **浏览器跨多标签页并发边界**：
   - `SingleWriterSaveCoordinator` 提供**同一 JS 运行态 / 单进程**（含微信小游戏单进程、单浏览器页签）内的严格单写者排他性；**不宣称**浏览器多个独立标签页同时写入 `localStorage` 的跨进程原子性。
3. **前端 `tsconfig.typecheck.json` 严格度**：
   - 沿用基线 `strict: false`、`noImplicitAny: false`（未声称全前端严格模式验收；后端 `npm run typecheck:cocos` 严格消费者检查保持 `EXIT=0`）。

---

## 3. 仍处 `BLOCKED` 的外部平台验证项（留待 `GATE-01` 联合验收）
- 微信开发者工具登录态、CLI 服务端口、正式测试 AppID 与 `wx.loadSubpackage` 运行时加载。
- 代表性中低端真机（Android/iOS）的 `wx.getFileSystemManager()`、切后台强杀进程恢复、`wx.getPerformance().now()` 实际单位采样、24h 与 5 倍事件压力真机性能。
- 正式微信激励视频广告位 `adUnitId` 与真实广告 SDK 回调。
- 家庭电脑生成的 `BE-000-R1` 及 `P2` 独立复审原件同步至 `E:\idle-fishing-review`。
