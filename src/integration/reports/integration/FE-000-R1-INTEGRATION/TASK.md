# FE-000-R1-INTEGRATION 任务依据（TASK）

## 1. 任务目标与定位
- **任务编号**：`FE-000-R1-INTEGRATION`（前端共享核心升级与兼容性验证）
- **所属阶段**：`BE-000 / FE-000` 基础技术验证集成阶段（非 `FE-001` 业务开发，不实现正式游戏功能）
- **核心原则**：
  - 所有核心业务规则仅存在于后端共享核心 `packages/game-core/`（已复审版本 `5bcc9ac`），前端不复制或重写后端算法。
  - 在独立工作区 `E:\idle-fishing-integration` 与独立集成分支 `integration/fe-000-be-r1` 上执行集成，保持原有 4 个工作区（`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review`）完全只读不变。
  - 使用 `git merge --no-ff --no-commit 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355` 保留候选集成状态（**不提交、不推送、不合并 `main`**），交由独立审核方复核。

## 2. 固定基线与版本锁定
| 项目 | 固定值 |
|---|---|
| 远程仓库 | `https://github.com/Revee1106/idle-fishing.git` |
| `main` | `2106ce19d991ec47555cdbf207454c36d8cd104a` |
| 前后端共同祖先（`merge-base`） | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 前端起点提交（`HEAD`） | `be62996fae44df24094331d670f6f0ab3741a4f2`（`feature/fe-000`） |
| 后端目标提交（`MERGE_HEAD`） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（`r1/be-000`，含 `BE-000-R1` 与 `BE-000-R1-P2`） |
| 独立集成工作区与分支 | `E:\idle-fishing-integration` / `integration/fe-000-be-r1` |

## 3. 阶段划分与交付范围
1. **第一阶段（旧版前端基线验证）**：在 `be62996` 上实测 `npm ci`、`build:cocos`、`typecheck`、`test:frontend`、`build:web`、`verify:web`、`build:wechat`、`verify:wechat`，保留旧证据不覆盖，并采集 `358b111` 历史实验存档样本。
2. **第二阶段（后端集成）**：校验共同祖先与零重叠修改，执行 `git merge --no-ff --no-commit 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`。
3. **第三阶段（共享模块接入）**：验证 Node ESM（9 `.js` + 9 `.d.ts`）与 Cocos ESM（9 `.mjs` + 9 `.d.mts`）产物、`npm run typecheck:cocos` 与完整前端 `typecheck`，确保无旧缓存或跨工作区链接。
4. **第四阶段（新版后端行为兼容性）**：验证 8 种存档加载/提交状态（含 `UNCERTAIN` 冻结、未知槽 0 写入、冲突/混 epoch/`UNSUPPORTED` 隔离、`attemptLock.fightMs` 校验）、离线 `settledUntilMs` / 溢出 / `allowanceMs > 0` / 拒绝自定义夹具、实验性 `FIGHTING`/`PREPARING` 迁移，以及真实 `358b111` 历史 v2 存档在 `5bcc9ac` 上的加载与推进。
5. **第五阶段（黄金向量同步）**：以 `5bcc9ac` 为权威更新前端向量，严格区分状态规范 JSON SHA-256、Envelope 内部 `sha256` 字段与 Envelope 全文 SHA-256，保留新旧变更证据链。
6. **第六阶段（FE-000-R1 整改成果保护）**：完整回归 `I01–I06` 与 `V01–V03`。
7. **第七阶段（完整集成回归与交付）**：执行全套后端与前端构建/验证命令，生成 `reports/integration/FE-000-R1-INTEGRATION/` 全部交付报告、日志、证据与 `FILES.sha256`，停止工作等待独立审核。

## 4. 缺失材料说明
- 家庭电脑生成的 `BE-000-R1` 及 `P2` 独立复审原件尚未同步到公司电脑 `E:\idle-fishing-review`。本任务仅采用负责人通报的阶段性结论作为接入前提，未伪造或补写历史审核原件。
- `docs/interfaces/` 中 `v0.3-draft` 仅作当前技术实验参考，未视为已批准正式契约，亦未修改任何 `docs/`、`packages/contracts/`、`config/` 文件。
