# Tasks: Feature 174 — Symbol ID Fuzzy Match

**Input**: `specs/174-symbol-id-fuzzy-match/`
**Prerequisites**: spec.md (FR-001~013, SC-001~006, US1~US4) + plan.md (架构伪代码、Breaking Change 6 步迁移、TDD R-001~R-018 + C-110/C-209 + E-US1~US4、A/B/C 决策)

**M7 TDD 硬约束**：所有任务严格按 RED → GREEN → REFACTOR 三 commit 阶段推进，每阶段独立提交，提交前必须执行 codex 对抗审查（CLAUDE.local.md 约定）。

**命名决策**：E2E 测试文件统一使用 `tests/e2e/feature-174-symbol-fuzzy-match.e2e.test.ts`（与仓库其他 `feature-NNN` 前缀 e2e 文件命名约定一致），不使用 plan.md 里提及的 `symbol-fuzzy-match.e2e.test.ts`（该名称无 feature 前缀，与 M7 命名规范不符）。

---

## Phase 1: RED — 测试骨架构建（先写测试，全部 FAIL）

**目标**：先于任何实现代码写出所有单元测试和 E2E 测试骨架，确认全部失败后提交。这是 M7 TDD 规程的硬性前提。

**commit**：`test(174): E2E test scaffolding — RED phase`

**Checkpoint 验收**：运行 `npx vitest run` 后，新增的 R-001~R-018、C-110、C-209、E-US1~US4 测试以及更新后的 C-102/C-206 全部在**断言处** FAIL（不是收集/编译失败）；现有其他测试零失败（口径为零失败，不硬编码总数）；`npm run build` 通过（stub export 保证类型可编译）。

> ⚠️ **CRITICAL（codex tasks-review）：RED 阶段编译陷阱**。若直接 import 尚未 export 的 `resolveSymbolFuzzy`，vitest 会**无法收集整个测试文件**（连同 `query-helpers.test.ts` 里现有的 findFuzzyMatches 测试一起拖垮），`tsc` 也会报错。因此 RED 阶段必须先加 **stub export**（见 T002a），让文件可编译、测试在断言处真红，而非收集失败。

### RED 阶段任务

- [ ] T001 [US1] 新建 E2E 测试文件 `tests/e2e/feature-174-symbol-fuzzy-match.e2e.test.ts`：在文件顶部构造 inline micrograd graph fixture（含 `MICROGRAD_NODES` 13 个节点，覆盖 cohort C 9 个 symbol + 4 变体场景 + 同名多 module relu 节点）；按 US1~US4 组织 describe block（E-US1-1 ~ E-US4-2 共 11 个测试用例）；所有测试调用 `resolveSymbolFuzzy` / `handleContext` / `handleImpact` 并写出期望断言，此阶段期望全部 FAIL。注意文件名含 `feature-174` 前缀与 `.e2e.test.ts` 后缀，需符合 `vitest.config.ts:106` include 规则。**风险标注**：E-US2-4（15 次混合变体统计）须在 fixture 中覆盖完整的 4 类变体；iii 类绝对路径变体必须在 fixture 中透传 `opts.projectRoot='/tmp/fuzzy-fixture'` 以触发 exact 层。

- [ ] T002a [US1] **（RED 编译陷阱修复，CRITICAL）** 在 `src/knowledge-graph/query-helpers.ts` 添加 `resolveSymbolFuzzy` 的 **stub export** + 4 个类型定义（`MatchKind`/`SymbolCandidate`/`FuzzyResolveResult`/`FuzzyResolveOptions`）：stub 函数签名完整、函数体返回 `{ candidates: [], autoResolved: false }`（不实现任何层逻辑）。目的：让 `query-helpers.test.ts` 能编译并被 vitest 收集，使 R-001~R-018 在**断言处**真红，而非整文件收集失败。此 stub 在 GREEN 阶段（T005~T011）被真实实现替换。验收：`npm run build` 通过；`query-helpers.test.ts` 可被收集。

- [ ] T002 [US1] 依赖 T002a。在已存在的 `tests/unit/knowledge-graph/query-helpers.test.ts` 末尾新增 `describe('resolveSymbolFuzzy', ...)` 分层 RED 测试块：按 R-001~R-018 共 18 个用例写出测试（含 C-1/C-2/C-3 回归用例 R-016~R-018），每个用例调用 stub `resolveSymbolFuzzy` 并写出真实断言；此阶段全部在断言处 FAIL（stub 返回空，断言不满足）。**风险标注**：R-016（C-3）测试 `limit=1` + 2 候选时 `autoResolved=false`，须在 fixture 中构造恰好 2 个 path-suffix 候选节点；R-017（C-2）须构造裸 token 场景确认不走 path-suffix；R-018（C-1）须构造 `egnine.py::Value` → `micrograd/engine.py::Value` 的 typo fixture 并断言命中 levenshtein（confidence ∈ [0.5, 0.75]）。

- [ ] T003 [US1] 在已存在的 `tests/unit/mcp/agent-context-tools.test.ts`：
  - 新增 C-110 测试 `handleImpact` `autoResolved=true` 路径（响应含 `resolvedFrom/resolvedTo/resolvedConfidence`，`warnings` 含 `'fuzzy-resolved'`）；新增 C-209 测试 `handleContext` 同等路径；两个用例在 RED 阶段期望 FAIL（handler 接线未实现）。
  - ⚠️ **W-1（假绿修复）**：直接在 RED 阶段把 C-102(:161) / C-206(:333) 的旧 `Array.isArray(fuzzyMatches)` 弱断言**替换为结构完整性断言**（每项含 `id:string`/`confidence:number`/`matchKind:MatchKind`，`length<=3`）。理由：`Array.isArray` 对对象数组同样为 true，若留到 GREEN 才改，breaking change 永远不会进入 RED（假绿窗口）。结构断言在 RED 阶段会真红（handler 仍返回 `string[]`），GREEN 实现后转绿——这才是 breaking change 的 test-driven 闭环。

- [ ] T004 RED 阶段 codex 对抗审查：在提交 RED phase 前，调用 codex 子代理对 T002a + T001~T003 新增测试/stub 进行对抗性审查，重点验证：(a) stub export 是否让 `query-helpers.test.ts` 可编译收集（无收集失败）；(b) E2E fixture 节点 id 是否覆盖全部 15 次变体 + cohort C 9 个 symbol；(c) R-016/C-3 用例是否正确构造 2 候选 + limit=1 场景；(d) C-102/C-206 结构断言在 RED 阶段是否真红、C-110/C-209 mock 路径是否与 plan 接线对齐。审查通过后执行 `npx vitest run`（新测试 + C-102/C-206 在断言处 FAIL，其他零失败）+ `npm run build`（stub 保证通过），再提交。

---

## Phase 2: GREEN — 核心实现（使所有 RED 测试转绿）

**目标**：按 plan.md 的 Breaking Change 6 步迁移顺序（步骤 1~4），依次实现类型定义 → 纯函数 → handler 接线 → 断言同步，使 RED 阶段写的所有测试转为 PASS。

**commit**：`feat(174): implement symbol fuzzy match — GREEN phase`

**Checkpoint 验收**：`npx vitest run` **零失败**（新增 R-001~R-018 + C-110/C-209 + E-US1~US4 全绿，C-102/C-206 结构断言转绿，其余测试不回归）；`npm run build` 类型检查零错误。

### 步骤 1 — 类型定义（先于纯函数，防止中间态类型不一致）

- [ ] T005 在 `src/knowledge-graph/query-helpers.ts`：4 个类型定义已在 RED 的 T002a 添加（`MatchKind`/`SymbolCandidate`/`FuzzyResolveResult`/`FuzzyResolveOptions`），本步确认其字段正确无需重复添加；从 `src/panoramic/pipelines/adr-evidence-verifier.ts` 提取 Levenshtein DP 滚动数组实现为内部 helper 函数 `levenshtein(a: string, b: string): number`（不 export，仅供本文件使用）。此步骤完成后运行 `npm run build` 确认零类型错误，再进入步骤 2。

### 步骤 2 — 纯函数实现（所有内部 helper + resolveSymbolFuzzy 主函数）

- [ ] T006 在 `src/knowledge-graph/query-helpers.ts` 实现内部 helper `symbolSeg(nodeId: string): string`（取 `::` 之后的 symbol 段，无 `::` 则返回整个 nodeId）和 `nodeMatchReps(nodeId: string): string[]`（生成 typo 比对用的多种表示集合：完整 id / symbolSeg / `basename(file)::symbol` / basename(module)，即 C-1 修复的关键）。注意：`moduleFileFromId` 已是现有 export，可直接复用。**风险标注 C-1**：`nodeMatchReps` 必须包含 `basename(file)::symbol` 表示（去掉 package 前缀），否则 typo 变体的 Levenshtein 距离会因 `micrograd/` 前缀而超阈值，导致 SC-003 只能到 11/15。

- [ ] T007 在 `src/knowledge-graph/query-helpers.ts` 实现内部函数 `layerPathSuffix(graphData, query, limit): SymbolCandidate[]`：含 `::` guard（**风险标注 C-2**：bare 单 token 如 `Value` 不含 `::` 或 `/` 时必须提前返回空数组，防止误匹配文件节点并以 0.9 抢先 autoResolve）；confidence 精确锁定为常量 0.9（不能写 0.89 或近似值，FR-003 边界规则：0.9 >= 0.9 触发 autoResolve）；大小写不敏感匹配 `lowerId.endsWith('/' + lowerQuery)`。

- [ ] T008 在 `src/knowledge-graph/query-helpers.ts` 实现内部函数 `layerPartialName(graphData, query, limit): SymbolCandidate[]`：使用 `symbolSeg` helper；实现 `isQualified(query)` 判断（`query.includes('.')`）；按 Open Question A 公式打分（唯一 qualified→0.95，唯一 bare→0.90，多义 rank→`Math.max(0.70, 0.85 - rank * (0.15 / (matchCount - 1)))`）；匹配条件为 `seg === lowerQuery || seg.endsWith('.' + lowerQuery)`。

- [ ] T009 在 `src/knowledge-graph/query-helpers.ts` 实现内部函数 `layerLevenshtein(graphData, query, limit): SymbolCandidate[]`：使用 `nodeMatchReps` 取多种表示，对每种表示计算 `threshold = Math.ceil(Math.max(query.length, rep.length) * 0.35)`；confidence 映射公式 `0.75 - (distance / threshold) * 0.25`，clamp 到 `[0.50, 0.75]`；取所有表示中相对距离最小者。**风险标注 C-1**：必须用 `basename::symbol` 表示参与比较，不能只对完整 node.id 算距离。

- [ ] T010 在 `src/knowledge-graph/query-helpers.ts` 实现内部函数 `deduplicateCandidates(raw: SymbolCandidate[]): SymbolCandidate[]`（同 id 保留最高 confidence）和 `buildResult(raw, limit, threshold): FuzzyResolveResult`（去重 → 降序 → 判定 autoResolved）。**风险标注 C-3**：`autoResolved` 必须用去重后、slice 之前的 `deduped.length === 1` 判唯一，绝不能用 `deduped.slice(0, limit).length === 1`——否则 `limit=1` 传入时会把多候选误判为唯一候选，导致误 autoResolve。

- [ ] T011 在 `src/knowledge-graph/query-helpers.ts` 实现并 export 主函数 `resolveSymbolFuzzy(graphData, query, opts)`：前置 guard（空/纯空白/控制字符 `CONTROL_CHAR_RE` 直接返回空）；threshold floor `Math.max(0.9, opts.autoResolveThreshold ?? 0.9)`（FR-012 约束，不可被调低绕过 FR-003）；四层按序调用命中即停；`query.length > 512` 跳过层 d（FR-010）；exact 层直接用现有 `canonicalizeSymbolId`；`findFuzzyMatches` 旧函数本步骤暂时保留（handler 仍在引用，REFACTOR 步骤删除）。确保函数签名 `export function resolveSymbolFuzzy(graphData: Readonly<GraphJSON>, query: string, opts: FuzzyResolveOptions = {}): FuzzyResolveResult`。

### 步骤 3 — handler 接线（agent-context-tools.ts）

- [ ] T012 在 `src/mcp/agent-context-tools.ts` 更新 import：新增从 `query-helpers` 导入 `resolveSymbolFuzzy`、`SymbolCandidate`、`FuzzyResolveResult`；改造 `handleImpact` 的 not-found 分支：将旧 `findFuzzyMatches(..., 5)` 调用替换为 `resolveSymbolFuzzy(graphData, query, { projectRoot: args.projectRoot ?? process.cwd() })`；实现双分支：`autoResolved: true` 时用 `resolvedTo` 继续查询并在响应追加 `resolvedFrom`/`resolvedTo`/`resolvedConfidence`，向 `warnings` 数组追加 `'fuzzy-resolved'`；`autoResolved: false` 时构造结构化错误响应，`fuzzyMatches` 取 `candidates.slice(0, 3)`（FR-006 top-3 clamp）。

- [ ] T013 在 `src/mcp/agent-context-tools.ts` 改造 `handleContext` 的 not-found 分支（与 T012 类似接线改造）：注意 plan.md 指出 context handler 当前无 `warnings` 字段，需在 `buildSuccessResponse` 前新增 `const warnings: string[] = []` 并在 autoResolved 路径追加 `'fuzzy-resolved'`，写入 `data['warnings']`（若为空则不写入，与 impact 一致）；`autoResolved: false` 路径同样 `fuzzyMatches.slice(0, 3)` 结构化输出。确认 `detect_changes` handler 不受任何改动影响（FR-009）。

### 步骤 4 — 验证断言转绿（C-102/C-206 已在 RED-T003 更新为结构断言）

- [ ] T014 确认 T003 在 RED 阶段已更新的 C-102/C-206 结构完整性断言（每项含 `id:string`/`confidence:number`/`matchKind:MatchKind`，`length<=3`）在 GREEN 实现后由红转绿；若 handler 输出形态与断言有偏差，以断言为准修正 handler（不回退断言）。本步骤不再"首次替换"断言（已在 RED 完成 W-1 假绿修复）。

- [ ] T015 GREEN 阶段 codex 对抗审查：在提交 GREEN phase 前，调用 codex 子代理对 T005~T014 新增/修改代码执行对抗性审查，重点关注：(a) C-3 风险——`buildResult` 中 `deduped.length` 是否在 `slice` 之前判断；(b) C-2 风险——`layerPathSuffix` 是否对裸 token 提前返回空；(c) C-1 风险——`nodeMatchReps` 是否包含 `basename::symbol` 表示；(d) handler 接线的 `autoResolveThreshold` floor 是否 >= 0.9；(e) `detect_changes` handler 是否零改动。审查通过后执行 `npx vitest run` + `npm run build` 确认全绿零错误，再提交。

---

## Phase 3: REFACTOR — 代码提炼 + 旧接口清理（所有 GREEN 测试保持通过）

**目标**：按 plan.md 步骤 5~6，提取共用逻辑 helper，删除旧 `findFuzzyMatches` export，执行全仓 grep 审计（FR-007 下游清单）。所有 GREEN 测试必须在 REFACTOR 完成后依然全部通过。

**commit**：`refactor(174): extract scoreCandidate + 统一 path 归一化 helper`

**Checkpoint 验收**：`npx vitest run` **零失败**（口径为零失败，删除旧 findFuzzyMatches suite 后总数会变，不硬编码计数）；`npm run build` 零错误；`npm run repo:check` 零警告；全仓 grep 确认无残留 `findFuzzyMatches` 引用、无旧 `fuzzyMatches: string[]` 断言。

### 步骤 5 — 旧接口删除（W-1 收口）

- [ ] T016 在 `tests/unit/knowledge-graph/query-helpers.test.ts` 删除第 97~121 行的旧 `findFuzzyMatches` suite 以及第 21 行对应的 import 语句（**必须先删测试，再删实现**，否则 vitest 编译失败——W-1 警告）。确认删除后 `npx vitest run` 仍然全部通过，无新增失败。

- [ ] T017 在 `src/knowledge-graph/query-helpers.ts` 删除旧 `findFuzzyMatches` export 函数定义；在 `src/mcp/agent-context-tools.ts` 删除对 `findFuzzyMatches` 的 import 语句（T012/T013 已替换为 `resolveSymbolFuzzy`，旧 import 此时应已是死代码）。执行 `npm run build` 确认零错误。

### 步骤 5b — 提取共用辅助函数（REFACTOR）

- [ ] T018 在 `src/knowledge-graph/query-helpers.ts` 提取 `normalizeForMatch(s: string): string`（将 `s.toLowerCase()` 大小写归一化逻辑统一，替换 `layerPathSuffix` 和 `layerPartialName` 中的重复 `.toLowerCase()` 调用）。确认提取后 R-001~R-018 单元测试保持 PASS。**（非 [P]：与 T019 同改 query-helpers.ts，须串行编辑避免写冲突，W-2/W-3 收口）**

- [ ] T019 依赖 T018（同文件串行）。在 `src/knowledge-graph/query-helpers.ts` 检查 `layerPathSuffix` / `layerPartialName` / `layerLevenshtein` 三层是否存在可抽取的 `scoreCandidate` 共用逻辑（plan 中提及若存在明显重复则提取）；若存在提取为内部 `scoreCandidate` 辅助函数，若无明显重复则记录为"已审查，无需提取"并跳过。

### 步骤 6 — 全仓 grep 审计（FR-007 下游清单，W-4 收口）

- [ ] T020 执行 `grep -rn "findFuzzyMatches"` 全仓扫描，确认旧函数已全量替换，零残留引用；若有遗漏则补充替换并重测。

- [ ] T021 执行 `grep -rn "fuzzyMatches"` 全仓扫描，审计所有消费 `fuzzyMatches` 的消费方（FR-007 下游清单完整覆盖，W-4 收口）：(a) 测试 / eval / prompt 文件；(b) **MCP error response schema / TypeScript 类型定义**（若存在显式描述 `fuzzyMatches` 形态的 schema 或 interface，必须同步从 `string[]` 改为 `Array<SymbolCandidate>`）；(c) Feature 155 相关文档中 `fuzzyMatches: string[]` 或 `limit=5` 描述。若有遗漏则更新对应文件（spec/文档类改动可目视审查替代 codex review，schema/类型类改动须随 GREEN 一并测试）。

- [ ] T022 REFACTOR 阶段 codex 对抗审查：在提交 REFACTOR phase 前，调用 codex 子代理对 T016~T021 改动执行对抗性审查，重点关注：(a) T016 删除顺序是否正确（先删测试再删实现）；(b) `normalizeForMatch` 提取是否引入行为差异；(c) grep 审计是否有遗漏；(d) 全量测试是否保持通过。审查通过后执行完整验收门禁（T023），再提交。

---

## Phase 4: 验收门禁（Acceptance Gates）

**目标**：逐条核验 SC-001~006 全部通过，确认零回归、零类型错误、零 repo 警告。

- [ ] T023 **SC-005 全量回归 + 覆盖率**：
  - 执行 `npx vitest run`，口径为**零失败**（W-6：不硬编码"3859"——删除旧 findFuzzyMatches suite 与新增用例都会改变总数，固定计数会脆弱误判；只断零失败 + 新增 R-001~R-018/C-110/C-209/E-US1~US4 全绿）；
  - ⚠️ **W-5（覆盖率验收补全）**：执行 `npx vitest run --coverage`（或对应 coverage 脚本），确认 `src/knowledge-graph/query-helpers.ts` 中 `resolveSymbolFuzzy` 及其内部 helper 的**分支覆盖率 ≥ 95%**（SC-005 显式要求）；
  - 执行 `npm run build` 确认类型检查零错误；执行 `npm run repo:check` 确认零警告。

- [ ] T024 **SC-001 四层 confidence 逐层验证**：在 `npx vitest run --reporter=verbose` 输出中逐一确认 R-001~R-008 各层断言：(a) exact 恒 1.0；(b) path-suffix 精确常量 0.9；(c) partial-name qualified 唯一 0.95、bare 唯一 0.90、多义 0.7~0.85；(d) levenshtein 0.5~0.75。均已在 GREEN 阶段通过，此步骤为最终核验留档。

- [ ] T025 **SC-002 cohort C 零 symbol-not-found**：确认 E-US3-1（cohort C 9 个 symbol via `handleContext`）零 not-found 错误，E-US3-2（原失败样本）`warnings` 含 `'fuzzy-resolved'`，`resolvedFrom`/`resolvedTo` 字段存在。

- [ ] T026 **SC-003 四变体 ≥12/15 top-1 命中**：确认 E-US2-4（15 次混合变体）`candidates[0].id === 期望 canonical id` 的命中次数 >= 12；C-1 修复后预期 15/15，留足余量。

- [ ] T027 **SC-004 误 autoResolve 为零**：确认 E-US1-3（`relu` 多义 2 节点）`autoResolved: false`；确认 R-016（C-3 `limit=1` + 2 候选）`autoResolved: false`；确认 handler 层 `autoResolveThreshold` floor 不可被调低（R-015 通过）。

- [ ] T028 **SC-006 旧断言更新验证**：确认 `tests/unit/mcp/agent-context-tools.test.ts` C-102(:161) 与 C-206(:333) 处已替换为 `Array<{id: string, confidence: number, matchKind: MatchKind}>` 结构完整性断言，无旧 `Array.isArray` 弱断言残留。

---

## FR 覆盖映射表

| 功能需求 | 对应 Task ID |
|---------|-------------|
| FR-001 `resolveSymbolFuzzy` 纯函数签名 + SymbolCandidate 类型 | T005、T011 |
| FR-002 四层顺序执行命中即停（exact / path-suffix / partial-name / levenshtein） | T007、T008、T009、T011 |
| FR-003 autoResolved 阈值规则（唯一 + >= 0.9）+ path-suffix 精确 0.9 | T010、T011 |
| FR-004 handler 调用 resolveSymbolFuzzy 替代旧 findFuzzyMatches | T012、T013 |
| FR-005 autoResolved=true 时附加 resolvedFrom/resolvedTo/resolvedConfidence + warnings 追加 | T012、T013 |
| FR-006 autoResolved=false 时 fuzzyMatches 为 Array<SymbolCandidate> top-3 | T012、T013、T014 |
| FR-007 breaking change 下游审计清单（grep 全仓） | T014、T020、T021 |
| FR-008 graphData 只读无副作用 | T005~T011（所有层函数均只读设计），R-014 |
| FR-009 detect_changes 不接入 fuzzy 逻辑 | T013（确认零改动），验收 T023 |
| FR-010 query > 512 跳过层 d；空/控制字符提前返回 | T011，R-009~R-011 |
| FR-011 Levenshtein DP 实现（编辑距离打分） | T005（提取 DP helper）、T009 |
| FR-012 projectRoot 透传 + limit/autoResolveThreshold 可选；handler top-3 与纯函数 limit 解耦 | T011、T012、T013 |
| FR-013 Non-goal — 不引入双字段并存兼容模式 | 所有 GREEN 任务无兼容分支 |

---

## 依赖关系与并行说明

### Phase 依赖

- **Phase 1（RED）**：无前置依赖，可立即开始
- **Phase 2（GREEN）**：依赖 Phase 1 全部完成（测试必须先 FAIL，才能开始实现）
- **Phase 3（REFACTOR）**：依赖 Phase 2 全部完成（GREEN 全绿后才能做清理）
- **Phase 4（验收）**：依赖 Phase 3 全部完成

### Phase 内任务顺序

**RED 阶段**（T002a, T001~T004）：
- T002a（stub export + 类型）必须最先（让测试可编译收集，CRITICAL 修复）
- T001（e2e）/ T003（agent-context-tools.test）可并行（不同文件）；T002（query-helpers.test）依赖 T002a
- T004（codex 审查）依赖 T002a+T001+T002+T003 全部完成

**GREEN 阶段**（T005~T015）：
- T005（提取 levenshtein helper；类型已在 T002a 落地）最先
- T006（symbolSeg / nodeMatchReps）依赖 T005
- T007 / T008 / T009 / T010 逻辑互不依赖，但**同改 query-helpers.ts 单文件，须串行编辑**（不标 [P]）
- T011（resolveSymbolFuzzy 主函数，替换 stub）依赖 T006~T010 全部完成
- T012 / T013 依赖 T011（不同 handler，不同文件区段；若同一文件则串行）
- T014（验证 C-102/C-206 转绿）依赖 T012+T013
- T015（codex 审查）依赖 T005~T014 全部完成

**REFACTOR 阶段**（T016~T022）：
- T016 必须先于 T017（先删测试，再删实现——W-1 约束）
- T018 → T019 依赖 T017，**同改 query-helpers.ts 须串行**（非 [P]）
- T020 / T021 可与 T018/T019 并行（grep 审计与代码提炼无依赖）
- T022（codex 审查）依赖 T016~T021 全部完成

**验收阶段**（T023~T028）：
- T024~T028 依赖 T023（全量测试通过后才逐项核验）
- T024~T028 可并行（各核验不同 SC）

### 关键并行机会

1. **RED 阶段**：T001 + T002 + T003 可同时开工（三个不同文件，零依赖）
2. **GREEN 中层实现**：T007 / T008 / T009 / T010 逻辑互不依赖，但**同改 `query-helpers.ts` 单文件，须串行编辑**（不标 [P]，避免写冲突，W-2 收口）；若由单一 agent 顺序实现则无影响
3. **GREEN handler 接线**：T012 + T013 可并行（handleImpact 与 handleContext 各自独立改造）
4. **REFACTOR 审计可并行**：T020 + T021（grep 审计，只读不改 query-helpers.ts）可并行；但 T018 → T019 同改 query-helpers.ts 须串行（W-3 收口）
5. **验收核验**：T024 + T025 + T026 + T027 + T028 可并行（各 SC 独立核验）

---

## 实施策略

### 推荐执行顺序（单人 MVP）

1. 完成 Phase 1（RED）— 约 2h，3 文件并行
2. commit RED，等 codex 审查通过
3. 完成 Phase 2 步骤 1~2（T005~T011）— 约 3h，核心纯函数
4. 完成 Phase 2 步骤 3~4（T012~T014）— 约 1h，handler 接线
5. commit GREEN，等 codex 审查通过
6. 完成 Phase 3（T016~T022）— 约 1h，清理 + 审计
7. commit REFACTOR，等 codex 审查通过
8. 完成 Phase 4 验收门禁（T023~T028）

**MVP 核心**：US1（简短 symbol 自动 resolve）是最高价值交付，GREEN 阶段完成后即可独立验证 SC-002（cohort C 零 symbol-not-found）。

---

## 备注

- `[P]` 标记仅用于**不同文件**的任务并行（同一文件即使不同函数也须串行编辑，避免补丁写冲突——codex tasks-review W-2/W-3）；本 feature 核心实现集中在 `query-helpers.ts` 单文件，故 GREEN/REFACTOR 主体串行，仅只读 grep 审计（T020/T021）可并行
- 每个 commit 前必须执行 codex 对抗审查（T004 / T015 / T022），这是 CLAUDE.local.md 的硬约束
- Breaking change `fuzzyMatches: string[]` → `Array<SymbolCandidate>` 的安全性由步骤顺序保证：类型先于实现，实现先于 handler，handler 先于断言同步，断言同步后才允许删除旧接口
- codex 已识别三个主要风险需在实现时持续关注：**C-1**（Levenshtein 须对 basename::symbol 多表示计算，非完整 node.id）、**C-2**（path-suffix 层必须 guard 裸 token，防止误 autoResolve）、**C-3**（autoResolved 判唯一必须用 deduped.length 而非 slice 后长度）
