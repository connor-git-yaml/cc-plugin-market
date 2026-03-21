# Quickstart: 文档 Bundle 与发布编排

## 1. 运行定向单测

```bash
npx vitest run tests/panoramic/docs-bundle-orchestrator.test.ts
```

## 2. 运行 batch 集成测试

```bash
npx vitest run tests/integration/batch-doc-bundle-orchestration.test.ts
```

## 3. 运行相关回归

```bash
npx vitest run \
  tests/integration/batch-panoramic-doc-suite.test.ts \
  tests/unit/cli-command-runners.test.ts
```

## 4. 运行静态校验

```bash
npm run lint
npm run build
```

## 5. 手动验证关注点

1. `outputDir` 根目录下存在 `docs-bundle.yaml`，且至少包含 4 个 profile。
2. 每个 profile 都生成了 `mkdocs.yml`、`docs/` 与 `docs/index.md`。
3. 导航顺序体现阅读路径，例如 `index -> architecture-narrative -> architecture-overview -> runtime-topology`。
4. `developer-onboarding`、`architecture-review` 包含模块 spec 区；`api-consumer` 与 `ops-handover` 的文档集合和顺序不同。
5. 缺失某类上游文档时 bundle 仍能生成，并在 manifest 或 landing page 中体现 warning。

## 6. 准真实验证

如本地存在 `claude-agent-sdk-python` fixture，可执行：

```bash
cd /absolute/path/to/claude-agent-sdk-python
reverse-spec batch --force --output-dir specs
```

然后确认至少一个 profile 目录可被 MkDocs / TechDocs 直接读取，并将观察结果写入 `verification/verification-report.md`。
