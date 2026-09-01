# Implementation Plan: F278 诚实工具面四小补

**Branch**: `feature/278-honest-tooling-patches` | **Date**: 2026-09-01 | **Mode**: story
**Spec**: `specs/278-honest-tooling-patches/spec.md`
**Code Context**: `specs/278-honest-tooling-patches/code-context.md`（编排器实读事实清单；§4 两处结论直接采用，本 plan 不重复核实）

---

## Summary

四项互不相交的小改动，各自补一处"工具面不够诚实"的洞：

| 项 | 面 | 交付 |
|----|----|------|
| ① | `src/mcp/agent-context-tools.ts` | impact/context 的 `symbol-not-found` hint 按"文件是否在图中"分流，文件在图中时改说"可能是新增符号、图陈旧" |
| ② | `scripts/regen-collector-fingerprint-fixtures.ts` | `compareGraphOnlyStructure` 新增第三比较维度：按 node id 分组的 metadata **key 集合**（只比 key 名，不比值） |
| ③ | 同上文件（`--init` 成功路径） | 冷启动再生写一条审计记录到 fixture 根目录 sidecar |
| ④ | `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` | 新增 `--since <ref>`，把"当前 drift"拆成"本次引入 / 开工前就有"，基线不可读时 fail-loud |

技术取向：零新增依赖、零新增模块、四项各自可独立验证、不带新 flag 时输出逐字节不变。

---

## Technical Context

| 项 | 值 |
|----|----|
| 语言/版本 | TypeScript 5.x（`src/`、`scripts/`、`tests/`）+ 纯 ESM JavaScript（`plugins/spec-driver/**`，Node 20/24 双版本） |
| 主要依赖 | 项①②③：仓库既有依赖（vitest / tsx）；项④：**仅** `node:child_process` + `node:crypto`（宪法 X） |
| 存储 | 无数据库。新增一个 append-only 文本 sidecar（项③），格式 JSONL |
| 测试策略 | 项①②③ → vitest（`npx vitest run`）；项④ → node:test（`npm run test:plugins`）。四项**全部**红先行：先写会失败的用例并实跑确认红，再改实现 |
| 构建 | `npm run build`（tsc 类型检查）；`plugins/spec-driver/**` 不参与 tsc |
| 目标平台 | macOS / Linux（CI Node 20，本机 Node 24） |

无 `NEEDS CLARIFICATION` 项：spec 的 Clarifications 已收口两处不确定性（fixture 扫描面、`--since` 是否必须改 core），本 plan 直接采用。

---

## Codebase Reality Check

实读记录（`git` 基线 `e01611b2`；LOC 为 `rg '^' -c` 计数即物理行数）：

| 目标文件 | LOC | 关键接口数 | 已知 debt | 本卡预计新增 |
|---------|-----|-----------|----------|------------|
| `src/mcp/agent-context-tools.ts` | 1043 | 3 个 handler（impact / context / detect_changes）+ 2 个 module-private helper | 0 个 TODO/FIXME/HACK；无超 200 行函数（最长 `handleImpact` ~137 行） | ~30 行（1 个 helper + 2 处调用点替换） |
| `scripts/regen-collector-fingerprint-fixtures.ts` | 728 | 11 个 export（`compareGraphOnlyStructure` / `compareModuleGraphSnapshot` / `swapPinnedAssets` / `rebuildTracks` / `runRegen` / `computeFixtureInputHash` / `selectRegenDiagnostic` / 2 个资产文件名常量 / `DEFAULT_FIXTURE_ROOT` 等） | 0 个 TODO/FIXME/HACK；`runRegen` ~148 行（偏长但为线性主流程，无嵌套分支爆炸） | ~75 行（项② ~45 + 项③ ~30） |
| `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` | 265 | 1 个 export（`checkJudgeSnapshotDrift`）+ 4 个 module-private（`parseArgs` / `probeClaudePluginRoot` / `formatReport` / `main`） | 0 个 TODO/FIXME/HACK；无超长函数 | ~110 行（`--since` 全套：预检 + git digest + delta 派生 + 独立格式化函数） |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | 476 | 测试文件 | 无 | ~50 行（3 条变异用例） |
| `tests/integration/collector-fingerprint-regen-script.test.ts` | 405 | 测试文件 | 无 | ~55 行（2 条审计用例） |
| `tests/unit/mcp/agent-context-tools.test.ts` | 873 | 测试文件 | 无 | ~60 行（4 条 hint 分支用例） |
| `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` | 199 | 测试文件 | 无 | ~130 行（`--since` 5 条 CLI 用例 + git 临时仓 helper） |

### 前置清理规则判定

规则："文件 LOC > 500 且将新增 > 50 行 → 必须增加前置 cleanup task"。

- `src/mcp/agent-context-tools.ts`：1043 LOC 但新增 ~30 行 < 50 → **不触发**。
- `scripts/regen-collector-fingerprint-fixtures.ts`：728 LOC，新增 ~75 行 > 50 → **触发**。
- 无文件满足"> 3 个相关 TODO/FIXME"（全仓这三个文件零标记）。
- 无 > 30 行的重复逻辑块（已实读：`compareGraphOnlyStructure` 与 `compareModuleGraphSnapshot` 是两种不同比较范式，非重复）。

**清理裁决（T001 `[CLEANUP]`）**：**不做文件拆分**，只做"新增逻辑外提为独立顶层函数"这一件事。

- 被否方案 A：把两轨比较器抽到 `scripts/lib/graph-track-comparators.ts`。否决理由——测试文件头注释明确写死"比较器**从再生脚本 import**（非本文件另写一份），一旦分叉护栏会静默退化为永久绿"，且有 3 个消费方（`runRegen` / 护栏测试 / staleness 测试）依赖当前 import 路径。拆分属于 spec Out of Scope 明确禁止的范围外改动，收益（文件短 100 行）远小于改动 3 处 import 契约的风险。
- 被否方案 B：把新增的 metadata 比较逻辑直接内联进 `compareGraphOnlyStructure`（现 35 行）。否决理由——会让该函数变成 ~80 行、承担三种不同分组语义，违反"函数单一职责"。
- **采纳**：新增 `compareNodeMetadataKeys(rebuilt, pinned): string[]`（module-private，不 export——只有一个调用点，export 会凭空扩大护栏契约面）与 `metadataKeySignature(node): string` 两个纯函数，由 `compareGraphOnlyStructure` 在既有两维度之后调用并把返回的 differences 追加进同一个数组。既有函数只增 2 行（一次调用 + 一次 push）。

---

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 8 个（3 个实现文件 + 4 个测试文件 + 1 个 fixture README 说明段落） |
| 间接受影响 | `compareGraphOnlyStructure` 的 3 个消费方（`runRegen`、`collector-fingerprint-guardrail.test.ts`、`graph-quality-pinned-staleness.test.ts`）；`handleImpact`/`handleContext` 的 MCP 客户端（返回结构不变，仅 hint 字符串内容变） |
| 跨包影响 | **3**（`src/**`、`scripts/**`、`plugins/spec-driver/**`）+ `tests/**` |
| 数据迁移 | 无。项③新增的 sidecar 是 append-only 新文件，不改任何既有资产格式；项②不改 pinned 资产内容；项④只读 |
| API/契约变更 | 无破坏性变更。项① `error.code`/`error.details` 结构不变（FR-003）；项② 新增第三维度只增检测面（FR-008）；项④ 新增可选 flag，缺省行为逐字节不变（FR-012） |
| **风险等级** | **HIGH** |

**风险等级判定说明（诚实口径）**：按规则"跨包影响 > 2 ⇒ HIGH"触发。但本卡的 HIGH 是**分布式的而非耦合式的**——四项改动之间零调用关系、零共享数据结构，聚合成 HIGH 的唯一原因是它们分散在三个顶层目录，而不是存在跨包联动。逐项看均为 LOW（每项影响文件 < 5、无跨包）。因此**不需要**把它们串成一条依赖链，而是按规则做**强制分阶段**，让每阶段自带独立验证点：

### 强制分阶段（HIGH 风险要求）

| Phase | 内容 | 独立验证点（该 Phase 结束必须绿） |
|-------|------|--------------------------------|
| **P0** | 基线采样 + 前置实跑确认（不改任何实现代码） | `/tmp/f278-doctor-before.txt` 已落盘；`git show` 三态 exit code/stderr 形态已实测记录；新档位对当前 pinned 基线判一致已实跑证实 |
| **P1** | 项① impact/context hint | `npx vitest run tests/unit/mcp/agent-context-tools.test.ts` 绿；4 条新用例先红后绿 |
| **P2** | 项② metadata-key 档位 | `npx vitest run tests/unit/guardrail/ tests/integration/graph-quality-pinned-staleness.test.ts` 绿；3 条变异用例先红后绿；既有 5 条扰动用例判定不变 |
| **P3** | 项③ `--init` 审计留痕 | `npx vitest run tests/integration/collector-fingerprint-regen-script.test.ts` 绿；2 条新用例先红后绿 |
| **P4** | 项④ `--since` | `npm run test:plugins` 绿；`diff /tmp/f278-doctor-before.txt <改后同 cwd 重跑>` 为空 |
| **P5** | 收尾全量门禁 | `npx vitest run` + `npm run test:plugins` + `npm run build` + `npm run repo:check` + `npm run release:check` 全零失败 |

P0 是所有 Phase 的硬前置（P4 的 before 基线必须在任何代码改动前采样）。P1–P4 之间**无依赖**，理论可并行；但 P2 与 P3 落在同一文件（`regen-collector-fingerprint-fixtures.ts`）的不同区块，串行执行以避免同文件并发编辑冲突。

---

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | **PASS** | 本 plan / tasks / 代码注释全中文，标识符与技术术语英文 |
| II. Spec-Driven Development | 适用 | **PASS** | spec.md → plan.md → tasks.md → implement，每项 FR 在 tasks 中有对应任务 |
| III. YAGNI | 适用 | **PASS** | 不新增模块/配置项/抽象层；项① helper 就地放调用点同文件（两个调用点，不提 lib/）；项② 只加一个维度不做通用 diff 引擎；项④ 不做 `--since` 之外的 flag。四项均有 ledger 实证来源 |
| IV. 诚实标注不确定性 | 适用 | **PASS** | 项① 新 hint 明说"图可能陈旧"而非把锅推给用户拼写；项② 区分 `undefined` 与 `{}`；项④ 基线不可读 fail-loud 且 `indeterminate` 独立成一档不并进 pre-existing。全 plan 的未确认项标 `[待 implement 实跑确认]` |
| V. AST 精确性优先 | 不适用 | — | 不触碰任何解析器 |
| VI. 混合分析流水线 | 不适用 | — | 不改采集流水线 |
| VII. 只读安全性 | 适用 | **PASS** | 项④ 只读 git 对象（`rev-parse`/`cat-file`），不写 git；项③ 只写 fixture 根目录 sidecar，落点已核实不进 `computeFixtureInputHash` |
| VIII. 纯 Node.js 生态 | 适用 | **PASS** | 零新增依赖 |
| IX. Prompt 编排 + Harness 强制 | 不适用 | — | 不改 agent/skill 散文 |
| X. 零运行时依赖（spec-driver） | 适用 | **PASS** | 项④ 只用 `node:child_process` / `node:crypto`（FR-017） |
| XI. 质量门控不可绕过 | 适用 | **PASS** | 项② 是**加强**护栏；明确禁止用 `--init`/bump `BEHAVIOR_VERSION` 求绿（FR-011）；项③ 的审计写失败**不**降级为放行判定（它不是判定输入） |
| XII. 验证铁律 | 适用 | **PASS** | 四项全红先行；项② 额外要求变异测试双向（加 key / 删 key）+ 既有 5 条扰动用例不回退；项②④ 各有一条"实跑证实"任务 |
| XIII. 向后兼容 | 适用 | **PASS** | 项④ 不带 `--since` 时 `formatReport` **一行未改**（新增区块在 `main` 里拼接，见 D4 裁决），并用改动前 stdout 基线 diff 验证（SC-004） |
| XIV. 可观测性与架构守护 | 适用 | **PASS** | 项② 差异文案格式与既有拒绝/放行分支共用同一 `[regen]   - ` 前缀，可被同一套日志解析消费 |

**VIOLATION 数**：0。无需豁免论证。

---

## 六个设计问题的裁决

### D1 — 项② `compareGraphOnlyStructure` 新 metadata-key 档位的比较语义

**裁决**：新增第三维度 `compareNodeMetadataKeys`，按 **node id 分组**、组内比较 **key-set 签名的 multiset**；差异文案分"单节点富诊断"与"重复 id 通用计数"两个分支；**边侧 metadata 不纳入**。

#### D1.1 数据结构

> ⚠️ **本节的函数签名与 D1.2 步骤 3 已按 implement 阶段对抗复审的结论重写，实现未采用原方案**
> （正文保留原样以留痕，勿照此实现）。被否点：`metadataKeySignature(node): string` 这个只回传字符串的
> 形状，逼得 D1.2 步骤 3 在诊断时"把两侧签名**解回 key 数组**"——那会让 `missing`/`extra` 的正确性
> 变成"签名恰好是规范 JSON 数组"这个实现细节的下游依赖（签名一旦改形就静默退化成
> `重建缺失 [] vs 重建新增 []`，甚至 `JSON.parse` 直接抛异常）。
> 终版是 `describeNodeMetadata(node): NodeMetadataShape { signature, keys }`：`signature` 只承担
> 相等性判定，`keys` 供诊断分支直接消费，二者分离后 `.sort()` 只负责签名规范化，诊断文案正确性
> 与签名格式解耦；理由详见 `scripts/regen-collector-fingerprint-fixtures.ts` 的 `NodeMetadataShape` JSDoc。
> 分组结构也随之变为 `Map<nodeId, NodeMetadataShape[]>`（求值时才按签名计数），而非本节写的
> `Map<nodeId, Map<signature, count>>`。
>
> **覆盖范围（本节之外亦按此理解）**：D1 清理裁决"采纳"行里的 `metadataKeySignature(node): string`、
> 本节的代码块与"分组结构"一行、D1.2 步骤 3 的"把两侧签名解回 key 数组"、以及架构图里的
> `SIG[metadataKeySignature · 新增]` 节点（该节点在终版实现中不存在），共五处均为决策留痕，
> 不代表终版实现。本节其余正文（三档签名语义、按 node id 分组、D1.3 三条文案、D1.4 边 metadata
> 不纳入）与实现一致，原样有效。

```ts
/**
 * 节点 metadata 的 key 集合签名。
 *
 * 为什么 `undefined` 与 `{}` 必须是两个不同签名（FR-007）：前者代表"该节点从未产出过
 * metadata"，是比"产出了但里面没有 key"更强的退化信号；混同会丢掉这一层诊断精度。
 * 非对象取值（null / 字符串 / 数字）单列一档：图产物里出现这种形状本身就是缺陷，
 * 把它折叠进 `<absent>` 等于把缺陷说成"这个节点没 metadata"。
 */
function metadataKeySignature(node: GraphNode): string {
  const raw = (node as { metadata?: unknown }).metadata;
  if (raw === undefined) return '<absent>';
  if (raw === null || typeof raw !== 'object') {
    return `<non-object:${raw === null ? 'null' : typeof raw}>`;
  }
  return JSON.stringify(Object.keys(raw as Record<string, unknown>).sort());
}
```

- 类型说明：`GraphNode.metadata` 在类型上是必填 `Record<string, unknown>`，但**运行时**（从 JSON 反序列化的 pinned 资产 / 重建产物）可能缺席。因此必须经 `(node as { metadata?: unknown })` 做一次运行时诚实收窄——这不是绕过类型系统，而是承认"类型声明覆盖不到磁盘上的历史资产"。注释里写清这个 why。
- 分组结构：`Map<nodeId, Map<signature, count>>`，两侧各建一份。

#### D1.2 判定流程

1. 只对**两侧 node id 计数相等且都 > 0** 的 id 求值。id 计数不等（或单侧独有）的情形已由既有第一维度报告，第三维度跳过——否则同一个事实会被报两遍，把真正的 metadata 差异淹没在噪声里。
2. 对每个 id，比较两侧 `Map<signature, count>`。完全相等 → 无差异。
3. 不相等时分两支：
   - **单节点富诊断分支**（两侧该 id 各恰好 1 个节点）：把两侧签名解回 key 数组（`<absent>` / `<non-object:*>` 直接按缺席态处理），算 `missing`（pinned 有而重建无）与 `extra`（重建有而 pinned 无）。
   - **通用 multiset 分支**（任一侧该 id 有 ≥ 2 个节点）：逐签名报计数差异，不试图算 key 级 diff（重复 id 的节点之间没有身份可对应，强行配对会编造出误导性的"某个 key 丢了"）。

#### D1.3 差异文案（逐字定稿，implement 直接抄）

风格锚定既有两条（`节点计数不一致（重建 ${left} vs pinned ${right}）: ${id}` / `边计数不一致（重建 ${left} vs pinned ${right}）: ${key}`）——中文短语 +`（重建 X vs pinned Y）`+`: <定位符>`：

```ts
// 单节点分支 · 双方都是正常对象，key 集合不同
`metadata key 集合不一致（重建缺失 [${missing.join(', ')}] vs 重建新增 [${extra.join(', ')}]）: ${id}`

// 单节点分支 · 缺席态不同（<absent> / <non-object:*> / 正常对象 三者之间的任意不等）
`metadata 缺席态不一致（重建 ${rebuiltSig} vs pinned ${pinnedSig}）: ${id}`

// 通用 multiset 分支
`metadata key 签名计数不一致（重建 ${left} vs pinned ${right}）: ${id} @ ${signature}`
```

其中"缺席态不一致"分支的触发条件是：两侧签名中**至少一个**不是正常 key 列表（即以 `<` 开头）。这样 `undefined` vs `{}` 会输出
`metadata 缺席态不一致（重建 <absent> vs pinned []）: <id>`，两态在文案上直接可辨（FR-007 验收点）。

这三条都进同一个 `differences: string[]`，因此再生脚本的拒绝分支（`console.error('[regen]   - ' + d)`）与放行分支（`console.log('[regen]   - ' + d)`）**无需任何改动**即可打印，日志格式契约自动保持。

#### D1.4 边 metadata —— 不纳入（裁决 + 理由）

**不纳入本卡范围**，登记为已知残留。

理由不是"省事"，是**边缺少可分组的身份键**：边的既有比较维度是 `source|relation|target` 的 multiset，同一 key 下的重复边彼此无法区分。要按边比较 metadata，只有两条路——(a) 退回"全图并集"，而这正是 F271 已实证零检测力的档位；(b) 先给边造一个稳定身份（把 metadata 也编进 key），那等于把边比较从 multiset 改成"含 metadata 的深度比较"，是对既有维度的判定逻辑改动，被 FR-008 明确禁止。两条路都不通，故本卡不做，残留登记见下方「风险与已知残留」R-3。

---

### D2 — 新档位是否会让**当前** pinned 基线变红

**裁决**：**必须在写任何实现代码之前先实跑证实**（P0 阶段，T004），而非改完再看。若实跑判红，按下方分叉表处置，**禁止**用 `--init` 或 bump `BEHAVIOR_VERSION` 让它变绿。

#### D2.1 活性证明的实跑方式（T004）

先在护栏测试里加一条**临时探针用例**（或用 `npx tsx` 直跑一段脚本），复用护栏测试已有的 `rebuiltGraph`（真实 `buildAstGraphOnly` 产物）与 `pinnedGraphOnly.graph`（typed loader 解包的 pinned 资产），对二者逐 node id 比较 metadata key 签名，打印所有不等项。预期输出为空。

这一步**不依赖新比较器实现**（可以先写成测试内的一段本地比较逻辑），因此它是对"资产现状"的独立测量，而不是对"我刚写的比较器"的自证。

#### D2.2 实跑判红时的处置分叉（预先写死，implement 不得临场发挥）

| 观察到的差异形态 | 判定 | 处置 |
|----------------|------|------|
| 差异只出现在 `<absent>` vs `[]` 这一对上 | 比较器/签名函数写错（多半是把"JSON 里没有 metadata 键"和"空对象"读反了） | 修签名函数，重跑 |
| 差异是某些节点少了 `lineRange` / `signature` 等 F271 已入库字段 | **真漂移**（当前采集器产出与 pinned 资产不一致，且既有两维度看不见） | **停下回报编排器**。这是本卡意外挖到的真缺陷，不在本卡范围内修；本卡的新档位任务标 BLOCKED 等裁决。**MUST NOT** 跑 `--init` |
| 差异是 pinned 资产里存在而当前采集器完全不产出的字段 | **资产陈旧**（pinned 早于某次字段移除） | 同样**停下回报**。既定路径是"确认字段移除是预期的 → 按 F271 的做法走一次显式的 `--init` 重建 + README 再生记录 + 审计"，但这条路径**必须由用户裁决后才走**，plan 不预授权 |
| 差异随机/不可复现 | 疑似重建不确定性 | 连跑 3 次比较，若差异集合不稳定则记录为新发现的非确定性缺陷，停下回报 |

**明确禁止写进任何任务的做法**：跑 `npm run fixtures:regen:collector-fingerprint -- --init` 让它绿；bump `BEHAVIOR_VERSION`；把不等的字段加进签名函数的忽略列表。

---

### D3 — 项③ 审计记录的落点形态

**裁决**：**(B) 独立 sidecar 文件**，路径 `tests/fixtures/collector-fingerprint-guardrail/regen-audit.jsonl`，**append-only JSONL**，**入 git**。

#### D3.1 为什么否 (A) README 追加

- README 是人写散文，且已有人工撰写的"再生记录 · 2026-08-31（F271 lineRange 新字段）"一节（含 79 行的分析文字）。脚本往同一文件追加，会让机器条目与人工分析在 `git diff` 里混杂，两者的编辑周期和读者完全不同。
- README 的"再生记录"节承载的是**为什么这次再生是正当的**（人写的论证），审计记录承载的是**这次再生发生过、用的什么输入**（机器事实）。合并会让前者的论证价值被后者的流水账稀释。
- 每次 `--init` 追加会让 README 单向增长，而 README 的其余部分（目录结构表、禁止事项）是需要保持可读的规范文档。

#### D3.2 为什么是 JSONL 而非 JSON 数组 / 纯文本 log

- JSON 数组要 read → parse → push → write，一旦文件被截断/损坏就整条链失败；JSONL 用 `fs.appendFileSync` 一行搞定，无解析步骤、无损坏放大。
- 相比纯文本 log，JSONL 让测试可以逐字段断言（`JSON.parse(lastLine).trigger === '--init'`），不必写正则解析人读文案。

#### D3.3 记录字段（回答 ledger 的原始诉求"这份资产是谁、什么时候、用什么方式生成的"）

```jsonc
{
  "timestamp": "2026-09-01T12:34:56.789Z",   // new Date().toISOString()，UTC
  "trigger": "--init",                        // 固定字面量；本卡只覆盖 --init 路径（FR-021）
  "fixtureInputHash": "<64 hex>",             // 本次落盘用的 currentInputHash
  "behaviorVersion": 3,                        // currentFingerprint.behaviorVersion
  "assets": ["expected-graph-only-graph.json", "expected-module-graph.json"]
}
```

- **`fixtureInputHash` 是关键字段**：没有它，条目只能回答"某时刻跑过一次 `--init`"，回答不了"**这份**资产是哪次生成的"。有了它，任何时刻都能把磁盘上的资产与某条审计条目对上。
- **不记 git commit / 不记操作者姓名**：再生脚本当前零 git 依赖，且它常在临时 fixture 目录（`--fixture-root <tmp>`）下跑，那里的 git 语境毫无意义。"谁"由**该 sidecar 自身的 commit 元数据**回答——审计文件入库后，`git log` 的 author/date 是不可自报伪造的更强证据，脚本再自采一遍反而是弱证据。
- **不记 fingerprint 全量**：太长且已在 `expected-module-graph.json` 里存了一份；只留 `behaviorVersion` 这个 bump 纪律的锚点。

#### D3.4 append 而非覆写

覆写只保留最后一条，"上一次基线是谁在什么时候建的"会被永久抹掉——而审计的全部价值就在历史序列。append。

#### D3.5 入 git 的影响

- **入库**。理由：不入库 = 本地临时文件，别人 clone 下来看不到，完全达不到 ledger 的留痕诉求。
- 对 `git status` 的影响：跑一次真实 `--init` 会让该文件出现改动——这与"跑 `--init` 本来就会改两份 pinned 资产"是同一性质，不是新增负担。
- 对既有测试的影响：已核实 `tests/integration/graph-quality-pinned-staleness.test.ts` 的 fixture 枚举只认文件名精确为 `graph.json` 的目录，新增 sidecar 不进它的视野；`collector-fingerprint-regen-script.test.ts` 的 `stageFixtureRoot` 用 `fs.cpSync(recursive)` 复制整个 fixture，sidecar 会被一并复制到临时目录（这正是我们要的，测试在副本上验证 append）；`--init` 用例断言"无 `.bak` / `.tmp-*` 残留"，`regen-audit.jsonl` 不匹配这两个后缀，不受影响。
- 对 `npm run repo:check` 的影响：预期为零（repo:check 是同步链路校验，不枚举 `tests/fixtures/` 文件清单）。`[待 implement 实跑确认]` —— T023 会实跑 `repo:check` 复核。
- **本卡不预先创建该文件**：仓库里现在没有它，也**不**由本卡手工造一条"历史补记"条目——那等于伪造一次并未由本脚本执行的再生。文件由下一次真实 `--init` 时 `appendFileSync` 自动创建。因此本卡的 SC-003 验收全部发生在临时副本里，入库产物只有代码与测试。
- 配套：在 fixture `README.md` 的「禁止事项」节**人工**加一条（一次性说明性改动，非脚本写）：`regen-audit.jsonl` 由再生脚本维护，禁止手工编辑/删除历史条目。

#### D3.6 写盘失败时的行为 —— **warning + 仍 exit 0**（不 fail-loud）

**裁决**：审计写失败 **MUST NOT** 让已成功落盘的资产回滚或让整体退出码变非零；输出一条明确的 `console.warn('[regen] warning: ...')` 后继续返回 0。

理由（这是本项唯一有安全性含义的裁决，必须说清）：

1. 写入时机在 `swapPinnedAssets` **成功之后**（绝不能在之前——否则会记录一次可能失败的再生）。此时已越过 `swapPinnedAssets` 自己明确定义的"提交点"，其注释写死"置 true 之后的任何失败都 MUST NOT 触发回滚"。审计写失败去回滚资产，等于推翻这条既定不变量。
2. 若把它升级成 exit 1，会产出**最坏的状态**："脚本报失败，但两份资产已经是新内容"。维护者会以为没生成而重跑，而重跑此时必然被 C-002 守卫拒绝（资产已存在），直接卡死在一个只能靠手工删资产才能脱身的坑里。
3. 这**不是 fail-open**：审计记录不参与任何放行/拒绝判定，缺失它不会让任何护栏放行任何东西。真正的 fail-open 是"判定输入缺失时按通过算"，这里没有判定输入。
4. 形态与既有 `swapOutcome.warnings` 完全同构（备份清理失败也是 warning + exit 0），维护者已有心智模型。

---

### D4 — 项④ `--since <ref>` 的输出模型

#### D4.1 增量分类词表与派生表

`compareFile` 的返回 status 值域为 6 个：`match` / `mismatch` / `missingInRepo` / `missingInSnapshot` / `missingBoth` / `indeterminate`。

`--since` 对每个文件算**两个** `compareFile` 结果，**snapshot 侧用的是同一份当前生效快照**：

- `currentStatus = compareFile(digest(当前 repo 文件), digest(snapshot 文件))` —— 既有逻辑，原样复用
- `baselineStatus = compareFile(digest(<ref> 下该文件), digest(snapshot 文件))` —— 新增

用同一份 snapshot 是有意的：它精确回答 spec Edge Case 3 的核心问题"该漂移在 `<ref>` 时刻是否已相对**当前生效 snapshot** 存在"，也就是"是这次改动引入的，还是开工前就有的"。

> ⚠️ **本节已按 implement 阶段对抗复审的实跑结论重画（原 5 值词表 + 单张 6×6 矩阵已被证伪）**。
> 被证伪点：把 `absentAtRef` 做成"不进词表的正交标记"会让 FR-015(b) 落空——实跑复现「往 `JUDGE_FILE_SET`
> 加一个文件、已安装快照是旧版没有它」这一本仓最常见场景，输出为
> `[pre-existing] scripts/lib/in-flight-verdict.mjs (基线 missingBoth → 当前 missingInSnapshot, 该 ref 下不存在)`
> ＋汇总行 `9 unchanged / 1 pre-existing`：一条 100% 由本次改动引入的 drift 被答成"开工前就有的"，
> 且汇总行（正是给人扫一眼的地方）把旁注整个吞掉。

**delta 词表（6 值）**：

| delta | 定义 | 含义 |
|-------|------|------|
| `unchanged` | 见下方矩阵 | repo↔snapshot 的关系相对 `<ref>` 未变（含"三处皆无"） |
| `introduced` | `absentAtRef=false` ∧ baseline `match` ∧ current ≠ `match` | **本次改动引入的漂移** |
| `added-since` | `absentAtRef=true` ∧ current ≠ `missingBoth` | **该 `<ref>` 之后才出现在仓库里的文件**（FR-015(b)） |
| `resolved` | `absentAtRef=false` ∧ baseline ≠ `match` ∧ current `match` | 本次改动消除了一条既存漂移 |
| `pre-existing` | `absentAtRef=false` ∧ baseline ≠ `match` ∧ current ≠ `match` | 开工前就有的漂移 |
| `indeterminate` | 任一侧 `indeterminate` | **无法判定**（读取失败），不并入上面任何一档 |

`indeterminate` 必须独立成档：把"读不出来"折叠进 `pre-existing` 或 `introduced` 就是编数据，正是 FR-015 要防的病的同型。

**`absentAtRef` 是分类的一个维度，不是并列于分类的旁注**：文件在 `<ref>` 下根本不存在时，"这条漂移开工前就有"是不可能成立的命题——那时连文件都没有。FR-015(b) 原文即要求"`<ref>` 合法但目标文件在该 ref 下不存在 → 判定为该 ref 之后新增"，故独立成 `added-since` 一档，**并进入汇总行**。原方案否决 `added-since` 的理由（"与 introduced/pre-existing 语义重叠"）不成立：三者按 `absentAtRef` 天然互斥，`introduced`/`resolved`/`pre-existing` 现已全部限定在 `absentAtRef=false` 下。明细行仍同时打印 baseline/current 两个原始 status 与 `, 该 ref 下不存在` 旁注——分类回答"相对 ref 该如何归档"，原始 status 回答"两侧各是什么"，二者并存不冲突。

**完整派生表**（缩写：M=match、X=mismatch、R=missingInRepo、S=missingInSnapshot、B=missingBoth、I=indeterminate）：

`absentAtRef = false`（该 ref 下文件存在）：

| baseline \ current | M | X | R | S | B | I |
|---|---|---|---|---|---|---|
| **M** | unchanged | introduced | introduced | introduced | introduced | indeterminate |
| **X** | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
| **R** † | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
| **S** | resolved ‡ | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
| **B** † | resolved | pre-existing | pre-existing | pre-existing | pre-existing | indeterminate |
| **I** | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate |

`absentAtRef = true`（该 ref 下文件不存在）：

| baseline \ current | M | X | R | S | B | I |
|---|---|---|---|---|---|---|
| **M** † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
| **X** † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
| **R** | added-since | added-since | added-since | added-since | unchanged ★ | indeterminate |
| **S** † | added-since | added-since | added-since | added-since | unchanged | indeterminate |
| **B** | added-since | added-since | added-since | added-since | unchanged | indeterminate |
| **I** | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate | indeterminate |

†/★/‡ = 不可达组合（`deriveDelta` 仍写成全函数并被逐格单测钉住，只为矩阵完整可验）：

- 预检成功之后 `refDigest` 只可能是 `ok` 或 `missing`（任何 git 层面的异常一律 fatal），故 `absentAtRef ⟺ refDigest.status === 'missing'`；于是 R/B 只出现在 `absentAtRef=true`，M/X/S 只出现在 `absentAtRef=false`。
- ‡ / ★：两次比较用的是**同一份 snapshot 摘要**，故"baseline 说 snapshot 有、current 说 snapshot 没有"（及其反向）自相矛盾、不可达。

**两处边界的归档裁决**：

- `absentAtRef ∧ current = M` → **`added-since`**（不是 `resolved`）。`resolved` 断言的是"本次改动消除了一条既存漂移"，而该 ref 下压根没有这个文件，没有漂移可消除；判 `resolved` 是给本次改动记一笔不存在的功劳。"当前已一致"这一事实由行内的 `当前 match` 如实承载：delta 列回答"相对 ref"，status 列回答"相对当前快照"。
- `B × B`（ref 侧 / 当前 repo / snapshot 三处皆无）→ **`unchanged`**（不是 `added-since`）。什么都没被新增，说 `added-since` 是假话；相对 ref 的关系确实未变。注意此处 `unchanged` 的含义是"关系未变"，不是"两边都存在且一致"。

- 与"ref 不可读"的区分是**结构性**的：ref 不可读时整个命令在预检阶段就 fail-loud 退出，**根本不产出报告**；`absentAtRef` 只可能出现在已成功产出的报告里。两者不共用任何分支（FR-015 / Edge Case 要求）。

#### D4.2 git 侧 DigestResult 的构造

> ⚠️ **本小节的"两步探测"方案已被 implement 阶段实跑证伪，实现未采用**（正文保留原样以留痕，勿照此加固）。
> 证伪点：`rev-parse --verify --quiet <sha>:<path>` 对"路径在该 ref 下不存在"与"基线对象库损坏"
> 返回的 **exit code 与 stderr 完全相同**（均为 exit 1 + 0 字节 stderr；去掉 `--quiet` 则均为 exit 128
> ＋同一句 fatal 文案），不具备本小节所声称的"exit code 层面的结构性区分"。
> 实际实现改为：预检阶段一次性 `git ls-tree -r -z --full-tree <sha> -- plugins/spec-driver` 枚举基线子树
> （损坏时 exit≠0 → fail-loud；整体不存在时 exit 0 + 空输出），"该 ref 下不存在"**只**由这张清单判定；
> 逐文件用 `git cat-file blob <清单里的 objectSha>` 读内容，任何异常一律 fatal。
> 详见 `judge-snapshot-doctor.mjs` 的 `listBaselineEntries` / `classifyGitResult` JSDoc。

```js
/**
 * 与 judge-snapshot-io.mjs 的 computeSha256 同源：都对**原始 Buffer** 算 sha256。
 * MUST NOT 先转成 utf-8 字符串——那会在含 BOM / CRLF / 非 UTF-8 字节的文件上产出
 * 与 computeSha256 不同的摘要，凭空造出一片假 mismatch。
 */
function sha256OfBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
```

**两步探测（结构化，不解析 stderr 文本）**：

1. **存在性探针**：`git -C <projectRoot> rev-parse --verify --quiet <resolvedSha>:<relPath>`
   - exit 0 → 该 rev 下路径存在，stdout 是 blob 的 sha1
   - exit 非 0（`--quiet` 下无 stderr）→ 路径不存在 → `{ status: 'missing', sha256: null }`（这是 FR-015 的 (b) 正常态）
2. **内容读取**：`git -C <projectRoot> cat-file blob <上一步的 blobSha1>`，`encoding: 'buffer'`
   - exit 0 → `{ status: 'ok', sha256: sha256OfBuffer(stdout) }`
   - exit 非 0 → **fatal**（对象存在却读不出来 = 仓库损坏，不是"文件不存在"）

**为什么不直接 `git show <ref>:<path>` 然后把非零当 missing**：`git show` 的非零退出既可能是"路径不存在"也可能是"对象损坏 / I/O 错误"，唯一的区分手段是匹配 stderr 文本，而 stderr 文本受 git 版本与 locale 影响。用 `rev-parse --verify --quiet` 做存在性判定把这个区分变成 exit code 层面的结构性事实，不依赖任何文本匹配。代价是每个文件 2 次 spawn（10 文件 = 20 次），对一个开发者手动触发的 doctor 命令完全可接受，不为此引入 `cat-file --batch` 协议解析（YAGNI）。

- `relPath` 用 `plugins/spec-driver/<JUDGE_FILE_SET[i]>` 的 **POSIX 形式**（`path.posix.join`）。git 的路径规格恒用 `/`，用 `path.join` 在 Windows 上会产出 `\` 而失败。
- `maxBuffer` 显式设为 32 MB；`result.error` 为 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 时按 fatal 处理。
- `[待 implement 实跑确认]`：`rev-parse --verify --quiet <sha>:<path>` 对"路径不存在"的确切 exit code（预期 1）、`--quiet` 是否真的抑制 stderr、以及 `git -C` 在 projectRoot 为 git 仓库子目录时的行为，**必须由 T005 实跑记录**，不得纸面假设。

#### D4.3 fail-loud 面（本项最重要的安全性裁决）

三种失败语义**分开三条独立分支**，其中 (a)(c) 在**预检阶段**判定，一次性、与逐文件循环完全隔离：

| 情形 | 判定手段（预检，在任何 per-file 操作之前） | 处置 |
|------|------------------------------------------|------|
| **(c)** `git` 不可执行 / spawn 失败 | `spawnSync('git', ['-C', projectRoot, 'rev-parse', '--git-dir'])` 返回的 `result.error !== undefined`（如 ENOENT） | fail-loud：stderr 写 `--since 无法执行：git 不可用（<code>）`，exit 1，**stdout 完全为空** |
| **(a-1)** 当前目录不是 git 仓库 | 同一次调用 `status !== 0` | fail-loud：stderr 写 `--since 无法执行：<projectRoot> 不在 git 仓库内`，exit 1，stdout 为空 |
| **(a-2)** `<ref>` 无效 | `spawnSync('git', ['-C', projectRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])`，`status !== 0` | fail-loud：stderr 写 `--since 无法执行：无效的 git ref「<ref>」`，exit 1，stdout 为空 |
| **(b)** ref 合法但该文件在此 ref 下不存在 | 逐文件的存在性探针 exit 非 0 | **正常态**：`{ status:'missing', sha256:null }` + `absentAtRef: true`，报告照常产出 |
| **(d)** ref 合法、文件存在但内容读取失败 | 内容读取 exit 非 0 或 `result.error` | fail-loud：stderr 写 `--since 无法读取 <ref>:<path> 的内容（git 对象存在但不可读）`，exit 1，stdout 为空 |

**结构性隔离**：`<ref>` 的有效性只在预检判**一次**，并把它解析成一个 40 位 commit sha（`--verify` 的 stdout），后续所有 per-file 操作都用这个 sha 而不是原始 ref 字符串。于是走到 per-file 阶段时，"路径不存在"是那里**唯一**可能的负结果——(a) 与 (b) 在代码结构上根本不可能落进同一分支，而不是靠开发者记得写 if 去区分。这直接满足 FR-015 与 Edge Case"MUST 与 ref 不可读的报错路径明确区分，不得共用同一处理分支"。

`--end-of-options` 防止形如 `--foo` 的 ref 被 git 当成选项。`[待 implement 实跑确认]`：`--end-of-options` 在 CI 的 git 版本上可用（Node 20 runner 的 git ≥ 2.24 应支持）；若不可用则退化为在 ref 前加 `--`（记录实测结果）。

#### D4.4 `--since` 模式的 exit code

**裁决**：**维持诊断非门禁 = 正常产出报告时恒 exit 0**（无论 delta 里有多少 `introduced`）；**参数 / 环境类错误走既有 exit 1 语义**。

边界说得更死一点：

- `--since` 缺值（`--since` 后面没有参数或跟了另一个 `--flag`）→ `parseArgs` 返回 `{ok:false}` → 既有分支：stderr + exit 1 + stdout 空。与 `--project-root` 缺值完全同构。
- 预检 fail-loud (a)(c) 与 per-file fatal (d) → exit 1 + stdout 空。这些是"**环境不满足，本次诊断根本没跑成**"，与"跑成了，结论是 drift"是两回事。既有 CLI 测试已把"错误只走 stderr、stdout 为空"钉成不变量，本裁决与之一致。
- 正常产出（含大量 `introduced`）→ exit 0。FR-016 明确"不破坏 `main` 恒 exitCode 0（诊断非门禁）的既有定位"。

被否方案：`introduced > 0` 时 exit 1。否决理由——那会把 doctor 从诊断工具变成门禁，与 F236 FR-009 的定位直接冲突，且会让任何接了 `judge:doctor --since` 的脚本在正常开发中随机变红。

#### D4.5 不带 `--since` 输出逐字节不变（SC-004）的保障手段

**结构性保障（第一道）**：`formatReport(result, projectRoot)` **一行都不改**。`--since` 的输出是一个**独立函数** `formatSinceSection(deltaFiles, ref, resolvedSha)` 的返回值，由 `main` 在 `formatReport` 结果之后拼接：

```js
const report = formatReport(result, parsed.projectRoot);
const output = parsed.since === undefined
  ? report
  : `${report}\n${formatSinceSection(delta, parsed.since, resolvedSha)}`;
process.stdout.write(`${output}\n`);
```

被否方案：在 `formatReport` 内部加 `if (since)` 分支。否决理由——那会让"不带 `--since`"的路径也流经新写的代码，逐字节不变就只能靠测试兜底；外提之后"不带 flag 时新代码根本不执行"是可以被 code review 一眼看穿的结构事实。

**验证手段（第二道，T003）**：改动前先采基线：

```bash
node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs > /tmp/f278-doctor-before.txt 2>/tmp/f278-doctor-before.err
```

改动后在**同一台机、同一个 cwd、同一份 env**（尤其 `CLAUDE_PLUGIN_ROOT`）重跑并 `diff`，要求为空。

⚠️ 采样注意：报告里的 `projectRoot` / `snapshotPath` 含本机绝对路径，且 `resolutionSource` 依赖本机安装态——基线**必须**在同一环境采，跨机/跨 cwd 的 diff 无意义。基线采样任务（T003）**必须排在任何代码改动之前**，否则拿不到 before。

#### D4.6 `--since` 报告区块格式（定稿）

```
增量视图（相对 <ref> → <resolvedSha 前 12 位>）：
  [introduced]   scripts/lib/fix-compliance-core.mjs        (基线 match → 当前 mismatch)
  [pre-existing] scripts/record-workflow-run.mjs            (基线 mismatch → 当前 mismatch)
  [unchanged]    scripts/fix-compliance-judge.mjs           (基线 match → 当前 match)
  [added-since]  scripts/lib/in-flight-verdict.mjs          (基线 missingBoth → 当前 missingInSnapshot, 该 ref 下不存在)

增量汇总: 7 unchanged / 1 introduced / 1 added-since / 1 pre-existing
```

汇总行的分档顺序即 `DELTA_VOCABULARY` 的顺序（`unchanged / introduced / added-since / resolved / pre-existing / indeterminate`），计数为 0 的档不打印。`added-since` **必须**出现在汇总行里——旁注方案正是在这里把它整个吞掉的。

- 当整体 `status` 是 `not-applicable` 或 `indeterminate(resolution)` 时，`result.files` 为空数组——此时**不静默省略**增量区块，而是打印一行诚实说明：
  `增量视图（相对 <ref>）：无文件明细可叠加（当前诊断状态为 <status>，未进入逐文件比较阶段）`
- 增量区块用词与既有 `formatReport` 的"修复建议黑名单"兼容：不出现「建议」「请运行」「修复」「重新安装」等词（既有 CLI 测试 `assertNoRemediation` 会扫 stdout）。`[待 implement 实跑确认]`：新增文案逐词对照该黑名单（`建议 / 重新安装 / 重装 / 请运行 / 修复 / reinstall / 同步快照 / 覆盖快照`）。

---

### D5 — 项① "文件是否在图中"的判定口径

#### D5.1 取 file part 的方式

**用 `moduleFileFromId(id)`（已由 `query-helpers.ts` 导出，且 `agent-context-tools.ts` 顶部已 import 它）**，不用 `split('::')[0]`。

理由：`moduleFileFromId` 的口径是"取 `::` 与 `#` 中**最早**出现的那个作为 cut 点"（`query-helpers.ts:708-715`），同时兼容 F151 新格式与旧 panoramic `#` 格式——同一份图里两种格式可能并存。`split('::')[0]` 对 `src/a.py#foo` 会返回整串，判定必然落空，而这类 id 恰恰是"图陈旧"最常见的形态之一，属于本卡要修的场景本身。

#### D5.2 分支表（含无分隔符的输入）

| 输入形态 | `moduleFileFromId` 返回 | `findNode(graphData, filePart)` | hint |
|---------|------------------------|--------------------------------|------|
| `src/a.ts::newFn`，`src/a.ts` 在图中 | `src/a.ts` | 命中 | **新文案** |
| `src/a.ts::newFn`，`src/a.ts` 不在图中 | `src/a.ts` | null | 原文案 |
| `src/a.py#foo`，`src/a.py` 在图中 | `src/a.py` | 命中 | **新文案** |
| `newFn`（无 `::`/`#`，纯名字） | `newFn` | 几乎必然 null | 原文案 |
| `src/a.ts`（纯 module id，无分隔符） | `src/a.ts` | 理论上可能命中 | 见下 |

关于最后一行：能走到 `symbol-not-found` 分支，前提是 `canonicalizeSymbolId` 已返回 `not-found` 且 fuzzy 未 `autoResolved`。若 `findNode(graphData, 'src/a.ts')` 能命中，通常 canonicalize 早已命中、根本走不到这里。但 canonicalize 可能做 projectRoot 相对化等归一化，理论上存在"canonicalize 判 not-found 而 exact node 存在"的缝隙。**这个缝隙无害**：此时新文案说的"该文件已在图中"是**事实**，不构成误导。不为这条理论缝隙加额外分支（spec Edge Case 已裁定"逻辑上自动成立，不需要额外分支"）。

#### D5.3 判定函数

用 `findNode(graphData, filePart)`（同样已 import）。module 节点的 id 就是相对文件路径——code-context §1 已给出 pinned 样本实证 `{"id":"src/go/main.go","kind":"module"}`。**不额外校验 `kind === 'module'`**：如果某个 id 恰好是文件路径但 kind 不是 module，"该文件已在图中"依然是事实；加 kind 校验只会在图的 kind 标注不规范时把新文案误判回原文案。

#### D5.4 共用 helper（FR-002 的结构性保障）

**放哪**：`src/mcp/agent-context-tools.ts` 文件内的 module-private 函数，紧邻 `loadGraphOrError` 之后（都是该文件的错误响应装配 helper）。

- 被否方案：放 `src/mcp/lib/tool-response.ts` 或新建 `src/mcp/lib/symbol-hint.ts`。否决理由——只有两个调用点、且都在同一文件内；提到 lib/ 需要新建文件 + 新增 import + 扩大导出契约面，收益为零（宪法 III）。若将来 `view_file` 被纳入（本卡明确不纳入，FR-004），届时再提，那时才有第三个调用点这一真实驱动。
- **两处 MUST 调用同一个 helper**，绝不允许各写一份 `findNode(...) ? A : B`——两份 copy 必然漂移，而"两处 hint 各写各的"正是本卡要修的病本身。

**签名**：

```ts
/**
 * `symbol-not-found` 的 hint 分流（FR-001/FR-002）。
 *
 * 为什么要分流：符号找不到有两种成因，指向完全相反的动作。文件本身不在图中 → 多半是 id
 * 写错了，翻 fuzzyMatches 有用；文件在图中而符号不在 → 多半是图陈旧（符号是新增/新导出的），
 * 这时让 agent 反复校对 id 拼写是把它推向错误方向，白白烧执行轮次。
 *
 * fallbackHint 由调用方传入而非在此写死：impact 与 context 的**原**文案本就不同
 * （'请检查 symbol id 格式…' vs '请检查 id 格式…'），FR-001 要求未命中时逐字保持现状，
 * 只有**新**文案要求两处一致（FR-002）。
 */
function symbolNotFoundHint(
  graphData: Readonly<GraphJSON>,
  requestedId: string,
  fallbackHint: string,
): string {
  return findNode(graphData, moduleFileFromId(requestedId)) !== null
    ? SYMBOL_NOT_FOUND_STALE_GRAPH_HINT
    : fallbackHint;
}
```

#### D5.5 新文案逐字定稿（implement 直接抄，不得自由发挥）

```ts
const SYMBOL_NOT_FOUND_STALE_GRAPH_HINT =
  '该文件已在图中、但其中没有这个 symbol —— 通常意味着它是新增或新导出的符号，当前图尚未收录。' +
  '请先运行 `spectra batch --mode graph-only` 重建图（纯 AST · 零 LLM · 无需认证 · <2min）后重试；' +
  '若确认该符号早已存在，再参考 fuzzyMatches 候选核对 id。';
```

两处调用点改法（其余一行不动）：

```ts
// impact（原 agent-context-tools.ts:221-226）
return { result: buildErrorResponse(
  'symbol-not-found',
  `target 在 graph 中未找到: ${args.target}`,
  symbolNotFoundHint(graphData, args.target, '请检查 symbol id 格式或参考 fuzzyMatches 候选'),
  { fuzzyMatches: fuzzy.candidates.slice(0, 3) },
) };

// context（原 agent-context-tools.ts:372-377）
return { result: buildErrorResponse(
  'symbol-not-found',
  `symbolId 在 graph 中未找到: ${args.symbolId}`,
  symbolNotFoundHint(graphData, args.symbolId, '请检查 id 格式或参考 fuzzyMatches 候选'),
  { fuzzyMatches: fuzzy.candidates.slice(0, 3) },
) };
```

`message`、`error.code`、`fuzzyMatches` 三者逐字不动（FR-003）。

---

### D6 — 红先行顺序与变异测试设计

统一纪律：**每条红先行任务与其实现任务是两条独立任务**；红先行任务的验收标准是"实跑该用例并观察到它 **FAIL**"，而不是"我认为它会 fail"。若红先行跑出来是绿的，说明用例没测到目标行为，**必须先修用例**再进实现任务。

#### 项① 红先行（T007，文件 `tests/unit/mcp/agent-context-tools.test.ts`）

复用该文件既有的 `setMockGraph()` mock 图（含 module 节点 `fixture/engine.py`、`fixture/nn.py`）。四条用例：

| # | 输入 | 断言 | 改前预期 |
|---|------|------|---------|
| 1 | `handleImpact({ target: 'fixture/engine.py::zzzBrandNewSymbol' })` | `e.code === 'symbol-not-found'` ∧ `e.hint` 含 `'新增或新导出的符号'` ∧ `Array.isArray(e.context.fuzzyMatches)` | **红**（hint 是原文案） |
| 2 | `handleContext({ symbolId: 'fixture/engine.py::zzzBrandNewSymbol' })` | 同上，且 hint 与用例 1 的 hint **逐字相等**（FR-002 的直接断言） | **红** |
| 3 | `handleImpact({ target: 'fixture/ghost.py::whatever' })` | `e.hint === '请检查 symbol id 格式或参考 fuzzyMatches 候选'` | 绿（对照组，锁定不回归） |
| 4 | `handleContext({ symbolId: 'fixture/ghost.py::whatever' })` | `e.hint === '请检查 id 格式或参考 fuzzyMatches 候选'` | 绿（对照组） |

- 符号名刻意取 `zzzBrandNewSymbol`：必须确保 `resolveSymbolFuzzy` **不会** `autoResolved`（否则根本走不到 `symbol-not-found` 分支）。用例里额外断言 `e.code === 'symbol-not-found'` 即可暴露这一点。`[待 implement 实跑确认]`：若该名字意外被 auto-resolve，换一个与图中所有符号编辑距离更远的名字，并在注释里写明为什么换。
- 用例 3/4 用 `fixture/ghost.py`（mock 图中不存在的 module）作为"文件不在图中"的对照。
- 额外断言：四条用例都检查 `e.context.fuzzyMatches` 的数组结构未变（FR-003）。

#### 项② 红先行 + 变异测试（T010，文件 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`，加在既有"扰动注入组 ①"describe 内，与既有 5 条并列）

**两个方向的变异（FR-010 硬要求）**：

| # | 变异 | 断言 | 改前预期 |
|---|------|------|---------|
| M1 | `deepClone(rebuiltGraph)`，找到第一个 `metadata.lineRange !== undefined` 的节点，`delete node.metadata.lineRange` | `mismatch === true` ∧ `differences.join('\n')` 同时含 `'metadata key 集合不一致'`、该节点 id、`'lineRange'` | **红**（当前比较器对 metadata 完全失明） |
| M2 | `deepClone(rebuiltGraph)`，给第一个节点 `metadata.__mutantKey = 1` | `mismatch === true` ∧ differences 含 `'__mutantKey'` | **红** |
| M3 | `deepClone(rebuiltGraph)`，`delete node.metadata`（整个字段删掉，制造 `undefined`） | `mismatch === true` ∧ differences 含 `'metadata 缺席态不一致'` ∧ 含 `'<absent>'`（FR-007 的直接断言） | **红** |

**既有 5 条扰动用例不回退的验证（T012）**：不改动既有 5 条用例一个字符，跑
`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 并逐条核对判定结果与改动前相同（删边→红 / 改 id→红 / 重复节点→红 / 乱序→绿 / 重复边→红）。特别关注**乱序判一致**那条：新维度按 id 分组，天然顺序无关，但若实现里误用了下标配对就会把它判红——这条用例是新维度是否引入顺序敏感性的探针。

**活性证明（T004，排在实现之前；T013 在实现之后复核）**：见 D2.1 / D2.2。

#### 项③ 红先行（T015，文件 `tests/integration/collector-fingerprint-regen-script.test.ts`，加在既有 `--init 冷启动路径` describe 内）

| # | 场景 | 断言 | 改前预期 |
|---|------|------|---------|
| A1 | 临时副本删掉两份 pinned 资产 → 跑 `--init` | `regen-audit.jsonl` 存在；最后一行 `JSON.parse` 后 `trigger === '--init'`、`timestamp` 可被 `Date.parse` 解析且在本次运行的时间窗内、`fixtureInputHash` 为 64 hex 且与落盘资产里的 `fixtureInputHash` 相等、`assets` 含两个资产文件名 | **红**（文件不存在） |
| A2 | 临时副本保留两份资产 → 跑 `--init`（触发 C-002 拒绝） | 退出码非 0 ∧ `regen-audit.jsonl` **不存在**（或行数与运行前相同）（FR-020） | 改前"绿"但无意义（文件本就不存在）→ **必须先跑 A1 让文件存在**，A2 用"运行前后行数相等"断言才有守护力 |

A2 的构造要点（避免假绿）：先在临时副本里**预置**一份 `regen-audit.jsonl`（写一行占位记录），记录行数，再跑被 C-002 拒绝的 `--init`，断言行数未变且退出码非 0。否则"文件不存在 → 断言不存在"是恒真的空断言。

#### 项④ 红先行（T018，文件 `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs`）

需要一个 helper 在临时目录 `git init` 并造两个 commit（前后内容不同的判定器文件）：

| # | 场景 | 断言 | 改前预期 |
|---|------|------|---------|
| S1 | 非 git 目录 + `--since HEAD~1` | `status === 1` ∧ `stderr` 非空 ∧ `stdout === ''`（FR-015 (a-1)，**不得**出现 10 个文件全 `introduced` 的报告） | **红**（`--since` 是未知参数 → 恰好也 exit 1 但 stderr 文案不同）→ 断言必须钉到 stderr 含 `'git 仓库'` 字样才有区分力 |
| S2 | 合法 git 仓 + `--since <不存在的 ref>` | `status === 1` ∧ stderr 含 `'无效的 git ref'` ∧ `stdout === ''`（FR-015 (a-2)） | **红** |
| S3 | 合法 git 仓 + `--since <首个 commit>`，其中某文件在两 commit 间被改过、snapshot 与**当前** repo 一致 | `status === 0` ∧ stdout 含 `'增量视图'` ∧ 含 `[resolved]` 或 `[introduced]`（按构造） | **红** |
| S4 | 合法 git 仓 + `--since <首个 commit>`，某文件在首个 commit 下**不存在** | `status === 0` ∧ 该文件行含 `'该 ref 下不存在'`（FR-015 (b)，与 S1/S2 的报错路径完全不同） | **红** |
| S5 | 不带 `--since` 跑（既有场景） | stdout 与不带 flag 的既有断言完全一致；`assertNoRemediation(stdout)` 通过 | 绿（对照组） |

**新增用例 MUST 从 `../scripts/lib/judge-snapshot-core.mjs` import `JUDGE_FILE_SET`**，而不是再抄一份硬编码数组（既有测试文件顶部有一份硬编码副本，本卡**不动它**，但新增部分不再复制该反模式）。理由见风险 R-1：F276 若改动判定器 import 闭包会改 `JUDGE_FILE_SET`，import 版本自动跟随，硬编码版本会在 rebase 后假红。

---

## Project Structure

### 写入路径清单（精确到文件）

| 路径 | 动作 | 归属项 |
|------|------|--------|
| `src/mcp/agent-context-tools.ts` | 改（新增 1 常量 + 1 helper，替换 2 处 hint 实参） | ① |
| `tests/unit/mcp/agent-context-tools.test.ts` | 改（+4 用例） | ① |
| `scripts/regen-collector-fingerprint-fixtures.ts` | 改（+2 顶层函数、`compareGraphOnlyStructure` +2 行；`runRegen` 的 `--init` 成功路径 +1 次审计写调用 + 1 个写审计的函数） | ② ③ |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | 改（+3 变异用例） | ② |
| `tests/integration/collector-fingerprint-regen-script.test.ts` | 改（+2 用例） | ③ |
| `tests/fixtures/collector-fingerprint-guardrail/README.md` | 改（「禁止事项」+1 条，人工撰写） | ③ |
| `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` | 改（`parseArgs` +1 分支、+4 个新函数、`main` +拼接分支） | ④ |
| `plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` | 改（+1 git helper +5 用例） | ④ |
| `specs/278-honest-tooling-patches/plan.md` / `tasks.md` | 新建（本次） | — |

**明确不写入**（对照 spec Out of Scope）：`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`、`src/mcp/file-nav-tools.ts`、`src/mcp/graph-tools.ts`、`src/mcp/server.ts`、`src/panoramic/graph/collector-fingerprint.ts`、`tests/fixtures/collector-fingerprint-guardrail/expected-*.json`、`vitest.config.ts`、`.github/workflows/ci.yml`、`plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`。

### 与 F276 / F277 的 disjoint 核对

| 并行卡 | 其改动面（按编排器给定描述） | 与本卡是否 disjoint | 依据 |
|-------|------------------------------|-------------------|------|
| **F276** | `plugins/spec-driver/scripts/` 下的**判定器族**（`fix-compliance-*.mjs` 及其 `lib/` 依赖） | **文件级 disjoint，但有一处间接耦合** | 本卡在该目录下只碰 `judge-snapshot-doctor.mjs`（F236 的快照漂移诊断 CLI），它**不属于** fix-compliance 判定器族——`JUDGE_FILE_SET` 里列的 10 个文件是它的**观测对象**，不是它自己。本卡另一硬约束是 FR-013 禁改 `lib/judge-snapshot-core.mjs`，而那正是 F276 唯一可能触及的共享文件 |
| **F277** | `agents/` 与 SKILL 散文 | **完全 disjoint** | 本卡不写任何 `agents/**` 或 `*.md` skill 文件（唯一改的 md 是 fixture README） |

⚠️ **`judge-snapshot-doctor.mjs` 仍与 F276 disjoint 的完整论证**：它位于 `plugins/spec-driver/scripts/` 下，但 F276 的改动面是"fix-compliance 判定器族"，即 `JUDGE_FILE_SET` 枚举的那 10 个文件加它们的 lib 依赖。doctor 是**读这 10 个文件的摘要**的诊断工具，与被读对象不是同一文件。两卡在同一目录下改不同文件，git 可无冲突合并。

**但这里有一条真实的间接耦合，登记为 R-1（见下）**：若 F276 增删了判定器的 import 闭包成员，`JUDGE_FILE_SET`（在 core.mjs 里）会变；本卡新增的 `--since` 测试若硬编码 10 个文件名，rebase 后会假红。缓解措施已写进 D6 项④：新增用例 import `JUDGE_FILE_SET` 而非硬编码。

### 架构图

```mermaid
graph TD
  subgraph "① src/mcp（MCP 工具面）"
    A1[handleImpact] -->|symbol-not-found 分支| H[symbolNotFoundHint<br/>module-private]
    A2[handleContext] -->|symbol-not-found 分支| H
    H --> Q1[moduleFileFromId]
    H --> Q2[findNode]
    Q1 -.query-helpers.ts 既有导出.-> H
    Q2 -.query-helpers.ts 既有导出.-> H
  end

  subgraph "②③ scripts/regen-collector-fingerprint-fixtures.ts"
    C[compareGraphOnlyStructure] --> D1[节点 id multiset · 既有]
    C --> D2[边 multiset · 既有]
    C --> D3[compareNodeMetadataKeys · 新增]
    D3 --> SIG[metadataKeySignature · 新增]
    R[runRegen] --> C
    R -->|--init 成功且已过 swap 提交点| AU[appendRegenAudit · 新增]
    AU --> JL[(regen-audit.jsonl<br/>fixture 根目录)]
    G1[collector-fingerprint-guardrail.test.ts] --> C
    G2[graph-quality-pinned-staleness.test.ts] --> C
  end

  subgraph "④ plugins/spec-driver/scripts/judge-snapshot-doctor.mjs"
    M[main] --> P[parseArgs · +--since]
    M --> CK[checkJudgeSnapshotDrift · 未改]
    M --> FR[formatReport · 一行未改]
    M -->|仅当 --since| PRE[preflightGitBaseline · 新增<br/>ref 有效性判一次 → resolvedSha]
    PRE -->|fail-loud| EXIT[stderr + exit 1 + stdout 空]
    PRE --> DG[digestAtRef · 新增<br/>rev-parse 存在性 → cat-file 内容]
    DG --> CF[compareFile · core 既有导出，未改]
    CF --> DL[deriveDelta · 新增 5 词表]
    DL --> FS[formatSinceSection · 新增独立函数]
    FS --> M
  end

  style D3 fill:#d4f4dd
  style AU fill:#d4f4dd
  style PRE fill:#ffe0e0
  style H fill:#d4f4dd
```

---

## Complexity Tracking

| 决策 | 更简单的方案 | 为什么不采用 |
|------|------------|------------|
| D1：metadata 差异分"单节点富诊断"与"通用 multiset"两个分支 | 只留 multiset 分支，全部报计数差异 | 单节点是 100% 的现实场景（pinned 22 节点全部 id 唯一），只报"签名计数 1 vs 1 不一致"读者根本看不出是哪个 key 丢了——护栏变红却说不清为什么红，等于把排查成本转嫁给下一个人 |
| D1.1：`metadataKeySignature` 分三档（`<absent>` / `<non-object:*>` / key 列表） | 两档（有 / 无） | FR-007 硬要求区分 `undefined` 与 `{}`；`<non-object:*>` 是额外 2 行，避免把"metadata 是个字符串"这种真缺陷折叠成"没有 metadata" |
| D4.2：两步 git 探测（`rev-parse` 存在性 + `cat-file` 内容） | 一步 `git show`，非零即 missing | 一步方案无法区分"路径不存在"与"对象损坏"，唯一区分手段是匹配 stderr 文本（受 git 版本 / locale 影响）。两步方案把区分变成 exit code 层面的结构性事实。代价是 20 次 spawn，对手动触发的 doctor 完全可接受 |
| D4.3：ref 有效性在预检判一次并解析成 sha | 逐文件调用时顺便判 | 逐文件判会让 (a)"ref 无效"与 (b)"文件在该 ref 下不存在"落进同一个分支——这正是 FR-015 点名的头号 fail-open 陷阱。预检后 per-file 阶段的负结果只剩一种解释，是结构性隔离而非靠开发者记得写 if |
| D4.5：`formatSinceSection` 外提为独立函数 | 在 `formatReport` 内加 `if (since)` | 外提后"不带 flag 时新代码根本不执行"是 code review 可一眼看穿的结构事实；内加分支则逐字节不变只能靠测试兜底 |
| D3.2：JSONL 而非 JSON 数组 | JSON 数组 | 数组要 read→parse→push→write，文件一旦损坏整条链失败；JSONL `appendFileSync` 一行搞定 |
| D1.4 / R-3：边 metadata 不纳入 | 顺手把边也比了 | 边缺少可分组的身份键，只能退回已证零检测力的"全图并集"，或改动被 FR-008 禁止的既有边维度判定逻辑 |
| T001：新增逻辑外提为顶层函数而非拆文件 | 拆到 `scripts/lib/` | 测试文件头注释明确"比较器从再生脚本 import，分叉即护栏永久绿"，3 个消费方依赖当前 import 路径 |

---

## 风险与已知残留

| # | 项 | 描述 | 处置 |
|---|----|----|------|
| **R-1** | ④ | **F276 若改动判定器 import 闭包 → `JUDGE_FILE_SET` 变化 → 硬编码 10 个文件名的测试在 rebase 后假红**。既有 `judge-snapshot-doctor-cli.test.mjs:28-40` 就有一份硬编码副本 | 缓解：本卡**新增**用例一律 `import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs'`。既有硬编码副本**不动**（不扩大范围），但在新增代码旁写一行注释说明为什么新代码不复制它。rebase 到含 F276 的 master 后必须重跑 `npm run test:plugins` |
| **R-2** | ④ | FR-013 的 BLOCKED 安全网：若 implement 发现 `compareFile` 之外还需要 core 的未导出能力 | code-context §4(b) 已核实不需要。若实际遇到反例：**立即停止**，把 US3 标 BLOCKED 回报编排器，**不得**擅自改 core |
| **R-3** | ② | **边侧 metadata 不纳入比较**（D1.4 裁决）。边的 metadata 增删仍处于护栏盲区 | 登记为已知残留，不在本卡修。根因是边缺少可分组身份键，要修得先改边的比较维度（FR-008 禁止） |
| **R-4** | ② | 新档位可能让当前 pinned 基线判红（真漂移 or 资产陈旧） | D2.2 已预写处置分叉。**任何情形下都不得**用 `--init` / bump `BEHAVIOR_VERSION` 求绿；判红即停下回报 |
| **R-5** | ③ | `regen-audit.jsonl` 入库后是否被 `npm run repo:check` 的某条同步校验意外覆盖 | `[待 implement 实跑确认]`：T023 实跑 `repo:check`。预期为零影响（repo:check 校验的是 source-of-truth ↔ 包装层同步链，不枚举 `tests/fixtures/` 文件清单） |
| **R-6** | ④ | `--end-of-options` / `rev-parse --verify --quiet <sha>:<path>` 的确切 exit code 与 stderr 形态未实测 | `[待 implement 实跑确认]`：T005 是专门的实跑确认任务，必须在写 `--since` 实现之前完成并把观测结果写进代码注释 |
| **R-7** | ① | 红先行用例的符号名 `zzzBrandNewSymbol` 可能被 `resolveSymbolFuzzy` 意外 auto-resolve | `[待 implement 实跑确认]`：用例断言 `e.code === 'symbol-not-found'` 会直接暴露；若命中则换名并注释说明 |
| **R-8** | 全局 | 本 worktree 的 `.spectra/graph.json` 已 stale（sourceCommit `25992316` vs HEAD `e01611b2`），MCP `impact` 结果不可全信 | 已知环境事实，非缺陷。本 plan 的 caller 分析用 MCP `impact` 取得后已用 Grep 复核（`compareGraphOnlyStructure` 的 3 个消费方与 Grep 结果一致） |
| **R-9** | 全局 | 预存 flaky（watch-command / batch-orchestrator-incremental / community-analysis perf / cli-e2e `--version`）在满载全量跑时可能红 | 收尾任务里遇到这几个先**隔离重跑**再判归属，不得当作本卡回归 |

### graph-not-built 恢复提示五处不一致 —— 处置裁决

spec Edge Cases 已裁定"本卡不承诺统一改写，顺手可对齐、改不动则维持现状，不作为验收项"。本 plan 实读五处后给出明确裁决：**一处都不改，全部维持现状**。

实测的差异面（实读，非推断）：

| 位置 | 文案 |
|------|------|
| `agent-context-tools.ts:132` / `:152` | `请先运行 \`spectra batch --mode graph-only\` 快速建图（纯 AST · 零 LLM · 无需认证 · <2min）；需要完整 spec 关系图再跑 \`spectra batch\`` |
| `file-nav-tools.ts:140` | 与上**逐字相同** |
| `graph-tools.ts:184` | 同一句，仅"请先运行"→"**优先**运行" |
| `server.ts:61` | 不是 error hint，是 server instructions 里的一段散文恢复流描述，结构上无法与 error hint 统一 |

即所谓"五处不一致"，实际只剩 `graph-tools.ts:184` 一个词的差异（`请先` vs `优先`）+ 一处结构不同的散文。**不改的理由**：(1) 改 `graph-tools.ts` 会把本卡的写入路径扩大到第 4 个源文件，而该文件在本卡零验收覆盖；(2) F271 已有 `tests/integration/f271-graph-recovery-hint.test.ts` 把这五处钉在"不含 `spectra index` ∧ 含 `graph-only`"这一条不变量上——两条文案在该不变量下**已经等价**，动它只增加改坏 F271 守护的风险而不提升任何可测属性；(3) M10 §5 P1-E 是独立登记项，应整体处理（含 `server.ts` 那段散文的结构性问题），而不是在本卡里改一个词造成"看起来做过了"的假象。

---

## 不做的事

复述 spec Out of Scope：

- `src/mcp/file-nav-tools.ts:150-165`（`view_file` 的 `symbol-not-found` hint）
- `agent-context-tools.ts:385` 与 `file-nav-tools.ts:103` 两处防御性 `symbol-not-found` 分支
- graph-not-built 恢复提示的统一改写（M10 §5 P1-E）
- `compareGraphOnlyStructure` 的 metadata **值**级比较
- 节点 id multiset / 边 multiset 两个既有维度的判定逻辑
- `BEHAVIOR_VERSION` bump
- `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`
- 常规（非 `--init`）再生路径的留痕
- `vitest.config.ts` / `.github/workflows/ci.yml` 等测试基础设施
- `plugins/spec-driver/scripts/fix-compliance-*.mjs`、`plugins/spec-driver/hooks/**`

plan 层新决定不做的：

- **边侧 metadata 的 key 比较**（D1.4，登记为 R-3）
- **把两轨比较器抽到 `scripts/lib/`**（T001 清理裁决的被否方案 A）
- **把 `symbolNotFoundHint` 提到 `src/mcp/lib/`**（D5.4 被否方案）
- **给 `--since` 加 `introduced > 0 → exit 1` 的门禁语义**（D4.4 被否方案）
- **在本卡预先创建 / 补写 `regen-audit.jsonl` 的历史条目**（D3.5：那是伪造留痕）
- **修改既有 `judge-snapshot-doctor-cli.test.mjs` 顶部那份硬编码 `JUDGE_FILE_SET` 副本**（R-1 只约束新增代码，改既有副本属范围外）
- **`git cat-file --batch` 批量协议优化**（D4.2：20 次 spawn 对手动 doctor 完全够用，YAGNI）
