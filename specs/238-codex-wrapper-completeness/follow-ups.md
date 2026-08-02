# F238 Follow-ups（显式延后项，非静默跳过）

## FU-1：FR-308 — `DEFAULT_CODEX_MODEL` 兜底值惰性读取（SHOULD，plan 阶段裁决延后）

- **来源**：spec FR-308（SHOULD 级）；plan「FR-308 延后决策记录」（Tasks 审查轮 W6 裁决）
- **内容**：`src/core/model-selection.ts` 的 `DEFAULT_CODEX_MODEL` 常量兜底值来源，可选地从硬编码字面量改为"惰性读取本机 `~/.codex/config.toml` 的顶层 `model` 字段，读取失败时退回现有硬编码兜底值"，复用 `model-selection.ts` 已有的 `try/catch` 容错模式。
- **延后理由**（plan 记录）：(1) 惰性读取的首次 I/O 触发时机与模块顶层 `const` 同步初始化模式存在张力；(2) `~` 在 Node `fs` API 不自动展开，需 `os.homedir()` 拼接；(3) 简单正则匹配顶层 `model = "..."` 存在 TOML section 边界误取风险（`[profiles.x]` 段内同名键）。收益（SHOULD 级兜底）配不上复杂度，且不影响 FR-310 用户表面清理目标。
- **退出条件**（严格按 spec FR-308 原文，不降低标准）：实现"惰性读取 + 读取失败退回现有硬编码兜底值"且新增单测覆盖（读取成功 / ENOENT 退回 / section 边界不误取三态）后，本条目关闭。
- **建议归属**：M10 或 A4（CODEX_HOME 一致性）范围内顺带处理——A4 本就要统一 `CODEX_HOME` 路径 helper，`~/.codex/config.toml` 读取应复用该 helper 而非本 Feature 单独造轮子（这也是延后的额外理由：避免与 A4 重复建设）。

## FU-2：grep 门禁豁免粒度行级收紧（spec「豁免粒度」注记）

- **来源**：spec Grep 门禁定义「豁免粒度：MVP 阶段豁免以文件为最小单位；更细粒度留作 follow-up」
- **内容**：当前 `model-literal-gate-core.mjs` 豁免以整文件为单位（如 `src/core/model-selection.ts` 整体豁免）。行级/代码块级收紧可防"豁免文件内的普通注释新增硬编码漏报"。
- **退出条件**：豁免支持「文件 + 允许的语法位置（如常量定义行）」二元组，并对 `model-selection.ts` 内非映射表位置的新增字面量可检出。

## FU-3：SC-002 执行级 E2E（discovery/load 之外的真实 refactor 工作流触发）

- **来源**：spec SC-002 Review Log（Plan 审查轮 W8）——本 Feature 验收口径收窄为 discovery/load；执行级 E2E 显式划出为 M10 增强
- **内容**：在 disposable repo 内真实触发 `$spec-driver-refactor` 的 dry-run/输入解析前置阶段，验证 wrapper 正文对 Codex 运行时的可执行性（而非仅可发现性）。
- **退出条件**：一次受控执行级 E2E（read-only sandbox + dry-run 路径）留证。

## FU-4：插件版本 SemVer bump（T6.5 裁决：延后至发布收口）

- **来源**：plan §6 Rollout 第 3 条 + tasks T6.5
- **裁决**：本 Feature 维持 `4.4.0` 不 bump。理由：(1) npm registry 当前仍为 4.3.0（F237 落账的"npm publish 4.4.0 最后欠账"未清），此时仓库侧 bump 4.5.0 会造成 仓库 4.5.0 / marketplace 4.4.0 / registry 4.3.0 三层版本漂移，扩大而非收敛发布债务；(2) F239（B3 worktree/local）并行在途，按"先 ship 先 push、后者 rebase"约定，版本收口应在两件合流后的发布收口轮统一做（一次 bump 覆盖两个 feature 的功能增量，一次 release:sync + npm publish 清全部欠账）。
- **退出条件**：发布收口轮改 `contracts/release-contract.yaml` → `npm run release:sync` → bump 至 4.5.0（F238 新增 skill 覆盖 + sidecar 能力 + F239 增量共同构成 minor 语义）→ npm publish。
