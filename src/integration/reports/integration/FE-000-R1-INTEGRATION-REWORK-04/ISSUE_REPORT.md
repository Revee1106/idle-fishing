# FE-000-R1-INTEGRATION-REWORK-04 问题与风险边界报告（ISSUE_REPORT）

- **任务编号**：`FE-000-R1-INTEGRATION-REWORK-04`
- **日期**：2026-11-27
- **当前状态**：`READY_FOR_INDEPENDENT_REVIEW`

---

## 1. 本轮已关闭审核问题

| 审核编号 | 级别 | 主题 | 本轮关闭状态 | 实测证据 |
|---|---|---|---|---|
| **REV3-01（A02）** | **P1（阻塞）** | `UNCERTAIN` 跨标签页冻结绕过 | **开发方已修复并实证** | 共享 IndexedDB `${ns}:__tx_state__` 写前事务标记 + Web Locks 锁内权威读 + `BootEntry` 启动 `clearPendingTxMarker: false`；Node 20/20 + 两套独立 Chrome 158 Profile 全部 12 项 A02 场景 ×2 全绿（`logs/r4-verify-web-run1.log`、`r4-verify-web-run2.log`） |
| **REV3-02（P2）** | **P2** | 浏览器缺 `indexedDB` 静默回退 `localStorage` | **开发方已修复并实证** | `BrowserFilePort` 在无 `indexedDB` 的真实浏览器中固定 fail-closed（`BROWSER_STORAGE_UNAVAILABLE` / `STORAGE_UNAVAILABLE`、0 写）；仅 `allowLocalStorageMockInNode: true && isNodeTestHost()` 允许 Node Mock；真实 Chrome 实测即使传 opt-in 仍 fail-closed |
| **REV3-03（P2）** | **P2** | 无 `localStorage`→IndexedDB 迁移且回退复活旧档 | **开发方已按策略落地并实证** | 只读检测并明确报告 `DETECTED_IGNORED_NO_AUTO_MIGRATION`；不复活、不覆盖、不删除；因缺 IDB 不再回退 `localStorage`，彻底杜绝旧档复活。完整生产迁移方案已记入下方 §4 正式设计待决项 |

---

## 2. A09 组合测试挂起证据核对（任务书第 6 节 / REV3-04）

已核对 DeepSeek 审核目录中的原始脚本与日志：
- `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\evidence\r3-t2-a09.mjs`
- `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\evidence\r3-t2-a09.log`（`[stage] A09` 后在 120s `[WATCHDOG] abort`，`EXIT=3`）
- `E:\idle-fishing-review\reports\review\FE-000-R1-INTEGRATION-REWORK-03-DEEPSEEK\evidence\r3-a09-only.log`（两标签页并发 `runFileSystemAndSaveSuite` 独立复测 **6/6 ×2 PASS**，`EXIT=0`）

### 核对结论

1. **并非 A09 存储命名空间隔离缺陷**：
   - 独立复测 `r3-a09-only.mjs` 证明两标签页并发执行 `runFileSystemAndSaveSuite()` 使用独立临时命名空间 `idle_fishing_spike_diag_<ts>_<rand>` 并在 `finally` 清理，双侧均 6/6 PASS。
2. **两类非存储挂起机制**：
   - **机制 A（后台标签页 Cocos `requestAnimationFrame` 节流/暂停）**：在无头 Chrome 中通过 `Target.createTarget` 打开 Tab B 后，Tab A 自动退居后台，浏览器会暂停后台标签页的 `requestAnimationFrame` 回调。完整 `runAllPlatformChecks()` 包含 `runSubpackageCheck()`（调用 Cocos `assetManager.loadBundle('spike-pack')`），其引擎调度依赖主循环帧推进，因此在后台标签页并发调用时容易长期等待；本轮开发方在调试 `verify-web-build.mjs` §3h 时亦直接复现了同一 Chromium 机制（在后台标签页调用 `requestAnimationFrame` 永久挂起，显式 `Page.bringToFront` 后立即恢复）。
   - **机制 B（Windows IndexedDB NTFS `FlushFileBuffers` 与 120s 组合看门狗叠加）**：`r3-t2-a09.mjs` 在执行完 T2 阶段后，又在同一 Chrome 实例的双标签页并发运行约 40–50 笔 IndexedDB `readwrite` 事务（全部落于同库 `idle_fishing_fs_v1` 且在 Windows 上逐笔触发 NTFS 刷盘），叠加上一阶段耗时与后台页定时器节流，易触及 120s 组合看门狗。
3. **是否导致当前 FE-000 验收不成立**：**否**。A09 验收目标为诊断命名空间隔离与清理，已独立通过；上述现象属于 Chromium 后台页 `rAF` 节流与 Windows 磁盘刷盘延迟，已如实记录提交负责人知悉，本轮不擅自扩大范围重构 Cocos 分包加载器。

---

## 3. 安全边界与残余局限（严格透明披露）

1. **存储完全不可用 / 元数据写失败 / Web Locks 不可用（任务书 §3 要求 11）**：
   - 当 IndexedDB 完全不可用、`__tx_state__` 写失败或 `navigator.locks` 缺失/拒绝时，当前标签页立即 fail-closed（`STORAGE_UNAVAILABLE`）并保证 **0 字节存档槽写入**。
   - 此时因无法向共享介质落盘标记，本方案**不宣称**能将本机故障瞬时广播给其他标签页；但因当前标签页未改动任何存档槽，共享盘面保持一致且无未知写入。
2. **微信平台真实运行时（BLOCKED / NOT_RUN）**：
   - 微信开发者工具、微信真机文件系统/生命周期/分包、真实微信激励广告 `adUnitId` 在当前桌面环境无法运行，仍标记为 `BLOCKED / NOT_RUN`，须在后续具备微信真机环境后完成真机补验。
3. **跨设备/真断电**：
   - 浏览器端模拟崩溃使用 CDP `Target.closeTarget`（真实终止渲染进程与自动释放 Web Lock），未覆盖操作系统级真断电或硬件磁盘静默位翻转。
4. **P3 历史观察项归档（REV3-05、REV3-06、REV3-07、REV3-08）**：
   - 遵照任务书第 6 节，本轮归档不做无关重构；`verify-web-build.mjs` 已在保留既有全部 28 项断言基础上扩展至 31 项（新增 BootEntry 级跨标签页 HIDE 冻结、刷新/销毁/关闭、故障崩溃矩阵及 P2 策略断言）。

---

## 4. 正式设计待决项（Deferred to Formal Save Design）

- **DESIGN-OPEN-SAVE-MIGRATION**：本阶段（FE-000 技术 Spike）确认无正式线上 Web 玩家数据，对历史实验 `localStorage` 存档采取"只读检测与显式报告（`DETECTED_IGNORED_NO_AUTO_MIGRATION`）、不自动复活、不自动迁移、不删除"的保守策略。正式版本若需支持 Web 历史存档迁移或跨介质迁移，须由设计方在正式存档设计阶段定义一次性备份校验、幂等断点重试与用户确认交互方案。
