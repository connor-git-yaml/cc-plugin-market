import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncSpectraSkillMirrors } from '../../plugins/spectra/scripts/sync-skill-mirrors.mjs';
import { validateSpectraSkillSources } from '../../plugins/spectra/scripts/validate-skill-sources.mjs';
import { validateOrchestrationOverrides } from '../../plugins/spec-driver/scripts/validate-orchestration-overrides.mjs';
import { generateAdoptionInsights } from '../../plugins/spec-driver/scripts/generate-adoption-insights.mjs';
import { generateProductEntityCatalog } from '../../plugins/spec-driver/scripts/generate-product-entity-catalog.mjs';
import { generateProductQualityReports } from '../../plugins/spec-driver/scripts/generate-product-quality-reports.mjs';
import { generateProductScorecards } from '../../plugins/spec-driver/scripts/generate-product-scorecards.mjs';
import { generateProjectContextSuggestions } from '../../plugins/spec-driver/scripts/generate-project-context-suggestions.mjs';
import { validateWrapperSources } from '../../plugins/spec-driver/scripts/validate-wrapper-sources.mjs';
import { validatePreferenceRules, syncPreferenceRules } from '../../plugins/spec-driver/scripts/sync-preference-rules.mjs';
import { syncDelegationContract, validateDelegationContract } from '../../plugins/spec-driver/scripts/sync-delegation-contract.mjs';
import { validateOrchestratorModels } from '../../plugins/spec-driver/scripts/validate-orchestrator-models.mjs';
import { generateWorkflowRegistry } from '../../plugins/spec-driver/scripts/generate-workflow-registry.mjs';
import { syncSharedAgentDocs, validateSharedAgentDocs } from '../sync-agent-docs.mjs';
import { syncReleaseContract, validateReleaseContract } from './release-contract-core.mjs';
import { validateRuntimeBoundaries } from './runtime-boundary-core.mjs';
import { validateNamespaceConsistency } from './namespace-consistency-core.mjs';

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

function namespaceCheck(prefix, check) {
  return {
    ...check,
    id: `${prefix}:${check.id}`,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function relativePath(projectRoot, targetPath) {
  return path.relative(projectRoot, targetPath).split(path.sep).join('/');
}

function runSpecDriverCodexInstall(projectRoot) {
  const scriptPath = path.join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh');
  execFileSync('bash', [scriptPath, 'install'], {
    cwd: projectRoot,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: {
      ...process.env,
      CODEX_SKILL_PROJECT_ROOT: projectRoot,
    },
  });
  return {
    targetRoot: '.codex/skills',
  };
}

function validateMarketplaceAndSettings(projectRoot) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const marketplacePath = path.join(projectRoot, '.claude-plugin', 'marketplace.json');
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');

  if (!fs.existsSync(marketplacePath)) {
    return {
      status: 'fail',
      checks: [
        createCheck('marketplace-manifest', 'Marketplace manifest 存在', 'fail', {
          missing: '.claude-plugin/marketplace.json',
        }),
      ],
      warnings,
      errors: ['缺少 .claude-plugin/marketplace.json'],
    };
  }

  const marketplace = readJson(marketplacePath);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const missingPluginDirs = [];
  const metadataMismatches = [];

  for (const pluginEntry of plugins) {
    const pluginDir = path.join(projectRoot, String(pluginEntry.source ?? '').replace(/^\.\/+/, ''));
    const pluginManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');

    if (!fs.existsSync(pluginDir) || !fs.existsSync(pluginManifestPath)) {
      missingPluginDirs.push({
        name: pluginEntry.name,
        source: pluginEntry.source,
      });
      continue;
    }

    const pluginManifest = readJson(pluginManifestPath);
    if (pluginManifest.name !== pluginEntry.name || pluginManifest.version !== pluginEntry.version) {
      metadataMismatches.push({
        name: pluginEntry.name,
        expectedName: pluginEntry.name,
        actualName: pluginManifest.name,
        expectedVersion: pluginEntry.version,
        actualVersion: pluginManifest.version,
      });
    }
  }

  if (missingPluginDirs.length > 0) {
    errors.push(
      `marketplace 注册的插件目录/manifest 缺失：${missingPluginDirs.map((item) => `${item.name} -> ${item.source}`).join(', ')}`,
    );
  }
  if (metadataMismatches.length > 0) {
    errors.push(
      `plugin metadata 与 marketplace 不一致：${metadataMismatches.map((item) => `${item.name}(${item.actualName}@${item.actualVersion})`).join(', ')}`,
    );
  }

  checks.push(
    createCheck(
      'marketplace-plugin-entries',
      'Marketplace 注册的插件目录与 metadata 一致',
      missingPluginDirs.length === 0 && metadataMismatches.length === 0 ? 'pass' : 'fail',
      {
        pluginCount: plugins.length,
        missingPluginDirs,
        metadataMismatches,
      },
    ),
  );

  if (!fs.existsSync(settingsPath)) {
    warnings.push('缺少 .claude/settings.json，跳过 enabledPlugins 引用校验。');
    checks.push(
      createCheck('claude-enabled-plugins', 'Claude enabledPlugins 引用有效', 'warn', {
        missing: '.claude/settings.json',
      }),
    );
  } else {
    const settings = readJson(settingsPath);
    const enabledPluginKeys = Object.keys(settings.enabledPlugins ?? {});
    const marketplaceNames = new Set(plugins.map((plugin) => plugin.name));
    const danglingEnabledPlugins = enabledPluginKeys.filter((key) => !marketplaceNames.has(key.split('@')[0]));

    if (danglingEnabledPlugins.length > 0) {
      errors.push(`.claude/settings.json 启用了未注册插件：${danglingEnabledPlugins.join(', ')}`);
    }

    checks.push(
      createCheck(
        'claude-enabled-plugins',
        'Claude enabledPlugins 引用有效',
        danglingEnabledPlugins.length === 0 ? 'pass' : 'fail',
        {
          enabledPluginKeys,
          danglingEnabledPlugins,
        },
      ),
    );
  }

  return {
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}

function aggregateValidation(prefix, result, warnings, errors, checks) {
  for (const warning of result.warnings ?? []) {
    warnings.push(`[${prefix}] ${warning}`);
  }
  for (const error of result.errors ?? []) {
    errors.push(`[${prefix}] ${error}`);
  }
  for (const check of result.checks ?? []) {
    checks.push(namespaceCheck(prefix, check));
  }
}

export function syncRepository(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const steps = [];

  const runStep = (id, title, executor) => {
    const result = executor();
    steps.push({ id, title, status: 'pass', result });
    return result;
  };

  runStep('agent-docs', '同步 AGENTS/CLAUDE 共享区块', () => syncSharedAgentDocs(resolvedRoot));
  runStep('preference-rules', '同步 5 agent 工具优先使用规则块', () => syncPreferenceRules({ projectRoot: resolvedRoot }));
  // delegation-contract 必须置于 spec-driver-codex-wrappers 再生**之前**：
  // wrapper 逐行复制源 SKILL body，须先注入约束块再复制，保证 .codex 双层同步。
  runStep('delegation-contract', '注入 5 SKILL 委派硬约束块', () => syncDelegationContract({ projectRoot: resolvedRoot }));
  runStep('release-contract', '同步版本与发布合同', () => syncReleaseContract(resolvedRoot));
  runStep('spectra-skills', '同步 spectra compatibility mirrors', () => syncSpectraSkillMirrors({ projectRoot: resolvedRoot }));
  runStep('spec-driver-codex-wrappers', '再生成 spec-driver Codex wrappers', () => runSpecDriverCodexInstall(resolvedRoot));
  runStep('workflow-registry', '生成 workflow registry', () => generateWorkflowRegistry({ projectRoot: resolvedRoot }));
  runStep('product-entity-catalog', '生成产品 entity catalog', () => generateProductEntityCatalog({ projectRoot: resolvedRoot }));
  runStep('product-quality-reports-pass1', '生成第一轮产品 quality reports', () => generateProductQualityReports({ projectRoot: resolvedRoot }));
  runStep('product-scorecards-pass1', '生成第一轮产品 scorecards', () => generateProductScorecards({ projectRoot: resolvedRoot }));
  runStep('adoption-insights', '生成 adoption insights', () => generateAdoptionInsights({ projectRoot: resolvedRoot }));
  runStep('product-quality-reports-pass2', '生成最终产品 quality reports', () => generateProductQualityReports({ projectRoot: resolvedRoot }));
  runStep('product-scorecards-pass2', '生成最终产品 scorecards', () => generateProductScorecards({ projectRoot: resolvedRoot }));
  runStep('project-context-suggestions', '生成 Project Context suggestions', () => generateProjectContextSuggestions({ projectRoot: resolvedRoot }));

  return {
    projectRoot: resolvedRoot,
    status: 'pass',
    steps,
  };
}

export async function validateRepository(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];
  const checks = [];

  aggregateValidation(
    'agent-docs',
    validateSharedAgentDocs(resolvedRoot),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'marketplace',
    validateMarketplaceAndSettings(resolvedRoot),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'spec-driver-wrappers',
    validateWrapperSources({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'spectra-skills',
    validateSpectraSkillSources({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'runtime-boundaries',
    validateRuntimeBoundaries({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );

  const releaseResult = validateReleaseContract(resolvedRoot);
  for (const check of releaseResult.checks ?? []) {
    checks.push(namespaceCheck('release-contract', check));
  }
  for (const error of releaseResult.errors ?? []) {
    errors.push(`[release-contract] ${error}`);
  }

  aggregateValidation(
    'orchestration-overrides',
    await validateOrchestrationOverrides({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'preference-rules',
    validatePreferenceRules({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'delegation-contract',
    validateDelegationContract({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'orchestrator-model',
    validateOrchestratorModels({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  aggregateValidation(
    'namespace-consistency',
    validateNamespaceConsistency(resolvedRoot),
    warnings,
    errors,
    checks,
  );

  return {
    projectRoot: resolvedRoot,
    status: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
    checks,
    warnings,
    errors,
  };
}
