# Tasks: 插件脚本路径发现机制修复

**Input**: 设计文档来自 `specs/020-fix-plugin-script-path/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/

**Tests**: 本特性为 Bash 脚本 + Markdown prompt 的 Plugin 修复，spec 中未要求自动化测试，仅要求手动场景验证。测试任务不包含在内。

**Organization**: 任务按 User Story 组织，支持增量交付。由于本特性是 Bug Fix 且变更范围集中，Phase 2 (Foundational) 直接覆盖 US3 的 SessionStart 基础设施，Phase 3 覆盖 US1 的核心脚本路径修复，Phase 4 覆盖 US2 的向后兼容。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1, US2, US3）
- 每个任务包含确切的文件路径

---

## Phase 1: Setup

**Purpose**: 确认当前文件状态，无需创建新项目结构（本特性为 9 个文件的修改，0 个新建文件）

- [ ] T001 确认受影响文件的当前内容和路径:
  - `plugins/spec-driver/scripts/postinstall.sh`
  - `plugins/spec-driver/hooks/hooks.json`
  - `plugins/spec-driver/scripts/codex-skills.sh`
  - `plugins/spec-driver/skills/speckit-feature/SKILL.md`
  - `plugins/spec-driver/skills/speckit-story/SKILL.md`
  - `plugins/spec-driver/skills/speckit-fix/SKILL.md`
  - `plugins/spec-driver/skills/speckit-resume/SKILL.md`
  - `plugins/spec-driver/skills/speckit-doc/SKILL.md`
  - `README.md`

---

## Phase 2: Foundational -- SessionStart 路径写入基础设施

**Purpose**: 建立 SessionStart Hook 的路径写入机制，这是所有 User Story 的前置依赖

**CRITICAL**: US1（全局安装脚本发现）和 US3（Session 自动路径发现）都依赖此阶段完成

- [ ] T002 扩展 `plugins/spec-driver/scripts/postinstall.sh`，在 `main()` 函数开头插入 PLUGIN_DIR 推算逻辑（优先 `$CLAUDE_PLUGIN_ROOT`，fallback 到 `dirname "$SCRIPT_DIR"`）和 PROJECT_DIR 确定逻辑（优先 `$CLAUDE_PROJECT_DIR`，fallback 到 `$(pwd)`），然后验证 PLUGIN_DIR 有效性（检查 `scripts/` 目录存在），确保 `.specify/` 目录存在（`mkdir -p`），幂等写入 `echo -n "$PLUGIN_DIR" > "$PROJECT_DIR/.specify/.spec-driver-path"`。错误情况通过 stderr 警告但不阻断（退出码始终为 0）。参考契约: `specs/020-fix-plugin-script-path/contracts/postinstall-contract.md`

- [ ] T003 升级 `plugins/spec-driver/hooks/hooks.json` 从 v1 旧格式（hooks 数组 + event 字段）到 v2 新格式（hooks 对象 + 事件名作为 key），同时将命令路径从 `./scripts/postinstall.sh` 改为 `${CLAUDE_PLUGIN_ROOT}/scripts/postinstall.sh`，`type` 从 `"shell"` 改为 `"command"`。参考契约: `specs/020-fix-plugin-script-path/contracts/hooks-json-contract.md`

**Checkpoint**: SessionStart Hook 路径写入机制就绪，可在任意项目中自动生成 `.specify/.spec-driver-path`

---

## Phase 3: User Story 1 -- 全局安装用户在新项目中使用插件 (Priority: P1) -- MVP

**Goal**: 全局安装用户在任意新项目中执行 Spec Driver Skill 命令时，脚本能被正确发现和执行（成功率从 0% 提升至 100%）

**Independent Test**: 在一个没有 `plugins/spec-driver/` 子目录的全新项目中，确保 `.specify/.spec-driver-path` 已由 SessionStart 写入后，执行任何调用脚本的 Skill 命令，验证脚本能被正确发现和执行

### Implementation for User Story 1

- [ ] T004 [P] [US1] 修改 `plugins/spec-driver/skills/speckit-feature/SKILL.md`，在脚本调用前插入路径发现逻辑块（`if [ -f .specify/.spec-driver-path ]; then PLUGIN_DIR=$(cat .specify/.spec-driver-path); else PLUGIN_DIR="plugins/spec-driver"; fi`），将 `bash plugins/spec-driver/scripts/init-project.sh --json` 替换为 `bash "$PLUGIN_DIR/scripts/init-project.sh" --json`，同时将所有 `plugins/spec-driver/agents/`、`plugins/spec-driver/templates/` 引用替换为 `$PLUGIN_DIR/agents/`、`$PLUGIN_DIR/templates/`。参考契约: `specs/020-fix-plugin-script-path/contracts/skill-script-invocation.md`

- [ ] T005 [P] [US1] 修改 `plugins/spec-driver/skills/speckit-story/SKILL.md`，插入同样的路径发现逻辑块，将 `init-project.sh` 调用和所有 `plugins/spec-driver/` 路径引用替换为 `$PLUGIN_DIR/` 前缀

- [ ] T006 [P] [US1] 修改 `plugins/spec-driver/skills/speckit-fix/SKILL.md`，插入同样的路径发现逻辑块，将 `init-project.sh` 调用和所有 `plugins/spec-driver/` 路径引用替换为 `$PLUGIN_DIR/` 前缀

- [ ] T007 [P] [US1] 修改 `plugins/spec-driver/skills/speckit-resume/SKILL.md`，插入同样的路径发现逻辑块，将 `init-project.sh` 调用和所有 `plugins/spec-driver/` 路径引用替换为 `$PLUGIN_DIR/` 前缀

- [ ] T008 [P] [US1] 修改 `plugins/spec-driver/skills/speckit-doc/SKILL.md`，插入同样的路径发现逻辑块，但此文件引用的脚本是 `scan-project.sh` 而非 `init-project.sh`。将 `bash plugins/spec-driver/scripts/scan-project.sh --json` 替换为 `bash "$PLUGIN_DIR/scripts/scan-project.sh" --json`，同时替换所有 `plugins/spec-driver/` 路径引用

- [ ] T009 [US1] 修复 `plugins/spec-driver/scripts/codex-skills.sh`，将第 9 行 `REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"` 改为 `PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"`，并将后续所有 `$REPO_ROOT/plugins/spec-driver/` 引用替换为 `$PLUGIN_DIR/`（包括 `install_all()` 函数中的 `source_feature`、`source_story` 等路径变量和 `ensure_source_exists()` 校验路径）

**Checkpoint**: 全局安装用户在新项目中执行 `speckit-feature`、`speckit-story`、`speckit-fix`、`speckit-resume`、`speckit-doc` 均可正确发现并执行脚本

---

## Phase 4: User Story 2 -- 源码开发场景向后兼容 (Priority: P2)

**Goal**: 在 reverse-spec 项目（包含 `plugins/spec-driver/` 源码目录）中执行 Skill 命令的行为与修复前完全一致（零回归）

**Independent Test**: 在 reverse-spec 项目中执行任意 Skill 命令，验证脚本通过源码相对路径或缓存路径被正确执行，不产生路径冲突或重复执行

### Implementation for User Story 2

- [ ] T010 [US2] 验证 Phase 3 中 5 个 SKILL.md 的 fallback 逻辑覆盖源码开发场景: 当 `.specify/.spec-driver-path` 不存在时，`PLUGIN_DIR` 回退到 `"plugins/spec-driver"` 相对路径。逐一检查 T004-T008 的修改结果，确认 fallback 分支语法正确且路径拼接有效

- [ ] T011 [US2] 验证 `plugins/spec-driver/scripts/codex-skills.sh` 中 T009 的修改在源码开发场景下正确工作: `PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"` 在源码目录结构 `plugins/spec-driver/scripts/` 中应解析为 `plugins/spec-driver/`（绝对路径），后续路径拼接（如 `$PLUGIN_DIR/skills/speckit-feature/SKILL.md`）指向正确文件

**Checkpoint**: 源码开发场景下所有 Skill 命令行为与修复前一致

---

## Phase 5: User Story 3 -- Session 启动时自动建立路径发现 (Priority: P2)

**Goal**: 每次打开新的 Claude Code 会话时，SessionStart Hook 自动建立 `.specify/.spec-driver-path` 路径发现文件

**Independent Test**: 在新项目中启动 Claude Code 会话，验证 `.specify/.spec-driver-path` 被自动创建且内容正确；在已有路径文件的项目中重新启动会话，验证幂等更新无错误

### Implementation for User Story 3

> **Note**: US3 的核心实现已在 Phase 2 (T002 + T003) 完成。本阶段关注端到端验证和边界条件处理。

- [ ] T012 [US3] 验证 T002 的幂等性: 模拟重复执行 `postinstall.sh`，确认 `.specify/.spec-driver-path` 被覆盖写入（内容不变或正确更新），不产生错误或重复内容

- [ ] T013 [US3] 验证 T002 的错误处理: 确认当 `PLUGIN_DIR/scripts/` 不存在时输出 stderr 警告且退出码为 0；当 `PROJECT_DIR/.specify/` 目录创建失败时（如权限不足）输出 stderr 警告且不阻断

- [ ] T014 [US3] 验证版本升级场景: 当插件从 `3.1.0` 升级到 `3.2.0` 后，下次 SessionStart 执行时 `.specify/.spec-driver-path` 内容自动更新为新版本路径（因为 `postinstall.sh` 每次覆盖写入 PLUGIN_DIR）

**Checkpoint**: SessionStart 自动路径发现机制在正常、幂等、错误、升级场景下均正确工作

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 文档更新和整体一致性验证

- [ ] T015 [P] 更新 `README.md` 中 `codex-skills.sh` 的调用示例，从固定相对路径更新为说明全局安装场景的使用方式

- [ ] T016 [P] 一致性检查: 确认所有 5 个 SKILL.md 中的路径发现逻辑块格式完全一致（仅脚本名不同: 4 个用 `init-project.sh`，1 个用 `scan-project.sh`）

- [ ] T017 确认 `plugins/spec-driver/skills/speckit-sync/SKILL.md` 无需修改（不引用任何脚本），作为排除性验证

- [ ] T018 运行 `specs/020-fix-plugin-script-path/quickstart.md` 中的验证步骤，在全局安装和源码开发两种场景下执行端到端验证

---

## FR 覆盖映射表

| 功能需求 | 描述 | 覆盖任务 |
|---------|------|---------|
| FR-001 | SessionStart 写入路径文件到 `.specify/.spec-driver-path` | T002, T003 |
| FR-002 | SKILL.md 使用路径指针调用脚本（`cat` 读取 + 变量替换） | T004, T005, T006, T007, T008 |
| FR-003 | 保留 `plugins/spec-driver/` 相对路径 fallback | T004, T005, T006, T007, T008, T010 |
| FR-004 | 路径写入操作幂等 | T002, T012 |
| FR-005 | 插件目录不存在时给出明确错误信息 | T002, T013 |
| FR-006 | SessionStart 同时执行项目初始化（确保 `.specify/` 目录存在） | T002 |

**FR 覆盖率: 6/6 = 100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 完成；**阻塞** Phase 3-5 的所有 User Story
- **Phase 3 (US1 - P1)**: 依赖 Phase 2 完成
- **Phase 4 (US2 - P2)**: 依赖 Phase 3 完成（需验证 Phase 3 的 fallback 逻辑）
- **Phase 5 (US3 - P2)**: 依赖 Phase 2 完成（可与 Phase 3 并行，但建议在 Phase 3 后执行以确认端到端流程）
- **Phase 6 (Polish)**: 依赖 Phase 3-5 全部完成

### User Story Dependencies

- **US1 (全局安装)**: 依赖 Phase 2 的 SessionStart 基础设施
- **US2 (源码向后兼容)**: 依赖 US1 的 SKILL.md 修改完成后验证 fallback 分支
- **US3 (Session 自动路径发现)**: 核心实现在 Phase 2，验证任务依赖 Phase 2 完成

### 并行机会

**Phase 3 内部**: T004-T008 标记 [P]，可同时修改 5 个不同的 SKILL.md 文件
**Phase 6 内部**: T015-T017 标记 [P]，可并行执行
**跨 Phase**: Phase 4 和 Phase 5 理论上可并行（不同的验证维度），但建议顺序执行以便问题追溯

### Recommended Implementation Strategy

**MVP First (推荐)**:

1. Phase 1 (Setup) -- 确认文件状态
2. Phase 2 (Foundational) -- 建立 SessionStart 路径写入（T002 + T003）
3. Phase 3 (US1) -- 修改 5 个 SKILL.md + codex-skills.sh（T004-T009）
4. **STOP and VALIDATE**: 在全局安装场景中测试 `speckit-feature` 命令
5. Phase 4 (US2) + Phase 5 (US3) -- 向后兼容验证 + 端到端验证
6. Phase 6 (Polish) -- 文档和一致性

MVP 范围为 Phase 1-3，交付 US1（全局安装用户在新项目中使用插件）。

---

## Notes

- 本特性为 Bug Fix，所有变更在现有文件内完成，不新建任何文件
- `.specify/.spec-driver-path` 由脚本运行时动态生成于用户项目中，不在源码仓库中
- 所有 SKILL.md 修改遵循相同模式，仅脚本名和文件内具体路径引用不同
- T009 (codex-skills.sh) 的变更影响范围最大（`REPO_ROOT` 到 `PLUGIN_DIR` 的全局替换），需仔细审查所有引用点
- [P] 任务 = 不同文件，无依赖，可并行
- [USN] 标签映射任务到特定 User Story 以支持追溯
