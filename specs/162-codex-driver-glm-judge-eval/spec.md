---
feature_id: 162
name: "Codex Driver / GLM Judge 评测架构 swap + sub-agent MCP 工具继承修复 + SWE-Bench-Lite Stage 7b 跑批"
branch: claude/frosty-meninsky-d834b8
phase: specify
status: codex-reviewed-final
created: 2026-05-10
base_commit: 77bf166
---

# 概述

Feature 162 同时落 4 件强相关的事。**Phase 0 是 Phase C 的硬前置；Phase A 与 Phase B 互相独立可并行实施，但都必须在 Phase C 开始前完成**：

**背景**：Feature 161（commit 77bf166）的 Smoke D 验证揭示，sub-agent 工具访问权等于 sub-agent frontmatter `tools` 字段与全局可用工具集的交集，而非自动继承 session 级 `--allowedTools`。这意味着 Stage 7b 的 mcp-pull cohort 实验数据存在污染风险——Phase 2-4（plan/implement/verify sub-agent）实际以 control 模式运行，而非 MCP 增强模式。

**4 个 Phase 的目标**：

- **Phase 0**（硬前置）：修复 5 个 plugin agent frontmatter，在工具列表中显式声明 `mcp__spectra__*`，确保后续 Stage 7b 数据有效
- **Phase A**：重构 `callExecutor` 为多 backend 架构，接入 Codex CLI driver（ChatGPT Pro 零边际成本，数据迁移性更高）
- **Phase B**：将 jury 中的 `codex:gpt-5.5` 替换为 GLM-5.1（规避 self-judge 禁忌），并完成 GLM judge calibration 验证
- **Phase C**：接管 Stage 7b，用 Codex driver 在 SWE-L001~L010（10 fixture）上跑 450 runs eval，填入竞品评测报告 §10

---

## User Stories

### US-1 — sub-agent MCP 工具继承修复（优先级：P1）

作为 spec-driver 的用户，我需要 plan/implement/verify/quality-review/spec-review 这 5 个 sub-agent 在运行时能够实际调用 `mcp__spectra__*` 工具，而不是因 frontmatter 未声明而静默失败——这样 Stage 7b 的 mcp-pull cohort 数据才能反映真实的 MCP 增强效果，而不是被污染为 control 模式。

**优先级理由**：Phase C 的 450 runs eval 中 mcp-pull cohort 的有效性依赖本 fix。未完成本 story 则 Phase C 产出的数据无法区分"MCP lift"与"control baseline"，整个 Stage 7b 的科学结论失效。这是硬前置。

**独立测试**：可独立验收——修复完 5 个 agent 文件、跑 `npm run repo:sync` 通过、重跑 Smoke D Test 3，无需等待 Phase A/B/C。

**验收场景**：

1. **Given** 5 个 plugin agent 文件的 frontmatter `tools` 不含 `mcp__spectra__*`，**When** 按规格修改并运行 `npm run repo:sync`，**Then** `npm run release:check` 全部 pass，spec-driver 版本升至 4.1.0
2. **Given** spec-driver 插件已更新为含 `mcp__spectra__*` 的 frontmatter 版本（含本地 cache），**When** 以测试 session 调用 plan sub-agent，**Then** sub-agent 调用 `mcp__spectra__context` 返回 `TOOL_CALL_OUTCOME: success`（非 `tool-not-available`）
3. **Given** Smoke D Test 3 重测环境就绪，**When** 执行 Test 3（复现 Test 1 场景但使用已修复的 frontmatter），**Then** 测试结果落回 `specs/161-.../verification/sub-agent-mcp-test.md` "Test 3: Phase 0 修复后重测"章节，并记录 MCP 调用成功 trace + 实际加载 plugin 路径与版本号
4. **Given** Phase 0 改动已提交，**When** 运行全量 vitest，**Then** 退出码为 0（零失败 + 不新增 skip/todo），无测试回归

---

### US-2 — callExecutor 多 backend 重构与 Codex driver 接入（优先级：P1）

作为评测系统的维护者，我需要 `callExecutor` 支持多 backend 调度（SiliconFlow / OpenAI / claude-cli / codex），这样 driver 模型可以从 GLM-5.1 切换为 Codex CLI（ChatGPT Pro 订阅，零边际 token 成本），同时为未来切换其他 driver 留有扩展点，且切换不破坏现有 25 个 task fixture 的 schema 稳定性。

**优先级理由**：Phase C 跑 450 runs 必须用 Codex driver。当前 `callExecutor` 硬编码 SiliconFlow，无法接入 Codex CLI 子进程路径。Phase A 是 Phase C 的直接前置。

**独立测试**：可独立验收——实现多 backend dispatcher、8 个 unit case 全 pass、25 个 fixture 用 Codex driver 重跑 schema byte-stable，无需等待 Phase B/C。

**验收场景**：

1. **Given** `callExecutor` 已重构为多 backend，**When** 以 `model: 'codex:gpt-5.5'` 调用，**Then** 走 Codex CLI 子进程路径，`model_reasoning_effort=medium`，返回包含 `text / promptTokens / completionTokens / finishReason` 的标准结构（`promptTokens` 可为 null，因 codex-cli 不返回分项）
2. **Given** 8 个 vitest unit case 涵盖 4 backend × {success / error / token-usage-解析} 矩阵，**When** 运行 `npx vitest run`，**Then** 8 个新 case 全部 pass，现有测试零回归
3. **Given** 25 个既有 task fixture（`tests/baseline/tasks/`）是用 GLM driver 生成的，**When** 以 Codex driver 重跑同一批 fixture，**Then** 输出 schema 字段集合 byte-stable（字段名、类型、nullable 规则与 GLM 产物一致，允许内容不同）
4. **Given** `SPECTRA_EVAL_EXECUTOR` 环境变量未设置，**When** 调用 `callExecutor` 不指定 model，**Then** 默认使用 `codex:gpt-5.5`（DEFAULT_EXECUTOR_MODEL 已更新）

---

### US-3 — GLM-5.1 judge calibration（优先级：P1）

作为评测系统的质量保障者，我需要验证将 GLM-5.1 加入 jury（替换原有的 `codex:gpt-5.5` judge）后，judge 的评分质量仍然可信——具体表现为 oracle pass rate 的 IoU ≥ 0.7、quality score Pearson correlation ≥ 0.6——这样 Phase C 的 450 runs 评分结果才有可靠的评判基础。

**优先级理由**：Phase C 的 jury 依赖 Phase B 修订后的 DEFAULT_JUDGES。若跳过 calibration 直接上 450 runs，judge 评分质量未经验证，数据可信度无从保障。同时必须规避 driver=codex:gpt-5.5 与 jury 中 codex judge 并存的 self-judge 禁忌。

**独立测试**：可独立验收——用 5 个 fixture 子集跑 GLM judge 对比实验，计算 IoU 和 Pearson，记录结论，与 Phase A/C 完全解耦。

**验收场景**：

1. **Given** `DEFAULT_JUDGES` 已改为 `[claude-cli:claude-opus-4-7, siliconflow:Pro/zai-org/GLM-5.1, siliconflow:Pro/moonshotai/Kimi-K2.6]`，**When** 检查 jury 配置注释，**Then** 明确标注"driver=codex:gpt-5.5 时 jury 不含 GPT-5.5，规避 self-judge"
2. **Given** 5 个固定 fixture 子集（分层抽样：覆盖 pass / fail / 拒答 / 至少 2 种 task 类型；fixture id 列表在 calibration artifact 中显式记录），**When** 同时用 GLM judge 和旧 Codex judge 各评分，**Then** oracle pass rate IoU ≥ 0.7，quality score Pearson correlation ≥ 0.6，surface refusal detection IoU ≥ 0.5
3. **Given** GLM judge calibration **任一阈值**未达标，**When** 调整 rubric prompt 后最多重测 2 轮仍未达标，**Then** 启用回退方案：DEFAULT_JUDGES 仅保留 `claude-cli:claude-opus-4-7` + `siliconflow:Pro/moonshotai/Kimi-K2.6`（2-judge 一致同意制；当 2 judge pass/fail 分歧时按 fail-closed 取严裁定），并在 spec 中记录回退原因
4. **Given** `buildAdversarialPrompt` rubric 被微调，**When** 运行全量 vitest，**Then** 零测试回归（rubric 微调不破坏现有 unit test）

---

### US-4 — SWE-Bench-Lite Stage 7b 450 runs eval 跑批（优先级：P1）

作为评测研究者，我需要在 SWE-L001~L010 的 10 个 fixture 上完成 3 cohort × 15 runs × 10 fixture = 450 runs 的完整 eval，使用 Codex driver + Phase B 修订后的 3-judge jury，并将真实的 Pass Rate / Bootstrap 95% CI / Token Cost 数据填入竞品评测报告 §10 和新建的 §10.5——这样 Stage 7b 才正式结束，其科学结论才能对外发布。

**优先级理由**：整个 Feature 162 的最终交付物。US-1/2/3 都是本 story 的前置条件。450 runs 产出的数据是竞品评测报告的核心实验证据。

**独立测试**：无法独立于 US-1/2/3 验收，但本 story 内部可分阶段验证：pilot 27 runs → 配额评估 → 全量 450 runs → 报告填写。

**验收场景**：

1. **Given** US-1/2/3 全部通过，**When** 先跑 pilot batch（3 fixture × 3 cohort × 3 repeat = 27 runs，约占全量 6%；保留 5% 表述时按"约 5-6%"描述以避免硬编码错位），**Then** 所有 27 run 退出码为 0，产出 `run-N.json` 包含有效的 oracle 判定和 jury scores
2. **Given** pilot batch 数据显示单 run token 消耗，**When** 估算全量配额需求，**Then** 若单 run < 10K tokens 可一次性跑 450 runs；若 ≥ 10K tokens 则分 2-3 个 calendar week 执行（`--max-runs-per-day` 参数控制 + `~/.cache/spectra/eval-quota/feature-162.json` quota state store）
3. **Given** 全量 450 runs 完成，**When** 运行数据聚合脚本，**Then** 竞品评测报告 §10.2 Pass Rate 矩阵（10 task × 3 group）全部从 `<pending Stage 7b>` 替换为真实数值 + Bootstrap 95% CI；§10.1 实验设计同步更新为 N=15 / 450 runs
4. **Given** Phase 0 的 mcp-pull cohort 修复已生效，**When** 检查 Group C runs 的 `perf.mcpToolCalls[]`（canonical schema），**Then** 新建的 §10.5 章节填入实测数据：mcp-pull cohort 是否出现 sub-agent MCP 调用 trace、inheritance_status 字段统计

---

## Functional Requirements

### Phase 0 — sub-agent frontmatter 修复

**FR-001**：系统 MUST 在 `plugins/spec-driver/agents/plan.md` 的 frontmatter `tools` 字段中追加 `mcp__spectra__context, mcp__spectra__impact`，使 plan sub-agent 在 Stage 7b 运行时能够调用这两个 MCP 工具。[必须] [AUTO-RESOLVED: 调研 §1.1 已精确确认当前缺失，US-1 硬依赖]

**FR-002**：系统 MUST 在 `plugins/spec-driver/agents/implement.md` 的 frontmatter `tools` 字段中追加 `mcp__spectra__context, mcp__spectra__impact`，使 implement sub-agent 在代码实现阶段能够查询代码影响范围。[必须] [AUTO-RESOLVED: 同 FR-001]

**FR-003**：系统 MUST 在 `plugins/spec-driver/agents/verify.md` 的 frontmatter `tools` 字段中追加 `mcp__spectra__detect_changes, mcp__spectra__impact`，使 verify sub-agent 在验收阶段能够检测变更范围。[必须]

**FR-004**：系统 MUST 在 `plugins/spec-driver/agents/quality-review.md` 的 frontmatter `tools` 字段中追加 `mcp__spectra__impact, mcp__spectra__context`,使 quality-review sub-agent 能够评估改动的代码影响面。[必须]

**FR-005**：系统 MUST 在 `plugins/spec-driver/agents/spec-review.md` 的 frontmatter `tools` 字段中追加 `mcp__spectra__impact, mcp__spectra__context`，使 spec-review sub-agent 能够基于项目上下文审查需求规范。[必须]

**FR-006**：系统 MUST 在修改上述 5 个 agent 文件后运行 `npm run repo:sync` + `npm run release:check`，**并** MUST 在 Phase 0 验收时显式重新安装/更新 spec-driver 插件（`claude plugin update spec-driver` 或等价命令）使新启动的 Claude session 加载的是 4.1.0 版本——单纯 repo:sync 仅同步仓内产物，不保证 user-level marketplace cache（`~/.claude/plugins/cache/cc-plugin-market/spec-driver/`）切到新版本。Smoke D Test 3 验证时须记录实际加载的 plugin 路径与版本号作为证据。[必须]

**FR-007**：系统 MUST 将 `contracts/release-contract.yaml` 中 spec-driver 的版本从 `4.0.0` 升至 `4.1.0`（minor 升版，因为是新增工具能力，非 patch 级修复）。[必须]

**FR-008**：系统 MUST 将 Smoke D Test 3 重测结果（sub-agent 成功调用 `mcp__spectra__context` 的证据）落回 `specs/161-.../verification/sub-agent-mcp-test.md` 的专用章节，作为 Phase 0 验收的文档证据。[必须]

---

### Phase A — callExecutor 多 backend 重构

**FR-010**：系统 MUST 将 `callExecutor` 重构为支持 4 种 backend 的多路分发架构：`siliconflow:`（OpenAI-compat，使用 `SILICONFLOW_API_KEY`）、`openai:`（OpenAI-compat，使用 `OPENAI_API_KEY`）、`claude-cli:`（子进程，Claude Max subscription）、`codex:`（子进程，ChatGPT Pro subscription）。[必须]

**FR-011**：系统 MUST 将 `DEFAULT_EXECUTOR_MODEL` 常量从 `'Pro/zai-org/GLM-5.1'` 改为 `'codex:gpt-5.5'`，并支持通过环境变量 `SPECTRA_EVAL_EXECUTOR` 覆盖默认值。[必须]

**FR-012**：系统 MUST 在 `callExecutor` 调用 Codex CLI 子进程时使用 `model_reasoning_effort=medium`（非 high），以节约 ChatGPT Pro 周配额，同时保证推理质量足以完成代码实现任务。[必须]

**FR-013**：系统 MUST 从 `scripts/eval-judge-jury.mjs` 的 `parseJudgeBackend` 及 codex CLI spawn 实现中提取共享逻辑，建立可复用的 backend dispatcher 模块（`src/eval/llm-backend-dispatcher.ts` 或 `scripts/lib/llm-backend-dispatcher.mjs`），避免 executor 和 jury 各自维护重复的 backend 调用路径。[必须]

**FR-014**：系统 MUST 对 `callExecutor` 实施以下 retry 决策矩阵——**transient 错误（网络超时、HTTP 5xx、连接重置）**：最多 retry 1 次，第二次失败后 fail；**配额错误（HTTP 429、ChatGPT Pro `quota_exceeded`、`rate_limit_exceeded`）**：禁止 retry，立即 fail 并记录错误码；**返回截断（`finishReason=length` 但内容不完整）**：禁止 retry，标记 `partial=true` 并 fail；**JSON / schema 无效**：禁止 retry，记录原始返回到 `run-N.json.error.rawResponse` 字段并 fail。所有 fail 路径写 artifact 至 `run-N.json` 的 `error.{code, message, retryable}` 字段。规避循环消耗 ChatGPT Pro 配额。[必须]

**FR-015**：系统 MUST 新增 ≥ 8 个 vitest unit case，覆盖 4 backend × {success / error / token-usage-解析} 矩阵，确保每个 backend 的返回结构符合标准 schema（`text / promptTokens / completionTokens / finishReason`）。[必须]

**FR-016**：系统 SHOULD 在 `scripts/lib/llm-pricing.mjs` 的 PRICING_TABLE 中确认或补充 `codex:gpt-5.5` 作为 executor 时的 token 成本估算条目（调研 §4.7 确认该条目已存在，验证即可）。[可选]

---

### Phase B — GLM judge calibration

**FR-020**：系统 MUST 将 `scripts/eval-judge-jury.mjs` 中的 `DEFAULT_JUDGES` 从 `[claude-cli:claude-opus-4-7, codex:gpt-5.5, siliconflow:Pro/moonshotai/Kimi-K2.6]` 改为 `[claude-cli:claude-opus-4-7, siliconflow:Pro/zai-org/GLM-5.1, siliconflow:Pro/moonshotai/Kimi-K2.6]`。[必须]

**FR-021**：系统 MUST 在 `DEFAULT_JUDGES` 定义处增加注释，明确说明"当 driver=codex:gpt-5.5 时，jury 不能包含 GPT-5.5（self-judge 禁忌），因此从 DEFAULT_JUDGES 中移除 codex judge"——禁止在 driver 与 jury 中同时使用同一模型。[必须]

**FR-022**：系统 MUST 用 5 个**固定** fixture 子集（具体 id 列表在 calibration artifact `specs/162-codex-driver-glm-judge-eval/calibration-fixture-list.json` 中显式记录；分层抽样原则：必须覆盖 pass / fail / 拒答 + 至少 2 种不同 task 类型；不允许临时随机选取，且 calibration 重测必须复用同一列表）完成 GLM judge vs 旧 Codex judge 的 calibration 对比实验，oracle pass rate 一致性 IoU ≥ 0.7（视为 GLM 评判标准达标）。[必须]

**FR-023**：系统 MUST 验证 GLM judge quality score 与 oracle pass rate 的 Pearson correlation ≥ 0.6。

**统计功效约束（必须）**：5 fixture 各跑 ≥ 3 次（共 ≥ 15 数据点），plan 阶段须固化每 fixture 的运行次数；n < 15 不视为有效 calibration（n=5 时 r≥0.6 的 p≈0.28，统计功效不足）。calibration artifact 须明确记录每 fixture 实际跑批次数。

**Pearson 计算实现**：若当前 codebase 不存在，须新增逻辑；不允许引入有状态的第三方包（如 `simple-statistics` / `pearson`），可在 `scripts/lib/` 实现零依赖版本，并提供与 SciPy 实现的对比测试（ε ≤ 1e-6）。[必须]

**FR-024**：系统 MUST 验证 GLM judge 的 surface refusal detection IoU ≥ 0.5（拒绝答题的检测与 oracle 的一致性）。[必须]

**FR-025**：当 FR-022 / FR-023 / FR-024 中**任一阈值**在最多 2 轮 rubric prompt 调整重测后仍未达标时，系统 MUST 启用回退方案：`DEFAULT_JUDGES` 仅保留 `claude-cli:claude-opus-4-7` + `siliconflow:Pro/moonshotai/Kimi-K2.6`（2-judge 一致同意制——非"majority vote"，因 2 票时无 majority 概念）。**Tie-break 策略（fail-closed）**：当 2 个 judge 评分不一致时（pass/fail 分歧），结果按 "fail" 裁定（保守取严，避免假阳性）。在 jury 主模块注释中记录：触发回退的具体指标、回退时间、调整 rubric 的 2 轮 commit hash、最终重测数据。[必须]

**FR-026**：系统 SHOULD 在调整 `buildAdversarialPrompt` rubric 提示词（若因 GLM calibration 需微调）后，确保现有 unit test 零回归。[可选]

**FR-027**：系统 MUST 在 `eval-mcp-augmented.mjs`、`eval-judge-jury.mjs`、`callExecutor` 共用启动入口实施 **self-judge hard-fail 检查**——所有入口在解析完 driver model（含 `SPECTRA_EVAL_EXECUTOR` 环境变量覆盖）和 jury models（含 `--judges` CLI 覆盖、`DEFAULT_JUDGES` 默认值）后，对二者做 normalize 比较。

**Normalize 规则**（必须实现且单元测试覆盖）：
1. 剥离 backend prefix：`claude-cli:` / `siliconflow:` / `openai:` / `codex:` 前缀去除
2. 剥离 vendor org prefix：`Pro/zai-org/` / `Pro/moonshotai/` / `anthropic/` 等去除
3. case-fold：所有 identifier 转小写
4. 别名映射表（在 `scripts/lib/llm-backend-dispatcher.mjs` 实现 `MODEL_ALIASES` 常量）：`gpt-5.5` ≡ `gpt5.5`；`glm-5.1` ≡ `GLM-5.1` ≡ `glm5.1`；`claude-opus-4-7` ≡ `opus-4-7` ≡ `claude-opus-4.7`
5. 比较时使用规范化后的 identifier；任一 driver normalize 后 == 任一 jury judge normalize 后即视为 self-judge

**Hard-fail 触发**：driver normalize identifier 与任一 jury judge normalize identifier 相同时立即抛出配置错误并退出（exit code 非 0），不执行任何 run。错误信息须包含原始字符串 + normalize 后字符串两份，便于调试。

**至少 5 组覆盖测试**：
- (a) `SPECTRA_EVAL_EXECUTOR=codex:gpt-5.5` + `DEFAULT_JUDGES` 含 `codex:gpt-5.5` → hard fail
- (b) driver=`siliconflow:Pro/zai-org/GLM-5.1` + jury 含 `siliconflow:Pro/zai-org/GLM-5.1` → hard fail（同前缀同 model）
- (c) driver=`codex:gpt-5.5` + jury 含 alias `Codex:GPT-5.5`（大小写 + alias 不同写法）→ hard fail（验证 case-fold + normalize）
- (d) jury 内部重复 `--judges=claude-cli:claude-opus-4-7,glm-5.1,claude-cli:claude-opus-4-7` → 不阻断（jury 内部重复允许，用户自负），但需输出警告
- (e) driver=`codex:gpt-5.5` + jury 不含 GPT-5.5（如 `[claude-cli:claude-opus-4-7, GLM-5.1, Kimi-K2.6]`）→ 正常执行，无 hard-fail [必须]

---

### Phase C — SWE-Bench-Lite 450 runs eval

**FR-030**：系统 MUST 在正式开跑 450 runs 之前执行 pilot batch：从 SWE-L001~L010 中选 3 个 fixture，跑 3 cohort（Group A/B/C）× 3 repeat = 27 runs，作为配额预估基准，所有 pilot run 退出码须为 0。[必须]

**FR-031**：系统 MUST 根据 pilot batch 的单 run token 消耗数据决策分批策略：单 run < 10K tokens 时一次性完成 450 runs；单 run ≥ 10K tokens 时分 2-3 个 calendar week 分批执行，每天上限由 `--max-runs-per-day` 参数控制。[必须]

**FR-032**：系统 MUST 为 `scripts/eval-mcp-augmented.mjs` 新增 `--max-runs-per-day N` CLI 参数。

**Quota state store**：使用 `~/.cache/spectra/eval-quota/feature-162.json` 作为跨 session / 跨 worktree 的共享状态文件，schema 为 `{ "date": "YYYY-MM-DD", "timezone": "<IANA name from process.env.TZ or system default>", "runs": <integer count>, "run_ids": ["run-1", ...], "updatedAt": "<ISO 8601 timestamp>" }`。

**并发控制（真正的进程级排他锁）**：仅靠 `writeFileSync(tmpPath) + renameSync` 是**原子替换**而非互斥锁，无法防止两进程并发 read-modify-write 时的丢更新。本 spec 强制采用 **`O_EXCL` lock-file 互斥模式**（POSIX 跨进程独占语义，零新依赖）：
1. 读取 store 前先创建独占 lock 文件 `~/.cache/spectra/eval-quota/feature-162.lock`，使用 `fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600)`；若 lock 已存在则报 `EEXIST`，进入退避重试（指数 backoff，初始 50ms，上限 1.6s，最多 30 次重试 ≈ 30s）。**重试耗尽**：若 30s 后仍未获得锁，进程 exit 非零（exit code 73，对应 sysexits.h `EX_CANTCREAT`），向 stderr 输出包含当前 lock 文件 PID + 时间戳的诊断信息，并提示用户：(a) 检查是否有遗留进程持锁；(b) 若确认无运行中进程则手动清理 lock 文件；(c) 重新运行命令
2. 持锁期间执行：read store → 校验 date → 增加 runs / append run_id → atomic rename 写回
3. 释放锁：close + `unlinkSync(lockPath)`
4. **NFS / 跨 OS fallback**：若 `O_EXCL` 在 NFS 上已知不可靠，spec 允许 fallback 到 `proper-lockfile` 包（**仅在 plan 阶段确认 NFS 部署需求时**才引入，否则禁止）；本 spec 明确：本地 dev / GitHub Actions runner 都是本地文件系统，不必 fallback；CI 若改用 NFS 共享 cache，须在 plan 阶段 revisit 此决策
5. **进程崩溃后的孤儿 lock**：lock 文件含写入时的 PID + 时间戳；启动时若发现已有 lock 文件且其 PID 进程已不存在（`process.kill(pid, 0)` 抛 ESRCH），且 lock 时间戳 > 60s，视为孤儿 lock 并自动清理

**日切边界**：读取后若 store `date` 字段与当前 calendar day 不一致则重置 counter 为 0（保留 7 天历史在 `~/.cache/spectra/eval-quota/feature-162-history.jsonl`）。

**进程重启恢复 + partial run 处理 + 配套 CLI flag**：每次启动加载 store + 扫描已存在的 `run-N.json`：
- **finalized run**（含 `finalized_at` 字段）→ 计入已用配额并跳过重跑
- **partial run**（仅含 `started_at`，无 `finalized_at`）→ 视为孤儿 partial，输出列表 + **不自动重跑**（避免双重扣除配额，由用户人工决策）；脚本退出码 0，提示用户使用以下 flag 之一决策后再运行：
  - **`--accept-partial`**：把 partial run 计入"已耗 1 配额但失败"，跳过重跑（保留原 run-N.json 用于审计）
  - **`--restart-partial`**：删除 partial run-N.json，下一轮跑批时重新分配该 N 编号（**会再耗 1 个配额**）
  - **互斥**：`--accept-partial` 和 `--restart-partial` 同时传入时 exit 非零（exit code 64，对应 sysexits.h `EX_USAGE`），输出错误信息提示用户只能选一个
  - 不传 flag：仅显示报告，不修改任何状态，等待用户决策
- store `run_ids` 字段与磁盘 run-N.json 取并集，重复计数时去重

当 `runs >= --max-runs-per-day` 时优雅停止（exit code 0，输出 "配额已耗尽，等待下一 calendar day 继续"）；不抛异常、不静默截断。

**测试**：plan 阶段须新增 vitest case 验证：(i) 两进程并发尝试写 store，最终 runs 计数恰好为 2；(ii) 模拟孤儿 lock 自动清理；(iii) partial run 检测不自动重跑。[必须]

**FR-033**：系统 MUST 以 Codex driver（`codex:gpt-5.5`，`model_reasoning_effort=medium`）驱动 SWE-L001~L010 的全量 450 runs（3 cohort × 15 runs × 10 fixture），judge jury 使用 Phase B 修订后的 DEFAULT_JUDGES。[必须]

**FR-034**：系统 MUST 在全量 450 runs 完成后，将真实 Pass Rate 数值和 Bootstrap 95% CI 填入 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.2 的 Pass Rate 矩阵（10 task × 3 group），替换所有 `<pending Stage 7b>` 占位符。[必须]

**FR-035**：系统 MUST 在 §10.3 Token Cost 填入实测 token 消耗数据（Codex driver 零边际成本标注，GLM/Kimi judge API cost 据实填入）。[必须]

**FR-036**：系统 MUST 在 §10.4 填入战略结论段，按实测数据选择三种情境模板之一：lift > 0（MCP 有显著提升）/ lift ≈ 0（MCP 无显著效果）/ 天花板（当前 SWE-Bench-Lite 任务集不适合区分）。[必须]

**FR-037**：系统 MUST 在 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` 中**新建 §10.5 章节**（当前报告仅含 §10.1-§10.4，§10.5 不存在；需先补章节再填数据），章节标题为 `### 10.5 Sub-agent MCP 继承 fix 影响验证（Feature 162 Phase 0）`。章节必含表格 schema：`| run id | cohort | mcp_tool_calls (count) | mcp_called (bool) | mcp_tools (列表) | mcp_response_bytes | inheritance_status |` + 引用 source 字段路径（`perf.mcpToolCalls[]` canonical schema）。

**`inheritance_status` 字段语义**（precise enum，**3 状态**，plan iter-2 升级以避免默认 false-positive）：

| 值 | 判定条件 | 语义 |
|----|---------|------|
| `unavailable` | (i) `mcpToolCalls` 含 `error='tool-not-available'`；或 (ii) `subAgentMeta.specDriverVersion` < 4.1.0 | sub-agent 没拿到 mcp 工具继承 |
| `available` | (a) `mcpToolCalls.length > 0` 且无 `tool-not-available` 错误；或 (b) `subAgentMeta.specDriverVersion` >= 4.1.0 且无 unavailable 信号 | 工具继承正常 |
| `unknown` | 既无 unavailable 信号，又无 mcp 调用迹象（length=0），且 `subAgentMeta.specDriverVersion` 缺失 | 无法判定（不再默认为 available） |

**判定优先级**：unavailable 信号 > available 信号 > unknown 兜底。`unknown` 占比 > 10% 视为采集质量异常，须在异常分析章节解释（说明 subAgentMeta 采集失败原因）。

**subAgentMeta 字段定义**（用于 inheritance_status 判定）：`{ "specDriverVersion": "<X.Y.Z>", "frontmatterTools": ["mcp__spectra__context", ...], "loadSource": "<plugin path>" }`，由 plan §2.4.5 双轨采集（环境变量注入 + sub-agent prompt 自报）。

**`mcp_called` 字段语义**（已列入 §10.5 表格 schema 第 4 列）：
- bool 派生字段，`mcp_called = (mcp_tool_calls > 0)`
- 即使 `inheritance_status=available` 时此字段也可为 `false`（sub-agent 决定本任务不需 MCP，合法行为）
- 不能用 `mcp_called=false` 倒推 `inheritance_status=unavailable`（这是常见误判）

**异常阈值**：MUST 用 Phase C 实测数据填入。若 `inheritance_status=unavailable` 占比 > 30%（说明 Phase 0 fix 未充分生效），§10.5 末尾追加异常分析段（可能原因：cache 未更新 / agent 调用失败 / 字段写入异常）。[必须]

**FR-038**：系统 MUST 在每个 Phase（0/A/B/C）完成后分别执行 Codex 对抗审查（`codex:codex-rescue` 子代理），review artifact 落地至 `specs/162-codex-driver-glm-judge-eval/codex-reviews/{phase-id}.md`（artifact contract：含 critical/warning/info 三档 finding 列表 + 主线程裁决记录 + 修复 commit 引用）。审查结论须达到"零 critical 项"方可进入下一 Phase 或提交该 Phase 的 commit；warning / info 必须有显式裁决（修复 / 接受并记录原因）。同一 sub-agent 不允许审查自己生成的 review artifact。[必须]

**FR-039**：系统 MAY 在 `eval-mcp-augmented.mjs` 运行前检查 ChatGPT Pro usage 状态（如读取 `.codex/usage*` cache 或提示用户手动确认），当前该能力未实现，作为可选安全防护。[YAGNI-移除：当前迭代用 pilot batch 估算 + `--max-runs-per-day` 控制即可，usage cache 查询属于未来优化；移除理由：增加实现复杂度，pilot 策略已足够防护；commit message 须备注"usage cache 自动查询未实现，依赖 pilot 与 quota state store"]

**FR-040**：系统 MUST 同步更新 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.1 实验设计章节（将旧的 N=3、90 runs 或 ≥45 runs 的实验配置改为 Feature 162 实施的 N=15、450 runs / 3-cohort × 15-runs × 10-fixture 配置；同步更新统计功效说明 + 复现命令文本块）；同时更新 `specs/158-swe-bench-lite-grounding-eval/...` detail 报告中的实验配置（行 50-55 / 139）以保持设计与实测一致。不允许只填 §10.2/10.3/10.4 数据而保留 §10.1 旧实验配置文字。[必须]

---

## Success Criteria

**SC-001**：5 个 plugin agent 文件的 frontmatter 均包含对应的 `mcp__spectra__*` 工具声明，`npm run repo:sync` + `npm run release:check` 全部 pass，spec-driver 插件已升级至 4.1.0 并经 `claude plugin update` 安装到本地 cache，Smoke D Test 3 重测结果为 sub-agent `mcp__spectra__context` 调用返回 success（且测试报告中记录实际加载的 plugin 路径与版本号），全量 vitest 退出码为 0（无新增 skip/todo）。

**SC-002**：`callExecutor` 4 backend 矩阵的 8 个 vitest unit case 全部 pass，25 个既有 task fixture 以 Codex driver 重跑后输出 schema byte-stable，`npx vitest run` 零回归，self-judge hard-fail（FR-027）**5 组覆盖测试**全 pass。

**SC-003**：Phase B calibration 结论为 oracle pass rate IoU ≥ 0.7（或记录回退决策：改用 2-judge 一致同意制 + fail-closed tie-break）+ quality score Pearson correlation ≥ 0.6（或记录回退）+ surface refusal IoU ≥ 0.5，`DEFAULT_JUDGES` 已更新且 self-judge 禁忌注释存在，calibration-fixture-list.json 已落地。

**SC-004**：450 runs（或 pilot 策略下的等效全量）全部退出码为 0，竞品评测报告 §10.1 实验设计 + §10.2 Pass Rate + §10.3 Token Cost + §10.4 战略结论 + 新建的 §10.5 sub-agent MCP 影响验证均以实测数据填入（无 `<pending>` 占位符），Feature 158 detail 报告同步更新。

**SC-005**：4 个 Phase 的 Codex 对抗审查均落地 review artifact 至 `specs/162-codex-driver-glm-judge-eval/codex-reviews/{phase-id}.md`（artifact contract：含 critical/warning/info 三档 finding 列表 + 主线程裁决记录 + 修复 commit 引用）；critical 项数 = 0 方可推进下一 Phase 或允许该 Phase commit；warning / info 必须有显式裁决。本 SC 由人工最终裁决（编排器主线程负责），同一 sub-agent 不允许审查自己生成的 review artifact。

---

## Edge Cases

**EC-001 — Phase 0 frontmatter 改完未跑 repo:sync 或未重装 plugin**：若修改了 5 个 agent 文件但跳过 `npm run repo:sync`，仓内包装产物不一致；若做了 repo:sync 但未 `claude plugin update`，user-level marketplace cache（`~/.claude/plugins/cache/cc-plugin-market/spec-driver/4.0.0/`）仍是旧版本，新 session 加载的 sub-agent 不含 `mcp__spectra__*` 工具。降级处理：`npm run release:check` 检测仓内不一致并报错；plugin update 步骤通过 Smoke D Test 3 实测验证（若加载的 plugin 路径仍指向 4.0.0 cache，测试 fail 并提示重装）。

**EC-002 — Phase A codex driver retry 消耗配额**：若 Codex CLI 子进程调用失败，实施 FR-014 retry 矩阵——transient 最多 retry 1 次，配额错误 / 截断 / schema 无效一律 fail-fast 不 retry。配额错误识别凭据：HTTP 429 / `quota_exceeded` 字符串 / `rate_limit_exceeded` 字符串。跑批脚本按 stop-loss 逻辑处理该 run 的失败。

**EC-003 — Phase B GLM judge 任一阈值不达**：GLM-5.1 judge calibration IoU 或 Pearson 任一未达，可能因 rubric 提示词不适合中文模型。降级处理：先调整 `buildAdversarialPrompt` 给 GLM 更明确的 JSON 格式指令和打分基准；最多 2 轮重测仍未达标，启用回退方案（2-judge：Opus + Kimi + fail-closed tie-break），记录回退理由和数据，Phase C 继续推进。

**EC-004 — Phase C 单 run token > 10K 导致配额超限**：若 Codex driver 单 run 消耗 token 超过预估，450 runs 可能在一周内触达 ChatGPT Pro 周配额上限。降级处理：pilot batch 完成后必须检查 token 消耗，若 ≥ 10K 则拆分为 2-3 周分批执行，`--max-runs-per-day` 参数控制每天最大 run 数（依赖 FR-032 的 quota state store）。脚本达到上限后优雅停止（退出码 0，输出进度日志 + 已完成 run id 列表）。

**EC-005 — driver 与任一 judge 同 model（self-judge 禁忌）**：通过 `SPECTRA_EVAL_EXECUTOR` / `--judges` CLI / `DEFAULT_JUDGES` 任一通道的组合，若 normalize 后存在 driver model = jury judge model（无论是 Codex / GLM / Opus / Kimi 哪个），FR-027 的 hard-fail 检查必须立即抛出错误并 exit 非零。**人工确认不可作为唯一防护**——hard-fail 是 MUST 级保护。Phase C 跑批前 + 跑批中如修改 jury config 都需重新触发该检查。

**EC-006 — MCP trace 字段 canonical schema**：`eval-task-runner.mjs` 当前使用 `perf.mcpToolCallTrace`（数组，v1.2 schema），`eval-mcp-augmented.mjs` 当前使用 `mcpToolCallCount + mcpResponseBytes`（标量，扁平）。**本 spec 在层面统一为 canonical schema：`perf.mcpToolCalls[]`**，每条 entry 字段 `{ "tool": "<mcp__spectra__xxx>", "success": <bool>, "error": "<string|null>", "responseBytes": <number>, "timestamp": "<ISO 8601>" }`。Plan 阶段须实施迁移：`eval-mcp-augmented.mjs` 写入时同时填 `mcpToolCalls[]`（new canonical）和 `mcpToolCallCount + mcpResponseBytes`（legacy 兼容字段，从 `mcpToolCalls.length` / `sum(responseBytes)` 派生）；`eval-task-runner.mjs` 已用 `mcpToolCallTrace`，须 rename 为 `mcpToolCalls`（向后兼容：读取时同时识别旧字段名）。所有 Phase C 新跑数据写 canonical 字段，FR-037 §10.5 表格基于 canonical 字段填入。

**EC-007 — spec-driver 版本升至 4.1.0 后用户本地 cache 未更新**：用户本地已安装 `4.0.0` cache，升版后若用户未重新安装插件，加载的仍是旧版本 frontmatter（不含 MCP 工具）。缓解：FR-006 已升为 MUST 级要求执行 plugin update；Smoke D Test 3 报告须显式记录加载 plugin 路径与版本号；若 path 仍指向 4.0.0，测试失败并提示。

**EC-008 — 跨日 partial 数据中断**：Phase C 跑批中途 ChatGPT Pro 配额耗尽（hit `--max-runs-per-day` 上限）或进程崩溃，已完成 partial run（如完成 60/450）的处理依赖 FR-032 的 quota state store + `run_ids` 字段保留已完成列表 + run-N.json 的 `started_at` / `finalized_at` 双字段：

- **finalized run**（`run-N.json` 含 `finalized_at`，oracle/jury 都已写入）→ 续跑时跳过
- **partial run**（`run-N.json` 只有 `started_at`，无 `finalized_at`，可能是进程崩溃 / 跨日中断时正在执行的 run）→ **不自动重跑**，列入 unfinished_runs 报告，由用户人工决策：(a) 删除 partial run-N.json 后续跑（重新分配 N）；(b) 把 partial 视作"已耗 1 配额但失败"接受丢失（避免重跑）
- **续跑流程**：下一 calendar day 启动时输出报告 "已完成 X/450（finalized），partial Y 个待人工决策，剩余 Z 待跑"；用户输入 `--accept-partial` 或 `--restart-partial` flag 决策后再继续

**不允许整批重跑**（浪费配额 + 数据不可比性）。续跑时每个新 run-N.json 必须包含 `started_at` + `finalized_at`（finalized_at 在 oracle + jury 都成功写入后才填入），便于跨日数据合并审计。

---

## Non-Goals（不在范围）

以下内容明确不在本 feature 范围内，计划在后续 feature 实现：

1. **多 driver 对比实验**（Sonnet / Haiku 当 driver 与 Codex 的效果对比）— 计划在 **Feature 163** 实现
2. **多 MCP server 对比实验**（GitNexus / 其他 MCP server 作为 mcp-pull group 的 context 源）— 计划在 **Feature 164** 实现
3. **全量 25 fixture × 5 repeat 长期回归测试**（仅在 SWE-L001~L010 范围内运行，不扩展到全 25 fixture 或更多 repeat）— 计划在 **Feature 165** 实现

---

## 依赖与前置

### Phase 依赖关系

```
Phase 0 (US-1) ─→ Phase A (US-2) ─┐
                                  ├─→ Phase C (US-4)
Phase 0 (US-1) ─→ Phase B (US-3) ─┘
```

- **Phase 0 是 Phase A / B / C 的硬前置**：Phase 0 未完成则 Phase C 的 Group C（mcp-pull cohort）数据无效（sub-agent 实际以 control 模式运行），§10.5 的 MCP 修复验证无从展开
- **Phase A 与 Phase B 互相独立可并行**：A 改 callExecutor/dispatcher，B 改 jury config/calibration；二者无代码层耦合
- **Phase A 是 Phase C 的直接前置**：Phase C 使用 Codex driver，依赖 Phase A 重构后的 `callExecutor`
- **Phase B 是 Phase C 的直接前置**：Phase C 的 jury 使用 Phase B 修订后的 `DEFAULT_JUDGES`

### 外部前置

- 启动前必须确认 `git fetch origin master`，当前 HEAD ≥ commit `77bf166`
- ChatGPT Pro 订阅有效（用于 Codex driver 和 Codex judge 的历史对比数据）
- Anthropic Claude Max 订阅有效（用于 `claude-cli:claude-opus-4-7` judge）
- SiliconFlow API Key 有效（用于 GLM-5.1 和 Kimi-K2.6 judge）
- SWE-L001~L010 fixture 已入库于 `tests/baseline/swe-bench-lite/fixtures/`（调研确认已存在）

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 值 | 说明 |
|------|----|------|
| 组件总数 | 5 | 新增：`src/eval/llm-backend-dispatcher.ts`（或 scripts/lib 版）；修改：`eval-task-executor.mjs`、`eval-judge-jury.mjs`、`eval-mcp-augmented.mjs`（+`--max-runs-per-day` + quota state store + self-judge hard-fail）；更新：5 个 plugin agent frontmatter |
| 接口数量 | 9 | `callExecutor` 签名扩展（+model backend dispatch + retry matrix）、`DEFAULT_JUDGES` 替换、5 个 frontmatter `tools` 字段（视为接口合同）、`--max-runs-per-day` CLI 参数、self-judge hard-fail 入口检查（FR-027）、`perf.mcpToolCalls[]` canonical schema（EC-006）、quota state store schema（FR-032）|
| 依赖新引入数 | 0 | 无新外部依赖（Codex CLI / SiliconFlow API / claude-cli 均已存在；Pearson 计算在 scripts/lib 零依赖实现；quota state store 用 `fs.openSync(O_EXCL)` 独占 lock 文件 + `fs.writeFileSync(tmpPath) + renameSync` 原子重命名，零依赖跨进程互斥；不引入 proper-lockfile）|
| 跨模块耦合 | 是 | `scripts/` ↔ `src/eval/` ↔ `plugins/spec-driver/agents/` ↔ `contracts/release-contract.yaml` ↔ `specs/147-.../report.md` ↔ `specs/158-.../detail.md` ↔ `~/.cache/spectra/eval-quota/`，跨 6 个目录层 |
| 复杂度信号 | 3 个 | 并发控制（450 runs 配额管理 + calendar week 分批状态）、状态机（pilot batch → 配额评估 → full batch 三段式流程）、跨进程共享状态（quota state store）|
| 总体复杂度 | **HIGH** | 组件 5 个（> 3）+ 接口 9 个（> 4）+ 3 个复杂度信号 → HIGH |

**GATE_DESIGN 建议**：本 feature 涉及 4 个 sub-phase、跨多模块改动、ChatGPT Pro 配额消耗风险、self-judge 禁忌约束、跨进程状态文件，建议人工审查以下风险点：

1. `llm-backend-dispatcher` 模块的共享接口设计是否向后兼容现有 jury 路径（避免破坏 Sprint 3 既有 25 fixture）
2. Pearson correlation 零依赖实现是否引入数值精度问题（要求与 SciPy / NumPy 对比 ε ≤ 1e-6）
3. `--max-runs-per-day` quota state store 的并发控制：原子重命名（`writeFileSync + renameSync`）在跨 worktree 同时跑时是否真的够？需测试两个 worktree 同时 spawn `eval-mcp-augmented.mjs` 是否会丢失计数
4. `perf.mcpToolCalls[]` canonical schema 迁移期：Phase A 完成后 Phase C 跑出的数据是否需要回填到既有 25 fixture（应不需要，但 plan 阶段须明确）
5. self-judge hard-fail 的 normalize 比较是否处理了 vendor prefix 边界（如 `Pro/zai-org/GLM-5.1` vs `glm-5.1` vs `siliconflow:Pro/zai-org/GLM-5.1` 三种写法是否归一化为同一 identifier）
