# FE-000-R1-INTEGRATION-REWORK-02 测试核验记录（TEST_VERIFICATION）

- **审核方**：独立前端代码审核人员（DeepSeek 4.1 Flash 1017）
- **执行环境**：Windows 10.0.19045 x64；Node **v24.20.0**；TypeScript 5.9.3；Chrome **158.0.8127.37**（headless CDP）；Cocos Creator 3.8.8
- **隔离快照**：`C:\Users\WANGWENJIE10\AppData\Local\Temp\fe000-r2-snap`（候选工作区完整副本，独立 `node_modules`；所有构建/测试/临时文件均在此执行）
- **被审核工作区**：仅新增本审核交付目录，未修改任何候选文件
- **结论**：所有独立回归与独立构造测试满足预期；**PASS**

## 1. 证据核验（第一阶段）

| 核验项 | 方法 | 结果 | 证据 |
|---|---|---|---|
| 分支/HEAD/MERGE_HEAD/merge-base | `git rev-parse`、读取 worktree `MERGE_HEAD` | 与任务书完全一致 | `evidence/sha-baseline-verification.log` |
| 58 个受保护后端文件 | `git diff 5bcc9ac -- <protected paths>`（工作树）与 `--cached`（Index） | **0 差异**（双向） | 同上 |
| 暂存内容纯净性 | `git diff --cached --name-only` | 58 个文件，无 `apps/game-client`/`tests/frontend` | 同上 |
| 74 项 SHA-256 清单 | Node 逐条重算原始字节 | **74/74 匹配**，0 缺失 0 不匹配 | `evidence/git-baseline.txt`、本文件 §1.1 |
| 历史报告/证据漂移 | 重算 `REWORK-01`（29 个 reports 条目）与 `INTEGRATION`（48 个 reports 条目） | **0 漂移** | 本文件 §1.1 |
| 测试报告引用日志存在性 | 列目录 + 逐日志头解析 | 29/29 存在，均含 COMMAND/EXIT_CODE/DURATION_MS | `evidence/*` 与开发方 `logs/` |
| 日志与命令/退出码一致 | 逐条比对 TEST_REPORT 表格 + 审核方在快照重跑 | 一致（详见 §3） | `evidence/audit-*.log` |
| 清单覆盖度 | 对比 `git diff`+untracked 与清单 | 全部候选相关文件均被覆盖（清单文件自身合理自排除） | `evidence/manifest-coverage.mjs` |

### 1.1 哈希复核数字

- `FILES-REWORK.sha256`：74 行 → 源码/测试/夹具/报告/证据 45 项 + 日志 29 项，全部匹配。
- REWORK-01 清单：48 个非注释条目（29 个 reports 条目 + 19 个源码/测试条目）；其中 8 个源码/测试条目与本轮新版不一致属**预期**（本轮继续修改），reports 条目 **0 漂移**。
- INTEGRATION 清单：54 个条目；4 个源码/测试条目被本轮修改属预期，48 个 reports 条目 **0 漂移**。

## 2. 独立回归（第四阶段，全部使用本轮实际源码）

| # | 类别 | 命令（快照内执行） | 退出码 | 独立实测摘要 | 证据 |
|---:|---|---|---:|---|---|
| 1 | 后端全量 | `npm run verify` | 0 | 82/82 PASS；9 `.mjs` + 9 `.d.mts`；COCOS-02 发射校验 PASS | `evidence/audit-backend-verify.log` |
| 2 | 后端性能 | `npm run test:perf` | 0 | 5/5 checks true；24h nodes=14935；envelope SHA-256 `0be078f1…ae69f` | `evidence/audit-backend-perf.log` |
| 3 | 后端 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | 8/8 PASS | `evidence/audit-a1-a8.log` |
| 4 | 前端类型 | `npm --prefix apps/game-client run typecheck` | 0 | 0 错误 | `evidence/audit-fe-typecheck.log` |
| 5 | 前端自动化 | `npm --prefix apps/game-client run test:frontend` | 0 | `total=15 pass=15 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `evidence/audit-fe-tests.log` |
| 6 | Web 构建 | `npm --prefix apps/game-client run build:web` | 0 | 36 文件 / 2,053.15 KB（Cocos raw 36，产物校验 PASS） | `evidence/audit-build-web.log` |
| 7 | Web E2E | `npm --prefix apps/game-client run verify:web -- --out-dir=…/audit-verify-web` | 0 | **28/28 PASS**；`web_p1_01_*`/`web_p1_02_*`/`web_p2_04_*` 全部 PASS；console error=0、pageerror=0 | `evidence/audit-verify-web.log` |
| 8 | 微信构建 | `npm --prefix apps/game-client run build:wechat` | 0 | 41 文件 / 1,964.61 KB（主包 + `spike-pack` 分包） | `evidence/audit-build-wechat.log` |
| 9 | 微信产物审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs …` | 0 | **10/10 PASS**（`game.js`、`project.config.json`、`game.json`、`settings.json`、分包入口/配置/图标） | `evidence/audit-verify-wechat.log` |

> 构建产物文件数与字节总量与开发方 `TEST_REPORT.md` 完全一致（2053.15 KB / 1964.61 KB），说明构建可复现。

## 3. P1-01 独立测试矩阵（10 项必测映射）

审核方自建脚本 `evidence/independent-core.mjs`、`evidence/independent-edges.mjs`、`evidence/chrome-boot-unavailable.mjs`。

| 必测项 | 独立用例 | 结果 |
|---|---|---|
| 1. 正常启动后 probe 失败 | core T2（commit 内 probe 失败）；Chrome T13（启动 probe 失败） | PASS：`STORAGE_UNAVAILABLE`，槽位字节不变，0 隐藏写 |
| 2. probe 连续失败 | core T2（连续两次 commit 仍冻结，底层恢复后不重试） | PASS：持续冻结直至显式 `loadSafe()` |
| 3. commit 物理写入失败 | core T3（setItem 对槽键抛错）；Chrome T11 | PASS：`STORAGE_UNAVAILABLE` + 冻结 + 槽位不变 |
| 4. read-back 失败 | core T4（写成功后所有读持续失败） | PASS（契约）：`UNCERTAIN`，后续 0 写；**健康标志不冻结**（观察 REV2-01） |
| 5. 恢复期间再次失败 | core E3（冻结→恢复→再次写失败→再冻结→最终恢复） | PASS：再次冻结，最终 `loadSafe()` 读到 rev1 |
| 6. 恢复后 revision 变化 | core T5（外部写者推进 rev2）；Chrome T12（新实例 rev5） | PASS：恢复读磁盘最新版；旧 expectedRevision → `CONFLICT` |
| 7. `getFileSystemManager` 不存在 | core T8（`wx.__FE000_MOCK__` 但无 fsm） | PASS：仍识别为微信宿主，`STORAGE_UNAVAILABLE` |
| 8. `readFileSync` 不存在 | core T8（逐方法缺失） | PASS：fail-closed，0 写入 |
| 9. `writeFileSync` 不存在 | core T8 | PASS：fail-closed，0 写入 |
| 10. 文件不存在 vs FS 不可用 | core T9（健康 mock 缺文件 → EMPTY/COMMITTED；随后权限错误 → `STORAGE_UNAVAILABLE`） | PASS：语义严格区分 |

附加：E1（部分槽 IO → `VALID recovered` 且提交 `UNCERTAIN` 0 写，REV2-02）、E2（全槽损坏 → `CORRUPT` + commit `FAILED`，不静默首建）、E4（`UnavailableFilePort` fail-closed）。

## 4. P1-02 独立测试矩阵（7 项必测映射）

脚本：`evidence/independent-core.mjs`（T1–T5）、`evidence/chrome-e2e.mjs`（T10）、`evidence/chrome-destroy-bypass.mjs`。

| 必测项 | 独立用例 | 结果 |
|---|---|---|
| 1. QUEUED + onDestroy | core T1（2 个任务等待 `runExclusive` 持锁） | PASS：均 `CANCELLED`，0 读/0 写/0 probe，磁盘 EMPTY |
| 2. STARTED + onDestroy | core T2（`onStarted` 后 barrier 中销毁） | PASS：`COMMITTED rev1` |
| 3. 多个 QUEUED + onDestroy | core T3（5 个排队） | PASS：全部取消；销毁后提交仍取消 |
| 4. onDestroy 后新任务 | Chrome T10/T11（`requestHideSaveForTest` 返回 false） | PASS：入口拒绝 |
| 5. HIDE/SHOW/HIDE + onDestroy | core T5（3 任务） + Chrome T10（真实 HIDE 事件 2 个，一个在 coordinator 队列、一个在 BootEntry 队列） | PASS：两者均 `CANCELLED/SKIPPED_DESTROYED`，磁盘不变 |
| 6. 销毁与 Web Lock 获取交错 | Chrome T10（Tab A 持锁，Tab B 排队后销毁并释放锁） | PASS：取消发生在锁内物理读写之前 |
| 7. 已写但 read-back 未完成时销毁 | core T4（写完成、read-back 阻塞、销毁、释放） | PASS：`COMMITTED`，无误取消 |

## 5. P1-03 独立测试矩阵（运行器）

命令模板：`node tests/frontend/fe-000/run-node-tests.mjs --files=<fixtures> --out-dir=.compiled-r2-audit`（快照内真实子进程）。完整输出：`evidence/runner-matrix.log`。

### 5.1 开发方声明的 19 组（独立重跑）

| # | 场景 | 期望/实际退出码 | 实际摘要 |
|---:|---|---|---|
| 01 | 空文件 | 1 / 1 | `total=0 pass=0 …` |
| 02 | 全 skip | 1 / 1 | `total=1 pass=0 skip=1` |
| 03 | 全 todo | 1 / 1 | `total=1 pass=0 todo=1` |
| 04 | 父测试仅 skip 子项 | 1 / 1 | `total=1 pass=0 skip=1` |
| 05 | 父测试仅 todo 子项 | 1 / 1 | `total=1 pass=0 todo=1` |
| 06 | 父测试含 1 pass 子项 | 0 / 0 | `total=1 pass=1` |
| 07 | 3 层深嵌套 | 0 / 0 | `total=2 pass=2` |
| 08 | 多文件混合嵌套 | 1 / 1 | `total=7 pass=3 fail=2 skip=1 todo=1` |
| 09 | 多失败叶 | 1 / 1 | `total=2 fail=2` |
| 10 | pass+fail+skip+todo | 1 / 1 | `total=4 pass=1 fail=1 skip=1 todo=1` |
| 11 | 模块加载崩溃 | 1 / 1 | `containerFail=1` |
| 12 | 模块加载 `process.exit(0)` | 1 / 1 | `procErr=1`（哨兵缺失） |
| 13 | 未捕获异常 | 1 / 1 | `procErr=1` |
| 14 | SIGTERM | 1 / 1 | `procErr=1` |
| 15 | 单用例通过 | 0 / 0 | `total=1 pass=1` |
| 16 | pass+skip | 0 / 0 | `total=2 pass=1 skip=1` |
| 17 | 空 `--files=` | 1 / 1 | `FAIL: 0 test files specified.` |
| 18 | 不存在文件 | 1 / 1 | `FAIL: Missing required test file` |
| 19 | `--out-dir=../../reports` | 1 / 1 | `SafePathGuard:OUTSIDE_ALLOWLIST`，零删除 |

### 5.2 审核方新增对抗夹具（10 组）

| # | 场景 | 期望/实际退出码 | 实际摘要 |
|---:|---|---|---|
| A1 | 父测试仅 skip+todo | 1 / 1 | `total=2 pass=0 skip=1 todo=1`（父不计 pass） |
| A2 | `describe→describe→test→t.test→t.test` 4 层 | 0 / 0 | `total=2 pass=2` |
| A3 | describe 内仅 skip 叶 | 1 / 1 | `total=1 skip=1` |
| A4 | 空 describe | 1 / 1 | `total=0` |
| A5 | `before` 钩子抛错 | 1 / 1 | `total=1 fail=1` |
| A6 | 父测试子项通过后自身抛错 | 1 / 1 | `pass=1 containerFail=1` |
| A7 | 测试体内 `process.exit(0)`（已有一个用例通过） | 1 / 1 | `procErr=1`，`total=0`（哨兵缺失，非假绿） |
| A8 | 测试体内 `process.exit(1)` | 1 / 1 | `procErr=1` |
| A9 | 正常文件 + 提前退出文件混合 | 1 / 1 | `pass=1 procErr=1` |
| A10 | describe 内 1 pass + 1 fail | 1 / 1 | `total=2 pass=1 fail=1`，`containerFail=0` |

结论：**29/29 退出码与摘要符合预期**；未发现父测试/容器被误计入 `pass` 的路径。

## 6. P2-04 真实 Chrome 双标签页矩阵

脚本：`evidence/chrome-e2e.mjs` 与 `evidence/chrome-boot-unavailable.mjs`；Chrome **158.0.8127.37**，同源 `http://127.0.0.1:<port>/`，每个标签页独立 CDP target。完整输出：`evidence/chrome-e2e.log`。

| # | 必测/附加项 | 结果 |
|---:|---|---|
| 1 | 双标签页同时提交不同候选（Tab A `+60s`/expected=null，Tab B `+180s`/expected=null；A 在锁内 barrier 持锁） | PASS：B 在锁上 pending 700ms 且槽位为空；A `COMMITTED rev1`；B `CONFLICT` |
| 2 | 一个页面先获得锁 | PASS（A 的 `beforeCommitBody` 内 `__A_HELD`） |
| 3 | 一个页面等待锁 | PASS（B eval 的提交 Promise 未 resolve） |
| 4 | 第一个页面提交成功 | PASS：磁盘仅 1 槽 rev1 |
| 5 | 第二个页面重新读取最新 revision | PASS：B `CONFLICT`（"expectedRevision null but a valid slot exists"） |
| 6 | 第二个页面返回 CONFLICT | PASS |
| 7 | 最终存档仅含唯一成功候选 | PASS：重载 A/重读 B 的 revision=1、cursorMs=winner |
| 8 | Web Locks 不可用 | PASS：`STORAGE_UNAVAILABLE`，0 槽写入，`persistenceHalted=true` |
| 9 | 锁请求拒绝 | PASS：同上，0 槽写入 |
| 10 | 页面异常关闭（持锁 Tab C `Target.closeTarget`） | PASS：Chrome 自动释放锁；A 恢复并提交 rev5；重载一致 |
| 11 | 多协调器实例 | PASS：`System.import` 构造的第二个协调器与既有协调器同 `storageKey`，`loadSafe` 被同一锁阻塞 |
| 12 | 页面刷新 | PASS：锁被占用期间 A 重载无法就绪；释放后 boot 完成；T3/T9 重载数据一致 |
| 13 | 快速连续提交 | PASS：同页并发 1 COMMITTED + 1 CONFLICT；跨页 rev3→rev4 严格递增 |
| 14 | 启动阶段 `loadSafe` 锁覆盖（附加） | PASS（T2） |
| 15 | 启动态存储 probe 失败 fail-closed（附加） | PASS：`STORAGE_UNAVAILABLE`，0 隐藏写，槽位不变；探针恢复后重载恢复 rev1 |

## 7. P2-05 路径守卫矩阵

脚本：`evidence/independent-guard.mjs`（全部在快照/系统临时目录执行，金丝雀文件验证零删除）。

| # | 场景 | 结果 |
|---:|---|---|
| 1 | 合法白名单（`.compiled*`、`build/web-mobile`、`build/wechatgame`、`tmp/fe000-r1-chrome-*`） | 通过 |
| 2 | 盘符根/UNC/`\\?\`/仓库根/父目录/apps/packages/tests/reports/docs/config/Desktop/Documents/空/NUL/`..` | 全部拒绝 |
| 3 | 前缀漏洞：`build\web-mobile-evil`、`web-mobile.bak` | 拒绝，金丝雀存活 |
| 4 | `.compiledx`、`.compiled-`、`.compiled.`、`compiled`、`fixtures`、`.compiled/child` | 拒绝 |
| 5 | Windows Junction 指向外部 | `SYMLINK_OR_JUNCTION_REJECTED`，金丝雀存活 |
| 6 | 允许目录内嵌套 Junction | 目录被删，外部金丝雀**存活**（`rmSync` 未穿透） |
| 7 | 文件符号链接（因 Windows 权限无法创建，改为记录跳过） | 记录（同 `lstat` 代码路径已被 Junction 覆盖） |
| 8 | 大小写变体、正斜杠/尾分隔符、相对路径 | 合法项接受，越权项拒绝 |
| 9 | Runner `--out-dir=../../reports` | 删除前拦截，`reports/` 与金丝雀完好 |

## 8. 组合故障矩阵（第三阶段）

| 组合 | 执行 | 结果 |
|---|---|---|
| 1. 存储失败 + HIDE + onDestroy | Chrome T11 | PASS：`STORAGE_UNAVAILABLE` + `persistenceHalted`；销毁后新任务拒绝；无后续写入 |
| 2. 存储恢复 + 旧实例重新提交 | Chrome T12、core T5 | PASS：恢复读磁盘最新；旧 revision `CONFLICT`；新 revision `COMMITTED` |
| 3. 双标签页 + 持锁页面异常关闭 | Chrome T9 | PASS：自动释放；幸存页提交 rev+1；重载一致 |
| 4. Web Lock 获取失败 + 存储健康 | Chrome T6/T7/T6b | PASS：冻结 + 0 写；显式 reinit 恢复 `AVAILABLE` |
| 5. 多文件嵌套 + 模块提前退出 | Runner A9 | PASS：正常叶精确计数，整体 `procErr=1` 退出 1 |
| 6. 非法输出路径 + Junction 逃逸 | Guard T3/T5/T6/T9 | PASS：全部拦截且零删除 |

## 9. 审核过程透明说明（审核方自建脚本的自我修正）

为避免误导，记录审核方在自建脚本中修正过的**测试侧**问题（均非产品缺陷）：
1. Runner 矩阵初版 CASE 19 未传入 `--out-dir=../../reports`（脚本硬编码了合法目录），已单独重测并得到退出码 1；
2. Guard 初版把 `.compiled-evil` 当作应拒绝项，实际它是白名单设计允许的 `.compiled-<id>` 命名，已纠正测试预期；
3. E1 初版仅写 1 个槽，无法构造"部分槽位 IO"场景，改为 2 槽后通过；
4. T10 初版断言 `history.length===1` 未考虑该标签页历史累积，改为校验"最后一条 CANCELLED + 磁盘不变"；
5. T3/T9 初版在后台标签页执行 `Page.reload` 导致脚本执行被节流/未就绪，加入 `Page.bringToFront` 后稳定通过（页面行为本身正常）；
6. Chrome E2E 的 B 标签结果改为页内 `JSON.stringify` 回传，排除 CDP `returnByValue` 的序列化差异。
上述修正只影响审核脚本的观测方式，不涉及被审核代码；最终所有结论均来自真实执行。

## 10. 未覆盖项

- 微信开发者工具、微信真机、真实激励广告位：环境不可用，`BLOCKED`（与开发方一致）。
- 挂起测试的运行时行为：仅做代码审查（无超时，见 REV2-06），未执行会残留子进程的挂起实验。
- Safari/Firefox 的 Web Locks 行为：未测。
- 真实网络/多设备并发：按契约 P0 不承诺。