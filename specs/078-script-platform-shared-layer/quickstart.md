# Quickstart: Script Platform 共享层收敛

## 1. 准备

在仓库根目录执行：

```bash
git fetch origin
git rebase origin/master
```

## 2. 实现顺序

1. 扩展 `plugins/spec-driver/scripts/lib/simple-yaml.mjs`
2. 新增 `plugins/spec-driver/scripts/lib/script-report-io.mjs`
3. 新增 `plugins/spec-driver/scripts/lib/product-artifact-patchers.mjs`
4. 新增 `plugins/spec-driver/scripts/lib/script-diagnostics.mjs`
5. 迁移六条主链脚本到共享层
6. 增加共享层 unit tests 与现有 integration tests 回归

## 3. 定向验证

```bash
npx vitest run tests/unit/spec-driver-script-platform.test.ts
npx vitest run tests/integration/spec-driver-product-entity-catalog.test.ts
npx vitest run tests/integration/spec-driver-workflow-registry.test.ts
npx vitest run tests/integration/spec-driver-product-quality-reports.test.ts
npx vitest run tests/integration/spec-driver-product-scorecards.test.ts
npx vitest run tests/integration/spec-driver-adoption-insights.test.ts
npx vitest run tests/integration/spec-driver-project-context-suggestions.test.ts
```

## 4. 全量验证

```bash
npm run lint
npm run build
npm test
```

## 5. 完成前检查

- 检查 `plugins/spec-driver/scripts/*.mjs` 中不再保留多份本地 `parseYamlDocument` / `stringifyYaml`
- 检查六条主链的输出路径和 JSON payload 未回归
- 提交前再次执行：

```bash
git fetch origin
git rebase origin/master
```
