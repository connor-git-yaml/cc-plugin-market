# Spectra Skills Runtime-中立性扫描记录

**目的**：验证 spec.md FR-004 的假设——`plugins/spectra/skills/` 下 3 个 SKILL.md 内容不含 Claude 专属工具引用，可被 `.codex-plugin/plugin.json` 直接复用（无需像 Spec Driver 那样生成独立 Codex 适配目录）。对应 `clarifications.md` 澄清点 1 的 NON-BLOCKING 默认解释要求的前置校验步骤。

**扫描范围**：`plugins/spectra/skills/**`（`spectra` / `spectra-batch` / `spectra-diff` 三个 SKILL.md，均已确认无子文档，`Glob plugins/spectra/skills/**` 仅返回这 3 个文件）

**扫描方式**（T008 复跑校正——原记录的 `grep -rn "..."` 是错误语法：`grep` 不支持 `|` 交替除非加 `-E`，且引号内 `|` 会被当作字面字符，plan 阶段该命令实际并未按预期做交替匹配；改用 ripgrep 的 `-n` + 单引号 regex，交替语义正确）：

```
rg -n 'Task tool|mcp__plugin_|AskUserQuestion|Task\(' plugins/spectra/skills
```

**结果**（2026-07-20 T008 实际复跑）：`exit=1`（ripgrep 无匹配返回退出码 1）、stdout 为空、stderr 为空——三个 SKILL.md 均无任何**硬阻断**类 Claude 专属工具调用依赖（`Task tool` / `mcp__` 命名空间前缀 / `AskUserQuestion` 均零命中）。

### 第二轮扫描（Codex 审查 W1 补——slash-invocation 与 `$ARGUMENTS` 占位符）

第一轮 pattern 只覆盖"硬阻断"四类，会漏掉另一类 Claude Code 专属语法：slash-command 调用示例（`/spectra` 系列）与 `$ARGUMENTS` 占位符。补一轮扫描如实记录其真实命中：

```
rg -n '/spectra|\$ARGUMENTS' plugins/spectra/skills
```

**结果**（2026-07-20 实际执行，`exit=0`，共 9 处命中）：

| 文件:行 | 命中内容 | 类别 |
|---|---|---|
| `spectra/SKILL.md:16` | `$ARGUMENTS` | frontmatter/正文占位符 |
| `spectra/SKILL.md:29` | ``Interpret `$ARGUMENTS` to determine the analysis target`` | `$ARGUMENTS` 占位符 |
| `spectra/SKILL.md:74` | `- 使用 /spectra-batch 批量生成全项目 Spec` | slash 示例（说明文字） |
| `spectra/SKILL.md:75` | `- 使用 /spectra-diff 检测 Spec 漂移` | slash 示例（说明文字） |
| `spectra/SKILL.md:177` | ``通过 `/spectra` 生成单模块 spec 后…`` | slash 示例（说明文字） |
| `spectra-batch/SKILL.md:15` | `$ARGUMENTS` | 占位符 |
| `spectra-diff/SKILL.md:16` | `$ARGUMENTS` | 占位符 |
| `spectra-diff/SKILL.md:34` | ``If spec file doesn't exist, suggest running `/spectra` first.`` | slash 示例（说明文字） |
| `spectra-diff/SKILL.md:82` | ``…这将运行 `/spectra` 并使用现有 spec 作为基线。`` | slash 示例（说明文字） |

`/spectra` `/spectra-batch` `/spectra-diff` 是 Claude Code slash-command 语法，`$ARGUMENTS` 是 Claude Code skill 的参数注入占位符——Codex 的技能选择/参数语法不同（frontmatter description 驱动选技能、body 文本驱动理解行为）。因此这些**确实是** Claude 侧语法，第一轮"零 Claude 专属引用"的表述过强。

## 结论（分级表述，Codex 审查 W1 修订）

FR-004 的**复用决策成立**，但结论按依赖强度分级如实记录：

- **无硬阻断依赖**：3 个 SKILL.md 均无 `Task tool` / `mcp__` 命名空间前缀 / `AskUserQuestion` 这类会让技能在 Codex 运行时"调不动工具"的硬绑定（第一轮扫描 `exit=1` 零命中实证）。
- **存在 9 处 slash-invocation 示例与 `$ARGUMENTS` 占位符**（第二轮扫描明细）：这些是**调用语法的示例文本 / 参数占位符**，而非运行时工具依赖。Codex 按 frontmatter `description` 选技能、按 body 文本理解要做什么，slash 示例的语法差异属于"文本层面的优雅降级"（模型读到 `/spectra` 会理解为"运行 spectra 生成流程"，而非因语法不识别而中断），不构成对直接复用的硬阻断。
- 工具引用其余部分：`spectra` CLI 命令行调用（`spectra generate` / `spectra batch` / `spectra diff`，运行时中立）与 MCP 工具名裸引用（`panoramic-query`、`graph_query` 等简写，**不含** `mcp__plugin_spectra_spectra__` 前缀），Codex 与 Claude 均可理解/执行。

因此 `plugins/spectra/.codex-plugin/plugin.json` 使用 `"skills": "./skills/"` 直接指向既有 canonical 目录是**当前可接受**的方案，已知局限（slash/`$ARGUMENTS` 语法为 Claude 侧示例）如实记录。**升级路径**：若未来在本机/CI 用真实 codex binary 实测发现 Codex 对这些示例语法存在理解偏差导致技能行为退化，则把 spectra 也切到与 Spec Driver 同款的 `skills-codex/` 适配目录（A 轨后续 feature），届时可在适配拷贝中把 slash 示例改写为运行时中立表述。

## 后续护栏建议（已纳入 plan.md 决策 3）

该结论是**当前时点**的静态扫描结果，不构成对未来的保证。为防止后续有人在 Spectra SKILL.md 中无意引入**硬阻断**类 Claude 专属工具名而破坏这一直接复用路径，plan.md 设计了一条 `warn` 级一致性矩阵 check（`spectra-skill-neutrality`），对第一轮的**四类硬标记**（`Task tool` / `mcp__` 前缀 / `AskUserQuestion` / `Task(`）做永久化、自动化的回归护栏。

**pattern 边界说明（供 T014/T015 实现该 check 时遵循）**：`spectra-skill-neutrality` warn check 的 pattern **只保留上述四类硬标记，切勿把 `/spectra` slash 示例或 `$ARGUMENTS` 加进 pattern**——当前 canonical 目录本就合法含 9 处此类示例文本，若纳入 pattern 会对现状立即 warn 成噪声。slash 示例与 `$ARGUMENTS` 属**已知接受项**（本文档第二轮扫描已存证），实现该 check 时应在其 evidence 说明或 contract 注释里指回本 research 文档，注明"slash 示例 / `$ARGUMENTS` 为已知接受项，不入告警 pattern"。
