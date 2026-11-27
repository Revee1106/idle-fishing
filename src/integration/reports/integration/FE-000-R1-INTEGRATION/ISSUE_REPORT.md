# FE-000-R1-INTEGRATION 问题、发现与归属报告（ISSUE_REPORT）

> 说明：本报告仅记录本次集成中实测发现的问题、差异与阻塞项，明确责任归属。本轮未越权修改任何已审核后端源码、设计文档、公共契约、正式数值或根工程配置。

## 1. 本轮发现问题汇总表

| 编号 | 类别 / 严重度 | 问题描述 | 责任归属 | 状态 | 依据 |
|---|---|---|---|---|---|
| `INT-ISS-01` | 前端工程 / 中 | 在全新干净工作区（如 `git worktree add`）首次执行 `npm --prefix apps/game-client run typecheck` 时，因尚未执行过 Cocos 导入/构建，`apps/game-client/temp/declarations/cc.d.ts` 尚不存在，导致报 `TS2307: Cannot find module 'cc'`（`EXIT=2`）；执行一次 `build:web` 生成 `cc.d.ts` 后 `typecheck` 即返回 `EXIT=0` | 前端基线原有问题（`be62996` 继承，**非**新版后端引入） | **OPEN（需在说明文档明确构建顺序；后续由负责人决定是否在 CI 提供 `cc.d.ts` 生成步骤）** | `logs/phase1-typecheck.log` vs `logs/phase1-typecheck-after-build.log` |
| `INT-ISS-02` | 前端文档 / 低 | `apps/game-client/scripts/build-cocos.mjs` 实际读取环境变量 `COCOS_CREATOR_EXE`，而历史交接文档 `reports/frontend/FE-000/PLATFORM_HANDOFF.md` 曾写作 `COCOS_CREATOR_PATH` | 前端文档（`be62996` 历史文档） | **OPEN（以实际脚本 `COCOS_CREATOR_EXE` 为准，本轮集成交接已纠正说明；未修改历史 FE-000 报告）** | `apps/game-client/scripts/build-cocos.mjs:30` |
| `INT-ISS-03` | 前端兼容性 / 高 | `BootEntry.ts` 在 `be62996` 中将 `persistRepo.load()` 的非 `VALID` 结果（含 `CORRUPT`、`UNSUPPORTED`）统一归入 `else` 分支创建新初始状态，且未对 `commit()` 的 `UNCERTAIN` 结果做写入冻结，不符合 `5bcc9ac` 及设计 12 的 fail-closed 要求 | 前端适配层（`BootEntry.ts`） | **FIXED（本轮已修复并经真实 Web 产物 `web_corrupt_save_fail_closed_no_overwrite` 实测通过）** | `apps/game-client/assets/scripts/bootstrap/BootEntry.ts`、`logs/phase7-verify-web.log` |
| `INT-ISS-04` | 任务书/文档口径 / 低 | 任务书第八节参考表中将 `4e1d068a64ce1ad30f8aed07dc9671b6f3bbcfea0b2250d36d6c4441c6d1ddd6` 标注为“1小时Envelope内部校验”；经核验后端 `tests/backend/be-000/vectors.test.ts:131` 与 `offline-vectors.json:47`，该值实为 `sha256Hex(buildEnvelope(s1h,'1').text)`（1h Envelope **全文摘要**），而 1h Envelope **内部 `sha256` 字段**为 `183ed74c32d759e434345eb7fe152eec1192f8ea69637cf60e657d629010681a` | 文档标注口径（非代码缺陷） | **INFO / CLARIFIED（代码与测试已严格区分三类摘要并全部校验通过）** | `logs/phase4-legacy-probe.log`、`logs/phase7-frontend-tests.log` |
| `INT-ISS-05` | 前端类型配置 / 中 | `apps/game-client/tsconfig.typecheck.json` 仍沿用 `be62996` 基线的 `strict: false`、`noImplicitAny: false` | 前端工程配置（历史遗留限制） | **OPEN（已如实记录，不宣称完成全前端严格模式验收；后端 `typecheck:cocos` 严格模式已通过）** | `apps/game-client/tsconfig.typecheck.json` |
| `INT-ISS-06` | 审核材料同步 / 信息 | 家庭电脑生成的 `BE-000-R1` 及 `P2` 独立复审原件尚未同步到公司电脑 `E:\idle-fishing-review` | 负责人/审核工作区同步 | **OPEN（已如实记录，未伪造历史审核原件）** | `E:\idle-fishing-review` 只读核查 |
| `INT-ISS-07` | 历史实验存档语义观察 / 信息 | `358b111` 生成的 `FIGHTING` v2 实验存档不含 `attemptLock`，在 `5bcc9ac` 上可 `VALID` 加载并依靠 `offline.ts:320` 回退至 `fish:<seq>` 正常结算；但正式游戏上线前若发生跨版本存档结构变更，仍需设计方批准正式迁移协议与字节格式（`BE-D01`） | 设计方 / 后端（当前仅 Spike 实验数据，非正式线上用户数据） | **INFO（全部 5 类 `358b111` 历史样本均已实测兼容通过）** | `evidence/legacy-358b111-compat-results.json` |

---

## 2. 真实平台阻塞项（`BLOCKED` / `NOT_RUN`，归属 `GATE-01` 联合验收）

| 编号 | 影响范围 | 当前状态 | 阻塞原因 | 负责人需提供的解锁条件 |
|---|---|---|---|---|
| `INT-BLK-01` | 微信开发者工具运行与分包运行时加载（`T01`/`T10`） | **`BLOCKED`** | 本机微信开发者工具 `2.01.2510280` CLI 服务端口关闭（`logs/phase7-wechat-cli-check.log`），无开发者登录态与正式 AppID（当前 `touristappid`） | 手动开启 IDE `设置 -> 安全设置 -> 服务端口`，登录开发者账号，提供正式测试 AppID |
| `INT-BLK-02` | 微信真机文件系统、强杀进程恢复与时钟单位验证（`T04`/`T05`/`T08`） | **`BLOCKED`** | 无可用代表性真机（Android/iOS）与正式测试 AppID | 提供测试真机与真机预览/体验版权限，实测 `wx.getFileSystemManager()`、`wx.onHide` 强退恢复与 `wx.getPerformance().now()` 实际单位 |
| `INT-BLK-03` | 中低端微信真机 24h 性能、帧耗时与 5x 压力负载（`T06`/`BE-D02`/`FE-D01`） | **`BLOCKED` / `NOT_RUN`** | 无代表性真机设备，正式性能预算与 5x 压力标准夹具尚未由设计方/负责人批准 | 提供代表性设备并批准正式性能预算与 5x 夹具 |
| `INT-BLK-04` | 真实微信激励视频广告 SDK 流程（`T09`） | **`BLOCKED`** | 无正式微信小游戏 `adUnitId` 与真机环境 | 申请并下发测试/正式 `adUnitId` 在真机复测 |

---

## 3. 架构与权限边界核对结论
- **未修改任何后端受保护文件**：对比 `5bcc9ac`，`packages/`、`tests/backend/`、`reports/backend/`、`package.json`、`package-lock.json`、`tsconfig*.json`、`docs/`、`config/` 均 **0 差异**。
- **未修改原有 4 个工作区**：`E:\idle-fishing`、`E:\idle-fishing-backend`、`E:\idle-fishing-frontend`、`E:\idle-fishing-review` 全部保持原状。
- **未提交、未推送、未合并 `main`、未启动 `BE-001` / `FE-001`**。
