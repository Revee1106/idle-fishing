# FE-000-R1-INTEGRATION-REWORK-08 实现报告（IMPLEMENTATION_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-08`
- **工作区 / 分支**：`E:\idle-fishing-rework08` / `dev/fe-000-rework08`（基线 `8458cb34362cf3a207eed963355cdfcd6ba36ea7`）
- **最小范围边界**：全仓仅修改 **2 个源码文件** + **2 个测试文件**；58 个受保护后端文件 **58/58 逐字节 0 差异**；351 个未修改跟踪文件 **351/351 逐字节 0 漂移**；原 REWORK-07 冻结工作区与历史审核证据全程未动。

---

## 1. 实际状态选择缺陷定位

在 REWORK-07（`8458cb3`）中：

1. 玩家在空盘首次触发 `HIDE` 保存时，`BootEntry.ts` 调用 `advanceOffline(baseState, baseState.cursorMs + 60_000).state` 生成包含真实推进收益（`gold: '31'`, `cursorMs: 1700000060000`）的待保存状态 `nextState`。
2. 当本次首次写入因配额或 IO 失败时，`SingleWriterSaveCoordinator.commit()` 写入 `FROZEN` 事务标记（`priorSaveHistory: 'CONFIRMED_EMPTY_INITIAL_CREATE'`, `requiresWriteVerification: true`），`BootEntry` 在内存中暂存 `this.pendingInitialCommitState = nextState` 并冻结。
3. **缺陷点**：若玩家在恢复成功前刷新页面，内存中的 `this.pendingInitialCommitState` 丢失为 `null`。刷新后点击恢复按钮时，`BootEntry.ts:661` 执行：
   ```ts
   initialCommitState: this.pendingInitialCommitState ?? this.createDefaultInitialState()
   ```
   使用 `createDefaultInitialState()`（`gold: '0'`, `cursorMs: 1700000000000`）替代了已丢失的原 31 金币待保存状态，导致 `SingleWriterSaveCoordinator` 误将该合法但内容不同的默认状态持久化为 `revision: '1'`、写入历史下限 `'1'`、清除冻结标记并报告 `RECOVERED_VALID`。

---

## 2. 修改前后的状态选择规则对照

| 场景 | 修改前（REWORK-07 `8458cb3`） | 修改后（REWORK-08） |
|---|---|---|
| **A. 首次建档失败，同页恢复（`pendingInitialCommitState` 仍在）** | 使用 `this.pendingInitialCommitState` 走三槽+回读+历史确认，写入原 31 金币 / +60s 游标为 rev 1。 | **保持一致**，且仅当本次 `commit(nextState, null)` 真实触发写失败（`Runtime storage write failure`）或 `UNCERTAIN` 时才绑定 `pendingInitialCommitState`，不误用跨标签页预存冻结下的未送写状态。 |
| **B. 首次建档失败，恢复前刷新（`pendingInitialCommitState === null`）** | 错误回退到 `this.createDefaultInitialState()`，写入 0 金币默认 rev 1，清标并报告 `RECOVERED_VALID`。 | `BootEntry` 仅传入 `initialCommitState: this.pendingInitialCommitState`（即 `null`）；`SingleWriterSaveCoordinator.loadSafe()` 返回 `STORAGE_UNAVAILABLE`（`recoveryClassification: 'INITIAL_COMMIT_STATE_UNAVAILABLE'`），**0 槽位写入、保留事务标记、历史保持 `null`、UI 保持冻结并展示明确说明**；重复点击与再次刷新均无法绕过。 |
| **C. 正常首次启动（空盘、无待恢复事务标记、无历史下限）** | `loadSafe` 返回 `EMPTY`，`BootEntry` 以 `createDefaultInitialState()` 初始化并允许首次 `HIDE` 保存。 | **完全不变**，正常新玩家正常进入游戏并完成首次保存。 |
| **D. 已有有效存档的写入故障恢复** | `loadSafe` 扫描到 `VALID`，执行 `executeSafeCheckpointCommit` 零收益检查点提交。 | **完全不变**，不触碰已独立关闭的检查点逻辑。 |

---

## 3. 实际修改文件清单（共 4 个文件）

| 文件 | 变更摘要 |
|---|---|
| `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` | 在 `RecoveryFailureClassification` 新增 `'INITIAL_COMMIT_STATE_UNAVAILABLE'`；空盘首次建档写故障恢复（`res.kind === 'EMPTY' && needsWriteVerification && existingMarker !== null`）在缺少或无法验证 `initialCommitState` 时返回 `INITIAL_COMMIT_STATE_UNAVAILABLE`，零磁盘写入并保持冻结与事务标记。 |
| `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | 1. `triggerUserRecovery('STANDARD')` 移除 `?? this.createDefaultInitialState()` 回退，仅传递 `initialCommitState: this.pendingInitialCommitState`。<br>2. `enqueueHideSave` 仅当 `expectedRev === null && committed.detail.startsWith('Runtime storage write failure')`（或 `UNCERTAIN`）时绑定 `pendingInitialCommitState`。<br>3. `formatRecoveryOverlayViewModel` 为 `INITIAL_COMMIT_STATE_UNAVAILABLE` 增加如实说明：原未保存初始进度已不可获得或无法验证，不能以默认初始档安全替代，写操作保持冻结。 |
| `tests/frontend/fe-000/platform-and-core.test.ts` | 将既有 4 处缺失/非法 `initialCommitState` 分类断言更新为显式 `'INITIAL_COMMIT_STATE_UNAVAILABLE'`（有合法状态仍写失败继续断言 `'WRITE_CAPABILITY_UNAVAILABLE'`）；新增正式回归用例 `[NODE/REWORK-08/R5-02-CROSS-REFRESH-INITIAL-STATE-UNAVAILABLE]`（总计 **36 项**）。 |
| `tests/frontend/fe-000/verify-web-build.mjs` | 保留原全部 39 项断言不动，新增真实 Chrome 端到端断言 `web_rework08_r5_02_cross_refresh_no_default_substitution`（覆盖场景 1 跨刷新保持冻结+重复点击不绕过、场景 3 二次刷新仍冻结、场景 4 正常新域首次启动与首存；总计 **40 项**）。 |
