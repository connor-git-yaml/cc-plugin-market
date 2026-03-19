# Feature Specification: 配置参考手册生成

**Feature Branch**: `039-config-reference-generator`
**Created**: 2026-03-19
**Status**: Draft
**Input**: 实现 ConfigReferenceGenerator（实现 DocumentGenerator 接口），从 YAML/TOML/.env 配置文件生成配置参考手册

## User Scenarios & Testing *(mandatory)*

### User Story 1 - YAML 配置文件生成参考手册 (Priority: P1)

开发者对一个包含 YAML 配置文件的项目运行配置参考手册生成，系统自动解析 YAML 文件中的所有配置项，提取键名、值类型、默认值和注释说明，生成结构化的 Markdown 配置参考手册。

**Why this priority**: YAML 是最常见的配置格式（docker-compose、CI/CD、应用配置），覆盖面最广

**Independent Test**: 提供一个包含注释的 YAML 配置文件，运行 ConfigReferenceGenerator 的全生命周期（extract → generate → render），验证输出的 Markdown 包含所有配置项的名称、类型、默认值和说明

**Acceptance Scenarios**:

1. **Given** 项目包含一个 YAML 配置文件（如 `config.yaml`），**When** 运行 ConfigReferenceGenerator，**Then** 生成的参考手册包含每个配置项的名称、推断类型、当前值和注释说明
2. **Given** YAML 配置文件包含嵌套结构（如 `database.host`、`database.port`），**When** 运行 ConfigReferenceGenerator，**Then** 生成的参考手册使用点号分隔路径正确展示嵌套配置项
3. **Given** YAML 配置文件中某些配置项有行内注释或上方注释，**When** 运行 ConfigReferenceGenerator，**Then** 注释内容被提取为该配置项的说明

---

### User Story 2 - .env 环境变量文件生成参考手册 (Priority: P1)

开发者对包含 `.env` 文件的项目运行配置参考手册生成，系统解析所有环境变量定义，提取变量名、值和注释说明。

**Why this priority**: `.env` 是几乎所有现代项目的标准配置方式，与 YAML 同等重要

**Independent Test**: 提供一个 `.env` 文件，运行全生命周期，验证输出包含所有环境变量

**Acceptance Scenarios**:

1. **Given** 项目包含 `.env` 文件，**When** 运行 ConfigReferenceGenerator，**Then** 生成的参考手册包含每个环境变量的名称、当前值和注释说明
2. **Given** `.env` 文件包含空行和以 `#` 开头的注释行，**When** 运行 ConfigReferenceGenerator，**Then** 注释正确关联到下一行的环境变量作为说明

---

### User Story 3 - TOML 配置文件生成参考手册 (Priority: P2)

开发者对包含 TOML 配置文件（如 `pyproject.toml`）的项目运行配置参考手册生成，系统解析 TOML 格式并提取配置项信息。

**Why this priority**: TOML 在 Python 生态（pyproject.toml）和 Rust 生态（Cargo.toml）中广泛使用，但使用范围略窄于 YAML 和 .env

**Independent Test**: 提供一个 TOML 配置文件，运行全生命周期，验证输出包含所有配置项

**Acceptance Scenarios**:

1. **Given** 项目包含 TOML 配置文件，**When** 运行 ConfigReferenceGenerator，**Then** 生成的参考手册包含每个配置项的名称（含 section 前缀）、类型、当前值和注释说明
2. **Given** TOML 文件包含 `[section]` 分组，**When** 运行 ConfigReferenceGenerator，**Then** 配置项名称使用 `section.key` 格式展示层级关系

---

### User Story 4 - 多配置文件聚合 (Priority: P2)

开发者的项目同时包含多个配置文件（如 `config.yaml`、`.env`、`pyproject.toml`），系统自动发现并聚合所有配置文件，生成统一的配置参考手册。

**Why this priority**: 实际项目通常有多个配置文件，聚合视图对新开发者快速理解项目配置至关重要

**Independent Test**: 提供包含多种格式配置文件的项目，验证输出按文件分组展示所有配置项

**Acceptance Scenarios**:

1. **Given** 项目包含 `.env` 和 `config.yaml` 两个配置文件，**When** 运行 ConfigReferenceGenerator，**Then** 生成的参考手册按文件分组展示所有配置项
2. **Given** 项目无任何已知格式的配置文件，**When** 运行 ConfigReferenceGenerator 的 isApplicable 检查，**Then** 返回 false 表示不适用

---

### Edge Cases

- 配置文件为空文件时，生成的参考手册应包含文件名但标注"无配置项"
- YAML 文件包含锚点（`&anchor`）和别名（`*alias`）时，应正确解析实际值
- .env 文件包含带引号的值（`KEY="value"`）时，应去除引号展示实际值
- .env 文件包含多行值或特殊字符时，应正确处理
- TOML 文件包含数组和内联表时，应正确展示
- 配置文件编码非 UTF-8 时，应优雅降级而非崩溃
- 配置文件路径包含中文或空格时，应正常处理

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 实现 DocumentGenerator 接口的完整生命周期（isApplicable → extract → generate → render）
- **FR-002**: 系统 MUST 支持解析 YAML 格式配置文件（`.yaml`、`.yml` 扩展名）
- **FR-003**: 系统 MUST 支持解析 .env 格式环境变量文件（`.env`、`.env.*` 模式）
- **FR-004**: 系统 MUST 支持解析 TOML 格式配置文件（`.toml` 扩展名）
- **FR-005**: 系统 MUST 为每个配置项提取名称（键路径）、推断类型、当前值和说明
- **FR-006**: 系统 MUST 从配置文件的注释中提取配置项说明（YAML 的 `#` 注释、TOML 的 `#` 注释、.env 的 `#` 注释）
- **FR-007**: 系统 MUST 支持嵌套配置的点号路径展示（如 `database.host`）
- **FR-008**: 系统 MUST 在 GeneratorRegistry 中注册，可通过 bootstrapGenerators() 自动注册
- **FR-009**: 系统 MUST 通过 Handlebars 模板渲染最终 Markdown 输出
- **FR-010**: 系统 MUST 在项目不包含任何支持格式的配置文件时，isApplicable 返回 false
- **FR-011**: 系统 MUST 将 Feature 037 的 ArtifactParser 依赖降级处理——在 ConfigReferenceGenerator 内部直接实现配置文件解析逻辑，后续 037 完成后可重构对接

### Key Entities

- **ConfigEntry**: 单个配置项，包含 keyPath（点号分隔路径）、type（推断类型）、defaultValue（当前值）、description（说明文本）、source（来源文件）
- **ConfigFileResult**: 单个配置文件的解析结果，包含 filePath（文件路径）、format（格式类型）、entries（ConfigEntry 数组）
- **ConfigReferenceInput**: extract 步骤输出，包含所有配置文件的解析结果集合
- **ConfigReferenceOutput**: generate 步骤输出，包含按文件分组的结构化配置参考数据

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 对包含注释的 YAML 配置文件，生成的参考手册覆盖 100% 的配置项，每项包含名称、类型、值和说明四个字段
- **SC-002**: 对标准 .env 文件，正确提取所有环境变量及其注释说明，零遗漏
- **SC-003**: 对包含 `[section]` 分组的 TOML 文件，正确使用 `section.key` 格式展示层级关系
- **SC-004**: 全生命周期（isApplicable → extract → generate → render）单元测试通过率 100%
- **SC-005**: 对不包含任何配置文件的项目，isApplicable 在 10ms 内返回 false
- **SC-006**: 生成的 Markdown 文档通过 Handlebars 模板渲染，格式一致且可在 GitHub 正确显示
