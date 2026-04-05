# Research Summary: Script Platform 共享层收敛

## 关键结论

1. `plugins/spec-driver/scripts/*.mjs` 已经形成半平台层，但共享抽象只覆盖了 `simple-yaml`、artifact paths 和 project profile resolver，重复点仍明显集中在 YAML、report IO、patch 和 warnings。
2. 当前代码面里至少仍有 3 份本地 `parseYamlDocument`、4 份本地 `stringifyYaml`、2 份近似 `patchCatalogIndex`，以及 5 份相似的 Markdown warning 区块渲染。
3. 078 最稳的路线不是把脚本整体迁到 TypeScript，而是在 `plugins/spec-driver/scripts/lib/` 扩展共享层，让 `.mjs` 入口只保留参数解析和 orchestration。
4. 共享层第一批应优先收敛四类 primitive：YAML、report IO、artifact patch、diagnostics/markdown helpers；不要在 078 里强行统一所有报告模板本身。

## 推荐实现切分

- `simple-yaml.mjs`: 补齐共享 `stringifyYaml`，让 YAML parse / stringify 回到同一处
- `script-report-io.mjs`: 统一 JSON / Markdown / YAML 写入、目录创建、轻量读取
- `product-artifact-patchers.mjs`: 统一 entity / catalog / index patch
- `script-diagnostics.mjs` 或等价 helper: 统一 warnings 去重与 warning section 渲染
- 目标脚本迁移: `entity / workflow / quality / scorecard / adoption / suggestions`

## 主要风险

- 如果抽象层级过高，容易把六类报告强行揉成同一个 renderer，反而增加耦合。
- `quality` 和 `scorecard` 的 patch 字段不同，patch helper 只能抽“读-改-写骨架”和 summary merge，不应硬编码统一 schema。
- 共享 YAML helper 必须保持当前支持子集和 quote 行为，否则集成输出可能出现无意漂移。

## 非目标

- 不在 078 中推进 079 的目录来源收口。
- 不在 078 中推进 080 的版本 / metadata / 文档同步自动化。
- 不在 078 中提前做 081 的大范围热点重构或 `.mjs -> .ts` 迁移。
