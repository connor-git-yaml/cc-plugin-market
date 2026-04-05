# Feature 084: Harness 原生能力集成

## 概述

将 spec-driver 对 Claude Code Harness 的利用从当前 1/28 Hook 提升到 5/28，通过 PreToolUse 门禁、PostToolUse 格式化、Stop 完整性检查、Worktree 生命周期 Hook 实现硬门禁编排；同时瘦身 CLAUDE.md / AGENTS.md（各 <100 行）、引入 `.claude/rules/` 路径规则、补齐 14 个 Agent frontmatter 声明、升级 `docs:sync:agents` 脚本、集成 CI/CD claude-code-action。所有共享规则以 `docs/shared/` 为唯一事实源，Codex 通过 AGENTS.md 同步区块获得等价规则覆盖。

## User Stories

1. **作为 spec-driver 用户**，我希望活跃工作流期间对 `src/` 的直接编辑被硬性阻止，而非仅靠 Prompt 软约束，以避免绕过编排流程的意外改动。
2. **作为项目维护者**，我希望 CLAUDE.md 和 AGENTS.md 的行为约定由单一事实源同步生成，消除双端手写导致的规则漂移。
3. **作为 Agent 配置者**，我希望 14 个 Agent .md 通过原生 frontmatter 声明 model/tools/effort，减少 SKILL.md 的重复样板配置。
4. **作为 CI/CD 用户**，我希望 PR 提交时自动触发 claude-code-action 审查，获得与本地 spec-driver 一致的质量反馈。
5. **作为 Codex 用户**，我希望在无 Hooks / rules/ 支持的环境中，通过 AGENTS.md 同步区块获得完整的行为规则，功能不退化。

## Functional Requirements

### FR-1: Hooks 扩展（hooks.json）

- **FR-1.1** 新增 `PreToolUse` Hook：匹配 `Edit|Write` 工具，当检测到活跃 spec-driver 工作流（`specs/{feature}/tasks.md` 存在且含未完成任务）且目标路径在 `src/` 下时，输出 `exitCode: 2`（BLOCK）并返回错误提示。
- **FR-1.2** 新增 `PostToolUse` Hook：匹配 `Edit|Write` 工具，对变更文件执行 `npx prettier --write`，静默处理非 JS/TS 文件。
- **FR-1.3** 新增 `Stop` Hook：以 prompt 类型运行，检查当前 Feature 的 `tasks.md` 是否存在未标记完成的任务，若有则输出提醒（非阻断）。
- **FR-1.4** 新增 `WorktreeCreate` / `WorktreeRemove` Hook：创建时复制 `specs/{current-feature}/` 到 worktree；移除时检查 worktree 内是否有未提交变更并警告。

### FR-2: `.claude/rules/` 路径规则

- **FR-2.1** 创建 `rules/tests.md`：当操作 `tests/**` 路径时加载，包含测试规范（命名、覆盖率、mock 策略）。
- **FR-2.2** 创建 `rules/specs.md`：当操作 `specs/**` 路径时加载，包含 spec 写作规范（格式、术语、模板引用）。
- **FR-2.3** 创建 `rules/plugins.md`：当操作 `plugins/**` 路径时加载，包含插件开发规范（目录结构、SKILL.md 格式、版本约定）。
- **FR-2.4** 每个 rules/ 文件的规则内容必须在 `docs/shared/` 有等价源文件，确保 Codex 用户通过 AGENTS.md 看到完整规则。

### FR-3: Agent Frontmatter

- **FR-3.1** 为 14 个 `plugins/spec-driver/agents/*.md` 添加 YAML frontmatter，声明 `model`（默认 sonnet）、`tools`（按 agent 角色最小化）、`effort`（low/medium/high）。
- **FR-3.2** implement.md 和 plan.md 设为 `effort: high`；clarify.md 和 checklist.md 设为 `effort: low`；其余设为 `effort: medium`。
- **FR-3.3** frontmatter 中不包含 `hooks` / `mcpServers` / `permissionMode`（Plugin Subagent 不支持）。

### FR-4: 文档瘦身

- **FR-4.1** 从 CLAUDE.md 和 AGENTS.md 中删除 auto-generated 技术清单（Active Technologies、Project Structure 等由 spec-driver 自动生成的区块）。
- **FR-4.2** 将两端手写的行为约定（约 11 条）提取到 `docs/shared/agent-behavior-rules.md`，通过 `docs:sync:agents` 同步。
- **FR-4.3** 瘦身后 CLAUDE.md 和 AGENTS.md 各不超过 100 行，仅保留：平台专属配置 + 共享同步区块引用。
- **FR-4.4** 升级 `scripts/sync-agent-docs.mjs`：在 `sectionConfigs` 中新增 `behavior-rules` 条目，指向 `docs/shared/agent-behavior-rules.md`。

### FR-5: CI/CD 集成

- **FR-5.1** 新增 `.github/workflows/claude-review.yml`：在 PR 打开/更新时触发 `claude-code-action`，执行 `repo:check` 命令。
- **FR-5.2** workflow 配置 `on: pull_request`，使用 `anthropics/claude-code-action@v1`，传入必要的 secrets（`ANTHROPIC_API_KEY`）。
- **FR-5.3** 审查结果以 PR comment 形式输出，不阻断 merge（advisory 模式）。

## 非功能需求

- **NFR-1 向后兼容**：所有 Hook 脚本在 spec-driver 未激活时静默退出（exit 0），不影响非 spec-driver 工作流。
- **NFR-2 Codex 降级**：Hooks / rules/ / frontmatter 在 Codex 不可用时，编排核心通过 AGENTS.md 同步区块 + `spec-driver.config.yaml` 独立运行，功能不退化（宪法原则 IX）。
- **NFR-3 瘦身零遗漏**：CLAUDE.md / AGENTS.md 瘦身前后行为约定逐条对比，确保无规则丢失（Constitution 检查 XII 风险缓解）。
- **NFR-4 幂等性**：`docs:sync:agents` 脚本连续执行两次，第二次无变更。
- **NFR-5 性能**：PreToolUse Hook 执行时间 <200ms，不影响编辑体验。

## 验收标准

1. `hooks.json` 包含 SessionStart / PreToolUse / PostToolUse / Stop / WorktreeCreate / WorktreeRemove 共 5 类（6 条）Hook 定义。
2. 在活跃 spec-driver 工作流中，对 `src/` 的 Edit/Write 操作被 PreToolUse Hook 阻断（exit code 2）。
3. `.claude/rules/` 下存在 3 个路径规则文件，每个在 `docs/shared/` 有等价源。
4. 14 个 Agent .md 均包含合法 YAML frontmatter（model + tools + effort）。
5. CLAUDE.md <= 100 行，AGENTS.md <= 100 行。
6. 瘦身前后行为约定逐条 diff 无遗漏（NFR-3 验证通过）。
7. `npm run docs:sync:agents` 执行后 `behavior-rules` 区块正确同步到两端，幂等执行无变更。
8. `.github/workflows/claude-review.yml` 语法合法，`act` 或 GitHub 可解析。
9. 所有 Hook 脚本在无 `specs/{feature}/tasks.md` 时静默退出（exit 0）。
