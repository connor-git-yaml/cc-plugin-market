/**
 * Feature 180 — F177 telemetry 在真实 stdio 子进程中落盘验证（Story #4）
 *
 * 验证 SPECTRA_MCP_TELEMETRY_PATH + SPECTRA_MCP_RUN_ID env 在 stdio 子进程中落盘：
 *   T-006-1: 成功调用 → JSONL 恰 1 行，含 toolName/runId/durationMs/requestSize/responseSize
 *   T-006-2: 能进入 handler 的失败调用 → JSONL 行含 errorCode（与响应 code 一致）
 *   T-006-3: 不设 SPECTRA_MCP_TELEMETRY_PATH → 无 JSONL 文件产生
 *
 * Codex Plan-Warning-4 说明：telemetry 读子进程 process.env，运行中无法由父进程改 env，
 * 因此 3 个 describe 块各自独立 spawn（非同一子进程切换 env）。
 * afterEach 删 JSONL，防止跨用例污染。
 *
 * EC-1 约束：T-006-2 必须用能进入 handler 的失败（graph-not-built），
 * 不能用 SDK 校验拒绝的缺参调用（不进 withTelemetry，不写 telemetry）。
 */

import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  BASELINE_GRAPH,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// telemetry 需要 baseline（用 graph 工具进入 handler）
const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

// ── describe 1: 成功调用写 JSONL（T-006-1）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: 设置 SPECTRA_MCP_TELEMETRY_PATH 后成功调用恰写 1 行 JSONL${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;
    let telemetryPath: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-tel-1-'));
      telemetryPath = join(tempRoot, 'telemetry.jsonl');
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      copyFileSync(BASELINE_GRAPH, join(tempRoot, 'specs', '_meta', 'graph.json'));

      handle = await spawnMcpClient({
        cwd: tempRoot,
        env: {
          SPECTRA_MCP_TELEMETRY_PATH: telemetryPath,
          SPECTRA_MCP_RUN_ID: 'test-run-001',
        },
      });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    afterEach(() => {
      // 每用例后清理 JSONL，防止跨用例污染
      if (existsSync(telemetryPath)) {
        unlinkSync(telemetryPath);
      }
    });

    // T-006-1: 成功调用恰写 1 行 JSONL，含必需字段
    it('T-006-1: 成功调用 graph_query → JSONL 恰 1 行，含 toolName/runId/durationMs/requestSize/responseSize', async () => {
      const result = await handle.client.callTool({
        name: 'graph_query',
        arguments: {
          question: 'list all classes',
          projectRoot: tempRoot,
        },
      });
      // 必须是成功调用（否则 entry 含 errorCode，验的就不是成功路径，Codex Impl-W8）
      expect(result.isError).not.toBe(true);

      // 读 JSONL
      expect(existsSync(telemetryPath)).toBe(true);
      const lines = readFileSync(telemetryPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      // 恰好 1 行（withTelemetry 锁死双发射 EC-1）
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]) as {
        toolName?: string;
        runId?: string;
        durationMs?: number;
        requestSize?: number;
        responseSize?: number;
        errorCode?: string;
      };
      expect(entry.toolName).toBe('graph_query');
      expect(entry.runId).toBe('test-run-001');
      // durationMs >= 0（快路径可能为 0，Codex W-2）
      expect(typeof entry.durationMs).toBe('number');
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof entry.requestSize).toBe('number');
      expect(typeof entry.responseSize).toBe('number');
      // 成功调用 entry 不含 errorCode（Codex Impl-W8）
      expect(entry.errorCode).toBeUndefined();
    }, 20_000);
  },
);

// ── describe 2: 失败调用含 errorCode（T-006-2）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: 能进入 handler 的失败调用 → JSONL 行含 errorCode${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;
    let emptyRoot: string;
    let telemetryPath: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-tel-2-'));
      telemetryPath = join(tempRoot, 'telemetry-err.jsonl');
      // emptyRoot：无 graph，触发 graph-not-built（进 handler 后失败）
      emptyRoot = mkdtempSync(join(tmpdir(), 'spectra-180-tel-2-empty-'));
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      copyFileSync(BASELINE_GRAPH, join(tempRoot, 'specs', '_meta', 'graph.json'));

      handle = await spawnMcpClient({
        cwd: tempRoot,
        env: {
          SPECTRA_MCP_TELEMETRY_PATH: telemetryPath,
          SPECTRA_MCP_RUN_ID: 'test-run-002',
        },
      });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
      if (emptyRoot) rmSync(emptyRoot, { recursive: true, force: true });
    });

    afterEach(() => {
      if (existsSync(telemetryPath)) {
        unlinkSync(telemetryPath);
      }
    });

    // T-006-2: 进入 handler 的失败（graph-not-built）→ JSONL 含 errorCode
    it('T-006-2: graph_query 传不存在 projectRoot → JSONL 行含 errorCode=graph-not-built', async () => {
      const result = await handle.client.callTool({
        name: 'graph_query',
        arguments: {
          question: 'anything',
          projectRoot: emptyRoot,  // 无 graph，触发 graph-not-built
        },
      });

      // 确认响应 code
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const resp = JSON.parse(text) as { code?: string };
      expect(resp.code).toBe('graph-not-built');

      // 确认 JSONL 写入且含 errorCode
      expect(existsSync(telemetryPath)).toBe(true);
      const lines = readFileSync(telemetryPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(1);

      const entry = JSON.parse(lines[0]) as {
        errorCode?: string;
        toolName?: string;
      };
      // errorCode 与响应 code 一致
      expect(entry.errorCode).toBe('graph-not-built');
      expect(entry.toolName).toBe('graph_query');
    }, 20_000);
  },
);

// ── describe 3: 不设 env → 无 JSONL（T-006-3）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: 不设 SPECTRA_MCP_TELEMETRY_PATH → 无 JSONL 文件产生${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-tel-3-'));
      mkdirSync(join(tempRoot, 'specs', '_meta'), { recursive: true });
      copyFileSync(BASELINE_GRAPH, join(tempRoot, 'specs', '_meta', 'graph.json'));

      // 显式清空 telemetry env（防止继承父进程 SPECTRA_MCP_TELEMETRY_PATH 导致写到外部文件而假绿，
      // Codex Impl-C2；telemetry.ts 把空串当 no-op）
      handle = await spawnMcpClient({
        cwd: tempRoot,
        env: { SPECTRA_MCP_TELEMETRY_PATH: '', SPECTRA_MCP_RUN_ID: '' },
      });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-006-3: 不设 env → 无 JSONL 产生
    it('T-006-3: 不设 SPECTRA_MCP_TELEMETRY_PATH → 调用后无任何 JSONL 文件产生', async () => {
      await handle.client.callTool({
        name: 'graph_query',
        arguments: {
          question: 'list components',
          projectRoot: tempRoot,
        },
      });

      // 确认 tempRoot 内无 .jsonl 文件
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(tempRoot);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
      expect(jsonlFiles.length).toBe(0);
    }, 20_000);
  },
);
