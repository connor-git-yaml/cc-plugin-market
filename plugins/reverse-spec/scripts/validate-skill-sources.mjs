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

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function loadReverseSpecSkillContract(projectRoot) {
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

function validateSources(projectRoot, entries, errors) {
  const missing = [];
  for (const entry of entries) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    if (!fs.existsSync(sourcePath)) {
      missing.push(entry.source);
    }
  }
  if (missing.length > 0) {
    errors.push(`缺少 reverse-spec canonical source skill: ${missing.join(', ')}`);
  }
  return createCheck(
    'canonical-source-skills',
    'Reverse-Spec canonical source skills',
    missing.length === 0 ? 'pass' : 'fail',
    {
      count: entries.length,
      missing,
    },
  );
}

function validateMirrors(projectRoot, entries, errors) {
  const mirrorMismatches = [];
  const missingMirrors = [];

  for (const entry of entries) {
    const sourcePath = path.resolve(projectRoot, entry.source);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
    const mirrors = Array.isArray(entry.mirrors) ? entry.mirrors : [];
    for (const mirror of mirrors) {
      const mirrorPath = path.resolve(projectRoot, mirror.path);
      if (!fs.existsSync(mirrorPath)) {
        missingMirrors.push(mirror.path);
        continue;
      }
      const mirrorContent = fs.readFileSync(mirrorPath, 'utf-8');
      if (mirrorContent !== sourceContent) {
        mirrorMismatches.push({
          mirror: mirror.path,
          source: entry.source,
        });
      }
    }
  }

  if (missingMirrors.length > 0) {
    errors.push(
      `缺少 reverse-spec compatibility mirror，请先运行 npm run reverse-spec:sync:skills：${missingMirrors.join(', ')}`,
    );
  }

  if (mirrorMismatches.length > 0) {
    errors.push(
      `以下 reverse-spec mirror 与 canonical source 不一致：${mirrorMismatches
        .map((item) => `${item.mirror} <- ${item.source}`)
        .join(', ')}`,
    );
  }

  return createCheck(
    'compatibility-mirrors',
    'Reverse-Spec compatibility mirrors',
    missingMirrors.length === 0 && mirrorMismatches.length === 0
      ? 'pass'
      : 'fail',
    {
      missingMirrors,
      mirrorMismatches,
    },
  );
}

function validatePluginMetadata(projectRoot, contract, errors) {
  const metadataPath = path.resolve(projectRoot, contract.plugin?.metadataSource ?? '');
  const marketplacePath = path.resolve(
    projectRoot,
    contract.plugin?.marketplaceManifest ?? '',
  );

  if (!fs.existsSync(metadataPath)) {
    errors.push(`缺少 reverse-spec plugin metadata: ${contract.plugin?.metadataSource ?? ''}`);
    return createCheck('plugin-metadata-sync', 'Plugin metadata 与 marketplace 同步', 'fail');
  }
  if (!fs.existsSync(marketplacePath)) {
    errors.push(
      `缺少 reverse-spec marketplace manifest: ${contract.plugin?.marketplaceManifest ?? ''}`,
    );
    return createCheck('plugin-metadata-sync', 'Plugin metadata 与 marketplace 同步', 'fail');
  }

  const metadata = readJson(metadataPath);
  const marketplace = readJson(marketplacePath);
  const entry = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.find((item) => item.name === metadata.name)
    : null;

  if (!entry) {
    errors.push(`marketplace.json 中缺少 reverse-spec 插件条目: ${metadata.name}`);
  } else {
    const expectedSource = `./${contract.plugin.sourceRoot}`;
    if (entry.source !== expectedSource) {
      errors.push(
        `reverse-spec marketplace source 不匹配：期望 ${expectedSource}，实际 ${entry.source}`,
      );
    }
    if (entry.version !== metadata.version) {
      errors.push(
        `reverse-spec marketplace version 不匹配：期望 ${metadata.version}，实际 ${entry.version}`,
      );
    }
  }

  return createCheck(
    'plugin-metadata-sync',
    'Plugin metadata 与 marketplace 同步',
    entry &&
      errors.every(
        (error) =>
          !error.includes('reverse-spec marketplace') &&
          !error.includes('缺少 reverse-spec plugin metadata') &&
          !error.includes('缺少 reverse-spec marketplace manifest') &&
          !error.includes('marketplace.json 中缺少 reverse-spec 插件条目'),
      )
      ? 'pass'
      : 'fail',
    {
      pluginName: metadata.name,
      version: metadata.version,
      sourceRoot: contract.plugin.sourceRoot,
    },
  );
}

function formatText(result) {
  const lines = [
    `[reverse-spec-source] status=${result.status}`,
    `contract: ${result.contractPath}`,
    '',
  ];

  for (const check of result.checks) {
    lines.push(`- ${check.id}: ${check.status}`);
  }

  if (result.errors.length > 0) {
    lines.push('', 'errors:');
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }

  return lines.join('\n');
}

export function validateReverseSpecSkillSources(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const { contractPath, contract } = loadReverseSpecSkillContract(projectRoot);
  const entries = Array.isArray(contract.skills?.entries)
    ? contract.skills.entries
    : [];
  const errors = [];
  const checks = [
    validateSources(projectRoot, entries, errors),
    validateMirrors(projectRoot, entries, errors),
    validatePluginMetadata(projectRoot, contract, errors),
  ];

  return {
    schemaVersion: contract.schemaVersion ?? 1,
    status: errors.length > 0 ? 'fail' : 'pass',
    contractPath: toProjectRelative(projectRoot, contractPath),
    checks,
    errors,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      '用法: node plugins/reverse-spec/scripts/validate-skill-sources.mjs --project-root . [--json]',
    );
    return;
  }

  const result = validateReverseSpecSkillSources(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatText(result));
  }

  if (result.status !== 'pass') {
    process.exit(1);
  }
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
