# FE-000-R1-INTEGRATION-REWORK-04 实施报告（IMPLEMENTATION_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-04`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **完成日期**：2026-11-27
- **开发状态**：`READY_FOR_INDEPENDENT_REVIEW`

---

## 1. 本轮候选文件清单（严格区分修改 / 新增 / 沿用）

对照 REWORK-03 `FILES-REWORK.sha256` 中的 36 个代码/测试/夹具文件逐字节核对：

### 1.1 本轮修改文件（8 个）

| # | 文件路径 | 整改归属 | 变更摘要 |
|---:|---|---|---|
| 1 | [PlatformTypes.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformTypes.ts) | A02 + P2 | `FilePort['kind']` 新增 `'BROWSER_STORAGE_UNAVAILABLE'`；新增 `LegacyLocalStorageStatus` 只读接口及可选 `readTxState/writeTxState/clearTxState/getLegacyStorageStatus` 方法 |
| 2 | [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) | A02 + P2 | 在 IndexedDB 同库同 store（`idle_fishing_fs_v1` / `files` / version `1`）实现 `${namespace}:__tx_state__` 事务状态读写清及独立命名空间辅助函数（`readIndexedDbTxStateForNamespace` 等）；`list()` 与配额游标排除内部保留键；实现 P2 策略：`isNodeTestHost()` 严格识别 Node 宿主，浏览器缺 `indexedDB` 时严格 fail-closed（`BROWSER_STORAGE_UNAVAILABLE`），仅 `allowLocalStorageMockInNode: true && isNodeTestHost()` 允许 Node `localStorage` Mock；实现只读 `inspectLegacyLocalStorageSaves()` 检测并报告遗留实验存档而不复活/修改/删除 |
| 3 | [WeChatFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/WeChatFilePort.ts) | A02 + P2 | `WeChatFilePort` 实现基于 `__tx_state__.json` 的 `readTxState/writeTxState/clearTxState` 并在 `list()` 过滤内部文件；`UnavailableFilePort` 对事务标记操作均 fail-closed 抛 `STORAGE_UNAVAILABLE` |
| 4 | [FaultInjectingFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts) | A02 | 透传 `readTxState/writeTxState/clearTxState/getLegacyStorageStatus`（不消耗 `armNextWriteFault` 也不触发 `writeInterceptor`），新增可选 `setTxMarkerFault('READ' \| 'WRITE' \| 'CLEAR')` 用于确定性 Node 故障测试 |
| 5 | [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) | A02 | 核心实现：在 Web Locks + 进程内互斥锁内强制读写持久化 `SharedTxMarker`；写前落盘 `PENDING` 标记；`COMMITTED` 仅在真实写入+回读确认后清理标记（清理失败返 `UNCERTAIN` 并保留标记）；`UNCERTAIN`/致命 IO/写后异常保留持久化标记；`loadSafe({ clearPendingTxMarker })` 区分自动启动（`false`，不静默清标）与显式恢复（默认 `true`，全量探针+3 槽零 IO 错误确认后方清标解冻） |
| 6 | [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) | A02 + P2 | 自动启动/刷新调用 `coordinator.loadSafe({ clearPendingTxMarker: false })`，防止刷新 Tab A 静默清除跨标签页待确认标记；在 `BootPersistenceRecord` 只读字段新增 `legacyExperimentalSave`；生产 `__SPIKE_HARNESS__` 严格保持既有 14 个只读/UI 键不变 |
| 7 | [platform-and-core.test.ts](file:///E:/idle-fishing-integration/tests/frontend/fe-000/platform-and-core.test.ts) | A02 + P2 | 既有 Node `localStorage` Mock 用例改为显式传入 `{ allowLocalStorageMockInNode: true }`；新增 2 项独立回归测试（18 -> **20 项**），覆盖写前标记失败/跨 Realm 持久化拦截/自动启动不静默清标/清标失败/标记不可读与损坏/域隔离及 P2 缺 IDB fail-closed + 遗留存档检测 |
| 8 | [verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs) | A02 + P2 | 默认输出目录更新为 `reports/integration/FE-000-R1-INTEGRATION-REWORK-04/evidence/web-rework04`；保留全部既有 28 项断言（含 A01 空盘 + 12 轮双标签页交错竞争）；新增 3 大专项断言组（28 -> **31 项**），完整验证任务书第 4 节全部 12 项真实 Chrome 场景与第 5 节 P2 策略 |

### 1.2 本轮新增代码/夹具文件（0 个）

本轮无新增源码文件或测试夹具文件，避免引入与本轮无关的抽象层或通用基础设施。

### 1.3 沿用未改动文件（28 个，与 REWORK-03 逐字节一致）

- 前端源码（4 个）：`apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`、`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts.meta`、`apps/game-client/assets/scripts/shared/SharedCoreBridge.ts`、`apps/game-client/assets/scripts/ui/OverviewPage.ts`
- 前端测试运行器/守卫/配置（4 个）：`tests/frontend/fe-000/node-test-worker.mjs`、`tests/frontend/fe-000/run-node-tests.mjs`、`tests/frontend/fe-000/safe-path-guard.mjs`、`tests/frontend/fe-000/tsconfig.json`
- 测试夹具（20 个）：`tests/frontend/fe-000/fixtures/` 下全部 20 个夹具文件

### 1.4 后端受保护文件（58 个）

`git diff --cached 5bcc9ac` 与 `git diff 5bcc9ac` 对 58 个已暂存后端文件均为 **0 字节差异**；后端三槽协议、`SaveEnvelope`、公共契约、`packages/`、设计文档及根工程配置均未触碰。

---

## 2. A02（REV3-01）跨标签页共享故障冻结设计与 11 项要求逐条对应

### 2.1 根因回顾

REWORK-03 中 `namespaceHealth` 是模块级内存 `Map`，每个浏览器标签页拥有独立 JS Realm 与独立内存实例。Tab A `UNCERTAIN` 仅冻结 Tab A 的内存 Map，Tab B 首次提交时读到干净本地健康状态并绕过恢复门禁直接提交。

### 2.2 本轮方案：同库 IndexedDB 持久化写前事务标记 + Web Locks 临界区

- **存储位置**：复用已有 IndexedDB 数据库 `idle_fishing_fs_v1`、object store `files`（保持 `version = 1`，不破坏任何外部只读审计工具），按存档域命名空间键为 `${namespace}:__tx_state__`；微信端对应 `${rootDir}/__tx_state__.json`；不新增无关框架或后台通道。
- **自定义包装器兼容**：即使调用方（如审核脚本 `r3-a02.mjs`）构造仅含 `{ kind, storageKey: 'browser:<ns>', read, write, remove, list }` 的普通对象包装器、未实现 `readTxState/writeTxState/clearTxState`，`SingleWriterSaveCoordinator` 检测到 `browser:<ns>` 且处于浏览器上下文时，自动通过 `readIndexedDbTxStateForNamespace(ns)` / `writeIndexedDbTxStateForNamespace(ns)` / `clearIndexedDbTxStateForNamespace(ns)` 访问同一个 `${ns}:__tx_state__` 键，杜绝包装器绕过。
- **标记结构（`SharedTxMarker`）**：`{ version: 1, storageKey, txId, state: 'PENDING' | 'UNCERTAIN' | 'FROZEN', expectedRevision, targetRevision, createdAtMs, updatedAtMs, reason }`，读取时做严格 JSON 与字段校验，损坏或字段非法一律 fail-closed。

### 2.3 对任务书第 3 节 11 项核心要求的逐条证明

| # | 核心要求 | 本轮实现与不变量证明 |
|---:|---|---|
| 1 | 所有正常提交入口必须在锁内读取真实共享事务状态 | `SingleWriterSaveCoordinator.commit()` 在获取 `withExclusiveLock`（进程内队列 + `idle-fishing:save:${storageKey}` 独占 Web Lock）后、任何探针或槽位写入前，必然执行 `await this.readSharedTxMarker()`（直读 IndexedDB 新 readonly 事务，零缓存）。 |
| 2 | 不允许仅依赖内存 Map、BroadcastChannel、storage event 或其他异步通知实现安全门禁 | 安全门禁完全以 Web Lock 临界区内的同步线性一致 IndexedDB 读取为唯一权威依据；未使用 `BroadcastChannel` 或 `storage` 事件作为安全门禁；本地 `namespaceHealth` Map 仅作为同 Realm 快速拒绝缓存。 |
| 3 | 在可能改变存档数据前，必须先完成持久化待确认标记；若标记不能可靠写入，不得开始存档写入 | 在 `observedPort.write` 调用真实 `this.port.write(slotPath, text)` 之前，先执行 `await this.writeSharedTxMarker({ state: 'PENDING', ... })` 并等待 `tx.oncomplete`；若写标失败，记录 `markerWriteError` 并立即抛出中止，**0 次调用 `this.port.write`**，返回 `STORAGE_UNAVAILABLE`。 |
| 4 | `COMMITTED` 必须继续满足原有真实写入、回读及唯一版本确认要求 | 完整复用未经修改的后端 `SpikeFileSaveRepository.commit()`（写盘 + 精确字节回读 + 冲突/SHA-256 校验）；仅在 `result.kind === 'COMMITTED'` 后才调用 `clearSharedTxMarker()`；若清标失败则保留标记、冻结本地并返回 `UNCERTAIN`。 |
| 5 | `UNCERTAIN`、意外异常或页面中途崩溃时，应保留可恢复的持久化标记 | `UNCERTAIN` 返回时升级标记为 `state: 'UNCERTAIN'`（升级失败则写前 `PENDING` 标记仍在盘）；`repo.commit()` 意外抛错且 `markerWritten === true` 时保留/升级标记并冻结本地；页面在写前或写后回读前崩溃（`Target.closeTarget`）时，`PENDING` 标记已提交于浏览器进程 IndexedDB，Chrome 自动释放 Web Lock 后标记完整留存。 |
| 6 | 未完成显式恢复流程前，其他标签页不得绕过共享冻结直接提交 | 任意其他标签页（直接调用协调器或经 `BootEntry` 正常 HIDE）进入 `commit()` 获取锁后，读取到 `${ns}:__tx_state__` 存在即返回 `STORAGE_UNAVAILABLE` 且 0 槽位写入。`BootEntry.initializePersistence()` 传入 `{ clearPendingTxMarker: false }`，故 Tab A 刷新（`Page.reload`）、销毁（`boot.destroy()`）或关闭（`Target.closeTarget`）均不会静默清标，Tab B 仍不可绕过。 |
| 7 | 恢复必须在同一互斥边界内重新探针、读取全部真实槽位、验证 Envelope、确认最新 revision | `loadSafe()` 在同一 `withExclusiveLock` 互斥边界内按序执行：`probeStorage()` → `readSharedTxMarker()` → 逐槽监听读取全部 3 槽 → 后端 `SpikeFileSaveRepository.load()` 验证 Envelope/SHA-256/epoch/schemaVersion 与最高 revision → 显式恢复（`clearPendingTxMarker: true`）且 `VALID`/`EMPTY` 时清理标记并解冻。 |
| 8 | 任意必要槽位 IO 失败、共享状态不可读取或恢复验证失败时，保持 fail-closed | 任意槽位读抛 IO 错误返回 `STORAGE_UNAVAILABLE`（`PARTIAL_IO_UNAVAILABLE` / `IO_UNAVAILABLE`）并保留/写入冻结标记；标记读失败或损坏返回 `STORAGE_UNAVAILABLE`（`TX_STATE_UNREADABLE`）；标记清理失败返回 `STORAGE_UNAVAILABLE`（`TX_STATE_CLEAR_FAILED`）；`CORRUPT`/`UNSUPPORTED` 不清标不解冻。 |
| 9 | 恢复后仍须执行原有 `expectedRevision` 校验，不允许旧内存状态覆盖新存档 | 恢复清标后，后续每次 `commit()` 仍由后端 `SpikeFileSaveRepository.commit()` 在锁内重新扫描 3 槽并严格比对 `expectedRevision === top.revision`，任何旧实例携带过期 revision 提交均返回 `CONFLICT` 且 0 物理写入。 |
| 10 | 明确区分确定性失败、`CONFLICT`、`UNCERTAIN` 和 `STORAGE_UNAVAILABLE`，不得通过错误分类掩盖不确定写入 | `CONFLICT`（写前校验不通过，未写标）→ `CONFLICT`；确定性无盘面污染故障（如 `INJECTED_PRE_WRITE`/`INJECTED_PARTIAL_WRITE`，后端复扫确认 3 槽可读且版本未变）→ 清理标记后返 `FAILED`；写标失败（0 槽位写入）→ `STORAGE_UNAVAILABLE`；真实存储写 IO 错误 → 保留 `FROZEN` 标记并返 `STORAGE_UNAVAILABLE`；未知写结果或提交后清标失败 → 保留标记并返 `UNCERTAIN`（绝不伪装为 `FAILED` 或 `COMMITTED`）。 |
| 11 | 明确说明存储完全不可用、锁获取失败或元数据写入失败时的安全边界 | 见下方 §2.4 透明安全边界声明，不作任何“瞬时广播到所有标签页”的虚假宣称。 |

### 2.4 明确安全边界声明（对应要求 11）

1. **存储完全不可用或元数据写入失败（`SHARED_TX_MARKER_WRITE_FAILED`）**：
   - 本标签页在写入任何存档槽之前中止（**0 字节槽位写入**），本标签页进入本地冻结并返回 `STORAGE_UNAVAILABLE`。
   - 因元数据无法写入共享存储，本实现**不宣称**能将此本机失败瞬时广播至其他标签页；安全不变量仍成立的原因在于：本标签页未对存档槽执行任何写操作，盘面保持纯净；若底层存储全局不可用，其他标签页自身的 `probeStorage()` / `readSharedTxMarker()` / `writeSharedTxMarker()` 同样会 fail-closed；若故障仅局限于本标签页进程，其他标签页面对的盘面数据未受污染。
2. **Web Locks 缺失或获取拒绝（`CROSS_TAB_LOCK_UNAVAILABLE` / `CROSS_TAB_LOCK_REJECTED`）**：
   - 本标签页无法进入临界区，立即本地冻结并返回 `STORAGE_UNAVAILABLE`，**0 字节槽位写入**；不宣称能向其他标签页广播锁失败。
3. **同步只读 getter（`coord.storageHealth`）**：
   - IndexedDB 为异步接口，其他标签页在尚未发起 `commit()` / `loadSafe()` 前，其本地内存 getter 仍可能显示上次观察值；但一旦其发起任何 `commit()` 或 `loadSafe()`，必在 Web Lock 内异步读取真实 IndexedDB `__tx_state__` 并强制阻断，不会发生任何未授权写入。

---

## 3. P2 浏览器存储回退与历史实验存档策略实现（任务书第 5 节）

| 策略项 | 实现细节 |
|---|---|
| 真实浏览器缺 `indexedDB` 禁止回退 `localStorage` | `BrowserFilePort` 构造时若 `getIndexedDbFactory() === null` 且不满足显式 Node Mock 条件，固定进入 `backend = 'UNAVAILABLE'`、`kind = 'BROWSER_STORAGE_UNAVAILABLE'`、`probeStorage().available = false`，全部 `read/write/remove/list/TxState` 抛出 `STORAGE_UNAVAILABLE`，**0 次 `localStorage` 写入**。 |
| 保留显式注入的 Node Mock 测试能力 | 仅当 `options?.allowLocalStorageMockInNode === true` **且** `isNodeTestHost() === true` 时启用 `LOCAL_STORAGE_MOCK`。 |
| 绝不将真实浏览器误判为 Node 测试宿主 | `isNodeTestHost()` 同时校验 `process.versions.node`（非空字符串）、`process.release.name === 'node'` 与 `typeof process.cwd === 'function'`；真实 Chrome 中即使显式传入 `{ allowLocalStorageMockInNode: true }` 仍严格 fail-closed（已在实机 Chrome 158 实证）。 |
| 遗留 `localStorage` 实验存档处理 | `inspectLegacyLocalStorageSaves()` 只读检查 `${namespace}:save_slot_0/1/2.json`，发现时明确返回 `{ detected: true, keys, policy: 'DETECTED_IGNORED_NO_AUTO_MIGRATION', detail }` 并透出至 `BootEntry` 只读快照 `lifecyclePersistence.legacyExperimentalSave`；绝不删除、绝不覆盖、绝不自动复活、本阶段不建设完整迁移系统。 |
