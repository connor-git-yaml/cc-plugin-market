# Tasks — F205 scaffold-kb 实战示例扩充

> 单文件主改（`docs/scaffold-kb-guide.md`）+ 1 处交叉链接核对（`docs/spectra-cli-reference.md`）。
> 纯文档，无生产代码。任务串行（同文件编辑）。

## T1 — 扩充 Build 段【FR-001】
- 在 §1 Build 增加：文档目录 / llms.txt / `--sdk-version --lang` / `--no-llm` 四种调用
- 附真实成功输出行（`构建完成：N 文档 / N chunk / N 实体（heuristic）→ path`）
- 保留现有 artifact 表与 flag 说明
- 验收：AC2 部分

## T2 — 重写/扩充 Import documents 段（ingest 实战）【FR-002，重点】
- 在 §4 Layer project knowledge 内展开 ingest 三源子小节：
  - office（`--file <doc>.docx`，office-docx 类型，office-parser/streaming/zip-bomb 守护）
  - url（`--url`，SSRF 安全：allow-list + IP-literal + 重定向重校验）
  - minutes（`--minutes <notes>.md`）
- 真实预览输出（`[scaffold-kb ingest] 预览: ✓ … 新增 N 文档 / N chunk / N 实体…`）
- 预览→确认两步安全流（`--dry-run` → `--yes`）+ 退出码语义（0/1/2）
- `--project-kb` 默认 `.spectra/kb` + untrusted evidence 消费
- 保留现有 SSRF/dual-layer 段
- 验收：AC1

## T3 — 扩充 Query 段【FR-003】
- §3 Query：补 `query` markdown 真实输出（untrusted-evidence envelope）+ json + `--probe`
- 补 KB MCP 三工具（kb_search/kb_doc_lookup/kb_api_lookup）在 agent 里的调用链示例
- 补厂商库/项目库**双层命中**真实输出（src=vendor/project provenance）
- 验收：AC2

## T4 — 新增「Plug into the spec-driver workflow (F191)」段【FR-004】
- `.specify/project-context.yaml` 的 `knowledge_sources` 配置块（enabled/vendor_kb/project_kb/top_k/max_inject_chars）
- specify 前预查注入行为：exit 恒 0、非阻断、untrusted evidence envelope
- 验收：AC3

## T5 — 新增「End-to-end worked example」段【FR-005】
- 用 Hono（MIT）demo fixture 走全链路：build（或用现成 fixture）→ ingest 合成纪要 → query 双层命中 → 指向 spec-driver 接入
- 每步附真实命令 + 真实输出片段
- 验收：AC4

## T6 — 交叉链接 + 通用定位核对【FR-006, G2/G3/G4】
- guide ↔ cli-reference 双向锚点核对；按需在 cli-reference 补 ingest 退出码/源要点
- 通篇扫无客户绑定、语言一致英文、现有段未被破坏
- 验收：AC5, AC6

## T7 — 验证 + dogfooding 反馈【AC6, AC7】
- `npm run repo:check` 绿
- 命令实测复核（已在会话内跑通，归档输出片段）
- 交付报告附 dogfooding 四维度反馈节
- 验收：AC6, AC7
