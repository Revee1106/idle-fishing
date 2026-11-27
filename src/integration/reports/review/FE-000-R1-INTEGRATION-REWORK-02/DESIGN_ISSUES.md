# FE-000-R1-INTEGRATION-REWORK-02 设计/实现问题清单（DESIGN_ISSUES）

- **审核方**：独立前端代码审核人员（DeepSeek 4.1 Flash 1017）
- **总体结论**：无阻塞问题（**PASS**）。以下 9 项均为 **P3 非阻塞**，其中 8 项为实现/工具健壮性观察，1 项为文档一致性笔误。
- **判定口径**：P0=数据损坏/假绿/误删；P1=功能错误；P2=重要缺陷；P3=非阻塞改进。本清单无 P0–P2。

---

## REV2-01 读回（read-back）IO 失败不置 `STORAGE_UNAVAILABLE`

- **编号**：REV2-01
- **严重程度**：P3（非阻塞；契约语义已满足，健康分类不完全对齐任务书字面）
- **源码位置**：
  - [SingleWriterSaveCoordinator.ts:331-336](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L331)（仅 `fatalErrors>0 && result.kind==='FAILED'` 才升级健康）
  - [SingleWriterSaveCoordinator.ts:298-326](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L298)（观测端口仅对读路径记录 `STORAGE_UNAVAILABLE`）
  - [BootEntry.ts:471-491](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L471)（`UNCERTAIN` → `persistenceHalted=true`）
- **触发条件**：物理写成功，但紧随其后的读回校验抛 IO 错误，且不确定写复扫同样失败（例如微信 FS 在写后掉线、localStorage 读能力丧失）。
- **独立复现步骤**：
  1. 以 `MemoryFilePort` 为底层构造自定义 FilePort：首次写入成功后，将所有后续 `read()` 抛 `FilePortIoError('STORAGE_UNAVAILABLE')`；
  2. 构造 `SingleWriterSaveCoordinator`，调用 `commit(state, null)`；
  3. 观察返回值与 `storageHealth`；再次 `commit` 观察是否有物理写；
  4. 对应脚本：`evidence/independent-core.mjs` 用例 `P1-01/T4`、`T4b`（日志 `evidence/independent-core.log`）。
- **实际结果**：`commit` 返回 `UNCERTAIN`（符合 `docs/interfaces/19`）；再次 `commit` 仍 `UNCERTAIN` 且 **0 物理写**；`coordinator.storageHealth` 保持 `AVAILABLE`；BootEntry 应用层 `persistenceHalted=true`，后续 HIDE 为 `SKIPPED_HALTED`。
- **预期结果**：任务书 P1-01 要求"运行中存储失效（probeStorage / **物理写 IO 异常**）必须进入持久化冻结态 `STORAGE_UNAVAILABLE`"。读回异常属于写后存储失效，**应用层冻结已成立**；但 `StorageHealthState` 未同步。若验收按字面要求"IL 异常即健康不可用"，此实现存在分类偏差。
- **是否阻塞 GATE-01**：**否**。无不安全副作用：无数据丢失、无静默重试（BootEntry 停止写入），且符合接口契约 doc-19 的 `UNCERTAIN + 停止业务写入 + 复扫`。
- **建议修复方式**：在 `fatalErrors.length>0` 时同时覆盖 `result.kind==='UNCERTAIN'`（或明确读回 IO 错误码集），置 `STORAGE_UNAVAILABLE` 并给出原因；补充"读回失败 → 健康冻结 → `loadSafe()` 恢复"的自动化用例。若设计方认可当前"仅应用层 halt"的语义，建议在 `docs/interfaces/19` 或实现注释中明确"读回失败不改变存储健康分类"。

---

## REV2-02 部分槽位 IO 失败时恢复仍判定 `VALID/AVAILABLE`

- **编号**：REV2-02
- **严重程度**：P3（安全无风险，但"恢复必须重新验证所有槽位"的字面要求未被强制）
- **源码位置**：
  - [SingleWriterSaveCoordinator.ts:241-243](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L241)（`VALID`/`EMPTY` 即 `markStorageAvailable`）
  - [SingleWriterSaveCoordinator.ts:140-143](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L140)（仅"三个槽全部 IO 失败"才视为存储不可用）
- **触发条件**：恢复时 1 个槽位读取 IO 失败，其余槽位有合法 Envelope。
- **独立复现步骤**：
  1. 正常提交 rev1（槽 0）与 rev2（槽 1）；
  2. 对槽 1 注入读 IO 失败；
  3. `loadSafe()` → 观察 `kind/recovered/storageHealth`；
  4. 再 `commit(state,'2')` → 观察返回值与槽内容是否变化；
  5. 脚本：`evidence/independent-edges.mjs` 用例 `E1`。
- **实际结果**：`loadSafe()` 返回 `VALID, recovered=true`，`storageHealth=AVAILABLE`；随后 `commit` 返回 `UNCERTAIN` 且 **0 写入**（槽位数量与内容不变）。
- **预期结果**：可选两种严格语义之一：(a) 任一槽 IO 失败均保持冻结，直至全部可读；(b) 接受"降级恢复"但健康应显式标注 degraded（当前无此状态）。
- **是否阻塞 GATE-01**：**否**。写入被 `UNCERTAIN` 阻断，无数据风险。
- **建议修复方式**：在 `loadSafe()` 中记录 `slotIoUnavailable` 标志；若存在 IO 失败槽位则保持/置 `STORAGE_UNAVAILABLE`，或引入 `DEGRADED` 状态；补充对应用例。若设计方认定可接受，建议写入设计说明。

---

## REV2-03 诊断 harness 在 `onDestroy()` 后仍可提交

- **编号**：REV2-03
- **严重程度**：P3（仅诊断/测试面；正式任务入口已正确拒绝）
- **源码位置**：
  - [BootEntry.ts:610-645](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L610)（`commitCandidateViaCoordinator` 未检查 `isDestroyed`）
  - [BootEntry.ts:602](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L602)（`getPersistCoordinator` 暴露协调器）
- **触发条件**：实例已 `onDestroy()`，通过 `globalThis.__SPIKE_HARNESS__.commitCandidateViaCoordinator(...)` 直接提交。
- **独立复现步骤**：
  1. 真实 Web 构建中启动、`clearLifecyclePersistence()`；
  2. `commitCandidateViaCoordinator(60000, null)` → `COMMITTED rev1`；
  3. `triggerDestroyForTest()`；
  4. `requestHideSaveForTest('after-destroy')` → **false（已拒绝）**；
  5. 再 `commitCandidateViaCoordinator(60000,'1')` → 观察结果；
  6. 脚本：`evidence/chrome-destroy-bypass.mjs`（日志 `evidence/chrome-destroy-bypass.log`）。
- **实际结果**：第 5 步返回 `COMMITTED rev2`（`{"seedRev":"1","destroyed":true,"rejectedHide":false,"postKind":"COMMITTED","postRev":"2"}`）。
- **预期结果**：P1-02 要求"`onDestroy()` 后所有新任务被拒绝"。正式的 HIDE 生命周期入口与 `requestHideSaveForTest` 已拒绝；但诊断 harness 通道仍可写入，属于验收面上的"旁路"。
- **是否阻塞 GATE-01**：**否**。harness 为 FE-000 spike 的诊断接口，不在游戏业务流程中调用；本轮 P1-02 的正式验收路径均已通过。
- **建议修复方式**：为 `commitCandidateViaCoordinator`（及 `getPersistCoordinator` 的使用者）增加 `if (this.isDestroyed)` 短路；或将整个 `__SPIKE_HARNESS__` 通过构建宏/调试开关在发布构建中移除，避免诊断面进入用户版本。

---

## REV2-04 浏览器内任务异常被误分类为 `CROSS_TAB_LOCK_REJECTED`

- **编号**：REV2-04
- **严重程度**：P3（fail-closed 结果安全，但诊断信息误导）
- **源码位置**：
  - [SingleWriterSaveCoordinator.ts:185-196](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L185)（catch 内仅 `CoordinatorTaskError` 可区分）
  - [SingleWriterSaveCoordinator.ts:203-216](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L203)（仅 `runExclusive` 包装任务异常）
  - `commit`/`loadSafe` 的任务体未包装（`:223-341`）
- **触发条件**：浏览器环境下，`commit`/`loadSafe` 的任务体抛异常（例如测试注入的 `beforeCommitBody` 拒绝、仓库层意外异常）。
- **独立复现步骤**：
  1. 在 Chrome 中对 `navigator.locks.request` 之外的提交路径注入 `beforeCommitBody: () => Promise.reject(new Error('boom'))`；
  2. 调用提交，观察返回 `detail` 与 `storageHealth`；
  3. 代码路径亦可直接审阅：`locks.request` 的 catch 将非 `CoordinatorTaskError` 一律当作锁拒绝。
- **实际结果**：返回 `STORAGE_UNAVAILABLE`，`detail` 以 `CROSS_TAB_LOCK_REJECTED` 开头，命名空间被冻结；无数据写入。
- **预期结果**：任务异常应被标记为任务错误（或向上抛出），不应被描述为"锁拒绝"；即使保持 fail-closed，原因应可区分。
- **是否阻塞 GATE-01**：**否**。结果安全（拒绝写入），仅影响可观测性与故障定位。
- **建议修复方式**：在 `commit`/`loadSafe` 中使用与 `runExclusive` 相同的 `CoordinatorTaskError` 包装，或将锁获取与任务执行拆分为两个 try/catch，先确认锁是否真正获取失败再标记 `CROSS_TAB_LOCK_REJECTED`。

---

## REV2-05 `pendingHideSave` 链缺少拒绝处理

- **编号**：REV2-05
- **严重程度**：P3（当前生产路径未发现会抛出的任务，但结构性脆弱）
- **源码位置**：
  - [BootEntry.ts:359-361](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L359)（`this.pendingHideSave = this.pendingHideSave.then(async () => {…})` 无 `.catch`）
  - [BootEntry.ts:574-575](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L574)（`advancePersistState` 同链）
- **触发条件**：队列任务体抛错（非返回结果对象）。当前 `commit()` 在 Node/微信路径对仓库与端口错误做了内部捕获/转换；浏览器路径会把异常转成 `STORAGE_UNAVAILABLE`。因此实际触发需要未来新增的调用路径或测试钩子抛错。
- **独立复现步骤**：代码审阅；审核方尝试通过公开 harness 注入 `beforeCommitBody` 拒绝（属于测试钩子），可观察到一致性风险，但不属于生产路径。
- **实际结果**：链一旦 reject，后续 `.then` 回调不再执行、`awaitPendingHideSave()` 会 reject、可能产生 unhandled rejection；`enqueueHideSave` 仍返回 `true`。
- **预期结果**：单个任务失败不应毒化整个保存队列；队列应记录失败并可继续（或明确 halt）。
- **是否阻塞 GATE-01**：**否**。
- **建议修复方式**：在任务体内部 `try/catch`，将异常转换为 `FAILED/UNCERTAIN` 历史项并 `persistenceHalted=true`，保证链始终 resolve；或在链尾追加 `.catch(() => {})` 并显式记录。

---

## REV2-06 测试运行器无单 worker 超时

- **编号**：REV2-06
- **严重程度**：P3（CI/本地体验风险，不涉及产品代码）
- **源码位置**：[run-node-tests.mjs:128-132](file:///E:/idle-fishing-integration/tests/frontend/fe-000/run-node-tests.mjs#L128)（`spawnSync` 未设置 `timeout`）
- **触发条件**：被测文件包含永不 resolve 的测试（Node `node:test` 默认超时为 Infinity），或 worker 进入死循环/死锁。
- **独立复现步骤**：
  1. 新建夹具 `test('hang', () => new Promise(() => {}))`；
  2. `node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/… --out-dir=.compiled-…`；
  3. 观察进程长期不退出（审核方仅做代码审查，未执行以避免遗留子进程）。
- **实际结果**：无内部超时；外层 CI 只能依赖外部超时终止。
- **预期结果**：单 worker 应有上限（例如 120s），超时后记 `procErr` 并以非零退出。
- **是否阻塞 GATE-01**：**否**（P1-03 的 15 项必测边界均不包含挂起场景）。
- **建议修复方式**：`spawnSync(...,{ timeout: N, killSignal: 'SIGKILL' })`，或在 worker 内 `run({ timeout })` 并在哨兵中记录超时；补充"挂起用例"夹具。

---

## REV2-07 平台诊断页 FS/Save 套件绕过协调器/Web Lock

- **编号**：REV2-07
- **严重程度**：P3（仅影响诊断页自身数据，不影响正式存档）
- **源码位置**：[PlatformVerificationSuite.ts:64-89](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts#L64)（`runFileSystemAndSaveSuite` 直接使用 `basePort`）
- **触发条件**：两个同源标签页同时打开 Page 2 并运行 FS/Save 诊断套件（命名空间 `idle_fishing_spike_fs:`）。
- **独立复现步骤**：代码审阅；未执行双标签页诊断并发（与正式存档命名空间不同）。
- **实际结果**：诊断槽位 `save_slot_*.json` 的写入不经过 `SingleWriterSaveCoordinator` 或 Web Lock；并发运行可能出现诊断结果互相干扰（如 `T04-ROTATE` 偶发失败）。
- **预期结果**：诊断可接受，但若要稳定可重复，应使用每标签页独立命名空间或同样走协调器。
- **是否阻塞 GATE-01**：**否**（诊断面，非产品存档路径；正式保存已由 P2-04 覆盖）。
- **建议修复方式**：为诊断套件生成随机后缀 namespace（例如 `idle_fishing_spike_fs_<tabId>`），或显式在文档中标注"诊断不可多标签页并发"。

---

## REV2-08 破坏性测试 API 暴露于 Web 产物

- **编号**：REV2-08
- **严重程度**：P3（spike 诊断面；发布前需移除/收敛）
- **源码位置**：
  - [SingleWriterSaveCoordinator.ts:347-360](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L347)（`clearSlotsForTest` 删除三槽并置健康为可用）
  - [BootEntry.ts:646-680](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L646)（`clearLifecyclePersistence` 暴露在 `__SPIKE_HARNESS__`）
  - [SingleWriterSaveCoordinator.ts:203-216](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L203)（`runExclusive` 公开）
- **触发条件**：在浏览器控制台或任意同源脚本调用 `__SPIKE_HARNESS__.clearLifecyclePersistence()`；在存储恢复后、未显式 `loadSafe()` 的情况下会清空真实槽位并将健康置回 `AVAILABLE`。
- **独立复现步骤**：
  1. 启动 Web 构建，写入 rev1；
  2. 控制台执行 `__SPIKE_HARNESS__.clearLifecyclePersistence()`；
  3. 观察三槽被删除、`revision=null`。
- **实际结果**：清槽成功（spike 设计用途）。
- **预期结果**：FE-000 spike 允许；任何对外/发布构建不应暴露清档与任意临界区执行能力。
- **是否阻塞 GATE-01**：**否**（当前为技术 spike；需在正式产品化前收敛）。
- **建议修复方式**：用编译期开关（如 `__SPIKE_DEBUG__`）包裹 harness 注入与 `clearLifecyclePersistence`；发布构建剔除；或将 `clearSlotsForTest` 改为仅测试代码可访问（如独立测试包入口）。

---

## REV2-09 开发方报告计数笔误（文档一致性）

- **编号**：REV2-09
- **严重程度**：P3（文档）
- **源码/文档位置**：`reports/integration/FE-000-R1-INTEGRATION-REWORK-02/IMPLEMENTATION_REPORT.md` §1（P1-03 行写"18 组专项复现命令"）与同目录 `TEST_REPORT.md` §2（"19 组"）及实际 `logs/`（19 组）。
- **触发条件**：阅读实施报告核对证据数量。
- **独立复现步骤**：统计 `reports/.../logs/r2-p1-03-*.log` 与 `r2-p2-05-unsafe-outdir.log`，并对照两份报告文字。
- **实际结果**：实施报告为 18，测试报告与实际均为 19。
- **预期结果**：两份报告与实际日志一致。
- **是否阻塞 GATE-01**：**否**。
- **建议修复方式**：将实施报告的"18 组"更正为"19 组（含 P2-05 不安全 out-dir 复现）"；无需改代码。

---

## 非阻塞观察项汇总

| 编号 | 级别 | 主题 | GATE-01 阻塞 |
|---|---|---|---|
| REV2-01 | P3 | read-back 失败不置 `STORAGE_UNAVAILABLE` | 否 |
| REV2-02 | P3 | 部分槽 IO 恢复仍 `AVAILABLE`（写入被阻断） | 否 |
| REV2-03 | P3 | 诊断 harness 销毁后仍可提交 | 否 |
| REV2-04 | P3 | 任务异常误标为锁拒绝 | 否 |
| REV2-05 | P3 | `pendingHideSave` 链无拒绝处理 | 否 |
| REV2-06 | P3 | Runner 无 worker 超时 | 否 |
| REV2-07 | P3 | 诊断页 FS 套件绕过协调器 | 否 |
| REV2-08 | P3 | 破坏性测试 API 暴露于 Web 产物 | 否 |
| REV2-09 | P3 | 实施报告计数笔误 | 否 |

**阻断项：无。**