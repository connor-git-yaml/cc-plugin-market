# Requirements Checklist: Feature 187 — 评测设施 v2 FAIL_TO_PASS Oracle

**Purpose**: 验证 spec.md 在进入 plan 阶段前的质量与完整性
**Created**: 2026-06-13
**Feature**: specs/187-eval-harness-v2-failtopass-oracle/spec.md

---

## Content Quality（内容质量）

- [x] CHK-C01 **无实现细节泄漏（语言/框架/API）**
  [PASS] spec 整体聚焦用户价值和行为契约。`child_process.spawn`、`python -m swebench.harness.run_evaluation` 等出现在 FR 中属于接口约束级别描述，并非实现细节。合同字段定义（OracleResult）是可验证的行为规格，不算实现细节。

- [x] CHK-C02 **聚焦用户价值和业务需求**
  [PASS] 每条 User Story 均以"评测工程师希望…"形式表述，背景/动机章节清晰说明修通三分类对评分可信度的业务价值。

- [x] CHK-C03 **面向非技术利益相关者可读**
  [PASS] 背景与动机、Non-Goals 均用业务语言描述。技术术语有说明上下文（如"fuzzy-match 对修复带测试存在单向惩罚"有场景解释）。

- [x] CHK-C04 **所有必填章节已完成**
  [PASS] 包含：背景与动机、User Stories（6 条）、Edge Cases（12 条）、Functional Requirements（FR-001 至 FR-C01）、成功标准（SC-001 至 SC-010）、Non-Goals、关键实体、复杂度评估、技术现实约束。章节完整。

---

## Requirement Completeness（需求完整性）

- [ ] CHK-R01 **无 [NEEDS CLARIFICATION] 标记残留**
  [GAP] E-12（oracleSpecHash 输入范围歧义）和 FR-005-b 均保留 `[需要澄清]` 标注，且 FR-005-b 明确写"范围待澄清"。这是已知未决澄清项，spec 未解决即进入 plan 阶段存在 hash 实现歧义风险（是"oracle.kind + timeout"还是含 swebenchMeta）。

- [x] CHK-R02 **需求可测试且无歧义（FR-001 swebench-execution kind）**
  [PASS] FR-001 至 FR-001-d 均有精确判定规则：kind 值、harness 命令、JSONL 格式、watchdog 独立计时、arm64 回退条件均有具体定义。对应 SC-001 可执行验证。

- [x] CHK-R03 **需求可测试且无歧义（FR-002 三分类）**
  [PASS] 三分类枚举表和环境故障判定规则覆盖 7 种触发条件（exitCode 枚举、timedOut、log 特征字符串、completed=false、pytest exit 5）。SC-002/SC-003 给出具体数值断言（1 pass + 1 fail + 1 error → 50% 完成率）。

- [x] CHK-R04 **需求可测试且无歧义（FR-003 patch 持久化）**
  [PASS] 路径约定 `<fixture_dir>/<run_id>/` 明确，写入失败的降级行为（不执行 cleanup）有明确定义，SC-004/SC-005 分别覆盖文件存在性和 extractDiff 优先级。

- [x] CHK-R05 **需求可测试且无歧义（FR-004 cohort registry）**
  [PASS] 散布点精确到代码行（`cohort-batch.mjs:46-52`、`:167` 等 6 处），throw 条件和错误信息格式（含 cohort id）有明确规格。SC-006/SC-007 可独立验证。

- [ ] CHK-R06 **需求可测试且无歧义（FR-005 freezeBlock / oracleSpecHash）**
  [GAP] FR-005-b 明确标注"范围待澄清"，E-12 同样是 `[需要澄清]` 未决项。`oracleSpecHash` 的 hash 输入范围不明确，导致 SC-008 的实现和测试无法唯一确定。这是进入 plan 前的阻断性歧义。

- [x] CHK-R07 **需求可测试且无歧义（FR-006 manifest 参数化）**
  [PASS] 6 处硬编码参数有具体列举（model、output-format、cleanup、repeat、skipJury、配额检查倍数），US-6 的验收场景覆盖 repeat/skipJury/cleanup 三个参数。FR-006-a 的向后兼容约束可验证。

- [x] CHK-R08 **成功标准可测量且技术无关**
  [PASS] SC-001 至 SC-010 均为行为级断言（返回结构体字段、文件存在、throw 含 id、完成率计算结果）。SC-009 引用 CI 命令是验证方式描述而非实现约束，可接受。SC-010（不触发烧钱评测）以"代码 review + 测试脚本不含全量 batch 调用"为验证方式，属于设计断言，标注清晰。

- [x] CHK-R09 **所有验收场景已定义**
  [PASS] 6 条 User Story 各有 2–5 个独立验收场景，共 19 个场景，覆盖 Happy Path 和主要异常路径（空 patch、cleanup 顺序、promptBuilder 缺失、hash 不匹配）。

- [x] CHK-R10 **边界条件已识别**
  [PASS] E-01 至 E-12 覆盖：arm64 镜像缺失、QEMU segfault、外层超时、pytest exit 5、docker 不可用、passToPass 回归、cleanup 与持久化顺序、漏接 cohort、跑前换 oracle、log 文件不存在、details 过大、oracleSpecHash 范围歧义。覆盖度充分，12 条均关联 FR。

- [x] CHK-R11 **范围边界清晰**
  [PASS] Non-Goals 明确列出 6 项：不改竞品方法论、importer 零改动、不跑全量烧钱评测、fuzzy-match 不删除、产物不入库、不实现方案 B。每项均有可查核的边界描述。

- [x] CHK-R12 **依赖和假设已识别**
  [PASS] 技术现实约束章节列出 5 条，标注来源（tech-research.md）；arm64 覆盖率数据（79.3%）、Python venv 隔离建议、harness 是否联网读取 dataset 的不确定性均标注 `[推断]` 或风险点。

---

## Feature Readiness（特性就绪度）

- [x] CHK-F01 **所有功能需求有明确的验收标准**
  [PASS] FR-001→SC-001/SC-010、FR-002→SC-002/SC-003、FR-003→SC-004/SC-005、FR-004→SC-006/SC-007、FR-005→SC-008、FR-006（US-6 三个场景）、FR-C01 在 Non-Goals 第 1 护栏中体现。对应关系完整。

- [x] CHK-F02 **用户场景覆盖主要流程**
  [PASS] US-1（oracle 换真实执行）、US-2（三分类区分）、US-3（patch 持久化）、US-4（cohort registry）、US-5（freezeBlock 扩展）、US-6（manifest 参数化）覆盖 spec 背景中声明的全部目标。

- [x] CHK-F03 **功能满足 Success Criteria 中定义的可测量成果**
  [PASS] SC-001 至 SC-010 均与背景动机中的核心目标（oracle 替换、三分类修通、不污染分母、持久化、cohort 单一来源、freezeBlock 加固）直接对应，无虚目标。

- [ ] CHK-F04 **规范中无实现细节泄漏（细节审查）**
  [RISK] FR-001-b 写出 `ghcr.io/epoch-research/swe-bench.eval.arm64.*` 具体镜像 registry 名，FR-001-a 写出 `python -m swebench.harness.run_evaluation` 具体命令，FR-004 写出具体文件名和行号（`cohort-batch.mjs:46-52`）。这些是实现层细节，严格按标准属于 spec 内容风险；但考虑到本 feature 的设施代码性质（specs 本身即面向工程师，需精确约束接口），判定为 [RISK] 而非阻断（可接受的例外）。

- [x] CHK-F05 **自测 vs 设计断言区分明确**
  [PASS] spec 在多处明确区分：SC-010 标注"设计断言（代码 review + 测试脚本不含全量 batch 调用）"；各 Story 的"独立可测"段落说明了"unit test mock"vs"最小 fixture 集成测试"的边界；背景明确"本 feature 自测只用最小 fixture（10 个 SWE-L 实例）"。

- [x] CHK-F06 **over-claim 检测**
  [PASS] spec 无越界声明。"本 feature 不跑烧钱评测"在背景（加粗）和 Non-Goals 第 3 条双重声明。不含"已实现"表述。不触及 F188 的全量跑批。fuzzy-match 明确保留不删除，竞品方法论明确不触动。

- [x] CHK-F07 **回归护栏全部落到 Non-Goals/约束且可核查**
  [PASS]
  - 不改竞品方法论 → Non-Goals 第 1 条，SC-010（不调用全量 batch）可核查
  - importer 零改动 → Non-Goals 第 2 条 + FR-001（明确"importer 零改动"），可在 git diff 中核查
  - 产物不入库 → Non-Goals 第 5 条（.gitignore 覆盖），可核查
  - 凭据订阅优先不写 API key 前提 → FR-C01 专门条款，可在脚本 review 中核查

- [x] CHK-F08 **oracle 统一合同字段无歧义**
  [PASS] OracleResult 8 个字段均有类型标注（string / boolean / number|null）和语义说明；三分类枚举表对 pass/fail/error 的判定规则互斥且完备（环境故障充分条件明确，不存在判定冲突）；details 禁止整体截断已明确规定。

- [ ] CHK-F09 **oracleSpecHash 输入范围无歧义**
  [GAP] E-12 明确标注为未决澄清项："仅覆盖 oracle.kind + oracle.timeout 配置，还是还包含 fixture 的 swebenchMeta 字段？两者含义不同"。FR-005-b 写明"范围待澄清"。此歧义直接影响 SC-008 的测试实现和 plan 阶段的 hash 函数设计，属于阻断性缺口。

---

## Notes

- `[x]` = 通过
- `[ ]` = 未通过（GAP 或 RISK，见标注）
- **GAP** = 缺少内容，进入 plan 前需补充或决策
- **RISK** = 存在风险但非强制阻断，可附条件进入 plan

### 未通过项汇总

| 项目 | 类型 | 核心问题 |
|------|------|---------|
| CHK-R01 | GAP | E-12 和 FR-005-b 保留 `[需要澄清]` 标注未解决 |
| CHK-R06 | GAP | `oracleSpecHash` hash 输入范围未确定，SC-008 无法唯一实现 |
| CHK-F04 | RISK | FR 中含具体文件名/行号/命令/镜像 registry（工程设施场景可接受的例外） |
| CHK-F09 | GAP | oracleSpecHash 输入范围歧义与 CHK-R06 同源，plan 阶段必须首先决策 |

### 最关键 GAP

`oracleSpecHash` 的 hash 输入范围（CHK-R06 / CHK-F09）是唯一阻断性歧义：若 plan 阶段未明确，hash 函数实现和预注册校验逻辑将无法可信编写，且 SC-008 测试无法唯一确定验证目标。建议在进入 plan 阶段前，由 spec owner 在 E-12 中作出明确决策（推荐选项：hash 输入 = `oracle.kind + oracle.timeout + oracle.thresholds`，不含 swebenchMeta，理由：oracle 规格本身与数据分离，便于跨 fixture 复用同一 oracleSpecHash）。
