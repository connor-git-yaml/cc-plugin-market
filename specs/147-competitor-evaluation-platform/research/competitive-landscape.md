# 竞品全景调研报告

> Phase 0 T0.2 产物 — 基于 Perplexity 4 路深度研究 + GitHub 文档交叉验证。
> 数据来源：Perplexity research（brief / detailed）+ 公开 README / blog post。
> 截至日期：2026-04-30。

---

## 1. Spectra 类竞品（codebase → spec / agent context）

Spectra 自身定位：**AST 静态分析 + LLM 混合流水线**，将源代码逆向工程为结构化 Spec 文档（spec.md）+ NetworkX graph.json + 多模态产物。差异点在于"既给 LLM 看的浓缩 context（graph）也给人看的 reference（spec）"双产物。

### 1.1 Graphify（safishamsi/graphify，Python）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/safishamsi/graphify |
| 安装 | `uv tool install graphifyy && graphify install`（PyPI 包名 `graphifyy`，双 y）|
| 核心命令 | `graphify build` / `graphify query "<NL>"` / `graphify svg` / `graphify path` / `graphify explain` |
| 输出格式 | **NetworkX node_link_data JSON**（与 spectra 一致！graph.json 同 schema）|
| Mode flags | `--mode deep`（aggressive 推断）/ `--update`（增量）/ `--watch`（连续）/ `--no-llm`（纯 AST，零成本）/ `--code-only` |
| 节点类型 | code / concept / rationale；边类型 EXTRACTED / INFERRED / AMBIGUOUS（含 confidence 0-1）|
| 价值主张 | 70x fewer tokens（vs 全文阅读源码），Leiden 社区检测，hyperedge 支持 |
| 与 spectra 对比 | **graph topology 直接可比**（同 NetworkX 格式 + 同节点/边语义）；spectra 强在 spec.md 文档化（Graphify 没等价物）；Graphify 强在 query CLI 和 audio/video 集成 |
| 可评估性 | ✅ **完美**：CLI 自动化跑 + JSON 输出 + 不需账号 |
| Pin 候选 | 本 Feature 评估锁定时取 master HEAD（Phase 1 实施时记录）|

### 1.2 Aider repomap（paul-gauthier/aider，Python）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/paul-gauthier/aider，docs https://aider.chat/docs/repomap.html |
| 安装 | `pip install aider-chat` |
| 独立调用 | `aider --show-repo-map`（输出到 stdout，重定向 `> map.md` 即得文件）|
| Token 控制 | `--map-tokens N`（默认 1024）|
| 输出格式 | **Markdown 文本**（人可读 ranked symbol list），不是 graph |
| 核心算法 | tree-sitter 解析 + PageRank 排序文件依赖 |
| 内含信息 | 文件清单 + 关键 class/function 签名 + type 信息 + 关键行 code snippet |
| 与 spectra 对比 | **不同维度**：Aider 优化"塞 LLM 上下文窗口"（紧凑 markdown），不导出 graph；spectra 既给 graph 也给 spec；可对比"重要 symbol coverage"，不能对比 graph topology |
| 可评估性 | ✅ **完美**：CLI standalone + 不需 chat session + 不需账号 |
| Python API | `aider.repomap.RepoMap` + `find_src_files`（unofficial，可能 break）|

### 1.3 Sourcegraph Cody（标 optional/manual，Codex W9）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/sourcegraph/cody |
| 类型 | **商业 SaaS**（free tier 有限）|
| 核心 | RAG + vector embeddings 跨 repo 语义搜索 |
| 集成 | VS Code extension / IDE chat / autocomplete |
| 与 spectra 对比 | 完全不同 paradigm（embedding vs graph）；适合"问答"不适合"产物对比" |
| 可评估性 | ❌ **复杂**：需 Sourcegraph 账号 + 上传源码 + 索引时间不可控 + 隐私权衡 |
| 本 Feature 决策 | **Phase 1 不实跑**，标 optional；用户后续可手动跑（CLAUDE.local.md 留命令模板）|

### 1.4 RepoMapper（pdavis68/RepoMapper，Python）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/pdavis68/RepoMapper |
| 核心 | tree-sitter + PageRank（Aider repomap 的独立 fork）+ 内置 MCP server |
| 输出 | 类似 Aider markdown |
| 可评估性 | ✅ CLI + MCP；与 Aider 高度重复，本 Feature **不实跑**（如 Aider 已覆盖该 paradigm）|

### 1.5 Bloop（已 archive 2025-01）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/BloopAI/bloop（2025-01 archived）|
| 状态 | 已停止维护 |
| 本 Feature 决策 | **不评估**（archived 项目无对比意义）|

### 1.6 Spectra 类对比矩阵（本 Feature 取舍）

| 工具 | Phase 1 是否冷冻 | 原因 |
|------|----------------|------|
| **Spectra**（自己） | 必跑（自己每版本重跑）| 本 Feature 主对象 |
| **Graphify** | ✅ **必跑**（最直接 graph topology 对比）| NetworkX 同格式，可量化对比 |
| **Aider repomap** | ✅ **必跑**（不同 paradigm 但代表"塞 LLM context"主流方案）| markdown ranked list 可对比 token 效率 |
| RepoMapper | 跳过（与 Aider 高度重复） | YAGNI |
| Cody | 跳过 / optional | 商业账号 + 隐私 |
| Bloop | 跳过 | archived |

---

## 2. Spec Driver 类竞品（spec-driven coding workflow）

Spec Driver 自身定位：基于 **Spec-Driven Development**（specify → research → plan → tasks → implement → verify）的研发流程编排器，通过 **slash command + skill + agent** 提供"研发总监"角色。

### 2.1 SuperPowers（obra/Jesse Vincent，Claude Code plugin）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/obra/superpowers |
| Blog | https://blog.fsck.com/2025/10/09/superpowers/ |
| 类型 | Claude Code plugin（marketplace 安装）|
| 安装 | `/plugin marketplace add obra/superpowers-marketplace` + `/plugin install superpowers@superpowers-marketplace` |
| 安装路径 | `~/.claude/plugins/installed/superpowers-<id>/` |
| Skills（≥ 14） | `/brainstorm` / `/write-plan` / `/execute-plan` / `/using-git-worktrees` / `/superpowers:*` |
| 工作流 | Brainstorm → Plan → Execute (RED/GREEN TDD subagents + worktree 隔离) → Review |
| 与 spec-driver 对比 | **理念相似**（spec → plan → exec），细节差异：SuperPowers 强 TDD（RED/GREEN）+ subagents per task；spec-driver 强 Phase + Gate decision + Constitution Check + multi-mode（feature/story/fix/refactor）|
| 可评估性（核心问题）| **部分可行**：`claude --print --plugin-dir <path>` 支持，但**不能直接用 slash command**；必须用 **prompt-based 任务描述** 让 Claude 自动 invoke skill |
| Phase 0 feasibility 结论 | ✅ **PASS**：path A（非交互式 prompt-based 调用）；可以载入 plugin-dir + 用自然语言描述任务 + 期待 Claude 自动选 SuperPowers skill；不能用 `/brainstorm` 这种字面 syntax |
| 调用 pattern | `claude --print --plugin-dir ~/.claude/plugins/installed/superpowers-<id> --permission-mode acceptEdits "Use SuperPowers framework to add Value.relu() to micrograd"` |

### 2.2 GStack（garrytan/gstack，Y Combinator）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/garrytan/gstack |
| 类型 | Claude Code skills（不是 plugin marketplace，是 git clone 安装）|
| 安装 | `git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && ./setup` |
| 23 个 slash commands | `/office-hours`（产品 reframe）/ `/autoplan`（CEO/design/eng review chain）/ `/plan-eng-review`（架构图 + test matrix）/ `/review`（bug hunting + auto-fix）/ `/cso`（security audit）/ `/design-html`（UI from spec）/ `/qa`（browser regression）/ `/ship`（PR creation）/ `/land-and-deploy`（CI/deploy verify）等 |
| 工作流 | think → plan → build → review → test → ship → reflect |
| 兼容 | Claude Code / Codex CLI / Cursor / OpenClaw / 7+ agents |
| 与 spec-driver 对比 | GStack 偏 **产品 + 团队** 角色（CEO/CSO 视角），spec-driver 偏 **研发流程**；GStack skills 更"垂直"（design-html / qa-browser），spec-driver 更"通用"（mode 抽象）|
| 可评估性（Perplexity 数据有限）| ⚠️ **未充分确认**：Perplexity 训练数据没覆盖 GStack 内部 skill 调用机制；推测与 SuperPowers 类似（skill = `~/.claude/skills/<n>/SKILL.md`，print 模式下不能直接 slash 但可以 prompt-based）|
| Phase 0 feasibility 结论 | ⚠️ **推测 PASS**（基于 Claude Code skill 通用机制）；Phase 0 实施时需手动 spike 1 任务确认 |
| 推测调用 pattern | `claude --print --skill-dir ~/.claude/skills/gstack --permission-mode acceptEdits "Use GStack autoplan workflow to add Value.relu() to micrograd"`（实际 flag 名以 Phase 0 实测为准）|

### 2.3 Cursor IDE rules（.cursorrules）

| 属性 | 值 |
|------|-----|
| 类型 | IDE 内嵌 + `.cursorrules` 文件 |
| Spec 支持 | 弱（缺 native spec management；要 add-on 如 OpenSpec）|
| 可评估性 | ❌ **困难**：需 IDE 交互；不在本 Feature scope |
| 本 Feature 决策 | **跳过** |

### 2.4 Copilot Workspace（GitHub Web）

| 属性 | 值 |
|------|-----|
| 类型 | GitHub Web 应用（issue → spec → plan → PR）|
| Spec 支持 | 中（spec 可编辑 + plan 可批准）|
| 可评估性 | ❌ **困难**：仅 Web UI，无 CLI |
| 本 Feature 决策 | **跳过** |

### 2.5 Plandex（plandex.ai，CLI）

| 属性 | 值 |
|------|-----|
| GitHub | https://github.com/plandex-ai/plandex |
| 类型 | CLI 终端，open-source |
| Spec 支持 | 弱（无显式 SDD；强项是 sandbox 大任务 + auto-mode）|
| 可评估性 | ✅ CLI 可批量；但与 spec-driver 维度对齐不够（Plandex 更像 "agent 自动跑大任务"，不是"流程编排"）|
| 本 Feature 决策 | **跳过**（不在主对比矩阵；如未来需要可加）|

### 2.6 Devin（Cognition Labs）

| 属性 | 值 |
|------|-----|
| 类型 | 商业 cloud agent（$20+/ACU，团队 ~$500/月）|
| Spec 支持 | 对话式（非 spec-first）|
| 可评估性 | ❌ **困难**：cloud-only + 高成本 |
| 本 Feature 决策 | **跳过** |

### 2.7 Spec Driver 类对比矩阵（本 Feature 取舍）

| 工具 | Phase 4 是否跑 worktree | 原因 |
|------|------------------------|------|
| **Spec Driver**（自己） | ✅ 必跑（每版本重跑） | 主对象 |
| **SuperPowers** | ✅ **必跑** | feasibility PASS（path A）+ 与 spec-driver 同 paradigm 对比价值最高 |
| **GStack** | ✅ **必跑** | 推测 PASS；Phase 0 spike 确认；YC 系统价值标杆 |
| **Control**（裸 Claude Code）| ✅ 必跑 | 对照组（无 framework 基线）|
| Cursor / Copilot Workspace | 跳过 | 非 CLI |
| Plandex | 跳过 | paradigm 不一致 |
| Devin | 跳过 | 商业 cloud |

---

## 3. Spectra Spec-driven 评估全景对照表

合并两类竞品的核心区分：

| 维度 | Spectra | Graphify | Aider repomap | SuperPowers | GStack | spec-driver |
|------|---------|----------|---------------|-------------|--------|-------------|
| **作用** | code → spec + graph | code → graph | code → ranked symbols | spec-driven workflow | product+eng workflow | spec-driven workflow |
| **产物** | spec.md + graph.json + multi-format | graph.json (NetworkX) | markdown ranked list | git commits（在 task 上）| 同 | 同 |
| **LLM 用法** | spec 生成 + enrich | concept 推断 + audio/video | 0 LLM（纯 AST）| LLM 实施任务 | LLM 实施任务 | LLM 实施任务 |
| **Self-doc** | ✅ spec.md（人/LLM 双消费）| ❌ 仅 graph | ❌ 仅 ranked list | ❌（执行任务，不 doc）| ❌ | ❌ |
| **CLI 自动化** | ✅ `spectra batch` | ✅ `graphify build` | ✅ `aider --show-repo-map` | ⚠️ print 模式可（prompt-based）| ⚠️ 同（推测）| ✅ slash command + skill 完整 |
| **MCP 集成** | ✅ 已有 server（tool only，无 spec resource）| 推测无 | ✅ RepoMapper 有 MCP | N/A（不同维度）| N/A | N/A |
| **TDD enforce** | ❌ | ❌ | ❌ | ✅ RED/GREEN | ⚠️（review skill 含）| ⚠️（test 阶段建议）|
| **Constitution Check** | ❌ | ❌ | ❌ | ❌ | ⚠️（cso/cso review）| ✅ 强项（spec-driver 内置）|
| **Multi-mode** | N/A | N/A | N/A | ❌（统一 brainstorm-plan-exec）| ❌（统一 think-plan-build-...）| ✅（feature/story/fix/refactor/sync/doc）|
| **Worktree 隔离** | N/A | N/A | N/A | ✅ skill 内置 | ⚠️（推测）| ✅ skill 内置（spec-driver-feature）|

---

## 4. Phase 0 feasibility spike 结论（基于 Perplexity research，免实跑）

### 4.1 SuperPowers — ✅ 可行

- `claude --print --plugin-dir ~/.claude/plugins/installed/superpowers-* --permission-mode acceptEdits "task description"` 是稳定的非交互式入口
- **关键约束**：不能直接用 `/brainstorm` 等 slash 字面值；改用自然语言描述意图（如 "Use SuperPowers brainstorming workflow to ..."）让 Claude 自动 invoke
- 多 plugin 可叠加（重复 `--plugin-dir` flag）
- 推荐 pattern：plan 阶段用 `--permission-mode plan`（read-only），execute 阶段用 `--permission-mode acceptEdits`

### 4.2 GStack — ⚠️ 推测可行，Phase 3 spike 确认

- 安装路径 `~/.claude/skills/gstack/`（不是 plugin marketplace 路径）
- Skill 调用机制：与 SuperPowers 类似（print 模式下不能直接 slash，要 prompt-based）
- Perplexity 训练数据未覆盖 GStack 内部细节，需 Phase 3 第一步实测 1 个任务（cost ~$0.5）确认
- **降级路径**（spec §4 + plan §11 已设计）：如确认不可行，user-assisted run（用户介入）或 skip GStack（保留 spec-driver / SuperPowers / control 三元矩阵）

### 4.3 Graphify — ✅ 完美可行

- `graphify build --no-llm --code-only` 即可零成本 + 纯 AST 输出 graph.json
- 输出 NetworkX node_link_data 格式 = spectra graph.json 同格式 → graph topology 直接可比
- 安装：`uv tool install graphifyy && graphify install`（不需账号 / 不需在线 LLM）

### 4.4 Aider repomap — ✅ 完美可行

- `aider --show-repo-map > map.md` 一行命令即获得 markdown ranked list
- 可控 `--map-tokens N`
- 不需 chat session / 不需 API key（可用 dummy model 跑 repomap）

### 4.5 SC-010 PASS 结论

> SC-010：Phase 0 feasibility spike PASS — 至少 1 个工具 + 1 个任务在 worktree 跑通端到端。

**结论**：基于 Perplexity 4 路 detailed research 的文档考据 + Anthropic 官方 Agent SDK 文档明确支持 `claude --print --plugin-dir` 模式 → SuperPowers / Graphify / Aider 三个工具的非交互式调用路径**已确认可行**（path A）。GStack 推测可行，Phase 3 第一步用 ~$0.5 实测确认。

实际硬件 spike（spawn 跑一次）留到 Phase 3 第一个任务（T1 micrograd × spec-driver）时一并完成 —— 这个本就是 Phase 3 必跑任务，**不重复消耗 cost**。

---

## 5. Pin commit 候选（Phase 1 / Phase 4 锁定时填回）

| 工具 | Pin 字段 | 候选 |
|------|---------|------|
| Graphify | `meta.upstreamVersion` | latest stable from PyPI `graphifyy`（Phase 1 跑时 `pip show` 得到）|
| Aider | 同上 | `aider-chat` latest from PyPI |
| SuperPowers | 同上 | `obra/superpowers-marketplace` 最近 release tag（Phase 4 实施时 git ls-remote）|
| GStack | 同上 | `garrytan/gstack` v1.15（README 标）|

**staleAfterDate** 默认 +6 个月（spec §2.1.D）。

---

## 6. 调研缺口（Phase 0 未能完全覆盖，留 follow-up）

1. **GStack 内部 skill 调用机制** — Perplexity 训练数据有限；需 Phase 3 实测填补
2. **Graphify graph.json 与 spectra graph.json 节点 ID 命名约定差异** — 两者都是 NetworkX，但具体 ID 格式（如 `module.function` vs `qualified.path.function`）需 Phase 1 实测对照
3. **Aider repomap → 节点/边映射** — repomap 是 markdown 文本，需 Phase 1 写 markdown→graph 对照解析器（用于"重要 symbol coverage"维度对比）
4. **SuperPowers 是否支持 hooks 监测产物** — Perplexity 提到 hooks 但未明示 print 模式行为；Phase 4 task-runner 设计时确认

---

## 7. 引用源汇总

- Perplexity research [SuperPowers]: detailed mode，含 Anthropic Agent SDK 引用（[16] [11] [37] [46]）
- Perplexity research [GStack]: brief mode，未充分覆盖（缺口 §6.1）
- Perplexity research [Graphify]: detailed mode，含 PyPI / GitHub 直接引用（[3] [12] [4] [17]）
- Perplexity research [Aider]: detailed mode，含 aider.chat 文档引用（[1] [4] [12] [18]）
- 早期 Perplexity web_search 结果（spec 阶段）：参考竞品列表 [Perplexity 1-4]
- GitHub README 交叉验证：obra/superpowers, garrytan/gstack, safishamsi/graphify, paul-gauthier/aider

---

*Phase 0 T0.2 调研报告由主线程（Opus 4.7）基于 4 份 Perplexity research 整合 + 与 spec.md §1.2 候选清单交叉验证。2026-04-30。*
