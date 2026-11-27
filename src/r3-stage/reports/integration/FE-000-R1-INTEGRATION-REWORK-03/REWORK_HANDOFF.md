# FE-000-R1-INTEGRATION-REWORK-03 独立复审交接单

- **交接对象**：负责人（安排 DeepSeek 初审与 GPT-6.2 Astra 独立复审）
- **提交方**：前端开发工程师（Gemini Neon High）
- **当前交接状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **郑重声明**：本状态仅表示开发侧已完成 `REWORK-03` 全部整改与回归验证，**不代表独立审核通过，也不代表准入 `GATE-01`**。本轮未执行提交、推送或合并 `main`。

## 1. 固定工作区与 Git 基线（严格保留未提交合并候选）

- **工作目录**：`E:\idle-fishing-integration`
- **分支**：`integration/fe-000-be-r1`
- **`HEAD`（前端基线）**：`be62996fae44df24094331d670f6f0ab3741a4f2`
- **`MERGE_HEAD`（后端目标）**：`5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`
- **`merge-base`（共同祖先）**：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- **58 个已暂存后端文件**：与 `5bcc9ac` 严格 0 行漂移。
- **历史报告/证据目录**：`reports/frontend/`、`reports/integration/FE-000-R1-INTEGRATION/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-01/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-02/` 全部只读零漂移。
- **其余 4 个工作区**：`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review` 全程零触碰。

## 2. 本轮交付物位置（`reports/integration/FE-000-R1-INTEGRATION-REWORK-03/`）

- 报告：`TASK.md`、`IMPLEMENTATION_REPORT.md`、`TEST_REPORT.md`、`ISSUE_REPORT.md`、`REWORK_HANDOFF.md`
- 完整性清单：`FILES-REWORK.sha256`（完整覆盖所有受管前端源码、测试、守卫、20 个夹具及 REWORK-03 全部报告/日志/证据，自校验 0 失配）
- 日志目录：`logs/`（15 个独立命令日志，含精确退出码与耗时）
- 证据目录：
  - `evidence/web-rework03/`（第 1 轮 28/28 实测 JSON 与 4 张截图）
  - `evidence/web-rework03-repeat/`（第 2 轮独立复跑 28/28 实测 JSON 与 4 张截图）
  - `evidence/web-rework03-build-manifest.json`（36 文件 `2060.27 KB` 构建清单）
  - `evidence/wechat-rework03-audit.json`（微信 10/10 静态审计 JSON）

## 3. 审核方一键复核命令清单

```powershell
Set-Location E:\idle-fishing-integration

# 1. 基线与后端零漂移
git branch --show-current
git rev-parse HEAD MERGE_HEAD
git diff 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355 -- packages/ tests/backend/ reports/backend/ package.json package-lock.json tsconfig*.json docs/ config/

# 2. 后端全量与审前反例 A1-A8
npm run verify
npm run test:perf
npm run typecheck:cocos
node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs

# 3. 前端类型检查与 18 项 Node 自动化测试（含 A02/A03/A05/A07/A08）
npm --prefix apps/game-client run typecheck
npm --prefix apps/game-client run test:frontend

# 4. 真实 Chrome 158 Web E2E（28/28，含生产构建接口审计 + 12 轮双标签页交错竞争）与微信 10/10 静态审计
npm --prefix apps/game-client run verify:web
node tests/frontend/fe-000/verify-wechat-build.mjs apps/game-client/build/wechatgame reports/integration/FE-000-R1-INTEGRATION-REWORK-03/evidence/wechat-rework03-audit.json
```
