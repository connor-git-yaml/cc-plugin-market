---
feature: "092-config-ux-and-cross-feature-guard"
research_mode: tech-only
created: 2026-04-06
status: Draft
milestone: M-088
---

# Feature 092: 配置体验 + 跨 Feature 守护

## 概述

spec-driver 的 4 层配置优先级链（命令行参数 → Agent 覆盖 → preset 默认值 → 编排器内置默认值）对用户完全不透明：配置出错时无校验反馈、无法得知最终生效值的来源。与此同时，多个 Feature 串行修改同一模块时缺少协调机制（文件冲突直到 Git 合并才暴露），验证命令无超时保护（挂起的测试会阻塞整个流程）。这些问题在 M-083 review 中被识别为 P1 遗留项。

本 Feature 通过 6 项改进，在**配置可观测性**、**跨 Feature 冲突预警**和**验证健壮性**三个维度补齐短板：

1. 配置 Schema 校验前移至 init-project.sh 阶段
2. effective config 展示（含来源标注）
3. 跨 Feature 文件冲突检测（analyze Agent Pass G）
4. 验证命令超时保护（`verification.timeout` 配置）
5. sync 文档矛盾检测与术语一致性检查（补全 087 遗留）
6. 8 个 SKILL.md frontmatter 声明增强（`allowed-tools` / `model` / `effort`）

**来源**：M-083 code-review SS4.1/4.2/6.2 + retrospective SS6.1/7.1 + audit SS2.5

---

## User Scenarios & Testing

### User Story 1 -- 配置错误提前发现（Priority: P1）

作为 spec-driver 用户，我在修改 `spec-driver.config.yaml` 时打了一个拼写错误（如 `pereset` 而非 `preset`），我希望在 `init-project.sh` 阶段就收到明确的校验错误和修复建议，而不是在编排器运行到一半时才因配置异常而失败。

**Why this priority**: 配置校验是所有其他改进的基础。没有可靠的配置入口，后续的 effective config 展示、超时配置等都无法保证数据质量。且错误越早发现修复成本越低。

**Independent Test**: 故意在 `spec-driver.config.yaml` 中制造结构错误（缺少必填字段、类型错误、未知字段），运行 `init-project.sh`，验证输出包含校验错误信息和修复建议。

**Acceptance Scenarios**:

1. **Given** `spec-driver.config.yaml` 中 `preset` 字段拼写为 `pereset`，**When** 运行 `init-project.sh`，**Then** 输出包含"未知字段 `pereset`，你是否想写 `preset`？"的修复建议
2. **Given** `spec-driver.config.yaml` 中 `preset` 值为 `999`（非法值），**When** 运行 `init-project.sh`，**Then** 输出包含合法值列表（`balanced` / `quality-first` / `cost-efficient`）
3. **Given** `spec-driver.config.yaml` 格式完全合法，**When** 运行 `init-project.sh`，**Then** 校验通过，无额外输出

---

### User Story 2 -- 配置透明化（Priority: P1）

作为 spec-driver 用户，面对 4 层配置优先级，我无法确定某个配置项最终生效的是哪一层的值。我希望编排器初始化时输出一份 effective config 表，清楚标注每项的生效值和来源层级。

**Why this priority**: 直接解决"配置优先级链对用户不透明"这一核心痛点。与 Story 1 配合形成完整的配置可观测性体验。

**Independent Test**: 在 `spec-driver.config.yaml` 中配置部分字段、留部分字段使用默认值，运行编排器初始化，验证 effective config 输出中每项都标注了来源（`config.yaml` / `config.yaml agents` / `--preset` / `内置默认`）。

**Acceptance Scenarios**:

1. **Given** `spec-driver.config.yaml` 中设置了 `preset: quality-first`，**When** 编排器初始化，**Then** effective config 中 `preset` 一行显示 `quality-first` 且来源标注为 `config.yaml`
2. **Given** `spec-driver.config.yaml` 中未设置 `verification.timeout`，**When** 编排器初始化，**Then** effective config 中 `verification.timeout` 一行显示 `300` 且来源标注为 `内置默认`
3. **Given** 使用 `--preset cost-efficient` 命令行参数覆盖了 config.yaml 中的 `preset: quality-first`，**When** 编排器初始化，**Then** effective config 中 `preset` 一行显示 `speed-first` 且来源标注为 `--preset 命令行参数`

---

### User Story 3 -- 跨 Feature 冲突预警（Priority: P2）

作为 spec-driver 用户，当我的 Feature 修改的文件与近期其他 Feature 存在重叠时，我希望 analyze Agent 在一致性分析阶段就给出 OVERLAP_WARNING，让我在实现前评估冲突风险。

**Why this priority**: 冲突检测是"跨 Feature 守护"的核心能力。但其价值依赖于多 Feature 并行场景的出现频率，优先级略低于面向所有用户的配置可观测性。

**Independent Test**: 在 specs/ 下准备两个 Feature 的 tasks.md，使其引用重叠的 `src/` 文件路径，运行 analyze Agent，验证输出包含 OVERLAP_WARNING 及重叠文件列表。

**Acceptance Scenarios**:

1. **Given** 当前 Feature 的 tasks.md 引用了 `src/foo.ts` 和 `src/bar.ts`，近期 Feature X 的 tasks.md 也引用了 `src/foo.ts`，**When** analyze Agent 执行 Pass G，**Then** 输出 `OVERLAP_WARNING`，包含重叠文件 `src/foo.ts` 和对应 Feature 编号
2. **Given** 当前 Feature 与近期 Feature 仅在 `package.json` 上重叠（通用配置文件），**When** analyze Agent 执行 Pass G，**Then** 不输出 OVERLAP_WARNING（通用配置文件排除）
3. **Given** 近期 5 个 Feature 均无文件与当前 Feature 重叠，**When** analyze Agent 执行 Pass G，**Then** 输出 `Pass G: CLEAN`

---

### User Story 4 -- 验证命令超时保护（Priority: P2）

作为 spec-driver 用户，当验证命令（如 `npm test`）因死循环或网络阻塞而挂起时，我希望有超时机制自动终止该命令，避免整个流程无限等待。

**Why this priority**: 防止验证阶段的单点故障拖垮整条流水线。当 Feature 涉及网络请求或长时间编译时尤为重要。

**Independent Test**: 配置 `verification.timeout: 5`（5 秒），执行一个耗时超过 5 秒的验证命令，验证命令被超时终止且输出超时提示。

**Acceptance Scenarios**:

1. **Given** `spec-driver.config.yaml` 中设置 `verification.timeout: 10`，**When** 验证命令执行超过 10 秒，**Then** 命令被终止，输出包含超时原因
2. **Given** `spec-driver.config.yaml` 中未设置 `verification.timeout`，**When** 验证命令执行，**Then** 使用默认超时值 300 秒
3. **Given** `verification.timeout` 设置为非正数，**When** 运行配置 Schema 校验，**Then** 输出校验错误并提示值必须为正整数

---

### User Story 5 -- sync 文档矛盾检测（Priority: P3）

作为 spec-driver 用户，当我执行 sync 聚合产品活文档时，我希望 sync Agent 能检测不同 Feature spec 之间的矛盾描述和术语不一致，避免合并后的 current-spec.md 内部自相矛盾。

**Why this priority**: 补全 087 遗留的健康度检查能力。价值真实但使用频率低于每次执行都触发的配置校验和每次 analyze 都运行的冲突检测。

**Independent Test**: 在两个 Feature 的 spec.md 中使用不同术语描述相同概念（如一个写"编排器"一个写"调度器"），运行 sync，验证输出包含术语不一致警告。

**Acceptance Scenarios**:

1. **Given** Feature A spec.md 使用术语"编排器"、Feature B spec.md 使用术语"调度器"描述同一概念，**When** sync Agent 执行矛盾检测，**Then** 输出术语不一致警告
2. **Given** Feature A spec.md 声明"最大文件行数 800 行"、Feature B spec.md 声明"最大文件行数 1000 行"，**When** sync Agent 执行矛盾检测，**Then** 输出数值矛盾警告
3. **Given** 所有 Feature spec 之间无矛盾，**When** sync Agent 执行矛盾检测，**Then** 检测通过，无额外警告

---

### User Story 6 -- Skill frontmatter 声明完整（Priority: P3）

作为 Skill 维护者或编排器，我希望 8 个 SKILL.md 都有完整的 frontmatter 声明（`allowed-tools` / `model` / `effort`），以便运行时据此做工具白名单和模型选择决策。

**Why this priority**: 纯元数据补全，改动量极小，但为后续 089 编排拆分提供结构化的 Skill 元信息基础。

**Independent Test**: 逐一检查 8 个 SKILL.md 的 frontmatter 区域，验证每个都包含 `allowed-tools`、`model`、`effort` 三个字段且值合法。

**Acceptance Scenarios**:

1. **Given** 8 个 SKILL.md（feature/story/implement/fix/resume/sync/doc/constitution），**When** 检查 frontmatter，**Then** 每个都包含 `allowed-tools`、`model`、`effort` 字段
2. **Given** frontmatter 中 `model` 字段值，**When** 校验，**Then** 值为 `opus` / `sonnet` / `haiku` 之一
3. **Given** frontmatter 中 `effort` 字段值，**When** 校验，**Then** 值为 `low` / `medium` / `high` 之一

---

### Edge Cases

- 当 `spec-driver.config.yaml` 文件完全为空（0 字节）时，Schema 校验应输出友好提示而非解析器栈追踪
- 当 YAML 语法本身非法（如缩进错误）时，应输出 YAML 语法错误提示，而非 Schema 校验错误
- 当 specs/ 下不足 5 个 Feature 目录时，跨 Feature 冲突检测应扫描所有可用 Feature 而非报错
- 当某个近期 Feature 的 tasks.md 不存在时，跳过该 Feature 继续检测
- 当 `verification.timeout` 设置为极大值（如 86400）时，应接受但输出警告提示值偏大

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 在 `init-project.sh` 阶段对 `spec-driver.config.yaml` 执行 Schema 校验，校验失败时输出精确的错误位置和修复建议
- **FR-002**: 系统 MUST 在 Schema 校验中区分 YAML 语法错误和 Schema 结构错误，分别输出不同的错误信息
- **FR-003**: 系统 MUST 在 `init-project.sh` 阶段通过 `validate-config.mjs --show-effective` 输出 effective config 表，包含每个配置项的生效值和来源层级
- **FR-004**: effective config 展示 MUST 覆盖所有配置层级：命令行参数、Agent 覆盖、preset 默认值、编排器内置默认值
- **FR-005**: analyze Agent MUST 在一致性分析中包含跨 Feature 文件冲突检测（Pass G），扫描近 5 个活跃 Feature 的 tasks.md（按编号倒序，排除 status 为 `Completed` 或 `Abandoned` 的 Feature）
- **FR-006**: 跨 Feature 冲突检测 MUST 排除通用配置文件（`package.json`、`tsconfig.json`、`spec-driver.config.yaml`），仅检测 `src/`、`plugins/`、`scripts/` 下的文件
- **FR-007**: 跨 Feature 冲突检测 MUST 按严重性分级：3+ 文件重叠为 HIGH，1-2 文件重叠为 MEDIUM，仅测试文件重叠为 LOW
- **FR-008**: `spec-driver.config.yaml` MUST 支持 `verification.timeout` 字段，值类型为正整数（秒），默认值 300
- **FR-009**: 编排器在启动 verify Agent 时 MUST 将 `verification.timeout` 值注入到 verify Agent 的上下文中；verify Agent MUST 在执行每个 Bash 验证命令时附加 `timeout {N}s` 前缀
- **FR-010**: sync Agent MUST 在聚合产品活文档时包含矛盾检测——识别不同 Feature spec 之间的数值冲突和行为描述冲突
- **FR-011**: sync Agent MUST 在聚合产品活文档时包含术语一致性检查——识别同一概念在不同 spec 中使用不同术语的情况
- **FR-012**: 8 个 SKILL.md（feature/story/implement/fix/resume/sync/doc/constitution）MUST 在 frontmatter 中包含 `allowed-tools`、`model`、`effort` 声明
- **FR-013**: Schema 校验脚本 MUST 采用项目已有的 `createCheck()` 标准化检查结果模式，输出可被 `repo:check` 链路消费的结果
- **FR-014**: Schema 校验 MUST 基于项目已有的 `simple-yaml.mjs`（YAML 解析）和 Zod（结构校验）实现，不引入新的外部依赖

### Key Entities

- **specDriverConfigSchema**: `spec-driver.config.yaml` 的完整配置 Schema，定义所有合法字段、类型和默认值
- **effective config**: 编排器实际使用的合并后配置快照，每项标注来源层级
- **OVERLAP_WARNING**: analyze Agent Pass G 产出的冲突检测结果，包含重叠文件列表、对应 Feature 编号和严重性分级

---

## 非功能需求

- **NFR-001**: Schema 校验脚本执行时间不超过 2 秒（配置文件通常 <100 行）
- **NFR-002**: 所有变更为追加型——不删除现有脚本逻辑、不修改 SKILL.md body（仅改 frontmatter）
- **NFR-003**: 新增代码遵循 `scripts/lib/` 现有模块化风格（独立导出函数、标准化错误处理）
- **NFR-004**: 与 090 并行开发无冲突——SKILL.md 仅改 frontmatter（头 5-8 行），090 仅改 body（第 10 行以后）

---

## 约束

- **C-001**: 零新增外部依赖（遵循宪法原则 III YAGNI）
- **C-002**: Schema 校验优先用项目已有的 `simple-yaml.mjs` 解析能力 + Zod 校验，不引入新的 YAML 解析库
- **C-003**: effective config 展示不修改 SKILL.md body，采用独立脚本方案（避免与 090 的 body 改动冲突）
- **C-004**: SKILL.md frontmatter 增强仅修改 `---` 区域内的声明，不触碰 body 内容

---

## 并行开发协调

| 本 Feature（092）改动 | 并行 Feature 改动 | 冲突风险 | 协调方案 |
|---|---|---|---|
| SKILL.md frontmatter | 090 改 SKILL.md body | 低 | 物理位置分离（头 5-8 行 vs 第 10 行以后） |
| config.yaml Schema（`verification.timeout`） | 090 config.yaml（`gates.GATE_IMPLEMENT_MID`） | 无 | 不同字段，合并无冲突 |
| sync.md 健康度检查扩展 | 091 sync.md 合并算法瘦身 | 低 | 按蓝图建议：092 先合并，091 在其基础上瘦身 |
| analyze.md Pass G | 无并行改动 | 无 | 独占改动 |

---

## 技术风险

| ID | 风险 | 影响 | 缓解措施 |
|---|---|---|---|
| R1 | `simple-yaml.mjs` 解析能力有限（无多行字符串、锚点支持） | 复杂 YAML 语法可能导致解析失败 | config 文件结构简单（flat/nested mapping），当前解析器够用；解析失败时输出友好错误而非 Schema 错误 |
| R2 | 跨 Feature 冲突检测依赖 tasks.md 中文件路径引用的格式一致性 | 路径格式不统一导致检测准确度下降 | 使用宽松正则匹配常见模式，对无法解析的路径跳过而非报错 |
| R3 | 092 与 090 并行开发时 SKILL.md Git 合并冲突 | 头部 frontmatter 与 body 在同一文件中 | frontmatter 改动集中在文件头 5-8 行，与 body 改动物理距离远，Git 三向合并可自动解决 |
| R4 | 验证超时在 Prompt 编排中无法"强制"执行 | LLM 无法真正控制 Bash 进程超时行为 | verify Agent Prompt 中明确指示使用 Bash `timeout` 命令前缀，该工具为 coreutils 标准 |
| R5 | sync.md 矛盾检测扩展可能与 091 产生冲突 | 091 会瘦身 sync.md 合并算法核心 | 092 矛盾检测追加在"文档健康度检查"区域（L292-304），091 主要瘦身的是合并算法核心（L38-190），改动位置不同 |

---

## 已澄清决策

- **effective config 展示位置**：采用脚本方案——通过 `validate-config.mjs --show-effective` 在 `init-project.sh` 阶段输出。理由：(1) 满足 C-003 不修改 SKILL.md body 约束；(2) 与 090 并行零冲突；(3) init 阶段输出比编排器内部更早，用户体验更好。
- **"近 5 个 Feature"排序规则**：按 Feature 编号倒序取最近 5 个活跃 Feature，排除 spec.md frontmatter 中 `status: Completed` 或 `status: Abandoned` 的 Feature。不足 5 个时扫描所有可用。

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `init-project.sh` 对包含至少 3 种不同结构错误的 `spec-driver.config.yaml` 分别输出对应的校验错误和修复建议
- **SC-002**: 编排器初始化阶段输出 effective config 表，覆盖所有配置项且每项来源标注正确
- **SC-003**: analyze.md 包含 Pass G 跨 Feature 文件冲突检测逻辑，对人工构造的重叠场景正确输出 OVERLAP_WARNING（含文件列表和严重性分级）
- **SC-004**: `spec-driver.config.yaml` 的 Zod Schema 包含 `verification.timeout` 字段定义（正整数，默认 300）
- **SC-005**: sync.md 包含矛盾检测和术语一致性检查逻辑，对人工构造的矛盾场景正确输出警告
- **SC-006**: 8 个 SKILL.md 的 frontmatter 均包含 `allowed-tools`、`model`、`effort` 声明
- **SC-007**: `npm run repo:check` 全部 pass
- **SC-008**: 新增代码零外部依赖，仅使用 `simple-yaml.mjs` + Zod + Node.js 内置模块
