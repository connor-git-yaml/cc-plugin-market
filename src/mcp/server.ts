/**
 * MCP Server 定义
 * 注册 17 个工具（prepare、generate、batch、diff、panoramic-query +
 * 6 个 graph 查询工具 + 3 个 agent-context 工具 impact / context / detect_changes +
 * 3 个 file-navigation 工具 view_file / search_in_file / list_directory）
 * 供 Claude Code 通过 MCP 协议调用。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareContext, generateSpec } from '../core/single-spec-orchestrator.js';
import { runBatch } from '../batch/batch-orchestrator.js';
import { resolveRegenPlan } from '../batch/regen-plan.js';
import { loadProjectConfig } from '../config/project-config.js';
import { detectDrift } from '../diff/drift-orchestrator.js';
import { bootstrapRuntime } from '../runtime-bootstrap.js';
import { scanFiles } from '../utils/file-scanner.js';
import { queryPanoramic } from '../panoramic/query.js';
import { registerGraphTools } from './graph-tools.js';
import { registerAgentContextTools } from './agent-context-tools.js';
import { registerFileNavTools } from './file-nav-tools.js';
import { buildErrorResponse } from './lib/tool-response.js';
import { withTelemetry } from './lib/telemetry.js';

// 读取 package.json 版本号
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };

/**
 * 创建并配置 MCP Server 实例
 */
export function createMcpServer(): McpServer {
  // 单一 runtime 初始化（FR-10）：注册语言适配器 / 文档生成器 / 制品解析器
  bootstrapRuntime();

  const server = new McpServer({
    name: 'spectra',
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
    withTelemetry('prepare', async (args) => {
      const { targetPath, deep } = args as { targetPath: string; deep: boolean };
      // 顶层异常由 withTelemetry 捕获 → 脱敏 internal-error（F177）
      const result = await prepareContext(targetPath, {
        deep,
        projectRoot: process.cwd(),
      });

      // 提取 detectedLanguages（Feature 031）—— 局部失败不影响主流程
      let detectedLanguages: string[] | undefined;
      try {
        const resolvedTarget = require('node:path').resolve(targetPath);
        const fs = require('node:fs');
        if (fs.statSync(resolvedTarget).isDirectory()) {
          const sr = scanFiles(resolvedTarget, { projectRoot: process.cwd() });
          if (sr.languageStats && sr.languageStats.size > 0) {
            detectedLanguages = Array.from(sr.languageStats.keys());
          }
        }
      } catch {
        // 语言检测失败不影响主流程
      }

      const responseData = detectedLanguages
        ? { ...result, detectedLanguages }
        : result;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(responseData) }],
      };
    }),
  );

  // ─── 工具 2: generate — 完整 Spec 生成流水线 ───
  server.tool(
    'generate',
    '完整 Spec 生成流水线',
    {
      targetPath: z.string().describe('目标文件或目录路径'),
      deep: z.boolean().default(false).describe('深度分析模式'),
      outputDir: z.string().default('specs').describe('输出目录'),
    },
    withTelemetry('generate', async (args) => {
      const { targetPath, deep, outputDir } = args as { targetPath: string; deep: boolean; outputDir: string };
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
    }),
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
      full: z
        .boolean()
        .optional()
        .describe('显式全量重生成（regen 轴逃生口，绕过增量 cache + checkpoint）；与 --mode full 质量维度正交'),
      force: z
        .boolean()
        .optional()
        .describe('强制重新生成所有 spec（full 的等义别名，向后兼容）'),
      incremental: z
        .boolean()
        .optional()
        .describe('仅重生成受影响的 spec（增量模式）；未指定时默认走增量（FR-001）'),
      languages: z
        .array(z.string())
        .optional()
        .describe('仅处理指定语言（如 ["typescript", "python"]）'),
      // F5：运行模式参数（FR-007）
      mode: z
        .enum(['full', 'reading', 'code-only'])
        .optional()
        .describe('spec 文档质量维度（与 regen 轴正交）：full（默认，完整文档）| reading（轻量，跳过产品文档层）| code-only（纯 AST，跳过所有 LLM 推断）'),
    },
    withTelemetry('batch', async (args) => {
      const { projectRoot, full, force, incremental, languages, mode } = args as {
        projectRoot?: string;
        full?: boolean;
        force?: boolean;
        incremental?: boolean;
        languages?: string[];
        mode?: 'full' | 'reading' | 'code-only';
      };
      const root = projectRoot ?? process.cwd();

      // F5：F-009 修复 — MCP 路径 mode 日志输出（FR-006）
      const effectiveMode = mode ?? 'full';
      const mcpLogger = { info: (msg: string) => console.error(msg) };
      mcpLogger.info(`[info] batch mode=${effectiveMode}`);

      // 加载项目配置作为 fallback（MCP 显式参数优先）
      const fileConfig = loadProjectConfig(root);
      // F175 FR-002：合并 config fallback 后统一解析 regen 计划（唯一默认值来源）。
      const regenPlan = resolveRegenPlan({
        incremental: incremental ?? fileConfig.incremental,
        full,
        force: force ?? fileConfig.force,
      });
      const result = await runBatch(root, {
        incremental: regenPlan.incremental,
        full: regenPlan.full,
        languages: languages ?? fileConfig.languages,
        mode: effectiveMode,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    }),
  );

  // ─── 工具 4: diff — Spec 漂移检测 ───
  server.tool(
    'diff',
    'Spec 漂移检测',
    {
      specPath: z.string().describe('Spec 文件路径（.spec.md）'),
      sourcePath: z.string().describe('源代码文件或目录路径'),
    },
    withTelemetry('diff', async (args) => {
      const { specPath, sourcePath } = args as { specPath: string; sourcePath: string };
      const report = await detectDrift(
        resolve(specPath),
        resolve(sourcePath),
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report) }],
      };
    }),
  );

  // ─── 工具 5: panoramic-query — panoramic 架构分析 ───
  server.tool(
    'panoramic-query',
    '运行 panoramic 架构分析，支持 cross-package / architecture-ir / overview / natural-language 四种操作',
    {
      operation: z
        .enum(['cross-package', 'architecture-ir', 'overview', 'natural-language'])
        .describe('分析操作类型；natural-language 触发自然语言问答（FR-009）'),
      projectRoot: z
        .string()
        .describe('项目根目录绝对路径（必需）'),
      // F5：natural-language operation 专用字段（FR-009）
      question: z
        .string()
        .optional()
        .describe('问题文本（operation=natural-language 时必填，其他 operation 忽略）'),
    },
    withTelemetry('panoramic-query', async (args) => {
      const { operation, projectRoot, question } = args as {
        operation: 'cross-package' | 'architecture-ir' | 'overview' | 'natural-language';
        projectRoot: string;
        question?: string;
      };
      const result = await queryPanoramic({ operation, projectRoot, question });
      if (!result.ok) {
        // F177（修隐性 bug EC-6：旧实现此路径未置 isError，且用旧 {error} 形态）：
        // 按 query 层判别区分——预期输入失败回传安全文案；内部异常脱敏为 internal-error
        // （result.error 可能含绝对路径，不回传原文，spec C-4 / Codex CRITICAL-D）。
        if (result.kind === 'invalid-input') {
          return buildErrorResponse('invalid-input', result.error);
        }
        return buildErrorResponse('internal-error', 'panoramic-query 内部错误');
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.data) }],
      };
    }),
  );

  // ─── 注册图谱查询工具（graph_query / graph_node / graph_path / graph_community / graph_god_nodes） ───
  registerGraphTools(server);

  // ─── Feature 155 — Agent-Context tools（impact / context / detect_changes） ───
  registerAgentContextTools(server);

  // ─── Feature 171 — File Navigation tools（view_file / search_in_file / list_directory） ───
  registerFileNavTools(server);

  return server;
}
