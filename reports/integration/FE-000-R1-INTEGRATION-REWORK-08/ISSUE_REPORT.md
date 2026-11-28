# FE-000-R1-INTEGRATION-REWORK-08 问题与边界说明（ISSUE_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-08`
- **本轮结果**：REWORK-07 遗留的唯一 P2 阻塞项（`R5-02` 首次保存失败后跨刷新误用默认初始状态恢复）已在开发侧修复并通过双独立 Chrome Profile 实证及全量回归，等待独立复验。

---

## 1. 本轮关闭的问题

| 编号 | 级别 | 问题描述 | 处理与结果 |
|---|---|---|---|
| `R8-01`（原 `R5-02` 跨刷新 P2） | P2 | 首次 HIDE 保存失败（31 金币、游标 +60s）后，在恢复成功前刷新页面导致内存 `pendingInitialCommitState` 丢失，点击正常恢复按钮时 `BootEntry` 回退使用 `createDefaultInitialState()`（0 金币、游标回退 60s）写入 revision 1、清除事务标记并报告 `RECOVERED_VALID`。 | **开发侧已修复待独立复审**：移除恢复路径上的 `?? this.createDefaultInitialState()` 回退，新增显式失败分类 `INITIAL_COMMIT_STATE_UNAVAILABLE`；原待保存状态不可获得时保持冻结、0 槽位写入、保留事务标记与冻结界面、重复点击与二次刷新均不能绕过；同页恢复与正常首次启动完全不受影响。 |

---

## 2. 本轮设计边界说明（按任务明确不扩展范围）

- 内存中的未持久化首次进度在页面刷新后天然无法找回；本轮按任务指令**不实现**待保存状态持久化日志、强制清档、放弃进度重开或新存储框架，仅严格保证系统绝不将丢失未保存进度的情况伪装为 `RECOVERED_VALID` 恢复成功。若后续正式产品需要“用户显式确认放弃未持久化首次进度并重开”交互，需另行立项并由负责人审批。
- Cocos Creator 3.8.8 构建过程中仍会改写跟踪文件 `apps/game-client/settings/v2/packages/engine.json`，本轮构建结束后已将其恢复为冻结基线原字节（`git -c core.autocrlf=false checkout -- apps/game-client/settings/v2/packages/engine.json`），不在候选 diff 中引入编辑器噪音。

---

## 3. 剩余真实平台验收事项（GATE-01 待验证）

以下外部平台事项仍属于 `GATE-01` 待验证范围，本轮未声称通过：

1. 微信开发者工具实际运行态验证（`NOT_RUN / BLOCKED`；本轮仅完成微信构建 + 10 项静态审计 + 8 项 `[MOCK-WX]` 模拟验证）。
2. 微信小游戏真机运行、杀进程冷启动恢复与真机性能预算（`NOT_RUN / BLOCKED`）。
3. 真实微信激励视频广告（`adUnitId`）及真机回调去重（`NOT_RUN / BLOCKED`）。
4. `BE-D01` 正式字节格式与 `A09` 后台全套诊断并发（沿用既定边界）。
5. `GATE-01` 联合准入审批与 `main` 合并（待独立复审通过后由负责人决策）。
