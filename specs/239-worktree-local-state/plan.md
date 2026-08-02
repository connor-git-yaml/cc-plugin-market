---
feature: 239-worktree-local-state
title: Worktree 与 Local 状态 — 技术方案
status: draft
created: 2026-08-02
spec_basis: specs/239-worktree-local-state/spec.md
research_basis: specs/239-worktree-local-state/research/tech-research.md
measurements_basis: specs/239-worktree-local-state/research/orchestrator-measurements.md
review_round: 1
review_basis: reviews/codex-plan-review-round1.md
---

# Feature 239 技术方案

> **Round 1 修订说明**：本版本响应 `reviews/codex-plan-review-round1.md` 的 11 CRITICAL + 3 WARNING（主编排器逐条判定全部为真），并采信 `orchestrator-measurements.md` §M10 的新证据（全局 `spectra graph-quality --json` 可用性 + "spectra graph" 误触毁图事故）。14 条修订全部落进对应正文章节，不做"开头一段响应了事"的敷衍处理；每处修订标注 `（C1）`~`（C11）`/`（W1）`~`（W3）` 便于溯源核对。

## 摘要

本方案在**不改变现有 SYMLINK_TARGETS/COPY_TARGETS 语义**的前提下，把 `.env.local` 的硬编码清单外化为官方 `.worktreeinclude`（单源、双消费者、各自触发）；新增一层 bash 侧 containment 校验作为防线（Round 1 后扩展为九类拒绝，含尾斜杠/未忽略/非常规文件三个新增 reason，见 C5）；用一个新的 Node 纯函数模块（`scripts/lib/graph-bootstrap-status.mjs`）承载 graph provenance 状态机（结构化状态文件、四事实追踪的 `bootstrapSource` 判定、F193 sidecar **移除并做迁移性删除**、freshness 通过 spawn 全局 `spectra graph-quality --json` 复用 F217 canonical 四态实现，不再自行重写子集，见 C3/C4），彻底关闭 M4/M6 实测的"本地重建路径 provenance 失准"缺陷；`worktree-lifecycle.sh` 的 `create` 分支从"完全静默吞错"改为"失败可见、仍不阻断"，并显式处理 `node` 不可用场景（见 C1）；新增 `AGENTS.override.md` 的 ignored 前提与 `AGENTS.md`/`AGENTS.override.md` 字节预算校验，接入 `repo:check` 第 14 族 `worktree-local-state`（并修复该接入对两个既有集成沙箱测试的回归风险，见 C7）。全部改动遵循"红测试 / characterization guard → 实现 → 回归"三类标注（W3），不再笼统声称"每个 FR 先红"。

不改动范围：`.codex-plugin`、`plugins/spec-driver/` 除 `worktree-lifecycle.sh` 外的 wrapper 链、F215 fixture、`src/panoramic/graph/quality/**` 内部实现（本方案只 spawn 其编译进全局 CLI 的可执行形态，不 import/不复制其代码）。

---

## 架构决策

### 决策 1：F193 sidecar 处置 —— **完全移除（选项 b），不做同步更新（选项 a），并新增迁移性删除（C10）**

**选项对比**：
- (a) 让 `specs/_meta/.graph-source-commit` sidecar 在本地重建路径也同步写入，与新状态文件并存。
- (b) 由新状态文件（读 `graph.json` 内嵌 `graph.sourceCommit` 现算）完全取代 sidecar，删除 sidecar 的独立写入/读取逻辑，并对**已存在的遗留 sidecar 文件**做迁移性删除。

**选择**：(b)。

**理由**（为什么不选 (a)）：
1. sidecar 在**当前代码**里只在 `bootstrap_graph` 检测到"本次确实从主仓 copy 了图"时才写（`sync-worktree-local-state.sh:348-358`），记录的是 `git -C "$PRIMARY_ROOT" rev-parse HEAD`——这本身与"图的真实来源 commit"是两个概念。选项 (a) 若要"正确"同步更新，必须在**所有可能改变 worktree 内 `graph.json` 内容的路径**都触发写入——但这些路径不止 `bootstrap_graph`：开发者可以直接在 worktree 内手跑 `spectra batch`（full 或 `--mode graph-only`）/ `spectra watch`（内部经 `runBatch`），这些命令完全不经过 `sync-worktree-local-state.sh`。**（W2 修正）**：此前草稿误列 `spectra index` 也会更新该字段——实测 `spectra index` 只构建并落盘 `.spectra` UnifiedGraph 快照（`src/cli/commands/index.ts:156`），**不写** `graph.json.graph.sourceCommit`；全仓精确排查，写入该字段的入口只有 `batch`（full/graph-only 两模式）与经 `runBatch` 的 `watch`。已从论据中删除 `spectra index` 这一例，不影响选项 (b) 的结论——选项 (a) 依然无法覆盖 `batch`/`watch` 这些不经过本脚本的路径，等于无法真正修复 M4/M6。
2. `graph.json` 内嵌的 `graph.sourceCommit` 字段（`src/batch/stages/graph-assembly.ts:255`，F217 FR-009 注入）在 `batch`（两模式）与 `watch` 两类真实构建入口都无条件写入，是唯一在这些路径下都保持正确的数据源。选项 (b) 直接复用它。
3. sidecar 的**唯一运行时消费者**是本脚本自己的 `check_graph_source_stale`（B4/B1 已确认无其他执行代码消费它）——**但（I1 修正，采纳审查意见）不能因此声称"删除无外部影响"**：全仓精确搜索 `rg -n --hidden --glob '!.git/**' --fixed-strings '.graph-source-commit'` 返回 **17 处 / 10 个文件**，除运行时代码外还包括 `docs/spectra-cli-reference.md:172` 的现行公开文档描述、F193 历史测试制品与本 feature 文档自身。因此"移除"必须同时处理：(i) **代码**（写入/读取逻辑删除）、(ii) **已存在的遗留文件**（迁移性删除，见下）、(iii) **公开文档**（更新为新状态文件合同）；F193 历史 spec/plan/tasks 作为历史制品保留，不篡改，仅在本 feature 文档中标注 superseded。

**落地（含 C10 迁移性删除）**：
- 删除 `SOURCE_COMMIT_REL` 常量、`bootstrap_graph()` 内"仅当 copy 才写 sidecar"的 3 行、旧 `check_graph_source_stale()` 函数体（保留同名函数作为向后兼容的日志入口，内部改为委托 `checkFreshness` adapter，见决策 5）。
- **迁移性删除（C10 新增）**：`writeBootstrapStatus()` 在**新状态文件成功原子落盘之后**（而非之前，避免"新文件还没写成功、旧 sidecar 先没了"的中间态），检查 `specs/_meta/.graph-source-commit` 是否存在，存在则删除（`fs.unlinkSync`，包一层 try/catch，删除失败不影响主流程/不使整个 write-status 调用失败，只追加一条 warning）。`--dry-run` 模式下**只报告**"将删除遗留 sidecar: `<path>`"，不实际删除。
- 更新 `docs/spectra-cli-reference.md:171-173`（原文"A `specs/_meta/.graph-source-commit` sidecar records the source commit; if the worktree HEAD later diverges, re-running the hook prints a non-blocking *stale* hint."）为描述新状态文件合同（`specs/_meta/graph-bootstrap-status.json` + freshness 现算，不缓存 stale 布尔值）。
- **不**在 `.gitignore` 中新增/删除关于 `.graph-source-commit` 的规则（该文件从未被显式收录，靠 `specs/_meta/` 整体忽略规则覆盖，删除后也不留痕）。

**回滚方案修正（C10）**：原方案"临时回退到 sidecar 只读、新状态文件并存"**已废弃**——并存违反 spec 回归护栏第 5 条"不允许三套并存"的不变量，不能作为合规的降级预案。批 3 的回滚统一为**revert 本批次对应的 commit**（见风险与回滚章节）。

---

### 决策 2：Codex-managed worktree bootstrap 入口形态 —— **复用现有 sync 脚本 + 新增 `--attempt-build` flag，不新建脚本，不新增 npm script；新增 Node 可用性防护（C1）与发布竞态防护（C11）**

**选项对比**：
- (a) 新建独立脚本，复制一份 `PRIMARY_ROOT` 解析 + 图构建逻辑。
- (b) 给现有 `sync-worktree-local-state.sh` 新增一个 `--attempt-build` flag，复用其已验证的 `PRIMARY_ROOT` 推导逻辑。
- (c) 新增 npm script 包装指向 (b)。

**选择**：(b)，且**不额外做 (c)**——不改动 `package.json`。

**理由**：
1. 为什么不选 (a)：会重复实现已被 397 行既有测试验证过的 `PRIMARY_ROOT` 解析、`migrate_legacy_agents_symlink` 前置迁移、`bootstrap_graph` 内发布逻辑（C11 重构后的硬链接排他发布，见下）——这些逻辑与"是否要额外尝试本地构建"正交，复制会造成两份实现漂移风险。
2. 为什么用 flag 而非默认行为改变：手工 worktree 场景（`worktree-lifecycle.sh` 无 flag 调用）不应默认触发自动构建，精确对应 FR-010 "只对 Codex-managed 场景要求尝试构建"的范围。
3. 为什么不额外加 npm script：spec 回归护栏第 7 条的允许触面清单未列出 `package.json`；`bash scripts/sync-worktree-local-state.sh --attempt-build` 本身已是一条可被任意 setup 脚本直接调用的命令，额外改 `package.json` 属于超出明确允许触面的改动。

**行为规格（C1 修订：删除"默认行为完全不变"的不实表述）**：

> **原表述"不带该 flag 时行为与现状完全一致"不成立，已删除。** 实测（审查沙盒实证）：`PATH=/usr/bin:/bin /bin/bash -c 'set -euo pipefail; node missing-helper.mjs; echo after'` → `/bin/bash: node: command not found`，`exit_status=127`；脚本头部 `set -euo pipefail` 意味着**任何**未加条件保护的 `node ...` 调用一旦 `node` 不在 `PATH`，整个 sync 立即以 127 中断，后续 SYMLINK_TARGETS/COPY_TARGETS 步骤全部被跳过——而 Round 1 之前的草稿在默认路径（无 `--attempt-build`）也会无条件调用 `node .../graph-bootstrap-status.mjs write-status`，这本身就是一个新增的、未声明的运行时前提。

**修正后的准确行为规格**：
- `bootstrap_graph()` 内**所有** `node scripts/lib/graph-bootstrap-status.mjs <subcommand>` 调用（`write-status`/`check-freshness`/`attempt-build`）必须包在显式条件分支内：
  ```bash
  if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/lib/graph-bootstrap-status.mjs" write-status ...
  else
    warn "状态文件写入跳过：node 不可用"
  fi
  ```
- `node` 缺失时：状态文件写入/freshness 现算/`--attempt-build` 本地构建三者**全部跳过**（因为三者都经由该 Node helper），仅输出**一条**明确 warning，**其余 sync 步骤（SYMLINK_TARGETS 软链、`.worktreeinclude` copy 类同步、`migrate_legacy_agents_symlink`）照常完成**，脚本以 0 退出，绝不触发 `set -e` 中断。
- **准确的默认路径副作用描述**（替代已删除的"完全不变"）：**默认路径（无 `--attempt-build`）唯一新增副作用 = `node` 可用时额外写一份状态文件；`node` 缺失时额外产生一条 warning。** 除此之外，SYMLINK_TARGETS/COPY_TARGETS 的既有行为不变。
- `--attempt-build` 仅影响 `bootstrap_graph()` 内部一处分支——当既无法从主仓 copy 到图、worktree 自身也无图时，若带该 flag 且 `node` 可用，调用 `attemptLocalGraphBuild()`（决策 5，异步 `spawn` + 独立进程组 + 45s deadline，见 C2）；成功则记 `buildSucceeded=true`，失败（`spectra` 不在 PATH、非零退出、超时）则记 `buildSucceeded=false`，两者都会反映进决策 5/C4 重写后的 `bootstrapSource` 状态机。

**发布竞态防护（C11 新增）**：`copy_if_absent_atomic()`（`sync-worktree-local-state.sh:273-310`）当前的"发布"步骤是"确认 target 仍不存在 → 普通 `mv`"（`:301-306`）——**这不是真正的 no-clobber**：两个进程可以都通过"确认不存在"的检查窗口，随后各自的普通 `mv` 互相覆盖（后执行者赢，静默丢弃先到达的版本）。审查实证竞态窗口正位于 `:299` 到 `:306` 之间（例如 post-commit 钩子刚生成本地图，紧接着 bootstrap 的 `mv` 仍会覆盖它）。**修法**：把发布步骤改为**硬链接排他发布**：
```bash
if ln "$tmp" "$target_path" 2>/dev/null; then
  # 赢得发布：本进程的版本成为 target
  run rm -f "$tmp"
  COPY_RESULT="copied"
else
  # ln 失败（EEXIST 或其他）= 对方已发布（或 target 并发出现），保留对方版本
  log "graph bootstrap: ${label} 期间目标已被其他进程发布，保留对方版本（清理 tmp）"
  run rm -f "$tmp"
fi
```
`ln` 在 POSIX 文件系统上的"目标已存在则失败"是内核级原子操作（不像"检查+`mv`"存在 TOCTOU 窗口），两个并发进程中只有一个能成功建立到 `target_path` 的硬链接，另一个必然拿到 `EEXIST`。**为什么不写双进程竞态测试**：真正触发这条竞态需要两个进程精确同时通过检查窗口，用测试制造这种时序（barrier 同步两个子进程）历史上已被 F233/F235 证明是 flaky 温床（宿主机负载/调度抖动导致时序不可控）；改为**确定性原语级测试**：预置 `target_path` 已存在（模拟"对方已发布"），直接调用发布函数，断言 (a) 已存在的 target 内容不被覆盖、(b) 本次的 `tmp` 文件被清理——这不依赖任何时序假设，100% 确定性，同样能验证 `ln`-EEXIST 分支的正确性。

**已复核**（主编排器）：copy-优先/build-兜底的顺序是刻意设计——主仓若已有图（哪怕 stale）优先 copy 而非直接触发本地重建，因为主仓图很可能经过 LLM 语义富化，自动重建会用零 LLM 的 `graph-only` 结果静默替换掉一张信息量更高的图；"要不要在 stale 时主动刷新"属于 M9 轨道 B4 范畴，不在本 feature 决策范围内。

---

### 决策 3：AGENTS.md byte budget 校验落点 —— **两者都要**（vitest 直测纯函数 + repo:check 第 14 族）

**选项对比**：仅 vitest / 仅 repo:check 第 14 族 / 两者都要。

**选择**：两者都要，且底层是**同一个纯函数**（`validateAgentsByteBudget({ projectRoot })`，位于新增 `scripts/lib/worktree-local-state-core.mjs`），vitest 直接 `import` 调用，`repo:check` 通过 `aggregateValidation('worktree-local-state', ...)` 间接调用。

**理由**：
1. 为什么不只用 vitest：`repo:check` 是提交前的强制项，单独让 byte-budget 校验只活在 vitest 里会让"忘记跑这一个特定测试文件"的人绕过它。
2. 为什么不只用 repo:check：TDD 红绿快速迭代时直接跑这一个 vitest 文件比每次跑全量 `repo:check` 快得多，断言粒度也更细。
3. 同一函数双消费不产生维护两份逻辑的成本，与 `validateGraphQuality`/`validateSpecDrift` 的既定三段式模式一致（第 14 族命名为 `worktree-local-state`）。

**实现要点**：按 FR-008"按 max 不按 sum"，分别 `fs.statSync('AGENTS.md').size` 与（若存在）`fs.statSync('AGENTS.override.md').size`，各自与 `32768` 比较，两者中较大值决定 pass/warn（当前 `AGENTS.md` = 23346 bytes，通过）。留一个 `// TODO(follow-up): nested AGENTS.md 累计` 注释标注扩展点，不实现累计逻辑。

---

### 决策 4：`.worktreeinclude` 内容合同校验落点 —— **两者都要，同一纯函数双消费；新增 grammar 钉死（C6）与 git-repo 条件化 ignored 校验（C7）**

**选项对比**：单测直读真实文件 / repo:check 族 / 两者都要。

**选择**：两者都要——`validateWorktreeIncludeContract({ projectRoot, gitAvailable? })`（同一新模块）读取 `projectRoot/.worktreeinclude`，逐行按 FR-001 规则校验；vitest 直接对本仓库根的真实 `.worktreeinclude` 调用该函数；同时接入 `repo:check` 第 14 族。

**理由**：FR-001 原文强制要求"独立单元测试"；额外接入 repo:check 的理由与决策 3 相同（提交前强制门禁 vs 开发期快速红绿）。

**Grammar 钉死（C6 新增，防 bash/node 双解析器漂移）**：

审查已实测证明"bash 解析 `.worktreeinclude` 是与 Node 校验函数**完全独立**的第二套实现，且关键边界语义未定义"——去掉 `read ... || [[ -n "$line" ]]` 后最后一行会被吞掉；一份含 `\r`（CRLF）、UTF-8 BOM、行内 `#`、无末行换行的字节流在 bash 循环中实测输出：
```
entry=.env.local$'\r'
entry=path.env\ \#\ inline\ comment
entry=\ \ \#\ indented\ comment
entry=$'\357\273\277'bom.env
entry=last.env
```
（仓库无 `.gitattributes` 强制 LF，CRLF 是真实风险面。）为避免"同一份 `.worktreeinclude` 被两套解析器读出不同条目集合"，钉死以下 grammar，两侧实现必须逐字节一致：

1. 文件首**只剥一次** UTF-8 BOM（`\xEF\xBB\xBF`），不在文件中间/每行重复剥。
2. 每行剥**单个**尾部 `\r`（兼容 CRLF），**不做**其他任何 trim（不去除行内/行首/行尾空格——含空格的"路径"按字面处理，自然因不满足 `not-ignored`/不存在而被 skip，见 C5）。
3. `#` **仅当是该行第一个字符**时才是整行注释；行内出现的 `#`（如 `path.env # inline comment`）不触发注释语义，整行按字面路径处理（大概率因不满足安全子集/ignored 前提而被拒绝，但**解析层面**不应擅自截断）。
4. 空行（剥 `\r` 后长度为 0）跳过，不计入条目。
5. **末行无换行符必须被接受**——bash 侧循环必须使用 `while IFS= read -r line || [[ -n "$line" ]]; do ... done < .worktreeinclude` 形态（`read` 在到达无换行符的最后一行时返回非零但 `line` 仍有内容，缺少 `|| [[ -n "$line" ]]` 会静默吞掉最后一行）。

**新增跨实现合同测试（`tests/unit/worktreeinclude-golden-matrix.test.ts`）**：一组 golden byte fixtures（CRLF 混用 / BOM / 行内 `#` / 无末行换行 / 纯注释文件 / 空文件，共 6 种），**同一份字节内容**：(a) 直接调用 `parseWorktreeInclude()`（Node，`scripts/lib/worktree-local-state-core.mjs`）；(b) 通过 `spawnSync('bash', [...])` 调一个仅做"解析并把条目逐行打印到 stdout"的最小 bash 探针（复用 `sync-worktree-local-state.sh` 内同一个 `read_worktreeinclude_entries()` 函数，`source` 该脚本片段而非另写一份）——断言两侧输出的条目序列**逐字节一致**。这是唯一能同时约束两套独立实现不漂移的手段（单独测各自实现无法发现"语义未对齐"这类问题）。

**git-repo 条件化 ignored 校验（C7 新增，防 repo:check 第 14 族接入后打红既有沙箱测试）**：

审查实测：两个既有集成沙箱测试（`tests/integration/spec-drift-repo-check-modes.test.ts:36-58` 的 `COPY_TREES`/`COPY_FILES`、`tests/integration/repo-maintenance-sync-check.test.ts:39-77` 的 `copyTree`/`copyFile` 调用序列）都只复制固定文件清单、**不** `git init`，且都断言整体 `repo:check` 结果为 `pass`。若 `validateWorktreeIncludeContract` 无条件对每个条目跑 `git check-ignore`，这两个沙箱会因为"非 git 仓库、`git check-ignore` 失败"而产生新的 `fail`，直接回归。**修法（拆两层）**：
1. **`.worktreeinclude` 文件本身缺失 → 永远 fail**，不因非 git 环境豁免（这是 FR-001 的硬性要求，不能被沙箱绕过）。因此这两个沙箱必须把 `.worktreeinclude` 加入各自的复制清单（`spec-drift-repo-check-modes.test.ts` 的 `COPY_FILES` 数组、`repo-maintenance-sync-check.test.ts` 的 `copyFile(projectRoot, ...)` 调用序列），文件改动清单已列出这两处（见下）。
2. **单条目的"是否 git ignored"子检查**：先探测当前 `projectRoot` 是否为 git 仓库（`git rev-parse --is-inside-work-tree`，失败即非 git）；非 git 环境下该子检查记为 `status: 'skip'`（附 `reason: 'not-a-git-repo'`），**不计入 errors/warnings**，不拖累整体族状态；仅在确认是 git 仓库时才真正对每个条目跑 `git check-ignore`，产出 `not-ignored` reason（C5）。真实仓库（本仓库根）始终是 git 仓库，该子检查始终生效，不因这层豁免而减弱对 canonical 仓库的校验力度。

---

### 决策 5：graph provenance 状态机的实现语言与 freshness 判定方式 —— **抽出 Node helper 模块（`scripts/lib/graph-bootstrap-status.mjs`），bash 通过子进程调用；freshness 改为 spawn 全局 `spectra graph-quality --json` 的薄 adapter（C3 定案，废弃"兼容子集"方案）；构建兜底改为异步 spawn + 进程组 deadline（C2）；bootstrapSource 改为四事实追踪状态机（C4）；状态文件 temp 命名唯一化（W1）**

**选项对比（状态写入实现语言，维持 Round 0 结论）**：
- (a) 状态 JSON 原子写、schema 拼装全部用 bash heredoc + `mv` 实现。
- (b) 抽一个 plain ESM `.mjs` 模块，bash 用 `node scripts/lib/graph-bootstrap-status.mjs <subcommand> --project-root ...` 调用。

**选择**：(b)，理由不变（可测性、超时可移植性、JSON 正确性、零 `node_modules` 依赖、既有工程惯例），但**新增一条前提声明**：(b) 引入了"生产路径需要 `node` 可执行"这一新前提，已通过 C1 的显式条件分支处理，不再是隐藏假设。

#### C3 定案：`checkFreshness` 不再是"兼容子集"，改为复用编译进全局 CLI 的同一份 F217 实现

**Round 0 的错误**：此前把 `checkFreshness` 设计为"只比较 `recordedSourceCommit` 是否等于 `currentHead`"，把 F217 四态里的 `fresh` 与 `dirty` 都折叠成同一个 `ok`。审查指出这**不是兼容子集，而是有意抹平了 `dirty` 态**——`dirty` 恰恰是"HEAD 一致但工作树有未提交源码改动"这一有实际意义的状态（`source-commit.ts:180`），折叠成 `ok` 会让"图内容其实已经和当前工作树脱节"被静默忽略；`git status --porcelain` 读取失败时 F217 保守判 `dirty`（`source-commit.ts:181`），Round 0 的六格矩阵完全没覆盖这一分支。此外，Round 0 论证的"为什么不能直接 import TS / 不能依赖 `dist/`"**在事实层面依然成立**（见下方保留段落），但由此推出"只能自己重写一份子集"是**过早放弃了第三条路径**——§M10 已排查确认：全局 `spectra` CLI（不依赖 repo `dist/`、不依赖 repo `node_modules`）本身就内置 `graph-quality` 子命令（`help` 未列出是文档缺口，非功能缺口），实测：
```
spectra graph-quality --json --graph specs/_meta/graph.json
→ exit 0，输出完整六指标 JSON，freshness 字段 = canonical 四态：
  { "state": "fresh", "recordedSourceCommit": "aa8f326...", "currentHead": ... }
```
这与 `graph-quality-core.mjs`（第 12 族既有实现）调用的是**同一份编译产物**（只是 `graph-quality-core.mjs` 走 `node dist/cli/index.js`，本模块走全局 `spectra` 可执行文件——两者最终执行的判定代码一致，因为全局 CLI 本身就是打包后的同一套编译产物）。

**为什么保留"不能直接 import TS / 不能依赖仓库内 `dist/`"这段论证**（结论调整，论证本身不变）：

`evaluateFreshness` 定义在 `src/panoramic/graph/source-commit.ts`——TypeScript 源码，不是可被 plain `.mjs` 直接 `import` 的 JS 模块。要在生产运行时让 `graph-bootstrap-status.mjs` 调用到这份逻辑，只有两条路径：
1. **直接 import TS 源**：需要 `ts-node`/`tsx` 等运行时转译器，位于 repo `node_modules`——与 FR-010"Codex-managed worktree 场景不依赖 repo `node_modules`"矛盾。
2. **调用仓库内 `dist/`**：`dist/` 被 `.gitignore` 收录，全新 worktree 若未曾 `npm run build`，`dist/` 不存在（F219 曾因同一忽略规则误吞 fixture，须显式 `!` 放行才能修复，是同一条 `dist/` 忽略规则的既有教训）。

**因此结论调整为**：`graph-bootstrap-status.mjs` **复用编译进全局 `spectra` CLI 的同一份 F217 实现**（第三条路径——本模块生产环境从不 import TS、也不依赖仓库内 `dist/`，而是 spawn 一个**独立分发、自带依赖**的可执行文件），而不是像 Round 0 那样在 `.mjs` 内联重写一份语义子集。这既保持了"零 repo `node_modules`/零 repo `dist/` 依赖"的约束，又做到"只有一份权威判定实现"，不再需要维护任何"兼容子集"或"等价性合同测试"来防止两份实现漂移——因为根本不存在第二份实现。

**`checkFreshness(projectRoot, { graphJsonPath, spectraBin })` 实现**：
```
spawnSync(spectraBin ?? 'spectra', ['graph-quality', '--json', '--graph', graphJsonPath],
          { cwd: projectRoot, encoding: 'utf-8' })
```
- **exit code 契约**（沿用 `graph-quality-core.mjs:14-16` 的既有先例：`pass`=0、`pass-with-warnings`=0、`fail-strong-invariant`=1、`cannot-assess`=2，**无论 status 是 0/1/2 都先取 stdout 再 `JSON.parse`**，不能像 `execFileSync` 那样遇非零退出直接 throw）。
- spawn 本身失败（`spectra` 不在 PATH，`ENOENT`）→ 返回 `{ state: 'unknown-provenance', reason: 'spectra-cli-missing' }`。
- stdout 非空但 `JSON.parse` 失败 → 返回 `{ state: 'unknown-provenance', reason: 'unparseable-output' }`。
- 解析成功 → 直接取 `.freshness` 字段（`{ state, recordedSourceCommit, currentHead, dirtyFiles?, porcelainReadFailed? }`，四态原样透传，**不做任何折叠**）。
- **sync 侧告警映射**（由调用方 `check_graph_source_stale`/新命名 `check_graph_freshness` 决定，不是 `checkFreshness` 自身）：`stale` → warn；`unknown-provenance` → warn（对应 B3"来源不明不得静默 ready"）；`fresh`/`dirty` → **静默**（沿用 F217 `graph-quality-core.mjs` 现有"`dirty` 态刻意不产生 warning"的既定策略，避免每次正常提交前工作树必然 dirty 而产生噪音告警）。

**M10 附带发现需要在实现阶段显式防御**：验证过程中 `spectra graph quality --help`（多了一个空格）被 CLI 解析为 `spectra graph`（`quality` 被当作多余参数忽略），该命令**静默把 6079 节点的图覆写为 2 节点 + `sourceCommit: null`**。`attemptLocalGraphBuild`/`checkFreshness` 组装 `spawnSync`/`spawn` 参数数组时，子命令与 flag **必须以独立数组元素传入**（`['graph-quality', '--json', '--graph', path]`，不能拼成单个字符串再 shell 解析），从根本上杜绝这类空格拆分错误；此风险已作为一条独立风险项列入风险表。

#### C2 定案：`attemptLocalGraphBuild` 改为异步 `spawn` + 独立进程组 + deadline（放弃 `spawnSync(timeout)`）

**Round 0 的错误**：把 `spawnSync(..., { timeout: 50000 })` 当成硬 50 秒上限与自动进程树清理保证，两者都不成立。审查实测（Node v24.14.0, darwin）：子进程忽略 SIGTERM 时，`timeout=200ms` 实际耗时 `elapsedMs: 2016`（约 10 倍超时）；子进程启动孙进程后，直接子进程在 203ms 被 SIGTERM，但孙进程仍存活并在 1 秒后向父进程发信号（`grandchildSignaledParent: true`）。映射到真实场景：若 `spectra` launcher 捕获 SIGTERM 或派生 worker 子进程，50 秒可能被突破 SC-001 的 60 秒预算，或入口返回后仍有孤儿进程继续写 `graph.json`。

**修法**：
```js
export function attemptLocalGraphBuild({ projectRoot, spectraBin = 'spectra', deadlineMs = 45000, graceMs = 2000 }) {
  return new Promise((resolve) => {
    const child = spawn(spectraBin, ['batch', '--mode', 'graph-only'],
      { cwd: projectRoot, detached: true, stdio: 'ignore' });
    let killedByDeadline = false;
    const termTimer = setTimeout(() => {
      killedByDeadline = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      // grace 后仍未退出 → 对整个进程组 SIGKILL
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, graceMs);
    }, deadlineMs);
    child.on('error', (err) => { clearTimeout(termTimer); resolve({ ok: false, reason: 'spawn-error', detail: err.message }); });
    child.on('exit', (code, signal) => {
      clearTimeout(termTimer);
      if (killedByDeadline) return resolve({ ok: false, reason: 'timeout' });
      resolve(code === 0 ? { ok: true } : { ok: false, reason: 'non-zero-exit', code, signal });
    });
  });
}
```
- `detached: true`（POSIX）使子进程成为**独立进程组的组长**（`pgid === child.pid`），`process.kill(-child.pid, sig)`（负 pid）对整个进程组发信号，覆盖子进程派生的任何孙进程。
- deadline **45 秒**（而非 60 秒预算的满值），为状态写入/迁移性 sidecar 删除等收尾步骤留出安全边界（对应 SC-001 的 60 秒硬预算）。
- TERM 后 **2 秒 grace**，仍未退出才 SIGKILL——给能正常响应 TERM 的进程一个优雅退出的机会，避免每次都粗暴 SIGKILL。
- CLI 层（`main()`）改为 `async`，`await attemptLocalGraphBuild(...)` 后再决定 `bootstrapSource`/`buildSucceeded`。

**测试要求（新增两个关键 stub，落进测试策略）**：
1. **忽略 SIGTERM 的 stub**：一个 shell/node 脚本收到 SIGTERM 不退出，只有 SIGKILL 才终止；断言总墙钟 `< 50000ms`（45s deadline + 2s grace + 执行开销留量）且进程最终确实被 KILL 收口。
2. **启动后台孙进程的 stub**：直接子进程 fork 一个后台孙进程后自身很快退出（或也忽略 TERM）；断言孙进程**随进程组一并消亡**——判据用孙进程持续写心跳文件（如每 100ms 追加时间戳），deadline+grace 过后心跳文件**停止更新**，而不是用 `pgrep` 查宿主机进程表（F232 教训：宿主机进程表在测试环境不可控，`pgrep` 类判据历史上已被证明会被无关进程污染）。

#### C4 定案：`bootstrapSource` 改为四事实追踪状态机，不再"猜测"来源

**Round 0 的错误**：把"已有 graph 就是 local-build"、"graph 或 snapshot 任一被 copy 就是 primary-copy"当作判定规则，审查给出三个可复现的反例：
1. 首次从主仓 copy 图记为 `primary-copy`；第二次 sync 时图已存在、本次未发生任何 copy/构建，Round 0 逻辑会把它**覆盖成** `local-build`——这是假 provenance（图的真实来源明明还是当初的 primary-copy）。
2. worktree 已有本地构建的图但缺 snapshot；本次只从主仓补上 snapshot，Round 0 逻辑会把 graph 来源误判为 `primary-copy`——snapshot 的来源不应该"传染"给 graph 字段。
3. `graph.json` 解析失败时，`assessable` 字段与 live 解析结果如何协调未定义，helper 可能直接异常退出而不是原子落盘非 ready 状态。

**修法**：`bootstrap_graph()` 内部独立追踪四个**事实**（不是猜测）：
| 事实 | 何时为真 |
|---|---|
| `graphCopiedThisRun` | 本次 `copy_if_absent_atomic`（决策 2/C11 硬链接版）对 `graph.json` 成功发布 |
| `snapshotCopiedThisRun` | 本次对 `.spectra/unified-graph.json` 快照成功发布（**永不**用于判定 graph 来源） |
| `buildAttempted` | 本次带 `--attempt-build` 且确实调用了 `attemptLocalGraphBuild` |
| `buildSucceeded` | `attemptLocalGraphBuild` 返回 `{ ok: true }` |

`buildStatusPayload()` 内的 `determineBootstrapSource()` 判定顺序（替换原"数据合同"章节的判定顺序，见下方章节同步更新）：
1. `graphCopiedThisRun === true` → `"primary-copy"`。
2. 否则 `buildAttempted === true && buildSucceeded === true` → `"local-build"`。
3. 否则 `graph_target` 不存在（既未 copy 到、也未成功构建） → `"none"`（`assessable: false`）。
4. 否则（`graph_target` 存在，但本次既未 copy 也未构建——即"本次未改变已有图的 rerun"）→ **读取上一次写入的状态文件**（`readPreviousStatus()`），若其中 `bootstrapSource` 是 `primary-copy`/`local-build`/`unknown` 三者之一 → **原样继承**；若无历史状态文件可读（比如状态文件本身是本次新引入、worktree 里的图是通过更早期机制生成的） → `"unknown"`（**该枚举值由本 plan 与 spec 并行新增**——spec 正在同步补齐 FR-006 字段表，实现时需与 spec 定稿核对一致）。

`readEmbeddedSourceCommit(graphJsonPath)` 改为返回三态结果而非简单 `string | null`：
```js
// { ok: true, value: string | null }   — 文件存在且可解析（value 为 null 表示字段缺失，如旧格式图）
// { ok: false, reason: 'file-missing' }
// { ok: false, reason: 'parse-error' }
```
`parse-error` 时 `assessable` **强制为 `false`**（不论 `bootstrapSource` 判定结果如何），且**必须走到 `writeBootstrapStatus()` 原子落盘**——helper 内部用 try/catch 包裹 JSON 解析，捕获异常后仍构造一个合法的 payload（`bootstrapSource` 按上述四步判定，`assessable: false`）落盘，**绝不允许因为解析异常导致整个 `write-status` 子命令未捕获异常退出**（否则 bash 侧在有 `set -e` 且未加保护的情况下会中断整条 sync）。

#### W1 定案：状态文件 temp 命名唯一化

Round 0 沿用了仓库既有 `writeAtomicJson`（`src/utils/atomic-write.ts:25`）的固定 `${path}.tmp` 命名——审查指出：若两个 writer 并发写**同一目标路径**的状态文件，都会先写向**同一个** `${path}.tmp`，后写入者可能在前一个 writer 完成 `rename` 之前就覆盖了共享的 tmp 内容，或在前一个 writer 刚 `rename` 走 tmp 之后对一个已不存在的 tmp 做 `rename` 而 `ENOENT`。**修法**：`writeBootstrapStatus()` 使用**每次调用唯一**的 temp 名 `` `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp` ``（PID + 随机片段，不复用 `atomic-write.ts` 的固定 `.tmp` 命名习惯），保证并发 writer 之间零 tmp 路径碰撞；最终 `rename` 到同一目标路径仍是"后写覆盖"语义（rename 本身是原子替换，不需要额外锁）。**新增测试**：两个 writer 先后（模拟并发，不需要真实同时）各自写入同一目标路径，断言两次调用**均成功**（不因 tmp 碰撞报错）且最终内容为**后一次**写入的内容。

**CLI 子命令设计**（供 bash 调用，内部逻辑均为可单独 `import` 的纯函数）：
```
node scripts/lib/graph-bootstrap-status.mjs write-status \
  --project-root <path> --graph-copied <true|false> --snapshot-copied <true|false> \
  --build-attempted <true|false> --build-succeeded <true|false> [--dry-run]
  # 内部：readEmbeddedSourceCommit（三态）+ resolveWorktreeHead + readPreviousStatus
  #       → determineBootstrapSource（四事实判定，C4）→ 拼装 schemaVersion 1 状态对象
  #       → 非 dry-run：唯一 temp + rename 原子写（W1）→ 迁移性删除遗留 sidecar（C10）
  #       → dry-run：stdout 打印 "[dry-run] 将写入: <json>" + "[dry-run] 将删除遗留 sidecar: <path>"（若存在）

node scripts/lib/graph-bootstrap-status.mjs check-freshness --project-root <path> --graph <path>
  # 内部：spawnSync('spectra', ['graph-quality','--json','--graph', graphPath], {cwd, encoding})
  #       exit 0/1/2 均先取 stdout 再 JSON.parse（C3，同 graph-quality-core.mjs:14-16 先例）
  #       输出 JSON 到 stdout：{ state, recordedSourceCommit, currentHead, reason? }
  #       spectra 缺失/解析失败 → { state: 'unknown-provenance', reason: '...' }

node scripts/lib/graph-bootstrap-status.mjs attempt-build \
  --project-root <path> [--deadline-ms 45000] [--grace-ms 2000] [--spectra-bin spectra]
  # 内部：异步 spawn + detached 独立进程组 + deadline TERM→grace→KILL（C2）
  #       exit 0 = 成功；非零 stdout 打印 "reason: spawn-error|non-zero-exit|timeout"
```

---

### 决策 6：FR-011 逃逸对抗测试的断言方式 —— **精确 reason code 断言 + 隔离 HOME + 精确 literal source，canary mtime 仅作零写入辅证（C8 重做，废弃"宽泛 skip/警告匹配"）**

**Round 0 的错误**：审查指出三处实证漏洞：
1. `copy_path` 对 source 先做 `-e` 存在性检查，不存在即打印"跳过"（`sync-worktree-local-state.sh:228`）——Round 0 的宽泛断言 `/跳过|警告|skip|warning/i` **无法区分**"containment 校验生效而 skip"与"仅仅因为 source 不存在而 skip 的普通日志"，后者在**完全没有 containment 校验**的实现下也会输出同样的日志，测试会误判为绿。
2. `sync-worktree-local-state.sh:246` 里 glob 参数本来就一直被引号包住，Round 0 只创建了 `decoy.env` 却没有确保"若无 containment 校验，`*.env` 真的会被展开并 copy 到 `decoy.env`"这条**因果链**成立——也就是说，即使删掉 containment 校验，`decoy.env` 也不会被误 copy（因为参数早已被引号保护），测试无法证伪"没有校验"这一情形，是一个**即使产品代码退化也仍然通过**的假红线索。
3. 脚本末尾本身就会读取/可能写入 `$HOME/.claude/projects`（`:369`），Round 0 拒绝替换 HOME，导致"整个进程零仓库外读写"这个 SC-006 表述在事实上**不成立**（这部分行为是既有功能，不是本 feature 引入的违规）。

**选择（重做后）**：
1. **隔离 HOME**：每个测试用例在 `spawnSync` 时传入 `env: { ...process.env, HOME: isolatedSandboxDir }`（一个与 `primaryDir`/`worktreeDir` 无关的独立临时目录），使脚本末尾"Claude 项目级 memory 软链"那段代码操作的是沙盒内的 `$HOME`，不触碰真实 `~/.claude/projects`——这样"仓库外零读写"的断言范围就被精确限定为"本测试注入的 HOME 沙盒之外零读写"，不再对既有的、与本 feature 无关的 HOME 访问做不成立的断言。
2. **每类非法条目预置精确字面 source 文件，使"若无校验则会被真的 copy"这一条件成立**：
   - 绝对路径类：条目字符串为一个独立沙盒目录（与 `primaryDir`/`worktreeDir` 无父子关系）内的绝对路径，**在该绝对路径处真实创建一个文件**（内容已知）——若 containment 校验被移除，`copy_path` 的 `-e` 检查会通过（文件真实存在），从而**真的会**尝试 `cp` 到 worktree；这样"containment 生效"与"仅因 source 不存在而 skip"就产生了可观测的差异。
   - `..` 穿越类：在 `path.dirname(worktreeDir)` 下创建 `shared-secret` 文件（真实存在），条目为 `../shared-secret`。
   - glob 类：`*.env` 条目——**必须确认** `read_worktreeinclude_entries()`/`copy_path` 内部对 `$entry` 变量的每一处使用都保持双引号（已是现状），因此"无 containment 校验"并不会导致真正的 shell glob 展开；测试断言的因果链改为：即使把 containment 校验函数整个替换成 no-op（真红态验证方式），`decoy.env` 也不会被误展开——**这条用例的证明目标从"阻止 glob 展开"改为"阻止把 `*.env` 这个字面 4 字符字符串当作合法路径去尝试 copy"**（因为 `primaryDir/*.env` 作为字面路径大概率不存在/不是 ignored，本身就会被现有的"字面路径不存在"逻辑 skip；真正需要 containment 校验拦截的是"该字面字符串包含 glob 元字符，不满足 FR-001 安全子集"这一层，用具体 reason code `glob-char` 断言）。
   - 否定/转义类：同理，创建对应字面文件名（`primaryDir/!keep.env`、`primaryDir/#file`……视 shell 转义规则精确构造字面文件名），断言具体 reason code（`negation-prefix`/`escape-char`）而非宽泛日志匹配。
3. **断言具体 reason code**：每个用例断言 stderr 包含**精确**的 reason 标识，如 `[containment] absolute-path`/`[containment] dot-dot-segment`/`[containment] glob-char`/`[containment] negation-prefix`/`[containment] escape-char`/`[containment] trailing-slash`（C5 新增，见下）——bash 侧 `validate_entry()` 的 warning 输出格式统一为 `[containment] <reason-code>: <entry>`，使测试可以做精确字符串匹配而非宽泛正则。
4. **零读取声明收窄**：不再声称"整个进程零仓库外读写"，改为两条可机械验证的具体断言：(a) 该非法条目**未触发 `copy_path` 函数调用**（间接证据：预置的 literal source 文件内容/mtime 在 sync 前后完全不变——canary 快照对比**仅作为"零写入"的辅助证据**，不再单独作为"零读取"的证明）；(b) stderr 出现对应精确 reason code。
5. **新增 `.env.local/` 尾斜杠用例（C5，见决策 4/数据合同章节的 reason 扩展）**：审查实测 `git check-ignore -v --no-index '.env.local/'` 退出码 0（满足 ignored 前提），而尾斜杠会让"若路径存在则判断是否为常规文件"的检查因**存在性检查本身因尾斜杠而失真**被绕过——新增测试：`.worktreeinclude` 含条目 `.env.local/`，断言被 `trailing-slash` reason 拒绝。
6. 每个用例仍统一断言：`status === 0`、同一次 sync 里其余合法步骤仍完成（如 `CLAUDE.local.md` 正常软链）。

---

## 模块与文件改动清单

### 新增文件

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `scripts/lib/worktree-local-state-core.mjs` | FR-001 `.worktreeinclude` 内容合同（九类 reason，C5）+ FR-008 byte-budget，双消费（vitest + repo:check），git-repo 条件化 ignored 校验（C7） | `parseWorktreeInclude(content)`（钉死 C6 grammar）、`validateWorktreeIncludeEntry(entry, {existsAt, isIgnored, gitAvailable})`、`validateWorktreeIncludeContract({projectRoot})`、`validateAgentsByteBudget({projectRoot})`、`validateWorktreeLocalState({projectRoot})` |
| `scripts/lib/graph-bootstrap-status.mjs` | graph provenance 四事实状态机（C4）、状态文件唯一 temp 原子写（W1）、遗留 sidecar 迁移性删除（C10）、freshness adapter（spawn 全局 CLI，C3）、本地构建兜底（异步 spawn + 进程组 deadline，C2）+ CLI 分发 | `readEmbeddedSourceCommit(graphJsonPath)`（三态）、`resolveWorktreeHead(projectRoot)`、`readPreviousStatus(projectRoot)`、`determineBootstrapSource({...})`、`buildStatusPayload({...})`、`writeBootstrapStatus(projectRoot, payload, {dryRun})`、`checkFreshness(projectRoot, {graphJsonPath, spectraBin})`、`attemptLocalGraphBuild({projectRoot, spectraBin, deadlineMs, graceMs})`（返回 Promise）、`main(argv)`（async CLI 入口） |
| `.worktreeinclude`（仓库根，tracked） | Codex 官方 + bash 共同消费的 copy 类清单 | 初始内容仅一行 `.env.local` |
| `tests/unit/worktreeinclude-contract.test.ts` | FR-001（九类 reason）/FR-008/SC-002(a)/SC-005 单测 | — |
| `tests/unit/worktreeinclude-golden-matrix.test.ts` | **C6 新增**：node parser ↔ bash 解析跨实现字节级合同测试（6 种 golden fixture） | — |
| `tests/unit/graph-bootstrap-status.test.ts` | FR-006/FR-010 状态机纯函数单测：schema/原子写/唯一 temp 并发（W1）、checkFreshness adapter 解析映射（C3）、attemptLocalGraphBuild 进程组+deadline（C2，含忽略 SIGTERM/孙进程两个 stub）、bootstrapSource 四事实状态机（C4） | — |
| `tests/unit/worktree-lifecycle-hook.test.ts` | FR-009/SC-008 hook fixture 测试 + C1 的 node 缺失端到端用例 | — |

### 修改文件

| 文件 | 改动点 |
|---|---|
| `scripts/sync-worktree-local-state.sh` | (1) 删除硬编码 `COPY_TARGETS` 数组，新增 `read_worktreeinclude_entries()`（钉死 C6 grammar：BOM/`\r`/行首 `#`/无末行换行，`while IFS= read -r line \|\| [[ -n "$line" ]]`）+ `validate_entry()`（FR-003 containment：九类拒绝，C5 新增 `trailing-slash`/`not-ignored`/`not-regular-file`，统一输出 `[containment] <reason>: <entry>` 格式）；(2) 删除 `SOURCE_COMMIT_REL` 常量与 sidecar 写入 3 行；(3) `copy_if_absent_atomic()` 发布步骤改为硬链接排他发布（`ln` + `EEXIST` 语义，C11）；(4) `check_graph_source_stale()` 重命名/委托为 `check_graph_freshness()`，内部包在 `command -v node` 条件分支内调用 `check-freshness` 子命令（C1），按四态映射决定是否 warn（C3）；(5) `bootstrap_graph()` 结尾新增：`command -v node` 可用时调用 `write-status`（携带四事实 flag，C4），不可用时仅 warn（C1）；(6) 新增 `--attempt-build` flag 解析 + 对应本地构建兜底分支（决策 2/C2），同样包在 `command -v node` 条件内 |
| `plugins/spec-driver/hooks/worktree-lifecycle.sh` | `create` 分支：捕获 stderr，非零退出时打印捕获内容到 stderr，hook 自身仍 `exit 0` |
| `tests/unit/sync-worktree-local-state.test.ts` | (1) `setupRepo()` 签名扩展为 `setupRepo({ worktreeInclude = ['.env.local'] } = {})`，`.worktreeinclude` 纳入 init commit；(2) 既有 2 个 stale 相关用例改为 seed 含 `graph.sourceCommit` 字段的 JSON；(3) 新增决策 6 重做后的 FR-011 逃逸矩阵（隔离 HOME + 精确 literal source + reason code 断言）+ `.env.local/` 尾斜杠用例（C5）；(4) 新增 C9 三类红测试：动态清单 add/remove、poison-sidecar 接线（内嵌 stale+sidecar current 仍须 warn；内嵌 fresh+sidecar stale 不得误报）、bootstrap 后显式断言 sidecar 不存在 + 遗留 sidecar 被清理；(5) 新增 C11 硬链接排他发布确定性用例（预置 target→断言不覆盖+tmp 清理） |
| `.gitignore` | 新增一行 `AGENTS.override.md`（FR-007） |
| `scripts/lib/repo-maintenance-core.mjs` | `validateRepository()` 新增第 14 族：`aggregateValidation('worktree-local-state', validateWorktreeLocalState({ projectRoot: resolvedRoot }), warnings, errors, checks)` |
| `tests/integration/spec-drift-repo-check-modes.test.ts` | **C7 新增**：`COPY_FILES` 数组（`:50` 附近）加入 `.worktreeinclude`，防止第 14 族接入后因"文件缺失"误判整体 `pass` 断言回归 |
| `tests/integration/repo-maintenance-sync-check.test.ts` | **C7 新增**：`copyFile(projectRoot, ...)` 调用序列（`:68` 附近）加入 `.worktreeinclude`，同上 |
| `docs/spectra-cli-reference.md` | **C10 新增**：`:171-173` 关于 `.graph-source-commit` sidecar 的描述更新为新状态文件（`graph-bootstrap-status.json`）合同说明 |

### 不改动（复用/只读）

- `src/panoramic/graph/source-commit.ts::evaluateFreshness`/`resolveSourceCommit`：不修改代码；生产路径既不 import 其 TS 源，也不依赖仓库内 `dist/`（C3 定案），而是 spawn 编译进全局 `spectra` CLI 的同一份实现。
- `src/panoramic/graph/quality/quality-types.ts::GraphFreshnessVerdict`：只读引用类型定义（四态字段命名对齐），不修改。
- `src/batch/stages/graph-assembly.ts:255`（`graphJson.graph.sourceCommit = resolveSourceCommit(...)`）：确认其为状态机数据源，不修改。
- `scripts/lib/graph-quality-core.mjs`：只读参照其 exit-code/JSON 解析先例（C3），不修改。
- F193 历史 spec/plan/tasks（`specs/193-worktree-graph-bootstrap-freshness/`）：保留，不篡改历史，仅在本 feature 文档中标注 superseded（C10）。

---

## 数据合同

### `.worktreeinclude` 内容合同（FR-001，C5/C6 更新）

```
# Grammar（C6 钉死，node/bash 两侧实现必须逐字节一致）：
#   - 文件首只剥一次 UTF-8 BOM；每行剥单个尾部 \r；不做其他任何 trim
#   - 空行（剥 \r 后长度为 0）跳过
#   - # 仅当是行首第一个字符才是整行注释；行内 # 不触发注释语义
#   - 末行无换行符必须被接受
#
# 每个非空非注释行必须同时满足全部条件，否则计入以下 reason 之一（C5 扩展为九类）：
#   absolute-path      —— 以 / 开头
#   dot-dot-segment    —— 含 .. 路径段
#   glob-char           —— 含 * ? [ ]
#   negation-prefix     —— 以 ! 开头
#   escape-char         —— 含反斜杠 \
#   trailing-slash      —— 以 / 结尾（C5 新增：git-ignored 目录式条目如 `.env.local/` 会
#                          通过 ignored 检查，且尾斜杠使存在性检查失真绕过目录判定，
#                          必须在存在性检查之前结构性拒绝）
#   not-ignored         —— 不满足 git ignored 前提（非 git 环境下该子检查 skip，C7）
#   not-regular-file    —— 路径存在但不是常规文件（目录/symlink 等，覆盖原 is-directory）
.env.local
```

`validateWorktreeIncludeEntry(entry, { projectRoot, gitAvailable })` 返回 `{ valid: boolean, reason?: 'absolute-path'|'dot-dot-segment'|'glob-char'|'negation-prefix'|'escape-char'|'trailing-slash'|'not-ignored'|'not-regular-file' }`；语法类拒绝（前 6 种）优先于存在性/ignored 类判定（后 2 种）——尤其 `trailing-slash` 必须在任何存在性检查**之前**结构性拒绝，防止尾斜杠导致存在性检查失真而绕过 `not-regular-file`。

### `specs/_meta/graph-bootstrap-status.json`（schemaVersion 1，FR-006，C4/W1 更新）

```json
{
  "schemaVersion": 1,
  "bootstrapSource": "primary-copy",
  "embeddedSourceCommitAtBootstrap": "0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3",
  "worktreeHeadAtBootstrap": "0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3",
  "generatedAt": "2026-08-02T18:40:00.000Z",
  "assessable": true
}
```

`bootstrapSource` 枚举 **扩展为四态**：`"primary-copy" | "local-build" | "none" | "unknown"`（新增 `"unknown"`，C4——由主编排器裁决新增，spec 正在并行补齐 FR-006 字段表，实现时以 spec 定稿的枚举值为准）。

**判定顺序（C4 重写，替换原"三步覆盖式"逻辑）**——`bootstrap_graph()` 独立追踪四个事实 `graphCopiedThisRun`/`snapshotCopiedThisRun`（永不参与判定）/`buildAttempted`/`buildSucceeded`，`determineBootstrapSource()` 按序判定：
1. `graphCopiedThisRun === true` → `"primary-copy"`。
2. 否则 `buildAttempted === true && buildSucceeded === true` → `"local-build"`。
3. 否则 `graph_target` 不存在 → `"none"` + `assessable: false`。
4. 否则（图已存在但本次既未 copy 也未构建——"未改变已有图的 rerun"）→ 读取**上一次**状态文件的 `bootstrapSource` 并原样**继承**；无历史记录可读 → `"unknown"`。

`embeddedSourceCommitAtBootstrap` 的读取改为三态结果（`{ok:true,value}` / `{ok:false,reason:'file-missing'}` / `{ok:false,reason:'parse-error'}`）；`parse-error` 时**强制** `assessable: false`，且必须仍然原子落盘（helper 内部 try/catch 兜底，不允许未捕获异常导致 bash 侧 `set -e` 中断）。`worktreeHeadAtBootstrap` 现算不变。`--dry-run` 时仅 stdout 打印同构 JSON + "将删除遗留 sidecar"提示（若存在），不落盘、不删除（C10）。

**状态文件写入的原子性**（W1 更新）：temp 文件名唯一化为 `` `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp` ``，不复用仓库既有 `atomic-write.ts` 的固定 `${path}.tmp` 命名，避免并发 writer 的 tmp 路径碰撞；最终 `rename` 到同一目标路径，后写覆盖。

**遗留 sidecar 迁移性删除**（C10）：`writeBootstrapStatus()` 在新状态文件成功落盘**之后**检查并删除 `specs/_meta/.graph-source-commit`（若存在），删除失败仅追加 warning，不影响主流程；`--dry-run` 只报告不删除。

---

## 测试策略（"红测试 / characterization guard → 实现 → 回归"三类标注，W3）

| 顺序 | 类型 | 新增/修改测试 | 覆盖 FR | 红态前提 / guard 说明 | 绿态实现 |
|---|---|---|---|---|---|
| 1 | 红 | `worktreeinclude-contract.test.ts`：`.worktreeinclude` 不存在/九类 reason 各自触发（含 `trailing-slash`/`not-ignored`/`not-regular-file`） | FR-001 | 文件不存在 + 校验函数未实现 | 创建 `.worktreeinclude` + 实现 `validateWorktreeIncludeContract` 全部九类分支 |
| 2 | 红 | 同文件：`AGENTS.md`/`AGENTS.override.md` byte budget（含人为构造超限 fixture） | FR-008 | `validateAgentsByteBudget` 未实现 | 实现该函数 |
| 3 | 红 | `worktreeinclude-golden-matrix.test.ts`（C6）：CRLF/BOM/行内`#`/无末行换行/纯注释/空文件 六种 golden fixture，同时驱动 node parser 与 bash 解析探针，断言条目序列逐字节一致 | grammar 精确性（支撑 FR-002） | grammar 未钉死，两侧解析器行为不确定（审查已实测两者会产生不同输出） | 钉死 C6 五条 grammar 规则，`read_worktreeinclude_entries()` 与 `parseWorktreeInclude()` 双侧对齐 |
| 4 | 红 | `sync-worktree-local-state.test.ts`：动态清单红测试（C9-1）——manifest 新增非 `.env.local` 的 ignored 路径应被 copy；移除 `.env.local` 后不再被 copy（同时是 SC-002(b) 直接证据） | FR-002/SC-002(b) | 硬编码 `COPY_TARGETS` 本来就会通过既有 3 个 `.env.local` 用例（审查已指出这一点不能证明"动态绑定"），新增用例改变清单内容后旧硬编码逻辑**必然**红 | 实现 `.worktreeinclude` 动态绑定 |
| 5 | 红 | 同文件：决策 6 重做后的 FR-011 逃逸矩阵（隔离 HOME + 精确 literal source + 断言精确 reason code）+ `.env.local/` 尾斜杠用例（C5/C8） | FR-003/FR-011/SC-006/SC-005 | `validate_entry` 未实现九类拒绝；且各用例预置的 literal source 若无校验**真的会**被 `copy_path` 处理（C8 因果链修复） | 实现 containment 校验九类拒绝，统一 `[containment] <reason>` 输出格式 |
| 6 | characterization guard（W3：非红，首跑即绿） | 同文件：FR-004 allowlist 精确性（数组现状本就精确等于 6 项）+ FR-005 pattern 黑名单用例（通过反向插入命中项验证判红，这一子部分本身是红→绿） | FR-004/FR-005/SC-003/SC-004 | 数组现状已合规，无代码变更也会通过——按 W3 显式标注为 guard，不谎称"先红" | 无需实现变更，仅新增锁定测试；FR-005 黑名单部分单独验证"插入非法项→判红" |
| 7 | 红 | `graph-bootstrap-status.test.ts`：schema 字段完整性、`--dry-run` 不落盘/不删除、原子写、**唯一 temp 并发 writer**（W1，两次先后写入均成功、后写内容生效） | FR-006 | 模块不存在 | 实现 `buildStatusPayload`/`writeBootstrapStatus`（唯一 temp 命名） |
| 8 | 红 | 同文件：`checkFreshness` adapter 解析/映射测试（C3 定案）——fixture 驱动假 `spectra` CLI 输出：`fresh`/`dirty`/`stale`/`unknown-provenance` 四态、exit 1 携带合法 JSON、exit 2 携带合法 JSON、CLI 缺失（`ENOENT`）、stdout 不可解析，共 8 种形态；另加**一条真实 CLI 冒烟**（本机已装全局 `spectra` 时跑，未装则 `it.skip` 并标注原因） | FR-006/SC-007 | adapter 未实现 | 实现 `checkFreshness` 为 `spawn spectra graph-quality --json` 薄封装，四态原样透传不折叠 |
| 9 | 红 | 同文件：`attemptLocalGraphBuild` 两个关键 stub（C2）——忽略 SIGTERM 的 stub（断言总墙钟 < 50000ms 且最终被 SIGKILL 收口）、启动后台孙进程的 stub（断言孙进程心跳文件在 deadline+grace 后停止更新，不用 `pgrep`） | FR-010/SC-001 | 模块不存在；`spawnSync(timeout)` 方案已被证伪不具备硬超时/进程组清理能力 | 实现异步 `spawn` + `detached` 独立进程组 + TERM→grace→KILL |
| 10 | 红 | 同文件：`bootstrapSource` 四事实状态机（C4）——(a) 首次 primary-copy 后无变化 rerun 必须**继承** `primary-copy`（不得被覆盖为 local-build）；(b) 仅补 snapshot 不得改变已记录的 graph 来源；(c) `graph.json` 解析失败时原子落盘 `assessable:false` 而非未捕获异常退出；(d) 无历史记录且图已存在 → `unknown` | FR-006 | Round 0 三步覆盖式判定逻辑在这四个场景下均给出错误结果（审查已逐一举证） | 实现 `determineBootstrapSource` 四事实判定 + `readPreviousStatus` 继承逻辑 |
| 11 | 红 | `sync-worktree-local-state.test.ts`：poison-sidecar 接线测试（C9-2）——内嵌 `graph.sourceCommit` 记 stale、遗留 sidecar 人为写成 current，rerun 仍必须 warn；反向：内嵌 fresh、sidecar 写成 stale，不得误报 stale | FR-006/SC-007 | 若 `check_graph_freshness` 仍读 sidecar（或两者都读取但优先级不对），两个方向中至少一个会给出错误结果 | 接入 `checkFreshness` adapter（只读内嵌字段，完全不读 sidecar） |
| 12 | 红 | 同文件：bootstrap 后显式断言 `specs/_meta/.graph-source-commit` **不存在**（含"预先 seed 一个遗留 sidecar，bootstrap 后必须被清理"，C9-3/C10） | FR-006 | Round 0"移除对 sidecar 的断言"并不能证明 sidecar 真的不再生成/不被清理 | 实现 (1) sidecar 写入逻辑彻底删除 (2) 迁移性删除遗留 sidecar |
| 13 | 红 | 同文件：`copy_if_absent_atomic` 硬链接排他发布确定性用例（C11）——预置 target 已存在，调用发布函数，断言 target 内容不被覆盖 + `tmp` 文件被清理（不写 barrier 双进程竞态测试，规避 F233/F235 式 flaky） | 回归护栏 2（copy-if-absent 幂等） | 发布逻辑仍是"检查不存在→普通 `mv`"，无法通过"预置 target 已存在直接调用发布函数"这一确定性检验证明其排他性 | 改为 `ln` 硬链接排他发布（`EEXIST` 分支保留对方版本） |
| 14 | 红 | `worktree-lifecycle-hook.test.ts`：固定 stderr + 非零退出 fixture（FR-009）+ **新增** PATH 剥离 `node` 的端到端用例（C1）——断言 warning 出现 + `.env.local` copy 与 SYMLINK_TARGETS 步骤仍完成 + `exit 0` | FR-009/SC-008/C1 | hook 仍 `2>/dev/null \|\| true`；`node` 缺失场景此前会因 `set -e` 中断整条 sync | 改造 `create` 分支为捕获+打印+仍 `exit 0`；bash 侧新增 `command -v node` 条件分支 |
| 15 | 红 | `.gitignore` 新增行 + `git check-ignore AGENTS.override.md` 断言 + `.worktreeinclude` 不含该字符串断言 | FR-007/SC-005 | 规则未加 | 新增一行 |
| 16 | 红 + 回归修复 | `repo-maintenance-core.mjs` 第 14 族接入后跑 `npm run repo:check`；**同批次**为 `spec-drift-repo-check-modes.test.ts`/`repo-maintenance-sync-check.test.ts` 的沙箱复制清单补 `.worktreeinclude`（C7） | FR-001/FR-008 汇总；回归保护 | 新族未注册；若不补沙箱复制清单，两个既有集成测试会在新族接入后因"文件缺失"新增 `fail`（审查已实测复现该回归路径） | `aggregateValidation('worktree-local-state', ...)` + 两个沙箱复制清单补齐 + validator 对非 git 环境的 `not-ignored` 子检查降级为 `skip`（C7） |
| 17 | 回归 | 全量：`npx vitest run` + `npm run build` + `npm run repo:check` | FR-013/SC-009 | — | 对照 M8 基线（483/5773）确认净增量、零失败 |

**注意 1**：第 3/11/12 步涉及对**既有**测试用例的修改或新增强化（非纯新增断言），修改原因均由 spec FR-006 的唯一权威合同要求驱动（数据 shape 对齐真实生产 `graph.json` 形状、sidecar 断言从"移除引用"升级为"显式验证不存在/被清理"），不属于"弱化既有断言"。

**注意 2（第 8 步的价值，C3 定案后）**：这组测试不再是"等价性合同"（Round 0 的错误框架——两份实现的等价性测试只是把"允许两份实现分歧多少"这个问题挪到测试里，本质仍是维护两份语义），而是**adapter 正确性测试**——因为生产路径只有一份判定实现（编译进全局 CLI），测试只需验证"adapter 正确解析/透传该实现的输出"，不需要再维护一份"防漂移"的对拍逻辑，架构上更简单也更不容易出现新的分歧点。

**注意 3（第 6 步的诚实标注，W3）**：`SYMLINK_TARGETS` 数组在改动前后都精确等于 6 项，新增的锁定测试**首次运行就会通过**，这不是缺陷而是"characterization guard"（锁定现状、防止未来意外改动）的正常特征；黑名单反向插入验证是这一步里唯一真正"先红后绿"的子部分。

---

## 实现分批

1. **批 1 — 内容合同 + grammar 基础设施**：新增 `.worktreeinclude`、`worktree-local-state-core.mjs`、`worktreeinclude-contract.test.ts`、`worktreeinclude-golden-matrix.test.ts`（对应测试策略 1-3）。可独立验证：两个测试文件单独跑绿。
2. **批 2 — bash 动态绑定 + containment(C5/C8) + allowlist**：改造 `sync-worktree-local-state.sh` 的 `.worktreeinclude` 解析与九类 `validate_entry`，`setupRepo` 扩展，重做后的 FR-011 矩阵、FR-004/FR-005 测试（对应测试策略 4-6）。可独立验证：`sync-worktree-local-state.test.ts` 全绿（含新增/重做用例）。
3. **批 3 — graph provenance 重构（C1-C4/C9-C11/W1）**：新增 `graph-bootstrap-status.mjs` 及其测试、`bootstrap_graph()` 移除 sidecar 并新增迁移性删除、四事实状态机、硬链接发布、`--attempt-build` 异步进程组构建，既有 stale 用例改造、poison-sidecar/sidecar-absent/动态清单红测试（对应测试策略 7-13）。可独立验证：`graph-bootstrap-status.test.ts` + `sync-worktree-local-state.test.ts` 全绿。**风险最集中的一批**（见下节）。
4. **批 4 — hook 修复(C1) + AGENTS.override.md + repo:check 接入(C7)**：`worktree-lifecycle.sh` 改造 + node 缺失端到端测试、`.gitignore` 新增行、第 14 族接入 + 两个沙箱集成测试补 `.worktreeinclude`（对应测试策略 14-16）。可独立验证：`npm run repo:check` 含新族且 pass，两个既有集成测试仍 pass，`worktree-lifecycle-hook.test.ts` 绿。**（W3 修正）批 4 仅依赖批 1**（`worktree-local-state-core.mjs` 存在即可接入第 14 族）；与批 3 无依赖关系，可与批 3 并行执行，此前"批 4 依赖批 3 的状态文件写入逻辑"的表述不成立，已删除。
5. **批 5 — 全量回归收口**：`npx vitest run`/`npm run build`/`npm run repo:check` 三件套零失败，对照 M8 基线做净增量核对（对应测试策略 17）。

---

## 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 批 3 改造过程中若遗漏 C1 的 `command -v node` 条件分支包裹任一处 `node` 调用，`node` 缺失环境会触发 `set -e` 中断整条 sync（审查已实测 127 退出的具体场景） | 高——静默丢失 SYMLINK_TARGETS/COPY_TARGETS 全部同步效果 | 测试策略第 14 步的 PATH 剥离 `node` 端到端用例专门守护这一点；实现时对 `bootstrap_graph()` 内**每一处** `node .../graph-bootstrap-status.mjs` 调用做代码走查，逐一确认都在 `if command -v node` 分支内 |
| `attemptLocalGraphBuild` 的独立进程组信号发送在部分容器化 CI 环境可能受限（`process.kill(-pgid, ...)` 依赖进程组语义，某些沙箱/容器对信号转发有限制） | 中 | 测试策略第 9 步的两个 stub 覆盖 darwin/Linux 标准语义；若未来 CI 环境证实进程组信号不可用，需要单独 follow-up（不阻塞本 feature，因为默认路径不依赖 `--attempt-build`） |
| 组装 `spawn`/`spawnSync` 参数时若把子命令与 flag 拼成单字符串而非独立数组元素，可能重演 §M10 记录的"`spectra graph quality --help` 被解析成 `spectra graph` 静默毁图"事故 | 高（一旦发生，直接摧毁图的 provenance 且无告警） | `checkFreshness`/`attemptLocalGraphBuild` 的 `spawn`/`spawnSync` 调用一律使用参数数组（`['graph-quality', '--json', ...]`），代码走查 checklist 明确列出这一条；测试策略第 8 步的假 CLI fixture 用精确参数断言调用形态 |
| `checkFreshness` 强依赖全局 `spectra` CLI 可用性；本机/CI 若未安装全局 `spectra`，第 8 步的真实 CLI 冒烟测试会被 skip，仅剩 fixture 驱动的假 CLI 测试覆盖 adapter 逻辑，无法验证与真实 CLI 输出的实际兼容性 | 中 | 冒烟测试用 `it.skip`（而非静默跳过不留痕迹）+ 明确 skip 原因；CI/发布前建议至少手工跑一次真实冒烟作为补充证据，不作为自动化门禁的硬性前提 |
| C11 的硬链接发布依赖 `tmp` 与 `target_path` 位于**同一文件系统**（跨文件系统 `ln` 会失败）；`sync-worktree-local-state.sh` 现有实现已把 tmp 建在与 target 相同目录下（`${target_path}.bootstrap.$$.tmp`），本身满足同文件系统前提 | 低 | 沿用现有"tmp 与 target 同目录"的既有设计，不引入新的跨文件系统风险；若未来改变 tmp 存放位置需重新评估 |
| 决策 2 选择"不新增 npm script"，未来若 Codex 客户端的 `.codex/` setup script 语法要求"必须是 npm script 名" | 低 | 若实现阶段真实核实到该约束，追加一行 `package.json` script 即可，不影响本方案其余部分 |

**回滚粒度**：批次之间相互独立可回滚（每批对应独立 commit）；批 3（graph provenance 重构）若发现问题，**回滚方式统一为 revert 该批次对应的 commit**（C10 修正：不再保留"sidecar 只读并存"作为降级预案，因为并存本身违反 spec 回归护栏第 5 条的不变量，不是合规的中间态）。

---

## Spec FR/SC 映射表

| 条目 | 落到的改动 | 落到的测试 |
|---|---|---|
| FR-001 | `.worktreeinclude` 新增；`worktree-local-state-core.mjs::validateWorktreeIncludeContract`（九类 reason，C5） | `worktreeinclude-contract.test.ts` |
| FR-002 | `sync-worktree-local-state.sh::read_worktreeinclude_entries`（C6 grammar 钉死） | `worktreeinclude-golden-matrix.test.ts` + 动态清单红测试（C9-1） |
| FR-003 | `sync-worktree-local-state.sh::validate_entry`（九类拒绝） | 决策 6 重做后的 FR-011 矩阵（C8） |
| FR-004 | 不变（SYMLINK_TARGETS 仍硬编码 6 项） | characterization guard（W3）+ symlink 生成用例 |
| FR-005 | 不变（pattern 黑名单为新增测试逻辑） | 反向插入验证判红用例 |
| FR-006 | `graph-bootstrap-status.mjs` 全部（C1-C4/C10/W1）；`bootstrap_graph()` sidecar 移除+迁移性删除+四事实状态机+ node 守护 | `graph-bootstrap-status.test.ts`（含 C3/C4 全部测试）+ `sync-worktree-local-state.test.ts` poison-sidecar/sidecar-absent 用例 |
| FR-007 | `.gitignore` 新增 `AGENTS.override.md` | `git check-ignore` 断言 |
| FR-008 | `worktree-local-state-core.mjs::validateAgentsByteBudget` | `worktreeinclude-contract.test.ts` |
| FR-009 | `worktree-lifecycle.sh::create` 分支改造 | `worktree-lifecycle-hook.test.ts` |
| FR-010 | `sync-worktree-local-state.sh::--attempt-build` + `attemptLocalGraphBuild`（异步进程组，C2） | `graph-bootstrap-status.test.ts`（两个关键 stub）+ 手工 SC-001 验证 |
| FR-011 | `validate_entry` 九类拒绝 | 决策 6 重做矩阵（隔离 HOME + reason code，C8） |
| FR-012 | `.worktreeinclude` 动态绑定后 `copy_path` 覆盖语义不变 | 既有 3 个 COPY_TARGETS 用例 + 动态清单红测试 |
| FR-013 | 全部改动均需回归 | 批 5 全量 `npx vitest run` |
| SC-001 | 决策 2 + C2 `attemptLocalGraphBuild` | 两个关键 stub + 手工真实耗时验证 |
| SC-002 | `.worktreeinclude` 动态绑定 | 动态清单红测试（C9-1，直接证据） |
| SC-003 | FR-005 测试 | 同上 |
| SC-004 | FR-004 测试 | 同上 |
| SC-005 | FR-007/FR-008/FR-001 尾斜杠（C5） | 同上 + `.env.local/` 用例 |
| SC-006 | FR-011 | 决策 6 重做矩阵（C8，reason code 精确断言） |
| SC-007 | FR-006 sidecar 移除 + `checkFreshness` adapter（C3） | poison-sidecar 接线测试（C9-2）+ adapter 解析映射测试 |
| SC-008 | FR-009 | `worktree-lifecycle-hook.test.ts` |
| SC-009 | 批 5 | 全量三件套 + 两个既有集成测试不回归（C7） |

**回归护栏第 4 条（复用 evaluateFreshness 四态模型，不得另造不兼容语义）落点**：决策 5/C3 定案——生产路径 spawn 全局 `spectra graph-quality --json`，复用编译进该 CLI 的同一份 F217 判定实现，四态原样透传不折叠；不再需要"等价性合同测试"这一防漂移机械手段，因为架构上已消除"第二份实现"这一漂移源头。
