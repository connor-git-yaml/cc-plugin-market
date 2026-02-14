# Feature Specification: 统一 spec 输出目录引用（.specs → specs）

**Feature Branch**: `010-fix-dotspecs-to-specs`
**Created**: 2026-02-15
**Status**: Draft
**Input**: User description: "将项目中所有 spec 输出目录引用从 '.specs' 改为 'specs'。包括：源代码中的默认路径常量、CLI 帮助文本、SKILL.md 模板中的路径引用、README 和设计文档中的示例路径。这是一个路径统一修复，不涉及功能变更。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 源代码中的默认路径常量统一 (Priority: P1)

开发者在使用 reverse-spec CLI 时，所有默认输出目录应指向 `specs/` 而非 `.specs/`。当用户未显式指定 `--output-dir` 时，生成的 spec 文件应写入 `specs/` 目录。

**Why this priority**: 源代码中的路径常量直接决定运行时行为，是最核心的修复项。如果常量不改，所有下游引用都没有意义。

**Independent Test**: 在不带 `--output-dir` 参数的情况下运行 `generate` 和 `batch` 命令，确认输出目录为 `specs/` 而非 `.specs/`。

**Acceptance Scenarios**:

1. **Given** 源代码中存在 `.specs` 或 `.specs/` 字符串作为默认输出路径, **When** 全局搜索源代码目录, **Then** 不再找到任何 `.specs` 引用，均已替换为 `specs`
2. **Given** 用户运行 `reverse-spec generate src/foo.ts`（未指定 output-dir）, **When** 命令执行完毕, **Then** 输出文件写入 `specs/` 目录

---

### User Story 2 - CLI 帮助文本和 SKILL.md 模板路径统一 (Priority: P2)

用户阅读 CLI 帮助信息（`--help`）或 SKILL.md 中的使用示例时，所有路径示例应显示 `specs/` 而非 `.specs/`，避免文档与实际行为不一致造成困惑。

**Why this priority**: 帮助文本和 Skill 模板是用户获取使用指引的主要渠道，路径不一致会导致用户手动指定错误路径。

**Independent Test**: 运行 `reverse-spec --help`，检查输出中不包含 `.specs`。检查所有 SKILL.md 文件中不包含 `.specs` 引用。

**Acceptance Scenarios**:

1. **Given** CLI 帮助文本中存在 `.specs` 路径示例, **When** 执行 `--help`, **Then** 所有示例路径显示为 `specs/`
2. **Given** SKILL.md 模板中存在 `.specs` 路径引用, **When** 搜索所有 SKILL.md 文件, **Then** 不再包含 `.specs` 引用

---

### User Story 3 - 设计文档和 README 中的路径统一 (Priority: P3)

项目维护者或新贡献者阅读 README、设计文档（specs/ 目录下的 plan、research、quickstart 等文档）时，所有 spec 目录引用应一致显示为 `specs/`。

**Why this priority**: 文档路径一致性是项目质量的体现，但不影响运行时行为，优先级最低。

**Independent Test**: 在 `specs/`、`plugins/`、项目根目录下搜索所有 `.md` 文件，确认不存在 `.specs` 路径引用。

**Acceptance Scenarios**:

1. **Given** 设计文档或 README 中存在 `.specs` 路径, **When** 全量搜索项目 markdown 文件, **Then** 所有 `.specs` 引用已替换为 `specs`

---

### Edge Cases

- 如果某处 `.specs` 是正则表达式或 glob 模式的一部分（如 `*.specs`），不应被错误替换
- 如果某处 `.specs` 是对外部项目的引用（非本项目路径），不应被替换
- git 历史中的旧引用不需要修改

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 所有源代码文件（`src/` 目录下的 `.ts` 文件）中的 `.specs` 默认路径常量 MUST 替换为 `specs`
- **FR-002**: CLI 帮助文本（`HELP_TEXT` 常量及相关字符串）中的 `.specs` 路径示例 MUST 替换为 `specs`
- **FR-003**: 所有 SKILL.md 模板文件中的 `.specs` 路径引用 MUST 替换为 `specs`（包括 `src/skills-global/` 和 `plugins/reverse-spec/skills/`）
- **FR-004**: 项目 README 和设计文档中的 `.specs` 路径引用 MUST 替换为 `specs`
- **FR-005**: 替换 MUST 仅针对本项目的 spec 输出目录引用，不得误改正则表达式、glob 模式或外部项目引用
- **FR-006**: 此变更 MUST NOT 引入任何功能性变化，仅为路径字符串统一

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 项目全量搜索 `.specs` 关键词（排除 git 历史和 node_modules），结果为零匹配
- **SC-002**: 全部现有测试通过，无回归
- **SC-003**: `npm run build` 和 `npm run lint` 无错误
- **SC-004**: CLI `--help` 输出中所有路径示例使用 `specs/` 而非 `.specs/`
