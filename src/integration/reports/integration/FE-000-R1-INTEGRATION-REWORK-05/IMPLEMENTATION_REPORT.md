# FE-000-R1-INTEGRATION-REWORK-05 实施报告（IMPLEMENTATION_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-05`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **完成日期**：2026-11-27
- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`

---

## 1. 候选文件变动清单（相对 REWORK-04 逐字节核对）

### 1.1 本轮修改文件（7 个，含 1 个新触碰的已跟踪 UI 工厂文件）

| # | 文件路径 | 对应项 | 核心修改摘要 |
|---:|---|---|---|
| 1 | [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) | REV4-01 / REV4-03 / REV4-04 | 扩展 `SharedTxMarker` 增加最小历史证据字段 `priorSaveHistory` 与 `confirmedRevision`（兼容旧版 v1 标记保守解析）；`loadSafe()` 禁止对非确认首次创建的 `EMPTY` 静默清标（`SAVE_DISAPPEARED_PENDING_RECOVERY`）及低于确认历史版本的 `VALID` 静默解冻（`REVISION_REGRESSION_PENDING_RECOVERY`）；部分 IO 写入/更新 `FROZEN` 标记单调保留最高已知备份版本；严格区分 `TX_STATE_UNREADABLE`（读 IO 错）、`TX_STATE_CORRUPT`（内容损坏，生成含 SHA-256 的只读预览）与 `PENDING_RECOVERY_REQUIRED`；新增锁内重校验标记与 3 槽摘要的受控恢复方法 `recoverFromCorruptTxMarker()` |
| 2 | [CodeFirstFactory.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/ui/CodeFirstFactory.ts) | REV4-02 / REV4-03 / REV4-04 | 新增最小 Code-First 存储异常与恢复浮层 `createStorageRecoveryOverlay()`，包含状态/原因/只读备份/配额恢复指引文本、主按钮 `BtnRecoverStorage`（Re-check & Recover Save）与仅在 `TX_STATE_CORRUPT` 且存在已校验有效存档时才显示的独立二次确认按钮 `BtnConfirmCorruptMarkerRecovery` |
| 3 | [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) | REV4-02 / REV4-03 / REV4-04 | 挂载 `StorageRecoveryOverlay` 并在冻结/异常时自动展示；实现与保存队列严格串行化的用户显式恢复 `triggerUserRecovery('STANDARD' \| 'CONFIRM_CORRUPT_MARKER')`，具备并发点击去重、恢复期间 HIDE/SHOW 交错安全串行、恢复成功后严格用真实持久化状态替换内存状态、恢复失败保持冻结并允许安全重试、销毁后异步回调永不重新激活（闭包镜像 `latestPendingQueue`）；生产 `__SPIKE_HARNESS__` 保持精确 14 个只读/UI 键不变（0 新增破坏性接口） |
| 4 | [WeChatFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/WeChatFilePort.ts) | REV4-03 | `writeTxState()` 写入 `__tx_state__.json` 后立即执行回读比对，若发生截断或短写立即抛 `WRITE_IO_ERROR` 中止（0 槽位写入） |
| 5 | [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) | 运行时健壮性 | `write()` 的 `cursorReq.onsuccess` 回调内增加 `try/catch`，当 `store.put` 同步抛错（如 `QuotaExceededError`）时干净 abort 事务并 reject Promise，彻底消除未捕获全局异常 |
| 6 | [platform-and-core.test.ts](file:///E:/idle-fishing-integration/tests/frontend/fe-000/platform-and-core.test.ts) | REV4-01 / REV4-03 / REV4-08 | 保留原有全部 20 项测试（其中损坏标记断言由 `TX_STATE_UNREADABLE` 细化强化为 `TX_STATE_CORRUPT`），新增 9 项回归（20 → **29 项**）：REV4-01 恢复安全矩阵、REV4-03 受控损坏标记恢复矩阵，以及 7 项 `[MOCK-WX]` 微信事务标记与恢复边界定向用例 |
| 7 | [verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs) | REV4-01–04 | 默认输出目录更新为 `reports/integration/FE-000-R1-INTEGRATION-REWORK-05/evidence/web-rework05`；保留原有全部 31 项断言，新增 3 大真实 Chrome 158 专项（31 → **34 项**）：REV4-01/03 恢复安全矩阵、REV4-02/04 真实 UI 指针点击显式恢复闭环（含截图 `r5-recovery-overlay.png`）、REV4-03 真实 UI 损坏标记二次确认恢复 |

### 1.2 本轮新增源码/夹具文件（0 个）

无新增源码文件、无新增测试夹具、无新增无关抽象层。

### 1.3 沿用未改动候选文件（30 个，与 REWORK-04 逐字节一致）

- 前端源码（6 个）：`FaultInjectingFilePort.ts`、`PlatformTypes.ts`、`PlatformVerificationSuite.ts`、`SingleWriterSaveCoordinator.ts.meta`、`SharedCoreBridge.ts`、`OverviewPage.ts`
- 前端测试运行器/守卫/配置（4 个）：`node-test-worker.mjs`、`run-node-tests.mjs`、`safe-path-guard.mjs`、`tsconfig.json`
- 测试夹具（20 个）：`tests/frontend/fe-000/fixtures/` 下全部 20 个夹具文件

候选前端代码/测试/夹具总计 **37 个文件**（7 修改 + 30 沿用）。58 个受保护后端文件对 `5bcc9ac` 均为 **0 字节差异**。

---

## 2. 四项核心问题整改详解（严格区分“冻结能力”与“恢复闭环”）

### 2.1 `REV4-01`（P1）：防止存档异常消失或版本回退后静默解冻

1. **最小标记元数据扩展**：
   - `SharedTxMarker` 新增 `priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE' | 'CONFIRMED_VALID' | 'UNKNOWN'` 与 `confirmedRevision: string | null`。
   - 仅当 `commit()` 已在后端 `SpikeFileSaveRepository.commit()` 中零 IO 错误扫描全部 3 槽并确认全空、即将写入第 1 版时，才设置 `priorSaveHistory = 'CONFIRMED_EMPTY_INITIAL_CREATE'` 且 `confirmedRevision = null`。
   - 若 `expectedRevision !== null`，设置 `priorSaveHistory = 'CONFIRMED_VALID'`、`confirmedRevision = expectedRevision`；若写前槽位读失败（未确认空盘）而 `expectedRevision === null`，保守写入 `priorSaveHistory = 'UNKNOWN'`（**绝不将 `expectedRevision === null` 一律解释为首次创建**）。
   - 解析旧版缺少 `priorSaveHistory` 的 v1 标记时：`expectedRevision !== null` 保守推导为 `CONFIRMED_VALID`，`expectedRevision === null` 保守推导为 `UNKNOWN`。
2. **历史证据单调保留（Rules 5 & 6）**：
   - `mergePriorHistory(existing, observedBackupRev)` 计算已知最高合法 revision；部分 IO 故障写入或更新 `FROZEN` 标记时，将 `readOnlyBackup.revision` 与已有标记历史单调合并，永不丢失此前确认的存档存在证据。
3. **恢复安全拦截（Rules 1, 2, 3, 7）**：
   - 扫描结果 `EMPTY` 且存在标记时：仅当 `priorSaveHistory === 'CONFIRMED_EMPTY_INITIAL_CREATE' && expectedRevision === null && confirmedRevision === null` 才允许清标解冻为 `EMPTY`；其余情况（已有 `rev1`、带备份的 `FROZEN`、历史 `UNKNOWN`、旧版 `expectedRevision=null`）一律保持冻结、保留标记并返回 `SAVE_DISAPPEARED_PENDING_RECOVERY`。
   - 扫描结果 `VALID` 且 `res.revision < max(confirmedRevision, expectedRevision)` 时：保持冻结、保留标记、暴露只读备份并返回 `REVISION_REGRESSION_PENDING_RECOVERY`，绝不静默解冻。
   - 本轮不提供删除存档、强制开新档或放弃旧档动作；无法安全确认的域持续冻结并展示清晰原因。

### 2.2 `REV4-02`（P1）：应用级显式恢复入口与 UI 闭环

1. **真实 Spike UI 异常界面与恢复动作**：
   - `BootEntry` 挂载 `StorageRecoveryOverlay`（`CodeFirstFactory.ts`），在启动冻结（含 `clearPendingTxMarker: false` 刷新保持冻结）或运行期 HIDE 触发 `UNCERTAIN`/`STORAGE_UNAVAILABLE` 时自动弹出，展示 `loadStatus`、`storageHealth`、`recoveryClassification`、`readOnlyBackup`、`reason` 与恢复指引。
   - 用户通过点击真实 UI 按钮 `BtnRecoverStorage`（“Re-check & Recover Save”）触发 `triggerUserRecovery('STANDARD')`；自动启动、刷新、SHOW、HIDE 均不会静默清标。
2. **并发、生命周期与状态一致性保证**：
   - 恢复动作与 HIDE 保存共用同一串行队列 `latestPendingQueue`（并同步到 `this.pendingHideSave`），严格互斥串行。
   - 通过 `activeRecoveryPromise` 对恢复期间重复点击去重（累加 `recoveryDuplicateClicksIgnored`），失败结束后释放锁允许安全重试。
   - 恢复期间到达的 `SHOW` 仅计数不解冻；到达的 `HIDE` 排在恢复之后——若恢复失败则记录 `SKIPPED_HALTED`（0 写），若恢复成功则基于恢复后的最新持久化状态与 `revision` 执行提交。
   - 恢复成功后严格以真实持久化 `raw` 状态和 `revision` 覆盖 `this.persistState` / `this.persistRevision`（绝不沿用冻结前旧内存状态），仅在完整恢复成功后清除 `persistenceHalted` 并隐藏浮层。
   - 恢复前与恢复 `await` 返回后双检 `this.isComponentDestroyed()`（基于 `WeakSet` + `isValid`），已销毁的 `BootEntry` 绝不被异步恢复回调重新激活，且记录 `CANCELLED_DESTROYED`。
   - `__SPIKE_HARNESS__` 保持精确 14 个只读/UI 键，未重新引入任何已移除的破坏性诊断 API。

### 2.3 `REV4-03`（P2）：损坏事务标记分类与受控恢复

1. **三态严格区分**：
   - 标记读 IO 异常 → `TX_STATE_UNREADABLE`（禁止受控恢复）；
   - 标记可读但内容截断/损坏 → `TX_STATE_CORRUPT`（只读扫描 3 槽，仅当零 IO 错误且存在 `VALID` 存档时构造 `corruptMarkerRecoveryPreview`，含 `corruptMarkerSha256`、`verifiedRevision`、`slotsSnapshotSha256` 与可能回退未确认进度的明确警告）；
   - 标记合法但未确认 → `PENDING_RECOVERY_REQUIRED`（普通恢复入口处理）。
2. **受控二次确认恢复**：
   - 普通“Re-check & Recover Save”按钮绝不自动丢弃损坏标记；仅当 `TX_STATE_CORRUPT` 且 `canConfirmRecovery === true` 时显示独立二次确认按钮 `BtnConfirmCorruptMarkerRecovery`。
   - `recoverFromCorruptTxMarker(confirmation)` 在同一 Web Lock 互斥边界内重新探针、重读并校验当前损坏标记 SHA-256、重扫全部 3 槽确认零 IO 错误与有效 Envelope 及盘面 SHA-256（若确认前后并发发生变化则返回 `CONCURRENT_RECOVERY_STATE_CHANGED` 拒绝；若无有效档/空盘/存在 IO 错误则禁止），校验全过时**仅清理损坏标记、绝不删除任何有效存档槽**。
3. **微信端标记写入自检**：
   - `WeChatFilePort.writeTxState()` 写入后立即回读校验内容一致，截断写入在触碰任何存档槽前即被拦截；不引入未经验证的平台原子 rename 假定，真实微信持久化与异常行为留待 `GATE-01` 真机补验。

### 2.4 `REV4-04`（P2）：配额与真实存储失败的保守冻结与可恢复性

- 保持对 `QUOTA_EXCEEDED`、`WRITE_IO_ERROR` 等真实存储失败的保守冻结设计（写 `FROZEN` 标记并保留已确认历史版本、返回 `STORAGE_UNAVAILABLE`、绝不自动反复重试、绝不返回虚假 `COMMITTED`）。
- 故障仍存在时点击 UI 恢复按钮保持冻结并展示原因；玩家释放存储空间或恢复存储权限后，点击“Re-check & Recover Save”按钮完成全量扫描、重新加载最新持久化版本并解除冻结，后续 HIDE 正常保存。
- UI 浮层文案与本报告均明确提示玩家影响（需先释放空间/恢复权限，再点击显式恢复）。
