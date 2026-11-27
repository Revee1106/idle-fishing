# FE-000-R1-INTEGRATION-REWORK-03 测试核验（TEST_VERIFICATION）

- **审核人**：DeepSeek 4.1 Flash 1017
- **环境**：Windows 10.0.19045 x64；Node **v24.20.0**；TypeScript 5.9.3；Chrome **158.0.8127.37**（headless CDP）；Cocos Creator 3.8.8
- **隔离快照**：`C:\Users\WANGWENJIE10\AppData\Local\Temp\fe000-r3-snap`（候选完整副本 + 独立 `node_modules`；所有构建/测试/删除实验均在此执行）
- **被审核工作区**：仅 `E:\idle-fishing-integration` 的只读检查；本审核未修改任何候选文件
- **总体**：回归全绿；A01/A03–A10 独立通过；**A02 跨标签页独立复现失败**

## 1. 证据核验（第一阶段）

| 项 | 结果 | 证据 |
|---|---|---|
| 分支/HEAD/MERGE_HEAD/merge-base | 与任务书一致 | `evidence/git-baseline.txt` |
| 58 暂存后端文件 | 工作树/Index 对 `5bcc9ac` **0 差异**；暂存无前端文件 | 同上 |
| 计数 | staged=58、unstaged=12、untracked=108 | 同上 |
| 68 项 SHA-256 | **68/68 原始字节匹配**（12 修改 + 3 新夹具 + 21 沿用 + 5 报告 + 15 日志 + 12 evidence；清单自排除） | `evidence/manifest-and-coverage.log` |
| 清单覆盖 | 54 个 git 相关候选文件仅缺清单自身；无越界条目；新 3 个夹具在列 | 同上 |
| 历史漂移 | REWORK-02 的 41 个 reports 条目、REWORK-01 的 29 个、INTEGRATION 的 48 个：**0 漂移** | `evidence/historical-drift.log` |
| 构建可复现 | 审核方独立重建 Web：**36/36 文件 SHA-256 与开发方 manifest 逐字节一致**；微信：**41 文件 / 2,019,053 字节完全一致** | `evidence/build-byte-compare.log`、`r3-build-wechat.log` |
| 证据时效 | 最终测试文件 14:55:51 < 测试日志 15:01:39；BootEntry 15:09:41 < Web 构建 15:23:03；verifier 15:51:17 < 两次运行 15:58/16:04 | `evidence/evidence-timing-and-assertions.log` |
| 两次 Web 运行独立性 | 两个独立进程、不同静态端口（59367/60388）、各自 `mkdtemp` Chrome Profile；各 28 断言、各 12 轮、0 双提交 | 同上 |
| 断言集变化 | REWORK-02 28 项 → REWORK-03 28 项；保留 23、移除 5、新增 5（见 §5） | 同上 |

> 未能证明"测试后未重跑"：所有最终源码/测试的 mtime 均早于对应证据日志或构建；未发现此类问题。

## 2. 第四阶段独立回归（快照内、最终源码）

| # | 命令 | 退出码 | 实测 | 日志 |
|---:|---|---:|---|---|
| 1 | `npm run verify` | 0 | 82/82；9 `.mjs` + 9 `.d.mts`；COCOS-02 PASS | `evidence/r3-verify.log` |
| 2 | `npm run test:perf` | 0 | 5/5；envelope `0be078f…ae69f` | `evidence/r3-perf.log` |
| 3 | `node --test …/review-pre.test.mjs` | 0 | 8/8 | `evidence/r3-a1a8.log` |
| 4 | `npm --prefix apps/game-client run typecheck` | 0 | 0 错误 | `evidence/r3-fe-typecheck.log` |
| 5 | `npm --prefix apps/game-client run test:frontend` | 0 | `total=18 pass=18 fail=0 skip=0 todo=0 containerFail=0 procErr=0` | `evidence/r3-fe-tests.log` |
| 6 | `npm --prefix apps/game-client run build:web` | 0 | 36 文件 / 2,060.27 KB | `evidence/r3-build-web.log` |
| 7 | `node tests/frontend/fe-000/verify-web-build.mjs` | 0 | **28/28**；12 轮 0 双提交；console error/pageerror 0 | `evidence/r3-verify-web.log`、`my-verify-web-results.json` |
| 8 | `npm --prefix apps/game-client run build:wechat` | 0 | 41 文件 / 1,971.73 KB | `evidence/r3-build-wechat.log` |
| 9 | `verify-wechat-build.mjs` | 0 | 10/10 | `evidence/r3-verify-wechat.log` |

## 3. A01 独立双标签页矩阵（真实 Chrome）

审核方自建 `r3-race.mjs`，两套独立 Chrome Profile 各执行一次；输出 `evidence/r3-race-profileA.log`、`r3-race-profileB.log` 与 JSON。

| 轮次 | 屏障 | 期望 | 实测（两 Profile） |
|---|---|---|---|
| 空盘 | A 锁内 barrier | A rev1 COMMITTED / B CONFLICT / 磁盘=A | 一致 ×2 |
| 0–5 | 写前（`beforeCommitBody`） | A 每次 rev+1 / B CONFLICT | 6/6 ×2 |
| 6–11 | 写后、回读前（包装 port.read） | 同上 | 6/6 ×2 |
| 汇总 | — | 24/24 + 2/2 空盘，0 双 COMMITTED | **通过** |
| 持锁崩溃 | Tab C 持锁后 `Target.closeTarget` | 自动释放；A 提交 rev21；重载一致 | 通过 ×2 |
| 锁拒绝/缺失 | 替换/删除 `navigator.locks` | STORAGE_UNAVAILABLE、0 写、冻结 | 通过 ×2 |
| A05 | 锁内任务体抛错 | 原错误抛出、健康 AVAILABLE；随后 COMMITTED | 通过 ×2 |
| 每轮 clientId | `navigator.locks.query()` | held≠pending | 全部 true |
| 磁盘唯一候选 | 直接读 IndexedDB | 顶槽 gold/cursor=A 候选 | 全部一致 |

开发方证据复核：`evidence/web-rework03` 与 `-repeat` 各 12 轮、`doubleCommitted=0`、空盘 COMMITTED/CONFLICT、`distinctClients` 全 true；两次运行分别使用不同端口与独立进程/Profile。

**A01：通过。**

## 4. A02 跨协调器冻结（未通过）

### 4.1 直连协调器（`evidence/r3-a02-cross-tab.log`）

| 检查 | 结果 |
|---|---|
| Tab A 写不落盘+读失败 → UNCERTAIN | PASS（UNCERTAIN，健康 `STORAGE_UNAVAILABLE/UNCERTAIN_WRITE_PENDING_RECOVERY`，磁盘 rev2） |
| 同页第二协调器健康/提交 | PASS（冻结，`STORAGE_UNAVAILABLE`，0 写） |
| **Tab B（独立 Realm）未 loadSafe 即提交** | **FAIL：`COMMITTED rev3`，磁盘 rev3，B 健康 `AVAILABLE/NONE`** |
| 显式 loadSafe 后恢复 | PASS（读到 rev3，A/B 健康恢复） |

### 4.2 应用正常 HIDE（`evidence/r3-a02-app-cross-tab.log`）

| 步骤 | 结果 |
|---|---|
| A、B 均启动 rev1 | PASS |
| A 注入 IDB 槽写失败/读失败 + HIDE | PASS：`UNCERTAIN`，halt，磁盘 rev1 |
| **B 普通 HIDE（无恢复）** | **FAIL：`COMMITTED rev2`（gold 84），磁盘 rev2** |
| A 后续 HIDE | 仍 halt/rev1（`SKIPPED_HALTED`） |

**结论：A02 跨标签页未关闭（P1，阻塞）。** 根因与修复建议见 `CODE_REVIEW.md` §3。

## 5. A03–A10 独立测试

| 编号 | 审核方测试 | 结果 | 证据 |
|---|---|---|---|
| A03 | 真实 IndexedDB+fault：缺失/部分 IO/全 IO/恢复 | PASS：EMPTY→PARTIAL(freeze, backup rev2, 0 写)→IO_UNAVAILABLE→VALID rev3→rev4 | `evidence/r3-a03.log` |
| A04 | 生产 harness 键/原型审计；真实 `cc` destroy + HIDE | PASS：仅 14 个只读/UI 键；无清槽；销毁后 refs=null、0 写 | `evidence/r3-a04-a06-migration.log` |
| A05 | 锁内任务体抛错；真实锁拒绝/缺失 | PASS：原错误、健康 AVAILABLE；锁故障 fail-closed | `evidence/r3-race-profileA.log` |
| A06 | 注入首笔 commit reject → 下一 HIDE | PASS：`FAILED` 记录；下一次 `COMMITTED rev2`；无未捕获异常 | `evidence/r3-a04-a06-migration.log` |
| A07 | 原生 TODO vs worker；仅 TODO；挂起超时；29 组矩阵 | PASS：原生 `pass=1 todo=1 fail=0 exit0`；仅 TODO exit1；1500ms 超时约 4s；28/29 组合格（第 19 组另测） | `evidence/r3-a07.log`、`runner-matrix.log` |
| A08 | 元数据 EACCES/lstat/realpath/repoRoot/tmpdir；ADS/扩展/驱动相对路径；Junction/嵌套/悬空；runner 穿越 | PASS 7/7；`rmSync` 0 次；金丝雀存活；文件 symlink `NOT_RUN`（EPERM） | `evidence/r3-a08.log` |
| A09 | 两标签页并发 `runFileSystemAndSaveSuite` | PASS：双方 6/6；单独复测 2/2；临时域隔离 | `evidence/r3-a09-only.log` |
| A10 | 12/3/21 分类与 REWORK-02 逐字节核对 | PASS | `evidence/manifest-and-coverage.log` |
| 附加 | BootEntry 层 UNCERTAIN 停机、排队销毁、运行时 probe/写失败 | PASS（历史断言被移除后的独立补测） | `evidence/r3-boot-behavior.mjs`（首轮日志）、`r3-t2-a09.log`、`r3-runtime-failure.log` |

A07 运行器矩阵为 28 个有效组合格 + "不安全 out-dir"用例由审核方使用正确参数单独复测（exit 1，`SafePathGuard:OUTSIDE_ALLOWLIST`，零删除）。矩阵脚本初版第 19 组误用了合法 out-dir，属审核脚本问题，已单独纠正。

## 6. 组合/边界测试

| 场景 | 结果 |
|---|---|
| A 写入未知 + 同页第二协调器提交 | PASS：冻结，0 写 |
| A 写入未知 + 跨标签页正常 HIDE | **FAIL：B 提交成功（A02 未关闭）** |
| 运行时 probe 失败 + HIDE + 后续 HIDE | PASS：STORAGE_UNAVAILABLE/halt/SKIPPED_HALTED/0 写 |
| 运行时槽写失败 + HIDE + 后续 HIDE | PASS：同上 |
| 队列单笔异常 + 后续 HIDE | PASS：FAILED 后正常提交 |
| 销毁 + HIDE | PASS：0 写、harness 拒绝 |
| 等待锁中销毁（BootEntry 队列两笔） | PASS：两笔 CANCELLED/SKIPPED_DESTROYED，槽不变 |
| 两标签页并发 FS 诊断 | PASS 6/6 ×2（单独复测 2/2） |
| 旧 localStorage 仅存在 | IDB 模式忽略、不删除、新建 IDB 存档 |
| IDB 初始化失败 | STORAGE_UNAVAILABLE，非 EMPTY，0 HIDE 提交 |
| IDB 缺失 | 静默 localStorage 回退、允许写；旧档复活（REV3-02/03） |
| IDB 缺失双页 12 轮 | 本次 0 双 COMMITTED（未复现 P0，但介质非线一致） |

## 7. 开发方证据交叉核对

| 声明 | 核验 |
|---|---|
| `68` 项清单 | 68/68 匹配；覆盖完整 |
| `test:frontend` 18/18 | 日志 mtime 15:01:39 晚于最终测试文件 14:55:51；审核方快照重跑 18/18 |
| `verify:web` 28/28 ×2 | 两运行 JSON 均 28 断言、0 失败；端口不同；12 轮/次 |
| 24 轮 + 2 空盘 0 双提交 | 两 JSON 各 12 轮，`doubleCommitted=0`；审核方另 24 轮同样 0 |
| 两次独立 Profile | 两条独立进程、不同静态端口、`mkdtemp` Profile（代码与运行方式佐证） |
| 构建 36 文件 2060.27 KB | 审核方独立重建 36/36 SHA-256 完全一致 |
| 微信 41 文件 10/10 | 审核方重建 41 文件/同字节数；审计 10/10 |
| A07 抛错 TODO/超时 | 原生语义、runner、超时均独立复核一致 |
| A08 元数据 fail-closed | 独立注入 EACCES 复核一致 |
| 测试后未重跑 | 未发现；最终测试/源码均早于对应日志/构建 |

**断言集变化**：保留 23 项；移除 5 项（`web_p1_02_queued_hide_after_uncertain_halts`、`web_p1_01_runtime_failure_freeze_and_recovery`、`web_p1_02_destroy_cancels_queued_before_write`、`web_p1_02_destroy_started_completes_cleanly`、`web_p2_04_compat_save_cross_tab_commit`）；新增 5 项（生产接口审计、真实销毁零写、UNCERTAIN/部分 IO 合并、排队取消/STARTED 合并、空盘+12 轮竞争）。审核方用自建测试补齐了被移除的 BootEntry 级冻结/停机/排队销毁覆盖（REV3-05 仍建议恢复）。

## 8. 审核脚本自我修正（透明记录）

1. `r3-a02.mjs` 初版误写 `coord1.coord2.storageHealth`，改为 `coord2` 后获取到同页冻结证据；
2. A06 断言字段误用 `lastCommitKind`（页面返回 `last`），修正后确认队列恢复；
3. 迁移测试在"IDB 缺失"状态下调用 IDB helper 导致 TypeError，调整为先恢复脚本再清理；旧档检查移除了"新档 gold 必须不同"的不成立假设；
4. A08 的 tmpdir 用例初版让 repoRoot realpath 一并失败、悬空 Junction 期望码过严；修正注入范围后 7/7；
5. T2 初版未等待任务落历史，增加 1.2s 收敛等待后两笔均 `CANCELLED`；
6. 完整平台检查并发用例因后台标签页分包加载挂起，改用并发 `runFileSystemAndSaveSuite` 验证 A09 存储隔离（完整用例标 `NOT_RUN`）；
7. 运行器矩阵脚本第 19 组的 out-dir 参数误用，另行正确复测。

上述修正仅涉及审核脚本，不涉及产品代码；最终证据均来自真实执行。

## 9. 未执行 / BLOCKED / NOT_RUN

- **微信开发者工具、微信真机、真实激励广告**：无环境，`BLOCKED/NOT_RUN`，未用静态审计替代。
- **Windows 独立目录符号链接**：当前用户 EPERM，`NOT_RUN`；Junction/嵌套 Junction 已实测。
- **完整 `runAllPlatformChecks()` 后台标签页并发**：观察到挂起，`NOT_RUN`（FS 诊断并发已通过）。
- **Safari/Firefox Web Locks/IndexedDB 差异**：未测。
- **真实操作系统崩溃/断电**：仅用 `Target.closeTarget` 模拟持锁页关闭；未模拟进程崩溃或断电。
- **无 IndexedDB 浏览器的双 COMMITTED**：12 轮未复现；仍需 fail-closed 或明确不支持。
- **跨设备/跨进程 CAS**：按契约 P0 不承诺。