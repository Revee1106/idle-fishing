# FE-000-R1-INTEGRATION-REWORK-06 最终存档恢复安全不变量整改任务基线（TASK）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-06`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **整改日期**：2026-11-27
- **上游审核依据**：GPT-6.2 Astra High `FE-000-R1-INTEGRATION-REWORK-05` 最终独立技术复审报告（`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-05-ASTRA\`），结论为 `REWORK`
- **下一阶段复审路径**：本轮完成后直接提交 GPT-6.2 Astra High 定向独立复审（项目负责人决策跳过 DeepSeek）
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（仅表示开发方完成三项安全不变量闭环整改与全量回归，**不代表独立复审通过，不代表 `GATE-01` 已批准**）

---

## 1. 整改前核验记录（基线、哈希与历史零漂移）

| 核验项 | 核验对象 | 实测结果 |
|---|---|---|
| REWORK-05 开发交付（整改前） | `reports/integration/FE-000-R1-INTEGRATION-REWORK-05/FILES-REWORK.sha256` | **67/67 原始字节 SHA-256 匹配（0 失败）** |
| Astra REWORK-05 最终独立复审交付 | `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-05-ASTRA\EVIDENCE_MANIFEST.sha256` | **68/68 原始字节 SHA-256 匹配（0 失败）** |
| DeepSeek REWORK-04 独立复验交付 | `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-04-DEEPSEEK\EVIDENCE_MANIFEST.sha256` | **54/54 原始字节 SHA-256 匹配（0 失败）** |
| 历史报告零漂移 | `INTEGRATION`、`REWORK-01`、`REWORK-02`、`REWORK-03`、`REWORK-04`、`REWORK-05` 及 `reports/frontend/` | **0 漂移**（全部历史报告与清单保持原样） |
| 上游审核交付完整读取 | `REVIEW_REPORT.md`、`CODE_REVIEW.md`、`DESIGN_ISSUES.md`、`ACCEPTANCE_CHECKLIST.md`、`TEST_VERIFICATION.md`、`HISTORICAL_CLOSURE_CHECK.md`、`evidence/astra-history.mjs`、`evidence/history.log`、`evidence/astra-ui-ordered.mjs`、`evidence/astra-ui-ordered.json`、`evidence/race.mjs`、`evidence/race-A.log` | 已完整读取并在整改前完成三项反例真实复现 |

---

## 2. 固定工作区与 Git 基线

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

## 3. 本轮定向整改范围（三项安全不变量闭环）

1. **必修 `R5-01`（P1）：已确认存档版本单调保护**
   - 维护存储域持久化单调已确认版本元数据（`SaveHistoryMeta`：`__save_history__` / `__save_history__.json` / `MemoryFilePort` / 自定义端口域键），纳入现有互斥锁与提交确认边界；元数据确认失败绝不返回虚假 `COMMITTED`。
   - 部分 IO 故障期间冻结标记与恢复判定均使用域内已知最高已确认版本下限，绝不降级为较低的可读备份版本；正常恢复低于已确认版本下限时保持冻结并仅暴露只读备份，禁止旧状态重新占用已确认版本。
   - 严格区分最高已确认版本、当前可读最高版本、未确认目标版本与历史未知状态；旧版/损坏/不可读元数据保守 fail-closed；不修改后端 `SaveEnvelope` 或三槽存档协议。
2. **必修 `R5-02`（P2）：恢复成功必须具有真实写入能力**
   - 区分“存档读取成功”、“存档写入能力恢复”与“应用完整恢复”；`QUOTA_EXCEEDED` / `WRITE_IO_ERROR` 等真实写入故障产生的冻结标记持久化记录 `requiresWriteVerification: true`。
   - 采用方案 A：对已验证 `VALID` 存档通过现有三槽协议与回读确认执行一次**零业务收益、零时间推进**的安全恢复检查点提交（使用完全一致的已验证持久化状态，按现有协议生成新 revision 并在报告明确记录）；对已确认 `EMPTY` 首次建档冻结执行真实槽位路径写回读删探针（`save_slot_write_probe.tmp`）。
   - 真实槽位写入仍失败时返回 `WRITE_CAPABILITY_UNAVAILABLE` 并保留只读备份信息与冻结状态，绝不提前宣称 `RECOVERED_VALID`。
3. **必修 `R5-03`（P2）：恢复任务所有者与生命周期**
   - 覆盖 `STANDARD`（`loadSafe`）与 `CONFIRM_CORRUPT_MARKER`（`recoverFromCorruptTxMarker`）两种恢复入口。
   - 排队前、获取进程内队列与 Web Lock 后（任何 probe/读盘之前）、以及真正开始可能改变事务标记/历史元数据/存档槽的操作前（零 `await` 间隙）均使用不受 Cocos `_destroyImmediate()` 字段清空影响的生命周期标记（`WeakSet<BootEntry>`）检查所有者。
   - 尚未开始持久化副作用即销毁的任务严格返回 `CANCELLED` / `CANCELLED_DESTROYED` 且原标记与三槽零修改；已合法开始持久化副作用后销毁的任务允许安全完成并如实记录 `COMPLETED_AFTER_DESTROY`（绝不伪装为 `CANCELLED_DESTROYED`），且已销毁组件永不被异步回调重新激活。
4. **既有能力保护与范围红线**
   - 完整保留 A01–A10、REV4-01–08 全部既有能力与回归覆盖，不修改 58 个受保护后端文件、不重构三槽协议、不引入通用事务框架、不修改历史报告，诚实保留微信开发者工具/真机/真实广告 `BLOCKED / NOT_RUN`。
