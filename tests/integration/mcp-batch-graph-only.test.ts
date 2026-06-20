/**
 * Feature 202 — MCP batch 工具 graph-only 模式 集成测试（T009）
 *
 * 验证 MCP handler 路径真实产出 F193 portable graph：
 *   - schemaVersion === '2.0'（FR-006）
 *   - 无绝对路径节点（F193 portable 守卫）
 *   - nodeCount > 0（fixture 非空）
 *   - 零 LLM：不配置任何 LLM 凭据仍跑通即为证（见断言注释）
 *
 * 不 mock `../../src/batch/batch-orchestrator.js`（用真实 buildAstGraphOnly）。
 * 仍 mock `@modelcontextprotocol/sdk/server/mcp.js`（FakeMcpServer 范式捕获 handler）。
 *
 * 红态（改 server.ts 之前）：handler 无 graph-only 分支 → 落入 runBatch(mode='graph-only')
 *   → runBatch validModes 抛错 / 返回 isError=true → 集成断言未通过（schemaVersion 无法读取）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ─────────────────────────────────────────────────────────────
// FakeMcpServer：与 mcp-server.test.ts 同范式
// 用 vi.hoisted 确保在 vi.mock 工厂函数中可引用
// ─────────────────────────────────────────────────────────────
const hoistedTypes = vi.hoisted(() => ({
  FakeMcpServer: class FakeMcpServer {
    public config: Record<string, unknown>;
    public tools: Array<{
      name: string;
      description: string;
      schema: Record<string, unknown>;
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>;
    }> = [];

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }

    tool(
      name: string,
      description: string,
      schema: Record<string, unknown>,
      handler: (args: Record<string, unknown>) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      }>,
    ): void {
      this.tools.push({ name, description, schema, handler });
    }
  },
}));

// mock SDK——FakeMcpServer 捕获 tool 注册，从而能拿到 handler
// 不 mock batch-orchestrator.js（用真实 buildAstGraphOnly）
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: hoistedTypes.FakeMcpServer,
}));

// 其余依赖与 unit 测试保持一致（project-config 无副作用 mock，防止读盘失败）
vi.mock('../../src/config/project-config.js', () => ({
  loadProjectConfig: vi.fn(() => ({})),
}));

import { createMcpServer } from '../../src/mcp/server.js';

// ─────────────────────────────────────────────────────────────
// 辅助：在 server.tools 中找到指定 name 的 tool
// ─────────────────────────────────────────────────────────────
function findTool(
  server: InstanceType<typeof hoistedTypes.FakeMcpServer>,
  name: string,
): (typeof server.tools)[number] {
  const tool = server.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool "${name}" not found`);
  return tool;
}

// ─────────────────────────────────────────────────────────────
// 图谱文件的节点路径字段说明（开发者文档）：
//
// `GraphNode.id` 是主要路径标识字段，格式：
//   - 纯模块节点：`<repo-relative-filePath>`（如 "src/a.ts"）
//   - symbol 节点：`<repo-relative-filePath>::<symbolName>`（如 "src/a.ts::a"）
//
// F193 portable 守卫：`isAbsoluteForeignPath(filePartOf(node.id))`
//   → 若 id 的文件部分以 '/' 开头（POSIX 绝对路径）或含 Windows 盘符，则计入违例。
//
// 本集成测试断言"绝对路径节点计数 = 0"即验证 F193 守卫已生效。
// ─────────────────────────────────────────────────────────────

describe('MCP batch 工具 graph-only 集成测试（T009）', () => {
  let tmpDir: string;
  // 零 LLM oracle（Codex W-003 强化）：跑前清空所有 LLM 凭据 env，跑后恢复，
  // 使"无凭据仍跑通"成为真实可执行 oracle 而非仅靠注释。
  const LLM_ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY'];
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    // 备份并清空 LLM 凭据，确保 graph-only 路径在零凭据下运行
    savedEnv = {};
    for (const k of LLM_ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    // 创建独立临时目录，写入 1-2 个最小 .ts 文件制造非空 call graph
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'spectra-f202-'));
    // a.ts 内含两个函数：a() 内部调用 b() → 产生文件内 calls 边（单文件即足以建非空图）
    await fsp.writeFile(
      path.join(tmpDir, 'a.ts'),
      `export function a(): number { return b(); }\nexport function b(): number { return 1; }\n`,
      'utf8',
    );
  });

  afterEach(async () => {
    // 恢复 LLM 凭据 env
    for (const k of LLM_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    // 清理临时目录，不污染仓库和系统 tmp
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('graph-only 模式产出合法 portable graph（schemaVersion=2.0，零绝对路径节点，nodeCount>0）', async () => {
    const server = createMcpServer() as unknown as InstanceType<typeof hoistedTypes.FakeMcpServer>;
    const batchTool = findTool(server, 'batch');

    // 调 handler：真实 buildAstGraphOnly 走完 AST 采集 → 建图 → 写盘管线
    // 零 LLM oracle（Codex W-003）：本测试不配置任何 LLM 凭据（ANTHROPIC_API_KEY 等未设置）
    // 仍能跑通即证明 graph-only 路径零 LLM。配合单元用例 A 的 `runBatch.not.toHaveBeenCalled()`
    // 构成零 LLM 的双向证据（runBatch 是唯一 LLM 路径）。
    const result = await batchTool.handler({
      projectRoot: tmpDir,
      mode: 'graph-only',
    });

    // 断言 1：handler 不报错
    expect(result.isError).toBeUndefined();

    // 断言 2：返回体包含 graphPath 且 nodeCount > 0
    expect(result.content).toHaveLength(1);
    type GraphOnlyResult = {
      graphPath: string;
      nodeCount: number;
      edgeCount: number;
      callEdgeCount: number;
      dependsOnEdgeCount: number;
      pythonSymbolCount: number;
      durationMs: number;
    };
    const parsed = JSON.parse(result.content[0]!.text) as GraphOnlyResult;
    expect(parsed.graphPath).toBeTruthy();          // graphPath 字段存在
    expect(typeof parsed.graphPath).toBe('string');
    expect(parsed.nodeCount).toBeGreaterThan(0);    // 至少有 1 个 module/symbol 节点

    // 断言 2b（Codex W-002 强化）：graphPath MUST 落在 tmpDir 内——
    // 防止实现误用 process.cwd() 产出仓库自身 graph 仍让断言通过（假阳性 oracle）。
    const rel = path.relative(tmpDir, parsed.graphPath);
    expect(rel.startsWith('..'), `graphPath 应在 tmpDir 内，实际 rel=${rel}`).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);

    // 断言 3：读取 graphPath 文件，schema 版本 = 2.0（FR-006）
    //
    // 文件结构：GraphJSON（来自 graph-types.ts / graph-builder.ts）
    //   { directed, multigraph, graph: { schemaVersion, ... }, nodes, links, ... }
    //
    // schemaVersion 在 graph.graph.schemaVersion（嵌套在 graph 的元数据对象中）
    expect(fs.existsSync(parsed.graphPath)).toBe(true);
    const graphFileContent = fs.readFileSync(parsed.graphPath, 'utf8');
    type GraphJSON = {
      graph: { schemaVersion: string; nodeCount: number };
      nodes: Array<{ id: string; kind: string; label: string; metadata: Record<string, unknown> }>;
      links: Array<{ source: string; target: string; relation: string }>;
    };
    const graphFile = JSON.parse(graphFileContent) as GraphJSON;
    expect(graphFile.graph.schemaVersion).toBe('2.0');
    // 图元数据 nodeCount 与节点数双层一致性（Codex quality INFO：避免死类型字段）
    expect(graphFile.graph.nodeCount).toBeGreaterThan(0);

    // 断言 4：遍历 graph.nodes，无任何节点的 id 路径部分为绝对路径（F193 portable 守卫）
    //
    // node.id 格式：
    //   - 模块节点：`<filePath>`（如 "a.ts" 或 "src/a.ts"，相对路径）
    //   - symbol 节点：`<filePath>::<symbolName>`（如 "a.ts::a"）
    //
    // 绝对路径判断：以 '/' 开头（POSIX）或含 Windows 盘符（/^[A-Za-z]:/）
    // 本断言与 isAbsoluteForeignPath 判断口径一致
    let absolutePathNodeCount = 0;
    const absolutePathSamples: string[] = [];
    for (const node of graphFile.nodes) {
      const idFilePart = node.id.includes('::') ? node.id.slice(0, node.id.indexOf('::')) : node.id;
      const isAbsolute =
        idFilePart.startsWith('/') ||             // POSIX 绝对路径
        /^[a-zA-Z]:[/\\]/.test(idFilePart) ||    // Windows 盘符
        idFilePart.startsWith('\\\\');            // UNC 路径
      if (isAbsolute) {
        absolutePathNodeCount += 1;
        if (absolutePathSamples.length < 3) absolutePathSamples.push(node.id);
      }
    }
    // F193 portable 守卫：绝对路径节点计数必须为 0
    expect(absolutePathNodeCount).toBe(0);

    // 断言 5（Codex W-002 强化）：图谱确实来自本 fixture——节点应含 fixture 文件 a.ts，
    // 进一步排除"误产出仓库自身 graph 仍通过"的假阳性。
    const hasFixtureNode = graphFile.nodes.some((n) => {
      const filePart = n.id.includes('::') ? n.id.slice(0, n.id.indexOf('::')) : n.id;
      return filePart === 'a.ts' || filePart.endsWith('/a.ts');
    });
    expect(hasFixtureNode, 'graph 节点应含 fixture 文件 a.ts').toBe(true);
  });
});
