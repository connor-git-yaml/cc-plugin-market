/**
 * Feature 162 Phase C — sub-agent-meta.mjs 单元测试
 *
 * 覆盖（plan §2.4.5 + §2.6.2）：
 *   - injectSubAgentMetaEnv：env vars 正确序列化
 *   - readEnvInjectedMeta：解析 env 字段（含 list 反序列化）
 *   - parseSubAgentSelfReport：从 plugin.json 回显抽 version + tools + load-source
 *   - mergeSubAgentMeta confidence 6 状态：merged / self-report / self-report-only / env-only / mixed / absent
 *   - mergeSubAgentMeta collectIssues：双源 version 不一致 → 记 mismatch
 *   - deriveInheritanceStatus：3 状态各 ≥ 1 case
 */
import { describe, it, expect } from 'vitest';
import {
  injectSubAgentMetaEnv,
  readEnvInjectedMeta,
  parseSubAgentSelfReport,
  mergeSubAgentMeta,
  deriveInheritanceStatus,
  compareSemver,
} from '../../scripts/lib/sub-agent-meta.mjs';

describe('compareSemver', () => {
  it('正常比较', () => {
    expect(compareSemver('4.1.0', '4.0.5')).toBe(1);
    expect(compareSemver('4.0.0', '4.1.0')).toBe(-1);
    expect(compareSemver('4.1.0', '4.1.0')).toBe(0);
    expect(compareSemver('4.10.0', '4.2.0')).toBe(1);
  });

  it('格式异常抛错', () => {
    expect(() => compareSemver('foo', '4.1.0')).toThrow();
    expect(() => compareSemver('4.1', '4.1.0')).toThrow();
  });
});

describe('injectSubAgentMetaEnv + readEnvInjectedMeta', () => {
  it('全字段往返序列化', () => {
    const patch = injectSubAgentMetaEnv({
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit', 'Bash'],
      loadSource: 'marketplace',
    });
    expect(patch.SPECTRA_PLUGIN_VERSION).toBe('4.1.0');
    expect(patch.SPECTRA_PLUGIN_FRONTMATTER_TOOLS).toBe('Read,Edit,Bash');
    expect(patch.SPECTRA_PLUGIN_LOAD_SOURCE).toBe('marketplace');

    const decoded = readEnvInjectedMeta({ env: patch });
    expect(decoded).toEqual({
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit', 'Bash'],
      loadSource: 'marketplace',
    });
  });

  it('全部字段缺失 → null', () => {
    const decoded = readEnvInjectedMeta({ env: { OTHER: 'foo' } });
    expect(decoded).toBeNull();
  });
});

describe('parseSubAgentSelfReport', () => {
  it('从 plugin.json 回显抽 version', () => {
    const stdout = `
[Read] plugins/spec-driver/.claude-plugin/plugin.json
{
  "name": "spec-driver",
  "version": "4.1.0",
  "description": "..."
}
    `;
    const result = parseSubAgentSelfReport({ subAgentStdout: stdout });
    expect(result?.specDriverVersion).toBe('4.1.0');
  });

  it('解析 tools + load-source 复述句式', () => {
    const stdout = `
plugin version: 4.1.0
frontmatter-tools: Read, Edit, Bash, Grep
load-source: marketplace
    `;
    const result = parseSubAgentSelfReport({ subAgentStdout: stdout });
    expect(result?.specDriverVersion).toBe('4.1.0');
    expect(result?.frontmatterTools).toEqual(['Read', 'Edit', 'Bash', 'Grep']);
    expect(result?.loadSource).toBe('marketplace');
  });

  it('全部字段缺失 → null', () => {
    expect(parseSubAgentSelfReport({ subAgentStdout: 'nothing here' })).toBeNull();
    expect(parseSubAgentSelfReport({ subAgentStdout: '' })).toBeNull();
  });

  it('Feature 166 W-2: NDJSON 格式 stream-json stdout 中 tool_result 含 plugin.json → 提取 version', () => {
    // 模拟 claude CLI --output-format stream-json --verbose 输出
    // assistant 调 Read 工具 → user 事件中含 tool_result，content 是 plugin.json 内容（JSON-encoded）
    const pluginJsonContent = JSON.stringify({
      name: 'spec-driver',
      version: '4.1.0',
      description: '...',
    }, null, 2);
    const ndjsonLines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '我会读取 plugin.json 检查版本' },
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'plugins/spec-driver/.claude-plugin/plugin.json' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: pluginJsonContent }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'frontmatter-tools: Read, Edit, Bash\nload-source: marketplace' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.5 }),
    ];
    const stdout = ndjsonLines.join('\n');
    const result = parseSubAgentSelfReport({ subAgentStdout: stdout });
    expect(result?.specDriverVersion).toBe('4.1.0');
    expect(result?.frontmatterTools).toEqual(['Read', 'Edit', 'Bash']);
    expect(result?.loadSource).toBe('marketplace');
  });

  it('Feature 166 W-2: NDJSON 中 tool_result content 是 array 形式（Anthropic SDK 兼容）→ 也能提取', () => {
    const ndjsonLines = [
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu1',
              content: [{ type: 'text', text: '{"version": "5.0.0"}' }],
            },
          ],
        },
      }),
    ];
    const result = parseSubAgentSelfReport({ subAgentStdout: ndjsonLines.join('\n') });
    expect(result?.specDriverVersion).toBe('5.0.0');
  });

  it('Feature 166 W-2: NDJSON 解析失败时降级为原文本匹配（向后兼容）', () => {
    // 首行像 NDJSON 但解析失败 → 走原文本路径
    const stdout = '{"type":"asst 不完整\n"version": "3.2.1"';
    const result = parseSubAgentSelfReport({ subAgentStdout: stdout });
    expect(result?.specDriverVersion).toBe('3.2.1');
  });
});

describe('mergeSubAgentMeta confidence 状态机', () => {
  it('merged: 双源 version 一致 + 全字段命中 → merged', () => {
    const envMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit'],
      loadSource: 'marketplace',
    };
    const selfReportMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit'],
      loadSource: 'marketplace',
    };
    const { meta, collectIssues } = mergeSubAgentMeta({ envMeta, selfReportMeta });
    expect(meta.confidence).toBe('merged');
    expect(meta.collectedVia).toBe('merged');
    expect(collectIssues).toEqual([]);
  });

  it('self-report-only: env 缺失 → self-report-only', () => {
    const selfReportMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read'],
      loadSource: 'local',
    };
    const { meta } = mergeSubAgentMeta({ envMeta: null, selfReportMeta });
    expect(meta.confidence).toBe('self-report-only');
    expect(meta.collectedVia).toBe('first-tool-call');
    expect(meta.specDriverVersion).toBe('4.1.0');
  });

  it('env-only: self-report 缺失 → env-only', () => {
    const envMeta = {
      specDriverVersion: '4.0.5',
      frontmatterTools: ['Read'],
      loadSource: 'cache',
    };
    const { meta } = mergeSubAgentMeta({ envMeta, selfReportMeta: null });
    expect(meta.confidence).toBe('env-only');
    expect(meta.collectedVia).toBe('env');
    expect(meta.specDriverVersion).toBe('4.0.5');
  });

  it('mixed: self-report 仅 version, tools/loadSource 来自 env', () => {
    const envMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit'],
      loadSource: 'marketplace',
    };
    const selfReportMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: null,
      loadSource: null,
    };
    const { meta, collectIssues } = mergeSubAgentMeta({ envMeta, selfReportMeta });
    expect(meta.confidence).toBe('mixed');
    expect(meta.collectedVia).toBe('first-tool-call');
    expect(meta.specDriverVersion).toBe('4.1.0');
    // tools / loadSource 字段从 env 拿到
    expect(meta.frontmatterTools).toEqual(['Read', 'Edit']);
    expect(meta.loadSource).toBe('marketplace');
    // version 一致 → 不应有 mismatch
    expect(collectIssues).toEqual([]);
  });

  it('mismatch + chosen=self-report：双源 version 不一致 → 记 collectIssues', () => {
    const envMeta = {
      specDriverVersion: '4.0.5',
      frontmatterTools: ['Read'],
      loadSource: 'cache',
    };
    const selfReportMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit'],
      loadSource: 'marketplace',
    };
    const { meta, collectIssues } = mergeSubAgentMeta({ envMeta, selfReportMeta });
    expect(meta.specDriverVersion).toBe('4.1.0');
    expect(collectIssues).toHaveLength(1);
    expect(collectIssues[0]).toMatchObject({
      type: 'subAgentMeta-mismatch',
      envVersion: '4.0.5',
      selfReportVersion: '4.1.0',
      chosen: 'self-report',
    });
    expect(collectIssues[0].reason).toContain('版本不一致');
  });

  it('self-report: env 存在但全字段被 self-report 覆盖 + 双源 version 不一致 → confidence=self-report', () => {
    // iter-2 W-3 补测：第 6 confidence 状态（与 self-report-only 区别在 env 是否存在）
    // 当 env 也提供数据但 self-report 全覆盖且 version 冲突时，merge 保留
    // confidence='self-report'（不升级为 merged 也不退回 self-report-only）。
    const envMeta = {
      specDriverVersion: '4.0.5',
      frontmatterTools: ['Read'],
      loadSource: 'cache',
    };
    const selfReportMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read', 'Edit'],
      loadSource: 'marketplace',
    };
    const { meta, collectIssues } = mergeSubAgentMeta({ envMeta, selfReportMeta });
    expect(meta.confidence).toBe('self-report');
    expect(meta.collectedVia).toBe('first-tool-call');
    // self-report 全覆盖
    expect(meta.specDriverVersion).toBe('4.1.0');
    expect(meta.frontmatterTools).toEqual(['Read', 'Edit']);
    expect(meta.loadSource).toBe('marketplace');
    // version 不一致触发 mismatch 记录
    expect(collectIssues).toHaveLength(1);
    expect(collectIssues[0].type).toBe('subAgentMeta-mismatch');
  });

  it('absent: 双源都缺 → absent', () => {
    const { meta, collectIssues } = mergeSubAgentMeta({
      envMeta: null,
      selfReportMeta: null,
    });
    expect(meta.confidence).toBe('absent');
    expect(meta.collectedVia).toBe('absent');
    expect(meta.specDriverVersion).toBeNull();
    expect(collectIssues).toEqual([]);
  });
});

describe('deriveInheritanceStatus 三状态', () => {
  it('available: mcpToolCalls.length > 0 + 无 unavailable 信号', () => {
    const subAgentMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read'],
      loadSource: 'marketplace',
      collectedVia: 'merged',
      confidence: 'merged',
    };
    const mcpToolCalls = [
      { tool: 'mcp__spectra__context', success: true, error: null, responseBytes: 1234, timestamp: '2026-05-10T10:00:00Z' },
    ];
    expect(deriveInheritanceStatus({ subAgentMeta, mcpToolCalls })).toBe('available');
  });

  it('available（version-based）: version >=4.1.0 + length=0', () => {
    const subAgentMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read'],
      loadSource: 'marketplace',
      collectedVia: 'env',
      confidence: 'env-only',
    };
    expect(
      deriveInheritanceStatus({ subAgentMeta, mcpToolCalls: [] }),
    ).toBe('available');
  });

  it('available（mixed confidence）: mixed 视为可信 + version>=4.1.0', () => {
    const subAgentMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read'],
      loadSource: 'marketplace',
      collectedVia: 'first-tool-call',
      confidence: 'mixed',
    };
    expect(
      deriveInheritanceStatus({ subAgentMeta, mcpToolCalls: [] }),
    ).toBe('available');
  });

  it('unavailable: mcpToolCalls 含 error=tool-not-available', () => {
    const subAgentMeta = {
      specDriverVersion: '4.1.0',
      frontmatterTools: ['Read'],
      loadSource: 'marketplace',
      collectedVia: 'merged',
      confidence: 'merged',
    };
    const mcpToolCalls = [
      { tool: 'mcp__spectra__context', success: false, error: 'tool-not-available', responseBytes: 0, timestamp: '2026-05-10T10:00:00Z' },
    ];
    expect(deriveInheritanceStatus({ subAgentMeta, mcpToolCalls })).toBe('unavailable');
  });

  it('unavailable: version < 4.1.0', () => {
    const subAgentMeta = {
      specDriverVersion: '4.0.5',
      frontmatterTools: ['Read'],
      loadSource: 'cache',
      collectedVia: 'env',
      confidence: 'env-only',
    };
    expect(
      deriveInheritanceStatus({ subAgentMeta, mcpToolCalls: [] }),
    ).toBe('unavailable');
  });

  it('unknown: 双源均缺（confidence=absent）+ mcpToolCalls.length=0', () => {
    const subAgentMeta = {
      specDriverVersion: null,
      frontmatterTools: null,
      loadSource: null,
      collectedVia: 'absent',
      confidence: 'absent',
    };
    expect(
      deriveInheritanceStatus({ subAgentMeta, mcpToolCalls: [] }),
    ).toBe('unknown');
  });

  it('unknown: subAgentMeta=null 且 mcpToolCalls.length=0', () => {
    expect(
      deriveInheritanceStatus({ subAgentMeta: null, mcpToolCalls: [] }),
    ).toBe('unknown');
  });
});
