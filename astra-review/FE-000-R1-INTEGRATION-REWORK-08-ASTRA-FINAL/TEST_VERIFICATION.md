# 独立测试与产物

从 `E:/idle-fishing-verify-rework08` 建立新的 `E:/idle-fishing-astra-r8-test`，detached HEAD 指向 `ff6941f013fefd385c904920d69c1b12d43742c6`。在此目录执行根锁文件安装 `npm ci --no-audit --no-fund`。由 verify 生成核心声明，由全新 Cocos 构建生成客户端声明。环境实测 Node 24.20.0、npm 11.4.2、TypeScript 5.9.3、Chrome 158.0.8127.37、Cocos Creator 3.8.8。[环境](evidence/environment.json)

| 本轮要求 | 实际观测 |
|---|---|
| 上一轮原始 UI 反例 ×2 | 原脚本以原始字节复制，SHA-256 为 `f1576561455d834f63d614f5ffa072e04582625f259d409d5b4861b366fdea26`。每次启动独立新 Profile。捕获实际待存 31 金币和游标 1700000060000。刷新并点击真实按钮后，应用仍冻结、revision 为空、三槽为空、历史为空，标记与刷新前相同，结果 FAILED。两次均为 INITIAL_COMMIT_STATE_UNAVAILABLE。[A](evidence/originalA.log) · [B](evidence/originalB.log) |
| 同页恢复 | 容量恢复后点击正常按钮，revision 1 的正式槽位 payload 与失败时实际送写内容完整相等，历史确认为 1，标记清除。随后 HIDE 写成 revision 2，回读 84 金币、游标 1700000120000。[结果](evidence/same-page.log) |
| 重复刷新与点击、提示 | 两次重建页面，每次点击两次。四次均保持冻结，实际活动的 RecoveryBody 标签说明原待存进度无法验证、写入继续冻结。每次读取三槽、历史和标记均符合预期。[结果](evidence/repeat-ui.log) |
| 正常首次建档 | 干净 Profile 从 EMPTY 启动，连续两次正常 HIDE 提交并回读 revision 1、2，历史分别确认为 1、2。[结果](evidence/normal-ui.log) |
| 有档恢复 | revision 1 的实际槽位持续写失败时保持冻结，恢复后检查点为 revision 2，保留 31 金币与原游标，后续 HIDE 成功到 revision 3。[浏览器记录](evidence/webA/r1-green-web-results.json) |
| 后端、性能及类型 | verify 82/82；perf 5/5，黄金 Envelope SHA-256 为 `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f`；A1～A8 为 8/8；typecheck:cocos 和前端 typecheck 均退出 0。[后端](evidence/verify.log) · [性能](evidence/perf.log) · [专项](evidence/a1-a8.log) |
| Node/Mock | 36/36，原 35 项全部保留，fail、skip、todo、containerFail、procErr 均为 0。[结果](evidence/node.log) |
| A01 双标签页竞争 | 两套独立 Profile，各含空盘及 12 轮非空竞争，0 次双 COMMITTED；持锁页关闭后幸存页可提交并重载 revision 21。[A](evidence/raceA.log) · [B](evidence/raceB.log) |
| Web 与微信全新构建 | Web 36 文件、2155240 字节；微信 41 文件、2084105 字节。每个文件的路径、字节数、SHA-256 与开发方清单一致。微信静态审计 10/10。[逐文件核对](evidence/compare.log) · [微信审计](evidence/wx.json) |

完整 Chrome E2E 的逐断言结果见 [Profile A](evidence/webA/r1-green-web-results.json) 与 [Profile B](evidence/webB/r1-green-web-results.json)。独立跨刷新反例另行运行；相邻场景脚本复用历史脚本的真实按钮、HIDE 和正式槽位读回方法。竞争脚本执行副本仅适配根目录，由隔离副本提供构建，并向本次证据区保存结果。[执行副本生成记录](evidence/prepare.py)
