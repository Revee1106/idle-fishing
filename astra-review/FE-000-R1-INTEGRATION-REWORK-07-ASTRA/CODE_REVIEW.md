# REWORK-07 定向代码审查

冻结提交 `8458cb34362cf3a207eed963355cdfcd6ba36ea7`，对照父提交 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc`。8 个改动文件中，6 个属于应用和存储实现，另 2 个是测试。实际路径清单见 [before.log](evidence/before.log)。

## P2 · 首次保存失败后刷新，恢复按钮提交了不同的玩家状态

`apps/game-client/assets/scripts/bootstrap/BootEntry.ts` 的 HIDE 路径在第 816 行附近调用 `advanceOffline`，本次送写的有效载荷已经含有收益。首次保存返回故障时，第 876、909 行附近把 `nextState` 留在当前组件的 `pendingInitialCommitState`。页面刷新后这个内存值消失。第 661 行向协调器传入 `this.pendingInitialCommitState ?? this.createDefaultInitialState()`，第 224 行构造的默认状态从 0 金币和初始时刻开始。

`SingleWriterSaveCoordinator.ts` 第 1629–1646 行校验传入状态的结构。空盘首次建档标记可证明此前没有确认存档，却无法证明新构造的状态等于曾经送写的内容。默认状态本身合法，因而通过三槽协议，真实写成 revision 1、确认历史并清标。问题发生在选择提交内容时，写入和回读对错误内容同样会成功。

| 真实 Chrome 正常 UI | 待保存或实际落盘的金币 | 游戏游标 |
|---|---:|---:|
| 首次 HIDE 因配额失败，捕获正式槽位 put 的原始载荷 | 31 | 1700000060000 |
| 刷新后点击恢复，回读正式槽位 | 0 | 1700000000000 |

按钮报告 `RECOVERED_VALID`，恢复后不再冻结。复验从实际送写的数据读取收益，比较独立回读的槽位载荷。完整标记、原始状态和实际输出见 [refresh-ui.log](evidence/refresh-ui.log)。

**最小修复建议**　同页恢复继续使用原待保存状态。跨刷新若无法证明待保存内容可原样重建，应保持冻结并保留标记。若选择重建，先验证候选载荷与失败时记录的身份一致，再提交。将“首次 HIDE 失败 → 刷新 → 正常按钮恢复”纳入断言，比较金币、游标与完整载荷。

## 探针首次修改边界

`BrowserFilePort.ts` 第 516–534 行在 `await openDb('__probe__')` 后重新检查所有者。第 155 行的 `idbWriteStringKey` 同步进入 Promise executor、创建事务并调用 `store.put`，其内部到首次 put 之间没有异步等待。已启动探针的清理和销毁后结果由真实 Chrome 回归覆盖。STANDARD 和 CONFIRM 在 openDb 暂停点均记录零次探针 put/delete，三槽、事务标记、历史元数据逐字节一致。[STANDARD](evidence/probe-standard.log) · [CONFIRM](evidence/probe-confirm.log)

## 历史与测试影响

历史下限、未知历史和存档消失检查位于首次建档分支之前。Node 专项覆盖已确认、未知和消失情形；已有档恢复仍须完成真实检查点。独立故障测试分别在初始写入回读、历史确认、标记清理处中断，均保持冻结并保留标记。完全成功时回读 revision 1，状态与待存状态一致。[事务故障结果](evidence/transaction-corrected.log)

归一化行尾后，Web 验证脚本仅增加断言代码。Node 旧用例保留，空盘分支预期由恢复成 EMPTY 改为无合法状态保持冻结、传入原状态必须真实提交、核对历史并能继续提交。测试运行器与父提交相同。旧测试未覆盖首次失败后刷新再恢复的顺序。[测试差异](evidence/assertions.log)

