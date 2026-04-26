# 技术调研报告: Feature 133 — Per-Project Orchestration Overrides

**特性分支**: `claude/wonderful-chatterjee-22066e`
**调研日期**: 2026-04-26
**调研模式**: 独立模式（未参考产品调研结论）
**产品调研基础**: 无（product-research.md 不存在）

> [独立模式] 本次技术调研未参考产品调研结论，直接基于 Feature 设计前提和代码库扫描执行。

---

## 1. 调研目标

**核心问题**:
- `Orchestrator` 类的构造函数如何加载配置？现有 extension point 在哪里？
- `project-profile-resolver.mjs` 的分层加载模式能否直接复用为 overrides 加载范本？
- `config-schema.mjs` 中的 `resolveEffectiveConfig` source map 机制能否迁移到 orchestration 层？
- `simple-yaml.mjs` 的能力边界是否满足 overrides 文件解析需求（含错误报告）？
- 深合并（deep merge）在仓库内的惯例是什么？数组合并语义如何？
- 如何将新 schema 纳入 `npm run repo:check` 而不破坏现有校验链路？

**需求 MVP 范围（来自 Feature 设计前提）**:
- 新增 `.specify/orchestration-overrides.yaml`，加载序：base → overrides → 深合并 → Zod 校验
- 支持 Mode 整段重写和 Gate 行为覆盖两种粒度
- 校验失败时回退 base + 打 warning 级 diagnostic
- CLI 子命令展示 effective orchestration（含 source map）
- Schema 沉淀进 `contracts/`，纳入 `repo:check`

---

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: 构造函数扩展（注入 overrides 路径） | 方案 B: Wrapper / Factory 函数 | 方案 C: 静态合并预处理（CLI 层合并后再实例化） |
|------|------|------|------|
| 概述 | 给 `Orchestrator` 构造函数加第 4 个参数 `overridesPath?:string`，在 `loadAndValidateConfig()` 内部完成合并 | 新增 `createOrchestrator(mode, options)` factory，外部完成加载+合并后把 merged config 传入构造函数 | 在 orchestrator-cli.mjs 层加载两份 YAML 并合并，构造函数只接收最终 config 对象 |
| 可维护性 | 中——合并逻辑深入构造函数，增加内部复杂度 | 高——分离关注点，构造函数保持不变，factory 可独立测试 | 中——CLI 层越来越重，与 lib 层职责模糊 |
| 测试性 | 需要 mock 文件系统，或传 configContent 字符串 | 最优——factory 可 unit test，Orchestrator 本身不变 | 需要测试 CLI 的合并逻辑，与 CLI 命令测试耦合 |
| 对现有代码改动量 | 小改 `lib/orchestrator.mjs` | 新增 `lib/orchestrator-factory.mjs` | 大改 `scripts/orchestrator-cli.mjs` |
| 与 project-profile-resolver 对齐度 | 低——resolver 是独立函数，不是类 | 高——factory 与 resolver 模式一致（纯函数，返回 resolved 结果） | 低 |
| Source map 实现难度 | 中——需在内部合并时记录字段来源 | 低——factory 的返回值可以同时包含 mergedConfig + fieldSources | 中——需要在 CLI 层额外传递来源信息 |
| 适用规模 | 单用户场景足够 | 多调用方场景（CLI + 测试 + 未来 API） | 适合一次性 CLI 工具 |

### 推荐方案

**推荐**: 方案 B — Wrapper / Factory 函数

**理由**:
1. `project-profile-resolver.mjs` 已经提供了一个成熟的范本：`resolveProjectContext({ projectRoot })` 返回 `{ resolvedProfile, fieldSources, diagnostics }`。orchestration 层可以完全镜像这个模式，新建 `lib/orchestration-resolver.mjs`，导出 `resolveOrchestrationConfig({ projectRoot, mode, userConfig })`。
2. `Orchestrator` 类的构造函数签名（`Orchestrator(userConfig, mode, context)`）保持不变——存量调用方（8 个 SKILL.md、orchestrator-cli.mjs、orchestrator.test.mjs）无需修改。
3. Factory 返回的 `fieldSources` 对象（`{ [fieldPath]: 'base' | 'overrides' }`）可以直接驱动新 CLI 子命令的 source map 输出，与 `resolveEffectiveConfig()` 的 `Array<{ key, value, source }>` 格式完全对齐。

---

## 3. 依赖库评估

### 评估矩阵

| 库名 | 用途 | 已在 package.json | 许可证 | 评级 |
|------|------|---------|--------|------|
| `zod` | Orchestration overrides schema 校验 | ✅ `^3.24.1` | MIT | ★★★ |
| `simple-yaml.mjs`（内置） | 解析 `.specify/orchestration-overrides.yaml` | ✅ 内置 | 内部 | ★★★ |
| `lodash.merge` / `lodash` | 深合并 | ❌ 未引入 | MIT | ★★ |
| 手写 deepMerge（~30 行） | 深合并 | ✅ 已有同类手写工具 | 内部 | ★★★ |

**关键发现**：`package.json:57` 已有 `zod: ^3.24.1`，`config-schema.mjs:14` 已经 `import { z } from 'zod'`，无需新增外部依赖。

### 推荐依赖集

**核心依赖**（均已在项目中）:
- `zod ^3.24.1`: orchestration-overrides schema 定义和校验，与 `config-schema.mjs` 保持同等模式
- `simple-yaml.mjs`（`plugins/spec-driver/scripts/lib/simple-yaml.mjs`）: overrides YAML 解析

**不推荐引入**:
- `lodash.merge`: 仅为一个函数引入外部依赖不合算，仓库风格倾向于手写小工具（见 `config-schema.mjs:190-207` 的手写 Levenshtein 算法）

### 与现有项目的兼容性

| 现有依赖 | 兼容性 | 说明 |
|---------|--------|------|
| `zod ^3.24.1` | ✅ 完全复用 | 直接在新 schema 文件中 `import { z } from 'zod'` |
| `simple-yaml.mjs` | ✅ 完全复用 | `parseYamlDocument()` 已验证能解析 orchestration.yaml 规模文件 |
| `Orchestrator` 构造函数 | ✅ 保持兼容 | 方案 B 不修改构造函数签名 |
| `orchestrator-cli.mjs` 命令 dispatcher | ✅ 只新增 case | `switch(command)` 追加 `case 'effective-orchestration'` |

---

## 4. 设计模式推荐

### 推荐模式

1. **Resolver 模式（参考 `project-profile-resolver.mjs`）**: 新建 `lib/orchestration-resolver.mjs`，导出 `resolveOrchestrationConfig()` 纯函数，内部完成：读 base → 读 overrides → 深合并 → Zod 校验 → 回退策略 → 返回 `{ mergedConfig, fieldSources, diagnostics, isFallback }`。这与仓库现有的 resolver 风格完全一致，无学习成本。

2. **Source Map 记录模式（参考 `resolveEffectiveConfig()`）**: `config-schema.mjs:354-433` 的 `resolveEffectiveConfig()` 在合并时逐字段记录来源，返回 `Array<{ key, value, source }>`。orchestration 层的 source map 可采用相同的"枚举所有 canonical 路径+逐一判断来源"策略。对于 orchestration 的树状结构（modes.feature.phases[*].gates_after），字段粒度应降至 Mode 级别（`modes.feature` 从 `base` 还是 `overrides`），而不是 Phase 数组的每个元素。

3. **Diagnostic 聚合模式（参考 `project-profile-resolver.mjs:11`）**: `createDiagnostic(level, code, message)` 是仓库统一的 diagnostic 形态。新 resolver 应直接复用此函数（可 import 或内联），不需要发明新的错误结构。Overrides 校验失败的 warning 应用 code 如 `orchestration-overrides.schema-fallback`，与 `project-context.schema-fallback` 保持命名对称。

### 应用案例（仓库内）

- `project-profile-resolver.mjs:527-704`：`resolveProjectContext()` 同时处理 yaml/markdown/none 三种情形并生成 diagnostics，是 base→override→merge 的现成范本
- `config-schema.mjs:354-433`：`resolveEffectiveConfig()` 提供了 source map 的精确实现参考
- `lib/orchestrator.mjs:35-65`：`loadAndValidateConfig()` 展示了 YAML 解析失败和 schema 校验失败的两路分支处理，是 overrides resolver 需要模拟的降级逻辑

---

## 5. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | `simple-yaml.mjs` 不支持 YAML anchor/merge key（`<<:`），overrides 文件作者尝试使用别名时静默解析错误 | 中 | 中 | 在 schema 校验时检测并警告；文档中明确标注不支持 anchor；overrides 设计上不鼓励复杂 YAML 特性 |
| 2 | Mode 整段重写语义模糊：overrides 中 `modes.feature` 存在时，phases 数组是替换还是合并？数组合并无法做 ID-based merge，而替换会丢失 base 中的其他 Phase | 高 | 高 | **MVP 明确规定 Mode 整段替换**（而非 Phase-level patch），在 schema 上强制 overrides 中 modes.xxx.phases 必须完整；文档警告此行为 |
| 3 | Orchestrator 实例化链路（8 个 SKILL.md + orchestrator-cli.mjs）当前直接 `new Orchestrator({}, mode, ctx)`，不感知 overrides。引入 overrides 后需要每个调用方切换到 `resolveOrchestrationConfig()` + 新 Orchestrator 构造 | 中 | 中 | 方案 B（factory）下，调用方从 `new Orchestrator()` 改为 `createOrchestrator()`；但 8 个 SKILL.md 是 markdown 文件，改动可以集中在 orchestrator-cli.mjs 一处（SKILL.md 通过 CLI 间接调用） |
| 4 | `.specify/orchestration-overrides.yaml` 路径发现依赖 `projectRoot`，但 worktree 场景中 `.specify/` 每个 worktree 独立（已确认：`.gitignore:41` 只 ignore `.specify/.spec-driver-path` 和 `.specify/runs/`，orchestration-overrides.yaml 不在 ignore 列表，会被 git 跟踪）。多个 worktree 并行时可能互相影响 | 低 | 低 | `.specify/orchestration-overrides.yaml` 预期是项目级长期配置，应 commit 到 git；worktree 共享同一 git index，所以配置天然一致 |
| 5 | `validateOrchestrationYaml()`（`lib/orchestrator.mjs:188-210`）是简单的手写校验，不是 Zod schema。新 overrides schema 用 Zod，而 base config 校验函数不是 Zod，二者合并后需要统一用哪套校验 | 中 | 中 | Merged config 统一用新 Zod schema 校验；`validateOrchestrationYaml()` 可保留作 base config 的快速校验（它先运行），Zod schema 作为 merged 后的精确校验 |
| 6 | `repo:check` 扩展点：`validateRepository()` 通过 `aggregateValidation()` 串联各校验器。新增 orchestration-overrides 校验器需要在 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository()` 函数中插入一行 `aggregateValidation()`，这个文件是核心同步链路入口，改错会导致整个 repo:check 中断 | 低 | 高 | 新校验器采用与 `validateWrapperSources()` 完全相同的接口 `{ status, checks, warnings, errors }`，在 `validateRepository()` 末尾追加，不影响现有校验 |

---

## 6. 各调研点详细结论

### 6.1 Orchestrator 加载链路

**真实路径情况**：`plugins/spec-driver/lib/orchestrator.mjs`（真实路径，非 `scripts/lib/`）；`plugins/spec-driver/lib/orchestrator-fallback.mjs`（真实路径）；`scripts/orchestrator-cli.mjs` 中 import 来自 `'../lib/orchestrator.mjs'`（相对路径，即 `lib/`）。SKILL.md 引用的 `lib/orchestrator.mjs` 路径与真实路径一致。

**构造函数分析**（`lib/orchestrator.mjs:22-32`）：
```
constructor(userConfig, mode, context = {})
  - 参数：userConfig 来自 spec-driver.config.yaml（gate_policy、gates 等）
  - 自己读文件：loadAndValidateConfig() 硬编码从 __dirname/../config/orchestration.yaml 读 base
  - 无任何 hook/extension point 接受外部 overrides
```

**当前问题**：`loadAndValidateConfig()`（`lib/orchestrator.mjs:35-65`）将文件路径硬编码为 `path.join(__dirname, '..', 'config', 'orchestration.yaml')`，没有任何插槽可以注入 overrides。方案 B（factory）完全绕开这个问题。

**orchestrator-cli.mjs 接入点**：`scripts/orchestrator-cli.mjs:218-255` 的 `switch(command)` 末尾追加 `case 'effective-orchestration'` 即可，模式与 `validate-config` 完全对称。

**orchestrator-fallback.mjs 复用**：`lib/orchestrator-fallback.mjs` 的 `generateFallbackConfig()` 是纯函数，返回一个完整的内置 config 对象。当 overrides 校验失败时，回退逻辑应使用**原始 base config**（不含 overrides），而不是 fallback config——fallback config 是 base YAML 都不可读时的最后防线。所以降级路径需要区分：

- YAML 语法错误 → 完全忽略 overrides，使用 base
- Zod 校验失败 → 完全忽略 overrides，使用 base + 打 warning diagnostic
- Base 不可读 → 使用 `generateFallbackConfig()` + 打 error diagnostic

**复用面 / 改造点 / 风险**:
- 复用面：`generateFallbackConfig()` 可直接引用；`validateOrchestrationYaml()` 可作为 base 快速校验
- 改造点：新增 `lib/orchestration-resolver.mjs`；`orchestrator-cli.mjs` 追加 1 个 case
- 风险：构造函数硬编码路径，方案 B 完全规避，方案 A 需小改构造函数

### 6.2 Zod Schema 复用模式

`config-schema.mjs` 已定义 `specDriverConfigSchema`（用户配置 schema），**不是** orchestration.yaml 的 schema。orchestration.yaml 目前只有手写校验函数 `validateOrchestrationYaml()`（`lib/orchestrator.mjs:188-210`），没有 Zod schema。

本 Feature 需要新建 `plugins/spec-driver/contracts/orchestration-overrides-schema.mjs`，定义：
- `orchestrationOverridesSchema`：Zod schema，允许 `modes` 和 `gates` 两个顶层字段（均 optional），对齐 `orchestration.yaml` 的字段结构
- `phaseSchema`：单个 Phase 的 Zod schema（id、name、agent、agent_mode 等）
- `gateOverrideSchema`：Gate 行为覆盖的 Zod schema（type、default_behavior、hard_gate_modes 等）

现有"layered config"工具 `resolveEffectiveConfig()`（`config-schema.mjs:354`）专门服务于 spec-driver.config.yaml，不能直接复用给 orchestration，但其**逐字段 source tracking 的设计思路**可直接照搬。

Schema 错误信息中文化模式：参考 `config-schema.mjs:279-320`，对 Zod 的 `unrecognized_keys`、`invalid_enum_value`、`invalid_type` 分别生成中文 diagnostic message。

**复用面 / 改造点 / 风险**:
- 复用面：Zod 依赖、diagnostic 结构、source tracking 模式
- 改造点：新建 orchestration-overrides-schema.mjs，约 80-120 行
- 风险：orchestration.yaml 的 Phase 结构较复杂（phases 是数组，每个 Phase 有 gates_before/after 数组），Zod schema 设计要覆盖这些嵌套，否则 `z.strict()` 会误报

### 6.3 simple-yaml 解析能力

`simple-yaml.mjs` 是自制的轻量 YAML 解析器（约 260 行），核心能力：

- 支持：mapping、sequence、标量（string/number/boolean/null）、嵌套结构、引号字符串、注释剥离
- **不支持**：YAML anchor（`&`）、merge key（`<<:`）、多文档（`---`）、流式语法（`{a: b}`行内映射）
- 错误报告：`parseYamlDocument()` 遇到语法异常会 throw，但**不提供行号**（`simple-yaml.mjs:200-209` 返回的是解析结果或 `{}`，catch 在调用方）

对于 orchestration-overrides.yaml 的预期规模：overrides 文件会比 base orchestration.yaml 小得多（用户只覆盖少数字段），simple-yaml.mjs 完全够用。

Anchor/merge key 不支持是个潜在问题，但 overrides 文件规模小，用户没有强烈动机使用这些高级特性。文档中明确说明即可。

**复用面 / 改造点 / 风险**:
- 复用面：`parseYamlDocument()` 直接调用，无需改动
- 改造点：无
- 风险：不提供行号的错误报告会降低 overrides 配置出错时的调试体验；不支持 anchor 是固定限制

### 6.4 project-profile-resolver 作为范本

`resolveProjectContext({ projectRoot })`（`project-profile-resolver.mjs:527`）是**完全匹配**的设计范本：

| resolver 特性 | 对应 orchestration-resolver 的做法 |
|------|------|
| yaml/markdown/none 三路 | base yaml（总存在）/ overrides yaml（可选）/ 无 overrides |
| `yamlExists` 检查 | `overridesExists = fs.existsSync(overridesPath)` |
| `normalizeYamlInput()` 规范化 | 将 overrides 中的字段提取并规范化 |
| `resolvedProjectProfileSchema.safeParse()` | `orchestrationOverridesSchema.safeParse()` |
| `fieldSources` map | `{ 'modes.feature': 'overrides', 'modes.story': 'base', ... }` |
| `createDiagnostic(level, code, message)` | 直接 import 同款函数 |
| 降级到安全默认值 | 降级到纯 base config（不含 overrides） |

`EXCLUDED_EXECUTION_FIELDS`（`project-profile-schema.mjs:3-8`）的作用机制：过滤掉不属于项目级配置的字段（如 `phase_focus`、`skip_spec`），防止误配置。orchestration-overrides schema 应定义类似的白名单字段集，只允许 `modes` 和 `gates`，其他字段一律 warn+忽略。

`createDiagnostic(level, code, message)` 是仓库统一的 diagnostic 形态（`project-profile-resolver.mjs:11`），确认为唯一标准，新 resolver 应直接复制此函数或从共享模块 import。

**复用面 / 改造点 / 风险**:
- 复用面：完整的 resolver 设计范本，逻辑几乎可 1:1 映射
- 改造点：新建 `lib/orchestration-resolver.mjs`，约 150-200 行
- 风险：project-profile-resolver 是字段级合并（每个字段独立 normalize），而 orchestration-resolver 需要结构级合并（modes/gates 是对象），合并语义不同，不能直接 copy 合并逻辑

### 6.5 Contract 沉淀模式

`plugins/spec-driver/contracts/` 目录中找到：
- `wrapper-source-of-truth.yaml`：定义 Codex 包装技能的 source-of-truth 关系

将 orchestration-overrides schema 沉淀进 contracts 的方式：新建 `plugins/spec-driver/contracts/orchestration-overrides-schema.mjs`（Zod schema 文件）和可选的 `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml`（人读的 schema 说明文档，与 `wrapper-source-of-truth.yaml` 风格对齐）。

纳入 `repo:check` 的标准方式（`scripts/lib/repo-maintenance-core.mjs:205-262`）：
1. 新建 `plugins/spec-driver/scripts/validate-orchestration-overrides.mjs`，导出 `validateOrchestrationOverrides({ projectRoot })`，返回 `{ status, checks, warnings, errors }`
2. 在 `validateRepository()` 函数末尾追加：`aggregateValidation('orchestration-overrides', validateOrchestrationOverrides({ projectRoot: resolvedRoot }), warnings, errors, checks)`
3. `validate-config.mjs` 可扩展为同时校验 `orchestration-overrides.yaml`（追加 `--validate-overrides` flag）

**复用面 / 改造点 / 风险**:
- 复用面：`validateWrapperSources.mjs` 的校验器接口标准（`{ status, checks, warnings, errors }`）
- 改造点：新增 1 个 validate 脚本，`repo-maintenance-core.mjs` 追加 1 行
- 风险：`repo-maintenance-core.mjs` 是核心同步链路，改错会导致 `repo:check` 全量失败

### 6.6 同步管道

`scripts/lib/repo-maintenance-core.mjs` 的 `syncRepository()` 和 `validateRepository()` 构成同步+校验双链路：

- `syncRepository()`（第 175-203 行）：调用 agent-docs、release-contract、spectra-skills 等，本 Feature **不需要**在 sync 链路中增加步骤（overrides 是用户写入的配置文件，不是生成产物）
- `validateRepository()`（第 205-262 行）：追加 orchestration-overrides 校验器即可

`npm run docs:sync:agents` 同步的是 `docs/shared/*.md` 到 AGENTS.md/CLAUDE.md。本 Feature 如果新增"orchestration overrides 约定"，可以考虑添加 `docs/shared/agent-orchestration-overrides.md`，在相关 SKILL.md 中引用，并通过 sync 管道写入 CLAUDE.md。这是**可选优化**，不影响 MVP。

**复用面 / 改造点 / 风险**:
- 复用面：整套 aggregateValidation 模式
- 改造点：`validateRepository()` 追加 1 行
- 风险：无（追加方式不破坏现有链路）

### 6.7 测试基础设施

`plugins/spec-driver/tests/orchestrator.test.mjs` 使用 **Node.js 内置测试框架**（`node:test`，`describe/it`），而非 vitest。仓库规范要求 vitest，但 orchestrator 的测试目前在独立的 `.test.mjs` 文件中用 `node --test` 运行。

本 Feature 的三类测试：

1. **Base + Override 合并测试**：给定 base config（mock orchestration.yaml）和 overrides（mock overrides.yaml），验证合并后的 `mergedConfig` 字段正确、`fieldSources` 标记正确。建议在 `tests/orchestration-resolver.test.mjs` 中用 `node:test` 框架（与现有测试保持一致）。

2. **校验失败降级测试**：给定无效的 overrides（schema 不匹配），验证：返回的 `isFallback = true`、diagnostics 包含 warning 级 entry、mergedConfig 等于纯 base config。

3. **CLI dry-run 输出测试**：调用 `node scripts/orchestrator-cli.mjs effective-orchestration feature --project-root <测试目录>`，验证 stdout 包含 source map 表格（或 JSON），包含 `modes.feature` 的来源信息。

**复用面 / 改造点 / 风险**:
- 复用面：`orchestrator.test.mjs` 的 fixture 模式（silentLogger、直接实例化）
- 改造点：新增 1 个测试文件，约 80-120 行
- 风险：现有测试用 `node:test` 而非 vitest，需要确认 CI 是否同时执行两套

### 6.8 深合并工具

**仓库内 grep 结果**：未找到 `deepMerge`、`deep-merge`、`lodash.merge` 的直接使用。`config-schema.mjs` 的 `resolveEffectiveConfig()` 采用"枚举所有 canonical key 路径，逐一判断来源"的平铺式合并，而非递归深合并。

**数组合并语义**：仓库内现有代码对数组的处理是**替换（replace）而非合并（merge）**：`project-profile-resolver.mjs` 中 `references`、`architectureConstraints` 等数组字段全部来自单一 source，不存在两个数组需要合并的场景。

对于本 Feature，orchestration 中的数组（`phases[]`、`gates_before[]`、`gates_after[]`、`hard_gate_modes[]`）合并语义建议如下：
- Mode 级别（`modes.feature`）：overrides 整段替换（不合并 phases 数组）
- Gate 级别（`gates.GATE_DESIGN`）：对象级合并（overrides 中 gate 的字段覆盖 base 对应字段，未出现的字段保留 base 值）
- `hard_gate_modes[]`：替换（不做数组 append）

**手写 deepMerge 推荐**：针对 orchestration 结构，一个专用的 `mergeOrchestrationConfigs(base, overrides)` 函数（约 40-50 行）比通用 deepMerge 更安全，因为可以针对 modes 和 gates 的合并语义做精确控制。

**复用面 / 改造点 / 风险**:
- 复用面：无现有 deepMerge 可复用
- 改造点：新建约 40-50 行专用合并函数，内置在 `lib/orchestration-resolver.mjs` 中
- 风险：数组合并语义（替换 vs. append）如果定义不清，会导致 overrides 文件难以使用

### 6.9 SKILL.md 入口审查

检查 8 个 SKILL.md 的编排配置加载方式：

| SKILL | 编排加载方式 | 是否感知 overrides |
|-------|------|------|
| `spec-driver-feature` | 通过 `orchestrator-cli.mjs get-phases feature`（第 85 行） | ❌ 不感知（CLI 不加载 overrides） |
| `spec-driver-story` | 通过 `Orchestrator.getGateBehavior()` 伪代码描述（第 99-105 行） | ❌ 不感知 |
| `spec-driver-fix` | 通过 `Orchestrator.getGateBehavior()` 伪代码描述（第 92-102 行） | ❌ 不感知 |
| `spec-driver-implement` | 通过 orchestrator-cli.mjs（初始化步骤 3.6） | ❌ 不感知 |
| `spec-driver-sync` | 无编排查询（sync 模式较简单） | N/A |
| `spec-driver-resume` | 与 feature 相似，通过 CLI | ❌ 不感知 |
| `spec-driver-doc` | 通过 orchestrator-cli.mjs | ❌ 不感知 |
| `spec-driver-refactor` | 通过 orchestrator-cli.mjs | ❌ 不感知 |

**关键发现**：所有 SKILL.md 通过 `orchestrator-cli.mjs` 调用编排器，而非直接实例化 `Orchestrator`。因此，**只需要让 `orchestrator-cli.mjs` 在执行任何命令前先加载 overrides 并传入合并后的 config**，所有 SKILL.md 无需修改，自动感知 overrides。

**是否需要顺带修复**：不需要。SKILL.md 文件本身通过 CLI 间接调用编排器，CLI 集中处理 overrides 即可。这是本 Feature 的核心设计优势。

---

## 7. 产品-技术对齐度

### 覆盖评估

| MVP 功能 | 技术方案覆盖 | 说明 |
|---------|-------------|------|
| `.specify/orchestration-overrides.yaml` 加载 | ✅ 完全覆盖 | `orchestration-resolver.mjs` 负责检查文件是否存在并解析 |
| 加载序：base→overrides→深合并→Zod 校验 | ✅ 完全覆盖 | resolver 内部 4 步骤对应 4 个函数调用 |
| 校验失败回退 base + warning diagnostic | ✅ 完全覆盖 | 参考 project-profile-resolver 的 schema-fallback 模式 |
| Mode 整段重写 | ✅ 完全覆盖 | 合并函数 modes 字段用 overrides 替换 |
| Gate 行为覆盖 | ✅ 完全覆盖 | 合并函数 gates 字段用对象合并 |
| CLI 子命令展示 effective orchestration（含 source map） | ✅ 完全覆盖 | orchestrator-cli.mjs 追加 effective-orchestration 命令 |
| Schema 沉淀进 contracts/ | ✅ 完全覆盖 | 新建 contracts/orchestration-overrides-schema.mjs |
| 纳入 npm run repo:check | ✅ 完全覆盖 | repo-maintenance-core.mjs 追加 1 行 aggregateValidation |

### 扩展性评估

方案 B（factory 模式）对未来二期功能（Phase patch、extends、并行组覆盖）具有良好的扩展性：
- `orchestration-resolver.mjs` 的合并逻辑可按需扩展，不影响 `Orchestrator` 类的接口
- Zod schema 可以增量添加新字段，`z.object().partial()` 天然支持可选字段
- source map 的 `fieldSources` 可以精细化到 Phase 级别（二期）

### Constitution 约束检查

| 约束 | 兼容性 | 说明 |
|------|--------|------|
| TypeScript 5.x + Node.js 20.x | ✅ 兼容 | 新增文件均为 `.mjs`，与现有 `lib/` 文件保持一致 |
| 不引入未经评估的新依赖 | ✅ 兼容 | 仅复用已有 zod 和 simple-yaml.mjs |
| 使用 spec-driver 方式执行需求变更（CLAUDE.md 约束） | ✅ 兼容 | 本 Feature 通过 spec-driver 流程推进 |
| 提交前 `npm run repo:check` 零失败 | ✅ 兼容 | 新增校验器采用标准接口，不破坏现有校验 |

---

## 8. 实施工作量粗估

| 文件 / 组件 | 改动类型 | 预估行数 | 说明 |
|---------|------|------|------|
| `plugins/spec-driver/lib/orchestration-resolver.mjs` | **新增** | ~180 行 | 核心文件：加载、合并、校验、source map、diagnostics |
| `plugins/spec-driver/contracts/orchestration-overrides-schema.mjs` | **新增** | ~100 行 | Zod schema：phaseSchema、gateSchema、overridesSchema |
| `plugins/spec-driver/scripts/orchestrator-cli.mjs` | **小改** | +30 行 | 追加 `effective-orchestration` case，调用 resolver |
| `plugins/spec-driver/scripts/validate-orchestration-overrides.mjs` | **新增** | ~60 行 | repo:check 校验器接口 |
| `scripts/lib/repo-maintenance-core.mjs` | **小改** | +3 行 | validateRepository() 中追加 aggregateValidation |
| `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | **新增** | ~100 行 | 三类测试：合并、降级、CLI |
| `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` | **新增** | ~40 行 | 人读的合同说明文档 |
| `plugins/spec-driver/lib/orchestrator.mjs` | **无需改动** | — | 构造函数签名不变，factory 绕开 |
| `plugins/spec-driver/lib/orchestrator-fallback.mjs` | **无需改动** | — | 直接引用 generateFallbackConfig() |
| `plugins/spec-driver/scripts/lib/simple-yaml.mjs` | **无需改动** | — | parseYamlDocument() 直接复用 |
| `plugins/spec-driver/skills/*/SKILL.md`（8 个） | **无需改动** | — | 通过 CLI 间接感知 overrides |
| `plugins/spec-driver/scripts/lib/config-schema.mjs` | **无需改动** | — | spec-driver.config.yaml schema 独立 |

**总估算**：新增约 480 行（3 个新文件 + 1 个测试文件 + 1 个合同文件），小改约 33 行（2 个现有文件），无需改动 10 个文件。

---

## 9. 结论与建议

### 总结

本 Feature 的核心实施路径清晰：以 `project-profile-resolver.mjs` 为范本，新建 `lib/orchestration-resolver.mjs`；以 `config-schema.mjs` 的 source tracking 为范本，设计 orchestration 层的 source map；所有 SKILL.md 通过 orchestrator-cli.mjs 间接调用，只需改 CLI 一处即可覆盖全部 8 种模式。

仓库内无任何 deep merge 工具，但鉴于 orchestration 结构的语义复杂性（Mode 替换 vs. Gate 对象合并），推荐新建专用 `mergeOrchestrationConfigs()` 函数而非引入通用 lodash.merge。

### 对产研汇总的建议

- **最大风险 1**：Mode 级别的"整段替换"语义对用户来说可能不直觉——用户期望只覆盖几个 Phase 的属性，却不得不复制整个 phases 数组。MVP 说明中应明确标注此限制，并在文档中提供完整示例。
- **最大风险 2**：`simple-yaml.mjs` 不支持 YAML anchor/merge key，这会限制高级用户在 overrides 文件中复用片段的能力。如果未来 overrides 文件变复杂，需要评估是否引入 `js-yaml`（支持 1.2 spec）。
- **最大风险 3**：`repo-maintenance-core.mjs` 是核心同步链路，追加 orchestration-overrides 校验器时需要特别小心——新校验器的接口必须完全符合 `{ status, checks, warnings, errors }` 规范，否则会导致整个 `repo:check` 中断。

---

**本 Feature 实施风险点最大的 3 处**：
1. **数组合并语义歧义**（Mode 整段替换 vs. Phase-level patch）：需在 spec.md 中明确定义，否则实现完成后用户反馈"覆盖粒度太粗"，需要大改合并逻辑。
2. **simple-yaml.mjs 不提供行号**：overrides 文件校验失败时的错误提示缺乏定位信息，调试体验差，尤其在 Mode 整段重写场景下 phases 数组较长时。
3. **repo-maintenance-core.mjs 改动的回归风险**：虽然改动量极小（+3 行），但该文件是 `repo:check` 的核心入口，接口不一致会导致整个校验链路中断，需要在同 PR 中补充测试覆盖。
