#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  getLegacyProductEntityPath,
  getLegacyProductQualityReportJsonPath,
  getLegacyProductScorecardReportJsonPath,
  getLegacyProductWorkflowIndexJsonPath,
  getProductCurrentSpecPath,
  getProductEntityPath,
  getProductQualityReportJsonPath,
  getProductScorecardReportJsonPath,
  getProductScorecardReportMarkdownPath,
  getProductWorkflowIndexJsonPath,
  getProductsRoot,
  getScorecardIndexPath,
  toRelativePosix,
} from './lib/product-artifact-paths.mjs';
import { patchProductCatalogIndex, patchYamlArtifact } from './lib/product-artifact-patchers.mjs';
import { appendWarningsSection, dedupeStringValues, escapeMarkdownTableCell } from './lib/script-diagnostics.mjs';
import { readJsonArtifact, writeJsonArtifact, writeMarkdownArtifact, writeYamlArtifact } from './lib/script-report-io.mjs';
import { parseYamlDocument } from './lib/simple-yaml.mjs';

const SCORECARD_SCHEMA_VERSION = 1;
const VALID_RULE_FIELDS = new Set([
  'title',
  'weight',
  'enabled',
  'appliesTo',
  'thresholds',
]);

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

export function generateProductScorecards(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const generatedAt = new Date().toISOString();
  const productsRoot = getProductsRoot(projectRoot);
  const mappingPath = path.join(productsRoot, 'product-mapping.yaml');
  if (!fs.existsSync(mappingPath)) {
    throw new Error(`未找到 product mapping: ${mappingPath}`);
  }

  const mapping = parseProductMapping(fs.readFileSync(mappingPath, 'utf-8'));
  const ruleset = loadScorecardRules(projectRoot);
  const repoMeta = detectRepoMetadata(projectRoot);
  const branchPolicy = detectBranchPolicy(projectRoot);
  const workflowIndex = readWorkflowIndex(projectRoot);
  const scorecardSummaries = [];
  const warnings = [...ruleset.warnings];

  for (const [productId, productDef] of Object.entries(mapping.products)) {
    const entityPath = fs.existsSync(getProductEntityPath(projectRoot, productId))
      ? getProductEntityPath(projectRoot, productId)
      : getLegacyProductEntityPath(projectRoot, productId);
    const entity = fs.existsSync(entityPath)
      ? parseYamlDocument(fs.readFileSync(entityPath, 'utf-8'))
      : {};
    const currentSpecPath = getProductCurrentSpecPath(projectRoot, productId);
    const qualityReport = readQualityReport(projectRoot, productId, entity);
    const featureInputs = collectFeatureInputs(projectRoot, productDef.specs);
    const productContext = {
      projectRoot,
      productId,
      productDef,
      entity,
      currentSpecPath,
      currentSpecExists: fs.existsSync(currentSpecPath),
      currentSpecStat: safeStat(currentSpecPath),
      qualityReport,
      featureInputs,
      repoMeta,
      branchPolicy,
      workflowIndex,
    };

    const applicableRules = ruleset.rules.filter((rule) => isRuleApplicable(rule, productContext));
    const ruleResults = applicableRules.map((rule) => evaluateRule(rule, productContext));
    const score = calculateOverallScore(ruleResults);
    const status = determineScorecardStatus(ruleResults);
    const summary = buildScorecardSummary(ruleResults, productContext, score, status);
    const report = {
      schemaVersion: SCORECARD_SCHEMA_VERSION,
      generatedAt,
      rulesetId: ruleset.id,
      rulesetTitle: ruleset.title,
      productId,
      productName: productContext.entity.name ?? slugToTitle(productId),
      kind: productContext.entity.kind ?? 'unknown',
      status,
      score,
      summary,
      stats: {
        ruleCount: ruleResults.length,
        passCount: ruleResults.filter((rule) => rule.status === 'pass').length,
        warnCount: ruleResults.filter((rule) => rule.status === 'warn').length,
        failCount: ruleResults.filter((rule) => rule.status === 'fail').length,
        maxWeightedScore: ruleResults.reduce((sum, rule) => sum + rule.weight, 0),
      },
      rules: ruleResults,
      warnings: dedupeStringValues([
        ...warnings,
        ...ruleResults.flatMap((rule) => rule.warnings ?? []),
      ]),
    };

    const jsonPath = getProductScorecardReportJsonPath(projectRoot, productId);
    const markdownPath = getProductScorecardReportMarkdownPath(projectRoot, productId);
    writeJsonArtifact(jsonPath, report);
    writeMarkdownArtifact(markdownPath, renderScorecardMarkdown(report));

    patchEntityScorecard(entityPath, report, projectRoot, productId);

    scorecardSummaries.push({
      id: productId,
      name: report.productName,
      kind: report.kind,
      status: report.status,
      score: report.score,
      reportPath: toPosix(path.relative(projectRoot, jsonPath)),
      markdownPath: toPosix(path.relative(projectRoot, markdownPath)),
      ruleCount: report.stats.ruleCount,
      passCount: report.stats.passCount,
      warnCount: report.stats.warnCount,
      failCount: report.stats.failCount,
    });
  }

  const scorecardIndexPath = getScorecardIndexPath(projectRoot);
  fs.mkdirSync(path.dirname(scorecardIndexPath), { recursive: true });
  const scorecardIndex = {
    schemaVersion: SCORECARD_SCHEMA_VERSION,
    generatedAt,
    rulesetId: ruleset.id,
    productCount: scorecardSummaries.length,
    products: scorecardSummaries,
    warnings: dedupeStringValues(warnings),
  };
  writeYamlArtifact(scorecardIndexPath, scorecardIndex);
  patchCatalogIndex(projectRoot, scorecardSummaries);

  return {
    projectRoot,
    generatedAt,
    rulesetId: ruleset.id,
    scorecardIndexPath: toPosix(path.relative(projectRoot, scorecardIndexPath)),
    products: scorecardSummaries,
    warnings: dedupeStringValues(warnings),
  };
}

function loadScorecardRules(projectRoot) {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const pluginDir = path.dirname(scriptDir);
  const defaultsDir = path.join(pluginDir, 'scorecards');
  const overrideDir = path.join(projectRoot, '.specify', 'scorecards');
  const warnings = [];
  const ruleMap = new Map();
  let rulesetId = 'default-governance';
  let rulesetTitle = '默认持续治理评分';

  for (const filePath of listYamlFiles(defaultsDir)) {
    const doc = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
    const normalized = normalizeRulesDocument(doc, filePath);
    rulesetId = normalized.id ?? rulesetId;
    rulesetTitle = normalized.title ?? rulesetTitle;
    for (const rule of normalized.rules) {
      ruleMap.set(rule.id, rule);
    }
  }

  for (const filePath of listYamlFiles(overrideDir)) {
    const doc = parseYamlDocument(fs.readFileSync(filePath, 'utf-8'));
    const normalized = normalizeRulesDocument(doc, filePath);
    for (const overrideRule of normalized.rules) {
      const existing = ruleMap.get(overrideRule.id);
      if (!existing) {
        ruleMap.set(overrideRule.id, overrideRule);
        continue;
      }

      const merged = mergeRule(existing, overrideRule);
      const ignoredFields = Object.keys(overrideRule).filter((key) => !VALID_RULE_FIELDS.has(key) && key !== 'id' && key !== 'evaluator');
      for (const field of ignoredFields) {
        warnings.push(`scorecard override 忽略非 metadata 字段: ${path.basename(filePath)}.${overrideRule.id}.${field}`);
      }
      ruleMap.set(overrideRule.id, merged);
    }
  }

  return {
    id: rulesetId,
    title: rulesetTitle,
    rules: Array.from(ruleMap.values()).filter((rule) => rule.enabled !== false),
    warnings,
  };
}

function normalizeRulesDocument(doc, filePath) {
  const ruleset = isObject(doc.ruleset) ? doc.ruleset : {};
  const id = typeof ruleset.id === 'string' ? ruleset.id : (typeof doc.id === 'string' ? doc.id : null);
  const title = typeof ruleset.title === 'string' ? ruleset.title : (typeof doc.title === 'string' ? doc.title : null);
  const rules = Array.isArray(doc.rules)
    ? doc.rules
        .filter((rule) => isObject(rule) && typeof rule.id === 'string' && typeof rule.evaluator === 'string')
        .map((rule) => ({
          id: rule.id,
          title: typeof rule.title === 'string' ? rule.title : slugToTitle(rule.id),
          evaluator: rule.evaluator,
          weight: typeof rule.weight === 'number' ? rule.weight : 10,
          enabled: rule.enabled !== false,
          appliesTo: isObject(rule.appliesTo) ? rule.appliesTo : {},
          thresholds: isObject(rule.thresholds) ? rule.thresholds : {},
          sourcePath: toPosix(filePath),
        }))
    : [];

  return { id, title, rules };
}

function mergeRule(base, override) {
  return {
    ...base,
    ...pickDefined(override, ['title', 'weight', 'enabled']),
    appliesTo: {
      ...(isObject(base.appliesTo) ? base.appliesTo : {}),
      ...(isObject(override.appliesTo) ? override.appliesTo : {}),
    },
    thresholds: {
      ...(isObject(base.thresholds) ? base.thresholds : {}),
      ...(isObject(override.thresholds) ? override.thresholds : {}),
    },
  };
}

function pickDefined(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

function isRuleApplicable(rule, productContext) {
  const appliesTo = isObject(rule.appliesTo) ? rule.appliesTo : {};
  const kinds = Array.isArray(appliesTo.kinds) ? appliesTo.kinds : [];
  const productIds = Array.isArray(appliesTo.productIds) ? appliesTo.productIds : [];
  if (kinds.length > 0 && !kinds.includes(productContext.entity.kind)) {
    return false;
  }
  if (productIds.length > 0 && !productIds.includes(productContext.productId)) {
    return false;
  }
  return true;
}

function evaluateRule(rule, productContext) {
  switch (rule.evaluator) {
    case 'spec-freshness':
      return evaluateSpecFreshness(rule, productContext);
    case 'verification-freshness':
      return evaluateVerificationFreshness(rule, productContext);
    case 'docs-coverage':
      return evaluateDocsCoverage(rule, productContext);
    case 'docs-conflicts':
      return evaluateDocsConflicts(rule, productContext);
    case 'branch-hygiene':
      return evaluateBranchHygiene(rule, productContext);
    case 'workflow-readiness':
      return evaluateWorkflowReadiness(rule, productContext);
    default:
      return buildRuleResult(rule, 'warn', 50, [
        `未知 evaluator: ${rule.evaluator}`,
      ], { sourcePath: rule.sourcePath }, [`unknown-evaluator:${rule.evaluator}`]);
  }
}

function evaluateSpecFreshness(rule, productContext) {
  if (!productContext.currentSpecExists || !productContext.currentSpecStat) {
    return buildRuleResult(rule, 'fail', 0, [
      '缺少 current-spec.md，无法证明产品事实已经同步到当前状态。',
    ], { currentSpecPath: relativeProductPath(productContext.currentSpecPath, productContext.projectRoot) });
  }

  const latestSpecTime = maxTime(productContext.featureInputs.map((feature) => feature.specStat?.mtimeMs ?? 0));
  const laggingSpecs = productContext.featureInputs
    .filter((feature) => feature.specStat && feature.specStat.mtimeMs > productContext.currentSpecStat.mtimeMs)
    .map((feature) => feature.id);
  const lagDays = latestSpecTime > 0
    ? Math.max(0, daysBetween(productContext.currentSpecStat.mtimeMs, latestSpecTime))
    : 0;

  if (laggingSpecs.length === 0) {
    return buildRuleResult(rule, 'pass', 100, [
      `current-spec 覆盖了全部 ${productContext.featureInputs.length} 个增量 spec。`,
    ], { laggingSpecs, lagDays });
  }

  const warnLagDays = Number(rule.thresholds?.warnLagDays ?? 7);
  const failLagDays = Number(rule.thresholds?.failLagDays ?? 30);
  const maxLaggingSpecsWarn = Number(rule.thresholds?.maxLaggingSpecsWarn ?? 2);
  if (lagDays <= warnLagDays && laggingSpecs.length <= maxLaggingSpecsWarn) {
    return buildRuleResult(rule, 'warn', 70, [
      `current-spec 落后于 ${laggingSpecs.length} 个增量 spec，最大滞后约 ${lagDays} 天。`,
    ], { laggingSpecs, lagDays });
  }

  const status = lagDays > failLagDays || laggingSpecs.length > maxLaggingSpecsWarn ? 'fail' : 'warn';
  const score = status === 'fail' ? 25 : 60;
  return buildRuleResult(rule, status, score, [
    `current-spec 落后于 ${laggingSpecs.length} 个增量 spec，最大滞后约 ${lagDays} 天。`,
  ], { laggingSpecs, lagDays });
}

function evaluateVerificationFreshness(rule, productContext) {
  const governedFeatures = productContext.featureInputs.filter((feature) => feature.governed);
  const ignored = {
    blueprint: productContext.featureInputs.filter((feature) => feature.artifactType === 'blueprint').map((feature) => feature.id),
    nonImplemented: productContext.featureInputs
      .filter((feature) => feature.artifactType === 'feature' && !feature.governed)
      .map((feature) => feature.id),
  };
  const total = governedFeatures.length;
  if (total === 0) {
    return buildRuleResult(rule, 'warn', 50, [
      '当前没有纳入治理的已实现增量 spec，verification 新鲜度无法计算。',
    ], { totalFeatures: 0, ignored });
  }

  const fresh = [];
  const stale = [];
  const missing = [];
  const failed = [];

  for (const feature of governedFeatures) {
    if (!feature.verificationPath || !feature.verificationStat) {
      missing.push(feature.id);
      continue;
    }

    const verificationStatus = parseVerificationStatus(feature.verificationContent);
    const isFresh = !feature.specStat || feature.verificationStat.mtimeMs >= feature.specStat.mtimeMs;
    if (verificationStatus === 'FAIL') {
      failed.push(feature.id);
      continue;
    }
    if (isFresh) {
      fresh.push(feature.id);
    } else {
      stale.push(feature.id);
    }
  }

  const coverageRatio = fresh.length / total;
  const warnCoverageRatio = Number(rule.thresholds?.warnCoverageRatio ?? 0.8);
  if (fresh.length === total && failed.length === 0) {
    return buildRuleResult(rule, 'pass', 100, [
      `全部 ${total} 个纳入治理的已实现增量 spec 都有新鲜的 verification 报告。`,
    ], { totalFeatures: total, fresh, stale, missing, failed, coverageRatio, ignored });
  }

  if (coverageRatio >= warnCoverageRatio && failed.length === 0) {
    return buildRuleResult(rule, 'warn', Math.round(60 + (coverageRatio * 20)), [
      `verification 覆盖率为 ${formatPercent(coverageRatio)}，仍有 ${missing.length + stale.length} 个已实现增量 spec 未通过新鲜度要求。`,
    ], { totalFeatures: total, fresh, stale, missing, failed, coverageRatio, ignored });
  }

  return buildRuleResult(rule, 'fail', Math.round(coverageRatio * 40), [
    `verification 覆盖率仅 ${formatPercent(coverageRatio)}，缺失 ${missing.length} 个、过期 ${stale.length} 个、失败 ${failed.length} 个已实现增量 spec。`,
  ], { totalFeatures: total, fresh, stale, missing, failed, coverageRatio, ignored });
}

function evaluateDocsCoverage(rule, productContext) {
  const report = productContext.qualityReport;
  if (!report?.payload) {
    return buildRuleResult(rule, 'warn', 50, [
      '缺少 quality-report.json，暂时无法复用文档质量门的 required docs 统计。',
    ], { qualityReportPath: report?.path ?? null });
  }

  const totalRequired = Number(report.payload.stats?.totalRequiredDocs ?? report.payload.requiredDocs?.length ?? 0);
  const covered = Number(report.payload.stats?.coveredRequiredDocs ?? 0);
  const coverageRatio = totalRequired > 0 ? covered / totalRequired : 0;
  const passCoverageRatio = Number(rule.thresholds?.passCoverageRatio ?? 1);
  const warnCoverageRatio = Number(rule.thresholds?.warnCoverageRatio ?? 0.75);

  if (coverageRatio >= passCoverageRatio) {
    return buildRuleResult(rule, 'pass', 100, [
      `Required docs 覆盖 ${covered}/${totalRequired}。`,
    ], { qualityReportPath: report.path, coveredRequiredDocs: covered, totalRequiredDocs: totalRequired, coverageRatio });
  }

  if (coverageRatio >= warnCoverageRatio) {
    return buildRuleResult(rule, 'warn', Math.round(coverageRatio * 100), [
      `Required docs 覆盖 ${covered}/${totalRequired}，仍有缺口需要补齐。`,
    ], { qualityReportPath: report.path, coveredRequiredDocs: covered, totalRequiredDocs: totalRequired, coverageRatio });
  }

  return buildRuleResult(rule, 'fail', Math.round(coverageRatio * 100), [
    `Required docs 覆盖仅 ${covered}/${totalRequired}，文档面仍存在明显缺口。`,
  ], { qualityReportPath: report.path, coveredRequiredDocs: covered, totalRequiredDocs: totalRequired, coverageRatio });
}

function evaluateDocsConflicts(rule, productContext) {
  const report = productContext.qualityReport;
  if (!report?.payload) {
    return buildRuleResult(rule, 'warn', 50, [
      '缺少 quality-report.json，冲突治理暂时只能降级为人工检查。',
    ], { qualityReportPath: report?.path ?? null });
  }

  const conflicts = Array.isArray(report.payload.conflicts) ? report.payload.conflicts : [];
  const high = conflicts.filter((conflict) => conflict.severity === 'high').length;
  const medium = conflicts.filter((conflict) => conflict.severity === 'medium').length;
  const low = conflicts.filter((conflict) => conflict.severity === 'low').length;

  if (high === 0 && medium === 0 && low === 0) {
    return buildRuleResult(rule, 'pass', 100, [
      'quality-report 未检测到显式文档冲突。',
    ], { qualityReportPath: report.path, totalConflicts: 0, high, medium, low });
  }

  if (high > 0) {
    return buildRuleResult(rule, 'fail', Math.max(10, 100 - (high * 35) - (medium * 15) - (low * 8)), [
      `存在 ${high} 条高严重级别冲突，需要先清理事实不一致项。`,
    ], { qualityReportPath: report.path, totalConflicts: conflicts.length, high, medium, low });
  }

  return buildRuleResult(rule, 'warn', Math.max(35, 100 - (medium * 15) - (low * 8)), [
    `存在 ${conflicts.length} 条文档冲突（medium=${medium}, low=${low}）。`,
  ], { qualityReportPath: report.path, totalConflicts: conflicts.length, high, medium, low });
}

function evaluateBranchHygiene(rule, productContext) {
  const checks = {
    hasRemote: Boolean(productContext.repoMeta.remote),
    hasDefaultBranch: Boolean(productContext.repoMeta.defaultBranch),
    hasPolicyFile: productContext.branchPolicy.hasPolicyFile,
    agentsDocumented: productContext.branchPolicy.agentsDocumented,
    claudeDocumented: productContext.branchPolicy.claudeDocumented,
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);

  if (failedChecks.length === 0) {
    return buildRuleResult(rule, 'pass', 100, [
      '默认分支、远端和分支同步约定都已显式声明。',
    ], checks);
  }

  if (checks.hasPolicyFile && (checks.agentsDocumented || checks.claudeDocumented)) {
    return buildRuleResult(rule, 'warn', 70, [
      `分支治理基础存在，但仍缺少 ${failedChecks.join(', ')}。`,
    ], { ...checks, failedChecks });
  }

  return buildRuleResult(rule, 'fail', 20, [
    `分支治理信息不完整，缺少 ${failedChecks.join(', ')}。`,
  ], { ...checks, failedChecks });
}

function evaluateWorkflowReadiness(rule, productContext) {
  const workflowRefs = Array.isArray(productContext.entity.workflowRefs) ? productContext.entity.workflowRefs : [];
  if (productContext.productId === 'spec-driver') {
    const workflowIds = new Set(Array.isArray(productContext.workflowIndex?.workflows)
      ? productContext.workflowIndex.workflows.map((workflow) => workflow.id)
      : []);
    const missing = workflowRefs.filter((ref) => !workflowIds.has(ref));
    const goldenPathCount = Array.isArray(productContext.workflowIndex?.goldenPaths)
      ? productContext.workflowIndex.goldenPaths.length
      : 0;
    if (missing.length === 0 && goldenPathCount > 0) {
      return buildRuleResult(rule, 'pass', 100, [
        `workflow registry 覆盖了全部 ${workflowRefs.length} 个 workflowRefs，并提供 ${goldenPathCount} 条 golden paths。`,
      ], { workflowRefs, missing, goldenPathCount });
    }
    if (missing.length === 0) {
      return buildRuleResult(rule, 'warn', 70, [
        'workflow definitions 存在，但 golden paths 仍不完整。',
      ], { workflowRefs, missing, goldenPathCount });
    }
    return buildRuleResult(rule, 'fail', 25, [
      `workflow registry 缺少 ${missing.length} 个 workflowRefs: ${missing.join(', ')}`,
    ], { workflowRefs, missing, goldenPathCount });
  }

  const currentSpecAvailable = Array.isArray(productContext.entity.docs)
    ? productContext.entity.docs.some((doc) => doc.id === 'current-spec' && doc.available)
    : false;
  if (workflowRefs.length > 0 && currentSpecAvailable) {
    return buildRuleResult(rule, 'pass', 100, [
      `产品公开了 ${workflowRefs.length} 个入口引用，且 current-spec 可作为消费入口。`,
    ], { workflowRefs, currentSpecAvailable });
  }
  if (workflowRefs.length > 0 || currentSpecAvailable) {
    return buildRuleResult(rule, 'warn', 65, [
      '产品已有部分 workflow / 入口事实，但入口与文档绑定还不完整。',
    ], { workflowRefs, currentSpecAvailable });
  }
  return buildRuleResult(rule, 'fail', 20, [
    '产品既缺少 workflowRefs，也缺少 current-spec 入口，消费路径不明确。',
  ], { workflowRefs, currentSpecAvailable });
}

function buildRuleResult(rule, status, score, summary, evidence, warnings = []) {
  return {
    id: rule.id,
    title: rule.title,
    evaluator: rule.evaluator,
    weight: rule.weight,
    status,
    score,
    summary,
    evidence,
    warnings,
  };
}

function calculateOverallScore(ruleResults) {
  const totalWeight = ruleResults.reduce((sum, rule) => sum + rule.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }
  const weighted = ruleResults.reduce((sum, rule) => sum + (rule.score * rule.weight), 0);
  return Math.round(weighted / totalWeight);
}

function determineScorecardStatus(ruleResults) {
  if (ruleResults.some((rule) => rule.status === 'fail')) {
    return 'fail';
  }
  if (ruleResults.some((rule) => rule.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}

function buildScorecardSummary(ruleResults, productContext, score, status) {
  const failCount = ruleResults.filter((rule) => rule.status === 'fail').length;
  const warnCount = ruleResults.filter((rule) => rule.status === 'warn').length;
  return [
    `${productContext.entity.name ?? slugToTitle(productContext.productId)} 当前治理评分为 ${score}/100，整体状态 ${status.toUpperCase()}.`,
    failCount > 0
      ? `存在 ${failCount} 条 fail 级规则，需要优先处理。`
      : '没有 fail 级规则。',
    warnCount > 0
      ? `另有 ${warnCount} 条 warn 级规则，建议在下一次 sync / release 前收口。`
      : '全部规则均已达到 pass 基线。',
  ];
}

function patchEntityScorecard(entityPath, report, projectRoot, productId) {
  patchYamlArtifact(entityPath, (entity) => {
    entity.quality = isObject(entity.quality) ? entity.quality : {};
    entity.quality.scorecard = {
      path: toRelativePosix(projectRoot, getProductScorecardReportJsonPath(projectRoot, productId)),
      status: report.status,
      score: report.score,
      generatedAt: report.generatedAt,
    };
    const sourceRefs = Array.isArray(entity.sourceRefs) ? entity.sourceRefs : [];
    if (!sourceRefs.some((source) => source.kind === 'scorecard-report')) {
      sourceRefs.push({
        kind: 'scorecard-report',
        path: toRelativePosix(projectRoot, getProductScorecardReportJsonPath(projectRoot, productId)),
      });
    }
    entity.sourceRefs = sourceRefs;
    return entity;
  });
}

function patchCatalogIndex(projectRoot, productSummaries) {
  const scorecardById = new Map(productSummaries.map((product) => [product.id, product]));
  patchProductCatalogIndex(projectRoot, (product) => {
    const summary = scorecardById.get(product.id);
    if (!summary) {
      return product;
    }
    return {
      ...product,
      scorecardStatus: summary.status,
      scorecardScore: summary.score,
    };
  });
}

function readWorkflowIndex(projectRoot) {
  const candidates = [
    getProductWorkflowIndexJsonPath(projectRoot, 'spec-driver'),
    getLegacyProductWorkflowIndexJsonPath(projectRoot, 'spec-driver'),
  ];
  for (const indexPath of candidates) {
    const payload = readJsonArtifact(indexPath);
    if (payload) {
      return payload;
    }
  }
  return null;
}

function readQualityReport(projectRoot, productId, entity) {
  const explicitPath = entity?.quality?.report?.path;
  const candidates = [
    explicitPath ? path.join(projectRoot, explicitPath) : null,
    getProductQualityReportJsonPath(projectRoot, productId),
    getLegacyProductQualityReportJsonPath(projectRoot, productId),
    path.join(projectRoot, 'specs', 'quality-report.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const payload = readJsonArtifact(candidate);
      return {
        path: toRelativePosix(projectRoot, candidate),
        payload,
      };
    }
  }

  return null;
}

function collectFeatureInputs(projectRoot, specs) {
  return specs.map((entry) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const featureDir = path.join(projectRoot, 'specs', id);
    const specPath = path.join(featureDir, 'spec.md');
    const blueprintPath = path.join(featureDir, 'blueprint.md');
    const artifactPath = fs.existsSync(specPath)
      ? specPath
      : (fs.existsSync(blueprintPath) ? blueprintPath : null);
    const verificationPath = path.join(featureDir, 'verification', 'verification-report.md');
    const artifactContent = artifactPath ? fs.readFileSync(artifactPath, 'utf-8') : null;
    const artifactType = fs.existsSync(specPath)
      ? 'feature'
      : (fs.existsSync(blueprintPath) ? 'blueprint' : 'missing');
    const status = parseFeatureArtifactStatus(artifactContent);
    const governed = artifactType === 'feature' && /implemented/i.test(status ?? '');
    return {
      id,
      featureDir,
      specPath,
      specStat: safeStat(specPath),
      blueprintPath: fs.existsSync(blueprintPath) ? blueprintPath : null,
      artifactType,
      artifactStatus: status,
      governed,
      verificationPath: fs.existsSync(verificationPath) ? verificationPath : null,
      verificationStat: safeStat(verificationPath),
      verificationContent: fs.existsSync(verificationPath) ? fs.readFileSync(verificationPath, 'utf-8') : null,
    };
  });
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function parseVerificationStatus(content) {
  if (!content) {
    return 'MISSING';
  }
  const match = content.match(/(?:^[-*]\s*Status:|^\*\*状态\*\*:|^\*\*Status\*\*:|^Status:)\s*(PASS|WARN|FAIL|PARTIAL|N\/A)/im);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

function parseFeatureArtifactStatus(content) {
  if (!content) {
    return null;
  }
  const match = content.match(/^\*\*(?:状态|Status)\*\*:\s*(.+)$/im);
  return match ? match[1].trim() : null;
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

  return { remote, defaultBranch };
}

function detectBranchPolicy(projectRoot) {
  const policyFile = path.join(projectRoot, 'docs', 'shared', 'agent-branch-sync-policy.md');
  const agentsFile = path.join(projectRoot, 'AGENTS.md');
  const claudeFile = path.join(projectRoot, 'CLAUDE.md');
  const policyContent = fs.existsSync(policyFile) ? fs.readFileSync(policyFile, 'utf-8') : '';
  const agentsContent = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf-8') : '';
  const claudeContent = fs.existsSync(claudeFile) ? fs.readFileSync(claudeFile, 'utf-8') : '';

  return {
    hasPolicyFile: policyContent.includes('git rebase master'),
    agentsDocumented: agentsContent.includes('BEGIN SHARED SECTION: branch-sync-policy'),
    claudeDocumented: claudeContent.includes('BEGIN SHARED SECTION: branch-sync-policy'),
  };
}

function renderScorecardMarkdown(report) {
  const header = [
    `# ${report.productName} Scorecard Report`,
    '',
    `> **Product**: ${report.productId}`,
    `> **Ruleset**: ${report.rulesetTitle} (${report.rulesetId})`,
    `> **Generated**: ${report.generatedAt}`,
    `> **Status**: ${report.status.toUpperCase()}`,
    `> **Score**: ${report.score}/100`,
    '',
    '## Summary',
    '',
    ...report.summary.map((line) => `- ${line}`),
    '',
    '## Rule Breakdown',
    '',
    '| Rule | Status | Score | Weight | Key Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...report.rules.map((rule) => {
      const evidence = summarizeEvidence(rule.evidence);
      return `| ${rule.title} | ${rule.status.toUpperCase()} | ${rule.score} | ${rule.weight} | ${escapeMarkdownTableCell(evidence)} |`;
    }),
    '',
    '## Rule Details',
    '',
  ];

  const sections = report.rules.flatMap((rule) => ([
    `### ${rule.title}`,
    '',
    `- Evaluator: \`${rule.evaluator}\``,
    `- Status: ${rule.status.toUpperCase()}`,
    `- Score: ${rule.score} / 100`,
    `- Weight: ${rule.weight}`,
    ...rule.summary.map((line) => `- ${line}`),
    '',
    '```json',
    JSON.stringify(rule.evidence, null, 2),
    '```',
    '',
  ]));

  appendWarningsSection(sections, report.warnings);

  return [...header, ...sections].join('\n');
}

function summarizeEvidence(evidence) {
  if (!isObject(evidence)) {
    return '[无]';
  }
  const pairs = Object.entries(evidence)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.length : value}`);
  return pairs.length > 0 ? pairs.join(', ') : '[无]';
}

function relativeProductPath(filePath, projectRoot) {
  return filePath ? toPosix(path.relative(projectRoot, filePath)) : null;
}

function maxTime(values) {
  return values.reduce((max, value) => value > max ? value : max, 0);
}

function daysBetween(older, newer) {
  return Math.round((newer - older) / (1000 * 60 * 60 * 24));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function listYamlFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith('.yaml') || fileName.endsWith('.yml'))
    .map((fileName) => path.join(dirPath, fileName))
    .sort((left, right) => left.localeCompare(right));
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const result = generateProductScorecards({
    projectRoot: args.projectRoot,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `✓ 生成 scorecard index: ${result.scorecardIndexPath}`,
        ...result.products.map((product) => `  - ${product.id}: ${product.markdownPath} (${product.status}, ${product.score}/100)`),
      ].join('\n') + '\n',
    );
  }
}
