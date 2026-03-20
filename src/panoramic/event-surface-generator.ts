/**
 * EventSurfaceGenerator
 *
 * 识别显式字符串 channel/topic/queue 的发布/订阅模式，生成事件面 inventory 文档。
 * 核心范围限定为静态 inventory；状态附录仅作为低置信启发式输出。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import type { SourceFile } from 'ts-morph';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { loadTemplate } from './utils/template-loader.js';
import { sanitizeMermaidId } from './utils/mermaid-helpers.js';

export type EventChannelKind = 'event' | 'topic' | 'queue' | 'webhook' | 'unknown';
export type EventRole = 'publisher' | 'subscriber';

export interface EventEvidence {
  role: EventRole;
  sourceFile: string;
  symbolName: string;
  methodName: string;
  payloadSummary?: string;
  payloadFields: string[];
}

export interface EventOccurrence extends EventEvidence {
  channelName: string;
  kind: EventChannelKind;
}

export interface EventChannel {
  channelName: string;
  kind: EventChannelKind;
  publishers: EventEvidence[];
  subscribers: EventEvidence[];
  messageFields: string[];
  payloadSamples: string[];
}

export interface EventSurfaceInput {
  projectName: string;
  sourceFiles: string[];
  occurrences: EventOccurrence[];
  warnings: string[];
}

export interface EventSurfaceOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  channels: EventChannel[];
  totalChannels: number;
  totalPublishers: number;
  totalSubscribers: number;
  warnings: string[];
  eventFlowMermaid?: string;
  stateAppendixMermaid?: string;
  stateAppendixConfidence?: 'low';
}

const DEFAULT_IGNORE_DIRS = new Set([
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

const TS_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const TEXT_SOURCE_EXTENSIONS = new Set(['.py']);
const SUPPORTED_METHODS = new Set([
  'emit',
  'on',
  'once',
  'addListener',
  'publish',
  'subscribe',
  'consume',
  'send',
  'dispatch',
  'listen',
]);
const PUBLISHER_METHODS = new Set(['emit', 'publish', 'send', 'dispatch']);
const SUBSCRIBER_METHODS = new Set(['on', 'once', 'addListener', 'subscribe', 'consume', 'listen']);
const EVENT_PATTERN_RE = /\.(emit|on|once|addListener|publish|subscribe|consume|send|dispatch|listen)\(\s*(['"`])[^'"`]+\2/;
const TEXT_EVENT_RE = /\.(emit|on|once|addListener|publish|subscribe|consume|send|dispatch|listen)\(\s*(['"`])([^'"`]+)\2(?:\s*,\s*([^\n)]+))?/g;
const STATE_HINT_ORDER = [
  'created',
  'opened',
  'queued',
  'started',
  'processing',
  'approved',
  'completed',
  'closed',
  'failed',
  'rejected',
  'deleted',
] as const;
const STATE_HINT_SET = new Set<string>(STATE_HINT_ORDER);

export class EventSurfaceGenerator
  implements DocumentGenerator<EventSurfaceInput, EventSurfaceOutput>
{
  readonly id = 'event-surface' as const;
  readonly name = '事件面文档生成器' as const;
  readonly description = '识别 channel/topic/queue 的发布订阅模式，生成事件 inventory 与可选状态附录';

  isApplicable(context: ProjectContext): boolean {
    return collectSourceFiles(context.projectRoot).some((filePath) => {
      try {
        return EVENT_PATTERN_RE.test(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return false;
      }
    });
  }

  async extract(context: ProjectContext): Promise<EventSurfaceInput> {
    const projectName = detectProjectName(context.projectRoot);
    const sourceFiles = collectSourceFiles(context.projectRoot);
    const warnings = new Set<string>();
    const occurrences: EventOccurrence[] = [];

    const tsFiles = sourceFiles.filter((filePath) => TS_SOURCE_EXTENSIONS.has(path.extname(filePath)));
    const textFiles = sourceFiles.filter((filePath) => TEXT_SOURCE_EXTENSIONS.has(path.extname(filePath)));

    if (tsFiles.length > 0) {
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
          allowJs: true,
        },
      });

      for (const filePath of tsFiles) {
        try {
          project.addSourceFileAtPath(filePath);
        } catch {
          warnings.add(`跳过无法解析的 TS/JS 文件: ${toPosixPath(path.relative(context.projectRoot, filePath))}`);
        }
      }

      for (const sourceFile of project.getSourceFiles()) {
        occurrences.push(
          ...extractTsOccurrences(context.projectRoot, sourceFile),
        );
      }
    }

    for (const filePath of textFiles) {
      occurrences.push(...extractTextOccurrences(context.projectRoot, filePath));
    }

    return {
      projectName,
      sourceFiles: sourceFiles
        .map((filePath) => toPosixPath(path.relative(context.projectRoot, filePath)))
        .sort((a, b) => a.localeCompare(b)),
      occurrences: dedupeOccurrences(occurrences),
      warnings: [...warnings].sort((a, b) => a.localeCompare(b)),
    };
  }

  async generate(
    input: EventSurfaceInput,
    _options?: GenerateOptions,
  ): Promise<EventSurfaceOutput> {
    const channels = aggregateChannels(input.occurrences);
    const eventFlowMermaid = buildEventFlowMermaid(channels);
    const stateAppendixMermaid = buildStateAppendixMermaid(channels);

    return {
      title: `事件面文档: ${input.projectName}`,
      generatedAt: new Date().toISOString(),
      projectName: input.projectName,
      channels,
      totalChannels: channels.length,
      totalPublishers: channels.reduce((sum, channel) => sum + channel.publishers.length, 0),
      totalSubscribers: channels.reduce((sum, channel) => sum + channel.subscribers.length, 0),
      warnings: input.warnings,
      eventFlowMermaid,
      stateAppendixMermaid,
      stateAppendixConfidence: stateAppendixMermaid ? 'low' : undefined,
    };
  }

  render(output: EventSurfaceOutput): string {
    const template = loadTemplate('event-surface.hbs', import.meta.url);
    return template(output);
  }
}

function collectSourceFiles(projectRoot: string): string[] {
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
        if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name);
      if (TS_SOURCE_EXTENSIONS.has(ext) || TEXT_SOURCE_EXTENSIONS.has(ext)) {
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

function extractTsOccurrences(projectRoot: string, sourceFile: SourceFile): EventOccurrence[] {
  const relFile = toPosixPath(path.relative(projectRoot, sourceFile.getFilePath()));
  const occurrences: EventOccurrence[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) {
      continue;
    }

    const methodName = expression.getName();
    if (!SUPPORTED_METHODS.has(methodName)) {
      continue;
    }

    const args = call.getArguments();
    const channelName = extractStringLiteral(args[0]);
    if (!channelName) {
      continue;
    }

    const qualifierText = expression.getExpression().getText();
    const role = PUBLISHER_METHODS.has(methodName) ? 'publisher'
      : SUBSCRIBER_METHODS.has(methodName) ? 'subscriber'
        : null;
    if (!role) {
      continue;
    }

    const payloadTarget = role === 'publisher' ? args[1] : undefined;
    const payloadSummary = summarizeExpression(payloadTarget);
    const payloadFields = extractPayloadFields(payloadTarget);

    occurrences.push({
      channelName,
      kind: inferChannelKind(channelName, methodName, qualifierText),
      role,
      sourceFile: relFile,
      symbolName: findNearestSymbolName(call),
      methodName,
      payloadSummary,
      payloadFields,
    });
  }

  return occurrences;
}

function extractTextOccurrences(projectRoot: string, filePath: string): EventOccurrence[] {
  const relFile = toPosixPath(path.relative(projectRoot, filePath));
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const occurrences: EventOccurrence[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    let match: RegExpExecArray | null;
    const regex = new RegExp(TEXT_EVENT_RE);
    while ((match = regex.exec(line)) !== null) {
      const methodName = match[1]!;
      const channelName = match[3]!;
      const role = PUBLISHER_METHODS.has(methodName) ? 'publisher'
        : SUBSCRIBER_METHODS.has(methodName) ? 'subscriber'
          : null;
      if (!role) {
        continue;
      }
      const payloadSource = role === 'publisher' ? match[4]?.trim() : undefined;

      occurrences.push({
        channelName,
        kind: inferChannelKind(channelName, methodName, line),
        role,
        sourceFile: relFile,
        symbolName: findNearestPythonSymbol(lines, lineIndex),
        methodName,
        payloadSummary: payloadSource,
        payloadFields: extractTextPayloadFields(payloadSource),
      });
    }
  }

  return occurrences;
}

function dedupeOccurrences(items: EventOccurrence[]): EventOccurrence[] {
  const seen = new Set<string>();
  const deduped: EventOccurrence[] = [];

  for (const item of items) {
    const key = [
      item.channelName,
      item.kind,
      item.role,
      item.sourceFile,
      item.symbolName,
      item.methodName,
      item.payloadSummary ?? '',
      item.payloadFields.join(','),
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped.sort((left, right) => {
    const a = `${left.channelName}:${left.role}:${left.sourceFile}:${left.symbolName}`;
    const b = `${right.channelName}:${right.role}:${right.sourceFile}:${right.symbolName}`;
    return a.localeCompare(b);
  });
}

function aggregateChannels(occurrences: EventOccurrence[]): EventChannel[] {
  const channels = new Map<string, EventChannel>();

  for (const occurrence of occurrences) {
    const key = `${occurrence.kind}:${occurrence.channelName}`;
    if (!channels.has(key)) {
      channels.set(key, {
        channelName: occurrence.channelName,
        kind: occurrence.kind,
        publishers: [],
        subscribers: [],
        messageFields: [],
        payloadSamples: [],
      });
    }

    const channel = channels.get(key)!;
    const evidence: EventEvidence = {
      role: occurrence.role,
      sourceFile: occurrence.sourceFile,
      symbolName: occurrence.symbolName,
      methodName: occurrence.methodName,
      payloadSummary: occurrence.payloadSummary,
      payloadFields: occurrence.payloadFields,
    };

    if (occurrence.role === 'publisher') {
      channel.publishers.push(evidence);
    } else {
      channel.subscribers.push(evidence);
    }

    channel.messageFields = uniqueStrings([...channel.messageFields, ...occurrence.payloadFields]);
    if (occurrence.payloadSummary) {
      channel.payloadSamples = uniqueStrings([...channel.payloadSamples, occurrence.payloadSummary]);
    }
  }

  return [...channels.values()]
    .map((channel) => ({
      ...channel,
      publishers: sortEvidence(channel.publishers),
      subscribers: sortEvidence(channel.subscribers),
      messageFields: uniqueStrings(channel.messageFields),
      payloadSamples: uniqueStrings(channel.payloadSamples),
    }))
    .sort((left, right) => left.channelName.localeCompare(right.channelName));
}

function sortEvidence(items: EventEvidence[]): EventEvidence[] {
  return items.slice().sort((left, right) => {
    const a = `${left.sourceFile}:${left.symbolName}:${left.methodName}`;
    const b = `${right.sourceFile}:${right.symbolName}:${right.methodName}`;
    return a.localeCompare(b);
  });
}

function buildEventFlowMermaid(channels: EventChannel[]): string | undefined {
  const lines = ['flowchart LR'];
  let hasEdges = false;

  for (const channel of channels) {
    const channelId = sanitizeMermaidId(`channel_${channel.channelName}`);
    const channelLabel = `${channel.channelName} (${channel.kind})`;
    lines.push(`  ${channelId}["${escapeMermaidLabel(channelLabel)}"]`);

    for (const publisher of channel.publishers) {
      const publisherId = sanitizeMermaidId(`pub_${channel.channelName}_${publisher.sourceFile}_${publisher.symbolName}`);
      lines.push(`  ${publisherId}["${escapeMermaidLabel(`${publisher.symbolName} @ ${publisher.sourceFile}`)}"]`);
      lines.push(`  ${publisherId} --> ${channelId}`);
      hasEdges = true;
    }

    for (const subscriber of channel.subscribers) {
      const subscriberId = sanitizeMermaidId(`sub_${channel.channelName}_${subscriber.sourceFile}_${subscriber.symbolName}`);
      lines.push(`  ${subscriberId}["${escapeMermaidLabel(`${subscriber.symbolName} @ ${subscriber.sourceFile}`)}"]`);
      lines.push(`  ${channelId} --> ${subscriberId}`);
      hasEdges = true;
    }
  }

  return hasEdges ? lines.join('\n') : undefined;
}

function buildStateAppendixMermaid(channels: EventChannel[]): string | undefined {
  const groups = new Map<string, string[]>();

  for (const channel of channels) {
    const segments = channel.channelName.split(/[.:/]/).filter(Boolean);
    if (segments.length < 2) {
      continue;
    }

    const state = segments[segments.length - 1]!.toLowerCase();
    if (!STATE_HINT_SET.has(state)) {
      continue;
    }

    const entity = segments.slice(0, -1).join('.');
    if (!groups.has(entity)) {
      groups.set(entity, []);
    }
    groups.get(entity)!.push(state);
  }

  const relevantGroups = [...groups.entries()]
    .map(([entity, states]) => [entity, uniqueStrings(states)] as const)
    .filter(([, states]) => states.length >= 2);

  if (relevantGroups.length === 0) {
    return undefined;
  }

  const lines = [
    'stateDiagram-v2',
    '  %% [推断] 低置信状态附录',
  ];

  for (const [entity, states] of relevantGroups) {
    const ordered = states.slice().sort((left, right) => {
      return STATE_HINT_ORDER.indexOf(left as typeof STATE_HINT_ORDER[number])
        - STATE_HINT_ORDER.indexOf(right as typeof STATE_HINT_ORDER[number]);
    });

    const initial = ordered[0]!;
    lines.push(`  [*] --> ${sanitizeMermaidId(`${entity}_${initial}`)}`);
    for (let index = 0; index < ordered.length; index++) {
      const state = ordered[index]!;
      const stateId = sanitizeMermaidId(`${entity}_${state}`);
      lines.push(`  state "${escapeMermaidLabel(`${entity}.${state}`)} [推断]" as ${stateId}`);
      const next = ordered[index + 1];
      if (next) {
        lines.push(`  ${stateId} --> ${sanitizeMermaidId(`${entity}_${next}`)}`);
      }
    }
  }

  return lines.join('\n');
}

function inferChannelKind(
  channelName: string,
  methodName: string,
  hintText: string,
): EventChannelKind {
  const combined = `${channelName} ${hintText}`.toLowerCase();
  if (combined.includes('webhook') || combined.includes('hook')) {
    return 'webhook';
  }
  if (combined.includes('queue') || combined.includes('job') || methodName === 'consume' || methodName === 'send') {
    return 'queue';
  }
  if (combined.includes('topic') || combined.includes('subject') || methodName === 'publish' || methodName === 'subscribe') {
    return 'topic';
  }
  if (methodName === 'emit' || methodName === 'on' || methodName === 'once' || methodName === 'addListener') {
    return 'event';
  }
  return 'unknown';
}

function extractStringLiteral(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText().trim() || undefined;
  }

  return undefined;
}

function summarizeExpression(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  if (Node.isObjectLiteralExpression(node)) {
    const fields = extractPayloadFields(node);
    return fields.length > 0 ? `{ ${fields.join(', ')} }` : '{}';
  }

  const text = node.getText().replace(/\s+/g, ' ').trim();
  if (!text) {
    return undefined;
  }
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function extractPayloadFields(node: Node | undefined): string[] {
  if (!node || !Node.isObjectLiteralExpression(node)) {
    return [];
  }

  const fields: string[] = [];
  for (const property of node.getProperties()) {
    if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
      fields.push(property.getName());
    }
  }

  return uniqueStrings(fields);
}

function extractTextPayloadFields(payloadSource: string | undefined): string[] {
  if (!payloadSource) {
    return [];
  }

  const fields: string[] = [];
  const regex = /["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(payloadSource)) !== null) {
    if (match[1]) {
      fields.push(match[1]);
    }
  }

  return uniqueStrings(fields);
}

function findNearestSymbolName(node: Node): string {
  let current: Node | undefined = node;

  while (current) {
    if (Node.isMethodDeclaration(current) || Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name) {
        return name;
      }
    }

    if (Node.isClassDeclaration(current)) {
      const name = current.getName();
      if (name) {
        return name;
      }
    }

    if (Node.isVariableDeclaration(current)) {
      const name = current.getName();
      if (name) {
        return name;
      }
    }

    current = current.getParent();
  }

  return 'anonymous';
}

function findNearestPythonSymbol(lines: string[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index--) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    const matched = /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  return 'anonymous';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((a, b) => a.localeCompare(b));
}

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/"/g, '\\"');
}
