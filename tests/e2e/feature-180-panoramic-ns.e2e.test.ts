/**
 * Feature 180 — panoramic-query 4 operation + namespace 边界（Story #6/#10）
 *
 * 验证 panoramic-query 4 种 operation 在 stdio 链路下的行为：
 *   T-008-1: natural-language 不传 question → invalid-input
 *   T-008-2: cross-package，tempRoot 无 monorepo → invalid-input
 *   T-008-3: overview，tempRoot 作 projectRoot → 响应可解析（成功或已知失败均记录）
 *   T-008-4: architecture-ir → 实测结论（注释记录）
 * 验证 namespace 前缀路由边界（T-008-5）：
 *   mcp__plugin_spectra_spectra__impact → 实测：server 注册裸名，namespace 前缀剥离是 client 层职责
 *   带前缀名调用 → isError=true + text 含 'not found'（已知边界，注释记录）
 *
 * 实测复核（T-011 节点）：
 *   namespace 前缀路由实测（2026-06-08）：
 *     带前缀名 'mcp__plugin_spectra_spectra__impact' 调用 callTool →
 *     不抛异常，返回 {isError:true, content:[{text:'MCP error -32602: Tool mcp__plugin_spectra_spectra__impact not found'}]}
 *     边界说明：server 以裸名注册；namespace 前缀剥离是 MCP client（Claude 代理层）的职责，不到 server。
 *     此为预期行为，不需要修复生产代码。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// panoramic/namespace 测试无需 baseline graph
const SHOULD_SKIP = buildSkipCondition(false);
const SKIP_REASON = buildSkipReason(false);

describe.skipIf(SHOULD_SKIP)(
  `用户故事: panoramic-query 4 种 operation 和 namespace 前缀路由边界${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      // 无 monorepo 配置、无 baseline graph 的空目录
      tempRoot = mkdtempSync(tmpdir() + '/spectra-180-panoramic-');
      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-008-1: natural-language 不传 question → invalid-input
    it('T-008-1: panoramic-query natural-language 不传 question → isError=true, code=invalid-input', async () => {
      const result = await handle.client.callTool({
        name: 'panoramic-query',
        arguments: {
          operation: 'natural-language',
          projectRoot: tempRoot,
          // 不传 question
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(data.code).toBe('invalid-input');
    }, 20_000);

    // T-008-2: cross-package，tempRoot 无 monorepo → invalid-input
    it('T-008-2: panoramic-query cross-package 无 monorepo 配置 → isError=true, code=invalid-input', async () => {
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
    }, 20_000);

    // T-008-3: overview，tempRoot 作 projectRoot → 响应可解析（成功或已知失败均接受）
    it('T-008-3: panoramic-query overview → 响应 JSON 可解析（成功或失败均记录结论）', async () => {
      const result = await handle.client.callTool({
        name: 'panoramic-query',
        arguments: {
          operation: 'overview',
          projectRoot: tempRoot,
        },
      });
      // 实测（2026-06-08）：overview 对空 tempRoot **成功**（降级但返回完整结构），非失败分支
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 成功路径：MCP 层直接序列化 ArchitectureOverviewOutput
      // 实测 keys：{title, generatedAt, model:{projectName, sections:[...]}}
      // 强断真实结构字段（不接受空 {}，Codex Impl-C3）
      const data = JSON.parse(text) as {
        code?: string;
        title?: string;
        model?: { sections?: unknown[] };
      };
      console.log(`[T-008-3 实测] overview 返回: ${JSON.stringify(data).slice(0, 160)}`);
      expect(data.code).toBeUndefined();
      expect(typeof data.title).toBe('string');
      expect(Array.isArray(data.model?.sections)).toBe(true);
      expect(data.model!.sections!.length).toBeGreaterThan(0);
    }, 20_000);

    // T-008-4: architecture-ir（Codex W-4：4 operation 不可漏）
    it('T-008-4: panoramic-query architecture-ir → 成功返回 ArchitectureIR（projectName + 降级 warnings）', async () => {
      const result = await handle.client.callTool({
        name: 'panoramic-query',
        arguments: {
          operation: 'architecture-ir',
          projectRoot: tempRoot,
        },
      });
      // 实测（2026-06-08）：architecture-ir 对空 tempRoot **成功**（带降级 warnings），
      // 非进 catch 返回 internal-error（修正实现期错误推断，Codex Impl-C3）
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // 实测 keys：{projectName, generatedAt, sourceTags, warnings:[...降级...]}
      const data = JSON.parse(text) as {
        code?: string;
        projectName?: string;
        warnings?: unknown[];
      };
      console.log(`[T-008-4 实测] architecture-ir 返回: ${JSON.stringify(data).slice(0, 160)}`);
      expect(data.code).toBeUndefined();
      expect(typeof data.projectName).toBe('string');
      expect(Array.isArray(data.warnings)).toBe(true);
    }, 20_000);

    // T-008-5: namespace 前缀路由边界实测（T-011 节点）
    it('T-008-5: 带 namespace 前缀 mcp__plugin_spectra_spectra__impact → isError=true, text 含 not found（已知边界）', async () => {
      // 实测结论（2026-06-08）：
      //   server 以裸名（impact）注册；namespace 前缀剥离是 MCP client（Claude 代理层）的职责
      //   client.callTool 带前缀名 → server 找不到该工具，返回 -32602 Tool not found
      //   此行为属预期已知边界，不需要修复生产代码
      const result = await handle.client.callTool({
        name: 'mcp__plugin_spectra_spectra__impact',
        arguments: {
          target: 'some/file.ts#Foo',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      // text 含 'not found'（Tool not found 错误）
      expect(text.toLowerCase()).toContain('not found');
      console.log(`[T-008-5 实测] namespace 前缀路由结果: ${text.slice(0, 200)}`);
    }, 20_000);
  },
);
