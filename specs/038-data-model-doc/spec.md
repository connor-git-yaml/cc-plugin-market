# Feature Specification: 通用数据模型文档生成

**Feature Branch**: `038-data-model-doc`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "Feature 038: 通用数据模型文档生成。实现 DataModelGenerator（实现 DocumentGenerator 接口），从 Python dataclass / Pydantic model / TypeScript interface 等提取字段定义，生成数据模型文档和 Mermaid ER 图。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 从 Python 数据模型生成文档 (Priority: P1)

开发者在一个包含 Python dataclass 或 Pydantic BaseModel 定义的项目上运行数据模型文档生成，系统自动提取所有数据模型的字段名、类型、默认值和文档字符串，输出结构化的数据模型参考文档。

**Why this priority**: Python dataclass 和 Pydantic model 是 Python 项目中最常见的数据模型定义方式，也是 OctoAgent 验证的核心场景（蓝图第 8.2 节验证操作 #3）。

**Independent Test**: 对包含 Pydantic model 的 Python 文件运行 DataModelGenerator 全生命周期（extract → generate → render），验证输出文档包含所有字段定义。

**Acceptance Scenarios**:

1. **Given** 项目中存在使用 `@dataclass` 装饰器的 Python 类定义, **When** 运行 DataModelGenerator.extract(), **Then** 提取出每个字段的名称、类型注解、默认值和 docstring
2. **Given** 项目中存在继承 `BaseModel` 的 Pydantic 模型定义, **When** 运行 DataModelGenerator.extract(), **Then** 提取出每个字段的名称、类型注解、`Field()` 中的默认值和 description
3. **Given** 提取到的 Python 数据模型, **When** 运行 generate() 和 render(), **Then** 输出的 Markdown 文档包含模型名称、字段表格（名称 | 类型 | 默认值 | 描述）和模型间继承关系

---

### User Story 2 - 从 TypeScript 接口/类型生成文档 (Priority: P2)

开发者在一个包含 TypeScript interface 或 type alias 定义的项目上运行数据模型文档生成，系统自动提取所有接口的属性定义并生成文档。

**Why this priority**: TypeScript 项目是 Reverse Spec 的核心用户群，interface/type 是 TS 中最常见的数据模型定义方式。

**Independent Test**: 对包含 TypeScript interface 的文件运行 DataModelGenerator，验证输出文档包含所有属性定义。

**Acceptance Scenarios**:

1. **Given** 项目中存在 TypeScript `interface` 定义, **When** 运行 DataModelGenerator.extract(), **Then** 提取出每个属性的名称、类型、可选标记（`?`）和 JSDoc 注释
2. **Given** 项目中存在 TypeScript `type` 别名定义（对象字面量形式）, **When** 运行 DataModelGenerator.extract(), **Then** 同样提取出属性定义
3. **Given** 提取到的 TypeScript 数据模型, **When** 运行 generate() 和 render(), **Then** 输出的 Markdown 文档与 Python 模型文档格式一致

---

### User Story 3 - 生成 Mermaid ER 图 (Priority: P2)

系统从提取到的数据模型中识别实体间关系（继承、组合、引用），生成 Mermaid erDiagram 代码块，在 GitHub 上可渲染为可视化 ER 图。

**Why this priority**: ER 图是蓝图验证标准之一（"生成的 Mermaid ER 图正确反映实体间关系"），且可视化关系图的可读性远高于纯文本描述。

**Independent Test**: 提供包含相互引用的多个数据模型，验证生成的 Mermaid ER 图包含正确的实体和关系。

**Acceptance Scenarios**:

1. **Given** 项目中存在继承关系的数据模型（如 `class Admin(User)`）, **When** 生成 ER 图, **Then** 图中包含继承关系线
2. **Given** 项目中存在组合/引用关系（如字段类型引用另一个模型）, **When** 生成 ER 图, **Then** 图中包含关联关系线
3. **Given** 生成的 Mermaid ER 图代码, **When** 在 GitHub Markdown 中渲染, **Then** 图表正确显示所有实体和关系

---

### User Story 4 - 项目适用性判断 (Priority: P3)

DataModelGenerator 的 isApplicable() 方法能够正确判断当前项目是否包含可识别的数据模型定义，对不包含数据模型的项目返回 false。

**Why this priority**: 正确的适用性判断是 GeneratorRegistry 过滤机制的基础，确保只在相关项目上运行。

**Independent Test**: 分别对含数据模型和不含数据模型的项目运行 isApplicable()，验证返回值正确。

**Acceptance Scenarios**:

1. **Given** ProjectContext 中 detectedLanguages 包含 "python" 或 "typescript", **When** 调用 isApplicable(), **Then** 返回 true
2. **Given** ProjectContext 中 detectedLanguages 不包含任何已支持语言, **When** 调用 isApplicable(), **Then** 返回 false

---

### Edge Cases

- 数据模型文件中没有任何可识别的数据模型定义时（空提取结果），应生成空报告而非报错
- Python 文件中同时包含 dataclass 和 Pydantic model 时，两种类型都应被提取
- TypeScript 文件中使用泛型参数的接口（如 `interface Foo<T>`），类型参数应被正确保留
- 字段类型为复杂嵌套类型（如 `Optional[List[Dict[str, Any]]]`）时，类型字符串应完整保留
- 同名模型分布在不同文件中时，应通过文件路径区分

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须实现 DataModelGenerator 类，完整实现 DocumentGenerator<DataModelInput, DataModelOutput> 接口的四个方法（isApplicable / extract / generate / render）
- **FR-002**: extract() 必须从 Python 文件中识别 `@dataclass` 装饰器标注的类，提取每个字段的名称、类型注解、默认值
- **FR-003**: extract() 必须从 Python 文件中识别继承 `BaseModel` 的 Pydantic 模型类，提取每个字段的名称、类型注解、Field() 参数中的默认值和 description
- **FR-004**: extract() 必须从 TypeScript 文件中识别 `interface` 和对象字面量形式的 `type` 定义，提取每个属性的名称、类型、可选标记和 JSDoc 注释
- **FR-005**: generate() 必须将提取的原始数据转换为结构化的数据模型输出对象，包含模型列表及其字段信息
- **FR-006**: generate() 必须分析模型间关系（继承、字段类型引用），构建关系图数据结构
- **FR-007**: render() 必须使用 Handlebars 模板将输出对象渲染为 Markdown 文档，包含每个模型的字段表格
- **FR-008**: render() 必须在文档中包含 Mermaid erDiagram 代码块，正确反映实体间关系
- **FR-009**: isApplicable() 必须基于 ProjectContext.detectedLanguages 判断项目是否包含支持的语言（Python 或 TypeScript）
- **FR-010**: DataModelGenerator 必须在 GeneratorRegistry 中注册，通过 bootstrapGenerators() 完成初始化

### Key Entities

- **DataModel**: 单个数据模型的结构化表示，包含名称、源文件路径、语言类型、字段列表和基类信息
- **DataModelField**: 单个字段的结构化表示，包含名称、类型字符串、是否可选、默认值和描述文本
- **ModelRelation**: 模型间关系的结构化表示，包含源模型名、目标模型名和关系类型（继承/组合/引用）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对包含 Python dataclass / Pydantic model 的项目运行 DataModelGenerator，100% 提取出所有公开模型的字段定义（名称、类型、默认值）
- **SC-002**: 对包含 TypeScript interface 的项目运行 DataModelGenerator，100% 提取出所有导出接口的属性定义
- **SC-003**: 生成的 Mermaid ER 图语法正确（符合 Mermaid erDiagram 规范），正确反映模型间的继承和引用关系
- **SC-004**: 输出的 Markdown 文档结构清晰，包含模型名称、字段表格和关系图，在 GitHub 上可正确渲染
- **SC-005**: DataModelGenerator 全生命周期（isApplicable → extract → generate → render）单元测试通过，覆盖 Python 和 TypeScript 两种语言
- **SC-006**: DataModelGenerator 通过 GeneratorRegistry 注册后可通过 filterByContext() 被正确发现和调用

## Assumptions

- Python 数据模型提取复用现有的 tree-sitter Python AST 分析能力（PythonMapper），无需新增 AST 解析依赖
- TypeScript 数据模型提取复用现有的 ts-morph / tree-sitter TypeScript AST 分析能力（TypeScriptMapper），无需新增 AST 解析依赖
- 当前版本仅通过 AST 静态分析提取模型定义，不使用 LLM 增强（useLLM 选项预留但默认 false）
- Handlebars 模板文件放置在 `templates/` 目录下，命名为 `data-model.hbs`，复用现有模板渲染基础设施

## Dependencies

- **Feature 034**（强依赖，已完成）: DocumentGenerator 接口定义、GenerateOptions、ProjectContext 类型
- **Feature 036**（弱依赖，已完成）: GeneratorRegistry 注册中心，DataModelGenerator 需在其中注册
