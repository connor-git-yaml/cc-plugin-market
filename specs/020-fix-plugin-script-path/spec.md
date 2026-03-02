# Feature Specification: 插件脚本路径发现机制修复

**Feature Branch**: `020-fix-plugin-script-path`
**Created**: 2026-03-02
**Status**: Draft
**Input**: fix: Spec Driver 插件脚本路径发现机制缺陷修复

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 全局安装用户在新项目中使用插件 (Priority: P1)

作为一个通过 Plugin Marketplace 全局安装（user 级）了 Spec Driver 的开发者，我在一个新项目（如 AgentsStudy）中执行 `/spec-driver:speckit-feature` 时，希望插件功能可以正常工作，而不是因为脚本路径找不到而失败。

**Why this priority**: 这是该缺陷的核心场景——全局安装是 Plugin Marketplace 的主要分发方式，脚本路径失败直接导致插件在新项目中完全不可用。

**Independent Test**: 在一个没有 `plugins/spec-driver/` 子目录的全新项目中，执行任何调用脚本的 Skill 命令，验证脚本能被正确发现和执行。

**Acceptance Scenarios**:

1. **Given** 用户已全局安装 Spec Driver 插件且当前项目无 `plugins/spec-driver/` 目录，**When** 用户在该项目中执行 `/spec-driver:speckit-feature "需求描述"`，**Then** `init-project.sh` 被正确发现和执行，返回项目环境检查 JSON 结果
2. **Given** 用户已全局安装 Spec Driver 插件且当前项目无 `plugins/spec-driver/` 目录，**When** 用户在该项目中执行 `/spec-driver:speckit-doc`，**Then** `scan-project.sh` 被正确发现和执行，返回项目元数据 JSON

---

### User Story 2 - 源码开发场景向后兼容 (Priority: P2)

作为 reverse-spec 项目的开发者（插件源码就在本项目中），我在项目中使用 Spec Driver Skill 时，希望一切仍然正常工作——无论是通过插件缓存路径还是本地相对路径。

**Why this priority**: 保持源码开发环境不受影响是防止回归的关键，但优先级低于修复全局安装场景。

**Independent Test**: 在 reverse-spec 项目（包含 `plugins/spec-driver/` 源码目录）中执行 Skill 命令，验证脚本仍然能正确执行。

**Acceptance Scenarios**:

1. **Given** 当前项目是 reverse-spec（包含 `plugins/spec-driver/` 源码目录），**When** 用户执行任何调用脚本的 Skill 命令，**Then** 脚本通过源码相对路径或缓存路径被正确执行
2. **Given** 用户同时拥有全局安装和本地源码，**When** 在 reverse-spec 项目中执行 Skill，**Then** 不产生路径冲突或重复执行

---

### User Story 3 - Session 启动时自动建立路径发现 (Priority: P2)

作为安装了 Spec Driver 的用户，我每次打开新的 Claude Code 会话时，希望插件能自动完成项目初始化并建立脚本路径发现机制，无需手动配置。

**Why this priority**: 自动化路径发现是解决方案的基础设施，与 P1 场景直接关联。

**Independent Test**: 在新项目中启动一个 Claude Code 会话，验证 SessionStart Hook 自动建立路径发现，后续 Skill 命令可立即使用脚本。

**Acceptance Scenarios**:

1. **Given** 用户在一个新项目中打开 Claude Code 会话，**When** SessionStart 事件触发，**Then** 插件的脚本路径信息被写入该项目的 `.specify/` 目录
2. **Given** 用户在一个已经建立过路径发现的项目中再次打开会话，**When** SessionStart 事件触发，**Then** 路径信息被幂等更新（不产生重复或错误）

---

### Edge Cases

- 当插件缓存目录被手动删除或损坏时，路径发现应给出明确错误提示而非静默失败
- 当插件版本升级后缓存路径变更时（如 `3.1.0` → `3.2.0`），路径信息应在下次 SessionStart 时自动更新
- 当 `.specify/` 目录不存在时（全新项目首次使用），路径发现机制应自动创建必要的目录结构
- 当用户在多个项目间频繁切换时，每个项目的路径信息应独立维护互不干扰

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 在 SessionStart 事件触发时，将插件的脚本目录绝对路径写入当前项目的 `.specify/.spec-driver-path` 文件
- **FR-002**: 系统 MUST 在所有引用脚本的 SKILL.md 中，使用从 `.specify/.spec-driver-path` 读取的绝对路径来调用脚本，作为主路径发现方式。具体调用模式为: 先 `PLUGIN_DIR=$(cat .specify/.spec-driver-path)`，然后 `bash "$PLUGIN_DIR/scripts/{script_name}" --json`；若 `.specify/.spec-driver-path` 不存在或为空则 fallback 到 FR-003 的相对路径 [AUTO-CLARIFIED: cat 读取 + 变量替换 -- 与纯文本路径文件格式匹配，复杂度最低]
- **FR-003**: 系统 MUST 保留对 `plugins/spec-driver/scripts/` 相对路径的 fallback 支持，以兼容源码开发场景
- **FR-004**: 路径写入操作 MUST 是幂等的——重复执行不产生错误或重复内容
- **FR-005**: 当插件缓存目录不存在或脚本文件缺失时，系统 MUST 给出明确的错误信息
- **FR-006**: SessionStart Hook MUST 在写入路径信息的同时执行项目初始化（确保 `.specify/` 目录结构存在）

### 受影响资产清单

- **SKILL.md（5 个文件引用脚本）**:
  - `speckit-feature/SKILL.md` → 引用 `init-project.sh`
  - `speckit-story/SKILL.md` → 引用 `init-project.sh`
  - `speckit-fix/SKILL.md` → 引用 `init-project.sh`
  - `speckit-resume/SKILL.md` → 引用 `init-project.sh`
  - `speckit-doc/SKILL.md` → 引用 `scan-project.sh`

- **Hook/脚本（2 个文件需修改）**:
  - `hooks/hooks.json` → 需新增或扩展 SessionStart 命令
  - `scripts/postinstall.sh` → 需扩展路径写入逻辑

- **脚本（1 个文件需修改，路径发现逻辑对齐）**:
  - `scripts/codex-skills.sh` → 第 9 行 `REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"` 硬编码了从脚本位置到仓库根的相对路径层级，在全局安装场景下（插件缓存目录结构不同于源码目录）此推算将失败。需对齐使用 `.specify/.spec-driver-path` 或 `$SCRIPT_DIR` 的 `PLUGIN_DIR` 推算逻辑 [AUTO-CLARIFIED: 纳入修复范围 -- 相同的路径发现缺陷，应一并修复]

- **文档（1 个文件需更新）**:
  - `README.md` → 引用 `codex-skills.sh` 的相对路径

### Key Entities

- **插件路径文件（`.specify/.spec-driver-path`）**: 存储插件缓存目录的绝对路径，由 SessionStart Hook 自动写入，被 SKILL.md 中的脚本引用逻辑读取。**文件格式**: 纯文本单行，内容为插件根目录的绝对路径（如 `/Users/xxx/.claude/plugins/cache/cc-plugin-market/spec-driver/3.1.0`），不含尾部换行符和额外元数据。版本信息可从路径本身解析，无需结构化格式 [AUTO-CLARIFIED: 纯文本单行 -- 最简方案，SKILL.md 中 `cat` 读取零成本，无需引入 JSON 解析]
- **插件缓存目录**: Plugin Marketplace 安装插件后的存储位置（如 `~/.claude/plugins/cache/cc-plugin-market/spec-driver/3.1.0/`），包含完整的脚本、模板和 Agent 文件

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 全局安装用户在任意新项目中执行 Spec Driver Skill 命令，脚本发现成功率从 0%（当前）提升至 100%
- **SC-002**: 在 reverse-spec 源码项目中执行 Skill 命令的行为与修复前完全一致（零回归）
- **SC-003**: 从打开新会话到 Skill 可用的等待时间不超过 2 秒（SessionStart Hook 执行完成时间）
- **SC-004**: 插件版本升级后，用户无需手动干预即可在下次会话中自动获取新版路径

## Assumptions

- Claude Code 的 Plugin Hook 在 SessionStart 事件中的工作目录（`cwd`）为**插件安装目录**（插件缓存路径），而非用户项目目录。这意味着 `hooks.json` 中的 `./scripts/postinstall.sh` 会以插件缓存路径为基准解析。Hook 脚本内部通过 `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` 获取自身位置，进而推算 `PLUGIN_DIR`
- `.specify/` 目录是 Spec Driver 在项目中的标准工作目录，所有项目级状态文件均存放于此
- SessionStart Hook 需要知道用户项目路径才能写入 `.specify/.spec-driver-path`。假设 Claude Code 在 SessionStart 事件中通过环境变量（如 `$CLAUDE_PROJECT_DIR`）或等价机制将用户项目根目录传递给 Hook 脚本。若此环境变量不可用，脚本应输出警告并跳过路径写入（不阻断 SessionStart）[AUTO-CLARIFIED: 基于已有 Assumption 细化 -- 当前 init-project.sh 已使用 `$(pwd)` 获取项目路径，SessionStart Hook 需要同样的项目路径传递机制]
- 插件缓存路径的格式遵循 `~/.claude/plugins/cache/{marketplace}/{plugin-name}/{version}/` 模式
- `.specify/.spec-driver-path` 的写入**不需要文件锁或原子写入保证**——SessionStart 是每个会话的串行事件，不存在并发写入场景，且写入操作本身是幂等的 [AUTO-CLARIFIED: 无需文件锁 -- SessionStart 串行执行，幂等写入天然安全]

## Clarifications

### Session 2026-03-02

| # | 问题 | 自动选择 | 理由 |
| --- | ------ | --------- | ------ |
| 1 | `.specify/.spec-driver-path` 文件格式应为纯文本单行还是 JSON 结构化格式？ | 纯文本单行绝对路径 | 最简方案，SKILL.md 中 `cat` 命令零成本读取，无需引入 JSON 解析依赖。版本信息可从路径本身（末尾的 `{version}/` 段）解析，不需要额外元数据字段 |
| 2 | SessionStart Hook 如何获取用户项目根目录以写入 `.specify/.spec-driver-path`？ | 依赖 Claude Code 提供的环境变量或 `$PWD` 传递 | 当前 `init-project.sh` 已使用 `$(pwd)` 获取项目路径，说明 SKILL.md 调用时 cwd 为项目根。SessionStart Hook 需要等价的机制（环境变量如 `$CLAUDE_PROJECT_DIR`）。若不可用则输出警告并跳过，不阻断启动 |
| 3 | SKILL.md 中脚本调用的改写语法具体是什么？ | `PLUGIN_DIR=$(cat .specify/.spec-driver-path)` + `bash "$PLUGIN_DIR/scripts/{script}" --json`，不存在时 fallback 到相对路径 | 与纯文本路径文件格式匹配，复杂度最低。fallback 机制确保源码开发场景不受影响 |
| 4 | `scripts/codex-skills.sh` 的 `REPO_ROOT` 硬编码路径是否纳入修复范围？ | 纳入修复范围 | 该脚本的 `REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"` 存在与 SKILL.md 中完全相同的路径发现缺陷，全局安装场景下目录层级不匹配将导致推算失败。应改为 `PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"`（从脚本位置推算插件根目录） |
| 5 | `.specify/.spec-driver-path` 写入是否需要文件锁或原子写入？ | 不需要 | SessionStart 是每个会话的串行事件，不存在并发写入。写入操作本身是幂等的（每次覆盖写入相同路径），天然安全 |
