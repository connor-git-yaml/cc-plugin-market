## 当前主线焦点

- 当前 `master` 的活跃研发重心已经转到 `src/panoramic/` 蓝图文档链路，而不只是早期的 `reverse-spec` / `spec-driver` 通用能力维护
- Phase 1 已落地的关键能力包括：`WorkspaceIndexGenerator`（Feature 040）、`CrossPackageAnalyzer`（Feature 041）、LLM 语义增强 + 多格式输出（Feature 051）
- 处理 panoramic 相关任务时，优先沿用现有抽象：`ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`
- 当前输出合同已覆盖 Markdown + JSON + Mermaid `.mmd`；涉及 LLM 增强时要保留 AST-only 的静默降级路径
