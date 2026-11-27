# FE-000-R1-INTEGRATION-REWORK-04 定向独立技术复验报告

- **任务**：`FE-000-R1-INTEGRATION-REWORK-04` 定向独立复验（DeepSeek 4.1 Flash 1017）
- **开发方**：Gemini Neon High（`READY_FOR_INDEPENDENT_REVIEW`）
- **复验日期**：2026-11-27
- **开发工作区**：`E:\idle-fishing-integration`（只读检查，未做任何修改）
- **分支**：`integration/fe-000-be-r1`
- **HEAD**：`be62996fae44df24094331d670f6f0ab3741a4f2`
- **MERGE_HEAD**：`5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`
- **merge-base**：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- **隔离复验副本**：`C:\Users\WANGWENJIE10\AppData\Local\Temp\fe000-r4-snap`（与候选 36 个代码/测试文件逐字节一致）
- **审核输出**：`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-04-DEEPSEEK\`

> 本结论仅代表 DeepSeek 第一轮定向独立复验，不代表 GPT-6.2 Astra High 复审通过，也不代表 GATE-01 已批准，不启动 BE-001 / FE-001。

---

## 1. 最终结论

# **REWORK**

**核心判断**：跨标签页 `UNCERTAIN` 冻结（A02 的主安全目标）在真实 Chrome 中已关闭；REV3-02 / REV3-03 的浏览器存储策略实现正确；A01、A03–A10 未见退化。但 A02 的**显式恢复边界**仍有两项 P1 实质缺口，不能给出 PASS：

1. **REV4-01（P1，数据安全）**：一个此前已有有效存档（`PENDING` 标记的 `expectedRevision='1'`）的存档域，在其 3 个槽位全部消失后，显式 `loadSafe()` 会仅凭 `EMPTY` 清除待确认标记并恢复 `AVAILABLE`，未按任务书 5.4 “不能仅凭 EMPTY 清除待确认标记” fail-closed。实测得到 `recKind=EMPTY`、`markerAfter=null`、`health=AVAILABLE`。
2. **REV4-02（P1，功能正确性/可恢复性）**：应用没有明确的恢复入口。`BootEntry` 只在启动时调用 `loadSafe({ clearPendingTxMarker: false })`；一旦存在 `PENDING/UNCERTAIN/FROZEN` 标记，应用永久 halt，刷新仍 halt；`__SPIKE_HARNESS__` 的 14 个键中没有任何恢复/确认入口；实测在另一协调器已完成显式恢复后，原标签页的 `BootEntry` 仍为 `storageHealth=STORAGE_UNAVAILABLE, persistenceHalted=true`。任务书 5.4 “应用存在明确的恢复入口，不依赖破坏性诊断 API” 未满足。

另有两项 P2、若干 P3（详见 `DESIGN_ISSUES.md`）：损坏/不可读标记经公开 API 无法恢复（微信上标记文件非原子写入可能被撕裂）；`QUOTA_EXCEEDED` 等真实写失败被保守冻结且没有恢复入口，未按任务书 5.3 说明玩家影响与可恢复性；开发方报告对 “A02 已关闭” 的表述过宽；微信事务标记缺少开发方自己的 Mock 定向用例。

---

## 2. 基线、证据与候选身份

| 核验项 | 结果 |
|---|---|
| `HEAD` / `MERGE_HEAD` / `merge-base` | 与任务书一致，未变 |
| 工作区状态（相对 HEAD） | 暂存 58、未暂存 12、未跟踪 126；前端整改仍在工作树，未提交 |
| REWORK-04 `FILES-REWORK.sha256` | **64/64 OK**（逐字节） |
| REWORK-03 DeepSeek 初审 `EVIDENCE_MANIFEST.sha256` | **60/60 OK** |
| 58 个受保护后端文件 | `git diff 5bcc9ac -- packages/ tests/backend reports/backend tsconfig*.json package.json package-lock.json` = **0 行** |
| 历史报告 | `FE-000-R1-INTEGRATION` 48/48、`REWORK-01` 29/29、`REWORK-03` 32/32 报告条目 OK；`REWORK-02` 目录与 R3 快照逐字节一致；`reports/frontend`、`reports/review` 0 漂移 |
| 整改差异声明 | **8 个修改文件**（6 前端源码 + 2 测试）与另外 **28 个沿用文件**逐字节一致；**0 新增源码/夹具**（相对 REWORK-03）——与声明相符 |
| 候选 36 个代码/测试文件 | 与 R4 清单逐一 SHA-256 匹配；`SingleWriterSaveCoordinator.ts` 为工作树未跟踪文件，但哈希匹配清单 |
| 最终构建/测试与候选对应 | 源码 mtime（08:54–09:31）均早于对应日志（09:06–09:45）；我独立重建 Web **36/36 SHA-256 与开发方 build manifest 完全一致** |
| 构建产物 | Web **36 文件 / 2,124,709 字节**；微信 **41 文件 / 2,034,046 字节**；与开发方声明一致 |

完整证据见 `evidence/checks.txt`、`evidence/rebuild-hash-check.txt`、`evidence/source-and-log-mtimes.txt`、`evidence/candidate-identity.txt`（HEAD/MERGE_HEAD/merge-base、R4 清单哈希、8 个变更文件哈希、28 个沿用文件计数）与 `EVIDENCE_MANIFEST.sha256`。

---

## 3. A02 定向复验结论（任务书第 5 节）

### 3.1 持久化事务状态（5.1）

| 检查项 | 结论 | 关键证据 |
|---|---|---|
| 同一存档域共享持久化标记 | **PASS** | 浏览器 `${namespace}:__tx_state__`（IndexedDB 同库/store）；微信 `__tx_state__.json`；`storageKey` 绑定 |
| 跨标签页读真实持久化标记，非本地缓存 | **PASS** | 真实 Chrome 两 Realm：Tab B 在 Tab A `UNCERTAIN` 后读盘得标记并拒绝；`SHARED_FREEZE_PENDING_RECOVERY` |
| Web Locks 覆盖标记读/写/提交/回读/清理 | **PASS** | 全部在 `withExclusiveLock` 内；交错恢复/等待提交实测安全 |
| PENDING 在改真实存档前持久化 | **PASS** | 在第一次 `port.write` 前落盘；实测槽位写前标记已可见（`state=PENDING`） |
| 标记不可读/不可写时禁止存档写入 | **PASS** | 写标失败：`slotWriteCalls=0`；读标失败：0 写入 |
| 标记清理失败不返回虚假 COMMITTED | **PASS** | 返回 `UNCERTAIN`，标记保留，下一提交被阻断 |
| UNCERTAIN 后换协调器/刷新/关闭不绕过 | **PASS** | 应用级实测：A `UNCERTAIN`→B 正常 HIDE、直连协调器、A destroy/reload/close 后均 `STORAGE_UNAVAILABLE`、0 写入、槽位不变 |
| 不同存档域互不干扰 | **PASS** | 主域冻结时独立域 `EMPTY→COMMITTED` |

### 3.2 真实 Chrome 14 项场景（5.2）

| # | 场景 | 结果 |
|---:|---|---|
| 1 | A 正常 HIDE `UNCERTAIN`，B 正常 HIDE 拒绝 | **PASS**（独立应用级脚本） |
| 2 | A `UNCERTAIN`，B 直连协调器拒绝 | **PASS**（0 写入） |
| 3 | A 刷新后标记仍有效 | **PASS**（刷新后 A 仍 halt，B 仍被阻断） |
| 4 | A 关闭后 B 仍不能绕过 | **PASS**（`Target.closeTarget` 后 B 仍阻断） |
| 5 | PENDING 写入失败，真实槽位零写入 | **PASS**（0 次 slot write） |
| 6 | PENDING 成功、写槽前崩溃 | **PASS**（PENDING 留存；观察者阻断；恢复 rev1） |
| 7 | 已写盘、回读未完成时崩溃 | **PASS**（盘面 rev2；PENDING 留存；恢复 rev2；旧 revision CONFLICT） |
| 8 | 提交完成但标记清理失败 | **PASS**（`UNCERTAIN`，标记保留；恢复 rev2） |
| 9 | 标记损坏或读取失败 | **PASS（安全侧）**：损坏→`TX_STATE_UNREADABLE`、0 写入；但**无法通过公开 API 恢复**（REV4-03） |
| 10 | 部分槽位 IO 不可用时恢复 | **PASS**（`PARTIAL_IO_UNAVAILABLE`、readOnlyBackup rev2、保持冻结；IO 恢复后 rev3） |
| 11 | 显式恢复成功后重新提交 | **PASS**（rev2/rev3 均成功） |
| 12 | 显式恢复后旧实例提交 | **PASS**：旧冻结实例在恢复后以过期 revision 提交得 `CONFLICT`（后端 CAS）；同 Realm 的旧实例如 expectedRevision 与盘面一致则合法续写 |
| 13 | 不同存档域同时运行 | **PASS** |
| 14 | 恢复与另一标签页等待提交交错 | **PASS**（Web Lock 串行；不允许在未恢复标记下写入） |

### 3.3 正常路径不退化（5.3）

| 路径 | 结果 |
|---|---|
| 正常 `COMMITTED` | **PASS**（rev1/rev2；标记写前可见，提交后清除） |
| 正常 `CONFLICT` | **PASS**（不写标、不冻结、0 物理写入） |
| 确定性写前失败（`PRE_WRITE_ERROR`） | **PASS**（`FAILED`、清标、不冻结、可立即重试） |
| 确定性事务失败（标记写失败） | **PASS（安全侧）**：`STORAGE_UNAVAILABLE`、0 槽位写入、本地冻结；`loadSafe()` 可恢复 |
| `UNCERTAIN` | **PASS（安全侧）**：写标升级/保留、冻结；需显式恢复 |
| 标记清理失败 | **PASS（安全侧）**：`UNCERTAIN`、标记保留、下一提交阻断 |
| **有效存档域 + 标记 + 槽位消失 → EMPTY** | **FAIL**（REV4-01）：`loadSafe()` 仅凭 EMPTY 清标并恢复 AVAILABLE |
| **真实写失败（如 QUOTA）/标记无法写导致冻结** | **风险（REV4-04）**：保守冻结且无应用恢复入口；未说明玩家影响 |

### 3.4 显式恢复边界（5.4）

| 检查项 | 结论 |
|---|---|
| 自动启动/刷新/SHOW/HIDE 不静默解冻 | **PASS**：启动固定 `clearPendingTxMarker:false`；刷新后仍 halt；HIDE 不再提交 |
| 所有槽位真实读取及校验后才允许恢复 | **PASS（VALID/EMPTY 路径）**：3 槽逐槽读取，IO 错误保持冻结 |
| 不可访问的存档不误判为 EMPTY | **PASS**：部分/全部 IO 错误→`PARTIAL_IO_UNAVAILABLE`/`IO_UNAVAILABLE` |
| 已有有效存档的域不能仅凭 EMPTY 清标 | **FAIL**（REV4-01） |
| 恢复后严格 `expectedRevision` | **PASS**：后端 CAS；旧 revision → `CONFLICT` |
| 应用存在明确恢复入口，不依赖破坏性诊断 API | **FAIL**（REV4-02）：`BootEntry` 只有启动 `loadSafe(false)`；harness 无恢复键；外部恢复后原 `BootEntry` 仍 halt |

---

## 4. P2 存储策略（REV3-02 / REV3-03）

真实 Chrome 158 独立实测（`evidence/r4-p2.*`）：

| 场景 | 结果 |
|---|---|
| 同时存在新 IDB 存档与旧 localStorage 存档 | **PASS**：IDB 胜出（VALID rev1），旧档报告 `DETECTED_IGNORED_NO_AUTO_MIGRATION`，字节不变 |
| 只有旧 localStorage 存档 | **PASS**：EMPTY，旧档报告并保留，不复活、不删除、不覆盖 |
| 页面重复启动 | **PASS**：稳定 |
| `indexedDB` 缺失 | **PASS**：`STORAGE_UNAVAILABLE`、halt、0 localStorage 写、旧档不变 |
| `indexedDB.open` 抛出 | **PASS**：同上 |
| IndexedDB 事务/权限失败（probe SecurityError） | **PASS**：同上 |
| Node 显式 Mock | **PASS**：仅 `allowLocalStorageMockInNode && isNodeTestHost()`；真实 Chrome 即使传 opt-in 仍 `BROWSER_STORAGE_UNAVAILABLE`、`STORAGE_UNAVAILABLE` |
| 真实浏览器误入 Node Mock 分支 | **PASS**：未发生（`isNodeTestHost()=false`） |

旧档复活被彻底杜绝；不自动迁移符合本轮批准策略。正式迁移体系仍为设计待决项（开发方 ISSUE_REPORT §4），不属于本轮缺陷。

---

## 5. 微信端事务标记（Mock）与真实微信边界

- 独立 `[MOCK-WX]` 定向用例 **7/7 PASS**（`evidence/r4-wechat-marker.test.ts`、`evidence/wechat-marker.log`）：标记写/读/清、写失败、读失败、截断损坏、删除失败、确定性写前失败、同实例跨协调器冻结与恢复、旧 revision CONFLICT。
- 明确区分：上述结果**不能替代**真实微信文件系统/生命周期/分包/广告位验收。微信开发者工具、真机、真实广告仍 **BLOCKED / NOT_RUN**。
- **风险（REV4-03）**：微信标记文件通过 `writeFileSync` 直接写入，非临时文件+重命名的原子写；崩溃可能留下截断标记。当前实现遇到损坏标记永久 fail-closed，公开 API 无法清除，只能原始端口删除。真实微信上这会变成“无法存档/读档”的砖化风险，需在真机补验前提供受控恢复或原子写。

---

## 6. A09 / REV3-04

核对 `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\evidence\` 原始证据：

- `r3-t2-a09.log`：`[stage] A09` 后 `[WATCHDOG] abort`，`EXIT=3`。
- `r3-a09-only.log`：两标签页并发 `runFileSystemAndSaveSuite` 均 6/6 PASS（独立临时命名空间），`EXIT=0`。

开发方对 Chromium 后台标签页 `requestAnimationFrame` 节流 + 组合看门狗的解释与原始证据一致；完整 `runAllPlatformChecks()` 在后台标签页并发仍 **NOT_RUN**，仅影响诊断脚本，不影响正式存档路径。**归档为非阻塞已知限制**。

---

## 7. 全量回归（独立执行）

| 项 | 结果 |
|---|---|
| 后端 `npm run verify` | **82/82 PASS**（exit 0） |
| `npm run test:perf` | 5/5 一致；envelope SHA-256 `0be078f1…ae69f`（exit 0） |
| A1–A8 历史反例 | **8/8 PASS** |
| 前端 typecheck | **0 错误** |
| 前端 `test:frontend` | **20/20 PASS**（18 旧 + 2 新，旧用例未删） |
| 全新 Cocos Web 构建 | 36 文件 / 2,124,709 字节；36/36 SHA-256 与开发方一致 |
| 微信构建 + 审计 | 41 文件 / 2,034,046 字节；**10/10 PASS** |
| 真实 Chrome Web E2E — Profile 1 | **31/31 PASS**；12 轮非空竞争 + 空盘竞争；`doubleCommitted=0`；崩溃后 rev21 |
| 真实 Chrome Web E2E — Profile 2 | **31/31 PASS**；同上，独立 Profile |
| 断言保留 | R3 的 **28/28** Web 断言与 **18/18** Node 用例全部保留；新增 3 + 2 |

两套 Profile 均为独立临时 Chrome `--user-data-dir`；每套 12 轮非空交错竞争（写前/写后回读前屏障），合计 24 轮 + 2 次空盘竞争，0 次双 `COMMITTED`。另用审核方独立编写的 A01 竞争脚本（`evidence/r4-race.mjs`，不复用开发方 E2E）在两套独立 Profile 各跑 12 轮：`doubles=0`、空盘竞争一 COMMITTED 一 CONFLICT、持锁页崩溃后幸存页续写 rev21（`evidence/r4-race-A.log`、`r4-race-B.log`、`race-A.json`、`race-B.json`）。

---

## 8. 限制与未执行项

| 项 | 状态 |
|---|---|
| 微信开发者工具 / 真机 / 真实 FS / 生命周期 / 分包 / 真实激励广告 | **BLOCKED / NOT_RUN** |
| 后台标签页并发完整 `runAllPlatformChecks()` | **NOT_RUN**（REV3-04 已知限制） |
| 非管理员 Windows 符号链接（文件/目录 symlink） | **NOT_RUN**（NTFS Junction、EACCES 等已由历史证据覆盖） |
| 操作系统级真断电 / 磁盘静默位翻转 | **NOT_RUN**（CDP 关闭渲染进程不等于硬件断电） |
| 真实旧 localStorage 实验存档的正式迁移 | 不属于本轮；开发方已记录设计待决项 |

---

## 9. 结论与下一步

- **REWORK**，阻塞项为 **REV4-01（EMPTY 清标）** 与 **REV4-02（无应用级显式恢复入口）**，均属于 A02 / 任务书 5.4 的显式恢复边界。
- 跨标签页冻结、写前标记、崩溃/刷新/关闭阻断、P2 存储策略、A01、A03–A10 回归均通过，**无既有安全能力退化**。
- 开发方需修复上述 P1，并补充针对“有效存档 + 标记 + 槽位消失”和“应用内恢复入口”的独立用例；P2（损坏标记、quota 冻结）建议一并处理或在报告中明确接受理由、玩家影响与可恢复性。
- 修复后需重新执行全量回归与双 Profile A02 场景，再交 GPT-6.2 Astra High 最终独立复审。**本轮未提交、未推送、未合并任何分支。**