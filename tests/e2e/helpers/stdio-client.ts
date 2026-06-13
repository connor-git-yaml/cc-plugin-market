/**
 * stdio MCP client 共享 spawn 工厂
 *
 * 封装 StdioClientTransport + Client 初始化样板，
 * 各测试文件只需传 cwd + env，无需重复实现 spawn 逻辑。
 * tempRoot 生命周期由调用方的 afterAll 负责。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { relativizeSymbolId } from '../../../src/knowledge-graph/relativize.js';

// ── 路径常量（所有测试文件复用这些值）──
export const PROJECT_ROOT = resolve('.');
export const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
export const BASELINE_GRAPH = join(
  homedir(),
  '.spectra-baselines',
  'micrograd-output',
  'spectra-full',
  '_meta',
  'graph.json',
);
export const MICROGRAD_SOURCE = join(homedir(), '.spectra-baselines', 'micrograd');

/**
 * Feature 193 — 把旧绝对 id baseline graph 相对化为 repo-relative POSIX 后写入目标路径。
 *
 * 旧 baseline（micrograd-output）含 MICROGRAD_SOURCE 前缀的绝对 node id；Feature 193
 * 起 producer 侧产出相对 id，加载期对非当前 projectRoot 前缀的绝对 id 报 graph-format-stale。
 * E2E 测试不再直接 copyFileSync 旧绝对图，改用本 helper 转成新相对格式（模拟主仓 copy
 * 的图已是新格式），让 17 工具在**相对 id 格式**下验证零回归（FR-017 + W5 矩阵）。
 *
 * @param destGraphPath 目标 graph.json 路径
 * @param base 相对化基准（= MICROGRAD_SOURCE）
 */
export function installRelativizedBaseline(destGraphPath: string, base: string = MICROGRAD_SOURCE): void {
  const raw = JSON.parse(readFileSync(BASELINE_GRAPH, 'utf-8')) as {
    nodes: Array<{ id: string; metadata?: Record<string, unknown> }>;
    links: Array<{ source: string; target: string }>;
    [k: string]: unknown;
  };
  for (const n of raw.nodes) {
    const r = relativizeSymbolId(n.id, base);
    n.id = r.value;
    if (r.external) n.metadata = { ...n.metadata, external: true };
  }
  for (const l of raw.links) {
    l.source = relativizeSymbolId(l.source, base).value;
    l.target = relativizeSymbolId(l.target, base).value;
  }
  writeFileSync(destGraphPath, JSON.stringify(raw, null, 2), 'utf-8');
}

// ── skip 条件工具 ──
export function buildSkipCondition(requireBaseline: boolean): boolean {
  if (!existsSync(DIST_CLI)) return true;
  if (requireBaseline && !existsSync(BASELINE_GRAPH)) return true;
  return false;
}

export function buildSkipReason(requireBaseline: boolean): string {
  const reasons: string[] = [];
  if (!existsSync(DIST_CLI)) reasons.push(`dist/cli/index.js 不存在（先 npm run build）`);
  if (requireBaseline && !existsSync(BASELINE_GRAPH)) {
    reasons.push(`micrograd baseline 不存在 (${BASELINE_GRAPH})`);
  }
  return reasons.join('; ');
}

// ── spawn 工厂入参与返回类型 ──
export interface SpawnMcpClientOpts {
  cwd: string;
  env?: Record<string, string>;
}

export interface McpClientHandle {
  client: Client;
  transport: StdioClientTransport;
  cleanup: () => Promise<void>;
}

/**
 * 启动 MCP stdio 子进程，返回已连接的 client handle。
 * cleanup 只关闭 client；tempRoot 删除由调用方负责。
 * env 默认合并 SPECTRA_DEV_DISABLE=1 + CI=1，再覆盖 opts.env。
 */
export async function spawnMcpClient(opts: SpawnMcpClientOpts): Promise<McpClientHandle> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SPECTRA_DEV_DISABLE: '1',
    CI: '1',
    ...opts.env,
  };

  const transport = new StdioClientTransport({
    command: 'node',
    args: [DIST_CLI, 'mcp-server'],
    env,
    cwd: opts.cwd,
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'f180-e2e-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    transport,
    cleanup: async () => {
      await client.close();
    },
  };
}
