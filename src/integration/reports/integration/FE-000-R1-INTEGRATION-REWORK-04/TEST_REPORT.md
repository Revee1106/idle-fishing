# FE-000-R1-INTEGRATION-REWORK-04 测试报告（TEST_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-04`
- **执行日期**：2026-11-27
- **实测环境**：Windows 10 x64 / Node `v24.20.0` / TypeScript `5.9.3` / Cocos Creator `3.8.8` / Chrome `158.0.8127.37`（headless CDP）
- **测试范围**：完整后端与契约回归 + 前端类型与 Node 自动化回归 + 全新 Cocos Web / 微信小游戏双平台构建验证 + **两轮独立 Chrome Profile 真实浏览器 E2E 回归（每轮 31/31 断言）**

---

## 1. 全量回归总览

| # | 验证项 | 命令 | 退出码 | 实测结果 | 日志 / 证据 |
|---:|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | 0 | **82/82 PASS**（含 `9 .mjs + 9 .d.mts` 与 `typecheck:cocos`） | `logs/r4-backend-verify.log` |
| 2 | 后端 24h 性能与黄金哈希 | `npm run test:perf` | 0 | **5/5 一致**；envelope SHA-256 `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` | `logs/r4-backend-perf.log` |
| 3 | A1–A8 历史反例 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | **8/8 PASS** | `logs/r4-review-a1-a8.log` |
| 4 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | 0 | **0 错误** | `logs/r4-typecheck-cocos.log` |
| 5 | 前端 TypeScript 类型检查 | `npm --prefix apps/game-client run typecheck` | 0 | **0 错误** | `logs/r4-frontend-typecheck.log` |
| 6 | 前端 Node 自动化测试 | `npm --prefix apps/game-client run test:frontend` | 0 | **20/20 PASS**（`total=20 pass=20 fail=0 skip=0 todo=0 containerFail=0 procErr=0`） | `logs/r4-frontend-tests.log` |
| 7 | 全新 Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | 0 | **36 文件 / 2,124,709 字节（2,074.91 KB）** | `logs/r4-build-web.log`、`evidence/web-rework04-build-manifest.json` |
| 8 | 全新微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | 0 | **41 文件 / 2,034,046 字节（1,986.37 KB）** | `logs/r4-build-wechat.log` |
| 9 | 微信构建产物与分包审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | 0 | **10/10 PASS**（主包 34 文件 / 1,983.84 KB；分包 `spike-pack` 7 文件 / 2.54 KB） | `logs/r4-verify-wechat.log`、`evidence/wechat-rework04-audit.json` |
| 10 | 真实 Chrome 158 Web E2E — **Profile 1** | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework04` | 0 | **31/31 PASS**（端口 `58848`，12 轮竞争 `doubleCommitted=0`，consoleErr=0，pageErr=0） | `logs/r4-verify-web-run1.log`、`evidence/web-rework04/r1-green-web-results.json` + 4 张截图 |
| 11 | 真实 Chrome 158 Web E2E — **Profile 2（独立重复）** | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework04-repeat` | 0 | **31/31 PASS**（端口 `59786`，473.7s，12 轮竞争 `doubleCommitted=0`，consoleErr=0，pageErr=0） | `logs/r4-verify-web-run2.log`、`evidence/web-rework04-repeat/r1-green-web-results.json` + 4 张截图 |

---

## 2. 真实 Chrome 158 专项验收矩阵（任务书第 4 节 12 项 + P2 + A01 回归）

全部 12 项 A02 场景 + P2 策略 + A01 竞争均在两套全新独立 Chrome 158 Profile 中针对**真实生产 Web 构建产物**逐一执行并两次全绿：

| 场景 | 任务书要求 | 对应断言 | Profile 1 & Profile 2 实测结果 |
|---|---|---|---|
| A02-1 | A 返回 `UNCERTAIN` 后，B 直接提交被拒绝 | `web_rework04_a02_app_hide_cross_tab_freeze_and_lifecycle` | **PASS ×2**：`bDirectBefore.kind='STORAGE_UNAVAILABLE'`，`writeCount=0`，盘面保持 `rev=1` |
| A02-2 | A 返回 `UNCERTAIN` 后，B 正常 HIDE 保存被拒绝 | `web_rework04_a02_app_hide_cross_tab_freeze_and_lifecycle` | **PASS ×2**：Tab A 经真实 `visibilitychange` HIDE 得 `UNCERTAIN`/halt，Tab B 经真实 `visibilitychange` HIDE 得 `STORAGE_UNAVAILABLE`/halt，盘面 0 写入 |
| A02-3 | A 关闭、刷新或销毁后，B 仍不能绕过待确认状态 | `web_rework04_a02_app_hide_cross_tab_freeze_and_lifecycle` | **PASS ×2**：依次验证 Tab A `boot.destroy()` → `Page.reload()`（Tab A 保持 `STORAGE_UNAVAILABLE` 且 `__tx_state__` 保留）→ `Target.closeTarget()`，三次 Tab B 直接提交均 `STORAGE_UNAVAILABLE`、`writeCount=0`、`slotsUnchangedThroughAllBlocks=true` |
| A02-4 | 待确认标记写入失败时，零存档写入 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc4`) | **PASS ×2**：`IDBObjectStore.prototype.put` 对 `:__tx_state__` 抛 `QuotaExceededError` → `STORAGE_UNAVAILABLE`（`SHARED_TX_MARKER_WRITE_FAILED`）、`slotWriteCalls=0`、`slotsIdentical=true` |
| A02-5 | 待确认标记写入成功后、实际存档写入前页面崩溃 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc5And12`) | **PASS ×2**：Tab 在 `port.write` 入口挂起并由 `Target.closeTarget` 强杀 → 盘面留存 `state='PENDING'` → Observer Tab 提交得 `STORAGE_UNAVAILABLE` → 显式 `loadSafe()` 恢复 `VALID rev=1` 并清标 |
| A02-6 | 已写盘但回读未完成时页面崩溃 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc6And10And11`) | **PASS ×2**：Tab 写盘 `rev=2` 后在回读 `port.read` 前由 `Target.closeTarget` 强杀 → Observer Tab 未恢复提交得 `STORAGE_UNAVAILABLE` → 显式 `loadSafe()` 发现并验证 `VALID rev=2` |
| A02-7 | 存档提交成功但事务标记清理失败 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc7_8_9`, `sc7SecondTab`) | **PASS ×2**：`rev=4` 写盘并回读验证后 `IDBObjectStore.prototype.delete` 对 `:__tx_state__` 抛错 → 返回 `UNCERTAIN`（`COMMIT_TX_MARKER_CLEAR_FAILED`），`markerStillThere=true` → 第二标签页未恢复提交得 `STORAGE_UNAVAILABLE` → 显式 `loadSafe()` 发现 `VALID rev=4` 并清标，续写 `rev=5` |
| A02-8 | 恢复时部分槽位 IO 失败，保持冻结 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc8`) | **PASS ×2**：恢复读 `save_slot_0.json` 抛错 → `STORAGE_UNAVAILABLE`（`PARTIAL_IO_UNAVAILABLE`），标记保留，第二标签页仍被阻断 |
| A02-9 | 恢复时共享事务标记不可读取，拒绝写入 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc9`) | **PASS ×2**：恢复读 `:__tx_state__` 抛错 → `STORAGE_UNAVAILABLE`（`TX_STATE_UNREADABLE`），第二标签页仍被阻断 |
| A02-10 | 恢复成功后基于最新 revision 正常提交 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc6And10And11`, `sc7SecondTab`) | **PASS ×2**：恢复 `rev=2` 后成功 `COMMITTED rev=3`；恢复 `rev=4` 后成功 `COMMITTED rev=5` |
| A02-11 | 恢复后旧实例提交被 `CONFLICT` 拒绝 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc6And10And11`) | **PASS ×2**：恢复 `rev=2` 后以过期 `expectedRevision='1'` 提交返回 `CONFLICT`（0 写入） |
| A02-12 | 不同存档域互不影响 | `web_rework04_a02_marker_faults_and_crash_matrix` (`sc5And12`) | **PASS ×2**：主域 `nsM` 处于 `PENDING` 冻结期间，独立域 `nsOther` 正常 `EMPTY` → `COMMITTED` |
| P2 | 真实 Chrome 缺 `indexedDB` + 遗留 `localStorage` 存档 | `web_rework04_p2_idb_unavailable_and_legacy_localstorage` | **PASS ×2**：① 有 IDB + 遗留 LS：`EMPTY`、`DETECTED_IGNORED_NO_AUTO_MIGRATION`、`lsIntact=true`；② `window.indexedDB=undefined` + 遗留 LS：`isNodeHost=false`、`STORAGE_UNAVAILABLE`、`persistenceHalted=true`、HIDE 0 写、即使传入 `allowLocalStorageMockInNode:true` 仍返回 `BROWSER_STORAGE_UNAVAILABLE`/`STORAGE_UNAVAILABLE`、`lsKeysIdentical=true`、`lsIntact=true` |
| A01 回归 | 两独立 Profile ×（空盘竞争 + 12 轮非空交错竞争 + 持锁崩溃 + A05） | `web_p0_dual_tab_empty_and_12_round_interleaved_race` | **PASS ×2**：两套独立 Profile 合计 **2/2 空盘竞争 + 24/24 非空交错轮次（12 写前屏障 + 12 写后回读前屏障），0 次双 `COMMITTED`**，全部 `distinctClients=true`，持锁 Tab 强杀自动释放并续写 `rev=21` |
| A04 回归 | 生产 `__SPIKE_HARNESS__` 接口收敛与真实销毁零写 | `web_p1_03_production_harness_no_destructive_save_api`、`web_p1_03_destroyed_boot_entry_zero_writes` | **PASS ×2**：仅 14 个只读/UI 键，0 个禁止方法，`hasClearSlotsForTestOnCoordinator=false`，销毁后 HIDE 0 写 |

---

## 3. 宿主分层与未执行项（严格如实披露）

| 分层 | 环境 | 状态 | 说明 |
|---|---|---|---|
| Tier 1 | Node.js `v24.20.0` 纯业务核心与契约（82/82 + Perf 5/5 + A1–A8 8/8） | **PASS** | 真实执行 |
| Tier 2 | Node.js + 显式 Mock wx / Mock DOM 前端测试（20/20） | **PASS** | 明确标注 `[NODE]`/`[MOCK-WX]`/`[MOCK-DOM]`，不替代真机 |
| Tier 3 | Cocos Creator 3.8.8 生产构建（Web 36 文件 + 微信 41 文件 / 10/10 审计） | **PASS** | 真实构建与产物静态核验 |
| Tier 4 | 真实 Chrome 158（headless CDP）两独立 Profile Web E2E（31/31 × 2） | **PASS** | 真实浏览器多进程 IndexedDB + Web Locks |
| Tier 5 | 微信开发者工具（WeChat DevTools） | **BLOCKED / NOT_RUN** | 本机无登录态微信开发者工具运行环境，未以静态检查替代 |
| Tier 6 | 微信真机（真实 FS / 真实前后台生命周期 / 真实分包加载 / 真实激励广告 `adUnitId`） | **BLOCKED / NOT_RUN** | 无真机与真实广告位 ID，不宣称通过 |
| 其他 | Windows 独立目录符号链接（`symlink` 文件/目录） | **NOT_RUN** | 非管理员权限 `EPERM`（NTFS Junction 与元数据 `EACCES` 已实测通过） |
| 其他 | 后台标签页并发 `runAllPlatformChecks()`（含 Cocos 分包加载） | **NOT_RUN** | 详见 `ISSUE_REPORT.md` §2（Cocos `rAF` 后台节流观察项，非存储隔离缺陷） |
