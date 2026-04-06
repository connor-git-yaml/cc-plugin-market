# F-094-01: api-surface-generator.ts God File 拆分

## 1. 意图

将 `src/panoramic/api-surface-generator.ts`（2,168 行）拆分为 `src/panoramic/api-surface/` 下 8 个子模块，消除项目最大单体文件，提升可维护性。

## 2. 功能需求

- FR-1: 按注释分隔符边界拆分为 types / utils / endpoint-utils / openapi-extractor / fastapi-extractor / framework-introspection / express-extractor / index 共 8 个文件
- FR-2: 所有公开导出（ApiSurfaceGenerator 类 + 7 个类型）保持不变
- FR-3: 现有测试更新导入路径后全量通过
- FR-4: 每个子模块不超过 400 行

## 3. 约束

- ESM（"type": "module"），导入路径使用 `.js` 后缀
- 不改变任何运行时行为
- `src/panoramic/index.ts` 导出集合不变
