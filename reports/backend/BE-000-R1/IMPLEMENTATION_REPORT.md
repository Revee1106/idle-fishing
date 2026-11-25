# BE-000-R1 整改报告（IMPLEMENTATION_REPORT）

- 任务：BE-000-R1，后端 Spike 整改（仅后端）
- 工作区：`E:/idle-fishing-backend`
- 分支：`r1/be-000`
- 整改基准提交：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- 实际状态：`HEAD` 仍为 `358b111`；整改为**未提交**工作区变更。候选文件 SHA-256 见 `FILES.sha256`，逐文件清单见 `FILE_LIST.md`，源码/配置/测试补丁见 `BE-000-R1-code.patch`（`git apply --check -R` 已验证与工作区一致）
- 日期：2026-11-25
- 宿主：Windows 10.0.19045 x64 / Git Bash / Node v24.20.0 / npm 11.4.2 / TypeScript 5.9.3 / Cocos Creator 3.8.8
- 边界：仅修改 `packages/game-core/src/spike/`、`packages/game-core/scripts/emit-cocos-mjs.mjs`、`tests/backend/be-000/`、根 `package.json` / `tsconfig.test.json`（后端维护的根工具链）及后端交接/报告；未修改前端、设计文档、正式契约、正式数值；未推送、未合并、未开始 BE-001

## 1. 基准与范围确认

开工前确认：

```text
git rev-parse --abbrev-ref HEAD  -> r1/be-000
git rev-parse HEAD               -> 358b11105cfdee9bd076049c86a34d8f0aaa00e7
```

已读根 `AGENTS.md`、`packages/AGENTS.md`、`E:/idle-fishing-review/REVIEWER.md`、`reports/backend/BE-000-R1/TASK.md`，以及审核工作区四份首审报告、`R1/HANDOFF.md`、`docs/interfaces/11/12/14/18–20`。设计文档、正式契约与数值只读。

TASK 明确的范围外事项（正式存档字节格式、真机性能预算、前端/真机验证）保持未决，未在本轮自行设计替代方案。

## 2. 整改前失败复现（证据保留）

在修改源码前执行并保留日志：

| 复现项 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---:|---|---|
| 基准全套 | `npm run verify` | 0 | 64/64 通过（原套件全绿，缺陷在覆盖与语义） | `logs/pre-verify.log` |
| 审核反例 A1–A8 | `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | 1 | 1 通过 / 7 失败 | `logs/pre-review-a1-a8.log` |
| 严格 Cocos 消费者 | `tsc` 编译 `evidence/pre/cocos-type-audit.mts` | 2 | `TS7016`：`.mjs` 无声明文件，退化为 `any` | `logs/pre-cocos-type.log` |
| 自定义夹具 | 审核诊断脚本（`fixture.castMs=17`） | 0 | 静默使用默认夹具，17ms 后进入 `CASTING`，未拒绝 | `logs/pre-fixture.log` |

A1–A8 失败摘要：未知槽仍可写（A1）、已落盘但目标不可读未保持 `UNCERTAIN`（A2）、最高槽冲突可写（A3）、单槽非法 `null` 中止整次读取（A4）、检查点未记录已结算时间（A5）、时间相加溢出（A6）、重复领取已存在的 `fish:1` 仍加金币（A8）。

## 3. 逐项整改

### 3.1 I01 槽未知禁止新写入、不确定提交零写入

文件：`packages/game-core/src/spike/save.ts`

- `commit` 先扫描三槽；任一槽 `ioError` 立即返回 `UNCERTAIN`，**不执行任何写入**。
- 同 revision 不同内容、或有效槽出现混合 epoch → `FAILED`，零写入；最高槽冲突不得授权新写。
- `readSlots` 对每槽 `parseEnvelope` 单独 `try/catch`，单槽异常只标记该槽非法。
- `resolveUncertainWrite` 重扫：仍不可读或冲突 → 保持 `UNCERTAIN`；确认候选落盘 → `COMMITTED`；全部可读、候选不存在且 revision 未变 → `FAILED`。
- 旧版本仍有效且候选确实未落盘，才报告确定失败；否则保留可恢复状态。

测试：`R1-SAVE-01`、`R1-SAVE-03`、`R1-SAVE-05`、`SAVE-T04e`、`SAVE-T07`、`SAVE-T12`。

### 3.2 I02 单槽非法隔离与备份恢复

文件：`save.ts`、`R1-SAVE-02`

- `parseEnvelope` 拒绝非对象 / `null` / 数组 payload，捕获规范化与状态校验异常并返回 `ok:false`，不再抛出 `TypeError`。
- `payload:"null"` 或非法内容的槽被隔离，其余有效槽照常选择最高 revision；有效备份可恢复。
- 全槽损坏仍拒绝静默新建；未来 schema 仍 `UNSUPPORTED`（`SAVE-T02`、`SAVE-T03`）。
- `validateSpikeState` 新增跨字段一致性：离线 `deadlineMs === startedMs + allowanceMs`、`settledUntilMs` 边界、`lastTerminalAttemptSeq` 与 `counters.attempts`、`claims` 与终态尝试、进行中阶段与结算状态、`PREPARING` 当前尝试已结算、`stageDone <= stageRequired`、`stageStartMs <= cursorMs`、`attemptLock` 一致性。

### 3.3 I03 真实 FIGHTING 入口奖励幂等

文件：`packages/game-core/src/spike/offline.ts`

- WAITING 完成进入 FIGHTING 时写入 `attemptLock`：`{seq, claimKey:"fish:<seq>", speciesU, captureU, fightMs}`。
- FIGHTING 完成时先校验锁与当前 `attempts`/`stageRequired` 一致、`claimKey` 尚未领取、`seq > lastTerminalAttemptSeq`，再执行任何 RNG 或奖励变更；使用锁定键领取并删除锁。
- 已领取键或进行中状态不一致的候选抛错或被安全拒绝，不会再次改变 `gold`、`big`、`claims`、`lastTerminalAttemptSeq` 或 RNG 状态。
- `copyStateForCommit` / 加载路径保持 `attemptLock`，仓库与引擎回放使用真实 `SpikeFileSaveRepository`，不再使用测试内自写 grant。

测试：`SAVE-T05`（真实结算、保存、加载、恢复、伪造重放）、`A8`、`R1-CHK-01`。

### 3.4 I04 检查点与截止前/时/后

文件：`offline.ts`、`time.ts`

- 新增 `advanceSettledCheckpoint`：每次游标前进后 `settledUntilMs = min(cursorMs, deadlineMs)`，越过截止冻结在 deadline。
- 每次持久化同时保存游标、`gold`/`big`、`claims`、`counters`、RNG 状态、`offline` 与（FIGHTING）`attemptLock`。
- 截止前（deadline−1）、恰好截止、截止后（deadline+1）均有断言：越过截止不再发起新尝试、不再结算、`settledUntilMs` 冻结、世界时间/环境检查继续。
- 切片 60s、600s、`maxNodes` 预算与连续推进终态一致。

测试：`OFF-09`、`R1-CHK-01`、`OFF-01`、`OFF-03`、`R1-TIME-01`。

### 3.5 I05 v1 进行中尝试迁移

文件：`types.ts`、`migration.ts`

- `SpikeGameStateV1` 增加**实验性**可选 `attempt`（stage/stageStartMs/stageDone/stageRequired/lock），真实 v1 档不含该字段。
- 迁移校验 stage、正计数、进度边界、`stageStartMs <= cursorMs`、FIGHTING 必须有锁、锁 `seq/counter`、`claimKey`、U 值范围、`workFromMs(fightMs) === stageRequired`。
- 迁移后保留 stage/进度/计数深度/RNG，FIGHTING 写入深拷贝的 `attemptLock`；环境检查时间使用安全加法。
- 成功提交后旧 v1 槽仍可读；失败时原槽字节不变（测试逐字节断言）。
- 恢复后继续推进至 FIGHTING 完成，只结算一次。

测试：`MIG-05`、`MIG-06`、`MIG-01`–`MIG-04`。

### 3.6 I06 时间加法溢出

文件：`time.ts`、`offline.ts`、`migration.ts`

- 新增 `safeAddMs(a,b,label)`：操作数与结果都必须是安全整数，否则抛 `CanonicalJsonError`。
- 离线截止、初始环境检查、下一次环境检查、v1 环境检查时间均改用 `safeAddMs`。
- `completionTimeMs` 与片内完成计算在 `startMs + elapsed` 不安全时返回 `null`，不再产生越界时间点。
- `R1-TIME-01` 覆盖 `startMs` 接近 `MAX_SAFE_INTEGER` 时的完成、切片与环境检查溢出。

### 3.7 I07 严格 Cocos `.mjs` 消费者

文件：`emit-cocos-mjs.mjs`、`tsconfig.cocos-consumer.json`、`tests/backend/be-000/cocos-type-consumer.mts`、`tests/backend/be-000/cocos-probe/probe.ts`、`package.json`

- 生成产物改为 `*.d.mts`，把声明中的相对 `.ts`/`.js` 说明符改写为 `.mjs`，并拒绝残留 `.ts`。
- 新增 `typecheck:cocos`：严格 `noEmit` 编译 `cocos-type-consumer.mts`，该文件只从实际 `dist/cocos/spike/index.mjs` 导入并调用导出。
- `verify` 顺序改为 `typecheck → build:cocos → typecheck:cocos → test`。
- 可重建探针 `cocos-probe/probe.ts` 只导入 `./spike/index.mjs`，在真实 Cocos 3.8.8 web-mobile 构建中运行；与 Node 对照结果为同一 24h Envelope。
- `tsconfig.test.json` 排除 `cocos-probe`（探针由 Cocos 工程编译，不由 Node 测试配置吞掉）。

测试/证据：`COCOS-02`、`r1-cocos-type.log`、`r1-cocos-runtime.log`、`r1-cocos-build.out`。

### 3.8 I08 自定义夹具收窄

文件：`offline.ts`、`offline.test.ts`

- `CreateInitialOptions` 移除 `fixture`；运行时若仍传入 `fixture`，抛
  `Custom offline fixtures are not supported by this experimental entry point`。
- 不再静默回退默认夹具；初始化、推进、恢复只使用同一内置夹具。
- 若以后需要可替换夹具，必须先由设计方确认三处一致契约，本轮不自行定义。

测试：`OFF-12`；诊断证据 `logs/r1-fixture.log`（EXIT=1，按预期抛错）。

### 3.9 V01 覆盖修正

- `SAVE-T05` 改为真实引擎：推进到 FIGHTING、保存、加载、恢复、只发一次奖；再用已领取 `fish:<seq>` 的伪造候选证明被拒绝。
- `SAVE-T04e` 覆盖“写入已落盘但目标槽不可读、旧槽可读”，结果 `UNCERTAIN` 且不再写。
- `OFF-09` 覆盖 deadline−1、恰好 deadline、deadline+1，执行原先遗漏的 `>` 分支。
- 新增 `r1-regression.test.ts` 7 项，覆盖未知槽、非法 payload、同版本冲突、隐藏高版本、持久化后不可读、检查点三段、时间溢出。

### 3.10 V02 覆盖与报告纠正

- 原报告称 10 个测试文件、实际 9 个；R1 实际为 **11 个测试文件、77 项**（新增 `r1-regression.test.ts`、`d01-encoding.test.ts`，原有文件内补齐用例）。
- T07：原报告与问题报告矛盾（标 PASS 又写未测）。R1 已补 v1 进行中尝试样例 `MIG-05/MIG-06`，结论改为“Node 测试 PASS；微信真机迁移仍未测”。
- T04：写失败/部分写/全写后抛错/静默截断/不可观察写均有测试；微信 `FileSystemManager` 实际错误码仍未测。
- T05：真实 FIGHTING 入口幂等 PASS（Node）；真机强退恢复未测。
- T06：Node 虚拟时钟 24h 与 Cocos Web 运行对照 PASS；代表真机性能预算未定。
- U53 位组合：源码为 `a.value >>> 5`（高 27 位）与 `b.value >>> 6`（低 26 位），`hi * 2^26 + lo`。原实现报告“高 26/低 27”有误，本报告更正；`RNG-01`/`RNG-03` 数值不变。

### 3.11 BE-D01 外层字节与摘要

- 编码规则按设计方 R1 记录执行：对象键 UTF-16 code unit 排序、数组保序、`JSON.stringify` 转义、无 Unicode 规范化、无 BOM、UTF-8 SHA-256 小写十六进制。
- 新增 `d01-encoding.test.ts` 3 项，用 **Python 标准库独立复算**的两条本地向量锁定外层字节数与摘要（`d01-independent.py` + `logs/r1-d01-python.log`）：
  - A：payload `{"name":"Alice"}`，外层 59 字节，`052166960a60184b98f25faadf00fc99bf6c60028c305a53e7e220fb625b92ae`。
  - B：含引号、两个反斜杠、真实换行/制表符、中文与 emoji，外层 158 字节，`2148014d02842b5d0f071476bda16004bc0e1971d4ec6264d343caa9411c7936`。
- 设计方发布的 G01/G02 只给了“外层 55/150 字节 + 摘要”，未保留 payload 原文；在全部可访问设计/审核材料中均无该输入。为避免猜测输入，本轮**未声称**复算 G01/G02，已记录为 `BE000-R1-ISS-02`（等待设计方补发 payload）。
- BE-D01 仍仅限 Spike；正式存档兼容格式未在本轮批准。

### 3.12 BE-D02 性能

- 实验目标按 HANDOFF 记录（单片 8ms、警戒 16ms、24h 3s、5× 压力 10s、堆 32MB）仅作参考，正式预算仍待负责人/设计方批准。
- 本轮 Node 24h 实测（`logs/r1-perf.log`）：连续 134.405ms、600s 切片 138.498ms、60s 切片 217.607ms、64 节点预算 149.51ms、检查点保存/加载/恢复 254.192ms、序列化 10.173ms、RSS 92,995,584B、heap 15,091,928B；五项一致性全部 `true`；24h Envelope `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f`。
- 真机、微信与 5× 压力负载未测，按 `BE000-R1-ISS-06` 保留 BLOCKED。

## 4. 黄金向量变化

只改因已确认缺陷（检查点语义 + 锁定结果持久化）而必须变化的向量；初始向量未变。

| 向量 | 旧 SHA-256 | 新 SHA-256 | 允许差异 |
|---|---|---|---|
| initial | `79a77355…0a35f4` | 不变 | 无 |
| 1h | `bdfacdeb…7cab2a` | `8a882ec8…95aa63` | 仅 `offline.settledUntilMs`：起始时刻 → 已结算游标 |
| 8h | `7da51767…0839f` | `91bfd08b…00e4e9` | 新增 `attemptLock`（FIGHTING 锁定结果）+ `offline.settledUntilMs` |
| rev1 payload | `bdfacdeb…7cab2a` | `8a882ec8…95aa63` | 随 1h 状态 |
| rev1 envelope | `2c768fc2…ed5ee` | `4e1d068a…1ddd6` | 随 payload |
| 24h envelope（perf） | `88cb5751…ff8536` | `0be078f1…e69f` | 随检查点/锁语义 |

独立依据：

- `evidence/make-r1-vectors.mjs` 逐字段比较新旧 fixture，只允许 `offline.settledUntilMs` 与 `attemptLock` 两类路径变化，否则拒绝写入；日志 `logs/r1-vectors.log`。
- 旧 fixture 保留在 `evidence/vectors/offline-vectors.pre-r1.json`。
- `gold`、`big`、`attempts`、`claims`、`lastTerminalAttemptSeq`、`stage`、`stageDone/stageRequired`、RNG 流均未改变；差异仅来自“记录已结算时间”和“锁定 FIGHTING 结果”，二者均为本轮已确认缺陷修复的必然副作用。
- `VEC-05`、`DIST-02` 仍逐字节比较完整规范 JSON，不是只比摘要。

## 5. 构建与交接

- `npm run verify` 最终 `EXIT=0`，11 个测试文件、77/77 通过（`logs/r1-verify-final.log`）。
- `npm run build:cocos` 输出 `9 .mjs + 9 .d.mts`。
- `npm run typecheck:cocos` `EXIT=0`（`logs/r1-cocos-type.log`）。
- Cocos 3.8.8 web-mobile 构建日志 `build Task (web-mobile) Finished`，CLI `exit=36`（已知成功退出码）；`logs/r1-cocos-build.out`。
- 跨宿主对照 `PASS`：Node 与 Cocos 24h Envelope 均为 `9ed7cded…7e1d`，gold `85366`，big `361604935017160493501716049349810`，19 项 Math 向量一致。
- 交接说明已更新：`reports/backend/BE-000/SHARED_MODULE_HANDOFF.md`（R1 变化摘要、严格类型入口、探针步骤、向量与限制）。

## 6. 未完成/阻塞

| 项 | 状态 | 说明 |
|---|---|---|
| 设计方 G01/G02 摘要复算 | BLOCKED | 只发布外层字节数与摘要，未保留 payload 原文；不以猜测输入伪造结果 |
| 正式存档字节格式 | BLOCKED | BE-D01 仅 Spike；正式格式待设计方批准 |
| 真机性能预算 | BLOCKED | 仅 Node 虚拟时钟 + Cocos Web；代表设备/微信真机未测 |
| 微信文件系统/强退/广告 | BLOCKED | 属前端与真机联合验证 |
| 根日志入库 | OPEN | 默认规则忽略 `*.log`/`logs/`；R1 的 14 份关键日志已强制入库（构建日志中的代理凭据已脱敏），后续策略待定 |

详细问题记录见 `ISSUE_REPORT.md`；测试证据见 `TEST_REPORT.md`。