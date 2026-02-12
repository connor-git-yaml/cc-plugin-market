/**
 * Skill 安装/卸载核心逻辑
 * 供 init 命令和 postinstall/preuninstall 脚本共享
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SKILL_DEFINITIONS } from './skill-templates.js';

// ============================================================
// 数据模型接口（按 data-model.md 和 contracts/installer-api.md）
// ============================================================

/** 可安装的 skill 单元 */
export interface SkillDefinition {
  readonly name: string;
  readonly content: string;
}

/** 安装选项 */
export interface InstallOptions {
  /** 安装目标基础路径（如 /path/to/project/.claude/skills/） */
  targetDir: string;
  /** 安装模式标记（影响日志输出） */
  mode: 'project' | 'global';
}

/** 移除选项 */
export interface RemoveOptions {
  /** 目标基础路径 */
  targetDir: string;
  /** 移除模式标记 */
  mode: 'project' | 'global';
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
  const { targetDir, mode } = options;
  const results: InstallResult[] = [];

  for (const skill of SKILL_DEFINITIONS) {
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
    results,
    targetBasePath: targetDir,
  };
}

/**
 * 从指定目标位置移除已安装的 skill
 * 单个 skill 删除失败不中断其他
 */
export function removeSkills(options: RemoveOptions): InstallSummary {
  const { targetDir, mode } = options;
  const results: InstallResult[] = [];

  for (const skill of SKILL_DEFINITIONS) {
    const skillDir = join(targetDir, skill.name);

    try {
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true, force: true });
        results.push({
          skillName: skill.name,
          status: 'removed',
          targetPath: join(skillDir, 'SKILL.md'),
        });
      } else {
        results.push({
          skillName: skill.name,
          status: 'skipped',
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
    results,
    targetBasePath: targetDir,
  };
}

/**
 * 解析安装目标目录的绝对路径
 */
export function resolveTargetDir(mode: 'project' | 'global'): string {
  if (mode === 'global') {
    return join(homedir(), '.claude', 'skills');
  }
  return join(process.cwd(), '.claude', 'skills');
}

/**
 * 格式化安装/移除结果为用户友好的中文输出
 */
export function formatSummary(summary: InstallSummary): string {
  const { action, results, mode } = summary;
  const lines: string[] = [];

  // 判断是否全部为同一状态
  const allSkipped = results.every((r) => r.status === 'skipped');
  const hasFailure = results.some((r) => r.status === 'failed');
  const allFailed = results.every((r) => r.status === 'failed');

  // 移除模式：全部 skipped
  if (action === 'remove' && allSkipped) {
    return '未检测到已安装的 reverse-spec skills，无需清理';
  }

  // 标题
  if (action === 'install') {
    const allUpdated = results.every(
      (r) => r.status === 'updated' || r.status === 'failed',
    );
    const hasAnyUpdated = results.some((r) => r.status === 'updated');
    if (hasFailure && !allFailed) {
      lines.push('reverse-spec skills 安装完成（部分失败）:');
    } else if (hasAnyUpdated && allUpdated && !hasFailure) {
      lines.push('reverse-spec skills 已更新:');
    } else if (mode === 'global') {
      lines.push('reverse-spec skills 已安装到全局目录:');
    } else {
      lines.push('reverse-spec skills 安装完成:');
    }
  } else {
    lines.push('reverse-spec skills 已移除:');
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
    } else {
      lines.push('提示: 在 Claude Code 中使用 /reverse-spec 即可调用');
    }
  }

  return lines.join('\n');
}

/** 格式化显示路径（文件） */
function formatDisplayPath(
  result: InstallResult,
  summary: InstallSummary,
): string {
  if (summary.mode === 'global') {
    return `~/.claude/skills/${result.skillName}/SKILL.md`;
  }
  return `.claude/skills/${result.skillName}/SKILL.md`;
}

/** 格式化显示路径（目录） */
function formatDisplayDir(
  result: InstallResult,
  summary: InstallSummary,
): string {
  if (summary.mode === 'global') {
    return `~/.claude/skills/${result.skillName}/`;
  }
  return `.claude/skills/${result.skillName}/`;
}
