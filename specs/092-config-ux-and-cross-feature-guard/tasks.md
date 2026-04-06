---
feature: "092-config-ux-and-cross-feature-guard"
type: tasks
created: 2026-04-06
status: Draft
milestone: M-088
depends_on:
  - spec.md
  - plan.md
  - data-model.md
---

# Tasks: 配置体验 + 跨 Feature 守护

**Input**: 设计文档位于 `specs/092-config-ux-and-cross-feature-guard/`
**Prerequisites**: spec.md, plan.md, data-model.md, research/tech-research.md

**Organization**: 任务按 plan.md 的 4 Phase 路线图组织，对应 spec.md 的 6 项改进（US1-US6）。Phase 3 和 Phase 4 可与 Phase 2 并行推进。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行执行（不同文件、无依赖）
- **[Story]**: 对应 spec.md 中的 User Story（US1-US6）
- 描述中包含精确文件路径

---

## Phase 1: 基础设施层（config-schema.mjs + validate-config.mjs）

**Purpose**: 建立配置 Schema 校验和 effective config 展示的核心能力。所有配置相关改进的基础。

**对应 plan.md**: T1 + T2 | **对应 FR**: FR-001, FR-002, FR-003, FR-004, FR-008, FR-013, FR-014

### 1a: config-schema.mjs -- Zod Schema 定义 + 校验函数

- [ ] T001 [P] [US1] 创建 `plugins/spec-driver/scripts/lib/config-schema.mjs`：定义 `specDriverConfigSchema`（Zod Schema），覆盖 data-model.md 1.1 节定义的所有字段（含新增 `verification.timeout`），使用 `.strict()` 检测未知字段
  - **输入**: data-model.md 1.1 节 Schema 定义 + 1.2 节字段清单
  - **输出**: 导出 `specDriverConfigSchema`、`BUILTIN_DEFAULTS`、`PRESET_DEFAULTS`、`COMMON_CONFIG_FILES` 常量
  - **验证**: `typeof specDriverConfigSchema.safeParse === 'function'`；对合法配置 safeParse 返回 `success: true`

- [ ] T002 [P] [US1] 在 `plugins/spec-driver/scripts/lib/config-schema.mjs` 中实现 `validateConfig(parsedYaml)` 函数：调用 `specDriverConfigSchema.safeParse()`，将 Zod 错误转换为 `ConfigDiagnostic[]` 格式（见 data-model.md 5.1 节）
  - **输入**: `parsedYaml` 对象（由 simple-yaml.mjs 解析后的结果）
  - **输出**: `{ success, data?, diagnostics[] }`，diagnostics 遵循 data-model.md 5.2 节诊断代码表
  - **验证**: 对含未知字段的配置输出 `config.unknown-field` 诊断；对类型错误输出 `config.invalid-type` 诊断

- [ ] T003 [P] [US1] 在 `plugins/spec-driver/scripts/lib/config-schema.mjs` 中实现 `suggestField(unknown, knownFields)` 函数：基于 Levenshtein 编辑距离（阈值 <= 3）为未知字段提供修复建议（见 data-model.md 第 6 节）
  - **输入**: 未知字段名 + 合法字段名列表
  - **输出**: 最近匹配的字段名或 null
  - **验证**: `suggestField('pereset', ['preset', ...])` 返回 `'preset'`；`suggestField('xyz123', [...])` 返回 `null`

- [ ] T004 [US1] 在 `plugins/spec-driver/scripts/lib/config-schema.mjs` 中实现 `resolveEffectiveConfig(options)` 函数：按优先级链（命令行参数 > config.yaml agents > preset 默认值 > 内置默认值）合并配置，返回 `EffectiveConfigEntry[]`（见 data-model.md 2.1 节）
  - **输入**: `{ configYaml, presetOverride? }`
  - **输出**: `EffectiveConfigEntry[]`，每项包含 `{ key, value, source }`
  - **验证**: 对仅设置 `preset: quality-first` 的配置，`resolveEffectiveConfig()` 返回的 `preset` 来源为 `'config.yaml'`，`verification.timeout` 来源为 `'内置默认'`
  - **依赖**: T001（需要 `BUILTIN_DEFAULTS` 和 `PRESET_DEFAULTS` 常量）

**Checkpoint**: `config-schema.mjs` 模块完整导出 Schema、校验函数、合并函数和常量

### 1b: validate-config.mjs -- CLI 入口脚本

- [ ] T005 [US1] 创建 `plugins/spec-driver/scripts/validate-config.mjs`：实现 `--validate` 模式——读取 `spec-driver.config.yaml`，先用 `simple-yaml.mjs` 解析（区分 YAML 语法错误和空文件），再调用 `validateConfig()` 执行 Schema 校验，输出 `createCheck()` 格式结果
  - **输入**: `--project-root <path> --validate`
  - **输出**: 退出码 0（通过）/ 1（Schema 错误）/ 2（YAML 语法错误）；stdout 输出 `createCheck()` 格式结果（见 data-model.md 5.3 节）
  - **验证**: 对合法配置返回退出码 0；对含 `pereset` 拼写错误的配置返回退出码 1 并输出修复建议
  - **依赖**: T001, T002, T003

- [ ] T006 [US2] 在 `plugins/spec-driver/scripts/validate-config.mjs` 中实现 `--show-effective` 模式：调用 `resolveEffectiveConfig()` 并格式化为 ASCII 表格输出（见 plan.md 2.1 节输出格式）
  - **输入**: `--project-root <path> --show-effective [--preset <name>]`
  - **输出**: stdout 输出 `[Effective Config]` ASCII 表格，含"配置项 / 生效值 / 来源"三列
  - **验证**: 输出表格中每个配置项都有来源标注；`--preset speed-first` 覆盖时来源显示为 `--preset 命令行参数`
  - **依赖**: T004

**Checkpoint**: `validate-config.mjs` 的两种模式均可独立执行并输出正确结果

---

## Phase 2: 触发层集成（init-project.sh + config-template.yaml）

**Purpose**: 将 Phase 1 的校验和展示能力集成到 init-project.sh 触发入口。

**对应 plan.md**: T3 | **对应 FR**: FR-001, FR-003

- [ ] T007 [US1] 修改 `plugins/spec-driver/scripts/init-project.sh`：在 `check_config()` 函数（L202-210 区域）中追加 `validate_config_schema()` 函数，调用 `validate-config.mjs --validate` 执行 Schema 校验，校验失败时将结果追加到 `INIT_RESULTS` 并提前返回
  - **输入**: 现有 `check_config()` 函数
  - **输出**: 新增 `validate_config_schema()` 函数；`INIT_RESULTS+=("config_schema:pass")` 或 `INIT_RESULTS+=("config_schema:fail")`
  - **验证**: 对包含结构错误的 `spec-driver.config.yaml` 运行 `init-project.sh`，输出包含校验错误信息
  - **依赖**: T005

- [ ] T008 [US2] 修改 `plugins/spec-driver/scripts/init-project.sh`：在 `run_init_checks()` 末尾（L269-278 区域）追加 `validate-config.mjs --show-effective` 调用，输出 effective config 表
  - **输入**: 现有 `run_init_checks()` 函数
  - **输出**: `init-project.sh` 执行时在末尾输出 `[Effective Config]` 表格
  - **验证**: 运行 `init-project.sh`，stdout 包含 effective config 表且每项来源标注正确
  - **依赖**: T006, T007

**Checkpoint**: `init-project.sh` 执行时自动完成 Schema 校验 + effective config 展示

---

## Phase 3: Agent Prompt 扩展（可与 Phase 2 并行）

**Purpose**: 在 Agent Prompt 层扩展跨 Feature 冲突检测、矛盾检测和超时保护能力。

**对应 plan.md**: T4 + T5 + T6

> **并行说明**: T009、T010、T011 三个任务分别改动不同文件（analyze.md / sync.md / verify.md），彼此无依赖，可完全并行执行。T011 依赖 T001 的 `verification.timeout` 字段定义已在 Phase 1 完成。

### 3a: analyze.md Pass G -- 跨 Feature 文件冲突检测

- [ ] T009 [P] [US3] 修改 `plugins/spec-driver/agents/analyze.md`：在现有 Pass F 之后追加 Pass G 跨 Feature 文件冲突检测逻辑（~35 行），包括：(1) 从当前 Feature tasks.md 提取文件路径集合；(2) 扫描最近 5 个活跃 Feature 的 tasks.md；(3) 排除通用配置文件（COMMON_CONFIG_FILES）；(4) 仅检测 `src/`、`plugins/`、`scripts/` 下的文件；(5) 按严重性分级输出 OVERLAP_WARNING 或 `Pass G: CLEAN`
  - **输入**: analyze.md 现有内容（Pass A-F 之后）
  - **输出**: 新增 Pass G 段落，遵循 plan.md 2.2 节定义的检测逻辑和 data-model.md 3.4 节输出格式
  - **验证**: Pass G 文本包含完整的 6 步检测流程；排除列表包含 `package.json`、`tsconfig.json`、`spec-driver.config.yaml`；严重性分级规则（3+ → HIGH, 1-2 → MEDIUM, 仅测试 → LOW）完整
  - **对应 FR**: FR-005, FR-006, FR-007

### 3b: sync.md -- 矛盾检测与术语一致性检查

- [ ] T010 [P] [US5] 修改 `plugins/spec-driver/agents/sync.md`：在"文档健康度检查"部分（L292-304 区域）追加两项检查——(1) 矛盾检测：识别不同 Feature spec 之间的数值冲突和行为描述冲突；(2) 术语一致性：识别同一概念使用不同术语的情况（~40 行）
  - **输入**: sync.md 现有健康度检查部分（3 项之后）
  - **输出**: 新增第 4 项（矛盾检测）和第 5 项（术语一致性），遵循 plan.md 2.2 节定义的输出格式
  - **验证**: 矛盾检测输出格式为 `[矛盾] FR-xxx (Feature A) vs FR-yyy (Feature B): {描述}`；术语一致性输出格式为 `[术语不一致] "{术语A}" (Feature X) vs "{术语B}" (Feature Y) -- 建议统一为 "{标准术语}"`
  - **对应 FR**: FR-010, FR-011

### 3c: verify.md -- 超时保护

- [ ] T011 [P] [US4] 修改 `plugins/spec-driver/agents/verify.md`：在 Layer 2 Bash 验证命令执行区域追加超时保护指示（~10 行），要求每个 Bash 验证命令前附加 `timeout {N}s` 前缀，并包含超时触发时的日志记录格式和 `gtimeout` 降级提示
  - **输入**: verify.md 现有 Layer 2 验证执行区域
  - **输出**: 新增超时保护段落，包含 MUST 级语言指示和超时日志格式 `[TIMEOUT] 命令 "{cmd}" 在 {N} 秒后被终止`
  - **验证**: 超时保护段落使用 MUST 级语言；包含 `timeout` 命令不可用时的 `gtimeout` 降级提示；编排器注入 `verification.timeout` 的注入点明确
  - **对应 FR**: FR-009

**Checkpoint**: 三个 Agent Prompt 扩展完成，`npm run repo:check` 通过

---

## Phase 4: 元数据层（可与 Phase 2 / Phase 3 并行）

**Purpose**: 补齐 8 个 SKILL.md 的 frontmatter 声明，为后续 089 编排拆分提供结构化元信息。

**对应 plan.md**: T7 | **对应 FR**: FR-012

> **并行说明**: 8 个 SKILL.md 的 frontmatter 修改彼此独立，且与 Phase 1-3 的所有任务无依赖关系，可完全并行执行。每个文件仅改动 frontmatter 区域（`---` 内头 5-8 行），不触碰 body 内容（NFR-002, C-004）。

- [ ] T012 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`、`model: opus`、`effort: high`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T013 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-story/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`、`model: opus`、`effort: high`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T014 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`、`model: opus`、`effort: high`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T015 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`、`model: sonnet`、`effort: medium`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T016 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]`、`model: sonnet`、`effort: medium`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T017 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Glob, Bash]`、`model: sonnet`、`effort: medium`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T018 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-doc/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Glob, Bash]`、`model: sonnet`、`effort: medium`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

- [ ] T019 [P] [US6] 修改 `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` frontmatter：追加 `allowed-tools: [Read, Write, Edit, Glob, Bash]`、`model: sonnet`、`effort: low`
  - **验证**: frontmatter 包含三个新字段且值与 data-model.md 第 4 节目标状态表一致

**Checkpoint**: 8 个 SKILL.md frontmatter 全部包含 `allowed-tools`、`model`、`effort` 声明

---

## Phase 5: 收尾验证

**Purpose**: 全量校验和回归验证

- [ ] T020 运行 `npm run repo:check` 确认全部 pass，验证新增代码零外部依赖（C-001）
  - **验证**: 退出码 0；`package.json` 无新增 dependencies
  - **依赖**: T001-T019 全部完成

- [ ] T021 手动验证 edge cases：(1) 空文件（0 字节）配置输出友好提示；(2) YAML 语法错误（缩进错误）输出语法错误而非 Schema 错误；(3) `verification.timeout: 86400` 输出 WARNING
  - **验证**: 覆盖 spec.md Edge Cases 中定义的 5 个场景
  - **依赖**: T005, T007

---

## Dependencies & Execution Order

### Phase 依赖关系

```
Phase 1a (T001-T004)  ──→  Phase 1b (T005-T006)  ──→  Phase 2 (T007-T008)
      │                                                        │
      │ T001 完成后                                             ▼
      ├──→ Phase 3c (T011, 依赖 timeout 字段定义)           Phase 5 (T020-T021)
      │
      │ 无依赖（可立即开始）                                     ▲
      ├──→ Phase 3a (T009)  ────────────────────────────────────┤
      ├──→ Phase 3b (T010)  ────────────────────────────────────┤
      └──→ Phase 4  (T012-T019) ────────────────────────────────┘
```

### Task 级依赖链

| Task | 依赖 | 说明 |
|------|------|------|
| T001, T002, T003 | 无 | Phase 1a 内部可并行 |
| T004 | T001 | 需要 `BUILTIN_DEFAULTS` 和 `PRESET_DEFAULTS` |
| T005 | T001, T002, T003 | 组装校验流水线 |
| T006 | T004 | 需要 `resolveEffectiveConfig()` |
| T007 | T005 | 集成 `--validate` 到 init-project.sh |
| T008 | T006, T007 | 集成 `--show-effective` 到 init-project.sh |
| T009 | 无 | analyze.md 独立追加 Pass G |
| T010 | 无 | sync.md 独立追加健康度检查 |
| T011 | T001 | 依赖 `verification.timeout` 字段定义 |
| T012-T019 | 无 | 8 个 SKILL.md 彼此独立 |
| T020 | T001-T019 | 全量校验 |
| T021 | T005, T007 | Edge case 手动验证 |

### 并行机会

**最大并行度**: Phase 1a 的 T001/T002/T003 + Phase 3a 的 T009 + Phase 3b 的 T010 + Phase 4 的 T012-T019 可同时启动（共 13 个任务并行）

**推荐执行策略**:

1. **Wave 1**（并行）: T001 + T002 + T003 + T009 + T010 + T012-T019
2. **Wave 2**（依赖 T001）: T004 + T011
3. **Wave 3**（依赖 T001-T004）: T005 + T006
4. **Wave 4**（依赖 T005-T006）: T007 + T008
5. **Wave 5**（全量完成后）: T020 + T021

---

## Parallel Example: Phase 1a

```
# Wave 1 -- 以下任务可完全并行：
Task T001: "创建 config-schema.mjs -- Zod Schema 定义 + 常量"
Task T002: "创建 config-schema.mjs -- validateConfig() 校验函数"
Task T003: "创建 config-schema.mjs -- suggestField() 编辑距离匹配"
Task T009: "修改 analyze.md -- 追加 Pass G 跨 Feature 冲突检测"
Task T010: "修改 sync.md -- 追加矛盾检测 + 术语一致性检查"
Task T012-T019: "修改 8 个 SKILL.md frontmatter"
```

---

## Implementation Strategy

### 按优先级推进

1. **P1 -- 配置校验 + 透明化**（Phase 1 + Phase 2）: T001 → T004 → T005 → T006 → T007 → T008
   - 对应 US1（配置错误提前发现）+ US2（配置透明化）
   - 完成后验证：`init-project.sh` 对结构错误配置输出校验错误 + effective config 表

2. **P2 -- 跨 Feature 冲突检测 + 超时保护**（Phase 3a + 3c）: T009 + T011
   - 对应 US3（跨 Feature 冲突预警）+ US4（验证命令超时保护）
   - 可与 P1 的 Phase 2 并行推进

3. **P3 -- sync 矛盾检测 + Skill 元数据**（Phase 3b + Phase 4）: T010 + T012-T019
   - 对应 US5（sync 文档矛盾检测）+ US6（Skill frontmatter 声明完整）
   - 可与 P1、P2 完全并行

### 验收对照

| Success Criteria | 对应 Task |
|-----------------|-----------|
| SC-001: init-project.sh 对 3 种错误输出校验错误和修复建议 | T005, T007 |
| SC-002: effective config 表覆盖所有配置项且来源正确 | T006, T008 |
| SC-003: analyze.md Pass G 正确输出 OVERLAP_WARNING | T009 |
| SC-004: Zod Schema 包含 `verification.timeout` 字段 | T001 |
| SC-005: sync.md 矛盾检测和术语一致性检查 | T010 |
| SC-006: 8 个 SKILL.md frontmatter 完整 | T012-T019 |
| SC-007: `npm run repo:check` 全部 pass | T020 |
| SC-008: 零外部依赖 | T020 |

---

## Notes

- 所有改动为追加型（NFR-002）——不删除现有脚本逻辑、不修改 SKILL.md body
- SKILL.md frontmatter 改动仅限 `---` 区域内（头 5-8 行），与 090 的 body 改动物理隔离（NFR-004, C-004）
- config-schema.mjs 仅使用 `simple-yaml.mjs` + Zod + Node.js 内置模块（C-001, C-002, FR-014）
- 总估计新增/修改代码：~330 行
- Edge cases 覆盖：空文件、YAML 语法错误、不足 5 个 Feature、tasks.md 不存在、timeout 极大值（见 spec.md Edge Cases）
