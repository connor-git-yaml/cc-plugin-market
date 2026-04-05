# Research Summary: 可读性与维护性热点重构

## 关键结论

1. 081 的最佳切入点不是再新增 shared primitive，而是把 078 已提供的 shared layer 用到位，让热点入口文件回到“薄 orchestration 壳”。
2. 当前四个热点的复杂度基线已经足够高：`scorecards` 约 `868` 行、`quality-reports` 约 `599` 行、`workflow-registry` 约 `311` 行、`init-project.sh` 约 `392` 行。
3. 三个 `.mjs` 入口的主要复杂度来源相似：参数解析、领域数据装配、渲染、回写和辅助 helper 仍集中在单文件内；`init-project.sh` 的问题则是阶段逻辑和输出逻辑仍耦合。
4. 081 应优先把热点重构成“入口脚本 + core module/builder/renderer + 现有 shared primitives”的结构，而不是在本次做 `.mjs -> .ts` 迁移或新平台化。

## 推荐实现切分

- `generate-product-scorecards.mjs`
  - 抽离 `rules/rule-loading`
  - 抽离 `product context + evaluation`
  - 抽离 `summary/markdown rendering`
- `generate-product-quality-reports.mjs`
  - 抽离 `document ref collection`
  - 抽离 `stats/status/conflict computation`
  - 抽离 `markdown rendering`
- `generate-workflow-registry.mjs`
  - 抽离 `definitions/overrides/golden paths loading`
  - 抽离 `registry JSON model assembly`
  - 抽离 `markdown rendering`
- `init-project.sh`
  - 继续保留 shell 入口
  - 收敛到清晰的 phase functions 或 shell helper
  - 将输出渲染与状态检测分层

## 主要风险

- 如果 081 试图把 `.mjs` 热点一次性全迁到 TypeScript，会越过蓝图“小范围热点重构”的边界。
- 如果模块切分过细，可能把简单的入口脚本拆成难以追踪的碎片；需要优先按职责边界切分，而不是机械按行数切。
- `init-project.sh` 是主链首跳，任何 JSON 字段漂移都会直接影响 feature/story/fix/implement 流程。

## 非目标

- 不在 081 中推进 079 的 reverse-spec skill 分发收敛。
- 不在 081 中推进 080 的版本 bump / metadata / shared docs 自动同步。
- 不在 081 中重写全部 `plugins/spec-driver/scripts/*.mjs` 或把所有 shell 脚本改写为 Node。
