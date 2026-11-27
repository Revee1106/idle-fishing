# FE-000-R1-INTEGRATION-REWORK-04 代码审查（CODE_REVIEW）

- 审查对象：`E:\idle-fishing-integration` 工作树（HEAD `be62996` + MERGE_HEAD `5bcc9ac` + 未提交前端整改）
- 只读；未修改任何候选源码、测试、配置或设计文档。
- 行号基于 2026-11-27 当前工作树文件。

---

## 1. 本轮变更范围（逐字节核实）

相对 REWORK-03，实际修改 **8 个文件**，另外 **28 个代码/测试/夹具文件逐字节未变**，**0 新增源码/夹具**：

| # | 文件 | 角色 |
|---:|---|---|
| 1 | `apps/game-client/assets/scripts/platform/PlatformTypes.ts` | 新 `BROWSER_STORAGE_UNAVAILABLE`、`LegacyLocalStorageStatus`、可选 `readTxState/writeTxState/clearTxState/getLegacyStorageStatus` |
| 2 | `apps/game-client/assets/scripts/platform/BrowserFilePort.ts` | IndexedDB 标记读写清、P2 fail-closed、遗留 localStorage 只读检测 |
| 3 | `apps/game-client/assets/scripts/platform/WeChatFilePort.ts` | `__tx_state__.json` 标记、`list()` 过滤 |
| 4 | `apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts` | 标记故障注入/透传 |
| 5 | `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` | 写前标记、锁内权威读、恢复门禁 |
| 6 | `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | 启动 `clearPendingTxMarker:false`、`legacyExperimentalSave` 只读快照 |
| 7 | `tests/frontend/fe-000/platform-and-core.test.ts` | 18→20；显式 Node Mock opt-in |
| 8 | `tests/frontend/fe-000/verify-web-build.mjs` | 28→31；A02 12 场景 + P2 |

沿用未改动（28）：`PlatformVerificationSuite.ts`、`SingleWriterSaveCoordinator.ts.meta`、`SharedCoreBridge.ts`、`OverviewPage.ts`；`node-test-worker.mjs`、`run-node-tests.mjs`、`safe-path-guard.mjs`、`tsconfig.json`；`fixtures/` 20 个。与 `FILES-REWORK.sha256` 逐一匹配。

---

## 2. 共享事务标记协议（主体实现）

### 2.1 标记结构与校验

`SingleWriterSaveCoordinator.ts:120-130` 定义 `SharedTxMarker`：`version/storageKey/txId/state(PENDING|UNCERTAIN|FROZEN)/expectedRevision/targetRevision/createdAtMs/updatedAtMs/reason`。`parseSharedTxMarker`（`:244-305`）严格校验 JSON、version=1、storageKey 完全匹配、txId 非空、state 合法、revision 为 string|null、时间戳为 number、reason 为 string|null；任何异常都返回 `ok:false`，随后一律 fail-closed。

标记位置：

- 浏览器：IndexedDB `idle_fishing_fs_v1/files` 中的 `${namespace}:__tx_state__`（`BrowserFilePort.ts:28-33,179-229`）。
- 微信：`${USER_DATA_PATH}/${namespace}/__tx_state__.json`（`WeChatFilePort.ts:279-289`）。
- 自定义包装器：若 `storageKey` 为 `browser:<ns>` 而包装器未实现 tx 方法，协调器自动走同一 IDB 键（`SingleWriterSaveCoordinator.ts:330-370`）。

**结论**：同一存档域的所有正常入口（含自定义 `browser:<ns>` 包装器）使用同一持久化标记；未使用 BroadcastChannel/storage event 作为安全门禁。

### 2.2 提交路径

`commit()`（`:647-884`）在 `withExclusiveLock`（`:405-437`；进程内队列 + `navigator.locks` 的 `idle-fishing:save:${storageKey}` 独占锁）内：

1. 取消钩子（`:654-660`）；本地冻结快速失败（`:662-671`）。
2. **锁内读盘标记**（`:673-685`）；标记存在即本地冻结并返回 `STORAGE_UNAVAILABLE`；读失败/损坏同样冻结。
3. `probeStorage()`（`:688-702`）。
4. `onStarted`/`beforeCommitBody`（`:704-708`）。
5. 构造 `observedPort`：**第一次 `write` 前**写 `PENDING` 标记并等待事务完成（`:736-757`）；标记写失败立即抛 `STORAGE_UNAVAILABLE`，底层 `port.write` **0 次调用**。
6. `SpikeFileSaveRepository.commit()`：写槽 + 精确字节回读；`COMMITTED` 后清标（`:808-818`），清标失败→`UNCERTAIN` 并保留标记；`UNCERTAIN` 升级标记（`:821-842`）；真实存储 IO 错误→`FROZEN` 标记 + 本地冻结（`:845-865`）；确定性 `FAILED`（后端复扫确认未写）→清标并返回 `FAILED`（`:869-877`）。
7. 正常 `CONFLICT` 不会走到 `write`，`markerWritten=false`，不写标、不冻结。

**关键正确性**：标记在槽位写前持久化、清理仅在 COMMITTED 回读成功后、清理失败不返回 COMMITTED、UNCERTAIN 保留标记、不同域使用不同键。实测见 `TEST_VERIFICATION.md` §4。

### 2.3 Web Locks 覆盖范围

`withExclusiveLock` 包住整个 `loadSafe`/`commit` 任务；锁内包括标记读、探针、槽位读、写、回读、标记清理。跨标签页恢复与等待提交实测串行，未出现在未恢复标记下写入。

### 2.4 正常路径不退化（代码层）

- `PRE_WRITE_ERROR`/后端确定性 `FAILED`：`observedPort.write` 先写标，底层写抛错，后端复扫确认无版本变化→`FAILED`；`markerWritten` 为 true 时走 `:869-877` 清标，本地健康保持 `AVAILABLE`。Node/Chrome 实测通过。
- 普通 `CONFLICT`：不写标，无冻结。符合任务书 5.3。
- `QUOTA_EXCEEDED` 被列入 `FATAL_STORAGE_ERROR_CODES`（`:145-153`），在 `:845-865` 被判为真实存储写失败→写 `FROZEN` 标记+冻结。这是保守选择（REV4-04），不是安全绕过；但缺少玩家影响/可恢复性说明与恢复入口。

---

## 3. 显式恢复边界（A02 5.4）

### 3.1 `loadSafe` 流程

`loadSafe()`（`:461-641`）在锁内：

1. `probeStorage()`（`:465-491`）。
2. 读标记（`:493-505`）；不可读/损坏→`STORAGE_UNAVAILABLE` + `TX_STATE_UNREADABLE`。
3. 逐槽观测读取（`:508-528`）；任何 IO 错误→`PARTIAL_IO_UNAVAILABLE` / `IO_UNAVAILABLE`，保留/写 `FROZEN` 标记，冻结（`:530-579`）。
4. `clearPendingTxMarker:false` 且存在标记→`PENDING_RECOVERY_REQUIRED`，不清标（`:581-602`）。启动/刷新使用此路径（`BootEntry.ts:197`）。
5. `VALID` 或 `EMPTY`→清标并 `markAvailable`（`:604-630`）。

### 3.2 缺陷 REV4-01：EMPTY 清标不区分“此前有有效存档”

```ts
// SingleWriterSaveCoordinator.ts:604-630
if (res.kind === 'VALID' || res.kind === 'EMPTY') {
  if (existingMarker !== null) {
    try {
      await this.clearSharedTxMarker();
    } catch (err) { ... }
  }
  markStorageAvailable(this.storageKey);
}
```

`existingMarker` 已包含 `expectedRevision`（`:120-130`、`:273-280`），但 EMPTY 分支完全没有使用它。任务书 5.4 明确：

> “对此前已有有效存档的域，不能在无法解释存档消失的情况下仅凭 EMPTY 清除待确认标记。”

实测（`evidence/a02-engine.json`，场景 `emptyAfterPriorValid`）：

1. 域成功提交 rev1（`expectedRevision='1'` 的 PENDING 标记随后被直接种入，模拟进行中的第 2 次提交）。
2. 3 个槽位被删除（模拟“存档消失”的外部事件），盘面 EMPTY。
3. `coord.loadSafe()`（默认显式恢复）返回 `EMPTY`，**标记被清除**，`storageHealth=AVAILABLE`。

结果：如果应用未来接入显式恢复入口（任务书 5.4 要求），该路径会在“有效存档消失”时静默把域当作新档，造成数据丢失。修复建议：当 `existingMarker.expectedRevision !== null`（或 `FROZEN` 标记记录了观测到的备份 revision）且扫描结果为 `EMPTY` 时，必须 fail-closed（新增分类，如 `SAVE_DISAPPEARED_PENDING_RECOVERY`），保留标记；只有用户明确确认“开始新档/放弃旧档”后才允许清标。第一档（`expectedRevision=null`）的 EMPTY 清标可保留。

### 3.3 缺陷 REV4-02：应用无显式恢复入口，BootEntry 永久 halt

- `BootEntry.ts:190-310` 的 `initializePersistence` 唯一调用为 `:197`：
  ```ts
  const existing = await coordinator.loadSafe({ clearPendingTxMarker: false });
  ```
  `STORAGE_UNAVAILABLE` 分支（`:252-277`）设置 `persistState=null`、`persistRevision=null`、`persistenceHalted=true`，无任何重试/恢复。
- `enqueueHideSave`（`:411-596`）：`persistenceHalted` 后每次 HIDE 记录 `SKIPPED_HALTED`，不调用协调器（`:435-448`）；`STORAGE_UNAVAILABLE`/`UNCERTAIN` 分支设置 halt（`:505-552`）。
- 生产 `__SPIKE_HARNESS__`（`:622-669`）14 个键均为只读/UI/诊断，**无任何恢复、重试、清标、重建入口**；`clearSlotsForTest` 已不存在（A04 仍通过）。
- 实测（`evidence/a02-app.json`）：
  - Tab A `UNCERTAIN`→halt；Tab A 刷新后仍 `STORAGE_UNAVAILABLE/halted`；关闭后 B 仍被阻断（这部分是 A02 的正确安全行为）。
  - Tab B 用**直接协调器** `loadSafe()` 恢复 rev1 并提交 rev2（盘面恢复），但 Tab B 的 `BootEntry` 仍为 `lastCommitKind=STORAGE_UNAVAILABLE, persistenceHalted=true`；此后 HIDE 仍不保存。
  - `application harness exposes NO recovery-like entry :: []`。

任务书 5.4 要求“应用存在明确的恢复入口，不依赖破坏性诊断 API”。当前只有协调器 API + 审核脚本，属于开发/诊断路径，不是应用入口。后果：一次保存期间崩溃、清标失败或保守冻结后，玩家即使刷新/重开也无法恢复存档与保存；唯一出路是直接操作 IndexedDB（或清站点数据，丢失全部存档）。这属于功能正确性/可恢复性问题（P1），不是维护性优化。

修复建议：在应用层提供明确的存储错误界面与恢复动作（普通 UI，不是 destructive diagnostics）：
1. 调用 `loadSafe()`（默认显式恢复）并展示验证结果（VALID/EMPTY/部分 IO/损坏/消失）。
2. 对 `SAVE_DISAPPEARED_PENDING_RECOVERY` 要求单独的“开始新档/放弃旧档”确认。
3. 对损坏标记提供“校验全部槽位后丢弃损坏标记并恢复”的显式确认动作（同时满足 REV4-03）。
4. 恢复成功后更新 `persistState/persistRevision/persistenceHalted`，重新允许 HIDE/玩家写命令。
5. 保持自动启动 `clearPendingTxMarker:false`，不得静默恢复。

### 3.4 REV4-03：损坏/不可读标记无法通过公开 API 恢复

- `loadSafe` 读到损坏标记立即返回 `TX_STATE_UNREADABLE`（`:493-505`），而后面的清标分支（`:604-630`）永远到不了；`commit` 同样在 `:673-685` 阻断。协调器的 `clearSharedTxMarker` 是 private，且只在成功读标后调用。
- 唯一清除方式是原始端口 `port.clearTxState()`（`BrowserFilePort.ts:519-537`、`WeChatFilePort.ts:287-289`），未暴露给应用或 harness。
- Node/Chrome 实测：种入 `{broken-marker-json` 后，`loadSafe` 两次均 `STORAGE_UNAVAILABLE/TX_STATE_UNREADABLE`；必须手动 `clearTxState()` 才能继续（`evidence/a02-engine.json` `corruptMarker`；`evidence/wechat-marker.log` `A02-MARKER-CORRUPT`）。
- 微信 `writeTxState` 直接 `writeFileSync` 到 `__tx_state__.json`（`WeChatFilePort.ts:255-265,283-285`），非临时文件+重命名；崩溃/掉电可能留下截断文件，从而永久砖化。真实微信未验证（BLOCKED/NOT_RUN）。

这是安全性上的“保守死路”，不是绕过；但任务书 5.3/5.4 要求可恢复性说明。建议：微信标记采用临时文件+重命名（若平台原子性允许）；或提供受控的“验证 3 槽后丢弃损坏标记”的显式恢复动作（带用户确认），并补充 Mock/真机用例。

### 3.5 REV4-04：真实写失败/配额失败的保守冻结

`FATAL_STORAGE_ERROR_CODES`（`:145-153`）包含 `QUOTA_EXCEEDED`、`WRITE_IO_ERROR`、`REMOVE_IO_ERROR`、`LIST_IO_ERROR`。槽位写抛 `QUOTA_EXCEEDED` 时，`repo.commit` 复扫确认未写→`FAILED`，但 `fatalErrors` 非空→协调器写 `FROZEN` 标记并冻结（`:845-865`）。玩家释放空间后，应用仍需显式恢复；当前无入口（REV4-02）。任务书 5.3 明确“若实现选择保守冻结，必须说明其依据、玩家影响以及可恢复性”；开发方报告未说明。建议：将“复扫确认未写、3 槽可读、版本未变”的纯确定性配额失败按 `FAILED` 清标（不冻结），或保留冻结但在应用内提供恢复动作并记录玩家影响。该定位为 P2（设计取舍/文档），不单独构成数据安全阻塞，但与 REV4-02 叠加会放大影响。

---

## 4. P2 存储策略（REV3-02 / REV3-03）

`BrowserFilePort.ts:243-277`：

- 有 `indexedDB` → `BROWSER_INDEXED_DB`。
- 无 IDB 且 `options.allowLocalStorageMockInNode === true && isNodeTestHost()` → `LOCAL_STORAGE_MOCK`（仅 Node）。
- 否则 → `BROWSER_STORAGE_UNAVAILABLE`；`probeStorage()` 返回不可用；`read/write/remove/list/TxState` 全部抛 `STORAGE_UNAVAILABLE`（`:456-537,552-706`）。
- `isNodeTestHost()`（`:82-96`）严格校验 `process.versions.node` 非空字符串、`process.release.name === 'node'`、`process.cwd` 函数；真实 Chrome 不满足。
- `inspectLegacyLocalStorageSaves()`（`:291-321`）只读 `${namespace}:save_slot_0/1/2.json`，返回 `DETECTED_IGNORED_NO_AUTO_MIGRATION`；不写、不删、不迁移。`BootEntry` 将结果写入只读快照 `legacyExperimentalSave`（`:89-114,192-194`）。
- 真实 Chrome 独立实测（`evidence/p2.json`）：IDB+LS 同时存在→IDB 胜出、LS 原样；仅 LS→EMPTY、LS 原样；IDB 缺失/open 抛错/probe SecurityError→`STORAGE_UNAVAILABLE`、halt、0 LS 写；真实 Chrome 传 opt-in 仍 `BROWSER_STORAGE_UNAVAILABLE`；重复启动稳定。
- 旧档“复活”路径已消除（无 IDB 不再回退 localStorage）。
- 未自动迁移符合本轮批准策略；正式迁移为 ISSUE_REPORT §4 的设计待决项，不属缺陷。

**结论：REV3-02 / REV3-03 代码实现正确。**

---

## 5. 微信事务标记（Mock）

`WeChatFilePort.ts`：

- `readTxState`/`writeTxState`/`clearTxState`（`:279-289`）映射到根目录 `__tx_state__.json`；`list()` 过滤该文件与 `__probe__.tmp`（`:291-303`）。
- `UnavailableFilePort` 三个标记方法均抛 `STORAGE_UNAVAILABLE`（`:88-98`），不会静默成功。
- 独立 `[MOCK-WX]` 7/7 通过（见 `TEST_VERIFICATION.md` §6）；但开发方 20/20 中没有微信标记定向用例，属于测试覆盖 P3。
- 真实微信未运行；`writeFileSync` 非原子写与截断风险见 REV4-03。

---

## 6. 未发现的其他退化

- A01：IndexedDB + Web Locks；两套独立 Profile ×12 轮 + 空盘竞争，0 双 COMMITTED；持锁页崩溃自动释放后 rev21。
- A03：部分 IO 冻结、readOnlyBackup、回收后 rev3；A03 Node 用例与 Chrome 实测通过。
- A04：生产 harness 14 个只读/UI 键，0 禁止方法；Cocos `destroy()` 后 0 写入；`clearSlotsForTest` 不存在。
- A05：锁内任务异常按 `CoordinatorTaskError` 还原，不误判为锁拒绝；锁拒绝/缺失 fail-closed。
- A06：HIDE 队列逐任务 try/catch；排队任务在 destroy 时 CANCELLED；STARTED 正常完成。
- A07：Node runner 未改（哈希与 R3 一致）；20/20 含旧 TODO/超时用例。
- A08：safe-path-guard 未改；历史证据仍适用。
- A09：见 REVIEW_REPORT §6。
- A10：R4 报告分类总体诚实；但对“A02 已关闭”的表述过宽（见 DESIGN_ISSUES REV4-07）。

---

## 7. 结论

主体 A02 跨标签页安全修复正确且真实 Chrome 证据充分；P2 策略正确。阻塞在恢复边界：**REV4-01（EMPTY 清标）**、**REV4-02（无应用恢复入口）**。其余为 P2/P3。最终判定 **REWORK**。