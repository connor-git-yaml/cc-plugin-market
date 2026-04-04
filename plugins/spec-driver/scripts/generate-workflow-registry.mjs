#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ALLOWED_OVERRIDE_FIELDS = new Set([
  'title',
  'persona',
  'useCases',
  'recommendedWhen',
  'templateVersion',
]);

function parseYamlDocument(content) {
  const lines = tokenizeYamlLines(content);
  if (lines.length === 0) {
    return {};
  }

  const state = { index: 0 };
  const parsed = parseYamlBlock(lines, state, lines[0].indent);
  return isObject(parsed) ? parsed : {};
}

function tokenizeYamlLines(content) {
  const lines = [];
  for (const rawLine of content.split('\n')) {
    const withoutComment = stripYamlComment(rawLine);
    if (withoutComment.trim() === '') {
      continue;
    }

    lines.push({
      indent: rawLine.match(/^\s*/)?.[0].length ?? 0,
      text: withoutComment.trim(),
    });
  }
  return lines;
}

function parseYamlBlock(lines, state, indent) {
  if (state.index >= lines.length) {
    return {};
  }

  const current = lines[state.index];
  if (current.text.startsWith('- ')) {
    return parseYamlSequence(lines, state, indent);
  }

  return parseYamlMapping(lines, state, indent);
}

function parseYamlMapping(lines, state, indent) {
  const result = {};

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent > indent) {
      state.index += 1;
      continue;
    }

    if (line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    const separatorIndex = findYamlSeparator(line.text);
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.text.slice(0, separatorIndex).trim();
    const rawValue = line.text.slice(separatorIndex + 1).trim();
    if (rawValue.length > 0) {
      result[key] = parseYamlScalar(rawValue);
      continue;
    }

    const next = lines[state.index];
    if (!next || next.indent <= indent) {
      result[key] = {};
      continue;
    }

    result[key] = parseYamlBlock(lines, state, next.indent);
  }

  return result;
}

function parseYamlSequence(lines, state, indent) {
  const result = [];

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent) {
      break;
    }

    if (line.indent !== indent || !line.text.startsWith('- ')) {
      break;
    }

    state.index += 1;
    const itemText = line.text.slice(2).trim();
    if (itemText.length === 0) {
      const next = lines[state.index];
      if (!next || next.indent <= indent) {
        result.push(null);
        continue;
      }
      result.push(parseYamlBlock(lines, state, next.indent));
      continue;
    }

    const separatorIndex = findYamlSeparator(itemText);
    if (separatorIndex > 0) {
      const key = itemText.slice(0, separatorIndex).trim();
      const rawValue = itemText.slice(separatorIndex + 1).trim();
      const entry = {};
      if (rawValue.length > 0) {
        entry[key] = parseYamlScalar(rawValue);
      } else {
        entry[key] = {};
      }

      const next = lines[state.index];
      if (next && next.indent > indent) {
        const nested = parseYamlBlock(lines, state, next.indent);
        if (isObject(nested)) {
          Object.assign(entry, nested);
        } else if (Array.isArray(nested)) {
          entry[key] = nested;
        }
      }

      result.push(entry);
      continue;
    }

    result.push(parseYamlScalar(itemText));
  }

  return result;
}

function parseYamlScalar(rawValue) {
  const trimmed = rawValue.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function stripYamlComment(rawLine) {
  let inSingle = false;
  let inDouble = false;
  let result = '';
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      result += char;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      continue;
    }
    if (char === '#' && !inSingle && !inDouble) {
      break;
    }
    result += char;
  }
  return result;
}

function findYamlSeparator(text) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === ':' && !inSingle && !inDouble) {
      return index;
    }
  }
  return -1;
}

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--project-root') {
      args.projectRoot = argv[index + 1] ?? args.projectRoot;
      index += 1;
    }
  }

  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

export function generateWorkflowRegistry(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const pluginDir = path.dirname(scriptDir);
  const workflowDir = path.join(pluginDir, 'workflows');
  const overrideDir = path.join(projectRoot, '.specify', 'workflows');
  const outputDir = path.join(projectRoot, 'specs', 'products', 'spec-driver');
  const warnings = [];
  const generatedAt = new Date().toISOString();

  const workflowDefs = readWorkflowDefinitions(workflowDir);
  const overrides = readWorkflowOverrides(overrideDir, warnings);
  const workflows = workflowDefs.map((workflow) => applyWorkflowOverride(workflow, overrides.get(workflow.id), warnings));
  const goldenPaths = readGoldenPaths(path.join(workflowDir, 'golden-paths.yaml'));

  fs.mkdirSync(outputDir, { recursive: true });

  const indexJson = {
    generatedAt,
    sourceDir: relativePosix(projectRoot, workflowDir),
    overrideDir: fs.existsSync(overrideDir) ? relativePosix(projectRoot, overrideDir) : null,
    workflowCount: workflows.length,
    goldenPathCount: goldenPaths.length,
    workflows,
    goldenPaths,
    warnings,
  };

  const jsonPath = path.join(outputDir, 'workflow-index.json');
  const markdownPath = path.join(outputDir, 'workflow-index.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(indexJson, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(markdownPath, renderWorkflowIndexMarkdown(indexJson), 'utf-8');

  return {
    generatedAt,
    workflowCount: workflows.length,
    goldenPathCount: goldenPaths.length,
    jsonPath: relativePosix(projectRoot, jsonPath),
    markdownPath: relativePosix(projectRoot, markdownPath),
    workflows,
    goldenPaths,
    warnings,
  };
}

function readWorkflowDefinitions(workflowDir) {
  const filePaths = fs.readdirSync(workflowDir)
    .filter((fileName) => fileName.endsWith('.yaml') && fileName !== 'golden-paths.yaml')
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(workflowDir, fileName));

  return filePaths.map((filePath) => {
    const parsed = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
    return normalizeWorkflowDefinition(parsed, filePath);
  });
}

function readWorkflowOverrides(overrideDir, warnings) {
  const overrides = new Map();
  if (!fs.existsSync(overrideDir)) {
    return overrides;
  }

  const filePaths = fs.readdirSync(overrideDir)
    .filter((fileName) => fileName.endsWith('.yaml'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(overrideDir, fileName));

  for (const filePath of filePaths) {
    const parsed = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
    const workflowId = asString(parsed.id) ?? path.basename(filePath, '.yaml');
    const fields = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'id') {
        continue;
      }

      if (!ALLOWED_OVERRIDE_FIELDS.has(key)) {
        warnings.push(`workflow override 忽略非 metadata 字段: ${workflowId}.${key}`);
        continue;
      }

      fields[key] = value;
    }

    overrides.set(workflowId, fields);
  }

  return overrides;
}

function applyWorkflowOverride(base, override, warnings) {
  if (!override) {
    return base;
  }

  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!ALLOWED_OVERRIDE_FIELDS.has(key)) {
      warnings.push(`workflow override 字段未生效: ${base.id}.${key}`);
      continue;
    }
    merged[key] = normalizeOverrideValue(key, value, base);
  }
  return merged;
}

function normalizeOverrideValue(key, value, base) {
  if (key === 'useCases' || key === 'recommendedWhen') {
    return asStringArray(value) ?? base[key];
  }

  return asString(value) ?? base[key];
}

function normalizeWorkflowDefinition(parsed, filePath) {
  return {
    id: asString(parsed.id) ?? path.basename(filePath, '.yaml'),
    title: asString(parsed.title) ?? path.basename(filePath, '.yaml'),
    persona: asString(parsed.persona) ?? 'unknown',
    useCases: asStringArray(parsed.useCases) ?? [],
    entryCommand: normalizeStringMap(parsed.entryCommand),
    requiredInputs: asStringArray(parsed.requiredInputs) ?? [],
    keyGates: asStringArray(parsed.keyGates) ?? [],
    artifacts: asStringArray(parsed.artifacts) ?? [],
    recommendedWhen: asStringArray(parsed.recommendedWhen) ?? [],
    templateVersion: asString(parsed.templateVersion) ?? '1.0.0',
  };
}

function readGoldenPaths(filePath) {
  const parsed = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
  const paths = Array.isArray(parsed.goldenPaths) ? parsed.goldenPaths : [];
  return paths
    .map((entry) => (isObject(entry) ? entry : null))
    .filter(Boolean)
    .map((entry) => ({
      id: asString(entry.id) ?? 'unknown',
      title: asString(entry.title) ?? asString(entry.id) ?? 'Unknown Golden Path',
      persona: asString(entry.persona) ?? 'unknown',
      workflows: asStringArray(entry.workflows) ?? [],
      recommendedWhen: asStringArray(entry.recommendedWhen) ?? [],
    }));
}

function normalizeStringMap(value) {
  if (!isObject(value)) {
    return {};
  }

  const result = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const parsed = asString(entryValue);
    if (parsed) {
      result[key] = parsed;
    }
  }
  return result;
}

function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relativePosix(projectRoot, candidatePath) {
  return path.relative(projectRoot, candidatePath).split(path.sep).join('/');
}

function renderWorkflowIndexMarkdown(index) {
  const lines = [
    '# Spec Driver Workflow Registry',
    '',
    `- Generated At: ${index.generatedAt}`,
    `- Source Dir: ${index.sourceDir}`,
    index.overrideDir ? `- Override Dir: ${index.overrideDir}` : '- Override Dir: 未配置',
    `- Workflows: ${index.workflowCount}`,
    `- Golden Paths: ${index.goldenPathCount}`,
    '',
    '## 如何选择技能',
    '',
    '| Workflow | Persona | Use Cases | Claude | Codex |',
    '| --- | --- | --- | --- | --- |',
    ...index.workflows.map((workflow) => (
      `| \`${workflow.id}\` | ${workflow.persona} | ${workflow.useCases.join(' / ')} | \`${workflow.entryCommand.claude ?? '-'}\` | \`${workflow.entryCommand.codex ?? '-'}\` |`
    )),
    '',
    '## Golden Paths',
    '',
  ];

  for (const pathDef of index.goldenPaths) {
    lines.push(`### ${pathDef.title}`);
    lines.push('');
    lines.push(`- ID: \`${pathDef.id}\``);
    lines.push(`- Persona: ${pathDef.persona}`);
    lines.push(`- Workflows: ${pathDef.workflows.map((workflow) => `\`${workflow}\``).join(' -> ')}`);
    if (pathDef.recommendedWhen.length > 0) {
      lines.push('- Recommended When:');
      for (const item of pathDef.recommendedWhen) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push('');
  }

  lines.push('## Workflow Details');
  lines.push('');

  for (const workflow of index.workflows) {
    lines.push(`### ${workflow.title}`);
    lines.push('');
    lines.push(`- ID: \`${workflow.id}\``);
    lines.push(`- Persona: ${workflow.persona}`);
    lines.push(`- Template Version: ${workflow.templateVersion}`);
    lines.push(`- Use Cases: ${workflow.useCases.join(' / ') || '未配置'}`);
    lines.push(`- Required Inputs: ${workflow.requiredInputs.join(' / ') || '未配置'}`);
    lines.push(`- Key Gates: ${workflow.keyGates.join(' / ') || '无'}`);
    lines.push(`- Artifacts: ${workflow.artifacts.join(' / ') || '未配置'}`);
    lines.push(`- Recommended When: ${workflow.recommendedWhen.join(' / ') || '未配置'}`);
    lines.push(`- Claude Entry: \`${workflow.entryCommand.claude ?? '-'}\``);
    lines.push(`- Codex Entry: \`${workflow.entryCommand.codex ?? '-'}\``);
    lines.push('');
  }

  if (index.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    for (const warning of index.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      'Spec Driver Workflow Registry',
      `Workflows: ${result.workflowCount}`,
      `Golden Paths: ${result.goldenPathCount}`,
      `Markdown: ${result.markdownPath}`,
      `JSON: ${result.jsonPath}`,
      ...(result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
    ].join('\n') + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateWorkflowRegistry(args);
  printResult(result, args.json);
}
