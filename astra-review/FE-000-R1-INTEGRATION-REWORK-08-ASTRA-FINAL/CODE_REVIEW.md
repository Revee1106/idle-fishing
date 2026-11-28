# REWORK-08 定向代码审查

对照父提交 `8458cb34362cf3a207eed963355cdfcd6ba36ea7`，冻结候选只改变两个实现文件和两个测试文件，新增 44 个开发交付文件。审核重点是恢复时传给协调器的内容，以及确认存档、清标、解冻的条件。

| 位置 | 行为和影响 |
|---|---|
| `apps/game-client/assets/scripts/bootstrap/BootEntry.ts` · 恢复按钮 | 只传本次组件持有的 `pendingInitialCommitState`。首次 HIDE 遭遇实际写入故障时保留这次的待存状态。刷新重建组件后，该值为空。界面对新失败分类给出原进度无法安全恢复、写入继续冻结的提示。 |
| `apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts` · 空盘首次建档恢复 | 原状态缺失或校验失败时直接返回 `STORAGE_UNAVAILABLE / INITIAL_COMMIT_STATE_UNAVAILABLE`。该返回位于正式存档提交、历史确认和清标之前。有合法原状态时继续使用原来的真实写入及回读协议。 |
| 正常新玩家及已有存档 | 无历史、无故障的正常 EMPTY 启动保留默认初始化。有效存档走原回读及恢复检查点路径。探针和所有者生命周期实现与父提交相同。 |

独立 Chrome 证据覆盖了两条容易混淆的路径：刷新丢失原状态时，恢复按钮保持冻结；同页原状态仍在时，正式写入的完整业务载荷逐字串匹配原始送写载荷，历史确认为 revision 1，后续 HIDE 达到 revision 2。[刷新](evidence/originalA.log) · [同页回读](evidence/same-page.log) · [重复操作及实际活动界面文本](evidence/repeat-ui.log)
