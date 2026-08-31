# 代码质量审查报告 — F274 global-setup 跨 worktree 假新鲜盲区修复

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 修复完全局限在 tests/global-setup.ts 内部，未跨层扩散；复用 scripts/lib/spectra-version-gate.mjs 的 hashDistTree 而非重实现，边界清晰 |
| 设计模式合理性 | GOOD | sidecar schema v1→v2 演进 + 按 PROJECT_ROOT 分键双管齐下，均有明确根因对应；参数化默认值模式（`opts.distCli = DIST_CLI` 等）为测试注入路径，生产调用点零改动，属于合理的可测试性重构，非过度工程 |
| 安全性 | GOOD | 无外部输入拼接路径；sha256(projectRoot) 分键无路径遍历风险；`rmSync(LEGACY_SHARED_SIDECAR, { force: true })` 仅在写入默认真实路径时触发，测试路径不会误删任何文件（已用 tmp 目录验证隔离） |
| 性能 | NEEDS_IMPROVEMENT | `isDistFresh` 新增 `computeDistFingerprint` 会对 dist/ 下全部 .js 文件读内容求 hash（当前约 329 个文件）；虽在 `inputsSha256` 不匹配时短路跳过，但**匹配时（含 watch 模式每次 `onTestsRerun` 判"仍新鲜"的常见路径）都会付一次全量 dist 读盘+hash 成本**，相较修复前 O(1) 读 sidecar 小文件有明显放大；fix-report 中评估为"数十 ms 量级可忽略"但未提供实测数据支撑该结论，watch 模式高频触发场景下的累积开销未评估 |
| 可读性 | EXCELLENT | 注释详尽，逐处标注"F274 修订"与原因；函数职责单一（deriveSidecarPath / computeDistFingerprint / readSidecar / writeSidecar / isDistFresh 各司其职），调用链清楚 |
| 可维护性 | GOOD | 无重复代码；错误处理沿用既有 try/catch + 保守偏置（null → 判不新鲜）风格；测试与实现改动同步；`readSidecarFingerprint` 更名为 `readSidecar` 且注释中同步标注旧名对照，便于历史排查 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 性能 | tests/global-setup.ts:213-224 (isDistFresh) | `computeDistFingerprint` 在 inputsSha256 匹配路径下会对整个 dist/ 目录全量读文件内容求 sha256，watch 模式下 `onTestsRerun`（tests/global-setup.ts:320-329）每次 rerun 判"仍新鲜"都会重复此开销；fix-report 用"数十 ms 量级可忽略"定性但未给出实测数据 | 若后续 dist 体积显著增长（当前 329 个 .js），可考虑用文件 mtime+size 组合的轻量指纹替代全量内容 hash 作为第一道快速判据，仅在怀疑不一致时才 fallback 到全量 hash；当前规模可暂不处理，建议在 fix-report 或 verification 里补一次实测耗时数据佐证结论 |
| INFO | 可维护性 | tests/global-setup.ts:163-181 (writeSidecar) | `writeSidecar` 内部隐式做了两件事（写入新 sidecar + 清理遗留共享文件），函数名未体现"清理"副作用，纯从函数签名读不出会有该副作用 | 已有注释说明清理条件，可接受；如追求更纯粹的单一职责，可将清理逻辑抽成独立的 `cleanupLegacySidecar()` 显式调用一次（如在 `runBuild` 成功分支单独调用），非必须 |
| INFO | 可维护性 | tests/integration/global-setup-cross-worktree-freshness.test.ts:80-83 | "dist 目录为空/不存在时 computeDistFingerprint 仍返回确定性结果" 用例只断言 `not.toThrow()`，未进一步断言两次调用（存在 vs 不存在）返回值是否一致/确定性本身，用例名与断言力度略有落差 | 可选：补一行 `expect(computeDistFingerprint(distDir)).toBe(computeDistFingerprint(distDir))` 或直接断言具体值（sha256 of empty file list），加强"确定性"这一命题的证据强度；非阻断 |

## 调用方合同核对

- `isDistFresh` 签名由 `(currentFingerprint: string | null)` 扩展为 `(currentFingerprint, opts = {})`，`opts` 全字段带默认值 —— 既有两处生产调用点 `isDistFresh(snapshot)`（setup, L308）与 `isDistFresh(rerunFingerprint)`（onTestsRerun, L323）均为单参数调用，走默认参数，行为不变，向后兼容确认无破坏。
- `writeSidecar` 签名由 `(inputsSha256: string)` 扩展为 `(inputsSha256, distSha256, sidecarPath = TEST_INPUTS_SIDECAR)`——**这是一处破坏性签名变更**（新增必填参数 `distSha256`），但全仓唯一生产调用点在 `runBuild`（L284-286）已同步改为 `writeSidecar(fingerprintAfterBuild, distFingerprint)`，`grep` 确认无遗漏调用点；测试文件调用均显式传三参数，合同一致。
- `readSidecarFingerprint` 重命名为 `readSidecar` 且返回类型从 `string | null` 变为 `TestInputsSidecar | null`（结构性变更）——原函数为模块内 private（未 export），仅被 `isDistFresh` 内部消费，已同步改造为 `sidecar.inputsSha256`/`sidecar.distSha256` 双字段读取，无外部调用方受影响。
- `TestInputsSidecar.schemaVersion` 从字面量 `1` 改为 `2`：`readSidecar` 对 `schemaVersion !== 2` 一律返回 null，天然拒绝读取 v1 遗留 sidecar（测试用例已覆盖此路径），迁移语义正确、无需额外迁移代码。

## 根因对齐核对

fix-report.md 的 5-Why 定位根因为"sidecar 无 dist 内容绑定字段 + 因 node_modules 软链导致跨 worktree 共享路径"，实现的两处改动（`distSha256` 绑定 + 按 `sha256(PROJECT_ROOT)` 分键）与根因一一对应，未见范围外的无关改动（未触碰 `tests/helpers/dist-cli-guard.ts` 等已评估为"安全"的类似模式文件，符合 fix-report 的影响范围扫描结论）。

## 总体质量评级

**GOOD**

评级依据：零 CRITICAL，WARNING 1 个（性能维度，缺实测数据支撑但设计方向合理、已有短路优化），INFO 2 个（均为非阻断的可读性/测试严谨性建议）。修复聚焦、根因对齐、调用方合同核对无破坏，测试独立且真实复现了 bug 场景（先验证旧逻辑会误判 true 的场景转为新逻辑判 false）。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 1 个
- INFO: 2 个
