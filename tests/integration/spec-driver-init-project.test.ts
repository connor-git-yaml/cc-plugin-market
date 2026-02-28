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
  RESULTS: string[];
} {
  const stdout = execFileSync('bash', [SCRIPT_PATH, '--json'], {
    cwd,
    encoding: 'utf-8',
  });
  return JSON.parse(stdout) as {
    NEEDS_CONSTITUTION: boolean;
    NEEDS_CONFIG: boolean;
    RESULTS: string[];
  };
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

    expect(existsSync(join(projectDir, '.specify', 'templates', 'plan-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'spec-template.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.specify', 'templates', 'tasks-template.md'))).toBe(true);
    expect(result.RESULTS.some((r) => r.startsWith('specify_templates:'))).toBe(true);
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
    expect(result.RESULTS.some((r) => r.startsWith('specify_templates:copied:'))).toBe(true);
  });
});

