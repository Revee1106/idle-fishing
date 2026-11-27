# AGENTS.md - Idle Fishing

## 项目定位
单 Git 仓库、多模块、前后端分离开发。前端和后端由两个独立 AI 负责。
本项目初期不建设实际服务端；“后端”指客户端及 Node.js 共用的 TypeScript 业务规则引擎。

## 全局约束
- 必须遵守 docs 中经批准的设计基线。
- 不得擅自修改产品规则、计算公式、接口契约或正式数值。
- 不得擅自改变目录结构、模块职责及依赖方向。
- 不得重复实现公共类型或核心业务算法。
- 不得引入未经批准的框架、插件、服务或付费依赖。
- 不得修改其他 AI 负责的文件。
- 未经授权不得提交、推送或合并主分支。

## 代码所有权
设计方维护：docs/、packages/contracts/ 正式契约、config/rules/ 正式数值、config/content/ 正式内容及全局设计规范。
后端 AI 维护：packages/game-core/、packages/game-application/、packages/game-config/、apps/simulator/、tests/backend/、reports/backend/。
前端 AI 维护：apps/game-client/、tests/frontend/、reports/frontend/。
联调共享：tests/integration/、tests/fixtures/、reports/integration/。
根目录构建配置、锁文件和公共工具必须在任务开始前指定唯一修改责任方。禁止两个 AI 同时修改同一共享文件。

## 模块依赖
- contracts 不依赖其他业务模块。
- game-core 仅依赖 contracts。
- game-config 仅依赖 contracts。
- game-application 可依赖 contracts、game-core、game-config。
- game-client 通过公共契约和应用接口访问业务能力。
- simulator 使用正式业务接口执行模拟。
- 禁止循环依赖。
- 后端纯业务模块不得依赖 Cocos 或微信 SDK。

## 公共契约
docs/interfaces 中经批准的契约是设计依据；packages/contracts 是工程公共契约位置。
两者必须保持一致。禁止前后端分别复制定义业务类型。
契约变更必须先提交问题，由设计方批准后同步修改文档、类型、实现及测试。

## 开发流程
每项任务必须阅读文档、确认范围和文件所有权、按文档实现、执行测试并输出实现报告/测试报告/问题报告。
非阻塞问题记录后继续；阻塞问题暂停受影响部分并标记 BLOCKED。
不得猜测需求、硬编码绕过或降低验收标准。
完成当前任务后停止，等待独立审查。

## 文件及 Git
不得覆盖用户已有文件或未提交修改；不得执行未经授权的破坏性 Git 操作或强制推送。
构建产物和缓存不得混入源码。不得提交凭证、API Key 或其他敏感信息。
下级 AGENTS.md 可以细化本规范，但不得与本文件冲突。
