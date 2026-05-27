/**
 * F170c T-RED-1 — Tool description 4 要素静态结构 e2e test（SC-001 / FR-001/002/003/005）
 *
 * 通过 mock McpServer 捕获 registerAgentContextTools 注册时传入的 description string，
 * 然后逐 tool 断言 5 项硬约束 (a)-(e)。
 */

import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentContextTools } from '../../src/mcp/agent-context-tools.js';

interface CapturedTool {
  name: string;
  description: string;
  schema: unknown;
  handler: unknown;
}

function captureTools(): CapturedTool[] {
  const captured: CapturedTool[] = [];
  const mockServer = {
    tool: (name: string, description: string, schema: unknown, handler: unknown) => {
      captured.push({ name, description, schema, handler });
    },
  } as unknown as McpServer;
  registerAgentContextTools(mockServer);
  return captured;
}

const TARGET_TOOLS = ['impact', 'context', 'detect_changes'] as const;

describe('F170c SC-001 — tool description 4 要素结构', () => {
  it('注册了 3 个 agent-context tool', () => {
    const tools = captureTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['context', 'detect_changes', 'impact']);
  });

  for (const toolName of TARGET_TOOLS) {
    describe(`tool: ${toolName}`, () => {
      it(`(a) description 长度位于 [100, 300] 字符区间`, () => {
        const tool = captureTools().find((t) => t.name === toolName);
        expect(tool, `tool ${toolName} 应已注册`).toBeDefined();
        const len = tool!.description.length;
        expect(len, `${toolName} description 长度 ${len}，需要 ∈ [100, 300]`).toBeGreaterThanOrEqual(100);
        expect(len, `${toolName} description 长度 ${len}，需要 ∈ [100, 300]`).toBeLessThanOrEqual(300);
      });

      it(`(b) 首段含核心功能 lead-in（长度 ≥ 10 字符）`, () => {
        const tool = captureTools().find((t) => t.name === toolName);
        const firstLine = tool!.description.split('\n')[0].trim();
        expect(firstLine.length, `${toolName} lead-in 首行长度 ${firstLine.length}，需要 ≥ 10`).toBeGreaterThanOrEqual(10);
      });

      it(`(c) 含 "Use this tool when" 段且枚举 ≥ 3 个 use-case`, () => {
        const tool = captureTools().find((t) => t.name === toolName);
        expect(tool!.description, `${toolName} 缺 "Use this tool when" 段`).toContain('Use this tool when');
        // 简单计数：行内含 "-" 或 "•" 前缀的项数 ≥ 3
        const lines = tool!.description.split('\n');
        const useCaseStart = lines.findIndex((l) => l.includes('Use this tool when'));
        const afterUseCase = lines.slice(useCaseStart + 1);
        const exampleStart = afterUseCase.findIndex((l) => l.includes('Example'));
        const useCaseLines = exampleStart >= 0 ? afterUseCase.slice(0, exampleStart) : afterUseCase;
        const bulletCount = useCaseLines.filter((l) => /^[\s]*[-•*]/.test(l)).length;
        expect(bulletCount, `${toolName} Use this tool when 段需 ≥ 3 个 bullet，实际 ${bulletCount}`).toBeGreaterThanOrEqual(3);
      });

      it(`(d) 含 "Example" 段含 input/output 示例`, () => {
        const tool = captureTools().find((t) => t.name === toolName);
        expect(tool!.description, `${toolName} 缺 "Example" 段`).toContain('Example');
      });

      it(`(e) 含 "Typical chained usage" 段且至少 1 个 chain 示例`, () => {
        const tool = captureTools().find((t) => t.name === toolName);
        expect(tool!.description, `${toolName} 缺 "Typical chained usage" 段`).toContain('Typical chained usage');
      });
    });
  }

  it('(e) impact 的 chained usage 段中必含 "detect_changes → impact → context" 标准链路（修订：响应 codex W1，链路顺序断言）', () => {
    const tool = captureTools().find((t) => t.name === 'impact');
    const desc = tool!.description;
    // 抽取 "Typical chained usage" 段（从该 header 到下一个 header 或文末）
    const chainSectionMatch = desc.match(/Typical chained usage[:\s]*([\s\S]+?)(?=\n\n[A-Z]|$)/);
    expect(chainSectionMatch, 'impact description 必须含 Typical chained usage 段').not.toBeNull();
    const chainSection = chainSectionMatch![1];
    // 精确链路顺序断言：detect_changes → impact → context（允许 → / -> 两种箭头）
    const linkPattern = /detect_changes\s*(?:→|->)\s*impact\s*(?:→|->)\s*context/;
    expect(chainSection, `impact chained usage 段必须含标准链路 "detect_changes → impact → context"（允许 →或->）；实际段内容：${chainSection.slice(0, 200)}`).toMatch(linkPattern);
  });
});
