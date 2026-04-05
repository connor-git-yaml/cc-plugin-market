import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlDocument } from '../../spec-driver/scripts/lib/simple-yaml.mjs';

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('缺少 --project-root 参数值');
      }
      options.projectRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  return options;
}

export function loadSkillSourceContract(projectRoot) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const contractPath = path.resolve(
    scriptDir,
    '..',
    'contracts',
    'skill-source-of-truth.yaml',
  );
  const contract = parseYamlDocument(fs.readFileSync(contractPath, 'utf-8'));
  return { contractPath, contract };
}

function toProjectRelative(projectRoot, targetPath) {
  const root = fs.realpathSync(projectRoot);
  const target = fs.realpathSync(targetPath);
  return path.relative(root, target).split(path.sep).join('/');
}

function syncMirrors(projectRoot, contract) {
  const entries = Array.isArray(contract.skills?.entries)
    ? contract.skills.entries
    : [];
  const results = [];

  for (const entry of entries) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`缺少 canonical source skill: ${entry.source}`);
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');
    const mirrors = Array.isArray(entry.mirrors) ? entry.mirrors : [];
    const synced = [];

    for (const mirror of mirrors) {
      const targetPath = path.resolve(projectRoot, mirror.path);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf-8');
      synced.push({
        id: mirror.id,
        path: mirror.path,
      });
    }

    results.push({
      id: entry.id,
      source: entry.source,
      synced,
    });
  }

  return results;
}

function formatText(result) {
  const lines = ['[reverse-spec-skills] synchronized', ''];
  for (const entry of result.entries) {
    lines.push(`- ${entry.id}`);
    lines.push(`  source: ${entry.source}`);
    for (const mirror of entry.synced) {
      lines.push(`  -> ${mirror.id}: ${mirror.path}`);
    }
  }
  return lines.join('\n');
}

export function syncReverseSpecSkillMirrors(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const { contractPath, contract } = loadSkillSourceContract(projectRoot);
  const entries = syncMirrors(projectRoot, contract);
  return {
    status: 'pass',
    contractPath: toProjectRelative(projectRoot, contractPath),
    entries,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      '用法: node plugins/reverse-spec/scripts/sync-skill-mirrors.mjs --project-root . [--json]',
    );
    return;
  }

  const result = syncReverseSpecSkillMirrors(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatText(result));
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

if (isDirectExecution()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
