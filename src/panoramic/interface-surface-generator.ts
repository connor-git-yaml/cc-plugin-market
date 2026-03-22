/**
 * InterfaceSurfaceGenerator
 *
 * 面向 library / SDK / public interface 项目生成接口摘要文档。
 * 复用既有 module spec 的 baseline skeleton，不新增新的底层语言解析链路。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExportSymbol, MemberInfo } from '../models/code-skeleton.js';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import {
  parseStoredModuleSpec,
  type StoredModuleSpecRecord,
} from './stored-module-specs.js';
import { loadTemplate } from './utils/template-loader.js';

export type InterfaceSurfaceRole = 'entrypoint' | 'core' | 'support';

export interface InterfaceSurfaceSymbol {
  moduleName: string;
  ownerName?: string;
  name: string;
  kind: string;
  signature: string;
  note: string;
  inferred: boolean;
}

export interface InterfaceSurfaceModule {
  sourceTarget: string;
  displayName: string;
  role: InterfaceSurfaceRole;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  relatedFiles: string[];
  exportedSymbols: InterfaceSurfaceSymbol[];
  publicMethods: InterfaceSurfaceSymbol[];
}

export interface InterfaceSurfaceInput {
  projectName: string;
  modules: InterfaceSurfaceModule[];
  warnings: string[];
}

export interface InterfaceSurfaceOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  summary: string[];
  modules: InterfaceSurfaceModule[];
  entryModules: InterfaceSurfaceModule[];
  keySymbols: InterfaceSurfaceSymbol[];
  keyMethods: InterfaceSurfaceSymbol[];
  totalModules: number;
  totalSymbols: number;
  totalMethods: number;
  warnings: string[];
}

const ENTRYPOINT_FILE_PATTERN = /(^|\/)(__init__\.py|index\.(?:[cm]?js|[cm]?ts|jsx|tsx)|client\.(?:py|ts|js)|query\.(?:py|ts|js))$/i;
const LOW_SIGNAL_PATH_PATTERN = /(^|\/)(tests?|specs?|examples?|demos?|scripts?|benchmarks?|fixtures?|e2e(?:-tests)?)($|\/)/i;
const CORE_SIGNAL_PATTERN = /(client|query|sdk|session|transport|parser|types?|hooks?|tool|message|runtime|protocol|agent)/i;
const IGNORED_DISCOVERY_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'bundles',
]);
const PUBLIC_SYMBOL_KINDS = new Set([
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'const',
  'variable',
  'struct',
  'trait',
  'protocol',
  'data_class',
  'module',
]);
const PUBLIC_MEMBER_KINDS = new Set([
  'method',
  'getter',
  'setter',
  'classmethod',
  'staticmethod',
  'associated_function',
]);

export class InterfaceSurfaceGenerator
  implements DocumentGenerator<InterfaceSurfaceInput, InterfaceSurfaceOutput>
{
  readonly id = 'interface-surface' as const;
  readonly name = 'Interface Surface 生成器' as const;
  readonly description = '为 library / SDK 项目生成公开接口、关键类与关键方法摘要';

  async isApplicable(context: ProjectContext): Promise<boolean> {
    const modules = collectInterfaceModules(context);
    if (modules.length === 0) {
      return false;
    }
    return looksLikeLibrarySdkProject(context, modules);
  }

  async extract(context: ProjectContext): Promise<InterfaceSurfaceInput> {
    const modules = collectInterfaceModules(context);
    const warnings: string[] = [];

    if (modules.length === 0) {
      warnings.push('未发现可用于 interface-surface 的 module spec / baseline skeleton。');
    }

    return {
      projectName: detectProjectName(context.projectRoot),
      modules,
      warnings,
    };
  }

  async generate(
    input: InterfaceSurfaceInput,
    _options?: GenerateOptions,
  ): Promise<InterfaceSurfaceOutput> {
    const sortedModules = [...input.modules].sort(compareInterfaceModules);
    const entryModules = sortedModules.filter((module) => module.role === 'entrypoint');
    const keySymbols = collectKeyItems(
      sortedModules,
      (module) => module.exportedSymbols,
      (item) => `${item.moduleName}:${item.kind}:${item.name}`,
      12,
    );
    const keyMethods = collectKeyItems(
      sortedModules,
      (module) => module.publicMethods,
      (item) => `${item.moduleName}:${item.ownerName ?? 'module'}:${item.kind}:${item.name}`,
      12,
    );
    const totalSymbols = sortedModules.reduce((sum, module) => sum + module.exportedSymbols.length, 0);
    const totalMethods = sortedModules.reduce((sum, module) => sum + module.publicMethods.length, 0);

    return {
      title: `Interface Surface: ${input.projectName}`,
      generatedAt: new Date().toISOString().split('T')[0]!,
      projectName: input.projectName,
      summary: buildSummary(input.projectName, sortedModules, totalSymbols, totalMethods),
      modules: sortedModules,
      entryModules,
      keySymbols,
      keyMethods,
      totalModules: sortedModules.length,
      totalSymbols,
      totalMethods,
      warnings: input.warnings,
    };
  }

  render(output: InterfaceSurfaceOutput): string {
    const template = loadTemplate('interface-surface.hbs', import.meta.url);
    return template(output);
  }
}

function collectInterfaceModules(context: ProjectContext): InterfaceSurfaceModule[] {
  const storedModules = discoverStoredSpecPaths(context)
    .map((specPath) => parseStoredModuleSpec(specPath, context.projectRoot))
    .filter((record): record is StoredModuleSpecRecord => record !== null);

  const interfaceModules = storedModules
    .map((record) => toInterfaceModule(record))
    .filter((module): module is InterfaceSurfaceModule => module !== null);

  const highSignalModules = interfaceModules.filter((module) => !isLowSignalPath(module.sourceTarget));
  return highSignalModules.length > 0 ? highSignalModules : interfaceModules;
}

function discoverStoredSpecPaths(context: ProjectContext): string[] {
  const seen = new Set<string>();
  const specPaths: string[] = [];

  for (const existingSpec of context.existingSpecs) {
    seen.add(existingSpec);
    specPaths.push(existingSpec);
  }

  walkStoredSpecPaths(context.projectRoot, specPaths, seen);
  return specPaths.sort((left, right) => left.localeCompare(right));
}

function walkStoredSpecPaths(dir: string, results: string[], seen: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DISCOVERY_DIRS.has(entry.name)) {
        continue;
      }
      walkStoredSpecPaths(fullPath, results, seen);
      continue;
    }

    if (
      entry.isFile()
      && entry.name.endsWith('.spec.md')
      && entry.name !== '_index.spec.md'
      && !seen.has(fullPath)
    ) {
      seen.add(fullPath);
      results.push(fullPath);
    }
  }
}

function toInterfaceModule(record: StoredModuleSpecRecord): InterfaceSurfaceModule | null {
  const exportedSymbols = collectPublicSymbols(record);
  const publicMethods = collectPublicMethods(record);
  if (exportedSymbols.length === 0 && publicMethods.length === 0) {
    return null;
  }

  return {
    sourceTarget: record.sourceTarget,
    displayName: record.sourceTarget,
    role: classifyRole(record.sourceTarget),
    confidence: record.confidence,
    summary: pickFirstNonEmpty([
      record.intentSummary,
      record.businessSummary,
      record.dependencySummary,
      `${record.sourceTarget} 暴露项目的公开接口与关键入口`,
    ]),
    relatedFiles: record.relatedFiles,
    exportedSymbols,
    publicMethods,
  };
}

function collectPublicSymbols(record: StoredModuleSpecRecord): InterfaceSurfaceSymbol[] {
  return (record.baselineSkeleton?.exports ?? [])
    .filter((symbol) => PUBLIC_SYMBOL_KINDS.has(symbol.kind) && isPublicName(symbol.name))
    .map((symbol) => ({
      moduleName: record.sourceTarget,
      name: symbol.name,
      kind: symbol.kind,
      signature: symbol.signature,
      note: summarizeSymbolNote(symbol, record.intentSummary),
      inferred: record.confidence === 'low',
    }))
    .sort(compareInterfaceSymbols);
}

function collectPublicMethods(record: StoredModuleSpecRecord): InterfaceSurfaceSymbol[] {
  const methods: InterfaceSurfaceSymbol[] = [];

  for (const symbol of record.baselineSkeleton?.exports ?? []) {
    if (symbol.kind === 'function' && isPublicName(symbol.name)) {
      methods.push({
        moduleName: record.sourceTarget,
        name: symbol.name,
        kind: 'function',
        signature: symbol.signature,
        note: summarizeSymbolNote(symbol, record.businessSummary),
        inferred: record.confidence === 'low',
      });
    }

    for (const member of symbol.members ?? []) {
      if (!PUBLIC_MEMBER_KINDS.has(member.kind)) {
        continue;
      }
      if (member.visibility === 'private' || !isPublicName(member.name) || member.kind === 'constructor') {
        continue;
      }
      methods.push({
        moduleName: record.sourceTarget,
        ownerName: symbol.name,
        name: member.name,
        kind: member.kind,
        signature: member.signature,
        note: summarizeMemberNote(member, symbol.name, record.businessSummary),
        inferred: record.confidence === 'low',
      });
    }
  }

  return methods.sort(compareInterfaceSymbols);
}

function looksLikeLibrarySdkProject(
  context: ProjectContext,
  modules: InterfaceSurfaceModule[],
): boolean {
  if (modules.length === 0) {
    return false;
  }

  if (looksLikeNodeLibrary(context.projectRoot) || looksLikePythonLibrary(context.projectRoot)) {
    return true;
  }

  if (hasRuntimeArtifacts(context)) {
    return false;
  }

  return modules.some((module) => module.role === 'entrypoint');
}

function looksLikeNodeLibrary(projectRoot: string): boolean {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>;
    if (pkg.exports || pkg.main || pkg.module || pkg.types || pkg.typings) {
      return true;
    }
    const keywords = Array.isArray(pkg.keywords)
      ? pkg.keywords.filter((item): item is string => typeof item === 'string')
      : [];
    return keywords.some((keyword) => /(sdk|library|client|plugin|toolkit|api-client)/i.test(keyword));
  } catch {
    return false;
  }
}

function looksLikePythonLibrary(projectRoot: string): boolean {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(pyprojectPath, 'utf-8');
    return /^\[project\]/m.test(content) || /^\[tool\.poetry\]/m.test(content);
  } catch {
    return false;
  }
}

function hasRuntimeArtifacts(context: ProjectContext): boolean {
  const runtimeFiles = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'];
  return runtimeFiles.some((fileName) =>
    context.configFiles.has(fileName) || fs.existsSync(path.join(context.projectRoot, fileName)),
  );
}

function detectProjectName(projectRoot: string): string {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
        return pkg.name.trim();
      }
    } catch {
      // ignore
    }
  }

  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) {
        return match[1];
      }
    } catch {
      // ignore
    }
  }

  return path.basename(projectRoot);
}

function classifyRole(sourceTarget: string): InterfaceSurfaceRole {
  if (ENTRYPOINT_FILE_PATTERN.test(sourceTarget)) {
    return 'entrypoint';
  }
  if (CORE_SIGNAL_PATTERN.test(sourceTarget)) {
    return 'core';
  }
  return 'support';
}

function isLowSignalPath(sourceTarget: string): boolean {
  return LOW_SIGNAL_PATH_PATTERN.test(sourceTarget);
}

function isPublicName(name: string): boolean {
  return name.length > 0 && !name.startsWith('_');
}

function summarizeSymbolNote(symbol: ExportSymbol, fallback: string): string {
  return pickFirstNonEmpty([
    symbol.jsDoc ?? '',
    symbol.kind === 'class' ? `${symbol.name} 是公开类入口` : '',
    symbol.kind === 'function' ? `${symbol.name} 是公开函数入口` : '',
    fallback,
  ]);
}

function summarizeMemberNote(member: MemberInfo, ownerName: string, fallback: string): string {
  return pickFirstNonEmpty([
    member.jsDoc ?? '',
    `${ownerName}.${member.name} 是对外可见的 ${member.kind}`,
    fallback,
  ]);
}

function pickFirstNonEmpty(values: string[]): string {
  return values.find((value) => value.trim().length > 0)?.trim() ?? '';
}

function compareInterfaceModules(left: InterfaceSurfaceModule, right: InterfaceSurfaceModule): number {
  return moduleScore(right) - moduleScore(left)
    || right.exportedSymbols.length - left.exportedSymbols.length
    || right.publicMethods.length - left.publicMethods.length
    || left.sourceTarget.localeCompare(right.sourceTarget);
}

function moduleScore(module: InterfaceSurfaceModule): number {
  const roleWeight = module.role === 'entrypoint'
    ? 60
    : module.role === 'core'
      ? 40
      : 20;
  const confidenceWeight = module.confidence === 'high'
    ? 12
    : module.confidence === 'medium'
      ? 6
      : 0;
  const signalWeight = CORE_SIGNAL_PATTERN.test(module.sourceTarget) ? 6 : 0;
  const lowSignalPenalty = isLowSignalPath(module.sourceTarget) ? 30 : 0;
  return roleWeight + confidenceWeight + signalWeight - lowSignalPenalty;
}

function compareInterfaceSymbols(left: InterfaceSurfaceSymbol, right: InterfaceSurfaceSymbol): number {
  return symbolWeight(right) - symbolWeight(left)
    || left.name.localeCompare(right.name)
    || left.moduleName.localeCompare(right.moduleName);
}

function symbolWeight(symbol: InterfaceSurfaceSymbol): number {
  const kindWeight = symbol.kind === 'class'
    ? 30
    : symbol.kind === 'function'
      ? 25
      : symbol.kind === 'method' || symbol.kind === 'classmethod' || symbol.kind === 'staticmethod'
        ? 22
        : 16;
  const ownerWeight = symbol.ownerName ? 5 : 0;
  const inferredPenalty = symbol.inferred ? 6 : 0;
  return kindWeight + ownerWeight - inferredPenalty;
}

function collectKeyItems(
  modules: InterfaceSurfaceModule[],
  selector: (module: InterfaceSurfaceModule) => InterfaceSurfaceSymbol[],
  keySelector: (symbol: InterfaceSurfaceSymbol) => string,
  limit: number,
): InterfaceSurfaceSymbol[] {
  const seen = new Set<string>();
  const items: InterfaceSurfaceSymbol[] = [];

  for (const module of modules) {
    const sortedItems = [...selector(module)].sort(compareInterfaceSymbols);
    for (const item of sortedItems) {
      const key = keySelector(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
      if (items.length >= limit) {
        return items;
      }
    }
  }

  return items;
}

function buildSummary(
  projectName: string,
  modules: InterfaceSurfaceModule[],
  totalSymbols: number,
  totalMethods: number,
): string[] {
  const entryModules = modules.filter((module) => module.role === 'entrypoint');
  const coreModules = modules.filter((module) => module.role !== 'support');

  return [
    `${projectName} 当前识别出 ${modules.length} 个公开接口模块，其中 ${entryModules.length} 个为 entrypoint。`,
    `共提取 ${totalSymbols} 个公开符号与 ${totalMethods} 个关键方法，优先围绕 SDK / library 的公开入口组织。`,
    coreModules.length > 0
      ? `核心接口模块集中在 ${coreModules.slice(0, 3).map((module) => `\`${module.sourceTarget}\``).join('、')}。`
      : '当前未识别出高信号核心模块，输出已保守降级为现有公开符号摘要。',
  ];
}
