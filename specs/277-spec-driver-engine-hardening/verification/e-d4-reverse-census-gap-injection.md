# D-4 · reverse-census 缺口注入演示（T116 · Phase E 回跑）

> 执行时点：2026-09-07；执行者：Phase E 验证子代理（非编排器）；被检对象：本卡（F277）自身改动的关键量。
> 本文件只新增、不改写 `spec.md` / `plan.md` / `tasks.md` 冻结正文（T121 追加口径）。每个结论同处附命令原文与原始输出片段（FR-062）；无命令与输出的结论一律按「未执行（缺席）」写，不写成通过。

## 输入与命令清单

| # | 输入 / 命令原文 | 用途 |
|---|---|---|
| I-1 | `sed -n '325p' specs/277-spec-driver-engine-hardening/tasks.md` | T116 任务原文（执行步骤 / 期望输出 / 通过条件逐字） |
| I-2 | `sed -n '443,998p' specs/277-spec-driver-engine-hardening/plan.md`（K1 = `:508-575`，K2 = `:576-606`；行号为 2026-09-07 本会话读取时值——`plan.md` 正被编排器并行追加修订记录，行号可能漂移） | plan §reverse-census 已登记行 |
| I-3 | `sed -n '296,322p' plugins/spec-driver/agents/plan.md` · `sed -n '104,125p' plugins/spec-driver/templates/specify-base/plan-template.md` | T041 落成的 FR-028 一致性校验口径 |
| I-4 | `git rev-parse HEAD` → `d86fa332`；开工时 `git status --short \| wc -l` → `0`（工作树干净，磁盘态 == HEAD） | 被检对象的版本锚 |
| C-1 | K1 检索命令（§1.1，plan 原文逐字、`grep` → `command grep`） | `tools` 键消费点 |
| C-2 | KA 检索命令 ×2（§2.1） | SKILL 注入锚点名消费点 |
| C-3 | K2a / K2b / 逐 key marker 三条命令（§3.1） | `sectionConfigs` 三字段与 marker 块名 |
| C-4 | `census-snapshot.mjs` + `census-check.mjs`（scratchpad 内，§执行体） | 副本清单 + 一致性校验执行体 |
| C-5 | M1 / M2 变异构造脚本（§M1 / §M2） | 缺口注入 |
| C-6 | `npm run repo:check`（V-1 的复核命令；输出落 scratchpad `repo-check.txt`） | 未盘点消费方 (a) |
| C-7 | A-5 的 `grep -nE 'frontmatter\|tools\|parseFrontmatterTools\|toolKey' …` + 两脚本源码读取 | 未盘点消费方 (b) |
| C-8 | plan §K1 渲染哈希探针在**现树**复跑（只读、内存内） | (a) 的运行时旁证 |
| C-9 | `git archive e01611b2 … \| tar -x` 到 scratchpad 后复跑 C-1 / C-3 | 核对 plan 当时计数是否在其自身 commit 上成立 |

**机械执行数登记**（T121 口径）：本文件内凡标「实测」的数字，均由同处所列命令在本会话产出；未附命令与输出的陈述一律不标「已机械执行」。变异实验（C-4 / C-5）全部在 scratchpad 目录内对**清单副本**做，被检索的源树只读、未改动。

## 执行环境声明（FR-027 可复现性前置）

```
$ type grep | head -2
grep is a shell function from /Users/connorlu/.claude/shell-snapshots/snapshot-zsh-1788702108542-7qmme0.sh
$ command -v grep; command grep --version 2>&1 | head -1
grep
grep (BSD grep, GNU compatible) 2.6.0-FreeBSD
```

本文件所有检索命令一律写 `command grep …`，绕过 shell function（后者展开为 ugrep）。由此产生三条与 plan §执行环境声明**相反**的行为，比对 plan 计数时须换算：

1. **不遵守 `.gitignore`**（BSD grep）。`node_modules/`、`dist/` 必须靠管道 / `--exclude-dir` 排除；plan 命令里的 `| grep -v node_modules | grep -v '^\./dist/'` 在本环境是**实际生效**的过滤，不是空转。
2. **输出路径带 `./` 前缀**（搜索根为 `.` 时）。因此 `| command grep -v "^./specs/277"` **生效**——plan 在 ugrep 下跑同一管道是空转，其 K2 的 12 文件含 4 份 `specs/277-*` 自指文件。凡与 plan 比对处，本文件同时给出「含自指」与「不含自指」两个口径。
3. **执行体内的命令经 `zsh -c` 非交互运行**（不加载 shell-snapshot，`grep` 不是 function），`command grep` 同样解析到 `/usr/bin/grep`；交互式与执行体两路计数逐项相同（K1 20 / K2a 6 / K2b 37 / KA 45），见 §初始校验。

跨环境复跑出现计数差异时，先核对 grep 实现，再判为漂移（plan §执行环境声明的处置口径，此处沿用）。

## 关键量 1 · `plugins/spec-driver/agents/*.md` frontmatter 的 `tools` 键

### 1.1 真实普查（检索命令 + 消费点清单 + 声明条数）

**检索命令**（plan §K1 原文逐字，仅 `grep` → `command grep`）：

```bash
command grep -rn "parseFrontmatterTools\|extractFrontmatterTools\|toolKeysFromAgentTools" \
  --include="*.mjs" --include="*.ts" . 2>/dev/null \
  | command grep -v node_modules | command grep -v '^\./dist/' | command grep -v '^\./\.codex/'
```

**原始输出（20 行，全量）**：

```
./plugins/spec-driver/scripts/sync-preference-rules.mjs:20:  parseFrontmatterTools,
./plugins/spec-driver/scripts/sync-preference-rules.mjs:33:  const tools = parseFrontmatterTools(agentText);
./plugins/spec-driver/lib/preference-rules.mjs:43:export function toolKeysFromAgentTools(agentTools) {
./plugins/spec-driver/lib/preference-rules.mjs:52:export function parseFrontmatterTools(agentText) {
./plugins/spec-driver/lib/preference-rules.mjs:68:  const keys = toolKeysFromAgentTools(agentTools);
./tests/unit/agent-tools-core.test.ts:28:  extractFrontmatterTools,
./tests/unit/agent-tools-core.test.ts:457:    expect(extractFrontmatterTools(fm('model2: x\n'))).toBeNull();
./tests/unit/agent-tools-core.test.ts:458:    expect(extractFrontmatterTools('# 没有 frontmatter\n')).toBeNull();
./tests/unit/agent-tools-core.test.ts:459:    expect(() => extractFrontmatterTools(fm('tools:   # 注释\n  - Read\n'))).toThrow(/不受支持/);
./tests/unit/agent-tools-core.test.ts:460:    expect(extractFrontmatterTools(fm('tools: [Read, Bash]\n'))).toEqual(['Read', 'Bash']);
./tests/unit/agent-tools-core.test.ts:462:    expect(extractFrontmatterTools(fm('tools: []\n'))).toEqual([]);
./scripts/feature-170d-driver-preference.mjs:34:  parseFrontmatterTools,
./scripts/feature-170d-driver-preference.mjs:90:  const tools = parseFrontmatterTools(agentText);
./scripts/lib/namespace-consistency-core.mjs:149:export function extractFrontmatterTools(content) {
./scripts/lib/namespace-consistency-core.mjs:270:      tools = extractFrontmatterTools(content);
./scripts/lib/agent-tools-core.mjs:33:import { extractFrontmatterTools } from './namespace-consistency-core.mjs';
./scripts/lib/agent-tools-core.mjs:35:export { extractFrontmatterTools };
./scripts/lib/agent-tools-core.mjs:244:      toolsByAgent[agent] = content === null ? null : extractFrontmatterTools(content);
./scripts/lib/driver-eval-core.mjs:250:  toolKeysFromAgentTools,
./scripts/lib/driver-eval-core.mjs:251:  parseFrontmatterTools,
```

**计数命令与输出**：同一管道尾接 `| wc -l` → `20`；`-rn` 改 `-rl` 后 `| wc -l` → `7`。

**声明条数：20 命中行 / 7 文件**（两单位分列，不相加）。

**消费点逐个定性**（换算式：命中行 20 = lib 3 + sync-preference-rules 2 + feature-170d 2 + driver-eval-core 2 + namespace-consistency-core 2 + agent-tools-core 3 + 测试 6 = 20，单位：命中行）：

| 文件:行 | 角色 |
|---|---|
| `plugins/spec-driver/lib/preference-rules.mjs:43 / :52 / :68` | canonical 解析器与 key 提取（定义侧） |
| `plugins/spec-driver/scripts/sync-preference-rules.mjs:20 / :33` | 消费方 ①：渲染 5 agent 的 preference-rules 块 |
| `scripts/feature-170d-driver-preference.mjs:34 / :90` | 消费方 ②：F170d harness → `--append-system-prompt` |
| `scripts/lib/driver-eval-core.mjs:250 / :251` | re-export 中转 |
| `scripts/lib/namespace-consistency-core.mjs:149 / :270` | 消费方 ③：`repo:check` 的 `namespace-consistency:agent-frontmatter-*`。**行号较 plan 记录的 `:22 / :133` 后移**（F277 把私有函数改为具名导出，见该文件注释） |
| `scripts/lib/agent-tools-core.mjs:33 / :35 / :244` | **消费方 ④（本卡 Phase A 新建，FR-017 `agent-tools:required` 守护项）**：import / re-export / 调用 |
| `tests/unit/agent-tools-core.test.ts:28 / :457-462` | 测试消费（6 行；非生产消费方，但命中命令、按 FR-028 计入声明条数） |

### 1.2 与 `plan.md` §reverse-census 对应行（K1）的核对

**plan §K1 登记值**（`sed -n '508,520p' specs/277-spec-driver-engine-hardening/plan.md`，plan 自述于 2026-09-04 · HEAD `e01611b2` 亲跑）：「**计数：11 行 / 5 文件**」，消费方表列 5 文件（`preference-rules.mjs` / `sync-preference-rules.mjs` / `feature-170d-driver-preference.mjs` / `driver-eval-core.mjs` / `namespace-consistency-core.mjs`）。

**plan 当时值是否在其自身 commit 上成立（C-9，只读 archive，不动工作树）**：

```bash
git archive e01611b2 plugins scripts tests AGENTS.md CLAUDE.md specs/084-harness-native-integration specs/239-worktree-local-state | tar -x -C <scratch>/e016
cd <scratch>/e016 && command grep -rn "parseFrontmatterTools\|extractFrontmatterTools\|toolKeysFromAgentTools" --include="*.mjs" --include="*.ts" . 2>/dev/null | command grep -v node_modules | command grep -v '^\./dist/' | command grep -v '^\./\.codex/' | wc -l
cd <scratch>/e016 && command grep -rl  "parseFrontmatterTools\|extractFrontmatterTools\|toolKeysFromAgentTools" --include="*.mjs" --include="*.ts" . 2>/dev/null | command grep -v node_modules | wc -l
```
原始输出：`11` / `5` → plan 的 11 行 / 5 文件在 `e01611b2` 的 tracked 树上**可复现**（plan 撰写无误）。

**现树（HEAD `d86fa332`）**：20 行 / 7 文件（§1.1）。

**差集归因**：+9 行 / +2 文件 = `scripts/lib/agent-tools-core.mjs`（3 行）+ `tests/unit/agent-tools-core.test.ts`（6 行）。两文件均属本卡改动集：

```bash
git diff --name-only 26a3b15f..HEAD | sort > <scratch>/A_card.txt   # 119 行
command grep -n "agent-tools-core" <scratch>/A_card.txt
```
原始输出：`75:scripts/lib/agent-tools-core.mjs` / `116:tests/unit/agent-tools-core.test.ts`。另 `namespace-consistency-core.mjs` 两行行号由 `:22 / :133` 移至 `:149 / :270`（同文件同函数，计数不变，不入差集）。

**核对结论：不一致（时序性漂移，非 plan 撰写错误）**。按 FR-028 对 plan 冻结的 K1 行在现树复算：声明 11 ≠ 实测 20 → 该行今日会被判「计数不符 → 阻断」。性质：plan 于 implement 之前普查，implement（本卡 Phase A，FR-017）新建了消费方 ④——这是 Edge Case 18 时序悖论在 D-4 上的具体形态；处置按 T121 走「冻结后修订记录」追加（发现时点 2026-09-07 / 发现者 D-4 演示 / 原取值 11 行 5 文件 / 新取值 20 行 7 文件），**本文件不改写 plan 正文**。附带观察：消费方 ④ 在 plan 的 K1 表中**不可能**出现（当时不存在），只有回跑普查才能盘出——它与 B-1 不同型（不是选择性申报，而是申报时点早于消费方产生）。

## 关键量 2 · `sync-delegation-contract.mjs` 的 SKILL 注入锚点名

### 2.1 真实普查（检索命令 + 消费点清单 + 声明条数）

**关键量定义处**（`sed -n '36,43p' plugins/spec-driver/scripts/sync-delegation-contract.mjs`）：

```
/** 显式 per-SKILL 注入锚点 map（已实测）。 */
const SKILL_ANCHORS = {
  fix: '## 工作流定义',
  story: '## 工作流定义',
  feature: '## 工作流执行（动态模式）',
  implement: '## 工作流定义',
  resume: '## 恢复后执行流程',
};
```

锚点名 = 3 个不同的标题字符串（`## 工作流定义` / `## 工作流执行（动态模式）` / `## 恢复后执行流程`），映射到 5 个 mode。

**检索命令 (a) —— 锚点字符串本身**：

```bash
command grep -rn -e "## 工作流定义" -e "## 工作流执行（动态模式）" -e "## 恢复后执行流程" \
  plugins/spec-driver .codex scripts tests --include='*.md' --include='*.mjs' --include='*.ts' 2>/dev/null
```

**原始输出（45 行，全量）**：

```
plugins/spec-driver/skills-codex/spec-driver-story/SKILL.md:336:## 工作流定义
plugins/spec-driver/skills-codex/spec-driver-resume/SKILL.md:359:## 恢复后执行流程
plugins/spec-driver/skills-codex/spec-driver-refactor/SKILL.md:129:## 工作流定义（5 阶段）
plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md:255:## 工作流定义
plugins/spec-driver/skills-codex/spec-driver-feature/SKILL.md:262:## 工作流执行（动态模式）
plugins/spec-driver/skills-codex/spec-driver-implement/SKILL.md:338:## 工作流定义
plugins/spec-driver/tests/delegation-contract.test.mjs:49:    fix: '## 工作流定义',
plugins/spec-driver/tests/delegation-contract.test.mjs:50:    story: '## 工作流定义',
plugins/spec-driver/tests/delegation-contract.test.mjs:51:    feature: '## 工作流执行（动态模式）',
plugins/spec-driver/tests/delegation-contract.test.mjs:52:    implement: '## 工作流定义',
plugins/spec-driver/tests/delegation-contract.test.mjs:53:    resume: '## 恢复后执行流程',
plugins/spec-driver/tests/delegation-contract.test.mjs:105:    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
plugins/spec-driver/tests/delegation-contract.test.mjs:106:    const out = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
plugins/spec-driver/tests/delegation-contract.test.mjs:107:    assert.match(out, /## 工作流定义\n\n<!-- BEGIN delegation-contract/);
plugins/spec-driver/tests/delegation-contract.test.mjs:110:    assert.ok(out.indexOf('## 工作流定义') < out.indexOf(BEGIN_MARKER));
plugins/spec-driver/tests/delegation-contract.test.mjs:115:    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
plugins/spec-driver/tests/delegation-contract.test.mjs:116:    const once = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
plugins/spec-driver/tests/delegation-contract.test.mjs:117:    const twice = computeExpectedSkillContent(once, TPL, '## 工作流定义');
plugins/spec-driver/tests/delegation-contract.test.mjs:122:    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
plugins/spec-driver/tests/delegation-contract.test.mjs:123:    const injected = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
plugins/spec-driver/tests/delegation-contract.test.mjs:126:    const re = computeExpectedSkillContent(injected, TPL2, '## 工作流定义');
plugins/spec-driver/tests/delegation-contract.test.mjs:135:    assert.throws(() => computeExpectedSkillContent(skill, TPL, '## 工作流定义'), /锚点未找到/);
plugins/spec-driver/tests/delegation-contract.test.mjs:140:    const skill = `# T\n\n## 工作流定义\n\n${BEGIN_MARKER}\n> 残块\n\n正文。\n`;
plugins/spec-driver/tests/delegation-contract.test.mjs:141:    assert.throws(() => computeExpectedSkillContent(skill, TPL, '## 工作流定义'), /BEGIN.*缺 END|畸形/);
plugins/spec-driver/scripts/sync-delegation-contract.mjs:15: *   fix/story/implement → '## 工作流定义'
plugins/spec-driver/scripts/sync-delegation-contract.mjs:16: *   feature             → '## 工作流执行（动态模式）'
plugins/spec-driver/scripts/sync-delegation-contract.mjs:17: *   resume              → '## 恢复后执行流程'
plugins/spec-driver/scripts/sync-delegation-contract.mjs:38:  fix: '## 工作流定义',
plugins/spec-driver/scripts/sync-delegation-contract.mjs:39:  story: '## 工作流定义',
plugins/spec-driver/scripts/sync-delegation-contract.mjs:40:  feature: '## 工作流执行（动态模式）',
plugins/spec-driver/scripts/sync-delegation-contract.mjs:41:  implement: '## 工作流定义',
plugins/spec-driver/scripts/sync-delegation-contract.mjs:42:  resume: '## 恢复后执行流程',
plugins/spec-driver/lib/delegation-contract.mjs:53: * @param {string} anchorHeading 形如 '## 工作流定义'，必须与 SKILL 中某行完整匹配
plugins/spec-driver/skills/spec-driver-story/SKILL.md:313:## 工作流定义
plugins/spec-driver/skills/spec-driver-resume/SKILL.md:336:## 恢复后执行流程
plugins/spec-driver/skills/spec-driver-refactor/SKILL.md:106:## 工作流定义（5 阶段）
plugins/spec-driver/skills/spec-driver-fix/SKILL.md:232:## 工作流定义
plugins/spec-driver/skills/spec-driver-feature/SKILL.md:239:## 工作流执行（动态模式）
plugins/spec-driver/skills/spec-driver-implement/SKILL.md:315:## 工作流定义
.codex/skills/spec-driver-story/SKILL.md:336:## 工作流定义
.codex/skills/spec-driver-resume/SKILL.md:359:## 恢复后执行流程
.codex/skills/spec-driver-refactor/SKILL.md:129:## 工作流定义（5 阶段）
.codex/skills/spec-driver-fix/SKILL.md:255:## 工作流定义
.codex/skills/spec-driver-feature/SKILL.md:262:## 工作流执行（动态模式）
.codex/skills/spec-driver-implement/SKILL.md:338:## 工作流定义
```

**计数命令与输出**：同管道 `| wc -l` → `45`；`-rn` 改 `-rl` 后 `| wc -l` → `21`。

**检索命令 (b) —— 锚点表标识符 `SKILL_ANCHORS`**：

```bash
command grep -rn "SKILL_ANCHORS" plugins scripts tests .codex 2>/dev/null
```
原始输出（4 行，全量）：
```
plugins/spec-driver/scripts/sync-delegation-contract.mjs:37:const SKILL_ANCHORS = {
plugins/spec-driver/scripts/sync-delegation-contract.mjs:82:  for (const [mode, anchor] of Object.entries(SKILL_ANCHORS)) {
plugins/spec-driver/scripts/sync-delegation-contract.mjs:116:  for (const mode of Object.keys(SKILL_ANCHORS)) {
plugins/spec-driver/scripts/sync-delegation-contract.mjs:150:  for (const [mode, anchor] of Object.entries(SKILL_ANCHORS)) {
```
计数：`| wc -l` → `4`；`-rl` → `1`。

**声明条数：(a) 45 命中行 / 21 文件；(b) 4 命中行 / 1 文件**（两条命令各自成行，不相加）。

**消费点逐个定性**（换算式：45 = 脚本注释 3 + 脚本 map 5 + lib 文档注释 1 + 测试 18 + SKILL 标题 18 = 45，单位：命中行；SKILL 标题 18 = 6 份 SKILL × 3 份拷贝（`plugins/spec-driver/skills` 源 / `skills-codex` 分发副本 / `.codex/skills` wrapper），单位：命中行）：

| 类别 | 命中 | 定性 |
|---|---|---|
| `sync-delegation-contract.mjs:15-17 / :38-42` | 8 | 定义侧（注释 3 + map 5） |
| `lib/delegation-contract.mjs:53` | 1 | 文档注释；该行同时钉死匹配语义为**整行完整匹配** |
| `tests/delegation-contract.test.mjs`（18 行） | 18 | 测试消费（含与 map 逐字复刻的 5 行 `:49-53`） |
| 5 个注入 mode 的 SKILL 标题 × 3 份拷贝 | 15 | **真实锚点消费点**（注入落点） |
| `spec-driver-refactor` 的 `## 工作流定义（5 阶段）` × 3 份拷贝 | 3 | **前缀伪阳性**：`refactor` ∉ `SKILL_ANCHORS`，且匹配语义为整行完整匹配，该标题不会被当作锚点。按 FR-028 仍计入声明条数（命令输出就是 45），此处只作定性 |

真实锚点消费点数 = 45 − 3（伪阳性）= **42**（单位：命中行）；该数**不替代**声明条数 45，仅供解读。

### 2.2 与 `plan.md` §reverse-census 对应行的核对

**plan §reverse-census 有无对应行**：

```bash
command grep -n "SKILL_ANCHORS\|工作流定义\|delegation-contract\|注入锚点" specs/277-spec-driver-engine-hardening/plan.md
```
原始输出（10 行，摘要）：`:111`（守护项族清单中的 `delegation-contract` 族名）、`:212`（FR-048 行）、`:754 / :762`（K8 的族计数）、`:1058`、`:1479`、`:1539`（裁定 C-②：「`sync-delegation-contract.mjs:36-37` 的 `SKILL_ANCHORS` 是**硬编码专用管道**」）、`:1577`、`:1677`、`:1726`。**无一是 K 行**；K1 ~ K16 的 16 个 `#### K` 标题（I-2）中没有以锚点名为关键量的行。

**本卡是否改了它**：

```bash
git diff --name-only 26a3b15f..HEAD | command grep -n "delegation\|sync-agent-docs\|agents/.*\.md$\|feature-170d\|preference-rules"
```
原始输出：`78:scripts/sync-agent-docs.mjs`（仅此一行）→ `sync-delegation-contract.mjs` **不在**本卡改动集。

```bash
git diff 26a3b15f..HEAD -- plugins/spec-driver/skills/*/SKILL.md | command grep -E '^[-+]## '
```
原始输出（20 行）全部为 `+## …`（新注入块的小标题，如 `+## 冻结值字段格式`、`+## 止损：\`R_max = 3\`（MUST）`），**0 行 `-## `** → 本卡未删、未改任何既有 `## ` 标题；5 个锚点字符串原位在场（§2.1 输出中 5 mode × 3 拷贝的 15 行可核）。

**回归面是否有守护**：`npm run repo:check`（C-6）原始输出摘：
```
- delegation-contract:skill-block-sync: pass
- delegation-contract:codex-wrapper-block-sync: pass
```

**核对结论：缺席（plan 未把锚点名申报为关键量）**。定性：本卡未改锚点定义与字符串，按 FR-026 入选判据（改 / 新增取值或消费方 / 判据读它）它不在「改」集；但本卡改了**全部 5 份**承载锚点的 SKILL（各注入新 marker 块），锚点是 K15 型「不改但须零回归」的回归面，plan 对 K15 型只登记了 `orchestrator.test.mjs`（K15）与 `AGENTS.md` 字节预算（K16）两项、未登记本项。这是 B-1 的一个活例：**未申报 ⇒ FR-028 校验对它不可见**；本次没有实际回归，是因为回归面另有 `delegation-contract` 两项守护，不是因为普查覆盖到了它。另注：T116 把它表述为「本卡自身被修改的关键量」，字面上不成立（脚本未改、字符串未改），准确说法是「本卡改动了其全部承载文件的关键量」。

## 关键量 3 · `scripts/sync-agent-docs.mjs` 的 `sectionConfigs` 三字段与由 `key` 派生的 marker 块名

### 3.1 真实普查（检索命令 + 消费点清单 + 声明条数）

**三字段的定义处与 entry 数**（baseline 与现树各取一次）：

```bash
git show 26a3b15f:scripts/sync-agent-docs.mjs | command grep -n "key:"
```
原始输出（10 行）：`:8 'branch-sync-policy'  :13 'mainline-focus'  :18 'context-layering'  :23 'release-contract'  :28 'repo-maintenance'  :33 'behavior-rules'  :38 'code-quality'  :43 'orchestration-overrides'  :48 'eval-credentials-policy'  :53 'dogfooding-policy'`

```bash
node --input-type=module -e "const m = await import('./scripts/sync-agent-docs.mjs'); for (const s of m.sectionConfigs) console.log(s.key.padEnd(36), 'targets=', s.targets.length, JSON.stringify(s.targets.slice(0,3)) + (s.targets.length>3?'…':''));"
```
原始输出（15 行）：
```
branch-sync-policy                   targets= 2 ["AGENTS.md","CLAUDE.md"]
mainline-focus                       targets= 2 ["AGENTS.md","CLAUDE.md"]
context-layering                     targets= 2 ["AGENTS.md","CLAUDE.md"]
release-contract                     targets= 2 ["AGENTS.md","CLAUDE.md"]
repo-maintenance                     targets= 2 ["AGENTS.md","CLAUDE.md"]
behavior-rules                       targets= 2 ["AGENTS.md","CLAUDE.md"]
code-quality                         targets= 2 ["AGENTS.md","CLAUDE.md"]
orchestration-overrides              targets= 2 ["AGENTS.md","CLAUDE.md"]
eval-credentials-policy              targets= 2 ["AGENTS.md","CLAUDE.md"]
dogfooding-policy                    targets= 2 ["AGENTS.md","CLAUDE.md"]
orchestrator-gate-mounting-guard     targets= 5 ["plugins/spec-driver/skills/spec-driver-feature/SKILL.md","plugins/spec-driver/skills/spec-driver-story/SKILL.md","plugins/spec-driver/skills/spec-driver-implement/SKILL.md"]…
agent-output-discipline              targets= 4 ["plugins/spec-driver/agents/implement.md","plugins/spec-driver/agents/specify.md","plugins/spec-driver/agents/plan.md"]…
gate-tasks-scope-cut-acceptance      targets= 7 ["plugins/spec-driver/skills/spec-driver-feature/SKILL.md","plugins/spec-driver/skills/spec-driver-story/SKILL.md","plugins/spec-driver/skills/spec-driver-implement/SKILL.md"]…
gate-design-convergence-loop         targets= 4 ["plugins/spec-driver/skills/spec-driver-feature/SKILL.md","plugins/spec-driver/skills/spec-driver-story/SKILL.md","plugins/spec-driver/skills/spec-driver-implement/SKILL.md"]…
gate-verify-matrix-recompute         targets= 8 ["plugins/spec-driver/skills/spec-driver-feature/SKILL.md","plugins/spec-driver/skills/spec-driver-story/SKILL.md","plugins/spec-driver/skills/spec-driver-implement/SKILL.md"]…
```
entry 数：baseline 10 → 现树 15，**本卡 +5**（换算式 15 − 10 = 5，单位：entry）。`git diff --stat 26a3b15f..HEAD -- scripts/sync-agent-docs.mjs` → `1 file changed, 189 insertions(+), 4 deletions(-)`。5 个新 entry 的 `sourcePath` 全在 `plugins/spec-driver/templates/<key>.md`（`sed -n '127-223p'` 可见，见上文 `sectionConfigs` 定位输出 `:128 :148 :165 :193 :222`），marker 块名由 `key` 派生：`scripts/sync-agent-docs.mjs:38` 与 `:237-238` 两处 `` `<!-- BEGIN SHARED SECTION: ${key} -->` ``。

**检索命令 K2a —— `sectionConfigs` 标识符的代码消费方**：

```bash
command grep -rn "sectionConfigs" scripts plugins tests --include='*.mjs' --include='*.ts' 2>/dev/null
```
原始输出（6 行，全量）：
```
scripts/sync-agent-docs.mjs:58:export const sectionConfigs = [
scripts/sync-agent-docs.mjs:255:  for (const section of sectionConfigs) {
scripts/sync-agent-docs.mjs:280:  for (const section of sectionConfigs) {
tests/unit/agent-docs-sd-mode-guard.test.ts:24:import { checkSdModeDeclaration, sectionConfigs, validateSharedAgentDocs } from '../../scripts/sync-agent-docs.mjs';
tests/unit/agent-docs-sd-mode-guard.test.ts:93:    const configs = sectionConfigs as Array<{ key: string; preludeGuard?: unknown }>;
tests/integration/spec-drift-repo-check-regression.test.ts:140:    // `sectionConfigs` **数组追加顺序**。下方顺序按各块的落地 Phase 钉死，故后续 Phase
```
计数：`| wc -l` → `6`；`-rl` → `3`。**声明条数：6 命中行 / 3 文件**。

**检索命令 K2b —— plan §K2 原文（marker 面）**（仅 `grep` → `command grep`）：

```bash
command grep -rln "sectionConfigs\|SHARED SECTION" --include="*.mjs" --include="*.md" --include="*.yaml" . 2>/dev/null \
  | command grep -v node_modules | command grep -v "^./specs/277"
```
原始输出（37 文件，全量）：
```
./.codex/skills/spec-driver-{doc,feature,fix,implement,refactor,resume,story,sync}/SKILL.md      （8）
./AGENTS.md
./CLAUDE.md
./plugins/spec-driver/agents/{implement,plan,specify,tasks}.md                                    （4）
./plugins/spec-driver/scripts/lib/product-scorecard-core.mjs
./plugins/spec-driver/skills-codex/spec-driver-{doc,feature,fix,implement,refactor,resume,story,sync}/SKILL.md  （8）
./plugins/spec-driver/skills/spec-driver-{doc,feature,fix,implement,refactor,resume,story,sync}/SKILL.md        （8）
./plugins/spec-driver/templates/agent-output-discipline.md
./scripts/sync-agent-docs.mjs
./specs/084-harness-native-integration/{plan,spec,tasks}.md                                        （3）
./specs/239-worktree-local-state/research/tech-research.md
```
（花括号是本文件的折叠写法，原始输出逐文件一行；折叠前后文件数相同。）计数：`| wc -l` → `37`；同管道 `-rln` 改 `-rn` 后 `| wc -l` → `215`。**去掉自指排除管道**（与 plan 的 ugrep 空转口径对齐）：文件 `51`、命中行 `317`（`command grep -rln … | command grep -v node_modules | wc -l` → `51`；`-rn` → `317`）。**声明条数：37 文件 / 215 命中行（不含 `specs/277`）；51 文件 / 317 命中行（含 `specs/277` 自指，其中自指 14 文件）**。

**检索命令 K2c —— 由 `key` 派生的 marker 块名逐 key 计数（对 `targets` 的派生一致性）**：

```bash
for k in <15 个 key>; do command grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=specs --exclude-dir=dist "<!-- BEGIN SHARED SECTION: $k -->" . | wc -l; done
```
原始输出（15 行）与 `targets` 对照：

| key | `targets` 声明 | BEGIN marker 文件实测 | 派生公式 | 一致 |
|---|---|---|---|---|
| branch-sync-policy | 2 | 4 | 2 × 1 + 测试 fixture 2（`tests/unit/product-scorecard-core.test.ts`、`tests/integration/spec-driver-product-scorecards.test.ts`） | ✅ |
| mainline-focus / context-layering / release-contract / repo-maintenance / behavior-rules / code-quality / orchestration-overrides / eval-credentials-policy / dogfooding-policy | 各 2 | 各 2 | 2 × 1 | ✅（9 行） |
| orchestrator-gate-mounting-guard | 5 | 15 | 5 × 3 拷贝 | ✅ |
| agent-output-discipline | 4 | 4 | 4 × 1（`agents/*.md` 无 wrapper 拷贝） | ✅ |
| gate-tasks-scope-cut-acceptance | 7 | 21 | 7 × 3 | ✅ |
| gate-design-convergence-loop | 4 | 12 | 4 × 3 | ✅ |
| gate-verify-matrix-recompute | 8 | 24 | 8 × 3 | ✅ |

派生一致 15 ÷ 15 = 100%（单位：entry）。拷贝系数 3 = `plugins/spec-driver/skills` 源 + `skills-codex` 分发副本 + `.codex/skills` wrapper（K2b 输出中三组各 8 份可核）。本卡新增注入点 = 5 + 4 + 7 + 4 + 8 = **28**（单位：注入点，按源 target 计，不计拷贝），与 `tasks.md:274` 追加记录「注入点 20 → 28」一致；含拷贝的 marker 文件数 = 15 + 4 + 21 + 12 + 24 = 76（单位：文件，与 28 不是同一单位、不相加）。硬编码消费方 `plugins/spec-driver/scripts/lib/product-scorecard-core.mjs:723-724` 只钉 `branch-sync-policy` 一个 key（`command grep -n "BEGIN SHARED SECTION" plugins/spec-driver/scripts/lib/product-scorecard-core.mjs` → `:723 / :724`），与本卡 5 个新 key 不相交。

### 3.2 与 `plan.md` §reverse-census 对应行（K2）的核对

**plan §K2 登记值**（`sed -n '576,606p' specs/277-spec-driver-engine-hardening/plan.md`）：「**计数：12 文件 / 88 命中行**」、生效面 4 文件、处置「**+4 entry**（Phase C 3 个 + 裁定 D-③ 1 个）」、新增注入点 20。

**plan 当时值是否在其自身 commit 上成立（C-9，同 §1.2 的只读 archive）**：K2b 命令在 `e01611b2` archive 上 → 文件 `8`、命中行 `52`。plan 的 12 文件 = 8 tracked + 4 份当时**未跟踪**的 `specs/277-*` 自指文件（其 ugrep 排除管道空转，plan §执行环境声明 第 1 条已自述）：8 + 4 = 12 ✅ 文件口径可复现。命中行 88 = 52（tracked）+ 36（归于 4 份未跟踪自指文件；archive 不含未跟踪文件，**该 36 无法从 archive 独立复算**，只作差额登记）。

**现树**：不含自指 37 文件 / 215 行；含自指 51 文件 / 317 行（§3.1 K2b）。entry 15（+5）。

**逐项核对**：

| 项 | plan 登记 | 现树实测 | 结论 |
|---|---|---|---|
| entry 增量 | +4（K2 行冻结正文） | +5（15 − 10） | **一致（经追加记录）**：第 5 个 `gate-verify-matrix-recompute` 已由 `plan.md:1914-1916`「### B + D 对抗修订登记（编排器 2026-09-07，追加式）」登记（原文「`sync-agent-docs.mjs` 第 5 个 entry；targets = 8 份 SKILL 的 GATE_VERIFY 段」），4 + 1 = 5，符合 T121 追加口径 |
| 消费方文件（同口径含自指） | 12 | 51 | **不一致（时序性）**：+39 = 非自指 +29（SKILL 8 × 3 拷贝 = 24 + `agents/*.md` 4 + `templates/agent-output-discipline.md` 1）+ 自指 +10（4 → 14，含本文件） |
| 消费方命中行 | 88 | 317 | 不一致（时序性） |
| 生效面 | 4 文件 | 4 + 29 = 33 文件（不含自指与历史 spec 4 份） | 不一致（时序性）：29 份就是本卡的注入面本身 |
| 新增注入点 | 20（K2 行）→ 28（`plan.md:1916` / `tasks.md:274` 追加） | 28（§3.1 K2c 换算式 5 + 4 + 7 + 4 + 8） | **一致（经追加记录）** |
| 硬编码消费方 `product-scorecard-core.mjs:723-724` | 已登记 | 在场，只钉 `branch-sync-policy` | 一致 |

**核对结论：entry 数与注入点数一致（经追加记录）；文件 / 命中行 / 生效面计数不一致（时序性漂移）**。按 FR-028 对冻结的 K2 行在现树复算：声明 12 ≠ 实测 51（或 37）→ 今日会被判阻断；处置同 §1.2，走 T121 追加（原取值 12 文件 / 88 行 / 生效面 4；新取值 51（含自指 14）或 37（不含）文件 / 317 或 215 行 / 生效面 33），本文件不改写 plan 正文。

## 一致性校验的执行体（T041 落成物的实际形态）

**T041 落成物的形态**（`tasks.md:142` T041 = 「`agents/plan.md` 的 FR-028 一致性校验：写入 … 校验与不一致时的阻断口径」）：

```bash
sed -n '304,312p' plugins/spec-driver/agents/plan.md
```
原始输出（摘）：
```
#### FR-028 一致性校验（阻断口径）

**判据**：本章节**每一行声明的条数**必须 **== 该行检索命令的实际输出计数**。

- **计数不符时必须报出不符并阻断**，返回失败、不得进入实现阶段。该一致性校验是本产物具备捕获力的判据，**缺失即视为该产物为摆设**。
- 三个计数单位（命中行 / 文件 / 取值出现处）**分列、不得相加**；总换算式逐项写出并**独立复算**……
- **本校验的能力边界必须同处写明，不得被口径为「已解决」**……
```
`agents/plan.md:381`（失败处理）：「关键量反向普查存在**声明条数 ≠ 检索命令实际输出计数**的行 → 返回失败，逐行列出声明值 / 实测值 / 该行命令原文」。模板侧 `plugins/spec-driver/templates/specify-base/plan-template.md:118`：「**声明条数 == 该行检索命令的实际输出计数**——**计数不符时必须报出不符并阻止进入实现阶段**」；同文件 `:117` 第 2 项：「**原始输出**——附该命令的原始输出（**或其计数**）」。

**仓内有无机械执行体**：

```bash
command grep -rln "声明条数\|反向普查\|reverse-census\|reverseCensus" scripts plugins tests --include='*.mjs' --include='*.ts' 2>/dev/null
```
原始输出（2 行）：`plugins/spec-driver/tests/fix-compliance-core.test.mjs` / `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`。唯一 `.mjs` 命中在 `fix-compliance-core.mjs:562` 注释「…F270 P2 锚点三分，reverse-census §6…」——是 F270 对其**自身** reverse-census 章节的引用，**不是** FR-028 校验的实现。→ **T041 落成物是 prompt 散文，仓内不存在 FR-028 的机械执行体（0 个，单位：实现文件）**。

**本演示的执行体**（scratchpad `d4/census-check.mjs`，不入库；核心逻辑逐字）：

```js
const out = execFileSync('zsh', ['-c', row.command], { cwd: CWD, encoding: 'utf8' });
const actualList = out.split('\n').filter((l) => l.length > 0);
const actual = actualList.length;
const listCount = row.list.length;
const a = row.declared === actual;          // (a) FR-028 原文判据：声明条数 == 命令实际输出计数
const b = listCount === actual;             // (b) 清单条数 == 命令实际输出计数（T116 期望报错语的口径）
const c = row.declared === listCount;       // (c) 声明条数 == 清单条数（内部一致）
const missing = actualList.filter((l) => !row.list.includes(l));   // 清单缺失的真实消费点
const ok = a && b && c;
if (!ok) console.log(`       清单条数与命令计数不符 —— 命令原文: ${row.command}`);
if (failed > 0) { console.log(`阻断：${failed} 行不符，不得进入实现阶段`); process.exit(1); }
```
它把散文判据 (a) 机械化，并额外做 (b)(c) 与缺失项定位。**判定归属**：M1 / M2 的「被发现」是**本执行体**报出的；生产链路上「谁执行 FR-028」= plan 子代理按散文自行复算，「谁阻断」= 编排器承认「返回失败」——两者都不是机械强制（见 §测不到 第 3 条）。

## 缺口注入实验（临时目录副本 · 不碰工作树）

### 初始校验

**副本清单的生成**（C-4 `census-snapshot.mjs`）：对 §1.1 / §2.1(a) / §3.1 K2a / K2b 四条命令各跑一次，原始输出逐行存为 `list`，`declared` = 该次行数；写入 scratchpad `d4/census.json`（不在工作树内，源树只读）。

```bash
node <scratch>/d4/census-snapshot.mjs "$PWD" <scratch>/d4/census.json
```
原始输出：
```
K1-tools-key: declared=20 (命中行)
K2a-sectionConfigs-consumers: declared=6 (命中行)
K2b-shared-section-marker-files: declared=37 (文件)
KA-delegation-anchor-headings: declared=45 (命中行)
```
（与 §1.1 / §2.1 / §3.1 的交互式计数逐项相同——§执行环境声明 第 3 条。）

**初始校验**：

```bash
node <scratch>/d4/census-check.mjs "$PWD" <scratch>/d4/census.json; echo "exit=$?"
```
原始输出：
```
[PASS] K1-tools-key: 声明=20 清单=20 实测=20 (命中行)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
[PASS] K2a-sectionConfigs-consumers: 声明=6 清单=6 实测=6 (命中行)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
[PASS] K2b-shared-section-marker-files: 声明=37 清单=37 实测=37 (文件)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
[PASS] KA-delegation-anchor-headings: 声明=45 清单=45 实测=45 (命中行)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
全部行一致，校验通过
exit=0
```
**结论：初始校验通过**（一致行数 ÷ 关键量行数 = 4 ÷ 4 = 100%，单位：关键量行；退出码 0）。

### 变异 M1 · 删去一个真实消费点并同步改声明条数

**构造**（对 `census.json` 的副本，每行删去一个真实消费点并把 `declared` 减 1——模拟「普查时漏盘一个消费点」的诚实形态：清单少一行、声明数也少一）：

| 行 | 被删去的真实消费点 |
|---|---|
| K1-tools-key | `./scripts/lib/agent-tools-core.mjs:244:      toolsByAgent[agent] = … extractFrontmatterTools(content);`（本卡新建的消费方 ④） |
| K2a-sectionConfigs-consumers | `tests/unit/agent-docs-sd-mode-guard.test.ts:24:import { …, sectionConfigs, … }` |
| K2b-shared-section-marker-files | `./plugins/spec-driver/scripts/lib/product-scorecard-core.mjs`（硬编码消费方） |
| KA-delegation-anchor-headings | `plugins/spec-driver/skills/spec-driver-resume/SKILL.md:336:## 恢复后执行流程`（真实注入锚点） |

构造脚本核心：`list = r.list.filter(l => !victim(l)); declared = list.length`（每行断言恰少 1 条，否则抛错）；原始输出 `M1 rows: K1-tools-key:19/19 | K2a-sectionConfigs-consumers:5/5 | K2b-shared-section-marker-files:36/36 | KA-delegation-anchor-headings:44/44`（声明 / 清单）。

**重跑校验**：

```bash
node <scratch>/d4/census-check.mjs "$PWD" <scratch>/d4/census-M1.json; echo "exit=$?"
```
原始输出：
```
[FAIL] K1-tools-key: 声明=19 清单=19 实测=20 (命中行)  (a)声明==实测:false (b)清单==实测:false (c)声明==清单:true
       清单条数与命令计数不符 —— 命令原文: command grep -rn "parseFrontmatterTools\|extractFrontmatterTools\|toolKeysFromAgentTools" --include="*.mjs" --include="*.ts" . 2>/dev/null | command grep -v node_modules | command grep -v '^\./dist/' | command grep -v '^\./\.codex/'
       清单缺失的真实消费点: ./scripts/lib/agent-tools-core.mjs:244:      toolsByAgent[agent] = content === null ? null : extractFrontmatterTools(content);
[FAIL] K2a-sectionConfigs-consumers: 声明=5 清单=5 实测=6 (命中行)  (a)声明==实测:false (b)清单==实测:false (c)声明==清单:true
       清单条数与命令计数不符 —— 命令原文: command grep -rn "sectionConfigs" scripts plugins tests --include='*.mjs' --include='*.ts' 2>/dev/null
       清单缺失的真实消费点: tests/unit/agent-docs-sd-mode-guard.test.ts:24:import { checkSdModeDeclaration, sectionConfigs, validateSharedAgentDocs } from '../../scripts/sync-agent-docs.mjs';
[FAIL] K2b-shared-section-marker-files: 声明=36 清单=36 实测=37 (文件)  (a)声明==实测:false (b)清单==实测:false (c)声明==清单:true
       清单条数与命令计数不符 —— 命令原文: command grep -rln "sectionConfigs\|SHARED SECTION" --include="*.mjs" --include="*.md" --include="*.yaml" . 2>/dev/null | command grep -v node_modules | command grep -v "^./specs/277"
       清单缺失的真实消费点: ./plugins/spec-driver/scripts/lib/product-scorecard-core.mjs
[FAIL] KA-delegation-anchor-headings: 声明=44 清单=44 实测=45 (命中行)  (a)声明==实测:false (b)清单==实测:false (c)声明==清单:true
       清单条数与命令计数不符 —— 命令原文: command grep -rn -e "## 工作流定义" -e "## 工作流执行（动态模式）" -e "## 恢复后执行流程" plugins/spec-driver .codex scripts tests --include='*.md' --include='*.mjs' --include='*.ts' 2>/dev/null
       清单缺失的真实消费点: plugins/spec-driver/skills/spec-driver-resume/SKILL.md:336:## 恢复后执行流程
阻断：4 行不符，不得进入实现阶段
exit=1
```
**结论：缺口被发现 4 ÷ 4 = 100%**（单位：被注入缺口的关键量行）。FR-028 原文判据 (a) 与清单口径 (b) 均报出，逐行给出声明值 / 实测值 / 命令原文（`agents/plan.md:381` 失败处理要求的三项）并点名被删消费点；退出码 1 = 阻断。

### 变异 M2 · 删去一个真实消费点但保留原声明条数

**构造**：仅对 K1 行删去同一消费点（`agent-tools-core.mjs:244`），**保留** `declared = 20`（清单 19 行）——模拟「清单被删行而声明数未同步」的形态；其余三行不动。原始输出 `M2 rows: K1-tools-key:20/19 | K2a-sectionConfigs-consumers:6/6 | K2b-shared-section-marker-files:37/37 | KA-delegation-anchor-headings:45/45`。

**重跑校验**：

```bash
node <scratch>/d4/census-check.mjs "$PWD" <scratch>/d4/census-M2.json; echo "exit=$?"
```
原始输出：
```
[FAIL] K1-tools-key: 声明=20 清单=19 实测=20 (命中行)  (a)声明==实测:true (b)清单==实测:false (c)声明==清单:false
       清单条数与命令计数不符 —— 命令原文: command grep -rn "parseFrontmatterTools\|extractFrontmatterTools\|toolKeysFromAgentTools" --include="*.mjs" --include="*.ts" . 2>/dev/null | command grep -v node_modules | command grep -v '^\./dist/' | command grep -v '^\./\.codex/'
       清单缺失的真实消费点: ./scripts/lib/agent-tools-core.mjs:244:      toolsByAgent[agent] = content === null ? null : extractFrontmatterTools(content);
[PASS] K2a-sectionConfigs-consumers: 声明=6 清单=6 实测=6 (命中行)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
[PASS] K2b-shared-section-marker-files: 声明=37 清单=37 实测=37 (文件)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
[PASS] KA-delegation-anchor-headings: 声明=45 清单=45 实测=45 (命中行)  (a)声明==实测:true (b)清单==实测:true (c)声明==清单:true
阻断：1 行不符，不得进入实现阶段
exit=1
```
**结论：缺口被发现，但只被 (b) / (c) 发现；FR-028 原文判据 (a) 对 M2 恒真**。判据文本（`agents/plan.md:306`「本章节**每一行声明的条数**必须 **== 该行检索命令的实际输出计数**」）比较的是**声明数字**与**命令实测**，不要求执行者数清单行数；`plan-template.md:118` 第 2 项还允许「附该命令的原始输出（**或其计数**）」——清单可被计数替代时，M2 型缺口（清单少一行、数字不动）在该口径下**结构性不可检**。这不是本卡引入的回归（FR-028 判据本就如此），但须登记为 FR-028 判据的一条已知盲区：**判据 (a) 只抓「声明数与实测不符」，抓不到「清单与声明数不符」**；执行者若只按 (a) 复算，M2 会静默通过。本演示报出它，靠的是执行体额外做的 (b)(c)。

## FR-028 登记的两个未盘点消费方核对

### (a) `templates/preference-rules.md:6` 的过滤渲染（复核 V-1 的命令）

**自述原文**（`sed -n '6p' plugins/spec-driver/templates/preference-rules.md`）：
```
> 1. **5 个 sub-agent**（`agents/{plan,implement,verify,spec-review,quality-review}.md`）——由 `scripts/sync-preference-rules.mjs --write` 按各 agent frontmatter `tools` **过滤渲染**后嵌入 `<!-- BEGIN preference-rules -->` / `<!-- END preference-rules -->` 之间
```
（第 5 行「消费方（三处，禁止各自手写漂移）」；第 7 行第 2 项为 5 个 SKILL 的散文引用；第 8 行第 3 项为 F170d harness，见 (b)。）

**V-1 的复核命令**：`npm run repo:check`（输出落 `<scratch>/repo-check.txt`，尾行追加 `exit=$?`）。原始输出摘：
```
[repo-check] status=warn
- agent-docs:shared-section:branch-sync-policy: pass
…（agent-docs:shared-section:* 共 15 项全 pass，含本卡 5 个新 key）
- preference-rules:agent-block-sync: pass
- delegation-contract:skill-block-sync: pass
- delegation-contract:codex-wrapper-block-sync: pass
- namespace-consistency:agent-frontmatter-plan: pass
- namespace-consistency:agent-frontmatter-implement: pass
- namespace-consistency:agent-frontmatter-verify: pass
- namespace-consistency:agent-frontmatter-spec-review: pass
- namespace-consistency:agent-frontmatter-quality-review: pass
- agent-tools:required: pass
- worktree-local-state:agents-byte-budget: pass

warnings:
  - [graph-quality] 图产物已 stale（source-commit）：source-commit：图记录的 sourceCommit（64b1d72f3f037cc104eb69d10ed9ee78f181f631）与当前 HEAD（d86fa332a15a1099d32c9057e6409352547c2fc0）不一致。请重新运行 `spectra batch --mode graph-only` 重建图。
exit=0
```
`command grep -c "^- " <scratch>/repo-check.txt` → `95`（check id 总数，与 `tasks.md:274` 追加记录「94 → 95」一致）；唯一非 pass 为 `graph-quality:freshness: warn`（图 stale，与本卡无关，plan V-P2 同样登记）。

**运行时旁证（C-8：plan §K1 探针在现树复跑，只读、内存内）**。现树 3 份 agent 的 `tools` 行已**真实**含 `Edit, Bash`：

```bash
for a in specify plan tasks verify; do printf "%s: " $a; command grep -m1 '^tools:' plugins/spec-driver/agents/$a.md; done
```
```
specify: tools: [Read, Write, Edit, Bash, Grep, Glob]
plan: tools: [Read, Write, Edit, Bash, Grep, Glob, mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]
tasks: tools: [Read, Write, Edit, Bash, Grep, Glob]
verify: tools: [Read, Bash, Grep, Glob, mcp__plugin_spectra_spectra__detect_changes, mcp__plugin_spectra_spectra__impact]
```
对现文件跑 `renderInjectionBlock(tpl, parseFrontmatterTools(cur))` 的 sha256 前 16 位（`node --input-type=module -e …`，只读）：
```
specify: frontmatter_has_Edit_and_Bash=true parsed_mcp_tools=[] render_sha=a3edf994282422fd
plan: frontmatter_has_Edit_and_Bash=true parsed_mcp_tools=["mcp__plugin_spectra_spectra__context","mcp__plugin_spectra_spectra__impact"] render_sha=dadf4b62108f9939
tasks: frontmatter_has_Edit_and_Bash=true parsed_mcp_tools=[] render_sha=a3edf994282422fd
implement: frontmatter_has_Edit_and_Bash=true parsed_mcp_tools=["mcp__plugin_spectra_spectra__context","mcp__plugin_spectra_spectra__impact"] render_sha=dadf4b62108f9939
```
与 plan §K1 变异探针在**增列前**取得的 `a3edf994282422fd` / `dadf4b62108f9939` 逐字相同 → 真实增列后渲染输出逐字节不变；`parsed_mcp_tools` 显示解析器只回收 `mcp__plugin_spectra_spectra__*`，`Edit` / `Bash` 不进入过滤键。

**「自述三处」与实测消费方数的核对（不照抄自述）**：

```bash
command grep -rn "preference-rules.md" scripts plugins tests --include='*.mjs' --include='*.ts' 2>/dev/null
```
原始输出 11 行 / 5 文件（`| wc -l` → `11`；`-rl` → `5`）：`scripts/feature-170d-driver-preference.mjs:41`（`TEMPLATE_PATH`）、`plugins/spec-driver/scripts/sync-preference-rules.mjs:3 / :28 / :74 / :79 / :103`、`plugins/spec-driver/lib/preference-rules.mjs:4 / :14`（marker 字符串）、`tests/unit/spec-driver/feature-170d-preference-rules.test.ts:16 / :160`、`tests/unit/spec-driver-implement-notes-contract.test.ts:137`。其中**按 `tools` 过滤渲染的生产消费方 = 2**（`sync-preference-rules.mjs`、`feature-170d-driver-preference.mjs`；lib 是二者共用的渲染器，不独立读 agent 文件）；自述第 2 项（5 个 SKILL 散文引用路径）是 `.md` 引用、不做过滤。自述「三处」与实测「2 个过滤消费方 + 1 类散文引用」口径可对上，但**自述条数不等于「按 `tools` 过滤的脚本数」**，后者实测为 2（与 A-5 的 2 ÷ 2 同源）。

**结论**：(a) 已核。V-1 命令实跑：5 项 `agent-frontmatter-*` 与 `preference-rules:agent-block-sync` 全 pass；渲染哈希与增列前相同。V-1「证伪其影响」的结论在现树成立。

### (b) F170d harness 的 `--append-system-prompt` 注入（按 A-5 命令核实际过滤逻辑）

**A-5 的证实 / 证伪命令**（spec §A-5 原文逐字，仅 `grep` → `command grep`）：

```bash
command grep -nE 'frontmatter|tools|parseFrontmatterTools|toolKey' plugins/spec-driver/scripts/sync-preference-rules.mjs scripts/feature-170d-driver-preference.mjs
```
原始输出（9 行，全量；退出码 0）：
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

**实际过滤逻辑（读源码，不照抄自述）**：

- `scripts/feature-170d-driver-preference.mjs:87-93`（`sed -n '86,93p'`）：`buildInjectionBlock(agent = 'implement')` 读 `plugins/spec-driver/agents/${agent}.md` → `parseFrontmatterTools(agentText)` → `renderInjectionBlock(templateText, tools)`。调用点 `:220 const systemPrompt = buildInjectionBlock(opts.agent);`（`command grep -n "buildInjectionBlock(" scripts/feature-170d-driver-preference.mjs` → `:87` 定义 / `:220` 调用），`agent` 来自 CLI 选项 → **过滤对象是目标 agent 的 frontmatter**；随后 `:81 '--append-system-prompt', systemPrompt` 注入。
- `plugins/spec-driver/lib/preference-rules.mjs:52-57`：`parseFrontmatterTools` 以 `/^tools:\s*\[(.*)\]/m` 取**单行**行内数组，再只回收 `mcp__plugin_spectra_spectra__\w+`；`:43-49 toolKeysFromAgentTools` 去前缀得 `{impact, context, detect_changes}` 子集；`:67-91 renderInjectionBlock` 的过滤分支在 `:82 if (keys.has(tool)) out.push(rowLine);`。
- 过滤键 = 目标 agent frontmatter `tools` 中的 spectra MCP 子集，**不是 `tools` 数组本身**（plan §K1 已登记此额外事实）；`Edit` / `Bash` 不参与。

**结论**：按 `tools` 过滤的脚本数 ÷ 自述声明的脚本数 = 2 ÷ 2 = 100%（单位：脚本）→ A-5 PASS（与 D-8 §A-5 为同一次实跑）。**登记状态更正**：FR-028 / T116 写的「F170d harness 仍未盘点」是 spec 阶段口径；plan §K1（2026-09-04）已把 `feature-170d-driver-preference.mjs:34 / :90` 列为消费方 ② 并按 A-5 命令核过，本演示于现树再核一次并读了实际过滤分支，属**再核实**而非首次补盘。T116「未补进即判本演示未达成」的条件据此满足。

## 通过条件逐字复核

| 通过条件原文（`tasks.md:325`） | 复核 | 依据 |
|---|---|---|
| 「**注入缺口后必须被发现**。若删掉一行也发现不了，说明该产物只是摆设，本演示判不通过（FR-028）。」 | ✅ | §M1：4 ÷ 4 行报出、退出码 1；§M2：报出（经 (b)/(c)）。⚠️ 附带发现：FR-028 原文判据 (a) 单独对 M2 恒真（F-4） |
| 「同时须显式记录该演示**测不到**的部分：它验不了『该申报的关键量是否都申报了』（见能力边界声明 B-1；其可测的经验命题部分见 A-3）。」 | ✅ | §测不到 第 1 条；活例见 §1.2（申报时点早于消费方）与 §2.2（未申报） |
| 期望输出「初始校验通过；删去一个消费点后报出『清单条数与命令计数不符』并**阻止进入实现阶段**」 | ✅ / ⚠️ | §初始校验 exit 0；§M1 逐字报出「清单条数与命令计数不符」+ exit 1。⚠️「阻止进入实现阶段」在生产链路上 = `agents/plan.md:381` 失败处理散文 + 编排器承认该失败，**不是机械强制**；本演示的 exit 1 来自 scratchpad 执行体（§执行体） |
| 「另须核对 FR-028 登记的两个未盘点消费方 … 补全时须以推断前提 A-5 的证实 / 证伪命令核对两个脚本的**实际过滤逻辑**，不得照抄自述条数充数；未补进即判本演示未达成。」 | ✅ | §未盘点 (a)(b)：V-1 命令实跑 + 现树渲染哈希；A-5 命令实跑 + 过滤分支行号；自述条数与实测分开核 |
| 「**自证循环声明**：被检对象是本卡自身改动的关键量，**通过不构成该检查在他人产物上同样有效的证据**」 | ✅ | §测不到 第 5 条 |
| 执行步骤「对每个关键量跑一次真实普查产出『检索命令 + 消费点清单 + 声明条数』→ 核对声明条数 == 命令实际输出计数」 | ✅ | §1.1 / §2.1 / §3.1 三个关键量各附命令原文 + 全量输出 + 分单位计数；与 plan 对应行核对见 §1.2 / §2.2 / §3.2（两条不一致（时序性）、一条缺席，均如实报出、未改写 plan） |

## 测不到的部分与自证循环声明

1. **B-1（恒真）**：一致性校验的输入就是申报集合，验不了「该申报的关键量是否都申报了」。本演示的三个关键量由 T116 点名，不是由任何机械手段派生；本演示的两个活例——§2.2 锚点名在 plan 无 K 行（未申报即不可见）、§1.2 消费方 ④ 在 plan 时点尚不存在（申报早于消费方产生）——都**不是** FR-028 校验报出的，是回跑普查时人工发现的。A-3 的可测部分（粗提法能否抓到未申报候选）在 D-8 §A-3 实跑，其结论不改变 B-1。
2. **命令选择即申报**：每行的检索命令本身也是执行者自选的。K1 的模式只含 3 个函数名，任何用自有正则解析 `tools:` 行而不调用这三个函数的消费方对该命令不可见；本演示没有构造这类消费方去测命令的漏检面。
3. **执行体的存在性**：仓内没有 FR-028 的机械执行体（§执行体），本演示用 scratchpad 执行体证明「判据一旦被机械执行就有捕获力」，**不证明** plan 子代理会执行该判据，也不证明编排器会因其失败处理而停下——这两点属 A-2 型「写进正文后是否被遵守」的问题，本演示测不到。
4. **M2 型缺口在 FR-028 原文口径下不可检**（§M2）：判据 (a) 与 `plan-template.md:118`「或其计数」的允许项叠加，使「清单少一行、数字不动」结构性通过；本演示报出它靠的是执行体额外做的 (b)(c)。
5. **自证循环声明**：被检对象（`tools` 键 / 注入锚点名 / `sectionConfigs` 三字段与 marker 块名）是本卡自身改动或触及的关键量，检索命令与执行体也由本卡的验证子代理编写；本演示通过，**不构成该检查在他人产物上同样有效的证据**，也不构成 FR-028 判据在无执行体时具备任何捕获力的证据。
6. **时序悖论登记**（Edge Case 18 / T121）：本演示在 implement 之后回跑，被检的 plan §reverse-census 产于 implement 之前；§1.2 / §3.2 报出的两处不一致属该悖论的实证，处置只能是追加修订记录，本文件未改写 plan。

## 最终判定

**通过**（D-4 的通过条件各项全部成立，见 §通过条件），附 4 条须由编排器处置的发现：

| # | 发现 | 类别 | 建议处置 |
|---|---|---|---|
| F-1 | plan §K1 冻结行「11 行 / 5 文件」在现树实测 20 行 / 7 文件（+ 本卡新建消费方 ④ `agent-tools-core.mjs` 与其测试）；11 / 5 在 `e01611b2` archive 可复现 | 不一致（时序性） | T121 追加「冻结后修订记录」（原取值 / 新取值 / 发现者 D-4 / 2026-09-07） |
| F-2 | plan §K2 冻结行「12 文件 / 88 行 / 生效面 4」在现树实测 51（含自指 14）/ 317 / 生效面 33；entry +4 → +5 与注入点 20 → 28 已由 `plan.md:1914-1916` 追加登记 | 不一致（时序性，部分已追加） | 同上，补文件 / 命中行 / 生效面三项 |
| F-3 | SKILL 注入锚点名在 plan 无 K 行；本卡改了其全部 5 份承载 SKILL，属 K15 型回归面 | 缺席（B-1 活例） | 追加登记为「不改 · 回归面由 `delegation-contract` 两项守护」 |
| F-4 | FR-028 判据 (a) 对 M2 型缺口恒真；`plan-template.md:118`「或其计数」使清单可被数字替代 | 判据盲区（非本卡回归） | 登记为 FR-028 已知盲区；收口须把「原始输出逐行在场且行数 == 声明数」写入判据（后续卡，本卡不改） |

计数汇总（单位分列）：关键量 3 个；检索命令 5 条（K1 / KA-a / KA-b / K2a / K2b）+ 派生一致性核对 1 条（K2c，15 entry）；变异 2 型（M1 四行、M2 一行）；被注入缺口 5 处（M1 4 + M2 1），报出 5 ÷ 5 = 100%（单位：缺口处；其中 1 处仅经 (b)/(c) 报出）。工作树在本演示前后均未被本演示改动（`git status --porcelain` 中本演示只新增本文件与 `e-d8-inferred-premises-runtime.md` 两个未跟踪文件；其余变更来自并行的编排器 / 其他 Phase E 子代理）。
