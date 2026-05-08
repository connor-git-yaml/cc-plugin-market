/**
 * CallSite — 单个函数调用位置的原始记录（CL-01 schema）。
 *
 * 由各语言 mapper 在 AST 抽取阶段产出（如 PythonMapper.extractCallSites），
 * 由 call-resolver 在 buildUnifiedGraph 阶段消费，产出 calls 边。
 *
 * 设计层级（DAG 方向）：models → knowledge-graph → panoramic。
 * 本文件位于 models 层，被 CodeSkeleton 与 UnifiedGraph 双向消费但不反向依赖任一上层。
 */
import { z } from 'zod';

/**
 * CalleeKind — 函数调用 callee 的分类。
 *
 * - `free`：模块顶层 callable（同模块函数 / 全局函数）
 * - `member`：self.method() / Class.method() 形式
 * - `cross-module`：通过 import 引入的外部 callee
 * - `dunder`：__add__ / __radd__ 等运算符重载（binary_operator / unary_operator AST 派生）
 * - `super`：super().method() 调用链
 * - `decorator`：带参 decorator（@app.route("/x") 形式；bare decorator 不记录，CL-04）
 * - `unresolved`：解析失败 / 无法定位 → call-resolver 进入 Stage 4 兜底
 */
export const CalleeKindSchema = z.enum([
  'free',
  'member',
  'cross-module',
  'dunder',
  'super',
  'decorator',
  'unresolved',
]);
export type CalleeKind = z.infer<typeof CalleeKindSchema>;

/**
 * CallSite — 单个函数调用位置的原始记录。
 *
 * confidence **不在此 schema 上**：tier 由 call-resolver 在 4 阶段 resolution 后计算，
 * CallSite 仅承载位置 + 分类 + caller 上下文等用于 resolver 决策的最小信息。
 */
export const CallSiteSchema = z.object({
  /** callee 名称（如 "foo" / "Class.method" / "__add__"） */
  calleeName: z.string().min(1),
  /** callee 分类（CL-01：必填，决定 resolver 进入哪个 Stage） */
  calleeKind: CalleeKindSchema,
  /** 调用所在源码行号（1-based，CL-01：必填，便于 cross-module debug） */
  line: z.number().int().positive(),
  /** 调用所在列号（CL-01：可选，节省 schema 字节） */
  column: z.number().int().nonnegative().optional(),
  /** caller 所在 function/class 上下文（如 "Value.__add__"，用于 member resolution） */
  callerContext: z.string().optional(),
});
export type CallSite = z.infer<typeof CallSiteSchema>;
