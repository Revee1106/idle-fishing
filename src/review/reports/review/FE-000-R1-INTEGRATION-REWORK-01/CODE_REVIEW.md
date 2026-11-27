# 源码问题与处置

文件均相对候选根目录。Boot 指 apps/game-client/assets/scripts/bootstrap/BootEntry.ts；platform 下文件位于 apps/game-client/assets/scripts/platform/；runner 指 tests/frontend/fe-000/run-node-tests.mjs。下面的复现均可追溯到 evidence/ 中的脚本和输出。

| 问题 | 定位与复现 | 实际行为、风险 | 整改及门禁 |
|---|---|---|---|
| N1 实现，P1 | platform/SingleWriterSaveCoordinator.ts 的 commit 探针失败分支（第 123 行附近），Boot:390。正常启动并保存 rev1，再只让 __probe__ 写入失败，两次 HIDE 排队，随后恢复能力。见 late.json。 | 两次记录 FAILED，槽字节保留，但 persistenceHalted=false。能力恢复后下次 HIDE 直接写 rev2，未重新加载确认原存档。业务侧无法区分普通确定失败和持久端口失效。 | 阻塞。结构化传递不可用状态，在 Boot 冻结后续任务，显式恢复时重新读取持久状态。保留普通确定失败后仍可保存的路径。 |
| N2 实现，P1 | platform/PlatformTypes.ts:73、PlatformVerificationSuite.ts:32、WeChatFilePort.ts:66、Boot:231。Node 模拟存在 wx 和平台信息、无 DOM、文件系统入口缺失；另让存在的 getFileSystemManager 抛异常。见 ports.log。 | 第一组退入 MEMORY，loadSafe 返回 EMPTY，commit 返回 COMMITTED。第二组在端口构造时抛错，未到 loadSafe，Boot 的异步初始化缺少可用性处理。已存在的微信端口在读取权限错误时可正确返回不可用。上述能力缺失为故障注入，真机发生率未知。 | 阻塞。分开识别宿主与判断存储能力，在初始化边界接住获取文件系统的错误，给出可恢复的冻结记录；内存存储只由明确的实验调用者选择。 |
| N3 实现，P1 | Boot:101、311、342；platform/SingleWriterSaveCoordinator.ts:46。真实 Web 中用同命名空间的 runExclusive 暂占队列，发 HIDE/SHOW/HIDE，让第一项进入协调器等待，调用组件实际 onDestroy，再释放屏障。见 boot-extra.json 的 destroy。 | 一个尚未物理写入的旧任务在销毁后返回 COMMITTED（rev8→9），槽字节改变；第二项记录 SKIPPED_DESTROYED。后续事件不再添加记录，监听解绑有效。两个队列之间缺少执行时的所有者有效性判断。 | 阻塞。给待执行保存携带可取消的所有者标识，在获得独占权后、首次写入前核对。对已开始物理写入的任务安排收尾与新实例接管顺序，分别验证完成、取消、重新加载及历史记录。 |
| N4 测试，P1 | runner:121、135。将独立 fixtures 目录中的 audit-only-parent、audit-okgroup 和 audit-nested 输入同一 runner。见 parent.log、runner.json。 | 父测试仅含 skip/todo 子项时返回 0、pass=1；全通过的 describe 中两个叶用例反而被计为 0、退出 1。跨文件实际 pass=2、fail=2、skip=1、todo=1，包装器给出 1/1/0/0。nesting 过滤遗漏叶子且能计入普通父项。 | 阻塞。按事件树或具备准确叶计数的输出统计，剔除容器与文件包装，在所有深度分别处理 skip、todo、真实失败。 |
| N5 测试，P1 | runner:118 使用无隔离运行。加载仅触发正常进程退出的独立夹具 audit-exit.test.ts。 | 测试模块结束整个 runner，退出 0，没有任何用例和最终计数；加载时抛异常则正确退出 1。见 runner.json 的 exit0、crash。 | 阻塞。由独立父进程监督测试结束，要求正常完成记录和有效叶用例计数，保留异常退出。 |
| N6 工程，P1 | runner:44–49。静态检查发现用户指定的 out-dir 经路径解析后直接递归删除，在这两步间没有目录归属或允许范围验证。 | 误填已有目录可导致开发文件丢失。审核仅使用隔离副本中的专用输出目录；未对现有工作文件尝试删除。 | 阻塞。使用 runner 自建临时目录或受约束的构建目录，为不属于本次运行的目标加入拒绝路径。用无价值的临时标记文件验证保护。 |

**其余调用链。** BrowserFilePort 现在每次通过探针确认实际持久存储，读、写、删除能区分 IO 异常；真正 EMPTY 和解析损坏仍区分。WeChatFilePort 的 key 来自实际根目录，BrowserFilePort 使用浏览器命名空间。FaultInjectingFilePort 转发底层 key 与 probe，写屏障可在真实存储操作前暂停，不伪造协调器的提交结果。匿名端口用对象身份作为兜底，不具备跨包装器的命名空间保证。正式 Boot 和 PlatformVerificationSuite 的仓库构造均收敛到协调器，裸仓库仅用于底层实现和针对它的测试。

仍保留首轮 SharedCoreBridge 与 OverviewPage 的集成修改。原 10 个 Node 测试、21 个 Web 检查名称全部保留；新增 3+3 项。实际运行和独立反例见测试报告。
