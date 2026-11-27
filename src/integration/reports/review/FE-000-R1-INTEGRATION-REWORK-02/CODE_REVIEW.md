# FE-000-R1-INTEGRATION-REWORK-02 源码审查记录（CODE_REVIEW）

- **审核方**：独立前端代码审核人员（DeepSeek 4.1 Flash 1017）
- **审核对象**：完整候选工作区（58 已暂存后端文件 + 12 未暂存前端文件 + 68 未跟踪文件）
- **审核方式**：逐文件通读 + Git 差异核对 + 隔离快照独立执行；只读，未修改被审核文件
- **关联报告**：`REVIEW_REPORT.md`、`TEST_VERIFICATION.md`、`DESIGN_ISSUES.md`

## 1. Git 与文件事实

- `HEAD=be62996…`、`MERGE_HEAD=5bcc9ac…`、`merge-base=358b111…` 均与任务书一致。
- 58 个已暂存文件全部属于后端合并；工作树与 Index 对 `5bcc9ac` 在受保护路径上均为 **0 差异**。
- 前端整改全部位于未暂存（12 个修改）与未跟踪（含新增协调器、夹具、守卫、报告）。
- 74 项 SHA-256 清单逐项重算 **74/74 匹配**。

关键文件与职责：

| 文件 | 本轮职责 |
|---|---|
| [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) | 健康状态机、单写者队列、Web Locks 临界区、取消钩子 |
| [WeChatFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/WeChatFilePort.ts) | 微信 FS fail-closed、`UnavailableFilePort` |
| [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) | localStorage 探针与 fail-closed、显式 `MemoryFilePort`（仅测试） |
| [PlatformTypes.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformTypes.ts) | `StorageHealthState`、宿主探测与 FS 能力解耦 |
| [PlatformVerificationSuite.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts) | 运行时端口工厂（移除内存降级） |
| [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) | 任务生命周期、销毁拒绝、冻结停止、显式恢复、诊断 harness |
| [node-test-worker.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/node-test-worker.mjs) | 叶子事件树计数、完成哨兵 |
| [run-node-tests.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/run-node-tests.mjs) | 受监控子进程、白名单、严格门禁 |
| [safe-path-guard.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/safe-path-guard.mjs) | 输出目录精确白名单与 symlink/junction 防护 |
| [verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs) | 真实 Chrome CDP E2E（含双标签页） |
| [platform-and-core.test.ts](file:///E:/idle-fishing-integration/tests/frontend/fe-000/platform-and-core.test.ts) | Node/Mock 自动化（15 用例） |

## 2. P1-01 存储健康与冻结恢复

### 2.1 健康状态作用域

- `namespaceHealth: Map<string, NamespaceHealthRecord>`（`SingleWriterSaveCoordinator.ts:61`），以 `storageKey` 为键。
- `storageKey` 来源：`BrowserFilePort` → `browser:<namespace>`；`WeChatFilePort` → `wechat:<USER_DATA_PATH>/<ns>`；`FaultInjectingFilePort` 透传内层；`UnavailableFilePort` → `unavailable:<host>:<ns>`；匿名端口分配进程内唯一键（`resolvePortStorageKey`，`:75-83`）。
- 结论：同一运行实例内、同一持久化命名空间的所有协调器共享同一健康状态与同一进程内队列；不同命名空间互不影响。实测：两个 `BrowserFilePort`（同 namespace）实例 `storageKey` 相同、互相阻塞并串行提交（`evidence/independent-core.log`、`evidence/chrome-e2e.log` T5）。

### 2.2 冻结触发

| 触发 | 实现位置 | 行为 | 独立验证 |
|---|---|---|---|
| commit 前 probe 失败 | `:282-290` | `markStorageUnavailable` + 返回 `STORAGE_UNAVAILABLE` | core T2/T3 |
| loadSafe probe 失败 | `:226-232` | 同上 | core T6/T7、Chrome T13 |
| 物理写致命 IO（`WRITE_IO_ERROR`/`QUOTA_EXCEEDED`/`STORAGE_UNAVAILABLE` 等） | `:298-326`、`:331-336` | 观测端口记录致命错误；`FAILED` 升级为 `STORAGE_UNAVAILABLE` | core T3、Chrome T11 |
| 全部槽位读 IO 失败 | `:236-240` + `isAllSlotIoUnavailable`（`:140-143`） | 标记不可用 | core T6 |
| 浏览器 Web Locks 缺失/拒绝 | `:178-196` | 标记不可用 + fail-closed 返回 | Chrome T6/T7 |
| 正常确定失败（`INJECTED_PRE_WRITE`/部分写/冲突） | 不进入 `FATAL_STORAGE_ERROR_CODES`（`:65-73`） | 返回 `FAILED`/`CONFLICT`，可重试 | Chrome NODE 套件（回归 15/15） |

### 2.3 冻结的持久性与恢复

- 冻结后 `commit()` 在 `:273-280` 直接短路，**不会**因底层存储临时恢复而自动写入（core T2：恢复探针后仍返回 `STORAGE_UNAVAILABLE`）。
- 唯一恢复路径 `loadSafe()`（`:223-248`）在独占锁内重新执行：probe → `SpikeFileSaveRepository.load()` 重读 3 槽 → Envelope/epoch/schema 校验 → 仅 `VALID`/`EMPTY` 才 `markStorageAvailable`。
- 恢复会替换 BootEntry 的内存状态与 revision（`BootEntry.ts:162-269`）。core T5 独立构造"冻结期间外部写者推进到 rev2"：`loadSafe()` 返回 rev2，随后用旧 `expectedRevision=1` 提交得到 `CONFLICT`，证明不会用旧内存覆盖新档。
- Chrome T12：全新实例启动读到 rev5；`expectedRevision=4` → `CONFLICT`；`5` → `COMMITTED/6`。

### 2.4 微信 fail-closed

- `detectRuntimeEnv`（`PlatformTypes.ts:66-98`）仅以 `wx` 是否存在识别微信宿主，与 FS 能力解耦；`getFileSystemManager` 缺失不会被误判为 `NODE`。
- `WeChatFilePort.probeStorage`（`:130-193`）逐项校验 `wx`、`getFileSystemManager()`（含抛异常）、`USER_DATA_PATH`、6 个必需同步方法、`ensureRootDir()`；任一失败返回 `{available:false}`，所有 IO 随后抛 `FilePortIoError('STORAGE_UNAVAILABLE')`。
- `createRuntimeFilePort`（`PlatformVerificationSuite.ts:29-42`）不再返回 `MemoryFilePort`；未知宿主返回 `UnavailableFilePort`（`WeChatFilePort.ts:74-103`）。
- 独立实测：`wx` 缺失、fsm 缺失/抛错、6 个方法分别缺失（逐项）、fs 权限错误、文件不存在——均按预期（core T7/T8/T9、E4）。

### 2.5 语义区分

- 微信 `read` 仅在 `isNotFoundError` 时返回 `null`（`WeChatFilePort.ts:227-241`）；权限/读错误抛 `READ_IO_ERROR`，不会被当作空档（core T9）。
- `BrowserFilePort.probeStorage`（`:63-87`）通过临时 `__probe__` 键读写回校验，失败即 `STORAGE_UNAVAILABLE`，不再静默内存降级。

### 2.6 观察（不阻塞）

- **读回（read-back）阶段 IO 失败不会置 `storageHealth=STORAGE_UNAVAILABLE`**：`repo.commit` 的读回异常进入 `resolveUncertainWrite`；若复扫也失败，协调器返回 `UNCERTAIN`，但 `fatalErrors` 仅在 `result.kind === 'FAILED'` 时升级健康（`:331-336`）。BootEntry 对 `UNCERTAIN` 设置 `persistenceHalted`（`BootEntry.ts:471-491`），因此应用层**停止业务写入**符合 `docs/interfaces/19` 契约（"readback 异常 → UNCERTAIN，停止业务写入，立即重新扫描"），但健康标志保持 `AVAILABLE`。详见 REV2-01。
- **部分槽位 IO 失败时恢复会判定 `VALID(recovered=true)` 且健康置回 `AVAILABLE`**：随后任何提交都因 `unreadable.length>0` 返回 `UNCERTAIN`（0 写入）。数据安全无风险，但"恢复后必须所有槽位可读"的字面要求未强制。详见 REV2-02。

## 3. P1-02 生命周期与待写任务

- `onDestroy()` 第一行同步 `this.isDestroyed = true`（`BootEntry.ts:141-151`），随后退订生命周期、销毁 UI 适配器。
- 任务入口双层拒绝：
  - `enqueueHideSave` 入口 `if (this.isDestroyed) return false`（`:355-358`）；
  - BootEntry 队列内再次检查（`:360-373`），记录 `CANCELLED/SKIPPED_DESTROYED`。
- 已进入协调器的任务：`shouldCancelBeforeStart` 在**获取进程内队列 + 跨标签页 Web Lock 之后、任何 probe/read/write 之前**调用（`SingleWriterSaveCoordinator.ts:263-271`）；BootEntry 传入 `() => this.isDestroyed || this.persistenceHalted`（`BootEntry.ts:396`）。
- 原子性：取消检查 → 健康检查 → probe → `onStarted` → `beforeCommitBody` 之间在生产路径**没有 await**（`beforeCommitBody` 仅测试注入），因此 QUEUED→STARTED 转换在单线程事件循环内原子；不存在"检查后又被销毁"的窗口。
- STARTED 在途写不取消：`BootEntry` 只记录真实完成结果（`:420-447`），独立 Chrome/T4 用例在"已写盘、read-back 未完成"时触发销毁，任务仍 `COMMITTED`。
- 双实例/双写：旧实例 STOP 后新实例 `loadSafe` 与旧实例提交共享同一进程内队列与同一 Web Lock；revision 校验阻止旧 `expectedRevision` 覆盖（Chrome T12、core T5）。
- BootEntry 单一 `pendingHideSave` 链 + `advancePersistState` 同链，避免多个异步队列交错。
- 观察：诊断 harness 的 `commitCandidateViaCoordinator` 不检查 `isDestroyed`（`BootEntry.ts:610-645`），独立实测销毁后仍可提交 rev+1（见 REV2-03）。正式任务入口不受影响。

## 4. P1-03 Node 24 测试运行器

### 4.1 事件结构与叶子计数（worker）

- 使用 `run({ files, concurrency:false, isolation:'none' })`，监听 `test:start` / `test:pass` / `test:fail`（`node-test-worker.mjs:51-136`）。
- 依据 **Node v24.20.0 实测事件树**（审核方独立探针 `evidence/probe-events.mjs` 输出）：
  - `describe` → `test:start`(nesting n, type 未定) + 最终 `test:pass` 且 `details.type='suite'`；
  - `t.test(...)` 与 `test.skip`/`test.todo` 子项**均会**触发 `test:start`，因此父测试 `hasChildren=true`；
  - 模块加载崩溃 → 一个 `test:fail`，`name` 为文件绝对路径（正斜杠），`isFileWrapper` 归一化后匹配；
  - `test:plan`/`test:diagnostic` 被忽略。
- 计数规则：`details.type==='suite'`、文件包装器、`hasChildren` 容器不计入叶子；`skip`/`todo` 仅在其自身事件计数；容器失败在无子失败时单独计入 `containerFailures`，避免父级失败被吞。
- 审核方对抗夹具结果（Node 24.20.0）：仅 skip+todo 父测试 `total=2 pass=0 skip=1 todo=1`；4 层嵌套 `pass=2`；父测试子项通过后自身抛错 `pass=1+containerFail=1`；纯空 describe `total=0`。全部符合预期。

### 4.2 受监控子进程与完成哨兵

- 每个编译后测试文件独立 `spawnSync` 子进程（`run-node-tests.mjs:125-132`），通过 JSON 哨兵回传结果；哨兵仅在 `node:test` 流 `end/close` 后写入（`node-test-worker.mjs:145-163`）。
- `process.exit(0)`（模块加载时或测试体内）、`process.exit(1)`、顶层崩溃、`uncaughtException`、`unhandledRejection`、`SIGTERM`：哨兵缺失或非零退出 → `procErr>=1` → 退出码 1（29 组矩阵实测）。
- 门禁：`procErr>0 || containerFailures>0 || failed>0 || total===0 || passed===0` → 退出 1（`:190-217`）。"全 skip/全 todo/仅 skip 父测试"均不能伪装成通过。
- 观察：`spawnSync` 未设置 `timeout`（`:128-132`），挂起用例会无限等待（REV2-06）。

## 5. P2-04 跨标签页写入互斥

- **接入真实性**：`withExclusiveLock`（`:170-198`）在进程内队列内、当 `storageKey` 以 `browser:` 开头且为真实浏览器上下文时，调用 `navigator.locks.request('idle-fishing:save:' + storageKey, {mode:'exclusive'}, …)`。
- **临界区覆盖**：锁回调内执行完整的 取消检查 → 健康检查 → probe → 读 3 槽 → revision/epoch 校验 → 写目标槽 → 读回 → 结果判定（`:263-337`）。不存在锁在 read-back 前释放的路径。
- **锁命名空间**：由 `storageKey` 唯一确定；两个协调器实例同命名空间 → 同锁名（Chrome T5：第二个通过 `System.import` 构造的协调器 `loadSafe` 在 700ms 内未完成，证明被同一锁阻塞）。
- **fail-closed**：`navigator.locks` 缺失 → `STORAGE_UNAVAILABLE`；`request` 拒绝 → `CROSS_TAB_LOCK_REJECTED` → `STORAGE_UNAVAILABLE`；两者均 0 槽写入（Chrome T6/T7 计数验证）。
- **真实双标签页结果**（审核方独立脚本）：Tab A 持锁 → Tab B 提交在锁上 pending 且槽位为空 → 释放后 A `COMMITTED(rev1)`、B `CONFLICT`；磁盘仅 1 个槽且为 A 候选；A 重载与 B `reinitializePersistence` 均命中 A 的 revision/cursor。持锁 Tab C 关闭后 Chrome 自动释放锁，A 恢复提交并重载一致。连续 A→B 提交 rev+1 严格递增。启动阶段 `loadSafe` 同受该锁保护（Tab B 手动持锁期间 Tab A 重载无法就绪，释放后正常启动）。
- **平台差异声明**：微信单实例模型下跨标签页语义不适用；代码注释明确真机多上下文验证仍属 GATE-01。
- 观察：浏览器上下文内 `commit`/`loadSafe` 的任务异常未包装为 `CoordinatorTaskError`，会被误分类为 `CROSS_TAB_LOCK_REJECTED`（fail-closed 但诊断误导，REV2-04）。

## 6. P2-05 输出目录删除安全

- `validateDeletableOutputDir`（`safe-path-guard.mjs:80-190`）：
  - 拒绝空/非字符串/NUL、UNC（含 `\\?\` 扩展路径，`/^(\\\\|\/\/)/`）、盘符根、受保护精确路径（仓库根/父目录/`apps`/`apps/game-client`/`assets`/`build`/`packages`/`tests`/`tests/frontend`/`fe-000`/`reports`/`docs`/`config`/`home`/Desktop/Documents）。
  - `compiled-tests` 仅允许 `<repo>/tests/frontend/fe-000/` 的**直接子目录**且 basename 匹配 `^\.compiled(?:-[A-Za-z0-9._-]+)?$`。
  - `cocos-build` 仅允许规范路径精确等于 `build/web-mobile` 或 `build/wechatgame`（**不是前缀匹配**）。
  - `chrome-temp` 仅允许 `realpath(os.tmpdir())` 的直接子目录且前缀 `fe000-r1-chrome-`。
- `resolveCanonicalPath`（`:35-71`）：对存在路径 `lstat` 检测 symlink/junction，并对最近存在祖先做 `realpathSync`；规范路径与原路径不一致即拒绝（覆盖 Junction/符号链接/大小写/短路径逃逸）。Windows 比较统一小写与分隔符。
- `safeRemoveOutputDir`（`:200-206`）对规范化后的 `canonicalPath` 重新校验后再 `rmSync`。
- 独立验证：`build\web-mobile-evil`、`web-mobile.bak` 被拒绝且金丝雀未删；`.compiled-junction` 指向外部被拒（`SYMLINK_OR_JUNCTION_REJECTED`）；允许目录内嵌套 Junction 在 `rmSync` 中不被穿透；`--out-dir=../../reports` 在删除前被拦截。
- 已接入 `run-node-tests.mjs:48-65` 与 `verify-web-build.mjs:1120`（Chrome 临时目录清理）。

## 7. 与设计契约的一致性

- `docs/interfaces/19` 要求：IO 失败不得当 EMPTY；3 槽 Envelope 校验；写失败/读回异常不得假定未写 → `UNCERTAIN` + 停止业务写入 + 立即复扫；直接重复旧 `expectedRevision` → `CONFLICT`；只允许单实例、不承诺跨进程 CAS。
- 实现与之一致：`SpikeFileSaveRepository`（`packages/game-core`，受保护未改）提供 3 槽协议；协调器在应用层叠加健康状态、取消、Web Locks；BootEntry 在 `UNCERTAIN`/`STORAGE_UNAVAILABLE`/`CORRUPT`/`UNSUPPORTED` 一律停止写入，不新建玩家、不清槽。
- 契约未要求"Web Locks 跨标签页"，本轮为额外加固，不改变正式契约。

## 8. 代码级观察清单（详见 DESIGN_ISSUES.md）

| 编号 | 级别 | 一句话 | 位置 |
|---|---|---|---|
| REV2-01 | P3 | read-back IO 失败 → `UNCERTAIN` 且应用层停止，但 `storageHealth` 不置 `STORAGE_UNAVAILABLE` | `SingleWriterSaveCoordinator.ts:331-336` |
| REV2-02 | P3 | 部分槽位 IO 失败时恢复仍 `VALID/AVAILABLE`，写入由 `UNCERTAIN` 阻断 | `:223-248`、`:140-143` |
| REV2-03 | P3 | 诊断 harness `commitCandidateViaCoordinator` 绕过 `isDestroyed` 拒绝 | `BootEntry.ts:610-645` |
| REV2-04 | P3 | 浏览器内任务异常被误分类为 `CROSS_TAB_LOCK_REJECTED` | `SingleWriterSaveCoordinator.ts:185-196` |
| REV2-05 | P3 | `pendingHideSave` 链无 `.catch`，任务拒绝会毒化后续队列 | `BootEntry.ts:359`、`:574` |
| REV2-06 | P3 | Runner 无单 worker 超时，挂起用例会挂起套件 | `run-node-tests.mjs:128-132` |
| REV2-07 | P3 | 平台诊断页 FS/Save 套件直写自有命名空间，不经 coordinator/Web Lock | `PlatformVerificationSuite.ts:64-89` |
| REV2-08 | P3 | `clearSlotsForTest`/`runExclusive` 公开且暴露于 `__SPIKE_HARNESS__`，可在恢复后清槽 | `SingleWriterSaveCoordinator.ts:347-360`、`BootEntry.ts:646-680` |

## 9. 审查结论

五处整改点的实现路径、边界条件与失败语义均与任务书、`docs/interfaces/19` 一致；未发现可导致数据丢失、双写、假绿或误删的缺陷。上述 8 项均为非阻塞改进建议，不影响本轮 `PASS` 判定与 GATE-01 阻塞性。