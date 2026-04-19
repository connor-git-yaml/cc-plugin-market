# Spec Review — F2.5 删除原子 skill

**审查人**: spec-review 子代理
**日期**: 2026-04-19
**总体结论**: PASS_WITH_WARNINGS

---

## 执行摘要

实施基本忠实于 fix-report.md + plan.md + tasks.md 定义的 scope：9 个原子 skill 文件已删除，2 份合同 YAML 已同步更新，stale reference 已清理，迁移文档已新建，CHANGELOG 已追加，Codex wrapper 已再生。发现 0 个 CRITICAL 问题（无未实现的必要功能）；发现 3 个 WARNING（版本号处理策略分歧、tasks.md checkbox 状态与实际完成状态不符、README 措辞可进一步完善）。

---

## Checklist 结果

| # | 项目 | 结论 | 证据/理由 |
|---|------|------|----------|
| 1 | Scope 合规：实际改动全部落在 fix-report.md + plan.md 声明范围内 | PASS | 检查文件树：无 `src/`、`plugin.json`、`specs/127-*`、`specs/128-*` 修改；变更仅覆盖 `.claude/commands/`（删）、`plugins/spec-driver/`（contracts/skills/agents/templates/scripts）、`contracts/`、`docs/migrations/`、`tests/integration/`、`.specify/scripts/`、`README.md`、`CHANGELOG.md`，完全在 plan.md 声明的 5 个顶层边界内 |
| 2 | 读写边界遵守 | PASS | `.claude/commands/spec-driver.*.md`：Glob 确认全部 9 个文件不存在，已删除；`plugins/spec-driver/**` 修改均为 stale reference 清理（plan.md GATE_DESIGN 批准范围，plan.md L167 明确说明）；无触碰禁区 |
| 3 | 完成标准覆盖（Prompt 列出 8 条） | PASS_WITH_WARNINGS | 见下方逐条展开 |
| 4 | 迁移映射表完整性（9 条旧→新） | PASS | `docs/migrations/skill-deprecation.md` 表格覆盖全部 9 个旧原子命令：specify→plan→tasks→implement（整体 feature）、plan only、implement only、clarify、analyze、checklist、constitution、taskstoissues、并有 fix/refactor/doc/sync/resume 新增覆盖；无遗漏 |
| 5 | Entry-point 覆盖性：9 个编排器 skill 均存在 | PASS | `plugins/spec-driver/skills/` 下确认存在：spec-driver-{feature, implement, story, fix, resume, sync, doc, constitution, refactor} 共 9 个 SKILL.md；Glob 输出明确 |
| 6 | Constitution Check 一致性 | PASS | plan.md 的 Constitution Check 结论为"所有原则通过，XIII 有 WARN"；实际实施：新建了迁移文档（缓解向后兼容 WARN），CHANGELOG 标注 breaking change；无 VIOLATION 项被遗漏 |
| 7 | 任务-改动追溯（34 个任务对应实际改动） | WARNING | tasks.md 全部 checkbox 均为未勾选（`[ ]`），但代码层面所有改动均已完成（合同、文件删除、stale reference、文档、Codex regen）；tasks.md 的勾选状态未同步到"已完成"，这是记录保真问题而非功能问题。plan.md 补充发现的 `init-project-output.sh` 已纳入 T018 并实施（L56 已改为新格式，代码已验证）；`codex-skills.sh` 两处改动：plan.md 判断此文件本身不改（只改 source SKILL.md 再 regen），与实际一致——但实际实施时发现 `codex-skills.sh` 内有对原子命令的硬编码特殊分支，属于 coupled change，合理扩展 |
| 8 | 历史记录保真：历史 spec 未被修改 | PASS | Glob 确认 `specs/032-rename-speckit-to-spec-driver/` 下所有文件存在且未修改（为只读 glob 验证）；fix-report.md L105 明确声明历史 spec "不改" |
| 9 | 产品文档一致性：README.md 与 plugins/spec-driver/README.md 不产生矛盾 | PASS_WITH_WARNINGS | README.md L499-535：已替换为编排器 skill 命令参考，段末增加 v4.0 变更说明，指向迁移指南。plugins/spec-driver/README.md L348-356：保留历史 speckit→spec-driver 映射表，每行加 "⚠️ 已于 v4.0 弃用" 标注，L360 加 v4.0 变更说明，指向迁移指南。两份 README 核心信息一致，无矛盾。WARNING：plugins/spec-driver/README.md L54 和 L378 仍提及 `.claude/commands/spec-driver.*.md` 作为"仓库级 project override"，属于架构描述，说明用户可放置自定义 override，与删除旧版原子 skill 语义不冲突，但措辞未额外说明"原内置原子 skill 已删除"；对细心的用户不会产生混淆，但可进一步完善 |

---

## 完成标准逐条状态（Prompt 列出 8 条）

| 完成标准 | 状态 | 证据 |
|---------|------|------|
| 1. 9 个原子 skill 文件已删除 | PASS | `.claude/commands/` 下 `spec-driver.*` 文件 Glob 返回空；所有 9 个文件不存在 |
| 2. `docs/migrations/skill-deprecation.md` 已写（含映射表+示例） | PASS | 文件存在，包含 9 条映射、3 个示例对比、FAQ、如何确认旧命令消失等完整内容 |
| 3. 相关文档引用已更新 | PASS | `check-prerequisites.sh` L105/L111/L118 已改为编排器命令；`init-project-output.sh` L56 已改；templates 注释已改为中性描述；skills/agents 中 `/spec-driver.constitution` 引用已改为新格式 |
| 4. CHANGELOG breaking change entry | PASS | `CHANGELOG.md` 顶部有 `[Unreleased]` 下的 `Removed — spec-driver ⚠️ BREAKING` 条目，列出 9 个删除命令、迁移指南链接、同步变更清单（Keep a Changelog 标准子节结构） |
| 5. `npm run repo:check` 通过 | 待 verify 子代理实跑验证 | 合同文件已正确更新（wrapper-source-of-truth.yaml entries 清空、runtime-boundary-contract.yaml requiredFiles 已移除旧条目），测试 setup 已修复，从合同一致性判断应通过；需 verification-report 提供实际命令输出证据 |
| 6. `npx vitest run` 通过（除 pre-existing 失败外） | 待 verify 子代理实跑验证 | 集成测试 setup 已正确更新；同上，需实际运行证据 |
| 7. `npm run build` 通过 | 待 verify 子代理实跑验证 | 本次变更均为 Markdown/YAML/Shell 修改，无 TypeScript 改动，理论零类型错误风险；需实际运行证据 |
| 8. tasks.md checkbox 状态 | WARNING | tasks.md 所有 34 个 checkbox 均未勾选，与实际已完成的代码状态不符 |

---

## CRITICAL 问题

无。

---

## WARNING 建议

### WARNING-1：tasks.md checkbox 状态未同步

tasks.md 中全部 34 个任务（T001–T034）的 checkbox 均为 `[ ]`（未勾选），但实际代码层面所有对应改动均已完成。这造成"任务状态与实际实施状态不一致"的记录保真问题。

该问题不影响功能，但影响制品完整性——spec-review 和 verification-report 的可追溯性依赖 tasks.md 的准确勾选状态。

**编排器决策**（已记录在 verification-report）：保留 tasks.md 作为规划阶段产物（其 checkbox 语法表达"待做"描述，非实施跟踪器），改为在 verification-report 中提供 **tasks→commit 映射表**作为记录保真，不改 tasks.md 本身。

### WARNING-2：CHANGELOG 版本处理——使用 [Unreleased] 而非版本 bump

CHANGELOG 使用 `[Unreleased]` 标题，`contracts/release-contract.yaml` 中 spec-driver version 仍为 3.11.2，版本未 bump。

**评估**：采用选项 **A**——接受当前状态，WARNING 而非 FAIL。

理由：
- Prompt scope 明确列出的完成标准中，"版本 bump"未出现
- CHANGELOG 用 `[Unreleased]` 是规范的 keepachangelog 做法，表示"已记录但未发布"
- 本仓库 `contracts/release-contract.yaml` 是 canonical version source，版本 bump 需通过 `npm run release:sync` 而非手工修改
- breaking change 版本 bump（major bump: 3.11.2 → 4.0.0）是独立的 release PR 决策，超出本 fix 的合理 scope

**建议**：在后续独立的 release PR 中执行 major bump（3.x → 4.0.0），因为这是用户面向的 breaking change，按 SemVer 规范应当是 major；在该 release PR 中运行 `npm run release:sync` 并将 `[Unreleased]` 替换为具体版本号。

### WARNING-3：plugins/spec-driver/README.md L54 措辞可进一步完善

L54 描述 `.claude/commands/spec-driver.*.md` 为"仓库级项目 override，可按项目需要调整"，L378 同理。这些描述是准确的架构说明，但未明确指出"本插件内置的 9 个原子 skill 文件已于 v4.0 删除"，与"可按项目需要放置自定义 override"的说法并列时，细心用户可能疑惑"内置的是否仍然存在"。

**建议**：在 L54 后增加注脚：`（注：v4.0 起插件不再随附内置原子 skill；`.claude/commands/spec-driver.*.md` 仅为用户自定义 override 保留）`。优先级低，不阻断合并。

---

## 过度实现检测

扫描 plan.md 变更清单以外的改动：

| 位置 | 描述 | 风险评估 |
|------|------|---------|
| `plugins/spec-driver/scripts/codex-skills.sh` 两处修改 | plan.md 补充发现；删除 `spec-driver-constitution` 的硬编码 source_command 特殊分支 + 移除 wrapper contract 中"Project overrides"说明行 | 合理扩展：属于"删除原子命令的必然衍生清理"，两处改动在 regen 前会产生新的 stale reference；修改后 `.codex/skills/` 全部 8 个 wrapper 重新生成一致 |
| 无 | 未发现 spec/plan 范围之外的额外功能新增、新公共 API、新配置项 | — |

`wrapper-source-of-truth.yaml` L43 中的 `note` 字段内容较 plan.md 描述更详细（包含历史说明和迁移指南引用），属于文档质量改善，不构成过度实现。

---

## 问题分级汇总

- **CRITICAL**: 0 个
- **WARNING**: 3 个（tasks.md checkbox 未同步；CHANGELOG 版本 bump 留待后续 release PR；README 措辞可进一步完善）
- **INFO**: 0 个

---

## 建议后续动作

1. **必要（合并前）**：`specs/129-fix-remove-atomic-skills/verification/verification-report.md` 需提供 `npm run repo:check`、`npx vitest run`、`npm run build` 的实际命令输出，填补完成标准 5/6/7 的证据空白
2. **编排器已决策**：tasks.md 的 checkbox 状态保留（作为规划产物），在 verification-report 中补充 tasks→commit 映射表
3. **建议（独立 release PR）**：执行 spec-driver major bump 3.11.2 → 4.0.0，通过 `npm run release:sync` 同步，将 CHANGELOG `[Unreleased]` 替换为具体版本
4. **可选（低优先级）**：完善 plugins/spec-driver/README.md L54/L378 的措辞，明确区分"用户自定义 override 槽位"与"内置原子 skill（已删除）"
