# Verification Report: F232 — CI 门禁六重失效

> ## ⚠️ 本报告的验证覆盖到「五链（A–E）」为止，**尚未覆盖后续追加的内容**
>
> codex 第二轮对抗审查在本报告完成后追加了以下改动，**必须重跑 verify 才能形成最终判定**：
>
> | 追加项 | 内容 | 对本报告的影响 |
> |---|---|---|
> | **链 F（新增根因链）** | `tests/integration/watch-command.test.ts` 对主机进程表的真实 `pgrep` 查询 → mock `node:child_process.execSync` 隔离 + waitFor 超时 5s→20s | 本报告下方「非阻断性观察项 5」把该文件归为"预存 flaky"，**该归类已被证伪**（诱饵进程装置下可 100% 复现），须整条改写 |
> | **T025（新增单测）** | `tests/panoramic/anchoring/edge-builder.test.ts` 补 4 个量化契约用例（含"去重仍用原始值"守护） | 本报告「链 E 验证」第 3 点只核到既有 50 passed，现为 54 passed（edge-builder 单文件 16 passed） |
> | **链 D 断言改写** | `indexOf`+`slice` → `path.relative(VERIFIED_ROOT, combDir)` 等式 | 本报告「Layer 1.75 链 D 调用链」对 `indexOf` 截断的核实已不适用于当前实现 |
> | **三处措辞收窄** | "全图唯一写入点" / "消除跨平台差异" / "不影响所有消费方" 均被 codex 判为过度声称 | 本报告沿用了前两处表述，已在下方就地更正 |
>
> 变更范围也已从 6 个已跟踪文件扩到 **7 个**（新增 `tests/integration/watch-command.test.ts`）。

**特性分支**: `claude/mystifying-gagarin-5ca56b`
**验证日期**: 2026-07-28（本次为增量更新：在既有 A/B/C 验证基础上补验新增的链 D / 链 E，并给出覆盖五链的判定；链 F 与 T025 待重跑 verify）
**验证范围**: Layer 1（Spec-Code 对齐，本 fix 为 fix 流程无 spec.md）+ Layer 1.5（验证铁律合规）+ Layer 1.75/1.8/1.9（深度检查）+ Layer 2（原生工具链）+ 合并审查（[Spec 合规] / [代码质量]）

**改动范围复核（本次实测更新）**：`git diff --stat` 实测共 6 个已跟踪文件被改动：

```
.github/workflows/ci.yml                                       | 10 ++++++
package.json                                                    |  3 +-
src/panoramic/anchoring/edge-builder.ts                          | 41 +++++++++++++++++++++-
tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap |  2 +-
tests/e2e/f220-decomposition-charter.e2e.test.ts                 |  4 +++
tests/unit/feature-176-spike-and-gate.test.ts                    | 15 ++++++--
6 files changed, 70 insertions(+), 5 deletions(-)
```

前 3 文件对应链 A/B/C（此前报告已验，结论沿用），后 3 文件对应本次新增补验的链 D（测试断言）与链 E（产品代码 + 冻结快照）。

`package.json` 的第二处 hunk（`judge:doctor` 一行）与 `plugins/spec-driver/tests/lib/`（`import-closure-*.mjs`）、`specs/231-judge-snapshot-drift-signal/` 均为 F231 未提交残留，已核实与本次 fix-report/tasks.md 无引用关系，**不计入本次评审**。

---

## Layer 1: fix-report 根因链闭合核查（五链）

fix-report 五条根因链均已核实闭合：

| 链 | 根因 | 修复点 | 闭合证据 |
|---|---|---|---|
| A | `node --test` glob 展开是 Node 21+ 能力，Node 20 exit 1 | 新增 `scripts/run-plugin-tests.mjs`，用 `readdirSync(root,{recursive:true})` 枚举文件列表交给 `node --test` | 沿用此前验证：Node 20.20.2 与 Node 24.14.0 均 exit 0 |
| B | CI 无 `npm run build`，43 个测试文件依赖 `dist/` | `ci.yml` 插入 `Build` 步骤（Type Check 之后、Test 之前） | 沿用此前验证：干净树复跑 `dist-missing` 出现次数 = 0 |
| C | CI 无建图步骤，测试硬依赖被 gitignore 的 `specs/_meta/graph.json` | `ci.yml` 插入 `Build Knowledge Graph`（`node dist/cli/index.js batch --mode graph-only`），排在 Build 之后、Test 之前 | 沿用此前验证：干净树复跑 `DRIFT_GRAPH_UNAVAILABLE` 出现次数 = 0 |
| **D（新增）** | `feature-176-spike-and-gate.test.ts:144` 用"整串搜 `/r`"表达"combo 根不含 repeatIndex 段"，在含 `/r` 的路径（`/home/runner/...`）下必然误报 | 断言截断到 `VERIFIED_ROOT_REL` 之后再匹配 `/r\d+(?:\/|$)`，并补 `runFixturePath` 等式正向对照 | 本次独立实测：19/19 pass；独立构造的变异测试证明新断言强度不弱于原断言（见下方"链 D 验证"） |
| **E（新增）** | `edge-builder.ts` 把 embedding 余弦相似度**全精度**写入图谱产物，onnxruntime 跨 CPU 架构 float32 末位差异使快照无法跨平台复现 | 出口处新增 `quantizeConfidenceScore`，量化到 4 位小数；快照定点替换 1 处字面量 | 本次独立实测：两平台原始值经量化均得 `0.7806`；独立复核了全部已知消费方对 1e-4 粒度的容忍度（见下方"链 E 验证"） |

Layer 1 覆盖率判据同前：本 fix 无 `spec.md`，故不产出 FR 对齐表，改用"根因链是否分别有独立实测闭合证据"作为覆盖判据，**五条链均满足**。

---

## Layer 1.5: 验证铁律合规

**状态：COMPLIANT**

- tasks.md 中 T001-T024 均标记 `[x]`（含新增的 T022/T023/T024，对应链 D/E），且每项均附具体命令 + 完成判据，非推测性表述
- 本次 verify 对链 D/E 做了独立复核（不采信 fix-report/tasks.md 的转述数值）：亲自 grep 全部 `confidenceScore` 消费方逐个核实粒度、亲自对真实仓库文件做了一次可逆的变异测试（临时修改 → 跑红 → 立即复原 → `git status`/`git diff` 确认零残留）
- 未检测到 "should pass" / "看起来没问题" 类推测性表述

---

## Layer 1.75: 深度检查（含链 D/E 增量）

**a. 调用链完整性**（沿用 A/B/C 结论）：`test:plugins` → `run-plugin-tests.mjs` → `spawnSync` → `process.exit(result.status ?? 1)`，退出码透传无丢失。

**链 D 调用链**：`runCombDir(taskId, cohort)` 返回绝对路径 → 测试用 `combDir.indexOf(VERIFIED_ROOT_REL)` 截断到相对段 → 对相对段做 `/r\d+(?:\/|$)` 正则匹配。已亲自核实 `VERIFIED_ROOT_REL` 与 `VERIFIED_ROOT` 的定义（`scripts/lib/swe-bench-verified-paths.mjs`），确认 `indexOf` 截断点选取正确——`VERIFIED_ROOT_REL` 是相对路径常量字符串，`combDir` 内必然完整包含该子串，不存在截断失败的边界情况。

**链 E 调用链（本次重点核实）**：`buildSemanticEdges` 内部 `dedupeMap` 用**原始**（未量化）`confidenceScore` 做去重比较（`edge.confidenceScore > (existing.confidenceScore ?? 0)`），量化只发生在函数**返回前的最后一步** `.map(...)`。已逐行读代码确认：量化调用 `quantizeConfidenceScore(edge.confidenceScore)` 位于 `return [...dedupeMap.values()].map(...)`，去重循环体（更早的代码）读取的仍是原始 `pair.similarity` 赋值，两者在时间顺序上不重叠，**"去重用原始值、返回时才量化"这一设计确实落地在代码里，非文档层面的口头声称**。

**b. 数据持久化**：本次改动不涉及数据库/文件持久化写入，N/A（新增快照文件改动属"冻结快照定点替换"，非常规持久化）。

**c. 配置贯穿**：`ci.yml` 步骤顺序沿用此前验证结论。链 D/E 不涉及配置传递。

---

## Layer 1.8: 残留扫描

本次改动不涉及删除/重命名。跳过残留扫描（同此前结论）。

**本次验证过程自查**：为核实链 D 断言强度，我本人对 `scripts/lib/swe-bench-verified-paths.mjs` 做过一次临时性变异（`runCombDir` 强行拼接 `r1`），验证完成后已立即用 `cp` 恢复原文件内容，并用 `git status --porcelain -- scripts/lib/swe-bench-verified-paths.mjs` 确认该文件零残留改动，复跑 `feature-176-spike-and-gate.test.ts` 确认 19/19 pass（详见"链 D 验证"）。

---

## Layer 1.9: 文档一致性检查

本次改动未涉及架构级变更。跳过（同此前结论）。链 D/E 分别改的是测试断言写法与产物精度表示，均未在任何 `specs/*/spec.md` 中被作为约束描述，无需更新 spec——已复核 fix-report「Spec 影响」章节的该项结论成立。

---

## 链 D 验证（本次新增，独立复核）

**核查目标**：新断言是否**不弱于**原断言（`.not.toContain('/r')`），即仍能抓住"combo 根误带 repeatIndex"的真实回归。

**方法**：不满足于 fix-report 转述的变异测试结论，本次在**真实仓库文件**上重新独立执行了一次可逆变异：

1. 备份 `scripts/lib/swe-bench-verified-paths.mjs` 到 scratchpad
2. 临时把 `runCombDir` 改为 `path.join(VERIFIED_ROOT, 'tasks', taskId, cohort, 'r1')`（真实引入 repeatIndex 段的产品级回归）
3. 跑 `npx vitest run tests/unit/feature-176-spike-and-gate.test.ts`：

```
FAIL  |unit| tests/unit/feature-176-spike-and-gate.test.ts > swe-bench-verified-paths > runCombDir 不含 repeatIndex（combo 根）
AssertionError: expected 'tests/baseline/swe-bench-verified/tas…' not to match /\/r\d+(?:\/|$)/
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
```

4. 立即用备份复原文件，`git status --porcelain -- scripts/lib/swe-bench-verified-paths.mjs` 确认输出为空（零残留），重跑确认恢复为 `19 passed (19)`

**结论**：新断言在真实产品代码回归注入下确实变红，抓住了"combo 根带 repeatIndex"这一真实缺陷，强度**不弱于**原断言。同时另用一个独立的最小复现脚本（不依赖仓库真实文件，纯逻辑模拟）交叉验证了同一结论，两条独立路径互相印证。

**附加检查**：`combDir.indexOf(VERIFIED_ROOT_REL)` 截断逻辑本身无越界风险（`VERIFIED_ROOT_REL` 恒为 `combDir` 的子串，`indexOf` 不会返回 -1 导致 `slice(-1)` 类边界问题）——已读源码确认 `runCombDir` 内部路径拼接必然包含 `VERIFIED_ROOT_REL` 对应的常量片段。

---

## 链 E 验证（本次新增，独立复核，重点章节）

### 1. 消费方粒度逐一复核（未采信 fix-report 转述，自行 grep + 读代码核实）

对 `grep -rn "confidenceScore" src/` 命中的全部消费方逐个复核 1e-4 量化容忍度：

| 消费方 | 文件 | 判定粒度 | 1e-4 量化是否安全 |
|---|---|---|---|
| `edgeOpacity` | `src/panoramic/exporters/html-exporter.ts:70` | 线性映射到 `[0.1, 0.8]` 视觉透明度，连续值，无阈值判断 | 安全（视觉像素级差异远大于 1e-4 造成的 opacity 偏移） |
| `upsertEdge`（confidence-max-wins） | `src/panoramic/graph/graph-builder.ts:88` | `edge.confidenceScore > existing.confidenceScore` | **本次核实：与 anchoring 边不相关**——`runAnchorIntegration`（`doc-graph-builder.ts:672`）把 `buildSemanticEdges` 的返回值直接作为 `semanticEdges` 追加到图谱 `links`，未经过 `upsertEdge` 的去重合并路径；`upsertEdge` 只服务于另外 4 类关系边（import/inherit/implement/directional）。故量化对该函数的行为**零影响** |
| `community-detector.loadGraph` | `src/panoramic/community/community-detector.ts:86` | 仅作为边属性透传存储，**未参与** Louvain 算法的权重计算（Louvain 只按无向图连通性分社区，未读该字段做加权） | 安全（该字段在此处纯粹是透传，不参与任何数值判断） |
| `query-helpers.ts` `>= minConfidence` | `src/knowledge-graph/query-helpers.ts:643` | 用户传入的查询阈值比较，阈值本身是外部输入 | **非绝对零影响（codex 第二轮更正）**：该阈值可为任意用户输入，量化可能改变边在阈值邻域的归属（如 `0.64996 → 0.65`，`minConfidence = 0.65` 时由排除变包含）。准确表述为"**默认路径影响可忽略（anchoring 默认阈值 0.75）；自定义精细阈值附近可能改变边界归属**" |
| `direction-audit.ts` 分档 | `src/cli/commands/direction-audit.ts:14,24` | `>= 0.9` / `>= 0.6` 两档阈值，量化步长 1e-4 远小于档位间距 0.3/0.1 | 安全 |

**结论**：消费方粒度判定全部核实，其中 `upsertEdge` 一项是本次新增的独立核实（fix-report 未展开论证该函数是否受影响，本次通过读 `doc-graph-builder.ts:runAnchorIntegration` 源码确认语义边不经过该函数的去重合并路径）；
`query-helpers` 一项经 codex 第二轮更正为"默认路径可忽略、自定义阈值邻域可能改变归属"，不再表述为"不影响所有消费方"。

### 2. "本模块是全图唯一一处"声明的独立核实（**已被 codex 第二轮更正**）

`grep -rn '"confidenceScore": 0\.[0-9]\{5,\}'` 全仓（含 `tests/`、`specs/`）扫描，**0 命中**（快照已定点替换）；
`grep -rn "confidenceScore" src/` 全部命中逐个核实来源，`edge-builder.ts:150`（`confidenceScore: pair.similarity`）是**当前 anchoring / embedding 路径上**唯一的非常量赋值点。

**更正**：此前"全图唯一写入点"的表述是事实错误。`src/panoramic/graph/graph-builder.ts:218` 存在另一条持久化入口
`const confidenceScore = relationship.confidenceScore ?? CONFIDENCE_SCORES[confidence]`，
而 `ArchitectureIRRelationship.confidenceScore?: number` 允许调用方提供任意值并直写进 `GraphEdge`。
当前所有内置 producer 均未赋该字段，故**实际产物**里的非常量值仍只由 `edge-builder.ts` 产生——
但这是当前 producer 集合的性质，**不是类型系统保证的不变量**，未来新增 producer 时需重新评估。

### 3. 既有 anchoring 单测在 4 位量化下是否仍成立

`tests/panoramic/anchoring/edge-builder.test.ts:68` 使用 `expect(edges[0].confidenceScore).toBeCloseTo(0.90, 2)`——断言容差本身是 2 位小数级，4 位量化不影响。实测 `npx vitest run tests/panoramic/anchoring/` → **50 passed**。

### 4. "去重用原始值"设计是否真的落实

见上方 Layer 1.75(c)：已逐行读代码确认量化只发生在 `return` 语句的 `.map(...)` 里，`dedupeMap` 内部比较用的是循环体中赋值的原始 `pair.similarity`，两者在代码执行顺序上互不干扰。**核实设计确实落地，非声称**。

### 5. 数值论证复核

`Math.round(x * 1e4) / 1e4` 边界行为核实：`Number` 的乘除法与 `Math.round` 在 ECMAScript 中是精确规定的 IEEE-754 行为，`Number.prototype.toString()` 的最短往返表示同样是规范强制——故序列化字符串完全由整数 k 决定，fix-report 给出的三步论证（差异来源于 embedding 张量本身、量化字节由整数 k 决定、k 在两平台相同且余量 4695×）逻辑自洽，未发现漏洞。

**实测复算**：本次独立用 Node 直接对 fix-report 给出的两个平台原始值执行量化函数，验证结果一致：

```
macOS-arm64 实测   输入 0.780570518226505  → 写出 0.7806
Ubuntu-x64 实测    输入 0.7805705225965378 → 写出 0.7806
```

两者字节相同，符合"量化步长 1e-4 远大于观测平台差 4.37e-9（4695 倍余量）"的论证。

### 配套测试实跑

- `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` → **12 passed**
- `npx vitest run tests/panoramic/anchoring/` → **50 passed**
- 快照 diff 复核：`git diff -- tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 确认**仅 1 行**改动（`0.780570518226505` → `0.7806`），其余 2000+ 行逐字未动

---

## Layer 2: 原生工具链验证（本次亲自复跑，含全新增量）

### 必跑命令（真实工作区，Node 24.14.0，本次重新独立执行）

| 命令 | 退出码 | 汇总 |
|---|---|---|
| `npm run build` | **0** | `tsc` 类型检查零错误；postbuild 盖章成功（`commit=371d7284 (dirty)`） |
| `npx vitest run` | **0** | `Test Files 483 passed \| 4 skipped (487)`；`Tests 5769 passed \| 18 skipped \| 21 todo (5808)` |
| `npm run test:plugins` | **0** | `tests 919 / suites 174 / pass 919 / fail 0`（工作区口径，含 F231 的额外未提交测试文件） |
| `npm run repo:check` | **0** | 全部 diagnostics `pass`，仅 `graph-quality:freshness` 为 `warn`（图产物 sourceCommit 落后当前 HEAD，属预存 commit 级 staleness 提示，非新增失败，未纳入退出码） |

四条命令与此前 A/B/C 报告的验证结论一致，本次是在**已包含链 D/E 改动的完整工作区**下重新独立执行得到的相同结果，证明链 D/E 未引入任何新失败或新警告。

### 链 D/E 专项复跑（本次新增）

| 命令 | 退出码 | 汇总 |
|---|---|---|
| `npx vitest run tests/unit/feature-176-spike-and-gate.test.ts` | 0 | 19 passed（含链 D 目标用例） |
| `npx vitest run tests/panoramic/anchoring/ tests/e2e/f220-decomposition-charter.e2e.test.ts` | 0 | 7 test files / 62 passed |

（链 A/B/C 的干净树 + Node 20 端到端模拟复跑结论沿用此前报告，本次未重复该耗时装置，因链 D/E 的改动文件与该装置验证路径无重叠——链 D/E 属"跨主机属性维度"的缺陷，其验证方式已是"忠实复现装置 + 数值论证"而非干净树模拟，与 A/B/C 的验证方式正交，见 fix-report 说明）

---

## [Spec 合规]

**判定：PASS（五链）**

- 五条根因链（A/B/C/D/E）均与实现严格对应，无偏差；五条链均已闭合（见 Layer 1 表）
- 未发现 fix-report 未覆盖的行为变化：`git diff` 确认改动精确对应五条链各自的修复点，链 D 只改测试断言（未触及 `swe-bench-verified-paths.mjs` 被测实现），链 E 只改 `edge-builder.ts` 出口量化 + 1 处快照字面量（未改变 `confidenceScore` 的语义定义与取值范围）
- `tasks.md` 的 T001-T024 全部 `[x]`，逐项与实际改动比对一致（新增的 T022 对应链 D 断言改动、T023/T024 对应链 E 产品代码+快照改动）
- "CI 配置/测试断言/产物精度不属产品 spec 面、无需更新 spec"结论核实成立（见 Layer 1.9）
- fix-report 关于"放宽 Chain A/B/C 阶段'不改测试文件、不改产品代码'约束仅限 D/E 两处"的声明，已核实 `git diff --stat` 中链 A/B/C 对应的 3 个文件（`run-plugin-tests.mjs`、`ci.yml`、`package.json`）确实零改动测试文件/产品代码，约束边界未被突破

## [代码质量]

**判定：PASS（含 1 项既有 WARNING，1 项新增 NOTE）**

- A/B/C 相关代码质量结论沿用此前报告（零文件 fail-loud、退出码透传、`readdirSync` 不传 `withFileTypes` 的理由成立、路径含空格安全、无遗留调试代码、ci.yml 步骤顺序正确、`if: always()` 设计未被破坏）
- **链 D 代码质量**：新断言表达力优于原断言——从"过宽近似"（整串搜 `/r`）收窄为"精确表达"（`VERIFIED_ROOT_REL` 截断 + `/r\d+` 正则 + `runFixturePath` 等式正向对照），本次独立变异测试证实强度不降反升；注释准确记录了 F232 链 D 的问题背景
- **链 E 代码质量**：
  - `quantizeConfidenceScore` 实现正确（`Math.round(x*1e4)/1e4`，边界行为符合 IEEE-754 规定的精确运算，无自定义近似风险）
  - 注释详尽记录了"为何量化""为何取 4 位而非 6 位"的实测依据，与本次独立复核的数值一致
  - 量化位置选在函数返回出口而非计算过程中，**本次独立核实该设计确实落地**（见 Layer 1.75(c) 与"链 E 验证"第 4 点），去重比较不受量化影响
  - ~~"全图唯一一处"的声明**本次独立复核成立**（grep 交叉验证）~~ → **已更正**：应为"当前 anchoring / embedding 路径的非常量写入点"，`graph-builder.ts:218` 是另一条持久化入口（见「链 E 验证」第 2 点）
  - 无遗留调试代码；快照改动为**外科式定点替换**（仅 1 行，`git diff` 逐行核实）

**既有 WARNING（沿用，非阻断）**：plan.md 原始枚举方案与实际实现（不传 `withFileTypes`）存在文字层面不一致，tasks.md 已显式记录裁决理由，风险可控。

**新增 NOTE（非阻断，供后续观察）**：`upsertEdge` 的 confidence-max-wins 去重逻辑是否受语义边量化影响，fix-report 原文未展开论证（只在"类似模式"表格中给出结论未给推导），本次 verify 补做了该项独立核实（追踪 `runAnchorIntegration` 调用路径确认语义边不经过 `upsertEdge`）。建议后续若有人改动 `doc-graph-builder.ts` 的集成方式（比如未来把语义边也纳入 `upsertEdge` 去重），需重新评估量化对边选择的影响——当前不构成阻断，仅作为技术债观察点记录。

---

## Summary

### 总体结果（覆盖五链）

| 维度 | 状态 |
|------|------|
| 根因链闭合（A/B/C） | ✅ 三链均闭合，实测证据齐备（沿用此前验证） |
| 根因链闭合（D/E，本次新增验证） | ✅ 两链均闭合，本次独立复核（变异测试 + 消费方粒度核实 + 数值论证复算） |
| [Spec 合规] | ✅ PASS（五链） |
| [代码质量] | ✅ PASS（1 项既有非阻断 WARNING + 1 项新增非阻断 NOTE） |
| Build Status | ✅ PASS |
| Lint Status | ✅ PASS |
| Test Status（vitest 全量） | ✅ PASS（5769 passed / 18 skipped / 21 todo，零失败） |
| Test Status（mjs gate） | ✅ PASS（919 passed / 0 failed） |
| Test Status（链 D 专项） | ✅ PASS（19/19，含独立变异测试证伪失败后正确复原） |
| Test Status（链 E 专项） | ✅ PASS（anchoring 50/50，f220 e2e 12/12） |
| repo:check | ✅ PASS（1 条 freshness warn，非新增失败） |
| 根因链闭合（F） | ⏳ 本报告完成后追加，**未经本报告验证**（实现侧已有诱饵进程装置前红后绿证据，见 fix-report「链 F」） |
| Test Status（链 E 新增单测 T025） | ⏳ 本报告完成后追加，**未经本报告验证**（实现侧实测 16 passed + 双变异测试） |
| **Overall（五链覆盖 A–E）** | **✅ READY FOR REVIEW（仅限 A–E；链 F 与 T025 须重跑 verify 后才能形成六链最终判定）** |

### 需要修复的问题

无阻断性问题。

### 非阻断性观察项

1. plan.md 原始枚举方案与实际实现（tasks.md 裁决后）存在文字层面不一致，tasks.md 已显式声明覆盖裁决并给出理由（沿用）
2. `graph-quality:freshness` 在 `repo:check` 中报 `warn`（图产物 sourceCommit 落后 HEAD `371d728`），预存提示，与本次改动无关（沿用）
3. **（新增）** `upsertEdge` 是否受语义边量化影响一事，fix-report 只给结论未展开推导，本次 verify 已补做独立核实（语义边不经过 `upsertEdge`），建议未来若集成方式变化需重新评估
4. **（新增）** 链 E 的量化余量是概率性而非数学零（fix-report 已如实标注：约 1e-4/值 的边界翻面概率），本次复核认可该表述诚实、未发现夸大或隐瞒
5. ~~`tests/unit/watch-command.test.ts` 在负载下属项目记忆已记录的预存 flaky（chokidar/fsevents），非本次引入，不计入本次判定~~
   **该判断已被证伪（codex 第二轮）**：路径正确的文件是 `tests/integration/watch-command.test.ts`，
   其失败并非负载 flaky，而是对**主机进程表**的真实 `pgrep` 查询命中后走了提前返回分支的**确定性**失败——
   已在本机用诱饵进程装置 100% 复现，并作为链 F 修复。详见 fix-report「链 F」。

### 未验证项

- 未推送分支触发真实 GitHub Actions 运行——链 D/E 均声明"必须以真实 CI 复核"（尤其链 E 的跨 CPU 架构结论，本地单一架构无法自证）；本次 verify 子代理无 git 写操作/push 权限，仅能在本地对已知平台差异做数值论证复核，无法直接验证真实 Ubuntu runner 上的实际运行结果
- 链 A/B/C 的干净树 + Node 20 端到端模拟复跑结论沿用此前报告，本次未重复该耗时装置（改动文件无重叠，判定不受影响，理由见 Layer 2 说明）

### 增量更新说明（本次 verify 相对既有报告的变化）

- 保留了既有报告对链 A/B/C 的全部结论（未重新执行耗时的干净树 Node 20 装置，因该装置验证的文件与本次链 D/E 改动无交集）
- 新增「链 D 验证」「链 E 验证」两节，均为**独立复核**而非照抄 fix-report 转述：
  - 链 D：在真实仓库文件上重新执行了一次可逆变异测试（而非仅信任 fix-report 给出的变异测试结论），并确认零残留
  - 链 E：独立 grep 全部 `confidenceScore` 消费方并逐个判定粒度（新增核实了 `upsertEdge` 未受影响这一 fix-report 未展开论证的点）、独立核实"去重用原始值"的设计确实落地在代码执行顺序里、独立复算了量化函数在两平台原始值下的行为
- 总判定由"三链覆盖"更新为"五链覆盖"，Overall 结论维持 **READY FOR REVIEW**
