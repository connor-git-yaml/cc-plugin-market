# Implementation Plan: 测试与守护资产清淤（Test & Guard Asset Cleanup）

**Branch**: `claude/test-guard-asset-cleanup-6b29b3` | **Date**: 2026-08-31 | **Spec**: `specs/272-test-guard-asset-cleanup/spec.md`
**Input**: `spec.md`（US1-7 / FR-001~011 / SC-001~009）+ `verified-facts.md`（编排器实跑事实基线，含 specify 阶段后追加的成本实测）+ `inventory-item7.md`（⑦ 99 条虚化断言清单）+ `verification/baseline-before.md`（回归判定对照组）

## Summary

本卡不新增产品功能，而是对七类"看着有覆盖、实际零守护力"的测试/守护资产逐项清淤：删除陈旧副本（①）、移除失效条件跳过块（②）、把已存在但未接线的类型契约测试接入 CI（③）、给 pinned graph fixture 装上陈旧检测（④）、修复 fingerprint regen 脚本丢弃差异信息的缺陷（⑤）、按可填充性重新分类 it.todo（⑥）、就地修正 35 条恒真断言并把 64 条需要重写测试方式的条目整理为移交清单（⑦）。同时新增两道**可持续生效**的守卫（FR-004 pinned 陈旧检测 / FR-011 零执行测试文件检测），把"这一次清干净"升级为"下一次会被当场发现"。

技术路径：不引入任何新依赖，全部基于仓内已有工具链（vitest / tsc / 既有 `compareGraphOnlyStructure` 比较函数 / dist CLI 的 `graph-only` 建图模式）。三个新增组件（③ CI 步骤、④ pinned-staleness 检查、FR-011 零执行守卫）均以最小侵入方式接入既有质量门（CI / vitest Test 步骤），刻意不触碰 `repo:check` 的"纯 JS 校验族"架构性质。

## Technical Context

**Language/Version**: TypeScript 5.7（`tsc` 类型检查）+ Node.js ≥20（vitest 3.x 运行时）
**Primary Dependencies**: vitest 3.x（测试执行 + `vitest list` 文件收集事实源）、typescript（`tsc --noEmit` 类型契约检查）、既有 `scripts/regen-collector-fingerprint-fixtures.ts` 导出的 `compareGraphOnlyStructure`（结构 diff 复用，不重新实现）
**Storage**: N/A（无数据库/状态存储；涉及的"数据"是测试 fixture JSON 文件与 CI 配置）
**Testing**: vitest（unit/integration/e2e/golden-master/self-hosting 五个 project）+ `tsc -p tests/type-tests/*.tsconfig.json --noEmit`（`typecheck:tests`）
**Target Platform**: Node.js CLI 环境（本地开发机 + GitHub Actions ubuntu-latest runner）
**Project Type**: single（无 web/mobile 结构，本卡改动集中在 `tests/`、少量 `src/panoramic/qa/__tests__`（仅删除）、一份 `scripts/*.ts`、一份 `.github/workflows/ci.yml`）
**Performance Goals**: 新增守卫的墙钟增量 < 1.5s（实测：FR-011 `npx vitest list --filesOnly` 0.28s；④ 三次 `graph-only` 重建合计 ~0.86s），不得拖慢现有 CI/本地测试面
**Constraints**: MUST NOT 修改 `src/mcp/`、`fix-compliance*`、`hooks/`（F270/F271 并行卡写入面）；MUST NOT 修改 `src/panoramic/qa/` 生产代码；冻结型快照 MUST NOT 用 `vitest -u` 一把梭；三处新守卫 MUST 各自通过一次变异测试证明有守护力
**Scale/Scope**: 49 个文件的创建/修改/删除（8 删除 + 3 新增 + 38 修改），聚合到约 20 个逻辑处置单元（① ② ③ ④ ⑤ ⑥ + ⑦B 的 7 个子类），零新增生产代码模块

## Codebase Reality Check

按七项分组列出主要写入面文件的规模与已知 debt。B 类（⑦）grep 式条目已在 `inventory-item7.md` 给出精确 `文件:行号`，此处不重复罗列全部 23 个文件的行号级坐标，只列已实测的整文件 LOC，作为"这些文件是否需要前置清理"的判据依据。

| 文件 | 处置项 | LOC（实测） | 涉及方法/用例数 | 已知 debt |
|---|---|---|---|---|
| `src/panoramic/qa/__tests__/*.test.ts`（8 文件）| ① 删除 | 合计 79 用例（69 绿/10 红，10 条集中在 `qa-integration.test.ts` 单点 `node:fs` mock 缺口）| — | 陈旧副本，`1b9a7113` 建立后未再维护 |
| `tests/panoramic/qa/debt-context.test.ts` | ① 移植 2 条 | 未单独测（属 83 用例集合的一部分）| 新增 2 it | 无 |
| `tests/panoramic/qa/index.test.ts` | ① 修回 1 处断言 | 同上 | 1 行改动 | 弱化断言（`>= 0`），FR-001 范围内一并修 |
| `tests/integration/graph-mcp-snapshot.test.ts` | ② 删除 211-262 块 | 290 行 | 删 2 it + 1 const 组 + 1 helper 函数 | 3.7 个月静默 skip（`f9edd13f` 删 fixture 后遗留），本卡处置对象本身 |
| `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` | ② 删 2 孤儿条目 | 765 行 | 删 343/414 行两个 export 块 | 孤儿快照，本卡处置对象本身 |
| `.github/workflows/ci.yml` | ③ 新增 1 步骤 | 114 行 | — | F269 刚改过该文件（Test 步 `VITEST_MAX_FORKS`），并行卡 F270/F271 也可能碰它——见下方风险节 |
| `tests/fixtures/graph-quality-ts-graph/{graph.json,README.md}` | ④ 覆盖重建 | graph.json 为 JSON 冻结产物；README 45 行 | — | 静默陈旧（11 边 vs 实际 14 边），本卡处置对象本身 |
| `tests/integration/graph-quality-lang-matrix.test.ts` | ④ 改 1 处数字 | 194 行 | 8 it（4 describe.each + 4 独立）| 无（本次只改 `expectedEdgeCount: 11→14`）|
| `scripts/regen-collector-fingerprint-fixtures.ts` | ⑤ 放行分支加打印 | 720 行 | 多个导出函数（`compareGraphOnlyStructure`/`compareModuleGraphSnapshot`/`shouldRejectRegen` 等）| 局部缺陷：放行分支丢弃已算好的 `differences`（本卡处置对象），非 LOC 超标问题 |
| `tests/integration/collector-fingerprint-regen-script.test.ts` | ⑤ 新增 1 个端到端用例 | 364 行 | 现有 ≥6 it | 新增用例需构造双变量场景（见决策 4），避免制造新的恒真断言 |
| ⑥ 6 个文件（`cross-project-isolation.test.ts`/`adr-cross-fixture.test.ts`/`hyperedge-first-run.test.ts`/`graph-html-generation.test.ts`/`include-docs-integration.test.ts`/`agent-context-sanitize.test.ts`）| ⑥ it.todo 三分处置 | 未逐一实测，均为中小型测试文件（<400 行量级） | 21 处 `it.todo` 调用点 | `graph-html-generation.test.ts` 附带发现：4 条真实 `it(` 全部同时在 A7 移交清单中，当前整文件零守护力（见风险节）|
| ⑦-B 23 个文件 | ⑦ B 类 35 条就地修 | 未逐一实测（`inventory-item7.md` 已给精确行号）| 35 条断言点 | 见 `inventory-item7.md`，B2（12 条，1 条随①消失）标注"风险最高——静默掩盖回归" |

**前置清理规则判定**：本卡 MUST NOT 修改生产代码（FR-002/全局约束 6），唯一被修改的非测试文件是 `scripts/regen-collector-fingerprint-fixtures.ts`（720 LOC > 500），但本卡对它的新增行数 ≈ 10-15 行（镜像拒绝分支已有的打印格式），远低于 50 行阈值 ⇒ **不触发前置 cleanup task**。其余全部是测试/fixture/CI 资产，不适用"生产代码前置清理"规则。

## Impact Assessment

- **影响文件数**：**49**（8 删除 + 3 新增 + 38 修改），按文件计数口径 > 20 阈值。
- **跨包影响**：主体集中在 `tests/`（单一逻辑包）；额外触及 `scripts/`（1 个文件，`regen-collector-fingerprint-fixtures.ts`，非发布产物，不在 `package.json` 的 `files` 清单内）、`.github/workflows/`（1 个文件，CI 配置）、`src/panoramic/qa/__tests__/`（8 个文件，**删除操作**，非生产逻辑改动）。按"顶层边界"字面计数触及 3 个包外边界（`scripts/`、`.github/`、`src/`），但每一处触及都是叶子级、无下游调用方的独立文件，不构成"深度耦合"。
- **数据迁移**：否——`tests/fixtures/graph-quality-ts-graph/graph.json` 是测试 fixture 的重建覆盖（有 SOP、可重放），不是生产 schema/配置/状态迁移。
- **API/契约变更**：否——三处新增的输出契约（pinned-staleness 状态表、零执行守卫差集报告、fingerprint regen 差异打印）都是面向维护者的诊断输出，不修改任何公共接口、agent prompt 协议或 skill 输入输出。
- **风险等级判定**：**HIGH**（触发条件：影响文件数 49 > 20）。**这是一次"广度触发"而非"深度触发"的 HIGH**——本卡不存在跨模块耦合（spec 复杂度评估已确认"跨模块耦合：否"）、无数据迁移、无公共契约变更，49 个文件里超过 40 个是彼此独立、file-level disjoint 的测试文件小改动。但按本流程的机械判据（影响文件数 > 20 即 HIGH），如实标注为 HIGH，不因"感觉风险不大"而下调评级。
- **HIGH 风险强制分阶段的落地**：拆分为 3 个可独立验证的阶段（对应决策 5 的批次 A/B/C），每阶段写入路径 disjoint、有独立的验证命令与回归判据，见下方"实现阶段划分"一节。

## Constitution Check

*GATE: 已按 `.specify/memory/constitution.md` v2.2.0 逐条评估；无 VIOLATION，无需豁免论证。*

| 原则 | 适用性 | 评估 | 说明 |
|---|---|---|---|
| I. 双语文档规范 | 适用 | 通过 | 本 plan 及后续 research/data-model/quickstart 均中文正文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | 通过 | 本卡走完整 story 模式流程（spec→plan→tasks→implement→verify），未绕过直接改代码 |
| III. 如无必要勿增实体（YAGNI） | 适用 | 通过 | 3 个新组件（③ CI 步骤 / ④ pinned-staleness 检查 / FR-011 零执行守卫）均有当前明确用途；决策 2 显式否决了"micrograd 若本地有 clone 就走可选深检查"这类过度设计分支，保持单一职责；决策 1 显式否决了"把 typecheck:tests 也接进 repo:check"的冗余接入 |
| IV. 诚实标注不确定性 | 适用（核心）| 通过 | ④ 的 pinned-staleness 检查对 Python/micrograd 的"无法验证"结论是显式输出而非静默 skip（F266 教训直接应用）；⑦ 的 A 类 64 条移交清单如实标注"本卡不处置"，不假装已修复 |
| V-VIII（spectra 插件约束）| 部分适用 | 通过/N/A | 本卡不修改 `src/panoramic/` 生产逻辑（仅删除测试副本），不触碰 spectra 分析流水线；④ 新增的 pinned-staleness 检查复用既有 `graph-only` 模式（不新增分析路径），符合原则 VII"只读安全性"精神（不修改目标源代码，只读 fixture + 临时目录重建）|
| IX-XIII（spec-driver 插件约束）| N/A | 不适用 | 本卡不修改 `plugins/spec-driver/` 下的 Prompt/Skill/Hook |
| XIV. 可观测性与架构守护 | 适用（核心）| 通过 | FR-009 的旧名称残留扫描、FR-011 的零执行测试文件守卫，正是本原则"架构劣化必须在产生时被检测"的直接落地；trace/gate 记录由编排器标准流程承担，本卡不新增额外可观测性机制 |

## Project Structure

### Documentation (this feature)

```text
specs/272-test-guard-asset-cleanup/
├── plan.md              # 本文件
├── research.md          # Phase 0 —— 五项技术决策的研究记录
├── data-model.md         # Phase 1 —— 涉及的测试/守护资产实体设计
├── quickstart.md        # Phase 1 —— 验收命令速查
├── contracts/           # Phase 1 —— 三个新增输出契约
│   ├── pinned-graph-staleness-report.md
│   ├── zero-execution-test-file-guard.md
│   └── fingerprint-regen-permit-output.md
├── verified-facts.md    # 已存在（编排器事实基线，含 specify 后追加成本实测）
├── inventory-item7.md   # 已存在（⑦ 99 条虚化断言清单）
└── verification/
    └── baseline-before.md  # 已存在（回归判定对照组）
```

### Source Code（改动落点，无新增顶层目录）

```text
.github/workflows/
└── ci.yml                                          # ③ 新增 1 步骤

scripts/
└── regen-collector-fingerprint-fixtures.ts          # ⑤ 放行分支加打印

src/panoramic/qa/__tests__/                          # ① 整目录删除（8 文件）

tests/
├── panoramic/qa/
│   ├── debt-context.test.ts                         # ① 移植 2 条
│   ├── index.test.ts                                # ① 修回 1 处断言
│   ├── rag-reranker.test.ts                          # ⑦-B2（3 处）
│   └── prompt-builder.test.ts                        # ⑦-B7（1 处）
├── integration/
│   ├── graph-mcp-snapshot.test.ts                    # ② 删除条件跳过块
│   ├── __snapshots__/graph-mcp-snapshot.test.ts.snap # ② 删 2 孤儿快照
│   ├── graph-quality-lang-matrix.test.ts             # ④ 改 expectedEdgeCount
│   ├── graph-quality-pinned-staleness.test.ts        # ④ 新增（FR-004 守卫）
│   ├── collector-fingerprint-regen-script.test.ts    # ⑤ 新增端到端用例
│   ├── zero-execution-test-file-guard.test.ts        # FR-011 新增守卫
│   ├── cross-project-isolation.test.ts               # ⑥ 5 条 it.todo 删除
│   ├── adr-cross-fixture.test.ts                     # ⑥ 4 条 it.todo 删除
│   ├── hyperedge-first-run.test.ts                   # ⑥ 4 条 it.todo 删除
│   ├── graph-html-generation.test.ts                 # ⑥ 4 条 it.todo 改写理由（不碰其 A7 真断言）
│   └── include-docs-integration.test.ts              # ⑥ 3 条 it.todo 改写理由
├── unit/
│   ├── mcp/agent-context-sanitize.test.ts            # ⑥ 1 条改普通注释（F271 潜在接触面）
│   ├── mcp/agent-context-tools-snapshots.test.ts     # ⑦-B1（1 处，F271 潜在接触面）
│   ├── god-node-analyzer.test.ts                     # ⑦-B2
│   ├── surprising-edges.test.ts                      # ⑦-B2
│   ├── code-slice-extractor.test.ts                  # ⑦-B2
│   ├── batch-orchestrator-tsjs-resolve.test.ts       # ⑦-B2
│   └── feature135-codex-followup.test.ts             # ⑦-B3
├── panoramic/
│   ├── product-ux-docs.test.ts                       # ⑦-B2（2 处）
│   ├── anchoring/chunker.test.ts                     # ⑦-B2
│   ├── community-persist.test.ts                     # ⑦-B3（2 处）
│   ├── html-exporter.test.ts                         # ⑦-B4+B5（2 处）
│   ├── obsidian-exporter.test.ts                     # ⑦-B4+B5（2 处）
│   └── html-template.test.ts                         # ⑦-B7
├── extraction/
│   ├── image-extractor.test.ts                       # ⑦-B2+B7（3 处）
│   └── extraction-pipeline.test.ts                   # ⑦-B7
├── kb/ingester.test.ts                                # ⑦-B1
├── e2e/feature-171-file-navigation.e2e.test.ts        # ⑦-B1
├── adapters/{java,python,go}-adapter.test.ts          # ⑦-B6（3 文件）
├── adapters/ts-js-adapter-equivalence.test.ts         # ⑦-B6
├── self-hosting/self-host.test.ts                     # ⑦-B4
└── fixtures/graph-quality-ts-graph/
    ├── graph.json                                     # ④ 覆盖重建（11→14 边）
    └── README.md                                      # ④ 更新人工推导表
```

**Structure Decision**：无新增顶层目录/模块；全部改动落在既有 `tests/`、单一 `scripts/*.ts`、单一 `.github/workflows/ci.yml`，`src/panoramic/qa/__tests__/` 仅整目录删除。

## 五项关键设计决策

### 决策 1：③ typecheck:tests 在 CI 的落点 —— 新增独立 CI 步骤，不接入 repo:check

**方案**：在 `.github/workflows/ci.yml` 中新增一个独立步骤 **`Type Check Tests`**，紧接在既有 `Type Check`（`npm run lint`）之后、`Build` 之前，`run: npm run typecheck:tests`，**不带 `if:` 条件**（沿用 `Type Check` 步骤的默认 `if: success()` 语义）。

**理由**：
1. **不依赖 dist**：三份类型契约资产（F220/F222/F170c）的 `tsconfig` 只 type-only import `src/**/*.ts`（如 `src/batch/batch-orchestrator.js` 的类型声明），不 import `dist/`。因此该步骤可以排在 `Build` 之前执行，无需等待编译产物，符合"越早失败越快"的 CI 设计原则。
2. **位置对齐既有语义分组**：`Type Check`（对 `src/` 的 `tsc --noEmit`）与新增的 `Type Check Tests`（对 `tests/type-tests/` 的 `tsc --noEmit`）是同类操作（纯类型检查，零副作用、零 I/O），放在一起比夹在 `Build`/`Test` 中间更符合"步骤按性质分组"的可读性。
3. **不带 `if:` 条件**：`Repo Check`/`Release Check` 之所以要写 `if: build成功 && graph成功`，是因为它们依赖 `specs/_meta/graph.json`（graph 步骤产物）。`Type Check Tests` 没有这类依赖，默认 `if: success()` 即可——与它前面的 `Type Check` 步骤条件语义一致。
4. **不接入 `repo:check`**：`repo:check`（`scripts/repo-check.mjs` → `validateRepository`）当前是一个**纯 JS 校验族聚合**——15 个子检查族里唯一 spawn 外部产物的是 `graph-quality`（spawn 的是**本项目自己构建的** `dist/cli/index.js`，不是外部编译器工具链）。把 `tsc` 直接接进这个聚合会给它引入一个新的架构性质（"依赖 TypeScript 编译器可用"），且 `repo:check` 的调用面（`prepublishOnly` + CI）本就已经在 `prepublishOnly` 里紧跟在 `npm run build` 之后（该 build 步骤本身就会跑一次 `tsc` 走 `src/` 的 lint），重复接入不增加新的保护面，只增加维护复杂度。FR-003 的字面要求也只是"接入 CI 流程"，不要求接入 `repo:check`。

**并行卡冲突处置**：F269 刚给 `ci.yml` 的 `Test` 步骤加了 `VITEST_MAX_FORKS` 步级 env；F270/F271 也可能改这份文件。本卡的改动是**插入一个全新独立步骤**，不修改任何既有步骤的内容——这把与并行卡的 diff 重叠面降到最低（一次插入操作 vs 修改现有行）。implement 阶段仍需在 push 前 `git fetch` 复核，若发现 `ci.yml` 已被 F270/F271 先行修改，按 CLAUDE.md 交付纪律 rebase 后重新确认插入位置仍然成立（Build Knowledge Graph / Repo Check / Release Check 等步骤的相对顺序未被打乱）。

**变异验证方法**（SC-002 / Edge Case 2）：verify 阶段临时修改 F220/F222/F170c 任一份守护资产**所依赖的类型定义**（例如把 F222 `llm-degraded` 契约里某个 required 字段临时改成 optional），本地跑 `npm run typecheck:tests` 确认报编译错误；确认后立即 `git checkout` 撤销该临时改动（不进入本卡的最终 diff，仅作为验证过程，符合"不动生产代码"的最终交付约束——该约束管的是本卡的已提交 diff，不管验证过程中的临时改动+撤销）。三份守护资产（F220/F222/F170c）逐一做一次，不允许"验完一份就代表三份都好"。

### 决策 2：④ pinned 陈旧守卫 —— 独立 vitest integration test，动态探测 + 静态分类双轨诚实设计

**方案**：新增 `tests/integration/graph-quality-pinned-staleness.test.ts`（独立文件，不并入 `graph-quality-lang-matrix.test.ts`）。

**为什么独立文件而非合并**：`graph-quality-lang-matrix.test.ts` 断言的是"pinned 文件自身的手推数值是否正确"（fixture-value 正确性）；新守卫断言的是"pinned 文件是否仍代表当前 builder 的行为"（fixture-freshness）。这是两种不同的失败语义——前者红了说明 README 手推错了或 fixture 被误改，后者红了说明 builder 行为变了但没人同步 fixture。合并到一个文件会让这两类失败信号混在一起，增加未来排查成本；分开也降低了两个文件的 diff 耦合面（decision 5 的 batch 切分因此更干净）。

**语言 → 数据源分类（静态声明，与"运行时是否可验证"解耦）**：

```ts
const FIXTURE_SOURCE_CLASSIFICATION = {
  'TS/JS': 'in-repo',
  Java: 'in-repo',
  Go: 'in-repo',
  Python: 'external-clone',
} as const;
```

这份分类表是**结构性事实**（这份 fixture 的源码放在哪里），不随运行环境变化。它承担"防止未核验集合悄悄变大"的职责：断言 `Object.entries(FIXTURE_SOURCE_CLASSIFICATION).filter(([,v]) => v === 'external-clone').map(([k]) => k)` 恒等于 `['Python']`——将来若有人新增一份依赖外部 clone 的语言 fixture却忘了在此声明，它会被默认当作 `in-repo` 处理，进而因为找不到仓内源码目录而在"每一份 in-repo fixture 都必须 verified 且零 diff"这条断言下**当场失败**，逼迫维护者显式声明分类，而不是让"未核验集合"静默扩大。

**运行时状态判定（动态探测，不是硬编码"Python 恒 unverifiable"）**：
- `in-repo` 语言（TS/JS、Java、Go）：MUST 能在任何环境重建（源在 `tests/fixtures/graph-quality-{ts,java,go}/`），MUST 断言 `status === 'verified' && differences.length === 0`，无条件路径，不允许因任何原因降级为 skip。
- `external-clone` 语言（Python）：运行时探测 `~/.spectra-baselines/micrograd`（或 `SPECTRA_BASELINE_HOME` 覆盖路径）是否存在：
  - 不存在 → `status = 'unverifiable:external-source'`，输出必须包含具体缺失路径的诊断信息（不是空泛的"跳过"）。
  - 存在 → 实际重建 + 对比 `tests/fixtures/micrograd-baseline-graph/graph.json`（该 pinned 文件已存在，被 `graph-quality-lang-matrix.test.ts` 消费），得到 `verified`（零差异）或 `stale`（有差异，测试 FAIL 并打印具体差异，不允许静默通过）。

  选择"动态探测"而非"硬编码 Python 恒不可验证"，是因为 spec 的 Acceptance Scenario 3 原文是"**当前环境（如 CI）没有该 clone** 时"才要求输出无法验证声明——隐含"若环境里有 clone 就应该真的去验证"，这与 F266 教训（诚实反映"能不能测"，而不是把"暂时测不了"伪装成固定结论）一致；硬编码会在本地开发机（已按 `CLAUDE.local.md` 约定 clone 了 baseline）上制造一个"明明能测却假装测不了"的诚实性倒退。

**Diff 逻辑复用，不重新实现**：三个 `in-repo` 语言与 Python（clone 存在时）的结构 diff 复用 `scripts/regen-collector-fingerprint-fixtures.ts` 已导出的 `compareGraphOnlyStructure(rebuilt, pinned)`（该文件已有 `invokedDirectly()` 守卫，import 时不触发 CLI 主流程，可安全在 vitest 测试里 import）。重建命令：`node dist/cli/index.js batch <tmp-copy-of-fixture-source> --mode graph-only --output-dir <tmp-out>`（与各 README 现有 SOP 一致），dist 已由 `tests/global-setup.ts` 保证构建完成，无需在测试内重复触发 build。三次仓内重建实测合计 ~0.86s，无需缓存/采样/条件跳过。

**成本不是约束条件**：< 1.2s 增量对现有测试面（vitest 全量 ~400s）可忽略，不因"省这 0.86s"引入任何条件跳过或缓存层——那正是 F266 记过的坑（缺图静默 skip、CI 照绿）的同构陷阱。

**输出契约**：见 `contracts/pinned-graph-staleness-report.md`。

**变异验证方法**（SC-003 point 4）：verify 阶段临时把 `tests/fixtures/graph-quality-ts-graph/graph.json` 改回旧的 11 边版本（在完成④正式的 14 边覆盖之后，临时 `git stash` 式验证或用副本），重跑新守卫，确认报告 `status: 'stale'` 且列出 `边计数不一致（重建 5 vs pinned 2）: xxx|calls|xxx` 这类具体差异；确认后恢复为正式的 14 边版本再提交。全程不触碰 builder 生产代码，只操作 pinned 数据文件本身（这正是被测对象），不违反"不动生产代码"约束。

### 决策 3：FR-011 零执行测试文件守卫 —— vitest 内 spawn `vitest list`，全仓扫描面 + 白名单管"文件"不管"目录"

**方案**：新增 `tests/integration/zero-execution-test-file-guard.test.ts`。

**扫描面 MUST 是全仓 `**/*.test.ts`（排除 `node_modules`/`dist`/`.git`），不得写死 `find src tests`**：当前 `.test.ts` 分布确为 `src/`（21 个）+ `tests/`（530 个）= 551，`find src tests` 今天恰好覆盖全部——但这是把"今天的目录布局"固化成判据。本仓 F259 已记过"判据写窄了，每加一个新形态就漏一次"的教训：将来若有人在别的顶层目录（如 `scripts/__tests__/`）新建游离测试文件，`find src tests` 看不见，缺陷照样复发而守卫还在报绿。因此磁盘侧枚举 MUST 用不预设目录白名单的全仓 glob。

**vitest 收集集合的权威事实源是 `npx vitest list --filesOnly`，不得自行解析 `vitest.config.ts` 重新实现 include 匹配**：自行解析等于重新实现 vitest 的文件解析逻辑，会随 vitest 升级漂移，守卫本身反而变成新的失真源。协调器已实测该命令 **0.28s、exit 0、不触发 globalSetup**（不连带跑 dist 构建），在 vitest 测试内部 spawn 它是安全的：子进程独立、不共享 worker 池、返回极快。output 格式为 `[project] path/to/file.test.ts`，解析规则：按行提取 `(src|tests)/.+\.test\.ts` 子串（不依赖 `[project]` 前缀的具体项目名，避免未来新增/重命名 project 破坏解析）。

**白名单管的是"允许零执行的文件"，不是"允许被扫描的目录"——这两件事不能混**：扫描面是全仓无差别 glob；白名单是一份显式的文件路径清单，每条 MUST 带一句"为什么它可以零执行"的理由。当前唯一一条：

```ts
const ZERO_EXECUTION_WHITELIST = [
  {
    path: 'tests/fixtures/graph-quality-ts/greeter-service.test.ts',
    reason: 'TS/JS pinned graph fixture 的输入语料（被 spectra 的 graph-only 构建器当作"目标项目源码"解析），不是待执行的 vitest 测试文件；有意不落在任何 project 的 include 范围内',
  },
] as const;
```

守卫断言：`diskSet - vitestCollectedSet` 恰好等于 `ZERO_EXECUTION_WHITELIST` 的路径集合（顺序无关，多一条少一条都失败），且失败信息里打印具体的意外差集条目路径。

**"自己调自己"形态的显式确认**：本设计在 vitest 测试进程内 spawn 一个新的 `vitest list` 子进程。协调器已实测该形态安全（0.28s、独立子进程、不触发 globalSetup），plan 层面显式确认这个形态可接受，不改用"自行解析 include 配置"的替代路线（该路线已被协调器明确排除，理由见上）。

**守卫的域边界（诚实声明，不夸大覆盖）**：本守卫覆盖的是 **vitest 域**（`*.test.ts`，vitest 五个 project 的收集范围）。`plugins/**/*.test.mjs`（约 162 个用例，由 `npm run test:plugins` 走独立的 `scripts/run-plugin-tests.mjs` runner，不经过 vitest）**不在本守卫覆盖范围内**。plan/tasks/quickstart 中涉及本守卫的描述一律显式标注"仅覆盖 `.test.ts`/vitest 域"，不得让读者误以为它也管 mjs 面。mjs 面的"零执行测试文件"问题（如果存在）是本卡范围外的独立问题，不在 FR-011 之内。

**变异验证方法**（SC-001 Independent Test 3 / SC-009）：verify 阶段临时创建一个不在任何 include 范围内的探针文件（例如 `src/panoramic/qa/__zzz-mutation-probe.test.ts`，内容为一个 trivial `it('probe', () => {})`），重跑守卫确认失败且差集列表中包含该探针路径；删除探针文件后重跑确认恢复通过。

**输出契约**：见 `contracts/zero-execution-test-file-guard.md`。

### 决策 4：⑤ fingerprint regen 放行分支 —— 打印差异 + 新增双变量场景端到端用例（避免制造新的恒真断言）

**代码改动**：`scripts/regen-collector-fingerprint-fixtures.ts` 第 588-591 行的放行分支打印之后，追加与拒绝分支（第 576-578 行）同样格式的逐条打印：

```ts
for (const difference of [...aTrack.differences, ...bTrack.differences]) {
  console.log(`[regen]   - ${difference}`);
}
```

仅在 `aTrack.mismatch || bTrack.mismatch` 为真时才打印（复用已有的 `contentMismatch` 判断），无差异场景下不新增任何输出行——满足 SC-004"无差异场景下输出不新增冗余信息"。

**必须处理的陷阱（已被协调器指出）**：`tests/integration/collector-fingerprint-regen-script.test.ts:157` 现有的放行端到端用例用"两份资产同时降级 `behaviorVersion`"构造放行场景——这个场景 `fingerprintUnchanged=false` 成立，但**没有改动 fixture 源码**，重建产物与 pinned 大概率**完全一致**（`contentMismatch` 极可能为 false）。若直接在这条既有用例上追加"断言输出包含差异内容"，实际 `differences` 是空数组，断言必然恒假（新 bug）；若改用宽松匹配（如 `not.toContain`），又会退化成恒真断言（正是本卡 ⑦ 要治理的病）。

**处置**：implement MUST 新增一个**独立的**测试用例（不是修改既有的 157 行用例），同时满足两个变量：
1. **让重建产物真的与 pinned 不同**：在 `stageFixtureRoot()` 产出的临时目录里，对 `src/ts/foo.ts`（或任一现有源文件）做一处会改变图结构的最小编辑（例如新增一个可被 AST 解析到的顶层导出函数），使 `compareGraphOnlyStructure` 计算出非空 `differences`。
2. **同时让指纹变化**：复用已有的 `downgradeBehaviorVersionInBothAssets()` 辅助函数，确保 `fingerprintUnchanged=false`（否则会落入拒绝分支，那条路径本来就会打印差异，测不出放行分支的新增行为）。

断言 MUST 落到**具体差异内容**，直接引用 `compareGraphOnlyStructure` 已知的确定性文案格式（如 `节点仅存在于重建产物: <id>` 或 `边计数不一致（重建 X vs pinned Y）: <key>`），而不是仅断言"输出里含 differences 这个词"这类空泛匹配。

**变异验证**（SC-004 / FR-005 的守护力证明）：临时删掉刚新增的打印循环，重跑该新用例，确认断言变红；恢复后确认转绿。这是⑤唯一能证明"打印确实发生了"而非"恰好本来就有别的输出满足了宽松断言"的方式。

**输出契约**：见 `contracts/fingerprint-regen-permit-output.md`。

### 决策 5：implement 阶段并行切分 —— 三批次，写入路径全 disjoint

沿用协调器初步设想的批次划分（① + ② / ③ + ④ + ⑤ / ⑥ + ⑦），逐一核对写入路径无重叠后确认可行；HIGH 风险判定要求的"强制分阶段、每阶段独立验证点"由这三个批次天然承担。

**批 A（① + ②）— 写入路径**：
- 删除：`src/panoramic/qa/__tests__/{citation,debt-context,graph-retriever,index,llm-caller,prompt-builder,qa-integration,rag-reranker}.test.ts`（8 文件）
- 修改：`tests/panoramic/qa/debt-context.test.ts`、`tests/panoramic/qa/index.test.ts`
- 新增：`tests/integration/zero-execution-test-file-guard.test.ts`
- 修改：`tests/integration/graph-mcp-snapshot.test.ts`（删 211-262 行块）
- 修改：`tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap`（删 343/414 行两个孤儿条目）

**批 A 独立验证点**：`npx vitest run --project unit tests/panoramic/qa`（期望 85 passed）+ `npx vitest run tests/integration/graph-mcp-snapshot.test.ts tests/integration/zero-execution-test-file-guard.test.ts` + 全仓 grep `panoramic/qa/__tests__` 确认仅剩 `specs/src.spec.md`（生成产物，排除提交）与 `specs/132-reading-ux/tasks.md`（历史制品，保持原样）+ grep `self-dogfood-graph_god_nodes`/`self-dogfood-graph_query` 无残留。

**批 B（③ + ④ + ⑤）— 写入路径**：
- 修改：`.github/workflows/ci.yml`（新增 1 步骤）
- 修改：`tests/fixtures/graph-quality-ts-graph/graph.json`、`tests/fixtures/graph-quality-ts-graph/README.md`
- 修改：`tests/integration/graph-quality-lang-matrix.test.ts`（`expectedEdgeCount: 11→14`）
- 新增：`tests/integration/graph-quality-pinned-staleness.test.ts`
- 修改：`scripts/regen-collector-fingerprint-fixtures.ts`（放行分支打印）
- 修改：`tests/integration/collector-fingerprint-regen-script.test.ts`（新增 1 个端到端用例）

**批 B 独立验证点**：`npm run typecheck:tests`（本地 exit 0 + 决策 1 的临时变异验证）+ `npx vitest run tests/integration/graph-quality-lang-matrix.test.ts tests/integration/graph-quality-pinned-staleness.test.ts tests/integration/collector-fingerprint-regen-script.test.ts` + `ci.yml` 走 F269 惯例（报告先落盘 + PENDING 节，真实 CI run 回填）。

**批 C（⑥ + ⑦-B）— 写入路径**：
- ⑥：`tests/integration/{cross-project-isolation,adr-cross-fixture,hyperedge-first-run,graph-html-generation,include-docs-integration}.test.ts`、`tests/unit/mcp/agent-context-sanitize.test.ts`
- ⑦-B（23 文件）：`tests/unit/mcp/agent-context-tools-snapshots.test.ts`、`tests/kb/ingester.test.ts`、`tests/e2e/feature-171-file-navigation.e2e.test.ts`、`tests/unit/{god-node-analyzer,surprising-edges,code-slice-extractor,batch-orchestrator-tsjs-resolve,feature135-codex-followup}.test.ts`、`tests/panoramic/qa/{rag-reranker,prompt-builder}.test.ts`、`tests/panoramic/{product-ux-docs,community-persist,html-exporter,obsidian-exporter,html-template}.test.ts`、`tests/panoramic/anchoring/chunker.test.ts`、`tests/extraction/{image-extractor,extraction-pipeline}.test.ts`、`tests/adapters/{java-adapter,python-adapter,go-adapter,ts-js-adapter-equivalence}.test.ts`、`tests/self-hosting/self-host.test.ts`

**批 C 独立验证点**：`npx vitest run`（todo 计数从 21 降至 **7**，见下方"必须执行的修正项"）+ B 类 35 条逐条变异验证（见下方 B 类切分小节）。

**批次间 disjoint 核对结论**：三批合计 49 个文件路径，两两交集为空。核对方法：批 A 只碰 `src/panoramic/qa/__tests__/*`（整目录删除，批 B/C 均不涉及该路径）+ `tests/panoramic/qa/{debt-context,index}.test.ts`（批 C 的 ⑦-B2 只碰同目录下的 `rag-reranker.test.ts`/`prompt-builder.test.ts`，文件级不重叠）+ `tests/integration/graph-mcp-snapshot.test.ts`（批 B/C 的 `tests/integration/` 改动是另外 7 个不同文件名，无重叠）。⑥ 提到的"`graph-html-generation.test.ts` 与 ⑦-A7 同文件"不构成冲突——A7 是移交清单条目，**本卡不对其代码做任何改动**，⑥ 在该文件里只碰 4 条 `it.todo` 的阻塞理由文案，不触碰 A7 涉及的 4 条真实 `it()` 断言（见下方"高风险文件的写入范围收窄"）。

**高风险文件的写入范围收窄（F271 潜在接触面 + 同文件双重身份）**：

1. `tests/unit/mcp/agent-context-sanitize.test.ts`（批 C ⑥ 处置对象）与 `tests/unit/mcp/agent-context-tools-snapshots.test.ts`（批 C ⑦-B1 处置对象）都落在 `tests/unit/mcp/` 目录下。该目录不在本卡 FR-010 的字面禁令（`src/mcp/`）内，但并行卡 **F271（产品表面清扫，含 lineRange 死功能）** 大概率会改 `src/mcp/` 的行为并连带改其测试，存在 rebase 冲突可能。implement MUST 对这两处做**最小行级改动**（`agent-context-sanitize.test.ts:142` 仅把 `it.todo` 改普通注释；`agent-context-tools-snapshots.test.ts:150` 仅删除 `expect(true).toBe(true)` 占位 it），不得顺手整理同文件其它内容，降低 rebase 冲突面。
2. `agent-context-tools-snapshots.test.ts` 同时是 ⑦-A3 的移交对象（10 条 grep 式断言，L58/L68 尤弱）——**A 类已裁决移交给后续卡，本卡不动**。implement/tasks MUST 确保只处理 B1 那 1 条占位断言（第 150 行），不得把 A3 的 10 条混入本卡范围（否则与 spec FR-008"A 类本卡不改动代码"矛盾）。
3. `tests/integration/graph-html-generation.test.ts` 是 ⑥（4 条 it.todo 改写理由）与 ⑦-A7（4 条真实 `it()` 全部是 grep 式虚化断言，`buildHtmlTemplate` 是纯函数、改造成本极低，收益是把整文件从零守护力变为有效）**两卡共同的接触点**。本卡对该文件**只做 ⑥ 的 todo 理由改写**（阻塞理由从"待 Phase 1a fixture 落地"改为"待有人写 mock-LLM 集成用例填充"），**不碰**那 4 条 A7 真实断言——避免同一文件在本卡与移交卡里各改一次、互相踩脚。A7 应作为 A 类移交清单里的**最高优先级**条目标注（已在 `inventory-item7.md` A7 行有坐标，本 plan 不重复其内容，仅在此处强调优先级排序供后续卡参考）。

### ⑦ B 类 35 条的切分与变异验证方法（决策 4 附属设计）

按子类分组（用 `inventory-item7.md` 的 B1-B7 分类），每组的机械修法与变异验证方法：

| 子类 | 条数（扣除随①消失的部分）| 修法 | 变异验证方法 |
|---|---|---|---|
| B1 占位断言 | 3 | 删除或转 `it.todo` | 确认删除/转换后该用例不再出现在 vitest 正式断言报告里；覆盖面来自同文件其它真实用例，跑该文件全量确认无回归 |
| B2 条件恒假（★ 风险最高）| 11（12 条中 1 条随①消失）| 前置一条 `length`/存在性断言，钉死具体数值而非用 `>=` 放水 | **每条**都做：临时把该用例的输入 fixture/mock 改造成只产出 0-1 个满足原条件的元素（复现旧实现在稀疏结果下"条件为假、断言从不执行"的静默通过场景），确认新增的前置断言会先行报错并给出诊断信息；随后恢复正常 fixture，确认转绿。全程只改测试侧的输入构造，不触碰生产代码 |
| B3 测试验证自己写的代码 | 3 | 改为调用生产持久化/中和逻辑的真实函数，或删除 | 验证修改后用例确实调用了目标函数（可用 `vi.spyOn` 断言调用发生，或临时把生产函数体替换为直接 throw，确认新用例会红）|
| B4 数值恒真 | 3（5 条中 1 条随①消失、1 条随①移植修回）| `>= 0` 收紧为 `> 0` 或改类型/存在性断言 | 临时把断言改回 `>= 0`，确认无法检测"实现退化为恒返回 0"的场景（论证收紧的必要性）；恢复 `> 0` 后确认转绿 |
| B5 无 throw 路径断言 | 3 | 改为断言具体返回值/降级文案 | 临时改回 `not.toThrow()`，确认无法检测"返回值内容错误但不抛异常"的场景；恢复具体值断言后确认转绿 |
| B6 静态 import 对象 `typeof` 检查 | 4 | 整条 `it` 删除（同文件已有真实 `analyzeFile()` 调用用例覆盖）| 验证同文件保留的真实调用用例在被测适配器构造函数临时改为 throw 时会失败（验证后立即撤销该临时改动，不进入最终 diff）|
| B7 名实不符 | 4 | 断言改为验证用例名承诺的具体内容 | 临时把新断言改回原弱断言（`toBeTruthy()`），确认无法检测目标字段值错误的场景；恢复具体断言后确认转绿 |

**合计**：3+11+3+3+3+4+4 = 31 条独立处置 + 1 条已随①移植修回（`qa/index.test.ts` durationMs）+ 2 条已随①目录删除自动消失（`src/panoramic/qa/__tests__/{rag-reranker,index}.test.ts` 内部条目，非 `tests/` 侧）= 35 条（清单原文小计口径），逐条与 `inventory-item7.md` 的坐标核对一致。

## 必须执行的修正项（implement 阶段处理，本 plan 阶段不直接改 spec.md）

**spec.md 的 SC-006 与"裁决记录⑥可观测效果"段落存在算术错误**：两处均写"todo 计数从 21 降至 **8**"，但按逐条计数应为 **7**（13 条删除 + 7 条保留 + 1 条改注释 = 21；保留为 todo 的只有 7 条，"0 误用"这句注解本身就说明误用那 1 条不再计入 todo，7 + 0 = 7 而非 8）。

implement 阶段 MUST 将以下两处由 `8` 改为 `7`：
1. `spec.md` SC-006："vitest 报告中的 todo 计数从 21 降至 8" → "...降至 7"
2. `spec.md` 裁决记录⑥"可观测效果"："todo 计数由 23...降至 8（7 条保留 + 0 误用...）" → "...降至 7（7 条保留 + 0 误用...）"

verify 阶段的客观可观测量：处置完成后 `npx vitest run` 汇总行的 `todo` 计数 MUST 为 **7**（基线 `baseline-before.md` 记录为 21）。tasks.md 与 verify 报告一律使用 7，不沿用 spec.md 修正前的 8。

## Complexity Tracking

*无 Constitution Check VIOLATION，本节记录 3 个新增组件相对于"零新增组件"基线方案的复杂度理由（响应 spec 复杂度评估"建议 GATE_DESIGN 对新增组件做一次人工复核"）。*

| 新增组件 | 为什么需要 | 更简单的替代方案为何被否决 |
|---|---|---|
| ③ CI 新增 `Type Check Tests` 步骤 | 三份已存在的类型契约守护资产（F220/F222/F170c）当前对任何改动零阻力，是纯摆设；FR-003 要求接入 CI | 「扩大根 `tsconfig.json` 的 `include` 覆盖 `tests/type-tests/`」被否决：会把整个 `tests/` 纳入 `npm run lint` 的 tsc 编译面，产生大量与本卡无关的新增类型错误噪声（`tsconfig.json:46` 的 `exclude: "tests"` 是有意为之的边界，见 `verified-facts.md` ① 附带发现）|
| ④ `graph-quality-pinned-staleness.test.ts` | pinned graph fixture 会静默陈旧且测试仍全绿（本卡揭示的最典型虚假覆盖信号），需要一个独立于"数值正确性断言"的"新鲜度断言" | 「只更新 TS 的 14 边数字，不装新守卫」被否决：只解决"这一次"，下一次 builder 行为变化时会重演同样的静默陈旧；「把陈旧检测塞进 `graph-quality-lang-matrix.test.ts` 现有 `describe.each`」被否决：会混淆"数值对不对"与"数值新不新"两种失败语义 |
| FR-011 `zero-execution-test-file-guard.test.ts` | ① 修复的"测试文件游离于执行范围外"问题若不装守卫会无声复发（spec 明确要求"为会复发的类别装上守卫"，不只是一次性清淤）| 「只删 8 个陈旧副本，不装守卫」被否决：直接违反 FR-011 的字面要求；「自行解析 `vitest.config.ts` 重新实现 include 匹配」被否决：重新实现 vitest 内部逻辑会随版本升级漂移，守卫本身变成新的失真源（协调器已明确排除此路线）|

`③` 与 `④`/FR-011 的差异（决策 1 vs 决策 2/3）也是一种一致性决策：只有真正无法被现有 vitest Test 步骤覆盖的检查（`tsc` 类型检查）才新增独立 CI 步骤；能装进 vitest 域内的检查（④/FR-011）一律做成 vitest 测试，复用现有的 CI Test 步骤门禁，不额外扩大 `ci.yml` 的改动面——这也是给 F270/F271 的并行冲突面做的主动收窄。
