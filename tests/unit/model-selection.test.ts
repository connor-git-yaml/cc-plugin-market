import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveReverseSpecModel } from '../../src/core/model-selection.js';

const SONNET_MODEL = 'claude-sonnet-4-5-20250929';
const OPUS_MODEL = 'claude-opus-4-1-20250805';

describe('model-selection', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reverse-spec-model-'));
    process.env = { ...originalEnv };
    delete process.env['REVERSE_SPEC_MODEL'];
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('未配置时使用默认模型', () => {
    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('default');
    expect(result.model).toBe(SONNET_MODEL);
  });

  it('REVERSE_SPEC_MODEL 优先级最高', () => {
    writeConfig(
      tempDir,
      `
preset: cost-efficient
agents:
  specify:
    model: sonnet
`,
    );
    process.env['REVERSE_SPEC_MODEL'] = 'opus';

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('env');
    expect(result.model).toBe(OPUS_MODEL);
  });

  it('读取 agents.specify.model 覆盖 preset', () => {
    writeConfig(
      tempDir,
      `
preset: cost-efficient
agents:
  specify:
    model: gpt-5
model_compat:
  aliases:
    claude:
      gpt-5: opus
`,
    );

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('driver-config-agent');
    expect(result.model).toBe(OPUS_MODEL);
  });

  it('支持将 gpt-5.3-codex thinking 别名映射回 Claude 逻辑模型', () => {
    writeConfig(
      tempDir,
      `
preset: balanced
agents:
  specify:
    model: gpt-5.3-codex-thinking-high
`,
    );

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('driver-config-agent');
    expect(result.model).toBe(OPUS_MODEL);
  });

  it('无 agent 覆盖时按 preset 选模', () => {
    writeConfig(
      tempDir,
      `
preset: cost-efficient
`,
    );

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('driver-config-preset');
    expect(result.model).toBe(SONNET_MODEL);
  });

  it('支持在上级目录 .specify 下发现配置文件', () => {
    const workspace = join(tempDir, 'workspace');
    const nested = join(workspace, 'apps', 'web');
    mkdirSync(nested, { recursive: true });
    writeConfig(
      join(workspace, '.specify'),
      `
preset: quality-first
`,
      'spec-driver.config.yaml',
    );

    const result = resolveReverseSpecModel({ cwd: nested, env: process.env });

    expect(result.source).toBe('driver-config-preset');
    expect(result.model).toBe(OPUS_MODEL);
    expect(result.configPath).toBe(join(workspace, '.specify', 'spec-driver.config.yaml'));
  });
});

function writeConfig(dir: string, content: string, fileName = 'spec-driver.config.yaml'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content.trimStart(), 'utf-8');
}
