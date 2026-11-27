# FE-000-R1-INTEGRATION-REWORK-03 设计/实现问题清单（DESIGN_ISSUES）

- **审核人**：DeepSeek 4.1 Flash 1017
- **总判定**：**REWORK**。A02 未关闭（P1，阻塞）；其余 A01/A03–A10 关闭。
- **问题级别**：P0 数据损坏/假绿/误删；P1 功能/协议错误；P2 重要但可控/需设计决定；P3 改进建议。

---

## REV3-01 A02 UNCERTAIN 冻结不跨标签页（P1，阻塞）

- **编号**：REV3-01
- **严重程度**：**P1**
- **文件和行号**：
  - [SingleWriterSaveCoordinator.ts:98-100](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L98)（`namespaceHealth` 模块级 Map）
  - [SingleWriterSaveCoordinator.ts:123-138](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L123)（本地读写）
  - [SingleWriterSaveCoordinator.ts:402-410](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L402)（提交入口只查本地 Map）
  - [SingleWriterSaveCoordinator.ts:468-474](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts#L468)（UNCERTAIN 只标本地 Map）
  - [BootEntry.ts:512-535](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L512)（`persistenceHalted` 仅实例级）
- **触发条件**：两个同源标签页共享同一 `storageKey`（`browser:idle_fishing_lifecycle_persist_fs`）。Tab A 的提交返回 `UNCERTAIN`（例如写未落盘且复扫读失败）；Tab B 的协调器/实例未执行 `loadSafe()`。
- **独立复现步骤**：
  1. 真实 Chrome 158 打开同源 Tab A、B，均使用生产构建；
  2. A、B 均读到 rev1；
  3. Tab A 注入 IndexedDB 槽写失败（写前抛错）+ 之后槽读失败，触发一次 HIDE → A 得到 `UNCERTAIN`，`persistenceHalted=true`，磁盘仍 rev1；
  4. Tab B 触发普通 `visibilitychange` HIDE（不调用 `loadSafe()`）；
  5. 脚本：`evidence/r3-a02-app-cross-tab.log`；直连协调器版本：`evidence/r3-a02-cross-tab.log`。
- **实际结果**：Tab B `COMMITTED rev2`（gold 84），磁盘 rev2；Tab B 协调器 `storageHealth='AVAILABLE'`、`freezeCode='NONE'`。直连协调器版本为 `COMMITTED rev3`。
- **预期结果**：B 必须返回 `STORAGE_UNAVAILABLE` 且 **0 物理写入**，直到同一存档域内完成一次完整 `loadSafe()`（全部槽位可读、VALID/EMPTY）。
- **设计依据**：
  - `FE-000-R1-INTEGRATION-REWORK-03/TASK.md` §2 P1-01："任意其他协调器实例或直连提交入口在显式完成 loadSafe() 恢复前均拒写且零物理写入"；
  - 本次审核任务 §六 A02："不同标签页不同协调器……必须证明同一存档域不会因为更换协调器实例或标签页而绕过故障隔离"；
  - `docs/interfaces/19` 第 67 行：未知写结果返回 UNCERTAIN，停止业务写入并立即复扫，不能确认则保持 RECOVERING/ERROR。
- **是否阻塞 GATE-01**：**是**。
- **整改建议**：
  1. 在同一 IndexedDB 数据库中持久化域级 `needsRecovery` 标记（与存档同库，`storageKey` 级）；每次 `commit` 在获得 Web Lock 后先读取该标记，存在即 `STORAGE_UNAVAILABLE`；
  2. `UNCERTAIN` 时写入该标记（若写失败，保持本地冻结并用 `BroadcastChannel` 通知同源标签页冻结）；
  3. 只有完整 `loadSafe()` 成功后才清除标记；任何实例的恢复都会解除全域名冻结；
  4. 在 `verify-web-build.mjs` 增加"跨标签页 UNCERTAIN → B 0 写"回归；保留同页两协调器用例。

---

## REV3-02 浏览器缺失 IndexedDB 时静默回退 localStorage（P2，不阻塞但需策略决定）

- **编号**：REV3-02
- **严重程度**：**P2**
- **文件和行号**：
  - [BrowserFilePort.ts:54-60](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts#L54)（`getIndexedDbFactory`）
  - [BrowserFilePort.ts:73-87](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts#L73)（`useIndexedDb=false` 时直接选择 localStorage）
  - [BrowserFilePort.ts:149-173](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts#L149)（localStorage probe）
- **触发条件**：真实浏览器中 `window.indexedDB` 不存在（策略禁用、嵌入环境、极旧浏览器），而 `localStorage` 可用。
- **独立复现步骤**：
  1. 通过 `Page.addScriptToEvaluateOnNewDocument` 在应用脚本前执行 `window.indexedDB = undefined`；
  2. 加载生产 Web 构建；
  3. 读取 `BrowserFilePort.kind`；触发 HIDE；检查 localStorage 槽键与 BootEntry 记录；
  4. 脚本：`evidence/r3-a04-a06-migration.log` 第 4 项；双页 12 轮：`evidence/idb-disabled-race-idbOff.json`。
- **实际结果**：`kind='BROWSER_LOCAL_STORAGE_FALLBACK'`；启动 `EMPTY`；HIDE `COMMITTED rev1`，localStorage 出现 `save_slot_0.json`（静默降级，允许写入）。12 轮双页竞争本次未复现双 COMMITTED。
- **预期结果**：若一个环境无法提供线性一致的持久化介质，应 **fail-closed**（`STORAGE_UNAVAILABLE`、0 写），而不是静默回退到曾导致 A01 P0 的 localStorage；Node Mock 可通过显式选项/Node 运行时判定保留。
- **设计依据**：本轮任务书 §2 P0 要求"保证同一存档域共享线性一致持久化介质与排他互斥锁"；此前 P1-01 N2 的先例要求缺少存储能力时 fail-closed，不得静默降级。
- **是否阻塞 GATE-01**：**否**（生产目标为微信；BrowserFilePort 标注 `EXPERIMENTAL_WEB_FALLBACK_ONLY`）。但若 Web 环境被宣称受支持，则构成 A01 保证的缺口，应与 REV3-01 同批修复。
- **整改建议**：
  1. `BrowserFilePort` 构造时若 `detectRuntimeEnv()==='WEB'` 且无 `indexedDB`，返回/降级为 `UnavailableFilePort`（或 `probeStorage=false`）；
  2. 仅在显式测试选项或 Node 环境保留 `localStorage` Mock；
  3. 增加"IDB 缺失 → STORAGE_UNAVAILABLE/0 写"回归；
  4. 若设计方坚持支持回退，须书面说明其非线一致风险并禁止在 Web 上作为可写存档介质。

---

## REV3-03 无 localStorage→IndexedDB 迁移（P2，需设计/负责人确认）

- **编号**：REV3-03
- **严重程度**：**P2**
- **文件和行号**：`BrowserFilePort.ts:22-24`（DB 常量）、`:97-147`（open/upgrade，无迁移逻辑）；`ISSUE_REPORT.md` §2.2（开发方前提声明）
- **触发条件**：同一浏览器 Profile 中已有 REWORK-02（localStorage）存档，升级到 REWORK-03（IndexedDB）构建。
- **独立复现步骤**：
  1. 正常构建生成 rev1 IDB 存档；
  2. 将该 rev1 Envelope 复制到 `localStorage['idle_fishing_lifecycle_persist_fs:save_slot_0.json']`，清空 IDB；
  3. 重载：App 显示 `EMPTY`，旧 localStorage 保留但未被读取；HIDE 后在 IDB 写新 rev1；localStorage 未被删除（`evidence/r3-a04-a06-migration.log` 第 1 项）；
  4. 两者并存时 IDB 优先（第 2 项）；IDB 缺失回退时旧 localStorage 又被加载（第 5 项，"复活"）。
- **实际结果**：旧存档被忽略（非迁移、非删除）；回退模式下重新生效，造成与新存储不一致的可见进度。
- **预期结果**：要么提供一次性迁移（先备份、校验 revision/slot/checksum、失败可重试、不提前删除旧数据），要么在设计决定中明确"无迁移、旧 Web 存档作废"，并保证回退模式不复活旧档。
- **设计依据**：`docs/interfaces/19` / 设计 11 要求存档版本与恢复语义；审核任务 §七要求"不能默默假定旧存档不存在"，必须记录前提及设计依据。
- **是否阻塞 GATE-01**：**否**，前提是负责人/设计方确认 FE-000 无正式 Web 用户且接受不迁移；需正式记录。
- **整改建议**：由设计方/负责人出具决定；若"无迁移"，在 `BrowserFilePort` 回退路径中禁用旧档读取，或加入版本标识防止复活；若迁移，按 3 槽 Envelope 校验并保留备份。

---

## REV3-04 完整平台检查在后台标签页并发挂起（P3，NOT_RUN）

- **编号**：REV3-04
- **严重程度**：P3
- **文件和行号**：[PlatformPage.ts:274-278](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/ui/PlatformPage.ts#L274)（`runAllPlatformChecks` 含 `runSubpackageCheck`）；[PlatformVerificationSuite.ts:64-99](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts#L64)
- **触发条件**：两个标签页同时调用 `__SPIKE_HARNESS__.runAllPlatformChecks()`，其中一个处于后台。
- **独立复现步骤**：打开 A/B，`Promise.all([A.runAllPlatformChecks(), B.runAllPlatformChecks()])`；等待 >150s；FS/Save 子套件则单独并发通过（`evidence/r3-t2-a09.log`）。
- **实际结果**：完整检查在后台标签页并发时曾未在 150s 内返回，未定位（疑似 Cocos 分包资源加载/rAF 节流）；单独运行 FS/Save 诊断并发 6/6 ×2 稳定通过，组合脚本中的一次挂起未能在单独复测重现。
- **预期结果**：诊断入口不因标签页后台而永久挂起，或文档注明需前台运行。
- **设计依据**：A09 仅要求命名空间隔离，不要求后台并发；此项为审核方附加观察。
- **是否阻塞 GATE-01**：否。
- **整改建议**：定位分包加载是否依赖引擎帧；为诊断操作增加超时/前台提示；补充双页诊断文档。

---

## REV3-05 Web 断言集替换导致 BootEntry 级覆盖减少（P3）

- **编号**：REV3-05
- **严重程度**：P3
- **文件和行号**：[verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs)；证据 `evidence/evidence-timing-and-assertions.log`
- **触发条件**：对照 REWORK-02 的 28 项断言。
- **独立复现步骤**：比较两轮 evidence JSON 的断言名。
- **实际结果**：保留 23；移除 5（运行时冻结、BootEntry UNCERTAIN 停机、BootEntry 排队取消、STARTED 完成、单轮跨页）；新增 5（生产接口、真实销毁、A02/A03 合并、N3 合并、空盘+12 轮）。审核方独立补测了被移除的 BootEntry 级行为并通过。
- **预期结果**：关键行为断言应在套件中保留，或以等效覆盖替代。
- **设计依据**：不得降低断言以获取绿色；REWORK-03 未要求删除旧断言。
- **是否阻塞 GATE-01**：否（审核方补测通过）。
- **整改建议**：恢复 BootEntry 级运行时冻结/UNCERTAIN/排队销毁断言（可复用审核方脚本思路）。

---

## REV3-06 队列任务 catch 不置 halt（P3）

- **编号**：REV3-06
- **严重程度**：P3
- **文件和行号**：[BootEntry.ts:556-576](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L556)
- **触发条件**：`coordinator.commit()` 抛出异常（非返回 UNCERTAIN/STORAGE_UNAVAILABLE）。
- **独立复现步骤**：注入首笔 commit 返回 rejected Promise；观察历史与后续 HIDE（`evidence/r3-a04-a06-migration.log`）。
- **实际结果**：记录 `FAILED` 与 detail，`persistenceHalted` 保持 false；下一 HIDE 继续提交。当前协调器将未知写结果转为 UNCERTAIN 并冻结，故无已知缺口。
- **预期结果**：若异常可能对应未知物理结果，应置 halt；否则应明确任务异常仅发生于读/写前或已由协调器分类。
- **设计依据**：任务书 A06 "明确是否需要冻结，不得吞掉未知提交结果"。
- **是否阻塞 GATE-01**：否。
- **整改建议**：在 catch 中对 `commit` 抛出的异常设置 `persistenceHalted=true`（保守），或由协调器保证抛出的异常必然无未知写并加注释。

---

## REV3-07 生产包仍可经 SystemJS/cc 访问内部能力（P3）

- **编号**：REV3-07
- **严重程度**：P3
- **文件和行号**：[BootEntry.ts:605-652](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts#L605)；Cocos `chunks:///_virtual/*` 与 `globalThis.cc`
- **触发条件**：在生产 Web 页面通过 `System.import('chunks:///_virtual/SingleWriterSaveCoordinator.ts')` 构造协调器，或经 `cc.director...` 取 BootEntry 并 destroy。
- **独立复现步骤**：审核方全部测试均以该方式驱动（`evidence/r3-a02-cross-tab.log` 等）。
- **实际结果**：可构造新协调器并访问同一存档域；这不是 A04 所指的"测试专用接口"，但也无法在 Web 包内彻底阻止。
- **预期结果**：A04 的 harness 收敛已达成；若需更强边界，应通过构建剥离/签名或原生容器提供。
- **设计依据**：A04 要求移除测试专用破坏性存档清理与原始协调器暴露；当前 `__SPIKE_HARNESS__` 已无这些接口。
- **是否阻塞 GATE-01**：否。
- **整改建议**：发布构建考虑关闭 Cocos SystemJS 虚拟模块调试入口（如可行）；记录 Web 平台非安全边界。

---

## REV3-08 路径守卫校验与删除之间的 TOCTOU（P3）

- **编号**：REV3-08
- **严重程度**：P3
- **文件和行号**：[safe-path-guard.mjs:269-285](file:///E:/idle-fishing-integration/tests/frontend/fe-000/safe-path-guard.mjs#L269)
- **触发条件**：验证通过后、`rmSync` 前，路径被替换为 Junction/符号链接（开发工具并发场景）。
- **独立复现步骤**：代码审阅；未构造竞态利用。
- **实际结果**：存在窗口；`rmSync` 前再次 lstat 缩小窗口但未原子化。
- **预期结果**：对开发工具可接受；如需更强，使用句柄/重解析点检查后删除。
- **设计依据**：A08 关注可验证真实路径；未要求防御本地竞态。
- **是否阻塞 GATE-01**：否。
- **整改建议**：记录残余风险；或将删除目标句柄化（Windows 下难度较高），至少保留二次 lstat。

---

## 关于上轮 REV2-09 的撤回

上轮 DeepSeek 报告称实施报告"18 组应为 19 组"；Astra 在 A10 中复核指出 18 组专指 P1-03，19 组是测试报告把 P2-05 另加一组，逐日志吻合。本轮审核接受 Astra 结论，撤回 REV2-09，不再列为问题。

## 汇总

| 编号 | 级别 | 主题 | 阻塞 GATE-01 |
|---|---|---|---|
| REV3-01 | **P1** | A02 UNCERTAIN 冻结不跨标签页 | **是** |
| REV3-02 | P2 | 无 IndexedDB 时静默回退 localStorage | 否（需策略决定） |
| REV3-03 | P2 | 无 localStorage→IndexedDB 迁移 | 否（需确认前提） |
| REV3-04 | P3 | 完整平台检查后台并发挂起 | 否 |
| REV3-05 | P3 | Web 断言替换导致 BootEntry 级覆盖减少 | 否 |
| REV3-06 | P3 | 队列 catch 不置 halt | 否 |
| REV3-07 | P3 | SystemJS/cc 可访问内部能力 | 否 |
| REV3-08 | P3 | 路径守卫 TOCTOU | 否 |