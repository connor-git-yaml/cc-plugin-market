# Spectra Skills Runtime-中立性扫描记录

**目的**：验证 spec.md FR-004 的假设——`plugins/spectra/skills/` 下 3 个 SKILL.md 内容不含 Claude 专属工具引用，可被 `.codex-plugin/plugin.json` 直接复用（无需像 Spec Driver 那样生成独立 Codex 适配目录）。对应 `clarifications.md` 澄清点 1 的 NON-BLOCKING 默认解释要求的前置校验步骤。

**扫描范围**：`plugins/spectra/skills/**`（`spectra` / `spectra-batch` / `spectra-diff` 三个 SKILL.md，均已确认无子文档，`Glob plugins/spectra/skills/**` 仅返回这 3 个文件）

**扫描方式**：

```
grep -rn "Task tool|mcp__plugin_|AskUserQuestion|Task\(" plugins/spectra/skills/
```

**结果**：`No matches found`（零匹配，2026-07-20 执行）。

## 结论

FR-004 假设**成立**。3 个 SKILL.md 的全部工具引用均为：

- `spectra` CLI 命令行调用（`spectra generate` / `spectra batch` / `spectra diff` 及其 flag），运行时中立，Codex 与 Claude 均可执行
- MCP 工具名的裸引用（如 `panoramic-query`、`graph_query`、`graph_node`、`graph_path`、`graph_community`、`graph_god_nodes`、`graph_hyperedges`），文档中以简写形式出现（供人类/模型理解语义），**不含** `mcp__plugin_spectra_spectra__` 这类 Claude Code MCP 命名空间前缀字符串
- 无任何 `Task tool` / `Task(...)` / `AskUserQuestion` 字样

因此 `plugins/spectra/.codex-plugin/plugin.json` 可安全使用 `"skills": "./skills/"` 直接指向既有 canonical 目录，无需第二套 Codex 适配拷贝。

## 后续护栏建议（已纳入 plan.md 决策 3）

该结论是**当前时点**的静态扫描结果，不构成对未来的保证。为防止后续有人在 Spectra SKILL.md 中无意引入 Claude 专属工具名而破坏这一直接复用路径，plan.md 设计了一条 `warn` 级一致性矩阵 check（`spectra-skill-neutrality`），对同一扫描逻辑做永久化、自动化的回归护栏，而非仅停留在本次一次性人工验证。
