/**
 * MCP Server 定义
 * 注册 4 个工具（prepare、generate、batch、diff）供 Claude Code 通过 MCP 协议调用
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareContext, generateSpec } from '../core/single-spec-orchestrator.js';
import { runBatch } from '../batch/batch-orchestrator.js';
import { detectDrift } from '../diff/drift-orchestrator.js';

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

/**
 * 创建并配置 MCP Server 实例
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'reverse-spec',
    version: pkg.version,
  });

  // ─── 工具 1: prepare — AST 预处理 + 上下文组装 ───
  server.tool(
    'prepare',
    'AST 预处理 + 上下文组装',
    {
      targetPath: z.string().describe('目标文件或目录路径（绝对或相对于 cwd）'),
      deep: z.boolean().default(false).describe('深度分析模式（包含函数体）'),
    },
    async ({ targetPath, deep }) => {
      try {
        const result = await prepareContext(targetPath, {
          deep,
          projectRoot: process.cwd(),
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `prepare 失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── 工具 2: generate — 完整 Spec 生成流水线 ───
  server.tool(
    'generate',
    '完整 Spec 生成流水线',
    {
      targetPath: z.string().describe('目标文件或目录路径'),
      deep: z.boolean().default(false).describe('深度分析模式'),
      outputDir: z.string().default('.specs').describe('输出目录'),
    },
    async ({ targetPath, deep, outputDir }) => {
      try {
        const result = await generateSpec(targetPath, {
          deep,
          outputDir,
          projectRoot: process.cwd(),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                specPath: result.specPath,
                tokenUsage: result.tokenUsage,
                confidence: result.confidence,
                warnings: result.warnings,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `generate 失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── 工具 3: batch — 批量 Spec 生成 ───
  server.tool(
    'batch',
    '批量 Spec 生成',
    {
      projectRoot: z
        .string()
        .optional()
        .describe('项目根目录（默认为当前工作目录）'),
      force: z.boolean().default(false).describe('强制重新生成所有 spec'),
    },
    async ({ projectRoot, force }) => {
      try {
        const root = projectRoot ?? process.cwd();
        const result = await runBatch(root, { force });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `batch 失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ─── 工具 4: diff — Spec 漂移检测 ───
  server.tool(
    'diff',
    'Spec 漂移检测',
    {
      specPath: z.string().describe('Spec 文件路径（.spec.md）'),
      sourcePath: z.string().describe('源代码文件或目录路径'),
    },
    async ({ specPath, sourcePath }) => {
      try {
        const report = await detectDrift(
          resolve(specPath),
          resolve(sourcePath),
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(report) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `diff 失败: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
