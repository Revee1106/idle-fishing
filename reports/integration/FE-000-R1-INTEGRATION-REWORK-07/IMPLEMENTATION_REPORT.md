# FE-000-R1-INTEGRATION-REWORK-07 实现报告（IMPLEMENTATION_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-07`
- **工作区 / 分支**：`E:\idle-fishing-rework07` / `dev/fe-000-rework07`（基线 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc`）
- **保护边界验证**：58 个受保护后端文件 **58/58 逐字节 0 差异**；294 个未修改跟踪文件（含全部 `REWORK-06` 历史报告与证据）**294/294 逐字节 0 漂移**；`E:\idle-fishing-integration-home` 与 `E:\idle-fishing-evidence-20261127` 全程未动。

---

## 1. 实际修改与纳入文件清单（最小范围）

### 1.1 源码修改（6 个前端平台/启动文件）

| 文件 | 变更内容 | 关联必修项 |
|---|---|---|
| `apps/game-client/assets/scripts/platform/PlatformTypes.ts` | 新增 `StorageProbeOptions`（`shouldCancelBeforeMutation`、`onMutationStarted`）；`StorageProbeResult` 增加可选 `cancelled?: boolean`、`mutated?: boolean`；`FilePort.probeStorage` 接受可选 `options?: StorageProbeOptions`（完全向后兼容）。 | 必修二（R5-03） |
| `apps/game-client/assets/scripts/platform/BrowserFilePort.ts` | `probeIndexedDbAsync` 在 `openDb('__probe__')` 前及返回后立即复检 `shouldCancelBeforeMutation()`（与首次 `idbWriteStringKey` 之间零 `await` 间隙）；合法启动写前同步触发 `onMutationStarted()` 并标记 `mutated: true`；读回异常或值不匹配时仍执行 `idbDeleteKey` 清理避免遗留孤儿 `__probe__`；`probeLocalStorageSync` 与 `MemoryFilePort.probeStorage` 同步支持取消选项。 | 必修二（R5-03） |
| `apps/game-client/assets/scripts/platform/WeChatFilePort.ts` | `UnavailableFilePort.probeStorage` 与 `WeChatFilePort.probeStorage` 支持 `StorageProbeOptions`；在 `ensureRootDir` 即将执行 `mkdirSync` 前检查取消，避免已销毁所有者创建目录。 | 必修二（R5-03） |
| `apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts` | `probeStorage(options)` 透传 `StorageProbeOptions` 并在无内部探针时响应取消检查。 | 必修二（R5-03） |
| `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` | **R5-02**：移除固定 2KB 合成探针 `EMPTY_DOMAIN_WRITE_PROBE_PATH`（`save_slot_write_probe.tmp`）与 `executeEmptyDomainWriteVerification`；`SafeLoadOptions` 新增 `initialCommitState?: Readonly<SpikeGameState> | null`；新增 `executeSafeInitialSaveCommit` 复用 `SpikeFileSaveRepository.commit(initialState, null)`、回读校验、`persistMonotonicHistoryMeta` 及 `SharedTxMarker` 协议；无合法 `initialCommitState` 或写仍失败时保持 `STORAGE_UNAVAILABLE`（`WRITE_CAPABILITY_UNAVAILABLE`）并保留冻结标记。<br>**R5-03**：`SafeSaveLoadResult` 的 `CANCELLED` 分支新增 `persistentMutationOccurred?: boolean`；`loadSafe` 与 `recoverFromCorruptTxMarker` 向 `probeStorage` 透传 `shouldCancelBeforeMutation` 与 `onMutationStarted` 并跟踪 `probeMutationOccurred`；写前取消返回 `persistentMutationOccurred: false`（0 副作用），探针已启动后销毁则中止后续业务变更并如实返回 `persistentMutationOccurred: true`；`commit()` 同步透传 `shouldCancelBeforeStart` 至 `probeStorage`。 | 必修一（R5-02）、必修二（R5-03） |
| `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | **R5-02**：提取 `createDefaultInitialState()`，新增 `pendingInitialCommitState`（仅当 `expectedRev === null` 首次建档写入返回 `STORAGE_UNAVAILABLE`/`UNCERTAIN` 时记录本次真实待保存状态，成功恢复或 `onDestroy` 时清空）；`triggerUserRecovery('STANDARD')` 传入 `initialCommitState: this.pendingInitialCommitState ?? this.createDefaultInitialState()`。<br>**R5-03**：`loadRes.kind === 'CANCELLED'` 严格按 `mutationStarted || loadRes.persistentMutationOccurred === true` 区分 `COMPLETED_AFTER_DESTROY` 与 `CANCELLED_DESTROYED`，绝不将已执行 `put`/`delete` 的任务记为 `CANCELLED_DESTROYED`；已销毁组件永不重新激活。 | 必修一（R5-02）、必修二（R5-03） |

### 1.2 测试与夹具变更（3 个文件）

| 文件 | 变更内容 | 关联必修项 |
|---|---|---|
| `reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json` | 从历史归档 `E:\idle-fishing-evidence-20261127\src\integration\reports\integration\FE-000-R1-INTEGRATION\evidence\legacy-358b111-saves.json` 逐字节原样纳入（169,730 字节，SHA-256 `21c750c5c52701d29183c64fe9965798140b18cf4df4c69c32ddb2d3159e0258`），未做任何内容改动。 | 必修三 |
| `tests/frontend/fe-000/platform-and-core.test.ts` | 升级原 R5-02 空盘用例以验证无 `initialCommitState` 不解冻；新增 2 项 REWORK-07 正式回归用例（`[NODE/REWORK-07/R5-02-EMPTY-CAPACITY-COUNTEREXAMPLE]`、`[NODE/REWORK-07/R5-03-PRE-PROBE-CANCELLATION-BOUNDARY]`），总计 **35 项**（保留原 33 + 新增 2）。 | 必修一、必修二 |
| `tests/frontend/fe-000/verify-web-build.mjs` | 在 `IDB_HELPERS_EXPR` 补充只读 `readHistoryState`；保留原全部 37 项断言不动，新增 2 项真实 Chrome E2E 断言（`web_rework07_r5_02_initial_save_quota_ui_recovery`、`web_rework07_r5_03_probe_write_cancellation_chrome`），总计 **39 项**。 | 必修一、必修二 |

---

## 2. 必修一（R5-02）技术实现细节

1. **根因消除**：删除 `EMPTY_DOMAIN_WRITE_PROBE_PATH = 'save_slot_write_probe.tmp'` 固定 2KB 探针逻辑，彻底杜绝“小探针成功但真实存档写不进去却返回 `EMPTY` 并清标解冻”的虚假恢复路径。
2. **真实初始存档持久化验证**：
   - 在已确认空盘首次建档写故障冻结（`res.kind === 'EMPTY'`、`knownConfirmedFloor === null`、`existingMarker.priorSaveHistory === 'CONFIRMED_EMPTY_INITIAL_CREATE'` 且 `requiresWriteVerification === true`）时，`loadSafe()` 检查 `options.initialCommitState` 并调用后端共享的 `validateSpikeState()` 校验合法性。
   - **无合法 `initialCommitState`**：在触发 `onMutationStarted()` 之前直接返回 `STORAGE_UNAVAILABLE`（`recoveryClassification: 'WRITE_CAPABILITY_UNAVAILABLE'`），零磁盘写入、保留 `FROZEN` 事务标记、绝不返回 `EMPTY`。
   - **具备合法 `initialCommitState`**：调用 `executeSafeInitialSaveCommit()`：先写 `PENDING` 标记 → 复用 `SpikeFileSaveRepository.commit(initialState, null)` 执行正式三槽写入与回读校验 → 写单调 `SaveHistoryMeta`（`confirmedRevision: '1'`）→ 清除 `SharedTxMarker` → 标记 `AVAILABLE` 并返回 `{ kind: 'VALID', revision: '1', raw: initialState, ... }`。
   - **真实写入仍失败**：写回 `FROZEN`（或 `UNCERTAIN`）标记并保留 `requiresWriteVerification: true`，保持冻结状态。
3. **不变量保护**：
   - 不凭空构造业务收益，不推进游戏时间，不重复结算。
   - 若磁盘存在 `VALID` 存档或历史版本下限（`knownConfirmedFloor !== null`），完全走既有 `R5-01` 单调下限保护与 `R5-02` 有效旧档检查点逻辑（`executeSafeCheckpointCommit`），`initialCommitState` 绝不会被使用，不会覆盖旧档。
   - 正常空盘首次创建、旧版本 `CONFLICT`、确定性写前失败（`PRE_WRITE_ERROR`）语义 100% 保持不变。

---

## 3. 必修二（R5-03）技术实现细节

1. **零 `await` 间隙的首次探针写前取消检查**：
   - `SingleWriterSaveCoordinator.loadSafe()` 与 `recoverFromCorruptTxMarker()` 在获取进程内队列与 W3C Web Lock 后，将 `{ shouldCancelBeforeMutation, onMutationStarted }` 透传至 `this.port.probeStorage(options)`。
   - `BrowserFilePort.probeIndexedDbAsync()` 先在 `openDb('__probe__')` 前检查一次取消；待 `const db = await this.openDb('__probe__')` 返回后，**立即同步复检 `options?.shouldCancelBeforeMutation?.()`**，其后与 `probeMutationStarted = true; options?.onMutationStarted?.(); idbWriteStringKey(db, probeKey, '1')` 之间**不存在任何 `await` 窗口**。
   - 若在 `openDb` 异步等待期间 `BootEntry` 已销毁，直接返回 `{ available: false, cancelled: true, mutated: false }`，保证 IndexedDB **0 次 `put`、0 次 `delete`**，业务槽位、事务标记、历史元数据全部零变更。
2. **已启动探针写的清理与如实记录**：
   - 一旦 `idbWriteStringKey` 合法启动（`onMutationStarted()` 已同步触发），即便随后所有者销毁或 `idbReadStringKey` 抛错/回读不一致，只要 `writeSucceeded === true` 就会在清理阶段执行 `idbDeleteKey` 删除 `__probe__`，杜绝孤儿键残留。
   - 探针完成后若检测到所有者已销毁，`SingleWriterSaveCoordinator` 立即中止而不触碰任何业务槽位/事务标记/历史元数据，并返回 `{ kind: 'CANCELLED', persistentMutationOccurred: true }`。
   - `BootEntry.triggerUserRecovery` 仅在 `!mutationStarted && loadRes.persistentMutationOccurred !== true` 时记录 `CANCELLED_DESTROYED`；若探针或业务持久化已合法启动，则如实记录 `COMPLETED_AFTER_DESTROY`（成功收尾）或 `FAILED`（发生异常/探针失败），且已销毁组件永不重新激活。

---

## 4. 必修三（缺失测试夹具与路径依赖审计）

1. **缺失夹具定位与纳入**：
   - 依据 Astra `evidence/legacy-fixture.json` 及基线 `test:frontend` 失败日志，确认缺失文件为 `reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json`。
   - 核验历史归档原件 `E:\idle-fishing-evidence-20261127\src\integration\reports\integration\FE-000-R1-INTEGRATION\evidence\legacy-358b111-saves.json`，SHA-256 为 `21c750c5c52701d29183c64fe9965798140b18cf4df4c69c32ddb2d3159e0258`（169,730 字节），与 Astra 记录完全一致。
   - 已原样复制纳入 REWORK-07 候选并计入 `FILES-REWORK.sha256`（不被 `.gitignore` 忽略）。
2. **全仓测试与构建脚本路径依赖审计**：
   - 扫描 `tests/`、`apps/game-client/scripts/`、`apps/game-client/assets/` 与 `reports/backend/BE-000-R1/evidence/pre/`：
     - `platform-and-core.test.ts:1512` 处的 `\\?\E:\idle-fishing-integration\...` 仅为传给 `safe-path-guard.mjs` 验证拒绝规则的纯字符串字面量，无磁盘读取。
     - `verify-web-build.mjs:43` 的默认 `--out-dir` 仅在未传参时生效，传 `--out-dir=` 时完全独立。
     - 未发现任何其他指向历史归档目录、未跟踪文件、被忽略文件或公司绝对路径的测试输入依赖。
   - 在独立临时目录导出候选全部文件（不含 `node_modules` / `build` / `.compiled`，不接触历史归档）执行 `npm ci && npm run build:cocos && npm --prefix apps/game-client run test:frontend`，结果 **35/35 PASS**。
