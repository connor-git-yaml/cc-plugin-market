## 当前主线焦点

- 当前 `master` 正处于 **M8 收官 + Milestone M9 规划启动**：F188 仍是 M8 最后门禁，M9 的正式实施不得绕过它；M9 路线图见 `docs/design/milestone-M9-codex-trusted-live-graph.md`。
- **M9 主题**：Codex 一等支持 + 可信活图 + Spec Drift 首次生产发布；先修分发、worktree/local、图拓扑/新鲜度，再做上层体验。
- **轨道 A Codex First-Class**：`.codex-plugin` 一体分发 Spectra MCP / skills / hooks，补齐 `spec-driver-refactor` wrapper，hooks 做 Codex payload E2E，全局路径尊重 `CODEX_HOME`，模型配置采用 runtime-neutral quality tier。
- **轨道 B Trusted Live Graph**：补 module→symbol `contains`、统一 `#`/`::` symbol ID，新增 duplicate/orphan/dangling/ignored/freshness 质量门；Codex-managed worktree 通过 `.worktreeinclude`、`AGENTS.override.md` 与显式 setup 开箱保活。
- **轨道 C Spec Drift Ship**：把 F189 prototype 推到 `drift link/check` + `repo:check` warning + normalized symbol AST hash；rename-follow 与全仓推断留 M10。
- **轨道 D/E 收口**：拆解 2,561 行 `batch-orchestrator.ts` 的 stage 职责；KB 先做 no-hit coverage gap、版本自动识别与 freshness 状态，再跑一个有界 Spectra→Spec Driver grounding pilot。
- **M10 明确延后**：Wiki 消费面、GraphRAG/symbol semantic retrieval、KB 分级刷新/条件 rerank、brainstorm 扩展、goal_loop 扩面；除非它实际是在修 M9 的 P0 底座缺口。
- 处理 Spectra / 知识图谱任务时继续沿用 `ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；保留 AST-only 静默降级，不创建平行 registry、graph 或 retrieval kernel。
