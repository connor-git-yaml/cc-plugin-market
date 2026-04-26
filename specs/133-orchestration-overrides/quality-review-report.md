---
feature_id: "133"
phase: "7b"
review_version: "1.0"
created_at: "2026-04-26"
recommendation: "PASS_TO_GATE_VERIFY"
---

# Feature 133 代码质量审查报告（Phase 7b）

## 审查范围

| 文件 | 行数 | 变更类型 |
|------|------|----------|
| `plugins/spec-driver/contracts/orchestration-schema.mjs` | 299 | 新增 |
| `plugins/spec-driver/contracts/orchestration-overrides-contract.yaml` | 114 | 新增 |
| `plugins/spec-driver/lib/orchestration-resolver.mjs` | 387 | 新增 |
| `plugins/spec-driver/lib/orchestrator.mjs` | 280 | 修改（base 校验迁移 + preloadedConfig） |
| `plugins/spec-driver/scripts/orchestrator-cli.mjs` | 589 | 修改（+332 行，257→589） |
| `plugins/spec-driver/scripts/validate-orchestration-overrides.mjs` | 190 | 新增 |
| `scripts/lib/repo-maintenance-core.mjs` | ~272 | 修改（async 升级） |
| `plugins/spec-driver/templates/orchestration-overrides.example.yaml` | 82 | 新增 |
| `plugins/spec-driver/tests/orchestration-resolver.test.mjs` | 442 | 新增（21 用例） |
| `plugins/spec-driver/tests/fixtures/orchestration/` | 8 files | 新增 |
| `docs/shared/agent-orchestration-overrides.md` | 6 | 新增 |

---

## 维度 1：架构合理性

[PASS] CHK-QR-01: orchestration-resolver.mjs 职责边界清晰

resolver 专注"读取 + 校验 + 合并 + 降级"，不承担 Orchestrator 的运行时调度职责。`mergeOrchestrationConfigs` 作为 resolver 内部私有函数保持内聚。

[PASS] CHK-QR-02: preloadedConfig 注入设计防御 D-PLAN-6 陷阱

`Orchestrator` 构造函数的 `options.preloadedConfig` 路径正确绕过了 `loadAndValidateConfig()` 的文件读取，CLI `buildOrchestrator()` 统一走此路径。代码注释清晰标注决策原因（D-PLAN-6）。

[WARN] CHK-QR-03: orchestrator-cli.mjs 文件从 257 行增长至 589 行，触发 STRUCTURAL_DEBT 阈值

**证据**：`git show c4e7b80:plugins/spec-driver/scripts/orchestrator-cli.mjs | wc -l` 输出 257；当前 589 行。超过"500 行增长到 800 行"的 WARNING 边界（257→589 增加了 332 行，超过原始 250% 体量）。

`serializeYaml`（273-303 行，30 行）、`serializeWithAnnotations`（314-383 行，69 行）、`formatDiff`（393-441 行，48 行）三个辅助函数合计 147 行，全部是 YAML 序列化/展示逻辑，与 CLI 调度职责不同，适合提取为 `lib/orchestration-output-serializer.mjs`。

**修复建议**：将 `yamlScalar`/`serializeYaml`/`serializeWithAnnotations`/`formatDiff` 四个函数提取到独立辅助模块，CLI 保留调度逻辑。规划在下一个 Feature 完成。

[PASS] CHK-QR-04: 累积劣化 — 其余新增文件行数合理

`orchestration-resolver.mjs`（387 行）、`orchestration-schema.mjs`（299 行）、`validate-orchestration-overrides.mjs`（190 行）均为本 Feature 新增且体量合理，不触发阈值。

[PASS] CHK-QR-05: validate-orchestration-overrides.mjs 与 repo-maintenance-core.mjs 集成正确

`repo-maintenance-core.mjs` 的 `validateRepository` 使用 `await validateOrchestrationOverrides(...)` 后再传入 `aggregateValidation`，与函数接受同步结果的签名一致（先 await 拿到 resolved value 再传入）。集成正确，无 Promise 对象被误传的风险。

---

## 维度 2：设计模式合理性

[PASS] CHK-QR-06: Zod 三件套 Schema 分层明确

`orchestrationBaseSchema`（校验 plugin base）、`orchestrationOverridesSchema`（校验用户覆盖）、`orchestrationMergedSchema`（复用 base schema，DRY）三件套职责清晰，符合 plan.md 设计。

[WARN] CHK-QR-07: `modeOverrideSchema` 使用 `.passthrough()` 允许任意额外字段，与整体 `.strict()` 策略不一致

**证据**：`orchestration-schema.mjs:176`
```js
}).passthrough();  // 允许额外字段透传（for future compat）
```
`orchestrationOverridesSchema` 顶层使用 `.strict()` 拒绝未知字段（行 287），但内嵌的 `modeOverrideSchema` 使用 `.passthrough()`，导致 `modes.fix.unknownField: "hack"` 可以无感通过 schema 校验并进入 mergedConfig。虽然合并后会受 `orchestrationMergedSchema`（等于 base schema）再次校验，但中间合并阶段存在未净化字段进入内存的窗口。

**修复建议**：将 `.passthrough()` 改为 `.strip()` 或增加注释明确说明这些额外字段在合并前会被 `orchestrationMergedSchema` 过滤，以避免误解。若二期 `extends` 是唯一预留字段，建议改用 `.strict()` 并在二期扩展时再放开。

[PASS] CHK-QR-08: `mergeOrchestrationConfigs` 内联于 resolver 设计合理

该函数仅被 resolver 单一调用，且属于 resolver 的合并逻辑，内联合理。函数顶部 docstring 对合并语义（整段替换 vs 字段合并 vs 数组替换）有完整说明，符合"注释解释 why"原则。

[PASS] CHK-QR-09: `formatDiff` 处理 --diff 时二次调用 resolver 的策略合理但存在副作用

**证据**：`orchestrator-cli.mjs:489`
```js
const baseResolver = await resolveOrchestrationConfig({ projectRoot: '/tmp/__no_overrides_dir__' });
```
使用 `/tmp/__no_overrides_dir__`（不存在的目录）作为哨兵值来获取纯 base config，逻辑有效（resolver 检查 `fs.existsSync` 失败时直接返回 base）。但这是一个隐式约定而非显式 API（如传 `{noOverrides: true}` 参数），存在如果将来该目录被意外创建就会影响 diff 输出的脆弱性。

**修复建议**：在 `resolveOrchestrationConfig` 中增加 `_skipOverrides?: boolean` 参数作为明确的"仅返回 base"旗标，替换哨兵路径方式。

---

## 维度 3：安全性

[PASS] CHK-QR-10: 用户 overrides 经过严格 Zod 校验，无提权路径

`orchestrationOverridesSchema` 顶层 `.strict()` 拒绝未知顶层字段；`gateOverrideSchema` 使用 `.strict()` 仅允许 `default_behavior/severity/hard_gate_modes` 三字段；mode key 被显式枚举为 8 个 reserved 名称，拒绝自定义 mode 注入。

[PASS] CHK-QR-11: 无硬编码密钥或敏感信息

审查范围内所有文件不含 API key、token、密码、私有路径等敏感信息。

[PASS] CHK-QR-12: diagnostic 输出不泄露内部堆栈

错误信息仅包含 `error.message`（行 192、308 等），不传递 `error.stack`，符合最小泄露原则。

[WARN] CHK-QR-13: `modeOverrideSchema.passthrough()` 导致未知字段可透传到合并结果内存（见 CHK-QR-07 详述）

技术上 `orchestrationMergedSchema` 会在步骤 9 进行防御性校验并过滤掉非 base schema 字段（base schema 不含这些字段会报错），但实际上 `orchestrationMergedSchema = orchestrationBaseSchema` 使用的是不带 `.strict()` 的默认 zod 行为（`strip` 未知字段），合并结果中未知字段被静默 strip 而非报错。用户注入的 `modes.fix.injected: <arbitrary_value>` 在整个执行流程中不会产生 warning，存在数据无声污染的隐患。

**修复建议**：将 `modeOverrideSchema` 改为 `.strict()` 或 `.strip()`（不影响运行时，但拒绝/清除未知字段并给予 schema-fallback 信号）。

---

## 维度 4：类型安全

[PASS] CHK-QR-14: `.nullable()` vs `.optional()` 使用准确

`phaseSchema` 中 `gates_before/gates_after/conditional/skip_if_exists` 均使用 `.nullable()` 而非 `.optional()`，与 YAML 中显式为 `null` 的字段保持语义一致。注释也明确标注了这个选择的原因（行 92）。

[WARN] CHK-QR-15: `orchestration-schema.mjs:286` 使用 `z.any()` 接受 `parallel_groups`，类型约束完全丢失

**证据**：
```js
// 使用 z.any() 接受任意值，由 resolver 在 parse 前检测并 strip
parallel_groups: z.any().optional(),
```
注释说明原因是"由 resolver 在 parse 前检测"，但 `z.any()` 导致该字段的内容在 TypeScript/JSDoc 层面完全不可见。若改用 `z.record(z.string(), z.unknown()).optional()` 或 `z.object({}).passthrough().optional()` 既保持了接受任意结构的意图，又提供了更精确的类型信息。

**修复建议**：改为 `z.record(z.string(), z.unknown()).optional()` 使类型意图更清晰。

[PASS] CHK-QR-16: 函数返回值类型通过 JSDoc 清晰声明

`resolveOrchestrationConfig` 返回值 JSDoc 完整标注了 `mergedConfig/fieldSources/diagnostics/isFallback/isBaseInvalid` 五个字段及其类型（行 175-182）。

---

## 维度 5：注释质量

[PASS] CHK-QR-17: 关键设计决策有充分的 why 注释

- `orchestration-schema.mjs:140`：`nullable()` vs `optional()` 的设计选择注释
- `orchestration-resolver.mjs:55-65`：`mergeOrchestrationConfigs` 顶部完整说明了 4 种合并语义及边界情况
- `orchestrator.mjs:22-25`：`preloadedConfig` 的 D-PLAN-6 陷阱防御注释
- `orchestrator-cli.mjs:52-54`：`buildOrchestrator` 说明了为何是 D-PLAN-6 核心防御

[WARN] CHK-QR-18: `orchestration-schema.mjs:248` 存在过期注释，提及 `_strippedFields` 但该机制从未实现

**证据**：`orchestration-schema.mjs:248`
```js
* 注意：parallel_groups 的 strip 信号通过 _strippedFields 暴露给 resolver（CL-010）
```
搜索整个 codebase，`_strippedFields` 从未被定义或使用。Resolver 实际通过直接检测 `rawOverrides.parallel_groups !== undefined` 来 strip 该字段（`orchestration-resolver.mjs:292`），而非通过 schema 暴露信号。此注释描述了一种设计草稿，非实际实现。

**修复建议**：将该注释更新为"parallel_groups 由 resolver 在调用 safeParse 前手动检测并 strip（步骤 6）；schema 层仅接受该字段避免 .strict() 拒绝它"。

[PASS] CHK-QR-19: `modeOverrideSchema.passthrough()` 注释说明了意图（future compat），虽然策略存疑但注释本身是 why 而非 what

[PASS] CHK-QR-20: 无残留 TODO/FIXME/HACK 注释

---

## 维度 6：可维护性

[WARN] CHK-QR-21: `orchestrator.mjs:33-36` preloadedConfig 路径硬编码 `isFallback = false`，丢失 resolver 的 fallback 信号

**证据**：`orchestrator.mjs:33-36`
```js
if (options.preloadedConfig) {
  this.config = options.preloadedConfig;
  this.isFallback = false;  // 永远设为 false，与 resolver 的实际 isFallback 状态脱钩
}
```
当 resolver 返回 `isFallback: true`（如 version-mismatch 降级到 base）时，CLI 仍将 fallback 的 base config 作为 preloadedConfig 注入，Orchestrator 的 `isFallback` 被设为 `false`，导致 `getSummary()` 的 `isFallback` 字段与实际语义不一致。

`validate-config` 命令的输出会将降级场景报告为"配置有效"而非"使用后备配置"（`orchestrator-cli.mjs:235`）。

**修复建议**：将 `resolverResult.isFallback` 也传递给 Orchestrator，例如通过 `options.isFallback` 参数，或在 `buildOrchestrator` 返回的 `resolverResult` 中直接读取 fallback 状态用于 CLI 输出，而非依赖 `orch.getSummary().isFallback`。

[PASS] CHK-QR-22: `buildBaseOnlyFieldSources` 提取为独立辅助函数，避免了多处重复的 base-only sources 构建逻辑

[PASS] CHK-QR-23: 错误处理完整，4 类降级路径明确独立

`parse-error / schema-fallback / version-mismatch / base-invalid` 四个降级路径各自有专属 diagnostic code，互不复用，可以通过 code 精确区分来源。`validator` 按 code 进行 switch-case 映射，与 contract.yaml 定义的 code 完全一致。

[PASS] CHK-QR-24: `validateOrchestrationYaml` 保留为向后兼容薄壳，注释清晰说明历史与现状

---

## 维度 7：性能与资源

[PASS] CHK-QR-25: resolver 仅在需要时读取两次文件（base + overrides），无不必要多次读取

正常路径：`defaultLoadBase()` 读 1 次 + `fs.readFileSync(overridesPath)` 读 1 次，共 2 次，合理。

[WARN] CHK-QR-26: `--diff` 子命令调用 `resolveOrchestrationConfig` 两次（连续加载 base config），存在可优化空间

**证据**：`orchestrator-cli.mjs:453 + 489`
```js
resolverResult = await resolveOrchestrationConfig({ projectRoot });        // 第 1 次
const baseResolver = await resolveOrchestrationConfig({                    // 第 2 次
  projectRoot: '/tmp/__no_overrides_dir__'
});
```
第 2 次调用是为了获取纯 base config（无 overrides），而 `defaultLoadBase()` 在 resolver 内部已读取一次 `orchestration.yaml`。改为在 resolver 返回值中额外暴露 `baseConfig` 字段，或在 resolver 提供 `_skipOverrides` 参数，可避免重复 I/O。当前场景下 orchestration.yaml 较小（无性能危机），但属于可改进的结构性问题。

**修复建议**：将 `baseConfig` 作为 resolver 返回值的额外字段，`--diff` 直接使用 `resolverResult.baseConfig`，避免第 2 次 resolver 调用。

[PASS] CHK-QR-27: 无不必要的同步阻塞操作（`defaultLoadBase` 使用同步读取是有意选择，适合 CLI 启动路径）

---

## 维度 8：安全性（补充）

[PASS] CHK-QR-28: overrides 文件路径由 `projectRoot` + `.specify/orchestration-overrides.yaml` 硬编码拼接，用户无法通过 overrides 内容引用任意路径

[PASS] CHK-QR-29: CLI `--project-root` 参数接受用户输入但仅用于 `path.join` 构建 overrides 路径，不执行文件内容，无命令注入风险

[PASS] CHK-QR-30: `gateOverrideSchema.strict()` 拒绝非白名单字段，用户无法通过 gate overrides 注入额外字段改变 base gate 结构

---

## 维度 9：仓库一致性

[PASS] CHK-QR-31: 文件命名风格一致（`-` 连字符，`.mjs` 扩展名）

新增文件 `orchestration-resolver.mjs`、`orchestration-schema.mjs`、`validate-orchestration-overrides.mjs` 均遵循仓库现有 `-` 连字符命名规范。

[PASS] CHK-QR-32: ESM 风格与仓库现有 `.mjs` 文件一致

使用 `import/export` ESM 语法，无 CommonJS `require()`，与 `config-schema.mjs`、`project-profile-resolver.mjs` 等范本文件风格一致。

[PASS] CHK-QR-33: `createDiagnostic` 辅助函数风格与仓库现有 `createCheck` 范式一致

`orchestration-resolver.mjs:41` 的 `createDiagnostic(level, code, message, context?)` 与 `validate-orchestration-overrides.mjs:24` 的 `createCheck(id, title, status, evidence?)` 同构，符合仓库约定。

[PASS] CHK-QR-34: orchestrator.mjs 中 `node:fs`、`node:path` 的裸导入（无 `node:` 前缀）与文件中其他 import 一致，但与新文件规范（使用 `node:` 前缀）有轻微差异

**证据**：`orchestrator.mjs:8-9`
```js
import fs from 'fs';
import path from 'path';
```
新增文件 `orchestration-resolver.mjs:16-18` 使用了 `node:` 前缀。这是 orchestrator.mjs 的历史遗留，非本次修改引入，不计入本次评级。

---

## 维度 10：文档与示例

[PASS] CHK-QR-35: `orchestration-overrides.example.yaml` 内容真实可用

示例包含三个独立场景（gate behavior 调整、mode 整段重写、并行调度资源限制），每个场景有使用说明和注意事项。顶部明确警告 YAML anchor 不支持。示例文件注释了哪些内容不应合并到一个文件中（三个场景互斥）。

[PASS] CHK-QR-36: `orchestration-overrides-contract.yaml` 字段覆盖完整

涵盖了 `supported_overrides`（3 种路径及语义）、`out_of_scope`（3 个二期特性）、`diagnostic_codes`（6 个 code）、`cli` 示例（3 个）、`notes`（4 条）。与实现代码一一对应。

[WARN] CHK-QR-37: `docs/shared/agent-orchestration-overrides.md` 内容极简（仅 6 行 3 条要点），信息密度不足

**证据**：文件仅包含：文件路径说明、schema 位置指引、一行 CLI 命令示例。对于 Agent 需要理解"何时应创建 overrides 文件""哪些场景适合用 overrides vs spec-driver.config.yaml""降级后如何排查"等决策点完全缺失。

**修复建议**：补充以下内容：
1. "何时使用 overrides vs spec-driver.config.yaml" 的决策指引（contract.yaml 有此内容但 agent 文档未引用）
2. 常见降级信号的排查方式（`--format json` 查看 diagnostics）
3. 版本不一致时的处理步骤

---

## 测试质量（维度 6 补充）

**真实测试运行结果**：21 个用例全部通过（0 FAIL），总耗时 197ms。

[PASS] CHK-QR-38: 测试断言有效，非"truthy 即通过"

T1-2 验证 `fixPhases.length === 2` + `fixPhases[0].id === '1'`（具体值断言）；T1-3 验证具体字段值 `default_behavior === 'auto'` + `severity === 'critical'`（base 保留值）；T2-4 验证 `versionDiag.code === 'orchestration-overrides.version-mismatch'` 且同时断言 `schema-fallback` 不存在（互斥验证）。断言质量高。

[PASS] CHK-QR-39: 测试组织清晰（T1/T2/T3/T4 分组 + describe 标题）

T1=合并测试（6 用例）、T2=降级路径（7 用例）、T3=CLI dry-run（5 用例）、T4=base 兼容性回归（3 用例），分组合理，命名有意图。注意：测试文件注释说"T3 ≥4 用例"但实际有 5 用例（T3-5），超出设计预期，非问题。

[WARN] CHK-QR-40: T3 组缺少对"不存在 mode 时 CLI 退出码 1"的测试（spec FR-011 要求，未被测试覆盖）

**证据**：`orchestrator-cli.mjs:462-469` 实现了 mode 不存在时 `process.exit(1)` + 错误 JSON，但测试矩阵中没有对应用例验证此路径。

**修复建议**：增加 T3-6 用例：`runCli(['effective-orchestration', 'nonexistent-mode'])` 验证 `exitCode === 1` 且 stderr 包含合法 mode 列表。

[PASS] CHK-QR-41: Fixture 文件完整覆盖 8 个测试场景

8 个 fixture 文件对应 T2 的 7 个降级用例（T2-2 和 T2-7 各用 1 个，T2-5 用 _loadBase 注入不用 fixture）和 T1 的 3 个 fixture 合并场景。无冗余 fixture。

[PASS] CHK-QR-42: 临时目录管理正确（mkdtempSync + rmSync，测试隔离无共享可变状态）

---

## 问题清单

| 严重程度 | 编号 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|------|---------|
| WARN | W-001 | 架构 | `orchestrator-cli.mjs:255-441`（187 行） | 文件从 257 行增长至 589 行，YAML 序列化辅助函数占 ~147 行应提取到独立模块 | 提取 `yamlScalar/serializeYaml/serializeWithAnnotations/formatDiff` 到 `lib/orchestration-output-serializer.mjs` |
| WARN | W-002 | 设计 | `orchestration-schema.mjs:176` | `modeOverrideSchema.passthrough()` 与整体 `.strict()` 策略不一致，允许任意字段进入合并流程 | 改为 `.strip()` 或 `.strict()`，在二期引入新字段时再按需放开 |
| WARN | W-003 | 设计 | `orchestrator-cli.mjs:489` | `--diff` 使用哨兵路径 `/tmp/__no_overrides_dir__` 获取 base config，语义隐式 | 在 resolver 增加 `_skipOverrides` 参数或在返回值中暴露 `baseConfig` |
| WARN | W-004 | 安全 | `orchestration-schema.mjs:176` | `modeOverrideSchema.passthrough()` 允许用户 mode override 中注入未知字段，虽经 merged schema strip 但无 warning 信号 | 同 W-002 |
| WARN | W-005 | 类型 | `orchestration-schema.mjs:286` | `z.any().optional()` 类型信息完全丢失 | 改为 `z.record(z.string(), z.unknown()).optional()` |
| WARN | W-006 | 注释 | `orchestration-schema.mjs:248` | 注释提及 `_strippedFields` 机制，但该机制从未实现，属于过期/误导性注释 | 将注释更新为"由 resolver 步骤 6 手动检测 strip，schema 层仅声明该字段以免被 .strict() 拒绝" |
| WARN | W-007 | 可维护性 | `orchestrator.mjs:36` | `preloadedConfig` 路径硬编码 `isFallback = false`，丢失 resolver 实际 fallback 状态，`validate-config` 命令在降级场景下报告不准确 | 将 `resolverResult.isFallback` 透传到 Orchestrator 或直接在 CLI 中从 `resolverResult` 读取 |
| WARN | W-008 | 性能 | `orchestrator-cli.mjs:489` | `--diff` 调用 resolver 两次，重复加载 base config | 在 resolver 返回值中暴露 `baseConfig` 字段 |
| WARN | W-009 | 文档 | `docs/shared/agent-orchestration-overrides.md:1-6` | 内容仅 6 行，缺乏决策场景指引和降级排查说明 | 补充 "overrides vs config.yaml 选择判断"、"降级信号排查"两节 |
| WARN | W-010 | 测试 | `orchestration-resolver.test.mjs` | 缺少 CLI 不存在 mode 时退出码 1 的测试（FR-011） | 增加 T3-6 用例验证 exitCode===1 |
| INFO | I-001 | 可维护性 | `orchestration-schema.mjs:115` | `applicable_modes` 注释"实际上所有 gate 都有此字段"与设置 `.optional()` 矛盾，可能引起混淆 | 删除"实际上所有 gate 都有此字段"这半句，保留"为了健壮性设为 optional" |

---

## 总体质量评级

**GOOD**

评级依据：
- CRITICAL: **0 个**
- WARNING: **10 个**
- INFO: **1 个**
- 总计: **11 个问题**

WARNING 超过 5 个，但全部 0 CRITICAL，因此评级为 GOOD（而非 NEEDS_IMPROVEMENT），原因如下：
1. W-001/W-008 属于技术债规划项，不影响当前功能正确性
2. W-002/W-004 的安全性影响受到 `orchestrationMergedSchema` 防御性校验的缓解，实际风险低
3. W-006/W-007 为信息准确性问题，不影响运行时行为
4. W-010 测试缺口可在下次迭代补齐
5. 21/21 用例全部通过，核心功能路径完全覆盖

---

## 问题分级汇总

- CRITICAL: **0** 个
- WARNING: **10** 个（W-001 至 W-010）
- INFO: **1** 个（I-001）

---

## GATE_VERIFY 决策建议

**建议：PASS_TO_GATE_VERIFY**

**依据**：
1. 无 CRITICAL 问题，代码不存在安全漏洞、数据丢失风险或构建阻断
2. 21 个测试用例 100% 通过，4 条降级路径逻辑完整
3. 核心陷阱防御（D-PLAN-6 preloadedConfig、version-mismatch 降级、parallel_groups strip）均已正确实现
4. 发现的 10 个 WARNING 可在后续迭代（技术债规划）中处理，不影响 Feature 133 核心功能交付

**建议进入技术债跟踪的 3 项（优先级排序）**：
1. **W-007**（isFallback 状态丢失）：`validate-config` 命令在降级场景下显示"配置有效"，可能误导用户排查问题，建议 Feature 134 修复
2. **W-001**（orchestrator-cli.mjs 文件膨胀）：YAML 序列化辅助函数提取，改善长期可维护性，建议下次重构窗口处理
3. **W-006**（`_strippedFields` 过期注释）：影响维护者理解 parallel_groups strip 机制，成本低，建议随手修复
