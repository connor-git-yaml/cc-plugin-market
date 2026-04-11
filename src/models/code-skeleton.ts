/**
 * CodeSkeleton 及相关嵌套实体的 Zod Schema 定义
 * 流水线第一阶段输出：AST 提取的文件结构中间表示
 */
import { z } from 'zod';

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
});
export type ExportSymbol = z.infer<typeof ExportSymbolSchema>;

/** 导入引用 */
export const ImportReferenceSchema = z.object({
  moduleSpecifier: z.string().min(1),
  isRelative: z.boolean(),
  resolvedPath: z.string().nullable().optional(),
  namedImports: z.array(z.string()).optional(),
  defaultImport: z.string().nullable().optional(),
  isTypeOnly: z.boolean(),
});
export type ImportReference = z.infer<typeof ImportReferenceSchema>;

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
