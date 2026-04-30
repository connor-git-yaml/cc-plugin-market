# Feature 147: Spectra & Spec Driver 竞品评估平台

> **从"perf 基线"扩展为"全功能 + 竞品对比 + 持续 bench"的评估平台。F143 测了"我们自己的 perf"，本 Feature 测"我们 vs 竞品 + 全功能完善度（含 spec-as-MCP-coding-context）"。**

**Feature ID**: 147  
**Milestone**: M-103 Phase 3 — Large-Scale Reliability & AI-Native Output  
**Wave**: Wave 2  
**类型**: 评估基础设施 + 持续 bench platform  
**状态**: 🔵 Spec 草稿，等待用户审阅 + 决策下一阶段  
**创建日期**: 2026-04-30  
**前置依赖**: F143（baseline infra 已落地）+ F144（E2E fixture 测试基础，部分进展）

---

## 1. 背景与触发

### 1.1 F143 留下的盲点

F143 baseline 只测**性能 + 成本**：
- ✅ 耗时 / Token / Memory / LLM P50/P95
- ✅ Graph 节点边数（数量层）
- ❌ Spec 内容质量（是否准确反映源代码）
- ❌ Graph 拓扑准确性（是否对应真实 import/call）
- ❌ Spec Driver workflow 端到端（specify/plan/tasks/implement gates 完全空白）
- ❌ **Spec 作为 MCP coding-context 的 grounding 能力**（spectra 的 AI for AI 核心价值主张）

如果未来 F140 / F146 改造让 spec 质量退化但耗时下降，F143 baseline 会标"绿色 / 改进"——**这是误导信号风险**。

### 1.2 竞品压力（用户提出）

业界有多个直接竞争对手，但我们尚未做过严肃的功能对比。截至 2026-04：

**Spectra 类（codebase → spec / agent context）**：

| 竞品 | 类型 | repo / 来源 |
|------|------|-------------|
| **Graphify** | 知识图谱（声称 70x fewer tokens）| github.com/safishamsi/graphify |
| **Aider repomap** | tree-sitter + PageRank repo map | aider.chat/docs/repomap |
| **Sourcegraph Cody** | RAG + vector embeddings | sourcegraph.com/cody |
| **RepoMapper / RepoMap** | tree-sitter + MCP server | github.com/pdavis68/RepoMapper |
| **Bloop** | local semantic search（已 archive 2025-01）| github.com/BloopAI/bloop |

**Spec Driver 类（spec-driven coding workflow）**：

| 竞品 | 类型 | repo / 来源 |
|------|------|-------------|
| **SuperPowers**（obra/Jesse Vincent）| Claude Code plugin，brainstorm → plan → RED/GREEN TDD subagents → worktree 隔离 | github.com/obra/superpowers |
| **GStack**（Garry Tan / YC）| 23 个 slash-command skills，think → plan → build → review → test → ship → reflect | github.com/garrytan/gstack |
| Cursor IDE rules | 简单 .cursorrules，缺 native spec management | cursor.sh |
| Copilot Workspace | issue-to-PR，spec 可编辑但不强制 | github.com/features/copilot-workspace |
| Plandex | terminal，open-source，sandbox 大任务 | plandex.ai |
| Devin | 高自治多小时任务，非 spec-first | devin.ai |

**核心问题**：在没有真实对比数据的情况下，我们没法回答 stakeholder 的：
- "Spectra 的 graph 比 Graphify 更准确吗？"
- "Spec Driver 比 SuperPowers / GStack 在真实任务上做得更好吗？"
- "我们 spec 让 LLM 写代码的 grounding 比 Aider repomap 更强吗？"

### 1.3 与 F143 的关系

F143 提供了 **数据层** 基础设施（collector 框架 + workspace 持久化 + fixture schema 1.0 + multi-tool 接口预留），本 Feature **复用** F143 的 collector / fixture 路径设计，只**扩展**评估维度：

- F143：`tests/baseline/<project>/<tool>/<mode>.json`，schema 1.0（perf-only）
- 本 Feature：扩展为 schema 1.1（加 quality / mcp-grounding / task-execution-quality 字段），加新 collector dispatch（spectra 之外的 tool 真正实现），加 evaluator 脚本（opus LLM-as-judge）

---

## 2. Scope

### 2.1 In Scope

#### A. 竞品调研报告（research/）

**deliverable**：`specs/147-competitor-evaluation-platform/research/competitive-landscape.md`（约 200-400 行）

必含章节：
- Spectra 类竞品全盘点（≥ 5 个）：Graphify / Aider repomap / Cody / RepoMapper / 其他
- Spec Driver 类竞品全盘点（≥ 5 个）：SuperPowers / GStack / Cursor rules / Copilot Workspace / Plandex / Devin
- 对每个竞品记录：
  - GitHub URL + commit hash / version pin
  - 核心工作流 / 命令接口
  - 与 spectra/spec-driver 的差异点（关键 distinguish）
  - 可评估性（CLI 自动化跑 vs 必须人手交互）

#### B. 评估维度矩阵设计

**Spectra 维度**（在 micrograd / nanoGPT / self-dogfood 上各跑一次）：
1. Perf：耗时 / token / cost（已由 F143 覆盖，本 Feature 直接复用）
2. **Spec 质量**：
   - 结构完整性（必含章节 grep score）
   - 长度合理性（极短 / 极长 outlier 检测）
   - Cross-link 完整性（broken link 数）
3. **Graph 拓扑准确性**：
   - 边对应真实 import/call 的命中率（解析源码 import + AST，与 graph diff）
   - 孤立节点 / 自循环异常率
4. **Spec-as-coding-context 能力（核心新维度）**：

   **重要修订**（Codex C1）：spectra 当前 MCP server（[src/mcp/server.ts](src/mcp/server.ts)）只注册 tool（`prepare/generate/batch/diff/panoramic-query/graph_*`），**不**有"把 spec 作为 resource 注入 LLM"的机制。本 Feature 不依赖 spectra MCP server 改造，改为 **CLI prompt injection 评估**：
   - eval-judge 把 spectra 反求出的 spec.md 内容**直接拼到测试 LLM 的 prompt 里**（system prompt 前置）
   - 让该 LLM 完成预定义的"小 feature 添加"任务（如 micrograd 加 `Value.relu()`）
   - 对照组 1：无任何 context（裸 prompt + 文件名）
   - 对照组 2：spectra spec context（我们）
   - 对照组 3：Aider repomap context
   - 对照组 4：Graphify context（如可获取）
   - 评估完成质量（unit test pass / opus rubric judge），算 grounding delta（spec context 相比裸 prompt 的提升）

   **Future MCP integration**（不在本 Feature scope）：spectra MCP server 加 `spec_context(projectRoot, target)` resource → 由后续 Feature 实现 → 届时 grounding 评估方式可升级
5. **多模态产物一致性**（F051）：Markdown / JSON / Mermaid 三格式字段交叉验证

**Spec Driver 维度**（worktree 任务派发，用户提议核心创意）：

**前置 feasibility spike（Phase 0 必做，Codex C2）**：
- spec 阶段无法验证"`claude --print --plugin-dir <path> "<prompt>"` 非交互式调用 SuperPowers/GStack 的 slash command 是否可行"
- Phase 0 第一步：手动在 worktree 跑通**至少 1 个工具 + 1 个任务**的 end-to-end，确认派发机制可行
- 如果 SuperPowers / GStack 不支持非交互式 batch 调用，本维度降级为：
  - 选项 A：spec-driver / control 自动跑（这两个我们能完整自动化）+ SuperPowers/GStack 用人工 assisted run（用户进 claude session 输入命令，driver 监测产物）
  - 选项 B：缩小到只评估 spec-driver vs control 对照组（最小可交付）

1. **真实任务集**（4-6 个，每个任务必含 oracle 类型分类，Codex C3）：

   | 任务 | 描述 | 主 oracle | 备 oracle | 估算 LOC |
   |------|------|----------|----------|----------|
   | T1 | micrograd 加 `Value.relu()` 替代方法 | unit-test-only（pytest 跑现有 test 全过 + 新增 1 个 relu 测试通过）| AST diff 检查方法签名 | < 50 |
   | T2 | nanoGPT 加 cosine learning rate scheduler | unit-test + numerical regression（loss 收敛曲线对比 golden）| rubric judge | 100-200 |
   | T3 | self-dogfood 修复注入 bug | unit-test-only（npx vitest run 全绿）| AST diff 反向（确认是否真定位到 root cause）| < 30 |
   | T4 | self-dogfood 提取 magic number 为 const | AST diff（确认 const 出现 + 引用替换）+ test 全绿 | rubric judge（命名质量）| < 50 |
   | T5 | nanoGPT 加 wandb 日志集成 | rubric judge（设计合理性 + wandb API 用法正确）| smoke run（不需要真实 wandb account）| 100-200 |
   | T6 | 违反 constitution 的需求（要 agent 拒绝）| rubric judge（agent 是否 surface 拒绝理由 vs 强行实施）| stop-condition（agent 退出码 / commit 数）| < 10 |

   **任务集合规**：每任务必须有可机械验证的主 oracle（test / AST diff），rubric judge 仅作 secondary。准备时间预算 1-2 day（Phase 3 第一步），含每任务的 fixture 数据（输入文件状态 / expected diff outline / 必跑 test 命令）

2. **派发到 worktree 矩阵**（Codex W11：control 命名替换 baseline，避免与 F143 baseline 混淆）：
   - `~/.spec-driver-bench-worktrees/<task>/spec-driver/` 跑我们自己
   - `~/.spec-driver-bench-worktrees/<task>/superpowers/` 跑 SuperPowers
   - `~/.spec-driver-bench-worktrees/<task>/gstack/` 跑 GStack
   - `~/.spec-driver-bench-worktrees/<task>/control/` 无任何 framework，纯 Claude Code（control 对照组，原命名 `baseline/` 改名）
3. **Worktree 清理设计（Codex W10）**：
   - eval-task-runner 加 `--cleanup=always|on-success|never` flag（默认 on-success：成功后清理，失败保留供调试）
   - 每个 worktree branch 命名前缀 `eval-bench/<task>/<tool>` 便于批量 prune
   - eval pipeline 结束跑 `git worktree prune` 清理 stale 引用
4. **评估维度**：
   - 完成质量（主 oracle 是否过 + opus rubric judge 1-10，**双盲**）
   - 实施时间（wall time）
   - Token 消耗 + cost
   - 用户介入次数（人工 assisted run 时记录）
   - Commit 历史可读性（commit 数 / message 质量 opus judge）
   - 是否破坏现有测试

5. **双盲 judge 设计（Codex C4）**：
   - eval-judge.mjs 对 fixture 输入做 anonymization：
     - 去掉 `meta.tool` / 文件路径里的工具名（用 `<TOOL_A>` / `<TOOL_B>` 替代）
     - commit message 去掉 author + 工具特征 trailer（如 "Co-Authored-By: SuperPowers" / spec-driver 的 `Co-Authored-By: Claude...`）
     - 文件名 normalize（`SPEC.md` / `plan.md` / spec-driver 的 `specs/NNN-*` 都换成 `<DOC_K>`）
     - commit history diff 视图统一为去 metadata 的格式
   - judge 跑完后 reverse-map 恢复工具名，写入 fixture
   - **Inter-rater check**：每个 fixture 跑 judge 2 次（不同 random seed），diff > 1 分时 surface 给用户人工裁决

#### C. 评估流程实现

1. **`scripts/eval-competitor.mjs`** —— 主 evaluator（与 F143 的 baseline-collect.mjs 同级）
   - 复用 F143 collector 抽象（workspace 持久化、schema 1.0/1.1）
   - 新增 dispatch 分支：spectra / graphify / aider-repomap / cody / superpowers / gstack / etc.
   - 输出 fixture：`tests/baseline/<project>/<tool>/<mode>.json`（schema 1.1）
2. **`scripts/eval-judge.mjs`** —— LLM-as-judge（opus）
   - 接受两个 fixture（或一个 fixture + golden）
   - 用 Opus 评分：spec quality / task completion / commit history quality
   - 输出 quality 字段填回 fixture
3. **`scripts/eval-task-runner.mjs`** —— 真实任务派发
   - 接受 task spec + tool 名
   - 创建 worktree
   - 启动对应工具的 CLI / plugin（spec-driver / superpowers / gstack 各有不同）
   - 监测产物 + 测墙钟
   - 写入 fixture

#### D. fixture schema 1.1（minor bump）

在 schema 1.0 基础上加（Codex W6: 删除冗余 evalKind，路径已可区分类型）：

```jsonc
{
  "schemaVersion": "1.1",
  "meta": {
    // ... 1.0 所有字段
    "pinnedAt": "2026-04-30T10:00:00Z",     // Codex W8: 竞品 fixture pin 时间
    "upstreamVersion": "v1.15",             // 竞品的版本 / commit hash
    "staleAfterDate": "2026-10-30"          // 默认 6 个月 staleness threshold；超期 eval:refresh-self 给 warning
  },
  // ... perf / output / phases / dryRun 1.0 字段
  "quality": {                              // 替代 1.0 的 null
    "specStructure": {
      "modulesWithIntent": 17,
      "modulesWithInputsOutputs": 15,
      "averageSpecLines": 245,
      "outliers": ["models.spec.md"]
    },
    "graphSanity": {
      "isolatedNodes": 0,
      "selfLoops": 0,
      "edgesWithMissingTarget": 0,
      "averageDegree": 7.7
    },
    "crossLinks": {
      "totalLinks": 234,
      "brokenLinks": 0
    },
    "codingContextGrounding": {             // 用 prompt injection 评估 spec-as-context（不是 MCP）
      "taskScore": 8.2,                     // opus judge 1-10（双盲）
      "controlScore": 5.4,                  // 裸 prompt 无 context
      "groundingDelta": 2.8,                // 提升幅度
      "judgeRationale": "...",              // 双盲解除后填回
      "interRaterDelta": 0.3                // 同 fixture 跑 2 次 judge 差异
    }
  },
  "taskExecution": {                        // 仅 task-execution 类 fixture 存在（路径在 tests/baseline/tasks/<task-id>/<tool>/）
    "taskId": "T1-micrograd-relu",
    "tool": "spec-driver" | "superpowers" | "gstack" | "control",  // 注：control 替代旧 baseline 命名
    "executionMode": "non-interactive" | "user-assisted",  // feasibility spike 后定
    "wallMs": 723000,
    "tokensTotal": 145000,
    "costUsd": 0.65,
    "userInterventions": 0,                 // user-assisted 时 > 0
    "commits": 3,
    "primaryOracle": {                      // 主 oracle（机械验证）
      "kind": "unit-test" | "ast-diff" | "regression-curve" | "stop-condition",
      "passed": true,
      "details": "..."
    },
    "testsPassed": 12,
    "testsFailed": 0,
    "testsBroken": 0,                       // 改动破坏的现有测试
    "rubricJudgeScore": 8.5,                // opus judge 1-10（双盲）
    "rubricJudgeRationale": "...",          // 双盲解除后填回
    "interRaterDelta": 0.5
  }
}
```

**Schema 1.0 → 1.1 迁移策略（Codex W7）**：
- 老 1.0 fixture（F143 已有的 micrograd / nanoGPT / self-dogfood × spectra full mode）：本 Feature **首次跑** eval-competitor 时强制重生为 1.1（覆盖 1.0 fixture），cost ~$13（同 F143 重跑）
- 重生后 schema 1.1 fixture 含 quality 段（即使 codingContextGrounding 部分维度可能 null，也要有结构占位）
- baseline-diff 工具升级：默认 `--major-only` 兼容（1.0 vs 1.1 跨比 perf 段 OK，quality 段 ignore）；F143 的 `--ignore-quality` flag 保留
- **commit 中标注**：本 Feature Phase 1 的第一个 commit 负责"F143 的 1.0 fixture → 1.1 重生"，独立可回滚

#### E. 成本控制设计（用户明确要求 + Codex C3 调整 judge cost）

| 阶段 | 模型 | 何时跑 |
|------|------|--------|
| Spectra perf baseline（F143 复用）| sonnet 4.6 | 每次 spectra 升版 |
| Spectra spec-quality 维度（C 章节）| sonnet 4.6（生成 spec）+ opus 4.7（judge）| 每次 spectra 升版 |
| Spectra coding-context grounding 维度 | sonnet 4.6（执行小任务 prompt injection）+ opus（judge）| 每次 spectra 升版 |
| **Spectra 竞品 fixture**（Graphify / Aider / **Cody 标 optional/manual**，Codex W9）| sonnet | **只跑一次，结果冷冻**；staleAfterDate 6 月后 warning |
| **Spec Driver 竞品 fixture**（SuperPowers / GStack）| sonnet | 同上 |
| Spec Driver 自己 + control 跨任务执行 | sonnet | 每次 spec-driver 升版 |
| LLM-as-judge（双盲 + inter-rater 2 次）| opus | 每次有新 fixture 进来 |

**首次评估全量预算估算（Codex C3 调整 judge cost +）**：

| 项 | 估算 |
|----|------|
| Spectra 自己 perf 重跑（schema 1.0 → 1.1 重生）| $13（F143 已知）|
| Spectra spec-quality 维度（micrograd/nanoGPT/self-dogfood × structure check + grounding 4 对照组）| $8 |
| Spectra 竞品冷冻（Graphify / Aider × micrograd/nanoGPT/self-dogfood）| $10 |
| Spec Driver 真实任务执行（4 工具 × 4-6 任务 = 16-24 runs，每 run sonnet ~$0.30-0.80）| $20-30 |
| LLM-as-judge（每 fixture × 2 次 inter-rater，约 30-50 fixture × $0.50/judge）| **$30-50**（Codex C3 上调）|
| 调试 / 重跑余量（10-20%）| $10 |
| **首次总（Cody 不算）** | **$90-120** |
| **如加 Cody（manual + 上传 + 索引）** | **+$10-30**（外加 Sourcegraph 账号成本，本 Feature 不评估）|

后续每次（仅自己 + judge）：~$30-40

竞品 fixture 入库后冷冻，但 staleAfterDate 设 6 个月，超期 `eval:refresh-self` 给 warning（不自动重跑，user 决定是否 trigger eval-refresh-competitors）。

**预算超出风险（Codex 风险表）**：每 Phase commit 时 collector 输出 cumulative cost；超 $80 时自动 surface 给用户，超 $120 强制暂停等用户决策

### 2.2 Out of Scope

- **不做 LLM 模型对比**（spectra 跑 sonnet 4.6 就好，不评估 spectra 在 opus / haiku 下表现）
- **不做安装 / onboarding 体验对比**（这些是产品营销维度，不是技术评估）
- **不为竞品报 bug / 提 PR**（仅消费它们的产物用作对比，不参与上游开发）
- **不做 Cursor IDE / Copilot Workspace / Devin 的对比**（这些需要 IDE/Web/Cloud 交互，CLI 自动化困难）
- **不做 commercial 竞品的成本经济性分析**（仅技术维度对比）

---

## 3. 成功标准

| SC | 标准 | 测量方式 |
|----|------|---------|
| SC-001 | 竞品调研报告完整：≥ 5 个 Spectra 类 + ≥ 5 个 Spec Driver 类 | `wc -l` + grep 章节标题 |
| SC-002 | fixture schema 1.1 落地：micrograd / nanoGPT / self-dogfood × spectra 各 1 个含 quality 段的 fixture | `npm run baseline:collect -- --verify-artifacts --schema 1.1` |
| SC-003 | 至少 2 个 Spectra 类竞品（Graphify + Aider）在 micrograd 上有冷冻 fixture | `ls tests/baseline/micrograd/{graphify,aider-repomap}/full.json` |
| SC-004 | 至少 SuperPowers + GStack + spec-driver 三个工具在 ≥ 3 个真实任务上有 task-execution fixture（worktree 派发实测）| `ls tests/baseline/tasks/<task-id>/{spec-driver,superpowers,gstack}/full.json` |
| SC-005 | LLM-as-judge 流程跑通：每个 fixture 有 quality 段填实数字（非 null）| grep `qualityScore` / `taskScore` 非 null |
| SC-006 | 评估总报告（`competitive-evaluation-report.md`）含 quantitative comparison：spectra vs Graphify 在 graph topology accuracy 上的差异 + spec-driver vs SuperPowers/GStack 在真实任务上的 wall/cost/quality 对比 | 文档审 |
| SC-007 | 升版回归命令可用：`npm run eval:refresh-self`（只重跑自己 + judge，不动竞品 fixture）| 命令存在 + 跑通 |
| SC-008 | 总成本 ≤ $120（首次全量，Codex C3 调整后）；后续每次 ≤ $40 | cost summary 加和验证 |
| SC-009 | Release gate（Codex Info12）：触及 spectra `src/{generator,batch,panoramic,graph}/` 或 `plugins/spec-driver/{agents,scripts,contracts}/` 的 PR，merge 前必须跑 `npm run eval:refresh-self` 并在 PR 描述 attach diff vs 冷冻竞品的报告 | CI / pre-commit hook 拦截 |
| SC-010 | Phase 0 feasibility spike PASS：至少 1 个竞品工具 + 1 个任务在 worktree 跑通端到端（确认派发可行）| Phase 0 commit 含手动验证 log |

---

## 4. Phase 化交付（Codex C5 调整估时）

| Phase | 内容 | 估时 |
|-------|------|------|
| Phase 0 | **feasibility spike**（手动验证 SuperPowers/GStack 在 worktree 里非交互式调用是否可行，1-3 hours）+ competitive-landscape.md（≥10 竞品调研，4-6h）+ 评估维度矩阵 + schema 1.1 设计 | **1-1.5 days** |
| Phase 1 | scripts/eval-competitor.mjs（Spectra 类竞品 collector：Graphify + Aider；Cody 标 optional 写文档但不实现）+ schema 1.0 → 1.1 迁移 + F143 fixture 重生 + 单测 | 1.5-2 days |
| Phase 2 | scripts/eval-judge.mjs（opus 双盲 LLM-as-judge）+ Spectra spec-quality / coding-context grounding 维度评估实跑 + inter-rater check | 1.5 days |
| Phase 3 | scripts/eval-task-runner.mjs（worktree 任务派发 + cleanup 设计）+ 真实任务集（T1-T6 含 oracle 类型分类 + golden data）+ SuperPowers/GStack 安装 + driver wrapper（如非交互式可行）/ user-assisted run protocol（如不可行）| 2-3 days |
| Phase 4 | Spec Driver 维度实跑（4 工具 × 4-6 任务）+ judge + worktree 清理 | 1.5-2 days |
| Phase 5 | competitive-evaluation-report.md 总报告 + npm run eval:refresh-self + verification + release gate 文档 | 1 day |
| **总计** | | **8.5-11 days** |

每 Phase 独立 commit，commit message 末尾标 `[Phase N/5]`。

**降级路径**（Phase 0 feasibility spike 后选）：
- 若 SuperPowers/GStack 非交互式调用不可行 → Phase 3/4 改为 user-assisted run，估时 +1 day（用户介入开销）
- 若 SuperPowers/GStack 完全无法在 worktree 跑 → 缩减为"spec-driver vs control"二元对比，本 Feature 范围减半，估时 -3 days

---

## 5. 关键技术决策（plan 阶段细化）

以下需在 plan 阶段进一步决策，spec 阶段先 surface 风险：

### D1: 真实任务集如何选？

候选标准：
- 必须可机器化验证（有 expected output 或自动 test）
- 难度递增（小 feature → 中 feature → 跨模块 → constitution 拒绝）
- 不超过 200 行变更（控制成本）

需在 plan 阶段最终敲定 4-6 个任务的具体描述 + golden output。

### D2: SuperPowers / GStack 在 worktree 中如何启动？

二者都是 Claude Code 的 plugin / skills。worktree 派发时需要：
- 在每个 worktree 启动一个独立的 Claude Code 实例
- 加载对应工具的 plugin / skills 目录
- 提供同一个 prompt（任务描述）
- 监测产物 + 退出条件

需在 plan 阶段评估：是否需要为每个工具写独立的 driver wrapper？还是用统一的 `claude --print --plugin-dir <path>` 接口？

### D3: LLM-as-judge 的评分 prompt 设计

spec quality 和 task quality 评分需要稳定的 rubric。需在 plan 阶段：
- 写出明确的 rubric（每个维度 1-10 分制 + 评分依据）
- 在 micrograd 上做 prompt 调试（确保 opus 评分有 reasonable variance，不全 8 分）
- 跑两次同样 fixture 检查 inter-rater reliability（< 1 分差异为可接受）

### D4: 竞品 commit 锁定策略

冷冻竞品需要 pin 死具体 commit / tag：
- SuperPowers: pin 到本 spec 创建时的最新稳定 release
- GStack: 同上
- Graphify / Aider repomap / Cody: 同上

需在 plan 阶段查看每个 repo 选定具体 commit hash 写入 fixture。

### D5: 评估流程的 reproducibility

类似 F143 的 reproducibility gate（同 commit 重跑差异 < 5%），但 task-execution 维度因 LLM 非确定性，可能 wall / cost 差异 ≥ 20%。需在 plan 阶段：
- 决定是否对 task-execution 跑多次取平均（成本 trade-off）
- 决定是否用 temperature=0（spectra 已是默认）

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|-----|------|
| SuperPowers / GStack 安装在沙箱失败 | 中 | 先在 micrograd 上手动跑通一次，然后再写自动化 driver |
| LLM-as-judge 评分有偏（opus 倾向给高分）| 高 | 双盲 judge：把 fixture 名隐藏，让 opus 不知道哪个是"我们自己" |
| Worktree 任务派发引入了不可控变量（claude session state）| 中 | 每次 worktree 派发用 fresh claude session（不 resume）+ 限定时间窗（如 10 分钟超时） |
| 竞品 spec / repomap 输出格式与 spectra 不同，无法直接比较 graph topology | 高 | 设计统一的 graph 抽象层；不强求格式相同，只比"是否能正确反映 import/call 关系" |
| 真实任务的 golden output 准备成本高 | 中 | 任务集设计时确保 expected output 简单可生成（如：增加方法 → 跑 unit test 即验证） |
| 总成本超预算（$80） | 中 | 每 Phase commit 时检查 cumulative cost，超 60 时 surface 给用户决策是否继续 |

---

## 7. 与现有 Feature 的依赖关系

```
F143 (baseline infrastructure)
  ↓ 复用 collector / fixture 抽象 / workspace 持久化
F144 (E2E fixture 测试基础)
  ↓ 复用 mock LLM 的 vi.mock 模式（用于 Spec Driver 端到端测试，可能借鉴）
F147（本 Feature）
  ↓ 提供"我们 vs 竞品"基线，让 F140 / F148+ 优化决策有横向 reference

  ──── F147 ship 后建立 release gate（Codex Info12）────

F140 / F146 / 后续 spectra/spec-driver 核心 PR（触及上述 src/ 路径）
  ↓ 必须跑 npm run eval:refresh-self
  ↓ PR 描述附 diff report：spectra 维度（vs 冷冻 Graphify/Aider）+ Spec Driver 维度（vs 冷冻 SuperPowers/GStack）
  ↓ 任何 critical regression 阻塞 merge（red severity）
```

本 Feature 不修改 src/spectra 或 plugins/spec-driver 核心代码，只新增 scripts/ + tests/baseline 数据 + CLAUDE.local.md release gate 章节。

**Release gate 的执行机制**（Phase 5 落地）：
- 选项 A：pre-commit / pre-push hook 检测改动文件 → 触发 npm run eval:refresh-self → 生成 diff report
- 选项 B：仅文档约束（`docs/release-gate.md`）+ PR 模板 reminder
- Phase 5 决策（A 强制 / B 软约束）

---

## 8. 验收 Checklist

```bash
# 调研报告
test -f specs/147-competitor-evaluation-platform/research/competitive-landscape.md
grep -c "GitHub URL" specs/147-competitor-evaluation-platform/research/competitive-landscape.md
# 期望 ≥ 10（5 + 5）

# fixture schema 1.1
ls tests/baseline/micrograd/spectra/full.json
node -e "console.log(JSON.parse(require('fs').readFileSync('tests/baseline/micrograd/spectra/full.json')).schemaVersion)"
# 期望 "1.1"

# 竞品冷冻 fixture
ls tests/baseline/micrograd/{graphify,aider-repomap}/full.json
ls tests/baseline/tasks/T1-micrograd-relu/{spec-driver,superpowers,gstack,baseline}/full.json

# 评估报告
test -f specs/147-competitor-evaluation-platform/competitive-evaluation-report.md
grep -E "(spectra vs Graphify|spec-driver vs SuperPowers)" specs/147-competitor-evaluation-platform/competitive-evaluation-report.md

# 升版回归命令
npm run eval:refresh-self -- --verify-artifacts
```

---

## 9. 用户在 spec 阶段的关键确认点

请用户在进入 plan 阶段前确认以下设计选择：

1. **真实任务集的具体内容**（D1 / §2.1.B 表）：6 个任务（T1-T6）含 oracle 类型分类 + 估算 LOC，**是否符合"真实代表性"**？要不要替换某个任务（如把 wandb 集成换成 sqlite 集成？）
2. **竞品列表（Codex W9 调整后）**：
   - Spectra 类：Graphify + Aider 必跑；Cody 标 optional/manual（需 Sourcegraph 账号）。**OK 吗**？要不要加 RepoMapper（github.com/pdavis68/RepoMapper）作为第三个必跑？
   - Spec Driver 类：SuperPowers + GStack + spec-driver + control 四元矩阵。**OK 吗**？
3. **总成本预算（Codex C3 调整后 SC-008）**：$120 首次 / $40 每版本。**接受**还是更紧？
4. **Phase 0 feasibility spike 通过条件（SC-010）**：至少"1 工具 × 1 任务"在 worktree 跑通——**是不是太松**？还是要"2 工具 × 2 任务"才算 PASS？
5. **Release gate 强度**（§7 选项 A/B）：A=hook 强制 / B=文档软约束。**选哪个**？
6. **优先级**：先做 Spectra 维度（B 章节，复用 F143，cost ~$30）还是先做 Spec Driver 维度（C 章节，cost ~$50-70，worktree 派发新创意）？两者都要做，但 Phase 顺序可调
7. **如 Phase 0 feasibility spike 失败（worktree 非交互式跑不通），降级路径**（§4 表后）：
   - A：user-assisted run（用户介入 +1 day）
   - B：缩成 spec-driver vs control 二元对比（-3 days）
   - **你倾向哪个**？

---

*Spec 由 claude-opus-4-7 基于 F143 基础设施 + 用户 implement 阶段反馈 + Perplexity 竞品调研 + Codex 对抗审查（5 critical / 5 warning / 2 info 全部应用）生成。2026-04-30。*
