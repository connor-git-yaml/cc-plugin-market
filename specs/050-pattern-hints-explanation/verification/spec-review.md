# Spec Review: 架构模式提示与解释

## 功能需求对齐

| FR | 描述 | 状态 | 对应 Task | 说明 |
|----|------|------|----------|------|
| FR-001 | 实现 `PatternHintsGenerator` | ✅ 已实现 | T003, T014, T016, T033, T034 | generator、输入输出与 registry 接入已落地 |
| FR-002 | 以 045 结构化输出为主输入 | ✅ 已实现 | T014, T016 | `extract()` 组合调用 `ArchitectureOverviewGenerator`，未重复解析底层事实 |
| FR-003 | 输出 pattern hints 结构化结果 | ✅ 已实现 | T006-T008, T015-T018 | `PatternHintsModel` / `PatternHint` / `PatternAlternative` 已建立 |
| FR-004 | 以内嵌附录方式挂接到架构概览 | ✅ 已实现 | T009, T017, T018 | `render()` 复用 045 正文并拼接 050 附录 |
| FR-005 | 至少一个模式提供 why/why-not explanation | ✅ 已实现 | T019-T024 | explanation 生成逻辑与测试均已覆盖 |
| FR-006 | 保留 evidence 引用 | ✅ 已实现 | T006, T019, T022-T024 | evidence 引用贯穿模式判断与 explanation |
| FR-007 | 支持多模式并列与 competing alternatives | ✅ 已实现 | T019-T024 | composite fixture 可同时命中多个模式 |
| FR-008 | 输入不完整时静默降级 | ✅ 已实现 | T025-T030 | deployment 缺失 / warnings / confidence downgrade 已覆盖 |
| FR-009 | 无高置信度模式时输出明确结论 | ✅ 已实现 | T013, T030 | no-match 结构和模板渲染已落地 |
| FR-010 | 维护内置知识库 / 规则目录 | ✅ 已实现 | T002, T007, T015, T039 | `pattern-knowledge-base.ts` 已落地并支持自定义注入 |
| FR-011 | 模板细节不进入共享模型 | ✅ 已实现 | T001, T006, T035, T038 | `PatternHintsModel` 与模板严格分离 |
| FR-012 | `useLLM=true` 时增强 explanation 文案 | ✅ 已实现 | T026, T029 | LLM enhancer 已实现且不改变结构化事实 |
| FR-013 | LLM 不可用时继续输出规则结果 | ✅ 已实现 | T026-T030 | 测试覆盖 fallback 行为 |
| FR-014 | 弱依赖可用时复用 043 / 044 增强 explanation | ⏭️ 部分实现 / 非阻塞 | T028-T030, T044 | 043 证据已通过 045 evidence 透传；044 doc-graph 仅保留 weak-signal warning，未做深度增强 |
| FR-015 | 注册到 registry 并导出 barrel | ✅ 已实现 | T031-T039 | `generator-registry.ts` 与 `index.ts` 已接入 |

## 覆盖率摘要

- **总 FR 数**: 15（其中 Mandatory 13，Optional 2）
- **Mandatory 已实现**: 13
- **Optional 已实现**: 1（FR-012）
- **Optional 部分实现 / 不阻塞**: 1（FR-014）
- **覆盖率**: 100%（Mandatory）

## 审查结论

- CRITICAL: 0
- WARNING: 0
- INFO: 1

非阻塞说明：

1. `FR-014` 中对 044 doc-graph 证据的 explanation 增强尚未接入，当前仅保留 weak-signal warning；不影响 050 的主验收与共享模型边界。
