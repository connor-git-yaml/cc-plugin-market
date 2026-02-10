# Reverse-Spec Skill System (v2.0) 规格文档

> **文档类型**: Meta-Spec (元规格说明书)
> **版本**: 2.0 (AST-Enhanced Edition)
> **状态**: Draft / Planning
> **置信度**: High (基于 v1 验证与业界最佳实践)
> **生成方式**: Manual (AI Assisted)
> **相关文件**: `skills/reverse-spec/*`, `package.json`, `tsconfig.json`

## 1. 意图 (Intent)

本项目旨在构建一套用于 Claude Code 的 **AI Agent Skill 套件**，核心目标是将非结构化的遗留源代码逆向工程为结构化、可维护、可机器读取的 **Spec 文档**。

与 v1 版本（纯 LLM 阅读）不同，v2 版本通过引入 **静态分析 (AST)** 和 **依赖图谱** 技术，解决大规模代码库（50万行+）中的上下文丢失、幻觉和引用不准确问题，实现“遗留代码资产化”和“Spec 驱动开发 (SDD)”的闭环。

## 2. 接口定义 (Interface)

### Slash Commands (用户指令)

| 指令 | 参数 | 描述 | 增强特性 (v2) |
| :--- | :--- | :--- | :--- |
| `/reverse-spec` | `<target> [--deep]` | 生成单个/一组文件的 Spec | 自动注入 Mermaid 类图/流程图 |
| `/reverse-spec-batch` | `[--force]` | 全项目批量生成 | 基于依赖图谱的拓扑排序生成 |
| `/reverse-spec-diff` | `<spec> <src>` | 检测 Spec 与代码的漂移 | 基于 AST 的语义级 Diff (忽略格式变更) |

### 内部工具链 API (Local Tools)

Skill 脚本将调用以下本地 Node.js 工具（而非仅依赖 LLM）：

* `ast-analyzer.analyze(files)`: 返回符号表 (Symbol Table) 和接口签名。
* `graph-gen.dependency(root)`: 返回模块依赖的 JSON 结构及 Mermaid 源码。
* `diff-engine.compare(oldAST, newAST)`: 返回结构化差异报告。

### 输出制品 (Artifacts)

1.  **Module Spec**: `specs/*.spec.md` (包含 YAML Frontmatter, 9段式正文, Mermaid 图表)。
2.  **Architecture Index**: `specs/_index.spec.md` (包含全局架构图, 模块映射表)。
3.  **Drift Report**: `drift-logs/*.md` (仅在检测到漂移时生成)。

## 3. 业务逻辑 (Business Logic)

### 3.1. 混合分析流水线 (Hybrid Analysis Pipeline)

这是 v2 的核心逻辑，不再直接把代码丢给 LLM，而是分三步走：

1.  **预处理 (Pre-computation)**:
    * 使用 `ts-morph` 扫描目标文件。
    * 提取所有 Export 的 Interface, Type, Class, Function Signature。
    * 生成 "Skeleton Code" (只有骨架，没有实现细节)。
2.  **上下文组装 (Context Assembly)**:
    * Prompt 输入 = `Skeleton Code` + `依赖关系数据` + `核心业务逻辑代码片段` (仅针对复杂函数)。
    * **关键策略**: 减少 Token 消耗，聚焦核心逻辑。
3.  **生成与增强 (Generation & Enrichment)**:
    * LLM 填充 Spec 的文本描述部分。
    * 调用 `tsuml2` 或类似逻辑生成 Mermaid Class Diagram 并插入文档。
    *  (在此处逻辑中，系统构建抽象语法树以理解代码结构)

### 3.2. 批量处理策略 (Batch Processing)

针对大型 Monorepo 的处理逻辑：

1.  **图构建**: 使用 `dependency-cruiser` 扫描全项目，构建有向无环图 (DAG)。
2.  **拓扑排序**: 计算模块处理顺序（Level 0 基础库 -> Level N 业务层）。
3.  **上下文传递**:
    * 在处理 Level N 模块时，**不读取** Level 0 的源码。
    * **读取** Level 0 已经生成的 `spec.md` 中的 "接口定义" 章节。
    * *目的*: 实现 O(1) 的上下文窗口复杂度，而非 O(N)。

### 3.3. 漂移检测逻辑 (Drift Detection)

1.  **加载阶段**: 解析现有的 `.spec.md` (提取已定义的 Interface/Rules)。
2.  **对比阶段**:
    * **Structural Diff**: 对比旧代码快照 vs 新代码 AST。识别：新增/删除的 Export，变更的签名。
    * **Semantic Diff**: 对于逻辑变更（函数体内部变化），将变更部分 + Spec 描述喂给 LLM，询问："此代码变更是否违反了当前 Spec 的意图？"
3.  **报告阶段**: 过滤掉重命名、格式化等噪音，只报告实质性漂移。

## 4. 数据结构 (Data Structures)

### 中间数据模型 (TypeScript Interfaces)

```typescript
// AST 分析结果
interface CodeSkeleton {
  filePath: string;
  exports: Array<{
    name: string;
    kind: 'function' | 'class' | 'interface';
    signature: string; // TS 签名
    jsDoc: string;
  }>;
  dependencies: string[]; // 引用路径
}

// 漂移报告项
interface DriftItem {
  severity: 'HIGH' (Breaking) | 'MEDIUM' (Logic) | 'LOW' (Addition);
  category: 'Interface' | 'Behavior' | 'Constraint';
  location: string; // file:line
  description: string; // 人类可读描述
  proposedUpdate: string; // 建议修改 Spec 的内容
}

```

## 5. 约束条件 (Constraints)

### 性能约束

* **预处理速度**: 500 个文件的 AST 解析需在 10秒内完成 (使用 `ts-morph` 或 `swc`)。
* **Token 预算**: 单个文件的分析 Context 不得超过 100k Token（通过 Skeleton 缩减实现）。

### 环境约束

* **Runtime**: 必须在 Claude Code 的沙箱环境或用户本地 Node.js 环境运行。
* **Dependency**: 必须依赖 `npm` 生态，不能依赖 Python/Rust 等非原生环境工具（保持 Skill 纯粹性）。

### 准确性约束

* **幻觉控制**: 接口定义（Interface）部分必须 100% 匹配源码，不得由 LLM 推断，必须来自 AST 提取。
* **推断标记**: 对于无法确定意图的代码，必须保留 `[INFERRED]` 标记。

## 6. 边界条件 (Edge Cases)

| 场景 | 行为 |
| --- | --- |
| **混合语言项目** | 对 TS/JS 启用 AST 增强模式；对其他语言降级为纯文本 LLM 模式。 |
| **语法错误代码** | 使用 `tree-sitter` 的容错解析模式，尽可能提取骨架，并在 Spec 中标记 `[SYNTAX ERROR]` 警告。 |
| **超大文件 (>5k LOC)** | 自动启用 "分块摘要" (Chunk Summary) 策略，先按函数拆分生成微型 Spec，再汇总。 |
| **循环依赖** | 批量处理时若检测到循环依赖，将该强连通分量 (SCC) 视为一个整体模块同时处理。 |

## 7. 技术债务 (Technical Debt) & 路线图

* **当前债务**:
* Prompt 是硬编码的字符串，缺乏版本管理。
* 缺乏针对生成的 Spec 的自动化质量评分机制。


* **未来规划**:
* **v2.1**: 集成 "Round-Trip Validation"，自动生成测试用例验证 Spec 准确性。
* **v2.2**: 支持 IDE 插件（VS Code），实时显示 Spec Drift。



## 8. 测试覆盖 (Test Strategy)

由于这是元工具，测试策略如下：

1. **Golden Master Testing**: 选取一个开源项目（如 `redux` 或 `lodash` 的子集），生成 "标准 Spec"。每次代码变更后，运行工具并对比生成的 Spec 与标准 Spec 的差异。
2. **Self-Hosting**: 使用 `reverse-spec` 为 `reverse-spec` 自身的代码生成文档（即本项目）。
3. **AST 准确性测试**: 编写单元测试，输入特定的 TS 代码片段，断言提取的 `Skeleton` JSON 是否完全正确。

## 9. 依赖关系 (Dependencies)

### 核心库

* `ts-morph`: 用于 TS/JS 的 AST 操作与签名提取。
* `dependency-cruiser`: 用于生成模块依赖图与架构分析。
* `handlebars` / `ejs`: 用于渲染 Markdown 模板。
* `zod`: 用于验证 LLM 返回的结构化数据（如果是 JSON 模式）。

### 外部服务

* Claude 4.6 Sonnet / Opus (Model API)。
