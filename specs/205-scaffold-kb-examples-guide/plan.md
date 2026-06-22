# Plan — F205 scaffold-kb 实战示例扩充

## 架构决策

纯文档增量扩充，不动生产代码、不动 `docs/shared/`（避免 sync 链路）。沿用现有 guide 的英文叙事
与 5 段结构，**在既有段内加深示例 + 新增 2 段（接入工作流、worked example）**，保持向后兼容。

### 事实源（已 verify，全部实测）

| 命令面 | 来源 | 实测输出要点 |
|--------|------|------------|
| `build` flags | `src/cli/commands/scaffold-kb.ts:134-157` | `[scaffold-kb] 构建完成：2 文档 / 2 chunk / 2 实体（heuristic）→ /tmp/mini-kb` |
| `ingest` 源/退出码 | `scaffold-kb.ts:76-128` + `ingest-core.ts` | 预览行 `✓ <origin> (minutes\|office-docx\|markdown-dir)`；`--project-kb` 默认 `.spectra/kb`；exit 0/1/2 |
| office 源类型 | `ingest/office-parser.ts` + `ingest-core.ts:100` | `office-docx/pptx/xlsx`，md 文件→`markdown-dir` |
| `query` flags | `scaffold-kb.ts:21-73` | markdown=untrusted-evidence envelope；json=`{query,results[]}`；`--probe`→`scaffold-kb-query:1` |
| 双层命中 | 实测 vendor=Hono + project=合成纪要 | `[来源 N] … src="vendor"\|"project"`；merge + freshness |
| F191 预查 | `kb-prequery.mjs` + story SKILL 6.6 + project-context-template.yaml:45-50 | `knowledge_sources.{enabled,vendor_kb,project_kb,top_k,max_inject_chars}`；exit 恒 0 |
| 公开 SDK fixture | `plugins/demo-kb-en/`（Hono, MIT） | `kb/`（doc-graph+chunks.sqlite+api-entities）+ `ingest-samples/meeting-notes.md` |

### guide 目标结构（扩充后）

1. When to use（不动）
2. **Build the KB**（扩充：4 种 build 调用 + 真实输出 + flag 说明）
3. Package as a plugin（不动）
4. **Query open-box**（扩充：query markdown/json/probe 真实输出 + MCP 三工具调用链）
5. **Layer project knowledge / Import documents**（重写为 ingest 实战：office/url/minutes + 两步安全流 + 退出码 + dual-layer 命中）
6. **【新增】Plug into the spec-driver workflow (F191)**（knowledge_sources 配置 + 预查注入）
7. **【新增】End-to-end worked example**（Hono fixture 全链路）
8. Boundaries & non-goals（不动 / 微调）
9. See Also（不动）

> 第 5 段现有标题是 "Layer project-specific knowledge"，ingest 实战与"分层"同源——保留分层叙事，
> 把 ingest 三源展开为可照做的子小节，**不删除**现有 SSRF/dual-layer 说明，只加深。

## 不做（non-goals）

- 不改 `src/`、不改 `docs/shared/`、不改 CLI 行为。
- 不新建中文版 guide（现有 guide 英文，扩充段一致英文；中文速查不在本次范围）。
- 不改 demo fixtures（只引用，不重建）。
- cli-reference 只在交叉链接 / ingest 要点层面对齐，不重写其 scaffold-kb 段。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 编造未实测的 flag/输出（G1） | 所有命令已在本会话实测，输出直接引自真实 stdout |
| office docx 没有现成 fixture 实测 | 用真实 `office-docx` 类型标签（源码确证）；示例文件名占位但命令面真实；md 文件实测覆盖 ingest 链路；明确标注 office 走 office-parser |
| 客户绑定（G2） | 仅用 Hono（MIT）+ 合成纪要（fixture 自带"synthetic, no customer"声明） |
| 破坏现有结构（G3） | 增量编辑，保留现有段落原文，新增段追加 |

## 验证策略（增量验证 Level 0：纯文档）

- `npm run repo:check`（含 release contract + plugin sync 校验）
- docs 同步链路：本次不动 `docs/shared/`，故无需 `docs:sync:agents`；确认无意外触及。
- 命令实测：build/ingest(dry-run+yes)/query(markdown+json+probe)/dual-layer 均已在本会话跑通。
- 链接一致性：guide ↔ cli-reference 双向锚点核对。
