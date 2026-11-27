# BE-000 测试报告（TEST_REPORT）

- 分支：`feature/be-000`
- 基线：`2106ce19d991ec47555cdbf207454c36d8cd104a`
- 日期：2026-11-25
- 结论：后端自动化 **64/64 通过**；Node 构建、Cocos `.mjs` 产物构建与运行时探针通过；微信真机、帧阻塞、广告项未执行
- 原则：未删除测试、未降低断言、未硬编码返回值；所有测试均可由仓库命令复跑

## 1. 一键复跑

```bash
npm install
npm run verify
```

`verify` = `typecheck` → `build:cocos` → `test`。实测 `EXIT=0`。

单独执行：

```bash
npm run typecheck
npm run build:cocos
node --test "tests/backend/be-000/**/*.test.ts"
npm run test:perf
```

## 2. 汇总

| 项 | 结果 |
|---|---|
| TypeScript 类型检查 | 0 错误，EXIT=0 |
| 测试套件 | 10 个测试文件 |
| 测试总数 | 64 |
| 通过 | 64 |
| 失败 | 0 |
| 跳过 / todo / 取消 | 0 / 0 / 0 |
| 总耗时 | 3,044 ms |
| 共享构建 | `9 .mjs + 9 .d.ts`，EXIT=0 |
| 24h 性能脚本 | EXIT=0，全部一致性检查 `true` |
| Cocos 3.8.8 web-mobile | 构建成功，运行时应答固定向量 |
| 微信开发者工具/真机 | NOT_RUN |
| 广告 | NOT_RUN |

原始日志（本地，根 `.gitignore` 忽略）：`reports/backend/BE-000/logs/test.log`、`typecheck.log`、`build-cocos.log`、`perf.log`；报告生成后再次执行 `npm run verify`，`EXIT=0`，64/64 通过，日志 `verify-final.log`。

## 3. 分套件结果

### 3.1 `prng.test.ts`（RNG-01…07）

| 用例 | 断言要点 | 结果 |
|---|---|---|
| RNG-01 | 文档向量 `[11520,0,5927040,70819200,2031721883]`，终态 `[15224335,29364750,272377353,1125134346]` | PASS |
| RNG-02 | `wait/species/environment` 流派生与固定值一致；流独立 | PASS |
| RNG-03 | U53 wait 流前 10 个固定值（0.2187637452505511 起），全部 `[0,1)` | PASS |
| RNG-04 | 导出规范 JSON、恢复后 50 次抽取与不中断完全一致 | PASS |
| RNG-05 | 抽其他流不改变 wait 流 | PASS |
| RNG-06 | 每次 U53 恰好两次 32 位步进 | PASS |
| RNG-07 | 非法根种子拒绝 | PASS |

### 3.2 `canon-sha.test.ts`（CANON-01…04、SHA-01…03）

- UTF-16 键排序与数组顺序；拒绝 NaN/Infinity/undefined/-0/裸 bigint/非安全整数/危险键。
- Nat 十进制规范（前导零、负号、非数字拒绝）。
- UTF-8 编码与 Node `Buffer` 对 ASCII、CJK、emoji、代理对逐字节一致。
- SHA-256 与 `node:crypto` 在空串和 55/56/63/64/65/119/120 字节边界一致；二进制输入一致；键插入顺序不影响规范 payload 哈希。
- 7 个用例全部 PASS。

### 3.3 `time.test.ts`（TIME-01…09）

- `round(ms*1e6)`；极小正数不为 0；速率量化为百万分之一且不低于 1。
- `ceilDiv` 在整除与非整除下精确；完成时刻精确到毫秒；剩余量丢弃。
- 分片积分等于连续积分；`completionTimeMs` 与 `integrateWork` 一致；不安全跨度拒绝。
- Nat × 浮点倍率按 `(v*q+500000)/1e6`，支持 floor/ceil。
- BigInt 超过 `Number.MAX_SAFE_INTEGER` 仍可规范往返；非法毫秒拒绝。
- 9 个用例全部 PASS。

### 3.4 `save.test.ts`（SAVE-T01…T12）

使用内存端口注入故障，另有真实临时目录用例：

| 用例 | 场景 | 结果 |
|---|---|---|
| T01 | 三槽轮换，最高 revision 不被覆盖 | PASS |
| T02 | 最新槽截断/哈希错误回退低槽；全坏 CORRUPT 且不静默新建 | PASS |
| T03 | 最新槽 schema 未知 → UNSUPPORTED，不回退、不覆盖 | PASS |
| T04a | 写入前抛异常 → FAILED，旧档可读 | PASS |
| T04b | 半写后抛异常 → FAILED，识别为损坏，旧档可读 | PASS |
| T04c | 完整写后抛异常 → 重扫认领为 COMMITTED | PASS |
| T04d | 静默短写 → 不报成功，旧档不丢 | PASS |
| T04e | 写入结果不可观测 + 并发更高 revision → UNCERTAIN | PASS |
| T05 | 已提交奖励重载后不重复发放 | PASS |
| T06 | revision/epoch 冲突拒绝且不写 | PASS |
| T07 | 三槽读取全失败 → CORRUPT；提交不猜测 revision | PASS |
| T08 | 有效槽 epoch 混合 → CORRUPT | PASS |
| T09 | EMPTY 才允许首次提交；已有档时 `expectedRevision=null` 冲突 | PASS |
| T10 | 真实临时文件系统三槽轮换 | PASS |
| T11 | v1 Envelope 载入为 VALID + schema 1 | PASS |
| T12 | 未确认写入后回滚，旧 revision 仍可载入 | PASS |

16 个用例全部 PASS。

### 3.5 `migration.test.ts`（MIG-01…04）

- v1 载入 → 迁 v2 → 以 revision 2 提交，旧槽仍保留 v1。
- 非法 v1 拒绝且不触盘；不支持路径拒绝；同版本迁移返回独立深拷贝。
- 自测修复：v1 输入曾被“同版本深拷贝”分支误接受；现显式要求 `schemaVersion === 2`，MIG-03 断言实际错误消息。这是实现缺陷修复，不是降低断言。
- 4 个用例全部 PASS。

### 3.6 `offline.test.ts`（OFF-01…11）

| 用例 | 场景 | 结果 |
|---|---|---|
| OFF-01 | 8h 连续 vs 60s/37s 切片，规范状态逐字节相同 | PASS |
| OFF-02 | 中途存档/加载/恢复后继续，最终状态一致 | PASS |
| OFF-03 | `maxNodes=3` 预算切片结果一致 | PASS |
| OFF-04 | 截止时刻及之后不开新尝试；世界环境继续 | PASS |
| OFF-05 | 超大 BigInt 经规范 JSON 往返 | PASS |
| OFF-06 | RNG 流按需创建、命名正确、推进后有效 | PASS |
| OFF-07 | 活动速率在假数据带内并随时间变化 | PASS |
| OFF-08 | 尝试序号单调；每个终止尝试只 claim 一次 | PASS |
| OFF-09 | 同刻截止不留下半完成阶段 | PASS |
| OFF-10 | 输入状态不被修改 | PASS |
| OFF-11 | 三角分位数边界与均值近似 | PASS |

11 个用例全部 PASS。

### 3.7 `vectors.test.ts`（VEC-01…05）

- Math 固定用例：`Math.imul`、`sqrt`、`round`、大整数安全边界。
- 独立 BigInt 实现的 `imul` 与运行时 `Math.imul` 一致（使用 `BigInt.asIntN` 处理有符号语义）。
- 精确平方根与 0.5 舍入（含 `-0`）稳定。
- RNG 固定向量与导出状态一致；离线/存档 fixture 的规范 JSON 哈希可复现。
- 5 个用例全部 PASS。

### 3.8 `dist-artifact.test.ts`（DIST-01…03）

- 动态导入构建后的 `dist/spike/index.js`，RNG-01 一致。
- 构建产物与源码产生相同离线状态。
- 导出面覆盖文档化 API。
- 3 个用例全部 PASS。

### 3.9 `cocos-artifact.test.ts`（COCOS-01…02）

- 导入 `dist/cocos/spike/index.mjs`，复现 RNG-01。
- 所有相对说明符均为 `.mjs`；无 CommonJS、无 `node:` 内建；`.d.ts` 已复制。
- 若产物缺失，测试给出明确构建命令后失败。
- 2 个用例全部 PASS。

## 4. 故障注入覆盖

注入点与行为：

- 写入前失败（`THROW_BEFORE`）
- 部分写后抛异常（`PARTIAL_THEN_THROW`）
- 完整写后抛异常（`WRITE_THEN_THROW`）
- 静默截断（`SILENT_TRUNCATE`）
- 读失败（单槽 / 全槽）
- 未确认写入 + 并发更高 revision
- revision 冲突、epoch 冲突
- 损坏槽、截断槽、哈希错误、未来 schema
- 真实文件系统轮换
- 旧 revision 回滚后重新载入

断言均检查“旧有效档仍可读”“奖励不重复”“不静默新建”“不覆盖高 revision”。

## 5. 24h 离线性能

命令：`npm run test:perf`（EXIT=0）。

```text
24h nodes=14935 attempts=2930 events=2929 envChecks=288
state=35006 bytes continuous=104.701ms 600s-slices=149.861ms 60s-slices=164.598ms budget64=147.311ms
checkpoint=362.896ms serialize=7.378ms
checks: continuous/sliced600/sliced60/budget/checkpoint 全部 true
envelopeSha256=88cb5751c258baec38c452814d5653bb2535029ab7e21c762603e10310ff8536
RSS=98,873,344 B heapUsed=27,080,656 B
```

说明：

- 虚拟时钟 + Spike 假事件，不代表正式数值。
- 未测 Cocos 帧阻塞、微信真机、低端机；不宣称真机性能通过。
- 单进程内存数据不是泄漏结论。
- 正式阈值与负载需设计方在结果后确认。

## 6. Cocos 3.8.8 构建与运行验证

非仓库工程，临时副本中执行（未改动 `apps/game-client`）：

1. `npm run build:cocos` 生成 `dist/cocos/spike/*.mjs`。
2. 复制整目录到临时工程 `assets/be000mjs/`。
3. 组件中显式导入：`from '../be000mjs/index.mjs'`。
4. 命令行构建 web-mobile。

结果：

- `.js` 作为 Cocos 资源失败：`canonical-json.js ... ENOENT`，CLI `exit=34`。
- 省略扩展名失败：`找不到模块 "../be000/index"`。
- `.mjs` + 显式扩展名：构建日志 `build Task (web-mobile) Finished in (1 min 17 s)`；CLI `exit=36`（成功后的编辑器退出怪癖）。
- 浏览器运行时探针：
  `{"value":11520,"state":"[7,0,1026,12288]"}`，与 Node 相同。

证据：`reports/backend/BE-000/logs/cocos-build.log`、`reports/backend/BE-000/evidence/cocos-runtime-probe.json`。

未取得截图：in-app browser 视口不可见，`take_screenshot` 返回 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`；改用页面内 `evaluate_script` 读取探针值并落盘。这属于证据形式限制，不影响构建与运行结论。

## 7. T13 修复闭环（实际证据）

1. 在 `prng.ts` 的 xoshiro 输出乘积中注入缺陷：`9` → `8`。
2. 执行 `npm test`：64 个用例中 **6 个失败**：
   - RNG-01
   - RNG-03
   - VEC-04
   - VEC-05
   - DIST-02
   - OFF-08
   日志：`t13-red.log`，`EXIT=1`。
3. 恢复乘积为 `9`，重新构建并执行：64/64 通过，`EXIT=0`。
   日志：`t13-green.log`。

说明：该注入只用于验证测试能捕获语义回归；源码已恢复，产物重新构建。未修改断言来“适配”缺陷。

## 8. 未执行/阻塞

| 项 | 原因 |
|---|---|
| 微信开发者工具启动、真机 | 需 FE-000/负责人提供环境 |
| 微信 `FileSystemManager` 三槽 | 需 FE 实现端口并真机 |
| 真机 24h 离线耗时/内存/帧阻塞 | 需真机与 Cocos 运行环境 |
| 生命周期强退/时间回退 | 前端范围 |
| 广告完整观看/取消/重复回调 | 无广告位与资格，前端范围 |
| 微信构建与分包 | 前端构建范围 |
| 正式 GATE-01/整体验收 | 不能单方面通过 |

## 9. 可重复性说明

- 所有随机均由固定种子驱动；测试不依赖墙钟或网络。
- 真实文件系统测试使用系统临时目录并在用例内清理。
- 构建产物被 `.gitignore` 忽略；复跑前必须执行 `npm run build:cocos`。
- 若修改共享源码而不同时重建，`dist-artifact`/`cocos-artifact` 测试会针对旧产物通过；`verify` 已把构建放在测试前，审查时请使用 `npm run verify`。
- `reports/backend/BE-000/logs` 被根 `.gitignore` 忽略，需负责人决定是否入库。