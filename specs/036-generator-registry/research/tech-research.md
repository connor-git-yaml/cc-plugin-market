# Feature 036 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. 现有 LanguageAdapterRegistry 模式

**文件**: `src/adapters/language-adapter-registry.ts`

- **单例**: 懒初始化 + `resetInstance()` 测试支持
- **register()**: 两阶段验证（先检查冲突，后提交），扩展名索引
- **getAdapter(filePath)**: O(1) 扩展名查找
- **getAllAdapters()**: 按注册顺序返回只读数组
- **isEmpty()**: 空状态检查
- **bootstrapAdapters()**: 幂等初始化（`src/adapters/index.ts:37-49`），CLI/MCP 最早时机调用

## 2. DocumentGenerator 接口（034 交付）

**文件**: `src/panoramic/interfaces.ts:179-225`

- 泛型 `<TInput, TOutput>`
- `isApplicable(context)` → `boolean | Promise<boolean>`（需异步处理）
- `id` 强制 kebab-case（`GeneratorMetadataSchema` 正则约束）
- MockReadmeGenerator 已实现完整生命周期

## 3. 与 LanguageAdapterRegistry 的关键差异

| 维度 | AdapterRegistry | GeneratorRegistry |
|------|----------------|-------------------|
| 索引键 | 文件扩展名 | Generator ID |
| 查找 | getAdapter(filePath) | get(id) |
| 过滤 | 无 | filterByContext(ctx) |
| 启用/禁用 | 无 | 有（blueprint 要求） |
| 初始化 | bootstrapAdapters() | bootstrapGenerators() |

## 4. 设计要点

1. **filterByContext** 必须处理 `isApplicable()` 的 Promise 返回（用 `Promise.resolve()` 统一包装）
2. **启用/禁用**: `Map<id, boolean>` 状态管理，list() 包含状态，filterByContext 跳过禁用项
3. **bootstrapGenerators**: 幂等，注册 MockReadmeGenerator + 未来 Generator
4. **ID 冲突检测**: register() 中检查 id 唯一性（类似扩展名冲突检测）
5. **CLI/MCP 调用点**: 紧接 bootstrapAdapters() 后
