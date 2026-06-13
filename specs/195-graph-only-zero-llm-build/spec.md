# Feature 195：全仓纯 AST 的 graph-only 零 LLM 构建路径

- **Feature ID**: 195-graph-only-zero-llm-build
- **模式**: spec-driver-story（快速需求，跳过调研）
- **里程碑**: M8 轨道 A（B2 用户 2026-06-13 裁决立项）
- **状态**: Specify
- **作者**: Spec Driver Story 编排器

## 背景与问题陈述

F193 perf-profiling 坐实：`spectra batch --mode code-only` 名义「仅跳 enrichment」，实际仍逐模块调 sonnet spec-gen LLM（27min 墙钟主要是 LLM I/O 等待）；`spectra prepare` 只产单 target skeleton、不建全仓 graph。结果：要拿到可用 knowledge graph（MCP `impact`/`context`/`graph_*` 的前提）必须烧 ~27min + token 跑一次 batch。milestone-next 体检多轮撞上此坑（worktree `.spectra/graph.json` 未建 → graph MCP 不可用）。

仓库缺一条**真正零 LLM 的全仓建图路径**。F183 已诚实校正 code-only 帮助文本承认这一缺口（`src/cli/index.ts:99`、`src/cli/commands/batch.ts:74`）。

注：现有 `spectra graph` 子命令（`src/cli/commands/graph.ts`）虽零 LLM，但它从**磁盘已生成的 spec 文件**读取 doc-graph / architecture-ir / cross-reference 来建图——本质是「spec 关系图」，依赖 spec-gen 已经跑过；它**不注入 unifiedGraph（call graph）**，因此不能作为「从零、纯 AST」的建图入口。本 Feature 填的正是这条从零路径。

## 目标

新增「只建图、零 LLM」构建路径，使首次建图 / 重建 `graph.json` 完全不依赖 spec-gen LLM，墙钟从 ~27min 降到 <2min 量级（随文件数线性），产物可被现有 MCP `graph_node` / `graph_query` / `impact` 工具与加载期 stale 检测正常消费（不对 `context` 等依赖 spec 文本的工具做完整承诺——见 EC-004 子集定位）。

## 用户故事

### US-001（主）：开发者在新 worktree 零成本建图
作为在新 worktree 做体检 / impact 分析的开发者，我希望用一条命令在 <2min 内、不烧任何 LLM token 就生成可用的 `graph.json`，这样 MCP `impact`/`graph_node` 立即可用，不必先跑 27min 的 batch。

**验收**：在本仓库（~250 .ts）执行 graph-only 入口，**零 spec-gen LLM 调用**产出合法 `graph.json`，墙钟显著低于 27min（目标 <2min 量级），随后 `graph_node` / `impact` 能正常消费该图。

### US-002：CI / 无认证环境建图
作为在 CI 或未配置 LLM 认证环境下工作的用户，我希望 graph-only 路径**不要求认证**（与 `prepare` 一致），因为它纯 AST、不调任何 LLM。

**验收**：graph-only 入口在无 `ANTHROPIC_API_KEY` / 无 Claude/Codex 登录态下仍能成功产出 `graph.json`，不因 auth gate 失败退出。

### US-003：现有三 mode 行为零回归
作为依赖 `full`/`reading`/`code-only` 现有产物的用户，我希望新增 graph-only 路径完全不改变这三个 mode 的行为、产物与墙钟特征。

**验收**：三现有 mode 的单测与产物结构不变；graph-only 分支**跳过 spec-gen 模块循环（processOneModule）及其下游 doc/IR/crossref 三路**，但**显式复用** AST 采集 → unifiedGraph → buildKnowledgeGraph → writeKnowledgeGraph 这条既有 AST/写盘出口（FR-003 复用与本条不矛盾：复用的是无 LLM 的 AST 与写盘段，跳过的是 LLM spec-gen 段）。

## 功能需求（Functional Requirements）

- **FR-001**：系统必须提供一个零 LLM 的 graph-only 构建入口（CLI 形态在 plan 阶段于 `--mode graph-only` 与 `graph build` 子命令间二选一并说明），执行：纯 tree-sitter AST 采集（Python + TS/JS skeleton 合并）→ unifiedGraph（call graph + depends-on）+ Python 符号节点（`extractSymbolNodes`，纯 AST，经 `extractionResults` 第四路）→ `buildKnowledgeGraph` → 写 `graph.json`，全程**不调用任何 LLM**：不调 `generateSpec`（spec-gen）、不调 enrichment、不调 hyperedge extraction、不发起任何 LLM 网络请求。
- **FR-002**：graph 构建必须从 batch-orchestrator 的 spec-gen 耦合中拆出，成为可独立调用的函数（输入 `projectRoot` / `outputDir` / 可选 `languages`，仅依赖 AST，不依赖任何 spec-gen 产物）；该函数的**文件发现与 ignore 规则须复用 batch 现有的 `scanFiles` / `groupFilesByLanguage` 口径**（不另造扫描逻辑，保证与 batch 的 scope 一致）。
- **FR-003**：graph-only 路径必须复用 F183 的 `writeKnowledgeGraph` 写盘出口（其内部已内聚 portable 守卫 → `normalizeGraphForWrite` → 原子写盘）；**不得**重复实现写盘 / 归一化 / 守卫逻辑。
- **FR-004**：graph-only 路径产出的 `graph.json` 必须使用与 batch 路径**完全相同的 GraphJSON schema（schema 不漂移）**，能被现有 MCP `graph_node` / `impact` / `graph_query` 工具与加载期 stale 检测（`assertGraphFormatNotStale`）正常消费。
- **FR-005**：graph-only 路径必须不要求认证（zero-LLM，行为对齐 `prepare`，不走 batch 的 `checkAuth` gate）。
- **FR-006**：帮助文本必须新增 graph-only 行，明确标注「纯 AST / 零 LLM / 耗时随文件数线性」，与 code-only 行的「非零成本」形成对照；该行须出现在 `src/cli/index.ts` 的 HELP_TEXT 中。
- **FR-007**：graph-only 产出必须通过 F193 portable 守卫（`graph.json` 中绝对路径节点数 = 0）。
- **FR-008**：graph-only 路径在 stdout / 日志中须明确标注当前为 graph-only（零 LLM）模式，避免用户误判其等同 full/code-only。

## 非功能需求 / 回归护栏（🔴 零回归）

- **NFR-001**：`full` / `reading` / `code-only` 三 mode 现有行为、产物清单、墙钟特征不变。
- **NFR-002**：F183 `normalizeGraphForWrite` 三写盘出口归一化不破坏；F193 portable 守卫（绝对路径计数 = 0）+ 跨 worktree byte 一致不回归。
- **NFR-003**：F182 增量缓存三护栏文件（delta-regenerator / regen-plan / batch-orchestrator 状态机）行为不变——graph-only 不触碰增量 checkpoint / delta 逻辑。
- **NFR-004**：不新增运行时依赖（宪法原则 VIII），不引入新 LLM 路径。test-only 依赖同样不新增（现有 vitest 工具链足够）。

## 边界情况（Edge Cases）

- **EC-001（空 / 无可解析源码）**：项目无任何可解析源文件时，graph-only 须产出一个 schema 合法的空图（nodes/links 为空数组）而非崩溃，并在日志提示「未发现可建图的源码」。
- **EC-002（仅 Python / 仅 TS / 混合）**：仓库可能纯 Python、纯 TS/JS 或混合。graph-only 须合并 Python + TS/JS skeleton（沿用 batch L1285-1296 的合并逻辑），避免某一语言的 calls 边丢失。
- **EC-003（部分文件解析失败）**：个别文件 tree-sitter 解析失败时不得整体崩溃；沿用 batch 既有的 per-file 失败聚合 + warn 策略，产出尽力而为的图。注：graph-only 复用 `buildUnifiedGraph` / `extractSymbolNodes` 内部的 per-file 容错（best-effort），不新建错误聚合 contract；解析失败仅 warn，不影响 exit code。
- **EC-004（docGraph / architectureIR 缺席）**：graph-only 不提供 doc-graph / architecture-ir / cross-reference 三路（它们依赖 spec-gen）。`buildKnowledgeGraph` 对缺席数据源已有 graceful skip（记入 skippedSources），不报错——graph-only 产出是 batch 全量图的**子集**（仅 code-structure：unifiedGraph + Python 符号节点），这是预期而非缺陷。
- **EC-005（无认证）**：见 FR-005，无认证不阻断。
- **EC-006（输出目录已有旧 graph.json）**：graph-only 重建须原子覆盖旧文件（沿用 `writeKnowledgeGraph` 的原子写），不残留半截文件。

## 验收标准（Success Criteria）

- **SC-001（硬门禁=零 LLM）**：在本仓库执行 graph-only 入口产出合法 `graph.json`，**零 LLM 调用**（spec-gen / enrichment / hyperedge / 任何 LLM 网络请求计数 = 0）为可证伪的硬验收。墙钟 <2min 仅作为**记录性基准**（在本仓库 ~250 .ts、单机记录实测值并写入验证报告），非阻断门禁——因墙钟受机器 / 缓存影响不可严格复现。
- **SC-002**：产出通过 F193 portable 守卫（绝对路径节点数 = 0），且能被 `graph_node` / `impact` / `graph_query` 消费（节点可定位、calls/depends-on 边可遍历）。
- **SC-003**：新增单测覆盖：
  - (a) **零 LLM 断言**：spy / mock 所有 LLM 入口（`generateSpec` 及 enrichment / hyperedge 提取入口）确认调用次数 = 0；
  - (b) **结构一致性**：对同一 fixture，graph-only 产物与 batch `full` 路径产物对比，断言 **GraphJSON schema 一致** 且 graph-only 的 unifiedGraph（calls/depends-on）+ Python 符号节点子集与 full 路径对应子集一致（不要求节点全集相等——full 还含 doc/IR/crossref 三路）；
  - (c) **帮助文本**：断言所选入口的 help 文本含「graph-only」「纯 AST」「零 LLM」字样（若选子命令形态则覆盖子命令 help）；
  - (d) **无认证可跑**：断言 graph-only CLI 入口在未配置认证（无 API key / 无 CLI 登录态）时不被 `checkAuth` 阻断、成功产出图；
  - (e) **日志标注**：断言 stdout / 日志含 graph-only（零 LLM）模式标识（FR-008）。
- **SC-004**：三现有 mode（full/reading/code-only）的既有单测全部不变且通过。
- **SC-005**：TDD（测试与实现同 commit）；全量 `npx vitest run` + `npm run build` + `npm run repo:check` 零失败。

## 范围 / 不做

- **In**：拆 graph 构建独立化 + 新 CLI graph-only 入口 + 帮助文本校正 + 单测。
- **Out**：不改 spec-gen 本身逻辑；不改 full/reading/code-only 三现有 mode；不做增量 graph-only（首次 / 全量重建即可，增量保活归 F193 既有机制）；不新建可视化 / 报告产物。
- **升级条件**：若 plan/scope-eval 判定为 LARGE（影响文件 >15 或跨包），升 feature 模式。当前评估为 MEDIUM。

## 假设与依赖

- 假设 `buildUnifiedGraph` + `collectTsJsCodeSkeletons` + `collectPythonCodeSkeletons` 已稳定（Feature 151/152 落地），可在 batch 外独立调用。
- 假设 `writeKnowledgeGraph`（F183）已内聚 portable 守卫 + 归一化，graph-only 直接复用。
- 依赖 GraphJSON schema v2.0（`src/panoramic/graph/graph-types.ts`）保持稳定。

## 澄清记录（Clarify）

- **C-001（CLI 形态）**：`--mode graph-only` vs `graph build` 子命令 → 推迟到 plan 阶段裁决（FR-001 标注二选一）。倾向 `--mode graph-only`（复用 batch 的 AST 采集 + unifiedGraph 基础设施，且与已存在的 `graph` 子命令语义不冲突）。
- **C-002（产物完整性）**：graph-only 产物是 batch 全量图的子集（无 doc/IR/crossref 三路）——已在 EC-004 明确为预期行为，「结构一致性」指 schema 一致 + unifiedGraph 子集一致，非节点全集相等。
- **C-003（Codex 对抗审查 round-1 处置）**：spec 阶段 codex review 提出 2 CRITICAL（US-003/FR-003 措辞互斥、FR-001 漏列 extractionResults）+ 8 WARNING，已全部并入上文（措辞澄清、extractionResults 入管线、SC 补 auth/全 LLM 入口/fixture/日志断言、SC-001 改零 LLM 硬门禁 + <2min 记录性基准、FR-002 补文件发现复用、EC-003 错误聚合澄清）。CLI 形态裁决（W-1）留 plan 阶段执行。
