/**
 * F3 Debt Intelligence — 核心类型定义
 *
 * 暴露于 debt-scanner 模块和 panoramic pipelines 之间的共享合同类型。
 */

/**
 * LanguageAdapter.extractComments 返回的注释 region。
 * 由各语言 adapter 使用 AST 提取（不会包含字符串字面量里的"TODO"）。
 */
export interface CommentRegion {
  /** 行注释或块注释 */
  kind: 'line' | 'block';
  /** 已去掉注释起始/结束标记的文本；多行块注释保留内部换行 */
  text: string;
  /** 1-indexed 起始行 */
  startLine: number;
  /** 1-indexed 结束行（行注释等于 startLine） */
  endLine: number;
}

/** 债务 kind 分类 */
export type DebtKind = 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'NOTE';

/** 严重性映射 */
export type DebtSeverity = 'critical' | 'warning' | 'informational';

/** 代码注释债务条目 */
export interface CodeDebtEntry {
  kind: DebtKind;
  severity: DebtSeverity;
  /** 原始注释文本（已剥离 kind 前缀） */
  text: string;
  /** 相对于 projectRoot 的路径 */
  filePath: string;
  /** 1-indexed 行号（匹配发生的那一行） */
  line: number;
  /** 最近的 enclosing 符号名称，无则 null */
  symbol: string | null;
  /** git blame 得到的作者；uncommitted 时为 "uncommitted" */
  author: string;
  /** commit 距今天数；uncommitted 时为 0 */
  ageDays: number;
}

/** Design-doc 开放问题 */
export interface OpenQuestionEntry {
  /** 原文片段，最长 400 字符 */
  snippet: string;
  /** 相对 projectRoot 的文档路径 */
  docPath: string;
  /** 标题路径，如 "## Open Questions > Q1" */
  headingPath: string;
  /** 触发原因：规则命中或 LLM 判定 */
  source: 'rule' | 'llm';
  /** LLM 推断的主题，1-3 个短词；未推断时为空数组 */
  topics: string[];
}

/** 扫描过程的 diagnostics */
export interface DebtDiagnostics {
  /** 实际 AST 扫描的源文件数 */
  filesScanned: number;
  /** 因未支持的语言跳过的文件数 */
  filesSkipped: number;
  /** AST 扫描的总行数（用于债务密度） */
  totalLoc: number;
  /** LLM 调用次数 */
  llmCalls: number;
  /** 扫描到的 design-doc 数 */
  docsScanned: number;
  /** 规则命中的候选数 */
  ruleCandidates: number;
  /** 需要 LLM 仲裁的候选数 */
  llmCandidates: number;
  /** 其它消息 */
  messages: string[];
}

/** 汇总指标，给 quality-report patcher 使用 */
export interface DebtMetrics {
  totalEntries: number;
  byKind: Record<DebtKind, number>;
  densityPerKloc: number; // 代码债务条数 / kLOC
  oldestAgeDays: number;
  openQuestionsCount: number;
}

export interface TokenUsage {
  input: number;
  output: number;
}

/** 完整 debt-scanner 报告 */
export interface DebtReport {
  codeEntries: CodeDebtEntry[];
  openQuestions: OpenQuestionEntry[];
  diagnostics: DebtDiagnostics;
  metrics: DebtMetrics;
  tokenUsage: TokenUsage;
  durationMs: number;
  llmModel?: string;
  /** 为何走降级；undefined 表示未降级 */
  fallbackReason?: 'budget-exhausted' | 'dry-run' | 'no-llm-client';
}
