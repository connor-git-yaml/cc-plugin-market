# D-8 · 推断前提运行时实证（T120 · Phase E 回跑）

> 执行时点：2026-09-07；执行者：Phase E 验证子代理（非编排器）；被检对象：`spec.md` §推断前提登记（三类共 10 条：`[推断]` A-1 ~ A-5 5 条 + 能力边界声明 B-1 / B-2 2 条 + 已核实 V-1 ~ V-3 3 条；换算式 5 + 2 + 3 = 10，单位：前提条）。
> 本文件只新增、不改写 `spec.md` / `plan.md` / `tasks.md` 冻结正文（T121 追加口径）。每条结论同处附命令原文与原始输出片段（FR-062）；只能得到「无法判定」的条目如实写「无法判定」并说明原因，不得用相邻但不同命题的实跑结果背书（FR-066）。

## 输入与命令清单

| # | 输入 / 命令原文 | 用途 |
|---|---|---|
| I-1 | `sed -n '329p' specs/277-spec-driver-engine-hardening/tasks.md` | T120 任务原文（执行步骤 / 期望输出 / 通过条件逐字） |
| I-2 | `sed -n '586,660p' specs/277-spec-driver-engine-hardening/spec.md` | §推断前提登记全文（A-1 ~ A-5 / B-1 ~ B-2 / V-1 ~ V-3 / L-1 ~ L-2） |
| I-3 | `sed -n '551p' specs/277-spec-driver-engine-hardening/spec.md` | SC-009 换算式原文与两处排除口径 |
| I-4 | `sed -n '1040,1100p' specs/277-spec-driver-engine-hardening/plan.md`（V-P1 `:1046-1055` / spec V-2 `:1079` / spec V-3 `:1080` / 结论 `:1082`；行号为本会话读取时值，`plan.md` 正被编排器并行追加） | plan 阶段对 V-1 ~ V-3 的补齐记录 |
| I-5 | `cat specs/277-spec-driver-engine-hardening/verification/d5-observations.md` | A-2 的观察语料（D-5 窗口） |
| I-6 | `git rev-parse HEAD` → `d86fa332`；开工时 `git status --short \| wc -l` → `0` | 被检对象版本锚 |
| C-1 | A-1：`git for-each-ref` / `git rev-list --count` / `git diff --name-only` / 临时 clone 内 `npm run repo:sync && git status --porcelain` / `comm -12` | §A-1 |
| C-2 | A-2：`cat d5-observations.md`、`command grep -rn "观察序号\|首次落盘形态" verification/*.md`、`command grep -n "骨架\|逐节\|先落盘" verification/phaseD-brief.md` | §A-2 |
| C-3 | A-3：spec 原文的 `git diff --name-only` + `grep -nE` 粗提 + `comm -23`；补充的标识符级核对 | §A-3 |
| C-4 | A-4：`wc -c AGENTS.md`、`git show <sha>:AGENTS.md \| wc -c` ×3、`git diff 26a3b15f..HEAD -- AGENTS.md`、`ls AGENTS.override.md`、`sed -n '17p' scripts/lib/worktree-local-state-core.mjs` | §A-4 |
| C-5 | A-5：spec 原文 `grep -nE 'frontmatter\|tools\|parseFrontmatterTools\|toolKey' <两脚本>` + 源码读取 | §A-5 |
| C-6 | V-1 `npm run repo:check`（工作树内，只读校验，exit 0）；V-2 `wc -l …SKILL.md`；V-3 `sed -n '39,55p' plugins/spec-driver/config/orchestration.yaml` | §(ii) |

**机械执行数登记**（T121 口径）：本文件内凡标「实测」的数字均由同处命令在本会话产出。`npm run repo:sync` **只在 scratchpad 内的 `git clone` 副本中跑过一次**（A-1 字面命令），从未在工作树内跑；工作树在本演示前后未被本演示改动。

## 执行环境声明

```
$ type grep | head -2
grep is a shell function from /Users/connorlu/.claude/shell-snapshots/snapshot-zsh-1788702108542-7qmme0.sh
$ command -v grep; command grep --version 2>&1 | head -1
grep
grep (BSD grep, GNU compatible) 2.6.0-FreeBSD
```

本文件所有检索命令写 `command grep …`（BSD grep：不遵守 `.gitignore`、搜索根为 `.` 时输出带 `./` 前缀）。spec 原文中的 `grep` 在复跑时逐字替换为 `command grep`，其余参数不动；BSD `grep -E` 不识别 `\s`，A-3 命令中的 `^\s*` 等价改写为 `^[[:space:]]*`（改写已在 §A-3 同处声明）。跨环境复跑出现计数差异时先核对 grep 实现，再判漂移。

## A-1 · 新增共享内容走 `templates/` + sync 注入后，`.codex/skills/**` wrapper 的再生产物不会与并行 F276 的改动冲突

**同一命题核对（FR-066）**：陈述 = 「本卡的再生产物不会与 F276 的改动冲突」；命令 = 清单 A（`npm run repo:sync && git status --porcelain` 的再生产物）∩ 清单 B（F276 改动文件集）为空即 PASS。**同一命题 ✅**。spec 自带判定前置：B 取不到、或 B 为空且来自「F276 尚无 commit」时判「未执行（缺席）」，产物须记 B 的取得是否成功、B 的元素数、F276 的 commit 数。

**B 的取得（含分支 ref 的实况）**：

```bash
git for-each-ref --format='%(refname)' | command grep -i 276
git branch -a --list '*276*'
```
原始输出：（两条均空）→ spec 记录的分支 `claude/f276-compliance-handoff-fixes-9a9fe1` **已不存在**（F276 已交付 master 并按分支策略删除）。按字面「分支 ref 不可解析 ⇒ 缺席」的读法见文末。

同一操作数「F276 的改动文件集」改由 master 历史取得：

```bash
git merge-base master HEAD; git rev-parse master
git log --oneline 26a3b15f -30 | command grep -i "f276"
git rev-list --count 7acf8ae8..26a3b15f; git log --oneline 7acf8ae8..26a3b15f
git diff --name-only 7acf8ae8..26a3b15f | sort > <scratch>/B_f276.txt; wc -l < <scratch>/B_f276.txt
```
原始输出：
```
26a3b15feee2302f119c86acb09fbeee29725847
26a3b15feee2302f119c86acb09fbeee29725847
26a3b15f docs+test(F276-C): Phase 4 审查修补 + 制品入库 — 8 轮对抗记录 / 移交包 / 验证报告 / dogfooding 账本
5f1f1192 refactor(F276-C3): 删除 fix-compliance 判定器零接线死代码 routeNonBlock + NON_BLOCK_LIMIT / NON_BLOCK_ENTRY_LIMIT
ffb90609 fix(F276-C): fix-compliance 判定器 !saved.ok 由「等同已达上限放行」反转为 fail-closed + 反馈计数上界（既有 0 成本绕过收口）
3
（同上三行）
31
```
（`7acf8ae8` 是 `ffb90609` 的父 commit，即 F279；`e01611b2..26a3b15f` 共 6 commit，其中 F278 / F279 / T063 三个非 F276 commit 已排除，B 只取 F276 的 3 个。）**B 取得成功；|B| = 31（单位：文件）；F276 commit 数 = 3 > 0** → 判定前置满足，不是「空 B 的无条件 PASS」。B 全量：`docs/design/dogfooding-feedback-ledger.md`、`plugins/spec-driver/scripts/fix-compliance-judge.mjs`、`plugins/spec-driver/scripts/lib/fix-compliance-{core,io}.mjs`、`plugins/spec-driver/tests/{f270-real-corpus,fix-compliance-core,fix-compliance-io,fix-compliance-judge-cli}.test.mjs`、`plugins/spec-driver/tests/fixtures/fix-compliance/{README.md,real-stop-hook-feedback-entries.jsonl}`、`specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json`、`specs/276-fix-compliance-p0a-residue/**`（19 份）。

**A 的取得（字面命令，在 scratchpad 内的 `git clone` 副本中跑，工作树未动）**：

```bash
git clone -q "$PWD" <scratch>/a1-clone && cd <scratch>/a1-clone && git log --oneline -1 && git status --porcelain | wc -l
ln -s <主仓>/node_modules node_modules
npm run repo:sync; echo "exit=$?"
git status --porcelain | tee <scratch>/A_literal.txt; wc -l < <scratch>/A_literal.txt
```
原始输出（摘）：
```
d86fa332 feat(F277-P2): Phase B + D 落地 — …
0
[repo-sync] completed
- agent-docs: 同步 AGENTS/CLAUDE 共享区块
- preference-rules: 同步 5 agent 工具优先使用规则块
- delegation-contract: 注入 5 SKILL 委派硬约束块
- release-contract: 同步版本与发布合同
- spectra-skills: 同步 spectra compatibility mirrors
- spec-driver-codex-wrappers: 再生成 spec-driver Codex wrappers
- workflow-registry: 生成 workflow registry
- product-entity-catalog: 生成产品 entity catalog
- product-quality-reports-pass1 / product-scorecards-pass1 / adoption-insights / product-quality-reports-pass2 / product-scorecards-pass2 / project-context-suggestions
exit=0
 M .specify/project-context.suggestions.md
 M .specify/project-context.suggestions.yaml
 M specs/products/_generated/{catalog-index,quality-report-index,scorecard-index}.yaml
 M specs/products/spec-driver/_generated/{adoption-report.json,adoption-report.md,entity.yaml,quality-report.json,quality-report.md,scorecard-report.json,scorecard-report.md,workflow-index.json,workflow-index.md}
 M specs/products/spectra/_generated/{entity.yaml,quality-report.json,quality-report.md,scorecard-report.json,scorecard-report.md}
19
```
（花括号为折叠写法，原始输出逐文件一行。）|A| = 19（单位：文件），全部是带时间戳 / 统计的生成报告；**`.codex/skills/**` 与 `skills-codex/**` wrapper 在 A 中为 0**——说明 HEAD 已含本卡 wrapper 再生产物且与源一致（`repo:check` 的 `delegation-contract:codex-wrapper-block-sync` pass 同证）。为避免「A 恰好为空 / 恰好不含 wrapper ⇒ 交集无条件为空」的同型陷阱，另取本卡**全部**改动集作严格上界：`git diff --name-only 26a3b15f..HEAD | sort > A_card.txt` → 119 文件，其中 `.codex/skills/` 8 份 + `plugins/spec-driver/skills-codex/` 8 份 wrapper 再生产物（`command grep -c "^\.codex/skills/" A_card.txt` → `8`；`… "^plugins/spec-driver/skills-codex/"` → `8`）。

**交集**：

```bash
comm -12 <scratch>/A_literal.paths <scratch>/B_f276.txt | wc -l      # A_literal.paths = A 的路径列
comm -12 <scratch>/A_card.txt <scratch>/B_f276.txt | wc -l
```
原始输出：`0` / `0`。换算式：|A_literal ∩ B| = 0，|A_card ∩ B| = 0（单位：文件）；A_card ⊇ 全部再生产物（wrapper 16 份在内），上界交集为空 ⇒ 任何再生子集与 B 的交集为空。

**结论：PASS**（陈述为真：再生产物与 F276 改动无一文件重合）。**留痕两点**：(1) 命令形态替代——spec 的 `git diff --name-only $(git merge-base master <F276-branch>)..<F276-branch>` 因分支已删无法逐字执行，B 改自 master 历史的 F276 三 commit 区间，取的是同一操作数（F276 改动文件集）、命题不变；若编排器按字面判「ref 不可解析 ⇒ 未执行（缺席）」，本条改计缺席、SC-009 由 4 ÷ 5 降为 3 ÷ 5 = 60%，两种口径本文件都已给出，判定权归编排器。(2) 情境变化——F276 已交付且本分支已 rebase 到其上，「并行」情境已不存在；本轮 |A_card ∩ B| = 0 说明两卡从未共同触碰同一文件，故交集为空不是 rebase 消解的结果。

## A-2 · 把「先落盘骨架，再逐节 Edit」写进 `agents/*.md` 正文后，子代理实际会遵守该协议

**同一命题核对（FR-066）**：陈述 = 「写进 agent 正文后子代理**自发**遵守分节协议」；命令 = 对一次**未提示协议**的真实长文档委派，在第二节完成后终止，`wc -c <target>` + `grep -c '^占位：' <target>` 看骨架与占位是否在盘，续写后比对已完成节字节。命令测的正是「自发落盘的形态」→ **同一命题 ✅**；spec 自带两项执行条件（(i) 委派 prompt 不得提及协议；(ii) 观察 ≥ 3 次，全部自发方 PASS）。

**输入前置（观察语料）**：

```bash
cat specs/277-spec-driver-engine-hardening/verification/d5-observations.md
```
原始输出（摘）：
```
> 截至本文件创建时点，**观察次数 = 0**，**不得**被读作「已达成」或「已开始观察」。
…
## 观察记录

**（待编排器填写；当前 0 条。）**
```

```bash
command grep -rn "观察序号\|首次落盘形态" specs/277-spec-driver-engine-hardening/verification/*.md | command grep -v "d5-observations.md\|e-d8-inferred"
```
原始输出：（空，退出码 0 来自尾部 `grep -v`）→ 除窗口文件自身的表头外，`verification/` 内无任何观察记录。

**本卡内已有的「骨架先行」实例为何不能计入**：

```bash
command grep -n "骨架\|逐节\|先落盘" specs/277-spec-driver-engine-hardening/verification/phaseD-brief.md
```
原始输出（摘）：`:6 > **返回通道可能丢失**：…**首个动作必须是一次落盘**（哪怕只是先建 summary 骨架）…`、`:27 - T098 D-3：…（**先 Write 骨架**）…`、`:28 - T099 D-2 …（先 Write 骨架）…`；另 `verification/fix-phaseBD-brief.md:4 > **首个动作**：Write \`verification/fix-phaseBD-summary.md\` 骨架`。这些委派 prompt 都**明示**了骨架 / 分节要求，违反执行条件 (i)（同 d5-observations 观察纪律 1），测到的只是「被要求时能做到」。**本文件自身也是在被明示「先落盘骨架再逐节填」后写成的，同样不构成观察。**

**命令实跑**：无合法 target 可跑 `wc -c` / `grep -c '^占位：'`——不是命令口径问题，是输入缺席。

**结论：未执行（缺席）**（合规观察 0 ÷ 下界 3，单位：观察次）。按 FR-063 输入前置取不到 ⇒ 「未执行（缺席）」；按 T120「若某条只能得到「无法判定」…该条判不通过」⇒ 本条**不通过、不计入 SC-009 分子**。**可闭合条件**：D-5 观察窗口积累 ≥ 3 次合规观察后由编排器回填并重判，届时本条可得 PASS / FAIL。本文件不替编排器造观察（d5-observations「不得为凑数在 Phase E 集中造 3 次」）。

## A-3 · 纯词法粗提命令能从已交付 plan 的改动文件中提出至少一个未被 reverse-census 申报的候选关键量

**同一命题核对（FR-066）**：陈述 = 「粗提命令能从已交付 plan 的改动文件中提出 ≥ 1 个未被 reverse-census 申报的候选关键量」；命令 = P（粗提候选）\ D（申报集合）非空即 PASS。**同一命题 ✅**（原 A-3 按 FR-066 拆分后的可测半；恒真半在 B-1）。**判别力须同处登记**：命令把 grep 原始行（`file:line:content`）与 D 的关键量**名称**做 `comm`，两者不在同一字面空间，P 中任何一行都不可能与 D 的某项字面相等——差集非空是**构造性**的，PASS 的证据强度极弱（spec 自述「粗提法噪声率未测，不足以升为门禁判据」）。

**输入**：「一份已交付的 plan」= 本卡 plan（全仓首份含 reverse-census 章节的 plan，历史 plan 无该章节、D 无从取）。branch = 当前分支；`git merge-base master HEAD` → `26a3b15feee2302f119c86acb09fbeee29725847`（= `git rev-parse master`）。

**命令原文与输出**（spec 原文，`grep` → `command grep`，`^\s*` → `^[[:space:]]*`）：

```bash
git diff --name-only $(git merge-base master HEAD)..HEAD | sort > <scratch>/A_card.txt     # 119 文件；磁盘缺失 0
while IFS= read -r f; do [ -f "$f" ] && command grep -nE "^[[:space:]]*(const|export const|[A-Za-z_]+:)" "$f" 2>/dev/null | sed "s|^|$f:|"; done < <scratch>/A_card.txt | sort -u > P.sorted
command grep -E '^\| K[0-9]+ \|' specs/277-spec-driver-engine-hardening/plan.md | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}' | sort -u > D.sorted
comm -23 P.sorted D.sorted | wc -l
```
（`grep -nE` 输出前缀加文件名以便跨文件去重，不改变行数。）原始输出：
```
files in A_card=     119 missing_on_disk=0
|P| (uniq) =     3524; |D| =       16; |P\D| =     3524
```
P \ D 样例（`.mjs` 行 3 条）：
```
scripts/lib/agent-tools-core.mjs:108:  const snapshot = [...VERIFY_TOOLS_FROZEN_SNAPSHOT];
scripts/lib/agent-tools-core.mjs:109:  const equal = tools.length === snapshot.length && tools.every((t, i) => t === snapshot[i]);
scripts/lib/agent-tools-core.mjs:110:  const added = tools.filter((t) => !snapshot.includes(t));
```
换算式：未申报候选数 |P \ D| = 3524 ≥ 1（单位：候选关键量个，此处「个」= 粗提命中行）→ **PASS（陈述为真）**。

**补充核对（非 spec 命令，只为标定 PASS 的实质强度，不改判定）**：把 P 收窄为 18 份改动代码文件（`.mjs` / `.ts`）中 `const` / `export const` 声明的标识符，再核每个标识符是否在 plan §reverse-census 章节正文（`sed -n '443,998p'`）中出现：
```
const identifiers (uniq) in 18 changed code files = 423; not mentioned in plan §reverse-census = 353
```
未提及样例：`AGENTS_DIR ATTACK_FIXTURES BASELINE_PATH BASE_RESERVED_MODE_NAMES BLOCK_ITEM_RE CLI CLI_PATH CODE FACT_EFFECTIVE_CONFIG FACT_HARD_GATE FIXTURES FIXTURES_DIR FORBIDDEN_GATE_OVERRIDES FRESHNESS_ID GATE_DESIGN_FORBIDDEN_BEHAVIORS`；被提及的 70 个多为通用词（`a b base check config …`，字面巧合命中）。353 ÷ 423 = 83.5%（单位：标识符）未在章节出现——其中确有关键量候选（`FORBIDDEN_GATE_OVERRIDES` / `GATE_DESIGN_FORBIDDEN_BEHAVIORS` 与 K3「gate 字段禁改集」直接相关），也有大量局部变量噪声；噪声率未测，与 spec 自述一致。

**结论：PASS**（字面命令）。实质：粗提法有产出、无判别力；B-1 维持原状（spec 已明写「两种结果都不改变 B-1」）。

## A-4 · 8452 bytes 的仓根字节余量足以容纳本次新约定需要注入 `AGENTS.md` 的文本量

**同一命题核对（FR-066）**：陈述 = 「8452 bytes 余量足以容纳本次注入 `AGENTS.md` 的文本量」；命令 = 注入后 `wc -c AGENTS.md`，净增量 = 新字节 − 24316 ≤ 8452 即 PASS，禁用 `CLAUDE.md` 参与 max。**同一命题 ✅**。

**命令原文与输出**：

```bash
wc -c AGENTS.md
```
→ `   25020 AGENTS.md`

```bash
for s in e01611b2 26a3b15f HEAD; do printf "%s: " "$s"; git show "${s}:AGENTS.md" | wc -c; done
```
→ `e01611b2:    24316` / `26a3b15f:    24316` / `HEAD:    25020`

```bash
git diff --stat 26a3b15f..HEAD -- AGENTS.md
git diff 26a3b15f..HEAD -- AGENTS.md | command grep '^[+-]' | command grep -v '^+++\|^---' | cut -c1-200
```
→ `AGENTS.md | 2 ++` / `1 file changed, 2 insertions(+)`；两行为：
```
+| `orchestration-overrides.gate-mounting-lost` | 项目级 overrides 使强制 mode（feature/story/implement）的 `GATE_DESIGN`/`GATE_TASKS` 失去 base 锚定的可达挂载（锚点缺失 / 抑…
+| `orchestration.mandatory-mode-missing` | base orchestration.yaml 缺少强制 mode 段（feature/story/implement 之一） | 联系 plugin 维护者；该 mode 的 `gate-mounting` 守护断言判 f…
```
（`docs/shared/agent-orchestration-overrides.md` 新增的两条 diagnostic 行，经 `sync-agent-docs` 既有 entry `orchestration-overrides` 注入。）

```bash
ls -la AGENTS.override.md; sed -n '17p' scripts/lib/worktree-local-state-core.mjs
```
→ `ls: AGENTS.override.md: No such file or directory`；`const AGENTS_CANDIDATES = ['AGENTS.md', 'AGENTS.override.md'];`

`npm run repo:check` 摘：`- worktree-local-state:agents-byte-budget: pass`。

**换算式**：净增量 = 25020 − 24316 = **704 bytes**（单位：bytes；基线 24316 在 `e01611b2` 与 `26a3b15f` 两点实测相同，故 704 全归本卡）；704 ≤ 8452 ✅；现余量 = 32768 − 25020 = 7748 bytes。计数集合 = `['AGENTS.md', 'AGENTS.override.md']`（源码 `:17`），`AGENTS.override.md` 不存在 ⇒ 单元素 max；未用 `CLAUDE.md`。

**结论：PASS**。**但 spec 内嵌的子陈述被证伪**：A-4 写「按当前落点方案，本卡对该预算的注入量为 0 … 本条在本卡上是**空载 PASS**」——实测注入量 704 bytes ≠ 0，本条**不是空载**。注入并非经 FR-036 的新 entry（其 `targets` 确为 `agents/*.md` / SKILL，不指向 `AGENTS.md`，该半句仍真），而是经既有 entry 的事实源 `docs/shared/agent-orchestration-overrides.md`（本卡为 F277 的两个新 diagnostic code 加了 2 行）。这是「预算机制在本卡上真的受过一次检验」的实证，也是 spec 一处应按 T121 追加修订的 over-claim（方向是「说没注入、其实注入了」；主陈述仍 PASS，不改判定）。

## A-5 · `preference-rules.md` 自述的两个 `tools` 键消费方的实际实现确实按目标 agent 的 frontmatter `tools` 过滤

**同一命题核对（FR-066）**：陈述 = 「两个自述消费方的实际实现按目标 agent 的 frontmatter `tools` 过滤」；命令 = 在两脚本定位 `tools` 读取与过滤代码并读其分支，两脚本都命中且过滤键正确即 PASS。**同一命题 ✅**（V-1 测的是「增列 `Edit` / `Bash` 是否改渲染输出」，不同命题，二者不互相背书）。

**命令原文与输出**（spec 原文，`grep` → `command grep`）：

```bash
command grep -nE 'frontmatter|tools|parseFrontmatterTools|toolKey' plugins/spec-driver/scripts/sync-preference-rules.mjs scripts/feature-170d-driver-preference.mjs
```
原始输出（9 行，全量；退出码 0，两脚本路径均存在）：
```
plugins/spec-driver/scripts/sync-preference-rules.mjs:3: * sync-preference-rules — 从 templates/preference-rules.md 单一事实源，按各 agent frontmatter
plugins/spec-driver/scripts/sync-preference-rules.mjs:4: * tools 过滤渲染「工具优先使用规则」块，写入 5 个 agent 文件的 BEGIN/END marker 之间。
plugins/spec-driver/scripts/sync-preference-rules.mjs:20:  parseFrontmatterTools,
plugins/spec-driver/scripts/sync-preference-rules.mjs:33:  const tools = parseFrontmatterTools(agentText);
plugins/spec-driver/scripts/sync-preference-rules.mjs:34:  const rendered = renderInjectionBlock(templateText, tools);
scripts/feature-170d-driver-preference.mjs:34:  parseFrontmatterTools,
scripts/feature-170d-driver-preference.mjs:86:/** 读 template + 指定 agent frontmatter tools，渲染注入块（含 framing），供 --append-system-prompt。 */
scripts/feature-170d-driver-preference.mjs:90:  const tools = parseFrontmatterTools(agentText);
scripts/feature-170d-driver-preference.mjs:91:  const block = renderInjectionBlock(templateText, tools);
```

**过滤分支实读**（`sed -n '86,93p' scripts/feature-170d-driver-preference.mjs`；`sed -n '40,100p' plugins/spec-driver/lib/preference-rules.mjs`；`command grep -n "buildInjectionBlock(" scripts/feature-170d-driver-preference.mjs` → `:87` 定义 / `:220` 调用）：

- 脚本 ① `sync-preference-rules.mjs:32-35 computeExpectedAgentContent(agentText, templateText)`：`parseFrontmatterTools(agentText)` → `renderInjectionBlock(templateText, tools)`；对 `AGENTS = ['plan','implement','verify','spec-review','quality-review']` 逐个 agent 文件调用 → **按各 agent 自身 frontmatter 过滤** ✅。
- 脚本 ② `feature-170d-driver-preference.mjs:87-93 buildInjectionBlock(agent = 'implement')`：读 `plugins/spec-driver/agents/${agent}.md` → 同一调用链；`:220 const systemPrompt = buildInjectionBlock(opts.agent);`，`agent` 来自 CLI 选项；`:81 '--append-system-prompt', systemPrompt` 注入 → **按目标 agent 的 frontmatter 过滤** ✅。
- 共用过滤器 `lib/preference-rules.mjs`：`:52-57 parseFrontmatterTools` 以 `/^tools:\s*\[(.*)\]/m` 取单行数组、只回收 `mcp__plugin_spectra_spectra__\w+`；`:43-49 toolKeysFromAgentTools` 去前缀；`:82 if (keys.has(tool)) out.push(rowLine);` 为过滤分支。过滤键 = `tools` 的 spectra MCP 子集（非数组本身），`Edit` / `Bash` 不参与。

**换算式**：按 `tools` 过滤的脚本数 ÷ 自述声明的脚本数 = 2 ÷ 2 = 100%（单位：脚本）。

**结论：PASS**。附加事实（plan §K1 已登记，此处复核在场）：解析器只认单行行内数组，`tools` 改为 YAML 块状列表时两脚本会静默得到空数组而非报错——不改本条判定，但属 `tools` 键消费面的已知形态约束。

## 分母口径核对（三处）

### (i) V-1 ~ V-3 未被混入 `[推断]` 分母

```bash
command grep -n "推断前提登记\|^## \|^### " specs/277-spec-driver-engine-hardening/spec.md
sed -n '551p' specs/277-spec-driver-engine-hardening/spec.md
```
原始输出（摘）：
```
586:## 推断前提登记
596:### 登记的推断前提（5 条，计入 SC-009）
631:### 能力边界声明（2 条，不计入 SC-009 分母）
646:### 已核实的候选前提（3 条，不计入 SC-009 分母）
654:### 已证伪前提的留痕（教训栏 · 不计入本章节的 10 条，也不计入 SC-009 分母）
```
`:551` SC-009 原文：「…换算式：得到 PASS 或 FAIL 的条数 ÷ 登记的 `[推断]` 条数 = **5 ÷ 5 = 100%**，单位：前提条；**分母 5 = A-1 + A-2 + A-3 + A-4 + A-5** … 其二，标注为「已核实」的条目不进分母——本 spec 中为 **V-1 / V-2 / V-3 共 3 条**…」。

`:596-629` 实读：`[推断]` 桶恰为 A-1 / A-2 / A-3 / A-4 / A-5 五条（换算式 5 = 5，单位：前提条）；`:646-652` V-1 ~ V-3 在独立小节，标题即声明「不计入 SC-009 分母」。

**结论 (i)：✅ V-1 ~ V-3 未被混入 `[推断]` 分母。**

### (ii) V-1 ~ V-3 是否已按 FR-032 附命令与原始输出片段（未补齐者退回 `[推断]`）

#### V-1

- **spec 记录**（`:648`）：只给复核命令 `npm run repo:check`，并自述「下列三条目前只给出了复核命令、尚未附原始输出片段，须在 plan / verify 阶段补齐」。
- **plan 阶段补齐**（`plan.md:1046-1055` V-P1）：附 A/B 沙箱原始输出
  ```
  A status= pass errors= []   agent-frontmatter-{plan,implement,verify,spec-review,quality-review} 全 pass
  B status= pass errors= []   agent-frontmatter-{plan,implement,verify,spec-review,quality-review} 全 pass
  A [{"id":"agent-block-sync","status":"pass","evidence":{"drifted":[]}}] errors= []
  B [{"id":"agent-block-sync","status":"pass","evidence":{"drifted":[]}}] errors= []
  ```
  并明写「**这条同时补齐了 spec V-1 按 FR-032 欠缺的原始输出片段**，故 spec V-1 不退回 `[推断]`」（`:1055`）。
- **verify 阶段现树复核**（本会话，`npm run repo:check`，输出落 scratchpad `repo-check.txt`）：
  ```
  [repo-check] status=warn
  - namespace-consistency:agent-frontmatter-plan: pass
  - namespace-consistency:agent-frontmatter-implement: pass
  - namespace-consistency:agent-frontmatter-verify: pass
  - namespace-consistency:agent-frontmatter-spec-review: pass
  - namespace-consistency:agent-frontmatter-quality-review: pass
  - preference-rules:agent-block-sync: pass
  - agent-tools:required: pass
  warnings:
    - [graph-quality] 图产物已 stale（source-commit）… sourceCommit（64b1d72f…）与当前 HEAD（d86fa332…）不一致 …
  exit=0
  ```
  `command grep -c "^- " repo-check.txt` → `95`；唯一 warn 为 `graph-quality:freshness`（图 stale，与本卡无关）。现树 3 份 agent 的 `tools` 已真实含 `Edit, Bash`（`command grep -m1 '^tools:' plugins/spec-driver/agents/{specify,plan,tasks}.md`，见 D-4 §未盘点(a)），5 项 `agent-frontmatter-*` 仍 pass。
- **判定**：命令 + 原始输出**已在场**（plan 补齐 + verify 现树复核）→ **维持「已核实」，不退回 `[推断]`**。

#### V-2

- **spec 记录**（`:650`）：5 个注入 SKILL 行数 `feature 794 / implement 671 / story 596 / fix 573 / resume 336`，`doc`（732）不在注入清单；复核命令 `wc -l plugins/spec-driver/skills/spec-driver-{fix,story,feature,implement,resume}/SKILL.md`。
- **plan 阶段补齐**（`plan.md:1079`）：附 2026-09-04 原始输出「`573 fix / 596 story / 794 feature / 671 implement / 336 resume / 2970 total` ✅ 与 spec 记录逐字一致」。
- **verify 阶段现树复跑**：
  ```bash
  wc -l plugins/spec-driver/skills/spec-driver-{fix,story,feature,implement,resume}/SKILL.md; wc -l plugins/spec-driver/skills/spec-driver-doc/SKILL.md
  ```
  ```
       826 plugins/spec-driver/skills/spec-driver-fix/SKILL.md
       927 plugins/spec-driver/skills/spec-driver-story/SKILL.md
      1125 plugins/spec-driver/skills/spec-driver-feature/SKILL.md
      1002 plugins/spec-driver/skills/spec-driver-implement/SKILL.md
       568 plugins/spec-driver/skills/spec-driver-resume/SKILL.md
      4448 total
       916 plugins/spec-driver/skills/spec-driver-doc/SKILL.md
  ```
  结构部分复核：`sed -n '36,43p' plugins/spec-driver/scripts/sync-delegation-contract.mjs` → `SKILL_ANCHORS` 键 = `fix / story / feature / implement / resume`（5 个），无 `doc` ✅。
- **判定**：命令 + 原始输出**已在场**（plan `:1079`）→ **维持「已核实」，不退回 `[推断]`**。**但数值已陈旧**：本卡向 5 份 SKILL 注入新 marker 块后行数变为 826 / 927 / 1125 / 1002 / 568（合计 4448；增量 4448 − 2970 = 1478 行，单位：行），`doc` 由 732 → 916。V-2 的结构性部分（5 份被注入、`doc` 不在清单）仍真；其数字部分是 2026-09-02 时点事实，须按 T121 追加更新，不影响分母。

#### V-3

- **spec 记录**（`:651`）：`GATE_DESIGN` 的 `applicable_modes` 不含 `refactor`，`hard_gate_modes` 仅含 `feature`；复核命令 `sed -n '39,55p' plugins/spec-driver/config/orchestration.yaml`。
- **plan 阶段补齐**（`plan.md:1080`）：附原始输出「`applicable_modes: feature / story / implement / fix / resume / sync / doc`（**7 项，无 `refactor`**）、`default_behavior: always`、`severity: critical`、`hard_gate_modes: - feature`（**仅 1 项**）✅」。
- **verify 阶段现树复跑**：
  ```bash
  sed -n '39,55p' plugins/spec-driver/config/orchestration.yaml
  ```
  ```
    GATE_DESIGN:
      type: design_checkpoint
      applicable_modes:
        - feature
        - story
        - implement
        - fix
        - resume
        - sync
        - doc
      description: "需求规范质量门禁（feature 模式下为硬门禁）"
      default_behavior: always
      severity: critical
      hard_gate_modes:
        - feature
      insertion_point: null
  ```
  `applicable_modes` 7 项（feature / story / implement / fix / resume / sync / doc），无 `refactor`；`hard_gate_modes` 1 项 = `feature`。换算式：7 = 8 个 mode − 1（refactor），单位：mode。
- **判定**：命令 + 原始输出**已在场**（plan `:1080` + 现树逐字相同）→ **维持「已核实」，不退回 `[推断]`**。

### (iii) B-1 / B-2 未计入分母；A-3 为可测经验命题且命令与陈述同一命题

- **B-1 / B-2**：spec `:631` 小节标题「能力边界声明（2 条，不计入 SC-009 分母）」；`:551` SC-009 明写「B-1 / B-2 共 2 条」不进分母并各给排除理由（`:635` B-1：陈述逻辑上恒真、不可证伪；`:642` B-2：对 spec 自身覆盖面的断言、无运行时口径的同一命题命令）。本轮**不为 B-1 / B-2 配任何命令**（配了即用相邻命题背书，FR-066）。→ ✅ 两条均未计入分母。
- **A-3 的性质**：`:614` 陈述为可测经验命题（「粗提命令能从改动文件中提出 ≥ 1 个未申报候选」），其命令 |P \ D| ≥ 1 与之同一命题（§A-3 已核）；原 A-3 的恒真半已单列为 B-1，且本轮未把 B-1 计入分母。→ ✅（判别力弱的问题在 §A-3 登记，不影响「同一命题」判定）。

**结论 (iii)：✅**。

## SC-009 换算式按实际重算

| 项 | 取值 | 依据 |
|---|---|---|
| 分母 | 5 + 退回条数 0 = **5**（单位：前提条） | (ii)：V-1 / V-2 / V-3 均附命令与原始输出（plan 补齐 + verify 复跑），无退回 |
| 分子（得到 PASS 或 FAIL 的条数） | A-1 PASS + A-3 PASS + A-4 PASS + A-5 PASS = **4** | A-2 未执行（缺席），不计 |
| SC-009 | 4 ÷ 5 = **80%**（单位：前提条） | spec 目标 5 ÷ 5 = 100% |
| PASS / FAIL 分布 | PASS 4 · FAIL 0 · 缺席 1 | A-4 内嵌子陈述「注入量 0」被证伪，但 A-4 主陈述 PASS，不计 FAIL |

**结论：SC-009 于本时点未达成**（80% ≠ 100%）。唯一缺口 = A-2；闭合条件 = D-5 观察窗口积累 ≥ 3 次合规观察后重判。分母不因 V 桶变化（三条补齐留痕见 §(ii)）。

## 通过条件逐字复核

| 通过条件原文（`tasks.md:329`） | 复核 | 依据 |
|---|---|---|
| 「**5 条**全部得到明确结论。」 | ❌ | 4 ÷ 5（A-1 / A-3 / A-4 / A-5 PASS；A-2 未执行（缺席）） |
| 「**若某条只能得到「无法判定」，说明其验证命令不是运行时口径，该条判不通过**（FR-033）——「按设计应当如此」这类静态论证不构成实证」 | ⚠️ | A-2 的命令**是**运行时口径（`wc -c` / `grep -c` 于真实产物），缺的是输入（合规观察 0 次）；按 FR-063 计「未执行（缺席）」，结果同样是**该条不通过**，本文件未以静态论证替代 |
| 「**命令与陈述不是同一命题的条目按「无法判定」计**（FR-066）」 | ✅ | 5 条逐条核对均同一命题（各节首段）；A-1 的分支 ref 以 master 历史区间替代取同一操作数，已留痕（§A-1） |
| 「**(i)** 标注为「已核实」的 V-1 / V-2 / V-3 未被混入 `[推断]` 分母」 | ✅ | §(i) |
| 「**(ii)** V-1 ~ V-3 是否已按 FR-032 补齐**命令与其原始输出片段**——未补齐者退回 `[推断]` 并计入分母」 | ✅ | §(ii)：三条均附（plan `:1046-1055` / `:1079` / `:1080` + verify 现树复跑）；退回 0 条，分母 5；V-2 数值陈旧已登记 |
| 「**(iii)** 能力边界声明 **B-1 / B-2 两条均未被计入**分母……且 A-3 是从原 A-3 拆出的**可测经验命题**、其命令与陈述同一命题」 | ✅ | §(iii) |
| 期望输出「5 条各得到明确的 PASS 或 FAIL 且各附原始输出片段」 | ❌ | 4 条有；A-2 无 |
| 「**自证循环声明**：被检对象是本 spec 自身，**通过不构成该检查在他人产物上同样有效的证据**」 | ✅ | §测不到 末条 |

## 测不到的部分与自证循环声明

1. **A-2 完全缺席**：本演示对「写进正文后子代理是否自发遵守」无任何可说——本卡内所有骨架先行的实例（含本文件）都是被明示要求的，不是观察。这同时意味着 D-4 §测不到 第 3 条（plan 子代理会不会执行 FR-028 散文）在本卡内同样无实证。
2. **A-3 的字面命令无判别力**：PASS 是构造性的（grep 原始行与关键量名称不可能字面相等）；补充核对只标定强度，不构成 spec 命令的替代。粗提法噪声率未测。
3. **A-1 测的是交付后状态**：F276 已合入 master、本分支已 rebase 到其上，「并行冲突」这一情境已不存在；交集为空既可能是「设计上不相交」也可能是「rebase 时已消解」——本轮以 `A_card ∩ B = ∅`（本卡 119 文件与 F276 31 文件无一重合）排除了后者，但这只对本卡成立。
4. **三条「已核实」的证据同源**：V-1 ~ V-3 的原始输出由本卡 plan 子代理附上、再由本卡 verify 子代理复跑，两者同属本卡；「已核实」桶的进桶门槛（FR-032）在本卡上被同一来源满足，不构成该门槛对第三方产物的有效性证据。
5. **时序悖论登记**（Edge Case 18 / T121）：FR-033 / FR-066 的实证口径产于 implement，被检登记表产于 specify；本文件按追加口径落盘，未改写 spec / plan 冻结正文。A-4 的「注入量 0」与 V-2 的数值两处 spec 陈述被现树证伪，处置只能是追加修订记录。
6. **自证循环声明**：被检对象是本 spec 自身的推断前提登记，命令由本 spec 自己给出、执行者是本卡的验证子代理；本演示的任何 PASS **不构成该检查在他人产物上同样有效的证据**。

## 最终判定

**未通过（部分：4 ÷ 5 = 80%，单位：前提条）**。通过条件「5 条全部得到明确结论」不成立，唯一缺口是 A-2（未执行（缺席）：合规观察 0 ÷ 3）；分母口径三处核对 (i)(ii)(iii) 全部 ✅。附须由编排器处置的发现：

| # | 发现 | 类别 | 建议处置 |
|---|---|---|---|
| F-1 | A-2 无合规观察（d5-observations 0 条；本卡内所有骨架先行实例均被明示要求） | 缺席（可闭合） | D-5 窗口积累 ≥ 3 次合规观察后由编排器回填、重判 A-2 与 SC-009；不得在 Phase E 集中造观察 |
| F-2 | A-4 内嵌子陈述「本卡对该预算的注入量为 0 / 空载 PASS」被证伪：实测注入 704 bytes（经 `docs/shared/agent-orchestration-overrides.md` 新增 2 行 diagnostic），主陈述仍 PASS | spec over-claim（方向：说没注入、其实注入了） | T121 追加「冻结后修订记录」：原取值 0 bytes / 新取值 704 bytes / 发现者 D-8 / 2026-09-07 |
| F-3 | V-2 数值陈旧：5 SKILL 行数 2970 → 4448（+1478 行），doc 732 → 916；结构性陈述仍真 | 已核实条目的数值过期 | T121 追加更新数值；不退回 `[推断]`、不改分母 |
| F-4 | A-1 的 F276 分支 ref 已不存在，操作数 B 改由 master 历史区间 `7acf8ae8..26a3b15f`（3 commit、31 文件）取得 | 命令形态替代（同一命题） | 在 A-1 条目追加「交付后取数口径」留痕；若编排器按字面判「ref 不可解析 ⇒ 缺席」，SC-009 降为 3 ÷ 5 = 60%，本文件两种口径都已给出 |
| F-5 | A-3 字面命令的 PASS 为构造性（比较空间不同）；补充核对显示 353 ÷ 423 = 83.5% 的 `const` 标识符未在 reverse-census 章节出现，其中含真候选也含噪声 | 判别力登记 | 若后续卡要把粗提法升为辅助信号，须先测噪声率并改比较口径（标识符级） |

计数汇总（单位分列）：`[推断]` 5 条中 PASS 4 / FAIL 0 / 缺席 1；能力边界 2 条未配命令、未入分母；已核实 3 条均附命令 + 原始输出、退回 0；SC-009 = 4 ÷ 5 = 80%。工作树在本演示前后未被本演示改动（`npm run repo:sync` 只在 scratchpad clone 内跑过；`git status --porcelain` 中本演示只新增本文件与 `e-d4-reverse-census-gap-injection.md` 两个未跟踪文件）。
