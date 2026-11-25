# BE-000 实现报告（IMPLEMENTATION_REPORT）

- 任务：BE-000 技术验证——Node/Cocos 共享纯 TypeScript 规则模块（Spike）
- 分支：`feature/be-000`
- 基线：`2106ce19d991ec47555cdbf207454c36d8cd104a`（`main` 初始提交）
- 日期：2026-11-25
- 状态：BE-000 后端部分已完成；前端接入与微信真机项等待联合验证
- 边界：**Spike 专用**。未实现八模型、正式钓鱼状态机、正式数值/内容、HTTP/DB/云服务；未开始 BE-001
- Git：**未提交、未推送、未合并**；未修改 `apps/game-client/`、`tests/frontend/`、`reports/frontend/`、`docs/`、正式契约与正式数值

## 1. 已阅读的设计基线

根目录：`AGENTS.md`、`ARCHITECTURE.md`、`DEVELOPMENT_PLAN.md`、`DECISIONS.md`、`ISSUES.md`、`DEVELOPMENT_STATUS.md`、`packages/AGENTS.md`、`apps/simulator/AGENTS.md`。

设计基线 `docs/baseline-v0.2/00`–`14` 与 `docs/interfaces/15`–`20`、`docs/interfaces/contracts.ts` 均已阅读；重点对照：

- 11：零成本存储、三槽、启动恢复顺序、不把全损坏当新档
- 12：状态机与结算事务、检查点一致性
- 13：AI 开发规范与验收门禁
- 14：T01–T13 验收矩阵与 Spike 范围
- 19：Envelope 字段、哈希计算、迁移与删除标记
- 20：RNG-01 等固定向量、SAVE/FSM/OFF 用例

仓库中未发现 `docs/baseline-v0.3`；不存在需要额外记录冲突的 v0.3 文件。

## 2. 环境

| 项 | 值 |
|---|---|
| OS | Windows 10.0.19045 x64 |
| Shell | Git Bash（MINGW64_NT-10.0-19045） |
| Node.js | v24.20.0（内置 TypeScript 类型剥离） |
| npm | 11.4.2 |
| TypeScript | 5.9.3 |
| @types/node | 24.19.2 |
| Cocos Creator | 3.8.8（build 31.3.1），`C:/ProgramData/cocos/editors/Creator/3.8.8` |
| CPU | Intel64 Family 6 Model 142 Stepping 10 |
| 运行时第三方依赖 | 无 |

环境原始记录：`reports/backend/BE-000/logs/environment.log`。

## 3. 实现内容

### 3.1 工具链与共享包边界

- npm workspaces，仅注册 `packages/game-core`；根包保持私有。
- `tsconfig.base.json`：ES2020 / ESM / `strict` / `verbatimModuleSyntax` / `allowImportingTsExtensions` / `rewriteRelativeImportExtensions`，不启用 DOM 或 Node 类型。
- `tsconfig.test.json`：仅测试侧引入 Node 类型，覆盖 `packages/game-core/src/**/*.ts` 与 `tests/backend/be-000/**/*.ts`。
- `packages/game-core` 的 `lib` 只有 `ES2020`，没有 DOM/Cocos/wx/Node 类型；源码不引用任何平台 API。
- Node 24 直接运行 `.ts`；生产构建由 `tsc` 输出 ESM + `.d.ts`。

### 3.2 确定性随机（`prng.ts`）

- xoshiro128** v1，`Math.imul` + 32 位无符号运算，无 `Math.random`。
- 流名经 FNV-1a 32 位后与根种子混合，再以 Weyl 常量与 32 位雪崩函数派生 4 个状态字。
- 每次 U53 = 两次 `next32`，高 26 位与低 27 位拼为 53 位整数再除以 `2^53`。
- 状态可完整序列化/恢复；不同流状态独立存储，增删流不影响既有流。
- 文档 RNG-01 向量通过：`[11520, 0, 5927040, 70819200, 2031721883]`。

### 3.3 规范 JSON、Nat 与 SHA-256

- 对象键按 UTF-16 排序；数组顺序保持。
- 拒绝 NaN、±Infinity、undefined、-0、裸 bigint、非安全整数、危险键 `__proto__`/`prototype`/`constructor`。
- 所有 Nat 使用十进制字符串。
- 纯 TS UTF-8 编码（含代理对处理），不依赖 `TextEncoder`。
- 纯 TS SHA-256，与 `node:crypto` 在空串、跨 55/56/64/65/119/120 字节边界及随机长度上逐字节一致。

### 3.4 整数工作量与完成时刻

- 以微单位 Nat 表示工作量，`rate` 只量化一次。
- `ceilDiv` 精确计算“还差多少毫秒完成”，避免浮点累加误差。
- 完成时写入 `stageRequired`，剩余工作量丢弃，不跨阶段携带。
- 连续积分与分片积分结果一致；超大 BigInt 不丢精度。

### 3.5 三槽存档协议

Envelope：`{ magic:'IDLE_FISHING', format:1, revision:Nat, epoch, payload, sha256 }`。

- 哈希输入：规范 JSON 数组 `[magic, format, revision, epoch, payload]` 的 UTF-8 SHA-256。
- 读取三槽，忽略“明确不存在”，IO 失败标记为不可判断而非 EMPTY。
- 逐槽验证 magic/format/hash/payload 规范 JSON/schema/epoch 一致/状态不变量。
- 选择最高有效 revision；低槽可恢复并报告 `recovered`。
- 新 revision 写最低槽，但最高有效槽永不覆盖；写后回读验证。
- 写结果不确定时重新扫描三槽，认领已完整落盘的更高 revision；仍无法确认则返回 UNCERTAIN，禁止继续资产操作。
- 全槽损坏返回 CORRUPT，不静默新建；未来 schema 返回 UNSUPPORTED；最高槽为未知 schema 时拒绝在其上提交。
- 平台 I/O 抽象为 `SpikeFilePort`（read/write/remove/list），业务层不接触文件系统。

实现位置：`packages/game-core/src/spike/save.ts`。

### 3.6 v1 → v2 迁移

- 先按 v1 结构校验，再执行纯迁移；迁移函数不读墙钟、不抽随机、不发奖、不写文件。
- 调用方以新 revision 提交，旧有效槽保留。
- 迁移失败不修改文件；不支持的路径抛 `MigrationError`。
- 修复了自测发现的真实缺陷：v1 输入曾被 `deepCopyV2` 误接受，现显式检查 `schemaVersion === 2`。

实现位置：`packages/game-core/src/spike/migration.ts`。

### 3.7 离线推进（假数据）

- 事件驱动：CASTING → WAITING → FIGHTING → PREPARING → 下一轮，IDLE 在截止后不再开新尝试。
- 每个节点精确推进到阶段完成时刻，不按固定 tick 扫描。
- 支持 `maxNodes` 预算切片；连续推进、600s 切片、60s 切片、64 节点预算结果完全一致。
- 检查点保存/加载/恢复后继续推进，最终状态与不中断一致（含全部 RNG 流）。
- 截止后世界继续推进（环境检查继续），但不发鱼、不扣饵。
- 尝试序号与 claim 键保证同一终止尝试只结算一次。
- 环境活动速率按 5 分钟检查点更新；三角分布用分位数函数。
- 所有时长/奖励均为假数据，明确标记 Spike。

实现位置：`packages/game-core/src/spike/offline.ts`。

### 3.8 Cocos 产物桥接

- 新增 `packages/game-core/scripts/emit-cocos-mjs.mjs`：把同一次 `tsc` 输出的 `dist/spike/*.js` 复制为 `dist/cocos/spike/*.mjs`，同步复制 `.d.ts`，改写相对 import 说明符。
- 脚本拒绝残留 `.js` 说明符、CommonJS 或 `node:` 内建。
- 实测 Cocos Creator 3.8.8：`.js` 资源被 assets-db 当 CommonJS 导致 ENOENT；`.mjs` + 显式扩展名导入成功构建并在运行时应答固定向量。
- 前端工程未被修改；验证使用临时工程副本。

## 4. 文件清单

### 4.1 新增/修改（BE-000 所有权内）

根目录：

- `package.json`（修改：workspaces 与脚本）
- `package-lock.json`（新增，npm 锁文件）
- `tsconfig.base.json`（新增）
- `tsconfig.test.json`（新增）

共享包：

- `packages/game-core/package.json`
- `packages/game-core/tsconfig.json`
- `packages/game-core/scripts/emit-cocos-mjs.mjs`
- `packages/game-core/src/spike/index.ts`
- `packages/game-core/src/spike/types.ts`
- `packages/game-core/src/spike/prng.ts`
- `packages/game-core/src/spike/canonical-json.ts`
- `packages/game-core/src/spike/sha256.ts`
- `packages/game-core/src/spike/time.ts`
- `packages/game-core/src/spike/offline.ts`
- `packages/game-core/src/spike/save.ts`
- `packages/game-core/src/spike/migration.ts`

测试与向量：

- `tests/backend/be-000/helpers.ts`
- `tests/backend/be-000/prng.test.ts`
- `tests/backend/be-000/canon-sha.test.ts`
- `tests/backend/be-000/time.test.ts`
- `tests/backend/be-000/save.test.ts`
- `tests/backend/be-000/migration.test.ts`
- `tests/backend/be-000/offline.test.ts`
- `tests/backend/be-000/vectors.test.ts`
- `tests/backend/be-000/dist-artifact.test.ts`
- `tests/backend/be-000/cocos-artifact.test.ts`
- `tests/backend/be-000/perf.ts`
- `tests/backend/be-000/generate-vectors.ts`
- `tests/backend/be-000/fixtures/rng-vectors.json`
- `tests/backend/be-000/fixtures/math-vectors.json`
- `tests/backend/be-000/fixtures/offline-vectors.json`

报告：

- `reports/backend/BE-000/IMPLEMENTATION_REPORT.md`
- `reports/backend/BE-000/TEST_REPORT.md`
- `reports/backend/BE-000/ISSUE_REPORT.md`
- `reports/backend/BE-000/SHARED_MODULE_HANDOFF.md`
- `reports/backend/BE-000/evidence/cocos-runtime-probe.json`
- `reports/backend/BE-000/logs/*.log`（本地证据，被根 `.gitignore` 忽略）
- `reports/backend/DEVELOPMENT_STATUS.md`

### 4.2 未修改

- `apps/game-client/**`（Git 中为前端 AI 的未跟踪文件，保持原样）
- `tests/frontend/**`（同上）
- `reports/frontend/**`
- `docs/**`（包括 `docs/interfaces/contracts.ts`）
- `config/rules/**`、`config/content/**`、`config/scenarios/**`（仅保留 `.gitkeep`）
- `packages/contracts/**`、`packages/game-application/**`、`packages/game-config/**`、`apps/simulator/**`（本任务未创建实现）
- 根 `DEVELOPMENT_STATUS.md`、`ISSUES.md`、`DECISIONS.md`

## 5. 命令与退出码（实测）

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `npm install` | 0 | 安装 TypeScript、@types/node、workspace 链接 |
| `npm run typecheck` | 0 | 无错误 |
| `npm run build:cocos` | 0 | `9 .mjs + 9 .d.ts` |
| `npm test` | 0 | 64 tests / 64 pass / 0 fail |
| `npm run test:perf` | 0 | 24h 虚拟推进与一致性检查 |
| `npm run verify` | 0 | typecheck + build + test 全通过 |

日志：`reports/backend/BE-000/logs/{environment,typecheck,build-cocos,test,perf}.log`。

## 6. 性能结果（Node 虚拟时钟，非真机）

24h 虚拟时间，Spike 假事件：

| 指标 | 值 |
|---|---:|
| 处理节点 | 14,935 |
| 尝试 / 终止事件 | 2,930 / 2,929 |
| 环境检查 | 288 |
| 最终状态字节 | 35,006 |
| 连续推进 | 104.701 ms |
| 600s 分片 | 149.861 ms |
| 60s 分片 | 164.598 ms |
| 64 节点预算 | 147.311 ms |
| 检查点保存+加载+恢复 | 362.896 ms |
| 仅序列化 Envelope | 7.378 ms |
| RSS / heapUsed | 98,873,344 B / 27,080,656 B |
| 最终 Envelope SHA-256 | `88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536` |

所有分片/预算/检查点结果与连续推进一致（`checks` 全为 `true`）。

限制：单进程 Node 测量，不是泄漏测试；未测 Cocos 帧阻塞、微信真机、低端机内存。正式阈值与负载需在结果后由设计方确认。

## 7. 验收映射（仅 BE-000 可证明部分）

| ID | 后端证据 | 状态 | 说明 |
|---|---|---|---|
| T01 微信启动 | 无 | NOT_RUN | 前端/真机范围 |
| T02 共享规则 | 同一 `tsc` 产物生成 Node `.js` 与 Cocos `.mjs`；Node 测试与 Cocos 运行时探针均得到 `11520 / [7,0,1026,12288]` | PASS（后端） | 正式 `apps/game-client` 接入待 FE 联合验证 |
| T03 确定性随机 | RNG-01/03/04、流独立、状态恢复、连续 vs 分片一致性 | PASS（后端） | 微信运行时随机待真机 |
| T04 文件存档 | 三槽轮换、损坏回退、全坏拒绝、真实临时目录 | PASS（后端） | 微信 `FileSystemManager` 待 FE/真机 |
| T05 故障恢复 | 写前/半写/写后抛/未确认/读失败/冲突/回滚；claim 不重复 | PASS（后端） | 真机崩溃语义待联合验证 |
| T06 24h 离线 | 14,935 节点、分片一致、检查点一致、耗时/内存已记录 | PASS（后端计算） | 帧阻塞/真机内存/正式阈值 BLOCKED |
| T07 迁移 | v1→v2 提交新 revision 且保留旧槽；失败不写文件 | PASS（后端） | “未完成尝试”样例缺失，见 ISSUE |
| T08 生命周期 | 无 | NOT_RUN | 前端/真机范围 |
| T09 激励广告 | 无 | NOT_RUN | 前端/广告资格范围 |
| T10 分包与资源 | 无 | NOT_RUN | 前端构建范围 |
| T11 Code First | 无 | NOT_RUN | 前端范围 |
| T12 可重复构建 | Node/TS/Cocos 版本与命令、Web 构建、CLI 怪癖已记录 | PASS（Node/Web） | 微信构建 NOT_RUN |
| T13 AI 修复闭环 | 注入乘积 9→8，6 项测试失败 → 恢复 → 64/64 通过 | PASS | 日志见 `t13-red.log` / `t13-green.log` |

结论：BE-000 只对后端可验证项给出证据；不宣布 GATE-01 或 Spike 整体验收通过。

## 8. 设计偏差与待确认

1. **测试框架**：文档优先 Vitest；本 Spike 用 Node 内置 `node:test`，不引入依赖。正式阶段待批准。
2. **哈希外壳**：文档只写“按固定字段顺序序列化 `[magic,format,revision,epoch,payload]`”，未明确是 JSON 数组还是其他拼接；本实现采用规范 JSON 数组。需设计方确认。
3. **正式字段缺口**：Spike 未包含 `configVersion`、`engineVersion`、当前尝试、删除标记、报告累积器等；正式契约需重新设计。
4. **Cocos 格式**：必须 `.mjs` + 显式扩展名；Cocos CLI 成功时可能 `exit=36`。已在交接文档记录。
5. **日志入库**：根 `.gitignore` 忽略 `logs/` 与 `*.log`，本地日志不会随仓库提交。需负责人决定是否强制加入。
6. **内存数据**：只有单进程 RSS/heap，不是泄漏或真机内存结论。

## 9. 未完成与人工操作

必须由负责人/其他 AI 完成：

1. 审查本报告与代码；决定是否提交、推送、开 MR（本次均未执行）。
2. FE-000 接入 `dist/cocos/spike`，实现微信 `SpikeFilePort`，完成 T01/T08/T10/T11 及 T02/T03/T04/T05 的客户端侧。
3. 提供微信开发者工具/真机，执行 T04/T05/T06 的真机语义与性能；广告位具备后执行 T09。
4. 设计方确认：哈希序列化细节、正式契约字段、Vitest 选型、v1“未完成尝试”迁移样例、正式性能阈值。
5. 若需保留构建证据，决定 `reports/backend/BE-000/logs` 的入库方式（当前被忽略）。

## 10. 停止点

BE-000 到此停止。未开始 BE-001，未实现正式业务，未进行任何 Git 提交/推送/合并，等待独立审查。