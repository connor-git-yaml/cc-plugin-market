/**
 * git post-commit hook 安装/卸载逻辑
 * 在 .git/hooks/post-commit 中追加/删除 spectra 标记段落
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/** spectra 段落开始标记 */
const SEGMENT_BEGIN = '# --- spectra begin ---';
/** spectra 段落结束标记 */
const SEGMENT_END = '# --- spectra end ---';

/**
 * 生成 post-commit hook spectra 段落内容
 * - 使用 POSIX sh 语法（兼容性最好）
 * - nohup 后台运行，不阻塞 git 工作流
 * - 区分代码文件和文档文件分别处理
 */
export function generatePostCommitSegment(): string {
  return `${SEGMENT_BEGIN}
_spectra_changed=$(git diff HEAD~1 HEAD --name-only 2>/dev/null || true)

_spectra_has_code=$(echo "$_spectra_changed" | grep -E '\\.(ts|js|tsx|jsx|py|go|rs|java|rb|php|cs)$' | wc -l | tr -d ' ')
_spectra_has_docs=$(echo "$_spectra_changed" | grep -E '\\.(md|txt|rst|adoc)$' | wc -l | tr -d ' ')

if [ "$_spectra_has_code" -gt 0 ]; then
  # 后台运行 + 超时保护，防止僵尸进程积累（FR-010 CLARIFIED）
  ( spectra graph & _pid=$!; sleep 30 && kill $_pid 2>/dev/null ) > /dev/null 2>&1 &
fi

if [ "$_spectra_has_docs" -gt 0 ]; then
  echo "[spectra] Docs changed. Run 'spectra graph' to refresh the knowledge graph."
fi
${SEGMENT_END}
`;
}

/**
 * 解析 post-commit hook 文件的真实路径
 * - 普通仓库：.git 是目录 → .git/hooks/post-commit
 * - worktree：.git 是文件（含 "gitdir: <path>"） → 解析 gitdir 并定位 hooks/post-commit
 * @param projectRoot - 项目根目录绝对路径
 * @throws 当 .git 不存在或格式不可识别时
 */
export function resolveHookPath(projectRoot: string): string {
  const gitPath = join(projectRoot, '.git');

  let stat;
  try {
    stat = statSync(gitPath);
  } catch {
    throw new Error('[spectra] .git directory not found. Is this a git repository?');
  }

  if (stat.isDirectory()) {
    return join(gitPath, 'hooks', 'post-commit');
  }

  if (stat.isFile()) {
    // git worktree：.git 是包含 "gitdir: <path>" 的文件
    const content = readFileSync(gitPath, 'utf-8').trim();
    const match = /^gitdir:\s*(.+)$/.exec(content);
    if (!match) {
      throw new Error('[spectra] Cannot parse .git file. Is this a valid git worktree?');
    }
    const gitDir = resolve(dirname(gitPath), match[1]!);
    return join(gitDir, 'hooks', 'post-commit');
  }

  throw new Error('[spectra] .git directory not found. Is this a git repository?');
}

/**
 * 安装 git post-commit hook 段落
 * - 幂等：段落已存在时打印提示并返回
 * - 若 post-commit 不存在则创建并写入 #!/bin/sh 头部
 * - 支持普通仓库和 git worktree
 * @param projectRoot - 项目根目录绝对路径
 * @throws 当 .git 不存在时（FR-013）
 */
export function installGitHook(projectRoot: string): void {
  const hookPath = resolveHookPath(projectRoot);

  // 确保 hooks 目录存在（worktree 场景下可能不存在）
  mkdirSync(dirname(hookPath), { recursive: true });

  // 若 post-commit 不存在，创建含 #!/bin/sh 头部的文件
  let existing = '';
  if (existsSync(hookPath)) {
    existing = readFileSync(hookPath, 'utf-8');
  } else {
    existing = '#!/bin/sh\n';
  }

  // 幂等判定：已含开始标记则跳过
  if (existing.includes(SEGMENT_BEGIN)) {
    console.log('[spectra] git hook already installed, skipping.');
    return;
  }

  // 追加 spectra 段落（确保前有空行分隔）
  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const content = needsNewline
    ? `${existing}\n${generatePostCommitSegment()}`
    : `${existing}${generatePostCommitSegment()}`;

  writeFileSync(hookPath, content, 'utf-8');
  chmodSync(hookPath, 0o755);
  console.log('[spectra] git post-commit hook installed.');
}

/**
 * 卸载 git post-commit hook 段落
 * - 幂等：段落不存在时静默退出
 * - 正则删除 spectra 标记段落（含标记行），保留其他内容
 * - 保持文件可执行权限
 * @param projectRoot - 项目根目录绝对路径
 */
export function removeGitHook(projectRoot: string): void {
  let hookPath: string;
  try {
    hookPath = resolveHookPath(projectRoot);
  } catch {
    // .git 不存在 → 无需卸载
    return;
  }

  if (!existsSync(hookPath)) {
    return;
  }

  const content = readFileSync(hookPath, 'utf-8');

  if (!content.includes(SEGMENT_BEGIN)) {
    return;
  }

  // 正则删除从开始标记到结束标记（含标记行）的全部内容
  // 使用非贪婪匹配，支持多行，标记行之间允许任意字符
  const pattern = new RegExp(
    `${escapeRegex(SEGMENT_BEGIN)}[\\s\\S]*?${escapeRegex(SEGMENT_END)}\\n?`,
    'g',
  );
  const updated = content.replace(pattern, '');

  writeFileSync(hookPath, updated, 'utf-8');
  // 保持可执行权限
  chmodSync(hookPath, 0o755);
  console.log('[spectra] git post-commit hook removed.');
}

/** 转义正则特殊字符 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
