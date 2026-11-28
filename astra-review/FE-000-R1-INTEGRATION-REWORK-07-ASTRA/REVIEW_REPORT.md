# FE-000-R1-INTEGRATION-REWORK-07 最终定向独立复验

**技术结论　REWORK。** 唯一阻断项为 R5-02 跨刷新恢复。首次 HIDE 因配额失败后，两个全新 Chrome Profile 独立复现了相同结果。刷新并点击正常恢复按钮后，应用把 0 金币、初始游标的默认状态提交为 revision 1，确认历史、清除标记并报告 `RECOVERED_VALID`。原待保存载荷已有 31 金币，游戏游标比实际恢复值晚 60 秒。[首次证据](evidence/refresh-ui.log) · [重复证据](evidence/refresh-repeat.log)

| 审核事项 | 判定 | 依据 |
|---|---|---|
| R5-02 空盘首次建档 | **未关闭，P2** | 2304 字节配额下，2552 字节存档正确保持冻结；同页恢复提交原状态。刷新使内存待保存状态消失，恢复按钮误用默认新档。 |
| R5-03 取得锁后、探针首次写入前销毁 | **关闭** | STANDARD、CONFIRM 均为 0 put、0 delete，三槽、标记和历史元数据逐字节一致，结果为 CANCELLED_DESTROYED。开始写入后销毁则完成清理并记录 COMPLETED_AFTER_DESTROY。 |
| 旧档夹具 | **关闭** | 冻结提交直接包含 169730 字节夹具，SHA-256 符合要求。按锁文件安装后 Node/Mock 35/35。 |

候选分支 `candidate/fe-000-rework07`，实测提交 `8458cb34362cf3a207eed963355cdfcd6ba36ea7`，唯一父提交 `dda015cbc5ae698f3df406ea8ffbdd7f756332bc`。开发区 `E:/idle-fishing-rework07`，冻结检出 `E:/idle-fishing-verify-rework07`，独立运行区 `E:/idle-fishing-astra-r7-test`。REWORK-06 审核原件位于本报告同级的 `FE-000-R1-INTEGRATION-REWORK-06-ASTRA` 目录（与本审核目录并列）。

开发清单 60/60、历史审核清单 86/86、后端保护文件 58/58、父提交未改文件 294/294、候选跟踪文件 355/355 均已核验。审核前后，冻结检出与隔离副本的全部跟踪文件均与冻结 Git 对象逐字节相符。仅隔离区生成构建和测试缓存。[身份记录](evidence/after.log)

指定自动化回归全部通过。Web 36/36 和微信 41/41 个全新构建文件逐项匹配交付哈希。两套 E2E 均在首次恢复成功后才刷新；新增独立顺序检查解释了 39/39 与阻断项同时成立的原因。[测试结果](TEST_VERIFICATION.md)

本轮保留 R5-01、有档恢复、排队恢复任务销毁的既有关闭判定。建议开发方仅修正 R5-02 的跨刷新状态选择，再复验同页和刷新两个路径。当前暂缓安排 GATE-01 联合验收，等待负责人决策。[代码定位及最小修复](CODE_REVIEW.md)
