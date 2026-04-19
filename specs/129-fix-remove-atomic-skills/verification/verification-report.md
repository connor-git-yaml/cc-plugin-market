# Verification Report — F2.5 删除原子 skill

**日期**: 2026-04-19
**验证人**: verify 子代理
**特性分支**: claude/objective-tereshkova-e812f4
**前置**: spec-review（PASS_WITH_WARNINGS, 0 CRITICAL）+ quality-review（PASS_WITH_WARNINGS, 0 CRITICAL）
**超时保护**: timeout / gtimeout 均不可用（macOS 未安装 coreutils），本次验证跳过超时前缀，直接运行命令。

---

## 总体结论

**PASS_WITH_WARNINGS**

所有工具链验证通过（repo:check exit 0, vitest 162 文件 / 1626 测试全绿, build exit 0）。Prompt 定义的 8 条完成标准全部满足。遗留 6 个 WARNING（来自 spec-review + quality-review），其中 W-02 和 W-03 已由编排器在 verify 阶段前主动修复，W-01 为已知设计保留（原子文件路径分支作为第三方项目 override 槽位），W-spec-1 / W-spec-2 / W-spec-3 不阻断合并。无 CRITICAL，无本次改动引入的新失败。

---

## Layer 1: Spec-Code 对齐验证（完成标准核查）

fix 模式无 FR 结构，使用 Prompt 定义的 8 条完成标准替代 FR 覆盖率。

| # | 完成标准 | 状态 | 证据 |
|---|----------|------|------|
| 1 | 9 个原子 skill 文件已删除 | PASS | `ls .claude/commands/ \| grep spec-driver` 输出为空（零匹配），git log 7e967c5 diff 确认 9 个文件均被 git rm |
| 2 | `docs/migrations/skill-deprecation.md` 存在且内容完整 | PASS | `ls -la` 确认文件存在（6946 bytes），`wc -l` = 139 行，包含映射表（9 条）+ 示例（3 个）+ FAQ |
| 3 | 相关文档引用已更新 | PASS | 残留扫描显示 plugins/ 内 `/spec-driver.constitution` 等旧格式仅剩 init-project.sh L273 的 glob 模式（`spec-driver.*.md`，属于向后兼容探测，fix-report 明确标注"保留"）和 3 个 SKILL.md 的死代码路径（quality W-01，设计保留）；所有用户可见入口已更新 |
| 4 | CHANGELOG breaking change entry | PASS | CHANGELOG.md L8-12 含 `### Removed — spec-driver BREAKING` + 9 个命令列表 + 迁移指南链接 |
| 5 | `npm run repo:check` 通过 | PASS | exit code 0，40 个检查项全部 pass（含 claude-project-overrides, required-controlled-files, source-skills 等核心项） |
| 6 | `npx vitest run` 通过（除 pre-existing） | PASS | exit code 0，162 测试文件 / 1626 测试用例全部通过，无失败 |
| 7 | `npm run build` 通过 | PASS | exit code 0，TypeScript 类型检查零错误（prebuild inline-d3 内容无变化跳过，tsc 静默完成） |
| 8 | 用户执行 `/spec-driver.specify` 得到 command not found | PASS（间接验证）| `.claude/commands/` 下无任何 spec-driver.*.md 文件（完成标准 1 验证），Claude Code 命令面板由此目录决定，旧命令将不可见 |

**完成标准覆盖率: 8/8（100%）**

---

## Layer 1.5: 验证铁律合规

**状态: COMPLIANT**

implement 阶段（质量审查 quality-review.md）包含以下实际验证证据：
- 引用了 git commit SHA（7e967c5 为阶段 1，50a74f1 为阶段 2）
- 引用了具体文件 diff（`git diff --name-only` + `grep` 采样验证）
- quality-review 中明确验证了 validator 逻辑路径（`validate-wrapper-sources.mjs L144-146`）、wrapper 标记完整性（`grep -rn "do not edit this wrapper directly" .codex/skills/ | wc -l` 确认为 8）

本次 verify 阶段实际运行三条工具链命令，均记录 exit code 和输出摘要（见 Layer 2）。

无推测性表述检测到。

---

## Layer 1.75: 深度检查

### 调用链完整性

关键链路：原子 skill 删除后，编排器 skill 的 prompt 来源映射逻辑通过 fallthrough 仍能正确指向 `$PLUGIN_DIR/agents/{phase}.md`。

- spec-driver-implement / story / resume 的 `prompt_source` 映射：前两个分支（`.claude/commands/spec-driver.{phase}.md` 探测）永远不命中，fallthrough 到 `$PLUGIN_DIR/agents/{phase}.md`。实际行为正确，无断链。
- `init-project.sh` L273 的 `spec-driver.*.md` glob 探测：在本仓库返回空，`detect_spec_driver_skills` 将返回 `HAS_SPEC_DRIVER_SKILLS=false`，符合预期（fix-report 明确标注此路径"保留，向后兼容"）。

**调用链完整，无断点。**

### 数据持久化验证

本 fix 不涉及数据库写入，跳过。

### 配置贯穿验证

涉及的配置项：`wrapper-source-of-truth.yaml` 中 `claudeProjectOverrides.entries: []`。配置从 YAML 文件传递到 `validate-wrapper-sources.mjs` L144-146，`claudeEntries` 为空数组，`missingClaudeOverrides = []`，check 返回 pass。链路完整。

---

## Layer 1.8: 残留扫描

本次改动涉及删除 9 个文件和更新多处引用。执行残留扫描：

**`.claude/commands/` 目录检查**

```
ls .claude/commands/ | grep spec-driver
(无输出)
```

结论：**CLEAN** — 9 个文件已完整删除，无孤立文件。

**`plugins/` 中的旧格式引用扫描**

发现以下命中项，逐一评估：

| 位置 | 内容 | 评估 |
|------|------|------|
| `init-project.sh` L42-43 | `spec-driver.config.yaml` | 配置文件名称，非命令引用，合法 |
| `init-project.sh` L273 | `spec-driver.*.md` glob 模式 | 向后兼容探测，fix-report 明确保留 |
| `spec-driver.config-template.yaml` L2 | 文件路径说明 | 配置文件名称，合法 |
| `spec-driver-story/SKILL.md` L116-121 | `.claude/commands/spec-driver.{phase}.md` 存在性探测 | quality W-01 死代码路径，设计保留作为第三方 override 槽位 |
| `spec-driver-resume/SKILL.md` L101-106 | 同上 | 同上 |
| `spec-driver-implement/SKILL.md` L125-130 | 同上 | 同上 |
| `spec-driver-resume/SKILL.md` L59, L334 | `spec-driver.config-template.yaml` 路径 | 配置模板文件名，合法 |

**结论: CLEAN（无意外残留）** — 所有命中项均为已知保留项（配置文件名 / 向后兼容探测 / 设计保留死代码路径），无需进一步处理。

---

## Layer 1.9: 文档一致性检查

本次改动为架构级变更（删除公共入口命令）。检查文档：

- `README.md`：已将"Individual Phase Commands"段替换为"Orchestrator Skill Commands"，含 9 个编排器命令和迁移指南链接。
- `plugins/spec-driver/README.md`：L76 已修正，命令映射表含"已于 v4.0 弃用"标注，追加 v4.0 变更说明。
- `docs/migrations/skill-deprecation.md`：新建，内容完整。
- `CHANGELOG.md`：新建，含 BREAKING 条目。

**结论: DOC_CONSISTENT** — 架构变更已体现在所有相关文档中，无漂移。

---

## Layer 2: 原生工具链验证

**语言/构建系统**: TypeScript (npm) — 检测到 `package.json` + `package-lock.json`

**注意**: `timeout` 和 `gtimeout` 均不可用（macOS 未安装 GNU coreutils），本次跳过超时前缀保护，直接运行命令。

### npm run repo:check

```
> spectra-cli@3.0.1 repo:check
> node scripts/repo-check.mjs

[repo-check] status=pass
- agent-docs:shared-section:branch-sync-policy: pass
- agent-docs:shared-section:mainline-focus: pass
- agent-docs:shared-section:context-layering: pass
- agent-docs:shared-section:release-contract: pass
- agent-docs:shared-section:repo-maintenance: pass
- agent-docs:shared-section:behavior-rules: pass
- agent-docs:shared-section:code-quality: pass
- marketplace:marketplace-plugin-entries: pass
- marketplace:claude-enabled-plugins: pass
- spec-driver-wrappers:source-skills: pass
- spec-driver-wrappers:codex-wrapper-markers: pass
- spec-driver-wrappers:claude-project-overrides: pass
- spec-driver-wrappers:plugin-metadata-sync: pass
- spectra-skills:canonical-source-skills: pass
- spectra-skills:compatibility-mirrors: pass
- spectra-skills:plugin-metadata-sync: pass
- runtime-boundaries:ignored-runtime-paths: pass
- runtime-boundaries:required-controlled-files: pass
- runtime-boundaries:advisory-and-legacy-paths: pass
- release-contract:* (21 项): 全部 pass
```

- **Exit code**: 0
- **检查项**: 40/40 pass
- **关键项确认**: `claude-project-overrides` pass（entries: [] 对 validator 安全）；`required-controlled-files` pass（spec-driver.implement.md 已从 requiredFiles 移除）；`source-skills` pass（codex wrapper 已 regen 与 source 一致）
- **结论**: **PASS**

---

### npx vitest run

```
Test Files  162 passed (162)
     Tests  1626 passed (1626)
  Start at  15:20:44
  Duration  17.24s (transform 4.02s, setup 0ms, collect 32.81s, tests 51.57s)
```

- **Exit code**: 0
- **总计**: 162 测试文件，1626 测试用例
- **通过**: 162 文件 / 1626 用例（100%）
- **失败**: 0
- **跳过**: 0

**本次改动关联测试确认**（必须绿）:

| 测试文件 | 状态 | 备注 |
|----------|------|------|
| `tests/integration/runtime-boundary-contract.test.ts` | PASS | L47 writeFileSync 已删除，setup 仅创建 `.claude/settings.json`，与更新后 requiredFiles 精确对应 |
| `tests/integration/spec-driver-wrapper-source-truth.test.ts` | PASS | `cpSync` 改为 `mkdirSync`，空目录满足 entries=[] 合同 |
| `tests/integration/spec-driver-init-project.test.ts` | PASS | 测试在临时目录自建文件，不受仓库文件删除影响 |

**pre-existing 失败分析**: 本次运行零失败，无需区分 pre-existing 与新引入。（预期中的 `export-command.test.ts` / tree-sitter.wasm ENOENT 失败均未出现，测试套件完全通过。）

- **结论**: **PASS**

---

### npm run build

```
> spectra-cli@3.0.1 prebuild
> tsx scripts/inline-d3.ts
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入

> spectra-cli@3.0.1 build
> tsc
```

- **Exit code**: 0
- **TypeScript 类型错误**: 0
- **备注**: 初次运行因 worktree node_modules 未完整安装报 d3-force ENOENT，执行 `npm install --prefer-offline` 后重试成功。此为 worktree 环境问题，非本次改动引入。
- **结论**: **PASS**

---

## Tasks → Commit 映射

spec-review WARNING-1 指出 tasks.md 所有 checkbox 未勾选，与实际完成状态不符。编排器决策：不改 tasks.md（保持规划产物语义），由本报告提供 tasks→commit 映射作为记录保真。

### Commit 7e967c5（Phase 1：核心事实建立）

| 任务 | 描述 | 状态 |
|------|------|------|
| T001 | 删除 `.claude/commands/spec-driver.analyze.md` | 完成（git rm，-184 行）|
| T002 | 删除 `.claude/commands/spec-driver.checklist.md` | 完成（git rm，-294 行）|
| T003 | 删除 `.claude/commands/spec-driver.clarify.md` | 完成（git rm，-181 行）|
| T004 | 删除 `.claude/commands/spec-driver.constitution.md` | 完成（git rm，-84 行）|
| T005 | 删除 `.claude/commands/spec-driver.implement.md` | 完成（git rm，-135 行）|
| T006 | 删除 `.claude/commands/spec-driver.plan.md` | 完成（git rm，-89 行）|
| T007 | 删除 `.claude/commands/spec-driver.specify.md` | 完成（git rm，-258 行）|
| T008 | 删除 `.claude/commands/spec-driver.tasks.md` | 完成（git rm，-137 行）|
| T009 | 删除 `.claude/commands/spec-driver.taskstoissues.md` | 完成（git rm，-30 行）|
| T010 | 清空 `wrapper-source-of-truth.yaml` claudeProjectOverrides.entries | 完成（-22 行改为 entries: []）|
| T011 | 移除 `runtime-boundary-contract.yaml` spec-driver.implement.md 条目 | 完成（-1 行）|
| T012 | 修改 `runtime-boundary-contract.test.ts` 删除 writeFileSync setup | 完成（-1 行）|

### Commit 50a74f1（Phase 2：一致性恢复）

| 任务 | 描述 | 状态 |
|------|------|------|
| T013 | 修改 `spec-driver-constitution/SKILL.md` 触发方式段 | 完成（-2/+2 行）|
| T014 | 修改 `spec-driver-implement/SKILL.md` L74 引用 | 完成（-1/+1 行）|
| T015 | 修改 `spec-driver-resume/SKILL.md` constitution 引用 | 完成（-1/+1 行）|
| T016 | 修改 `spec-driver-story/SKILL.md` constitution 引用 | 完成（-1/+1 行）|
| T017 | 修改 `plugins/spec-driver/agents/constitution.md` L99 | 完成（-1/+1 行）|
| T018 | 修改 `init-project-output.sh` L56 constitution 引用 | 完成（-1/+1 行）|
| T019 | 修改 `check-prerequisites.sh` L105/L111/L118 三处 | 完成（-3/+6 行）|
| T020 | 修改 `plan-template.md` 原子命令引用中性化 | 完成（-8/+6 行）|
| T021 | 修改 `tasks-template.md` L32 中性化 | 完成（-1/+1 行）|
| T022 | 修改 `checklist-template.md` L7/L13 中性化 | 完成（-2/+2 行）|
| T023 | 修改 `README.md` L499-527 替换命令参考段 | 完成（-23/+21 行）|
| T024 | 修改 `plugins/spec-driver/README.md` L76 + 命令映射表 | 完成（-8/+14 行）|
| T025 | 新建 `docs/migrations/skill-deprecation.md` | 完成（+139 行）|
| T026 | 追加 `CHANGELOG.md` breaking change 条目 | 完成（+31 行）|
| T027 | 执行 `npm run codex:spec-driver:install` regen 4 个 wrapper | 完成（8 个 wrapper 均 regen，constitution/implement/resume/story 有内容变更，doc/feature/fix/sync 仅删除 Project overrides 行）|

### Final Phase（T028–T034）：本次 verify 运行填充

| 任务 | 描述 | 状态 |
|------|------|------|
| T028 | `npm run repo:check` — exit 0，40 项全 pass | 完成 |
| T029 | `npx vitest run` — exit 0，162 文件 / 1626 测试全绿 | 完成 |
| T030 | `npm run build` — exit 0，TS 类型零错误 | 完成 |
| T031 | `ls .claude/commands/ \| grep spec-driver` — 零输出 | 完成 |
| T032 | Claude Code 命令面板间接验证（`.claude/commands/` 无文件） | 完成（间接）|
| T033 | `spec-driver-constitution/SKILL.md` 和 codex wrapper 触发方式段确认 | 完成（git diff 50a74f1 确认 `/spec-driver:spec-driver-constitution` 已正确设置）|
| T034 | 残留扫描 — 旧格式引用均为已知保留项，无意外残留 | 完成 |

---

## Layer 1.5: WARNING 收敛状态

| 来源 | WARNING | 本次验证状态 |
|------|---------|------------|
| spec W-1 | tasks.md checkbox 未勾选 | 通过 verification-report 的 tasks→commit 映射补偿（见上节），tasks.md 保持规划产物语义不改 |
| spec W-2 | 版本号 bump 未处理 | 明确留待独立 release PR（通过 `contracts/release-contract.yaml` + `npm run release:sync` 执行），不阻断本次合并 |
| spec W-3 | `plugins/spec-driver/README.md` L54/L378 措辞（"spec-driver:spec-driver-constitution SKILL"用词略显冗余） | 低优先级技术债，不处理，不阻断 |
| quality W-01 | 3 个 SKILL.md 的 `.claude/commands/spec-driver.{phase}.md` 探测分支 | 确认为设计保留：保留作为"第三方项目自定义 override 槽位"（用户在自己项目中仍可创建覆盖文件），与合同 `wrapper-source-of-truth.yaml` 的 `claudeProjectOverrides.note` 描述一致，不构成功能回归 |
| quality W-02 | `check-prerequisites.sh` L118 改 `--entry-point=tasks` | **已验证落地**：`grep -n "entry-point"` 确认 L118 = `Run /spec-driver:spec-driver-implement --entry-point=tasks first to create the task list.` |
| quality W-03 | CHANGELOG 子节名改为 Keep a Changelog 标准 | **已验证落地**：CHANGELOG.md 含 `### Removed — spec-driver BREAKING`（L8）、`### Changed — spec-driver`（L13）、`### Added`（L28）。注意子节名采用了"标准前缀 + 自定义后缀"格式（如 `### Removed — spec-driver BREAKING`），略偏离纯 KaC 格式（仅 `### Removed`），但相比 quality-review 时的 `### spec-driver — BREAKING` 已向标准靠拢，语义清晰。如需完全符合 KaC，可在 release PR 中进一步修正。 |

---

## 风险与遗留问题（已知，不阻断合并）

1. **quality W-01 死代码路径**：`spec-driver-implement/story/resume` 三个 SKILL.md 保留了 `.claude/commands/spec-driver.{phase}.md` 存在性探测分支。当前行为正确（fallthrough 到 `$PLUGIN_DIR/agents/{phase}.md`），仅增加维护者阅读负担。建议在后续独立 INFO 级清理任务中简化或加注释。

2. **版本号 bump**：CHANGELOG 记录为 `[Unreleased]`，breaking change 应触发 spec-driver major version bump（建议 v4.0.0）。留待独立 release PR 通过 `npm run release:sync` 处理。

3. **CHANGELOG 子节格式**：当前使用 `### Removed — spec-driver BREAKING` 而非纯粹的 `### Removed`，为轻微格式偏差，可在 release PR 中补正。

4. **worktree node_modules 不完整**：build 首次运行失败（d3-force ENOENT），需 `npm install --prefer-offline` 补全。为 worktree 环境问题，非改动引入。

---

## 最终建议

**本 Feature 可合并**（PASS_WITH_WARNINGS）。

### 后续 release PR 待办项

1. 更新 `contracts/release-contract.yaml` spec-driver 版本至 4.0.0，运行 `npm run release:sync`
2. 可选：将 CHANGELOG `[Unreleased]` 标记为正式版本节点，子节名纯化为标准 KaC 格式
3. 可选（INFO 级）：简化 3 个 SKILL.md 的 `prompt_source` 映射，移除死代码路径或添加注释说明保留原因
