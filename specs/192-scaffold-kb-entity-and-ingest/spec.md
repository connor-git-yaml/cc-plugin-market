---
feature: 192-scaffold-kb-entity-and-ingest
title: scaffold-kb Phase 2 — API 实体层 + 三方异构导入 + 冲突仲裁
status: draft
phase: specify
depends_on:
  - specs/190-scaffold-kb-mvp/spec.md          # Phase 1 底座（doc-graph / chunks.sqlite / KB MCP / 双层联查 / untrusted-evidence）
  - specs/191-scaffold-kb-research-injection/spec.md  # Phase 1.5（evidence-envelope 共享 / 预查注入）
related:
  - specs/189-ast-anchored-spec-drift-detection/spec.md  # 锚定引擎（未发布）：本期文档自抽取实体替代，待其落地补精确锚定
---

# Feature 192 — scaffold-kb Phase 2：API 实体层 + 三方异构导入 + 冲突仲裁

## 1. 背景与动机

### 1.1 问题陈述

Phase 1（F190）让集成商**开箱即得**厂商 SDK 文档的全文检索（`kb_search`）与文档级导航（`kb_doc_lookup`），Phase 1.5（F191）让 spec-driver 在需求研究阶段**确定性预查**注入 KB 上下文。但仍存在三个集成商高频痛点未覆盖：

1. **写代码前难以快速确认 API 用法**：`kb_search` 返回的是文档片段，集成商要"这个接口叫什么、参数是什么、是否已废弃、从哪个版本起可用"时，只能自己读片段归纳，无结构化实体可查。F190 已为此预留工具名 `kb_api_lookup`（AR-001），但 Phase 1 不实现。
2. **两库冲突只能双呈现、不能给建议**：F190 对厂商库/项目库内容冲突采用"双呈现 + 标来源/时间戳、不自动仲裁"（AR-002）。集成商拿到两条矛盾说法仍需自己判断，缺少"按版本/时效/置信度给出推荐"的决策辅助。
3. **知识来源被限定为厂商官方文档**：F190 只吃 llms.txt / Markdown 目录。集成商手里的现场知识（内部 Wiki 页面 URL、办公文档、会议纪要里的口头约定）无法纳入项目库，导致"项目级补充知识"这一层（F190 场景 C）的来源面过窄。

### 1.2 目标

- **API 实体层**：厂商构建期从文档**自抽取** API 实体（名称/签名/参数/返回/废弃/起始版本），落 `kb/api-entities.json`；运行期 `kb_api_lookup` 提供精确 + 模糊实体查询、**据文档的**参数/废弃检查（evidence-grade，**非对照集成商实际安装的 SDK 代码/版本**）。
- **冲突仲裁升级**：把 Phase 1 的"固定双呈现"升级为"版本/时效/置信度加权 → 推荐 + 备选"，**不写死 vendor > project**（AR-002）。
- **三方异构导入全量**：新增 `scaffold-kb ingest` 把 URL 网页 / 办公文档（.docx/.pptx/.pdf/.md）/ 会议纪要（自由文本）纳入**项目库**，带入库前预览确认与质量/安全护栏。

### 1.3 诚实边界（硬约束，贯穿全 spec）

> **本期 API 实体是"文档自抽取"，不是"与真实 SDK 代码对齐"。** F190 原计划把实体层"与 F189 锚定引擎合流"以获得文档↔代码符号精确锚定；但 F189 当前仅立项（spec + prototype），未发布、上线时间未定（见 `related`）。经用户决策（实体层路线 = 文档自抽取先做），本期：
>
> - 实体来源仅为**厂商文档文本**，经 LLM/启发式抽取，标 `extraction_method` + `confidence`，属**证据级（evidence-grade）**，**非代码级保证**；
> - `kb_api_lookup` 的参数校验/废弃检测是"**按文档所述**校验"，**不暗示**能对照集成商实际安装的 SDK 版本或二进制做验证；工具 description 必须明确这一边界，**不得 over-claim**；
> - 文档实体 ↔ SDK 真实符号的**精确 AST 锚定**留待 F189 落地后的后续 feature 补齐（见 §7）。

### 1.4 通用定位约束（硬约束，入库产物）

> 沿用 F190 §1.3 / 项目 CLAUDE.md 红线：所有入库产物（spec/代码/测试/demo/FIXTURE/文档）**不得**出现具体客户/公司名、行业绑定或客户专属信息。三方导入能力（含会议纪要/办公文档）以**通用能力**描述；demo fixture 与测试样本**必须使用公开内容或显式合成的通用样本**，**严禁**使用任何真实客户的会议纪要/内部文档。通用技术品类（PaaS SDK / docx / PDF / readability / FTS5）属可用表述。

---

## 2. 用户场景

### 场景 A — SDK 厂商：构建带 API 实体层的知识库 plugin（P1）
厂商在 `scaffold-kb build` 时除产出 doc-graph + chunks.sqlite 外，额外离线抽取 `api-entities.json`。构建期可调 LLM（提质）或纯启发式（零成本/无认证）。分发后集成商安装即得"可结构化查询的 API 实体表（据文档抽取，证据级）"。

### 场景 B — 集成商工程师：写代码前校验 API（P1）
集成商在实现某需求前问 `kb_api_lookup`："`createChart` 这个接口的参数？是否已废弃？" 工具返回签名/参数/废弃标记/起始版本（带来源文档锚点与时效），并明确标注"据厂商文档 v1.2，非对照你本地 SDK"。

### 场景 C — 集成商工程师：把现场知识导入项目库（P1）
集成商把内部规范页面 URL、一份办公文档、一次评审会议纪要通过 `scaffold-kb ingest` 导入**项目库**。入库前 CLI 展示预览（将新增 N 文档 / M chunk / K 实体），确认后落库；之后 `kb_search` / `kb_api_lookup` 联查即可命中这些项目侧补充。

### 场景 D — 集成商工程师：拿到带推荐的冲突结论（P1）
当厂商库说"参数 `timeout` 单位秒"、项目库笔记说"实测要传毫秒（v1.1 适配）"时，仲裁按"项目库更新、针对具体版本、高置信度"给出**推荐项 + 推荐理由**，同时保留厂商库原说法作为备选，并标明两者来源与时效。

---

## 3. 关键实体（Key Entities）

### 3.1 知识库产物布局（`kb/` 目录，扩展 F190 §3.1）

```
kb/
├── doc-graph.json      # F190：文档结构图
├── chunks.sqlite       # F190：FTS5 全文检索层（本期 chunk_meta 增 source provenance 列）
├── api-entities.json   # 【本期新增】API 实体表（文档自抽取，证据级）
└── (可选) code/graph.json   # F190：spectra batch 产物，本 CLI 不重做
```

### 3.2 api-entities.json 结构契约【新增】

```json
{
  "schema_version": "1.0",
  "built_at": "<ISO 8601>",
  "sdk_version": "<厂商声明版本，可选>",
  "source_kind": "vendor | project",
  "entities": [
    {
      "id": "<稳定唯一 id：qualified_name + kind + overload_key 归一后的 hash/串>",
      "name": "createChart",
      "qualified_name": "echarts.init.createChart",  // 文档侧限定名（含 namespace/容器路径），无则等于 name
      "container": "<所属 class/module/namespace，可选>",
      "overload_key": "<同名重载消歧键，如参数签名摘要，可选>",
      "kind": "function | method | class | constant | type | endpoint | error_code | event",
      "signature": "<原样签名串，可选>",
      "params": [
        { "name": "options", "type": "<可选>", "required": true, "doc": "<参数说明，可选>" }
      ],
      "returns": "<可选>",
      "deprecated": { "is_deprecated": false, "since": "<可选>", "replacement": "<可选>" },
      "since_version": "<起始版本，可选>",
      "source_doc_id": "<doc-graph 节点 id>",
      "source_chunk_id": "<primary 证据 chunk id（chunks.sqlite 中，用于回溯原文 + token cap）>",
      "source_chunk_ids": ["<证据链跨多 chunk 时的全部 chunk id，可选；签名/参数跨段时用>"],
      "source_anchor": "<段落/章节锚点，可选>",
      "evidence_quote": "<抽取依据的原文片段，截断至 token cap 内，可选>",
      "lang": "zh | en | ...",
      "confidence": 0.0,
      "extraction_method": "llm | heuristic"
    }
  ]
}
```

> **隔离与诚实（R-ENT-1）**：`api-entities.json` 与 `_meta/graph.json`（Spectra 代码图谱）**物理分离、语义不同**——前者是"文档所述的 API"，后者是"代码里真实存在的符号"，二者**不交叉引用、不合并**（精确锚定留 F189）。
>
> - **C-3 修正**：`extraction_method` 本期**仅** `llm | heuristic` 两值；**不含** `ast-fallback`——读取代码图谱/AST 即引入 F189 耦合，与"本期文档自抽取、不依赖 F189"硬边界冲突。未来 F189 落地后通过 `schema_version` 升级新增 `ast-anchored`。
> - **W-2 修正**：实体身份由 `qualified_name`（文档侧限定名）+ `kind` + `overload_key` 共同确定，使同名方法/多语言重载在**不依赖 F189**的前提下也能区分；`id` 是三者归一后的稳定串。
> - **W-9 修正**：每条实体 MUST 携带 `source_chunk_id`（primary 证据 chunk），使 `kb_api_lookup` 能回溯原始证据并复用 chunk 级 token cap；证据链跨多 chunk（签名/参数跨段，见 plan §1.1 window 抽取）时**可选** `source_chunk_ids[]` 列全部证据 chunk；`evidence_quote` 为可选截断原文。chunk id **仅承诺同一次 KB build 内可回溯**（依赖切分，rebuild 可能变）。均为 KB 内部引用，**不**指向 `_meta/graph.json`，不破坏隔离。
> - **I-1 修正**：`confidence` 取值域 `0.0 ≤ confidence ≤ 1.0`；读取时越界值 MUST clamp 到 [0,1]，非数值 MUST 视为缺失（按缺失默认处理，见 §3.4）。
> - 每条实体 MUST 携带 `confidence` + `extraction_method`，消费侧据此判断可信度。

### 3.3 chunk_meta 表扩展（source provenance，扩展 F190 §3.3）

```sql
-- 新建库（本期项目库 / 重建的厂商库）的 chunk_meta 含三列 provenance：
--   ingest_source_type TEXT  -- 'llms-txt' | 'markdown-dir' | 'url' | 'office-docx' | 'office-pptx' | 'office-pdf' | 'minutes'
--   ingest_origin      TEXT  -- 原始 URL / 文件名（脱敏后）
--   ingested_at        TEXT  -- 导入时间戳（ISO 8601）；厂商构建内容沿用 built_at
```

> **R-ING-1**：三方导入的每个 chunk MUST 携带 provenance（来源类型 + 来源标识 + 导入时间），使检索结果能区分"厂商官方文档" vs "项目导入的网页/办公文档/纪要"，并参与仲裁的时效判断。
>
> **R-COMPAT-1（C-1 修正，硬约束）**：F190 已分发的 demo/厂商 sqlite（旧库、只读）**没有**这三列，对其执行显式列名 SELECT 会 `no such column` 直接抛错。因此：
> - 所有读取路径 MUST 先做 **schema 探测**（`PRAGMA table_info(chunk_meta)`）判断列是否存在；缺列时用**默认投影**（`NULL AS ingest_source_type` 等）而非显式选列，保证旧库零改动可读；
> - 写入路径仅作用于**新建/可写项目库**（一律含三列），**不**对旧只读厂商库做 `ALTER`（厂商库只读，FR-017）；
> - MUST 新增**旧 F190 库兼容测试**：用一份 F190 时代 schema 的 sqlite fixture（无三列）跑 `kb_search`/`kb_doc_lookup`/`kb_api_lookup` 全路径，断言不抛 `no such column`、provenance 字段优雅返回缺省。

### 3.4 仲裁结果标注契约（扩展 F190 §3.4 双层联查）

Phase 1 联查对冲突"双呈现、不仲裁"。Phase 2 升级仲裁，但**仲裁范围按数据结构化程度分两档**（C-2 修正）：

**档 A — `kb_api_lookup` 实体级仲裁（完整加权）**：实体是结构化的（有 `confidence`、`since_version`、可比的 `signature`/`params`/`deprecated`），冲突可机械判定（同 `id`/`qualified_name` 但关键属性不同）。仅此路径产出"推荐项"：

```jsonc
// kb_api_lookup 结果项在冲突场景下新增字段
{
  "...": "原有实体字段（name/qualified_name/signature/params/deprecated/source_kind/sdk_version/built_at/confidence 等）",
  "arbitration": {
    "recommended": true,                 // 仲裁推荐项（每个冲突组至多一个 true）
    "score": 0.82,                       // 加权得分（版本匹配度/时效/confidence）
    "reason": "项目库实体针对 sdk_version v1.1 适配、confidence 0.9 高于厂商库泛化说法 0.6",
    "group_id": "<冲突组 id，同组成员共享>"
  }
}
```

**档 B — `kb_search` 全文检索（仅时效提示，不产推荐）**：chunk 是非结构化自由文本，**没有** `confidence`、也没有可机械比较的"关键值"，无法计算实体级加权。因此 `kb_search` **保持 Phase 1 双呈现**，只在两库出现**同 `doc_id`** 的对应内容时附加一个**时效提示**（按 `built_at`/`ingested_at` 标注哪条更新），**不**输出 `recommended`、**不**做内容矛盾判定：

```jsonc
// kb_search 冲突场景：仅时效提示，无 recommended
{ "...": "原有 chunk 字段", "freshness_hint": { "newer": true, "built_at": "2026-05-...", "group_id": "..." } }
```

> **R-ARB-1（不写死优先级，AR-002）**：档 A 仲裁分由 {版本匹配度, 时效, confidence} 加权得出，**不**硬编码 `vendor > project`；`source_kind` 至多作为可配置次要权重，默认不主导。
>
> **R-ARB-2（W-7 修正，缺失字段默认 + tie + 时效不可单独翻盘）**——spec 级固化，不留 plan：
> - **缺失字段处理（默认中性化，时效维为显式例外）**：缺 `confidence` → 置信度维**中性化**（不参与、不按 0 计，避免缺失即输）；缺 `since_version`/`sdk_version` → 版本匹配维**中性化**。**唯一例外——时效维**：缺 `built_at`/`ingested_at` **不中性化**，而是按"最旧"参与排序——因为"未知时间不得赢得时效优势"是安全语义（防无时间戳的内容靠时效翻盘），这是有意为之的非对称规则，不是与中性化冲突。
> - **tie 规则**：两侧加权分差 < ε（ε 具体值 plan 定，spec 要求存在该阈值）→ 判为并列 → `recommended` 全 false，回退双呈现（合法降级，非违例）。
> - **时效不可单独翻盘（防低质新笔记压过官方文档）**：推荐项 MUST 在**版本匹配度或 confidence 至少一个主维**占优；**单凭"更新更近"不足以**成为推荐项。
> - 全部 tie/缺失/单维场景 MUST 有对应冻结评测断言（FR-018 / SC-004）。

---

## 4. 功能需求（Functional Requirements）

### FR-001：`scaffold-kb build` 扩展 —— 产出 api-entities.json [必须]
`build` 在产出 doc-graph + chunks.sqlite 后，MUST 额外抽取 API 实体写 `kb/api-entities.json`：
- 抽取输入为已构建的 doc chunk 文本（不另读原始文件，复用 chunk 切分结果）
- 默认走 **LLM 抽取**（厂商构建期，提质）；**MUST** 提供 `--no-llm`（或无认证时自动）的**确定性 fallback**（启发式：代码块/签名模式/标题命名约定），fallback 产物 `extraction_method=heuristic`、`confidence` 相应降低
- **成本护栏**：抽取 MUST 有 token/批量上限与进度可观测；超限时按文档优先级截断并在产物记录覆盖率，不静默吞
`[必须]`

### FR-002：api-entities.json 结构与隔离契约 [必须]
产物 MUST 符合 §3.2 schema（`schema_version` 必填），与 `_meta/graph.json` 物理分离、不交叉引用（R-ENT-1）；每条实体 MUST 含 `id`（稳定唯一，FR-018 评测按此比对）+ `qualified_name` + `kind` + `confidence`（0~1）+ `extraction_method`（仅 `llm|heuristic`）+ `source_doc_id` + `source_chunk_id`。
`[必须]`

### FR-003：文档自抽取实体的诚实边界 [必须]
系统 MUST NOT 暗示实体经过代码级校验：
- `api-entities.json` 与 `kb_api_lookup` 输出/工具 description MUST 声明"据厂商文档抽取，非对照实际 SDK 代码/版本"
- 不得出现"已验证 / verified / 保证存在"等代码级断言措辞
- 精确 AST 锚定明确标注为后续（F189 依赖）
`[必须]`

### FR-004：`kb_api_lookup` 工具 —— 实体查询 [必须]
KB MCP server MUST 注册 `kb_api_lookup`（名称由 F190 AR-001 预留）：
- 输入：`api_name`（必填，支持精确 + 模糊）、`kind`（可选过滤）、`container`（可选，按所属 class/module 限定，消歧 W-2）、`sdk_version`（可选）、`check_params`（可选，待校验参数名数组）
- 输出：匹配实体的 `id/name/qualified_name/container/overload_key/kind/signature/params/returns/deprecated/since_version/confidence` + 证据回溯 `source_doc_id/source_chunk_id/source_anchor/evidence_quote`，每条标 `source_kind` 与 `extraction_method`
- 模糊匹配多命中、或同 `qualified_name` 多重载时返回 top-N 候选并按 `container`/`overload_key` 标注区分（不静默取一条）
`[必须]`

### FR-005：`kb_api_lookup` —— 参数校验 + 废弃检测语义 [必须]
- 当 `check_params` 提供时，MUST 对照实体 `params` 给出"未知参数 / 缺必填参数 / 命中"逐项结果（**据文档**，非代码级，措辞遵 FR-003）
- 命中实体 `deprecated.is_deprecated=true` 时 MUST 在结果中给出废弃预警（含 `since` / `replacement`，若有）
- 实体缺失（查不到该 API）时 MUST 明确返回"文档中未找到该实体"，**不得编造**签名/参数（EC-001）
- **W-3 修正（降级模式不得给校验结论）**：当 `api-entities.json` 缺失/损坏，`kb_api_lookup` 回退到基于 `kb_search` 的文档级检索时，响应 MUST 显式标 `mode: "document_fallback"`，**只返回相关文档片段、不输出任何参数校验/废弃判定结论**（无实体表则无校验依据，给结论即 over-claim）
`[必须]`

### FR-006：`kb_api_lookup` —— 双层联查 + 信任边界 [必须]
- MUST 同时查厂商库 + 项目库 api-entities，结果合并并各标 `source_kind`（复用 F190 FR-009 双层语义）
- 输出 MUST 经 untrusted-evidence envelope（复用 F191 `evidence-envelope`），并遵守 **F190 FR-011** token cap（单条 ≤ 500 token、合计 ≤ 2500 token）
- **C-4 修正（结构化字段防注入逃逸，闭合规则，硬约束）**：实体与仲裁对象的**所有字符串类型字段一律（无例外）**经 `safeAttr`/`defangSentinel` 处理（复用 F191），**闭合规则**：凡值类型为 string 的字段（含 `name`/`qualified_name`/`container`/`overload_key`/`signature`/`params[].name`/`params[].type`/`params[].doc`/`returns`/`deprecated.since`/`deprecated.replacement`/`since_version`/`sdk_version`/`source_anchor`/`evidence_quote`/`arbitration.reason` 及未来新增的任何字符串字段）MUST defang，防止嵌入的 `[/KB-EVIDENCE]` 闭合 sentinel 或指令文本逃逸到 JSON 元数据区。实现 MUST 用"遍历对象对所有 string 字段统一 defang"而非逐字段手列（防字段新增时漏防）。证据正文（`evidence_quote` 等）MUST 落在全局 evidence boundary 内（复用 F191 `formatInjectionBlock` 的 BEGIN/END 边界）
`[必须]`

### FR-007：冲突仲裁升级 [必须]（范围按 §3.4 两档，C-2 修正）
- **`kb_api_lookup`（档 A，完整仲裁）**：同一实体在两库均命中且关键属性矛盾时（同 `id`/`qualified_name`，但 `signature`/`params`/`deprecated`/`since_version` 不同），MUST 按 §3.4 加权（版本匹配度/时效/confidence）计算仲裁分，标注**推荐项 + reason + group_id**，且**仍返回冲突双方**（不去重、不丢弃备选）
- **`kb_search`（档 B，仅时效提示）**：chunk 无 confidence、无可机械比较的关键值，MUST **保持 F190 双呈现**；仅当两库出现同 `doc_id` 对应内容时附加 `freshness_hint`（按 built_at/ingested_at），**不**输出 `recommended`、**不**做内容矛盾判定
- 冲突相似度/矛盾判定阈值由 plan 定，但其存在性由本 FR 约束
`[必须]`

### FR-008：仲裁策略不写死、可降级 [必须]
- 仲裁 MUST NOT 硬编码 `vendor > project`（AR-002）；`source_kind` 至多作为可配置的次要权重，默认不主导
- MUST 遵守 §3.4 **R-ARB-2** 的缺失字段中性化、tie 阈值回退、"时效不可单独翻盘"三条 spec 级规则
- 各维并列无法判定时 MUST 回退 Phase 1 双呈现（`recommended` 全 false），属合法降级而非违例
`[必须]`

### FR-009：`scaffold-kb ingest` 命令 —— 三方源导入入口 [必须]
新增 `scaffold-kb ingest` 子命令，把外部源导入**项目库**（可写层）：
- 输入：`--url <url>` | `--file <path>`（office/markdown）| `--minutes <path>`（自由文本纪要）；`--project-kb <path>`（目标项目库，默认 `.spectra/kb/`——与 Spectra 既有 `.spectra/` 运行态目录一致，plan 阶段对齐 F190 项目库定位合同确认）
- MUST 复用 F190 chunk 切分 + FTS5 写入 + （可选）实体抽取管线，产物结构与厂商库一致（差异仅 provenance 列）
- **MUST NOT** 写入厂商库（厂商库只读，F190 FR-013）
`[必须]`

### FR-010：URL 抓取导入 [必须]
- MUST 抓取 URL 主内容（去导航/广告/脚本），转 Markdown 后切 chunk 入库
- 网络不可达 / 超时 / 非 HTML / 抓取失败 MUST 降级（跳过该源 + 明确报错），**不阻断**已成功的其他源、不崩
- 抓取内容为 untrusted：MUST 经与文档内容相同的信任边界处理（defang on ingest + envelope on retrieval，FR-015）
- **C-5 修正（SSRF 防护是 MUST，不是 plan 可选项）**：URL 抓取是本 feature 唯一联网点，MUST 强制以下网络安全边界（违反即拒绝抓取，不降级吞掉）：
  1. **协议白名单**：仅 `http`/`https`；拒绝 `file://`/`ftp://`/`gopher://` 等
  2. **目标地址封锁**：解析目标 IP，拒绝 `localhost`/loopback、私网（10/8、172.16/12、192.168/16）、link-local（169.254/16、fe80::/10）、`0.0.0.0`、IPv6 ULA/mapped 形式
  3. **DNS rebinding 防护**：解析后校验最终连接 IP（不能只校验主机名），重定向后对新目标重新执行地址封锁
  4. **重定向限制**：最大跳数上限（plan 定具体值），跨协议降级（https→http）拒绝
  5. **超时 + 流式大小上限**：连接/读取超时；响应体边读边计字节，超上限即中断（防超大响应 OOM）
  6. **内容类型校验**：仅接受 HTML/markdown/纯文本类 content-type
- 上述边界 MUST 有对应安全测试用例（SC-007a）
`[必须]`

### FR-011：办公文档导入 [必须]
- MUST 支持 `.docx` / `.pptx` / `.pdf` / `.md` 文本抽取 → 切 chunk 入库
- 解析失败 / 加密 / 损坏 MUST 安全拒绝（明确报错），不崩、不阻断其他源
- **安全护栏（R-SEC-1，W-4 修正后的完整攻击矩阵）**：MUST 防御并对每项有测试覆盖（SC-007）：
  1. **zip bomb**：docx/pptx/任何 zip 容器的解压比 + 解压后总大小上限；超限即拒绝
  2. **XXE / DTD**：docx/pptx 内部 XML 解析 MUST 禁用 external entity、DTD、external DTD subset
  3. **zip path traversal**：拒绝含 `../`、绝对路径、盘符的 zip entry 名（防写出容器外）
  4. **Office 外部关系引用**：docx/pptx 的 relationships（`.rels`）中指向远程/本地文件的 external target MUST 忽略，不得触发抓取/读盘
  5. **PDF 对象流炸弹 / 超深嵌套**：输入字节上限（解析前）+ **外层超时 + 内存上限 + worker 隔离**兜底（PDF 解析库通常无公开"对象深度上限"API，故以资源边界 + 超时拦截恶意超深嵌套，而非声称库内 depth limit）；超限即中断拒绝
  6. **PDF 内嵌动作 / 文件**：仅 text-layer 抽取（`data`-only、禁 url/range/autoFetch、不渲染）；`/Launch`、`/OpenAction`、`/JavaScript`、embedded file MUST 不执行、不外联——通过轻量结构预扫描检出即拒绝/剥离 + 测试断言"不执行动作"（不空口依赖库行为）
  7. **解析器联网 / 读本地文件禁令**：所有 office 解析 MUST 在无网络、无任意本地文件读取的前提下完成（只读目标文件本身）
  8. **超大文件**：输入字节上限；超限拒绝
- 触发任一项即拒绝该源并报具体原因，不崩、不阻断其他源
`[必须]`

### FR-012：会议纪要 / 自由文本导入 [必须]
- MUST 支持纯文本/Markdown 纪要导入，按段落/标题切 chunk 入库，provenance 标 `minutes`
- 纪要内容为 untrusted（含潜在 prompt 注入），同 FR-015 处理
- **通用定位（§1.4）**：纪要导入为通用能力；demo/测试样本必须为公开或显式合成的通用内容
`[必须]`

### FR-013：导入预览确认 UX [必须]
- `ingest` 默认先**预览**：展示将新增的文档数 / chunk 数 / 抽取实体数 / 来源摘要，**不写库**
- 提供 `--yes`（跳过确认直接落库）与 `--dry-run`（只预览、永不落库）
- 落库 MUST 原子（临时构建 + rename，复用 F190 幂等写入），失败不留半成品
`[必须]`

### FR-014：导入质量护栏 [必须]
- **去重**：导入 chunk 与项目库现有 chunk 内容级去重（同内容不重复入库）
- **最小内容**：过滤空/超短 chunk（阈值 plan 定）
- **语言检测**：标 `lang`，与 CJK tokenizer 行为一致（复用 F190 FR-004）
- **provenance**：每 chunk MUST 写 §3.3 三列
`[必须]`

### FR-015：导入内容的信任边界 [必须]
- 所有导入内容（URL/office/纪要）MUST 按 untrusted-evidence 处理：入库不改变其"参考资料"地位，检索经 envelope 包裹（复用 F191），遵守 token cap
- 导入**不得**让外部内容以 instruction 形式进入任何工作流（沿用 F190 FR-011 + F191 防注入测试模式：恶意 sentinel/title/正文一律 defang）
`[必须]`

### FR-016：新解析依赖约束 [必须]（扩展 F190 FR-014）
office/URL 解析引入的依赖 MUST：
- **无原生编译**（纯 JS / WASM 优先），不抬高 `engines: node >=20`，跨平台装上即用
- 依赖数量与体积最小化；plan MUST 出**依赖审计**（每个候选库的 license/维护性/安全 CVE/体积/是否可随 plugin 分发）
- **PDF（D-004 已决）**：保留全量、授权第三方库实现，plan 选纯 JS/WASM、无原生编译、license 兼容的成熟 PDF 文本抽取库；**不分档、不降级**，与 docx/pptx/md 同批实现
`[必须]`

### FR-017：产物隔离约束 [必须]（扩展 F190 FR-013）
- `api-entities.json` 与导入产物 MUST NOT 污染 `_meta/graph.json`、`specs/`、厂商库
- 新 MCP 工具名 `kb_api_lookup` 与现有 Spectra 17 工具 + F190 的 `kb_search`/`kb_doc_lookup` 无冲突（`kb_*` 命名空间）
- 导入只动项目库目录，厂商库字节不变（机械校验）
`[必须]`

### FR-018：实体抽取准确率 + recall@k 冻结评测清单 [必须]（扩展 F190 FR-015）
MUST 提供版本化冻结评测清单 `specs/192-scaffold-kb-entity-and-ingest/eval/`：
- **实体抽取评测**：`entity-manifest.json` 冻结 {doc 输入, 期望实体集（name/kind/关键属性）}，机械计算抽取 precision/recall
- **kb_api_lookup recall**：冻结 {api 查询, 期望命中实体 id}，机械计算命中率
- **仲裁评测**：冻结 {冲突 fixture, 期望推荐项 id}，机械断言推荐正确（含 tie/缺失/单维场景，见 §3.4 R-ARB-2）
- **W-5 修正（spec 级固化门槛，不留 plan）**：
  - 实体抽取 **precision ≥ 0.80、recall ≥ 0.70**（heuristic fallback 路径门槛可低一档，但 MUST 在 manifest 单列、不得用 LLM 路径的数字充数）
  - `kb_api_lookup` 命中率 **≥ 0.80**（精确查询）
  - 仲裁推荐正确率 **= 1.00**（冻结冲突集是确定性判定，不允许错）
- **W-5 修正（反过拟合可机械执行，不止"口头不许"）**：
  - manifest 文件 MUST 记录自身 **content hash**；CI 脚本扫描实现源码，若出现 manifest 中的具体 query/doc 文本字面量即 fail（防特例分支）
  - MUST 含 **holdout 子集**（不参与调参、仅终评）+ 至少一组 **mutation fixture**（对已知实体做同义改写/重命名），验证抽取/匹配不是背答案
  - 冻结后修改 manifest 需在 commit message 说明理由 + 更新 hash
`[必须]`

### FR-019：demo fixture 扩展 [必须]（扩展 F190 FR-012）
- demo-kb-{zh,en} 的 `kb/` MUST 新增 `api-entities.json`（基于现有公开 SDK 文档抽取）
- MUST 新增**三方导入样本**：一个公开网页 URL 抓取样本 + 一份合成/公开办公文档 + 一份**显式合成的通用会议纪要**（无任何真实客户信息）
- FIXTURE.md MUST 更新：新增源的 license/来源/规模，并明确标注合成样本为"演示用合成内容"
`[必须]`

---

## 5. 边缘情况（Edge Cases）

- **EC-001：文档无明确 API 签名** → 抽取返回空或低 confidence，MUST NOT 编造；`kb_api_lookup` 查无则明确"未找到"
- **EC-002：LLM 抽取不可用（无认证/超时）** → 自动走确定性 fallback（heuristic），build 不崩，产物标 `extraction_method=heuristic`
- **EC-003：api-entities.json 缺失/损坏** → `kb_api_lookup` 降级：标 `mode=document_fallback` 走 `kb_search` 文档级回退（**不输出校验结论**，FR-005 / W-3），或返回结构化 kb-error（复用 F190 错误契约），不崩
- **EC-004：同名 API 多版本/多库冲突** → 仲裁（FR-007），并列则双呈现（FR-008）
- **EC-005：URL 不可达/超时/非 HTML** → 跳过该源 + 明确报错，不阻断其他源、exit code 反映"部分成功"
- **EC-006：办公文档损坏/加密/zip bomb/超大** → 安全拒绝 + 报原因（R-SEC-1），不崩
- **EC-007：导入内容含 prompt 注入（恶意 sentinel/标题/正文）** → defang + envelope（复用 F191 测试模式，含恶意 title 用例）
- **EC-008：导入重复内容** → 去重，不重复入库（FR-014）
- **EC-009：仲裁各维并列无法判定** → 回退双呈现，`recommended` 全 false（FR-008）
- **EC-010：kb_api_lookup 模糊匹配多命中** → top-N 候选 + 标注，不静默取一
- **EC-011：项目库不存在（首次 ingest）** → 自动初始化空项目库后写入；厂商库缺失不影响 ingest
- **EC-012：PDF 扫描件/纯图片（无文本层）** → 抽取空文本，明确提示"无可抽取文本"，不崩、不 OCR（OCR 出范围，§7）

---

## 6. 成功标准（Success Criteria）

- **SC-001（实体构建 E2E）**：`build` 产出 `api-entities.json`，schema 完整，含 confidence/extraction_method/source_doc_id
- **SC-002（kb_api_lookup 命中）**：精确查询命中率 **≥ 0.80**、模糊查询对冻结实体集达 FR-018 门槛；含 holdout 子集终评
- **SC-003（参数校验 + 废弃检测，非代码级）**：`check_params` 与 deprecated 预警机械断言正确；**且**机械断言响应措辞含"据文档/evidence-grade"限定、**不含**"已验证/verified/保证存在"等代码级断言（grep 黑名单词）
- **SC-003b（降级模式 W-3）**：`api-entities.json` 缺失时 `kb_api_lookup` 响应标 `mode=document_fallback` 且**不含**任何参数校验/废弃判定结论（机械断言）
- **SC-004（仲裁正确性）**：`kb_api_lookup` 冲突 fixture 下推荐项与冻结期望一致（正确率 = 1.00）；按 §3.4 R-ARB-2 分别断言——(a) **tie（分差 < ε）**回退双呈现、(b) **无主维占优（仅时效更新）**回退双呈现、(c) **某维缺失但另一主维占优**仍正常出推荐（中性化≠回退）；`kb_search` 冲突仅出 `freshness_hint`、**无** `recommended`（机械断言）
- **SC-005（三方导入 E2E，四格式全覆盖）**：URL + **docx + pptx + pdf + md** + 纪要 各至少一条，导入后 `kb_search`/`kb_api_lookup` 可命中，provenance（`ingest_source_type`/`ingest_origin`/`ingested_at`，列名同 §3.3）正确
- **SC-006（预览确认）**：`--dry-run` 不写库；默认预览展示计数；`--yes` 落库且原子
- **SC-007（导入安全护栏，完整攻击矩阵机械化）**：FR-011 的 8 项（zip bomb / XXE-DTD / path traversal / 外部关系引用 / PDF object stream bomb / 内嵌动作文件 / 解析器联网读盘 / 超大）+ 加密损坏 + prompt 注入，**各至少一用例**机械验收"拒绝或 defang、不崩、不外联"
- **SC-007a（URL SSRF 防护 C-5，覆盖 FR-010 全部 6 项边界，一一对应）**：(1) 协议白名单、(2) localhost/私网/link-local 封锁、(3) **DNS rebinding（解析后 IP 落入封锁段则拒绝）**、(4) 重定向限制（**跨协议拒绝** + **超最大跳数拒绝**）、(5) **连接/读取超时** + 超大响应流式截断、(6) **content-type 校验（非 HTML/text 拒绝）** 各一用例机械验收"拒绝抓取/中断、不发起内网请求"
- **SC-008（抽取准确率达门槛）**：实体抽取 precision **≥ 0.80**、recall **≥ 0.70**（LLM 路径；heuristic fallback 单列、门槛可低一档但不得用 LLM 数字充数，FR-018）；holdout + mutation fixture 通过；反过拟合 hash 扫描通过
- **SC-009（诚实边界）**：产物与工具 description 无代码级断言措辞；extraction_method/confidence 全程标注（机械 grep + 断言）
- **SC-010（MCP 零回归）**：Spectra 17 工具 + `kb_search`/`kb_doc_lookup` 全部不回归；新增 `kb_api_lookup` 注册成功，工具总数与命名无冲突
- **SC-011（产物隔离）**：api-entities + 导入产物不污染 graph.json/specs/厂商库；厂商库字节不变机械校验
- **SC-012（依赖审计）**：新依赖无原生编译、跨平台、license 兼容随 plugin 分发；`npm ls` + 平台 smoke 验证
- **SC-013（全量门禁 + 跨平台 smoke）**：`vitest run` + `build` + `repo:check` + `release:check`（如涉发布）零失败；FTS5 + office 解析跨平台 smoke
- **SC-014（错误契约 + telemetry 一致）**：kb_api_lookup / ingest 的 kb-error 顶层 code + telemetry 字段与 F190 一致（复用 buildKbError）
- **SC-015（旧 F190 库向后兼容 C-1）**：用一份 F190 时代 schema（chunk_meta 无 provenance 三列）的 sqlite fixture，跑 `kb_search`/`kb_doc_lookup`/`kb_api_lookup` 全路径，机械断言**不抛 `no such column`**、provenance 字段优雅返回缺省值

---

## 7. 范围外（Out-of-Scope）

| 项 | 理由 | 去向 |
|----|------|------|
| 文档实体 ↔ SDK 真实符号 **AST 精确锚定** | 依赖未发布的 F189 锚定引擎；本期文档自抽取实体替代 | F189 落地后的后续 feature |
| 门禁深度集成（plan/implement 审查时 API 误用机械校验入 gate） | 依赖代码级实体锚定，证据级实体不足以做硬门禁 | Phase 3 |
| embedding 向量 rerank | 业界证据 + F190 recall 达标，暂不需要 | Phase 3（质量门驱动） |
| LLM 整编概述层（Wiki 式预生成页） | 需 Phase 1/2 查询日志先验证需求 | 后续 |
| 在线托管 / Remote MCP 端点 | 与离线分发底座冲突 | 接口预留，不实现 |
| PDF **OCR**（扫描件/图片转文字） | 重依赖 + 质量不稳；本期只抽有文本层的 PDF | 后续按需 |
| 运行时 `kb_ingest` **MCP 写入工具**（vs CLI ingest） | MCP 运行时写库的并发/权限/确认 UX 复杂；本期 CLI ingest 已覆盖导入需求 | 后续按需 |
| 实时增量导入 watch | MVP 一次性 ingest 已够；watch 增量合并复杂 | 后续 |
| `--incremental` 增量构建（仅重建变化 chunk） | F190 遗留项，与本期正交 | 后续 follow-up |

---

## 8. 约束与非功能需求（Constraints & NFR）

### 8.1 回归护栏（扩展 F190 §8.1）
- 不破坏 F190 的 `kb_search`/`kb_doc_lookup`/双层联查/降级；不破坏 F191 的预查注入与 evidence-envelope
- chunk_meta 加列 MUST 向后兼容旧库（F190 已分发的 demo kb 读取时缺列按默认处理）
- 复用而非分叉：chunk 切分、FTS5 写入、CJK tokenizer、evidence-envelope、buildKbError、双层 locator 一律复用既有实现

### 8.2 解析依赖（office/URL）
- 无原生编译（纯 JS/WASM），跨平台，license 兼容随 plugin 分发；plan 出依赖审计表
- 离线优先：URL 抓取是**唯一**联网点，MUST 可选 + 失败降级；office/纪要/build 全程离线

### 8.3 安全（新增攻击面）
- 二进制解析（docx/pptx/pdf）：FR-011 的 8 项攻击矩阵（zip bomb / XXE-DTD / path traversal / 外部关系引用 / PDF object stream bomb / 内嵌动作文件 / 解析器联网读盘 / 超大）均为 **MUST**（R-SEC-1）
- URL 抓取：FR-010 的 SSRF 防护（协议白名单 / 内网封锁 / DNS rebinding / 重定向限制 / 超时+流式大小上限 / content-type 校验）均为 **MUST**，**非 plan 可选**（C-5）
- 全部导入内容 untrusted：defang on ingest + envelope on retrieval（FR-015）；结构化实体字段亦全量 defang（FR-006 / C-4）

### 8.4 性能（参考值，plan 细化）
- `kb_api_lookup` P95 ≤ 200ms（百实体级，复用 FTS5/内存索引）
- `ingest` 单文档（百 KB 级）端到端分钟内；URL 抓取受网络约束，有超时

### 8.5 通用产品定位
- §1.4 红线贯穿；demo/测试用公开或合成通用样本；FIXTURE.md license 合规

---

## 9. 歧义与待澄清项

### [RESOLVED @ 用户决策] D-001：实体层路线（F189 依赖）
用户已决策 **"文档自抽取实体先做"**：本期实体来源为厂商文档抽取（证据级），不阻塞于未发布的 F189；精确 AST 锚定留后续。诚实边界见 §1.3 / FR-003。

### [RESOLVED @ 用户决策] D-002：三方导入范围
用户已决策 **"全量含三方导入"**：URL + 办公文档（docx/pptx/pdf/md）+ 会议纪要均在 F192 范围。

### [RESOLVED @ GATE_DESIGN] D-003：内部分三批执行
用户已确认 **采纳内部分三批**：批①实体层 + 仲裁（FR-001~008）→ 批②三方导入（FR-009~016）→ 批③ fixture 扩展 + 全量收口（FR-017~019）。每批自带最小 eval + 隔离 + 旧库兼容验收（§10 W-8），批① 用预置 project 实体 fixture 规避对批② 的反向依赖（§10 N-4）。

### [RESOLVED @ GATE_DESIGN] D-004：PDF 实现 = 授权第三方库
用户已确认 **PDF 保留全量、授权依赖第三方库实现**。plan MUST 选一个**纯 JS / WASM、无原生编译、license 可随 plugin 分发**的成熟 PDF 文本抽取库（如 Apache-2.0 的 pdfjs-dist 系），与 docx/pptx/md 同放批②，**不分档、不降级**。仍 MUST 守 FR-016 三条硬线 + FR-011 的 PDF 安全矩阵（object stream bomb / 内嵌 `/Launch`·`/OpenAction`·`/JavaScript` 不执行 / 不外联）；PDF 扫描件 OCR 仍在范围外（§7）。

### [PLAN-LEVEL] NC-001：office 解析依赖具体选型
docx/pptx/pdf/md 各自的具体解析库（含 PDF 库的具体选型，见 D-004）由 plan 依赖审计后定，遵 FR-016 约束（无原生编译 / 跨平台 / license 兼容 / 安全）。

### [PLAN-LEVEL] NC-002：仲裁权重与阈值
版本/时效/置信度的具体权重、冲突相似度阈值、并列判定边界由 plan 定，受 FR-007/008 + SC-004 约束。

### [PLAN-LEVEL] NC-003：实体抽取 prompt 与 fallback 启发式
LLM 抽取 prompt 模板、heuristic fallback 的签名/命名识别规则由 plan 定，受 FR-001/003 + SC-008 反过拟合约束。

### [PLAN-LEVEL] NC-004：SSRF / URL 抓取边界的**具体数值**
SSRF 防护**是否启用已由 FR-010 / §8.3 固化为 MUST**（协议白名单、内网/localhost/link-local 封锁、DNS rebinding、重定向限制、超时、流式大小上限、content-type 校验均强制）。plan **仅**确定这些边界的**具体数值/实现细节**：超时秒数、响应体字节上限、最大重定向跳数、IP 封锁名单的实现方式。**plan 无权把任何一项降级为可选。**

---

## 10. 复杂度评估（供 GATE_DESIGN 审查）

> **本 feature 体量显著大于 F190/F191**（用户已选最大范围：实体层 + 全量三方导入 + 仲裁）。三块能力相对独立，验证面叠加。**执行分期建议**（交 GATE_DESIGN 决策，不擅自砍范围）：
>
> - **建议内部分三批实现并各自 TDD/verify**：①实体层 + 仲裁（FR-001~008）→ ②三方导入（FR-009~016）→ ③fixture 扩展 + 全量收口（FR-017~019 的 demo/跨平台/全门禁）。每批独立可测、独立 codex review，降低单次 GATE_VERIFY 验证面。
> - **W-8 修正（每批自带验收，不把评测/隔离/兼容堆到最后）**：评测、隔离、旧库兼容是前两批"是否可接受"的门禁，**不**整体后置到批③——
>   - 批① 必须自带：实体抽取 precision/recall 评测（FR-018 子集）+ api-entities 隔离断言（R-ENT-1）+ 旧库兼容（SC-015）+ 仲裁正确性（SC-004）。**规避依赖倒挂（N-4）**：批① 的仲裁测试用**预置的 project api-entities fixture**（手写双库实体对），**不**依赖批② 的导入管线产出项目库——导入管线在批② 才实现，批① 不得反向依赖
>   - 批② 必须自带：导入 E2E（四格式 SC-005）+ 安全护栏（SC-007/007a）+ provenance/旧库兼容
>   - 批③ 仅做 fixture 规模化 + 跨平台 smoke + 全门禁收口，**不**承载首次功能验收
> - **新增依赖与安全攻击面**（office 二进制解析 + URL 抓取）是本期最大新风险，plan 必须出依赖审计 + 安全设计；SSRF/office 攻击矩阵已在 FR-010/011 固化为 MUST。
> - **诚实边界**（证据级实体 vs 代码级保证）是产品叙事关键，须在工具 description / 产物 / 文档三处一致落实，避免 over-claim。
>
> **GATE_DESIGN 已决（见 §9 D-003 / D-004）**：① 内部分三批 = **采纳**（批①实体层+仲裁 → 批②三方导入 → 批③收口，各批自带 eval/隔离/兼容验收）；② PDF = **保留全量，授权第三方库实现**——plan 选纯 JS/WASM、无原生编译、license 可随 plugin 分发的成熟 PDF 文本抽取库（如 Apache-2.0 pdfjs-dist 系），与 office 其他格式同放批②，**不分档/不降级**，仍守 FR-016 三条硬线 + FR-011 PDF 安全矩阵。（URL 内网封锁已由 C-5 固化为 MUST，非开放点。）
