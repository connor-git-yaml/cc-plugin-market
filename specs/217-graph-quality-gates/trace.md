# F217 编排 trace

- [20:46] init: worktree graph-topology-canonical-id-1de3ab, baseline 39e4055 == origin/master ✅；orchestration fallback（plugin cache 缺 zod，功能不受影响）
- [20:50] tech_research: STARTED | codebase-scan 模式（跳过 product research：纯仓内基础设施需求）
- [21:00] tech_research: COMPLETED | artifacts=research/tech-research.md | 三大发现：图无 sourceCommit / `_reference` 实体不存在 / graph-only 只收 Python+TS
- [21:02] GATE_RESEARCH(设计决策征询): PAUSE → 用户拍板 D1 freshness=加 graph.sourceCommit；D2 指标e=遗留#+ignored 路径节点；D3 repo:check=强不变量 error 其余 warning；D4 命令形态=单顶层子命令（编排器定，direction-audit 先例）
- [21:05] specify: STARTED
- [21:08] specify: COMPLETED v1 | artifacts=spec.md（25 FR + 7 CONSTRAINT + 13 SC）
- [21:08] codex_review(spec): STARTED（后台）
- [21:17] codex_review(spec): COMPLETED | 3 CRITICAL + 7 WARNING + 4 INFO
  - C3 orphan 定义证伪：research 的"非-contains degree 0"口径实测 83.16% 永不达标；主线程复测 M9 doc 权威口径（degree 0 任意边）：symbol 级 0.00% / 全节点 1.78%（对齐 M9 doc 1.9%）✅
  - C2 字段路径证伪：GraphJSON 无顶层 metadata → 改 graph.sourceCommit
  - C1 dirty worktree 漏洞：增加第四态 dirty（CLI 提示 / repo:check 不告警防每次提交噪音）
- [21:20] specify(revision): STARTED | SendMessage 逐条修订指令
- [21:31] specify(revision): COMPLETED | spec.md 27 FR + 14 SC + exit code 三档固化 + 对抗测试诚实性说明；一致性自检全绿（主线程复核 grep 0 残留）
- [21:33] 主线程补充调研：buildAstGraphOnly 只收 Python+TS/JS collector；Java/Go adapter 已注册 registry（incremental 全语言支持）但不进 graph.json → plan 需设计最小 Java/Go collector 扩展（FR-022~025 前提）
- [21:35] plan: STARTED
