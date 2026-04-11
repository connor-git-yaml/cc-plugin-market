# Feature Specification: Spec 质量全面超越纯 LLM — 混合策略

**Feature Branch**: `097-spec-quality-parity`
**Created**: 2026-04-11
**Status**: Draft
**Input**: 基于 graphify 的 reverse-spec vs 纯 LLM 逐章节对比数据，实现全面超越

---

## 背景数据

对 graphify 项目的质量评分（10 分制）：

| 章节 | reverse-spec 当前 | 纯 LLM v2 | 差距 | 根因 |
|------|------------------|-----------|------|------|
| Section 3 接口定义 | **2/10** | 8/10 | -6 | LLM 说"70+ 符号"但没生成表格；AST 骨架有完整 exports 却未直接渲染 |
| Section 4 数据结构 | **1/10** | 9/10 | -8 | AST 不提取 `@dataclass`/`TypedDict` 字段；LLM 无上下文无法生成 |
| Section 8 测试覆盖 | **5/10** | 8/10 | -3 | 不读取实际测试文件，只能推断 |
| Section 5 约束条件 | **7/10** | 9/10 | -2 | 代码切片没有特意提取常量定义 |
| Section 7 技术债务 | **7/10** | 8/10 | -1 | LLM 上下文不够深，发现不了所有 pattern |

核心洞察：**Section 3 和 4 完全可以由 AST 直接生成，不需要 LLM 参与。当前问题是 AST 数据"有"但没有"用"。**

---

## 用户场景与测试方案

### User Story 1 — AST 直出接口定义（Priority: P1）

作为 reverse-spec 用户，我希望 Section 3（接口定义）直接由 AST 骨架生成按子模块分组的函数/类表格（含参数和行为摘要），不依赖 LLM 也能有高质量输出。

**优先级理由**：当前差距最大的章节（2/10 vs 8/10），且 AST 骨架已包含完整 exports 信息（名称、类型、签名、成员），只需格式化即可，无需 LLM。

**独立测试方案**：对 graphify 执行 generate（无 LLM 环境），Section 3 应包含按文件分组的函数表格。

**验收场景**：

1. **Given** 模块含 70+ 导出符号，**When** 执行 generate，**Then** Section 3 包含按源文件分组的表格，每行含函数名、类型、签名
2. **Given** LLM 也生成了接口描述，**When** 两者合并，**Then** AST 表格作为基础，LLM 的行为摘要追加到表格的"说明"列
3. **Given** 类含 members（方法/属性），**When** 生成接口定义，**Then** 类条目展开为子表格列出公共成员

---

### User Story 2 — AST 直出数据结构（Priority: P1）

作为 reverse-spec 用户，我希望 Section 4（数据结构）直接从 AST 提取 `@dataclass`、`TypedDict`、`interface`、`type`、`enum` 的字段级定义，不依赖 LLM。

**优先级理由**：当前差距第二大（1/10 vs 9/10），但根因清晰——AST 已经能识别 `kind: 'class'` 和 `kind: 'interface'` 的 exports，只缺字段提取。

**验收场景**：

1. **Given** Python 模块含 `@dataclass` 类（如 LanguageConfig），**When** 执行 generate，**Then** Section 4 包含该类的字段表格（字段名、类型、默认值）
2. **Given** TypeScript 模块含 `interface` 或 `type` 定义，**When** 执行 generate，**Then** Section 4 包含属性表格

---

### User Story 3 — 解锁 token 预算（Priority: P1）

作为使用 1M context 模型的用户，我希望 token 预算不再限制为 100k，使 LLM 能看到更多代码上下文（包括完整函数体而非仅控制流切片）。

**优先级理由**：当前 100k 预算是 LLM 只能看到骨架 + 切片的根因。1M context 模型下，可以直接传入完整源码，让 LLM 理解更深。

**验收场景**：

1. **Given** 模型 context 为 1M，**When** 执行 generate，**Then** maxTokens 默认值提升到 500k
2. **Given** 模块含 5000 行代码，**When** 生成上下文，**Then** 完整函数体纳入 LLM prompt 而非仅控制流切片
3. **Given** 切片提取的 40k 预算限制，**When** 使用大 context 模型，**Then** 切片预算按比例扩大到 200k

---

### User Story 4 — 混合渲染管线（Priority: P2）

作为 reverse-spec 的维护者，我希望每个 Section 采用最优的生成策略（AST 直出 / LLM 生成 / 混合合并），而非统一依赖 LLM。

**优先级理由**：这是架构层面的改进——某些 Section 用 AST 比 LLM 更精确（接口定义、数据结构、依赖关系），某些用 LLM 更好（意图、业务逻辑、技术债务），最佳方案是混合。

**验收场景**：

1. **Given** Section 3（接口定义）和 Section 4（数据结构），**When** 渲染 spec，**Then** 使用 AST 直接生成内容，LLM 的对应输出作为补充追加
2. **Given** Section 1（意图）和 Section 2（业务逻辑），**When** 渲染 spec，**Then** 使用 LLM 生成内容，AST 骨架作为事实校验基础
3. **Given** Section 9（依赖关系），**When** 渲染 spec，**Then** Mermaid 图由 AST 生成，文字描述由 LLM 生成

---

### User Story 5 — 测试文件感知（Priority: P3）

作为查阅 Section 8 的开发者，我希望 spec 能列出实际存在的测试文件和测试函数数量，而非仅给出推断性建议。

**验收场景**：

1. **Given** 项目含 `tests/` 目录，**When** 生成 spec，**Then** Section 8 列出测试文件清单和测试函数计数

---

### 边界场景

- 无导出符号的模块：Section 3 应显示"本模块无公共导出"而非空白
- 无 `@dataclass`/`interface` 的模块：Section 4 由 LLM 描述数据流中的隐式结构
- 超大模块（> 20000 行）：即使 token 预算解锁，仍需分块策略
- 无 LLM 降级：AST 直出的 Section 3/4/9 不受影响

---

## 功能需求

### 功能需求清单

- **FR-001**：系统 MUST 在渲染 Section 3（接口定义）时，从 `skeleton.exports` 直接生成按源文件分组的函数/类表格（含名称、类型、签名），不依赖 LLM 输出。**[必须]** `[追踪: US-1]`

- **FR-002**：当 LLM 也生成了接口描述时，系统 MUST 将 LLM 的行为摘要合并到 AST 表格的"说明"列，采用"AST 结构 + LLM 语义"的混合策略。**[必须]** `[追踪: US-1, US-4]`

- **FR-003**：系统 MUST 在渲染 Section 4（数据结构）时，从 AST 提取 `kind: 'class'` / `kind: 'interface'` / `kind: 'type'` / `kind: 'enum'` 的 exports，展开其 members 为字段表格。**[必须]** `[追踪: US-2]`

- **FR-004**：对于 Python `@dataclass`，系统 MUST 提取类级字段定义（非 `__init__` 中的 `self.xxx`），包含字段名、类型注解、默认值。**[必须]** `[追踪: US-2]`

- **FR-005**：系统 MUST 将 `assembleContext` 的默认 `maxTokens` 从 100,000 提升到 500,000，代码切片的 token 预算从 40,000 提升到 200,000。**[必须]** `[追踪: US-3]`

- **FR-006**：当完整源文件可用且在 token 预算内时，系统 SHOULD 优先传入完整函数体而非仅控制流切片，使 LLM 能理解完整实现细节。**[应当]** `[追踪: US-3]`

- **FR-007**：系统 MUST 实现混合渲染策略：Section 3/4/9 优先使用 AST 直出内容，Section 1/2/5/6/7/8 优先使用 LLM 内容。当某侧缺失时，使用另一侧作为 fallback。**[必须]** `[追踪: US-4]`

- **FR-008**：系统 SHOULD 在预处理阶段扫描 `tests/` 目录，统计测试文件数和测试函数名，将结果注入 LLM 上下文以生成更准确的 Section 8。**[应当]** `[追踪: US-5]`

- **FR-009**：AST 直出的 Section 3/4/9 在无 LLM 环境下 MUST 正常工作，不降级为空白。**[必须]** `[追踪: 边界场景]`

- **FR-010**：对 Python `@dataclass` 的字段提取 MUST 通过 tree-sitter AST 实现（遍历 class body 的 typed_assignment / assignment 节点），不依赖 LLM。**[必须]** `[追踪: US-2]`

### 关键实体

- **HybridSection**：混合渲染的单章节数据，包含 `astContent`（AST 直出）和 `llmContent`（LLM 生成），渲染时按策略合并
- **DataclassField**：从 AST 提取的类字段定义，包含 name、type、default、isOptional

---

## 成功标准

### 可测量结果

- **SC-001**：对 graphify 执行 generate 后，Section 3 包含按文件分组的 70+ 函数表格（当前为空或仅标题），评分 ≥ 8/10
- **SC-002**：对 graphify 执行 generate 后，Section 4 包含 LanguageConfig / FileType 的字段级定义（当前为空白），评分 ≥ 8/10
- **SC-003**：无 LLM 环境下 Section 3/4/9 的内容量 ≥ AST 直出的 80%（不降级为空白）
- **SC-004**：LLM 上下文 token 数从 ~50k 提升到 ~200k+，Section 2（业务逻辑）和 Section 7（技术债务）的描述深度提升
- **SC-005**：综合评分从 6.1/10 提升到 ≥ 8.0/10，全面超越纯 LLM 的 7.9/10

---

## 复杂度评估

| 维度 | 数值 / 描述 |
|------|------------|
| 组件总数 | 2 新增（AST Section 渲染器、混合合并器）+ 4 修改（orchestrator、assembler、python-mapper、模板） |
| 复杂度信号 | dataclass 字段提取需 AST 遍历；混合合并需处理 AST/LLM 内容对齐 |
| 总体复杂度 | **MEDIUM** |
