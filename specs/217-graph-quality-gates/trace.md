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
- [21:35] plan: STARTED（首次 dispatch 因 API connection error 中断，无部分产物，重试成功）
- [21:52] plan: COMPLETED v1 | artifacts=plan.md（449 行，7 决策 + 文件清单 + 测试策略 + 4 里程碑）
  - 新证据：extractSymbolNodes 为 Python adapter 专有 → Java/Go 无双轨 contains 风险（research 开放问题 #2 在 Java/Go 侧证伪）
- [21:53] commit 4730fe3: spec phase 三制品入库（pre-commit repo:check pass）
- [21:55] codex_review(plan): STARTED（后台；codex-rescue 包装层提前退出，主线程直连 codex-companion 轮询回收——记忆既知 pattern）
- [22:12] codex_review(plan): COMPLETED | 9 CRITICAL + 8 WARNING + 4 INFO，主线程逐条复核全部成立
  - C: Python extraction 节点缺 unifiedKind（分母漏算）/ FR-008 无共享 ignore oracle / verdict 缺 warn 态 /
    dirname(outputDir) 错 projectRoot / graph 命令盖 HEAD=provenance 伪造 / execFileSync 吞 exit1 /
    dist 缺失 skip 让门禁虚设（prepublishOnly 顺序 repo:check 先于 build）/ 统一 fixture 模板 Java·Go 不可实现 /
    正常 fixture 无法驱动 orphan 豁免断言
  - W 关键：generic collector 改直接实例化 adapter（去 registry bootstrap 依赖）/ porcelain -z -uall NUL 协议
    （F204 CRITICAL-7 同族）/ snapshot 混合 metadata 不 bump wrapper（质量门不读 snapshot）/
    graph-mcp-snapshot.test.ts 进 P4 影响面 / collector 提前到 P1
- [22:15] plan(revision) ∥ spec(fixture 载体/verdict 四态/provenance 收紧回改): STARTED 并行（disjoint 文件）
- [22:20] spec(回改): COMPLETED | FR-022/024/025 四语言载体分离（micrograd=Python 本体复用；TS/Java/Go 新建 in-repo 恒实跑）；verdict 四态（pass/pass-with-warnings/fail-strong-invariant/cannot-assess）；FR-009 注入收紧至 AST 重建链（graph 命令写 null / community 透传）
- [22:22] plan(revision) 首次 SendMessage 恢复因 API connection error 二次中断（零编辑落盘，grep 证实 v1 原样）→ 换新代理携带自包含 19 条修订清单重派
- [22:40] plan(revision): COMPLETED | 449→481 行，19 条全应用；主线程 grep 复核 9 标记全命中、dirname(outputDir) 零残留、注入表 runGraphCommand=显式写 null ✅
- [22:42] GATE_DESIGN: AUTO_CONTINUE | spec+plan 均过 Codex 对抗审查并修订闭环；用户拍板决策 D1-D4 已固化；进入 tasks
- [22:44] commit 2b82bd3: plan phase 入库（pre-commit repo:check pass）
- [22:50] tasks: COMPLETED v1 | 46 任务 / P1-P4 骨架 / FR·SC 覆盖映射表
- [22:52] codex_review(tasks): STARTED（后台，同 pattern 主线程直连回收）
- [23:10] codex_review(tasks): COMPLETED | 7 CRITICAL + 6 WARNING：dist 构建依赖缺失 / fixture 仓内建图会写入真实 HEAD /
  ignore 常量私有不可测 / graph-mcp-snapshot 空更新链 / 五项 vs 六项聚合矛盾 / SC-002·007·010·011 过度声明 / TDD 两处违反
- [23:12] 主编排器补充查证：self-dogfood-graph.json 由 F159 入库、F158(f9edd13) 刻意删除 → snapshot 测试有意休眠是既定状态，
  裁定任务合同=验证 skip 语义 + 报告记录，不复活 fixture
- [23:15] tasks(revision) 首次 SendMessage 恢复因 API connection error 三次中断（零编辑）→ 新代理携带自包含 13 条清单重派
- [23:30] tasks(revision): COMPLETED | 46→54 任务；主线程 grep 复核 mktemp/sourceCommit===null/五项/休眠 标记全命中 ✅
- [23:32] GATE_TASKS: AUTO_CONTINUE | tasks 过 Codex 审查修订闭环；进入 implement（P1→P4 顺序执行）
