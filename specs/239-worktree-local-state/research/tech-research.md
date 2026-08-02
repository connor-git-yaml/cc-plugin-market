# 技术调研报告：Feature 239 — Worktree 与 Local 状态（M9 轨道 B3）

**特性分支**：`239-worktree-local-state`
**调研日期**：2026-08-02
**调研模式**：在线（WebFetch + WebSearch 均可用）
**产品调研基础**：无 product-research.md，采用**独立模式**——直接基于 `docs/design/milestone-M9-codex-trusted-live-graph.md:129-135`（B3 五条要求）与主编排器需求描述执行

---

## A. 外部平台事实核查

> 方法：直接 `WebFetch` 官方文档 URL；`learn.chatgpt.com` 两个目标 URL 均可直接访问，未触发降级。以下每条均附原文摘录。

### A1：`.worktreeinclude` — **官方已支持的真实机制**（高可信度，直接摘自官方文档）

来源：<https://learn.chatgpt.com/docs/environments/git-worktrees>

原文摘录：
> "add a `.worktreeinclude` file to the repository root and list the ignored paths or `.gitignore`-style patterns to copy when Codex creates a managed worktree"
> "Use this for files Git intentionally ignores, such as `.env`, `.env.local`, or `config/secrets.json`"
> "Codex only copies ignored files that match `.worktreeinclude`; it doesn't copy other local files that Git doesn't track"
> "Codex skips source symlinks and won't overwrite files that already exist in the new checkout"
> "Codex automatically copies an ignored `AGENTS.override.md` into local managed worktrees, so you don't need to list it in `.worktreeinclude`"

**结论**：
- 放置位置：**仓库根目录** `.worktreeinclude`
- 语法：**`.gitignore` 风格的逐行路径 / glob pattern**（示例即为逐行路径，未见注释符或否定模式 `!` 的官方示例——**未查到**是否支持 `#` 注释或 `!` 否定，需保守假设"不确定支持，测试验证"）
- 语义：**只处理 Git ignored 的路径**；非 tracked 也非 ignored（即压根不存在于 `.git` 视野）的文件不处理
- Copy vs symlink：**Codex 侧固定语义 = copy**（源为 symlink 时会 **skip**，不会创建 symlink 副本；已存在的目标文件不会被覆盖——即 copy-if-absent 语义，与本仓库 `copy_if_absent_atomic` 现有设计**天然一致**）
- 适用范围限定：本机制**仅适用于 Codex 桌面应用管理的本地 worktree**（"local managed worktrees"），**不适用于远程或命令行创建的 worktree**——这对本仓库同时服务"手工 Git worktree"场景是关键差异点（见 C 节）
- `AGENTS.override.md` **不需要**在 `.worktreeinclude` 中显式列出——Codex 对它有专门的自动 copy 路径

### A2：`AGENTS.override.md` — **官方识别文件名**，三级发现顺序 + 拼接合并语义（高可信度）

来源：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>

原文摘录：
> Global scope: "Codex reads `AGENTS.override.md` if it exists. Otherwise, Codex reads `AGENTS.md`"
> Project scope: 从 root 向 cwd 逐级检查 "for `AGENTS.override.md`, then `AGENTS.md`, then any fallback names"
> Merge 语义: "Codex concatenates files from the root down, joining them with blank lines. Files closer to your current directory override earlier guidance"
> "Use `~/.codex/AGENTS.override.md` when you need a temporary global override without deleting the base file."

**结论**：
- `AGENTS.override.md` 是官方文件名，**每一层目录**（含全局 `~/.codex/`）都可以有自己的 override，遇到即**取代同层 AGENTS.md**（"reads X if it exists, otherwise reads Y"——是同层二选一，不是同层内容合并）
- 跨层级则是**拼接（concatenate）**，root→cwd 逐级用空行连接，**距离当前目录更近的层级内容覆盖更早的指导**（语义覆盖，非文件覆盖——文本层面是并存拼接，效力上后者优先）
- **未明确提及 "AGENTS.local.md"**——原文只字未提这个文件名；`learn.chatgpt.com` 页面明确列出的是 `AGENTS.override.md` / `AGENTS.md` / "any fallback names"（"fallback names" 具体指什么未展开，**未查到**其枚举列表，可能含 `CLAUDE.md` 等兼容名，需要进一步查证或保守处理）
- 本仓库 B3 要求"不新增 Codex 不识别的 AGENTS.local.md"——**该约束成立且必要**：`AGENTS.local.md` 确实不在官方识别列表内，若新增会被 Codex 完全忽略

### A3：Codex project instruction byte budget = **`project_doc_max_bytes`，默认 32 KiB**（高可信度）

来源：同 A2 页面（<https://learn.chatgpt.com/docs/agent-configuration/agents-md>）

原文摘录：
> `"project_doc_max_bytes" (32 KiB default)`
> Codex "stops adding files once the combined size reaches the limit"
> 建议 "Raise the limit or split instructions across nested directories when you hit the cap."

**结论**：
- 单位是**字节**（KiB = 1024 bytes，即 32768 bytes），不是 token 数或字符数——对中文重字节内容（UTF-8 下每个汉字 3 字节）尤其敏感
- 超限行为：**静默截断**（"stops adding files"——不是报错，是达到累计上限后不再纳入后续文件），**不是**单文件截断，是多文件拼接过程中的整体上限
- 作用范围：`project_doc_max_bytes` 命名指向 **project instruction 文档整体**（即 AGENTS.md/AGENTS.override.md 及嵌套目录里同名文件拼接后的总量），**未查到**是否单独计入 skill/reference 等其他注入内容——**保守假设仅指 AGENTS 文档链，需以实测校验**
- 可配置：limit 本身**可调**（"Raise the limit"），说明这是 Codex 侧的可配置参数而非硬编码墙——具体配置项名称/文件位置**未查到**，需要进一步查证（`config.toml` 猜测，未证实，标注 `[推断]`）

### A4：Codex-managed worktree setup 脚本机制（中等可信度——补充信源非 learn.chatgpt.com 一手页面，但与官方 local-environments 页交叉印证）

来源：<https://learn.chatgpt.com/docs/environments/local-environment>（`developers.openai.com/codex/app/local-environments` 308 重定向至此）

原文摘录：
> "Codex stores this configuration inside the `.codex` folder at the root of your project."
> "Setup scripts run automatically when Codex creates a new worktree at the start of a new chat."
> "Use this script to run any command required to configure your environment, such as installing dependencies or running a build process."
> "Since worktrees run in different directories than your local chats, your project might not be fully set up."
> "If your setup is platform-specific, define setup scripts for macOS, Windows, or Linux to override the default."

**结论**：
- 配置位置：仓库根 **`.codex/` 目录**（具体文件名/字段格式**未查到**——页面未给出精确 schema，如 `.codex/setup.sh` 还是 `.codex/config.toml` 里的字段，需要另开一轮定向搜索或人工在 Codex 客户端 UI 里核实）
- 执行时机：**每次新 worktree 在新 chat 起始时自动运行一次**（不是每次消息、不是 post-commit 触发）
- 工作目录：**worktree 目录本身**（非主仓）——`WebSearch` 补充信源（`github.com/openai/codex/issues/13576`，标题 "Inject worktree/root path environment variables into setup scripts"）显示 **setup script 不接收任何指明 worktree/root 路径的环境变量**，且截至该 issue 提交时无直接方法获取主仓绝对路径——这是一个**已知社区反馈的 gap**，对本 feature 关键：意味着 setup script 若想找到"主仓 graph.json 在哪"，不能依赖环境变量，只能靠**相对路径推断或约定俗成的固定位置**（如 `~/.spectra-graph-cache/`，与本仓 `sync-worktree-local-state.sh` 决策 5 的共享缓存二期设想一致）
- 失败暴露方式：**未查到**明确说明（官方页面未展开失败行为，是否阻断 chat 启动、是否有可见日志均不确定）
- 平台差异：支持按 macOS/Windows/Linux 分别定义 setup script 覆盖默认

**A4 补充信源清单（WebSearch 结果，未逐一深挖，供实现阶段进一步查证）**：
- <https://github.com/openai/codex/issues/13576>（setup script 环境变量 gap，issue 讨论）
- <https://codex.danielvaughan.com/2026/04/11/codex-app-worktree-lifecycle-local-environments/>（第三方 blog，未核实准确性，仅作为背景参考）

---

## B. 仓库现状

### B1. `scripts/sync-worktree-local-state.sh`（382 行）逐条读毕

**顶层判定**（`sync-worktree-local-state.sh:123-130`）：通过 `git rev-parse --show-toplevel` 与 `git rev-parse --git-common-dir` 对比，判定当前是否为 worktree；主工作区 no-op。

**SYMLINK_TARGETS**（`:151-158`，共 6 项，逐条 copy 语义 = 软链，实时反映所有 worktree）：
| 路径 | 理由（原注释，`:142-150`） |
|---|---|
| `.claude/settings.local.json` | Claude Code 项目级 local settings（设计上共享） |
| `.specify/.spec-driver-path` | spec-driver plugin 路径解析缓存 |
| `.agents/skills` | Feature 213 从整目录 `.agents` 收窄，避免 tracked 的 `.agents/plugins/` 被 symlink 穿透污染主仓 |
| `node_modules` | 避免每个 worktree 重新 `npm install` |
| `_reference` | 调研参考代码（graphify / GitNexus / khoj 等） |
| `CLAUDE.local.md` | 本地开发规则，设计上跨 worktree 即时共享 |

**COPY_TARGETS**（`:164-166`，共 1 项，copy-on-checkout 语义，每次 sync 覆盖）：
| 路径 | 理由 |
|---|---|
| `.env.local` | 含 secret（API key），per-worktree 独立副本，**软链会导致 worktree 误覆盖污染父仓库**（Codex CRITICAL 修订 `:161-163`） |

**关键函数职责**：
- `link_path`（`:76-121`）：source 不存在→跳过；target 已是指向同 source 的软链→idempotent 跳过；target 是空目录→自动清理重建（典型场景：vitest 提前建空 `node_modules/`）；target 是非空真实文件/目录→warn 并跳过（不覆盖）
- `copy_path`（`:223-244`）：target 是遗留软链→先删后转 copy（迁移路径）；否则 `cp -p` 每次覆盖
- `copy_if_absent_atomic`（`:273-310`）：与 `copy_path` 的**核心差异**——只在 target **不存在**时 copy（tmp + mv 原子写），已有真实文件（非 symlink）**永不覆盖**（保护 worktree 本地增量）；symlink/目录等异常类型不静默当作"已有"，也不 copy，交人工处置；源不存在视为非错误
- `check_graph_source_stale`（`:314-324`）：对比 sidecar 记录的源 commit 与当前 worktree HEAD，不一致→warn 提示（不阻断）；sidecar 缺失（本地构建图）→no-op
- `bootstrap_graph`（`:326-364`）：graph.json 与 snapshot **各自独立** `copy_if_absent_atomic`（避免"有 graph 无 snapshot"永久退化）；两者皆无源→仅日志提示构建命令，不报错；仅当**本次确实从主仓 copy 了图**才写 sidecar（本地构建的图无"源 commit"概念）；bootstrap 后无论首次还是 rerun 都调用 `check_graph_source_stale`
- `migrate_legacy_agents_symlink`（`:191-211`）：Feature 213 遗留问题——旧 worktree 若 `.agents` 是整目录软链，需先迁移为真实目录才能处理收窄后的 `.agents/skills` 子链，否则会沿旧链把 `rm -rf` 打进主仓（用 `resolve_physical_path` 归一化处理 macOS `/var`↔`/private/var` 等 symlink 差异）

### B2. `tests/unit/sync-worktree-local-state.test.ts`（397 行）覆盖矩阵

**已覆盖**：
- SYMLINK_TARGETS：`CLAUDE.local.md`（软链+内容一致）、`.agents/skills`（软链）、旧整目录软链迁移守护三种场景 (a)(b)(c)、idempotent 重复执行
- COPY_TARGETS：`.env.local` 从软链转 copy、修改互不影响、遗留软链自动迁移为 copy
- source 不存在跳过（不抛错，`CLAUDE.local.md` / `.env.local`）
- 主工作区 no-op
- graph bootstrap（F193，8 个用例）：首次 copy + sidecar 写入、copy-if-absent 幂等不覆盖增量、快照缺失不阻断、主仓无图给出提示、stale rerun 提示、**首次 bootstrap 即 stale**（worktree 先 diverge 场景）、graph 已有但 snapshot 缺失时补齐、graph 目标为 symlink 时不静默覆盖
- `scheduled_tasks.lock` 显式不同步

**未覆盖（本 feature 改造时需新增的护栏缺口）**：
- **无任何 `.worktreeinclude` 清单驱动测试**——当前 SYMLINK_TARGETS/COPY_TARGETS 是脚本内硬编码数组，没有从外部清单文件读取的机制，也没有对应测试
- **无 secret 分类强制测试**——`.env.local` 走 COPY_TARGETS 是靠人工把它放对数组、靠注释约定，没有任何测试断言"某条目若被标为 secret 类，必须走 copy 分支，不能被误放入 SYMLINK_TARGETS"
- **无 `AGENTS.override.md` 相关任何测试**——脚本当前完全不处理这个文件（既不 symlink 也不 copy）
- **无 Codex setup script 触发路径的测试**（本仓库 Codex 集成目前只有 `.codex/skills/*`，没有 setup script 概念的落地）
- **无 AGENTS.md byte budget 校验测试**

### B3. `plugins/spec-driver/hooks/worktree-lifecycle.sh`（33 行）

`create` 动作：若 `scripts/sync-worktree-local-state.sh` 存在则 `bash` 执行（`2>/dev/null || true`，静默吞掉失败）。`remove` 动作：cd 到 worktree path，检查 `git diff --quiet` 是否有未提交变更，有则 stderr 警告。**注意**：`create` 分支对 sync 脚本失败是**完全静默吞掉**（`|| true`），这与 B3 要求"不得复制陈旧图后静默宣称 ready"存在**潜在张力**——sync 脚本内部虽然对 stale 会 warn，但 hook 层面把整体 exit code 都吞了，若脚本因异常（非预期的 stale 分支）以非零退出，hook 也不会向上传播。

### B4. graph bootstrap 现状（F193）

- `specs/193-worktree-graph-bootstrap-freshness/spec.md` / `plan.md` 已完整设计并落地 id 相对化 + bootstrap + 保活 + stale sidecar 机制（详见上方 B1 `bootstrap_graph`/`check_graph_source_stale`）
- sidecar `specs/_meta/.graph-source-commit` 语义：仅记录**主仓 HEAD commit hash**（`sync-worktree-local-state.sh:349-357`），bootstrap copy 时若从主仓 copy 了图才写；rerun 时对比 worktree 当前 HEAD，不一致则 warn "图可能 stale"（不阻断）
- `spectra batch --mode graph-only` 实测数据（引自 `docs/design/milestone-M9-codex-trusted-live-graph.md:124`）：耗时 **3.2s**，5723 节点/7689 边（F214 dist 重建后实测），纯 AST 零 LLM，无需认证——这是"快速 graph-only bootstrap"最直接可用的现成命令，B3 第 3 条"Codex-managed worktree setup 优先运行快速 graph-only / incremental bootstrap"可以直接映射为 setup script 里调用 `spectra batch --mode graph-only`（或 `spectra index` 增量），而非依赖父仓库 copy（父仓库 copy 路径已由 `sync-worktree-local-state.sh` 覆盖，但那是"手工 worktree"场景；Codex-managed worktree 若走官方 setup script，是否能访问到父仓库路径本身是 A4 揭示的已知 gap）

### B5. 相邻既有设施

- `.gitignore` 中候选的 ignored local file（可能进入 `.worktreeinclude` 清单的候选集）：`.env*`（`:17`，除 `.env.example`）、`.claude/settings.local.json`（`:47`）、`.claude/scheduled_tasks.lock`（`:48`）、`CLAUDE.local.md`（`:49`）、`.specify/.spec-driver-path` / `.specify/runs/`（`:52-53`）、`.spectra/`（`:56`，F152 快照）、`.agents/*` 排除 `.agents/plugins/`（`:59-63`）、`_reference`（`:66`）、`.claude/worktrees/` / `.claire/`（`:68-70`，Claude Code 运行态目录本身）
- 仓库**目前没有 `.codex-plugin/` 目录**（`Glob` 结果为空）——AGENTS.md `:150` 提到的"轨道 A `.codex-plugin` 一体分发"尚未落地，是并行的 M9 轨道 A 工作，不在本 feature 范围
- 仓库**已有 `.codex/` 目录**，但内容仅为 `skills/spec-driver-*/SKILL.md`（8 个），**没有** setup script、没有 `config.toml`——A4 揭示的官方 setup script 机制在本仓库尚未使用
- `AGENTS.md` 当前 312 行，内容以中文散文为主（每个 CJK 字符 UTF-8 占 3 字节），大段引用 `docs/shared/*.md` 同步生成的共享区块（behavior-rules / context-layering / release-contract / repo-maintenance / branch-sync-policy / code-quality / mainline-focus / orchestration-overrides / eval-credentials-policy / dogfooding-policy，共 9 个 `<!-- BEGIN/END SHARED SECTION -->` 区块，`:28-311`）——这些区块**由 `npm run docs:sync:agents` 生成，不可手改**，本 feature 若要"保持在 byte budget 内"，可动的空间只有 `:1-27` 的 Codex 专属前言 + 决定哪些共享区块要不要精简/拆分到 nested directory（A3 官方建议"split instructions across nested directories"）。**本次调研未能用 Bash 工具实测精确字节数**（工具权限只有 Read/Grep/Glob/WebFetch/WebSearch），需要实现阶段用 `wc -c AGENTS.md` 核实；按行数与中文密度粗估（312 行、大量中文表格与段落），**大概率处于 32 KiB default 附近或已超限**，这是需要在 spec 里显式列为验收项的风险点，不能想当然认为"现在没问题"

### B6. 回归护栏定位

- **F215**（`specs/215-fix-e2e-baseline-decouple/`）：E2E fixture 解耦，图输入钉在 `tests/fixtures/micrograd-baseline-graph`，与主仓 home baseline 解耦——本 feature **不触碰**这条链（不改测试 fixture 生成逻辑），但若改造 bootstrap 脚本涉及 graph 相关分支要小心不要间接影响该 fixture 的加载路径
- **F217**（`specs/217-graph-quality-gates/`）：`graph quality` CLI + 六指标 + `repo:check` 第 12 族——本 feature 若涉及"陈旧图判定"逻辑，理论上与 F217 的 freshness 指标（`docs/design/milestone-M9-...md:120` "graph source commit 与 HEAD 一致，或明确返回 stale，不允许静默使用旧图"）是**同一诉求的两个实现面**（F217 做查询期机器可查信号，本 feature 做 bootstrap 期人可读 warning）——存在**收敛为同一套 stale 判定合同**的机会，值得在 plan 阶段讨论是否复用 F217 的 freshness 判定逻辑而不是各写一套
- **F193**：见 B4，是本 feature 直接的前置依赖与被复用对象（`copy_if_absent_atomic` / sidecar 机制）

---

## C. 设计空间与风险

### C1. 单源 `.worktreeinclude` + 双消费者的可行实现路径

**关键前提（来自 A1）**：Codex 官方 `.worktreeinclude` 语法是 **`.gitignore`-style 逐行路径/pattern**，且**只适用于 Codex 桌面应用管理的本地 worktree**，不适用远程/命令行创建的 worktree。这意味着：

- **不能自造格式**——B3 要求"仅复制适合复制的 ignored local file"用的清单文件名 `.worktreeinclude` 本身已被 Codex 官方占用语义，若我们自定义 YAML/JSON 格式装在这个文件名下，Codex 侧解析会失败或产生未定义行为。**必须遵循官方 `.gitignore` 风格逐行路径**格式
- bash 消费该格式**成本很低**——`.gitignore` 风格本身就是 bash/grep 容易处理的纯文本格式（逐行 path/glob，`#` 开头大概率是注释，虽未在官方文档验证，但是 `.gitignore` 生态的通用惯例）；`sync-worktree-local-state.sh` 现有的 `SYMLINK_TARGETS`/`COPY_TARGETS` 两个 bash 数组可以从解析 `.worktreeinclude` 逐行生成，而不是像现在这样硬编码
- **真正的难点不是格式，而是"copy vs symlink"的分类**——官方 `.worktreeinclude` 语义本身**只有 copy 一种动作**（A1："Codex only copies..."），没有内建"这条走软链、那条走真实 copy"的字段。而本仓库现状恰恰是 SYMLINK_TARGETS 与 COPY_TARGETS 两类语义并存（`.env.local` 必须 copy，`CLAUDE.local.md` 等必须软链跨 worktree 共享）。若严格对齐官方语义，`.worktreeinclude` 只能覆盖"该 copy 的那一类"（本质上就是现有 COPY_TARGETS 的超集），**SYMLINK_TARGETS 那部分不属于 `.worktreeinclude` 的官方语义范围**，需要继续留在 `sync-worktree-local-state.sh` 自身的清单逻辑里（这一分类边界应该在 spec 阶段明确写清楚，不要让"单源"变成"把两种不同语义的东西硬塞进一个官方保留文件名"）
- **推荐设计**（推测，需 plan 阶段定案）：`.worktreeinclude` 只承载"copy 语义"的路径清单（即当前 `COPY_TARGETS` 的内容 + 未来新增的 secret 类文件），且**该文件同时是 Codex 官方消费的真实清单**（不做二次抽象）；bash `sync-worktree-local-state.sh` 读取同一份 `.worktreeinclude` 文件内容作为它的 `COPY_TARGETS` 数组来源（用 `grep -v '^#' .worktreeinclude | grep -v '^$'` 之类的简单解析）。至于 SYMLINK_TARGETS（node_modules、_reference 等"应共享可变状态"的路径），**保持独立于 `.worktreeinclude` 之外**，因为 Codex 官方语义里没有这个概念，硬塞会造成语义混淆且 Codex 侧根本不认

### C2. secret 一律 copy 不 symlink 如何强制

- 现有唯一防线是**代码注释约定**（`sync-worktree-local-state.sh:161-163`"Codex CRITICAL 修订：含 secret 的文件不能用软链"）——纯靠人工遵守，没有校验
- Codex 官方侧本身已经是"copy-only"语义（A1），所以 `.worktreeinclude` 内的条目从 Codex 消费视角**天然不会被 symlink**；风险点在**本仓库 bash 脚本侧**——如果未来有人把一条 secret 路径误加进 `SYMLINK_TARGETS` 而不是 `.worktreeinclude`/`COPY_TARGETS`，没有任何机制会拦截
- 可能的强制机制（按草案级别，非结论，供 plan 阶段选择）：
  1. **命名前缀/后缀约定 + 静态校验脚本**：如果一个待纳入清单的路径匹配已知 secret pattern（`.env*`、`*secret*`、`*key*`、`*.pem`、`*credentials*`），CI/`repo:check` 中新增一条检查，扫描 `SYMLINK_TARGETS` 数组内容，命中则 fail
  2. **清单本身要求显式 `kind` 标注**（如果放弃"直接就是 Codex `.worktreeinclude` 官方格式"、改成本仓库自己再包一层结构化清单给 bash 消费，用一个字段区分 `copy`/`symlink`）——但这与"必须遵循官方格式"的约束冲突，除非分成两个文件（`.worktreeinclude` 官方 copy 清单 + 另一个自定义 symlink 清单），也是可行方案之一
  3. **两份清单物理分离是更简单可靠的方案**：`.worktreeinclude`（官方格式，纯 copy 语义，Codex 与 bash 都读它）+ bash 脚本内继续保留硬编码 `SYMLINK_TARGETS`（不做成外部清单，因为这部分 Codex 完全不消费，做成外部清单反而增加一次不必要的抽象）。这样"secret 一律 copy"约束通过"secret 类文件只能出现在 `.worktreeinclude`，不能出现在 bash 脚本的 `SYMLINK_TARGETS` 硬编码数组"来落地，校验就是对 `SYMLINK_TARGETS` 数组做一次 pattern 黑名单扫描（单元测试断言 `SYMLINK_TARGETS` 不含 `.env`/`secret`/`key` 等关键词）

### C3. "不得复制来源 commit 不明的陈旧图后静默宣称 ready" 判定点

- 现有 `.graph-source-commit` sidecar（F193 决策 3）**已经覆盖"手工 worktree bootstrap"路径的判定**：copy 时写源 commit，rerun 时对比，不一致 warn（不阻断）
- **缺口在于"静默宣称 ready"**——当前设计哲学是"stale 图仍优于无图，不阻断"，这与 B3 的措辞"不得...静默宣称 ready"有微妙差异：现有实现**不是完全静默**（会 warn 到 stderr），但**也不是显式的"ready/not-ready"状态机**——调用方（比如 goal_loop 或 MCP 工具）无法程序化读取"这个图是否 stale"，只有人眼能看到 shell warn 输出。如果 Codex setup script 场景下 stderr warning 被日志吞掉或用户根本没看 setup 输出，效果上确实等同于"静默 ready"
- 判定"够不够"取决于 B3 这条要求的目标受众：如果是给**人类开发者**看，现有 sidecar + warn 机制基本够；如果是给 **goal_loop / MCP 工具等程序化消费者**判断"能不能信任这张图"，则需要补一个**结构化、可查询的 ready 状态**（比如复用 F217 graph-quality 的 freshness 字段，或者在 `.graph-source-commit` sidecar 旁边再加一个机器可读的 `bootstrap-status.json`，记录 `{source: 'primary-copy'|'local-build'|'none', sourceCommit, worktreeHead, stale: boolean, timestamp}`）——**这是需要在 spec 阶段明确目标受众后再定案的开放问题**（见 E 节）

### C4. Top 5 风险与踩坑点

1. **`.worktreeinclude` 官方语义仅覆盖 Codex 桌面应用管理的本地 worktree，不适用手工 Git/命令行 worktree**——本仓库当前主力工作流恰恰是"每 feature 一个手工 git worktree"（`CLAUDE.md` 描述），这意味着单一 `.worktreeinclude` 文件本身**并不会被手工 worktree 场景消费**，B3 第 4 条"与 Codex setup 共用同一 target contract"必须理解为"内容/清单共用，触发路径各自实现"，而不是"一个文件自动对两种场景生效"——如果 spec 里把这条写成"Codex 和 bash 脚本会自动共享同一份行为"，会产生过度乐观的期望，需要在 spec 里明确写清楚触发机制的差异
2. **AGENTS.md byte budget 超限风险未经实测验证**——A3 确认 default 32 KiB，本仓库 AGENTS.md 312 行、9 个共享区块、大量 CJK 内容，粗估已经处于临界或超限区间，且这些共享区块由 `docs:sync:agents` 自动生成不可手改，"保持在 byte budget 内"这条验收标准可能需要**结构性动刀**（比如把部分共享区块下沉到 `.codex/AGENTS.md` 或 nested directory，而不是简单精简文字）——这是实现阶段成本可能远超预期的一条
3. **Codex setup script 机制细节大面积未查到**（A4）——配置文件精确字段格式、失败暴露方式均无法确认，且社区 issue 显示"无法从 setup script 获取主仓/worktree 路径"是已知 gap，这直接影响 B3 第 3 条"setup 优先运行快速 graph-only / incremental bootstrap"怎么落地：如果 setup script 拿不到主仓路径，就没法走"从主仓 copy 现成图"的捷径，只能退化为每次都跑 `spectra batch --mode graph-only`（3.2s，可接受，但意味着"bootstrap 优先 copy 复用"这一层在 Codex-managed 场景可能天然不成立，需要在 plan 阶段做取舍）
4. **`worktree-lifecycle.sh` 对 sync 脚本失败静默吞掉（`2>/dev/null || true`）**——即便 sync 脚本内部把"陈旧图"处理得再规范（有 warn），hook 层面的静默吞错策略会让整条链路在 Codex/Claude 的 hook 执行上下文里"看起来什么都没发生"，这与 B3"不得静默宣称 ready"的精神有潜在冲突，需要在本 feature 里评估是否要收紧这个 `|| true`（但收紧有回归风险——现有测试大量依赖脚本对已知异常分支返回 0，需要谨慎修改 exit code 语义）
5. **"单源 + 双消费者"防漂移目标与官方格式限制的张力**——B3 第 4 条要求"避免两套清单漂移"，但 A1 揭示官方 `.worktreeinclude` 语义只覆盖 copy 类文件，无法覆盖 SYMLINK_TARGETS 类文件，这意味着**完全消除两套清单在技术上不可行**（除非放弃官方格式，但那违反"必须遵循官方约定"的更高优先级要求）。现实可行的目标应该收窄为"copy 类文件只有一份清单"，而 symlink 类文件继续独立维护——spec 阶段需要明确降低这条要求的字面预期，避免验收标准写成技术上做不到的"完全统一"

---

## D. 结论与对 spec 的建议

1. **`.worktreeinclude` 必须严格采用官方 `.gitignore` 风格逐行路径格式**，且该文件的语义范围仅限"copy 类"（含 secret）文件；不要尝试把 SYMLINK_TARGETS 类路径也塞进同一份 `.worktreeinclude`——两者服务不同消费者（Codex 官方 vs 本仓库 bash 脚本），语义本就不同，spec 应该把"单源"目标精确定义为"copy 类文件清单单源"，而非"全部清单单源"
2. **`AGENTS.override.md` 按官方语义实现**：新增该文件承载本地私有指令，注意它是"同层二选一"（覆盖同层 AGENTS.md，不是追加），若本仓库既有 `AGENTS.md`（受控同步生成）又想要本地私有覆盖，需要想清楚"本地私有指令"具体要不要完全替换掉 AGENTS.md 的内容——**推荐**（推测）：本地覆盖内容通过某种方式引用/包含原 AGENTS.md 内容 + 追加私有部分，而不是让 Codex 完全丢弃现有 312 行的规则（否则会造成"本地开发者反而看不到项目规则"的倒退）
3. **`AGENTS.md` byte budget 合规必须先实测再设计**：实现阶段第一步应是 `wc -c AGENTS.md`（+ 若有其他被拼接的 nested AGENTS.md）拿到精确数字，与 32 KiB 比较，若已超限，需要制定"哪些共享区块下沉/精简"的方案，并更新 `docs/shared/*.md` 的同步脚本使其继续保持单一事实源（不能靠手改 AGENTS.md 逃避同步机制）
4. **Codex-managed worktree setup script 的落地建议保守**：鉴于 A4 揭示的配置格式/失败暴露/路径变量均未查证清楚，建议 spec 把这部分的验收标准定得较松（比如"提供一个可被 Codex setup 阶段调用的 bootstrap 命令，产出结构化状态"），而不要写死具体的 `.codex/` 文件名或字段，除非实现阶段能在真实 Codex 客户端里实测验证格式
5. **"陈旧图判定"应该考虑与 F217 graph-quality freshness 门禁收敛**为同一套判定逻辑（而非各写一份），至少在数据模型（sidecar 字段命名、stale 判定算法）上保持一致，减少未来维护两套语义的成本
6. **"单源双消费者不漂移"的验收标准需要降低字面预期**：技术上做不到"一个文件同时被 Codex 官方与 bash 脚本以完全相同方式消费全部场景"，spec 应改写为"copy 类文件清单单源（`.worktreeinclude`）；symlink 类清单继续独立维护但有清晰的分类文档标注，两者合起来构成完整的 target contract"

---

## E. 未解决问题（需人工拍板）

1. **`.worktreeinclude` 是否支持 `#` 注释与 `!` 否定模式**——官方文档给出的示例过于简单，未展示这两种 `.gitignore` 常见语法是否被支持；建议实现阶段直接在真实 Codex 客户端里建一个测试 worktree 实测验证，而非凭 `.gitignore` 通用印象假设支持
2. **`project_doc_max_bytes` 的具体配置项位置/文件名**——A3 只确认了参数名与默认值，未确认它在哪个配置文件里、本仓库是否需要/是否已经配置了自定义值
3. **Codex setup script 精确的文件名/字段格式**——A4 核心缺口，需要人工在 Codex 客户端 UI 里创建一次 setup script 直接观察生成的 `.codex/` 目录结构，或等待 OpenAI 补充更详细文档
4. **"AGENTS override" 对已有大段共享区块内容的取舍策略**——是本地开发者完全看不到 AGENTS.md 的项目规则（只看私有规则），还是私有规则叠加在项目规则之上？这直接决定 `AGENTS.override.md` 的内容该怎么写，需要产品/维护者拍板
5. **"陈旧图判定"的目标受众**——C3 提出的"人类可读 warning 是否足够，还是需要程序化可查询的 ready 状态供 goal_loop/MCP 消费"，决定本 feature 的实现范围是否要触及 F217 graph-quality 的数据模型，需要在 plan 阶段与 F217/M9 轨道 B2 owner 对齐
6. **手工 Git/Claude worktree 场景下 `.worktreeinclude` 清单是否也要被 `sync-worktree-local-state.sh` 消费**（C1 推荐方案的具体实现选择），还是维持现状"COPY_TARGETS 硬编码数组"不做外部化——这是一个成本 vs 收益的权衡，供 plan 阶段决定是否值得为"未来可能不会真正减少两套清单"的目标做额外重构

---

## 工具使用反馈（Dogfooding）

- 本次调研任务明确要求"优先用 `mcp__plugin_spectra_spectra__*` 工具"，但涉及的调研对象（`scripts/sync-worktree-local-state.sh`、`plugins/spec-driver/hooks/worktree-lifecycle.sh`、`.gitignore`、`AGENTS.md`）**均属于任务描述中已知的图谱覆盖盲区**（`.sh` / `.mjs` / 纯配置文件不在图谱内），因此本次全程使用 Read/Grep/Glob 完成调研，**未实际调用 Spectra MCP 工具**，符合任务描述里"查不到就退回 Read/Grep 并记一句"的预期，不视为异常
- 遗憾点：本次任务缺少 Bash 工具权限，无法用 `wc -c AGENTS.md` 实测精确字节数，只能基于行数/中文密度做粗略估计并在报告里明确标注为待实现阶段验证事项——建议后续 tech-research 类子代理若涉及"字节数/文件大小"类事实核查，应显式授予只读的文件系统体积查询能力（如 `wc`/`stat` 白名单），否则会把本该在调研阶段闭合的问题拖到 plan/implement 阶段
