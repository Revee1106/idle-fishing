# BE-000-R1 问题报告（ISSUE_REPORT）

- 日期：2026-11-25
- 范围：BE-000-R1 后端 Spike 整改
- 状态：`OPEN` 等待决定；`BLOCKED` 需外部输入/设备/设计确认；`INFO` 已记录事实，不阻塞本轮代码
- 本报告不修改根 `ISSUES.md`，也不把任何设计待办视为已解决

## 汇总

| 编号 | 摘要 | 影响 | 状态 |
|---|---|---|---|
| BE000-R1-ISS-01 | 日志默认被 `.gitignore` 忽略；R1 关键日志已强制入库 | 后续证据入库策略 | OPEN |
| BE000-R1-ISS-02 | 设计方 G01/G02 只发布外层字节数与摘要，缺 payload 原文 | BE-D01 摘要复算 | BLOCKED |
| BE000-R1-ISS-03 | 正式存档字节级格式仍未批准，Spike 方案仅实验 | 存档兼容 | BLOCKED |
| BE000-R1-ISS-04 | v1 `attempt` 字段是本轮实验扩展，真实 v1 档不含 | 迁移样例解释 | INFO |
| BE000-R1-ISS-05 | 可替换离线夹具没有初始化/推进/恢复一致契约 | 夹具扩展 | OPEN |
| BE000-R1-ISS-06 | 真机性能预算与代表设备未定，仅 Node/Cocos Web 数据 | T06/BE-D02 | BLOCKED |
| BE000-R1-ISS-07 | 微信文件系统、强退、生命周期、广告未执行 | 整体验收 | BLOCKED |
| BE000-R1-ISS-08 | Cocos CLI 成功构建可能 `exit=36` | 自动化判定 | INFO |
| BE000-R1-ISS-09 | `attemptLock` 为 Spike 实验字段，不是正式契约 | 前端接入 | INFO |
| BE000-R1-ISS-10 | 5× 事件压力负载与微信真机耗时未测 | BE-D02 | BLOCKED |
| BE000-R1-ISS-11 | 本轮修改了后端维护的根 `package.json` / `tsconfig.test.json` | 共享工具链 | INFO |

## BE000-R1-ISS-01 日志默认被 gitignore

- 描述：根 `.gitignore` 含 `logs/` 与 `*.log`，普通 `git add` 不会包含 `reports/backend/BE-000-R1/logs/`。
- 影响：若审查只看默认提交内容，会缺少原始日志。
- 当前处理：本次提交已用 `git add -f` 将 R1 的 14 份关键日志纳入版本管理（`r1-cocos-build.out` 中的 `Proxy-Authorization` 已脱敏）；`LOGS.sha256` 记录校验值。根规则未改，后续新增日志仍默认被忽略。
- 建议：负责人决定是否为 `reports/**/logs/` 增加 `.gitignore` 例外，避免每次强制添加。
- 状态：OPEN（R1 证据已入库，长期规则待定）。

## BE000-R1-ISS-02 G01/G02 缺 payload 原文

- 描述：审核 `R1/HANDOFF.md` 给出两组向量共用 `IDLE_FISHING`、`1`、`"7"`、`epoch.audit`，G01 外层 55 字节 / `7322a234…c40a27`，G02 外层 150 字节 / `431dafc1…8b5354`；但未给出 payload 原文。全量检索 `E:/idle-fishing`、`E:/idle-fishing-backend`、`E:/idle-fishing-frontend`、`E:/idle-fishing-review` 与本地会话记录，均只有摘要表。
- 影响：无法在不猜测输入的前提下复算两条发布摘要；不能声称已核对 G01/G02。
- 当前处理：按设计方 R1 编码规则实现并新增两条**本地** D01 向量（payload 明确写出，Python 标准库独立复算）：`tests/backend/be-000/d01-encoding.test.ts`、`evidence/d01-independent.py`、`logs/r1-d01-python.log`。本地向量不冒充 G01/G02。
- 建议：设计方补发 G01/G02 的完整 payload 字符串（含转义后的字节），后端可直接加入同一测试。
- 状态：BLOCKED（等待设计输入）。

## BE000-R1-ISS-03 正式存档格式未批准

- 描述：BE-D01 的记录明确了规范 JSON、UTF-16 排序、ECMAScript 转义、无规范化、无 BOM 与外层数组哈希规则，但仍标注“仅作 Spike”。
- 影响：正式发布存档前需设计方批准格式与旧档兼容策略。
- 当前处理：实现与测试按该规则执行；未修改正式契约。
- 状态：BLOCKED（正式发布门禁）。

## BE000-R1-ISS-04 v1 `attempt` 是实验扩展

- 描述：为验证“进行中尝试迁移”，`SpikeGameStateV1` 增加可选 `attempt`；真实 v1 存档没有该字段。
- 影响：`MIG-05/MIG-06` 只证明实验样例；不能推断线上 v1 档已有进行中尝试格式。
- 当前处理：类型与报告均标注实验性质；无 `attempt` 的 v1 仍按原路径迁移为 IDLE。
- 状态：INFO。

## BE000-R1-ISS-05 可替换夹具无一致契约

- 描述：原接口允许 `fixture` 但只在初始化使用，推进/恢复会回到默认夹具。R1 选择明确拒绝而不是猜测三处语义。
- 当前处理：`createInitialState` 对 `fixture` 抛错；`OFF-12` 与 `logs/r1-fixture.log` 记录。
- 建议：若需要可替换夹具，由设计方定义初始化、推进、恢复一致的契约后再开放。
- 状态：OPEN。

## BE000-R1-ISS-06 真机性能预算未定

- 描述：HANDOFF 的实验目标（单片 8ms、警戒 16ms、24h 3s、5× 10s、堆 32MB）未获正式批准；本轮只有 Node 虚拟时钟与 Cocos Web 运行数据。
- 当前处理：Node 24h 五项一致性通过，数据见 `TEST_REPORT.md` 第 6 节；未宣称满足正式预算。
- 状态：BLOCKED（等待设备与预算）。

## BE000-R1-ISS-07 微信真机项未执行

- 描述：微信开发者工具、真机 `FileSystemManager` 三槽/错误码/权限、强退、时间回退、前后台、广告适配均未在本轮执行。
- 影响：这些属前端与真机联合验收，后端不能单方关闭。
- 状态：BLOCKED。

## BE000-R1-ISS-08 Cocos CLI 退出码

- 描述：web-mobile 构建日志显示 `build Task (web-mobile) Finished`，但 CLI 以 `exit=36` 退出；失败时为 `exit=34`。
- 当前处理：以日志与产物判定成功；`logs/r1-cocos-build.out` 保留。
- 状态：INFO。

## BE000-R1-ISS-09 `attemptLock` 不是正式契约

- 描述：`attemptLock` 只用于锁定 FIGHTING 结果与幂等领取，校验要求 `seq === counters.attempts`、`claimKey === "fish:<seq>"`、未领取、仅在 FIGHTING。
- 影响：前端若持久化/展示该字段，需按 Spike 实验数据处理，不得当作正式 GameState。
- 状态：INFO。

## BE000-R1-ISS-10 5× 压力与真机耗时未测

- 描述：BE-D02 的 5 倍事件压力负载与微信真机耗时未执行。
- 当前处理：本轮仅标准 24h Node/Cocos Web 对照。
- 状态：BLOCKED。

## BE000-R1-ISS-11 根工具链修改

- 描述：R1 修改了根 `package.json`（新增 `typecheck:cocos`、扩展 `verify`）与 `tsconfig.test.json`（排除探针目录），新增 `tsconfig.cocos-consumer.json`。
- 依据：TASK 第 6 条与 REWORK_PROMPT 允许后端维护任务授权范围内的根构建配置修改；未改锁文件、未加依赖。
- 状态：INFO，供复审确认所有权。

## 遗留的设计问题（沿用首审）

- `BE-D01` 正式存档字节格式：仍待设计方批准（本报告 ISS-03）。
- `BE-D02` 真机性能预算：仍待负责人/设计方批准（本报告 ISS-06/10）。
- 本 Spike 使用 Node 内置 `node:test`，文档倾向 Vitest；未引入新依赖，正式测试框架待批准。