# Feature 084 — 技术规划

## 1. 方案总览

将 spec-driver 的 Harness 利用率从 1/28 提升到 5/28：新增 PreToolUse / PostToolUse / Stop / Worktree 四类 Hook（Bash 脚本），创建 `.claude/rules/` 路径规则，补齐 14 个 Agent frontmatter，瘦身 CLAUDE.md / AGENTS.md 至各 <=100 行，新增 claude-code-action CI workflow。所有变更均为配置文件和 Markdown，不涉及 TypeScript 源码。

## 2. 分模块实施方案

### M1: Hooks 扩展

**变更文件**: `plugins/spec-driver/hooks/hooks.json` + 4 个新增 Bash 脚本

- `hooks/pre-tool-use-guard.sh` — 检测活跃工作流 + 目标在 `src/` 下 -> exit 2 阻断
- `hooks/post-tool-use-format.sh` — 对 JS/TS 文件执行 `npx prettier --write`，非 JS/TS 静默 exit 0
- `hooks/stop-task-check.sh` — 读取当前 feature 的 tasks.md，检查未完成任务，输出提醒
- `hooks/worktree-lifecycle.sh` — create: 复制 specs 目录；remove: 检查未提交变更并警告

所有脚本共同守则：无 `specs/*/tasks.md` 时直接 `exit 0`（NFR-1）。hooks.json 新增 PreToolUse（matcher: `Edit|Write`）、PostToolUse（matcher: `Edit|Write`）、Stop、WorktreeCreate、WorktreeRemove 共 5 类条目。

### M2: `.claude/rules/` 路径规则

**新增文件**: `.claude/rules/tests.md`、`rules/specs.md`、`rules/plugins.md`

每个 rules 文件从对应 `docs/shared/` 源文件提取内容（新增 `docs/shared/agent-rules-tests.md` 等 3 个源文件）。规则内容简短（每个 <20 行），聚焦路径匹配场景的最小约束集。通过 Codex 降级路径，同样的规则内容也会同步到 AGENTS.md 中。

### M3: Agent Frontmatter

**变更文件**: `plugins/spec-driver/agents/*.md`（14 个文件）

在每个文件头部添加 YAML frontmatter 块：

- `effort: high` — implement.md、plan.md
- `effort: low` — clarify.md、checklist.md
- `effort: medium` — 其余 10 个
- `model` 全部默认 `sonnet`，`tools` 按角色最小化配置
- 不含 hooks / mcpServers / permissionMode（Plugin Subagent 不支持）

### M4: 文档瘦身

**变更文件**: `CLAUDE.md`、`AGENTS.md`、`scripts/sync-agent-docs.mjs`

1. 删除 auto-generated 区块（Active Technologies、Project Structure、Recent Changes）
2. 提取手写行为约定到 `docs/shared/agent-behavior-rules.md`，通过同步区块引用
3. 在 `sync-agent-docs.mjs` 的 `sectionConfigs` 数组中新增 `behavior-rules` 条目
4. 瘦身后两端各保持 <=100 行：平台专属头 + 共享同步区块引用

### M5: CI/CD 集成

**新增文件**: `.github/workflows/claude-review.yml`

- `on: pull_request`，使用 `anthropics/claude-code-action@v1`
- 传入 `secrets.ANTHROPIC_API_KEY`，执行 `repo:check`
- advisory 模式（PR comment 输出，不阻断 merge）

## 3. Impact Assessment

| 维度 | 数值 |
|------|------|
| 新增文件 | ~10（4 Hook 脚本 + 3 rules + 3 docs/shared 源 + 1 workflow） |
| 修改文件 | ~19（hooks.json + 14 agents + CLAUDE.md + AGENTS.md + sync-agent-docs.mjs） |
| 风险等级 | **中低** — 全为配置/Markdown 变更，不影响 TypeScript 运行时 |
| 回归风险 | 文档瘦身可能遗漏规则（NFR-3 要求逐条 diff 验证） |
| Codex 兼容 | Hooks/rules 在 Codex 不可用，通过 AGENTS.md 同步区块降级（NFR-2） |

## 4. 依赖顺序

```
M4 文档瘦身（先做，为后续腾出行数空间）
 └─> M2 路径规则（依赖 docs/shared 源文件 + 同步脚本升级）
      └─> M3 Frontmatter（独立，但建议在规则就绪后补齐）
M1 Hooks 扩展（独立于文档瘦身，可与 M4 并行）
M5 CI/CD（最后，依赖其他模块稳定后再接入审查）
```

推荐执行序：M4 -> M1 -> M2 -> M3 -> M5
