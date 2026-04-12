# 修复规划 — Feature 112: Fix 104 Hook Robustness

## 修复范围

仅涉及 3 个源文件，最小化变更：

| 文件 | 变更摘要 |
|------|----------|
| `src/hooks/git-hook-installer.ts` | 新增 `resolveHookPath()` 函数；`installGitHook`/`removeGitHook` 用新函数获取 hook 路径 |
| `src/hooks/hook-installer.ts` | `Array.isArray` 保护；`grep -P` → `node -e`；死路径修正 |
| `src/cli/commands/install.ts` | `process.cwd()` → git root 检测（含 fallback） |

## 变更设计

### 1. `git-hook-installer.ts`：`resolveHookPath()`

```typescript
import { statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

function resolveHookPath(projectRoot: string): string {
  const gitPath = join(projectRoot, '.git');
  let stat;
  try {
    stat = statSync(gitPath);
  } catch {
    throw new Error('[spectra] .git directory not found. Is this a git repository?');
  }

  if (stat.isDirectory()) {
    // 普通 git 仓库
    return join(gitPath, 'hooks', 'post-commit');
  }

  if (stat.isFile()) {
    // git worktree：.git 是包含 "gitdir: <path>" 的文件
    const content = readFileSync(gitPath, 'utf-8').trim();
    const match = /^gitdir:\s*(.+)$/.exec(content);
    if (!match) {
      throw new Error('[spectra] Cannot parse .git file. Is this a valid git worktree?');
    }
    const gitDir = resolve(dirname(gitPath), match[1]);
    return join(gitDir, 'hooks', 'post-commit');
  }

  throw new Error('[spectra] .git directory not found. Is this a git repository?');
}
```

`installGitHook` 和 `removeGitHook` 都改为调用 `resolveHookPath(projectRoot)` 获取路径，并移除原有的 `existsSync(gitDir)` 检查（由 `resolveHookPath` 统一处理）。

### 2. `hook-installer.ts`：Array.isArray 保护

在 `installClaudeHook` 和 `removeClaudeHook` 中：

```typescript
// 之前
const existingHooks = settings.hooks?.PreToolUse ?? [];

// 之后
const raw = settings.hooks?.PreToolUse;
const existingHooks: HookConfig[] = Array.isArray(raw) ? raw : [];
```

### 3. `hook-installer.ts`：grep -P → node -e

```typescript
// 替换 generateContextScript() 中的 grep -P 段落
// 之前（macOS 不兼容）：
COMMUNITY_COUNT=$(grep -oP '(?<=\\| 社区 \\| )\\d+' "$REPORT_FILE" 2>/dev/null | head -1 || echo "N/A")

// 之后（纯 node）：
COMMUNITY_COUNT=$(node -e "
  try {
    const t = require('fs').readFileSync('$REPORT_FILE','utf8');
    const m = t.match(/\\| 社区 \\| (\\d+)/);
    console.log(m ? m[1] : 'N/A');
  } catch(e) { console.log('N/A'); }
" 2>/dev/null || echo "N/A")
```

### 4. `hook-installer.ts`：修正死路径

```
之前: echo "→ Read specs/project/graph-report.md before searching raw files."
之后: echo "→ Read _meta/GRAPH_REPORT.md for the full knowledge graph report."
```

### 5. `git-hook-installer.ts`：修正死命令

```
之前: echo "[spectra] Docs changed. Run 'spectra batch --update' to refresh."
之后: echo "[spectra] Docs changed. Run 'spectra graph' to refresh the knowledge graph."
```

### 6. `install.ts`：git root 检测

```typescript
import { execSync } from 'node:child_process';

function detectProjectRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      cwd: process.cwd(),
    }).trim();
  } catch {
    // 非 git 仓库时 fallback 到 cwd（installGitHook 会单独校验 .git）
    return process.cwd();
  }
}

export function runInstall(command: CLICommand): void {
  const projectRoot = detectProjectRoot();
  // ... 其余不变
}
```

## 回归风险评估

| 变更 | 回归风险 | 说明 |
|------|----------|------|
| `resolveHookPath()` | 低 | 现有测试创建 `.git/` 目录，走 `isDirectory()` 分支，行为不变 |
| `Array.isArray` 保护 | 极低 | 仅影响畸形输入场景 |
| `grep -P` → `node -e` | 低 | 功能等价，更健壮 |
| 死路径/命令修正 | 无 | 纯文字修改 |
| `detectProjectRoot()` | 极低 | 有 fallback，非 git 仓库保持原行为 |
