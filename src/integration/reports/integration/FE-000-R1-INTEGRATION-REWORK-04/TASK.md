# FE-000-R1-INTEGRATION-REWORK-04 定向整改任务基线（TASK）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-04`
- **执行角色**：前端开发执行工程师（Gemini Neon High）
- **整改日期**：2026-11-27
- **上游审核依据**：DeepSeek 4.1 Flash 1017 第一轮独立技术初审报告（`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\`），结论为 `REWORK`
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（仅表示开发方完成定向整改与全量回归，**不代表独立审核通过，不代表 GATE-01 已批准**）

---

## 1. 审核交付与哈希核验（进入开发前实测）

| 核验对象 | 清单路径 | 结果 |
|---|---|---|
| DeepSeek REWORK-03 审核六件套 + 证据清单 | `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\EVIDENCE_MANIFEST.sha256` | **60/60 原始字节 SHA-256 匹配（0 失败）** |
| REWORK-03 开发方交付清单（整改前基线） | `reports/integration/FE-000-R1-INTEGRATION-REWORK-03/FILES-REWORK.sha256` | **68/68 原始字节 SHA-256 匹配（0 失败）** |
| 历史报告漂移核验 | `FE-000-R1-INTEGRATION`（48 条）、`REWORK-01`（29 条）、`REWORK-02`（41 条）、`REWORK-03`（32 条 `reports/` 条目） | **0 漂移**；`reports/frontend/` 无改动 |

> 核验确认：已读取并仅依据真实的 REWORK-03 DeepSeek 六份审核交付物（`REVIEW_REPORT.md`、`CODE_REVIEW.md`、`DESIGN_ISSUES.md`、`TEST_VERIFICATION.md`、`ACCEPTANCE_CHECKLIST.md`、`EVIDENCE_MANIFEST.sha256`），未误用 REWORK-02 旧附件。

---

## 2. 固定 Git 工作区与受保护基线

| 项 | 实测值 |
|---|---|
| 唯一允许修改工作区 | `E:\idle-fishing-integration` |
| 分支 | `integration/fe-000-be-r1` |
| `HEAD`（前端基准） | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| `MERGE_HEAD`（后端目标，通过 `git rev-parse --git-path MERGE_HEAD` 核验） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355` |
| `merge-base` | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 已暂存后端受保护文件 | **58 个**；工作树与 Index 对 `5bcc9ac` 均 **0 字节差异**；暂存区无任何前端文件 |
| Git 检查点/分支变化 | 无新提交、无推送、无合并、无 reset/clean/stash/merge --abort；完整源码身份与 `HEAD=be62996` + `MERGE_HEAD=5bcc9ac` + 未暂存前端工作区完全一致 |

---

## 3. 本轮定向整改范围（严格限定）

1. **唯一阻塞项 A02（REV3-01，P1）**：关闭跨标签页 `UNCERTAIN` 共享故障冻结绕过漏洞。
   - 在共享持久化介质中引入与存档域（`storageKey`）绑定的持久化写前事务状态标记（`${namespace}:__tx_state__`），与既有 W3C Web Locks 临界区配合，完整满足任务书第 3 节 11 项核心要求及第 4 节 12 项真实 Chrome 专项验收场景。
2. **P2 浏览器存储回退与历史实验存档策略（REV3-02 / REV3-03）**：
   - 真实浏览器缺失 `indexedDB` 时禁止自动回退到 `localStorage` 写入，严格 fail-closed（`BROWSER_STORAGE_UNAVAILABLE` / `STORAGE_UNAVAILABLE`）。
   - 仅保留显式注入的 Node Mock 测试能力（`{ allowLocalStorageMockInNode: true }` 且严格校验 `isNodeTestHost()`），绝不将真实浏览器误判为 Node 测试宿主。
   - 对遗留 `localStorage` 实验存档执行只读检测并明确报告（`DETECTED_IGNORED_NO_AUTO_MIGRATION`），不自动删除、不覆盖、不自动复活、不在本阶段建设完整迁移系统。
3. **A09 组合测试曾挂起记录核对（REV3-04）**：
   - 核对原始证据 `r3-t2-a09.mjs` / `r3-t2-a09.log` / `r3-a09-only.log`，定位原因并如实记录于 `ISSUE_REPORT.md`；不扩大整改范围。
4. **其余 P3 观察项（REV3-05–08）**：原则上归档，不进行无关重构。
5. **严禁越界**：
   - 不修改后端三槽协议、`SaveEnvelope`、公共契约、`packages/`、正式设计文档或根工程配置；
   - 不提前启动 `BE-001` / `FE-001` 正式业务开发；
   - 不覆盖任何历史报告目录；
   - 不降低原有任何 Node 或 Web 回归断言。
