# FE-000-R1-INTEGRATION-REWORK-05 测试报告（TEST_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-05`
- **执行日期**：2026-11-27
- **实测环境**：Windows 10 x64 / Node `v24.20.0` / TypeScript `5.9.3` / Cocos Creator `3.8.8` / Chrome `158.0.8127.37`（headless CDP）
- **验证原则**：保留既有全部 20 项 Node 测试与 31 项 Web 断言（0 删除、0 弱化）；所有应用级恢复验证均在真实生产 Web 构建中通过真实 UI 指针点击（`Input.dispatchMouseEvent`）触发，不以直接调用协调器 API 替代。

---

## 1. 全量回归总览

| # | 验证项 | 命令 | 退出码 | 实测结果 | 日志 / 证据 |
|---:|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | 0 | **82/82 PASS**（含 `9 .mjs + 9 .d.mts` 与 `typecheck:cocos`） | `logs/r5-backend-verify.log` |
| 2 | 后端 24h 性能与黄金哈希 | `npm run test:perf` | 0 | **5/5 一致**；envelope SHA-256 `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` | `logs/r5-backend-perf.log` |
| 3 | A1–A8 历史反例 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | **8/8 PASS** | `logs/r5-review-a1-a8.log` |
| 4 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | 0 | **0 错误** | `logs/r5-typecheck-cocos.log` |
| 5 | 前端 TypeScript 类型检查 | `npm --prefix apps/game-client run typecheck` | 0 | **0 错误** | `logs/r5-frontend-typecheck.log` |
| 6 | 前端 Node + `[MOCK-WX]` 自动化测试 | `npm --prefix apps/game-client run test:frontend` | 0 | **29/29 PASS**（20 旧 + 2 恢复安全/损坏标记 + 7 微信 Mock 标记用例；`fail=0 skip=0 todo=0 containerFail=0 procErr=0`） | `logs/r5-frontend-tests.log` |
| 7 | 全新 Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | 0 | **36 文件 / 2,143,092 字节（2,092.86 KB）** | `logs/r5-build-web.log`、`evidence/web-rework05-build-manifest.json` |
| 8 | 全新微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | 0 | **41 文件 / 2,052,429 字节（2,004.33 KB）** | `logs/r5-build-wechat.log` |
| 9 | 微信构建产物与分包审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | 0 | **10/10 PASS**（主包 34 文件 / 2,001.79 KB；分包 `spike-pack` 7 文件 / 2.54 KB） | `logs/r5-verify-wechat.log`、`evidence/wechat-rework05-audit.json` |
| 10 | 真实 Chrome 158 Web E2E — **Profile 1** | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework05` | 0 | **34/34 PASS**（端口 `55613`，12 轮竞争 `doubleCommitted=0`，consoleErr=0，pageErr=0，5 截图） | `logs/r5-verify-web-run1.log`、`evidence/web-rework05/r1-green-web-results.json` |
| 11 | 真实 Chrome 158 Web E2E — **Profile 2（独立重复）** | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework05-repeat` | 0 | **34/34 PASS**（端口 `56319`，660.7s，12 轮竞争 `doubleCommitted=0`，consoleErr=0，pageErr=0，5 截图） | `logs/r5-verify-web-run2.log`、`evidence/web-rework05-repeat/r1-green-web-results.json` |

---

## 2. 必测专项逐项验收结果（任务书第 8 节）

### 2.1 存档恢复安全（10/10 PASS — Node 与两套真实 Chrome 158 Profile 双重实测）

| # | 必测场景 | Node 用例 | 真实 Chrome 158（Profile 1 & 2） | 实测结果 |
|---:|---|---|---|---|
| 1 | 已有 rev1 + `PENDING` + 全部槽位消失 | `REV4-01-RECOVERY-SAFETY-MATRIX` | `web_rework05_rev4_01_03_recovery_safety_matrix` (`resLost`) | **PASS ×2**：`SAVE_DISAPPEARED_PENDING_RECOVERY`，标记保留，保持冻结，0 写 |
| 2 | 已有有效备份的 `FROZEN` 标记 + 全部槽位消失 | 同上 | 同上 (`resFrozenLost`) | **PASS ×2**：部分 IO 写 `FROZEN` 保留 `confirmedRevision='2'`；槽位消失后 `SAVE_DISAPPEARED_PENDING_RECOVERY`，标记保留 |
| 3 | 历史未知（含旧版 `expectedRevision=null`）+ `EMPTY` | 同上 | 同上 (`resUnknownEmpty`) | **PASS ×2**：`SAVE_DISAPPEARED_PENDING_RECOVERY`，标记保留 |
| 4 | 明确首次创建事务（`CONFIRMED_EMPTY_INITIAL_CREATE`）+ `EMPTY` | 同上 | 同上 (`resInitial`) | **PASS ×2**：安全恢复 `EMPTY`，清除标记 |
| 5 | 有效存档版本低于已确认历史版本（盘面 `rev=1` < 标记 `rev=2`） | 同上 | 同上 (`resReg`) | **PASS ×2**：`REVISION_REGRESSION_PENDING_RECOVERY`，只读备份 `rev=1`，标记保留不静默解冻 |
| 6 | 部分槽位 IO 失败 | `A03` + `REV4-01` | `A03` + `sc8` + `resFrozenLost` | **PASS ×2**：`PARTIAL_IO_UNAVAILABLE`，保持冻结 |
| 7 | 损坏标记 + 有效存档：受控确认恢复（含并发变更拒绝） | `REV4-03-CONTROLLED-CORRUPT-MARKER-RECOVERY` | `corrupt` + `web_rework05_rev4_03_app_ui_corrupt_marker_confirm` | **PASS ×2**：并发改标被 `CONCURRENT_RECOVERY_STATE_CHANGED` 拒绝；真实 UI 点击 `BtnConfirmCorruptMarkerRecovery` 恢复 `VALID` 且不删有效槽位 |
| 8 | 损坏标记 + `EMPTY`：拒绝恢复 | 同上 | `corrupt.empty*` | **PASS ×2**：`TX_STATE_CORRUPT`、`canConfirmRecovery=false`、确认被 `CORRUPT_MARKER_NO_VALID_SAVE` 拒绝 |
| 9 | 标记读取失败（IO 错误）：拒绝恢复 | 同上 | `sc9` + `corrupt.readIo*` | **PASS ×2**：`TX_STATE_UNREADABLE`，受控恢复被拒绝 |
| 10 | 恢复期间清标失败：保持冻结 | `A02` + `REV4-03` | `sc7_8_9` + `REV4-03` | **PASS ×2**：`TX_STATE_CLEAR_FAILED`，标记保留，保持冻结 |

### 2.2 应用级显式恢复（11/11 PASS — 两套真实 Chrome 158 Profile 真实 UI 指针点击实测）

| # | 必测场景 | 对应断言（`verify-web-build.mjs`） | Profile 1 & Profile 2 实测结果 |
|---:|---|---|---|
| 1 | 正常 HIDE 得到 `UNCERTAIN` | `web_rework05_rev4_02_04_app_ui_recovery_loop` (`unc1`) | **PASS ×2**：`lastCommitKind='UNCERTAIN'`、`recoveryOverlayVisible=true` |
| 2 | 刷新后继续冻结 | 同上 (`afterReloadFrozen`) | **PASS ×2**：`STORAGE_UNAVAILABLE` / `PENDING_RECOVERY_REQUIRED` / 浮层持续可见（截图 `r5-recovery-overlay.png`） |
| 3 | 用户通过实际 UI 触发恢复 | 同上 (`okUiRecovery1`) | **PASS ×2**：真实指针点击 `BtnRecoverStorage` → `RECOVERED_VALID`、`rev='1'`、`persistenceHalted=false`、浮层关闭 |
| 4 | 恢复成功后再次 HIDE 正常保存 | 同上 (`hideAfterUiRec1`) | **PASS ×2**：正常 HIDE `COMMITTED rev='2'` |
| 5 | 其他标签页已恢复后，当前应用通过恢复入口重新加载最新 revision | 同上 (`crossTabUiRes`) | **PASS ×2**：Tab B 经 UI 恢复并提交 `rev='3'`（`gold='129'`）；Tab A 点击 `BtnRecoverStorage` 后加载 `rev='3'`、`gold='129'` |
| 6 | 恢复期间重复点击 | 同上 (`interleaveMid`) | **PASS ×2**：在途期间连续点击 3 次 → `loadCalls=1`、`dupIgnored=2`，无重复并发恢复 |
| 7 | 恢复与 HIDE/SHOW 交错 | 同上 (`interleaveMid` / `interleaveDone`) | **PASS ×2**：SHOW 不解冻；HIDE 严格排在恢复完成后基于最新 `rev='4'` 提交 `rev='5'` |
| 8 | 恢复期间销毁 | 同上 (`destroyMidRec`) | **PASS ×2**：`destroyed=true`、`lastRecoveryOutcome='CANCELLED_DESTROYED'`、`haltedAfter=true`、后续 HIDE 0 写（`slotsIdentical=true`） |
| 9 | `QUOTA` 故障解除后的安全恢复 | 同上 (`quotaFail` / `quotaRecovered`) | **PASS ×2**：`QuotaExceededError` 触发保守 `FROZEN` 标记与浮层；故障解除后点击 `BtnRecoverStorage` 恢复 `rev='5'`，下次 HIDE 提交 `rev='6'` |
| 10 | 存储仍不可用时恢复失败 | 同上 (`failedUiRecovery`) | **PASS ×2**：探针持续失败时点击 `BtnRecoverStorage` → `lastRecoveryOutcome='FAILED'`、保持冻结、浮层持续可见；故障解除后重试成功 |
| 11 | 旧内存状态不能覆盖最新存档 | 同上 (`crossTabUiRes`) | **PASS ×2**：Tab A 冻结前停留在 `rev='2'`，恢复后切换为盘面最新 `rev='3'`（`gold='129'`），下一次 HIDE 推进至 `rev='4'` |
| +1 | 损坏标记二次确认 UI 闭环 | `web_rework05_rev4_03_app_ui_corrupt_marker_confirm` | **PASS ×2**：普通 `BtnRecoverStorage` 保持 `TX_STATE_CORRUPT` 冻结；点击独立 `BtnConfirmCorruptMarkerRecovery` 清理损坏标记并恢复 `rev='6'`，下次 HIDE 提交 `rev='7'` |

### 2.3 微信事务标记专项 Mock 回归（REV4-08，7/7 PASS — 明确标注 `[MOCK-WX]`，非真实微信）

在 `tests/frontend/fe-000/platform-and-core.test.ts` 新增 7 项 `[MOCK-WX/REV4-08/*]` 用例并全部通过（29/29 之一）：
1. `1-MARKER-ROUNDTRIP-AND-TRUNCATION`（标记读写清、`list()` 过滤、`writeTxState` 截断回读拦截且 0 槽位写入）
2. `2-MARKER-WRITE-FAIL`（写标失败 → `STORAGE_UNAVAILABLE`、0 槽位写入、恢复 `rev=1`）
3. `3-MARKER-READ-FAIL`（读标失败 → `TX_STATE_UNREADABLE`、0 槽位写入）
4. `4-MARKER-CORRUPT-CONTROLLED-RECOVERY`（截断损坏标记 → `TX_STATE_CORRUPT` → 受控恢复保留有效槽位并清标）
5. `5-MARKER-CLEAR-FAIL`（提交成功但 `unlinkSync` 失败 → `UNCERTAIN`、标记保留、恢复 `rev=2`）
6. `6-PREWRITE-VS-QUOTA-RECOVERY`（确定性 `PRE_WRITE_ERROR` 清标不冻结 vs 真实 `QUOTA` 保守冻结并经显式恢复解冻）
7. `7-CROSS-COORDINATOR-AND-EMPTY-GUARD`（跨协调器 `UNCERTAIN` 冻结、槽位消失保持 `SAVE_DISAPPEARED_PENDING_RECOVERY`、恢复后旧版 `CONFLICT`）

---

## 3. 宿主分层与未执行/阻塞边界（严格如实披露）

| 分层 | 环境 | 状态 | 说明 |
|---|---|---|---|
| Tier 1 | Node.js `v24.20.0` 纯业务核心与契约（82/82 + Perf 5/5 + A1–A8 8/8） | **PASS** | 真实执行 |
| Tier 2 | Node.js + 显式 Mock wx / Mock DOM 前端测试（29/29，含 7 项 `[MOCK-WX]` 事务标记） | **PASS** | 明确标注 `[MOCK-WX]`/`[MOCK-DOM]`，**绝不替代真实微信验证** |
| Tier 3 | Cocos Creator 3.8.8 生产构建（Web 36 文件 + 微信 41 文件 / 10/10 静态审计） | **PASS** | 真实构建与产物核验 |
| Tier 4 | 真实 Chrome 158 两套独立 Profile Web E2E（34/34 × 2，含 24 轮 A01 竞争 + 真实 UI 点击恢复） | **PASS** | 0 控制台错误、0 未捕获异常 |
| Tier 5 | 微信开发者工具（WeChat DevTools） | **BLOCKED / NOT_RUN** | 本机无登录态环境，未以静态检查或 Mock 替代 |
| Tier 6 | 微信真机（真实 FS 写入持久性/截断异常、生命周期、分包、真实激励广告 `adUnitId`） | **BLOCKED / NOT_RUN** | 须在 `GATE-01` 真机环境补验 |
| 其他 | Windows 非管理员独立符号链接（`symlink`）；操作系统真断电；后台标签页完整 `runAllPlatformChecks()` | **NOT_RUN** | 详见 `ISSUE_REPORT.md` |
