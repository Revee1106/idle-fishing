# FE-000-R1-INTEGRATION-REWORK-07 问题与风险记录（ISSUE_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-07`
- **本轮结论**：3 项必修整改项（`R5-02` P2 空盘虚假恢复、`R5-03` P2 探针首写前取消边界、缺失旧档夹具补齐）已在开发侧闭环并通过全量回归验证，等待独立复审。

---

## 1. 本轮解决的问题清单

| 编号 | 级别 | 问题描述 | 根因 | 处理与验证状态 |
|---|---|---|---|---|
| `R7-01`（原 `R5-02` P2） | P2 | 空盘首次建档在 2304 字节配额下写入 2552 字节有效存档失败后，恢复阶段仍依赖 2KB 固定合成探针返回 `EMPTY` 并清标解冻，导致随后真实写入再次失败。 | `SingleWriterSaveCoordinator.executeEmptyDomainWriteVerification` 使用固定 2KB `save_slot_write_probe.tmp` 作为充分判据，与真实待保存状态脱节。 | **开发侧已修复待独立复审**（删除合成 2KB 探针，改为关联真实合法初始状态走现有三槽+回读+历史元数据+清标协议；Astra 2304/2552 原例及 Chrome UI 实测均通过）。 |
| `R7-02`（原 `R5-03` P2） | P2 | `STANDARD` 与 `CONFIRM_CORRUPT_MARKER` 恢复任务在取得 Web Lock 后、首次探针 `put` 前销毁 `BootEntry`，IndexedDB 仍执行 1 次 `put` 和 1 次 `delete`，任务却记录 `CANCELLED_DESTROYED`。 | `BrowserFilePort.probeIndexedDbAsync` 在 `await this.openDb('__probe__')` 返回后与首次 `idbWriteStringKey` 之间缺少取消检查，且探针写入未与 `RecoveryLifecycleHooks.onMutationStarted` 及结果记录联动。 | **开发侧已修复待独立复审**（透传 `StorageProbeOptions`，在 `openDb` 返回后零 `await` 间隙复检取消；写前取消严格 0 `put`/0 `delete`；已启动探针写后销毁保证清理且如实记 `COMPLETED_AFTER_DESTROY`/`FAILED`；Astra 两条真实 Chrome 原例均 0 写入通过）。 |
| `R7-03`（交付完整性） | 工程交付 | REWORK-06 冻结候选缺少 `reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json`，导致独立检出首次运行 `test:frontend` 为 32/33。 | REWORK-06 归档迁移时将原 `FE-000-R1-INTEGRATION/evidence/` 移入历史归档，未在候选中保留 `platform-and-core.test.ts` 依赖的该夹具。 | **开发侧已修复待独立复审**（逐字节原样纳入经 SHA-256 校验的归档原件并计入交付清单；干净独立检出实测 35/35 PASS）。 |

---

## 2. 本轮发现的非阻塞工程注意事项

1. **Cocos 构建器编辑器缓存副作用**：
   - 执行 `CocosCreator.exe --build` 时，Cocos 3.8.8 会改写跟踪文件 `apps/game-client/settings/v2/packages/engine.json`（与 Astra 在 REWORK-06 `TEST_VERIFICATION.md` 末尾记录的现象一致）。
   - 本轮在构建完成后已将该文件恢复为冻结候选原始字节，保证不在候选 diff 中混入编辑器副作用；同时为本次 Web（36 文件）与微信（41 文件）构建均输出了逐文件 SHA-256 清单（`web-rework07-build-manifest.json`、`wechat-rework07-build-manifest.json`）便于独立复审比对。
2. **前端 `typecheck` 对 Cocos 自动生成声明的依赖**：
   - 干净检出首次执行 `npm --prefix apps/game-client run typecheck` 前需先由 Cocos 构建生成忽略目录 `apps/game-client/temp/declarations/cc.d.ts`（沿用既有 Cocos 3.8.8 工程约定，非代码缺陷）。构建后 `typecheck` 为 0 错误。
3. **Windows `core.autocrlf` 换行符一致性**：
   - 家庭电脑全局 Git 配置为 `core.autocrlf=true`，创建新 worktree 时未修改文件默认检出为 CRLF。为确保 58 个受保护后端文件与 294 个未修改跟踪文件与冻结候选 `dda015c` 保持逐字节 LF 一致，已在完成修改后以 `-c core.autocrlf=false checkout` 对齐全部 294 个未修改文件并验证 294/294 逐字节匹配。

---

## 3. 剩余外部平台验收事项（GATE-01 待验证，沿用既有边界）

以下事项受本机无真实微信小游戏运行/真机/正式广告位环境限制，仍属于 `GATE-01` 外部平台待验证范围，本轮未声称通过：

1. **微信开发者工具实际运行态验证**：`NOT_RUN / BLOCKED`（本轮仅完成微信构建与 10 项静态包体结构审计 + 8 项 Node `[MOCK-WX]` 模拟验证）。
2. **微信小游戏真机运行、杀进程冷启动存档恢复与真机性能预算**：`NOT_RUN / BLOCKED`。
3. **真实微信激励视频广告位（`adUnitId`）全流程与真机回调去重**：`NOT_RUN / BLOCKED`（仅验证 5 场景实验桩）。
4. **`BE-D01` 正式字节格式及 `A09` 后台全套诊断并发**：沿用既有已接受状态（`ACCEPTED_NOT_RUN` / 架构边界）。
5. **`GATE-01` 联合准入审批与 `main` 分支合并**：仍待独立复审通过后由项目负责人决策。
