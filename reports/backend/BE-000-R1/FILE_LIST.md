# BE-000-R1 候选文件清单（FILE_LIST）

- 基准：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`（`r1/be-000`）
- 实际候选：R1 期间为未提交工作区，后提交为 `c5718a436fac29dbb9ca39c9499c6e752ab19c04`；P2 收口（`BE-000-R1-P2-CLEANUP`）变更清单见 `IMPLEMENTATION_REPORT.md` 第 7 节与 `FILES-P2.sha256`
- 校验：`FILES.sha256`（可入库文件），`LOGS.sha256`（被 gitignore 的本地证据）
- 未修改：`apps/game-client/`、`tests/frontend/`、`reports/frontend/`、`docs/`、`packages/contracts/`、`config/rules/`、`config/content/`

## A. 源码（5 改）

| 文件 | 变化 |
|---|---|
| `packages/game-core/src/spike/save.ts` | 未知槽禁写、冲突判定、单槽隔离、跨字段校验、`attemptLock` 校验、`resolveUncertainWrite` |
| `packages/game-core/src/spike/offline.ts` | 检查点推进/冻结、FIGHTING 锁定与幂等、夹具拒绝、安全加法 |
| `packages/game-core/src/spike/time.ts` | `safeAddMs`、完成时间溢出保护 |
| `packages/game-core/src/spike/migration.ts` | v1 进行中尝试迁移、锁校验、深拷贝 |
| `packages/game-core/src/spike/types.ts` | `SpikeAttemptLock`、v2 可选 `attemptLock`、v1 实验 `attempt` |

## B. 构建与工具链（4 项）

| 文件 | 变化 | 所有权 |
|---|---|---|
| `packages/game-core/scripts/emit-cocos-mjs.mjs` | 生成 `.d.mts` 并改写说明符 | 后端共享包 |
| `tsconfig.cocos-consumer.json` | 新增严格消费者配置 | 后端维护根工具链 |
| `tsconfig.test.json` | 排除 `cocos-probe` | 后端维护根工具链 |
| `package.json` | 新增 `typecheck:cocos`，`verify` 扩展 | 后端维护根工具链 |

## C. 测试（9 项，6 改 5 新）

| 文件 | 变化 |
|---|---|
| `tests/backend/be-000/save.test.ts` | T05 真实引擎幂等、T07 基线写入数、T04e |
| `tests/backend/be-000/offline.test.ts` | OFF-09 截止前/时/后、OFF-12 夹具拒绝 |
| `tests/backend/be-000/migration.test.ts` | MIG-05/06 进行中迁移 |
| `tests/backend/be-000/cocos-artifact.test.ts` | 期待 9 `.mjs` + 9 `.d.mts` |
| `tests/backend/be-000/fixtures/offline-vectors.json` | 仅检查点/锁语义导致的向量更新 |
| `tests/backend/be-000/r1-regression.test.ts` | 新增 7 项审核反例回归 |
| `tests/backend/be-000/d01-encoding.test.ts` | 新增 3 项 D01 编码/摘要 |
| `tests/backend/be-000/cocos-type-consumer.mts` | 新增严格消费者入口 |
| `tests/backend/be-000/cocos-probe/probe.ts` | 新增可重建 Cocos 探针 |

## D. 交接与报告（3 改 5 新）

| 文件 | 变化 |
|---|---|
| `reports/backend/BE-000/SHARED_MODULE_HANDOFF.md` | R1 行为、严格类型、向量、限制 |
| `reports/backend/DEVELOPMENT_STATUS.md` | R1 状态与门禁 |
| `reports/backend/BE-000-R1/TASK.md` | 任务输入（非本轮编写） |
| `reports/backend/BE-000-R1/IMPLEMENTATION_REPORT.md` | 新增 |
| `reports/backend/BE-000-R1/TEST_REPORT.md` | 新增 |
| `reports/backend/BE-000-R1/ISSUE_REPORT.md` | 新增 |
| `reports/backend/BE-000-R1/FILES.sha256` / `LOGS.sha256` | 新增校验清单 |
| `reports/backend/BE-000-R1/FILE_LIST.md` | 本文件 |
| `reports/backend/BE-000-R1/BE-000-R1-code.patch` | 源码/配置/测试的可审阅补丁（`git apply --check -R` 已验证与工作区一致） |

## E. 证据脚本与旧向量（可入库）

| 文件 | 用途 |
|---|---|
| `reports/backend/BE-000-R1/evidence/make-r1-vectors.mjs` | 新旧向量逐字段比较，只允许法定路径 |
| `reports/backend/BE-000-R1/evidence/vectors/offline-vectors.pre-r1.json` | 旧向量原件 |
| `reports/backend/BE-000-R1/evidence/d01-independent.py` | D01 本地向量 Python 独立复算 |
| `reports/backend/BE-000-R1/evidence/runtime-cocos-r1.mjs` | Node/Cocos 运行对照 |
| `reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 首审 A1–A8 反例 |
| `reports/backend/BE-000-R1/evidence/pre/cocos-type-audit.mts` | 首审严格类型复现 |

## F. 本地日志（已强制入库，校验见 `LOGS.sha256`）

`reports/backend/BE-000-R1/logs/` 下 14 个文件：整改前 `pre-*`、最终 `r1-verify-final.log`、阶段 `r1-verify.log`、性能、Cocos 构建/类型/运行、向量、D01、夹具与审核反例。

本次提交用 `git add -f` 将上述日志纳入版本管理；`r1-cocos-build.out` 中的 `Proxy-Authorization` 已脱敏。根 `.gitignore` 未改，后续新增日志仍默认被忽略。

## G. 未纳入候选

- `packages/game-core/dist/`、`node_modules/`、临时 Cocos 工程（`%TEMP%/idle-fishing-be000-r1-cocos`）、已删除的临时 Chrome 配置目录。
- 任何前端、设计、契约、正式数值文件。