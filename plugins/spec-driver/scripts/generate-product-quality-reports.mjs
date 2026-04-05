#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  getCatalogIndexPath,
  getLegacyProductAdoptionReportJsonPath,
  getLegacyProductEntityPath,
  getLegacyProductScorecardReportJsonPath,
  getLegacyProductWorkflowIndexJsonPath,
  getProductAdoptionReportJsonPath,
  getProductCurrentSpecPath,
  getProductEntityPath,
  getProductQualityReportJsonPath,
  getProductQualityReportMarkdownPath,
  getProductScorecardReportJsonPath,
  getProductWorkflowIndexJsonPath,
  getProductsRoot,
  getQualityReportIndexPath,
  toRelativePosix,
} from './lib/product-artifact-paths.mjs';

const QUALITY_SCHEMA_VERSION = 1;

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

export function generateProductQualityReports(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const generatedAt = new Date().toISOString();
  const productsRoot = getProductsRoot(projectRoot);
  const mappingPath = path.join(productsRoot, 'product-mapping.yaml');
  if (!fs.existsSync(mappingPath)) {
    throw new Error(`未找到 product mapping: ${mappingPath}`);
  }

  const mapping = parseProductMapping(fs.readFileSync(mappingPath, 'utf-8'));
  const summaries = [];
  const warnings = [];

  for (const [productId] of Object.entries(mapping.products)) {
    const entityPath = fs.existsSync(getProductEntityPath(projectRoot, productId))
      ? getProductEntityPath(projectRoot, productId)
      : getLegacyProductEntityPath(projectRoot, productId);
    const entity = fs.existsSync(entityPath)
      ? parseYamlDocument(fs.readFileSync(entityPath, 'utf-8'))
      : {};
    const productName = entity.name ?? slugToTitle(productId);

    const documentRefs = collectDocumentRefs(projectRoot, productId, entity);
    const provenance = documentRefs.map((doc) => toProvenanceRecord(projectRoot, doc));
    const requiredDocs = documentRefs
      .filter((doc) => doc.required)
      .map((doc) => toRequiredDocStatus(doc));
    const dependencyWarnings = requiredDocs
      .filter((doc) => doc.coverage !== 'covered')
      .map((doc) => `缺少 required doc: ${doc.docId}`);
    const generalWarnings = documentRefs
      .filter((doc) => !doc.required && !doc.available)
      .map((doc) => `可选文档缺失: ${doc.id}`);
    const conflicts = detectProductConflicts({
      entity,
      documentRefs,
    });

    const bundleCoverage = requiredDocs.every((doc) => doc.coverage === 'covered') ? 'full' : 'partial';
    const stats = summarizeDocsQualityStats({
      provenance,
      conflicts,
      requiredDocs,
      dependencyWarnings,
      warnings: generalWarnings,
    });
    const status = determineDocsQualityStatus({
      bundleCoverage,
      conflicts,
      requiredDocs,
      warnings: generalWarnings,
      dependencyWarnings,
    });

    const report = {
      schemaVersion: QUALITY_SCHEMA_VERSION,
      title: `${productName} Product Quality Report`,
      generatedAt,
      projectName: productName,
      productId,
      status,
      bundleCoverage,
      summary: buildSummaryLines({
        provenance,
        conflicts,
        requiredDocs,
        bundleCoverage,
        dependencyWarnings,
        warnings: generalWarnings,
      }),
      provenance,
      conflicts,
      requiredDocs,
      dependencyWarnings,
      warnings: generalWarnings,
      stats,
    };

    const jsonPath = getProductQualityReportJsonPath(projectRoot, productId);
    const markdownPath = getProductQualityReportMarkdownPath(projectRoot, productId);
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
    fs.writeFileSync(markdownPath, renderQualityMarkdown(report), 'utf-8');
    patchEntityQuality(entityPath, report, projectRoot, productId);

    summaries.push({
      id: productId,
      name: productName,
      status,
      score: stats.score,
      reportPath: toPosix(path.relative(projectRoot, jsonPath)),
      markdownPath: toPosix(path.relative(projectRoot, markdownPath)),
    });

    warnings.push(...generalWarnings);
  }

  const indexPath = getQualityReportIndexPath(projectRoot);
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, stringifyYaml({
    schemaVersion: QUALITY_SCHEMA_VERSION,
    generatedAt,
    productCount: summaries.length,
    products: summaries,
    warnings: dedupeStringValues(warnings),
  }), 'utf-8');
  patchCatalogIndex(projectRoot, summaries);

  return {
    projectRoot,
    generatedAt,
    qualityReportIndexPath: toPosix(path.relative(projectRoot, indexPath)),
    products: summaries,
    warnings: dedupeStringValues(warnings),
  };
}

function collectDocumentRefs(projectRoot, productId, entity) {
  const docs = [];
  const seen = new Set();

  const addDoc = (doc) => {
    if (seen.has(doc.id)) {
      return;
    }
    seen.add(doc.id);
    docs.push(doc);
  };

  const entityDocs = Array.isArray(entity.docs) ? entity.docs : [];
  for (const doc of entityDocs) {
    const docId = String(doc.id ?? '').trim();
    if (!docId) {
      continue;
    }
    const docPath = typeof doc.path === 'string'
      ? path.join(projectRoot, doc.path)
      : defaultDocPath(projectRoot, productId, docId);
    addDoc({
      id: docId,
      title: titleForDocId(docId),
      path: docPath,
      sourceType: sourceTypeForDocId(docId),
      required: docId === 'current-spec',
      requiredBy: docId === 'current-spec' ? ['product-governance'] : [],
      includedInBundles: docId === 'current-spec' ? ['governance'] : [],
      notes: [],
      available: fs.existsSync(docPath),
    });
  }

  addDoc({
    id: 'entity',
    title: 'Product Entity Catalog',
    path: firstExistingPath(
      getProductEntityPath(projectRoot, productId),
      getLegacyProductEntityPath(projectRoot, productId),
    ),
    sourceType: 'spec',
    required: true,
    requiredBy: ['catalog'],
    includedInBundles: ['governance'],
    notes: [],
    available: fs.existsSync(getProductEntityPath(projectRoot, productId)) || fs.existsSync(getLegacyProductEntityPath(projectRoot, productId)),
  });

  addDoc({
    id: 'scorecard-report',
    title: 'Scorecard Report',
    path: firstExistingPath(
      getProductScorecardReportJsonPath(projectRoot, productId),
      getLegacyProductScorecardReportJsonPath(projectRoot, productId),
    ),
    sourceType: 'generated-doc',
    required: true,
    requiredBy: ['scorecards'],
    includedInBundles: ['governance'],
    notes: [],
    available: fs.existsSync(getProductScorecardReportJsonPath(projectRoot, productId)) || fs.existsSync(getLegacyProductScorecardReportJsonPath(projectRoot, productId)),
  });

  if (productId === 'spec-driver') {
    addDoc({
      id: 'workflow-index',
      title: 'Workflow Registry Index',
      path: firstExistingPath(
        getProductWorkflowIndexJsonPath(projectRoot, 'spec-driver'),
        getLegacyProductWorkflowIndexJsonPath(projectRoot, 'spec-driver'),
      ),
      sourceType: 'generated-doc',
      required: true,
      requiredBy: ['workflow-registry'],
      includedInBundles: ['governance'],
      notes: [],
      available: fs.existsSync(getProductWorkflowIndexJsonPath(projectRoot, 'spec-driver')) || fs.existsSync(getLegacyProductWorkflowIndexJsonPath(projectRoot, 'spec-driver')),
    });
    addDoc({
      id: 'adoption-report',
      title: 'Adoption Report',
      path: firstExistingPath(
        getProductAdoptionReportJsonPath(projectRoot, 'spec-driver'),
        getLegacyProductAdoptionReportJsonPath(projectRoot, 'spec-driver'),
      ),
      sourceType: 'generated-doc',
      required: true,
      requiredBy: ['adoption-feedback'],
      includedInBundles: ['governance'],
      notes: [],
      available: fs.existsSync(getProductAdoptionReportJsonPath(projectRoot, 'spec-driver')) || fs.existsSync(getLegacyProductAdoptionReportJsonPath(projectRoot, 'spec-driver')),
    });
  }

  return docs.map((doc) => ({
    ...doc,
    relativePath: toPosix(path.relative(projectRoot, doc.path)),
  }));
}

function defaultDocPath(projectRoot, productId, docId) {
  if (docId === 'current-spec') {
    return getProductCurrentSpecPath(projectRoot, productId);
  }
  if (docId === 'readme') {
    return path.join(projectRoot, 'README.md');
  }
  return path.join(getProductGeneratedRootForDoc(projectRoot, productId), `${docId}.md`);
}

function titleForDocId(docId) {
  switch (docId) {
    case 'current-spec':
      return 'Current Spec';
    case 'readme':
      return 'README';
    case 'entity':
      return 'Product Entity Catalog';
    case 'scorecard-report':
      return 'Scorecard Report';
    case 'workflow-index':
      return 'Workflow Registry Index';
    case 'adoption-report':
      return 'Adoption Report';
    default:
      return slugToTitle(docId);
  }
}

function sourceTypeForDocId(docId) {
  switch (docId) {
    case 'current-spec':
      return 'current-spec';
    case 'readme':
      return 'readme';
    default:
      return 'generated-doc';
  }
}

function toProvenanceRecord(projectRoot, doc) {
  const sections = doc.available
    ? [{
        id: 'document',
        title: 'Document Presence',
        summary: `${doc.id} 已生成并可复用。`,
        coverage: 'high',
        entries: [{
          sourceType: doc.sourceType,
          ref: doc.id,
          path: doc.relativePath,
          note: `generated=${doc.available}`,
          confidence: 'high',
          inferred: false,
        }],
      }]
    : [];
  const available = doc.available;
  return {
    documentId: doc.id,
    title: doc.title,
    sourcePath: available ? doc.relativePath : undefined,
    available,
    coverage: available ? 'high' : 'missing',
    confidence: available ? 'high' : 'low',
    sectionCount: sections.length,
    entryCount: sections.reduce((sum, section) => sum + section.entries.length, 0),
    sourceTypes: available ? [doc.sourceType] : [],
    warnings: available ? [] : [`缺少文档: ${doc.relativePath}`],
    missingReason: available ? undefined : 'not-generated',
    sections,
  };
}

function toRequiredDocStatus(doc) {
  return {
    docId: doc.id,
    title: doc.title,
    required: doc.required,
    present: doc.available,
    presentPath: doc.available ? doc.relativePath : undefined,
    coverage: doc.available ? 'covered' : 'missing',
    requiredBy: doc.requiredBy,
    includedInBundles: doc.includedInBundles,
    missingFromBundles: doc.available ? [] : doc.includedInBundles,
    notes: doc.notes,
  };
}

function detectProductConflicts({ entity, documentRefs }) {
  const conflicts = [];
  const currentSpec = documentRefs.find((doc) => doc.id === 'current-spec');
  const entityDoc = documentRefs.find((doc) => doc.id === 'entity');

  if (entityDoc?.available && currentSpec?.available) {
    const entityName = typeof entity.name === 'string' ? entity.name.trim() : '';
    const currentSpecTitle = readHeading(currentSpec.path);
    if (entityName && currentSpecTitle && !normalizeForCompare(currentSpecTitle).includes(normalizeForCompare(entityName))) {
      conflicts.push({
        topic: 'product-positioning',
        severity: 'medium',
        summary: 'entity.yaml 与 current-spec 标题不一致，产品命名存在漂移。',
        sources: [
          {
            sourceType: 'spec',
            label: 'entity.name',
            canonicalValue: entityName,
            path: entityDoc.relativePath,
          },
          {
            sourceType: 'current-spec',
            label: 'current-spec.h1',
            canonicalValue: currentSpecTitle,
            path: currentSpec.relativePath,
          },
        ],
      });
    }
  }

  return conflicts;
}

function readHeading(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const heading = lines.find((line) => line.trim().startsWith('# '));
  return heading ? heading.replace(/^#\s+/, '').trim() : '';
}

function normalizeForCompare(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function summarizeDocsQualityStats(input) {
  const totalProvenanceDocs = input.provenance.length;
  const availableProvenanceDocs = input.provenance.filter((record) => record.available).length;
  const highCoverageDocs = input.provenance.filter((record) => record.coverage === 'high').length;
  const lowCoverageDocs = input.provenance.filter((record) => record.coverage === 'low').length;
  const highSeverityConflicts = input.conflicts.filter((conflict) => conflict.severity === 'high').length;
  const coveredRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'covered').length;
  const partialRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'partial').length;
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;
  const score = clampScore(
    100
      - (highSeverityConflicts * 20)
      - (input.conflicts.filter((conflict) => conflict.severity === 'medium').length * 10)
      - (input.conflicts.filter((conflict) => conflict.severity === 'low').length * 5)
      - (missingRequiredDocs * 8)
      - (partialRequiredDocs * 4)
      - (lowCoverageDocs * 3)
      - (input.dependencyWarnings.length * 2),
  );

  return {
    totalProvenanceDocs,
    availableProvenanceDocs,
    highCoverageDocs,
    lowCoverageDocs,
    totalConflicts: input.conflicts.length,
    highSeverityConflicts,
    totalRequiredDocs: input.requiredDocs.length,
    coveredRequiredDocs,
    partialRequiredDocs,
    missingRequiredDocs,
    dependencyWarningCount: input.dependencyWarnings.length,
    warningCount: input.warnings.length,
    score,
  };
}

function determineDocsQualityStatus(input) {
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;
  const hasHighSeverityConflict = input.conflicts.some((conflict) => conflict.severity === 'high');
  if (hasHighSeverityConflict || missingRequiredDocs >= 2) {
    return 'fail';
  }

  if (input.bundleCoverage === 'partial' && input.dependencyWarnings.length > 0) {
    return 'partial';
  }

  if (
    input.conflicts.length > 0 ||
    input.requiredDocs.some((doc) => doc.coverage !== 'covered') ||
    input.warnings.length > 0
  ) {
    return 'warn';
  }

  return 'pass';
}

function buildSummaryLines(input) {
  const availableDocs = input.provenance.filter((record) => record.available).length;
  const highCoverageDocs = input.provenance.filter((record) => record.coverage === 'high').length;
  const coveredRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'covered').length;
  const missingRequiredDocs = input.requiredDocs.filter((doc) => doc.coverage === 'missing').length;

  return [
    `产品治理相关文档可用 ${availableDocs}/${input.provenance.length}，其中高覆盖 ${highCoverageDocs} 份。`,
    input.conflicts.length > 0
      ? `检测到 ${input.conflicts.length} 条显式冲突，最高严重级别为 ${input.conflicts[0].severity}。`
      : '未检测到显式冲突记录。',
    `Required docs 覆盖 ${coveredRequiredDocs}/${input.requiredDocs.length}，缺失 ${missingRequiredDocs} 份。`,
    input.bundleCoverage === 'full'
      ? '治理文档契约完整，质量门可直接消费。'
      : '治理文档契约仍不完整，质量门按 partial 模式降级。',
    ...(input.dependencyWarnings.length > 0 ? [`Dependency warnings: ${input.dependencyWarnings.length} 条。`] : []),
    ...(input.warnings.length > 0 ? [`General warnings: ${input.warnings.length} 条。`] : []),
  ];
}

function renderQualityMarkdown(report) {
  return [
    `# ${report.projectName} Product Quality Report`,
    '',
    `> **Product**: ${report.productId}`,
    `> **Generated**: ${report.generatedAt}`,
    `> **Status**: ${report.status.toUpperCase()}`,
    `> **Score**: ${report.stats.score}`,
    '',
    '## Summary',
    '',
    ...report.summary.map((line) => `- ${line}`),
    '',
    '## Required Docs',
    '',
    '| Doc | Coverage | Present | Required By | Notes |',
    '| --- | --- | --- | --- | --- |',
    ...report.requiredDocs.map((doc) => `| \`${doc.docId}\` | \`${doc.coverage}\` | \`${doc.present}\` | ${doc.requiredBy.map((value) => `\`${value}\``).join(', ') || '--'} | ${doc.notes.join(' / ') || '--'} |`),
    '',
    '## Conflict Records',
    '',
    ...(report.conflicts.length > 0
      ? report.conflicts.flatMap((conflict) => [
          `### ${conflict.topic} / severity=\`${conflict.severity}\``,
          '',
          conflict.summary,
          '',
          ...conflict.sources.map((source) => `- \`${source.sourceType}\` / ${source.label} / \`${source.canonicalValue}\`${source.path ? ` @ \`${source.path}\`` : ''}`),
          '',
        ])
      : ['- 未检测到显式 conflict record。', '']),
  ].join('\n');
}

function patchEntityQuality(entityPath, report, projectRoot, productId) {
  if (!fs.existsSync(entityPath)) {
    return;
  }
  const entity = parseYamlDocument(fs.readFileSync(entityPath, 'utf-8'));
  entity.quality = isObject(entity.quality) ? entity.quality : {};
  entity.quality.report = {
    path: toRelativePosix(projectRoot, getProductQualityReportJsonPath(projectRoot, productId)),
    status: report.status,
    score: report.stats.score,
    generatedAt: report.generatedAt,
  };
  const sourceRefs = Array.isArray(entity.sourceRefs) ? entity.sourceRefs : [];
  if (!sourceRefs.some((source) => source.kind === 'quality-report')) {
    sourceRefs.push({
      kind: 'quality-report',
      path: toRelativePosix(projectRoot, getProductQualityReportJsonPath(projectRoot, productId)),
    });
  }
  entity.sourceRefs = sourceRefs;
  fs.writeFileSync(entityPath, stringifyYaml(entity), 'utf-8');
}

function patchCatalogIndex(projectRoot, summaries) {
  const catalogIndexPath = getCatalogIndexPath(projectRoot);
  if (!fs.existsSync(catalogIndexPath)) {
    return;
  }
  const catalog = parseYamlDocument(fs.readFileSync(catalogIndexPath, 'utf-8'));
  if (!Array.isArray(catalog.products)) {
    return;
  }
  const summaryById = new Map(summaries.map((product) => [product.id, product]));
  catalog.products = catalog.products.map((product) => {
    const summary = summaryById.get(product.id);
    if (!summary) {
      return product;
    }
    return {
      ...product,
      qualityStatus: summary.status,
      qualityReportPath: summary.reportPath,
    };
  });
  fs.writeFileSync(catalogIndexPath, stringifyYaml(catalog), 'utf-8');
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseProductMapping(content) {
  const document = parseYamlDocument(content);
  const products = isObject(document.products) ? document.products : {};
  return { products };
}

function dedupeStringValues(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function slugToTitle(value) {
  return String(value)
    .split('-')
    .map((segment) => segment ? segment[0].toUpperCase() + segment.slice(1) : segment)
    .join(' ');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function getProductGeneratedRootForDoc(projectRoot, productId) {
  return path.dirname(getProductQualityReportMarkdownPath(projectRoot, productId));
}

function firstExistingPath(preferredPath, legacyPath) {
  if (preferredPath && fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  return legacyPath ?? preferredPath;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

  const line = lines[state.index];
  if (line.text.startsWith('- ')) {
    return parseYamlArray(lines, state, indent);
  }
  return parseYamlObject(lines, state, indent);
}

function parseYamlObject(lines, state, indent) {
  const result = {};

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent || line.text.startsWith('- ')) {
      break;
    }
    if (line.indent > indent) {
      state.index += 1;
      continue;
    }

    const separator = line.text.indexOf(':');
    if (separator === -1) {
      state.index += 1;
      continue;
    }

    const key = line.text.slice(0, separator).trim();
    const remainder = line.text.slice(separator + 1).trim();
    state.index += 1;

    if (remainder === '') {
      if (state.index >= lines.length || lines[state.index].indent <= indent) {
        result[key] = {};
        continue;
      }
      result[key] = parseYamlBlock(lines, state, lines[state.index].indent);
      continue;
    }

    result[key] = parseYamlScalar(remainder);
  }

  return result;
}

function parseYamlArray(lines, state, indent) {
  const result = [];

  while (state.index < lines.length) {
    const line = lines[state.index];
    if (line.indent < indent || !line.text.startsWith('- ')) {
      break;
    }

    const itemText = line.text.slice(2).trim();
    state.index += 1;

    if (itemText === '') {
      if (state.index >= lines.length || lines[state.index].indent <= indent) {
        result.push(null);
        continue;
      }
      result.push(parseYamlBlock(lines, state, lines[state.index].indent));
      continue;
    }

    const separator = itemText.indexOf(':');
    if (separator !== -1) {
      const key = itemText.slice(0, separator).trim();
      const remainder = itemText.slice(separator + 1).trim();
      const item = {};
      if (remainder === '') {
        if (state.index >= lines.length || lines[state.index].indent <= indent) {
          item[key] = {};
        } else {
          item[key] = parseYamlBlock(lines, state, lines[state.index].indent);
        }
      } else {
        item[key] = parseYamlScalar(remainder);
      }

      while (state.index < lines.length) {
        const next = lines[state.index];
        if (next.indent < indent + 2 || next.text.startsWith('- ')) {
          break;
        }
        if (next.indent > indent + 2) {
          state.index += 1;
          continue;
        }
        const nestedSeparator = next.text.indexOf(':');
        if (nestedSeparator === -1) {
          state.index += 1;
          continue;
        }
        const nestedKey = next.text.slice(0, nestedSeparator).trim();
        const nestedRemainder = next.text.slice(nestedSeparator + 1).trim();
        state.index += 1;
        if (nestedRemainder === '') {
          if (state.index >= lines.length || lines[state.index].indent <= next.indent) {
            item[nestedKey] = {};
          } else {
            item[nestedKey] = parseYamlBlock(lines, state, lines[state.index].indent);
          }
        } else {
          item[nestedKey] = parseYamlScalar(nestedRemainder);
        }
      }

      result.push(item);
      continue;
    }

    result.push(parseYamlScalar(itemText));
  }

  return result;
}

function stripYamlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\'' && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === '#' && !inSingle && !inDouble) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function parseYamlScalar(rawValue) {
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  if (rawValue === 'null') {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }
  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith('\'') && rawValue.endsWith('\''))) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function stringifyYaml(value, indent = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]\n';
    }
    return value.map((item) => {
      if (isObject(item) || Array.isArray(item)) {
        const nested = stringifyYaml(item, indent + 2).trimEnd().split('\n');
        const [first, ...rest] = nested;
        return `${' '.repeat(indent)}- ${first}\n${rest.map((line) => `${' '.repeat(indent + 2)}${line}`).join('\n')}`;
      }
      return `${' '.repeat(indent)}- ${formatYamlScalar(item)}`;
    }).join('\n') + '\n';
  }

  if (isObject(value)) {
    return Object.entries(value).map(([key, item]) => {
      if (Array.isArray(item)) {
        if (item.length === 0) {
          return `${' '.repeat(indent)}${key}: []`;
        }
        const serialized = stringifyYaml(item, indent + 2);
        return `${' '.repeat(indent)}${key}:\n${serialized.trimEnd()}`;
      }
      if (isObject(item)) {
        const serialized = stringifyYaml(item, indent + 2);
        return `${' '.repeat(indent)}${key}:\n${serialized.trimEnd()}`;
      }
      return `${' '.repeat(indent)}${key}: ${formatYamlScalar(item)}`;
    }).join('\n') + '\n';
  }

  return `${' '.repeat(indent)}${formatYamlScalar(value)}\n`;
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const stringValue = String(value);
  if (stringValue === '' || /[:#\-\n]/.test(stringValue) || /^\s|\s$/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '\\"')}"`;
  }
  return `"${stringValue.replace(/"/g, '\\"')}"`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateProductQualityReports(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`已生成 ${result.products.length} 份产品 quality report\n`);
  }
}
