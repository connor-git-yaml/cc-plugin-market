/**
 * namespace-consistency-core.mjs
 *
 * 从 plugin.json name + .mcp.json server key 派生期望 namespace，
 * 校验 spec-driver agent frontmatter 一致性。
 * 单一源派生守护，防止人工错改 frontmatter。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 从 YAML frontmatter 中提取 tools 数组。
 * 支持三种格式：
 *   1. 行内数组（无引号）：tools: [Read, mcp__plugin_spectra_spectra__context]
 *   2. 行内数组（带引号）：tools: ["Read", "mcp__plugin_spectra_spectra__context"]
 *   3. YAML block sequence：
 *        tools:
 *          - Read
 *          - mcp__plugin_spectra_spectra__context
 * @returns {string[]} tool 名称列表，若无 frontmatter 或无 tools 则返回 []
 */
function extractFrontmatterTools(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const fmText = fmMatch[1];

  // 格式 1 & 2：行内数组 tools: [...]
  const inlineMatch = fmText.match(/^tools:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  // 格式 3：YAML block sequence
  const blockMatch = fmText.match(/^tools:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split('\n')
      .map((line) => line.replace(/^[ \t]+-[ \t]+/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  return [];
}

/**
 * 从 plugin.json + .mcp.json 派生期望 namespace 前缀。
 * 公式：mcp__plugin_{pluginName}_{serverKey}__
 * 仅支持单 server（多 server 时 fail-loud）。
 */
export function deriveExpectedNamespace(projectRoot) {
  const pluginJsonPath = path.join(
    projectRoot,
    'plugins/spectra/.claude-plugin/plugin.json',
  );
  const mcpJsonPath = path.join(projectRoot, 'plugins/spectra/.mcp.json');

  if (!fs.existsSync(pluginJsonPath)) {
    throw new Error(`plugin.json 不存在：${pluginJsonPath}`);
  }
  if (!fs.existsSync(mcpJsonPath)) {
    throw new Error(`.mcp.json 不存在：${mcpJsonPath}`);
  }

  const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
  const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));

  const pluginName = pluginJson.name;
  if (!pluginName) {
    throw new Error('plugin.json 缺少 name 字段');
  }

  const serverKeys = Object.keys(mcpJson.mcpServers ?? {});
  if (serverKeys.length === 0) {
    throw new Error('.mcp.json 的 mcpServers 为空');
  }
  if (serverKeys.length > 1) {
    throw new Error(
      `.mcp.json 含多个 mcpServers（${serverKeys.join(', ')}），namespace 派生需明确指定目标 server`,
    );
  }
  const serverKey = serverKeys[0];

  return `mcp__plugin_${pluginName}_${serverKey}__`;
}

const AGENT_FILES = [
  'plan.md',
  'implement.md',
  'verify.md',
  'spec-review.md',
  'quality-review.md',
];

/**
 * 验证 spec-driver agent frontmatter namespace 一致性。
 * 这 5 个受保护 agent 文件必须包含至少一个正确 namespace 的 MCP 工具——
 * 无 MCP 工具视为配置缺失（FAIL），而非 skip。
 */
export function validateNamespaceConsistency(projectRoot) {
  const checks = [];
  const errors = [];
  const warnings = [];

  let expectedNamespace;
  try {
    expectedNamespace = deriveExpectedNamespace(projectRoot);
  } catch (err) {
    errors.push(`无法派生期望 namespace：${err.message}`);
    return { status: 'fail', checks, warnings, errors };
  }

  const agentsDir = path.join(projectRoot, 'plugins/spec-driver/agents');

  for (const agentFile of AGENT_FILES) {
    const agentPath = path.join(agentsDir, agentFile);
    const checkId = `agent-frontmatter-${agentFile.replace('.md', '')}`;

    if (!fs.existsSync(agentPath)) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { missing: agentPath },
      });
      errors.push(`${agentFile} 不存在`);
      continue;
    }

    const content = fs.readFileSync(agentPath, 'utf-8');
    const tools = extractFrontmatterTools(content);
    const mcpTools = tools.filter((t) => t.startsWith('mcp__'));

    // CRITICAL：这 5 个 agent 文件必须含 MCP 工具，缺失视为配置错误
    if (mcpTools.length === 0) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { note: '未找到 mcp__ 前缀工具，受保护 agent 必须包含 Spectra MCP 工具' },
      });
      errors.push(`${agentFile} 未找到任何 mcp__ 工具（受保护 agent 必须包含 Spectra MCP 工具）`);
      continue;
    }

    const wrongNamespace = mcpTools.filter((t) => !t.startsWith(expectedNamespace));

    if (wrongNamespace.length > 0) {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'fail',
        evidence: { expectedNamespace, wrongTools: wrongNamespace },
      });
      errors.push(
        `${agentFile} 含非期望 namespace 工具：${wrongNamespace.join(', ')}（期望前缀：${expectedNamespace}）`,
      );
    } else {
      checks.push({
        id: checkId,
        title: `${agentFile} namespace 一致性`,
        status: 'pass',
        evidence: { expectedNamespace, mcpTools },
      });
    }
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  return {
    status: hasFail ? 'fail' : 'pass',
    checks,
    warnings,
    errors,
  };
}
