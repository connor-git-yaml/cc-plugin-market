/**
 * Claude Code PreToolUse hook 安装/卸载核心逻辑
 * 包含：HookConfig/ClaudeSettings 类型定义、shell 脚本生成、幂等安装/卸载
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomicJson } from '../utils/atomic-write.js';

/** settings.json 中 hook 条目结构 */
export interface HookConfig {
  matcher: string;
  command: string;
}

/** settings.json 顶层结构（保留未知字段） */
export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
  };
  [key: string]: unknown;
}

/** spectra-context.sh 的 command 标识符（用于幂等判定和过滤） */
const HOOK_COMMAND_MARKER = 'spectra-context.sh';

/** PreToolUse hook 条目定义 */
const HOOK_ENTRY: HookConfig = {
  matcher: 'Glob|Grep',
  command: 'bash _meta/hooks/spectra-context.sh',
};

/**
 * 生成 spectra-context.sh 脚本内容
 * - 使用 node -e 内联 JSON 解析，避免依赖 jq
 * - 任何异常均 exit 0，不阻塞 Claude Code 工具调用
 */
export function generateContextScript(): string {
  return `#!/bin/bash
set -euo pipefail

GRAPH_FILE="_meta/graph.json"
REPORT_FILE="_meta/GRAPH_REPORT.md"

# graph.json 不存在时静默降级
[ -f "$GRAPH_FILE" ] || exit 0

# 读取节点数
NODE_COUNT=$(node -e "
  try {
    const g = JSON.parse(require('fs').readFileSync('$GRAPH_FILE','utf8'));
    console.log(g.graph && g.graph.nodeCount != null ? g.graph.nodeCount : 0);
  } catch(e) { process.exit(0); }
")

# 从 GRAPH_REPORT.md grep 提取社区数，fallback 为 N/A
COMMUNITY_COUNT="N/A"
if [ -f "$REPORT_FILE" ]; then
  COMMUNITY_COUNT=$(grep -oP '(?<=\\| 社区 \\| )\\d+' "$REPORT_FILE" 2>/dev/null | head -1 || echo "N/A")
fi

# 读取 God Nodes（按 degree 排序取前 5）
GOD_NODES=$(node -e "
  try {
    const g = JSON.parse(require('fs').readFileSync('$GRAPH_FILE','utf8'));
    const nodes = (g.nodes || [])
      .filter(function(n) { return n.metadata && n.metadata.degree != null; })
      .sort(function(a,b) { return (b.metadata.degree - a.metadata.degree); })
      .slice(0,5)
      .map(function(n) { return n.label + '(' + n.metadata.degree + ')'; })
      .join(', ');
    console.log(nodes || 'none');
  } catch(e) { console.log('none'); }
")

echo "spectra: Knowledge graph loaded (\$NODE_COUNT nodes · \$COMMUNITY_COUNT communities)"
echo "God nodes: \$GOD_NODES"
echo "→ Read specs/project/graph-report.md before searching raw files."

exit 0
`;
}

/**
 * 安装 Claude Code PreToolUse hook
 * - 幂等：已安装时打印提示并返回，不重复写入
 * - 备份：写入前先 copyFileSync 到 .bak
 * - 原子写入：使用 writeAtomicJson
 * @param projectRoot - 项目根目录绝对路径
 */
export function installClaudeHook(projectRoot: string): void {
  const claudeDir = join(projectRoot, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  // 确保 .claude/ 目录存在
  mkdirSync(claudeDir, { recursive: true });

  // 读取或初始化 settings.json
  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw) as ClaudeSettings;
    } catch {
      throw new Error('[spectra] settings.json 格式错误，请手动修复后重试。');
    }
  }

  // 幂等判定：检查是否已安装
  const existingHooks = settings.hooks?.PreToolUse ?? [];
  const alreadyInstalled = existingHooks.some(h => h.command.includes(HOOK_COMMAND_MARKER));
  if (alreadyInstalled) {
    console.log('[spectra] hook already installed, skipping.');
    return;
  }

  // 备份现有 settings.json
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, `${settingsPath}.bak`);
  }

  // 深度合并：保留所有已有字段，仅追加 PreToolUse 条目
  const merged: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: [...existingHooks, HOOK_ENTRY],
    },
  };

  // 原子写入 settings.json
  writeAtomicJson(settingsPath, merged);
  console.log('[spectra] PreToolUse hook installed to .claude/settings.json');

  // 生成 shell 脚本
  const hooksDir = join(projectRoot, '_meta', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, 'spectra-context.sh');
  writeFileSync(scriptPath, generateContextScript(), 'utf-8');
  chmodSync(scriptPath, 0o755);
  console.log('[spectra] Hook script written to _meta/hooks/spectra-context.sh');
}

/**
 * 卸载 Claude Code PreToolUse hook
 * - 幂等：未找到时静默退出
 * - 过滤掉 command 含 spectra-context.sh 的条目，保留其他条目
 * @param projectRoot - 项目根目录绝对路径
 */
export function removeClaudeHook(projectRoot: string): void {
  const settingsPath = join(projectRoot, '.claude', 'settings.json');

  if (!existsSync(settingsPath)) {
    console.log('[spectra] hook not found, nothing to remove.');
    return;
  }

  const raw = readFileSync(settingsPath, 'utf-8');
  let settings: ClaudeSettings;
  try {
    settings = JSON.parse(raw) as ClaudeSettings;
  } catch {
    throw new Error('[spectra] settings.json 格式错误，请手动修复后重试。');
  }

  const existingHooks = settings.hooks?.PreToolUse ?? [];
  const spectraHook = existingHooks.find(h => h.command.includes(HOOK_COMMAND_MARKER));
  if (!spectraHook) {
    console.log('[spectra] hook not found, nothing to remove.');
    return;
  }

  // 过滤掉 spectra hook，保留其他条目
  const filtered = existingHooks.filter(h => !h.command.includes(HOOK_COMMAND_MARKER));

  const updated: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: filtered,
    },
  };

  writeAtomicJson(settingsPath, updated);
  console.log('[spectra] PreToolUse hook removed from .claude/settings.json');
}
