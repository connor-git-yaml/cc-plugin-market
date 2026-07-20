# Tasks: fix 模式 no-op 出口可执行证据门

**Feature**: 216-fix-noop-evidence-gate
**Input**: [plan.md](./plan.md)（R2+编排器同步修正版）· [spec.md](./spec.md)（19 FR / 7 SC / 10 EC，能力边界已补 Codex 适配注记）
**Branch**: `claude/f216-noop-evidence-gate-85136d`
**修订记录**：本版为 Codex 对抗审查 NO-GO（4 critical）后的修订版，吸收 C1（Codex 边界降级）/ C2（runner 全局修正）/ C3（io→core 归属修正）/ C4（时序 fixture 期望修正）+ 若干 W/analyze 项。

**TDD 硬顺序**：每个实现任务前必须先有对应"红测试"任务转为依赖；红测试任务验收 = 测试存在且指定用例判定失败；实现任务验收 = 同一用例转绿且不破坏既有用例。
**⚠️ 测试 runner 铁律（C2，全局适用）**：`plugins/spec-driver/tests/*.test.mjs` 是 **node:test** 套件（`import { describe, it } from 'node:test'`），**不被 `npx vitest run` 收集**。所有涉及这些文件的命令 MUST 使用：
- 单文件全量：`node --test plugins/spec-driver/tests/<file>.test.mjs`
- 红阶段锁定单用例：先给新用例起**唯一测试名**（如 `F216 T007 <行为简述>`），执行 `node --test --test-name-pattern='<唯一名>' plugins/spec-driver/tests/<file>.test.mjs`，验收 = 该命令**非零退出**且输出含该用例 `not ok`
- 绿阶段：同一 `--test-name-pattern` 命令 exit 0；**且**跑一次不带 pattern 的单文件全量确认既有用例零回归
- **红阶段对尚不存在的 export**（如某函数还未在 `fix-compliance-core.mjs` 导出）MUST 用 dynamic `import()` 或先建可调用 stub（`export function xxx(){ throw new Error('not implemented') }`）编写红用例，**禁止**用静态 `import { xxx } from '...'` 直接引用不存在的具名导出——那会让整个模块在 node:test 收集期直接失败，无法定位到具体 `not ok` 用例
- 全量门禁另需 `npm run test:plugins`（脚本为 `node --test "plugins/spec-driver/tests/**/*.test.mjs"`），不能只跑 `npx vitest run`

**模型档位**：实现类（core/io/judge/SKILL 修改）标注 **opus**；测试与 fixture 类（红测试编写、fixture 构造、只读校验）标注 **sonnet**（遵循仓库模型选择策略：生产代码 Opus 保质量、测试 Sonnet 控成本）。
**Phase 依赖**：Phase 0 → 1 → 2 → 3 → 4 → 5 → 6，硬顺序检查点，不可跳过或乱序。Phase 内标 [P] 的任务在**产出文件层面**互不冲突可并行；涉及**同一测试文件的多次追加编辑**（README 索引、judge-cli 测试文件）不视为真正并行安全，需按任务列出顺序串行落笔（各任务描述内已标注）。

---

## Phase 0 · FR-017 真实 Bash transcript fixture 锚定（前置，最先）

> 目标：以 **Claude Code 真实 fixture 为唯一权威依据**冻结 `ExecutionRecord` 字段路径 + 执行 C4 exitCode 分支门禁裁决；Codex 侧因 rollout schema（`custom_tool_call`/`custom_tool_call_output`，非 `tool_use`/`tool_result` 形态）与本期 core 判据模型不同构，降级为**非阻断的 schema 差异记录任务**，不参与字段冻结与门禁裁决（C1）。

### T001 采集真实 Claude Code Bash transcript fixture

- **描述**：在真实 Claude Code 会话中执行一条最小 Bash 命令（如 `echo hello`），从该会话的 transcript JSONL 中截取 assistant `tool_use`（`type:"tool_use"`, `name==='Bash'`）与对应 user 侧 `tool_result` 的最小片段，脱敏后写入 `plugins/spec-driver/tests/fixtures/fix-compliance/real-bash-transcript-claude.jsonl`。
- **采集步骤**：(1) 起一个真实 Claude Code 会话，经 Bash 工具跑一条无害命令；(2) 定位该会话的 transcript 文件；(3) 抽取仅含该次 Bash tool_use + tool_result 的最小行集；(4) 脱敏——**只替换路径/命令输出/ID 值，保留 block 类型、content 形态（string vs block-array）、字段位置与 ID 关联**；(5) 记录采集时 CLI version 与采集日期；(6) 显式记录本次实际观测到的 `content` 形态（string / block-array，若为 block-array 记录顶层元素 `type` 分布）与是否观测到数字退出码字段（有/无 + 字段路径）。
- **文件**：`plugins/spec-driver/tests/fixtures/fix-compliance/real-bash-transcript-claude.jsonl`（新增）+ `plugins/spec-driver/tests/fixtures/fix-compliance/README.md`（追加一行索引：runtime=Claude Code、CLI version、采集日期、观测到的 content 形态、是否观测到退出码字段）
- **依赖**：无
- **验收判据**：文件存在、为合法 JSONL（每行 `JSON.parse` 成功）；至少含 1 条 assistant `tool_use`（`name==='Bash'`）与其对应 user 侧 `tool_result`（`tool_use_id` 匹配）；README 新增条目完整（runtime/version/日期/content 形态/退出码观测结论）。
- **FR/SC 映射**：FR-017、AD-1（风险 #3 缓解）
- **模型档位**：sonnet

### T002 Codex rollout schema 差异记录（非阻断，文档参照）

- **描述**：本任务**不参与** Phase 0 字段冻结与 C4 门禁裁决（C1 降级）。从真实 Codex 会话的 rollout 文件（`~/.codex/sessions/**/rollout-*.jsonl`）中截取一条最小 `custom_tool_call`（`name==="exec"`）与对应 `custom_tool_call_output` 片段，脱敏后写入 `plugins/spec-driver/tests/fixtures/fix-compliance/real-bash-transcript-codex.jsonl`，**仅作 schema 差异的文档参照**，不要求也不断言其符合 Claude 形态 `tool_use(name==='Bash')`/`tool_result` 结构。
- **文件**：`plugins/spec-driver/tests/fixtures/fix-compliance/real-bash-transcript-codex.jsonl`（新增，可为 Codex 原生 `custom_tool_call`/`custom_tool_call_output` 形态，不强制转换为 Claude 形态）+ README 追加条目（runtime=Codex、CLI version、采集日期、观测到的字段形态摘要、**与 Claude 形态的差异点列表**）
- **依赖**：无（与 T001 并行，互不阻塞；T003 不依赖本任务）
- **验收判据**：文件存在为合法 JSONL；README 新增条目明确列出 Codex rollout 的 `custom_tool_call`/`custom_tool_call_output` 字段与 Claude `tool_use`/`tool_result` 字段的对应关系或差异（**不要求**字段路径一致，**不要求**出现 `name==='Bash'`）；本任务产出**不阻断** T003 及后续任何 Phase。
- **FR/SC 映射**：FR-017（Codex 部分降级为文档参照，非机械核验范围，见 spec Out of Scope「runtime 边界」）
- **模型档位**：sonnet

### T003 冻结 ExecutionRecord 字段映射（以 Claude fixture 为准）+ 执行 C4 exitCode 分支门禁裁决

- **描述**：基于 **T001 的 Claude Code fixture**（唯一权威依据），逐字段核对 `tool_use.id`/`name`/`input.command`/`tool_result.tool_use_id`/`is_error`/`content`（string 与 block-array 两形态）字段路径；与 `scripts/lib/driver-eval-core.mjs` 既有配对逻辑做交叉核对（AD-1 要求镜像其 use/result 配对模式）。**content 双形态验收方式修正**：逐 runtime 记录实际观测形态（T001 已记录 Claude 侧观测结论）；对**未观测到**的形态（如 T001 只观测到 string 未观测到 block-array，或反之）不得凭空实现，而是构造**合成兼容 fixture**（人工按已知 schema 文档构造，非真实采集）并在 README/裁决记录中显式标注"合成兼容，非真实观测"。据此在 plan.md 追加一个「Phase 0 裁决记录」小节，写明：(a) 冻结后的 ExecutionRecord 字段映射表（含每个字段是"真实观测"还是"合成兼容标注"）；(b) C4 exitCode 分支门禁裁决结果——若 T001 fixture 暴露数字退出码字段则选分支 (a)（非零→INCONCLUSIVE / PASS+非零→contradiction 判据），否则选分支 (b)（SKILL wrapper 形态 + 能力边界补注一句）；(c) **一句 Codex schema 差异记录**：引用 T002 产出，注明"Codex rollout 走 `custom_tool_call`/`custom_tool_call_output` 而非 `tool_use`/`tool_result`，本期 core 判据模型不做 Codex 原生适配，留待 A3（Codex 一体分发轨道）评估是否需要 schema 适配层"。
- **文件**：`specs/216-fix-noop-evidence-gate/plan.md`（追加裁决记录，不改动既有正文，仅新增小节）；若裁决为分支 (b)，同时追加 `specs/216-fix-noop-evidence-gate/spec.md`「能力边界声明」一句补注
- **依赖**：T001（**仅此一项**；T002 并行非阻断，不构成依赖）
- **验收判据**：plan.md 新增小节明确写出 Claude fixture 的字段路径核对结论 + C4 分支裁决（(a) 或 (b)，二选一，非模糊）+ Codex schema 差异一句记录；若选 (b)，spec.md 能力边界声明段落已追加对应一句（可 diff 核对）。
- **FR/SC 映射**：FR-014、FR-016、FR-017、AD-1、AD-3（C4）
- **模型档位**：opus（架构裁决）

---

## Phase 1 · normalizeTranscriptEntry / flattenToolResultContent 落点修正（C3：归属 core 而非 io）

> 前置：Phase 0 完成（字段映射已冻结）。**归属修正**：`normalizeTranscriptEntry` 与 `flattenToolResultContent` 实际落点在 `fix-compliance-core.mjs`（而非最初误判的 `fix-compliance-io.mjs`）；io 层的 `readTranscriptEntries` 只做文件读取/坏行跳过/大小上限等 I/O 边界，调用 core 侧归一化函数，故 io 侧本 phase 只需补集成回归，不需要新实现。

### T004 红测试：normalizeTranscriptEntry 保留 ExecutionRecord 字段 + flattenToolResultContent 直测

- **描述**：在 `fix-compliance-core.test.mjs` 新增用例（**直接测试 core 内 `normalizeTranscriptEntry`/`flattenToolResultContent`，而非通过 io 层间接测试**）：
  1. `normalizeTranscriptEntry`：`toolUseBlocks[].id` 被保留（缺失时为 `null`）；新增独立字段 `toolResultBlocks: {toolUseId, isError, flattenedContent}[]`（不并入 `textBlocks`/`toolUseBlocks`）；所有返回分支（含 parseError/非对象）恒带 `toolResultBlocks: []`
  2. `flattenToolResultContent`（直接单测该函数，不经 `normalizeTranscriptEntry` 间接验证）：`content` 为 string → 直取；为 array → 仅取顶层 `type==='text'` 块（`typeof text==='string'`）按序 `\n` 拼接、非文本块忽略、不递归 nested array（除非 T003 裁决升级为深度 ≤2 递归）；输出完整、无预截断
  3. `fake-anchor-in-tool-result.jsonl` 反伪造回归——fake tool_result 不影响锚点/委派/目录提名判定（复用既有 fixture，断言不因新字段解析而改变既有判定结果）
- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（改，新增用例，测试名前缀 `F216 T004 ...`）
- **依赖**：T003
- **验收判据**：`node --test --test-name-pattern='F216 T004' plugins/spec-driver/tests/fix-compliance-core.test.mjs` 非零退出、输出含新增用例 `not ok`（`normalizeTranscriptEntry`/`flattenToolResultContent` 尚未实现所需字段/函数）；既有用例不受影响（若函数尚未存在，用动态 `import()` 或 stub 编写红用例，避免静态 import 让整个文件收集期失败）。
- **FR/SC 映射**：FR-016（数据模型扩展）、AD-2
- **模型档位**：sonnet

### T005 实现：core 侧 normalizeTranscriptEntry 扩展 + flattenToolResultContent

- **描述**：在 `fix-compliance-core.mjs` 实现/扩展 `normalizeTranscriptEntry`（保留 `toolUseBlocks[].id` + 新增 `toolResultBlocks` 字段，恒带空数组，20MB/坏行/全损坏行为不变——注：文件读取与上限判断仍在 io 层，此处仅指归一化函数对已读入 entry 的处理）与 `flattenToolResultContent`（按 T004 断言实现 flatten 规则）。**严格遵守 AD-2**：tool_result 内容只进独立字段，绝不并入 `textBlocks`/`toolUseBlocks`（反伪造语义不回退）。
- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（改，~50-70 行）
- **依赖**：T004
- **验收判据**：`node --test --test-name-pattern='F216 T004' plugins/spec-driver/tests/fix-compliance-core.test.mjs` exit 0；`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`（单文件全量）确认既有用例零回归。
- **FR/SC 映射**：FR-016、AD-2
- **模型档位**：opus

### T006 io 侧集成回归：readTranscriptEntries 调用链不变

- **描述**：在 `fix-compliance-io.test.mjs` 补充集成回归用例（**不新增实现，仅验证 io 层调用 core 归一化函数后行为不变**）：`readTranscriptEntries`（或等价入口函数）经调用链最终产出的 entry 含 T005 新增字段（`toolUseBlocks[].id`/`toolResultBlocks`）；既有 20MB 文件上限、坏行静默跳过、全损坏 → `transcript-unavailable` 三项行为**回归不变**；`fake-anchor-in-tool-result.jsonl` 反伪造回归在 io 层入口测试中同样不变。
- **文件**：`plugins/spec-driver/tests/fix-compliance-io.test.mjs`（改，新增用例，测试名前缀 `F216 T006 ...`；仅新增，不删除既有用例）
- **依赖**：T005
- **验收判据**：`node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` 全绿（新增用例 + 既有用例零回归）。
- **FR/SC 映射**：FR-016、AD-2
- **模型档位**：sonnet

---

## Phase 2 · core 判据实现

> 前置：Phase 1 完成（`normalizeTranscriptEntry`/`flattenToolResultContent` 已落 core 且 io 集成回归绿）。按 plan §2 三组函数拆分：解析/规范化 → 断言判定 → 证据集合决策表，逐组红后绿。

### T007 [P] fixture：解析与 malformed 系列（含 plan L318 全量枚举）

- **描述**：构造以下 fixture（遵循现有 envelope 结构约定，参照 README 现有格式）：
  - `noop-recon-malformed-row.jsonl`：`### 复现对账` 区块含**一条**坏 JSON 候选行
  - `noop-recon-one-green-one-broken.jsonl`：两条声明，一条完整合法 PASS 一条 malformed（验证不"一绿一坏"误放行）
  - `noop-cmd-with-backtick-pipe-heredoc.jsonl`：命令含反引号/管道/多行 heredoc/双引号/连续反斜杠转义（单行 JSON `\n` 编码）+ 真实执行 PASS
  - **malformed 枚举补齐**（可在上述文件内多声明覆盖，或建 `noop-recon-malformed-enum.jsonl` 一个文件内含多条覆盖以下每种坏形态，各自单独一条 bullet，供 T008 逐条断言）：(1) 坏 bullet 前缀 `* ` 而非 `- `；(2) `-{` 无空格直接跟 JSON；(3) 区块内出现非 bullet 正文（普通说明文字未放区块外）；(4) `expected` 字段值为 `"FAIL"`（非法字面量）；(5) `expected` 字段值为数字类型；(6) `expected` 字段缺失；(7) `claim`/`command` 字段缺失或空字符串
- **文件**：`plugins/spec-driver/tests/fixtures/fix-compliance/{noop-recon-malformed-row,noop-recon-one-green-one-broken,noop-cmd-with-backtick-pipe-heredoc,noop-recon-malformed-enum}.jsonl`（新增）+ README 索引追加对应行
- **依赖**：T006（**README 追加需在 T001/T002 已落笔的索引基础上串行追加**，避免并发写同一文件冲突；fixture 文件本身与 T010/T013 fixture 组在不同文件、可并行构造）
- **验收判据**：4 个文件均为合法 JSONL；README 新增行含"期望判定"列（对应 `noop:repro-fields` 系列全部标注）。
- **FR/SC 映射**：FR-002、FR-016（C1/C3）
- **模型档位**：sonnet

### T008 红测试：parseNoopReconLines + normalizeCommandConservative

- **描述**：在 `fix-compliance-core.test.mjs` 新增用例（测试名前缀 `F216 T008 ...`），覆盖：单行 JSON 解析对反引号/管道/heredoc/续行/双引号/连续反斜杠命令无损（用 T007 fixture）；**逐条断言 T007 malformed 枚举的全部 7 种坏形态**均计入 `malformedCandidateCount` 而非静默丢弃；区块定位规则（至下一同级/上级标题或文件尾）；`expected` 字段冻结（非 `"PASS"` 字面量一律 malformed）；`normalizeCommandConservative` 仅去首尾空白+折叠尾随换行、**不去引号**（引号差异不等价断言）。
- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（改，新增用例）
- **依赖**：T007
- **验收判据**：`node --test --test-name-pattern='F216 T008' plugins/spec-driver/tests/fix-compliance-core.test.mjs` 非零退出、含新增用例 `not ok`（`parseNoopReconLines`/`normalizeCommandConservative` 未实现，用 stub/dynamic import 编写）；既有用例不受影响。
- **FR/SC 映射**：FR-002、FR-016（C1/C3）
- **模型档位**：sonnet

### T009 实现：parseNoopReconLines + normalizeCommandConservative

- **描述**：新增两个纯函数（plan §2）：`parseNoopReconLines(fixReportContent)` 返回 `{records, malformedCandidateCount}`；`normalizeCommandConservative(cmd)`。**注**：`flattenToolResultContent` 已在 T005 实现，本任务不重复实现。
- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（改，新增函数）
- **依赖**：T008
- **验收判据**：`node --test --test-name-pattern='F216 T008' plugins/spec-driver/tests/fix-compliance-core.test.mjs` exit 0；`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` 单文件全量确认零回归。
- **FR/SC 映射**：FR-002、FR-016
- **模型档位**：opus

### T010 [P] fixture：sentinel 断言与冲突系列

- **描述**：构造以下 fixture：
  - `noop-output-no-sentinel.jsonl`：执行完成但输出无合法整行末行 sentinel
  - `noop-contradiction-fail-sentinel.jsonl`：声称 PASS 但执行末行 FAIL / 双 sentinel 同现
  - `noop-long-output-truncation.jsonl`：超大 tool_result（验证 `outputSummary` 展示截断不影响判定——判定在完整 `flattenedContent` 上算）
- **文件**：`plugins/spec-driver/tests/fixtures/fix-compliance/{noop-output-no-sentinel,noop-contradiction-fail-sentinel,noop-long-output-truncation}.jsonl`（新增）+ README 索引追加（**在 T007 README 追加之后串行落笔**）
- **依赖**：T006（fixture 文件本身可与 T007/T013 并行构造，README 追加需串行）
- **验收判据**：3 个文件为合法 JSONL；README 追加期望判定（分别 `noop:repro-output-mismatch` / `noop:repro-contradiction` / 绿）。
- **FR/SC 映射**：FR-014、FR-019（EC-002）
- **模型档位**：sonnet

### T011 红测试：deriveAssertionStatus 四态 + extractExecutionRecordsAfter 逐项锁定

- **描述**：新增用例（测试名前缀 `F216 T011 ...`）覆盖：
  1. `deriveAssertionStatus` 四态：`PASS`/`FAIL`（唯一合法 sentinel 且为末行非空行）、`CONTRADICTION`（≥2 合法 sentinel 或 PASS/FAIL 同现）、`INCONCLUSIVE`（0 合法 sentinel，或唯一 sentinel 非末行）；CRLF/lone-CR 归一化为 `\n`；ANSI 色码装饰行拒绝识别为 sentinel；grep 模式串/源码摘录类噪声文本不被误判为 sentinel
  2. `extractExecutionRecordsAfter` **逐项锁定**：(a) **anchor 窗口过滤**——仅收 `lineIndex > anchorLineIndex` 的 tool_use，锚点前的同名命令执行不计入；(b) **非 Bash 排除**——`name !== 'Bash'` 的 tool_use 一律不产出 ExecutionRecord；(c) **ID join**——`tool_use.id` 与 `tool_result.tool_use_id` 精确匹配才 `paired:true`；(d) **未配对 result**——有 tool_use 无匹配 tool_result 时 `paired:false`、`isError:null`、`assertionStatus` 不参与判定；(e) **定位行字段**——`toolUseLineIndex`/`toolResultLineIndex` 正确反映来源行号，缺 result 时 `toolResultLineIndex:null`
- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（改，新增用例）
- **依赖**：T010、T009
- **验收判据**：`node --test --test-name-pattern='F216 T011' plugins/spec-driver/tests/fix-compliance-core.test.mjs` 非零退出、含新增用例 `not ok`；既有用例不受影响。
- **FR/SC 映射**：FR-014、FR-016（C2/W5、AD-3）
- **模型档位**：sonnet

### T012 实现：deriveAssertionStatus + extractExecutionRecordsAfter

- **描述**：新增 `deriveAssertionStatus(flattenedContent)` 按 plan §1 sentinel 规则；`extractExecutionRecordsAfter(entries, anchorLineIndex)` 镜像 `driver-eval-core.mjs` use/result 配对模式（自包含实现、零跨目录 import），仅收 `name==='Bash'` 且 `lineIndex > anchorLineIndex` 的 tool_use 按 id join tool_result，产出 `ExecutionRecord[]`（字段含 `id/name/command/toolUseLineIndex/toolResultLineIndex/paired/isError/flattenedOutput/assertionStatus/outputSummary`，`outputSummary` 为展示截断 ≈2000 字符、不参与判定）。若 T003 裁决为 exitCode 分支 (a)，此处同步实现非零退出 INCONCLUSIVE / PASS+非零 contradiction 判据。
- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（改，新增函数）
- **依赖**：T011
- **验收判据**：`node --test --test-name-pattern='F216 T011' plugins/spec-driver/tests/fix-compliance-core.test.mjs` exit 0；单文件全量零回归。
- **FR/SC 映射**：FR-014、FR-016、AD-3
- **模型档位**：opus

### T013 [P] fixture：证据集合条件并行与时序系列（C4 修正）

- **描述**：构造以下 fixture：
  - `noop-result-missing.jsonl`：Bash tool_use 有但无配对 tool_result（截断）
  - `noop-tool-error.jsonl`：Bash 执行 `is_error===true`
  - `noop-multikey-missing-and-error.jsonl`：单声明证据集合内既有 unpaired 又有 is_error 记录（条件并行同现，`result-missing`+`tool-error`）
  - `noop-multikey-error-and-output-mismatch.jsonl`：单声明证据集合内既有 `is_error` 记录又有 `paired∧¬isError∧assertionStatus===INCONCLUSIVE` 记录（`tool-error`+`output-mismatch` 双键同现）
  - `noop-multikey-triple-missing-error-mismatch.jsonl`：单声明证据集合内同时有 unpaired、is_error、INCONCLUSIVE 三类记录（`result-missing`+`tool-error`+`output-mismatch` 三键同现）
  - `noop-multiexec-fail-then-pass.jsonl`：同命令先 FAIL 后 PASS（证据集合时序 ×1）→ 期望 `noop:repro-contradiction`（PASS/FAIL 冲突）
  - `noop-multiexec-pass-then-fail.jsonl`：同命令先 PASS 后 FAIL（证据集合时序 ×2）→ 期望 `noop:repro-contradiction`（PASS/FAIL 冲突）
  - `noop-multiexec-pass-plus-noresult.jsonl`：同命令一次 PASS + 一次无 result（证据集合时序 ×3）→ **期望 `noop:repro-result-missing`（C4 修正：unpaired 记录命中行 2 result-missing，非 contradiction；plan 决策表 contradiction 仅限 FAIL/冲突场景，unpaired 独立判 result-missing）**
- **文件**：8 个 `.jsonl` 新增于 `plugins/spec-driver/tests/fixtures/fix-compliance/` + README 索引追加（**在 T010 README 追加之后串行落笔**）
- **依赖**：T006（fixture 构造可与 T007/T010 并行，README 追加需串行）
- **验收判据**：8 个文件均为合法 JSONL；README 追加期望判定与上述描述逐一对应（含 C4 修正后的 `noop-multiexec-pass-plus-noresult.jsonl` → `result-missing`）。
- **FR/SC 映射**：FR-016、FR-019（C2/C3 条件并行、拒绝"任一绿即绿"）
- **模型档位**：sonnet

### T014 红测试：classifyReproEvidence 条件并行决策表 + 6 键文案完整性 + 覆盖补齐

- **描述**：新增用例（测试名前缀 `F216 T014 ...`）覆盖 plan §2 条件并行判定表全部行（0-5）：
  1. 块级前置短路（`### 复现对账` 缺失/空/malformed→`noop:repro-fields`）；**含"核心层旧报告完全无 `### 复现对账` 区块"用例（不依赖 judge-cli 层，纯 core 单测参数化覆盖，验证 FR-011 在 core 层的判据来源）**
  2. 每声明 E 空→仅 `command-mismatch`
  3. E 非空并行判定 2-5 行：单键各自命中（用 T013 单键 fixture）；**双键同现**（`result-missing`+`tool-error`、`tool-error`+`output-mismatch`）；**三键同现**（`result-missing`+`tool-error`+`output-mismatch`）——均断言 `missing[]` 同时含全部对应键
  4. 证据集合时序三态：前两态判 `contradiction`（拒绝任一绿即绿），**第三态（C4 修正）判 `result-missing`**
  5. `classifyClosureForm` 正交返回结构 `{closureForm, hasRepairAnchor, hasNoopAnchor}`
  6. **每个 missing key 都有 `MISSING_ACTION_TEXT` 文案**（防漏配单测：遍历 6 个 canonical key 逐一断言存在对应文案）；**每条 `MISSING_ACTION_TEXT` 内嵌 JSON 示例经 `JSON.parse` 断言合法**（W7）
  7. 跨声明并集去重（对齐 spec"多缺失 MUST 合并全部列出"）
- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（改，新增用例）
- **依赖**：T013、T012
- **验收判据**：`node --test --test-name-pattern='F216 T014' plugins/spec-driver/tests/fix-compliance-core.test.mjs` 非零退出、含新增用例 `not ok`；既有用例不受影响。
- **FR/SC 映射**：FR-002、FR-003、FR-004、FR-014、FR-016、FR-019（C2/C3/W10）
- **模型档位**：sonnet

### T015 实现：classifyReproEvidence + judgeCompliance noop 扩展 + 6 键文案 + classifyClosureForm 正交化

- **描述**：新增 `classifyReproEvidence(records, executionRecords)` 实现条件并行判定表（逐声明累计全部适用键、跨声明并集去重，含 C4 修正后的 unpaired→result-missing 独立判据不与 contradiction 混淆）；将 `classifyClosureForm` 返回值由字符串扩为 `{closureForm, hasRepairAnchor, hasNoopAnchor}`（AD-4，`closureForm` 字段保留原三值，向后兼容）；`judgeCompliance` 在 `hasNoopAnchor===true` 分支接入证据校验，missing 键并入现有 `missing[]` 结构；新增 6 个 `MISSING_ACTION_TEXT` 常量条目（措辞见 plan §2 表格，逐字落地）。**同步更新现有 caller**（`judgeCompliance` 内部对 `classifyClosureForm` 返回值的消费点 + 既有测试对该函数返回值的断言）以适配新返回形态。
- **文件**：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（改，核心新增 ~120-160 行——注意此文件将越过 500 行，本期按 plan「Codebase Reality Check」结论**不前置拆分**，仅作监控项记录）
- **依赖**：T014
- **验收判据**：`node --test --test-name-pattern='F216 T014' plugins/spec-driver/tests/fix-compliance-core.test.mjs` exit 0；`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` 单文件全量（含 T004/T008/T011/T014 全部新增用例 + 既有用例）零回归；`wc -l plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 记录实际行数（供后续 follow-up 拆分参考，非本任务阻断项）。
- **FR/SC 映射**：FR-002、FR-003、FR-004、FR-006、FR-014、FR-016、FR-019、AD-4
- **模型档位**：opus

---

## Phase 3 · judge 编排接线

> 前置：Phase 2 完成（core 层判据函数齐备）。**注（W）**：T017/T018/T019 均改同一 `fix-compliance-judge-cli.test.mjs` 文件，去除并行标记，显式**串行**执行 T017→T018→T019。

### T016 fixture：判定分支端到端 + 回归护栏系列（含 EC-003/EC-007 具名断言）

- **描述**：构造/升级以下 fixture：
  - `noop-unverified-citation.jsonl`（新增）：V008 形态合成——判定依据引用行号 + 零 Bash 执行（SC-001 核心，非原始回放）
  - `compliant-noop-with-repro.jsonl`（新增）：诚实 no-op——单行 JSON 对账 + 真实 Bash + 唯一末行 PASS sentinel
  - `legacy-noop-without-repro.jsonl`（新增）：旧形态 no-op（有判定依据但无 `### 复现对账`），验证 FR-011 向后兼容
  - `legacy-repair-no-noop-anchor.jsonl`（新增）：旧 repair（无 noop 锚点），验证证据门零介入（FR-007）
  - `noop-dual-anchor-missing-repair.jsonl`（新增）：双锚点，缺 repair 合同（无 verification/implement 委派），repro 满足
  - `noop-dual-anchor-missing-repro.jsonl`（新增）：双锚点，repair 合同满足但缺 repro 证据
  - `noop-dual-anchor-both-satisfied.jsonl`（新增）：双锚点，两合同均满足
  - `compliant-noop.jsonl`（**改，回归护栏升级**）：补 `### 复现对账` 单行 JSON + 配对真实执行记录 + 末行 PASS sentinel，否则合法 no-op 会被新合同堵死（风险 #2）
  - **`noop-non-bash-tool-execution.jsonl`（新增，EC-007 具名断言）**：复现"执行"经非 Bash 工具（如自定义 MCP 工具调用）产生，无对应 Bash tool_use/tool_result → 期望判 `noop:repro-command-mismatch`（MVP 不支持非 Bash 复现，按缺 Bash 痕迹处理）
  - **`noop-no-repro-claims.jsonl`（新增，EC-003 具名断言）**：`## 判定依据` 章节存在但无任何 `### 复现对账` 子内容（症状因环境依赖无法构造复现，GATE_DESIGN Q2 已拍板不开替代证据例外）→ 期望判 `noop:repro-fields`
- **文件**：10 个 `.jsonl`（9 新增 + 1 改）于 `plugins/spec-driver/tests/fixtures/fix-compliance/` + README 索引更新（**在 T013 README 追加之后串行落笔**）
- **依赖**：T015
- **验收判据**：10 个文件均为合法 JSONL；README 索引更新完整（含期望判定列，EC-007/EC-003 两条注明对应 Edge Case 编号）；`compliant-noop.jsonl` 改动后原有引用它的既有测试用例在 T017 中同步核对。
- **FR/SC 映射**：FR-002、FR-006、FR-007、FR-011、FR-018、SC-001、SC-002、EC-003、EC-007
- **模型档位**：sonnet

### T017 红测试：judge-cli SC-001/SC-002/FR-011/FR-018 端到端 + `--mode report` 用例

- **描述**：在 `fix-compliance-judge-cli.test.mjs` 新增用例（测试名前缀 `F216 T017 ...`）：
  - `noop-unverified-citation.jsonl` → block 档判不合规、exit 2、反馈含"要求产出 repro"的 next-step（SC-001）
  - `compliant-noop-with-repro.jsonl` → 合规放行 exit 0（SC-002）
  - 升级后 `compliant-noop.jsonl` → 合规放行 exit 0（回归护栏不误伤）
  - `compliant-full.jsonl`（真修复路径）→ 证据门零介入、继续绿（FR-007）
  - `legacy-noop-without-repro.jsonl` → block 档 exit 2 + `noop:repro-fields`（FR-011）
  - `legacy-repair-no-noop-anchor.jsonl` → 证据门零介入（FR-007/W8）
  - 三个双锚点 fixture 分别断言"repair missing + repro 满足"/"repro missing + repair 满足"/"两者皆满足合规放行"（FR-018 可达性，C4）
  - `noop-non-bash-tool-execution.jsonl` → `noop:repro-command-mismatch`（EC-007）
  - `noop-no-repro-claims.jsonl` → `noop:repro-fields`（EC-003）
  - **`--mode report` 专项用例**：以 `noop-unverified-citation.jsonl` 或等价缺证据 fixture 跑 `fix-compliance-judge.mjs --mode report`，断言：exit 0（report 模式不阻断）+ stdout 为合法 JSON（`JSON.parse` 成功）+ 该 JSON 含 `compliant:false` + `missing[]` 精确含预期新键 + **审计/状态层零阻断计数写入**（report 模式为只读判定，不触碰 blockState）
- **文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（改，新增用例）
- **依赖**：T016
- **验收判据**：`node --test --test-name-pattern='F216 T017' plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 非零退出、含新增用例 `not ok`（`evaluate()` 尚未透传 ExecutionRecord）；既有用例不受影响。
- **FR/SC 映射**：FR-004、FR-005、FR-006、FR-007、FR-011、FR-018、SC-001、SC-002、EC-003、EC-007
- **模型档位**：sonnet

### T018 红测试：SC-003a 阻断→补证据→放行序列闭环

- **描述**：新增确定性同 session 序列用例（测试名前缀 `F216 T018 ...`，**串行于 T017 之后追加，同一文件**）：首次判定用无证据 no-op fixture → 断言 block 档 exit 2；模拟"补充主 transcript 可见的复现执行记录"（构造第二份 transcript，在同一 fix 锚点后追加合规的 Bash use/result + 单行 JSON 对账）→ 再次判定 → 断言转为合规 exit 0。对应 spec User Story 3 Acceptance Scenario 1。
- **文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（改，新增用例，追加于 T017 用例之后）
- **依赖**：T017
- **验收判据**：`node --test --test-name-pattern='F216 T018' plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 非零退出、含新增用例 `not ok`（同 T017 原因）；断言序列两步骤退出码与反馈文本内容。
- **FR/SC 映射**：SC-003a、US3 Acceptance Scenario 1
- **模型档位**：sonnet

### T019 红测试：SC-004 档位切换矩阵 + W7 精确窗口

- **描述**：新增用例（测试名前缀 `F216 T019 ...`，**串行于 T018 之后追加，同一文件**）覆盖：(1) 档位切换矩阵——block→warn→block（warn 档判定逻辑与 block 一致但不计数不阻断）、block→off→block（off 档在任何 transcript 读取前零接触直接放行）、warn 下合规清零旧计数；(2) **W7 精确窗口**——预装 `blockState.count=2`（模拟旧合同缺口已产生两次阻断），输入"旧合同全满足（章节非空+非占位符+委派齐全）、仅缺新 repro 证据"的 no-op → 断言首次因新证据缺失判定失败即触发 `releaseDegraded()` 放行（第 3 次降级）+ 审计事件 `missing[]` **仅含新 repro 键**（不误带旧键）→ 随后补齐证据 → 断言判定合规且阻断计数清零（FR-009/F211）。
- **文件**：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（改，新增用例，追加于 T018 用例之后）
- **依赖**：T018（复用 T016 fixture 目录 + 手工预置 blockState）
- **验收判据**：`node --test --test-name-pattern='F216 T019' plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 非零退出、含新增用例 `not ok`（同 T017 原因）；断言覆盖 3 种档位切换 + W7 精确窗口两阶段。
- **FR/SC 映射**：SC-004、FR-008、FR-009、FR-010、EC-005、EC-006
- **模型档位**：sonnet

### T020 实现：evaluate() 按 hasNoopAnchor 透传 ExecutionRecord

- **描述**：修改 `fix-compliance-judge.mjs` 的 `evaluate()`：在 `classifyClosureForm` 返回 `hasNoopAnchor===true` 时，调用 `extractExecutionRecordsAfter` 提取证据并透传给 `judgeCompliance`；`hasNoopAnchor===false` 时零介入（FR-007）。确保 off/warn/block 三档路由与计数语义不变（FR-008），仅在 no-op 分支追加 missing 键；`--mode report` 只读判定路径不写 blockState。
- **文件**：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`（改，~20-30 行）
- **依赖**：T019
- **验收判据**：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 单文件全量绿（T017/T018/T019 新增用例全部转绿 + 既有用例零回归）；**同时复跑 F208 既有退出码矩阵/有界降级/fail-open/F211 清零全套用例**（同文件内既有用例，随全量跑一并确认）。
- **FR/SC 映射**：FR-004、FR-005、FR-006、FR-007、FR-008、FR-009、FR-010、FR-018、SC-001、SC-002、SC-003a、SC-004
- **模型档位**：opus

---

## Phase 4 · SKILL.md 合同修订 + 双写重生

> 前置：Phase 3 完成（判据链已可用，prompt 合同修订不再依赖未定字段路径）。

### T021 修订 SKILL.md no-op 分支合同

- **描述**：按 plan §3 六项逐条落地 `skills/spec-driver-fix/SKILL.md`（L284-311 附近 no-op 分支）：
  1. 新增亲执行步骤——no-op 结论落盘前 Phase 1 编排器 MUST 亲自经 Bash 工具执行每条复现命令；verify 类子代理仅复核、不承担复现执行
  2. 模板改单行 JSON 对账——`## 判定依据` 下强制 `### 复现对账` 子标题 + 每条 bullet 单行 JSON `{claim,command,expected}`
  3. sentinel 约定——复现命令末行须精确打印 `SPEC-DRIVER-REPRO: PASS`/`FAIL`，给断言骨架示例；提示勿加彩色/ANSI 输出
  4. 安全边界文案——只读、非交互、禁 sudo/提权、禁启动后台常驻进程、必须带工具级 timeout；超时/需交互按 INCONCLUSIVE 记录不无限重试
  5. 双锚点提示——同时写 Root Cause 表格与判定依据时，取严为 repair，须同时满足两合同
  6. 文末标注改后须 `npm run repo:sync` 重生双写
- **TDD 豁免声明**：本任务**不适用**"红测试前置"要求——`SKILL.md` 是 prompt 合同文本（agent 阅读的自然语言指令），非可被 `node --test`/`vitest` 单测断言执行路径的代码；其正确性由「文案内容是否覆盖 plan §3 六项」的人工核对 + Phase 3 已落地的 harness 判据（机械层）共同保障，机械层已在 T017/T020 由测试锁定。
- **文件**：`plugins/spec-driver/skills/spec-driver-fix/SKILL.md`（改，source-of-truth，~40-50 行）
- **依赖**：T020
- **验收判据**：SKILL.md diff 逐项对照 plan §3 六项内容齐全；本任务**不**手改生成产物（`.codex/skills/`、`skills-codex/`）。
- **FR/SC 映射**：FR-001、FR-002、FR-015、FR-018
- **模型档位**：opus

### T022 repo:sync 双写重生 + repo:check + wrapper-sha256 精确验证

- **描述**：执行 `npm run repo:sync` 重生 `.codex/skills/spec-driver-fix/SKILL.md` 与 `plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md`（含内嵌 `Source SHA256` 重算）；执行 `npm run repo:check` 确认双写一致性门禁通过；执行**精确命令** `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` 确认绿（**不使用**非法的 `--testPathPattern` 参数或模糊路径兜底）。
- **文件**：`.codex/skills/spec-driver-fix/SKILL.md`（生成，勿手改）、`plugins/spec-driver/skills-codex/spec-driver-fix/SKILL.md`（生成，勿手改）
- **依赖**：T021
- **验收判据**：`npm run repo:sync` 零错误退出；`npm run repo:check` 零失败；`npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` 全绿；`git diff` 确认仅生成产物变动、无手改痕迹。
- **FR/SC 映射**：FR-012、SC-005
- **模型档位**：sonnet

---

## Phase 5 · spec/plan/实现键集静态一致性校验（只读）

> 前置：Phase 4 完成（SKILL.md 与生成产物均已就绪，键集文案定稿）。

### T023 只读校验：三方 missing key 集合一致性

- **描述**：新增一条 core 单测（测试名前缀 `F216 T023 ...`），将 spec.md FR-019 定义的 6 键集合硬编码为期望集 `['noop:repro-fields','noop:repro-command-mismatch','noop:repro-result-missing','noop:repro-tool-error','noop:repro-output-mismatch','noop:repro-contradiction']`，与实现侧 `MISSING_ACTION_TEXT` 常量的 `Object.keys(...)` 集合做双向 diff（无遗漏、无多余）；同时人工核对 plan.md §2 判定表列出的 key 集合与上述一致（本任务为只读校验，若发现不一致须停止并升级，不在本任务内静默修正实现或文档）。
- **文件**：`plugins/spec-driver/tests/fix-compliance-core.test.mjs`（改，新增只读一致性断言用例）
- **依赖**：T022
- **验收判据**：`node --test --test-name-pattern='F216 T023' plugins/spec-driver/tests/fix-compliance-core.test.mjs` exit 0（三方 6 键集合逐一相等，diff 为空）。
- **FR/SC 映射**：FR-019、C5/W6
- **模型档位**：sonnet

---

## Phase 6 · 全量门禁 + 可选 E2E smoke

> 前置：Phase 5 完成。本 phase 为交付前最终检查点。

### T024 全量门禁（SC-006，含 test:plugins）+ 可选 SC-003b E2E 子项

- **描述**：
  - **门禁部分（必须，入 CI）**：依次执行 `npx vitest run`（覆盖 vitest 收集的既有回归套件）→ **`npm run test:plugins`（覆盖 `plugins/spec-driver/tests/**/*.test.mjs` 全部 node:test 套件，含本 feature 全部新增用例）**→ `npm run build`（类型检查零错误）→ `npm run repo:check`（含 wrapper 双写一致性复核）。四项全绿方可视为 Phase 6 完成。
  - **可选子项（SC-003b，非门禁，手工）**：在 `plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs` 新增 `noop-unverified` scenario，手工运行验证真实 headless 模型（默认 haiku，单次预估 <$0.05）下 Stop hook 线路与退出码转发正确；此步骤**不计入**门禁四项命令，仅记录手工运行结果备查，不阻断交付。
- **文件**：无新增测试文件（复跑既有全套）；`plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs`（改，新增 scenario，可选子项）
- **依赖**：T023
- **验收判据**：`npx vitest run` 零失败；`npm run test:plugins` 零失败；`npm run build` 零错误；`npm run repo:check` 零失败（四项命令实际执行输出作为验收记录）；可选子项若执行则记录一次手工运行的退出码与耗时/成本，若未执行需在交付说明中显式注明"SC-003b 未跑，原因"。
- **FR/SC 映射**：SC-003b（可选）、SC-006（必须）
- **模型档位**：sonnet（验证性质，非生产代码新增）

---

## FR 覆盖映射表

| FR | 任务 |
|----|------|
| FR-001 | T021 |
| FR-002 | T007, T008, T014, T015, T016, T017, T021 |
| FR-003 | T014, T015, T017 |
| FR-004 | T014, T015, T017, T020 |
| FR-005 | T014, T020 |
| FR-006 | T015, T016, T017, T020 |
| FR-007 | T015, T016, T017, T020 |
| FR-008 | T019, T020 |
| FR-009 | T019, T020 |
| FR-010 | T019, T020 |
| FR-011 | T016, T017, T020 |
| FR-012 | T022 |
| FR-013 | T016（SC-001 合成 fixture） |
| FR-014 | T003, T010, T011, T012, T014, T015, T020 |
| FR-015 | T021 |
| FR-016 | T001, T002, T003, T004, T005, T006-T015（全 core 系列） |
| FR-017 | T001, T002, T003 |
| FR-018 | T015, T016, T017 |
| FR-019 | T014, T015, T023 |

## SC 覆盖映射表

| SC | 任务 |
|----|------|
| SC-001 | T016, T017 |
| SC-002 | T016, T017 |
| SC-003a | T018, T020 |
| SC-003b | T024（可选子项） |
| SC-004 | T019, T020 |
| SC-005 | T022 |
| SC-006 | T024 |

## EC 覆盖映射表

| EC | 覆盖任务 / 理由 |
|----|------------------|
| EC-001（假证据填充） | T016（`noop-unverified-citation.jsonl`）+ T017（SC-001 断言）——`noop:repro-command-mismatch` |
| EC-002（执行了但 INCONCLUSIVE） | T010（`noop-output-no-sentinel.jsonl`）+ T011/T012（`deriveAssertionStatus` INCONCLUSIVE 分支）——`noop:repro-output-mismatch` |
| EC-003（无法构造 repro） | T016（新增 `noop-no-repro-claims.jsonl`）+ T017 具名断言——`noop:repro-fields`（GATE_DESIGN Q2 已拍板不开替代证据例外，本仅验证"缺声明"分支，不新增例外通道） |
| EC-004（旧版本向后兼容） | T016（`legacy-noop-without-repro.jsonl`）+ T017（FR-011 断言） |
| EC-005（warn 档证据缺失表达） | T019（SC-004 档位切换矩阵含 warn 档） |
| EC-006（降级放行审计） | T019（W7 精确窗口，降级放行 + missing[] 复用断言） |
| EC-007（非 Bash 工具执行） | T016（新增 `noop-non-bash-tool-execution.jsonl`）+ T017 具名断言——`noop:repro-command-mismatch`（MVP 不支持，按缺 Bash 痕迹处理） |
| EC-008（纯 repair 零改动伪装） | **不新增任务**——能力边界声明范围外（spec 已明确 Stop hook 时点 zero-diff 检测不可靠，本 feature 不覆盖，FR-018 注记） |
| EC-009（复现命令副作用） | **不新增任务**——机械核验超能力边界，仅靠 T021 SKILL 合同文案约束（只读/非交互/禁 sudo 等），无法自动化断言 |
| EC-010（判定材料不可用） | **既有回归覆盖，不新增**——沿用 F208 既有 fail-open 单测（`malformed-transcript.txt` 等既有 fixture），本 feature 未改变该路径行为，T020 的"F208 既有全套零回归"验收间接覆盖 |

---

## 依赖关系与并行说明

### Phase 间依赖（硬顺序，不可跳过）

Phase 0（T001-T003）→ Phase 1（T004-T006）→ Phase 2（T007-T015）→ Phase 3（T016-T020）→ Phase 4（T021-T022）→ Phase 5（T023）→ Phase 6（T024）

理由：Phase 0 冻结字段路径（以 Claude fixture 为准，Codex 降级非阻断）是 Phase 1 core 归一化扩展与 Phase 2 判据的前提；Phase 1 完成后 io 层集成回归确认调用链未破坏；Phase 2 判据函数是 Phase 3 judge 接线的前提；Phase 3 判据链稳定后 Phase 4 才能定稿 SKILL prompt 合同；Phase 5 一致性校验依赖 Phase 4 键集文案已定稿；Phase 6 是最终门禁。

### Phase 内并行机会

- **Phase 0**：T001、T002 可并行（不同 runtime 采集，T002 非阻断）；T003 仅依赖 T001
- **Phase 2**：T007、T010、T013 三组 fixture 的**文件创建**互不依赖可并行构造，但**各自的 README 追加需按 T007→T010→T013 顺序串行落笔**（同一 README 文件，避免并发写冲突）；对应红测试 T008/T011/T014 依赖同组 fixture 与前置实现任务（T009/T012 分别是 T011/T014 的前置）
- **Phase 3**：T016 fixture 批量任务完成后，**T017→T018→T019 三个红测试任务显式串行**（同一 `fix-compliance-judge-cli.test.mjs` 文件，禁止真正并发编辑）
- **跨 phase**：无——本 feature 判据链单线依赖强，不存在可提前并行的跨 phase 任务

### 推荐实施策略

**MVP 优先（US1+US2 即为 MVP）**：US1（无证据 no-op 被拦下）与 US2（合法 no-op 放行）交织在 Phase 2-3 的判据实现与端到端测试中共同构成——因为"拦下假证据"与"放行真证据"是同一判据函数的两面，无法拆分独立交付。若需增量交付，最小可用切片为 **T001-T020**（Phase 0-3，判据链完整闭环，SC-001/SC-002/SC-003a/SC-004 全部可验证），Phase 4-6（T021-T024）是收口固化步骤（SKILL 合同文案 + 一致性校验 + 全量门禁），不建议单独砍掉——SKILL.md 不改则 prompt 层仍是旧合同，harness 判据与 prompt 引导不一致会重演"prompt 层够不到方向误读"的原问题（spec 背景）。

**关键路径**：T001（Claude 真实采集）→ T003（裁决，仅依赖 T001）→ T005（core 归一化实现）→ T009 → T012 → T015（core 三层判据链）→ T020（judge 接线）→ T021（SKILL 合同）→ T022（双写重生）→ T024（全量门禁）。

---

## 工具使用反馈（Dogfooding）

- 本次任务分解修订以直接 Read plan.md/spec.md + fixture README + `package.json` 中 `test:plugins` 脚本定义 + `fix-compliance-core.test.mjs` 头部 import 确认 node:test 框架为主，未调用 Spectra MCP：判据链为 `plugins/spec-driver` 下 `.mjs` 脚本，位于 Spectra TS 图谱抽取范围之外，故按 fallback 约定直接源码/文档阅读完成分解。
- 本次修订暴露一处真实流程问题：初版任务分解误判 `normalizeTranscriptEntry`/`flattenToolResultContent` 的文件归属（io vs core）与测试 runner 类型（vitest vs node:test），均属"未先精确 Read 目标文件公开接口与测试框架声明就下笔"的问题，已在本版通过实测确认（`Grep` 头部 import 语句 + `package.json` 脚本定义）修正；后续任务分解应把"确认测试 runner 类型"与"确认函数实际落点文件"列为写任务前的强制前置核对项，而非凭 plan.md 文字描述直接假设。
