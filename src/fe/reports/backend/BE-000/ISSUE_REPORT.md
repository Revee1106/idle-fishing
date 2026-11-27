# BE-000 问题报告（ISSUE_REPORT）

- 日期：2026-11-25
- 范围：BE-000 Spike 技术验证
- 状态说明：`OPEN` = 已知限制，等待负责人/设计方决定；`BLOCKED` = 需要外部环境或设计确认才能继续；`INFO` = 已记录的事实，不阻塞本任务
- 本报告不修改根 `ISSUES.md`，也不自行把任何设计问题视为已解决

## 汇总

| 编号 | 摘要 | 影响 | 状态 |
|---|---|---|---|
| BE000-ISS-01 | 构建/测试日志被根 `.gitignore` 忽略 | 审查证据入库 | OPEN |
| BE000-ISS-02 | Envelope 哈希“固定字段顺序”未明确分隔符/外壳 | 存档格式契约 | BLOCKED |
| BE000-ISS-03 | Spike 类型/字段与正式契约存在预期差距 | 正式实现 | INFO |
| BE000-ISS-04 | v1 迁移缺少“未完成尝试”最小样例 | T07 完整性 | OPEN |
| BE000-ISS-05 | 文档优先 Vitest，本 Spike 使用 `node:test` | 测试框架选型 | OPEN |
| BE000-ISS-06 | Cocos 只接受 `.mjs` + 显式扩展名；CLI 成功可能 `exit=36` | 前端集成 | INFO |
| BE000-ISS-07 | Cocos 声明文件仍引用 `.ts` 说明符，类型消费未验证 | 前端类型体验 | OPEN |
| BE000-ISS-08 | 无正式性能阈值；只有 Node 虚拟时钟数据 | T06 真机验收 | BLOCKED |
| BE000-ISS-09 | `advanceOffline` 固定使用默认假数据，未持久化自定义 fixture | Spike 可配置性 | INFO |
| BE000-ISS-10 | 微信文件系统、生命周期、广告、分包均未执行 | 整体验收 | BLOCKED |

## BE000-ISS-01 日志被 gitignore

- 描述：根 `.gitignore` 含 `logs/` 与 `*.log`，`reports/backend/BE-000/logs/*.log` 不会随 Git 提交。
- 影响模块：BE-000 证据、独立审查。
- 依据：`git status` 不显示日志；`.gitignore` 规则。
- 当前处理：报告正文已内嵌关键命令、退出码、计数和性能数字；日志仍保留在本机。
- 建议：负责人决定是否为 `reports/**/logs/` 增加例外，或在审查时使用 `git add -f`。本任务未修改 `.gitignore`，未提交。
- 状态：OPEN。

## BE000-ISS-02 Envelope 哈希序列化细节不唯一

- 描述：`docs/interfaces/19` 要求“按固定字段顺序序列化 `[magic,format,revision,epoch,payload]` 的 UTF-8 SHA-256”，未明确是规范 JSON 数组、带分隔符拼接，还是其他编码；数组元素中的字符串是否再加引号也未写明。
- 影响模块：存档兼容性、跨端校验。
- 依据：`docs/interfaces/19-平台适配存档广告与版本接口.md:52`。
- 当前实现：`computeEnvelopeHash` 使用 `canonicalStringify([magic, format, revision, epoch, payload])`，测试锁定该结果。
- 建议：设计方在正式契约中给出完整示例（含 payload 与最终哈希），或明确采用本 Spike 的数组方案。确认前不得把该哈希当作正式格式。
- 状态：BLOCKED（等待设计确认）。

## BE000-ISS-03 Spike 与正式契约的预期差距

- 描述：Spike 只验证机制，未实现正式 GameState/八模型/真实钓鱼状态机；类型、字段、事件、奖励、配置版本均不是正式契约。
- 影响模块：IF-001+、前端接入。
- 依据：任务书明确 Spike 范围；`packages/contracts` 未修改。
- 当前处理：源码与文档均标记 SPIKE-ONLY；交接文档声明禁止复制为正式实现。
- 建议：正式阶段按批准契约重新设计类型与算法，不复用 Spike 字段名作为既成事实。
- 状态：INFO。

## BE000-ISS-04 v1 迁移缺少未完成尝试样例

- 描述：T07 要求覆盖“未完成尝试兼容的最小样例”，但 Spike v1 结构只有计数器、金币、RNG，没有阶段/尝试字段；迁移只能构造 IDLE 新档。
- 影响模块：迁移验收、存档升级。
- 依据：`packages/game-core/src/spike/types.ts` 的 `SpikeGameStateV1`；`migration.test.ts` MIG-01。
- 当前结果：v1→v2 成功、旧槽保留、失败不写文件均通过；未完成尝试场景 NOT_RUN。
- 建议：设计方提供正式 v1 含 in-progress attempt 的样例后补测；在此之前 T07 只能标“部分通过/待补”。
- 状态：OPEN。

## BE000-ISS-05 测试框架与文档偏好不一致

- 描述：`docs/baseline-v0.2/11` 写“Vitest 为优先测试框架，具体工具版本和打包方式待验证”；本 Spike 使用 Node 24 内置 `node:test`，未引入 Vitest。
- 影响模块：测试工具链、正式工程。
- 依据：`docs/baseline-v0.2/11-技术架构与零成本存储.md:18`。
- 当前理由：Node 24 可直接运行 TS，零新增依赖；64 个测试已覆盖所需机制。
- 建议：正式阶段由负责人批准 Vitest 或确认继续使用 `node:test`；不得把本 Spike 视为框架选型结论。
- 状态：OPEN。

## BE000-ISS-06 Cocos `.mjs` 与 CLI 退出码

- 描述：
  1. Cocos 3.8.8 的 assets-db 把 `.js` 当 CommonJS，ESM `.js` 资源构建失败；
  2. 省略扩展名导入失败；
  3. `.mjs` + 显式扩展名可用；
  4. 构建成功时 CLI 可能 `exit=36`，失败为 `exit=34`。
- 影响模块：FE-000 接入、构建脚本。
- 依据：`reports/backend/BE-000/logs/cocos-build.log`；临时工程 web-mobile 构建与运行时探针。
- 当前处理：构建脚本输出 `dist/cocos/spike/*.mjs`；交接文档写明复制与导入方式。
- 建议：FE 接入时以构建日志/产物判断成功，不要仅依赖 CLI 退出码；正式工程确定资源目录后固定构建流程。
- 状态：INFO。

## BE000-ISS-07 Cocos 声明文件说明符未验证

- 描述：复制到 Cocos 的 `.d.ts` 仍使用 `./types.ts` 说明符（由 `rewriteRelativeImportExtensions` 输出），运行时不受影响，但 TypeScript 类型解析、IDE 提示未验证；Cocos 构建本身通过。
- 影响模块：前端类型体验。
- 依据：`packages/game-core/dist/cocos/spike/index.d.ts`。
- 当前处理：未修改已验证的运行产物；交接文档只保证 `.mjs` 运行时。
- 建议：正式接入时生成 `.d.mts` 或提供手写声明，并在 FE 的 `tsc` 下验证；不要假定 Cocos 编辑器已消费这些声明。
- 状态：OPEN。

## BE000-ISS-08 性能阈值与真机数据缺失

- 描述：24h 测量为 Node 24 虚拟时钟，未测 Cocos 帧阻塞、微信真机、低端机内存；文档未给正式阈值。
- 影响模块：T06、T12、正式性能预算。
- 依据：`perf.log`；`docs/baseline-v0.2/14` 要求正式阈值在结果后确认。
- 当前结果：14,935 节点、连续 104.701 ms、60s 分片 164.598 ms、检查点 362.896 ms、RSS ~94.3 MiB（单进程）。
- 建议：由负责人/设计方基于真机数据确定预算；真机未测前不得宣称性能通过。
- 状态：BLOCKED。

## BE000-ISS-09 自定义离线 fixture 未持久化

- 描述：`createInitialState` 接受 `fixture`，但 `advanceOffline` 始终使用 `DEFAULT_OFFLINE_FIXTURE`；状态中也没有 fixture 标识。若传入非默认 fixture，初始化与推进可能不一致。
- 影响模块：Spike 离线测试、未来配置注入。
- 依据：`offline.ts` 的 `createInitialState` 与 `advanceOffline`。
- 当前处理：所有测试使用默认 fixture；不影响 BE-000 结论。
- 建议：Spike 阶段可删除自定义入口或写入 fixture 标识；正式实现必须把规则/配置版本纳入存档并显式传入。
- 状态：INFO。

## BE000-ISS-10 外部环境项未执行

- 描述：微信开发者工具启动、真机文件系统、生命周期强退、时间回退、广告、微信构建与分包均未执行。
- 影响模块：T01、T04/T05/T06 真机部分、T08、T09、T10、T11、T12 微信部分。
- 依据：当前环境无微信开发者工具/真机/广告位；这些属 FE-000 或负责人范围。
- 建议：FE-000 完成后进行联合验证；广告无资格时按文档标记 BLOCKED，不以桩测试冒充真实广告通过。
- 状态：BLOCKED。

## 非问题说明

- T13 注入缺陷已恢复，源码最终为正确乘积 `9`；不属于遗留缺陷。
- 迁移中修复的 `schemaVersion` 校验为自测发现的实现缺陷，已修复并有回归。
- 未发现需要修改 `docs/`、`packages/contracts` 或正式数值的阻塞问题；若设计方确认 BE000-ISS-02/04，再按变更流程同步。