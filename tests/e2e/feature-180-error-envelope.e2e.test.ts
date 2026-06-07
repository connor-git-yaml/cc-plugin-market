/**
 * Feature 180 — server 5 工具错误 envelope + graph-query-failed（Story #5）
 *
 * 验证 5 个 server 工具（prepare/generate/batch/diff/panoramic-query）对失败入参返回：
 *   - isError=true
 *   - content[0].text JSON 可解析，含 code 字段
 *   - 响应 text 不含机器绝对路径（/Users/ 或 /home/）及 stack trace 关键词
 * 同时验证 graph-query-failed 零覆盖闭合（Codex W-1，F177 warning #2）：
 *   - 可加载但 malformed 的 graph fixture（node 缺 label 字段）
 *   - graph_query 查询期 scoreNodes 访问 node.label.toLowerCase() 抛错
 *   → code === 'graph-query-failed'（区别于 graph-not-built）
 *
 * 两个独立 describe 块：
 *   块 A: emptyDir spawn（server 5 工具失败路径）
 *   块 B: malformed graph spawn（graph-query-failed）
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// error-envelope 测试无需 baseline（用失败入参 + malformed fixture）
const SHOULD_SKIP = buildSkipCondition(false);
const SKIP_REASON = buildSkipReason(false);

/**
 * 脱敏验证：确认错误响应不含机器绝对路径和 stack trace。
 * 正则放宽（Codex Impl-W7）：覆盖大写/数字/点/下划线用户名 + macOS tmp（/var/folders、
 * /private/var）+ 真正的 stack frame（"\n  at file:line:col"）。
 */
function assertNoSensitiveData(text: string): void {
  // 不应含机器用户目录（调用者绝对路径），用户名允许任意非斜杠字符
  expect(text).not.toMatch(/\/Users\/[^/\s"]+/);
  expect(text).not.toMatch(/\/home\/[^/\s"]+/);
  // 不应泄露 macOS 临时目录绝对路径
  expect(text).not.toMatch(/\/(?:private\/)?var\/folders\//);
  // 不应含 stack frame（"  at xxx:line:col" 形态）
  expect(text).not.toMatch(/\n\s+at .+:\d+:\d+/);
}

// ── 块 A: server 5 工具错误 envelope ──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: server 5 工具失败入参→统一错误 envelope 不泄露绝对路径${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;
    let emptyDir: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-err-a-'));
      emptyDir = mkdtempSync(join(tmpdir(), 'spectra-180-nonexist-'));
      // 删掉 emptyDir 使其变成不存在的路径
      rmSync(emptyDir, { recursive: true, force: true });

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-007-1: batch 传不存在 projectRoot → isError + code + 不泄露路径
    it('T-007-1: batch 传不存在 projectRoot → isError=true, code 非空, 不含绝对路径/stack', async () => {
      const result = await handle.client.callTool({
        name: 'batch',
        arguments: {
          projectRoot: emptyDir,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      // code 为 internal-error 或 invalid-input
      expect(['internal-error', 'invalid-input']).toContain(data.code);
      assertNoSensitiveData(text);
    }, 20_000);

    // T-007-2: prepare 传不存在路径 → 同格式断言
    it('T-007-2: prepare 传不存在路径 → isError=true, 统一 envelope, 不含绝对路径/stack', async () => {
      const result = await handle.client.callTool({
        name: 'prepare',
        arguments: {
          targetPath: emptyDir,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(['internal-error', 'invalid-input']).toContain(data.code);
      assertNoSensitiveData(text);
    }, 20_000);

    // T-007-3: generate 传不存在路径 → 同格式断言
    it('T-007-3: generate 传不存在路径 → isError=true, 统一 envelope, 不含绝对路径/stack', async () => {
      const result = await handle.client.callTool({
        name: 'generate',
        arguments: {
          targetPath: emptyDir,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(['internal-error', 'invalid-input']).toContain(data.code);
      assertNoSensitiveData(text);
    }, 20_000);

    // T-007-4: diff 传不存在 specPath/sourcePath → 同格式断言
    it('T-007-4: diff 传不存在 specPath/sourcePath → isError=true, 统一 envelope, 不含绝对路径/stack', async () => {
      const result = await handle.client.callTool({
        name: 'diff',
        arguments: {
          specPath: join(emptyDir, 'nonexist.spec.md'),
          sourcePath: emptyDir,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(['internal-error', 'invalid-input']).toContain(data.code);
      assertNoSensitiveData(text);
    }, 20_000);

    // T-007-5: panoramic-query 传 cross-package，非 monorepo 空目录 → invalid-input
    it('T-007-5: panoramic-query cross-package 传非 monorepo 空目录 → isError=true, code=invalid-input', async () => {
      const result = await handle.client.callTool({
        name: 'panoramic-query',
        arguments: {
          operation: 'cross-package',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(data.code).toBe('invalid-input');
      assertNoSensitiveData(text);
    }, 20_000);
  },
);

// ── 块 B: malformed graph → graph-query-failed（T-007-6）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: malformed graph（node 缺 label）触发 graph-query-failed（F177 warning #2 闭合）${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let malformedRoot: string;

    beforeAll(async () => {
      malformedRoot = mkdtempSync(join(tmpdir(), 'spectra-180-err-b-'));
      mkdirSync(join(malformedRoot, 'specs', '_meta'), { recursive: true });

      // malformed graph fixture：node 有 id/kind/metadata 通过加载校验，但无 label
      // scoreNodes 访问 node.label.toLowerCase() 在查询期抛错 → graph-query-failed
      // （区别于 graph-not-built：图能加载，但查询期 engine 抛错）
      const malformedGraph = {
        directed: true,
        multigraph: false,
        graph: {
          name: 'spectra-knowledge-graph',
          nodeCount: 1,
          edgeCount: 0,
          sources: ['unified-graph'],
          schemaVersion: '1.0',
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        nodes: [
          {
            // 有 id/kind/metadata 通过加载校验，但无 label 字段
            id: 'test::Foo',
            kind: 'component',
            metadata: { sourceFile: 'test.ts' },
          },
        ],
        links: [],
      };
      writeFileSync(
        join(malformedRoot, 'specs', '_meta', 'graph.json'),
        JSON.stringify(malformedGraph),
      );

      handle = await spawnMcpClient({ cwd: malformedRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (malformedRoot) rmSync(malformedRoot, { recursive: true, force: true });
    });

    // T-007-6: malformed graph → graph-query-failed（F177 warning #2 零覆盖闭合）
    it('T-007-6: malformed graph（node 缺 label）→ graph_query 返回 code=graph-query-failed', async () => {
      const result = await handle.client.callTool({
        name: 'graph_query',
        arguments: {
          question: 'find all classes',
          projectRoot: malformedRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      // graph-query-failed：engine 加载成功后查询期异常（非 graph-not-built）
      // 实现阶段先实测确认确实抛该码（若不符调整 fixture）
      expect(data.code).toBe('graph-query-failed');
    }, 20_000);
  },
);
