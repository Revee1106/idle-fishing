# FE-000-R1-INTEGRATION-REWORK-03 测试与验证报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **执行环境**：Windows 11 x64、Node.js `v24.20.0`、Cocos Creator `3.8.8`、Google Chrome `158`（Headless CDP）
- **固定集成基线**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2` + `MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`

## 1. 全量回归验证汇总

| 序号 | 验证类别 | 执行命令 | 退出码 | 实测结果 | 独立日志文件 |
|---:|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | `0` | **82/82 PASS** + `9 .mjs + 9 .d.mts` + `typecheck:cocos` | `logs/r3-backend-verify.log` |
| 2 | 后端 24h 性能回归 | `npm run test:perf` | `0` | **PASS**（5/5 一致性检查通过） | `logs/r3-backend-perf.log` |
| 3 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | `0` | **PASS**（0 错误） | `logs/r3-typecheck-cocos.log` |
| 4 | 后端审前反例 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | `0` | **8/8 PASS** | `logs/r3-review-a1-a8.log` |
| 5 | 前端 TypeScript 检查 | `npm --prefix apps/game-client run typecheck` | `0` | **PASS**（0 错误） | `logs/r3-frontend-typecheck.log` |
| 6 | 前端 Node 自动化测试 | `npm --prefix apps/game-client run test:frontend` | `0` | **18/18 PASS**（`total=18 pass=18 fail=0 skip=0 todo=0 containerFail=0 procErr=0`） | `logs/r3-frontend-tests.log` |
| 7 | A07 抛错 TODO（配 1 pass） | `node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/fixture-todo-throws.test.ts --out-dir=.compiled-r3-cli` | `0` | `total=2 pass=1 fail=0 skip=0 todo=1 containerFail=0 procErr=0`（与 Node 24.20.0 原生一致） | `logs/r3-a07-todo-throws.log` |
| 8 | A07 仅抛错 TODO（零通过门禁） | `node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/fixture-only-todo-throws.test.ts --out-dir=.compiled-r3-cli` | `1` | `total=1 pass=0 fail=0 skip=0 todo=1`（正确触发零通过门禁） | `logs/r3-a07-only-todo-throws.log` |
| 9 | A07 挂起 Worker 超时强杀 | `node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/fixture-hanging.test.ts --out-dir=.compiled-r3-cli --worker-timeout-ms=1200` | `1` | `procErr=1`（1200ms 强制 SIGKILL 终止，总耗时 4.4s） | `logs/r3-a07-hanging-timeout.log` |
| 10 | A08 非法输出目录拒绝 | `node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/fixture-passed.test.ts --out-dir=../../reports` | `1` | `[SafePathGuard:OUTSIDE_ALLOWLIST]` 拒绝并零删除 | `logs/r3-a08-unsafe-outdir.log` |
| 11 | Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | `0` | **PASS**（36 文件，`2060.27 KB`，清旧后全新构建） | `logs/r3-build-web.log`、`evidence/web-rework03-build-manifest.json` |
| 12 | Cocos 微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | `0` | **PASS**（清旧后全新构建） | `logs/r3-build-wechat.log` |
| 13 | 微信构建产物静态审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | `0` | **10/10 PASS** | `logs/r3-verify-wechat.log`、`evidence/wechat-rework03-audit.json` |
| 14 | 真实 Chrome Web E2E（第 1 轮） | `npm --prefix apps/game-client run verify:web` | `0` | **28/28 PASS**（含空盘竞争 + 12/12 轮非空交错竞争 0 次双 `COMMITTED`，`console error=0`、`pageerror=0`） | `logs/r3-verify-web-run1.log`、`evidence/web-rework03/r1-green-web-results.json` |
| 15 | 真实 Chrome Web E2E（第 2 轮独立复跑） | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=reports/integration/FE-000-R1-INTEGRATION-REWORK-03/evidence/web-rework03-repeat` | `0` | **28/28 PASS**（独立全新 Chrome Profile 再验 12/12 轮，**两轮合计 24/24 轮 + 2/2 空盘，0 次双 `COMMITTED`**） | `logs/r3-verify-web-run2.log`、`evidence/web-rework03-repeat/r1-green-web-results.json` |

## 2. P0 真实 Chrome 双标签页确定性交错竞争结果摘要

在两个完全独立的 Chrome 158 渲染器标签页（`navigator.locks.query()` 实测不同 `clientId` 分别处于 `held` 与 `pending`）及同一 `IndexedDB`（`idle_fishing_fs_v1`）命名空间下：
- **空盘竞争（`expectedRevision = null -> rev 1`）**：Tab A 获 `COMMITTED (rev=1, slot=0)`，Tab B 获 `CONFLICT`，双方重载读取结果严格一致等于 Tab A 候选（两轮独立运行均 `PASS`）。
- **非空盘 12 轮连续交错竞争（`rev 8 -> rev 20`，复现并关闭 Astra 第 7 轮 `rev 8 -> 9, slot 2` 缺陷）**：
  - Round 0–5：Tab A 在写前屏障持锁，Tab B 提交不同候选（`+180s`）排队于同一 Web Lock；
  - Round 6–11：Tab A 在**物理 IndexedDB 写入完成之后、物理回读之前**暂停持锁（精确复现 `astra-browser.mjs` 屏障），Tab B 排队于同一 Web Lock；
  - **两轮独立 Chrome Profile 实测合计 24/24 轮**：每轮均精确获得 `Tab A = COMMITTED (rev = expected + 1)`、`Tab B = CONFLICT`、**双 `COMMITTED` 次数 = `0`**、双方盘面与读回完全等于 Tab A 候选快照。
- **故障与异常恢复**：
  - `A05` 持锁后任务体抛错：原样抛出 `'audit body real chrome'`，健康状态保持 `AVAILABLE`，未被误标为 `CROSS_TAB_LOCK_REJECTED`；
  - `navigator.locks.request` 拒绝及 `navigator.locks === undefined`：均 fail-closed 返回 `STORAGE_UNAVAILABLE` 并冻结命名空间，零写入；
  - 持锁 Tab B 异常关闭（`Target.closeTarget`）：Chrome 自动释放 Web Lock，Tab A 顺利恢复并提交 `rev=21` 且重读一致。

## 3. 宿主环境分层验证边界（诚实标注）

- **Tier 1–5（Node 共享核心 / Node 平台与守卫 / Chrome 单页 / Chrome 双标签页 / 微信产物静态审计）**：全部实测 `PASS`。
- **Tier 6（微信开发者工具 / 真机运行期存储、生命周期、分包加载与真实广告位）**：因当前本机缺少已登录微信开发者工具、真机与真实广告位资源，仍标记为 **`BLOCKED / NOT_RUN`**，不作为已通过项声明。
- **Windows 独立目录符号链接（`symlink`）**：受 Windows 非管理员 `EPERM` 权限限制未创建独立目录 `symlink`，实际已验证真实 Windows NTFS Junction 及嵌套 Junction 防删；`lstatSync`/`realpathSync` 元数据错误 fail-closed 已通过注入 `EACCES` 实测关闭（`A08`）。
