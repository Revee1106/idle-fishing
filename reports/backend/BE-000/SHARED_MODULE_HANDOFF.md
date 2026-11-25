# BE-000 共享模块交接说明（SHARED_MODULE_HANDOFF）

> **Spike 专用，禁止用于正式业务实现。**
> 本模块只验证工程机制（确定性随机、规范序列化、SHA-256、整数工作量、三槽存档、迁移、离线推进），
> **不是**八个正式模型、不是正式钓鱼状态机、不含任何正式数值或正式内容。
> 正式实现必须在设计方批准 IF-001+ 契约与数值后重写；不得把本模块的类型、字段或算法当作正式契约。

- 交付方：BE-000（后端 AI）
- 接收方：FE-000（前端 AI）
- 分支：`feature/be-000`
- 基线提交：`2106ce19d991ec47555cdbf207454c36d8cd104a`
- 生成日期：2026-11-25
- 本次未提交、未推送；未修改 `apps/game-client/`、`tests/frontend/`、`reports/frontend/`、`docs/`、`config/rules/`、`config/content/`。

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
npm run typecheck      # tsc -p tsconfig.test.json        EXIT=0
npm run build:cocos    # tsc 构建 + 生成 Cocos .mjs 副本   EXIT=0
npm test               # node --test，64/64 通过           EXIT=0
npm run test:perf      # 24h 虚拟离线测量                  EXIT=0
npm run verify         # typecheck + build:cocos + test     EXIT=0
```

实测环境（详见 `reports/backend/BE-000/logs/environment.log`）：

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
| `packages/game-core/dist/cocos/spike/*.mjs` + `*.d.ts` | Cocos Creator 使用的 ESM 副本 |

两份产物由同一次 `tsc` 输出生成：`emit-cocos-mjs.mjs` 只做扩展名与 import 说明符改写，不复制业务实现，不存在两套手写逻辑。脚本会拒绝仍含 `.js` 说明符、CommonJS 或 `node:` 内建的模块。

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
2. 将整个 `packages/game-core/dist/cocos/spike/` 目录复制到 Cocos 工程的 `assets/` 下（例如 `assets/be000mjs/`）。必须复制整目录，模块之间互相引用。
3. 在组件脚本中使用明确扩展名导入：

   ```ts
   import { xoshiroStep, canonicalStringify } from '../be000mjs/index.mjs';
   ```

4. 从场景组件调用一次导入的代码，确保模块进入构建图。

实测结果：

- 把 `dist/spike/*.js` 直接作为 Cocos 资源：失败。assets-db 将 `.js` 当 CommonJS 包装，构建报
  `Could not load .../canonical-json.js (imported by ...canonical-json.mjs?cjs=&original=.js): ENOENT`，CLI `exit=34`。
- 使用 `.mjs` 但省略扩展名导入（`../be000/index`）：失败，编辑器报 `找不到模块 "../be000/index"`。
- 使用 `.mjs` 且显式扩展名：web-mobile 构建成功，运行时探针输出与 Node 一致：
  `xoshiroStep([1,2,3,4]) = { value: 11520, state: [7,0,1026,12288] }`。
- Cocos CLI 在构建成功后可能以 `exit=36` 退出（编辑器进程关闭子构建进程所致），以构建日志中的
  `build Task (web-mobile) Finished` 和产物为准，不能只看退出码。失败时为 `exit=34`。
- 上述验证在临时工程副本中完成，**未修改** `apps/game-client`。正式接入由 FE-000 决定目录与打包方式。

证据：`reports/backend/BE-000/logs/cocos-build.log`、`reports/backend/BE-000/evidence/cocos-runtime-probe.json`。

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

存档协议要点（Spike 解释，正式定义以设计方确认为准）：

- Envelope 字段：`magic, format, revision, epoch, payload, sha256`。
- 哈希输入按文档固定字段顺序序列化为规范 JSON 数组 `[magic, format, revision, epoch, payload]`，再取 UTF-8 SHA-256 小写十六进制。
- 三槽轮换；最高有效 revision 槽永不覆盖；写后回读校验；写结果不确定时重扫认领；全槽损坏拒绝静默新建；未来 schema 返回 `UNSUPPORTED`。
- 平台适配（微信 `FileSystemManager` + `USER_DATA_PATH`）由 FE 实现 `SpikeFilePort`，后端不提供 Node `fs` 版本给正式代码。

### 5.5 离线推进（`offline.ts`）

| 导出 | 说明 |
|---|---|
| `DEFAULT_OFFLINE_FIXTURE` / `SpikeOfflineFixture` | 假时长与假奖励，非正式数值 |
| `createInitialState(options)` | 创建 Spike 状态 |
| `advanceOffline(state, targetMs, { maxNodes? })` | 推进到目标时刻，返回新状态与已处理节点数 |
| `advanceOfflineSliced(state, targetMs, sliceMs, options?)` | 固定切片推进 |
| `cloneState` / `triangularQuantile` | 深拷贝 / 三角分布分位数 |
| `ENV_STREAM_NAME` | `["environment","spike-config-v1","region.pond"]` 的 JSON 字符串 |

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

推进 1 小时后：

```text
sha256 = bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a
attempts=111 casts=111 waits=110 fights=110 prepares=110 cycles=110 envChecks=12 events=110
gold="3116" big="13580246791358024679135802467900" lastTerminalAttemptSeq="110"
```

推进 8 小时后：

```text
sha256 = 7da517674df168ca5f88535b949f51a072982e77a0577b362811aa21c430839f
attempts=970 casts=970 waits=970 fights=970 prepares=969 cycles=969 envChecks=96 events=969
gold="27911" big="119629628552962962855296296285410" lastTerminalAttemptSeq="969"
```

存档 Envelope 样例（rev 1，payload 为 1h 状态）：

```text
payloadSha256  = bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a
envelopeSha256 = 2c768fc2d368faa38b841e8b94c55d1e9398c80ff4e894a49cc2644b056ed5ee
slots          = save_slot_0.json, save_slot_1.json, save_slot_2.json
```

24h 推进最终 Envelope：

```text
envelopeSha256 = 88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536
```

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

1. Spike 类型/字段不是正式 `contracts.ts`，正式阶段需重新设计并评审。
2. Envelope 哈希的“固定字段顺序序列化”在文档中未明确分隔符/数组外壳，本 Spike 采用规范 JSON 数组；需设计方确认。
3. 文档提到 `configVersion`、`engineVersion`、当前尝试、删除标记等；Spike 只验证 revision/epoch/三槽，不含这些正式字段。
4. v1 样例没有“未完成尝试”字段，迁移测试未覆盖该情形。
5. 本 Spike 使用 Node 内置 `node:test`；文档倾向 Vitest。未引入新依赖，正式测试框架待批准。
6. Cocos CLI 成功构建可能返回 `exit=36`，需以日志与产物判定。
7. 复制到 Cocos 的 `.d.ts` 仍使用 `./types.ts` 说明符；运行不受影响，Cocos 构建已通过，但 FE 的 TypeScript 类型解析未验证。正式接入建议生成 `.d.mts` 或提供手写声明。
8. `reports/backend/BE-000/logs/*.log` 被根 `.gitignore` 的 `*.log`/`logs/` 忽略，当前为本地证据；若审查要求入库，需负责人决定是否加例外或强制添加。

## 10. 证据位置

- 构建/测试原始日志：`reports/backend/BE-000/logs/`（本地，被 gitignore）
- Cocos 运行时探针：`reports/backend/BE-000/evidence/cocos-runtime-probe.json`
- 实现报告：`reports/backend/BE-000/IMPLEMENTATION_REPORT.md`
- 测试报告：`reports/backend/BE-000/TEST_REPORT.md`
- 问题报告：`reports/backend/BE-000/ISSUE_REPORT.md`