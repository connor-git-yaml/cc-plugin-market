# 需求澄清结果

> Feature: 025-multilang-adapter-layer | 日期: 2026-03-16

---

## 检查摘要

| 检查项 | 结果 |
|--------|------|
| `[NEEDS CLARIFICATION]` 标记 | 未发现（spec 中无此标记） |
| User Stories 验收条件 | 发现 1 处不充分 |
| FR 之间冲突或遗漏 | 发现 2 处遗漏 |
| Edge Cases 覆盖 | 发现 1 处不足 |

**总结：需要澄清 4 个问题。**

---

## 澄清问题（按优先级排序）

### Q1 [P1] context-assembler / llm-client / semantic-diff / noise-filter / secret-redactor 的 TS/JS 硬编码未被 FR 覆盖

**问题描述**：

技术调研报告（Section 1.1，耦合点 #15-#21）明确识别出以下组件包含 TS/JS 硬编码：

| 组件 | 硬编码位置 | 内容 |
|------|-----------|------|
| `context-assembler.ts:76,120` | 代码块标记 | 固定为 `` ```typescript `` |
| `llm-client.ts:481-571` | System Prompt | "导出函数/类/类型"、"TypeScript 代码块"等术语 |
| `semantic-diff.ts:27-34` | 代码块标记 | 固定为 `` ```typescript `` |
| `noise-filter.ts:42` | import 正则 | 仅匹配 JS/TS `import ... from` |
| `secret-redactor.ts:136` | 测试文件检测 | 仅匹配 `.(test|spec).(ts|tsx|js|jsx)$` |

然而 spec 的 FR 仅覆盖了 file-scanner（FR-027/028/029）、编排器（FR-030/031/032）和数据模型（FR-022~026）的参数化。**上述 5 个组件的 TS/JS 硬编码改造未被任何 FR 涵盖**。

这导致一个矛盾：FR-005/FR-019 定义了 `LanguageTerminology` 和 `TestPatterns`，但 spec 中没有 FR 说明谁来消费这些数据。这些术语/模式的产生者（adapter）有定义，但消费者（context-assembler、llm-client 等）的改造缺失。

**需要澄清**：

- 选项 A：本 Feature 范围内增加 FR，要求 context-assembler、llm-client、semantic-diff、noise-filter、secret-redactor 使用 `LanguageTerminology` 和 `TestPatterns` 进行参数化（替换硬编码），以保持完整性。
- 选项 B：本 Feature 仅定义接口和数据结构，上述消费端的参数化推迟到后续 Feature（如 026 或 028）。此时 FR-005/FR-019 的价值在于"预先建立契约"。
- 选项 C：本 Feature 中进行最小改造——将这些组件的硬编码改为从 Registry/adapter 获取，但对 TS/JS 仍返回与当前完全一致的值（满足 FR-035 零行为变更约束）。

**影响**：若选择选项 B，`LanguageTerminology` 和 `TestPatterns` 在本 Feature 中将没有实际消费者，仅作为接口契约存在。这不影响功能正确性，但降低了抽象层的完整性验证。

---

### Q2 [P1] FR-025 的 filePath 硬编码正则与 FR-027 的动态 Registry 方式矛盾

**问题描述**：

- FR-027 要求 file-scanner 的支持扩展名从 `LanguageAdapterRegistry` **动态获取**，不再硬编码。
- 但 FR-025 要求 `CodeSkeleton.filePath` 的 Zod 验证使用一个**静态硬编码的正则**（列举了 `.ts/.tsx/.js/.jsx/.py/.pyi/.go/.java/.kt/.kts/.rs/.cpp/.cc/.cxx/.c/.h/.hpp/.rb/.swift`）。

这意味着：如果未来一个新适配器注册了新的文件扩展名（例如 `.scala`），file-scanner 会动态识别它，但 CodeSkeleton 的 filePath Zod 验证会拒绝它——必须手动修改 `code-skeleton.ts` 中的正则。这与 SC-003（"新增语言适配器仅需实现接口 + 调用一次 `register()`，无需修改核心流水线文件"）矛盾。

**需要澄清**：

- 选项 A：将 `filePath` 的 Zod 验证也改为动态——从 Registry 获取支持的扩展名构建正则。但这引入了 Zod schema 对运行时状态的依赖，增加复杂度。
- 选项 B：保持 FR-025 的静态正则，但在 spec 中明确承认这是一个"已知限制"——新增语言时除了注册 adapter，还需更新 `CodeSkeleton.filePath` 正则。同时修正 SC-003 的措辞，将 `code-skeleton.ts` 排除在"无需修改的核心文件"之外。
- 选项 C：将 `filePath` 验证从正则改为仅检查"有扩展名"（`z.string().regex(/\.\w+$/)`），将具体扩展名验证委托给 Registry 层。

---

### Q3 [P2] User Story 3 的跳过提示缺少输出规格

**问题描述**：

User Story 3 要求"对不支持的文件给出跳过提示"，但验收条件未明确：

1. **输出通道**：提示信息输出到 stdout 还是 stderr？（影响管道化使用）
2. **日志级别**：是 `info`、`warn` 还是 `debug` 级别？（是否在默认 verbosity 下可见）
3. **输出格式**：是逐文件列出（`Skipping: foo.py (unsupported extension .py)`），还是按扩展名聚合（`Skipped 3 .py files, 2 .go files`），还是仅在有跳过时输出一行摘要？
4. **静默模式**：如果用户传入 `--quiet` / 最小输出选项，跳过提示是否应该被抑制？

**需要澄清**：请明确跳过提示的输出通道、日志级别和格式要求，以便实现和测试对齐。

---

### Q4 [P2] Edge Cases 未覆盖：同一文件被多个扩展名规则匹配的复合扩展名场景

**问题描述**：

现有 Edge Cases 覆盖了无扩展名、空扩展名、空 Registry 等场景，但未考虑以下情况：

- **复合扩展名文件**：如 `.d.ts`（TypeScript 声明文件）、`.spec.tsx`（测试文件）。`path.extname('.d.ts')` 返回 `.ts`，`path.extname('.spec.tsx')` 返回 `.tsx`，这在当前 TS/JS 场景下恰好正确。但如果未来存在类似 `.test.py` 的场景，是否需要 adapter 提供更精细的文件分类能力（如区分声明文件 vs 源文件）？
- **大小写变体**：`.TS`、`.Ts`（Windows 用户场景）。`path.extname` 保留原始大小写，`getAdapter('.TS')` 会返回 null（Map 是大小写敏感的）。

建议在 Edge Cases 中明确：
1. `getAdapter()` 的扩展名匹配是否大小写敏感（推荐：统一转为小写后匹配）。
2. 复合扩展名是否只取最后一段（即 `path.extname` 的默认行为），还是需要特殊处理。

---

## 无需澄清的确认项

以下方面 spec 已足够清晰，无需进一步澄清：

- **LanguageAdapter 接口定义**（FR-001~006）：方法签名、可选性、返回类型均明确。
- **Registry 单例模式**（FR-012/013）：生命周期、重置机制清晰。
- **TsJsLanguageAdapter 封装**（FR-014~021）：与现有行为的等价性约束明确。
- **零行为变更约束**（FR-035/036）：验证方法（golden-master 比对）和度量指标（SC-001~007）均可操作。
- **向后兼容性**（FR-026）：纯扩展策略清晰，配合 User Story 4 的验收条件可验证。
