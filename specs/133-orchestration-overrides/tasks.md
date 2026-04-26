---
feature_id: "133"
spec_version: "1.1"
plan_version: "1.0"
tasks_version: "1.0"
created_at: "2026-04-26"
total_tasks: 38
total_estimate_hours: 46
---

# Feature 133 — 任务清单：spec-driver 项目级流程定制（Per-Project Workflow Overrides）

**关联文档**：[spec.md](./spec.md) | [plan.md](./plan.md) | [clarifications.md](./clarifications.md)

---

## Group 1 — Schema 三件套（plan §2.1，DAG 步骤 1-2）

**目标**：建立 Zod schema 三件套，是所有下游模块的硬依赖。必须先完成且通过 base 兼容性熔断验证，才能继续后续步骤。

**阻塞说明**：T-001 ~ T-005 是所有后续 Group 的前置条件，必须串行完成。

---

### T-001 [x] 设计共用子 schema（phaseSchema / gateDefinitionSchema / gateOverrideSchema / modeDefinitionSchema / modeOverrideSchema / parallelGroupSchema）

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | FR-013、FR-024、NFR-006、D-PLAN-1、R11 |
| **产物** | `plugins/spec-driver/contracts/orchestration-schema.mjs`（部分：共用子 schema 定义，含 `phaseSchema`、`gateDefinitionSchema`、`gateOverrideSchema`、`modeDefinitionSchema`、`modeOverrideSchema`、`parallelGroupSchema`） |
| **完成判据** | `node -e "import('./plugins/spec-driver/contracts/orchestration-schema.mjs').then(m => console.log('子schema数量:', Object.keys(m).length))"` 输出大于 0 且无 ReferenceError；`grep -c "export" plugins/spec-driver/contracts/orchestration-schema.mjs` 不少于 6 |
| **预估** | 1.5 小时 |
| **可并行** | 串行（后续所有 schema 依赖此基础） |
| **风险** | R11（base 文件字段比预期复杂，如 `conditional`、`skip_if_exists` 等 phase 扩展字段需完整覆盖）；防御：先读取 `plugins/spec-driver/config/orchestration.yaml` 全部字段再设计 schema |

---

### T-002 [x] 实现 `orchestrationBaseSchema`（覆盖 orchestration.yaml 全部字段，含 nullable 字段处理）

| 属性 | 内容 |
|------|------|
| **依赖** | T-001 |
| **关联** | FR-013、FR-024、NFR-006、plan §2.1 陷阱 1（nullable 字段需 `.nullable()`）、R11 |
| **产物** | `plugins/spec-driver/contracts/orchestration-schema.mjs`（新增 `orchestrationBaseSchema` 导出，覆盖 `version`、`parallel_scheduling`、`gates`、`parallel_groups`、`modes` 及所有子字段） |
| **完成判据** | `node -e "import('./plugins/spec-driver/contracts/orchestration-schema.mjs').then(m => console.log(typeof m.orchestrationBaseSchema))"` 输出 `object`；schema 文件中存在 `export const orchestrationBaseSchema` |
| **预估** | 1 小时 |
| **可并行** | 串行（T-003 依赖本任务） |
| **风险** | R11（schema 约束比现有文件更严格导致 base 文件校验失败）；防御：先用 `.optional()` 宽松设计，步骤 2 校验通过后再收紧 |

---

### T-003 [x] 实现 `orchestrationOverridesSchema`（enum mode key + parallel_groups strip + 错误信息中文化）

| 属性 | 内容 |
|------|------|
| **依赖** | T-001 |
| **关联** | FR-007-A（enum 校验）、FR-013、FR-022（strip + warning）、NFR-003、CL-001、CL-010、D-PLAN-3 |
| **产物** | `plugins/spec-driver/contracts/orchestration-schema.mjs`（新增 `orchestrationOverridesSchema` 导出；`modes` key 使用 `z.object()` 显式列出 8 个 mode；`parallel_groups` 使用 `.transform(() => undefined)` strip；`$schema_version` 和 `modes.<m>.extends` 接受但不处理） |
| **完成判据** | `node -e "import('./plugins/spec-driver/contracts/orchestration-schema.mjs').then(m => { const r = m.orchestrationOverridesSchema.safeParse({version:'1.0', modes:{fxi:{phases:[]}}}); console.log(r.success) })"` 输出 `false`（enum 校验拒绝 `fxi`）；`grep "orchestrationOverridesSchema" plugins/spec-driver/contracts/orchestration-schema.mjs` 有结果 |
| **预估** | 1 小时 |
| **可并行** | 可与 T-002 并行（均依赖 T-001，但操作不同 schema，文件可分段写入后合并） |
| **风险** | CL-010（`parallel_groups` 的 strip 实现方式：`.transform(() => undefined)` 需在 `safeParse` 前先检测原始输入是否含该字段，才能发出 warning） |

---

### T-004 [x] 实现 `orchestrationMergedSchema`（复用 base schema 作为合并结果防御校验）

| 属性 | 内容 |
|------|------|
| **依赖** | T-002 |
| **关联** | FR-013、NFR-006、plan §2.1 |
| **产物** | `plugins/spec-driver/contracts/orchestration-schema.mjs`（新增 `orchestrationMergedSchema` 导出，值为 `orchestrationBaseSchema` 的别名或严格同等定义；同时完善 Zod 错误信息中文化） |
| **完成判据** | `node -e "import('./plugins/spec-driver/contracts/orchestration-schema.mjs').then(m => console.log(Object.keys(m)))"` 输出包含 `orchestrationBaseSchema`、`orchestrationOverridesSchema`、`orchestrationMergedSchema` 三个 key；文件中含中文错误消息字符串（`grep "不合法\|类型错误\|必填" plugins/spec-driver/contracts/orchestration-schema.mjs`） |
| **预估** | 0.5 小时 |
| **可并行** | 串行（需 T-002 T-003 完成后统一检查三件套导出） |
| **风险** | 无主要风险 |

---

### T-005 [x][关键熔断] 运行 base 兼容性验证，确认现有 orchestration.yaml 100% 通过 orchestrationBaseSchema

| 属性 | 内容 |
|------|------|
| **依赖** | T-002、T-004 |
| **关联** | FR-024、AC-019、R11、plan 步骤 2（关键熔断点） |
| **产物** | 无新文件；若熔断失败则返回修正 T-002 |
| **完成判据** | `node -e "import('./plugins/spec-driver/contracts/orchestration-schema.mjs').then(async m => { const {parseYamlDocument} = await import('./plugins/spec-driver/lib/simple-yaml.mjs'); const yaml = require('fs').readFileSync('./plugins/spec-driver/config/orchestration.yaml','utf-8'); const r = m.orchestrationBaseSchema.safeParse(parseYamlDocument(yaml)); console.log(r.success ? 'PASS' : JSON.stringify(r.error.issues)) })"` 输出 `PASS`；8 个 mode + 6 个 gate + 3 个 parallel_group 均通过 |
| **预估** | 0.5 小时 |
| **可并行** | 串行（此步骤是硬性关卡，失败必须退回 T-002 修正 schema） |
| **风险** | R11（最高风险点）；若失败：检查 base yaml 中哪些字段类型与 schema 不匹配，调整 schema 而非 yaml 文件 |

---

## Group 2 — Merger 实现（plan §2.3，内联于 Resolver）

**目标**：实现合并函数 `mergeOrchestrationConfigs()`，处理 modes 整段替换、gates 字段合并、parallel_scheduling 标量覆盖、fieldSources 追踪。

---

### T-006 [x] 实现 `mergeOrchestrationConfigs(base, overrides)` 主函数（含 fieldSources 生成）

| 属性 | 内容 |
|------|------|
| **依赖** | T-005 |
| **关联** | FR-004、FR-005、D-PLAN-1（内联在 resolver 中）、D-PLAN-2（fieldSources 为普通对象） |
| **产物** | `plugins/spec-driver/lib/orchestration-resolver.mjs`（内联函数 `mergeOrchestrationConfigs`，约 50 行；处理 modes 整段替换 / gates 字段合并 / parallel_scheduling 标量覆盖 / parallel_groups 保留 base 值；fieldSources Mode 级和 Gate 级精确追踪） |
| **完成判据** | 文件中含 `function mergeOrchestrationConfigs`；函数体内含注释说明 modes 整段替换语义（`grep "整段替换" plugins/spec-driver/lib/orchestration-resolver.mjs` 有结果）；`hard_gate_modes` 数组整段替换逻辑存在 |
| **预估** | 1.5 小时 |
| **可并行** | 串行（是 resolver 的核心内联依赖） |
| **风险** | R1（语义不直觉）；防御：函数顶部写明"modes 整段替换，不保留 base 其他字段；如需局部调整请用 gates.* 覆盖"的注释 |

---

## Group 3 — Resolver 实现（plan §2.2，DAG 步骤 3）

**目标**：实现 `resolveOrchestrationConfig()` 完整加载链路，覆盖所有降级路径。

---

### T-007 [x] 实现 `resolveOrchestrationConfig()` 主入口（基础路径：无 overrides 场景）

| 属性 | 内容 |
|------|------|
| **依赖** | T-005、T-006 |
| **关联** | FR-001、FR-002、FR-003、FR-008、AC-012、AC-015、NFR-001、NFR-005 |
| **产物** | `plugins/spec-driver/lib/orchestration-resolver.mjs`（导出 `resolveOrchestrationConfig`；实现读 base + base Zod 校验 + overrides 不存在时直接返回 base；返回值结构 `{ mergedConfig, fieldSources, diagnostics, isFallback, isBaseInvalid }`） |
| **完成判据** | `grep "export async function resolveOrchestrationConfig" plugins/spec-driver/lib/orchestration-resolver.mjs` 有结果；`node -e "import('./plugins/spec-driver/lib/orchestration-resolver.mjs').then(m => m.resolveOrchestrationConfig({projectRoot:'/tmp/no-overrides-dir'}).then(r => console.log(r.isFallback, r.diagnostics.length)))"` 输出 `false 0` |
| **预估** | 1.5 小时 |
| **可并行** | 串行 |
| **风险** | NFR-001（全链路 200ms 限制）；防御：避免在 resolver 中做额外文件 I/O |

---

### T-008 [x] 实现 resolver 降级路径（parse-error / version-mismatch / schema-fallback / unsupported-field）

| 属性 | 内容 |
|------|------|
| **依赖** | T-007 |
| **关联** | FR-006、FR-007、FR-007-A、FR-022、AC-005、AC-006、AC-022、AC-023、CL-007、CL-008 |
| **产物** | `plugins/spec-driver/lib/orchestration-resolver.mjs`（完善降级路径：YAML 语法错误 → parse-error warning；version 不一致 → version-mismatch warning；空/null 解析结果 → 静默 base；strip parallel_groups + unsupported-field warning；orchestrationOverridesSchema.safeParse 失败 → schema-fallback warning；所有 isFallback: true 路径） |
| **完成判据** | `grep "version-mismatch\|parse-error\|schema-fallback\|unsupported-field" plugins/spec-driver/lib/orchestration-resolver.mjs` 全部 4 个 code 均出现；`grep "isFallback: true\|isFallback = true" plugins/spec-driver/lib/orchestration-resolver.mjs` 有结果 |
| **预估** | 2 小时 |
| **可并行** | 串行（在 T-007 基础上扩展） |
| **风险** | R6（非法 overrides 搞崩工具）；防御：所有 try/catch 必须 return 而非 throw |

---

### T-009 [x] 实现 `_loadBase` 依赖注入钩子（测试可覆盖 base 加载路径）

| 属性 | 内容 |
|------|------|
| **依赖** | T-007 |
| **关联** | FR-018（T2 base 不可读场景）、AC-010、CL-011（D-PLAN-4） |
| **产物** | `plugins/spec-driver/lib/orchestration-resolver.mjs`（在函数签名中新增可选 `_loadBase` 参数；内部 `const rawBase = _loadBase ? await _loadBase() : defaultLoadBase()`；`defaultLoadBase()` 读取 `config/orchestration.yaml`） |
| **完成判据** | `grep "_loadBase" plugins/spec-driver/lib/orchestration-resolver.mjs` 有结果；函数签名含该参数 |
| **预估** | 0.5 小时 |
| **可并行** | 可与 T-008 并行（操作同一文件不同代码段，需协调合并） |
| **风险** | 无主要风险 |

---

### T-010 [x] 实现 merged config 防御性校验 + mode-overridden info diagnostic

| 属性 | 内容 |
|------|------|
| **依赖** | T-008 |
| **关联** | FR-006（第 7 行 mode-overridden）、FR-008、NFR-004 |
| **产物** | `plugins/spec-driver/lib/orchestration-resolver.mjs`（在 `mergeOrchestrationConfigs` 后追加 `orchestrationMergedSchema.safeParse(merged)` 防御校验；对 overrides 中每个 mode key 发出 `orchestration-overrides.mode-overridden` info diagnostic） |
| **完成判据** | `grep "mode-overridden\|orchestrationMergedSchema" plugins/spec-driver/lib/orchestration-resolver.mjs` 均有结果 |
| **预估** | 0.5 小时 |
| **可并行** | 串行 |
| **风险** | 无主要风险 |

---

## Group 4 — Orchestrator 改造（plan §2.4，DAG 步骤 4）

**目标**：将 `orchestrator.mjs` 中的手写 `validateOrchestrationYaml()` 迁移到 Zod schema；新增 `preloadedConfig` 注入路径（D-PLAN-6）。

**警告**：此 Group 是高回归风险区（R11/R12），务必在 T-005 熔断验证通过后才能执行。

---

### T-011 [x] 改造 `orchestrator.mjs` loadAndValidateConfig()——用 orchestrationBaseSchema.safeParse 替换手写校验

| 属性 | 内容 |
|------|------|
| **依赖** | T-005 |
| **关联** | FR-023、FR-024、AC-019、AC-020、NFR-006、CL-016 |
| **产物** | `plugins/spec-driver/lib/orchestrator.mjs`（`loadAndValidateConfig()` 中将 `validateOrchestrationYaml(parsed)` 调用替换为 `orchestrationBaseSchema.safeParse(parsed)`；`validateOrchestrationYaml()` 函数体退化为 `orchestrationBaseSchema.safeParse` 的薄壳；新增 `import { orchestrationBaseSchema } from '../contracts/orchestration-schema.mjs'`） |
| **完成判据** | `grep -n "validateOrchestrationYaml" plugins/spec-driver/lib/orchestrator.mjs` 返回的函数定义行不包含循环/遍历 modes/phases 的逻辑（仅是薄壳）；`grep "orchestrationBaseSchema.safeParse" plugins/spec-driver/lib/orchestrator.mjs` 有结果；`node scripts/orchestrator-cli.mjs validate-config 2>&1; echo "exit: $?"` 退出码 0 |
| **预估** | 1.5 小时 |
| **可并行** | 串行（高影响文件，独立执行） |
| **风险** | R11、R12（迁移引入 schema 约束不兼容）；防御：修改前备份原函数逻辑作为注释；改后立即运行现有 `node --test plugins/spec-driver/tests/orchestrator.test.mjs` |

---

### T-012 [x] 在 Orchestrator 构造函数中新增 `options.preloadedConfig` 注入路径

| 属性 | 内容 |
|------|------|
| **依赖** | T-011 |
| **关联** | FR-012、NFR-002（签名不变）、D-PLAN-6、plan §2.5 陷阱 2 |
| **产物** | `plugins/spec-driver/lib/orchestrator.mjs`（构造函数签名扩展为 `constructor(userConfig, mode, context = {}, options = {})`；若 `options.preloadedConfig` 存在则 `this.config = options.preloadedConfig; this.isFallback = false` 并跳过 `loadAndValidateConfig()`） |
| **完成判据** | `grep "preloadedConfig" plugins/spec-driver/lib/orchestrator.mjs` 有结果；`grep "constructor" plugins/spec-driver/lib/orchestrator.mjs` 显示签名含 `options = {}`；现有调用方不传第四参数的行为不变（`node --test plugins/spec-driver/tests/orchestrator.test.mjs` 全通过） |
| **预估** | 1 小时 |
| **可并行** | 串行 |
| **风险** | R11（第四参数影响现有 `new Orchestrator(config, mode, ctx)` 调用，需确认第四参数默认值为 `{}`）；防御：`options = {}` 使所有现有调用者行为完全不变 |

---

## Group 5 — CLI 改造（plan §2.5，DAG 步骤 7）

**目标**：改造 `orchestrator-cli.mjs`：（1）所有现有命令集中调用 resolver；（2）新增 `effective-orchestration` 子命令含全部选项。

---

### T-013 [x] 改造现有 CLI 命令，统一调用 resolveOrchestrationConfig() 并传入 preloadedConfig

| 属性 | 内容 |
|------|------|
| **依赖** | T-007、T-012 |
| **关联** | FR-012、NFR-002（构造函数签名不变）、AC-007、AC-011 |
| **产物** | `plugins/spec-driver/scripts/orchestrator-cli.mjs`（所有现有 command handler：`get-phases`、`get-gate-behavior`、`get-parallel-groups`、`validate-config`、`evaluate-condition` 在构造 `Orchestrator` 前先调用 `resolveOrchestrationConfig()`，将 `mergedConfig` 通过 `options.preloadedConfig` 注入；新增 `import { resolveOrchestrationConfig }`） |
| **完成判据** | `grep "resolveOrchestrationConfig" plugins/spec-driver/scripts/orchestrator-cli.mjs` 出现次数 >= 5（每个命令各一次，或统一封装一次）；`node scripts/orchestrator-cli.mjs get-phases feature 2>&1; echo "exit: $?"` 退出码 0，行为与改造前一致 |
| **预估** | 2 小时 |
| **可并行** | 串行 |
| **风险** | R12（现有命令回归）；防御：改造后立即运行 `node --test plugins/spec-driver/tests/orchestrator.test.mjs` |

---

### T-014 [x] 新增 `effective-orchestration` 子命令 case（参数解析 + resolver 调用）

| 属性 | 内容 |
|------|------|
| **依赖** | T-013 |
| **关联** | FR-009、FR-010、FR-011、AC-001、AC-002、AC-003、AC-004 |
| **产物** | `plugins/spec-driver/scripts/orchestrator-cli.mjs`（在 `switch(command)` 中新增 `case 'effective-orchestration'`；解析 `<mode>`、`--annotate`、`--diff`、`--format yaml|json`、`--project-root` 参数；调用 `cmdEffectiveOrchestration(mode, options)`） |
| **完成判据** | `grep "effective-orchestration" plugins/spec-driver/scripts/orchestrator-cli.mjs` 有结果；`node scripts/orchestrator-cli.mjs effective-orchestration feature 2>&1; echo "exit: $?"` 退出码 0，stdout 有内容 |
| **预估** | 1 小时 |
| **可并行** | 串行（依赖 T-013 的统一 resolver 调用框架） |
| **风险** | 无主要风险 |

---

### T-015 [x] 实现 `--format yaml` 默认输出和 `--format json` 结构体输出

| 属性 | 内容 |
|------|------|
| **依赖** | T-014 |
| **关联** | FR-010、AC-003 |
| **产物** | `plugins/spec-driver/scripts/orchestrator-cli.mjs`（`cmdEffectiveOrchestration` 函数：`--format yaml` 输出 modes + gates 的 YAML；`--format json` 输出 `{ config: mergedConfig, fieldSources, diagnostics }` JSON；diagnostics 非空时输出到 stderr） |
| **完成判据** | `node scripts/orchestrator-cli.mjs effective-orchestration feature --format json 2>/dev/null | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8'); const j=JSON.parse(d); console.log('config' in j && 'fieldSources' in j && 'diagnostics' in j)"` 输出 `true` |
| **预估** | 1 小时 |
| **可并行** | 串行 |
| **风险** | 无主要风险 |

---

### T-016 [x] 实现 `--annotate` YAML 输出（手写带 source 注释的序列化，约 30-40 行）

| 属性 | 内容 |
|------|------|
| **依赖** | T-015 |
| **关联** | FR-010、AC-002、D-PLAN-5（手写序列化），R4（`locked - will not inherit plugin updates` 提示） |
| **产物** | `plugins/spec-driver/scripts/orchestrator-cli.mjs`（`serializeWithAnnotations(config, fieldSources)` 函数约 35 行；每个 Mode 级 key 追加 `# source: base|overrides (locked - will not inherit plugin updates)`；每个 Gate 级 key 追加 `# source: base|overrides`；`--diff` 优先于 `--annotate`） |
| **完成判据** | `node scripts/orchestrator-cli.mjs effective-orchestration feature --annotate 2>/dev/null | grep "# source:"` 有输出；字符串含 `# source: base` 或 `# source: overrides` |
| **预估** | 1.5 小时 |
| **可并行** | 串行 |
| **风险** | D-PLAN-5（手写 YAML 序列化复杂度）；防御：仅序列化 modes 和 gates 两个顶层 key，不需要全量序列化 |

---

### T-017 [x] 实现 `--diff` 输出（仅展示被 overrides 改变的字段路径与新旧值）

| 属性 | 内容 |
|------|------|
| **依赖** | T-015 |
| **关联** | FR-010、AC-004 |
| **产物** | `plugins/spec-driver/scripts/orchestrator-cli.mjs`（`formatDiff(fieldSources, base, merged)` 函数：仅输出 fieldSources 中值为 `"overrides"` 的路径；modes 路径显示 `base phases: N, overrides phases: M`；gates 路径显示字段变化值；`--diff` 优先于 `--annotate`） |
| **完成判据** | 构造含 overrides 的测试目录后：`node scripts/orchestrator-cli.mjs effective-orchestration fix --diff 2>/dev/null | grep "modes.fix"` 有结果；`node scripts/orchestrator-cli.mjs effective-orchestration fix --diff 2>/dev/null | grep "modes.feature"` 无结果（未变更字段不出现） |
| **预估** | 1 小时 |
| **可并行** | 可与 T-016 并行（均在 T-015 基础上添加新函数，不互相覆盖） [P] |
| **风险** | R1（diff 输出需清晰展示整段替换语义，显示 phase 数量差异） |

---

## Group 6 — Validator + repo:check 集成（plan §2.6/2.7，DAG 步骤 9-10）

**目标**：实现 `validateOrchestrationOverrides()` 校验器并接入 `repo-maintenance-core.mjs`。

---

### T-018 [x] 实现 `validateOrchestrationOverrides({ projectRoot })` 校验器

| 属性 | 内容 |
|------|------|
| **依赖** | T-007 |
| **关联** | FR-016、AC-008、AC-009、R3 |
| **产物** | `plugins/spec-driver/scripts/validate-orchestration-overrides.mjs`（导出 `validateOrchestrationOverrides({ projectRoot })`；内部调用 `resolveOrchestrationConfig()`；根据 `diagnostics` level 生成 `{ status: "ok"|"warning"|"error", checks: [], warnings: [], errors: [] }`；`createCheck()` 对象格式与 `repo-maintenance-core.mjs` 的 `aggregateValidation` 兼容） |
| **完成判据** | `node -e "import('./plugins/spec-driver/scripts/validate-orchestration-overrides.mjs').then(m => m.validateOrchestrationOverrides({projectRoot: process.cwd()}).then(r => console.log(r.status)))"` 输出 `ok` 或 `error`；`grep "export" plugins/spec-driver/scripts/validate-orchestration-overrides.mjs` 含 `validateOrchestrationOverrides` |
| **预估** | 1.5 小时 |
| **可并行** | 可与 Group 5 并行（依赖 T-007 而非 Group 5 的任务） [P] |
| **风险** | R3（接口格式必须严格匹配 `aggregateValidation` 期望）；防御：实现前阅读 `scripts/lib/repo-maintenance-core.mjs` 第 163-173 行的 `aggregateValidation` 实现，确认 check 对象格式 `{ id, title, status, evidence }` |

---

### T-019 [x] 接入 `repo-maintenance-core.mjs`（追加 aggregateValidation 调用）

| 属性 | 内容 |
|------|------|
| **依赖** | T-018 |
| **关联** | FR-017、AC-008、AC-009、R3 |
| **产物** | `scripts/lib/repo-maintenance-core.mjs`（在 `validateRepository()` 末尾、`return` 前追加 `aggregateValidation('orchestration-overrides', await validateOrchestrationOverrides({projectRoot: resolvedRoot}), warnings, errors, checks)`；文件顶部新增 `import { validateOrchestrationOverrides }`） |
| **完成判据** | `grep "orchestration-overrides" scripts/lib/repo-maintenance-core.mjs` 有结果；`npm run repo:check 2>&1; echo "exit: $?"` 退出码 0（现有项目无 overrides 文件时）；`grep "validateOrchestrationOverrides" scripts/lib/repo-maintenance-core.mjs` 有结果 |
| **预估** | 1 小时 |
| **可并行** | 串行（R3 高影响，单独执行并立即验证） |
| **风险** | R3（该文件是核心同步链路，改错会中断整个 repo:check）；防御：改动仅追加 3-4 行，改后立即运行 `npm run repo:check` 验证零回归 |

---

## Group 7 — 测试矩阵（plan §2.10，DAG 步骤 5-6-8-11）

**目标**：建立完整测试覆盖，包括 T1/T2/T3/T4 四组，以及 orchestrator.test.mjs 增量断言。

---

### T-020 [x] 创建测试 fixture 目录和辅助函数（createTempProjectDir + fixture YAML 文件）

| 属性 | 内容 |
|------|------|
| **依赖** | T-004 |
| **关联** | FR-018、AC-010、D-PLAN-7（fixture 独立目录） |
| **产物** | `plugins/spec-driver/tests/fixtures/orchestration/`（目录 + 文件：`valid-overrides-gate.yaml`、`valid-overrides-mode-fix.yaml`、`valid-overrides-parallel-scheduling.yaml`、`invalid-yaml-syntax.yaml`、`invalid-schema-bad-mode.yaml`、`version-mismatch-overrides.yaml`、`overrides-with-parallel-groups.yaml`）；`plugins/spec-driver/tests/orchestration-resolver.test.mjs`（框架 + `createTempProjectDir()` 辅助函数） |
| **完成判据** | `ls plugins/spec-driver/tests/fixtures/orchestration/` 列出 7 个 YAML 文件；`grep "createTempProjectDir" plugins/spec-driver/tests/orchestration-resolver.test.mjs` 有结果 |
| **预估** | 1 小时 |
| **可并行** | 可与 Group 5 并行（不依赖 CLI 实现）[P] |
| **风险** | 无主要风险 |

---

### T-021 [x] 编写 T1 合并测试（≥6 用例）

| 属性 | 内容 |
|------|------|
| **依赖** | T-007、T-020 |
| **关联** | FR-004、FR-005、AC-010、AC-015 |
| **产物** | `plugins/spec-driver/tests/orchestration-resolver.test.mjs`（T1 组：① 无 overrides → fieldSources 全为 base；② modes.fix 整段替换；③ gates.GATE_DESIGN 字段合并；④ parallel_scheduling 标量覆盖；⑤ fieldSources 两级标记正确；⑥ merged config 通过 orchestrationMergedSchema 校验） |
| **完成判据** | `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs 2>&1 | grep "T1"` 显示 ≥6 个 pass；零 fail |
| **预估** | 1.5 小时 |
| **可并行** | 串行（依赖 T-007 resolver 实现） |
| **风险** | R5（测试框架不一致）；防御：确认 `node --test` 能识别该文件 |

---

### T-022 [x] 编写 T2 降级路径测试（≥5 用例）

| 属性 | 内容 |
|------|------|
| **依赖** | T-008、T-009、T-020 |
| **关联** | FR-006、FR-007、FR-007-A、AC-005、AC-006、AC-007、AC-022、AC-023 |
| **产物** | `plugins/spec-driver/tests/orchestration-resolver.test.mjs`（T2 组：① overrides 不存在 → 无 diagnostic；② YAML 语法错误 → parse-error + isFallback: true；③ 非 reserved mode 名 `fxi` → schema-fallback + isFallback: true；④ version 不一致 → version-mismatch + isFallback: true；⑤ `_loadBase` 注入抛异常 → base-invalid error + isBaseInvalid: true；附加：parallel_groups strip → unsupported-field warning 且其余字段生效） |
| **完成判据** | `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs 2>&1 | grep "T2"` 显示 ≥5 个 pass；零 fail；特别验证 `grep "version-mismatch\|schema-fallback\|parse-error\|base-invalid\|unsupported-field"` 均出现在测试断言中 |
| **预估** | 2 小时 |
| **可并行** | 可与 T-021 并行（测试不同组，在同一文件不同代码段追加）[P] |
| **风险** | R6（降级路径复杂，确保每条路径均有独立断言） |

---

### T-023 [x] 编写 T4 base Zod 兼容性回归测试（≥3 用例）

| 属性 | 内容 |
|------|------|
| **依赖** | T-011、T-020 |
| **关联** | FR-024、FR-025、AC-019、AC-021、R11、R12 |
| **产物** | `plugins/spec-driver/tests/orchestration-resolver.test.mjs`（T4 组：① 现有 orchestration.yaml 通过 orchestrationBaseSchema.safeParse（所有 8 mode + 6 gate + 3 parallel_group）；② 无 overrides 时 `Orchestrator.getPhases("feature")` 结果与迁移前一致；③ orchestrationBaseSchema 校验失败场景（通过 `_loadBase` 注入损坏数据）正确触发 base-invalid） |
| **完成判据** | `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs 2>&1 | grep "T4"` 显示 ≥3 个 pass；零 fail |
| **预估** | 1.5 小时 |
| **可并行** | 可与 T-021、T-022 并行（独立 T4 测试组）[P] |
| **风险** | R11、R12；防御：T4 ① 是最关键的回归保证，必须完整覆盖所有 8 个 mode |

---

### T-024 [x] 编写 T3 CLI dry-run 测试（≥4 用例）

| 属性 | 内容 |
|------|------|
| **依赖** | T-013、T-014、T-015、T-016、T-017、T-020 |
| **关联** | FR-009、FR-010、FR-011、AC-002、AC-003、AC-004 |
| **产物** | `plugins/spec-driver/tests/orchestration-resolver.test.mjs`（T3 组：① `--format yaml` 默认输出结构；② `--format json` 含 fieldSources 结构体且是合法 JSON；③ `--annotate` 输出含 `# source: base|overrides`；④ `--diff` 仅显示变更字段路径且 `modes.feature` 不出现） |
| **完成判据** | `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs 2>&1 | grep "T3"` 显示 ≥4 个 pass；零 fail |
| **预估** | 1.5 小时 |
| **可并行** | 串行（依赖 CLI 实现完成） |
| **风险** | R5（CLI 子进程调用在 node:test 中需使用 `child_process.spawnSync`）；防御：T3 通过 `spawnSync` 调用 CLI 进程并断言 stdout/stderr/exitCode |

---

### T-025 [x] 在 orchestrator.test.mjs 增量补充 base Zod 校验断言

| 属性 | 内容 |
|------|------|
| **依赖** | T-011 |
| **关联** | FR-025、AC-021、R12 |
| **产物** | `plugins/spec-driver/tests/orchestrator.test.mjs`（追加 ≥2 条断言：① base 通过 orchestrationBaseSchema（正向路径）；② orchestrationBaseSchema 校验失败时 Orchestrator 降级到 generateFallbackConfig()（通过 mock loadAndValidateConfig 测试）） |
| **完成判据** | `node --test plugins/spec-driver/tests/orchestrator.test.mjs 2>&1 | tail -5` 显示零 fail；`grep "orchestrationBaseSchema\|base.*Zod" plugins/spec-driver/tests/orchestrator.test.mjs` 有结果 |
| **预Estimate** | 1 小时 |
| **可并行** | 可与 T-021/T-022 并行（不同文件）[P] |
| **风险** | R12（增量测试不应破坏现有测试）；防御：仅追加，不修改现有测试用例 |

---

## Group 8 — 文档与示例（plan §2.8/2.9/2.11/2.12，DAG 步骤 12-13）

**目标**：生成人读合同、示例文件、agent 约定片段及 project-context 旁注。可与 Group 5-7 并行执行。

---

### T-026 [x] 编写 `orchestration-overrides-contract.yaml`（人读合同文档）[P]

| 属性 | 内容 |
|------|------|
| **依赖** | 无（内容可独立撰写） |
| **关联** | FR-015、AC-014（间接）、CL-015（与 spec-driver.config.yaml 分工说明） |
| **产物** | `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`（~50 行；含：`title`、`description`、`canonical_schema`、`supported_overrides` 列表（字段+合并语义+约束）、`diagnostic_codes` 清单、`vs_spec_driver_config` 分工说明、`examples_path`、`out_of_scope` 列表；参考 `wrapper-source-of-truth.yaml` 风格） |
| **完成判据** | `ls plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` 文件存在；`grep "parallel_scheduling\|modes\|gates\|vs_spec_driver_config" plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` 均有结果；行数 `wc -l` >= 40 |
| **预估** | 1 小时 |
| **可并行** | [P]（无实现依赖，可与 Group 5-7 并行） |
| **风险** | 无主要风险 |

---

### T-027 [x] 编写 `orchestration-overrides.example.yaml`（三场景示例，含丰富注释）[P]

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | FR-019、AC-014、R1（example 必须展示完整 phases 数组）、R2（YAML anchor 限制说明） |
| **产物** | `plugins/spec-driver/templates/orchestration-overrides.example.yaml`（~60 行；场景 1：GATE_DESIGN behavior 调整；场景 2：fix mode 整段裁剪（含完整 phases 数组示例）；场景 3：parallel_scheduling.max_concurrent_tasks 收紧；每个场景含中文注释说明语义；注释提醒 YAML anchor 不支持） |
| **完成判据** | `ls plugins/spec-driver/templates/orchestration-overrides.example.yaml` 文件存在；`grep "GATE_DESIGN\|max_concurrent_tasks\|modes.fix\|anchor" plugins/spec-driver/templates/orchestration-overrides.example.yaml` 均有结果 |
| **预估** | 1 小时 |
| **可并行** | [P]（无实现依赖） |
| **风险** | R1（示例的 modes.fix 必须包含真实的完整 phases 数组，否则误导用户）；防御：从 orchestration.yaml 复制真实 fix mode phases 后裁剪为 2 个 |

---

### T-028 [x] 编写 `docs/shared/agent-orchestration-overrides.md`（agent 约定共享片段）[P]

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | FR-020、AC-017、CL-013（仅 1-3 条 agent 约定，不含用户操作指引） |
| **产物** | `docs/shared/agent-orchestration-overrides.md`（~20 行；含 3 条 agent 约定：自动感知约定、职责分工约定、schema 位置约定；文件头含 docs:sync:agents 同步标记注释） |
| **完成判据** | `ls docs/shared/agent-orchestration-overrides.md` 文件存在；`grep "orchestration-overrides.yaml" docs/shared/agent-orchestration-overrides.md` 有结果；行数 `wc -l` <= 30 |
| **预估** | 0.5 小时 |
| **可并行** | [P] |
| **风险** | 无主要风险 |

---

### T-029 [x] 运行 `npm run docs:sync:agents` 将 agent 约定同步到 AGENTS.md / CLAUDE.md[P]

| 属性 | 内容 |
|------|------|
| **依赖** | T-028 |
| **关联** | FR-020、AC-017 |
| **产物** | `AGENTS.md` 和项目根 `CLAUDE.md` 含新增 orchestration-overrides 约定片段 |
| **完成判据** | `npm run docs:sync:agents 2>&1; echo "exit: $?"` 退出码 0；`grep "orchestration-overrides.yaml" AGENTS.md` 有结果；`grep "orchestration-overrides.yaml" CLAUDE.md` 有结果 |
| **预估** | 0.5 小时 |
| **可并行** | 串行（依赖 T-028） |
| **风险** | 无主要风险 |

---

### T-030 [x] 更新 `.specify/project-context.yaml` forbidden_changes 旁注[P]

| 属性 | 内容 |
|------|------|
| **依赖** | 无 |
| **关联** | FR-021、AC-018 |
| **产物** | `.specify/project-context.yaml`（在 `forbidden_changes` 列表追加 1 条：`"流程结构覆盖（phases/gates）应放 .specify/orchestration-overrides.yaml，不进 Project Context；行为偏好放 .specify/spec-driver.config.yaml。"`） |
| **完成判据** | `grep "orchestration-overrides" .specify/project-context.yaml` 有结果 |
| **预估** | 0.5 小时 |
| **可并行** | [P]（极小改，无实现依赖） |
| **风险** | 无 |

---

## Group 9 — 端到端验证（plan §3，DAG 步骤 14）

**目标**：执行全量 AC 验证，确保所有 23 条 AC 通过，所有检查命令零失败。

---

### T-031 [x] 构造端到端测试场景（合法 overrides 目录 + 非法 overrides 目录）

| 属性 | 内容 |
|------|------|
| **依赖** | T-013、T-014、T-015、T-016、T-017 |
| **关联** | AC-001 ~ AC-009、AC-011、SC-001 ~ SC-006 |
| **产物** | 临时测试目录（不长期保留）：`/tmp/e2e-valid-overrides/`（含合法 overrides，fix 裁剪为 2 phase + GATE_DESIGN behavior: auto）；`/tmp/e2e-invalid-overrides/`（含 YAML 语法错误的 overrides）；`/tmp/e2e-schema-fallback/`（含非 reserved mode 名 `fxi` 的 overrides） |
| **完成判据** | 目录创建成功；`ls /tmp/e2e-valid-overrides/.specify/orchestration-overrides.yaml` 存在 |
| **预估** | 0.5 小时 |
| **可并行** | 串行 |
| **风险** | 无 |

---

### T-032 [x] 验证 AC-001 ~ AC-007（P1 User Stories 验收）

| 属性 | 内容 |
|------|------|
| **依赖** | T-031 |
| **关联** | AC-001（get-phases fix）、AC-002（--annotate）、AC-003（--format json）、AC-004（--diff）、AC-005（parse-error）、AC-006（schema-fallback）、AC-007（无 overrides 静默）、US1/US2/US3 |
| **产物** | 无新文件；全部 7 条 AC 通过的验证记录 |
| **完成判据** | AC-001: `node scripts/orchestrator-cli.mjs get-phases fix 2>/dev/null` 返回 2 个 phase；AC-002: stdout 含 `# source: overrides`；AC-003: stdout 是合法 JSON 含 `"fieldSources"` key；AC-004: stdout 含 `modes.fix` 且不含 `modes.feature`；AC-005/006: 退出码 0 且 stderr 含对应 code；AC-007: stderr 无 orchestration-overrides 相关输出 |
| **预估** | 1.5 小时 |
| **可并行** | 串行 |
| **风险** | 综合风险；任何 AC 失败返回对应 Group 修复 |

---

### T-033 [x] 验证 AC-008 ~ AC-009（US6 repo:check 集成）

| 属性 | 内容 |
|------|------|
| **依赖** | T-019、T-031 |
| **关联** | AC-008（合法 overrides → repo:check 通过）、AC-009（非法 overrides → 退出码非零）、US6 |
| **产物** | 无新文件 |
| **完成判据** | AC-008: 合法 overrides 下 `npm run repo:check 2>&1; echo "exit: $?"` 退出码 0 且输出含 `orchestration-overrides` check 通过；AC-009: 非法 overrides 下退出码非零且输出含字段路径错误指引 |
| **预估** | 1 小时 |
| **可并行** | 串行 |
| **风险** | R3（repo:check 整体链路影响） |

---

### T-034 [x] 验证 AC-011、AC-015 ~ AC-018（兼容性 + 文档 AC）

| 属性 | 内容 |
|------|------|
| **依赖** | T-024、T-028、T-029、T-030 |
| **关联** | AC-011、AC-015、AC-016（200ms 性能）、AC-017（docs:sync）、AC-018（project-context） |
| **产物** | 无新文件 |
| **完成判据** | AC-011: `node scripts/orchestrator-cli.mjs effective-orchestration feature` 与 `get-phases feature` 结果一致；AC-015: 无 overrides 时 `isFallback: false` 且 `diagnostics: []`；AC-016: `time node -e "import('./lib/orchestration-resolver.mjs').then(m => m.resolveOrchestrationConfig({projectRoot:'/tmp'}))"` 实际时间 < 200ms；AC-017: `grep "orchestration-overrides.yaml" AGENTS.md` 有结果；AC-018: `grep "orchestration-overrides" .specify/project-context.yaml` 有结果 |
| **预估** | 1 小时 |
| **可并行** | 串行 |
| **风险** | NFR-001（性能不达标时需优化 I/O 路径） |

---

### T-035 [x] 验证 AC-019 ~ AC-023（schema 迁移 + 专属 diagnostic code AC）

| 属性 | 内容 |
|------|------|
| **依赖** | T-011、T-012 |
| **关联** | AC-019（base Zod 校验通过）、AC-020（validateOrchestrationYaml 退化）、AC-021（现有测试全通过）、AC-022（version-mismatch 专属 code）、AC-023（parallel_groups strip 不整体失效） |
| **产物** | 无新文件 |
| **完成判据** | AC-019: `node scripts/orchestrator-cli.mjs validate-config 2>&1; echo "exit: $?"` 退出码 0；AC-020: `grep "validateOrchestrationYaml" plugins/spec-driver/lib/orchestrator.mjs` 返回的定义不含循环/遍历逻辑；AC-021: `node --test plugins/spec-driver/tests/orchestrator.test.mjs 2>&1 | grep "fail"` 无结果；AC-022: 带 version-mismatch 的场景下 stderr 含 `orchestration-overrides.version-mismatch` 而非 `schema-fallback`；AC-023: 含 `parallel_groups` 的 overrides 中合法 gate 覆盖仍生效 |
| **预估** | 1 小时 |
| **可并行** | 串行 |
| **风险** | R12（任何 orchestrator 回归） |

---

### T-036 [x] 全量测试套件运行（零失败关卡）

| 属性 | 内容 |
|------|------|
| **依赖** | T-021、T-022、T-023、T-024、T-025 |
| **关联** | AC-010、AC-021、NFR-007、R5（测试框架不一致） |
| **产物** | 无新文件 |
| **完成判据** | `npm run lint 2>&1; echo "lint: $?"` 退出码 0；`npm run build 2>&1; echo "build: $?"` 退出码 0；`npx vitest run 2>&1; echo "vitest: $?"` 退出码 0；`node --test plugins/spec-driver/tests/ 2>&1; echo "nodetest: $?"` 退出码 0（或 `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs plugins/spec-driver/tests/orchestrator.test.mjs`） |
| **预估** | 1 小时 |
| **可并行** | 串行（最终关卡） |
| **风险** | R5（vitest 是否识别 `.test.mjs` 文件）；防御：确认 vitest 配置中 `testMatch` 或 `include` 的覆盖范围 |

---

### T-037 全量 repo:check + release:check 检查（零失败关卡）

| 属性 | 内容 |
|------|------|
| **依赖** | T-019、T-036 |
| **关联** | AC-008、NFR-007、SC-005 |
| **产物** | 无新文件 |
| **完成判据** | `npm run repo:check 2>&1; echo "exit: $?"` 退出码 0（无 overrides 文件的项目）；`npm run release:check 2>&1; echo "exit: $?"` 退出码 0（确认 release 合同未受影响） |
| **预估** | 0.5 小时 |
| **可并行** | 串行 |
| **风险** | R3（repo:check 影响）；防御：T-019 已单独验证 |

---

### T-038 清理临时测试目录并提交最终验证状态

| 属性 | 内容 |
|------|------|
| **依赖** | T-032、T-033、T-034、T-035、T-036、T-037 |
| **关联** | SC-001 ~ SC-006（全部成功标准达成） |
| **产物** | 临时目录清理；最终 `npm run repo:check` 零失败确认 |
| **完成判据** | `rm -rf /tmp/e2e-*`；`npm run repo:check 2>&1; echo "exit: $?"` 退出码 0；所有 11 个源码文件（4 改造 + 7 新增）均存在且内容符合 spec 约定 |
| **预估** | 0.5 小时 |
| **可并行** | 串行 |
| **风险** | 无 |

---

## FR 覆盖映射表

| FR 编号 | 关联 Task |
|--------|----------|
| FR-001 | T-007 |
| FR-002 | T-007、T-008 |
| FR-003 | T-007、T-008（CL-007 空文件场景） |
| FR-004 | T-006（merger 合并语义） |
| FR-005 | T-006（fieldSources 生成） |
| FR-006 | T-008（降级路径四类） |
| FR-007 | T-008（version-mismatch）、CL-008 |
| FR-007-A | T-003（enum 校验）、T-008 |
| FR-008 | T-010（diagnostics 全部传出） |
| FR-009 | T-014 |
| FR-010 | T-014、T-015、T-016、T-017 |
| FR-011 | T-014（退出码约定） |
| FR-012 | T-013（所有现有命令走 resolver） |
| FR-013 | T-001、T-002、T-003、T-004 |
| FR-014 | T-003（$schema_version / extends 预留） |
| FR-015 | T-026 |
| FR-016 | T-018 |
| FR-017 | T-019 |
| FR-018 | T-020、T-021、T-022、T-023、T-024 |
| FR-019 | T-027 |
| FR-020 | T-028、T-029 |
| FR-021 | T-030 |
| FR-022 | T-003（strip）、T-008（unsupported-field warning） |
| FR-023 | T-011 |
| FR-024 | T-002、T-005 |
| FR-025 | T-011、T-012、T-025 |

**覆盖率**：25/25 条 FR 全部覆盖（100%）

---

## 汇总统计

| 维度 | 数值 |
|------|------|
| **总 Task 数** | 38 个 |
| **总预估工时** | 46 小时 |
| **可并行 Task 数** | 10 个（[P] 标记，约 26%） |
| **高风险 Task** | T-005、T-011、T-012、T-019 |
| **新增文件** | 7 个 |
| **改造文件** | 4 个 |

---

## 关键串行链路（DAG 关键路径）

以下链路上任意一步失败必须停止，修复后才能继续：

```
T-001（子 schema）
  → T-002（orchestrationBaseSchema）
  → T-005（[熔断] base 兼容性验证）  ← 最关键节点
    → T-006（merger）
    → T-007（resolver 基础路径）
    → T-008（resolver 降级路径）
    → T-010（防御校验 + mode-overridden）
    → T-021（T1 合并测试）
    → T-022（T2 降级测试）

T-005
  → T-011（orchestrator.mjs 校验迁移）  ← 高回归风险节点
  → T-012（preloadedConfig 注入）
  → T-013（CLI 现有命令改造）
  → T-014（effective-orchestration case）
  → T-015（format yaml/json 输出）
  → T-016（--annotate 输出）
  → T-024（T3 CLI 测试）

T-018（validator）
  → T-019（repo-maintenance-core 接入）  ← 高影响节点
  → T-033（AC-008/009 验证）
```

---

## 关键并行机会（implement 阶段执行建议）

| 并行批次 | 可同时进行的 Task | 说明 |
|---------|----------------|------|
| **批次 1** | T-001（串行，最先开始） | 无依赖，立即开始 |
| **批次 2** | T-002 + T-003 | 均依赖 T-001，操作 schema 文件不同 export |
| **批次 3**（等待 T-005 熔断通过后） | T-006 / T-026 / T-027 / T-028 / T-030 | 文档类（T-026/027/028/030）无实现依赖 |
| **批次 4** | T-007 + T-011 + T-020 | resolver 基础路径 / orchestrator 改造 / fixture 准备 |
| **批次 5** | T-008 + T-009 + T-018 + T-021 + T-023 + T-025 | resolver 降级路径 / validator / 测试组 T1/T4/orchestrator 增量 |
| **批次 6** | T-013 + T-022 | CLI 改造 / T2 测试（独立） |
| **批次 7** | T-016 + T-017 | --annotate 和 --diff 输出实现（均在 T-015 基础上） |

**MVP 建议范围（最小验证路径）**：T-001 → T-005（熔断）→ T-006 → T-007 → T-008 → T-021 → T-022 → T-011 → T-012 → T-013 → T-014 → T-015（对应 US1 + US2 + US3 的 P1 核心能力验收）

---

## 高风险 Task 清单

| Task | 关联风险 | 防御措施摘要 |
|------|---------|------------|
| **T-005**（base 兼容性熔断） | R11 | 失败必须退回 T-002 修正 schema，不得强行继续 |
| **T-011**（orchestrator.mjs 迁移） | R11、R12 | 改前保留原函数逻辑作注释；改后立即运行现有测试 |
| **T-012**（preloadedConfig 注入） | R11 | options 默认 `{}` 确保现有调用方零影响 |
| **T-019**（repo-maintenance-core 接入） | R3 | 接口格式严格匹配 `{ status, checks, warnings, errors }`；改后立即 `npm run repo:check` |
| **T-013**（CLI 现有命令改造） | R12 | 改造后运行 `node --test tests/orchestrator.test.mjs` 全通过 |
| **T-016**（--annotate 手写 YAML 序列化） | D-PLAN-5 | 仅序列化 modes + gates，不全量序列化 mergedConfig |
