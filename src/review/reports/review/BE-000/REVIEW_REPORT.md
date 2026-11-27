# BE-000 独立技术审核报告

**结论：REWORK。** 共享 TypeScript 模块可在 Node 和 Cocos Web 上执行，开发侧 64 项测试可复现。三槽写入确认、奖励幂等、离线检查点和进行中尝试迁移尚未满足后端验收。已存在可在当前设计下修复的缺陷，开发方可以立即整改。

## 审核对象与依据

| 项目 | 核实结果 |
|---|---|
| 任务、工作区、日期 | BE-000 后端工程与共享核心技术验证，`E:\idle-fishing`，2026-11-25 |
| 分支、基准、实际提交 | 当前 `feature/be-000`，基准与 HEAD 均为 `2106ce19d991ec47555cdbf207454c36d8cd104a`。没有单独的 BE 实现提交。直接检出 HEAD 只能得到项目骨架。 |
| 实际审核对象 | 上述 HEAD 加未提交的后端源码、配置、夹具、测试和报告。已记录 63 个输入文件的 SHA-256 清单，摘要见测试报告。审核后回核 63 项均一致。 |
| 变更范围 | 修改根 package.json，新增锁文件、两份根 TS 配置、game-core 包配置、构建桥接、9 份 Spike TS 源文件、后端测试与三组向量、四份开发侧报告、后端状态及 Cocos 探针。未见 BE 范围内删除。工作区另有前端文件和 REVIEWER.md；现有 Git 历史无法归属每个未跟踪文件的作者，已按任务所有权隔离。 |
| 授权及前置 | 项目设计会话《挂机钓鱼小游戏设计》§5.1 的 BE-000 任务书明确允许后端独占本次根 Node/TS/npm 配置及 v0.3 技术实验。初始化提交和目录可核。DEVELOPMENT_PLAN 将 INIT-001 列为待复查，仓库未见其独立 PASS 记录。当前审核由负责人明确指派，不由此推断前置已正式批准。 |
| 规范与设计状态 | REVIEWER、根及 packages、simulator 的 AGENTS，ARCHITECTURE、DEVELOPMENT_PLAN、DEVELOPMENT_STATUS、DECISIONS、ISSUES；v0.2 的 00、09–14，尤其 11 §5–6、12 §3/§7（离线会话见第84–86行）、14 §3。00 记录已确认的架构与事务方向。15–20 及 docs/interfaces/contracts.ts 为 v0.3-draft，按任务书用于实验对照。 |
| 开发侧证据 | reports/backend/BE-000 下 IMPLEMENTATION_REPORT、TEST_REPORT、ISSUE_REPORT、SHARED_MODULE_HANDOFF、探针 JSON、本地 9 份日志及 reports/backend/DEVELOPMENT_STATUS.md。交接说明含源码入口、命令、导出、引用及向量。日志受 Git 忽略，旧临时 Cocos 工程仅在本机可得。 |

## 后端任务验收

| 项目 | 结果 | 可核实的边界 |
|---|---|---|
| 权限、结构、纯 TS | PASS（本次快照） | 共享核心仅有本地模块依赖，Node 文件系统与性能 API 位于测试和构建侧。包无运行时第三方依赖。docs、正式契约、正式数值与基准一致。未发现后端交付提前实现八模型、正式状态机、服务端、数据库或后续任务。 |
| 环境与交付完整性 | 部分满足 | 有 Node/npm/TS/Git/Cocos/OS 版本、锁文件、实现/测试/问题/交接报告和状态。其他包管理器可用性未见完整记录。测试报告的文件数及部分覆盖结论需修正。 |
| T02 共享规则 | PASS（运行时）；类型交付有缺口 | 同一源码编译为 Node ESM、转换为 9 个 Cocos .mjs。独立 Cocos Web 探针和 Node 的随机输出、24h 状态摘要相同。严格 TS 消费 .mjs 出现 TS7016。 |
| T03 确定性 | PASS（Node/Web 已测范围） | 固定向量、流独立、恢复和分片通过；独立恢复后 1,000 次抽样与连续运行一致。Web 19 个数学向量和 Node 24h 输出一致。微信运行时待联验。 |
| T04 文件存档 | FAIL | 正常三槽轮换、真实临时文件、常规损坏回退通过。单槽读取未知、同版本分歧及非法 payload 未能安全处理（I01、I02）。 |
| T05 故障恢复与防重复 | FAIL | 写后结果不可见的故障被误判为确定失败；一个通过仓库校验的恢复状态会再次发放已有奖励（I01、I03）。 |
| T06 24h 离线 | 性能测量 PASS；检查点 FAIL | 14,935 节点，连续、两种时间分片、64 节点预算和恢复后的完整输出一致。各路径共同保留错误的 settledUntil，结果相同不足以证明该字段正确（I04）。 |
| T07 迁移 | FAIL | 空闲 v1→v2、旧槽保留和无效输入失败通过；进行中尝试的必需样例缺失（I05）。 |
| T12 可重复构建 | PASS（Node 与本机 Cocos Web）；交付可移植性受限 | 锁文件安装、严格检查和产物构建可复跑。Web 在开发侧遗留探针工程的独立副本重建成功。单凭仓库中的 BE 文件不能还原该临时场景。微信构建由前端联验。 |
| T13 修复闭环 | PASS | 隔离副本复现乘数 9→8 后 58/64 通过，按字节恢复源文件后 64/64 通过，与开发侧红绿日志一致。 |
| T01、T08、T09、T10、T11 | NOT_RUN（BE 范围外） | 微信启动、生命周期、广告、分包和 Code First 页面由 FE/平台联验。真机存档、性能、帧阻塞及完整 S0 门禁仍待实测。 |

## 审核发现

下列源码位置相对于 `packages/game-core/src/spike/`。A1–A8 的完整可执行用例与实际结果见 TEST_VERIFICATION.md。严重程度与验收阻塞分别列出。

| 编号、分类 | 等级 / 阻塞 BE | 证据、影响和整改方向 |
|---|---|---|
| I01 IMPLEMENTATION_DEFECT | P1 / 是 | save.ts:351、355、424–459。A1 隐藏 revision 9 后仍可创建 revision 1。A2 候选 revision 2 已完整写入，回读及重扫时目标槽不可读，返回 FAILED，恢复可读后却载入 revision 2。A3 两个同 revision 异内容的槽使 load 返回 CORRUPT，commit 仍写出 revision 8。统一扫描判定，区分明确不存在、无效和未知，在无法确认时停止写入或返回 UNCERTAIN。否则调用方可能回退进度或重试已落盘的交易。依据 11 §5、14 T04/T05。 |
| I02 IMPLEMENTATION_DEFECT | P1 / 是 | save.ts:204–211、258。A4 含有效校验和的非法状态 null 导致读取 schemaVersion 抛 TypeError，整次 load 中止，有效备份无法恢复。每个槽独立验证 payload 类型、规范化与状态，单槽内容错误不得中止扫描。依据 11 §5、14 T04。 |
| I03 IMPLEMENTATION_DEFECT | P1 / 是 | offline.ts:289–293，save.ts 的 validateSpikeState。A8 构造“奖励键已存在、同一尝试仍待结算”的不一致候选，经真实 commit/load 接受，结算后金币 100→131，claims 仍只有 fish:1。正常单线运行未观察到自发产生此状态；入口确实接受且恢复后可重复发奖。校验进行中阶段与终止标识，并在业务结算边界保护所有奖励副作用。依据 11 §5、14 T05。 |
| I04 IMPLEMENTATION_DEFECT | P1 / 是 | offline.ts:72、226。A5 会话内推进至 4500 ms，阶段进度与 cursor 已更新，settledUntilMs 仍为 0；一小时参考夹具也冻结了起始值。按已处理的有效区间同步推进检查点，截止后的世界推进不能增加已结算时长。依据 12 的离线会话与检查点、14 T06。 |
| I05 IMPLEMENTATION_DEFECT | P1 / 是 | migration.ts:38 及 types.ts 的 SpikeGameStateV1。v1 仅记录计数与 RNG，迁移总是生成 IDLE。MIG-01 不能证明进行中的尝试可延续。14 T07 明确允许并要求最小实验样例；请用实验夹具验证保留原进度、已抽结果和旧槽。 |
| I06 IMPLEMENTATION_DEFECT | P2 / 否，列入复审 | time.ts:93，offline.ts:144 的同类加法。A6 时间差可安全表示，但与起点相加得到 9007199254740992。按已有安全整数毫秒约束检查最终时间并补边界回归。 |
| I07 IMPLEMENTATION_DEFECT | P2 / 否，限严格类型接入 | 构建脚本复制 .d.ts，前端按交接文档从 index.mjs 导入时，TS 5.9.3 严格模式报 TS7016。运行时构建有效。补可解析的声明及消费者编译测试，或明确实验入口的类型限制。 |
| I08 IMPLEMENTATION_DEFECT | P2 / 否，限替换夹具 | offline.ts:65、178。初始化提供 castMs=17，其余同默认，17 ms 后仍在 CASTING；推进使用默认的 1500 ms。开发方 ISS-09 已披露。使暴露的实验入口和推进/恢复使用同一夹具，或收窄入口为受支持的默认夹具。 |
| V01 TEST_DEFECT | P1 / 是 | save.test.ts:200–：SAVE-T05 在测试内部定义自带去重的 grant，不能证明实际 FIGHTING 结算入口防重复。SAVE-T04e 引入额外高版本，遗漏“已写目标暂不可读但旧槽可读”。OFF-09 的 target 恰等于 deadline，关键的 > 分支未执行。应覆盖真实入口和明确边界。 |
| V02 TEST_DEFECT | P1 / 是 | IMPLEMENTATION_REPORT §7 将 T07 标 PASS，同时 ISSUE_REPORT ISS-04 说明必需样例未测；T04/T05/T06 也须按反例更新。TEST_REPORT §2 写 10 个测试文件，实际 9 个、64 项。实现报告 §3.2 写高 26/低 27 位，源码与 19 的伪代码取 27/26。更正证据和各门禁状态。 |

开发侧的 64/64、T13 失败/恢复与性能终态均有可重复证据。发现的是覆盖不足与状态过度概括；现有材料不足以认定伪造、删除测试或人为篡改历史预期。当前无开发实现提交，无法用提交史还原开发过程中的所有编辑。前端 Web 探针已独立验证；开发侧如实披露微信真机未测。

## 处置

由原后端开发 AI 按 REWORK_PROMPT.md 整改，复审时同时提交失败前、修复后和完整回归证据。正式存档兼容格式、硬件预算等决策见 DESIGN_ISSUES.md。上述设计待办不妨碍本次后端整改。本结论不批准进入依赖 BE-000 的后续任务。
