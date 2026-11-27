# FE-000-R1-INTEGRATION-REWORK-04 设计问题与风险（DESIGN_ISSUES）

分类口径：

- **实质性缺陷**：会造成数据丢失、功能错误或验收不可信，需在 GATE-01 前修复。
- **已批准的设计取舍**：有明确批准依据、行为边界清楚、风险可接受。
- **外部环境阻塞**：受平台/环境限制，不能在本机完成。
- **非阻塞改进建议**：不影响本轮安全/正确性，可后续处理。

---

## REV4-01（P1，实质性缺陷，阻塞）— 有效存档域在“槽位消失”后被 EMPTY 静默清标

**依据**：任务书 5.4：“对此前已有有效存档的域，不能在无法解释存档消失的情况下仅凭 EMPTY 清除待确认标记。”

**代码**：`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts:604-630`。`loadSafe()` 只要 `SpikeFileSaveRepository.load()` 返回 `VALID` 或 `EMPTY`，且探针/3 槽读取零 IO 错误，就清除 `existingMarker` 并 `markStorageAvailable()`；未检查 `existingMarker.expectedRevision`（该字段已在 `:120-130` 定义、`:273-280` 解析）。

**复现**（`evidence/r4-a02-engine.mjs`、`a02-engine.json`）：

1. 使用真实 IndexedDB 端口提交 rev1。
2. 写入合法 `PENDING` 标记：`expectedRevision='1'`, `targetRevision='2'`（模拟 rev1→rev2 的进行中提交）。
3. 删除 3 个 `save_slot_*.json`（模拟外部/异常导致的“存档消失”，盘面 EMPTY）。
4. 调用公开的显式恢复 `coord.loadSafe()`。

实际：`kind=EMPTY`、`revision=null`、`markerAfter=null`、`storageHealth=AVAILABLE`。即“此前确有有效存档”的证据（`expectedRevision='1'`）被忽略，域被当作新档放行。

**影响**：一旦应用接入任务书 5.4 要求的显式恢复入口，该路径会在存档意外消失时静默开新档并清除待确认标记，造成旧存档不可恢复的丢失。这是数据安全问题，不是 UI 优化。补充说明：当前 `BootEntry` 启动固定使用 `clearPendingTxMarker:false`，因此该缺陷目前不能从自动启动路径触发；但 `loadSafe()` 默认参数就是“显式恢复”，是任务书要求应用暴露的恢复入口，开发方自己的 Web E2E 也以该默认调用完成恢复，所以该缺陷属于 A02 显式恢复边界的一部分，必须在恢复入口落地前修复。

**建议**：

- 当 `existingMarker.expectedRevision !== null` 且扫描结果为 `EMPTY` 时，fail-closed，保留标记并返回新分类（例如 `SAVE_DISAPPEARED_PENDING_RECOVERY` / `EMPTY_WITH_PRIOR_REVISION`）。
- `FROZEN` 标记若由 `loadSafe` 的部分 IO 路径写入，应记录观测到的最高可读 revision（`readOnlyBackup`），供后续 EMPTY 判断；不要一律写 `expectedRevision:null`（`:552-562`）。
- 只有用户明确选择“开始新档/放弃旧档”（独立确认动作）时才允许清除该标记。
- 补充“有效存档 + 标记 + 槽位消失”的 Node 与真实 Chrome 用例，正反两路（第一档 expectedRevision=null 的 EMPTY 仍应正常恢复）。

---

## REV4-02（P1，实质性缺陷，阻塞）— 应用没有明确的显式恢复入口，标记一旦存在即永久 halt

**依据**：任务书 5.4：“应用存在明确的恢复入口，不依赖破坏性诊断 API。”；`docs/interfaces/19-平台适配存档广告与版本接口.md:77`（CORRUPT/UNSUPPORTED 需“开放只读错误界面和明确删除/恢复入口”）。

**代码/事实**：

- `BootEntry.ts:190-310` 的唯一加载调用是 `:197` `coordinator.loadSafe({ clearPendingTxMarker: false })`；自动启动/刷新故意不清标（这是正确的安全行为）。
- `:252-277` 在 `STORAGE_UNAVAILABLE`（包括存在未恢复标记）时设置 `persistenceHalted=true`，不重试、不恢复；`:411-596` 的 HIDE 队列随后记录 `SKIPPED_HALTED`，不再调用协调器。
- 生产 `__SPIKE_HARNESS__`（`:622-669`）共 14 个只读/UI/诊断键，无任何 `recover/retry/clear/reset` 类入口；`clearSlotsForTest` 已移除（A04 通过）。
- 应用 UI（OverviewPage/PlatformPage）没有存储错误恢复界面；PlatformPage 只跑诊断套件，且诊断使用独立临时命名空间（`PlatformVerificationSuite.ts:64-99`）。

**实测**（`evidence/r4-a02-app.mjs`、`a02-app.json`）：

- Tab A 在正常 HIDE 中得到 `UNCERTAIN`，`persistenceHalted=true`；刷新后仍 `STORAGE_UNAVAILABLE/halted`。
- Tab B 通过**直接协调器** `loadSafe()` 恢复 rev1 并提交 rev2（盘面成功），但 Tab B 的应用 `BootEntry` 仍 `lastCommitKind=STORAGE_UNAVAILABLE, persistenceHalted=true`，之后 HIDE 仍不保存。
- harness 键匹配恢复类关键词的结果为 `[]`。

**影响**：保存期间崩溃、标记清理失败、配额/写失败、或任何导致标记留存的中断，都会让应用在刷新/重开后仍无法保存或加载；玩家唯一出路是清站点数据（丢失所有存档）或开发者工具手工删标记。任务书要求的“可恢复性”未实现。这不是“结果安全即可”的取舍，而是功能退化。

**建议**（普通应用入口，不是破坏性诊断 API）：

1. 新增存储错误界面（可在 BootEntry 加载失败时显示），展示 `loadStatus/storageHealth/freezeCode/readOnlyBackup` 等只读信息。
2. 提供“重新扫描并恢复”动作：在 Web Lock 内调用默认 `loadSafe()`，展示 VALID/EMPTY/部分 IO/损坏等结果；成功后将 `persistState/persistRevision` 更新为恢复值，清除 `persistenceHalted`，恢复 HIDE/玩家写命令。
3. 对 REV4-01 的“存档消失”场景，提供单独的“开始新档/放弃旧档”确认；不得与普通恢复合并。
4. 对损坏标记提供“校验全部槽位后丢弃损坏标记”的确认动作（同时解决 REV4-03）。
5. 保持自动启动 `clearPendingTxMarker:false`；恢复必须由用户显式触发。
6. 补充应用级真实 Chrome 用例：A `UNCERTAIN` → A 刷新 → 用户在 A 内恢复 → A 再次 HIDE 成功；以及不允许自动静默恢复。

---

## REV4-03（P2，实质性限制）— 损坏/不可读标记无法通过公开 API 恢复；微信标记非原子写

**代码**：

- `loadSafe` 在标记读取/解析失败时立即返回 `TX_STATE_UNREADABLE`（`SingleWriterSaveCoordinator.ts:493-505`）；清标分支（`:604-630`）不可达。`commit` 同样阻断（`:673-685`）。`clearSharedTxMarker` 为 private，且只在成功读标后调用。
- 唯一清除方式为原始端口 `clearTxState()`（`BrowserFilePort.ts:519-537`、`WeChatFilePort.ts:287-289`），未暴露给应用/harness。
- 微信 `writeTxState` 直接 `writeFileSync` 到 `__tx_state__.json`（`WeChatFilePort.ts:255-265,283-285`），非临时文件+重命名；崩溃/掉电可能留下截断文件。

**实测**：

- Chrome：种入 `{broken-marker-json` → 两次 `loadSafe()` 均 `STORAGE_UNAVAILABLE/TX_STATE_UNREADABLE`；只有手动 `port.clearTxState()` 后恢复（`a02-engine.json` `corruptMarker`）。
- MOCK-WX：同样 fail-closed；手动清除后 VALID（`wechat-marker.log` `A02-MARKER-CORRUPT`）。
- 真实微信：**BLOCKED / NOT_RUN**，无法验证 `writeFileSync` 的崩溃撕裂行为。

**影响**：标记损坏时域永久不可写/不可恢复（安全但不可用）。在微信上，写前标记本身可能因崩溃被撕裂，存在“存档槽完好但应用永久无法存档”的风险。任务书 5.3/5.4 要求说明可恢复性；开发方报告未披露。

**建议**：

- 微信标记采用“临时文件 + rename”或平台提供的原子替换（若可用）；写入后回读校验。
- 或提供显式恢复：在锁内读取并校验全部 3 槽（零 IO 错误、Envelope/SHA 有效）后，经用户确认删除损坏标记并恢复；损坏标记不等于损坏存档，不能把它当 CORRUPT 档处理。
- 在报告中如实记录“损坏标记需人工/受控恢复”的边界；真实微信真机补验前不得宣称完整可恢复。

---

## REV4-04（P2，设计取舍/文档）— QUOTA 等真实写失败的保守冻结未说明影响与可恢复性

**代码**：`FATAL_STORAGE_ERROR_CODES` 包含 `QUOTA_EXCEEDED/WRITE_IO_ERROR/REMOVE_IO_ERROR/LIST_IO_ERROR`（`SingleWriterSaveCoordinator.ts:145-153`）。槽位写抛 `QUOTA_EXCEEDED` 后后端复扫确认未写→`FAILED`，但 `fatalErrors` 非空→写 `FROZEN` 标记 + 冻结（`:845-865`）。

**影响**：玩家释放空间后，应用仍需显式恢复；当前无应用入口（REV4-02），因此配额失败可能变成永久无法保存。该选择本身不造成数据损坏，属于保守安全取舍；但任务书 5.3 明确要求“若实现选择保守冻结，必须说明其依据、玩家影响以及可恢复性”，开发方报告未说明。

**建议**：二选一并在报告中写明：

- A. 对“3 槽可读、零 IO 错误、版本未变”的确定性配额失败，清标并返回 `FAILED`（不冻结），让玩家释放空间后重试；或
- B. 保留冻结，但在应用内提供恢复动作，并在报告中说明玩家影响（需释放空间 + 手动恢复）。

---

## REV4-05（P3，报告准确性）— “暂存区无任何前端文件”表述不精确

`REWORK_HANDOFF.md` §1 / `TASK.md` §2 写“暂存区无任何前端文件”。实际相对 `MERGE_HEAD=5bcc9ac`，index 中有 70 个前端文件（它们来自 `HEAD=be62996` 的前端基准，本轮整改本身确实未新增暂存的前端修改）。准确表述应为“本轮整改的前端改动均在工作树（未暂存）；暂存区相对 HEAD 无前端变更”。不影响候选安全；建议修正报告措辞。

---

## REV4-06（P3，已知限制）— A09 后台完整平台检查挂起

原始证据（`r3-t2-a09.log` / `r3-a09-only.log`）与开发方解释一致：后台标签页 Chromium rAF 节流 + 大量 IndexedDB 写/NTFS 刷盘 + 120s 看门狗；单独 FS/Save 诊断 6/6 ×2 通过。完整 `runAllPlatformChecks()` 后台并发仍 **NOT_RUN**，只影响诊断脚本，不影响正式存档路径。**归档为非阻塞已知限制。**

---

## REV4-07（P3，报告准确性/A10）— “A02 已关闭”表述过宽

`ISSUE_REPORT.md` §1 将 A02 标为“已修复并实证”，并列 11 项全部满足；但任务书 5.4 的两项（EMPTY 清标、应用恢复入口）未满足，损坏标记恢复也未披露。建议在下一轮报告中把“跨页冻结已关闭”与“恢复边界待关闭”分开表述，避免把安全修复等同于 A02 全部验收。

---

## REV4-08（P3，测试覆盖）— 微信事务标记缺少开发方自己的定向 Mock 用例

开发方 20/20 新增的是共享标记协议与 P2；`WeChatFilePort` 的 `readTxState/writeTxState/clearTxState` 未在开发方测试中直接覆盖。审核方已用独立 `[MOCK-WX]` 7/7 覆盖并通过；建议开发方将其纳入正式测试集，并在报告中明确区分 Mock 与真机。

---

## 已批准的设计取舍（本轮确认，不升级为缺陷）

1. **浏览器 IndexedDB 为唯一线性一致介质，Web Locks 跨页互斥**：真实 Chrome 24 轮 + 2 空盘竞争 0 双 COMMITTED，成立。
2. **无 IndexedDB 的真实浏览器 fail-closed，不回退 localStorage**：任务书要求，实测成立。
3. **旧 localStorage 实验存档只读检测、不自动迁移/不复活/不删除**：任务书批准策略；`DETECTED_IGNORED_NO_AUTO_MIGRATION` 实测成立。正式迁移体系为设计待决项。
4. **存在未恢复标记时自动启动/刷新保持冻结**：正确的跨页安全行为；问题在于缺少用户显式恢复入口，而非自动冻结本身。
5. **`storageHealth` 同步 getter 仅作本 Realm 快速失败缓存**：提交/恢复一律锁内读真实标记；开发方 §2.4 已披露，成立。

---

## 外部环境阻塞（不影响本轮代码判定）

- 微信开发者工具/真机/真实 FS/生命周期/分包/真实激励广告：**BLOCKED / NOT_RUN**。
- 操作系统级真断电、磁盘静默位翻转：**NOT_RUN**（CDP 关闭进程 ≠ 硬件断电）。
- 非管理员 Windows 文件/目录符号链接：**NOT_RUN**（NTFS Junction/EACCES 已覆盖）。
- 后台标签页并发完整 `runAllPlatformChecks()`：**NOT_RUN**（REV4-06）。

---

## 非阻塞改进建议

- 在报告和 UI 中把 `PENDING_RECOVERY_REQUIRED / TX_STATE_UNREADABLE / SAVE_DISAPPEARED` 等恢复分类展示给用户，避免只显示 `STORAGE_UNAVAILABLE`。
- 标记写入增加回读校验（写入后立即读回比对 JSON），提高微信端的可检测性。
- 为标记/恢复路径增加属性化或随机故障测试（掉电点、顺序交错），扩展 A02 的夜间回归。
- 清理 `BrowserFilePort.clearAll()` 等诊断用破坏性 helper 的使用范围（当前未暴露到生产 harness，无安全问题）。

---

## 结论

**REV4-01、REV4-02 为 P1 实质性缺陷，必须在 GATE-01 前修复**；REV4-03/REV4-04 为 P2，应修复或在报告中明确接受理由、玩家影响与可恢复性；REV4-05–08 为 P3 报告/覆盖改进。最终判定 **REWORK**。