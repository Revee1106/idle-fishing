# BE-000 共享模块交接说明（SHARED_MODULE_HANDOFF）

> **Spike 专用，禁止用于正式业务实现。**
> 本模块只验证工程机制（确定性随机、规范序列化、SHA-256、整数工作量、三槽存档、迁移、离线推进），
> **不是**八个正式模型、不是正式钓鱼状态机、不含任何正式数值或正式内容。
> 正式实现必须在设计方批准 IF-001+ 契约与数值后重写；不得把本模块的类型、字段或算法当作正式契约。

- 交付方：BE-000-R1（后端 AI）
- 接收方：FE-000（前端 AI）
- 分支：`r1/be-000`，整改基准 `358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- 首版交接基线：`feature/be-000` @ `2106ce19d991ec47555cdbf207454c36d8cd104a`
- 生成日期：2026-11-25
- 本次未提交、未推送；未修改 `apps/game-client/`、`tests/frontend/`、`reports/frontend/`、`docs/`、`config/rules/`、`config/content/`。
- R1 变化摘要见第 11 节；前端接入请使用本版产物（严格类型入口已加入 `verify`）。

## 1. 唯一源码位置

所有逻辑只有一个源码位置：

| 文件 | 内容 |
|---|---|
| `packages/game-core/src/spike/index.ts` | 统一导出入口 |
| `packages/game-core/src/spike/types.ts` | Spike 专用类型、存档端口/仓库接口 |
| `packages/game-core/src/spike/prng.ts` | xoshiro128**、FNV-1a 流名派生、U53 |
| `packages/game-core/src/spike/canonical-json.ts` | 规范 JSON、Nat、UTF-8 编码、安全克隆 |
| `packages/game-core/src/spike/sha256.ts` | 纯 TypeScript SHA-256 |
| `packages/game-core/src/spike/time.ts` | 微单位工作量、速率、ceilDiv、积分 |
| `packages/game-core/src/spike/offline.ts` | Spike 假离线推进状态机 |
| `packages/game-core/src/spike/save.ts` | SaveEnvelope、三槽读写、故障恢复 |
| `packages/game-core/src/spike/migration.ts` | v1 → v2 迁移 |
| `packages/game-core/scripts/emit-cocos-mjs.mjs` | 从同一 `tsc` 产物生成 Cocos `.mjs` 副本 |

禁止在 `apps/game-client`、`packages/contracts`、`packages/game-application` 等位置复制这些算法。
前端若需要调用，只能引用构建产物（见第 4 节）。

## 2. 构建命令与实测退出码

在仓库根目录执行（Git Bash / cmd 均可）：

```bash
npm install
npm run typecheck      # tsc -p tsconfig.test.json                     EXIT=0
npm run build:cocos    # tsc 构建 + 生成 Cocos .mjs/.d.mts 副本        EXIT=0
npm run typecheck:cocos # 严格消费者通过真实 .mjs 入口编译             EXIT=0
npm test               # node --test，77/77 通过（R1 收尾复测）        EXIT=0
npm run test:perf      # 24h 虚拟离线测量                              EXIT=0
npm run verify         # typecheck + build:cocos + typecheck:cocos + test  EXIT=0
```

实测环境（详见 `reports/backend/BE-000/logs/environment.log` 与 R1 日志）：

- Windows 10.0.19045 x64，Git Bash（MINGW64）
- Node.js `v24.20.0`（依赖内置 TypeScript 类型剥离，无需 ts-node/tsx）
- npm `11.4.2`
- TypeScript `5.9.3`，`@types/node 24.19.2`
- 无运行时第三方依赖；`node:test` 为 Node 内置
- Cocos Creator `3.8.8 (build 31.3.1)`

注意：`npm test` 的 glob 必须带引号，直接传目录会被 Node 当成模块路径而报 `MODULE_NOT_FOUND`：

```bash
node --test "tests/backend/be-000/**/*.test.ts"
```

## 3. 产物位置

构建后（`dist/` 被根 `.gitignore` 忽略，不随仓库提交，需本地重新构建）：

| 产物 | 用途 |
|---|---|
| `packages/game-core/dist/spike/*.js` + `*.d.ts` | Node / bundler 使用的 ESM |
| `packages/game-core/dist/cocos/spike/*.mjs` + `*.d.mts` | Cocos Creator 使用的 ESM 与严格类型声明 |

两份产物由同一次 `tsc` 输出生成：`emit-cocos-mjs.mjs` 只做扩展名与 import 说明符改写（`.ts`/`.js` → `.mjs`），不复制业务实现，不存在两套手写逻辑。脚本会拒绝仍含 `.ts`/`.js` 说明符、CommonJS 或 `node:` 内建的模块。R1 起声明文件为 `.d.mts`，`index.mjs` 可被严格 TypeScript 消费者直接解析。

`packages/game-core/package.json` 的导出：

```json
{
  "main": "./dist/spike/index.js",
  "types": "./dist/spike/index.d.ts",
  "exports": {
    ".": { "types": "./dist/spike/index.d.ts", "import": "./dist/spike/index.js" },
    "./spike": { "types": "./dist/spike/index.d.ts", "import": "./dist/spike/index.js" }
  }
}
```

## 4. Cocos 引用方式（已用 3.8.8 实测）

**结论：Cocos 必须使用 `.mjs` 产物，且 import 必须写明确扩展名。**

实测步骤：

1. 在仓库根执行 `npm run build:cocos`。
2. 将整个 `packages/game-core/dist/cocos/spike/` 目录复制到 Cocos 工程的 `assets/` 下（例如 `assets/be000mjs/`）。必须复制整目录，模块之间互相引用；同时复制生成的 `*.d.mts`，编辑器类型解析依赖它。
3. 在组件脚本中使用明确扩展名导入：

   ```ts
   import { xoshiroStep, canonicalStringify } from '../be000mjs/index.mjs';
   ```

4. 从场景组件调用一次导入的代码，确保模块进入构建图。

R1 可重建探针：`tests/backend/be-000/cocos-probe/probe.ts` 只导入 `./spike/index.mjs`，构建时把探针与 `dist/cocos/spike/` 一起复制到工程的 `assets/be000mjs/`，并把结果写入 `globalThis.__BE000_PROBE__`。R1 使用的临时工程为 `%TEMP%/idle-fishing-be000-r1-cocos`，构建命令见 `reports/backend/BE-000-R1/evidence/runtime-cocos-r1.mjs`。

严格类型消费者：`tsconfig.cocos-consumer.json` 仅包含 `tests/backend/be-000/cocos-type-consumer.mts`，该文件从实际 `dist/cocos/spike/index.mjs` 导入并调用导出；`npm run typecheck:cocos` 必须 `EXIT=0`。这是前端接入前的最低类型门禁，不代表前端工程配置已验收。

实测结果：

- 把 `dist/spike/*.js` 直接作为 Cocos 资源：失败。assets-db 将 `.js` 当 CommonJS 包装，构建报
  `Could not load .../canonical-json.js (imported by ...canonical-json.mjs?cjs=&original=.js): ENOENT`，CLI `exit=34`。
- 使用 `.mjs` 但省略扩展名导入（`../be000/index`）：失败，编辑器报 `找不到模块 "../be000/index"`。
- 使用 `.mjs` 且显式扩展名：web-mobile 构建成功，运行时探针输出与 Node 一致：
  `xoshiroStep([1,2,3,4]) = { value: 11520, state: [7,0,1026,12288] }`。
- R1 跨宿主对照：同一探针在 Cocos 构建产物（`chunks:///_virtual/index.mjs`）与 Node 中运行，24h 终态 Envelope 均为
  `9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d`，gold `85366`，big `361604935017160493501716049349810`，19 项 Math 向量一致。
- Cocos CLI 在构建成功后可能以 `exit=36` 退出（编辑器进程关闭子构建进程所致），以构建日志中的
  `build Task (web-mobile) Finished` 和产物为准，不能只看退出码。失败时为 `exit=34`。
- 上述验证在临时工程副本中完成，**未修改** `apps/game-client`。正式接入由 FE-000 决定目录与打包方式。

证据：`reports/backend/BE-000-R1/logs/r1-cocos-runtime.log`、`reports/backend/BE-000-R1/logs/r1-cocos-type.log`、`reports/backend/BE-000-R1/logs/r1-cocos-build.out`。

## 5. 导出模块与方法（Spike）

`index.ts` 重导出以下全部内容。类型均为 Spike 专用，字段不代表正式 GameState。

### 5.1 PRNG（`prng.ts`）

| 导出 | 说明 |
|---|---|
| `PRNG_ALGORITHM` | 固定值 `XOSHIRO128SS_V1` |
| `rotl32(x,k)` / `fnv1a32(text)` | 32 位旋转 / FNV-1a 字符串哈希 |
| `deriveStreamWords(rootSeed, streamName)` | 由根种子与流名派生 4 个状态字 |
| `xoshiroStep(words)` | 单步，返回 `{ value, state }`，不修改输入 |
| `nextU53FromWords(words)` | 一步消耗 2 次 next32，生成 `[0,1)` 的 53 位值 |
| `drawU53(state, rootSeed, streamName)` | 从完整 RNG 状态按流抽取并返回新状态 |
| `newRngState()` / `validateRngState(state)` / `cloneRngState(state)` | 初始状态 / 校验 / 深拷贝 |

约束：每次 U53 恰好消费两个 next32；流之间状态独立；禁止 `Math.random`。

### 5.2 规范 JSON 与哈希（`canonical-json.ts` / `sha256.ts`）

| 导出 | 说明 |
|---|---|
| `canonicalStringify(value)` | 对象键按 UTF-16 排序；拒绝 NaN/±Infinity/undefined/-0/裸 bigint/不安全整数/`__proto__`/`prototype`/`constructor` |
| `isNat` / `natFromBigInt` / `natToBigInt` | 非负整数字符串（Nat） |
| `utf8Bytes(text)` | 纯 TS UTF-8 编码，无 `TextEncoder` 依赖 |
| `deepClone(value)` | 规范 JSON 往返克隆 |
| `sha256HexOfBytes(bytes)` / `sha256Hex(text)` | 纯 TS SHA-256，小写十六进制 |

### 5.3 时间与工作量（`time.ts`）

| 导出 | 说明 |
|---|---|
| `MICRO_PER_MS` | `1_000_000n` |
| `assertSafeMs` / `workFromMs` / `rateFromSpeed` | 毫秒安全检查 / 转微单位工作量 / 速率量化 |
| `ceilDiv` / `addWork` / `integrateWork` / `completionTimeMs` | 精确完成时间，不做浮点累加 |
| `mulNatByMultiplier(value, multiplier, mode)` | Nat × 浮点倍率的显式舍入 |

### 5.4 存档（`save.ts` / `types.ts` / `migration.ts`）

| 导出 | 说明 |
|---|---|
| `SAVE_MAGIC` / `SAVE_FORMAT` / `SAVE_SLOT_COUNT` / `SLOT_PATHS` | `IDLE_FISHING` / `1` / `3` / `save_slot_{0,1,2}.json` |
| `SpikeFilePort` | 由平台实现的 `read/write/remove/list`，纯异步字符串接口 |
| `SpikeFileSaveRepository` | `load()` / `commit(state, expectedRevision)` |
| `validateSpikeState` / `buildEnvelope` / `parseEnvelope` / `computeEnvelopeHash` | 校验与 Envelope 编解码 |
| `copyStateForCommit` | 提交前深拷贝 |
| `migrateSpikeState(raw, from, to)` | 目前仅支持 `1 -> 2` 与 `2 -> 2` |

存档协议要点（Spike 解释，正式定义以设计方确认为准，BE-D01 仅限 Spike）：

- Envelope 字段：`magic, format, revision, epoch, payload, sha256`。
- 哈希输入按文档固定字段顺序序列化为规范 JSON 数组 `[magic, format, revision, epoch, payload]`，再取无 BOM 的 UTF-8 SHA-256 小写十六进制。对象键按 UTF-16 code unit 排序，数组保序，字符串使用 ECMAScript `JSON.stringify` 转义，不做 Unicode 规范化。
- 三槽轮换；最高有效 revision 槽永不覆盖；写后回读校验。
- 任一槽读取失败（未知状态）时，`commit` 一律返回 `UNCERTAIN` 且**零写入**；恢复后由 `resolveUncertainWrite` 重扫：确认候选写入则 `COMMITTED`，仍不可读或出现同版本冲突则保持 `UNCERTAIN`，全部可读且候选不存在、revision 未变才 `FAILED`。
- 同 revision 不同内容或不同 epoch 视为冲突，`FAILED` 且零写入；最高槽冲突不得授权新写入。
- 单槽 payload 非法（含 `payload:"null"`）只隔离该槽，不中止扫描，可从有效备份恢复；全槽损坏拒绝静默新建；未来 schema 返回 `UNSUPPORTED`。
- 平台适配（微信 `FileSystemManager` + `USER_DATA_PATH`）由 FE 实现 `SpikeFilePort`，后端不提供 Node `fs` 版本给正式代码。

迁移（`migrateSpikeState`）：

- `1 -> 2` 与 `2 -> 2`。v1 的进行中尝试（FIGHTING/WAITING 等）会保留 stage、stageStartMs、stageDone/stageRequired、计数深度与 RNG 状态；FIGHTING 会生成 `attemptLock`，锁定 `seq`、`claimKey`、`speciesU`、`captureU`、`fightMs`，恢复后只结算一次。迁移失败时原槽字节不变，旧 v1 槽仍可读。
- `attemptLock` 是 Spike 实验字段，用于验证“锁定结果 + 幂等领取”，不是正式契约；只允许存在于 FIGHTING，且 `claimKey === "fish:<seq>"`、未领取、与 `attempts` 一致。

### 5.5 离线推进（`offline.ts`）

| 导出 | 说明 |
|---|---|
| `DEFAULT_OFFLINE_FIXTURE` / `SpikeOfflineFixture` | 假时长与假奖励，非正式数值 |
| `createInitialState(options)` | 创建 Spike 状态；**不接受**自定义 `fixture`，传入即抛错 |
| `advanceOffline(state, targetMs, { maxNodes? })` | 推进到目标时刻，返回新状态与已处理节点数 |
| `advanceOfflineSliced(state, targetMs, sliceMs, options?)` | 固定切片推进 |
| `cloneState` / `triangularQuantile` | 深拷贝 / 三角分布分位数 |
| `ENV_STREAM_NAME` | `["environment","spike-config-v1","region.pond"]` 的 JSON 字符串 |

离线语义要点：

- `offline.settledUntilMs = min(cursorMs, deadlineMs)`，每次游标前进后更新；越过截止后冻结在 deadline，不再结算新尝试。
- WAITING 完成时写入 `attemptLock`；FIGHTING 完成时先校验锁定键未被领取、seq 为当前尝试，再发奖并删除锁，保证重复加载/恢复只结算一次（`gold`、`claims`、`counters`、`lastTerminalAttemptSeq` 一并恢复）。
- 所有 `startMs + ms` 型加法先做 `Number.MAX_SAFE_INTEGER` 检查；最终完成时间不可表示时返回 `null`，不产生溢出时间点。
- `createInitialState` 仅支持内置夹具；若需可替换夹具，必须先由设计方确认初始化/推进/恢复三处一致的契约，当前明确拒绝。

## 6. 固定输入与固定输出

固定向量文件（可提交、被测试直接读取）：

- `tests/backend/be-000/fixtures/rng-vectors.json`
- `tests/backend/be-000/fixtures/math-vectors.json`
- `tests/backend/be-000/fixtures/offline-vectors.json`

重新生成命令（仅当有意更新 Spike 基线时使用）：

```bash
npm run generate:vectors   # EXIT=0
```

### 6.1 RNG 文档向量（docs/interfaces/20 RNG-01）

初始状态 `[1,2,3,4]`，连续 5 次 `xoshiroStep`：

```text
values = [11520, 0, 5927040, 70819200, 2031721883]
state  = [15224335, 29364750, 272377353, 1125134346]
```

根种子 `0x1234abcd`（305441741）的流派生：

```text
"wait"     -> [2370583620, 3926777320, 586938497, 161005436]
"species"  -> [3773152318, 2615558824, 956036534, 2244261048]
"capture"  -> [2805709095, 690618956, 368325, 649676727]
"individual" -> [3887322846, 3264124993, 4061657587, 1648198964]
"[\"environment\",\"spike-config-v1\",\"region.pond\"]"
           -> [2352234015, 1738211158, 2913089538, 3797021700]
```

U53（wait 流）前 3 个：

```text
0.2187637452505511, 0.2844302949931077, 0.32334171421613433
```

### 6.2 序列化 / 离线向量

初始状态（`startMs=1700000000000`, `allowanceMs=86400000`, epoch `epoch.be000`）规范 JSON 的 SHA-256：

```text
79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4
```

推进 1 小时后（R1 仅 `offline.settledUntilMs` 由起始时刻改为已结算游标，其余字段不变）：

```text
sha256 = 8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63
attempts=111 casts=111 waits=110 fights=110 prepares=110 cycles=110 envChecks=12 events=110
gold="3116" big="13580246791358024679135802467900" lastTerminalAttemptSeq="110"
```

推进 8 小时后（R1 增加 `attemptLock`，并把 `settledUntilMs` 推进到游标）：

```text
sha256 = 91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9
attempts=970 casts=970 waits=970 fights=970 prepares=969 cycles=969 envChecks=96 events=969
gold="27911" big="119629628552962962855296296285410" lastTerminalAttemptSeq="969"
attemptLock = { seq: 970, claimKey: "fish:970", speciesU: 0.09688973893848996,
                captureU: 0.4494557859023359, fightMs: 9362 }
```

存档 Envelope 样例（rev 1，payload 为 1h 状态）：

```text
payloadSha256  = 8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63
envelopeSha256 = 4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6
slots          = save_slot_0.json, save_slot_1.json, save_slot_2.json
```

24h 推进最终 Envelope（R1 perf）：

```text
envelopeSha256 = 0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f
```

初始状态 SHA 保持 `79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4` 不变。R1 的逐字段新旧差异与独立生成脚本见 `reports/backend/BE-000-R1/evidence/make-r1-vectors.mjs` 与 `reports/backend/BE-000-R1/logs/r1-vectors.log`（旧向量保留在 `evidence/vectors/offline-vectors.pre-r1.json`）。

完整规范 JSON 见 `offline-vectors.json`，测试会逐字节比较，不通过“仅比较摘要”掩盖差异。

## 7. 前端调用边界

- `game-core` 不访问文件系统、DOM、`wx`、Cocos API；所有 I/O 通过 `SpikeFilePort` 注入。
- FE 负责实现微信 `FileSystemManager` 的 `SpikeFilePort`，并负责生命周期、真实前后台、真机与广告适配。
- FE 不得在客户端重新实现 PRNG、SHA-256、规范 JSON、存档轮换或离线推进。
- 若 FE 需要新的导出/适配接口，先记录问题并由设计方确认契约，不得由任一方私改类型。

## 8. 待前端/真机联合验证事项

以下项目 BE-000 **不能**单方面验收：

- 微信开发者工具与真机启动、真实 `FileSystemManager` 三槽读写、错误码与权限。
- 微信运行时 BigInt、Math、SHA-256、`.mjs` 模块加载的真实表现。
- 真机 24h 离线补算的耗时、内存与帧阻塞（本报告只有 Node 虚拟时钟数据）。
- 生命周期强退、时间回退、广告适配器与去重。
- 正式 `apps/game-client` 对共享产物的接入方式与包体影响。

## 9. 已知限制

1. Spike 类型/字段不是正式 `contracts.ts`，正式阶段需重新设计并评审；`attemptLock` 等 R1 字段仅为实验。
2. Envelope 哈希采用规范 JSON 数组与设计方 R1 确定的排序/转义/UTF-8 规则，但设计方发布的 G01/G02 只给了外层字节数与摘要，未保留 payload 原文；本仓库无法在不猜测输入的前提下复算这两条摘要，已按问题报告记录。本地两条 D01 对照向量见 `tests/backend/be-000/d01-encoding.test.ts`（Python 标准库独立复算）。
3. 文档提到 `configVersion`、`engineVersion`、删除标记等；Spike 只验证 revision/epoch/三槽，不含这些正式字段。
4. 本 Spike 使用 Node 内置 `node:test`；文档倾向 Vitest。未引入新依赖，正式测试框架待批准。
5. Cocos CLI 成功构建可能返回 `exit=36`，需以日志与产物判定。
6. `reports/backend/BE-000-R1/logs/*.log` 默认被根 `.gitignore` 的 `*.log`/`logs/` 规则忽略；R1 的 14 份关键日志已用 `git add -f` 入库（Cocos 构建日志中的 `Proxy-Authorization` 已脱敏），后续新增日志仍需负责人决定入库方式。
7. 前端真实工程、微信开发者工具、真机 `FileSystemManager`、强退恢复、真实广告、真机性能仍未验证，见第 8 节。

## 10. 证据位置

- 构建/测试原始日志：`reports/backend/BE-000-R1/logs/`（本地，被 gitignore；含 R1 与整改前对照）
- 独立向量/对照脚本：`reports/backend/BE-000-R1/evidence/`（`make-r1-vectors.mjs`、`runtime-cocos-r1.mjs`、`d01-independent.py`、`pre/`）
- R1 报告：`reports/backend/BE-000-R1/IMPLEMENTATION_REPORT.md`、`TEST_REPORT.md`、`ISSUE_REPORT.md`
- 首版报告：`reports/backend/BE-000/IMPLEMENTATION_REPORT.md`、`TEST_REPORT.md`、`ISSUE_REPORT.md`

## 11. R1 变化摘要（供前端接入与复审）

1. 存档：未知槽读取禁止新写入；不确定提交零写入并需 `resolveUncertainWrite` 重新确认；同 revision 冲突 `FAILED`；单槽非法隔离并从有效备份恢复。
2. 奖励幂等：真实 FIGHTING 结算入口校验 `claimKey` 与 `lastTerminalAttemptSeq`，恢复/重放只发一次奖；持久化同步游标、奖励、RNG、检查点与（FIGHTING）`attemptLock`。
3. 离线：`settledUntilMs` 随游标推进并在 deadline 冻结；截止前/时/后行为有回归覆盖。
4. 迁移：v1 进行中尝试保留 stage/进度/锁定结果/RNG，旧槽可读，只结算一次。
5. 时间：最终时间加法溢出返回 `null`，不再产生不安全时间点。
6. Cocos/严格类型：生成 `.d.mts`，`npm run typecheck:cocos` 通过实际 `index.mjs` 编译；可重建探针与跨宿主对照已通过。
7. 夹具：`createInitialState` 明确拒绝自定义 `fixture`，不再静默采用默认值；可替换夹具留待设计方契约。
8. 向量：仅因已确认缺陷修复更新 1h/8h/Envelope/24h 摘要，逐字段差异与独立脚本已保留；初始向量不变。