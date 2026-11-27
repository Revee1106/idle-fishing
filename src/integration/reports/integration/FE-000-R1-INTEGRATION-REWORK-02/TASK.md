# FE-000-R1-INTEGRATION-REWORK-02 任务书

## 1. 任务元信息

- **项目**：《挂机钓鱼》微信小游戏
- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-02`（第三轮定向整改）
- **执行角色**：前端开发工程师（Gemini Neon High）
- **独立审核方**：GPT-6.2 Astra（第二轮复审结论：`REWORK`）
- **固定工作区**：`E:\idle-fishing-integration`
- **Git 分支**：`integration/fe-000-be-r1`
- **固定前端基准（`HEAD`）**：`be62996fae44df24094331d670f6f0ab3741a4f2`
- **固定后端目标（`MERGE_HEAD`）**：`5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`
- **共同祖先（`merge-base`）**：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- **本轮允许声明的最高状态**：`READY_FOR_INDEPENDENT_REVIEW`（等待 Astra 第三轮独立复审；禁止自行宣布通过或进入 `GATE-01`）

## 2. 本轮定向整改范围（仅限五项）

1. **P1-01（N1 + N2）**：运行中存储失效（`probeStorage` / 物理写 IO 异常）必须进入持久化冻结态 `STORAGE_UNAVAILABLE`（恢复后未显式 `loadSafe()` / `reinitializePersistence()` 前不得继续写入，普通确定失败如 `INJECTED_PRE_WRITE` 保持可重试）；微信宿主缺失 `wx` / `getFileSystemManager` / `USER_DATA_PATH` / 必需 FS 方法时必须 fail-closed 返回 `STORAGE_UNAVAILABLE`，严禁静默降级为 `MemoryFilePort` 或伪造 `EMPTY`/`COMMITTED`。
2. **P1-02（N3）**：`BootEntry.onDestroy()` 必须取消所有尚未进入物理读写阶段的 `QUEUED` 任务（含已提交给 `SingleWriterSaveCoordinator` 但在锁队列等待的任务），保证零物理读写且磁盘版本不变；已 `STARTED` 的在途写入正常完成；`onDestroy()` 后所有新任务被拒绝。
3. **P1-03（N4 + N5）**：Node 24 测试入口 `run-node-tests.mjs` 必须准确统计任意嵌套层级的真实执行叶子测试（`describe`、嵌套 `t.test()`、仅含 `skip`/`todo` 子项的父测试不得误计为 `pass=1`）；并在受监控子进程中执行单文件测试，通过完成哨兵拦截 `process.exit(0)`、模块加载崩溃、未捕获异常与信号终止，覆盖全部 15+ 边界夹具。
4. **P2-04（L1）**：同源 Chrome 多标签页并发保存必须通过 W3C Web Locks API（`navigator.locks.request`）实现跨标签页串行互斥（锁内完成完整读取→版本检查→写入→回读），Web Locks 不可用或拒绝时 fail-closed 返回 `STORAGE_UNAVAILABLE`，并在真实双标签页 Chrome 中完成 `COMPAT-SAVE-CROSS-TAB-COMMIT`（含持锁标签页异常关闭自动释放恢复）。
5. **P2-05（N6）**：输出目录删除操作必须经过统一白名单守卫 `safe-path-guard.mjs`，在任何 `fs.rmSync` 之前拦截驱动器根目录、UNC 路径、仓库根/父目录、`apps/`、`tests/`、`reports/`、`Desktop`/`Documents`、`..` 穿越以及符号链接/Windows Junction。

## 3. 红线约束

- 严禁修改 58 个已暂存后端文件、`packages/`、`tests/backend/`、`reports/backend/`、根目录 `package.json` / `package-lock.json` / `tsconfig*.json`、`docs/`、`config/`。
- 严禁修改 `reports/frontend/`、`reports/integration/FE-000-R1-INTEGRATION/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-01/` 历史证据与报告。
- 严禁触碰其他 4 个工作区（`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review`）。
- 严禁执行 `git commit`、`git push`、`git reset`、`git clean`、`git stash`、`git merge --abort` 或合并 `main`。
- 严禁提前启动 `BE-001` / `FE-001` 正式业务开发。
