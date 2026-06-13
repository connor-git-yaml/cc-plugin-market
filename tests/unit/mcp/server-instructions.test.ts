/**
 * F184 T001 — MCP server instructions（TOOL_GUIDE）内容与长度断言（FR-002 / FR-009）
 *
 * 验证 TOOL_GUIDE 常量本身的内容契约；wiring（是否真正进入 initialize result）由
 * stdio E2E feature-184-instructions.e2e.test.ts 经 client.getInstructions() 验证。
 */
import { describe, expect, it } from 'vitest';
import { TOOL_GUIDE } from '../../../src/mcp/server.js';

describe('F184 FR-002 — TOOL_GUIDE instructions 内容契约', () => {
  it('非空且长度 ≤ 1600 字符（server 级一次性导览，防上下文膨胀）', () => {
    expect(TOOL_GUIDE.length).toBeGreaterThan(0);
    expect(TOOL_GUIDE.length).toBeLessThanOrEqual(1600);
  });

  it('含典型链路串 detect_changes → impact → context → view_file', () => {
    expect(TOOL_GUIDE).toContain('detect_changes → impact → context → view_file');
  });

  it('含 graph-not-built 恢复流提示', () => {
    expect(TOOL_GUIDE).toContain('graph-not-built');
    // 恢复动作必须可执行：提示运行 spectra batch
    expect(TOOL_GUIDE).toContain('spectra batch');
  });

  it('覆盖四组工具的代表工具名（不硬编码工具总数）', () => {
    // 上下文导航
    for (const t of ['detect_changes', 'impact', 'context']) expect(TOOL_GUIDE).toContain(t);
    // 文件查看
    for (const t of ['view_file', 'search_in_file', 'list_directory']) expect(TOOL_GUIDE).toContain(t);
    // 图谱
    for (const t of ['graph_query', 'graph_node', 'graph_path']) expect(TOOL_GUIDE).toContain(t);
    // spec 生成
    for (const t of ['prepare', 'generate', 'batch', 'diff', 'panoramic-query']) expect(TOOL_GUIDE).toContain(t);
    // 不硬编码"17 工具"计数（降工具增减漂移）
    expect(TOOL_GUIDE).not.toContain('17 工具');
  });

  it('FR-009 — 含 ≥2 个任务→工具映射线索（避免虚绿）', () => {
    // 映射 1：影响面/blast radius → impact
    expect(TOOL_GUIDE).toContain('impact');
    expect(TOOL_GUIDE.includes('blast radius') || TOOL_GUIDE.includes('影响')).toBe(true);
    // 映射 2：symbol 定义/依赖 → context
    expect(TOOL_GUIDE).toContain('context');
    expect(TOOL_GUIDE.includes('定义')).toBe(true);
    // 映射 3：定位代码行 → view_file
    expect(TOOL_GUIDE.includes('定位') && TOOL_GUIDE.includes('view_file')).toBe(true);
  });
});
