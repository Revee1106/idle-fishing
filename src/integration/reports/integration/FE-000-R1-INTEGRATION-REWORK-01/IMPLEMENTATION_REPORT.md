# FE-000-R1-INTEGRATION-REWORK-01 实现与整改报告（IMPLEMENTATION_REPORT）

## 1. 整改闭环总表

| 审核问题 | 优先级 | 核心修复文件 | 新增 / 强化回归测试 | 结果 |
|---|---|---|---|---|
| **P1-01 (`F1`)** 存储探针失败导致 `EMPTY` 误判与内存假 `COMMITTED` | P1 阻塞 | `apps/game-client/assets/scripts/platform/PlatformTypes.ts`<br>`apps/game-client/assets/scripts/platform/BrowserFilePort.ts`<br>`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`<br>`apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | `COMPAT-SAVE-BOOT-UNAVAILABLE`（Node `[NODE/P1-01/COMPAT-SAVE-BOOT-UNAVAILABLE]` + 真实 Web `web_p1_01_compat_save_boot_unavailable`）+ 正常 `EMPTY` 新玩家校验 | **PASS（开发方回归）** |
| **P1-02 (`F2`)** `HIDE -> SHOW -> HIDE` 连续生命周期事件冲突丢进度 | P1 阻塞 | `apps/game-client/assets/scripts/bootstrap/BootEntry.ts`<br>`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` | `COMPAT-LIFECYCLE-HIDE-SHOW-HIDE`（真实 Web `web_p1_02_compat_lifecycle_hide_show_hide` + 4 连突发 + 重载恢复 + `web_p1_02_queued_hide_after_uncertain_halts`） | **PASS（开发方回归）** |
| **P1-03 (`F3`)** 前端测试入口对空文件 / 全跳过用例假通过及空日志 | P1 阻塞 | `tests/frontend/fe-000/run-node-tests.mjs`<br>`tests/frontend/fe-000/tsconfig.json`<br>`tests/frontend/fe-000/fixtures/fixture-{empty,skipped,failed,passed,mixed}.test.ts` | `[NODE/P1-03/COMPAT-RUNNER-ZERO-AND-SKIP-GUARD]` + 7 份独立夹具执行日志（均含完整 stdout/stderr/退出码） | **PASS（开发方回归）** |
| **P2-04 (`F4`)** 受控并发提交产生双 `COMMITTED` 静默覆盖 | P2 阻塞并发项 | `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`（新增）<br>`apps/game-client/assets/scripts/platform/WeChatFilePort.ts`<br>`apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts`<br>`apps/game-client/assets/scripts/bootstrap/BootEntry.ts`<br>`apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts` | `COMPAT-SAVE-CONCURRENT-COMMIT`（同实例交错写屏障、跨双协调器共享同一命名空间、写中途到达、先失败后成功） | **PASS（开发方回归）** |

> 最终状态标记：**`READY_FOR_INDEPENDENT_REVIEW`**（等待 Astra 第二轮独立复审；不自行宣布验收通过或进入 `GATE-01`）。

---

## 2. 逐项根因与整改详情（修前 vs 修后）

### 2.1 P1-01 (`F1`)：存储不可用保护
- **修前根因**：`BrowserFilePort.ts` 构造器中若 `localStorage.setItem(probe, '1')` 抛错，将 `this.useLocalStorage` 静默置为 `false` 并降级至空内存 `Map`。随后 `load()` 从空 `Map` 读回 `null`，`SpikeFileSaveRepository` 判定为 `EMPTY`，`BootEntry` 误按新玩家初始化并在后续 `HIDE` 中向内存写入且返回 `COMMITTED`，而真实 `localStorage` 中仍存有旧有效存档。
- **修后实现**：
  1. **`BrowserFilePort.ts`**：彻底移除静默内存降级（显式内存实验仍由独立的 `MemoryFilePort` 承担）。新增 `probeStorage()`、`storageAvailable`、`unavailableReason`、`storageKey = "browser:<namespace>"`。当 `localStorage` 缺失或探针失败时，`read()`/`write()`/`remove()`/`list()` 一律抛出 `FilePortIoError('STORAGE_UNAVAILABLE', ...)`，绝不返回 `null` 或写入临时内存。所有 `localStorage` 访问均做异常保护。
  2. **`SingleWriterSaveCoordinator.ts`**：新增 `loadSafe()` 返回 `SafeSaveLoadResult = SpikeLoadResult | { kind: 'STORAGE_UNAVAILABLE'; detail: string }`（**未修改后端公共契约**）。先调用 `port.probeStorage()`，且在所有槽均为 `io error` 时统一映射为 `STORAGE_UNAVAILABLE`；`commit()` 在存储不可用时直接返回 `FAILED (STORAGE_UNAVAILABLE)` 且零写入。
  3. **`BootEntry.ts`**：`BootPersistenceRecord.loadStatus` 增加 `'STORAGE_UNAVAILABLE'`。收到 `STORAGE_UNAVAILABLE` 时置 `persistenceHalted = true`、`persistState = null`、`persistRevision = null`，禁止初始化新玩家、禁止覆盖原槽、禁止报告 `COMMITTED`；恢复存储后可通过重载或 `reinitializePersistence()` 重新安全读取并完整恢复原有有效存档。

### 2.2 P1-02 (`F2`)：`HIDE -> SHOW -> HIDE` 生命周期保存串行化
- **修前根因**：`BootEntry.ts` 的 `HIDE` 回调在进入 `this.pendingHideSave.then(...)` **之前**同步捕获了 `this.persistState` 与 `this.persistRevision`（`expectedRev`）并预先计算 `nextState`。连续触发 `HIDE -> SHOW -> HIDE` 时，第二次 `HIDE` 使用了与第一次相同的旧状态和旧 `expectedRev`，导致返回 `CONFLICT` 并丢失第二次推进。
- **修后实现**：
  1. **`BootEntry.ts`**：`HIDE` 仅记录 `source` 与序号后立即入队 `this.pendingHideSave`；**进入串行任务实际执行时**才读取最新的 `this.isDestroyed`、`this.persistenceHalted`、`this.persistState` 与 `this.persistRevision`，再基于最新状态计算推进并通过 `SingleWriterSaveCoordinator.commit()` 提交。
  2. 新增 `advancePersistState(deltaMs)`（同样挂载到同一串行队列，确保 `SHOW` 期间的可持久化状态变更与前后 `HIDE` 严格保序）及 `commitHistory` 审计轨迹。
  3. 明确覆盖四条路径：连续成功（`revision` 单调递增 `1->2->3->4`、零 `CONFLICT`）、队列中途遇 `UNCERTAIN`（立即 `persistenceHalted=true`，后续排队 `HIDE` 标记 `SKIPPED_HALTED` 且零写入）、`CONFLICT`/`FAILED`（不篡改已确认 `revision`）、`onDestroy()`（置 `isDestroyed=true`，后续排队任务标记 `SKIPPED_DESTROYED`）。

### 2.3 P1-03 (`F3`)：前端测试入口准确计数与硬门禁
- **修前根因**：`tests/frontend/fe-000/run-node-tests.mjs` 在 `node:test` 默认进程隔离模式下监听 `test:pass` 的 `nesting === 0` 事件并直接 `passed += 1`，导致：（a）空文件 `export {}` 产生的合成文件级通过事件被计为 `pass=1`；（b）`test.skip` 触发 `test:pass` 且带 `ev.skip` 字段，被误计为 `pass=1` 退出 `0`。同时前轮零用例日志因 PowerShell 流重定向仅录得 5 字节 BOM。
- **修后实现**：
  1. **`tests/frontend/fe-000/run-node-tests.mjs`**：采用 `isolation: 'none'` 并显式过滤文件级/suite 包装事件；对 `ev.skip` 计入 `skipped`、对 `ev.todo` 计入 `todo`、仅对真实执行通过的叶用例计入 `passed`；汇总 `total = passed + failed + skipped + todo`。
  2. 硬门禁规则：缺失文件、空 `--files=`、编译失败、运行器异常、`total === 0`（空文件）、`passed === 0`（全跳过/全 todo）、或 `failed > 0` 一律输出诊断到 stderr 并以非零码退出。支持 `--out-dir=` 隔离目录以便自检测试并发安全执行。
  3. 在 `tests/frontend/fe-000/fixtures/` 新增 5 份独立夹具（`fixture-empty`、`fixture-skipped`、`fixture-failed`、`fixture-passed`、`fixture-mixed`），并以 Node `spawnSync` 捕获 7 份独立完整日志（含命令、退出码、stdout、stderr）。

### 2.4 P2-04 (`F4`)：统一单写者持久化协调层与并发边界
- **修前根因**：受保护后端 `packages/game-core/src/spike/save.ts` 的 `SpikeFileSaveRepository.commit()` 内部异步读槽与异步写盘之间无互斥锁，两路并发调用在同一次初始扫描后选中同一槽，均返回 `COMMITTED / rev1 / slot0`，后写者静默覆盖先写者。
- **修后实现**：
  1. 新增 **`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`**（不触碰后端受保护源码），按设计文档 11 应用层单写者职责维护进程级 `Map<storageKey, Promise<void>>` 独占队列：
     - `BrowserFilePort` 暴露 `storageKey = "browser:<namespace>"`；
     - `WeChatFilePort` 暴露 `storageKey = "wechat:<rootDir>"`；
     - `MemoryFilePort` 暴露实例或命名 `storageKey`；
     - `FaultInjectingFilePort` 透传内部 `inner.storageKey` 与 `probeStorage()`，并新增异步写入拦截器 `setWriteInterceptor()` 支持真实交错并发测试。
  2. 无论是**同一个协调器实例**还是**多个协调器实例共享同一存储命名空间**，并发 `commit()` 均进入同一独占队列：第一个候选完成落盘与回读后获 `COMMITTED`，第二个候选随后扫描看到新 `revision` 并由后端原逻辑返回 `CONFLICT`（零物理写，零覆盖）；若第一个候选写前失败（`FAILED`），第二个候选随后正常获锁并 `COMMITTED`。
  3. 将 `BootEntry.ts` 与 `PlatformVerificationSuite.ts` 全部接入 `SingleWriterSaveCoordinator`。
  4. **架构边界声明**：本协调层保证**同一 JS 运行态 / 单进程（含微信小游戏单进程及单浏览器页签）内同一存储命名空间的单写者排他性**。直接绕过协调层并行调用底层 `SpikeFileSaveRepository.commit()` 不受保护（调用前置条件：前端必须统一经由 `SingleWriterSaveCoordinator` 写入）；浏览器**跨多标签页** `localStorage` 原子性不予宣称（见 `ISSUE_REPORT.md`）。

---

## 3. 文件修改与所有权证明

### 3.1 Git 候选状态（工作区 `E:\idle-fishing-integration`，分支 `integration/fe-000-be-r1`）
- `HEAD`：`be62996fae44df24094331d670f6f0ab3741a4f2`
- `MERGE_HEAD`：`5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（未提交、未推送、未合并 `main`）
- **暂存区（58 个后端合并文件）**：相对 `5bcc9ac` 的 `git diff` 为 **`0` 行差异**，零重新暂存、零撤销暂存、零修改。
- **未暂存修改（共 12 个授权前端文件，较首轮 6 个新增 6 个修改文件）**：
  - `apps/game-client/assets/scripts/bootstrap/BootEntry.ts`（首轮+本轮）
  - `apps/game-client/assets/scripts/platform/BrowserFilePort.ts`（本轮新增修改）
  - `apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts`（本轮新增修改）
  - `apps/game-client/assets/scripts/platform/PlatformTypes.ts`（本轮新增修改）
  - `apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`（首轮+本轮）
  - `apps/game-client/assets/scripts/platform/WeChatFilePort.ts`（本轮新增修改）
  - `apps/game-client/assets/scripts/shared/SharedCoreBridge.ts`（首轮，保持）
  - `apps/game-client/assets/scripts/ui/OverviewPage.ts`（首轮，保持）
  - `tests/frontend/fe-000/platform-and-core.test.ts`（首轮+本轮）
  - `tests/frontend/fe-000/run-node-tests.mjs`（本轮新增修改）
  - `tests/frontend/fe-000/tsconfig.json`（本轮新增修改）
  - `tests/frontend/fe-000/verify-web-build.mjs`（首轮+本轮）
- **新增授权前端源码与测试夹具（7 个未跟踪文件）**：
  - `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`（及 Cocos 生成的 `SingleWriterSaveCoordinator.ts.meta`）
  - `tests/frontend/fe-000/fixtures/fixture-{empty,skipped,failed,passed,mixed}.test.ts`（5 个）
- **历史报告与原有工作区保护**：
  - `reports/frontend/` 相对 `be62996`：`0` 行差异。
  - `reports/integration/FE-000-R1-INTEGRATION/` 全部 48 份历史报告、日志与证据逐字节校验 `DRIFT=0`。
  - 原有 4 个工作区（`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review`）零修改。
