# 技术调研报告: Feature 038 — 通用数据模型文档生成

**日期**: 2026-03-19
**模式**: tech-only

## 1. 现有 AST 提取能力评估

### 1.1 PythonMapper 现状

**位置**: `src/core/query-mappers/python-mapper.ts`

| 能力 | 状态 | 说明 |
|------|------|------|
| 装饰器提取 | ✅ 可用 | `getDecorators()` 可识别 `@dataclass` |
| 基类提取 | ✅ 可用 | `extractBases()` 可识别 `BaseModel` 继承 |
| 方法成员提取 | ✅ 可用 | `_extractClassMembers()` 提取方法签名 |
| **字段声明提取** | ❌ 缺失 | 不提取类级别的类型注解字段（如 `name: str = "default"`） |

**关键缺口**: `_extractClassMembers()` 仅处理 `function_definition` 节点，对 Python dataclass / Pydantic model 中的字段声明（tree-sitter AST 中为 `expression_statement` 包含 `type` 注解或赋值）没有提取逻辑。

**Decision**: DataModelGenerator 需自行实现 Python 字段提取逻辑，基于 tree-sitter AST 遍历 class body 中的注解赋值节点。
**Rationale**: PythonMapper 的职责是通用代码骨架提取，不应为特定文档类型扩展；字段提取逻辑属于 DataModelGenerator 的领域特定提取。
**Alternatives considered**: 扩展 PythonMapper 增加字段提取 → 违反单一职责；使用正则匹配 → 不够精确。

### 1.2 TypeScriptMapper 现状

**位置**: `src/core/query-mappers/typescript-mapper.ts`

| 能力 | 状态 | 说明 |
|------|------|------|
| interface 提取 | ✅ 可用 | `_extractInterfaceDeclaration()` 含 extends 和 members |
| type alias 提取 | ✅ 可用 | `_extractTypeAliasDeclaration()` 含类型参数 |
| 属性成员提取 | ✅ 可用 | `_extractInterfaceMembers()` 提取 `property_signature` 含类型注解 |
| JSDoc 提取 | ⚠️ 部分 | members 的 jsDoc 字段始终为 null |

**Decision**: TypeScript 数据模型可直接从 CodeSkeleton 的 `exports` 中筛选 `kind === 'interface' || kind === 'type'`，使用 `members` 中 `kind === 'property'` 的条目作为字段信息。对于 JSDoc，需在 DataModelGenerator 中补充 tree-sitter 级别的注释提取。
**Rationale**: 复用已有基础设施，避免重复解析。
**Alternatives considered**: 独立解析 TS 文件 → 浪费已有能力。

## 2. Python 数据模型字段的 tree-sitter AST 结构

### 2.1 @dataclass 字段

```python
@dataclass
class User:
    name: str
    age: int = 0
    email: Optional[str] = None
```

tree-sitter AST 中，class body 的字段声明为：
- `type: str` → `expression_statement` > `type` (annotation without assignment)
- `age: int = 0` → `expression_statement` > `assignment` > `type` (annotation with default)

关键节点路径：
- **字段名**: `class_definition > body > expression_statement > type > identifier` 或 `assignment > left > identifier`
- **类型注解**: `type > type` 子节点的 `.text`
- **默认值**: `assignment > right` 的 `.text`

### 2.2 Pydantic BaseModel 字段

```python
class UserConfig(BaseModel):
    name: str = Field(default="unknown", description="用户名称")
    age: int = 0
    tags: List[str] = []
```

AST 结构与 dataclass 类似，额外需要：
- 识别 `Field()` 调用中的 `default` 和 `description` 关键字参数
- `Field(...)` 在 AST 中为 `call` 节点，参数为 `keyword_argument` 节点

**Decision**: 实现统一的 Python 字段提取函数，同时处理简单默认值和 `Field()` 调用。
**Rationale**: 两种模式的 AST 结构相似，可在同一遍历中处理。

## 3. Mermaid ER 图生成策略

**Decision**: 使用 Mermaid `erDiagram` 语法，不使用 `classDiagram`。
**Rationale**: 蓝图明确要求"Mermaid ER 图"；erDiagram 更适合展示实体属性和关系。
**Alternatives considered**: classDiagram → 虽然也能展示，但语义上 ER 图更贴合"数据模型"定位。

关系映射规则：
- **继承**: `Child ||--o{ Parent : "inherits"`
- **引用**: `Model ||--o{ ReferencedModel : "has"` （字段类型引用另一个已知模型）
- **组合**: `Parent ||--|{ Child : "contains"` （List[ChildModel] 等集合引用）

## 4. 模板系统集成

**Decision**: 创建独立的 `templates/data-model.hbs` 模板，DataModelGenerator.render() 内部编译和渲染。
**Rationale**: 不修改现有 `spec-renderer.ts` 的初始化流程；Generator 自包含模板管理。
**Alternatives considered**: 扩展 spec-renderer.ts 注册新模板 → 耦合过强，Generator 应独立。

模板将复用已注册的 Handlebars helpers（`formatSignature`、`hasContent`、`mermaidClass`），需要在 DataModelGenerator 中调用 `initRenderer()` 或独立注册 helpers。

**Decision**: DataModelGenerator 使用独立的 Handlebars 实例编译模板，不依赖 spec-renderer。
**Rationale**: Generator 应该是自包含的，不应依赖 reverse-spec 的渲染管线。

## 5. 文件扫描策略

**Decision**: DataModelGenerator.extract() 使用 `scanFiles()` 获取项目文件列表，按语言过滤后使用 TreeSitterAnalyzer 解析。
**Rationale**: 复用已有文件扫描和 .gitignore 过滤能力。

Python 文件过滤：扩展名 `.py`、`.pyi`
TypeScript 文件过滤：扩展名 `.ts`、`.tsx`（排除 `.d.ts` 声明文件中的第三方类型）
