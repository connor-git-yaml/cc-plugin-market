# Research: 修复 Batch LLM 调用默认配置

**Date**: 2026-02-14
**Branch**: `007-fix-batch-llm-defaults`

## 研究背景

本特性的三个问题均已通过在真实项目 (openclaw) 上的实际调试确认根因，无需额外研究。以下记录调试发现和技术决策。

## Decision 1: 默认模型选择

**Decision**: 将默认模型从 `claude-opus-4-6` 改为 `claude-sonnet-4-5-20250929`

**Rationale**:
- 在 openclaw 项目的 `shared` 模块（仅 2 个文件）上实测：
  - Opus: >120s 超时，无法完成
  - Sonnet: ~90s 完成，质量满足需求
- Batch 场景通常处理 20-50 个模块，Opus 的累计时间不可接受
- Constitution 技术栈约束中明确列出 "Claude 4.5/4.6 Sonnet/Opus"，两者均为合规选项

**Alternatives considered**:
- 保持 Opus 但增大超时 → 拒绝：总时间仍然太长，batch 50 个模块需要数小时
- 使用 Haiku → 拒绝：spec 生成需要较强的分析能力，Haiku 质量不足

## Decision 2: 提示词去重策略

**Decision**: 从 `prepareContext` 移除 `templateInstructions` 注入，保留 `callLLM` 层的注入

**Rationale**:
- `assembleContext` 的 `templateInstructions` 本意是提供模板指令，但被误用为注入系统提示词
- `callLLMviaSdk` 有专门的 `system` 参数，这是 Claude API 的标准做法
- `callLLMviaCliProxy` 通过 stdin 传入 prompt，需要手动拼接系统提示词
- 将职责统一到 `callLLM` 层最清晰：上下文组装只负责内容，LLM 调用负责通信协议

**Alternatives considered**:
- 保留 `templateInstructions` 注入，移除 `callLLM` 层的注入 → 拒绝：SDK 路径的 `system` 参数是 Claude API 推荐的做法，不应放弃
- 在 `assembleContext` 中检测重复 → 拒绝：过于复杂，职责不清

## Decision 3: 动态超时策略

**Decision**: 基于模型名称模式匹配确定超时时间

**Rationale**:
- Claude 模型命名有稳定的模式：`claude-opus-*`、`claude-sonnet-*`、`claude-haiku-*`
- 不需要维护完整的模型注册表，简单的字符串包含检测即可
- 超时值基于实测数据：
  - Opus: 实测单模块 >120s，设置 300s (5min)
  - Sonnet: 实测单模块 ~90s，设置 120s (2min)
  - 未知模型: 保守设置 180s (3min)

**Alternatives considered**:
- 固定超时但增大到 300s → 拒绝：Sonnet 用户不应等待 5 分钟才发现超时
- 用户手动配置超时 → 拒绝：增加用户负担，违反 "无需额外配置" 的成功标准
