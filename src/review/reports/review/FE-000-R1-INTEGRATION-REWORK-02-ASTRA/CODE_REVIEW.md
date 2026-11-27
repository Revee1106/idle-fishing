# 代码发现与整改要求

路径以集成工作区为根。BootEntry 位于 `apps/game-client/assets/scripts/bootstrap/`；SingleWriterSaveCoordinator、BrowserFilePort 和 PlatformVerificationSuite 位于同级 `platform/`；运行器、守卫和 Web 验证器位于 `tests/frontend/fe-000/`。下述证据引用本报告目录的 `evidence/`。

### A01 · P0 · IMPLEMENTATION_DEFECT · 阻塞

**同一版本可以确认两份不同的存档。** SingleWriterSaveCoordinator.ts:186 取得跨文档锁；BrowserFilePort.ts:116、130 通过 localStorage 读写；后端 packages/game-core/src/spike/save.ts:525、528 根据所见的最高版本判断冲突。首次存档跑两次项目 verify:web，两次都在 verify-web-build.mjs:871 的同一断言失败。A、B 各获 rev1、slot0、COMMITTED；A 候选金币 31，B 为 129，双方重载均读到 129。

独立时序见 race.jsonl 第七行。先让两端恢复 rev8，再让 A 持锁、B 排队，分别以不同游标保存。两端都确认 rev9、slot2。A 的金币 405、B 的金币 514，稳定后两端槽内都是 514。锁查询可见相同名称和不同 clientId。前六轮返回正常冲突。实证确认了已确认候选丢失；浏览器内部传播的精确时序尚未定位。此处使用隔离的 Spike 数据。

依据 TASK.md 第 21 行、设计 11 存档提交协议及接口 19 第 67 行。要求在支持的平台上，使版本检查和持久化提交对所有同源写者有一致的可见结果；保留原验收断言。复验须包括此前两种竞争、物理回读屏障和最终候选内容。若需要更换已定存储方案，先提交设计方审定。

### A02 · P1 · IMPLEMENTATION_DEFECT · 阻塞

SingleWriterSaveCoordinator.ts:331、337 对 FAILED 加故障冻结，对 UNCERTAIN 直接返回。BootEntry.ts:473 仅停止当前实例的 HIDE。storage.log 的回读故障在真实核心提交后返回 UNCERTAIN，两个协调器健康值都为 AVAILABLE。恢复文件端口的读取能力后，另一协调器未执行 loadSafe，直接以预期版本 2 提交成功到 3。Chrome 的 chrome-storage.json 另证当前实例后续 HIDE 确实 SKIPPED_HALTED，新实例恢复到已写入的版本。底层的提交前扫描仍在工作；它无法表达“先处置上一笔未知结果”这一所有者约束。

依据设计 11 第 69 行、接口 19 第 67 行、本轮 P1-01。将未知写结果挂起于共享存储域，明确完成恢复前拒绝所有新业务写入。用计数断言验证不同实例和直连入口的零写，保留对确定性未提交故障的处理。

### A03 · P1 · IMPLEMENTATION_DEFECT · 阻塞

SingleWriterSaveCoordinator.ts:242 看到 VALID 即重新标记 AVAILABLE。storage.log 中先产生 rev3 并触发冻结，再单独令保存 rev3 的槽读错；loadSafe 返回 VALID/rev2，warnings 明示 IO 错误，两个协调器同时解冻。当前核心在未知槽仍存在时返回 UNCERTAIN、零写；槽恢复后对旧版本提交返回 CONFLICT。没有在这个用例中观察到覆盖，但应用已把不完整的扫描当作恢复，可能展示或推进旧状态。依据同 A02。区分“可提供只读备份”和“确认最高物理版本并恢复写权限”；复验须检查警告、可写状态、版本及存储计数。

### A04 · P1 · IMPLEMENTATION_DEFECT · 阻塞

BootEntry.ts:141、539、602、610、619、646；SingleWriterSaveCoordinator.ts:347。正常 HIDE 受 destroyed/halt 保护。实际 Web 产物在全局对象上公开原协调器、直接提交和清槽能力。直接提交只检查协调器与内存状态存在，清槽操作使用启动时的生命周期存档域（BootEntry.ts:284），能够移除三个活动槽。读写锁可串行化这些动作，不能证明调用方仍拥有实例。本轮验证发布对象、销毁标记、存储域和方法分派；owner-lifetime.json 记录销毁后正常 HIDE=false，而诊断分派到达只计数的替身一次；清槽影响按源码核对，未删除用户数据。默认平台诊断页另用独立域，见 A09。

依据整改任务第 19 行的销毁语义，及接口 19 第 83 行的删除确认设计。将变更存档的测试能力限定到隔离构建或隔离存储；直接入口也需校验其所有者。复验生产候选应无法取得这些测试能力，诊断构建仍可通过原回归；销毁后任何新操作均不得触发存储写入。

### A05 · P2 · IMPLEMENTATION_DEFECT · 单独不阻塞，随存储整改复验

SingleWriterSaveCoordinator.ts:186、193。独立 Chrome 实验在已持锁的任务体抛出 audit body，得到 CROSS_TAB_LOCK_REJECTED 和冻结；对照真正的锁请求拒绝也返回同一分类。两次均无槽位变化。错误归类影响诊断和恢复，未观察到误写。依据 P2-04 的获取失败语义。区分获取阶段与进入回调后的异常，保留实际原因，并验证存储故障与锁故障各自的处置。证据 chrome-audit.jsonl。

### A06 · P2 · IMPLEMENTATION_DEFECT · 队列恢复需复验

BootEntry.ts:359、574、590。Chrome 中令排队推进的目标时间超出安全整数范围，得到 CanonicalJsonError；随后一个正常 HIDE 被接收，却返回同一旧异常，历史为空，磁盘无变化。显式恢复也先等待同一条拒绝的 Promise。触发源在本次为诊断输入，影响已扩展到正常 HIDE。依据 P1-02 任务所有权及设计 11 的失败后恢复要求。分开单笔任务的错误返回与后续队列衔接，明确是否需要冻结，不得吞掉未知提交结果。证据 chrome-audit.jsonl 的 chainReject。

### A07 · P2 · TEST_DEFECT · 运行器整改项

run-node-tests.mjs:128 的同步 worker 等待未设置期限。独立运行持有活动计时器的未完成用例，2.5 秒后由审核监督进程终止，未产生完成哨兵，worker 自身无正常退出码。node-test-worker.mjs:116、133 将实际抛错的 TODO 叶计为 fail。同一夹具在 Node 24.20.0 原生为 pass=1、todo=1、fail=0、退出 0；候选 worker 为 pass=1、todo=0、fail=1、退出 1。影响持续集成可用性与计数可信度，未见存档风险。依据本轮 P1-03 的叶计数及超时验证。设置可验证的 worker 上限，按 Node 事件属性统计 TODO，保留全 TODO 零执行保护。证据 runner.log、runner-audit/todo-throws.json 及 probe-todo-throws.mjs.log。

### A08 · P2 · IMPLEMENTATION_DEFECT · 输出删除授权项需整改

safe-path-guard.mjs:51、64、203。临时副本中对普通白名单输出目录模拟真实路径查询 EACCES，仅调用验证器，得到 ok=true；守卫回退到未经验证的路径。用户要求删除授权建立在可验证的真实路径上。实际 Junction 可被拒绝，本例未执行删除，也未观察到越界删除。元数据无法确认时应拒绝并返回原因；用允许目录、权限故障、真实链接与未创建目录分别复验。证据 guard-metadata.log、probe-guard.mjs.log。

### A09 · P3 · SUGGESTION · 不阻塞

PlatformVerificationSuite.ts:29、35、69、88。默认诊断页直接清理并操作其独立的 idle_fishing_spike 域；BootEntry.ts:284 使用 idle_fishing_lifecycle_persist。默认入口不能据此认定会清理游戏生命周期档案。多标签并跑诊断可能互相干扰，建议给每轮验证分配独立临时域或隔离运行。依据平台诊断职责；对活动域的公开能力另见 A04。证据 references.txt、真实产物的 platformChecks。

### A10 · P3 · 报告口径 · 不阻塞

实施报告第 9 行将该列命名为“修改 / 新增文件”。按该表头复核第 11–15 行，实际包含沿用文件。相对上一轮的原始字节，BrowserFilePort.ts、FaultInjectingFilePort.ts、前端 tsconfig.json 等没有本轮增量；详见 coverage.json 的 listedUnchangedSincePrior。风险是后续维护者误读本轮变更边界。按项目所有权和任务交付要求，建议在报告区分修改、新增与沿用依赖。未发现后端 58 个路径字节归属异常。实施报告第 13 行的 18 组专指 P1-03；测试报告第 22、45、46 行把 P2-05 另加一组，共 19。逐日志计数吻合，REV2-09 不成立为测试数量错误。
