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
  PROJECT_ROOT,
  'tests',
  'fixtures',
  'micrograd-baseline-graph',
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
 * @throws {Error} `BASELINE_GRAPH`（in-repo pinned fixture）缺失时立即抛错——该 fixture
 *   随 git 提交，理论上恒存在；缺失只可能是检出不完整（浅 clone/稀疏检出漏了 tests/fixtures/）
 *   或提交遗漏，不应被 skip 机制掩盖成"环境未就绪"的静默跳过
 */
export function installRelativizedBaseline(destGraphPath: string, base: string = MICROGRAD_SOURCE): void {
  if (!existsSync(BASELINE_GRAPH)) {
    throw new Error(
      `pinned fixture 缺失: ${BASELINE_GRAPH} —— 该文件应随 git 提交恒存在，` +
      `缺失说明检出不完整或漏提交，非"baseline 未采集"的可 skip 场景。` +
      `参见 tests/fixtures/micrograd-baseline-graph/README.md 的再生步骤重新生成。`,
    );
  }
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
// F215 起两条件语义拆分（Codex 对抗审查 CRITICAL-1 修复）：
//   - dist（DIST_CLI）：硬前置，所有 stdio 子进程用例都需要，缺失必 skip
//   - requireMicrogradSource：仅当套件需要从 MICROGRAD_SOURCE 源 clone 里拷贝 .py 源文件
//     （如 file-nav-stdio / symbol-chain / view-file-fuzzy / batch-repro）才传 true；
//     `BASELINE_GRAPH`（in-repo pinned fixture）不参与 skip 判定——它随 git 提交恒存在，
//     缺失属检出/提交问题，由 installRelativizedBaseline 的 fail-fast 直接抛错，
//     不应被这里的 skip 逻辑掩盖
/**
 * @param requireMicrogradSource 套件是否需要从 `~/.spectra-baselines/micrograd` 源 clone
 *   拷贝 `.py` 源文件；仅读 in-repo fixture（`BASELINE_GRAPH`）的纯图套件应传 `false`
 */
export function buildSkipCondition(requireMicrogradSource: boolean): boolean {
  if (!existsSync(DIST_CLI)) return true;
  if (requireMicrogradSource && !existsSync(MICROGRAD_SOURCE)) return true;
  return false;
}

/**
 * @param requireMicrogradSource 同 {@link buildSkipCondition}
 */
export function buildSkipReason(requireMicrogradSource: boolean): string {
  const reasons: string[] = [];
  if (!existsSync(DIST_CLI)) reasons.push(`dist/cli/index.js 不存在（先 npm run build）`);
  if (requireMicrogradSource && !existsSync(MICROGRAD_SOURCE)) {
    reasons.push(`micrograd source clone 不存在 (${MICROGRAD_SOURCE})`);
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
