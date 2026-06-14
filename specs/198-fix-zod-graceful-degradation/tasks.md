---
feature: 198-fix-zod-graceful-degradation
mode: fix
phase: tasks
status: draft
based_on: ./plan.md（方案 A，共享同步 zod 加载 helper + 惰性 schema + 降级诊断）
---

# Tasks: spec-driver 脚本 zod 缺失优雅降级

**输入制品**: `specs/198-fix-zod-graceful-degradation/plan.md` + `fix-report.md`
**核心不变量**: zod 在场时所有既有行为逐字节不变；降级分支仅在 zod 缺失时触发。

## 任务格式

- `[Tn]` — 任务 ID（T1 起，连续递增）
- `[P]` — 可与其他 [P] 任务并行（不同文件、无依赖）
- `依赖: Tx, Ty` — 前置必须完成的任务
- `AC-n` — 对应验收标准编号（来自 plan.md）

---

## Phase 1：Helper（前置基础，最先完成）

**目标**：新建共享 zod 加载 helper，所有 schema 模块改造均依赖它。

**完成判据**：`T1` 单独可被正常 import；`load-zod.mjs` 文件存在且 `loadZod()` 函数签名正确。

- [x] T1 新建 `load-zod.mjs` — 同步 `createRequire` zod 加载 helper（含 memoize + 测试 seam + `__resetZodCacheForTest`）
  - **文件**: `plugins/spec-driver/scripts/lib/load-zod.mjs`（新增）
  - **依赖**: 无
  - **完成判据**: 文件存在；`loadZod()` 导出正确（`{ z, available, error }`）；`SPEC_DRIVER_FORCE_ZOD_MISSING=1` 使 `available=false`；`__resetZodCacheForTest()` 已导出。

---

## Phase 2：Schema 模块改造（消灭加载期硬崩根因）

**目标**：两个 schema 模块删除顶层裸 `import { z } from 'zod'`，改为经 `load-zod.mjs` 惰性构建；zod 缺失时导出 `null` + `zodAvailable=false` 且**模块加载不抛任何错**。

**关键风险护栏**：必须把所有 `z.object(...)` 求值包进 `zodAvailable` 守卫（`let + 末尾 export` 模式），避免 `ReferenceError` 陷阱（plan 风险 #1/#2）。

**完成判据**：两个模块均可在 `SPEC_DRIVER_FORCE_ZOD_MISSING=1` 子进程 import 而不抛（覆盖 AC-5）。

- [x] T2 [P] 改造 `project-profile-schema.mjs` — 删顶层裸 import，改 loadZod helper，`let + 末尾 export` 惰性 schema 构建，新增 `zodAvailable` 导出
  - **文件**: `plugins/spec-driver/scripts/lib/project-profile-schema.mjs`（修改）
  - **依赖**: T1
  - **改动要点**:
    1. 删除 L1 `import { z } from 'zod'`，替换为 `import { loadZod } from './load-zod.mjs'`
    2. 模块体：`const { z, available: zodAvailable } = loadZod()`
    3. 将 `referenceEntryObjectSchema` / `referenceEntrySchema` / `resolvedReferenceEntrySchema` / `resolvedProjectProfileSchema` 全部改为 `let xxx = null`；在 `if (zodAvailable) { ... }` 块内赋值真实 schema
    4. 末尾统一 `export { referenceEntrySchema, resolvedProjectProfileSchema, zodAvailable, ... }`（保持导出名不变）
    5. `EXCLUDED_EXECUTION_FIELDS` / `ALLOWED_TOP_LEVEL_FIELDS` 等纯常量**原样保留**
  - **完成判据**: `SPEC_DRIVER_FORCE_ZOD_MISSING=1 node -e "import('./plugins/spec-driver/scripts/lib/project-profile-schema.mjs').then(m => console.log(m.zodAvailable))"` 输出 `false` 且进程退出码 0；zod 在场时 `zodAvailable === true` 且 schema 对象非 null。

- [x] T3 [P] 改造 `config-schema.mjs` — 删顶层裸 import，改 loadZod helper，`let + 末尾 export` 惰性 schema 构建，新增 `zodAvailable` 导出，`validateConfig` 顶部加降级早退
  - **文件**: `plugins/spec-driver/scripts/lib/config-schema.mjs`（修改）
  - **依赖**: T1
  - **改动要点**:
    1. 删除 L14 `import { z } from 'zod'`，替换为 `import { loadZod } from './load-zod.mjs'`
    2. 模块体：`const { z, available: zodAvailable } = loadZod()`
    3. 将 `modelNameSchema` … `specDriverConfigSchema` 全部改为 `let xxx = null`；在 `if (zodAvailable) { ... }` 块内赋值
    4. `validateConfig` 函数体：在现有 `parsedYaml == null` 早退之后、`specDriverConfigSchema.safeParse` 之前，插入 `if (!zodAvailable) { return { success: true, data: ..., degraded: true, diagnostics: [{ level: 'warning', code: 'config.zod-unavailable', message: '...' }] } }`
    5. `levenshtein` / `suggestField` / `resolveEffectiveConfig` / 常量导出**原样不动**
  - **完成判据**: `SPEC_DRIVER_FORCE_ZOD_MISSING=1 node -e "import('./plugins/spec-driver/scripts/lib/config-schema.mjs').then(m => console.log(m.zodAvailable))"` 输出 `false` 且进程退出码 0；zod 在场时 `validateConfig(合法 yaml)` 返回不含 `degraded`。

---

## Phase 3：Resolver 降级分支（调用方适配）

**目标**：`project-profile-resolver.mjs` 在 zod 缺失时跳过两处 `.safeParse`，push 一条 `project-context.zod-unavailable` warning，确保 resolver 降级后返回 shape 与正常路径一致。

**完成判据**：缺 zod 子进程跑 resolver 不崩、输出有效结构化结果、含 warning（覆盖 AC-1）。

- [x] T4 改造 `project-profile-resolver.mjs` — import `zodAvailable`，L72 手写校验分支，L613 跳过 safeParse，入口 push 一条 warning
  - **文件**: `plugins/spec-driver/scripts/lib/project-profile-resolver.mjs`（修改）
  - **依赖**: T2
  - **改动要点**:
    1. `import { ..., referenceEntrySchema, resolvedProjectProfileSchema, zodAvailable } from './project-profile-schema.mjs'`（新增 `zodAvailable`）
    2. `resolveProjectContext` 入口：`if (!zodAvailable)` → push 一条 `createDiagnostic('warning', 'project-context.zod-unavailable', '...')`，只 push 一次
    3. L72（object 形态 reference 处理）：`if (zodAvailable)` → 现有 `referenceEntrySchema.safeParse(entry)` 逻辑不变；`else` → 手写 `Boolean(entry.path || entry.url)` 校验 + 构造 `normalized`
    4. L613（`resolvedProjectProfileSchema.safeParse(normalized)`）：`if (zodAvailable)` → 现有逻辑不变；`else` → 直接用 `normalized`（跳过 safeParse + `.parse({...})` 兜底）
    5. string 形态 reference（L40-63）**零改动**
  - **完成判据**: `SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/resolve-project-context.mjs --project-root . --json` 输出有效 JSON、退出码 0、`diagnostics` 含 `project-context.zod-unavailable`（仅一条）。

---

## Phase 4：测试（先写测试，覆盖 AC + 护栏）

**目标**：3 个测试文件分别覆盖 helper 单测、config schema 缺 zod 降级、resolver 集成子进程缺 zod，并在 zod 在场时验证全量回归零失败。

**说明**：测试任务不互相依赖，但实现上依赖 T1/T2/T3/T4 已完成（测试文件与被测代码同步写入；本 fix 模式下测试与实现并行进行，而非严格 TDD 先失败后实现）。

- [x] T5 [P] 新建 `spec-driver-load-zod.test.ts` — `loadZod` helper 全覆盖单测（覆盖 AC-5 局部 + helper 正确性）
  - **文件**: `tests/unit/spec-driver-load-zod.test.ts`（新增）
  - **依赖**: T1
  - **覆盖 AC**: AC-5（schema 模块加载不抛的 helper 基础）
  - **用例清单**:
    1. zod 正常在场：`loadZod()` 返回 `{ available: true, z: 非 null, error: null }`
    2. `SPEC_DRIVER_FORCE_ZOD_MISSING=1`：`loadZod()` 返回 `{ available: false, z: null, error 非 null }`
    3. memoize：同一进程连续两次调用返回相同对象引用
    4. `__resetZodCacheForTest()` 后，改变环境变量可切换态（先正常 → reset + 设 env → 再调返回 available=false）
    5. `loadZod()` 永不抛（无论 zod 在否）
  - **完成判据**: `npx vitest run tests/unit/spec-driver-load-zod.test.ts` 全绿。

- [x] T6 [P] 新建 `spec-driver-config-schema.test.ts` — `config-schema.mjs` zod 在场/缺失两态单测（覆盖 AC-2、AC-3 config 侧、AC-5）
  - **文件**: `tests/unit/spec-driver-config-schema.test.ts`（新增）
  - **依赖**: T3
  - **覆盖 AC**: AC-2、AC-3（config 侧）、AC-5
  - **用例清单**:
    1. zod 在场：`validateConfig(合法 yaml)` 返回 `{ success: true, data: ... }`，**不含** `degraded`（防回归）
    2. zod 在场：非法 enum / unknown-field 仍产 error 诊断（既有行为不变，防回归）
    3. zod 缺失（`SPEC_DRIVER_FORCE_ZOD_MISSING=1` + `vi.resetModules()` + 动态 import `config-schema.mjs`）：`validateConfig` 返回 `{ success: true, degraded: true, diagnostics: [{ code: 'config.zod-unavailable', level: 'warning' }] }`
    4. zod 缺失时 `config-schema.mjs` 模块 import 不抛（AC-5 config 侧）
  - **注意**: 用例 3/4 需在 import config-schema **之前**设好 `SPEC_DRIVER_FORCE_ZOD_MISSING`，用 `vi.resetModules()` 清模块缓存后动态 `import()`，测试后清环境变量 + reset。
  - **完成判据**: `npx vitest run tests/unit/spec-driver-config-schema.test.ts` 全绿。

- [x] T7 扩展 `spec-driver-project-context-resolver.test.ts` — 新增"强制缺 zod → 降级路径"集成子进程用例（覆盖 AC-1、AC-3 resolver 侧、AC-5 schema 模块加载护栏）
  - **文件**: `tests/integration/spec-driver-project-context-resolver.test.ts`（扩展，新增 describe block）
  - **依赖**: T2、T4
  - **覆盖 AC**: AC-1、AC-3（resolver 侧）、AC-5
  - **用例清单**:
    1. **schema 模块加载护栏冒烟**（AC-5 核心）：子进程执行 `node -e "import('./plugins/spec-driver/scripts/lib/project-profile-schema.mjs').then(m => { process.exit(m.zodAvailable ? 1 : 0) })"` 带 `SPEC_DRIVER_FORCE_ZOD_MISSING=1` → 退出码 0，不抛 ReferenceError / MODULE_NOT_FOUND
    2. **降级路径端到端**（AC-1）：子进程 `execFileSync('node', [SCRIPT, '--project-root', root, '--json'], { env: { ...process.env, SPEC_DRIVER_FORCE_ZOD_MISSING: '1' } })` → 不抛 + 退出码 0
    3. 同上，stdout 是有效 JSON（`JSON.parse()` 不抛）
    4. 同上，`diagnostics` 含且仅含一条 `{ code: 'project-context.zod-unavailable', level: 'warning' }`
    5. 同上，`resolvedProfile` shape 与同输入正常路径等价（含 `product` / `references` / `verificationPolicy` 等关键字段非 undefined）
  - **实现提示**: 复用现有 `runResolver` helper，扩展为接受可选 `env` 参数覆盖 `process.env`。
  - **完成判据**: `npx vitest run tests/integration/spec-driver-project-context-resolver.test.ts` 全绿（含新旧用例）。

---

## Phase 5：全量验证与手工冒烟

**目标**：全量回归零失败，build 零错误，手工冒烟两个 CLI 缺 zod 路径，确认 AC-1~AC-5 全达成。

- [x] T8 [P] 全量单元+集成测试回归（覆盖 AC-3）
  - **操作**: `npx vitest run`
  - **依赖**: T5、T6、T7
  - **完成判据**: 输出 0 failed（既有测试在 zod 在场时全绿）
  - **结果**: 4558 passed；唯一失败 `watch-command.test.ts` 为已知 worktree flaky（chokidar/fsevents），经 grep 证明与本 fix 改动零依赖交集，非回归

- [x] T9 [P] build + repo:check 零错误（覆盖 AC-4）
  - **操作**: `npm run build && npm run repo:check`
  - **依赖**: T2、T3、T4
  - **完成判据**: 无 TypeScript 类型错误（`let + 末尾 export` 改造无语法问题）；`repo:check` 零错
  - **结果**: build tsc 零错误；repo:check 全 pass

- [x] T10 手工冒烟：缺 zod 下 `resolve-project-context.mjs --json`（覆盖 AC-1）
  - **操作**:
    ```bash
    SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/resolve-project-context.mjs \
      --project-root . --json ; echo "exit=$?"
    ```
  - **依赖**: T4、T8、T9
  - **完成判据**: stdout 是有效 JSON（含 `project-context.zod-unavailable` warning，仅一条）；`exit=0`

- [x] T11 手工冒烟：缺 zod 下 `validate-config.mjs --validate`（覆盖 AC-2）
  - **操作**:
    ```bash
    SPEC_DRIVER_FORCE_ZOD_MISSING=1 node plugins/spec-driver/scripts/validate-config.mjs \
      --project-root . --validate ; echo "exit=$?"
    ```
  - **依赖**: T3、T8、T9
  - **完成判据**: stderr/stdout 含 `config.zod-unavailable` warning；`exit=0`（不是 exit 1 或崩溃）

---

## Phase 6：收尾（非代码任务）

**目标**：更新 Claude memory + 上报 orchestration follow-up，完成 fix 闭环。

- [ ] T12 更新 Claude memory `project_spec_driver_plugin_cache_zod_missing` — 标注 4.x 已具备 zod 缺失降级，缓存缺 node_modules 不再硬崩，memory 可降级为 historical reference 或删除
  - **文件**: Claude memory（非代码操作）
  - **依赖**: T10、T11
  - **完成判据**: memory 内容反映 F198 已 ship 的降级能力

- [ ] T13 上报 follow-up — `contracts/orchestration-schema.mjs` 同源裸 import 风险，建议单独 fix 并复用本次 `load-zod.mjs`
  - **操作**: 在交付报告或 AGENTS.md follow-up 节记录，标注为非当前范围但优先级 medium
  - **依赖**: T10、T11
  - **完成判据**: follow-up 已在交付报告中明确记录（文件路径 + 风险描述 + 复用路径）

---

## 验收标准速查（来自 plan.md）

| AC | 验收条件 | 覆盖任务 |
|----|----------|----------|
| AC-1 | `SPEC_DRIVER_FORCE_ZOD_MISSING=1` 下 `resolve-project-context.mjs --json` 输出有效 JSON + 退出码 0 + 含 `project-context.zod-unavailable` warning（仅一条） | T4、T7、T10 |
| AC-2 | 同条件下 `validate-config.mjs --validate` 退出码 0 + 含 `config.zod-unavailable` warning | T3、T6、T11 |
| AC-3 | zod 在场时既有全量测试零失败（行为逐字节不变） | T5、T6、T7、T8 |
| AC-4 | `npm run build` + `npm run repo:check` 零错误 | T9 |
| AC-5 | schema 模块（两个）在缺 zod 时加载不抛（无 MODULE_NOT_FOUND、无 ReferenceError） | T2、T3、T7 |

---

## 依赖关系与执行顺序

### Phase 依赖链（关键路径）

```
T1（helper）
  ├─→ T2（project-profile-schema）─→ T4（resolver）─→ T7（集成测试）─→ T8、T10
  └─→ T3（config-schema）─────────→ T6（config 单测）─→ T8、T11
T5（load-zod 单测，仅依赖 T1）
T9（build/repo:check，依赖 T2/T3/T4 代码完成）
T10、T11（手工冒烟，依赖 T8+T9）
T12、T13（收尾，依赖 T10+T11）
```

### 关键路径（最长依赖链）

`T1 → T2 → T4 → T7 → T8 → T10 → T12`（共 7 步）

### 并行机会

- `T2` 与 `T3` 可并行（两个独立 schema 文件）
- `T5` 与 `T2`/`T3` 可并行（helper 单测不依赖 schema 改造完成）
- `T6` 与 `T7` 可并行（不同测试文件）
- `T8` 与 `T9` 可并行（测试回归 vs build，不互相依赖）
- `T10` 与 `T11` 可并行（两个 CLI 冒烟互不依赖）

### 实现策略（单人 fix 顺序）

1. **T1** — 新建 helper（5-10 分钟）
2. **T2 + T3** — 两个 schema 模块并行改造（可同时开两个 editor tab）
3. **T4** — resolver 降级分支（依赖 T2）
4. **T5 + T6 + T7** — 三个测试文件（T5/T6 可并行，T7 依赖 T2/T4）
5. **T8 + T9** — 全量验证（并行）
6. **T10 + T11** — 手工冒烟
7. **T12 + T13** — 收尾

---

## 注意事项

- `export const` 不能放进 `if` 块（ESM 语法限制）→ 必须用 `let + 末尾 export` 模式（T2/T3 最大陷阱）
- schema 模块的 `zodAvailable` 在模块**首次加载时**固化 → 缺失态测试最可靠方式是**子进程 + 环境变量**（T7）；同进程单测切换需 `vi.resetModules()` + 动态 import（T6）
- `__resetZodCacheForTest()` 只清 `load-zod.mjs` 内 `_cache`，不影响已加载的 schema 模块的 `zodAvailable` 固化值 → 跨态测试必须 reset 模块缓存
- `validate-config.mjs` 和 `resolve-project-context.mjs` 这两个 CLI 入口**零改动**（plan D5 已确认）
