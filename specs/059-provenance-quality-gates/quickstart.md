# Quickstart: Provenance 与文档质量门

## 1. 运行定向单测

```bash
npx vitest run \
  tests/panoramic/narrative-provenance-adapter.test.ts \
  tests/panoramic/docs-quality-evaluator.test.ts \
  tests/panoramic/docs-bundle-manifest-reader.test.ts
```

## 2. 运行相关集成与回归

```bash
npx vitest run \
  tests/integration/batch-panoramic-doc-suite.test.ts \
  tests/panoramic/architecture-narrative.test.ts \
  tests/panoramic/pattern-hints-generator.test.ts \
  tests/panoramic/component-view-builder.test.ts \
  tests/panoramic/dynamic-scenarios-builder.test.ts \
  tests/panoramic/adr-decision-pipeline.test.ts
```

## 3. 运行静态校验与全量测试

```bash
npm run lint
npm run build
npm test
```

## 4. 手动验证关注点

1. `quality-report.md` 与 `quality-report.json` 已写出，并且不影响既有 `projectDocs` 输出。
2. README 与 `current-spec.md` 存在冲突的 fixture 会在 report 中产出显式 `conflicts`，而不是只有 warning。
3. `architecture-narrative`、`component-view`、`dynamic-scenarios`、ADR 至少一种 explanation 文档带有 provenance records、`sourceTypes`、`confidence` 与 `inferred`。
4. 缺失 `docs-bundle.yaml` 时，report 状态会降级为 `partial` 或 `warn`，并带 `dependencyWarnings`，但 batch 整体仍成功。
5. 若可访问 `claude-agent-sdk-python` 或等价真实输出目录，重点确认 quality report 的 required-doc 结论与实际项目类型一致。
