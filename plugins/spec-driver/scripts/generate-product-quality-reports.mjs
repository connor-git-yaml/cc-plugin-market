#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
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
import { patchProductCatalogIndex, patchYamlArtifact } from './lib/product-artifact-patchers.mjs';
import { appendWarningsSection, dedupeStringValues } from './lib/script-diagnostics.mjs';
import { writeJsonArtifact, writeMarkdownArtifact, writeYamlArtifact } from './lib/script-report-io.mjs';
import { parseYamlDocument } from './lib/simple-yaml.mjs';

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
    writeJsonArtifact(jsonPath, report);
    writeMarkdownArtifact(markdownPath, renderQualityMarkdown(report));
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
  writeYamlArtifact(indexPath, {
    schemaVersion: QUALITY_SCHEMA_VERSION,
    generatedAt,
    productCount: summaries.length,
    products: summaries,
    warnings: dedupeStringValues(warnings),
  });
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
  const lines = [
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
  ];
  appendWarningsSection(lines, report.warnings);
  return lines.join('\n');
}

function patchEntityQuality(entityPath, report, projectRoot, productId) {
  patchYamlArtifact(entityPath, (entity) => {
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
    return entity;
  });
}

function patchCatalogIndex(projectRoot, summaries) {
  const summaryById = new Map(summaries.map((product) => [product.id, product]));
  patchProductCatalogIndex(projectRoot, (product) => {
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
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseProductMapping(content) {
  const document = parseYamlDocument(content);
  const products = isObject(document.products) ? document.products : {};
  return { products };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateProductQualityReports(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`已生成 ${result.products.length} 份产品 quality report\n`);
  }
}
