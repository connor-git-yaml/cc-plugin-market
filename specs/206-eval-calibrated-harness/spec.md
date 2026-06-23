# Feature Specification: 难度校准的评测/验证 Harness（/goal 可迭代）

**Feature Branch**: `206-eval-calibrated-harness`
**Created**: 2026-06-23
**Status**: Draft
**Input**: 建一套难度校准的冻结集/验证集评测系统——任务难度能让工具看出差距（不太易不太难）、单次验证跑 ~30min（可并行几路）、有清晰指标体系支持 /goal 反复优化

## 背景与动机

F188 发现现有评测任务集（10 个 SWE-V）**难度饱和**：真 oracle + OAuth 校正后所有 cohort 都贴在 83-100% 天花板，**分不出我们与竞品的高下**（c3 我们 85.7% vs c4 SuperPowers 100%，差距落噪声带）。同时暴露两类测量伪影（fuzzy 判分层 + OAuth 生成层），均已修复。

要真正驱动产品能力提升，需要一套**测量仪器**满足三条（用户拍板）：
1. **难度校准**：任务难到能区分工具、又不至于全员失败（discriminating）。
2. **预算可控**：单次验证跑 ~30min，可并行几路。
3. **指标清晰**：单一可机读标量，支持 `/goal` 反复"改→测→留/弃"。

并严守 **held-out 纪律**：冻结集只在里程碑量一次，绝不参与迭代（防过拟合，这是 M8 trust-repair 的延续）。

> **诚实前提（codex CR-2）**：`/goal` 是通用 skill，能读仓库任意文件——所以"机器**阻止** /goal 读冻结集"是做不到的硬话。本系统的 held-out 防线是**三层**而非单层 machine-prevention：(1) **工具默认**：/goal 的度量入口只跑 validation 集，冻结集需另一条显式"里程碑评分"命令；(2) **不入库 gold**：冻结集只入库 task id + 锚，gold patch / oracle 结果跑时从 HF 拉、不落库可读路径；(3) **过拟合检测（真安全网）**：里程碑用冻结集量一次，"验证涨而冻结平"即判过拟合。**防线核心是检测，不是不可达的阻止**——诚实标注，不 over-claim 隔离强度。

## 设计决策（GATE_DESIGN 已拍板）

| 维度 | 选择 |
|------|------|
| 难度校准 | **经验校准**：实跑候选池，保留组间有 spread 的任务 |
| 验证跑配置 | **只跑我们工具 c3 × ~10 任务 × N=1**，4-6 路并行 → ~30min |
| 优化指标 | **单一标量 = 验证集真 oracle 完成率**（pass rate） |
| 集合划分 | **同难度池随机 disjoint 切两半** → 冻结集（held-out）+ 验证集（dev） |

### CL-1 已拍板（GATE_DESIGN）：混合校准

**N=1 校准不可靠**（每 (任务,cohort) 单次 pass/fail 是抛硬币噪声），但纯经验 N≥3 ≈ 17hr 太贵。**已定混合**：
- **启发式预筛**：用 patch 行数 / 改文件数 / 多文件 / 测试数等中等难度代理，把 Verified 500 缩到 ~30 候选（固定 seed）。
- **N=3 经验校准**：~30 候选 × {c1 control, c3 我们} × N=3（≈ 180 run / 6 并行 ≈ 5hr 一次性）。selecting cohort 用 c1/c3 两端足够定中段；如需竞品 spread 可后续扩 c4/c5。
- **noise-aware discriminating + c3 敏感性**（FR-003/FR-009）：CI 不重叠才算真区分；验证集额外偏 c3 中段任务（对 /goal 的 c3 小改动敏感）。

**本轮范围（用户拍板）**：只交付"仪器"代码（校准脚本 + 集合划分 + 并行 harness + /goal 指标入口 + 测试），**不实跑校准批**（~5hr 烧 Claude 配额，由用户有窗口时一条命令启动）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 难度校准 + 集合划分（Priority: P1）

从 SWE-bench Verified 候选池经验校准出"中等难度"任务集（能区分工具），随机 disjoint 切成冻结集 + 验证集，冻结锚定。

**Why this priority**: 这是整套系统的地基——没有 discriminating 任务集，后面的验证跑 + /goal 优化全是优化噪声（F188 的教训）。一次性成本，产出长期复用的两个集合。

**Independent Test**: 跑校准 → 产出 calibrated pool（每任务带组间 spread 数据）+ frozen/validation 两集合（disjoint，同难度分布）+ 冻结锚（taskSetHash / fixtureContentHash）。可独立验证：每个入选任务确有组间 spread；两集合不重叠；难度分布一致。

**Acceptance Scenarios**:

1. **Given** 候选池（CL-1 定规模）+ 校准 cohort × **N≥2**，**When** 并行跑校准（复用 F188 oracle + OAuth 防污染，带硬墙钟上限 + 早停），**Then** 每候选得 per-cohort pass 率 + bootstrap CI。
2. **Given** 校准结果，**When** 按 **noise-aware** 判据筛（聚合 pass 率 ∈ 中间带 **且** 至少一对 cohort CI 不重叠），**Then** 得 calibrated pool（剔全员饱和 + 剔 spread 落噪声内的伪区分）。
3. **Given** calibrated pool，**When** 按难度**分层** disjoint 切两半（池太小则扩候选重校准），**Then** frozen + validation 互不重叠、每箱内难度分布一致；各自冻结 taskSetHash + fixtureContentHash + seed。

---

### User Story 2 — 30min 并行验证 harness + /goal 指标（Priority: P1）

提供一个并行验证跑器：只跑我们工具（c3）× 验证集 × N=1，4-6 路并行，~30min 内出**单一标量 = 真 oracle 完成率**，供 `/goal` 反复调用优化。

**Why this priority**: 这是 `/goal` 迭代循环的执行器 + 度量。没有它，"反复优化"无从落地。与 P1 并列 P1，因为系统价值 = 校准集合 × 可迭代 harness，缺一不可。

**Independent Test**: 跑验证 harness（任意工具版本）→ 30min 内输出 `{ passRate, n_valid, n_total, perTask }` 单一标量结果。可独立验证：墙钟 ≤ 预算、并行度生效、passRate 机读、OAuth 失败自动剔除不污染。

**Acceptance Scenarios**:

1. **Given** 验证集（~10 任务）+ 工具版本（c3），**When** 跑并行验证 harness（4-6 路并发），**Then** ~30min 内完成全部 run（生成 + 真 oracle 判分），墙钟 ≤ 预算上限。
2. **Given** 验证跑完成，**When** 聚合，**Then** 输出**单一主标量 `passRate`**（带 bootstrap CI）+ 机读 JSON；**只 infra 失败剔分母**（复用 `isGenerationInfraFailure`），**生成超时计 fail**（工具太慢=真劣势，不剔，CR-3）；`infraFailRate > FLOOR` 则作废重跑（W-5）。
3. **Given** `/goal` 调用 harness，**When** 修改工具后重跑，**Then** 拿到新 passRate + CI，按 MIN_DELTA 纪律 keep/discard（防噪声抖动）；harness 默认入口只接 validation 集，冻结集评分是另一条显式里程碑命令（held-out 三层防线，**检测**为核心非机器阻止）。

---

### Edge Cases

- **校准成本爆炸**：候选池 × cohort × 生成（~10min/run）易超时 → 候选池**随机抽样 + 关键 cohort + 并行**封顶（如 50 候选 × 4 cohort × N=1，6 路并行 ≈ 几小时一次性）。
- **discriminating 判据落空**：若候选池筛出的中等难度任务 < 所需（20+），降级：扩大候选抽样重跑校准，**而非**放宽判据混入饱和任务（宁缺毋滥）。
- **30min 超预算**：单 run 偶发慢（冷建镜像/重流程跑满轮次）→ harness 设单 run 超时上限 + 整体墙钟预算；超时 run 剔分母标注，不拖垮整批。
- **held-out 泄漏**：/goal 迭代误读冻结集 → 机器校验 harness 输入只接受 validation 集 id；冻结集 oracle 结果不在 /goal 可达路径。
- **并行 docker 资源争抢**：N 路并发 swebench oracle 抢 docker → 并行度可配 + cache_level=env 暖缓存降单 run 成本；资源不足时降并行度而非失败。
- **验证集饱和漂移**：随工具变强，验证集可能逐渐饱和（都解出）→ 定期复校准信号（验证集聚合 pass 率 > 上界阈值时提示重校准）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001（候选池）**: 系统 MUST 从 SWE-bench Verified（`datasetTagToHfId('verified')`）选候选池（CL-1 拍板：混合预筛 or 纯随机抽样），固定 seed，复用 F188 fixture import + fixtureContentHash 锚定。
- **FR-002（经验校准）**: 系统 MUST 对候选池跑校准 cohort × **N≥2（CL-1 定）**，并行执行，复用 F188 真 oracle（`runSwebenchInstance`）+ OAuth 防污染（`isGenerationInfraFailure` 剔分母）；MUST 设**硬墙钟上限 + 早停**（候选够 discriminating 数即停，W-1）。
- **FR-003（noise-aware discriminating 判据，CR-1）**: 系统 MUST 用**噪声感知**判据，不靠单次 pass/fail：每 cohort 按 N≥2 估 pass 率 + bootstrap CI；"discriminating"= 聚合 pass 率 ∈ 中间带 [LO,HI] **且** 至少一对 cohort 的 pass 率 CI **不重叠**（spread 超过二项噪声带）。剔全员饱和（全 0/全 1）+ 剔"spread 落在噪声内"的伪区分任务。阈值在 plan/校准报告固化。
- **FR-004（分层 disjoint 划分，W-3）**: 系统 MUST 对 calibrated pool 按难度分箱（如 c3 pass 率三档）**分层** disjoint 切两半 → frozen + validation；每箱内 disjoint 抽样保两集合难度分布一致；池太小（<阈值）→ 扩候选重校准（不强切）。各集合冻结 taskSetHash + fixtureContentHash + seed。
- **FR-005（并行验证 harness + 硬预算合同，W-6）**: 系统 MUST 提供并行验证跑器：默认只跑 c3（可配）× validation × N=1，并行度可配（默认 4-6）；**机器可验收预算**：单 run 超时 `RUN_TIMEOUT`（默认 20min）+ 整批硬墙钟上限 `BUDGET_MS`（默认 35min）；超 BUDGET_MS 即停并标 over-budget（不靠"≈30min"软话）。
- **FR-006（指标 + timeout 语义，CR-3/W-5）**: 验证 harness MUST 输出**单一主标量 `passRate`** + 机读 JSON（`{passRate, n_valid, n_total, n_pass, infraFailRate, genTimeoutCount, wallClockMs, perTask}`）。**剔分母语义精确**：只有 **infra 失败**（docker/oracle/OAuth，复用 `isGenerationInfraFailure`）剔分母；**生成超时 = 候选 fail**（工具太慢是真能力/效率劣势，不能剔出让慢任务凭空消失，CR-3）。**fail-closed（W-5）**：`infraFailRate > FLOOR`（默认 20%）→ 该次验证**作废需重跑**（不出可比 passRate），防某版本靠多触发 infra 缩分母虚高。
- **FR-007（/goal 集成 + 比较纪律，W-2）**: 系统 MUST 提供 `/goal` 可调用入口（一条命令跑验证 → 输出 passRate）。MUST 附**比较纪律**：passRate 带 bootstrap CI；keep 当且仅当**新版 CI 下界 > 旧版均值 + 最小提升阈值 MIN_DELTA**（防 n≈10 噪声内抖动被当真提升）；记录 /goal 迭代轮次供过拟合回检。
- **FR-008（held-out 三层防线，CR-2 诚实降级）**: 系统 NOT claim 机器**阻止** /goal 读冻结集（通用 skill 做不到）。MUST 实现三层：(1) /goal 度量入口默认只接 validation 集 id，冻结评分是另一条显式命令；(2) 冻结集只入库 id + 锚，gold/oracle 结果不落库；(3) **过拟合检测**：提供里程碑命令在冻结集量一次，"validation 涨而 frozen 平"即报过拟合（真安全网）。
- **FR-009（c3 敏感性，W-4）**: validation 集 MUST 额外偏向**对 c3 改动敏感**的任务（c3 pass 率中段、非 0 非 1），否则任务能区分竞品却对 /goal 的 c3 小改动无感、迭代无信号。
- **FR-010（复用 + 零方法论改动）**: 系统 MUST 复用 F188：oracle 语义、cohort 注册表、fixture import、OAuth 防污染、cohort 子集能力（manifest.cohorts）；不改判分语义。
- **FR-011（产物边界 + 可追溯，I-2）**: run 产物（fixtures/run_artifacts/中间判分）MUST 不入库（gitignore）；入库 frozen/validation **清单 + 锚（taskSetHash/fixtureContentHash/seed）** + 校准报告（manual，含每候选的 per-cohort pass 率 + CI + discriminating 判定，供复现审计）。

### Key Entities

- **候选池 (candidate pool)**: Verified 随机抽样的 N_cand 任务，校准输入。
- **calibrated pool**: 经验校准后保留的 discriminating 任务（带组间 spread 元数据）。
- **frozen set / validation set**: calibrated pool 的 disjoint 二分；frozen=held-out（里程碑），validation=dev（/goal 迭代）。
- **验证结果 (validation result)**: `{passRate, n_valid, n_total, perTask, wallClockMs}`，/goal 的度量。
- **冻结锚**: taskSetHash + fixtureContentHash + seed，绑定集合身份防篡改/漂移。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001（headroom，非循环论证，CR-4）**: calibrated pool **避免天花板/地板饱和**（无全 0/全 1 任务），且 discriminating 判定**经噪声检验**（至少一对 cohort CI 不重叠，spread 非抖动）。**诚实口径**：本 SC 只声明"集合有 headroom + spread 真实"，**不**声明"证明了可外推的工具能力差异"（那需在新 held-out 上复现）。
- **SC-002（机器可验收预算，W-6）**: 单次验证跑（c3 × ~10 任务 × N=1，配并行度）墙钟 **≤ BUDGET_MS（默认 35min 硬上限）**；超时即停标 over-budget；实测墙钟 + 并行度 + 单 run 超时计数随结果输出。
- **SC-003（指标可用 + 可比，W-2/W-5）**: 验证 harness 输出单一机读 `passRate`（带 bootstrap CI）；`/goal` 一条命令调用、拿标量、按 MIN_DELTA + CI 纪律比较 keep/discard；`infraFailRate > FLOOR` 时作废重跑（不出失真可比值）。
- **SC-004（held-out 三层 + 检测，CR-2）**: 三层防线落地（默认入口只跑 validation / 冻结集不落 gold / 里程碑过拟合检测命令可用）；frozen/validation 分层 disjoint + 难度分布一致 + 各自冻结锚。**不 over-claim 机器隔离**。
- **SC-005（防伪影继承，I-3 扩展）**: 校准 + 验证复用 F188 真 oracle + OAuth 防污染；**不引入新伪影**——timeout 当 fail 不剔分母（CR-3）、infra-rate fail-closed（W-5）、并发资源争抢降并行度而非静默失败。

## 范围外（Out of Scope）

- 不在本 feature 内跑 `/goal` 的实际优化循环（本 feature 只造"仪器"：校准 + 集合 + harness + 指标；优化是仪器就绪后的后续工作）。
- 不改 F188 既有 oracle / cohort / 判分语义。
- 不扩展到 SWE-bench 之外的 benchmark（Verified 足够；其他 benchmark 按需后续）。
- 不做自动复校准（验证集饱和漂移只给提示信号，重校准由人触发）。
