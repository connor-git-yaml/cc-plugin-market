# Tasks: 非代码制品解析

**Input**: Design documents from `specs/037-artifact-parsers/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md (required)

**Tests**: spec.md 的 FR-028 ~ FR-032 明确要求为三个 Parser 编写单元测试。每个 User Story Phase 采用 Tests First 策略——先写测试并确认失败，再实现功能代码。

**Organization**: 任务按 User Story 分组，每个 Story 可独立实现和测试。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1 ~ US5）
- 每个任务包含确切的文件路径

---

## Phase 1: Setup（共享基础设施）

**Purpose**: 建立 Parser 模块的类型基础、抽象基类和桶文件

- [x] T001 创建输出类型定义和 Zod Schema — `src/panoramic/parsers/types.ts`
  - 定义 SkillMdSection、SkillMdInfo、BehaviorState、BehaviorInfo、DockerfileInstruction、DockerfileStage、DockerfileInfo 三组接口
  - 定义对应的 Zod Schema：SkillMdSectionSchema、SkillMdInfoSchema、BehaviorStateSchema、BehaviorInfoSchema、DockerfileInstructionSchema、DockerfileStageSchema、DockerfileInfoSchema
  - 全部导出
- [x] T002 实现抽象基类 AbstractArtifactParser — `src/panoramic/parsers/abstract-artifact-parser.ts`
  - 从 `../interfaces` 导入 ArtifactParser 接口
  - 实现 `parse(filePath)` 方法：try-catch 包裹 `fs.promises.readFile` + `doParse()`，异常时调用 `createFallback()`
  - 实现 `parseAll(filePaths)` 方法：`Promise.all` 并发调用 `parse()`
  - 声明 `abstract doParse(content: string, filePath: string): T`
  - 声明 `abstract createFallback(): T`
- [x] T003 创建桶文件 — `src/panoramic/parsers/index.ts`
  - 初始导出 types.ts 所有类型和 Schema
  - 导出 AbstractArtifactParser 基类
  - 预留后续 Parser 的导出位置

**Checkpoint**: `npm run build` 编译通过，新增文件无类型错误

---

## Phase 2: User Story 1 — SkillMdParser 解析 SKILL.md 文件（Priority: P1）

**Goal**: 实现 SKILL.md 文件的完整解析，从 YAML frontmatter 提取元数据，从 Markdown body 提取标题分段

**Independent Test**: 准备包含 YAML frontmatter 和 Markdown sections 的 SKILL.md 测试文件，调用 `skillMdParser.parse(filePath)` 验证返回结构化数据

### Fixture 文件

- [x] T004 [P] [US1] 创建 SkillMdParser 测试 fixture 文件 — `tests/panoramic/fixtures/skill-md/`
  - `standard.skill.md`: 包含标准 YAML frontmatter（name/description/version）+ 多个 `##` 二级标题分段
  - `no-frontmatter.skill.md`: 无 `---` frontmatter，仅含 `#` 一级标题和 `##` 分段
  - `empty.skill.md`: 空文件（0 字节）
  - `duplicate-headings.skill.md`: 包含多个同名 `##` 标题

### 测试（Tests First）

- [x] T005 [P] [US1] 编写 SkillMdParser 单元测试 — `tests/panoramic/skill-md-parser.test.ts`
  - 测试场景 1：标准 SKILL.md 解析——验证 name、description、version、title、sections 正确提取
  - 测试场景 2：无 frontmatter 降级——验证 name 从一级标题推断，version 为 undefined
  - 测试场景 3：空文件降级——验证返回降级结果 `{ name: '', description: '', title: '', sections: [] }`
  - 测试场景 4：重复标题——验证 sections 保留全部同名条目
  - 测试场景 5：文件不存在降级——验证返回降级结果而非抛异常
  - 测试场景 6：filePatterns 属性——验证值为 `['**/SKILL.md']`
  - 测试场景 7：id 和 name 属性——验证 id 为 `'skill-md'`、name 为 `'SKILL.md Parser'`

### 实现

- [x] T006 [US1] 实现 SkillMdParser — `src/panoramic/parsers/skill-md-parser.ts`
  - 继承 AbstractArtifactParser\<SkillMdInfo\>
  - 设置 id = `'skill-md'`、name = `'SKILL.md Parser'`、filePatterns = `['**/SKILL.md']`
  - 实现 `doParse(content, filePath)`: 正则提取 frontmatter → 逐行解析 key:value → 提取一级标题 → 按 `##` 分段
  - 实现 `createFallback()`: 返回 `{ name: '', description: '', title: '', sections: [] }`
- [x] T007 [US1] 更新桶文件导出 SkillMdParser — `src/panoramic/parsers/index.ts`
  - 添加 `export { SkillMdParser } from './skill-md-parser'`

**Checkpoint**: `npm test` 通过 skill-md-parser.test.ts 全部测试用例

---

## Phase 3: User Story 2 — BehaviorYamlParser 解析行为定义文件（Priority: P1）

**Goal**: 实现 behavior YAML/Markdown 文件的双格式解析，提取状态-行为映射关系

**Independent Test**: 准备 YAML 和 Markdown 两种格式的 behavior 文件，分别调用 `parse()` 验证正确提取 states

### Fixture 文件

- [x] T008 [P] [US2] 创建 BehaviorYamlParser 测试 fixture 文件 — `tests/panoramic/fixtures/behavior/`
  - `standard.yaml`: 标准 YAML 格式，含 states 键和嵌套 actions 列表
  - `markdown-format.md`: Markdown 格式 behavior 文件，标题作为状态名，列表项作为行为
  - `invalid.yaml`: 无效格式内容（降级测试）
  - `empty.yaml`: 空文件（0 字节）

### 测试（Tests First）

- [x] T009 [P] [US2] 编写 BehaviorYamlParser 单元测试 — `tests/panoramic/behavior-yaml-parser.test.ts`
  - 测试场景 1：YAML 格式解析——验证 states 数组包含正确的 name、description、actions
  - 测试场景 2：Markdown 格式解析——验证从标题/段落/列表正确提取状态信息
  - 测试场景 3：无效格式降级——验证返回 `{ states: [] }` 而非抛异常
  - 测试场景 4：空文件降级——验证返回降级结果
  - 测试场景 5：文件不存在降级——验证返回降级结果而非抛异常
  - 测试场景 6：filePatterns 属性——验证包含 yaml/yml/md 三种模式
  - 测试场景 7：id 和 name 属性——验证 id 为 `'behavior-yaml'`、name 为 `'Behavior YAML Parser'`

### 实现

- [x] T010 [US2] 实现 BehaviorYamlParser — `src/panoramic/parsers/behavior-yaml-parser.ts`
  - 继承 AbstractArtifactParser\<BehaviorInfo\>
  - 设置 id = `'behavior-yaml'`、name = `'Behavior YAML Parser'`、filePatterns = `['**/behavior/**/*.yaml', '**/behavior/**/*.yml', '**/behavior/**/*.md']`
  - 实现 `detectFormat(content, filePath)`: 按扩展名和内容特征判断 YAML/Markdown
  - 实现 `parseYaml(content)`: 逐行正则解析 key:value + 嵌套列表
  - 实现 `parseMarkdown(content)`: 标题分段 + 列表项提取
  - 实现 `doParse(content, filePath)`: 调用 detectFormat → 分发到 parseYaml/parseMarkdown
  - 实现 `createFallback()`: 返回 `{ states: [] }`
- [x] T011 [US2] 更新桶文件导出 BehaviorYamlParser — `src/panoramic/parsers/index.ts`
  - 添加 `export { BehaviorYamlParser } from './behavior-yaml-parser'`

**Checkpoint**: `npm test` 通过 behavior-yaml-parser.test.ts 全部测试用例

---

## Phase 4: User Story 3 — DockerfileParser 解析 Dockerfile（Priority: P2）

**Goal**: 实现 Dockerfile 的逐行解析，支持多行拼接和多阶段构建检测

**Independent Test**: 准备包含多阶段构建的 Dockerfile 测试文件，调用 `parse()` 验证 stages 列表正确

### Fixture 文件

- [x] T012 [P] [US3] 创建 DockerfileParser 测试 fixture 文件 — `tests/panoramic/fixtures/dockerfile/`
  - `single-stage.Dockerfile`: 单阶段构建（一个 FROM + 常见指令）
  - `multi-stage.Dockerfile`: 多阶段构建（多个 FROM ... AS alias）
  - `multiline.Dockerfile`: 包含行尾 `\` 续行符的多行指令
  - `comments-only.Dockerfile`: 仅含注释行和空行（无有效指令）
  - `arg-before-from.Dockerfile`: 第一个 FROM 之前包含 ARG 指令

### 测试（Tests First）

- [x] T013 [P] [US3] 编写 DockerfileParser 单元测试 — `tests/panoramic/dockerfile-parser.test.ts`
  - 测试场景 1：单阶段解析——验证 stages 长度为 1，baseImage 和 instructions 正确
  - 测试场景 2：多阶段解析——验证多个 stage 的 baseImage、alias、instructions
  - 测试场景 3：多行拼接——验证续行符被正确拼接，args 不含 `\`
  - 测试场景 4：注释和空行过滤——验证 instructions 不含注释内容
  - 测试场景 5：FROM 前 ARG——验证全局 ARG 不归属任何 stage（或单独处理）
  - 测试场景 6：空文件降级——验证返回 `{ stages: [] }`
  - 测试场景 7：文件不存在降级——验证返回降级结果而非抛异常
  - 测试场景 8：filePatterns 属性——验证包含 `'**/Dockerfile'` 和 `'**/Dockerfile.*'`
  - 测试场景 9：id 和 name 属性——验证 id 为 `'dockerfile'`、name 为 `'Dockerfile Parser'`

### 实现

- [x] T014 [US3] 实现 DockerfileParser — `src/panoramic/parsers/dockerfile-parser.ts`
  - 继承 AbstractArtifactParser\<DockerfileInfo\>
  - 设置 id = `'dockerfile'`、name = `'Dockerfile Parser'`、filePatterns = `['**/Dockerfile', '**/Dockerfile.*']`
  - 实现 `joinMultilineInstructions(lines)`: 遍历行，行尾 `\` 时拼接下一行
  - 实现 `parseInstruction(line)`: 正则 `/^(\w+)\s+(.*)/` 提取 type（大写化）和 args
  - 实现 `doParse(content, filePath)`: 预处理多行 → 过滤注释/空行 → 检测 FROM 开启 stage → 逐指令归属
  - 实现 `createFallback()`: 返回 `{ stages: [] }`
- [x] T015 [US3] 更新桶文件导出 DockerfileParser — `src/panoramic/parsers/index.ts`
  - 添加 `export { DockerfileParser } from './dockerfile-parser'`

**Checkpoint**: `npm test` 通过 dockerfile-parser.test.ts 全部测试用例

---

## Phase 5: User Story 4 — parseAll 批量解析（Priority: P2）

**Goal**: 验证每个 Parser 的 `parseAll()` 批量解析能力，确保返回等长数组且单文件失败不中断

**Independent Test**: 准备多个文件路径（含不存在的路径），调用 `parseAll()` 验证返回数组与输入等长

> 注意: parseAll 的基础实现已在 Phase 1 的 AbstractArtifactParser 中完成。本 Phase 聚焦于集成验证。

### 测试

- [x] T016 [P] [US4] 在 skill-md-parser.test.ts 中补充 parseAll 测试 — `tests/panoramic/skill-md-parser.test.ts`
  - 测试场景：3 个文件调用 parseAll，验证返回长度为 3
  - 测试场景：空数组调用 parseAll，验证返回空数组
  - 测试场景：含 1 个不存在文件的 3 个路径调用 parseAll，验证返回长度为 3 且对应位置为降级结果
- [x] T017 [P] [US4] 在 behavior-yaml-parser.test.ts 中补充 parseAll 测试 — `tests/panoramic/behavior-yaml-parser.test.ts`
  - 测试场景：与 T016 相同模式，针对 BehaviorYamlParser
- [x] T018 [P] [US4] 在 dockerfile-parser.test.ts 中补充 parseAll 测试 — `tests/panoramic/dockerfile-parser.test.ts`
  - 测试场景：与 T016 相同模式，针对 DockerfileParser

**Checkpoint**: 三个 Parser 的 parseAll 测试全部通过

---

## Phase 6: User Story 5 — 容错降级与文件模式匹配（Priority: P2）

**Goal**: 验证所有 Parser 在各种异常输入下的容错行为和 filePatterns 正确性

**Independent Test**: 传入格式损坏、二进制内容等异常文件，验证所有 Parser 返回降级结果

> 注意: 容错降级的核心实现已在各 Parser 的 `doParse()`/`createFallback()` 和 AbstractArtifactParser 的 try-catch 中完成。本 Phase 聚焦于边界场景的测试验证。

### 测试

- [x] T019 [P] [US5] 在 skill-md-parser.test.ts 中补充容错边界测试 — `tests/panoramic/skill-md-parser.test.ts`
  - 测试场景：二进制内容文件传入，验证降级返回
  - 测试场景：非 UTF-8 编码文件传入，验证降级返回
- [x] T020 [P] [US5] 在 behavior-yaml-parser.test.ts 中补充容错边界测试 — `tests/panoramic/behavior-yaml-parser.test.ts`
  - 测试场景：二进制内容文件传入 BehaviorYamlParser，验证降级返回
- [x] T021 [P] [US5] 在 dockerfile-parser.test.ts 中补充容错边界测试 — `tests/panoramic/dockerfile-parser.test.ts`
  - 测试场景：二进制内容文件传入 DockerfileParser，验证降级返回
  - 测试场景：仅注释行的 Dockerfile（无 FROM），验证返回 `{ stages: [] }`

**Checkpoint**: 所有容错边界测试通过

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 集成验证和项目健康检查

- [x] T022 完整构建验证——运行 `npm run build`，确认零编译错误
- [x] T023 完整测试验证——运行 `npm test`，确认全部测试通过（包括现有测试无新增失败）
- [x] T024 [P] Lint 检查——运行 `npm run lint`，确认无新增 lint 错误
- [x] T025 [P] 依赖检查——确认 `package.json` 的 dependencies 在 Feature 037 前后无新增项
- [x] T026 桶文件完整性验证——确认 `src/panoramic/parsers/index.ts` 正确导出全部 3 个 Parser + 全部类型 + Schema + 抽象基类

---

## FR 覆盖映射表

| 功能需求 | 对应任务 | 说明 |
|----------|----------|------|
| FR-001 (SkillMdParser 实现) | T006 | skill-md-parser.ts |
| FR-002 (YAML frontmatter 正则提取) | T006 | doParse 中 frontmatter 提取逻辑 |
| FR-003 (Markdown body 标题分段) | T006 | doParse 中 sections 提取逻辑 |
| FR-004 (SkillMdInfo 输出类型) | T001, T006 | types.ts 定义 + Parser 返回 |
| FR-005 (无 frontmatter 降级推断) | T006, T005 | doParse 降级逻辑 + 测试验证 |
| FR-006 (SkillMdParser 元数据) | T006, T005 | id/name/filePatterns 设置 + 测试验证 |
| FR-007 (BehaviorYamlParser 实现) | T010 | behavior-yaml-parser.ts |
| FR-008 (双格式支持) | T010 | detectFormat + parseYaml/parseMarkdown |
| FR-009 (BehaviorInfo 输出类型) | T001, T010 | types.ts 定义 + Parser 返回 |
| FR-010 (Markdown 格式解析规则) | T010 | parseMarkdown 方法 |
| FR-011 (YAML 正则解析) | T010 | parseYaml 方法 |
| FR-012 (BehaviorYamlParser 元数据) | T010, T009 | id/name/filePatterns 设置 + 测试验证 |
| FR-013 (DockerfileParser 实现) | T014 | dockerfile-parser.ts |
| FR-014 (核心指令类型识别) | T014 | parseInstruction 方法 |
| FR-015 (多行拼接) | T014, T013 | joinMultilineInstructions + 测试验证 |
| FR-016 (多阶段构建检测) | T014, T013 | doParse 中 FROM 检测逻辑 + 测试验证 |
| FR-017 (DockerfileInfo 输出类型) | T001, T014 | types.ts 定义 + Parser 返回 |
| FR-018 (忽略注释和空行) | T014, T013 | 过滤逻辑 + 测试验证 |
| FR-019 (DockerfileParser 元数据) | T014, T013 | id/name/filePatterns 设置 + 测试验证 |
| FR-020 (parseAll 批量容错) | T002, T016-T018 | AbstractArtifactParser 实现 + 测试验证 |
| FR-021 (parse 容错降级) | T002, T006, T010, T014 | AbstractArtifactParser try-catch + 各 Parser createFallback |
| FR-022 (降级结果定义) | T006, T010, T014 | 各 Parser 的 createFallback 方法 |
| FR-023 (独立文件存放) | T006, T010, T014 | parsers/ 目录下各自独立文件 |
| FR-024 (不引入新依赖) | T025 | 依赖检查验证 |
| FR-025 (接口导入和 Schema 验证) | T006, T010, T014 | 构造时验证元数据 |
| FR-026 (npm run build 通过) | T022 | 构建验证 |
| FR-027 (npm test 通过) | T023 | 测试验证 |
| FR-028 (SkillMdParser 单元测试) | T005 | skill-md-parser.test.ts |
| FR-029 (BehaviorYamlParser 单元测试) | T009 | behavior-yaml-parser.test.ts |
| FR-030 (DockerfileParser 单元测试) | T013 | dockerfile-parser.test.ts |
| FR-031 (fixture 文件目录) | T004, T008, T012 | tests/panoramic/fixtures/ 子目录 |
| FR-032 (四类测试场景覆盖) | T005, T009, T013, T016-T021 | 正常/格式降级/空文件/parseAll |
| FR-033 (输出类型定义) | T001 | types.ts 集中定义 |
| FR-034 (Zod Schema) | T001 | types.ts 中 Schema 定义 |

**FR 覆盖率**: 34/34 = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖——可立即开始
- **Phase 2 (US1 SkillMdParser)**: 依赖 Phase 1 完成
- **Phase 3 (US2 BehaviorYamlParser)**: 依赖 Phase 1 完成
- **Phase 4 (US3 DockerfileParser)**: 依赖 Phase 1 完成
- **Phase 5 (US4 parseAll)**: 依赖 Phase 2 + 3 + 4 全部完成
- **Phase 6 (US5 容错边界)**: 依赖 Phase 2 + 3 + 4 全部完成
- **Phase 7 (Polish)**: 依赖 Phase 5 + 6 完成

### User Story Dependencies

- **US1 (SkillMdParser)**: 仅依赖 Phase 1 的基础设施
- **US2 (BehaviorYamlParser)**: 仅依赖 Phase 1 的基础设施，与 US1 完全独立
- **US3 (DockerfileParser)**: 仅依赖 Phase 1 的基础设施，与 US1/US2 完全独立
- **US4 (parseAll)**: 依赖 US1 + US2 + US3 的实现（测试需要所有三个 Parser）
- **US5 (容错边界)**: 依赖 US1 + US2 + US3 的实现（测试需要所有三个 Parser）

### Parallel Opportunities

```text
Phase 1 (Setup)
  ├── T001 [P] types.ts
  ├── T002 [P] abstract-artifact-parser.ts    ← T002 依赖 T001 的类型，需串行
  └── T003     index.ts                       ← 依赖 T001 + T002

Phase 2, 3, 4 可完全并行:
  ├── Phase 2 (US1): T004 ─┬→ T005 ─→ T006 → T007
  │                         │    ↑
  │                         └────┘ (fixture + test 可并行)
  ├── Phase 3 (US2): T008 ─┬→ T009 ─→ T010 → T011
  │                         └────┘
  └── Phase 4 (US3): T012 ─┬→ T013 ─→ T014 → T015
                            └────┘

Phase 5 + 6 可并行:
  ├── T016 [P] + T017 [P] + T018 [P]   (parseAll 测试)
  └── T019 [P] + T020 [P] + T021 [P]   (容错边界测试)

Phase 7: T022 → T023 → T024 [P] + T025 [P] + T026
```

### Recommended Strategy

**MVP First (US1 Only)**:
1. Phase 1 (T001-T003) → Phase 2 (T004-T007) → 验证 SkillMdParser 独立工作
2. 此时已可被 Feature 039 (ConfigReferenceGenerator) 消费

**Incremental Delivery**:
1. Phase 1 → Phase 2 (US1) → Phase 3 (US2) → Phase 4 (US3) → Phase 5+6 → Phase 7
2. 每完成一个 Parser 即可被对应的下游 Generator 消费

**Parallel Team Strategy**:
1. 团队完成 Phase 1
2. 三名开发者分别实现 Phase 2 / 3 / 4（完全并行）
3. Phase 5 + 6 集成验证
4. Phase 7 收尾

---

## Task Summary

| 统计项 | 数值 |
|--------|------|
| 总任务数 | 26 |
| User Stories 覆盖 | 5/5 |
| FR 覆盖率 | 34/34 (100%) |
| 可并行任务占比 | 14/26 (54%) |
| 新增源文件 | 6 个 (types.ts, abstract-artifact-parser.ts, skill-md-parser.ts, behavior-yaml-parser.ts, dockerfile-parser.ts, index.ts) |
| 新增测试文件 | 3 个 |
| 新增 fixture 文件 | 13 个 |
