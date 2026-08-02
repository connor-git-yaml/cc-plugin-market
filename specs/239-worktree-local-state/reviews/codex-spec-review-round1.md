审查结论：发现 8 项 CRITICAL、4 项 WARNING。核心问题集中在：双消费者合同并不真正同义、graph freshness 会产生两套互相矛盾的真相，以及若干验收标准可以被“形式通过”。

## CRITICAL

### C1. “两消费者同源且不漂移”被 spec 自己允许的行为证伪

1. **问题描述**：`.worktreeinclude` 的 Codex 语义与 bash 解析合同没有对齐；SC-002 的单元测试最多只能证明 bash 会读文件，不能证明两个消费者行为一致。
2. **命中条目**：[FR-001/FR-002](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:63)、[FR-010](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:72)、[SC-002](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:113)。
3. **为什么是问题**：官方清单是 gitignore-style pattern，且只复制 ignored 路径、跳过源 symlink、不覆盖已有目标（[tech-research.md:19–30](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/research/tech-research.md:19)）；FR-002 却只要求跳过空行和注释。加入 `.env*` 时，Codex 会匹配文件，而一个完全符合 FR-002 的 bash 实现可以把它当字面路径；更直接的是 Edge Case 明确要求 tracked `package.json` 仍被 bash copy，而 Codex 必然跳过 tracked 文件，现有 `copy_path` 还会覆盖目标（[sync 脚本:223–251](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:223)）。因此“修改清单后 bash 行为变化”的测试通过，也不能证明 Codex 侧同义，更不能证明没有单侧漂移；此外 spec 没钉死 bash 应读 `$CURRENT_ROOT/.worktreeinclude` 还是主仓清单，分支间清单不同时仍可漂移。
4. **建议修法**：定义并校验两端共同支持的安全子集（例如仅允许当前 worktree 清单中的 ignored、repo-relative literal 路径），明确两端不可避免的覆盖差异，并把 SC-002 降格为“证明 bash 动态绑定清单”，Codex 语义另设真实客户端验收。

### C2. 清单没有路径边界合同，可被用于仓库外读写

1. **问题描述**：FR-002/FR-010 未规定拒绝 `../`、绝对路径、否定 pattern、转义 pattern 或解析后逃逸仓库的路径。
2. **命中条目**：[FR-002](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:64)、[FR-010](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:72)、Edge Cases 88–94 行。
3. **为什么是问题**：按现有循环的路径拼接方式（[sync 脚本:246–250](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:246)），清单加入 `../shared-secret` 后，直接复用 `copy_path` 的合规实现会从 `$PRIMARY_ROOT/../shared-secret` 读取，并写到 `$CURRENT_ROOT/../shared-secret`，源和目标都已逃出仓库；`!foo`、glob、`\#file` 等则会在 Codex 与 bash 间产生不同解释。FR-010 要求的测试矩阵完全没有这些输入。
4. **建议修法**：增加规范化后的 containment 校验，强制拒绝绝对路径、任何 `..` 段及未实现的 gitignore 语法，并为每类恶意输入增加“零仓库外写入”测试。

### C3. 新状态会与 F217/F193 产生互相矛盾的 freshness 真相

1. **问题描述**：FR-005 的 `sourceCommit + stale:boolean` 没有规定以 GraphJSON、F193 sidecar 还是当前主仓 HEAD 为事实源，而且无法表达 F217 已有的四态 freshness。
2. **命中条目**：[FR-005](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:67)、Edge Cases [95–96 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:95)、回归护栏 [105–106 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:105)。
3. **为什么是问题**：F217 已将 `graph.graph.sourceCommit` 定为 provenance，并规定 `fresh/dirty/stale/unknown-provenance` 四态（[F217 FR-009/010](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/217-graph-quality-gates/spec.md:91)，实际判定在 [source-commit.ts:150–202](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/src/panoramic/graph/source-commit.ts:150)）。反例：主仓 graph 在 commit A 构建，主仓 HEAD 前进到 B 但未重建；当前 bootstrap 会复制旧图，却把 sidecar 写成复制时的主仓 HEAD B（[sync 脚本:346–357](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:346)）。若新状态沿 sidecar 判定，就会写 `stale:false`，而 F217 从图内 `sourceCommit=A` 判 `stale`。反过来，sidecar 缺失也不能证明“本地构建”：手工复制、旧版图、损坏文件都会被 Edge Case 95 错标成 `local-build`。此外 HEAD 后续前进而未再次 bootstrap 时，静态 `stale:false` 会自行过期。
4. **建议修法**：以 GraphJSON `sourceCommit` 和 F217 `evaluateFreshness` 为唯一 freshness 合同，保留 sidecar 仅作 bootstrap 来源记录，并将 bootstrap 来源与四态 freshness 分成两个字段。

### C4. “机器可读状态”没有形成可消费的机器合同

1. **问题描述**：状态文件路径、文件名、字段名、nullability、schema version、损坏态和原子写语义都未固定，也没有任何 FR/SC 要求 MCP 或 goal_loop 实际读取它。
2. **命中条目**：[概述目标第 3 项](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:20)、[FR-005](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:67)、[FR-009](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:71)。
3. **为什么是问题**：FR-005 使用“位置与命名建议”“字段尽量对齐”“至少包含”等非合同措辞；bash 入口写 `bootstrap-status.json`、managed 入口写 `graph-bootstrap-state.json`，或一边用 `sourceCommit`、另一边用 `source_commit`，都可能被解释为满足 spec。即使两边碰巧一致，goal_loop 完全忽略该文件仍不违反任何 FR/SC，照样可能静默消费 stale 图。零字节或损坏 graph 也无法由目前的三态 `source` 准确表达。
4. **建议修法**：在 spec 中固定唯一相对路径和版本化 JSON Schema，定义 `cannot-assess/invalid` 等状态、原子写规则及至少一个真实消费者的拒绝/降级验收。

### C5. `AGENTS.override.md` 的官方自动复制前提没有落入需求

1. **问题描述**：FR-006 只要求写文档，没有要求把 `AGENTS.override.md` 设为 ignored；当前仓库也确实没有对应 ignore 规则。
2. **命中条目**：[场景 B:49–53](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:49)、[FR-006](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:68)、[SC-004](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:115)、M9 B3 [132 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/docs/design/milestone-M9-codex-trusted-live-graph.md:132)。
3. **为什么是问题**：官方事实是自动复制“ignored `AGENTS.override.md`”（[tech-research.md:19–23](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/research/tech-research.md:19)）；当前 [.gitignore:45–50](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/.gitignore:45) 只有 `CLAUDE.local.md` 等规则。开发者按文档创建一个普通 untracked `AGENTS.override.md` 时，SC-004 的可选存在性测试可以通过，但 Codex managed worktree 不会按已核实机制复制它。
4. **建议修法**：新增明确的 `.gitignore` 要求和 `git check-ignore AGENTS.override.md` 自动验收，同时断言它不进入 `.worktreeinclude`。

### C6. secret 黑名单只能拦文件名，无法证明“secret 永不 symlink”

1. **问题描述**：FR-004 只扫描路径字符串中的若干关键词，SC-003 却把它提升成“secret 永不 symlink”的证明。
2. **命中条目**：[FR-004](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:66)、Edge Case [94 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:94)、[SC-003](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:114)。
3. **为什么是问题**：把 `auth.json`、`token-store`、`id_rsa` 或 `private.p12` 加入 `SYMLINK_TARGETS`，都可避开列出的最小 pattern；也可以把 `.env.local` 放进已 symlink 的 `_reference/` 子树，顶层字符串扫描仍为绿。反方向上，若 `key` 用裸 substring，实现会误伤 `monkey.json` 或 `keyboard-layout.json`。因此测试红绿是可测的，但只证明“配置的文件名 pattern 生效”，不能证明文件内容或目录子树里没有 secret。
4. **建议修法**：将承诺收窄为精确定义的 filename policy，或改为固定 symlink allowlist＋新增项显式分类＋内容级 secret 扫描，禁止再用 SC-003 推导绝对安全结论。

### C7. “只允许修改这些文件”与强制测试、ignore 修改互相矛盾

1. **问题描述**：回归护栏第 7 条把本 feature 的改动限定为四类路径，却排除了多项 FR 必须修改的测试、`.gitignore` 和可能的状态 schema/消费者文件。
2. **命中条目**：[回归护栏第 7 条](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:108)，以及 FR-003、FR-004、FR-007、FR-010、SC-006。
3. **为什么是问题**：实现者若遵守“只动”清单，就不能新增 FR-003/004/010 要求的单元测试，也不能修改 `.gitignore` 使 override 成为 ignored；若添加这些文件，又立即违反不可破坏约束。任何 plan 都至少要违背其中一边。
4. **建议修法**：把该条改成“生产 wrapper/distribution 路径不得触碰”，并显式放行 `.gitignore`、测试、状态 contract、文档及必要消费者文件。

### C8. SC-001 既不可客观复现，也可以被 `source:none` 瞬间形式通过

1. **问题描述**：“≤1 分钟”没有定义机器、冷/热启动、依赖条件和计时边界，而且失败状态也算成功，使性能验收近乎空洞。
2. **命中条目**：[FR-009](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:71)、[SC-001](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:112)。
3. **为什么是问题**：一个入口完全不尝试建图，立即写 `source:none` 和提示，即可在一秒内满足 SC-001。反过来，干净 Codex worktree 没有 node_modules symlink，现有 `.codex/` 也没有 setup 配置（[tech-research.md:146–149](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/research/tech-research.md:146)）；若计入 `npm ci`/build，不能从现有 3.2 秒 graph-only 实测推导一分钟 SLA。不同验收者可以分别选择“依赖预装”和“全冷启动”，得到相反结论。
4. **建议修法**：固定参考环境、依赖前置、冷/热口径和起止时间，并规定满足前置条件时必须产出可查询图，只有枚举的真实失败原因才允许 `none`。

## WARNING

### W1. `.env.local` 的既有覆盖语义没有测试锁定，且与目录 Edge Case 冲突

1. **问题描述**：护栏要求 `.env.local` 每次 sync 覆盖，但目录 Edge Case 又声称沿用“已有真实内容不覆盖”的现有策略；实际 `copy_path` 对文件每次执行 `cp -p`。
2. **命中条目**：Edge Case [92 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:92)、回归护栏 [102 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:102)、FR-011。
3. **为什么是问题**：现有实现 [copy_path:223–244](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:223) 会覆盖已有 `.env.local`；现有测试 [180–224 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:180) 只验证首次 copy、隔离写入和 symlink 迁移，没有“父仓更新后 rerun 必须覆盖”。实现者把所有清单项改成 Codex 式 copy-if-absent 后，现有用例仍可能全绿。
4. **建议修法**：分别钉死“文件每次覆盖”和“目录 collision 如何处理”的合同，并新增 `.env.local` 二次同步覆盖测试。

### W2. 六项 `SYMLINK_TARGETS` 只防止进入清单，没有逐项防止被删或改变语义

1. **问题描述**：FR-003 的测试要求只断言六项“不出现在 `.worktreeinclude`”，没有要求脚本数组仍精确包含六项或六项都实际生成 symlink。
2. **命中条目**：[FR-003](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:65)、[FR-011](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:73)。
3. **为什么是问题**：当前数组确有六项（[sync 脚本:151–158](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:151)），但测试主要直接覆盖 `CLAUDE.local.md`、`.agents/skills` 和迁移场景（[测试:69–178](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/tests/unit/sync-worktree-local-state.test.ts:69)）。删除 `node_modules`、`_reference` 或 `.specify/.spec-driver-path` 仍可能满足“不在 `.worktreeinclude`”并让既有测试通过。
4. **建议修法**：增加参数化测试，断言脚本中六项精确集合及每项 source 存在时的 symlink 行为。

### W3. 字节预算只检查 `AGENTS.md`，没有检查 Codex 实际加载链

1. **问题描述**：平台预算是 project instruction 文档链的累计字节数，FR-007/SC-004 却只检查单个 `AGENTS.md`。
2. **命中条目**：[FR-007](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:69)、[SC-004](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:115)、开放问题 [123 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:123)。
3. **为什么是问题**：官方预算达到累计上限后停止加载（[tech-research.md:53–61](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/research/tech-research.md:53)）。当前仓库确实只有一个 23,346-byte `AGENTS.md`，所以当前值无误；但新增 root override 后实际加载的是 override 而不是同层 `AGENTS.md`，未来再有 nested AGENTS 时还会累计。一个 40 KiB override 可让 `AGENTS.md` 检查继续通过、实际指令却超限。“引用原 AGENTS.md”也不是官方 include 机制，仅写一个路径不能保证规则被加载。
4. **建议修法**：校验每个可能成为同层 active 文件的大小，并针对目标 cwd 计算 root→cwd 的有效累计预算。

### W4. 状态写入与并发、失败和 `--dry-run` 的语义未定义

1. **问题描述**：FR-005 要求每次 `bootstrap_graph` 都写状态，但没有原子写、并发排序、失败收尾或 dry-run 例外。
2. **命中条目**：[FR-005](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:67)、FR-009。
3. **为什么是问题**：两个 sync 同时在同一 worktree 执行时，现有“先检查再 plain `mv`”不是 no-clobber 原子操作（[sync 脚本:294–306](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:294)）；后到的旧图或状态可覆盖先到结果，非原子 JSON 写还可能留下半文件。另一方面，当前 `--dry-run` 明确不执行 `run` 写操作（[17–27、55–61 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:17)）：写状态违反 dry-run，不写又违反“每次都更新”。
4. **建议修法**：规定唯一写者、唯一临时文件策略或锁、状态与图 provenance 的提交顺序，并明确 dry-run 只输出拟生成状态而不落盘。

## INFO／已尝试证伪但未发现问题

### I1. 初始 `.env.local` 分类与缺失降级本身成立

1. **问题描述**：未发现初始 copy 类清单选择与当前仓库事实冲突。
2. **命中条目**：FR-001、FR-002，Edge Cases 88–90、93。
3. **为什么未证伪**：当前 `.env.local` 被 [.gitignore:16–18](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/.gitignore:16) 覆盖，符合 Codex “只复制 ignored 路径”的前提；缺失清单、空行、注释和不存在 source 的非阻断语义也与现有 source-missing 分支一致。
4. **建议修法**：保留这些条款，并补空文件、仅注释文件两个独立测试即可。

### I2. Hook“显示错误但不阻断”可客观测试

1. **问题描述**：未发现用户拍板的 hook 语义本身不可实现。
2. **命中条目**：[FR-008](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:70)、[SC-006](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:117)。
3. **为什么未证伪**：当前问题精确位于 [worktree-lifecycle.sh:15–20](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/plugins/spec-driver/hooks/worktree-lifecycle.sh:15) 的 `2>/dev/null || true`；用临时 fixture sync 脚本输出固定 stderr 并退出非零，就能同时断言原 stderr 保留、hook exit code 为 0。
4. **建议修法**：要求自动化 fixture 测试而不是只留手工步骤，但不改变“不阻断”决策。

### I3. 主工作区与 worktree 同时运行 sync 本身没有同文件竞态

1. **问题描述**：针对用户点名的“主仓与 worktree 同时跑 sync”，未发现主仓侧会写状态或 worktree 文件。
2. **命中条目**：场景 C [55–59 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:55)。
3. **为什么未证伪**：现有脚本在主工作区于 [123–130 行](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:123) 直接退出，因此“主仓 sync + worktree sync”没有两个 writer；真正仍需处理的是“主仓正在重建 graph + worktree 正在 bootstrap”以及“同一 worktree 两个 sync”，已列入 C3/W4。
4. **建议修法**：保留主工作区 no-op，并把并发测试集中在真正的双 writer 场景。

### I4. F215 与总体验证命令未发现直接冲突

1. **问题描述**：未找到本 feature 必然影响 F215 pinned fixture 或使 SC-005 无法执行的证据。
2. **命中条目**：回归护栏第 3 条、[SC-005](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/specs/239-worktree-local-state/spec.md:116)。
3. **为什么未证伪**：现有 bootstrap 只处理 `specs/_meta/graph.json` 和 `.spectra/unified-graph.json`（[sync 脚本:265–267](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/priceless-taussig-d61d73/scripts/sync-worktree-local-state.sh:265)），没有触及 `tests/fixtures/micrograd-baseline-graph`；`vitest/build/repo:check` 作为最终门禁也都是客观命令。
4. **建议修法**：原样保留，但不要把 SC-005 全绿当成上述缺失合同已被覆盖。

## 工具使用反馈

本次采用 `spectra-diff` 的只读人工 fallback：自动 CLI 会写入 `drift-logs`，与零写入要求冲突；当前工具面也未暴露 Spectra MCP，且核心目标为 shell、Markdown、gitignore 配置，人工逐行交叉核对信息已足够。未修改仓库，也未运行会产生仓内产物的命令。

## 总体判断

**修完 CRITICAL 后可以**进入 plan 阶段。

理由：需求方向和三项用户硬决策本身可行，但当前 spec 尚不能唯一指导出安全、同义、可验收的实现；尤其是清单合同、路径逃逸、graph provenance、ignored override 和一分钟验收，任何一项不修都可能出现“所有测试通过，但真实 Codex 行为仍漂移或状态仍误报 ready”的结果。

Codex session ID: 019fc1ff-cf48-78b3-a692-b50efff72b3e
Resume in Codex: codex resume 019fc1ff-cf48-78b3-a692-b50efff72b3e
