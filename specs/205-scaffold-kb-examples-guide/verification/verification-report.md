# Verification Report — F205 scaffold-kb 实战示例扩充

> 模式：story｜scope：SMALL（纯文档）｜验证级别：Level 0（docs-only）

## 验收对照（spec.md AC1–AC7）

| AC | 内容 | 证据 | 结论 |
|----|------|------|------|
| AC1 | 导入文档段（office/url/minutes）+ 真实预览 + 两步安全流 + 退出码 | guide §4；实测 minutes dry-run/--yes、office-docx dry-run/--yes、url/minutes 命令面 | ✅ |
| AC2 | build + query 扩充（json/probe/双层命中真实输出） | guide §1/§3；实测 build --no-llm、query md/json/probe、dual-layer | ✅ |
| AC3 | F191 接入工作流段（knowledge_sources + 预查行为） | guide §5；对 `project-context-template.yaml:45-50` + `kb-prequery.mjs` 核对 | ✅ |
| AC4 | 端到端 worked example 实测跑通 | guide §6；从 repo 根实跑 ingest→query→exit 0 | ✅ |
| AC5 | 通用定位 / 结构不破坏 / 语言一致英文 | grep 无客户绑定；现有段落保留；扩充段全英文 | ✅ |
| AC6 | repo:check + docs 同步 + 交叉链接一致 | `[repo-check] status=pass`；未触 docs/shared；guide↔cli-reference 锚点核对 | ✅ |
| AC7 | dogfooding 四维度反馈节 | 见交付报告反馈节 | ✅ |

## 实测命令清单（全部真实跑通，输出已引入 guide）

| # | 命令 | 关键输出 |
|---|------|---------|
| 1 | `build --dir /tmp/mini-docs --output /tmp/mini-kb --no-llm` | `构建完成：2 文档 / 2 chunk / 2 实体（heuristic）` |
| 2 | `ingest --minutes … --dry-run` | `✓ … (minutes)` + `--dry-run：仅预览，不落库` |
| 3 | `ingest --minutes … --yes` | `✓ 已落库 → <path>` |
| 4 | `ingest --file vendor-spec.docx --dry-run/--yes` | `✓ … (office-docx)` + 落库 |
| 5 | `query … --format markdown` | untrusted-evidence envelope + `[KB-EVIDENCE doc_id src built_at]` |
| 6 | `query … --format json` | `{"query":"…","results":[{chunkId,docId,contentRaw}]}` |
| 7 | `query --probe` | `scaffold-kb-query:1` |
| 8 | dual-layer `query --vendor-kb … --project-kb …` | `src="project"` + `src="vendor"` 合并命中, exit 0 |

> 真实办公文档实测：手工构造最小合规 `.docx`（zip + document.xml）→ office-parser 解析为
> `office-docx` 类型，证实 office 源链路（非编造）。

## 工具链验证

- `npm run repo:check` → `[repo-check] status=pass`（含 release-contract + plugin-sync 全部 pass）
- 命令面对源码 verify：`src/cli/commands/scaffold-kb.ts`（build/ingest/query/serve flag 一一对应）
- 自纠错：初稿 json `query` 字段误写为数组，实测为字符串 `"parameters path routing"`，已修正与真实 stdout 一致。
- 未触 `docs/shared/`，无需 `docs:sync:agents`。

## Codex 对抗审查

跑了一轮 codex 对抗审查（read-only，禁 worktree git 改动）。结论 **1 CRITICAL + 5 WARNING + 4 INFO**，
全部对源码核实后**真实有效，已逐条修复**：

| 档 | 发现 | 核实（源码） | 修复 |
|----|------|------------|------|
| CRITICAL | 文档称 office 支持 `xlsx`，实为 `pdf` | `office-parser.ts:16,202`（`OfficeFormat='docx\|pptx\|pdf\|md'`）+ `types.ts:41-43`（`office-pdf`） | `xlsx`→`pdf`，补 fflate/unpdf 说明（guide+cli-reference） |
| W1 | JSON 样例字段不全 | `search-core.ts`/`result-merger.ts` results 含 docTitle/score/sdkVersion/builtAt/sourceKind | 标注"Excerpt"+列出额外字段 |
| W2 | 误称 `[KB-EVIDENCE]` block 携带 sdk_version | `evidence-envelope.ts:39`（仅 doc_id/src/built_at）；`injection-format.ts:52`（sdk_version 在 `[来源 N]` 行） | 改为"来源行带 sdk_version，KB-EVIDENCE 带 doc_id/src/built_at" |
| W3 | 注入样例漏 BEGIN/END wrapper + "exactly"过度 | `injection-format.ts:41-42`（恒加 header/footer）；`kb-prequery.mjs:116`（stdout 透传） | §3 补 wrapper 说明；§4/§6 注明 excerpt + 软化措辞 |
| W4 | "nothing is invented" 过度声称 | 正文含 `path/to/docs` 等占位路径 | 收窄为"每个**输出块**是真实捕获；占位路径命令是示意" |
| W5 | "always sees both"无条件声称 | `result-merger.ts:88`（仅 topK≥2 且双库命中才保各一条） | 补 `--top-k ≥ 2` 条件 + topK=1 取全局最高 |

修复后 repo:check 仍 `status=pass`；CRITICAL 的 `office-pdf` 为源码权威事实（未捏造 pdf 运行输出，
仅展示实跑的 docx 输出）。worktree 未被 codex 改动（stash 列表为他分支既有，非本轮）。

## 回归护栏（spec.md G1–G5）

- G1 命令真实可跑：✅（8 条命令全实测）
- G2 通用定位：✅（仅 Hono MIT + 合成纪要，无客户绑定）
- G3 增量不破坏：✅（现有段落保留，新增 §5/§6）
- G4 语言一致英文：✅
- G5 纯文档：✅（无 src/ 改动，未触 docs/shared）

## 结论

7/7 AC 达成，5/5 护栏满足，repo:check 绿。GATE_VERIFY：PASS。
