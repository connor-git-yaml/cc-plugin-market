---
feature: 199-fix-orchestration-schema-zod-degradation
mode: fix
phase: plan
status: draft
based_on: ./fix-report.md（推荐方案 A）
follow_up_of: ../198-fix-zod-graceful-degradation/plan.md
---

# 技术修复计划 — orchestration-schema zod 缺失优雅降级

> Feature 199 · fix 模式 · 基于 `fix-report.md` 推荐方案 A（复用 F198 共享 helper + 惰性 schema 守卫 + 两消费者降级分支）

## Summary

修复 `plugins/spec-driver/contracts/orchestration-schema.mjs` 的**顶层裸 `import { z } from 'zod'`**（L19），使 orchestration 链路在缺 `zod`（插件缓存目录无 `node_modules`）时不再于 ESM 模块加载期硬崩 `ERR_MODULE_NOT_FOUND`，而是**优雅降级**：复用 F198 已落地的共享 `scripts/lib/load-zod.mjs` helper，9 个顶层 schema 求值包进 `zodAvailable` 守卫（缺失时导出 `null`，模块加载不崩）；两个消费者（`orchestration-resolver.mjs` / `orchestrator.mjs`）在 zod 缺失时 best-effort 信任 plugin 自带 base、跳过项目级 overrides，push `orchestration.zod-unavailable` warning，返回结构化结果、退出码 0。

**核心不变量**：zod **在场**时所有行为逐字节不变（既有 orchestration 测试全绿）；只有 zod **缺失**时才进入新增的降级分支。

## 范围边界

### 纳入（3 个源文件 + 2 个新测试文件）

| 文件 | 类型 | 变更类型 |
|------|------|----------|
| `plugins/spec-driver/contracts/orchestration-schema.mjs` | 源文件 | 修改：顶层 import + 9 个 schema 守卫化 |
| `plugins/spec-driver/lib/orchestration-resolver.mjs` | 源文件 | 修改：import 增 zodAvailable + 步骤 2 前插入降级短路 |
| `plugins/spec-driver/lib/orchestrator.mjs` | 源文件 | 修改：import 增 zodAvailable + loadAndValidateConfig 内插守卫 |
| `tests/unit/spec-driver-orchestration-schema.test.ts` | 测试文件 | 新增：schema 守卫加载不抛 + zodAvailable 标志 + 在场/缺失双态 |
| `tests/integration/spec-driver-orchestration-zod-degradation.test.ts` | 测试文件 | 新增：缺 zod 子进程端到端 CLI 降级验证 |

### 不纳入（明确排除）

- `plugins/spec-driver/scripts/lib/load-zod.mjs`：F198 已落地，**不迁移、不改动**，直接复用
- `formatZodIssue` 函数：纯函数，不触碰 `z`，保持顶层 `export`，**不进守卫**（D4）
- `BASE_RESERVED_MODE_NAMES` 常量：纯数组，不依赖 zod，保持顶层 `export`，**不进守卫**（D4）
- `plugins/spec-driver/scripts/lib/project-profile-schema.mjs` / `config-schema.mjs`：F198 已修，无需再动
- `plugins/spec-driver/scripts/orchestrator-cli.mjs`：CLI 入口不改，降级诊断天然经现有 `cmdEffectiveOrchestration`（L290-294）呈现
- `contracts/` 其余文件：均为 `.yaml` / `.md`，无第三方裸 import，安全

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 3 个源文件 + 2 个新测试文件 |
| 间接受影响 | `scripts/orchestrator-cli.mjs`（调用两消费者，行为在 zod 在场时不变）；既有 orchestration `node:test` 测试套件（作为回归基线） |
| 跨包影响 | **无**（全部在 `plugins/spec-driver/contracts/` + `lib/`，未跨 `src/` / `panoramic/` / 其它 plugin） |
| 数据迁移 | 无（无 schema 字段变更、无配置格式变更、无状态文件格式变更） |
| API/契约变更 | `resolveOrchestrationConfig` 返回对象 shape **不变**（6 个字段完全一致）；缺 zod 时新增 `orchestration.zod-unavailable` diagnostic（向后兼容，仅多一条 warning）；`orchestrationBaseSchema` / `orchestrationOverridesSchema` 等导出在 zod 在场时逐字节不变，缺失时为 `null`（新增 `zodAvailable` 导出） |
| 测试盲区 | 既有 orchestration 测试全在有 `node_modules` 的仓库内跑，从未覆盖"缺 zod"路径 |
| **风险等级** | **LOW**（影响文件 < 10、无跨包、无数据迁移；但 orchestration 合约链复杂，回归面须谨慎，见回归风险评估） |

## 关键设计决策

### D1 — 复用 F198 `load-zod.mjs`，落点不迁移（保持 `scripts/lib/`）

**决策**：`contracts/orchestration-schema.mjs` 经相对路径 `../scripts/lib/load-zod.mjs` 引用 F198 共享 helper，**不**迁移 `load-zod.mjs` 到中性位置。

**依据**：`scripts/lib/simple-yaml.mjs` 已被运行时 `lib/orchestrator.mjs`（L11）与 `lib/orchestration-resolver.mjs`（L19）消费，证明 `scripts/lib/` 在本插件**已是事实上的共享工具家**，`lib/ → scripts/lib/` 是既有合法方向。`contracts/ → scripts/lib/` 与之同构，不是新引入的反向坏边。`load-zod.mjs` 零内部依赖（仅 `node:module`），不可能与 contracts 成环。迁移会扰动 F198 已发布的两个消费者（`config-schema.mjs` / `project-profile-schema.mjs`）的 import 路径 + 其测试，放大回归面——与"blast radius 谨慎"原则相悖。

**结论**：保持 `scripts/lib/load-zod.mjs` 不动，新增一个跨目录相对 import `../scripts/lib/load-zod.mjs`。

### D2 — 降级语义：best-effort 信任 base + 跳过 overrides（非退化为 generateFallbackConfig）

**决策**：缺 zod 时跳过 schema 校验，**best-effort 信任 plugin 自带 base orchestration.yaml**（受信任、随插件版本管控），**跳过项目级 overrides**（用户输入，无法校验时不信任），push 一条 `orchestration.zod-unavailable` warning，返回 `isFallback: true, isBaseInvalid: false`。

**依据**：
- "zod 缺失" ≠ "配置损坏"：base YAML 完好，仅无法校验。退化为 `generateFallbackConfig()`（最小桩，丢弃真实编排）是不必要的功能回退；best-effort 信任 base **保住真实编排**，仅放弃校验安全网。
- 与 F198 先例一致：F198 `validateConfig` 对同类场景正是"跳过校验、best-effort 接受原样配置 + degraded 标志 + zod-unavailable warning"，本 fix 沿用同一语义。
- base 受信任（随插件版本管控、有测试守护），overrides 是用户输入（无 zod 无法施加 `.strict()` / enum 校验），非对称处理合理。
- **防御**：`rawBase` 必须是纯对象（`Object.prototype.toString.call(rawBase) === '[object Object]'`）才信任，否则视为 base 损坏退 `generateFallbackConfig` + `isBaseInvalid: true`（沿用既有 base-invalid 语义，保证 CLI `generate-template` 的 `isBaseInvalid` 检查不被误拒）。

### D3 — 诊断对齐既有 orchestration-overrides diagnostics 模式

复用 resolver 既有 `createDiagnostic(level, code, message)` 函数（L41-45）；code 用 `orchestration.zod-unavailable`，level=`warning`。CLI `cmdEffectiveOrchestration`（L290-294）已有"非 info 诊断写 stderr" + `--format json` 输出 `diagnostics` 数组的逻辑，新诊断天然经此面向用户呈现，**无需改 CLI**。

### D4 — `formatZodIssue` / `BASE_RESERVED_MODE_NAMES` 保持顶层导出（不进守卫）

`formatZodIssue`（纯函数，不触碰 `z`）与 `BASE_RESERVED_MODE_NAMES`（纯常量数组）不依赖 zod，保持顶层 `export`。缺 zod 时这两个导出仍可用（`formatZodIssue` 因 safeParse 被短路而不会被调用，但导出本身不崩）。**仅 9 个 `z.*` schema 求值进 `zodAvailable` 守卫**。

## 文件级变更清单

### 修改：`plugins/spec-driver/contracts/orchestration-schema.mjs`

**改什么**：
1. 删除 L19 顶层 `import { z } from 'zod'`，改为 `import { loadZod } from '../scripts/lib/load-zod.mjs'`。
2. 模块体内调用 `const { z, available: zodAvailable } = loadZod()`。
3. 全部 9 个顶层 schema 求值改为 `let + if(zodAvailable){...赋值} + 末尾统一 export` 模式；新增 `export { zodAvailable }`。
4. `formatZodIssue` 函数与 `BASE_RESERVED_MODE_NAMES` 常量保持顶层 `export`（不进守卫）。

**为什么**：消灭根因——缺 zod 时模块体完全不触碰 `z`，模块加载不崩。保持导出名不变使消费者 import 语句零改动。

**精确改造骨架**（赋值顺序须遵循依赖关系）：

```text
// ── 顶部：删除 import { z } from 'zod'，改为：
import { loadZod } from '../scripts/lib/load-zod.mjs';
const { z, available: zodAvailable } = loadZod();

// ── 保留不变（顶层，不进守卫）：
export function formatZodIssue(issue) { ... }
export const BASE_RESERVED_MODE_NAMES = [...];

// ── 全部 schema 改为 let 声明（初始 null，缺 zod 时即为 null）：
let phaseSchema = null;
let gateDefinitionSchema = null;
let gateOverrideSchema = null;
let modeDefinitionSchema = null;    // 依赖 phaseSchema
let modeOverrideSchema = null;      // 依赖 phaseSchema
let parallelGroupSchema = null;
let parallelSchedulingSchema = null;
let orchestrationBaseSchema = null; // 依赖 parallelSchedulingSchema/gateDefinitionSchema/parallelGroupSchema/modeDefinitionSchema
let orchestrationOverridesSchema = null; // 依赖 modeOverrideSchema/gateOverrideSchema
let orchestrationMergedSchema = null;    // = orchestrationBaseSchema（别名）

if (zodAvailable) {
  // 1. 无依赖的叶子 schema 先赋值：
  phaseSchema = z.object({ ... });
  gateDefinitionSchema = z.object({ ... });
  gateOverrideSchema = z.object({ ... }).strict();
  parallelGroupSchema = z.object({ ... });
  parallelSchedulingSchema = z.object({ ... });

  // 2. 依赖 phaseSchema 的 schema：
  modeDefinitionSchema = z.object({
    ...
    phases: z.array(phaseSchema).min(1, ...),
  });
  modeOverrideSchema = z.object({
    ...
    phases: z.array(phaseSchema).min(0),
  }).strip();

  // 3. 依赖多个子 schema 的顶层 schema：
  orchestrationBaseSchema = z.object({
    version: z.string({ ... }),
    parallel_scheduling: parallelSchedulingSchema,
    gates: z.record(z.string(), gateDefinitionSchema),
    parallel_groups: z.record(z.string(), parallelGroupSchema),
    modes: z.record(z.string(), modeDefinitionSchema),
  });

  orchestrationOverridesSchema = z.object({
    $schema_version: z.string().optional(),
    version: z.string({ ... }),
    modes: z.object({
      feature: modeOverrideSchema.optional(),
      ...（8 个 mode）
    }).strict({ ... }).optional(),
    gates: z.record(z.string(), gateOverrideSchema).optional(),
    parallel_scheduling: z.object({ ... }).optional(),
    parallel_groups: z.record(z.string(), z.unknown()).optional(),
  }).strict({ ... });

  // 4. 别名（orchestrationMergedSchema === orchestrationBaseSchema）：
  orchestrationMergedSchema = orchestrationBaseSchema;
}

// ── 末尾统一 export（ESM export const 不能进 if 块，故用末尾 export 语句）：
export {
  zodAvailable,
  phaseSchema,
  gateDefinitionSchema,
  gateOverrideSchema,
  modeDefinitionSchema,
  modeOverrideSchema,
  parallelGroupSchema,
  parallelSchedulingSchema,
  orchestrationBaseSchema,
  orchestrationOverridesSchema,
  orchestrationMergedSchema,
};
```

**实现注意**：
- `export const` 不能放进 `if` 块（ESM 语法限制），**必须**用 `let + 末尾 export` 模式，否则语法错误。
- 守卫必须覆盖**全部** `z.*` 求值（含链式 `.refine` / `.extend` / `.strict()` / `.strip()`），遗漏任一均会在缺 zod 时抛 `ReferenceError`——等于没修。
- `orchestrationMergedSchema` 当前实现为 `export const orchestrationMergedSchema = orchestrationBaseSchema`（L301 直接引用），守卫内赋值时同样写 `orchestrationMergedSchema = orchestrationBaseSchema` 即可，无需重建 schema。
- 赋值顺序严格遵循依赖关系：叶子 schema → 依赖叶子的中层 schema → 依赖中层的顶层 schema → 别名。顺序错误（如 `modeDefinitionSchema` 引用未赋值的 `phaseSchema`）会在缺 zod 时残留 null 引用。

---

### 修改：`plugins/spec-driver/lib/orchestration-resolver.mjs`

**改什么**：
1. L21-26 import 增加 `zodAvailable`：`import { orchestrationBaseSchema, orchestrationOverridesSchema, orchestrationMergedSchema, formatZodIssue, zodAvailable } from '../contracts/orchestration-schema.mjs'`。
2. 在**步骤 1 结束（L209，rawBase 加载成功之后）、步骤 2（L212，`orchestrationBaseSchema.safeParse(rawBase)`）之前**插入 `if (!zodAvailable)` 短路分支。

**为什么**：步骤 1 仅读取并解析 YAML（不依赖 zod），可以完成；步骤 2-9 全部依赖 schema safeParse，缺 zod 时均无法执行。短路在此点可最大化复用已完成的 YAML 加载，同时 best-effort 信任 rawBase。

**降级分支精确规范**（插入位置：L209 之后，L211 注释行之前）：

```text
// ── zod 缺失短路（插入位置：步骤 1 成功之后、步骤 2 safeParse 之前）───
if (!zodAvailable) {
  // 纯对象检查（复用既有 isPlainObject 守卫模式）
  const isBaseRawPlainObject =
    rawBase !== null &&
    rawBase !== undefined &&
    Object.prototype.toString.call(rawBase) === '[object Object]';

  if (!isBaseRawPlainObject) {
    // base 解析结果不是纯对象 → 视为 base 损坏，退 generateFallbackConfig
    diagnostics.push(createDiagnostic(
      'error',
      'orchestration.base-invalid',
      '[orchestration] base 配置不是合法对象（zod 缺失 + base 非纯对象）',
    ));
    const fallbackConfig = generateFallbackConfig();
    return {
      mergedConfig: fallbackConfig,
      baseConfig: fallbackConfig,
      fieldSources: {},
      diagnostics,
      isFallback: true,
      isBaseInvalid: true,
    };
  }

  // base 是纯对象 → best-effort 信任，跳过 overrides（无法校验用户输入）
  diagnostics.push(createDiagnostic(
    'warning',
    'orchestration.zod-unavailable',
    '[orchestration] 未能加载 zod，已跳过 orchestration schema 校验并 best-effort 信任 base 配置；' +
    '项目级 orchestration-overrides 在缺 zod 时不被应用。' +
    '如需完整校验请在已安装依赖的目录运行（npm i）或从仓内源路径运行 spec-driver 脚本',
  ));
  const baseFieldSources = buildBaseOnlyFieldSources(rawBase);
  return {
    mergedConfig: rawBase,
    baseConfig: rawBase,
    fieldSources: baseFieldSources,
    diagnostics,
    isFallback: true,
    isBaseInvalid: false,
  };
}
// ── zod 缺失短路结束 ────────────────────────────────────────────
```

**实现注意**：
- 返回对象严格保持 6 个字段（`mergedConfig / baseConfig / fieldSources / diagnostics / isFallback / isBaseInvalid`），与正常路径返回 shape 完全一致。
- 使用 `rawBase`（未经 safeParse 的原始 YAML 对象）而非 `baseConfig`（safeParse.data，此时尚未赋值）。
- `buildBaseOnlyFieldSources(rawBase)` 在 rawBase 是纯对象时安全调用（L471 遍历 modes/gates/parallel_scheduling，rawBase 缺字段时内层 `Object.keys(...)` 返回空，不会抛错）。
- 三处现有 safeParse（L212 base、L379 overrides、L422 merged）因短路而全部跳过，不需要在各处单独加守卫。

---

### 修改：`plugins/spec-driver/lib/orchestrator.mjs`

**改什么**：
1. L13 import 增加 `zodAvailable`：`import { orchestrationBaseSchema, formatZodIssue, zodAvailable } from '../contracts/orchestration-schema.mjs'`。
2. 在 `loadAndValidateConfig()` 方法内，**YAML 解析成功之后（L59，`const parsed = parseYamlDocument(content)` 之后）、L62（`orchestrationBaseSchema.safeParse(parsed)`）之前**插入 `if (!zodAvailable)` 守卫。

**为什么**：L50-77 的外层 try/catch 在 zod 缺失时会捕获 `null.safeParse(...)` 抛出的 `TypeError: Cannot read properties of null`，并退化为 `generateFallbackConfig()`——丢弃真实配置，且 error message 误导性强。显式守卫在 safeParse 前介入，给出语义明确的 warning 并 best-effort 信任已解析的 YAML。

**降级守卫精确规范**（插入位置：L59 之后，L61 注释行 `// 使用 orchestrationBaseSchema.safeParse...` 之前）：

```text
// ── zod 缺失守卫（插入位置：YAML 解析成功之后、safeParse 之前）───────
if (!zodAvailable) {
  const isParsedPlainObject =
    parsed !== null &&
    parsed !== undefined &&
    Object.prototype.toString.call(parsed) === '[object Object]';

  if (isParsedPlainObject) {
    // parsed 是纯对象 → best-effort 信任已解析的 YAML
    this.logger.warn(
      '[ORCHESTRATOR] zod 未加载，已跳过 orchestration schema 校验并 best-effort 信任已解析配置',
    );
    this.config = parsed;
    this.isFallback = false;    // 真实配置，非最小桩
  } else {
    // parsed 不是纯对象（YAML 解析为 null/数组/标量等）→ 退 generateFallbackConfig
    this.logger.warn(
      '[ORCHESTRATOR] zod 未加载且 YAML 解析结果非纯对象，使用 fallback 配置',
    );
    this.config = generateFallbackConfig();
    this.isFallback = true;
  }
  return;   // 跳过 safeParse，退出 loadAndValidateConfig
}
// ── zod 缺失守卫结束 ──────────────────────────────────────────────────
```

**实现注意**：
- 守卫插入在 try 块内部（L50 try 开始，L73 catch），不破坏现有异常捕获结构。
- `this.isFallback = false`（纯对象信任路径）是明确语义：真实编排配置，非最小桩。与 resolver 降级的 `isFallback: true` 不同，这里有意区分——orchestrator 的 `isFallback` 语义是"是否用了最小桩"，best-effort 信任真实 YAML 不应被标记为 fallback（与 F198 `degraded: true` 概念类比但使用现有字段语义）。
- 外层 try/catch 的 error 路径（L73-77）仍然有效：文件 IO 错误、YAML 语法错误等会在 L50-59 先抛出并被 catch 兜住，不会到达 `if (!zodAvailable)` 守卫。

## 回归风险评估

### 必须逐字节不变（zod 在场时；既有测试必须全绿）

| 路径 | 不变量 |
|------|--------|
| `orchestration-schema.mjs` 9 个 schema 导出 | zod 在场时 `phaseSchema` / `gateDefinitionSchema` / ... / `orchestrationMergedSchema` 仍是等价的真实 zod schema（同 `.strict()` / `.strip()` / enum 约束）；新增 `zodAvailable === true` 导出 |
| `orchestration-resolver.mjs` 三处 safeParse | zod 在场时步骤 2/7/9 safeParse 逻辑**逐字节不变**；diagnostics 序列、fieldSources、返回 shape 完全一致 |
| `orchestrator.mjs` loadAndValidateConfig | zod 在场时 L62 safeParse 分支**逐字节不变**；`isFallback` / `config` 赋值与现状完全一致 |
| `resolveOrchestrationConfig` 返回 shape | zod 在场时**不**新增 `orchestration.zod-unavailable` 诊断；6 个字段与现状完全一致 |
| CLI `effective-orchestration` / `generate-template` 输出 | zod 在场时 stdout 结构、退出码、diagnostics 序列逐字节不变 |
| 既有 orchestration `node:test` 套件（68+ 测试） | 全绿，无任何 regression |

### 新增分支（仅 zod 缺失时触发）

- `orchestration-schema.mjs`：模块加载不崩，9 个 schema 导出为 `null`，`zodAvailable === false`。
- `orchestration-resolver.mjs`：步骤 1 之后立即短路，返回 `rawBase` 作为 mergedConfig + baseConfig，`isFallback: true, isBaseInvalid: false`，含 `orchestration.zod-unavailable` warning。
- `orchestrator.mjs`：`loadAndValidateConfig` 内守卫介入，纯对象 YAML 路径 `isFallback: false`（信任真实配置），非纯对象路径 `generateFallbackConfig() + isFallback: true`。

### 最大回归风险点（按优先级排序）

1. **【最高】orchestration-schema.mjs 守卫未覆盖全部 `z.*` 求值 → ReferenceError**：若任一 schema 求值（含链式 `.refine` / `.extend` / `.strict()` / `.strip()`）泄漏到 `if (zodAvailable)` 块外，缺 zod 时从"MODULE_NOT_FOUND"变成"ReferenceError"，问题未真正修复。**缓解**：守卫内必须覆盖全部 10 个 `z.*` 引用点（phaseSchema 内 `z.union` / `z.enum` 含 `error_map`，gateDefinitionSchema 内两个 `z.enum`，gateOverrideSchema 末尾 `.strict()`，modeOverrideSchema 末尾 `.strip()`，orchestrationBaseSchema 内 `z.record` × 3，orchestrationOverridesSchema 内 `z.object` / `z.record` / `z.unknown`）；新增子进程冒烟测试覆盖此点。

2. **【高】`export const` 进 `if` 块导致语法错误**：ESM 不允许 export 声明在 if 块内，若错误地写 `if (zodAvailable) { export const phaseSchema = ... }` 整个模块加载失败。**缓解**：`npm run build` 类型/语法检查 + `let + 末尾 export` 模式已在 F198 `project-profile-schema.mjs` 验证可行。

3. **【中】resolver 降级路径跳过 overrides 的语义影响**：有 `orchestration-overrides.yaml` 的项目在缺 zod 时无法应用 overrides，可能导致 mode 编排差异（override 中的自定义 phase 丢失）。这是 D2 明确认可的**可接受妥协**（无法校验用户输入，保守跳过），诊断 message 已说明原因。**缓解**：warning 诊断明确告知用户 overrides 未被应用。

4. **【中】两消费者降级行为一致性**：resolver 降级返回 `isFallback: true`，orchestrator 降级返回 `isFallback: false`（信任 YAML 时）。两者语义有差异，但各自内部一致——resolver 的 `isFallback` 表示"是否用了非完整合并结果"，orchestrator 的 `isFallback` 表示"是否用了最小桩"。**缓解**：在测试用例中明确断言各自的 `isFallback` 值，避免歧义。

5. **【低】`buildBaseOnlyFieldSources(rawBase)` 对 rawBase 字段缺失时的健壮性**：缺 zod 时 rawBase 未经 schema 校验，`modes` / `gates` / `parallel_scheduling` 字段可能缺失或类型非法，`Object.keys(undefined)` 会抛 TypeError。**缓解**：`buildBaseOnlyFieldSources` 内已有 `|| {}` 防御（L473/L476/L481），无需额外改动。

## 验证方案

### 新增/扩展测试

| 文件 | 类型 | 用例 |
|------|------|------|
| `tests/unit/spec-driver-orchestration-schema.test.ts`（新增） | 单元（vitest） | (1) zod 在场：`import orchestration-schema.mjs`，所有 9 个 schema 导出非 null，`zodAvailable === true`，`formatZodIssue` / `BASE_RESERVED_MODE_NAMES` 可用；(2) 强制缺 zod（`SPEC_DRIVER_FORCE_ZOD_MISSING=1` + `vi.resetModules()` + `__resetZodCacheForTest()` + 动态 `import()`）：所有 9 个 schema 导出为 `null`，`zodAvailable === false`，模块加载不抛任何错；(3) `formatZodIssue` / `BASE_RESERVED_MODE_NAMES` 在缺 zod 时仍可用（不随 schema 进守卫，顶层可访问）。注意：测试文件顶层不静态 import 被测 schema，全部用 `beforeEach/afterEach` + 动态 `import()` 防止 memoize 污染。 |
| `tests/integration/spec-driver-orchestration-zod-degradation.test.ts`（新增） | 集成（子进程，vitest） | 缺 zod 路径（`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 注入子进程 env）：(a) `execFileSync('node', ['plugins/spec-driver/scripts/orchestrator-cli.mjs', 'effective-orchestration', 'fix', '--format', 'json'], { env: { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' } })` 不抛、退出码 0；(b) stdout 是有效 JSON；(c) `diagnostics` 含 `orchestration.zod-unavailable`（level=warning，仅一条）；(d) `modes.fix` 在返回结果中存在（真实 base 编排被保留，非最小桩）；(e) `isFallback: true`，`isBaseInvalid: false`。复用现有 orchestration 测试的子进程调用模式（参照既有 `node:test` 套件风格）。 |

**测试 seam 关键点**：schema 模块的 `zodAvailable` 在模块首次加载时固化（`loadZod()` 在模块体内立即调用）。因此：
- **子进程路径**（集成测试）：最可靠，环境变量完全隔离，`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 注入新进程确保 `loadZod()` 走缺失分支。
- **同进程路径**（单元测试）：需 `beforeEach` 设好 `process.env.SPEC_DRIVER_FORCE_ZOD_MISSING`，调用 `__resetZodCacheForTest()`，再 `vi.resetModules()` 清 ESM 模块缓存，最后在测试内动态 `import()`；`afterEach` 清环境变量 + 再次 reset，防止污染后续用例。

### 验证命令

```bash
# 1. 单元 + 集成测试（聚焦本 fix 相关文件）
npx vitest run tests/unit/spec-driver-orchestration-schema.test.ts \
               tests/integration/spec-driver-orchestration-zod-degradation.test.ts

# 2. 全量回归（确认零失败 — 既有测试在 zod 在场时必须全绿）
npx vitest run

# 3. orchestration 原有 node:test 套件回归（不在 vitest 收集范围，手动跑）
node --test plugins/spec-driver/tests/orchestration*.test.mjs 2>&1 | tail -20

# 4. 类型/语法检查（确认 let+末尾 export 改造无语法错误）
npm run build

# 5. 仓库同步校验（触及 plugins/spec-driver/contracts/ + lib/ 后）
npm run repo:check

# 6. 手工冒烟：模拟缺 zod 跑 CLI，确认不崩 + 退出码 0
SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  effective-orchestration fix --format json ; echo "exit=$?"

SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  effective-orchestration feature --format json ; echo "exit=$?"

SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  generate-template fix ; echo "exit=$?"
```

### 验收标准（Acceptance Criteria）

- **AC-1**：`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 下 `orchestrator-cli.mjs effective-orchestration fix --format json` 输出有效 JSON、退出码 0、`diagnostics` 含 `orchestration.zod-unavailable` warning（仅一条）、`modes.fix` 存在。
- **AC-2**：同条件下 `generate-template fix` 退出码 0（`isBaseInvalid: false` 保证 CLI 不误拒）。
- **AC-3**：zod 在场时既有全量 vitest 测试零失败（行为逐字节不变）。
- **AC-4**：`node --test` 跑 orchestration 原有套件零失败（回归基线）。
- **AC-5**：`npm run build` + `npm run repo:check` 零错误。
- **AC-6**：`orchestration-schema.mjs` 在缺 zod 时仅导出 `null` + `zodAvailable: false`，**不抛任何错**（无 `MODULE_NOT_FOUND`、无 `ReferenceError`）。
- **AC-7**：zod 在场时 `orchestration-schema.mjs` 所有 9 个 schema 导出与当前实现逐字节等价（守卫内 schema 定义一字不差地从顶层移入，不简化任何 `.refine` / `error_map` / `.strict()` 约束）。

## Codex 对抗审查结论

- **设计阶段审查（implement 前）**：codex-rescue 触发已知 stall（未返回结论）。主编排器在主线程亲自自验了该审查本应覆盖的全部风险点（降级语义一致性、load-zod 落点无环、resolver 短路与 _loadOverrides 注入无冲突、isFallback/isBaseInvalid 消费者影响、build\* 缺字段防御、schema 无 default/transform 故 rawBase ≡ safeParse.data），结论均为稳健，详见对话记录。
- **提交前审查（implement 后，对实际 diff）**：**0 CRITICAL / 0 WARNING / 1 INFO**。Codex 独立复核并背书 6 点：守卫完整性、AC-7 逐字节等价、resolver 降级分支、orchestrator 三个 build\* 方法均有 `|| {}` 防御、测试隔离有效、无隐藏回归；并用只读 `node` 实测缺 zod 时 schema import 不抛、全 schema 为 null。
  - **I-1（INFO，已决定不修）**：`validate-config` CLI 对缺 zod 降级输出"使用后备配置"文案语义偏混（实为 best-effort 信任 base，非 generateFallbackConfig 最小桩）。**不修理由**：(1) 该文案与 validate-config 对所有其它 fallback 原因（version-mismatch / schema-fallback）的输出**一致**，是既有 CLI 行为模式，非本 fix 新引入；(2) 修它需改 `orchestrator-cli.mjs`，超出 plan 刻意限定的 3 源文件范围，与"blast radius 谨慎"相悖；(3) 非阻断（不影响退出码、不误拒 generate-template，effective-orchestration 主命令已正确呈现 zod-unavailable 诊断）。

## 收尾（implement 阶段后）

- 修复落地后更新 Claude memory `project_spec_driver_plugin_cache_zod_missing`：标注 orchestration 链路亦已降级，`缓存缺 node_modules 时 orchestration 子命令（effective-orchestration / generate-template / validate-config）不再硬崩，降级为 best-effort 信任 base + zod-unavailable warning`。
- 本 fix 不新增/不改动 spec（纯增量健壮性，zod 在场契约不变）。
- F198 plan L252 预告的 follow-up 上报在本 fix 落地后可关闭。
