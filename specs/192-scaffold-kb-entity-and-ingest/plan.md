---
feature: 192-scaffold-kb-entity-and-ingest
title: scaffold-kb Phase 2 — 实施计划（plan）
status: draft
phase: plan
spec: ./spec.md
---

# F192 实施计划（Plan）

> 本计划落实 spec 的 20 FR / 17 SC，遵 GATE_DESIGN 决策 D-001~D-004。**架构原则：最大化复用 F190/F191 既有模块，新增能力以新模块旁挂，不分叉既有实现。**

## 0. 架构概览（新增 vs 扩展）

```
src/scaffold-kb/
  types.ts              [扩展] +ApiEntity/ApiEntityFile/IngestSourceType；ChunkMeta +3 provenance 可选字段
  sqlite-writer.ts      [扩展] chunk_meta DDL +3 列；INSERT +3 列；新增 readChunkMetaCompat（PRAGMA 列探测）
  index.ts(buildKb)     [扩展] 第 4.5 步：抽实体 → 序列化 api-entities.json → 三文件原子落盘
  entity-extractor.ts   [新增] extractEntities(chunks, {llm|heuristic, budget}) → ApiEntity[]
  entity-heuristic.ts   [新增] 无 LLM 的确定性抽取（代码块/签名正则/标题命名约定）
  arbitration.ts        [新增] arbitrateEntities(vendor[], project[]) → 推荐+备选（R-ARB-2 加权）
  ingest/               [新增] 三方导入子模块
    ingest-core.ts        ingestSource({url|file|minutes}) → ParsedDoc[]（复用 splitDocument + buildChunksDbBytes 写项目库）
    url-fetcher.ts        SSRF 安全抓取（FR-010）+ readability 主内容 + html→md
    office-parser.ts      docx/pptx/pdf/md 文本抽取（FR-011 攻击矩阵）
    ingest-preview.ts     预览计数 + 确认 UX（FR-013）+ 去重/语言/provenance（FR-014）
  (复用) chunk-splitter.ts / tokenizer.ts / doc-graph-builder.ts / evidence-envelope.ts(F191)

src/kb-mcp/
  server.ts             [扩展] +registerKbApiLookupTool；KB_TOOL_GUIDE +kb_api_lookup 导览 + 诚实边界
  lib/kb-locator.ts     [扩展] KbHandle +entities: ApiEntityFile|null；loadHandle 读 api-entities.json（可选，同 graph）
  lib/result-merger.ts  [不改核心] kb_search 仍用 mergeResults；+附 freshness_hint（档 B，新小函数）
  lib/entity-matcher.ts [新增] 实体精确+模糊匹配（qualified_name/container/overload_key 消歧）
  tools/kb-api-lookup.ts[新增] kb_api_lookup：查→匹配→仲裁→defang 全字段→envelope→token cap

src/cli/
  commands/scaffold-kb.ts [扩展] +runIngest（ingest 子命令：build/serve/query/ingest）
  utils/parse-args.ts     [扩展] scaffoldKbOperation +'ingest'；--url/--file/--minutes/--yes/--dry-run

依赖（FR-016 审计见 §3，全部纯 JS/WASM 无原生编译）：fflate / fast-xml-parser / pdfjs-dist(或 unpdf) / linkedom / @mozilla/readability / turndown
```

## 1. API 实体抽取方案（FR-001/002/003）

### 1.1 输入与流程
- 输入：`buildKb` 已切好的 `Chunk[]`（不另读原文，复用切分结果，FR-001）+ doc 元数据
- **W-4 修正（抽取粒度 = section/window，防证据切碎）**：chunk 仅 ~400/500 token 且只有 `contentRaw+anchor`，API 签名/参数表/deprecated 说明常跨 chunk。抽取**输入按 section 窗口聚合**：同 `docId+anchor` 的相邻 chunk 拼接喂给 extractor；输出实体保留 **primary `source_chunk_id` + `source_chunk_ids[]`**（证据链可能跨多 chunk）。`source_chunk_id` **只承诺同一次 KB build 内可回溯**，**不**承诺跨 rebuild 稳定（chunk_id 依赖切分，rebuild 可能变）
- 默认 LLM 抽取；`--no-llm` 或无认证 → 自动走 `entity-heuristic`（EC-002）
- 输出 `ApiEntity[]` → 序列化 `api-entities.json`（§spec 3.2），与 doc-graph/chunks **三文件一起原子落盘**（扩展 index.ts 第 5 步 try/rename 块，从 2 文件扩到 3）

### 1.2 LLM 抽取（提质路径）
- 复用既有 LLM 认证/调用层（与 spectra 主流程同；构建期可 Opus/Sonnet）
- prompt 契约（NC-003）：**输入 = §1.1 聚合的 section 窗口**（同 docId+anchor 的相邻 chunk 拼接，非单 chunk），输出 JSON 实体数组；**严格要求**：只抽文档中**显式出现**的 API，缺信息留 null，**禁止编造**（FR-003/EC-001）；每实体附 `confidence`（模型自评，clamp [0,1]）+ `source_chunk_id`（窗口内 primary chunk）+ `source_chunk_ids[]`（证据跨多 chunk 时列全部）
- **成本护栏（FR-001）**：按 token 预算分批；超预算按 doc 优先级截断 + 在产物 `coverage` 元字段记录覆盖率（不静默吞）；进度可观测（复用 batch 进度原语）

### 1.3 heuristic fallback（零成本路径）
- 确定性规则（`entity-heuristic.ts`，纯函数易测）：
  - 代码块（```）内的 `function/class/def/const` 签名正则 → name/kind/signature
  - 标题/加粗里的 `API 名(...)` 模式 → name + params 占位
  - 错误码表（`E\d+` / `[A-Z_]+_ERROR` 模式）→ kind=error_code
  - `@deprecated` / "已废弃" / "deprecated since" 文本 → deprecated
- 产物标 `extraction_method=heuristic`、`confidence` 给固定低档（如 0.5）
- **反过拟合（FR-018）**：规则不得 match manifest 里的具体 API 名字面量；CI hash 扫描守

### 1.4 schema 版本
- `api-entities.json` `schema_version=1.0`；未来 F189 落地经版本升级加 `extraction_method=ast-anchored`（本期不预留分支，避免 C-3 复发）

## 2. kb_api_lookup 工具接线（FR-004/005/006）

### 2.1 注册（复用 KB MCP 骨架，SC-010 零回归）
- `server.ts` 加 `registerKbApiLookupTool(server, ctx)`（与 kb_search/kb_doc_lookup 并列，**不动** Spectra 主 MCP）
- `KbContext.{vendor,project}.entities` 由 locator 预加载（warm 缓存）

### 2.2 匹配（`entity-matcher.ts`，FR-004 + W-2 消歧）
- 精确：`qualified_name` + `kind`（+ `overload_key` 若多重载）命中
- 模糊：复用 F190 tokenizer 归一 + 编辑距离/子串；多命中返回 top-N，按 `container`/`overload_key` 标注区分（不静默取一）
- `--container` 输入按所属类/模块限定

### 2.3 校验语义（FR-005，诚实边界）
- `check_params` → 对照 `params` 出"未知/缺必填/命中"逐项（**据文档**，措辞带 evidence-grade，禁代码级断言词）
- `deprecated.is_deprecated` → 废弃预警（since/replacement）
- 查无 → "文档中未找到该实体"，不编造（EC-001）
- **降级（W-3）**：`entities=null`（缺 api-entities.json）→ 标 `mode=document_fallback` 走 kb_search 文档级回退，**不出校验结论**

### 2.4 信任边界（FR-006，C-4 闭合规则）
- **I-1：内部 raw / 输出边界 sanitize**——matcher/仲裁等内部计算用 **raw 实体**（defang 后的串会污染匹配/比较质量）；仅在**最终 response 对象 serialization 前**做一次深拷贝、**遍历所有 string 字段统一 defang**（复用 F191 `defangSentinel`/`safeAttr`），非逐字段手列
- 证据正文（evidence_quote 等）入 F191 全局 evidence boundary；遵 F190 FR-011 token cap（单条≤500/合计≤2500）
- 错误走 F190 `buildKbError`（顶层 code + telemetry 一致，SC-014）

## 3. 三方导入依赖审计（FR-016 / D-004，plan 核心交付）

> **plan 级审计结论**（FR-016；已查证）：7 个候选**全部无原生编译要求、许可全部宽松可随 plugin 分发、engines 全部 ≤Node18 不违反本仓 `node>=20`、截至 plan 日期无已知高危 CVE** → 满足 WASM-only/无原生立场。关键查证点：`pdfjs-dist` 文本抽取路径（`getDocument`+`getTextContent`，不渲染）**canvas-agnostic**（`@napi-rs/canvas` 仅渲染需要），且 `pdfjs-dist` 当前大版本声明 **Node 18+**（非 22，codex engines 顾虑解除）；`unpdf` 打包 **serverless pdf.js build 完全不含 canvas**。
>
> **批② 仅做实测确认（非重做审计）**：`npm view <pkg> license`（定 linkedom 等的 SPDX 字面值）+ `npm ls`（transitive 无原生）+ `npm audit`（CVE 复核）+ 三平台（mac/linux/win × arm64/x64）+ Node 20 smoke + pdfjs **text-layer-only import path** 实测不拉 canvas。任一不达标走"备选/降级"列。

| 用途 | 首选库 | License（待核） | 原生? | 安全/落地要点（批②须验证） | 备选/降级 |
|------|--------|----------------|-------|----------------------------|----------|
| docx/pptx 解压 | `fflate` | MIT | 否 | **streaming `Unzip`** 逐 entry 校验 path/declared size/累计解压字节/ratio（FR-011 zip bomb，§5.3）；拒 `../`/绝对路径 entry | Node `zlib` inflateRaw + 手写 zip 局部解析 |
| Office XML 解析 | `fast-xml-parser` | MIT | 否 | **解析前先拒 `<!DOCTYPE`/`<!ENTITY`/external subset**（W-2：`processEntities:false` 仅不展开实体≠禁 DTD），再 `processEntities:false`+`ignoreDeclaration`+`maxNestedTags`；忽略 `.rels` external target | 手写正则抽 `<w:t>`/`<a:t>` 文本（无 XML 解析器攻击面） |
| PDF 文本 | `unpdf`（优先，serverless build 不含 canvas）/ `pdfjs-dist` | Apache-2.0 | **否（已查证）**：text-layer 抽取（`getDocument({data})`+`getTextContent()`，不渲染）**canvas-agnostic**；`@napi-rs/canvas` 仅渲染需要。pdfjs-dist 当前大版本 **engines=Node18+**（非 22，满足 node≥20）。实现 MUST 锁 "text-layer-only import path" 不触发 canvas/worker | 纯文本层失败则该 PDF 报"无可抽取文本"（EC-012），不引第二个 PDF 库 |
| URL 主内容 | `@mozilla/readability` | Apache-2.0 | 否 | 官方示例用 `jsdom`；`linkedom` 更轻但**非 100% DOM 兼容**，批② smoke 决定 linkedom 够用否，不够则用 jsdom（仍纯 JS）；readability **不负责 sanitize**，输出仍走 §5.5 untrusted 处理 | `node-html-markdown` 直转（不抽主内容） |
| DOM（给 readability） | `linkedom` | **ISC/MIT**（来源有分歧，批② `npm view` 定字面值；两者皆宽松可分发） | 否 | 纯解析、不跑 script、不联网 | `jsdom`（更重、纯 JS） |
| HTML→Markdown | `turndown` | MIT | 否 | 纯文本转换 | readability 已出近似 md |

- **诚实标注**：本期依赖足迹明显增加（PDF 库尤甚）。用户已授权（D-004）。审计已查证 text-path canvas-agnostic + Node18+，**优先用 `unpdf`（serverless build 确定无 canvas）**；若批② 实测意外发现强拉原生 canvas / `engines>node20` → 记风险、回 GATE 议（不静默砍 PDF）。linkedom SPDX 字面值以批② `npm view` 为准。

## 4. 冲突仲裁算法（FR-007/008，落 §spec 3.4 R-ARB-2）

### 4.1 档 A（kb_api_lookup，`arbitration.ts`）
- 冲突判定：同 `id`/`qualified_name` 且关键属性（signature/params/deprecated/since_version）不同 → 同组
- **pairwise 归一加权**（W-5：组内成员**两两相对**归一，非全局绝对分）：`score = w_v·版本匹配度 + w_t·时效 + w_c·confidence`（默认 `w_v=w_c=0.4, w_t=0.2`；NC-002 可配）
  - **版本匹配度**：实体 `since_version`/`sdk_version` 与**目标版本**接近度。**目标版本来源**（W-5 防版本维形同虚设）：① 查询显式 `sdk_version` → 用之；② 否则 fallback 到**项目库/厂商库 KB 级 `sdk_version`**（多数现实查询无显式版本，用 KB 声明版本兜底）；③ 两者皆无 → 该维中性化
  - **时效**：`built_at`/`ingested_at` 归一（缺 → 按最旧，R-ARB-2 显式例外）
  - **confidence**：实体 confidence（缺 → 中性化）
  - **中性化语义**（W-5 明确）：中性化 = 该维**从加权中剔除并对剩余权重重归一**（非填中性常数），避免缺失维稀释有效维
- **时效不可单独翻盘**：推荐项 MUST 在版本或 confidence ≥1 主维**严格占优**；
  - **"仅时效新、confidence 相等/缺失、版本维中性"** → 明确**不推荐**（`recommended` 全 false，回退双呈现）—— 这是 spec R-ARB-2 要的安全默认，已纳入冻结 fixture（SC-004）
- tie：分差 < ε（默认 `ε=0.05`）→ `recommended` 全 false 回退双呈现
- 输出：推荐项 `arbitration.recommended=true`+`score`+`reason`+`group_id`；备选保留
- **产品权衡诚实标注**：上述安全默认会让"无版本信息 + 置信度相近"的现实冲突多数落到双呈现（不强行推荐）；这是"宁可不误导、也不瞎推荐"的有意取舍，非 bug

### 4.2 档 B（kb_search，`result-merger.ts` 旁挂小函数）
- **不改** `mergeResults` 核心；新增 `annotateFreshness(merged)`：两库同 `doc_id` 命中 → 附 `freshness_hint{newer,built_at,group_id}`；**不**出 recommended、不判矛盾

## 5. 三方导入管线（FR-009~015）

### 5.1 入口 + 产物闭环（C-2 修正：ingest 必须写齐三件套）
- `scaffold-kb ingest --url|--file|--minutes [--project-kb .spectra/kb] [--yes|--dry-run]`
- 管线：源 → `ParsedDoc` → `splitDocument` →（§1 entity-extractor 抽实体）→ 写**项目库三件套**：`chunks.sqlite`（带 provenance）+ `doc-graph.json` + **`api-entities.json`**
- **C-2（实体写入闭环，硬约束）**：ingest **MUST 复用 §1 entity-extractor 对导入内容抽实体**并合并进项目库 `api-entities.json`，否则批② SC-005 的 `kb_api_lookup` 对导入内容只能 document_fallback、无法命中/仲裁。定义：
  - **project entity merge key** = `qualified_name + kind + overload_key`；同 key 覆盖（新导入覆盖旧），保留 `source_chunk_id`/`ingested_at`
  - 与既有项目库实体**去重/覆盖**：同 key 取更新（按 ingested_at），不同 key 追加
  - **原子写**：三件套全部在内存算好后 tmp+rename 一次性落盘；任一失败回滚（清 tmp，项目库保持导入前状态）
  - preview 的 entity count 来源 = 本次抽取的实体数（增量）
- **不碰厂商库**（FR-009，厂商库只读）；项目库不存在 → 自动初始化空三件套（EC-011）

### 5.2 URL 抓取（`url-fetcher.ts`，FR-010 SSRF MUST — C-1 修正：落到 undici API 级）
> Node 内置 `fetch` **不能**满足 SSRF 防护：它不暴露 DNS lookup 钩子、不暴露响应 socket 的 `remoteAddress`，默认自动 redirect 会绕过逐跳校验。**必须**按下述 undici 自定义连接器实现，不可用裸 `fetch(url)`：
- **手写 redirect loop**：`redirect:"manual"`，每跳取 `Location` → 重新解析 + 重新封锁 + 跳数上限（默认 5）+ 跨协议（https→http）拒绝
- **自定义 undici `Agent`/`Pool` + `connect(opts, cb)` connector**：connector 内**自行 DNS resolve**（`dns.lookup` all）→ 对每个候选 IP 执行封锁（localhost/loopback、10/8、172.16/12、192.168/16、169.254/16、**`fc00::/7`（IPv6 ULA）**、`fe80::/10`（IPv6 link-local）、`::1`、`0.0.0.0`、IPv4-mapped IPv6）→ **按通过校验的 IP 建连**但保留原 `Host`/SNI（防 rebinding TOCTOU）→ 连接后再断言 `socket.remoteAddress` 仍在白名单；**禁用或约束连接复用**避免复用到未校验连接
- 协议白名单 http/https；连接/读超时（默认 10s）；响应体**流式边读边计字节**，超上限（默认 5MB）中断；content-type 仅 HTML/text/markdown
- 测试覆盖 IPv4/IPv6/mapped/0.0.0.0/redirect-to-internal/DNS-rebinding（mock resolver 第一次返公网、第二次返内网）/超时/超大（SC-007a）
- 抓后 readability 主内容 → turndown → md → chunk

### 5.3 办公文档（`office-parser.ts`，FR-011 攻击矩阵）
- **docx/pptx（W-3 streaming）**：fflate **streaming `Unzip`** 逐 entry 处理——校验 entry name（拒 `../`/绝对路径/盘符）+ declared `originalSize` + 累计实际解压字节 + 解压比，超限即 terminate（**不**整包 materialize 再统计，防 OOM）；只解需要的 Office XML entry（`word/document.xml` / `ppt/slides/*.xml`）
- **Office XML（W-2 真禁 DTD）**：解析前**先拒**含 `<!DOCTYPE`/`<!ENTITY`/external subset 的 XML（不止 `processEntities:false`）；再 fast-xml-parser `processEntities:false`+`ignoreDeclaration`+`maxNestedTags` 抽 `<w:t>`/`<a:t>` 文本；忽略 `.rels` 的 external target（不抓取/不读盘）
- **PDF（C-3 改为可验证路径，不声称 pdfjs 无的能力）**：
  - 输入**字节上限**（先于解析）；只传 `data`（**禁 url**，禁 range/autoFetch/streaming 外联）；**text-layer-only**：仅 `getDocument({data,...})`+`getTextContent()`，不渲染、不触发 canvas/worker；设 font/wasm 选项避免外取资源
  - `/OpenAction`·`/JavaScript`·`/Launch`·embedded file：**轻量结构预扫描**检出即拒绝/剥离 + 明确"依赖 pdf.js 文本路径不执行动作"并**加测试断言**（不空口声称）
  - 不再写"object stream 深度上限"（pdfjs 无此公开 API）；改为**外层超时 + 内存上限 + worker 隔离**兜底超深嵌套/对象炸弹
  - 扫描件无文本层 → "无可抽取文本"不崩（EC-012）
- **md**：直接读
- 加密/损坏/超大 → 安全拒绝 + 报因（EC-006），不阻断其他源

### 5.4 预览确认 + 质量护栏（FR-013/014）
- 默认预览：新增 doc/chunk/**entity（来自 §5.1 抽取）** 计数 + 来源摘要，**不写库**；`--yes` 落库（原子 tmp+rename，§5.1）；`--dry-run` 永不写
- 护栏：内容级去重（与项目库现有 chunk）；过滤空/超短（阈值 plan: <20 字符）；语言检测标 lang；每 chunk 写 provenance 三列

### 5.5 信任边界（FR-015）
- 导入内容全 untrusted：入库不改"参考资料"地位；检索经 F191 envelope；恶意 sentinel/title/正文 defang（复用 F191 测试模式）
- **复用 ingester 的 `fetchImpl` 注入接口做测试**（I-2），但**默认网络实现换成 §5.2 安全 fetcher**——F190 ingester 的默认 `fetch(url).text()` 不可用于 untrusted URL

## 6. 向后兼容（C-1 / SC-015）
- 仅 `chunk_meta`（普通表）扩 3 列；**FTS5 `chunks` 虚拟表本期不扩列**，故 FTS5 无兼容问题——问题面**全在 `chunk_meta` 的 SELECT/JOIN**
- **W-7 修正（compat 落到所有投影，不止一个 helper）**：现有 `search-core.ts` 有固定 `SELECT_COLS` + 行号映射，一旦直接加 `chunk_meta.ingest_*` → 旧库 `no such column`。因此：
  - 新增 **schema-compat helper**：一次 `PRAGMA table_info(chunk_meta)` 探测列集 → **生成 `SELECT` 片段**（存在则选列、缺则 `NULL AS ingest_source_type`）+ 对应 **row mapper**
  - `search-core`（含 lookup evidence 回查）、`kb_search`、`kb_doc_lookup`、`kb_api_lookup` 的**任何 provenance 投影/JOIN 一律走该 helper 生成的片段**，**禁止任何地方手写新列名**
  - 写入路径仅作用于新建/项目库（一律含 3 列），不对旧只读厂商库 `ALTER`
- 测试：造 F190 时代 schema fixture（无三列）跑 `kb_search`/`kb_doc_lookup`/`kb_api_lookup` 全路径断言不抛 `no such column` + provenance 优雅缺省（SC-015）

## 7. 三批分解（D-003）+ 每批验收

| 批 | 范围 | 新增/改文件 | 自带验收（不后置）|
|----|------|-----------|------------------|
| **①实体层+仲裁** | FR-001~008 | entity-extractor/heuristic/arbitration、entity-matcher、kb-api-lookup、server/locator/types 扩展、sqlite-writer compat | 抽取 precision≥0.80/recall≥0.70（FR-018 子集）+ 仲裁正确率=1.00 + 隔离（R-ENT-1）+ 旧库兼容（SC-015）+ MCP 零回归（SC-010）。**W-6 fixture 要求**：批① 预置**最小 vendor/project KB 目录三件套**（`chunks.sqlite`+`doc-graph.json`+`api-entities.json`），实体的 `source_chunk_id` **MUST 真实存在于该 sqlite**——因 kb_api_lookup 要走双层 locator 读 api-entities + 按 source_chunk_id 回查 chunks.sqlite + envelope/token cap，光手写实体 JSON 验不了真实工具链；该 fixture **手工构造、不依赖批② 导入管线**（规避 N-4 倒挂） |
| **②三方导入** | FR-009~016 | ingest/*、parse-args/scaffold-kb 扩展、依赖审计落地 | 四格式 E2E（SC-005）+ SSRF（SC-007a）+ office 攻击矩阵（SC-007）+ provenance/去重/预览（SC-006）+ 旧库兼容 |
| **③收口** | FR-017~019 | demo fixture 扩展（api-entities + 三方样本）、跨平台 smoke、eval manifest 规模化 | 全量门禁 + 跨平台 + 完整冻结评测（SC-008/011/012/013）；**不**承载首次功能验收 |

- 每批末跑 codex 对抗审查 + 该批 vitest/build 零失败再 commit；批①②③ 顺序交付，各为可独立 verify 的小里程碑

## 8. 测试策略（TDD）
- 单元（tests/kb/）：entity-extractor heuristic、arbitration（tie/缺失/单维/时效不翻盘 全断言）、entity-matcher（消歧/模糊）、url-fetcher SSRF（mock DNS/redirect）、office-parser 攻击矩阵（造 zip bomb/XXE/path-traversal/损坏 fixture）、defang 全字段、compat 列探测
- 集成（tests/integration/）：build→api-entities E2E、ingest 四格式 E2E、kb_api_lookup 双层+仲裁+降级、旧库兼容
- 冻结评测（specs/192/eval/）：entity-manifest（precision/recall + holdout + mutation + hash 扫描）、api-lookup recall、arbitration 推荐正确
- 所有外部 IO（网络/文件）走注入式 mock（复用 ingester 的 fetchImpl 模式），保证确定性

## 9. 风险与回退
- **pdfjs-dist 体积/兼容**：若批② 审计判定不可接受 → 切 unpdf 或降级"仅文本层简单抽取"，但**不砍** PDF（D-004）；走备选列
- **LLM 抽取质量不稳**：heuristic fallback 保底；门槛不达标记录为后续优化信号（非阻塞，类比 F190 recall 弱项处理）
- **依赖足迹增大**：批② 审计实测三平台；任一原生编译/license 不兼容即换备选
- **F189 缺位**：实体证据级边界已 spec 锁定；不做 AST 锚定，不 over-claim

## 10. 不做（重申 spec §7）
AST 精确锚定（F189）/ 门禁深度集成（Phase 3）/ 向量 rerank（Phase 3）/ Wiki 层 / Remote MCP / PDF OCR / 运行时 kb_ingest MCP 写工具 / watch 增量。
