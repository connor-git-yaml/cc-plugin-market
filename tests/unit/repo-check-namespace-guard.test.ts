/**
 * F170b — namespace-consistency-core 单元测试
 *
 * 验证从 plugin.json + .mcp.json 派生 namespace，
 * 并对 spec-driver agent frontmatter 进行 fail-loud 守护。
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

async function importNamespaceCore() {
  return import(
    pathToFileURL(resolve('scripts/lib/namespace-consistency-core.mjs')).href
  ) as Promise<{
    deriveExpectedNamespace: (root: string) => string;
    validateNamespaceConsistency: (root: string) => {
      status: string;
      checks: Array<{ id: string; status: string; evidence?: object }>;
      warnings: string[];
      errors: string[];
    };
  }>;
}

function writePluginJson(dir: string, name: string) {
  const pluginDir = join(dir, 'plugins/spectra/.claude-plugin');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name }));
}

function writeMcpJson(dir: string, serverKey: string) {
  const spectraDir = join(dir, 'plugins/spectra');
  mkdirSync(spectraDir, { recursive: true });
  writeFileSync(
    join(spectraDir, '.mcp.json'),
    JSON.stringify({ mcpServers: { [serverKey]: {} } }),
  );
}

function writeAgentFile(dir: string, agentFile: string, tools: string[]) {
  const agentsDir = join(dir, 'plugins/spec-driver/agents');
  mkdirSync(agentsDir, { recursive: true });
  const toolsLine =
    tools.length > 0 ? `tools: [${tools.join(', ')}]` : 'tools: []';
  writeFileSync(
    join(agentsDir, agentFile),
    `---\n${toolsLine}\n---\n\n# ${agentFile} content\n`,
  );
}

const AGENT_FILES = ['plan.md', 'implement.md', 'verify.md', 'spec-review.md', 'quality-review.md'];

describe('deriveExpectedNamespace', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ns-guard-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('从 plugin.json name + .mcp.json server key 正确派生 namespace', async () => {
    const { deriveExpectedNamespace } = await importNamespaceCore();
    writePluginJson(tempDir, 'spectra');
    writeMcpJson(tempDir, 'spectra');
    expect(deriveExpectedNamespace(tempDir)).toBe('mcp__plugin_spectra_spectra__');
  });

  it('plugin name 和 server key 不同时仍能正确派生', async () => {
    const { deriveExpectedNamespace } = await importNamespaceCore();
    writePluginJson(tempDir, 'myplugin');
    writeMcpJson(tempDir, 'myserver');
    expect(deriveExpectedNamespace(tempDir)).toBe('mcp__plugin_myplugin_myserver__');
  });

  it('plugin.json 不存在时抛出错误', async () => {
    const { deriveExpectedNamespace } = await importNamespaceCore();
    writeMcpJson(tempDir, 'spectra');
    expect(() => deriveExpectedNamespace(tempDir)).toThrow('plugin.json 不存在');
  });

  it('.mcp.json 不存在时抛出错误', async () => {
    const { deriveExpectedNamespace } = await importNamespaceCore();
    writePluginJson(tempDir, 'spectra');
    expect(() => deriveExpectedNamespace(tempDir)).toThrow('.mcp.json 不存在');
  });

  it('多 server 时 fail-loud（不靠顺序派生）', async () => {
    const { deriveExpectedNamespace } = await importNamespaceCore();
    writePluginJson(tempDir, 'spectra');
    const spectraDir = join(tempDir, 'plugins/spectra');
    mkdirSync(spectraDir, { recursive: true });
    writeFileSync(
      join(spectraDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { serverA: {}, serverB: {} } }),
    );
    expect(() => deriveExpectedNamespace(tempDir)).toThrow('多个 mcpServers');
  });
});

describe('validateNamespaceConsistency — pass 场景', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ns-guard-'));
    writePluginJson(tempDir, 'spectra');
    writeMcpJson(tempDir, 'spectra');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('所有 agent 使用正确 namespace 时返回 pass', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    for (const agentFile of AGENT_FILES) {
      writeAgentFile(tempDir, agentFile, [
        'Read',
        'Glob',
        'mcp__plugin_spectra_spectra__context',
        'mcp__plugin_spectra_spectra__impact',
      ]);
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('带引号的行内数组格式（CRITICAL-2 fix）', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    const agentsDir = join(tempDir, 'plugins/spec-driver/agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const agentFile of AGENT_FILES) {
      writeFileSync(
        join(agentsDir, agentFile),
        '---\ntools: ["Read", "mcp__plugin_spectra_spectra__context"]\n---\n',
      );
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('pass');
  });

  it('YAML block sequence 格式（CRITICAL-2 fix）', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    const agentsDir = join(tempDir, 'plugins/spec-driver/agents');
    mkdirSync(agentsDir, { recursive: true });
    for (const agentFile of AGENT_FILES) {
      writeFileSync(
        join(agentsDir, agentFile),
        '---\ntools:\n  - Read\n  - mcp__plugin_spectra_spectra__context\n---\n',
      );
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('pass');
  });

  it('受保护 agent 无 mcp__ 工具时返回 fail（不可 skip）', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    for (const agentFile of AGENT_FILES) {
      writeAgentFile(tempDir, agentFile, ['Read', 'Write', 'Bash']);
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('未找到任何 mcp__ 工具'))).toBe(true);
  });
});

describe('validateNamespaceConsistency — fail 场景（fail-loud）', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ns-guard-'));
    writePluginJson(tempDir, 'spectra');
    writeMcpJson(tempDir, 'spectra');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('旧 namespace mcp__spectra__ 存在时返回 fail', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    writeAgentFile(tempDir, 'plan.md', [
      'Read',
      'mcp__spectra__context',
      'mcp__spectra__impact',
    ]);
    for (const agentFile of AGENT_FILES.filter((f) => f !== 'plan.md')) {
      writeAgentFile(tempDir, agentFile, ['Read']);
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('fail');
    const planCheck = result.checks.find((c) => c.id.includes('plan'));
    expect(planCheck?.status).toBe('fail');
    expect(result.errors.some((e) => e.includes('mcp__spectra__context'))).toBe(true);
  });

  it('混用新旧 namespace 时返回 fail', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    writeAgentFile(tempDir, 'implement.md', [
      'mcp__plugin_spectra_spectra__context',
      'mcp__spectra__impact',
    ]);
    for (const agentFile of AGENT_FILES.filter((f) => f !== 'implement.md')) {
      writeAgentFile(tempDir, agentFile, ['Read']);
    }
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('fail');
  });

  it('agent 文件缺失时返回 fail', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    // 只创建部分 agent 文件，缺少 verify.md 等
    writeAgentFile(tempDir, 'plan.md', ['Read']);
    const result = validateNamespaceConsistency(tempDir);
    expect(result.status).toBe('fail');
  });
});

describe('validateNamespaceConsistency — 真实项目集成检查', () => {
  it('当前仓库 5 个 agent 均使用正确 namespace（mcp__plugin_spectra_spectra__）', async () => {
    const { validateNamespaceConsistency } = await importNamespaceCore();
    const result = validateNamespaceConsistency(process.cwd());
    expect(result.status).toBe('pass');
    expect(result.errors).toHaveLength(0);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((c) => c.status === 'pass')).toBe(true);
  });
});
