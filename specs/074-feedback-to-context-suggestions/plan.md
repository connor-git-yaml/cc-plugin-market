# Implementation Plan

1. 为 Project Context suggestions 增加独立的路径 helper 与生成脚本
2. 聚合 `quality-report`、`scorecard-report`、`adoption-report`，输出带 evidence 的 suggestions YAML / Markdown
3. 将 suggestions helper 接入 `spec-driver-sync` 的技能说明与 workflow artifact 合同
4. 更新 `feature / implement / sync` 的上下文注入约定，明确 suggestions 为 advisory-only
5. 更新 README、product current-spec、product-mapping 与插件版本
6. 重新生成 `.codex` wrappers、Catalog / quality / scorecard / adoption / suggestions 产物
7. 运行集成测试、helper、lint、build，并回填 verification report
