# Quickstart: 架构模式提示与解释

## 1. 运行定向测试

```bash
npx vitest run tests/panoramic/pattern-hints-generator.test.ts
```

## 2. 运行相关回归

```bash
npx vitest run \
  tests/panoramic/architecture-overview-generator.test.ts \
  tests/panoramic/runtime-topology-generator.test.ts \
  tests/panoramic/generator-registry.test.ts
```

## 3. 运行静态校验

```bash
npm run lint
npm run build
```

## 4. 手动验证关注点

1. 输出是“045 架构概览正文 + 050 模式提示附录”的单份文档，而不是独立黑盒报告。
2. 至少 1 个 pattern hint 包含模式名称、置信度和 evidence 链。
3. 至少 1 个 pattern hint 包含“为何判定 / 为何不是其他模式”的 explanation。
4. 在缺失 deployment 或 layered view 时，pattern hints 仍可生成并带有 warning / confidence 降级说明。
5. 在 `useLLM=true` 但模型不可用时，规则驱动结果仍然可渲染。
