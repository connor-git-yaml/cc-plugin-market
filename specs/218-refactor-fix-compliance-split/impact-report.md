# 影响分析报告 — F218 fix-compliance-core 拆分

## 重构目标
- 目标: `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（当前 819 行，29 个 export；初稿误记 30，codex 审查 W-2 修正）
- 类型: file
- 意图: 抽 F216 证据门纯函数到新子模块 `fix-compliance-execution-record.mjs`，core 回落 + 提取 `toSingleMatchProbe` DRY helper
- 分析方式: 图谱 stale（35b285d，F216 symbol 未入图），全程 Grep/Read fallback，未卡建图

## 影响范围
- 直接引用文件数: 4（judge.mjs / io.mjs / core.test.mjs / judge-cli.test.mjs）
- 间接引用文件数: 1（io.test.mjs → 经 io.mjs 传递依赖 core）
- 新建文件: 1（fix-compliance-execution-record.mjs）
- 跨包引用: 否（全部落在 `plugins/spec-driver/` 单包内）
- 风险评级: **medium**（文件数低但存在硬约束：全量 re-export 契约 + 潜在 ESM 环 + 门禁关键逻辑等价迁移）

## 影响文件清单

| 文件 | 引用类型 | 层级 | 跨包 | 从 core 导入的符号 | 拆分后是否需改 import |
|------|---------|------|------|------------------|---------------------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 目标 | 0 | 否 | — | 内部改造（迁出+re-export+import back） |
| `plugins/spec-driver/scripts/lib/fix-compliance-execution-record.mjs` | 新建 | 0 | 否 | — | 新文件 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | direct | 1 | 否 | detectFixSkillExpansion, extractDelegationsAfter, resolveFeatureDirCandidate, classifyClosureForm, **extractExecutionRecordsAfter**, judgeCompliance, MISSING_ACTION_TEXT, DUAL_PATH_GUIDANCE, GATE_DEGRADED_PREFIX_LINE | **不改**（靠 core re-export） |
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | direct | 1 | 否 | normalizeTranscriptEntry, resolveEnforcementFromConfig（均 STAY 于 core） | **不改** |
| `plugins/spec-driver/tests/fix-compliance-core.test.mjs` | direct | 1 | 否 | 静态: normalizeTranscriptEntry, detectFixSkillExpansion, extractDelegationsAfter, classifyDelegationRole, resolveFeatureDirCandidate, checkArtifactSection, classifyClosureForm, judgeCompliance, resolveEnforcementFromConfig, MISSING_ACTION_TEXT, ENFORCEMENT_VALUES；动态(CORE_MODULE_URL): flattenToolResultContent, normalizeCommandConservative, parseNoopReconLines, deriveAssertionStatus, extractExecutionRecordsAfter, classifyReproEvidence, **computeFenceMask**, DUAL_PATH_GUIDANCE | **不改**（靠 core re-export，见下） |
| `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | direct | 1 | 否 | MISSING_ACTION_TEXT（STAY） | **不改** |
| `plugins/spec-driver/tests/fix-compliance-io.test.mjs` | indirect | 2 | 否 | 仅 import io.mjs（不直接 import core） | **不改** |

> 另有纯文档提及（非运行时依赖，不破坏）：`specs/208/*`、`specs/211/plan.md`、`specs/216/*`、`plugins/spec-driver/tests/fixtures/fix-compliance/README.md`。这些是设计文档里的模块名引用，模块仍存在即不受影响。

## 待迁移导出：内部/外部调用者与迁移策略

新模块 `fix-compliance-execution-record.mjs` 拟收：flattenToolResultContent、deriveAssertionStatus、extractExecutionRecordsAfter、normalizeCommandConservative、parseNoopReconLines、classifyReproEvidence + 常量 SENTINEL_PASS/SENTINEL_FAIL/EXECUTION_OUTPUT_SUMMARY_LIMIT/NOOP_RECON_HEADING_REGEX。

| 导出 | core 内部调用者（去留） | 外部调用者（文件:行） | 迁移策略 |
|------|----------------------|--------------------|---------|
| `flattenToolResultContent` (110) | **normalizeTranscriptEntry** (core:166, **STAY**) | core.test:636（动态） | 迁移 + **core re-export** + **core import back**（STAY 函数 normalizeTranscriptEntry 依赖它 → 形成 core→新模块边） |
| `deriveAssertionStatus` (567) | extractExecutionRecordsAfter (core:651, 迁移) | core.test:818（动态） | 纯迁移 + core re-export（内部依赖随迁，自洽） |
| `extractExecutionRecordsAfter` (594) | 无（仅 @param 注释 666） | **judge.mjs:144** + core.test:858（动态） | 迁移 + core re-export（judge.mjs 直依赖，re-export 保 import 面） |
| `normalizeCommandConservative` (483) | classifyReproEvidence (core:679/681, 迁移) | core.test:712（动态） | 纯迁移 + core re-export（内部依赖随迁，自洽） |
| `parseNoopReconLines` (497) | **judgeCompliance** (core:778, **STAY**) | core.test:725（动态） | 迁移 + core re-export + **core import back**（STAY judgeCompliance 调它） |
| `classifyReproEvidence` (669) | **judgeCompliance** (core:777, **STAY**) | core.test:950（动态） | 迁移 + core re-export + **core import back** |
| `SENTINEL_PASS/FAIL` (555/556) | deriveAssertionStatus (迁移) | 无 | 纯迁移（无外部 import，re-export 可选但建议保留对称） |
| `EXECUTION_OUTPUT_SUMMARY_LIMIT` (558) | extractExecutionRecordsAfter (迁移) | 无 | 纯迁移 |
| `NOOP_RECON_HEADING_REGEX` (474) | **stripReconSubblock** (core:401, **STAY**) + parseNoopReconLines (core:520, 迁移) | 无 | 迁移 + **core import back**（STAY stripReconSubblock 依赖它）— 或考虑保留于 core，见风险 §ESM 环 |

### 反向依赖：新模块需要从 core 取的符号
- `parseNoopReconLines` 用 **`computeFenceMask`**(core:500) 与 **`NOOP_JUDGMENT_HEADING_REGEX`**(core:506，STAY) → 新模块须 `import` 自 core。
- 结论：**core ⇄ 新模块存在双向依赖（ESM 环）**。所有用点都在函数体内（运行时惰性绑定），ESM 可容忍，但属架构异味，是本次首要风险（见风险评级）。

## computeFenceMask 去留裁决

- **调用者 4 处**：extractSectionBody(core:360 STAY)、stripReconSubblock(core:397 STAY)、classifyClosureForm(core:451 STAY)、parseNoopReconLines(core:500 迁移）。**3/4 留守 core**。
- **外部依赖**：core.test.mjs:1323 动态 `import { computeFenceMask }` from CORE_MODULE_URL → 无论去留，**该符号必须能从 core 解析**（移走则 core 必须 re-export）。
- **语义定位**：computeFenceMask 是通用 markdown fenced-code 掩码原语，非 F216 证据门专属，与 SENTINEL/repro 判据无耦合。
- **裁决建议：留在 core（不迁移）**。理由：(1) 3/4 消费者是 core 留守函数，迁走会让 core→新模块的反向边从 2 个符号扩到 4 个函数依赖，加重 ESM 环；(2) 语义上属通用 markdown 工具而非执行记录逻辑；(3) 留 core 则 core.test:1323 的动态 import 零改动即通过。
- **更干净的可选项（超出本任务"仅 1 新模块"范围，供 plan 裁决）**：把 computeFenceMask + 两个 heading 正则 + `toSingleMatchProbe` 下沉到一个**叶子模块** `fix-compliance-markdown.mjs`，core 与新模块都单向依赖它 → **彻底消除 ESM 环**。代价：新增第 2 个模块，需在 core re-export computeFenceMask 以保 core.test:1323。

## toSingleMatchProbe：6 处位置与落点

模式（逐字）：`new RegExp(<re>.source, <re>.flags.replace('g', ''))` — 把带 `/g` 的正则转成单次匹配探针。

| # | 行号 | 所在函数（去留） | 探针目标正则 |
|---|------|----------------|------------|
| 1 | 361 | extractSectionBody (core STAY) | requiredHeading |
| 2 | 375 | extractSectionBody (core STAY) | requiredHeading |
| 3 | 421 | checkArtifactSection (core STAY) | requiredHeading |
| 4 | 452 | classifyClosureForm (core STAY) | NOOP_JUDGMENT_HEADING_REGEX |
| 5 | 453 | classifyClosureForm (core STAY) | ROOT_CAUSE_HEADING_REGEX |
| 6 | 506 | parseNoopReconLines (**迁移**) | NOOP_JUDGMENT_HEADING_REGEX |

- 分布：**5/6 在 core 留守函数，1/6 在迁移函数**。无外部 import 该 helper（纯内部 DRY）。
- **落点建议**：`toSingleMatchProbe(re)` 与 computeFenceMask 同域（都是 markdown/regex 原语）。
  - 若采纳 computeFenceMask 留 core → helper 放 **core**，`export` 之（新模块需 import，ESM 要求 export；无外部消费者，additive export 无害），新模块 parseNoopReconLines 从 core 引用（该 new→core 边已因 computeFenceMask 存在，不新增环）。
  - 若采纳叶子模块方案 → helper 随 computeFenceMask 进 `fix-compliance-markdown.mjs`，core 与新模块各自 import，最干净。
- 提取后净省约 5 行（6 处 → 1 helper + 6 调用），对 core 行数目标影响有限。

## 兼容性策略（核心结论）

- **约束刚性**：判断依据是"judge.mjs / io.mjs / 三个测试的现有 import 语句无需改动即可通过"。core.test.mjs 通过 `CORE_MODULE_URL = new URL('.../fix-compliance-core.mjs')` **动态** import 了全部迁移函数（flattenToolResultContent/normalizeCommandConservative/parseNoopReconLines/deriveAssertionStatus/extractExecutionRecordsAfter/classifyReproEvidence）**以及 computeFenceMask**。
- 因此 **"直接改测试 import 指向新模块" 方案不可行**——那会改动测试 import 语句，违反兼容约束。
- **唯一满足约束的路径：core 全量 re-export 转发**。core 顶部/尾部追加：
  ```
  export {
    flattenToolResultContent, deriveAssertionStatus, extractExecutionRecordsAfter,
    normalizeCommandConservative, parseNoopReconLines, classifyReproEvidence,
    SENTINEL_PASS, SENTINEL_FAIL, EXECUTION_OUTPUT_SUMMARY_LIMIT, NOOP_RECON_HEADING_REGEX,
  } from './fix-compliance-execution-record.mjs';
  ```
  并对 core 留守函数所需符号 `import { flattenToolResultContent, parseNoopReconLines, classifyReproEvidence, NOOP_RECON_HEADING_REGEX } from './fix-compliance-execution-record.mjs'`（供 normalizeTranscriptEntry / stripReconSubblock / judgeCompliance 调用）。
- **破坏面最小方案 = core re-export 转发**（判定明确）。judge.mjs / io.mjs / 两测试静态 import / judge-cli.test / io.test 全部零改动通过。

## 风险评级：medium

- 文件面窄（≤7，无跨包）本应 low，但以下硬约束上抬至 **medium**：
  1. **全量 re-export 契约**：迁移的 6 函数 + 4 常量 + computeFenceMask 全部经 core.test 动态 import 消费，re-export 漏一个即测试 import 失败（收集期崩溃）。
  2. **ESM 双向环风险**：core↔新模块互相 import（core 用 parseNoopReconLines/classifyReproEvidence/flattenToolResultContent/NOOP_RECON_HEADING_REGEX；新模块用 computeFenceMask/NOOP_JUDGMENT_HEADING_REGEX）。运行时可容忍但脆弱，需 plan 明确"接受受控环"或"引叶子模块解环"。
  3. **门禁关键逻辑等价迁移**：这些函数直接决定 fix 模式 no-op 复现证据门放行/阻断（FR-007/FR-015/FR-018），任何行为漂移都是回归，须逐函数 behavior-preserving。
- **行数目标提示**：迁移约 250 行，加 re-export/import-back 约 15 行，core 现实落点约 **560–590 行**（低于 600 监控线，但 plan 自设 ~500 目标偏乐观，除非把 computeFenceMask/markdown 域一并下沉）。

## 关键裁决点汇总（供 plan 阶段决策）
1. computeFenceMask：建议**留 core**（3/4 消费者留守 + 通用原语 + 免动 core.test:1323）。
2. ESM 环：建议 plan 二选一——(A) 接受受控运行时环（最小改动，仅 1 新模块）；(B) 引 `fix-compliance-markdown.mjs` 叶子模块承载 computeFenceMask + heading 正则 + toSingleMatchProbe 以解环（更干净，+1 模块）。
3. 兼容：**core re-export 转发是唯一合规路径**，测试/judge/io import 面零改动。
