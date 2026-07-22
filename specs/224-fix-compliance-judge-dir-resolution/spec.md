---
title: "fix 依从性 Stop hook 候选目录解析盲区修复"
feature: "224-fix-compliance-judge-dir-resolution"
branch: "224-fix-compliance-judge-dir-resolution"
created: "2026-07-22"
status: "Draft"
input: "F208 fix 依从性阻断型 Stop hook 在特性目录改名 / 原地编辑场景下产生假阳性阻断，实证于 2026-07-22 F223 交付（commit 26fe3a1）"
---

# Feature Specification: fix 依从性 Stop hook 候选目录解析盲区修复

**Feature Branch**: `224-fix-compliance-judge-dir-resolution`
**Created**: 2026-07-22
**Status**: Draft
**Input**: F208 引入的 fix 模式阻断型 Stop hook 在特性目录发生改名或以原地编辑方式写入制品时，无法正确定位候选特性目录，导致对已合规交付的会话误报"未建立特性目录 + 缺少诊断报告"

## 问题陈述与现实影响

F208（`specs/208-fix-mode-process-compliance/`）为 fix 模式引入了阻断型 Stop hook，用于在会话收口前校验交付是否满足"制品齐全 + 委派记录完整"的最低门槛。该 hook 的判定依赖 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` 中的 `resolveFeatureDirCandidate(entries, anchorLineIndex)`：从 transcript 里锚点之后的 assistant 条目反推"本次 fix 收口对应的特性目录"，再用 `checkFeatureDirOnDisk` 校验该路径在磁盘上是否存在。

**实证事实**（2026-07-22，commit 26fe3a1，`specs/223-fix-charter-snapshot-date/` 交付）：会话先在 `specs/222-fix-charter-snapshot-date/` 下落齐 `fix-report.md`、`plan.md`、`tasks.md`、`verification/verification-report.md`（路径 A 四步全部走完）；交付前 fetch 发现该编号已被并行 session 的另一 F222 抢占，遂将目录改名为 `specs/223-fix-charter-snapshot-date/`。改名后 Stop hook 连续两次误报"未建立特性目录"与"缺少诊断报告"，而磁盘上制品实际齐全、内容完整。

**根因**（源码级核准，事实源 `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`）：

- `resolveFeatureDirCandidate` 只在两类 transcript 条目中扫描候选路径，且候选值被后续匹配覆盖（取最后一次匹配）：
  1. `Write` / `Edit` 工具调用的 `input.file_path`
  2. `Bash` 工具调用且命令文本命中 `BASH_WRITE_INDICATOR_REGEX = /(?:>>?|<<|\btee\b)/` 时的 `input.command`
- `ARTIFACT_PATH_REGEX = /specs\/\d+-fix-[a-z0-9-]+\/(?:fix-report\.md|verification\/verification-report\.md)/g` 只认这两个具体文件名，不匹配目录路径本身
- 由此产生两个独立盲区：
  - **盲区 A —— 跟不上重命名**：`git mv specs/222-x specs/223-x` 这类目录改名命令，既无重定向符（不触发 `BASH_WRITE_INDICATOR_REGEX`），目标路径也不带 `/fix-report.md` 后缀（不触发 `ARTIFACT_PATH_REGEX`），候选仍停留在改名前的旧路径；旧路径已不存在，磁盘校验失败，误报"未建立特性目录"
  - **盲区 B —— 不认原地编辑器**：`sed -i '' 's#...#...#' specs/223-x/fix-report.md` 这类命令确实写入新路径且路径完整匹配 `ARTIFACT_PATH_REGEX`，但因命令中不含 `>` / `>>` / `<<` / `tee`，整条命令被 `BASH_WRITE_INDICATOR_REGEX` 提前过滤，从未进入路径扫描。同类未覆盖的原地写入方式还包括 `perl -i`、`python -c` 写文件等 `[推断：源码未穷举列出，按同一过滤条件类推]`

**现实影响**：

1. 阻断型 hook（exit 2）误报会打断已合规完成的交付流程，且无自愈路径——transcript 内容不可回改，制品已在新路径下齐全，除非会话中再对该新路径执行一次可被识别的 `Write`/`Edit`，否则每次 Stop 都会复发同样的误报
2. 诱导错误行为：为让 hook 放行而伪造/保留旧编号的空壳目录，会在仓库中留下重复或空壳的 spec 目录，污染事实源（与仓库"不猜测、不污染事实源"的行为约定直接冲突）
3. 编号撞车在本仓是已知常态（多 worktree 并行开发，`project_feature_numbering_collision` 记忆已记录该现象），因此"交付前改名"不是罕见的边角操作，而是会反复出现的常规路径

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 改名后仍能正确定位候选目录 (Priority: P1)

作为在 fix 模式下工作的开发者，当我在交付前因编号冲突或命名调整对特性目录执行改名操作（如 `git mv` 或 `mv`）后，Stop hook 的候选目录解析结果应当反映改名后的最终路径，而不是停留在改名前的旧路径。

**Why this priority**：这是本次修复要解决的核心已实证缺陷（F223 实例），不修复会持续打断合规交付且诱导伪造目录，是最高优先级。

**Independent Test**：构造一份包含"先在旧路径下写全部四项制品，随后执行 `git mv 旧路径 新路径`"的 transcript fixture，验证 `resolveFeatureDirCandidate` 返回的候选路径等于改名后的新路径，且 `checkFeatureDirOnDisk` 对该新路径校验通过。

**Acceptance Scenarios**:

1. **Given** transcript 中先出现对 `specs/222-fix-x/fix-report.md` 的 `Write` 调用，随后出现 `git mv specs/222-fix-x specs/223-fix-x` 的 `Bash` 调用，**When** 会话在改名后的路径下制品齐全并触发 Stop，**Then** 判定器解析出的候选目录为 `specs/223-fix-x`，磁盘校验通过，不产生"未建立特性目录"误报。
2. **Given** 改名操作使用 `mv` 而非 `git mv`，**When** 其余条件同上，**Then** 判定结果与场景 1 一致。

---

### User Story 2 - 原地编辑写入的制品能被识别 (Priority: P1)

作为在 fix 模式下工作的开发者，当我使用 `sed -i`、`perl -i` 或等价的原地编辑命令修改已存在的 `fix-report.md` / `verification-report.md` 内容时，即便命令中不含重定向符，判定器也应能识别该命令写入了对应特性目录下的合规文件。

**Why this priority**：与 User Story 1 同属本次已实证的两大独立盲区之一，且原地编辑是修订既有诊断报告的常见操作方式，同等优先级。

**Independent Test**：构造包含 `sed -i '' 's#...#...#' specs/223-fix-x/fix-report.md` 命令且不含任何重定向符的 transcript fixture，验证判定器仍能从该命令文本中提取出 `specs/223-fix-x` 作为候选目录。

**Acceptance Scenarios**:

1. **Given** transcript 中出现的唯一写入迹象是 `sed -i '' 's#old#new#' specs/223-fix-x/fix-report.md`（无 `>`/`>>`/`<<`/`tee`），**When** 该路径下制品实际齐全，**Then** 判定器解析出候选目录 `specs/223-fix-x` 并通过磁盘校验。
2. **Given** 同类命令替换为 `perl -i -pe 's/old/new/' specs/223-fix-x/fix-report.md` 或 `python -c "..."` 写入同一文件，**When** 其余条件同上，**Then** 判定结果与场景 1 一致。

---

### User Story 3 - 无法定位候选目录时不得直接判不合规 (Priority: P1)

作为依赖该 hook 保持交付质量的团队成员，当判定器因 transcript 内容特殊而无法确定唯一候选目录时，hook 不应直接放行也不应武断阻断，而应遵循与 F208 既有 FR-013 一致的 fail-open 精神：捕获该不确定状态、以受控方式处理并落盘可审计的诊断记录，避免用一次解析失败去否定一次可能已经合规的交付。

**Why this priority**：该行为是本次修复的安全阀——放宽解析规则的同时必须明确"解析不到 ≠ 直接判不合规"的边界，否则修复本身可能引入新的误判路径，优先级与前两个 Story 相当。

**Independent Test**：构造判定器在放宽解析规则后仍然无法确定唯一候选目录的 transcript fixture（即已知候选被改名到不符合 `NNN-fix-<name>` 命名的目标目录，新位置无法机械确定），验证判定结果不是简单的"未建立特性目录"式硬阻断，而是按照与 FR-013 一致的降级路径处理并落盘诊断原因。

**Acceptance Scenarios**:

1. **Given** transcript 中已提名候选 `specs/223-fix-x`、随后出现 `git mv specs/223-fix-x specs/renamed-nonstandard`（目标目录名不满足 `NNN-fix-<name>` 命名规范），**When** 触发 Stop，**Then** 判定器不得继续拿已不存在的旧路径撞磁盘核验并误报"未建立特性目录"，须清空候选、置 `ambiguous` 并按本 spec 定义的降级路径处理、记录诊断原因。

> **订正（实施期修正，2026-07-22）**：本 Story 原表述以"transcript 全程只出现目录路径本身、从未出现制品全路径"为代表场景（Story 正文、Why this priority、Independent Test、Acceptance Scenario 1 均如此），实施期复核发现该前提不成立，理由与下方 Edge Cases 订正逐字同源：目录路径一旦出现即已知，磁盘核验足以区分"合规"与"真实坍塌"，对该情形 fail-open 会把 F208 要抓的典型坍塌形态变成放行。故本 Story 的代表场景已改写为实际交付所覆盖的**唯一**降级触发面「改名到非规范命名目录」；US3 的安全阀意图（解析不到 ≠ 直接判不合规）不变，仅触发条件收窄。历史表述保留于本订正说明中以维持可追溯性。

---

### Edge Cases

- **同一会话内多次改名**：特性目录在同一会话中被连续改名两次或以上（如 `222→223→224`），判定器必须以最后一次改名后的路径为准，不得停留在任何中间路径。
- **改名到不符合 `NNN-fix-<name>` 命名规范的目录**：若改名后的新目录名不满足 `ARTIFACT_PATH_REGEX` 所依赖的 `specs/\d+-fix-[a-z0-9-]+/` 命名模式，判定器无法机械匹配，应按 User Story 3 的 fail-open 降级路径处理，而不是误报为"未建立特性目录"。
- **同一会话存在多个 fix 特性目录**：transcript 中出现对两个及以上不同编号特性目录的写入痕迹时，判定器必须锚定"当前收口对应的最新一次 fix 技能展开"之后产生的候选（呼应 F208 既有 FR-007 的锚定语义），不得混用或误取更早的目录。
- **目录存在但 `fix-report.md` 缺失**：候选目录本身在磁盘上存在，但该目录下确实没有 `fix-report.md`（真实的制品缺失，而非解析盲区），判定器必须仍然按现有语义正确阻断，本次修复不得放宽这一真实缺陷的拦截能力。
- **`git mv` / `mv` / `sed -i` / `perl -i` / `python` 原地写混用**：同一会话交替使用多种改名和原地编辑方式（例如先 `git mv` 改名，再用 `sed -i` 修订新路径下的报告内容），判定器必须综合处理，最终候选目录须反映所有操作叠加后的真实最新状态。
- **transcript 里只出现目录路径而从未出现制品全路径的情形**：与 User Story 3 场景一致，需与"确实从未写入任何制品"的坍塌场景区分——判定器无法机械区分这两种情形时，应统一走 fail-open 降级路径而非直接判不合规，以避免把无法判定误当作确定性的不合规证据。

  > **订正（实施期修正，2026-07-22）**：本条的前提"判定器无法机械区分这两种情形"经实施期复核**不成立**。目录路径一旦在 transcript 中出现即已知，磁盘检查就能区分二者：目录在且制品齐全 = 合规；目录在但 `fix-report.md` 缺失 = 真实坍塌。若对该情形走 fail-open，"建了特性目录、写了 plan.md/tasks.md、但从未写 fix-report.md"这一 F208 要抓的典型坍塌形态会从硬阻断变为放行，构成本次修复引入的新假阴性。
  >
  > 故实施采用更严格口径：**目录可定位时不走 fail-open**，一律交既有磁盘核验 + 实质性判据裁决（结果为维持硬阻断）。FR-004/FR-005 的降级通道与 `feature-dir-unresolvable` 诊断码保留不变，但触发条件收窄为**仅**「已知候选被改名到不符合 `NNN-fix-<name>` 命名的目标目录、新位置确实无法机械确定」这一种情形——这正贴合 FR-004「应用放宽规则后**仍**无法确定唯一候选」的字面语义。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 判定器 MUST 能够从 transcript 中识别改变已知候选特性目录路径的操作（至少包含 `git mv` 与 `mv` 形态的目录改名命令），并将解析结果更新为改名后的路径。**[必须]**——这是 F223 实例直接暴露的盲区 A，去掉此能力核心缺陷无法修复。
- **FR-002**: 判定器 MUST 能够识别不含 `BASH_WRITE_INDICATOR_REGEX`（`>`/`>>`/`<<`/`tee`）重定向特征、但命令文本本身包含完整合规文件路径（匹配 `ARTIFACT_PATH_REGEX`）的原地编辑类命令（至少包含 `sed -i`、`perl -i`），并将其纳入候选扫描范围。**[必须]**——这是盲区 B 的直接修复目标，是本次已实证缺陷的另一半。
- **FR-003**: 判定器 SHOULD 将 FR-002 覆盖的原地编辑命令识别方式设计为可扩展的，以便后续按需纳入 `python -c` 写文件等其他原地写入形态，而不需要改变核心解析结构。**[可选]**——扩展到 `python`/其他任意写入工具的完整枚举不是本次已实证缺陷的必要条件，但设计上应为后续补充留出扩展点。
- **FR-004**: 当判定器在应用 FR-001/FR-002 的放宽规则后仍无法确定唯一候选特性目录时，判定器 MUST NOT 将"无法定位候选"直接等同于"未建立特性目录"式的确定性不合规证据；MUST 遵循与 F208 既有 FR-013 一致的 fail-open 精神，捕获该不确定状态并转入受控的降级处理路径。**[必须]**——这是本次修复引入新假阴性风险的安全阀，直接对应"风险"一节的权衡要求，且必须与 FR-013 现有语义保持一致，不得另起一套不兼容的降级逻辑。
- **FR-004a**（Phase 5 后 CRITICAL 订正，2026-07-22）: FR-004 的 fail-open MUST **按维度收窄**——"无法定位候选目录"只使 **featureDir 这一个判据维度**转入不确定状态，MUST NOT 短路或赦免与目录解析无关的其余判据（尤其是委派证据）。判定器 MUST 在该情形下照常抽取委派记录并跑完合规判定；当 `delegationCounts.implement === 0 && delegationCounts.verify === 0`（即无论制品落在哪个目录都构不成一次合规收口）时 MUST 维持既有阻断语义；仅当存在收口类委派、唯一不确定的确实是"制品落在哪个目录"时才 MAY 走降级放行并落 `feature-dir-unresolvable`。**[必须]**——整体短路会让"多敲一条 `git mv <已知候选> <非规范名>`"成为绕过阻断型门禁的单命令后门（零委派、磁盘零制品仍 exit 0），与 F208 设立本门禁的目的直接冲突。
- **FR-005**: 判定器降级处理路径 MUST 落盘包含"无法定位候选目录"这一降级原因的结构化诊断记录，供事后审计判断该次放行是否掩盖了真实的坍塌流程。**[必须]**——复用 F208 已有的 degraded 诊断落盘机制（FR-013 语境），是保证 fail-open 不等于"静默放行、无迹可查"的必要条件。
- **FR-006**: 判定器 MUST 保留对"候选特性目录在磁盘上确实存在但缺少 `fix-report.md`"这一真实制品缺失场景的现有阻断能力，本次修复引入的解析放宽不得降低该场景下的拦截准确率。**[必须]**——防止修复本身引入新的假阴性，是 Edge Cases 中"目录存在但 fix-report.md 缺失"场景的直接约束。
- **FR-007**: 当 transcript 中出现对多个不同编号 fix 特性目录的写入痕迹时，判定器 MUST 仅在"当前收口对应的最新一次 fix 技能展开"之后产生的写入记录范围内解析候选目录，不得跨展开边界取值。**[必须]**——延续 F208 已有 FR-007 的锚定语义，避免多目录场景下取错候选，是 Edge Cases 中"同一会话存在多个 fix 特性目录"场景的直接约束。
- **FR-008**: 当同一会话内候选特性目录被多次改名或多次原地编辑时，判定器 MUST 以叠加所有相关操作后得到的最终路径与最终内容状态作为解析结果，不得停留在任一中间状态。**[必须]**——直接对应 Edge Cases 中"同一会话内多次改名"与"多种改名/原地编辑方式混用"场景。
  其中"无法唯一确定候选"（降级标记）MUST 是**可恢复**状态：若制品先被改名到非 `NNN-fix-<name>` 命名的中间目录、随后又被改回合法命名，判定器 MUST 沿改名链续跟到最终合法路径并撤销降级标记；只有改名链的**最终态**仍落在非规范命名时才保持降级。

### Key Entities *(include if feature involves data)*

- **候选特性目录（Feature Directory Candidate）**：判定器从 transcript 反推出的、本次 fix 收口所对应的 `specs/NNN-fix-<name>/` 路径；关键属性包括路径字符串、解析所依据的证据来源（写入/改名/原地编辑操作）、解析置信度（能否唯一确定）。
- **降级诊断记录（Degraded Diagnostic Record）**：判定器在无法确定唯一候选目录时落盘的结构化记录，关键属性包括降级原因（如 `feature-dir-unresolvable`）、transcript 锚点位置、发生时间，用于事后审计。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**：给定一份包含"先在旧路径完整写入四项制品、随后执行 `git mv` 改名"的 transcript fixture，判定器解析出的候选目录路径等于改名后的新路径，且该场景对应的自动化测试用例在 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` 中稳定通过。
- **SC-002**：给定一份仅通过 `sed -i` 原地编辑（无重定向符）写入合规文件路径的 transcript fixture，判定器解析出对应候选目录并通过磁盘校验，对应测试用例稳定通过。
- **SC-003**：新增测试 fixture 复用现有资产组织方式，落位于 `plugins/spec-driver/tests/fixtures/fix-compliance/` 目录下，与既有 `.jsonl` fixture 保持一致的格式与命名风格，可被 `fix-compliance-core.test.mjs` 直接加载。
- **SC-004**：对 Edge Cases 中列出的"目录存在但 `fix-report.md` 缺失"这一真实坍塌场景，修复前后的判定结果保持一致（仍然阻断），验证放宽解析规则未引入该场景下的新假阴性。
- **SC-005**：对判定器仍无法确定唯一候选目录的场景（即 Edge Cases 中"改名到不符合 `NNN-fix-<name>` 命名规范的目录"，对应 fixture `resolve-ambiguous-rename-nonstandard.jsonl`），验证判定结果落入 fail-open 降级路径而非直接判不合规，且对应诊断记录中包含可识别的降级原因字段。

- **SC-005b**（Phase 5 后 CRITICAL 订正）：对"零 implement / 零 verify 委派 + 一条 `git mv <已知候选> <非规范名>`"的构造（fixture `resolve-ambiguous-rename-nonstandard.jsonl`），hook 模式退出码为 2、report 模式 `compliant:false` 且 `transcriptDiagnostics` 为空；对"含 implement + verify 委派 + 同一改名"的构造（fixture `resolve-ambiguous-rename-with-delegations.jsonl`），hook 模式退出码为 0、report 含 `feature-dir-unresolvable`，且 `.specify/runs/<YYYY-MM>.jsonl` 落盘 `degraded:true` 事件。二者对照即证明 fail-open 已按维度收窄、单命令绕过不再成立。

  > **订正（实施期修正，2026-07-22）**：本条原以"只出现目录路径、从未出现制品全路径"为例证，与 US3 / Edge Cases 的同源订正一并改写——该情形已确定**不**走 fail-open（目录已知时交磁盘核验硬阻断，见 fixture `resolve-dir-only-plan-md.jsonl` 断言 `ambiguous=false`）。例证改为实际验证本 SC 的「改名到非规范命名目录」场景，与交付用例一一对应。

## Non-Goals

- 不重构 `fix-compliance-core.mjs` 的整体判定链路或数据结构，仅在 `resolveFeatureDirCandidate` 及相关正则/扫描逻辑范围内做针对性修复。
- 不改变 Stop hook 薄壳层现有的 fail-open 兜底语义（transcript 缺失/损坏/超时等场景，见 F208 FR-013），本次修复只是新增一条"候选目录解析不确定"时同样走该兜底路径的分支，不改写兜底本身的实现方式。
- 不扩大适用范围到 fix 模式以外的其他 spec-driver 模式（feature / story / implement / resume 等），本次修复仅作用于 fix 模式的候选目录解析逻辑。
- 不追求穷举所有可能的原地写入命令形态（如覆盖所有脚本语言、所有编辑器命令行参数组合），仅覆盖 FR-001/FR-002 明确列出的形态，其余按 FR-003 的可扩展设计留待后续按需补充。

## 风险

**核心权衡**：放宽候选目录解析规则（识别改名与原地编辑）本质上是扩大判定器"认为已合规"的判定面，这与 F208 建立该 hook 的初衷——堵住装饰性委派、坍塌流程绕过最低门槛——存在直接张力。若放宽过度，可能让原本应该被阻断的坍塌交付（例如伪造一次无害的 `sed -i` 命令、但实际制品内容空洞或委派记录缺失）被误判为合规，产生新的假阴性。

**约束思路**：

1. 放宽仅作用于"候选目录路径的定位"这一环节，不改变判定器对制品内容实质性（如 FR-012 机械可判的实质性底线校验）与委派记录完整性的既有校验逻辑；候选目录被正确定位之后，后续所有实质性检查仍按现有严格标准执行，不因本次修复而降低。
2. FR-002 新增识别的原地编辑命令必须同时满足"路径完整匹配 `ARTIFACT_PATH_REGEX`"这一条件，不引入任何"只要出现目录名字符串就算写入"式的模糊匹配，避免把纯粹的路径提及（如日志打印、注释引用）误判为写入证据。
3. FR-004/FR-005 要求的 fail-open 降级路径必须留痕（结构化诊断记录），使得"因解析盲区放行"与"因确实合规而放行"在事后审计中可区分，为后续收紧规则或复核提供依据，而不是让放宽变成静默的、不可追溯的放行。
4. 新增测试用例（SC-001~SC-005）必须同时覆盖"应放行的改名/原地编辑场景"与"仍应阻断的真实坍塌场景"，防止修复只验证了正向路径而遗漏了负向路径的回归。
