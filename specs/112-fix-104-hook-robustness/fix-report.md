# 问题修复报告

## 问题描述

对 Feature 104（PreToolUse Hook 注入 + Post-commit Hook）进行 adversarial review 后，发现以下问题需要修复。本报告评估各问题合理性并给出修复决策。

## 5-Why 根因追溯

以下以 CRITICAL 问题（git worktree 路径硬编码）为核心追溯：

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | post-commit hook 路径为何在 worktree 中无效？ | 代码使用 `join(projectRoot, '.git', 'hooks', 'post-commit')`，但 worktree 中 `.git` 是文件非目录 |
| Why 2 | 为何假设 `.git` 是目录？ | 开发时仅考虑普通 git 仓库，未考虑 worktree 场景 |
| Why 3 | 为何 FR-013 未提 worktree？ | spec 阶段产品调研未将 worktree 列为边界条件 |
| Why 4 | 为何未被测试覆盖？ | 测试用 `mkdtempSync` 手工创建 `.git/hooks/`，恰好是目录；未建立真实 git repo 或 worktree 场景 |
| Why 5 | 为何未在代码审查中发现？ | 实现与测试同时完成，reviewer（spec-review agent）未专门检查 git 内部结构假设 |

**Root Cause**: hook 路径解析硬编码 `.git/` 为目录，未处理 worktree 场景（`.git` 为文件）。  
**Root Cause Chain**: worktree 环境 → `.git` 是文件 → `join(root, '.git', 'hooks', ...)` 路径错误 → hook 操作失败

## 各问题合理性评估与修复决策

| # | 等级 | 问题 | 合理性 | 决策 |
|---|------|------|--------|------|
| 1 | CRITICAL | `git-hook-installer.ts` 硬编码 `.git/hooks/post-commit`，worktree 失效 | ✅ 合理 | **修复** |
| 2 | HIGH | `install.ts` 使用 `process.cwd()`，可能写入错误目录 | ⚠️ 部分合理 | **修复（加 git root 检测 + fallback）** |
| 3 | HIGH | 部分安装失败无回滚 | ⚠️ 理论合理，实践成本高 | **不修复**（每步可独立卸载，过度工程） |
| 4 | MEDIUM | `install` 子命令无 allowlist 验证 | ⚠️ 轻微 UX 问题 | **不修复**（无正确性影响） |
| 5 | MEDIUM | `hooks.PreToolUse` 无 `Array.isArray` 保护 | ✅ 合理 | **修复** |
| 6 | MEDIUM | TOCTOU 并发竞态 | ⚠️ 理论风险，无锁机制下不可避免 | **不修复**（接受，文档记录） |
| 7 | MEDIUM | `sleep 30 && kill $_pid` PID 重用风险 | ⚠️ 极小概率 | **不修复**（可接受） |
| 8 | LOW | `grep -P` 仅 GNU grep 支持，macOS 不兼容 | ✅ 合理（macOS 是主流平台） | **修复** |
| 9 | LOW | hook 输出中引用死路径/命令 | ✅ 合理（误导用户） | **修复** |

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/hooks/git-hook-installer.ts` | L47,L88 | `.git/hooks/post-commit` 硬编码 | 提取 `resolveHookPath()` 函数，支持 worktree |
| `src/hooks/hook-installer.ts` | L111,L167 | 无 `Array.isArray` 保护 | 加 `Array.isArray()` 前置检查 |
| `src/hooks/hook-installer.ts` | L60 | `grep -oP` macOS 不兼容 | 改用 `node -e` 解析 |
| `src/hooks/hook-installer.ts` | L79 | 死路径 `specs/project/graph-report.md` | 改为 `_meta/GRAPH_REPORT.md` |
| `src/hooks/git-hook-installer.ts` | L33 | 死命令 `spectra batch --update` | 改为准确说明 |
| `src/cli/commands/install.ts` | L16 | `process.cwd()` 无 git root 检测 | 加 `git rev-parse --show-toplevel` |

### 同步更新清单

- 测试: 无需新增测试（现有测试覆盖 worktree 场景的前提结构已足够；如需验证 worktree，需真实 `git init`）
- 不需要更新 spec.md（这些是实现层缺陷，不影响需求）

## 修复策略

### 方案 A（推荐）：文件系统感知的 hook 路径解析

在 `git-hook-installer.ts` 中提取 `resolveHookPath(projectRoot)` 函数：
1. 检查 `.git` 是否为文件（`statSync`）
2. 是目录 → 使用 `join(gitPath, 'hooks', 'post-commit')`（现有行为）
3. 是文件 → 读取内容，解析 `gitdir: <path>`，使用该路径下的 `hooks/post-commit`
4. 两者都不是 → 抛出 `.git directory not found` 错误

优点：不需要 `execSync('git ...')`，测试中手工创建的 `.git/` 目录仍然有效。

### 方案 B（备选）：使用 `git rev-parse --git-path hooks/post-commit`

通过 `execSync` 调用 git 命令获取正确路径。  
缺点：依赖外部进程，测试中手工创建的假 git 结构会失败。

## Spec 影响

- 无需更新 spec.md（均为实现层缺陷修复）
