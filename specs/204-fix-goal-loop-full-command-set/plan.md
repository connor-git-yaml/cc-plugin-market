# 修复计划 — goal_loop full 轮命令集完整性校验（F204）

> **基线**：F203（`9bb2ea3`），goal-loop-core.mjs 729 行版本。设计已由 fix-report.md + Codex 对抗审查锁定，本文件仅细化实现。

---

## 1. 变更文件清单（file-by-file）

| # | 文件 | 改动性质 | 具体改动点 |
|---|------|----------|------------|
| 1 | `plugins/spec-driver/scripts/lib/goal-loop-core.mjs` | 新增函数 + 接入点 | 新增 `validateFullCommandKinds` 纯函数（**含 kind 类型守卫**，C-3）；在 `decideStop` full 分支 `evaluateMetric` **为真之后、`REACHED_GOAL` 之前**调用（W-1 修正：不是"之前"） |
| 2 | `plugins/spec-driver/scripts/lib/config-schema.mjs` | 字段新增（非破坏） | `goalLoopSchema`（L106）加 `full_required_kinds` 字段 + **`BUILTIN_DEFAULTS`（L174）与 `resolveEffectiveConfig.nestedKeys`（L457）同步补该 dotPath**（W-2） |
| 3 | `plugins/spec-driver/agents/verify.md` | 文档更新 | `layer2_commands[]` schema 加 `kind` 字段；full mandate 各命令标注 kind；CRITICAL-8 段（L284）从"defer"改为"已实现" |
| 4 | `spec-driver.config.yaml` | 配置更新（dogfood） | goal_loop 注释段补 `full_required_kinds` 示例；本仓库显式取消注释并设 `['build','test','lint','check']` |
| 5 | `plugins/spec-driver/templates/goal-loop-override-template.yaml` | 模板补充 | 在 `goal_loop` 配置说明处写入 `full_required_kinds` 示例值 + 注释 |
| 6 | `plugins/spec-driver/tests/goal-loop-core.test.mjs` | 测试新增 | 新增 `validateFullCommandKinds` 单元用例 + `decideStop` 集成用例（AC-1~AC-7 全覆盖） |
| 7 | `plugins/spec-driver/tests/fixtures/goal-loop/report-full-pass-with-kinds.json` | fixture 新增 | 含 `kind` 字段的 full PASS 报告（正例 fixture，供 AC-3/AC-5 用） |
| 8 | `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` | 散文 **3 处**（编排器修正 + Codex C-1/C-2） | (i) 前置 step 1（L296-298）**读取 `full_required_kinds` 进 config**（否则不进 decide-stop payload，漏洞空转，C-1）；(ii) branch e（L490）exit_reason 集合加 `INCOMPLETE_FULL_VERIFY`；(iii) branch c（L477）forced-full 重 decide 显式处理 `INCOMPLETE_FULL_VERIFY`→转 GATE_VERIFY、不再 escalate（C-2）。见 §3.6。改后跑 `npm run repo:sync` 同步 codex wrapper 镜像（`.codex/skills/...`，W-6） |

**总计**：8 个源文件 + 1 个 repo:sync 自动生成的 `.codex` 镜像（W-6）+ 1 个新增 fixture，其余均为修改。符合 fix 模式范围（< 10 文件）。

> **[编排器修正 · 主线 plan 审查 + Codex Phase2]**：原假设"SKILL.md 不感知新 exit_reason、按 action 路由、config 自动流入 payload"——经核对 **三重不成立**：
> 1. dispatch 对 exit_reason 穷举 branch a–f、**无 default 兜底**（[SKILL.md:444-495](../../plugins/spec-driver/skills/spec-driver-feature/SKILL.md)）→ 新 exit_reason 需 branch e。
> 2. **decide-stop payload 的 config 是 step1 手挑的 4 个 goal_loop 键**（[SKILL.md:296-298](../../plugins/spec-driver/skills/spec-driver-feature/SKILL.md) + L435），**不含** `full_required_kinds` → 必须显式加进 step1 读取，否则 decideStop 收到的 config 无此字段、`||[]` 跳过、**漏洞空转**（Codex C-1）。
> 3. escalate→forced-full 的**二次重 decide**（branch c, L476-478）只写了"metric 满足→REACHED_GOAL / FAIL→重走 b/e/f"，未覆盖 `INCOMPLETE_FULL_VERIFY` → 需显式补（Codex C-2）。
>
> 注：读 config 这一步**任何接缝都需要**（parseReport 接缝同样要读 + 还要改 CLI 签名传参），故 decideStop 接缝仍最优。

---

## 2. `validateFullCommandKinds` 函数契约

### 2.1 精确签名

```js
/**
 * 校验 full 报告的 PASS 命令是否覆盖全部必需 kind 类别（F204）
 *
 * 纯函数：无 I/O、无副作用、幂等。
 *
 * @param {Object} report - parseReport 解析后的有效 report 对象（非降级态）
 * @param {string[]} requiredKinds - 期望必须出现的 kind 枚举数组，来自 config.full_required_kinds
 * @returns {{ complete: boolean, missing: string[] }}
 */
export function validateFullCommandKinds(report, requiredKinds) { ... }
```

### 2.2 输入输出定义

**输入**：
- `report`：经 `parseReport` 放行的合法 report 对象，调用方保证其为非降级态、`verify_mode='full'`
- `requiredKinds`：字符串数组，元素为 `'build' | 'test' | 'lint' | 'check'`，来自 `config.full_required_kinds`

**输出**：
- `complete: boolean`——PASS 命令的 kind 集合是否 ⊇ requiredKinds
- `missing: string[]`——缺失的 kind 列表，complete=true 时为空数组

### 2.3 边界行为（全部须有测试覆盖）

| 场景 | 行为 | 理由 |
|------|------|------|
| `requiredKinds` 为空数组 `[]` | `{ complete: true, missing: [] }` | 优雅降级：无期望则无需校验，保向后兼容（AC-4） |
| `requiredKinds` 为 `null` / `undefined` / 非数组 | 视同 `[]`，`{ complete: true, missing: [] }` | 防御性：config 字段缺省/畸形时的保底 |
| `requiredKinds` 含非字符串元素（如 `123`） | 该元素被过滤掉，不参与比较，**不抛异常**（C-3） | decideStop 须 total/stable，config 虽经 schema 校验但 payload 由编排器构造，不可信任 |
| `report.layer2_commands` 中命令无 `kind` 字段 | 该命令不贡献任何 kind；若 requiredKinds 非空则 missing 非空 | `kind` 缺失不等于存在，不可隐式推断 |
| 命令 `kind` 为非字符串（`123` / `null` / 对象） | 该命令不贡献 kind，**`.toLowerCase()` 前先 `typeof==='string'` 守卫，不抛异常**（Codex C-3） | LLM 报告可能产出畸形 `kind`，崩溃会破坏 decideStop 稳定转 GATE 的承诺 |
| 命令 `status !== 'PASS'`（FAIL/SKIPPED/UNKNOWN） | 不计入有效 kind 集合；只有 PASS 命令的 kind 算数 | 防 reward-hacking：FAIL 命令不能"代缴"完整性 |
| 全部命令 SKIPPED（无 PASS 命令） | kind 集合为空集，requiredKinds 非空时 `complete: false` | 等价于无有效验证 |
| `kind` 字段大小写（如 `'Build'`） | 以小写规范比较（`kind.toLowerCase()`），容忍 LLM 大小写变体 | 提高鲁棒性，减少误判 |
| `requiredKinds` 含重复元素 | 去重后比较（用 `Set`），重复不影响结果 | 防 config 意外重复导致 false negative |

### 2.4 参考实现逻辑（伪代码）

```js
export function validateFullCommandKinds(report, requiredKinds) {
  // requiredKinds 类型守卫（C-3）：非数组→[]；仅取字符串元素，小写规范
  const required = new Set(
    (Array.isArray(requiredKinds) ? requiredKinds : [])
      .filter((k) => typeof k === 'string')
      .map((k) => k.toLowerCase()),
  );
  // 空期望集 → 直接通过（优雅降级，AC-4）
  if (required.size === 0) return { complete: true, missing: [] };

  // PASS 命令的 kind 集合：仅取 kind 为字符串的命令（C-3：非字符串 kind 不贡献、绝不 .toLowerCase() 崩）
  const passKinds = new Set(
    (report && Array.isArray(report.layer2_commands) ? report.layer2_commands : [])
      .filter((cmd) => classifyCommand(cmd) === 'PASS' && typeof cmd.kind === 'string')
      .map((cmd) => cmd.kind.toLowerCase()),
  );

  // 找出缺失的 kind
  const missing = [...required].filter((k) => !passKinds.has(k));
  return { complete: missing.length === 0, missing };
}
```

---

## 3. `decideStop` 接入点——精确改动

### 3.1 改动位置

文件：`goal-loop-core.mjs`，函数 `decideStop`，优先级 3「达标」分支，`report.verify_mode === 'full'` 判断块内部。

### 3.2 改动前（现状 L394-398）

```js
if (!isDegraded) {
  if (report.verify_mode === 'full') {
    if (evaluateMetric(report)) {
      return { stop: true, exit_reason: 'REACHED_GOAL', action: 'goto_gate_verify' };
    }
    // full 未达标 → 落入后续优先级
```

### 3.3 改动后（目标）

```js
if (!isDegraded) {
  if (report.verify_mode === 'full') {
    if (evaluateMetric(report)) {
      // F204：在 REACHED_GOAL 之前校验命令集完整性
      const requiredKinds = (config && config.full_required_kinds) || [];
      const kindCheck = validateFullCommandKinds(report, requiredKinds);
      if (!kindCheck.complete) {
        // 命令集不完整 → 拒绝认证，交人工 GATE_VERIFY（fail-loud 语义）
        return {
          stop: true,
          exit_reason: 'INCOMPLETE_FULL_VERIFY',
          action: 'goto_gate_verify',
        };
      }
      return { stop: true, exit_reason: 'REACHED_GOAL', action: 'goto_gate_verify' };
    }
    // full 未达标 → 落入后续优先级
```

### 3.4 优先级位置说明

`INCOMPLETE_FULL_VERIFY` 插入位置：
- **在** 优先级 1（ROLLBACK_FAILED）**之后**——回滚失败仍最高优先
- **在** 优先级 2（REGRESSION_ROLLBACK）**之后**——回归检测仍在前
- **在** 优先级 3 的 `evaluateMetric` 判断**之内**，仅当 metric 满足时才进入 kind 校验
- **在** `REACHED_GOAL` **之前**——堵死假认证路径

### 3.5 `INCOMPLETE_FULL_VERIFY` 语义

- `stop: true`：循环终止（不再迭代）
- `action: 'goto_gate_verify'`：交人工 GATE_VERIFY 审核，与 REACHED_GOAL 同一出口（人工收口）
- 语义差异：REACHED_GOAL 表示机器确认达标，INCOMPLETE_FULL_VERIFY 表示"metric 满足但命令集缺必需类别"，人工决定是否接受
- **不复用 infra-failure**：infra-failure 计入 NO_PROGRESS，而命令集缺失是"verify 子代理产出不足"（主动契约违反），语义更接近"达标门缺条件"，直接 stop+交 gate 比进入无进展迭代更诚实

### 3.6 SKILL.md 修正（编排器修正 + Codex C-1/C-2，文件 #8，共 3 处 + 1 一致性）

**【编辑 1 · C-1 最紧要 · 配置接入】** 前置 step 1（[SKILL.md:296-298](../../plugins/spec-driver/skills/spec-driver-feature/SKILL.md)）当前只读 4 个 goal_loop 键，payload 的 `config:{goal_loop 配置}`（L435）即这 4 键。**必须把 `full_required_kinds` 加进 step 1 读取**，否则它不进 decide-stop payload，`config.full_required_kinds` 恒 undefined → `||[]` 跳过 → 即便 dogfood config 设了值也空转：

```diff
   1. 读取 goal_loop 配置（spec-driver.config.yaml 的 goal_loop 段）：
-     max_iterations / no_progress_max_rounds / max_verify_seconds / max_tool_invocations
-     （缺省时用 config-schema 默认：5 / 2 / 300 / 50）
+     max_iterations / no_progress_max_rounds / max_verify_seconds / max_tool_invocations / full_required_kinds
+     （缺省时用 config-schema 默认：5 / 2 / 300 / 50 / []）
```
（step 6 payload 的 `config:{goal_loop 配置}` 措辞不变，full_required_kinds 随 step1 读取自动流入。）

**【编辑 2 · branch e 出口】** 新 `INCOMPLETE_FULL_VERIFY` 在 dispatch（L444-495，无 default 兜底）需有 branch。并入 branch e（与 MAX_ITERATIONS/NO_PROGRESS 同为"fallback 退出转 GATE_VERIFY + 摘要"）：

```diff
-  e. exit_reason ∈ { 'MAX_ITERATIONS', 'NO_PROGRESS' }（action=goto_gate_verify，fallback 退出）
+  e. exit_reason ∈ { 'MAX_ITERATIONS', 'NO_PROGRESS', 'INCOMPLETE_FULL_VERIFY' }（action=goto_gate_verify，fallback 退出）
        → 退出循环，转 GATE_VERIFY，输出迭代摘要（含每轮 metric/delta/exit_reason）
+        （INCOMPLETE_FULL_VERIFY：full 轮 metric 满足但命令集缺必需 kind，交人工复核，绝非达标）
```

**【编辑 3 · C-2 · escalate 二次路由】** branch c（L476-483）forced-full 后重 decide 的分派当前只写"metric 满足→REACHED_GOAL / FAIL 或回归→重走 b/e/f"，未覆盖 `INCOMPLETE_FULL_VERIFY`。须显式补一条（落 branch e，**MUST NOT 再 escalate**——与既有 C1 非递归不变量一致）：

```diff
        - full 轮 metric 仍满足 → exit_reason=REACHED_GOAL（走分支 d，真正退出）
+       - full 轮 metric 满足但命令集缺必需 kind → exit_reason=INCOMPLETE_FULL_VERIFY（走分支 e，转 GATE_VERIFY，MUST NOT 再 escalate）
        - full 轮暴露 FAIL/回归 → 按其 action 重新走 b/e/f
```

**【一致性补充 · I-1】** L314 prevReports 示例枚举改 `{REACHED_GOAL, MAX_ITERATIONS, NO_PROGRESS, INCOMPLETE_FULL_VERIFY}`——catch-all「仅 continue 才追加」**已功能覆盖**（Codex I-1 确认），此纯散文一致性、不改行为。

**改后 MUST**：`npm run repo:sync`（同步 `.codex/skills/spec-driver-feature/SKILL.md` 镜像，W-6）+ `npm run repo:check`（零漂移）。dispatch 散文非生成块（可直接编辑），但 `.codex` 镜像由 sync 再生，须一并 commit。

---

## 4. schema 扩展——`kind` 字段

### 4.1 config-schema.mjs 改动（goalLoopSchema，L106）

在 `goalLoopSchema` 的 `z.object({...})` 中新增第 5 个字段（在 `max_tool_invocations` 之后）：

```js
// 命令集完整性校验（F204）：full 报告必须包含这些 kind 类别的 PASS 命令才能 REACHED_GOAL。
// 默认 []（跳过校验，保向后兼容）；项目级 opt-in：['build','test','lint','check']。
full_required_kinds: z.array(z.enum(['build', 'test', 'lint', 'check'])).default([]),
```

**注意**：`goalLoopSchema` 当前无 `.strict()`（`batchSchema` 有），新增字段不会因 strict 校验失败。

**同步 effective-config 机制（Codex W-2）**：只加 zod 字段不够——`resolveEffectiveConfig`/`--show-effective` 走独立的 `BUILTIN_DEFAULTS` + `nestedKeys` 白名单（[config-schema.mjs:174](../../plugins/spec-driver/scripts/lib/config-schema.mjs) + L457 各硬列 4 个 goal_loop dotPath）。须同步补：
- `BUILTIN_DEFAULTS` 加 `'goal_loop.full_required_kinds': []`
- `resolveEffectiveConfig` 的 `nestedKeys` 数组加 `'goal_loop.full_required_kinds'`

**数组值格式化校验**：现有 4 个 goal_loop 默认值都是标量（5/2/300/50），本字段默认是**数组 `[]`**。须确认 `resolveEffectiveConfig` 的 `entries.push({value})` + `--show-effective` 渲染能容数组值（如显示 `[]` 或 JSON）；若渲染对数组不友好，退路：不纳入 nestedKeys 白名单、在文档注明"--show-effective 不展示 full_required_kinds"（功能不受影响，仅调试可见性）。此点 implement 阶段实测 `--show-effective` 输出确认。

### 4.2 verify.md `layer2_commands[]` schema 改动

在 verify.md L225-234 的 `layer2_commands` schema JSON 块中，每条命令新增 `kind` 字段：

```jsonc
{
  "name": "npx vitest run",
  "exit_code": 0,
  "status": "PASS",
  "duration_seconds": 8.1,
  "output_summary": "...",
  "skipped_reason": null,
  "kind": "test"            // F204 新增：命令类别。枚举：build | test | lint | check
                             // 可选字段，旧报告不含此字段时不影响行为（full_required_kinds=[]默认跳过）
}
```

### 4.3 verify.md full mandate 各命令标注 kind（L261-266）

将现有 full 轮命令集清单改为：

```
1. `npm run build`          → kind: "build"   → dist 就位
2. `npx vitest run`         → kind: "test"    → 含 e2e（dist 已就位）
3. `npm run lint`（如适用）→ kind: "lint"
4. `npm run repo:check`     → kind: "check"
```

### 4.4 verify.md CRITICAL-8 段更新（L284）

将现有文字（"有意不在 core 校验/follow-up"）改为：

```
**关于 full 命令集完整性（F203 CRITICAL-8 → F204 已实现）**：
F204 在 `decideStop` 的 full 路径引入 `validateFullCommandKinds` 纯函数，校验 PASS 命令的 `kind`
集合是否覆盖 `config.full_required_kinds`（默认 `[]`，项目级 opt-in）。
缺必需类别 → `exit_reason: 'INCOMPLETE_FULL_VERIFY'`，止步于 GATE_VERIFY，不 REACHED_GOAL。

**保护边界（诚实说明）**：`kind` 由 verify 子代理自报，与 `exit_code` 同源（同层级）。
- **能挡**：遗漏/截断（LLM 漏跑 lint、输出被截断少了命令）——这是把散文 mandate 升级为机器校验的真实新增保护。
- **不能挡**：对抗性误标（把 `echo ok` 标 `kind:'test'`）。此残留与现有 `dist_not_built` 校验同层级，
  由人工 GATE_VERIFY + Codex 对抗审查兜底。
```

---

## 5. config 和模板改动

### 5.1 spec-driver.config.yaml（dogfood opt-in）

在 goal_loop 段（L127-138）进行两处改动：

（a）取消注释激活 goal_loop 段，并设置 `full_required_kinds`：

```yaml
goal_loop:
  max_iterations: 5
  no_progress_max_rounds: 2
  max_verify_seconds: 300
  max_tool_invocations: 50
  full_required_kinds: ['build', 'test', 'lint', 'check']  # F204 dogfood opt-in
```

（b）在注释段说明处补充 `full_required_kinds` 说明行。

**注意**：取消注释 goal_loop 段会使 `validateConfig` 实际解析该配置，需确认不破坏现有 config 测试（goal_loop 段本就有 `.default({})` 兜底，显式声明只是补覆盖）。

### 5.2 goal-loop-override-template.yaml（opt-in 入口兜底）

在模板文件顶部注释的"goal_loop 预算/迭代参数"说明段（L14：`goal_loop 的 runtime dispatch`）之后，补充 `full_required_kinds` 配置示例段：

```yaml
# goal_loop 命令集完整性校验（F204）：
# full_required_kinds 声明 full 轮必须出现的命令类别（build/test/lint/check）。
# 默认 []（跳过）；推荐配置如下（适用于大多数 TypeScript 项目）：
#
# goal_loop:
#   full_required_kinds: ['build', 'test', 'lint', 'check']
#
# 注意：verify 子代理必须在 layer2_commands 每条命令上标注 kind 字段，
# 否则即使 kind 实际覆盖，校验也会视为缺失（kind 不标 = 不贡献）。
```

---

## 6. 新增 fixture

### 6.1 `report-full-pass-with-kinds.json`

路径：`plugins/spec-driver/tests/fixtures/goal-loop/report-full-pass-with-kinds.json`

该 fixture 是 `report-full-pass.json` 的扩展版，每条命令加 `kind` 字段，并额外含一条 `npm run lint`（kind: lint）。用于 AC-3（full 含全部必需 kind → REACHED_GOAL）和 AC-5 的对照。

```json
{
  "round": 2,
  "timestamp": "2026-06-20T10:08:00Z",
  "verify_mode": "full",
  "wall_seconds": 115.0,
  "layer2_commands": [
    { "name": "npm run build",    "kind": "build", "exit_code": 0, "status": "PASS", "duration_seconds": 18.1, "output_summary": "Build succeeded", "skipped_reason": null },
    { "name": "npx vitest run",   "kind": "test",  "exit_code": 0, "status": "PASS", "duration_seconds": 41.5, "output_summary": "312 passed",       "skipped_reason": null },
    { "name": "npm run lint",     "kind": "lint",  "exit_code": 0, "status": "PASS", "duration_seconds": 6.2,  "output_summary": "Lint clean",        "skipped_reason": null },
    { "name": "npm run repo:check","kind": "check","exit_code": 0, "status": "PASS", "duration_seconds": 9.5,  "output_summary": "repo:check clean",  "skipped_reason": null }
  ],
  "layer1_fr_coverage": { "p1_total": 12, "p1_covered": 12, "p1_coverage_pct": 100, "uncovered_fr_ids": [] },
  "layer1_5_evidence":  { "status": "COMPLIANT", "detail": "full 轮全部 P1 FR 证据齐备" },
  "regression_check":   { "previously_passing_commands": [], "now_failing": [], "regression_detected": false },
  "delta_inputs":       { "layer2_pass_count": 4, "p1_fr_coverage_pct": 100, "layer1_5_status_score": 2, "regression_count": 0, "net_loc_delta": 28 }
}
```

---

## 7. 测试策略——AC-1~AC-7 映射

所有新用例加入 `plugins/spec-driver/tests/goal-loop-core.test.mjs` 的现有 `describe` 块结构中。

### 7.1 `validateFullCommandKinds` 单元用例（新 describe 块）

| 测试用例 | 对应 AC | 断言 |
|----------|---------|------|
| `requiredKinds=[]` → `complete:true, missing:[]` | AC-4 | 优雅降级 |
| `requiredKinds=null` → `complete:true, missing:[]` | AC-4 | 防御性 null 处理 |
| PASS 命令含全部 required kinds | AC-3 | `complete:true, missing:[]` |
| PASS 命令缺 lint → missing=['lint'] | AC-2 | `complete:false, missing:['lint']` |
| PASS 命令全无 kind 字段 + requiredKinds=['test'] | AC-2 变体 | `complete:false, missing:['test']` |
| FAIL 命令有 kind + PASS 命令无 kind → 缺失 | AC-2 变体 | FAIL 命令不计入，仍 missing |
| 大小写变体：`kind:'Build'` 匹配 `'build'` | 边界 | `complete:true` |
| requiredKinds 含重复元素 `['test','test']` | 边界 | 去重后正常比较 |
| echo-ok 单条命令（无 kind）+ required=['test'] | AC-5 基础 | `complete:false` |

### 7.2 `decideStop` 完整性集成用例（加入现有 describe 块）

| 测试用例 | 对应 AC | 断言 |
|----------|---------|------|
| `report-full-pass.json` + `full_required_kinds:[]`（默认） | **AC-1**（零回归） | `exit_reason:'REACHED_GOAL'` 不变 |
| `report-full-pass-with-kinds.json` + `full_required_kinds:['build','test','lint','check']` | AC-3 | `exit_reason:'REACHED_GOAL'` |
| full 报告缺 lint kind + `full_required_kinds:['build','test','lint','check']` | AC-2 | `exit_reason:'INCOMPLETE_FULL_VERIFY', stop:true, action:'goto_gate_verify'` |
| echo-ok full 报告 + `full_required_kinds:['build','test','lint','check']` | **AC-5**（CRITICAL-8 复现） | **不** `REACHED_GOAL`；`exit_reason:'INCOMPLETE_FULL_VERIFY'` |
| smoke 报告 + 任意 `full_required_kinds` | AC-6 | smoke 分支不受 `validateFullCommandKinds` 影响（smoke 不走 full 分支） |
| `full_required_kinds:[]` + echo-ok full | AC-4 | 跳过校验 → `evaluateMetric` 通过 → `REACHED_GOAL`（降级行为等同现状） |

### 7.3 config schema 用例（加入现有 config-schema describe 块）

| 测试用例 | 对应 AC | 断言 |
|----------|---------|------|
| 省略 `full_required_kinds` | AC-7 | `validateConfig` 通过；输出含 `goal_loop.full_required_kinds: []` |
| `full_required_kinds: ['build','test']` | AC-7 | `validateConfig` 通过，字段保留 |
| `full_required_kinds: ['invalid']` | AC-7 变体 | `validateConfig` 抛 Zod 校验错误 |

**TDD 原则**：全部上述用例先写红测试，验证其在当前代码上因桩/缺实现而失败，再逐步实现转绿。

---

## 8. 回归风险评估

### 8.1 默认 `[]` 如何保住 141 pass baseline

关键路径分析：

1. 现有所有测试均在 `config` 中**不包含** `full_required_kinds` 字段（或 config 取 Zod default `{}`）
2. `goalLoopSchema` 的新字段带 `.default([])`，省略时自动填为 `[]`
3. `validateFullCommandKinds(report, [])` 在 `required.size === 0` 时立即返回 `{ complete: true, missing: [] }`，**不读任何 report 字段**
4. 因此现有 `report-full-pass.json` 的 `evaluateMetric=true` → `decideStop` 路径完全不变

**零回归保证**：`requiredKinds=[]` 时，`validateFullCommandKinds` 是纯短路函数，与不存在一样，已有行为完整保留。

### 8.2 影响面核查

```
直接修改文件: 7 个源文件（goal-loop-core / config-schema / verify.md / spec-driver.config / override-template / goal-loop-core.test / config-schema.test）+ SKILL.md
新增文件: 1 个（fixture report-full-pass-with-kinds.json）
repo:sync 自动再生: 1 个（.codex/skills/spec-driver-feature/SKILL.md 镜像，W-6）
跨包影响: 无（goal-loop-core.mjs 被 goal-loop-cli.mjs 调用，cli 签名不变）
CLI 签名变更: 无（decideStop 接缝 payload 已含 config，parse-report/decide-stop 调用点与签名不变）
SKILL.md 变更: 3 处散文（step1 读 full_required_kinds[C-1] + branch e 出口 + branch c 二次路由[C-2]）+ L314 一致性；改后 repo:sync 同步镜像
config-schema.mjs 变更: 3 处（goalLoopSchema 字段 + BUILTIN_DEFAULTS + nestedKeys，W-2）
公共 API 变更: 无（parseReport 签名不变；新增 export `validateFullCommandKinds`，纯新增 + 类型守卫）
数据迁移: 无（verify.md 的 kind 字段可选，旧报告无 kind 不触发校验）
```

**风险等级：LOW**——影响文件 < 10，无跨包影响，无 schema 破坏性变更，无 CLI 签名变更。

---

## 9. TDD 红→绿实现顺序

```
T1  [schema]  config-schema.mjs — 新增 full_required_kinds 字段（带 default:[]）
      红: AC-7 schema 用例失败（字段不存在）
      绿: 加字段后通过

T2  [core-fn]  goal-loop-core.mjs — 实现 validateFullCommandKinds 纯函数
      红: validateFullCommandKinds 单元用例全部失败（函数未定义）
      绿: 实现函数后通过

T3  [core-integrate]  goal-loop-core.mjs — 在 decideStop full 分支接入 validateFullCommandKinds
      红: AC-2/AC-5 decideStop 集成用例失败（仍返回 REACHED_GOAL）
      绿: 接入后 INCOMPLETE_FULL_VERIFY 路径生效

T4  [regression]  确认 AC-1 零回归——report-full-pass.json + full_required_kinds:[] → REACHED_GOAL 不变
      （T3 完成后即可验证；若此用例红，说明接入逻辑有误，必须在 T4 绿前修复）

T5  [docs]  verify.md — 更新 layer2_commands schema + kind 标注 + CRITICAL-8 段
      （文档改动，无代码测试；人工 review 验证格式正确）

T6  [fixture]  新增 report-full-pass-with-kinds.json
      绿: AC-3 用例依赖该 fixture，T6 后 AC-3 转绿

T7  [config]  spec-driver.config.yaml + goal-loop-override-template.yaml
      绿: AC-7 中 validateConfig 通过（已由 T1 保证，此步补文本配置）

T8  [skill]  spec-driver-feature/SKILL.md — branch e 加 INCOMPLETE_FULL_VERIFY（§3.6）
      绿: 散文 dispatch 覆盖新 exit_reason（人工 review）；随后 npm run repo:sync 同步 codex wrapper

T9  [full-run]  npx vitest run + npm run build + npm run repo:check，确认 141+ pass / 0 失败 / 同步零漂移
```

**总工时估算**：T1~T4 为核心（≈ 2h），T5~T8 为补全（≈ 1h）。

---

## 10. 不改动的边界（明确锁定）

- `parseReport` 函数签名——无变更（接缝选 decideStop 正是为保住此签名）
- `goal-loop-cli.mjs`——无变更（config 已在 decide-stop payload L230，`parse-report`/`decide-stop` 子命令签名不变）
- `spec-driver-feature/SKILL.md`——**3 处散文变更**（§3.6）：step1 读 full_required_kinds 进 config（C-1）+ branch e 出口 + branch c 二次路由（C-2）+ L314 一致性；**`parse-report`/`decide-stop` 调用点与 CLI 签名不变**（仍是 decideStop 接缝的红利，无新 CLI 接线）
- `parseReport` 函数签名——无变更（接缝选 decideStop 正是为保住此签名）
- `goal-loop-cli.mjs`——无变更（config 已在 decide-stop payload，子命令签名不变）
- 现有无-kind fixture（`report-full-pass.json` 等）——不迁移，零修改，默认 `[]` 保零回归
- `evaluateMetric` 函数——无变更（完整性校验在 decideStop 层，不渗入 metric 定义）
- `evaluateSmokeReadiness` 函数——无变更（scope 仅 full 权威门禁）

---

## 11. Codex 对抗审查处置记录（Phase 2 规划）

> 本轮 4 CRITICAL + 6 WARNING + 2 INFO，全部成立、全部已并入本 plan（及 tasks.md）。

| 档 | 发现 | 处置 |
|----|------|------|
| C-1 | `full_required_kinds` 未接入 SKILL payload 构造链（step1 只读 4 键），漏洞空转 | **采纳·最紧要**。§3.6 编辑 1：step1 读取该键进 config；文件清单 #8 升为 3 处。 |
| C-2 | escalate→forced-full 二次重 decide（branch c）未覆盖 INCOMPLETE_FULL_VERIFY，落点歧义 | **采纳**。§3.6 编辑 3：branch c 显式补一条→branch e、MUST NOT 再 escalate。 |
| C-3 | `cmd.kind`/requiredKinds 未类型守卫，`kind:123` 会让 decideStop 崩 | **采纳**。§2.3 加边界行 + §2.4 伪代码加 `typeof==='string'` 守卫，非字符串不贡献不抛异常。 |
| C-4 | T001 引用 T006 才建的 fixture，依赖图不可达 | **采纳**。fixture 创建提前到 T001（test infra）；见 tasks.md 重排。 |
| W-1 | plan 文件清单"evaluateMetric 之前调用"与正文"metric 满足才进入"矛盾 | **采纳**。§1 行 #1 改为"为真之后、REACHED_GOAL 之前"。 |
| W-2 | `BUILTIN_DEFAULTS` + `nestedKeys` 漏接新字段，--show-effective 不展示 | **采纳**。§4.1 补两处同步 + 数组值格式化实测。 |
| W-3 | config schema 用例放错文件（应在 config-schema.test.mjs） | **采纳**。见 tasks.md：schema 用例归 config-schema.test.mjs。 |
| W-4 | T001 静态 import 未导出函数会整文件链接失败（非逐用例红） | **采纳**。T001 先加 throwing 桩 export（F201 同款 TDD 约定），import 才能链接。 |
| W-5 | escalate 后 INCOMPLETE_FULL_VERIFY 在 SKILL 层覆盖仍是人工 review、不可测 | **接受（诚实标注）**。散文编排正确性依赖 LLM 解释，单测无法替代，与 F201 既有局限同源；由人工 GATE_VERIFY 兜底。 |
| W-6 | plan 称 8 文件但 `.codex/skills/...` 镜像也会被 repo:sync 改 | **采纳**。§1 注明镜像由 repo:sync 再生、须一并 commit；T010/T011 含 sync+check。 |
| I-1 | prevReports catch-all 已功能覆盖，L314 补枚举是可读性非行为 | **采纳为可读性**。§3.6 一致性补充，标注"不改行为"。 |
| I-2 | 除 SKILL.md 外无 exit_reason 穷举消费方（CLI 透传、日志 JSON.stringify） | **确认无忧**。无需额外改动。 |
