# Architecture

## Modules
- docs: 产品设计与技术文档
- packages/contracts: 公共接口契约
- packages/game-core: 核心业务规则
- packages/game-application: 应用层
- packages/game-config: 游戏配置模块
- apps/simulator: 数值模拟器
- apps/game-client: Cocos 游戏客户端
- config: 正式游戏配置及内容
- tests: 自动化测试
- tools: 开发工具
- reports: 开发及验收报告

## Dependency Direction
game-client -> contracts / application interfaces
simulator -> application / public core interfaces
game-application -> game-core / game-config / contracts
game-core -> contracts
game-config -> contracts

禁止循环依赖。具体工具链、包管理器、工作区方案及构建产物格式以 BE-000、FE-000 技术验证和批准结果为准。
