/**
 * Claude Code PreToolUse hook 安装/卸载核心逻辑
 * 包含：HookConfig/ClaudeSettings 类型定义、shell 脚本生成、幂等安装/卸载
 */

import {
  constants,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  statSync,
  lstatSync,
} from 'node:fs';
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
  command: 'bash specs/_meta/hooks/spectra-context.sh',
};

/** 首次创建 hook 脚本时给的默认权限；已存在的脚本一律保全用户自己设的 mode */
const DEFAULT_SCRIPT_MODE = 0o755;

/**
 * 备份 settings.json —— 只在 `.bak` **尚不存在时**创建。
 *
 * 🔴 `COPYFILE_EXCL` 是承重的，不是保险：备份的价值恰恰在于"最早那一份"（用户的原始文件），
 * 而不是"上一次合并的结果"。第二次安装/卸载若覆写备份，用户唯一的回滚点就被换成一份我们自己
 * 写出来的中间态，原始文件永久消失。语义与 codex 侧 `codex-hooks-installer.mjs` 的 `commit`
 * 一致。
 *
 * 🔴 EEXIST **不等于"备份可用"**（F267 对抗审查 W1）：`COPYFILE_EXCL` 只回答"这个名字被占了没有"，
 * 不回答"占它的是什么"。`.bak` 是悬空软链 / 目录 / 空文件时同样报 EEXIST，若照旧打印"保留最早
 * 备份"，用户就在"我以为有后悔药"的前提下让我们改了他的文件——这正是本函数注释声称要防的事。
 * 故 EEXIST 后补一次可用性检查（普通文件且非空），不可用就如实告警、不说安慰话。
 * （攻击面同源：世界可写的 `.claude/` 里，`ln -s /dev/null settings.json.bak` 一次即可永久
 * 关掉备份机制，而每次都收到"已备份"的确认。）
 *
 * `bestEffort` 用于**卸载**路径：卸载是用户的止损动作，不该被"想留个后悔药"拦死
 * （F267 对抗审查 C2 实证：磁盘将满时备份 126KB 失败 → 只需写 1KB 的卸载被彻底阻断）。
 * 安装路径保持严格：那条路径**要改用户的文件**，备份失败就该停下来。
 *
 * 文案不按 install / remove 分语境：它描述的是 `.bak` 文件自身的状态，与"这次是安装还是卸载"
 * 无关，参数化只会引入一个没有信息量的分支。
 */
function backupSettingsIfAbsent(settingsPath: string, bestEffort = false): void {
  const backupPath = `${settingsPath}.bak`;
  try {
    copyFileSync(settingsPath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      assertBackupUsable(backupPath);
      return;
    }
    if (bestEffort) {
      console.warn(
        `[spectra] 备份 ${backupPath} 失败（${code ?? String(error)}），继续执行卸载（卸载是恢复动作，不因备份失败中止）。`,
      );
      return;
    }
    throw error;
  }
}

/**
 * `.bak` 已存在时，核实它真的能当回滚点用。
 * 只认"普通文件且非空"——软链（含悬空）、目录、空文件都不是可回滚的备份。
 */
function assertBackupUsable(backupPath: string): void {
  let usable = false;
  try {
    const stat = lstatSync(backupPath);
    usable = stat.isFile() && stat.size > 0;
  } catch {
    usable = false;
  }
  if (usable) {
    console.log('[spectra] .bak 已存在，保留最早备份，本次不覆盖。');
    return;
  }
  console.warn(
    `[spectra] ⚠️ ${backupPath} 已存在但不是可用备份（非普通文件或为空），本次不覆盖它，` +
      `因此**没有**可回滚的备份。如需备份请先手动移走该路径。`,
  );
}

/**
 * 给 hook 脚本落权限位。
 *
 * ## 规则（F267，用户裁决：保全 + 兜底可执行 + 告警）
 * - **首次创建** → `DEFAULT_SCRIPT_MODE`（0755），与改动前一致；
 * - **已存在** → **如实保全用户设的每一个位**，包括他放宽成 0777 的情形。「保全 ≠ 加固」：
 *   无条件 `chmod 0755`（改动前的行为）会把用户收紧的 0700 悄悄放宽，那正是 D5 缺陷本身；
 * - 但在保全值上**并入 `0o500`**（owner 可读 + 可执行）。理由不是加固，是**别报假成功**：
 *   0200 / 0000 这类形态下脚本每次执行都 exit 126，而安装流会打印"installed"——实测确证。
 *   我们生成的、且由我们写进 settings.json 让 Claude Code 去跑的文件，至少得跑得起来；
 * - 保全值若含 **group/other 可写**位，打印告警而**不**替用户改：这个文件会被当命令执行，
 *   世界可写意味着同机任何本地用户都能改写它的内容。风险归用户知情、决定权归用户。
 */
function applyScriptMode(scriptPath: string, preservedMode: number | null): void {
  if (preservedMode === null) {
    chmodSync(scriptPath, DEFAULT_SCRIPT_MODE);
    return;
  }
  // `| 0o500`：只补 owner 的读与执行，不动 group/other，也不清任何用户设过的位。
  const effectiveMode = preservedMode | 0o500;
  chmodSync(scriptPath, effectiveMode);
  if (effectiveMode !== preservedMode) {
    console.log(
      `[spectra] hook 脚本原权限 0${preservedMode.toString(8)} 无法执行，已补足 owner 读+执行位 → 0${effectiveMode.toString(8)}。`,
    );
  }
  if ((effectiveMode & 0o022) !== 0) {
    console.warn(
      `[spectra] ⚠️ hook 脚本 ${scriptPath} 权限为 0${effectiveMode.toString(8)}（组/其他用户可写），` +
        `而它会被 Claude Code 当命令执行——同机其他本地用户可改写其内容。已如实保全你设置的权限，未擅自收紧；` +
        `如非本意，建议 chmod 755。`,
    );
  }
}

/**
 * 生成 spectra-context.sh 脚本内容
 * - 使用 node -e 内联 JSON 解析，避免依赖 jq
 * - 任何异常均 exit 0，不阻塞 Claude Code 工具调用
 */
export function generateContextScript(): string {
  return `#!/bin/bash
set -euo pipefail

GRAPH_FILE="specs/_meta/graph.json"
REPORT_FILE="specs/_meta/GRAPH_REPORT.md"

# graph.json 不存在时静默降级
[ -f "$GRAPH_FILE" ] || exit 0

# 读取节点数
NODE_COUNT=$(node -e "
  try {
    const g = JSON.parse(require('fs').readFileSync('$GRAPH_FILE','utf8'));
    console.log(g.graph && g.graph.nodeCount != null ? g.graph.nodeCount : 0);
  } catch(e) { process.exit(0); }
")

# 从 GRAPH_REPORT.md 提取社区数（使用 node 解析，兼容 macOS）
COMMUNITY_COUNT="N/A"
if [ -f "$REPORT_FILE" ]; then
  COMMUNITY_COUNT=$(node -e "
    try {
      const t = require('fs').readFileSync('$REPORT_FILE','utf8');
      const m = t.match(/\\| 社区 \\| (\\d+)/);
      console.log(m ? m[1] : 'N/A');
    } catch(e) { console.log('N/A'); }
  " 2>/dev/null || echo "N/A")
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
echo "→ Read specs/_meta/GRAPH_REPORT.md for the full knowledge graph report."

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
  //
  // ⚠️ 已知边界（F267 显式登记，不修）：这里按默认 mode 建目录，umask 000 下即 0777 世界可写。
  // `settings.json` 的 `hooks[].command` 会被 Claude Code **当命令执行**，因此同机的其他本地
  // 用户可以 unlink 掉那份 settings.json 再放一份自己的进来——注入模型与 codex 侧 `hooks.json`
  // 同构（codex 侧为此把 `$CODEX_HOME` 建成 0700）。
  // 不在本卡收口的理由是范围：F267 点名的是 chmod 保全 / `.bak` 保留最早一份 / remove 对称备份
  // 三项；收紧 `.claude/` 会改变用户既有目录的可访问性，需独立评估其它消费方（编辑器插件、
  // 其它工具也读这个目录），故另立卡。
  // 🔴 措辞更正（F267 对抗审查 I3）：早先这里写"这条路径根本不经过 writeAtomicJson"，**是错的**
  // ——`writeAtomicJson` 自己会 `mkdirSync(dirname)`，`.claude/` 不存在时正是它建的。
  // "给 writeAtomicJson 加目录 mode 修不到这里"这个结论依然成立，但成立的原因是**调用顺序**：
  // 下面这行先把目录建出来，而 `recursive` 的 mode 只作用于本次**新建**的路径分量。
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

  // 幂等判定：检查是否已安装（防御 PreToolUse 被写成非数组）
  const rawHooks = settings.hooks?.PreToolUse;
  const existingHooks: HookConfig[] = Array.isArray(rawHooks) ? rawHooks : [];
  const alreadyInstalled = existingHooks.some(h => h.command.includes(HOOK_COMMAND_MARKER));
  if (alreadyInstalled) {
    console.log('[spectra] hook already installed, skipping.');
    return;
  }

  // 备份现有 settings.json
  if (existsSync(settingsPath)) {
    backupSettingsIfAbsent(settingsPath);
  }

  // 深度合并：保留所有已有字段，仅追加 PreToolUse 条目
  const merged: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: [...existingHooks, HOOK_ENTRY],
    },
  };

  // 原子写入 settings.json。
  // 🔴 `followSymlinks: true` 只发给这里与下面的 remove 路径：`.claude/settings.json` 是用户
  // 可能用 dotfiles 托管的**配置文件**，拆链会让托管源永远收不到更新（F267 / D1）。
  // 我方产物（graph / cache / manifest）不传这个选项——它们没有软链托管场景，跟随对它们
  // 只是攻击面（见 atomic-write.ts 模块头 C1）。
  writeAtomicJson(settingsPath, merged, { followSymlinks: true });
  console.log('[spectra] PreToolUse hook installed to .claude/settings.json');

  // 生成 shell 脚本
  const hooksDir = join(projectRoot, 'specs', '_meta', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const scriptPath = join(hooksDir, 'spectra-context.sh');
  // 🔴 mode 快照取在 `writeFileSync` **之前**（F267 / D5）。
  // 今天 `writeFileSync` 对已存在文件只做 truncate + write、不动权限位，事后再读也读得对；
  // 前置取快照是为了让"用户原本设的是什么"这个事实独立于写入动作——将来写入若改成
  // tmp + rename（换 inode、带来一个全新的 mode），事后读到的就是我们自己刚造出来的值，
  // 保全逻辑会静默退化成"保全我们自己写的默认值"。
  // `& 0o7777` 而非 `& 0o777`：保住 setuid/setgid/sticky 高位。
  const preservedMode = existsSync(scriptPath) ? statSync(scriptPath).mode & 0o7777 : null;
  writeFileSync(scriptPath, generateContextScript(), 'utf-8');
  applyScriptMode(scriptPath, preservedMode);
  console.log('[spectra] Hook script written to specs/_meta/hooks/spectra-context.sh');
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

  const rawHooks = settings.hooks?.PreToolUse;
  const existingHooks: HookConfig[] = Array.isArray(rawHooks) ? rawHooks : [];
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

  // 与 installClaudeHook 对称：卸载同样是对用户文件的一次改写，误删后没有备份就无从回滚。
  // 此前这条路径零备份，是 install/remove 之间一处纯粹的不对称疏漏（F267 / D6）。
  // 但备份走 **best-effort**：卸载是止损动作，不该被"想留个后悔药"拦死
  // （见 backupSettingsIfAbsent 的 `bestEffort` 说明）。
  backupSettingsIfAbsent(settingsPath, true);

  writeAtomicJson(settingsPath, updated, { followSymlinks: true });
  console.log('[spectra] PreToolUse hook removed from .claude/settings.json');
}
