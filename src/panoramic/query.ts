/**
 * Panoramic Query Helper
 * 封装 cross-package / architecture-ir / overview / natural-language 四种操作的业务逻辑。
 * CLI handler 和 MCP tool 均通过此模块完成调用（FR-005）。
 */

import { buildProjectContext } from './project-context.js';
import { CrossPackageAnalyzer } from './generators/cross-package-analyzer.js';
import { ArchitectureIRGenerator } from './generators/architecture-ir-generator.js';
import { ArchitectureOverviewGenerator } from './generators/architecture-overview-generator.js';
import { answerQuestion } from './qa/index.js';

// F5：新增 natural-language operation（FR-009）
export type PanoramicOperation = 'cross-package' | 'architecture-ir' | 'overview' | 'natural-language';

export interface PanoramicQueryOptions {
  projectRoot: string;
  operation: PanoramicOperation;
  /** 问题文本（operation=natural-language 时必填） */
  question?: string;
}

export type PanoramicQueryResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/**
 * 执行 panoramic 架构分析查询
 *
 * @param options.operation 操作类型
 * @param options.projectRoot 项目根目录绝对路径
 * @param options.question 问题文本（natural-language 时必填）
 * @returns 成功时返回对应 Generator 的输出，失败时返回友好错误信息
 */
export async function queryPanoramic(
  options: PanoramicQueryOptions,
): Promise<PanoramicQueryResult> {
  try {
    // natural-language 分支不需要 buildProjectContext，直接路由到 qa
    if (options.operation === 'natural-language') {
      const { projectRoot, question } = options;

      // handler 层校验：natural-language 时 question 必填
      if (!question || question.trim().length === 0) {
        return {
          ok: false,
          error: 'operation=natural-language 时 question 参数必填，且不能为空字符串',
        };
      }

      const answer = await answerQuestion(
        { text: question },
        { projectRoot },
      );

      // 将 QnAAnswer 序列化为 MCP 响应格式（JSON serializable）
      return {
        ok: true,
        data: {
          answer: answer.text,
          citations: answer.citations,
          tokenUsage: answer.tokenUsage,
          durationMs: answer.durationMs,
          fallbackMode: answer.fallbackMode,
        },
      };
    }

    const context = await buildProjectContext(options.projectRoot);

    switch (options.operation) {
      case 'cross-package': {
        const analyzer = new CrossPackageAnalyzer();
        if (!analyzer.isApplicable(context)) {
          return {
            ok: false,
            error: '当前项目不是 monorepo，cross-package 分析不可用',
          };
        }
        const input = await analyzer.extract(context);
        const output = await analyzer.generate(input);
        return { ok: true, data: output };
      }

      case 'architecture-ir': {
        const generator = new ArchitectureIRGenerator();
        const input = await generator.extract(context);
        const output = await generator.generate(input);
        // 返回 output.ir（ArchitectureIR），而非整个 ArchitectureIROutput
        return { ok: true, data: output.ir };
      }

      case 'overview': {
        const generator = new ArchitectureOverviewGenerator();
        const input = await generator.extract(context);
        const output = await generator.generate(input);
        return { ok: true, data: output };
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
