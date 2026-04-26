# Changelog

本文件记录 cc-plugin-market（Spectra + Spec Driver）仓库的重要变更。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed — spectra ⚠️ BREAKING

- **默认 Claude 模型升级（Feature 133 P0-3）** — 升级到最新发布的 Sonnet 4.6 / Opus 4.7 1M 系列：
  - `DEFAULT_CLAUDE_MODEL`: `claude-sonnet-4-5-20250929` → **`claude-sonnet-4-6`**（2026-02-17 发布，含 1M context）
  - 逻辑名 `opus`: `claude-opus-4-1-20250805` → **`claude-opus-4-7`**（2026-04-16 发布，1M context 默认可用，无需 beta header）
  - **`balanced` preset 改为映射到 `sonnet`**（旧映射 `opus`），与 `cost-efficient` 等价；`quality-first` 仍指 `opus`
  - `DEFAULT_CODEX_ALIASES` 同步新增最新模型映射，保留历史条目作向后兼容
- **影响**：未显式 pin model 的项目下次运行会切换到新模型。`balanced` preset 用户的实际 LLM 调用从 Opus 切到 Sonnet（成本 $5/$25 → $3/$15 per MTok，速度更快）
- **建议**：希望保留旧行为的用户在 `spec-driver.config.yaml` 显式指定：
  ```yaml
  preset: quality-first    # 强制使用 Opus
  # 或
  agents:
    specify:
      model: claude-opus-4-1-20250805    # 显式 pin 旧版 Opus
  ```
- 调研依据：见 `specs/133-fix-postmortem-phase2/research/online-research.md`

### Fixed — spectra

- **Phase 2 收尾清理（Fix 134，5 个偏差，patch）** — Phase 2 集成回归测试在 graphify 示例项目发现 Fix 133 残留 4 个偏差，端到端验证再暴露 1 个隐藏架构 bug：
  - **(1) `spec-driver.config.yaml` 覆盖 sonnet 默认** — yaml 锁死 `preset: quality-first` + 10 个 agent 显式 `model: opus`，覆盖了 Fix 133 P0-3 的 sonnet 默认；dogfood 跑 spec-driver 流程时仍是 `claude-opus-4-7`。修复：`preset: quality-first → balanced`、10 个 `model: opus → sonnet`、首行注释同步。
  - **(2) `tokenUsage.input` 异常低（5 模块累计 input=30 vs output=35,759）** — Fix 133 P0-1 修了 output 提取，但 input 路径只读 `input_tokens` 主字段，漏了 prompt caching 时主输入会进 `cache_read_input_tokens` 的语义。修复：`src/auth/cli-proxy.ts` + `src/core/llm-client.ts` 累加 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`（任一缺失 fallback 0）；新增 7 个单测覆盖累加场景 + 向后兼容 + null 字段 + 边界。
  - **(3) reading 模式 499s 仍超 SC-001 < 120s** — Fix 133 P0-2 已跳过产品文档 + 模块 spec 的 LLM enrichment，但模块 spec 主调用仍走默认 model（受用户配置影响）。修复（方向 A）：提取 `src/batch/model-override-decision.ts` 纯函数 helper，决策矩阵 `isSmallModule || budgetCheaperModelAll || effectiveMode !== 'full'` 任一为真即强制 sonnet override，与默认 model 解耦；新增 8 个单测覆盖决策矩阵。
  - **(4) CLI batch help 字符串遗漏 `--hyperedges`** — Fix 133 已实现 `--hyperedges` flag 解析（`src/cli/utils/parse-args.ts:701`）+ batch handler 接入（`src/cli/commands/batch.ts:58`），但 `src/cli/index.ts:44` 的 batch help 字符串没列出，用户 `spectra batch --help` 看不到。修复：help 字符串追加 `[--hyperedges]` + 选项详情说明（仅 `mode=full` 生效 + env 等价路径）。注：项目用自定义 parse-args（非 commander），按实际架构修复。
  - **(5) `sonnetModelId` 真 bug（graphify E2E 暴露）** — `batch-orchestrator.ts:584` 用 `resolveReverseSpecModel({ agentId: 'specify-sonnet' })` 取 sonnet override 模型 ID，但 `'specify-sonnet'` 在 yaml agents 表不存在，会 fallback 到 preset；当用户配置 `quality-first` 时 sonnetModelId 实际是 opus，破坏小模块/budget 降级/reading 模式 强制 sonnet 的设计意图。**仅修偏差 1 yaml preset 不够**——当 spectra batch 跑外部项目（如 graphify）时，`loadDriverConfig` 向上搜父目录找 yaml，可能仍是旧 `quality-first`。修复（架构层）：新增 `getCanonicalSonnetModelId(runtime)` helper（`src/core/model-selection.ts`），直接从 `LOGICAL_*_MODEL_MAP` 取 `sonnet`，不依赖 yaml；batch-orchestrator 探测 `detectAuth().preferred.provider` 解析 runtime 后调用。新增 3 个单测覆盖 helper（含 yaml 存在 quality-first 时仍返回 sonnet）。
  - 验证：vitest 全量 2197 passed | 1 skipped，零新增失败；端到端在 graphify 示例项目（21 Python 模块）验证（reading 模式生成的 spec frontmatter `llmModel: claude-sonnet-4-6` ✓、`tokenUsage.input` ≈ 28892（之前 5 模块累计 30）✓、`spectra batch --help \| grep --hyperedges` 可见 ✓）。

- **CLI proxy token 提取（Feature 133 P0-1）** — Phase 2 集成回归发现：所有 module spec frontmatter 的 `tokenUsage` 全为 0，但 LLM 真调用了。根因是 `src/auth/cli-proxy.ts` 的 `StreamMessage` 类型把 `input_tokens / output_tokens` 当作 `type=result` message 的顶层字段，但 Claude CLI 实际嵌套在 `usage.*` 下；mock-only 测试沿用相同错误假设导致 2154 单测全过却生产失败（cost-summary 因此误报"未调用 LLM"）。
  - 修复：StreamMessage 接口新增嵌套 `usage` 字段，保留旧顶层字段作向后兼容；`parseStreamJsonOutput` 在 `type=result` 分支优先读 `msg.usage.*`，回落顶层
  - 新增 3 个单测 case + 1 个真实 SDK 集成测试（`vi.skipIf(!ANTHROPIC_API_KEY)` 守卫）
  - 下游影响：`frontmatter.tokenUsage` 在 CLI proxy 路径下恢复非零值；`batch-summary.md` / `quality-report.md` 的"未调用 LLM"误报自动消失

### Removed — spec-driver ⚠️ BREAKING

- **9 个遗留原子命令** `/spec-driver.{specify,plan,tasks,implement,clarify,analyze,checklist,constitution,taskstoissues}` 已从 `.claude/commands/` 删除。这些命令由 spec 032 从 speckit 重命名继承而来，但功能长期落后于 `plugins/spec-driver/skills/spec-driver-*/` 下的编排器 Skill，且两套零代码依赖、互不调用，长期造成命令面板混乱与维护双倍负担。
- 所有旧原子命令的能力均已被编排器 Skill 覆盖。迁移映射、使用示例与升级步骤详见 [`docs/migrations/skill-deprecation.md`](docs/migrations/skill-deprecation.md)。

### Changed — spec-driver

- **prompt_source fallback 下线（BREAKING 伴生）** — `spec-driver-implement` / `spec-driver-story` / `spec-driver-resume` 三个编排器 skill 的 `prompt_source` 逻辑不再探测 `.claude/commands/spec-driver.{phase}.md` 或 `.codex/commands/spec-driver.{phase}.md`，所有 phase prompt 统一从 `$PLUGIN_DIR/agents/{phase}.md` 加载。用户通过放置这些 override 文件定制 prompt 的能力被移除（v3.x 隐含机制），唯一定制路径为编辑 `plugins/spec-driver/agents/{phase}.md` 后重装插件。移除理由：删除原子命令后仍保留 fallback 会导致残留 override 文件 silently shadow 新流程（由 Codex adversarial review 识别）
- `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` — `claudeProjectOverrides.entries` 清空（9 条 → 0 条），`note` 改写为"Kept for directory structure only ... will be ignored by the runtime"，与上述 fallback 下线保持一致
- `contracts/runtime-boundary-contract.yaml` — `claude.requiredFiles` 移除 `.claude/commands/spec-driver.implement.md`
- `plugins/spec-driver/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` 与 `plugins/spec-driver/agents/constitution.md` — 所有 `/spec-driver.constitution` 引用改为 `/spec-driver:spec-driver-constitution`
- `plugins/spec-driver/scripts/codex-skills.sh` — 移除 `spec-driver-constitution` 的 source_command 特殊分支；`write_wrapper_source_contract` 中移除"Project overrides"说明行
- `.codex/skills/spec-driver-{constitution,implement,resume,story}/SKILL.md` — 通过 `npm run codex:spec-driver:install` 从更新后的 source SKILL 再生
- `README.md` — "Individual Phase Commands" 段替换为"Orchestrator Skill Commands"，列出 9 个编排器 skill 入口，段末指向迁移指南
- `plugins/spec-driver/README.md` — 修正 `/spec-driver.constitution` 提示为新格式；保留历史 speckit→spec-driver 映射表并为 9 个 `/spec-driver.{phase}` 行加标注"已于 v4.0 弃用"，表下补充 v4.0 变更说明
- `.specify/scripts/bash/check-prerequisites.sh` — 错误提示从 `/spec-driver.specify/plan/tasks` 改为 `/spec-driver:spec-driver-feature`（缺特性目录）与 `/spec-driver:spec-driver-resume`（特性目录已在、仅缺 plan/tasks）
- `plugins/spec-driver/scripts/lib/init-project-output.sh` — constitution 缺失提示改为 `/spec-driver:spec-driver-constitution`
- `plugins/spec-driver/templates/specify-base/{plan,tasks,checklist}-template.md` — 注释中对原子命令的具名引用改为中性描述（如"plan phase"、"tasks phase"、"checklist phase"）
- `tests/integration/runtime-boundary-contract.test.ts` — 移除对已删除合同条目的 `writeFileSync` setup
- `tests/integration/spec-driver-wrapper-source-truth.test.ts` — `cpSync('.claude/commands')` 改为 `mkdirSync`（空目录满足 entries=[] 合同）

### Added

- `docs/migrations/skill-deprecation.md` — 完整迁移指南：背景说明、9 条旧→新映射表、使用示例对比、如何确认旧命令消失、Codex 用户说明、自定义 override 清理建议、FAQ、相关合同变更
- `CHANGELOG.md` — 本文件

### Added — spectra（F5 Reading UX，Minor 功能新增）

- **轻量模式**：`spectra batch --mode=<full|reading|code-only>` — `reading` 模式跳过 5 个产品文档层 generator（ADR 推断、产品概述、故障排查、数据模型、质量评估），`code-only` 模式额外跳过 8 个架构推断层；冷启动目标 < 300s，热启动目标 < 60s（FR-001 ~ FR-008）
- **自然语言问答**：MCP `panoramic-query` 工具新增 `natural-language` operation — 支持 5 类典型问题（调用关系、调用路径、设计决策、技术债、流程归属），采用 Graph-first BFS + embedding 精排 + LLM 组装的 B+C 混合架构，100% Citation 覆盖（specPath + lineRange + excerpt 三字段），budget-gate record-only 模式不阻断问答（FR-009 ~ FR-017）
- **交互式图谱可视化**：`spectra batch --html` 在 `_meta/graph.html` 生成单文件离线交互图谱，包含力导向布局（< 2000 节点）、大图静态模式（≥ 2000 节点 + 横幅警告）、搜索/过滤、节点点击跳转 Spec 文件、Hyperedge 超边凸包可视化，零 CDN 引用（FR-018 ~ FR-024）
- `src/panoramic/qa/`：新增 8 个模块（graph-retriever、rag-reranker、debt-context、citation、prompt-builder、llm-caller、index、types）
- `plugins/spectra/skills/spectra/SKILL.md`、`plugins/spectra/skills/spectra-batch/SKILL.md`：更新 MCP 工具说明，记录 `natural-language` operation 和 `--mode` 参数

### 相关 Spec — F5 Reading UX

- `specs/132-reading-ux/`（spec.md / plan.md / tasks.md / perf-baseline.md / qa-coverage-report.md / risk-regression.md / browser-verification.md）

### 影响评估

- 用户手工调用 `/spec-driver.specify` 等旧命令将得到 "command not found"，需按迁移指南改为对应编排器入口
- 用户项目 `.claude/commands/` 下的自定义 `spec-driver.*.md` 覆盖文件**不会被自动清理**，建议参照迁移指南手动处理
- Codex 用户不受影响：`$spec-driver-*` 入口保持原状，所有功能通过编排器 Skill 继续提供
- Spectra 插件、仓库发布流程（`npm run repo:check` / `npm run release:sync`）、已有 spec/plan/tasks 制品均不受影响

### 相关 Spec

- `specs/129-fix-remove-atomic-skills/`（fix-report.md / plan.md / tasks.md / spec-review.md / quality-review.md / verification/verification-report.md）

### 后续 Release PR 待办

此 `[Unreleased]` 条目为 **major version bump** 预备（按 SemVer，删除公共命令是 BREAKING）。具体版本号（建议 spec-driver 4.0.0）与 `contracts/release-contract.yaml` 同步更新将在独立 release PR 中通过 `npm run release:sync` 执行。
