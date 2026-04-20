# Changelog

本文件记录 cc-plugin-market（Spectra + Spec Driver）仓库的重要变更。
格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
