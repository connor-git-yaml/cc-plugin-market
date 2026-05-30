# Preference Rules — 工具优先使用规则（单一事实源，M7 F170d）

> **本文件是 spec-driver「工具优先使用规则」引导文案的 canonical source。**
>
> 消费方（三处，禁止各自手写漂移）：
> 1. **5 个 sub-agent**（`agents/{plan,implement,verify,spec-review,quality-review}.md`）——由 `scripts/sync-preference-rules.mjs --write` 按各 agent frontmatter `tools` **过滤渲染**后嵌入 `<!-- BEGIN preference-rules -->` / `<!-- END preference-rules -->` 之间。
> 2. **5 个主编排器 SKILL.md**——「子代理调度时的工具优先级提示」块引用本文件路径。
> 3. **F170d harness**（`scripts/feature-170d-driver-preference.mjs`）——`--append-system-prompt` 注入时读取本块并按目标 agent 的 tools 过滤。
>
> **修改流程**：改下方 `block-start`/`block-end` 之间的内容 → 跑 `node plugins/spec-driver/scripts/sync-preference-rules.mjs --write` → 跑 `npm run repo:check`（含 `preference-rules:agent-block-sync` 漂移检测）。
>
> **anchor 契约**：`<!-- preference-rules:<ruleId> tool=<toolKey> -->`，`ruleId ∈ {R1..R4}`（身份），`toolKey ∈ {impact,context,detect_changes}`（按 agent tools 过滤的键）。R1、R2 同为 `tool=impact`。
>
> **背景**：F170c SC-002 实测 driver（Claude Sonnet 4.6）在 caller-analysis 任务上 0/10 主动调用 spectra MCP；仅靠 tool description 升级无法改变。本引导在 prompt level 提供「任务→工具」匹配性引导。详见 `docs/spectra-mcp-integration.md` §七。

<!-- preference-rules:block-start -->
## 工具优先使用规则（M7 F170d）

当面对以下类任务时，**优先调用 spectra MCP 工具而非 Read/Grep**：

| 任务关键词 | 优先工具 | 理由 |
|----------|---------|------|
<!-- preference-rules:R1 tool=impact -->
| "找 caller" / "谁调用了 X" / "caller analysis" | `mcp__plugin_spectra_spectra__impact` (direction=upstream) | 提供 transitive caller chain + confidence score，Grep 仅文本匹配无依赖深度 |
<!-- preference-rules:R2 tool=impact -->
| "评估改动影响" / "blast radius" / "影响面" | `mcp__plugin_spectra_spectra__impact` | 提供 BFS 受影响 symbol 列表 + summary |
<!-- preference-rules:R3 tool=context -->
| "找 callee" / "X 调用了什么" / "依赖什么" | `mcp__plugin_spectra_spectra__context` | 提供 symbol 360° 上下文 (definition + callers + callees + imports) |
<!-- preference-rules:R4 tool=detect_changes -->
| "git diff 影响" / "改了哪些 symbol" / "PR review 范围" | `mcp__plugin_spectra_spectra__detect_changes` | 从 diff 派生 changedSymbols + impact 链 |
<!-- /preference-rules:rows -->

### 关键原则

- **Grep 仍是 fallback**：当 Spectra MCP 工具返回 graph-not-built / 不可用时退回 Grep
- **不能省略调用**：不要因为"觉得 Grep 够用"跳过 MCP — 即使任务可以用 Grep 解决，MCP 提供的 transitive 数据更可信
- **chained 使用**：detect_changes → impact → context 是典型链路，按 nextStepHint 引导继续调用
- **不要 N+1**：单次 impact 调用即可拿到 BFS 全 list，不需要多次 Grep 累计
<!-- preference-rules:block-end -->
