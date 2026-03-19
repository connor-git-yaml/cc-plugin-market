# Feature 035 技术决策研究

**Feature**: ProjectContext 统一上下文
**日期**: 2026-03-19
**状态**: Completed

---

## Decision 1: ProjectContextSchema 扩展方式

**问题**: 如何在不破坏 Feature 034 已交付代码的前提下扩展 ProjectContextSchema？

**结论**: 使用 Zod `Schema.extend()` 在 `interfaces.ts` 中原地扩展，重新赋值同名变量。

**理由**:
- Zod 的 `.extend()` 方法创建一个新的 Schema，继承原 Schema 的所有字段并添加新字段
- 重新赋值 `ProjectContextSchema` 变量（`let` 而非 `const`，或使用新声明覆盖）保持导出名不变
- Feature 034 的 `schemas.test.ts` 和 `mock-generator.test.ts` 中创建 ProjectContext 时仅使用 `projectRoot` + `configFiles`，扩展新增字段后这些测试**不受影响**——因为 Zod `.extend()` 创建的 Schema 对新增字段提供默认值或标记为 optional
- `type ProjectContext = z.infer<typeof ProjectContextSchema>` 会自动推导扩展后的完整类型

**替代方案**:
1. **新建 FullProjectContextSchema**: 定义独立的完整版 Schema，不修改原 Schema。被拒绝因为会导致两套 Schema/类型并存，消费方需要区分"占位版"和"完整版"，增加认知负担。
2. **在 project-context.ts 中定义新 Schema**: 被拒绝因为会改变 `ProjectContext` 类型的导入路径（从 `interfaces.ts` 变为 `project-context.ts`），破坏现有消费方的 import 语句。

**实现细节**:
- 由于 TypeScript `const` 不允许重新赋值，需要将现有 `export const ProjectContextSchema = ...` 改为先声明基础版再声明扩展版，最终导出扩展版。推荐方式：

```typescript
// 基础版（Feature 034 原始定义）
const BaseProjectContextSchema = z.object({
  projectRoot: z.string().min(1),
  configFiles: z.map(z.string(), z.string()),
});

// 完整版（Feature 035 扩展）
export const ProjectContextSchema = BaseProjectContextSchema.extend({
  packageManager: PackageManagerSchema.default('unknown'),
  workspaceType: WorkspaceTypeSchema.default('single'),
  detectedLanguages: z.array(z.string()).default([]),
  existingSpecs: z.array(z.string()).default([]),
});
```

- 新增字段全部提供 `.default()` 值，确保仅传入 `{ projectRoot, configFiles }` 的旧测试仍可通过 `ProjectContextSchema.parse()`

---

## Decision 2: 包管理器检测优先级

**问题**: 多个 lock 文件共存时如何确定包管理器？

**结论**: 按 `pnpm-lock.yaml > yarn.lock > package-lock.json > uv.lock > Pipfile.lock > go.sum/go.mod > pom.xml > build.gradle(.kts)` 的优先级顺序，取第一个匹配项。

**理由**:
- `pnpm-lock.yaml` 文件名最无歧义（唯一对应 pnpm），优先级最高
- Node.js 生态中 pnpm > yarn > npm 的优先级是 Turborepo、Nx 等 monorepo 工具的常见约定
- 跨语言生态（Node.js vs Python vs Go vs JVM）之间 lock 文件不太可能共存于同一项目根目录，但如果发生，Node.js 生态优先（因为本工具本身运行于 Node.js 环境）

**替代方案**:
1. **返回数组（多包管理器）**: 被拒绝因为增加下游消费复杂度——大部分 Generator 只需要一个主包管理器判断，多值场景（如 Python + Node.js 混合项目）可在 Future Feature 中扩展。
2. **抛出异常**: 被拒绝因为多 lock 文件共存是合法场景（如项目迁移过渡期），抛出异常会中断构建。

---

## Decision 3: pyproject.toml workspace 检测方式

**问题**: 是否引入 TOML 解析库（如 `@ltd/j-toml`）来解析 pyproject.toml？

**结论**: 不引入 TOML 解析库。使用正则表达式 `/^\[tool\.uv\.workspace\]/m` 检测 `[tool.uv.workspace]` 段落头。

**理由**:
- 技术调研明确建议"最小外部依赖：仅用 `fs.existsSync()` + `fs.readFileSync()` 检测，不引入新依赖"
- Constitution 原则 VII（纯 Node.js 生态）约束核心库范围，不宜为单一检测引入新依赖
- spec FR-025 约束不引入新依赖
- `[tool.uv.workspace]` 是 TOML section 标题，在文件中必须独占一行，正则匹配完全足够
- 解析失败（文件损坏）时降级为 `"single"`，无需完整 TOML 解析能力

**替代方案**:
1. **引入 `@ltd/j-toml`**: 被拒绝因为违反"不引入新依赖"约束，且 TOML 解析仅用于一个字段检测，投入产出比不合理
2. **使用 `JSON.parse()` 解析 pyproject.toml**: 被拒绝因为 TOML 和 JSON 语法不兼容

---

## Decision 4: configFiles 扫描策略

**问题**: configFiles 是全量扫描项目所有目录还是仅扫描根目录？

**结论**: 仅扫描项目根目录（深度 1），使用预定义的已知配置文件名列表匹配。

**理由**:
- spec FR-015 明确要求"扫描项目根目录（深度 1，不递归子目录）"
- 递归扫描会导致 Map key 冲突——Monorepo 子包各有 `package.json`，Map 无法存储同名 key
- 子包级配置文件扫描属于 Feature 040（Monorepo 层级架构索引）的职责范围
- 根目录扫描性能确定（O(n) 其中 n 为根目录文件数量），不受项目规模影响

**替代方案**:
1. **递归扫描全项目**: 被拒绝因为 Map key 冲突问题和性能问题（超大项目可能有数千配置文件）
2. **使用 glob 模式匹配**: 被拒绝因为增加复杂度——已知配置文件列表明确，用 `fs.existsSync()` 检测即可

---

## Decision 5: 语言检测复用策略

**问题**: 如何获取 `detectedLanguages` —— 独立实现还是复用 `scanFiles()`？

**结论**: 完全复用 `src/utils/file-scanner.ts` 的 `scanFiles()` 函数，从返回的 `languageStats` Map 提取 key 列表。

**理由**:
- `scanFiles()` 已实现完整的文件遍历、`.gitignore` 过滤、语言适配器匹配和 `languageStats` 聚合逻辑
- `batch-orchestrator.ts:193-197` 已有成熟的调用模式可以参考
- 重复实现语言检测逻辑违反 DRY 原则且容易与现有逻辑不一致
- `scanFiles()` 的性能已在现有使用中验证，无需担忧额外开销

**替代方案**:
1. **独立实现轻量检测**: 仅检查根目录是否存在 `.ts`/`.py` 等标志文件。被拒绝因为无法准确检测多语言项目（标志文件可能被 gitignore）
2. **调用 LanguageAdapterRegistry 但不用 scanFiles**: 需要自行遍历文件。被拒绝因为 scanFiles 已封装了遍历逻辑，重复实现无意义

---

## Decision 6: scanFiles 异常处理

**问题**: 当 `LanguageAdapterRegistry` 未初始化时，`scanFiles()` 会抛出异常（`LanguageAdapterRegistry 未注册任何适配器`），buildProjectContext 如何处理？

**结论**: 在调用 `scanFiles()` 前检查 `LanguageAdapterRegistry.getInstance().isEmpty()`；若为空，跳过语言检测步骤，`detectedLanguages` 返回空数组。

**理由**:
- spec FR-014 明确要求"当 LanguageAdapterRegistry 未初始化时，`detectedLanguages` MUST 返回空数组，不抛出异常"
- `buildProjectContext()` 的调用方可能在 Registry 初始化之前调用（如独立的 ProjectContext 构建场景）
- 其他子流程（包管理器检测、workspace 识别、configFiles 扫描、spec 发现）不依赖 Registry，不应因语言检测异常而中断

**替代方案**:
1. **自动调用 bootstrapAdapters()**: 被拒绝因为引入隐式副作用——调用方可能有自定义 adapter 注册需求
2. **传播异常给调用方**: 被拒绝因为违反 FR-014 要求

---

## Decision 7: existingSpecs 扫描范围

**问题**: `existingSpecs` 是扫描 `specs/` 目录下所有 `.spec.md` 文件，还是扫描整个项目？

**结论**: 仅扫描 `specs/` 目录（递归），匹配 `*.spec.md` 文件。返回绝对路径。

**理由**:
- spec FR-017 明确限定"扫描项目根目录下 `specs/` 目录中的所有 `*.spec.md` 文件"
- reverse-spec 工具的写操作仅允许作用于 `specs/` 目录（Constitution 原则 VI），因此 spec 文件只会出现在此目录
- 全项目扫描可能误匹配用户代码中的 `.spec.md` 文件（如测试 fixture）

**替代方案**:
1. **全项目递归扫描 `*.spec.md`**: 被拒绝因为可能误匹配，且性能不确定
2. **可配置扫描路径**: 被拒绝因为超出 spec 范围——当前版本固定 `specs/` 目录
