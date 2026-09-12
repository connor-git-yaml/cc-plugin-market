---
name: spec-driver-sync
description: "聚合功能规范为产品级活文档与 doc 上游事实源 — 将 specs/ 下的增量 spec 合并为 current-spec.md，并生成最小产品 Catalog"
disable-model-invocation: false
allowed-tools: [Read, Write, Glob, Bash]
model: sonnet
effort: medium
---

# Spec Driver — 产品规范聚合

你是 **Spec Driver** 的产品规范聚合器。你的职责是将 `specs/` 下的增量功能规范智能合并为产品级活文档 `current-spec.md`，并生成配套的 `entity.yaml` / `catalog-index.yaml` / `scorecard-report` / `adoption-report`，让产品事实层同时具备人读正文、机器可读目录、持续治理报告和本地 adoption 反馈四种形态。

## 触发方式

```text
/spec-driver:spec-driver-sync
```

**说明**: 此命令无需参数，直接执行聚合流程。不接受 `--resume`、`--rerun`、`--preset` 等参数。

---

## 插件路径发现

在执行任何脚本或读取插件文件前，确定插件根目录：

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

后续所有 `$PLUGIN_DIR/` 引用均通过上述路径发现机制解析。

---

## 项目上下文注入（project-context，可选）

在执行聚合前执行以下检查：

```bash
node "$PLUGIN_DIR/scripts/resolve-project-context.mjs" --project-root . --json
```

解析输出 JSON，并设置：

- `project_context_block = result.projectContextBlock`
- `project_context_diagnostics = result.diagnostics`
- `project_context_reference_missing = result.referenceSummary.missing`

行为约束：

- `.specify/project-context.yaml` 是 canonical source
- `.specify/project-context.md` 仅作为 legacy fallback
- 若 `.yaml` 与 `.md` 并存，resolver 只读取 `.yaml`，并在 diagnostics 中返回迁移 warning
- 若存在 `.specify/project-context.suggestions.yaml` 或 `.specify/project-context.suggestions.md`，读取为 `project_context_suggestions_block`
- `project_context_suggestions_block` 仅作 advisory-only 建议，不覆盖用户显式输入或 `project-context` 正文
- 若 diagnostics 中包含 `[参考路径缺失]`，不中断流程，但必须在聚合报告中列为风险项
- 若无 project-context 文件，resolver 返回 `projectContextBlock = "未配置"`
- 若无 suggestions 文件，设置 `project_context_suggestions_block = "无建议"`

---

## 在线调研策略解析（project-context 扩展）

为降低“仅依赖本地 spec 聚合，遗漏外部标准/竞品变化”的风险，从 resolver 输出读取：

- `online_research_required = result.onlineResearch.required`
- `online_research_min_points = result.onlineResearch.minPoints`
- `online_research_max_points = result.onlineResearch.maxPoints`
- `online_research_preferred_tools = result.onlineResearch.preferredTools`

---

## 在线调研补充与硬门禁

**执行条件**: `online_research_required = true`

1. 编排器亲自执行在线调研（不委派子代理），执行 `0..online_research_max_points` 个调研点
2. 写入 `.specify/research/sync-online-research.md`（目录不存在则先创建）
3. 文件必须包含以下结构化字段（可用 YAML Front Matter 或等价键值区块）：
   - `required: true`
   - `mode: sync`
   - `points_count: {N}`
   - `tools: [..]`
   - `queries: [..]`
   - `findings: [..]`
   - `impacts_on_product_spec: [..]`
   - `skip_reason: "{原因}"`（仅当 `points_count = 0` 时必填）
4. 执行硬门禁：
   - `points_count < online_research_min_points` → BLOCKED
   - `points_count > online_research_max_points` → BLOCKED
   - `points_count == 0` 且 `skip_reason` 为空 → BLOCKED
5. BLOCKED 时暂停并提示：`A) 补齐 sync-online-research.md 后继续 | B) 关闭在线调研要求后重试`

**执行条件（未要求在线调研）**: `online_research_required = false`
- 输出: `[sync] 在线调研补充 [已跳过 - 项目未要求在线调研]`

---

## 前置检查

在执行聚合之前，检查 `specs/` 目录状态：

```text
if specs/ 目录不存在:
  输出错误提示:
  """
  [错误] 未找到 specs/ 目录。

  产品规范聚合需要 specs/ 目录下存在至少一个功能规范目录（如 specs/001-xxx/spec.md）。

  建议：
  - 使用 /spec-driver:spec-driver-feature <需求描述> 启动研发流程，生成首个功能规范
  - 或手动创建 specs/ 目录结构
  """
  终止流程

if specs/ 下无 NNN-* 功能目录或所有目录中均无 spec.md:
  输出错误提示:
  """
  [错误] specs/ 目录下未找到任何功能规范。

  聚合需要至少一个 specs/NNN-xxx/spec.md 文件。

  建议：
  - 使用 /spec-driver:spec-driver-feature <需求描述> 生成功能规范
  - 确认 spec 文件位于 specs/{编号}-{名称}/spec.md 路径下
  """
  终止流程
```

---

## 聚合流程

**目的**：将 `specs/NNN-xxx/` 下的增量功能规范智能合并为 `specs/products/<product>/current-spec.md` 产品级活文档，并在其中产出一份可供 `spec-driver-doc` 消费的“对外文档摘要”；随后通过确定性 helper 生成 `specs/products/<product>/_generated/entity.yaml`、`specs/products/_generated/catalog-index.yaml`、`specs/products/<product>/_generated/scorecard-report.md/.json`、`specs/products/_generated/scorecard-index.yaml` 以及 `specs/products/spec-driver/_generated/adoption-report.md/.json`。

**适用场景**：

- 实现完成后同步产品全景文档
- 定期批量合并多个迭代的 spec
- 新成员 onboarding 前生成产品现状文档
- 为 `spec-driver-doc` 生成 README / 使用文档提供单一事实源

### 执行步骤

```text
[1/4] 正在扫描功能规范...
```

1. 扫描 `specs/` 下所有 `NNN-*` 功能目录
2. 读取 `prompt_source[sync]`（始终使用 Plugin 内置版本）

```text
[2/4] 正在聚合产品规范...
```

3. 通过 Task tool 委派 sync 子代理：

```text
Task(
  description: "聚合产品规范",
  prompt: "{sync 子代理 prompt}" + "{上下文注入: specs 目录列表、每个 spec.md 的完整内容}",
  subagent_type: "general-purpose",
  model: "opus"  // 聚合分析始终用 opus
)
```

**上下文注入块**（追加到 sync 子代理 prompt 末尾）：

```markdown
---
## 运行时上下文（由主编排器注入）

**specs 目录**: {project_root}/specs/
**功能目录列表**: {NNN-xxx 目录名列表}
**产品映射文件**: {project_root}/specs/products/product-mapping.yaml（如存在）
**产品模板**: $PLUGIN_DIR/templates/product-spec-template.md
**已有产品文档**: {specs/products/ 下已有的产品目录列表（如有）}
**项目上下文**: {project_context_block}
**上下文建议（只读）**: {project_context_suggestions_block}
---
```

```text
[3/4] 正在生成产品活文档...
```

1. 解析 sync 子代理返回：
   - 生成的产品数量和文件路径
   - 每个产品的聚合统计
   - 未分类 spec 列表（如有）

```text
[4/4] 正在生成产品治理事实...
```

2. 执行确定性 helper 生成 Catalog：

```bash
node "$PLUGIN_DIR/scripts/generate-product-entity-catalog.mjs" --project-root "{project_root}" --json
```

3. 解析 helper 返回：
   - `specs/products/<product>/_generated/entity.yaml`
   - `specs/products/_generated/catalog-index.yaml`
   - 缺失 `current-spec.md` / quality report 时的 warning

4. 执行 workflow registry helper（若当前产品包含 `spec-driver`）：

```bash
node "$PLUGIN_DIR/scripts/generate-workflow-registry.mjs" --project-root "{project_root}" --json
```

5. 执行 product quality helper 生成产品级文档质量报告：

```bash
node "$PLUGIN_DIR/scripts/generate-product-quality-reports.mjs" --project-root "{project_root}" --json
```

6. 执行 scorecard helper 生成持续治理报告：

```bash
node "$PLUGIN_DIR/scripts/generate-product-scorecards.mjs" --project-root "{project_root}" --json
```

7. 执行 adoption helper 生成本地使用与卡点分析：

```bash
node "$PLUGIN_DIR/scripts/generate-adoption-insights.mjs" --project-root "{project_root}" --json
```

8. 执行 Project Context suggestions helper，把治理与 adoption 信号转成只读建议：

```bash
node "$PLUGIN_DIR/scripts/generate-project-context-suggestions.mjs" --project-root "{project_root}" --json
```

9. 解析 helper 返回：
   - `specs/products/<product>/_generated/quality-report.md`
   - `specs/products/<product>/_generated/quality-report.json`
   - `specs/products/_generated/quality-report-index.yaml`
   - `specs/products/<product>/_generated/scorecard-report.md`
   - `specs/products/<product>/_generated/scorecard-report.json`
   - `specs/products/_generated/scorecard-index.yaml`
   - `specs/products/spec-driver/_generated/adoption-report.md`
   - `specs/products/spec-driver/_generated/adoption-report.json`
   - `.specify/project-context.suggestions.yaml`
   - `.specify/project-context.suggestions.md`
   - 基于 quality-report / verification-report 的 warning

2. 输出聚合完成报告：

```text
══════════════════════════════════════════
  Spec Driver - 产品规范聚合完成
══════════════════════════════════════════

扫描 spec 数: {总数}
产品数: {产品数}

聚合结果:
  ✅ {产品 A}: {N} 个 spec → specs/products/{产品 A}/current-spec.md
     功能: {M} 个活跃 FR, {K} 个已废弃
  ✅ {产品 B}: {N} 个 spec → specs/products/{产品 B}/current-spec.md
     功能: {M} 个活跃 FR

文档质量:
  {产品 A}: {完整章节数}/14 主章节完整
    待补充: {待补充章节名列表}
    对外文档摘要: {完整/部分/待补充}
  {产品 B}: {完整章节数}/14 主章节完整
    对外文档摘要: {完整/部分/待补充}

产品映射: specs/products/product-mapping.yaml
doc 上游摘要: 已写入 current-spec.md 的“对外文档摘要（供 spec-driver-doc 使用）”区块
实体目录:
  ✅ {产品 A}: specs/products/{产品 A}/_generated/entity.yaml
  ✅ {产品 B}: specs/products/{产品 B}/_generated/entity.yaml
Catalog 索引: specs/products/_generated/catalog-index.yaml
持续治理:
  ✅ {产品 A}: specs/products/{产品 A}/_generated/scorecard-report.md
  ✅ {产品 B}: specs/products/{产品 B}/_generated/scorecard-report.md
Scorecard 索引: specs/products/_generated/scorecard-index.yaml
本地反馈:
  ✅ spec-driver: specs/products/spec-driver/_generated/adoption-report.md
  数据源: .specify/runs/*.jsonl（本地，不默认提交）
在线调研证据: {if online_research_required: ".specify/research/sync-online-research.md"}{if not online_research_required: "跳过（项目未要求）"}
══════════════════════════════════════════
```

### GATE_TASKS 裁剪接受口径

以下区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/gate-tasks-scope-cut-acceptance.md` 注入，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: gate-tasks-scope-cut-acceptance -->
**`GATE_TASKS` 裁剪接受口径（由 `templates/gate-tasks-scope-cut-acceptance.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

「已裁剪」不是无准入门槛的合法终态。标注为 `[必须]` 或 MUST 的项要裁剪，必须在 `GATE_TASKS` 这一道**既有**门上被**显式接受**；本块规定该门停下时展示什么、接受什么、以及门没停下时怎么判。**本块不新增任何门、不改 `gate_policy` 到 `behavior` 的映射、不改 `orchestration.yaml` 的 gate 定义。**

## 何时触发

**触发条件 = 本次 `plan.md` 的裁剪登记中，MUST / `[必须]` 项条数非空。**

判据**复用该门既有的 `on_failure` 语义、不新造判据**：`GATE_TASKS` 的既有口径是「检查任务分解是否有明显问题：有 → 停下；无 → 自动继续」。本块把「**MUST / `[必须]` 裁剪登记非空**」定义为该判据下的「有明显问题」之一。

**三条 policy 路径逐条列全（防某条路径静默放行）**：

| `gate_policy` | 该门解析出的 `behavior` | 本块的落点 |
|---|---|---|
| `strict` | `always` | 门无条件停下，接受动作在这一次**既有**的门内交互中完成 |
| `balanced` | `always` | 同上 |
| `autonomous` | `on_failure` | MUST 裁剪登记非空即命中上述既有判据，门**同样**停下并完成接受 |

**`autonomous` 一行与直觉相反，一律以实测映射为准**：它并不意味着「自动继续」，只意味着「有问题才停」，而 MUST 裁剪非空按本块定义就是「有问题」。

**`fix` 模式下本条结构性不可达**：`GATE_TASKS` 实际挂载 **7 ÷ 8** 个模式（`feature` / `story` / `implement` / `resume` / `sync` / `doc` / `refactor`），**`fix` 零挂载**（换算式 7 ÷ 8 = 87.5%，单位：模式）。`GATE_TASKS.applicable_modes` 虽含 8 个模式，**但那不是挂载证据**——配置健康 ≠ 执行在场。故 `fix` 下发生 MUST 裁剪时按下文「门不停时的判定」一律记「未接受」；确需在 `fix` 下裁剪 MUST 项的，**须改走带编号的移交卡**，**不得**为此在 `fix` 补挂新门。

## 展示什么与接受什么

**单列成组**：被裁剪的 MUST / `[必须]` 项必须**单独列成一组**呈现，**不得**与 `[可选]` 项的裁剪混在同一份清单里一并放行，也**不得**以「plan 里已写理由」替代本次的显式接受。

**每条必须展示的四项**（缺一即该条未被有效展示）：

1. 被裁剪的 FR 编号**与其强度标注**（`MUST` / `[必须]` / `[可选]`）；
2. 该 FR 的**原文**——**不是摘要、不是结论转述**。给用户看的裁剪清单不能比内部引用更松：内部引用历史内容尚且要求附原文片段，此处更不能只给一句概括；
3. 裁剪理由；
4. 接受该裁剪的 gate 时点。

**接受粒度按组规模分档，K 由 spec 钉死为 3**：

- 被裁剪的 MUST / `[必须]` 项 **≤ 3 条** ⇒ 可**整组接受**；
- **> 3 条** ⇒ **必须逐条接受**，不得整组放行。

换算式：整组接受的上限条数 = **3**（单位：FR 条）；判据为「被裁剪 MUST 项条数 ≤ 3」。**分档理由**：长清单是主路径而非边界情况，组规模无上界时用户只能整组批准或整组拒绝，而整组拒绝要退回 plan 重做、代价远高于批准，构成严格占优路径。

**逐条接受在同一次门内交互中以多选形式完成，不增加门停下的次数。** 逐条接受改变的是**同一次交互内的粒度**（一次多选 vs 一次是非），不是门停下的**次数**；实现上落成单次多选，**禁止**拆成 N 次分别停下。这是与「本次改动不得新增任何用户确认点、不得加重 GATE 交互负担」的相容口径。

**留痕**：接受结论须与上述四项同处记录，使「哪一条被裁、凭什么被接受、在哪个时点被接受」可逐条回溯。

**强度上限（不得被总括为「已解决」）**：K 以内的整组接受**仍然存在信息损失**——3 条 MUST 项一并放行时，用户对其中任一条的单独异议在产物上无法与「三条都同意」区分。本口径把无上界的长清单收敛为有上界的短清单，**没有**消除批量语义。凡把本块口径为「裁剪已逐条经用户确认」，在 ≤ 3 条的路径上即为 over-claim。

**累计上界**：全卡累计已接受裁剪达 **3 条**后，再出现任何一条 MUST 裁剪一律**不得**经本块接受，须改走带编号的移交卡——移交不走裁剪通道。

## 门不停时的判定

**该门的 `behavior` 被解析为 `auto` 或 `skip` 时，门不会停下。此时不得因「门没停」而视为已接受。**

已知路径两条：`user_config` 把该门的 `pause` 覆盖为 `auto`；或 `.specify/orchestration-overrides.yaml` 把该门的 `default_behavior` 覆盖为 `auto` / `skip`（四级优先级为 `user_config > hard_gate > gate_policy > yaml_default`）。

**处置（fail-loud，不静默接受）**：被裁剪的 MUST 项一律记「**未接受**」。该态按交付判定的合并律归入**不通过**侧，交付整体判**不通过**。产物中出现「未接受」而交付仍被口径为「通过 / 全部达成」的，判 over-claim。

**`fix` 的零挂载同此处置**：`fix` 下该门根本不在 phase 序列上，接受点结构性不可达 ⇒ MUST 裁剪**一律**记「未接受」，走同一条不通过判定。

**判不出时从严**：`behavior` 取不到、gate 查询失败、或裁剪登记本身读不出来时，一律按「未接受」处理，不得按「大概停过了」放行。

## 冻结值字段格式

本门同时是 `plan.md` 覆盖矩阵**冻结值**的取值时点。冻结值的**字段位**落在 `tasks.md` 的模板里，**格式定义在本块**——两处不得互相复制。

**计算**：冻结对象是 `plan.md` 的 `## FR → Phase 覆盖矩阵` 整节；先规范化（CRLF → LF、去行尾空白、折叠连续空行、去首尾空行），再取 sha256。

**字段位须记录的七项**：

| 字段 | 填写口径 |
|---|---|
| 冻结对象 | 被哈希的章节名与规范化规则 |
| 规范化 sha256 | 由**编排器**在本门时点计算并写入 |
| 表行数 | 附计数单位（如「以 `\| FR-0` 开头的表行」） |
| 冻结时点 | 日期 + 「本门用户授权后由编排器写入」 |
| commit sha | **可选**，与哈希**同处并列**；流程此时尚未 commit 时留空并写明留空 |
| 冻结后修订 | 矩阵正文禁无痕改写；如需修订，以带时间戳的追加记录置于矩阵章节**之外** |
| 复算命令 | **命令原文**原样写入，使任何人可独立复算 |

**编排器动作（四步，缺任一步即冻结值链断在编排器侧）**：

| # | 时点 | 动作 |
|---|------|------|
| 1 | 本门通过后（**立即**，不得延后到实现阶段） | 按上述规范化规则计算 `plan.md` `## FR → Phase 覆盖矩阵` 整节的 sha256 |
| 2 | 紧接第 1 步 | 把该哈希连同其余六项字段写入 `tasks.md` 的冻结字段位 |
| 3 | 写入后 | **本会话持有该哈希**（连同时点与表行数），直到本次流程结束 |
| 4 | 委派 verify 时 | 把持有的三项（哈希 + 时点 + 表行数）作为**冻结值注入块**写进 verify 的委派 prompt 显式清单 |

**第 3 / 4 步是整条链的承重段**：第 4 步缺席时，verify 拿不到 ① 注入值，按其判定态定义该项判「未执行（缺席）」并归入不通过侧；而第 3 步缺席时，编排器在 `GATE_VERIFY` 无持有值可比对，`held` 记 `absent`。**「委派 prompt 里没写冻结值」与「verify 自己声称三值一致」在产物上完全同形**——把第 4 步留在散文旁注而不进委派清单，等于没有这一步。

**注入**：冻结值由**编排器持有**并注入 verify 的运行时上下文，锚定介质是编排器发给 verify 的 prompt 文本。**磁盘上的 `tasks.md` 不是独立性依据**——持有 `Bash` 的一方可以连矩阵带哈希一并原地改写。

**判定权**：三值（编排器注入值 / `tasks.md` 制品读到的值 / 对当前 `plan.md` 矩阵的现算值）一律**只作参考**；判定权在编排器于 `GATE_VERIFY` 的**亲自重算**并与自己持有的注入值比对。注入值缺席即判「未执行（缺席）」，**不得**因另两值一致而判通过。

**取不到 commit sha 时的口径**：留空并写明留空，**禁止**用「最近一个含 tasks 制品的 commit」或「当前 `HEAD`」这类现推值顶替。
<!-- END SHARED SECTION: gate-tasks-scope-cut-acceptance -->

以下区块由 `npm run docs:sync:agents` 从 `plugins/spec-driver/templates/gate-verify-matrix-recompute.md` 注入，请勿手动编辑区块内容。

<!-- BEGIN SHARED SECTION: gate-verify-matrix-recompute -->
**`GATE_VERIFY` 矩阵冻结值重算（由 `templates/gate-verify-matrix-recompute.md` 单一事实源经 `npm run docs:sync:agents` 注入，请勿手改本块）**

冻结值链的**唯一外部锚**是编排器在 `GATE_VERIFY` 的**亲自重算**——verify 子代理持有 `Bash`，磁盘上的 `plan.md` 与 `tasks.md` 都在它的写面之内，同一次推理可连矩阵带哈希一并原地改写；它改不了的只有编排器发给它的 prompt 文本，以及编排器自己算出来的那个数。**本块把该重算写进编排器的可执行口径**：委派清单一项、门决策前置一步、日志行三个字段位。**本块不新增门、不新增任何需要用户拍板的中断点、不改 `gate_policy` 到 `behavior` 的映射、不改 `orchestration.yaml` 的 gate 定义**——它只规定这一道**既有**门在做决策之前必须先算什么、日志里必须留下什么。

## (a) verify 委派 prompt 的显式清单加一项

委派 verify 子代理时，prompt 的显式清单**必须包含**：

> **`GATE_TASKS` 冻结值注入块** —— 三项齐全：**规范化 sha256** + **冻结时点** + **表行数（含计数单位）**。

- 该注入块的产生者是编排器在 `GATE_TASKS` 通过后执行的四步动作（见共享块 `gate-tasks-scope-cut-acceptance.md` 的「冻结值字段格式」一节）。
- **不在清单里就等于没有**：委派拼装是逐项照抄清单的，写在别处的旁注不会被拼进去。清单缺该项时，verify 拿不到 ① 注入值，按其判定态定义该项判「**未执行（缺席）**」并归入不通过侧。
- **本会话无持有值时照样要写**：写「冻结值注入块：`absent`（原因：{本 mode 不挂 `GATE_TASKS` / `resume` 会话未取到冻结字段 sha / 其他}）」。**留空与写 `absent` 不等价**——前者与「忘了拼」同形。

## (b) `GATE_VERIFY` 决策的前置步骤（在取 `behavior` 之前先算）

**顺序固定：先重算、再取 `behavior`、最后决策。** 把重算放到决策之后，就只剩一个记录动作，无法影响结论。

**第 1 步 · 重算**（命令原文，逐字照抄，把 `<plan.md>` 换成本次 `plan.md` 的实际路径）：

```bash
python3 -c "import re,hashlib;t=open('<plan.md>',encoding='utf-8').read();s=re.search(r'(?ms)^## FR → Phase 覆盖矩阵\n(.*?)(?=^## )',t).group(1);n='\n'.join(l.rstrip() for l in s.replace('\r\n','\n').split('\n'));n=re.sub(r'\n{3,}','\n\n',n).strip('\n')+'\n';print(hashlib.sha256(n.encode()).hexdigest())"
```

该命令实现的规范化与冻结时点**同一套**：CRLF → LF、去行尾空白、折叠连续空行、去首尾空行后补一个换行，再取 sha256。**两处不得各写一套**——规范化规则不同则两个哈希必然不等，重算会恒报不一致。

**第 2 步 · 比对**：把第 1 步的输出与**本会话持有的 `GATE_TASKS` 注入值**比对，得出三个字段：

| 字段 | 取值 | 口径 |
|---|---|---|
| `recomputed` | `{sha8}` | 第 1 步输出的**前 8 位**；命令报错或章节取不到时记 `error` |
| `held` | `{sha8}` 或 `absent` | 本会话持有值的前 8 位；**无持有值记 `absent`** |
| `match` | `yes` / `no` / `absent` | 两值相等记 `yes`，不等记 `no`，**任一侧为 `absent` 或 `error` 记 `absent`** |

**`absent` 的三种合法来源（须在 `reason` 里写明是哪一种）**：

1. 本 mode 不挂 `GATE_TASKS`（如 `fix`），本会话从来没有过冻结值；
2. `resume` 会话取不到冻结字段的 commit sha（缺 sha，或 `git cat-file -e <sha>` 失败）；
3. 重算命令本身失败（`plan.md` 不存在、矩阵章节取不到、`python3` 不可用）。

**`match=absent` ⇒ 矩阵对账记「未执行（缺席）」**并归入合并律的不通过侧。**不得**因「本 mode 本来就没有冻结值」而把该项记为通过——「没有可比的」与「比过了且一致」是两件事，前者是缺席不是达标。

**第 3 步 · 取 `behavior` 并决策**（既有流程不变），随后按 (c) 输出日志行。

## (c) 日志行模板（扩三个字段位）

```text
[GATE] GATE_VERIFY | policy={gate_policy} | override={有/无} | decision={PAUSE|AUTO_CONTINUE} | merge={pass|fail} | recomputed={sha8|error} | held={sha8|absent} | match={yes|no|absent} | reason={理由}
```

- `merge` 取自 verify 返回摘要里的**合并律结论**（`pass` / `fail`）；返回摘要没有该结论时记 `fail` 并在 `reason` 写明「合并律结论缺席」——**缺结论按不通过处理**，与「判不出从严」同向。
- **三个新字段位不是可选装饰**：**没有字段位的要求等于没有要求**，日志行模板是编排器唯一会照抄的东西。缺字段位时，「算了并比对了」与「一步没做而 verify 自报三值一致」在日志上完全同形。
- `reason` 在 `match=no` 时**必须**写明差异：重算值、持有值、以及「矩阵在哪个阶段被改过」的判断。

## (d) 决策必须消费上面两个结论

**`merge=fail` 或 `match=no` ⇒ 不得 `AUTO_CONTINUE`。**

- 这一条**优先于 `behavior` 的 `auto`**：`behavior=auto` 只说明这道门在无异常时不停下，它**不构成**对「合并律判不通过」或「重算与持有值不一致」的放行依据。
- `match=absent` 时按上文归为「未执行（缺席）」⇒ 计入合并律不通过侧 ⇒ 由 `merge=fail` 承接，同样不得 `AUTO_CONTINUE`。
- **本条不改变门是否停下的 `behavior` 语义**：它改变的是**决策取值**——`decision` 不得取 `AUTO_CONTINUE`，转入该门既有的处置路径（展示制品与结论，等用户裁决）。**这是既有交互，不是新增的中断点。**

**为什么这一条必须写在编排器侧而不是 verify 侧**：verify 的判定态定义里已有「① 缺席 ⇒ 判『未执行（缺席）』」，那条 fail-loud 反过来给了 verify 一个**造假动机**——不自写 ①，本项就必红。三值全部由 verify 自读、自算、自报，人工在门内看到的是它自报的一致，没有任何独立读数可对。**编排器的重算是这条链上唯一一个不落在 verify 写面内的读数。**
<!-- END SHARED SECTION: gate-verify-matrix-recompute -->

### mode 条件格触发条件的三项约束

> 本节约束的是 **mode 分层矩阵中「条件」格的触发条件**，不是门本身。「条件」格在触发条件不成立时须输出**显式的「不适用（理由）」**，留空或形式主义空表与漏做同等判不合格。触发口径统一为**内容触发**——按「本次有没有 FR 列表 / 有没有关键量 / 有没有代码改动」判定，**不按 mode 名判定**。这三条判据**全部由执行者自行声明、无任何外部校验**，一句「本次无 FR 列表」即可把两项主结构整体关掉，因此附以下三项约束。

**(i) 判定结论必须与其依据写在同处。** 声明「无 FR 列表」「无关键量」「无代码改动」时，须**在同一处**附上得出该结论的**命令原文**与**其原始输出**（留痕标准与关键量反向普查一致：命令原样写出、可被他人直接复跑；输出是原始输出或其计数，不是结论转述）。**仅有声明而无依据的关闭，视为未做判定**——「没查」与「查了且确实没有」在产物上完全同形。

**(ii) 门禁 / 判定器 / 安全类改动一律升格为强制，与 mode 解耦。** 本次改动按**白名单式命中面判据**（路径条 **13**：`plugins/spec-driver/scripts/**`、`plugins/spec-driver/hooks/**`、`plugins/spec-driver/contracts/**`、`.specify/orchestration-overrides.yaml`、`plugins/spec-driver/agents/**`、`plugins/spec-driver/skills/**`、`plugins/spec-driver/templates/**`、`plugins/spec-driver/lib/**`、`plugins/spec-driver/config/orchestration.yaml`、仓根 `scripts/**`、`.specify/templates/**`、`plugins/spec-driver/skills-codex/**`、`.codex/skills/**`；语义条 **1**：任何「失效即静默放行」的判定器 / 守护 / 安全检查**逻辑，不论其载体是代码还是 prompt / 模板散文**——命中其一即判为门禁类。换算式：命中面 **14** 条 = 路径条 13 + 语义条 1，单位：命中条。**与共享块 `templates/gate-design-convergence-loop.md` 的分类表路径集合与换算式同源（本句是手写副本、非注入块，文本形式与块内表格不同；两处不得各列一套路径，改一处必同批改另一处并以 sha 抽检）**）被判为门禁 / 判定器 / 安全类时，**mode 分层矩阵第 1 项（FR 覆盖矩阵与裁剪登记）与第 4 项（关键量反向普查）在全部 mode 下升格为强制**，**不接受内容触发式关闭**。即触发条件与「本次是否属门禁 / 判定器 / 安全类改动」**解耦**：门禁类改动**不因 mode 名、也不因执行者自述而降级**。
>
> 换算式：受本项升格影响的检查项 = 第 1 项 + 第 4 项 = **2 项**（单位：矩阵行）；升格的射程 mode = 全部 **8** 个（单位：mode）。两个计数单位**分列、不得相加**。

**(iii) 触发条件判不出时按「成立」处理**，即按「该项被要求」处理（走强制侧），与门禁类分类判据的「判不出 ⇒ 从严」同向。**不得**因为「拿不准本次算不算有 FR 列表 / 有关键量 / 有代码改动」而落到关闭侧；拿不准本身就是依据不足，依据不足只能从严。

**本节与三条轻量纪律是两类东西，各判各的量。** 引用原文化 / 数量换算式与计数单位 / 推断前提登记与运行时实证三条在全部 8 个 mode 下**无条件强制、没有触发条件**，其适用范围声明的落点在产出型子代理的共享块内；本节管的是**有触发条件的那几项**如何防止被一句自述整体关掉。**两者不得互相顶替**——本节三项做到位不代表三条纪律已遵守，反之亦然。


### Prompt 来源

```text
prompt_source[sync] = "$PLUGIN_DIR/agents/sync.md"  // 始终使用内置版本
```
