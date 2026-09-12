# Phase 5 · 代码质量审查报告（quality-review 子代理）

- 审查范围：commit 区间 `26a3b15f..98d19a25`（当前 HEAD，三个 commit：4255212c Phase A+C / d86fa332 Phase B+D / 98d19a25 Phase E）
- 代码面（重点）：`plugins/spec-driver/contracts/orchestration-schema.mjs`、`plugins/spec-driver/lib/{orchestration-resolver,orchestrator}.mjs`、`plugins/spec-driver/scripts/{orchestrator-cli,validate-gate-mounting}.mjs`、`scripts/lib/{agent-tools-core,namespace-consistency-core,repo-maintenance-core}.mjs`、`scripts/sync-agent-docs.mjs`，及对应测试
- 散文面（次要）：仅核对结构与一致性，未逐字审查措辞
- 已知裁定（本报告不重复）：门挂载判据 = base 锚定子序列（三轮对抗 6C 已收口）；`GATE_MOUNTING_MANDATORY_MODES` 常量下界；`validateSharedAgentDocsSafely` fail-loud 外壳；K14 `added` 清单口径；`generate-template` 预存 bug；FR-065 四份 SKILL 手写副本无机械守护（plan.md Phase D 段 D-b 已诚实登记为残余）

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 新模块划分与 plan.md 基本一致（schema/predicate 共用实现、resolver 五步管线、CLI 单一 `buildOrchestrator` 出口、repo:check 两个新 family 复用 fail-closed 外壳模式）；`buildGateMountingMap()` 的 `baseConfig` 赋值顺序正确（先于消费）。唯一减分项见 STRUCTURAL_DEBT |
| 设计模式合理性 | EXCELLENT | `agent-tools-core.mjs` 与 `validate-gate-mounting.mjs` 采用同一套"纯函数求值 + I/O 外壳 + 顶层 catch fail-closed"模式，`sync-agent-docs.mjs` 的 `preludeGuard` 用函数引用而非硬编码分支扩展；均可独立构造红灯用例，无需先改坏磁盘 |
| 安全性 | EXCELLENT | `execFileSync` 用数组参数（非 shell 字符串拼接），无注入面；无硬编码密钥；新增手写词法解析器（`namespace-consistency-core.mjs`）的四个正则均线性、无嵌套量词，无 ReDoS 风险；未发现 eval/new Function |
| 性能 | N/A | 配置解析/校验类代码，输入规模恒为个位数 mode × 个位数 phase，无 N+1、无大数据集算法关注点 |
| 可读性 | GOOD | 绝大多数分支都有引用具体对抗轮次（α/β/γ/δ/ε-Cn）的 rationale 注释，故障排查友好；单个函数过长（见问题清单）拉低单项读感 |
| 可维护性 | NEEDS_IMPROVEMENT | 1 处文件级 STRUCTURAL_DEBT CRITICAL + 函数过长 + 两个同批新建守护模块的错误粒度处理不一致 |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| CRITICAL | 可维护性(STRUCTURAL_DEBT) | `plugins/spec-driver/contracts/orchestration-schema.mjs`（全文件 346→1010 行，核心新增块 :189-711 约 520 行） | 越过"单文件 <500 行增长到 >800 行"门槛。文件头部 docstring 自陈职责为"Zod 三件套 Schema 定义"，但改动后约 65% 篇幅是门挂载可达性判据（`evaluateGateMountingAgainstBase` 及 ~10 个辅助函数），与文件名所暗示的"schema"职责已实质分叉成两个关注点。implementation-notes.md:832 记录了"为何新逻辑落在此文件"的实现期决策（复用既有单一事实源模式），但那条决策回答的是"该不该新增在这里"，未回答"1010 行后是否仍应留在同一文件"这一独立的文件级 cohesion 问题 | 把 `GATE_MOUNTING_ENFORCED_GATES` 到 `findLostGateMountings`（约 :189-711）抽到新文件如 `contracts/gate-mounting-predicate.mjs`；三处消费方（`orchestrator.mjs`、`orchestration-resolver.mjs`、`validate-gate-mounting.mjs`）改 import 路径即可，机械重构、低风险。抽出后 orchestration-schema.mjs 收缩至 ~490 行 |
| WARNING | 可维护性 | `plugins/spec-driver/contracts/orchestration-schema.mjs:553-693`（`evaluateGateMountingAgainstBase`） | 单函数 141 行，超"过长函数 >50 行应拆分"阈值约 3 倍。函数体把"取候选"与"逐级分类是哪种 violation"（missing-anchor / suppressor-added / anchor-tuple-changed / order-broken / pre-anchor-phase-not-in-base）压在同一层 for 循环里；注释详尽、单支语义清楚，但后续新增第 6 种 violation kind 时改动半径会随之扩大 | 把循环体内"suppressorMatches → tupleMatches → witness → orderBreak → intruder"五级判定抽成 `classifyAnchorViolation(anchor, candidates, ...)`，返回单个 violation 或 null，主函数只负责收集 |
| WARNING | 跨模块一致性/可维护性 | `scripts/lib/agent-tools-core.mjs:236-268`（`validateAgentTools`）对照 `plugins/spec-driver/scripts/validate-gate-mounting.mjs:227-244`（`tryRunCli`/`factErrors`） | 同一 Feature、同批新建的两个 repo:check 守护模块对"取单条事实失败"的处理粒度不一致。`validate-gate-mounting.mjs` 明确注释"上抛会把 12 条断言坍缩成 1 条 catch 结论"故为每次取事实单独 try/catch；但 `agent-tools-core.mjs` 里 4 个 agent 文件的 frontmatter 解析共用同一个外层 try/catch（无 per-agent 包裹），任一文件解析异常（如新词法解析器检测到重复 `tools:` 键抛错）会让全部 8 条断言一次性坍缩成 1 条"内部错误"，丢失"哪个 agent 哪条断言"粒度。最终 status 仍正确为 fail，不构成安全回归，但排障可读性弱于姊妹模块 | 参照 `tryRunCli` 模式，把 `readTextOrNull` + `extractFrontmatterTools` 按 agent 逐个包 try/catch，异常转为该 agent 对应断言的 fail detail |
| INFO | 可读性 | `plugins/spec-driver/lib/orchestration-resolver.mjs:1-14`（模块头部 docstring） | "导出"清单只列 `resolveOrchestrationConfig`，但 Phase A CLEANUP C1 拆分后该文件新增 5 个具名 export（`loadBaseOrFallback` / `loadOverridesOrNull` / `mergeAndValidate` / `validateGateMounting` / `assembleResult`），头部清单未同步 | 在导出清单补 5 个新函数的一行摘要，帮助读者从文件头即判断这是"5 步骤管线 + 1 组装入口"结构 |

## 总体质量评级

**NEEDS_IMPROVEMENT**

评级依据：零 CRITICAL 但 WARNING > 5 或有 1-2 个 CRITICAL —— 本次 1 个 CRITICAL（STRUCTURAL_DEBT）+ 2 个 WARNING，落入该档。**需强调**：CRITICAL 项属"文件级职责内聚 + 长期可维护性"信号，不是功能缺陷——本次改动本身语法检查通过（`node --check` 全过）、无孤立 import、`isGateMountedInMode` 仅有的生产调用点与其文档描述完全一致、fail-closed 方向在所有新代码路径中一致（判不出⇒判失败），三轮对抗审查也未在该文件的判据正确性上留下已知残留。若把 STRUCTURAL_DEBT 与功能性 CRITICAL 分开看，功能面质量评级应为 GOOD。

## 问题分级汇总

- CRITICAL: 1 个
- WARNING: 2 个
- INFO: 1 个
