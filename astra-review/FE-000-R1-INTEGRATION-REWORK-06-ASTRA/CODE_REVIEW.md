# 定向代码复核

路径和行号均对应冻结提交，平台文件在 `apps/game-client/assets/scripts/platform/`。

## R5-01 · 原 P1 关闭

`SingleWriterSaveCoordinator.ts:745` 只向上更新已确认下限；读盘时合并历史下限与事务标记，部分 IO 的可读备份不能下调该值。普通恢复在约 1384 行比较下限，受控确认在 1702 行做同一比较。写入时先持久化 PENDING，再写槽并回读，再提交历史信息，最后清标；清标错误及历史确认错误均返回 UNCERTAIN。有三槽回读依据的已落盘 revision 与仅拟写的 targetRevision 被区别处理。测试验证了确定性写前错误不提升 target、历史写失败不返回 COMMITTED、损坏/不可读历史拒绝写入以及受控确认拒绝旧槽。微信历史写有立即回读，浏览器 IndexedDB 等待事务完成。

缺失元数据是兼容旧档时的“无历史记录”状态；可验证的有效槽可据此建立下限，读错或版本无效会冻结。能证明的最高下限来自仍可读取的独立历史记录或标记。没有把旧档首次升级解释成能够推断已经遗失的历史。域键/浏览器 namespace 区分诊断与正式存档。普通自定义端口的进程内回退不提供浏览器跨进程持久性；跨标签页和刷新结果来自 IndexedDB。

原独立脚本及两套真实浏览器均观察到 rev1 只读、复用 rev2 被拒。[历史回放](evidence/history.log) · [浏览器结果](evidence/webA/r1-green-web-results.json)

## R5-02 · P2 · 空盘恢复过早解冻

有效旧档走约 857–1038 行的恢复检查点，提交的是已验证的原状态，故只推进存档 revision。连续故障仍写入 requiresWriteVerification，原始故障消失才准许再次 HIDE。独立 UI 故障撤销前后有同一标记、槽、金币、时间与业务状态的记录。[真实按钮记录](evidence/current-ui.json)

**空盘反例。** 使用候选自身的 MemoryFilePort 容量限制、真实初始化和正常推进一小时产生的有效状态；宽裕端口实写槽为 2552 个 ASCII 字节。在恒定 2304 容量的空盘端口，首次提交 STORAGE_UNAVAILABLE 且有冻结标记；不释放任何空间，loadSafe 返回 EMPTY，标记已清，原样重试仍为 STORAGE_UNAVAILABLE。这个容量实验使用项目端口，不表述成浏览器磁盘实测。[观察](evidence/capacity.log) · [输入与判据](evidence/capacity.mjs)

原因在 `SingleWriterSaveCoordinator.ts:1045` 的约 2 KB 临时文件探针和随后 1466、1500 附近的清标逻辑。正常应用处理 EMPTY 时 `bootstrap/BootEntry.ts:260` 设置 AVAILABLE 并解除 persistenceHalted。原测试同时拒绝业务槽和临时探针，无法区分“空间仅够探针”的状态。影响是恢复记录和可写状态错误，下一次真实保存仍失败。本例未观察到覆盖已有档。**最小修复**：空盘小探针成功仅表示探针可写，保留待验证状态，待实际待保存内容获持久化确认再宣告恢复；增加恒定限额跨两次尝试的验收用例。

## R5-03 · P2 · 探针提交与取消记录不一致

STANDARD 在 `SingleWriterSaveCoordinator.ts:1087`、CONFIRM 在 1546 行检查取消；关键业务变更前分别在 1434、1747 行再次检查。锁内排队取消和合法已启动的事务收尾在真实 Chrome 验证通过，组件均保持停用。

两个入口在 1107、1567 行调用 probeStorage；`BrowserFilePort.ts:482` 先异步 openDb，再实际 put/read/delete。在两步间销毁真实 BootEntry，独立观察器等待 IndexedDB transaction complete。两条路径各观察到 **销毁后探针 put、delete 均已提交**，最终结果却为 CANCELLED_DESTROYED。STANDARD 业务冻结标记仍在，CONFIRM 的损坏标记仍在；没有观察到业务档覆盖或重新激活。该实验只延迟打开数据库的返回，不伪造写成功，也不改变项目中的任何断言。[STANDARD](evidence/probe-owner-standard.log) · [CONFIRM](evidence/probe-owner-confirm.log)

**最小修复**：把所有者取消检查接到取得数据库之后、创建第一个写事务之前；一旦写已经合法启动，对探针清理和业务写分别如实记录。复测两个入口在首写前取消应没有任何已提交探针事务，并保留已合法开始事务的收尾行为。

## 测试入口

与 R5 清单 SHA 匹配的 runner 比较，仅默认 worker 超时从 180 秒改为 300 秒，非零退出、强杀、缺少完成哨兵、零执行检测均保留。两套 Web 结果包含 R5 的全部 34 个命名断言并新增 3 项；恢复检查点多写一次是后续期望 revision 增一的依据。名称匹配本身不能证明旧断言逐字符一致，具体行为依据两轮结果和本轮状态记录。CDP 客户端的未应答调用均超时拒绝；主 E2E 收到 close 立即拒绝，独立 race 客户端最终由超时拒绝。缺少完整 JSON 或计数不符不能记通过。[runner 差异](evidence/runner.diff) · [负向观察](evidence/cdp-negative.json)
