# 问题修复报告（F227）

## 问题描述

fix 依从性判定器的候选特性目录解析**完全发生在纯 transcript 文本层**，磁盘事实不参与状态转移。会话自身写下的 fixture / repro 文本（形如 `echo body > specs/300-fix-real/fix-report.md`）会被当作合法提名，覆写真实候选；文本里的合成 `mv` 还会把候选带到一个物理上并不存在的目录。

真实案例：会话 `67720241-f20c-44af-856d-d1e976bcf3ef`（交付 F225，已 ship master `c483485`）收口时被 Stop hook 拦下，报「未建立特性目录 / 缺少诊断报告」。该会话实际完全合规——`specs/225-fix-compound-command-hijack/` 下 fix-report.md（含根因章节）、plan.md、tasks.md、verification/verification-report.md 四件齐全并已入 HEAD，implement 委派 2 次、verify 委派 3 次。

### 同一根因的两种表现（必须区分，二者都真实存在）

| 运行的二进制 | 判定时点 | 结果 |
|---|---|---|
| **插件缓存 4.3.0**（hook 实际挂载，无 F224/F225） | 阻断发生时（transcript 前 526 行） | `compliant:false, missing:["feature-dir","fix-report.md"]` → **exit 2 硬阻断**，与用户所见反馈逐字一致 |
| 插件缓存 4.3.0 | 会话结束（完整 transcript） | `compliant:true` — 后续文本恰好把候选带回真实目录，误报自行消失 |
| **worktree 源码**（含 F224/F225，即将发布的版本） | 阻断发生时 / 会话结束 | `transcriptDiagnostics:["feature-dir-unresolvable"]` → **exit 0 静默 fail-open** |

结论：
1. **硬阻断真实发生过**，且已用当时实际运行的二进制 + 截断到阻断时点的 transcript **精确复现**。
2. 在当前 worktree 源码上，同一根因**不再表现为误阻断，而是表现为门禁静默失效**（fail-open）——由 F224 的降级通道接住。这是更隐蔽的失效：合规会话不再被冤枉，但坍塌会话同样不会被拦。
3. 两种表现共用同一根因，修候选解析同时消除两者。

### 复现命令

```bash
TP=~/.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/67720241-f20c-44af-856d-d1e976bcf3ef.jsonl
head -526 "$TP" > /tmp/trunc526.jsonl

# 复现硬阻断（当时实际运行的二进制）
node ~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0/scripts/fix-compliance-judge.mjs \
  --mode report --transcript-path /tmp/trunc526.jsonl --project-root "$PWD"

# 复现 fail-open（当前 worktree 源码）
node plugins/spec-driver/scripts/fix-compliance-judge.mjs \
  --mode report --transcript-path /tmp/trunc526.jsonl --project-root "$PWD"
```

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 合规会话为何被判缺失特性目录与诊断报告？ | 收口时刻胜出的候选是 `specs/300-fix-old`（合成 fixture 路径），该目录在磁盘上不存在 → `checkFeatureDirOnDisk` 返回不存在 → 连带读不到 fix-report.md |
| Why 2 | 合成路径为何能成为胜出候选？ | 提名语义是**「取最后出现者」的单一可变状态**（last-writer-wins）。真实目录在 L363 已被正确提名，随后 L498 / L507 的 fixture 文本连续覆写了它 |
| Why 3 | fixture 文本为何构成合法提名？ | 判据是「同一文本片段内写指示符与 artifact 路径共现」（F225）。repro 脚本里的 `echo body > specs/300-fix-real/fix-report.md` 逐字满足该判据——本次 fix 的主题恰好就是"artifact 路径提名逻辑"本身，此类示例文本大量出现 |
| Why 4 | 为何还会塌进 `ambiguous` 降级分支？ | L507 一段临时验证脚本文本含 `'mv -f specs/300-fix-old specs/301-fix-new');`。按 `;` 切段后残留尾字符，`parseRenameOperands` 把 `specs/301-fix-new')` 当作合法目标操作数返回，改名跟随把候选带到该非规范名 → 不满足 `FIX_DIR_NAME_REGEX` → 置 `ambiguous` |
| Why 5 | 为何没有任何机制拦住这些物理上不可能的候选？ | **判定顺序缺陷**：候选解析是纯文本状态机，磁盘核验被排在其后、且只对**唯一幸存者**执行（judge L131 先由文本裁定 `featureDirUndetermined`，L134 才调 `checkFeatureDirOnDisk`）。而这些合成目录在磁盘上**全部不存在**——最强的客观证伪信号根本没有机会介入 |

**Root Cause**：候选特性目录的解析是纯文本层的单值状态机，磁盘事实不参与**状态转移**，只在末态做一次事后核验。于是任何出现在 transcript 里的合成 artifact 路径与合成 `mv`（包括会话自身的测试 fixture）都能覆写真实候选、或把候选带到一个物理上并不存在的位置。

**Root Cause Chain**：合规会话被拦 → 胜出候选是磁盘上不存在的 `specs/300-fix-old` → 该候选由 fixture 文本经合法判据提名并覆写真实候选 → 覆写之所以成立是因为 last-writer-wins 单值语义 → **磁盘事实不参与状态转移，无从证伪物理上不可能的候选**。

### 实证：候选提名序列（instrumented replay，与生产逻辑逐字一致）

- anchor：`lineIndex=69`，`mode=fix`
- 锚点后 artifact 路径提及总数 81 次（未过写指示符门禁的原始提及，去重 16 个目录）
- **经既有判据合法提名**的候选：**14 个**（去重、保序，与用户初始报告一致）——`225-fix-compound-command-hijack`、`999-fix-decoy`、`300-fix-real`、`302-fix-real`、`300-fix-a`、`301-fix-b`、`305-fix-pipe`、`300-fix-x`、`300-fix-line`、`332-fix-line`、`321-fix-first`、`998-fix-m`、`301-fix-c`、`300-fix-old`
- 其中磁盘上真实存在的**恰好 1 个**：`specs/225-fix-compound-command-hijack`（L363 提名）；其余 13 个全部为会话自身 fixture / repro 文本，磁盘上均不存在
- 提名来源实测：**14 个候选全部来自 Bash 命令文本**（含真实目录 225），无一来自 Write / Edit 工具调用的 `file_path`。故「按提名来源（结构化工具输入 vs 命令文本）收窄」这一方向**已被实证否决**——它救不了真实案例

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L425-492 `resolveFeatureDirCandidate` | 提名与改名的状态转移不校验目标是否真实存在 | 注入目录存在性探针，物理上不可达的转移整条忽略 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | L127-134 | 唯一生产消费方 | 传入 io 层探针；其余判定链路逐字不变 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-core.mjs` `extractDelegationsAfter` | 委派抽取 | 纯文本判据 | **安全**——委派证据没有磁盘对应物，不存在可用于证伪的客观事实 |
| `fix-compliance-execution-record.mjs` L253 `ambiguous` | 执行证据配对 | 同名不同物的另一套 ambiguous | **安全**——语义为"同 ID 重复 use / 窗口内多 result"，与目录解析无关 |
| `fix-compliance-core.mjs` `classifyClosureForm` | 收口形态分类 | 已基于磁盘读到的内容 | **安全**——本就在磁盘之后 |
| `fix-compliance-core.mjs` `checkArtifactSection` L569-583 | 占位符残留检测 | 纯文本启发式，不排除代码区 | **[同族但独立缺陷，不在本次范围]** 详见下节 |
| `parseRenameOperands` L95-121 吞尾字符 `')` | 操作数解析宽松 | 词法层不感知 shell 上下文 | **本次不修**：收紧字符集会动到 F224 已冻结的改名跟随语义与其单测，属独立取舍；本次以「目标目录须真实存在」在下游兜住 |

### 本次流程中额外发现的同族缺陷（已另开跟进项，不在本次范围）

`checkArtifactSection`（`fix-compliance-core.mjs` L569-583）的占位符残留检测有两个缺陷叠加，会把完全合规的制品误判为"占位空壳"：

1. `ROOT_CAUSE_HEADING_REGEX = /Root Cause/i`（L135）不是标题正则而是**任意位置子串匹配**，报告开头一句顺带提及即被当作章节起点，章节体一路延伸到下一个 H2
2. `PLACEHOLDER_BRACE_REGEX`（L138）扫描的 `proseBody` 只经 `stripReconSubblock` 定向剔除「### 复现对账」子块，**既不剥 fenced code 块、也不剥行内 code span**

本报告编写过程中被该缺陷连续误拦 2 次（散文里用行内代码写函数返回值形状、以及复现证据的 ```json 块）。已通过改写措辞绕开，缺陷本身留给独立 Feature。

### 同步更新清单

- 调用方：`fix-compliance-judge.mjs`（唯一生产消费方）
- 测试：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（既有断言零改动，新增探针相关用例）、`fix-compliance-judge-cli.test.mjs`（新增端到端回归）
- 文档：`resolveFeatureDirCandidate` 与 `evaluate` 的 JSDoc 契约说明，含下方「已知限界」
- 类型定义：无（.mjs + JSDoc）

## Codex 对抗审查处置

审查结论建议 GATE_DESIGN 不通过、方案 A 不实现。逐条核实与处置：

| 编号 | 结论 | 核实 | 处置 |
|---|---|---|---|
| C1 | "报告复现的是 fail-open，不是硬阻断；硬阻断未被证明" | **部分成立**。原报告的复现命令（worktree 源码 + 完整 transcript）确实只得到 fail-open，不等于用户所见的阻断——这是原报告的真实缺陷。但"硬阻断未被证明"是过度推断：换用当时实际运行的缓存二进制 + 截断到阻断时点，`missing:["feature-dir","fix-report.md"]` 与用户所见反馈逐字吻合 | **采纳并已修正**：问题描述改为区分两种表现，复现命令补齐两个二进制两个时点。同时确认了 C1 顺带指出的插件分发漂移属实（缓存 4.3.0 与 worktree 源码 hash 不同，缓存版不含 F224/F225） |
| C2 | "方案 A 是放宽通道：先提名真实历史目录、后提名不存在的合成目录，过滤后会选中历史目录判合规" | **成立**。且交运算论证确实无效——基线不是"全部候选都不合格才拒绝"，而是有顺序的 last-writer-wins | **已升级处理**：放弃方案 A 的"候选集合 + 取最后存活者"。但须记录一个 C2 未指出的事实——真实案例与该攻击构造在 transcript 文本上**完全同构**（都是"一条形似写入、指向已存在合规目录的 Bash 命令"），任何能救真实案例的候选选择规则都同样允许该攻击。故 C2 无法由候选选择规则关闭，见下方「已知限界」 |
| C3 | "过滤后 0 回落只在没有其他存活候选时才等价，F224 语义未保住" | **成立** | **已由新方案关闭**：真实改名会在磁盘上产生真实目录，fixture 文本的假改名不会。以"改名目标须真实存在"为判据，真实改名照常跟随并照常触发 F224 降级，假改名不生效 |
| W1 | "更本质根因是词法层不感知 shell 上下文（heredoc / 引号 / `$()`）" | 成立 | 记录为已知病根；本次不收紧词法层（会动 F224/F225 冻结语义），改由"物理可达性"在状态转移层证伪。列为 follow-up 候选 |
| W2 | "≥2 存活即真歧义会引入新误阻断，与既有取最后者断言冲突" | 成立 | 与编排器独立得出的结论一致（仓库内 48 个历史 `NNN-fix-*` 目录含真实 fix-report.md）。新方案不引入任何新的歧义判定分支 |
| I1 | core 层纯函数约束真实存在，但漏了更强否决理由 | 成立 | 新方案以**依赖注入**保持 core 可测纯度：探针由 judge 传入，不在 core 内 import fs；探针缺省时行为与改动前逐字一致 |

## 修复策略

> **方案演进说明**：本节记录完整的方案演进链。方案 A → C → B′ 依次被对抗审查用**具体反例**推翻，最终落地的是**方案 D + 单调性收窄**。阅读实现请以本节的方案 D 与 `plan.md`（第四版）为准，下方 A / C / B′ 三节保留为决策依据与反面教训，**不代表实现**。

### 方案 D（最终采纳）：状态机逐字不动，磁盘只在消费端兜底

前三版的共同错误是把**终态磁盘快照**注入**状态机内部**——而 transcript 文本描述的是**历史事件序列**，磁盘给的是**终态快照**，二者混入同一状态机必然自相矛盾（改名跟随的前提恰恰是"被提名的目录在终态已不存在"）。方案 D 承认这一点：

1. **core `resolveFeatureDirCandidate`**：签名不变、不接受任何探针、不 `import fs`；`scanArtifactPath` / `applyRename` / 分段循环**逐字不动**。唯一新增是只读的 `candidates` 历史（move-to-end 去重），插入点在 `syncCandidateFromTrackedDir` 的 `FIX_DIR_NAME_REGEX` 命中分支（`scanArtifactPath` 与 `applyRename` 的共用汇合点，只改一处）。`path` / `ambiguous` 对任意输入与改动前逐字相同
2. **judge `evaluate()`**：`usable(dir) = readArtifactFile(projectRoot, dir + '/fix-report.md').exists`；兜底条件为 **`candidate.ambiguous === false && !usable(resolvedPath)`**，命中时从 `candidates` 由后向前取第一个 `usable` 者；否则完全回落 `candidate.path`

**单调性不变量（本方案的核心安全性质）**：兜底只可能把改动前的**阻断转为放行**，绝不可能把**放行转为阻断**。三分支论证：

- `ambiguous === true` → 兜底完全不介入（短路求值使 `usable()` 一次都不被调用，可由探针计数机械观测），F224 fail-open（exit 0）逐字保持
- `ambiguous === false` 且主候选可用 → 兜底不触发，与改动前逐字一致
- `ambiguous === false` 且主候选不可用 → 改动前必然是「特性目录/诊断报告缺失」类 exit 2 阻断；兜底后要么仍阻断（原因可能不同，仍是 exit 2），要么转为放行

**为何必须保留 `ambiguous === false` 守卫**：没有它，F224 合法降级（今天 exit 0）会被兜底反转成 exit 2 阻断，即新增误阻断。风险面已实测量化——本仓库 48 个含 fix-report.md 的历史 `NNN-fix-*` 目录中 **21 个缺 verification-report.md**，任一被兜底选中即触发。消融实验（只删该条件跑 10 场景差分矩阵）精确复现 1 例 0→2 反转，证明该守卫既必要又充分。

**不放宽性**：兜底只在候选历史内选择，不新增任何候选来源；`judgeCompliance` 的全部下游判据（章节校验、verification-report 存在性、委派计数、no-op 执行证据）逐字不变地作用在选中目录上。探针只作用于经 `FIX_DIR_NAME_REGEX`（全锚定 `^specs/\d+-fix-[a-z0-9-]+/?$`）验证的路径，实测拒绝 `..` / 绝对路径 / `//` / 换行注入 / 大写 / 同形字，命中值经 `path.join` 后均在项目根内。

### 已知限界（三条，均如实记录，不得表述为已解决）

**限界一 —— 冒用已存在且制品齐全的历史特性目录**（用户已知情并明确接受）：坍塌会话若在 transcript 中写出一条形似写入、指向某个已存在且制品齐全的历史特性目录的 Bash 命令，该目录会被合法提名并可能被兜底选中。

- 改动前已存在（只需把该提名放在最后一条），本次不创造它；本次使其在"主候选不可用"时对位置不再敏感，便利性有边际上升
- 无法关闭的原因：真实案例（会话写自己的目录）与该攻击（会话写他人的目录）在 transcript 文本上**完全同构**，判定器无法区分意图
- 彻底关闭需"制品确由本次会话创建"的带外证据（mtime / git 状态），而会话中途 commit、rebase、worktree 重新检出都会让该证据失准
- 委派计数判据（implement > 0 且 verify > 0）与本限界正交，不受影响

**限界二 —— F224 fail-open 降级通道可被伪造 `mv` 触发**：改动前**既有缺陷**，本次**不引入、不修复、也不使其更易触发**（状态机零改动 ⇒ 可触发该通道的 transcript 集合与改动前逐字相同）。已另开独立跟进项。

**限界三 —— 本次修复的范围**：只覆盖「主候选被幽灵路径覆写、指向磁盘上不存在的目录」这一支（`ambiguous === false`）。由 transcript 中伪造的 `mv` 文本导致 `ambiguous === true` 从而落入 F224 fail-open 的另一支**不在本次范围**——介入它必然引入新的误阻断（见上方守卫论证），属独立取舍。

### 方案 A（已否决）：resolver 吐候选集合 + judge 侧无条件取最后存活者

被证伪：留下 F224 降级被绕过的缺口，且"集合求交"的不放宽性论证在 last-writer-wins 基线下不成立（基线不是"全部候选不合格才拒绝"，而是有顺序的最后写入者胜出）。方案 D 保留了 `candidates` 机制，但**只在主候选不可用时才介入**，这是与方案 A 的本质区别。

### 方案 C（已否决）：提名门禁 + 改名门禁，判据为"目录存在"

被证伪：把**终态存在性**误当成**历史事件是否发生**的谓词。F224 改名跟随的前提就是"目录被提名后又被搬走"，判定时点旧目录必然已不存在；三跳链的中间态按定义在终态也都不存在。该门禁会打掉 F224 整个特性，且因既有测试的探针默认恒真而**全绿不报**——纯生产态静默回归。

### 方案 B′（已否决）：仅提名门禁，判据为"制品存在"，改名不设门禁

被证伪于三条反例：(1) 仍与改名链耦合——"已有真实候选在位 + 后一候选已被搬走"会打断三跳链；(2) 保住 real 候选反而让原本打不中的伪造 `mv` 命中 `trackedDir`，新增"改动前阻断、改后 fail-open"的输入；(3) `applyRename` 把任意 dst 写进 `trackedDir`，下一次提名对它调探针造成 `..` 越界读。

### 方案 B（已否决）：resolver 内部直接 `import fs`

破坏 core 层纯函数分层契约，且迫使大量既有纯文本单测注入 stub。

## Spec 影响

- 需要更新的 spec：**无需更新**。本次是既有 FR（F208 FR-004/FR-005、F224、F225）实现层判定顺序缺陷的修复，不新增/变更对外行为契约；`resolveFeatureDirCandidate` 的 `path` / `ambiguous` 语义逐字不变，新增 `candidates` 为向后兼容的增字段。
