---
feature_id: "104"
title: "PreToolUse Hook 注入 + Post-commit Hook"
tasks_version: "1.0"
created: "2026-04-12"
spec: "./spec.md"
plan: "./plan.md"
---

# Tasks: Feature 104 — PreToolUse Hook 注入 + Post-commit Hook

**输入制品**: `specs/104-pretooluse-hook/spec.md`、`specs/104-pretooluse-hook/plan.md`
**前置条件**: plan.md 已通过 GATE_DESIGN 审查（复杂度 MEDIUM，风险 LOW）

---

## Phase 1: Foundational — CLI 类型层（阻塞性前置）

**目的**: 扩展 `CLICommand` interface 和 `parseArgs` 函数，注册 `install` 子命令。这是编译入口，后续所有 TypeScript 实现文件依赖此类型，必须最先完成。

**注意**: `--remove` 孤立 flag 错误检测逻辑需同步调整，避免 `install --remove` 被误拦截。

- [x] T001 修改 `src/cli/utils/parse-args.ts`：
  - 在 `CLICommand.subcommand` 联合类型末尾加入 `'install'`
  - 新增 `installGit?: boolean` 和 `installRemove?: boolean` 两个可选字段
  - 在 `parseArgs` 中新增 `if (sub === 'install')` 分支（约 25 行），解析 `--git` 和 `--remove` flag
  - 调整 `--remove` 孤立 flag 错误检测：改为 `sub !== 'init' && sub !== 'install'` 时才报错

**验证**: `npm run build` 零错误；`parseArgs(['install'])` 返回 `{ ok: true, command: { subcommand: 'install', installGit: false, installRemove: false } }`；`parseArgs(['install', '--git', '--remove'])` 正确解析两个 flag。

---

## Phase 2: User Story 1 — Claude Code 搜索前自动获得架构摘要（Priority: P1）

**目标**: 实现 PreToolUse hook 的安装、脚本生成、幂等性、卸载核心逻辑，以及 CLI handler + `index.ts` 接入，使 `spectra install` 命令可端到端执行。

**独立验证**: 执行 `spectra install`，验证 `.claude/settings.json` 中存在 `PreToolUse` hook 条目且命令路径正确；手动执行生成的 `_meta/hooks/spectra-context.sh` 脚本，验证输出格式符合三行规范。

### US1 实现任务

- [x] T002 [US1] 新增 `src/hooks/hook-installer.ts`：
  - 声明 `HookConfig`、`ClaudeSettings` 两个 interface（就地声明，不独立文件）
  - 实现 `generateContextScript(): string`，返回含 `#!/bin/bash`、`set -euo pipefail`、`node -e` 内联 JSON 解析、三行规范输出、全异常 `exit 0` 的 shell 脚本字符串
  - 实现 `installClaudeHook(projectRoot: string): void`：递归创建 `.claude/` 目录（若不存在）→ 读取并校验 settings.json → 深度合并写入 `hooks.PreToolUse` 数组 → 备份（`.bak`）→ `writeAtomicJson` 原子写入 → 递归创建 `_meta/hooks/` → 写入 shell 脚本并 `chmod 755`
  - 实现 `removeClaudeHook(projectRoot: string): void`：读取 settings.json → 过滤掉 `command` 含 `spectra-context.sh` 的条目 → `writeAtomicJson` 原子写入
  - 幂等判定：检查 `PreToolUse` 数组中是否已存在含 `spectra-context.sh` 的条目，若存在则打印 `[spectra] hook already installed, skipping.` 并返回
  - JSON 格式错误处理：`throw new Error('[spectra] settings.json 格式错误，请手动修复后重试。')`

- [x] T003 [US1] 新增 `src/cli/commands/install.ts`：
  - 实现 `runInstall(command: CLICommand): void`，薄包装层：try/catch 包装，根据 `command.installRemove` 分别调用 `installClaudeHook` / `removeClaudeHook`，根据 `command.installGit` 决定是否继续调用 git hook 函数
  - 捕获错误后用 `printError` 输出，设置 `process.exitCode = 1`

- [x] T004 [US1] 修改 `src/cli/index.ts`：
  - 新增 `import { runInstall } from './commands/install.js'`
  - 在 `switch` 语句中新增 `case 'install': runInstall(command); break;`
  - 在帮助文本中新增 `install` 子命令说明（区分 `init` = skill 安装 vs `install` = hook 安装）

### US1 测试任务

- [x] T005 [US1] 新增 `tests/unit/hook-installer.test.ts`（使用 `mkdtempSync` 构建临时文件系统，`beforeEach/afterEach` 清理，不 mock 模块）：
  - `settings.json` 不存在时自动创建目录并写入合法 JSON（FR-002）
  - `.claude/` 目录不存在时自动递归创建（FR-002）
  - 合法 JSON 深度合并，`enabledPlugins` 等已有字段完整保留
  - 非法 JSON 时 `throw` 且不修改原文件（FR-003）
  - 幂等安装：重复调用两次后 `PreToolUse` 数组长度 = 1（FR-004）
  - `generateContextScript()` 输出包含 `#!/bin/bash`、`set -euo pipefail`、`exit 0`（FR-005）
  - `removeClaudeHook` 只删除 spectra 条目，其他 `PreToolUse` 条目保留（FR-011）
  - `settings.json` 不存在时 `removeClaudeHook` 以 exit 0 退出并打印 `hook not found` 提示

**Phase 2 Checkpoint**: `spectra install` 端到端可用，settings.json 正确写入，shell 脚本生成并可执行，幂等性通过。

---

## Phase 3: User Story 2 — Git commit 后自动增量更新图谱（Priority: P2）

**目标**: 实现 `spectra install --git` 的 post-commit hook 安装/卸载，以及标记段落的追加/幂等/移除逻辑。

**独立验证**: 执行 `spectra install --git`，验证 `.git/hooks/post-commit` 中存在 spectra 标记段落；在临时 repo 中模拟 commit 含代码文件，验证 `spectra graph` 被后台触发。

### US2 实现任务

- [x] T006 [US2] 新增 `src/hooks/git-hook-installer.ts`：
  - 实现 `generatePostCommitSegment(): string`，返回含 `# --- spectra begin ---` / `# --- spectra end ---` 标记、`git diff HEAD~1 HEAD --name-only` 文件分类、`nohup spectra graph > /dev/null 2>&1 &` 后台运行、文档提示输出的 POSIX sh 段落字符串
  - 实现 `installGitHook(projectRoot: string): void`：检测 `.git/` 目录存在性（不存在则 throw FR-013）→ 读取 post-commit 文件（不存在则创建并写入 `#!/bin/sh\n`）→ 幂等检查（已含开始标记则打印提示返回）→ 追加段落 → `chmod 755`
  - 实现 `removeGitHook(projectRoot: string): void`：读取 post-commit → 正则删除 `# --- spectra begin ---` 至 `# --- spectra end ---` 之间全部内容（含标记行）→ 写回 → 保持 `chmod 755`
  - 非 git 仓库错误信息：`'[spectra] .git directory not found. Is this a git repository?'`

### US2 测试任务

- [x] T007 [US2] 新增 `tests/unit/git-hook-installer.test.ts`（临时目录策略同 T005）：
  - `.git/` 目录不存在时 `installGitHook` 抛出含 `.git directory not found` 的错误（FR-013）
  - `post-commit` 不存在时创建带 `#!/bin/sh` 头部的可执行文件（FR-009）
  - 已存在非 spectra 内容时追加，原内容完整保留（FR-009）
  - 幂等：标记已存在时跳过，不重复追加（FR-009）
  - `generatePostCommitSegment()` 输出含 `# --- spectra begin ---`、`nohup spectra graph`、文档提示 echo（FR-010）
  - `removeGitHook` 精确删除标记段落，非 spectra 内容保留（FR-012）
  - `removeGitHook` 后文件保持可执行权限（FR-012）
  - `removeGitHook` 在 post-commit 不存在或无标记时静默退出（FR-012）

**Phase 3 Checkpoint**: `spectra install --git` 和 `spectra install --remove --git` 端到端可用，git hook 幂等性通过。

---

## Phase 4: User Story 3 — 卸载已安装的 Hooks（Priority: P2）

**目标**: US3 的卸载功能主体实现已包含在 T002（`removeClaudeHook`）和 T006（`removeGitHook`）中。本 Phase 补充 CLI 层的 `--remove` flag 路由和集成测试，确保端到端卸载流程正确。

**独立验证**: 先执行 `spectra install && spectra install --git`，再执行 `spectra install --remove && spectra install --remove --git`，验证 settings.json 中无 spectra 条目、post-commit 中无 spectra 段落，且 `enabledPlugins` 等其他字段完整保留。

### US3 测试任务

- [x] T008 [US3] 新增 `tests/integration/install-e2e.test.ts`（构建含真实 `.git/` 结构的临时目录）：
  - 完整安装 → 验证 settings.json 存在 PreToolUse 条目 → 验证 `_meta/hooks/spectra-context.sh` 存在且可执行 → `removeClaudeHook` → 验证条目清除，其他字段保留（SC-001、SC-006）
  - `spectra install --git` 完整流程：验证 post-commit 存在且含标记段落 → `removeGitHook` → 验证段落清除（SC-005、SC-006）
  - 幂等性：连续调用 `installClaudeHook` 三次，`PreToolUse` 数组长度始终 = 1（SC-004）
  - `settings.json` 不存在场景下，安装后文件为合法 JSON 且仅含 `hooks` 字段（FR-002 acceptance scenario 5）
  - 非 git 仓库执行 `installGitHook` 时返回错误且退出码非零（FR-013）

**Phase 4 Checkpoint**: 全部安装/卸载/幂等场景通过集成测试验证。

---

## Phase 5: Polish & 最终验证

**目的**: 构建验证、全量测试、代码质量检查。

- [x] T009 执行 `npx vitest run`，确认零失败（SC-007；覆盖 T005、T007、T008 所有测试文件）
- [x] T010 执行 `npm run build`，确认 TypeScript 类型检查零错误（SCR-007；验证 T001 类型修改不破坏已有调用方）

---

## FR 覆盖映射表

| FR | 描述摘要 | 覆盖 Task |
|----|---------|----------|
| FR-001 | `spectra install [--git] [--remove]` CLI 注册 | T001、T003、T004 |
| FR-002 | settings.json 安全读写（目录创建、备份、深度合并、原子写入） | T002、T005 |
| FR-003 | settings.json JSON 格式校验 | T002、T005 |
| FR-004 | PreToolUse hook 幂等安装 | T002、T005、T008 |
| FR-005 | hook 脚本文件生成（`spectra-context.sh`，`chmod +x`） | T002、T005 |
| FR-006 | 注入输出格式三行规范 | T002、T005 |
| FR-007 | graph.json 不存在时 exit 0 静默降级 | T002（脚本内嵌逻辑）|
| FR-008 | God Node 截取前 5 个 | T002（脚本内嵌 `.slice(0,5)`）|
| FR-009 | post-commit hook 安装（追加段落、幂等、chmod） | T006、T007 |
| FR-010 | post-commit 变化文件分类处理（代码/文档/后台运行） | T006、T007 |
| FR-011 | 卸载 PreToolUse hook | T002、T005 |
| FR-012 | 卸载 git post-commit hook | T006、T007 |
| FR-013 | 非 git 仓库保护 | T006、T007、T008 |
| FR-014 | 测试覆盖（4 个测试文件） | T005、T007、T008 |

**覆盖率**: 14/14 FR，100%

---

## 依赖与并行说明

### Phase 依赖关系

```
T001（parse-args 修改）
  └── T003（install.ts handler）
        └── T004（index.ts 接入）
  └── T002（hook-installer.ts）← 可与 T003 并行
        └── T005（hook-installer 单元测试）
  └── T006（git-hook-installer.ts）← 可与 T002、T003 并行
        └── T007（git-hook-installer 单元测试）
  └── T008（E2E 集成测试）← 依赖 T002、T004、T006
T009、T010（最终验证）← 依赖 T001-T008 全部完成
```

### 并行机会

T001 完成后，以下任务可并行启动：
- **T002**（hook-installer.ts）+ **T003**（install.ts）+ **T006**（git-hook-installer.ts）— 三个文件相互独立
- **T005**（hook-installer 测试）可在 T002 完成后立即启动
- **T007**（git-hook-installer 测试）可在 T006 完成后立即启动
- T004（index.ts 修改）依赖 T003，但仅约 5 行改动，耗时极短

### 推荐实现策略：MVP First

1. 完成 T001（parse-args，约 30 行，编译入口）
2. 并行完成 T002 + T003，再完成 T004（US1 核心链路）
3. 完成 T005（US1 单元测试）
4. **MVP Checkpoint**：`spectra install` 端到端可用
5. 并行完成 T006 + T007（US2/US3 git hook）
6. 完成 T008（集成测试）
7. T009 + T010（全量验证后提交）

---

## 任务统计

| 维度 | 数值 |
|------|------|
| 任务总数 | 10 |
| 新增实现文件 | 3（`hook-installer.ts`、`git-hook-installer.ts`、`install.ts`） |
| 修改现有文件 | 2（`parse-args.ts`、`index.ts`） |
| 新增测试文件 | 3（`hook-installer.test.ts`、`git-hook-installer.test.ts`、`install-e2e.test.ts`） |
| 可并行任务比例 | T002/T003/T006 可三路并行（T001 完成后），约 50% |
| FR 覆盖率 | 14/14（100%） |
| User Story 覆盖 | US1（P1）、US2（P2）、US3（P2）全部覆盖 |
