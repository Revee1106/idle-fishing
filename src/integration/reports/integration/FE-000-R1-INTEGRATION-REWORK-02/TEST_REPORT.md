# FE-000-R1-INTEGRATION-REWORK-02 测试与验证报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **执行环境**：Windows 11 x64、Node.js `v24.20.0`、Cocos Creator `3.8.8`、Google Chrome `158`（Headless CDP）
- **固定集成基线**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2` + `MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`

## 1. 完整回归验证总览

| 序号 | 验证类别 | 执行命令 | 退出码 | 实测结果 | 独立日志文件 |
|---:|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | `0` | **82/82 PASS** + `9 .mjs + 9 .d.mts` + `typecheck:cocos` | `logs/r2-backend-verify.log` |
| 2 | 后端 24h 性能回归 | `npm run test:perf` | `0` | **PASS**（24h 连续 `57.17 ms`、`600s` `69.109 ms`、`60s` `78.571 ms`、`budget64` `65.858 ms`，5/5 一致，SHA256 `0be078f13066...`） | `logs/r2-backend-perf.log` |
| 3 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | `0` | **PASS**（0 错误） | `logs/r2-typecheck-cocos.log` |
| 4 | 后端审前反例 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | `0` | **8/8 PASS** | `logs/r2-review-a1-a8.log` |
| 5 | 前端 TypeScript 检查 | `npm --prefix apps/game-client run typecheck` | `0` | **PASS**（0 错误） | `logs/r2-frontend-typecheck.log` |
| 6 | 前端 Node 自动化测试 | `npm --prefix apps/game-client run test:frontend` | `0` | **15/15 PASS**（`total=15 pass=15 fail=0 skip=0 todo=0 containerFail=0 procErr=0`） | `logs/r2-frontend-tests.log` |
| 7 | Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | `0` | **PASS**（36 文件，`2053.15 KB`，清旧后全新构建） | `logs/r2-build-web.log`、`evidence/web-rework02-build-manifest.json` |
| 8 | 真实 Chrome Web E2E（含双标签页） | `npm --prefix apps/game-client run verify:web` | `0` | **28/28 PASS**（含 P1-01/P1-02/P2-04 全部新断言，console error=0、pageerror=0） | `logs/r2-verify-web.log`、`evidence/web-rework02/r1-green-web-results.json` |
| 9 | Cocos 微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | `0` | **PASS**（41 文件，`1964.61 KB`，主包 `1962.07 KB`，分包 `spike-pack` 7 文件 `2.54 KB`） | `logs/r2-build-wechat.log` |
| 10 | 微信构建产物静态审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs apps/game-client/build/wechatgame reports/integration/FE-000-R1-INTEGRATION-REWORK-02/evidence/wechat-rework02-audit.json` | `0` | **10/10 PASS**（`game.js`、`project.config.json`、`game.json`、`settings.json` 与 `subpackages/spike-pack` 全项校验通过） | `logs/r2-verify-wechat.log`、`evidence/wechat-rework02-audit.json` |

## 2. P1-03 & P2-05 专项独立 CLI 复现矩阵（19 组）

每组均通过真实子进程直接运行 `tests/frontend/fe-000/run-node-tests.mjs` 并保留完整标准输出/错误日志：

| 序号 | 夹具 / 场景 | 预期退出码 | 实际退出码 | 实际摘要输出 | 日志文件 |
|---:|---|---:|---:|---|---|
| 01 | 空测试文件（0 用例） | `1` | `1` | `total=0 pass=0 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-01-empty.log` |
| 02 | 全部 `skip` | `1` | `1` | `total=1 pass=0 fail=0 skip=1 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-02-skipped.log` |
| 03 | 全部 `todo` | `1` | `1` | `total=1 pass=0 fail=0 skip=0 todo=1 containerFail=0 procErr=0` | `logs/r2-p1-03-03-todo.log` |
| 04 | 父 `test()` 内仅含 `skip` 子测试（N4 关键反例） | `1` | `1` | `total=1 pass=0 fail=0 skip=1 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-04-parent-only-skip.log` |
| 05 | 父 `test()` 内仅含 `todo` 子测试（N4 关键反例） | `1` | `1` | `total=1 pass=0 fail=0 skip=0 todo=1 containerFail=0 procErr=0` | `logs/r2-p1-03-05-parent-only-todo.log` |
| 06 | 父 `test()` 内含 1 个真实 `pass` 子测试 | `0` | `0` | `total=1 pass=1 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-06-parent-one-pass.log` |
| 07 | 3 层深嵌套（`describe` → `test` → `t.test` → `t.test`） | `0` | `0` | `total=2 pass=2 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-07-deep-nested.log` |
| 08 | 多文件混合嵌套（含 `pass`/`fail`/`skip`/`todo`） | `1` | `1` | `total=7 pass=3 fail=2 skip=1 todo=1 containerFail=0 procErr=0` | `logs/r2-p1-03-08-multi-file-nested.log` |
| 09 | 多用例全部失败 | `1` | `1` | `total=2 pass=0 fail=2 skip=0 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-09-multi-fail.log` |
| 10 | 混合 `pass`+`fail`+`skip`+`todo` | `1` | `1` | `total=4 pass=1 fail=1 skip=1 todo=1 containerFail=0 procErr=0` | `logs/r2-p1-03-10-mixed-fail.log` |
| 11 | 顶层模块加载异常崩溃（N5） | `1` | `1` | `total=0 pass=0 fail=0 skip=0 todo=0 containerFail=1 procErr=0` | `logs/r2-p1-03-11-load-crash.log` |
| 12 | 模块内调用 `process.exit(0)` 绕过（N5 关键反例） | `1` | `1` | `total=0 pass=0 fail=0 skip=0 todo=0 containerFail=0 procErr=1`（缺失完成哨兵） | `logs/r2-p1-03-12-early-exit.log` |
| 13 | 异步未捕获异常 `uncaughtException`（N5） | `1` | `1` | `total=0 pass=0 fail=0 skip=0 todo=0 containerFail=0 procErr=1` | `logs/r2-p1-03-13-uncaught.log` |
| 14 | 进程信号异常终止 `SIGTERM`（N5） | `1` | `1` | `total=0 pass=0 fail=0 skip=0 todo=0 containerFail=0 procErr=1` | `logs/r2-p1-03-14-terminated.log` |
| 15 | 单用例正常通过 | `0` | `0` | `total=1 pass=1 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-15-passed.log` |
| 16 | 1 `pass` + 1 `skip` 混合通过 | `0` | `0` | `total=2 pass=1 fail=0 skip=1 todo=0 containerFail=0 procErr=0` | `logs/r2-p1-03-16-mixed-pass-skip.log` |
| 17 | 空 `--files=` 参数 | `1` | `1` | `FAIL: 0 test files specified.` | `logs/r2-p1-03-17-no-files.log` |
| 18 | 不存在的测试文件路径 | `1` | `1` | `FAIL: Missing required test file` | `logs/r2-p1-03-18-missing-file.log` |
| 19 | 非法 `--out-dir=../../reports`（P2-05 / N6） | `1` | `1` | `[SafePathGuard:OUTSIDE_ALLOWLIST]` 拒绝并零删除 | `logs/r2-p2-05-unsafe-outdir.log` |

## 3. 真实 Chrome Web E2E 新增/核心断言结果（28/28 PASS）

- **`web_p1_01_runtime_failure_freeze_and_recovery`**：`PASS` — 运行中存储探针失败返回 `STORAGE_UNAVAILABLE`，底层恢复后在未显式 `reinitializePersistence()` 前持续保持冻结（`stayedFrozenBeforeReinit=true`、`slotsStillRev1=true`）；显式 `reinitializePersistence()` 恢复 `rev=1` 并成功提交 `rev=2`；物理写 IO 异常触发 `writeIoHealth=STORAGE_UNAVAILABLE`。
- **`web_p1_02_destroy_cancels_queued_before_write`**：`PASS` — 推进至 `rev=8` 后持锁期间排队两个任务（seq 9 进入 coordinator 队列，seq 10 进入 BootEntry 队列），触发 `onDestroy()` 后两项均为 `taskState=CANCELLED`、`resultKind=SKIPPED_DESTROYED`，磁盘最高版本严格维持 `8`（`diskMaxRevAfterDestroy=8`），销毁后新提交被拒绝（`rejectedAfterDestroy=true`）。
- **`web_p1_02_destroy_started_completes_cleanly`**：`PASS` — 任务进入 `STARTED` 物理写入后触发 `onDestroy()`，在途写完成至 `rev=9`（`diskMaxRev=9`、`taskState=COMMITTED`），后续新请求被拒绝（`rejectedSecond=true`）。
- **`web_p2_04_compat_save_cross_tab_commit`**：`PASS` — 真实 Chrome 158 双标签页（同源 Tab A / Tab B）：
  - 并发竞态：`raceA=COMMITTED (rev=1)`、`raceB=CONFLICT`，Tab A 整页重载与 Tab B 重读均精确匹配 Tab A 候选快照（`reloadedMatch=true`）；
  - 跨标签页交替推进：`seqRev2="2"`、`seqRev3="3"`；
  - Web Locks 拒绝 fail-closed：`lockRejectKind="STORAGE_UNAVAILABLE"`、`persistenceHalted=true`；
  - 持锁 Tab B 异常关闭（`Target.closeTarget`）后 Chrome 自动释放 Web Lock，Tab A 恢复并提交 `postTabCrashRev="4"`，整页重载 `reloadedRev4="4"` 一致。
- **其余 24 项集成与 UI/核心回归**：全部 `PASS`（含 BE-000 1h/8h/24h 金标哈希一致、`web_t10_local_bundle_loaded`、`web_zero_console_errors=0`、`web_zero_uncaught_exceptions=0` 及 4 张实机 Web 截图保存在 `evidence/web-rework02/`）。

## 4. 宿主环境分层验证矩阵（诚实标注边界）

| 验证层级 | 验证内容 | 状态 | 备注 |
|---|---|---|---|
| **Tier 1：Node.js 纯共享核心** | `npm run verify`（82/82）、`test:perf`、`review-pre`（A1–A8） | `PASS` | 与 `5bcc9ac` 0 漂移 |
| **Tier 2：Node.js 前端平台与守卫** | `test:frontend`（15/15）+ 19 组 P1-03/P2-05 CLI | `PASS` | 含真实 Windows Junction 防删验证 |
| **Tier 3：Cocos Web 真实构建产物（单页）** | `build:web` + Chrome 158 CDP（27 项单页/生命周期/故障/UI/24h） | `PASS` | `console error=0`、`pageerror=0` |
| **Tier 4：Cocos Web 同源双标签页并发** | Chrome 158 同源 Tab A/B Web Locks 竞态/重载/崩溃恢复 | `PASS` | 真实多标签页实测 |
| **Tier 5：Cocos 微信小游戏构建产物静态审计** | `build:wechat` + `verify-wechat-build.mjs`（10/10） | `PASS` | 主包/分包结构、配置、资产路径已验 |
| **Tier 6：微信开发者工具 / 真机 / 真实激励广告** | 真机 `wx.getFileSystemManager`、`wx.onHide/onShow` 杀进程、分包运行期加载、真实广告位 | `BLOCKED` | 当前环境未安装/未登录微信开发者工具与真机测试账号，已如实记录待 `GATE-01` 实机补测 |
