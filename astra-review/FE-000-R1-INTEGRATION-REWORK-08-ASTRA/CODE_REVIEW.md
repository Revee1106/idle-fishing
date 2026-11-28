# 差异范围

开发工作树相对于 REWORK-07 的原始字节差异集中在 BootEntry.ts、SingleWriterSaveCoordinator.ts、platform-and-core.test.ts 和 verify-web-build.mjs。其余 351 个跟踪文件与基线 Git blob 一致。完整路径见 [核验记录](evidence/preflight.json)。

交接声明已移除恢复时使用默认初始状态的回退。当前四项改动均在 Git 索引外，尚无冻结对象可供代码级签核。
