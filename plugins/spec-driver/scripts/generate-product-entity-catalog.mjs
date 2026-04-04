#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_KIND = 'product';
const DEFAULT_OWNER = 'unknown';
const DEFAULT_LIFECYCLE = 'unknown';
const ENTITY_SCHEMA_VERSION = 1;

const WORKFLOW_REFS_BY_PRODUCT = {
  'reverse-spec': [
    'reverse-spec.init',
    'reverse-spec.generate',
    'reverse-spec.batch',
    'reverse-spec.diff',
    'reverse-spec.mcp-server',
    'reverse-spec.auth-status',
  ],
  'spec-driver': [
    'spec-driver-feature',
    'spec-driver-story',
    'spec-driver-fix',
    'spec-driver-resume',
    'spec-driver-sync',
    'spec-driver-doc',
  ],
};

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

export function generateProductEntityCatalog(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const generatedAt = new Date().toISOString();
  const productsRoot = path.join(projectRoot, 'specs', 'products');
  const mappingPath = path.join(productsRoot, 'product-mapping.yaml');

  if (!fs.existsSync(mappingPath)) {
    throw new Error(`未找到 product mapping: ${mappingPath}`);
  }

  const mapping = parseProductMapping(fs.readFileSync(mappingPath, 'utf-8'));
  const repoMeta = detectRepoMetadata(projectRoot);
  const entities = [];
  const warnings = [];

  for (const [productId, productDef] of Object.entries(mapping.products)) {
    const currentSpecRelPath = toPosix(path.join('specs', 'products', productId, 'current-spec.md'));
    const currentSpecPath = path.join(projectRoot, currentSpecRelPath);
    const entityRelPath = toPosix(path.join('specs', 'products', productId, 'entity.yaml'));
    const entityPath = path.join(projectRoot, entityRelPath);

    const currentSpecMeta = fs.existsSync(currentSpecPath)
      ? parseCurrentSpec(fs.readFileSync(currentSpecPath, 'utf-8'))
      : null;

    if (!currentSpecMeta) {
      warnings.push(`缺少 current-spec.md: ${currentSpecRelPath}`);
    }

    const qualityReportInfo = detectQualityReport(projectRoot, productId);
    const lifecycle = inferLifecycle(currentSpecMeta?.statusRaw);
    const kind = inferKind(productId, productDef.description, currentSpecMeta);
    const name = inferProductName(productId, currentSpecMeta);
    const readmeRelPath = fs.existsSync(path.join(projectRoot, 'README.md')) ? 'README.md' : null;

    const entityDoc = {
      schemaVersion: ENTITY_SCHEMA_VERSION,
      generatedAt,
      id: productId,
      name,
      kind,
      description: productDef.description ?? '[待补充]',
      owner: {
        value: DEFAULT_OWNER,
        source: 'unknown',
      },
      lifecycle: {
        value: lifecycle.value,
        source: lifecycle.source,
      },
      repo: {
        path: '.',
        remote: repoMeta.remote ?? null,
        defaultBranch: repoMeta.defaultBranch ?? null,
        packageName: repoMeta.packageName ?? null,
      },
      docs: compactArray([
        {
          id: 'current-spec',
          kind: 'fact',
          path: currentSpecRelPath,
          available: Boolean(currentSpecMeta),
        },
        readmeRelPath
          ? {
              id: 'readme',
              kind: 'readme',
              path: readmeRelPath,
              available: true,
            }
          : null,
      ]),
      quality: {
        currentSpec: {
          version: currentSpecMeta?.version ?? null,
          lastAggregated: currentSpecMeta?.lastAggregated ?? null,
          status: currentSpecMeta?.statusRaw ?? DEFAULT_LIFECYCLE,
        },
        report: {
          path: qualityReportInfo.path,
          status: qualityReportInfo.status,
        },
      },
      workflowRefs: inferWorkflowRefs(productId),
      sourceRefs: compactArray([
        {
          kind: 'product-mapping',
          path: toPosix(path.relative(projectRoot, mappingPath)),
        },
        {
          kind: 'current-spec',
          path: currentSpecRelPath,
          available: Boolean(currentSpecMeta),
        },
        readmeRelPath
          ? {
              kind: 'readme',
              path: readmeRelPath,
            }
          : null,
        qualityReportInfo.path
          ? {
              kind: 'quality-report',
              path: qualityReportInfo.path,
            }
          : null,
      ]),
    };

    fs.mkdirSync(path.dirname(entityPath), { recursive: true });
    fs.writeFileSync(entityPath, stringifyYaml(entityDoc), 'utf-8');

    entities.push({
      id: productId,
      name,
      kind,
      lifecycle: lifecycle.value,
      owner: DEFAULT_OWNER,
      entityPath: entityRelPath,
      currentSpecPath: currentSpecRelPath,
      workflowRefCount: entityDoc.workflowRefs.length,
      qualityStatus: qualityReportInfo.status,
      specCount: productDef.specs.length,
    });
  }

  const catalogIndex = {
    schemaVersion: ENTITY_SCHEMA_VERSION,
    generatedAt,
    productCount: entities.length,
    products: entities,
  };

  const catalogIndexPath = path.join(productsRoot, 'catalog-index.yaml');
  fs.writeFileSync(catalogIndexPath, stringifyYaml(catalogIndex), 'utf-8');

  return {
    projectRoot,
    generatedAt,
    catalogIndexPath: toPosix(path.relative(projectRoot, catalogIndexPath)),
    entities,
    warnings,
  };
}

function compactArray(items) {
  return items.filter(Boolean);
}

function parseProductMapping(content) {
  const products = {};
  let currentProductId = null;
  let currentSpec = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '    ');
    const productMatch = /^  ([^:\s]+):\s*$/.exec(line);
    if (productMatch) {
      currentProductId = productMatch[1];
      products[currentProductId] = { description: '', specs: [] };
      currentSpec = null;
      continue;
    }

    if (!currentProductId) {
      continue;
    }

    const descriptionMatch = /^    description:\s*(.+)\s*$/.exec(line);
    if (descriptionMatch) {
      products[currentProductId].description = parseYamlScalar(descriptionMatch[1]);
      continue;
    }

    const specIdMatch = /^      - id:\s*(.+)\s*$/.exec(line);
    if (specIdMatch) {
      currentSpec = {
        id: parseYamlScalar(specIdMatch[1]),
        type: '',
        summary: '',
      };
      products[currentProductId].specs.push(currentSpec);
      continue;
    }

    if (!currentSpec) {
      continue;
    }

    const typeMatch = /^        type:\s*(.+)\s*$/.exec(line);
    if (typeMatch) {
      currentSpec.type = parseYamlScalar(typeMatch[1]);
      continue;
    }

    const summaryMatch = /^        summary:\s*(.+)\s*$/.exec(line);
    if (summaryMatch) {
      currentSpec.summary = parseYamlScalar(summaryMatch[1]);
    }
  }

  return { products };
}

function parseYamlScalar(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === 'null') {
    return null;
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  return trimmed;
}

function parseCurrentSpec(content) {
  return {
    title: matchMarkdownHeading(content),
    product: matchMeta(content, '产品'),
    version: matchMeta(content, '版本'),
    lastAggregated: matchMeta(content, '最后聚合'),
    statusRaw: matchMeta(content, '状态'),
    overview: extractSectionParagraph(content, '1. 产品概述'),
  };
}

function matchMarkdownHeading(content) {
  const match = /^#\s+(.+?)\s*$/m.exec(content);
  return match ? match[1].trim() : null;
}

function matchMeta(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^> \\*\\*${escaped}\\*\\*: (.+)$`, 'm').exec(content);
  return match ? match[1].trim() : null;
}

function extractSectionParagraph(content, headingTitle) {
  const escaped = headingTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|\\Z)`, 'm').exec(content);
  if (!match) {
    return null;
  }

  const lines = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const paragraph = [];
  for (const line of lines) {
    if (line.startsWith('|') || /^\d+\./.test(line) || line.startsWith('- ')) {
      break;
    }
    paragraph.push(line);
  }

  return paragraph.length > 0 ? paragraph.join(' ') : lines[0];
}

function inferProductName(productId, currentSpecMeta) {
  if (currentSpecMeta?.title) {
    return currentSpecMeta.title.replace(/\s+—\s+产品规范活文档$/, '').trim();
  }

  if (currentSpecMeta?.product) {
    return slugToTitle(currentSpecMeta.product);
  }

  return slugToTitle(productId);
}

function inferKind(productId, description, currentSpecMeta) {
  const corpus = `${productId} ${description ?? ''} ${currentSpecMeta?.overview ?? ''}`.toLowerCase();

  if (productId === 'spec-driver' || corpus.includes('编排器 plugin')) {
    return 'plugin';
  }

  if (productId === 'reverse-spec' || corpus.includes('mcp') || corpus.includes('cli') || corpus.includes('tool')) {
    return 'library-tooling';
  }

  return DEFAULT_KIND;
}

function inferLifecycle(rawStatus) {
  if (!rawStatus) {
    return {
      value: DEFAULT_LIFECYCLE,
      source: 'unknown',
    };
  }

  const normalized = rawStatus.toLowerCase();
  if (normalized.includes('活跃') || normalized.includes('active')) {
    return {
      value: 'active',
      source: 'inferred:current-spec.status',
    };
  }

  if (normalized.includes('草稿') || normalized.includes('draft')) {
    return {
      value: 'draft',
      source: 'inferred:current-spec.status',
    };
  }

  if (normalized.includes('废弃') || normalized.includes('deprecated') || normalized.includes('archive')) {
    return {
      value: 'deprecated',
      source: 'inferred:current-spec.status',
    };
  }

  return {
    value: DEFAULT_LIFECYCLE,
    source: 'unknown',
  };
}

function inferWorkflowRefs(productId) {
  if (productId !== 'spec-driver') {
    return WORKFLOW_REFS_BY_PRODUCT[productId] ? [...WORKFLOW_REFS_BY_PRODUCT[productId]] : [];
  }

  const workflowDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'workflows');
  if (!fs.existsSync(workflowDir)) {
    return [...WORKFLOW_REFS_BY_PRODUCT['spec-driver']];
  }

  const refs = fs.readdirSync(workflowDir)
    .filter((fileName) => fileName.endsWith('.yaml') && fileName !== 'golden-paths.yaml')
    .map((fileName) => path.basename(fileName, '.yaml'))
    .sort((left, right) => left.localeCompare(right));

  return refs.length > 0 ? refs : [...WORKFLOW_REFS_BY_PRODUCT['spec-driver']];
}

function detectRepoMetadata(projectRoot) {
  let remote = null;
  let defaultBranch = null;

  try {
    remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    remote = null;
  }

  try {
    defaultBranch = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split('/').pop() || null;
  } catch {
    defaultBranch = null;
  }

  let packageName = null;
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      packageName = typeof packageJson.name === 'string' ? packageJson.name : null;
    } catch {
      packageName = null;
    }
  }

  return {
    remote,
    defaultBranch,
    packageName,
  };
}

function detectQualityReport(projectRoot, productId) {
  const candidates = [
    path.join(projectRoot, 'specs', 'products', productId, 'quality-report.json'),
    path.join(projectRoot, 'specs', 'quality-report.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      return {
        path: toPosix(path.relative(projectRoot, candidate)),
        status: typeof payload.status === 'string' ? payload.status : 'available',
      };
    } catch {
      return {
        path: toPosix(path.relative(projectRoot, candidate)),
        status: 'available',
      };
    }
  }

  return {
    path: null,
    status: 'unavailable',
  };
}

function slugToTitle(value) {
  return value
    .split('-')
    .map((segment) => segment ? segment[0].toUpperCase() + segment.slice(1) : segment)
    .join(' ');
}

function stringifyYaml(value, indent = 0) {
  if (value === null) {
    return `${' '.repeat(indent)}null`;
  }

  if (typeof value === 'string') {
    return `${' '.repeat(indent)}${JSON.stringify(value)}`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${' '.repeat(indent)}${String(value)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${' '.repeat(indent)}[]`;
    }

    return value
      .map((entry) => {
        if (isScalar(entry)) {
          return `${' '.repeat(indent)}- ${stringifyYaml(entry).trimStart()}`;
        }

        const rendered = stringifyYaml(entry, indent + 2).split('\n');
        return [`${' '.repeat(indent)}- ${rendered[0].trimStart()}`, ...rendered.slice(1)].join('\n');
      })
      .join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${' '.repeat(indent)}{}`;
    }

    return entries
      .map(([key, entry]) => {
        if (isScalar(entry)) {
          return `${' '.repeat(indent)}${key}: ${stringifyYaml(entry).trimStart()}`;
        }

        return `${' '.repeat(indent)}${key}:\n${stringifyYaml(entry, indent + 2)}`;
      })
      .join('\n');
  }

  return `${' '.repeat(indent)}${JSON.stringify(String(value))}`;
}

function isScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      'Spec Driver Product Entity Catalog',
      `项目根目录: ${result.projectRoot}`,
      `Catalog 索引: ${result.catalogIndexPath}`,
      `产品数: ${result.entities.length}`,
      ...result.entities.map((entity) => `- ${entity.id}: ${entity.entityPath} (${entity.kind}, workflows=${entity.workflowRefCount})`),
      ...(result.warnings.length > 0 ? ['Warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
    ].join('\n') + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateProductEntityCatalog(args);
  printResult(result, args.json);
}
