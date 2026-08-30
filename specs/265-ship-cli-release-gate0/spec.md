# Feature Specification: F265 — Gate 0：发布与度量硬前置

**Feature Branch**: `claude/spectra-cli-4-5-0-release-959ec9`
**Created**: 2026-08-24
**Status**: Draft
**Input**: M10 Gate 0（`docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §3 G0-1..G0-4），story 模式（无独立调研阶段，前序制品见 `research/code-context.md`、`research/probe-findings.md`）

## 背景

`spectra-cli` npm 包停在 4.4.0（build `0ae3eb7`），此后 18 个动 `src/` 的 commit（含 3 个 `feat`，覆盖 F241/F249/F250/F243–F263 整条可信活图链）从未发布；`spec-driver` 停在 4.4.2，其后 4 个 fix commit（F257/F258/F261/F262）同样未发布。CI 从不执行 `repo:check` / `release:check` 治理链；doctor 只比 semver、看不出"同版本号但不同 build"；自用 MCP 走 PATH 全局二进制，无法确认跑的是哪次 build；一个月内 MCP 仅 70 次调用、17 个工具 14 个零调用，图质量自 F242 之后无人复测。本卡是 M10 其余卡的硬前置：不发布，M9 的可信活图链改进对任何用户都不存在。

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 对齐并发布版本号（Priority: P1）

维护者需要让 `contracts/release-contract.yaml` 记录的版本号与仓库实际代码状态一致，并把落后的 CHANGELOG 补齐，使"发布"这个动作有据可依、有文档可查，最终具备执行 `npm publish` 的条件。

**Why this priority**: 这是发布断层的根因所在——版本号和 CHANGELOG 不动，后续所有验收（doctor 零漂移、adoption 基线）都无从谈起。没有这条，其余三个 Story 做得再好也无法交付给任何真实用户。

**Independent Test**: 在不涉及 G0-2/G0-3/G0-4 任何改动的情况下，单独修改 `contracts/release-contract.yaml` + 跑 `npm run release:sync` + 补 CHANGELOG，即可验证 `npm run release:check` 与 `npm run release:publish:dry` 通过。

**Acceptance Scenarios**:

1. **Given** `contracts/release-contract.yaml` 中 `products.spectra.version=4.4.0`，**When** 维护者将其改为 `4.5.0` 并执行 `npm run release:sync`，**Then** `package.json` / `plugin.json` / `marketplace.json` / `package-lock.json` / README 受控行同步更新为 4.5.0，且这些文件不曾被手工编辑。
2. **Given** `products.spec-driver.version=4.4.2`，**When** 同一次 sync 将其改为 `4.4.3`，**Then** spec-driver 相关派生文件同步更新，且 spectra 与 spec-driver 两条版本线各自独立递增（不要求同号）。
3. **Given** CHANGELOG.md 最新条目停在 `[4.1.1]`（其后紧跟结构异常的 `[v4.1.0]` 与悬空的 `[Unreleased]` 段），**When** 维护者补写变更记录，**Then** CHANGELOG 中出现按 F2xx 卡聚合（非逐 commit）的条目一路覆盖到 `[4.5.0]`，且 `[Unreleased]` 段被显式处置（不再以"尚未发布"的措辞误导读者）。
4. **Given** 版本号与 CHANGELOG 均已就绪，**When** 执行 `npm run release:publish:dry`，**Then** 命令以 exitCode 0 结束，且不触发真实的 `npm publish` 网络请求。

---

### User Story 2 — CI 接入治理链并对发布断层可见预警（Priority: P1）

维护者需要 CI 在每次 push/PR 时自动跑 `repo:check` 与 `release:check`，并在 master 领先已发布版本较多 `src/` commit 时给出可见的非阻断提醒，避免发布断层再次无声积累到 18 个 commit 才被发现。

**Why this priority**: 这是防止 Story 1 解决的问题重新发生的护栏；没有它，本次发布之后仍会重蹈"改了代码却忘记发布"的覆辙。

**Independent Test**: 单独修改 `.github/workflows/ci.yml` 与 `release-contract-core.mjs` 即可验证——本地跑 `act` 或直接运行对应 npm script，配合变异测试（用 `SPECTRA_PUBLISHED_REF` 覆盖入口注入不同 `gitHead`）构造"领先 N≥5 个 src commit"与"领先 <5 个"两种场景，观察 warning 出现与否及 exitCode 是否保持 0。

**Acceptance Scenarios**:

1. **Given** `.github/workflows/ci.yml` 当前只有 lint/build/graph-only/test/test:plugins，**When** 本卡改动落地，**Then** workflow 中新增 `npm run repo:check` 与 `npm run release:check` 两个显式步骤，且 `repo:check` 排在既有 `Build Knowledge Graph`（`batch --mode graph-only`）步骤之后（`repo:check` 的 `graph-quality:*` 判据依赖 `specs/_meta/graph.json`，干净 checkout 无此文件，顺序颠倒会误红）。
2. **Given** 通过 `SPECTRA_PUBLISHED_REF` 注入一个使领先量恰为 5 的 commit 作为"已发布 commit"，**When** 跑 `npm run release:check`，**Then** 输出中出现领先量 warning 文本，且 exitCode 仍为 0。
3. **Given** 注入领先量为 4（< 5）的场景，或 `npm view` 不可达且无注入覆盖，**When** 跑 `npm run release:check`，**Then** 前者不产出"领先"warning；后者输出一条可见的 indeterminate 提示（不是静默无输出），且不误判为"无领先"。
4. **Given** `release:check` 被 `prepublishOnly` 串联，**When** 存在领先 warning，**Then** `npm publish` 前置校验依然可以通过（warning 不阻断发布路径）。

---

### User Story 3 — doctor 按 commit 比对 + MCP 版本自省（Priority: P2）

维护者/agent 需要在四方一致性检查中看出"语义版本号相同但实际 build 不同"的情形，并能从 MCP server 本身问出它正在跑哪个 commit、是否 dirty，从而判断自用工具是不是最新代码。

**Why this priority**: 这是发布断层曾经隐身的直接原因之一（doctor 报"一致"，二进制却落后 18 个 commit）。价值高但不阻断"先把版本发出去"这个更紧迫的目标，故列 P2。

**Independent Test**: 单独修改 `codex-runtime-doctor-core.mjs` 与 `src/mcp/server.ts` 即可验证——构造 commit 相同/不同/构建信息缺失三种场景跑 doctor，单独起 MCP server 并用官方 SDK 客户端解析其对外暴露的自省信息（不能只肉眼看服务端发了什么，必须经客户端解析后仍可见才算数——见 FR-018）。

**Acceptance Scenarios**:

1. **Given** 四方（本地 dist / 已安装插件 / Codex 快照 / 参考基线）commit 均一致，**When** 跑 doctor，**Then** 新增比对维度输出 `match`。
2. **Given** 四方中某一方 commit 不同，**When** 跑 doctor，**Then** 输出 `mismatch`，且报告正文、日志、返回体中均不出现任何一方的原始 commit 字符串或其子串。
3. **Given** 某一方缺少 build meta 文件（如从未 build 过），**When** 跑 doctor，**Then** 该方输出 `absent`，不得被误判为 `match` 或 `mismatch`。
4. **Given** build meta 文件存在但格式损坏无法解析，**When** 跑 doctor，**Then** 该方输出 `unreadable`。
5. **Given** MCP server 已启动，**When** 用官方 SDK 客户端连接并调用 `initialize`（以及/或 FR-018 裁定新增的自省工具），**Then** 客户端侧能解析出 `{version, commit, dirty}` 对应信息，且既有 17 个 MCP 工具的 schema 未发生变化。

---

### User Story 4 — adoption 与图质量基线的可重跑工具（Priority: P2）

维护者需要一个 adoption census 脚本、一份复用 `scripts/graph-accuracy.mjs` 的图质量复测冻结口径文档，以及一份人工记账协议（不可脚本化部分），为发布一周后回收"到底有没有人在用、图到底准不准"的真实数字做好准备；本卡不产出数字本身。

**Why this priority**: 是 M10 收官判定的对照组基础设施，但数字本身按卡面硬约束推迟到发布后一周由 milestone-next 回收，故本卡工作是"造尺子"而非"读数"，优先级低于发布本身。

**Independent Test**: 单独运行 census 脚本（指向本机 `~/.claude/projects` 与 `~/.codex/sessions`）与 `scripts/graph-accuracy.mjs`（配合钉死的 `--baseline-repo`/`--baseline-commit`），检查输出结构符合口径文档定义的 schema，不依赖 G0-1/G0-2/G0-3 是否完成。

**Acceptance Scenarios**:

1. **Given** 本机存在 `~/.claude/projects/**/*.jsonl`，**When** 运行 adoption census 脚本，**Then** 输出按 17 个已知 MCP 工具名聚合的调用次数分布与零调用工具清单，且脚本不写入任何原始 transcript 内容到仓库。
2. **Given** `~/.claude/projects` 目录不存在或为空，**When** 运行 census 脚本，**Then** 脚本正常退出并给出"未找到 transcript 目录"的明确提示，而不是抛未捕获异常。
3. **Given** `scripts/graph-accuracy.mjs` 与 `specs/241-graph-keepalive-kb-grounding/pilot/` 下已有冻结口径资产，**When** 图质量复测口径文档编写完成，**Then** 它以 `graph-accuracy.mjs` 的 `--baseline-repo`/`--baseline-commit`/`--baseline-scope` 为主复用目标（外部语料 + 钉版本），F241 pilot 的 ledger 校验器资产列为次级/交叉参照，且如实转述 `graph-accuracy.mjs` 自述的 `label-only` 匹配、不区分 method/function 两条局限。
4. **Given** F241 口径中 M-1（grounding 命中率手工记账）与 M-3（review 发现率人工判真伪）本质是人工协议，**When** 交付本卡，**Then** 这两项以协议文档 + 记账模板形式交付，不被包装成"可一键重跑脚本"；只有 M-2 的计算部分与图精度部分是脚本化交付物。
5. **Given** 本卡完成，**When** 检视交付物，**Then** 不存在任何已回收的 adoption 次数或 caller recall/precision 数字被写入 spec/plan/report 声称为"结论"；相关文档明确写"数字由发布后一周的 milestone-next 回收"。

---

### Edge Cases

- **离线/无法访问 npm registry 时如何判定"已发布版本"**：`release:check` 的领先量 warning 必须能在 `npm view` 不可达、`gitHead` 字段缺失、`gitHead` 对应的 commit 在本地仓不存在（如浅克隆）三种情形下均输出可见的 indeterminate 提示，不得静默跳过判定、也不得默认判定为"无领先"（呼应 F258 教训：新门禁自己 fail-open）。
- **dist build meta 缺失**：worktree 未 build 过（无 `dist/.spectra-build-meta.json`）时，doctor commit 比对该方输出 `absent`，不得误判为 `mismatch` 而制造假警报。
- **build meta 文件存在但损坏**：输出 `unreadable`，与 `absent`/`mismatch` 三态区分对待。
- **transcript 目录不存在或为空**：census 脚本必须优雅处理，输出"未找到数据源"而非崩溃或误报 0 次调用为"零采纳"结论。
- **CHANGELOG `[Unreleased]` 段处置**：该段实际内容（F140）早于当前顶部 `[4.1.1]`，处于结构错位状态；spec 采用 [AUTO-RESOLVED] 方案（见 FR-004）。
- **`gitHead` 与"版本号被 bump 的那次 commit"不是同一个**：实测（`research/probe-findings.md` P5）4.4.0 的 bump commit 是 `0d292e3b`，而 npm 已发布 tarball 的 `gitHead` 是 `0ae3eb70`，二者相差 9 个 commit（中间夹了 `fix(release)` 收尾 commit）。N 的计数**必须**以 `gitHead` 为准，不能以 bump commit 为准，否则会系统性少算。
- **用户尚未执行 `npm publish`**：本卡内验收范围止于 `release:publish:dry` 通过；`npm view` 版本号、全局二进制 commit 一致性、doctor/codex:doctor 零漂移等条目在用户实际执行 `npm publish` 之前不成立，不能作为本卡失败判据（见下方"分栏验收标准"）。
- **MCP `serverInfo` 自定义字段不可见（已实测确认）**：`ImplementationSchema`（`serverInfo` 的底座）是 `z.object()`，会 strip 未知键；直接塞 `commit`/`dirty` 进 `serverInfo` 是确证的死功能（同型于 P1-E 记录的 `metadata.lineRange`）。版本自省 MUST 走 FR-018 裁定的三条存活通道之一。
- **Codex 侧双注册（P0-B 认领范围）导致的 hook 重复**：本卡的 doctor/MCP 改动不得因该并行卡的状态而崩溃或重复计数，但不承担修复双注册本身的责任。
- **`plugins/spectra/.mcp.json` 走 PATH 全局二进制**：census/doctor 相关改动需在文档中明确"本机跑的是哪个二进制"这件事本身有历史盲区，本卡只做到"报出来"，不改变 `.mcp.json` 的启动方式（评估该项超出 G0-3 范围，若涉及改动需在 plan 阶段单独确认）。
- **F241 口径中不可脚本化的人工环节被误当自动化**：M-1（逐次手工记账，"记账必须在调用当下写"）与 M-3（人工逐条判真伪，判读者非盲）本质是人工协议，本卡 MUST NOT 把它们包装成"一键重跑脚本"假装已自动化；只交付协议文档与记账模板。

## Requirements *(mandatory)*

### Functional Requirements

**G0-1 发布版本对齐**

- **FR-001**: 版本号变更 MUST 只发生在 `contracts/release-contract.yaml`，并 MUST 经 `npm run release:sync` 传导至 `package.json` / `plugin.json` / `marketplace.json` / `package-lock.json` / README 受控行；禁止手改这些派生文件。**[必须]**
- **FR-002**: `products.spectra.version` MUST 从 4.4.0 bump 到 4.5.0；`products.spec-driver.version` MUST 从 4.4.2 bump 到 4.4.3；两条版本线独立递增。**[必须]**
- **FR-003**: `CHANGELOG.md` MUST 新增条目，覆盖 `[4.1.1]` 之后到 `[4.5.0]` 的全部变更，按 F2xx 卡聚合（不逐 commit 罗列）。版本边界锚点已考证（`research/probe-findings.md` P5）：4.2.0 由 `27ce6fbe` 设定（区间 `v4.1.1..27ce6fbe`，132 commit）、4.3.0 由 `fbb0b88a` 设定（区间 `27ce6fbe..fbb0b88a`，140 commit）、4.4.0 由 `0d292e3b` 设定（区间 `fbb0b88a..0d292e3b`，163 commit；但实际发布 `gitHead` 是 `0ae3eb70`）、4.5.0（本卡，区间 `0ae3eb70..HEAD`，71 commit，其中动 `src/` 的 18 个）。**[必须]**
- **FR-004**: CHANGELOG 中现存的 `[Unreleased]` 段（F140 内容，行 47-290）MUST 被显式处置：`[AUTO-RESOLVED: 该段内容早于当前顶部 [4.1.1] 版本发布，属历史归档错位而非真正未发布；采用将其归入其实际发布所属版本区间（若可依 git log 时间线考证）或改标题为明确的历史版本号/日期区间，去掉 "Unreleased" 字样，避免继续误导读者以为存在未随任何版本发布的内容]`。**[必须]**
- **FR-005**: 归纳性 CHANGELOG 叙述的 `[推断]` 标注边界 MUST 明确：`contracts/release-contract.yaml` 的 `productMappingDescription` 字段已含已入库的一手逐版本摘要（spectra v4.3.0/v4.2.0/v4.1.1，spec-driver v4.4.2…v4.0.0），据此改写 CHANGELOG **不算**"事后重构"、无需标 `[推断]`；仅当叙述内容超出该字段与相关 commit message 字面信息之外（例如对多个 commit 做归纳性总结、推测未落笔的动机）时才 MUST 标 `[推断]`。**[必须]**
- **FR-006**: `npm run release:sync` 执行后 MUST 使 `npm run release:check` 通过（exitCode=0，无 fail 级 check）。**[必须]**
- **FR-007**: `npm run release:publish:dry` MUST 在本卡验收范围内跑通。**[必须]**
- **FR-008**: 实际 `npm publish` MUST 由用户在 host shell 手动执行；本卡的自动化流程与 CI MUST NOT 代为执行或自动触发真实发布。**[必须]**

**G0-2 CI 治理链接入 + 发布断层预警**

- **FR-009**: `.github/workflows/ci.yml` MUST 新增 `npm run repo:check` 与 `npm run release:check` 两个步骤，且 `repo:check` MUST 排在既有 `Build Knowledge Graph`（`batch --mode graph-only`）步骤之后（`repo:check` 含依赖 `specs/_meta/graph.json` 的 `graph-quality:*` 判据，该路径被 gitignore，干净 checkout 无此文件，顺序颠倒会误红）。**[必须]**
- **FR-010**: `release:check`（`validate-release-contracts.mjs` → `validateReleaseContract`）MUST 新增一条 warning 级检查：当 HEAD 相对"已发布版本对应的 commit"领先且触达 `src/` 的 commit 数 N≥5 时输出 warning 文本；该 warning MUST NOT 使 exitCode 非零、MUST NOT 使整体 `status` 变为 fail（既有 `payload.warnings` 承载通道已具备，直接复用，不改输出契约）。**[必须]**
- **FR-011**: 当"已发布版本对应的 commit"事实源不可达时，判据 MUST 输出可见的 indeterminate 提示（进入 `payload.warnings`），MUST NOT 静默跳过、MUST NOT 默认判定为"无领先"。不可达须覆盖三种情形：(a) `npm view` 网络请求失败/超时；(b) 返回结果中 `gitHead` 字段缺失；(c) `gitHead` 对应的 commit 在本地 git 仓中不存在（如浅克隆场景，`git cat-file -e` 失败）。**[必须]**
- **FR-012**: "已发布版本对应的 commit"事实源 MUST 使用 `npm view spectra-cli --json` 返回的 `gitHead` 字段（已实测：`gitHead=0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3` 对应已发布的 `version=4.4.0`，与 SSoT §0 记录的已发布 build 戳 `0ae3eb7` 完全吻合），MUST NOT 新增 `contracts/release-contract.yaml` 的持久化字段来近似该锚点（该方案已被证伪：本仓库真实历史中"版本号 bump commit"`0d292e3b` 与真正发布的 `gitHead` `0ae3eb70` 相差 9 个 commit，用 bump commit 做锚点会系统性少算 N；同时新增持久化字段属宪法 III 意义上的多余实体）。N 的计数口径 MUST 为 `git rev-list --count <gitHead>..HEAD -- src/`（本仓当前实测该值为 18）。该请求 MUST 设超时（如 5s），超时按 FR-011(a) 处理。**[必须]**
- **FR-013**: 判据 MUST 提供一个测试可注入的覆盖入口（如环境变量 `SPECTRA_PUBLISHED_REF`，取值为 commit-ish；设置时判据直接使用该值代替 `npm view` 查询结果），否则"用变异证明会红"的卡面硬约束无法在离线单测中构造。该 warning 逻辑 MUST 配至少两条变异测试：(a) 通过 `SPECTRA_PUBLISHED_REF` 构造 N≥5 场景，断言 warning 出现且 exitCode=0；(b) 构造 N<5 场景与"事实源不可达且未设置覆盖入口"场景，断言前者不误报为"领先"、后者输出 indeterminate 而非静默通过。**[必须]**

**G0-3 doctor commit 比对 + MCP 版本自省**

- **FR-014**: `codex-runtime-doctor-core.mjs` 四方比对 MUST 新增基于 commit 的比对维度；既有 semver 比对 MUST 保留但降为次级信号。**[必须]**
- **FR-015**: commit 比对结果对外 MUST 仅以派生枚举形式呈现（`match` / `mismatch` / `absent` / `unreadable`）；commit 原始字符串（含其任意子串）在任何时刻 MUST NOT 进入报告正文、日志或返回体（F236/F240 脱敏裁决不可回退：commit 后缀在语法上与 32/40 位十六进制凭据同构）。同一脱敏纪律 MUST 同步适用于 G0-2 的 `ReleaseGapWarning` 结构（见 Key Entities）——warning 文本与结构体 MUST NOT 携带 `gitHead`/commit 原串。**[必须，宪法硬约束]**
- **FR-016**: `tests/unit/codex-runtime-doctor-redaction.test.ts` MUST 保留并扩展覆盖新增字段，验证新字段不泄露 commit 原串。**[必须]**
- **FR-017**: MCP server MUST 对外暴露版本自省信息（`{version, commit, dirty}`，沿用 `dist/.spectra-build-meta.json` 字段），且该暴露 MUST 是对现有 MCP 接口的纯增量，MUST NOT 改变既有 17 个工具的 schema。**[必须]**
- **FR-018**: 暴露方式已实测判定（`research/probe-findings.md` P1，`@modelcontextprotocol/sdk` zod 3.25.76）：`serverInfo` 的底座 `ImplementationSchema` 是 `z.object()`，会 strip 未知键——`serverInfo.commit`/`serverInfo.dirty` 等自定义键经官方客户端 SDK 解析后必定丢失，是确证的死功能（同型于 P1-E 记录的 `metadata.lineRange`），MUST NOT 采用。存活通道只有三条候选形态，plan 阶段 MUST 在其中裁决并写明理由：**(A)** 用 `serverInfo.description`（`ImplementationSchema` 官方字段，实测保留）承载一行人可读 build 串；**(B)** 新增一个独立自省 MCP 工具，返回结构化 `{version, commit, dirty}`；**(C)** A+B 组合。无论选择哪种形态，MUST 有测试证明该字段/工具经官方 SDK 客户端（或等价的协议层解析）处理后仍可见——防止再造一个死功能。**[必须]**
- **FR-019**: doctor 报告 SHOULD 标注 MCP 实际运行的二进制 build（区分 PATH 全局 `spectra` 与本 worktree `dist`），使用户能判断"MCP 跑的是不是这次发布的版本"。**[可选]**——去掉后 doctor 仍能完成 commit 比对核心功能，但用户排查"为什么 MCP 行为对不上代码"时会缺一步线索；保留。

**G0-4 adoption 与图质量基线工具**

- **FR-020**: 系统 MUST 提供一个可一键重跑的 adoption census 脚本，扫描 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/`，按工具名聚合 `mcp__*spectra*` 调用次数，输出 17 个已知工具的调用分布与零调用清单。**[必须]**——该脚本仅覆盖"调用次数统计"这一可脚本化维度；F241 口径中 M-1（grounding 命中率手工记账）与 M-3（review 发现率人工判真伪）本质是人工协议，MUST NOT 被本脚本或任何自动化包装成"已脚本化"（见 FR-023 与 Edge Cases）。
- **FR-021**: census 脚本 MUST 仅使用 Node.js 内置模块实现，MUST NOT 引入新的 npm 依赖，MUST NOT 建立可插拔数据源抽象层、可视化、历史存储或自动告警（YAGNI，超出"扫描→聚合→输出"范围的能力一律不做）。**[必须]**
- **FR-022**: census 脚本产生的原始 dump（含任何 transcript 摘录）MUST NOT 入库；只有脚本本身（重算器）入库。**[必须]**
- **FR-023**: 系统 MUST 提供一份图质量复测冻结口径文档，**主复用目标为既有 `scripts/graph-accuracy.mjs`**（632 行，F147 Sprint 3 Phase B.1，已输出 `callPrecision`/`callRecall`，`--baseline-repo`/`--baseline-commit`/`--baseline-scope` 即"外部语料 + 钉版本"的现成入口，满足 SSoT §9 的外部语料第二口径要求）；`specs/241-graph-keepalive-kb-grounding/pilot/` 的 `measurement-design.md`/`ledger.jsonl`/`ledger-verify.mjs`/`ledger-schema-check.mjs` 等资产列为**次级/交叉参照**（用于 M-2 部分与历史口径对齐，不作为主实现）。文档 MUST NOT 建立平行指标框架。**[必须]**
- **FR-024**: 图质量复测冻结口径文档 MUST 要求外部语料作为第二口径输入（经 `graph-accuracy.mjs` 的 `--baseline-repo`/`--baseline-commit` 落实），MUST NOT 仅以仓内代码作为唯一语料（呼应 F263 教训）。文档 MUST 如实转述 `graph-accuracy.mjs` 自述的两条局限——**`label-only` 匹配（不验证 caller 调用上下文）**、**不区分 method 与 function**——MUST NOT 将其 `callRecall` 表述为等价于"经上下文校验的 caller recall"（宪法 IV，禁止过度确定的归纳表述）。**[必须]**
- **FR-025**: 本卡 MUST NOT 交付 adoption 调用次数或 caller recall/precision 的实际数字；相关文档 MUST 显式标注"数字由发布后一周的 milestone-next 回收"。**[必须]**

### Key Entities / 接口契约

- **ReleaseGapWarning**（`release:check` 输出的 `payload.warnings` 数组元素）：`{ message: string, srcCommitCount: number, publishedVersion: string, publishedCommitStatus: 'resolved' | 'absent', sourceStatus: 'ok' | 'indeterminate' }`。`publishedCommitStatus='resolved'` 表示已从 `npm view`（或 `SPECTRA_PUBLISHED_REF` 覆盖）拿到有效 commit 并完成比对；`'absent'` 表示拿不到。**不携带 `gitHead`/commit 原串本身**（与 FR-015 脱敏纪律同口径）。仅在 `srcCommitCount >= 5` 且 `sourceStatus === 'ok'` 时产出可读 warning 文本；`sourceStatus === 'indeterminate'` 时单独输出一条"无法判定"提示，不计入领先量判据。（**实现落地注**：最终实现复用既有 `checks[].evidence` + `warnings: string[]` 两通道而非独立 warning 对象，领先量字段名为 `srcCommitsAhead`；语义与本实体等价，quality-review INFO 已记录该演化差异。）
- **DoctorCommitComparison**：doctor 四方比对新增字段，取值枚举 `'match' | 'mismatch' | 'absent' | 'unreadable'`；不携带原始 commit 值。既有 semver 比对字段保留不变。
- **McpSelfIntrospection**：`{ version: string, commit: string, dirty: boolean }`，来源为 `dist/.spectra-build-meta.json`；挂载点由 FR-018 裁定的 A/B/C 形态决定（A：`serverInfo.description` 一行可读串；B：独立自省工具返回结构化对象；C：二者兼有），MUST 有客户端侧解析可见性的测试证明。
- **AdoptionCensusOutput**：`{ generatedAt: string(ISO), sourceDirs: string[], sourceStatus: 'found' | 'not-found' | 'empty', tools: Array<{ name: string, callCount: number }>, zeroCallTools: string[] }`；覆盖已知的 17 个 MCP 工具名，未识别的工具名归入独立"unknown"桶而非丢弃。
- **GraphQualityRerunPlan**（口径文档，非代码实体）：以 `scripts/graph-accuracy.mjs` 的调用范式（钉死 `--source`/`--graph`/`--baseline-repo`/`--baseline-commit`/`--baseline-scope`）为主复用清单，F241 pilot 资产为次级参照；含如实转述的 `label-only`/method-function 不分两条局限声明 + "数字待发布后回收"的显式声明。
- **PublishedRefResolution**（G0-2 内部逻辑契约，非持久化字段）：`resolve(): { ref: string, source: 'env-override' | 'npm-view' } | { status: 'indeterminate', reason: 'network' | 'missing-git-head' | 'unreachable-commit' }`；`SPECTRA_PUBLISHED_REF` 环境变量存在时优先于 `npm view` 查询（测试注入入口，见 FR-013）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 版本发布断层清零——`npm view spectra-cli version` 与本仓库 `contracts/release-contract.yaml` 中记录的版本号一致（发布后验证）。
- **SC-002**: CI 首次在 push/PR 上执行 `repo:check` + `release:check`；任何后续版本落后已发布版本 ≥5 个 `src/` commit 时都能在 CI 日志中看到非阻断 warning，不需要人工翻 commit log 才能发现发布断层。
- **SC-003**: doctor 能区分"语义版本号相同但实际 build 不同"的场景（commit mismatch 可被检测），且该能力不泄露任何 commit 原始字符串。
- **SC-004**: 维护者可在 5 分钟内跑出本机 MCP 调用分布与零调用工具清单，无需手工翻阅原始 transcript 文件。
- **SC-005**: 图质量复测可通过复用 `graph-accuracy.mjs` 一键跑出结果（发布后一周执行），不需要重新设计测量口径或新建指标框架。

## Acceptance Criteria（分栏：本卡内可验收 vs 发布后验收）

### 本卡内可验收（不依赖用户执行 `npm publish`）

1. `contracts/release-contract.yaml` 中 `products.spectra.version=4.5.0`、`products.spec-driver.version=4.4.3`，且所有派生文件由 `npm run release:sync` 生成（无手改痕迹）。
2. `CHANGELOG.md` 补齐 `[4.1.1]` 之后到 `[4.5.0]` 的条目（含追认 4.2.0/4.3.0/4.4.0），`[Unreleased]` 段按 FR-004 方案处置完毕。
3. `npm run release:check` 通过（exitCode=0）。
4. `npm run release:publish:dry` 通过。
5. `.github/workflows/ci.yml` 含 `repo:check`（排在图建成步骤之后）与 `release:check` 两个新步骤。
6. FR-013 要求的测试注入入口（`SPECTRA_PUBLISHED_REF`）与两条变异测试（N≥5 触发 / N<5 或事实源不可达不触发）存在且通过。
7. doctor 新增 commit 比对枚举字段落地，`codex-runtime-doctor-redaction.test.ts` 扩展覆盖并通过（新字段不泄露 commit 原串）。
8. MCP server 按 FR-018 裁定的形态（A/B/C）落地版本自省，既有 17 个工具 schema 无变化，且有测试证明该自省信息经客户端 SDK 解析后仍可见。
9. adoption census 脚本可在本机运行并输出符合 `AdoptionCensusOutput` schema 的结果（不要求特定调用次数）。
10. 图质量复测冻结口径文档存在，以 `graph-accuracy.mjs` 为主复用目标、明确引用 F241 pilot 资产为次级参照、要求外部语料、如实转述 label-only 局限、并声明数字延后回收；M-1/M-3 的人工协议部分以文档+模板形式交付，未被包装成脚本。

### 发布后验收（依赖用户在 host shell 执行 `npm publish`，本卡不承诺完成时点）

1. `npm view spectra-cli version` = 4.5.0。
2. 全局 `spectra --version` 报告的 commit 与 master HEAD 一致。
3. `npm run judge:doctor` / `codex:doctor` 零漂移。
4. G0-4 两条基线数字（adoption 实际调用次数、caller recall/precision 复测结果）由发布后一周的 milestone-next 回收并落账。

## Out of Scope

- `codex-runtime-doctor-io.mjs:273` 的 `.find` 首匹配缺陷 → P0-D 认领。
- Codex hooks 双注册 / `hooks/hooks.json` 分发路线切换 → P0-B 认领。
- MCP **返回体**（impact/context/detect_changes 的 `freshness` / coverage-boundary 四分 / `nextStepHint` 改写）→ P0-C 认领；本卡只做 server 级版本自省，不碰工具返回体结构。
- fix-compliance 门禁证据源换代 → P0-A 认领。
- CHANGELOG 之外的产品表面清扫（`lineRange` 死功能、`graph_community` 死工具等）→ P1-E 认领。
- `plugins/spectra/.mcp.json` 从 `command: "spectra"`（PATH 全局二进制）改为可钉版本的启动方式——本卡评估但不实施该改动，仅在 doctor 报告中"报出"实际二进制 build（FR-019）。
- 实际执行 `npm publish`——由用户在 host shell 手动完成，不在本卡自动化范围内。
- adoption 与图质量基线的**实际数字**回收——由发布后一周的 milestone-next 循环完成，本卡只交付工具与口径。
- F241 口径 M-1（手工记账）与 M-3（人工判真伪）本身的执行——本卡只交付协议文档与记账模板，不代为执行，也不试图脚本化这两个人工环节。

## Assumptions（凡未核实一律标注 `[待验证]`）

1. **MCP `serverInfo` 自定义字段客户端可见性** — 已核实（非待验证）。实测（`research/probe-findings.md` P1，`@modelcontextprotocol/sdk` zod 3.25.76）：`ImplementationSchema.parse({name:'spectra',version:'4.5.0',commit:'abc1234',dirty:false})` 结果为 `{"name":"spectra","version":"4.5.0"}`——`commit`/`dirty` 被 strip；`ImplementationSchema.shape` 的官方字段集合为 `name, title, icons, version, websiteUrl, description`；`InitializeResult` 顶层与 `_meta` 因用 `z.looseObject` 而保留自定义键。复跑命令：
   ```bash
   node --input-type=module -e "
   import { ImplementationSchema, InitializeResultSchema } from '@modelcontextprotocol/sdk/types.js';
   console.log(JSON.stringify(ImplementationSchema.parse({name:'spectra',version:'4.5.0',commit:'abc1234',dirty:false})));
   console.log(Object.keys(ImplementationSchema.shape));
   "
   ```
   结论已写入 FR-018：MUST NOT 选择"serverInfo 补自定义字段"路线。
2. **"已发布版本对应的 commit"事实源** — 已核实（非待验证）。`npm view spectra-cli --json` 的 `gitHead` 字段是权威事实源，实测 `gitHead=0ae3eb70b1b6b2a318f3ef926594ca8d0784a2f3` 对应 `version=4.4.0`，与 SSoT 记录的已发布 build 戳完全吻合；复跑命令：
   ```bash
   npm view spectra-cli --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.version, j.gitHead)})"
   ```
   git tag 已核实**不可用**：全仓仅 3 个 tag（`spectra-v4.0.1`/`spectra-v4.1.0`/`v4.1.1`），命名不一致且落后已发布版本 3 个 minor。原先设想的"新增 `lastKnownBuildCommit` 持久化字段"方案已被证伪并撤销（见 FR-012）。剩余待验证项：网络不可达时的降级路径已由 FR-011/FR-013 的测试注入入口架构性覆盖，无需额外验证。
3. **CI 环境（GitHub Actions `ubuntu-latest`）出网访问 npm registry 的稳定性** — `[待验证]`；FR-011/FR-013 的设计已确保离线场景不会误判（indeterminate 可见 + 测试注入入口不依赖网络），故此项风险已被架构性规避，仅需在 plan 阶段确认不需要额外网络前置声明。
4. **adoption census 的统计范围仅限本机** — census 脚本读取的是运行脚本这台机器上的 `~/.claude/projects` 与 `~/.codex/sessions`，不做跨机器聚合；这是有意的范围限定（YAGNI，FR-021），非遗漏。
5. **图质量复测的"外部语料"来源** — `[待验证]`；`graph-accuracy.mjs` 的 `--baseline-repo`/`--baseline-commit` 已提供入口，但具体选用哪个外部仓库/commit 作为本次复测语料，留待 plan 阶段结合 F241 pilot 历史选材确认，不在本卡臆断具体语料清单。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：3 个新增（adoption census 脚本、图质量复测口径文档、G0-2 的 `PublishedRefResolution` 判据逻辑+`SPECTRA_PUBLISHED_REF` 注入入口）；doctor commit 比对枚举与 MCP 自省属对既有模块的增量扩展，非独立新组件。不再新增 `contracts/release-contract.yaml` 持久化字段（原方案已撤销）。
- **接口数量**：5（ReleaseGapWarning 输出结构、DoctorCommitComparison 枚举、McpSelfIntrospection 字段/工具、AdoptionCensusOutput schema、GraphQualityRerunPlan 文档接口）。
- **依赖新引入数**：0（宪法约束 FR-021，一律用 Node.js 内置模块）。
- **跨模块耦合**：是——同时修改 `release-contract-core.mjs` / CI workflow / doctor-core / MCP server 四个既有模块的对外行为，但彼此互不依赖、可并行开发验证。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无数据迁移。
- **总体复杂度**：**MEDIUM**（组件 3 落在 3-5 区间；接口 5 落在 4-8 区间；无复杂度信号命中，但跨模块耦合触及 4 个既有模块，建议 GATE_DESIGN 复核各模块改动的边界隔离性，尤其 doctor 脱敏不变量、`ReleaseGapWarning` 同口径脱敏、MCP schema 纯增量三条硬约束）。
