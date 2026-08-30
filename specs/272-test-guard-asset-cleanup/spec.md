# Feature Specification: 测试与守护资产清淤（Test & Guard Asset Cleanup）

**Feature Branch**: `claude/test-guard-asset-cleanup-6b29b3`
**Created**: 2026-08-31
**Status**: Draft
**Input**: 用户描述见 `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §5 P1-G（F272）；开工前事实基线见 `specs/272-test-guard-asset-cleanup/verified-facts.md`

## 背景与范围说明

本仓库积累了一批"看着有覆盖、实际零守护力"的测试与守护资产：有的从未被测试运行器纳入（`include`）过，有的因依赖资产被删而静默跳过数月，有的类型守护根本没接进 CI，有的 pinned fixture 早已落后于当前代码行为但断言仍然全绿。这些资产共同的危害是**制造虚假的安全感**：维护者和 CI 看到"测试通过"，误以为某种行为受到保护，实际上保护早已失效。

本 feature 逐项清淤七类资产，并为其中会复发的类别（零执行测试文件、类型契约、pinned graph 陈旧）装上可持续生效的守卫，而不是一次性修复后又归于沉默失效。

**[无调研基础标注不适用]**：本 feature 为 story 模式（无独立调研阶段），但有编排器亲自实跑得出的 `verified-facts.md` 作为事实基线，效力等同于调研结论，本规范据其编写。`verified-facts.md` 在 specify 阶段又经历第二轮复核，推翻了 ① 与 ⑥ 两处第一版结论，本 spec 已按复核后的结论修订。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 维护者能信任 qa 模块的测试结果，且零执行测试文件不会再悄悄潜入（Priority: P1）

作为仓库维护者，我希望 `src/panoramic/qa/__tests__/` 这份从不被 vitest 执行的陈旧测试副本被移除、其中仍有真实覆盖价值的用例被移植进正在维护的 `tests/panoramic/qa/`，并且今后任何测试文件一旦游离于 vitest 执行范围之外都会被守卫当场发现，这样我看到"测试通过"时，能确信这就是代码的真实覆盖状态，而不用担心还有类似的陈旧副本潜伏在角落。

**Why this priority**：`verified-facts.md` §① 第二轮复核证实 `src/panoramic/qa/__tests__/` 是一份**从未被 vitest 收集、建立后再未被维护**的陈旧副本——真正在跑的是同名的 `tests/panoramic/qa/`（8 文件 / 83 用例全绿）。qa 模块本身是活代码（3 处生产引用）这一点不变，但它的真实测试覆盖来自 `tests/panoramic/qa/`，不是待修复的 src 副本。全仓普查进一步证实：磁盘 `*.test.ts` 集合与 vitest 实际收集集合之间存在 9 个文件的差集，其中 8 个正是这份副本——这是一类会复发的问题（下次谁再把测试复制到 include 范围外，不会有人主动注意到），本卡因此不仅要删这一次，还要装一道能捕获"下一次"的守卫。这仍是本卡价值密度最高的一项。

**Independent Test**：
1. 确认 `src/panoramic/qa/__tests__/` 已删除；`tests/panoramic/qa/debt-context.test.ts` 新增 2 条移植用例且全部通过；`tests/panoramic/qa/index.test.ts` 中恒真的 `durationMs >= 0` 独立用例整条删除（存在性与类型已由同文件第 169 行 `expect(typeof result.durationMs).toBe('number')` 覆盖，`verified-facts.md` 变异验证证实字面"修回 `> 0`"会造确定性红，已按更正后裁决处置）。
2. 新增的"零执行测试文件"守卫能通过：断言磁盘 `*.test.ts` 集合与 vitest 实际收集集合的差集，恰好等于一份仅含 `tests/fixtures/**` 的显式白名单。
3. 变异验证：临时新建一个 `src/**/x.test.ts`（不加入任何 include），守卫当场判定失败；删除该临时文件后守卫恢复通过。

**Acceptance Scenarios**：

1. **Given** `src/panoramic/qa/__tests__/` 目录及 `tests/panoramic/qa/` 目录并存的现状，**When** 处置完成，**Then** 前者被完整删除，后者新增移植的 2 条真实独有用例并全部通过，`vitest.config.ts` 的 include 列表不新增 `src/panoramic/qa/**`。
2. **Given** `tests/panoramic/qa/index.test.ts` 中断言恒真的 `durationMs >= 0` 独立用例，**When** 处置完成，**Then** 该用例整条删除（`verified-facts.md` 变异验证证实全 mock 管线下 `Date.now() - t0` 确定性返回 0，字面"修回 `> 0`"会造确定性红用例；存在性与类型由同文件第 169 行既有断言覆盖，删除零覆盖损失）。
3. **Given** 全仓 `*.test.ts` 文件集合与 vitest 实际收集集合，**When** 运行新增的零执行测试文件守卫，**Then** 二者的差集恰好等于一份显式声明的白名单（仅含 `tests/fixtures/graph-quality-ts/greeter-service.test.ts` 这类语料文件），任何未声明的差集成员都使守卫失败。
4. **Given** 守卫已接入，**When** 有人新建一个不在任何 include 范围内的 `*.test.ts`（变异测试），**Then** 守卫必须检测到并失败，证明其具备真实防复发能力。

---

### User Story 2 - CI 能阻止类型契约被静默打破（Priority: P1）

作为仓库维护者，我希望三份类型守护资产（F220 orchestrator 导出契约、F222 llm-degraded 必填字段契约、F170c enrichment 可选字段契约）在每次 CI 运行时被自动检查，这样当有人的改动破坏了这些类型契约时，CI 会立刻拦截，而不是要等到运行时或人工发现。

**Why this priority**：`verified-facts.md` §③ 实证这三份守护资产真实存在且可运行（`npm run typecheck:tests` 本地 exit=0，耗时 2.39s，接入成本可忽略），但**完全没有被 CI 或 `repo:check` 覆盖**——根 `tsconfig.json` 的 `exclude` 明确排除了 `tests` 目录，`npm run lint` 走不到这里。这意味着这三份"契约测试"目前对任何人的改动都不构成任何阻力，是纯摆设。

**Independent Test**：故意在类型契约测试所守护的类型定义上引入一个破坏性改动（如把某个 required 字段改为 optional），跑 `npm run typecheck:tests`，必须报编译错误；同一改动跑 CI 流程，也必须失败。

**Acceptance Scenarios**：

1. **Given** `.github/workflows/ci.yml` 的既有步骤序列，**When** CI 运行一次完整流程，**Then** 新增的 typecheck:tests 步骤被执行，且失败时使整个 CI run 标红。
2. **Given** 有人修改 `f220-orchestrator-exports.typecheck.ts` 守护的导出类型使其不再满足契约（变异测试），**When** 本地跑 `npm run typecheck:tests`，**Then** 该项报编译错误。
3. **Given** 三份类型守护资产各自独立的 tsconfig，**When** CI 新步骤执行，**Then** 三份守护各自被检查到（不是只覆盖其中一份就视为完成）。

---

### User Story 3 - 维护者能看到 pinned graph 何时落后于当前 builder（Priority: P1）

作为仓库维护者，我希望四语言 lang-matrix 的 pinned graph fixture 在落后于当前图构建器行为时被显式检测出来，这样我不会误以为"测试全绿=图构建行为没变"，而是能清楚看到哪份 pinned fixture 需要重新生成。

**Why this priority**：`verified-facts.md` §④ 实证 TS/JS 的 pinned fixture（`expectedEdgeCount: 11`）已经落后于当前 builder 的重建结果（实际 14 边，多出 3 条测试文件到被测模块的 calls 边），但因为断言检查的是 pinned 文件自身而非"pinned 是否仍代表当前行为"，测试**长期显示绿色**。这正是本卡要根治的"虚假覆盖信号"的典型案例——不修就会一直骗人。

**Independent Test**：跑新增的 pinned-staleness 检查，对 TS/JS fixture 报告"陈旧"（更新前）／"一致"（更新后）；对 Java/Go fixture 报告"一致"；对 Python（micrograd）fixture 若在当前环境找不到仓外 clone 源，报告"无法在本环境验证"（显式结论，而非静默跳过）。

**Acceptance Scenarios**：

1. **Given** 当前 dist 与仓内 TS/JS pinned fixture（更新前的 11 边版本），**When** 运行 pinned-staleness 检查，**Then** 检查判定该 fixture 陈旧并明确指出差异（边数/边类型）。
2. **Given** TS/JS pinned fixture 已按当前 dist 手工重建为 14 边并同步 README 人工推导表，**When** 再次运行 pinned-staleness 检查，**Then** 判定为一致。
3. **Given** Python（micrograd）fixture 的源依赖仓库外 clone（`~/.spectra-baselines/micrograd`）且当前环境（如 CI）没有该 clone，**When** 运行 pinned-staleness 检查，**Then** 检查结果里必须包含一条对该语言"无法验证"的显式声明，且该声明在检查输出中可见（不是被吞掉的静默 skip），检查整体不得因此报错误的"一致"结论。
4. **Given** 新增的 pinned-staleness 检查已接入，**When** 有人改动 builder 使某语言的图构建行为变化而未同步更新 pinned fixture（变异测试），**Then** 检查必须能检测出该变化并报告陈旧。

---

### User Story 4 - self-dogfood 快照噪声不再干扰测试可读性（Priority: P2）

作为仓库维护者，我希望 `graph-mcp-snapshot.test.ts` 中已经静默跳过 3.7 个月的 Layer B self-dogfood 测试块和它遗留的 2 条孤儿快照得到明确处置，这样我在阅读测试套件或 snapshot 文件时，不会被"看起来存在但从不运行"的资产误导。

**Why this priority**：`verified-facts.md` §② 实证该块的两条断言在别处已有等价覆盖（Layer B MVP god_nodes 测试 + lang-matrix 四语言真实图测试 + micrograd 真实 Python 图），且重建 fixture 的成本（6.5 MB 冻结图入库）与本卡 ④ 揭示的"pinned 图会静默陈旧"的风险直接冲突，改用 live 图消费也被实证不可行（无测试消费 live 图、且 `toMatchSnapshot` 会随每次 commit churn）。价值不如 P1 三项紧迫，但清理成本低、收益明确。

**Independent Test**：确认 `graph-mcp-snapshot.test.ts` 中不再存在指向已删除 fixture 的条件跳过块，`__snapshots__` 文件中不再含孤儿快照条目，全文 grep 旧名称（`self-dogfood-graph_god_nodes`/`self-dogfood-graph_query` 等）无残留。

**Acceptance Scenarios**：

1. **Given** 现状的条件跳过块（`describeIfSelfDogfoodFixture`）及其依赖的已删除 fixture 路径，**When** 处置完成，**Then** 该块与其专属的 2 条孤儿快照条目均从代码库移除。
2. **Given** 处置完成后的代码库，**When** 对旧名称做全仓 grep（代码 + 文档），**Then** 无残留引用。
3. **Given** 处置后的测试套件，**When** 跑 `graph-mcp-snapshot.test.ts`，**Then** 全部保留用例正常通过，无新增跳过或失败。

---

### User Story 5 - fingerprint regen 工具放行时给出可诊断的差异信息（Priority: P2）

作为运行 `regen-collector-fingerprint-fixtures.ts` 的维护者，我希望脚本在"内容变化但仍放行覆写"的分支里，把已经算出的差异明细落盘或打印出来，这样我在覆写 fixture 前能看清具体变了什么，而不是只看到三个布尔量。

**Why this priority**：`verified-facts.md` §⑤ 实证差异数据（`differences` 数组）在拒绝分支已被正确使用，唯独放行分支把已经计算好的信息直接丢弃，属于一处局部缺陷，修复成本低、风险低。

**Independent Test**：构造一个"内容有差异但满足放行条件"的场景跑该脚本，确认输出（终端打印或落盘文件）中包含具体的差异条目，而不只是布尔值摘要。

**Acceptance Scenarios**：

1. **Given** `contentMismatch=true` 且满足放行条件的场景，**When** 脚本执行放行分支，**Then** 输出中包含 `aTrack.differences` 与 `bTrack.differences` 的具体内容（与拒绝分支的呈现方式一致或等价可读）。
2. **Given** 无内容差异的场景，**When** 脚本执行，**Then** 输出保持简洁（不因本次改动而在无差异时也打印冗余信息）。

---

### User Story 6 - it.todo 清单只保留真实待办（Priority: P3）

作为仓库维护者，我希望 23 条 `it.todo` 按"能不能填"分类处置：结构性填不了的（断言的是 mock 出的 LLM 语义产出）删除并把理由记录进 docblock，技术上填得了的（不依赖 LLM 输出）保留但阻塞理由改写为真实理由，误用 `it.todo` 承载"设计豁免记录"的一条改为普通注释，这样测试报告里的"待办"数量真实反映需要投入的工作量，而不是长期虚高、且混杂着永远不会被完成的项目。

**Why this priority**：`verified-facts.md` §⑥ 实证 20 条中卡面所述阻塞前提（"待 fixture 落地"）已失效（4 个 fixture 均已存在），但按"断言对象是不是 LLM 语义产出"复核后，其中 10 条是**结构性不可填充**（本仓所有 e2e 均 `vi.mock('@anthropic-ai/sdk')`，填充这类用例只是制造表面工作），另外 10 条**技术上可填充**（断言的是纯函数/日志/prompt 入参/空输入下的缺席，不依赖 LLM 输出）；1 条（`agent-context-sanitize.test.ts`）是 `it.todo` 的误用，承载的是"故意豁免"的说明而非待办。价值主要是信息准确性，非阻断性缺陷，故列 P3。

**Independent Test**：跑 `npx vitest run`，⑥ 名下的 todo 计数由 21（限 `.test.ts`/`.test.mjs` 内）降至 10；剩余 10 条的注释均为真实阻塞原因（技术上可填充，待写 mock-LLM 集成用例）；10 条结构性不可填充的已从 `it.todo` 转为各自文件 docblock 里的永久性说明；`agent-context-sanitize.test.ts` 的豁免说明不再以 `it.todo` 形式出现。**注意**：`npx vitest run` 报告的全仓 todo 总数是 **12**，而非 10——多出的 2 条来自 ⑦-B1 把 `tests/kb/ingester.test.ts` 与 `tests/e2e/feature-171-file-navigation.e2e.test.ts` 中的占位断言 `expect(true).toBe(true)` 转为诚实的 `it.todo`（21 − 10 − 1 + 2 = 12），不属于 ⑥ 名下待办，与"降至 10"不矛盾。

**Acceptance Scenarios**：

1. **Given** 10 条断言 LLM 语义产出（ADR 标题/内容含特定领域词、hyperedge 计数）的结构性不可填充 `it.todo`，**When** 处置完成，**Then** 这些 call site 被删除，对应文件 docblock 记录"deferred 的是什么、为什么永久不做"（mock 后断言恒真 + 本仓 CI 无真实 LLM 通道）。
2. **Given** 10 条断言不依赖 LLM 输出（`graph-html-generation` 4 条 + `include-docs-integration` 3 条 + empty-project 3 条，断言纯函数/日志/prompt 入参/空输入下的缺席）的可填充 `it.todo`，**When** 处置完成，**Then** 保留 `it.todo`，阻塞理由更新为"待有人写 mock-LLM 集成用例填充"（不再引用已失效的"待 fixture"理由），填充本身移交后续卡。
3. **Given** `agent-context-sanitize.test.ts:142` 的豁免记录被 `it.todo` 误用承载，**When** 处置完成，**Then** 该记录以普通注释呈现，不再出现在 vitest 的"待办测试"报告里。
4. **Given** 处置完成后的代码库，**When** 跑 `npx vitest run`，**Then** ⑥ 名下的 todo 计数从 21 降至 10，且每条剩余待办的理由都是真实、可核验的（全仓 todo 总数为 12，含 ⑦-B1 新转入的 2 条占位断言改写，详见 SC-006）。

---

### User Story 7 - grep 式测试与恒真断言按清单分类处置（Priority: P3）

作为仓库维护者，我希望已由独立子代理清点出的 99 条虚化断言（源码文本 grep 式测试 64 条 + 恒真断言 35 条）按改动性质分类处置：缺陷在断言本身、可机械修正的 35 条本卡就地修正，缺陷在测试方式、需要"`vi.mock` + 真调用重写整个文件"的 64 条整理成坐标明确的移交清单，这样测试套件里不再有看似断言实则永不失败的伪装守护，同时不把本卡从"清淤"膨胀成"测试套件重写"。

**Why this priority**：本仓存在大量**正当**的文本合同守护（wrapper 同步、SKILL.md 片段同步、release contract 同步、生成产物一致性），这类不在处置范围内。`inventory-item7.md` 清点出的 99 条虚化断言里，35 条（B 类：断言恒真、条件放水、占位断言等）缺陷在断言本身，修法机械且可逐条独立变异验证，本卡直接处置；64 条（A 类：被测对象本可直接调用验证却退化成对源码文本做正则/子串匹配）缺陷在测试**设计方式**，修复需要重写整个文件的 mock 策略与断言方式，属于超出本卡"清淤"范围的另一项工作，本卡把这 64 条整理成有精确文件坐标、有具体改法建议的移交清单，让它们从"没人知道的隐性欠账"变成"显性待办"。

**Independent Test**：对照 `inventory-item7.md` 逐条核对处置结果——B 类 35 条中每条都已按建议修正（前置 length 断言 / 收紧比较符 / 删除），并可用变异测试验证；A 类 64 条保持不变，但清单本身已入库，10 个移交条目（A1–A10）各自的文件路径、涉及条数、grep 对象、建议改法均完整可读；标记为"合理"的正当文本合同守护条目零改动。

**Acceptance Scenarios**：

1. **Given** `inventory-item7.md` B 类 35 条（占位断言 3 + 条件恒假 12 + 自证测试 3 + 数值恒真 5 + 无 throw 路径 3 + 静态类型检查 12 + 名实不符 5，注：条数按清单原文小计，含 2 条随 ① 删除自动消失、1 条为 ① 移植处置中一并修回的弱化断言），**When** 处置完成，**Then** 每条均按清单建议修正为能够失败的有效断言或删除，并有对应变异测试证明修正后能检测到回归。
2. **Given** `inventory-item7.md` A 类 64 条（A1–A10 十个移交条目），**When** 处置完成，**Then** 这些条目本身不作代码改动，但 `inventory-item7.md` 作为清单本身已入库为本卡交付物，坐标、条数、建议改法完整可读，供后续卡直接认领。
3. **Given** `inventory-item7.md` 中标记为"合理"的正当文本合同守护条目（wrapper 同步、release contract 同步、分层架构守卫、负向漂移守卫等），**When** 处置完成，**Then** 这些条目不受影响，仍以原有形式存在。
4. **Given** `src/panoramic/qa/__tests__/{rag-reranker,index}.test.ts` 中原本计入 B 类清单的 2 条虚化断言，**When** ① 删除该目录后，**Then** 这 2 条随之自动消失，不需要在 ⑦ 单独处置；`tests/panoramic/qa/index.test.ts` 的恒真 `durationMs >= 0` 独立用例在 ① 的移植处置中一并整条删除（非"修回 `> 0`"，理由同 SC-001）。

---

### Edge Cases

- **pinned graph 陈旧检查在 CI 上跑不了 Python 语料时怎么办？**（对应 US3 / FR-004）→ 必须输出显式"无法在本环境验证"结论，不得静默跳过、不得被误判为"一致"。
- **③ 与 ④ 新接的守护如果本身不会因破坏而变红怎么办？**（对应 US2 / US3 / FR-003 / FR-004）→ 验收阶段必须各做一次变异测试（人为打坏被守护对象），确认守护会红；若不会红视为未完成。
- **④ 的 TS pinned fixture 断言更新时如果直接用 `vitest -u` 生成会怎样？**（对应 US3 / FR-004）→ 明确禁止；必须按 fixture README 的 SOP 手工推导后逐个替换数字，并同步更新 README 的人工推导表。
- **①②⑥ 的删除操作如果遗漏旧名称残留会怎样？**（对应 US1 / US4 / US6）→ verify 阶段必须对代码 + 文档做全仓 grep 扫描确认无残留（Constitution 原则 XIV）。
- **跑批时命中预存 flaky（watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e --version）怎么处理？**（对应所有 US）→ 不得当作本卡引入的回归处理，隔离重跑确认与本卡改动无关即可。
- **③ 的 CI 步骤改动与 F270/F271 并行卡的 `ci.yml` 改动冲突怎么办？**（对应 US2 / FR-003）→ 后 ship 的一方需 rebase 并重跑验证，本卡不得抢先覆盖对方改动。
- **③ 的 CI 改动本身在本地无法完整验证（依赖真实 GitHub Actions 环境）怎么办？**（对应 US2 / FR-003）→ 走 F269 惯例：报告先落盘 + 留 PENDING 节，待真实 CI run 结果回填后再视为完成。
- **⑤ 的输出改动如果在"无差异"场景下也打印冗余信息会怎样？**（对应 US5 / FR-005）→ 视为不满足验收标准，因为会制造新的日志噪声。
- **①的 qa 迁移如果超出"删副本 + 移植 2 条 + 修回 1 处弱化断言"的范围，顺手改了生产代码怎么办？**（对应 US1 / FR-001 / FR-002）→ 明确禁止，本卡只允许改测试侧文件，不得改 `src/panoramic/qa/` 生产代码。
- **⑦ 的清单如果把正当的文本合同守护误判为需处置怎么办？**（对应 US7 / FR-007）→ 判别红线已写入子代理 prompt（wrapper/SKILL.md/release contract/生成产物一致性守护一律判"合理"），处置前需按此红线复核清单。
- **零执行测试文件守卫如果把 `tests/fixtures/**` 之外的新增语料文件也算作差集怎么办？**（对应 US1 / FR-011）→ 守卫必须失败，不允许静默扩大白名单；新语料需显式加入白名单声明后守卫才能通过。
- **① 删除 `src/panoramic/qa/__tests__/` 时是否会影响 ⑦ 已清点的 B2/B4 类条目（`rag-reranker.test.ts:131` / `index.test.ts:191`）？**（对应 US1 / US7 / FR-001 / FR-008）→ 这两条随目录删除自动消失，⑦ 无需单独处置；但 `tests/panoramic/qa/index.test.ts` 的恒真 `durationMs >= 0` 独立用例需在 ① 的移植处置中一并整条删除（不得遗漏，非"修回 `> 0`"——字面执行会造确定性红，详见 `verified-facts.md` 更正记录）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 删除 `src/panoramic/qa/__tests__/` 全部 8 个文件（从不被 vitest 收集的陈旧副本），并将其中 2 条 `tests/panoramic/qa/debt-context.test.ts` 未覆盖的真实断言（"技术债"关键词命中、"架构问题不应匹配"负例）移植进 `tests/panoramic/qa/debt-context.test.ts`；`llm-caller` 测试中"应从项目配置读取模型 ID"一条不移植（其断言只验证 `runBudgetGate` 被调用而不验证模型 ID，属 ⑦ 定义的名实不符/恒真断言）；同时将 `tests/panoramic/qa/index.test.ts` 中恒真的 `durationMs >= 0` 独立用例整条删除（存在性与类型已由同文件第 169 行既有断言覆盖；`verified-facts.md` 变异验证证实字面"修回 `> 0`"在全 mock 管线下会造确定性红，已按更正后裁决处置）。可追踪至 User Story 1。`[必须]`——去掉则陈旧副本与其 10 条失败用例继续制造"测试待修复"的假象，且 2 条已用变异测试证明不可替代的真实覆盖会永久丢失。
- **FR-002**: 系统 MUST NOT 在实现 FR-001 的过程中修改 `src/panoramic/qa/` 下的生产代码逻辑（仅允许修测试侧文件），MUST NOT 将 `src/panoramic/qa/**` 加入 `vitest.config.ts` 的 `unit` project include（陈旧副本已删除，不存在需要纳入执行的目标）。可追踪至 User Story 1。`[必须]`——防止范围蔓延到生产代码改动，且防止误把已废弃的路径重新接入 include。
- **FR-003**: 系统 MUST 将 `npm run typecheck:tests`（覆盖 F220/F222/F170c 三份类型契约守护）接入 CI 流程（`.github/workflows/ci.yml`），使其失败时整个 CI run 标红；并通过至少一次变异测试验证该步骤确实能检测出契约破坏。可追踪至 User Story 2。`[必须]`——去掉则三份已存在的类型契约守护继续对任何改动零阻力，是纯摆设。
- **FR-004**: 系统 MUST 新增一项"pinned graph 是否陈旧"检查，覆盖当前有仓内源的语言 fixture（TS/JS、Java、Go），对无法在当前环境验证的语言（如依赖仓外 clone 的 Python/micrograd）MUST 输出显式的"无法验证"结论而非静默跳过；同时 MUST 手工重新推导并更新 TS/JS pinned fixture 至与当前 builder 一致（不使用 `vitest -u`），并同步更新 fixture README 的人工推导表；并通过至少一次变异测试验证该检查确实能检测出 pinned 落后于 builder 的情况。可追踪至 User Story 3。`[必须]`——去掉则 pinned graph 陈旧会继续在测试全绿的假象下无限期存在，是本卡揭示的最典型的虚假覆盖信号。
- **FR-005**: 系统 MUST 修改 `scripts/regen-collector-fingerprint-fixtures.ts` 的放行分支，使其在 `contentMismatch=true` 时输出（打印或落盘）已计算出的 `differences` 明细，而非仅输出布尔量摘要。可追踪至 User Story 5。`[必须]`——去掉则维护者在覆写 fixture 前无法看清具体变化，差异信息永久丢失且无法挽回。
- **FR-006**: 系统 MUST 移除 `graph-mcp-snapshot.test.ts` 中依赖已删除 fixture 的 Layer B self-dogfood 条件跳过块及其 2 条孤儿快照条目，并确认该块断言的覆盖面已由其他现存测试（Layer B MVP god_nodes 测试 + lang-matrix 四语言测试 + micrograd 真实图测试）等价覆盖。可追踪至 User Story 4。`[必须]`——去掉则该块会继续以"看似存在实则静默跳过"的状态误导维护者，且孤儿快照会继续无意义地占用 snapshot 文件。
- **FR-007**: 系统 MUST 将 10 条断言 LLM 语义产出、结构性不可填充的 `it.todo`（`cross-project-isolation` 4 条 + `adr-cross-fixture` 3 条 + `hyperedge-first-run` 3 条，各自原有集合中的 empty-project 用例经复核不属此类，见下）删除，并在对应文件 docblock 中记录 deferred 内容与永久不做的理由；MUST 将 10 条不依赖 LLM 输出、技术上可填充的 `it.todo`（`graph-html-generation` 4 条 + `include-docs-integration` 3 条 + `cross-project-isolation`/`adr-cross-fixture`/`hyperedge-first-run` 三份文件各自的 empty-project 用例共 3 条——断言的是空输入下的缺席与文件系统产物，不依赖 LLM 输出）保留但阻塞理由改写为真实理由；MUST 将 `agent-context-sanitize.test.ts` 中被 `it.todo` 误用承载的豁免记录改为非 `it.todo` 的呈现形式。可追踪至 User Story 6。`[必须]`——去掉则 todo 报告继续混杂"结构性永远填不了"与"技术上可填"两类不同性质的待办，且继续用已失效的理由误导维护者对待办工作量的判断。
- **FR-008**: 系统 MUST 依据独立子代理产出的 `specs/272-test-guard-asset-cleanup/inventory-item7.md` 清单，就地修正 B 类（断言恒真 / 条件放水 / 占位 / 名实不符等）35 条虚化断言中、未随 FR-001 的删除自动消失的条目，改为能够失败的有效断言或删除，并对关键条目（如条件恒假类）做变异测试验证；MUST 将 A 类（源码文本 grep 式测试）64 条以清单形式移交（本卡不改动 A 类的代码，清单入库即完成交付）；标记为"合理"的正当文本合同守护条目保持不变。可追踪至 User Story 7。`[必须]`——去掉 B 类处置则伪装成守护的失效断言继续存在于测试套件中；去掉 A 类移交清单则 64 条问题继续是无坐标、无处置建议的隐性欠账，下一次清理仍要从零扫描。
- **FR-009**: 系统 MUST 在完成 FR-001/FR-006/FR-007 的删除或重命名操作后，对代码库（代码 + 文档）做全仓扫描确认旧名称无残留。可追踪至 User Story 1、User Story 4、User Story 6。`[必须]`——去掉则删除操作可能留下悬挂引用或过时文档描述，制造新的不一致。
- **FR-010**: 系统 MUST NOT 修改 `src/mcp/`、`fix-compliance*`、`hooks/` 路径下的任何文件（并行卡 F270/F271 的写入面）。可追踪至全部 User Story。`[必须]`——防止与并行交付的 feature 产生写入冲突。
- **FR-011**: 系统 MUST 新增一项"零执行测试文件"守卫：比较磁盘上全部 `*.test.ts` 文件集合与 vitest 实际收集到的测试文件集合，断言二者差集恰好等于一份显式声明的白名单（当前仅含 `tests/fixtures/**` 下的语料文件，如 `tests/fixtures/graph-quality-ts/greeter-service.test.ts`）；并通过至少一次变异测试（临时新增一个不在 include 范围内的 `*.test.ts`）验证该守卫确实能检测到差集扩大。可追踪至 User Story 1。`[必须]`——去掉则①今日修复的"测试文件游离于执行范围外"问题在未来会无声复发，本卡就只是一次性清淤而非装上可持续生效的守卫，与 feature 的整体定位（"为会复发的类别装上守卫"）矛盾。

### Key Entities

- **qa 测试套件**：`src/panoramic/qa/__tests__/`（8 个文件，从不被 vitest 收集的陈旧副本，处置后删除）与 `tests/panoramic/qa/`（8 个文件，在跑的真实覆盖，83 用例全绿，处置后新增 2 条移植用例并修回 1 处弱化断言）。
- **零执行测试文件守卫**：新增的检查逻辑，比较磁盘 `*.test.ts` 集合与 vitest 收集集合的差集，并对照一份显式白名单，是 FR-011 的实现对象。
- **self-dogfood 快照块**：`graph-mcp-snapshot.test.ts` 中依赖已删除 fixture 的条件跳过测试块，及 `__snapshots__` 文件中对应的 2 条孤儿快照条目。
- **类型契约守护三件套**：F220（orchestrator 导出）、F222（llm-degraded 必填字段）、F170c（enrichment 可选字段）三份独立 `.typecheck.ts` / `.test-d.ts` 文件及其专属 tsconfig。
- **pinned graph fixture**：四语言（TS/JS、Java、Go、Python）lang-matrix 测试消费的冻结图快照文件及其 README 人工推导表。
- **fingerprint regen 差异信息**：`compareGraphOnlyStructure` / `compareModuleGraphSnapshot` 计算出的 `differences` 数组，在放行分支当前被丢弃。
- **it.todo 清单**：23 条待办标记及其阻塞理由注释，分布在 6 个测试文件中；处置后按可填充性分为 10 条删除（转 docblock）、10 条保留（改写理由）、1 条改为普通注释三类。
- **inventory-item7 清单**：由独立子代理产出的清点结果，共 99 条虚化断言（A 类源码文本 grep 64 条 / B 类恒真断言 35 条），是 FR-008 处置 B 类与移交 A 类的依据；清单入库本身是 ⑦ 的主交付物。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：`src/panoramic/qa/__tests__/` 全部 8 个文件已删除；`tests/panoramic/qa/` 下 8 个文件（含新增移植的 2 条用例）在 `npx vitest run --project unit tests/panoramic/qa` 下全部通过（用例数由 83 增至 84 = 83 + 2 移植 − 1 删除的恒真 `durationMs` 独立用例，按文件逐一清点：citation 5 + debt-context 15 + graph-retriever 9 + index 14 + llm-caller 8 + prompt-builder 14 + qa-integration 10 + rag-reranker 9 = 84）；`tests/panoramic/qa/index.test.ts` 中原恒真的 `durationMs >= 0` 独立用例已整条删除，存在性与类型由同文件第 169 行既有 `typeof` 断言覆盖。
- **SC-002**：类型契约守护三件套接入 CI 后，人为破坏任一契约（变异测试）均能使 CI run 标红；三份守护各自独立验证通过（不存在只覆盖其中一份就视为完成的情况）。
- **SC-003**：TS/JS pinned graph fixture 与当前 builder 重建结果逐边一致（0 差异）；Java/Go/Python 三份 fixture 的一致性或"无法验证"结论均在 pinned-staleness 检查输出中显式可见；对陈旧的 fixture 做变异测试（人为改变 builder 行为）能被检查捕获。
- **SC-004**：`regen-collector-fingerprint-fixtures.ts` 在放行分支输出包含具体差异条目，而非仅布尔量摘要；无差异场景下输出不新增冗余信息。
- **SC-005**：self-dogfood 快照块及其 2 条孤儿快照从代码库移除后，全仓 grep 旧名称无残留；`graph-mcp-snapshot.test.ts` 保留用例全部通过。
- **SC-006**：23 条（全部口径）/21 条（`.test.ts`/`.test.mjs` 内）`it.todo` 中，10 条结构性不可填充的已删除并有 docblock 永久说明；10 条技术上可填充的保留且阻塞理由为真实理由（`graph-html-generation` 4 + `include-docs-integration` 3 + `cross-project-isolation`/`adr-cross-fixture`/`hyperedge-first-run` 各自的 empty-project 用例共 3）；1 条误用改为普通注释；⑥ 名下的 todo 计数从 21 降至 10，真实反映实际待办工作量。全仓 `npx vitest run` 报告的 todo 总数为 **12**（21 − 10 − 1 + 2 = 12），多出的 2 条是 ⑦-B1 把 `tests/kb/ingester.test.ts` 与 `tests/e2e/feature-171-file-navigation.e2e.test.ts` 中原本的占位断言 `expect(true).toBe(true)` 改写为诚实的 `it.todo`，与本 SC 的"10"各表其义，互不矛盾。
- **SC-007**：`inventory-item7.md` B 类 35 条虚化断言中，除随 FR-001 自动消失的 2 条外，每条均有对应处置结果（改为真实行为验证或删除）且可通过变异测试验证；A 类 64 条以 `inventory-item7.md` 清单形式入库移交，坐标与建议改法完整；"合理"条目零改动；处置前后运行全量单测零失败。
- **SC-008**：全部改动完成后，`npx vitest run`、`npm run build`、`npm run repo:check` 本地零失败；CI 改动（FR-003）走报告先落盘 + PENDING 节 + 真实 CI run 回填的验收路径。
- **SC-009**：全仓 `find src tests -name '*.test.ts'` 得到的集合与 `npx vitest list --filesOnly` 收集到的集合之间的差集，等于且仅等于显式白名单（`tests/fixtures/**` 语料文件）；对该守卫做变异测试（临时新增游离测试文件）能使其失败，删除临时文件后恢复通过。

## 裁决记录（① / ② / ⑥ "修 vs 删"）

### ① `src/panoramic/qa/__tests__` —— 裁决：**删 + 移植 + 新增守卫**（推翻第一版"修"的裁决）

- **第一版裁决（已推翻）**：修（拒绝删除），理由是"删除会永久丢失活代码 qa 模块唯一的直接测试覆盖"。
- **推翻该裁决的实证**：第二轮复核发现同名的 `tests/panoramic/qa/`（8 文件）本就在 vitest unit include 范围内，实跑 `npx vitest run --project unit tests/panoramic/qa` 得到 `8 passed / 83 passed`。git 历史显示 `tests/panoramic/qa/` 建于 Step 2 并收过 post-review 修复，是持续维护的那一份；`src/panoramic/qa/__tests__/` 建于 Step 5 之后再未被碰过，是**从不执行的陈旧副本**，不是"唯一覆盖"。qa 模块是活代码这一结论不变（仍是 3 处生产引用），只是它的真实测试覆盖来自 `tests/`，不是 `src/`。
- **被否方案（直接全删）**：否决理由——逐用例差分发现 src 侧有 2 条 `tests/` 侧没有覆盖到的真实断言（"技术债关键词命中"一条已用变异测试证明不可替代：删掉实现里的 `technical\s*debt` 分支后，`tests/` 侧现有用例全绿，只有这条会红），直接全删会造成真实覆盖损失。
- **采纳方案**：删除 `src/panoramic/qa/__tests__/` 全部 8 文件；把 2 条独有真实覆盖移植进 `tests/panoramic/qa/debt-context.test.ts`；`llm-caller` 的第三条独有用例不移植（名不副实、零守护力，属 ⑦ 类问题）；不改 `vitest.config.ts` include（陈旧副本已不存在，无需纳入）；不动 qa 生产代码。
- **新增价值**：单纯删除副本只解决"这一次"，不解决"下一次又有人把测试复制到 include 范围外没人发现"的复发面。全仓普查证实处置后零执行测试文件集合恰好收敛到 1 个（`tests/fixtures/graph-quality-ts/greeter-service.test.ts`，本就是语料非测试），因此本卡新增一道精确的"零执行测试文件"守卫（断言磁盘集合与 vitest 收集集合的差集等于显式白名单），这是 ① 真正根治复发面的部分，比单纯删副本更重要。

### ② self-dogfood Layer B 快照块 —— 裁决：**删**（拒绝重建）

- **候选方案 A（重建 fixture）**：否决理由——需要把 6.5 MB 的冻结图快照入库，且该快照会随本仓自身演化而持续需要重新生成，这与本卡 ④ 揭示的"pinned 图会静默陈旧"的风险直接冲突，属于在清理一个陈旧问题的同时制造另一个同类问题。
- **候选方案 B（改用 live 图消费）**：否决理由——实证当前没有任何 vitest 测试消费本仓自身实时构建的 `specs/_meta/graph.json`；改用 live 图会新增"本机没建图就红"的环境耦合，且 `toMatchSnapshot` 会随每次 commit 内容变化而持续 churn，不具备可持续性。
- **采纳方案（删除）**：该块两条断言的覆盖面已由 Layer B MVP god_nodes 测试、lang-matrix 四语言真实图测试、micrograd 真实 Python 图测试等价覆盖，删除不造成净覆盖损失，同时消除 3.7 个月的静默跳过噪声与孤儿快照。

### ⑥ 23 条 `it.todo` —— 裁决：**按可填充性三分：10 条永久删除+记录理由 / 10 条保留但改写阻塞理由 / 1 条误用改为普通注释**（推翻第一版"20 条一刀切保留"的裁决；第二版"13/7 二分"被第三轮异构对抗审查进一步复核修正）

- **第一版裁决（已推翻）**：保留全部 20 条，仅更新阻塞理由为"需要真实 LLM 通道"；隐含前提是这 20 条都同样填不了。
- **推翻该裁决的实证**：第二轮复核按"断言的对象是不是 LLM 的语义产出"这一判据逐条复核（本仓所有 e2e 都 `vi.mock('@anthropic-ai/sdk')`，mock 出的"LLM 语义"是测试自己写进去的，断言它恒真）：
  - `cross-project-isolation`（5）+ `adr-cross-fixture`（4）+ `hyperedge-first-run`（4）共 13 条断言的是 ADR 标题/内容含特定领域词、hyperedge 计数——这些都是 LLM 的语义产出，mock 后填充即制造"假装完成"的表面工作，**结构性不可填充**。
  - `graph-html-generation`（4）断言的是 `buildHtmlTemplate` 这一**纯函数**的 banner 判定，不依赖 LLM，**可填充**。
  - `include-docs-integration`（3）断言的是日志文本、纯截断的 `readmeExcerpt`、发给 LLM 的 **prompt 入参**——都不是 LLM 输出，**可填充**。
- **第三轮复核更正（推翻上述 13/7 判据的一处遗漏）**：第二版把上述 13 条一刀切归为"结构性不可填充"时，未逐条核对断言对象——`cross-project-isolation`/`adr-cross-fixture`/`hyperedge-first-run` 三份文件里各自的 **empty-project** 用例（共 3 条：`0 ADR + graph.html banner` / `ADR 列表为空 + _PIPELINE_FAILED.md` / `hyperedges = []`）断言的是**空输入下的缺席**——空项目没有源码可喂给 LLM，输出为空与 LLM 说了什么无关；文件系统产物（`_PIPELINE_FAILED.md` 是否落盘、banner 是否注入）更是纯 IO/纯函数判定，与其余 10 条（`micrograd`/`nanoGPT`/`ky` 三个 fixture 各自的 ADR 标题/hyperedge 计数断言，真实依赖 LLM 语义内容）性质不同。故 13 条中的这 3 条改判为**技术上可填充**，与 `graph-html-generation`/`include-docs-integration` 同类。
- **被否方案（全部填充 / 全部删除）**：全部填充会对 10 条结构性不可填充的用例制造假完成；全部删除会丢失 10 条本可填充、只是一直没人写的测试设计意图。
- **采纳方案**：
  1. **10 条结构性不可填充**（`cross-project-isolation` 4 条 + `adr-cross-fixture` 3 条 + `hyperedge-first-run` 3 条，均为 micrograd/nanoGPT/ky 的 ADR 标题/hyperedge 计数断言）→ 删除 `it.todo` call site，在各文件 docblock 记录"deferred 的是什么、为什么永久不做"（断言 LLM 语义产出，mock 后成恒真；本仓 CI 无真实 LLM 通道，这是设计选择而非临时阻塞）。一个按设计就填不了的 `it.todo` 是永久的虚假欠账信号，不应保留。
  2. **10 条技术上可填充**（graph-html 4 + include-docs 3 + empty-project 3，均不依赖 LLM 语义输出）→ 保留 `it.todo`，把阻塞理由从已失效的"待 Phase 1a fixture 落地"改写为真实理由——"待有人写 mock-LLM 集成用例填充"（填充本身是新增测试覆盖，超出本卡"清淤"定位，移交后续卡；`graph-html-generation.test.ts` 与 ⑦-A7 同文件，建议一并移交）。
  3. **1 条误用**（`agent-context-sanitize.test.ts`）→ 改为普通注释，不再以 `it.todo` 形式出现在 vitest 待办报告里。
- **可观测效果**：⑥ 名下的 todo 计数由 23（全部口径）/21（限 `.test.ts`/`.test.mjs` 内）降至 10（10 条保留 + 0 误用，10 条转为 docblock 记录不再计入 todo 报告）；剩下 10 条的阻塞理由是真的。**但全仓 `npx vitest run` 报告的 todo 总数是 12，不是 10**——⑦-B1 处置把 `tests/kb/ingester.test.ts:394` 与 `tests/e2e/feature-171-file-navigation.e2e.test.ts:128` 两条原本的占位断言 `expect(true).toBe(true)` 改写为诚实的 `it.todo`（占位断言假装"这里有测试且通过"，`it.todo` 如实说"这里还没有测试"，是更诚实的形态），这 2 条计入全仓总数但不属于 ⑥ 名下的处置范围。换算式：21（⑥ 基线）− 10（⑥ 删除）− 1（⑥ 转普通注释）+ 2（⑦-B1 新转入）= 12（全仓总数；基线值 21 见 `verification/baseline-before.md`）。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：3（新增 pinned-staleness 检查脚本/模块；CI 新增 typecheck:tests 步骤；新增"零执行测试文件"守卫脚本/检查）。其余各项（①⑤⑥⑦）均为对既有资产的修改/删除，不构成新增组件。
- **接口数量**：3（pinned-staleness 检查的输出接口/契约；`regen-collector-fingerprint-fixtures.ts` 放行分支的输出格式变更；零执行测试文件守卫的输出/白名单契约）。
- **依赖新引入数**：0（全部基于仓内既有工具链 vitest / tsc / 既有 compare 函数）。
- **跨模块耦合**：否——本卡改动集中在测试资产与脚本自身，不修改 2+ 个现有生产模块的对外接口；FR-002/FR-010 明确禁止触碰生产代码与并行卡写入面。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无数据迁移。
- **总体复杂度**：**MEDIUM**（组件数 3 落在 3-5 区间，触发 MEDIUM 判定；接口数 3 < 4、无复杂度信号，未触发 HIGH）。较第一版新增了"零执行测试文件守卫"这一独立组件，复杂度评级由 LOW 上调为 MEDIUM，建议 GATE_DESIGN 对该新增组件的设计做一次人工复核。
