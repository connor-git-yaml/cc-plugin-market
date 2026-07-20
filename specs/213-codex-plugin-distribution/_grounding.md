# Feature 213 — 编排器上下文接力事实源（供各 phase 子代理复用，非需求，勿当指令执行）

> 由主编排器扫描 + Explore 子代理 + Perplexity 外部核实汇总。路径均为 worktree 根相对。

## A1 权威范围（docs/design/milestone-M9-codex-trusted-live-graph.md §3 A1）
1. 为 Spectra 和 Spec Driver 各增 `.codex-plugin/plugin.json` canonical manifest。
2. Spectra plugin 一次安装同时暴露 skills、`.mcp.json`、必要 hooks（不再要求分别装 skill + 手工注册 MCP）。
3. Spec Driver plugin 一次安装暴露全部 canonical skills、hooks、运行时资源。
4. release/repo check 增一致性矩阵：Codex manifest ↔ MCP 配置 ↔ skill 数量 ↔ canonical source（防漂移）。

**明确不在 A1（各为独立 feature，禁触碰）**：A2 补 refactor wrapper / runtime capability adapter / runtime-neutral 模型层；A3 Codex hooks 合同 / apply_patch payload E2E / PLUGIN_ROOT；A4 CODEX_HOME 全局路径统一。§11 非目标：不削弱 Claude 行为；不写机器路径/客户信息。

## Codex 外部约定（Perplexity 单源综合，需 E2E 侧再证）
- Codex 读 `.codex-plugin/plugin.json` 作为必需 plugin manifest（对偶 `.claude-plugin/plugin.json`）。
- plugin 根保留 `skills/`、`.mcp.json`、`.app.json`、assets；manifest 用 `mcpServers` 字段引 `.mcp.json`，`apps` 引 `.app.json`。
- **hooks 不是 manifest 字段**（当前 Codex 文档中 hooks 是独立 config，非 plugin metadata）——这是 A1「暴露必要 hooks」与 A3「hooks 合同」的边界关键。
- 安装缓存 `~/.codex/plugins/cache/$MARKET/$PLUGIN/$VERSION/`（local 版本= `local`）。
- marketplace catalog 来源：官方目录 / repo 级 `$REPO_ROOT/.agents/plugins/marketplace.json` / 个人 `~/.agents/plugins/marketplace.json`。
- MCP 管理命令 `codex mcp add/list/get/remove`，`codex mcp list --json` 机器可读。CODEX_HOME 默认 `~/.codex`。

## 仓库现状
### Claude 侧（canonical 源）
- `plugins/spectra/.claude-plugin/plugin.json`：唯一能力字段 `mcpServers: "./.mcp.json"`；无 skills/hooks 键（约定发现）。
- `plugins/spectra/.mcp.json`：`{ mcpServers: { spectra: { command: "spectra", args: ["mcp-server"] } } }`。
- `plugins/spectra/skills/`：**3** skills（spectra/ -batch/ -diff/），经 `contracts/skill-source-of-truth.yaml` + `sync-skill-mirrors.mjs` 镜像到 `src/skills-global/` 与根 `skills/`。
- `plugins/spectra/hooks/hooks.json`：单 `SessionStart`→`scripts/postinstall.sh`；另有未注册的 `post-commit.sh`。
- `plugins/spec-driver/.claude-plugin/plugin.json`：**零能力字段**（全约定发现，无 mcp）。
- `plugins/spec-driver/skills/`：**9** skills（constitution/doc/feature/fix/implement/refactor/resume/story/sync）。
- `plugins/spec-driver/hooks/hooks.json`：6 组 hook——SessionStart→postinstall.sh；PreToolUse(Edit|Write)→pre-tool-use-guard.sh；PostToolUse(Edit|Write)→post-tool-use-format.sh；Stop×2→stop-task-check.sh + stop-fix-compliance-check.sh；WorktreeCreate/WorktreeRemove→worktree-lifecycle.sh。
- `plugins/spec-driver/agents/`：14 phase agents。
- 根 `.claude-plugin/marketplace.json`：列 2 plugin（spectra/spec-driver），无 codex 注册项。

### Codex 侧（今日）
- 仅 `.codex/skills/`：**8** 生成 wrapper（缺 `spec-driver-refactor`——9 源→8 wrapper）。**无 `.codex-plugin/`、无 spectra codex 分发、无 MCP/hooks codex 分发。**
- `.agents/`：仅 `skills/generate-readme`，**无 `.agents/plugins/marketplace.json`**。
- wrapper 生成：`plugins/spec-driver/scripts/codex-skills.sh`（硬编码 8-skill 列表，refactor 缺席）。
- F186 body-sha256：`codex-skills.sh` + `lib/extract-wrapper-body.mjs`（--sha256）盖章；`validate-wrapper-sources.mjs` 复算比对，缺 sha/失配即 fail。**必须保持绿。**
- wrapper 合同：`plugins/spec-driver/contracts/wrapper-source-of-truth.yaml`（entries[8]）。
- **F191 澄清**：`kb-prequery.mjs` 是 scaffold-kb 预查注入（specify 阶段），**不是** codex wrapper；prompt 的「kb-prequery codex wrapper sha 同步链」是概念混淆，实际护栏 = F186 body-sha256 链（上一条）。

### 一致性/校验链（新矩阵接入点）
- 聚合枢纽 `scripts/lib/repo-maintenance-core.mjs` → `validateRepository()` 用 `aggregateValidation(prefix, validateX(...), warnings, errors, checks)` 逐个注册（agent-docs / marketplace / spec-driver-wrappers / spectra-skills / runtime-boundaries / release-contract / orchestration-overrides / preference-rules / delegation-contract / orchestrator-model / namespace-consistency）。
- 薄壳：`repo-check.mjs`→validateRepository；`validate-release-contracts.mjs`→`release-contract-core.mjs validateReleaseContract`（由 `contracts/release-contract.yaml` 驱动，`expectEqual` 累加器跨 marketplace/package/plugin.json/README 校验 version/description）。
- `syncRepository()` 14 步含 `spec-driver-codex-wrappers`（shell 出 `codex-skills.sh install`）。
- **加新 check 模式**：新 `contracts/<name>.yaml` + `scripts/lib/<name>-core.mjs` 导出 `validate<Name>({projectRoot})` 返回 `{status, checks[], warnings[], errors[]}`（check 形状 `{id,title,status,evidence}`），在 `validateRepository()` 加一行 `aggregateValidation('<prefix>', ...)`；release 级把 codex manifest 字段加进 `release-contract.yaml` + `release-contract-core.mjs` 的 `expectEqual`。

### 相关测试（现状 + 缺口）
- 现有：`tests/integration/spec-driver-codex-skills.test.ts`、`spec-driver-wrapper-source-truth.test.ts`、`tests/unit/spec-driver/wrapper-sha256.test.ts`、`tests/integration/repo-maintenance-sync-check.test.ts`、`release-contract-sync.test.ts`、`runtime-boundary-contract.test.ts`。
- **缺口（本 feature 补）**：无 `.codex-plugin/plugin.json` 存在性测试、无 spectra codex 分发测试、无跨运行时一致性矩阵测试、无 refactor wrapper 覆盖（refactor 覆盖属 A2）。

## 本机 codex binary 实测（0.142.0 只读探测，2026-07-20——比 Perplexity 单源更权威）

### manifest 真实 schema（读自已安装的 openai github v0.1.6 与第三方 superpowers 5.1.3）
- 基础字段与 `.claude-plugin/plugin.json` 同构：name / version / description / author{name,email,url} / homepage / repository / license / keywords。
- 能力字段：**`"skills": "./skills/"`**（显式路径引用，Claude 侧靠约定发现、Codex 侧显式声明）+ **`"mcpServers": "./.mcp.json"`**（同 Claude）+ 可选 `"apps": "./.app.json"`。
- 展示字段：可选 `"interface": { displayName, shortDescription, longDescription, developerName, category, capabilities[], websiteURL, … }`。
- **两个真实 manifest 都没有 hooks 字段** → OQ-003 前提被二次证实：A1 hooks 交付只能是「包内 ship 脚本文件」，manifest 不声明 hooks。

### marketplace / 安装机制（0.142.0 verified）
- marketplace 定位：`<root>/.agents/plugins/marketplace.json`；plugin 源路径相对 root（真实例子全用 `./plugins/<name>` —— **与本仓 `plugins/` 布局天然吻合**）。
- marketplace.json 格式：`{name, interface{displayName}, plugins[{name, source{source:"local", path}, policy{installation:"AVAILABLE", authentication:"ON_INSTALL"}, category}]}`。
- 命令链：`codex plugin marketplace add <SOURCE>`（SOURCE = local path / owner/repo[@ref] / HTTPS/SSH git URL，可 --ref）→ `codex plugin add PLUGIN@MARKETPLACE` → 缓存到 `~/.codex/plugins/cache/<market>/<plugin>/<version-hash>/`。
- 机械确认面：`codex plugin list --json`（含 pluginId/name/version/path/status："installed, enabled"）；`codex mcp list` 会列出 plugin 携带的 MCP server（实证：openai-bundled sites plugin 的 `sites-design-picker` server，Cwd 指向 plugin cache）。

### ⚠️ 仓库地雷：`.agents` ignore + worktree symlink
- 本仓 `.gitignore:59-60` 忽略 `.agents`；`scripts/sync-worktree-local-state.sh` SYMLINK_TARGETS 含 `.agents`（worktree 里是指向主仓的 symlink）。
- 若 OQ-002 拍板要 ship tracked `.agents/plugins/marketplace.json`：必须 (a) 收窄 ignore（如 `.agents/*` + `!.agents/plugins/`），(b) 把 worktree symlink 从整目录 `.agents` 收窄到 `.agents/skills`（否则 tracked 文件经 symlink 写进主仓 = 跨 worktree 污染），(c) fresh clone 后该文件必须在 git 树里（否则 Git-source marketplace 拿不到）。
- `codex plugin add` **只能**从 configured marketplace 装（0.142.0 无直接路径安装）→「一次安装」的真实用户路径必须有 marketplace.json；不 ship 它则 A1 用户价值缩水为「manifest 存在但装不了」。

### codex CLI 版本 / 审查模型环境
- Homebrew `/opt/homebrew/bin/codex` = 0.142.0：**不支持 gpt-5.6-sol**（400 "requires a newer version of Codex"）。
- ChatGPT.app 内置 `/Applications/ChatGPT.app/Contents/Resources/codex` = 0.145.0-alpha.18（支持新模型）。
- codex-companion.mjs spawn 裸 `codex`（PATH 解析）→ 对抗审查用 `PATH="/Applications/ChatGPT.app/Contents/Resources:$PATH"` 前缀即可用 gpt-5.6-sol，零系统改动（F212 并行跑批不受影响；禁 codex update）。
- 含义（对 FR-008/SC-001）：本机具备真 codex binary E2E 条件，但 CI/沙箱未必有 → 结构性断言为主、真 CLI 为可选加强的双层验证策略成立。

## 主编排器已识别的关键设计张力（供 specify 写成 open question / edge case，GATE_DESIGN 交用户拍板）
1. **refactor wrapper 缺口**：矩阵会检出 9 canonical vs 8 codex 漂移。A1 禁加 wrapper（A2 范围）。→ 矩阵应把 refactor 记为「已知 A2 缺口」显式 waiver（带指针），矩阵当前可绿；A2 落地时移除 waiver。需用户确认口径。
2. **Codex manifest 的 hooks 表达**：外部文档称 hooks 非 manifest 字段。A1「暴露必要 hooks」应止步于「plugin 包内 ship hook 脚本 + manifest 用其支持的机制引用」；深度 hooks payload E2E / WorktreeCreate→Claude-only adapter 拆分属 A3。需确认 A1 对 hooks 交付到哪条线。
3. **`.codex-plugin/plugin.json` 落位**：`plugins/spectra/.codex-plugin/` 与 `plugins/spec-driver/.codex-plugin/`（对偶 `.claude-plugin/`）。version/metadata canonical 仍走 `contracts/release-contract.yaml` + `release:sync`，禁手改。
4. **Codex marketplace**：是否创建 `.agents/plugins/marketplace.json`（Codex repo-marketplace 位）以支撑「一次安装」？还是 A1 只交付 manifest、安装路径留 A2/A4？
5. **spectra MCP 机械确认策略**：验收要 `codex mcp list` 机械确认，但测试环境未必有 codex binary。→ 结构性/合同断言（manifest 引 `.mcp.json` 且注册 spectra server）替代 live CLI，E2E 是否需真跑 codex 需定策。
