# FE-000-R1-INTEGRATION-REWORK-06 集成验证与回归测试报告（TEST_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-06`
- **执行日期**：2026-11-27
- **执行环境**：Windows x64 / Node `v24.20.0` / Cocos Creator `3.8.8` / Chrome `158.0.8127.37`（headless=new，独立临时 UserDataDir）
- **当前状态声明**：`READY_FOR_INDEPENDENT_REVIEW`（**不代表独立复审通过，不代表 `GATE-01` 已批准**）

---

## 一、全量验证命令与实测结果总览

| 序号 | 验证项 | 执行命令 | 实测结果 | 证据日志 |
|---|---|---|---|---|
| 1 | 后端基线全量验证 | `npm run verify` | **82/82 PASS**（0 fail / 0 skip） | [r6-backend-verify.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-backend-verify.log) |
| 2 | 后端 24h 性能与黄金哈希 | `npm run test:perf` | **5/5 PASS**，黄金 Envelope `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` | [r6-backend-perf.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-backend-perf.log) |
| 3 | 后端独立审计用例 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | **8/8 PASS** | [r6-review-a1-a8.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-review-a1-a8.log) |
| 4 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | **PASS（0 错误）** | [r6-typecheck-cocos.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-typecheck-cocos.log) |
| 5 | 客户端 TypeScript 类型检查 | `npm --prefix apps/game-client run typecheck` | **PASS（0 错误）** | [r6-frontend-typecheck.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-frontend-typecheck.log) |
| 6 | 前端 Node + `[MOCK-WX]` 全量测试 | `npm --prefix apps/game-client run test:frontend` | **33/33 PASS**（保留 29 + 新增 4；`fail=0, skip=0, todo=0, containerFail=0, procErr=0`） | [r6-frontend-tests.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-frontend-tests.log) |
| 7 | 全新 Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | **PASS**（36 文件 / `2,166,166` 字节 / `2,115.40 KB`） | [r6-build-web.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-build-web.log) / [web-rework06-build-manifest.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/web-rework06-build-manifest.json) |
| 8 | 真实 Chrome E2E（独立 Profile 1） | `npm --prefix apps/game-client run verify:web -- --out-dir=.../web-rework06` | **37/37 PASS**（保留 34 + 新增 3；`consoleErr=0, pageErr=0`，5 张截图，端口 `64397`） | [r6-verify-web-run1.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-verify-web-run1.log) / [r1-green-web-results.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/web-rework06/r1-green-web-results.json) |
| 9 | 真实 Chrome E2E（独立 Profile 2） | `npm --prefix apps/game-client run verify:web -- --out-dir=.../web-rework06-repeat` | **37/37 PASS**（`consoleErr=0, pageErr=0`，5 张截图，端口 `50746`） | [r6-verify-web-run2.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-verify-web-run2.log) / [r1-green-web-results.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/web-rework06-repeat/r1-green-web-results.json) |
| 10 | 独立 A01 双标签页竞争隔离复验（Profile A） | `node .../r6-isolated-race.mjs profileA` | **PASS**（49.8s；空盘 1/1 + 非空交错 12/12 + 持锁页异常关闭恢复，0 双 `COMMITTED`） | [r6-isolated-race-profileA.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-isolated-race-profileA.log) / [r6-isolated-race-profileA.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/r6-isolated-race-profileA.json) |
| 11 | 独立 A01 双标签页竞争隔离复验（Profile B） | `node .../r6-isolated-race.mjs profileB` | **PASS**（27.2s；空盘 1/1 + 非空交错 12/12 + 持锁页异常关闭恢复，0 双 `COMMITTED`） | [r6-isolated-race-profileB.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-isolated-race-profileB.log) / [r6-isolated-race-profileB.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/r6-isolated-race-profileB.json) |
| 12 | 三项 Astra 反例整改前/后独立对照 | `repro-r5-01/02-03-before.mjs` vs `verify-r5-01/02-03-after.mjs` | 整改前 **3/3 真实复现缺陷**；整改后 **`R5_01_AFTER_PASS: true`、`R5_02_03_AFTER_PASS: true`** | `evidence/baseline-repro/`、`evidence/after-fix-repro/` |
| 13 | 全新微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | **PASS**（41 文件 / `2,075,503` 字节 / `2,026.86 KB`） | [r6-build-wechat.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-build-wechat.log) |
| 14 | 微信小游戏 10 项静态审计 | `npm --prefix apps/game-client run verify:wechat` | **10/10 PASS**（主包 34 文件 2,024.32 KB；分包 `spike-pack` 7 文件 2.54 KB） | [r6-verify-wechat.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/logs/r6-verify-wechat.log) / [wechat-rework06-audit.json](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/wechat-rework06-audit.json) |
| 15 | 微信开发者工具 / 真机 / 真实激励广告 | — | **`BLOCKED / NOT_RUN`**（本机无真机与真实广告位；Mock 用例绝不替代真实环境） | 见 `ISSUE_REPORT.md` |

---

## 二、三项安全不变量实测详情

### 1. `R5-01`（已确认存档版本单调保护）
- **整改前复现**：[repro-r5-01-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-01-before.log) 实证 `rev=2` 在部分 IO 后生成 `confirmedRevision="1"`，删槽后 `loadSafe()` 接受 `rev=1`，旧状态以 `rev=2` 重新落盘。
- **整改后复验**：[verify-r5-01-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-01-after.log) 实证 `confirmedRevision` 保持 `"2"`，删槽后返回 `REVISION_REGRESSION_PENDING_RECOVERY` + `readOnlyBackup.revision="1"`，旧状态重提交返回 `STORAGE_UNAVAILABLE`（0 槽写）。
- **正式回归覆盖**：
  - `[NODE/REWORK-06/R5-01-CONFIRMED-REVISION-MONOTONIC-GUARD]`（同协调器、新协调器、连续部分/全槽 IO 故障、损坏标记不可绕过下限、历史元数据写失败返回 `UNCERTAIN` 非假 `COMMITTED`、损坏/不可读历史元数据 fail-closed、首次建档、`PRE_WRITE_ERROR`、普通 `CONFLICT`、已确认 `2` 与未确认目标 `3` 区分）；
  - `[MOCK-WX/REWORK-06/R5-01-02-03-WECHAT-INVARIANTS]`（微信 `__save_history__.json` 持久化、过滤 `list()`、部分 IO 删槽拒绝回退、历史元数据截断写回读拦截）；
  - `web_rework06_r5_01_confirmed_revision_monotonic_cross_tab_reload`（两套独立 Chrome Profile 实测同协调器、新协调器、第二标签页、`Page.reload()` 四种维度全绿）。

### 2. `R5-02`（恢复成功必须具有真实写入能力）
- **整改前复现**：[repro-r5-02-03-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.log) 实证配额持续满载时点击 `BtnRecoverStorage` 提前解冻返回 `RECOVERED_VALID`。
- **整改后复验**：[verify-r5-02-03-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.log) 实证配额持续满载时点击 `BtnRecoverStorage` 保持冻结（`WRITE_CAPABILITY_UNAVAILABLE`、`readOnlyBackup.revision="1"`、`overlay=true`）；撤销配额故障后再次点击 `BtnRecoverStorage`，按方案 A 执行零收益恢复检查点提交（`rev="2"`、`gold="31"`、`cursorMs=1700000060000`、`marker=null`）；后续正常 HIDE 成功提交 `rev="3"`（`gold="84"`）。
- **正式回归覆盖**：
  - `[NODE/REWORK-06/R5-02-WRITE-CAPABILITY-CHECKPOINT-RECOVERY]`（有效档持续配额故障与恢复 + 空盘首次建档配额故障与探针清理）；
  - `[MOCK-WX/REV4-08/6-PREWRITE-VS-QUOTA-RECOVERY]`（微信槽写故障持续时保持冻结，解除后经方案 A 检查点恢复）；
  - `web_rework06_r5_02_app_ui_persistent_quota_recovery_loop`（两套独立 Chrome Profile 实机指针点击全绿）。

### 3. `R5-03`（恢复任务所有者与生命周期）
- **整改前复现**：[repro-r5-02-03-before.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/baseline-repro/repro-r5-02-03-before.log) 实证等待 Web Lock 期间销毁 `BootEntry`，释放锁后损坏标记 `{bad` 仍被清除为 `null`，而组件记录却报 `CANCELLED_DESTROYED`。
- **整改后复验**：[verify-r5-02-03-after.log](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/after-fix-repro/verify-r5-02-03-after.log) 实证释放锁后 `{bad` 与三槽 100% 保持原样，且记录 `CANCELLED_DESTROYED`、`halted=true`。
- **正式回归覆盖**：
  - `[NODE/REWORK-06/R5-03-RECOVERY-OWNER-CANCELLATION]` 与 `[MOCK-WX/REWORK-06/R5-01-02-03-WECHAT-INVARIANTS]`（`CONFIRM_CORRUPT_MARKER` 与 `STANDARD` 等锁销毁、读盘后写前销毁、以及 `onMutationStarted()` 后销毁安全完成）；
  - `web_rework06_r5_03_app_ui_recovery_owner_lifecycle`（两套独立 Chrome Profile 实机跨标签页测试：`CONFIRM_CORRUPT_MARKER` 等锁销毁、`STANDARD` 等锁销毁 + 重复点击去重 + HIDE 交错、暂停 `clearTxState` 写中销毁记录 `COMPLETED_AFTER_DESTROY` 且组件不复活、恢复期间抛错隔离且队列可继续恢复）。

---

## 三、Astra 上轮移植 `race.mjs` 超时原因核对与隔离复验结论

- **核对结论**：审阅 `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-05-ASTRA\evidence\race.mjs` 与 `race-A.log` 后确认，该脚本在无 `--disable-background-timer-throttling` / `--disable-renderer-backgrounding` 参数的 headless Chrome 下启动两个完整 Cocos WebGL 标签页，并把 Tab B 置于后台（`A.send('Page.bringToFront')`），随后在无单次 CDP 超时与无 `ws.close` 拒止的串行 `A.eval / B.eval` 中等待后台标签页响应，导致其在无错误输出的情况下被 240s 外部超时终止。
- **隔离复验**：使用与当前实现兼容的独立竞争脚本 [r6-isolated-race.mjs](file:///E:/idle-fishing-integration/reports/integration/FE-000-R1-INTEGRATION-REWORK-06/evidence/r6-isolated-race.mjs)（增加上述后台防节流参数、每轮进度日志、30s 单步 CDP 超时与并发 `Promise.all` 等待），在两套独立 Chrome Profile 上分别完成复验：
  - `profileA`：**49.8s PASS**（空盘 1/1 + 非空 12/12 轮交错竞争 0 双 `COMMITTED` + 持锁页关闭恢复 `rev 20 -> 21`）；
  - `profileB`：**27.2s PASS**（空盘 1/1 + 非空 12/12 轮交错竞争 0 双 `COMMITTED` + 持锁页关闭恢复 `rev 20 -> 21`）。
- 同时 `verify-web-build.mjs` 内既有 `web_p0_dual_tab_empty_and_12_round_interleaved_race` 在两套独立 Chrome Profile 中同样 **2/2 PASS**（合计 4 套独立 Profile 共 **4/4 空盘 + 48/48 非空交错竞争，0 双 `COMMITTED`**）。

---

## 四、24h 性能基线实测对比（两套独立 Chrome Profile）

| Profile | 端口 | 连续单次 (ms) | 分片累计 (ms) | 最大单片 (ms) | rAF 最大帧耗时 (ms) | 黄金 Envelope 一致 |
|---|---|---|---|---|---|---|
| `web-rework06` | `64397` | `156.5` | `138.7` | `3.3` | `50.1` | `true`（`0be078f13066...`） |
| `web-rework06-repeat` | `50746` | `191.2` | `155.4` | `6.3` | `66.7` | `true`（`0be078f13066...`） |

---

## 五、环境分类诚实声明

- **已真实验证**：Node.js 24 纯业务与协议测试、`[MOCK-WX]` 微信适配器定向回归（8 项，含 7 项 `REV4-08` + 1 项 `REWORK-06` 综合）、真实 Cocos Creator 3.8.8 Web 构建与两套独立 Chrome 158 真实 UI 指针/DOM/IndexedDB/Web Locks E2E、两套独立隔离 A01 竞争脚本、真实 Cocos Creator 3.8.8 微信小游戏构建与 10 项静态产物审计。
- **明确未运行（`BLOCKED / NOT_RUN`）**：微信开发者工具真运行、微信小游戏真机运行与物理文件系统持久性/硬件断电测试、微信真实激励视频广告（`T09-REAL-AD`）、A09 后台标签页完整诊断并发（沿用历史已接受非阻塞边界）。
