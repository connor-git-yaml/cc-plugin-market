/**
 * Skill 安装/卸载核心逻辑
 * 供 init 命令和 postinstall/preuninstall 脚本共享
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getSkillDefinitionsForPlatform } from './skill-templates.js';
import { resolveCodexHomeFromProcess } from '../core/codex-home.js';
import { probeCodexPath, describeCodexPathProblem } from '../core/codex-home-access.js';

// ============================================================
// 数据模型接口（按 data-model.md 和 contracts/installer-api.md）
// ============================================================

/** 可安装的 skill 单元 */
export interface SkillDefinition {
  readonly name: string;
  readonly content: string;
}

/** Skill 目标平台 */
export type SkillTargetPlatform = 'claude' | 'codex';

/** 安装选项 */
export interface InstallOptions {
  /** 安装目标基础路径（如 /path/to/project/.claude/skills/） */
  targetDir: string;
  /** 安装模式标记（影响日志输出） */
  mode: 'project' | 'global';
  /** 目标平台（Claude Code / Codex） */
  platform: SkillTargetPlatform;
}

/** 移除选项 */
export interface RemoveOptions {
  /** 目标基础路径 */
  targetDir: string;
  /** 移除模式标记 */
  mode: 'project' | 'global';
  /** 目标平台（Claude Code / Codex） */
  platform: SkillTargetPlatform;
}

/** 单个 skill 的安装/移除结果 */
export interface InstallResult {
  skillName: string;
  status: 'installed' | 'updated' | 'removed' | 'skipped' | 'failed';
  targetPath: string;
  error?: string;
}

/** 一次完整安装/移除操作的汇总 */
export interface InstallSummary {
  mode: 'project' | 'global';
  action: 'install' | 'remove';
  platform: SkillTargetPlatform;
  results: InstallResult[];
  targetBasePath: string;
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 将 Skill Pack 安装到指定目标位置
 * 单个 skill 失败不中断其他 skill 的安装
 */
export function installSkills(options: InstallOptions): InstallSummary {
  const { targetDir, mode, platform } = options;
  const results: InstallResult[] = [];
  const skillDefinitions = getSkillDefinitionsForPlatform(platform);

  for (const skill of skillDefinitions) {
    const skillDir = join(targetDir, skill.name);
    const targetFile = join(skillDir, 'SKILL.md');

    try {
      // 检测是否已存在（区分 installed vs updated）
      const alreadyExists = existsSync(targetFile);

      // 递归创建目录
      mkdirSync(skillDir, { recursive: true });

      // 写入 SKILL.md
      writeFileSync(targetFile, skill.content, 'utf-8');

      results.push({
        skillName: skill.name,
        status: alreadyExists ? 'updated' : 'installed',
        targetPath: targetFile,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        skillName: skill.name,
        status: 'failed',
        targetPath: targetFile,
        error: message,
      });
    }
  }

  return {
    mode,
    action: 'install',
    platform,
    results,
    targetBasePath: targetDir,
  };
}

/**
 * 从指定目标位置移除已安装的 skill
 * 单个 skill 删除失败不中断其他
 */
export function removeSkills(options: RemoveOptions): InstallSummary {
  const { targetDir, mode, platform } = options;
  const results: InstallResult[] = [];
  const skillDefinitions = getSkillDefinitionsForPlatform(platform);

  for (const skill of skillDefinitions) {
    const skillDir = join(targetDir, skill.name);

    try {
      // W2 修订：原实现为 existsSync(skillDir)。existsSync 对 EACCES 与 ENOENT 同样返回 false，
      // 于是**不可访问**的安装目录被判成"没安装"→ status=skipped → 上层输出"无需清理"，
      // 而实际上 skill 仍留在磁盘上（卸载假成功）。改按 errno 分流：
      //   missing            → skipped（确实没装）
      //   directory / file   → 执行删除
      //   denied / error     → failed + 明确诊断（绝不冒充 skipped）
      const probe = probeCodexPath(skillDir);
      if (probe.kind === 'missing') {
        results.push({
          skillName: skill.name,
          status: 'skipped',
          targetPath: join(skillDir, 'SKILL.md'),
        });
      } else if (probe.kind === 'denied' || probe.kind === 'error') {
        results.push({
          skillName: skill.name,
          status: 'failed',
          targetPath: join(skillDir, 'SKILL.md'),
          error: describeCodexPathProblem(skillDir, probe)!,
        });
      } else {
        rmSync(skillDir, { recursive: true, force: true });
        results.push({
          skillName: skill.name,
          status: 'removed',
          targetPath: join(skillDir, 'SKILL.md'),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        skillName: skill.name,
        status: 'failed',
        targetPath: join(skillDir, 'SKILL.md'),
        error: message,
      });
    }
  }

  return {
    mode,
    action: 'remove',
    platform,
    results,
    targetBasePath: targetDir,
  };
}

/**
 * 解析安装目标目录的绝对路径
 */
export function resolveTargetDir(
  mode: 'project' | 'global',
  platform: SkillTargetPlatform,
): string {
  const rootDir = platform === 'codex' ? '.codex' : '.claude';
  if (mode === 'global') {
    // 🔴 F240 / FR-007：**只有** codex + global 这一格以「全局 Codex 家目录」为基，
    // 受 CODEX_HOME 控制；Claude 全局分支与之无关，保持家目录拼接。
    if (platform === 'codex') {
      return join(resolveCodexHomeFromProcess(), 'skills');
    }
    return join(homedir(), rootDir, 'skills');
  }
  // 🔴 project 分支以 process.cwd() 为基，与上方 global 分支**语义相反**（同一个 rootDir 变量）。
  // 仓库内 .codex/skills/ 是 F238 wrapper 产物目录（受 body-sha256 门禁保护），
  // 误接 CODEX_HOME helper 会同时打断 repo:check 与 F238 门禁链路（_grounding.md §9.2）。
  return join(process.cwd(), rootDir, 'skills');
}

/**
 * 全局安装目录的**展示用**根路径。
 *
 * F240 / FR-007(2)：CODEX_HOME 自定义时不得继续无条件展示 `~/.codex`（会误导用户去看错目录）；
 * 未自定义时沿用简写以保持既有输出不变。
 */
export function formatGlobalRootDisplay(platform: SkillTargetPlatform): string {
  if (platform !== 'codex') {
    return '~/.claude';
  }
  const resolved = resolveCodexHomeFromProcess();
  return resolved === join(homedir(), '.codex') ? '~/.codex' : resolved;
}

/**
 * 格式化安装/移除结果为用户友好的中文输出
 */
export function formatSummary(summary: InstallSummary): string {
  const { action, results, mode, platform } = summary;
  const lines: string[] = [];
  const platformLabel = platform === 'codex' ? 'Codex' : 'Claude Code';
  const platformSuffix = platform === 'codex' ? `（${platformLabel}）` : '';

  // 判断是否全部为同一状态
  const allSkipped = results.every((r) => r.status === 'skipped');
  const hasFailure = results.some((r) => r.status === 'failed');
  const allFailed = results.every((r) => r.status === 'failed');

  // 移除模式：全部 skipped
  if (action === 'remove' && allSkipped) {
    return '未检测到已安装的 spectra skills，无需清理';
  }

  // 标题
  if (action === 'install') {
    const allUpdated = results.every(
      (r) => r.status === 'updated' || r.status === 'failed',
    );
    const hasAnyUpdated = results.some((r) => r.status === 'updated');
    if (hasFailure && !allFailed) {
      if (platform === 'codex') {
        lines.push('spectra skills 安装完成（Codex，部分失败）:');
      } else {
        lines.push('spectra skills 安装完成（部分失败）:');
      }
    } else if (hasAnyUpdated && allUpdated && !hasFailure) {
      lines.push(`spectra skills 已更新${platformSuffix}:`);
    } else if (mode === 'global') {
      lines.push(`spectra skills 已安装到全局目录${platformSuffix}:`);
    } else {
      lines.push(`spectra skills 安装完成${platformSuffix}:`);
    }
  } else {
    lines.push(`spectra skills 已移除${platformSuffix}:`);
  }

  // 逐项状态
  for (const result of results) {
    // 用相对路径显示
    const displayPath = formatDisplayPath(result, summary);

    switch (result.status) {
      case 'installed':
        lines.push(`  ✓ 已安装: ${displayPath}`);
        break;
      case 'updated':
        lines.push(`  ✓ 已更新: ${displayPath}`);
        break;
      case 'removed':
        lines.push(`  ✓ 已删除: ${formatDisplayDir(result, summary)}`);
        break;
      case 'skipped':
        // 移除时 skipped 不额外输出
        break;
      case 'failed':
        lines.push(`  ⚠ 失败: ${displayPath} — ${result.error ?? '未知错误'}`);
        break;
    }
  }

  // 安装成功后的提示
  if (action === 'install' && !allFailed) {
    lines.push('');
    if (mode === 'global') {
      lines.push('注意: 全局 skill 优先级高于项目级 skill');
    } else if (platform === 'codex') {
      lines.push('提示: 在 Codex 中可通过提及 $spectra 触发 skill');
    } else {
      lines.push('提示: 在 Claude Code 中使用 /spectra 即可调用');
    }
  }

  return lines.join('\n');
}

/** 格式化显示路径（文件） */
function formatDisplayPath(
  result: InstallResult,
  summary: InstallSummary,
): string {
  const rootDir = summary.platform === 'codex' ? '.codex' : '.claude';
  if (summary.mode === 'global') {
    return `${formatGlobalRootDisplay(summary.platform)}/skills/${result.skillName}/SKILL.md`;
  }
  return `${rootDir}/skills/${result.skillName}/SKILL.md`;
}

/** 格式化显示路径（目录） */
function formatDisplayDir(
  result: InstallResult,
  summary: InstallSummary,
): string {
  const rootDir = summary.platform === 'codex' ? '.codex' : '.claude';
  if (summary.mode === 'global') {
    return `${formatGlobalRootDisplay(summary.platform)}/skills/${result.skillName}/`;
  }
  return `${rootDir}/skills/${result.skillName}/`;
}
