# 测试实证

隔离副本 E:\astra05-isolated-1795758360921。Windows、Node 24.20.0、Cocos Creator 3.8.8、本机 Chrome；按现有锁文件安装依赖。构建前排除编译缓存与旧产物。各进程的 stdout/stderr 合流保存在 evidence，退出码详见 runs.jsonl。

| 命令 | 退出码 | 日志 |
|---|---:|---|
| `npm ci` | 0 | ci.log |
| `npm run verify` | 0 | be.log |
| `npm run test:perf` | 0 | perf.log |
| `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 0 | a1.log |
| `npm run typecheck:cocos` | 0 | cocos.log |
| `npm --prefix apps/game-client run test:frontend` | 0 | fe.log |
| `npm --prefix apps/game-client run build:web` | 0 | buildweb.log |
| `npm --prefix apps/game-client run typecheck` | 0 | type.log |
| `npm --prefix apps/game-client run verify:web -- --out-dir=astra-web1` | 0 | web1.log |
| `npm --prefix apps/game-client run verify:web -- --out-dir=astra-web2` | 0 | web2.log |
| `npm --prefix apps/game-client run build:wechat` | 0 | buildwx.log |
| `npm --prefix apps/game-client run verify:wechat` | 0 | wx.log |

后端 verify 82/82，perf 五项结果一致，24 小时黄金 Envelope 全文 SHA-256 为 0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f；A1–A8 为 8/8。前端 Node 29/29，其中 7 个新增微信 Mock 均执行。详见 be、perf、a1、fe 日志。

astra-web1：34/34，console error 0，uncaught 0，截图 5。详情及每轮竞争见各自 r1-green-web-results.json。
astra-web2：34/34，console error 0，uncaught 0，截图 5。详情及每轮竞争见各自 r1-green-web-results.json。

web-mobile：独立生成 36 个文件，2143092 字节，与开发工作区同路径产物 36 个逐文件 SHA 一致。差异列表见 build-compare.json。
wechatgame：独立生成 41 个文件，2052429 字节，与开发工作区同路径产物 41 个逐文件 SHA 一致。差异列表见 build-compare.json。

两套官方 verify:web 各自启动新的 Chrome 用户目录；其竞争矩阵包含空盘和 12 轮非空竞争，以及持锁页关闭。另行移植的历史 race.mjs 运行 A 在 240 秒外部超时，记录到空盘与 rev8 种子后结束，未给该次尝试或未执行的额外 B 记通过。

自建 Node 探针命令 node astra-history.mjs（0）和 node astra-extra-final.mjs（0）。前者使用真实规则引擎与协调器产生版本，后者验证 v1 历史、显式首建、大整数下限、清标错误及陈旧确认。首次 extra 探针因日志器尝试解析故意损坏的 JSON 退出 1；原始日志保留，修正仅改变记录方式。

真实界面独立探针 node tests/frontend/fe-000/astra-ui.mjs 和 astra-ui-ordered.mjs 均退出 0，表示采集完成。后者等待恢复队列完成后再记录，配额异常持续、IDB 请求成功后事务 abort、等待锁时销毁确认等均在隔离 Profile 内注入。按钮使用 Cocos 场景坐标和 Chrome 指针点击，HIDE/SHOW 走实际 DOM 事件。故障端口、存档与按钮观测见脚本、JSON 与 CODE_REVIEW。

历史核对：上轮 Web 的 31 条命名断言全部保留，旧代码删除行为仅涉及默认输出路径。此前 Node 测试的损坏标记预期由 TX_STATE_UNREADABLE 改为 TX_STATE_CORRUPT，对应区分真实读错与可读的损坏内容；新增反向用例验证两者。上轮临时快照的前端测试 tsconfig 与 R4 清单不完全一致，未拿它代表正式候选，当前正式清单和独立构建以实际文件核验。

微信静态审计 10 项，不涵盖开发者工具运行、真机持久性、真实广告与硬件断电。
审核前后记录 1595 个原始文件，变化 0；HEAD/MERGE_HEAD、原始 Index 字节和 Git 状态的实际比对见 zero-drift.json。
