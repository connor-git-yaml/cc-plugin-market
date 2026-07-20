# Feature Specification: Codex Plugin 一体分发（A1）

**Feature Branch**: `claude/codex-plugin-distribution-2940d3`
**Created**: 2026-07-20
**Status**: Approved (GATE_DESIGN passed 2026-07-20)
**Input**: M9 轨道 A Codex First-Class 首件（roadmap `docs/design/milestone-M9-codex-trusted-live-graph.md` §3 A1）：为 Spectra 与 Spec Driver 各增 `.codex-plugin/plugin.json`，令 Codex 用户一次 plugin 安装即获得 MCP + 全部 skills + 受信 hooks，并用一致性矩阵门禁守护分发面不漂移。

## 概述

当前 Codex 侧只有 `.codex/skills/` 下 8 个由脚本生成的 wrapper（对应 9 个 canonical Spec Driver skill，缺 `spec-driver-refactor`），**没有** `.codex-plugin/` manifest、没有 Spectra 的 Codex 分发、没有 MCP/hooks 的 Codex 侧注册、也没有支撑「一次安装」的 marketplace catalog。Codex 用户若想用 Spectra 的知识图谱能力或 Spec Driver 的编排 skill，需要手工拼装，容易漏装或版本漂移。

经本机 codex binary（0.142.0）实测证实：真实 Codex plugin manifest 用 `"skills": "./skills/"` 显式路径字段声明 skills 目录（而非 Claude 侧的约定发现），且 **`codex plugin add` 只能从 configured marketplace 安装，不支持直接指定本地路径**——这意味着若不 ship marketplace catalog（`<root>/.agents/plugins/marketplace.json`），「一次安装」在 Codex 上没有可执行的用户路径。本 feature 因此不仅要新增两份 `.codex-plugin/plugin.json`，还要（a）解决 manifest 引用的 skills 目录内容与 Codex wrapper 集合的对应关系，（b）ship 一份 tracked marketplace catalog 并处理其与本仓 `.gitignore`/worktree symlink 现状的冲突，（c）在 `repo:check` / `release:check` 链路中新增一致性矩阵校验，防止 Codex manifest 与 Claude 侧 canonical source（skill 数量、MCP 配置、release-contract 版本字段）产生漂移。

**GATE_DESIGN 已于 2026-07-20 通过，用户就本 spec 的三项 Open Questions 全部拍板选择推荐项**，具体决议见文末「GATE_DESIGN 决议记录」；正文各处涉及这三项决策的表述已同步更新为已裁决口径。

## Non-Goals / Out of Scope

- **A2（refactor wrapper 补齐 / runtime capability adapter / runtime-neutral 模型层）**：本 feature 不新增 `spec-driver-refactor` 的 Codex wrapper。当前 9 canonical skill 对 8 codex wrapper 的缺口继续存在，作为一致性矩阵中的**已知 waiver** 显式标注（见 FR-012，形态已由 GATE_DESIGN 裁定），不阻塞矩阵通过；补齐工作留给 A2。
- **A3（Codex hooks payload E2E 合同 / apply_patch payload / PLUGIN_ROOT）**：本 feature 不建立 Codex 侧 hooks 的深度执行合同或端到端 payload 校验。经本机实测（openai github v0.1.6、superpowers 5.1.3 两份真实 manifest 均无 hooks 字段）确认，A1 对 hooks 的交付止步于「plugin 包内随 skills 一起 ship 已有 hook 脚本，manifest 不声明任何 hooks 字段」，不涉及 hooks 触发时机、payload 结构在 Codex runtime 下的行为验证。
- **A4（CODEX_HOME 全局路径统一）**：本 feature 不改变 Codex 全局路径解析逻辑，也不处理 `~/.codex/plugins/cache/` 的路径歧义问题。
- **不削弱 Claude Code 行为**：`.claude-plugin/plugin.json`、`plugins/*/skills/`、`.mcp.json`、`plugins/*/hooks/hooks.json` 在 Claude Code 侧的现有安装、发现、执行行为保持不变。本 feature 只新增 Codex 侧的对偶 manifest 与 marketplace catalog，不修改任何 canonical Claude 制品的语义。
- **不做版本/metadata 手改**：所有 version、description 等受控字段仍以 `contracts/release-contract.yaml` 为 canonical source，通过 `npm run release:sync` 生成，本 feature 新增的 Codex manifest 字段若涉及版本号，同样纳入该 contract 驱动，不允许脚本外手工编辑。
- **不做 `.agents`/worktree 基础设施的大范围重构**：为 ship tracked marketplace catalog，本 feature 仅做**最小化**收窄——收窄 `.gitignore` 对 `.agents` 的忽略规则（如 `.agents/*` + `!.agents/plugins/`）、把 `scripts/sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 从整目录 `.agents` 收窄到 `.agents/skills`。GATE_DESIGN 已确认该最小化收窄方案（见 OQ-002 决议），不做更大范围的 `.worktreeinclude` 基础设施重构或 worktree 本地态管理机制的整体调整（如需，属其他 feature 范围）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Codex 用户一次安装获得 Spectra 全部能力 (Priority: P1)

作为使用 Codex CLI 的开发者，我希望执行一次 Spectra plugin 安装命令，就能同时获得知识图谱 MCP server、Spectra 相关 skills（spectra / spectra-batch / spectra-diff），而不需要分别手动注册 MCP、逐个拷贝 skill 目录。

**Why this priority**: 这是 A1 的核心交付物之一——"一次安装即获得完整能力"直接决定 Codex 用户能否顺利上手 Spectra；如果 MCP 需要额外手工配置，用户会在第一步就卡住，之后的知识图谱能力全部不可达。

**Independent Test**: 在干净 fixture 目录下，先通过 `codex plugin marketplace add` 注册本仓 marketplace catalog（`<root>/.agents/plugins/marketplace.json`，见 FR-013），再执行 `codex plugin add spectra@<market>` 完成安装（读取 `.codex-plugin/plugin.json`），随后用机械化断言（结构性检查 manifest 中 `mcpServers` 字段是否正确引用 `.mcp.json` 且包含 `spectra` server 定义；如测试环境有 codex binary 则辅以 `codex mcp list --json` 复核）验证 Spectra MCP 已注册、3 个 skills 目录均可被发现。可独立于 Spec Driver plugin 完成测试。

**Acceptance Scenarios**:

1. **Given** 一个未安装过 Spectra 的干净 Codex 环境，**When** 用户通过 configured marketplace 完成一次 `codex plugin add`，**Then** 该环境下可机械确认 Spectra MCP server 已注册（结构性断言或 `codex mcp list` 二选一，取决于测试环境是否具备 codex binary，见 FR-010）。
2. **Given** 同一次安装，**When** 检查 skills 清单，**Then** `spectra` / `spectra-batch` / `spectra-diff` 三个 skill 均可被 Codex 发现，数量与 `plugins/spectra/skills/` 下 canonical 数量一致（Spectra 的 skill 内容语汇是 runtime 中立的，无需 Codex 专属适配，见 FR-004）。
3. **Given** manifest 中未声明任何 hooks 字段，**When** 检查已随 plugin ship 的 hook 脚本，**Then** 现有 `hooks/hooks.json` 中已定义的 hook（如 SessionStart→postinstall.sh）在 plugin 包内可被找到（文件系统层面），不要求验证其在 Codex runtime 下的触发行为（该验证属 A3）。

---

### User Story 2 - Codex 用户一次安装获得 Spec Driver 全部 Codex 适配 skills 与 hooks (Priority: P1)

作为使用 Codex CLI 的开发者，我希望执行一次 Spec Driver plugin 安装，就能获得当前已具备 Codex wrapper 覆盖的全部 skills 与已随 plugin ship 的 hooks 资源，不需要再单独跑 `codex-skills.sh install` 之类的手工脚本。

**Why this priority**: Spec Driver 是本仓库编排流程的核心入口；若 Codex 用户无法一次性拿到与 Claude 侧对等（在 A2 补齐前为"已知有缺口但显式声明"的对等）的 skill 集合，M9 轨道 A 的"Codex 一等支持"承诺就不成立。

**Independent Test**: 在干净 fixture 目录下通过 marketplace 安装 Spec Driver plugin，机械枚举 Codex 侧可发现的 skill 数量与列表，与 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 中登记的 entries 数量与身份比对，确认一致（见 FR-005；目录的具体生成/落位机制由 plan 阶段给出工程方案，GATE_TASKS 时用户复核，见 OQ-004 决议）。

**Acceptance Scenarios**:

1. **Given** 一个未安装过 Spec Driver 的干净 Codex 环境，**When** 用户通过 configured marketplace 完成一次 `codex plugin add`，**Then** `wrapper-source-of-truth.yaml` 登记的全部 wrapper skill（当前 8 个）均可被发现，且缺失的 `spec-driver-refactor`（9 canonical 中的第 9 个）在一致性矩阵报告中被明确标注为已知 A2 缺口而非未追踪的漂移（waiver 形态见 FR-012）。
2. **Given** 同一次安装，**When** 检查 manifest 的 `"skills"` 字段引用的目录内容，**Then** 该目录内容是 Codex 适配的 wrapper 集合（不含 Claude 专属工具引用如 Task tool / `mcp__plugin_spectra_spectra__*`），而不是 Claude 侧原始 canonical `skills/` 目录（见 FR-005）。
3. **Given** 同一次安装，**When** 检查 hooks 资源，**Then** `plugins/spec-driver/hooks/hooks.json` 中定义的 6 组 hook 对应脚本均随 plugin 包 ship，可在文件系统层面被找到。

---

### User Story 3 - 维护者通过 repo:check / release:check 拦截 Codex 分发漂移 (Priority: P2)

作为本仓库的维护者，我希望在提交前的 `repo:check` 和发布前的 `release:check` 中，自动校验 Codex manifest（`.codex-plugin/plugin.json`）、marketplace catalog 与 Claude 侧 canonical source（skill 目录数量、`.mcp.json` 配置、`release-contract.yaml` 中的版本/metadata）保持一致，一旦有人只改了 Claude 侧却忘记同步 Codex manifest 或 marketplace catalog，CI/本地检查会立刻报错。

**Why this priority**: 没有自动化门禁，Codex manifest 会随时间自然漂移（这正是当前 refactor wrapper 缺口的成因）。此 Story 是 A1 中"防止分发面不漂移"的落地机制，但其价值依赖 P1 的两个 manifest 与 marketplace catalog 先存在，因此排在 P2。

**Independent Test**: 人为制造一次漂移（例如临时改动 `plugins/spectra/skills/` 目录数量但不同步 `.codex-plugin/plugin.json`，或让 marketplace.json 中的 plugin 条目缺失一项），运行 `npm run repo:check`，确认在新增的一致性矩阵 check 项中报错并指出具体漂移点；恢复后确认 `repo:check` 与 `release:check` 均恢复零失败。

**Acceptance Scenarios**:

1. **Given** Codex manifest 与 Claude 侧 skill 数量不一致，**When** 运行 `npm run repo:check`，**Then** 新增的一致性矩阵 check（如 `codex-plugin-consistency`）报 error 并给出具体差异（期望数量 vs 实际数量、涉及的 plugin）。
2. **Given** marketplace.json 中缺失某个 plugin 条目或 `source.path` 与实际 `plugins/<name>` 路径不一致，**When** 运行 `npm run repo:check`，**Then** 校验报错并指出具体条目差异。
3. **Given** Codex manifest 中版本字段与 `contracts/release-contract.yaml` 不一致，**When** 运行 `npm run release:check`，**Then** 校验失败并指出该字段应通过 `release:sync` 同步，而非手工编辑。
4. **Given** 一切一致（含已知 A2 waiver 生效），**When** 运行 `npm run repo:check` 与 `npm run release:check`，**Then** 两者均零失败通过。

---

### Edge Cases

- **refactor wrapper 缺口如何在矩阵中表达而不误报**：一致性矩阵检测到 9 canonical skill 对 8 codex wrapper 的数量差异时，若无显式豁免机制会被误判为未知漂移并拦截提交。**GATE_DESIGN 已裁定**（见 OQ-001 决议）：矩阵在新增契约 YAML `contracts/codex-plugin-consistency.yaml` 内维护一个 `waivers:` 段，登记该已知缺口并附带指向 A2 的说明文字；矩阵读取该段判定为通过而非 error（对应 FR-012）；A2 落地时删除对应 waiver 条目即可，零代码改动。
- **Codex manifest 引用的 skills 目录内容与 Claude canonical skills 目录不能直接复用**：Spec Driver 的 canonical `skills/` 目录内容含 Claude 专属工具引用（Task tool、`mcp__plugin_spectra_spectra__*` 等），若 `.codex-plugin/plugin.json` 的 `"skills"` 字段直接指向该目录，Codex 用户会看到不可执行的 Claude 专属引用；manifest 必须指向内容已适配为 Codex wrapper 的目录（与 `wrapper-source-of-truth.yaml` entries 一致）。**GATE_DESIGN 已裁定**（见 OQ-004 决议）：该目录的具体生成/落位方式决策权移交 plan 阶段，倾向为扩展既有生成器多写一份到 `plugins/spec-driver/` 内的 Codex 适配目录（tracked，纳入一致性矩阵校验），plan 阶段给出工程方案后由 GATE_TASKS 时用户复核（对应 FR-005，spec 层面的内容不变量不变）。
- **测试环境无 codex binary 时的机械确认降级**：CI/沙箱环境可能没有安装 codex CLI；FR-010 已将双层验证策略定为结论——结构性断言（manifest 字段正确性 + `.mcp.json` 内容匹配）作为无 binary 时的必选机械确认路径，真实 `codex mcp list --json` / `codex plugin list --json` 复核作为有 binary 环境下的可选加强验证，不作为唯一验收路径。
- **`.codex-plugin/plugin.json` 与 `.claude-plugin/plugin.json` 版本字段不同步**：若两者各自维护版本号而不都指向 `release-contract.yaml`，会重新引入 F186 之前"多处手改导致漂移"的旧问题；需要新增 manifest 的版本字段也纳入 `release-contract-core.mjs` 的 `expectEqual` 累加器。
- **本地 `local` 版本缓存与正式版本混淆**：Codex 安装缓存路径包含版本号（`~/.codex/plugins/cache/$MARKET/$PLUGIN/$VERSION/`），`local` 是特殊值；一致性矩阵校验版本号时需排除或特殊处理开发态的 `local` 安装，避免误报。
- **`.agents` 被 `.gitignore` 忽略且被 worktree symlink 整目录共享，导致 tracked marketplace.json 无法安全落地**：本仓 `.gitignore` 当前忽略整个 `.agents` 目录，且 `scripts/sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 把整个 `.agents` 作为软链指向主仓（worktree 内 `.agents` 是 symlink）。若直接在此结构下 ship tracked `<root>/.agents/plugins/marketplace.json`，该 tracked 文件会经由 symlink 被写入/污染主仓、且被现有 ignore 规则挡在 git 树外（fresh clone 拿不到，marketplace 形同虚设）。**GATE_DESIGN 已裁定**（见 OQ-002 决议）：本 feature MUST 做最小化收窄：(a) `.gitignore` 从整目录忽略改为 `.agents/*` + `!.agents/plugins/` 之类的显式放行；(b) `SYMLINK_TARGETS` 从整目录 `.agents` 收窄到 `.agents/skills`（marketplace.json 所在的 `.agents/plugins/` 不再被 symlink 接管，保持每个 worktree/主仓各自独立、真实 tracked）；(c) 确认 fresh clone 后该文件确实随仓库落地；不做 `.worktreeinclude` 层面的更大范围重构（对应 FR-013）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 为 `plugins/spectra/` 新增 `.codex-plugin/plugin.json`，作为 Codex 侧对偶于 `.claude-plugin/plugin.json` 的 canonical manifest，声明 name / version / description / author / homepage / repository / license / keywords 等 metadata（版本与 description 字段值来源于 `contracts/release-contract.yaml`，不得手工独立维护）。`[必须]`
- **FR-002**: 系统 MUST 为 `plugins/spec-driver/` 新增 `.codex-plugin/plugin.json`，结构与字段来源约束同 FR-001。`[必须]`
- **FR-003**: `plugins/spectra/.codex-plugin/plugin.json` MUST 用 `"mcpServers": "./.mcp.json"` 字段引用 `.mcp.json`，使 Codex 安装该 plugin 后可发现并注册 `spectra` MCP server，无需用户额外手工执行 `codex mcp add`。`[必须]`
- **FR-004**: `plugins/spectra/.codex-plugin/plugin.json` MUST 用 `"skills": "./skills/"` 字段直接指向 `plugins/spectra/skills/` 目录（3 个 skill：spectra / spectra-batch / spectra-diff）。因该目录内容 runtime 中立、不含 Claude 专属工具引用，无需额外的 Codex 适配转换即可直接复用。`[必须]`
- **FR-005**: `plugins/spec-driver/.codex-plugin/plugin.json` 的 `"skills"` 字段 MUST 指向一个内容为 **Codex 适配 wrapper 集合**（与 `plugins/spec-driver/contracts/wrapper-source-of-truth.yaml` 登记的 entries 在数量与身份上一致）的目录，而非 Claude 侧原始 canonical `skills/` 目录（该目录含 Task tool、`mcp__plugin_spectra_spectra__*` 等 Claude 专属引用，不能被 Codex 直接消费）。该目录的具体生成/落位方式（倾向：扩展既有生成器多写一份到 `plugins/spec-driver/` 内的 Codex 适配目录，tracked 并纳入一致性矩阵校验）由 plan 阶段给出工程方案、GATE_TASKS 时用户复核（决策权移交 plan，见 OQ-004 决议）；spec 层面只约束"manifest 指向的目录内容必须与 wrapper contract 一致"这一不变量；已有的 F186 body-sha256 盖章链（`extract-wrapper-body.mjs --sha256` + `validate-wrapper-sources.mjs` 复算比对）MUST 继续对该目录内容生效，不得因落位变化而失效。`[必须，描述性要求不变，落位工程方案见 plan 阶段]`
- **FR-006**: 两个 `.codex-plugin/plugin.json` MUST NOT 声明 hooks 相关字段（经本机 codex 0.142.0 对两份真实 manifest 的实测确认，Codex plugin manifest schema 当前无 hooks 字段）；对应的 hook 脚本（`plugins/spectra/hooks/hooks.json`、`plugins/spec-driver/hooks/hooks.json` 中定义者）MUST 随 plugin 包一起 ship，保证文件系统层面可被发现，但不要求验证其在 Codex runtime 下的实际触发行为（该验证属 A3 范围）。`[必须]`
- **FR-007**: 系统 MUST 在 `scripts/lib/repo-maintenance-core.mjs` 的 `validateRepository()` 校验链中新增一致性矩阵 check（遵循既有 `aggregateValidation(prefix, validateX(...), ...)` 模式），比对 Codex manifest 中声明的 skill 数量/引用目录、MCP 配置与 Claude 侧 canonical source（`plugins/*/skills/` 或对应 Codex 适配目录的实际数量、`.mcp.json` 内容）是否一致，并比对 marketplace.json 中登记的 plugin 条目与 `plugins/<name>` 实际存在的 plugin 是否一致。`[必须]`
- **FR-008**: 系统 MUST 在 `contracts/release-contract.yaml` 与 `scripts/lib/release-contract-core.mjs` 中，将两个 `.codex-plugin/plugin.json` 的 version / description 等受控字段纳入既有 `expectEqual` 累加器校验，使 `npm run release:check` 能检出 Codex manifest 与其他受控文件（`plugin.json`、`marketplace.json`、`package-lock.json`、README）之间的版本漂移。`[必须]`
- **FR-009**: 一致性矩阵校验 MUST 接入既有 `npm run repo:check` 与 `npm run release:check` 命令链（不新增独立命令），使其成为提交前 / 发布前流程的一部分。`[必须]`
- **FR-010**: 验收 Spectra MCP 已被 Codex 发现的机械确认方式采用**双层策略**：(a) MUST 支持"结构性断言"作为基础必选路径——校验 manifest 的 `mcpServers` 引用与 `.mcp.json` 内容一致、且声明了 `spectra` server，此路径不依赖是否安装 codex binary；(b) 若测试执行环境具备 codex binary，SHOULD 额外用 `codex mcp list --json` 与 `codex plugin list --json` 做真实 CLI 复核作为更强验证，但不得将其设为唯一验收路径（避免无 binary 的 CI/沙箱环境测试全数失败）。`[必须]`
- **FR-011**: 系统 MUST 保证本 feature 引入的改动不修改任何 Claude 侧 canonical 制品（`.claude-plugin/plugin.json`、`plugins/*/skills/`、`.mcp.json`、`hooks/hooks.json`）的现有语义，双运行时（Claude + Codex）测试矩阵中 Claude 侧用例结果 MUST 保持与改动前一致。`[必须]`
- **FR-012**: 一致性矩阵 MUST 支持对已知缺口（当前为 Spec Driver 9 canonical skill 对 8 codex wrapper 的 `spec-driver-refactor` 缺口）声明显式 waiver。**waiver 形态已由 GATE_DESIGN 裁定**（见 OQ-001 决议）：新增契约 YAML `contracts/codex-plugin-consistency.yaml`，其中维护一个 `waivers:` 段登记该已知缺口，并附带指向 A2 范围的说明文字；矩阵读取该段，使存在该已知缺口时仍判定为通过，而非将其当作未追踪漂移拦截提交。A2 落地时删除该 YAML 中的对应 waiver 条目即可移除豁免，无需改动矩阵校验代码逻辑本身。`[必须，形态已裁定]`
- **FR-013**: 系统 MUST ship 一份 tracked 的 `<root>/.agents/plugins/marketplace.json`，格式遵循实测确认的 schema（`{name, interface{displayName}, plugins[{name, source{source:"local", path:"./plugins/<name>"}, policy{installation:"AVAILABLE", authentication:"ON_INSTALL"}, category}]}`），列出 `spectra` 与 `spec-driver` 两个 plugin 条目（`source.path` 分别为 `./plugins/spectra`、`./plugins/spec-driver`），使 Codex 用户可通过 `codex plugin marketplace add <本仓路径或 git 地址>` → `codex plugin add <plugin>@<market>` 完成"一次安装"（`codex plugin add` 在本机实测的 0.142.0 版本上不支持直接指定本地路径安装，marketplace catalog 是该安装路径的必要条件而非可选增强）。**GATE_DESIGN 已确认**（见 OQ-002 决议）本 feature MUST 同步做以下最小化收窄，使该 tracked 文件不被现有 `.gitignore` 挡在 git 树外、也不因 worktree symlink 被跨 worktree 污染：`.gitignore` 对 `.agents` 的忽略规则改为放行 `.agents/plugins/`；`scripts/sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 从整目录 `.agents` 收窄到 `.agents/skills`；不做 `.worktreeinclude` 层面的更大范围重构。`[必须，已由 GATE_DESIGN 裁定]`

### Key Entities

- **Codex Plugin Manifest（`.codex-plugin/plugin.json`）**: Codex 侧的 plugin 描述文件，声明 name / version / description / `skills`（路径引用）/ `mcpServers`（路径引用）等；与 `.claude-plugin/plugin.json` 是同一 plugin 的两个运行时对偶表达，version/description 均以 `release-contract.yaml` 为唯一事实源。不含 hooks 字段。
- **Codex 适配 Skills 目录**: Spec Driver plugin 内（落位方式由 plan 阶段给出工程方案，GATE_TASKS 时复核，见 OQ-004 决议）供 `.codex-plugin/plugin.json` 的 `"skills"` 字段引用的目录，其内容与 `wrapper-source-of-truth.yaml` 登记的 entries 一一对应，经 F186 body-sha256 链盖章，区别于 Claude 侧含专属工具引用的 canonical `skills/` 目录。
- **Marketplace Catalog（`.agents/plugins/marketplace.json`）**: Codex 的 repo 级插件目录文件，登记本仓可安装的 plugin 条目（name/source/policy/category），是 `codex plugin add` 的安装入口前提；本 feature MUST ship 为 tracked 文件（见 FR-013）。
- **一致性矩阵（Consistency Matrix）**: `repo:check` / `release:check` 链路中新增的校验单元，比对 Codex manifest ↔ MCP 配置 ↔ skill 数量/目录 ↔ marketplace 条目 ↔ canonical source 是否一致，输出结构化 check 项（`{id, title, status, evidence}`），读取 `contracts/codex-plugin-consistency.yaml` 中的 `waivers:` 段以支持已知缺口豁免。
- **已知缺口 Waiver**: 登记在 `contracts/codex-plugin-consistency.yaml` `waivers:` 段中的"当前允许存在但已追踪"的漂移项（如 refactor wrapper 缺口），带来源说明与移除条件（删除条目即生效），防止真实漂移与已知待办混淆。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在干净 fixture 目录下，先注册本仓 marketplace catalog 再完成一次 Spectra plugin 安装后，机械化断言（结构性检查或 `codex mcp list`/`codex plugin list` 二选一）可确认 Spectra MCP server 已被 Codex 发现且已注册，无需任何额外手工命令。
- **SC-002**: 在干净 fixture 目录下，完成一次 Spec Driver plugin 安装后，manifest 指向的 skills 目录内容与 `wrapper-source-of-truth.yaml` 登记的 entries 在数量与身份上一致（当前 8），且矩阵报告中 refactor 缺口以 `contracts/codex-plugin-consistency.yaml` 中的显式 waiver 呈现而非未追踪错误。
- **SC-003**: 人为制造一次 Codex manifest/marketplace catalog 与 Claude canonical source 的漂移后，`npm run repo:check` 或 `npm run release:check` 中至少一项在 100% 的测试运行中检出并报错，指出具体差异字段。
- **SC-004**: 双运行时（Claude + Codex）全量测试套件（`npx vitest run`）、`npm run build`、`npm run repo:check`、`npm run release:check` 在本 feature 改动完成后均零失败通过。
- **SC-005**: 本 feature 完成后，Claude 侧现有测试（涉及 `.claude-plugin/plugin.json`、skills、hooks、`.mcp.json` 的既有用例）的通过结果与改动前完全一致（不新增失败，也不因改动而"意外变绿"掩盖问题）。
- **SC-006**: fresh clone 本仓库后，`<root>/.agents/plugins/marketplace.json` 与 `.agents/plugins/` 目录在 git 树中确实存在（未被 `.gitignore` 挡住），且跨 worktree 操作（新建/删除 worktree）不会导致该文件被 symlink 机制覆盖或污染主仓其他内容。

## 复杂度评估（供 GATE_DESIGN 审查）

- **组件总数**：2 个新增 manifest 文件（`.codex-plugin/plugin.json` × 2）+ 1 个新增 marketplace catalog 文件（`.agents/plugins/marketplace.json`）+ 1 个新增 Codex 适配 skills 目录（Spec Driver 侧，落位由 plan 阶段确定）+ 1 个新增一致性矩阵校验模块（`scripts/lib/<name>-core.mjs` + `contracts/codex-plugin-consistency.yaml`），共约 5 个新增组件。
- **接口数量**：1 个新增 `validate<Name>({projectRoot})` 函数契约接入 `validateRepository()`；`release-contract-core.mjs` 的 `expectEqual` 累加器新增若干字段级校验条目；`.gitignore` 规则调整、`sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 调整各算一处修改点。约 4 个新增/修改接口/配置面。
- **依赖新引入数**：0（复用既有 `aggregateValidation` 模式、既有 YAML/JSON 解析依赖，不引入新的第三方包）。
- **跨模块耦合**：涉及修改 3 个以上既有模块/配置——`scripts/lib/repo-maintenance-core.mjs`（新增一行 `aggregateValidation` 注册）、`scripts/lib/release-contract-core.mjs`（新增字段进 `expectEqual`）、`.gitignore`、`scripts/sync-worktree-local-state.sh`，以及可能扩展的 `codex-skills.sh`（Codex 适配 skills 目录生成逻辑，按 OQ-004 决议倾向由 plan 阶段扩展该脚本实现）。属于跨模块耦合。
- **复杂度信号**：无递归结构、无状态机、无并发控制、无数据迁移。存在的是"豁免/waiver 列表"这一轻量配置项与"忽略规则/symlink 粒度调整"这一基础设施变更，均不构成经典复杂度信号，但后者涉及仓库级基础设施、需谨慎验证（SC-006）。
- **总体复杂度**：**MEDIUM**（因新增 marketplace catalog 及其与 `.gitignore`/worktree symlink 的交互，组件数与跨模块耦合面均有所扩大；虽无经典复杂度信号，但涉及仓库基础设施改动，风险面高于单纯新增 manifest，故定为 MEDIUM）。

## Open Questions（已全部裁决）

> 以下三项 Open Question 均已在 2026-07-20 的 GATE_DESIGN 中由用户拍板，全部选择本 spec 推荐的选项。原始问题描述保留，供追溯裁决背景；正文各处引用已同步更新为已裁决口径（见上文 Non-Goals / Edge Cases / FR-005 / FR-012 / FR-013）。

- **OQ-001**（RESOLVED）：一致性矩阵对 refactor wrapper 缺口（9 canonical vs 8 codex）的 waiver 表达方式——原提供两个选项（矩阵内置固定豁免列表 vs 矩阵读取独立 waiver 配置文件）。**裁决**：采用「新增契约 YAML `contracts/codex-plugin-consistency.yaml`，内维护 `waivers:` 段」形态，带指向 A2 的说明文字；A2 落地时删除该 YAML 中对应条目即可移除豁免，零代码改动。已落定到 FR-012 与相关 Edge Case。
- **OQ-002**（RESOLVED）：marketplace catalog 是否必须在本 feature 内 ship——原提供选项 A（必须 ship，含最小化收窄）与选项 B（降级为文档化多步骤，推翻 P1 表述）。**裁决**：选项 A。本 feature MUST ship tracked `<root>/.agents/plugins/marketplace.json`（列 spectra + spec-driver 两个 plugin 条目，`source.path` 为 `./plugins/<name>`），并同步做最小化收窄：`.gitignore` 对 `.agents` 的整目录忽略收窄为放行 `.agents/plugins/`；`scripts/sync-worktree-local-state.sh` 的 `SYMLINK_TARGETS` 从整目录 `.agents` 收窄到 `.agents/skills`。不做 `.worktreeinclude` 层面的更大范围重构。已落定到 FR-013、Non-Goals 与相关 Edge Case。
- **OQ-004**（RESOLVED，决策权移交 plan）：Spec Driver 侧"Codex 适配 skills 目录"的生成与落位机制——原判断此问题偏工程实现选择。**裁决**：决策权正式移交 plan 阶段；倾向方案为扩展既有生成器（`plugins/spec-driver/scripts/codex-skills.sh`）多写一份到 `plugins/spec-driver/` 内的 Codex 适配目录，该目录 tracked 并纳入一致性矩阵校验；plan 阶段需给出具体工程方案，GATE_TASKS 时由用户复核。FR-005 保持描述性要求不变（只约束"目录内容须与 wrapper contract 一致"这一不变量），落位细节不在本 spec 层面固化。

### 已通过实测解决的既有疑问（不再作为 Open Question）

- Codex manifest 是否支持声明 hooks 字段：`[AUTO-RESOLVED: 本机 codex 0.142.0 对两份真实第三方 manifest（openai github v0.1.6、superpowers 5.1.3）的实测均未发现 hooks 字段，确认 Codex plugin manifest schema 当前不支持 hooks 作为一等字段；因此 A1 对 hooks 的交付止步于"包内 ship 脚本文件"，见 FR-006]`。

## GATE_DESIGN 决议记录（2026-07-20）

| 编号 | 议题 | 裁决 | 理由指针 |
|------|------|------|----------|
| OQ-001 | waiver 表达形态 | 新增契约 YAML `contracts/codex-plugin-consistency.yaml` 内 `waivers:` 段（非硬编码） | A2 落地时零代码改动，只需删配置行；符合本仓"加新 check 模式：新 `contracts/<name>.yaml` + `scripts/lib/<name>-core.mjs`"的既有扩展惯例（见 `_grounding.md` 「一致性/校验链」节） |
| OQ-002 | marketplace catalog 是否必须 ship | 必须 ship（选项 A），附带 `.gitignore` + `SYMLINK_TARGETS` 最小化收窄 | 本机 codex 0.142.0 实测证实 `codex plugin add` 仅支持从 configured marketplace 安装，不支持直接本地路径安装；不 ship marketplace 会使 P1 User Story 的"一次安装"承诺没有可执行路径 |
| OQ-004 | Codex 适配 skills 目录生成/落位机制 | 决策权移交 plan 阶段；倾向扩展既有 `codex-skills.sh` 生成器 | 属工程实现选择而非用户可感知的产品决策；spec 层面已用 FR-005 固化内容不变量，具体落位交给 plan 阶段设计、GATE_TASKS 复核更合适 |
