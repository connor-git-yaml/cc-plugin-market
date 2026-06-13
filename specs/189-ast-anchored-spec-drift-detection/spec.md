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

---

## Prior Art 深读综合（立项弹药）

> 完整核验记录见 [research/prior-art-synthesis.md](research/prior-art-synthesis.md)。每条来源标注核验状态，未核验来源不进事实层。

### 两条已核验路线

1. **Fiberplane Drift（点锚路线）[已核验]** —— `github.com/fiberplane/drift`。tree-sitter 解析 → **normalized AST**（node kinds + token text，**忽略空白/位置/注释**）→ XxHash3 得 `sig`；binding 存版本化 TOML `drift.lock`（doc path + code target `file#Symbol` + `sig`）；`drift link` 建锚、`drift check` 验锚（stale 则 exit 1，可作 CI gate）。**与我们 F181 symbol id + F174 canonicalize/fuzzy 思路一致，可直接复用；但关键差距：Fiberplane 用 normalized-AST 指纹（格式化不触发），而我们现成的 F182 `skeletonHash` 实为文件级 raw-content SHA-256（`getFullText()`，见 [ast-analyzer.ts:507](../../src/core/ast-analyzer.ts)），格式化/注释会改 hash。因此 MVP prototype 是「文件级 raw-content 指纹」粗粒度版本，normalized-AST + symbol 级指纹是缺口（M9-C follow-up），不能声称「与 Fiberplane 同构」。**

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

**Independent Test**：建锚后修改该 symbol 所在文件使其内容指纹变化，重跑 check，验证该锚 `status: 'stale'` 且 `reason` 指出指纹失配；对**完全未改动**的锚验证保持 `fresh`。

**Acceptance Scenarios**:
1. **Given** 一条 fresh 锚，**When** 被锚 symbol 所在文件实质变化（内容指纹改变）后重跑 check，**Then** 该锚标 `stale`，输出含 `expectedFingerprint`/`actualFingerprint`
2. **Given** 一条 fresh 锚，**When** 被锚文件完全未改动后重跑 check，**Then** 该锚保持 `fresh`
3. **Given** 被锚 symbol 在 graph 中已消失（删除/重命名），**When** 重跑 check，**Then** 该锚标 `orphaned`（区别于 stale）

> ⚠️ **已知 MVP 局限（不在本期验收内，登记给 M9-C）**：MVP 指纹是文件级 raw-content SHA-256，**无法区分格式化/注释变化与语义变化**——纯格式化改动也会触发 `stale`（false-positive）。formatting-insensitivity 需要 normalized-AST 指纹（Fiberplane 式），是 M9-C follow-up，**不在 MVP 闭环**。本期不声称「格式化不误报」。

### User Story 3 — repo:check 集成草案（Priority: P2，本期仅草案不接线）

研发希望 drift check 未来能作为 `repo:check` 链路的一环。**注意两种语境的退出码语义不同**：standalone prototype CLI 作 CI gate 时 stale → exit 1；而挂入 `repo:check` 时 stale → 进 `warnings`（不让 `repo:check` 整体 `fail`，避免 drift 阻断提交）。

**Why this priority**：决定 ship 形态，但本期不并入生产 `repo:check`，仅产集成草案（命令形态 + **两种退出码映射** + gate 严重度建议）。

**Independent Test**：prototype CLI 以独立命令运行，对含 stale 锚的 fixture 输出**退出码 1** + 结构化报告；草案文档描述挂入 `repo:check` 时如何把 stale **映射为 warning（贡献 `warnings` 而非 `status='fail'`）**，且不实际修改 `package.json` / `repo-maintenance-core.mjs`。

---

## Functional Requirements

- **FR-001**：系统 MUST 把 spec 引用经 `canonicalizeSymbolId`（失败时 `resolveSymbolFuzzy`）解析为 graph canonical symbol id；解析失败标 `unresolved`，多候选标 `ambiguous`（附 top-3），不自动误绑。
- **FR-002**：系统 MUST 为每条成功锚定的引用计算并存储**内容指纹**。本期指纹 = symbol 所在文件经 `computeModuleSkeletonHash`（F182，文件级 raw-content SHA-256）得到的值，**复用现成实现、不新造 hash**；该函数对空/全失败文件返回 `undefined`，此时锚 MUST 标 `fingerprint-unavailable`（reason 说明），不写入伪指纹。
- **FR-003**：锚记录 MUST 持久化为可 diff 的 lock 制品（参照 Fiberplane `drift.lock` schema：引用位置 + canonical symbolId + fingerprint + resolvedFrom + matchKind + status），本期落在 `specs/189-*/prototype/` 内，**不写仓库根、不入生产路径**。
- **FR-004**：check 时系统 MUST 重算指纹与存储值比对，分类为 `fresh`（一致）/ `stale`（失配）/ `orphaned`（symbol 已不存在）/ `ambiguous`（多候选）/ `unresolved`（解析失败）/ `fingerprint-unavailable` / `graph-unavailable`（见 FR-010）。
- **FR-005**：check MUST 输出结构化报告（每条锚的 status + reason + expected/actual 指纹）。**standalone prototype CLI** 在含 `stale`/`orphaned` 时 MUST 返回退出码 1（CI gate 友好）；挂入 `repo:check` 的映射语义见 US3 / FR-008（stale → warning，不强制 fail）。
- **FR-006**：系统 MUST 对所有复用的 graph/symbol/skeletonHash 资产保持**只读**——不修改 `src/knowledge-graph`、`src/panoramic/graph`、`src/core/skeleton-hash` 任何生产代码。
- **FR-007**：指纹比对 MUST 仅依赖存储指纹与重算指纹的字面相等，不引入与 F182 口径不一致的归一化。⚠️ 本期 raw-content 指纹**不具备** formatting-insensitivity（纯格式化会触发 stale，已记录为 MVP 局限）；normalized-AST 指纹是 M9-C follow-up，本期 spec **不**对「格式化不误报」做任何承诺。
- **FR-008**：prototype MUST 可独立运行并在 README/决策文档中给出 `repo:check` 集成草案（命令形态 + standalone-exit-1 与 repo:check-warning 两种退出码映射 + 建议 gate 严重度），但**不实际接入**生产 `repo:check`（不改 `package.json` / `repo-maintenance-core.mjs`）。
- **FR-009**：决策文档 MUST 完成点锚 vs 全仓路线选型，含：选哪条 + 排序理由 + M9 ship 路径草案（支撑 SC-005）。
- **FR-010**：graph 不可用（未构建/加载失败）时 check MUST 优雅降级——所有锚标 `graph-unavailable` 并在报告中显式给出 `degraded: true` + reason；standalone CLI 此时 MUST 返回**专用退出码（非 0，区别于 stale 的 1，如 2）**，避免 graph 缺失被误读为「全部 fresh、check 通过」。
- **FR-011**：本期 prototype 的 **spec 引用输入采用显式契约**（MVP 不做 Markdown 自由文本的引用抽取——那是 ship 前才定的 NLP/语法问题，见 follow-up）。最小输入 = 一个 JSON/YAML fixture，每条引用记 `{ ref: string, docPath: string, line: number }`；`ref` 是要解析的 symbol 表达式（如裸名或 `file::Symbol`）。lock 制品据此记录引用位置（docPath + line）。从 Markdown 正文自动抽取引用的语法是 **ship 前 follow-up**，不在 MVP 闭环。

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
2. **不做全仓语义矛盾推理**。本期只做点对点的「锚点 staleness」（指纹失配），不做 constraint-graph 级的 doc-vs-doc / doc-vs-code contradiction 推理（那是更远期、误报面更大的形态）。
3. **不并入 master 生产路径**。不改 MCP 工具契约、不改 `repo:check` 实际脚本、不改任何 `src/` 生产代码（与并行 F195 graph-only 不撞车）。
4. **不追求语言全覆盖**。prototype 锚定依赖现有 graph 已支持的语言/symbol 抽取，不新增 parser。
5. **不做 symbol 级指纹与 rename-follow**（M9+ 增强，本期写进决策文档 follow-up，不在闭环内）。

---

## Success Criteria

- **SC-001**：`specs/189-*/` 含 spec.md，且 spec 含 prior art 深读综合（每条标核验状态）+ 可核验的问题规模弹药 + 明确非目标。
- **SC-002**：prototype 可运行——给定一个 spec 引用 fixture + 一次 symbol 变化，能正确标出 stale（US2 AC-1）；未改动锚保持 fresh（US2 AC-2）、symbol 消失标 orphaned（US2 AC-3）。（formatting-insensitivity **不在** 本期验收，见 US2 局限说明。）
- **SC-003**：锚定能解析无前缀裸名引用到 canonical id 并记录 matchKind，多候选时不误绑（US1 AC-1/AC-2）。
- **SC-004**：复用资产全程只读，`src/` 生产代码零改动（FR-006），`git diff --stat src/` 为空。
- **SC-005**：决策文档完成点锚 vs 全仓路线选型——明确选哪条 + 理由 + M9 ship 路径草案（FR-009）。
- **SC-006（顶层验收）**：上述四项制品（spec / 可运行 prototype / 只读约束 / 决策文档）齐备，构成"立项闭环"，为 M9 ship 决策提供可执行依据。

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
