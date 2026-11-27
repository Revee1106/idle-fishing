# FE-000 独立技术审核

**结论：REWORK。** 客户端可以在 Cocos Web 中运行，并复用同一份后端实验核心。实际 Web 产物丢失前后台事件回调、微信产物缺少分包注册、公开测试命令漏跑全部用例。三项均可在本机复现。微信 IDE 自动化、真机及真实广告还需独立取证。

## 范围、版本及授权

| 项目 | 审核记录 |
|---|---|
| 任务与日期 | FE-000 / SPIKE-001 前端部分，2026-11-25。设计会话《挂机钓鱼小游戏设计》§5.2 的 FE-000 详细任务书，尤其 §§6–12、14–15。 |
| Git | `E:\idle-fishing` 唯一登记工作树。任务指定 `feature/fe-000`；实际是 `feature/be-000`。本地分支、reflog 和远端 heads 均未找到 FE 专属分支，远端仅 main。共同基准、当前 HEAD、main 和 origin/main 均为 `2106ce19d991ec47555cdbf207454c36d8cd104a`。没有独立 FE 实现提交。 |
| 实际交付 | 基准上的未提交快照。FE 三个所属目录有 74 个 Git 可见的新增未跟踪文件，含 Boot 场景、页面工厂/路由、平台与共享模块适配、两套构建配置、资源、Node 测试和一张截图。另有 Git 忽略的历史构建日志。未发现 FE 范围的跟踪文件删除。根 package.json 修改和 BE 源码按 BE 所有权作依赖输入；混合工作区不能用来证明作者身份。 |
| 依据 | REVIEWER.md、根及 apps/game-client/AGENTS.md、ARCHITECTURE、DEVELOPMENT_PLAN、DECISIONS、ISSUES；v0.2 的 00、11–14，v0.3 的 15、17–20 与 docs/interfaces/contracts.ts；BE-000 的共享模块交接、独立审核及问题记录。00 说明已确认架构和事务方向，14 定义实验范围与 T01–T13。15 标为 v0.3-draft，平台接口用于本次技术对照，正式冻结仍待批准。 |
| 前置与交付边界 | INIT-001 在计划中待复查。BE-000 独立结论为 REWORK；现有核心足以执行 FE 实验，后端已知的三槽、奖励幂等及迁移缺陷沿用 BE 结论。审核未将这些缺陷重复派给前端。 |
| 证据边界 | 客户端与所用 BE 模块复制到独立目录，清单见 TEST_VERIFICATION。开发侧 FE 目录仅找到 t13-before 截图和被忽略的同名构建日志。本次独立结果不能追认开发方曾运行相同测试。 |

## 任务书验收矩阵

| 项目 | 结果 | 证据和限制 |
|---|---|---|
| §3 范围与权限 | 实现范围符合；分支交付 FAIL | 代码集中于前端目录。前端从 @idle-fishing/game-core 导入实验算法，页面读取计算结果；没有发现另一套钓鱼算法、正式玩家资产写入、服务器、数据库、收费服务或 FE-001 页面。docs、正式配置与 contracts 相对 HEAD 无变更。平台桩使用自有实验返回类型，不能视为正式接口兼容。 |
| §§4–6、11 / T01、T12 工程与构建 | Web 启动 PASS；微信产包已复跑，工具/真机启动未证实 | Cocos 3.8.8 从隔离源码构建两种目标。Chrome 中 Boot 正常。微信首次构建有 worker 退出错误日志且包装脚本报告成功，包审查另见 I02。微信 IDE 已安装，服务端口关闭，游客 AppID。完整客户端类型检查 FAIL。 |
| §7 / T11 Code First | Web 已验证主要交互 | Boot 场景挂载组件；动态生成节点、文本、图片、按钮、行列布局、滚动列表、弹窗及两页。代码有循环 Tween 和 resize 订阅。桌面 Chrome 移动视口中实际点击打开弹窗、切换平台页；切回、共享数据刷新及横竖屏指标已复核。平台结果列表实际滚动 0→102。逐帧动画及微信触屏体验未完成设备验收。 |
| §8 / T02、T03 | Node/Web 已测项 PASS；微信待验 | 同一核心包完成 SHA、规范 JSON、BigInt 往返、固定 PRNG 向量、恢复/流独立、数学检查和连续/分片对照。Web 7 个共享用例全绿（含 T07 基础样例）。24h 终态与独立 Node 输入相符。 |
| §9 / T04 | Node/Mock、Web 局部 PASS；真实微信待验 | 文件增删改查、三槽轮换、损坏/全坏、大小探针有实验结果。Web 使用 localStorage，测试尺寸为 64/256 KB；微信存储配额和真实 IO 语义未测。 |
| §9 / T05 | FAIL | Web 写前/半写/写后抛注入通过，FS-BG-RECOVERY 失败。用例手动 emit 后显式提交，再新建仓库读取；即使通过也无法证明真实 HIDE 触发提交或跨进程强退恢复。 |
| §12 / T06 | Web 24h 对照 PASS；真机预算待测 | 14,935 节点，单次与 60 片计算终态相同；详见测试报告的耗时、最大切片、帧观测及桌面测量条件。 |
| T07 迁移配合 | 部分通过 | Node/Web 仅核实简单 v1→v2 与错误输入；进行中尝试由 BE-000 整改，真实平台旧档恢复仍待联验。 |
| §10 / T08 | FAIL | Web 实际产物无法派发 HIDE/SHOW；无单调能力时计时守卫仍接受墙钟前跳。Node 虚拟时钟用例通过。真实后台、强退、回拨重入缺证。 |
| §10 / T09 | 实验桩 PASS，SDK 适配 FAIL，真实广告 BLOCKED | 实验桩五类场景通过；SDK 适配器同请求创建两个实例，load 拒绝后残留回调。实际广告位、观看及设备证据缺失。 |
| §11 / T10 | FAIL | Web 可加载 spike-pack 的 manifest 和图标；微信 game.json 只有 deviceOrientation、networkTimeout，未注册分包，也没有对应分包目录。构建中的 assets/spike-pack 只证明资源随包存在。 |
| §12 / T13 | 开发侧证据不完整 | 历史截图及日志记录 BootEntry 缺失，当前审核能重建并操作页面。无可归属的前后修复差异、修后开发测试记录或开发报告，不能完整核实开发侧闭环。 |
| §§5、15 最终交付与环境 | FAIL | 缺 IMPLEMENTATION_REPORT、TEST_REPORT、ISSUE_REPORT、PLATFORM_HANDOFF 和 reports/frontend/DEVELOPMENT_STATUS。未提供开发侧分项结果、包体与设备/账号条件、失败清单。 |

## 问题及整改归属

源码行锚点均为本次快照。严重程度指影响，阻塞列指本次 FE 技术验收。

| 编号 / 类别 | 等级 / 阻塞 | 复现、影响、修复要求 |
|---|---|---|
| I01 IMPLEMENTATION_DEFECT | P1 / 是 | WeChatLifecycleProvider.ts:50。Node 对 Set 展开正常，Cocos Web 产物生成 `[].concat(this.listeners)`，循环中尝试把 Set 当函数，异常又被捕获。给打包模块注册一个监听器并发送 HIDE、SHOW，实收 []。后台保存用例与去重用例同时失败。采用目标编译链可正确执行的遍历，并用真实打包产物回归。 |
| I02 IMPLEMENTATION_DEFECT | P1 / 是 | assets/subpackages/spike-pack.meta、build-configs/buildConfig_wechatgame.json、scripts/build-cocos.mjs。干净微信构建将 7 个文件（2,597 B）放在 assets/spike-pack，game.json 无分包项。按产物清单核验注册、入口与本地资源，补上微信侧加载证据。 |
| I03 IMPLEMENTATION_DEFECT | P1 / 是 | WeChatClockProvider.ts:45、130。标为不支持单调时钟的 provider 回退至 Date.now，守卫仍采纳差值。P1 用例让墙钟前跳 48h，cursor 从 10,000 变为 172,810,000 ms。缺失单调能力时应明确返回不可验证/冻结，并覆盖恢复。wx 计时单位的阈值启发式也需要平台实测依据。 |
| I04 IMPLEMENTATION_DEFECT | P1 / 是（适配器） | ExperimentalAdProvider.ts 的 show，尤其 :75。对同一 requestId 并发两次创建了两个 SDK 广告实例；load 拒绝后 close/error 各留一个回调。按请求实现单实例，并在所有终止分支清理。证据来自 SDK 替身，未观察真实广告投放或玩家资产变化。 |
| I05 IMPLEMENTATION_DEFECT | P2 / 否，纳入同轮复审 | PlatformVerificationSuite.ts:205、277 与 WeChatLifecycleProvider.ts:60。套件反复创建 provider，unsubscribe 仅删除本地 listener，未在 finally 中 dispose；部分失败路径跳过 unsubscribe。模拟三轮后平台仍持有 3 对监听器。清理验证用的外部订阅并覆盖异常路径。 |
| I06 IMPLEMENTATION_DEFECT | P1 / 是 | apps/game-client/tsconfig.json、SharedCoreBridge.ts:181–182、CodeFirstFactory.ts:118–119。默认完整客户端 tsc 退出 2；除引擎声明诊断外，客户端自身存在低目标下的 BigInt 字面量与 Label 枚举类型错误。修正前端所属配置和类型，给出完整客户端检查入口。 |
| V01 TEST_DEFECT | P1 / 是 | apps/game-client/package.json 的 test:frontend 匹配不存在的 *.test.mjs，退出 0、执行 0 项。直接运行 tests/frontend/fe-000/run-node-tests.mjs 才执行 5 项，且编译范围从单个 Node 测试入口展开，未包含全部 UI。公开命令应运行真实测试并能发现零用例。 |
| V02 TEST_DEFECT | P1 / 是 | 平台套件以手动 emit、测试函数直接 commit 和同进程重开仓库模拟后台/强退；构建脚本仅按 CLI 状态与目录非空报告成功，即使分包未注册。detectRuntimeEnv 只按 wx API 区分 WECHAT，不能自行区分 Mock、开发者工具或真机。将真实回调、进程重启与模拟证据分别记录；增加包清单、浏览器启动和运行结果断言。 |
| V03 TEST_DEFECT（交付证据） | P1 / 是 | 指定分支和五项开发交付均未找到，T13 仅有旧图、旧日志。补可定位快照、交接文档、测试证据及失败/未跑项，恢复 branch 与基准可追溯性；不要在混合开发树中切换他人分支。 |
| L01 TECHNICAL_LIMIT | P1 / 阻塞真实平台项 | 本机微信开发者工具已安装，CLI 服务端口关闭；构建 AppID 为 touristappid。缺少已验证的小游戏权限、真机和真实广告位证据。负责人安排可用环境后补测 T01/T04–T10 的相关真实平台项。 |

现有材料支持 Node/Mock 五项成功、Web 页面可用，同时也直接证明 Web 生命周期及微信分包失败。没有发现可据以认定伪造、删除历史失败测试的证据。当前缺少开发方验收声明，不能把公开命令的零用例成功解释成开发方主观造假。

**后续行动**　前端按 REWORK_PROMPT.md 整改并申请复审，BE-000 已知协议缺陷仍由后端处理。设计方待决事项单列于 DESIGN_ISSUES.md。
