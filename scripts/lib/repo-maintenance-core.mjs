import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { syncSpectraSkillMirrors } from '../../plugins/spectra/scripts/sync-skill-mirrors.mjs';
import { validateSpectraSkillSources } from '../../plugins/spectra/scripts/validate-skill-sources.mjs';
import { validateOrchestrationOverrides } from '../../plugins/spec-driver/scripts/validate-orchestration-overrides.mjs';
import { generateAdoptionInsights } from '../../plugins/spec-driver/scripts/generate-adoption-insights.mjs';
import { generateProductEntityCatalog } from '../../plugins/spec-driver/scripts/generate-product-entity-catalog.mjs';
import { FRESHNESS_STATES } from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';
import { generateProductQualityReports } from '../../plugins/spec-driver/scripts/generate-product-quality-reports.mjs';
import { generateProductScorecards } from '../../plugins/spec-driver/scripts/generate-product-scorecards.mjs';
import { generateProjectContextSuggestions } from '../../plugins/spec-driver/scripts/generate-project-context-suggestions.mjs';
import { validateWrapperSources } from '../../plugins/spec-driver/scripts/validate-wrapper-sources.mjs';
import { validatePreferenceRules, syncPreferenceRules } from '../../plugins/spec-driver/scripts/sync-preference-rules.mjs';
import { syncDelegationContract, validateDelegationContract } from '../../plugins/spec-driver/scripts/sync-delegation-contract.mjs';
import { validateOrchestratorModels } from '../../plugins/spec-driver/scripts/validate-orchestrator-models.mjs';
import { validateGateMounting } from '../../plugins/spec-driver/scripts/validate-gate-mounting.mjs';
import { generateWorkflowRegistry } from '../../plugins/spec-driver/scripts/generate-workflow-registry.mjs';
import { syncSharedAgentDocs, validateSharedAgentDocs } from '../sync-agent-docs.mjs';
import { syncReleaseContract, validateReleaseContract } from './release-contract-core.mjs';
import { validateRuntimeBoundaries } from './runtime-boundary-core.mjs';
import { validateNamespaceConsistency } from './namespace-consistency-core.mjs';
import { validateAgentTools } from './agent-tools-core.mjs';
import { validateCodexPluginConsistency } from './codex-plugin-consistency-core.mjs';
import { validateGraphQuality } from './graph-quality-core.mjs';
import { validateSpecDrift } from './spec-drift-core.mjs';
import { validateModelLiteralGate } from './model-literal-gate-core.mjs';
import { validateWorktreeLocalState } from './worktree-local-state-core.mjs';

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
  // Feature 213（A1）：repo:sync 是唯一驱动 tracked skills-codex/ 重写的入口，
  // 显式带 --sync-plugin-distribution flag（opt-in 双写）；普通/测试 install 不传，零触发。
  execFileSync('bash', [scriptPath, 'install', '--sync-plugin-distribution'], {
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

/**
 * F219 第 13 族的兜底外壳。
 *
 * `repo:check` 是治理链路的总入口：spec-drift 侧任何未预期 reject（磁盘 I/O、dist 加载、
 * 依赖升级引入的新异常）都不允许把整份报告变成一段栈——消费方会既拿不到 `spec-drift:*`
 * 子检查、也拿不到其余 12 族的结论。因此这里把 reject 收敛成本族的 error 结果。
 */
async function validateSpecDriftSafely({ projectRoot, strict }) {
  try {
    return await validateSpecDrift({ projectRoot, strict });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      checks: [
        {
          id: 'anchors-status',
          title: 'spec drift 锚点全部 fresh',
          status: 'fail',
          evidence: { degraded: true, reason: `spec drift 检测内部错误：${message}` },
        },
      ],
      warnings: [],
      errors: [`spec drift 检测内部错误：${message}`],
    };
  }
}

/**
 * F277（R-1）第 1 族的兜底外壳，与上方 `validateSpecDriftSafely` 同型。
 *
 * `sync-agent-docs.mjs:66` 在 marker 缺失时 throw、`:104` 的 `readFileSync(sourcePath)`
 * 在源文件缺失时同样 throw，而本族此前无 try/catch。F277 把 marker 分布面从「仓根 2 个
 * 必然存在的文件」扩到「4 份 agent + 12 份 SKILL 目标」，且新增 `sourcePath` 全是新建
 * 文件——任一缺失会让 `npm run repo:check` 以未捕获异常中止，其余全部 check 的结论一并
 * 丢失。这不是静默放行，是整份报告不可用，同属 C-3 要治的形态。
 *
 * 方向必须 fail-loud（FR-045）：记 `fail` 并把异常消息放进 `evidence`，
 * **禁止**返回空 checks 数组或 `pass`。
 */
function validateSharedAgentDocsSafely(projectRoot) {
  try {
    return validateSharedAgentDocs(projectRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      checks: [
        {
          id: 'shared-section-status',
          title: 'shared agent section 全部同步',
          status: 'fail',
          evidence: { degraded: true, reason: `shared agent docs 校验内部错误：${message}` },
        },
      ],
      warnings: [],
      errors: [`shared agent docs 校验内部错误：${message}`],
    };
  }
}

// ============================================================
// M11 卡 D（簇⑦）：图新鲜度自动化——repo:sync 顺带把 stale / 缺失 / 无法评估的图用 graph-only 重建（纯 AST、零 LLM）
// ============================================================

const GRAPH_ONLY_REBUILD_MAX_BUFFER = 64 * 1024 * 1024;
/**
 * graph-only 重建 / 探测的墙钟上限；卡死的 batch 或撞上 index.lock 的 git status 不能把整条 repo:sync 无限挂住
 * （F268：SIGTERM 可被忽略，用 SIGKILL 闭合）。已知限界：spawnSync 的 timeout 只杀子进程本身，不覆盖孙进程——graph-only
 * 是进程内纯 AST，不派生孙进程；若将来派生，须改成 graph-bootstrap-status.mjs 那套 detached + kill(-pid)。
 * 测试用环境变量把上限压到毫秒级验证 SIGKILL 闭合（生产不设 ⟹ 零行为）。
 */
const GRAPH_ONLY_REBUILD_TIMEOUT_MS = readTimeoutOverride('SPECTRA_GRAPH_REBUILD_TIMEOUT_MS', 10 * 60 * 1000);
const GRAPH_PROBE_TIMEOUT_MS = readTimeoutOverride('SPECTRA_GRAPH_PROBE_TIMEOUT_MS', 60 * 1000);
/** graph-quality 判「图不可用」的 cannot-assess 原因：这些图连读都读不了或没有可判定对象，是自动重建最该动手的形态（delta 复审 CRITICAL-1） */
const UNUSABLE_GRAPH_REASONS = new Set(['json-parse-error', 'schema-too-old', 'schema-newer-than-supported', 'empty-graph', 'no-symbol-nodes']);

function readTimeoutOverride(name, fallback) {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 决策纯函数（白名单，可穷举）。输入是 `resolveDistState` 与 `probe` 的结果：
 * - dist 缺失 → skip-no-dist；dist 的 build-meta commit ≠ 当前 HEAD → skip-stale-dist（旧 collector 建的图指纹看不出来：
 *   指纹是编译期常量，重建与判定跑的是同一份 dist）
 * - probe 失败 → skip-probe-failed（不盲目重建，也不假装 fresh）
 * - 工作树有未提交采集面改动（**不论图缺失 / stale 与否**）→ skip-dirty：重建会把未提交状态烤进图并盖上 HEAD 的章
 *   （delta 复审 W-4：此前图缺失分支排在脏树闸之前，脏树上重建出带幽灵节点的图）
 * - 图缺失 / 图不可用（JSON 损坏、schema 不受支持、空图、无 symbol 节点）→ rebuild
 * - stale → rebuild；unknown-provenance → git 可用才 rebuild（否则重建也写不出 sourceCommit，每次 sync 白烧一次全量重建）
 * - fresh → noop
 * - 其余任何 freshness 值 → skip-unrecognized-freshness（不落到 noop：判据写成值枚举就每加一个值漏一次）
 */
export function decideGraphFreshnessAction({ dist, probe }) {
  if (!dist?.exists) return 'skip-no-dist';
  if (dist.stale) return 'skip-stale-dist';
  if (!probe || probe.failed) return 'skip-probe-failed';
  if (probe.treeDirty === true) return 'skip-dirty';
  if (probe.graphExists === false || probe.graphUnusable === true) return 'rebuild';
  if (!FRESHNESS_STATES.has(probe.freshness)) return 'skip-unrecognized-freshness';
  if (probe.freshness === 'dirty') return 'skip-dirty';
  if (probe.freshness === 'stale') return 'rebuild';
  if (probe.freshness === 'unknown-provenance') return probe.gitAvailable === false ? 'skip-no-git' : 'rebuild';
  return 'noop';
}

function resolveHeadCommit(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf-8' });
  const head = String(result.stdout ?? '').trim();
  return result.status === 0 && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head) ? head : null;
}

/**
 * dist 状态：存在性 + 是否由当前 HEAD 之外的 commit 构建（`dist/.spectra-build-meta.json`，F176 版本门禁凭据）。
 * build-meta 缺失 / 畸形 / HEAD 取不到时不判陈旧（判不出不等于陈旧；`sourceDirty` 只记录不判定——开发中 dist 几乎恒 dirty）。
 */
export function resolveDistState(projectRoot) {
  const exists = fs.existsSync(path.join(projectRoot, 'dist', 'cli', 'index.js'));
  if (!exists) return { exists: false, stale: false, commit: null, head: null, sourceDirty: null };
  let commit = null;
  let sourceDirty = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(projectRoot, 'dist', '.spectra-build-meta.json'), 'utf-8'));
    commit = typeof meta.commit === 'string' ? meta.commit : null;
    sourceDirty = typeof meta.sourceDirty === 'boolean' ? meta.sourceDirty : null;
  } catch {
    commit = null;
  }
  const head = resolveHeadCommit(projectRoot);
  return { exists: true, stale: commit !== null && head !== null && commit !== head, commit, head, sourceDirty };
}

/**
 * `spectra graph-quality --json`（全量报告而非 --status 三字段：stale 与 dirty 在 state 上互斥，只有全量 verdict 带
 * dirtyFiles / porcelainReadFailed / overallVerdict，自动重建方需要这几项）。
 * stdout 必须整体是 JSON（graph-quality 的日志全走 stderr，「容忍前导日志行」只会把日志里的 `{` 当成 JSON 起点，
 * delta 复审 W-3）；任何失败 → { failed: true, error }。
 * git 可用性用本进程自己的 `git rev-parse` 判（报告里图缺失 / 损坏分支的 `currentHead:null` 是「没评估」的占位，不是「git 不可用」，
 * delta 复审 CRITICAL-1）。
 */
export function defaultProbeGraphStatus(projectRoot) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'dist', 'cli', 'index.js'), 'graph-quality', '--json'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: GRAPH_ONLY_REBUILD_MAX_BUFFER,
    timeout: GRAPH_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (result.error) return { failed: true, error: `graph-quality 进程启动失败: ${result.error.message}` };
  const stdout = String(result.stdout ?? '').trim();
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return { failed: true, error: `graph-quality --json 的 stdout 不是 JSON（exit ${result.status ?? 'null'}）: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { failed: true, error: `graph-quality --json 的 stdout 不是报告对象（exit ${result.status ?? 'null'}）` };
  }
  const freshness = typeof parsed.freshness === 'object' && parsed.freshness !== null ? parsed.freshness : {};
  const cannotAssessReason = typeof parsed.cannotAssessReason === 'string' ? parsed.cannotAssessReason : null;
  return {
    failed: false,
    graphExists: cannotAssessReason !== 'graph-missing',
    graphUnusable: cannotAssessReason !== null && UNUSABLE_GRAPH_REASONS.has(cannotAssessReason),
    freshness: typeof freshness.state === 'string' ? freshness.state : undefined,
    treeDirty: freshness.porcelainReadFailed === true || (Array.isArray(freshness.dirtyFiles) && freshness.dirtyFiles.length > 0),
    builtFromDirtyTree: freshness.builtFromDirtyTree === true,
    gitAvailable: resolveHeadCommit(projectRoot) !== null,
    overallVerdict: typeof parsed.overallVerdict === 'string' ? parsed.overallVerdict : undefined,
  };
}

export function defaultRebuildGraph(projectRoot) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'dist', 'cli', 'index.js'), 'batch', projectRoot, '--mode', 'graph-only'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GRAPH_ONLY_REBUILD_MAX_BUFFER,
    timeout: GRAPH_ONLY_REBUILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  if (result.error) throw new Error(`graph-only 重建进程失败: ${result.error.message}`);
  if (result.status !== 0) {
    const stderrTail = String(result.stderr ?? '').trim().split('\n').slice(-5).join('\n');
    throw new Error(`graph-only 重建退出码 ${result.status ?? `signal ${result.signal}`}: ${stderrTail}`);
  }
  return { ok: true };
}

/**
 * 执行层：dist 状态 → probe → 决策 → （rebuild → 复探）。永不抛出——probe / rebuild 的异常都收进结果，
 * repo:sync 其余步骤照跑；新鲜度最终由 repo:check 的 graph-quality:freshness 检查裁决，本步只是把「手动重建」变成顺带动作。
 */
export function syncGraphFreshness({
  projectRoot,
  distState = resolveDistState,
  probe = defaultProbeGraphStatus,
  rebuild = defaultRebuildGraph,
}) {
  const dist = distState(projectRoot);
  if (!dist.exists) return { action: 'skip-no-dist', rebuilt: false };
  if (dist.stale) {
    return { action: 'skip-stale-dist', rebuilt: false, error: `dist 由 ${dist.commit} 构建而当前 HEAD 是 ${dist.head}，先 npm run build` };
  }
  let before;
  try {
    before = probe(projectRoot);
  } catch (error) {
    before = { failed: true, error: error instanceof Error ? error.message : String(error) };
  }
  const action = decideGraphFreshnessAction({ dist, probe: before });
  if (action !== 'rebuild') {
    return { action, before: before?.freshness, rebuilt: false, ...(before?.failed ? { error: before.error } : {}) };
  }
  try {
    rebuild(projectRoot);
  } catch (error) {
    return { action, before: before.freshness, rebuilt: false, error: error instanceof Error ? error.message : String(error) };
  }
  let after;
  try {
    after = probe(projectRoot);
  } catch (error) {
    return { action, before: before.freshness, rebuilt: true, error: `重建后复探失败: ${error instanceof Error ? error.message : String(error)}` };
  }
  const result = { action, before: before.freshness, after: after?.freshness, rebuilt: true };
  // 收敛护栏（delta 复审 W-5）：重建后探测结果与重建前没有任何变化（state / verdict / 可用性都一样）⇒ 这一步不会收敛，
  // 每次 sync 都会白烧一次全量重建（docs-only 仓库的合法空图 / 非 git 环境 / 采集器回归到无 symbol 节点），如实报 error
  const unchanged = after && !after.failed
    && after.freshness === before.freshness
    && after.overallVerdict === before.overallVerdict
    && after.graphExists === before.graphExists
    && after.graphUnusable === before.graphUnusable;
  if (unchanged) {
    result.error = after.freshness === 'unknown-provenance'
      ? '重建后仍 unknown-provenance（非 git 仓库或 git 不可用，写不出 sourceCommit）；本步不会收敛，请检查 git 环境'
      : `重建后探测结果未变（freshness=${after.freshness} / overallVerdict=${after.overallVerdict}）；本步不会收敛，请人工检查图产物`;
  }
  return result;
}

/** repo:sync 步骤状态：步骤自报 error ⇒ warn（此前硬编码 pass，重建失败在步骤状态上不可见）。 */
export function stepStatusFor(result) {
  return result && typeof result === 'object' && result.error !== undefined ? 'warn' : 'pass';
}

/** 人读输出里 graph-freshness 一步的结果摘要（此前只打静态标题，跳过与失败完全不可见）。 */
export function describeRepoSyncStepResult(result) {
  if (!result || typeof result !== 'object' || typeof result.action !== 'string') return '';
  const parts = [`action=${result.action}`];
  if (result.before !== undefined) parts.push(`before=${result.before}`);
  if (result.after !== undefined) parts.push(`after=${result.after}`);
  // 多行 error（重建 stderr 尾部）折成单行，不撑破 `[repo-sync]` 的列表格式
  if (result.error !== undefined) parts.push(`error=${String(result.error).replace(/\s*\n\s*/g, ' ⏎ ')}`);
  return parts.join(' ');
}

/**
 * repo:sync 步骤表（顺序即执行顺序）。抽成表是为了让「某一步有没有接进 sync」可被单测钉住
 * （M11 卡 D 变异复核：末步漏接时全绿）；`listRepoSyncStepIds()` 与 `syncRepository()` 读同一张表。
 */
function buildRepoSyncSteps(resolvedRoot) {
  return [
    ['agent-docs', '同步 AGENTS/CLAUDE 共享区块', () => syncSharedAgentDocs(resolvedRoot)],
    ['preference-rules', '同步 5 agent 工具优先使用规则块', () => syncPreferenceRules({ projectRoot: resolvedRoot })],
    // delegation-contract 必须置于 spec-driver-codex-wrappers 再生**之前**：
    // wrapper 逐行复制源 SKILL body，须先注入约束块再复制，保证 .codex 双层同步。
    ['delegation-contract', '注入 5 SKILL 委派硬约束块', () => syncDelegationContract({ projectRoot: resolvedRoot })],
    ['release-contract', '同步版本与发布合同', () => syncReleaseContract(resolvedRoot)],
    ['spectra-skills', '同步 spectra compatibility mirrors', () => syncSpectraSkillMirrors({ projectRoot: resolvedRoot })],
    ['spec-driver-codex-wrappers', '再生成 spec-driver Codex wrappers', () => runSpecDriverCodexInstall(resolvedRoot)],
    ['workflow-registry', '生成 workflow registry', () => generateWorkflowRegistry({ projectRoot: resolvedRoot })],
    ['product-entity-catalog', '生成产品 entity catalog', () => generateProductEntityCatalog({ projectRoot: resolvedRoot })],
    ['product-quality-reports-pass1', '生成第一轮产品 quality reports', () => generateProductQualityReports({ projectRoot: resolvedRoot })],
    ['product-scorecards-pass1', '生成第一轮产品 scorecards', () => generateProductScorecards({ projectRoot: resolvedRoot })],
    ['adoption-insights', '生成 adoption insights', () => generateAdoptionInsights({ projectRoot: resolvedRoot })],
    ['product-quality-reports-pass2', '生成最终产品 quality reports', () => generateProductQualityReports({ projectRoot: resolvedRoot })],
    ['product-scorecards-pass2', '生成最终产品 scorecards', () => generateProductScorecards({ projectRoot: resolvedRoot })],
    ['project-context-suggestions', '生成 Project Context suggestions', () => generateProjectContextSuggestions({ projectRoot: resolvedRoot })],
    // M11 卡 D：末步——图 stale / 缺失 / 来源不明时用 graph-only 重建（纯 AST、零 LLM），dirty / 无 dist / probe 失败跳过
    ['graph-freshness', '图 stale / 缺失时用 graph-only 重建', () => syncGraphFreshness({ projectRoot: resolvedRoot })],
  ];
}

/** 步骤 id 顺序表（供单测钉住「某步已接入且位序正确」）。 */
export function listRepoSyncStepIds() {
  return buildRepoSyncSteps('/').map(([id]) => id);
}

export function syncRepository(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot);
  const steps = [];

  for (const [id, title, executor] of buildRepoSyncSteps(resolvedRoot)) {
    const result = executor();
    // 步骤自报的 error（如 graph-only 重建失败）进步骤状态，不再硬编码 pass
    const status = stepStatusFor(result);
    steps.push({ id, title, status, result });
  }

  return {
    projectRoot: resolvedRoot,
    status: steps.some((step) => step.status === 'warn') ? 'warn' : 'pass',
    steps,
  };
}

/**
 * @param {string} projectRoot
 * @param {{strict?: boolean}} [options] F219：可选参数，不传时行为与接入 spec-drift 之前完全一致。
 */
export async function validateRepository(projectRoot, options = {}) {
  const { strict = false } = options;
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];
  const checks = [];

  // F277（R-1）：未预期 throw 由 validateSharedAgentDocsSafely 收敛为本族 error，
  // repo:check 永不因 marker / sourcePath 缺失而吐栈丢掉整份报告。
  aggregateValidation(
    'agent-docs',
    validateSharedAgentDocsSafely(resolvedRoot),
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
  // Feature 213（A1）：Codex plugin 一体分发一致性矩阵（分发面一致性族，紧邻 spectra-skills）
  aggregateValidation(
    'codex-plugin-consistency',
    validateCodexPluginConsistency({ projectRoot: resolvedRoot }),
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
  // F217（M9 轨道 B）— 第 12 个子检查族：图质量门（六指标 + freshness）。
  // 未来 M9 轨道 C 的 spec drift 检测接入 repo:check 时，照抄本行的三段式契约
  // （validate<Feature>({projectRoot}) → aggregateValidation(...)），见 plan §6。
  aggregateValidation(
    'graph-quality',
    validateGraphQuality({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  // F219（M9 轨道 C）— 第 13 个子检查族：spec drift 锚点状态（默认 warn / --strict fail）。
  // ⚠️ `await` MUST 保留：validateSpecDrift 是 async，漏掉 await 会让 aggregateValidation
  // 拿到 Promise 对象，`result.warnings ?? []` 退化为空数组造成静默假通过（FR-008）。
  // 未预期 reject 由 validateSpecDriftSafely 收敛为本族 error，repo:check 永不吐栈。
  aggregateValidation(
    'spec-drift',
    await validateSpecDriftSafely({ projectRoot: resolvedRoot, strict }),
    warnings,
    errors,
    checks,
  );
  // Feature 238（US-3 收尾）— 第 14 个子检查族：模型版本字面量 grep 门禁（FR-310）。
  // 对 FR-310 固定扫描清单做零依赖目录遍历 + 正则扫描，同构接线（三段式契约）。
  aggregateValidation(
    'model-literal-gate',
    validateModelLiteralGate({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  // F239（M9 轨道 B3）— 第 15 个子检查族：worktree/local 状态合同
  // （`.worktreeinclude` 安全公共子集 + AGENTS 文档字节预算）。
  // 同步函数，无需 await；`not-ignored` 子检查在非 git 沙箱内降级为 skip，不拖累整体族状态。
  aggregateValidation(
    'worktree-local-state',
    validateWorktreeLocalState({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  // F277（FR-017）— 第 16 个子检查族：spec-driver 子代理 frontmatter 工具面
  // （正向 6 + 护栏 1 + 文本 1 = 8 条断言，收敛为单个 check id `agent-tools:required`）。
  // 独立成族而非扩 namespace-consistency：后者只回收 `mcp__` 前缀项，`Edit` / `Bash`
  // 在它眼里结构性不可见；且它对在册文件强制「必须含 mcp__ 工具」，把 specify / tasks
  // 加进其 AGENT_FILES 会凭空造出 2 个必红。
  aggregateValidation(
    'agent-tools',
    validateAgentTools({ projectRoot: resolvedRoot }),
    warnings,
    errors,
    checks,
  );
  // F277（FR-053）— 第 17 个子检查族：GATE_DESIGN / GATE_TASKS 在 effective 配置上的
  // 12 条断言（事后守护，与 FR-068 的运行时第一道闸分工，二者缺一不可）。
  // ⚠️ `await` MUST 保留：validateGateMounting 是 async，漏掉会让 aggregateValidation
  // 拿到 Promise，`result.checks ?? []` 退化为空数组造成静默假通过。
  aggregateValidation(
    'gate-mounting',
    await validateGateMounting({ projectRoot: resolvedRoot }),
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
