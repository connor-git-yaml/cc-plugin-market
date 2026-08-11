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
  /** callee 名称（如 "foo" / "method" / "__add__"） */
  calleeName: z.string().min(1),
  /** callee 分类（CL-01：必填，决定 resolver 进入哪个 Stage） */
  calleeKind: CalleeKindSchema,
  /** 调用所在源码行号（1-based，CL-01：必填，便于 cross-module debug） */
  line: z.number().int().positive(),
  /** 调用所在列号（CL-01：可选，节省 schema 字节） */
  column: z.number().int().nonnegative().optional(),
  /** caller 所在 function/class 上下文（如 "Value.__add__"，用于 member resolution） */
  callerContext: z.string().optional(),
  /**
   * callee 限定符 — Codex P1 C-2 修订。
   *
   * 用于 attribute call（如 `Engine.helper()` / `numpy.array()` / `obj.method()`）的 receiver 名。
   * resolver 会优先用此 qualifier 在 importIndex / classMemberIndex 中定位 callee 真实来源：
   * - calleeKind=cross-module → calleeQualifier 是 module alias（如 "numpy"）
   * - calleeKind=member（Class.method 形式）→ calleeQualifier 是类名（如 "Engine"）
   * - calleeKind=member（self/cls.method）→ calleeQualifier=undefined（用 callerContext）
   * - calleeKind=free / dunder / decorator / super / unresolved → 通常 undefined
   */
  calleeQualifier: z.string().optional(),
  /**
   * 最近的**命名**祖先作用域 — F242 新增（resolver 归属回退链第二级）。
   *
   * `callerContext` 的设计用途是 member resolution（定位类名），它遵循「最近 scope 原则」，
   * 匿名 callback 会产出 `<arrow:line:col>` 这类**不可寻址**的上下文名。call-resolver 把
   * `callerContext` 复用为边的 source 地址时，这类边会因 source 不是图节点被悬空过滤丢弃。
   *
   * 本字段承载「跳过所有匿名帧后的第一个命名祖先」，让 resolver 在 `callerContext`
   * 不可寻址时仍能把边归属到符号级节点（而非退到模块级），保住归属精度。
   *
   * 省略规则：`callerContext` 本身已是命名上下文时不填（此时二者必然相等，填了是冗余）；
   * 栈内不存在命名祖先（如顶层 IIFE）时同样不填，resolver 走模块节点兜底。
   *
   * 语言无关性：仅 TS/JS mapper 产出此字段；其他语言 mapper 不填，回退链自动跳到模块兜底。
   */
  enclosingNamedContext: z.string().optional(),
  /**
   * 接收者的推断类名 — F260 新增（实例方法调用边解析）。
   *
   * `calleeQualifier` 承载的是接收者表达式的**原始源码文本**（`a` / `this.x` / `new Foo()`），
   * resolver 只能靠首字母大小写二分猜它是类名还是模块别名。本字段承载 mapper 侧
   * **文件级接收者类型绑定环境**推断出的真实类名，让 resolver 不必再猜。
   *
   * 产出方：仅 TS/JS mapper（见 `typescript-receiver-env.ts`）。推断不出 / 歧义 / 判据弃权
   * 时**一律不填**（fail-closed），因此「有值」本身就是一个正向信号。
   */
  receiverType: z.string().optional(),
  /**
   * `receiverType` 那个类名在**本文件内恰好 1 个绑定点、且该绑定来自 import** — F260 新增。
   *
   * 这是 A1 裁决的**正向许可**语义：只有为 `true` 时，resolver 才可以拿这个类名去查
   * import 别名表定位类的来源文件。绑定点 ≥ 2（存在遮蔽，无法判断调用的是哪一个）、
   * 唯一绑定非 import 来源（import 表不适用）、绑定点 = 0（名字来源不明）三种情况均为 `false`。
   *
   * **`undefined` 按 `false` 处理**（fail-closed）：字段缺席只可能来自旧 baseline 或非 TS/JS
   * mapper，此时 import 表的可信度无从判断，必须拦住。与 `receiverType` 由同一处产出，
   * 不存在「类型有、判据无」的半开组合。
   */
  receiverTypeSoleImportBinding: z.boolean().optional(),
  /**
   * `receiverType` 那个类名在**本文件内恰好 1 个绑定点**（不要求来自 import）— F263 新增。
   *
   * 与 `receiverTypeSoleImportBinding` 的区别：后者是 import 表可信度的**正向许可**语义
   * （`total===1 && fromImport===1`），只服务分支 (b)；本字段是**纯遮蔽计数**
   * （`total===1`，不问绑定来源），服务分支 (a)——「名字在本模块导出表里」这一路径要回答的
   * 不是「import 表能不能信」，而是「这个名字在调用点所在文件有没有被别的绑定遮蔽」。
   *
   * **`undefined` 按 `false` 处理**（fail-closed，与 `receiverTypeSoleImportBinding` 逐字
   * 对齐）：字段缺席只可能来自旧 baseline 或非 TS/JS mapper，此时遮蔽状态无从判断，必须拦住。
   * 与 `receiverType` / `receiverTypeSoleImportBinding` 由同一处（`typescript-mapper.ts`
   * `_mkCallSite`）同源产出，不存在「其余字段有值、本字段缺席」的半开组合。
   */
  receiverTypeSoleBinding: z.boolean().optional(),
});
export type CallSite = z.infer<typeof CallSiteSchema>;
