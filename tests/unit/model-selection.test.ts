import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveCodexExecutionConfig,
  resolveReverseSpecModel,
  resolveReverseSpecRuntime,
  getCanonicalSonnetModelId,
} from '../../src/core/model-selection.js';

// Feature 133 P0-3：默认 model 升级（Sonnet 4.6 / Opus 4.7 1M）
const SONNET_MODEL = 'claude-sonnet-4-6';
const OPUS_MODEL = 'claude-opus-4-7';
const CODEX_MODEL = 'gpt-5.4';

describe('model-selection', () => {
  const originalEnv = process.env;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spectra-model-'));
    process.env = { ...originalEnv };
    delete process.env['REVERSE_SPEC_MODEL'];
    delete process.env['CODEX_THREAD_ID'];
    delete process.env['CODEX_SHELL'];
    delete process.env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'];
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('未配置时使用默认模型', () => {
    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.source).toBe('default');
    expect(result.model).toBe(SONNET_MODEL);
    expect(result.runtime).toBe('claude');
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

  // Feature 133 P0-3：balanced preset 默认映射到 sonnet（旧行为是 opus）
  it('balanced preset 默认映射到 sonnet（Feature 133 P0-3 breaking change）', () => {
    writeConfig(
      tempDir,
      `
preset: balanced
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

  it('Codex 运行时默认映射到 Codex 模型', () => {
    process.env['CODEX_THREAD_ID'] = 'thread-1';

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.runtime).toBe('codex');
    expect(result.runtimeSource).toBe('env');
    expect(result.model).toBe(CODEX_MODEL);
  });

  it('Codex 运行时将逻辑模型映射到 Codex 模型', () => {
    process.env['CODEX_THREAD_ID'] = 'thread-1';
    process.env['REVERSE_SPEC_MODEL'] = 'opus';

    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(result.runtime).toBe('codex');
    expect(result.model).toBe(CODEX_MODEL);
  });

  it('config 中 runtime=claude 时覆盖 Codex 环境自动识别', () => {
    process.env['CODEX_THREAD_ID'] = 'thread-1';
    writeConfig(
      tempDir,
      `
model_compat:
  runtime: claude
`,
    );

    const runtime = resolveReverseSpecRuntime({ cwd: tempDir, env: process.env });
    const result = resolveReverseSpecModel({ cwd: tempDir, env: process.env });

    expect(runtime.runtime).toBe('claude');
    expect(runtime.source).toBe('config');
    // Feature 133 P0-3：未设 preset 时默认 balanced，新版本 balanced 映射到 sonnet（旧版是 opus）
    expect(result.model).toBe(SONNET_MODEL);
  });

  it('读取 Codex execution 配置', () => {
    process.env['CODEX_THREAD_ID'] = 'thread-1';
    writeConfig(
      tempDir,
      `
preset: quality-first
model_compat:
  defaults:
    codex: gpt-5.4
  aliases:
    codex:
      opus: gpt-5.4
codex:
  service_tier: fast
codex_thinking:
  default_level: xhigh
`,
    );

    const result = resolveCodexExecutionConfig({ cwd: tempDir, env: process.env });

    expect(result.model).toBe('gpt-5.4');
    expect(result.reasoningEffort).toBe('xhigh');
    expect(result.serviceTier).toBe('fast');
  });

  // Fix 134：getCanonicalSonnetModelId 真实 sonnet ID 不依赖 yaml 配置
  // 根因：之前用 resolveReverseSpecModel({ agentId: 'specify-sonnet' }) 取 sonnet
  // override 模型 ID，但该 agentId 在 yaml agents 不存在，会 fallback 到 preset；
  // 当用户配置 quality-first 时 sonnetModelId 实际是 opus，破坏小模块/budget/
  // reading 模式 强制 sonnet 的设计意图。helper 直接从 LOGICAL_*_MODEL_MAP 取，
  // 不读 yaml，保证 sonnet override 总是真 sonnet。
  describe('getCanonicalSonnetModelId（Fix 134）', () => {
    it('claude runtime → claude-sonnet-4-6（不读 yaml）', () => {
      // 即使 cwd 下有 quality-first preset 的 yaml，helper 也返回 sonnet
      writeConfig(
        tempDir,
        `
preset: quality-first
agents:
  specify:
    model: opus
`,
      );
      process.chdir(tempDir);
      try {
        expect(getCanonicalSonnetModelId('claude')).toBe(SONNET_MODEL);
      } finally {
        process.chdir(originalEnv['HOME'] ?? '/');
      }
    });

    it('codex runtime → gpt-5.4（runtime 感知）', () => {
      expect(getCanonicalSonnetModelId('codex')).toBe(CODEX_MODEL);
    });

    it('默认 runtime（不传参）→ claude-sonnet-4-6', () => {
      expect(getCanonicalSonnetModelId()).toBe(SONNET_MODEL);
    });
  });

  // Feature 238 Slice 4 — FR-304 modelFlagMode 决策矩阵七类来源
  describe('resolveCodexExecutionConfig — modelFlagMode 决策矩阵（FR-304）', () => {
    it('T4.1 无配置文件、无 env → delegate，modelSource 以 preset: 开头，model 以 delegated: 开头', () => {
      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {} });

      expect(result.modelFlagMode).toBe('delegate');
      expect(result.modelSource.startsWith('preset:')).toBe(true);
      expect(result.model.startsWith('delegated:')).toBe(true);
    });

    it('T4.2 preset: balanced（无 agents/model_compat）→ delegate 结果', () => {
      writeConfig(
        tempDir,
        `
preset: balanced
`,
      );

      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {} });

      expect(result.modelFlagMode).toBe('delegate');
      expect(result.modelSource).toBe('preset:balanced');
      expect(result.model).toBe('delegated:sonnet');
    });

    it('T4.3 agents.<agentId>.model 显式配置 → required，modelSource 以 driver-config-agent: 开头', () => {
      writeConfig(
        tempDir,
        `
preset: balanced
agents:
  specify:
    model: sonnet
`,
      );

      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {}, agentId: 'specify' });

      expect(result.modelFlagMode).toBe('required');
      expect(result.modelSource.startsWith('driver-config-agent:')).toBe(true);
    });

    it('T4.4 model_compat.aliases.codex[tier] 命中（preset 命中 sonnet tier，无 agents 显式覆盖）→ required，且 model 为该 alias 字面值', () => {
      writeConfig(
        tempDir,
        `
preset: cost-efficient
model_compat:
  aliases:
    codex:
      sonnet: gpt-5.6-sol
`,
      );

      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {} });

      expect(result.modelFlagMode).toBe('required');
      expect(result.modelSource.startsWith('model_compat.aliases.codex:')).toBe(true);
      // 回归哨兵：必须是该 alias 的字面配置值，不能静默丢弃为内建默认（Review C1 新增断言）
      expect(result.model).toBe('gpt-5.6-sol');
    });

    it('T4.5 model_compat.defaults.codex 命中（无 aliases 命中）→ required，modelSource 精确等于 model_compat.defaults.codex', () => {
      writeConfig(
        tempDir,
        `
preset: balanced
model_compat:
  defaults:
    codex: gpt-5.6-sol
`,
      );

      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {} });

      expect(result.modelFlagMode).toBe('required');
      expect(result.modelSource).toBe('model_compat.defaults.codex');
      expect(result.model).toBe('gpt-5.6-sol');
    });

    it('T4.6 env.REVERSE_SPEC_MODEL 设置 → required，modelSource 精确等于 env:REVERSE_SPEC_MODEL', () => {
      const result = resolveCodexExecutionConfig({
        cwd: tempDir,
        env: { REVERSE_SPEC_MODEL: 'opus' },
      });

      expect(result.modelFlagMode).toBe('required');
      expect(result.modelSource).toBe('env:REVERSE_SPEC_MODEL');
    });

    it('E5 用户显式 pin 某 tier（model_compat.aliases.codex）时，delegate 逻辑绝不能覆盖该显式值', () => {
      writeConfig(
        tempDir,
        `
preset: quality-first
model_compat:
  aliases:
    codex:
      opus: gpt-5.6-sol
`,
      );

      const result = resolveCodexExecutionConfig({ cwd: tempDir, env: {} });

      expect(result.modelFlagMode).toBe('required');
      expect(result.model).toBe('gpt-5.6-sol');
    });
  });
});

function writeConfig(dir: string, content: string, fileName = 'spec-driver.config.yaml'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), content.trimStart(), 'utf-8');
}
