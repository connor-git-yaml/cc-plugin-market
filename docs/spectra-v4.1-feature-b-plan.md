# Feature 140 — Spectra v4.1.0 文档生产线质量重构

> ✅ **历史归档（v4.1 时点）**：Feature 140（v4.1.0 MapReduce 文档生产线）已实现并发布。本文档保留作历史设计记录，**非当前活跃计划**。当前主线见 [milestone-M8](design/milestone-M8-trust-repair-and-drift-flagship.md)。

> **状态**：规划已定稿（Open Questions Q1-Q15 全部决议完毕，可随时启动 `/spec-driver-feature`）
> **创建**：2026-04-27 | **最后更新**：2026-04-28（v3 — MapReduce 架构升级）
> **前置**：Feature 135（v4.0.1 hotfix）已合入 master
> **预期工作量**：22-30 人天（v3 架构升级后）

> ⚠️ **v3 架构升级注记**：基于"项目规模与模型容量解耦"的需求，子能力 1（ADR）/ 子能力 3（narrative）/ 子能力 2（hyperedges）已从"单 pass 大上下文"改为 **MapReduce 架构**（cluster + map + reduce）。详细技术设计见 [docs/spectra-v4.1-mapreduce-architecture.md](./spectra-v4.1-mapreduce-architecture.md) — **架构文档为权威**，本文档保留业务范围/DoD/Phase 拆分。
>
> 关键变化：Q5 默认 budget 从 1M → 100k chunk size；Q9 ADR opus 从全 pipeline → 仅 Reduce；新增 Phase 0（cluster orchestrator 基础设施 3-4 人天）。

---

## 决策日志（启动前已固化）

| # | 问题 | 决议 | 影响 |
|---|------|------|------|
| Q1 | TS 中型 fixture 选哪个？ | **sindresorhus/ky**（纯 TS HTTP 客户端，~30 文件 src/ 目录）| Phase 1 测试基础设施 |
| Q2 | ADR 旧 8 个 hardcoded candidate 怎么处理？ | **全删** | 子能力 1 |
| Q3 | LLM 提到的 evidence file/line 是否做真实性自动校验？ | **是** | 子能力 1 |
| Q4 | --include-docs 默认值改 true？ | **保持 false** | 子能力 4 |
| Q5 | --context-budget 默认值？ | **100k chunk size**（v3 架构升级：MapReduce 后 chunk-bounded，不再需要大 budget；100k 装得下 maxSize=15 的 cluster + shared header）| 子能力 6 |
| Q6 | 旧 hallucinated ADR 升级时怎么处理？ | **保留 + supersede notice**（沿用 Feature 135 _PIPELINE_DISABLED.md 模式） | Phase 4 |
| Q7 | 接受 LLM 成本上升？ | **完全接受，质量优先**（cost 不作为约束） | 全局影响（见衍生项 Q9-Q10） |
| Q8 | 引入 `spectra audit` 子命令？ | **本 Feature 不引入，留 v4.2** | 范围排除 |
| Q9 | ADR pipeline 内部是否强制用 opus（覆盖全局 preset）？ | **仅 Reduce 阶段优先 opus**（v3 架构升级：MapReduce 后 Map 用 sonnet，Reduce 关键合并质量门用 opus；不依赖 opus 配额做全 pipeline）| 子能力 1 |
| Q10 | architecture-narrative 是否做 3-pass（synthesize → critique → refine）？ | **是** | 子能力 3 |

**决策核心导向**：成本不作为约束，质量是第一优先级。所有"省 token"考量替换为"提质量 / 提可观测性"考量。

---

## 一、范围一句话

让 v4.0.1 通过 fail-loud 临时治理掩盖的 6 类质量问题真正修好：ADR 不再是 Spectra 自身架构模板套壳；hyperedges 在新项目首次 batch 就能产出；architecture-narrative 不再是"文件名表格"；--include-docs 真正生效；graph.html 始终生成；context 大小可观测可按相关性排序。

---

## 二、关键事实校准（基于代码探查）

### 关于 ADR Pipeline

`src/panoramic/pipelines/adr-decision-pipeline.ts` 共有 **8 个 hardcoded candidate 函数**，每个都是写死的 ADR 模板（如 `buildStreamJsonProtocolCandidate` = "JSON 流式控制协议"，对应 v4.0.0 hallucinate 出来的那个）。candidate 触发条件是关键词匹配，**任何足够大的项目都会偶然命中**。

→ 全删（Q2 决议），改用 **MapReduce 架构**（v3 升级）：Leiden/Louvain 聚类 → 每 cluster Sonnet 发现候选 → Reduce 阶段 Opus 合并去重 → evidence 自动校验。详见架构文档。

### 关于 hyperedges

`runHyperedgeIntegration` 和 `extractHyperedges` 函数都已实现。问题不是函数缺失，而是触发条件 `designDocAbsPaths.length > 0` 在新项目不满足。

→ 扩展 design doc 来源到 README + module specs。

### 关于 context-assembler

`src/core/context-assembler.ts` 已存在。改造它即可。在 Q5/Q7 决议后，改造方向从"激进裁剪省钱"调整为"按相关性排序提质量 + 1M 软上限防 lost-in-middle"。

### 关于 --include-docs

CLI/extraction 链路已实现，但 spec 生成路径不消费 extraction 结果，且日志仍报"跳过"。需要把 extractionResults 真正喂入 architecture-narrative 生成器。

---

## 三、6 大子能力详细规划

### 子能力 1：ADR Evidence-Binding 重构（最大块）

**目标**：每条 ADR 必须有可追溯的项目内证据；无证据不生成。删除全部 8 个 hardcoded candidate。

**架构（v3 升级 — MapReduce）**：cluster (Louvain) → Map per cluster (Sonnet) → Reduce (Opus) → evidence 自动校验。详见 [架构文档 §三](./spectra-v4.1-mapreduce-architecture.md#三adr-pipeline-重构基于-cluster-orchestrator)。

**新生成流程**：
1. **Single-pass 生成**：用 opus（强制覆盖全局 preset），喂入：
   - 全部 module specs 的"意图" + "业务逻辑" + "接口定义" 段
   - 项目 README（如启用 --include-docs）
   - `.specify/project-context.yaml`
   - 关键源代码片段（按 LOC top 5 自动选取，每个截前 100 行）
   - 总 input 预计 50k-300k tokens（在 opus 200k/1M 容量内）
2. **要求 LLM 输出**：每条 ADR 含 ≥2 条 evidenceRefs（不同文件），每条带 file/line/snippet
3. **Evidence 真实性自动校验**：
   - 解析 LLM 输出的 evidenceRefs
   - 对每条逐一验证：file 存在 + line 范围有效 + snippet 与文件实际内容字符匹配（允许 ≤10% 字符差，容忍 LLM 重排空白）
   - 不通过 → 该 evidenceRef 标记 `verified: false`，从计数中扣除
4. **Validation gate**：candidate 经验证后保留 ≥2 条 evidenceRefs 才进入产物；少于 2 条 → 丢弃；0 条 candidate → 0 ADR 输出（fail-closed）

**新 schema**（ADR frontmatter）：
```yaml
type: adr
decisionId: ADR-0001
status: proposed | accepted | superseded
confidence: high | medium
generatedBy: spectra adr-pipeline v4.1.0
generatedByModel: claude-opus-4-7  # 强制
evidenceRefs:
  - kind: code | commit | spec | doc
    source: <相对路径>
    location: <"L42-58" 或 "## 章节名">
    snippet: <≤200 字引用>
    rationale: <为何这是该决策的证据>
    verified: true | false  # 自动校验结果
sourceTypes: [...]
```

**删除项**：8 个 hardcoded candidate 函数全删 + `buildAdrCandidates` 改为单一 LLM 调用入口

**保留项**：`adr-draft.hbs` / `adr-index.hbs` 模板（render 层不变）

**预估**：5-7 人天（v3 架构升级后不变；orchestrator 基础设施抽离到 Phase 0）

**风险**：
- ~~LLM 成本激增~~：已在 Q7 接受，不再是风险
- LLM 编造 evidence → Q3 决议的真实性自动校验消除此风险
- 8 个旧 ADR 标题在 monorepo 内有 downstream 依赖 → Phase 3a 启动前必须 grep 验证（决策点 3）
- opus 调用失败 / 超时 → 降级路径：单次重试 → 仍失败则该批次不生成 ADR（fail-closed），写 `_PIPELINE_FAILED.md` 标记

---

### 子能力 2：Hyperedges 数据流补齐

**目标**：新项目首次 `spectra batch --hyperedges --mode full` 就能产出 ≥1 hyperedge。

**修复方案**：扩展 design doc 来源（按优先级合并喂入 hyperedge extractor）：
1. 根目录 README.md（始终包含）
2. `docs/**/*.md`（`--include-docs` 启用时）
3. `specs/modules/*.spec.md`（自身产物，每次 batch 后存在）
4. `.specify/project-context.{yaml,md}`

**实现位置**：`src/batch/batch-orchestrator.ts:1041-1060` `designDocAbsPaths` 计算逻辑

**Q7 影响**：可以喂入更多上下文（不再 token 紧张），improves hyperedge LLM 召回率

**集成测试**：在 micrograd / nanoGPT / ky fixture 上跑 `--hyperedges`，断言 `graph.json.hyperedges.length >= 1`

**预估**：2-3 人天

**风险**：
- 把 module specs 当 design doc 喂给 hyperedge extractor 可能让 LLM 提取出"模块间已有连接"而非真正语义流程 → prompt 加约束："仅在 ≥3 节点群组关系无法被 pairwise 边表达时输出"
- README 解析失败时降级到 module specs（已有兜底）

---

### 子能力 3：architecture-narrative 重写（含 3-pass）

**目标**：narrative 反映真实项目技术本质，含 ≥3 个领域词；删除"项目子域目录" template 化表格。

**架构（基于 Q10 决议）**：3-pass synthesis with critique loop

**新实现**：
1. **Pass 1 — Synthesize**（sonnet 即可）：
   - 输入：所有 module spec frontmatter + "意图"+"业务逻辑" 段；项目 README（启用 --include-docs 时）
   - 输出：4-6 段 narrative draft，含项目技术本质 / 关键抽象关系 / 设计取舍
2. **Pass 2 — Critique**（独立 LLM 调用，sonnet）：
   - 输入：Pass 1 draft + 同源 module specs
   - 任务：批判性审查 — 是否有 template 化句子？是否含 ≥3 个领域词？是否有事实错误？
   - 输出：`{passed: bool, issues: [...]}` 结构化反馈
3. **Pass 3 — Refine**（仅当 Pass 2 不通过时；sonnet）：
   - 输入：Pass 1 draft + Pass 2 issues
   - 输出：修正后 narrative
   - 最多 1 次 refine；若 Pass 2 仍判 fail → 标 `confidence: low` 并附 critique warning 段
4. **Pre-flight 校验**（程序化，非 LLM）：
   - narrative 必须出现来自 module specs 接口表头的 ≥3 个核心抽象名
   - 不达标 → 强制走 Pass 3
   - 仍不达标 → fail-closed（不写盘 narrative，而非 fall back 到旧 template）

**删除项**：当前的"项目子域目录" 6 行占位表格 + 整个 file-system 元数据 template-fill 路径

**预估**：4-5 人天（比原 3-4 ↑ 1 天，因 3-pass 架构）

**风险**：
- ~~LLM 成本~~：Q7 接受
- 3-pass 增加 batch 总耗时（约 +60s/项目）→ 文档说明，CHANGELOG 注明
- Critique LLM 假阳性（误判 narrative 不合格）→ 校准 prompt + Phase 1 fixture 上观测

---

### 子能力 4：--include-docs 路径打通

**目标**：明确 `--include-docs` 语义，消除"日志说跳过 / 实际入图但不生成 spec"的矛盾。

**语义决策**（Q4 已确认默认 false）：
- `--include-docs=false`（默认）：不处理任何 .md
- `--include-docs=true`：
  - README.md → 始终作为 architecture-narrative + hyperedge extractor 的 input context（不生成独立 spec）
  - 其他 .md → 进入 `extraction-pipeline`，作为图节点（kind: doc）；不生成独立 spec
  - 日志改为：`include-docs: 已加入 N 份 .md 作为语义上下文`（不再说"跳过"）

**实现位置**：
- `src/extraction/extraction-pipeline.ts`：拓展为返回 markdown 内容供下游消费
- `src/panoramic/pipelines/architecture-narrative.ts`：消费 README 内容
- `src/batch/batch-orchestrator.ts`：去掉"跳过 .md"误导日志

**Q7 影响**：原计划 README 单独额度限 5k tokens（防止大 README 拖慢 batch），现在**移除该限制**，允许全量 README 喂入

**预估**：2 人天

**风险**：
- 大 README（如 nanoGPT ~500 行 / 5k tokens）增加 narrative 调用 latency → 文档说明可接受

---

### 子能力 5：graph.html 始终生成

**目标**：batch 输出始终含 `_meta/graph.html`，不受图复杂度阈值跳过。

**修复**：
- `src/batch/batch-orchestrator.ts`：batch 末尾**始终**调用 `exportGraphHtml`
- 找到当前条件跳过的位置，去掉跳过条件
- 对极小图（< 3 节点），HTML 内嵌 banner："This project has too few cross-module references for meaningful visualization. Run with --include-docs to add semantic context."

**预估**：1-2 人天

**风险**：
- 大图（> 1000 节点）渲染性能 → 测试 HTML size cap

---

### 子能力 6：Context Quality & Observability（重命名 + 重定位）

**目标变化（Q5/Q7 决议触发）**：原"Cost 治理"目标作废。新目标 = **大上下文下的质量保证 + 可观测性**。

**核心理念**：
- LLM 成本不作为约束（Q7）
- 默认 budget = **100k tokens**（v3 升级：MapReduce 后 chunk-bounded，配套 maxSize=15 的 cluster + shared header）
- 但 cross-module context 仍按 AST 调用图相关性排序（避免 "lost in the middle" 效应稀释关键信息）
- cost breakdown 留作可观测性：让用户知道实际消耗，但不限制

**新 CLI flag**：`--context-budget <N>`（默认 1000000，单位 input tokens）
- 适用场景：用户用 200k context 模型时显式设小（如 `--context-budget 150000`）
- 默认 100k：MapReduce chunk-bounded 后实际 cluster Map call 输入 ~85k，100k 留 15% 缓冲

**实现**：
1. `src/core/context-assembler.ts`：
   - 当前是"全部喂入" → 改为"按 AST 调用图相关性排序后全部喂入；超 budget 时按相关性截断"
   - 相关性排序：本模块 import 的模块 > 同目录其他模块 > 其他
   - token 估算用粗算（chars / 3.5）即可
2. **Cost breakdown 字段**（每个 spec frontmatter）：
```yaml
costBreakdown:
  contextAssembly: <N>     # cross-module context tokens
  promptTemplate: <N>      # template tokens
  sourceFile: <N>          # 主文件 tokens
  llmReasoning: <N>        # output tokens
contextTruncated: false    # 是否触发 budget 截断（默认应该几乎不触发）
```
3. **Batch summary**：新增"Top 5 input token 消费模块"作可观测性信号（不再标记为 bloat 候选，仅作信息）

**Q7 影响**：完全去掉"省成本"叙述。文档明确说明这是质量工具不是成本工具。

**预估**：2-3 人天（比原 3-4 ↓ 1 天，因不需要复杂裁剪策略，只需排序 + 软截断）

**风险**：
- ~~LLM 成本激增~~：Q7 接受，移除
- 1M context 调用延迟显著增加（每次 30s+ → 数分钟）→ batch 总耗时可能 +50-100% → 文档说明 + CHANGELOG 注明
- "Lost in the middle"：1M 上下文中关键信息可能被淹没 → relevance ordering 缓解（不彻底解决）
- 用户用 200k context 模型未显式设 budget → 调用 reject → 文档示例 + 错误信息引导设 `--context-budget`

---

## 四、阶段拆分（含依赖图）

```
Phase 0（v3 新增 — MapReduce 基础设施）— 3-4 人天
└── 0a: cluster-orchestrator.ts 实现（聚类 + Map 并发调度 + Reduce + telemetry）
    详见 [架构文档 §二](./spectra-v4.1-mapreduce-architecture.md#二核心抽象cluster-orchestrator)

Phase 1（独立基础设施，可并行）— 4-5 人天
├── 1a: 测试 fixture 集（含 sindresorhus/ky）+ CI 跨项目隔离断言
├── 1b: 子能力 6（Context Quality & Observability — chunk-bounded 后简化）
└── 1c: 子能力 5（graph.html 始终生成）

Phase 2（依赖 Phase 1，可并行）— 3-4 人天
└── 2a: 子能力 4（--include-docs 路径打通）

Phase 3（依赖 Phase 0+2，MapReduce 应用层）— 12-15 人天
├── 3a: 子能力 2（hyperedges 接 orchestrator）— 2-3 人天，最简单先做
├── 3b: 子能力 3（architecture-narrative MapReduce + 3-pass critique）— 4-5 人天
└── 3c: 子能力 1（ADR MapReduce + evidence verification）— 5-7 人天，最复杂

Phase 4（集成验收）— 1-2 人天
├── 4a: 跨项目隔离测试全绿（micrograd + nanoGPT + ky + 空项目）
├── 4b: 在 3 个 fresh 项目上验证无 hallucination + 全功能产出
└── 4c: v4.1.0 release prep（release:sync + tag）
```

**Phase 时间分配（v3）**：
- Phase 0：3-4 人天（cluster orchestrator）
- Phase 1：4-5 人天
- Phase 2：3-4 人天
- Phase 3：12-15 人天（MapReduce 应用到 3 个生成器）
- Phase 4：1-2 人天
- **合计 22-30 人天**（v3 比 v2 多 4-5 天，换得大项目不崩、Q5/Q9 high-severity 问题架构性消除）

---

## 五、测试基础设施（Phase 1 必做）

### Fixture 项目集

| Fixture | 规模 | 语言 | 用途 |
|---------|------|------|------|
| micrograd | 4 文件 / 4k 词 | Python | 边界测试（极小项目） |
| nanoGPT | 15 文件 / 17k 词 | Python | 中等项目主测试 |
| **sindresorhus/ky** | ~30 文件（仅 `src/` 目录）| TypeScript | 跨语言验证 |
| empty-project | 仅 README | — | 空项目边界 |

**fixture 选择理由**（ky vs httpx vs h3）：
- 排除 `encode/httpx`：实际是 Python 项目，不能验证 TS 链路
- 排除 `unjs/h3`：~20 文件，规模与 nanoGPT 重叠度高
- 选 `sindresorhus/ky`：纯 TS、有清晰的 src/core/types/utils 子目录结构、跨模块 import 真实、规模 ~30 文件，恰好填补 micrograd（极小 Python）→ nanoGPT（中等 Python）→ ky（中等 TS）→ empty 的覆盖梯度

### 跨项目隔离测试

`tests/integration/cross-project-isolation.test.ts`：
1. **ADR 标题集合 distinct 率 = 100%**：4 fixture 跑后所有 ADR 标题集合互不相交
2. **module spec 含项目特定 identifier**：每 fixture 的 module spec 必须含 ≥3 个该项目独有的类/函数名
3. **architecture-narrative 含领域词**：narrative 必须含 ≥3 个该项目特有技术术语
4. **hyperedges 非零**：micrograd / nanoGPT / ky 3 个非空 fixture 上 hyperedges ≥ 1
5. **evidence 真实性**（新增，子能力 1 触发）：所有 ADR evidenceRefs 经验证 verified: true 占比 ≥ 90%

### CI 集成

- 在 `.github/workflows/` 新增（或扩展现有）workflow：每 PR 跑全部 4 个 fixture，snapshot 关键产物，比对差异
- 失败信号：跨 fixture ADR 标题重复 / 同样的 architecture-narrative / 任何 fixture hyperedges 长期为 0 / evidence 校验通过率 < 90%

---

## 六、Open Questions（全部已决议）

所有 Q1-Q10 已在"决策日志"中固化。**无待决项**，可启动 `/spec-driver-feature`。

---

## 七、风险登记表（基于决策更新）

| Risk | 概率 | 影响 | 缓解 |
|------|------|------|------|
| ~~LLM 成本激增~~ | — | — | **已废**（Q7 接受） |
| ADR 候选发现的 LLM 召回率低（很多项目 0 ADR） | 中 | 中 | 接受 0 ADR 是合理结果（fail-closed 优于 hallucinate）；CHANGELOG 明确告知 |
| **NEW** 大上下文 latency 显著增加（batch +50-100%） | 高 | 中 | CHANGELOG 注明；提供 `--context-budget` 让用户在不需要 1M 时显式压缩 |
| **NEW** "Lost in the middle"：关键信息在 1M 上下文中被稀释 | 中 | 中 | relevance ordering 缓解；fixture 测试观察 spec 质量回归 |
| **NEW** 用户用 200k 模型未显式设 budget → 调用 reject | 中 | 低 | 错误信息引导；docs 示例显示 `--context-budget 150000` |
| context-budget 极端裁剪（用户主动设 5k）导致 spec 质量下降 | 低 | 中 | A/B 测试：相同 fixture 跑 5k vs 1M，对比 spec 质量评分 |
| hyperedges 在以 module specs 作 design doc 时提取的是"伪 hyperedge" | 中 | 低 | extractor prompt 加约束；测试断言 hyperedge 数 < pairwise edge 数 |
| 测试 fixture 选择不当导致漏测某类问题 | 低 | 高 | 4 fixture 覆盖：极小 / 中等 Python / 中等 TS / 空项目；后续可增 |
| 8 个旧 ADR candidate 删除后某 downstream consumer 依赖固定标题 | 低 | 高 | Phase 3a 启动前 grep 全 monorepo（决策点 3）；如有 → 评估保留兼容层 |
| **NEW** opus 调用失败 / 超时 / quota 不足导致 ADR pipeline fail | 低 | 中 | 单次重试 → 仍失败则该批次不生成 ADR + 写 `_PIPELINE_FAILED.md` 标记 |
| **NEW** Critique LLM 假阳性（narrative Pass 2 误判不合格） | 中 | 低 | Phase 1 在 4 fixture 上观察 critique 结果分布；prompt 校准 |

---

## 八、验收标准（DoD，基于决策更新）

Feature 140 完成的硬性验收（每条都可机器验证）：

1. **ADR 不再 hallucinate**
   - 4 fixture 上跑 batch，ADR 标题集合 distinct 率 = 100%
   - 所有 ADR 含 ≥2 条 verified=true 的 evidenceRefs
   - 所有 evidenceRefs 的 source/location 经自动校验真实存在
   - **NEW** 所有 ADR frontmatter `generatedByModel: claude-opus-4-7`
2. **hyperedges 真正生效**
   - micrograd / nanoGPT / ky fixture 上 `--hyperedges --mode full` 后 graph.json.hyperedges.length >= 1
3. **architecture-narrative 含领域词**
   - 4 fixture 上 narrative 必须含 ≥3 个该项目特有技术术语
   - 不再含"项目子域目录，覆盖 1 个模块 / 1 个文件"模板字符串
   - **NEW** 3-pass 流程产物含 critique 段（即使 Pass 2 通过也保留 critique 摘要）
4. **--include-docs 无矛盾日志**
   - 启用 `--include-docs` 后日志不再出现"跳过 .md 文件（不支持）"
5. **graph.html 始终生成**
   - 4 fixture 上 batch 输出均含 `_meta/graph.html` 文件
6. **Context Quality 可观测**
   - 所有 module spec frontmatter 含 `costBreakdown` 字段
   - batch summary 含"Top 5 input token 消费模块"
   - 默认 budget=100k 在 4 fixture 上 cluster Map call 不触发 truncation（`contextTruncated: false`）
   - `--context-budget 5000` 在 nanoGPT 上能让 bench.py spec input tokens 降到 ≤ 10k 且 `contextTruncated: true`
7. **回归测试**
   - 现有 2232 测试零新增失败
   - pre-existing 2 个版本号失败若不修，明确标注；若修则也算入本 Feature
8. **CI 跨项目隔离测试**
   - `.github/workflows/` 中跑 4 fixture，断言通过

---

## 九、节奏与决策点

- ~~**决策点 1**（启动前）：用户回答 Q1-Q8~~ → **已完成**（Q1-Q10 全部决议在决策日志）
- **决策点 2**（Phase 1 完成后）：cost 透明化数据出来 → 评估是否需调整 1M 默认 budget
- **决策点 3**（Phase 3a 完成后，开始 ADR 重构前）：grep 全 monorepo 确认 8 个旧 ADR 标题无 downstream 依赖
- **决策点 4**（Phase 4 完成后）：决定 v4.1.0 直接 release 还是先 v4.0.2 中间释放 Phase 1+2 子集

---

## 十、与其他 Feature 的关系

- **Feature 131（已完成）**：提供 hyperedges schema v2.0，本 Feature 直接复用；不动 schema
- **Feature 133（已完成）**：项目级 orchestration overrides，本 Feature 通过 `gate_policy` 配置即可
- **Feature 135（已完成）**：v4.0.1 hotfix 提供 fail-loud 基础，本 Feature 把 WARNING 路径换成真正修复
- **Feature 141（未启动，v4.2.0）**：symbol-level graph，与本 Feature 独立

---

## 十一、启动检查清单

启动 `/spec-driver-feature` 前确认：

- [x] ~~用户回答 Open Questions Q1-Q8~~ → 已完成（Q1-Q10 全决议）
- [x] Feature 135 已合入 master（commit a33e3a9）
- [x] 测试 fixture 项目集已确定：micrograd / nanoGPT / ky / empty
- [x] LLM cost 已确认不作约束（Q7）
- [ ] 当前 master 状态干净（启动 spec-driver-feature 前 git status 确认）
- [ ] opus 模型 API 配额检查（确认能 burst 使用）

---

## 十二、关键决策的工程影响汇总

为方便实施时快速参照，把 Q5/Q7/Q9/Q10 的影响交叉汇总：

### Q5 (1M context) + Q7 (cost-insensitive) 联合影响

| 子能力 | 原方案 | 新方案 |
|-------|-------|-------|
| 1 ADR | 2-pass 候选发现 + 证据强化 | **MapReduce**（v3 升级）：cluster → Sonnet map → Opus reduce → evidence 校验 |
| 3 narrative | 1-pass + ≤2 次 regenerate | 3-pass synthesize → critique → refine |
| 4 --include-docs | 限 README 5k tokens | 全量 README 喂入 |
| 6 context | 30k budget 砍 cross-module | 100k chunk size（v3：MapReduce 后 chunk-bounded） |

### Q9 (ADR Reduce 阶段优先 opus) 影响（v3）

- ADR pipeline Map 阶段使用 sonnet（每 cluster 一次调用，并行 maxConcurrency=4）
- ADR pipeline Reduce 阶段优先 opus（合并去重 + 跨 cluster 决策识别的关键质量门）
- 实施位置：`src/panoramic/cluster-orchestrator.ts` 的 mapModel/reduceModel 配置项
- frontmatter 字段 `generatedByModel` 显式记录 Map/Reduce 各用了什么模型
- opus 不可用时降级 sonnet（fail-loud + `confidence: medium` 标记）

### Q10 (narrative 3-pass + MapReduce) 影响（v3）

- batch 总耗时 +60s/项目（中等规模）
- LLM token 消耗 ×2-3（map 多 cluster + reduce + critique）
- Critique 是独立 LLM 调用，用 sonnet
- Refine 仅在 Pass 2 fail 时触发，平均触发率预计 ~30%
- MapReduce 后 narrative 也走 cluster orchestrator（详见架构文档 §四）

---

*v3 架构升级版（MapReduce）— 2026-04-28。完整技术设计见配套 [架构文档](./spectra-v4.1-mapreduce-architecture.md)。本规划文档 + 架构文档共同作为 `/spec-driver-feature` 的 seed。*
