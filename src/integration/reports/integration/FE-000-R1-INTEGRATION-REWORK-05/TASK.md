# FE-000-R1-INTEGRATION-REWORK-05 存档恢复闭环定向整改任务基线（TASK）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-05`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **整改日期**：2026-11-27
- **上游审核依据**：DeepSeek 4.1 Flash 1017 `FE-000-R1-INTEGRATION-REWORK-04` 定向独立复验报告（`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-04-DEEPSEEK\`），结论为 `REWORK`
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（仅表示开发方完成本轮恢复闭环整改与全量回归，**不代表独立复审通过，不代表 `GATE-01` 已批准**）

---

## 1. 整改前核验记录（基线与哈希）

| 核验项 | 核验对象 | 实测结果 |
|---|---|---|
| DeepSeek REWORK-04 审核交付 | `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-04-DEEPSEEK\EVIDENCE_MANIFEST.sha256` | **54/54 原始字节 SHA-256 匹配（0 失败）** |
| REWORK-04 开发交付（整改前） | `reports/integration/FE-000-R1-INTEGRATION-REWORK-04/FILES-REWORK.sha256` | **64/64 原始字节 SHA-256 匹配（0 失败）** |
| 历史报告零漂移 | `INTEGRATION`（48/48）、`REWORK-01`（29/29）、`REWORK-02`（41/41）、`REWORK-03`（32/32）、`REWORK-04`（28/28 `reports/` 条目） | **0 漂移**；`reports/frontend/` 无改动 |
| 重点审计证据读取 | `DESIGN_ISSUES.md`、`REVIEW_REPORT.md`、`CODE_REVIEW.md`、`TEST_VERIFICATION.md`、`evidence/a02-engine.json`、`evidence/a02-app.json`、`evidence/r4-wechat-marker.test.ts` | 已完整读取 |

---

## 2. 固定工作区与 Git 基线（精确表述，对应 REV4-05）

| 项 | 实测值 |
|---|---|
| 唯一修改工作区 | `E:\idle-fishing-integration` |
| 分支 | `integration/fe-000-be-r1` |
| `HEAD`（前端基准） | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| `MERGE_HEAD`（后端目标） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355` |
| `merge-base` | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 暂存区状态（相对 `HEAD`） | 本轮及历次集成整改的前端改动均保留在工作树（未暂存）；相对 `HEAD`，暂存区（Index）仅包含 **58 个受保护后端文件**，无前端变更暂存 |
| 58 个后端受保护文件完整性 | `git diff --cached 5bcc9ac` 与 `git diff 5bcc9ac` 对全部 58 个后端文件均为 **0 字节差异** |
| Git 纪律 | 未执行 `commit`、`push`、`merge main`、`reset`、`clean`、`stash` 或 `merge --abort`；未启动 `BE-001` / `FE-001` |

---

## 3. 本轮定向整改范围（严格限定）

1. **必修 `REV4-01`（P1）**：防止存档异常消失或版本回退后被 `loadSafe()` 静默清标解冻（保留有效历史证据，不以 `expectedRevision=null` 一律推断空盘，不实现删除存档/强制开新档）。
2. **必修 `REV4-02`（P1）**：在现有 Spike UI 中增加最小可用的存储异常界面及用户显式触发的“重新检测并恢复存档”动作，与保存队列严格串行化，正确处理重复点击、恢复期间 HIDE/SHOW 交错与恢复期间销毁，且不在 `__SPIKE_HARNESS__` 暴露破坏性诊断接口。
3. **同步收口 `REV4-03`（P2）**：严格区分“标记读取 IO 失败（`TX_STATE_UNREADABLE`）”、“标记可读但内容损坏（`TX_STATE_CORRUPT`）”与“有效但未确认标记（`PENDING_RECOVERY_REQUIRED`）”；对损坏标记提供带独立用户确认且在锁内重校标记与盘面摘要的受控恢复动作（不删槽、空盘/IO 错误禁止）；微信端 `writeTxState` 增加写入回读校验以拦截截断写入。
4. **同步收口 `REV4-04`（P2）**：保留对 `QUOTA_EXCEEDED` 等真实存储失败的保守冻结方案，玩家释放空间/恢复权限后通过正式 UI 恢复入口重新读取最新持久化版本并解冻，在 UI 与报告中明确玩家影响与恢复路径。
5. **P3 收口（`REV4-05` / `REV4-06` / `REV4-07` / `REV4-08`）**：修正本轮报告精确措辞（不改历史报告）；归档 `REV4-06`（后台标签页完整诊断并发 `NOT_RUN`）；将微信事务标记 7 项 Mock 定向测试及恢复边界测试纳入正式回归并明确区分 `[MOCK-WX]` 与真实微信环境。
6. **既有能力保护**：完整保留 A01 双标签页唯一提交、A02 跨标签页持久化冻结、A03–A10、P2 浏览器存储回退与遗留实验存档只读检测策略、既有 20 项 Node 测试与 31 项 Web 断言（0 删除、0 弱化）。
