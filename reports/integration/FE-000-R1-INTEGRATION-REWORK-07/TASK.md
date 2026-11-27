# FE-000-R1-INTEGRATION-REWORK-07 任务说明（TASK）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-07`
- **任务性质**：最小范围定向整改任务（不重新设计存档系统，不扩大整改范围）
- **前置复审结论**：GPT-6.2 Astra High 完成 `REWORK-06` 定向独立复审，结论为 `REWORK`；已关闭 `R5-01`、`R5-02`（已有有效存档写入恢复）、`R5-03`（等待 Web Lock 期间销毁）；剩余 2 项 P2 边界问题及 1 项工程交付完整性问题。
- **冻结候选基线**：
  - 候选分支：`origin/candidate/fe-000-rework06`
  - 完整 SHA：`dda015cbc5ae698f3df406ea8ffbdd7f756332bc`
  - 双亲提交：`HEAD^1 = be62996fae44df24094331d670f6f0ab3741a4f2`（`feature/fe-000`），`HEAD^2 = 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（`r1/be-000`）
  - 冻结工作区：`E:\idle-fishing-integration-home`（全程只读未改动）
  - 历史证据工作区：`E:\idle-fishing-evidence-20261127`（`03639ab7511c0399439a63d9a50084c9aaf2600e`，全程只读未改动）
  - 最新 Astra 审核目录：`E:\idle-fishing-astra-review-20261127\FE-000-R1-INTEGRATION-REWORK-06-ASTRA\`
- **本轮独立开发工作区与分支**：
  - 工作区：`E:\idle-fishing-rework07`
  - 分支：`dev/fe-000-rework07`（自 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc` 创建）

---

## 1. 整改前证据核验结果

| 核验项 | 预期 | 实测结果 | 状态 |
|---|---|---|---|
| Astra REWORK-06 审核清单（`EVIDENCE_MANIFEST.sha256`） | 86/86 匹配 | 86/86 匹配（0 失败） | PASS |
| REWORK-06 开发交付清单（`FILES-REWORK.sha256` + 清单自身） | 82/82 + 清单匹配 | `Candidate: 82 plus manifest OK` | PASS |
| 冻结候选完整 SHA 与双亲身份 | `dda015c...` (`be62996...`, `5bcc9ac...`) | 完全一致，工作区干净 | PASS |
| 58 个受保护后端文件（相对 `merge-base 358b111`） | 58/58 零差异 | 58/58 逐字节匹配 `5bcc9ac` | PASS |
| 历史证据归档完整性（`verify-handoff.py`） | 2134 源文件匹配 | `Archive: 2134 source files OK`（2441 跟踪文件，工作区干净） | PASS |

---

## 2. 本轮三项必修范围

1. **必修一（`R5-02` P2 · 空盘首次建档虚假恢复）**：
   - 不再将固定 2KB 合成探针（`save_slot_write_probe.tmp`）成功作为首次建档写入能力已恢复的充分依据。
   - 首次建档写故障后的恢复必须关联正常应用实际需要保存的合法初始状态，复用现有三槽提交、回读校验、单调历史元数据确认及事务标记协议；无合法待保存初始状态或真实写入仍失败时保持冻结（`WRITE_CAPABILITY_UNAVAILABLE`）并保留事务标记。
2. **必修二（`R5-03` P2 · 首次探针写入前的取消检查）**：
   - 复用现有 `RecoveryLifecycleHooks` 与 `WeakSet<BootEntry>` 生命周期标记，将取消检查传递至实际探针持久化操作边界（`openDb('__probe__')` 返回后至首次 `put` 之间零 `await` 间隙）。
   - 未开始持久化修改前取消必须 0 `put` / 0 `delete` 且如实记 `CANCELLED_DESTROYED`；已合法启动探针写后销毁允许完成清理且不得重新激活组件，绝不允许已发生 `put`/`delete` 仍伪装为未执行的 `CANCELLED_DESTROYED`。
3. **必修三（工程交付完整性 · 补齐缺失测试夹具）**：
   - 将历史归档原件 `reports/integration/FE-000-R1-INTEGRATION/evidence/legacy-358b111-saves.json`（SHA-256 `21c750c5c52701d29183c64fe9965798140b18cf4df4c69c32ddb2d3159e0258`，169,730 字节）原样纳入 REWORK-07 候选并计入交付清单，验证干净独立检出环境无需手动复制归档即可通过全量 Node/Mock 测试。

---

## 3. 范围红线与非目标

- 禁止修改 58 个受保护后端文件及已关闭的 `R5-01` 实现。
- 禁止重构三槽存档协议、新增通用存储框架、扩展业务功能或修改历史审核结论与原始证据。
- 禁止弱化既有测试断言、缩减存档尺寸或调整配额规避反例。
- 不启动 `BE-001` / `FE-001`，不自行批准 `GATE-01`，不合并 `main`，本轮跳过 DeepSeek，完成后声明 `READY_FOR_INDEPENDENT_REVIEW` 并停止等待负责人冻结及 GPT-6.2 Astra High 定向复验。
