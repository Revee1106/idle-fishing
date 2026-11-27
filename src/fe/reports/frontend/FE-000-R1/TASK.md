# FE-000-R1 前端整改任务

工作区 E:/idle-fishing-frontend，分支 feature/fe-000，整改基准 43f666ba3ca2f0b004602c259e0ffb5c0dc81f97。当前固定的共享核心为 358b11105cfdee9bd076049c86a34d8f0aaa00e7。共享模块复审后再接入指定版本并完整复测。

按首审 REWORK_PROMPT.md 逐条关闭 I01–I06、V01–V03。限 apps/game-client、tests/frontend、reports/frontend。

1. 在实际 Cocos Web 构建验证 HIDE/SHOW 派发、退订、重复事件和异常隔离。后台保存走平台回调，记录跨重启恢复。分开核验微信实际产物 game.json 分包注册、入口、清单、资源和运行时加载。
2. 验证无单调能力、时钟回拨及前跳。对同一广告请求验证单实例、失败和重复回调清理。
3. 局部 unsubscribe 只解除本订阅；同 Provider 的其余订阅须继续工作。实际创建者应在正常及异常退出时释放 Provider。对文件系统套件和生命周期套件分别注入订阅后失败，记录 wx 或 DOM 原始监听数。
4. 修正公开测试入口，零用例和缺失测试文件均应失败。运行完整客户端 tsc（启动、UI、平台、共享桥接均覆盖）及真实打包产物回归。
5. 补齐实现、测试、问题、平台交接四份报告及前端开发状态、T01–T13 和可追溯红绿证据。区分 Node、Mock、Web、微信开发者工具、微信真机。真机文件、强退、广告和性能缺证须明确标记。共享接口或根工具链需求交后端对接。

按根目录及模块 AGENTS.md 执行。独立审核依据见 E:/idle-fishing-review/REVIEWER.md 和该工作区 reports/review 中本任务的四份首审报告。保留首审失败证据与修后通过证据，报告注明基准和实际 SHA、命令、退出码、实际用例数、实测宿主以及未测原因。任何测试入口运行零项均判失败。完成本轮后交由独立审核。

设计实验参数与门禁见 E:/idle-fishing-review/reports/review/R1/HANDOFF.md。
