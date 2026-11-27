# Backend Packages Rules

后端 AI 负责 packages 下的业务模块。

- game-core：纯业务计算、领域规则、状态转换和确定性计算；仅依赖 contracts；不得依赖 Cocos、微信 SDK、前端代码或 Node.js 专用 API。
- game-application：应用指令、查询接口、事务及业务协调；可依赖 contracts、game-core、game-config；通过抽象接口访问存储、时间、广告等外部能力。
- game-config：配置解析、校验和访问；可依赖 contracts；不得依赖 Cocos 或微信 SDK。
- contracts：只保存公共类型、接口及契约；正式契约由设计方维护，不实现业务规则。

禁止复制前端业务实现，禁止擅自修改公共契约。
