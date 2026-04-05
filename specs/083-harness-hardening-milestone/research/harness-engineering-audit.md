# Claude Code Harness Engineering 深度审计

> 调研日期：2026-04-06
> 对比基线：cc-plugin-market master (spec-driver v3.10.1 / reverse-spec v2.5.0)
> 调研范围：Claude Code 官方能力、开源生态、当前项目实现

---

## 一、Executive Summary

当前项目在 **Spec-Driven 编排层**（14 agent + 7 skill + 合同体系）上处于开源生态前列，已超过绝大多数社区项目的成熟度。但在 **Claude Code Harness 原生能力的利用深度** 上仍有显著空间——特别是 Hooks 系统、`.claude/rules/` 路径特定规则、Subagent frontmatter 声明式配置、以及 CI/CD 集成几个方向。

下表速览结论：

| 领域 | 当前状态 | 建议动作 |
|------|---------|---------|
| Hooks 利用深度 | 仅用 SessionStart | **高优**：补充 PreToolUse / PostToolUse / Stop |
| `.claude/rules/` 路径规则 | 未使用 | **中优**：替代 CLAUDE.md 中的分散规则 |
| Agent frontmatter 声明 | 无 model/tools/isolation 声明 | **高优**：利用原生能力减少 prompt 样板 |
| CI/CD 集成 | 仅 pre-commit hook | **中优**：引入 claude-code-action |
| 合同 & 同步体系 | 业界领先 | 保持，小幅优化 |
| 产品级治理脚本 | 过度工程化风险 | **需评估**：10+ 生成脚本 ROI |
| CLAUDE.md 体积 | 偏大 (>200行) | **中优**：拆分到 rules/ |
| Scheduled Tasks | 未使用 | 低优：按需引入 |
| Agent Teams | 未使用 | 低优：实验性功能 |

---

## 二、可纳入的能力（Gap Analysis）

### 2.1 Hooks 系统 — 从 1/28 到核心利用

**现状**：仅使用 `SessionStart` 触发 postinstall.sh，其余 27 种 Hook 事件完全未利用。

**建议纳入**：

#### (A) `PreToolUse` — 源码保护门禁 ⭐ 高优

当前通过 CLAUDE.md 文字规则约束"使用 spec-driver 时不允许直接修改源代码"，但这依赖 LLM 遵守文字指令，无硬性保障。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "bash scripts/hooks/guard-spec-driver-edit.sh"
        }]
      }
    ]
  }
}
```

脚本逻辑：检测当前是否在 spec-driver 工作流中（`.specify/runs/` 有活跃 session），若是则阻止对 `src/` 的直接编辑，只允许写入 `specs/`。

**价值**：将"软约束"升级为"硬门禁"，消除 agent 误操作风险。

#### (B) `PostToolUse` — 自动格式化 ⭐ 中优

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "npx prettier --write $CLAUDE_FILE_PATH"
      }]
    }
  ]
}
```

**价值**：省去在 CLAUDE.md 里反复强调格式规范，由 Hook 自动保障。

#### (C) `Stop` — 验证完整性检查 ⭐ 中优

在 Claude 即将结束响应时，触发 prompt hook 检查是否遗漏了任务：

```json
{
  "Stop": [
    {
      "hooks": [{
        "type": "prompt",
        "prompt": "检查是否所有 TodoWrite 中的任务都已完成，是否有遗漏的文件未保存。如果一切完成返回 ok: true"
      }]
    }
  ]
}
```

#### (D) `Notification` — 长任务通知 低优

spec-driver feature 模式跑完整流程可能需要 10-30 分钟，可以在关键 Gate 暂停时推送桌面通知。

---

### 2.2 `.claude/rules/` 路径特定规则 ⭐ 中高优

**现状**：所有规则堆在 CLAUDE.md 里（>200 行），包括 auto-generated 技术清单 + 手动规则 + 5 个同步区块。

**建议**：将 CLAUDE.md 瘦身到 <100 行核心规则，其余拆分：

```
.claude/rules/
├── language-convention.md          # 中英文约定
├── spec-driver-workflow.md         # spec-driver 使用约束
│   paths: ["specs/**", "plugins/spec-driver/**"]
├── panoramic-development.md        # panoramic 开发约定
│   paths: ["src/panoramic/**"]
├── testing.md                      # 测试规范
│   paths: ["tests/**"]
└── release-and-sync.md             # 发布与同步约定
```

**价值**：
- CLAUDE.md 体积减半，降低每次会话的 token 消耗
- 路径特定规则只在操作相关文件时加载，更精准
- 更好的可维护性（修改一类规则不影响其他）

---

### 2.3 Agent Frontmatter 声明式配置 ⭐ 高优

**现状**：`plugins/spec-driver/agents/*.md` 没有使用 Claude Code 原生的 Agent frontmatter，所有配置（model 选择、tools 限制、isolation 模式）都靠 SKILL.md prompt 文字描述 + spec-driver.config.yaml 运行时解析。

**建议**：利用原生 frontmatter 减少样板：

```markdown
---
name: spec-driver-implement
description: 成熟 Spec 的代码实施。在 spec.md + plan.md 已就绪时自动使用。
model: opus
tools: Read, Write, Edit, Bash, Grep, Glob, Agent
disallowedTools: WebSearch, WebFetch
maxTurns: 100
effort: high
---

<!-- 原有 prompt 内容 -->
```

**价值**：
- Claude Code 原生支持的 `model`、`tools`、`maxTurns`、`effort` 等字段，harness 层自动处理
- 减少 SKILL.md 中的模型选择 / 工具限制的重复逻辑
- `isolation: worktree` 可让实施阶段自动在隔离 worktree 中运行

**注意**：Plugin 加载的 Subagent 不支持 hooks/mcpServers/permissionMode。如需完整权限，需将 agent 复制到 `.claude/agents/`。

---

### 2.4 CI/CD 集成 — GitHub Actions ⭐ 中优

**现状**：仅有本地 pre-commit hook，无 CI/CD 集成。

**建议引入**：

#### (A) claude-code-action — PR 自动审查

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            审查此 PR 的代码变更，重点关注：
            1. 是否遵循 spec-driver 合同体系
            2. 版本号是否正确 bump
            3. 是否有遗漏的 repo:sync
```

#### (B) claude-code-security-review — 安全审查

Anthropic 官方提供的 `anthropics/claude-code-security-review` Action，可自动检测 PR 中的安全漏洞。

**价值**：将当前完全依赖本地 hook 的质量保障延伸到 CI/CD 层。

---

### 2.5 Skill Frontmatter 增强

**现状**：所有 SKILL.md 的 frontmatter 仅有 `name` / `description` / `disable-model-invocation`。

**可用但未利用的字段**：

```yaml
---
name: spec-driver-feature
description: ...
# 以下为可纳入字段
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TodoWrite
model: opus                    # 默认模型
effort: high                   # 推理深度
memory: project                # 项目级记忆
---
```

---

### 2.6 Worktree 原生集成

**现状**：项目有 `sync-worktree-local-state.sh`，但未利用 Claude Code 的 `WorktreeCreate` / `WorktreeRemove` Hook。

**建议**：

```json
{
  "WorktreeCreate": [{
    "hooks": [{
      "type": "command",
      "command": "bash scripts/sync-worktree-local-state.sh create"
    }]
  }],
  "WorktreeRemove": [{
    "hooks": [{
      "type": "command",
      "command": "bash scripts/sync-worktree-local-state.sh remove"
    }]
  }]
}
```

**价值**：当前 `post-checkout` git hook 触发 worktree 同步，但 Claude Code 的 `EnterWorktree` 并不一定经过 git checkout。用原生 Hook 更可靠。

---

## 三、可能多余或需要精简的部分

### 3.1 产品级生成脚本矩阵 — 过度工程化风险 ⚠️

当前 `plugins/spec-driver/scripts/` 下有 **10+ 个 generate-*.mjs 脚本**：

| 脚本 | 产出 | 实际使用频率 |
|------|------|------------|
| generate-product-entity-catalog.mjs | entity.yaml | 低（手动触发） |
| generate-product-quality-reports.mjs | quality-report.json/md | 低 |
| generate-product-scorecards.mjs | scorecard-report.json/md | 低 |
| generate-adoption-insights.mjs | adoption-report.json/md | 极低 |
| generate-workflow-registry.mjs | workflow-index.json/md | 低 |
| generate-project-context-suggestions.mjs | suggestions.yaml/md | 中 |
| record-workflow-run.mjs | 运行记录 | 需集成后才有值 |

**问题**：
- 这些脚本各自 500-800 行，加上 `scripts/lib/` 下的共享库，总计 **5000+ 行** 纯治理代码
- `specs/products/*/_generated/` 目录下积累了大量 JSON/MD 生成产物，但没有明确的消费者
- Scorecard、Adoption Insights 等概念引入了较重的治理框架，但当前只有 2 个产品（reverse-spec + spec-driver），ROI 存疑

**建议**：
1. 保留 `generate-product-entity-catalog.mjs` 和 `generate-product-quality-reports.mjs`（有明确产出）
2. 将 Scorecard、Adoption Insights、Workflow Registry 标记为 **实验性**，移到 `scripts/experimental/`
3. 在它们有明确的消费场景（如 CI Dashboard、README Badge）前，不在 `repo:sync` 主链路中执行

---

### 3.2 合同层叠加过深

当前有 **4 层合同**：

```
contracts/release-contract.yaml          # 发布合同
contracts/runtime-boundary-contract.yaml # 运行时边界合同
plugins/spec-driver/contracts/wrapper-source-of-truth.yaml  # 包装层合同
plugins/reverse-spec/contracts/skill-source-of-truth.yaml   # 技能分发合同
```

加上 `docs/shared/` 的 5 个策略文档、`spec-driver.config.yaml`、`.specify/project-context.yaml`，一个新贡献者需要理解 **10+ 个配置/合同文件** 才能安全提交。

**建议**：
- 编写一个 `docs/contributor-guide.md`，用流程图说明"改 X 文件需要做什么"
- 或者在 `repo:check` 失败时，输出更友好的修复建议（当前只输出 pass/fail）

---

### 3.3 CLAUDE.md 中的 auto-generated 技术清单

CLAUDE.md 顶部约 50 行是从 specs 自动生成的"Active Technologies"列表，如：

```
- TypeScript 5.x, Node.js LTS (20.x+) + s-morph, tree-sitter... (001-reverse-spec-v2)
- TypeScript 5.7.3, Node.js LTS (≥20.x)... (003-skill-init)
- TypeScript 5.7.3, Node.js LTS (≥20.x)... (004-claude-sub-auth)
```

**问题**：
- 大量重复信息（几乎每条都是 "TypeScript 5.x, Node.js LTS"）
- 占用宝贵的 CLAUDE.md 空间（每次会话都加载）
- 对 agent 的实际帮助有限（它可以直接读 package.json 和 tsconfig.json）

**建议**：删除或大幅精简，仅保留一句 "TypeScript 5.x + Node.js 20.x+ 项目，详见 package.json"。

---

### 3.4 Codex 兼容层的维护负担

`spec-driver.config.yaml` 中的 `model_compat`、`codex_thinking`、`.codex/skills/` 包装层占了不少维护精力。

**现实**：如果 Codex 的市场采纳率不高，或用户主要用 Claude Code，这套兼容层的 ROI 需要评估。

**建议**：短期保留，但标记为 best-effort，不因 Codex 兼容性阻塞 Claude Code 的原生能力利用。

---

## 四、社区对标 — 值得参考的开源项目

### 4.1 直接竞品/同类

| 项目 | 亮点 | 可借鉴 |
|------|------|--------|
| [github/spec-kit](https://github.com/github/spec-kit) | GitHub 官方 SDD 工具包 | 官方背书的 spec-driven 流程标准化 |
| [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) | Kiro 风格命令，跨 6 种 AI IDE | 多平台兼容的 SDD workflow |
| [dsifry/metaswarm](https://github.com/dsifry/metaswarm) | 18 agents + 自我改进框架 | 自适应 agent 质量提升循环 |
| [catlog22/Claude-Code-Workflow](https://github.com/catlog22/Claude-Code-Workflow) | JSON 驱动编排 + context-first | 声明式工作流定义 |

**cc-plugin-market 的差异化优势**：
- 合同驱动的多层治理（无竞品做到这个深度）
- 产品级文档聚合（current-spec.md + entity catalog）
- 双运行时兼容（Claude Code + Codex）

### 4.2 Hooks 工程化参考

| 项目 | 亮点 |
|------|------|
| [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) | 每种 hook 类型的完整 Python 示例 |
| [johnlindquist/claude-hooks](https://github.com/johnlindquist/claude-hooks) | TypeScript 强类型 hook payload |
| [carlrannaberg/claudekit](https://github.com/carlrannaberg/claudekit) | 文件安全 PreToolUse + 类型检查 PostToolUse |
| [decider/claude-hooks](https://github.com/decider/claude-hooks) | 干净代码实践强制执行 |

### 4.3 CI/CD 与质量门

| 项目 | 亮点 |
|------|------|
| [anthropics/claude-code-action](https://github.com/anthropics/claude-code-action) | 官方 GitHub Action，PR 自动审查 |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | AI 安全审查 Action |
| [ChrisWiles/claude-code-showcase](https://github.com/ChrisWiles/claude-code-showcase) | 完整配置示例：hooks + skills + agents + GitHub Actions |

### 4.4 Harness 架构参考文章

| 文章 | 核心观点 |
|------|---------|
| [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 多 context window 工作流最佳实践 |
| [HumanLayer: Skill Issue](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents) | Hooks 将 LLM 从文本预测器变为可靠 agent |
| [DuoCode: The Harness That Makes The Model Useful](https://duocodetech.com/blog/claude-code-harness-engineering) | 源码级分析 harness 基础设施 |

---

## 五、优先级路线图建议

### Phase 1 — 快速收益（1-2 天）

1. **PreToolUse Hook**：硬性阻止 spec-driver 工作流中对 src/ 的直接编辑
2. **PostToolUse Hook**：自动 prettier 格式化
3. **CLAUDE.md 瘦身**：删除 auto-generated 技术清单，精简到 <100 行
4. **Agent frontmatter**：为核心 agents 添加 model/tools/effort 声明

### Phase 2 — 结构优化（3-5 天）

5. **`.claude/rules/` 拆分**：将 CLAUDE.md 中的路径特定规则分拆
6. **WorktreeCreate/Remove Hook**：替代 post-checkout git hook
7. **生成脚本分层**：核心 vs 实验性，减少 repo:sync 主链路负担
8. **contributor-guide.md**：新贡献者入门文档

### Phase 3 — CI/CD 闭环（5-7 天）

9. **claude-code-action**：PR 自动审查
10. **repo:check GitHub Action**：push 时自动校验合同一致性
11. **Stop Hook**：任务完成前的完整性检查

### Phase 4 — 探索性（按需）

12. Scheduled Tasks：定期 spec drift 检测
13. Agent Teams：并行研究实验
14. MCP Elicitation：交互式用户输入收集

---

## 六、生态数据快照（2026-04）

- Claude Code 插件生态已有 **9,000+** 插件
- 最热门插件安装量：Frontend Design 96K、Context7 71K、Ralph Loop 57K
- MCP SDK 累计下载 **9,700 万次**，400+ 社区 MCP Server
- Hook 事件从 14 种扩展到 **28 种**
- 主要 Awesome 列表：`rohitg00/awesome-claude-code-toolkit`（最全面）、`hesreallyhim/awesome-claude-code`（最知名）
