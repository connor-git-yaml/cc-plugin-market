#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  getLegacyProductAdoptionReportJsonPath,
  getLegacyProductAdoptionReportMarkdownPath,
  getLegacyProductEntityPath,
  getLegacyProductQualityReportJsonPath,
  getLegacyProductQualityReportMarkdownPath,
  getLegacyProductScorecardReportJsonPath,
  getLegacyProductScorecardReportMarkdownPath,
  getLegacyProductWorkflowIndexJsonPath,
  getProductAdoptionReportJsonPath,
  getProductAdoptionReportMarkdownPath,
  getProductCurrentSpecPath,
  getProductEntityPath,
  getProductQualityReportJsonPath,
  getProductQualityReportMarkdownPath,
  getProductScorecardReportJsonPath,
  getProductScorecardReportMarkdownPath,
  getProductWorkflowIndexJsonPath,
  getProductsRoot,
  toRelativePosix,
} from './lib/product-artifact-paths.mjs';
import {
  getProjectContextMarkdownPath,
  getProjectContextSuggestionsMarkdownPath,
  getProjectContextSuggestionsYamlPath,
  getProjectContextYamlPath,
} from './lib/project-context-paths.mjs';
import { appendWarningsSection, dedupeStringValues } from './lib/script-diagnostics.mjs';
import { readJsonArtifact, writeMarkdownArtifact, writeYamlArtifact } from './lib/script-report-io.mjs';

const SCHEMA_VERSION = 1;

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

export function generateProjectContextSuggestions(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const generatedAt = new Date().toISOString();
  const contextSource = detectContextSource(projectRoot);
  const products = discoverProducts(projectRoot).map((productId) => loadProductSignals(projectRoot, productId));
  const specDriverSignals = products.find((product) => product.id === 'spec-driver') ?? null;
  const suggestions = [];

  const contextSourceSuggestion = buildContextSourceSuggestion(projectRoot, contextSource, products);
  if (contextSourceSuggestion) {
    suggestions.push(contextSourceSuggestion);
  }

  const referencesSuggestion = buildStableReferencesSuggestion(projectRoot, contextSource, products);
  if (referencesSuggestion) {
    suggestions.push(referencesSuggestion);
  }

  const workflowSuggestion = buildWorkflowPreferenceSuggestion(projectRoot, contextSource, specDriverSignals);
  if (workflowSuggestion) {
    suggestions.push(workflowSuggestion);
  }

  const verificationSuggestion = buildVerificationPolicySuggestion(projectRoot, contextSource, specDriverSignals);
  if (verificationSuggestion) {
    suggestions.push(verificationSuggestion);
  }

  const ownershipSuggestion = buildOwnershipSuggestion(projectRoot, products);
  if (ownershipSuggestion) {
    suggestions.push(ownershipSuggestion);
  }

  const riskyPathsSuggestion = buildRiskyPathsSuggestion(projectRoot, products);
  if (riskyPathsSuggestion) {
    suggestions.push(riskyPathsSuggestion);
  }

  const summary = {
    criticalCount: suggestions.filter((suggestion) => suggestion.priority === 'critical').length,
    recommendedCount: suggestions.filter((suggestion) => suggestion.priority === 'recommended').length,
    optionalCount: suggestions.filter((suggestion) => suggestion.priority === 'optional').length,
    suggestionCount: suggestions.length,
  };

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    status: determineReportStatus(summary),
    contextSource: {
      ...contextSource,
      yamlPath: toRelativePosix(projectRoot, contextSource.yamlPath),
      markdownPath: toRelativePosix(projectRoot, contextSource.markdownPath),
      suggestionsYamlPath: toRelativePosix(projectRoot, getProjectContextSuggestionsYamlPath(projectRoot)),
      suggestionsMarkdownPath: toRelativePosix(projectRoot, getProjectContextSuggestionsMarkdownPath(projectRoot)),
    },
    summary,
    suggestions,
    warnings: contextSource.warnings,
  };

  const yamlPath = getProjectContextSuggestionsYamlPath(projectRoot);
  const markdownPath = getProjectContextSuggestionsMarkdownPath(projectRoot);
  writeYamlArtifact(yamlPath, report);
  writeMarkdownArtifact(markdownPath, renderMarkdown(report));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    status: report.status,
    yamlPath: toRelativePosix(projectRoot, yamlPath),
    markdownPath: toRelativePosix(projectRoot, markdownPath),
    suggestionCount: summary.suggestionCount,
    criticalCount: summary.criticalCount,
    recommendedCount: summary.recommendedCount,
    optionalCount: summary.optionalCount,
    warnings: report.warnings,
  };
}

function detectContextSource(projectRoot) {
  const yamlPath = getProjectContextYamlPath(projectRoot);
  const markdownPath = getProjectContextMarkdownPath(projectRoot);
  const yamlExists = fs.existsSync(yamlPath);
  const markdownExists = fs.existsSync(markdownPath);
  const warnings = [];
  let state = 'missing';

  if (yamlExists && markdownExists) {
    state = 'dual';
    warnings.push('同时检测到 .specify/project-context.yaml 与 .specify/project-context.md；建议仅保留 YAML 作为 canonical source。');
  } else if (yamlExists) {
    state = 'yaml';
  } else if (markdownExists) {
    state = 'legacy-md';
    warnings.push('仅检测到 legacy markdown project-context；建议迁移到 .specify/project-context.yaml。');
  }

  return {
    state,
    yamlPath,
    markdownPath,
    warnings,
  };
}

function discoverProducts(projectRoot) {
  const productsRoot = getProductsRoot(projectRoot);
  if (!fs.existsSync(productsRoot)) {
    return [];
  }

  return fs.readdirSync(productsRoot)
    .filter((entry) => !entry.startsWith('.') && entry !== '_generated')
    .filter((entry) => fs.statSync(path.join(productsRoot, entry)).isDirectory())
    .sort((left, right) => left.localeCompare(right));
}

function loadProductSignals(projectRoot, productId) {
  const currentSpecPath = getProductCurrentSpecPath(projectRoot, productId);
  const qualityJsonPath = firstExistingPath(
    getProductQualityReportJsonPath(projectRoot, productId),
    getLegacyProductQualityReportJsonPath(projectRoot, productId),
  );
  const qualityMarkdownPath = firstExistingPath(
    getProductQualityReportMarkdownPath(projectRoot, productId),
    getLegacyProductQualityReportMarkdownPath(projectRoot, productId),
  );
  const scorecardJsonPath = firstExistingPath(
    getProductScorecardReportJsonPath(projectRoot, productId),
    getLegacyProductScorecardReportJsonPath(projectRoot, productId),
  );
  const scorecardMarkdownPath = firstExistingPath(
    getProductScorecardReportMarkdownPath(projectRoot, productId),
    getLegacyProductScorecardReportMarkdownPath(projectRoot, productId),
  );
  const adoptionJsonPath = firstExistingPath(
    getProductAdoptionReportJsonPath(projectRoot, productId),
    getLegacyProductAdoptionReportJsonPath(projectRoot, productId),
  );
  const adoptionMarkdownPath = firstExistingPath(
    getProductAdoptionReportMarkdownPath(projectRoot, productId),
    getLegacyProductAdoptionReportMarkdownPath(projectRoot, productId),
  );
  const workflowIndexJsonPath = firstExistingPath(
    getProductWorkflowIndexJsonPath(projectRoot, productId),
    getLegacyProductWorkflowIndexJsonPath(projectRoot, productId),
  );
  const entityPath = firstExistingPath(
    getProductEntityPath(projectRoot, productId),
    getLegacyProductEntityPath(projectRoot, productId),
  );
  const entityRaw = entityPath ? fs.readFileSync(entityPath, 'utf-8') : '';

  return {
    id: productId,
    currentSpecPath: fs.existsSync(currentSpecPath) ? currentSpecPath : null,
    qualityJsonPath,
    qualityMarkdownPath,
    scorecardJsonPath,
    scorecardMarkdownPath,
    adoptionJsonPath,
    adoptionMarkdownPath,
    workflowIndexJsonPath,
    entityPath,
    ownerUnknown: /owner:\s*\n\s+value:\s+"unknown"/.test(entityRaw),
    quality: qualityJsonPath ? readJsonArtifact(qualityJsonPath) : null,
    scorecard: scorecardJsonPath ? readJsonArtifact(scorecardJsonPath) : null,
    adoption: adoptionJsonPath ? readJsonArtifact(adoptionJsonPath) : null,
    workflowIndex: workflowIndexJsonPath ? readJsonArtifact(workflowIndexJsonPath) : null,
  };
}

function buildContextSourceSuggestion(projectRoot, contextSource, products) {
  const referencePaths = collectStableReferencePaths(projectRoot, products).slice(0, 6);

  if (contextSource.state === 'yaml') {
    return null;
  }

  if (contextSource.state === 'dual') {
    return {
      id: 'dedupe-project-context-sources',
      priority: 'critical',
      category: 'context-source',
      title: '收敛 Project Context 为单一 YAML 来源',
      summary: '当前仓库同时存在 YAML 与 Markdown 两份 Project Context 来源，后续运行时解析会产生歧义。',
      suggestedChanges: [
        {
          field: 'project_context.source',
          action: 'keep',
          value: toRelativePosix(projectRoot, contextSource.yamlPath),
        },
        {
          field: 'project_context.legacy_markdown',
          action: 'remove',
          value: toRelativePosix(projectRoot, contextSource.markdownPath),
        },
      ],
      evidence: [
        evidence(projectRoot, contextSource.yamlPath, 'file-check', '已检测到 canonical YAML。'),
        evidence(projectRoot, contextSource.markdownPath, 'file-check', 'legacy markdown 仍然存在，会制造双源冲突。'),
      ],
    };
  }

  if (contextSource.state === 'legacy-md') {
    return {
      id: 'migrate-project-context-to-yaml',
      priority: 'recommended',
      category: 'context-source',
      title: '迁移 Project Context 到 canonical YAML',
      summary: '当前仅存在 legacy markdown 版本，建议迁移到 `.specify/project-context.yaml` 以承接后续 suggestions 与 resolver 约束。',
      suggestedChanges: [
        {
          field: 'project_context.source',
          action: 'create',
          value: toRelativePosix(projectRoot, contextSource.yamlPath),
        },
        {
          field: 'references.paths',
          action: 'seed',
          value: referencePaths,
        },
      ],
      evidence: [
        evidence(projectRoot, contextSource.markdownPath, 'file-check', '仅检测到 markdown 版本 project-context。'),
      ],
    };
  }

  return {
    id: 'create-project-context-yaml',
    priority: 'recommended',
    category: 'context-source',
    title: '建立 canonical Project Context YAML',
    summary: '当前仓库尚未声明 `.specify/project-context.yaml`，建议建立项目级长期偏好与参考资料的单一入口。',
    suggestedChanges: [
      {
        field: 'project_context.source',
        action: 'create',
        value: toRelativePosix(projectRoot, contextSource.yamlPath),
      },
      {
        field: 'references.paths',
        action: 'seed',
        value: referencePaths,
      },
    ],
    evidence: [
      evidence(projectRoot, contextSource.yamlPath, 'file-check', '未检测到 canonical YAML Project Context。'),
    ],
  };
}

function buildStableReferencesSuggestion(projectRoot, contextSource, products) {
  const referencePaths = collectStableReferencePaths(projectRoot, products);
  if (referencePaths.length === 0) {
    return null;
  }

  return {
    id: 'add-stable-reference-documents',
    priority: contextSource.state === 'yaml' ? 'optional' : 'recommended',
    category: 'references',
    title: '把稳定事实文档纳入 Project Context references',
    summary: '建议把产品活文档与治理报告声明进 Project Context，供 feature / implement / sync 等流程显式注入上下文，而不是依赖口头记忆。',
    suggestedChanges: [
      {
        field: 'references.paths',
        action: 'append',
        value: referencePaths,
      },
    ],
    evidence: referencePaths.map((referencePath) => evidence(projectRoot, path.join(projectRoot, referencePath), 'document', '该文档已存在且长期稳定，可作为项目参考资料。')),
  };
}

function buildWorkflowPreferenceSuggestion(projectRoot, contextSource, specDriverSignals) {
  const topWorkflow = specDriverSignals?.adoption?.summary?.topWorkflow;
  const hasImplementWorkflow = Array.isArray(specDriverSignals?.workflowIndex?.workflows)
    && specDriverSignals.workflowIndex.workflows.some((workflow) => workflow?.id === 'spec-driver-implement');

  if (!topWorkflow?.id) {
    return null;
  }

  return {
    id: 'codify-workflow-preferences',
    priority: contextSource.state === 'yaml' ? 'optional' : 'recommended',
    category: 'workflow-preferences',
    title: '把高频 workflow 路由固化到 Project Context',
    summary: '当前运行记录已经形成稳定的 workflow 使用偏好，建议把默认入口与成熟 spec 的专用入口写入 Project Context。',
    suggestedChanges: [
      {
        field: 'workflow_preferences.default_workflow',
        action: 'set',
        value: topWorkflow.id,
      },
      ...(hasImplementWorkflow
        ? [{
            field: 'workflow_preferences.mature_spec_workflow',
            action: 'set',
            value: 'spec-driver-implement',
          }]
        : []),
    ],
    evidence: [
      evidence(projectRoot, specDriverSignals.adoptionJsonPath, 'adoption-report', `最近 run summary 中最常使用的 workflow 是 ${topWorkflow.id}（${topWorkflow.totalRuns} 次）。`),
      ...(hasImplementWorkflow && specDriverSignals.workflowIndexJsonPath
        ? [evidence(projectRoot, specDriverSignals.workflowIndexJsonPath, 'workflow-index', 'workflow registry 已包含成熟 spec 专用入口 spec-driver-implement。')]
        : []),
    ],
  };
}

function buildVerificationPolicySuggestion(projectRoot, contextSource, specDriverSignals) {
  const verificationRule = Array.isArray(specDriverSignals?.scorecard?.rules)
    ? specDriverSignals.scorecard.rules.find((rule) => rule?.id === 'verification-freshness')
    : null;
  const verificationHotspots = Array.isArray(specDriverSignals?.adoption?.friction?.verificationFailureHotspots)
    ? specDriverSignals.adoption.friction.verificationFailureHotspots
    : [];

  if (!verificationRule && verificationHotspots.length === 0 && contextSource.state === 'yaml') {
    return null;
  }

  const isCritical = verificationRule?.status === 'fail' || verificationHotspots.length > 0;
  const isRecommended = verificationRule?.status === 'warn' || contextSource.state !== 'yaml';
  const priority = isCritical ? 'critical' : (isRecommended ? 'recommended' : 'optional');
  const summary = verificationRule?.status === 'pass'
    ? '当前 verification 新鲜度已达标，但仍建议把验证命令、质量审查与实现完成条件固化到 Project Context，降低后续漂移。'
    : '当前 verification 信号存在缺口，建议把验证偏好与最低完成标准显式写入 Project Context。';

  return {
    id: 'codify-verification-policy',
    priority,
    category: 'verification-policy',
    title: '把验证偏好固化到 Project Context',
    summary,
    suggestedChanges: [
      {
        field: 'verification_policy.required_commands',
        action: 'set',
        value: ['npm run lint', 'npm run build', 'feature-scoped tests'],
      },
      {
        field: 'verification_policy.require_quality_review',
        action: 'set',
        value: true,
      },
      {
        field: 'verification_policy.review_dimensions',
        action: 'set',
        value: ['architecture', 'readability', 'maintainability'],
      },
    ],
    evidence: [
      ...(verificationRule && specDriverSignals?.scorecardJsonPath
        ? [evidence(projectRoot, specDriverSignals.scorecardJsonPath, 'scorecard-report', `verification-freshness 当前状态为 ${verificationRule.status}。`)]
        : []),
      ...verificationHotspots.slice(0, 3).map((hotspot) => evidence(
        projectRoot,
        specDriverSignals?.adoptionJsonPath,
        'adoption-report',
        `近期 verification 热点: ${hotspot.failure}（${hotspot.count} 次）。`,
      )),
    ],
  };
}

function buildOwnershipSuggestion(projectRoot, products) {
  const unknownOwners = products.filter((product) => product.ownerUnknown && product.entityPath);
  if (unknownOwners.length === 0) {
    return null;
  }

  return {
    id: 'declare-default-owner-and-reviewers',
    priority: 'recommended',
    category: 'ownership',
    title: '补充默认 owner / reviewers',
    summary: '产品 Catalog 仍存在 owner 未声明的情况，建议在 Project Context 中补充默认 owner 与 reviewers，降低后续审查责任不清的问题。',
    suggestedChanges: [
      {
        field: 'ownership.default_owner',
        action: 'set',
        value: '<team-or-maintainer>',
      },
      {
        field: 'ownership.default_reviewers',
        action: 'set',
        value: ['<maintainer-or-team>'],
      },
    ],
    evidence: unknownOwners.map((product) => evidence(
      projectRoot,
      product.entityPath,
      'entity-catalog',
      `${product.id} 的 entity.yaml 仍显示 owner=unknown。`,
    )),
  };
}

function buildRiskyPathsSuggestion(projectRoot, products) {
  const conflicts = products.flatMap((product) => (Array.isArray(product.quality?.conflicts) ? product.quality.conflicts : [])
    .map((conflict) => ({ ...conflict, productId: product.id })));
  if (conflicts.length === 0) {
    return null;
  }

  const riskyPaths = dedupeStringValues(conflicts.flatMap((conflict) => (
    Array.isArray(conflict.sources)
      ? conflict.sources.map((source) => source?.path).filter((entry) => typeof entry === 'string')
      : []
  )));
  const priority = conflicts.some((conflict) => conflict.severity === 'high') ? 'critical' : 'recommended';

  return {
    id: 'protect-high-risk-paths',
    priority,
    category: 'constraints',
    title: '把冲突热点目录标记为高风险路径',
    summary: '质量报告已经识别出命名或事实源冲突，建议在 Project Context 中显式标记高风险路径，避免无意修改关键事实文件。',
    suggestedChanges: [
      {
        field: 'constraints.protected_paths',
        action: 'append',
        value: riskyPaths,
      },
    ],
    evidence: conflicts.slice(0, 5).map((conflict) => ({
      sourceType: 'quality-report',
      path: firstConflictPath(projectRoot, conflict.sources),
      note: `${conflict.productId}: ${conflict.topic} / severity=${conflict.severity}`,
    })),
  };
}

function collectStableReferencePaths(projectRoot, products) {
  const paths = [];

  for (const product of products) {
    if (product.currentSpecPath) {
      paths.push(toRelativePosix(projectRoot, product.currentSpecPath));
    }
    if (product.qualityMarkdownPath) {
      paths.push(toRelativePosix(projectRoot, product.qualityMarkdownPath));
    }
    if (product.scorecardMarkdownPath) {
      paths.push(toRelativePosix(projectRoot, product.scorecardMarkdownPath));
    }
    if (product.id === 'spec-driver' && product.adoptionMarkdownPath) {
      paths.push(toRelativePosix(projectRoot, product.adoptionMarkdownPath));
    }
  }

  return dedupeStringValues(paths);
}

function determineReportStatus(summary) {
  if (summary.criticalCount > 0) {
    return 'attention';
  }
  if (summary.suggestionCount > 0) {
    return 'advisory';
  }
  return 'stable';
}

function renderMarkdown(report) {
  const lines = [
    '# Project Context Suggestions',
    '',
    `- Generated At: \`${report.generatedAt}\``,
    `- Status: \`${report.status}\``,
    `- Context Source: \`${report.contextSource.state}\``,
    '',
    '## Summary',
    '',
    `- Critical: ${report.summary.criticalCount}`,
    `- Recommended: ${report.summary.recommendedCount}`,
    `- Optional: ${report.summary.optionalCount}`,
    `- Total Suggestions: ${report.summary.suggestionCount}`,
    '',
    '## Suggestions',
    '',
  ];

  if (report.suggestions.length === 0) {
    lines.push('当前没有新的 Project Context 建议。', '');
  } else {
    for (const suggestion of report.suggestions) {
      lines.push(`### [${suggestion.priority.toUpperCase()}] ${suggestion.title}`, '');
      lines.push(`${suggestion.summary}`, '');
      lines.push(`- ID: \`${suggestion.id}\``);
      lines.push(`- Category: \`${suggestion.category}\``);
      lines.push('', 'Suggested Changes:');
      for (const change of suggestion.suggestedChanges) {
        const renderedValue = renderInlineValue(change.value);
        lines.push(`- \`${change.field}\` · ${change.action}: ${renderedValue}`);
      }
      lines.push('', 'Evidence:');
      for (const entry of suggestion.evidence) {
        lines.push(`- \`${entry.sourceType}\` · \`${entry.path}\` — ${entry.note}`);
      }
      lines.push('');
    }
  }

  appendWarningsSection(lines, report.warnings);

  return `${lines.join('\n')}\n`;
}

function renderInlineValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => `\`${entry}\``).join(', ');
  }
  if (typeof value === 'string') {
    return `\`${value}\``;
  }
  return `\`${JSON.stringify(value)}\``;
}

function evidence(projectRoot, filePath, sourceType, note) {
  return {
    sourceType,
    path: toRelativePosix(projectRoot, filePath),
    note,
  };
}

function firstExistingPath(...candidatePaths) {
  return candidatePaths.find((candidatePath) => candidatePath && fs.existsSync(candidatePath)) ?? null;
}

function firstConflictPath(projectRoot, sources) {
  const firstPath = Array.isArray(sources)
    ? sources.map((source) => source?.path).find((entry) => typeof entry === 'string')
    : null;
  return firstPath ? firstPath : toRelativePosix(projectRoot, getProjectContextSuggestionsYamlPath(projectRoot));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateProjectContextSuggestions({
    projectRoot: args.projectRoot,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `✓ 生成 project-context suggestions: ${result.yamlPath}`,
        `  - markdown: ${result.markdownPath}`,
        `  - suggestions: ${result.suggestionCount} (critical=${result.criticalCount}, recommended=${result.recommendedCount}, optional=${result.optionalCount})`,
      ].join('\n') + '\n',
    );
  }
}
