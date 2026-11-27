# FE-000-R1-INTEGRATION-REWORK-04 测试验证（TEST_VERIFICATION）

- 复验方式：独立隔离副本 + 独立真实 Chrome Profile + 独立脚本；未修改开发工作区。
- 环境：Windows 10 x64 / Node `v24.20.0` / TypeScript `5.9.3` / Cocos Creator `3.8.8` / Chrome `158.0.8127.37`（headless CDP）。
- 隔离副本：`C:\Users\WANGWENJIE10\AppData\Local\Temp\fe000-r4-snap`（从 R3 审核快照复制后仅覆盖本轮 8 个变更文件；与 R4 清单 36 个代码/测试文件逐一匹配）。
- 证据目录：`evidence/`（所有脚本、日志、JSON、截图均随本报告归档）。

---

## 1. 基线与交付物核验

| 项 | 命令 / 方法 | 结果 |
|---|---|---|
| Git 基线 | `git rev-parse HEAD/MERGE_HEAD`、`git merge-base` | HEAD `be62996…`、MERGE_HEAD `5bcc9ac…`、merge-base `358b111…`，与任务书一致 |
| 工作区 | `git status` | staged=58、unstaged=12、untracked=126；前端整改未提交 |
| R4 交付清单 | `sha256sum -c FILES-REWORK.sha256` | **64/64 OK** |
| R3 初审证据 | `sha256sum -c EVIDENCE_MANIFEST.sha256`（R3-DEEPSEEK） | **60/60 OK** |
| 58 受保护后端 | `git diff 5bcc9ac -- packages/ tests/backend reports/backend tsconfig*.json package.json package-lock.json` | **0 行** |
| 历史报告 | 各清单 `reports/` 条目 + 与 R3 快照目录 diff | R1 29/29、R3 32/32 OK；R2 目录逐字节一致；R3 初审 60/60；`reports/frontend`、`reports/review` 0 漂移 |
| 8 修改 / 28 沿用 / 0 新增 | R3 快照 vs 当前工作树 `diff -rq` | 6 app + 2 测试修改；4 app + 4 测试基础设施 + 20 夹具不变；无新增 |
| 日志与源码对应 | `stat` mtime | 源码 08:54–09:31 均早于对应日志 09:06–09:45；最终报告 09:49–09:50 |
| 重建一致性 | 我独立重建 Web 后逐文件 SHA-256 对比开发方 `web-rework04-build-manifest.json` | **36/36 一致**（`evidence/rebuild-hash-check.txt`） |

---

## 2. 我在隔离副本独立执行的回归

| # | 命令 | 退出码 | 结果 | 证据 |
|---:|---|---:|---|---|
| 1 | `npm run verify` | 0 | **82/82 PASS** | `evidence/backend-verify.log` |
| 2 | `npm run test:perf` | 0 | 5/5；envelope SHA-256 `0be078f1…ae69f` | `evidence/backend-perf.log` |
| 3 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | **8/8 PASS** | `evidence/a1-a8.log` |
| 4 | `npm --prefix apps/game-client run typecheck` | 0 | 0 错误 | `evidence/frontend-typecheck.log` |
| 5 | `npm --prefix apps/game-client run test:frontend` | 0 | **20/20 PASS**（18 旧 + 2 新） | `evidence/frontend-tests.log` |
| 6 | `npm --prefix apps/game-client run build:web` | 0 | 36 文件 / 2,124,709 字节 | `evidence/build-web.log` |
| 7 | `npm --prefix apps/game-client run verify:wechat`（微信构建后） | 0 | **10/10 PASS**；41 文件 / 2,034,046 字节 | `evidence/build-wechat.log`、`evidence/verify-wechat.log` |
| 8 | `verify-web-build.mjs` — 独立 Profile 1 | 0 | **31/31 PASS**；12 轮；`doubleCommitted=0`；空盘竞争；崩溃后 rev21 | `evidence/verify-web-run1.log`、`evidence/web-run1/` |
| 9 | `verify-web-build.mjs` — 独立 Profile 2 | 0 | **31/31 PASS**；12 轮；同上 | `evidence/verify-web-run2.log`、`evidence/web-run2/` |
| 10 | 审核方独立 A01 竞争脚本（Profile A） | 0 | 空盘竞争 1 COMMITTED/1 CONFLICT；12 轮 `doubles=0`；A05；崩溃后 rev21 | `evidence/r4-race.mjs`、`evidence/r4-race-A.log`、`evidence/race-A.json` |
| 11 | 审核方独立 A01 竞争脚本（Profile B） | 0 | 同上（独立 Profile） | `evidence/r4-race-B.log`、`evidence/race-B.json` |

**断言完整性**：

- Web：R3 的 28 个 `assertCheck` ID 全部保留；新增 3 个（A02 应用级、A02 故障/崩溃矩阵、P2）。两套 Profile 均 31/31。
- Node：R3 的 18 个 `test` 名称全部保留；新增 2 个（A02 标记协议、P2）。20/20。
- 两套 Profile 的 12 轮均含写前屏障与写后回读前屏障；我解析两份 `r1-green-web-results.json`：`raceRounds=12`、`double=0`、`emptyA=COMMITTED/emptyB=CONFLICT`、`postCrashRev=21`。
- 审核方独立 A01 脚本（不复用开发方 E2E）在两套独立 Profile 各 12 轮：`rounds=12`、`doubles=0`、空盘单一赢家、A05 分类正确、持锁崩溃后幸存页 rev21。

---

## 3. 开发方证据交叉核对

| 开发方声明 | 我的独立核对 | 结论 |
|---|---|---|
| 31/31 ×2、端口 58848/59786、12 轮 | 我两套 Profile 均 31/31、12 轮、0 双提交 | 真实 |
| 20/20（18→20） | 我 20/20；旧 18 个名称全部保留 | 真实 |
| Web 36 文件 / 2,124,709 字节 | 我重建 36 / 2,124,709 | 真实 |
| 微信 41 / 2,034,046、10/10 | 我重建 41 / 2,034,046、10/10 | 真实 |
| 前端 typecheck 0 | 我 0 | 真实 |
| 82/82、perf 5/5、A1–A8 8/8 | 我全部通过 | 真实 |
| 最终日志对应最终源码 | 源码 mtime 早于日志；重建哈希 36/36 一致 | 真实 |
| 64 项清单 | 64/64 | 真实 |

开发方日志为 UTF-16LE，内容与 `TEST_REPORT.md` 一致；未发现陈旧日志（源码均早于日志）。

---

## 4. A02 独立真实 Chrome 专项（非复用开发方脚本）

所有脚本位于 `evidence/`，均在独立临时 Chrome Profile 与真实生产 `build/web-mobile` 上执行。

### 4.1 应用级跨页冻结（`r4-a02-app.mjs` → `a02-app.json`）

流程：正常 HIDE 播种 rev1 → 打开 Tab B（VALID rev1）→ Tab A 注入“槽位写前失败 + 之后槽位读失败”并正常 HIDE → A `UNCERTAIN`/halt、盘面 rev1、持久化标记 `state=UNCERTAIN, storageKey=browser:idle_fishing_lifecycle_persist_fs` → Tab B 正常 HIDE、直连协调器、A `destroy()`、A `Page.reload()`、A `Target.closeTarget()` 后均 `STORAGE_UNAVAILABLE`、`writes=0`、槽位不变。

显式恢复：Tab B 直连协调器 `loadSafe()` → `VALID rev1`、标记清除、`COMMITTED rev2`。
**应用入口核对**：`__SPIKE_HARNESS__` 键中匹配 `/recover|repair|retry|clear|reset|restore/i` 的为 `[]`；外部协调器恢复后，Tab B 的 `BootEntry` 仍 `lastCommitKind=STORAGE_UNAVAILABLE, persistenceHalted=true`（REV4-02 证据）。

**结果：10/10 PASS（安全侧）；应用恢复入口缺失。**

### 4.2 引擎级恢复/故障矩阵（`r4-a02-engine.mjs` → `a02-engine.json`）

| 检查 | 结果 |
|---|---|
| 正常 COMMITTED rev1；PENDING 在首个槽位写前可见；提交后清标 | PASS |
| 正常 CONFLICT 不冻结、不留标 | PASS |
| 确定性 `PRE_WRITE_ERROR` → FAILED、不冻结、清标、重试 rev2 | PASS |
| 标记写失败 → STORAGE_UNAVAILABLE、**0 次槽位写**、盘面不变；loadSafe 可恢复 | PASS |
| 标记清理失败 → UNCERTAIN、标记保留（PENDING）、盘面 rev2；恢复 rev2 | PASS |
| 部分槽位 IO → PARTIAL_IO_UNAVAILABLE、readOnlyBackup rev2、冻结；IO 恢复后 rev3 | PASS |
| 自动启动 `clearPendingTxMarker:false` 不清标；显式 loadSafe 清标 | PASS |
| 恢复后用恢复 revision 提交 rev2；旧 revision → CONFLICT | PASS |
| 旧冻结实例在另一协调器恢复后以旧 revision 提交 → CONFLICT（后端 CAS） | PASS |
| 不同存档域互不影响 | PASS |
| 恢复与等待提交交错（Web Lock） | PASS |
| **有效存档域 + PENDING(expectedRevision=1) + 槽位全部消失 → loadSafe** | **FAIL：返回 EMPTY、标记清除、AVAILABLE**（REV4-01） |
| **损坏标记经公开 loadSafe 恢复** | **FAIL：两次均 TX_STATE_UNREADABLE；只能原始端口 clearTxState**（REV4-03） |

### 4.3 崩溃矩阵（`r4-a02-crash.mjs` → `a02-crash.json`）

| 场景 | 结果 |
|---|---|
| PENDING 后、槽位写前杀 Tab | PASS：盘面 rev1、标记 PENDING；观察者 `STORAGE_UNAVAILABLE/0 写`；恢复 VALID rev1、清标、提交 rev2 |
| 槽位写 rev2 后、回读前杀 Tab | PASS：盘面 rev2、标记 PENDING；观察者阻断；恢复 VALID rev2；旧 rev1 → CONFLICT；新 rev2 → COMMITTED rev3 |

---

## 5. P2 独立真实 Chrome（`r4-p2.mjs` → `p2.json`）

| 场景 | 实测 | 结果 |
|---|---|---|
| IDB + 旧 LS 同时存在 | Boot VALID rev1（IDB 胜出）；`legacyExperimentalSave.detected=true`、`DETECTED_IGNORED_NO_AUTO_MIGRATION`；LS 字节不变 | PASS |
| 仅旧 LS | EMPTY；旧档报告并保留；LS 不变；重复启动稳定 | PASS |
| `indexedDB` 缺失 | STORAGE_UNAVAILABLE、halt；HIDE 0 写；opt-in 仍 `BROWSER_STORAGE_UNAVAILABLE`；`isNodeTestHost=false`；LS 键集合与内容不变 | PASS |
| `indexedDB.open` 抛错 | STORAGE_UNAVAILABLE、halt；0 写；LS 不变 | PASS |
| probe 事务 `SecurityError` | STORAGE_UNAVAILABLE、halt；0 写；LS 不变 | PASS |

**结论：REV3-02 / REV3-03 策略正确；真实浏览器不会进入 Node Mock 分支。**

---

## 6. 微信事务标记（MOCK-WX，非真机）

隔离副本新增 `r4-wechat-marker.test.ts`（审核方独立用例，非候选文件），通过项目 Node runner 执行：**7/7 PASS**（`evidence/wechat-marker.log`）。

覆盖：标记写/读/清与 `list()` 过滤；标记写失败（0 槽位写，loadSafe 可恢复）；标记读失败（commit/loadSafe fail-closed，0 写）；截断损坏（fail-closed，仅原始端口可清）；删除失败（COMMITTED→UNCERTAIN、标记保留、下一提交阻断、恢复后可续写）；确定性 `PRE_WRITE_ERROR`（FAILED、不冻结、清标）；同运行实例跨协调器冻结/恢复/旧 revision CONFLICT。

**明确声明**：以上均为 Mock wx FileSystemManager，**不代表**真实微信文件系统、生命周期、分包或广告验收。微信开发者工具/真机/真实广告仍 **BLOCKED / NOT_RUN**。

---

## 7. A09 / REV3-04 复核

`evidence/a09-evidence-check.txt`：

- R3 组合脚本：T2 PASS；`[stage] A09` 后 120s `[WATCHDOG] abort`，EXIT=3。
- R3 单独复测：两标签页并发 FS 诊断 **6/6 ×2 PASS**，EXIT=0。

与开发方解释（后台标签页 Chromium rAF 节流 + 30–50 笔 IndexedDB 写 + NTFS 刷盘 + 120s 看门狗叠加）一致；完整 `runAllPlatformChecks()` 在后台标签页并发仍 **NOT_RUN**，仅影响诊断脚本，不影响正式存档路径。**归档为非阻塞已知限制。**

---

## 8. 未执行 / 阻塞

| 项 | 状态 |
|---|---|
| 微信开发者工具、真机、真实 FS/生命周期/分包/真实广告 | **BLOCKED / NOT_RUN** |
| 后台标签页并发完整 `runAllPlatformChecks()` | **NOT_RUN**（诊断限制） |
| 非管理员 Windows 文件/目录 symlink | **NOT_RUN**（NTFS Junction/EACCES 已覆盖） |
| 操作系统级真断电/磁盘位翻转 | **NOT_RUN** |
| 真实旧 localStorage 档的正式迁移 | 不属于本轮 |

---

## 9. 测试结论

- 跨页冻结、写前标记、崩溃/刷新/关闭阻断、正常路径、P2 策略、A01/A03–A10 回归：**通过**。
- 恢复边界：**REV4-01、REV4-02 失败**；REV4-03/REV4-04 为 P2 风险。
- 综合判定：**REWORK**。