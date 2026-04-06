# 技术规划: api-surface-generator.ts 拆分

## 模块依赖图

```
types.ts ← utils.ts ← endpoint-utils.ts
                ↑              ↑
    openapi-extractor.ts       |
    fastapi-extractor.ts  ─────┘
    framework-introspection.ts ←── fastapi-extractor.ts
    express-extractor.ts  ─────┘
                ↑
            index.ts (Generator class + re-exports)
```

## 拆分边界

| 文件 | 原始行范围 | 预估行数 |
|------|-----------|---------|
| types.ts | L17-183 (公开+共享内部类型) | ~100 |
| utils.ts | L184-750 (常量+通用函数，去除 endpoint 函数) | ~370 |
| endpoint-utils.ts | L524-675 (端点级工具函数) | ~160 |
| openapi-extractor.ts | L751-1049 | ~300 |
| fastapi-extractor.ts | L1050-1395 (含 FastAPI 内部类型) | ~350 |
| framework-introspection.ts | L1396-1597 | ~200 |
| express-extractor.ts | L1598-2057 (含 Express 内部类型) | ~400 |
| index.ts | L2059-2168 + re-exports | ~130 |
