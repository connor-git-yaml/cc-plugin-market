---
feature: 198-fix-zod-graceful-degradation
mode: fix
phase: plan
status: draft
based_on: ./fix-report.md（推荐方案 A）
---

# 技术修复计划 — spec-driver 脚本 zod 缺失优雅降级

> Feature 198 · fix 模式 · 基于 `fix-report.md` 推荐方案 A（共享同步 zod 加载 helper + 惰性 schema + 降级诊断）

## Summary

修复 `plugins/spec-driver/scripts/lib/` 下两个 schema 模块（`project-profile-schema.mjs`、`config-schema.mjs`）的**顶层裸 `import { z } from 'zod'`**，使其在缺 `zod`（如插件缓存目录无 `node_modules`）时不再于 ESM 模块加载期硬崩 `ERR_MODULE_NOT_FOUND`，而是**优雅降级**：新增共享同步加载 helper `load-zod.mjs`，schema 模块经 helper 惰性构建（zod 在 → 真实 schema；zod 缺 → 导出 `null` + 标志位），两个调用方（resolver、validateConfig）在 zod 缺失时跳过 schema 校验、走手写校验/信任手写 normalize，并 push 一条 `warning` 级降级诊断；两个 CLI 入口在降级路径仍输出结构化结果、退出码 0。

**核心不变量**：zod **在场**时所有行为逐字节不变（既有测试必须全绿）；只有 zod **缺失**时才进入新增的降级分支。

## 范围边界

- **纳入**：`project-profile-schema.mjs`、`project-profile-resolver.mjs`、`config-schema.mjs`、`validate-config.mjs`、新增 `load-zod.mjs` + 3 个测试文件。
- **不纳入**（fix-report 已论证）：`plugins/spec-driver/contracts/orchestration-schema.mjs` 的同源裸 import。理由：(1) 用户显式限定范围在 `scripts/lib/` 同目录；(2) orchestration schema 是编排校验核心（非安全网），降级 blast radius 更大、与 orchestration 合约链耦合更深；(3) 共享 helper 落点在 `scripts/lib/`，被 `contracts/` 反向 import 不合理。→ 作为同类 follow-up 上报，届时复用本 fix 的 `load-zod.mjs` 思路。
- **不改动**：`resolveEffectiveConfig`（纯 JS 不依赖 zod）、`normalizeReferenceEntry` 中 string 形态 reference 分支（不经 `safeParse`）、所有不依赖 z 的常量导出（`EXCLUDED_EXECUTION_FIELDS` / `ALLOWED_TOP_LEVEL_FIELDS` / `BUILTIN_DEFAULTS` / `PRESET_DEFAULTS` / `COMMON_CONFIG_FILES` / `suggestField` / `levenshtein`）。

## Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件 | 4（2 schema 模块 + 2 调用方/CLI 间接）+ 1 新增 helper |
| 间接受影响 | resolve-project-context.mjs、validate-config.mjs（均为 CLI 入口，行为在 zod 在场时不变） |
| 跨包影响 | 无（全部在 `plugins/spec-driver/scripts/`，未跨 `src/` / `panoramic/` / 其它 plugin） |
| 数据迁移 | 无（无 schema 字段变更、无配置格式变更、无状态文件格式变更） |
| API/契约变更 | resolver 返回对象 shape 不变；`validateConfig` 返回值**新增可选 `degraded` 字段**（向后兼容，既有消费端解构 `{ success, diagnostics }` 不受影响，见下文逐字段分析） |
| 测试盲区 | 既有测试全在有 `node_modules` 的仓库内跑，从未覆盖"缺 zod"路径 |
| **风险等级** | **LOW**（影响文件 < 10、无跨包、无数据迁移；但因 schema/resolver 链路多层合约依赖，验证面需谨慎，见回归风险评估） |

## 关键设计决策

### D1 — `load-zod.mjs` 用同步 `createRequire` + `require('zod')`（非 `await import`）

zod 自带 CJS 入口，可被 `require` 同步加载。采用 `createRequire(import.meta.url)` 保持现有**全同步调用链**（`resolveProjectContext` / `validateConfig` / 两个 CLI 均同步），避免方案 B 的 async 涟漪（动态 `import` 会把整条链染成 async）。缺失时 `require` 抛**可被 try/catch 捕获**的 `MODULE_NOT_FOUND`（区别于顶层静态 import 的加载期硬崩）。

### D2 — schema 模块采用"加载期 loadZod，available 则构建真实 schema 否则导出 null + 标志位"（非惰性工厂函数）

**选定方案**：模块加载时调用 `loadZod()`，若 `available` 则构建并导出真实 schema（变量名保持 `referenceEntrySchema` / `resolvedProjectProfileSchema` / `specDriverConfigSchema` 不变），否则导出 `null`，并**新增导出 `zodAvailable`（boolean）**。

**取舍**：
- vs 惰性工厂（`getProjectProfileSchemas()` 返回对象或 null）：工厂方案需改动所有 import 点的取用方式（resolver 从"直接 import schema 名"改成"调函数解构"），改动面更大、且每次调用重建 schema 有微小开销。选定方案**保持现有 import 语句和变量名不变**（调用方 `import { referenceEntrySchema, resolvedProjectProfileSchema }` 一行不改），只是这些值在 zod 缺失时为 `null`，调用方据 `zodAvailable` 分支即可。改动最小、对齐"既有正常路径零变化"原则。
- **关键安全性**：现有顶层 `z.object(...)` 是模块加载期立即求值的。改造后必须把这些求值**包进 `if (zodAvailable) { ... }` 或一个只在 available 时执行的构建块**，确保 zod 缺失时模块体内**完全不触碰 `z`**，否则仍会 `ReferenceError`。

### D3 — 诊断沿用既有 `{ level, code, message }` 结构与 `project-context.*` / `config.*` 命名空间

resolver 已有本地 `createDiagnostic(level, code, message)`（L11），config 路径直接 push 字面对象。新增诊断复用同结构，code 用 `project-context.zod-unavailable` / `config.zod-unavailable`，level=`warning`，对齐 orchestration-overrides diagnostics 模式（memory `feedback_codex_review_design_phase` 链路一致）。

### D4 — `validateConfig` 降级返回新增 `degraded: true`，best-effort `data` 取原样 `parsedYaml`

zod 缺失时无法做 schema 校验，按"跳过校验、best-effort 接受"语义返回 `{ success: true, data: parsedYaml ?? {}, degraded: true, diagnostics: [config.zod-unavailable warning] }`。`success: true` 保证 `validate-config.mjs` 不误判为校验失败退出非 0（其退出码逻辑只看 `diagnostics` 里的 `error` 级，见 D5）。`data` 取原样 `parsedYaml` 而非 `{}`，使 `--show-effective` 仍能读到用户配置（但 `--show-effective` 走 `resolveEffectiveConfig` 不经 `validateConfig`，故此处主要是语义正确性）。

### D5 — `validate-config.mjs` 退出码逻辑天然兼容降级

实测 `runValidate`（L132-159）解构 `const { success, diagnostics } = validateConfig(parsed)`，**未使用 `success` 做退出判断**，而是按 `diagnostics.filter(level==='error')` 决定 exit 1、`level==='warning'` 决定 exit 0+warn、否则 exit 0+pass。降级返回的 diagnostics 只含 1 条 `warning`，故天然走"exit 0 + warn"路径，**无需改动 `validate-config.mjs`**。新增的 `degraded` 字段被解构忽略，零影响。（此点为最关键的兼容性确认。）

## 文件级变更清单

### 新增：`plugins/spec-driver/scripts/lib/load-zod.mjs`

**改什么**：新建共享同步 zod 加载 helper。
**为什么**：DRY 单一加载点；把"加载期硬崩"收敛为"可捕获的运行时缺失"。

精确 API：
```text
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let _cache = null;  // memoize: { z, available, error }

export function loadZod() {
  if (_cache) return _cache;
  // 测试 seam：强制缺失分支
  if (process.env.SPEC_DRIVER_FORCE_ZOD_MISSING === '1'
      || process.env.SPEC_DRIVER_FORCE_ZOD_MISSING === 'true') {
    _cache = { z: null, available: false,
               error: new Error('zod 加载被 SPEC_DRIVER_FORCE_ZOD_MISSING 强制禁用') };
    return _cache;
  }
  try {
    const mod = require('zod');
    const z = mod.z ?? mod;   // 实测 require('zod') 模块上 .z 是命名空间；缺则退回 mod 本体
    _cache = { z, available: true, error: null };
  } catch (error) {
    _cache = { z: null, available: false, error };
  }
  return _cache;
}

export function __resetZodCacheForTest() {  // 仅测试用：清 memoize
  _cache = null;
}
```

约束：
- **memoize**：首次调用后缓存，后续直接返回（含强制缺失分支）。
- **测试 seam**：`SPEC_DRIVER_FORCE_ZOD_MISSING ∈ {'1','true'}` 强制走缺失分支；`__resetZodCacheForTest()` 清缓存（让同进程内多用例切换 zod 在场/缺失成为可能；但因 schema 模块在加载期固化 `zodAvailable`，跨态切换主要靠子进程传环境变量，见验证方案）。
- **不抛**：`loadZod()` 永不抛，缺失时返回 `{ z: null, available: false, error }`。

### 修改：`plugins/spec-driver/scripts/lib/project-profile-schema.mjs`

**改什么**：
1. 删除 L1 顶层 `import { z } from 'zod'`，改 `import { loadZod } from './load-zod.mjs'`。
2. 模块体内 `const { z, available: zodAvailable } = loadZod();`，新增 `export const zodAvailable;`（导出标志位）。
3. 把现有所有 `z.object(...)` schema 构建（L22-78：`referenceEntryObjectSchema` / `referenceEntrySchema` / `resolvedReferenceEntrySchema` / `resolvedProjectProfileSchema`）**包进 `zodAvailable` 守卫**：available 时构建真实 schema 并 export，否则 `export const referenceEntrySchema = null;` 等（导出名不变，值为 null）。
4. 常量导出 `EXCLUDED_EXECUTION_FIELDS` / `ALLOWED_TOP_LEVEL_FIELDS` **原样保留**（不依赖 z）。

**为什么**：消灭"加载期硬崩"的根因（顶层裸 import）；保持导出名不变使 resolver 的 import 语句零改动。

**实现注意**：`export const` 不能放进 `if` 块（ESM 语法限制）。需用模式：先 `let referenceEntrySchema = null; let resolvedProjectProfileSchema = null;`（以及内部用的 object/resolved 子 schema），在 `if (zodAvailable) { ... 赋值 ... }` 中赋值，再 `export { referenceEntrySchema, resolvedProjectProfileSchema, zodAvailable };` 或对每个用 `export` 重新导出。子 schema（`referenceEntryObjectSchema` / `resolvedReferenceEntrySchema`）若仅内部使用可不导出，但当前是 `export const`——**需确认是否有其它 import 方**（grep 确认；若无外部 import，可降级为模块内 `let`，但为稳妥保持导出契约，统一用 `let + 末尾 export`）。

### 修改：`plugins/spec-driver/scripts/lib/project-profile-resolver.mjs`

**改什么**：
1. import 增加 `zodAvailable`：`import { ..., referenceEntrySchema, resolvedProjectProfileSchema, zodAvailable } from './project-profile-schema.mjs'`。
2. **L72 降级分支**（`normalizeReferenceEntry` 中 object 形态 reference）：
   - zod 在场（`zodAvailable === true`）：保持现有 `referenceEntrySchema.safeParse(entry)` 逻辑**逐字节不变**。
   - zod 缺失：手写校验替代——`entry` 是对象（已由 L65 保证）且 `Boolean(entry.path || entry.url)`；不满足则 push 现有 `project-context.invalid-reference` warning 并 return null；满足则构造 `normalized = { ...entry, source }`（仅取已知字段或原样浅拷贝），走后续 path 解析（L84-94 逻辑复用）。
   - **注意**：string 形态 reference（L40-63）不经 `safeParse`，无需改。
3. **L613 降级分支**（`resolvedProjectProfileSchema.safeParse(normalized)`）：
   - zod 在场：保持现有 safeParse + schema-fallback 逻辑不变。
   - zod 缺失：**跳过** safeParse（`normalized` 由手写 `normalizeYamlInput` / `normalizeLegacyMarkdown` 构建，结构可信），直接用 `normalized`（即等价于现有 `parsedProfile.success === true` 分支的 `normalized = parsedProfile.data` 效果，但不经 schema parse）。**不进入** L624 的 `resolvedProjectProfileSchema.parse({...})` 兜底（该兜底也依赖 z）。
4. **降级诊断**：当 `zodAvailable === false` 时（建议在 `resolveProjectContext` 入口处或首次需要 schema 前），push **一条** `createDiagnostic('warning', 'project-context.zod-unavailable', '<可读信息>')`。可读信息建议：`'未能加载 zod，已跳过 project-context schema 校验并使用手写归一化结果；如需完整校验请在已安装依赖的目录运行（npm i）或从仓内源路径运行 spec-driver 脚本'`。**只 push 一次**（避免 reference 多条目时重复）——建议在入口判断一次。

**为什么**：在 zod 缺失时绕开两处 `.safeParse`/`.parse`，保证 resolver 不崩且返回对象 shape 与正常路径一致。

**Shape 一致性保证**：降级后 `normalized` 仍是与正常路径相同结构的对象（手写 normalize 已产出全字段），故 L653 起的 `existingReferences` / `referenceSummary` / `onlineResearch` / 最终 return 的 `schemaVersion:1` 等字段**全部不变**，CLI 输出仍是有效 JSON、退出码 0。

### 修改：`plugins/spec-driver/scripts/lib/config-schema.mjs`

**改什么**：
1. 删除 L14 顶层 `import { z } from 'zod'`，改 `import { loadZod } from './load-zod.mjs'`。
2. 模块体 `const { z, available: zodAvailable } = loadZod();`，新增 `export const zodAvailable`。
3. 把所有子 schema（L20-108：`modelNameSchema` … `specDriverConfigSchema`）**包进 `zodAvailable` 守卫**（同 D2 的 `let + 末尾 export` 模式）；`specDriverConfigSchema` 在缺失时为 `null`。
4. `validateConfig(parsedYaml)` 函数体顶部增加降级分支：
   ```text
   if (!zodAvailable) {
     return {
       success: true,
       data: (parsedYaml && typeof parsedYaml === 'object') ? parsedYaml : {},
       degraded: true,
       diagnostics: [{
         level: 'warning',
         code: 'config.zod-unavailable',
         message: '未能加载 zod，已跳过 spec-driver.config.yaml schema 校验并 best-effort 接受配置；如需完整校验请在已安装依赖的目录运行（npm i）或从仓内源路径运行',
       }],
     };
   }
   ```
   置于现有 `parsedYaml == null → {success:true, data:{}}` 早退之后、`specDriverConfigSchema.safeParse` 之前。
5. 常量导出 + `levenshtein` / `suggestField` / `resolveEffectiveConfig` **原样不动**（不依赖 z）。

**为什么**：消灭加载期硬崩；`validateConfig` 降级为 best-effort 接受，不破坏既有 `{ success, data, diagnostics }` 返回 shape（仅在降级时多一个可选 `degraded` 字段）。

### 不改动（确认）：`plugins/spec-driver/scripts/validate-config.mjs`

见 D5：退出码逻辑只看 `diagnostics` 的 error/warning 级，不看 `success`，降级返回的单条 warning 天然走 exit 0+warn 路径。`degraded` 字段被忽略。**本文件零改动**，但需在验证方案中显式覆盖"缺 zod 时 `--validate` 退出码 0"。

### 不改动（确认）：`plugins/spec-driver/scripts/resolve-project-context.mjs`

CLI 入口仅调 `resolveProjectContext` 并 JSON/text 序列化输出。降级后 result shape 不变，故本文件零改动，但需验证"缺 zod 时 `--json` 输出有效 JSON + 退出码 0"。

## 回归风险评估

### 必须逐字节不变（zod 在场时；既有测试必须全绿）

| 路径 | 不变量 |
|------|--------|
| `project-profile-schema.mjs` 导出 | zod 在场时 `referenceEntrySchema` / `resolvedProjectProfileSchema` 等仍是等价的真实 zod schema（同 `.refine` / `.extend` / 字段约束）；新增 `zodAvailable === true` |
| `project-profile-resolver.mjs` L72 | zod 在场时仍走 `referenceEntrySchema.safeParse`，invalid-reference 诊断信息逐字节不变 |
| `project-profile-resolver.mjs` L613-651 | zod 在场时仍走 safeParse + schema-fallback 兜底，`project-context.schema-fallback` 诊断不变 |
| `resolveProjectContext` 返回 | zod 在场时**不**新增 `zod-unavailable` 诊断；所有现有字段/诊断序列与现状完全一致 |
| `config-schema.mjs::validateConfig` | zod 在场时返回 `{ success, data, diagnostics }`（**不含** `degraded`）；所有现有 error/warning 诊断（unknown-field / invalid-enum / invalid-type / timeout-too-large 等）逐字节不变 |
| `validate-config.mjs` 退出码 | zod 在场时 exit 0/1/2 行为完全不变 |

### 新增分支（仅 zod 缺失时触发）

- `load-zod.mjs` 缺失返回 `{ available:false }`。
- schema 模块导出 `null` + `zodAvailable===false`（模块加载不崩）。
- resolver L72 手写 `path‖url` 校验；L613 跳过 safeParse 直接用 normalized；入口 push 一条 `project-context.zod-unavailable` warning。
- `validateConfig` 早退降级返回（含 `degraded:true` + `config.zod-unavailable` warning）。

### 最大回归风险点（按优先级）

1. **【最高】schema 模块改造后，zod 缺失时模块体仍触碰 `z` 导致 `ReferenceError`**——若未把全部 `z.object(...)` 求值包进 `zodAvailable` 守卫，缺失分支会从"硬崩 MODULE_NOT_FOUND"变成"硬崩 ReferenceError"，问题未真正修复。**缓解**：守卫必须覆盖**所有**顶层 schema 求值；新增"强制缺 zod 子进程加载 schema 模块不抛"的冒烟测试。
2. **【高】`export const` 不能进 `if` 块**——必须改用 `let + 末尾统一 export` 模式，否则语法错误。**缓解**：`npm run build` 类型/语法检查 + 子进程 import 冒烟。
3. **【中】resolver 手写 reference 校验与 zod `.refine` 语义漂移**——zod 版要求 `path || url` 且字段 trim/类型约束；手写版只校验 `path || url` 存在性，**容忍度更宽**（可能放行 zod 会拒的边缘条目）。这是降级路径的**可接受**妥协（fix-report 已认可"信任手写 normalize"），但需在测试中明确降级路径产出与正常路径对**有效输入**等价。**缓解**：降级用例用合法输入断言 shape 一致；不追求与 zod 对非法输入的拒绝行为对齐。
4. **【中】`validateConfig` 新增 `degraded` 字段对未知消费端的影响**——已 grep 确认仓内仅 `validate-config.mjs` 消费 `validateConfig`，且只解构 `{ success, diagnostics }`。**缓解**：保持 `degraded` 为可选附加字段，不改既有字段。
5. **【低】memoize 跨用例污染**——同进程内 `loadZod` 缓存导致测试相互影响。**缓解**：`__resetZodCacheForTest()` + 端到端缺失用例走子进程（环境变量隔离），不依赖同进程切换。

## 验证方案

### 新增/扩展测试

| 文件 | 类型 | 用例 |
|------|------|------|
| `tests/unit/spec-driver-load-zod.test.ts`（新增） | 单元 | (1) 正常 `loadZod()` 返回 `{ available:true, z!=null }`；(2) `SPEC_DRIVER_FORCE_ZOD_MISSING=1` → `{ available:false, z:null, error }`；(3) memoize：连续两次同引用；(4) `__resetZodCacheForTest()` 后可重新求值（设/清环境变量切换态）。注意每个用例前后清环境变量 + `__resetZodCacheForTest()` 隔离。 |
| `tests/integration/spec-driver-project-context-resolver.test.ts`（扩展） | 集成（子进程） | 新增"强制缺 zod → 降级路径"用例：`execFileSync('node', [SCRIPT, '--project-root', root, '--json'], { env: { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' } })`。断言：(a) 不抛、退出码 0；(b) stdout 是有效 JSON；(c) `diagnostics` 含 `project-context.zod-unavailable`（warning，仅一条）；(d) `resolvedProfile` shape 与同输入正常路径等价（product/references/verificationPolicy 等字段齐全）。复用现有 `runResolver` helper，扩展为可传 env。 |
| `tests/unit/spec-driver-config-schema.test.ts`（新增；fix-report 提及的 `spec-driver-config.test.ts` 实测是 `src/config/spec-driver-config.ts` 的测试，与 `config-schema.mjs` 无关，故新建专用文件） | 单元 | (1) zod 在场：`validateConfig(合法 yaml)` 返回 `{ success:true }` **不含** `degraded`；非法 enum/unknown-field 仍产 error 诊断（防回归）；(2) 强制缺 zod（设 `SPEC_DRIVER_FORCE_ZOD_MISSING` + `__resetZodCacheForTest` + 动态 import config-schema）：`validateConfig` 返回 `{ success:true, degraded:true, diagnostics:[config.zod-unavailable] }`。**注意**：因 schema 模块在加载期固化 `zodAvailable`，缺失态需在 import config-schema **之前**设好环境变量（用 vitest 的 `vi.resetModules()` + 动态 `import()`，或独立子进程脚本）。 |

> **测试 seam 关键点**：schema 模块的 `zodAvailable` 在模块**首次加载时**固化。因此"缺 zod"态最可靠的注入方式是**子进程 + 环境变量**（resolver/CLI 端到端用例采用）；同进程单测切换态需 `vi.resetModules()` 配合 `__resetZodCacheForTest()` 重新动态 import。两条路径都要覆盖。

### 验证命令

```bash
# 1. 单元 + 集成测试（聚焦本 fix 相关文件）
npx vitest run tests/unit/spec-driver-load-zod.test.ts \
               tests/unit/spec-driver-config-schema.test.ts \
               tests/integration/spec-driver-project-context-resolver.test.ts

# 2. 全量回归（确认零失败 — 既有测试在 zod 在场时必须全绿）
npx vitest run

# 3. 类型/语法检查（确认 let+末尾 export 改造无语法错误）
npm run build

# 4. 仓库同步校验（触及 plugins/spec-driver/scripts 后）
npm run repo:check

# 5. 手工冒烟：模拟缺 zod 跑两个 CLI，确认不崩 + 退出码 0
SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/resolve-project-context.mjs --project-root . --json ; echo "exit=$?"
SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/validate-config.mjs --project-root . --validate ; echo "exit=$?"
```

### 验收标准（Acceptance）

- AC-1：`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 下 `resolve-project-context.mjs --json` 输出有效 JSON、退出码 0、含 `project-context.zod-unavailable` warning（仅一条）。
- AC-2：同条件下 `validate-config.mjs --validate` 退出码 0、输出含 `config.zod-unavailable` warning。
- AC-3：zod 在场时既有全量测试零失败（行为逐字节不变，含两个 schema 模块的导出与诊断）。
- AC-4：`npm run build` + `npm run repo:check` 零错误。
- AC-5：schema 模块在缺 zod 时**仅返回 null + 不抛任何错**（无 MODULE_NOT_FOUND、无 ReferenceError）。

## Codex 设计审查结论与修正（implement 前）

设计阶段对抗审查：**0 critical / 2 warning**。两条均为真实问题，已纳入 implement 约束：

- **W1（真实缺陷 · shape 分叉）**：resolver 降级 object-reference 分支若用 `{ ...entry, source }` 浅拷贝，会**绕过正常路径经 `referenceEntrySchema` 施加的 `.trim()`**（label/path/url/purpose），导致 `path: " docs/a.md "` 在正常路径解析为 `docs/a.md`、降级路径解析为带空格路径。**修正**：降级分支**不浅拷贝**，改为手写构造已知字段——`label/path/url/purpose` 先 `String(...).trim()`，`required` 仅接受 boolean，`path || url` 基于 trim 后结果判断，再复用现有 path 解析逻辑（L84-94）。测试需断言降级与正常路径对"含前后空格的有效 reference"产出等价。
- **W2（测试健壮性 · env/module 泄漏）**：同进程缺 zod 用例（config 单测）存在 `SPEC_DRIVER_FORCE_ZOD_MISSING` + memoize + `vi.resetModules` 的泄漏风险。**修正**：(1) resolver/CLI 缺 zod 用例**一律走子进程**（env 隔离）；(2) config 同进程单测**禁止在测试文件顶层静态 import 被测 schema**，改用 `beforeEach/afterEach` 同时清 `process.env.SPEC_DRIVER_FORCE_ZOD_MISSING` + `vi.resetModules()` + `__resetZodCacheForTest()`，再在用例内动态 `import()`。

确认安全（无需改动）：createRequire+`require('zod')` 及 `mod.z ?? mod`（zod 自带 CJS，实测 `mod.z` 为命名空间）；validateConfig 降级丢 default 不影响仓内消费（仅 validate-config.mjs 消费且只看 diagnostics）；resolvedProjectProfileSchema 无 `.default()/.transform()`，降级跳过 safeParse 不改写数据（除上述 trim）；诊断按入口 push 一次成立；无 ESM 循环依赖/TDZ。实现时 guard 须覆盖全部 `z.object/z.enum/z.array/z.record` 及 `.refine/.extend/.strict()` 链式求值。

## 收尾（implement 阶段后）

- 修复落地后更新/删除 Claude memory `project_spec_driver_plugin_cache_zod_missing`（标注：4.x 已具备 zod 缺失降级，缓存缺 node_modules 不再硬崩）。
- 上报 follow-up：`contracts/orchestration-schema.mjs` 同源裸 import 仍存隐患，可复用 `load-zod.mjs` 思路单独修。
- 本 fix 不新增/不改动 spec（纯增量健壮性，zod 在场契约不变）。
