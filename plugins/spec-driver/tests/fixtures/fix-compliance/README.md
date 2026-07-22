# fix-compliance 测试 fixture 索引

手工构造的最小 transcript JSONL 片段（每行一个 Claude Code 会话 envelope 对象），供
`fix-compliance-core.test.mjs` / `fix-compliance-io.test.mjs` 断言判定逻辑。**不含真实敏感数据**。

envelope 结构参照 research.md「实测校准记录（T001）」：顶层 `type: "user"|"assistant"`；
`message.content` 为字符串或内容块数组；文本块 `{type:"text",text}`；工具调用块
`{type:"tool_use",name,input}`（assistant）；工具结果 `{type:"tool_result",...}`（挂 user，反伪造排除对象）。

## fixture 命名与用途

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `collapsed-zero-delegation.jsonl` | fix 展开 + 0 委派 + 无制品 + 纯文本收口（F206 核心坍塌） | 不合规（undetermined） |
| `compliant-full.jsonl` | fix 展开 + implement+verify 委派 + fix-report.md(Root Cause)+verification-report.md | 合规（repair） |
| `compliant-noop.jsonl` | fix 展开 + 1 次 no-op 核实类委派 + no-op 报告(判定依据 + `### 复现对账` 单行 JSON + 配对真实 Bash 执行 + 末行 PASS sentinel)（T016 回归护栏升级） | 合规（no-op） |
| `noop-zero-delegation.jsonl` | no-op 报告但 0 委派 | 不合规（缺 delegation:noop-verify） |
| `malformed-transcript.txt` | 损坏/非 JSON | FR-013 fail-open |
| `placeholder-shell.jsonl` | 判定依据章节仅含 `{...}` 占位符 + 1 no-op 委派 | 不合规（artifact:placeholder） |
| `role-mismatch.jsonl` | 仅 1 次非 implement/verify 类委派冒充完整收口 | 不合规（缺角色委派） |
| `multi-expansion.jsonl` | feature 展开后再 fix 展开（含 fix 前的历史委派） | 最新展开=fix，仅统计 fix 锚点后委派 |
| `non-fix-session.jsonl` | 仅 feature 展开 | 非 fix 会话，零接触 |
| `fake-anchor-in-tool-result.jsonl` | tool_result 内伪造 spec-driver-story 展开痕迹 | 反伪造：锚定仍为 fix |
| `compliant-full-canonical-chinese-no-subagent-type.jsonl` | 中文 description + 无 subagent_type 的完整合规 | 合规（防假阻断回归） |
| `role-mismatch-plan-tasks-fix-word.jsonl` | plan/tasks 委派 desc 含「修复」但非「代码修复」 | 不归 implement 类（窄模式精确切分） |
| `real-bash-transcript-claude.jsonl` | **FR-017 真实 Claude Bash use/result 字段锚点**（sentinel 场景）；runtime=Claude Code · CLI 2.1.215 · 采集 2026-07-20 · content 形态=string · 未暴露数字退出码 | 字段路径参照（非判定用例，W6） |
| `real-bash-transcript-codex.jsonl` | **Codex rollout schema 差异记录**（`custom_tool_call`/`custom_tool_call_output` 形态，与 Claude 不同构）；runtime=Codex · 采集 2026-07-20 · 非判定输入、待 M9 A3 | 文档性参照（不参与 C4 裁决，不要求 `name==='Bash'`） |

## F216 Phase 2 判据 fixture（合成，非真实采集）

> 结构：`## 判定依据` 散文 + `### 复现对账` 单行 JSON bullet，均以 Write `fix-report.md` 的 `input.content` 内嵌；复现命令另配 Bash `tool_use`/`tool_result`，recon.command 与 Bash `input.command` 逐字节一致以供保守规范化精确匹配。

### T007 · 解析与 malformed 系列

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `noop-recon-malformed-row.jsonl` | `### 复现对账` 区块含一条坏 JSON 候选行（缺逗号） | `noop:repro-fields`（malformed 不静默丢） |
| `noop-recon-one-green-one-broken.jsonl` | 两条声明：一条完整 PASS + 一条 malformed | `noop:repro-fields`（防"一绿一坏"误放行） |
| `noop-cmd-with-backtick-pipe-heredoc.jsonl` | 命令含反引号/管道/多行 heredoc/双引号/连续反斜杠（单行 JSON `\n` 编码）+ 真实执行 PASS | 绿（单行 JSON 无损承载 + 匹配 + PASS） |
| `noop-recon-malformed-enum.jsonl` | 单文件覆盖 7 种坏形态：`* ` 前缀 / `-{` 无空格 / 区块内非 bullet 正文 / `expected:"FAIL"` / `expected` 数字 / `expected` 缺失 / `claim` 空 | `noop:repro-fields`（malformedCandidateCount=7） |

### T010 · sentinel 断言与冲突系列

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `noop-output-no-sentinel.jsonl` | 执行完成但输出无合法整行末行 sentinel | `noop:repro-output-mismatch`（EC-002） |
| `noop-contradiction-fail-sentinel.jsonl` | 声称 PASS 但执行末行 FAIL sentinel | `noop:repro-contradiction` |
| `noop-long-output-truncation.jsonl` | 超大 tool_result（outputSummary 展示截断不影响判定——判定在完整 flattenedContent 上算），末行 PASS | 绿 |

### T013 · 证据集合条件并行与时序系列（C4 修正）

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `noop-result-missing.jsonl` | Bash tool_use 有但无配对 tool_result（截断） | `noop:repro-result-missing` |
| `noop-tool-error.jsonl` | Bash 执行 `is_error===true` | `noop:repro-tool-error` |
| `noop-multikey-missing-and-error.jsonl` | 单声明 E 内既 unpaired 又 is_error（条件并行） | `result-missing` + `tool-error` 同现 |
| `noop-multikey-error-and-output-mismatch.jsonl` | 单声明 E 内既 is_error 又 (paired¬error∧INCONCLUSIVE) | `tool-error` + `output-mismatch` 同现 |
| `noop-multikey-triple-missing-error-mismatch.jsonl` | 单声明 E 内同时 unpaired、is_error、INCONCLUSIVE 三类 | `result-missing` + `tool-error` + `output-mismatch` 三键同现 |
| `noop-multiexec-fail-then-pass.jsonl` | 同命令先 FAIL 后 PASS（时序 ×1） | `noop:repro-contradiction`（拒绝"任一绿即绿"） |
| `noop-multiexec-pass-then-fail.jsonl` | 同命令先 PASS 后 FAIL（时序 ×2） | `noop:repro-contradiction` |
| `noop-multiexec-pass-plus-noresult.jsonl` | 同命令一次 PASS + 一次无 result（时序 ×3） | `noop:repro-result-missing`（**C4 修正**：unpaired 独立判 result-missing，非 contradiction） |

### T016 · 判定分支端到端 + 回归护栏系列（judge-cli 层，含 EC-003/EC-007 具名断言）

> 结构同上：`## 判定依据`(+ 可选 `**Root Cause**`) 散文 + 可选 `### 复现对账` 单行 JSON bullet，均以 Write `fix-report.md` 的 `input.content` 内嵌。judge-cli 测试消费方式：将 fixture 作为 `transcript_path`，并把 Write 内嵌的 `fix-report.md`（及所需 `verification-report.md`）铺到 `--project-root` 磁盘后跑 CLI。

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `noop-unverified-citation.jsonl` | V008 形态合成：判定依据引用行号 + `### 复现对账` 声明命令但零 Bash 执行（SC-001） | `noop:repro-command-mismatch`（block exit 2） |
| `compliant-noop-with-repro.jsonl` | 诚实 no-op：单行 JSON 对账 + 真实 Bash + 唯一末行 PASS sentinel（SC-002） | 绿放行（exit 0） |
| `legacy-noop-without-repro.jsonl` | 旧形态 no-op（有判定依据但无 `### 复现对账`），FR-011 向后兼容 | `noop:repro-fields`（block exit 2） |
| `legacy-repair-no-noop-anchor.jsonl` | 旧 repair（Root Cause，无 noop 锚点），证据门零介入（FR-007） | 绿放行（证据门零介入） |
| `noop-dual-anchor-missing-repair.jsonl` | 双锚点：repro 满足但缺 repair 合同（无 implement/verify 委派、无 verification-report） | repair missing（verification-report.md/delegation:implement/delegation:verify），无 repro 键（FR-018） |
| `noop-dual-anchor-missing-repro.jsonl` | 双锚点：repair 合同满足但缺 repro 证据（无 Bash 执行） | `noop:repro-command-mismatch`，无 repair 键（FR-018） |
| `noop-dual-anchor-both-satisfied.jsonl` | 双锚点：repair + repro 两合同均满足 | 合规放行（exit 0，FR-018） |
| `noop-non-bash-tool-execution.jsonl` | **EC-007**：复现"执行"经非 Bash 工具（`mcp__custom__run`）产生，无 Bash 痕迹 | `noop:repro-command-mismatch`（MVP 按缺 Bash 痕迹处理） |
| `noop-no-repro-claims.jsonl` | **EC-003**：`## 判定依据` 存在但无任何 `### 复现对账` 子内容（症状因环境依赖无法复现） | `noop:repro-fields`（不开替代证据例外，GATE_DESIGN Q2） |

## F224 候选目录解析 fixture 系列（`resolve-` 前缀，合成）

> 只承载 transcript 侧的候选目录解析信号（改名 / 原地编辑 / 降级），不含制品内容；
> `fix-compliance-core.test.mjs` 的 F224 回归护栏按 `resolve-` 前缀把本系列排除在存量遍历之外。

| 文件 | 场景 | 期望解析结果 |
|------|------|-------------|
| `resolve-rename-git-mv.jsonl` | 制品写旧路径后 `git mv` 改名（复现 F223 实例） | `path='specs/322-fix-new'`、`ambiguous=false` |
| `resolve-rename-mv-plain.jsonl` | 同上但用裸 `mv` | `path='specs/324-fix-new'` |
| `resolve-rename-mv-flag.jsonl` | 带 flag 的裸 `mv -f` 改名（Phase 5 spec-review CRITICAL 订正） | `path='specs/352-fix-new'` |
| `resolve-rename-git-mv-flag.jsonl` | 带 flag 的 `git mv -f` 改名（同上） | `path='specs/354-fix-new'` |
| `resolve-inline-edit-sed.jsonl` | 唯一写入痕迹为 `sed -i`（无重定向符） | `path='specs/325-fix-inline'` |
| `resolve-inline-edit-perl.jsonl` | 唯一写入痕迹为 `perl -i -pe`（无重定向符） | `path='specs/326-fix-inline2'` |
| `resolve-dir-only-plan-md.jsonl` | 只写 `plan.md`/日志，从未出现制品全路径 | `path=null`、**`ambiguous=false`**（交既有严格判据硬阻断，不走 fail-open） |
| `resolve-ambiguous-rename-nonstandard.jsonl` | 候选被改名到非 `NNN-fix-<name>` 目录，**零委派** | `path=null`、`ambiguous=true`（唯一降级触发面）；CLI 端到端 **exit 2**——委派证据已足以证明坍塌，不得因目录不确定被赦免（SC-005b） |
| `resolve-ambiguous-rename-with-delegations.jsonl` | 同上改名，但含 implement + verify 收口委派 | `path=null`、`ambiguous=true`；CLI 端到端 **exit 0** + 落盘 `degraded:true` / `feature-dir-unresolvable`（唯一不确定的确实只是"制品落在哪个目录"） |
| `resolve-multi-rename-chain.jsonl` | 同一会话链式改名两次 | `path='specs/331-fix-c'`（取最终态） |
| `resolve-mixed-rename-then-inline-edit.jsonl` | 先 `git mv` 改名再 `sed -i` 修订 | `path='specs/333-fix-renamed'` |

## FR-017 真实 transcript 采集记录（Phase 0 / T001-T002）

### T001 · Claude Code Bash transcript（权威字段依据）

- **runtime**：Claude Code
- **CLI version**：`2.1.215 (Claude Code)`（`claude --version` 实测）
- **采集日期**：2026-07-20
- **采集步骤**：(1) 在真实 Claude Code 会话经 Bash 工具执行 `printf 'SPEC-DRIVER-REPRO: PASS\n'; claude --version`；(2) 定位该会话 transcript JSONL（`~/.claude/projects/<slug>/…jsonl`，本 worktree slug 含 `codex-plugin-distribution-2940d3`）；(3) 抽取该次 Bash `tool_use`（assistant）+ 配对 `tool_result`（user）最小行集；(4) 脱敏后落盘。
- **脱敏规则**：仅替换 ID 值（`tool_use.id`/`tool_result.tool_use_id` 同步替换为一致占位 `toolu_01Bash5entinelExampleAAA`，保持配对关联）与 skill base 路径（`/w/…`）；**保留 block 类型、字段位置、content 形态、`is_error` 字面量**。命令与 sentinel 输出为无害内容，原样保留以锚定真实 sentinel 形态。
- **实测观测到的 content 形态**：`tool_result.content` 为 **string**（全会话 57/57 真实 Bash 结果均为 string 形态，0 条 block-array）。block-array `content:[{type:"text",text}]` 形态在既有 `fake-anchor-in-tool-result.jsonl` 中存在（Claude envelope 通用形态），但**本次 Bash 采集未直接观测到 array 形态** → array-flatten 路径由 Phase 2 合成兼容 fixture 覆盖（标注"合成兼容，非真实观测"）。
- **是否观测到数字退出码字段**：**否**。`tool_result` block 内无任何 `exitCode`/`returnCode`/`code`/`status` 数字字段；Claude Code 附加的 `toolUseResult` sidecar 键为 `{stdout, stderr, interrupted, isImage, noOutputExpected, backgroundTaskId, gitOperation}`，**同样无数字退出码**。工具级失败仅由 `is_error`（boolean）表达。

### T002 · Codex rollout schema 差异记录（非阻断、非判定输入、待 M9 A3）

- **runtime**：Codex CLI（`~/.codex/sessions/**/rollout-*.jsonl`，采集 2026-07-20，本机存在 1247 个 rollout）
- **采集内容**：一条 `custom_tool_call`（`name==="exec"`）+ 配对 `custom_tool_call_output`，脱敏（call_id/id/turn_id 替换为一致占位、路径与输出无害化）。
- **与 Claude 形态的差异点**（本期 core 判据模型**不做** Codex 原生适配）：
  1. **顶层包裹**：Codex 为 `{timestamp, type:"response_item", payload:{…}}`；Claude 为 `{type:"user"|"assistant", message:{role, content:[…]}}`（无 payload 包裹）。
  2. **调用块**：Codex `custom_tool_call`（`name:"exec"`）vs Claude `tool_use`（`name:"Bash"`）。
  3. **命令载体**：Codex `input` 为**字符串脚本**（JS 沙箱 eval，非 shell）；Claude `input.command` 为 shell 命令字符串（`input` 是对象）。
  4. **结果块**：Codex `custom_tool_call_output.output` 为 `[{type:"input_text",text}]` **数组**；Claude `tool_result.content` 为 **string**（或通用 block-array）。
  5. **配对主键**：Codex `call_id`（`custom_tool_call.call_id ↔ custom_tool_call_output.call_id`）；Claude `tool_use.id ↔ tool_result.tool_use_id`。
  6. **错误表达**：Codex 输出块**无 `is_error` 字段**，成功/失败编码在 output 文本（`"Script completed / Wall time …"`）；Claude tool_result 有独立 `is_error` boolean。
- **结论**：Codex rollout 与本期 core 判据模型（消费 Claude Stop-hook transcript 的 `tool_use`/`tool_result`）**不同构**；F216 判定合同**仅覆盖 Claude runtime**，Codex schema 适配层留待 M9 A3（Codex 一体分发轨道）评估。**本 fixture 不阻断 T003 及后续任何 Phase。**

## F216 字段裁决记录（T003，以 Claude fixture 为准）

### (a) ExecutionRecord 字段映射冻结（真实观测）

| ExecutionRecord 字段 | transcript 字段路径（实测锚定） | 观测性质 |
|---------------------|------------------------------|---------|
| `id` | assistant `message.content[].id`（`type==='tool_use'`） | 真实观测 |
| `name` | assistant `message.content[].name`（值 `'Bash'`） | 真实观测 |
| `command` | assistant `message.content[].input.command` | 真实观测 |
| `paired` | 派生：`tool_use.id === tool_result.tool_use_id` | 真实观测（配对成立） |
| `isError` | user `message.content[].is_error`（boolean；缺 result 时 `null`） | 真实观测（`false`） |
| `flattenedOutput` | user `message.content[].content`（**string** 形态直取） | 真实观测（string）；**block-array 形态未实测，Phase 2 合成兼容 fixture 补** |
| `assertionStatus` | 派生自 `flattenedOutput` 的 sentinel 扫描 | 派生（本 fixture 末行 `SPEC-DRIVER-REPRO: PASS` → PASS） |

与 `scripts/lib/driver-eval-core.mjs` 交叉印证一致（只读对照，未 import）：其配对模型 `toolUses.push({id: block.id, name: block.name, input})` + `resultsById.set(block.tool_use_id, {isError: block.is_error === true})`，字段路径与本 fixture 逐字吻合。

### (b) C4 exitCode 分支门禁裁决 → **落分支 (b)**

- **裁决**：**分支 (b)**（SKILL wrapper 形态 + sentinel + `is_error`，非直接观测数字退出码）。
- **证据**：本次 Claude transcript **未暴露任何数字退出码字段**——57/57 真实 Bash `tool_result` block 内无 `exitCode`/`returnCode`/`code`/`status` 数字字段；`toolUseResult` sidecar（`stdout/stderr/interrupted/isImage/noOutputExpected/backgroundTaskId/gitOperation`）同样无退出码；工具级失败仅由 `is_error`（boolean）表达。故非零退出的 INCONCLUSIVE 判定须经 SKILL 强制 wrapper（`<断言> && printf 'SPEC-DRIVER-REPRO: PASS\n' || printf 'SPEC-DRIVER-REPRO: FAIL\n'`）转译，judge 侧可观测面 = sentinel + `is_error`。
- **能力边界补注状态**：落 (b) → plan.md / spec.md 的能力边界一句注记（"非零退出的 INCONCLUSIVE 判定依赖 wrapper 转译正确性"）**待编排器补写**（已于 spec.md 能力边界声明节落地）；本任务按红线未改动 plan.md / spec.md。

### (c) Codex schema 差异记录（一句）

Codex rollout 走 `custom_tool_call`/`custom_tool_call_output`（`name:"exec"`，JS 沙箱脚本 + `output` 数组 + 无 `is_error`）而非 `tool_use`/`tool_result`，本期 core 判据模型不做 Codex 原生适配，留待 M9 A3（Codex 一体分发轨道）评估是否需要 schema 适配层（详见上「T002」差异点列表）。

## 约定

- fixture 中的特性目录路径统一用 `specs/301-fix-sample-bug`（generic，非真实 feature 号）
- 制品磁盘核验所需内容由测试用例以字符串直接提供给 `judgeCompliance`（fixture 只承载 transcript 侧信号），
  或由测试用临时目录动态铺制品，保证测试自包含可重复
</content>
</invoke>
