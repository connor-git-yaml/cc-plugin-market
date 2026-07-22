# 问题修复报告

**特性**: 225-fix-compound-command-hijack
**模式**: fix（快速问题修复）
**基线**: `7b0d7b3`（origin/master）

## 问题描述

`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 的 `resolveFeatureDirCandidate` 存在**复合命令候选劫持**：

写指示符门禁（`BASH_WRITE_INDICATOR_REGEX`）与候选提名扫描（`scanArtifactPath`）都对**整条 Bash 命令文本**做判定，未按 `&&` / `;` / `||` 分段关联。结果是：命令中只要**任意一段**含写指示符，**另一段**里纯读形态提到的 artifact 路径也会被提名为候选。

危害：可把候选劫持到磁盘上前次会话已合规的历史特性目录，绕过 F208 的 FR-007 判定窗口，与本模块文件头自述的「反伪造硬化」设计目标直接冲突。

### 复现（master 基线 `7b0d7b3`，`node` 直调）

| # | 命令 | 实测候选 | 期望 |
|---|------|---------|------|
| R1 | `sed -i '' 's/x/y/' notes.txt; cat specs/999-fix-decoy/fix-report.md` | — *(需 F224 的 `sed -i` 准入才触发)* | `null` |
| R2 | `echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md` | `specs/999-fix-decoy` ❌ | `null` |
| R3 | `echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md` | `specs/999-fix-decoy` ❌ | `null` |
| R4 | `echo x > /tmp/y \|\| cat specs/999-fix-decoy/fix-report.md` | `specs/999-fix-decoy` ❌ | `null` |
| C1 | `cat specs/999-fix-decoy/fix-report.md`（纯读对照） | `null` ✅ | `null` |
| C2 | `echo body > specs/300-fix-real/fix-report.md`（同段真写对照） | `specs/300-fix-real` ✅ | 提名 |

R2–R4 仅依赖既有 `>` 门禁、不涉及任何 F224 新增准入，**证明该洞在 F224 之前即已存在**；F224 只是让可复合出该形态的命令面略微变宽。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 纯读段落的路径为何会被提名？ | `resolveFeatureDirCandidate` 的 Bash 分支先以整条命令做 `BASH_WRITE_INDICATOR_REGEX.test(input.command)` 布尔前置检查，通过后把**整条命令文本**交给 `scanArtifactPath` 扫描——两个判定的命中位置互不关联 |
| Why 2 | 为何门禁与扫描以整条命令为单位？ | 写指示符被建模成"这条命令是不是在写东西"的**布尔前置条件**，而非"这个 artifact 路径是不是写入目标"的**关联判据**；提名的语义是「路径 × 写动作共现」，实现退化成了「路径存在 ∧ 命令含写符」 |
| Why 3 | 为何会退化成布尔前置？ | C-2 硬化的举证动机是区分 `echo <path>` / `cat <path>` 纯读与 `cat > <path>` 写入，其举证用例**全是单动作命令**，此时"整条命令含写符"与"该路径是写入目标"恰好等价，缺陷不可见 |
| Why 4 | 为何该等价假设不成立？ | Claude Code 的 Bash 工具把整段 shell script 作为**单个** `input.command` 传入，agent 惯常把多个动作用 `&&` / `;` / `||` / 换行串成一条命令以省 tool call——"一条 tool_use = 一个动作"在本 harness 下天然不成立 |
| Why 5 | 为何未被现有机制捕获？ | C-2 的 6 条硬化断言覆盖了「读 vs 写」维度，但**未覆盖「单命令 vs 复合命令」这个正交维度**；写×读共现的组合从未被断言，测试矩阵存在结构性盲区 |

**Root Cause**: 写指示符门禁与 artifact 路径扫描共用「整条命令文本」作为判定单位，二者的命中位置未被要求**共现于同一子命令**，使复合命令中任一段的写指示符可以为另一段的纯读路径"背书"。

**Root Cause Chain**: 复合命令中读形态路径被提名 → 门禁与扫描分别对整条命令判定 → 写指示符被建模为布尔前置而非关联判据 → 举证用例全为单动作命令使二者等价 → Bash 工具单 `command` 承载多动作打破该等价 → 测试矩阵缺「复合命令」正交维度

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L289-292 | 整条命令级门禁 + 整条命令级扫描 | 按子命令切分后要求同段共现 |

全仓 grep `BASH_WRITE_INDICATOR_REGEX` 仅 L53（定义）与 L290（唯一消费点）；「gate-then-scan-on-same-text」模式在 core / execution-record 两模块内**无第二处**（L202/L203 的 `classifyDelegationRole` 为级联分类，不声明共现事实，安全）。

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | L202-203 | `IMPLEMENT_ROLE_REGEX` / `VERIFY_ROLE_REGEX` 级联 test | **安全** — 单文本分类，不声明两个命中的共现关系 |
| `plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs` | L147 | `NOOP_RECON_HEADING_REGEX` 逐行 test | **安全** — 已是逐行（分段）判定 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | L128 | 唯一调用点 | **不改** — 函数签名与返回形状不变 |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | L166 | 文档注释引用 | **不改** — 语义描述仍准确 |

### 同步更新清单

- **调用方**: 无需改动（`fix-compliance-judge.mjs:128` 依赖签名与 `{path}` 返回形状，均不变）
- **测试**: `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 新增复合命令正/负向用例；C-2 现有 6 条硬化断言必须逐字保持绿
- **文档**: `resolveFeatureDirCandidate` 的 JSDoc 需补充「同段共现」判据说明
- **导出面**: `BASH_WRITE_INDICATOR_REGEX` / `ARTIFACT_PATH_REGEX` 保持 export（外部合同），不得改名或收窄

## 修复策略

### 方案 A（推荐）：子命令切分 + 同段共现判据

1. 新增纯函数 `splitBashSubcommands(command)`：按 `&&` / `||` / `;` / 换行把命令切成子命令片段序列（先切 `&&`/`||` 再切 `;`，避免 `||` 被 `|` 误切）
2. 新增谓词 `hasBashWriteIndicator(segment)`：单一收口点，内部使用 `BASH_WRITE_INDICATOR_REGEX`
3. `resolveFeatureDirCandidate` 的 Bash 分支改为：逐段判断，仅当**该段**同时满足「含写指示符」与「命中 `ARTIFACT_PATH_REGEX`」才提名；跨段命中不再互相背书
4. 保持「取最后出现者」语义：按段顺序推进 `candidate`

**优点**：改动收敛在 `resolveFeatureDirCandidate` 一函数 + 两个新私有 helper；判据从"存在性"升级为"关联性"，语义正确；对 F224 的 `INLINE_EDIT_INDICATOR_REGEXES` 只需并入 `hasBashWriteIndicator` 单点，合并面最小。
**风险**：切分未做引号感知——但naive 切分只会让判据**更严**（今天整条命令过门禁，切分后只有子段过），不会新增劫持面，方向单调安全。

### 方案 B（备选）：正则邻接窗口匹配

用一条组合正则要求写指示符与 artifact 路径在 N 字符窗口内邻接。
**否决理由**：窗口大小是魔数、无法表达 `cat > path <<EOF` 与 `cat <<EOF > path` 两种合法语序、且对换行/heredoc 极脆弱；可维护性显著劣于方案 A。

## Spec 影响

- 需要更新的 spec: **无需更新**（`specs/208-fix-mode-process-compliance/` 的 FR-007 语义不变——本修复是让实现回归 FR-007 既有意图，而非改变判据定义）
- 本特性自身产出 `specs/225-fix-compound-command-hijack/{spec,plan,tasks}.md`

## 与 F224 的关系（重要）

`specs/224-fix-compliance-judge-dir-resolution/` 在其 `plan.md` 的「已知限界（本轮不修）」中记录了本缺陷及修法方向，并显式把修复留给后续 Feature——本特性即该后续 Feature。

**交付基线事实**：F224 **尚未合入 master**——其 spec commit 位于并行 worktree 分支 `claude/zen-aryabhata-95e0dc`（`ab2f2ab`），实现与测试仍是该 worktree 的**未提交工作树改动**。因此本特性：

- 基于 `7b0d7b3`（origin/master）实施，复现与验收全部使用 R2–R4 对照组（不依赖 F224 的 `sed -i` / `perl -i` 准入）
- 设计上为 F224 预留**单点合并位**：F224 的 `INLINE_EDIT_INDICATOR_REGEXES` 落地后只需并入 `hasBashWriteIndicator` 一个谓词，即自动获得同段共现语义
- F224 的两条「已知限界」断言在本仓库尚不存在，无法在本轮改写；该改写由**先落 master 者之后 rebase 的一方**执行（详见 `plan.md` §合并预案）
