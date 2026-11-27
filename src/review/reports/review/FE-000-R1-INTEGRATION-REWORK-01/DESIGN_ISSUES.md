# 设计与平台边界

**L1，TECHNICAL_LIMIT，P1。** apps/game-client/assets/scripts/platform/SingleWriterSaveCoordinator.ts:29 的队列 Map 属于当前加载的模块实例。BrowserFilePort.ts:45 的 key 可稳定标识同一命名空间，但独立 JS 上下文不会共享 Map。重复加载独立模块副本同样缺少共同队列；未发现当前客户端源码有意打包两套协调器。

独立探针在同一 Chrome 配置、同源的两个实际游戏页面中调用各自 Boot 的协调器。让页 A 在首次写前等待，页 B 写入已推进 15 秒的候选，再让 A 完成。两者均返回 COMMITTED / rev1 / slot0，最后持久状态的 cursor 回到 1700000000000。证据见 evidence/audit-tabs.mjs 和 tabs.json。单运行时独占已验证。开发方披露了多标签限制；本次实测表明实际 Web 入口确实可以同时打开并写入。

**是否阻断。** 阻断对共享 Web 存储的多写者安全签认。若 Web 限于单写者实验，负责人需明确适用范围并落实可验证的写入限制或存储隔离；若支持同源多页面写入，需选择跨页面协调和冲突处理方案并回归上述序列。微信真机上的主上下文、重入、其他上下文写入情况尚缺现场证据，不能用 Chrome 或 Node 代证。本轮其余实测缺陷可直接返回开发方整改。

**待归档原件。** reports/review/R1/PRE_REVIEW_READINESS.md、reports/review/R1/BE-000-R1/、reports/review/R1/BE-000-R1-P2/ 均未见家庭原件。
