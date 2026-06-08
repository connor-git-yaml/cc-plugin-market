# Spectra / spec-driver — Codex 适配约定

本文件定义在 Codex 中运行本仓库能力时的统一约束，目标是在不牺牲现有功能语义的前提下保持双端兼容（Claude Code + Codex）。

## 1. 入口映射

- `spectra` 能力优先走 CLI：单模块 `spectra generate`、批量 `spectra batch`、漂移 `spectra diff`
- Spec Driver Codex 包装技能：`npm run codex:spec-driver:install` 或 `bash plugins/spec-driver/scripts/codex-skills.sh install`

## 2. Spec Driver 兼容执行

`plugins/spec-driver/skills/*/SKILL.md` 主流程不变；缺少 `Task tool` 时回退为内联子代理调用，读取 `agents/<phase>.md`，并行组回退串行并标注 `[回退:串行]`。模型选择：`--preset → agents.{id}.model → preset 默认`，通过 `model_compat` 做运行时映射。

## 3. 产物与门禁不变性

- 目录/文件命名保持原样（`specs/<feature>/...`）；质量门语义不弱化；写操作仅限产物路径
- `plugins/**` 是 canonical source；`.codex/` `.claude/` 是分发包装层，改 source 后重新生成
- `.specify/runs/` 属本地运行态；`.claude/commands/**` 属受控 override

## 4. 版本号规范

SemVer：patch（fix）、minor（feature）、major（breaking）。适用于所有插件 `plugin.json`。

## 5. 优先级

SKILL.md 阶段定义 → agents/*.md 和 templates 细节 → 平台差异仅体现在调度方式

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-behavior-rules.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: behavior-rules -->
## 行为与交互约定

- 不要自行添加未要求的优化、功能、清理或重构；原因：spec、gate 和生成合同会放大任何额外改动的验证面
- 不要猜测需求、实现或上下文；原因：猜测会污染事实源。查不到就明确说"不知道"
- 不要在没完整看过目标文件前直接动代码；原因：本仓库存在 source-of-truth 和包装层同步链路，盲改风险高
- 不要把审查理解成"证明它能跑"；原因：review 和验证默认先找漏洞、异常分支、回归和合同漂移
- 不要把核心判断交给子代理；原因：执行可分发，但关键取舍和最终结论必须在主线程收口
- 不要把一次授权当成长期授权；原因：执行脚本、rebase、push 等都只对当次任务生效
- 不要一次性抛出全部背景和工具说明；原因：上下文按需供给，避免噪声
- 不要混用不同场景规则；原因：feature、fix、review、doc 的门禁和产物不同，按对应 skill / phase 加载
- 不要擅自改字段名、层级或标点格式；原因：Markdown/YAML/JSON 合同和脚本解析依赖精确字面值
- 不要把 prompt 或规范写成无结构长段；原因：目标、约束、验证要模块化
- 不要优先用通用工具；原因：先用仓内脚本、skill、contract 和 shared helper，再退回 shell
- 不要用学术或实现术语堆砌让用户拍板的问题；原因：决策权在用户，提问要从产品 / 用户视角通俗讲清这个选择对用户的实际影响，少纠缠实现细节，不假定用户读过你引用的代码或文档（确实复杂讲不清时再请其去看）；通俗达意即可、不必刻意大白话或堆砌口语，否则用户只能凭感觉选或被动接受
<!-- END SHARED SECTION: behavior-rules -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-context-layering.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: context-layering -->
- `AGENTS.md` / `CLAUDE.md` 只放默认会进入上下文、且跨任务稳定的仓库级规则
- `.specify/project-context.yaml` 是 canonical Project Context；`.specify/project-context.md` 仅作为 legacy fallback，二者都只放项目级长期偏好、约束与参考资料，不承载 Spec 级执行策略
- 某条规则若在不使用 Spec Driver Skill 时也必须生效，就不应只写在 `Project Context`
- 成熟 `spec/plan` 的执行裁剪，应进入 `spec-driver-implement` 或具体 feature 制品，而不是写进 `Project Context`
<!-- END SHARED SECTION: context-layering -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-release-contract.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: release-contract -->
## 发布合同约定

- 版本、plugin metadata、marketplace entry、产品级 release 文案的 canonical source 在 `contracts/release-contract.yaml`
- 需要更新这些字段时，优先改 contract，再运行 `npm run release:sync`
- 不要手工分别修改 `plugin.json`、`marketplace.json`、`package-lock.json`、README 里的受控 release 行
- 提交前运行 `npm run release:check`；仓库级 `check-plugin-sync.sh` 也会复核 release contract
<!-- END SHARED SECTION: release-contract -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-repo-maintenance.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: repo-maintenance -->
## 仓库级同步约定

- 触及 source-of-truth、包装层、共享片段、产品生成产物后，优先运行 `npm run repo:sync`
- 提交前运行 `npm run repo:check`；仓库级 `check-plugin-sync.sh` 已退化为对该校验链路的薄壳调用
- `.specify/runs/`、`.specify/.spec-driver-path`、`.claude/settings.local.json` 属于本地运行态，保持忽略，不要当作长期人工事实源
- `.claude/commands/**`、`.specify/project-context.yaml`、`.specify/templates/**` 属于受控项目层，修改前先确认不是某个 contract/sync 入口的生成产物
<!-- END SHARED SECTION: repo-maintenance -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-branch-sync-policy.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: branch-sync-policy -->
## 分支同步与交付约定

### 开发中的分支同步

- `feature/*`、`fix/*` 等开发分支在提交前，必须先同步最新 `master`
- 同步方式统一使用 `git rebase master`，不要把 `master` 直接 merge 回开发分支
- 推荐流程：`git checkout master` → `git pull --ff-only` → `git checkout <feature-or-fix-branch>` → `git rebase master`
- rebase 后先解决冲突并完成必要验证，再执行 commit / push
- 如果分支已经推送到远端，rebase 改写历史后使用 `git push --force-with-lease`

### 交付到 master

- 本项目统一采用 **Rebase + Push Origin Master** 方式交付：所有 `feature/*`、`fix/*` 分支的最终集成都通过 "rebase 到 master + fast-forward push 到 `origin master`" 完成，保持 master 历史线性
- 禁止使用 merge commit 交付（不使用 `git merge <feature-branch>`，也不使用 GitHub PR 的 "Create a merge commit" 按钮）；如果必须经由 PR 流程，统一选 "Rebase and merge"
- 交付硬性顺序（任一步失败必须停止）：(1) `git fetch origin master:master` → (2) `git rebase master` → (3) 本地跑 `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check`（如涉及发布）零失败 → (4) `git checkout master` + `git merge --ff-only <branch>` → (5) `git push origin master`
- 交付后立即删除本地和远端的 feature/fix 分支（`git branch -d <branch>` + `git push origin --delete <branch>`），避免分支膨胀
- Push 到 `origin master` 是破坏性 + 不可回滚操作（团队其他人可能已经基于新 master 工作），必须获得用户明确授权，且一次授权只对当次交付生效（沿用"不要把一次授权当成长期授权"原则）
- 多人并行的 feature/fix 分支交付时，先交付的先 push；后交付的必须重新 rebase 最新 master 并重跑验证才能 push，不允许 force push master
<!-- END SHARED SECTION: branch-sync-policy -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-code-quality.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: code-quality -->
## 代码质量与架构约定

### 简洁之道

- 每次改动都以"如果今天从零写这段代码，我会怎么写"为出发点审视现有实现；遇到坏味道就地修正，不留给下一个 PR
- 函数 / 方法保持单一职责；过长的函数优先考虑拆分为可独立测试的子函数
- 命名即文档：变量名、函数名、类型名应准确表达意图，避免 `data`、`info`、`temp`、`handler` 等语义模糊的命名
- 不写注释能看懂的代码不需要注释；必须写注释时说明 **why**，而不是 **what**
- 消除重复：发现相同逻辑在多处出现时，考虑提取为共享函数或工具方法
- 优先采用尽早 return / 提前退出的写法，减少不必要的嵌套
- 删除死代码、未使用的导入和注释掉的代码块；版本历史由 git 负责

### 零基思维

- 新增模块时，先问"这个模块和现有哪个模块的职责边界在哪"；职责模糊时先理清边界再写代码
- 重构时不追求最小改动；如果当前架构已经偏离合理状态，一步到位调整到正确结构
- 不在错误的抽象上叠加 workaround；发现底层抽象不对时，先修正抽象再实现功能
- 类型系统是第一道防线：优先用 TypeScript 类型约束表达不变量，而非运行时检查

### 提交前验证

- 提交前必须执行全量单元测试 `npx vitest run` 并确认零失败；测试不过不允许提交
- 提交前必须执行 `npm run build` 确认类型检查零错误
- 新增功能或修复 bug 时，对应的单元测试必须在同一个提交中包含

### 模型选择策略

按"质量优先 + 成本可控"原则分场景选择模型：

- **生产代码（implement / 修复 / 重构）**：尽量使用 **Opus**（claude-opus-4-7）保证质量。生产代码的 bug 在 review/test 阶段不一定能完全捕获，错误成本高于 LLM 调用成本
- **测试场景（验证 / 端到端测试 / fixture 跑 batch）**：使用 **Sonnet**（claude-sonnet-4-6）节约 token，因为测试目的是验证流程通畅、暴露问题，不需要最强模型
- **设计阶段（specify / plan / tasks）**：默认 Sonnet 即可；复杂架构决策可临时升 Opus
- **诊断阶段（fix-report 5-Why 根因追溯）**：使用 Opus（spec-driver-fix 已默认如此）
- **审查阶段（spec-review / quality-review / verify）**：默认 Sonnet 即可；critical 项目可升 Opus

实施时通过 spec-driver.config.yaml 的 `agents.{agent_id}.model` 配置控制；临时覆盖用 `--preset quality-first`（全局升 Opus）。**禁止把成本作为约束牺牲生产代码质量** — Opus 调用即使贵 5x，少一个生产 bug 就回本。
<!-- END SHARED SECTION: code-quality -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-mainline-focus.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: mainline-focus -->
## 当前主线焦点

- 当前 `master` 的活跃研发重心已经转到 `src/panoramic/` 蓝图文档链路，而不只是早期的 `spectra` / `spec-driver` 通用能力维护
- Phase 1 已落地的关键能力包括：`WorkspaceIndexGenerator`（Feature 040）、`CrossPackageAnalyzer`（Feature 041）、LLM 语义增强 + 多格式输出（Feature 051）
- 处理 panoramic 相关任务时，优先沿用现有抽象：`ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`
- 当前输出合同已覆盖 Markdown + JSON + Mermaid `.mmd`；涉及 LLM 增强时要保留 AST-only 的静默降级路径
<!-- END SHARED SECTION: mainline-focus -->
以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-orchestration-overrides.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: orchestration-overrides -->
## 项目级 orchestration 覆盖约定

- `.specify/orchestration-overrides.yaml` 是项目级流程结构覆盖文件；流程结构覆盖（mode phase 序列、gate behavior、parallel_scheduling 等）必须放此文件，禁止写入 `.specify/project-context.yaml` 的 `forbidden_changes` / `verification_policy` 等字段
- schema 定义在 `plugins/spec-driver/contracts/orchestration-schema.mjs`；合同说明在 `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`
- 通过 `node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --annotate` 查看合并后的 effective config 与字段来源

### 何时使用 orchestration-overrides.yaml vs spec-driver.config.yaml

| 场景 | 使用哪个文件 |
|------|-------------|
| 修改 mode 的 phase 序列（整段替换） | `orchestration-overrides.yaml` |
| 调整 gate 行为（default_behavior / severity） | `orchestration-overrides.yaml` |
| 修改 parallel_scheduling.max_concurrent_tasks | `orchestration-overrides.yaml` |
| 设置 gate_policy / resume_strategy | `spec-driver.config.yaml` |
| 开关 research.enabled 等行为偏好 | `spec-driver.config.yaml` |

**判断规则**：流程结构覆盖（编排引擎如何执行 phases/gates）→ `orchestration-overrides.yaml`；行为偏好（agent 决策偏好，非结构）→ `spec-driver.config.yaml`。

支持的覆盖路径（MVP）：
- `modes.<mode>`：整段替换，mode key 必须是 `feature|story|implement|fix|resume|sync|doc|refactor` 之一
- `gates.<GATE_ID>`：字段级合并，仅 `default_behavior / severity / hard_gate_modes` 可覆盖
- `parallel_scheduling.*`：顶层标量后者覆盖，如 `max_concurrent_tasks: 1`（CI 资源受限时适用）

MVP 不支持（二期）：`parallel_groups` 覆盖、按 phase id 局部 patch、`modes.<m>.extends` 继承语义。

### 降级信号排查方式

当 overrides 文件未生效时，使用 `--format json` 查看 diagnostics：

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --format json
```

返回的 `diagnostics` 数组中，`level` 为 `warning` 或 `error` 的条目说明降级原因：

| diagnostic code | 含义 | 处理方式 |
|----------------|------|---------|
| `orchestration-overrides.parse-error` | YAML 语法错误 | 检查 overrides 文件语法 |
| `orchestration-overrides.loader-error` | `_loadOverrides` 注入函数抛错（仅测试场景或自定义集成会触发） | 检查注入函数实现 |
| `orchestration-overrides.schema-fallback` | Zod 校验失败（如非法 mode 名） | 检查 mode 名是否为 reserved enum |
| `orchestration-overrides.version-mismatch` | version 字段与 base 不一致 | 见下方处理步骤 |
| `orchestration-overrides.unsupported-field` | 使用了 MVP 不支持的字段（如 parallel_groups） | 移除该字段或等待二期 |
| `orchestration.base-invalid` | base orchestration.yaml 损坏 | 联系 plugin 维护者 |

### version 不一致时的处理步骤

当 `diagnostics` 含 `orchestration-overrides.version-mismatch` 时：

1. 查看 base version：`node plugins/spec-driver/scripts/orchestrator-cli.mjs validate-config --format json` 中的 `version` 字段
2. 将 `.specify/orchestration-overrides.yaml` 顶部的 `version` 更新为与 base 一致的值
3. 重新验证：`node plugins/spec-driver/scripts/orchestrator-cli.mjs effective-orchestration <mode> --format json`，确认 `diagnostics` 为空
4. 如果 base version 已升级，需重新审查 overrides 中的 phase 定义是否与新 base 兼容

### gate default_behavior 合法值

| 值 | 语义 | 典型场景 |
|----|------|----------|
| `always` | 总是触发 gate（强制人工确认） | 关键发布前必须人工审核 |
| `auto` | 自动决定是否触发（基于条件） | 默认行为，平衡自动化与人工审查 |
| `on_failure` | 仅工具链/质量检查失败时触发 | CI 友好：成功时静默，失败时暂停 |
| `skip` | 跳过 gate 检查点 | 全自动化 CI 流程、不需要质量门的快速修复 |

### 生成 mode override 模板

不熟悉完整 phase schema 时，可用 `generate-template` 命令一键生成模板：

```bash
node plugins/spec-driver/scripts/orchestrator-cli.mjs generate-template fix > .specify/orchestration-overrides.yaml
```

输出包含 version 字段、`modes.<mode>` 完整结构、所有 phase 字段。修改 phases 内容后保存即可被 resolver 识别。
<!-- END SHARED SECTION: orchestration-overrides -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-eval-credentials-policy.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: eval-credentials-policy -->
## 评测凭据策略（订阅优先）

跑评测脚本（`scripts/eval-mcp-augmented.mjs` / `scripts/eval-task-runner.mjs` / `scripts/eval-judge-jury.mjs` / 后续 `f16x-*.sh` batch 脚本）时使用**订阅优先**凭据策略，按角色分类：

### 角色 ↔ 凭据来源（订阅 vs API key）

| 角色 | 模型 | 凭据来源 | 说明 |
|------|------|---------|------|
| Driver | `codex:gpt-5.5` | **ChatGPT Pro / Pro Max 订阅 OAuth** (`~/.codex/auth.json`) | 订阅边际 $0 实付；按周配额管理 |
| Judge 1 | `claude-cli:claude-opus-4-7` | **Claude Max 订阅 OAuth** (macOS Keychain) | 订阅边际 $0 实付；按周配额管理 |
| Judge 2 | `siliconflow:Pro/zai-org/GLM-5.1` | `SILICONFLOW_API_KEY`（仓库根 `.env.local`）| **真实扣费**，按 token 计算 |
| Judge 3 | `siliconflow:Pro/moonshotai/Kimi-K2.6` | `SILICONFLOW_API_KEY`（同上）| 同上 |

### 关键不变量

- **不要**在 spec / plan / prompt 里写"需 `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` 全配"作为启动前提 — 当前生产路径走订阅 OAuth，**不需要**这两个 API key
- **不要**通过 `OPENAI_API_KEY` 直连 OpenAI API 替代 Codex CLI — Codex CLI 走 ChatGPT Pro 订阅，按 token 计费 vs 订阅免费的成本差 ~5-50×
- **不要**通过 `ANTHROPIC_API_KEY` 直连 Anthropic SDK 替代 Claude CLI — 同上理由（Claude Max 订阅）
- **必须**保留 `SILICONFLOW_API_KEY` 在 `.env.local`（jury GLM/Kimi 走 SiliconFlow API，没有订阅替代）
- 评测 cost 估算时，`实付 = 仅 SiliconFlow API token cost`，**不**包括 driver / Claude judge（订阅边际 0）

### 启动前 verify 模板（host shell）

跑评测前应在 host shell（非 sandboxed worktree env）verify 3 件事：

```bash
# 1. SiliconFlow API key 已配
grep -c "^export SILICONFLOW_API_KEY=" .env.local        # 应输出 1

# 2. Claude Max OAuth 工作
echo "say only ok" | claude --print --model claude-haiku-4-5 --max-turns 1 --output-format text
# 期望输出: ok

# 3. Codex CLI OAuth 工作 (文件存在即可，binary 检查会扣 token)
ls -la ~/.codex/auth.json
# 期望: 文件存在 + recent mtime
```

### 配额监控（订阅模式特有）

订阅模式下 cost 不是钱（$0 实付），但**周配额**是真实约束：

- ChatGPT Pro Max 20x 配额：driver = codex:gpt-5.5 主消耗源
- Claude Max 配额：judge = claude-opus-4-7 主消耗源
- 跑批 ≥ 30 runs 时，每 6 runs 检查一次配额 dashboard，≥ 60% weekly → 警告 / 询问继续 / 分日跑

### 凭据轮换或异常时的应急方案

- 如果 SILICONFLOW 余额耗尽 → 临时禁用 GLM judge，jury 降级为 2 judge（spec FR 允许，但显著性降低）
- 如果 Codex / Claude OAuth 失效 → 跑批前先 `claude /login` + `codex /login` 重新授权，**不要**改回 API key 模式
- 如果必须在 CI 环境跑（无 OAuth）→ 单独 Feature 决策，不能默认改 spec 的凭据要求
<!-- END SHARED SECTION: eval-credentials-policy -->

以下区块由 `npm run docs:sync:agents` 从 `docs/shared/agent-dogfooding-policy.md` 同步，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: dogfooding-policy -->
## 自用工具与反馈闭环（Dogfooding）

本项目的核心产物就是 Spectra（codebase → agent context）与 Spec Driver（spec-driven 研发流程）。研发自身需求时**优先 dogfood 这两个工具**，并在每个需求收尾回收一手使用反馈，形成"自用 → 暴露问题 → 改进"的闭环。

### 执行约定

- **尽量自用**：实现 / 修复 / 重构需求时优先用 Spec Driver 编排流程；需要代码库结构化上下文（依赖、影响面、symbol 定位、跨包关系）时优先调 Spectra MCP 工具，而非纯靠 Grep / Read 手工翻
- **每个需求收尾必附"工具使用反馈"**：在交付报告末尾追加一节，如实记录本次用 Spectra / Spec Driver 遇到的问题；没遇到就显式写"无"，不要省略这一节
- **反馈至少覆盖以下维度**：
  - MCP 是否可用（连接失败 / 工具缺失 / 调用报错 / namespace 不对）
  - 返回信息是否够用（字段缺失 / 上下文不全 / 缺 next-step 提示导致不知道下一步该调什么）
  - 流程是否顺畅（Spec Driver 的 gate / phase / 产物是否卡住、冗余或难用）
  - 结果是否准确（impact / graph / fuzzy match 等给出错误或误导性结果）
- **反馈是产品输入而非噪声**：发现的真问题应转化为后续 Fix / 改进 Feature 候选（按"大范围改动不塞当前 Milestone"原则分流到合适里程碑），不要在当前需求里顺手乱改工具源码

### 不适用场景

- 纯文档 / 纯配置 / 一行 typo 等无需结构化上下文的微改动可不强制自用，但仍建议记一句"本次未用及原因"
- 对 Spectra / Spec Driver 自身源码的改动需求按正常 Spec Driver 流程走，反馈聚焦"改动前后自用体验差异"
<!-- END SHARED SECTION: dogfooding-policy -->
