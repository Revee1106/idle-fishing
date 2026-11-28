# FE-000-R1-INTEGRATION-REWORK-08 测试验证报告（TEST_REPORT）

- **测试环境**：Windows x64 · Node `v24.20.0` · npm `11.4.2` · TypeScript `5.9.3` · Chrome `158.0.8127.37` · Cocos Creator `3.8.8`
- **测试工作区**：`E:\idle-fishing-rework08`（直接自完整候选 `dev/fe-000-rework08` 验证，未人工补入任何历史测试夹具）

---

## 1. Astra 原始跨刷新反例整改前 / 后实证对照

脚本：`evidence/repro-r502-refresh-ui.mjs`（完全复刻 Astra `refresh-ui.mjs` 的 31 金币 / +60s 游标首存配额失败 → 刷新 → 点击 `BtnRecoverStorage` 流程，并追加验证重复点击及二次刷新）。

| 观测项 | 整改前（REWORK-07 `8458cb3` 构建） | 整改后 Profile A（REWORK-08 构建） | 整改后 Profile B（REWORK-08 构建） |
|---|---|---|---|
| 首次待保存载荷（`pendingGold` / `pendingCursorMs`） | `31` / `1700000060000` | `31` / `1700000060000` | `31` / `1700000060000` |
| 首次刷新后点击恢复结果（`lastRecoveryOutcome`） | `RECOVERED_VALID`（**错误**） | **`FAILED`** | **`FAILED`** |
| 恢复分类（`recoveryClassification`） | `null` | **`INITIAL_COMMIT_STATE_UNAVAILABLE`** | **`INITIAL_COMMIT_STATE_UNAVAILABLE`** |
| `persistenceHalted` / `recoveryOverlayVisible` | `false` / `false` | **`true` / `true`** | **`true` / `true`** |
| 磁盘写入槽位（`savedGold` / `savedCursorMs`） | `0` / `1700000000000`（**默认 rev 1**） | **`null` / `null`（0 槽写入）** | **`null` / `null`（0 槽写入）** |
| 事务标记（`markerAfterFirst === markerBefore`） | `false`（被清除为 `null`） | **`true`（原样保留）** | **`true`（原样保留）** |
| 历史元数据（`rawHistoryFirst`） | `confirmedRevision: "1"` | **`null`** | **`null`** |
| 重复点击恢复按钮（`afterSecondClick`） | 界面已隐藏 | **`halted=true, overlay=true, INITIAL_COMMIT_STATE_UNAVAILABLE, attempts=2, slotCount=0, markerStillMatches=true`** | **`halted=true, overlay=true, INITIAL_COMMIT_STATE_UNAVAILABLE, attempts=2, slotCount=0, markerStillMatches=true`** |
| 二次刷新（`afterSecondReload`） | 启动进入错误 rev 1 | **`halted=true, overlay=true, PENDING_RECOVERY_REQUIRED, slotCount=0, markerStillMatches=true, rawHistory=null`** | **`halted=true, overlay=true, PENDING_RECOVERY_REQUIRED, slotCount=0, markerStillMatches=true, rawHistory=null`** |
| 退出码 & 证据 | `1` (`baseline-repro/r502-refresh-before.log`) | **`0`** (`after-fix-repro/r502-refresh-after-profileA.log`) | **`0`** (`after-fix-repro/r502-refresh-after-profileB.log`) |

---

## 2. 五项专项验收场景覆盖核验

| 场景 | 对应自动化用例 / 实证 | 实测结果 |
|---|---|---|
| 场景 1：首次保存失败，恢复前刷新（31 金币/+60s、保持冻结、不写默认 rev 1、保留标记、不报 `RECOVERED_VALID`、显式原因、重复点击不绕过） | `repro-r502-refresh-ui.mjs`（Profile A & B）+ `web_rework08_r5_02_cross_refresh_no_default_substitution`（×2）+ `[NODE/REWORK-08/R5-02-CROSS-REFRESH-INITIAL-STATE-UNAVAILABLE]` | **PASS** |
| 场景 2：首次保存失败，同页恢复（保留 `pendingInitialCommitState`、解除故障后完整提交 31 金币/+60s 为 rev 1、历史确认、后续 HIDE 提交 rev 2） | `web_rework07_r5_02_initial_save_quota_ui_recovery`（Profile A & B）+ `[NODE/REWORK-08/R5-02-CROSS-REFRESH-INITIAL-STATE-UNAVAILABLE]` | **PASS** |
| 场景 3：首次保存失败后刷新，再次刷新（持续保留冻结与事务标记，不进入默认建档路径） | `repro-r502-refresh-ui.mjs`（Profile A & B）+ `web_rework08_r5_02_cross_refresh_no_default_substitution`（×2）+ Node 新协调器重载断言 | **PASS** |
| 场景 4：正常首次启动（无未确认事务、无历史的新域正常初始化并首次保存 rev 1） | `web_real_visibilitychange_hide_commit` + `web_rework08_r5_02_cross_refresh_no_default_substitution`（`cleanFirstHide`）+ Node 用例 | **PASS** |
| 场景 5：已有有效存档恢复（既有已独立关闭检查点与跨标签页恢复零退化） | `web_rework06_r5_02_app_ui_persistent_quota_recovery_loop`（×2）+ `web_rework06_r5_01_*`（×2）+ `web_rework06_r5_03_*`（×2）+ `web_rework07_r5_03_*`（×2） | **PASS** |

---

## 3. 全量自动化回归汇总

| 序号 | 验证项 | 命令 / 入口 | 退出码 | 实测结果 | 日志 / 证据 |
|---|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | 0 | **82/82 PASS** | `logs/01-backend-verify.log` |
| 2 | 后端 24h 性能与黄金哈希 | `npm run test:perf` | 0 | **5/5 true**，黄金 Envelope `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` | `logs/02-backend-perf.log` |
| 3 | 后端 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | **8/8 PASS** | `logs/03-backend-a1-a8.log` |
| 4 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | 0 | **0 错误** | `logs/04-typecheck-cocos.log` |
| 5 | 前端 TypeScript 类型检查 | `npm --prefix apps/game-client run typecheck` | 0 | **0 错误** | `logs/05-frontend-typecheck.log` |
| 6 | Node/Mock 前端全量测试 | `npm --prefix apps/game-client run test:frontend` | 0 | **36/36 PASS**（保留原 35 + 新增 1，`fail=0, skip=0, todo=0, procErr=0`） | `logs/05b-frontend-node-tests.log` |
| 7 | 全新 Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | 0 | **36 文件 / 2,155,240 字节（2,104.73 KB）** | `logs/06-build-web.log`, `evidence/web-rework08-build-manifest.json` |
| 8 | 全新微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | 0 | **41 文件 / 2,084,105 字节（2,035.26 KB）** | `logs/07-build-wechat.log`, `evidence/wechat-rework08-build-manifest.json` |
| 9 | 微信小游戏 10 项静态审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | 0 | **10/10 PASS** | `logs/08-wechat-audit.log`, `evidence/wechat-rework08-audit.json` |
| 10 | 真实 Chrome Web E2E（Profile A） | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework08` | 0 | **40/40 PASS**（保留原 39 + 新增 1，`consoleErr=0, pageErr=0`，5 截图） | `logs/10-web-e2e-profileA.log`, `evidence/web-rework08/` |
| 11 | 真实 Chrome Web E2E（Profile B） | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework08-repeat` | 0 | **40/40 PASS**（保留原 39 + 新增 1，`consoleErr=0, pageErr=0`，5 截图） | `logs/11-web-e2e-profileB.log`, `evidence/web-rework08-repeat/` |
| 12 | A01 双标签页竞争（Profile A & B） | `node .../r8-isolated-race.mjs profileA / profileB` | 0 / 0 | **PASS × 2**（空盘 + 12/12 轮非空 0 双 `COMMITTED` + 持锁页关闭恢复，5.408s / 5.384s） | `logs/12-race-profileA.log`, `logs/13-race-profileB.log`, `evidence/r8-isolated-race-profileA/B.json` |
