/**
 * TroubleshootingGenerator
 *
 * 从显式错误模式、配置约束与恢复路径中生成 grounded troubleshooting 文档，
 * 并在证据充分时输出 explanation 风格的背景说明。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { loadTemplate } from './utils/template-loader.js';

export type TroubleshootingEntryKind = 'config-constraint' | 'error-pattern';
export type TroubleshootingConfidence = 'high' | 'medium';

export interface TroubleshootingLocation {
  sourceFile: string;
  line: number;
  symbolName: string;
  excerpt: string;
}

export interface TroubleshootingEntry {
  id: string;
  kind: TroubleshootingEntryKind;
  title: string;
  symptom: string;
  possibleCauses: string[];
  recoverySteps: string[];
  relatedLocations: TroubleshootingLocation[];
  configKeys: string[];
  evidence: string[];
  confidence: TroubleshootingConfidence;
}

export interface TroubleshootingExplanation {
  title: string;
  summary: string;
  evidence: string[];
}

export interface TroubleshootingInput {
  projectName: string;
  entries: TroubleshootingEntry[];
  explanations: TroubleshootingExplanation[];
  warnings: string[];
}

export interface TroubleshootingOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  entries: TroubleshootingEntry[];
  explanations: TroubleshootingExplanation[];
  totalEntries: number;
  warnings: string[];
}

interface ConfigLocation extends TroubleshootingLocation {
  key: string;
}

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.py', '.go', '.java']);
const QUICK_SIGNAL_RE = /throw new (?:\w+)?Error|(?:logger|console)\.error|process\.env|os\.getenv|getenv\(|retry|reconnect|fallback|recover|backoff|restart|resume|reset/;
const ENV_FILE_RE = /^\.env(\..*)?$/;
const ERROR_PATTERNS = [
  /throw new (?:\w+)?Error\(\s*(['"`])([^'"`]+)\1/,
  /(?:logger|console)\.error\(\s*(['"`])([^'"`]+)\1/,
] as const;
const JS_ENV_RE = /process\.env(?:\[['"]([A-Z][A-Z0-9_]*)['"]\]|\.([A-Z][A-Z0-9_]*))/g;
const PY_ENV_RE = /\b(?:os\.)?getenv\(\s*(['"])([A-Z][A-Z0-9_]*)\1/g;
const PY_ENV_MAP_RE = /os\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;
const RECOVERY_RE = /\b(retry|reconnect|fallback|recover|backoff|restart|resume|reset)\b/i;
const INVALID_HINT_RE = /\b(invalid|unsupported|must|missing|required|expect|range|timeout|unavailable|failed|empty)\b/i;
const QUOTED_KEY_RE = /["']?([A-Z][A-Z0-9_]*)["']?\s*[:=]/g;

export class TroubleshootingGenerator
  implements DocumentGenerator<TroubleshootingInput, TroubleshootingOutput>
{
  readonly id = 'troubleshooting' as const;
  readonly name = '故障排查 / 原理说明文档生成器' as const;
  readonly description = '从错误模式、配置约束和恢复路径生成 grounded troubleshooting 文档';

  isApplicable(context: ProjectContext): boolean {
    return collectRelevantFiles(context.projectRoot).some((filePath) => {
      try {
        return QUICK_SIGNAL_RE.test(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return false;
      }
    });
  }

  async extract(context: ProjectContext): Promise<TroubleshootingInput> {
    const projectName = detectProjectName(context.projectRoot);
    const files = collectRelevantFiles(context.projectRoot);
    const configIndex = buildConfigIndex(context.projectRoot, files);
    const entries: TroubleshootingEntry[] = [];
    const warnings = new Set<string>();

    for (const filePath of files) {
      if (!SOURCE_EXTENSIONS.has(path.extname(filePath))) {
        continue;
      }

      let content: string;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        warnings.add(`跳过不可读取文件: ${toPosixPath(path.relative(context.projectRoot, filePath))}`);
        continue;
      }

      entries.push(...extractConfigEntries(context.projectRoot, filePath, content, configIndex));
      entries.push(...extractErrorEntries(context.projectRoot, filePath, content, configIndex));
    }

    const mergedEntries = mergeEntries(entries);
    if (mergedEntries.length < 5) {
      warnings.add(`当前仅提取 ${mergedEntries.length} 条 grounded troubleshooting entries，低于蓝图建议的 5 条`);
    }

    return {
      projectName,
      entries: mergedEntries,
      explanations: buildExplanations(mergedEntries),
      warnings: [...warnings].sort((a, b) => a.localeCompare(b)),
    };
  }

  async generate(
    input: TroubleshootingInput,
    _options?: GenerateOptions,
  ): Promise<TroubleshootingOutput> {
    const entries = input.entries.slice().sort((left, right) => left.title.localeCompare(right.title));
    const explanations = input.explanations.slice().sort((left, right) => left.title.localeCompare(right.title));

    return {
      title: `故障排查 / 原理说明: ${input.projectName}`,
      generatedAt: new Date().toISOString(),
      projectName: input.projectName,
      entries,
      explanations,
      totalEntries: entries.length,
      warnings: input.warnings,
    };
  }

  render(output: TroubleshootingOutput): string {
    const template = loadTemplate('troubleshooting.hbs', import.meta.url);
    return template(output);
  }
}

function collectRelevantFiles(projectRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) || ENV_FILE_RE.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  walk(projectRoot);
  return results.sort((a, b) => a.localeCompare(b));
}

function detectProjectName(projectRoot: string): string {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { name?: string };
      if (parsed.name?.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // ignore
    }
  }

  return path.basename(projectRoot);
}

function buildConfigIndex(projectRoot: string, files: string[]): Map<string, ConfigLocation[]> {
  const index = new Map<string, ConfigLocation[]>();

  for (const filePath of files) {
    if (!ENV_FILE_RE.test(path.basename(filePath))) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relFile = toPosixPath(path.relative(projectRoot, filePath));
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex] ?? '';
      const match = /^([A-Z][A-Z0-9_]*)\s*=/.exec(line.trim());
      if (!match?.[1]) {
        continue;
      }

      const key = match[1];
      const location: ConfigLocation = {
        key,
        sourceFile: relFile,
        line: lineIndex + 1,
        symbolName: 'config',
        excerpt: normalizeExcerpt(line),
      };
      index.set(key, [...(index.get(key) ?? []), location]);
    }
  }

  return index;
}

function extractConfigEntries(
  projectRoot: string,
  filePath: string,
  content: string,
  configIndex: Map<string, ConfigLocation[]>,
): TroubleshootingEntry[] {
  const relFile = toPosixPath(path.relative(projectRoot, filePath));
  const lines = content.split(/\r?\n/);
  const entries: TroubleshootingEntry[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    const keys = extractEnvKeys(line);
    if (keys.length === 0) {
      continue;
    }

    const windowLines = getWindow(lines, lineIndex, 3, 4);
    const errorMessage = findNearbyErrorMessage(windowLines);
    const recoverySteps = inferRecoverySteps(windowLines);

    for (const key of keys) {
      const title = `配置约束: ${key}`;
      const locations = uniqueLocations([
        {
          sourceFile: relFile,
          line: lineIndex + 1,
          symbolName: findNearestSymbol(lines, lineIndex),
          excerpt: normalizeExcerpt(line),
        },
        ...(configIndex.get(key) ?? []),
      ]);

      const possibleCauses = uniqueStrings([
        `${key} 缺失、为空或未注入运行环境`,
        ...(hasInvalidHint(windowLines, errorMessage) ? [`${key} 值不满足代码中的约束检查`] : []),
      ]);

      const configSteps = [
        `检查并设置 \`${key}\``,
        ...(configIndex.has(key)
          ? [`核对 ${configIndex.get(key)!.map((location) => formatLocation(location)).join('、')} 中的示例或默认值`]
          : []),
      ];

      entries.push({
        id: `config:${key}`,
        kind: 'config-constraint',
        title,
        symptom: errorMessage ? `配置错误时出现: ${errorMessage}` : `依赖 \`${key}\` 的功能在缺失或非法时会失败`,
        possibleCauses,
        recoverySteps: uniqueStrings([
          ...configSteps,
          ...recoverySteps,
          `定位并检查 ${formatLocation(locations[0]!)} 的约束实现`,
        ]),
        relatedLocations: locations,
        configKeys: [key],
        evidence: uniqueStrings([
          normalizeExcerpt(line),
          ...(errorMessage ? [errorMessage] : []),
        ]),
        confidence: errorMessage ? 'high' : 'medium',
      });
    }
  }

  return entries;
}

function extractErrorEntries(
  projectRoot: string,
  filePath: string,
  content: string,
  configIndex: Map<string, ConfigLocation[]>,
): TroubleshootingEntry[] {
  const relFile = toPosixPath(path.relative(projectRoot, filePath));
  const lines = content.split(/\r?\n/);
  const entries: TroubleshootingEntry[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    const message = findErrorMessage(line);
    if (!message) {
      continue;
    }

    const windowLines = getWindow(lines, lineIndex, 3, 4);
    const keys = extractEnvKeys(windowLines.join('\n'));
    if (keys.length > 0) {
      continue;
    }

    const recoverySteps = inferRecoverySteps(windowLines);
    const locations = uniqueLocations([{
      sourceFile: relFile,
      line: lineIndex + 1,
      symbolName: findNearestSymbol(lines, lineIndex),
      excerpt: normalizeExcerpt(line),
    }]);

    entries.push({
      id: `error:${slugify(message)}`,
      kind: 'error-pattern',
      title: `故障: ${message}`,
      symptom: message,
      possibleCauses: uniqueStrings([
        '相关代码路径中的前置条件、输入或外部依赖未满足',
        ...(recoverySteps.length > 0 ? ['代码中已显式为该场景预留恢复路径'] : []),
      ]),
      recoverySteps: uniqueStrings([
        ...recoverySteps,
        `定位并检查 ${formatLocation(locations[0]!)} 的前置条件和上游输入`,
      ]),
      relatedLocations: locations,
      configKeys: [],
      evidence: uniqueStrings([
        message,
        normalizeExcerpt(line),
      ]),
      confidence: recoverySteps.length > 0 ? 'high' : 'medium',
    });
  }

  return entries;
}

function mergeEntries(entries: TroubleshootingEntry[]): TroubleshootingEntry[] {
  const merged = new Map<string, TroubleshootingEntry>();

  for (const entry of entries) {
    const current = merged.get(entry.id);
    if (!current) {
      merged.set(entry.id, {
        ...entry,
        possibleCauses: uniqueStrings(entry.possibleCauses),
        recoverySteps: uniqueStrings(entry.recoverySteps),
        relatedLocations: uniqueLocations(entry.relatedLocations),
        configKeys: uniqueStrings(entry.configKeys),
        evidence: uniqueStrings(entry.evidence),
      });
      continue;
    }

    merged.set(entry.id, {
      ...current,
      confidence: current.confidence === 'high' || entry.confidence === 'high' ? 'high' : 'medium',
      possibleCauses: uniqueStrings([...current.possibleCauses, ...entry.possibleCauses]),
      recoverySteps: uniqueStrings([...current.recoverySteps, ...entry.recoverySteps]),
      relatedLocations: uniqueLocations([...current.relatedLocations, ...entry.relatedLocations]),
      configKeys: uniqueStrings([...current.configKeys, ...entry.configKeys]),
      evidence: uniqueStrings([...current.evidence, ...entry.evidence]),
    });
  }

  return [...merged.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function buildExplanations(entries: TroubleshootingEntry[]): TroubleshootingExplanation[] {
  const explanations: TroubleshootingExplanation[] = [];
  const configEntries = entries.filter((entry) => entry.kind === 'config-constraint');
  const retryEntries = entries.filter((entry) =>
    hasExplanationSignal(entry, /\bretry|reconnect|backoff|重试|重连|重建/i),
  );
  const fallbackEntries = entries.filter((entry) =>
    hasExplanationSignal(entry, /\bfallback|cache|recover|回退|缓存|恢复/i),
  );

  if (configEntries.length > 0) {
    explanations.push({
      title: '配置校验策略',
      summary: '代码中存在显式配置约束，系统倾向在启动或关键路径早期 fail-fast，而不是静默忽略缺失配置。',
      evidence: configEntries.slice(0, 3).map((entry) => `${entry.title} -> ${entry.evidence[0] ?? entry.symptom}`),
    });
  }

  if (retryEntries.length > 0) {
    explanations.push({
      title: '瞬时故障恢复路径',
      summary: '部分错误路径带有 retry / reconnect / backoff 证据，说明系统预期外部依赖可能暂时不可用，并通过重试机制自愈。',
      evidence: retryEntries.slice(0, 3).map((entry) => `${entry.title} -> ${entry.recoverySteps[0] ?? entry.symptom}`),
    });
  }

  if (fallbackEntries.length > 0) {
    explanations.push({
      title: '降级与回退策略',
      summary: '部分故障条目带有 fallback / recover 证据，说明系统在失败场景下更偏向保持可用性，并提供回退路径。',
      evidence: fallbackEntries.slice(0, 3).map((entry) => `${entry.title} -> ${entry.recoverySteps[0] ?? entry.symptom}`),
    });
  }

  return explanations;
}

function hasExplanationSignal(entry: TroubleshootingEntry, pattern: RegExp): boolean {
  return entry.recoverySteps.some((step) => pattern.test(step))
    || entry.evidence.some((item) => pattern.test(item));
}

function extractEnvKeys(text: string): string[] {
  const keys: string[] = [];
  let match: RegExpExecArray | null;

  const jsRegex = new RegExp(JS_ENV_RE);
  while ((match = jsRegex.exec(text)) !== null) {
    keys.push(match[1] ?? match[2] ?? '');
  }

  const pyRegex = new RegExp(PY_ENV_RE);
  while ((match = pyRegex.exec(text)) !== null) {
    keys.push(match[2] ?? '');
  }

  const pyMapRegex = new RegExp(PY_ENV_MAP_RE);
  while ((match = pyMapRegex.exec(text)) !== null) {
    keys.push(match[1] ?? '');
  }

  return uniqueStrings(keys.filter(Boolean));
}

function findNearbyErrorMessage(lines: string[]): string | undefined {
  for (const line of lines) {
    const message = findErrorMessage(line);
    if (message) {
      return message;
    }
  }

  return undefined;
}

function findErrorMessage(line: string): string | undefined {
  for (const pattern of ERROR_PATTERNS) {
    const match = pattern.exec(line);
    if (match?.[2]) {
      return match[2].trim();
    }
  }

  return undefined;
}

function inferRecoverySteps(lines: string[]): string[] {
  const steps: string[] = [];
  const joined = lines.join('\n').toLowerCase();

  if (/\bretry|\bbackoff/.test(joined)) {
    steps.push('触发代码内置重试 / 退避路径');
  }
  if (/\breconnect/.test(joined)) {
    steps.push('执行连接重建或重连流程');
  }
  if (/\bfallback|\bcache/.test(joined)) {
    steps.push('切换到代码内置回退 / 缓存路径');
  }
  if (/\brecover|\bresume|\brestart|\breset/.test(joined)) {
    steps.push('执行代码中的恢复 / 重置流程');
  }

  return uniqueStrings(steps);
}

function hasInvalidHint(lines: string[], errorMessage: string | undefined): boolean {
  return INVALID_HINT_RE.test(lines.join('\n')) || (errorMessage ? INVALID_HINT_RE.test(errorMessage) : false);
}

function findNearestSymbol(lines: string[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index--) {
    const line = lines[index]?.trim() ?? '';
    if (!line) {
      continue;
    }

    const functionMatch = /^(?:export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
      ?? /^(?:export\s+)?async\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
      ?? /^(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/.exec(line)
      ?? /^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
      ?? /^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (functionMatch?.[1]) {
      return functionMatch[1];
    }
  }

  return 'anonymous';
}

function getWindow(lines: string[], lineIndex: number, before: number, after: number): string[] {
  return lines.slice(Math.max(0, lineIndex - before), Math.min(lines.length, lineIndex + after + 1));
}

function normalizeExcerpt(line: string): string {
  return line.trim().replace(/\s+/g, ' ').slice(0, 160);
}

function formatLocation(location: TroubleshootingLocation): string {
  return `\`${location.sourceFile}:${location.line}\` (${location.symbolName})`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function uniqueLocations(values: TroubleshootingLocation[]): TroubleshootingLocation[] {
  const seen = new Set<string>();
  const items: TroubleshootingLocation[] = [];

  for (const value of values) {
    const key = `${value.sourceFile}:${value.line}:${value.symbolName}:${value.excerpt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(value);
  }

  return items.sort((left, right) => {
    const a = `${left.sourceFile}:${left.line}:${left.symbolName}`;
    const b = `${right.sourceFile}:${right.line}:${right.symbolName}`;
    return a.localeCompare(b);
  });
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'entry';
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
