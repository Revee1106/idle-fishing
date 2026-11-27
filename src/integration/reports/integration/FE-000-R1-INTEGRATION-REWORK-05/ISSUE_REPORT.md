# FE-000-R1-INTEGRATION-REWORK-05 问题与风险边界报告（ISSUE_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-05`
- **日期**：2026-11-27
- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`

---

## 1. 上轮审核问题（REV4-01 至 REV4-08）处置总表

> 严格口径声明（对应 REV4-07）：本表区分**跨标签页安全冻结**与**显式恢复闭环**，且“开发方已修复并实证”仅代表开发方自测与回归通过，**最终关闭须由 DeepSeek 定向独立复验与 GPT-6.2 Astra High 最终独立复审确认**。

| 审核编号 | 级别 | 主题 | 开发方处置状态 | 对应验证证据 |
|---|---|---|---|---|
| **REV4-01** | **P1（阻塞）** | 有效存档域槽位消失后被 `EMPTY` 静默清标 | **开发方已修复并实证** | 扩展 `SharedTxMarker`（`priorSaveHistory` + `confirmedRevision`）；`EMPTY` 仅在显式 `CONFIRMED_EMPTY_INITIAL_CREATE` 时允许清标；`VALID` 版本低于确认历史时拦截为 `REVISION_REGRESSION_PENDING_RECOVERY`；Node + 两套 Chrome 158 全部 5 类边界全绿 |
| **REV4-02** | **P1（阻塞）** | 应用无显式恢复入口导致标记留存后永久 halt | **开发方已修复并实证** | 新增 Code-First `StorageRecoveryOverlay` 与 `BtnRecoverStorage`；与保存队列串行化、去重点击、支持 HIDE/SHOW 交错与销毁安全；两套独立 Chrome 158 经真实 UI 指针点击完整通过 11 项应用恢复场景（截图 `r5-recovery-overlay.png`）；`__SPIKE_HARNESS__` 保持 14 键无破坏性接口 |
| **REV4-03** | **P2** | 损坏/不可读标记无法经公开 API 恢复；微信标记截断风险 | **开发方已收口并实证（Web/Mock-WX）；真机待补验** | 严格区分 `TX_STATE_UNREADABLE`（读 IO 错）、`TX_STATE_CORRUPT`（内容损坏）与 `PENDING_RECOVERY_REQUIRED`；新增锁内重校验摘要的 `recoverFromCorruptTxMarker()` 与独立二次确认 UI 按钮 `BtnConfirmCorruptMarkerRecovery`；微信 `writeTxState` 增加写入回读自检。真实微信断电/截断持久性仍为 `BLOCKED / NOT_RUN`（待 `GATE-01` 真机补验） |
| **REV4-04** | **P2** | `QUOTA` 等真实存储失败保守冻结的玩家影响与恢复路径 | **开发方已收口并实证** | 保持保守冻结（`FROZEN` 标记保留历史版本、不自动反复重试、不返虚假 `COMMITTED`）；玩家释放空间/恢复权限后通过正式 UI `BtnRecoverStorage` 恢复最新持久化版本并解冻；UI 文案与报告已明确玩家影响与操作路径 |
| **REV4-05** | **P3** | 报告“暂存区无任何前端文件”表述不精确 | **本轮报告已修正** | 本轮 `TASK.md`、`IMPLEMENTATION_REPORT.md`、`REWORK_HANDOFF.md` 均精确表述为“本轮及历次集成整改的前端改动均在工作树（未暂存）；相对 `HEAD`，暂存区仅含 58 个后端受保护文件，无前端变更暂存”；历史报告保持 0 改动 |
| **REV4-06** | **P3** | 后台标签页完整 `runAllPlatformChecks()` 并发挂起 | **归档为非阻塞已知限制** | 独立 FS/Save 并发已通过；后台 `rAF` 节流仅影响诊断脚本，不影响正式存档路径，不扩大整改 |
| **REV4-07** | **P3** | 上轮报告将安全冻结与完整恢复混为一谈 | **本轮报告已修正** | 本轮报告严格区分“跨页故障冻结（R4 已闭环）”与“恢复安全边界及应用级恢复闭环（R5 新增闭环）”，不以冻结通过替代恢复通过 |
| **REV4-08** | **P3** | 微信事务标记缺少开发方正式 Mock 回归 | **开发方已纳入正式回归** | `platform-and-core.test.ts` 新增 7 项 `[MOCK-WX/REV4-08/*]` 定向用例（29/29 PASS），明确标注 Mock 宿主、不替代真机 |

---

## 2. 本轮调试中额外发现并修复的真实缺陷

1. **`BrowserFilePort.write()` 同步异常未捕获**：在真实 Chrome 158 应用级恢复验证中，当 `IDBObjectStore.prototype.put` 在 `cursorReq.onsuccess` 回调内同步抛出 `QuotaExceededError` 时，异常逸出事件回调触发全局 `Runtime.exceptionThrown`。已在 `BrowserFilePort.ts` 的 `cursorReq.onsuccess` 内包裹 `try/catch`（捕获后干净 abort 事务并 reject Promise），复测两套 Chrome Profile 均达到 **0 控制台错误、0 未捕获异常**。
2. **`BootEntry` 销毁后等待在途恢复队列**：Cocos Creator 3.8.8 `_destroyImmediate()` 会在 `onDestroy()` 后清空组件自有字段 `this.pendingHideSave`。已通过闭包镜像 `latestPendingQueue` 确保销毁后观察方仍可准确等待在途异步任务收敛，同时确认销毁后的 `BootEntry` 绝不被异步恢复回调重新激活。

---

## 3. 明确安全边界、玩家影响与未执行限制

1. **无法安全恢复的异常存档域（REV4-01）**：
   - 当盘面扫描为 `EMPTY` 但事务标记证明此前存在有效存档或历史未知（`SAVE_DISAPPEARED_PENDING_RECOVERY`），或盘面最高有效版本低于标记确认历史版本（`REVISION_REGRESSION_PENDING_RECOVERY`）时，系统**有意保持冻结**以防止静默覆盖或误开新档。本轮不实现删除存档/强制开新档/放弃旧档功能，相关高危操作留待正式存档产品流程设计。
2. **`QUOTA` 等真实存储失败的玩家影响（REV4-04）**：
   - 发生存储满/写权限失败时，本次保存不会产生虚假 `COMMITTED`，应用立即停止后续自动写入并弹出存储异常界面。玩家需要清理设备/浏览器存储空间或恢复存储权限，随后手动点击界面中的“Re-check & Recover Save”按钮完成全量校验恢复；若故障未解除，恢复会失败并保持安全冻结，支持多次安全重试。
3. **损坏事务标记受控恢复的边界（REV4-03）**：
   - 仅当标记**可读但内容损坏**且全部 3 个存档槽零 IO 错误、存在至少 1 个有效 Envelope 时，才允许用户通过独立的二次确认按钮丢弃损坏标记并恢复至已校验的有效存档（可能丢失损坏事务中尚未确认的最新进度）；若发生读 IO 错误、空盘、槽位损坏或确认期间盘面并发变动，一律拒绝。
4. **外部环境阻塞（`BLOCKED / NOT_RUN`）**：
   - 微信开发者工具、微信真机（真实 FS 写入持久性/崩溃撕裂行为、前后台生命周期、分包加载、真实激励广告 `adUnitId`）仍为 **`BLOCKED / NOT_RUN`**，须在 `GATE-01` 真机环境完成补验。
   - 操作系统级真断电、磁盘静默位翻转、Windows 非管理员符号链接及后台标签页完整 `runAllPlatformChecks()` 仍为 **`NOT_RUN`**。
5. **正式设计待决项（延续）**：
   - **DESIGN-OPEN-SAVE-MIGRATION**：正式版本若需支持历史 Web `localStorage` 实验存档迁移或用户主动“放弃旧档/重置新档”流程，须由设计方在正式存档设计阶段单独审批定义。
