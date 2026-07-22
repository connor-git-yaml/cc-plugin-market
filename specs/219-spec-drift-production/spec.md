# Feature Specification: Spec Drift 首次生产发布（M9 轨道 C）

**Feature Branch**: `219-spec-drift-production`
**Created**: 2026-07-21
**Revised**: 2026-07-21（GATE_DESIGN 拍板 + Codex 对抗审查收口）
**Status**: Draft（定稿，待 plan）
**Milestone**: M9 轨道 C（Spec Drift Ship）
**上游立项**: [specs/189-ast-anchored-spec-drift-detection/spec.md](../189-ast-anchored-spec-drift-detection/spec.md) · [decision/route-selection.md](../189-ast-anchored-spec-drift-detection/decision/route-selection.md)
**关联**: [docs/design/milestone-M9-codex-trusted-live-graph.md §5](../../docs/design/milestone-M9-codex-trusted-live-graph.md)

---

## 背景与目标

F189 已完成点锚路线（Fiberplane Drift 式）的立项闭环：spec + prototype（11/11 场景通过）+ 路线选型决策，证明"引用 → canonical symbol id → symbol 级内容指纹 → stale/fresh/orphaned 判定"这条链路可行，且**只读复用**了 F174（canonicalize/fuzzy）、F181（symbol id）、F193（relativize）三项既有资产。但 F189 的产物明确标注"不并入 master 生产路径"——prototype 代码活在 `specs/189-*/prototype/`，没有 CLI、没有接入 `repo:check`、指纹粒度停在"symbol 级源切片 + 空白归一化"的中间档。

本 Feature（F219，M9-C）把这条路线**从 prototype 推向生产发布**，对应 milestone 文档 §5 三个子阶段：

- **C1**：`drift link` / `drift check` / `drift unlink` 生产 CLI，lock 制品持久化，prototype 三模块（point-anchor/fingerprint/resolve）迁入 `scripts/`。
- **C2**：接入 `repo:check`（`validateRepository`）第 13 检查族，stale/orphaned 等默认 warning，`--strict` 或 lock 损坏才 hard fail。
- **C3**：指纹从"symbol 源切片 + 逐行空白归一化"升级为**目标态的 parser-specific canonical AST fingerprint**——归一化 TypeScript/JavaScript symbol 的 AST 结构与 token，忽略格式与全部注释/JSDoc；在归一化算法与 fixture 证据尚未落地实现前，本 spec 不声称已等价于 Fiberplane 的完整 tree-sitter normalized-AST，只声明目标与合同。

**现状与目标的诚实差距**（避免 over-claim）：
- prototype 指纹是"symbol 级源切片 + 逐行空白归一化"的中间档；C3 完成后目标是"parser-specific canonical AST fingerprint"（忽略格式与全部注释），但这仍是基于现有 TypeScript AST 分析器（ts-morph）的、语言范围受限的实现，不等同 Fiberplane 基于 tree-sitter 的多语言 normalized-AST 方案。
- rename-follow、全仓自动映射均**不**在本 Feature 范围（M10），重命名统一标 `orphaned`。
- **本期建锚 UX = 独立引用清单文件**（GATE_DESIGN 拍板 CL-2，见下）；spec/文档内嵌标记语法的自动扫描明确推迟到 M10。

### GATE_DESIGN 已拍板合同（不可再讨论，作为本 spec 的确定前提）

| 编号 | 决策 | 影响 |
|------|------|------|
| **CL-1** | lock 制品格式 = **JSON**，路径 = **`.specify/spec-drift.lock.json`**（零新依赖，复用现有 JSON 解析栈，不引入 TOML 解析器） | FR-003 |
| **CL-2** | 建锚 UX = **独立引用清单文件**（沿用 F189 prototype 现状：`{ id, ref, docPath, line }[]` 的显式 JSON/YAML 输入）；`drift link` 只处理清单里显式列出的引用，不扫描 Markdown 正文自动发现锚点。spec 内嵌标记语法的自动扫描留 M10 | FR-001/FR-016、非目标 #3 |
| **CL-3** | 注释/JSDoc **全不计入**指纹（贴近 Fiberplane：normalized AST 只看结构 + token，忽略全部行内注释、块注释与前导 JSDoc）。US4/FR-009 的验收改为单一确定断言：改注释、改 JSDoc、纯格式化三类改动 **一律** 判 `fresh`；只有 AST 结构/token（标识符、字面值、运算符、语法结构）变化才判 `stale` | FR-009(c)、SC-001 |

---

## User Scenarios & Testing

### User Story 1 — 建锚与刷新（`drift link`）（Priority: P1）

研发在**独立引用清单文件**（CL-2）中登记对代码 symbol 的引用后，运行 `drift link` 把该引用登记为一条可校验的锚，写入 `.specify/spec-drift.lock.json`；已存在的锚可被刷新（`--refresh`，重新解析 + 重算指纹）或按稳定 `id` 显式删除（`drift unlink <id>`）。

**Why this priority**：没有生产可用的建锚入口，C2/C3 的检测能力无从落地——这是本 Feature 价值链的第一环。

**Independent Test**：对一份含真实引用条目（`{ id: "spec219-canonicalizeSymbolId", ref: "src/knowledge-graph/query-helpers.ts::canonicalizeSymbolId", docPath: "...", line: 147 }`）的清单文件跑 `drift link`，验证 lock 制品新增一条记录，含 canonical `symbolId` + `fingerprint` + `fingerprintVersion` + `matchKind`（**不含** `status` 字段，见 FR-002/W1）；对已存在的锚重跑 `drift link --refresh`，验证指纹按当前代码重算；对指定 `id` 跑 `drift unlink <id>`，验证该条记录从 lock 移除、其余锚不受影响。

**Acceptance Scenarios**:
1. **Given** 引用清单中一条尚未建锚的条目，且其 `ref` 在 graph 中唯一可解析，**When** 运行 `drift link`，**Then** lock 制品新增一条记录（`symbolId` + `fingerprint` + `fingerprintVersion` + `matchKind`，无 `status` 字段），CLI 输出建锚摘要（成功/歧义/未解析计数）
2. **Given** 一条已存在的锚，其目标 symbol 代码未变，**When** 运行 `drift link --refresh`，**Then** 该锚指纹与刷新前一致
3. **Given** 一条已存在的锚被指定 `id` 删除，**When** 运行 `drift unlink <id>`，**Then** 该条记录从 lock 制品移除，其余锚不受影响
4. **Given** 同一 `id` 已存在且未加 `--refresh`，**When** 再次对同 `id` 运行 `drift link`，**Then** CLI 拒绝并提示"该 id 已存在，使用 --refresh 刷新或更换 id"（不静默覆盖，见 W1）
5. **Given** `drift link --refresh` 重新解析后目标引用变为多候选（ambiguous），**When** 刷新执行，**Then** 该锚**保留刷新前的最后一次已知良好指纹与 symbolId**，仅将展示状态标为待人工处理，不因刷新失败而丢失既有可比对基线（见 W1）

### User Story 2 — 生产级 drift 检测（`drift check`）（Priority: P1）

研发或 CI 运行 `drift check`，系统**仅按 lock 中已持久化的 canonical symbolId 做精确匹配**（不重新模糊解析）重新解析目标文件的即时（check-time）内容并重算指纹，输出遵循统一状态矩阵（见 §状态矩阵）的结构化报告与稳定退出码。

**Why this priority**：这是 M9-C 验收的核心——"一条真实 spec→symbol 锚在格式化/注释改动后保持 fresh、在 AST 结构变更后变 stale"（milestone §5 C 轨验收第一条）。

**Independent Test**：对已 link 的锚，分别构造以下场景重跑 `drift check`：(a) symbol 仅格式化/注释/JSDoc 改动（AST 结构与 token 不变）；(b) symbol 签名/操作符/字面值/控制结构等 AST 结构变化；(c) symbol 被删除；(d) 同文件其他 symbol 变动、本 symbol 不变；(e) lock 中记录的 symbolId 对应的 graph 制品若被消费（而非现场重新解析）已过期（仍含已删除 symbol）。验证分别落在 fresh / stale / orphaned / fresh（不误伤）/ graph-stale。

**Acceptance Scenarios**:
1. **Given** 被锚 symbol 仅格式化/注释/JSDoc 改动（AST 结构与 token 不变），**When** 运行 `drift check`，**Then** 该锚保持 `fresh`（C3 归一化 AST fingerprint 忽略格式与全部注释/JSDoc，CL-3）
2. **Given** 被锚 symbol 的签名/操作符/字面值/控制结构等 AST 结构或 token 发生变化，**When** 运行 `drift check`，**Then** 该锚标 `stale`，报告含 `expectedFingerprint`/`actualFingerprint`
3. **Given** 被锚 symbol 已从当前文件消失（删除或重命名，M9 不做 rename-follow），**When** 运行 `drift check`（对目标文件即时重新解析），**Then** 该锚标 `orphaned`
4. **Given** 同文件内另一个未被锚定的 symbol 发生变化、被锚 symbol 本身不变，**When** 运行 `drift check`，**Then** 本锚保持 `fresh`（symbol 级粒度不连累）
5. **Given** lock 制品文件损坏（非法 JSON / schema 不匹配 / 缺失必需字段），**When** 运行 `drift check`，**Then** 整体判定为 `lock-corrupt`，报告明确区分"lock 损坏"与"内容 drift"，不误判为全 fresh
6. **Given** 实现选择消费一份预构建/缓存的 graph 制品做 symbol 存在性判断，且该制品的生成时间早于当前工作树最新改动（制品内仍含磁盘上已删除的 symbol），**When** 运行 `drift check`，**Then** 该锚标 `graph-stale`（而非被误判 `fresh`），报告显式提示需重建 graph 制品

### User Story 3 — `repo:check` 集成（Priority: P1）

研发在日常提交前跑 `repo:check`，drift 检测作为第 13 检查族自动执行（`await` 全链路，不允许静默丢失异步结果）；默认模式下非 `fresh` 的锚状态一律以 warning 呈现，不阻断提交；`--strict` 模式下这些状态被统一提升为 error；`lock-corrupt` 不论是否 `--strict` 都直接 hard fail。

**Why this priority**：milestone §5 C 轨验收明确要求"`repo:check` warning 语义不阻断普通开发，strict 模式可用于 CI hard gate"，且 Codex 对抗审查指出"未 await 的异步调用链会导致检查族静默空跑却报 pass"是真实可复现的设计缺陷,必须在生产接线层面堵死。

**Independent Test**：构造含 stale 锚的仓库状态，跑 `npm run repo:check`，验证 (a) `checks` 数组中确实存在 `id` 含 `spec-drift` 的一条记录（证明该族被真正执行而非被漏 `await` 静默跳过）；(b) 整体 `status` 为 `warn`；同一状态加 `--strict` 参数重跑，验证整体 `status` 变为 `fail`；构造 lock 制品损坏场景，验证不论是否 `--strict` 都判 `fail`。

**Acceptance Scenarios**:
1. **Given** 仓库中存在 1+ 条非 fresh 锚（含确认型 drift 或不可验证态）、lock 制品本身完好，**When** 运行 `repo:check`（默认模式），**Then** 整体 `status` 为 `warn`，`checks` 数组含 `spec-drift` 记录，且 warnings 内容含具体锚信息
2. **Given** 同上场景，**When** 运行 `repo:check --strict`，**Then** 整体 `status` 为 `fail`
3. **Given** lock 制品损坏，**When** 运行 `repo:check`（默认或 `--strict`），**Then** 整体 `status` 均为 `fail`
4. **Given** 仓库中无任何锚或全部锚 fresh，**When** 运行 `repo:check`，**Then** `spec-drift` 检查族贡献 `pass`，不产生 warning/error 噪声
5. **Given** `validateSpecDrift` 的实现内部依赖 `analyzeFiles`（异步）但调用处遗漏 `await`，**Then** 存在专门的防静默测试断言此类回归会被捕获（如断言 `checks` 数组中 `spec-drift` 条目存在且其 `result` 字段非空/非 Promise 残影）

### User Story 4 — normalized symbol AST fingerprint（Priority: P2）

研发希望"改注释、改 JSDoc、纯格式化"这类无害改动**一律不触发**误报 stale（CL-3 已拍板：注释/JSDoc 全不计入），同时系统对首发支持语言范围、member 粒度限制有明确、不摇摆的合同。

**Why this priority**：C3 是 F189 明确遗留的"残留待 M9 项"，且 Codex 指出"未定义 canonical serialization 规则、未定义 member 粒度处理"会直接反例 SC-002（同文件他处改动误伤本锚）。

**Independent Test**：构造 fixture 覆盖：(a) 仅改 span 内行内/块注释；(b) 仅改前导 JSDoc；(c) 仅改格式化（缩进/换行/空格）；(d) 改标识符名/字面值/运算符/控制结构（AST 结构变化）；(e) 引用一个 `Class.method` 形式的 member 目标跑 `drift link`；(f) 引用 Python/Go/Java 等非首发支持语言的 symbol 跑 `drift link`。

**Acceptance Scenarios**:
1. **Given** 仅修改 span 内行内/块注释，**When** 运行 `drift check`，**Then** 该锚保持 `fresh`（CL-3：注释全不计入）
2. **Given** 仅修改前导 JSDoc，**When** 运行 `drift check`，**Then** 该锚保持 `fresh`（CL-3：JSDoc 全不计入）
3. **Given** 仅格式化改动（缩进/空格/换行位置，AST 结构与 token 不变），**When** 运行 `drift check`，**Then** 该锚保持 `fresh`
4. **Given** 标识符名/字面值/运算符/控制结构等 AST 结构变化，**When** 运行 `drift check`，**Then** 该锚标 `stale`
5. **Given** 引用表达式解析出的 canonical symbolId 含 `.`（member，如 `Class.method`），**When** 运行 `drift link`，**Then** 系统 MUST 显式拒绝该锚定目标（不静默回退到 top-level Class 的 span），返回 `fingerprint-unavailable` 并附 reason "member 粒度锚点本期不支持，请锚定 top-level symbol"
6. **Given** 引用解析落在 Python/Go/Java 等非 TypeScript/JavaScript symbol 上，**When** 运行 `drift link`，**Then** 系统标 `unsupported-language`，不尝试任何 fallback 指纹算法

---

## 状态矩阵（唯一权威定义，FR-004/005/006/007 均引用本表）

本表覆盖全部 11 种状态，逐态定义作用域、机器码、CLI 退出码、混合优先级、`repo:check` 两种模式的映射、`degraded` 标记与 next-step 文案。**机器码（machineCode）与 CLI 进程 exitCode 是两个不同维度**：机器码是每条锚（或整份报告）的稳定字符串标识，exitCode 是 `drift check` 单次运行结束时返回给 shell 的单一数值，由"混合优先级"规则从报告中出现的所有状态里选出最严重的一档决定。

| 状态名 | 作用域 | machineCode | 单态 exitCode | 混合优先级（数字越小越先决定整体 exitCode） | `repo:check` 默认映射 | `repo:check` `--strict` 映射 | `degraded` | next-step 文案 |
|--------|--------|-------------|---------------|----------------------------------------------|----------------------|-------------------------------|-----------|----------------|
| lock-corrupt | report 级 | `DRIFT_LOCK_CORRUPT` | 3 | 1（最高） | error | error（已是最高，strict 不改变） | true | "lock 文件无法解析（JSON 语法错误 / schema 不兼容 / 缺失必需字段），先修复 `.specify/spec-drift.lock.json` 再继续" |
| graph-unavailable | report 级 | `DRIFT_GRAPH_UNAVAILABLE` | 2 | 2 | warn | error | true | "AST 分析环境不可用（dist 编译产物缺失或模块加载失败），运行 `npm run build` 后重跑" |
| stale | anchor 级 | `DRIFT_STALE` | 1 | 3 | warn | error | false | "AST 结构/token 已变化，确认 spec 引用是否仍准确：准确则 `drift link --refresh`，不准确则修订 spec 文案" |
| orphaned | anchor 级 | `DRIFT_ORPHANED` | 1 | 3 | warn | error | false | "被锚 symbol 已消失（删除/重命名，M9 不做 rename-follow），`drift unlink` 清理旧锚，如有替代 symbol 重新 `drift link`" |
| ambiguous | anchor 级 | `DRIFT_AMBIGUOUS` | 2 | 4 | warn | error | true | "引用命中多个候选，在引用清单里改写为更精确的 `file::Symbol` 形式后重新 `drift link`" |
| unresolved | anchor 级 | `DRIFT_UNRESOLVED` | 2 | 4 | warn | error | true | "引用未能解析到任何 symbol：裸 symbol 名需补全为 `file::Symbol` 形式；已是 file-qualified 则检查拼写或运行 `drift link --refresh`" |
| fingerprint-unavailable | anchor 级 | `DRIFT_FINGERPRINT_UNAVAILABLE` | 2 | 4 | warn | error | true | "symbol 已解析但取不到可用 span（含 member 粒度被拒绝、fingerprintVersion 不匹配两种子情形），reason 字段会指出具体原因与是否需要 relink" |
| graph-stale | anchor 级 | `DRIFT_GRAPH_STALE` | 2 | 4 | warn | error | true | "消费的 graph 制品早于当前工作树，重建 graph（`spectra batch --mode graph-only`）后重跑" |
| unsupported-language | anchor 级 | `DRIFT_UNSUPPORTED_LANGUAGE` | 2 | 4 | warn | error | true | "该语言本期不支持 symbol 级建锚（首发仅 TypeScript/JavaScript），等待语言支持扩展" |
| parser-degrade | anchor 级 | `DRIFT_PARSER_DEGRADE` | 2 | 4 | warn | error | true | "AST 解析失败（语法错误/编码问题），修复目标文件后重跑" |
| fresh | anchor 级 | `DRIFT_FRESH` | 0 | 5（最低） | pass（不产生 warning） | pass | false | "无需操作" |

**混合优先级计算规则**（决定 `drift check` 单次运行的最终 exitCode）：报告中若同时出现多种状态，按"混合优先级"列从小到大（1 最先）取第一个命中的层级，采用其 exitCode：
1. 存在 `lock-corrupt` → exitCode = 3（验证根本无法开始，最严重）
2. 否则存在 `graph-unavailable` → exitCode = 2（整体验证环境失效）
3. 否则存在 `stale` 或 `orphaned`（确认型 drift）→ exitCode = 1（比"单锚无法验证"更值得立即暴露，这是刻意设计：确认的 drift 是可行动信号，优先级高于"这条锚暂时验证不了"）
4. 否则存在 `ambiguous` / `unresolved` / `fingerprint-unavailable` / `graph-stale` / `unsupported-language` / `parser-degrade` 中任一（单锚无法验证）→ exitCode = 2
5. 否则（全部 `fresh`）→ exitCode = 0

> 此规则直接修正 F189 prototype 的隐患：`ambiguous`/`unresolved` 属于"未验证"而非"已确认干净"，**exitCode 恒不为 0**（层级 4，exitCode 固定 2），不会被误读为"check 通过"。

**`repo:check` 严重度提升规则（单一定义，消解 FR-007 歧义）**：默认模式下，除 `fresh`（pass）与 `lock-corrupt`（恒为 error）外，其余全部状态（无论确认型 drift 还是不可验证态）一律贡献 `warning`；`--strict` 模式下，这些"默认 warn"的状态**全部统一**提升为 `error`（不存在只提升 stale/orphaned、不提升 ambiguous/unresolved 等的差异化规则——避免实现出现两套隐式判断分支）。`--strict` 不改变"全 fresh 时整体 pass"的行为——strict 只影响"非 fresh 状态如何计入整体 status"，不会让"全部 fresh"的干净仓库因为加了 `--strict` 而变 fail。

---

## Functional Requirements

### C1 — `drift link` / `drift check` / `drift unlink`

- **FR-001**：引用清单（CL-2）MUST 是独立的显式 JSON/YAML 文件，每条记录 MUST 含稳定 `id`（用户显式指定的唯一字符串，不由 `docPath+line` 派生——`docPath+line` 会因文档插行而漂移，不能作为主键，见 W1）、`ref`（引用表达式）、`docPath`、`line`。`drift link` MUST 只处理清单里显式列出的条目；MUST NOT 扫描 Markdown 正文自动发现引用（CL-2，spec 内标记自动扫描明确留 M10）。`ref` MUST 为 file-qualified 的 `<relPath>::<symbolName>` 形式（F214 canonical ID 形态，如 `src/knowledge-graph/query-helpers.ts::canonicalizeSymbolId`）；不含 `::` 的裸 symbol 名 MUST 判 `unresolved`（next-step 指引补全为 file-qualified 形式）——这保证 link/check 都只需对 ref 指到的文件做即时解析，无需任何整仓 graph 制品（与 FR-004 graph 真值策略一致）。
- **FR-002**：`drift link` MUST 支持三种操作且行为精确定义：
  - **新增**：`id` 在 lock 中不存在时建锚；解析走 `canonicalizeSymbolId` → `resolveSymbolFuzzy` 兜底（沿用 F189 不变量：多候选标 `ambiguous` + top-3、不自动误绑；解析目标 MUST 限定 symbol 节点，防 module/symbol 混淆误绑）。
  - **刷新**（`--refresh`）：`id` 已存在时重新解析 + 重算指纹并覆盖旧记录；若刷新过程重新解析出多候选（ambiguous）或无候选（unresolved），MUST **保留刷新前最后一次已知良好的 `symbolId`/`fingerprint`**，不得因刷新失败而丢弃既有可比对基线（W1）。
  - **删除**（`drift unlink <id>`）：按稳定 `id` 精确删除单条记录，MUST NOT 依赖 `ref`/`docPath` 反查（因清单中可能存在同 `ref`/`docPath` 的多条记录）。
  - 同一 `id` 未加 `--refresh` 重复 `link` 时 MUST 拒绝执行并提示"该 id 已存在，使用 --refresh 刷新或更换 id"，不静默覆盖。
  - 批处理一次 `drift link` 跑多条清单条目时，MUST 允许部分成功/部分失败（单条 ambiguous/unresolved 不阻断其余条目的建锚），但**最终落盘 MUST 走原子写**（临时文件 + rename），不允许出现"写到一半"的半成品 lock 文件。
- **FR-003**：lock 制品（CL-1）MUST 持久化为 `.specify/spec-drift.lock.json`。schema MUST 只存**绑定与预期指纹**，不持久化运行时派生的 drift 状态——lock 顶层 MUST 含 `schemaVersion`（制品级 schema 版本，单一顶层字段）与 `anchors` 数组；每条 anchor 条目字段集合为 `{ id, ref, docPath, line, symbolId, fingerprint, fingerprintVersion, normalizationProfile, resolvedFrom, matchKind }`，**MUST NOT** 含 `status`/`stale`/`fresh` 等字段；status 永远由 `drift check` 在运行时按状态矩阵重新计算，不写回 lock。`fingerprintVersion`/`normalizationProfile`（如 `"ts-morph-canonical-v1"`）MUST 标识指纹算法版本，供 C3 升级后判断旧锚是否需要 relink（见 FR-009(b)、W2）。
- **FR-004**：`drift check` MUST **仅按 lock 中已持久化的 canonical `symbolId` 做精确匹配查找**（直接在目标文件的即时（check-time）解析结果中按 id 命中/未命中判断存在性），**MUST NOT** 重新执行 `canonicalizeSymbolId`/`resolveSymbolFuzzy` 模糊解析——模糊重新解析只允许由 `drift link --refresh` 显式触发。这一约束防止 check 把"同名新 symbol"误洗成 fresh，也防止掩盖真正的 `orphaned`。
  - **graph 真值策略**：`drift check` 的 symbol 存在性判定与指纹重算 MUST 基于对该 `symbolId` 所在文件的**即时重新解析**（`analyzeFiles` 现场跑，只解析 lock 涉及的目标文件，不依赖任何预构建/缓存的整仓 graph 制品）。
  - 若实现在未来版本选择消费已持久化的 graph 制品做存在性判断，MUST 先比对该制品的生成时间戳/commit 与当前工作树状态；制品落后时该锚 MUST 标记为新增状态 `graph-stale`（而非被误判 `fresh`/`orphaned`），且该场景 MUST 有 fixture 覆盖（构造"旧 graph 制品仍含已删除 symbol，但磁盘文件已删除该 symbol"的场景，验证不被误判为 fresh）。
- **FR-005**：`drift check` MUST 输出遵循§状态矩阵的结构化报告（每条锚的 machineCode + reason + expected/actual 指纹），standalone CLI 的进程 `exitCode` MUST 按状态矩阵"混合优先级计算规则"确定。

### C2 — `repo:check` 集成

- **FR-006**：C2 集成 MUST 在 `scripts/repo-check.mjs` 新增 `--strict` 参数解析，并把该标志沿调用链**全程 `await`** 透传：`await validateRepository(projectRoot, { strict })` → 在 `scripts/lib/repo-maintenance-core.mjs` 内 `await validateSpecDrift({ projectRoot, strict })`（`validateSpecDrift` 内部依赖 `analyzeFiles` 等异步调用，遗漏 `await` 会导致 `aggregateValidation` 拿到未展开的 Promise/空结果，产生"假 pass"的静默 no-op——这是必须在实现前钉死的接线要求）。新增检查族的接入 MUST 照抄 F217 第 12 族（`graph-quality`）的三段式契约：`aggregateValidation('spec-drift', await validateSpecDrift({ projectRoot, strict }), warnings, errors, checks)`。
- **FR-007**：`--strict` 严重度提升规则 MUST 遵循§状态矩阵"`repo:check` 严重度提升规则"的单一定义：默认模式下除 `fresh`（pass）与 `lock-corrupt`（恒 error）外全部状态贡献 `warning`；`--strict` 模式下这些状态统一提升为 `error`；全部 fresh 的仓库加 `--strict` 后 MUST 仍为 `pass`（strict 不是"全 fresh 也 fail"）。
- **FR-008**：MUST 存在专门的防静默 no-op 测试，断言：(a) `validateRepository(...).checks` 数组中确实存在 `id` 含 `spec-drift` 的记录（证明该检查族被真正执行，而非因遗漏 `await` 被跳过）；(b) 该记录的聚合结果反映真实的 warnings/errors 内容而非空数组。

### C3 — normalized symbol AST fingerprint

- **FR-009**：C3 指纹算法 MUST 满足以下 canonical serialization 合同（消解 Codex CRITICAL-4）：
  - **(a) 首发支持语言**：仅 **TypeScript / JavaScript**（经 `ts-js-adapter` 产出 `ExportSymbol.startLine/endLine` 的分析路径）支持 symbol 级建锚。Python / Go / Java（tree-sitter 系适配器，当前不产出可靠的 symbol 级 span）本期一律返回 `unsupported-language`，MUST NOT 做任何 fallback（如退化为文件级指纹）。
  - **(b) 版本声明**：lock 条目 MUST 记录 `fingerprintVersion`/`normalizationProfile`（如 `"ts-morph-canonical-v1"`）。若底层 TypeScript/ts-morph 版本升级导致 AST 输出变化从而需要改变归一化算法，MUST bump 该版本号；`drift check` 发现锚的 `fingerprintVersion` 与当前工具版本不一致时，MUST NOT 直接比较新旧哈希（避免整批旧锚被误报 stale），而是标 `fingerprint-unavailable`（reason 明确写"fingerprintVersion 不匹配，需要 drift link --refresh 重新生成"）。
  - **(c) canonical token 规则**（CL-3 落地为可执行规则）：归一化后进入 hash 的 canonical 序列 MUST 保留——AST 节点 kind、标识符名称、字面值 token（string/number/boolean/等）内容、运算符与关键字 token、控制结构形状；MUST 剥离——全部注释（行内、块注释、前导/尾随 JSDoc）、空白/缩进/换行位置、纯语法噪声（该噪声已由 AST 节点结构表达，不逐字比较源文本）。据此：改注释/JSDoc/纯格式化 MUST 判 `fresh`；改标识符名/字面值/运算符/控制结构 MUST 判 `stale`。
  - **(d) member 粒度硬约束**：canonical symbolId 含 `.`（形如 `Class.method`）的引用，`drift link` MUST 显式拒绝将其作为可锚定目标——返回 `fingerprint-unavailable`，reason 为"member 粒度锚点本期不支持，请锚定 top-level symbol"；MUST NOT 静默回退到整个 Class 的 span（该行为会导致"改 sibling method 误伤被锚 method"，直接反例 SC-002）。
  - **(e) SC-001 收窄**：验收断言从"语义变更 → stale"改为"签名/操作符/字面值/控制结构等**指定 AST 结构变化** → stale"——语法级 hash 比对不能证明一般意义上的"语义"变化，本 spec 不做该层 over-claim。
- **FR-010**：C3 归一化逻辑 MUST 仍是只读复用——不修改 `src/core/ast-analyzer.ts`、`src/core/skeleton-hash.ts`、`src/knowledge-graph/**` 任何生产代码；新增的归一化/序列化逻辑落在 `scripts/` 下 drift 专用模块内。

### 降级与非目标边界

- **FR-011**：分析环境不可用（dist 编译产物缺失/模块动态加载失败）或 lock 制品自身损坏时，`drift check` MUST 按§状态矩阵降级——分别标 `graph-unavailable` / `lock-corrupt`，`degraded: true`，MUST NOT 静默判全部 fresh。
- **FR-012**：`unsupported-language`、`parser-degrade` 两类场景 MUST 使用§状态矩阵中各自独立的 machineCode 与 next-step 文案，不得合并为同一泛化错误提示。
- **FR-013**：本 Feature MUST 保持零 LLM 调用（drift link/check/unlink 全程基于 AST 解析与哈希比对，不依赖模型推理），且 MUST NOT 修改现有 graph/panoramic 的 schema 或输出格式。per-symbol 指纹**只存在于 drift lock 层**（`.specify/spec-drift.lock.json`），MUST NOT 挂载到 knowledge-graph 节点上（删除此前草案中"如需在图上挂 per-symbol hash"的例外分支——首发不存在该逃生口，与 SC-007/SC-010 的 `src/knowledge-graph` 零 diff 要求、与 F220 disjoint 护栏保持一致）。
- **FR-014**（CLI 发布合同）：`drift link` / `drift check` / `drift unlink` MUST 通过统一的 CLI 入口脚本（`scripts/spec-drift-cli.mjs`）暴露，并在 `package.json` 注册 `drift:link` / `drift:check` / `drift:unlink` 三个 script（`npm run drift:check -- --strict` 形式传参）。每个子命令 MUST 支持 `--help`（打印用法与参数说明）与 `--format json`（输出遵循§状态矩阵字段的机器可读 `DriftReport`/操作摘要，供 CI 或其他工具消费）。三个子命令的进程退出码 MUST 遵循§状态矩阵定义（`link`/`unlink` 操作性失败退出非 0，具体码值在 plan 阶段细化，但 MUST 与 `check` 的 0/1/2/3 语义不冲突）。MUST 至少有一条端到端测试从**公开 CLI 入口**（如 spawn 子进程或调用 CLI 的 `main()` 导出）跑通"清单 → link → check（fresh）→ 修改代码 → check（stale）→ unlink"完整闭环，不能只测内部函数单元。
- **FR-015**（lock 生命周期边界，W2）：
  - lock 文件不存在或 `anchors` 为空数组：`drift check` MUST 视为"无锚"，返回全零 summary、`exitCode 0`，MUST NOT 判 `lock-corrupt`（不存在 ≠ 损坏）；`drift link` 首次运行时 MUST 自动创建该文件。
  - lock 数组中任意一条记录缺失必需字段或字段类型不符：MUST 整体判定 `lock-corrupt`（不做"跳过坏条目、继续处理好条目"式的部分容忍——数据完整性边界一旦不确定，不能自证"其余数据可信"）。条目中出现被禁字段（`status`/`stale`/`fresh` 等运行时派生态）同样 MUST 判定 `lock-corrupt`——lock 的 schema 校验是全字段精确校验（必需字段齐全 + 类型正确 + 无被禁字段），不做宽松忽略。
  - lock 顶层 `schemaVersion` 与当前工具不兼容：MUST 判定 `lock-corrupt`，错误信息 MUST 指出版本不兼容且不得按旧 schema 静默继续解析。
  - 并发写入/写入中断：lock 写入 MUST 走原子写（临时文件 + rename）；若检测到残留的临时文件（写入中断的痕迹），`drift check`/`drift link` MUST 给出明确错误提示，不静默使用可能不完整的文件。
- **FR-016**（W3 文档侧锚失效，显式非目标化）：本 Feature MUST NOT 验证引用清单条目自身的存活性——即不检查 `docPath` 对应的文档文件是否仍存在、`line` 处是否仍包含该引用文本。`drift check` 只验证**代码侧** symbol 的 AST 指纹是否漂移；文档被删除/移动、原行文字被改写但清单条目未同步更新，仍可能被判 `fresh`（因为验证对象是代码而非文档定位）。这是显式非目标（与 CL-2"独立清单、维护责任在人工"的形态一致），非实现疏漏；`source-reference-missing` 这类文档侧校验状态留 M10+ 评估。

---

## Key Entities

| 实体 | 说明 |
|------|------|
| **引用清单条目（Reference Entry）** | `{ id, ref, docPath, line }`，`id` 是用户显式指定的稳定主键（W1），不由 `docPath+line` 派生 |
| **Anchor（锚，lock 条目）** | 持久化在 `.specify/spec-drift.lock.json` 的绑定记录，字段见 FR-003；**不含运行时派生的 status** |
| **DriftReport** | `drift check` 的结构化输出：每条锚按§状态矩阵计算出的 machineCode + reason + expected/actual 指纹 + summary 计数 + `degraded` + 进程 `exitCode` |
| **状态矩阵（State Matrix）** | 本 spec 的唯一权威状态定义源，FR-004/005/006/007 均引用，不得在实现中另立隐式状态或隐式提升规则 |
| **normalized symbol AST fingerprint** | C3 核心产物——按 canonical token 规则（FR-009(c)）对 symbol AST 子树序列化后计算的哈希，仅覆盖 TypeScript/JavaScript |
| **spec-drift 检查族** | `repo:check` 第 13 检查族，`{status, warnings, errors, checks}`，接入 `validateRepository`（FR-006） |

---

## Edge Cases

- **多候选歧义**：引用命中多个 symbol → `ambiguous` + top-3，不自动绑。
- **symbol 重命名 vs 删除**（M9 明确非目标 rename-follow）：重命名后旧 id 消失一律标 `orphaned`；next-step 引导研发手动 `drift unlink` 旧锚 + 重新 `drift link` 新引用。
- **lock 制品损坏 / schema 不兼容 / `fingerprintVersion` 不匹配**：三者分别对应 `lock-corrupt`（前两者）与 `fingerprint-unavailable`（后者，FR-015/FR-009(b)），不得混淆处理路径。
- **lock 文件不存在 / 空 lock**：视为"无锚"，`exitCode 0`，不是错误（FR-015）。
- **并发写 / 写入中断**：原子写 + 残留临时文件检测（FR-015）。
- **member 粒度引用**：`Class.method` 形式一律拒绝为不支持的锚定目标（`fingerprint-unavailable`），不静默回退到 Class span（FR-009(d)）。
- **非首发支持语言**：Python/Go/Java 引用一律 `unsupported-language`，不做文件级 fallback（FR-009(a)）。
- **graph 未构建 / graph 制品陈旧**：分别对应 `graph-unavailable`（整体不可用）与 `graph-stale`（制品落后于工作树，FR-004），两者 next-step 不同。
- **跨 worktree id 差异**：复用 F193 relativize 口径，避免绝对/相对路径分叉。
- **文档侧锚失效**：显式非目标（FR-016/W3），`drift check` 不检测文档定位是否仍有效。
- **注释/JSDoc 改动**：CL-3 已确定合同——一律不触发 stale（FR-009(c)），不再是"待裁决盲区"。

---

## Success Criteria

- **SC-001**（收窄，FR-009(e)）：一条真实 spec→symbol 锚，对该 symbol 做"仅注释/JSDoc/纯格式化"改动，`drift check` 判定 `fresh`；对该 symbol 做"签名/操作符/字面值/控制结构等指定 AST 结构变化"，判定为 `stale`。
- **SC-002**：同文件内另一未被锚定的 symbol 发生变化时，已有锚不被误伤，保持 `fresh`；且 member 粒度锚点因 FR-009(d) 被显式拒绝，不存在"回退 Class span 导致 sibling method 变化误伤本锚"的路径。
- **SC-003**：§状态矩阵 11 态中，非 `fresh`/`stale`/`orphaned` 的 8 态（`ambiguous`/`unresolved`/`fingerprint-unavailable`/`graph-unavailable`/`graph-stale`/`lock-corrupt`/`unsupported-language`/`parser-degrade`）均有独立 machineCode 与独立 next-step 文案；单独出现 `ambiguous` 或 `unresolved`（无 `stale`/`orphaned`/更高优先级状态伴随）时，`drift check` 进程 `exitCode` MUST 为 2（不为 0），验证混合优先级计算规则生效。
- **SC-004**：`repo:check` 默认模式下存在任一非 fresh 状态时，`spec-drift` 检查族贡献 `warning`、整体 `status` 为 `warn`；`--strict` 模式下同场景整体 `status` 为 `fail`；`lock-corrupt` 场景不论是否 `--strict` 都为 `fail`；且每次运行均可断言 `checks` 数组中存在 `spec-drift` 记录（证明未被漏 `await` 静默跳过，FR-008）。
- **SC-005**：模拟 `fingerprintVersion` 升级场景（旧 lock 记录的版本号与当前工具不一致），验证旧锚不会被批量误报 `stale`，而是标 `fingerprint-unavailable` 并提示需要 relink（FR-009(b)）。
- **SC-006**：CLI 端到端——从 `npm run drift:link` / `drift:check` / `drift:unlink` 公开入口跑通完整"建锚 → 检测 fresh → 改代码 → 检测 stale → 删锚"闭环，`--help` 与 `--format json` 均可用（FR-014）。
- **SC-007**（治理/回归门）：(a) 存在导入边界测试，断言 `scripts/spec-drift-cli.mjs` 及其依赖模块不 import 任何 LLM provider（证零 LLM，不靠"全测过"泛化断言）；(b) F217 图质量门六个 check id 逐项 `pass`；(c) `repo:check` 既有 12 个检查族的 `id` 与结果不变，`spec-drift` 作为第 13 族出现在聚合结果里且不影响前 12 族；(d) `npx vitest run` + `npm run build` + `npm run repo:check` 全部零失败。
- **SC-008**（写入面基线，基于 merge-base 而非提交后工作树，避免"提交后 diff 为空"的假通过）：`git diff --stat $(git merge-base master HEAD) HEAD -- src/knowledge-graph src/core/skeleton-hash.ts src/core/ast-analyzer.ts src/panoramic src/batch` MUST 为空；允许写入路径限定在以下 allowlist：`scripts/**`（新增 drift CLI 与库）、`scripts/lib/repo-maintenance-core.mjs`（第 13 族接线）、`.specify/spec-drift.lock.json` 及其测试 fixture、`specs/219-spec-drift-production/**`、`tests/**` 中 drift 相关 fixture/测试、`package.json`（新增 3 个 script）。

---

## 护栏与非目标（Non-Goals）

### 护栏（执行约束，回归红线）

| 约束 | 具体要求 |
|------|---------|
| 零 LLM | drift link/check/unlink 全程基于 AST 解析与哈希比对，不调用任何模型；有导入边界测试证明（SC-007a） |
| 图 schema 不变，无逃生口 | 不改 graph/panoramic 输出格式；per-symbol 指纹只存在于 drift lock 层，MUST NOT 挂载到 knowledge-graph 节点（FR-013，已删除此前"如需挂图上"的例外分支） |
| 图质量门零回归 | F217 六指标（duplicate/orphan/contains/dangling/ignored/freshness）在本 Feature 改动后保持全绿，逐项 check id 断言（SC-007b） |
| repo:check 零回归 | 既有 12 检查族 id/结果不变，新增为第 13 族，`--strict` 参数解析与 `await` 链正确（FR-006/007/008） |
| 与 F220 disjoint | 本 Feature 不碰 `src/batch/**`（F220 的拆解范围），写入路径限定在 SC-008 allowlist 内 |
| 只读复用 | 不修改 `src/core/ast-analyzer.ts`、`src/core/skeleton-hash.ts`、`src/knowledge-graph/**`（FR-010） |
| 通用定位红线 | spec/代码/文档中不得出现具体客户名、公司名或行业绑定表述 |
| 提交方式 | 显式路径提交，禁 `git add -A`；排除自动再生制品 |

### 非目标（本 Feature 明确不做）

1. **不做 rename-follow**。symbol 重命名后旧锚统一标 `orphaned`，不做 fuzzy 匹配或 git rename provenance 跟随（M10 范围）。
2. **不做全仓自动映射与 gap/uncovered 分类**（F189 US4 的全仓 demo 路线不推生产）。
3. **不做 spec 内嵌标记语法的自动扫描**（CL-2）。建锚 UX 首发 = 独立引用清单文件；Markdown 正文自动抽取引用留 M10。
4. **不新增覆盖率驱动的功能**。drift 检测服务于"精简且真实的 spec"，不诱导研发为提升覆盖率批量建锚。
5. **不引入新的运行时依赖**（CL-1 已定 lock 用 JSON，零新依赖；C3 归一化基于现有 TypeScript AST 分析器，不引入 tree-sitter 或其他 parser）。
6. **不做文档侧锚失效检测**（W3，FR-016）：不校验引用清单条目的 `docPath+line` 是否仍指向有效文档位置，只验证代码侧 symbol 指纹。
7. **不支持 member 粒度建锚**（FR-009(d)）：`Class.method` 一律拒绝，不做精确子树切片（该增强留待后续评估，若做则需要新的 span 数据源，非本期范围）。
8. **不支持 TypeScript/JavaScript 之外的语言建锚**（FR-009(a)）：Python/Go/Java 引用一律 `unsupported-language`，多语言 symbol 级指纹留待后续评估。

---

## 复用资产清单（延续 F189，C1 起进入生产迁移）

| 资产 | 位置 | 用途 |
|------|------|------|
| `canonicalizeSymbolId` / `resolveSymbolFuzzy` | `src/knowledge-graph/query-helpers.ts` | 引用 → canonical symbol id（F174，只读；仅 `drift link`/`--refresh` 调用，`drift check` 不调用，见 FR-004） |
| `analyzeFiles` | `src/core/ast-analyzer.ts` | AST 分析，取 `ExportSymbol.startLine/endLine`（仅 `ts-js-adapter` 路径产出该字段，决定 FR-009(a) 首发语言范围） |
| `relativizeSymbolId` | `src/knowledge-graph/relativize.ts` | 跨 worktree id 相对化口径（F193） |
| F189 prototype 三模块 | `specs/189-*/prototype/src/{point-anchor,fingerprint,resolve}.ts` | C1 迁移蓝本；C2 需重构为"check 精确匹配、不重新 fuzzy 解析"（FR-004），指纹层在 C3 升级为 canonical AST fingerprint |
| `validateRepository` / `aggregateValidation` | `scripts/lib/repo-maintenance-core.mjs` | C2 接入第 13 检查族的既有契约（F217 已示范三段式模式，注意本 Feature 需要新增 `strict` 透传，F217 未做此透传，不可盲目照抄参数签名） |
| `validateGraphQuality` | `scripts/lib/graph-quality-core.mjs` | 第 12 检查族参照实现，C2 抄其模式（结构，非 strict 透传） |
