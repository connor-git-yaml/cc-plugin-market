# 修复计划：删除 spec-driver 遗留原子 skill

**Feature**: F2.5（fix 模式）
**分支**: `claude/objective-tereshkova-e812f4`
**日期**: 2026-04-19
**诊断来源**: `specs/129-fix-remove-atomic-skills/fix-report.md`

---

## Summary

spec-driver 插件现存两套并行 skill 实现：9 个遗留原子 skill（`.claude/commands/spec-driver.*.md`）与编排器 skill（`plugins/spec-driver/skills/spec-driver-*/`）。两者无代码依赖，但命令面板同时可见，造成入口混乱。编排器 skill 已完整覆盖所有旧场景（经 fix-report 逐条验证），原子 skill 属于纯历史债务。

本次修复采用**方案 A**：一次性删除 9 个原子 skill 文件，同步清理 2 份合同 YAML、9 处 stale reference、2 份 README、1 份测试 setup，并新建迁移指南，最终运行 `npm run codex:spec-driver:install` 再生 Codex wrapper。所有改动均为机械性替换，无新设计、无新架构。

---

## Technical Context

**语言/运行时**: Bash 5.x、YAML、Markdown、TypeScript 5.x（仅测试文件涉及）
**工具链**: Node.js 20.x，`vitest`（集成测试），`npm run repo:check`（合同校验）
**关键路径**:
- 删除 → 合同校验失败（`validate-wrapper-sources.mjs:144-167`、`validate-runtime-boundaries.mjs`）→ 必须同步改合同
- 合同变更 → Codex wrapper 需 regen（`npm run codex:spec-driver:install`）
- Stale reference 不改 → 用户按 skill prompt 指引执行会收到 "command not found"

**无新依赖**，无数据迁移，无 schema 变更。

---

## Codebase Reality Check

对所有主要目标文件的当前状态采样，并与 fix-report.md 中列出的行号对比：

| 文件 | LOC | 核心内容 | 已知 debt / 行号差异说明 |
|------|-----|----------|--------------------------|
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | 63 | `claudeProjectOverrides.entries`：9 条原子 skill 登记 | 无 debt；行号与 fix-report 一致（L44-62 为 9 条 entries） |
| `contracts/runtime-boundary-contract.yaml` | 31 | `claude.requiredFiles` 含 `.claude/commands/spec-driver.implement.md` | 无 debt；L14 精确匹配 |
| `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` | 61 | 触发方式段 L17：`/spec-driver.constitution`（self-declaration） | 无 debt；行号与 fix-report 一致 |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | 480+ | L74：`/spec-driver.constitution` 引用 | 无 debt；行号与 fix-report 一致（精确核实） |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | 未整算，估 ~120 | Constitution 处理段引用 | **行号偏差**：fix-report 标注 L49，实际在 L55（+6 行）；功能性位置一致 |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | 未整算，估 ~200 | Constitution 处理段引用 | **行号偏差**：fix-report 标注 "L79 左右"，实际在 L56；功能性位置一致 |
| `README.md` | 624 | L505-527 原子 skill 命令参考段 | 无 debt；行号与 fix-report 一致（采样 L499-527 确认） |
| `plugins/spec-driver/README.md` | 276 | L76 和 L355 含 `/spec-driver.constitution` 引用；L340-356 命令映射表含旧命令 | 无 debt；行号与 fix-report 一致 |
| `tests/integration/runtime-boundary-contract.test.ts` | 86 | L47 `writeFileSync` 写入 `spec-driver.implement.md` | 无 debt；行号与 fix-report 一致（精确核实） |
| `.specify/scripts/bash/check-prerequisites.sh` | 147 | L105、L111、L118 错误提示引用原子命令 | 无 debt；行号与 fix-report 一致（采样 L98-120 确认） |
| `plugins/spec-driver/agents/constitution.md` | ~100 | L99 引用 `/spec-driver.constitution` | 无 debt；行号与 fix-report 一致（采样 L93-100 确认） |
| `plugins/spec-driver/templates/specify-base/plan-template.md` | 105（估） | L6、L72-77 注释中引用 `/spec-driver.plan`、`/spec-driver.tasks` 等 | 无 debt |
| `plugins/spec-driver/templates/specify-base/tasks-template.md` | ~50 | L32 注释引用 `/spec-driver.tasks` | 无 debt |
| `plugins/spec-driver/templates/specify-base/checklist-template.md` | ~30 | L7、L13 注释引用 `/spec-driver.checklist` | 无 debt |

**行号差异修正**：
- `spec-driver-resume/SKILL.md`：实际操作行为 L55（非 L49）
- `spec-driver-story/SKILL.md`：实际操作行为 L56（非 "L79 左右"）

**fix-report 未列、额外发现**：
- `plugins/spec-driver/scripts/lib/init-project-output.sh` L56：含 `/spec-driver.constitution` 引用，格式与 agents/constitution.md L99 同类。评估：该文件为 shell 脚本的输出模块，同属 stale reference 类别，应纳入悬空引用清理范围。
- `plugins/spec-driver/scripts/codex-skills.sh` L121：`source_command="/spec-driver.constitution"`，但这是 codex-skills.sh 内部的生成逻辑（用于写入 wrapper 文件），属于"生成脚本的内部逻辑"。删除原子 skill 后，该脚本仍会生成 Codex wrapper，但 wrapper 内容会发生变化（触发方式段需要改）。**判断**：需纳入审查，但实际动作是改 `spec-driver-constitution/SKILL.md` 触发方式段 → regen codex wrapper，codex-skills.sh 本身不改（它只是复制 SKILL.md 内容）。

**前置清理规则检查**：
- 无文件 LOC > 500 且新增 > 50 行（本次只减不增）
- 无 > 3 个 TODO/FIXME 与本次变更相关
- 无代码重复 > 30 行

→ **无前置 CLEANUP 任务触发**。

---

## Impact Assessment

| 维度 | 数值 / 描述 |
|------|------------|
| 直接修改文件数 | 14（含 templates、agents、skills、tests、docs） |
| 删除文件数 | 9（`.claude/commands/spec-driver.*.md`） |
| 新增文件数 | 2（`docs/migrations/skill-deprecation.md`、`CHANGELOG.md` 新增条目） |
| 额外纳入文件 | 1（`plugins/spec-driver/scripts/lib/init-project-output.sh` L56） |
| 总变更编辑点 | ~26 |
| 跨包影响 | 5 个顶层边界：`.claude/commands/`（删）、`plugins/spec-driver/`（多子目录）、`contracts/`（修）、`docs/`（新）、`tests/`（修） |
| 数据迁移 | 无 |
| API/契约变更 | **有**：`claudeProjectOverrides.entries` 9 条删除（wrapper-source-of-truth.yaml）；`requiredFiles` 1 条删除（runtime-boundary-contract.yaml）。均为内部合同，但 `npm run repo:check` 和集成测试显式依赖这些条目 |
| 用户可见变更 | `/spec-driver.specify` 等 9 个命令从命令面板消失（breaking change for 原子 skill 用户） |

**风险等级判定**：

- 影响文件数 26 > 20 → HIGH 触发条件满足
- 跨包影响 5 个顶层边界 > 2 → HIGH 触发条件满足
- 有合同变更（内部，但合规检查依赖）

→ **风险等级：HIGH**

**HIGH 风险强制分阶段分析**：

fix-report.md 已论证"不切换到 feature 模式"的理由，但 HIGH 风险要求分阶段。结合本次变更的性质（所有改动从同一个事实派生，无设计歧义），**分阶段**如下：

| 阶段 | 内容 | 验证点 |
|------|------|--------|
| **阶段 1：合同与删除**（核心事实确立） | 删 9 个原子 skill 文件 + 改 `wrapper-source-of-truth.yaml` + 改 `runtime-boundary-contract.yaml` + 改集成测试 setup | `npm run repo:check` 通过；`npx vitest run` 通过 |
| **阶段 2：文档与引用清理**（一致性恢复） | 清 stale reference（9 处 prompt/template/script）+ 更新 2 份 README + 新建迁移指南 + 添加 CHANGELOG 条目 + regen Codex wrapper | `npm run repo:check` 通过；手动确认命令面板 |

两阶段均在同一 PR 中完成，但可在 commit 粒度上分离，便于回滚。阶段 1 失败不影响文件完整性（被删文件可从 git 恢复）；阶段 2 失败不破坏功能（合同已一致，只是文档有悬空引用）。

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| **I. 双语文档规范** | 适用 | PASS | 新建 `docs/migrations/skill-deprecation.md` 和 CHANGELOG 条目将以中文散文 + 英文代码标识符写作 |
| **II. Spec-Driven Development** | 适用 | PASS | 本次修复通过 fix-report → plan → tasks → 实施流程执行，符合规范 |
| **III. YAGNI / 奥卡姆剃刀** | 适用 | PASS | 本次是**减少**实体（删 9 个文件），完全符合最小必要复杂度原则；迁移指南是用户安全过渡的最小必要产物 |
| **IV. 诚实标注不确定性** | 适用 | PASS | fix-report 中所有行号差异已在本 plan 中明确标注 |
| **V. AST 精确性优先** | 不适用 | PASS（不在范围内） | 本 fix 不涉及 spectra 插件的 AST 分析 |
| **VI. 混合分析流水线** | 不适用 | PASS（不在范围内） | 同上 |
| **VII. 只读安全性** | 不适用 | PASS（不在范围内） | 同上 |
| **VIII. 纯 Node.js 生态** | 不适用 | PASS（不在范围内） | 同上 |
| **IX. Prompt 编排 + Harness 强制** | 适用 | PASS | 删除后编排器 skill 仍为用户触发入口的唯一定义来源，架构更清晰 |
| **X. 零运行时依赖** | 适用 | PASS | 无新引入运行时依赖；修改的只是 Markdown Prompt 和 YAML 配置 |
| **XI. 质量门控不可绕过** | 适用 | PASS | GATE_DESIGN（CHANGELOG 说明 breaking change）、GATE_VERIFY 正常执行 |
| **XII. 验证铁律** | 适用 | PASS | 验证方案明确要求 `npm run repo:check` + `npx vitest run` + `npm run build` 实际输出证据 |
| **XIII. 向后兼容** | 适用 | **WARN** | 删除 9 个 `.claude/commands/spec-driver.*.md` 对现有使用原子命令的用户是 breaking change。缓解措施：新建 `docs/migrations/skill-deprecation.md` 提供一一映射表；CHANGELOG 标注 breaking change；编排器 skill 覆盖全部旧场景（fix-report 逐条验证）。**不构成 VIOLATION**：fix-report 已确认零代码依赖，用户显式迁移即可 |
| **XIV. 可观测性与架构守护** | 适用 | PASS | 本次属于"涉及删除"的场景：verify 阶段应扫描旧命令名称残留，确认命令面板不再可见 |

**Constitution Check 结论**：所有原则通过，原则 XIII 有 1 条 WARN（已有缓解措施），无 VIOLATION，计划有效。

---

## 变更清单

### 删除（9 个文件）

| 文件 | 动作 |
|------|------|
| `.claude/commands/spec-driver.analyze.md` | 删除 |
| `.claude/commands/spec-driver.checklist.md` | 删除 |
| `.claude/commands/spec-driver.clarify.md` | 删除 |
| `.claude/commands/spec-driver.constitution.md` | 删除 |
| `.claude/commands/spec-driver.implement.md` | 删除 |
| `.claude/commands/spec-driver.plan.md` | 删除 |
| `.claude/commands/spec-driver.specify.md` | 删除 |
| `.claude/commands/spec-driver.tasks.md` | 删除 |
| `.claude/commands/spec-driver.taskstoissues.md` | 删除 |

### 修改（14 个文件）

**合同 YAML（阶段 1）**

| 文件 | 位置 | 动作 |
|------|------|------|
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | L44-62，`claudeProjectOverrides.entries` 9 条 | 删除全部 9 条 entry；保留 `claudeProjectOverrides` 区块头（含 classification / root / note）但将 entries 改为空列表，或整体移除 entries key |
| `contracts/runtime-boundary-contract.yaml` | L14，`claude.requiredFiles` 中 `.claude/commands/spec-driver.implement.md` | 删除该条；`requiredFiles` 列表仅保留 `.claude/settings.json` |

**测试（阶段 1）**

| 文件 | 位置 | 动作 |
|------|------|------|
| `tests/integration/runtime-boundary-contract.test.ts` | L47 `writeFileSync(..., 'spec-driver.implement.md', ...)` | 删除该行；如果后续测试断言检查 requiredFiles 包含该文件，对应断言也需要同步删除 |

**Skill prompt / agent（阶段 2）**

| 文件 | 位置 | 动作 |
|------|------|------|
| `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` | L17：触发方式段 `/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution`（self-declaration 入口） |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | L74：`/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | L55（实际行号，fix-report 标注 L49）：`/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | L56（实际行号，fix-report 标注"L79 左右"）：`/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/agents/constitution.md` | L99：`/spec-driver.constitution` | 改为 `/spec-driver:spec-driver-constitution` |
| `plugins/spec-driver/scripts/lib/init-project-output.sh` | L56：`/spec-driver.constitution` 引用（fix-report 未列出，本 plan 补充） | 改为 `/spec-driver:spec-driver-constitution` |
| `.specify/scripts/bash/check-prerequisites.sh` | L105、L111、L118 错误提示中的 `Run /spec-driver.specify/plan/tasks first` | 改为对应编排器命令（L105 → `/spec-driver:spec-driver-feature`；L111 → `/spec-driver:spec-driver-implement --entry-point=plan`；L118 → `/spec-driver:spec-driver-implement`）|

**模板（阶段 2）**

| 文件 | 位置 | 动作 |
|------|------|------|
| `plugins/spec-driver/templates/specify-base/plan-template.md` | L6 注释、L72-77 注释中的 `/spec-driver.plan`、`/spec-driver.tasks` 等 | 改为中性描述（"由 plan 阶段生成" / "由 tasks 阶段生成"），或直接删除对具体命令的引用 |
| `plugins/spec-driver/templates/specify-base/tasks-template.md` | L32 注释中的 `/spec-driver.tasks` | 改为中性描述 |
| `plugins/spec-driver/templates/specify-base/checklist-template.md` | L7、L13 注释中的 `/spec-driver.checklist` | 改为中性描述 |

**文档（阶段 2）**

| 文件 | 位置 | 动作 |
|------|------|------|
| `README.md` | L499-527 "Individual Phase Commands" 段 | 替换为编排器 skill 参考（9 个编排器命令），并增加指向 `docs/migrations/skill-deprecation.md` 的链接 |
| `plugins/spec-driver/README.md` | L76（`/spec-driver.constitution` 引用）；L340-356（命令映射表含旧命令，尤其 L355 `/spec-driver.constitution` 一行） | L76 改为 `/spec-driver:spec-driver-constitution`；映射表新增一列"已弃用的原子命令 → 当前编排器命令"，或在 L356 后增加迁移说明 |

### 新增（2 个文件）

| 文件 | 内容 |
|------|------|
| `docs/migrations/skill-deprecation.md` | 迁移指南：旧原子命令 → 编排器命令一一映射表；示例调用；背景说明；自 v4.x 起弃用原子 skill |
| `CHANGELOG.md`（新条目，文件已存在则追加） | Breaking change 条目：记录 9 个 `.claude/commands/spec-driver.*.md` 已删除，附迁移指引链接 |

### 再生成（执行同步脚本）

| 产物 | 脚本 | 理由 |
|------|------|------|
| `.codex/skills/spec-driver-constitution/SKILL.md` | `npm run codex:spec-driver:install` | source `spec-driver-constitution/SKILL.md` 触发方式段已改 → wrapper 需要 regen |
| `.codex/skills/spec-driver-implement/SKILL.md` | 同上 | source `spec-driver-implement/SKILL.md` L74 改 → regen |
| `.codex/skills/spec-driver-resume/SKILL.md` | 同上 | source `spec-driver-resume/SKILL.md` 改 → regen |
| `.codex/skills/spec-driver-story/SKILL.md` | 同上 | source `spec-driver-story/SKILL.md` 改 → regen |

---

## 回归风险评估

### 风险组 1：合同一致性（高风险，阶段 1 覆盖）

**变更**：删除 `wrapper-source-of-truth.yaml` 中 9 条 entries + `runtime-boundary-contract.yaml` 中 1 条 requiredFiles。

**风险**：
- `validate-wrapper-sources.mjs` 会检查 entries 中每条 target 是否存在（文件删 + 条目留 = fail）
- `validate-runtime-boundaries.mjs` 同理
- 集成测试 `runtime-boundary-contract.test.ts` setup 会写入已不在 requiredFiles 中的文件，可能导致测试断言覆盖范围出现逻辑混淆

**缓解**：阶段 1 先改合同 + 改测试 setup，再删文件，确保"文件消失"和"合同声明消失"同步发生。验证通过 `npm run repo:check` + `npx vitest run`。

### 风险组 2：Stale Reference（中风险，阶段 2 覆盖）

**变更**：9 处 prompt/template/script 中的 `/spec-driver.constitution`、`/spec-driver.specify` 等引用。

**风险**：
- 编排器 skill 在 Constitution 处理段告诉用户"先运行 `/spec-driver.constitution`"，但该命令已不存在 → 用户体验中断
- 模板注释不影响功能，但会误导维护者

**缓解**：全部替换为编排器命令格式 `/spec-driver:spec-driver-constitution`（这些命令已确认存在）；修改后手动验证命令面板。

**额外风险**：`plugins/spec-driver/scripts/lib/init-project-output.sh` L56 在 fix-report 中未列出但同类，已补入变更清单。

### 风险组 3：Codex wrapper 不一致（低风险，regen 覆盖）

**变更**：4 个 source SKILL.md 修改后需 regen Codex wrapper。

**风险**：如果 regen 脚本未运行，Codex 中的 constitution 触发方式段仍显示旧命令。

**缓解**：tasks.md 中明确要求最后一步执行 `npm run codex:spec-driver:install`，并在 `npm run repo:check` 前运行。

### 风险组 4：用户迁移（低风险，文档覆盖）

**风险**：现有用户熟悉原子命令，升级后 `/spec-driver.specify` 等命令消失。

**缓解**：新建 `docs/migrations/skill-deprecation.md`（含完整映射表）；README 顶层命令参考段替换；CHANGELOG 明确 breaking change 版本节点。

---

## 验证方案

### 阶段 1 验证（合同与删除）

```bash
# 1. 合同一致性（最关键）
npm run repo:check

# 2. 集成测试
npx vitest run tests/integration/runtime-boundary-contract.test.ts

# 3. 完整测试套件
npx vitest run

# 4. 构建
npm run build
```

**预期**：全部零错误。`npm run repo:check` 不再因 `.claude/commands/spec-driver.*.md` 文件不存在而报 fail。

### 阶段 2 验证（引用清理与文档）

```bash
# 1. 再次跑合同检查（确认 stale reference 清理后不引入新问题）
npm run repo:check

# 2. 完整测试套件
npx vitest run

# 3. Codex wrapper regen
npm run codex:spec-driver:install

# 4. 构建
npm run build
```

**手动验证**：
- Claude Code 命令面板搜索 `spec-driver.specify`：应显示"无匹配命令"（confirm 原子命令已消失）
- Claude Code 命令面板搜索 `spec-driver:spec-driver-feature`：应正常显示编排器 skill
- 打开 `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md`：触发方式段应显示 `/spec-driver:spec-driver-constitution`（非旧格式）
- 打开 `.codex/skills/spec-driver-constitution/SKILL.md`：regen 后应与 source 一致

**剩余旧命令引用扫描**（verify 阶段执行）：

```bash
# 在 plugins/spec-driver/ 下搜索旧格式引用残留
grep -rn "/spec-driver\." plugins/spec-driver/ --include="*.md" --include="*.sh" --include="*.yaml"
```

**预期**：无 `/spec-driver.constitution`、`/spec-driver.specify` 等旧格式引用（`plugins/spec-driver/README.md` 命令映射表中历史记录行除外）。

---

## Complexity Tracking

本修复的"复杂度"来自 scope 大于典型 fix，不来自技术设计。以下记录偏离"最小改动（只删 9 个文件）"的决策及理由：

| 偏离点 | 为什么必要 | 若不做的后果 |
|--------|-----------|------------|
| 同步改 `wrapper-source-of-truth.yaml`（9 条 entries 删除） | `validate-wrapper-sources.mjs` 会检查 entries 中 target 文件必须存在；文件删 + 条目留 → `npm run repo:check` 立即失败 | 仓库无法通过 CI 合同校验 |
| 同步改 `runtime-boundary-contract.yaml`（1 条 requiredFiles 删除） | 同上，`validate-runtime-boundaries.mjs` 显式校验 | 同上 |
| 清理 9 处 stale reference（prompt + template + script） | 编排器 skill 在 Constitution 处理段会指引用户运行 `/spec-driver.constitution`，删文件后该命令 "command not found"，等于在 skill 内部植入了新 bug | 用户按 skill 指引操作时报错，体验中断 |
| 新建迁移指南 `docs/migrations/skill-deprecation.md` | 原则 XIII（向后兼容）要求提供安全过渡路径；breaking change 不附迁移指引 = WARN 升级为 VIOLATION 风险 | 用户无法自助迁移 |
| 修改测试 setup（`runtime-boundary-contract.test.ts` L47） | 测试 setup 写入一个不再在 requiredFiles 中声明的文件，会导致测试覆盖的是一个虚假前提 | 测试逻辑与实际合同脱节，降低测试可信度 |
| 补充 `init-project-output.sh` L56（fix-report 遗漏） | 同类 stale reference，不处理则 `init-project.sh` 的输出仍指向旧命令 | 同"9 处 stale reference"后果 |
| regen `.codex/skills/*`（4 个 wrapper） | source SKILL.md 改后 Codex wrapper 自动过期；不 regen 则 Codex 环境体验与 Claude 不一致 | Codex 用户仍看到旧触发方式 |
