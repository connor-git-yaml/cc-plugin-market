/**
 * RuntimeTopology shared model
 *
 * Feature 043 负责生产这份结构化运行时模型，Feature 045 直接消费它。
 * 本文件只承载共享实体与归一化 helper，不包含 Markdown/模板细节。
 */
import type { ConfigEntry, DockerfileInfo } from './parsers/types.js';

// ============================================================
// Shared types
// ============================================================

export type RuntimeSourceKind = 'compose' | 'dockerfile' | 'env-file' | 'config';
export type RuntimeStageRole = 'build' | 'runtime';
export type RuntimeConfigFormat = 'env' | 'yaml' | 'toml';
export type RuntimeConfigCategory = 'environment' | 'port' | 'image' | 'command' | 'volume' | 'general';

export interface RuntimeEnvironmentVariable {
  name: string;
  value?: string;
  sourceKind: RuntimeSourceKind;
  sourceFile: string;
  scope: 'global' | 'service' | 'stage';
}

export interface RuntimePortBinding {
  target: string;
  published?: string;
  hostIp?: string;
  protocol: string;
  mode?: string;
  raw: string;
  sourceFile: string;
}

export interface RuntimeVolumeMount {
  target: string;
  source?: string;
  type: 'bind' | 'volume' | 'tmpfs' | 'unknown';
  readOnly: boolean;
  raw: string;
  sourceFile: string;
}

export interface RuntimeDependency {
  service: string;
  condition?: string;
  required?: boolean;
  sourceFile: string;
}

export interface RuntimeBuildStage {
  name: string;
  alias?: string;
  index: number;
  role: RuntimeStageRole;
  baseImage: string;
  sourceFile: string;
  commands: string[];
  environment: RuntimeEnvironmentVariable[];
  exposedPorts: string[];
  volumes: string[];
  copiesFrom: string[];
  workdir?: string;
  command?: string;
  entrypoint?: string;
}

export interface RuntimeImage {
  name: string;
  explicitImage?: string;
  sourceFile: string;
  buildContext?: string;
  dockerfilePath?: string;
  targetStage?: string;
  stageNames: string[];
}

export interface RuntimeContainer {
  name: string;
  service: string;
  sourceFile: string;
  image?: string;
  command?: string;
  entrypoint?: string;
  environment: RuntimeEnvironmentVariable[];
  ports: RuntimePortBinding[];
  volumes: RuntimeVolumeMount[];
  dependsOn: string[];
}

export interface RuntimeService {
  name: string;
  sourceFile: string;
  containerName: string;
  image?: string;
  buildContext?: string;
  dockerfilePath?: string;
  targetStage?: string;
  stageNames: string[];
  command?: string;
  entrypoint?: string;
  environment: RuntimeEnvironmentVariable[];
  envFiles: string[];
  ports: RuntimePortBinding[];
  volumes: RuntimeVolumeMount[];
  dependsOn: RuntimeDependency[];
}

export interface RuntimeConfigHint {
  keyPath: string;
  value: string;
  sourceFile: string;
  format: RuntimeConfigFormat;
  category: RuntimeConfigCategory;
  description?: string;
}

export interface RuntimeTopology {
  projectName: string;
  services: RuntimeService[];
  images: RuntimeImage[];
  containers: RuntimeContainer[];
  stages: RuntimeBuildStage[];
  configHints: RuntimeConfigHint[];
  sourceFiles: string[];
}

export interface RuntimeTopologyStats {
  totalServices: number;
  totalImages: number;
  totalContainers: number;
  totalStages: number;
  totalDependencies: number;
  totalConfigHints: number;
}

// ============================================================
// Helper utilities
// ============================================================

/**
 * Dockerfile 只有 build 信息时，为镜像生成稳定的本地名字。
 */
export function buildSyntheticImageName(serviceName: string): string {
  return `${serviceName}:build`;
}

/**
 * 将 shell 字符串/数组风格统一为文档友好的字符串。
 */
export function normalizeCommandValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeScalar(item))
      .filter((item): item is string => item.length > 0);
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  const scalar = normalizeScalar(value);
  return scalar.length > 0 ? scalar : undefined;
}

/**
 * 运行时环境变量按声明顺序合并，后出现的覆盖前面的同名变量。
 */
export function mergeEnvironmentVariables(
  ...sources: RuntimeEnvironmentVariable[][]
): RuntimeEnvironmentVariable[] {
  const merged = new Map<string, RuntimeEnvironmentVariable>();

  for (const source of sources) {
    for (const entry of source) {
      merged.set(entry.name, entry);
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 从 DockerfileInfo 归一化运行时 stages。
 */
export function extractRuntimeBuildStages(
  dockerfile: DockerfileInfo,
  sourceFile: string,
  runtimeTargets: Iterable<string> = [],
): RuntimeBuildStage[] {
  const normalizedTargets = new Set(
    [...runtimeTargets]
      .map((target) => target.trim())
      .filter((target) => target.length > 0),
  );

  const stages = dockerfile.stages.map((stage, index) => {
    const name = stage.alias ?? `stage-${index + 1}`;
    const commands: string[] = [];
    const environment: RuntimeEnvironmentVariable[] = [];
    const exposedPorts: string[] = [];
    const volumes: string[] = [];
    const copiesFrom = new Set<string>();
    let workdir: string | undefined;
    let command: string | undefined;
    let entrypoint: string | undefined;

    for (const instruction of stage.instructions) {
      if (instruction.type === 'RUN') {
        commands.push(instruction.args);
      }

      if (instruction.type === 'ENV') {
        environment.push(...parseDockerEnvInstruction(instruction.args, sourceFile, name));
      }

      if (instruction.type === 'EXPOSE') {
        exposedPorts.push(...parseDockerExposeInstruction(instruction.args));
      }

      if (instruction.type === 'VOLUME') {
        volumes.push(...parseDockerVolumeInstruction(instruction.args));
      }

      if (instruction.type === 'WORKDIR') {
        workdir = instruction.args.trim();
      }

      if (instruction.type === 'CMD') {
        command = normalizeCommandValue(parseDockerCommandInstruction(instruction.args));
      }

      if (instruction.type === 'ENTRYPOINT') {
        entrypoint = normalizeCommandValue(parseDockerCommandInstruction(instruction.args));
      }

      if (instruction.type === 'COPY' || instruction.type === 'ADD') {
        const fromMatch = instruction.args.match(/--from=(\S+)/);
        if (fromMatch?.[1]) {
          copiesFrom.add(fromMatch[1]);
        }
      }
    }

    return {
      name,
      alias: stage.alias,
      index,
      role: inferStageRole(name, stage.alias, index, dockerfile.stages.length, normalizedTargets),
      baseImage: stage.baseImage,
      sourceFile,
      commands,
      environment,
      exposedPorts: uniqueSorted(exposedPorts),
      volumes: uniqueSorted(volumes),
      copiesFrom: [...copiesFrom].sort(),
      workdir,
      command,
      entrypoint,
    };
  });

  return stages;
}

/**
 * 从配置项中过滤 runtime 相关提示。
 */
export function collectRuntimeConfigHints(
  entries: ConfigEntry[],
  sourceFile: string,
  format: RuntimeConfigFormat,
): RuntimeConfigHint[] {
  return entries
    .filter((entry) => format === 'env' || isRuntimeRelevantKey(entry.keyPath))
    .map((entry) => ({
      keyPath: entry.keyPath,
      value: entry.defaultValue,
      sourceFile,
      format,
      category: inferRuntimeConfigCategory(entry.keyPath, format),
      description: entry.description || undefined,
    }));
}

/**
 * 统计共享运行时模型的摘要信息。
 */
export function summarizeRuntimeTopology(topology: RuntimeTopology): RuntimeTopologyStats {
  return {
    totalServices: topology.services.length,
    totalImages: topology.images.length,
    totalContainers: topology.containers.length,
    totalStages: topology.stages.length,
    totalDependencies: topology.services.reduce((sum, service) => sum + service.dependsOn.length, 0),
    totalConfigHints: topology.configHints.length,
  };
}

// ============================================================
// Internal helpers
// ============================================================

function normalizeScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

function inferStageRole(
  name: string,
  alias: string | undefined,
  index: number,
  totalStages: number,
  runtimeTargets: Set<string>,
): RuntimeStageRole {
  if (runtimeTargets.size > 0) {
    if (runtimeTargets.has(name) || (alias && runtimeTargets.has(alias))) {
      return 'runtime';
    }
    return 'build';
  }

  return index === totalStages - 1 ? 'runtime' : 'build';
}

function parseDockerEnvInstruction(
  args: string,
  sourceFile: string,
  stageName: string,
): RuntimeEnvironmentVariable[] {
  const entries: RuntimeEnvironmentVariable[] = [];
  const tokens = tokenizeShellLikeString(args);

  if (tokens.every((token) => token.includes('='))) {
    for (const token of tokens) {
      const [name, ...rest] = token.split('=');
      if (!name) continue;
      entries.push({
        name,
        value: rest.join('='),
        sourceKind: 'dockerfile',
        sourceFile,
        scope: 'stage',
      });
    }
    return entries;
  }

  if (tokens.length >= 2) {
    entries.push({
      name: tokens[0]!,
      value: tokens.slice(1).join(' '),
      sourceKind: 'dockerfile',
      sourceFile,
      scope: 'stage',
    });
  }

  return entries.map((entry) => ({
    ...entry,
    sourceFile: `${sourceFile}#${stageName}`,
  }));
}

function parseDockerExposeInstruction(args: string): string[] {
  return tokenizeShellLikeString(args)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseDockerVolumeInstruction(args: string): string[] {
  const trimmed = args.trim();

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter((item) => item.length > 0);
  }

  return tokenizeShellLikeString(trimmed);
}

function parseDockerCommandInstruction(args: string): unknown {
  const trimmed = args.trim();

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];

    return splitInlineCollection(inner).map((item) => item.replace(/^['"]|['"]$/g, ''));
  }

  return trimmed;
}

function tokenizeShellLikeString(value: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const char of value.trim()) {
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function splitInlineCollection(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let depth = 0;

  for (const char of value) {
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (char === '[' || char === '{') {
        depth += 1;
      } else if (char === ']' || char === '}') {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        if (current.trim().length > 0) {
          items.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim().length > 0) {
    items.push(current.trim());
  }

  return items;
}

function isRuntimeRelevantKey(keyPath: string): boolean {
  return /(env|port|host|url|endpoint|image|docker|compose|command|entrypoint|cmd|volume|mount|listen|service)/i.test(
    keyPath,
  );
}

function inferRuntimeConfigCategory(
  keyPath: string,
  format: RuntimeConfigFormat,
): RuntimeConfigCategory {
  if (format === 'env') {
    return 'environment';
  }

  if (/port|listen/i.test(keyPath)) {
    return 'port';
  }

  if (/image|docker|tag/i.test(keyPath)) {
    return 'image';
  }

  if (/command|entrypoint|cmd/i.test(keyPath)) {
    return 'command';
  }

  if (/volume|mount|path/i.test(keyPath)) {
    return 'volume';
  }

  if (/env|host|url|endpoint|service/i.test(keyPath)) {
    return 'environment';
  }

  return 'general';
}
