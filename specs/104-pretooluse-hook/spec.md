---
feature_id: "104"
title: "PreToolUse Hook 注入 + Post-commit Hook"
status: draft
priority: P3
milestone: M-100 Spectra Evolution Phase 3
target_version: v3.3.0
depends_on:
  - "101-graph-json"
  - "102-community-analysis"
created: "2026-04-12"
---

# Feature 104: PreToolUse Hook 注入 + Post-commit Hook

## 概述

本 Feature 实现两类自动化 hook 的安装与卸载能力：

1. **Claude Code PreToolUse Hook**：当 Claude Code 调用 `Glob` 或 `Grep` 工具前，自动读取本地 `_meta/graph.json` 并将架构摘要（节点数、社区数、God Node 列表）注入到 Claude 的上下文中，使 Claude 在搜索代码前先获得全局架构视图，降低无效搜索和幻觉风险。

2. **Git Post-commit Hook**：每次 `git commit` 后，自动检测变化文件类型，对代码变化触发增量图谱更新（`spectra graph`），对文档变化打印提示，保持 `_meta/graph.json` 与代码库同步，无需人工干预。

两类 hook 通过新的 CLI 子命令 `spectra install` 统一管理，与现有 `spectra init`（skill 安装）职责明确分离。

---

## User Stories

### User Story 1 — Claude Code 搜索前自动获得架构摘要（Priority: P1）

作为使用 spectra 的开发者，我希望 Claude Code 在调用 `Glob`/`Grep` 搜索代码之前，能自动看到当前项目的架构摘要（节点总数、社区数、关键 God Node），而无需我每次手动提供背景，从而让 Claude 做出更精准的文件搜索决策。

**Why this priority**：这是本 Feature 的核心价值主张。没有这条 story，整个 hook 注入体系对用户毫无意义。此外本 story 是后续 git hook story 的前提（graph.json 需要存在且被维护）。

**Independent Test**：执行 `spectra install`，验证 `.claude/settings.json` 中存在 `PreToolUse` hook 条目且命令路径正确；手动执行生成的 `_meta/hooks/spectra-context.sh` 脚本，验证输出格式符合规范。

**Acceptance Scenarios**：

1. **Given** 项目根目录存在 `_meta/graph.json`，**When** 用户运行 `spectra install`，**Then** `.claude/settings.json` 中新增 `hooks.PreToolUse` 条目，matcher 为 `Glob|Grep`，command 指向 `_meta/hooks/spectra-context.sh`；同时生成该脚本文件，脚本头部包含 `set -euo pipefail`。

2. **Given** hook 已安装（幂等场景），**When** 用户再次运行 `spectra install`，**Then** `.claude/settings.json` 中不产生重复的 spectra hook 条目，命令退出码为 0，打印 `[spectra] hook already installed, skipping.`。

3. **Given** `_meta/graph.json` 存在且包含节点和社区数据，**When** `spectra-context.sh` 被执行，**Then** stdout 输出三行格式：`spectra: Knowledge graph loaded ({N} nodes · {K} communities)`、`God nodes: {name}({degree}), ...`、`→ Read specs/project/graph-report.md before searching raw files.`。

4. **Given** `_meta/graph.json` 不存在，**When** `spectra-context.sh` 被执行，**Then** 脚本以 exit 0 静默退出，stdout 无任何输出，不阻塞 Claude 的工具调用。

5. **Given** `.claude/settings.json` 不存在，**When** 用户运行 `spectra install`，**Then** 系统创建文件并写入最小合法 JSON（仅含 hooks 字段），而不是报错退出。

---

### User Story 2 — Git commit 后自动增量更新图谱（Priority: P2）

作为使用 spectra 的开发者，我希望每次 `git commit` 后，图谱（`_meta/graph.json`）能自动与代码变化保持同步，同时对文档变化给出提示，而不需要我手动运行 `spectra graph`。

**Why this priority**：图谱自动维护是用户体验的重要组成部分，但不是 Claude Code 上下文注入的必要前提——即使没有 post-commit hook，用户仍可手动更新图谱，因此优先级低于 P1。

**Independent Test**：执行 `spectra install --git`，验证 `.git/hooks/post-commit` 中存在 spectra 标记段落；在临时 repo 中提交含代码文件的 commit，验证 `spectra graph` 被触发（可通过检查 graph.json 的 mtime 变化或测试脚本输出）。

**Acceptance Scenarios**：

1. **Given** `.git/hooks/post-commit` 不存在，**When** 用户运行 `spectra install --git`，**Then** 创建可执行的 post-commit 文件，包含 `#!/bin/sh` 头、`# --- spectra begin ---` 开始标记、spectra 逻辑、`# --- spectra end ---` 结束标记。

2. **Given** `.git/hooks/post-commit` 已存在且包含非 spectra 内容，**When** 用户运行 `spectra install --git`，**Then** 追加 spectra 段落到文件末尾，原有内容完整保留，文件保持可执行权限。

3. **Given** post-commit hook 已安装，**When** 用户 commit 仅包含 `.ts`/`.js` 代码文件，**Then** hook 调用 `spectra graph` 更新 `_meta/graph.json`，整体执行时间 < 3 秒。

4. **Given** post-commit hook 已安装，**When** 用户 commit 仅包含 `.md`/`.txt` 文档文件，**Then** hook 打印提示 `[spectra] Docs changed. Run 'spectra batch --update' to refresh.`，不调用 `spectra graph`。

5. **Given** hook 已安装（幂等场景），**When** 用户再次运行 `spectra install --git`，**Then** 不产生重复的 spectra 段落，命令退出码为 0。

---

### User Story 3 — 卸载已安装的 Hooks（Priority: P2）

作为使用 spectra 的开发者，我希望能通过 `spectra install --remove` 干净地移除 spectra 注入的 hooks，同时不影响项目中已有的其他 hooks 配置。

**Why this priority**：可逆性是工具安全性的基本要求。缺少卸载能力会让用户担忧"安装后无法清除"，阻碍采用。优先级与安装功能同阶但略低，因为先有安装才需卸载。

**Independent Test**：先执行 `spectra install && spectra install --git`，验证安装成功；再执行 `spectra install --remove`，验证 settings.json 中不再有 spectra hook 条目，但文件本身和其他字段完整保留；再执行 `spectra install --remove --git`，验证 post-commit 中 spectra 段落被清除，非 spectra 内容保留。

**Acceptance Scenarios**：

1. **Given** spectra hook 已在 `.claude/settings.json` 中注册，**When** 用户运行 `spectra install --remove`，**Then** 移除 `hooks.PreToolUse` 数组中的 spectra 条目，其他 hooks 条目和非 hooks 字段（如 `enabledPlugins`）完整保留。

2. **Given** spectra 段落已在 `.git/hooks/post-commit` 中，**When** 用户运行 `spectra install --remove --git`，**Then** 移除 `# --- spectra begin ---` 至 `# --- spectra end ---` 之间的全部内容（含标记行），文件其余内容保留，post-commit 文件保持可执行权限。

3. **Given** spectra hook 未安装，**When** 用户运行 `spectra install --remove`，**Then** 命令以 exit 0 退出，打印 `[spectra] hook not found, nothing to remove.`，不修改任何文件。

---

### Edge Cases

- **settings.json 格式错误**：文件存在但不是合法 JSON → 终止安装，打印错误信息，不覆盖损坏文件，建议用户手动修复。关联 FR-003。
- **graph.json 路径不一致**：`spectra graph` 写入路径与 hook 脚本读取路径不同（如 `specs/_meta/` vs `_meta/`）→ hook 脚本静默跳过（graph.json 不存在分支），不报错。关联 FR-007。
- **`.claude/` 目录不存在**：用户在从未运行过 `spectra init` 的项目执行 `spectra install` → 递归创建目录后写入 settings.json。关联 FR-002。
- **`.git/` 目录不存在**：非 git 仓库中执行 `spectra install --git` → 打印错误 `[spectra] .git directory not found. Is this a git repository?`，以非零退出码退出。关联 FR-010。
- **并发写入 settings.json**：两个进程同时安装 → `writeAtomicJson`（write-to-tmp-then-rename）保证写入原子性，后写者 wins，内容合法。关联 FR-004。
- **`_meta/hooks/` 目录不存在**：首次安装 hook 脚本 → 自动创建目录，写入 shell 脚本后设置可执行权限。关联 FR-005。
- **God Node 数据量极大**：注入输出超长 → hook 脚本截取前 5 个 God Node，后续用 `...` 省略。关联 FR-008。

---

## 功能需求

### FR-001：`spectra install` CLI 子命令注册 [必须]

系统 MUST 提供 `spectra install [--git] [--remove]` 子命令。

- 无 flag：仅安装/卸载 Claude Code PreToolUse hook
- `--git`：同时操作 git post-commit hook
- `--remove`：切换为卸载模式

命令注册遵循现有三步走模式：`CLICommand` interface 扩展、`parseArgs()` 分支、`src/cli/index.ts` switch 分支。

---

### FR-002：settings.json 安全读写 [必须]

系统 MUST 在写入 `.claude/settings.json` 前：

1. 若 `.claude/` 目录不存在，递归创建
2. 若文件存在，创建备份（`.claude/settings.json.bak`）
3. 使用深度合并策略：将 spectra hook 追加到 `hooks.PreToolUse` 数组，保留已有条目
4. 使用 `writeAtomicJson`（write-to-tmp-then-rename）原子写入
5. 操作范围限定为项目级 `.claude/settings.json`，绝不修改用户级 `~/.claude/settings.json`

---

### FR-003：settings.json JSON 格式校验 [必须]

系统 MUST 在读取 settings.json 前验证其是否为合法 JSON。若文件存在但内容无效，系统 MUST 终止操作并以非零退出码退出，打印可读错误信息，不修改原文件。

---

### FR-004：PreToolUse hook 幂等安装 [必须]

系统 MUST 保证 `spectra install` 幂等执行：重复运行不在 `hooks.PreToolUse` 数组中产生重复的 spectra 条目。通过检查 `command` 字段是否已包含 `spectra-context.sh` 来判断是否已安装。

---

### FR-005：hook 脚本文件生成 [必须]

系统 MUST 在 `_meta/hooks/spectra-context.sh` 生成可执行 shell 脚本，脚本满足：

- 首行 `#!/bin/bash`，第二行 `set -euo pipefail`
- 检测 `_meta/graph.json` 存在性；不存在时 `exit 0`（静默跳过）
- 存在时读取 `nodeCount`、社区数（`communities` 字段长度）、God Node 列表（按 degree 排序取前 5）
- stdout 输出三行规范格式（见需求描述中的注入格式）
- 任何异常均以 `exit 0` 退出，不阻塞 Claude 工具调用

---

### FR-006：注入输出格式规范 [必须]

hook 脚本 stdout 输出 MUST 严格遵循以下三行格式：

```
spectra: Knowledge graph loaded ({N} nodes · {K} communities)
God nodes: {name}({degree}), {name}({degree}), ...
→ Read specs/project/graph-report.md before searching raw files.
```

其中 God nodes 列表取 degree 最高的前 5 个节点，超出部分省略。N 为 `graph.nodeCount`，K 为社区数量。

---

### FR-007：graph.json 静默降级 [必须]

当 `_meta/graph.json` 不存在或读取失败时，hook 脚本 MUST 以 exit 0 静默退出，不向 stdout/stderr 输出任何内容，不阻塞 Claude Code 的工具调用流程。

---

### FR-008：God Node 输出截断 [应该]

hook 脚本 SHOULD 将 God Node 列表截取为 degree 最高的前 5 个，以控制注入上下文的长度，避免超出 Claude Code additionalContext 的合理范围。`[AUTO-RESOLVED: 取 5 个兼顾信息量与上下文长度]`

---

### FR-009：post-commit hook 安装 [必须]

系统 MUST 支持 `spectra install --git`，在 `.git/hooks/post-commit` 中以追加模式安装 spectra 逻辑段落：

- 段落以 `# --- spectra begin ---` 开始、`# --- spectra end ---` 结束
- 若文件不存在，创建文件并写入 `#!/bin/sh` 头部
- 安装后确保文件具有可执行权限（`chmod +x`）
- 幂等：检测标记段落是否已存在，已存在则跳过

---

### FR-010：post-commit hook 变化文件分类处理 [必须]

post-commit hook 脚本 MUST 通过 `git diff HEAD~1 HEAD --name-only` 获取变化文件列表，并按类型分类处理：

- 代码文件（`.ts`、`.js`、`.tsx`、`.jsx`、`.py`、`.go` 等）→ 调用 `spectra graph`
- 文档文件（`.md`、`.txt`、`.rst` 等）→ 打印 `[spectra] Docs changed. Run 'spectra batch --update' to refresh.`
- 两类文件同时变化 → 优先触发图谱更新，同时打印文档提示

执行时间 MUST < 3 秒（不含 `spectra graph` 本身的实际运行时间，hook 应异步或通过超时控制）。`[CLARIFIED: post-commit hook 采用后台运行模式（nohup spectra graph > /dev/null 2>&1 &），理由：git post-commit hook 是同步阻塞的，若 spectra graph 耗时数秒将直接阻塞用户 git 工作流；后台运行使 hook 本身 < 100ms 完成，同时设置 3 秒超时保护（通过包装脚本实现）以防僵尸进程积累。]`

---

### FR-011：卸载 PreToolUse hook [必须]

系统 MUST 支持 `spectra install --remove`，从 `.claude/settings.json` 的 `hooks.PreToolUse` 数组中移除 spectra 条目（通过 `command` 字段包含 `spectra-context.sh` 来识别），保留其他非 spectra 条目，原子写入。

---

### FR-012：卸载 git post-commit hook [必须]

系统 MUST 支持 `spectra install --remove --git`，从 `.git/hooks/post-commit` 中移除 `# --- spectra begin ---` 至 `# --- spectra end ---` 之间的全部内容（含标记行），保留文件其余内容，维持文件可执行权限。若文件不存在或标记段落不存在，静默跳过并以 exit 0 退出。

---

### FR-013：非 git 仓库保护 [必须]

执行 `spectra install --git` 时，系统 MUST 检测当前目录是否存在 `.git/` 目录。若不存在，打印错误信息并以非零退出码退出，不创建 `.git/` 目录。

---

### FR-014：测试覆盖 [必须]

新增代码 MUST 包含以下测试：

- `tests/unit/hook-installer.test.ts`：settings.json 读写、深度合并、幂等性
- `tests/unit/git-hook-installer.test.ts`：post-commit 追加、幂等、卸载
- `tests/unit/hook-script-generator.test.ts`：脚本内容格式验证
- `tests/integration/install-e2e.test.ts`：安装 → 验证存在 → 卸载 → 验证清除

所有测试使用 `mkdtempSync` 构建临时文件系统，`beforeEach/afterEach` 清理，不使用 mock 模块。

---

## 非功能需求

### NFR-001：幂等性

所有安装操作 MUST 幂等：重复执行不产生副作用（重复条目、多次备份覆盖）。

### NFR-002：性能

`spectra install` 命令本身（不含 `spectra graph` 执行时间）MUST 在 500ms 内完成。post-commit hook 整体执行时间 MUST < 3 秒（含 `spectra graph` 的情形下允许松弛，但 hook 本身逻辑 < 100ms）。

### NFR-003：安全性

系统 MUST 只操作项目级配置，绝不修改 `~/.claude/settings.json` 或任何 user 级文件。

### NFR-004：可维护性

新增模块遵循项目现有代码规范：TypeScript strict 模式、Zod schema 验证输入数据、中文注释、中文 commit message。

### NFR-005：零外部依赖

hook 脚本为纯 shell 实现（bash），`src/hooks/` 模块不引入新的 npm 运行时依赖。

---

## 数据模型 / 类型定义

### HookConfig（settings.json 中的 hook 条目结构）

```typescript
// Claude Code settings.json 中 PreToolUse hook 的单条配置
interface HookConfig {
  matcher: string;   // 工具名匹配模式，如 "Glob|Grep"
  command: string;   // 执行命令，如 "bash _meta/hooks/spectra-context.sh"
}

// settings.json 中 hooks 字段的完整结构
interface SettingsHooks {
  PreToolUse?: HookConfig[];
  PostToolUse?: HookConfig[];  // 预留，本 Feature 不使用
}

// settings.json 顶层结构（仅含本 Feature 关心的字段）
interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  hooks?: SettingsHooks;
  [key: string]: unknown;  // 保留其他未知字段
}
```

### InstallOptions（CLI 参数解析结果）

```typescript
interface InstallOptions {
  git: boolean;     // 是否同时操作 git hook
  remove: boolean;  // 是否卸载
}
```

### GodNodeSummary（hook 脚本注入内容来源）

hook 脚本从 `_meta/graph.json` 读取以下信息（通过 shell + `jq` 或 node 脚本解析）：

- `graph.nodeCount`：节点总数 N
- 社区数量 K：`[CLARIFIED: GraphJSON 类型中不存在直接的 communityCount 字段（Feature 101 输出合同未包含），社区检测（Feature 102）结果仅保存在 _meta/GRAPH_REPORT.md 中。hook 脚本采用双重策略：优先用 grep 从 _meta/GRAPH_REPORT.md 中提取社区行（"| 社区 | {N} |"），文件不存在时 fallback 为字符串 "N/A"，不读取 graph.json nodes 数组统计（shell 中 jq 统计 unique communityId 性能差且字段不保证存在）。]`
- God Node 列表：degree 最高的节点，需要 `id/label`、`degree` 字段

---

## 与现有系统的接口

| 依赖方 | 路径 | 使用方式 |
|--------|------|----------|
| `GraphJSON` 类型 | `src/panoramic/graph/graph-types.ts` | hook 脚本读取 graph.json 的类型约束（TypeScript 侧） |
| `writeAtomicJson` | `src/utils/atomic-write.ts` | settings.json 原子写入 |
| `parseArgs` | `src/cli/utils/parse-args.ts` | 注册 `install` 子命令及 `--git`/`--remove` flag |
| `printError` | `src/cli/utils/error-handler.ts` | 错误输出统一格式 |
| `spectra graph` CLI | `src/cli/commands/graph.ts` | post-commit hook 调用（shell 子进程，后台运行） |
| Feature 102 God Node 数据 | `src/panoramic/community/god-node-analyzer.ts` | hook 脚本注入 God Node 信息（shell 侧通过读 graph.json 获取） |
| `_meta/GRAPH_REPORT.md` | Feature 102 输出产物 | hook 脚本读取社区数量（grep 提取） |

### settings.json hook 注入目标格式

```json
{
  "enabledPlugins": { "...": true },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Glob|Grep", "command": "bash _meta/hooks/spectra-context.sh" }
    ]
  }
}
```

---

## 约束与风险

### 约束

- **只写项目级配置**：任何写入操作的目标路径必须在项目根目录内
- **备份策略**：写入 settings.json 前必须创建 `.bak` 备份（Last-Write-Wins，每次覆盖上次备份）
- **hook 脚本防御性设计**：`set -euo pipefail` + 任何分支均 exit 0，确保不阻塞 Claude
- **post-commit 标记段落**：段落边界必须使用精确标记字符串，卸载时按字符串匹配删除
- **语义区分**：`spectra init` = skill 安装；`spectra install` = hook 安装；help 文本必须明确说明区别

### 风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| Claude Code hooks JSON schema 变更 | 低 | 高 | 调研中已确认结构；Zod 验证写入内容格式 |
| graph.json 路径不一致（specs/_meta/ vs _meta/）| 中 | 中 | hook 脚本 graph.json 不存在时静默跳过（FR-007） |
| post-commit hook 超时阻塞 git 工作流 | 中 | 高 | 采用后台运行（nohup ... &）+ 3 秒超时保护（FR-010 已澄清） |
| settings.json 并发写入 | 低 | 中 | `writeAtomicJson` 原子写入（FR-002） |
| `init` / `install` 命令语义混淆 | 中 | 低 | help 文本区分，文档说明 |

---

## 成功标准

### SC-001：安装正确性
运行 `spectra install` 后，`.claude/settings.json` 中存在且仅存在一条 spectra PreToolUse hook 条目，`_meta/hooks/spectra-context.sh` 文件存在且可执行。

### SC-002：上下文注入有效性
在含有 `_meta/graph.json` 的项目中执行 `spectra-context.sh`，stdout 输出符合三行规范格式，`{N}` 和 `{K}` 数值与 graph.json 实际数据一致。

### SC-003：静默降级
在不含 `_meta/graph.json` 的项目中执行 `spectra-context.sh`，脚本以 exit 0 退出，stdout/stderr 无任何输出。

### SC-004：幂等性
连续执行 `spectra install` 三次，`.claude/settings.json` 中 spectra hook 条目数量始终为 1。

### SC-005：git hook 功能性
运行 `spectra install --git` 后，在含代码文件变化的 commit 中，`spectra graph` 被自动触发，`_meta/graph.json` 的修改时间更新。

### SC-006：卸载完整性
先执行 `spectra install && spectra install --git`，再执行 `spectra install --remove && spectra install --remove --git`，验证 settings.json 中无 spectra 条目、post-commit 中无 spectra 段落，且 settings.json 其他字段（如 `enabledPlugins`）完整保留。

### SC-007：测试通过率
`npx vitest run` 所有单元测试和集成测试零失败，`npm run build` 类型检查零错误。

---

## 复杂度评估（供 GATE_DESIGN 审查）

| 维度 | 数值 / 状态 |
|------|-------------|
| 组件总数 | 5（`hook-installer.ts`、`git-hook-installer.ts`、`hook-script-generator.ts`、`hook-types.ts`、`install.ts`） |
| 接口数量 | 3（`HookConfig`、`InstallOptions`、`ClaudeSettings`） |
| 依赖新引入数 | 0（纯 JS/TS 实现，无新 npm 依赖） |
| 跨模块耦合 | 是（修改 `src/cli/index.ts`、`parseArgs`、`CLICommand` interface，共 3 处） |
| 复杂度信号 | 无（无递归、无状态机、无并发控制、无数据迁移） |
| **总体复杂度** | **MEDIUM**（组件 = 5，接口 < 4，有跨模块耦合，但无复杂度信号） |

**GATE_DESIGN 建议**：复杂度为 MEDIUM，跨模块耦合点明确（三处 CLI 注册），建议在 plan 阶段明确 CLI 注册的修改顺序，避免类型漂移。无需人工特殊审查，可直接进入 plan 阶段。

---

## Clarifications

### Session 2026-04-12

| # | 问题 | 自动选择 | 理由 |
|---|------|---------|------|
| 1 | post-commit hook 是否后台运行 `spectra graph` | 后台运行（`nohup spectra graph > /dev/null 2>&1 &`） | git post-commit 是同步阻塞的，若同步运行 spectra graph 将直接阻塞用户 git 工作流数秒；后台运行使 hook 本身 < 100ms 完成，符合 NFR-002 约束 |
| 2 | `_meta/graph.json` 中社区数量的具体字段路径 | 从 `_meta/GRAPH_REPORT.md` 用 grep 提取，fallback 为 "N/A" | 经查 `src/panoramic/graph/graph-types.ts`，GraphJSON 顶层 `graph` 对象不含 `communityCount` 字段；社区检测（Feature 102）结果仅写入 Markdown 报告，不回写 graph.json；从报告文件 grep 是最可靠的获取路径 |
