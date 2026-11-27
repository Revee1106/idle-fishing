# FE-000-R1-INTEGRATION-REWORK-03 问题与风险报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **基准工作区**：`E:\idle-fishing-integration`（`integration/fe-000-be-r1`）

## 1. Astra 第二轮独立复审发现关闭清单（A01–A10）

| 编号 | 级别 | 问题描述 | 本轮处置状态（开发侧自检） | 验证证据 |
|---|---|---|---|---|
| **A01** | **P0** | 双标签页同时获得 `COMMITTED`（同 revision/slot 覆盖） | **已修复，待独立复审**（Chromium `localStorage` 多进程异步缓存根因已查明，浏览器实验端口升级为线性一致 IndexedDB + Web Locks） | `r3-verify-web-run1.log`、`r3-verify-web-run2.log`（累计 24/24 轮 + 2/2 空盘，0 次双 `COMMITTED`） |
| **A02** | **P1** | `UNCERTAIN` 后跨协调器仍可写 | **已修复，待独立复审**（`UNCERTAIN` 冻结绑定共享 `storageKey` 命名空间） | `r3-frontend-tests.log`（`A02`）、`r3-verify-web-run1.log` |
| **A03** | **P1** | 部分槽位 IO 不可用时过早解除冻结 | **已修复，待独立复审**（严格四态区分，任意槽 IO 错误保持 `STORAGE_UNAVAILABLE` 并仅附只读备份元数据） | `r3-frontend-tests.log`（`A03`）、`r3-verify-web-run1.log` |
| **A04** | **P1** | 生产 Web 构建暴露破坏性存档清理与销毁后可绕过所有者的诊断入口 | **已修复，待独立复审**（生产构建移除全部破坏性/写测试入口，`WeakSet` 免疫 Cocos `_destroyImmediate()`，销毁后零写入） | `r3-verify-web-run1.log`（`web_p1_03_production_harness_no_destructive_save_api`、`web_p1_03_destroyed_boot_entry_zero_writes`） |
| **A05** | **P2** | 锁内任务异常被误分类为 `CROSS_TAB_LOCK_REJECTED` 并误冻结 | **已修复，待独立复审** | `r3-frontend-tests.log`（`A05`）、`r3-verify-web-run1.log` |
| **A06** | **P2** | 队列单笔任务异常导致 `pendingHideSave` 链永久 rejected | **已修复，待独立复审** | `BootEntry.ts` 每任务独立 `try/catch` 隔离 |
| **A07** | **P2** | 抛错 TODO 计数与 Node 24 原生不一致；worker 无超时上限 | **已修复，待独立复审** | `r3-a07-todo-throws.log`、`r3-a07-only-todo-throws.log`、`r3-a07-hanging-timeout.log`、`r3-frontend-tests.log` |
| **A08** | **P2** | `safe-path-guard.mjs` 在 `realpathSync`/`lstatSync` 失败时回退未验证路径 | **已修复，待独立复审**（fail-closed 返回 `REALPATH_UNVERIFIABLE`/`METADATA_UNVERIFIABLE`） | `r3-frontend-tests.log`（`COMPAT-SAFE-PATH-GUARD`）、`r3-a08-unsafe-outdir.log` |
| **A09** | **P3** | 默认平台诊断页共用固定命名空间 | **已优化**（每次运行独立临时域并于 `finally` 清理） | `PlatformVerificationSuite.ts` |
| **A10** | **P3** | 实施报告文件列未区分修改/新增/沿用 | **已规范**（本轮 `IMPLEMENTATION_REPORT.md` 严格逐字节三分类） | `IMPLEMENTATION_REPORT.md` 第 2 节 |

## 2. 仍存在的外部环境阻塞项与设计说明（如实披露）

1. **BLOCKED（外部环境限制）：微信开发者工具 / 真机 / 真实激励广告实测**
   - 本机无已登录微信开发者工具、真机调试环境及真实广告位，因此微信真机 `wx.getFileSystemManager`、杀进程 `wx.onHide/onShow`、真机分包加载与真实广告位仍保持 `BLOCKED / NOT_RUN`，不得视为已通过。
2. **Web 实验性存储介质说明（供设计方与审核方知悉）**
   - 正式生产平台目标为微信小游戏（`wx.getFileSystemManager` + `USER_DATA_PATH`）及 Node 模拟器；`BrowserFilePort` 属于前端实验性 Web 验证回退适配层（`EXPERIMENTAL_WEB_FALLBACK_ONLY`）。
   - 实证表明 Chromium 多进程渲染器下 `localStorage` 的异步 `CachedStorageArea` IPC 无法在 `navigator.locks` 下保证跨标签页线性一致；因此本轮将真实浏览器运行时的 `BrowserFilePort` 后端切换为浏览器原生 W3C `IndexedDB`（`idle_fishing_fs_v1`，零额外第三方依赖、零服务端、兼容 Node `localStorage` Mock 单元测试），未修改任何后端 `packages/game-core/`、公共契约或微信正式存储实现。
   - 若后续产品需保留从早期 Spike Web `localStorage` 到 `IndexedDB` 的旧存档迁移，可在设计方确认需求后另行排期；当前仅处于 FE-000 技术验证阶段，无正式线上玩家数据。
3. **Windows 权限与既有基线说明**
   - Windows 非管理员环境下创建目录符号链接返回 `EPERM`（`NOT_RUN`）；真实 NTFS Junction、嵌套 Junction 及 `EACCES` 元数据故障已全部实测拒绝。
   - 家庭电脑两套后端历史独立审核原件缺失属历史环境事实，本轮未触动任何后端或历史目录。
