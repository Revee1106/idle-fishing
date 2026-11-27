# FE-000-R1-INTEGRATION-REWORK-06 最终存档恢复安全不变量实现报告（IMPLEMENTATION_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-06`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **审核依据**：GPT-6.2 Astra High `FE-000-R1-INTEGRATION-REWORK-05` 最终独立复审（`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-05-ASTRA\`），结论 `REWORK`
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（仅代表开发方完成三项安全不变量闭环整改与全量回归，**不代表独立复审通过，不代表 `GATE-01` 已批准**）

---

## 一、本轮改动文件清单与边界核查

本轮仅修改前端存档协调器、平台端口、`BootEntry`、诊断套件及前端自动化测试，**0 修改** 58 个受保护后端文件、`packages/`、`docs/`、`config/` 及历史报告目录：

| 文件路径 | 本轮修改内容 |
|---|---|
| [PlatformTypes.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformTypes.ts) | `FilePort` 新增可选持久化单调历史元数据接口 `readHistoryState?` / `writeHistoryState?` / `clearHistoryState?` |
| [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) | 新增 `BROWSER_HISTORY_STATE_KEY_SUFFIX = '__save_history__'`、跨标签页 IndexedDB 历史读写辅助函数、`BrowserFilePort` / `MemoryFilePort` 历史元数据读写与 `clearAll()` 清理 |
| [WeChatFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/WeChatFilePort.ts) | `WeChatFilePort` 实现 `__save_history__.json` 读写（`writeHistoryState` 附带即时回读自检、`list()` 过滤内部元数据）；`UnavailableFilePort` 对应方法 fail-closed |
| [FaultInjectingFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts) | 透传 `readHistoryState` / `writeHistoryState` / `clearHistoryState`，新增 `setHistoryFault('READ' \| 'WRITE' \| 'CLEAR', boolean)` |
| [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) | 完整实现 R5-01（持久化 `SaveHistoryMeta` 单调版本下限与提交确认边界）、R5-02（`requiresWriteVerification` 与方案 A 零收益恢复检查点提交 + 空盘槽路径写验证）、R5-03（`RecoveryLifecycleHooks` 锁后与写前零 `await` 间隙双检查及 `onMutationStarted` 语义） |
| [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) | 接入 `RecoveryLifecycleHooks`（由 `WeakSet<BootEntry>` 驱动，免疫 Cocos `_destroyImmediate()` 字段清空）；如实区分 `CANCELLED_DESTROYED`（0 副作用）与 `COMPLETED_AFTER_DESTROY`（已开始写后销毁但组件保持停用）；闭包镜像 `latestActiveRecovery`；更新覆盖层提示文案 |
| [PlatformVerificationSuite.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts) | 诊断沙箱 `cleanSlots` 同步清理临时诊断域 `txState`/`historyState`；`T04-CORRUPT` 改为损坏旧槽 `save_slot_2.json`（不回退已确认 `rev=5`），保持单槽损坏恢复与全槽损坏 `CORRUPT` 验证 |
| [platform-and-core.test.ts](file:///E:/idle-fishing-integration/tests/frontend/fe-000/platform-and-core.test.ts) | 保留全部 29 项既有测试（更新 2 处因 R5-01/R5-02 修复而变更的旧预期），新增 4 项 REWORK-06 专项回归（总计 **33 项**） |
| [run-node-tests.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/run-node-tests.mjs) | 保持有界 worker 超时机制不变，将默认超时上限从 `180000ms` 调至 `300000ms`（避免 `P1-03` 21 次串行 `tsc` 编译在 Windows 上逼近 180s 临界值；`--worker-timeout-ms=1200` 挂起回归测试仍严格生效） |
| [verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs) | 保留全部 34 项既有 Web 断言（更新 R5-01/R5-02 检查点版本号预期），新增 3 项 REWORK-06 实机 Chrome 断言（总计 **37 项**）；为 CDP 客户端补齐 `ws.close` 拒止与 45s 超时防静默挂起 |

---

## 二、安全不变量 1：`R5-01`（P1）—— 已确认存档版本单调保护

### 1. 原始缺陷复现证据（整改前）
- 复现脚本与日志：[repro-r5-01-before.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-01-before.mjs)、[repro-r5-01-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-01-before.log)。
- 整改前在相同协调器顺序执行 `commit(s, null) -> rev=1`、`commit(t, '1') -> rev=2`、`loadSafe() -> VALID rev=2` 后：
  - 注入 `save_slot_1.json` 暂时 IO 不可读，执行 `loadSafe()`：生成 `FROZEN` 标记却写入 `expectedRevision="1"`、`confirmedRevision="1"`；
  - 删除 `save_slot_1.json` 并取消 IO 故障，执行 `loadSafe()`：错误返回 `VALID rev=1` 并清除了标记；
  - 继续执行 `commit(s, '1')`：旧状态 `s`（`gold=0`）竟再次以 `COMMITTED rev=2` 覆盖落盘。

### 2. 根因分析
- 正常提交 `rev=2` 成功后，`SingleWriterSaveCoordinator` 仅清除 `__tx_state__` 事务标记，未在存储域中维护独立于临时事务标记之外的**持久化单调已确认版本下限**。
- 当后续触发部分 IO 故障时，`loadSafe()` 看到 `existingMarker === null`，仅从当前可读备份（`rev=1`）合成 `confirmedRevision="1"`，导致已知的更高已确认版本 `rev=2` 在内存与磁盘层面同时丢失。

### 3. 整改方式
1. **独立持久化单调历史元数据 `SaveHistoryMeta`**：
   - 结构 `{ version: 1, storageKey, confirmedRevision, updatedAtMs }`，存储在同一存储域内（浏览器 IndexedDB `${namespace}:__save_history__`、微信 `${rootDir}/__save_history__.json`、`MemoryFilePort.historyState`、无自定义方法的端口按 `storageKey` 共享 `fallbackHistoryStates`），不污染三槽存档路径与 `list()`，不改动后端 `SaveEnvelope` 或三槽协议。
2. **严格纳入互斥锁与提交确认边界**：
   - `commit()` 在独占锁内读取 `SharedTxMarker` 与 `SaveHistoryMeta`；`repo.commit()` 返回 `COMMITTED` 后、清除 `PENDING` 标记之前，调用 `persistMonotonicHistoryMeta(result.revision, persistedHistoryFloor)`。
   - **元数据确认失败绝不返回 `COMMITTED`**：若写入失败，保留/升级事务标记为 `UNCERTAIN`、冻结存储域并返回 `UNCERTAIN`（`COMMIT_HISTORY_META_WRITE_FAILED`）。
   - 未确认的 `targetRevision` 绝不写入 `SaveHistoryMeta`；确定性 `PRE_WRITE_ERROR` 与普通 `CONFLICT` 均不提升已确认下限，且普通 `CONFLICT` 在未进入 `observedPort.write` 前正常返回 `CONFLICT`。
   - 若磁盘实际顶层版本低于 `persistedHistoryFloor` 且有人试图以低 `expectedRevision` 提交，在进入 `observedPort.write` 时、写任何槽位或标记之前拦截并写入 `FROZEN` 标记，返回 `STORAGE_UNAVAILABLE`（`REVISION_REGRESSION_PENDING_RECOVERY`，0 槽写）。
3. **单调合并与保守兼容**：
   - `loadSafe()` 与 `recoverFromCorruptTxMarker()` 均以 `knownConfirmedFloor = max(persistedHistoryFloor, marker.confirmedRevision, marker.expectedRevision)`（BigInt `natToBigInt` 比较）作为下限。
   - 部分 IO 分支使用 `mergePriorHistory(existingMarker, knownConfirmedFloor, readOnlyBackup?.revision ?? null)`，绝不将 `confirmedRevision` 降为较低备份版本；`readOnlyBackup` 仍只读返回当前可读备份。
   - 正常恢复或受控损坏标记恢复若读到低于 `knownConfirmedFloor` 的版本，一律保持冻结（`REVISION_REGRESSION_PENDING_RECOVERY`）并仅提供只读备份；空盘且存在已确认历史下限时一律拒绝静默重置（`SAVE_DISAPPEARED_PENDING_RECOVERY`）。
   - 损坏/旧版非法/不可读历史元数据保守 fail-closed（`HISTORY_STATE_CORRUPT` / `HISTORY_STATE_UNREADABLE`），绝不静默初始化为低版本。

### 4. 修复后反例结果
- 独立复验脚本与日志：[verify-r5-01-after.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-01-after.mjs)、[verify-r5-01-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-01-after.log)（`R5_01_AFTER_PASS: true`）：
  - `4_partial_io_highest_unreadable`：返回 `STORAGE_UNAVAILABLE (PARTIAL_IO_UNAVAILABLE)`，`readOnlyBackup.revision="1"`，`FROZEN` 标记保留 `expectedRevision="2"`、`confirmedRevision="2"`；
  - `5_recover_after_highest_vanished`：返回 `STORAGE_UNAVAILABLE (REVISION_REGRESSION_PENDING_RECOVERY)`，`readOnlyBackup.revision="1"`，标记保留；
  - `6_recommit_stale_s_as_rev2`：返回 `STORAGE_UNAVAILABLE`，磁盘仅剩 `save_slot_0.json`（0 槽写，旧状态无法再占 `rev=2`）。

### 5. 相邻状态回归结果
- Node 正式回归 `[NODE/REWORK-06/R5-01-CONFIRMED-REVISION-MONOTONIC-GUARD]` + `[MOCK-WX/REWORK-06/R5-01-02-03-WECHAT-INVARIANTS]`：覆盖同协调器、新协调器、连续多次故障与标记更新（部分 IO -> 全槽 IO -> 槽消失）、损坏标记不可绕过历史下限、历史元数据写入失败（`UNCERTAIN` 非假 `COMMITTED`）、历史元数据损坏/不可读、正常首次建档、确定性 `PRE_WRITE_ERROR`、普通 `CONFLICT`、已确认版本 `2` 与未确认目标版本 `3` 不一致的正常恢复、微信 `__save_history__.json` 截断回读拦截。
- 真实 Chrome 回归 `web_rework06_r5_01_confirmed_revision_monotonic_cross_tab_reload`（两套独立 Chrome Profile 均 PASS）：实测同协调器、新协调器、第二标签页、以及真实 `Page.reload()` 后均严格阻止 `rev=2 -> rev=1` 回退。

### 6. 剩余能力边界
- 若外部进程同时彻底删除了**全部三个存档槽**且同时删除了**全部历史元数据（`__save_history__`）与事务标记（`__tx_state__`）**，本机本地存储中不再残留任何历史证据，前端无法凭空恢复已物理擦除的数据或历史版本下限（无服务端/云端存档前提下的固有本地存储物理边界）。

---

## 三、安全不变量 2：`R5-02`（P2）—— 恢复成功必须具有真实写入能力

### 1. 原始缺陷复现证据（整改前）
- 复现脚本与证据：[repro-r5-02-03-before.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.mjs)、[repro-r5-02-03-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.log)、[repro-r5-02-03-before.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.json)。
- 整改前对 `:save_slot_` 持续注入 `QuotaExceededError`（保持读、`__probe__` 与 `__tx_state__` 可用）并触发 HIDE 冻结后，在**配额故障仍持续开启**时点击真实 UI 按钮 `BtnRecoverStorage`：
  - 返回 `halted=false`、`outcome="RECOVERED_VALID"`、`overlay=false`、`marker=null`，应用提前解冻开放保存。

### 2. 根因分析
- `BrowserFilePort.probeStorage()` 仅对极小的独立 `__probe__` 键做读写删，无法证明真实存档槽写入路径与容量已恢复；`SingleWriterSaveCoordinator.loadSafe()` 仅凭三槽读取成功即清除 `FROZEN` 标记并通知 `BootEntry` 解除冻结，混淆了“存档读取成功”与“存档写入能力恢复”。

### 3. 整改方式（采用任务书方案 A）
1. **持久化记录写入故障冻结属性**：
   - `SharedTxMarker` 新增 `requiresWriteVerification?: boolean`（对旧版无该字段的 `FROZEN` 标记按 `reason` 是否含 `QUOTA_EXCEEDED`/`WRITE_IO_ERROR`/`Runtime storage write failure` 保守推断）。
   - `commit()` 发生真实写失败（`fatalErrors.length > 0` 导致的 `FROZEN` 或 `UNCERTAIN`）时持久化写入 `requiresWriteVerification: true`；跨标签页与 `Page.reload()` 均无法绕过。
2. **方案 A：零业务收益、零时间推进的安全恢复检查点提交**：
   - `loadSafe()` 对 `VALID` 存档且 `markerRequiresWriteVerification(existingMarker) === true` 时，不直接清标解冻，而是先在独占锁内更新 `PENDING` 标记，随后通过现有 `SpikeFileSaveRepository.commit(verifiedState, res.revision)` 执行一次恢复检查点提交：
     - 严格使用刚通过三槽校验的 `verifiedState`（不调用 `advanceOffline`，不增加金币/经验/鱼获，不推进 `cursorMs` 或 `offline.deadlineMs`）；
     - 严格使用当前真实 `expectedRevision = res.revision`（已通过 R5-01 下限校验，绝不覆盖更高已确认版本）；
     - 写入下一轮转槽位并完成完整 SHA-256 回读确认；
     - **说明**：按现有三槽协议，该恢复检查点提交会产生一个新的存档 revision（`res.revision + 1`），状态与收益与恢复前完全一致。
   - 仅当检查点提交 `COMMITTED`、单调历史元数据持久化成功且事务标记清除成功后，才解除冻结并返回 `VALID`（含新 revision 与原状态）。
   - 若检查点写入失败（配额仍满 / 权限未恢复），保留 `FROZEN` 标记（`requiresWriteVerification: true`、`confirmedRevision` 不提升），返回 `STORAGE_UNAVAILABLE`（`recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE'`）并附带 `readOnlyBackup` 供界面只读展示，绝不宣称 `RECOVERED_VALID`。
3. **已确认空盘首次建档冻结补充验证**：
   - 若为 `CONFIRMED_EMPTY_INITIAL_CREATE` 空盘配额冻结，不伪造业务存档，改为向槽位路径前缀 `save_slot_write_probe.tmp` 执行 2KB 写入 + 精确回读校验 + 立即删除，失败同样返回 `WRITE_CAPABILITY_UNAVAILABLE`。

### 4. 修复后反例结果
- 独立实机 Chrome 复验：[verify-r5-02-03-after.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.mjs)、[verify-r5-02-03-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.log)、[verify-r5-02-03-after.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.json)（`R5_02_03_AFTER_PASS: true`）：
  - 持续配额故障下点击真实 UI `BtnRecoverStorage`：`halted=true`、`overlay=true`、`cls="WRITE_CAPABILITY_UNAVAILABLE"`、`outcome="FAILED"`、`backupRev="1"`、`FROZEN` 标记保留；
  - 撤销配额故障后再次点击 `BtnRecoverStorage`：`halted=false`、`overlay=false`、`outcome="RECOVERED_VALID"`、`rev="2"`、`gold="31"`、`cursorMs=1700000060000`（与冻结前完全一致，零异常收益）、`marker=null`；
  - 再次正常 HIDE：`COMMITTED rev="3"`、`gold="84"`、`cursorMs=1700000120000`。

### 5. 相邻状态回归结果
- Node + `[MOCK-WX]`：`[NODE/REWORK-06/R5-02-WRITE-CAPABILITY-CHECKPOINT-RECOVERY]`、`[MOCK-WX/REV4-08/6-PREWRITE-VS-QUOTA-RECOVERY]` 覆盖有效档配额持续失败与恢复、已确认空盘首次建档配额持续失败与探针清理、旧版无标志 `FROZEN` 标记保守触发写验证、微信 `writeFileSync` 槽位写失败保持冻结与恢复。
- 真实 Chrome：`web_rework06_r5_02_app_ui_persistent_quota_recovery_loop`（两套独立 Profile 均 PASS）及 `web_rework05_rev4_02_04_app_ui_recovery_loop` 验证配额持续期间 HIDE 返回 `SKIPPED_HALTED`（0 写）、恢复后零收益检查点提交及后续 HIDE 正常落盘。

### 6. 剩余能力边界
- 方案 A 检查点提交能够证明当前时刻对真实三槽路径写入当前存档大小的数据并完成回读已恢复，但不代表底层物理磁盘剩余无限空间；若后续游戏进度增长使新存档体积超出剩余配额，仍会由既有写失败冻结机制 fail-closed 拦截。

---

## 四、安全不变量 3：`R5-03`（P2）—— 恢复任务所有者与生命周期

### 1. 原始缺陷复现证据（整改前）
- 复现脚本与证据：[repro-r5-02-03-before.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.mjs)、[repro-r5-02-03-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.log)。
- 整改前在 `{bad` 损坏标记预览界面下，另一请求先持有域 Web Lock，用户点击真实 UI `BtnConfirmCorruptMarkerRecovery`，确认请求进入 Web Lock `pending` 队列后销毁 `BootEntry`（此时标记仍为 `"{bad"`）；释放锁后：
  - 损坏标记被底层清成 `marker=null`（所有者已销毁仍产生磁盘副作用），而组件状态记录却为 `outcome="CANCELLED_DESTROYED"`（记录与真实物理副作用矛盾）。

### 2. 根因分析
- `BootEntry.triggerUserRecovery()` 仅在调用 `coordinator.loadSafe()` / `coordinator.recoverFromCorruptTxMarker()` 之前与 `await` 返回之后检查了 `this.isComponentDestroyed()`，未将所有者取消钩子传入 `SingleWriterSaveCoordinator` 锁内执行路径。
- 当恢复任务在 `navigator.locks.request` 上等待锁期间其所有者被销毁时，一旦锁释放，底层协调器仍照常执行读盘与 `clearSharedTxMarker()`，而回调外层事后将已发生的清标副作用误报为 `CANCELLED_DESTROYED`。

### 3. 整改方式
1. **协调器锁内双检查 + 不可逆副作用分界点（`RecoveryLifecycleHooks`）**：
   - `loadSafe(options)`（`STANDARD`）与 `recoverFromCorruptTxMarker(confirmation, hooks)`（`CONFIRM_CORRUPT_MARKER`）统一支持 `RecoveryLifecycleHooks`：`shouldCancelBeforeMutation`、`onMutationStarted`、`beforeRecoveryBody`。
   - **检查点 1（排队前）**：`BootEntry.triggerUserRecovery()` 入队前及进入 `latestPendingQueue` 任务体时检查 `this.isComponentDestroyed()`。
   - **检查点 2（获取进程内队列与 Web Lock 后，任何 probe / 读盘之前）**：进入 `withExclusiveLock` 回调第一行立即检查 `shouldCancelBeforeMutation()`，已销毁直接返回 `{ kind: 'CANCELLED' }`（0 probe、0 读盘、0 磁盘变更）。
   - **检查点 3（读盘/校验完成后、任何持久化修改之前，零 `await` 间隙）**：在任何 `writeSharedTxMarker` / `clearSharedTxMarker` / `persistMonotonicHistoryMeta` / 检查点提交前再次检查 `shouldCancelBeforeMutation()`；通过后同步调用 `hooks.onMutationStarted()`，随即进入持久化操作，彻底封堵“检查后异步等待”的时间窗口。
2. **免疫 Cocos `_destroyImmediate()` 的生命周期标记**：
   - 所有者存活判定基于模块级 `WeakSet<BootEntry>`（`destroyedBootEntries`）及闭包变量 `latestActiveRecovery` / `latestPendingQueue`，不依赖 Cocos 销毁组件后会被置空的实例字段。
3. **物理副作用与任务记录严格一致**：
   - `loadRes.kind === 'CANCELLED'`（0 持久化副作用）→ 记录 `lastRecoveryOutcome: 'CANCELLED_DESTROYED'`，保持 `persistenceHalted: true`。
   - 若 `mutationStarted === true`（持久化修改在销毁前已合法开始），允许底层事务安全完成；若返回时所有者已销毁，组件**绝不被重新激活**（保持 `persistenceHalted: true`、`persistState = null`、不接收新 HIDE），同时如实记录 `lastRecoveryOutcome: 'COMPLETED_AFTER_DESTROY'`（绝不伪装为未执行的 `CANCELLED_DESTROYED`）。
   - 保留原有 `HIDE` 保存队列串行化、销毁取消及单任务异常隔离（异常不毒化后续队列）。

### 4. 修复后反例结果
- 独立实机 Chrome 复验：[verify-r5-02-03-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.log)（`R5_02_03_AFTER_PASS: true`）：
  - `r503_destroyed_while_waiting_lock`：`marker="{bad"`、`slotRevs=["1","2","3"]`；
  - `r503_after_lock_released`：`outcome="CANCELLED_DESTROYED"`、`halted=true`、`marker="{bad"`（字节未变）、`slotRevs=["1","2","3"]`（全部槽位未变）。

### 5. 相邻状态回归结果
- Node + `[MOCK-WX]`：`[NODE/REWORK-06/R5-03-RECOVERY-OWNER-CANCELLATION]` 与 `[MOCK-WX/REWORK-06/R5-01-02-03-WECHAT-INVARIANTS]` 覆盖 `CONFIRM_CORRUPT_MARKER` 等锁销毁、`STANDARD` 等锁及读盘后写前销毁（均 `CANCELLED` + 0 副作用）、以及 `onMutationStarted()` 后销毁允许安全完成且不伪装为 `CANCELLED`。
- 真实 Chrome：`web_rework06_r5_03_app_ui_recovery_owner_lifecycle`（两套独立 Profile 均 PASS）完整覆盖：
  1. 跨标签页（Tab A 持 Web Lock，Tab B 真实点击 `BtnConfirmCorruptMarkerRecovery` 等锁期间销毁 Tab B）→ `CANCELLED_DESTROYED`，`{bad` 与三槽逐字节不变；
  2. 跨标签页（Tab A 持锁，Tab B 真实点击 `BtnRecoverStorage` + 排队期间重复点击去重 + 交错排队 HIDE 后销毁）→ `dupIgnored>=2`、`CANCELLED_DESTROYED`、原 `FROZEN` 标记与三槽不变、排队 HIDE 记 `SKIPPED_DESTROYED`；
  3. 暂停在 `clearTxState`（已过 `onMutationStarted`）期间销毁 `BootEntry` → 标记合法清除（`markerAfter=null`），如实记录 `COMPLETED_AFTER_DESTROY` 且组件保持销毁停用；
  4. 恢复期间抛出异常 → 异常被隔离捕获（`outcome=FAILED`，0 未捕获异常），队列未被毒化，再次点击 `BtnRecoverStorage` 成功恢复 `rev=3`。

### 6. 剩余能力边界
- 当 JavaScript 执行已合法越过 `onMutationStarted()` 并向 IndexedDB / 微信文件系统发出底层写/删事务后，若组件在底层异步 I/O 返回前销毁，事务按不变量 6 允许完成并通过 `COMPLETED_AFTER_DESTROY` 如实反映物理结果；浏览器或操作系统本身无法对已提交至 storage service 的异步 I/O 做零副作用硬回滚。
