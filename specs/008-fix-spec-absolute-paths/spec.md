# Feature Specification: 修复 Spec 输出中的绝对路径问题

**Feature Branch**: `008-fix-spec-absolute-paths`
**Created**: 2026-02-14
**Status**: Draft
**Input**: 修复生成的 spec 文件中使用绝对路径的问题：frontmatter 的 sourceTarget 字段和 spec 标题显示完整绝对路径，应改为相对于项目根目录的相对路径

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Spec 中的路径对所有用户可读 (Priority: P1)

作为使用 `reverse-spec` 生成 spec 的开发者，我希望生成的 spec 文件中的路径信息（标题、frontmatter 中的 sourceTarget）使用相对于项目根目录的路径，而不是暴露我本机的绝对路径。这样 spec 文件在团队中共享时不会包含个人环境信息，且路径更短更易读。

**Why this priority**: 这是影响所有 spec 输出的核心展示问题。绝对路径不仅冗长不可读，还会在提交到版本控制后暴露用户的本机目录结构，对团队协作造成困扰。

**Independent Test**: 在任意项目中运行 `reverse-spec generate src/some-module`，检查生成的 spec 文件中标题和 frontmatter 的 `sourceTarget` 字段是否为相对路径（如 `src/some-module`），而非绝对路径。

**Acceptance Scenarios**:

1. **Given** 用户在项目根目录运行 spec 生成命令指定相对路径 `src/acp`，**When** spec 生成完成，**Then** frontmatter 的 `sourceTarget` 字段为 `src/acp`（相对路径），标题为 `# src/acp`
2. **Given** 用户使用绝对路径 `/Users/user/project/src/acp` 作为目标运行 spec 生成，**When** spec 生成完成，**Then** 系统自动将路径转换为相对于项目根目录的相对路径 `src/acp`
3. **Given** 用户在 batch 模式下运行，**When** 多个模块的 spec 全部生成完成，**Then** 每个 spec 文件的标题和 sourceTarget 均使用相对路径

---

### Edge Cases

- 当目标路径就是项目根目录本身时，sourceTarget 应显示为 `.` 或项目名
- 当用户从非项目根目录运行命令（如子目录）时，路径仍应相对于项目根目录
- 当无法确定项目根目录时（如未传入 projectRoot 参数），应尽可能使用最短的有意义路径

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 在 frontmatter 的 `sourceTarget` 字段中使用相对于项目根目录的路径，而非绝对路径
- **FR-002**: 系统 MUST 在 spec 文件标题（`#` 标题行）中使用相对于项目根目录的路径，而非绝对路径
- **FR-003**: 系统 MUST 在 batch 模式和单文件 generate 模式下均输出相对路径
- **FR-004**: 系统 MUST 保持 frontmatter 中 `relatedFiles` 字段使用相对路径（当前已为相对路径，确保不退化）
- **FR-005**: 系统 MUST 在 Mermaid 依赖关系图的节点标签中使用相对路径，而非绝对路径
- **FR-006**: 系统 MUST 在 baseline skeleton（HTML 注释块）中使用相对路径的 `filePath`，而非绝对路径
- **FR-007**: 系统 MUST 将默认输出目录从 `specs` 改为 `.specs`（点前缀隐藏目录）
- **FR-008**: 系统 MUST 将断点恢复检查点文件的默认路径从 `specs/.reverse-spec-checkpoint.json` 改为 `.specs/.reverse-spec-checkpoint.json`，与输出目录保持一致

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 生成的所有 spec 文件中，`sourceTarget` 字段和标题不包含以 `/` 开头的绝对路径
- **SC-002**: 在团队共享的 spec 文件中，路径信息不暴露个人机器的目录结构
- **SC-003**: 相对路径正确反映文件在项目中的实际位置（如 `src/acp` 而非 `acp` 或完整绝对路径）

## Assumptions

- 项目根目录通过 `projectRoot` 参数或 `process.cwd()` 确定
- `relatedFiles` 字段当前已使用相对路径，无需修改
- 单文件和 batch 模式共用相同的 frontmatter 生成逻辑

## Scope Boundaries

### In Scope

- 修复 frontmatter `sourceTarget` 的绝对路径问题
- 修复 spec 标题（`#` 标题行）的绝对路径问题
- 修复 Mermaid 依赖图中模块节点的绝对路径问题
- 修复 baseline skeleton HTML 注释中的绝对路径问题
- 将默认输出目录从 `specs` 改为 `.specs`
- 将断点恢复检查点默认路径从 `specs/` 改为 `.specs/`
- batch 和 generate 两种模式的路径处理

### Out of Scope

- 修改 `relatedFiles` 字段的路径格式（已为相对路径）
- 修改 spec 内容中引用的路径（由 LLM 生成）
- 修改 drift-log 或其他非 spec 输出的路径格式
