# FE-000-R1-INTEGRATION 实现与集成报告（IMPLEMENTATION_REPORT）

## 1. 集成状态与 Git 基线元信息

| 项目 | 值 |
|---|---|
| 任务 | `FE-000-R1-INTEGRATION`（前端共享核心升级与兼容性验证） |
| 集成工作区 | `E:\idle-fishing-integration` |
| 当前集成分支 | `integration/fe-000-be-r1` |
| 前端基准提交（`HEAD`） | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| 后端目标提交（`MERGE_HEAD`） | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（`git merge --no-ff --no-commit`，未提交） |
| 共同祖先（`merge-base`） | `358b11105cfdee9bd076049c86a34d8f0aaa00e7` |
| 合并冲突数 | `0`（前端改动 101 文件，后端改动 58 文件，重叠 `0` 文件） |
| 暂存差异（合并引入后端原始变更） | **58** 个文件（来自 `5bcc9ac`，含 `packages/game-core/`、`tests/backend/`、`reports/backend/` 及后端维护的根 `package.json`/`tsconfig.test.json`/`tsconfig.cocos-consumer.json`） |
| 未暂存差异（本次前端自主修改） | **6** 个文件（严格限定 `apps/game-client/` 4 个、`tests/frontend/` 2 个） |
| 后端受保护文件对比 `5bcc9ac` | `git diff 5bcc9ac -- packages/ tests/backend/ reports/backend/ package.json package-lock.json tsconfig*.json docs/ config/` 输出 **`0` 行差异** |
| 历史前端报告对比 `be62996` | `git diff be62996 -- reports/frontend/` 输出 **`0` 行差异**（历史证据零覆盖） |
| 最终交付结论 | **`READY_FOR_INDEPENDENT_REVIEW`**（不含最终验收权，不宣布 `GATE-01` 通过） |

---

## 2. 共享模块接入与产物链确认（第三阶段）

### 2.1 唯一来源与模块解析路径
- 前端通过 `apps/game-client/package.json` 的 `"@idle-fishing/game-core": "file:../../packages/game-core"` 直接链接本集成工作区内的单一源码包。
- 实测解析路径（`logs/phase1-module-resolution.log` & `logs/phase7-backend-verify.log`）：
  - `node_modules/@idle-fishing/game-core` 实际符号链接目标：`E:\idle-fishing-integration\packages\game-core`（无跨工作区链接）。
  - Node ESM 解析入口：`E:\idle-fishing-integration\packages\game-core\dist\spike\index.js`。
  - TypeScript 声明入口：`E:\idle-fishing-integration\packages\game-core\dist\spike\index.d.ts`。
  - Cocos ESM 产物：`E:\idle-fishing-integration\packages\game-core\dist\cocos\spike\`。

### 2.2 升级前后产物对比（消除旧版缓存）
| 目录 | 升级前（`358b111`） | 升级后（`5bcc9ac`） | 验证依据 |
|---|---|---|---|
| `packages/game-core/dist/spike/` | 9 `.js` + 9 `.d.ts`（18 文件） | 9 `.js` + 9 `.d.ts`（18 文件） | `npm run verify`（`logs/phase7-backend-verify.log`） |
| `packages/game-core/dist/cocos/spike/` | 9 `.mjs` + 9 `.d.ts`（旧声明） | **9 `.mjs` + 9 `.d.mts`**（18 文件，旧 `.d.ts` 已清除） | `emit-cocos-mjs.mjs` 先 `rm` 后生成；`npm run typecheck:cocos` 严格通过 |
| 真实 Web 打包产物消费证明 | 输出 `358b111` 1h 摘要 `bdfacdeb...` | 清空旧 `build/` 重建后，运行态输出 `5bcc9ac` 1h 摘要 `8a882ec8...`、8h `attemptLock`（`fish:970`）、24h Envelope 内部/全文双摘要匹配、且拒绝 `allowanceMs=0` 与自定义 `fixture` | `logs/phase7-verify-web.log` + `evidence/web-integrated/r1-green-web-results.json` |

### 2.3 工具链与环境变量核对
- 工具链：Node.js `v24.20.0`、npm `11.4.2`、TypeScript `5.9.3`、Cocos Creator `3.8.8`、微信开发者工具 `2.01.2510280`、Chrome `158.0.8127.37`。
- **环境变量核对**：实际脚本 `apps/game-client/scripts/build-cocos.mjs` 第 30 行读取 **`COCOS_CREATOR_EXE`**（历史文档 `PLATFORM_HANDOFF.md` 曾误写为 `COCOS_CREATOR_PATH`），本集成报告以实际脚本为准记录（见 `ISSUE_REPORT.md` `INT-ISS-02`）。

---

## 3. 本次前端自主修改清单（仅 6 个源码/测试文件）

> 合并引入的 58 个后端文件全部保持暂存原样未改动，完整列表见 `logs/phase2-backend-diff.log`。以下 6 个未暂存修改均为本次前端兼容性适配与测试增强：

1. **`apps/game-client/assets/scripts/shared/SharedCoreBridge.ts`**（修改）：
   - 将 `BE000_GOLDEN` 升级至 `5bcc9ac` 权威黄金向量，严格区分 `oneHourSha256`（状态规范 JSON）、`oneHourEnvelopeInnerSha256`（Envelope 内部 `sha256` 字段）、`oneHourEnvelopeSha256`（Envelope 全文摘要）、`eightHourSha256`、`twentyFourHourEnvelopeInnerSha256` 与 `twentyFourHourEnvelopeSha256`。
   - `T03-ADVANCE` 增加 1h `settledUntilMs` 检查点校验、8h `FIGHTING` `attemptLock`（`fish:970`）校验，以及 `allowanceMs=0` 和自定义 `fixture` 拒绝校验。
   - `T07-MIGRATE` 增加实验性 v1 `PREPARING` 迁移校验（保留 `fish:7`、`lastTerminalAttemptSeq='7'`，推进不重复发奖）。
   - `run24hOfflineBenchmark` 同时输出并比对 24h Envelope 内部校验（`9ed7cded...`）与全文摘要（`0be078f1...`），并在报告中标注 `backendCoreCommit: '5bcc9ac'`。
2. **`apps/game-client/assets/scripts/bootstrap/BootEntry.ts`**（修改）：
   - **关键兼容性加固（第四阶段 7.1）**：修正原先 `bootstrap()` 中将非 `VALID`（含 `CORRUPT`/`UNSUPPORTED`）归入 `else` 新建初始存档的缺陷；改为严格仅在 `existing.kind === 'EMPTY'` 时初始化新状态，遇到 `CORRUPT` / `UNSUPPORTED` 时进入 fail-closed 停机态（`persistenceHalted = true`、`persistState = null`），绝不视作新玩家、绝不删除或覆盖槽位。
   - 显式区分 `SpikeCommitResult` 四态（`COMMITTED` / `CONFLICT` / `FAILED` / `UNCERTAIN`）；遇到 `UNCERTAIN` 时立即置 `persistenceHalted = true` 暂停后续自动写入，禁止将其当作普通 `FAILED` 盲目重试。
3. **`apps/game-client/assets/scripts/platform/PlatformVerificationSuite.ts`**（修改）：
   - 在 `T05-FAULTS` 中保留原有写前失败、半写恢复、写后抛错认领的同时，新增 `5bcc9ac` 未知槽读取错误测试：验证 `commit()` 返回 `UNCERTAIN` 且 `FaultInjectingFilePort` 写入次数增量严格为 `0`。
4. **`apps/game-client/assets/scripts/ui/OverviewPage.ts`**（修改）：
   - 在 Page 1 摘要卡片与弹窗中展示当前接入的核心版本 `5bcc9ac`、1h 状态 SHA-256、8h `attemptLock` 状态与 24h 黄金摘要匹配标记。
5. **`tests/frontend/fe-000/platform-and-core.test.ts`**（修改）：
   - 保留原有全部 7 组测试（更新第 1 组向量至 `5bcc9ac` 并分别校验三类摘要）。
   - 新增 3 组专项兼容性测试（共 **10 组**）：
     - `[NODE/COMPAT-SAVE]`：覆盖全部 8 种 load/commit 状态（`EMPTY`/`VALID`/`CORRUPT`/`UNSUPPORTED`/`COMMITTED`/`CONFLICT`/`FAILED`/`UNCERTAIN`）、未知槽 0 写入、写后目标不可读保持 `UNCERTAIN` 恢复可读后载入、单槽 `payload:"null"` 隔离、同 rev 异内容、混合 epoch、未来 schema 99 零覆盖、篡改 `attemptLock.fightMs` 拒绝。
     - `[NODE/COMPAT-OFFLINE-MIGRATION]`：覆盖 `allowanceMs <= 0` / 自定义 `fixture` / 时间溢出拒绝、deadline 前/恰好/后 `settledUntilMs` 冻结、实验性 v1 `FIGHTING` 与 `PREPARING` 迁移（保留锁/RNG/原 v1 槽字节，结算幂等不重复发奖）。
     - `[NODE/COMPAT-LEGACY-358B111]`：直接读取第一阶段在 `358b111` 上生成的隔离样本 `evidence/legacy-358b111-saves.json`，验证 `IDLE`、`FIGHTING`、`PREPARING`、`POST_DEADLINE`、`CORRUPT_WITH_VALID_BACKUP` 在 `5bcc9ac` 上的加载、推进与提交。
6. **`tests/frontend/fe-000/verify-web-build.mjs`**（修改）：
   - 默认输出目录切换至 `reports/integration/FE-000-R1-INTEGRATION/evidence/web-integrated`（支持 `--out-dir=` 与 `VERIFY_WEB_OUT_DIR`），确保运行 `verify:web` 绝不覆盖历史 `reports/frontend/FE-000/evidence/`。
   - 保留原有 18 项断言并新增 3 项（共 **21 项断言**）：1h Envelope 内部/全文双摘要校验、8h 黄金摘要与 `attemptLock` + `settledUntilMs` 校验、真实 Web 产物 `CORRUPT` 启动 fail-closed 零覆盖校验（写入损坏槽 -> `Page.reload()` -> 验证 `loadStatus='CORRUPT'` & `persistenceHalted=true` -> 派发 `visibilitychange(hidden)` -> 验证槽内容未被覆盖）。

---

## 4. 黄金向量新旧对照与三类摘要区分（第五阶段）

> **摘要口径严格区分**：
> 1. **状态规范 JSON SHA-256**：`sha256Hex(canonicalStringify(state))`
> 2. **Envelope 内部 `sha256` 字段**：`buildEnvelope(state, '1').sha256`（即 `computeEnvelopeHash([magic, format, revision, epoch, payload])`）
> 3. **Envelope 全文 SHA-256**：`sha256Hex(buildEnvelope(state, '1').text)`

| 向量项 | 摘要口径 | 旧值（`358b111`） | 新值（`5bcc9ac` 权威值） | 变化原因 |
|---|---|---|---|---|
| 初始状态 | 状态规范 JSON SHA-256 | `79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4` | `79a773550beb088cf0462e0851b043c7b86ebd2bd0f3cbe3447dd4d6ca0a35f4` | **未变化** |
| 1 小时状态 | 状态规范 JSON SHA-256 | `bdfacdeb8d54b6c8f34665f48ae6337244491ae648cc70cfffc23768a97cab2a` | `8a882ec894b37d2b8eeb0f3941f79a533a8dd3bf59f804845c4cf1b79c95aa63` | 仅 `offline.settledUntilMs` 从起点更新为已结算游标 `1700003600000`；gold(`3116`)/big/cycles(`110`)/RNG 不变 |
| 1 小时 Envelope（内部） | Envelope 内部 `sha256` 字段 | —（旧版前端未单独断言） | `183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a` | 随 1h payload 更新 |
| 1 小时 Envelope（全文） | Envelope 全文 SHA-256（`offline-vectors.json` `envelopeSha256`） | `2c768fc2d368faa38b841e8b94c55d1e9398c80ff4e894a49cc2644b056ed5ee` | `4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6` | 随 1h payload 更新（注：任务书第八节曾将此值误标为“内部校验”，经 `vectors.test.ts:131` 核实为全文摘要） |
| 8 小时状态 | 状态规范 JSON SHA-256 | `7da517674df168ca5f88535b949f51a072982e77a0577b362811aa21c430839f` | `91bfd08b46447c204fd035bda989a0db3cc783eb86616b00de070884a300e4e9` | 新增 `FIGHTING` 阶段 `attemptLock`（`fish:970`）+ `offline.settledUntilMs` 更新；gold(`27911`)/cycles(`969`)/RNG 不变 |
| 24 小时状态 | 状态规范 JSON SHA-256 | `4f45cc728fbd4f6002913fdb182ce1284053e8864c106693fc5922f905f6cdff` | `2df326180ed98c4282fcfd921d328fc085517a6f2f4f299ca65496e052d061a0` | `offline.settledUntilMs` 更新至 `1700086400000`；gold(`85366`)/cycles(`2929`)/nodes(`14935`) 不变 |
| 24 小时 Envelope（内部） | Envelope 内部 `sha256` 字段 | — | `9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d` | 与后端 `SHARED_MODULE_HANDOFF.md` 及 Cocos 跨宿主探针一致 |
| 24 小时 Envelope（全文） | Envelope 全文 SHA-256（`perf.ts` `envelopeSha256`） | `88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536` | `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` | 与后端 `npm run test:perf` 实测完全一致 |

---

## 5. FE-000-R1 原有整改成果保护复核（第六阶段）

| 整改项 | 集成后状态（开发方回归） | 证据 |
|---|---|---|
| `I01` 生命周期（Web 真实打包产物） | **通过**：`System.import` 直接验证 `HIDE/SHOW`、去重、局部退订、异常隔离与 `dispose`；真实 `visibilitychange` 落盘 + `Page.reload()` 恢复；新增 `CORRUPT` 启动 fail-closed 零覆盖 | `logs/phase7-verify-web.log`（`21/21`） |
| `I02` 微信分包产物 | **通过（静态审计）** / **BLOCKED（微信运行态）**：全新构建 `41 文件 / 1948.33 KB`（主包 `1945.79 KB`，分包 `subpackages/spike-pack/` 7 文件 `2.54 KB`），`game.json`、`game.js`、`config.json`、`manifest`、`313B PNG`、`src/settings.json` 10/10 通过 | `evidence/wechat-integrated-audit.json`、`logs/phase7-build-wechat.log` |
| `I03` 时钟边界 | **通过**：无单调时钟冻结 +48h、回拨冻结与恢复、离线 +48h 钳制至 8h | `logs/phase7-frontend-tests.log`、`logs/phase7-verify-web.log` |
| `I04` 广告单实例与清理 | **通过（Mock/实验桩）** / **BLOCKED（真实微信广告）**：同请求单实例、`load/show` 拒绝解绑、重复回调防重、5 场景桩零资产篡改 | `logs/phase7-frontend-tests.log`、`logs/phase7-verify-web.log` |
| `I05` 资源释放 | **通过**：局部 `unsubscribe()` 保持兄弟存活；两套件在正常及订阅后注入异常退出时 `MOCK-WX` 与 `MOCK-DOM` 原始监听计数均归零 | `logs/phase7-frontend-tests.log` |
| `I06` 完整客户端类型检查 | **通过（需先生成 `cc.d.ts`）**：覆盖启动/UI/平台/共享桥接，`EXIT=0`；前端 `tsconfig.typecheck.json` 沿用历史 `strict: false`（已如实记录，不宣称全前端严格模式） | `logs/phase7-frontend-typecheck.log` |
| `V01–V03` 门禁与证据 | **通过**：零用例（`--files=`）与缺文件负向均 `EXIT=1`；真构建产物双目标回归；6 级宿主严格区分；历史证据零覆盖 | `logs/phase7-zero-test-*.log`、`reports/integration/FE-000-R1-INTEGRATION/` |
