# Tasks: speckit-doc 命令

**Input**: Design documents from `/specs/015-speckit-doc-command/`
**Prerequisites**: plan.md (required), spec.md (required), data-model.md, contracts/

**Tests**: 无单元测试（Skill-Only 架构不涉及 TypeScript 代码）。验证通过手动集成测试完成。

**Organization**: 任务按 User Story 组织，支持独立实现和测试。本特性为 Skill-Only 架构（纯 Prompt + Bash 脚本 + 静态模板），零新增 TypeScript 代码。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件，无依赖）
- **[Story]**: 所属 User Story（US1-US6）
- 所有路径基于仓库根目录 `/Users/connorlu/Desktop/.workspace2.nosync/reverse-spec/`

---

## Phase 1: Setup (共享基础设施)

**Purpose**: 创建 speckit-doc Skill 的目录结构和基础文件

- [x] T001 创建 speckit-doc Skill 目录 `plugins/spec-driver/skills/speckit-doc/`
- [x] T002 [P] 创建 LICENSE 模板目录 `plugins/spec-driver/templates/licenses/`

**Checkpoint**: 目录结构就绪，后续阶段可以开始填充文件内容

---

## Phase 2: Foundational (阻塞性前置依赖)

**Purpose**: 所有 User Story 共同依赖的基础设施——项目扫描脚本和 LICENSE 静态模板

**CRITICAL**: 此阶段必须完成后才能进入任何 User Story 的实现

### scan-project.sh 脚本（所有 Story 的数据基础）

- [x] T003 实现项目元信息收集脚本 `plugins/spec-driver/scripts/scan-project.sh`——脚本应读取 package.json（name, version, description, license, author, scripts, dependencies, devDependencies, repository, main, bin）、git config（user.name, user.email, remote URL, 默认分支）、项目目录结构（深度 2 的 tree 输出）、检测已有文档文件（README.md, LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md），推断项目类型（cli/library/web-app/unknown），计算缺失字段列表，输出符合 `contracts/scan-project-output.md` 定义的 JSON Schema 的标准 JSON；支持 `--json` 参数控制输出格式；降级场景：无 package.json 时从目录名推断项目名、package.json 解析失败时 stderr 输出警告并降级、完全空目录时退出码 1

### LICENSE 静态模板文件（US2 的法律合规基础）

- [ ] T004 [P] 创建 MIT 协议模板文件 `plugins/spec-driver/templates/licenses/MIT.txt`——内容来源 SPDX 官方标准文本，包含 `[year]` 和 `[fullname]` 占位符，格式符合 `contracts/license-template-format.md` 规范（LF 行尾、末尾空行）
- [ ] T005 [P] 创建 Apache-2.0 协议模板文件 `plugins/spec-driver/templates/licenses/Apache-2.0.txt`——SPDX 标准全文，附录中包含 `Copyright [year] [fullname]` 占位符
- [ ] T006 [P] 创建 GPL-3.0 协议模板文件 `plugins/spec-driver/templates/licenses/GPL-3.0.txt`——SPDX 标准全文，末尾附录包含 `Copyright (C) [year] [fullname]` 占位符
- [ ] T007 [P] 创建 BSD-2-Clause 协议模板文件 `plugins/spec-driver/templates/licenses/BSD-2-Clause.txt`——SPDX 标准全文，开头包含 `Copyright (c) [year] [fullname]` 占位符
- [ ] T008 [P] 创建 BSD-3-Clause 协议模板文件 `plugins/spec-driver/templates/licenses/BSD-3-Clause.txt`——SPDX 标准全文，开头包含 `Copyright (c) [year] [fullname]` 占位符
- [ ] T009 [P] 创建 ISC 协议模板文件 `plugins/spec-driver/templates/licenses/ISC.txt`——SPDX 标准全文，开头包含 `Copyright (c) [year] [fullname]` 占位符
- [ ] T010 [P] 创建 MPL-2.0 协议模板文件 `plugins/spec-driver/templates/licenses/MPL-2.0.txt`——SPDX 标准全文，无年份/姓名占位符
- [ ] T011 [P] 创建 Unlicense 协议模板文件 `plugins/spec-driver/templates/licenses/Unlicense.txt`——SPDX 标准全文，无占位符（公共领域声明）

**Checkpoint**: 基础设施就绪——scan-project.sh 可输出正确 JSON，8 种 LICENSE 模板文件就位。User Story 实现可以开始。

---

## Phase 3: User Story 6 - 项目元信息自动提取 (Priority: P1) -- MVP 基础

**Goal**: 系统能自动从项目的 package.json、git 配置和目录结构中提取关键信息，生成完整的 ProjectMetadata JSON，为所有文档生成提供数据基础。

**Independent Test**: 在一个信息完整的 Node.js 项目上执行 scan-project.sh，验证输出 JSON 中所有字段与源数据一致；在缺少 package.json 的项目上执行，验证降级策略正确（目录名推断、字段标记缺失）。

**Why First**: US6 是所有其他 Story 的数据供应者——README 中的项目名称/安装命令/技术栈、LICENSE 中的作者/年份、CONTRIBUTING 中的开发命令全部依赖 ProjectMetadata 的准确提取。

### Implementation for User Story 6

- [ ] T012 [US6] 在 SKILL.md 中编写 Step 1（元信息收集）逻辑段落 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——定义 Skill 文件的 Frontmatter 元数据（name, description）、角色定义（开源文档生成专家）、触发方式（/spec-driver:speckit-doc）、Step 1 的执行指令：调用 `bash plugins/spec-driver/scripts/scan-project.sh --json` 收集 ProjectMetadata，可选调用 `reverse-spec prepare --deep` 执行 AST 分析（60 秒超时），降级处理逻辑（无 package.json、无 git、AST 超时/失败、package.json 解析失败、完全空项目终止），输出项目概要摘要供后续步骤使用

**Checkpoint**: scan-project.sh 和 SKILL.md Step 1 完成后，系统能自动提取任意 Node.js 项目的完整元信息并向用户展示概要。

---

## Phase 4: User Story 3 - 文档组织模式选择 (Priority: P1)

**Goal**: 用户可在"精简模式"（README.md + LICENSE）和"完整模式"（README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md）之间选择，系统据此确定文件生成范围。

**Independent Test**: 在 SKILL.md 交互流程中验证模式选择 prompt 正确展示两种选项，接受 `1`/`2`/`minimal`/`full`/`精简`/`完整` 等输入格式，无效输入最多重试 2 次后默认使用精简模式。

### Implementation for User Story 3

- [ ] T013 [US3] 在 SKILL.md 中编写 Step 2（文档模式选择）交互段落 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——展示精简模式（README.md + LICENSE，适合个人/实验/内部项目）和完整模式（+ CONTRIBUTING.md + CODE_OF_CONDUCT.md，适合面向社区的正式开源项目）两种选项，解析用户输入（编号/英文名/中文名），无效输入重试 2 次后默认精简模式，将选择结果存入上下文供后续步骤使用

**Checkpoint**: 用户可成功选择文档模式，系统记录选择结果。

---

## Phase 5: User Story 2 - 交互式选择开源协议并生成 LICENSE (Priority: P1)

**Goal**: 系统展示 8 种开源协议列表让用户选择，并从静态模板文件生成 100% SPDX 合规的 LICENSE 文件，自动填充年份和版权持有者。

**Independent Test**: 执行命令并选择任意一种协议，验证生成的 LICENSE 文件内容与模板文件一致（除占位符替换外），且 `[year]` 替换为当前年份、`[fullname]` 替换为从 ProjectMetadata 提取的作者名。

### Implementation for User Story 2

- [ ] T014 [US2] 在 SKILL.md 中编写 Step 3（协议选择）交互段落 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——展示 8 种协议列表（MIT/Apache-2.0/GPL-3.0/BSD-2-Clause/BSD-3-Clause/ISC/MPL-2.0/Unlicense），每项附带一行适用场景说明，若 ProjectMetadata.license 匹配其中之一则添加 `[推荐]` 标记高亮，解析用户输入（编号 1-8 或 SPDX ID），无效输入重试 2 次，格式符合 `contracts/skill-interaction-flow.md` 定义
- [ ] T015 [US2] 在 SKILL.md 中编写 LICENSE 文件生成逻辑（Step 4 中的 LICENSE 部分）`plugins/spec-driver/skills/speckit-doc/SKILL.md`——读取 `plugins/spec-driver/templates/licenses/{licenseType}.txt` 模板文件，执行占位符替换：`[year]` -> 当前年份、`[fullname]` -> 版权持有者（优先 package.json author.name，其次 git config user.name，降级为 `[COPYRIGHT HOLDER]`），MPL-2.0 和 Unlicense 无需替换，写入项目根目录 `LICENSE` 文件

**Checkpoint**: 用户可选择协议并获得 SPDX 合规的 LICENSE 文件。

---

## Phase 6: User Story 1 - 一键生成项目 README (Priority: P1) -- MVP

**Goal**: 系统自动分析项目结构和代码，生成一份结构完整（不少于 8 个标准章节）、内容准确的 README.md，包含 shields.io Badge、HTML 注释标记（二期预留），且根据文档模式选择调整贡献章节内容。

**Independent Test**: 在一个仅有源代码和 package.json 的 Node.js 项目上执行命令，检查生成的 README.md 是否包含至少 8 个标准章节，内容是否准确反映项目真实信息，HTML 注释标记是否正确嵌入。

### Implementation for User Story 1

- [ ] T016 [US1] 在 SKILL.md 中编写 README.md 生成模板和指令（Step 4 中的 README 部分）`plugins/spec-driver/skills/speckit-doc/SKILL.md`——定义 README 章节结构和生成规则：(1) Badges 章节：shields.io 格式 License Badge（基于选择的协议），远程 URL 可用时添加 repo Badge，HTML 注释标记 `<!-- speckit:section:badges -->`；(2) 标题和描述：从 ProjectMetadata.name/description 填充，`<!-- speckit:section:description -->`；(3) Features 章节：优先使用 AST 分析结果列出实际导出模块和核心函数，AST 不可用时基于 package.json description 生成通用描述，`<!-- speckit:section:features -->`；(4) Getting Started/Installation 章节：从 scripts/dependencies 推断安装命令，`<!-- speckit:section:getting-started -->`；(5) Usage 章节：从 main/bin 推断项目类型（库 vs CLI），生成 1-2 个简短代码示例，`<!-- speckit:section:usage -->`；(6) Project Structure 章节：使用 directoryTree，`<!-- speckit:section:project-structure -->`；(7) Tech Stack 章节：从 dependencies/devDependencies 提取，`<!-- speckit:section:tech-stack -->`；(8) Testing 章节：从 scripts 提取测试命令，`<!-- speckit:section:testing -->`；(9) Contributing 章节：精简模式内联简化（Issue/PR 链接），完整模式链接 CONTRIBUTING.md，`<!-- speckit:section:contributing -->`；(10) License 章节：声明 + 链接，`<!-- speckit:section:license -->`；所有内容默认使用英文；缺失信息标记 `[待补充]`

**Checkpoint**: 系统能生成结构完整、内容准确的 README.md，精简模式下的 MVP（README + LICENSE）完全可用。

---

## Phase 7: User Story 4 - 生成 CONTRIBUTING.md 贡献指南 (Priority: P2)

**Goal**: 完整模式下生成包含开发环境搭建（项目实际命令）、代码规范、提交规范（Conventional Commits）和 PR 流程的 CONTRIBUTING.md。

**Independent Test**: 以完整模式执行命令后，检查 CONTRIBUTING.md 是否包含从 package.json scripts 提取的实际命令（如 `npm run dev`、`npm test`），而非通用占位符。

### Implementation for User Story 4

- [ ] T017 [US4] 在 SKILL.md 中编写 CONTRIBUTING.md 生成模板和指令（Step 4 中的 CONTRIBUTING 部分）`plugins/spec-driver/skills/speckit-doc/SKILL.md`——仅在完整模式下生成；定义四个核心章节：(1) 开发环境搭建：克隆仓库（使用 ProjectMetadata.git.remoteUrl）、安装依赖（`npm install`）、从 scripts 提取 dev/build/start 命令；(2) 代码规范：编码风格要求，从 devDependencies 检测 eslint/prettier 等工具并引用；(3) 提交规范：Conventional Commits 格式说明（feat/fix/docs/chore 等类型 + 示例）；(4) PR 流程指南：Fork -> Branch -> Commit -> PR 标准步骤；内容默认使用英文；无远程 URL 时使用 `[REPOSITORY_URL]` 占位符

**Checkpoint**: 完整模式下可生成包含项目实际命令的 CONTRIBUTING.md。

---

## Phase 8: User Story 5 - 生成 CODE_OF_CONDUCT.md 行为准则 (Priority: P2)

**Goal**: 完整模式下生成基于 Contributor Covenant v2.1 标准的行为准则文档，联系方式字段自动填充。

**Independent Test**: 以完整模式执行命令后，验证 CODE_OF_CONDUCT.md 内容基于 Contributor Covenant v2.1 标准，联系方式已填充或标注为占位符。

### Implementation for User Story 5

- [ ] T018 [US5] 在 SKILL.md 中编写 CODE_OF_CONDUCT.md 生成逻辑（Step 4 中的 CODE_OF_CONDUCT 部分）`plugins/spec-driver/skills/speckit-doc/SKILL.md`——仅在完整模式下生成；内容基于 Contributor Covenant v2.1 标准版本，核心条款完整保留不做删减或改写；联系方式字段（enforcement contact）自动填充：优先 package.json author 邮箱，其次 git config user.email，无可用信息时标注为 `[INSERT CONTACT METHOD]` 并在完成报告中提醒用户；内容默认使用英文

**Checkpoint**: 完整模式下可生成标准化的 CODE_OF_CONDUCT.md。

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 冲突处理、完成报告、错误处理等贯穿多个 Story 的横切关注点

### 冲突检测与文件安全

- [ ] T019 在 SKILL.md 中编写 Step 5（逐文件冲突检测与处理）逻辑 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——对每个目标文件（按 README.md -> LICENSE -> CONTRIBUTING.md -> CODE_OF_CONDUCT.md 顺序）：检测 ProjectMetadata.existingFiles 中对应标记，若文件已存在则展示前 20 行已有内容预览、提供"覆盖（备份为 .bak）"和"跳过"两种选择、选择覆盖时先将原文件重命名为 `{fileName}.bak` 再写入新内容；若文件不存在则直接写入；格式符合 `contracts/skill-interaction-flow.md` Step 5 定义

### 完成报告与降级提示

- [ ] T020 在 SKILL.md 中编写完成报告段落 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——报告内容包含：(1) 生成文件清单，每个文件标注状态图标（+ 新建 / ~ 覆盖已备份 / - 跳过）；(2) 若 ProjectMetadata.missingFields 非空，列出缺失字段并提示用户检查 `[待补充]` 标记手动补充；(3) AST 分析降级时提示 Features 章节基于包声明；格式符合 `contracts/skill-interaction-flow.md` 完成报告定义

### 降级与错误处理

- [ ] T021 在 SKILL.md 中编写降级策略和错误处理段落 `plugins/spec-driver/skills/speckit-doc/SKILL.md`——覆盖以下场景：(1) 非 Node.js 项目：降级为仅使用 git config 和目录结构，提示项目类型不在最佳支持范围；(2) 完全空项目：终止生成，提示 `git init` + `npm init`；(3) AST 分析超时（60秒）：降级为基于 package.json description；(4) package.json 格式异常：降级为无 package.json 模式 + 提示修复；(5) 无远程仓库 URL：Badge 和链接使用占位符或优雅跳过；(6) 用户中断交互：安全终止，不留半成品文件

### 最终整合与验证

- [ ] T022 [P] 审查 SKILL.md 完整性——确认所有 9 个逻辑段落（Frontmatter、角色定义、触发方式、Step 1-5、降级策略、完成报告）完整且连贯，Prompt 整体行数在 400-600 行范围内，与现有 speckit-feature 等 Skill 的风格和格式保持一致
- [ ] T023 [P] 验证 scan-project.sh 在 3 种场景下的输出——(1) 完整信息的 Node.js 项目（如 reverse-spec 自身）；(2) 无 package.json 的项目；(3) 完全空目录。确认输出 JSON 符合 `contracts/scan-project-output.md` Schema
- [ ] T024 [P] 验证 8 个 LICENSE 模板文件——确认文件名使用 SPDX 标准标识符、内容与 SPDX 官方文本一致、占位符格式正确（`[year]`/`[fullname]`）、行尾为 LF、末尾有空行

**Checkpoint**: 所有文件完成，speckit-doc 命令端到端可用。

---

## FR 覆盖映射表

| FR ID | 描述 | 覆盖任务 |
|-------|------|---------|
| FR-001 | README.md 不少于 8 个标准章节 | T016 |
| FR-002 | shields.io 格式 Badge | T016 |
| FR-003 | 从 package.json 提取元信息 + 降级策略 | T003, T012 |
| FR-004 | AST 分析增强 Features 章节 + 降级 | T012, T016 |
| FR-005 | 展示 8 种协议选项 + 交互 | T014 |
| FR-006 | 静态协议模板生成 LICENSE（SPDX 100%） | T004-T011, T015 |
| FR-007 | 自动填充年份和版权持有者 | T015 |
| FR-008 | 检测 package.json license 字段作为推荐 | T014 |
| FR-009 | 精简/完整两种文档模式 | T013 |
| FR-010 | 精简模式贡献内容内联简化 | T016 |
| FR-011 | CONTRIBUTING.md 四个核心章节 | T017 |
| FR-012 | CONTRIBUTING.md 从 scripts 提取实际命令 | T017 |
| FR-013 | CODE_OF_CONDUCT.md 基于 Contributor Covenant v2.1 | T018 |
| FR-014 | CODE_OF_CONDUCT.md 联系方式自动填充 | T018 |
| FR-015 | 文件冲突检测 + diff 预览 + 覆盖/跳过 | T019 |
| FR-016 | 覆盖前备份为 .bak | T019 |
| FR-017 | README 预埋 HTML 注释标记 | T016 |
| FR-018 | 文档内容默认使用英文 | T016, T017, T018 |
| FR-019 | 端到端交互流程编排顺序 | T012, T013, T014, T016, T019, T020 |

**FR 覆盖率**: 19/19 = **100%**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖——立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1 目录创建——**阻塞所有 User Story**
- **Phase 3 (US6)**: 依赖 Phase 2（scan-project.sh 是 SKILL.md Step 1 的基础）
- **Phase 4 (US3)**: 依赖 Phase 3（Step 2 在 Step 1 之后执行）
- **Phase 5 (US2)**: 依赖 Phase 4（Step 3 在 Step 2 之后执行）+ Phase 2（LICENSE 模板文件）
- **Phase 6 (US1)**: 依赖 Phase 5（README 生成在交互收集完成后执行）
- **Phase 7 (US4)**: 依赖 Phase 6（CONTRIBUTING 生成是 Step 4 的一部分，在 README 之后）
- **Phase 8 (US5)**: 依赖 Phase 6（CODE_OF_CONDUCT 生成是 Step 4 的一部分）；可与 Phase 7 并行
- **Phase 9 (Polish)**: 依赖 Phase 6-8 完成

### User Story Dependencies

- **US6 (元信息提取)**: 所有其他 Story 的数据基础，必须最先完成
- **US3 (模式选择)**: 依赖 US6 的元信息，决定后续文件生成范围
- **US2 (协议选择 + LICENSE)**: 依赖 US3 的模式选择，LICENSE 模板依赖 Phase 2
- **US1 (README 生成)**: 依赖 US6 的元信息 + US3 的模式选择 + US2 的协议选择
- **US4 (CONTRIBUTING)**: 依赖 US6 的元信息，仅完整模式生成，可在 US1 之后独立实现
- **US5 (CODE_OF_CONDUCT)**: 依赖 US6 的元信息，仅完整模式生成，可与 US4 并行

### Within SKILL.md (Single File Constraint)

由于本特性的核心实现集中在单个 `SKILL.md` 文件中，Story 内部的任务是对同一文件不同逻辑段落的编写。建议按照端到端流程顺序（Step 1 -> Step 2 -> Step 3 -> Step 4 -> Step 5）依次编写，确保上下文连贯。

### Parallel Opportunities

- **Phase 1**: T001 和 T002 可并行
- **Phase 2**: T004-T011（8 个 LICENSE 模板文件）全部可并行；T003 独立于模板文件
- **Phase 7 和 Phase 8**: US4（CONTRIBUTING）和 US5（CODE_OF_CONDUCT）可并行编写
- **Phase 9**: T022、T023、T024 全部可并行验证

---

## Parallel Example: Phase 2 (Foundational)

```bash
# 8 个 LICENSE 模板文件全部可并行创建:
Task T004: "创建 MIT.txt 模板 in plugins/spec-driver/templates/licenses/MIT.txt"
Task T005: "创建 Apache-2.0.txt 模板 in plugins/spec-driver/templates/licenses/Apache-2.0.txt"
Task T006: "创建 GPL-3.0.txt 模板 in plugins/spec-driver/templates/licenses/GPL-3.0.txt"
Task T007: "创建 BSD-2-Clause.txt 模板 in plugins/spec-driver/templates/licenses/BSD-2-Clause.txt"
Task T008: "创建 BSD-3-Clause.txt 模板 in plugins/spec-driver/templates/licenses/BSD-3-Clause.txt"
Task T009: "创建 ISC.txt 模板 in plugins/spec-driver/templates/licenses/ISC.txt"
Task T010: "创建 MPL-2.0.txt 模板 in plugins/spec-driver/templates/licenses/MPL-2.0.txt"
Task T011: "创建 Unlicense.txt 模板 in plugins/spec-driver/templates/licenses/Unlicense.txt"

# scan-project.sh 可与模板文件并行:
Task T003: "实现 scan-project.sh in plugins/spec-driver/scripts/scan-project.sh"
```

## Parallel Example: Phase 7 & 8 (P2 Stories)

```bash
# CONTRIBUTING 和 CODE_OF_CONDUCT 可并行:
Task T017: "编写 CONTRIBUTING.md 生成逻辑 in SKILL.md"
Task T018: "编写 CODE_OF_CONDUCT.md 生成逻辑 in SKILL.md"
```

---

## Implementation Strategy

### MVP First (精简模式：README + LICENSE)

1. Complete Phase 1: Setup（目录创建）
2. Complete Phase 2: Foundational（scan-project.sh + 8 个 LICENSE 模板）
3. Complete Phase 3: US6（元信息提取 -> SKILL.md Step 1）
4. Complete Phase 4: US3（模式选择 -> SKILL.md Step 2）
5. Complete Phase 5: US2（协议选择 + LICENSE 生成 -> SKILL.md Step 3 + LICENSE 生成逻辑）
6. Complete Phase 6: US1（README 生成 -> SKILL.md Step 4 README 部分）
7. **STOP and VALIDATE**: 以精简模式测试端到端流程——执行 speckit-doc，验证 README.md 和 LICENSE 生成正确
8. 此时 MVP 已可交付

### Incremental Delivery (完整模式)

1. MVP 验证通过后，继续 Phase 7: US4（CONTRIBUTING.md 生成）
2. 继续 Phase 8: US5（CODE_OF_CONDUCT.md 生成）
3. Complete Phase 9: Polish（冲突处理 + 完成报告 + 降级策略 + 验证）
4. **FINAL VALIDATION**: 以完整模式测试端到端流程

### Recommended Approach

**建议采用 MVP First 策略**。原因:
- 10 个新增文件中，SKILL.md 是核心（~400-600 行），需要最多关注
- 精简模式覆盖了 4 个 P1 User Story 中的 3 个（US1/US2/US6），加上 US3（模式选择本身）
- MVP 验证通过后再添加 P2 Story 的成本极低（仅在 SKILL.md 中追加 CONTRIBUTING 和 CODE_OF_CONDUCT 段落）
- 预计 MVP（Phase 1-6）0.5-1 天，完整版（Phase 7-9）额外 0.5 天

---

## Notes

- [P] 标记 = 不同文件、无依赖，可并行执行
- [USN] 标记 = 映射到 spec.md 中对应的 User Story
- 本特性的核心实现集中在单个 SKILL.md 文件（~400-600 行），多个 Story 的任务实际上是编写该文件的不同逻辑段落
- scan-project.sh 是唯一的独立 Bash 脚本文件，其输出格式由 contracts/scan-project-output.md 严格定义
- 8 个 LICENSE 模板文件来源于 SPDX 官方，内容必须 100% 精确（法律合规要求）
- 所有生成的文档内容使用英文（开源社区国际化惯例，Constitution 原则 VI 有条件豁免）
- 零新增 TypeScript 代码；所有变更仅在 `plugins/spec-driver/` 目录内
