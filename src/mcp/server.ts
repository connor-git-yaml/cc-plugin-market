/**
 * MCP Server 定义
 * 注册 17 个工具（prepare、generate、batch、diff、panoramic-query +
 * 6 个 graph 查询工具 + 3 个 agent-context 工具 impact / context / detect_changes +
 * 3 个 file-navigation 工具 view_file / search_in_file / list_directory）
 * 供 Claude Code 通过 MCP 协议调用。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareContext, generateSpec } from '../core/single-spec-orchestrator.js';
import { runBatch, buildAstGraphOnly } from '../batch/batch-orchestrator.js';
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
 * MCP server 级 instructions（F184 FR-002）：经 SDK `ServerOptions` 注入 initialize result，
 * 给 driver / 子代理在无明确指令时一份工具分组导览 + 典型链路 + 恢复流，提升 MCP 工具采用率。
 *
 * 约束：
 * - 控制在 ≤1600 字符（server 级一次性导览，避免上下文膨胀；F184 Codex Plan W-004）
 * - 不硬编码工具总数（用分组描述，降工具增减时的漂移；新增/删除工具时同步本文）
 * - 必含典型链路串 `detect_changes → impact → context → view_file` 与 `graph-not-built` 恢复流
 */
export const TOOL_GUIDE = [
  'Spectra 把代码库变成可查询的知识图谱，工具分四组：',
  '• 上下文导航（最常用）：detect_changes（git diff→受影响 symbol）、impact（某 symbol 的 BFS 影响面与 caller 链）、context（symbol 360°：定义+caller+callee+import）。',
  '• 文件查看：view_file（按行区间或 symbolId 看片段，省 token 替代全文 Read）、search_in_file（文件内 pattern 搜索）、list_directory（列目录）。',
  '• 图谱查询：graph_query（关键词子图）、graph_node（节点详情+邻居）、graph_path（两节点最短调用路径）、graph_community（模块聚类）、graph_god_nodes（高耦合枢纽）、graph_hyperedges（跨模块协作超边）。',
  '• Spec 生成：prepare、generate、batch、diff、panoramic-query。',
  '',
  '典型链路：detect_changes → impact → context → view_file（改动评估→影响面→symbol 上下文→定位代码行）。',
  '按任务选工具：评估改动影响/blast radius → impact；找 caller/谁调用了 X → impact(direction=upstream)；看某 symbol 定义+依赖 → context；定位某段代码行 → view_file；不清楚结构先探索 → graph_query。',
  '',
  '恢复流：工具返回 graph-not-built 时，优先运行 `spectra batch --mode graph-only`（纯 AST · 零 LLM · 无需认证 · <2min）快速建图再重试；需要完整 spec 关系图再跑 `spectra batch`。symbol 入参类工具（context/impact/view_file）支持 fuzzy——名字有偏差会自动 resolve（warnings: fuzzy-resolved）或回传候选（context.fuzzyMatches），不必精确。',
].join('\n');

/**
 * 创建并配置 MCP Server 实例
 */
export function createMcpServer(): McpServer {
  // 单一 runtime 初始化（FR-10）：注册语言适配器 / 文档生成器 / 制品解析器
  bootstrapRuntime();

  // F184 FR-002：instructions 属于 SDK 第二个 ServerOptions 参数（非 serverInfo 对象），
  // 写错位置不会进入 initialize result。
  const server = new McpServer(
    {
      name: 'spectra',
      version: pkg.version,
    },
    {
      instructions: TOOL_GUIDE,
    },
  );

  // ─── 工具 1: prepare — AST 预处理 + 上下文组装 ───
  server.tool(
    'prepare',
    `AST 预处理 + 上下文组装：对文件/目录抽取 CodeSkeleton 结构，供后续 spec 生成。

Use this tool when:
- 想先看某目录的 AST 结构与语言分布
- generate 前的轻量预处理
- 只要结构化骨架、不需要 LLM 推断时

Example:
- Input: { targetPath: "src/auth", deep: false }
- Output: { skeletons, mergedSkeleton, detectedLanguages }

Typical chained usage:
- prepare → generate（预处理后生成完整 spec）`,
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
        const resolvedTarget = resolve(targetPath);
        if (statSync(resolvedTarget).isDirectory()) {
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
    `完整 Spec 生成流水线：对目标文件/目录跑 AST + LLM 推断，产出 .spec.md 文档。

Use this tool when:
- 要为某模块生成可读的规范文档
- 单文件/单目录的一次性 spec 生成
- prepare 之后要落地完整文档

Example:
- Input: { targetPath: "src/auth/login.ts", deep: true }
- Output: { specPath, tokenUsage, confidence, warnings }

Typical chained usage:
- prepare → generate；大范围生成改用 batch`,
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
    `批量 Spec 生成：对整个项目按语言/增量批量产出 spec，带 checkpoint 与增量 cache，并生成 graph.json。

Use this tool when:
- 首次为项目生成全套 spec
- 代码改动后增量重生成受影响 spec
- 需要图谱工具的前置 graph.json

Example:
- Input: { projectRoot: ".", mode: "full" }
- Output: { successful, skipped, failed, indexGenerated }

Typical chained usage:
- batch → graph_query / context / impact（先建图再查询）`,
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
        .enum(['full', 'reading', 'code-only', 'graph-only'])
        .optional()
        .describe('spec 文档质量维度（与 regen 轴正交）：full（默认，完整文档）| reading（轻量，跳过产品文档层）| code-only（仅跳 enrichment 层，仍逐模块调 spec-gen LLM，非零成本）| graph-only（纯 AST · 零 LLM · 无需认证 · 仅建图不生成 spec 文档，可作为 impact/context 工具的前置步骤）'),
    },
    withTelemetry('batch', async (args) => {
      const { projectRoot, full, force, incremental, languages, mode } = args as {
        projectRoot?: string;
        full?: boolean;
        force?: boolean;
        incremental?: boolean;
        languages?: string[];
        mode?: 'full' | 'reading' | 'code-only' | 'graph-only';
      };
      const root = projectRoot ?? process.cwd();

      // F5：F-009 修复 — MCP 路径 mode 日志输出（FR-006）
      const effectiveMode = mode ?? 'full';
      const mcpLogger = { info: (msg: string) => console.error(msg) };
      mcpLogger.info(`[info] batch mode=${effectiveMode}`);

      // graph-only 提前拦截：纯 AST 零 LLM，不走 runBatch/regen 轴（复用 buildAstGraphOnly，对齐 CLI 范式）
      if (effectiveMode === 'graph-only') {
        if (languages?.length) {
          mcpLogger.info('[warn] graph-only 不支持 languages 过滤，将全仓建图');
        }
        const graphResult = await buildAstGraphOnly(root);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(graphResult) }],
        };
      }

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
    `Spec 漂移检测：比对 .spec.md 与源码，找出文档与实现的偏差、新增行为、过期条目。

Use this tool when:
- 代码改动后检查 spec 是否过时
- 重构前确认 spec 与实现一致
- 审查 spec 文档准确性

Example:
- Input: { specPath: "src/auth.spec.md", sourcePath: "src/auth.ts" }
- Output: { summary, items, recommendation }

Typical chained usage:
- batch → diff（生成 spec 后检查漂移）`,
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
    `panoramic 架构分析：cross-package / architecture-ir / overview / natural-language 四种操作，做架构级查询。

Use this tool when:
- 想要 monorepo 跨包依赖全景
- 问架构级自然语言问题（operation=natural-language）
- 需要项目 overview 而非单 symbol 上下文

Example:
- Input: { operation: "natural-language", projectRoot: ".", question: "认证流程怎么走" }
- Output: { answer, citations, tokenUsage }（其他 operation 返回各自结构，如 architecture-ir 返回 IR、overview 返回分层视图）

Typical chained usage:
- batch → panoramic-query（建图后做架构级查询）`,
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
