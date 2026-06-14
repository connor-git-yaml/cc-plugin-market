# Feature Specification: AST-anchored Spec Drift Detection

**Feature Branch**: `189-ast-anchored-spec-drift-detection`
**Created**: 2026-06-13
**Status**: Draft（本期只产 spec + prototype + 路线选型，不求 ship）
**Milestone**: M8 轨道 B 旗舰
**关联调研**: [research/prior-art-synthesis.md](research/prior-art-synthesis.md)

---

## 背景与目标

Spec-driven 研发的核心资产是 spec/plan 文档对代码实体的引用（"`canonicalizeSymbolId` 在 `query-helpers.ts`"、"graph 写盘走 `normalizeGraphForWrite`"）。这些引用在代码演进中会**悄悄失真**：symbol 被重命名、文件被移动、函数体被重写，而文档照旧。读到失真引用的人类或 AI agent 会基于错误前提决策——这正是 [research/prior-art-synthesis.md §5](research/prior-art-synthesis.md) 中 AGENTbench 实证的「冗余/过时 context 主动拉低 agent 成功率」问题。

本 Feature 立项做 **AST-anchored spec drift detection**：把 spec/plan 中引用的代码实体**锚定到 Spectra 的 symbol id + 内容指纹**，当被锚定实体发生实质变化时把对应 spec 引用标记为 **stale**，从而把"文档腐化"从不可见变成可在 `repo:check` 中拦截的信号。

**本期范围严格限定**（详见 §护栏）：
- 产 **spec.md**（含 prior art 综合 + 问题规模弹药 + 非目标）
- 产**可运行 prototype**（最小闭环：一个 spec 引用 + 一次 symbol 变化 → 标出 stale）
- 产**路线选型决策文档**（点锚 vs 全仓，给选型 + 理由 + M9 ship 路径草案）
- **不**并入 master 生产路径、**不**改现有 MCP 工具契约、**不**改 `src/panoramic`/`src/knowledge-graph` 生产代码（只读复用）

### Gate 决策修订（GATE_DESIGN 后，用户拍板）

| 决策 | 用户选择 | 对 scope 的影响 |
|------|---------|----------------|
| prototype 验证哪条路线 | **两条都做最小 demo**（点锚 + 全仓） | 新增 US4（全仓最小 demo）；全仓从「M9+ 非目标」提为「本期 demo 级闭环」，但仍非生产实现 |
| prototype 指纹粒度 | **prototype 内现写 symbol 级** | FR-002/FR-007 升级：指纹改为 **symbol 级源切片 hash（带空白归一化）**，不再用 F182 文件级 hash；这消除「同文件他处改动连累」误报，并实现**空白不敏感**（注释/全 AST 不敏感仍属 M9-C） |

> ⚠️ symbol 级指纹仍是 prototype 内**独立只读实现**（调 `analyzeFiles` 取 `ExportSymbol.startLine/endLine` 切片再 hash），**不改** `src/core/skeleton-hash.ts` 等生产 hash 逻辑。

---

## Prior Art 深读综合（立项弹药）

> 完整核验记录见 [research/prior-art-synthesis.md](research/prior-art-synthesis.md)。每条来源标注核验状态，未核验来源不进事实层。

### 两条已核验路线

1. **Fiberplane Drift（点锚路线）[已核验]** —— `github.com/fiberplane/drift`。tree-sitter 解析 → **normalized AST**（node kinds + token text，**忽略空白/位置/注释**）→ XxHash3 得 `sig`；binding 存版本化 TOML `drift.lock`（doc path + code target `file#Symbol` + `sig`）；`drift link` 建锚、`drift check` 验锚（stale 则 exit 1，可作 CI gate）。**与我们 F181 symbol id + F174 canonicalize/fuzzy 思路一致，可直接复用。指纹层有谱系差异（三档由粗到细）：F182 `skeletonHash` = 文件级 raw-content SHA-256（`getFullText()`，见 [ast-analyzer.ts:507](../../src/core/ast-analyzer.ts)，格式化/注释都改 hash，最粗）< 本 prototype = symbol 级源切片 + 逐行空白归一化（GATE 决策，缩进/空行不敏感，中）< Fiberplane = 完整 normalized-AST（忽略全部格式化与注释，最细，= 我们的 M9-C 目标）。故本 prototype 既不复用 F182 文件级 hash，也未达 Fiberplane 全 AST 归一——是中间档，不能声称「与 Fiberplane 同构」。**

2. **OpenLore（全仓/图节点路线）[已核验]** —— `github.com/clay-good/OpenLore`。代码库建成 SQLite 知识图谱（functions/routes/DB schema），OpenSpec living spec 与之 co-equal；`openlore drift` 把 git diff × spec 映射比对，分 Gap/Stale/Uncovered/ADR-gap 四类。锚点粒度偏 file/domain 级（靠 `Source files` header + 目录启发式）。**与我们 F193/F183 封闭图链 + `specs/` 形态契合，但我们的图节点已下到 symbol 级，理论上能给更细的锚点。**

### 边界 archetype（不绑产品名）
- **全仓矛盾 lint + MCP 暴露 [未核验为真实产品]** —— 把全仓 doc/spec/code/test 抽成 constraint graph 做 contradiction 推理。这是比 staleness 检测更激进、误报面更大的形态，明确划入非目标。

### 问题规模弹药
- 文档腐化规模：**约 25–40% 文档元素在 6 个月内过时**、约 **65% 维护团队**把"过时文档"列为重大阻碍 [二手综合估计/需 primary citation——来自 Perplexity 对多份文献的转述，spec 引用为佐证性背景而非单一权威事实]。
- **AGENTbench/SWE-bench 反例（冗余 context 风险）[已核验]**：ETH Zurich《Evaluating AGENTS.md》—— LLM 生成的 context 文件平均把成功率拉低 ~2–3%、token +20–23%；伤害来自**与代码冗余**而非文档本身。⚠️ 此证据直接支撑的是「**冗余** context 伤害 agent」（→ 非目标「不生成更多文档」），**不是**直接验证「stale 引用」的危害；drift 规模本身由上一条文档腐化研究支撑，两者分工引用，不混用。

> ⚠️ 用户原始 prompt 中的「Meta 生产分类法 ~30% spec drift」**经定向核验未找到任何 Meta 来源**，不作为事实引用（详见 synthesis §0/§4）。问题规模改由上述可核验数据支撑。

---

## User Scenarios & Testing

### User Story 1 — spec 引用锚定到 symbol id（Priority: P1）

研发在 spec/plan 中写下对代码实体的引用（如 `canonicalizeSymbolId`），希望系统把它绑定到 graph 中唯一的 canonical symbol id 并盖上内容指纹，建立可校验的锚。

**Why this priority**：锚定是 drift 检测的前提；没有可靠锚就没有可靠 stale 信号。这是 prototype 闭环的入口。

**Independent Test**：构造含 `src/knowledge-graph/query-helpers.ts::canonicalizeSymbolId` 节点的最小 graph fixture，对引用 `canonicalizeSymbolId`（无路径前缀）建锚，验证：(1) 解析路径正确——先经 `canonicalizeSymbolId` 做 exact/前缀/路径归一，裸名（无 `::`）落到 `resolveSymbolFuzzy` 的 partial-name 层得唯一候选；(2) 锚记录含 `symbolId`（canonical）+ `fingerprint`（该 symbol 所在文件的 raw-content 指纹）+ `resolvedFrom` + `matchKind`（如 `partial-name`）。

**Acceptance Scenarios**:
1. **Given** graph 中存在唯一节点 `…query-helpers.ts::canonicalizeSymbolId`，引用为裸名 `canonicalizeSymbolId`，**When** 建锚，**Then** 锚记录含 canonical `symbolId`、非空 `fingerprint`、`resolvedFrom: 'canonicalizeSymbolId'`、`matchKind`（记录走 exact 还是 fuzzy partial-name）
2. **Given** 引用解析出多候选（歧义），**When** 建锚，**Then** 不自动绑定，锚标 `status: 'ambiguous'` 并附 top-3 候选（复用 F174 fuzzy 语义，杜绝误绑）

### User Story 2 — symbol 变化标 stale 的最小闭环（Priority: P1）

被锚定的 symbol 实质变化（函数体改写/重命名/文件移动）后，研发重跑 check，系统应把对应 spec 引用标为 stale。

**Why this priority**：这是本 Feature 的核心价值与 SC-006 验收点——"给定一个 spec 引用 + 一次 symbol 变化，能标出 stale"。

**Independent Test**：建锚后修改被锚 **symbol 自身函数体**使其源切片变化，重跑 check，验证该锚 `status: 'stale'` 且 `reason` 指出指纹失配；对**仅空白重排**的同一 symbol 验证保持 `fresh`；对**同文件内其他 symbol 改动**验证本锚保持 `fresh`（symbol 级粒度不连累）。

**Acceptance Scenarios**:
1. **Given** 一条 fresh 锚，**When** 被锚 symbol 函数体实质变化（源切片改变）后重跑 check，**Then** 该锚标 `stale`，输出含 `expectedFingerprint`/`actualFingerprint`
2. **Given** 一条 fresh 锚，**When** 被锚 symbol 仅空白/缩进重排（语义不变）后重跑 check，**Then** 该锚保持 `fresh`（symbol 级指纹做了空白归一化）
3. **Given** 一条 fresh 锚，**When** **同文件内另一个** symbol 改动、被锚 symbol 自身不变，**Then** 本锚保持 `fresh`（symbol 级粒度，不被同文件他处连累）
4. **Given** 被锚 symbol 在 graph 中已消失（删除/重命名），**When** 重跑 check，**Then** 该锚标 `orphaned`（区别于 stale）

> ⚠️ **指纹粒度与局限**（GATE_DESIGN 升级后）：prototype 指纹 = symbol 源切片（`startLine..endLine`）经**逐行空白归一化**（保留换行）后的 SHA-256，自实现、只读、不改生产 hash。已达成：symbol 级（不连累同文件）+ 缩进/行内空白/空行不敏感。**刻意不做**跨行折叠（避免 `return\n1` 这类 ASI 语义漏报）。**仍未达成（M9-C）**：注释/字面值/完整 normalized-AST 不敏感——改注释/改字面值仍会触发 stale。本期只声称「缩进/行内空白/空行不敏感」。

### User Story 3 — repo:check 集成草案（Priority: P2，本期仅草案不接线）

研发希望 drift check 未来能作为 `repo:check` 链路的一环。**注意两种语境的退出码语义不同**：standalone prototype CLI 作 CI gate 时 stale → exit 1；而挂入 `repo:check` 时 stale → 进 `warnings`（不让 `repo:check` 整体 `fail`，避免 drift 阻断提交）。

**Why this priority**：决定 ship 形态，但本期不并入生产 `repo:check`，仅产集成草案（命令形态 + **两种退出码映射** + gate 严重度建议）。

**Independent Test**：prototype CLI 以独立命令运行，对含 stale 锚的 fixture 输出**退出码 1** + 结构化报告；草案文档描述挂入 `repo:check` 时如何把 stale **映射为 warning（贡献 `warnings` 而非 `status='fail'`）**，且不实际修改 `package.json` / `repo-maintenance-core.mjs`。

### User Story 4 — 全仓路线最小 demo（Priority: P2，GATE_DESIGN 决策新增）

为给 M9 路线选型提供对照，prototype 额外做一个**全仓（OpenLore 式）最小 demo**：给定一组「改动文件」+ spec 的「Source files 映射」，分类出 drift 类别，与点锚路线并列展示差异。

**Why this priority**：用户在 GATE_DESIGN 选择「两条都做最小 demo」，全仓 demo 用于实证两条路线的覆盖面/误报差异，喂给决策文档定稿。**仅 demo 级**（不建生产分类引擎、不接 git 真实 diff，用 fixture 模拟改动文件集）。

**Independent Test**：构造「改动文件列表」+「spec→Source files 映射」fixture，跑全仓 demo，验证能正确分出 `gap`（文件在映射内且改动但 spec 未动）/ `uncovered`（改动文件无任何映射）/ `stale-ref`（spec 映射指向已删除文件）三类，并输出与点锚 demo 对照的结构化报告。

**Acceptance Scenarios**:
1. **Given** 文件 `X` 在 domain D 的 Source files 内且被改动、D 的 spec 未改，**When** 跑全仓 demo，**Then** 报 `gap`（X→D）
2. **Given** 改动文件 `Y` 不在任何 domain 映射内，**When** 跑全仓 demo，**Then** 报 `uncovered`（Y）
3. **Given** domain D 的 Source files 列了已删除的 `Z`，**When** 跑全仓 demo，**Then** 报 `stale-ref`（D→Z）

---

## Functional Requirements

- **FR-001**：系统 MUST 把 spec 引用经 `canonicalizeSymbolId`（失败时 `resolveSymbolFuzzy`）解析为 graph canonical symbol id；解析失败标 `unresolved`，多候选标 `ambiguous`（附 top-3），不自动误绑。**解析目标 MUST 限 symbol 节点**（id 含 `::`）——ref 命中同名 module 路径（无 `::`）不得作为锚（防 module/symbol 混淆误绑）。
- **FR-002**：系统 MUST 为每条成功锚定的引用计算并存储 **symbol 级内容指纹**（GATE_DESIGN 升级）。指纹 = 调 `analyzeFiles([filePath])` 取该 symbol 的 `ExportSymbol.startLine/endLine`，切片源码后**空白归一化**再 SHA-256；为 prototype 内独立只读实现，**不改** `src/core/skeleton-hash.ts`。symbol 在文件中找不到（span 缺失/解析失败）时锚 MUST 标 `fingerprint-unavailable`（reason 说明），不写伪指纹。
- **FR-003**：锚记录 MUST 持久化为可 diff 的 lock 制品（参照 Fiberplane `drift.lock` schema：引用位置 + canonical symbolId + fingerprint + resolvedFrom + matchKind + status），本期落在 `specs/189-*/prototype/` 内，**不写仓库根、不入生产路径**。
- **FR-004**：check 时系统 MUST 重算指纹与存储值比对，分类为 `fresh`（一致）/ `stale`（失配）/ `orphaned`（symbol 已不存在）/ `ambiguous`（多候选）/ `unresolved`（解析失败）/ `fingerprint-unavailable` / `graph-unavailable`（见 FR-010）。
- **FR-005**：check MUST 输出结构化报告（每条锚的 status + reason + expected/actual 指纹）。**standalone prototype CLI 退出码语义**：`stale`/`orphaned`（已确认 drift）→ **1**；`graph-unavailable`/`fingerprint-unavailable`（无法验证）→ **2**（CI 不得把"无法验证"误读为通过）；全 `fresh` → 0。优先级：graph 整体不可用 > 确认型 drift > 单锚无法验证。挂入 `repo:check` 的映射语义见 US3 / FR-008（stale → warning，不强制 fail）。
- **FR-006**：系统 MUST 对所有复用的 graph/symbol/skeletonHash 资产保持**只读**——不修改 `src/knowledge-graph`、`src/panoramic/graph`、`src/core/skeleton-hash` 任何生产代码。
- **FR-007**：symbol 级指纹 MUST 对源切片做**逐行空白归一化**（折叠每行内空格/Tab、去行首尾、丢弃空行，**但保留换行结构**）后再 hash，使缩进/行内空白/空行重排**不触发** stale。⚠️ **保留换行**是刻意设计——折叠换行会把 `return\n1`（ASI 下返回 undefined）与 `return 1` 误判为相同（语义漏报）。本期承诺「缩进/行内空白/空行不敏感」，**不**承诺跨行重排不敏感，也**不**承诺注释/字面值/完整 normalized-AST 不敏感（M9-C follow-up）。
- **FR-008**：prototype MUST 可独立运行并在 README/决策文档中给出 `repo:check` 集成草案（命令形态 + standalone-exit-1 与 repo:check-warning 两种退出码映射 + 建议 gate 严重度），但**不实际接入**生产 `repo:check`（不改 `package.json` / `repo-maintenance-core.mjs`）。
- **FR-009**：决策文档 MUST 完成点锚 vs 全仓路线选型，含：选哪条 + 排序理由 + M9 ship 路径草案（支撑 SC-005）。
- **FR-010**：graph 不可用（未构建/加载失败）时 check MUST 优雅降级——所有锚标 `graph-unavailable` 并在报告中显式给出 `degraded: true` + reason；standalone CLI 此时 MUST 返回**专用退出码（非 0，区别于 stale 的 1，如 2）**，避免 graph 缺失被误读为「全部 fresh、check 通过」。
- **FR-011**：本期 prototype 的 **spec 引用输入采用显式契约**（MVP 不做 Markdown 自由文本的引用抽取——那是 ship 前才定的 NLP/语法问题，见 follow-up）。最小输入 = 一个 JSON/YAML fixture，每条引用记 `{ ref: string, docPath: string, line: number }`；`ref` 是要解析的 symbol 表达式（如裸名或 `file::Symbol`）。lock 制品据此记录引用位置（docPath + line）。从 Markdown 正文自动抽取引用的语法是 **ship 前 follow-up**，不在 MVP 闭环。
- **FR-012**（GATE_DESIGN 新增）：prototype MUST 额外提供**全仓路线最小 demo**——输入「改动文件列表」+「spec→Source files 映射」fixture，输出 `gap` / `uncovered` / `stale-ref` 分类（US4）。**仅 demo 级**：用 fixture 模拟改动文件集，不接真实 git diff、不建生产分类引擎、不接 `repo:check`。其报告 MUST 与点锚 demo 并列，供决策文档实证两路线差异。

---

## Prototype 输入契约（最小闭环，对应 FR-011）

```jsonc
// references.fixture.json —— prototype 的引用输入（不依赖 Markdown 抽取）
{
  "references": [
    { "ref": "canonicalizeSymbolId", "docPath": "specs/189-.../spec.md", "line": 147 }
  ]
}
```
锚记录（lock 制品）形态（参照 Fiberplane `drift.lock`）：
```jsonc
{
  "ref": "canonicalizeSymbolId",
  "docPath": "specs/189-.../spec.md", "line": 147,
  "symbolId": "src/knowledge-graph/query-helpers.ts::canonicalizeSymbolId",
  "resolvedFrom": "canonicalizeSymbolId", "matchKind": "partial-name",
  "fingerprint": "<file-level sha256>", "status": "fresh"
}
```

---

## Edge Cases

- **多候选歧义**：引用 `foo` 命中多个 symbol → `ambiguous` + top-3，不自动绑（复用 F174 不误自动 resolve 不变量）。
- **symbol 重命名 vs 删除**：重命名后旧 id 消失 → 本期统一标 `orphaned`（rename-follow 是 M9+ 增强，写进决策文档 follow-up）。
- **文件级指纹的粒度损失**：同文件内 symbol A 被锚、symbol B 变化导致文件 skeletonHash 变 → A 会被标 stale（false-positive）。本期接受此粒度并显式记录为已知局限；symbol 级指纹是 M9+ 增强（对齐 Fiberplane `#Symbol` 粒度）。
- **graph 未构建 / symbol 来源缺失**：graph 不可用时 check MUST 标 `graph-unavailable` + `degraded: true` 并返回专用非零退出码（FR-010），**不得**降级成「全部 fresh、静默 exit 0」——否则缺 graph 会被误读为 check 通过。单个引用解析失败（graph 在但 symbol 找不到）才标 `unresolved`，与整体 `graph-unavailable` 区分。
- **跨 worktree id 形态差异**：复用 F193 相对化口径解析锚 id，避免绝对/相对路径分叉（canonicalize 已含 abs↔rel 容错）。

---

## 非目标（Non-Goals）—— 必须钉死的边界

1. **不自动生成额外的产品/spec 覆盖文档**。本 Feature 的目的是**证伪并标出不真实的 spec 引用**，使 spec 保持「精简且真实」，**绝不**是自动产出更多 spec/注释/覆盖文档。（本 feature 自身的 spec.md / prototype README / 决策文档属于立项制品，不在此列。）依据：AGENTbench 实证（synthesis §5）证明**冗余** context 主动拉低 agent 成功率——故 drift 检测服务于「删/修不真实引用」而非「增覆盖」。
2. **不做全仓语义矛盾推理**。全仓路线本期**仅 demo 级**（US4/FR-012：fixture 模拟改动文件 × Source files 映射的分类），**不**建生产分类引擎、不接真实 git diff、不做 constraint-graph 级 doc-vs-doc/doc-vs-code contradiction 推理（那是更远期、误报面更大的形态，M9+）。
3. **不并入 master 生产路径**。不改 MCP 工具契约、不改 `repo:check` 实际脚本、不改任何 `src/` 生产代码（与并行 F195 graph-only 不撞车）。
4. **不追求语言全覆盖**。prototype 锚定依赖现有 graph 已支持的语言/symbol 抽取，不新增 parser。
5. **symbol 级指纹本期已做（demo 级，空白归一化），但不做完整 normalized-AST 等价与 rename-follow**（注释/AST 不敏感 = M9-C，rename-follow = M9-D，写进决策文档 follow-up）。

---

## Success Criteria

- **SC-001**：`specs/189-*/` 含 spec.md，且 spec 含 prior art 深读综合（每条标核验状态）+ 可核验的问题规模弹药 + 明确非目标。
- **SC-002**：prototype 可运行——给定一个 spec 引用 fixture + 一次 symbol 变化，能正确标出 stale（US2 AC-1）；未改动锚保持 fresh（US2 AC-2）、symbol 消失标 orphaned（US2 AC-3）。（formatting-insensitivity **不在** 本期验收，见 US2 局限说明。）
- **SC-003**：锚定能解析无前缀裸名引用到 canonical id 并记录 matchKind，多候选时不误绑（US1 AC-1/AC-2）。
- **SC-004**：复用资产全程只读，`src/` 生产代码零改动（FR-006），`git diff --stat src/` 为空。
- **SC-005**：决策文档完成点锚 vs 全仓路线选型——明确选哪条 + 理由 + M9 ship 路径草案（FR-009）。
- **SC-007**（GATE_DESIGN 新增）：prototype 含全仓路线最小 demo，能从 fixture 正确分出 `gap`/`uncovered`/`stale-ref`（US4），并与点锚 demo 并列对照（FR-012）。
- **SC-006（顶层验收）**：上述制品（spec / 可运行 prototype【点锚 + 全仓双 demo】/ 只读约束 / 决策文档）齐备，构成"立项闭环"，为 M9 ship 决策提供可执行依据。

---

## 护栏 / 边界（执行约束）

| 约束 | 具体要求 |
|------|---------|
| 制品范围 | 限 spec + prototype 分支 + 决策文档；不并入 master 生产路径 |
| 资产复用 | graph/symbol/skeletonHash **只读**；不改 `src/knowledge-graph`、`src/panoramic/graph`、`src/core/skeleton-hash` |
| 防撞车 | 不动 graph 生产代码，避免与并行 F195 graph-only 冲突 |
| 提交方式 | 显式路径提交，禁 `git add -A`；排除 `specs/src.spec.md` 等自动再生制品 |
| 价值边界 | drift 检测服务于「精简真实的 spec」，不是生成更多文档（非目标 #1） |

---

## 复用资产清单（只读）

| 资产 | 位置 | 用途 |
|------|------|------|
| `canonicalizeSymbolId` / `resolveSymbolFuzzy` | `src/knowledge-graph/query-helpers.ts:139,420` | 引用 → canonical symbol id（F174） |
| `computeModuleSkeletonHash` / `combineSkeletonHashes` | `src/core/skeleton-hash.ts` | 内容指纹（F182，**文件级 raw-content SHA-256**，非 normalized-AST；格式化敏感，见 FR-007 局限） |
| `relativizeSymbolId` | `src/knowledge-graph/relativize.ts:100` | id 相对化口径（F193） |
| `buildUnifiedGraph` / `getCurrentUnifiedGraph` | `src/knowledge-graph/index.ts` | 读取 graph 节点（只读） |
