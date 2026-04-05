# Verification Report: Script Platform 共享层收敛

## 1. 结论

- 078 已完成 `plugins/spec-driver/scripts/lib/` 共享层收敛，新增统一的 YAML 序列化、artifact IO、product patcher 和 diagnostics helper。
- 六条主链 `entity / workflow / quality / scorecard / adoption / suggestions` 已切换到共享 helper，既有入口和输出合同保持稳定。
- 本地验证通过：共享层 unit tests、六条主链 integration tests、`npm run lint`、`npm run build`、`npm test` 全部通过。
- 在对齐最新 `origin/master` 后，额外修正了 `tests/unit/init-command.test.ts` 对旧 reverse-spec skill 模板文案的过时断言，确保主线恢复全绿。

## 2. 已执行验证

### 2.1 共享层单测

```bash
npx vitest run tests/unit/spec-driver-script-platform.test.ts
```

结果：
- 1 个测试文件 / 5 条测试通过
- 覆盖 `simple-yaml` roundtrip、artifact IO trailing newline / JSON fallback、catalog patch helper、warnings helper 和目标脚本 source scan

### 2.2 六条主链回归

```bash
npx vitest run \
  tests/integration/spec-driver-workflow-registry.test.ts \
  tests/integration/spec-driver-product-quality-reports.test.ts \
  tests/integration/spec-driver-product-scorecards.test.ts \
  tests/integration/spec-driver-adoption-insights.test.ts \
  tests/integration/spec-driver-project-context-suggestions.test.ts \
  tests/integration/spec-driver-product-entity-catalog.test.ts
```

结果：
- 6 个测试文件 / 9 条测试通过
- `workflow / quality / scorecard / adoption / suggestions / entity` 六条链路在切换共享 helper 后仍保持既有 JSON、Markdown、YAML 产物稳定

### 2.3 代码检索

```bash
rg -n "^function parseYamlDocument\\(|^function stringifyYaml\\(|^function dedupeStringValues\\(|^function readJsonFile\\(|^function isScalar\\(" \
  plugins/spec-driver/scripts \
  -g '*.mjs'
```

结果：
- 目标脚本链路中已经不再保留本地 `parseYamlDocument()` / `stringifyYaml()` / `readJsonFile()` 重复实现
- 唯一剩余的 `dedupeStringValues()` 位于 `record-workflow-run.mjs`，不在 078 蓝图要求的六条主链范围内
- `simple-yaml.mjs` 内保留共享 `isScalar()` 作为 `stringifyYaml()` 内部 helper，属于共享层实现本体，不是重复分叉

### 2.4 静态校验与全量测试

```bash
npm run lint
npm run build
npm test
```

结果：
- `npm run lint` 通过
- `npm run build` 通过
- `npm test` 通过，`114` 个测试文件 / `1026` 条测试全绿

## 3. 关键观察

- 078 只收敛脚本平台共享层，没有把整批 `.mjs` 入口整体迁入 `src/**`，保持了 Codex / Claude 双端现有调用面稳定。
- `generate-product-quality-reports.mjs` 与 `generate-product-scorecards.mjs` 现在共享同一套 entity / catalog patch 骨架，后续扩展治理字段时不再需要双份读改写逻辑。
- `generate-workflow-registry.mjs`、`generate-project-context-suggestions.mjs`、`generate-adoption-insights.mjs` 已统一 warnings section contract，Markdown 呈现路径收口到共享 helper。
- 最新主线引入了 reverse-spec canonical skill distribution 收敛；因此本次在 rebase 后同步校正了 `init-command` 的单测断言，使其跟随 canonical source，而不再依赖旧 wrapper 文案。

## 4. 剩余风险

- 078 只覆盖蓝图要求的六条核心链路；边缘脚本如 `record-workflow-run.mjs` 仍保留局部 helper，后续继续推进 081 时应按同一 shared contract 收口。
- 当前 `simple-yaml.mjs` 仍是项目内轻量 YAML 子集实现；如果未来脚本开始依赖更复杂的 anchor / merge key 语义，需要先明确是否扩展共享 parser，而不是重新引入脚本侧分叉。
