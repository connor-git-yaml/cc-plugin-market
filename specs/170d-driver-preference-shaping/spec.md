# Feature Specification: Driver Preference Shaping — 让 driver 主动调 spectra MCP 而非默认 Grep

**Feature 编号**: 170d
**Milestone**: M7 — Spectra MCP Productization（第三个 Feature）
**模式**: spec-driver-feature（5 阶段）
**状态**: Specify

## 背景与动机

F170c 实测（host shell N=10 × 4 轮重测）证明：driver = Claude Sonnet 4.6 在「评估 symbol 改动影响」任务上 **0/10 (0%)** 主动调用 `impact`，Wilson 95% CI [0%, 27.8%]。即使把 tool description 升级到 100-500 字 + 4 要素 + 显式 chained usage，driver 仍 0% 主动调用。

F170c verification report 的结论与 Follow-up 表格明确把 F170d 定位为 **「system prompt 层引导」**：仅靠 tool description（"理论可用性"）不能改变 driver 偏好，需要在 prompt level 提供 **"任务匹配性"** 引导（什么任务用什么工具）。

driver 系统性偏好 Read/Grep 的 4 个根因（F170c report 已落地）：
1. Grep 是 Anthropic 训练数据中 "caller analysis 默认工具"
2. `impact` 作为第三方 MCP 工具需要 cognitive overhead 评估
3. Grep 输出格式更"易消费"（line numbers + 多 pattern）
4. `impact` 调用需 target + JSON envelope，driver 内部认知 Grep 更直接

**与 F170c 的关系**：F170d ≠ F170c 反向操作，两者互补。F170c 提供 description（理论可用性），F170d 提供 prompt 引导（任务匹配性）。F170c 的 response format（`topImpacted` / `nextStepHint`）只有在 F170d 把主动调用率拉起来后才能发挥真正价值——driver 调一次 `impact` 后，`nextStepHint` 才能引导 chained 调用。

## 关键设计洞察（决定 US2 可测性）

**因果链断点**：F170c 的 SC-002 harness（`scripts/feature-170c-sc002-driver-eval.mjs`）跑的是**裸 `claude --print`**——只传 task prompt + `.mcp.json`，**从不加载任何 spec-driver agent prompt**。因此 Phase A 把引导写进 `plugins/spec-driver/agents/*.md`，对该 harness 中的 driver **没有任何因果路径**——若直接复用 F170c harness 不做改造，US2 只会重测出同一个 0% baseline。

**生产路径 → harness 通道映射（响应 codex C-1，必须精确）**：spec-driver 在 Claude Code 的 agent 模型里，**agent `.md` 文件的 body 即子代理的 system prompt**。所以引导抵达 driver 有两条生产通道：

| 生产通道 | 引导落点 | 在 driver 上下文中的位置 | harness 对应模拟 |
|---------|---------|------------------------|----------------|
| Phase A（agent 文件 body） | `plugins/spec-driver/agents/*.md` 的「工具优先使用规则」章节 | 子代理 **system prompt** | `claude --print --append-system-prompt "<引导块>"` |
| Phase B（SKILL.md 编排提示） | 主编排器 dispatch 时拼进 `Task(prompt: ...)` 的调度提示 | 子代理 **user/task prompt** 头部 | harness 的 task prompt 头部（可选第二注入点） |

**结论（已与用户确认 + codex C-1 精化）**：US2 的 **canonical 注入通道是 Phase A → system prompt**，因此 harness 用 `--append-system-prompt` 注入引导块，是对 **Phase A 生产通道的忠实模拟**（agent body = 子代理 system prompt）。harness 默认只注入 system prompt 通道；Phase B 的 task-prompt 提示作为可选第二注入点（默认关闭，避免双重计数）。harness report 必须记录最终注入块的 hash/摘要，证明跑的不是裸 baseline（响应 codex I-3）。

**度量语义诚实声明（响应 codex C-3）**：把「什么任务用 impact」明示给 driver 后再测 driver 是否调 impact，度量的是 **「guided active-call rate」（引导是否生效 / driver 是否遵循引导）**，**不等于** F170c 测的「spontaneous preference」（内在偏好）。F170c 0%（无引导）与 F170d ≥50%（有引导）的对比，意义是 **"prompt 层引导能否驱动 driver 改用 MCP"**，而非 "driver 内在偏好被改变"。spec 不得 over-claim 后者。

**neutral A/B 对照（可选，secondary）**：为隔离「是引导内容生效，还是任何 system prompt carrier 都会触发」，可加一组 neutral system prompt（同长度、不提工具偏好）对照；预算允许时跑，否则记为 follow-up。

---

## User Scenarios & Testing

### User Story 1 — 5 个 sub-agent prompt 含「工具优先使用规则」章节（优先级：P1，静态可测）

**作为** spec-driver 维护者，**我希望** plan / implement / verify / spec-review / quality-review 这 5 个 agent 文件的主 prompt body 都包含「工具优先使用规则」章节，且每个文件**只列出该 agent frontmatter `tools` 实际具备的 MCP 工具对应的规则行**，**以便** 当这些 agent 被 dispatch 时，driver 上下文里携带任务→工具映射引导，且不推荐它无法调用的工具。

**per-agent 工具覆盖矩阵（响应 codex C-2，实测 frontmatter）**：

| agent | impact | context | detect_changes | 应渲染规则行数 |
|-------|--------|---------|----------------|--------------|
| plan | ✅ | ✅ | ❌ | 3（impact upstream + impact blast + context） |
| implement | ✅ | ✅ | ❌ | 3 |
| spec-review | ✅ | ✅ | ❌ | 3 |
| quality-review | ✅ | ✅ | ❌ | 3 |
| verify | ✅ | ❌ | ✅ | 3（impact upstream + impact blast + detect_changes） |

**验收**（sandbox 可测，无需 LLM）：
- 解析 `plugins/spec-driver/agents/{plan,implement,verify,spec-review,quality-review}.md`
- 每个文件主 prompt body 含关键短语「优先调用 spectra MCP 工具」（anchor 短语由 contract 固定）
- 每个文件「工具优先使用规则」表格的规则行 = **该 agent frontmatter `tools` 过滤后的子集**（见上表，3 行/agent），**不含**该 agent 无法调用的工具行（FR-006/FR-012 硬约束）
- 含「关键原则」小节（Grep fallback / 不能省略调用 / chained 使用 / 不要 N+1）
- 每个文件渲染的规则行内容与共享单一事实源（template）对应条目字面一致（按 tool key 比对，非整段 Markdown diff，见 FR-005）

### User Story 2 — 真实 driver 在引导下 guided active-call rate ≥ 50%（优先级：P1，**Primary Outcome**）

**作为** M7 战略负责人，**我希望** 当引导通过 `--append-system-prompt` 送达 driver 后，真实 Claude Sonnet 4.6 在 caller-analysis / impact 评估类任务上主动调用 `impact` 的 run 数 ≥ 5/10（**guided active-call rate ≥ 50%**，vs F170c spontaneous baseline 0%），**以便** 证明 prompt 层引导能驱动 driver 改用 MCP 工具。

**度量命名（响应 codex C-3）**：本指标命名为 **guided active-call rate**，度量「引导是否生效 / driver 是否遵循引导」，**不等于** spontaneous preference（内在偏好）。结论表述限定为「引导能驱动 driver 改用 MCP」，不得 over-claim「driver 内在偏好被改变」。

**验收**（host shell only，仅需 **Claude Max OAuth**；不需要 SiliconFlow——见 NFR-001，响应 codex I-4）：
- 复用 F170c SC-002 N=10 harness（5 task × 2 repeat），driver = `claude-sonnet-4-6`（同 baseline）
- **唯一变量**：harness 用 `--append-system-prompt "<引导块>"` 注入引导（其余配置与 F170c 逐字一致：同 5 task、同 forbidden literals、同 Active Call 4 规则、同 allowedTools）
- 任务都是 caller-analysis / impact 评估类型（直接复用 F170c 的 5 个 task，已验证 target 在 graph 中可 resolve）
- **断言**：≥ 5/10 runs 满足 Active Call 4 条规则主动调 `impact`（无 force protocol）
- **反模式观察**：合规 run 的 Grep 调用数应显著低于 F170c baseline（记录但不单独作为 gate）

**三层指标（响应 codex W-2，harness 必须分别报告）**：
- `impactAttemptRate`：driver 发起 impact tool_use 的 run 占比（无论 target 是否 resolve）
- `impactResolvedSuccessRate`：impact 调用且 target resolve 成功 + success envelope 的 run 占比（= guided active-call rate，**= SC-002 主指标**）
- `fallbackAfterImpactFailureRate`：先调 impact、target 失败、再回退 Grep 的 run 占比（隔离「偏好已改但调用门槛失败」vs「完全没调」）

**Active Call 4 条规则**（沿用 F170c，不变）：
- (a) source = tool_use（driver LLM 自发，非 protocol push）
- (b) task prompt 文本不含 `impact` / `mcp__spectra__impact` / `mcp__plugin_spectra_spectra__impact` 字面量（注意：引导块通过 system prompt 注入，**不算** task prompt 字面量；引导块本身也不得写死任何具体 task 的 target——见 EC-1）
- (c) target 非空 + 能 resolve + 非 error envelope + 含 impact success 关键字段
- (d) 同 run 内重复调用按 target 去重，仅计 1 次

**情景判定（按 count 定义，响应 codex W-5；同时报告 Wilson 95% CI）**：

| 合规 run 数 (N=10) | 判定 | 处置 |
|-------------------|------|------|
| 7-10 / 10 | 🟢 strong signal | 引导高效；不宣称「默认行为」（N=10 不足以支撑该强表述） |
| 5-6 / 10 | 🟡 primary pass | 达成 SC-002 primary pass gate（≥ 50%），保留 Grep fallback |
| 3-4 / 10 | 🟠 degraded | 触发降级 1（阈值 25%），记 degraded outcome |
| 0-2 / 10 | 🔴 fail | 记 limitation + F176 cohort 3 用强制 protocol |

### User Story 3 — Grep 仍作为 fallback 工作（优先级：P1）

**作为** spec-driver 用户，**我希望** 当 spectra MCP 工具不可用（graph-not-built / error envelope）时 driver 仍能回退到 Grep 完成 caller analysis，**以便** 引导不会在 MCP 失效时阻塞研发流程。

**验收**（覆盖三类 fallback 触发源，响应 codex W-2）：
- 模拟 MCP 不可用的三类场景：(1) graph-not-built（不构建 graph）；(2) invalid-target（target 无法 resolve）；(3) error envelope（handler 返回错误）
- driver 应回退使用 Grep（assert: MCP 调用失败后该 run 出现 Grep 调用且任务仍被推进）
- 引导文案显式包含「Grep 仍是 fallback」原则，与 template 字面一致
- 至少覆盖 graph-not-built 一类作为 hard 验收，invalid-target / error-envelope 作为补充观察

### User Story 4 — chained 调用 detect_changes → impact → context（优先级：P2，Secondary）

**作为** M7 战略负责人，**我希望** 至少维持 F165 baseline 的 chained call rate（≥ 30%），**以便** F170c 的 `nextStepHint` 在主动调用率上升后能发挥引导下一步工具的价值。

**验收**（host shell only）：
- 跑 1 个 SWE-Bench-Lite cohort C run（复用 F167 cohort C setup）
- assert: stream-json 含完整 3 工具链路调用（detect_changes → impact → context）≥ 1 个
- chained call rate ≥ 30%（baseline F165 67%，期望维持，secondary 不阻塞验收）

### Edge Cases

- **EC-1 引导块字面量泄漏**：引导块若写死某个 task 的 target symbol，会污染 (b) 规则。引导块必须只描述「任务关键词→工具」映射，不含任何具体 target 字面量。
- **EC-2 over-call**：SHOULD 文案下若 driver 对不该用 MCP 的任务也硬调（如纯文本搜索），应被视为引导副作用。US2 度量只看 caller-analysis 类 task，over-call 作为观察项记录，不计入 pass gate。
- **EC-3 引导与 frontmatter tools list 不一致**：若 agent frontmatter 未列出某 MCP 工具但引导推荐它，driver 调用会失败。引导推荐的工具必须 ⊆ 该 agent frontmatter `tools`（F170a 已对齐，不动 tools list，仅校验一致性）。
- **EC-4 单一事实源漂移**：Phase A（5 agent）+ Phase B（5 SKILL）+ harness 注入块若各写一份会漂移。必须有共享 template + 校验三处引用一致。
- **EC-5 harness 注入失败静默**：`--append-system-prompt` 若 CLI 不支持或参数被吞，harness 必须 fail-fast（exit 2），不得静默退化成裸 driver 测出假 0%。
- **EC-6 SKILL.md 注入提示缺失**：Phase B 的 5 个 SKILL.md 若漏改，生产路径引导不完整；US1 静态测应覆盖 SKILL.md 提示存在性。

---

## Requirements

### Functional Requirements

- **FR-001**：在 plan / implement / verify / spec-review / quality-review 这 5 个 agent 文件主 prompt body 中加「工具优先使用规则」章节，含**按该 agent `tools` 过滤后的**任务→工具映射表（每 agent 3 行，见 US1 矩阵）+ 关键原则小节。
- **FR-002**：引导文案默认用 **SHOULD（"优先"）** 语气，非 MUST 强制（已与用户确认）。保留 Grep fallback 弹性。
- **FR-003**：单一事实源 template 含 **4 条规则**：(R1) 找 caller / caller analysis → `impact` direction=upstream；(R2) 评估改动影响 / blast radius → `impact`；(R3) 找 callee / 依赖什么 → `context`；(R4) git diff 影响 / PR review 范围 → `detect_changes`。每个 agent **只渲染其 `tools` 覆盖的规则**（如 verify 无 context → 不渲染 R3；plan 无 detect_changes → 不渲染 R4）。
- **FR-004**：在 spec-driver-feature / story / fix / refactor / implement 这 5 个 SKILL.md 的「Phase X 委派子代理」前置说明加「子代理调度时的工具优先级提示」块，要求主编排器 dispatch 时显式注入引导提示。
- **FR-005（响应 codex W-4，可执行化）**：引导文案单一事实源 = `plugins/spec-driver/templates/preference-rules.md`（新增），用 **anchor 注释**（`<!-- preference-rules:R1 -->` 等）标记每条规则。Phase A 各 agent 文件内嵌从 template 派生的规则行，校验测试**按 tool key 逐条比对** agent 文件中的规则行文本 == template 对应 anchor 段（非整段 Markdown diff，避免脆弱）。Phase B SKILL.md 提示块引用 template 路径 + 关键原则锚点。harness 注入块从 template 读取后拼装。
- **FR-006**：引导推荐的 MCP 工具集 ⊆ 各 agent frontmatter `tools` 列表（不修改 tools list，仅校验一致性）。校验测试断言：每个 agent 渲染的规则行涉及的工具 ∈ 该 agent `tools`。
- **FR-007**：F170d harness 在 F170c harness 基础上，通过 `--append-system-prompt "<引导块>"` 注入引导；其余配置（5 task、forbidden literals、Active Call 4 规则、allowedTools、Wilson CI、exit code 语义）与 F170c 逐字一致。
- **FR-008**：harness 的 `--append-system-prompt` 注入必须 fail-fast：若 CLI 不接受该 flag 或注入内容为空，harness exit 2（harness-fatal），不得静默退化。
- **FR-009**：`plugins/spec-driver/docs/spectra-mcp-integration.md` 新增「Driver 偏好引导设计」章节，解释 F170c SC-002 业务洞察、为什么需要这层引导、以及用户自定义引导文案的 override 机制（fork 用户场景）。
- **FR-010**：US3 Grep fallback 路径——引导文案显式包含「MCP 不可用时退回 Grep」原则；harness 提供 graph-not-built 模拟模式验证 fallback。
- **FR-011**：不修改 tool description / response format（F170c 已 ship 字段保留，向后兼容硬约束）。
- **FR-012**：不修改 sub-agent frontmatter tools list（F170a 已对齐保留）。
- **FR-013**：零回归——现有 vitest（基线 3798）继续 pass + build + repo:check + release:check。
- **FR-014（响应 codex W-3，over-call 负控）**：harness 提供可选 negative-control 模式——3 个 non-caller-analysis task（纯文本搜索 / 格式化 / 文档查找类，引导不应触发 MCP）。over-call 软门禁：negative-control 中调用 spectra MCP 的 run ≤ 1/3。作为 **Soft gate**（观察项，不阻塞验收，但 report 必须记录）。
- **FR-015（响应 codex I-1/EC-5）**：harness preflight 记录 `claude --version`，声明最低 Claude Code 版本（已确认 2.1.x 支持 `--append-system-prompt`）；若 flag 不被接受或注入块为空 → exit 2 fail-fast。

### 非功能 / 约束

- **NFR-001（响应 codex I-4，凭据按 SC 拆分）**：
  - **SC-002 (US2)**：仅需 **Claude Max OAuth**（harness 只用 `claude` CLI + 本地 spectra MCP，不调 jury）。
  - **SC-004 (US4) cohort C + jury**：需 Claude Max OAuth + SiliconFlow API key（jury 评分）。
  - 凭据策略见 `docs/shared/agent-eval-credentials-policy.md`，订阅优先，不改 API key 模式。
- **NFR-002**：LLM 实付预算：SC-002 单轮 N=10 仅消耗 Claude Max 订阅配额（边际 $0 实付）；SC-004 jury ~$2-5 实付（SiliconFlow）。多轮迭代上限观察配额 ~5% weekly；若 prompt 多轮迭代触及 ~$15 等价或配额警戒线，立即降阈值或缩 N。
- **NFR-003**：US2 真实跑批时机 = GREEN 阶段实测后再定（已与用户确认）；E2E 静态测（US1/SC-005/SC-006）在 sandbox 跑，真实 driver 测（US2/US3/US4）默认 `.skip`，host shell 手动去 skip。

### Key Entities

- **Preference Rules template**：`plugins/spec-driver/templates/preference-rules.md`（新增，单一事实源）。含 4 条规则（R1-R4，anchor 注释标记）+ 关键原则小节。被 Phase A（agent 文件按 tools 过滤渲染）、Phase B（SKILL.md 提示引用路径）、harness（`--append-system-prompt` 注入时读取拼装）共用。
- **F170d harness**：`scripts/feature-170d-driver-preference.mjs`（复用并参数化 170c harness），新增：`--append-system-prompt` 注入 + 注入块 hash 记录 + preflight `claude --version` 检查 + graph-not-built/invalid-target/error-envelope 模拟模式 + negative-control 模式 + 三层指标报告。
- **E2E test**：`tests/e2e/feature-170d-driver-preference.e2e.test.ts`，US1/SC-006 静态断言（sandbox）+ US2/US3/US4 `.skip` 占位（host shell）。
- **三层指标**：`impactAttemptRate` / `impactResolvedSuccessRate`（= SC-002 主指标）/ `fallbackAfterImpactFailureRate`，harness 分别报告。

---

## Success Criteria

### Measurable Outcomes

| ID | 验收标准 | 测法 | Gate |
|----|---------|------|------|
| SC-001 | 5 个 agent 文件含「工具优先使用规则」章节 + **按 tools 过滤的规则行**（每 agent 3 行，符合 US1 矩阵） | 静态解析 (vitest, sandbox) | Hard |
| SC-002 (Primary) | guided active-call rate ≥ 50%（≥ 5/10 runs，= `impactResolvedSuccessRate`） | host shell harness | Primary pass gate（host-only） |
| SC-003 | Grep fallback：MCP 不可用时 driver 回退 Grep | host shell harness（模拟模式） | Soft（host-only） |
| SC-004 (Secondary) | chained call rate ≥ 30% | host shell cohort C | 不阻塞验收（host-only） |
| SC-005 | 5 个 SKILL.md 全部含子代理调度优先级提示 | 静态解析 (vitest, sandbox) | Hard |
| SC-006 | 单一事实源：agent 文件规则行按 tool key 比对 == template anchor 段；推荐工具 ⊆ frontmatter tools | 静态解析 (vitest, sandbox) | Hard |
| SC-007 | 零回归：vitest + build + repo:check + release:check 全过 | CI 命令 | Hard |
| SC-008 | 不动 tool description / response format / frontmatter tools list | git diff 审查 | Hard |
| SC-009 | over-call 负控：negative-control 中调 MCP 的 run ≤ 1/3 | host shell harness（negative-control 模式） | Soft（host-only，观察项） |

### 验收状态矩阵（响应 codex W-1，区分 sandbox 与 host 完整性）

F170d 的验收状态分四级，**hard gate 静态全过 ≠ feature full PASS**：

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `static-pass` | 所有 sandbox hard gate（SC-001/005/006/007/008）通过 | GREEN 阶段 commit 前必达 |
| `host-pending` | static-pass，但 SC-002 主指标尚未在 host shell 跑 | GREEN 后、host 跑批前的中间态 |
| `primary-pass` | static-pass + SC-002 ≥ 50%（host 实测） | full PASS，feature 达成 Primary Outcome |
| `primary-fail`/`degraded` | static-pass + SC-002 < 50% | 按降级方案处置，记 limitation；feature 仍交付引导基础设施 |

**规则**：SC-002 未执行时只能标 `host-pending`，**不得**标 full PASS。verify 阶段产出的 verification-report 必须显式声明当前处于哪一级。

### 降级方案（Stop-loss）

- **降级 1**：US2 阈值降到 25%（仍是 vs 0% 的显著提升）→ 记 degraded outcome。
- **降级 2**：引导从 SHOULD 升级到 MUST（观察是否 over-call）→ 仅在 US2 实测 <50% 且 codex/用户同意后启用。
- **降级 3**：接受「Sonnet 4.6 偏好仅靠 prompt 引导难改」真相 → 记 limitation，F176 cohort 3 用强制 protocol。
- **预算熔断**：LLM 跑批超 $15 → 立即降阈值或缩 N。

---

## 复杂度评估（供 GATE_DESIGN 审查）

### 组件总数
- 5 个 agent 文件（编辑）+ 5 个 SKILL.md（编辑）+ 1 个共享 template（新增）+ 1 个 harness（新增/参数化）+ 1 个 e2e test（新增）+ 1 个 doc 章节（编辑）= ~14 个触点，但多为文案/prompt 编辑，无源码逻辑改动。

### 接口数量
- 0 个新代码接口（不改 handler / schema / MCP 工具）。harness 新增 1 个 CLI flag（`--append-system-prompt` 透传 + graph-not-built 模拟）。

### 依赖新引入数
- 0。

### 跨模块耦合
- 引导块单一事实源跨 Phase A/B/harness 三处引用——耦合点用校验测试守护。

### 复杂度信号
- 主要风险在 US2 的真实 LLM 行为不可控（driver 偏好可能仍难改），非代码复杂度。
- 单一事实源漂移、harness 注入静默失败是主要工程风险。

### 总体复杂度：**LOW-MEDIUM**（prompt/文案为主，无源码逻辑；风险集中在 LLM 行为实测与单一事实源治理）
