# FE-000-R1-INTEGRATION-REWORK-08 任务说明（TASK）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-08`
- **任务定位**：首次建档跨刷新恢复定点整改（仅修复 `R5-02` 状态选择错误，禁止重新设计存档架构或扩大范围）
- **前置复审结论**：GPT-6.2 Astra High 完成 `REWORK-07` 独立复验，结论为 `REWORK`。`R5-01`、`R5-03`、已有有效存档恢复、首次建档 2304/2552 配额验证及旧档夹具均已关闭；仅剩 1 项 P2 阻塞项（`R5-02`：首次保存失败后页面刷新导致原待保存状态丢失，恢复按钮错误使用 `createDefaultInitialState()` 替代并报告 `RECOVERED_VALID`）。
- **冻结候选基线**：
  - 候选分支：`candidate/fe-000-rework07`
  - 完整 SHA：`8458cb34362cf3a207eed963355cdfcd6ba36ea7`（父提交 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc`）
  - 最新 Astra 审核目录：`E:\idle-fishing-astra-review-20261127\FE-000-R1-INTEGRATION-REWORK-07-ASTRA\`
  - 原冻结工作区：`E:\idle-fishing-rework07`（全程只读未改动）
- **本轮开发工作区与分支**：
  - 工作区：`E:\idle-fishing-rework08`
  - 分支：`dev/fe-000-rework08`（自 `8458cb34362cf3a207eed963355cdfcd6ba36ea7` 创建）

---

## 1. 整改前基线核验结果

| 核验项 | 预期 | 实测结果 | 状态 |
|---|---|---|---|
| REWORK-07 冻结候选身份（`candidate/fe-000-rework07`） | `8458cb34362cf3a207eed963355cdfcd6ba36ea7` | 完全一致，父提交 `dda015c...`，原工作区干净 | PASS |
| REWORK-07 开发交付清单（`FILES-REWORK.sha256`） | 60/60 匹配 | 60/60 匹配（0 失败） | PASS |
| Astra REWORK-07 审核清单（`EVIDENCE_MANIFEST.sha256`） | 90/90 匹配 | 90/90 匹配（0 失败） | PASS |
| 58 个受保护后端文件（相对 `merge-base 358b111`） | 58/58 零差异 | 58/58 逐字节匹配 `5bcc9ac` | PASS |
| Astra 原始复现证据（`refresh-ui.mjs` / `refresh-ui.log` / `refresh-repeat.log`） | 完整可读 | 已审阅并在本轮独立复现 `BEFORE_RC=1` | PASS |

---

## 2. 本轮唯一必修项与明确边界

- **唯一必修项**：修复首次建档写失败后跨页面刷新时的恢复状态选择逻辑：
  - **A. 原待保存状态仍可用**：继续使用原始、合法、与当前待确认事务匹配的 `pendingInitialCommitState` 通过现有三槽提交、回读与单调历史协议完成恢复，不得重置金币或游标。
  - **B. 原待保存状态不可获得或无法验证**：继续保持冻结，保留事务标记与历史证据，返回明确分类 `INITIAL_COMMIT_STATE_UNAVAILABLE`；绝不以 `createDefaultInitialState()` 替代、不写入默认 revision 1、不清除事务标记、不报告 `RECOVERED_VALID`、不隐藏恢复界面，且重复点击与再次刷新均无法绕过冻结。
  - **C. 正常首次建档**：无未确认故障历史的新存档域继续正常使用默认初始状态进入游戏并首次保存。
  - **D. 已有有效存档**：维持已独立关闭的恢复检查点流程不变。
- **明确不做**：不新增待保存状态持久化日志、不建新数据库/事务框架、不加云端备份、不加强制清档或放弃进度重开功能、不扩展业务功能；不合并 `main`，不启动 `BE-001` / `FE-001`，不批准 `GATE-01`，本轮跳过 DeepSeek。
