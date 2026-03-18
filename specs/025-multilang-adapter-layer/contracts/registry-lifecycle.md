---
feature: 025-multilang-adapter-layer
title: Registry 生命周期契约
created: 2026-03-17
---

# Registry 生命周期契约

## 1. 初始化时序

```mermaid
sequenceDiagram
    participant Process as Node.js 进程
    participant Entry as CLI / MCP 入口
    participant Boot as bootstrapAdapters()
    participant Registry as LanguageAdapterRegistry
    participant TsJs as TsJsLanguageAdapter

    Process->>Entry: 启动
    Entry->>Boot: 调用（命令调度前）
    Boot->>Registry: getInstance()
    Registry-->>Boot: 单例实例
    Boot->>Boot: 检查 getAllAdapters().length > 0?
    alt 尚未注册
        Boot->>TsJs: new TsJsLanguageAdapter()
        Boot->>Registry: register(tsJsAdapter)
        Registry->>Registry: 建立 {'.ts'→tsJs, '.tsx'→tsJs, '.js'→tsJs, '.jsx'→tsJs}
    else 已注册（幂等）
        Boot-->>Entry: 跳过
    end
    Entry->>Entry: 命令调度
```

## 2. 运行时查找

```
file-scanner.scanFiles()
  → LanguageAdapterRegistry.getInstance().getSupportedExtensions()
  → Set{'.ts', '.tsx', '.js', '.jsx'}

ast-analyzer.analyzeFile(filePath)
  → LanguageAdapterRegistry.getInstance().getAdapter(filePath)
  → TsJsLanguageAdapter (如果 extname 匹配)
  → null (如果不匹配 → 抛 UnsupportedFileError)
```

## 3. 测试生命周期

```
beforeEach():
  LanguageAdapterRegistry.resetInstance()  // 清空所有注册
  // 按需注册测试所需的 adapter

test():
  const registry = LanguageAdapterRegistry.getInstance()
  registry.register(mockAdapter)  // 或 new TsJsLanguageAdapter()
  // 执行测试逻辑

afterEach():
  LanguageAdapterRegistry.resetInstance()  // 确保无状态泄露
```

## 4. 状态图

```mermaid
stateDiagram-v2
    [*] --> Uninitialized : 进程启动
    Uninitialized --> Empty : getInstance() 首次调用
    Empty --> Registered : register(adapter)
    Registered --> Registered : register(anotherAdapter)
    Registered --> ConflictError : register(冲突扩展名)
    Registered --> Ready : bootstrapAdapters() 完成
    Ready --> QueryResult : getAdapter(filePath)
    Ready --> Uninitialized : resetInstance()（仅测试）

    state Ready {
        [*] --> Lookup
        Lookup --> Found : 扩展名匹配
        Lookup --> NotFound : 扩展名不匹配 → null
    }
```

## 5. 单例保证

| 场景 | 预期行为 |
|------|---------|
| `getInstance()` 连续调用 2 次 | 返回 `===` 相同引用 |
| `resetInstance()` 后 `getInstance()` | 返回新实例（`!==` 旧引用） |
| 新实例的 `getAllAdapters()` | 返回空数组 |
| 新实例的 `getSupportedExtensions()` | 返回空 Set |
| 新实例的 `getAdapter(anyFile)` | 返回 null |

## 6. 并发安全

Node.js 单线程模型下，Registry 的所有操作（register、getAdapter 等）天然线程安全。

异步场景下的保证：
- `register()` 是同步操作，不存在 race condition
- `getAdapter()` 是同步的 Map.get()，不存在 race condition
- `bootstrapAdapters()` 的幂等检查是同步的，不存在 TOCTOU 问题
