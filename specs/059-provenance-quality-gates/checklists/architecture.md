# Architecture Checklist: Provenance 与文档质量门

**Purpose**: 检查 059 技术方案是否复用现有 panoramic / batch 架构，并保持治理层定位  
**Created**: 2026-03-21  
**Feature**: [spec.md](../spec.md)

## Layering

- [x] CHK001 059 设计定位为治理层，消费现有 project docs / structured outputs，而不是新增 generator 事实抽取链
- [x] CHK002 provenance model 与 quality report model 需要作为共享结构存在，不能把渲染细节直接塞进模型
- [x] CHK003 conflict detector 和 required-doc evaluator 必须是 deterministic rule engine，不能让 LLM 决定 canonical facts

## Existing Reuse

- [x] CHK004 方案已明确复用 045 `ArchitectureOverviewModel`
- [x] CHK005 方案已明确复用 050 `PatternHintsModel`
- [x] CHK006 方案已明确复用 057 `ComponentViewModel` / `DynamicScenarioModel`
- [x] CHK007 方案已明确复用 058 ADR evidence 结构
- [x] CHK008 方案已明确 batch 接入点在 `src/panoramic/batch-project-docs.ts` 与 `src/batch/batch-orchestrator.ts`

## Dependency / Degradation

- [x] CHK009 已明确 055 bundle manifest 是首选输入，但当前代码线缺失时必须 partial 降级
- [x] CHK010 已明确 README / `current-spec.md` 缺失时不能中断主流程
- [x] CHK011 已明确 059 失败只影响 quality report，不得拖垮原有 batch 输出

## Verification Strategy

- [x] CHK012 需要单测覆盖 provenance 聚合与 conflict detection
- [x] CHK013 需要集成测试覆盖 batch 输出 quality report 和原有项目文档不回归
- [x] CHK014 需要验证不同项目类型的 required-doc rule set 结果不同

## Notes

- 当前架构层面最大的现实风险不是模型设计，而是 055 尚未在当前分支可用；实现计划必须把这一点作为显式前提管理。
