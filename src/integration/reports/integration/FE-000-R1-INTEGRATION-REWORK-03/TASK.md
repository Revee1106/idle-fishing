# FE-000-R1-INTEGRATION-REWORK-03 整改任务书

## 1. 任务元信息

- **项目**：《挂机钓鱼》微信小游戏
- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-03`
- **触发依据**：GPT-6.2 Astra High 第二轮独立复审（`E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-02-ASTRA\`）结论 `REWORK`，禁止进入 `GATE-01`
- **工作目录**：`E:\idle-fishing-integration`
- **Git 分支**：`integration/fe-000-be-r1`
- **固定前端基线（`HEAD`）**：`be62996fae44df24094331d670f6f0ab3741a4f2`
- **固定后端目标（`MERGE_HEAD`）**：`5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`
- **共同祖先（`merge-base`）**：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- **最终允许声明的最高状态**：`READY_FOR_INDEPENDENT_REVIEW`（等待负责人安排 DeepSeek 初审及 Astra 复审；严禁自行宣布审核通过；不提交、不推送、不合并 `main`）

## 2. 本轮必须关闭的全部整改项

1. **P0（A01）双标签页同时获得 `COMMITTED`（同 revision / 同 slot 覆盖）**：查明根因并在真实 Chrome 双标签页彻底修复，保证同一存档域共享线性一致持久化介质与排他互斥锁，获得锁后重新确认 revision 与 slot，完整覆盖读取/校验/写入/回读，Web Locks 不可用或拒绝时安全拒写，且以确定性交错测试（含空盘与非空盘多轮次及物理回读屏障）验证 0 次双 `COMMITTED`。
2. **P1-01（A02）`UNCERTAIN` 后跨协调器仍可写**：将 `UNCERTAIN` 冻结绑定到共享存储域（`storageKey`），同一存档域内任何其他协调器实例或直连提交入口在显式完成 `loadSafe()` 恢复前均拒写且零物理写入，同时保留普通确定性未提交故障（如 `PRE_WRITE_ERROR`）的处理路径。
3. **P1-02（A03）部分恢复过早解除冻结**：严格区分文件不存在（`FILE_NOT_FOUND`）、文件内容无效（`INVALID_CONTENT`）、IO 不可用（`IO_UNAVAILABLE` / `PARTIAL_IO_UNAVAILABLE`）与恢复验证失败（`PROBE_FAILED` / `CORRUPT` / `UNSUPPORTED`）；任意槽位读 IO 失败时禁止使用旧备份解冻宣布 `AVAILABLE` 或授权新写入。
4. **P1-03（A04 + A05 + A06 + A09）生产构建销毁后诊断入口与测试能力隔离**：生产 Web 构建产物中移除所有测试专用破坏性存档清理、原始协调器暴露及绕过所有者的提交入口；销毁 `BootEntry` 后免疫 Cocos `_destroyImmediate()` 属性置空并确保零物理写入；同步修复锁内任务异常误分类（`A05`）、队列异常投毒（`A06`）与诊断页命名空间隔离（`A09`）。
5. **其他必须关闭的整改项（A07 + A08）**：
   - Node 测试运行器：修复抛错 TODO 叶子用例计数以对齐 Node 24 原生语义（保留全 TODO 零通过守卫），并增加可配置强制 worker 超时上限（`--worker-timeout-ms`）。
   - 输出目录路径守卫：对 `lstatSync` / `realpathSync` 权限或元数据查询失败一律 fail-closed 拒绝（禁止回退到未验证路径），强化 Windows 扩展路径/驱动器相对路径/NTFS ADS 校验。

## 3. 工程与 Git 红线

- 严禁修改 58 个已暂存后端受保护文件、`packages/`、`tests/backend/`、`reports/backend/`、根 `package.json`/`package-lock.json`/`tsconfig*.json`、`docs/`、`config/`。
- 严禁修改历史报告目录 `reports/frontend/`、`reports/integration/FE-000-R1-INTEGRATION/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-01/`、`reports/integration/FE-000-R1-INTEGRATION-REWORK-02/`。
- 严禁触碰其他 4 个工作区（`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review`）。
- 不提交、不推送、不执行 `git reset`/`clean`/`stash`/`merge --abort`，不合并 `main`，不启动 `FE-001`/`BE-001`。
