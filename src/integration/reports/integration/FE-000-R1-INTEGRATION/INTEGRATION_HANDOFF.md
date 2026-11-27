# FE-000-R1-INTEGRATION 独立审核交接说明（INTEGRATION_HANDOFF）

## 1. 交付结论与审核边界
- **最终交付结论**：**`READY_FOR_INDEPENDENT_REVIEW`**
- **权限声明**：本轮为开发方集成与兼容性验证，不具备最终验收权限，不宣布 `GATE-01` 通过；真实微信开发者工具运行、微信真机与真实广告仍明确标为 `BLOCKED`，待后续 `GATE-01` 联合验收。

---

## 2. 候选集成工作区快照信息

| 项目 | 精确值 |
|---|---|
| 集成工作区路径 | `E:\idle-fishing-integration` |
| 集成分支 | `integration/fe-000-be-r1` |
| 当前 `HEAD`（前端基准） | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| 当前 `MERGE_HEAD`（后端目标） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（`git merge --no-ff --no-commit` 状态保留未提交） |
| 前后端共同基线 | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 暂存区变更（`git diff --cached`） | 完整保留合并自 `5bcc9ac` 的 **58** 个后端/根工具链文件（见 `logs/phase2-backend-diff.log`），前端未做任何二次修改 |
| 工作区未暂存变更（`git diff`） | 仅 **6** 个前端集成文件（4 个 `apps/game-client/` + 2 个 `tests/frontend/`） |
| 新增未跟踪目录 | `reports/integration/FE-000-R1-INTEGRATION/`（本套报告、日志、证据与 `FILES.sha256`） |

### 2.1 后端受保护文件零漂移核验命令
审核者可在 `E:\idle-fishing-integration` 执行以下命令直接确认后端已审核代码及根配置零篡改：
```powershell
git -C E:\idle-fishing-integration diff 5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355 -- packages/ tests/backend/ reports/backend/ package.json package-lock.json tsconfig.base.json tsconfig.test.json tsconfig.cocos-consumer.json docs/ config/
```
预期输出为空（`0` 行差异）。

### 2.2 前端自主修改文件清单（仅 6 项）
1. `apps/game-client/assets/scripts/bootstrap/BootEntry.ts`
2. `apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`
3. `apps/game-client/assets/scripts/shared/SharedCoreBridge.ts`
4. `apps/game-client/assets/scripts/ui/OverviewPage.ts`
5. `tests/frontend/fe-000/platform-and-core.test.ts`
6. `tests/frontend/fe-000/verify-web-build.mjs`

---

## 3. 独立审核一键复跑命令（工作目录 `E:\idle-fishing-integration`）

> 环境变量注意：`apps/game-client/scripts/build-cocos.mjs` 实际读取 **`COCOS_CREATOR_EXE`**（默认 `C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`），Chrome 默认读取 `CHROME_EXE` 或标准安装路径。

```powershell
Set-Location E:\idle-fishing-integration

# 1. 后端完整回归（typecheck + build:cocos [9 .mjs + 9 .d.mts] + typecheck:cocos + 82/82 tests）
npm run verify
npm run test:perf
npm run typecheck:cocos
node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs

# 2. 前端类型检查与 Node/Mock/兼容性测试（10/10 PASS）
# 注意：全新干净 worktree 若无 apps/game-client/temp/declarations/cc.d.ts，需先运行一次 build:web
npm --prefix apps/game-client run typecheck
npm --prefix apps/game-client run test:frontend

# 3. 零用例与缺文件硬门禁负向验证（均应退出码 1）
node tests/frontend/fe-000/run-node-tests.mjs --files=
node tests/frontend/fe-000/run-node-tests.mjs --files=missing.test.ts

# 4. Cocos 3.8.8 真实 Web 产物重建与端到端回归（21/21 PASS，不覆盖历史 reports/frontend/FE-000/evidence/）
npm --prefix apps/game-client run build:web
npm --prefix apps/game-client run verify:web

# 5. Cocos 3.8.8 真实微信小游戏产物重建与分包静态审计（10/10 PASS）
npm --prefix apps/game-client run build:wechat
npm --prefix apps/game-client run verify:wechat
```

---

## 4. 证据与清单导航

- `reports/integration/FE-000-R1-INTEGRATION/TASK.md`：任务依据与缺失材料说明
- `reports/integration/FE-000-R1-INTEGRATION/IMPLEMENTATION_REPORT.md`：架构接入、修改明细与三类黄金摘要对照
- `reports/integration/FE-000-R1-INTEGRATION/TEST_REPORT.md`：第一阶段基线 vs 第七阶段集成实测与六级宿主矩阵
- `reports/integration/FE-000-R1-INTEGRATION/ISSUE_REPORT.md`：发现的问题、归属与真实平台阻塞项
- `reports/integration/FE-000-R1-INTEGRATION/FILES.sha256`：本轮前端修改源码、报告、证据与日志的完整 SHA-256 校验清单（口径见文件头：磁盘精确字节，`core.autocrlf=false`，逐文件原始 LF/CRLF 字节）
- `reports/integration/FE-000-R1-INTEGRATION/logs/`：第一、二、三、四、七阶段全部原始命令日志
- `reports/integration/FE-000-R1-INTEGRATION/evidence/`：
  - `phase1-baseline/`：第一阶段旧基线（`be62996`）Web/WeChat 结果与截图副本
  - `legacy-358b111-saves.json` & `legacy-358b111-compat-results.json`：真实 `358b111` 历史 v2 存档样本及在 `5bcc9ac` 上的兼容性实测结果
  - `web-integrated/`：集成后全新 `build/web-mobile` 端到端 21/21 断言 JSON 及 4 张截图
  - `web-build-manifest.json` & `wechat-integrated-audit.json`：全新 Web 与微信小游戏构建产物清单与分包审计

---

## 5. 原有 4 个工作区只读保护核验
- `E:\idle-fishing`（`feature/be-000` @ `2106ce1`）：未触碰。
- `E:\idle-fishing-backend`（`r1/be-000` @ `5bcc9ac`）：只读，工作区干净（`dirty=0`）。
- `E:\idle-fishing-frontend`（`feature/fe-000` @ `be62996`）：只读，工作区干净（`dirty=0`）。
- `E:\idle-fishing-review`（`review/000-r1` @ `2171169`）：只读，未修改或切换。

现停止所有开发与修改操作，保留完整未提交集成候选快照等待独立审核。
