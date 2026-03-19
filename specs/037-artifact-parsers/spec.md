# Feature Specification: 非代码制品解析

**Feature Branch**: `037-artifact-parsers`
**Created**: 2026-03-19
**Status**: Draft
**Input**: User description: "实现 ArtifactParser 的首批具体实现：SkillMdParser（解析 SKILL.md）、BehaviorYamlParser（解析 behavior YAML/Markdown）、DockerfileParser（解析 Dockerfile），全部实现 Feature 034 定义的 ArtifactParser<T> 接口。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - SkillMdParser 解析 SKILL.md 文件（Priority: P1）

作为全景文档化流水线的消费者（如 ConfigReferenceGenerator 或 ArchitectureOverviewGenerator），我需要一个 SkillMdParser 能够解析 SKILL.md 文件，从 YAML frontmatter 中提取 name/description/version，从 Markdown body 中提取标题和分段内容，以便后续 Generator 能够基于结构化的 Skill 信息生成文档。

**Why this priority**: SkillMdParser 是蓝图验证标准的核心验证项（"解析 OctoAgent 的 SKILL.md 文件，正确提取 trigger/description/constraints"）。OctoAgent 项目包含 10+ 个 SKILL.md 文件，是验证价值最高的制品类型。同时 Feature 039（配置参考手册）强依赖 Feature 037 的解析能力。

**Independent Test**: 准备一个包含 YAML frontmatter 和 Markdown sections 的 SKILL.md 测试文件，调用 `skillMdParser.parse(filePath)`，验证返回的结构化数据包含正确的 name、description、version 和 sections 列表。

**Acceptance Scenarios**:

1. **Given** 一个包含标准 YAML frontmatter（`---` 分隔，含 name/description/version 字段）和 Markdown body 的 SKILL.md 文件，**When** 调用 `parse(filePath)`，**Then** 返回的 SkillMdInfo 对象中 name、description、version 与源文件 frontmatter 一致，sections 数组按标题层级顺序包含所有 `##` 级别的分段
2. **Given** 一个仅有 Markdown body 但无 YAML frontmatter 的 SKILL.md 文件，**When** 调用 `parse(filePath)`，**Then** 返回的 SkillMdInfo 对象中 name 从 `#` 一级标题推断，version 为 undefined，description 为空字符串，sections 仍正确提取
3. **Given** 一个包含多个 `##` 二级标题（如 Commands、Workflow、Constraints）的 SKILL.md 文件，**When** 调用 `parse(filePath)`，**Then** sections 数组中每个元素包含 heading（标题文本）和 content（标题下的正文内容），且顺序与源文件一致

---

### User Story 2 - BehaviorYamlParser 解析行为定义文件（Priority: P1）

作为全景文档化流水线的消费者，我需要一个 BehaviorYamlParser 能够解析 behavior 目录下的 YAML 或 Markdown 文件，提取状态-行为映射关系（state-action mapping），以便后续 Generator 能够基于结构化的行为信息生成文档。

**Why this priority**: BehaviorYamlParser 是蓝图验证标准的第二个核心验证项（"解析 OctoAgent 的 behavior YAML 文件，正确提取状态-行为映射关系"）。OctoAgent 的 behavior/ 目录目前使用 Markdown 格式而非纯 YAML，因此 Parser 需要同时支持两种格式的解析能力。

**Independent Test**: 准备一个包含状态-行为定义的 behavior YAML 文件和一个 Markdown 格式的 behavior 文件，分别调用 `behaviorYamlParser.parse(filePath)`，验证两种格式都能正确提取状态名称和关联的行为列表。

**Acceptance Scenarios**:

1. **Given** 一个 YAML 格式的 behavior 文件（含 states 和对应 actions 的键值结构），**When** 调用 `parse(filePath)`，**Then** 返回的 BehaviorInfo 对象中 states 数组包含每个状态的 name、description 和 actions 列表
2. **Given** 一个 Markdown 格式的 behavior 文件（标题作为状态名、段落作为描述、列表项作为行为），**When** 调用 `parse(filePath)`，**Then** 返回的 BehaviorInfo 对象中 states 数组按标题分段提取，每个状态包含从标题推断的 name、从段落推断的 description、从列表推断的 actions
3. **Given** 一个既非合法 YAML 也非标准 Markdown 的 behavior 文件（如纯文本或损坏内容），**When** 调用 `parse(filePath)`，**Then** 返回一个降级的 BehaviorInfo 对象（states 为空数组），而非抛出异常

---

### User Story 3 - DockerfileParser 解析 Dockerfile（Priority: P2）

作为部署文档生成流程的消费者（如 Feature 043 的 DeploymentGenerator），我需要一个 DockerfileParser 能够解析 Dockerfile，提取基础镜像、构建指令和多阶段构建信息，以便后续 Generator 能够基于结构化的构建信息生成部署/运维文档。

**Why this priority**: DockerfileParser 的验证价值低于 SkillMdParser 和 BehaviorYamlParser（蓝图验证标准未直接要求 Dockerfile 解析的 OctoAgent 验证），但它是 Feature 043（部署运维文档）的强前置依赖，且 OctoAgent 包含 133 行的多阶段 Dockerfile，具备真实验证场景。

**Independent Test**: 准备一个包含多阶段构建的 Dockerfile 测试文件（含 FROM/RUN/COPY/ENV/EXPOSE/CMD 等指令），调用 `dockerfileParser.parse(filePath)`，验证返回的 stages 列表正确反映各构建阶段的基础镜像和指令序列。

**Acceptance Scenarios**:

1. **Given** 一个单阶段 Dockerfile（一个 FROM 指令），**When** 调用 `parse(filePath)`，**Then** 返回的 DockerfileInfo 对象中 stages 数组长度为 1，包含正确的 baseImage 和全部指令列表
2. **Given** 一个多阶段 Dockerfile（多个 FROM 指令，含 `AS alias`），**When** 调用 `parse(filePath)`，**Then** stages 数组按 FROM 出现顺序包含多个阶段，每个阶段的 baseImage、alias 和 instructions 均正确提取
3. **Given** 一个包含多行指令（行尾 `\` 续行符）的 Dockerfile，**When** 调用 `parse(filePath)`，**Then** 多行指令被正确拼接为单条完整指令，拼接后的 args 字段不包含续行符
4. **Given** 一个包含注释行（`#` 开头）和空行的 Dockerfile，**When** 调用 `parse(filePath)`，**Then** 注释和空行被正确忽略，不出现在 instructions 列表中

---

### User Story 4 - parseAll 批量解析（Priority: P2）

作为全景文档化流水线的编排器（batch-orchestrator），我需要每个 Parser 的 `parseAll()` 方法能够接收一组文件路径并返回解析结果数组，以便在一次调用中批量处理项目中所有匹配的制品文件。

**Why this priority**: `parseAll()` 是 ArtifactParser 接口的必要方法，但其默认实现为循环调用 `parse()`，实现简单。作为批量入口，它对编排器层面的集成至关重要，但核心解析逻辑由各 Parser 的 `parse()` 承载。

**Independent Test**: 准备 3 个 SKILL.md 测试文件，调用 `skillMdParser.parseAll(filePaths)`，验证返回数组长度为 3 且每个元素对应正确的解析结果。

**Acceptance Scenarios**:

1. **Given** 3 个 SKILL.md 文件路径，**When** 调用 `parseAll(filePaths)`，**Then** 返回长度为 3 的数组，每个元素为对应文件的 SkillMdInfo 解析结果
2. **Given** 一个空文件路径数组，**When** 调用 `parseAll([])`，**Then** 返回空数组，不抛出异常
3. **Given** 3 个文件路径其中 1 个不存在，**When** 调用 `parseAll(filePaths)`，**Then** 返回长度为 3 的数组，其中不存在文件对应的元素为降级结果（非 null/undefined），其余 2 个元素为正常解析结果

---

### User Story 5 - 容错降级与文件模式匹配（Priority: P2）

作为全景文档化流水线的维护者，我需要每个 Parser 在解析失败时返回降级结果而非抛出异常，且每个 Parser 的 filePatterns 属性使用 glob 格式声明支持的文件类型，以便上游调用方能够安全地发现和调用 Parser。

**Why this priority**: 容错设计是蓝图风险清单第 2 项的缓解策略要求（"parse 失败返回降级结果而非抛异常"），确保单个文件的解析失败不会中断整个批量流水线。filePatterns 是 ArtifactParser 接口的核心属性，决定了 Parser 的文件发现能力。

**Independent Test**: 传入一个格式损坏的文件路径调用 `parse()`，验证返回降级结果而非抛出异常；检查各 Parser 的 filePatterns 属性值是否为合法的 glob 模式。

**Acceptance Scenarios**:

1. **Given** 一个内容为空（0 字节）的 SKILL.md 文件，**When** 调用 `skillMdParser.parse(filePath)`，**Then** 返回一个 SkillMdInfo 对象（name 为空字符串或从文件名推断，sections 为空数组），不抛出异常
2. **Given** 一个二进制文件的路径传入 DockerfileParser，**When** 调用 `parse(filePath)`，**Then** 返回一个降级的 DockerfileInfo 对象（stages 为空数组），不抛出异常
3. **Given** SkillMdParser 实例，**When** 读取其 `filePatterns` 属性，**Then** 值为 `['**/SKILL.md']`
4. **Given** BehaviorYamlParser 实例，**When** 读取其 `filePatterns` 属性，**Then** 值包含 `'**/behavior/**/*.yaml'` 和 `'**/behavior/**/*.yml'` 以及 `'**/behavior/**/*.md'`
5. **Given** DockerfileParser 实例，**When** 读取其 `filePatterns` 属性，**Then** 值包含 `'**/Dockerfile'` 和 `'**/Dockerfile.*'`

---

### Edge Cases

- **文件编码异常**: 当制品文件使用非 UTF-8 编码（如 GBK、Latin-1）时，Parser 应尝试以 UTF-8 读取并在解码失败时返回降级结果，而非抛出异常
- **超大文件**: 当 SKILL.md 或 Dockerfile 超过合理大小（如 > 1MB）时，Parser 应正常解析而非拒绝处理（但不做特殊优化）
- **YAML frontmatter 格式不标准**: 当 SKILL.md 的 frontmatter 中出现不被简单正则支持的 YAML 特性（如多行字符串 `|`、锚点 `&`）时，SkillMdParser 应提取能识别的字段并忽略不支持的语法，而非整体失败
- **Dockerfile ARG 在 FROM 前**: 当 Dockerfile 在第一个 FROM 之前使用 ARG 指令定义构建参数时，DockerfileParser 应正确识别这些全局 ARG，不将其归属到任何 stage
- **behavior 文件为空目录**: 当 behavior/ 目录存在但无任何文件时，`parseAll([])` 应返回空数组
- **文件路径不存在**: 当 `parse(filePath)` 的目标文件路径不存在时，应返回降级结果（容错优先），内部可记录警告日志
- **同名标题重复**: 当 SKILL.md 包含多个同名 `##` 标题时，sections 数组应保留全部条目（不去重），按出现顺序排列
- **Dockerfile 无指令**: 当 Dockerfile 仅包含注释行（无 FROM 或其他指令）时，返回 stages 为空数组的降级结果

## Requirements *(mandatory)*

### Functional Requirements

**SkillMdParser**

- **FR-001**: 系统 MUST 在 `src/panoramic/parsers/skill-md-parser.ts` 中实现 SkillMdParser，该类实现 `ArtifactParser<SkillMdInfo>` 接口 `[关联: Story 1]`
- **FR-002**: SkillMdParser MUST 解析 SKILL.md 文件的 YAML frontmatter（`---` 分隔符之间的内容），使用正则/行级解析提取 `name`、`description`、`version` 字段，不引入新 YAML 解析库 `[关联: Story 1]`
- **FR-003**: SkillMdParser MUST 解析 SKILL.md 文件的 Markdown body，提取一级标题（`#`）作为 title、二级标题（`##`）及其下方内容作为 sections 数组 `[关联: Story 1]`
- **FR-004**: SkillMdParser MUST 返回 `SkillMdInfo` 类型的结构化数据，包含以下字段：`name`（字符串）、`description`（字符串）、`version`（可选字符串）、`title`（字符串，一级标题）、`sections`（`{heading: string, content: string}[]`） `[关联: Story 1]`
- **FR-005**: 当 SKILL.md 文件无 YAML frontmatter 时，SkillMdParser MUST 从一级标题推断 name，description 设为空字符串，version 设为 undefined `[关联: Story 1]`
- **FR-006**: SkillMdParser 的 `id` MUST 为 `'skill-md'`，`name` MUST 为 `'SKILL.md Parser'`，`filePatterns` MUST 为 `['**/SKILL.md']` `[关联: Story 5]`

**BehaviorYamlParser**

- **FR-007**: 系统 MUST 在 `src/panoramic/parsers/behavior-yaml-parser.ts` 中实现 BehaviorYamlParser，该类实现 `ArtifactParser<BehaviorInfo>` 接口 `[关联: Story 2]`
- **FR-008**: BehaviorYamlParser MUST 支持两种格式的 behavior 文件解析：YAML 格式（解析结构化键值对）和 Markdown 格式（按标题分段提取） `[关联: Story 2]` `[AUTO-RESOLVED: OctoAgent 的 behavior/ 目录目前使用 Markdown 而非 YAML，需同时支持两种格式以满足验证需求]`
- **FR-009**: BehaviorYamlParser MUST 返回 `BehaviorInfo` 类型的结构化数据，包含以下字段：`states`（`{name: string, description: string, actions: string[]}[]`） `[关联: Story 2]`
- **FR-010**: 对 Markdown 格式的 behavior 文件，BehaviorYamlParser MUST 使用标题（`#`/`##`）作为状态名，段落文本作为描述，列表项（`-` 或 `*`）作为行为名称 `[关联: Story 2]`
- **FR-011**: 对 YAML 格式的 behavior 文件，BehaviorYamlParser MUST 使用正则/行级解析提取键值结构，不引入新 YAML 解析库 `[关联: Story 2]`
- **FR-012**: BehaviorYamlParser 的 `id` MUST 为 `'behavior-yaml'`，`name` MUST 为 `'Behavior YAML Parser'`，`filePatterns` MUST 包含 `'**/behavior/**/*.yaml'`、`'**/behavior/**/*.yml'` 和 `'**/behavior/**/*.md'` `[关联: Story 5]`

**DockerfileParser**

- **FR-013**: 系统 MUST 在 `src/panoramic/parsers/dockerfile-parser.ts` 中实现 DockerfileParser，该类实现 `ArtifactParser<DockerfileInfo>` 接口 `[关联: Story 3]`
- **FR-014**: DockerfileParser MUST 逐行扫描 Dockerfile，识别以下核心指令类型：FROM、RUN、COPY、ADD、ENV、EXPOSE、CMD、ENTRYPOINT、WORKDIR、ARG、LABEL、VOLUME、USER、HEALTHCHECK `[关联: Story 3]`
- **FR-015**: DockerfileParser MUST 正确处理多行指令拼接——当行尾为 `\`（续行符）时，将后续行拼接为单条完整指令 `[关联: Story 3]`
- **FR-016**: DockerfileParser MUST 检测多阶段构建——每个 FROM 指令开启一个新的 stage，`FROM image AS alias` 格式中的 alias 作为 stage 别名 `[关联: Story 3]`
- **FR-017**: DockerfileParser MUST 返回 `DockerfileInfo` 类型的结构化数据，包含以下字段：`stages`（`{baseImage: string, alias?: string, instructions: {type: string, args: string}[]}[]`） `[关联: Story 3]`
- **FR-018**: DockerfileParser MUST 忽略注释行（`#` 开头）和空行 `[关联: Story 3]`
- **FR-019**: DockerfileParser 的 `id` MUST 为 `'dockerfile'`，`name` MUST 为 `'Dockerfile Parser'`，`filePatterns` MUST 为 `['**/Dockerfile', '**/Dockerfile.*']` `[关联: Story 5]`

**共通要求——parseAll 与容错**

- **FR-020**: 每个 Parser 的 `parseAll(filePaths)` MUST 默认循环调用 `parse()`，返回与输入数组等长的结果数组。单个文件解析失败时，对应位置返回降级结果，不中断整个批量流程 `[关联: Story 4]`
- **FR-021**: 每个 Parser 的 `parse(filePath)` 在文件不存在、内容为空或格式无法识别时 MUST 返回降级结果（合法但内容为空/最小化的输出类型对象），而非抛出异常 `[关联: Story 5]`
- **FR-022**: 降级结果的具体定义：SkillMdInfo 降级为 `{name: '', description: '', title: '', sections: []}`；BehaviorInfo 降级为 `{states: []}`；DockerfileInfo 降级为 `{stages: []}` `[关联: Story 5]`

**代码组织与依赖**

- **FR-023**: 每个 Parser MUST 作为独立文件存放在 `src/panoramic/parsers/` 目录下，文件名与 Parser 名称对应 `[关联: Story 1, 2, 3]`
- **FR-024**: 系统 MUST NOT 引入新的运行时依赖——全部解析逻辑使用纯正则和行级字符串处理实现，仅依赖 Node.js 内置模块（`fs`、`path`） `[关联: Story 1, 2, 3]`
- **FR-025**: 每个 Parser SHOULD 从 `src/panoramic/interfaces.ts` 导入 ArtifactParser 接口和 ArtifactParserMetadataSchema，并在构造时通过 Schema 验证自身 id/name/filePatterns `[关联: Story 5]`
- **FR-026**: `npm run build` MUST 在新增代码后零错误通过 `[关联: Story 1, 2, 3]`
- **FR-027**: 现有测试套件（`npm test`）在新增代码后 MUST 全部通过，无新增失败 `[关联: Story 1, 2, 3]`

**单元测试**

- **FR-028**: 系统 MUST 为 SkillMdParser 编写单元测试，测试文件路径为 `tests/panoramic/skill-md-parser.test.ts` `[关联: Story 1]`
- **FR-029**: 系统 MUST 为 BehaviorYamlParser 编写单元测试，测试文件路径为 `tests/panoramic/behavior-yaml-parser.test.ts` `[关联: Story 2]`
- **FR-030**: 系统 MUST 为 DockerfileParser 编写单元测试，测试文件路径为 `tests/panoramic/dockerfile-parser.test.ts` `[关联: Story 3]`
- **FR-031**: 测试数据（fixture 文件）MUST 放在 `tests/panoramic/fixtures/` 子目录下 `[关联: Story 1, 2, 3]`
- **FR-032**: 每个 Parser 的单元测试 MUST 覆盖：正常解析、格式降级、空文件降级、parseAll 批量处理四类场景 `[关联: Story 1, 2, 3, 4, 5]`

**输出类型定义**

- **FR-033**: 系统 MUST 在 `src/panoramic/parsers/` 目录下定义 SkillMdInfo、BehaviorInfo、DockerfileInfo 三个输出类型，可集中在一个共享类型文件或各 Parser 文件中定义 `[关联: Story 1, 2, 3]`
- **FR-034**: 输出类型 SHOULD 有对应的 Zod Schema，支持运行时验证解析结果的结构正确性 `[关联: Story 1, 2, 3]`

### Key Entities

- **SkillMdParser**: SKILL.md 文件解析器。从 YAML frontmatter 提取 name/description/version 等元数据，从 Markdown body 提取标题和分段内容。使用纯正则解析，不依赖 YAML 库。实现 `ArtifactParser<SkillMdInfo>` 接口
- **SkillMdInfo**: SkillMdParser 的输出数据结构。包含 name（名称）、description（描述）、version（版本号，可选）、title（一级标题）、sections（二级标题和对应正文内容的数组）
- **BehaviorYamlParser**: 行为定义文件解析器。支持 YAML 和 Markdown 两种格式的 behavior 文件，提取状态-行为映射关系。实现 `ArtifactParser<BehaviorInfo>` 接口
- **BehaviorInfo**: BehaviorYamlParser 的输出数据结构。包含 states 数组，每个状态含 name（状态名）、description（描述）、actions（行为名称列表）
- **DockerfileParser**: Dockerfile 解析器。逐行扫描提取构建指令，支持多行拼接和多阶段构建检测。实现 `ArtifactParser<DockerfileInfo>` 接口
- **DockerfileInfo**: DockerfileParser 的输出数据结构。包含 stages 数组，每个阶段含 baseImage（基础镜像）、alias（阶段别名，可选）、instructions（指令列表，每条含 type 和 args）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: SkillMdParser 能够解析包含 YAML frontmatter 和 Markdown sections 的 SKILL.md 文件，提取的 name/description/version/sections 字段值与源文件内容一致
- **SC-002**: BehaviorYamlParser 能够解析 YAML 格式和 Markdown 格式两种 behavior 文件，提取的 states 数组正确反映状态名称、描述和行为列表
- **SC-003**: DockerfileParser 能够解析包含多阶段构建和多行拼接指令的 Dockerfile，提取的 stages 数组正确反映每个构建阶段的基础镜像、别名和指令序列
- **SC-004**: 三个 Parser 在遇到空文件、格式损坏或文件不存在等异常情况时均返回降级结果，不抛出异常——单个文件解析失败不会中断批量处理流程
- **SC-005**: 三个 Parser 的全部单元测试通过（`npm test` 退出码为 0），覆盖正常解析、格式降级、空文件降级、parseAll 批量处理四类场景
- **SC-006**: 不引入新的运行时依赖——`package.json` 的 dependencies 在 Feature 037 实施前后无新增项

## Clarifications

### Auto-Resolved

| # | 问题 | 影响 | 自动选择 | 理由 |
|---|------|------|---------|------|
| 1 | OctoAgent 的 behavior/ 目录使用 Markdown 而非 YAML 格式，BehaviorYamlParser 是否需要同时支持两种格式？ | FR-008, FR-010, FR-011, FR-012 | 同时支持 YAML 和 Markdown 两种格式。Parser 根据文件扩展名或内容特征自动判断格式 | 技术调研报告明确指出"OctoAgent 实际情况：behavior/ 目录目前使用 Markdown 而非 YAML。设计应支持两种格式"。蓝图验证标准要求解析 behavior YAML 文件并提取状态-行为映射，若不支持 Markdown 格式将无法通过 OctoAgent 验证。filePatterns 相应增加 `**/behavior/**/*.md` 模式 `[AUTO-RESOLVED]` |
| 2 | parseAll 的容错策略——单个文件解析失败时，对应位置应返回降级结果还是从结果数组中剔除？ | FR-020, FR-022 | 返回与输入数组等长的结果数组，失败位置返回降级结果（不剔除）。这样调用方可通过索引将结果与输入文件一一对应 | 技术调研报告第 5 节明确"parseAll 默认循环调用 parse()"，而 parse() 本身已采用降级策略。等长数组保持输入-输出的位置映射关系，方便调用方追溯哪些文件解析成功、哪些降级。与 batch-orchestrator 的降级模式一致 `[AUTO-RESOLVED]` |
