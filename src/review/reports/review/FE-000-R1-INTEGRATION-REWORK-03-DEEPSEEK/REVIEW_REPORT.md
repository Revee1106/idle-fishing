# FE-000-R1-INTEGRATION-REWORK-03 第一轮独立技术初审报告

- **审核任务**：`FE-000-R1-INTEGRATION-REWORK-03` 第一轮独立技术初审
- **审核人**：DeepSeek 4.1 Flash 1017
- **审核日期**：2026-11-26
- **审核对象**：`E:\idle-fishing-integration` 完整候选工作区（`integration/fe-000-be-r1`）
- **基线**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2`、`MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`、`merge-base=358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- **开发方状态声明**：`READY_FOR_INDEPENDENT_REVIEW`
- **审核方式**：只读源码审查 + Git 只读核验 + 隔离快照独立构建/回归 + 真实 Chrome 双标签页/多 Profile 独立测试
- **最终结论**：

# REWORK

A01（P0 双 COMMITTED）、A03、A04、A05、A06、A07、A08、A09（FS 诊断隔离）、A10 已通过独立验证；**A02（UNCERTAIN 跨协调器冻结）仅在同一 JS Realm 内生效，跨标签页仍可绕过并写入**。这直接违反本轮任务书第 2 节 P1-01 与审核任务 A02 的"同一存档域内任何其他协调器实例……均拒写且零物理写入"要求，因此不允许进入 GATE-01。

> 本结论仅为 DeepSeek 第一轮初审结论，不代表 Astra 复审通过，也不代表 GATE-01 已批准。

## 1. 结论依据（A01–A10 完整对应）

| 编号 | 级别 | 审核结果 | 独立证据摘要 |
|---|---|---|---|
| **A01** | **P0** | **关闭** | 真实 Chrome 158 双标签页：空盘竞争 1 次，非空盘 12 轮交错（6 轮写前屏障 + 6 轮写后回读前屏障）；审核方两套全新 Chrome Profile 各 12 轮，加开发方两轮共 **48 轮 + 4 次空盘竞争，0 次双 COMMITTED**；每轮 A=COMMITTED(rev预期+1)、B=CONFLICT、盘面唯一赢家。IndexedDB(`idle_fishing_fs_v1`/`files`) + Web Locks 真实接入；持锁页崩溃后自动释放并可恢复提交。`evidence/r3-race-profileA.log`、`r3-race-profileB.log` |
| **A02** | **P1** | **未关闭（阻塞）** | 同一页面两个协调器共享冻结；**跨标签页不共享**。Tab A 正常 HIDE 产生 UNCERTAIN/halt（健康 `STORAGE_UNAVAILABLE`）后，Tab B（独立 Realm、健康 `AVAILABLE`）无需 `loadSafe()` 即以正常 HIDE 提交 `rev2` 到磁盘；直连协调器路径同样 `COMMITTED rev3`。根因是 `namespaceHealth` 为模块级内存 Map，无跨 Realm 持久化。`evidence/r3-a02-cross-tab.log`、`r3-a02-app-cross-tab.log` |
| **A03** | **P1** | **关闭** | 缺失槽→EMPTY/AVAILABLE；最新槽 IO 失败→`STORAGE_UNAVAILABLE/PARTIAL_IO_UNAVAILABLE`、`readOnlyBackup=rev2`、健康冻结、其它协调器 0 写；三槽全 IO→`IO_UNAVAILABLE`；恢复后 `VALID rev3`→AVAILABLE→`COMMITTED rev4`。`evidence/r3-a03.log` |
| **A04** | **P1** | **关闭** | 生产 Web 构建 `__SPIKE_HARNESS__` 仅含 14 个只读/导航键，无 `clearLifecyclePersistence`/`getPersistCoordinator`/`commitCandidateViaCoordinator`/`triggerDestroyForTest` 等；协调器原型无 `clearSlotsForTest`；真实 Cocos 3.8.8 `destroy()` 后引用置空、HIDE 零物理写。`evidence/r3-a04-a06-migration.log` |
| **A05** | **P2** | **关闭** | 已持锁任务体抛错原样抛出（`audit body throw`），健康保持 `AVAILABLE`；真实锁拒绝/缺失分别 `CROSS_TAB_LOCK_REJECTED`/`CROSS_TAB_LOCK_UNAVAILABLE` 且冻结。`evidence/r3-race-profileA.log` |
| **A06** | **P2** | **关闭** | 单笔队列任务异常记录 `FAILED` 后，下一正常 HIDE 仍 `COMMITTED rev2`，队列未被永久 rejected；无未捕获异常。`evidence/r3-a04-a06-migration.log` |
| **A07** | **P2** | **关闭** | 抛错 TODO 与 Node 24.20.0 原生一致（`pass=1 todo=1 fail=0 exit 0`）；仅抛错 TODO 仍触发零通过门禁（exit 1）；1200–1500ms 强制超时 `SIGKILL`、`procErr=1`、约 4s 返回；29 组运行器矩阵 28 组合格（第 19 组由审核方单独以正确参数复测）。`evidence/r3-a07.log`、`runner-matrix.log` |
| **A08** | **P2** | **关闭** | lstat/realpath/ repoRoot/tmpdir 元数据 EACCES 全部 fail-closed；删除前 `lstat` 失败拒绝且 `rmSync` 0 次；扩展路径、驱动器相对路径、ADS、UNC、Junction、嵌套 Junction、悬空 Junction 全部拒绝或安全处理；符号链接文件因 Windows EPERM 标 `NOT_RUN`。`evidence/r3-a08.log` |
| **A09** | **P3** | **关闭（存储隔离）/ 附加观察** | 每轮诊断使用 `idle_fishing_spike_diag_<ts>_<rand>` 临时域并在 finally 清理；两标签页并发运行 FS/Save 诊断均 6/6（单独复测 2/2）。完整 `runAllPlatformChecks()`（含 Cocos 分包加载）在后台标签页并发运行时观察到挂起，标记 `NOT_RUN`（非存储缺陷，见 REV3-04）。`evidence/r3-t2-a09.log` |
| **A10** | **P3** | **关闭** | 实施报告严格区分 12 个本轮修改、3 个新增夹具、21 个沿用文件；审核方按 REWORK-02 清单逐字节核对一致。上轮 DeepSeek 提出的 REV2-09（18 vs 19 组）经 Astra 复核不成立，本次撤回。`evidence/manifest-and-coverage.log` |

## 2. 其他发现

| 编号 | 级别 | 摘要 | 阻塞 GATE-01 |
|---|---|---|---|
| **REV3-01** | **P1** | A02 跨标签页冻结未共享（即上表 A02） | **是** |
| REV3-02 | P2 | 浏览器缺失 `indexedDB` 时静默回退到 localStorage（非线一致介质）并允许写入；本次 12 轮未复现双 COMMITTED，但重新引入 P0 机制风险；同时会"复活"IDB 模式忽略的旧 localStorage 存档 | 否（需设计方明确 Web 无 IDB 环境策略；建议 fail-closed） |
| REV3-03 | P2 | 无 localStorage→IndexedDB 迁移；旧存档不被读取也不被删除；开发方已在 ISSUE_REPORT §2.2 记录"无正式线上玩家数据"前提，但缺少正式设计决定 | 否（需负责人/设计方确认前提与策略） |
| REV3-04 | P3 | 完整平台检查在后台标签页并发时挂起（FS 诊断并发正常）；未定位，标记 NOT_RUN | 否 |
| REV3-05 | P3 | Web 断言集合以 5 项新断言替换 5 项旧断言；被移除的 BootEntry 级运行时冻结/UNCERTAIN 停机/排队销毁断言由审核方独立补测通过，但建议恢复进回归套件 | 否 |
| REV3-06 | P3 | BootEntry 队列 catch 记录 FAILED 但不置 `persistenceHalted`；当前协调器已把未知结果转为 UNCERTAIN/STORAGE_UNAVAILABLE，未见实际缺口 | 否 |
| REV3-07 | P3 | 生产包仍可经 SystemJS `chunks:///_virtual/...` 构造协调器、经 `cc` 获取/销毁 BootEntry；这是打包器固有可访问性，非测试专用 API，A04 的 harness 清理本身有效 | 否 |
| REV3-08 | P3 | `safe-path-guard` 校验与 `rmSync` 之间存在 TOCTOU 窗口（开发工具场景，未利用） | 否 |

逐项 10 字段见 `DESIGN_ISSUES.md`。

## 3. Git 与交付完整性（第一阶段）

| 项目 | 核验结果 |
|---|---|
| 分支 / HEAD / MERGE_HEAD / merge-base | 全部与任务书一致 |
| Index / 工作树 / 未跟踪 | 58 暂存（全部后端）；12 未暂存（前端）；108 未跟踪（含 REWORK-01/02/03 报告与历史证据） |
| 58 个后端受保护文件 | 工作树与 Index 对 `5bcc9ac` 均 **0 差异**；暂存区无任何 `apps/game-client`/`tests/frontend` 文件 |
| 68 项 `FILES-REWORK.sha256` | **68/68 原始字节匹配**；覆盖 12 个修改文件、3 个新夹具、21 个沿用文件、5 份报告、15 个日志、12 个 evidence；清单自身按惯例自排除 |
| 历史审核材料 | REWORK-02 的 41 个 reports 条目、REWORK-01 的 29 个、INTEGRATION 的 48 个：**0 漂移** |
| 构建产物可复现 | 审核方独立重建 Web：36/36 文件 SHA-256 与开发方 manifest **逐字节一致**；微信：41 文件/2,019,053 字节与开发方审计**完全一致** |
| 证据时效 | 最终 `platform-and-core.test.ts`(14:55:51) 早于 `r3-frontend-tests.log`(15:01:39)；最终 `BootEntry.ts`(15:09:41) 早于 Web 构建(15:23:03)；最终 `verify-web-build.mjs`(15:51:17) 早于两次 Web 运行(15:58/16:04)；未发现"改测试/源码后未重跑"的证据 |

## 4. 第五阶段独立回归（隔离快照，全部使用最终候选源码）

| 命令 | 退出码 | 实测 |
|---|---:|---|
| `npm run verify` | 0 | 82/82，含 `9 .mjs + 9 .d.mts` 与 `typecheck:cocos` |
| `npm run test:perf` | 0 | 5/5 一致性；24h envelope SHA-256 `0be078f…ae69f` |
| A1–A8 历史反例 | 0 | 8/8 |
| `npm --prefix apps/game-client run typecheck` | 0 | 0 错误 |
| `npm --prefix apps/game-client run test:frontend` | 0 | 18/18（含 A02/A03/A05/A07/A08 回归） |
| `npm --prefix apps/game-client run build:web` | 0 | 36 文件 / 2,060.27 KB |
| `npm --prefix apps/game-client run verify:web` | 0 | 28/28；12 轮竞争 0 双 COMMITTED；console error/pageerror 0 |
| `npm --prefix apps/game-client run build:wechat` | 0 | 41 文件 / 1,971.73 KB |
| `verify-wechat-build.mjs` | 0 | 10/10 |

宿主分层：Tier 1–5 实测 PASS；**微信 IDE、真机、真实广告仍 NOT_RUN/BLOCKED**（无环境），未用静态审计替代。

## 5. 结论与后续

- **A01、A03–A10 关闭；A02 未关闭（P1，阻塞）**，因此本轮为 **REWORK**。
- 必须整改项：REV3-01（跨标签页 UNCERTAIN 冻结）。建议同批处理 REV3-02（无 IndexedDB 时 fail-closed），以避免 A02 的修复在回退路径上再次失效。
- 设计方/负责人需确认：REV3-03 的无迁移前提；Web 在无 IndexedDB 环境下的策略。
- 修复合规后须重新执行全量回归与独立双 Profile 竞争复验；Astra 复审由负责人安排。
- 未提交、未推送、未合并；仅在本审核目录与本审核工作区输出报告与证据。

## 6. 交付物

- `REVIEW_REPORT.md`（本文件）
- `CODE_REVIEW.md`
- `TEST_VERIFICATION.md`
- `DESIGN_ISSUES.md`
- `ACCEPTANCE_CHECKLIST.md`
- `EVIDENCE_MANIFEST.sha256`
- `evidence/` — 独立执行日志、脚本、JSON、Git/SHA 核验记录