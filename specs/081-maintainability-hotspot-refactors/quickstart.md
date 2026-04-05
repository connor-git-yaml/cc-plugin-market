# Quickstart: 可读性与维护性热点重构

## 1. 目标

在不改变现有 CLI / shell 合同的前提下，完成以下热点的结构重构：

- `plugins/spec-driver/scripts/generate-product-scorecards.mjs`
- `plugins/spec-driver/scripts/generate-product-quality-reports.mjs`
- `plugins/spec-driver/scripts/generate-workflow-registry.mjs`
- `plugins/spec-driver/scripts/init-project.sh`

## 2. 推荐实施顺序

1. 先重构 `workflow-registry`
   - 文件较短，适合作为最小切分样板
2. 再重构 `quality-reports`
   - builder / renderer 边界相对清晰
3. 再重构 `scorecards`
   - 规则最多，复杂度最高，最后推进更稳
4. 最后收 `init-project.sh`
   - 在前三个 JS 热点模式稳定后，再处理 shell phase split

## 3. 核心实现规则

- 入口文件保留，但只负责参数解析和 orchestration
- 领域逻辑优先下沉到 `plugins/spec-driver/scripts/lib/`
- 优先复用 078 的 shared helpers，不复制 YAML / IO / patch / diagnostics
- 不把这批脚本整体迁到 `src/**`

## 4. 验证顺序

### Targeted Unit Tests

```bash
npx vitest run \
  tests/unit/workflow-registry-core.test.ts \
  tests/unit/product-quality-core.test.ts \
  tests/unit/product-scorecard-core.test.ts
```

### Related Integration Tests

```bash
npx vitest run \
  tests/integration/spec-driver-workflow-registry.test.ts \
  tests/integration/spec-driver-product-quality-reports.test.ts \
  tests/integration/spec-driver-product-scorecards.test.ts \
  tests/integration/spec-driver-init-project.test.ts \
  tests/unit/init-command.test.ts \
  tests/integration/init-e2e.test.ts
```

### Full Verification

```bash
npm run lint
npm run build
npm test
```
