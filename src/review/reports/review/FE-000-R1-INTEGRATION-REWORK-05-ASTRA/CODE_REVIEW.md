# 代码审查

## R5-01 · P1 · IMPLEMENTATION_DEFECT · 阻塞

文件 apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts:273、774、789、863、889。部分 IO 分支由现存事务标记和当前可读备份合成历史。正常提交后标记已清除，此分支没有使用本域此前已证实的最高版本。后续版本下限判断代码确实存在，但其输入已经降低。

在同一实例连续提交 rev1、rev2，再显式成功加载 rev2。仅让 rev2 所在槽返回 IO 异常，其余槽照常读取。新标记为 FROZEN、expectedRevision=1、confirmedRevision=1。此时令故障槽返回不存在，再次 loadSafe 得 VALID/rev1，标记消失，旧状态可再次 COMMITTED/rev2。证据为 evidence/astra-history.mjs 与 history.log。实验使用实际候选协调器、正式核心生成的状态与 Envelope；故障只施加于隔离文件端口。槽位消失是注入的故障，静默接受回退、重新使用旧版号是候选的行为。

应保证同一存储域已经确认的最高物理版本参与冻结标记创建、更新和恢复判断。继续允许只读展示经校验的旧备份；在低于已知下限时应保持冻结。用 rev1 → rev2 → 最高槽读错 → 最高槽缺失的完整序列分别验证返回值、标记和零新增写入。已有标记预填较高 confirmedRevision 的用例不能代替这个序列。

## 已核对的代码路径

- SingleWriterSaveCoordinator.ts:403、843、863：旧标记缺历史字段时保守解释；只有已证明首次创建才走 EMPTY 清标；已有正确下限时以大整数比较版本，不使用浮点或字符串排序。原始 REV4-01 反例与新反例的区别是故障前是否已有带正确下限的事务标记。
- 同文件 :933 起：受控确认在域锁内重读标记、比较原始摘要、重新扫描每个槽、核对版本及完整快照；标记读取错误与内容损坏分别处理。确认清理目标为标记，存档槽不属于清理目标。
- BootEntry.ts:526、577、608、677 与 CodeFirstFactory.ts 的两个按钮：普通检查与确认丢弃损坏标记走不同操作，排队、重复点击去重，返回后再检查组件销毁状态。对底层已开始的操作与组件所有者的最终状态分别判断。
- BrowserFilePort.ts:587、614、624、628：游标回调对同步异常进行捕获并中止事务；写操作以事务完成作成功边界。WeChatFilePort.ts 的标记写入后即时读取原文比对，当前证据仅支持软件层读回校验。
- verify-web-build.mjs:2169 的 bringToFront 用于把指针送达目标页面；检查了程序随后实际执行的点击、visibilitychange、版本和磁盘断言。切换前台本身也会产生生命周期事件，所以双页裁决另用持锁屏障和最终槽位验证。

## R5-02 · P2 · IMPLEMENTATION_DEFECT · 阻塞本轮 REV4-04 关闭

BrowserFilePort.ts:417–422 的恢复能力探测写入很小的独立 probe 键。SingleWriterSaveCoordinator.ts:888 在槽可读后清标，BootEntry.ts:608 据返回值更新实例。使用开发方同类的 IndexedDB 故障注入，仅使正常槽位 put 持续抛 QuotaExceededError，保持元数据读写可用。用真实 UI 点击恢复并等待队列收敛。结果是 RECOVERED_VALID，halt=false，恢复面板隐藏，FROZEN 标记为空。故障仍然开启，接下来的正常 HIDE 返回 STORAGE_UNAVAILABLE 并重建 FROZEN；撤销故障并恢复后，HIDE 才成功到 rev2。没有假 COMMITTED，也没有观察到自动循环重试。

任务书第 9 节要求故障仍存在时不得解冻。恢复时应区分“成功读取备份”和“写入故障已解除”，在尚无足够证据时保留写保护。验收需覆盖故障持续和容量恢复两种真实按钮路径。本项实测针对槽位写入失败模型；没有模拟整个物理磁盘已满。证据 astra-ui-ordered.json，标签 quota 至 capacity restored。首轮 astra-ui.json 有恢复尚未完成的中间快照；复跑增加了等待，不以中间态判定。

## R5-03 · P2 · IMPLEMENTATION_DEFECT · 受控恢复需复验

BootEntry.ts:599–611，SingleWriterSaveCoordinator.ts:935、1078。另一个请求先持有本域 Web Lock，用户在有效预览上点击真实确认按钮。通过 navigator.locks.query 看到确认请求仍在排队，随后销毁真实 Cocos 组件。此时标记仍在；释放锁后标记消失，而组件记录 CANCELLED_DESTROYED，仍保持 halt。磁盘槽内容相同。确认操作已提交请求，但其底层受保护的重新读取和清标都是在所有者销毁之后才开始。与已经进入物理恢复后销毁、允许其完成的情况不同。

建议在取得锁后、读取或修改共享事务状态前再次检查该排队操作的所有者；对已开始操作则记录与实际副作用相符的结果。复验排队取消应保持标记原文与槽内容不变。在该实验中没有证据表明已销毁 UI 被重新激活。证据 astra-ui-ordered.mjs、astra-ui-ordered.json 最后三条。
