/**
 * qa/debt-context.ts
 * Step 4：F3 debt-scanner 集成 + 债务上下文注入
 *
 * 职责：
 * - 检测问题是否含债务关键词（TODO/FIXME/HACK/技术债/最老等）
 * - 匹配时调用 scanProjectDebt()，返回按 ageDays 倒序 Top-5 CodeDebtEntry
 * - 将 CodeDebtEntry 转换为 Citation 格式
 * - 不匹配时返回空结果（不触发 scanProjectDebt，节省 I/O）
 *
 * 说明：
 * - plan §7 F3 集成决策：scanProjectDebt 每次问答都调用，不缓存
 *   （主要是 AST 扫描 + git blame，无 LLM，单次耗时约 0.5-3 秒，可接受）
 */
import { scanProjectDebt } from '../../debt-scanner/index.js';
import type { ScanProjectDebtOptions } from '../../debt-scanner/index.js';
import type { Citation } from './types.js';

// ============================================================
// 类型定义
// ============================================================

/** debt-context 的输入选项 */
export interface DebtContextOptions {
  /** 返回条目上限（默认 5） */
  topN?: number;
  /** 可选：注入 scanProjectDebt 的选项（测试用途，如注入 blame/files） */
  scanOptions?: Partial<Omit<ScanProjectDebtOptions, 'projectRoot' | 'registry'>>;
}

/** debt-context 的输出结果 */
export interface DebtContextResult {
  /** 是否触发了债务关键词路由 */
  triggered: boolean;
  /** 转换后的 Citation 列表（若未触发则为空数组） */
  citations: Citation[];
}

// ============================================================
// 债务关键词正则（大小写不敏感）
// ============================================================

/**
 * 触发 debt-scanner 的关键词集合
 * 包含：英文 TODO/FIXME/HACK/XXX/technical debt + 中文等价词
 */
const DEBT_KEYWORD_PATTERN = /TODO|FIXME|HACK|XXX|technical\s*debt|技术债|最老|最旧|最长时间|债务/i;

// ============================================================
// 工具函数
// ============================================================

/**
 * 检测问题文本是否包含债务关键词
 */
export function isDebtQuestion(questionText: string): boolean {
  return DEBT_KEYWORD_PATTERN.test(questionText);
}

// ============================================================
// 主函数
// ============================================================

/**
 * 按需注入债务上下文
 * 问题含债务关键词时：调用 scanProjectDebt，返回 Top-5 ageDays 倒序的 Citation
 * 否则：返回 triggered=false + 空 citations
 *
 * @param questionText - 用户问题文本
 * @param projectRoot - 项目根目录
 * @param registry - LanguageAdapterRegistry（来自 batch-orchestrator 或 MCP 上下文）
 * @param options - 选项（topN、scanOptions）
 * @returns DebtContextResult
 */
export async function injectDebtContext(
  questionText: string,
  projectRoot: string,
  registry: ScanProjectDebtOptions['registry'],
  options?: DebtContextOptions,
): Promise<DebtContextResult> {
  // 关键词路由：不匹配时提前返回
  if (!isDebtQuestion(questionText)) {
    return { triggered: false, citations: [] };
  }

  const topN = options?.topN ?? 5;

  // 调用 scanProjectDebt（每次都调用，不缓存）
  let report;
  try {
    report = await scanProjectDebt({
      projectRoot,
      registry,
      dryRun: true, // F5 问答仅需 AST 扫描，不需要 LLM 主题推断
      ...options?.scanOptions,
    });
  } catch (err) {
    // scanProjectDebt 失败时不阻断问答，返回空债务上下文并记录 warn
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[warn] qa/debt-context: scanProjectDebt 失败，跳过债务上下文注入。原因：${message}`);
    return { triggered: true, citations: [] };
  }

  // 按 ageDays 倒序排列，取 Top-N
  const sorted = report.codeEntries
    .filter((e) => e.ageDays >= 0)
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, topN);

  // 转换为 Citation 格式
  const citations: Citation[] = sorted.map((entry) => ({
    specPath: entry.filePath,
    lineRange: { startLine: entry.line, endLine: entry.line },
    excerpt: entry.text.slice(0, 200),
  }));

  return { triggered: true, citations };
}
