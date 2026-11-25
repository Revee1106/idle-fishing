# BE-000-R1 测试报告（TEST_REPORT）

- 分支：`r1/be-000`
- 基准：`358b11105cfdee9bd076049c86a34d8f0aaa00e7`
- 实际候选：未提交工作区（逐文件 SHA-256 见 `FILES.sha256`）
- 日期：2026-11-25
- 宿主：Windows 10.0.19045 x64 / Git Bash / Node v24.20.0 / npm 11.4.2 / TypeScript 5.9.3 / Cocos Creator 3.8.8
- 结论：最终 `npm run verify` `EXIT=0`，**11 个测试文件、77/77 通过**；严格 Cocos 类型检查、共享构建、24h 性能、Cocos Web 与 Node 跨宿主对照均通过；微信真机与正式性能预算未测
- 原则：未删除测试、未放宽断言、未降低验收标准、未硬编码返回值；向量变化逐字段可复核

## 1. 一键复跑

```bash
npm install
npm run verify
```

`verify` = `typecheck` → `build:cocos` → `typecheck:cocos` → `test`。实测 `EXIT=0`，日志 `logs/r1-verify-final.log`。

单独执行：

```bash
npm run typecheck
npm run build:cocos
npm run typecheck:cocos
node --test "tests/backend/be-000/**/*.test.ts"
npm run test:perf
```

## 2. 汇总

| 项 | 结果 |
|---|---|
| TypeScript 类型检查（Node 测试配置） | 0 错误，EXIT=0 |
| 严格 Cocos 消费者类型检查 | 0 错误，EXIT=0 |
| 测试文件 | 11 |
| 测试总数 | 77 |
| 通过 | 77 |
| 失败 | 0 |
| 跳过 / todo / 取消 | 0 / 0 / 0 |
| 总耗时 | 3,323 ms（最终 verify 内测试段） |
| 共享构建 | `9 .mjs + 9 .d.mts`，EXIT=0 |
| 24h 性能脚本 | EXIT=0，五项一致性全部 `true` |
| Cocos 3.8.8 web-mobile | 构建日志 Finished；运行时与 Node 对照 PASS |
| 微信真机 / 真实文件系统 / 强退 / 广告 | 未执行（见第 9 节） |

测试文件与用例数：

| 文件 | 数量 | 覆盖 |
|---|---:|---|
| `canon-sha.test.ts` | 7 | 规范 JSON、Nat、UTF-8、SHA-256 与边界 |
| `cocos-artifact.test.ts` | 2 | `.mjs`/`.d.mts` 产物与说明符 |
| `d01-encoding.test.ts`（R1 新增） | 3 | 外层数组字节/摘要、转义、UTF-16 排序、无规范化 |
| `dist-artifact.test.ts` | 3 | 构建产物在 Node 运行与导出面 |
| `migration.test.ts` | 6 | v1→v2、非法档、进行中尝试（MIG-05/06） |
| `offline.test.ts` | 12 | 切片一致、检查点、截止前/时/后、夹具拒绝 |
| `prng.test.ts` | 7 | RNG-01/03、流隔离、U53 消耗 |
| `r1-regression.test.ts`（R1 新增） | 7 | 原审核反例的故障注入回归 |
| `save.test.ts` | 16 | 三槽、故障注入、冲突、幂等、真实文件系统 |
| `time.test.ts` | 9 | 微单位、积分、完成时间、安全加法 |
| `vectors.test.ts` | 5 | Math/RNG/离线/存档固定向量 |
| **合计** | **77** | |

## 3. 整改前证据（基准 358b111）

| 命令 | 退出码 | 结果 | 日志 |
|---|---:|---|---|
| `npm run verify` | 0 | 64/64 通过（原套件全绿） | `logs/pre-verify.log` |
| 审核 A1–A8 反例 | 1 | 1 通过 / 7 失败 | `logs/pre-review-a1-a8.log` |
| 严格 Cocos 类型审计 | 2 | `TS7016`，`.mjs` 无声明文件 | `logs/pre-cocos-type.log` |
| 自定义夹具诊断 | 0 | 静默使用默认夹具，`CASTING` | `logs/pre-fixture.log` |

A1–A8 的 7 项失败对应实现报告第 3 节 I01–I06；修复后同一脚本 `logs/r1-review-a1-a8.log` 为 8/8 通过（`EXIT=0`）。

## 4. 新增/改写用例与缺陷映射

| 用例 | 对应问题 | 断言要点 |
|---|---|---|
| `A1` / `R1-SAVE-01` | I01 未知槽 | 任一槽不可读时 `commit` 为 `UNCERTAIN`，写入次数为 0 |
| `A2` / `R1-SAVE-05` | I01 不可观察写 | 已落盘但目标变不可读，`resolveUncertainWrite` 保持 `UNCERTAIN` |
| `A3` / `R1-SAVE-03` / `SAVE-T06` | I01 冲突 | 同 revision 异内容、混合 epoch 均 `FAILED` 且不写 |
| `A4` / `R1-SAVE-02` | I02 单槽非法 | `payload:"null"` 只隔离该槽，有效备份可读 |
| `A5` / `R1-CHK-01` / `OFF-09` | I04 检查点 | 截止前/时/后持久化游标、奖励、RNG、检查点一致；越过截止冻结 |
| `A6` / `R1-TIME-01` / `TIME-09` | I06 溢出 | 完成时间、切片、环境检查在 `MAX_SAFE_INTEGER` 附近返回 `null` 或抛错 |
| `A7` | I04 同刻奖励 | 恰好截止完成的一次 FIGHTING 仍发一次奖 |
| `A8` / `SAVE-T05` | I03 重放 | 真实 FIGHTING 结算保存/加载/恢复只发一次奖；伪造已领取键被拒绝 |
| `MIG-05` / `MIG-06` | I05 进行中迁移 | 进度/锁/RNG 保留，旧槽可读，只结算一次；非法锁不改原字节 |
| `OFF-12` | I08 夹具收窄 | 传入 `fixture` 抛错，不再静默回退 |
| `COCOS-02` | I07 严格类型 | `.mjs`/`.d.mts` 仅用 `.mjs` 说明符，无 `.ts`/CJS/Node 内建 |
| `D01-01..03` | BE-D01 编码 | 独立 Python 复算的字节数/摘要一致；UTF-16 排序、无规范化 |

未删除旧用例；`SAVE-T07` 的断言从“零写入”修正为“先记录基线写入数，再断言不确定提交不新增写入”，因为初始提交本身已写过一次。

## 5. 故障注入覆盖

`tests/backend/be-000/helpers.ts` 的 `MemoryFilePort` 注入：

| 故障 | 用例 | 期望 |
|---|---|---|
| 写前抛错 | `SAVE-T04a` | `FAILED`，旧档可读 |
| 部分写后抛错 | `SAVE-T04b` | 损坏被识别，旧档不被覆盖 |
| 全写后抛错 | `SAVE-T04c` | 重扫确认 `COMMITTED` |
| 静默截断 | `SAVE-T04d` | 不报成功，旧档保留 |
| 目标槽读失败 | `R1-SAVE-01`、`R1-SAVE-05` | `UNCERTAIN`，零新写 |
| 单槽非法内容 | `R1-SAVE-02`、`SAVE-T02` | 隔离该槽，从备份恢复 |
| 同版本异内容 | `R1-SAVE-03`、`SAVE-T06` | `FAILED`，零写 |
| 混合 epoch | `SAVE-T08` | `CORRUPT`/`FAILED`，不写 |
| 全槽读失败 | `SAVE-T07` | 读取 `CORRUPT`；提交 `UNCERTAIN` 且不新增写 |
| 隐藏高 revision | `R1-SAVE-04` | 首次提交不得越过隐藏版本 |
| 真实文件系统 | `SAVE-T10` | 三槽轮换与回读 |

## 6. 24h 性能（Node 虚拟时钟）

命令：`npm run test:perf`，`EXIT=0`，日志 `logs/r1-perf.log`。

| 指标 | 实测 |
|---|---:|
| 节点 / 尝试 / 事件 / 环境检查 | 14,935 / 2,930 / 2,929 / 288 |
| 终态字节 | 35,006 |
| 连续推进 | 134.405 ms |
| 600s 切片 | 138.498 ms |
| 60s 切片 | 217.607 ms |
| 64 节点预算 | 149.51 ms |
| 检查点保存/加载/恢复 | 254.192 ms |
| 序列化 Envelope | 10.173 ms |
| RSS / heap | 92,995,584 B / 15,091,928 B |
| 连续/切片/预算/检查点终态一致 | 全部 `true` |
| 24h Envelope SHA-256 | `0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f` |

说明：这是单进程 Node 数据，不是真机帧时间或泄漏测量；正式预算未定（`BE000-R1-ISS-06`）。

## 7. 严格 Cocos 类型与跨宿主

严格类型：

```bash
npm run typecheck:cocos   # tsc -p tsconfig.cocos-consumer.json
```

结果 `EXIT=0`（`logs/r1-cocos-type.log`）。消费者 `tests/backend/be-000/cocos-type-consumer.mts` 从实际 `dist/cocos/spike/index.mjs` 导入并调用 `xoshiroStep`、`createInitialState`、`advanceOffline`、`buildEnvelope`。

Cocos 运行时：

- 临时工程：`%TEMP%/idle-fishing-be000-r1-cocos`（未修改 `apps/game-client`）。
- 构建日志：`build Task (web-mobile) Finished`；CLI `exit=36`（已知成功码）；`logs/r1-cocos-build.out`。
- 对照脚本：`evidence/runtime-cocos-r1.mjs`；结果 `logs/r1-cocos-runtime.log`。
- 探针：`xoshiroStep([1,2,3,4]) = 11520`，state `[7,0,1026,12288]`。
- Node/Cocos 24h Envelope：均 `9ed7cded1c1d5391691c9172e837c36915fb94605b1aaf19f2afea856e717e1d`。
- gold `85366`，big `361604935017160493501716049349810`，19 项 Math 向量一致，`result: PASS`。

## 8. 向量与独立推导

| 项 | 证据 |
|---|---|
| 旧 fixture 保留 | `evidence/vectors/offline-vectors.pre-r1.json` |
| 新旧逐字段比较 | `evidence/make-r1-vectors.mjs`，日志 `logs/r1-vectors.log` |
| 允许变化 | 1h：`offline.settledUntilMs`；8h：`attemptLock` + `offline.settledUntilMs` |
| 初始向量 | 不变 `79a77355…0a35f4` |
| D01 本地向量独立复算 | `evidence/d01-independent.py`，日志 `logs/r1-d01-python.log` |
| D01 发布向量 G01/G02 | 输入 payload 未提供，未复算，见 `ISSUE_REPORT.md` `BE000-R1-ISS-02` |

## 9. 未执行项与原因

| 项 | 原因 |
|---|---|
| 微信开发者工具、真机 `FileSystemManager` 三槽/错误码 | 前端与真机环境，本轮后端不可单方验收 |
| 强退、时间回退、真实前后台 | 同上 |
| 真实广告适配器与去重 | 前端范围 |
| 真机 24h 耗时/内存/帧阻塞、5× 压力负载 | 无代表设备与批准预算（BE-D02） |
| 正式存档格式字节级验收 | BE-D01 仅 Spike，等待设计方正式格式 |
| G01/G02 摘要复算 | 发布材料缺 payload 原文 |

## 10. 证据索引

R1 的 14 份日志已用 `git add -f` 纳入本次提交；`r1-cocos-build.out` 中的 `Proxy-Authorization` 值已替换为 `[REDACTED]`。校验值见 `LOGS.sha256`。

- 最终全套：`logs/r1-verify-final.log`；阶段全套（74 项）：`logs/r1-verify.log`
- 整改前全套：`logs/pre-verify.log`；审核反例：`logs/pre-review-a1-a8.log`；修复后：`logs/r1-review-a1-a8.log`
- 性能：`logs/r1-perf.log`
- 严格类型：`logs/r1-cocos-type.log`、`logs/pre-cocos-type.log`
- Cocos 构建/运行：`logs/r1-cocos-build.out`、`logs/r1-cocos-runtime.log`
- 夹具：`logs/pre-fixture.log`、`logs/r1-fixture.log`
- 向量：`logs/r1-vectors.log`、`logs/r1-d01-python.log`