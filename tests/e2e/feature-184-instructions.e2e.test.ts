/**
 * F184 T002 — MCP server instructions 经 stdio JSON-RPC initialize 传播（FR-002 / Codex Plan C-002）
 *
 * 验证 instructions 真正进入 initialize result（≠ unit test 只验常量内容）：
 * 经真实 stdio 子进程 + SDK Client.getInstructions() 读取 server 在握手时回传的 instructions。
 *
 * 注意：这验证的是 **MCP 协议层传播**；"Task 子代理是否在模型上下文里看到 instructions"
 * 是另一个问题（spec EC-005），由 A/B 评测回答，不在本测试范围。
 *
 * 不需要 micrograd 源 clone（instructions 在 server 启动握手即回传，与图谱无关）→ requireMicrogradSource=false。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  type McpClientHandle,
} from './helpers/stdio-client.js';

const SHOULD_SKIP = buildSkipCondition(false);
const SKIP_REASON = buildSkipReason(false);

describe.skipIf(SHOULD_SKIP)(
  `用户故事: MCP server instructions 经 stdio 协议握手传播给 client${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-184-instructions-'));
      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('client.getInstructions() 非空', () => {
      const instructions = handle.client.getInstructions();
      expect(instructions).toBeDefined();
      expect((instructions ?? '').length).toBeGreaterThan(0);
    });

    it('instructions 含典型链路串 detect_changes → impact → context → view_file', () => {
      const instructions = handle.client.getInstructions() ?? '';
      expect(instructions).toContain('detect_changes → impact → context → view_file');
    });

    it('instructions 含 graph-not-built 恢复流提示', () => {
      const instructions = handle.client.getInstructions() ?? '';
      expect(instructions).toContain('graph-not-built');
      expect(instructions).toContain('spectra batch');
    });
  },
);
