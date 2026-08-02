---
feature: 239-worktree-local-state
title: Worktree 与 Local 状态（M9 轨道 B3）
status: draft
created: 2026-08-02
research_basis: specs/239-worktree-local-state/research/tech-research.md
measurements_basis: specs/239-worktree-local-state/research/orchestrator-measurements.md
review_round: 1
review_basis: reviews/codex-spec-review-round1.md
milestone_source: docs/design/milestone-M9-codex-trusted-live-graph.md#B3
---

# Feature 239：Worktree 与 Local 状态

## 概述与目标

本 feature 落地 M9 里程碑轨道 B 第 3 项（B3）：让"手工 Git/Claude worktree"与"Codex-managed worktree"两条路径都能可靠地拿到本地态（配置、secret、依赖）与知识图谱（graph），并且不再出现"图是陈旧的却被当作 ready 使用"的静默降级。

核心目标：

1. 用官方 `.worktreeinclude` 机制承载"copy 类"本地文件清单（含 secret），内容采用两个消费者（Codex 桌面应用、本仓库 `sync-worktree-local-state.sh`）都能安全解释的**受限安全子集**（见 FR-001），而非放任双方各自解释 gitignore 全语法。
2. 用官方 `AGENTS.override.md` 机制承载本地私有指令，替代不被 Codex 识别的 `AGENTS.local.md` 设想，并确保该文件真的处于 Codex 官方自动复制的前提（ignored）之内。
3. 让 graph bootstrap 的"是否可信"从纯人眼可读的 stderr warning，升级为**唯一权威 freshness 合同**（与既有 F217 `evaluateFreshness` 四态对齐）+ **结构化 provenance 记录**（bootstrap 来源、时刻），供程序化消费者（首个消费者为 sync 脚本自身）判断是否可以信任当前图，且不再让仓库里已经存在的"两套互相矛盾的 provenance"继续并存或被复制成第三套。
4. 收紧 `worktree-lifecycle.sh` 的失败吞噬策略：失败原因必须可见，但仍不阻断 worktree 创建。

**明确排除**：本 feature 不追求"一个文件自动对所有 worktree 创建方式生效"的完全统一——这在技术上做不到（见下方边界声明）；不追求"secret 内容级扫描"这一更强安全命题（见 Non-Goals）；不在本 feature 内实现 goal_loop / MCP 对状态文件的实际消费（留作 M9 轨道 B4 follow-up）；也不在本 feature 内改造 A4（CODEX_HOME helper 统一）或 F238（Codex 一体分发）触及的路径。

## 边界声明（必须诚实标注，避免下游误解）

- `.worktreeinclude` 是 Codex 官方机制，**官方文档原文**（来源：`learn.chatgpt.com/docs/environments/git-worktrees`，见 research §A1）明确其"只适用于 Codex 桌面应用管理的本地 worktree"，**不适用于远程或命令行/手工创建的 git worktree**。因此：
  - `.worktreeinclude` 这一份文件的**内容**（copy 类路径清单）会被两个消费者共同读取：Codex 桌面应用（原生支持，行为不可被本仓库测试直接断言）+ 本仓库 `sync-worktree-local-state.sh`（新增读取逻辑，行为可被本仓库测试断言）。
  - 但**触发路径完全独立**：Codex 侧由其桌面应用在创建 managed worktree 时自动执行；bash 侧由 `worktree-lifecycle.sh` hook 或手工调用触发。**不存在"改一次自动对两边生效"的运行时联动**，只有"清单内容不用写两份"的静态复用。
  - **两端行为的已知、声明过的差异**（不是需要消除的 bug，而是需要在实现与测试里显式承认的既定事实）：Codex 官方语义固定为 **copy-if-absent**（已存在目标不覆盖，源为 symlink 会被跳过）；bash 侧对 `.worktreeinclude` 中列出的条目沿用既有 `copy_path` 语义，即**每次 sync 执行都覆盖已有目标**（保证 secret 更新后在 worktree 侧被拉取，这是本仓库现有 `.env.local` 语义的既定设计，见"回归护栏"）。两者覆盖语义不同，是刻意保留的差异，不通过本 feature 统一。
  - 为避免"双消费者各自解释官方 gitignore-style 全语法（含未证实的 `#`/`!`/转义支持）从而产生行为漂移"，本 feature 把 `.worktreeinclude` 的**内容合同**收紧为双方都无歧义的**安全公共子集**（见 FR-001），而不是依赖对官方全语法的猜测性兼容。
  - `.worktreeinclude` 的官方语义**仅覆盖 copy 一种动作**。本仓库现有 `SYMLINK_TARGETS`（node_modules / `_reference` / `CLAUDE.local.md` / `.agents/skills` / `.claude/settings.local.json` / `.specify/.spec-driver-path`，共享可变状态、需要跨 worktree 实时同步）**不属于该文件的官方语义范围**，继续保留在 `sync-worktree-local-state.sh` 脚本内部硬编码维护，不纳入 `.worktreeinclude`（见 FR-004）。
- `AGENTS.override.md` 是官方"同层二选一"语义（遇到即整体取代同层 `AGENTS.md`，不是内容追加合并），且官方机制的前提是该文件必须是 **git ignored** 才会被 Codex 自动复制到 managed worktree（见 FR-007）。
- Codex-managed worktree 的 setup script 精确配置文件名/字段 schema **官方文档未给出**（research §A4），本 feature 对这部分只做**能力性**要求（提供一个可被 setup 阶段调用的 bootstrap 入口 + 结构化状态输出），不写死具体 `.codex/` 文件名或字段格式。
- **仓库当前已经存在两套互相矛盾的 graph provenance 记录**（实测证据见 `orchestrator-measurements.md` §M4/§M6）：`graph.json` 内嵌 `graph.sourceCommit` 字段（每次构建都正确更新）与 F193 sidecar `specs/_meta/.graph-source-commit`（仅 bootstrap copy 时写，本地重建路径完全不更新，已实测失准 37 个 commit）。本 feature 必须消除"三套并存"的风险，而不是在已有两套之上再叠加一套（见 FR-006）。

## User Scenarios

### 场景 A：手工 Git/Claude worktree（当前主力工作流）

- **Given** 开发者用 `git worktree add` 为某个 feature 新建一个手工 worktree
- **When** worktree 创建 hook（`plugins/spec-driver/hooks/worktree-lifecycle.sh` create 分支）触发 `scripts/sync-worktree-local-state.sh`
- **Then** 该 worktree 应获得：
  - `.worktreeinclude` 中列出的 copy 类文件（含 secret，如 `.env.local`）的独立副本，且每次 rerun 覆盖已有目标
  - 既有 `SYMLINK_TARGETS` 的软链（node_modules 等，跨 worktree 实时共享，行为不变）
  - 一份 graph.json + 快照（若主仓有），以及一份**结构化的 graph bootstrap 状态记录**，标明 bootstrap 来源、bootstrap 时刻的图内嵌 sourceCommit 快照、bootstrap 时刻 worktree HEAD；freshness 判定不缓存在该文件中，由消费者按需现算（见 FR-006）
  - 若 sync 脚本内部发生非预期失败，hook 层面在 stderr 输出明确失败原因，但 worktree 创建流程本身不中断

### 场景 B：Codex-managed worktree（Codex 桌面应用创建）

- **Given** 开发者在 Codex 桌面应用中为某仓库新建一个 managed worktree 并开始新 chat
- **When** Codex 按官方机制自动处理 `.worktreeinclude`（copy-if-absent 语义复制 ignored 文件）与 `AGENTS.override.md`（若本地存在且已被 ignore 则取代 `AGENTS.md`），随后 setup 阶段调用本仓库提供的 bootstrap 入口
- **Then**：
  - `.worktreeinclude` 中列出的 copy 类文件（含 secret）被 Codex 原生复制到新 worktree（本 feature 不编写代码控制 Codex 这一步的执行，只保证清单内容符合安全子集且格式合规）
  - bootstrap 入口按 FR-010 定义的双腿验收执行，并写出与场景 A 一致 schema 的结构化状态记录，不静默宣称 ready
  - 若本地存在已被 ignore 的 `AGENTS.override.md`，本地私有指令生效

### 场景 C：主工作区（非 worktree）

- **Given** 当前目录就是主工作区（`git rev-parse --show-toplevel` 等于主 common-dir 推导出的根）
- **When** 触发任何本 feature 新增或改造的脚本
- **Then** 保持现状 no-op（不产生 `.worktreeinclude` 消费副作用，不生成 graph bootstrap 状态文件）

## Functional Requirements

- **FR-001（.worktreeinclude 内容合同：安全公共子集）**：`.worktreeinclude` 只允许包含满足以下全部条件的条目：(a) repo-relative 字面文件路径（不含 glob 通配符 `*`/`?`/`[]`，不含否定前缀 `!`，不含反斜杠转义，不含尾部 `/` 目录标记）；(b) 该路径必须是当前 worktree 下的 git ignored 路径；(c) 若该路径在当前 checkout 存在，必须是常规文件而非目录（目录条目不合规）；路径不存在时不视为违规（ignored 文件在干净 checkout 中缺席是常态，例如 CI 干净 checkout 里 `.env.local` 本就不存在），此时仅按 (a) 语法与 (b) ignored 前提校验，不因文件缺席而判定条目不合规。空行与以 `#` 开头的整行注释允许出现，但不计入条目。该内容合同必须由一个独立单元测试直接校验 `.worktreeinclude` 文件本身的每一行是否满足上述子集（而不仅仅测试消费该文件的脚本行为）。当前 `.env.local` 必须作为其初始内容整体迁移进此文件。
- **FR-002（bash 消费者与覆盖语义声明）**：`scripts/sync-worktree-local-state.sh` 必须读取 `$CURRENT_ROOT/.worktreeinclude`（即当前 worktree 自身 checkout 出来的版本，而非主仓路径）——worktree 创建时刻与主仓同一 commit，因此该文件在创建瞬间与主仓一致；此后主仓对该文件的修改需要开发者按既有分支同步流程（rebase/合并）传播到 worktree，属于正常 git 工作流的一部分，不由 sync 脚本额外处理。对清单内每一条目，bash 侧必须沿用既有 `copy_path` 覆盖语义（每次 sync 执行覆盖已有目标），这与 Codex 官方 copy-if-absent 语义不同，是本 feature 声明过的已知差异（见"边界声明"），不视为不一致缺陷。`.worktreeinclude` 文件缺失时必须优雅降级（不报错退出，视为空清单 + 记录一条可见提示）。
- **FR-003（路径 containment 校验，防逃逸）**：bash 解析 `.worktreeinclude` 得到的每个条目，在拼接为 `$PRIMARY_ROOT/<entry>` 与 `$CURRENT_ROOT/<entry>` 之前，必须做规范化后的 containment 校验：拒绝绝对路径（以 `/` 开头）、拒绝任何包含 `..` 路径段的条目、拒绝任何不符合 FR-001 安全子集语法的条目（glob 通配符、否定前缀 `!`、转义字符）。校验失败的条目必须被 **skip**（不执行 copy）并输出可见 warning，不得中断整个 sync 流程的其余步骤。
- **FR-004（SYMLINK_TARGETS 固定 allowlist）**：`SYMLINK_TARGETS` 数组必须精确等于以下 6 项，不多不少：`.claude/settings.local.json`、`.specify/.spec-driver-path`、`.agents/skills`、`node_modules`、`_reference`、`CLAUDE.local.md`。必须有参数化单元测试逐项断言：(a) 该数组精确等于此 6 项集合（增删任一项都判定失败）；(b) 对每一项，当其 source 在主仓存在时，sync 后 worktree 侧确实生成指向主仓对应路径的软链。这 6 项路径不得出现在 `.worktreeinclude` 内容中（由 FR-001 的安全子集校验间接保证，因为 FR-001 只校验 `.worktreeinclude` 自身内容，此处额外要求交叉断言：这 6 项字符串不出现在 `.worktreeinclude` 文件内容里）。
- **FR-005（secret 文件名策略：defense-in-depth，非绝对安全声明）**：新增一层文件名 pattern 黑名单，扫描 `SYMLINK_TARGETS` 数组的每一项字符串内容，命中以下任一 pattern（均采用单词边界匹配，避免误伤如 `monkey.json`、`keyboard-layout.json` 等无关文件）时判定测试失败：`\.env`、`\bsecret\b`、`\bkey\b`（含 `id_rsa`、`\.pem`、`\.p12`、`\.pfx` 等常见私钥后缀）、`\btoken\b`、`\bcredential`、`\bpassword\b`、`\bauth\.json\b`。该 pattern 黑名单是 FR-004 固定 allowlist 之外的**第二道防线**（defense-in-depth），用于拦截未来对 `SYMLINK_TARGETS` 的误改动；它只能证明"文件名不匹配已知敏感关键词"，**不能**证明该路径指向的目录/子树内容中不含 secret，也不能替代 FR-004 的固定 allowlist 作为主防线。
- **FR-006（graph bootstrap 结构化状态：唯一权威 freshness 合同 + provenance 记录）**：
  - 状态文件路径钉死为 `specs/_meta/graph-bootstrap-status.json`，该路径必须被 `.gitignore` 收录（本地运行态，不入库）；因不参与 F193 的跨 worktree byte-level 可复现性对比（该对比范围是 `graph.json`/快照本身，见 `tests/unit/graph/cross-worktree-byte.test.ts`），可以安全携带真实生成时间戳，不受 F193 `graph.generatedAt` 恒为 epoch 零值的约束限制。
  - 字段表（`schemaVersion: 1` 起）：
    | 字段 | 类型 | 说明 |
    |---|---|---|
    | `schemaVersion` | number | 固定为 `1`，未来破坏性变更递增 |
    | `bootstrapSource` | `"primary-copy" \| "local-build" \| "none"` | 本次 bootstrap 图的来源三态 |
    | `embeddedSourceCommitAtBootstrap` | string \| null | bootstrap 完成时刻，图内嵌 `graph.sourceCommit` 字段的快照值（仅作记录，非权威 freshness 判定入口） |
    | `worktreeHeadAtBootstrap` | string \| null | bootstrap 完成时刻的 worktree HEAD |
    | `generatedAt` | string (ISO 8601) | 本状态文件写入时刻的真实时间戳 |
    | `assessable` | boolean | `false` 表示状态不可评估（如 bootstrap 过程本身异常终止、或图文件读取/解析失败），此时其余字段允许为 `null` |
  - **freshness 唯一权威合同**：本状态文件**不缓存** `stale` 布尔值或任何 freshness 判定结果。freshness 必须由消费者在读取时刻，以图文件内嵌 `graph.sourceCommit` 与当前 HEAD 对比，通过既有 F217 `evaluateFreshness`（`src/panoramic/graph/quality/quality-types.ts` 定义的 `GraphFreshnessVerdict`）四态模型（`fresh` / `dirty` / `stale` / `unknown-provenance`）现算得出，不得落盘缓存、不得在本状态文件中重复表达。`unknown-provenance` 态承载"来源 commit 不明"的判定语义，直接对应 B3"不得复制来源 commit 不明的图后静默宣称 ready"的要求。
  - **不允许三套 provenance 并存且互相矛盾**这一条是硬性不变量：本状态文件写入后，F193 sidecar（`specs/_meta/.graph-source-commit`）必须二选一处置——(a) 改为与本状态文件同步更新（消除已实测的"本地重建路径不更新 sidecar"缺陷），或 (b) 由本状态文件完全取代、移除 sidecar 独立写入逻辑。两种处置方式的具体选择留给 plan 阶段决定，但 spec 层面钉死：实现完成后，仓库内关于"这张图来自哪个 commit"的可查询记录**只能有一套权威口径**（内嵌 `graph.sourceCommit`），任何辅助记录（sidecar 或状态文件）都不得与其矛盾，且不得在本地重建路径下产生"记录未更新导致误报"的行为（对应已实测的 M4/M6 缺陷）。
  - **第一消费者**：`sync-worktree-local-state.sh` 自身现有的 `check_graph_source_stale` warning 路径，必须改为读取本状态文件（或改造后的 provenance 记录）作为其判断依据，而不是继续读取当前已被证实存在更新缺陷的旧 sidecar 逻辑——即本 feature 至少要让 sync 脚本自己成为该状态文件的第一个真实消费者。goal_loop / MCP 工具对该状态文件的消费是 M9 轨道 B4 的 follow-up 范围，本 feature 不实现（见 Non-Goals）。
  - **写入语义**：状态文件必须使用 temp 文件 + `mv`（rename）的原子写方式，不允许出现半文件状态。同一 worktree 内先后发起的两次 sync 执行，后完成写入的进程覆盖先完成写入的进程结果（后写覆盖，不做锁或排队）；本 feature 不引入跨进程锁机制。`--dry-run` 模式下不落盘写入本状态文件，只在 stdout/stderr 输出本次运行"若非 dry-run 将会写入"的拟生成状态内容。
  - **状态文件每次 `bootstrap_graph` 执行都必须更新**（无论是否发生实际 copy 动作，也无论走 `primary-copy`、`local-build` 还是 `none` 分支），确保不会重复 M4/M6 实测发现的"仅部分路径更新导致记录失准"缺陷。
- **FR-007（AGENTS.override.md 必须处于 ignored 前提）**：`.gitignore` 必须新增规则使 `AGENTS.override.md` 被 git 忽略。验收包含：`git check-ignore AGENTS.override.md` 命令必须成功（退出码 0）；且必须有断言确认 `AGENTS.override.md` 字符串不出现在 `.worktreeinclude` 内容中（因为官方机制会自动复制该文件，无需、也不应重复列入清单）。
- **FR-008（byte budget 校验：按 active 文件、按 max 不按 sum）**：必须新增可重复运行的字节数校验手段（脚本或测试断言），对**每一个在仓库根目录可能成为 Codex 同层 active 文件的候选**分别校验其字节数 ≤ 32768（Codex `project_doc_max_bytes` 默认值）：即 `AGENTS.md` 与（若存在）`AGENTS.override.md` 各自独立校验，取二者中的较大值与预算比较，而非将两者字节数相加——因为 `AGENTS.override.md` 存在时是同层**取代** `AGENTS.md`（官方"二选一"语义），而非叠加读取。若未来仓库出现 nested 目录下的 `AGENTS.md`/`AGENTS.override.md`（当前仓库经实测确认只有仓库根一份，无 nested），该校验手段需要按 root→cwd 路径累计计算，这一前瞻性要求本 feature 只需留下扩展点，不需要在无 nested 文件的当前状态下实现累计逻辑。当前实测基线：`AGENTS.md` = 23346 bytes（占预算 71.2%，余量 9422 bytes），`AGENTS.override.md` 尚不存在。
- **FR-009（worktree-lifecycle.sh hook 失败可见但不阻断）**：`plugins/spec-driver/hooks/worktree-lifecycle.sh` 的 `create` 分支必须调整为：`sync-worktree-local-state.sh` 执行失败时，失败原因（stderr 内容）必须对用户可见，但 hook 自身仍以成功退出码结束（不阻断 worktree 创建流程）。该行为必须由自动化 fixture 测试验证（构造一个固定输出特定 stderr 内容并以非零码退出的 sync 脚本 fixture，断言 hook 保留该 stderr 内容且 hook 自身退出码为 0），不得仅以手工验证步骤代替。
- **FR-010（Codex-managed worktree bootstrap 入口）**：必须为 Codex-managed worktree 场景提供一个显式可调用的 bootstrap 入口（命令或脚本），其行为按 FR-006 定义的状态文件 schema 输出结构化状态；不得写死或假定未经证实的 `.codex/` setup script 文件名/字段格式（若确有需要写入具体文件名，须标注 `[推断]` 并留待实现阶段用真实 Codex 客户端核实）。该入口在满足 SC-001 成功腿前置条件时必须尝试构建可查询图，只有在枚举的真实失败原因下才允许写出 `bootstrapSource: "none"`（详见 SC-001）。**已实测结论**：repo `node_modules` **不是** `spectra batch --mode graph-only` 的前置条件——`orchestrator-measurements.md` §M9 已用 `git clone --local` 制造零 `node_modules`、零预置图的全冷副本，全局安装的 `spectra` CLI（自带自身依赖）在该环境下 3524ms 内成功建图（6079 节点/8050 边，与热环境一致），图内嵌 `sourceCommit` 正确写入。因此 bootstrap 入口的唯一环境前置是"全局 `spectra` CLI 可用"，不依赖当前仓库是否已存在 `node_modules`（也不依赖 FR-004 的软链是否已完成）。
- **FR-011（路径逃逸对抗测试矩阵）**：必须新增以下对抗性测试用例，逐一验证 FR-003 的 containment 校验生效、且不产生任何仓库外读写：`.worktreeinclude` 含绝对路径条目（如 `/etc/passwd`）、含 `..` 路径穿越条目（如 `../shared-secret`）、含 glob 通配符条目（如 `*.env`）、含否定前缀条目（如 `!keep.env`）、含反斜杠转义条目（如 `\#file`）。每个用例必须断言：该条目被 skip 且产生 warning，sync 流程正常完成其余步骤，且文件系统层面在仓库根目录及其祖先目录之外**零写入、零读取**发生。
- **FR-012（`.env.local` 二次同步覆盖测试）**：必须新增测试验证：worktree 首次 sync 后 `.env.local` 已存在，随后主仓 `.env.local` 内容变化，再次执行 sync，worktree 侧内容必须被覆盖为最新内容（而非保留旧内容）——锁定"文件每次覆盖"这一既有覆盖语义，防止实现过程中被误改为 copy-if-absent 语义。清单中若出现目录类条目，由 FR-001 内容合同测试直接判定失败（目录不在安全子集内），运行时层面（若绕过内容合同检测出现目录条目）按 FR-003 的规范化校验统一 skip + warning 处理，不与文件覆盖语义混淆。
- **FR-013（现有测试套件回归保护）**：本 feature 完成后，`tests/unit/sync-worktree-local-state.test.ts` 现有全部用例（含 F193 的 8 个 graph bootstrap 用例、`.agents` 旧软链迁移守护三场景、主工作区 no-op、幂等性）必须保持通过，不得删除或弱化既有断言。

## Non-Goals（明确排除）

- 不追求让 `.worktreeinclude` 对手工/命令行创建的 worktree 自动生效——这是 Codex 官方机制的既定边界，本 feature 只做"内容单源、触发各自实现"。
- 不实现"完全统一"的清单格式（即不会把 `SYMLINK_TARGETS` 也塞进 `.worktreeinclude` 或另建一份带 `kind: copy|symlink` 字段的自定义超集清单）。
- 不实现 secret **内容级**扫描（如扫描文件内容判断是否含 API key 字符串）——FR-005 仅是文件名 pattern 黑名单这一 defense-in-depth 层，明确不对"目录子树内容中是否含 secret"做任何断言或保证。
- 不在本 feature 内实现 goal_loop / MCP 工具对 `graph-bootstrap-status.json` 的实际消费逻辑——第一消费者仅为 sync 脚本自身（FR-006），程序化下游消费者的接入是 M9 轨道 B4 的 follow-up 工作。
- 不改动 A4（CODEX_HOME helper 统一）——遇到相关路径解析问题记为 follow-up，不在本件修。
- 不改动 F238 涉及的 `plugins/spec-driver` wrapper 链与 `.codex-plugin` 一体分发。
- 不对 Codex 桌面应用本身的行为做任何断言性验证（该行为不可从本仓库单元测试直接测得，只能测本仓库侧的清单内容/格式正确性，Codex 侧行为的验证只能通过真实客户端人工验证，不纳入自动化门禁）。
- 不改动 F217 graph-quality 门禁本身的实现——本 feature 只是把 F217 已有的 `evaluateFreshness` 四态模型确立为唯一权威 freshness 合同并复用，不修改其判定逻辑。

## Edge Cases

| 场景 | 预期行为 | 关联 FR |
|---|---|---|
| `.worktreeinclude` 文件不存在 | 脚本视为空清单，正常继续，不报错、不阻断其余同步步骤 | FR-002 |
| `.worktreeinclude` 含 `#` 注释行与空行 | 解析时跳过，不当作路径处理 | FR-001/FR-002 |
| `.worktreeinclude` 列出的路径在主仓不存在 | 跳过该条目，记录可见日志，不报错退出 | FR-002 |
| `.worktreeinclude` 含绝对路径 / `..` 穿越 / glob / 否定前缀 / 转义等超出安全子集的条目 | 双层拦截：(1) 内容合同单元测试直接判定该 `.worktreeinclude` 文件不合规（红）；(2) 即便绕过内容合同检测，运行时 containment 校验也必须 skip 该条目并输出 warning，零仓库外读写 | FR-001/FR-003/FR-011 |
| `.worktreeinclude` 列出了一个目录路径 | 内容合同单元测试判定失败（目录不在安全子集内）；运行时层面统一 skip + warning，不执行 copy | FR-001/FR-012 |
| 主仓本身也没有 `.worktreeinclude` | 等价于文件不存在的降级路径，两侧（主仓、worktree）都视为空清单 | FR-002 |
| worktree 首次 sync 后主仓 `.env.local` 内容变化，再次 sync | worktree 侧内容必须被覆盖为最新版本 | FR-012 |
| 有人误把一条 secret 路径（如 `*.pem`、`db-secret.json`）加进 `SYMLINK_TARGETS` 硬编码数组 | FR-004 固定 allowlist 测试首先判定失败（数组不再精确等于 6 项）；FR-005 文件名 pattern 黑名单作为第二道防线同样判定失败 | FR-004/FR-005 |
| `AGENTS.override.md` 存在但未被 `.gitignore` 覆盖 | `git check-ignore AGENTS.override.md` 失败，判定为不合规配置，需要补充 `.gitignore` 规则 | FR-007 |
| graph bootstrap 来源为主仓 copy（`bootstrapSource: "primary-copy"`） | 状态文件记录 bootstrap 时刻的内嵌 sourceCommit 快照与 worktree HEAD；freshness 由消费者读取图内嵌 `graph.sourceCommit` 现算，不读取本状态文件的任何缓存布尔值 | FR-006 |
| graph 为本地构建（`bootstrapSource: "local-build"`） | 状态文件必须在本地构建完成后同步更新（不得沿用旧 sidecar"仅 copy 时写"的缺陷行为），记录当前内嵌 sourceCommit 快照与 worktree HEAD | FR-006 |
| 主仓无图且 worktree 本地构建也失败 | `bootstrapSource: "none"`、`assessable: false`，且必须在枚举的真实失败原因下才允许出现此态（不得作为默认捷径瞬间满足 SC-001） | FR-006/FR-010 |
| `AGENTS.md` 未来因共享区块增长逼近或超过 32768 bytes | 校验手段必须能检测到（返回非零或明确 warning），而不是被动依赖人工偶尔 `wc -c` | FR-008 |
| `AGENTS.override.md` 存在且体积较大，但同层 `AGENTS.md` 体积正常 | 校验必须分别检测两者字节数（按 max 取较大值判定），不能因为只查了 `AGENTS.md` 就放过一个超限的 override | FR-008 |
| `worktree-lifecycle.sh` create 分支 sync 脚本抛出非预期异常（非已知的 stale/warn 分支） | stderr 必须显示具体失败原因；worktree 创建本身仍需成功完成；该行为由自动化 fixture 测试验证 | FR-009 |
| 同一 worktree 内两次 sync 几乎同时执行 | 状态文件采用原子写（temp+rename），不产生半文件；后完成写入的进程结果覆盖先完成写入的进程结果，不做锁或排队 | FR-006 |
| `--dry-run` 模式执行 sync | 不落盘写入 `graph-bootstrap-status.json`，仅在标准输出中展示"若非 dry-run 将写入"的拟生成状态内容 | FR-006 |

## 不可破坏的约束（回归护栏）

1. 现有 `SYMLINK_TARGETS`（6 项）与 `COPY_TARGETS`（原 1 项，`.env.local`，将迁移到 `.worktreeinclude`）逐条**语义不变**：`.env.local` 继续走 copy-on-checkout（每次 sync 覆盖）、其余六项继续走软链跨 worktree 实时共享。
2. `tests/unit/sync-worktree-local-state.test.ts` 现有全部用例必须保持通过：F193 graph bootstrap 8 个用例、`.agents` 旧软链迁移守护三场景（a/b/c）、主工作区 no-op、幂等重复执行。
3. F215（E2E baseline fixture 解耦，`tests/fixtures/micrograd-baseline-graph`）不受影响，本 feature 不改动其 fixture 生成逻辑或加载路径。
4. F217 graph-quality 门禁与六项质量指标不回归；本 feature 必须复用其 `evaluateFreshness` 四态模型作为唯一权威 freshness 判定入口，不得另造一套不兼容的 freshness 语义。
5. graph bootstrap 失败或来源不明时必须有**显式**状态标记（`bootstrapSource: "none"` / `assessable: false`），不允许假装 ready；仓库内不允许出现三套互相矛盾的 provenance 记录（内嵌 `graph.sourceCommit` 为唯一权威源，F193 sidecar 与新状态文件必须与之保持一致或被其取代，见 FR-006）。
6. 不修改 A4（CODEX_HOME helper 统一）范围内的代码；遇到相关问题记为 follow-up。
7. **本 feature 的改动面必须显式区分禁触与允许两类**：
   - **禁触面**（本 feature 严禁改动）：`plugins/spec-driver/` 下除 `plugins/spec-driver/hooks/worktree-lifecycle.sh` 之外的所有 wrapper 链代码、`.codex-plugin` 目录、F215 pinned fixture（`tests/fixtures/micrograd-baseline-graph`）及其生成逻辑、F217 graph-quality 门禁的判定实现本身（`src/panoramic/graph/quality/**`，本 feature 只读取/复用其导出的类型与函数，不修改其内部逻辑）。
   - **允许触面**（本 feature 需要且可以改动）：`scripts/sync-worktree-local-state.sh`；`tests/unit/sync-worktree-local-state.test.ts` 及本 feature 新增的测试文件；仓库根 `.gitignore`（新增 `AGENTS.override.md` 与 `specs/_meta/graph-bootstrap-status.json` 规则）；仓库根新增的 `.worktreeinclude` 文件；`specs/_meta/` 下与状态文件合同相关的新增文件；`plugins/spec-driver/hooks/worktree-lifecycle.sh`；`AGENTS.md`/新增 `AGENTS.override.md` 相关文档内容；`scripts/repo-check.mjs` 或 `scripts/lib/repo-maintenance-core.mjs` 中新增校验族相关代码（若实现阶段选择将本 feature 校验接入 `repo:check` 第 14 族）。

## Success Criteria

- **SC-001（graph bootstrap 双腿验收，固定参考环境）**：
  - **参考环境**：本开发机（darwin）+ 全局安装的 `spectra` CLI（版本 ≥ 4.4.0）可用；干净 worktree（新创建，未预先手工构建图）（repo `node_modules` 非前置，见 §M9）。
  - **成功腿**：在满足参考环境前置条件时，从调用 bootstrap 入口起计时，到状态文件（`graph-bootstrap-status.json`）落盘且图（`specs/_meta/graph.json`）可被查询工具读取为止，墙钟时间 ≤ 60 秒（`orchestrator-measurements.md` §M3 已实测单点 3.69 秒、§M9 在零 `node_modules` 全冷副本下实测 3524ms，验收时须在干净 worktree 环境下重新实测，不直接复用该数值作为验收证据）。
  - **失败腿**：人为制造失败前置条件（如临时将 `spectra` CLI 从 `PATH` 移除或重命名），bootstrap 入口必须在 ≤ 60 秒内完成执行并落盘 `bootstrapSource: "none"` 且 `assessable: false` 的显式非 ready 状态，不得挂起、不得无限重试、不得假装成功。
  - **两腿都必须被演示**：仅通过失败腿（即让入口不尝试构建、直接返回 `none`）不能视为满足本 SC；必须同时提供在正常前置条件下确实产出可查询图的证据。
- **SC-002（清单内容合同 + bash 动态绑定，不含 Codex 侧断言）**：必须有单元测试证明：(a) `.worktreeinclude` 文件内容本身满足 FR-001 定义的安全子集合同；(b) 修改 `.worktreeinclude` 内容后，`sync-worktree-local-state.sh` 的 copy 行为随之变化（证明 bash 侧确实动态读取该文件而非硬编码），不需要同步修改脚本代码。Codex 桌面应用侧对同一文件的实际处理行为**不纳入本仓库自动化断言范围**，只能通过真实 Codex 客户端人工验证（见 Non-Goals）。
- **SC-003（secret 文件名策略被测试强制，非绝对安全声明）**：存在对抗性单元测试：向 `SYMLINK_TARGETS` 硬编码数组人为插入一条命中 FR-005 pattern 黑名单的路径时，测试判定失败（红），移除后恢复通过（绿）。该 SC 仅证明"文件名 pattern 策略生效"，不声称、也不能声称"杜绝一切 secret 泄露"（内容级扫描属于 Non-Goals，不属于本 SC 覆盖范围）。
- **SC-004（SYMLINK_TARGETS 固定 allowlist 精确性）**：存在参数化单元测试断言 `SYMLINK_TARGETS` 数组精确等于既定 6 项集合，且对每一项在 source 存在时验证确实生成指向主仓对应路径的 symlink（对应 FR-004）。
- **SC-005（AGENTS override ignored + byte budget 校验）**：`git check-ignore AGENTS.override.md` 命令成功执行（退出码 0）；`AGENTS.override.md` 字符串不出现在 `.worktreeinclude` 内容中；存在可重复运行的字节数校验（脚本或测试），分别对 `AGENTS.md` 与（若存在）`AGENTS.override.md` 校验 ≤ 32768 bytes（按 FR-008 定义的"按 max 不按 sum"规则），当前基线 `AGENTS.md` = 23346 bytes 通过。
- **SC-006（路径逃逸对抗测试矩阵零仓库外写入）**：FR-011 列出的每一类恶意/边界输入（绝对路径、`..` 穿越、glob、否定前缀、转义）均有对应测试用例，且每个用例断言运行结束后仓库根目录及其祖先目录之外没有产生任何新文件或修改（零仓库外写入/读取）。
- **SC-007（graph provenance 唯一权威合同自消费）**：存在测试验证 `sync-worktree-local-state.sh` 自身的 stale warning 判定路径（即改造后的 `check_graph_source_stale` 或其等价逻辑）读取的是 FR-006 定义的状态文件或已改造后的 provenance 记录，而不是继续依赖已实测存在更新缺陷的旧 sidecar 独立逻辑；同时验证"本地重建路径下 provenance 记录被正确更新"（对应已实测的 M4/M6 缺陷不再复现）。
- **SC-008（hook 失败可见但不阻断，自动化验证）**：存在自动化 fixture 测试：构造一个固定输出特定 stderr 内容并以非零退出码退出的 `sync-worktree-local-state.sh` fixture，运行 `worktree-lifecycle.sh` 的 create 分支后，断言该 stderr 内容在 hook 输出中可见，且 hook 自身进程退出码为 0。
- **SC-009（全量门禁）**：`npx vitest run`、`npm run build`、`npm run repo:check` 全部零失败（含本 feature 新增测试与既有全部回归测试；改动前基线见 `orchestrator-measurements.md` §M8：483 test files / 5773 tests passed，作为 A/B 归因锚点）。

## 开放问题

以下事项已尽量按调研结论、用户决策与本轮 Codex 对抗审查裁决收敛，仍有 2 处需要在 plan 阶段进一步细化实现选择，未达到"歧义 >2 处需人工拍板"的门槛，故不再列为 `[NEEDS CLARIFICATION]`，而是作为执行阶段的核实项：

1. **F193 sidecar 的具体处置方式（FR-006 涉及）**：`[AUTO-RESOLVED: 按本轮审查裁决——不允许三套 provenance 并存且互相矛盾这一不变量已钉死在 FR-006/回归护栏第 5 条；"改为同步更新" vs "由新状态文件完全取代"两种具体实现路径留给 plan 阶段依据改动成本决定，二者均满足本 spec 的不变量]`。
2. **Codex setup script 的精确接入点（FR-010 涉及）**：`[AUTO-RESOLVED: 按调研建议采用能力性描述——先提供一个通用可调用的 bootstrap 命令/脚本入口，不假定具体 `.codex/` 文件名；待实现阶段有机会在真实 Codex 客户端环境核实后再补充具体接入点]`。

无 `[NEEDS CLARIFICATION]` 项——用户已就三项关键决策拍板，本轮 Codex 对抗审查的 8 项 CRITICAL、4 项 WARNING 已全部通过收紧 FR/SC 措辞、新增 containment 校验、固定 provenance 权威合同、明确禁触/允许改动面等方式落实为可测的规范条款，不遗留需要人工二次拍板的歧义。
