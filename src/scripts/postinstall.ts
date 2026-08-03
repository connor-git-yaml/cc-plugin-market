/**
 * postinstall 脚本
 * 全局安装时将 skill 注册到 ~/.claude/skills/ 和/或 ~/.codex/skills/
 * （Codex 侧为默认路径，实际以 CODEX_HOME 为准）
 * 复用 installer 模块的核心逻辑
 */

import {
  installSkills,
  resolveTargetDir,
  formatGlobalRootDisplay,
  type SkillTargetPlatform,
} from '../installer/skill-installer.js';
import { resolveCodexHomeFromProcess } from '../core/codex-home.js';
import {
  probeCodexPath,
  isCodexHomeExplicit,
  describeCodexPathProblem,
} from '../core/codex-home-access.js';

function resolvePostInstallTargets(): SkillTargetPlatform[] {
  const env = process.env['REVERSE_SPEC_SKILL_TARGET'];
  if (env) {
    const parsed = parseTargets(env);
    if (parsed.length > 0) {
      return parsed;
    }
    console.warn(
      `⚠ 警告: REVERSE_SPEC_SKILL_TARGET=${env} 无效，回退自动检测（可选: claude, codex, both）`,
    );
  }

  // F240 / FR-007：探测的是**全局** Codex 家目录（由 CODEX_HOME 决定，未设置才 fallback ~/.codex）
  const codexHome = resolveCodexHomeFromProcess();
  const probe = probeCodexPath(codexHome);
  const problem = describeCodexPathProblem(codexHome, probe);

  // W2 修订：显式设置 CODEX_HOME 即用户明确声明"我在用 Codex，家目录在这"。
  // 此时目录尚不存在是**正常情形**（installSkills 内部会 mkdir -p），原实现用
  // existsSync 判定会静默只注册 Claude、跳过 Codex —— 用户的显式声明被无声丢弃。
  if (isCodexHomeExplicit()) {
    if (probe.kind === 'denied' || probe.kind === 'error') {
      // 不可访问不等于不存在：仍按用户声明尝试注册，失败会在 installSkills 里逐条报错，
      // 但必须先把真实 errno 说出来，否则用户只会看到一串没头没尾的写入失败。
      console.warn(`⚠ 警告: CODEX_HOME 指向的目录探测异常 —— ${problem}；仍按显式声明尝试注册 Codex skills`);
    } else if (probe.kind === 'file') {
      console.warn(`⚠ 警告: CODEX_HOME 指向的不是目录: ${codexHome}；Codex skill 注册预计会失败`);
    }
    return ['claude', 'codex'];
  }

  // 未设置 CODEX_HOME → 走默认路径 ~/.codex，保持既有宽松语义：
  // 目录不存在通常就是"本机没在用 Codex"，跳过注册是正确的，不改行为。
  if (probe.kind === 'directory' || probe.kind === 'file') {
    return ['claude', 'codex'];
  }
  if (probe.kind === 'denied' || probe.kind === 'error') {
    // 但"探测不了"绝不能和"不存在"共用同一条静默路径 —— 必须留下可诊断的痕迹。
    console.warn(`⚠ 警告: 默认 Codex 家目录探测异常 —— ${problem}；本次跳过 Codex skill 注册（这不代表未安装 Codex）`);
  }
  return ['claude'];
}

function parseTargets(raw: string): SkillTargetPlatform[] {
  const value = raw.trim().toLowerCase();
  if (value === 'both') {
    return ['claude', 'codex'];
  }

  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const targets = new Set<SkillTargetPlatform>();
  for (const item of values) {
    if (item === 'claude' || item === 'codex') {
      targets.add(item);
    }
  }
  return [...targets];
}

function main(): void {
  // 仅在全局安装时执行
  if (process.env['npm_config_global'] !== 'true') {
    console.log('spectra: 本地安装，跳过 skill 注册');
    return;
  }

  try {
    const targets = resolvePostInstallTargets();
    for (const platform of targets) {
      const targetDir = resolveTargetDir('global', platform);
      const summary = installSkills({ targetDir, mode: 'global', platform });
      const displayRoot = formatGlobalRootDisplay(platform);
      const platformLabel = platform === 'codex' ? 'Codex' : 'Claude Code';

      // 输出简化的注册信息
      for (const result of summary.results) {
        if (result.status === 'installed' || result.status === 'updated') {
          console.log(`✓ 已注册: ${displayRoot}/skills/${result.skillName}/SKILL.md`);
        } else if (result.status === 'failed') {
          console.warn(`⚠ 警告: 注册 ${result.skillName} 失败: ${result.error ?? '未知错误'}`);
        }
      }

      console.log(`spectra skills 已注册到 ${platformLabel}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ 警告: skill 注册失败: ${message}`);
  }
}

main();
