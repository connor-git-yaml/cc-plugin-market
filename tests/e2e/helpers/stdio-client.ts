/**
 * stdio MCP client 共享 spawn 工厂
 *
 * 封装 StdioClientTransport + Client 初始化样板，
 * 各测试文件只需传 cwd + env，无需重复实现 spawn 逻辑。
 * tempRoot 生命周期由调用方的 afterAll 负责。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
