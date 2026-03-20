# Quickstart: 组件视图与动态链路文档

## 1. 运行定向单测

```bash
npx vitest run \
  tests/panoramic/component-view-builder.test.ts \
  tests/panoramic/dynamic-scenarios-builder.test.ts
```

## 2. 运行相关回归

```bash
npx vitest run \
  tests/panoramic/architecture-narrative.test.ts \
  tests/panoramic/architecture-ir-generator.test.ts \
  tests/panoramic/event-surface-generator.test.ts \
  tests/integration/batch-panoramic-doc-suite.test.ts
```

## 3. 运行静态校验

```bash
npm run lint
npm run build
```

## 4. 手动验证关注点

1. `component-view.md/.json/.mmd` 已写出，且关键组件不是被 `Test*` / `test_*` 噪音主导。
2. `dynamic-scenarios.md/.json` 已写出，至少 1 条主链路具备 ordered steps、participants、evidence 和 confidence。
3. batch 既有输出如 `architecture-overview`、`architecture-ir`、`architecture-narrative`、ADR 索引仍保持可用。
4. 若可访问 `claude-agent-sdk-python`，重点验证 `Query -> CLI transport -> message parsing` 场景是否成立。
