# FE-000-R1-INTEGRATION-REWORK-03 根因分析与整改实施报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **工作区 / 分支**：`E:\idle-fishing-integration` / `integration/fe-000-be-r1`
- **固定基线**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2`、`MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`、`merge-base=358b11105cfdee9bd076049c86a34d8f0aaa00e7`

---

## 1. 根因分析（逐项对应 Astra A01–A10）

### 1.1 P0（A01）：双标签页同时获得 `COMMITTED`（同 revision / 同 slot 覆盖）
- **实测现象**：Astra 的 `web.log`（空盘 `null -> rev 1`）与 `race.jsonl` 第 7 行（非空盘 `rev 8 -> rev 9, slot 2`）显示：即使 `navigator.locks.query()` 明确证实 Tab A 持有排他 Web Lock 且 Tab B 正在同一锁上排队（`clientId` 不同），释放锁后 Tab B 仍读到旧状态并获得 `rev 9 / slot 2 / COMMITTED`，覆盖 Tab A 已确认的候选数据。
- **架构级根因（Chromium 多进程渲染器 IPC 无序性）**：
  1. `Target.createTarget` / 独立标签页在 Chromium 中运行于**独立的 Renderer 进程**。
  2. Chromium 的 `localStorage` 采用**每渲染进程本地缓存（`blink::CachedStorageArea`）**实现：`localStorage.setItem()` 同步修改本进程缓存并经 **Mojo `StorageArea` 管道**异步发送 `Put` 到 Browser 进程的 `StorageService`，随后再异步广播 `KeyChanged` 到其他渲染进程；而 `navigator.locks` 的释放与授予走另一条**完全独立且无跨管道保序保证的 Mojo `LockManager` 管道**。
  3. 因此，Tab A 写完 `localStorage`、从自身缓存回读成功并释放 Web Lock 后，Tab B 在 `LockManager` 管道上先收到锁授予，但 `StorageArea` 的 `KeyChanged` 广播尚未抵达 Tab B 的渲染进程缓存 → Tab B 的 `localStorage.getItem()` 读到**过期缓存**（`rev 8` 或空盘），基于旧视图重新判定 `nextRev=9, slot=2`，写入并从自身缓存回读得到第二个 `COMMITTED`，最终后到的异步 `Put` 覆盖 Tab A 数据！
- **根治方案**：
  - 将浏览器持久化端口 [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) 在真实浏览器环境（存在 `globalThis.indexedDB`）下升级为 **W3C IndexedDB（`idle_fishing_fs_v1` / store `files`）**，**零 JS 内存值缓存**：
    - 每次 `write()`、`read()`、`remove()`、`list()`、`probeStorage()` 均开启全新 IndexedDB 事务，由中央 Browser 进程提交（`tx.oncomplete` 后 Promise 才 resolve），跨所有同源渲染进程严格线性一致（linearizable）。
    - 与 `SingleWriterSaveCoordinator` 的 W3C Web Locks（`navigator.locks.request('idle-fishing:save:' + storageKey, { mode: 'exclusive' })`）协同，保证锁释放前中央 Browser 进程已完成提交，下一个获锁标签页的 `readonly` 事务 100% 必然读到最新 revision 与 slot。
  - 在无 `indexedDB` 的纯 Node Mock 测试环境（仅注入 `globalThis.localStorage`），保持原有 fail-closed `localStorage` 模式兼容所有既有 Node 测试。
  - **边界声明**：本变更仅限前端实验性 Web 适配层 `BrowserFilePort.ts`（`EXPERIMENTAL_WEB_FALLBACK_ONLY`），未触碰微信正式 `WeChatFilePort.ts`（`wx.getFileSystemManager`）、未修改任何后端 `packages/game-core/`、公共契约或正式设计文档。

### 1.2 P1-01（A02）：`UNCERTAIN` 后跨协调器仍可写
- **根因**：`SingleWriterSaveCoordinator.ts` 原逻辑仅在 `fatalErrors && result.kind === 'FAILED'` 时冻结共享 `namespaceHealth`，而 `repo.commit()` 返回 `UNCERTAIN` 时直接透传返回，仅在 `BootEntry` 局部设置 `this.persistenceHalted = true`。同一 `storageKey` 上的另一协调器实例仍看到 `AVAILABLE`，无需 `loadSafe()` 即可继续提交。
- **修复**：在 [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) 中，只要 `repo.commit()` 返回 `UNCERTAIN`，立即将共享 `storageKey` 在模块级 `namespaceHealth` 标记为冻结（`health='STORAGE_UNAVAILABLE'`、`freezeCode='UNCERTAIN_WRITE_PENDING_RECOVERY'`），并保留原 `UNCERTAIN` 返回值给触发方；此后该存储域内任何协调器实例或直连提交入口均短路返回 `STORAGE_UNAVAILABLE` 且**零物理写入**，直至显式执行完整 `loadSafe()` 恢复成功；普通确定性故障（`INJECTED_PRE_WRITE` / `INJECTED_PARTIAL_WRITE` / `CONFLICT`）继续保持不冻结。

### 1.3 P1-02（A03）：部分恢复过早解除冻结
- **根因**：`SingleWriterSaveCoordinator.loadSafe()` 原先只要看到 `repo.load()` 返回 `VALID` 即调用 `markStorageAvailable()`。当最新槽位（如 `save_slot_2.json`，含 `rev=3`）读 IO 报错、旧备份槽（`rev=2`）可读时，`repo.load()` 返回 `VALID (rev=2, warnings=['save_slot_2.json: io error...'])`，导致协调器在未能核清最高物理版本的情况下过早解除冻结。
- **修复**：`loadSafe()` 通过 `observedPort` 精确记录每个槽位的物理读取结果，严格区分四类状态：
  1. `FILE_NOT_FOUND`（`read() === null`）：明确不存在；
  2. `INVALID_CONTENT`（全部槽位读 IO 成功，但某槽 JSON/校验损坏）：无隐藏高版本风险，可安全恢复旧有效备份并解冻；
  3. `IO_UNAVAILABLE` / `PARTIAL_IO_UNAVAILABLE`（任意 1–3 个槽位抛出读 IO 错误）：最高物理版本无法确认，**严禁解冻**，保持 `STORAGE_UNAVAILABLE`（`freezeCode='PARTIAL_IO_UNAVAILABLE'` 或 `'STORAGE_IO_UNAVAILABLE'`），返回 `recoveryClassification`、`unreadableSlots` 与仅供只读展示的 `readOnlyBackup` 元数据，拒绝任何新业务写入；
  4. `RECOVERY_VERIFICATION_FAILED`（探针失败、`CORRUPT`、`UNSUPPORTED`）：不解锁写权限。

### 1.4 P1-03（A04 + A05 + A06 + A09）：生产构建诊断边界、销毁免疫与队列/异常修复
- **A04（生产构建移除破坏性测试能力 & 销毁边界）**：
  - [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) 生产构建的 `globalThis.__SPIKE_HARNESS__` 彻底移除 `clearLifecyclePersistence`、`getPersistCoordinator`、`commitCandidateViaCoordinator`、`setCommitTestHooks`、`requestHideSaveForTest`、`triggerDestroyForTest`、`advancePersistState`、`reinitializePersistence`；[SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) 彻底移除 `clearSlotsForTest()`。
  - 在真实 Cocos 3.8.8 产物实测 `BootEntry.destroy()` 时进一步发现并修复了引擎特性：Cocos `CCObject._destroyImmediate()` 会在 `onDestroy()` 后清空组件自身所有自有属性（含 `this.isDestroyed` 与 `this.commitHistory`）。已改用模块级 `WeakSet<BootEntry>`（`destroyedBootEntries`）叠加 `this.isValid === false` 判定销毁态，并配合闭包只读快照镜像，保证销毁后彻底切断 `persistCoordinator`/`persistPort`/`persistState`、零物理写入且只读访问不抛空引用异常。
- **A05（锁内任务异常分类）**：`withExclusiveLock()` 在 `locks.request()` 回调内将任务体异常包装为 `CoordinatorTaskError` 并在外层 `catch` 解包重抛，彻底避免锁已获取后的业务/钩子异常被误分类为 `CROSS_TAB_LOCK_REJECTED` 或误冻结健康存储。
- **A06（队列异常防投毒）**：`BootEntry` 的 `pendingHideSave` 链内每笔任务外包独立 `try/catch`，单笔任务异常记录于 `commitHistory` 而不将共享 Promise 链置为永久 rejected。
- **A09（诊断页命名空间隔离）**：`PlatformVerificationSuite.runFileSystemAndSaveSuite()` 默认每次运行分配独立临时命名空间 `idle_fishing_spike_diag_<ts>_<rand>` 并在 `finally` 清理，多标签并跑诊断互不干扰且不触碰 `idle_fishing_lifecycle_persist`。

### 1.5 A07（Node 测试运行器）与 A08（输出目录路径守卫）
- **A07**：[node-test-worker.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/node-test-worker.mjs) 在 `test:fail` 监听中优先检查 `ev.todo !== undefined && ev.todo !== false` 并计入 `todo`（对齐 Node 24.20.0 原生运行时，同时保留 `passed === 0` 失败门禁）；[run-node-tests.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/run-node-tests.mjs) 新增强制 worker 超时上限 `--worker-timeout-ms`（默认 `180000ms`，超时 `SIGKILL` 并记 `procErr=1` 退出 `1`）。
- **A08**：[safe-path-guard.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/safe-path-guard.mjs) 改用 `lstatSync` 逐级向上探测并移除所有 `lstatSync`/`realpathSync` 的静默降级 `catch`，任何非 `ENOENT`/`ENOTDIR` 元数据错误（如 `EACCES`/`EPERM`）均 fail-closed 返回 `METADATA_UNVERIFIABLE` / `REALPATH_UNVERIFIABLE` / `REPO_ROOT_UNVERIFIABLE`，并补充拦截 Windows 扩展路径（`\\?\`、`\\.\`）、驱动器相对路径（`E:.compiled`）与 NTFS ADS（`:stream`）。

---

## 2. 本轮文件变更精确分类（对齐 A10 口径，相对 REWORK-02 逐字节核对）

### 2.1 本轮修改文件（12 个）
| 分类 | 文件路径 | 对应整改项 |
|---|---|---|
| 前端源码 | `apps/game-client/assets/scripts/platform/PlatformTypes.ts` | P0 (`BROWSER_INDEXED_DB` + 异步 `probeStorage`) |
| 前端源码 | `apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts` | P0 (兼容异步 `probeStorage` 透传) |
| 前端源码 | `apps/game-client/assets/scripts/platform/BrowserFilePort.ts` | P0 (`A01` IndexedDB 线性一致持久化) |
| 前端源码 | `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` | P0 (`A01`)、P1-01 (`A02`)、P1-02 (`A03`)、P1-03 (`A04`)、P2 (`A05`) |
| 前端源码 | `apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts` | P1-01 (`A02` T05 显式恢复校验)、P3 (`A09` 临时域隔离) |
| 前端源码 | `apps/game-client/assets/scripts/shared/SharedCoreBridge.ts` | 导出 `@idle-fishing/game-core` 已有工厂函数供 Web 隔离测试复用 |
| 前端源码 | `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | P1-03 (`A04` 生产构建剥离破坏性入口、`WeakSet` 销毁免疫、`A06` 队列防投毒) |
| 前端测试/守卫 | `tests/frontend/fe-000/node-test-worker.mjs` | `A07` 抛错 TODO 计数对齐 Node 24 |
| 前端测试/守卫 | `tests/frontend/fe-000/run-node-tests.mjs` | `A07` `--worker-timeout-ms` 超时强杀 |
| 前端测试/守卫 | `tests/frontend/fe-000/safe-path-guard.mjs` | `A08` 元数据查询失败 fail-closed + Windows 路径加固 |
| 前端测试/守卫 | `tests/frontend/fe-000/platform-and-core.test.ts` | 新增 `A02`/`A03`/`A05`/`A07`/`A08` 回归（15 → 18 项） |
| 前端测试/守卫 | `tests/frontend/fe-000/verify-web-build.mjs` | IndexedDB 检验 + 生产接口审计 + 12 轮双标签页确定性交错竞争 + `A02`/`A03`/`A04`/`A05`/`N3` 实测 |

### 2.2 本轮新增代码/夹具文件（3 个，不含本轮报告目录）
- `tests/frontend/fe-000/fixtures/fixture-todo-throws.test.ts`（`A07` 1 pass + 1 抛错 TODO）
- `tests/frontend/fe-000/fixtures/fixture-only-todo-throws.test.ts`（`A07` 仅 1 抛错 TODO 触发零通过守卫）
- `tests/frontend/fe-000/fixtures/fixture-hanging.test.ts`（`A07` 挂起定时器 worker 超时强杀验证）

### 2.3 沿用未改依赖文件（相对 REWORK-02 0 字节变更）
- `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts.meta`
- `apps/game-client/assets/scripts/platform/WeChatFilePort.ts`
- `apps/game-client/assets/scripts/ui/OverviewPage.ts`
- `tests/frontend/fe-000/tsconfig.json`
- 既有 17 个 `tests/frontend/fe-000/fixtures/*.test.ts` 夹具文件

---

## 3. 五项核心整改与回归证据映射表

| 整改项 | 核心修改文件 | 新增 / 强化回归用例 | 独立证据 |
|---|---|---|---|
| **P0 (A01)** 双标签页同版本双 `COMMITTED` | `BrowserFilePort.ts`、`SingleWriterSaveCoordinator.ts`、`PlatformTypes.ts`、`verify-web-build.mjs` | Chrome 158 `web_p0_dual_tab_empty_and_12_round_interleaved_race`（空盘竞争 + 12 轮非空交错含 6 轮写后回读前屏障，**连续两轮全新 Chrome Profile 合计 24/24 轮 + 2/2 空盘，0 次双 `COMMITTED`**） | `logs/r3-verify-web-run1.log`、`logs/r3-verify-web-run2.log`、`evidence/web-rework03/r1-green-web-results.json`、`evidence/web-rework03-repeat/r1-green-web-results.json` |
| **P1-01 (A02)** `UNCERTAIN` 跨协调器冻结 | `SingleWriterSaveCoordinator.ts`、`BootEntry.ts`、`PlatformVerificationSuite.ts` | Node `[NODE/P1-01/A02-UNCERTAIN-CROSS-COORDINATOR-FREEZE]` + Chrome `web_p1_01_uncertain_cross_coordinator_and_partial_io_freeze`（Part A） | `logs/r3-frontend-tests.log`、`logs/r3-verify-web-run1.log` |
| **P1-02 (A03)** 部分槽 IO 不可用不解冻 | `SingleWriterSaveCoordinator.ts`、`BootEntry.ts` | Node `[NODE/P1-02/A03-PARTIAL-IO-NO-PREMATURE-UNFREEZE]`（四态区分）+ Chrome `web_p1_01_uncertain_cross_coordinator_and_partial_io_freeze`（Part B） | `logs/r3-frontend-tests.log`、`logs/r3-verify-web-run1.log` |
| **P1-03 (A04+A05+A06+A09)** 生产构建隔离与销毁边界 | `BootEntry.ts`、`SingleWriterSaveCoordinator.ts`、`PlatformVerificationSuite.ts` | Chrome `web_p1_03_production_harness_no_destructive_save_api`、`web_p1_03_destroyed_boot_entry_zero_writes`、`web_p1_02_destroy_queued_cancel_and_started_complete` + Node `[NODE/A05/CROSS-TAB-LOCK-VS-TASK-ERROR-CLASSIFICATION]` | `logs/r3-frontend-tests.log`、`logs/r3-verify-web-run1.log` |
| **A07 & A08** 运行器与路径守卫 | `node-test-worker.mjs`、`run-node-tests.mjs`、`safe-path-guard.mjs` | Node 18/18（含抛错 TODO、1200ms 挂起强杀、`realpathSync`/`lstatSync` EACCES fail-closed、Windows 扩展路径与 Junction）+ 4 组独立 CLI 日志 | `logs/r3-frontend-tests.log`、`logs/r3-a07-todo-throws.log`、`logs/r3-a07-only-todo-throws.log`、`logs/r3-a07-hanging-timeout.log`、`logs/r3-a08-unsafe-outdir.log` |
