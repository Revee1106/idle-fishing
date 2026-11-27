# FE-000-R1-INTEGRATION-REWORK-01 测试报告（TEST_REPORT）

## 1. 测试环境与基线
| 项目 | 实测值 |
|---|---|
| 任务 | `FE-000-R1-INTEGRATION-REWORK-01` |
| 工作区 / 分支 | `E:\idle-fishing-integration` / `integration/fe-000-be-r1` |
| `HEAD` / `MERGE_HEAD` | `be62996fae44df24094331d670f6f0ab3741a4f2` / `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355` |
| 工具链 | Windows 10.0.19045 x64 / Node `v24.20.0` / npm `11.4.2` / TS `5.9.3` / Cocos Creator `3.8.8` / Chrome `158.0.8127.37` / 微信开发者工具 `2.01.2510280` |
| 产物新鲜度 | 重建前已彻底删除 `apps/game-client/build/web-mobile` 与 `apps/game-client/build/wechatgame`，全部为本次整改代码全新构建 |

---

## 2. 整改后全量回归命令与结果总表

> 本轮所有 17 份日志均由 Node `spawnSync` 捕获并写入 `reports/integration/FE-000-R1-INTEGRATION-REWORK-01/logs/`，每份日志均包含完整 `COMMAND`、`EXIT_CODE`、`DURATION_MS`、`STDOUT` 与 `STDERR`（零空日志）。

| 序号 | 执行命令 | 退出码 | 实际用例 / 结果 | 实测宿主 | 日志路径 |
|---:|---|---:|---|---|---|
| 1 | `npm run verify` | `0` | 后端 `typecheck` + `build:cocos`（`9 .mjs + 9 .d.mts`）+ `typecheck:cocos` + **82/82 PASS** | Node `v24.20.0` | `logs/rework-backend-verify.log` |
| 2 | `npm run test:perf` | `0` | 24h 5/5 一致性 `true`（连续 `72.61 ms`、60s `68.843 ms`、budget64 `58.745 ms`、`envelopeSha256=0be078f1...`） | Node `v24.20.0` | `logs/rework-backend-perf.log` |
| 3 | `npm run typecheck:cocos` | `0` | 严格消费 `.mjs`/`.d.mts`，**0 errors** | Node (`tsc 5.9.3`) | `logs/rework-typecheck-cocos.log` |
| 4 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | `0` | 独立反例 A1–A8 **8/8 PASS** | Node `v24.20.0` | `logs/rework-review-a1-a8.log` |
| 5 | `npm --prefix apps/game-client run typecheck` | `0` | 完整客户端（含新增 `SingleWriterSaveCoordinator.ts`）**0 errors** | Node (`tsc 5.9.3`) | `logs/rework-frontend-typecheck.log` |
| 6 | `npm --prefix apps/game-client run test:frontend` | `0` | **13/13 PASS**（原 10 项 + 新增 P1-01 / P2-04 / P1-03 3 项，0 fail / 0 skip / 0 todo） | Node / Mock | `logs/rework-frontend-tests.log` |
| 7 | `npm --prefix apps/game-client run build:web` | `0`（Cocos `36`） | 全新构建 `36 文件 / 2,092,368 B (2043.33 KB)`，`mtime=2026-11-26T10:31:56+08:00` | Cocos CLI `3.8.8` | `logs/rework-build-web.log`、`evidence/web-rework-build-manifest.json` |
| 8 | `npm --prefix apps/game-client run verify:web` | `0` | **24/24 PASS**（原 21 项 + 新增 3 项真实 Web P1-01/P1-02 回归），`0` 控制台错误、`0` 异常 | 真实 Web 产物（Chrome 158 CDP） | `logs/rework-verify-web.log`、`evidence/web-rework/r1-green-web-results.json`、4 张 `.png` |
| 9 | `npm --prefix apps/game-client run build:wechat` | `0`（Cocos `36`） | 全新构建 `41 文件 / 2,001,705 B (1954.79 KB)`（主包 `34 文件 / 1952.25 KB`，分包 `7 文件 / 2.54 KB`），`mtime=2026-11-26T10:34:35+08:00` | Cocos CLI `3.8.8` | `logs/rework-build-wechat.log` |
| 10 | `node tests/frontend/fe-000/verify-wechat-build.mjs ...` | `0` | **10/10 PASS**（`game.json`、`game.js`、`config.json`、`spike-pack-v1`、`313B PNG`、`src/settings.json`） | 微信构建产物静态审计 | `logs/rework-verify-wechat.log`、`evidence/wechat-rework-audit.json` |

---

## 3. 四项整改专项回归结果详情

### 3.1 P1-01 (`COMPAT-SAVE-BOOT-UNAVAILABLE`)
- **Node/Mock（`[NODE/P1-01/COMPAT-SAVE-BOOT-UNAVAILABLE]`）**：验证真实 `EMPTY` 初始化正常 -> 写入有效 `rev=1` -> 仅拦截 `__probe__` 写入 -> `BrowserFilePort.storageAvailable === false`、`SingleWriterSaveCoordinator.loadSafe()` 返回 `STORAGE_UNAVAILABLE`（非 `EMPTY`）、`read()` 抛 `FilePortIoError`、`commit()` 返回 `FAILED`（非 `COMMITTED`）且原槽位字节未变 -> 解除故障后 `loadSafe()` 完整恢复 `rev=1` 及资产。
- **真实 Web 产物（`web_p1_01_compat_save_boot_unavailable`，Chrome 158 CDP）**：
  - 写入有效存档后通过 `Page.addScriptToEvaluateOnNewDocument` 仅让 `Storage.prototype.setItem` 对 `__probe__` 抛错（真实存档槽仍可读，精确复现 Astra `F1`）。
  - 重载启动实测：`faultStatus="STORAGE_UNAVAILABLE"`、`faultHalted=true`、`restoredOnBoot=false`；派发真实 `visibilitychange(hidden)` 后 `faultHideCommits=0`、`lastCommitKind !== "COMMITTED"`、全部 3 个槽位字节前后完全一致（`slotsUntouchedDuringFault=true`）。
  - 移除故障脚本并重载实测：`recoveredStatus="VALID"`、`restoredOnBoot=true`、`recoveredRev="2"`、`recoveredGold="84"`、`recoveredCursorMs=1700000120000`，与故障期间 `localStorage` 内存储的最高有效 Envelope 100% 一致。

### 3.2 P1-02 (`COMPAT-LIFECYCLE-HIDE-SHOW-HIDE`)
- **真实 Web 产物（`web_p1_02_compat_lifecycle_hide_show_hide`，Chrome 158 CDP）**：
  - 从干净 `EMPTY` 启动，连续快速派发：`HIDE #1` -> `SHOW` -> `advancePersistState(15000)` -> `HIDE #2` -> `SHOW` -> `HIDE #3` -> `SHOW` -> `HIDE #4` -> `SHOW`。
  - 实测：`commits=4`、`rev="4"`、`lastCommitKind="COMMITTED"`、`cursorMs=1700000255000`（精确等于 `1700000000000 + 4*60000 + 15000`），提交轨迹为 `["null->1:COMMITTED","1->2:COMMITTED","2->3:COMMITTED","3->4:COMMITTED"]`，零 `CONFLICT`。
  - 执行真实 `Page.reload()` 后实测：`loadStatus="VALID"`、`restoredOnBoot=true`、`reloadedRev="4"`、`reloadedCursorMs=1700000255000`，进度零丢失。
- **真实 Web `UNCERTAIN` 队列停机（`web_p1_02_queued_hide_after_uncertain_halts`）**：
  - 注入槽 2 读取异常后连续派发 `HIDE -> SHOW -> HIDE`。实测：`lastCommitKind="UNCERTAIN"`、`halted=true`、`slotWriteCount=0`、提交轨迹为 `["UNCERTAIN","SKIPPED_HALTED"]`。

### 3.3 P1-03（前端测试入口 7 项独立夹具实测矩阵）
每项均由独立命令执行并留存非空日志（同时在 `[NODE/P1-03/COMPAT-RUNNER-ZERO-AND-SKIP-GUARD]` 自动回归）：

| 场景 | 夹具 / 参数 | 实测退出码 | 实测统计输出 | 日志文件 |
|---|---|---:|---|---|
| 空测试文件 | `fixtures/fixture-empty.test.ts` | **`1`**（期望非 0） | `total=0 pass=0 fail=0 skip=0 todo=0` | `logs/rework-p1-03-empty.log`（559 B） |
| 全部跳过 | `fixtures/fixture-skipped.test.ts` | **`1`**（期望非 0） | `total=1 pass=0 fail=0 skip=1 todo=0` | `logs/rework-p1-03-skipped.log`（451 B） |
| 用例失败 | `fixtures/fixture-failed.test.ts` | **`1`**（期望非 0） | `total=1 pass=0 fail=1 skip=0 todo=0` | `logs/rework-p1-03-failed.log`（1294 B） |
| 正常通过 | `fixtures/fixture-passed.test.ts` | **`0`**（期望 0） | `total=1 pass=1 fail=0 skip=0 todo=0` | `logs/rework-p1-03-passed.log`（367 B） |
| 混合（1 通过 + 1 跳过） | `fixtures/fixture-mixed.test.ts` | **`0`**（期望 0） | `total=2 pass=1 fail=0 skip=1 todo=0`（跳过未计入 pass） | `logs/rework-p1-03-mixed.log`（423 B） |
| 空文件列表 | `--files=` | **`1`**（期望非 0） | stderr：`0 test files specified.` | `logs/rework-p1-03-no-files.log`（176 B） |
| 缺失测试文件 | `--files=fixtures/missing.test.ts` | **`1`**（期望非 0） | stderr：`Missing required test file` | `logs/rework-p1-03-missing.log`（279 B） |

### 3.4 P2-04 (`COMPAT-SAVE-CONCURRENT-COMMIT`)
在 `[NODE/P2-04/COMPAT-SAVE-CONCURRENT-COMMIT]` 中全部通过：
1. **同实例写屏障交错**：候选 A 进入 `write()` 暂停，候选 B 并发提交 -> A 获 `COMMITTED (rev=1)`、B 获 `CONFLICT`、物理写总计 `1` 次、最终存档与 A 逐字节一致。
2. **双协调器共享同一持久命名空间（`BrowserFilePort`）**：两个独立 `SingleWriterSaveCoordinator` 共享 `browser:p204_shared_browser_ns`，并发提交不同 `rev=2` 候选 -> 结果严格为 `['COMMITTED', 'CONFLICT']`，最终读取内容与唯一胜出者 100% 一致。
3. **首提交写前失败（`PRE_WRITE_ERROR`）**：候选 A 返回 `FAILED` 并释放锁，排队的候选 B 获锁并成功 `COMMITTED (rev=1)`。

---

## 4. 历史核心指标回归确认（零退化）
- **后端测试**：82/82 PASS + A1–A8 8/8 PASS + G01/G02 黄金向量 PASS。
- **Node 与真实 Web 确定性**：1h 状态 `8a882ec8...`、1h Envelope 内部 `183ed74c...` / 全文 `4e1d068a...`、8h 状态 `91bfd08b...`（含 `fish:970` 锁）、24h Envelope 内部 `9ed7cded...` / 全文 `0be078f1...` 全部 100% 一致。
- **24h 桌面 Web 参考性能**：单次 `90.3 ms`、60 分片纯计算 `142.5 ms`（最大单片 `4.5 ms`）、rAF max `50.1 ms`、`singleEqualsSliced=true`。
- **历史 `358b111` 存档兼容**：5 类场景（`IDLE`/`FIGHTING`/`PREPARING`/`POST_DEADLINE`/`CORRUPT_WITH_VALID_BACKUP`）持续 PASS。
- **真实微信 IDE 运行 / 微信真机 / 真实激励广告**：仍为 **`BLOCKED`**，不以 Node/Mock/Web 替代。
