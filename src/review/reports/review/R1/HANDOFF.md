# BE-000 / FE-000 整改前复核与工作区交接

两项维持 **REWORK**。当前 Git 快照保留首审时的实现。后端 63 项及前端 94 项历史清单逐文件 SHA-256 全部相符。本次收到设计反馈，尚无整改后候选版本。首审四份报告分别位于相邻 BE-000、FE-000 目录。

| 工作区 | 分支 | 提交 | 相对父提交的范围 |
|---|---|---|---|
| E:/idle-fishing | feature/be-000 | 2106ce19d991ec47555cdbf207454c36d8cd104a | 保留原混合工作区 |
| E:/idle-fishing-backend | r1/be-000 | 358b11105cfdee9bd076049c86a34d8f0aaa00e7 | 37 个后端或已授权根工具链文件 |
| E:/idle-fishing-frontend | feature/fe-000 | 43f666ba3ca2f0b004602c259e0ffb5c0dc81f97 | 74 个前端文件；父提交固定后端依赖 |
| E:/idle-fishing-review | review/000-r1 | 21711697994365b0dc97cf7fd7cce544b663cbef | 14 个原审核规范、报告及证据文件 |

文件按任务所有权归类。每个快照均核对父子差异清单及工作文件字节。首审忽略的后端 9 份日志、前端 1 份日志在对应本地工作区和备份中。整改任务书位于各开发工作区 reports 下的任务目录，此目录另有相同副本。

## 可恢复材料

备份目录 E:\idle-fishing-backups\20261125-141845-5613fb。workspace.zip 保存 1166 个普通文件（含忽略的缓存、构建产物与日志），已逐项回读校验；links.json 另存 1 个链接目标，未跟随链接。manifest.json 保存内容摘要，ownership.json 保存逐文件归属，status.bin 和 index 保存原 Git 状态及索引，refs.bundle 已通过 git bundle verify。恢复时在新目录中核对归档及链接，保留原目录。

## 隔离复测

Windows / Node v24.20.0 / npm 11.4.2，审核树自锁文件离线安装，npm ci 退出 0。以下为整改前实测。备份目录 0-test.log 至 5-test.log 按执行顺序保留输出，tests.json 记录命令和退出码。

| 命令或入口 | 退出码 | 结果 |
|---|---:|---|
| npm run verify | 0 | 后端类型检查、共享构建通过；原套件 64/64 |
| node tests/frontend/fe-000/run-node-tests.mjs | 0 | 5/5，Node/Mock |
| npm --prefix apps/game-client run test:frontend | 0 | 0 项，验收失败 |
| 首审 BE TEST_VERIFICATION 最后一个 JS 代码块经 node --input-type=module - 执行 | 1 | 8 项中 7 失败、1 通过 |
| 首审 FE 对应代码块以相同方式执行 | 1 | 4 项失败；历史 P2 只调用局部退订，不能单凭此例归责 Provider |
| 实际 runLifecycleClockAndAdSuite 资源所有者探针 | 1 | 3 项中 1 通过、2 失败。局部退订后其余订阅可用，显式 dispose 可解绑。套件正常退出及订阅后注入 emit 异常时，wx 替身各残留一对 show/hide 监听器。源码中的文件套件同样未调用 dispose，异常路径另待整改回归。 |

所有者探针使用 tsc 将 PlatformVerificationSuite.ts 及其依赖按 ES2022/ESNext/Bundler 编译到忽略的 tests/frontend/fe-000/.compiled/owner，给生成的相对导入补 .js。备份中的 owner-probe.mjs 以审核根目录为工作目录通过 node --input-type=module - 执行，输出见 owner.log。此轮未重跑 Web 或微信构建，已有产物首审结果见原报告。本轮没有新增微信开发者工具、真机存档、强退、真实广告或性能实测证据。

## 设计方待批准事项

BE-D01 仅作 Spike。对象键递归按 UTF-16 code unit 排序，数组保序，使用 ECMAScript JSON.stringify 字符串转义，不添加空白，不做额外 Unicode 规范化。payload 为规范 JSON 字符串；外层数组 [magic,format,revision,epoch,payload] 序列化后取无 BOM 的 UTF-8 字节，SHA-256 输出 64 位小写十六进制。

两组向量共用 IDLE_FISHING、整数 1、字符串 7、字符串 epoch.audit。本轮用 Python 标准库对这两组固定输入独立复算。G02 按名称含一对双引号、路径含两个反斜杠、note 含实际换行和制表符解释。两组仅验证编码与哈希。

| 向量 | 外层字节 | SHA-256 |
|---|---:|---|
| G01 | 55 | 7322a23453d23eca40a924d1b24105c95a157f3931430cc4c56ac82862c40a27 |
| G02 | 150 | 431dafc1a07776a1bb9d80357a62323176faabc7c38385da0e13a80daf8b5354 |

BE-D02 与 FE-D01 合并跟踪。实验目标为单片 8 ms、警戒 16 ms、标准 24 小时负载 3 s 以内、5 倍事件压力负载 10 s 以内；能测时记录额外 JS 堆内存，目标 32 MB 以内。连续、分片、中断恢复结果须完全一致。整改后分别收集 Node、Web、微信真机数据，等待负责人批准正式预算。

## 复审顺序

后端交回共享模块整改提交及证据后先复审。前端固定通过复审的共享模块版本，重跑测试并补真实平台验证，再进行前端复审与 GATE-01 联合审核。技术基线须经负责人批准冻结。BE-001、FE-001 继续暂停。
