/**
 * DataModelGenerator — 通用数据模型文档生成器
 *
 * 从 Python dataclass / Pydantic BaseModel / TypeScript interface / type alias
 * 中提取字段定义，生成数据模型参考文档和 Mermaid ER 图。
 *
 * 实现 DocumentGenerator<DataModelInput, DataModelOutput> 接口。
 *
 * 提取策略：
 * - Python: 通过 TreeSitterAnalyzer 获取 CodeSkeleton 识别 class，
 *   读取源文件文本按行提取字段声明
 * - TypeScript: 通过 TreeSitterAnalyzer 获取 CodeSkeleton，
 *   从 exports 中筛选 interface/type，从 members 提取 property
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import Handlebars from 'handlebars';
import type { DocumentGenerator, ProjectContext, GenerateOptions } from './interfaces.js';
import type { CodeSkeleton, ExportSymbol } from '../models/code-skeleton.js';
import { TreeSitterAnalyzer } from '../core/tree-sitter-analyzer.js';
import { scanFiles } from '../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';

// ============================================================
// Zod Schema + TypeScript 类型
// ============================================================

/** 单个数据模型字段 Schema */
export const DataModelFieldSchema = z.object({
  /** 字段名称 */
  name: z.string().min(1),
  /** 类型注解的原始文本 */
  typeStr: z.string().min(1),
  /** 是否可选 */
  optional: z.boolean(),
  /** 默认值文本（无默认值时为 null） */
  defaultValue: z.string().nullable(),
  /** 字段描述 */
  description: z.string().nullable(),
});
export type DataModelField = z.infer<typeof DataModelFieldSchema>;

/** 数据模型类型枚举 */
export const DataModelKindSchema = z.enum([
  'dataclass', 'pydantic', 'interface', 'type',
]);
export type DataModelKind = z.infer<typeof DataModelKindSchema>;

/** 单个数据模型 Schema */
export const DataModelSchema = z.object({
  /** 模型名称 */
  name: z.string().min(1),
  /** 源文件相对路径 */
  filePath: z.string().min(1),
  /** 所属语言 */
  language: z.enum(['python', 'typescript']),
  /** 模型定义类型 */
  kind: DataModelKindSchema,
  /** 字段列表 */
  fields: z.array(DataModelFieldSchema),
  /** 基类/扩展接口名称列表 */
  bases: z.array(z.string()),
  /** 模型级描述 */
  description: z.string().nullable(),
});
export type DataModel = z.infer<typeof DataModelSchema>;

/** 关系类型枚举 */
export const RelationTypeSchema = z.enum(['inherits', 'has', 'contains']);

/** 模型间关系 Schema */
export const ModelRelationSchema = z.object({
  /** 源模型名称 */
  source: z.string().min(1),
  /** 目标模型名称 */
  target: z.string().min(1),
  /** 关系类型 */
  type: RelationTypeSchema,
});
export type ModelRelation = z.infer<typeof ModelRelationSchema>;

/** DataModelGenerator.extract() 的输出类型 Schema */
export const DataModelInputSchema = z.object({
  models: z.array(DataModelSchema),
  relations: z.array(ModelRelationSchema),
  sourceFiles: z.array(z.string()),
});
export type DataModelInput = z.infer<typeof DataModelInputSchema>;

/** 统计摘要 Schema */
export const SummarySchema = z.object({
  totalModels: z.number().int().nonnegative(),
  totalFields: z.number().int().nonnegative(),
  byLanguage: z.record(z.string(), z.number()),
  byKind: z.record(z.string(), z.number()),
});

/** DataModelGenerator.generate() 的输出类型 Schema */
export const DataModelOutputSchema = z.object({
  models: z.array(DataModelSchema),
  relations: z.array(ModelRelationSchema),
  erDiagram: z.string(),
  summary: SummarySchema,
});
export type DataModelOutput = z.infer<typeof DataModelOutputSchema>;

// ============================================================
// 已知 Pydantic 基类名称集合
// ============================================================

const PYDANTIC_BASE_CLASSES = new Set([
  'BaseModel', 'BaseSettings', 'BaseConfig',
]);

// ============================================================
// 导出的纯函数（供单元测试使用）
// ============================================================

/**
 * 解析 Pydantic Field() 调用，提取 default 和 description
 *
 * @param text - Field(...) 调用文本
 * @returns default 和 description
 */
export function parsePydanticFieldCall(text: string): {
  default: string | null;
  description: string | null;
} {
  let defaultValue: string | null = null;
  let description: string | null = null;

  // 提取 default=...
  const defaultMatch = text.match(/\bdefault\s*=\s*([^,)]+)/);
  if (defaultMatch) {
    defaultValue = defaultMatch[1]!.trim();
  }

  // 提取 default_factory=...
  if (!defaultValue) {
    const factoryMatch = text.match(/\bdefault_factory\s*=\s*([^,)]+)/);
    if (factoryMatch) {
      defaultValue = `${factoryMatch[1]!.trim()}()`;
    }
  }

  // 提取 description="..." 或 description='...'
  const descMatch = text.match(/\bdescription\s*=\s*["']([^"']*?)["']/);
  if (descMatch) {
    description = descMatch[1]!;
  }

  // 如果没有 default= 但有位置参数，第一个位置参数是默认值
  if (!defaultValue) {
    const argsContent = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const firstArg = argsContent.split(',')[0]?.trim();
    if (firstArg && !firstArg.includes('=') && firstArg !== '...') {
      defaultValue = firstArg;
    }
  }

  return { default: defaultValue, description };
}

/**
 * 从 Python 类源代码行中提取字段声明
 * 使用 AST 确定的类边界（startLine/endLine），从源文本提取字段
 *
 * @param sourceLines - 源文件按行分割的数组
 * @param startLine - 类定义起始行（1-based，含装饰器）
 * @param endLine - 类定义结束行（1-based）
 * @returns 字段列表
 */
export function extractPythonFieldsFromLines(
  sourceLines: string[],
  startLine: number,
  endLine: number,
): DataModelField[] {
  const fields: DataModelField[] = [];
  const classLines = sourceLines.slice(startLine - 1, endLine);

  // 找到 class body 的缩进级别
  // class 行通常是 "class Foo(Bar):" 或 "@dataclass\nclass Foo:"
  let bodyIndent = -1;

  for (const line of classLines) {
    const trimmed = line.trim();
    // 跳过装饰器行、class 定义行、空行、注释、docstring
    if (!trimmed ||
        trimmed.startsWith('@') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('"""') ||
        trimmed.startsWith("'''") ||
        trimmed === 'pass') {
      continue;
    }

    // 跳过方法定义
    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      continue;
    }

    // 确定 body 缩进级别（第一个非装饰器/class/空行的缩进）
    if (bodyIndent < 0) {
      bodyIndent = line.length - line.trimStart().length;
    }

    // 只处理顶层 body 缩进的行（跳过方法内部的行）
    const currentIndent = line.length - line.trimStart().length;
    if (currentIndent !== bodyIndent) {
      continue;
    }

    // 尝试解析字段声明: name: type = default
    const field = parseFieldDeclaration(trimmed);
    if (field) {
      fields.push(field);
    }
  }

  return fields;
}

/**
 * 解析单行字段声明
 *
 * @param line - 去除缩进的单行文本
 * @returns DataModelField 或 null
 */
function parseFieldDeclaration(line: string): DataModelField | null {
  // 找到第一个 ':'（注意不能是 dict/slice 的 ':'）
  const colonIdx = line.indexOf(':');
  if (colonIdx <= 0) return null;

  const name = line.slice(0, colonIdx).trim();
  // 字段名必须是合法的 Python 标识符
  if (!/^[a-zA-Z_]\w*$/.test(name)) return null;
  // 跳过私有字段（双下划线开头但非 dunder）
  if (name.startsWith('__') && !name.endsWith('__')) return null;

  const afterColon = line.slice(colonIdx + 1).trim();
  if (!afterColon) return null;

  // 找到 '=' 分隔符（不在括号/方括号内部）
  let eqIdx = -1;
  let depth = 0;
  for (let i = 0; i < afterColon.length; i++) {
    const ch = afterColon[i]!;
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === '=' && depth === 0) {
      eqIdx = i;
      break;
    }
  }

  let typeStr: string;
  let defaultValue: string | null = null;
  let description: string | null = null;

  if (eqIdx > 0) {
    typeStr = afterColon.slice(0, eqIdx).trim();
    const rawDefault = afterColon.slice(eqIdx + 1).trim();

    // 解析 Pydantic Field() 调用
    if (rawDefault.startsWith('Field(') || rawDefault.startsWith('field(')) {
      const parsed = parsePydanticFieldCall(rawDefault);
      defaultValue = parsed.default;
      description = parsed.description;
    } else {
      defaultValue = rawDefault;
    }
  } else {
    typeStr = afterColon;
  }

  // 判断可选性
  const optional = typeStr.includes('Optional[') ||
                   typeStr.includes('| None') ||
                   typeStr.includes('None |');

  return { name, typeStr, optional, defaultValue, description };
}

/**
 * 从 TypeScript CodeSkeleton 中提取数据模型
 *
 * @param skeleton - TreeSitterAnalyzer 输出的 CodeSkeleton
 * @param projectRoot - 项目根目录（用于计算相对路径）
 * @returns DataModel 列表
 */
export function extractTypeScriptModelsFromSkeleton(
  skeleton: CodeSkeleton,
  projectRoot: string,
): DataModel[] {
  const models: DataModel[] = [];
  const relFilePath = path.relative(projectRoot, skeleton.filePath);

  for (const exp of skeleton.exports) {
    if (exp.kind !== 'interface' && exp.kind !== 'type') continue;

    // 从 signature 解析基类/扩展
    const bases = parseBasesFromTsSignature(exp.signature);

    // 从 members 提取属性字段
    const fields = extractFieldsFromTsMembers(exp);

    // 只保留有字段的 interface 和 type（跳过联合类型等无字段的 type alias）
    if (exp.kind === 'type' && fields.length === 0) continue;

    models.push({
      name: exp.name,
      filePath: relFilePath,
      language: 'typescript',
      kind: exp.kind === 'interface' ? 'interface' : 'type',
      fields,
      bases,
      description: exp.jsDoc ?? null,
    });
  }

  return models;
}

/**
 * 从 TypeScript 签名中解析 extends 的接口名
 */
function parseBasesFromTsSignature(signature: string): string[] {
  const extendsMatch = signature.match(/\bextends\s+(.+)/);
  if (!extendsMatch) return [];
  return extendsMatch[1]!.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * 从 ExportSymbol 的 members 中提取属性字段
 */
function extractFieldsFromTsMembers(exp: ExportSymbol): DataModelField[] {
  const fields: DataModelField[] = [];
  if (!exp.members) return fields;

  for (const member of exp.members) {
    if (member.kind !== 'property') continue;

    // member.signature 格式: "name: string" 或 "name?: number"
    const sig = member.signature;
    const colonIdx = sig.indexOf(':');
    if (colonIdx <= 0) continue;

    let name = sig.slice(0, colonIdx).trim();
    const typeStr = sig.slice(colonIdx + 1).trim();

    // 检查可选标记 '?'
    const optional = name.endsWith('?');
    if (optional) {
      name = name.slice(0, -1);
    }

    fields.push({
      name,
      typeStr,
      optional,
      defaultValue: null, // TypeScript interface 没有默认值
      description: member.jsDoc ?? null,
    });
  }

  return fields;
}

/**
 * 从数据模型列表中构建模型间关系
 *
 * @param models - 数据模型列表
 * @returns 关系列表（去重）
 */
export function buildModelRelations(models: DataModel[]): ModelRelation[] {
  const relations: ModelRelation[] = [];
  const modelNames = new Set(models.map(m => m.name));
  const seen = new Set<string>();

  for (const model of models) {
    // 继承关系
    for (const base of model.bases) {
      // 提取基类的简单名称（去除泛型参数）
      const baseName = base.replace(/<.*>/, '').replace(/\[.*\]/, '').trim();
      if (modelNames.has(baseName)) {
        const key = `${model.name}->inherits->${baseName}`;
        if (!seen.has(key)) {
          seen.add(key);
          relations.push({ source: model.name, target: baseName, type: 'inherits' });
        }
      }
    }

    // 字段引用关系
    for (const field of model.fields) {
      for (const targetName of modelNames) {
        if (targetName === model.name) continue;

        // 检查字段类型是否引用目标模型
        if (!field.typeStr.includes(targetName)) continue;

        // 判断是集合引用还是单值引用
        const isCollection = isCollectionType(field.typeStr, targetName);
        const relType = isCollection ? 'contains' : 'has';
        const key = `${model.name}->${relType}->${targetName}`;

        if (!seen.has(key)) {
          seen.add(key);
          relations.push({ source: model.name, target: targetName, type: relType });
        }
      }
    }
  }

  return relations;
}

/**
 * 判断字段类型是否为集合引用
 */
function isCollectionType(typeStr: string, targetName: string): boolean {
  // Python: List[Model], Set[Model], Sequence[Model]
  // TypeScript: Model[], Array<Model>
  const patterns = [
    new RegExp(`List\\[.*${escapeRegex(targetName)}`),
    new RegExp(`Set\\[.*${escapeRegex(targetName)}`),
    new RegExp(`Sequence\\[.*${escapeRegex(targetName)}`),
    new RegExp(`${escapeRegex(targetName)}\\[\\]`),
    new RegExp(`Array<.*${escapeRegex(targetName)}`),
  ];
  return patterns.some(p => p.test(typeStr));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成 Mermaid erDiagram 代码
 *
 * @param models - 数据模型列表
 * @param relations - 模型间关系列表
 * @returns Mermaid erDiagram 源代码
 */
export function generateMermaidErDiagram(
  models: DataModel[],
  relations: ModelRelation[],
): string {
  if (models.length === 0) return '';

  const lines: string[] = ['erDiagram'];

  // 实体定义
  for (const model of models) {
    if (model.fields.length === 0) {
      // 无字段的实体仅声明名称
      lines.push(`    ${sanitizeMermaidId(model.name)} {`);
      lines.push('    }');
    } else {
      lines.push(`    ${sanitizeMermaidId(model.name)} {`);
      for (const field of model.fields) {
        const mermaidType = sanitizeMermaidType(field.typeStr);
        lines.push(`        ${mermaidType} ${sanitizeMermaidId(field.name)}`);
      }
      lines.push('    }');
    }
  }

  // 关系线
  for (const rel of relations) {
    const source = sanitizeMermaidId(rel.source);
    const target = sanitizeMermaidId(rel.target);
    switch (rel.type) {
      case 'inherits':
        lines.push(`    ${target} ||--o{ ${source} : "inherits"`);
        break;
      case 'has':
        lines.push(`    ${source} ||--o| ${target} : "has"`);
        break;
      case 'contains':
        lines.push(`    ${source} ||--|{ ${target} : "contains"`);
        break;
    }
  }

  return lines.join('\n');
}

/**
 * 清理 Mermaid 标识符（移除不允许的字符）
 */
function sanitizeMermaidId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * 将复杂类型字符串转换为 Mermaid 友好格式
 */
function sanitizeMermaidType(typeStr: string): string {
  // 替换特殊字符
  return typeStr
    .replace(/\[/g, '_')
    .replace(/\]/g, '_')
    .replace(/</g, '_')
    .replace(/>/g, '_')
    .replace(/\|/g, '_')
    .replace(/\s/g, '')
    .replace(/[^a-zA-Z0-9_?]/g, '');
}

// ============================================================
// Handlebars 模板
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'data-model.hbs');

let compiledTemplate: Handlebars.TemplateDelegate | null = null;

function getTemplate(): Handlebars.TemplateDelegate {
  if (compiledTemplate) return compiledTemplate;

  const templateSrc = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  compiledTemplate = Handlebars.compile(templateSrc, { noEscape: true });
  return compiledTemplate;
}

// ============================================================
// DataModelGenerator 类
// ============================================================

/**
 * 通用数据模型文档生成器
 * 实现 DocumentGenerator<DataModelInput, DataModelOutput>
 *
 * 生命周期: isApplicable → extract → generate → render
 */
export class DataModelGenerator
  implements DocumentGenerator<DataModelInput, DataModelOutput>
{
  readonly id = 'data-model' as const;
  readonly name = 'Data Model Generator' as const;
  readonly description = '从 Python dataclass / Pydantic model / TypeScript interface 提取字段定义，生成数据模型文档和 Mermaid ER 图';

  /**
   * 判断当前项目是否适用此 Generator
   * 检查 detectedLanguages 是否包含 Python 或 TypeScript
   */
  isApplicable(context: ProjectContext): boolean {
    return context.detectedLanguages.includes('python') ||
           context.detectedLanguages.includes('typescript');
  }

  /**
   * 从项目中提取数据模型定义
   *
   * Python: 使用 TreeSitterAnalyzer 获取 CodeSkeleton，识别 @dataclass 和 BaseModel 类，
   *         从源文件文本提取字段声明
   * TypeScript: 使用 TreeSitterAnalyzer 获取 CodeSkeleton，筛选 interface/type exports
   */
  async extract(context: ProjectContext): Promise<DataModelInput> {
    const models: DataModel[] = [];
    const sourceFiles: string[] = [];

    // 尝试扫描文件
    let filePaths: string[] = [];
    try {
      const registry = LanguageAdapterRegistry.getInstance();
      if (!registry.isEmpty()) {
        const result = scanFiles(context.projectRoot, { projectRoot: context.projectRoot });
        filePaths = result.files.map(f =>
          path.isAbsolute(f) ? f : path.join(context.projectRoot, f),
        );
      }
    } catch {
      // scanFiles 失败时回退到空列表
    }

    // Python 文件处理
    if (context.detectedLanguages.includes('python')) {
      const pyFiles = filePaths.filter(f => f.endsWith('.py') || f.endsWith('.pyi'));
      for (const filePath of pyFiles) {
        try {
          const pyModels = await this.extractPythonModelsFromFile(filePath, context.projectRoot);
          models.push(...pyModels);
          if (pyModels.length > 0) {
            sourceFiles.push(path.relative(context.projectRoot, filePath));
          }
        } catch {
          // 单文件解析失败，跳过继续
        }
      }
    }

    // TypeScript 文件处理
    if (context.detectedLanguages.includes('typescript')) {
      const tsFiles = filePaths.filter(f =>
        (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.d.ts'),
      );
      for (const filePath of tsFiles) {
        try {
          const tsModels = await this.extractTypeScriptModelsFromFile(filePath, context.projectRoot);
          models.push(...tsModels);
          if (tsModels.length > 0) {
            sourceFiles.push(path.relative(context.projectRoot, filePath));
          }
        } catch {
          // 单文件解析失败，跳过继续
        }
      }
    }

    const relations = buildModelRelations(models);

    return { models, relations, sourceFiles };
  }

  /**
   * 将提取的数据转换为结构化输出
   */
  async generate(
    input: DataModelInput,
    _options?: GenerateOptions,
  ): Promise<DataModelOutput> {
    // 按语言和文件路径排序
    const sortedModels = [...input.models].sort((a, b) => {
      if (a.language !== b.language) return a.language.localeCompare(b.language);
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      return a.name.localeCompare(b.name);
    });

    // 构建统计摘要
    const byLanguage: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    let totalFields = 0;

    for (const model of sortedModels) {
      byLanguage[model.language] = (byLanguage[model.language] ?? 0) + 1;
      byKind[model.kind] = (byKind[model.kind] ?? 0) + 1;
      totalFields += model.fields.length;
    }

    // 生成 ER 图
    const erDiagram = generateMermaidErDiagram(sortedModels, input.relations);

    return {
      models: sortedModels,
      relations: input.relations,
      erDiagram,
      summary: {
        totalModels: sortedModels.length,
        totalFields,
        byLanguage,
        byKind,
      },
    };
  }

  /**
   * 将输出渲染为 Markdown 字符串
   */
  render(output: DataModelOutput): string {
    if (output.models.length === 0) {
      return [
        '# 数据模型文档',
        '',
        '> 未检测到数据模型定义。',
        '',
      ].join('\n');
    }

    const template = getTemplate();

    // 按语言分组
    const pythonModels = output.models.filter(m => m.language === 'python');
    const tsModels = output.models.filter(m => m.language === 'typescript');

    return template({
      ...output,
      pythonModels: pythonModels.length > 0 ? pythonModels : null,
      tsModels: tsModels.length > 0 ? tsModels : null,
    });
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 从单个 Python 文件中提取数据模型
   */
  private async extractPythonModelsFromFile(
    filePath: string,
    projectRoot: string,
  ): Promise<DataModel[]> {
    const analyzer = TreeSitterAnalyzer.getInstance();
    const skeleton = await analyzer.analyze(filePath, 'python');

    const source = fs.readFileSync(filePath, 'utf-8');
    const sourceLines = source.split('\n');
    const relFilePath = path.relative(projectRoot, filePath);
    const models: DataModel[] = [];

    for (const exp of skeleton.exports) {
      if (exp.kind !== 'class') continue;

      // 从 ExportSymbol 的 startLine..endLine 范围的源代码判断类型
      const classSource = sourceLines
        .slice(exp.startLine - 1, exp.endLine)
        .join('\n');

      const isDataclass = classSource.includes('@dataclass');
      const bases = parsePythonBases(exp.signature);
      const isPydantic = bases.some(b => PYDANTIC_BASE_CLASSES.has(b));

      if (!isDataclass && !isPydantic) continue;

      // 提取字段
      const fields = extractPythonFieldsFromLines(
        sourceLines,
        exp.startLine,
        exp.endLine,
      );

      models.push({
        name: exp.name,
        filePath: relFilePath,
        language: 'python',
        kind: isPydantic ? 'pydantic' : 'dataclass',
        fields,
        bases: bases.filter(b => !PYDANTIC_BASE_CLASSES.has(b)),
        description: null,
      });
    }

    return models;
  }

  /**
   * 从单个 TypeScript 文件中提取数据模型
   */
  private async extractTypeScriptModelsFromFile(
    filePath: string,
    projectRoot: string,
  ): Promise<DataModel[]> {
    const analyzer = TreeSitterAnalyzer.getInstance();
    const skeleton = await analyzer.analyze(filePath, 'typescript');
    return extractTypeScriptModelsFromSkeleton(skeleton, projectRoot);
  }
}

/**
 * 从 Python 类签名中解析基类列表
 * 签名格式: "class Foo(Bar, Baz)"
 */
function parsePythonBases(signature: string): string[] {
  const match = signature.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1]!.split(',').map(s => s.trim()).filter(Boolean);
}
