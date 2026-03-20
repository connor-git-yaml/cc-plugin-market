import * as fs from 'node:fs';
import * as path from 'node:path';

type PlainObject = Record<string, unknown>;

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_CODEX_MODEL = 'gpt-5.4';

const LOGICAL_CLAUDE_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-1-20250805',
  sonnet: DEFAULT_CLAUDE_MODEL,
  haiku: 'claude-haiku-4-5-20251001',
};

const LOGICAL_CODEX_MODEL_MAP: Record<string, string> = {
  opus: DEFAULT_CODEX_MODEL,
  sonnet: DEFAULT_CODEX_MODEL,
  haiku: DEFAULT_CODEX_MODEL,
};

const PRESET_MODEL_MAP: Record<string, string> = {
  balanced: 'opus',
  'quality-first': 'opus',
  'cost-efficient': 'sonnet',
};

const DEFAULT_CLAUDE_ALIASES: Record<string, string> = {
  'gpt-5.4': 'sonnet',
  'gpt-5.3-codex': 'sonnet',
  'gpt-5.3-codex-thinking-high': 'opus',
  'gpt-5.3-codex-thinking-medium': 'sonnet',
  'gpt-5.3-codex-thinking-low': 'haiku',
  'gpt-5': 'opus',
  'gpt-5-mini': 'sonnet',
  o3: 'opus',
  'o4-mini': 'sonnet',
};

const DEFAULT_CODEX_ALIASES: Record<string, string> = {
  opus: DEFAULT_CODEX_MODEL,
  sonnet: DEFAULT_CODEX_MODEL,
  haiku: DEFAULT_CODEX_MODEL,
  'claude-opus-4-1-20250805': DEFAULT_CODEX_MODEL,
  'claude-opus-4-6': DEFAULT_CODEX_MODEL,
  'claude-sonnet-4-5-20250929': DEFAULT_CODEX_MODEL,
  'claude-haiku-4-5-20251001': DEFAULT_CODEX_MODEL,
};

export type ReverseSpecRuntime = 'claude' | 'codex';

export type ReverseSpecModelSource =
  | 'env'
  | 'driver-config-agent'
  | 'driver-config-preset'
  | 'default';

export type ReverseSpecRuntimeSource =
  | 'env'
  | 'config'
  | 'default';

export interface ResolvedReverseSpecRuntime {
  runtime: ReverseSpecRuntime;
  source: ReverseSpecRuntimeSource;
  configPath?: string;
}

export interface ResolvedReverseSpecModel {
  model: string;
  source: ReverseSpecModelSource;
  configPath?: string;
  rawModel?: string;
  runtime: ReverseSpecRuntime;
  runtimeSource: ReverseSpecRuntimeSource;
}

export interface ResolvedCodexExecutionConfig {
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  serviceTier?: string;
  configPath?: string;
}

interface ParsedDriverConfig {
  configPath: string;
  data: PlainObject;
}

export function resolveReverseSpecRuntime(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ResolvedReverseSpecRuntime {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const config = loadDriverConfig(cwd);
  const resolved = resolveRuntime(config?.data, env);

  return {
    runtime: resolved.runtime,
    source: resolved.source,
    configPath: config?.configPath,
  };
}

export function resolveReverseSpecModel(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
  provider?: ReverseSpecRuntime;
} = {}): ResolvedReverseSpecModel {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const agentId = options.agentId ?? 'specify';

  const config = loadDriverConfig(cwd);
  const runtimeResolution = resolveRuntime(config?.data, env);
  const runtime = options.provider ?? runtimeResolution.runtime;
  const aliases = {
    ...(runtime === 'codex' ? DEFAULT_CODEX_ALIASES : DEFAULT_CLAUDE_ALIASES),
    ...(config ? readRuntimeAliases(config.data, runtime) : {}),
  };
  const runtimeFallback = config
    ? normalizeModelName(readRuntimeDefault(config.data, runtime), aliases)
    : undefined;

  const envModel = normalizeModelName(env['REVERSE_SPEC_MODEL'], aliases);
  if (envModel) {
    return {
      model: toRuntimeModelId(envModel, runtime, runtimeFallback),
      source: 'env',
      configPath: config?.configPath,
      rawModel: env['REVERSE_SPEC_MODEL'],
      runtime,
      runtimeSource: runtimeResolution.source,
    };
  }

  if (config) {
    const agentModel = normalizeModelName(
      readAgentModel(config.data, agentId),
      aliases,
    );
    if (agentModel) {
      return {
        model: toRuntimeModelId(agentModel, runtime, runtimeFallback),
        source: 'driver-config-agent',
        configPath: config.configPath,
        rawModel: agentModel,
        runtime,
        runtimeSource: runtimeResolution.source,
      };
    }

    const preset = readPreset(config.data);
    const logicalModel = PRESET_MODEL_MAP[preset] ?? PRESET_MODEL_MAP.balanced ?? 'opus';
    return {
      model: toRuntimeModelId(logicalModel, runtime, runtimeFallback),
      source: 'driver-config-preset',
      configPath: config.configPath,
      rawModel: logicalModel,
      runtime,
      runtimeSource: runtimeResolution.source,
    };
  }

  return {
    model: runtime === 'codex' ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL,
    source: 'default',
    runtime,
    runtimeSource: runtimeResolution.source,
  };
}

export function resolveCodexExecutionConfig(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
} = {}): ResolvedCodexExecutionConfig {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const config = loadDriverConfig(cwd);
  const modelResolution = resolveReverseSpecModel({
    cwd,
    env: options.env,
    agentId: options.agentId,
    provider: 'codex',
  });

  return {
    model: modelResolution.model,
    reasoningEffort: config ? readCodexReasoningEffort(config.data) : undefined,
    serviceTier: config ? readCodexServiceTier(config.data) : undefined,
    configPath: config?.configPath,
  };
}

function toRuntimeModelId(
  model: string,
  runtime: ReverseSpecRuntime,
  runtimeFallback?: string,
): string {
  return runtime === 'codex'
    ? toCodexModelId(model, runtimeFallback)
    : toClaudeModelId(model, runtimeFallback);
}

function toClaudeModelId(model: string, claudeFallback?: string): string {
  const normalized = model.trim().toLowerCase();
  if (LOGICAL_CLAUDE_MODEL_MAP[normalized]) {
    return LOGICAL_CLAUDE_MODEL_MAP[normalized];
  }
  if (normalized.startsWith('claude-')) {
    return model.trim();
  }
  if (claudeFallback) {
    const fallback = claudeFallback.trim().toLowerCase();
    if (LOGICAL_CLAUDE_MODEL_MAP[fallback]) {
      return LOGICAL_CLAUDE_MODEL_MAP[fallback];
    }
    if (fallback.startsWith('claude-')) {
      return claudeFallback.trim();
    }
  }
  return model.trim() || DEFAULT_CLAUDE_MODEL;
}

function toCodexModelId(model: string, codexFallback?: string): string {
  const normalized = model.trim().toLowerCase();
  if (LOGICAL_CODEX_MODEL_MAP[normalized]) {
    if (codexFallback) {
      const fallback = codexFallback.trim().toLowerCase();
      if (isNativeCodexModel(fallback)) {
        return codexFallback.trim();
      }
    }
    return LOGICAL_CODEX_MODEL_MAP[normalized];
  }
  if (isNativeCodexModel(normalized)) {
    return model.trim();
  }
  if (codexFallback) {
    const fallback = codexFallback.trim().toLowerCase();
    if (LOGICAL_CODEX_MODEL_MAP[fallback]) {
      return LOGICAL_CODEX_MODEL_MAP[fallback];
    }
    if (isNativeCodexModel(fallback)) {
      return codexFallback.trim();
    }
  }
  return model.trim() || DEFAULT_CODEX_MODEL;
}

function normalizeModelName(
  model: string | undefined,
  claudeAliases: Record<string, string>,
): string | undefined {
  if (!model) return undefined;

  let current = model.trim();
  if (!current) return undefined;

  // Multi-hop alias resolution (e.g. gpt-5 -> opus -> claude model id)
  for (let i = 0; i < 4; i += 1) {
    const alias = claudeAliases[current.toLowerCase()];
    if (!alias) {
      break;
    }
    const next = alias.trim();
    if (!next || next === current) {
      break;
    }
    current = next;
  }

  return current;
}

function readAgentModel(config: PlainObject, agentId: string): string | undefined {
  const agents = asRecord(config.agents);
  if (!agents) return undefined;
  const agent = asRecord(agents[agentId]);
  if (!agent) return undefined;
  return asString(agent.model);
}

function readPreset(config: PlainObject): string {
  const preset = asString(config.preset)?.trim().toLowerCase();
  if (!preset) {
    return 'balanced';
  }
  return preset;
}

function readRuntimeDefault(
  config: PlainObject,
  runtime: ReverseSpecRuntime,
): string | undefined {
  const modelCompat = asRecord(config.model_compat);
  const defaults = asRecord(modelCompat?.defaults);
  return asString(defaults?.[runtime]);
}

function readRuntimeAliases(
  config: PlainObject,
  runtime: ReverseSpecRuntime,
): Record<string, string> {
  const modelCompat = asRecord(config.model_compat);
  const aliases = asRecord(modelCompat?.aliases);
  const runtimeAliases = asRecord(aliases?.[runtime]);
  if (!runtimeAliases) {
    return {};
  }

  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtimeAliases)) {
    const k = key.trim().toLowerCase();
    const v = asString(value)?.trim();
    if (k && v) {
      mapped[k] = v;
    }
  }
  return mapped;
}

function readCodexReasoningEffort(
  config: PlainObject,
): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  const codexThinking = asRecord(config.codex_thinking);
  const level = asString(codexThinking?.default_level)?.trim().toLowerCase();
  if (level === 'low' || level === 'medium' || level === 'high' || level === 'xhigh') {
    return level;
  }
  return undefined;
}

function readCodexServiceTier(config: PlainObject): string | undefined {
  const codex = asRecord(config.codex);
  const serviceTier = asString(codex?.service_tier)?.trim().toLowerCase();
  return serviceTier || undefined;
}

function resolveRuntime(
  config: PlainObject | undefined,
  env: NodeJS.ProcessEnv,
): { runtime: ReverseSpecRuntime; source: ReverseSpecRuntimeSource } {
  const configuredRuntime = readRuntime(config);
  if (configuredRuntime) {
    return { runtime: configuredRuntime, source: 'config' };
  }

  if (isCodexRuntimeEnv(env)) {
    return { runtime: 'codex', source: 'env' };
  }

  return { runtime: 'claude', source: 'default' };
}

function readRuntime(config: PlainObject | undefined): ReverseSpecRuntime | undefined {
  if (!config) return undefined;

  const modelCompat = asRecord(config.model_compat);
  const runtime = asString(modelCompat?.runtime)?.trim().toLowerCase();
  if (runtime === 'claude' || runtime === 'codex') {
    return runtime;
  }
  return undefined;
}

function isCodexRuntimeEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CODEX_THREAD_ID'] ||
    env['CODEX_SHELL'] ||
    env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'],
  );
}

function isNativeCodexModel(model: string): boolean {
  return model.startsWith('gpt-') || model === 'o3' || model === 'o4-mini';
}

function loadDriverConfig(startDir: string): ParsedDriverConfig | null {
  const configPath = findDriverConfigPath(startDir);
  if (!configPath) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = parseSimpleYaml(raw);
    return {
      configPath,
      data: parsed,
    };
  } catch {
    return null;
  }
}

function findDriverConfigPath(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (true) {
    const direct = path.join(current, 'spec-driver.config.yaml');
    if (fs.existsSync(direct)) {
      return direct;
    }

    const nested = path.join(current, '.specify', 'spec-driver.config.yaml');
    if (fs.existsSync(nested)) {
      return nested;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function parseSimpleYaml(content: string): PlainObject {
  const root: PlainObject = {};
  const stack: Array<{ indent: number; obj: PlainObject }> = [
    { indent: -1, obj: root },
  ];

  for (const originalLine of content.split('\n')) {
    const line = stripInlineComment(originalLine);
    if (!line.trim()) continue;

    const match = /^(\s*)([^:]+):(?:\s*(.*))?$/.exec(line);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const key = match[2]?.trim();
    const valueRaw = (match[3] ?? '').trim();
    if (!key) continue;

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1]!.obj;
    if (!valueRaw) {
      const child: PlainObject = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
      continue;
    }

    parent[key] = parseScalar(valueRaw);
  }

  return root;
}

function stripInlineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\'' && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '#' && !inSingle && !inDouble) {
      const prev = i > 0 ? (line[i - 1] ?? ' ') : ' ';
      if (/\s/.test(prev)) {
        return line.slice(0, i).trimEnd();
      }
    }
  }

  return line;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '{}') return {};
  if (trimmed === '[]') return [];

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function asRecord(value: unknown): PlainObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as PlainObject;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
