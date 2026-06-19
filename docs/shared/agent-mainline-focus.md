## 当前主线焦点

- 当前 `master` 的活跃研发重心是 **Milestone M8 — 可信度修复 + Spec Drift 旗舰启动**，分三条轨道推进，而非早期的 panoramic 蓝图链路（panoramic 多语言索引 / 跨包依赖 / LLM 语义增强 / 多格式输出已是**既有稳定能力**，不再是活跃焦点）
- **轨道 A 可信度修复**：增量缓存正确性（混合大小写 / 混语言项目）、子代理 MCP 触发率工程、spec-driver 委派契约与编排单源化、分发可靠性（contract 4.3.0 + `spectra --version` build 元数据，npm publish 待显式授权）、评测设施 v2（FAIL_TO_PASS 真实测试执行 oracle）
- **轨道 B 旗舰启动**：AST-anchored Spec Drift Detection（当前仅 spec + prototype，不求 ship；symbol 级指纹 + 点锚路线）
- **轨道 C 领域知识 AI 脚手架**：`scaffold-kb`（厂商文档 → doc-graph + SQLite FTS5）+ KB MCP（`kb_search` / `kb_doc_lookup` / `kb_api_lookup` 厂商库与项目库双层联查）+ spec-driver research 预查注入；KB 内容按 **untrusted evidence** 消费（带 source/version trace + token cap）
- 计划外但已落地的关键能力：`batch --mode graph-only`（纯 AST · 零 LLM · 无需认证的快速建图，新 worktree 首次建图优先用它）、graph node/edge id 相对化（跨 worktree 可移植 + 开箱 bootstrap）、graph 写盘归一化内聚
- 处理 Spectra / 知识图谱相关任务时，优先沿用现有抽象：`ProjectContext`、`GeneratorRegistry`、`ParserRegistry`、`AbstractRegistry`、`AbstractConfigParser`；输出合同已覆盖 Markdown + JSON + Mermaid `.mmd`，涉及 LLM 增强时保留 AST-only 的静默降级路径
