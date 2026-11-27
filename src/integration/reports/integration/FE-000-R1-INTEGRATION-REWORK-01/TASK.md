# FE-000-R1-INTEGRATION-REWORK-01 整改任务依据（TASK）

## 1. 任务来源与定位
- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-01`
- **触发依据**：Astra 对 `FE-000-R1-INTEGRATION` 候选的独立复审结论为 `REWORK`（审核原件位于只读工作区 `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION\`：`REVIEW_REPORT.md`、`CODE_REVIEW.md`、`TEST_VERIFICATION.md`、`DESIGN_ISSUES.md`、`ACCEPTANCE_CHECKLIST.md`）。
- **整改范围**：仅定向修复复审报告指出的 3 项 P1 阻塞问题（`P1-01`/`F1`、`P1-02`/`F2`、`P1-03`/`F3`）与 1 项 P2 并发阻塞问题（`P2-04`/`F4`），并响应 `F5` 验证流程说明；不扩大范围，不重新设计架构，不启动 `FE-001` 或 `BE-001`。

## 2. 固定工作区与 Git 基线
| 项目 | 固定值 |
|---|---|
| 工作目录 | `E:\idle-fishing-integration` |
| 分支 | `integration/fe-000-be-r1` |
| 固定前端基准（`HEAD`） | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| 固定后端目标（`MERGE_HEAD`） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（58 个后端文件保持合并暂存状态不动） |
| 共同祖先（`merge-base`） | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 严格保护边界 | 原有 4 个工作区只读不改；58 个后端暂存文件零修改/零撤销暂存；不修改 `packages/contracts`、`docs/`、`config/`、根目录锁文件与依赖；不覆写 `reports/frontend/` 与 `reports/integration/FE-000-R1-INTEGRATION/`；不提交、不推送、不合并 `main` |

## 3. 四项定向整改要求
1. **`P1-01`（`F1`）**：修复存储探针失败导致 `BrowserFilePort` 静默降级至空内存 `Map`、从而令 `BootEntry` 将已有有效存档误判为 `EMPTY` 并假报 `COMMITTED` 的数据可靠性缺陷；补齐 `COMPAT-SAVE-BOOT-UNAVAILABLE` 回归测试（Node 与真实 Web）。
2. **`P1-02`（`F2`）**：修复 `BootEntry` 在入队前同步捕获旧状态与旧 `revision`，导致连续 `HIDE -> SHOW -> HIDE` 时第二次保存返回 `CONFLICT` 丢失进度的缺陷；补齐真实 Web 产物 `COMPAT-LIFECYCLE-HIDE-SHOW-HIDE` 与 `UNCERTAIN` 队列停机回归。
3. **`P1-03`（`F3`）**：修复 `tests/frontend/fe-000/run-node-tests.mjs` 将空测试文件或全跳过测试文件误计为 `pass=1` 且退出码 `0` 的假通过缺陷，并补齐完整夹具与含真实 stdout/stderr/退出码的独立回归日志。
4. **`P2-04`（`F4`）**：在不修改受保护后端 `packages/game-core/src/spike/save.ts` 的前提下，按设计文档 11 应用层单写者职责建立统一单写者持久化协调层 `SingleWriterSaveCoordinator`，防止同一运行态、同一命名空间下并发 `commit` 产生双 `COMMITTED` 静默覆盖，并补齐 `COMPAT-SAVE-CONCURRENT-COMMIT` 并发交错回归测试。
