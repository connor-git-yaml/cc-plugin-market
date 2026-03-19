# 技术调研: 配置参考手册生成

**Feature**: 039-config-reference-generator
**Date**: 2026-03-19
**Mode**: tech-only

## 调研问题与决策

### R-001: YAML 解析策略

**Decision**: 使用行级正则解析（line-level regex parsing），不引入新的 npm 依赖

**Rationale**:
- Constitution 原则 VII（纯 Node.js 生态）要求不引入非必要依赖
- 当前 package.json 无 YAML 解析库（如 `js-yaml`）
- 配置参考手册仅需提取键值对和注释，不需要完整的 YAML 解析器
- 行级解析可提取：缩进层级（计算嵌套路径）、`key: value` 对、`#` 注释
- 对 YAML 锚点/别名等高级特性降级处理（标注 `[复杂值]`）

**Alternatives considered**:
1. `js-yaml`（npm 包）— 完整解析，但需新增依赖，违反最小依赖原则
2. Node.js 内置 JSON.parse — 不支持 YAML 格式
3. `yaml`（npm 包）— 功能更强但同样需新增依赖

### R-002: TOML 解析策略

**Decision**: 使用行级正则解析，识别 `[section]` 头、`key = value` 对和 `#` 注释

**Rationale**:
- 同 R-001，避免引入 `toml` 或 `@iarna/toml` 等新依赖
- TOML 配置文件的结构比 YAML 更规整（section 头 + key=value），行级解析可靠性更高
- 对内联表 `{a = 1, b = 2}` 和数组 `[1, 2, 3]` 降级为字符串展示

**Alternatives considered**:
1. `@iarna/toml`（npm 包）— 完整解析但需新增依赖
2. `smol-toml`（npm 包）— 轻量但仍需新增依赖

### R-003: .env 解析策略

**Decision**: 使用行级正则解析，模式 `KEY=VALUE` + `#` 注释

**Rationale**:
- .env 格式天然适合行级解析，每行一个变量
- 处理引号包裹的值（`KEY="value"` → `value`）
- 识别上方注释行作为变量说明

**Alternatives considered**: 无（.env 格式简单，行级解析是标准做法）

### R-004: 配置文件发现策略

**Decision**: 基于 ProjectContext.configFiles 已有映射 + 项目根目录扫描特定模式

**Rationale**:
- ProjectContext 已扫描根目录配置文件，但仅包含已知文件名
- ConfigReferenceGenerator 需额外扫描：`*.yaml`、`*.yml`、`*.toml`、`.env*` 模式
- 排除 `node_modules/`、`.git/`、`dist/` 等目录
- 仅扫描项目根目录和一级子目录，避免过度递归

### R-005: Handlebars 模板设计

**Decision**: 创建 `templates/config-reference.hbs` 模板，按文件分组渲染配置项表格

**Rationale**:
- 项目已依赖 `handlebars`（package.json 中已有）
- 模板结构：标题 → 概要 → 按文件分组的配置项表格（名称 | 类型 | 默认值 | 说明）
- 每个文件组包含文件路径和格式标注

### R-006: Feature 037 依赖降级策略

**Decision**: 在 ConfigReferenceGenerator 内部实现三种格式的解析函数，不依赖 ArtifactParser

**Rationale**:
- Feature 037 尚未完成，无可用的 ArtifactParser 实现
- 将解析逻辑封装为独立的 private 方法：`parseYaml()`、`parseToml()`、`parseEnv()`
- 后续 037 完成后，可将这些方法重构为 ArtifactParser 实现并通过依赖注入替换
- 在代码中用 `// TODO: Feature 037 完成后重构为 ArtifactParser 对接` 标注重构点
