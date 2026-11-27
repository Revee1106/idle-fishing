# FE-000-R1-INTEGRATION 测试报告（TEST_REPORT）

## 1. 测试元信息与环境

| 字段 | 实测值 |
|---|---|
| 任务 | `FE-000-R1-INTEGRATION` |
| 集成工作区 / 分支 | `E:\idle-fishing-integration` / `integration/fe-000-be-r1` |
| 前端基准 `HEAD` | `be62996fae44df24094331d670f6f0ab3741a4f2` |
| 后端目标 `MERGE_HEAD` | `5bcc9accfe6dfd60e0da0de0fa44bde9dc88f355`（未提交合并状态） |
| 操作系统 / Git | Windows 10.0.19045 x64 / Git `2.50.1.windows.1` |
| Node / npm / TS | Node `v24.20.0` / npm `11.4.2` / TypeScript `5.9.3` |
| Cocos Creator / Chrome | Cocos Creator `3.8.8` / Google Chrome `158.0.8127.37` |
| 微信开发者工具 / 真机 / 广告 | 微信开发者工具 `2.01.2510280`（CLI 服务端口关闭、`touristappid`）；无真机、无正式 `adUnitId` |

---

## 2. 第一阶段：旧版前端基线实测结果（集成前，`be62996` + `358b111`）

在合并 `5bcc9ac` 之前，于全新工作区 `E:\idle-fishing-integration` 直接基于 `be62996` 执行完整基线复测（历史 `reports/frontend/FE-000/evidence/` 已完整保留未覆盖）：

| 命令 | 退出码 | 实际结果 | 实测宿主 | 日志 / 证据 |
|---|---:|---|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | `0` | 按锁文件离线/锁定安装成功 | Node | `logs/phase1-npm-ci.log` |
| `npm run build:cocos` | `0` | 生成 `358b111` 产物（`9 .js + 9 .d.ts`、`9 .mjs + 9 .d.ts`） | Node | `logs/phase1-build-cocos-core.log` |
| `npm --prefix apps/game-client run typecheck`（首次构建前） | **`2`（失败）** | **原有基线发现**：全新工作区尚未运行 Cocos，`temp/declarations/cc.d.ts` 不存在，报 `TS2307: Cannot find module 'cc'`（非新版后端问题） | Node (`tsc`) | `logs/phase1-typecheck.log` |
| `npm --prefix apps/game-client run test:frontend` | `0` | **7/7 PASS**（`925.19 ms`，匹配 `358b111` 向量） | Node / Mock | `logs/phase1-test-frontend.log` |
| `npm --prefix apps/game-client run build:web` | `0`（Cocos `36`） | 生成 `web-mobile`（36 文件 `2024.74 KB`）并生成 `temp/declarations/cc.d.ts` | Cocos CLI `3.8.8` | `logs/phase1-build-web.log` |
| `npm --prefix apps/game-client run typecheck`（构建后） | `0` | **0 errors**（`cc.d.ts` 就绪后通过） | Node (`tsc`) | `logs/phase1-typecheck-after-build.log` |
| `npm --prefix apps/game-client run verify:web` | `0` | **18/18 PASS**（1h 摘要 `bdfacdeb...`，24h 单次 `74.1 ms` / 分片 max `4.0 ms`） | Chrome 158 CDP | `logs/phase1-verify-web.log`、`evidence/phase1-baseline/phase1-web-results.json` |
| `npm --prefix apps/game-client run build:wechat` | `0`（Cocos `36`） | 生成 `wechatgame`（41 文件 `1936.20 KB`） | Cocos CLI `3.8.8` | `logs/phase1-build-wechat.log` |
| `verify-wechat-build.mjs` | `0` | **10/10 PASS**（主包 `1933.67 KB`，分包 `2.54 KB`） | Node 静态审计 | `logs/phase1-verify-wechat.log`、`evidence/phase1-baseline/phase1-wechat-audit.json` |
| 合并 `5bcc9ac` 后、前端适配前 `test:frontend`（RED 对照） | **`1`（预期失败）** | 旧前端 1h/8h/24h 向量断言在新版 `5bcc9ac` 上失败，证明运行时已切换至 `5bcc9ac` | Node | `logs/phase3-pre-adapt-frontend-test.log` |

---

## 3. 第七阶段：新版集成全量回归结果（`be62996` + `MERGE_HEAD 5bcc9ac` + 6 项前端适配）

执行前已删除旧 `apps/game-client/build/web-mobile` 与 `apps/game-client/build/wechatgame` 目录，确保 100% 全新构建（时间戳见下表）。

| 命令 | 退出码 | 实际用例 / 断言数 | 实测宿主 | 日志 / 证据 |
|---|---:|---|---|---|
| `npm run verify` | `0` | 后端 `typecheck` + `build:cocos`（`9 .mjs + 9 .d.mts`）+ `typecheck:cocos` + **82/82 PASS**（`3075.86 ms`） | Node (`v24.20.0`) | `logs/phase7-backend-verify.log` |
| `npm run test:perf` | `0` | 24h `14,935` 节点，5/5 一致性 `true`；连续 `74.987 ms`、600s `75.806 ms`、60s `77.275 ms`、budget64 `67.682 ms`、checkpoint `111.987 ms`；`envelopeSha256=0be078f1...` | Node (`v24.20.0`) | `logs/phase7-backend-perf.log` |
| `npm run typecheck:cocos` | `0` | 严格消费 `dist/cocos/spike/index.mjs` + `.d.mts`，**0 errors** | Node (`tsc 5.9.3`) | `logs/phase7-typecheck-cocos.log` |
| `node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs` | `0` | 独立审核反例 A1–A8 **8/8 PASS**（`384.22 ms`） | Node (`v24.20.0`) | `logs/phase7-review-a1-a8.log` |
| `npm --prefix apps/game-client run typecheck` | `0` | 完整客户端（启动/UI/平台/共享桥接）**0 errors**（沿用 `strict: false`） | Node (`tsc 5.9.3`) | `logs/phase7-frontend-typecheck.log` |
| `npm --prefix apps/game-client run test:frontend` | `0` | **10/10 PASS**（原有 7 项 + 新增 3 项兼容性测试，`623.80 ms`） | Node / `MOCK-WX` / `MOCK-DOM` / `NODE-MEMORY` | `logs/phase7-frontend-tests.log` |
| `node tests/frontend/fe-000/run-node-tests.mjs --files=` | **`1`** | 零用例硬门禁触发（符合预期） | Node | `logs/phase7-zero-test-empty.log` |
| `node tests/frontend/fe-000/run-node-tests.mjs --files=missing.test.ts` | **`1`** | 缺失测试文件硬门禁触发（符合预期） | Node | `logs/phase7-zero-test-missing.log` |
| `npm --prefix apps/game-client run build:web` | `0`（Cocos `36`） | 全新构建 `36 文件 / 2,085,752 B (2036.87 KB)`，`mtime=2026-11-26T09:37:41+08:00` | Cocos CLI `3.8.8` | `logs/phase7-build-web.log`、`evidence/web-build-manifest.json` |
| `npm --prefix apps/game-client run verify:web` | `0` | **21/21 PASS**（原有 18 项 + 新增 3 项），`0` 控制台错误、`0` 未捕获异常 | Cocos Web 实际产物（Chrome 158 CDP） | `logs/phase7-verify-web.log`、`evidence/web-integrated/r1-green-web-results.json`、4 张 `.png` |
| `npm --prefix apps/game-client run build:wechat` | `0`（Cocos `36`） | 全新构建 `41 文件 / 1,995,089 B (1948.33 KB)`，主包 `34 文件 / 1945.79 KB`，分包 `subpackages/spike-pack/` `7 文件 / 2.54 KB`，`mtime=2026-11-26T09:39:57+08:00` | Cocos CLI `3.8.8` | `logs/phase7-build-wechat.log` |
| `verify-wechat-build.mjs` | `0` | **10/10 PASS**（`game.json`、`game.js`、`config.json`、`spike-pack-v1`、`313B PNG`、`src/settings.json`） | 微信构建产物静态审计 | `logs/phase7-verify-wechat.log`、`evidence/wechat-integrated-audit.json` |
| `echo N \| cli.bat islogin` | `0`（未开启端口退出） | 实测确认微信开发者工具服务端口关闭 | WeChat DevTools `2.01.2510280` | `logs/phase7-wechat-cli-check.log` |

---

## 4. 第四阶段 7.4：历史 `358b111` 实验存档在 `5bcc9ac` 上的兼容性实测

样本全部在第一阶段合并前由 `358b111` 真实生成并保存于 `evidence/legacy-358b111-saves.json`，升级至 `5bcc9ac` 后逐项通过 `SpikeFileSaveRepository.load()`、`validateSpikeState()`、`advanceOffline(+60s)` 与 `commit()` 验证（实测记录见 `evidence/legacy-358b111-compat-results.json` 与 `[NODE/COMPAT-LEGACY-358B111]`）：

| 历史 `358b111` 存档场景 | 原始特征（`358b111`） | `5bcc9ac` `load()` | `validateSpikeState()` | 推进 `+60s` 后行为 | `commit(rev 2)` | 结论 |
|---|---|---|---|---|---|---|
| `IDLE` | `stage=IDLE`, `settledUntilMs=1700000000000` | `VALID` (`rev=1`) | `0` 问题 | 推进至 `FIGHTING`（自动生成 `attemptLock`），`gold: 0->31`，`settledUntilMs->1700000060000` | `COMMITTED` (`rev=2`) | **兼容 PASS** |
| `FIGHTING`（8h） | `stage=FIGHTING`，**无 `attemptLock`**，旧 `settledUntilMs=1700000000000` | `VALID` (`rev=1`) | `0` 问题 | `offline.ts` 安全回退使用 `fish:<seq>` 结算当前战斗（不重复发奖），`gold: 27911->27974`，`settledUntilMs->1700028860000` | `COMMITTED` (`rev=2`) | **兼容 PASS**（已记录 `attemptLock` 缺失回退行为） |
| `PREPARING` | `stage=PREPARING`，已含 `fish:1`，旧 `settledUntilMs=1700000000000` | `VALID` (`rev=1`) | `0` 问题 | 推进不重复发放 attempt #1 奖励，正常进入后续周期，`settledUntilMs->1700000087000` | `COMMITTED` (`rev=2`) | **兼容 PASS** |
| `POST_DEADLINE` | `cursorMs > deadlineMs`，旧 `settledUntilMs=1700000000000` | `VALID` (`rev=1`) | `0` 问题 | 钓鱼节点数 `0`，`gold` 保持 `85366` 不变，`settledUntilMs` 修正冻结至 `deadlineMs=1700086400000` | `COMMITTED` (`rev=2`) | **兼容 PASS** |
| `CORRUPT_WITH_VALID_BACKUP` | 槽 0 有效 `rev=1`，槽 1 损坏 `rev=2` | `VALID`（`recovered=true`, `rev=1`） | `0` 问题 | 隔离损坏槽 1，成功回退恢复槽 0 备份（`gold=0, stage=IDLE`） | N/A | **兼容 PASS** |

---

## 5. Node vs Cocos Web 确定性与 24h 性能对照

| 维度 | Node（`npm run test:perf` / `test:frontend`） | Cocos Web 实际产物（Chrome 158 CDP） | 一致性 |
|---|---|---|---|
| 初始状态 SHA-256 | `79a77355...0a35f4` | `79a77355...0a35f4` | **完全一致** |
| 1h 状态 SHA-256 | `8a882ec8...95aa63` | `8a882ec8...95aa63` | **完全一致** |
| 1h Envelope 内部 `sha256` | `183ed74c...10681a` | `183ed74c...10681a` | **完全一致** |
| 1h Envelope 全文 SHA-256 | `4e1d068a...6d1ddd6` | `4e1d068a...6d1ddd6` | **完全一致** |
| 8h 状态 SHA-256 & `attemptLock` | `91bfd08b...00e4e9` (`fish:970`) | `91bfd08b...00e4e9` (`fish:970`) | **完全一致** |
| 24h 状态 SHA-256 | `2df32618...2d061a0` | `2df32618...2d061a0` | **完全一致** |
| 24h Envelope 内部 `sha256` | `9ed7cded...717e1d` | `9ed7cded...717e1d` | **完全一致** |
| 24h Envelope 全文 SHA-256 | `0be078f1...0ae69f` | `0be078f1...0ae69f` | **完全一致** |
| 24h 节点 / 周期 / 金币 | `14,935` / `2,929` / `85366` | `14,935` / `2,929` / `85366` | **完全一致** |
| 24h 耗时参考（非真机预算） | 连续 `74.987 ms`；60s 切片 `77.275 ms`；heap `26.10 MB` / RSS `93.66 MB` | 单次 `80.2 ms`；60 片纯计算 `139.0 ms`（max `4.4 ms`，avg `2.317 ms`）；墙钟 `2413.1 ms`；`jsHeap=25.90/46.02 MB`；rAF 73 采样 avg `32.42 ms` / max `50.0 ms` | 桌面参考值 |

---

## 6. 六级平台证据区分矩阵（严禁混同）

| 层级 | 环境 | 本轮状态 | 实测结论与未执行原因 |
|---|---|---|---|
| 1 | **Node / Mock** | **已执行并通过** | 后端 82/82 + A1–A8 8/8 + 前端 10/10（含 `MOCK-WX`/`MOCK-DOM`/`NODE-MEMORY` 与 358b111 兼容） |
| 2 | **Cocos Web 实际运行** | **已执行并通过** | `build/web-mobile` 在 Chrome 158 下 **21/21 PASS**，0 错；含 4 张实跑截图 |
| 3 | **微信静态构建产物** | **已执行并通过** | `build/wechatgame` 41 文件，分包注册/入口/清单/资源 **10/10 PASS** |
| 4 | **微信开发者工具运行** | **`BLOCKED`** | 工具已安装（`2.01.2510280`），但 CLI 服务端口关闭且无正式 AppID / 登录态（`logs/phase7-wechat-cli-check.log`） |
| 5 | **微信真机运行** | **`BLOCKED`** | 无代表性中低端手机及正式测试 AppID，无法实测真机 FS、强退恢复、时钟单位与 24h 真机性能 |
| 6 | **真实广告 SDK 运行** | **`BLOCKED`** | 无正式微信小游戏 `adUnitId` 与真机环境，仅验证 Mock SDK 适配器与 `EXPERIMENTAL_STUB` |

---

## 7. 集成后真实 Web 运行截图索引
1. [r1-green-overview.png](evidence/web-integrated/r1-green-overview.png)（Page 1：`@idle-fishing/game-core (5bcc9ac)` 与 1h 状态摘要 `8a882ec8...`）
2. [r1-green-modal.png](evidence/web-integrated/r1-green-modal.png)（动态弹窗展示 `Core: 5bcc9ac` 与 `8h Lock: true`）
3. [r1-green-platform.png](evidence/web-integrated/r1-green-platform.png)（Page 2：6 项 FS/Save 含未知槽 `UNCERTAIN`、生命周期/时钟/广告桩、本地分包加载）
4. [r1-green-perf24h.png](evidence/web-integrated/r1-green-perf24h.png)（24h 单次 `80.2ms` / 60 分片 max `4.4ms` 与新终态摘要 `2df32618...`）
