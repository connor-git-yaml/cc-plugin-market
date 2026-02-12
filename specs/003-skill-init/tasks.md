# Tasks: 项目级 Skill 初始化与自包含 Skill 架构

**Input**: Design documents from `/specs/003-skill-init/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

**Tests**: 包含测试任务（SC-005 要求 ≥90% 覆盖率）

**Organization**: 按用户故事分组，支持独立实现和测试。US1+US2（均为 P1 且紧密耦合）合并为一个阶段。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属用户故事（US1, US2, US3, US4, US5）
- 包含精确文件路径

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root

---

## Phase 1: Setup

**Purpose**: 创建新模块目录结构

- [x] T001 创建 `src/installer/` 目录结构，为新模块做好准备

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 构建核心安装/卸载模块和 SKILL.md 模板——所有用户故事的共享基础

**CRITICAL**: 所有用户故事均依赖此阶段完成

- [x] T002 [P] 定义数据模型接口（SkillDefinition, InstallOptions, RemoveOptions, InstallResult, InstallSummary）在 src/installer/skill-installer.ts 中，按照 data-model.md 和 contracts/installer-api.md 的规范
- [x] T003 [P] 创建 3 个 SKILL.md 模板内容常量（reverse-spec, reverse-spec-batch, reverse-spec-diff）在 src/installer/skill-templates.ts 中，每个模板包含 frontmatter + 指令 + 内联三级降级 bash 逻辑（command -v → npx → 安装提示），参考现有 src/skills-global/ 中的 SKILL.md 内容并改造为降级版本
- [x] T004 实现 installSkills() 和 removeSkills() 函数在 src/installer/skill-installer.ts 中，按照 contracts/installer-api.md 的行为规范：遍历 SKILL_DEFINITIONS、递归创建目录、区分 installed/updated 状态、单个失败不中断其他、返回 InstallSummary
- [x] T005 实现 resolveTargetDir() 和 formatSummary() 函数在 src/installer/skill-installer.ts 中，resolveTargetDir 按 mode 返回项目级或全局级路径，formatSummary 输出中文安装摘要（按 contracts/cli-interface.md 的输出格式）
- [x] T006 编写 skill-installer 单元测试在 tests/unit/skill-installer.test.ts 中，覆盖：项目级安装 3 个 skill、全局级安装、目录自动创建、文件已存在时 updated 状态、单个 skill 失败不中断、removeSkills 删除目录、remove 时目录不存在返回 skipped、resolveTargetDir 返回正确路径、formatSummary 输出格式验证

**Checkpoint**: 核心安装模块就绪，可以开始 CLI 集成

---

## Phase 3: User Story 1+2 - 项目级 Skill 安装 + 自包含架构 (Priority: P1) MVP

**Goal**: 用户运行 `reverse-spec init` 即可将 3 个包含内联降级逻辑的 skill 安装到当前项目的 `.claude/skills/` 中

**Independent Test**: 在任意项目中运行 `reverse-spec init`，验证 `.claude/skills/` 下出现 3 个 skill 目录，每个包含自带内联降级逻辑的 SKILL.md

### Implementation for User Story 1+2

- [x] T007 [P] [US1] 扩展 CLICommand 接口新增 `init` 子命令和 `global`/`remove` 字段，更新 parseArgs() 解析逻辑支持 `init [--global|-g] [--remove]` 在 src/cli/utils/parse-args.ts 中，按照 contracts/cli-interface.md 的 Parsing Rules
- [x] T008 [US1] 创建 init 命令处理函数 runInit() 在 src/cli/commands/init.ts 中，调用 resolveTargetDir() + installSkills()/removeSkills() + formatSummary()，输出结果并设置退出码（0=成功, 1=全部失败）
- [x] T009 [US1] 更新 CLI 入口在 src/cli/index.ts 中：新增 `case 'init': runInit()` 分发、更新 HELP_TEXT 加入 init 子命令和 --global/--remove 选项描述，按照 contracts/cli-interface.md 的帮助文本格式
- [x] T010 [P] [US1] 编写 init 命令单元测试在 tests/unit/init-command.test.ts 中，覆盖：parse-args 解析 `init`、`init --global`、`init -g`、`init --remove`、`init --remove --global`、非 init 命令使用 --global 报错、init 带位置参数报错

**Checkpoint**: `reverse-spec init` 可工作，项目级安装 3 个 skill 到 `.claude/skills/`

---

## Phase 4: User Story 3 - 全局模式安装 (Priority: P2)

**Goal**: 用户运行 `reverse-spec init --global` 将 skill 安装到 `~/.claude/skills/`

**Independent Test**: 运行 `reverse-spec init --global`，验证 `~/.claude/skills/` 下出现 3 个 skill 目录

### Implementation for User Story 3

- [x] T011 [US3] 在 src/cli/commands/init.ts 的全局安装完成输出中添加优先级警告提示（"注意: 全局 skill 优先级高于项目级 skill"），按照 contracts/cli-interface.md 全局模式提示格式
- [x] T012 [US3] 在 tests/unit/init-command.test.ts 中追加全局模式测试用例：--global 正确传递 mode='global'、输出包含优先级警告、已有其他 skill 时不影响

**Checkpoint**: `reverse-spec init --global` 可工作

---

## Phase 5: User Story 4 - 移除已安装的 Skill (Priority: P2)

**Goal**: 用户运行 `reverse-spec init --remove` 清理已安装的 skill

**Independent Test**: 安装 skill 后运行 `reverse-spec init --remove`，验证 `.claude/skills/` 下的 reverse-spec 目录被清理

### Implementation for User Story 4

- [x] T013 [US4] 完善 src/cli/commands/init.ts 中的 --remove 处理：当所有 result 为 skipped 时输出「未检测到已安装的 reverse-spec skills，无需清理」，支持 --remove --global 组合
- [x] T014 [US4] 在 tests/unit/init-command.test.ts 中追加移除模式测试用例：--remove 项目级移除、--remove --global 全局移除、无已安装 skill 时输出「无需清理」且退出码为 0

**Checkpoint**: `reverse-spec init --remove [--global]` 可工作

---

## Phase 6: User Story 5 - postinstall/preuninstall 重构 (Priority: P3)

**Goal**: 消除 postinstall/preuninstall 与 init 命令之间的代码重复

**Independent Test**: 执行 `npm install -g .` 和 `npm uninstall -g reverse-spec`，验证行为与重构前一致

### Implementation for User Story 5

- [x] T015 [P] [US5] 重构 src/scripts/postinstall.ts：移除内联的文件复制逻辑，改为 import { installSkills, resolveTargetDir } from '../installer/skill-installer.js' 并调用 installSkills({ targetDir: resolveTargetDir('global'), mode: 'global' })，保留全局安装检测（npm_config_global）和错误处理
- [x] T016 [P] [US5] 重构 src/scripts/preuninstall.ts：移除内联的目录删除逻辑，改为 import { removeSkills, resolveTargetDir } from '../installer/skill-installer.js' 并调用 removeSkills({ targetDir: resolveTargetDir('global'), mode: 'global' })，保留全局卸载检测
- [x] T017 [US5] 更新 tests/unit/skill-registrar.test.ts：调整测试以验证通过新 installer 模块的注册/注销行为，确保现有 7 个测试用例的断言逻辑不变（安装 3 个 skill、跳过本地安装、自动创建目录、源文件不存在跳过、卸载清理、隔离保护、异常处理）

**Checkpoint**: `npm install -g` / `npm uninstall -g` 行为与重构前 100% 一致

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 端到端集成测试和全量回归验证

- [x] T018 [P] 编写 init 端到端集成测试在 tests/integration/init-e2e.test.ts 中，使用 execFileSync 调用编译后的 CLI 验证：`init` 默认安装到临时目录、`init --global` 安装到临时全局目录、`init --remove` 清理已安装 skill、`init --remove` 无 skill 时退出码 0、`--version` 和 `--help` 包含 init 信息
- [x] T019 编译 TypeScript（npm run build）并验证 dist/ 输出无错误
- [x] T020 运行全量测试套件（npm test），验证 ≥175 个现有测试全部通过 + 新增测试通过，无回归

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: 无依赖，立即开始
- **Foundational (Phase 2)**: 依赖 Phase 1 完成，**阻塞所有用户故事**
- **US1+US2 (Phase 3)**: 依赖 Phase 2 完成
- **US3 (Phase 4)**: 依赖 Phase 3 完成（需要 init 命令基础架构）
- **US4 (Phase 5)**: 依赖 Phase 3 完成（需要 init 命令基础架构）
- **US5 (Phase 6)**: 依赖 Phase 2 完成（仅需 installer 模块），可与 Phase 3-5 并行
- **Polish (Phase 7)**: 依赖所有用户故事完成

### User Story Dependencies

- **US1+US2 (P1)**: Phase 2 完成后即可开始，无其他故事依赖
- **US3 (P2)**: 依赖 US1 的 CLI 架构（init 命令已存在），但核心安装逻辑已在 Phase 2 中实现
- **US4 (P2)**: 依赖 US1 的 CLI 架构，核心移除逻辑已在 Phase 2 中实现
- **US5 (P3)**: 仅依赖 Phase 2 的 installer 模块，**可与 US1-US4 并行开发**

### Within Each User Story

- 接口/类型定义 → 核心实现 → CLI 集成 → 测试
- [P] 标记的任务可并行执行

### Parallel Opportunities

- T002 和 T003 可并行（不同文件，无依赖）
- T007 和 T010 可并行（parse-args 修改 vs 测试文件创建）
- T015 和 T016 可并行（postinstall vs preuninstall 重构）
- US5 (Phase 6) 整体可与 Phase 3-5 并行

---

## Parallel Example: Phase 2 Foundational

```text
# 同时启动两个独立模块的创建:
Task T002: "定义数据模型接口在 src/installer/skill-installer.ts"
Task T003: "创建 SKILL.md 模板内容在 src/installer/skill-templates.ts"

# 完成后，顺序实现核心逻辑:
Task T004: "实现 installSkills() 和 removeSkills()"
Task T005: "实现 resolveTargetDir() 和 formatSummary()"
Task T006: "编写 skill-installer 单元测试"
```

## Parallel Example: Phase 3 US1+US2

```text
# 同时启动 parse-args 扩展和测试文件:
Task T007: "扩展 parse-args.ts 支持 init 子命令"
Task T010: "编写 init 命令单元测试"

# 顺序完成命令实现和 CLI 集成:
Task T008: "创建 init 命令处理函数"
Task T009: "更新 CLI 入口分发"
```

---

## Implementation Strategy

### MVP First (US1+US2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: US1+US2
4. **STOP and VALIDATE**: 运行 `reverse-spec init` 验证 3 个 skill 安装成功
5. 此时已交付核心价值——项目级 skill 安装

### Incremental Delivery

1. Setup + Foundational → 核心模块就绪
2. US1+US2 → `reverse-spec init` 可用 → MVP!
3. US3 → `init --global` 可用
4. US4 → `init --remove` 可用
5. US5 → 内部代码质量提升（无用户可见变化）
6. Polish → 全量验证通过

### FR Coverage Map

| FR | 覆盖任务 |
| --- | --- |
| FR-001 | T004, T008 |
| FR-002 | T003 |
| FR-003 | T003 |
| FR-004 | T003 |
| FR-005 | T004, T011 |
| FR-006 | T005, T013 |
| FR-007 | T013 |
| FR-008 | T004 |
| FR-009 | T004 |
| FR-010 | T005, T008 |
| FR-011 | T015 |
| FR-012 | T016 |
| FR-013 | 无变更（skills/ 目录不受影响） |
| FR-014 | T005 |
| FR-015 | T008 |

---

## Notes

- [P] 任务 = 不同文件，无相互依赖
- [Story] 标签映射到 spec.md 中的用户故事
- US1+US2 合并因二者均为 P1 且紧密耦合（自包含架构是项目级安装的前提）
- 每个 Checkpoint 后可独立验证该故事的功能
- 编译和全量测试在最后 Phase 统一执行
- 现有 `src/skills-global/` 目录保留不变，新模板存储在 `skill-templates.ts` 中
