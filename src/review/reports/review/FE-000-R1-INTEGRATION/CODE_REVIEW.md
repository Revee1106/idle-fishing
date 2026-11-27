# 源码复审与整改要求

以下路径相对集成工作区。Web 注入仅作用于审核用临时浏览器资料目录。

| 编号、分类、优先级 | 源码位置 | 实际行为与风险 | 整改与复审 |
|---|---|---|---|
| F1 IMPLEMENTATION_DEFECT，P1，阻塞 | apps/game-client/assets/scripts/platform/BrowserFilePort.ts:35、69、82；bootstrap/BootEntry.ts:136（同一 scripts 树） | 在实际 Web 包中先写出有效 rev1，重载前仅令 localStorage 的 __probe__ 写入抛错，真实槽仍可读。构造器改用空 Map，Boot 显示 EMPTY，HIDE 后记录 COMMITTED。旧槽仍在；会话误从新玩家开始，内存中的后续进度可能在退出时丢失。 | 持久化命名空间失去读写能力时显式返回故障；让 Boot 冻结或显示只读状态。保留明确选择的内存实验端口。回归验证既有槽、满配额/禁止写、访问恢复与刷新后的进度。 |
| F2 IMPLEMENTATION_DEFECT，P1，阻塞 | apps/game-client/assets/scripts/bootstrap/BootEntry.ts:257、259 | 新包连发 hidden、visible、hidden。两个真实 DOM 回调均被处理，但在进入 Promise 队列前已抓取相同 state 和 expectedRev。只有一次提交，rev1、hideCommitCount=1，最后结果 CONFLICT。第二次应保存的推进丢失。 | 在串行任务开始执行时读取最新已确认状态、revision 和冻结标志，再计算推进。用排队期间跨 HIDE 的成功、UNCERTAIN、失败和销毁路径回归。 |
| F3 TEST_DEFECT，P1，阻塞 | tests/frontend/fe-000/run-node-tests.mjs:91、112；本轮 TEST_REPORT.md:49 | 在隔离副本保留合法入口，只写 export {}，进程 0，报告 pass=1。只注册 test.skip 时内置输出 pass=0 / skipped=1，包装器仍 pass=1、退出 0。无文件参数/文件缺失会退出 1，但两份对应交付日志均只有 BOM 和换行（各 5 B）。门禁可以在零项实际执行时放行。 | 对已注册且实际执行的用例计数，剔除文件级成功、skip、todo；保留真实失败码。用缺文件、空列表、空文件、全跳过、正常混合、失败用例回归，记录 stdout、stderr、退出码与实际项数。 |
| F4 TEST_DEFECT，P2，阻塞并发项 | tests/frontend/fe-000/platform-and-core.test.ts:605；packages/game-core/src/spike/save.ts:489、565；PlatformVerificationSuite.ts:181 | 开发用例在第一次提交完成后才传旧 revision。独立探针让同库两个 commit 在同一次初始扫描后选中同一槽，延迟第二个物理写直至第一个返回成功。两个不同状态都获 COMMITTED、rev1、slot0，最后只读到第二份。单写者约束对调用方有实际影响。 | 按 11 的应用层串行职责，在实际集成入口证明同一命名空间独占写入；明确直接并行调用仓库的前置条件，用真实交错回归。若要支持多写者，由共享模块所有者评估原子性，前端不改受保护源码。 |
| F5 工程验证 TEST_DEFECT，P2，非独立阻塞项 | apps/game-client/tsconfig.typecheck.json:14；本轮 ISSUE_REPORT.md:9 | 无 Cocos temp 的隔离副本运行完整 typecheck 退出 2，执行 build:web 后同一命令退出 0。直接作为新机器第一步会误阻塞流水线。 | 在可执行验证流程或交接步骤中先导入工程生成 cc.d.ts，再执行同一完整检查；保留 typecheck 本身的失败码和配置。 |

**其余源码。** SharedCoreBridge.ts:11、266、498 调用共享 API，未见复制核心算法。客户端包名入口解析到 dist/spike/index.js 与 index.d.ts。另有独立 .mjs 运行时用例和 .d.mts 严格消费者检查。两套产物都从同一次 TS 构建生成；客户端包名导入本身不足以证明它直接从 .mjs 路径加载。OverviewPage.ts:206、263 展示版本、摘要及锁状态，版本标签须结合 Git 和构建证据解释。

BootEntry.ts:114 起只有 EMPTY 初始化，VALID v2 恢复，旧 schema 或异常状态冻结。真实产物中 CORRUPT、UNSUPPORTED 及提交 UNCERTAIN 分支按预期工作；F1 发生在仓库接收端口结果之前。:343 的清除接口是显式测试操作，未发现启动中自动调用。PlatformVerificationSuite.ts:137、181、259、339 实际断言损坏回退、未知读零写并在 finally 清理订阅。写入后不可见、奖励重放分别由 Node/共享套件覆盖。verify-web-build.mjs:326、344、371 有 DOM 事件、页面刷新与槽数据检查，本轮增加了套件遗漏的故障与排队路径。
