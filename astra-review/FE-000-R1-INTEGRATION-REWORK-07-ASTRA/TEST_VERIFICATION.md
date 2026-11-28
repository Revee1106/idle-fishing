# 独立测试记录

从冻结检出克隆至 `E:/idle-fishing-astra-r7-test`，以 detached HEAD 运行。独立副本使用原始行尾，355 个跟踪文件对照 Git 对象逐字节核验。锁文件安装入口为根目录 `npm ci --no-audit --no-fund`；后端 verify 生成核心声明和 Cocos 消费产物。未补入历史夹具。本机实测 Node 24.20.0、npm 11.4.2、TypeScript 5.9.3、Chrome 158.0.8127.37、Cocos Creator 3.8.8、Python 3.12.6。[环境](evidence/environment.json)

| 入口或专项 | 实际结果 |
|---|---|
| 根目录 npm run verify | 82/82，fail、skip、todo 均为 0。[日志](evidence/verify.log) |
| npm run test:perf | 5/5，黄金包络 SHA-256 为 `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f`。[日志](evidence/perf.log) |
| node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs | A1～A8 全部通过。[日志](evidence/a1-a8.log) |
| typecheck:cocos、客户端 typecheck | 均退出 0。客户端提前运行时缺 Cocos 生成的 cc 声明，完成全新 Web 构建后用相同命令复跑通过。[首次](evidence/frontend-types.log) · [复跑](evidence/frontend-types-generated.log) |
| 客户端 test:frontend | 35/35，fail、skip、todo、containerFail、procErr 均为 0。[日志](evidence/node.log) |
| Cocos build:web、build:wechat | Web 36 文件、2154982 字节；微信 41 文件、2083847 字节。逐文件 SHA-256 全部匹配开发清单，路径集合也相同。[逐文件记录](evidence/build-compare.log) |
| Web E2E 两个独立临时 Chrome Profile | 39/39 × 2，consoleErrors、uncaughtExceptions 均空。所有原 37 项断言保留。[A](evidence/webA/r1-green-web-results.json) · [B](evidence/webB/r1-green-web-results.json) |
| A01 独立竞争 | A、B 各通过空盘、12 轮非空竞争与持锁标签页异常关闭恢复。每套 0 次双 COMMITTED，恢复后 revision 21。[A](evidence/raceA.log) · [B](evidence/raceB.log) |
| 全新微信构建的静态审计 | 10/10。[结果](evidence/wx.json) |

## 独立边界检查

- **R5-02 容量**　上一轮原始反例和本轮带合法待存状态的版本分别执行。恒定 2304 字节配额下，2552 字节真实存档写入失败，无状态及带原状态恢复均保持冻结和标记。[历史脚本输出](evidence/historical-capacity.log) · [带状态输出](evidence/capacity.log)
- **R5-02 真实 UI 对照**　同页降低正式槽位可写容量，首次 HIDE 与恢复均失败；解除后正常按钮提交原 31 金币、游标 1700000060000，后续正常 HIDE 提交 revision 2，重载一致。两套全量 E2E 均含该对照。独立用例仅改变用户动作顺序，首次失败后先刷新，再点击按钮，读取实际 IndexedDB 数据。两个独立 Profile 的待存状态均为 31 金币，落盘均为 0，RC 均为 1。[独立用例](evidence/refresh-ui.mjs) · [首次](evidence/refresh-ui.log) · [重复](evidence/refresh-repeat.log)
- **R5-02 事务故障**　独立内存端口以原生 2304 字节限额触发首次失败，解除后分别中断正式回读、历史确认和清标。结果分别为 WRITE_CAPABILITY_UNAVAILABLE、HISTORY_STATE_WRITE_FAILED 和 TX_STATE_CLEAR_FAILED，均保持冻结并保留标记。无故障对照确认载荷相同。首次编写测试时使用错误的错误类导出，未形成预设配额前提，原始无效运行保留于 transaction.log；采用原生端口配额的有效结果见 [transaction-corrected.log](evidence/transaction-corrected.log)。
- **R5-03 原 Chrome 反例**　真实按钮触发后暂停探针 openDb、销毁组件、释放暂停点。STANDARD、CONFIRM 均记录 CANCELLED_DESTROYED、0 次探针 put/delete、磁盘三类证据一致、组件保持销毁。另测已开始 put 后销毁，结果为 COMPLETED_AFTER_DESTROY，完成 delete，探针无残留。探针读回异常也执行 delete 并报告 FAILED。[STANDARD](evidence/probe-standard.log) · [CONFIRM](evidence/probe-confirm.log) · [已启动与异常路径](evidence/webA/r1-green-web-results.json)

微信验证范围为 Mock 与静态构建。微信开发者工具实际运行、真机、真实广告及真机性能留待 GATE-01。
