# F242 验证闭环报告（Phase 4c）

> 执行体：spec-driver:verify 子代理（sonnet）。本报告为三方结论汇总（Layer 1 对齐 + Layer 1.5 证据核查 + Layer 2 工具链）+ GATE_VERIFY 输入。

## Layer 2：原生工具链验证（真实执行，非纸面声称）

| 命令 | 退出码 | 关键输出摘要 |
|------|--------|-------------|
| `npx vitest run`（全量） | 0 | `Test Files 491 passed \| 4 skipped (495)` / `Tests 6050 passed \| 18 skipped \| 21 todo (6089)`；Duration 57.50s；0 FAIL；已知负载 flaky 名单（watch-command / community-analysis perf / cli-e2e --version / batch-orchestrator-incremental）**本轮全绿，未触发**，无需隔离重跑判定 |
| `npm run build` | 0 | `tsc` 类型检查零错误；`postbuild:stamp` 正常盖章（commit=2e3a4cdd dirty） |
| `npm run repo:check` | 0 | 全部检查项 `pass`，含 `graph-quality:duplicate-canonical-id/dangling-edge/contains-coverage/orphan-ratio/legacy-ignored-nodes/freshness` 六指标全 pass、`spec-drift:anchors-status: pass` |

**说明**：本机 shell（zsh via Homebrew profile）无 `timeout`/`gtimeout` 命令，未能按要求加 `timeout 300s` 前缀；改用后台执行 + 轮询等待收尾的方式规避无界阻塞风险，三条命令均在合理时间内（全量 vitest 57.5s wall、build < 30s、repo:check < 10s）正常退出，未触发超时场景。

## 验收断言复核（读 specs/_meta/graph.json 实测，非引用 fix-report 数字）

- 图规模：`nodes: 6095`，`links(edges): 9429`，其中 `relation === 'calls'` 的边：`2286`。与编排器独立复核参考数据（6095 节点 / 9429 边 / calls 2286）**完全一致**。
- 验收边 1：`src/kb-mcp/tools/kb-search.ts::registerKbSearchTool → src/kb-mcp/tools/kb-search.ts::executeKbSearch`（`relation: calls`, `confidence: EXTRACTED`, `confidenceScore: 0.95`）— **存在**。
- 验收边 2：`src/cli/index.ts → src/cli/commands/scaffold-kb.ts::runScaffoldKb`（`relation: calls`, `confidence: INFERRED`, `confidenceScore: 0.65`）— **存在**（source 为模块级 `src/cli/index.ts`，命中 fix-report 「模块兜底 + 绑定抽取」预期归属形态，与任务验收写法 `src/cli/index.ts::*` 语义兼容）。

## Layer 1.75/1.8 深度检查：证据链核查（tasks.md T001-T016 逐条核对）

- **Red fixture 四文件均存在且含 F242 标记用例**：`tests/unit/typescript-mapper-callsite.test.ts`（9 处 F242 标记）、`tests/unit/knowledge-graph/call-resolver.test.ts`（4 处）、`tests/unit/ast-analyzer.test.ts`（2 处）、`tests/integration/call-edge-survival.test.ts`（新建文件，2 处）。
- **micrograd pinned fixture 已重生成**：`tests/fixtures/micrograd-baseline-graph/graph.json`（Aug 3 01:42）+ `README.md`（Aug 3 01:44）含「F242 重生成」小节，记录 producer 变迁（`a542599` F214 → `1445edf` F217 → 本次 F242 工作区改动）与实证数据小节。
- **graph-builder 悬空过滤观测性已生效**：`droppedCount` 计数 + `console.warn` 日志（`src/panoramic/graph/graph-builder.ts:450-462`）；本轮全量 vitest 运行期间日志已实际触发（`tests/e2e/batch-pipeline.e2e.test.ts` 输出中可见 `[graph-builder] dropped 3 dangling edge(s) (source/target not in node set)`），证明该观测性代码路径真实可达，非死代码。
- T001-T016 勾选状态与实际产物一致；T017（Codex 对抗审查）仍为未勾选状态，与 4a 报告标注的流程性 WARNING 一致。

## 三报告合并结论

| 来源 | 结论 | 分级 |
|------|------|------|
| 4a Spec-Code 对齐审查（spec-review） | PASS，附 1 项流程性 WARNING | CRITICAL 0 / WARNING 1（T017 未执行）/ INFO 0 |
| 4b 代码质量审查（quality-review） | PASS，EXCELLENT 评级 | CRITICAL 0 / WARNING 0 / INFO 2（`isAddressable` 深层嵌套 dotted 精度退化到模块级；`await (import('x'))` 括号包裹形态未覆盖，均 fail-safe 非回归） |
| 4c 工具链 + 证据链验证（本报告） | PASS | vitest 全绿 6050/6050、build 零错误、repo:check 全 pass、验收两边实测存在、证据链完整 |

**GATE_VERIFY 输入**：三方结论均为 PASS 级别，唯一未闭合项是流程性的 **T017 Codex 对抗审查未执行**（非代码缺陷、非功能未实现）。按 CLAUDE.local.md 约定，编排器需在最终 commit 前补齐该步骤；补齐后若 Codex 发现真实 bug/设计缺陷需回到 implement 修复并重跑本验证；若仅为风格偏好，可记录于 commit message 后直接放行。

## 遗留风险转述（源自 4b quality-review 的 2 条 INFO，无需阻塞本次交付）

1. `isAddressable` 对深层嵌套 dotted `callerContext`（如 Python `Outer.Inner.method`）精度退化为模块级兜底，而非内层类；不产生假阳性（该场景本就是修复前的悬空丢弃边，现在变为存活但精度较粗），未来如需更高精度可扩展复用 `extractClassName` 的分段逻辑，非本次范围。
2. `await (import('x'))`（括号包裹的动态 import）未被绑定抽取覆盖，fail-safe 不崩溃、只是不救回该边，属未列入 plan 7 形态范围的额外边界，记录供后续 backlog 参考。

## 总体结果

**PASS（工具链维度）/ 待补 T017 后方可视为完全 READY**

- Layer 2 三条必跑命令：✅ 全通过（exit code 全 0）
- 验收断言：✅ 两条验收边均实测存在，图规模与编排器独立复核数据完全一致
- 证据链：✅ 完整（red fixture / fixture 重生成 / 观测性代码路径均可验证真实存在且被触发）
- 唯一阻断项：T017 Codex 对抗审查流程步骤未执行（GATE_VERIFY 触发原因：流程合规缺口，非代码质量问题）

---

## 附录：T017 Codex 对抗审查闭环（编排器补记，五轮审查 × 四轮修复）

上文「唯一阻断项 T017」已闭合。全程 resume 同一 Codex session（019fc3a5-df3b-74b1-97b1-2d85090be01c），交替审查/修复直至收敛：

| 轮次 | 性质 | 结论 | 处置 |
|------|------|------|------|
| R1 审查 | 全量对抗审查（含内存反例复现） | FAIL：1 CRITICAL（C1 动态绑定文件级 last-write-wins 假边）+ 7 WARNING + 5 INFO | C1/W1/W3/W6 立即修；W2/W4/W5/W7 登记 |
| F1 修复 | C1 两遍式歧义弃权 / W1 `.then` callee 同一性 / W3 namespaceAliases 短路 / W6 logger.debug | 15 新用例 red→green；全量 6065 零失败 | — |
| R2 审查 | 复审 F1 | FAIL：C1 残余 4 面 + W1 括号 callee + W3 歧义类回退测试缺口 + W6 portable-guard console | 4 项再修；C1(a) 静态+动态同 alias 同 target 登记（文件级绑定固有界） |
| F2 修复 | ambiguousAliases（binding-kind 判重）+ Stage 2/3 拦截 / 裸 dynamic 不注册 lastSeg fallback / 括号 callee 剥壳（并修正一条断言与标题自相矛盾的测试）/ portable-guard→logger.warn | 15 新用例；全量 6077 零失败；逐边 A/B 零生产边变化 | — |
| R3 审查 | 复审 F2 | 5 项 closed；2 CRITICAL（Stage 1 绕行 / null-target 类回退）+ 2 WARNING（文件级误伤、receiver 括号） | 2C+1W 修；文件级误伤登记（precision-first 已接受代价） |
| F3 修复 | 抑制集更名 suppressedDynamicAliases 且语义扩为「存在 dynamic 绑定但未产生可信 aliasToTarget 条目」（null-target 入集）+ Stage 1 门禁 / receiver 括号剥壳 | 13 新用例；全量 6090 零失败；抑制集实仓探针命中 4 处外部包绑定、零误伤 | — |
| R4 审查 | 复审 F3 | 3 项全 closed、无新增 critical；2 新 WARNING（await 上方括号 / callback 实参括号） | 2W 修 |
| F4 修复 | extractDynamicImportBinding 括号归一化补为函数内完备不变量（源码净改 2 行；9 接缝盘点，4 处语法不可能经 ts-morph diagnostics 实测证伪；104 组合穷举 fuzz 全过） | 11 新断言；全量 **6101 零失败** | — |
| R5 审查 | 终局裁定 | **「复审通过」**：R4 两 WARNING closed、F4 零新缺陷、登记边界外零新发现 | 闭环收敛 |

### 最终登记 follow-up 清单（全部已在代码注释或本制品落账）

1. **scope-aware binding model 家族**（独立立项）：C1(a) 静态+动态同 alias 同 target 语义碰撞；文件级抑制集误伤同文件合法同名调用；W2 rename 解构 `{localName, importedName}` 模型
2. **W4** export-alias 撞名的 source 归属需声明身份而非字符串比较
3. **W5** `function_expression` 不入 SCOPE_DEFINING_TYPES（pre-F242 既有，修复会改 mapper 既有输出，独立立项）
4. **W7** tree-sitter/regex 降级路径不抽绑定字段（降级路径固有损耗，follow-up）
5. **括号 specifier**：`import(('./x.js'))` 整条 import 记录不产出（pre-F242 既有，analyzeImports isStringLiteral 检查，独立小修）

### 终态验证数据（覆盖上文 Layer 2 的 6050 口径）

- `npx vitest run`：**6101 passed / 0 failed**（491 files passed / 4 skipped）
- `npm run build` / `npm run repo:check`：exit 0
- graph-only 重建：**6095 节点 / 9431 边（calls 2287 / depends-on 2046 / contains 5098）**，3.6-3.7s
- 两条验收边在位：`registerKbSearchTool → executeKbSearch`（EXTRACTED 0.95）；`src/cli/index.ts → runScaffoldKb`（INFERRED 0.65）
- graph-quality：Overall **pass**（freshness=dirty 仅因工作区未提交，commit 后即净）
- 观测性终态：悬空丢弃计数走 logger **debug** 级（R2 审查后由 console.warn 降级，上文 Layer 1.75 所述 console.warn 已非终态）；portable-guard 走 logger warn 级

**GATE_VERIFY 终局输入：三方报告 PASS + Codex 五轮闭环「复审通过」，无未闭合 CRITICAL/WARNING（登记项均有归属）。**
