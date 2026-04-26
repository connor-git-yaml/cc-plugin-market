# Requirements Quality Checklist: Feature 133 — Per-Project Workflow Overrides

**Purpose**: 验证 spec.md 的需求规范质量，作为进入 GATE_DESIGN 阶段的最终质量关卡
**Created**: 2026-04-26
**Feature**: [specs/133-orchestration-overrides/spec.md](../spec.md)
**检查者**: quality_checklist 子代理（并行于 clarify 阶段执行）

---

## 1. 结构合规性

- [x] **CHK-001 [PASS]**: Frontmatter 包含所有必备字段

  > 证据：spec.md L1-12 包含 `feature_id: "133"`、`branch`、`title`、`status: Draft`、`created_at: "2026-04-26"`、`spec_version: "1.0"`、`input_artifacts`，全部为英文 YAML key，符合 `.claude/rules/specs.md` 要求。

- [x] **CHK-002 [PASS]**: 覆盖 spec-template.md 全部一级章节

  > 证据：spec.md 包含「背景与动机」（对应 Background）、「用户场景与测试」（含 Edge Cases）、「功能需求」、「非功能需求」、「数据契约」（超出模板，附加值）、「验收标准」、「成功标准」、「Out of Scope」、「风险与假设」、「Open Questions」。模板要求的 User Scenarios、Requirements（FR + 实体）、Success Criteria 全部存在。超出模板的章节（数据契约、风险、OQ）是正当扩展。

- [x] **CHK-003 [PASS]**: 无 `[NEEDS CLARIFICATION]` 残留标记

  > 全文搜索无任何 `[NEEDS CLARIFICATION]` 标记。

- [x] **CHK-004 [PASS]**: 章节顺序合理，无章节倒置

  > 背景 → 用户故事 → FR → NFR → 数据契约 → AC → SC → Out of Scope → 风险 → 复杂度 → OQ，逻辑顺序合理，与模板精神一致。

---

## 2. 可机械验证性

- [x] **CHK-005 [PASS]**: 验收场景均含 Given/When/Then 三段式

  > 证据：AC-001 至 AC-016 以及用户故事中的验收场景全部采用 Given/When/Then 结构，大多数包含具体命令（`node scripts/orchestrator-cli.mjs`）、期望退出码（0 或 1）和期望输出内容（stdout/stderr 含具体字符串）。

- [x] **CHK-006 [PASS]**: AC 覆盖产研汇总 §5 S1-S6 全部成功标准

  > 证据：
  > - S1 → AC-001（get-phases fix 返回 overrides phase 序列）
  > - S2 → AC-002/003/004（--annotate、--format json、--diff）
  > - S3 → AC-005/006/007（三种降级场景）
  > - S4 → AC-008/009（repo:check 合法/非法 overrides）
  > - S5 → AC-010（测试三类）
  > - S6 → AC-011（SKILL.md 无改动但感知 overrides）

  > 注意：产研汇总 S2 说"输出含 `_source: base|overrides` 注释"，spec 中采用 `# source: base|overrides` 格式（带 `#` 注释前缀）。格式不完全一致，但属于 specify 阶段的合理细化，不视为冲突。

- [x] **CHK-007 [PASS]**: FR 与 AC 有反向追溯

  > 每条 AC 明确关联功能场景（标注"源自 S1-S6"），部分 AC（如 AC-012/013/014）直接对应 FR-003/FR-013/FR-019。Edge Cases 章节每条均标注关联 FR 编号（如"关联：FR-005、AC-009"）。反向覆盖基本完整，但 FR-020（docs/shared）和 FR-021（project-context 旁注）无对应独立 AC——此点见 CHK-008。

- [ ] **CHK-008 [WARN]**: FR-020 / FR-021 无可机械验证的 AC

  > 证据：FR-020（SHOULD 新增 `docs/shared/agent-orchestration-overrides.md`）和 FR-021（SHOULD 追加 `forbidden_changes` 旁注）均标为 [应当]，但在 AC 章节中无任何对应验收条目。`should` 级需求虽非强制，但仍应有验收路径，否则实施后无法判断是否完成。

  > 修改建议：在 AC 章节末尾追加 AC-017（验证 `docs/shared/agent-orchestration-overrides.md` 文件存在且可通过 `npm run docs:sync:agents` 同步）和 AC-018（验证 `.specify/project-context.yaml` 中 `forbidden_changes` 包含新旁注），或在 FR-020/021 旁注"验收见 AC-XXX"。

- [x] **CHK-009 [PASS]**: 数据契约以结构化形式呈现

  > 证据：spec.md §数据契约 包含 TypeScript 伪类型代码块（OrchestrationOverrides 接口）、字段说明表格、`resolveOrchestrationConfig()` 函数签名代码块、`fieldSources` 结构代码块、Diagnostic 接口代码块、Diagnostic code 清单表格、CLI I/O 代码块及输出格式示例。结构化程度高，无散文化问题。

---

## 3. 完整性

- [x] **CHK-010 [PASS]**: D1-D10 全部决策在 spec.md 中精确表达

  > 逐项核对（按产研汇总推断的 D1-D10）：
  > - D1（方案 B Resolver 模式）→ FR-002/FR-003 + 数据契约 §resolveOrchestrationConfig 签名
  > - D2（文件命名 `.specify/orchestration-overrides.yaml`）→ FR-001
  > - D3（合并语义三类）→ FR-004 表格（完整呈现 modes 整段替换 / gates 字段合并 / parallel_scheduling 标量覆盖）
  > - D4（四类降级策略）→ FR-006 表格（五行，含 overrides 文件不存在、YAML 语法错、Zod 失败、base 不可读，另加 mode 名重名场景）
  > - D5（CLI 子命令契约）→ FR-009/FR-010/FR-011 + 数据契约 §CLI 输入输出契约
  > - D6（Schema 沉淀两份）→ FR-013（schema.mjs）+ FR-015（contract.yaml）
  > - D7（repo:check 接口 `{ status, checks, warnings, errors }`）→ FR-016 明确声明接口格式
  > - D8（三类测试 + node:test）→ FR-018 + NFR-005 + AC-010
  > - D9（文档三项）→ FR-019/FR-020/FR-021
  > - D10（六条排除项）→ Out of Scope 表格（8 行，覆盖 D10 全部条目并超出）

- [x] **CHK-011 [PASS]**: D3 合并语义表完整且含验证场景

  > 证据：FR-004 表格覆盖所有字段类型（modes 整段替换、gates 字段合并、hard_gate_modes 整段替换、parallel_scheduling 标量覆盖、parallel_groups MVP 不支持、未声明字段保留 base）；用户故事 1/2/5 分别验证三种合并场景；Edge Cases 包含 mode 名重名反例。

- [x] **CHK-012 [PASS]**: D4 降级策略四类错误各有明确处理

  > 证据：FR-006 表格共 5 行（比 D4 多一行 mode 名重名），每行均有处理方式、Diagnostic level、Diagnostic code 三列，清晰完整。AC-005/006/007 分别验证三种核心降级路径。

- [x] **CHK-013 [PASS]**: D5 CLI 子命令契约定义清晰

  > 证据：FR-010 选项表格含 positional arg / --annotate / --diff / --format / --project-root 五项，每项有类型、默认值、说明；FR-011 退出码约定表格；数据契约章节含输入格式、三种输出格式示例、退出码表格。

- [x] **CHK-014 [PASS]**: D6 Schema 沉淀两份文件均有明确声明

  > 证据：FR-013 声明 `contracts/orchestration-overrides-schema.mjs`；FR-015 声明 `contracts/orchestration-overrides-contract.yaml`。AC-013 验证 schema.mjs。

- [x] **CHK-015 [PASS]**: D7 repo:check 接口标准显式声明

  > 证据：FR-016 明确声明返回 `{ status: "ok" | "warning" | "error", checks: [...], warnings: [...], errors: [...] }`，与产研汇总一致。

- [x] **CHK-016 [PASS]**: D8 三类测试 + node:test 框架要求覆盖

  > 证据：FR-018 明确要求 `node:test` 框架，三类测试（T1 合并、T2 降级、T3 CLI dry-run）逐一列出具体场景；AC-010 要求 `node --test` 命令可直接运行；NFR-005 要求跟随 `orchestrator.test.mjs` 形态。

- [x] **CHK-017 [PASS]**: D9 文档项完整列举

  > 证据：FR-019（example.yaml）、FR-020（docs/shared 共享片段）、FR-021（project-context forbidden_changes 旁注）逐一列举，与产研汇总实施路径 Phase 1 文档列表完全对应。

- [x] **CHK-018 [PASS]**: D10 排除项一一列出且说明"为何二期"

  > 证据：Out of Scope 表格 8 行，每行含排除原因和二期路径两列，原因具体（如"phases 数组有序且相互依赖"、"需要实现 mode 继承解析链"），二期路径给出了具体的扩展点（如"resolver 可扩展接受 phase_patches 字段"）。

---

## 4. 风险与边界覆盖

- [x] **CHK-019 [PASS]**: 产研汇总 R1-R10 全部在 spec.md 中重新表述

  > 证据：§风险与假设 共 10 条（R1-R10），标题与产研汇总一一对应，且从"实现侧视角"重新表达，每条均有缓解措施。

- [x] **CHK-020 [PASS]**: Edge Cases 覆盖全部指定场景

  > 检查清单所要求的 6 种 edge case：
  > - overrides 文件不存在 → AC-007 + FR-006 第一行
  > - 空文件 → Edge Cases 第三条（零字节等效空对象）
  > - YAML 语法错 → AC-005 + FR-006 + Edge Cases
  > - Zod 校验失败 → AC-006 + FR-006
  > - base 不可读 → FR-006 第四行 + Edge Cases 第六条
  > - 自定义 mode 名重复 → Edge Cases 第一条 + FR-006 第五行
  > 全部覆盖，并额外覆盖 YAML anchor 限制（Edge Cases 第七条）。

- [x] **CHK-021 [PASS]**: Out of Scope 清晰，明确"不做"

  > 证据：Out of Scope 表格 8 行，每行均是可执行的排除声明，且最后一行专门声明"不允许任何对 plugin 内文件的反向修改"，覆盖了 D10 的核心约束。

- [x] **CHK-022 [PASS]**: Open Questions 含 OQ-001/OQ-002 且明确标注

  > 证据：OQ-001（--annotate 注释粒度）和 OQ-002（双校验链路协作边界）均存在，问题描述清晰，影响范围说明到位，OQ-002 明确"建议在 GATE_DESIGN 阶段确认"。

---

## 5. 一致性

- [x] **CHK-023 [PASS]**: 编号唯一性

  > FR-001 至 FR-021、NFR-001 至 NFR-005、AC-001 至 AC-016、SC-001 至 SC-006、OQ-001 至 OQ-002 各自连续不重复。

- [ ] **CHK-024 [WARN]**: 同一概念用词存在轻微不一致

  > 证据：
  > 1. FR-002 描述加载序时写"深合并"，FR-004 表格标题为"合并语义"——措辞不完全统一，但语义无歧义。
  > 2. 产研汇总 S2 使用 `_source: base|overrides`（下划线前缀），spec.md 中统一改为 `# source: base|overrides`（YAML 注释形式）。差异属于 specify 阶段合理细化，但应在 spec 中明确一句"本文统一采用 `# source:` 注释格式，与产研汇总符号有意不同"，避免实现者疑惑。
  > 3. "项目层"与"项目级"在正文中交替出现（背景用"项目层"，SC-001 用"项目团队"，一致性可接受）。

  > 修改建议：在数据契约 §CLI `--annotate` 输出格式 前追加一行说明："注：本文采用 `# source: base|overrides` 格式（YAML 行内注释），产研汇总中的 `_source:` 为草稿符号，两者含义相同。"

- [x] **CHK-025 [PASS]**: 文件路径引用一致且标注推断

  > 证据：所有文件路径引用（`plugins/spec-driver/lib/orchestration-resolver.mjs`、`plugins/spec-driver/contracts/`、`plugins/spec-driver/scripts/`、`plugins/spec-driver/tests/`、`plugins/spec-driver/templates/`）在 spec.md 中保持一致；Edge Cases 第五条（--annotate 与 --diff 同时传入）标注了 `[推断] [INFERRED]`，符合规范。

- [x] **CHK-026 [PASS]**: 中英文混用合规

  > 正文为中文，技术术语（Zod、safeParse、simple-yaml.mjs、orchestrator-cli.mjs、fieldSources、createDiagnostic、node:test、YAML、ESLint 等）保持英文原文，符合语言约定。

---

## 6. 与产研汇总的差异核查

- [x] **CHK-027 [PASS]**: spec.md 未引入产研汇总未涉及的不合理新决策

  > spec.md 新增的细节（如 `--project-root <path>` 选项、`isFallback: boolean` 字段、YAML anchor 限制标注、`generateFallbackConfig()` 后备配置、`NFR-003 .strict()` 策略）均是对产研汇总方向的合理具体化，未引入新的架构决策。

- [x] **CHK-028 [PASS]**: spec.md 未遗漏产研汇总关键结论

  > 所有纳入 MVP 的 10 项能力（见产研汇总 §5 纳入列表）均有对应 FR 覆盖，无遗漏。

- [x] **CHK-029 [PASS]**: 高优先级风险 R1/R3/R6 在 spec.md 精确呈现

  > - R1（Mode 替换语义）→ 风险 R1 + FR-004 表格 + Edge Cases mode-overridden 场景 + Out of Scope 行 1 的说明
  > - R3（repo:check 回归）→ 风险 R3 + FR-017 追加式修改约束 + AC-008 零回归验收
  > - R6（非法 overrides 不能搞崩工具）→ 风险 R6 + FR-006 全四路降级 + AC-005/006/007

- [ ] **CHK-030 [WARN]**: 产研汇总 R7 缓解措施与 spec 表述存在分歧

  > 产研汇总 R7 建议"Zod schema 对 mode 名做 enum 校验（base mode reserved list）"，但 spec.md FR-006/Edge Cases 第一条的实际处理是"warn 但仍生效"（允许 overrides 覆盖 base 已有 mode），而非 enum 校验报错。这一分歧是有意识的细化（"用户意图明确"），但 spec 未明确说明"不采用 R7 产研建议中的 enum 校验方案"及原因。

  > 修改建议：在 风险 R7 缓解措施末尾追加一句："注：产研汇总建议的 Zod enum 校验在 specify 阶段经评估后改为 info diagnostic + 继续生效（理由：mode 整段覆盖是预期场景，强报错会阻塞用户意图明确的操作）。"

---

## 7. Constitution / 仓库规则合规

- [x] **CHK-031 [PASS]**: 提交前验证链路已声明

  > 证据：NFR-002 提及 `orchestrator.test.mjs`；FR-018 指定 `node:test` 框架；AC-010 要求 `npx vitest run` 等价路径可用；风险 R5 明确"确认 CI test 脚本同时覆盖 node --test 路径"。虽然 spec.md 未逐字列出 `npm run lint && npm run build && npx vitest run`，但 NFR-002/NFR-005 + AC-010 已覆盖 build 和 test 要求。

  > 注：spec 不是任务列表，不要求逐字抄写 CLAUDE.md 中的命令链，此条 PASS。

- [x] **CHK-032 [PASS]**: 未把 Spec 级执行策略塞进 Project Context

  > 证据：FR-021 仅要求在 `forbidden_changes` 追加旁注（说明覆盖应放 `.specify/orchestration-overrides.yaml`），不修改 project-context 的执行策略结构，符合设计动机自洽性。

- [x] **CHK-033 [PASS]**: 未要求修改 plugin 内 orchestration.yaml / agents / SKILL.md

  > 证据：AC-011 明确"SKILL.md 文件内容无任何改动"；Out of Scope 最后一行"任何对 plugin 内 `orchestration.yaml` / `agents/` / `SKILL.md` 的反向修改"明确排除；FR-012 改造 `orchestrator-cli.mjs` 属于 scripts 目录，不属于 plugin 内 agents。

- [x] **CHK-034 [PASS]**: 未引入新依赖

  > 证据：NFR-005 明确"不得引入新的外部依赖（`zod` 和 `simple-yaml.mjs` 均已在项目中）"；复杂度评估章节"依赖新引入数：0"。

---

## 汇总

| 维度 | PASS | WARN | FAIL | 小计 |
|------|------|------|------|------|
| 1. 结构合规性 | 4 | 0 | 0 | 4 |
| 2. 可机械验证性 | 4 | 1 | 0 | 5 |
| 3. 完整性 | 9 | 0 | 0 | 9 |
| 4. 风险与边界覆盖 | 4 | 0 | 0 | 4 |
| 5. 一致性 | 3 | 1 | 0 | 4 |
| 6. 与产研汇总差异核查 | 3 | 1 | 0 | 4 |
| 7. Constitution / 仓库规则合规 | 4 | 0 | 0 | 4 |
| **合计** | **31** | **3** | **0** | **34** |

**PASS 31 / WARN 3 / FAIL 0 / 总数 34**

---

## 必须修复（FAIL）项清单

无 FAIL 项。spec.md 质量足以进入 GATE_DESIGN 阶段。

---

## 建议修复（WARN）项清单

以下 3 项 WARN 建议在 GATE_DESIGN 审查前修复，以减少审查时的歧义：

### WARN-1（CHK-008）：FR-020 / FR-021 无对应 AC

- **问题**：FR-020（共享文档片段）和 FR-021（project-context 旁注）是 [应当] 级需求，但在 AC 章节无任何验收条目，实施后无法判断是否完成。
- **修改建议**：追加 AC-017（验证 `docs/shared/agent-orchestration-overrides.md` 存在）+ AC-018（验证 `.specify/project-context.yaml` `forbidden_changes` 包含新旁注），或在 FR-020/021 末尾标注"验收通过人工检查，见 AC-017/018"。
- **影响 GATE_DESIGN 决策**：否（不影响架构方向，属于文档完整性问题）。

### WARN-2（CHK-024）：`# source:` 格式与产研汇总 `_source:` 符号未作说明

- **问题**：产研汇总 S2 使用 `_source: base|overrides`，spec 改为 `# source: base|overrides` 注释格式，合理但未注明差异来源，实现者可能参照产研汇总产生困惑。
- **修改建议**：在数据契约 §CLI `--annotate` YAML 输出格式前追加一行说明："本文统一采用 `# source:` YAML 行内注释格式；产研汇总中的 `_source:` 为草稿符号，含义相同。"
- **影响 GATE_DESIGN 决策**：否（纯格式澄清）。

### WARN-3（CHK-030）：R7 缓解策略与产研汇总建议分歧未说明

- **问题**：产研汇总 R7 建议"Zod schema 对 mode 名做 enum 校验（base mode reserved list）"，spec 最终选择"warn 但仍生效"，是合理细化但未注明原因。
- **修改建议**：在风险 R7 缓解措施末尾追加："注：产研汇总建议的 enum 校验在 specify 阶段评估后改为 info diagnostic + 继续生效，理由：mode 整段覆盖是用户意图明确的场景，强报错会阻塞合法操作。"
- **影响 GATE_DESIGN 决策**：否（不改变 FR-006 的降级策略设计，仅补充决策依据）。
