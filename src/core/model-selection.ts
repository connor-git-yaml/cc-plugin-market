import * as fs from 'node:fs';
import * as path from 'node:path';

type PlainObject = Record<string, unknown>;

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

const LOGICAL_MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-1-20250805',
  sonnet: DEFAULT_MODEL,
  haiku: 'claude-haiku-4-5-20251001',
};

const PRESET_MODEL_MAP: Record<string, string> = {
  balanced: 'opus',
  'quality-first': 'opus',
  'cost-efficient': 'sonnet',
};

const DEFAULT_CLAUDE_ALIASES: Record<string, string> = {
  'gpt-5': 'opus',
  'gpt-5-mini': 'sonnet',
  o3: 'opus',
  'o4-mini': 'sonnet',
};

export type ReverseSpecModelSource =
  | 'env'
  | 'driver-config-agent'
  | 'driver-config-preset'
  | 'default';

export interface ResolvedReverseSpecModel {
  model: string;
  source: ReverseSpecModelSource;
  configPath?: string;
  rawModel?: string;
}

interface ParsedDriverConfig {
  configPath: string;
  data: PlainObject;
}

export function resolveReverseSpecModel(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
} = {}): ResolvedReverseSpecModel {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const agentId = options.agentId ?? 'specify';

  const config = loadDriverConfig(cwd);
  const claudeAliases = {
    ...DEFAULT_CLAUDE_ALIASES,
    ...(config ? readClaudeAliases(config.data) : {}),
  };
  const claudeFallback = config
    ? normalizeModelName(readClaudeDefault(config.data), claudeAliases)
    : undefined;

  const envModel = normalizeModelName(env['REVERSE_SPEC_MODEL'], claudeAliases);
  if (envModel) {
    return {
      model: toAnthropicModelId(envModel, claudeFallback),
      source: 'env',
      configPath: config?.configPath,
      rawModel: env['REVERSE_SPEC_MODEL'],
    };
  }

  if (config) {
    const agentModel = normalizeModelName(
      readAgentModel(config.data, agentId),
      claudeAliases,
    );
    if (agentModel) {
      return {
        model: toAnthropicModelId(agentModel, claudeFallback),
        source: 'driver-config-agent',
        configPath: config.configPath,
        rawModel: agentModel,
      };
    }

    const preset = readPreset(config.data);
    const logicalModel = PRESET_MODEL_MAP[preset] ?? PRESET_MODEL_MAP.balanced ?? 'opus';
    return {
      model: toAnthropicModelId(logicalModel, claudeFallback),
      source: 'driver-config-preset',
      configPath: config.configPath,
      rawModel: logicalModel,
    };
  }

  return {
    model: DEFAULT_MODEL,
    source: 'default',
  };
}

function toAnthropicModelId(model: string, claudeFallback?: string): string {
  const normalized = model.trim().toLowerCase();
  if (LOGICAL_MODEL_MAP[normalized]) {
    return LOGICAL_MODEL_MAP[normalized];
  }
  if (normalized.startsWith('claude-')) {
    return model.trim();
  }
  if (claudeFallback) {
    const fallback = claudeFallback.trim().toLowerCase();
    if (LOGICAL_MODEL_MAP[fallback]) {
      return LOGICAL_MODEL_MAP[fallback];
    }
    if (fallback.startsWith('claude-')) {
      return claudeFallback.trim();
    }
  }
  return model.trim() || DEFAULT_MODEL;
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

function readClaudeDefault(config: PlainObject): string | undefined {
  const modelCompat = asRecord(config.model_compat);
  const defaults = asRecord(modelCompat?.defaults);
  return asString(defaults?.claude);
}

function readClaudeAliases(config: PlainObject): Record<string, string> {
  const modelCompat = asRecord(config.model_compat);
  const aliases = asRecord(modelCompat?.aliases);
  const claude = asRecord(aliases?.claude);
  if (!claude) {
    return {};
  }

  const mapped: Record<string, string> = {};
  for (const [key, value] of Object.entries(claude)) {
    const k = key.trim().toLowerCase();
    const v = asString(value)?.trim();
    if (k && v) {
      mapped[k] = v;
    }
  }
  return mapped;
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
