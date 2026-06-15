---
feature: 192-scaffold-kb-entity-and-ingest
title: scaffold-kb Phase 2 — 任务分解（tasks）
status: draft
phase: tasks
spec: ./spec.md
plan: ./plan.md
---

# F192 任务分解（Tasks）

> **TDD 强制**：每个含代码的任务先写失败测试、再实现到绿。`[P]` = 可与同批内无依赖任务并行。每批末 codex 对抗审查 + 该批 `vitest run`/`build` 零失败再 commit（D-003 三批顺序交付）。

---

## 批 ① 实体层 + 仲裁（FR-001~008）

| 任务 | 交付物 | 依赖 | 测试 / 验收 |
|------|--------|------|------------|
| **T001** types 扩展 | `types.ts` +`ApiEntity`/`ApiEntityFile`/`IngestSourceType`；`ChunkMeta` +3 provenance 可选字段 | — | tsc 通过；类型契约对齐 spec §3.2 |
| **T002** sqlite compat + **reader rewiring** | `sqlite-writer.ts` chunk_meta DDL +3 列 + INSERT；新增 schema-compat helper（`PRAGMA table_info` 探测 → 生成 SELECT 片段 + row mapper）；**`search-core.ts` 固定 `SELECT_COLS` + `kb_search`/`kb_doc_lookup` 的所有 provenance 投影/JOIN 一律改走 helper**（plan §6，禁任何处手写新列名） | T001 | **先写**旧 F190 schema fixture（无 3 列）测试 → 断言 provenance 字段**返回缺省值**（不止"不抛错"，确保实现前真红）；`kb_search`/`kb_doc_lookup` 全路径不抛 `no such column`。`kb_api_lookup` 路径的 SC-015 在 T009a 实现后由 T011/T019 补全 |
| **T003** heuristic 抽取 `[P]` | `entity-heuristic.ts`：代码块/签名正则/标题命名/错误码/deprecated 规则 | T001 | 单测：各 kind 抽取；反过拟合（不 match manifest 字面量） |
| **T004** LLM 抽取 | `entity-extractor.ts`：section 窗口聚合（同 docId+anchor 相邻 chunk 拼接）+ LLM prompt + **成本护栏（token/批量上限 + 超限按 doc 优先级截断并写 `coverage` 覆盖率元字段，不静默吞）+ 进度可观测** + 无认证自动 fallback 接 T003 | T001,T003 | 单测（mock LLM）：窗口聚合、`source_chunk_id`+`source_chunk_ids[]`、confidence clamp、禁编造、**超预算→coverage 元字段 + 截断断言**、**无认证→走 heuristic（extraction_method=heuristic）** |
| **T005** buildKb 接线 + `--no-llm` | `index.ts` 第 4.5 步：抽实体 → 序列化 `api-entities.json` → **三文件原子落盘**（try/rename 扩到 3）；`BuildKbOptions` +`noLlm` + CLI `--no-llm` 接线（FR-001） | T004 | 集成：build 产 api-entities.json schema 完整（SC-001）；**`--no-llm` → 全 heuristic 抽取且 build 不崩**；隔离断言不污染 graph.json（R-ENT-1） |
| **T006** 仲裁 `[P]` | `arbitration.ts` 档 A：pairwise 归一加权（版本/时效/confidence）+ R-ARB-2（中性化重归一 / tie ε / 时效不单独翻盘 / sdk_version 兜底） | T001 | 单测：tie、各维缺失、单维占优、"仅时效新"不推荐 全断言（SC-004） |
| **T007** 实体匹配 `[P]` | `entity-matcher.ts`：精确（qualified_name+kind+overload_key）+ 模糊（tokenizer 归一）+ **`container` 过滤**（按所属 class/module 限定）+ 多命中 top-N 消歧 | T001 | 单测：精确/模糊/重载消歧/多命中标注/**container 限定缩小命中** |
| **T008** locator 扩展 | `kb-locator.ts` `KbHandle` +`entities`；`loadHandle` 读 `api-entities.json`（可选，同 graph 降级语义） | T001 | 单测：缺失 entities → null 不报错 |
| **T009a** kb_api_lookup 核心 + 注册 | `tools/kb-api-lookup.ts`：输入 `api_name`/`kind`/`container`/`sdk_version`/`check_params`；匹配(T007)→仲裁(T006)→双层联查；参数/废弃校验（措辞带 evidence-grade）；`server.ts` 注册 + `KB_TOOL_GUIDE` 加诚实边界 | T006,T007,T008 | 单测：双层联查、`container`/`sdk_version` 输入用例、参数/废弃校验、黑名单词断言（SC-003）、**查无实体→明确返回"文档中未找到该实体"且不编造签名/参数（FR-005/EC-001）**、MCP 零回归（SC-010） |
| **T009b** sanitize + envelope `[P]` | 输出 serialization 前**深拷贝遍历所有 string 字段 defang**(C-4)；证据正文入 F191 全局 boundary；token cap | T009a | 单测：defang 全字段（含恶意 `overload_key`/`evidence_quote`/`arbitration.reason`）；**raw 实体不被 mutation**（plan §2.4，内部 raw / 仅输出 sanitize）；token cap |
| **T009c** fallback + 错误契约 `[P]` | `entities=null` → `mode=document_fallback` 走 kb_search、**不出校验结论**(W-3)；kb-error 走 `buildKbError`（顶层 code + telemetry） | T009a | 单测：降级 mode 无校验结论（SC-003b）；错误契约 + telemetry 一致（SC-014） |
| **T010** freshness `[P]` | `result-merger.ts` 旁挂 `annotateFreshness`（档 B：同 doc_id → freshness_hint，**不**出 recommended） | T001 | 单测：kb_search 冲突仅 freshness_hint 无 recommended（SC-004） |
| **T011** 批① fixture + 验收 | 最小 vendor/project KB **三件套**（chunks.sqlite+doc-graph.json+api-entities.json），实体 `source_chunk_id` 真实存在于 sqlite（W-6，手工构造不依赖批②） | T002,T005,T009a-c | 批① 全验收：entity precision≥0.80/recall≥0.70 + 仲裁=1.00 + 隔离 + **旧库兼容含 kb_api_lookup 路径（SC-015）** + MCP 零回归 |
| **T012** 批① 收口 | codex 对抗审查（实体/仲裁/defang/兼容）+ `vitest run`+`build` 零失败 → commit | T001-T011 | 零失败；codex 发现全处置 |

---

## 批 ② 三方导入（FR-009~016）

| 任务 | 交付物 | 依赖 | 测试 / 验收 |
|------|--------|------|------------|
| **T013** 依赖落地 + 机械审计 | `npm i` fflate/fast-xml-parser/unpdf(或 pdfjs-dist)/linkedom/@mozilla/readability/turndown；**可重复审计脚本**（固定命令 + 输出 artifact 入 specs/192-scaffold-kb-entity-and-ingest/eval/dep-audit.txt）：`npm view license` + `npm ls`(无原生) + `npm audit`(无高危) + Node20 smoke + pdfjs text-path 实测不拉 canvas | 批① | **脚本机械产出 artifact**（SC-012，非人工填表）；任一不达标走备选列并记录 |
| **T014** URL 安全抓取 | `ingest/url-fetcher.ts`：自定义 undici Agent+`connect` connector（DNS resolve→IP 封锁含 fc00::/7→按 IP 建连保留 Host/SNI→连后校验 remoteAddress）+ `redirect:"manual"` 逐跳 + 超时 + 流式大小上限 + content-type；readability→turndown→md | T013 | **先写** SSRF 测试（mock resolver）：协议白名单/内网封锁/DNS rebinding/重定向超跳/跨协议/超时/超大/content-type 全断言（SC-007a） |
| **T015** office 解析 | `ingest/office-parser.ts`：docx/pptx fflate streaming Unzip 逐 entry（path/size/ratio）+ XML 解析前拒 DOCTYPE/ENTITY；pdf text-layer-only(data-only,禁 url/range)+动作结构预扫描 + **外层超时/内存上限/worker 隔离兜底超深嵌套**；md 直读 | T013 | **先写**攻击矩阵 fixture：zip bomb/XXE-DTD/path-traversal/外部关系引用/PDF 内嵌动作/**PDF object-bomb 超深嵌套(超时/内存中断)**/**解析器不联网+不任意读本地文件(只读目标本身)**/超大/损坏/加密 各断言"拒绝或剥离、不崩、不外联"（SC-007 全 8 项） |
| **T016** ingest 核心 | `ingest/ingest-core.ts`：源→ParsedDoc→splitDocument→（复用 T004 抽实体）→**三件套原子写项目库**（merge key=qualified_name+kind+overload_key，去重覆盖，失败回滚）；**默认网络实现 = T014 安全 fetcher（禁用 F190 默认 `fetch(url).text()`）**；导入内容入库即 defang、检索经 envelope（FR-015，plan §5.5） | 批①/T004,T014,T015 | 集成：URL+docx+pptx+pdf+md+纪要 各一条入项目库后 kb_search/kb_api_lookup 命中（SC-005） |
| **T017** 预览 + 护栏 `[P]` | `ingest/ingest-preview.ts`：预览 doc/chunk/entity 计数 + `--yes`/`--dry-run`；去重/最小长度/语言/provenance 三列 | T016 | 单测：--dry-run 不写、--yes 原子落、预览计数（SC-006）；**去重（同内容不重复入库）+ 过滤空/超短(<20 字符) + 语言检测标 lang 各机械断言（FR-014）**；provenance 列名同 §3.3 |
| **T018** CLI 接线 | `parse-args.ts` `scaffoldKbOperation` +`'ingest'` + `--url/--file/--minutes/--yes/--dry-run/`**`--project-kb`（默认 `.spectra/kb/`）**；`scaffold-kb.ts` +`runIngest` | T016,T017 | 单测：参数解析/校验、`--project-kb` 默认值与自定义路径、**项目库不存在→首次初始化**（EC-011）；ingest 子命令分发 |
| **T019** 批② 验收 | 端到端 E2E + 安全 + 兼容 | T013-T018 | 四格式 E2E（SC-005）+ SSRF（SC-007a）+ office 矩阵（SC-007）+ **prompt-injection 导入 E2E（恶意 sentinel/title/body → 入库 defang + 检索 envelope，不逃逸）** + 预览/provenance（SC-006）+ 旧库兼容含 kb_api_lookup 路径（SC-015） |
| **T020** 批② 收口 | codex 对抗审查（SSRF/office 安全/导入闭环）+ 零失败 → commit | T013-T019 | 零失败；codex 全处置 |

---

## 批 ③ 收口（FR-017~019）

| 任务 | 交付物 | 依赖 | 测试 / 验收 |
|------|--------|------|------------|
| **T021** demo fixture 扩展 | `demo-kb-{zh,en}/kb/` +`api-entities.json`（现有公开 SDK 文档抽取）；+三方导入样本：公开 URL 抓取 + **合成通用** office 文档 + **合成通用**会议纪要；新增**机械可检 source manifest**（每样本：来源 URL/license/`synthetic:true|false`）+ `FIXTURE.md` 更新 | 批② | FR-019：合成样本 `synthetic:true` + 公开样本带 license/source URL；**CI 断言 manifest 完整 + 每样本有 license 或 synthetic 标记**（"无真实客户内容"以 manifest 机械校验承载，非空声称） |
| **T022** 冻结评测 `[P]` | `specs/192-scaffold-kb-entity-and-ingest/eval/`：`entity-manifest.json`（**LLM + heuristic 分两栏各自独立计 precision/recall**，heuristic 不得用 LLM 数字充数）+ holdout + mutation + content hash + api-lookup recall + arbitration 推荐；CI 脚本机械计算 + 源码 hash 扫描反过拟合 | T021 | LLM：precision≥0.80/recall≥0.70；**heuristic：单列、spec 固化 floor precision≥0.60/recall≥0.50，CI 阻塞断言**（SC-008/FR-018，非 plan 定）；命中≥0.80/仲裁=1.00；hash 扫描通过 |
| **T023** 隔离/依赖/telemetry 验收 `[P]` | 机械断言：api-entities+导入产物不污染 graph.json/specs/厂商库（SC-011）；依赖无原生+跨平台+license（SC-012）；kb-error+telemetry 一致（SC-014） | T021 | 三项机械验收通过 |
| **T024** 全量门禁 | 跨平台 FTS5+office smoke；`vitest run`+`build`+`repo:check`+`release:check`（如涉发布）零失败（SC-013） | T021-T023 | 全绿 |
| **T025** 最终收口 | codex 对抗审查（全特性 verify）+ dogfooding 反馈 + push report 等用户确认 | T021-T024 | 全 acceptance 真实达成；push 待确认 |

---

## 关键依赖链 / 并行度
- **批内并行**：批① T003/T006/T007/T010 可并行（都只依赖 T001），T009b/T009c 可并行（都依赖 T009a）；批③ T022/T023 可并行
- **批间顺序**：①→②→③（②的 ingest 抽实体复用①的 extractor T004；③的 demo/eval 依赖①②的能力）
- **关键路径**：T001→T002→T005→T009a→T011（批①）→ T013→T014/T015→T016→T019（批②）→ T021→T024→T025（批③）
- **跨批不倒挂**：批① 验收用预置 fixture（T011），不依赖批② 导入管线（N-4 已规避）

## FR / SC 覆盖映射（19 FR / 17 SC，已按 codex 复核修正）
- FR-001~003 → T004/T005（含 --no-llm/coverage）+ T003；FR-004 → T007/T009a；FR-005 → T009a/T009c；FR-006 → T009b
- FR-007/008 → T006/T010；FR-009 → T016/**T018**；FR-010 → T014；FR-011 → T015；FR-012 → T016；FR-013/014 → T017；FR-015 → T009b/T016；FR-016 → T013
- FR-017 → T023；FR-018 → T022；FR-019 → T021
- SC-001 T005 / SC-002 T009a+**T022**(阈值) / SC-003 T009a / SC-003b T009c / SC-004 T006+T010 / SC-005 T016+T019 / SC-006 T017 / SC-007 T015+T019（含 prompt 注入）+ SC-007a T014 / SC-008 T022 / SC-009 T009a+T009b / SC-010 T009a+T011 / SC-011 T023 / SC-012 T013+T023 / SC-013 T024 / SC-014 T009c+T023 / **SC-015 T002（kb_search/kb_doc_lookup）+ T011/T019（kb_api_lookup 全路径）**
