# Feature 036 技术决策研究

**Feature**: GeneratorRegistry 注册中心
**Date**: 2026-03-19
**Status**: Resolved

---

## Decision 1: 异步过滤策略（filterByContext 内部并发模型）

### 问题

`DocumentGenerator.isApplicable()` 返回 `boolean | Promise<boolean>` 联合类型，filterByContext 需要统一处理。同时需要对 isApplicable 抛异常的 Generator 做容错。

### 结论

采用 `Promise.resolve()` 包装 + `Promise.allSettled()` 并发执行。

### 理由

- `Promise.resolve(syncValue)` 是标准 JS 范式，将同步值统一提升为 Promise，零性能开销
- `Promise.allSettled()` 天然支持错误隔离——rejected 的 Promise 不会中断其他 Promise 的 resolve
- 对比 `Promise.all()`：一个 rejection 会导致整体 reject，不满足 FR-010 的防御性要求
- 对比逐个 `for-await`：无法并发执行，当存在多个异步 isApplicable 时性能退化

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| `Promise.all()` + try/catch 包装 | 并发执行 | 需要手动包装每个 Promise 以捕获异常 | 可行但代码冗余 |
| `for-await` 逐个执行 | 实现简单 | 无并发能力，异步 Generator 多时性能差 | 拒绝 |
| `Promise.allSettled()` | 并发 + 内置错误隔离 | 需要处理 settled 结果类型判断 | **选用** |

---

## Decision 2: 启用/禁用状态存储方式

### 问题

每个 Generator 需要维护启用/禁用状态。状态存储有两种思路：外部 Map 管理 vs 在 Generator 实例上添加属性。

### 结论

采用独立的 `Map<string, boolean>` 存储在 Registry 内部。

### 理由

- Registry 对状态拥有完整所有权，不依赖外部对象的可变性
- DocumentGenerator 接口中所有属性均为 `readonly`，不应修改传入实例的属性
- Map 查找 O(1)，状态更新为简单的 `set(id, boolean)`
- 与 list() 返回的 GeneratorEntry 结构解耦——Entry 是只读视图，不暴露内部 Map

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| Generator 实例上添加 `enabled` 属性 | 状态与实例共存 | 违反 readonly 接口约束；Registry 不应修改外部对象 | 拒绝 |
| 包装类 `EnabledGenerator` | OOP 封装 | 过度设计；增加类型复杂度 | 拒绝 |
| `Map<string, boolean>` | 简单、解耦、O(1) | 需要与 generators Map 同步维护 | **选用** |

---

## Decision 3: 幂等检查策略（bootstrapGenerators）

### 问题

bootstrapGenerators() 需要幂等。现有 bootstrapAdapters() 使用 `getAllAdapters().length > 0` 检查。但 spec 中提到"bootstrapGenerators 在 Registry 已被外部填充后调用"的边界情况。

### 结论

采用 `isEmpty()` 检查（与 bootstrapAdapters 一致的模式），初始阶段不做更精细的检查。

### 理由

- bootstrapAdapters() 已验证此模式在实际运行中可靠
- 当前仅有 1 个内置 Generator（MockReadmeGenerator），外部预填充后再调用 bootstrap 的场景在 Phase 1 不存在
- 如果未来出现外部预填充场景，可以升级为"逐个检查 id 是否已注册"的模式
- YAGNI 原则：不为尚不存在的场景增加复杂度

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| `isEmpty()` 检查 | 简单，与现有模式一致 | 外部已注册 Generator 后会阻止内置 Generator 注册 | **选用**（初始阶段） |
| 标志位 `_bootstrapped` | 明确标记是否已执行 | 新增私有状态，resetInstance 需要重置 | 备选，未来升级时考虑 |
| 逐个 id 检查（`has(id)` + skip） | 最精确，允许外部预填充 | 实现复杂，当前无需 | 拒绝（当前阶段） |

---

## Decision 4: GeneratorEntry 的定义方式

### 问题

list() 方法需要返回包含 Generator 实例和 enabled 状态的列表。需要决定 GeneratorEntry 是 interface、type alias 还是 class。

### 结论

采用 TypeScript `interface` 定义，与项目中其他数据结构的定义风格一致。

### 理由

- GeneratorEntry 是纯数据结构（DTO），不含行为，interface 是最自然的选择
- 与 interfaces.ts 中 GeneratorMetadata、ProjectContext 等类型的定义风格一致
- 不需要 Zod Schema 验证——Entry 是 Registry 内部构造的，不接受外部输入

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| `interface` | 简洁，项目惯例 | 无运行时存在 | **选用** |
| `type alias` | 等价于 interface | 项目中 DTO 倾向用 interface | 可行但非首选 |
| `class` | 可添加方法 | 过度设计，Entry 无行为需求 | 拒绝 |

---

## Decision 5: ID 格式验证的实现方式

### 问题

register() 需要验证 Generator 的 id 符合 kebab-case 格式。可以直接用正则，也可以复用 GeneratorMetadataSchema。

### 结论

直接使用正则表达式 `/^[a-z][a-z0-9-]*$/` 验证，而非调用 `GeneratorMetadataSchema.parse()`。

### 理由

- register() 只需要验证 id 一个字段，不需要验证 name 和 description
- 正则验证比 Zod Schema parse 更轻量，错误消息也更可控
- 正则与 GeneratorMetadataSchema 中的定义保持一致，通过代码注释标注来源

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| 正则验证 | 轻量、错误消息可控 | 需要与 Schema 中的正则保持同步 | **选用** |
| `GeneratorMetadataSchema.pick({id}).parse()` | 自动与 Schema 同步 | 需要构造完整对象或 pick，增加依赖 | 拒绝 |
| `GeneratorMetadataSchema.shape.id.parse()` | 精确到字段级 | Zod parse 异常消息不友好 | 备选 |

---

## Decision 6: 模块组织（同文件 vs 拆分）

### 问题

GeneratorRegistry 类和 bootstrapGenerators() 函数是否应该在同一个文件中定义。

### 结论

同文件定义在 `src/panoramic/generator-registry.ts` 中。

### 理由

- bootstrapGenerators 需要 import GeneratorRegistry 和 MockReadmeGenerator，同文件减少循环依赖风险
- 参照 `src/adapters/index.ts` 中 bootstrapAdapters 的定义模式（虽然在 index.ts 而非 registry.ts 中）
- 当前仅 1 个内置 Generator，bootstrap 函数体量极小（<20 行），不值得单独文件
- 未来内置 Generator 增多时，可以将 bootstrap 拆分到独立文件

### 替代方案

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| 同文件 | 简单，减少文件数 | 文件可能变大 | **选用** |
| 拆分 registry.ts + bootstrap.ts | 职责分离 | 增加无意义的文件间导入 | 拒绝（当前阶段） |
| 定义在 panoramic/index.ts 桶文件 | 与 adapters 模式一致 | 过早创建桶文件，后续 Feature 可能调整 | 拒绝 |
