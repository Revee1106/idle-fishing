# FE-000-R1-INTEGRATION-REWORK-02 问题与风险报告

- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`
- **基准工作区**：`E:\idle-fishing-integration`（`integration/fe-000-be-r1`）

## 1. 第二轮独立复审问题关闭状态追踪

| 编号 | 级别 | 问题描述 | 当前状态（开发侧自检） | 证据引用 |
|---|---|---|---|---|
| **P1-01 / N1** | P1 | 运行中存储失效（探针/物理写 IO 异常）未持久化冻结，底层恢复后未经显式 `loadSafe()` 即继续写入 | **已修复，待 Astra 复审** | `r2-frontend-tests.log`（`TEST-01-A/B/C`）、`r2-verify-web.log`（`web_p1_01_runtime_failure_freeze_and_recovery`） |
| **P1-01 / N2** | P1 | 微信宿主缺失 `wx` / `getFileSystemManager` / `USER_DATA_PATH` / 必需 FS 方法时降级为 `MemoryFilePort` 或误判为 `NODE` | **已修复，待 Astra 复审** | `r2-frontend-tests.log`（`TEST-01-D/E`） |
| **P1-02 / N3** | P1 | `onDestroy()` 后已在队列等待但尚未开始物理读写的任务仍执行导致额外写入 | **已修复，待 Astra 复审** | `r2-verify-web.log`（`web_p1_02_destroy_cancels_queued_before_write`、`web_p1_02_destroy_started_completes_cleanly`） |
| **P1-03 / N4** | P1 | Node 24 嵌套测试与仅含 `skip`/`todo` 子测试的父测试误计为 `pass=1` | **已修复，待 Astra 复审** | `r2-p1-03-04` .. `r2-p1-03-10`、`r2-frontend-tests.log` |
| **P1-03 / N5** | P1 | 测试文件内 `process.exit(0)`、顶层崩溃、未捕获异常或信号终止绕过验证返回退出码 0 | **已修复，待 Astra 复审** | `r2-p1-03-11` .. `r2-p1-03-14`、`r2-frontend-tests.log` |
| **P2-04 / L1** | P2 | 同源 Chrome 多标签页并发保存可能出现双 `COMMITTED` | **已修复，待 Astra 复审** | `r2-verify-web.log`（`web_p2_04_compat_save_cross_tab_commit`）、`evidence/web-rework02/r1-green-web-results.json` |
| **P2-05 / N6** | P2 | 脚本清理输出目录可递归删除未授权路径或软链/Windows Junction 指向目标 | **已修复，待 Astra 复审** | `r2-frontend-tests.log`（`COMPAT-SAFE-PATH-GUARD`）、`r2-p2-05-unsafe-outdir.log` |

## 2. 仍存在的非本轮代码阻塞项与平台局限（如实披露）

1. **BLOCKED（外部环境限制）：微信开发者工具与微信真机运行时验证**
   - 本机未具备已登录的微信开发者工具 CLI、真机调试环境及真实微信小游戏广告位（`adUnitId`）。
   - 因此 **真机 `wx.getFileSystemManager` 行为、真机 `wx.onHide/onShow` 杀进程回收、微信运行期分包加载与真实激励视频广告** 尚未执行真机实测，继续标记为 `BLOCKED`，不得视为已完成。当前仅完成了 Cocos 微信小游戏真实构建产出与 10/10 静态结构审计（`wechat-rework02-audit.json`），以及 Node 下的微信缺失能力 Mock 故障测试。
2. **微信平台跨标签页说明**
   - `P2-04` 的 W3C Web Locks API 跨标签页排他互斥针对浏览器同源多标签页（Web 产物已实测通过）；微信小游戏采用单运行实例模型，不提供浏览器多标签页语义，其写互斥依赖 `SingleWriterSaveCoordinator` 进程内单写者串行队列与后端 3 槽位版本冲突检测。
3. **既有历史观察项（非本轮修改范围）**
   - `apps/game-client/tsconfig.typecheck.json` 仍沿用既有 FE-000 基线配置（未在本轮擅自变更工程编译选项），而 `tests/frontend/fe-000/tsconfig.json` 已开启 `strict: true` 并在 `npm --prefix apps/game-client run test:frontend` 编译阶段严格校验所有被引入的前端核心平台代码（`SingleWriterSaveCoordinator.ts`、`WeChatFilePort.ts`、`BrowserFilePort.ts`、`PlatformTypes.ts` 等均已通过 `strict: true` 检查）。
   - 本次集成工作区固定于未提交合并状态（`HEAD=be62996` + `MERGE_HEAD=5bcc9ac`），待 Astra 第三轮独立复审通过并获负责人授权后再决定合并提交节奏。
