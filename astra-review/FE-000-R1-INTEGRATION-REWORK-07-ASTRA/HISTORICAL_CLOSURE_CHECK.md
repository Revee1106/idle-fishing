# 历史关闭项复核

REWORK-06 Astra 审核原件的清单自身 SHA-256 为 `e56620d2262acbfe0042f626e2b3f3834490a84e00f296b3c92b448fd4cea36c`，前后两次均复算 86/86。历史容量反例和两个 Chrome 所有者销毁反例均使用只改变执行路径的副本运行；源文件保留在 REWORK-06 审核区。路径适配及本轮独立 UI 用例的生成方式见 [prepare.py](evidence/prepare.py)。

| 历史项 | 本轮实证 | 判定 |
|---|---|---|
| R5-01 单调版本下限 | Node 阶段复验最高槽不可读后消失、协调器更换与历史确认失败。两套 Chrome 的 rework06R501MonotonicCrossTabReload 均通过。 | 维持关闭 |
| R5-02 有档恢复 | 两套 Chrome 的 rework06R502AppUiPersistentQuotaLoop 均通过，持续写故障保持冻结，解除后走真实检查点，再执行 HIDE。 | 维持关闭 |
| R5-03 等待锁期间销毁 | Node 与两套 Chrome rework06R503AppUiRecoveryOwnerLifecycle 均通过，覆盖 STANDARD 及 CONFIRM。 | 维持关闭 |
| R5-02 首次空盘 | 历史 2304/2552 反例已通过，同页恢复内容一致。两次真实 Chrome 跨刷新复验均提交了错误的默认内容。 | 未关闭 |
| R5-03 探针首次写入边界 | 历史 STANDARD/CONFIRM 与当前逐字节断言均通过；探针读回异常执行清理。 | 关闭 |
| 旧档夹具 | 本轮独立 Git 检出自带文件，Node/Mock 通过。 | 关闭 |

[Node 结果](evidence/node.log) · [Chrome A](evidence/webA/r1-green-web-results.json) · [Chrome B](evidence/webB/r1-green-web-results.json) · [历史容量反例](evidence/historical-capacity.log) · [历史 STANDARD](evidence/historical-probe-standard.log) · [历史 CONFIRM](evidence/historical-probe-confirm.log)
