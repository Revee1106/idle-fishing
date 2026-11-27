# FE-000-R1-INTEGRATION-REWORK-07 测试验证报告（TEST_REPORT）

- **测试环境**：Windows x64 · Node `v24.20.0` · npm `11.4.2` · TypeScript `5.9.3` · Chrome `158.0.8127.37` · Cocos Creator `3.8.8` · Python `3.12.6`
- **工作区**：`E:\idle-fishing-rework07`（分支 `dev/fe-000-rework07`，基线 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc`）

---

## 1. Astra 两个 P2 原始反例整改前/后实证对照

### 1.1 R5-02 · 2304 / 2552 字节恒定配额空盘反例

脚本：`evidence/repro-r502-capacity.mjs`（完全保持 Astra `capacity.mjs` 的 `saveEpoch='astra-capacity'`、+1h 有效存档 `2552` 字节、`MemoryFilePort(2304)`，未缩减存档尺寸或修改配额）。

| 观测字段 | 整改前（`dda015c` 基线） | 整改后（REWORK-07） |
|---|---|---|
| `fullSlotBytes` / `limit` | `2552` / `2304` | `2552` / `2304` |
| `first`（首次 `commit(state, null)`） | `STORAGE_UNAVAILABLE` | `STORAGE_UNAVAILABLE` |
| `markerBefore` | `true` | `true` |
| `recoveredNoState`（`loadSafe()`） | `EMPTY`（**虚假恢复**） | `STORAGE_UNAVAILABLE`（`WRITE_CAPABILITY_UNAVAILABLE`） |
| `markerAfterNoState` | `false`（**标记被误清**） | `true`（**标记保留**） |
| `recoveredWithState`（`loadSafe({ initialCommitState: state })`） | `EMPTY`（**虚假恢复**） | `STORAGE_UNAVAILABLE`（`WRITE_CAPABILITY_UNAVAILABLE`） |
| `markerAfterWithState` | `false`（**标记被误清**） | `true`（**标记保留**） |
| `retry`（再次 `commit(state, null)`） | `STORAGE_UNAVAILABLE` | `STORAGE_UNAVAILABLE` |
| 脚本退出码 | `1`（FAIL） | **`0`（PASS）** |
| 证据文件 | `evidence/baseline-repro/r502-capacity-before.log` / `.rc` | `evidence/after-fix-repro/r502-capacity-after.log` / `.rc` |

### 1.2 R5-03 · 真实 Chrome 取得 Web Lock 后、首次探针写入前销毁反例

脚本：`evidence/repro-r503-probe-owner.mjs`（完全复刻 Astra `probe-owner.mjs`：延迟 `BrowserFilePort.prototype.openDb('__probe__')`，在返回前销毁真实 `BootEntry`，以独立 `IDBObjectStore.prototype.put/delete` 事务 `complete` 监听器统计 `:__probe__` 持久化操作）。

| 入口模式 | 指标 | 整改前（`dda015c` 基线构建） | 整改后（REWORK-07 新构建） |
|---|---|---|---|
| `STANDARD`（`BtnRecoverStorage`） | `ops`（已提交 `:__probe__` 事务） | `put(destroyed:true)`, `delete(destroyed:true)`（**2 笔**） | **`[]`（0 笔）** |
| `STANDARD` | `outcome` / `destroyed` / `halted` / `overlay` | `CANCELLED_DESTROYED` / `true` / `true` / `false` | `CANCELLED_DESTROYED` / `true` / `true` / `false` |
| `STANDARD` | 槽位 / 标记 / 历史元数据一致 | `true` / `true` / `true` | `true` / `true` / `true` |
| `STANDARD` | 脚本退出码 & 证据 | `1` (`baseline-repro/r503-probe-standard-before.log`) | **`0`** (`after-fix-repro/r503-probe-standard-after.log`) |
| `CONFIRM_CORRUPT_MARKER`（`BtnConfirmCorruptMarkerRecovery`） | `ops`（已提交 `:__probe__` 事务） | `put(destroyed:true)`, `delete(destroyed:true)`（**2 笔**） | **`[]`（0 笔）** |
| `CONFIRM_CORRUPT_MARKER` | `outcome` / `destroyed` / `halted` / `overlay` | `CANCELLED_DESTROYED` / `true` / `true` / `false` | `CANCELLED_DESTROYED` / `true` / `true` / `false` |
| `CONFIRM_CORRUPT_MARKER` | 槽位 / 标记 / 历史元数据一致 | `true` / `true` / `true` | `true` / `true` / `true` |
| `CONFIRM_CORRUPT_MARKER` | 脚本退出码 & 证据 | `1` (`baseline-repro/r503-probe-confirm-before.log`) | **`0`** (`after-fix-repro/r503-probe-confirm-after.log`) |

---

## 2. 全量回归验证矩阵

| 序号 | 验证项 | 命令 / 入口 | 退出码 | 结果详情 | 日志 / 证据 |
|---|---|---|---:|---|---|
| 1 | 后端全量验证 | `npm run verify` | 0 | **82/82 PASS**（`typecheck` + `build:cocos` + `typecheck:cocos` + 82 tests） | `logs/01-backend-verify.log` |
| 2 | 后端 24h 性能与黄金哈希 | `npm run test:perf` | 0 | **5/5 true**，黄金 Envelope `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` 一致 | `logs/02-backend-perf.log` |
| 3 | 后端 A1–A8 专项回归 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | **8/8 PASS** | `logs/03-backend-a1-a8.log` |
| 4 | Cocos 消费端类型检查 | `npm run typecheck:cocos` | 0 | **0 错误** | `logs/04-typecheck-cocos.log` |
| 5 | 前端 TypeScript 类型检查 | `npm --prefix apps/game-client run typecheck` | 0 | **0 错误**（Cocos 构建生成 `temp/declarations/cc.d.ts` 后执行） | `logs/05-frontend-typecheck.log` |
| 6 | Node/Mock 前端全量测试 | `npm --prefix apps/game-client run test:frontend` | 0 | **35/35 PASS**（保留原 33 项 + 新增 2 项 REWORK-07 回归，`fail=0, skip=0, todo=0, procErr=0`） | `logs/05b-frontend-node-tests.log` |
| 7 | 干净独立检出环境 Node 全量测试 | 临时目录仅导出候选文件（零历史归档复制）→ `npm ci` → `build:cocos` → `test:frontend` | 0 | **35/35 PASS**（`legacy-358b111-saves.json` 自带存在，`fail=0, skip=0, todo=0, procErr=0`） | `logs/09-clean-checkout-node-tests.log` |
| 8 | 全新 Cocos Web 构建 | `npm --prefix apps/game-client run build:web` | 0 | **36 文件 / 2,154,982 字节（2,104.47 KB）**，Cocos 原始码 36，包装校验 PASS | `logs/06-build-web.log`, `evidence/web-rework07-build-manifest.json` |
| 9 | 全新微信小游戏构建 | `npm --prefix apps/game-client run build:wechat` | 0 | **41 文件 / 2,083,847 字节（2,035.01 KB）**，7 个分包文件 2,597 字节 | `logs/07-build-wechat.log`, `evidence/wechat-rework07-build-manifest.json` |
| 10 | 微信小游戏 10 项静态审计 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | 0 | **10/10 PASS**（0 errors） | `logs/08-wechat-audit.log`, `evidence/wechat-rework07-audit.json` |
| 11 | 真实 Chrome Web E2E（Profile A） | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework07` | 0 | **39/39 PASS**（保留原 37 项 + 新增 2 项 REWORK-07，`consoleErr=0, pageErr=0`，5 张截图） | `logs/10-web-e2e-profileA.log`, `evidence/web-rework07/` |
| 12 | 真实 Chrome Web E2E（Profile B） | `node tests/frontend/fe-000/verify-web-build.mjs --out-dir=.../web-rework07-repeat` | 0 | **39/39 PASS**（保留原 37 项 + 新增 2 项 REWORK-07，`consoleErr=0, pageErr=0`，5 张截图） | `logs/11-web-e2e-profileB.log`, `evidence/web-rework07-repeat/` |
| 13 | A01 双标签页竞争（Profile A） | `node .../r7-isolated-race.mjs profileA` | 0 | **PASS**（空盘 + 12/12 轮非空交错竞争 0 双 `COMMITTED` + 持锁页关闭恢复，5.175s） | `logs/12-race-profileA.log`, `evidence/r7-isolated-race-profileA.json` |
| 14 | A01 双标签页竞争（Profile B） | `node .../r7-isolated-race.mjs profileB` | 0 | **PASS**（空盘 + 12/12 轮非空交错竞争 0 双 `COMMITTED` + 持锁页关闭恢复，5.238s） | `logs/13-race-profileB.log`, `evidence/r7-isolated-race-profileB.json` |

---

## 3. 新增测试用例汇总（按需增量，无重复用例）

- **Node/Mock 新增 2 项**（33 → 35）：
  1. `[NODE/REWORK-07/R5-02-EMPTY-CAPACITY-COUNTEREXAMPLE]`：覆盖 Astra 2304/2552 恒定配额原例、2KB 小探针成功但仍保持冻结、缺失/非法 `initialCommitState` 保持冻结、动态配额恢复后实际初始状态持久化（rev 1、0 收益/时间变化、历史元数据与清标一致）、后续正常提交（rev 2）及新协调器重载一致。
  2. `[NODE/REWORK-07/R5-03-PRE-PROBE-CANCELLATION-BOUNDARY]`：覆盖 `STANDARD` 与 `CONFIRM_CORRUPT_MARKER` 在 `openDb` 异步准备阶段销毁（0 `put`/0 `delete`、`persistentMutationOccurred=false`）、探针 `put` 已合法启动后销毁（完成清理、`persistentMutationOccurred=true`、业务标记/槽位未改）、探针读回异常仍完成清理并返回 `PROBE_FAILED`，以及 `WeChatFilePort.probeStorage` 写前取消不调用 `mkdirSync`。
- **真实 Chrome Web E2E 新增 2 项**（37 → 39）：
  1. `web_rework07_r5_02_initial_save_quota_ui_recovery`：真实 Chrome 空盘下注入 1000 字节槽位配额（1 字节 `__probe__` 正常成功），验证首存 HIDE 失败冻结、点击真实 UI `BtnRecoverStorage` 不解冻（`WRITE_CAPABILITY_UNAVAILABLE`、0 槽写入、标记保留）、配额恢复后点击恢复成功写入真实初始存档 rev=1（`gold=31, cursorMs=1700000060000`, `histRev=1`, `marker=null`）、后续正常 HIDE 提交 rev=2、刷新重载保持 rev=2。
  2. `web_rework07_r5_03_probe_write_cancellation_chrome`：真实 Chrome 覆盖 `STANDARD` 与 `CONFIRM_CORRUPT_MARKER` 在 `openDb('__probe__')` 返回前销毁（0 `put`/0 `delete`、`CANCELLED_DESTROYED`、槽位/标记/历史完全一致）、探针 `put` 启动后销毁（`put+delete` 清理完毕、0 孤儿 `__probe__`、`COMPLETED_AFTER_DESTROY`、业务标记/槽位未改、组件未重新激活）、以及探针读回异常清理（`put+delete`、0 孤儿键、`PROBE_FAILED`/`FAILED`）。

---

## 4. 已关闭能力回归确认

- **R5-01（已确认版本单调保护）**：Node 回归用例 + 两套 Chrome Profile `web_rework06_r5_01_confirmed_revision_monotonic_cross_tab_reload` 全部 **PASS**；未修改 R5-01 核心逻辑。
- **R5-02（已有有效存档写入恢复检查点）**：Node 回归用例 + 两套 Chrome Profile `web_rework06_r5_02_app_ui_persistent_quota_recovery_loop` 全部 **PASS**（检查点 rev 1→2 零收益/零时间推进，后续 HIDE rev 3）。
- **R5-03（等待 Web Lock 期间销毁 & 已启动业务事务收尾）**：Node 回归用例 + 两套 Chrome Profile `web_rework06_r5_03_app_ui_recovery_owner_lifecycle` 全部 **PASS**。
- **既有 A01–A10 / REV4-01–REV4-08**：全部既有 33 项 Node/Mock（含 8 项 `[MOCK-WX]`）及 37 项 Chrome E2E 断言 100% 保留并通过。
