---
feature: 199-fix-orchestration-schema-zod-degradation
mode: fix
phase: tasks
status: draft
based_on: ./plan.md
---

# 任务清单 — orchestration-schema zod 缺失优雅降级

> Feature 199 · fix 模式 · 共 6 个任务，核心依赖链：T-001 → T-002 → T-003 → T-004 → T-005 → T-006

---

## T-001 改造 `orchestration-schema.mjs`：顶层 import 替换 + 9 个 schema 守卫化

**优先级**：P0（最高风险点，阻塞所有后续任务）

**目标文件**：`plugins/spec-driver/contracts/orchestration-schema.mjs`

**具体改动**：

1. **删除 L19 顶层裸 import**，将 `import { z } from 'zod'` 替换为：
   ```
   import { loadZod } from '../scripts/lib/load-zod.mjs';
   const { z, available: zodAvailable } = loadZod();
   ```

2. **保留不进守卫的顶层导出**（D4 决策）：
   - `export function formatZodIssue(issue) { ... }` 保持顶层原位，不进守卫
   - `export const BASE_RESERVED_MODE_NAMES = [...]` 保持顶层原位，不进守卫

3. **将全部 9 个 `z.*` schema 求值改为 `let + if(zodAvailable) 赋值 + 末尾统一 export` 模式**，赋值顺序严格遵循依赖关系：
   - **初始声明**（全部初始值为 `null`）：
     ```
     let phaseSchema = null;
     let gateDefinitionSchema = null;
     let gateOverrideSchema = null;
     let modeDefinitionSchema = null;
     let modeOverrideSchema = null;
     let parallelGroupSchema = null;
     let parallelSchedulingSchema = null;
     let orchestrationBaseSchema = null;
     let orchestrationOverridesSchema = null;
     let orchestrationMergedSchema = null;
     ```
   - **守卫块内赋值顺序**（`if (zodAvailable) { ... }`）：
     1. 叶子 schema（无内部依赖）：`phaseSchema`、`gateDefinitionSchema`、`gateOverrideSchema`、`parallelGroupSchema`、`parallelSchedulingSchema`
     2. 依赖 `phaseSchema` 的中层 schema：`modeDefinitionSchema`、`modeOverrideSchema`
     3. 依赖多个子 schema 的顶层 schema：`orchestrationBaseSchema`（依赖 parallelSchedulingSchema / gateDefinitionSchema / parallelGroupSchema / modeDefinitionSchema）、`orchestrationOverridesSchema`（依赖 modeOverrideSchema / gateOverrideSchema）
     4. 别名：`orchestrationMergedSchema = orchestrationBaseSchema`
   - 守卫块内所有链式调用（`.refine` / `.extend` / `.strict()` / `.strip()` / `z.union` / `z.enum` / `z.record` / `z.array` / `z.object` / `z.unknown` / `z.string` / `error_map`）**必须完整移入守卫内**，一处都不能遗漏

4. **末尾统一 export**（ESM `export const` 不能放进 `if` 块，必须用末尾 export 语句）：
   ```
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

**验收点**：
- 缺 zod 时（`SPEC_DRIVER_FORCE_ZOD_MISSING=1`）模块加载**不抛任何错**（无 `ERR_MODULE_NOT_FOUND`、无 `ReferenceError`）
- 缺 zod 时全部 9 个 schema 导出为 `null`，`zodAvailable === false`
- `formatZodIssue` 和 `BASE_RESERVED_MODE_NAMES` 在缺 zod 时仍可正常访问（顶层导出，不进守卫）
- zod 在场时全部 9 个 schema 导出与当前实现逐字节等价（`.strict()` / `.strip()` / enum 约束一字不差）
- `npm run build` 语法检查零错误（`let + 末尾 export` 模式无语法错误）

**依赖**：无（首个任务，只依赖 F198 已落地的 `scripts/lib/load-zod.mjs`，无需改动后者）

---

## T-002 改造 `orchestration-resolver.mjs`：增加 `zodAvailable` import + 步骤 1/2 之间插入降级短路

**优先级**：P1（阻塞 T-004、T-005）

**目标文件**：`plugins/spec-driver/lib/orchestration-resolver.mjs`

**具体改动**：

1. **扩展 L21-26 的 import 语句**，在现有 `{ orchestrationBaseSchema, orchestrationOverridesSchema, orchestrationMergedSchema, formatZodIssue }` 之后追加 `zodAvailable`：
   ```
   import {
     orchestrationBaseSchema,
     orchestrationOverridesSchema,
     orchestrationMergedSchema,
     formatZodIssue,
     zodAvailable,
   } from '../contracts/orchestration-schema.mjs';
   ```

2. **在步骤 1 完成（L209，rawBase 加载成功）之后、步骤 2（L212，`orchestrationBaseSchema.safeParse(rawBase)`）之前**，插入 zod 缺失降级短路分支：

   ```
   // ── zod 缺失短路（步骤 1 成功之后、步骤 2 safeParse 之前）────────
   if (!zodAvailable) {
     // 纯对象检查
     const isBaseRawPlainObject =
       rawBase !== null &&
       rawBase !== undefined &&
       Object.prototype.toString.call(rawBase) === '[object Object]';

     if (!isBaseRawPlainObject) {
       // base 非纯对象 → 视为 base 损坏，退 generateFallbackConfig
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

     // base 是纯对象 → best-effort 信任，跳过 overrides（用户输入，无法校验）
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
   // ── zod 缺失短路结束 ─────────────────────────────────────────────
   ```

**实现注意**：
- 返回对象严格保持 6 个字段（`mergedConfig / baseConfig / fieldSources / diagnostics / isFallback / isBaseInvalid`），shape 与正常路径完全一致
- 使用 `rawBase`（原始 YAML 对象，步骤 1 产物），不是 `baseConfig`（safeParse.data，此时尚未赋值）
- 三处现有 safeParse（L212 base、L379 overrides、L422 merged）因短路而全部跳过，无需在各处单独加守卫
- `buildBaseOnlyFieldSources(rawBase)` 在 rawBase 字段缺失时内层 `Object.keys(...)` 已有 `|| {}` 防御，安全

**验收点**：
- zod 在场时：现有步骤 2-9 逻辑**逐字节不变**，diagnostics 序列、fieldSources、返回 shape 与修改前完全一致
- 缺 zod 时（rawBase 为纯对象路径）：立即短路返回，`isFallback: true, isBaseInvalid: false`，`diagnostics` 含且仅含一条 `orchestration.zod-unavailable` warning
- 缺 zod 时（rawBase 非纯对象路径）：返回 `isFallback: true, isBaseInvalid: true`，`diagnostics` 含 `orchestration.base-invalid` error

**依赖**：T-001（`zodAvailable` 导出由 T-001 新增）

---

## T-003 改造 `orchestrator.mjs`：增加 `zodAvailable` import + `loadAndValidateConfig` 内插守卫

**优先级**：P1（阻塞 T-004、T-005）

**目标文件**：`plugins/spec-driver/lib/orchestrator.mjs`

**具体改动**：

1. **扩展 L13 的 import 语句**，在现有 `{ orchestrationBaseSchema, formatZodIssue }` 之后追加 `zodAvailable`：
   ```
   import {
     orchestrationBaseSchema,
     formatZodIssue,
     zodAvailable,
   } from '../contracts/orchestration-schema.mjs';
   ```

2. **在 `loadAndValidateConfig()` 方法内，L59（`const parsed = parseYamlDocument(content)` 之后）、L61 注释行（`// 使用 orchestrationBaseSchema.safeParse...`）之前**，在 try 块内插入 zod 缺失守卫：

   ```
   // ── zod 缺失守卫（YAML 解析成功之后、safeParse 之前）────────────
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
       this.isFallback = false;   // 真实配置，非最小桩
     } else {
       // parsed 不是纯对象 → 退 generateFallbackConfig
       this.logger.warn(
         '[ORCHESTRATOR] zod 未加载且 YAML 解析结果非纯对象，使用 fallback 配置',
       );
       this.config = generateFallbackConfig();
       this.isFallback = true;
     }
     return;   // 跳过 safeParse，退出 loadAndValidateConfig
   }
   // ── zod 缺失守卫结束 ─────────────────────────────────────────────
   ```

**实现注意**：
- 守卫插入在 try 块内部（L50 try 开始），不破坏外层异常捕获（文件 IO 错误、YAML 语法错误在 L50-59 先抛出，不会到达守卫）
- `this.isFallback = false`（纯对象信任路径）是明确语义：真实编排配置，非最小桩；与 resolver 降级的 `isFallback: true` 有意区分（两者 `isFallback` 语义不同——orchestrator 的语义是"是否用了最小桩"）
- zod 在场时 L62 safeParse 分支**逐字节不变**，`isFallback` / `config` 赋值与现状完全一致

**验收点**：
- zod 在场时：`loadAndValidateConfig` 逻辑**逐字节不变**，`isFallback` / `config` 赋值与修改前完全一致
- 缺 zod 时（parsed 为纯对象）：`this.config = parsed`，`this.isFallback = false`，`return` 跳过 safeParse
- 缺 zod 时（parsed 非纯对象）：`this.config = generateFallbackConfig()`，`this.isFallback = true`
- 外层 try/catch 的 error 路径（文件 IO / YAML 语法错误）不受影响

**依赖**：T-001

---

## T-004 新增单元测试 `tests/unit/spec-driver-orchestration-schema.test.ts`

**优先级**：P2

**目标文件**：`tests/unit/spec-driver-orchestration-schema.test.ts`（新建）

**具体改动**：新建测试文件，覆盖 3 个测试套件：

**套件 1：zod 在场时的 schema 加载**
- 用例：动态 `import()` orchestration-schema.mjs，断言所有 9 个 schema 导出非 `null`
- 用例：`zodAvailable === true`
- 用例：`formatZodIssue` 是可调用函数，`BASE_RESERVED_MODE_NAMES` 是非空数组
- 用例：`phaseSchema.safeParse(...)` 对合法 phase 对象返回 `success: true`（smoke test，不覆盖所有 enum）

**套件 2：缺 zod 时的守卫降级（关键路径，最高风险点）**
- `beforeEach`：设置 `process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = '1'`，调用 `__resetZodCacheForTest()`，调用 `vi.resetModules()` 清 ESM 模块缓存
- `afterEach`：delete `process.env.SPEC_DRIVER_FORCE_ZOD_MISSING`，再次 `vi.resetModules()`，防止污染后续用例
- 用例：在测试内动态 `import()` orchestration-schema.mjs，断言**不抛任何错**（捕获异常则失败）
- 用例：全部 9 个 schema 导出（`phaseSchema` / `gateDefinitionSchema` / `gateOverrideSchema` / `modeDefinitionSchema` / `modeOverrideSchema` / `parallelGroupSchema` / `parallelSchedulingSchema` / `orchestrationBaseSchema` / `orchestrationOverridesSchema` / `orchestrationMergedSchema`）全为 `null`
- 用例：`zodAvailable === false`
- 用例：`formatZodIssue` 仍可访问（不为 undefined），`BASE_RESERVED_MODE_NAMES` 仍为数组

**套件 3：导出 shape 稳定性（回归守护）**
- 用例：所有预期导出名均存在（无拼写错误导致的 `undefined` 导出）

**关键测试约定**：
- **测试文件顶层不静态 import 被测 schema**（`import { orchestrationBaseSchema } from '...'` 这种静态 import 禁止出现在顶层），全部用 `beforeEach` + 动态 `import()` 防止 memoize 污染
- 使用 vitest 的 `vi.resetModules()` 而非 jest 的 `jest.resetModules()`
- `__resetZodCacheForTest()` 是 F198 `load-zod.mjs` 已导出的测试 seam，确认引用路径正确（`../scripts/lib/load-zod.mjs`）

**验收点**：
- `npx vitest run tests/unit/spec-driver-orchestration-schema.test.ts` 全部通过，零失败
- 套件 2 覆盖"缺 zod 时模块加载不抛"这个最高风险点，有明确的用例断言此行为
- 套件 1 在缺 zod 用例运行后仍能在同一 vitest 进程内独立通过（测试间无污染）

**依赖**：T-001、T-002、T-003（被测代码需全部就位）

---

## T-005 新增集成测试 `tests/integration/spec-driver-orchestration-zod-degradation.test.ts`

**优先级**：P2（与 T-004 可并行，依赖相同前置任务）

**目标文件**：`tests/integration/spec-driver-orchestration-zod-degradation.test.ts`（新建）

**具体改动**：新建集成测试文件，以**子进程**方式端到端验证缺 zod 降级路径（最可靠隔离方式，环境变量完全隔离）：

**套件：缺 zod 子进程 CLI 端到端降级验证**

所有用例共用以下子进程调用模式：
```
execFileSync('node', [...args], {
  env: { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' },
  encoding: 'utf8',
})
```

- **用例 1（AC-1 映射）**：`effective-orchestration fix --format json` 不抛、退出码 0
- **用例 2（AC-1 映射）**：上述命令的 stdout 是有效 JSON（`JSON.parse` 不抛）
- **用例 3（AC-1 映射）**：解析后的 JSON `diagnostics` 数组含且仅含一条 `{ code: 'orchestration.zod-unavailable', level: 'warning' }` 条目
- **用例 4（AC-1 映射）**：解析后的 JSON 中 `modes.fix` 存在且非 null（真实 base 编排被保留，非最小桩）
- **用例 5（AC-1 映射）**：`isFallback === true`，`isBaseInvalid === false`
- **用例 6（AC-2 映射）**：`generate-template fix` 退出码 0（`isBaseInvalid: false` 保证 CLI 不误拒）
- **用例 7（AC-6 映射）**：`effective-orchestration feature --format json` 同样不崩、退出码 0（多 mode 回归）

**实现注意**：
- 复用现有 orchestration 测试的子进程调用模式（参照 `plugins/spec-driver/tests/` 下 `orchestration*.test.mjs` 风格）
- CLI 路径使用绝对路径或相对于 `process.cwd()` 的路径，避免 worktree 路径问题
- `execFileSync` 配置 `stdio: ['pipe', 'pipe', 'pipe']`，分别捕获 stdout / stderr，stdout 用于 JSON 解析，stderr 用于诊断消息确认

**验收点**：
- `npx vitest run tests/integration/spec-driver-orchestration-zod-degradation.test.ts` 全部通过，零失败
- 7 个用例逐条覆盖 AC-1、AC-2、AC-6 的核心场景
- 子进程路径（`SPEC_DRIVER_FORCE_ZOD_MISSING=1`）验证了 T-001 的"守卫未覆盖全部 z.* 求值"最高风险点（若有任何 `z.*` 泄漏守卫外，子进程会崩溃，用例 1 失败）

**依赖**：T-001、T-002、T-003（被测代码需全部就位）；可与 T-004 并行

---

## T-006 全量验证：逐条确认 AC-1~AC-7 + 零回归

**优先级**：P3（最终交付门禁）

**目标文件**：无新改动，执行验证命令 + 逐条勾选验收项

**验证命令序列**（按 plan.md §验证方案 执行）：

```bash
# 步骤 1：新增测试文件（聚焦本 fix）
npx vitest run tests/unit/spec-driver-orchestration-schema.test.ts \
               tests/integration/spec-driver-orchestration-zod-degradation.test.ts

# 步骤 2：全量回归（确认 zod 在场时零失败）
npx vitest run

# 步骤 3：orchestration 原有 node:test 套件回归（不在 vitest 收集范围）
node --test plugins/spec-driver/tests/orchestration*.test.mjs 2>&1 | tail -20

# 步骤 4：类型/语法检查
npm run build

# 步骤 5：仓库同步校验
npm run repo:check

# 步骤 6：手工冒烟（缺 zod 路径 CLI 三命令）
SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  effective-orchestration fix --format json ; echo "exit=$?"

SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  effective-orchestration feature --format json ; echo "exit=$?"

SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/orchestrator-cli.mjs \
  generate-template fix ; echo "exit=$?"
```

**逐条 AC 验收清单**：

- [ ] **AC-1**：`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 下 `effective-orchestration fix --format json` 输出有效 JSON、退出码 0、`diagnostics` 含 `orchestration.zod-unavailable` warning（仅一条）、`modes.fix` 存在
- [ ] **AC-2**：同条件下 `generate-template fix` 退出码 0（`isBaseInvalid: false` 保证 CLI 不误拒）
- [ ] **AC-3**：zod 在场时 `npx vitest run` 全量零失败（行为逐字节不变）
- [ ] **AC-4**：`node --test plugins/spec-driver/tests/orchestration*.test.mjs` 零失败（orchestration node:test 回归基线）
- [ ] **AC-5**：`npm run build` + `npm run repo:check` 零错误
- [ ] **AC-6**：`orchestration-schema.mjs` 缺 zod 时仅导出 `null` + `zodAvailable: false`，**不抛任何错**（T-004 套件 2 + T-005 用例 1 双重保证）
- [ ] **AC-7**：zod 在场时全部 9 个 schema 导出与当前实现逐字节等价（T-004 套件 1 保证；若有 `.strict()` / `.strip()` / enum 约束被简化，此 AC 失败）

**验收点**：
- 以上 7 条 AC 全部勾选（全绿）方可视为本 fix 完成
- 步骤 3 的 orchestration node:test 套件输出末尾含"pass"且无"fail"行
- 步骤 6 的三条冒烟命令 `exit=0`

**依赖**：T-001、T-002、T-003、T-004、T-005 全部完成

---

## 任务依赖关系图

```
T-001（orchestration-schema.mjs 守卫化）
  └── T-002（resolver 降级短路）
  └── T-003（orchestrator 守卫）
        ├── T-004（单元测试，依赖 T-001/T-002/T-003）
        ├── T-005（集成测试，依赖 T-001/T-002/T-003，可与 T-004 并行）
        └── T-006（全量验证，依赖全部前置任务）
```

**关键依赖链**：T-001 → T-002、T-003（并行）→ T-004、T-005（并行）→ T-006

**并行机会**：T-002 与 T-003 均仅依赖 T-001，可在 T-001 完成后并行改造；T-004 与 T-005 均依赖 T-001/T-002/T-003，可在三者完成后并行编写。

---

## 不纳入本 fix 的改动（明确排除）

以下内容 plan.md 已明确排除，tasks 阶段不新增：

- `scripts/lib/load-zod.mjs`：F198 已落地，不迁移、不改动
- `formatZodIssue` / `BASE_RESERVED_MODE_NAMES`：不进守卫，保持顶层
- `scripts/orchestrator-cli.mjs`：CLI 入口不改，降级诊断经现有 `cmdEffectiveOrchestration` 呈现
- `project-profile-schema.mjs` / `config-schema.mjs`：F198 已修
- `contracts/` 其余 `.yaml` / `.md` 文件：无 zod 依赖
