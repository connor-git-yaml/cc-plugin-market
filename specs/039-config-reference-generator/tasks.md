# Tasks: 配置参考手册生成

**Input**: Design documents from `specs/039-config-reference-generator/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: 定义数据类型和创建 Handlebars 模板

- [ ] T001 [P] 定义 ConfigFormat、ConfigEntry、ConfigFileResult、ConfigReferenceInput、ConfigReferenceOutput 类型及 Zod Schema 在 src/panoramic/config-reference-generator.ts 顶部
- [ ] T002 [P] 创建 Handlebars 模板 templates/config-reference.hbs，按文件分组渲染配置项表格（标题 → 概要 → 文件分组表格：名称 | 类型 | 默认值 | 说明）

---

## Phase 2: Foundational (核心解析函数)

**Purpose**: 实现三种配置格式的行级解析函数（Feature 037 降级处理）

**⚠️ CRITICAL**: 解析函数是所有 User Story 的共享基础，必须先完成

- [ ] T003 [P] 实现 parseYamlFile(filePath: string): Promise<ConfigEntry[]> 私有方法在 src/panoramic/config-reference-generator.ts — 行级正则解析 YAML 的 key: value 对、缩进层级（计算嵌套 keyPath）和 # 注释提取
- [ ] T004 [P] 实现 parseEnvFile(filePath: string): Promise<ConfigEntry[]> 私有方法在 src/panoramic/config-reference-generator.ts — 解析 KEY=VALUE 格式、处理引号包裹值、上方 # 注释关联
- [ ] T005 [P] 实现 parseTomlFile(filePath: string): Promise<ConfigEntry[]> 私有方法在 src/panoramic/config-reference-generator.ts — 行级解析 [section] 头、key = value 对、# 注释
- [ ] T006 实现 inferType(value: string): string 辅助函数在 src/panoramic/config-reference-generator.ts — 从字符串值推断类型（number/boolean/string/null/array/object）
- [ ] T007 实现 discoverConfigFiles(projectRoot: string): Promise<ConfigFileResult[]> 私有方法在 src/panoramic/config-reference-generator.ts — 扫描项目根目录和一级子目录查找 *.yaml/*.yml/*.toml/.env* 文件，排除 node_modules/.git/dist

**Checkpoint**: 三种格式的解析函数和文件发现逻辑就绪

---

## Phase 3: User Story 1 & 2 - YAML 和 .env 配置文件生成参考手册 (Priority: P1) 🎯 MVP

**Goal**: 对包含 YAML 和/或 .env 配置文件的项目，生成完整的配置参考手册

**Independent Test**: 创建包含注释的 YAML 和 .env 测试文件，运行全生命周期验证输出包含所有配置项

### Implementation

- [ ] T008 实现 ConfigReferenceGenerator 类框架在 src/panoramic/config-reference-generator.ts — 实现 DocumentGenerator<ConfigReferenceInput, ConfigReferenceOutput> 接口，声明 id='config-reference'、name、description 属性
- [ ] T009 实现 isApplicable(context: ProjectContext): boolean 方法在 src/panoramic/config-reference-generator.ts — 扫描 configFiles 和项目根目录，判断是否存在支持格式的配置文件
- [ ] T010 实现 extract(context: ProjectContext): Promise<ConfigReferenceInput> 方法在 src/panoramic/config-reference-generator.ts — 调用 discoverConfigFiles 和各格式解析函数，聚合所有配置文件结果
- [ ] T011 实现 generate(input, options?): Promise<ConfigReferenceOutput> 方法在 src/panoramic/config-reference-generator.ts — 将 ConfigReferenceInput 转换为 ConfigReferenceOutput（排序、统计）
- [ ] T012 实现 render(output: ConfigReferenceOutput): string 方法在 src/panoramic/config-reference-generator.ts — 使用 Handlebars 编译 templates/config-reference.hbs 模板渲染 Markdown 字符串
- [ ] T013 编写 YAML 解析单元测试在 tests/panoramic/config-reference-generator.test.ts — 测试 parseYamlFile 对嵌套结构、注释提取、空文件的处理
- [ ] T014 编写 .env 解析单元测试在 tests/panoramic/config-reference-generator.test.ts — 测试 parseEnvFile 对 KEY=VALUE、引号值、注释关联的处理
- [ ] T015 编写全生命周期 e2e 测试在 tests/panoramic/config-reference-generator.test.ts — 测试 isApplicable → extract → generate → render 链路，验证 YAML 和 .env 输出

**Checkpoint**: YAML 和 .env 配置文件的参考手册生成功能完整可用

---

## Phase 4: User Story 3 - TOML 配置文件支持 (Priority: P2)

**Goal**: 扩展支持 TOML 格式配置文件（如 pyproject.toml）

**Independent Test**: 创建包含 [section] 分组的 TOML 测试文件，验证输出使用 section.key 格式

### Implementation

- [ ] T016 编写 TOML 解析单元测试在 tests/panoramic/config-reference-generator.test.ts — 测试 parseTomlFile 对 [section] 头、嵌套 section、注释的处理
- [ ] T017 验证 TOML 文件在全生命周期中的端到端集成在 tests/panoramic/config-reference-generator.test.ts

**Checkpoint**: TOML 格式支持完成，三种格式均可正确解析

---

## Phase 5: User Story 4 - 多配置文件聚合 (Priority: P2)

**Goal**: 多种格式配置文件自动发现和聚合展示

**Independent Test**: 创建包含 .env + config.yaml + pyproject.toml 的测试项目，验证输出按文件分组展示

### Implementation

- [ ] T018 编写多文件聚合测试在 tests/panoramic/config-reference-generator.test.ts — 验证 extract 正确发现并聚合多种格式文件，render 输出按文件分组
- [ ] T019 编写 isApplicable 边界测试在 tests/panoramic/config-reference-generator.test.ts — 验证无配置文件时返回 false、空配置文件时返回 true 但标注"无配置项"

**Checkpoint**: 多文件聚合功能完整

---

## Phase 6: Polish & 注册集成

**Purpose**: 注册到 GeneratorRegistry 并确保构建通过

- [ ] T020 在 src/panoramic/generator-registry.ts 的 bootstrapGenerators() 中注册 ConfigReferenceGenerator
- [ ] T021 编写 GeneratorRegistry 集成测试在 tests/panoramic/config-reference-generator.test.ts — 验证 ConfigReferenceGenerator 在 Registry 中可查询、可通过 filterByContext 过滤
- [ ] T022 运行 npm run build && npm test 验证全量编译和测试通过
- [ ] T023 编写只读属性检查测试在 tests/panoramic/config-reference-generator.test.ts — 验证 id、name、description 属性值正确

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖 — T001 和 T002 可并行
- **Foundational (Phase 2)**: 依赖 T001（类型定义）— T003/T004/T005 可并行
- **US1&2 (Phase 3)**: 依赖 Phase 2 全部完成 — MVP
- **US3 (Phase 4)**: 依赖 Phase 2（T005 已在 Phase 2 完成）
- **US4 (Phase 5)**: 依赖 Phase 3 和 Phase 4
- **Polish (Phase 6)**: 依赖 Phase 3-5 全部完成

### Parallel Opportunities

- T001 和 T002 可并行（不同文件）
- T003、T004、T005 可并行（不同解析器，同一文件内独立方法）
- T013、T014 可并行（不同测试 describe 块）

---

## Implementation Strategy

### MVP First (Phase 1-3)

1. Phase 1: 类型定义 + 模板
2. Phase 2: 三种解析函数
3. Phase 3: Generator 类 + YAML/.env 测试
4. **STOP and VALIDATE**: `npm run build && npm test`

### Full Delivery (Phase 4-6)

5. Phase 4: TOML 测试验证
6. Phase 5: 多文件聚合测试
7. Phase 6: Registry 注册 + 全量验证

---

## Notes

- 所有解析逻辑在 ConfigReferenceGenerator 内部实现（Feature 037 降级策略）
- 代码中标注 `// TODO: Feature 037 完成后重构为 ArtifactParser 对接`
- 不引入新 npm 依赖，使用行级正则解析
- Handlebars 模板复用已有依赖
