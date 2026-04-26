# Spec 合规审查报告 — Feature 133

**审查日期**: 2026-04-26
**审查者**: spec-driver:spec-review subagent
**审查范围**: fix-report.md（5 根因）+ plan.md（5 批改动清单 + 测试设计）+ tasks.md（T-001~T-023）vs 实际代码改动
**初评**: WARN
**Post-review 后**: PASS（关键 WARNING 已在 commit `a1fa099` 解决）

## 1. 5 个根因实现状态

| 根因 ID | 描述 | 状态 | 证据 |
|---------|------|------|------|
| P0-1 | cli-proxy 从嵌套 usage 字段提取 token | ✅ 已实现 | commit `dcf5c7c`：StreamMessage 接口加嵌套 usage / parseStreamJsonOutput 优先读 msg.usage.* |
| P0-2 | reading 模式真正跳过产品文档 + enrichment | ✅ 已实现 | commit `839116f` + post-review `a1fa099`：READING_SKIP_IDS 扩展至 13 个；genOptions.skipEnrichment 单一来源 |
| P0-3 | 默认模型升级 Sonnet 4.6 + Opus 4.7 1M | ✅ 已实现 | commit `79cfbb2`：DEFAULT_CLAUDE_MODEL / LOGICAL_CLAUDE_MODEL_MAP / PRESET_MODEL_MAP 四处常量更新 |
| P1-1 | batch 接通 anchor + hyperedge 集成 | ✅ 已实现（变体）| commit `395adfd`：在 buildKnowledgeGraph 之后注入（非 plan.md 设计的之前），结果等价 |
| P2-1 | canonical spec 显式写 sourceKind | ✅ 已实现 | commit `7a872e0`：single-spec-orchestrator 显式传 `sourceKind: 'canonical'` |

## 2. 偏差清单（W-x）与处置

| 偏差 ID | 描述 | 严重 | 处置 |
|---------|------|------|------|
| W-001 | tests/integration/cli-proxy.real-stream.test.ts 未创建（plan.md 文件名）| WARN | 实际创建为 `cli-proxy-token-extraction.test.ts`，post-review 重命名为 `llm-token-extraction.test.ts` 并澄清测试范围（覆盖 SDK 路径，cli-proxy 路径由单测 mock 覆盖）|
| W-002 | tests/batch/graph-hyperedges.regression.test.ts 未创建（真 E2E）| WARN | 接受为已知局限：真 E2E 需 LLM + 长耗时，不适合 CI；用结构性 regression test（`tests/unit/batch-orchestrator-anchor-hyperedge-wiring.test.ts`）替代；真 SLA 验证由 verification 阶段在 graphify-mini fixture 手动执行 |
| W-003 | tests/batch/reading-mode.perf.test.ts 未创建（真 perf）| WARN | 同 W-002，用结构性测试替代 |
| W-004 | BatchOptions.hyperedgesEnabled 字段未暴露 | WARN | 接受：env 变量 `SPECTRA_HYPEREDGES_ENABLED` 已是更标准的 feature flag；后续可作为 enhancement |
| W-005 | READING_SKIP_IDS 不含 product-overview / user-journeys / feature-briefs | WARN | 经核查这 3 个 ID 不在生产 generator 注册表 — 它们是 `product-ux-docs` generator 的子步骤；跳过 `product-ux-docs` 已覆盖整个 product UX 文档生成 |
| W-006 | tests/panoramic/batch-project-docs.test.ts 未更新 | WARN | 实际更新在 `tests/unit/batch-project-docs-mode.test.ts`（路径偏差，内容达标）+ post-review 改为 import 共享常量 |
| W-007 | tests/generator/frontmatter.test.ts canonical case 未新增 | WARN | 实际更新在 `tests/unit/frontmatter-generator.test.ts`（路径偏差，内容达标 — 4 个 case 覆盖 canonical / bundle_copy / derived / 缺省）|

**Post-review 处置后**：所有 WARN 已转为可接受（接受局限）或已修复。

## 3. CHANGELOG breaking change 审查

✅ 合规。`CHANGELOG.md` `[Unreleased]` 下 `### Changed — spectra ⚠️ BREAKING` 节完整描述了 P0-3 的 4 项变更（DEFAULT_CLAUDE_MODEL / opus 逻辑名 / balanced preset / DEFAULT_CODEX_ALIASES），含影响范围 + 用户保留旧行为的建议。

## 4. Spec 文件边界审查

✅ 合规。本次 fix 未触及 `specs/products/spectra/current-spec.md` 或任何历史 spec（132/131/127 等）。

## 5. 读写边界审查

✅ 合规。所有改动均在 spectra 源码（`src/`）和 fix 自身的 `specs/133-*/`、`tests/`、`CHANGELOG.md` 范围内，未触及 `plugins/spec-driver/**` 包装层。

## 6. 总评

**初评**: WARN（7 个 WARNING 多为路径偏差和测试形式选择）
**Post-review 修复后**: ✅ **PASS**（commit `a1fa099` 整合了关键反馈：DRY 清理 + 集成测试命名澄清 + skipEnrichment 单一来源）

无 CRITICAL 偏差，5 个根因全部修复，breaking change 在 CHANGELOG 明确记录，仓库读写边界合规。
