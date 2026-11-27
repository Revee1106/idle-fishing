# 独立测试验证

2026-11-26，Windows / Node v24.20.0、npm 11.4.2、TypeScript 5.9.3、Cocos Creator 3.8.8、Chrome 158。本轮实际工作目录为 `C:/Users/WANGWENJIE10/AppData/Local/Temp/fe-int-audit-djllsqjf`。从索引跟踪路径与候选工作文件构造空目录快照，另复制开发方的交付日志。未复制 node_modules、核心 dist、Cocos build、temp 或 library。依据 FILES.sha256 按原始字节核验六个修改文件与报告、日志、证据，54 个唯一条目全部匹配，清单覆盖本次新增交付目录内除清单本身外的每个文件。原有历史报告作为前置材料。

| 实际命令（相对隔离根目录） | 退出码 | 独立结果 |
|---|---:|---|
| npm ci --offline --ignore-scripts --no-audit | 0 | 使用锁文件安装 |
| npm run verify | 0 | 类型检查、共享构建、严格 .mjs 消费者检查、82/82，无失败或跳过 |
| npm run test:perf | 0 | 连续、两种时间切片、节点预算切片、存档恢复五个布尔断言均 true，节点数 14935 |
| node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs | 0 | 独立执行交付的反例脚本，8/8 |
| npm --prefix apps/game-client run test:frontend | 0 | 10/10；仅 Node/Mock |
| npm --prefix apps/game-client run typecheck（首次） | 2 | TS2307，缺少 Cocos 生成的 cc 声明 |
| npm --prefix apps/game-client run build:web；随后同一完整 typecheck | 0、0 | 从无 Cocos 缓存目录生成，原检查配置通过 |
| node tests/frontend/fe-000/verify-web-build.mjs --out-dir=audit-web | 0 | Chrome 实际包 21/21，7 个共享用例全部通过。包含真实 DOM 可见性回调与 reload，事件由 CDP 测试驱动。 |
| npm --prefix apps/game-client run build:wechat；node tests/frontend/fe-000/verify-wechat-build.mjs | 0、0 | 微信包 10/10 静态检查。两目标均由构建脚本解释 Cocos 完成码并验证产物。 |
| node tests/frontend/fe-000/run-node-tests.mjs --files= 或 --files=missing.test.ts | 1、1 | 缺入口如期失败 |
| 同一 runner，隔离测试源替换为 export {} 或唯一 test.skip 后运行默认入口 | 0、0 | 零实际测试被误记为通过。两次负例后已恢复隔离测试源。 |

**开发证据核对。** 检查 phase7 的测试、构建、性能和平台日志，本机正向计数与开发方相符。两个 zero-test 日志仅含 BOM/换行，无命令、结果或退出码；开发报告不能单独证明当时执行。开发方的 Web JSON 引用四张本轮 PNG，均为有效 780×1688 图像，均受清单覆盖。历史 phase1 与当前 phase7 的证据目录独立。独立运行另存四张截图与结构化 JSON，动态画面字节有差异。开发方的 Web 构建清单记录 36 个文件的路径、大小和时间，本轮将整个交付包与干净重建逐文件比较，Web 36/36、微信 41/41 路径及 SHA-256 一致。由此验证交付产物可从候选复现；历史开发机器实际清缓存的操作无法仅靠截图确认。

**旧档与迁移。** 用 git archive 从 358b111 提取旧核心，使用旧源码、epoch.legacy358、固定起点与 24h 额度，按夹具各自 cursor 重建 IDLE、FIGHTING、PREPARING、POST_DEADLINE。四个状态对象和 rev1 Envelope 全文字节均匹配。第五组校验有效备份字节、注入损坏槽。对五组分别用新核心加载两次、全字段深比较、推进 60 秒、提交 rev2、重开读取并与完整推进状态深比较，全部通过。此证据验证可再现的旧版来源。旧 FIGHTING 原本没有 attemptLock；有锁的 v1 FIGHTING 单独验证迁移保留锁、随机状态和只发奖一次。PREPARING 已结算、截止前/恰好截止/截止后 settledUntil 与奖励、时间加法溢出、拒绝自定义 fixture 均有断言。

**向量。** 从目标夹具读取 startMs/allowanceMs，调用实际源码 createInitialState、advanceOffline、buildEnvelope；用 node:crypto 对规范字符串 UTF-8 字节取 SHA-256，内部摘要取 Envelope.sha256。状态摘要与后端夹具核对。真实 Web 的 T03-ADVANCE 对初始哈希有完整断言，Web 结构化输出包含其余六项完整值，与本轮 Node 结果一致。

| 输入 | SHA-256 |
|---|---|
| 初始状态 | 79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4 |
| 1h 状态 | 8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63 |
| 1h Envelope 内部字段 | 183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a |
| 1h Envelope 全文 | 4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6 |
| 8h 状态 | 91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9 |
| 24h Envelope 内部字段 | 9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d |
| 24h Envelope 全文 | 0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f |

**补充探针。** evidence 下保存了独立故障探针、结果及关键日志。audit-old.mjs 与 concurrent.mjs 在隔离根运行，旧源码位于 old/；audit-boot.mjs 放在 tests/frontend/fe-000/，沿用该目录现有验证器的 CDP 启动逻辑。探针输出观测值，退出 0 表示完成采集，业务断言的判断见 CODE_REVIEW。交付包与干净重建均复现 F1/F2。首两次指定交付包绝对路径时静态服务的 Windows 路径前缀比较失败，Boot 等待超时；修正审核脚本的路径归一化后复跑成功。无任何候选源码改动。

- 真实 Web 写入 rev1 后，注入有效校验和的 schema 99，重载得到 UNSUPPORTED、冻结，HIDE 的 hideCommitCount 为 0。全坏槽的 CORRUPT 与原字节保留由真实 Web 回归断言验证。
- 针对已恢复的 rev1，仅让读取槽 2 抛错。真实 HIDE 得到 UNCERTAIN；恢复可读后再 SHOW/HIDE，写调用总数 0，Boot 仍冻结。
- 既有有效槽、仅禁用启动探针写入时，新会话误记 EMPTY/COMMITTED。连续两次合法 HIDE 的第二次返回 CONFLICT。另以受控并发重现两个不同候选均返回 COMMITTED、rev1、slot0。
- IDE 登录、真机进程强杀、真实广告与设备性能均未执行；家庭独立复审原件缺失见 DESIGN_ISSUES。
