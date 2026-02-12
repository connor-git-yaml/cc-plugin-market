/**
 * postinstall 脚本
 * 全局安装时将 SKILL.md 注册到 ~/.claude/skills/
 */

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SKILL_NAMES = ['reverse-spec', 'reverse-spec-batch', 'reverse-spec-diff'] as const;

function main(): void {
  // 仅在全局安装时执行
  if (process.env['npm_config_global'] !== 'true') {
    console.log('reverse-spec: 本地安装，跳过 skill 注册');
    return;
  }

  const homeDir = homedir();
  const skillsTargetDir = join(homeDir, '.claude', 'skills');

  // 从编译后的脚本位置回溯到包根目录
  // dist/scripts/postinstall.js → 包根目录
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(__dirname, '..', '..');

  for (const skillName of SKILL_NAMES) {
    try {
      const sourceFile = join(packageRoot, 'src', 'skills-global', skillName, 'SKILL.md');
      const targetDir = join(skillsTargetDir, skillName);
      const targetFile = join(targetDir, 'SKILL.md');

      // 检查源文件是否存在
      if (!existsSync(sourceFile)) {
        console.warn(`⚠ 警告: 源文件不存在 ${sourceFile}，跳过 ${skillName}`);
        continue;
      }

      // 创建目标目录（递归）
      mkdirSync(targetDir, { recursive: true });

      // 复制 SKILL.md
      copyFileSync(sourceFile, targetFile);
      console.log(`✓ 已注册: ~/.claude/skills/${skillName}/SKILL.md`);
    } catch (err) {
      // 权限错误等情况下仅输出警告，不中断安装
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ 警告: 注册 ${skillName} 失败: ${message}`);
    }
  }

  console.log('reverse-spec skills 已注册到 Claude Code');
}

main();
