# FE-000-R1-INTEGRATION-REWORK-02 整改实施报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **工作区 / 分支**：`E:\idle-fishing-integration` / `integration/fe-000-be-r1`
- **固定基线**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2`、`MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`、`merge-base=358b11105cfdee9bd076049c86a34d8f0aaa00e7`

## 1. 五项问题定向整改总表

| 问题编号 | 审核缺陷 | 修改 / 新增文件 | 新增 / 强化测试 | 独立证据 |
|---|---|---|---|---|
| **P1-01** | `N1` 运行中存储失效未持久化冻结；`N2` 微信存储能力缺失静默降级为内存存储 | `apps/game-client/assets/scripts/platform/PlatformTypes.ts`<br>`apps/game-client/assets/scripts/platform/WeChatFilePort.ts`<br>`apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`<br>`apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`<br>`apps/game-client/assets/scripts/bootstrap/BootEntry.ts`<br>`apps/game-client/assets/scripts/platform/BrowserFilePort.ts`<br>`apps/game-client/assets/scripts/platform/FaultInjectingFilePort.ts` | Node：`[NODE/P1-01/COMPAT-SAVE-BOOT-UNAVAILABLE]`、`[NODE/P1-01/TEST-01-A-B-C-D-E]`（覆盖 `TEST-01-A..E` 全部子项）<br>Web E2E：`web_p1_01_compat_save_boot_unavailable`、`web_p1_01_runtime_failure_freeze_and_recovery` | `logs/r2-frontend-tests.log`<br>`logs/r2-verify-web.log`<br>`evidence/web-rework02/r1-green-web-results.json` |
| **P1-02** | `N3` `onDestroy()` 后已在队列等待但尚未开始物理读写的任务仍执行 | `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`<br>`apps/game-client/assets/scripts/bootstrap/BootEntry.ts` | Web E2E：`web_p1_02_compat_lifecycle_hide_show_hide`、`web_p1_02_queued_hide_after_uncertain_halts`、`web_p1_02_destroy_cancels_queued_before_write`、`web_p1_02_destroy_started_completes_cleanly` | `logs/r2-verify-web.log`<br>`evidence/web-rework02/r1-green-web-results.json` |
| **P1-03** | `N4` 嵌套测试与仅 skip/todo 父测试误计为通过；`N5` `process.exit(0)` / 加载崩溃 / 未捕获异常 / 信号终止绕过 | `tests/frontend/fe-000/node-test-worker.mjs`（新增）<br>`tests/frontend/fe-000/run-node-tests.mjs`<br>`tests/frontend/fe-000/tsconfig.json`<br>`tests/frontend/fe-000/fixtures/*.test.ts`（新增 12 个、共 17 个夹具） | Node：`[NODE/P1-03/COMPAT-RUNNER-ZERO-AND-SKIP-GUARD]`<br>独立 CLI：18 组专项复现命令（覆盖空文件、skip、todo、仅 skip/todo 父节点、单 pass 父节点、3 层深嵌套、多文件混合嵌套、多失败、混合失败、加载崩溃、提前 `process.exit(0)`、未捕获异常、信号终止、正常通过、混合通过+skip、无文件、缺失文件） | `logs/r2-frontend-tests.log`<br>`logs/r2-p1-03-01-empty.log` .. `logs/r2-p1-03-18-missing-file.log` |
| **P2-04** | `L1` 同源 Chrome 多标签页并发保存仍可能双 `COMMITTED` | `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts`<br>`apps/game-client/assets/scripts/bootstrap/BootEntry.ts`<br>`tests/frontend/fe-000/verify-web-build.mjs` | Node：`[NODE/P2-04/COMPAT-SAVE-CONCURRENT-COMMIT]`<br>Web E2E：`web_p2_04_compat_save_cross_tab_commit`（真实双标签页并发竞态 + 重载一致性 + 连续交替提交 + Web Locks 拒绝 fail-closed + 持锁标签页异常关闭恢复） | `logs/r2-frontend-tests.log`<br>`logs/r2-verify-web.log`<br>`evidence/web-rework02/r1-green-web-results.json` |
| **P2-05** | `N6` 测试/构建脚本 `fs.rmSync` 可递归删除未授权目录或软链/Junction 目标 | `tests/frontend/fe-000/safe-path-guard.mjs`（新增）<br>`tests/frontend/fe-000/run-node-tests.mjs`<br>`tests/frontend/fe-000/verify-web-build.mjs` | Node：`[NODE/P2-05/COMPAT-SAFE-PATH-GUARD]`（含真实 Windows NTFS Junction 金丝雀目录防删实测）<br>独立 CLI：非法 `--out-dir=../../reports` 拦截复现 | `logs/r2-frontend-tests.log`<br>`logs/r2-p2-05-unsafe-outdir.log` |

## 2. 关键技术改造细节

### 2.1 P1-01：运行中存储持久化冻结与微信缺失 FS fail-closed（N1 + N2）

1. **独立的 `StorageHealthState` 状态机**：
   - 在 `PlatformTypes.ts` 定义 `StorageHealthState = 'AVAILABLE' | 'STORAGE_UNAVAILABLE'`，并在 `SingleWriterSaveCoordinator` 按 `namespaceKey` 维护健康状态（`namespaceHealth`），与 `BootEntry` 的 `loadStatus` 解耦。
   - **触发冻结条件**：`probeStorage()` 抛出或返回 `false`；物理写/删/列目录/创建目录/配额超限抛出致命 `FilePortIoError`（错误码集合：`STORAGE_UNAVAILABLE`、`WX_UNAVAILABLE`、`MKDIR_FAILED`、`QUOTA_EXCEEDED`、`WRITE_IO_ERROR`、`REMOVE_IO_ERROR`、`LIST_IO_ERROR`）；或浏览器环境 `navigator.locks` 不可用/拒绝。
   - **持续冻结语义**：一旦进入 `STORAGE_UNAVAILABLE`，即使底层存储随后恢复正常，在未显式调用 `loadSafe()` / `reinitializePersistence()` 重新探针并确认健康之前，所有后续 `commit()` 均直接短路返回 `{ kind: 'STORAGE_UNAVAILABLE' }`，零物理写入。
   - **保留普通确定失败重试路径**：针对后端确定性测试故障（如 `INJECTED_PRE_WRITE`、`INJECTED_PARTIAL_WRITE`），不会触发命名空间持久化冻结，按规范返回 `FAILED` 并保留原槽位，下次可正常提交。
2. **微信宿主探测与 FS 能力解耦（N2）**：
   - `detectRuntimeEnv()` 仅以 `typeof g.wx === 'object' && g.wx !== null` 判定 `WECHAT_DEVTOOLS` / `WECHAT_RUNTIME`（不再要求 `getFileSystemManager` 存在才识别为微信），防止缺失 `getFileSystemManager` 时误降级为 `'NODE'`。
   - 新增 `UnavailableFilePort` 显式 fail-closed 端口；`WeChatFilePort` 构造函数改为内部状态探测，永不抛未捕获构造异常，完整校验 `wx`、`getFileSystemManager()`、`env.USER_DATA_PATH` 及 6 个必需同步方法（`accessSync`/`mkdirSync`/`readFileSync`/`writeFileSync`/`unlinkSync`/`readdirSync`）；任一缺失时 `probeStorage()` 与读写方法均抛出 `FilePortIoError('STORAGE_UNAVAILABLE', ...)`。
   - `PlatformVerificationSuite.createRuntimeFilePort()` 彻底移除静默降级 `MemoryFilePort` 逻辑：微信宿主返回 `WeChatFilePort`，浏览器宿主返回 `BrowserFilePort`，未知/缺失持久能力的运行环境返回 `UnavailableFilePort`。`MemoryFilePort` 仅允许由测试代码显式构造。

### 2.2 P1-02：`onDestroy()` 取消未开始物理写任务（N3）

1. **三态任务生命周期追踪**：
   - `BootEntry` 对每次后台保存记录 `SaveTaskLifecycleState`：`QUEUED` → `STARTED` → `COMMITTED` / `FAILED` / `CONFLICT` / `UNCERTAIN` / `STORAGE_UNAVAILABLE`，或在进入物理读写前转为 `CANCELLED`（`resultKind: 'SKIPPED_DESTROYED'`）。
2. **队列阶段协同取消**：
   - `SingleWriterSaveCoordinator.commit()` 新增可选 `CommitLifecycleHooks`：`{ shouldCancelBeforeStart, onStarted, beforeCommitBody }`。
   - 任务在获取单写者锁及跨标签页 Web Lock 之后、执行**任何** `probeStorage()` / `repo.load()` / `repo.commit()` 物理读写**之前**，立即回调 `shouldCancelBeforeStart()`。若此时 `BootEntry` 已进入 `destroyed`（或 `persistenceHalted`），直接返回 `{ kind: 'CANCELLED' }`，**零物理读、零物理写**。
   - 若任务已跨过 `onStarted()` 进入物理提交阶段后触发 `onDestroy()`，允许当前在途写入原子完成（不中途中断），随后拒绝所有新提交任务。
   - 浏览器实测证据：`rev=8` 持锁期间排队两个 HIDE 任务（seq 9 已进入 coordinator 等待队列，seq 10 排队于 `BootEntry` 队列），在锁释放前触发 `onDestroy()`，释放后两条任务均记录 `taskState='CANCELLED'`、磁盘最高版本严格维持 `8`、销毁后新请求返回 `false`；另测 `STARTED` 阶段触发 `onDestroy()`，在途写完成至 `rev=9`，后续新请求被拒绝。

### 2.3 P1-03：Node 24 受监控叶子测试统计器（N4 + N5）

1. **精确 DFS 栈叶子计数（`node-test-worker.mjs`）**：
   - 子进程以 `run({ files: [compiledFile], isolation: 'none' })` 执行单个编译后的测试文件，监听 `test:start` / `test:pass` / `test:fail`。
   - 维护按 `nesting` 深度演进的节点栈：当子节点在 `nesting === parent.nesting + 1` 启动时标记 `parent.hasChildren = true`；当节点结束时，排除 `details.type === 'suite'`（`describe` 套件）以及 `hasChildren === true` 的父测试容器（仅统计真实执行的叶子用例；若无叶子却发生容器/模块加载级失败，计入 `containerFailures`）。
   - 从而彻底杜绝 Node 24 将“仅含 `skip`/`todo` 子项的父 `test()`”误计为 `pass=1` 的假绿漏洞，同时对 3 层深嵌套与多文件混合嵌套均得出精确叶子计数。
2. **子进程监督与完成哨兵（`run-node-tests.mjs`）**：
   - 主控脚本为每个编译后的测试文件独立派生 `node-test-worker.mjs` 子进程，通过唯一临时哨兵文件传递 `{ completed: true, total, passed, failed, skipped, todo, containerFailures }`。
   - 哨兵仅在 `node:test` 流正常结束且无未捕获异常时写入。任何提前 `process.exit(0)`、顶层模块抛错、异步 `uncaughtException`/`unhandledRejection` 或 `SIGTERM` 信号终止均导致哨兵缺失或非零退出，被主控脚本记为 `procErr >= 1` 并强制退出码 `1`。
   - 强门禁判定：只要 `procErr > 0 || containerFailures > 0 || failed > 0 || total === 0 || passed === 0`，一律返回非零退出码 `1`。

### 2.4 P2-04：同源 Chrome 多标签页 Web Locks 互斥（L1）

1. **跨标签页排他锁**：
   - 在 `SingleWriterSaveCoordinator.runWithCrossTabLock()` 中，对浏览器共享命名空间（`browser:*`）的每次提交通过 W3C Web Locks API `navigator.locks.request('idle-fishing:save:' + storageKey, { mode: 'exclusive' }, fn)` 获取浏览器级排他锁，锁作用域严格覆盖完整“前置取消检查 → 探针 → 读取 3 槽位 → 版本校验 → 写目标槽位 → 读回验证”临界区。
   - **Fail-Closed 策略**：在浏览器环境检测到 `navigator.locks` 缺失或 `request()` 拒绝时，立即将命名空间冻结为 `STORAGE_UNAVAILABLE` 并返回 `{ kind: 'STORAGE_UNAVAILABLE' }`，严禁降级为“仅进程内串行”导致跨标签页静默覆盖。
   - **平台差异诚实说明**：浏览器同源多标签页由 W3C Web Locks API 保障；微信小游戏单运行实例模型下由单写者进程内串行队列与后端版本/槽位协议共同保障（真机跨进程切后台行为仍需在 `GATE-01` 真机阶段实测）。
2. **真实 Chrome 158 双标签页自动化验证**：
   - 在 `verify-web-build.mjs` 中通过 CDP `Target.createTarget` 打开同源真实 Tab A 与 Tab B，通过 `beforeCommitBody` 屏障制造确定性并发窗口：Tab A（`+60s`）与 Tab B（`+180s`）同时提交 `expectedRevision=null` → Tab A 独占 Web Lock 写 `rev=1` 返回 `COMMITTED`，Tab B 随后获锁读到 `rev=1` 返回 `CONFLICT`；Tab A 整页重载与 Tab B 重读均一致命中 Tab A 候选快照；随后验证跨标签页交替 `rev=2`/`rev=3`、Web Locks 拒绝触发 `STORAGE_UNAVAILABLE` 冻结、以及 Tab B 持锁异常关闭（`Target.closeTarget`）后 Chrome 自动释放锁且 Tab A 恢复并成功提交 `rev=4` 且重载一致。

### 2.5 P2-05：输出目录删除白名单守卫（N6）

- 新增 `tests/frontend/fe-000/safe-path-guard.mjs`，统一暴露 `assertSafeOutputDir(targetPath, category, options)` 与 `safeRemoveOutputDir(targetPath, category, options)`，仅放行三类精确白名单目录：
  1. `compiled-tests`：必须是 `tests/frontend/fe-000/` 的直接子目录且目录名以 `.compiled-` 开头；
  2. `cocos-build`：仅允许 `apps/game-client/build/web-mobile` 或 `apps/game-client/build/wechatgame`；
  3. `chrome-temp`：必须是 `os.tmpdir()` 的直接子目录且目录名以 `fe000-chrome-` 开头。
- 删除前强制校验：拒绝空路径/非字符串、UNC 路径、驱动器根目录、受保护路径（仓库根/父目录/`apps`/`packages`/`tests`/`reports`/`docs`/`config`/`Desktop`/`Documents`）、`..` 逃逸，并通过 `fs.lstatSync` + `fs.realpathSync` 拒绝任何符号链接与 Windows NTFS Junction（绝不穿透删除链接目标）。
- 已全量接入 `run-node-tests.mjs`（`--out-dir` 参数校验与清理）与 `verify-web-build.mjs`（Chrome 临时 `userDataDir` 清理）。

## 3. 边界与基线完整性声明

- 58 个已暂存后端文件与 `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355` 严格 0 差异；未修改任何后端代码、契约、根配置或设计文档。
- 历史目录 `reports/frontend/`、`reports/integration/FE-000-R1-INTEGRATION/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-01/` 零修改。
- 仅在 `E:\idle-fishing-integration` 操作，其余 4 个工作区零修改。
