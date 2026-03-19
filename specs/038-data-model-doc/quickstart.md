# 快速验证指南: Feature 038 — 通用数据模型文档生成

## 前提条件

- Node.js ≥ 20.x
- 项目依赖已安装（`npm install`）

## 快速验证步骤

### 1. 构建项目

```bash
npm run build
```

### 2. 运行单元测试

```bash
npx vitest run tests/panoramic/data-model-generator.test.ts
```

### 3. 验证 GeneratorRegistry 集成

```bash
npx vitest run tests/panoramic/generator-registry.test.ts
```

### 4. 全量测试

```bash
npm test
```

## 预期结果

- `npm run build` 零错误
- DataModelGenerator 单元测试全部通过，覆盖：
  - Python dataclass 字段提取
  - Python Pydantic model 字段提取
  - TypeScript interface 属性提取
  - TypeScript type alias 属性提取
  - Mermaid ER 图生成（继承 + 引用关系）
  - isApplicable() 适用性判断
  - 空结果边界情况
- GeneratorRegistry 集成测试通过（DataModelGenerator 可被发现和调用）
