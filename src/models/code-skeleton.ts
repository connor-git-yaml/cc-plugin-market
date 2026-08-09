/**
 * CodeSkeleton 及相关嵌套实体的 Zod Schema 定义
 * 流水线第一阶段输出：AST 提取的文件结构中间表示
 */
import { z } from 'zod';

// **Codex P0 W-2 修订** — 从同层 models/call-site.ts import，保持 DAG 方向（models 不反向依赖 knowledge-graph）
import { CallSiteSchema, type CallSite } from './call-site.js';
export { CallSiteSchema, type CallSite } from './call-site.js';

// --- 枚举 ---

export const ExportKindSchema = z.enum([
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'variable',
  // 多语言扩展（前向兼容）
  'struct',
  'trait',
  'protocol',
  'data_class',
  'module',
  // re-export 门面（`export { X } from './y'`）：别名条目，真身由目标文件贡献
  're-export',
]);
export type ExportKind = z.infer<typeof ExportKindSchema>;

export const MemberKindSchema = z.enum([
  'method',
  'property',
  'getter',
  'setter',
  'constructor',
  // 多语言扩展（前向兼容）
  'classmethod',
  'staticmethod',
  'associated_function',
]);
export type MemberKind = z.infer<typeof MemberKindSchema>;

export const VisibilitySchema = z.enum(['public', 'protected', 'private']);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const ParserUsedSchema = z.enum([
  'ts-morph',
  'tree-sitter',
  'baseline',
  'reconstructed',
]);
export type ParserUsed = z.infer<typeof ParserUsedSchema>;

export const LanguageSchema = z.enum([
  'typescript',
  'javascript',
  // 多语言扩展（前向兼容）
  'python',
  'go',
  'java',
  'rust',
  'kotlin',
  'cpp',
  'ruby',
  'swift',
]);
export type Language = z.infer<typeof LanguageSchema>;

// --- 嵌套实体 ---

/** class/interface 成员信息 */
export const MemberInfoSchema = z.object({
  name: z.string().min(1),
  kind: MemberKindSchema,
  signature: z.string().min(1),
  jsDoc: z.string().nullable().optional(),
  visibility: VisibilitySchema.optional(),
  isStatic: z.boolean(),
  isAbstract: z.boolean().optional(),
});
export type MemberInfo = z.infer<typeof MemberInfoSchema>;

/** 导出符号 */
export const ExportSymbolSchema = z.object({
  name: z.string().min(1),
  kind: ExportKindSchema,
  signature: z.string().min(1),
  jsDoc: z.string().nullable().optional(),
  typeParameters: z.array(z.string()).optional(),
  isDefault: z.boolean(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  members: z.array(MemberInfoSchema).optional(),
  /**
   * re-export 来源 module specifier 原文（如 `'./stages/graph-assembly.js'`）。
   * 仅 kind==='re-export' 条目携带；用于消费端识别别名并转发到真身文件。
   */
  reExportFrom: z.string().min(1).optional(),
  /**
   * type-only 标记：覆盖语句级 `export type {} from` 与说明符级 `export { type X } from` 两种形态。
   * 仅 kind==='re-export' 条目携带。
   */
  isTypeOnly: z.boolean().optional(),
});
export type ExportSymbol = z.infer<typeof ExportSymbolSchema>;

/**
 * Import 语义类型枚举（Feature 156 W1.0 / FR-28 / AC-11）。
 *
 * - 'static'：标准 ES Module 静态 import
 * - 'dynamic'：动态 import() 调用
 * - 'type-only'：仅类型导入（`import type { ... }`）
 * - 'commonjs-require'：CommonJS require() 调用
 *
 * 注：ModuleEdge.importType 不含 'commonjs-require'，
 * module-derivation 派生时会归并到 'static'（CommonJS 视为同步加载）。
 */
export const ImportSemanticTypeSchema = z.enum([
  'static',
  'dynamic',
  'type-only',
  'commonjs-require',
]);
export type ImportSemanticType = z.infer<typeof ImportSemanticTypeSchema>;

/** 导入引用 */
export const ImportReferenceSchema = z.object({
  moduleSpecifier: z.string().min(1),
  isRelative: z.boolean(),
  resolvedPath: z.string().nullable().optional(),
  namedImports: z.array(z.string()).optional(),
  defaultImport: z.string().nullable().optional(),
  isTypeOnly: z.boolean(),
  /**
   * 语法类型（Feature 156 W1.0 新增；可选，向后兼容）。
   * 由各 analyzer 在抽取 import 时行内派生（ast-analyzer 据 ts-morph 节点、
   * tree-sitter 路径据 isTypeOnly）；写入 CodeSkeleton.imports[].importType；
   * deriveImportEdges 把此值写入 UnifiedGraphEdge.evidence；
   * module-derivation 在重建 ModuleEdge.importType 时读取此字段。
   */
  importType: ImportSemanticTypeSchema.optional(),
  /**
   * 命名空间绑定名 — F242 新增（可选，向后兼容）。
   *
   * 承载「整个 module namespace object 绑定到某个标识符」的三种形态：
   *   - 静态 `import * as ns from 'x'` → `ns`
   *   - 动态 `const m = await import('x')` → `m`
   *   - 动态 `import('x').then((m) => ...)` → `m`
   *
   * 不复用 `defaultImport`：后者语义特指 ES module `export default` 对应的导入绑定，
   * 与 namespace object 语义不同，混用会让 module-derivation 等现有消费方产生歧义。
   *
   * 消费方：call-resolver.buildImportIndex 把它落入 aliasToTarget，使 `ns.fn()` /
   * `m.fn()` 一类调用能走 Stage 3 qualifier 解析，而非产 `?::` 占位后被丢弃。
   */
  namespaceImport: z.string().optional(),
  /**
   * 具名 import 的「源导出名 → 文件内绑定名」二元组视图 — F260 新增（可选，向后兼容）。
   *
   * `namedImports` 记的是**源导出名**（`import { Foo as ExternalFoo }` 记 `'Foo'`），
   * 消费方却普遍把它当**文件内绑定名**用 —— `call-resolver.buildImportIndex` 就据此写
   * `aliasToTarget` 的键，于是表里出现一个本文件根本没有的绑定名 `Foo`。文件里恰好有
   * 别的东西叫 `Foo` 时，`Foo.run()` 会解析出确定性假边（F260 H1）。
   *
   * 不改 `namedImports` 语义而新增字段的理由（plan D1）：`namedImports` 的消费面越过
   * graph 层，波及 code-slice 优先级、prompt 拼装与 Python dot-relative 展开，
   * 改语义的 blast radius 与收益不成比例。
   *
   * **产出规则**：仅当该条 import 语句**至少有一个重命名说明符**时产出；一旦产出即为该
   * 条目 `namedImports` 的**完整**绑定视图（含未重命名项）—— 否则 `import { Foo, Foo as B }`
   * 形态下会误杀合法绑定。无重命名的条目不产出该字段，消费方逐字保持旧行为
   * （Python / Java / Go / 旧 baseline 零变化）。
   *
   * 消费方：`call-resolver.buildImportIndex` 两遍消费 —— `local === imported` 照旧写
   * `aliasToTarget`；`local !== imported` 既不写 `aliasToTarget` 也不写别处，`local`
   * 记入 `ImportInfo.renamedImportAliases` 供三处消费点在查表前拦截。
   */
  namedImportBindings: z
    .array(z.object({ imported: z.string().min(1), local: z.string().min(1) }))
    .optional(),
});
export type ImportReference = z.infer<typeof ImportReferenceSchema>;

/** 单个具名 import 说明符的绑定二元组（`import { imported as local }`）。 */
export type NamedImportBinding = NonNullable<ImportReference['namedImportBindings']>[number];

/**
 * F260 — `namedImportBindings` 的**唯一**产出规则实现（plan D1）。
 *
 * 四条 TS/JS import 抽取路径（ts-morph 静态 / ts-morph dynamic 解构 / tree-sitter 静态 /
 * 正则兜底）共用本函数，规则因此只有一处定义：**至少一个说明符重命名才产出，产出即为完整
 * 绑定视图**。F259 的教训是「两个函数协同才成立的隐式耦合」会静默失效 —— 把规则复制到
 * 四个抽取点等于埋四份漂移风险，故此处集中。
 *
 * @param specifiers 逐个说明符的 `{ imported, local }`；`local` 缺省表示未重命名。
 * @returns 存在重命名时返回完整绑定列表，否则返回 `undefined`（调用方不写该字段）。
 */
export function buildNamedImportBindings(
  specifiers: ReadonlyArray<{ imported: string; local?: string | null | undefined }>,
): NamedImportBinding[] | undefined {
  const bindings = specifiers.map((s) => ({ imported: s.imported, local: s.local || s.imported }));
  return bindings.some((b) => b.local !== b.imported) ? bindings : undefined;
}

/** 解析错误 */
export const ParseErrorSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  message: z.string().min(1),
  affectedSymbols: z.array(z.string()).optional(),
});
export type ParseError = z.infer<typeof ParseErrorSchema>;

// --- 主实体 ---

/** AST 提取的文件结构中间表示 */
export const CodeSkeletonSchema = z.object({
  filePath: z.string().regex(/\.(ts|tsx|js|jsx|py|pyi|go|java|kt|kts|rs|cpp|cc|cxx|c|h|hpp|rb|swift)$/),
  language: LanguageSchema,
  loc: z.number().int().positive(),
  exports: z.array(ExportSymbolSchema),
  imports: z.array(ImportReferenceSchema),
  parseErrors: z.array(ParseErrorSchema).optional(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  analyzedAt: z.string().datetime(),
  parserUsed: ParserUsedSchema,
  moduleDoc: z.string().optional(),
  // FR-4 + CL-01：Feature 151 新增 — 函数调用点列表（optional，向后兼容旧 baseline）
  callSites: z.array(CallSiteSchema).optional(),
});
export type CodeSkeleton = z.infer<typeof CodeSkeletonSchema>;

// --- 代码切片（FR-001, FR-004, FR-010）---

/**
 * 代码切片的优先级枚举
 * P1：公开导出函数（最高优先级）
 * P2：被多处 import 的内部函数
 * P3：含复杂控制流的函数
 */
export enum CodeSlicePriority {
  P1_PUBLIC_EXPORT = 1,
  P2_MULTI_IMPORT = 2,
  P3_COMPLEX_CONTROL_FLOW = 3,
}

/**
 * 函数体的控制流骨架切片
 * 包含条件分支结构、核心调用链和关键常量引用
 * 去除了注释、空行和具体实现细节
 */
export interface CodeSlice {
  /** 来源文件路径 */
  filePath: string;
  /** 函数或方法名称 */
  symbolName: string;
  /** 函数签名 */
  signature: string;
  /** 控制流骨架行（保留 if/for/try/return/调用，移除注释和空行） */
  controlFlowLines: string[];
  /** 优先级（数值越小优先级越高） */
  priority: CodeSlicePriority;
  /** 估算的 token 数 */
  estimatedTokens: number;
  /** 原始起始行号（1-based） */
  startLine: number;
  /** 原始结束行号（1-based） */
  endLine: number;
}
