# FE-000-R1-INTEGRATION-REWORK-03 验收核对单（ACCEPTANCE_CHECKLIST）

- **审核人**：DeepSeek 4.1 Flash 1017
- **日期**：2026-11-26
- **候选基线**：`HEAD=be62996…` + `MERGE_HEAD=5bcc9ac…`，完整工作区
- **最终判定**：**REWORK**
- **唯一阻塞项**：REV3-01 / A02 —— UNCERTAIN 冻结不跨浏览器标签页

## A. 流程与权限

- [x] 只读审核；未修改候选源码/测试/文档/`package.json`/`package-lock.json`
- [x] 未执行 reset/clean/checkout/stash/rebase/commit/push/merge
- [x] 所有构建、测试、删除实验在隔离快照/临时目录执行；未污染开发工作区
- [x] 未覆盖开发方报告；仅在指定审核目录写报告与证据
- [x] 报告六件套齐全（REVIEW/CODE/TEST/DESIGN/CHECKLIST/EVIDENCE）

## B. Git 与交付完整性（第一阶段）

- [x] 分支 `integration/fe-000-be-r1`
- [x] HEAD `be62996…`、MERGE_HEAD `5bcc9ac…`、merge-base `358b111…`
- [x] 58 个已暂存后端文件：工作树/Index 对 `5bcc9ac` **0 差异**
- [x] 暂存区无前端文件；前端整改均为未暂存/未跟踪
- [x] `FILES-REWORK.sha256` **68/68** 原始字节匹配
- [x] 清单覆盖 12 修改 + 3 新夹具 + 21 沿用 + 5 报告 + 15 日志 + 12 evidence；仅自排除清单自身
- [x] 历史材料 0 漂移（REWORK-02 41 条 / REWORK-01 29 条 / INTEGRATION 48 条）
- [x] 日志/证据存在且命令、退出码、摘要与报告一致
- [x] 构建可复现：Web **36/36 SHA 一致**；微信 **41 文件同字节**
- [x] 未见"改测试/源码后未重跑/未重建"

## C. A01 P0 双标签页单写者（关闭）

- [x] BrowserFilePort 在真实浏览器使用 IndexedDB（`idle_fishing_fs_v1`/`files`）
- [x] 所有操作同一数据库/Store；无 RAM 值缓存
- [x] Web Lock 名称稳定（`idle-fishing:save:browser:<ns>`）
- [x] 锁覆盖读→revision 校验→写→回读
- [x] 获锁后重新读取槽位与 revision
- [x] IndexedDB transaction 等待 `oncomplete`；abort/error 正确 reject
- [x] COMMITTED 前完成事务提交与回读校验
- [x] 锁缺失/拒绝 fail-closed（STORAGE_UNAVAILABLE、0 写）
- [x] 两页同时从 rev8 提交不同候选
- [x] A 先获锁、B 排队（held≠pending clientId）
- [x] A 成功后 B 重新读取最新版本 → CONFLICT
- [x] 最终盘面唯一成功候选（gold/cursor 双页一致）
- [x] 审核方 2 个独立 Profile × 12 轮 = 24/24；开发方 24/24；合计 48 轮 0 双 COMMITTED
- [x] 空盘竞争 2/2（审核方）+ 2/2（开发方）0 双提交
- [x] 持锁标签页 `Target.closeTarget` 后自动释放并恢复提交 rev+1

## D. A02 P1 UNCERTAIN 跨协调器冻结（**未关闭**）

- [x] 同一协调器 UNCERTAIN → 冻结
- [x] 同一页面不同协调器 → 冻结，0 写
- [ ] **不同标签页不同协调器 → 未冻结（FAIL：B COMMITTED）**
- [ ] **UNCERTAIN 后另一标签页直接提交 → 成功写入（FAIL）**
- [ ] **未执行 loadSafe 时跨页提交被拒 → 未满足（FAIL）**
- [x] 显式 loadSafe 后恢复（本 Realm 与跨页读取磁盘最新）
- [x] 恢复过程中部分 IO 仍失败 → 保持冻结（A03 覆盖）
- [ ] **同一存档域不因更换实例/标签页绕过隔离 → 跨页被绕过（FAIL）**

**A02 阻塞。**

## E. A03 P1 部分 IO 恢复（关闭）

- [x] 三槽逐一区分：文件不存在 / 内容损坏 / IO 读取失败 / 文件系统不可用 / 探针失败 / 回读失败
- [x] 最新槽不可读时不得选旧版本并恢复 AVAILABLE
- [x] 不得覆盖无法确认的最新存档（提交被 STORAGE_UNAVAILABLE 阻断，0 写）
- [x] 保持冻结（PARTIAL_IO_UNAVAILABLE + readOnlyBackup）
- [x] 恢复后重新读取真实持久化数据（rev3）
- [x] 全槽 IO → IO_UNAVAILABLE
- [x] 回读失败 → UNCERTAIN + 共享冻结（同 Realm）

## F. A04 P1 生产诊断入口与销毁（关闭）

- [x] 实际生产 Web 构建产物审计（非仅源码）
- [x] 测试专用破坏性存档清理移除（无 `clearLifecyclePersistence`/`clearSlotsForTest`）
- [x] 原始协调器不暴露（无 `getPersistCoordinator`）
- [x] 绕过所有者的提交入口移除（无 `commitCandidateViaCoordinator`/hooks/destroy/advance/reinit）
- [x] 真实 `BootEntry.destroy()` 后属性清空、HIDE 零物理写
- [x] Cocos 3.8.8 `_destroyImmediate()` 属性置空被 WeakSet + isValid 免疫
- [x] 销毁后 UI/harness 只读入口被拒

## G. A05/A06 异常分类与任务队列（关闭）

- [x] 锁内任务异常原样抛出，不误标 CROSS_TAB_LOCK_REJECTED
- [x] 真实锁拒绝 → CROSS_TAB_LOCK_REJECTED + 冻结
- [x] 缺锁 → CROSS_TAB_LOCK_UNAVAILABLE + 冻结
- [x] 单笔队列异常记录 FAILED，不毒化后续队列
- [x] 后续 HIDE 正常 COMMITTED
- [x] 无未捕获 Promise rejection（页面异常计数 0）
- [x] 销毁后排队任务 CANCELLED（两笔），零写；STARTED 完成

## H. A07 Node 24 运行器（关闭）

- [x] 空测试文件 exit 1
- [x] 全 skip / 全 todo exit 1
- [x] 仅 todo 测试体抛异常：`pass=0 todo=1` exit 1（零通过门禁）
- [x] 抛错 TODO + 正常叶：与 Node 24.20.0 原生一致 `pass=1 todo=1 fail=0 exit 0`
- [x] 父测试仅 skip/todo 不误计 pass
- [x] 多层嵌套/多文件嵌套精确计数
- [x] 多个失败叶 exit 1
- [x] `process.exit(0)` / `process.exit(1)` 哨兵缺失 → procErr=1
- [x] 未捕获异常 / SIGTERM → exit 1
- [x] worker 超时可配置，1500ms SIGKILL、约 4s、procErr=1
- [x] 子进程被终止 → exit 1
- [x] 正常通过 exit 0
- [x] A01–A10 编号与开发报告对应（A07 为运行器、A08 为路径、A09 诊断域、A10 报告口径）

## I. A08 输出目录安全（关闭）

- [x] 路径穿越 `..`
- [x] Windows 大小写/分隔符
- [x] 盘符根
- [x] UNC
- [x] NTFS ADS（`:stream`）
- [x] 扩展/设备路径（`\\?\`、`\\.\`）
- [x] 驱动器相对路径（`E:foo`）
- [x] 符号链接（候选 Junction 已验证；文件 symlink `NOT_RUN` EPERM）
- [x] Junction / 嵌套 Junction / 悬空 Junction
- [x] realpath/lstat 元数据 EACCES → fail-closed
- [x] 删除前二次 lstat 失败 → 拒绝，`rmSync` 0 次
- [x] 白名单精确匹配，`build-evil` 兄弟拒绝
- [x] 所有删除测试在隔离沙箱；金丝雀存活

## J. A09 诊断域（关闭，附 NOT_RUN）

- [x] 每次诊断临时命名空间
- [x] finally 清理
- [x] 两标签页并发 FS/Save 诊断 6/6 ×2（单独复测 2/2）
- [ ] 完整 `runAllPlatformChecks()` 后台并发：`NOT_RUN`（观察挂起，疑似 Cocos 分包加载）

## K. A10 报告口径（关闭）

- [x] 12 修改 / 3 新增 / 21 沿用分类与 REWORK-02 逐字节一致
- [x] 本审核撤回上轮 REV2-09（Astra 复核不成立）

## L. IndexedDB 兼容性（新增架构单独检查）

- [x] 旧 localStorage 存档存在：IDB 模式忽略
- [x] 无迁移机制（N/A）
- [x] 原始存档不被提前删除（localStorage 保留）
- [x] IDB 初始化失败 → STORAGE_UNAVAILABLE，非 EMPTY
- [x] 新旧同时存在 → IDB 优先
- [x] 迁移中断重试：N/A（无迁移）
- [x] 旧存档不被新空存档覆盖（不同存储；旧数据保留）
- [x] revision/slot/checksum：N/A
- [ ] **前提/设计依据**：开发方已在 ISSUE_REPORT §2.2 记录"无正式线上玩家数据"；仍需负责人/设计方正式确认（REV3-03）
- [ ] **IDB 缺失回退**：静默 localStorage 并允许写；旧档在回退模式复活（REV3-02，P2）

## M. 独立回归

- [x] `npm run verify` 82/82 exit 0
- [x] `npm run test:perf` 5/5 exit 0，黄金哈希
- [x] A1–A8 8/8
- [x] `typecheck` 0
- [x] `test:frontend` 18/18
- [x] `build:web` 36 文件/2060.27 KB；独立重建 SHA 全一致
- [x] `verify:web` 28/28（0 双提交）
- [x] `build:wechat` 41 文件/1971.73 KB；与开发方同字节
- [x] `verify:wechat` 10/10

## N. 结论

- [x] A01、A03、A04、A05、A06、A07、A08、A09（FS）、A10 **关闭**
- [ ] **A02 未关闭（P1，阻塞）**
- [ ] **REV3-02/03 需设计方/负责人决策**
- **判定：REWORK**；修复 A02 后须重新全量回归与双 Profile 竞争复验，再交 Astra 复审。
- 微信 IDE/真机/真实广告：`BLOCKED/NOT_RUN`，未以静态审计替代。
- 本初审 PASS 与否均不代表 Astra 复审或 GATE-01 批准。