# FE-000-R1-INTEGRATION-REWORK-04 验收检查表（ACCEPTANCE_CHECKLIST）

- 审核方：DeepSeek 4.1 Flash 1017（第一轮定向独立复验）
- 候选：`E:\idle-fishing-integration` 工作树（HEAD `be62996…` + MERGE_HEAD `5bcc9ac…` + 未提交前端整改）
- 最终判定：**REWORK**
- 说明：本表不是 GATE-01 批准，仅记录 DeepSeek 复验结果。

---

## A. 基线与交付完整性

- [x] HEAD/MERGE_HEAD/merge-base 与任务书一致（`be62996…` / `5bcc9ac…` / `358b111…`）
- [x] Git 写操作纪律：无提交/推送/合并/reset/clean/stash
- [x] REWORK-04 `FILES-REWORK.sha256` 64/64 逐字节匹配
- [x] REWORK-03 DeepSeek 初审 `EVIDENCE_MANIFEST.sha256` 60/60 匹配
- [x] 58 个受保护后端文件对 `5bcc9ac` 零漂移
- [x] 历史开发/审核报告零漂移（R1 29/29、R3 32/32、R2 目录逐字节一致、R3 初审 60/60）
- [x] 8 个修改文件 / 28 个沿用文件逐字节一致 / 0 新增源码或夹具
- [x] 最终构建与测试日志对应最终候选源码（mtime + 独立重建 36/36 哈希一致）
- [x] 记录完整候选身份（36 个代码/测试文件哈希 + 64 项交付清单）

## B. A02 持久化事务状态（任务书 5.1）

- [x] 同一存档域所有协调器使用相同事务标记（`${namespace}:__tx_state__` / `__tx_state__.json`）
- [x] 跨标签页读取真实持久化标记，而非本地内存缓存
- [x] Web Locks 覆盖标记读取、写入、存档提交、回读、清理全过程
- [x] PENDING 标记在可能修改真实存档前持久化（首个槽位写前已可见）
- [x] 标记无法读取或写入时禁止存档写入（0 槽位写）
- [x] 标记清理失败不返回虚假 COMMITTED（返回 UNCERTAIN）
- [x] UNCERTAIN 后不因更换协调器、刷新、关闭标签页绕过冻结
- [x] 不同存档域互不干扰

## C. A02 真实 Chrome 14 场景（任务书 5.2）

- [x] 1. A 正常 HIDE UNCERTAIN，B 正常 HIDE 拒绝
- [x] 2. A UNCERTAIN，B 直接调用协调器拒绝
- [x] 3. A 刷新后标记仍有效
- [x] 4. A 关闭后 B 仍不能绕过
- [x] 5. PENDING 写入失败，真实槽位零写入
- [x] 6. PENDING 成功后、写槽前崩溃
- [x] 7. 已写盘、回读未完成时崩溃
- [x] 8. 提交完成但标记清理失败
- [x] 9. 事务标记损坏或读取失败（安全侧阻断；但**公开 API 不可恢复** → REV4-03）
- [x] 10. 部分存档槽位 IO 不可用时恢复（冻结 + readOnlyBackup）
- [x] 11. 显式恢复成功后重新提交
- [x] 12. 显式恢复后旧实例提交（旧 revision → CONFLICT）
- [x] 13. 不同存档域同时运行
- [x] 14. 恢复与另一标签页等待提交交错

## D. A02 正常路径不退化（任务书 5.3）

- [x] 正常 COMMITTED
- [x] 正常 CONFLICT（不冻结、不留标）
- [x] 确定性写前失败（FAILED、不冻结、可重试）
- [x] 确定性事务失败（标记写失败 → STORAGE_UNAVAILABLE、0 写入）
- [x] UNCERTAIN（安全侧冻结、需显式恢复）
- [x] 标记清理失败（UNCERTAIN、标记保留）
- [ ] **有效存档域 + 槽位消失 → EMPTY 清标**（FAIL：REV4-01）
- [ ] **真实写失败/配额冻结的玩家影响与可恢复性说明**（未说明：REV4-04）

## E. A02 显式恢复边界（任务书 5.4）

- [x] 自动启动、刷新、SHOW、HIDE 不静默解冻
- [x] 所有槽位完成真实读取及校验后才允许恢复（VALID/EMPTY 路径）
- [x] 不把不可访问的存档误判为 EMPTY
- [ ] **已有有效存档的域不能仅凭 EMPTY 清除待确认标记**（FAIL：REV4-01）
- [x] 恢复后严格 expectedRevision（旧 revision → CONFLICT）
- [ ] **应用存在明确的恢复入口，不依赖破坏性诊断 API**（FAIL：REV4-02）

## F. P2 存储策略（REV3-02 / REV3-03）

- [x] indexedDB 缺失 → fail-closed，0 localStorage 写
- [x] indexedDB 初始化失败（open 抛错）→ fail-closed
- [x] IndexedDB transaction abort / 权限失败 → fail-closed
- [x] Node 显式注入 Mock 仅在 `allowLocalStorageMockInNode && isNodeTestHost()`
- [x] 真实浏览器不能进入 Node Mock 分支（真实 Chrome 实证）
- [x] 只有旧 localStorage 存档：检测、报告、不复活、不删除、不覆盖
- [x] 新旧存档同时存在：IDB 胜出，旧档原样保留
- [x] 旧存档存在但 IDB 不可用：fail-closed，旧档原样
- [x] 页面重复启动稳定
- [x] 正确报告 `DETECTED_IGNORED_NO_AUTO_MIGRATION`
- [x] 正式历史迁移体系不属本轮范围（开发方已记录设计待决项）

## G. 微信端事务标记（Mock）与真实边界

- [x] Mock：标记写入失败
- [x] Mock：标记读取失败
- [x] Mock：标记截断/损坏
- [x] Mock：标记删除失败
- [x] Mock：存档写入前后异常（确定性 PRE_WRITE）
- [x] Mock：同实例不同协调器冻结与恢复
- [x] 明确区分 Mock 与真实微信 FS
- [ ] 微信开发者工具/真机/真实广告（**BLOCKED / NOT_RUN**）

## H. A09 / REV3-04

- [x] 核对原始证据：组合运行 WATCHDOG abort；单独 FS 诊断 6/6 ×2 PASS
- [x] 后台挂起仅影响诊断脚本，不影响正式存档路径
- [ ] 后台标签页并发完整 `runAllPlatformChecks()`（**NOT_RUN**，非阻塞已知限制）

## I. A01、A03–A10 历史基线核对

- [x] A01 双标签页 12 轮 ×2 Profile + 空盘竞争，0 双 COMMITTED，崩溃后 rev21（开发方 E2E ×2 + 审核方独立脚本 ×2）
- [x] A03 部分 IO 冻结、readOnlyBackup、恢复后 rev3
- [x] A04 生产 harness 14 只读/UI 键、0 禁止方法、destroy 零写
- [x] A05 锁内任务异常不误判为锁拒绝
- [x] A06 HIDE 队列逐任务容错、排队取消、STARTED 完成
- [x] A07 Node runner 20/20（18 旧保留）
- [x] A08 安全路径守卫历史证据仍适用（文件未改）
- [x] A09 见 H
- [x] A10 本轮报告分类基本准确（“A02 已关闭”表述过宽 → REV4-07）

## J. 全量回归（独立执行）

- [x] `npm run verify` 82/82
- [x] `npm run test:perf` 5/5 + 黄金哈希
- [x] A1–A8 8/8
- [x] 前端 typecheck 0
- [x] 前端 `test:frontend` 20/20
- [x] 全新 Cocos Web 构建 36 文件 / 2,124,709 字节
- [x] `verify:web` 31/31 ×2 独立 Profile；12 轮 ×2；0 双提交
- [x] 全新微信构建 41 文件 / 2,034,046 字节
- [x] `verify:wechat` 10/10
- [x] 20 项 Node 与 31 项 Web 断言真实执行，无历史场景删除/降级

## K. 交付物

- [x] REVIEW_REPORT.md
- [x] CODE_REVIEW.md
- [x] TEST_VERIFICATION.md
- [x] DESIGN_ISSUES.md
- [x] ACCEPTANCE_CHECKLIST.md
- [x] EVIDENCE_MANIFEST.sha256（含证据，0 坏）

---

## 最终判定

**REWORK**

- **阻塞**：REV4-01（有效存档域 EMPTY 清标，P1）、REV4-02（应用无显式恢复入口，P1）。
- **非阻塞但需处理/说明**：REV4-03（损坏标记不可恢复、微信非原子标记写，P2）、REV4-04（配额/写失败保守冻结未说明，P2）。
- **P3**：REV4-05（暂存区措辞）、REV4-06（A09 已知限制）、REV4-07（A02 关闭表述过宽）、REV4-08（微信标记测试覆盖）。
- 通过项：跨页冻结、写前标记、崩溃/刷新/关闭阻断、P2 策略、A01/A03–A10 回归、构建可复现性。
- 修复后需重新全量回归 + 双 Profile A02 场景，再交 GPT-6.2 Astra High 最终复审；**本轮不代表 GATE-01 批准，不启动 BE-001/FE-001。**