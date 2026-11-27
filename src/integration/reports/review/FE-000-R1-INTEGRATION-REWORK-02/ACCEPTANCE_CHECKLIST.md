# FE-000-R1-INTEGRATION-REWORK-02 验收核对单（ACCEPTANCE_CHECKLIST）

- **审核方**：独立前端代码审核人员（DeepSeek 4.1 Flash 1017）
- **审核日期**：2026-11-26
- **被审核候选**：`HEAD=be62996fae44df24094331d670f6f0ab3741a4f2` + `MERGE_HEAD=5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（完整工作区）
- **最终判定**：**PASS**（五项整改全部关闭；9 项 P3 观察不阻塞）

## A. 流程与交付物

- [x] 只读审核；未修改业务源码/测试/设计文档/`package.json`/`package-lock.json`/开发方报告
- [x] 未执行 `git reset`/`clean`/`checkout`/`stash`/`commit`/`push`
- [x] 审核对象为完整候选工作区（非仅 HEAD/Index）
- [x] 在独立隔离快照执行所有测试/构建/破坏性实验，未污染 `E:\idle-fishing-integration`
- [x] 交付 `REVIEW_REPORT.md`、`CODE_REVIEW.md`、`TEST_VERIFICATION.md`、`DESIGN_ISSUES.md`、`ACCEPTANCE_CHECKLIST.md`、`EVIDENCE_MANIFEST.sha256`
- [x] 每项问题含编号/严重程度/源码位置/触发条件/复现步骤/实际/预期/阻塞判定/修复建议

## B. Git 与证据（第一阶段）

- [x] 分支 `integration/fe-000-be-r1` 一致
- [x] HEAD `be62996…` 一致
- [x] MERGE_HEAD `5bcc9ac…` 一致
- [x] merge-base `358b111…` 一致
- [x] 58 个已暂存后端文件与 `5bcc9ac` **工作树 0 差异**（`git diff` 为空）
- [x] 58 个已暂存后端文件与 `5bcc9ac` **Index 0 差异**（`git diff --cached` 为空）
- [x] 暂存区不含任何前端/测试文件（前端整改均在未暂存/未跟踪）
- [x] 74 项 SHA-256 清单 **74/74 匹配**
- [x] 历史 `REWORK-01` 报告条目 **0 漂移**
- [x] 历史 `FE-000-R1-INTEGRATION` 报告条目 **0 漂移**
- [x] 测试报告引用的 29 个日志全部存在、命令/退出码/摘要一致
- [x] 清单覆盖全部候选变更（无遗漏、无越界）

## C. P1-01（N1+N2）存储健康与冻结恢复

- [x] `StorageHealthState` 按 `storageKey` 作用域共享（同命名空间协调器一致）
- [x] 所有协调器共享正确健康状态（进程内 Map + 统一 storageKey 推导）
- [x] probe 失败立即 `STORAGE_UNAVAILABLE` 冻结（commit/loadSafe 双路径）
- [x] load 失败（全槽 IO）冻结
- [x] commit 物理写失败冻结（`WRITE_IO_ERROR`/`QUOTA_EXCEEDED` 等）
- [x] read-back 失败行为：`UNCERTAIN` + 应用层停止写入；健康标志不冻结（REV2-01，P3）
- [x] 冻结状态不可被 commit 绕过（恢复后未 `loadSafe` 仍拒绝）
- [x] 恢复时重新读取真实持久化数据（3 槽 + Envelope + revision）
- [x] 无旧内存状态覆盖新存档（外部 rev2 场景：`loadSafe` 读 rev2，旧 expected 提交 `CONFLICT`）
- [x] 微信 API 不存在时严格 fail-closed（`wx`/fsm/USER_DATA_PATH/6 方法逐项验证，无内存降级/无 EMPTY/无假 COMMITTED）
- [x] 微信文件不存在（EMPTY）与文件系统不可用（STORAGE_UNAVAILABLE）语义区分
- [x] 恢复期间再次失败 → 再次冻结（E3）
- [x] BootEntry 启动态 probe 失败：fail-closed、0 写、恢复后读到原档（Chrome T13）

## D. P1-02（N3）生命周期与待写任务

- [x] `onDestroy()` 同步设置销毁标志
- [x] QUEUED→STARTED 转换原子（生产路径在取消检查与 `onStarted` 间无 await）
- [x] 尚未开始的任务可取消且**零物理读写**
- [x] 已 STARTED 任务不被错误取消（含已写盘、read-back 未完成）
- [x] 已销毁实例不再接收正式任务（生命周期入口/`requestHideSaveForTest` 均拒绝）
- [x] 多个异步队列无交错（统一 `pendingHideSave` 链 + 协调器串行）
- [x] 销毁与物理写入竞态：STARTED 完成、QUEUED 取消
- [x] 新旧实例无双写（同队列 + 同 Web Lock + revision 校验）
- [x] HIDE/SHOW/HIDE + onDestroy：两个排队任务均 `CANCELLED`
- [x] 销毁与 Web Lock 获取交错：取消发生在锁内物理 IO 之前
- [x] 备注：诊断 harness 存在销毁后直提通道（REV2-03，P3，非正式入口）

## E. P1-03（N4+N5）Node 24 测试运行器

- [x] `node-test-worker.mjs` 使用真实 Node 24.20.0 事件树（审核方独立探针确认）
- [x] 叶测试计数：describe/父测试/文件包装器不计 pass
- [x] 仅 skip/todo 父测试：`total=2 pass=0 skip=1 todo=1`（对抗夹具 A1）
- [x] 4 层嵌套：`pass=2`（A2）
- [x] 多文件嵌套：`total=7 pass=3 fail=2 skip=1 todo=1`
- [x] 多个失败叶：`fail=2` 且退出 1
- [x] 空文件 → 退出 1
- [x] 全 skip / 全 todo → 退出 1
- [x] 模块加载异常 → `containerFail≥1`，退出 1
- [x] `process.exit(0)`（加载时/测试体内）→ 哨兵缺失，`procErr=1`，退出 1
- [x] `process.exit(1)` → `procErr=1`，退出 1
- [x] 未捕获异常 → 退出 1
- [x] 子进程信号终止 → 退出 1
- [x] 测试输出不完整（提前退出）→ 退出 1，不把已通过计数当整体成功
- [x] 正常执行 → 退出 0，叶计数准确
- [x] 多文件：正常 + 崩溃混合 → `pass` 计数保留但整体退出 1
- [x] 父测试子项通过后父级抛错 → `pass=1 + containerFail=1`，退出 1
- [x] 备注：无 worker 超时（REV2-06，P3）

## F. P2-04（L1）跨标签页写入互斥（真实 Chrome）

- [x] Web Locks API 真实接入（Chrome 158 `navigator.locks`）
- [x] 所有正式写入入口使用同一锁标识（`idle-fishing:save:browser:<namespace>`）
- [x] 锁覆盖读取→revision 校验→提交→回读完整临界区
- [x] 锁不会在 read-back 前释放
- [x] 两个协调器实例共享同一锁命名空间（第二实例 loadSafe 被同一锁阻塞）
- [x] Web Locks 不可用时拒绝写入（`STORAGE_UNAVAILABLE`，0 槽写）
- [x] 锁请求被拒绝时 fail-closed（0 槽写、冻结）
- [x] 持锁页面关闭后恢复（Chrome 自动释放；幸存页提交 rev+1 并重载一致）
- [x] 快速连续提交正确串行化（同页并发 1 COMMITTED+1 CONFLICT；跨页 rev 递增）
- [x] 双标签页不同候选并发：锁内先到者 COMMITTED、后到者 CONFLICT
- [x] 等待方在锁上阻塞期间零槽写入
- [x] 最终存档仅含唯一成功候选（磁盘单槽 + 双页重载一致）
- [x] 页面刷新：boot `loadSafe` 受锁保护
- [x] 销毁与锁等待交错：取消后磁盘不变

## G. P2-05（N6）输出目录删除安全

- [x] 精确白名单（`.compiled*` / `web-mobile` / `wechatgame` / `fe000-r1-chrome-*`）
- [x] 路径规范化（Windows 大小写、分隔符、尾分隔符）
- [x] 盘符根拒绝
- [x] UNC 与 `\\?\` 扩展路径拒绝
- [x] 相对路径与 `..` 穿越拒绝
- [x] 受保护路径拒绝（仓库根/父目录/apps/packages/tests/reports/docs/config/Desktop/Documents）
- [x] 符号链接/Junction 通过 `lstat + realpath` 拒绝
- [x] 不存在目录：向上解析最近祖先并校验，不越权
- [x] 存在父目录情况：仅直接子目录 + 命名匹配
- [x] **字符串前缀漏洞**：`build\web-mobile-evil`、`web-mobile.bak` 不被接受，金丝雀存活
- [x] 嵌套 Junction 不被 `rmSync` 穿透（外部金丝雀存活）
- [x] Runner `--out-dir=../../reports` 在删除前拦截且零删除
- [x] 破坏性实验均在隔离沙箱/快照执行，未对真实用户目录删除

## H. 组合故障（第三阶段）

- [x] 存储失败 + HIDE + onDestroy：冻结 + 拒绝新任务 + 无后续写
- [x] 存储恢复 + 旧实例重新提交：读最新磁盘，旧 revision `CONFLICT`
- [x] 双标签页 + 持锁页面异常关闭：自动释放 + 恢复提交 + 重载一致
- [x] Web Lock 获取失败 + 存储健康：冻结 + 显式恢复
- [x] 多文件嵌套测试 + 模块提前退出：计数正确且整体失败
- [x] 非法输出路径 + Junction 逃逸：拦截且零删除

## I. 独立回归（第四阶段）

- [x] `npm run verify` → 退出 0，82/82 PASS
- [x] `npm run test:perf` → 退出 0，黄金 envelope SHA-256 匹配
- [x] A1–A8 → 8/8 PASS
- [x] `npm --prefix apps/game-client run typecheck` → 0 错误
- [x] `npm --prefix apps/game-client run test:frontend` → 15/15 PASS
- [x] `npm --prefix apps/game-client run build:web` → 退出 0，36 文件 / 2053.15 KB
- [x] `npm --prefix apps/game-client run verify:web` → 28/28 PASS
- [x] `npm --prefix apps/game-client run build:wechat` → 退出 0，41 文件 / 1964.61 KB
- [x] `verify-wechat-build.mjs` → 10/10 PASS

## J. 结论与后续

- [x] 五项整改全部关闭 → **PASS**
- [x] 无阻塞 GATE-01 的问题
- [x] 9 项 P3 观察已记录（见 `DESIGN_ISSUES.md`），不要求本轮修复
- [ ] **GATE-01 批准**：由项目负责人按流程决定（本审核方不代行批准，不授权合并 `main`）
- [ ] **微信真机/开发者工具/真实广告**：仍为外部 `BLOCKED`，需 GATE-01 真机阶段补测
- [ ] 第二轮独立复审：等待负责人安排 GPT-6.2 Astra High

**审核签署**：DeepSeek 4.1 Flash 1017（第一轮独立技术初审）
**日期**：2026-11-26
**审核结论**：`PASS`