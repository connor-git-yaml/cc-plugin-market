---
feature: 157
title: "修复 SC-008 self-dogfood graph 连通率：import-resolver 扩展"
branch: "157-fix-self-dogfood"
created: 2026-05-09
status: Closed-NotImplemented
closed_reason: "R-1 调研发现 self-dogfood sc008Rate 现状已 96%（远超 70% 目标），Feature 152 ship 后由 0a8137d / fe6ad3b / cf0a131 (Feature 156) 间接修复完成。详见 research.md 第 5 节 scope-change decision。"
mode: story
research_basis: "[R-1 调研发现现状已达标] — 见 research.md"
---

# Feature Specification: 修复 SC-008 self-dogfood graph 连通率

**Feature Branch**: `157-fix-self-dogfood`
**Created**: 2026-05-09
**Status**: Draft
**关联 Feature**: Feature 152（TypeScript callSites + 通用 Import Path 智能解析）

---

## 背景与术语澄清

Feature 152 ship 时存在一项部分达标条目：

- **SC-008**（`new Foo() → class Foo` graph 连通率）：hono 100% ✅ / self-dogfood **32%** ⚠️

> **重要**：用户描述中的 "fillRate 32%" 实际指的是 **SC-008 sc008Rate**（`new Foo()` 调用点到目标 class 节点的图连通率），**不是** SC-001 fillRate（SC-001 双 target 均为 100%，已达标）。本 spec 全文统一用 `sc008Rate` 指代这一指标。

Feature 152 verification-report 提出三条**假设性根因**（generator 注册系统嵌入 / errors.ts 集中 export / verify label-only 宽松匹配），其中 hono 100% 仅证明 verify 在扁平场景下正确，**并未排除测量逻辑在 self-dogfood 深嵌套场景下的系统性偏差**。本 Feature 通过 R-1 多路径调研同时证伪/证实三条假设，再决定修复方向。

本 Feature 的**初始假设方向**是扩展 `src/knowledge-graph/import-resolver.ts` 解决 68 个漏判，将 self-dogfood `sc008Rate` 从 32% 提升至 ≥ 70%。**最终修复方向以 R-1 调研数据为准**：若调研证伪 import-resolver 是主因，则按下方 R-1 降级策略处理。

---

## R-1 调研前置约束

在动代码之前，**必须先量化漏判分布**，数据驱动地确定修复优先级。R-1-A 调研对 68 条 false-negative 必须**三视角**分类（避免 import-resolver 视角偏置）：

| 调研项 | 方法 | 期望产出 |
|--------|------|---------|
| R-1-A | 对 `sc008Rate` 测量结果中 false-negative 的 68 条条目，**逐条**输出三列分类：(1) **resolver 视角**：barrel-chain / path-alias-miss / type-only / dynamic-import / resolved-correctly；(2) **graph-edge 构建视角**：calls-edge-emitted / calls-edge-missing / wrong-target；(3) **verify matcher 视角**：label-match-pass / label-mismatch / generator-registry-indirect / other | 三视角 traceable checklist：每条 false-negative 有 id + 三视角分类 + 预期修复路径 + 对应测试断言（I-2 修复） |
| R-1-B | 确认 `src/knowledge-graph/import-resolver.ts` 中 barrel 链追踪现状（`export * from`、`export { X } from`、`export type { X } from`、`export * as ns from` 是否有多跳能力，以及 external re-export 处理） | 能力缺口清单 |
| R-1-C | 确认 path alias 覆盖情况（`@core/*`、`@graph/*` 等 7 个 alias 在当前 resolver 中的命中率） | 命中/未命中清单 |
| R-1-D | 测量 R-1-A 中 barrel 链的实际最大深度（避免 W-7 中"10 层"无证据支撑） | 实测最大深度 + 95 分位深度 |

**R-1 降级策略（C-2 修复）**：

R-1 调研可能输出三类结论之一：

1. **结论 A — 根因主要在 import-resolver**（resolver 视角占主导，且 graph-edge / verify matcher 视角占比小）→ 按本 Feature 计划执行，FR-008 scope 锁定 `src/knowledge-graph/import-resolver.ts`。
2. **结论 B — 根因主要在 verify matcher 或 graph 构建**（≥ 50% false-negative 由 verify matcher / graph-edge 视角解释）→ **停止本 Feature 实施**，向用户提交 **scope-change decision**，由用户决定：(a) 重开新 Feature 修复 verify-feature-152.mjs；(b) 关闭 SC-008 self-dogfood 部分达标项作为 known issue；(c) 扩大本 Feature scope（需用户明确授权 + 修订 FR-008）。**本 Feature 不允许在原 scope 下修改 verify 脚本或 adapter/mapper/unified-graph**。
3. **结论 C — 根因混合**（import-resolver 占 20-50%）→ 在本 Feature scope 内修 import-resolver 能贡献的部分，剩余部分计入 follow-up Feature。本 Feature 验收门槛允许调整为 R-1 数据预测的可达上限（不强行追求 70%，见 W-6 修复的 SC-1 二级裁定）。

---

## User Scenarios & Testing

### User Story 1 — self-dogfood sc008Rate 提升至 ≥ 70%（Priority: P1）

作为 Spectra 的维护者，我希望 Feature 152 的 SC-008 验收指标在本仓库（self-dogfood）上也能达到可接受水平（≥ 70%），从而证明 `new Foo()` → class 图连通能力在复杂 monorepo 场景下同样有效，而不仅限于 hono 这类相对扁平的项目。

**Why this priority**：这是本 Feature 的核心交付目标，所有其他 User Story 都服务于这一目标。

**未达标二级裁定路径（W-6 修复）**：

- 若实测 sc008Rate ∈ [50%, 70%)：进入"部分改善"裁定。R-1 数据若证明 70% 需要修改 scope 外组件（verify-feature-152.mjs / unified-graph / adapter），则**本 Feature 以实测值合并**，剩余差距计入 follow-up Feature；不强行扩大 scope。
- 若实测 sc008Rate < 50%：本 Feature **不可合并**，必须回到 R-1 重新分析。
- 若 R-1 调研结论为"结论 B"（根因不在 import-resolver scope）：直接进入 scope-change decision 流程，本 Feature 不实施代码改动。

**Independent Test**：在 self-dogfood 项目根目录执行 `node scripts/verify-feature-152.mjs --target ./src --metric sc008`，结果 `sc008Rate ≥ 0.70`（即 ≥ 70/100）即为独立可测。

**Acceptance Scenarios**:

1. **Given** Feature 152 当前代码基线（self-dogfood sc008Rate = 32/100 = 32%），**When** 扩展 `src/knowledge-graph/import-resolver.ts` 后重跑 verify，**Then** `sc008Rate ≥ 0.70`（≥ 70 hits / 100 truth-set 条目）。

2. **Given** 扩展后的 import-resolver，**When** 对 self-dogfood 中通过 barrel re-export 导出的 Generator class（如 `ArchitectureOverviewGenerator` via `src/panoramic/index.ts`）执行 `new X()` 调用的图连通查询，**Then** 该 class 节点与调用点通过 calls 边正确连通。

3. **Given** 扩展后的 import-resolver，**When** 被调 class 位于 `src/core/query-mappers/index.ts` 这类 barrel 再导出文件后方，**Then** resolver 能透过 barrel 层追踪到实际 class 定义文件，形成有效 graph edge。

---

### User Story 2 — 量化根因分布（Priority: P2）

作为 Spectra 的维护者，我希望在修复代码之前，能够看到 68 条 false-negative 的具体分类数据（barrel/alias/type-only/其他各占多少），以便数据驱动地决定修复哪些场景、忽略哪些场景（YAGNI 原则）。

**Why this priority**：没有根因数据就贸然修复 import-resolver 的所有可能场景，会引入不必要的复杂度。P2 是 P1 的数据基础，但也可独立交付（输出一份分类报告）。

**Independent Test**：plan.md 的 R-1 章节包含 68 条 false-negative 的分类占比数据，可独立阅读验证。

**Acceptance Scenarios**:

1. **Given** verify-feature-152.mjs 输出的 false-negative 列表，**When** 逐条追踪 import-resolver 解析路径，**Then** 每条都被归类为 barrel-chain / path-alias-miss / type-only / dynamic-import / graph-label-mismatch 之一。

2. **Given** 分类结果，**When** 某类占比 < 5 条（< 7% of 68），**Then** 该类标注为低优先级或 [YAGNI-移除]，不在本 Feature 中实现。

---

### User Story 3 — hono 及其他维度无回归（Priority: P3）

作为 Spectra 的维护者，我希望扩展 import-resolver 后，Feature 152 已验收的所有指标（hono sc008Rate 100%、SC-001/002/003/006）不出现退步，现有全量单测继续 pass。

**Why this priority**：无回归是底线约束，但不是本 Feature 的交付价值本身，因此排 P3。

**Independent Test**：执行 `npx vitest run` 零失败 + `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src` 各指标 ≥ ship 数字，可独立验证。

**Acceptance Scenarios**:

1. **Given** 扩展后的代码，**When** 执行 `npx vitest run`，**Then** ≥ 3459 单测 pass（含 import-resolver 新增 ≥ 6 单测），zero failures。

2. **Given** 扩展后的代码，**When** 执行 `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src`，**Then** hono sc008Rate = 100%，SC-001/002/003/006 各指标与 Feature 152 ship 数字持平或更优。

3. **Given** 扩展后的代码，**When** 执行 `npm run build`，**Then** TypeScript 类型检查零错误。

---

### Edge Cases

- **barrel 循环引用**：`A re-export B` 且 `B re-export A` 的循环 barrel 链。resolver 在追踪多跳时必须检测已访问路径，避免无限循环。关联 FR-003。

- **tsconfig.json 不存在或格式异常**：resolver 在无法找到 tsconfig.json 时必须降级为仅 baseUrl 解析（延续 Feature 152 当前行为），不抛异常。关联 FR-001。

- **barrel 文件同时包含 `export *` 和 `export { X }`（W-4 修复）**：解析 barrel 链时两种形态需要都覆盖；当 `export *` 中传递的符号与 `export { X }` 显式命名冲突时，**显式命名 re-export 优先**（TS spec 标准行为）。多个 `export *` 之间产生同名冲突时返回 `kind: unresolved` 而非任意命中。`export { default as X } from './x'` 视为命名 re-export。关联 FR-003。

- **path alias 与 barrel 串联**：`@panoramic/*` → `src/panoramic/index.ts`（barrel）→ 实际类文件，需要先解析 alias 再追踪 barrel 链（两步串联）。关联 FR-001 + FR-003。

- **external re-export（W-5 修复）**：barrel 链中遇到 `export { X } from 'pkg'` 或 `export * from 'pkg'`（pkg 是 npm 包）时，**必须停止本地追踪，返回 `kind: external`**，不进入 node_modules 递归。Edge case 测试覆盖：`export { jsonStringify } from 'safe-stable-stringify'` 类场景。关联 FR-003。

- **type-only import 对 barrel 追踪的干扰（W-3 修复）**：barrel 链追踪时**显式识别 `export type { Foo }` 和 `import type { Foo }`** 语句，作为内部"链路定位提示"使用，但 resolver 返回的 `ResolveResult` 字段中**不区分 type-only**（不新增 kind 值），由 caller 自行判断是否消费 type-only 解析结果。Invariant 单测覆盖：type-only 解析结果不被 caller 写入 graph calls/import edge。此场景是否真实存在须由 R-1-A 调研确认。关联 FR-004（MAY）。

- **动态 import 混入 barrel 文件**：`import('./module')` 出现在 barrel 文件中时，追踪逻辑应跳过该语句而非中止整个链追踪。关联 FR-005（MAY）。

- **多个 tsconfig.json 嵌套（monorepo）**：本仓库根目录有 tsconfig.json，子目录可能有局部覆盖。resolver 的 `findNearestTsConfig` 函数必须正确处理此场景，优先使用最近层级的 tsconfig。关联 FR-001。

- **`export * as namespace from './x'`**：namespace re-export 形态。若 barrel 文件使用 namespace 导出，追踪时需识别该形态。若 R-1-A 调研发现此形态在 68 条中无出现，标 [YAGNI-移除]。

- **barrel 文件深度超过实测最大深度（W-7 修复）**：本仓库实测 barrel 链深度 2-3 层（panoramic/index → panoramic/internal → parsers/index），R-1-D 将给出实测最大深度和 95 分位深度。FR-003 默认覆盖深度 3，**硬上限 10 仅作为防失控保护**。超过硬上限时返回 unresolved 并记录调试信息，不抛异常。关联 FR-003。

- **barrel fan-out 性能（I-1 修复）**：单次解析中累计访问 barrel 源文件数量上限 ≤ 50，每个文件读取均经过 LRU/Map cache（同一 batch 中重复访问命中缓存），避免 N×M 重复 IO。SC-006 deltaMs ≤ 5000ms 必须在双 target 上保持。关联 FR-003 + 复杂度评估。

---

## Requirements

### Functional Requirements

- **FR-001（W-5 修订降级）**：`src/knowledge-graph/import-resolver.ts` SHOULD 正确解析 tsconfig.json 中 7 个 path alias 前缀在 alias + barrel 串联场景下的完整路径。**降级理由**：Codex P0 plan 复审 W-5 证伪 — self-dogfood 内部全部使用相对路径 import（如 `../core/foo.js`），`@core/*` 等 alias 仅在 tsconfig 定义未被实际使用，FR-001 alias 修复对 self-dogfood `sc008Rate` **零贡献**。修订后：alias 修复仅作为兼容性测试（覆盖 hono 等使用 alias 的 baseline 项目），不计入 sc008Rate ≥ 70 的主路径预测。R-1-C 调研必须先实测 self-dogfood 中 alias 真实使用次数，若为 0 则本 FR 标 [YAGNI-移除]。`[降级 SHOULD]` `[YAGNI-待 R-1-C 确认]`

- **FR-002（I-2 修复）**：`src/knowledge-graph/import-resolver.ts` MUST 依据 R-1-A 调研输出的 traceable checklist，针对**占比 ≥ 5 条**的根因类别逐一实施修复。每条 false-negative 在 checklist 中有唯一 id + 三视角分类 + 预期 resolver 行为 + 对应单测断言；plan.md 必须列出"已修复 / 未修复 / 跳过（YAGNI）"三栏统计，verify 阶段必须能逐条追溯。不实现调研数据中未出现的场景（YAGNI）。`[必须]`

- **FR-003（W-7 修复）**：`src/knowledge-graph/import-resolver.ts` MUST 支持 barrel re-export 链多跳追踪（`A re-export from B re-export from C`），覆盖 R-1-D 实测最大深度（默认覆盖 3，本仓库 panoramic/index → panoramic/internal → parsers/index 实测约 3 层），**硬上限 10 仅作为防失控保护**；追踪逻辑必须内置循环检测（visited Set），防止循环引用导致无限递归；累计访问文件数 ≤ 50，使用 cache 避免重复 IO。`[必须]`

- **FR-004（W-3 修复）**：`src/knowledge-graph/import-resolver.ts` MAY 在追踪 barrel 链时识别 `export type { Foo }` 语句并跳过（不中止追踪），但 resolver 返回的 `ResolveResult` 字段**不新增 type-only 标记**，由 caller 自行判断；invariant 单测必须证明 caller 不会因此把 type-only 解析结果写入 graph calls/import edge。`[可选]` `[YAGNI-待调研确认]`

  > YAGNI 分析：sc008Rate 测量的是运行时 `new Foo()` 到 class 节点的连通，type-only import 不产生 calls edge。唯一可能的 false-negative 场景是 resolver 在追踪 barrel 链时因遇到 `export type` 语句而错误中止追踪。**若 R-1-A 调研确认 type-only 导致的 false-negative = 0 条，则本 FR 标注为 [YAGNI-移除]。**

- **FR-005**：`src/knowledge-graph/import-resolver.ts` MAY 对 barrel 文件中混入的动态 import（`import('./x')`）语句做容错处理（遇到动态 import 时跳过该语句而非中止整个 barrel 链追踪）。`[可选]` `[YAGNI-待调研确认]`

  > YAGNI 分析：动态 import 在 barrel re-export 文件中极为罕见。若 R-1-A 调研未发现此类场景，标 [YAGNI-移除]。

- **FR-006**：扩展后的 `src/knowledge-graph/import-resolver.ts` MUST 保持纯函数（pure function）设计，零新 npm 依赖，解析失败时返回 `{ resolvedPath: null, kind: 'unresolved' }` 而非抛异常。`[必须]`

- **FR-007（W-2 修复）**：针对本 Feature 扩展的能力，MUST 新增 ≥ 6 个单元测试，**且每个等价类至少 1 条测试断言**：(1) path alias 类（≥ 3 个 alias 命中断言，覆盖 `@core/*`、`@graph/*`、`@models/*` 等典型 alias，其余 4 个 alias 通过等价类覆盖）；(2) barrel 单跳命中；(3) barrel 多跳命中（≥ 2 跳，含 R-1-D 实测的最大深度场景）；(4) barrel 循环检测防护；(5) path alias + barrel 串联；(6) alias 未命中降级为 unresolved；(7) external re-export 返回 external 终止追踪；(8) `export *` 与 `export { X }` 命名冲突时显式优先；(9) R-1-A checklist 中至少 1 条具体 false-negative 的回归测试。`[必须]`

- **FR-008（C-2 + Codex P0 plan 复审 C-1/C-2 修复）**：本 Feature 修改范围严格限定如下：

  **允许修改**：
  - `src/knowledge-graph/import-resolver.ts`（**主修改文件**：barrel 链追踪 + 第 5/6 可选参数）
  - `src/batch/batch-orchestrator.ts` 中**仅 `collectTsJsCodeSkeletons` 函数的 import 拆条部分**（按 namedImports 拆分为单元素数组并传 `importedName` 给 resolver；与 Python 路径 Feature 152 Codex P3+P4 C-1 修复同精神。**必要例外，因为 codex P0 plan 复审证明**：单条 import 单 resolvedPath 数据模型无法表达 `import { A, B } from './index'` 中 A、B 分属不同文件，barrel symbol 级追踪需要数据模型协同改造）
  - 配套单测文件：`tests/unit/knowledge-graph/import-resolver.test.ts` + `tests/unit/batch-orchestrator-tsjs-resolve.test.ts`（调整断言以适配新的 import 拆条形态）

  **禁止修改**：
  - `src/core/import-resolver.ts`（Feature 156 引入）
  - `src/batch/batch-orchestrator.ts` 中 `collectTsJsCodeSkeletons` 函数之外的代码
  - adapter / mapper / unified-graph / call-resolver / scripts/verify-feature-152.mjs

  **例外路径**：R-1 调研结论为"结论 B"（根因不在 import-resolver scope，或 resolver 全修复后模拟 sc008Rate < 70）→ 本 Feature **停止实施**，提交 scope-change decision 给用户，不擅自扩大 scope。`[必须]`

---

### YAGNI 必要性检验汇总

| FR | 组件/能力 | 标注 | 理由 |
|----|-----------|------|------|
| FR-001 | path alias + barrel 串联解析 | `[必须]` | 去掉则 @core/* 等 alias 串联 barrel 的场景 false-negative 无法消除；self-dogfood 有 7 个 alias + 5 个主要 barrel hub |
| FR-002 | R-1 调研驱动的修复范围 | `[必须]` | 无数据驱动则修复方向不确定，可能在不必要的场景引入复杂度 |
| FR-003 | barrel re-export 多跳追踪 | `[必须]` | panoramic/index → panoramic/internal → parsers/index 是核心模式；去掉则 Generator class 场景全部 false-negative |
| FR-004 | type-only import 追踪 | `[可选] [YAGNI-待调研]` | 无直接 sc008Rate false-negative 场景支撑；调研前无法 justify，降为 MAY |
| FR-005 | 动态 import 容错 | `[可选] [YAGNI-待调研]` | barrel 中动态 import 极罕见；无实测场景支撑 |
| FR-006 | 纯函数约束保持 | `[必须]` | 去掉则现有 31 个 import-resolver 单测架构崩塌 |
| FR-007 | 新增 ≥ 6 单测 | `[必须]` | 无测试则无法证明 barrel/alias 修复正确；SC-4 硬性要求 |
| FR-008 | scope 仅限一个文件 | `[必须]` | 防止双轨污染（src/core/import-resolver.ts 是独立模块） |

**YAGNI-移除条件**：
- FR-004（type-only import 追踪）：R-1-A 调研确认 = 0 false-negative → 标 [YAGNI-移除]，从本版本移除，记录：_type-only import 在本仓库 sc008Rate 测量中无直接影响，留待未来有具体使用案例时再实现_。
- FR-005（动态 import 容错）：R-1-A 调研确认 = 0 场景 → 标 [YAGNI-移除]，同上原因。

---

### Key Entities

- **`ResolveResult`**：现有 public 接口，字段 `resolvedPath: string | null` + `kind`（枚举值含 `paths-alias`、`relative`、`absolute`、`external`、`unresolved` 等）。本 Feature 不新增字段，扩展能力通过已有 `kind` 枚举值表达。若 barrel 追踪需要新的 kind 值（如 `barrel-chain`），需在 plan.md 中说明并评估对下游消费方的影响。

- **BarrelChainTracer**（概念实体，非 public 接口名）：barrel 多跳追踪的内部逻辑单元，负责从 barrel 文件读取 re-export 语句、递归追踪（含 visited Set 防环）、最终返回实际 class 定义文件路径。仅在 `src/knowledge-graph/import-resolver.ts` 内部使用，不对外暴露为新的 public 接口。

---

## Success Criteria

### Measurable Outcomes

- **SC-1（主指标）**：执行 `node scripts/verify-feature-152.mjs --target ./src --metric sc008`，self-dogfood `sc008Rate ≥ 0.70`（≥ 70 hits / 100 truth-set 条目，较当前 32 hits 净增 ≥ 38 条）。

- **SC-2（无回归）**：执行 `node scripts/verify-feature-152.mjs --target ~/.spectra-baselines/hono/src`，hono `sc008Rate = 100%`（841/841，无任何退步）。

- **SC-3（指标不倒退）**：Feature 152 已验收的 SC-001/002/003/006 各指标，在 self-dogfood 和 hono 两个 target 上均不低于 Feature 152 ship 数字：
  - SC-001 fillRate：self-dogfood 100% / hono 100%
  - SC-002 precision：self-dogfood ≥ 91.8% / hono ≥ 96.7%；recall：self-dogfood ≥ 80.1% / hono ≥ 72.4%
  - SC-003 python resolution：两 target 均 100%
  - SC-006 deltaMs：≤ 5000ms（双 target）

- **SC-4（测试覆盖）**：执行 `npx vitest run`，全量单测 pass（≥ 3459 条）零失败；import-resolver 相关测试中包含 ≥ 6 条新增单测，覆盖 barrel 追踪和 alias 修复场景。

- **SC-5（根因凭据）**：R-1-A 调研数据（68 条 false-negative 的三视角分类）以**结构化 traceable checklist**（每条 id + 三视角分类 + 预期修复路径 + 对应单测断言 id）记录在 plan.md 的 R-1 章节。

- **SC-6（C-3 修复 — 收益归因）**：实施完成后，必须输出 **before/after 对比表**：每个新增 hit（共 ≥ 38 条）必须能追溯到其生效路径（resolver 解析结果变化 / barrel 链解析新通 / alias 新通），并标注对应修复的 FR 编号。若任一 hit 无法追溯到 resolver 解析变化（例如来自意外的副作用），必须在 plan.md 中说明。verify 输出必须区分"resolver 改动贡献的 hit"与"其他原因的 hit（理论上应为 0）"。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 | 说明 |
|------|------|------|
| **组件总数** | 1 | 仅修改 `src/knowledge-graph/import-resolver.ts` 一个模块，其余只读 |
| **接口数量（新增/修改）** | 0 新增 / 1 可能修改 | 不新增 public 接口；`ResolveResult.kind` 视调研结果可能追加 1 个枚举值 |
| **依赖新引入数** | 0 | 纯 Node.js `fs` + `path`，无新 npm 依赖（Constitution VIII） |
| **跨模块耦合** | 否 | 不修改 adapter/mapper/unified-graph/batch-orchestrator，调用方无感知变化 |
| **复杂度信号** | 1 个（有界递归 + cache） | barrel 链多跳追踪涉及受限递归（visited Set + depth ≤ 10）+ 文件读取 cache（fan-out ≤ 50，I-1 修复），其余逻辑均为线性 |

**总体复杂度：MEDIUM（LOW 边界）**

> 基础维度评分 LOW（组件 1 < 3，接口修改 < 4），因存在 1 个复杂度信号（有界递归 + cache）升至 MEDIUM 下界。barrel 链追踪是唯一设计复杂点，其余修复（alias 命中补全、type-only/dynamic 容错）均为线性逻辑扩展。

**GATE_DESIGN 建议**：可自动通过（AUTO）。唯一需要关注的设计点是 barrel 循环检测的实现方式，plan.md 中需明确给出防环算法选择（visited Set vs depth counter，建议 visited Set 优先，depth counter 作为次级保护）。

---

## 歧义处理

**[AUTO-RESOLVED 1/2]**：type-only import 是否纳入本 Feature 实现范围。用户描述中要求实现，但无 sc008Rate false-negative 的直接使用场景支撑。**自动决策**：降为 MAY（FR-004），以 R-1-A 调研数据为解锁条件。理由：YAGNI 原则 + type-only import 的唯一可能贡献路径（barrel 追踪中途丢失）须调研确认；主路径 barrel/alias 修复即可达到 ≥ 70% 目标，type-only 属于优化项。

**[AUTO-RESOLVED 2/2]**：若根因调研发现部分 false-negative 源于 verify-feature-152.mjs 测量偏差（label 匹配误判）而非 import-resolver 能力缺口。**自动决策**：spec 中明确列为 R-1 降级策略（见上方 R-1 调研前置约束章节），plan.md 阶段由调研数据决定主方向，spec 不预设修复 verify 脚本的意图。理由：两个方向的修复工作量和风险差异显著（改 resolver vs 改 verify 脚本），应由实测数据而非假设决定，不值得在 spec 阶段锁定。

---

## 约束与边界

1. **scope 严格限定**：仅修改 `src/knowledge-graph/import-resolver.ts` + 对应测试文件。`src/core/import-resolver.ts`（Feature 156）、adapter、mapper、unified-graph 在本 Feature 中**只读**。

2. **不修改验收脚本**：`scripts/verify-feature-152.mjs` 保持不变（除非 R-1 调研确认根因在测量逻辑，此时需重新澄清 spec 方向并获得用户确认）。

3. **无新依赖**：不引入任何新 npm 包（Constitution 原则 VIII），barrel 链读取通过现有 `fs.readFileSync` 实现。

4. **预估工作量**：3-5 天，取决于 R-1 调研发现的实际根因复杂度。若根因集中在 barrel 追踪（≥ 40/68），工作量偏低端；若根因分散（每类 < 10），修复面更宽，工作量偏高端。
