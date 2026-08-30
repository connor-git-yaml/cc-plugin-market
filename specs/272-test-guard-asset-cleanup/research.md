# Phase 0 研究记录：五项技术决策

本 feature 无独立调研阶段（story 模式），"研究"即 plan 阶段对 `verified-facts.md` 事实基线的技术选型工作。以下五项决策对应 plan.md "五项关键设计决策"一节，此处按 Decision / Rationale / Alternatives Considered 格式记录，供 GATE_DESIGN 复核。

## 决策 1：③ typecheck:tests 的 CI 接入点

**Decision**：在 `.github/workflows/ci.yml` 新增独立步骤 `Type Check Tests`，位置紧跟既有 `Type Check` 步骤之后、`Build` 之前；不接入 `repo:check`。

**Rationale**：
- 三份类型契约资产（`tests/type-tests/{tsconfig.json,f220.tsconfig.json,f222.tsconfig.json}`）type-only import `src/**/*.ts`，不依赖 `dist/`，可在 `Build` 之前执行，符合 fail-fast。
- `repo:check` 当前是 15 个子检查族聚合而成的纯 JS 校验族（唯一 spawn 外部产物的 `graph-quality` 子检查 spawn 的是本项目自建的 `dist/cli/index.js`，不是外部编译器），接入 `tsc` 会改变其架构性质。
- FR-003 字面只要求"接入 CI"，未要求接入 `repo:check`；`prepublishOnly` 本就在 `repo:check` 之前先跑过一次 `npm run build`（隐含一次 `tsc`），重复接入无增量保护。

**Alternatives Considered**：
1. **扩大根 `tsconfig.json` 的 include 覆盖 `tests/type-tests/`** —— 否决：会把整个 `tests/` 纳入 `npm run lint` 的编译面，`tsconfig.json:46` 的 `exclude: "tests"` 是有意为之（防止 `src/**/__tests__` 被 tsc 编译面吞掉），扩大 include 会产生大量与本卡无关的新增类型错误噪声。
2. **接入 `repo:check`（额外 `aggregateValidation` 族）** —— 否决：引入编译器依赖到"纯 JS 校验族"架构，且与 CI 已有的 `Type Check`/新增 `Type Check Tests` 两步骤功能重叠。
3. **只接入 CI 不做变异验证** —— 否决：违反 spec Edge Case"③ 与 ④ 新接的守护如果本身不会因破坏而变红怎么办"，SC-002 明确要求变异测试。

## 决策 2：④ pinned graph 陈旧检查的形态

**Decision**：新增独立 vitest 集成测试 `tests/integration/graph-quality-pinned-staleness.test.ts`；语言→数据源分类用静态声明表（`in-repo` / `external-clone`），运行时对 `external-clone` 语言做动态存在性探测（而非硬编码固定结论）。

**Rationale**：
- 与 `graph-quality-lang-matrix.test.ts`（断言"数值对不对"）语义不同（断言"数值新不新"），分文件避免两类失败信号混淆。
- 复用已导出的 `compareGraphOnlyStructure`（`scripts/regen-collector-fingerprint-fixtures.ts`），避免重新实现结构 diff 逻辑（YAGNI）。
- 三次仓内重建实测合计 ~0.86s（TS 369ms / Java 251ms / Go 243ms），成本可忽略，不为省这点时间引入缓存/采样/条件跳过（F266 教训：静默 skip 会让门禁形同虚设）。
- 动态探测而非硬编码"Python 恒不可验证"：spec Acceptance Scenario 3 原文限定"当前环境（如 CI）没有该 clone"才要求"无法验证"声明，隐含环境里有 clone 时应该真实验证；本地开发机按 `CLAUDE.local.md` 约定已 clone 该 baseline，硬编码会制造"明明能测却假装测不了"的诚实性倒退。

**Alternatives Considered**：
1. **并入 `graph-quality-lang-matrix.test.ts` 现有 `describe.each`** —— 否决：混淆"数值正确性"与"数值新鲜度"两种失败语义，且加大该文件与批次切分的耦合面。
2. **硬编码 Python 恒为 `unverifiable:external-source`（不做运行时探测）** —— 否决：在有 clone 的环境（本地开发机）里制造虚假的"无法验证"结论，是 F266 教训的同构复发；且与 spec 原文条件语义（"当前环境没有该 clone"）不符。
3. **为省重建成本引入缓存/仅采样一种语言** —— 否决：成本已实测可忽略（<0.9s），引入缓存/采样反而增加维护面且可能引入陈旧缓存这一新问题类别，与 F266 教训方向相反。
4. **白名单设计为"运行时不可验证语言集合"（而非"静态数据源分类"）** —— 否决：运行时集合会随本地是否有 clone 而变化，无法承担"防止未核验集合悄悄变大"的职责（该职责需要一个不随环境变化的结构性声明作为锚点）。

## 决策 3：FR-011 零执行测试文件守卫的实现方式

**Decision**：新增 `tests/integration/zero-execution-test-file-guard.test.ts`；磁盘侧扫描面为全仓 `**/*.test.ts`（排除 `node_modules`/`dist`/`.git`，不限定 `src`/`tests` 目录）；vitest 收集侧权威事实源为 `npx vitest list --filesOnly`（子进程 spawn，不自行解析 `vitest.config.ts`）；白名单是"允许零执行的文件路径清单"（每条带理由），与"扫描哪些目录"解耦。

**Rationale**：
- 扫描面若写死 `find src tests`，等于把"今天的目录布局"固化成判据——本仓 F259 已记过"判据写窄了，每加一个新形态就漏一次"的教训，全仓 glob 才能覆盖将来任何顶层目录新增游离测试文件的场景。
- 自行解析 `vitest.config.ts` 的 include 会重新实现 vitest 内部文件匹配逻辑，随 vitest 版本升级漂移，守卫本身变成新的失真源；`vitest list --filesOnly` 是官方 CLI 输出，是权威事实源。
- 协调器实测 `npx vitest list --filesOnly` 0.28s、exit 0、不触发 `globalSetup`（不连带跑 dist 构建）——"vitest 内部 spawn vitest"形态经实测证明安全（子进程独立、返回极快），显式确认可用，不改用更复杂的替代方案。
- 白名单与扫描面职责分离：扫描面决定"看哪里"，白名单决定"看到的意外差集里，哪些是已知合理的例外"——两者混在一起会让"新增一个目录"和"新增一个合理例外"变成同一个操作，削弱守卫对"新增目录"场景的覆盖力。

**Alternatives Considered**：
1. **扫描面限定 `find src tests`** —— 否决：将来新增顶层目录时守卫失明（F259 教训）。
2. **自行解析 `vitest.config.ts` 的 `projects[].test.include`** —— 否决：重新实现 vitest 内部逻辑，版本升级即漂移，协调器已明确排除。
3. **白名单直接写成"允许被排除扫描的目录"（如 `tests/fixtures/**`）** —— 否决：会把 `tests/fixtures/` 下未来新增的任何 `.test.ts`（哪怕是真正遗漏的测试文件）都静默豁免，白名单必须精确到文件级并附带理由。
4. **做成 `repo:check` 的新子检查族而非 vitest 测试** —— 否决：`vitest list` 本身就是数据源，把它做成 vitest 测试可以直接复用现有 CI `Test` 步骤门禁，不扩大 `ci.yml` 改动面（与决策 1 呼应，收窄与 F270/F271 的并行冲突面）；做成 `repo:check` 子检查族则需要额外在 `.mjs` 环境里 spawn `npx vitest list`，引入 vitest CLI 作为 `repo:check`（原纯 JS 校验族）的新依赖，与决策 1 对 `repo:check` 架构性质的保护理由一致。

**域边界声明**：本守卫覆盖 vitest 域（`.test.ts`），不覆盖 `plugins/**/*.test.mjs`（`npm run test:plugins` 独立 runner 链路，约 162 用例）。这是诚实的覆盖边界声明，避免守卫"看起来比实际管得宽"。

## 决策 4：⑤ 放行分支输出差异信息的场景构造

**Decision**：在放行分支追加与拒绝分支同格式的差异打印（仅当 `contentMismatch` 为真时）；新增一个独立测试用例，同时构造"fixture 源码变化（使重建产物真的偏离 pinned）"与"指纹变化（避免落入拒绝分支）"两个变量，断言输出包含 `compareGraphOnlyStructure` 的确定性差异文案（如 `节点仅存在于重建产物: <id>`）。

**Rationale**：
- 既有的第 157 行放行用例只改 `behaviorVersion`（指纹变化）不改源码，`contentMismatch` 大概率为 false——在这条用例上直接追加"断言输出含差异内容"会构造出一条恒假断言（无差异可断言）；改用宽松匹配则会退化成恒真断言（本卡 ⑦ 正要治理的病）。必须新增独立场景，不能复用/修改该既有用例。
- 断言必须落到具体差异文案而非"含 differences 关键词"这类空泛匹配，否则无法证明打印真的携带了信息量。

**Alternatives Considered**：
1. **修改既有第 157 行用例，加一句宽松断言** —— 否决：会制造新的恒真/恒假断言，与本卡 ⑦ 的治理目标直接矛盾。
2. **只做纯函数级单测（不走脚本端到端）** —— 否决：脚本级子进程实跑测试（`tests/integration/collector-fingerprint-regen-script.test.ts`）覆盖的是"脚本真的按判据行事"这条完整链路（该文件顶部注释已解释为什么纯函数真值表不够），跳过端到端会失去对"打印真的发生在放行分支代码路径里"这一事实的证明力。

## 决策 5：implement 阶段的并行切分

**Decision**：三批次（A=①+②，B=③+④+⑤，C=⑥+⑦-B），写入路径两两 disjoint（49 文件已逐一核对无交集），每批次有独立验证命令与回归判据。

**Rationale**：
- 与 Impact Assessment 判定的 HIGH 风险（触发条件：影响文件数 49 > 20）相呼应——HIGH 风险要求"强制分阶段、每阶段独立验证点"，三批次天然满足这一要求。
- 协调器初步设想的切分（A/B/C）经逐文件核对后确认可行，唯二需要额外处理的是：`tests/unit/mcp/` 下两个文件（⑥/⑦-B1）作为 F271 潜在接触面需最小改动约束；`graph-html-generation.test.ts` 是 ⑥（本卡处置）与 ⑦-A7（移交清单，本卡不改代码）共同接触点，需要显式约束"只碰 ⑥ 范围"。

**Alternatives Considered**：
1. **按 US 编号切分（US1-7 各一批）** —— 否决：会把 ⑦-B 的 23 个文件拆成过细的粒度，且部分 US 之间（如①与⑦B2 里的 `qa/rag-reranker.test.ts`）已存在同目录关系需要协调，不如按"写入路径 disjoint"这个更本质的约束重新分组。
2. **单批次串行处理全部 7 项** —— 否决：不满足 HIGH 风险判定的"强制分阶段"要求；且单批次修改 49 个文件会让一次 verify 失败难以定位是哪个逻辑单元引入的回归。
