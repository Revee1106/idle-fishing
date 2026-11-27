# 家庭电脑测试实证

测试根为 `E:/idle-fishing-astra-test-20261127`。冻结候选 `E:/idle-fishing-integration-home`，公司归档 `E:/idle-fishing-evidence-20261127`，家庭补充归档 `E:/idle-fishing-evidence-supplement-20261127`。证据位于本报告同级 evidence。Node 24.20.0，npm 11.4.2，TypeScript 5.9.3，Chrome 158.0.8127.37，Cocos 3.8.8，微信开发者工具 2.01.2510280，Python 3.12.6。

| 现场命令或脚本 | 退出码 | 实际结果和证据前缀 |
|---|---:|---|
| npm run verify | 0 | be，82/82 |
| npm run test:perf | 0 | perf，五个一致性检查为 true，黄金 Envelope 0be078f13066528fa78973822193d3d156e0777e28c00460448af686ac0ae69f |
| node --test reports/backend/BE-000-R1/evidence/pre/review-pre.test.mjs | 0 | a1，8/8 |
| npm run typecheck:cocos | 0 | cocos |
| npm --prefix apps/game-client run typecheck | 2 → 0 | fe-type，首次缺 Cocos 自动生成 temp/declarations/cc.d.ts；生成后 fe-type-retry |
| npm --prefix apps/game-client run test:frontend | 1 → 0 | fe 首次 32/33，缺 legacy-358b111-saves.json；从公司归档复制经校验原件后同一入口 33/33、skip/todo/procErr 均 0。路径和 SHA 见 legacy-fixture.json。单独检出冻结候选需提供此输入。 |
| npm --prefix apps/game-client run build:web / build:wechat | 0 / 0 | buildweb、buildwx；执行前无旧 build，Cocos 原始成功码 36，包装器校验产物后退出 0 |
| node tests/frontend/fe-000/verify-web-build.mjs --out-dir=<分别独立的绝对路径> | 0 / 0 | webA、webB，各 37/37，完整 JSON 及截图各自保存；无 console error 或 uncaught exception |
| node astra-home-run/race.mjs astraA / astraB | 0 / 0 | raceA-executed、raceB；空盘、12 轮非空、不同 clientId、双提交数 0、持锁页关闭后恢复。21.568 秒 / 22.729 秒 |
| node tests/frontend/fe-000/verify-wechat-build.mjs apps/game-client/build/wechatgame <输出 JSON> | 0 | wx，静态 10/10 |
| node astra-home-run/history-node.mjs / history-ui.mjs | 0 / 0 | history、historic-ui-executed；历史采集脚本以实际状态而非退出码判断，见 historical-ui.json |
| node astra-home-run/current-ui.mjs | 0 | current-ui；真实按钮、HIDE、IndexedDB 写故障及恢复 |
| node astra-home-run/capacity.mjs | 1 | 空盘 2304 配额反例，断言失败 |
| node astra-home-run/probe-owner.mjs standard / confirm | 1 / 1 | 两个真实 Chrome 取消边界反例，各有两笔已提交探针操作 |
| node astra-home-run/cdp-negative.mjs | 0 | 从候选提取的 CDP 类在无应答和连接关闭时拒绝，见 cdp-negative.json |

第一次调度 historic-ui 和 raceA 时命令拼接错误，产出的两个空 .rc 不代表执行或成功。以带 -executed 的重跑日志、完整 JSON 和退出码为准。为适配位置制作执行副本，路径差异见 path-adaptations.diff，历史原件保持不变。独立容量、探针生命周期和 CDP 检查另有独立脚本。隔离副本使用过的脚本和夹具现存 `E:/idle-fishing-astra-review-20261127/scratch/REWORK-06-ASTRA-execution-copies`；重跑时按上述目录放回测试副本。临时浏览器 Profile 位于审核区 scratch/tmp，报告目录保留两次运行的 JSON 和截图。

## 构建逐文件比较

Web 公司 36 文件 / 2,166,166 字节，本机 35 / 2,138,176。33 个路径原始 SHA-256 完全一致，含业务包 assets/main/index.js。差额 27,990 字节由三处完全解释：缺少 src/polyfills.bundle.js（8,394），index.html 少 68，src/settings.json 少 19,528。给本机入口仅补入 polyfill 标签和相应换行，在内存中重算即可命中公司入口 SHA。家庭 src/settings.json 的 splashScreen 只含四个字段，公司日志明确记录移除插屏失败并回退默认插屏；该生成项是差异线索，未取得公司原文件以证明所有 19,528 字节的具体内容。配置中 asyncFunctions=false，两台构建机最终的 polyfill 选取有别，原因无法由摘要唯一确定。比对见 web-hash-comparison.json、entrypoint-comparison.json。

微信公司 R6 41 文件 / 2,075,503 字节，本机 40 / 2,067,048。公司 R6 静态审计未包含全包逐文件哈希。使用明确标为 R5 的 Astra 全包基线交叉检查，38 项相同，差异为缺 polyfill、game.js 加载行和变化的业务包。补入加载行可重得 R5 game.js 摘要；本机业务包与本机 Web 主包 SHA 相同，且与 R6 Web 参考相同。R6 微信总体少 8,455 字节，恰与 8,394 + 61 一致。这支持同一 polyfill 差异的解释，但不能据此声称与 R6 微信其余路径逐哈希完全一致。七个分包文件共 2,597 字节。全部家庭微信文件 SHA 见 wechat-hashes.json。

Cocos 在隔离区生成了编辑器授权/插屏状态缓存，并改写一份跟踪设置文件。已记下该文件构建前后摘要及四个变化字段，构建结束后从只读候选恢复原字节。补入的测试输入、执行脚本已移出隔离工作树；生成的忽略目录保留。最终逐字节核验和工作区状态见 after.json。
