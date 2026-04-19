# Addendum — Codex Adversarial Review Follow-up

**日期**: 2026-04-19
**触发**: `/codex:adversarial-review` 在 F2.5 初始 6 个 commit 之后运行
**评估**: Codex 给出 `needs-attention` 判定并指出 2 个 high-severity finding；两个 finding 经独立验证**均合理**，已在同一 PR 内修复

---

## Finding 1（HIGH）— `--entry-point` 参数在文档中被大量引用但编排器从未实现

### Codex 原始发现

`check-prerequisites.sh`、顶层 README、迁移指南均建议用 `/spec-driver:spec-driver-implement --entry-point=plan|tasks` 来恢复缺失的 plan.md / tasks.md；但 `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` L21-42 明确定义触发方式只接受 `<feature-dir-or-id>` 和 `--preset`，并声明"本命令**不接受** `--rerun`、`--sync`、需求描述文本"。全仓 grep `entry-point` 只在文档/模板命中，**零**实现命中。

### 独立验证

```bash
# 确认 SKILL.md L21-42 的触发方式定义
# 确认 grep -rn "entry-point" plugins/spec-driver/{skills,agents,scripts} 无代码命中
grep -rn "entry-point" plugins/spec-driver/skills plugins/spec-driver/agents plugins/spec-driver/scripts
# 结果：0 行
```

结论：Finding 合理。这是我（编排器）在 Phase 2 规划时从用户 Prompt 的迁移映射表里**直接复制**了 `--entry-point=plan`，没有验证该参数是否真的被 implement skill 实现。在后续 quality-review W-02 中我还把 check-prerequisites.sh L118 改为了 `--entry-point=tasks`，进一步扩散了这个不实在的参数。这是一个"文档承诺的能力在代码中不存在"的典型漂移。

### 修复策略

**不实现** `--entry-point` 参数（超出本 fix scope，属于新功能），而是从所有面向用户的文档中**撤回**该参数引用，改用编排器现有的恢复路径：

- **用户只想恢复某阶段制品** → `/spec-driver:spec-driver-resume`（扫描特性目录，从中断处继续）
- **用户需要完全重跑** → `/spec-driver:spec-driver-feature <需求>`

### 实际改动

| 文件 | 改动 |
|------|------|
| `.specify/scripts/bash/check-prerequisites.sh` | L111/L118 从 `--entry-point=plan/tasks` 改为 `spec-driver-resume`（或 `spec-driver-feature` 如果 spec 也缺失） |
| `README.md` | 移除"只跑 plan phase"示例行 + 段首"single-phase control"说法改为"selectively re-run → resume / re-plan → feature" |
| `plugins/spec-driver/templates/specify-base/plan-template.md` | 删除 L6 对 `--entry-point=plan` 的举例 |
| `docs/migrations/skill-deprecation.md` | 映射表"只跑 plan"条目改为 `resume` 或 `feature`；示例 2 重写；FAQ 增补"如何只重跑某一个阶段"说明该参数未实现 |
| `CHANGELOG.md` | 移除"改为 `--entry-point={plan,tasks}`"描述，改为"`spec-driver-feature`（缺特性目录）与 `spec-driver-resume`（仅缺 plan/tasks）" |

### 为何不实现 `--entry-point`？

- 超出本 fix 的 scope（fix skill 模式要求最小化改动）
- 需要同步改造 `spec-driver-implement` 的参数解析 + orchestration.yaml 的 entry-point 配置 + 新增集成测试
- 编排器现有能力（`resume` + `feature`）已覆盖"恢复缺失制品"场景，无实质 feature gap
- 可作为独立 feature PR 跟进（如果用户验证后确认需要）

---

## Finding 2（HIGH）— 契约声明 Claude 原子 override 已废弃但 runtime 仍加载，测试不再捕获漂移

### Codex 原始发现

本 fix 清空了 `claudeProjectOverrides.entries` 并撤下测试对 `.claude/commands/` 的 setup，声称"这些文件已无意义"。但 `spec-driver-implement`、`spec-driver-story`、`spec-driver-resume` 三个 SKILL.md 的 `prompt_source` 逻辑仍然在 `.claude/commands/spec-driver.{phase}.md` 存在时**优先读取**它（高于内置 `$PLUGIN_DIR/agents/{phase}.md`）。结果：用户仓库里只要残留或自定义了原子 override 文件，就会继续走**陈旧**的 phase prompt，**而且**因为契约/测试同时被放宽，这种 silent version skew 不再被校验套件捕获。

### 独立验证

```bash
# 确认 3 个 SKILL.md 里的 fallback 分支
grep -n "\.claude/commands/spec-driver\." plugins/spec-driver/skills/spec-driver-{implement,resume,story}/SKILL.md
```

结果：3 个文件共 6 处命中（每个 SKILL.md 里 2 层 else-if 分支：runtime-match 优先级 + 通用 fallback）。

migration guide 写过：
> "v4.0 后编排器已不再读取它们"

—— 这句话在修复前**是错的**。

### 修复策略

**选项 A（激进，已采用）**：删除 3 个 SKILL.md 的 `.claude/commands/` 和 `.codex/commands/` fallback 分支，统一为 `$PLUGIN_DIR/agents/{phase}.md`，让文档与实现对齐。

**选项 B（保守，拒绝）**：保留 fallback，在文档里标注"已废弃但仍读取"。拒绝理由：
- 违反"删除即干净"的 v4.0 定位
- silent version skew 是真实故障路径，保留 = 留 bug
- `.codex/commands/spec-driver.{phase}.md` 路径**历史上从未存在**，保留是纯粹的 dead code

### 实际改动

| 文件 | 改动 |
|------|------|
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | L119-135 prompt_source 段简化为直接 `$PLUGIN_DIR/agents/{phase}.md`，补充 v4.0 变更说明段 |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | L95-114 相同简化 |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | L110-127 相同简化 |
| `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` | `claudeProjectOverrides.note` 从"Reserved for project-level overrides" 改为 "Kept for directory structure only ... will be ignored by the runtime" |
| `plugins/spec-driver/README.md` | L54（资产分类）+ L280（"命令覆盖双端兼容"）+ L378（目录结构）三处说法与 v4.0 实现对齐 |
| `docs/migrations/skill-deprecation.md` | "自定义命令文件"段从"不再读取"加强为"即使存在也不会被读"，补充"为何不再保留 .claude/commands/ 作为 override 入口"解释段 |
| `.codex/skills/spec-driver-{implement,resume,story}/SKILL.md` | 通过 `npm run codex:spec-driver:install` 从更新后的 source 重新生成 |

### 隐含 Breaking Change 补丁

本修复连带**移除**了 v3.x 用户自定义 phase prompt override 的能力——之前用户可以通过放置 `.claude/commands/spec-driver.plan.md` 覆盖 plan phase 的 prompt。v4.0 起这一通道被关闭，唯一定制路径是编辑 `plugins/spec-driver/agents/{phase}.md` 后重装插件。

此变更已在 migration guide 明确告知，并补充了"为何"解释段。严格按 SemVer，这进一步强化了本 Feature 的 BREAKING 属性。

---

## 验证

修复后三连：

```
npm run repo:check    → status=pass（40/40 项）
npx vitest run        → 162/162 files, 1626/1626 tests
npm run build         → exit 0
```

残留扫描（仅保留弃用/说明性引用，无 active reference）：
- `--entry-point` 残留 2 处：均为 migration guide 中"该参数未实现，请改用 X"的告知性说明
- `.claude/commands/spec-driver.*.md` 残留 4 处：wrapper-source-of-truth.yaml note + plugins/spec-driver/README.md 两处资产分类 + SKILL.md 的"v4.0 变更说明"，均为弃用记录

---

## 对原 verification-report 的修正

原 verification-report 宣告"8/8 完成标准 PASS"与"所有审查 0 CRITICAL"。Codex adversarial review 暴露了两个被 sonnet spec-review / quality-review 子代理漏掉的 HIGH 问题。经验教训：

1. **并行子代理存在盲点**：sonnet 级 spec-review/quality-review 在"文档-实现一致性"维度覆盖不足，特别是对"文档里写的参数/路径，代码是否真的支持"这类需要跨文件追踪的问题。Codex（GPT-5.4）以独立视角发现了这两个 drift。
2. **adversarial review 是 review layer 的必要补充**：对于 BREAKING change 性质的 PR，建议把 adversarial review 作为 Phase 4 的强制环节（当前是用户手动触发）。
3. **从 Prompt 字面复制可能引入新问题**：我在 Phase 2 复制用户 Prompt 的 `--entry-point` 条目时没验证实现，导致错误扩散到 5 个文件。今后类似"引用一个具体参数/路径"的改动都应做存在性校验（grep 实现代码）。

---

## 最终结论

两个 HIGH finding **均合理**，**均已修复**，**均在同一 PR 内闭环**。

修复 scope（13 files changed）在 Prompt 定义的读写边界内（`plugins/spec-driver/**` 修改严格对应 Codex 指出的"删除动作必然衍生的数据一致性"路径，延续 GATE_DESIGN 批准的 coupled change 范围）。

Addendum 产物：本文件 + 对应 commit。
