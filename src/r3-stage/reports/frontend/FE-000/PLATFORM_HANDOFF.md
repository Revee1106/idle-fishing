# FE-000 / FE-000-R1 平台构建与交接说明（PLATFORM_HANDOFF）

## 1. 环境前提与工具路径

本工程已在以下 Windows 环境中完成可重复命令行构建与自动化验证：

- **工作目录**：`E:/idle-fishing-frontend`（分支 `feature/fe-000`）
- **Node.js / npm**：`v24.20.0` / `11.4.2`
- **Cocos Creator**：`3.8.8`（默认查找 `C:\ProgramData\cocos\editors\Creator\3.8.8\CocosCreator.exe`，也可通过环境变量 `COCOS_CREATOR_PATH` 覆盖）
- **Google Chrome**（用于 `verify:web` 无头 CDP 回归）：`C:\Program Files\Google\Chrome\Application\chrome.exe`（可通过 `CHROME_PATH` 覆盖）
- **微信开发者工具**：`2.01.2510280`（`E:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`）

---

## 2. 可重复命令行操作手册（无 GUI 依赖部分）

以下命令均在仓库根目录 `E:/idle-fishing-frontend` 下执行（无需手动打开 Cocos Creator 编辑器界面）：

### 2.1 在其他电脑恢复相同依赖与构建共享核心
```powershell
git clone https://github.com/Revee1106/idle-fishing.git
cd idle-fishing
git checkout feature/fe-000
npm ci --ignore-scripts --no-audit --no-fund
npm run build:cocos
```
- 本分支父提交已固定 `packages/game-core/` 为 `358b11105cfdee9bd076049c86a34d8f0aaa00e7`（未合入未复审的 `BE-000-R1`）；无外网离线环境可追加 `--offline`。
- 产出：`packages/game-core/dist/cocos/*.mjs` 与 `*.d.ts`，供 `apps/game-client` 通过 `file:../../packages/game-core` 直接加载。

### 2.2 全量客户端 TypeScript 类型检查
```powershell
npm --prefix apps/game-client run typecheck
```
- 等价于 `tsc --noEmit -p apps/game-client/tsconfig.typecheck.json`，覆盖 `bootstrap/`、`ui/`、`platform/`、`shared/` 全部客户端代码。

### 2.3 Node / Mock 前端自动化测试
```powershell
npm --prefix apps/game-client run test:frontend
```
- 调用 `tests/frontend/fe-000/run-node-tests.mjs`，内置零用例与缺文件硬门禁（任意测试文件缺失或执行 `0` 项即退出码 `1`）。
- 预期结果：`7/7 PASS`，退出码 `0`。

### 2.4 Cocos Web Mobile 构建与真实产物端到端验证
```powershell
npm --prefix apps/game-client run build:web
npm --prefix apps/game-client run verify:web
```
- 构建输出：`apps/game-client/build/web-mobile`（36 文件，`2024.74 KB`）。
- `verify:web` 自动启动本地临时静态服务器（`127.0.0.1` 随机端口）与无头 Chrome CDP，验证 18 项断言（含打包产物 `I01` 生命周期、真实 `visibilitychange` + `Page.reload()` 跨刷新恢复、弹窗真实点击、滚轮滚动、横竖屏适配、24h 性能与 `BE-000` 黄金哈希），写出 `reports/frontend/FE-000/evidence/r1-green-web-results.json` 与 4 张截图。

### 2.5 Cocos 微信小游戏构建与分包产物审计
```powershell
npm --prefix apps/game-client run build:wechat
npm --prefix apps/game-client run verify:wechat
```
- 构建输出：`apps/game-client/build/wechatgame`（41 文件，`1936.20 KB`：主包 34 文件 `1933.67 KB`，分包 `subpackages/spike-pack/` 7 文件 `2.54 KB`）。
- `build:wechat` 结束后会自动执行 `tests/frontend/fe-000/verify-wechat-build.mjs`，强制核验：
  1. `game.js` 与 `project.config.json`（`compileType: "game"`）
  2. `game.json` 中 `"subpackages": [{"name":"spike-pack","root":"subpackages/spike-pack/"}]`
  3. `subpackages/spike-pack/game.js`、`config.json`、`manifest`（`spike-pack-v1`）、`313 B` PNG 图标
  4. `src/settings.json` 中 `"assets.subpackages": ["spike-pack"]`

---

## 3. GUI 依赖与负责人最小人工操作清单（解锁 `BLOCKED` 项）

Cocos 构建与 Web 回归已完全命令行化；**仅微信开发者工具运行态、真机预览与真实广告验证**需要以下最小人工介入：

1. **开启微信开发者工具 CLI 服务端口（一次性手动设置）**：
   - 打开微信开发者工具 -> `设置` -> `安全设置` -> 将 `服务端口` 切换为 **开启**，并扫码登录具备小游戏权限的开发者账号。
2. **替换正式测试 AppID 并导入构建产物**：
   - 将 `apps/game-client/build-configs/buildConfig_wechatgame.json` 中的 `"appid": "touristappid"` 替换为正式微信小游戏测试 AppID（或导入 `apps/game-client/build/wechatgame` 后在 IDE 项目详情中修改）。
   - 重建：`npm --prefix apps/game-client run build:wechat`。
   - 命令行打开 IDE（服务端口开启后可用）：
     ```powershell
     & "E:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" open --project "E:\idle-fishing-frontend\apps\game-client\build\wechatgame"
     ```
3. **微信 IDE 与代表性中低端真机实测（解锁 `T01 / T04 / T05 / T06 / T08 / T10`）**：
   - 启动后确认 Page 1 顶部运行环境显示为 `WECHAT_DEVTOOLS`（IDE）或 `WECHAT_DEVICE`（真机），确认 Shared Core `7/7 PASS`。
   - 点击 `2. Run 24h Offline Perf`，记录真机单次 24h 耗时、60 分片最大单片耗时、总耗时与内存峰值。
   - 切至 Page 2，依次验证：
     - `Run FS & Save Suite`（真实 `wx.getFileSystemManager()`、`USER_DATA_PATH/idle_fishing` 读写、3 槽轮转、损坏恢复、64KB/256KB 探测）
     - `Run Lifecycle / Clock / Ad`（核验真机 `wx.getPerformance().now()` 实际单位与防篡改表现）
     - `Load Local Subpackage`（验证微信运行态加载 `subpackages/spike-pack/` 成功）
   - 切后台触发真实 `wx.onHide` 自动落盘 -> 强杀微信小游戏进程 -> 冷启动重新进入，确认 `lifecyclePersistence.restoredOnBoot === true` 且 `revision/gold/cursorMs/deadlineMs` 完整恢复。
4. **真实激励视频广告验证（解锁 `T09`）**：
   - 申请正式/测试激励视频广告位 `adUnitId`，在真机环境下用 `WeChatRewardedAdAdapter` 实测拉取、完整播放发奖确认、提前关闭不发奖、断网失败与重复回调防重。

---

## 4. 平台关键技术说明与避坑记录

1. **Cocos 3.8.8 微信分包配置机制（重要）**：
   - 在 Cocos Creator 3.8.8（`directory` importer `ver: 1.2.0`）中，直接在 `.meta` 内手写旧版 `compressionType` 不会被微信构建器识别，且在 `buildConfig_wechatgame.json` 中保留 `"bundleConfigs": []` 会覆盖项目配置。
   - 正确做法：使用 `.meta` 的 `bundleConfigID` 关联 `apps/game-client/settings/v2/packages/builder.json` 中的 `bundleConfig.custom.<id>.configs.miniGame.overwriteSettings.wechatgame.compressionType = "subpackage"`（`isRemote: false`），并由 `verify-wechat-build.mjs` 对每次构建产物做硬审计。
2. **Cocos 3.8.8 Babel `loose` 模式的 `Set` 展开陷阱**：
   - 引擎构建链路将 `[...set]` 编译为 `[].concat(set)`，在 Node 下无法暴露，仅在打包产物中失效。客户端代码及后续业务模块禁止对 `Set`/`Map` 使用展开运算符，统一使用 `.forEach()` 或 `Array.from()`。
3. **Cocos CLI 退出码 `36`**：
   - Cocos Creator 3.8.8 无头命令行构建成功固定返回 `36`，失败返回 `34` 或其他非零码。`scripts/build-cocos.mjs` 已封装退出码归一化与产物完整性校验，请始终通过 `npm --prefix apps/game-client run build:web` / `build:wechat` 调用。
4. **微信文件系统路径约定**：
   - 仅允许使用 `wx.env.USER_DATA_PATH + '/idle_fishing'` 下的受控相对路径（禁止 `..` 与绝对路径注入），符合零成本本地存储与三槽轮转方案。
5. **非正式代码标注**：
   - `ExperimentalAdProvider.ts` 中的 `ExperimentalStubAdProvider` 明确标记为 `EXPERIMENTAL_STUB`（仅作 `FE-000` 技术验证桩），不修改任何玩家业务资产；`FE-001` 及后续正式阶段按 `docs/interfaces/19-平台适配存档广告与版本接口.md` 接入正式应用层门面。
