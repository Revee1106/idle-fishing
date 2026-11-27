# 定向验收表

| 项目 | 本轮判定 | 证据 |
|---|---|---|
| SHA、双亲、候选/测试区、归档、58 个受保护文件、历史与补充归档 | PASS | before.json、after.json、historical-report-mapping.json |
| rev2 历史下限、只读旧备份、跨协调器/页/刷新 | PASS | history.log、webA/B 中 rework06R501MonotonicCrossTabReload |
| 历史写失败、未确认目标、损坏标记与下限、旧格式处理 | 已测用例 PASS | fe-with-archive-fixture.log、Web 结果；范围见 CODE_REVIEW |
| 有档持续配额、检查点不增收益/时间、后续 HIDE | PASS | historical-ui.json、current-ui.json、两个 Web Profile |
| 空盘首次存档容量不足 | FAIL | capacity.log |
| 锁等待销毁，STANDARD 与 CONFIRM | PASS | historical-ui.json、两个 Web Profile |
| 已启动事务收尾且不重新激活 | PASS | 两个 Web Profile 的 r503AfterMutationStart |
| 探针首次写入前销毁，取消零持久化变更 | FAIL，两入口 | probe-owner-standard.log、probe-owner-confirm.log |
| 后端、perf、A1–A8、Cocos 类型、前端类型、33 项 Node/Mock | PASS，夹具与生成声明前提见测试报告 | *.log / *.rc |
| Web 两套 37/37、A01 两套 12/12 | PASS | webA、webB、r6-isolated-race-astraA/B.json |
| 微信构建及 10 项静态检查 | PASS | buildwx.log、wechat.json |
| 与公司构建逐字节完全一致 | Web 有差异；微信 R6 全量参考摘要缺失 | web-hash-comparison.json、wechat-hashes.json |
| 微信 IDE 实际运行、真机、广告、GATE-01 | NOT_RUN / 待负责人决策 | 独立复审边界 |
