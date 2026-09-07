---
name: spec-driver-refactor
description: "大规模代码重构 — 5 阶段：影响分析→分批规划→逐批实现→残留扫描→最终验证"
disable-model-invocation: false
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Task]
model: opus
effort: high
---

# Spec Driver — 大规模重构模式（Refactor 模式）

你是 **Spec Driver** 的重构编排器，角色为"**重构总监**"。你负责大规模代码重构——涉及全局重命名、模块拆分/合并、API 迁移、deprecated 概念清理等跨文件改动——通过影响分析、分批执行和残留扫描确保重构完整性。

## 触发方式

```text
/spec-driver:spec-driver-refactor --target <重构目标> [描述]
/spec-driver:spec-driver-refactor --target src/parsers "拆分为 core 和 extensions"
/spec-driver:spec-driver-refactor --target CodeSkeleton --dry-run "重命名为 ASTNode"
/spec-driver:spec-driver-refactor --target src/old-module --batch-size 5 "迁移到 src/new-module"
```

## 输入解析

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `--target` | string | 是 | 重构目标：文件路径、目录、模块名或概念名 |
| 描述 | string | 否 | 重构意图（首个非 flag 参数） |
| `--preset` | string | 否 | 临时覆盖模型预设 |
| `--batch-size` | number | 否 | 每批最大文件数（默认 10） |
| `--dry-run` | boolean | 否 | 仅执行影响分析+分批规划，不进入实现 |

**解析规则**: 无 `--target` 参数 → 提示用户输入。

---

## 初始化阶段

### 0. 插件路径发现

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

### 1. 项目环境检查

运行 `bash "$PLUGIN_DIR/scripts/init-project.sh" --json`，解析 JSON 输出。

### 2. Constitution 处理

如果 NEEDS_CONSTITUTION = true：暂停，提示用户先运行项目宪法入口。

### 3. 配置加载

- 读取 spec-driver.config.yaml（或创建新配置）
- 应用 `--preset` 参数（若提供）

### 3.5 项目上下文注入

```bash
node "$PLUGIN_DIR/scripts/resolve-project-context.mjs" --project-root . --json
```

### 4. 门禁配置加载（通过编排器查询）

通过 Orchestrator 查询 refactor 模式的 Gate 行为：

```bash
for GATE in GATE_TASKS GATE_VERIFY; do
  behavior[$GATE] = Orchestrator.getGateBehavior("$GATE").behavior
done
```

### 5. 特性目录准备

从重构描述生成特性短名（格式：`refactor-<简述>`），创建特性分支和目录。

### 6. 重构目标验证

```text
1. 解析 --target 参数
2. 验证目标存在性：
   - 文件路径 → 检查文件是否存在
   - 目录路径 → 检查目录是否存在
   - 概念名 → grep 确认至少有 1 个匹配
3. 目标不存在 → 报错终止
4. 输出: [REFACTOR] 目标类型={file|directory|concept} 目标={target}
```

---

## 子代理调度时的工具优先级提示

主编排器在 dispatch 子代理时，**显式在 `Task()` prompt 中包含**以下提示（理由见各 sub-agent frontmatter 的「工具优先使用规则」章节，单一事实源：`plugins/spec-driver/templates/preference-rules.md`）：

> 提示：本任务可能涉及 caller analysis / impact 评估 / git diff 影响分析。
> **优先使用 `mcp__plugin_spectra_spectra__*` 工具**（`impact` / `context` / `detect_changes`）而非默认 Read/Grep——
> 它们提供 transitive 依赖深度、BFS 受影响 symbol 列表与 nextStepHint 链式引导；Grep 仅作 MCP 不可用（graph-not-built）时的 fallback。

该提示与 5 个 sub-agent prompt body 的「工具优先使用规则」表共享单一事实源（`templates/preference-rules.md`），由 `scripts/sync-preference-rules.mjs` 守护一致性。

## 工作流定义（5 阶段）

### Phase 1: 影响分析 [1/5]

`[1/5] 正在执行影响分析...`

读取 `$PLUGIN_DIR/agents/refactor-plan.md`，调用 Task：
```text
Task(
  description: "执行影响分析",
  prompt: "{refactor-plan prompt}" + "{上下文注入: target, feature_dir, project_root}",
  model: "{config.agents.refactor-plan.model || opus}"
)
```

验证 `{feature_dir}/impact-report.md` 已生成。

**超阈值检查**: 如果影响文件 > 100，提升风险至 critical 并暂停要求确认。

---

### Phase 2: 分批规划 [2/5]

`[2/5] 正在生成分批规划...`

再次调用 refactor-plan agent（Phase 2 模式）：
```text
Task(
  description: "生成分批规划",
  prompt: "{refactor-plan prompt}" + "{上下文注入: impact-report.md 路径, batch_size}",
  model: "{config.agents.refactor-plan.model || opus}"
)
```

验证 `{feature_dir}/refactor-plan.md` 已生成。

**质量门（GATE_TASKS）**: 根据 behavior[GATE_TASKS] 决策。

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

**注入**：冻结值由**编排器持有**并注入 verify 的运行时上下文，锚定介质是编排器发给 verify 的 prompt 文本。**磁盘上的 `tasks.md` 不是独立性依据**——持有 `Bash` 的一方可以连矩阵带哈希一并原地改写。

**判定权**：三值（编排器注入值 / `tasks.md` 制品读到的值 / 对当前 `plan.md` 矩阵的现算值）一律**只作参考**；判定权在编排器于 `GATE_VERIFY` 的**亲自重算**并与自己持有的注入值比对。注入值缺席即判「未执行（缺席）」，**不得**因另两值一致而判通过。

**取不到 commit sha 时的口径**：留空并写明留空，**禁止**用「最近一个含 tasks 制品的 commit」或「当前 `HEAD`」这类现推值顶替。
<!-- END SHARED SECTION: gate-tasks-scope-cut-acceptance -->

**dry-run 检查**: 如果 `--dry-run`，输出规划摘要后终止，不进入实现。

---

### Phase 3: 逐批实现 [3/5]

`[3/5] 正在逐批执行重构...`

**批次循环模式（batch_loop）**:

```text
1. 读取 refactor-plan.md，解析批次列表
2. for batch in batches:
   a. 输出: [BATCH {N}/{total}] 正在处理 {batch.description}...
   b. 调用 implement agent:
      Task(
        description: "执行 Batch {N}: {batch.description}",
        prompt: "{implement prompt}" + "{上下文注入: batch 文件列表, 重构目标, 重构描述}",
        model: "{config.agents.implement.model}"
      )
   c. 中间验证:
      - 类型检查: tsc --noEmit（如适用）
      - 批次残留扫描: grep -rn "{旧名称}" {batch 涉及的目录}
   d. 如果中间验证失败:
      - 暂停，报告失败详情
      - 用户选择: A) 修复后继续 | B) 回滚此批次 | C) 中止
   e. 中间验证通过:
      - 输出: [BATCH {N}/{total}] ✅ 通过
      - 写入 trace.md
3. 所有批次完成后继续
```

---

### Phase 4: 残留扫描 [4/5]

`[4/5] 正在执行全量残留扫描...`

**此阶段由编排器亲自执行，不委派子代理。**

```text
1. 从 impact-report.md 提取旧标识符列表
2. 全仓库 grep 扫描:
   grep -rn "{旧名称}" --include="*.ts" --include="*.js" --include="*.mjs" --include="*.md"
3. 过滤已知豁免（如 git 历史、spec 文档中的描述性引用）
4. 生成 residual-report.md:
   - 残留数量: {N}
   - 残留位置列表
5. 如果残留数 > 0:
   - 暂停，展示残留位置
   - 用户选择: A) 手动修复 | B) 自动修复 | C) 标记为已知豁免
6. 如果残留数 == 0:
   - 输出: [残留扫描] ✅ 旧名称零残留
```

---

### Phase 5: 最终验证 [5/5]

`[5/5] 正在执行最终验证...`

读取 `$PLUGIN_DIR/agents/verify.md`，调用 Task：
```text
Task(
  description: "最终验证",
  prompt: "{verify prompt}" + "{上下文注入: impact-report, refactor-plan, residual-report}",
  model: "{config.agents.verify.model}"
)
```

**质量门（GATE_VERIFY）**: 根据 behavior[GATE_VERIFY] 决策。

---

## 完成报告

```text
══════════════════════════════════════════
  Spec Driver Refactor - 大规模重构完成
══════════════════════════════════════════

特性分支: {branch_name}
模式: refactor（分批重构）
重构目标: {target}

影响范围:
  影响文件数: {N}
  跨包引用: {是/否}
  风险评级: {level}

执行摘要:
  总批次: {total_batches}
  完成批次: {completed_batches}
  中间验证: {全部通过/部分失败}

残留扫描:
  旧名称残留: {0/N}

验证结果:
  构建: {状态}
  Lint: {状态}
  测试: {状态}

生成的制品:
  ✅ impact-report.md
  ✅ refactor-plan.md
  ✅ residual-report.md
  ✅ verification-report.md

建议下一步: git add && git commit
══════════════════════════════════════════
```

---

**版本**: 1.0.0（Feature 093）
**最后更新**: 2026-04-06
