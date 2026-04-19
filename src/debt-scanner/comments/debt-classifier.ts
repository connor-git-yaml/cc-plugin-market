/**
 * 债务注释分类器
 *
 * 接收 CommentRegion 列表（已由 AST 保证不包含字符串字面量），
 * 在注释文本内部进行 TODO/FIXME/HACK/XXX/NOTE 的正则匹配。
 *
 * 每一行可能独立匹配（支持块注释内多个 TODO 各自独立成条）。
 */
import type { CommentRegion, DebtKind, DebtSeverity } from '../types.js';

/** kind → severity 映射 */
export const SEVERITY_MAP: Readonly<Record<DebtKind, DebtSeverity>> = Object.freeze({
  FIXME: 'critical',
  HACK: 'critical',
  TODO: 'warning',
  XXX: 'informational',
  NOTE: 'informational',
});

/** 排序权重：critical=0, warning=1, informational=2 */
export const SEVERITY_ORDER: Readonly<Record<DebtSeverity, number>> = Object.freeze({
  critical: 0,
  warning: 1,
  informational: 2,
});

/**
 * 在一段注释内部查找所有债务标记。
 *
 * 正则设计：
 * - 每行独立匹配（多行块注释会产生多条）
 * - 允许前导的 `*`、`#`、`//`、空白
 * - 支持 TODO / FIXME / HACK / XXX / NOTE，大小写不敏感
 * - 支持 `TODO(connor):` 或 `TODO@user:` 风格的可选括号 /@ 标注
 * - 冒号可选
 */
const DEBT_REGEX = /^[\s*/#]*\b(TODO|FIXME|HACK|XXX|NOTE)(?:\(([\w@.\-]+)\)|@([\w.\-]+))?\s*:?\s*(.*)$/i;

export interface ClassifiedDebt {
  kind: DebtKind;
  severity: DebtSeverity;
  /** 剩余描述（已剥离 kind 前缀和可选 owner） */
  text: string;
  /** 可选 owner（括号或 @ 语法里的人名） */
  owner: string | null;
  /** 匹配发生在 region 内的第几行（0-indexed） */
  lineOffset: number;
}

/**
 * 对单个 CommentRegion 逐行匹配。
 */
export function classifyCommentRegion(region: CommentRegion): ClassifiedDebt[] {
  const out: ClassifiedDebt[] = [];
  const lines = region.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = DEBT_REGEX.exec(line);
    if (!m) continue;
    const kind = m[1]!.toUpperCase() as DebtKind;
    const owner = (m[2] ?? m[3]) ?? null;
    const text = (m[4] ?? '').trim();
    out.push({
      kind,
      severity: SEVERITY_MAP[kind],
      text,
      owner,
      lineOffset: i,
    });
  }
  return out;
}
