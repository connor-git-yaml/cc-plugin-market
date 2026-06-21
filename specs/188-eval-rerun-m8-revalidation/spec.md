# Feature Specification: M8 评测复测 — 真 oracle 离线重判 + 触发率工程复测

**Feature Branch**: `188-eval-rerun-m8-revalidation`
**Created**: 2026-06-22
**Status**: Draft
**Input**: M8 收尾闭环验证（SC-002/SC-004）：用重构后的可信 FAIL_TO_PASS oracle 复证"trust-repair 到底成没成"

## 背景与定位

M8 Track A 修了价值传导链三处断点：增量正确性、触发率工程（F184）、评测设施 v2（F187 新 oracle + F197 公正性 6 缺陷修）。F188 是**闭环验证** —— 不改任何评测竞品方法论 / importer / oracle 语义，仅用既已就位的可信工具链，为"前述修复是否真有效"**提供两个新的证据维度**（真 oracle 排名 + 触发率实测），而非对"trust-repair 成没成"下单点定论。结论强度严格受 N=133（cohort 内 N≤30 / 触发率 N=30）样本量与方法局限约束，诚实标注、不外推。前置全就位：F184 + F187 + F197 + F176（swebench 预注册 fresh-freeze + 5 cohort smoke PASS）。

本 feature **不产出生产代码改动**，产物是两份评测结论 + 一份入库 publish 报告。所有评测工具零改动复用（见 [research/tech-research.md](research/tech-research.md)）。

### 待澄清的方法论分叉（GATE_DESIGN 拍板）

- **CL-1（候选 untracked 文件处理）**: 离线重判默认只喂 `patch.diff`（已跟踪文件改动），假设 `untracked.tgz` 仅含候选自写测试。但若某候选的修复依赖**新建的非测试源码文件**（落在 untracked.tgz 而非 patch.diff），只喂 patch.diff 会系统性低估该 cohort —— 这恰是 fuzzy-match 被诟病的"结构性惩罚"换皮重现。**FR-011 要求跑前抽检 133 份 untracked.tgz 内容分类**；处置策略（仅排除测试文件、其余非测试源码并入 candidatePatch / 全排除 / 全并入）需在 GATE_DESIGN 由用户拍板，默认取 "排除候选自写测试、并入非测试新建源码"（最贴近 SWE-bench model_patch 正统）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 离线重判 133 份 M7 答卷（Priority: P1）

用真实 FAIL_TO_PASS oracle（F187/F197 的 swebench-execution）对 `~/.spec-driver-bench-patches/m7-f176/` 的 133 份候选 patch 离线重判，回答："M7 报告里基于 fuzzy-match 得出的『修正排名/翻案』结论，在真实测试执行判分下是否成立。"

**Why this priority**: 这是 SC-004 的核心，且**成本近 $0**（仅本地测试执行开销，不烧订阅配额、不依赖 Claude/Codex OAuth）。fuzzy-match 已知对"修复+补测试"形态存在结构性惩罚（M7 §4.5），真 oracle 是唯一权威裁决。P1 因为它无凭据依赖、可立即跑、价值最高。

**Independent Test**: 单独跑离线重判即可交付 —— 输出 133 份答卷的 pass/fail/error 三态分类 + 按 cohort 聚合的真 oracle 通过率排名，与 M7 fuzzy-match 排名并列对比，诚实给出"成立/推翻"。

**Acceptance Scenarios**:

1. **Given** 跑前已抽检 133 份 `untracked.tgz` 内容分类（测试 vs 非测试源码）并按 CL-1 拍板策略构造 candidatePatch + F197 freeze 工具已对当前 oracle 语义重冻结（写入 oracleSpecHash，且与 F176/F197 既冻结值比对无意外漂移），**When** 对每份候选跑 `runSwebenchInstance`（dataset tag = `verified`），**Then** 产出每份的 `{classification, failureSource, reason}`，error 态（基础设施失败）按 ranking 口径剔出分母。
2. **Given** 全部 133 份判分完成，**When** 按 cohort（control/spec-driver/spec-driver-spectra-mcp/superpowers/gstack）聚合真 oracle 通过率，**Then** 得到真 oracle 下的 cohort 排名，**且每 cohort 同时报 `n_total / n_valid / error_rate`**；任一 cohort `error_rate > 30%` 时其 passRate 标注为"低置信、排名不可比"，不参与翻案判定。
3. **Given** 真 oracle 排名 vs M7 fuzzy 结论，**When** 撰写结论，**Then** 明确回答"fuzzy 翻案的修正排名在真实判分下成立 or 推翻"，附 N=133（cohort 内 N≤30）样本量、各 cohort error_rate 与方法局限（CL-1 untracked 处置选择）诚实标注，不 over-claim。

---

### User Story 2 — 触发率工程复测（Priority: P2）

F184 触发率工程后的增量验证：跑 c1（control）+ c3（spec-driver-spectra-mcp）两 cohort × 10 task × N=3 = 60 runs，测**双指标**，对照 F176 telemetry 基线，回答"子代理 MCP 触发率较 F176 是否显著提升"（SC-002）。

**双指标定义（消除 lift 退化歧义）**：
- **指标 1 — 触发率（绝对量）**: c3 每 run MCP 调用数，报 **均值 + bootstrap 95% CI**；判定锚点 = F176 基线 1.77 调用/run 与 SC-002 阈值 ≥2/run。c1 触发率恒为 0（无 MCP 注入），仅作机制对照、不入 lift 分母。
- **指标 2 — 完成率 lift（c3 vs c1）**: 真 oracle 通过率的 lift = `c3_passRate / c1_passRate`（这是有意义、可计算的 lift，衡量 MCP 注入是否提升修复质量）。**注意：触发率本身不算 lift**（c1=0 分母退化、数学不可比），lift 专指完成率维度。

**Why this priority**: P2 因为它**烧订阅周配额**（60 runs）且依赖 Claude Max + Codex OAuth（启动时实测 Claude OAuth 已过期 401，需用户先 `claude /login`）。价值真实但有外部阻塞与配额约束，排在无依赖的 P1 之后。

**Independent Test**: 单独跑 c1/c3 两 cohort 即可交付触发率结论 —— 输出 c3 实测触发率（调用/run）、是否跨过 ≥2 阈值、相对 F176 基线的提升量，c1 作零 MCP 基线。

**Acceptance Scenarios**:

1. **Given** Claude/Codex OAuth 已 host shell 重新授权 + SiliconFlow key 就位 + 配额未超限，**When** 跑 c1/c3 × 10 task × N=3，**Then** 经 telemetry（`SPECTRA_MCP_TELEMETRY_PATH`）采集 c3 每 run MCP 调用数（含 `parent_tool_use_id` 子代理归因），c1 作零基线。
2. **Given** 60 runs telemetry 落盘，**When** 聚合双指标，**Then** 报：指标 1 = c3 触发率均值 + bootstrap 95% CI；指标 2 = c3/c1 完成率 lift。
3. **Given** N=30（c3）样本量，**When** 给显著性结论，**Then** 用可机判规则定口径：**"显著提升 vs F176"当且仅当 c3 触发率 bootstrap 95% CI 下界 > 1.77**；**"达标"当且仅当 CI 下界 ≥ 2.0**；CI 跨越基线/阈值则判"噪声带内、不显著"。不达标如实报，禁把 CI 内波动称"显著提升"。

---

### Edge Cases

- **OAuth 跑批中过期**：长批 resume 前必 `claude /login` preflight（既往事故）。子进程 401 → 暂停，不静默继续产生假阴性 telemetry。
- **配额超限**：跑批 ≥30 runs 时每 6 runs 查配额；≥60% weekly → **停下问用户**（分日跑 or 终止），不擅自烧穿。
- **oracleSpecHash 不符**：跑前 `checkPreregistration` 若报 oracleSpecHash mismatch → hard-fail 拦截，禁"跑中换判分"，需先查清语义模块为何变动。
- **dataset 错配**：离线重判 dataset tag 必须 `verified`（F197 `datasetTagToHfId` 映射）；误用 `lite` 会导致 Verified instance 静默剔除分母 → 排名失真。
- **error 态污染排名（两面）**：基础设施失败（docker/venv/超时在测试开跑前）必须判 `error` 并剔分母，不可误计 fail 拉低某 cohort；**反向**，剔分母会让高 error cohort 的 passRate 虚高 → 必须同时报 `n_valid / error_rate`，error_rate > 30% 的 cohort passRate 标低置信、不参与排名（见 FR-012）。
- **候选 untracked 含非测试源码（C-1 关键陷阱）**：`untracked.tgz` 不一定只有测试 —— 若候选的修复落在**新建非测试源码文件**，只喂 `patch.diff` 会漏掉修复主体、系统性低估该 cohort（fuzzy 结构性惩罚换皮）。跑前 MUST 抽检 133 份 untracked 内容分类（FR-011），按 CL-1 拍板策略构造 candidatePatch（默认：排除候选自写测试文件、并入非测试新建源码），并在报告披露各 cohort untracked 非测试源码占比。
- **缺 docker/venv 环境**：离线重判依赖本地 swebench harness（docker + `scripts/.swebench-venv`）；环境缺失 → 判分前置失败，需先 `setup-swebench-venv.sh`，非评测结论。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001（离线重判）**: 系统 MUST 用 `scripts/lib/swebench-oracle.mjs` 的 `runSwebenchInstance` 对 133 份 `~/.spec-driver-bench-patches/m7-f176/{task}/{cohort}/r{N}/` 候选逐份判分，dataset tag 固定 `verified`；candidatePatch 构造见 FR-011。
- **FR-002（判分口径）**: 系统 MUST 按 `classifyRunForRanking` 口径聚合：pass→分子+分母、fail→分母、error/缺失→剔分母；按 cohort 输出真 oracle 通过率排名，**并随排名输出每 cohort `n_total / n_valid / error_rate`**。
- **FR-003（冻结护栏）**: 跑前 MUST 用 `scripts/freeze-preregistration.mjs --swebench-oracle` 对当前 oracle 语义重冻结写入 oracleSpecHash，且 `checkPreregistration` 通过；跑中 oracle 语义模块零改动。
- **FR-004（对照结论）**: 系统 MUST 将真 oracle cohort 排名与 M7 PUBLISH-REPORT 的 fuzzy-match 排名逐 cohort 对照，明确给出"fuzzy 翻案结论成立 / 推翻"，禁 over-claim。
- **FR-005（触发率复测）**: 系统 MUST 跑 c1（control）+ c3（spec-driver-spectra-mcp）× 10 task × N=3，经 telemetry 采集 c3 每 run MCP 调用数。
- **FR-006（双指标）**: 系统 MUST 报：指标 1 = c3 触发率均值 + bootstrap 95% CI（锚 1.77 基线、≥2 阈值）；指标 2 = c3/c1 真 oracle 完成率 lift。触发率维度**不报 lift**（c1=0 退化）。
- **FR-007（凭据前提）**: 系统 MUST 走订阅 OAuth（codex driver / claude judge1 边际 $0）+ SiliconFlow key（judge2/3 真实扣费）；**MUST NOT** 把 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 写作启动前提。
- **FR-008（配额护栏）**: 跑批 ≥30 runs 时 MUST 每 6 runs 检查周配额；≥60% weekly MUST 暂停问用户。
- **FR-009（产物边界 + 机器校验）**: 评测产物（fixture/patch/auto-report/run_artifacts/.swebench-venv）MUST 不入库（已 gitignore）；仅 `PUBLISH-REPORT-M8.md`（manual）+ spec/plan/tasks 入库，用显式路径提交，**禁 `git add -A`**；`specs/src.spec.md` 排除。提交前 MUST 机器校验：拟提交文件集 ⊆ 白名单路径（`specs/188-eval-rerun-m8-revalidation/**` 且不含 verification 下的 run 产物），违规即中止。
- **FR-010（报告）**: 系统 MUST 产出 `specs/188-eval-rerun-m8-revalidation/PUBLISH-REPORT-M8.md`，增补 M8 章节并交叉链接 F176 报告 / M7 PUBLISH-REPORT。
- **FR-011（candidatePatch 构造，C-1）**: 跑前 MUST 解包抽检 133 份 `untracked.tgz`，按文件路径分类为"候选自写测试" vs "非测试源码"；按 CL-1 拍板策略构造喂入 oracle 的 candidatePatch（默认 = `patch.diff` + untracked 非测试源码，排除候选自写测试），并统计各 cohort 非测试 untracked 文件占比写入报告。
- **FR-012（error 有效性，C-2）**: 系统 MUST 对每 cohort 计算 `error_rate = n_error / n_total`；`error_rate > 30%` 的 cohort，其 passRate MUST 标注"低置信、不参与翻案排名"，避免剔分母虚高。
- **FR-013（冻结漂移核验，W-3）**: 重冻结前 MUST 把当前 oracleSpecHash 与 F176/F197 既冻结的 oracleSpecHash 比对；若不一致 MUST 在报告披露语义模块 delta 与原因（区分"F197 后正常演进"vs"意外漂移"），不静默用新 hash 覆盖既冻结锚。

### Key Entities

- **答卷（answer sheet）**: 一份 `(task, cohort, repeat)` 的候选 patch.diff（共 133 份），离线重判的判分单元。
- **oracle 判分结果**: `{classification: pass｜fail｜error, failureSource, reason}`，per 答卷。
- **cohort 聚合**: per-cohort 真 oracle 通过率 + 与 fuzzy 排名对照。
- **telemetry entry**: per MCP 调用记录（toolName/runId/durationMs…），触发率统计输入。
- **PUBLISH-REPORT-M8**: 人工撰写的 publish-grade 入库结论文档。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-004（离线重判，对应子任务 1）**: 133 份答卷离线重判完成（n_valid/n_total/error_rate 逐 cohort 披露），真 oracle 下的 cohort 修正排名 vs M7 fuzzy 翻案结论给出明确"成立/推翻"判定（高 error_rate cohort 标低置信不入排名），附样本量、CL-1 untracked 处置选择诚实标注。
- **SC-002（触发率，对应子任务 2）**: c3 触发率均值 + bootstrap 95% CI 报出；**机判口径**"显著提升 vs F176" ⟺ CI 下界 > 1.77、"达标" ⟺ CI 下界 ≥ 2.0、否则判"噪声带内不显著"；指标 2 完成率 lift（c3/c1）报出；不达标如实报。
- **SC-003（护栏零破坏）**: 评测产物零入库（提交前机器校验文件集 ⊆ 白名单）、oracle 语义跑前冻结+漂移核验、跑中零改动、dataset tag = verified、凭据走订阅 OAuth 无 API-key 前提；全部满足。
- **SC-001（交付）**: `PUBLISH-REPORT-M8.md` 入库，交叉链接 F176/M7；凭据 preflight 通过；配额未超限（或超限时已暂停问用户）。

## 范围外（Out of Scope）

- 不改任何评测竞品方法论 / importer / oracle 语义 / fuzzy-match 算法。
- 不新增评测 cohort、不扩展 task 集（沿用 F176 冻结的 10 task）。
- 不跑 c2/c4/c5 触发率（c2/c4/c5 无 MCP 注入，触发率恒零，复测无信息量）；离线重判仍覆盖全 5 cohort 答卷。
- 不 ship 任何生产代码；不 npm publish。
