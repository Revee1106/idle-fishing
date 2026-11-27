# 独立测试记录

2026-11-26，公司电脑 Windows、Node.js 24.20.0、npm 11.4.2、Cocos Creator 3.8.8、Headless Chrome 158。输入是集成工作树的实际候选文件。审核副本位于 `%LOCALAPPDATA%\Temp\astra02-sr6tbrsx`。首次构建前没有复制 node_modules、dist、Cocos 缓存或构建目录。证据中的短用户名是同一 Windows 临时目录的短路径。浏览器测试使用本机环回 origin、独立配置及人工生成的 Spike 存档。

## 原项目命令

下表中前端简写 `client` 代表 `npm --prefix apps/game-client run`。日志在 `evidence/`；进程 stdout/stderr 合并保留，`exit.log` 为独立调度记录。构建在隔离副本，类型检查安排在 Cocos 生成声明后。未将此结果外推为未经初始化的编辑器工程也可直接通过类型检查。

| 命令 | 退出码 | 实际结果 | 日志 |
|---|---:|---|---|
| npm ci（按现有锁文件） | 0 | 安装依赖 | ci.log |
| npm run verify | 0 | 82/82，含后端类型检查与 Cocos 共享模块构建/消费 | verify.log |
| npm run test:perf | 0 | 5/5 一致性检查 | perf.log |
| node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs | 0 | A1–A8，8/8 | a1.log |
| client test:frontend | 0 | 15 个实际叶测试通过，skip/todo/fail 均 0 | frontend.log |
| client build:web | 0 | Cocos 原始状态 36，项目脚本完成产物检查 | bw.log |
| client typecheck | 0 | 前端完整 tsc 检查 | ts.log |
| client verify:web | **1** | **27/28；双标签页同版本双成功** | web.log、web-first/ |
| client verify:web -- --out-dir=web-repeat | **1** | 新 Chrome 配置重跑同一包，仍为 27/28，同一断言失败 | web-repeat.log、web-repeat/ |
| client build:wechat | 0 | Cocos 原始状态 36，产物检查完成 | bwx.log |
| client verify:wechat | 0 | 10/10 静态断言 | wx.log |

实际构建文件逐一与集成区现有产物比较，Web 36/36、微信 41/41 字节相同，详见 products.json。两个 Web 运行目录各有本轮生成的结构化 JSON 及四张截图；核心判据取 JSON 的两方提交、重载和磁盘结果。截图可确认产物确实渲染，无法证明事务正确性。构建脚本的原始状态、警告和产物验证均保存在完整日志中。

## Astra 自建探针

探针源码和输出单独归档。browser 探针复用项目已有 CDP 启动及本地静态服务器，另行编写了输入序列、屏障和观察项。观测脚本自身退出 0 表示采集完成，业务是否符合要求以表内的实际状态判断。

| 临时副本命令 | 退出码 | 关键观察 |
|---|---:|---|
| node storage.mjs | 0 | probe 连败及明确写失败共享冻结；未知写后另一个协调器在没有显式恢复时新增一个物理写入。部分恢复复扫读出较旧 rev2 |
| node wx-methods.mjs | 0 | 分别只缺 readFileSync、writeFileSync 时均报告 STORAGE_UNAVAILABLE。健康接口的 ENOENT 得 null，EIO 得 READ_IO_ERROR；无 manager 另见 storage.log |
| node tests/frontend/fe-000/astra-race.mjs | 0 | 两个真实标签页，7 次竞争；6 次 B=CONFLICT，1 次 A/B 均 COMMITTED/9。同一锁有不同持有及等待 clientId，双方最终仅见金币 514 |
| node tests/frontend/fe-000/astra-browser.mjs | 0 | 物理写之后、回读之前设屏障；观测到 A 持锁、B 等待。涵盖排队销毁、持锁关闭、拒锁、缺锁、异常分类、队列拒绝和故障状态观测 |
| node tests/frontend/fe-000/astra-chrome-storage.mjs | 0 | 回读及复扫持续报错后返回 UNCERTAIN；正常实例的下一 HIDE 被停止，新页面能恢复已物理写入的版本。在故障回读中销毁仍记录真实结果。额外注入的无类型 Error 写失败返回 FAILED，该对照没有模拟 typed WRITE_IO_ERROR |
| node tests/frontend/fe-000/astra-owner.mjs | 0 | 用只计数、零 I/O 的提交替身检验销毁后的分派。正常 HIDE 返回 false，诊断提交仍到达协调器 1 次，清理入口仍为 function，存储字节未改动 |
| python -X utf8 runner-audit.py | 0 | 调度项目 17 个已编译边界夹具和 5 个自建用例，另跑多文件父入口。每个独立进程状态、哨兵或外部超时详见 runner.log、runner-audit/ |
| node --test runner-audit/todo-throws.mjs | 0 | 原生 pass=1、todo=1、fail=0；候选 worker 退出 1，统计 pass=1、todo=0、fail=1 |
| node guard.mjs | 0 | 临时 NTFS 目录内仅验证路径授权。普通和嵌套 junction 均被拒绝；独立目录符号链接创建返回 EPERM |
| node guard-metadata.mjs | 0 | 为普通目录注入真实路径查询 EACCES 后，验证器返回 ok=true，未调用删除 |

## 组合故障实际观测

| # | 组合及观测点 | 结果及原始记录 |
|---|---|---|
| 1 | 先收到 HIDE，实际已写入，故障回读时销毁 | 旧实例返回 UNCERTAIN，后续 HIDE 被拒绝，新实例读到 rev5。chrome-storage.json / destroyAtFailedReadback |
| 2 | 未完整恢复后旧实例重新提交 | 另一槽不可读时选择旧 rev2，提交 UNCERTAIN、零写；恢复可读后读取 rev3，旧版本提交 CONFLICT。storage.log |
| 3 | A 实际持锁、B 提交等待，关闭 A 文档 | 浏览器释放锁；B 提交及刷新均 rev4。chrome-audit.jsonl / close lock owner。关闭 CDP target 已执行，操作系统崩溃未模拟 |
| 4 | 获取 Web Lock 被拒绝或 API 缺失，并检查冻结及磁盘 | 两次都 STORAGE_UNAVAILABLE，两组各自前后槽内容一致。chrome-audit.jsonl / reject、missing |
| 5 | 嵌套多叶成功文件与模块提前 exit(0) 同批次 | 前一个文件两个叶通过，后一个没有哨兵；父入口 procErr=1、退出 1。runner-audit/combined.log、runner.log |
| 6 | 非白名单子路径位于临时 Junction/嵌套 Junction 下 | 验证器拒绝，未调用递归删除。probe-guard.mjs.log |
| 7 | 物理写成功、回读与复扫失败，新实例恢复 | 旧实例持 rev2 并 halt，重新载入看到 rev3。chrome-storage.json / readback |
| 8 | 两个页面的两个协调器连续 HIDE | A 回读屏障期间 B 等锁；A 提交 rev3，B 的连续两个旧版本均冲突。另见 race.jsonl 的双成功反例 |
| 9 | 锁等待中连续入队、销毁并重启 | 两次 SKIPPED_DESTROYED，磁盘各槽前后一致，重启恢复 rev4。chrome-audit.jsonl / queued destroy then restart |
| 10 | 实例遇到存储探测异常，再从诊断入口观察 | HIDE 与诊断 loadSafe 均 STORAGE_UNAVAILABLE，销毁后正常入队被拒绝，磁盘不变。另有跨实例未知提交反例，见 storage.log |

## 边界与复核

- 工作区对照和开发方证据属于输入。独立运行、首次红灯、重复红灯及自写探针分别留档。证据完整性按清单逐行计算相对路径对应的原始文件 SHA-256；清单不含自身。
- 正常退出、业务失败、无测试、全跳过或 TODO、早退、模块异常、未捕获异常、信号、异常子测试、深层和多文件套件分别以事件、退出码与哨兵共同判定。被外部 watchdog 终止的挂起 worker 没有自行退出，不能登记为通过。运行器日志里的预期负例退出非零属于测试输入。
- 已实际验证 Windows Junction；创建独立目录符号链接受 EPERM 限制，标为 NOT_RUN。微信 IDE 内运行、真机存储/生命周期、多上下文并发、真实广告均 NOT_RUN。需要相应账号、可运行的微信环境、设备和实际广告资源。

独立挂起复测在测试体写出“已进入”标记后再等 3 秒，worker 仍存活。审核监督进程主动终止，操作系统返回 1，无完成哨兵。见 runner-audit/confirmed-hang-result.json。

环境与版本见 environment.json。未暂存 git diff --check 退出 0；暂存 git diff --cached --check 退出 2，告警位于已逐 blob 匹配后端目标的路径（包括保留的历史补丁），完整明细见 git-diff-cached-check.log。此项未记为前端修改或前端测试失败。
