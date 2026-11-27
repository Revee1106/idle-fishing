# 独立复测记录

2026-11-26，Windows、Node 24.20.0、npm 11.4.2、TypeScript 5.9.3、Cocos Creator 3.8.8、Chrome。将候选的索引跟踪路径、可见未跟踪工作文件及本轮/上轮集成证据复制至新目录 `C:/Users/WANGWE~1/AppData/Local/Temp/fe-r2-0_3lqr_h`，从现有锁文件安装，无核心 dist、node_modules 或客户端构建缓存作为输入。审核结束时复核候选文件哈希、Git 状态和完整索引。命令均从隔离根目录执行。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| npm ci --offline --ignore-scripts --no-audit | 0 | 使用锁文件恢复依赖 |
| npm run verify | 0 | 后端类型、ESM 与 Cocos 构建、严格消费者、82/82（含 G01/G02） |
| npm run test:perf | 0 | 5 个一致性检查通过，24h Envelope 全文 SHA-256 为 0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f |
| node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs | 0 | A1–A8 8/8 |
| npm --prefix apps/game-client run test:frontend | 0 | Node/Mock 13 项实际执行，原 10 项保留，另 3 项为存储不可用、并发和 runner 门禁 |
| npm --prefix apps/game-client run build:web | 0 | 在空构建目录产出 Web 包，并生成 cc 声明 |
| npm --prefix apps/game-client run typecheck | 0 | 完整客户端配置通过 |
| npm --prefix apps/game-client run verify:web -- --out-dir=audit-web | 0 | 真实 Chrome 24/24；检查保存、重载、坏槽、单写队列、UI、广告桩、资源和向量 |
| npm --prefix apps/game-client run build:wechat / run verify:wechat | 0 / 0 | 微信产物静态 10/10 |
| node tests/frontend/fe-000/audit-r2-final.mjs / audit-late.mjs / audit-tabs.mjs | 各 0 | 真实 Web 补充采集。业务判据见下；采集成功包括成功复现反例 |
| node audit-ports.mjs | 0 | 单实例/双实例屏障、冲突、失败后下一次成功均有状态断言；微信采用能力故障替身 |

**构建归属。** 从候选独立重建，Web 36 个文件和微信 41 个文件均与开发工作区产物逐个 SHA-256 相同。原 21 个 Web 断言名称均保留，重建版实跑 24 个。结构化结果见 web-results.json 和 wx.log。运行时生成的动态 UI 截图按独立目录保存。开发报告的 48 个哈希均从原工作文件重新计算；新增协调器、Cocos meta、5 个测试夹具、修改的测试配置与脚本、开发报告、日志和证据均在应交与实交路径集合内。17 份被忽略的本轮日志在本机存在，跨机交接时仍需显式保存。见 git-audit.txt。

**真实 Web 负向验证。** 向真实文档派发 visibilitychange，驱动 Boot 自身注册的回调。浏览器资料目录和所有槽专用于实验。场景 A/B 的起始字节在新文档脚本内、Boot 初始化前采样，避免把卸载旧页面时可能发生的合法 HIDE 写入错算为探针失败造成的写入。boot-extra.json 中 strictProbe、seedRevision、exactA、strictRecover、exactB 是这组严格前后对照；较早的 untouched/allRecovered 从前一个页面更早时刻采样，不用于故障判定。两项严格逐槽比较均为 true，全量 payload、校验和及其余元数据均保留。readFailure 是全槽权限拒绝，deleteDenied 是实际 remove 调用得到 REMOVE_IO_ERROR。损坏 JSON 的真实 Boot 结果见 web.log。wx 文件系统替身的权限错误、非法 JSON、ENOENT 分别返回 STORAGE_UNAVAILABLE、CORRUPT、EMPTY；能力获取异常和缺失的反例见 ports.log。

**生命周期。** burst、writeFailure、uncertain、nochange、destroy 是独立采集的历史。首写确定失败未更新状态或 revision，第二任务从确认值推进；不确定时第二任务有明确跳过记录。销毁场景占用协调器独占队列，排队两个 HIDE，待第一个任务已交给协调器后调用相同组件的 onDestroy，再放开屏障。两个结果依次为 COMMITTED、SKIPPED_DESTROYED，槽字节发生变化；再发送事件无新增记录。这里直接调用实际销毁回调精确定位时序，未模拟设备进程被杀。

**并发。** 独立程序使用两个 BrowserFilePort 实例共享相同命名空间，并用不同候选、同一 expectedRevision、物理写屏障控制交错。同一协调器及两个协调器均仅一次成功，另一项 CONFLICT，重新 loadSafe 的完整状态等于胜者。先失败时另一候选成功且 rev1 正确。新建的第二个真实 Chrome 页面与第一页共用同源存储；两个页面各自的独立模块队列无法感知另一个页面的屏障，见 tabs.json。故障包装器的 storageKey 随底层持久端口；当前源码的持久写入者都走协调器。没有现场证据证明微信始终只有一个可能写同目录的上下文。

**runner。** 命令形式为 node tests/frontend/fe-000/run-node-tests.mjs --files=fixtures/名称.test.ts --out-dir=.compiled-audit，多文件用逗号分隔。隔离副本额外的 fixture 与原始输出均在 evidence。以下为 pass/fail/skip/todo。

| 输入 | 退出码 | 包装器计数及判断 |
|---|---:|---|
| fixture-empty | 1 | 0/0/0/0，正确 |
| fixture-skipped | 1 | 0/0/1/0，正确 |
| fixture-failed | 1 | 0/1/0/0，正确 |
| fixture-passed | 0 | 1/0/0/0，正确 |
| fixture-mixed | 0 | 1/0/1/0，正确 |
| 不存在的文件、空 --files= | 1、1 | 在执行前拒绝，正确 |
| 同时运行 fixture-passed 与 audit-nested | 1 | 仅报 1/1/0/0。实际有 2 个通过叶、2 个失败叶、1 skip、1 todo |
| audit-okgroup，describe 内两项全过 | 1 | 误报 0/0/0/0 |
| audit-only-parent，父项仅有 skip/todo 子项 | 0 | 误报 1/0/0/0，零个有效通过叶 |
| audit-crash，加载模块时抛异常 | 1 | 保留失败 |
| audit-exit，文件在注册测试前结束进程 | 0 | 没有总结记录，假通过 |

**证据使用方式。** audit-r2-final.mjs、audit-late.mjs、audit-tabs.mjs 放在隔离副本 tests/frontend/fe-000/ 下，audit-ports.mjs 放在根目录，在完成构建和前端 runner 后执行。新增 audit-*.test.ts 放在 tests/frontend/fe-000/fixtures/。命令日志、结果、探针和五份报告的原始字节哈希见 EVIDENCE_MANIFEST.sha256。
