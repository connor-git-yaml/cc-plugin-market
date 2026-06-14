/**
 * F189 prototype —— 共享类型（点锚 + 全仓双 demo）。
 *
 * 仅 prototype 内部使用，不进生产路径。
 */

/** 锚（点锚路线）的 drift 状态，对应 spec FR-004 */
export type AnchorStatus =
  | 'fresh' // 指纹一致
  | 'stale' // 指纹失配（symbol 自身变了）
  | 'orphaned' // symbol 在 graph 中已不存在（删除/重命名）
  | 'ambiguous' // 多候选，不自动绑
  | 'unresolved' // 解析失败（graph 在但 symbol 找不到）
  | 'fingerprint-unavailable' // 解析到了但取不到 span/指纹
  | 'graph-unavailable'; // graph 整体不可用（FR-010）

/** 一条点锚记录（lock 制品的一行，参照 Fiberplane drift.lock） */
export interface Anchor {
  /** 原始引用表达式（裸名或 file::Symbol） */
  ref: string;
  /** 引用所在文档路径（FR-011 显式输入契约） */
  docPath: string;
  /** 引用所在行 */
  line: number;
  /** 解析出的 canonical symbol id（null = 未解析） */
  symbolId: string | null;
  /** 解析来源（= ref，便于审计） */
  resolvedFrom: string;
  /** 命中方式：exact / partial-name / path-suffix / levenshtein */
  matchKind?: string;
  /** symbol 级源切片指纹（空白归一化后 SHA-256）；null = 不可用 */
  fingerprint: string | null;
  /** drift 状态 */
  status: AnchorStatus;
  /** 多候选时的 top-3（仅 ambiguous） */
  candidates?: string[];
  /** 人类可读原因 */
  reason?: string;
}

/** check 的结构化报告（FR-005） */
export interface DriftReport {
  anchors: AnchorCheckResult[];
  summary: Record<AnchorStatus, number>;
  degraded: boolean;
  /** standalone CLI 退出码：graph-unavailable→2，stale/orphaned→1，否则 0 */
  exitCode: 0 | 1 | 2;
}

/** check 单条结果（在 Anchor 基础上加重算指纹对比） */
export interface AnchorCheckResult extends Anchor {
  expectedFingerprint: string | null;
  actualFingerprint: string | null;
}

/** 全仓路线（OpenLore 式）分类结果，对应 US4 */
export interface WholeRepoReport {
  gap: Array<{ file: string; domain: string }>;
  uncovered: string[];
  staleRef: Array<{ domain: string; missingFile: string }>;
}

/** 全仓 demo 的 spec→Source files 映射（fixture 输入） */
export interface DomainMapping {
  domain: string;
  specPath: string;
  sourceFiles: string[];
  /** 本次提交里这个 domain 的 spec 是否被改动（用于判 gap） */
  specChanged: boolean;
}

/** 全仓 demo 输入 fixture */
export interface WholeRepoInput {
  /** 本次「改动」的文件列表（demo 用 fixture 模拟，不接真实 git diff） */
  changedFiles: string[];
  /** 当前磁盘上实际存在的文件（用于判 stale-ref） */
  existingFiles: string[];
  /** spec domain 映射 */
  mappings: DomainMapping[];
}
