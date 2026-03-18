# 技术决策记录: 多语言混合项目支持（Feature 031）

**Feature Branch**: `031-multilang-mixed-project`
**日期**: 2026-03-18

## 决策索引

| # | 决策 | 结论 | 影响范围 |
|---|------|------|---------|
| TD-001 | 扫描分流 vs 后置分组 | 方案 B: Post-Scan Grouping | `file-scanner.ts`, `batch-orchestrator.ts` |
| TD-002 | 多语言依赖图合并策略 | 选项 C: 合并仅用于拓扑排序 | `batch-orchestrator.ts`, `index-generator.ts` |
| TD-003 | 同目录多语言子模块命名 | 选项 B: 双连字符 `--lang` | `module-grouper.ts`, `BatchState` |
| TD-004 | 非 JS/TS 语言的依赖图策略 | `buildDirectoryGraph` 基于 AST import | `directory-graph.ts`（新增） |
| TD-005 | 跨语言边界标注 | MVP 仅标注，不精确检测 | `single-spec-orchestrator.ts` |
| TD-006 | 架构索引语言分布范围 | 展示全部语言 + 处理状态标注 | `index-generator.ts`, `index-spec.hbs` |

---

## TD-001: 扫描分流 vs 后置语言分组

### 背景

需要让 `batch-orchestrator` 能按语言分别处理文件。有两种时机进行语言分组：
- **方案 A**: 在 `scanFiles` 阶段即按语言分流，返回 `Map<adapterId, string[]>`
- **方案 B**: 沿用现有 `scanFiles` 返回 `string[]`，在 `batch-orchestrator` 中后置分组

### 评估

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| `ScanResult.files` 返回类型 | **Breaking change** (→ `Map`) | 不变（`string[]`） |
| 影响的调用方 | `single-spec-orchestrator`, `batch-orchestrator`, MCP 工具 | 仅 `batch-orchestrator` |
| 性能 | 一次遍历分流 | 二次遍历 O(n)，可忽略 |
| 可维护性 | 所有调用方需适配新返回类型 | 分组逻辑内聚在 batch 层 |
| 向后兼容 | 否 | 是 |

### 决策

**方案 B: Post-Scan Grouping**。向后兼容是最关键因素——`scanFiles` 的调用点分布在 `single-spec-orchestrator`、MCP 工具等多处，改动影响面过大。二次遍历的 O(n) 代价对 <5000 文件项目可完全忽略。

---

## TD-002: 多语言依赖图合并策略

### 背景

`batch-orchestrator` 需要从多个语言各自的 `DependencyGraph` 中确定全局模块处理顺序。每个图包含 `modules`、`edges`、`sccs` 和 `mermaidSource`。问题是如何合并。

### 选项

- **A) 合并后重新计算**: 所有图合并为一个，重新运行 SCC + 拓扑排序 + Mermaid
- **B) 各语言完全独立**: 每种语言独立处理，不存在全局拓扑排序
- **C) 合并用于拓扑排序，SCC/Mermaid 独立保留**: 仅 `modules` + `edges` 合并用于全局处理顺序

### 评估

选项 A 的问题：跨语言不存在 import 边，合并后的 SCC 不会包含跨语言循环，Mermaid 图可能因节点过多而不可读。
选项 B 的问题：`batch-orchestrator` 需要一个全局的 `processingOrder`，完全独立意味着需要两层循环（外层语言，内层模块），复杂度更高。
选项 C 的优势：全局拓扑排序保证叶子模块先处理（跨语言间无依赖，相对顺序不影响正确性），而 SCC/Mermaid 在各语言上下文中更有意义。

### 决策

**选项 C**。技术上最合理——跨语言无 import 边是客观事实，合并 SCC 无意义。架构索引按语言展示依赖图，可读性更好。

---

## TD-003: 同目录多语言子模块命名

### 背景

FR-005 要求同目录下不同语言文件拆分为不同子模块。需要确定子模块的命名约定。

### 选项

| 选项 | 格式 | 文件系统兼容 | 可读性 |
|------|------|:-----------:|:-----:|
| A | `services[ts]` | 差（方括号需转义） | 好 |
| B | `services--ts` | **好** | **好** |
| C | `services.ts-lang` | 好 | 一般（与扩展名混淆） |
| D | `services/ts` | 好 | 好（但改变目录结构） |

### 决策

**选项 B: `services--ts`**。双连字符在所有主流文件系统和 shell 中无特殊含义，且在视觉上与普通连字符模块名（如 `auth-service`）明显区分。选项 D 会改变 spec 文件的目录结构，增加不必要的嵌套。

**触发条件**: 仅在同一目录下检测到 >=2 种语言时追加语言后缀。单语言目录保持原模块名不变，确保向后兼容。

---

## TD-004: 非 JS/TS 语言的依赖图策略

### 背景

当前仅 `TsJsLanguageAdapter` 通过 dependency-cruiser 实现了 `buildDependencyGraph`。Python/Go/Java 适配器没有此能力。需要为这些语言提供兜底的依赖图。

### 方案

`buildDirectoryGraph()` 基于两个信息源构建轻量级依赖图：
1. **目录结构**: 文件路径隐含的层级关系
2. **AST import 推断**: `CodeSkeleton.imports` 中 `isRelative: true` 的 import 语句

### 精度评估

| 语言 | 能正确处理 | 无法处理 | 精度 |
|------|-----------|---------|:----:|
| Python | `from .utils import x`, `from ..models import y` | `import mypackage.submod`（需 pyproject.toml） | 中 |
| Go | `"./internal/utils"` | `"github.com/user/repo/pkg"`（始终忽略） | 中-高 |
| Java | 相对路径 import（少见） | 几乎所有 import（Java 用全限定名） | 低 |

### 决策

采用 `buildDirectoryGraph` 作为通用兜底方案。精度不足的部分通过以下方式缓解：
- Spec 中标注 `confidence: 'medium'`
- 依赖图标注为"基于目录结构推断"
- 未来各适配器可实现精确的 `buildDependencyGraph` 替代兜底方案

---

## TD-005: 跨语言边界标注策略

### 背景

CQ-001 要求在多语言项目的 Spec 中提示可能存在 AST 不可见的跨语言调用。

### 策略

**MVP 仅做两层标注**:

1. **import 路径推断**: 如果模块 A 的 import 路径解析后落入语言 B 的文件组中，在 A 的 frontmatter 中标注 `crossLanguageRefs`
2. **通用提示文本**: 当项目为多语言时（`languageStats` >= 2 种语言），在每个 Spec 的 `constraints` section 末尾追加：

> "注意：本项目包含多种编程语言（{languages}），模块间可能存在 AST 不可见的隐式跨语言调用（如 REST API、gRPC、FFI、subprocess 等），建议人工审查跨语言交互边界。"

**不尝试精确检测**: REST/gRPC/FFI/subprocess 等调用方式在 AST 中不表现为 import 语句，精确检测需要配置文件声明或 LLM 辅助分析，超出 MVP 范围。

---

## TD-006: 架构索引语言分布的展示范围

### 背景

CQ-003 确认了 `--languages` 过滤时，架构索引仍展示全部检测到的语言。需要确定展示格式。

### 决策

语言分布表格始终基于 `scanFiles` 的完整 `languageStats`（全量扫描结果），新增 `processed` 列标注本次是否处理。

示例输出：

| 语言 | 文件数 | 模块数 | 占比 | 本次处理 |
|------|--------|--------|------|---------|
| TypeScript | 30 | 8 | 54.5% | 是 |
| Python | 15 | 4 | 27.3% | 否 |
| Go | 10 | 3 | 18.2% | 否 |

**单语言项目处理**: 当 `languageStats` 仅包含 1 种语言时，不渲染"语言分布"章节（FR-008），保持与现有行为兼容。
