# FE-000-R1-INTEGRATION-REWORK-03 源码审查（CODE_REVIEW）

- **审核人**：DeepSeek 4.1 Flash 1017
- **对象**：完整候选工作区（58 暂存后端 + 12 未暂存前端 + 未跟踪测试/夹具/报告）
- **方式**：逐文件通读 + Git 差异 + 隔离快照真实执行；只读，未修改任何被审核文件
- **结论**：A01/A03–A10 关闭；**A02 跨标签页未关闭（P1，阻塞）**；另有 2 项 P2、4 项 P3 观察

## 1. 关键文件与职责

| 文件 | 本轮职责 |
|---|---|
| [SingleWriterSaveCoordinator.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts) | 共享健康/冻结、Web Locks 临界区、UNCERTAIN 冻结、恢复分类、任务异常分类 |
| [BrowserFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/BrowserFilePort.ts) | 真实浏览器 IndexedDB 线性一致持久化；Node 仅 localStorage Mock；缺失 IDB 时回退 |
| [PlatformTypes.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformTypes.ts) | `BROWSER_INDEXED_DB`、异步 `probeStorage` |
| [FaultInjectingFilePort.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts) | 异步 probe 透传、读写故障注入 |
| [PlatformVerificationSuite.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts) | 诊断临时命名空间与清理 |
| [BootEntry.ts](file:///E:/idle-fishing-integration/apps/game-client/assets/scripts/bootstrap/BootEntry.ts) | WeakSet 销毁免疫、生产 harness 收敛、队列异常隔离、UNCERTAIN 停机 |
| [node-test-worker.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/node-test-worker.mjs) / [run-node-tests.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/run-node-tests.mjs) | TODO 语义、worker 超时、哨兵 |
| [safe-path-guard.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/safe-path-guard.mjs) | 元数据 fail-closed、Windows 路径加固 |
| [verify-web-build.mjs](file:///E:/idle-fishing-integration/tests/frontend/fe-000/verify-web-build.mjs) | 真实 Chrome 双标签页 12 轮交错、生产接口审计、销毁/恢复测试 |

## 2. A01：IndexedDB + Web Locks（关闭）

### 2.1 持久化介质

- `BrowserFilePort` 在 `getIndexedDbFactory()` 存在时选择 `BROWSER_INDEXED_DB`（`BrowserFilePort.ts:54-87`），数据库 `idle_fishing_fs_v1`、store `files`，`storageKey='browser:<namespace>'`（`:75`）。
- 所有 `read`/`write`/`remove`/`list`/`probeStorage` 均开启**新事务**，读写在 `tx.oncomplete` 后才 resolve（`:175-226`、`:262-435`），无 RAM 缓存；readwrite 事务由浏览器进程串行化。
- 写入配额统计在同一事务内用 cursor 完成（`:304-344`）；`QUOTA_EXCEEDED` 正确 abort。
- 事务 `onerror`/`onabort` 均 reject，会被转换为 `READ_IO_ERROR`/`WRITE_IO_ERROR`（`:285-288`、`:346-349`）。

### 2.2 锁与临界区

- `withExclusiveLock` 在真实浏览器上下文对 `browser:*` 命名空间请求 `idle-fishing:save:<storageKey>` 独占 Web Lock（`SingleWriterSaveCoordinator.ts:216-248`）。
- 临界区覆盖：取消检查 → 健康检查 → probe → 读 3 槽 → revision/epoch 校验 → 写 → 回读 → 结果判定（`:391-483`）。写事务 complete 后锁才释放，故下一个获锁标签页的只读事务能看到已提交数据。
- 实测（审核方两套独立 Profile）：空盘竞争 + 12 轮交错（写前/写后回读前两类屏障）×2，合计 24/24 轮 + 2/2 空盘，0 次双 COMMITTED；每轮持锁方与等待方 clientId 不同（`evidence/r3-race-profileA.log`、`r3-race-profileB.log`）。开发方两轮另 24/24 + 2/2（证据 JSON 已复核）。
- 真实 Chrome 的 `navigator.locks` 缺失/拒绝均 fail-closed，0 槽写入；持锁标签页 `Target.closeTarget` 后 Chrome 自动释放锁，幸存页提交 rev+1 并重载一致。
- **结论**：A01 在 IndexedDB 可用的真实 Chrome 中关闭。回退路径见 REV3-02。

## 3. A02：UNCERTAIN 跨协调器冻结（未关闭，P1）

### 3.1 已实现的部分

- `commit()` 在 `repo.commit()` 返回 `UNCERTAIN` 时立即 `markStorageUnavailable(storageKey,'UNCERTAIN_WRITE_PENDING_RECOVERY')` 并返回 UNCERTAIN（`SingleWriterSaveCoordinator.ts:468-474`）。
- `commit()` 入口检查共享健康 Map，冻结时直接 `STORAGE_UNAVAILABLE`（`:402-410`）。
- `loadSafe()` 只有在 probe 成功、**所有槽位读取无 IO 错误**且结果 VALID/EMPTY 时才 `markStorageAvailable`（`:358-363`）。
- 同一 Realm 内任意协调器共享 `namespaceHealth` Map，实测 second coordinator 立即冻结且 0 写（`evidence/r3-a02-cross-tab.log`；开发方 Chrome A02 用例亦同页）。

### 3.2 根因：健康状态是"每 Realm 内存 Map"

```ts
// SingleWriterSaveCoordinator.ts:98-100
const namespaceQueues = new Map<string, Promise<void>>();
const namespaceHealth = new Map<string, NamespaceHealthRecord>();
```

`namespaceHealth` 是模块级内存对象；**每个浏览器标签页有独立 JS Realm 与独立模块实例**。因此：

- Tab A 的 UNCERTAIN 只把 A 的 Map 置为冻结；
- Tab B 的协调器 `getOrInitHealth(storageKey)` 首次访问得到 `AVAILABLE/NONE`（`:123-130`）；
- 代码中没有任何 IndexedDB/BroadcastChannel 等跨 Realm 的冻结标记持久化；`loadSafe()` 也只清除本 Realm 的 Map 项（`:361`）。

### 3.3 独立复现（两层证据）

1. **直连协调器路径**（`evidence/r3-a02-cross-tab.log`）：
   - Tab A：内存 + IndexedDB 端口 + 故障包装（写失败不落盘、随后读全失败）→ `UNCERTAIN`，A 健康 `STORAGE_UNAVAILABLE/UNCERTAIN_WRITE_PENDING_RECOVERY`，磁盘 rev2 不变；
   - 同页第二协调器：`STORAGE_UNAVAILABLE` 0 写（正确）；
   - Tab B：新协调器健康 `AVAILABLE/NONE`，**未调用 loadSafe** 直接 `COMMITTED rev3`，磁盘 rev3。
2. **应用正常 HIDE 路径**（`evidence/r3-a02-app-cross-tab.log`）：
   - A、B 均启动并读到 rev1；
   - Tab A 注入 IDB 槽写失败 + 读失败，触发 HIDE → `UNCERTAIN`/halt，磁盘 rev1；
   - Tab B 普通 `visibilitychange` HIDE → `COMMITTED rev2`（gold 84），A 仍 halt/rev1。
   这证明绕过不是测试替身专属，正常业务入口即可发生。

### 3.4 与要求/契约的偏差

- 本轮任务书 §2 P1-01：`UNCERTAIN` 冻结须绑定 `storageKey` 共享存储域，任何其他协调器实例或直连入口在显式完整 `loadSafe()` 前"均拒写且零物理写入"；
- 审核任务 A02 明确列出"不同标签页不同协调器"与"必须证明同一存档域不会因更换协调器实例或标签页而绕过故障隔离"；
- `docs/interfaces/19` 第 67 行：写失败/回读异常返回 UNCERTAIN，**停止业务写入**，立即重新扫描，不能确认则保持 RECOVERING/ERROR。
- 当前实现只做到"同 Realm 停止"，跨 Realm 未停止。

### 3.5 风险边界

本次未观察到已确认存档被覆盖：B 的 expectedRevision 来自其已确认内存版本，磁盘若已有更高已提交版本会 CONFLICT。因此定为 **P1（协议/恢复屏障失效）而非 P0**。但若 A 的未确认写在其他介质/时序下部分可见，或回退到 localStorage，风险面会扩大。

### 3.6 修复建议

1. 在共享 IndexedDB 中持久化域级 `needsRecovery` 标记（与存档同库；每次 `commit` 在 Web Lock 内先读该标记；UNCERTAIN 时写入；完整 `loadSafe()` 成功后才清除）。
2. 若标记写入本身失败，使用 `BroadcastChannel('idle-fishing:save-health')` 立即通知其它同源文档冻结（best-effort），并保持本 Realm 冻结。
3. 所有协调器入口（包括诊断/直连提交）先检查持久化标记；发现即 `STORAGE_UNAVAILABLE`。
4. 在 `verify-web-build.mjs` 增加跨标签页 UNCERTAIN 用例（当前 `web_p1_01_uncertain...` 仅同页两协调器），并断言 B 0 写。

## 4. A03：部分 IO 恢复（关闭）

- `loadSafe()` 使用 `observedPort` 记录每次槽读异常（`SingleWriterSaveCoordinator.ts:305-321`），`ioErrorSlots>0` 时按 1–2/3 个槽分类为 `PARTIAL_IO_UNAVAILABLE`/`IO_UNAVAILABLE`，保持冻结并返回 `readOnlyBackup`（`:326-356`）。
- 只有 `ioErrorSlots.length===0 && (VALID||EMPTY)` 才解冻（`:358-363`）。
- 独立实测（真实 IndexedDB+fault wrapper）：缺失→EMPTY/AVAILABLE；slot2 IO 错误→`STORAGE_UNAVAILABLE`+`PARTIAL_IO_UNAVAILABLE`+`readOnlyBackup rev2`+两协调器冻结+0 写；三槽全 IO→`IO_UNAVAILABLE`；故障清除→`VALID rev3`+AVAILABLE+`COMMITTED rev4`（`evidence/r3-a03.log`）。
- 只读备份不授予写权限；INVALID_CONTENT（可读但损坏）可恢复旧备份并解冻（`:360-363`），符合"A03 四态区分"。

## 5. A04：生产诊断边界与销毁（关闭）

- 生产 `__SPIKE_HARNESS__` 仅暴露 `ready/env/getCurrentPage/switchPage/runCoreChecks/run24hPerf/openOverviewModal/closeModal/isModalVisible/runAllPlatformChecks/awaitPendingHideSave/getCommitHistory/getLifecycleLog/getSnapshot`（`BootEntry.ts:605-652`），全部只读或普通 UI；无清槽、无原始协调器、无直提/销毁/恢复测试入口。
- `SingleWriterSaveCoordinator` 原型已无 `clearSlotsForTest`（`SingleWriterSaveCoordinator.ts` 全文；审核方 `Object.getOwnPropertyNames` 复核）。
- Cocos 3.8.8 `_destroyImmediate()` 会清空组件自有属性；`destroyedBootEntries = new WeakSet<BootEntry>()` + `isValid===false` 判定（`BootEntry.ts:47,147-149`），`onDestroy()` 同时置空 `persistCoordinator/persistPort/persistState`（`:155-172`）。
- 真实构建实测：`boot.destroy()` + 3 帧后属性为 null；`switchPage/runCoreChecks` 被拒；HIDE 后 IndexedDB 槽字节完全一致（`evidence/r3-a04-a06-migration.log`）；生产 harness 审计通过（`evidence/r3-race-profileA.log`）。

## 6. A05/A06：异常分类与队列（关闭）

- `withExclusiveLock` 在锁回调内把任务异常包装为 `CoordinatorTaskError`，外层解包重抛（`SingleWriterSaveCoordinator.ts:231-245`）；只有真正的 `locks.request` 拒绝才标记 `CROSS_TAB_LOCK_REJECTED`。
- 实测：`beforeCommitBody` 抛 `audit body throw` → 原样抛出、健康 `AVAILABLE`；锁拒绝/缺失 → 冻结（`evidence/r3-race-profileA.log`）。
- BootEntry 队列每笔任务包在 `try/catch`（`BootEntry.ts:400-577`）；catch 记录 `FAILED` 与 detail（`:556-576`），不改变共享 Promise 链状态。
- 实测：注入首笔 commit reject → 历史 `FAILED`；下一次 HIDE `COMMITTED rev2`（`evidence/r3-a04-a06-migration.log`）。
- 观察：catch 未置 `persistenceHalted`（REV3-06）；当前协调器把未知结果转为 UNCERTAIN/STORAGE_UNAVAILABLE，故未见实际缺口。

## 7. A07：Node 24 运行器（关闭）

- worker 在 `test:fail` 且 `ev.todo` truthy 时计入 `todo`（`node-test-worker.mjs:118-142`），与 Node v24.20.0 原生一致：`fixture-todo-throws` 原生 `pass=1 todo=1 fail=0 exit 0`；worker 同；runner `total=2 pass=1 todo=1 exit 0`。
- 仅抛错 TODO：`total=1 pass=0 todo=1`，仍触发零通过门禁 exit 1（保留要求）。
- `--worker-timeout-ms` 默认 180000，范围 200–600000（`run-node-tests.mjs:40-48`）；`spawnSync(..., timeout, SIGKILL)`（`:141-147`）；ETIMEDOUT 记 `procErr=1`（`:152-163`）。实测 1500ms 超时约 4s 返回，exit 1。
- 29 组矩阵（18 标准 + 10 对抗 + 不安全 out-dir）实际退出码与摘要符合预期；父容器/仅 skip-todo 父测试不误计 pass；空文件、全 skip/todo、加载崩溃、exit(0/1)、未捕获异常、SIGTERM 全部拦截（`evidence/runner-matrix.log`）。
- 未覆盖：TODO 父测试本身抛错（仅 TODO 叶抛错有测试）；建议补充。

## 8. A08：输出目录安全（关闭）

- `resolveCanonicalPathFailClosed` 使用 `lstatSync` 向上探测；任何非 ENOENT/ENOTDIR 元数据错误返回 `METADATA_UNVERIFIABLE`；`realpathSync` 失败返回 `REALPATH_UNVERIFIABLE`；repoRoot 失败返回 `REPO_ROOT_UNVERIFIABLE`（`safe-path-guard.mjs:51-104`、`:140-149`）。
- 删除前再次 `lstat` 并拒绝符号链接；元数据错误直接抛出；ENOENT 视为无可删（`:269-285`）。
- Windows：UNC/扩展/设备前缀、驱动器相对路径、ADS 冒号、盘符根、受保护路径、精确白名单（`.compiled*`/`web-mobile`/`wechatgame`/`fe000-r1-chrome-*`）、大小写规范化（`:113-259`）。
- 独立实测 7/7：EACCES fail-closed（含删除前 lstat）、`rmSync` 0 次、前缀兄弟拒绝、Junction/嵌套 Junction（金丝雀存活）、悬空 Junction、Runner 路径穿越（`evidence/r3-a08.log`）。
- 符号链接文件因 Windows 非管理员 EPERM 未能创建：`NOT_RUN`（如实标注）。

## 9. A09：诊断命名空间（关闭，附观察）

- `runFileSystemAndSaveSuite` 每次生成 `idle_fishing_spike_diag_<ts>_<rand>` 临时域，并在 `finally` 清理（`PlatformVerificationSuite.ts:69-73,289-296`）。
- 两标签页并发运行 FS/Save 诊断均 6/6 PASS（`evidence/r3-t2-a09.log`）。
- 完整 `runAllPlatformChecks()`（含 Cocos 分包加载）在后台标签页并发时挂起，未定位；审核方标记 `NOT_RUN`，不据此判定 A09 未关闭（REV3-04）。

## 10. A10：报告口径（关闭）

- 实施报告 §2 将 12 个修改、3 个新增夹具、21 个沿用文件严格区分；审核方以 REWORK-02 清单逐字节核对一致（`evidence/manifest-and-coverage.log`）。
- 上轮 DeepSeek 报告 REV2-09（"18 组应为 19 组"）经 Astra 复核不成立；本轮撤回，不再作为问题。

## 11. 兼容性（新增架构变更）

- **旧 localStorage 存档**：IDB 模式完全不读取、不删除；启动显示 EMPTY 并在 IDB 新建存档（`evidence/r3-a04-a06-migration.log` 第 1 项）。
- **新旧并存**：IDB 优先（第 2 项）。
- **IDB 初始化失败**：`STORAGE_UNAVAILABLE`、halt、HIDE 0 提交（第 3 项），未误显 EMPTY。
- **IDB 缺失**：静默 `BROWSER_LOCAL_STORAGE_FALLBACK` 并允许写入（第 4 项）；旧 localStorage 存档在回退模式下"复活"（第 5 项）——REV3-02/REV3-03。
- **无迁移/中断重试**：不适用（无迁移）；前提需设计方/负责人确认。

## 12. 结论

A01 的根因（localStorage 跨渲染进程异步缓存）与修复（IndexedDB+Web Locks）成立，且构建可逐字节复现；A03–A10 的实现与独立测试均符合要求。**A02 仅在同 Realm 生效，跨标签页未关闭**，因此本轮不可通过初审。修复时应同时处理无 IDB 回退的 fail-closed，避免 A02 的修复在回退路径失效。