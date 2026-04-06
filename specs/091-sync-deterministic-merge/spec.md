---
feature: 091-sync-deterministic-merge
title: sync 合并算法确定性化
branch: claude/agitated-hamilton
created: 2026-04-06
status: Draft
research_mode: tech-only
---

# Feature 091: sync 合并算法确定性化

## 概述

将 sync 子代理（sync.md）中的确定性合并操作提取为独立的 MJS 脚本（`sync-merge-engine.mjs` + `scripts/lib/sync-*.mjs` 模块组），实现决策与执行分离。Agent 仅保留 LLM 强项的语义决策层（产品归属推断、14 章语义融合、信息推断、摘要生成），Prompt 瘦身至 <5,000 bytes。脚本支持 `--dry-run` 模式预览合并结果，确保同一输入产生确定性输出。

**前置依赖**：本 Feature 在 090 + 092 合并到 master 后执行。

## User Scenarios & Testing

### User Story 1 - 确定性合并结果 (Priority: P1)

作为 spec-driver 用户，我运行 sync 时希望得到可重复、确定性的合并结果，相同的输入 spec 集合始终产出相同的 current-spec.md 骨架结构。

**Why this priority**: 确定性是本 Feature 的核心价值。当前 Prompt 中嵌入的排序、匹配、差集等逻辑由 LLM 执行，每次运行可能产生微妙差异。提取为脚本后，这些操作 100% 可复现，是其余功能的基础。

**Independent Test**: 以固定的 specs/ 目录和 product-mapping.yaml 作为输入，连续运行 `node sync-merge-engine.mjs` 两次，比对 JSON 输出完全一致。

**Acceptance Scenarios**:

1. **Given** 一组固定的 spec 文件和 product-mapping.yaml, **When** 连续运行合并脚本两次, **Then** 两次输出的 JSON（产品分组、时间线、合并骨架）完全一致
2. **Given** 新增一个 spec 到 specs/ 目录, **When** 运行合并脚本, **Then** 新 spec 被正确检测并归入对应产品的时间线中，且不影响其他 spec 的合并结果
3. **Given** 合并脚本独立运行（不依赖 Claude Code 运行时）, **When** 执行 `node sync-merge-engine.mjs --project-root <path>`, **Then** 脚本正常完成并输出结果

---

### User Story 2 - Dry-run 预览合并结果 (Priority: P1)

作为 spec-driver 用户，我希望用 `--dry-run` 预览合并结果再决定是否执行，避免意外修改文件。

**Why this priority**: dry-run 是用户信任确定性引擎的关键机制，也是调试和 CI 场景的刚需。与 Terraform plan 的价值等同。

**Independent Test**: 运行 `node sync-merge-engine.mjs --dry-run --project-root <path>`，验证无文件被修改且输出包含合并预览。

**Acceptance Scenarios**:

1. **Given** 有待合并的 spec 变更, **When** 运行 `--dry-run` 模式, **Then** 输出人类可读的混合格式预览（包含统计摘要和关键变更），且不修改任何文件
2. **Given** 有待合并的 spec 变更, **When** 运行 `--dry-run --json` 模式, **Then** 输出 machine-readable JSON 格式的完整合并计划
3. **Given** 无待合并的变更, **When** 运行 `--dry-run` 模式, **Then** 输出"无变更"的摘要信息

---

### User Story 3 - sync Prompt 精简提升 LLM 遵循度 (Priority: P1)

作为 spec-driver 开发者，我希望 sync.md Prompt 更简洁（<5,000 bytes），只保留语义决策层，LLM 遵循度更高。

**Why this priority**: Prompt 瘦身是决策/执行分离的直接产物。更短的 Prompt 减少 LLM 的遗漏和误解概率，是架构目标的量化体现。

**Independent Test**: 度量瘦身后 sync.md 的文件大小，确认 <5,000 bytes；检查其中不包含排序、匹配、差集等确定性逻辑。

**Acceptance Scenarios**:

1. **Given** 瘦身后的 sync.md, **When** 检查文件大小, **Then** <5,000 bytes
2. **Given** 瘦身后的 sync.md, **When** 审查内容, **Then** 仅保留语义决策层指令（产品归属推断、14 章语义融合、信息推断规则、摘要生成），不包含排序/匹配/差集/格式校验等确定性操作
3. **Given** 瘦身后的 sync.md + 合并引擎, **When** 执行完整 sync 流程, **Then** 产出的 current-spec.md 包含所有 14 个主章节标题、变更历史覆盖全部 spec 编号、FR 数量 >= 当前版本

---

### User Story 4 - 合并逻辑可独立测试、可维护 (Priority: P2)

作为 spec-driver 开发者，我希望合并逻辑拆分为可测试的纯函数模块，便于独立开发和维护。

**Why this priority**: 模块化是长期可维护性的保障。纯函数模块可单独编写单元测试，降低回归风险。

**Independent Test**: 对每个 `scripts/lib/sync-*.mjs` 模块调用其导出函数，验证输入/输出符合预期。

**Acceptance Scenarios**:

1. **Given** `sync-product-mapping.mjs` 模块, **When** 传入 product-mapping.yaml 内容, **Then** 返回解析后的结构化产品映射对象（包含产品名修正和差集检测结果）
2. **Given** `sync-timeline-builder.mjs` 模块, **When** 传入一组 spec 元数据, **Then** 返回按编号排序且带类型标记的时间线数组
3. **Given** `sync-merge-strategy.mjs` 模块, **When** 传入时间线数组, **Then** 返回增量合并后的合并骨架结构
4. **Given** `sync-validator.mjs` 模块, **When** 传入合并结果, **Then** 返回验证报告（功能数量检查、矛盾检测、Markdown 结构校验）

---

### User Story 5 - 降级兼容 (Priority: P2)

作为 spec-driver 用户，当合并脚本不存在或执行失败时，sync 流程仍然可以运行，不会中断。

**Why this priority**: 宪法原则 XIII（降级兼容）要求新引入的确定性层不能成为 sync 的单点故障。

**Independent Test**: 临时重命名 `sync-merge-engine.mjs`，运行 sync 流程，验证 Agent 回退到简化规则并完成聚合。

**Acceptance Scenarios**:

1. **Given** 合并脚本文件不存在, **When** sync Agent 执行聚合流程, **Then** Agent 回退到当前 LLM 全量合并模式（即 091 之前的行为），完成合并并在输出摘要中标注 `[降级: 合并引擎不可用，使用 LLM 全量合并]`
2. **Given** 合并脚本执行返回非零退出码, **When** sync Agent 收到错误, **Then** Agent 回退到 LLM 全量合并模式，在 trace 中记录脚本错误原因和退出码

---

### Edge Cases

- spec.md 缺少标题行或 YAML Front Matter 时，脚本是否能正确解析？（宽松解析，返回 raw text 而非抛异常）
- product-mapping.yaml 不存在时，脚本是否返回空映射而非中断？（返回空映射 + 警告）
- 两个 spec 的编号相同但目录名不同时如何处理？（按目录名字母序排列，记录警告）
- spec 数量为 0 时的产品如何处理？（跳过该产品，记录警告）
- `--dry-run` 和 `--json` 同时指定时的行为？（输出 JSON 格式的 dry-run 结果）
- 超大 spec 目录（>200 个 spec）时的性能表现？（技术调研评估 <1s，暂不优化）

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 提供 `sync-merge-engine.mjs` 入口脚本，支持 `--project-root`、`--dry-run`、`--json` 三个 CLI 参数
- **FR-002**: 系统 MUST 实现 `sync-product-mapping.mjs` 模块，提供 product-mapping.yaml 的读取、产品名自动修正（已知旧名映射为新名）、差集检测（未映射 spec 自动发现）功能，全部为纯函数导出
- **FR-003**: 系统 MUST 实现 `sync-timeline-builder.mjs` 模块，按 spec 编号排序并标记类型（INITIAL / FEATURE / FIX / REFACTOR / ENHANCEMENT），返回结构化时间线数组
- **FR-004**: 系统 MUST 实现 `sync-merge-strategy.mjs` 模块，按类型执行增量合并策略（INITIAL 作为基础、FEATURE 追加、FIX 更新、REFACTOR 替换、ENHANCEMENT 增强），返回合并骨架
- **FR-005**: 系统 MUST 实现 `sync-conflict-resolver.mjs` 模块，当两个 spec 描述同一功能但内容不同时，以编号更大者优先，在合并骨架中记录取代关系
- **FR-006**: 系统 MUST 实现 `sync-validator.mjs` 模块，对合并结果执行三项验证：功能数量 >= INITIAL spec 功能数量、无矛盾描述、变更历史覆盖所有归属 spec
- **FR-007**: `--dry-run` 模式 MUST 不修改任何文件，输出混合格式预览（统计摘要 + 关键变更）；配合 `--json` 时输出 machine-readable JSON
- **FR-008**: sync.md MUST 瘦身至 <5,000 bytes，仅保留语义决策层指令：产品归属内容分析推断（Section 2.2）、14 章语义融合（Section 4）、信息推断规则表、摘要生成
- **FR-009**: 瘦身后的 sync.md MUST 包含降级路径描述：当脚本不可用时，Agent 回退到 091 之前的 LLM 全量合并模式（即在 Prompt 中保留当前合并逻辑的精简摘要作为降级指令，约 500 bytes）
- **FR-010**: 合并脚本 MUST 可通过 `node sync-merge-engine.mjs --dry-run --project-root <path>` 独立运行，不依赖 Claude Code 运行时（宪法原则 X）
- **FR-011**: 合并脚本输出 JSON 中 MUST 包含 `schemaVersion` 字段，供 Agent Prompt 校验接口兼容性
- **FR-012**: 所有 `scripts/lib/sync-*.mjs` 模块 MUST 为纯函数导出（不做 side effect），文件 I/O 仅在入口脚本中完成

### Key Entities

- **MergeEngine**：CLI 入口，编排所有 lib 模块的调用顺序和 I/O
- **ProductMapping**：产品->spec 的归属映射关系，持久化为 product-mapping.yaml
- **Timeline**：单个产品的 spec 时间线，按编号排序并带类型标记
- **MergeSkeleton**：合并骨架，包含按 14 章结构组织的合并结果（新增/更新/取代的 FR、User Stories 等）
- **ConflictRecord**：冲突记录，描述哪个 spec 被哪个更新的 spec 取代
- **ValidationReport**：验证报告，包含三项检查的通过/失败状态和详细信息
- **DryRunPreview**：dry-run 输出结构，包含统计摘要和关键变更列表

## Success Criteria

### Measurable Outcomes

- **SC-001**: sync.md 文件大小 <5,000 bytes
- **SC-002**: 同一 specs/ 目录和 product-mapping.yaml 作为输入，连续运行合并脚本 N 次，JSON 输出完全一致（确定性）
- **SC-003**: `--dry-run` 模式运行前后，工作目录中无文件被创建、修改或删除
- **SC-004**: 合并脚本可通过 `node sync-merge-engine.mjs --dry-run --project-root <path>` 独立运行并正常退出（exit code 0）
- **SC-005**: `npm run repo:check` 通过
- **SC-006**: 每个 `scripts/lib/sync-*.mjs` 模块的导出函数均为纯函数（给定相同输入返回相同输出，无副作用）

## Non-Functional Requirements

- **NFR-001**: 合并脚本只使用 Node.js 内置模块（`fs`, `path`, `process`），零 npm 依赖（宪法原则 X）
- **NFR-002**: 脚本遵循现有 `scripts/lib/` 的模块化风格：`.mjs` 后缀、ES Module、`import.meta.url` 守卫、驼峰命名（宪法原则 III YAGNI——与现有风格一致即可）
- **NFR-003**: 脚本复用现有 helper：`simple-yaml.mjs`（YAML 解析）、`product-artifact-paths.mjs`（路径管理）、`script-report-io.mjs`（文件写入）
- **NFR-004**: 错误处理遵循现有模式：关键文件缺失抛 Error（中文错误信息）、可选文件缺失返回 null/默认值、警告收集在 warnings 数组中一次性输出
- **NFR-005**: Agent 与脚本之间通过 JSON 接口通信，JSON 包含 `schemaVersion` 字段防止接口漂移

## Constraints & Boundaries

### 范围内

- 提取 sync.md 中所有可确定性执行的操作到脚本（映射读写、名称修正、差集检测、排序、合并策略、冲突解决、验证）
- sync.md Prompt 瘦身至 <5,000 bytes
- `--dry-run` + `--json` CLI 模式
- 降级兼容路径

### 范围外

- 不改变 sync 的整体编排流程（仍由 sync Agent 驱动）
- 不扩展合并功能（YAGNI——只提取当前已有的确定性操作）
- 不引入 npm 依赖
- 不修改 current-spec.md 的 14 章模板结构
- 不修改 entity.yaml / catalog-index.yaml 等后置 helper 的生成逻辑

## Architecture Notes

### 执行流程

采用技术调研推荐的 **Plan-then-Execute** 模式（LangGraph 风格）：

1. sync Agent 调用 `sync-merge-engine.mjs` 执行确定性预处理
2. 脚本返回结构化 JSON（产品分组 + 时间线 + 合并骨架 + 验证结果）
3. sync Agent 接收 JSON，执行语义融合（14 章内容），生成 current-spec.md
4. sync Agent 调用脚本执行后验证（可选）

### 模块拆分

```
scripts/
  sync-merge-engine.mjs          # CLI 入口（--dry-run, --json, --project-root）
  lib/
    sync-product-mapping.mjs     # product-mapping.yaml 读写、产品名修正、差集检测
    sync-timeline-builder.mjs    # 按编号排序 + 类型标记
    sync-merge-strategy.mjs      # 增量合并策略
    sync-conflict-resolver.mjs   # 冲突解决：编号更大优先
    sync-validator.mjs           # 功能数量检查、矛盾检测、Markdown 结构校验
```

### Agent 保留的语义层（<5,000 bytes）

- Section 2.2 内容分析推断产品归属（需 LLM 理解 spec 内容）
- Section 4 的 14 章语义融合（综合描述提炼、用户画像推断等）
- 信息推断规则（User Stories -> 用户画像）
- 对外文档摘要生成
- 降级路径描述（约 500 bytes）

### 接口契约

**脚本输出方向（脚本 → Agent）**：脚本通过 stdout 输出 JSON，包含以下顶层字段：
- `schemaVersion`: 接口版本号（语义化版本，如 "1.0.0"）
- `products`: 产品分组结果（每个产品含 timeline + mergeSkeleton）
- `unmappedSpecs`: 未映射 spec 列表
- `validation`: 验证结果
- `warnings`: 警告列表
- `stats`: 统计摘要

**脚本写入范围（正常模式）**：脚本在正常模式（非 dry-run）下，除了 stdout JSON 外，仅写入 `product-mapping.yaml` 的差集更新（新发现的 spec 归属、产品名修正）。current-spec.md 由 Agent 根据脚本 JSON + 语义融合后写入。

**schemaVersion 不匹配处理**：Agent Prompt 声明期望的 schema version。若脚本输出的 schemaVersion major 版本不一致，Agent 回退到降级路径；minor/patch 不一致则正常消费并在 trace 中记录警告。

**无效路径处理**：`--project-root` 指向不存在的路径时，脚本输出 JSON 错误（`{ "error": "...", "code": "INVALID_PROJECT_ROOT" }`）并以 exit code 1 退出。

### 并发假设

sync 流程不支持并发调用（即不允许多个 Agent 同时调用合并脚本操作同一 project-root）。脚本不做文件锁，依赖编排层保证单一执行。

## Dependencies & Impacts

### 前置依赖

- Feature 090 和 Feature 092 已合并到 master
- 具体依赖：092 向 sync.md 追加矛盾检测审查维度；091 从 092 更新后的 sync.md 出发进行瘦身，确保矛盾检测逻辑被正确分配（确定性部分进脚本 sync-validator.mjs，语义部分保留在 Prompt）

### 影响范围

- `sync.md`：Prompt 内容大幅重写（瘦身）
- `scripts/sync-merge-engine.mjs`：新增入口脚本
- `scripts/lib/sync-*.mjs`：新增 5 个纯函数模块
- sync 编排流程：Agent 调用脚本的交互方式变更

### 风险

| # | 风险 | 影响 | 概率 | 缓解措施 |
|---|------|------|------|---------|
| R1 | spec.md Markdown 结构多样性导致脚本解析失败 | 高 | 中 | 宽松 section parser，解析失败返回 raw text 而非抛异常 |
| R2 | 确定性/语义边界模糊，某些操作误判为确定性 | 中 | 中 | 初始版本保守划界，模糊操作留给 Agent |
| R3 | 脚本不可用时 sync 流程中断 | 高 | 低 | Prompt 保留降级路径 + 脚本返回明确错误码 |
| R4 | Agent 与脚本的 JSON 接口契约漂移 | 中 | 中 | JSON 包含 schemaVersion 字段 |
| R5 | 合并骨架与 Agent 语义融合产出的结构脱节 | 中 | 低 | 骨架采用与 product-spec-template.md 相同的 14 章结构 |
