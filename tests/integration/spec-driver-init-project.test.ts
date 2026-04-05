/**
 * Spec Driver init-project 脚本集成测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/init-project.sh');

function runInitScript(cwd: string): {
  NEEDS_CONSTITUTION: boolean;
  NEEDS_CONFIG: boolean;
  HAS_SPEC_DRIVER_SKILLS: boolean;
  PROJECT_CONTEXT_MODE: string;
  SKILL_MAP: string;
  RESULTS: string[];
} {
  const stdout = execFileSync('bash', [SCRIPT_PATH, '--json'], {
    cwd,
    encoding: 'utf-8',
  });
  return JSON.parse(stdout) as {
    NEEDS_CONSTITUTION: boolean;
    NEEDS_CONFIG: boolean;
    HAS_SPEC_DRIVER_SKILLS: boolean;
    PROJECT_CONTEXT_MODE: string;
    SKILL_MAP: string;
    RESULTS: string[];
  };
}

function runInitScriptText(cwd: string): string {
  return execFileSync('bash', [SCRIPT_PATH], {
    cwd,
    encoding: 'utf-8',
  });
}

describe('init-project.sh', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'spec-driver-init-'));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('首次运行会自动创建 .specify/templates 并导入基础模板', () => {
    const result = runInitScript(projectDir);
    expect(result.NEEDS_CONSTITUTION).toBe(true);
    expect(result.NEEDS_CONFIG).toBe(true);
    expect(result.PROJECT_CONTEXT_MODE).toBe('yaml');

    expect(existsSync(join(projectDir, '.specify', 'templates', 'plan-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'project-context-template.yaml'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'spec-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'tasks-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'project-context.yaml'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'project-context.md'))).toBe(false);
    expect(existsSync(join(projectDir, '.specify', 'workflows'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'scorecards'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'runs'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'scorecards', 'default-governance.yaml'))).toBe(true);
    expect(result.RESULTS.some((r) => r.startsWith('specify_templates:'))).toBe(true);
    expect(result.RESULTS).toContain('project_context:created');
    expect(result.RESULTS).toContain('scorecards:ready');
  });

  it('当 .specify 已存在但模板缺失时，会补齐缺失模板', () => {
    mkdirSync(join(projectDir, '.specify', 'templates'), { recursive: true });
    // 人为保留一个模板，模拟“部分存在”
    writeFileSync(
      join(projectDir, '.specify', 'templates', 'spec-template.md'),
      '# existing spec template\n',
      'utf-8',
    );

    const result = runInitScript(projectDir);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'plan-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'constitution-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'project-context-template.yaml'))).toBe(true);
    expect(result.RESULTS.some((r) => r.startsWith('specify_templates:copied:'))).toBe(true);
  });

  it('检测到 legacy project-context.md 时不自动创建 yaml，但返回迁移模式', () => {
    mkdirSync(join(projectDir, '.specify'), { recursive: true });
    writeFileSync(join(projectDir, '.specify', 'project-context.md'), '# Legacy Context\n', 'utf-8');

    const result = runInitScript(projectDir);

    expect(result.PROJECT_CONTEXT_MODE).toBe('legacy-md');
    expect(result.RESULTS).toContain('project_context:legacy_md');
    expect(existsSync(join(projectDir, '.specify', 'project-context.yaml'))).toBe(false);
  });

  it('同时识别 .claude/commands 和 .codex/commands 下的 spec-driver 覆盖', () => {
    mkdirSync(join(projectDir, '.claude', 'commands'), { recursive: true });
    mkdirSync(join(projectDir, '.codex', 'commands'), { recursive: true });
    writeFileSync(
      join(projectDir, '.claude', 'commands', 'spec-driver.plan.md'),
      '# plan\n',
      'utf-8',
    );
    writeFileSync(
      join(projectDir, '.codex', 'commands', 'spec-driver.tasks.md'),
      '# tasks\n',
      'utf-8',
    );

    const result = runInitScript(projectDir);

    expect(result.HAS_SPEC_DRIVER_SKILLS).toBe(true);
    expect(result.SKILL_MAP).toContain('plan');
    expect(result.SKILL_MAP).toContain('tasks');
  });

  it('文本模式会输出阶段结果摘要', () => {
    const stdout = runInitScriptText(projectDir);

    expect(stdout).toContain('[初始化] 项目环境检查');
    expect(stdout).toContain('.specify/templates');
    expect(stdout).toContain('.specify/project-context.yaml');
    expect(stdout).toContain('spec-driver.config.yaml');
  });
});
