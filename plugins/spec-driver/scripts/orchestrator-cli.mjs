#!/usr/bin/env node

/**
 * orchestrator-cli.mjs
 * 命令行接口，查询编排配置，供 SKILL.md 调用
 *
 * 用法:
 *   node orchestrator-cli.mjs get-phases <mode>
 *   node orchestrator-cli.mjs get-gate-behavior <mode> <gate-id>
 *   node orchestrator-cli.mjs get-parallel-groups <mode>
 *   node orchestrator-cli.mjs validate-config
 *   node orchestrator-cli.mjs effective-orchestration <mode> [--format yaml|json] [--annotate] [--diff] [--project-root <path>]
 */

import { Orchestrator, validateOrchestrationYaml, evaluateCondition } from '../lib/orchestrator.mjs';
import { generateFallbackConfig } from '../lib/orchestrator-fallback.mjs';
import { resolveOrchestrationConfig } from '../lib/orchestration-resolver.mjs';
import {
  yamlScalar,
  serializeYaml,
  serializeWithAnnotations,
  formatDiff,
} from '../lib/orchestration-output-serializer.mjs';

// 静默日志器（CLI 只输出 JSON）
const silentLogger = {
  info: () => {},
  warn: (msg) => process.stderr.write(msg + '\n'),
  error: (msg) => process.stderr.write(msg + '\n'),
  debug: () => {},
};

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(error) {
  console.error(JSON.stringify({ success: false, error }, null, 2));
  process.exit(1);
}

/**
 * 解析 --project-root 参数，默认使用 process.cwd()
 * @param {string[]} args
 * @returns {string}
 */
function parseProjectRoot(args) {
  const idx = args.indexOf('--project-root');
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return process.cwd();
}

/**
 * 通用：调用 resolveOrchestrationConfig 并构造注入了 preloadedConfig 的 Orchestrator
 * 这是 D-PLAN-6（陷阱 2）的核心防御：CLI 不重复读取 YAML，
 * 而是统一走 resolver 路径，将 mergedConfig 注入 Orchestrator。
 *
 * @param {string} mode
 * @param {string} projectRoot
 * @param {object} [extra] - 额外传给 Orchestrator context 的字段
 * @returns {Promise<{ orch: Orchestrator, resolverResult: object }>}
 */
async function buildOrchestrator(mode, projectRoot, extra = {}) {
  const resolverResult = await resolveOrchestrationConfig({ projectRoot });
  // 将 diagnostics 以 warning 级别输出到 stderr（非空时）
  for (const diag of resolverResult.diagnostics) {
    if (diag.level !== 'info') {
      process.stderr.write(`[orchestration-overrides] ${diag.code}: ${diag.message}\n`);
    }
  }
  const orch = new Orchestrator(
    {},
    mode,
    { logger: silentLogger, ...extra },
    { preloadedConfig: resolverResult.mergedConfig },
  );
  return { orch, resolverResult };
}

/**
 * get-phases <mode> [--project-root <path>]
 */
async function cmdGetPhases(mode, args) {
  const projectRoot = parseProjectRoot(args);
  try {
    const { orch } = await buildOrchestrator(mode, projectRoot);
    const phases = orch.getPhases();
    output({
      success: true,
      mode,
      phase_count: phases.length,
      phases: phases.map((p) => ({
        id: p.id,
        name: p.name,
        display_name: p.display_name,
        agent: p.agent,
        agent_mode: p.agent_mode,
        conditional: p.conditional || null,
        is_critical: p.is_critical || false,
      })),
    });
  } catch (err) {
    fail(err.message);
  }
}

/**
 * get-gate-behavior <mode> <gate-id> [--project-root <path>]
 */
async function cmdGetGateBehavior(mode, gateId, args) {
  const projectRoot = parseProjectRoot(args);
  try {
    const { orch } = await buildOrchestrator(mode, projectRoot);
    const gate = orch.getGateBehavior(gateId);
    output({
      success: true,
      mode,
      gate_id: gateId,
      behavior: gate.behavior,
      source: gate.source,
      is_hard_gate: gate.isHardGate || false,
      severity: gate.severity,
      description: gate.description || null,
    });
  } catch (err) {
    fail(err.message);
  }
}

/**
 * get-parallel-groups <mode> [--project-root <path>]
 */
async function cmdGetParallelGroups(mode, args) {
  const projectRoot = parseProjectRoot(args);
  try {
    const { orch } = await buildOrchestrator(mode, projectRoot);
    const groups = orch.getParallelGroups();
    output({
      success: true,
      mode,
      group_count: groups.length,
      parallel_groups: groups.map((g) => ({
        id: g.id,
        members: g.members,
        convergence_point: g.convergencePoint,
        fallback_strategy: g.fallbackStrategy,
        description: g.description,
      })),
    });
  } catch (err) {
    fail(err.message);
  }
}

/**
 * evaluate-condition <expression> [--context <json>]
 */
function cmdEvaluateCondition(expression, contextJson) {
  try {
    const context = contextJson ? JSON.parse(contextJson) : {};
    const result = evaluateCondition(expression, context);
    output({ success: true, expression, result, context });
  } catch (err) {
    fail(err.message);
  }
}

/**
 * recommend-research-mode --description <text> [--has-existing-research] [--online-required]
 *
 * 基于需求特征推荐 research_mode，用于 Phase 0.5 的 auto 模式决策。
 * 规则（按优先级）：
 *   1. 已有 research/ 制品 → skip
 *   2. 需求涉及外部 API/标准/最佳实践且 online_required → full
 *   3. 需求涉及 UI/UX/产品定位 → product-only
 *   4. 需求为内部重构/代码整理 → codebase-scan
 *   5. 需求涉及新模块/新架构 → tech-only
 *   6. 默认 → codebase-scan
 */
function cmdRecommendResearchMode(description, hasExistingResearch, onlineRequired) {
  // 规则 1：已有调研制品
  if (hasExistingResearch) {
    return output({
      success: true,
      recommended: 'skip',
      reason: '已有 research/ 调研制品，跳过调研阶段',
      confidence: 'high',
    });
  }

  const desc = (description || '').toLowerCase();

  // 信号词匹配
  const externalSignals = ['api', 'sdk', 'third-party', '第三方', '标准', 'standard', 'best practice', '最佳实践', 'spec', 'rfc'];
  const uxSignals = ['ui', 'ux', '用户体验', '产品', 'product', '界面', '交互', 'design'];
  const refactorSignals = ['refactor', '重构', '收敛', '整理', '清理', '迁移', 'cleanup', 'reorganize', '拆分', 'split', '合并', 'merge', '统一', 'unify'];
  const newArchSignals = ['new module', '新模块', '新增模块', '架构', 'architecture', 'framework', '框架'];

  const hasExternal = externalSignals.some(s => desc.includes(s));
  const hasUx = uxSignals.some(s => desc.includes(s));
  const hasRefactor = refactorSignals.some(s => desc.includes(s));
  const hasNewArch = newArchSignals.some(s => desc.includes(s));

  // 规则 2：外部 API/标准
  if (hasExternal && onlineRequired) {
    return output({ success: true, recommended: 'full', reason: '需求涉及外部 API/标准，且 online_required=true', confidence: 'high' });
  }

  // 规则 3：UI/UX
  if (hasUx && !hasRefactor) {
    return output({ success: true, recommended: 'product-only', reason: '需求涉及 UI/UX/产品定位', confidence: 'medium' });
  }

  // 规则 4：内部重构
  if (hasRefactor) {
    return output({ success: true, recommended: 'codebase-scan', reason: '需求为内部重构/代码整理', confidence: 'high' });
  }

  // 规则 5：新架构/新模块
  if (hasNewArch) {
    return output({ success: true, recommended: 'tech-only', reason: '需求涉及新模块/新架构设计', confidence: 'medium' });
  }

  // 规则 6：默认
  output({ success: true, recommended: 'codebase-scan', reason: '默认推荐：代码库上下文扫描', confidence: 'low' });
}

/**
 * validate-config [--project-root <path>]
 */
async function cmdValidateConfig(args) {
  const projectRoot = parseProjectRoot(args);
  try {
    const { orch, resolverResult } = await buildOrchestrator('feature', projectRoot);
    const summary = orch.getSummary();
    // W-007 修复：preloadedConfig 路径下 Orchestrator 实例硬设 isFallback=false，
    // 真实降级状态在 resolverResult 中。validate-config 必须报告 resolver 视角的状态，
    // 否则 version-mismatch / schema-fallback 等降级场景会被错报为"配置有效"。
    const isFallback = resolverResult.isFallback;
    output({
      success: true,
      message: isFallback ? '使用后备配置' : '配置有效',
      is_fallback: isFallback,
      mode_count: Object.keys(orch.config.modes || {}).length,
      gate_count: summary.gatesCount,
      parallel_group_count: summary.parallelGroupsCount,
      version: summary.version,
    });
  } catch (err) {
    fail(err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// effective-orchestration 子命令（T-014/T-015/T-016/T-017）
// ─────────────────────────────────────────────────────────────

/**
 * effective-orchestration <mode> [--format yaml|json] [--annotate] [--diff] [--project-root <path>]
 * (T-014/T-015/T-016/T-017)
 */
async function cmdEffectiveOrchestration(mode, options) {
  const { format, annotate, diff, projectRoot } = options;

  // 调用 resolver 获取 mergedConfig + fieldSources + diagnostics
  let resolverResult;
  try {
    resolverResult = await resolveOrchestrationConfig({ projectRoot });
  } catch (err) {
    fail(`resolver 调用失败：${err.message}`);
    return;
  }

  const { mergedConfig, fieldSources, diagnostics } = resolverResult;

  // 校验 mode 是否存在（spec FR-011：mode 不存在退出 1）
  const validModes = Object.keys(mergedConfig.modes || {});
  if (!validModes.includes(mode)) {
    process.stderr.write(JSON.stringify({
      success: false,
      error: `mode "${mode}" 不存在，合法值为 [${validModes.join(', ')}]`,
    }) + '\n');
    process.exit(1);
    return;
  }

  // diagnostics 非空时输出到 stderr
  for (const diag of diagnostics) {
    if (diag.level !== 'info') {
      process.stderr.write(`[orchestration-overrides] ${diag.code}: ${diag.message}\n`);
    }
  }

  // --annotate + --format json 时静默忽略 --annotate + stderr info 提示（CL-004 决策）
  if (annotate && format === 'json') {
    process.stderr.write('[info] --annotate 与 --format json 不兼容，已忽略 --annotate\n');
  }

  // --diff 优先于 --annotate
  if (diff) {
    // 使用 resolverResult.baseConfig（纯 base config，无 overrides 影响），避免二次调用 resolver
    const diffOutput = formatDiff(fieldSources, resolverResult.baseConfig, mergedConfig);
    process.stdout.write(diffOutput + '\n');
    return;
  }

  // --format json
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ config: mergedConfig, fieldSources, diagnostics }, null, 2) + '\n');
    return;
  }

  // --annotate（仅 yaml 模式有效）
  if (annotate) {
    const annotatedYaml = serializeWithAnnotations(mergedConfig, fieldSources);
    process.stdout.write(annotatedYaml + '\n');
    return;
  }

  // 默认 --format yaml
  const yamlOutput = serializeYaml(mergedConfig);
  process.stdout.write(yamlOutput + '\n');
}

// 主函数
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('用法: orchestrator-cli <command> [options]');
  console.error('');
  console.error('命令:');
  console.error('  get-phases <mode> [--project-root <path>]                    获取 Phase 序列');
  console.error('  get-gate-behavior <mode> <gate-id> [--project-root <path>]   获取 Gate 行为');
  console.error('  get-parallel-groups <mode> [--project-root <path>]           获取并行组定义');
  console.error('  evaluate-condition <expr> [--context <json>]                 求值条件表达式');
  console.error('  validate-config [--project-root <path>]                      验证配置文件');
  console.error('  recommend-research-mode --description <text> [--has-existing-research] [--online-required]');
  console.error('  effective-orchestration <mode> [--format yaml|json] [--annotate] [--diff] [--project-root <path>]');
  process.exit(1);
}

const command = args[0];

switch (command) {
  case 'get-phases':
    if (args.length < 2) fail('get-phases 需要 <mode> 参数');
    await cmdGetPhases(args[1], args.slice(2));
    break;

  case 'get-gate-behavior':
    if (args.length < 3) fail('get-gate-behavior 需要 <mode> <gate-id> 参数');
    await cmdGetGateBehavior(args[1], args[2], args.slice(3));
    break;

  case 'get-parallel-groups':
    if (args.length < 2) fail('get-parallel-groups 需要 <mode> 参数');
    await cmdGetParallelGroups(args[1], args.slice(2));
    break;

  case 'evaluate-condition': {
    if (args.length < 2) fail('evaluate-condition 需要 <expression> 参数');
    const ctxIdx = args.indexOf('--context');
    const ctxJson = ctxIdx !== -1 ? args[ctxIdx + 1] : null;
    cmdEvaluateCondition(args[1], ctxJson);
    break;
  }

  case 'validate-config':
    await cmdValidateConfig(args.slice(1));
    break;

  case 'recommend-research-mode': {
    const descIdx = args.indexOf('--description');
    const desc = descIdx !== -1 ? args[descIdx + 1] : '';
    const hasExisting = args.includes('--has-existing-research');
    const onlineReq = args.includes('--online-required');
    cmdRecommendResearchMode(desc, hasExisting, onlineReq);
    break;
  }

  case 'effective-orchestration': {
    if (args.length < 2) fail('effective-orchestration 需要 <mode> 参数');
    const mode = args[1];
    const restArgs = args.slice(2);
    const formatIdx = restArgs.indexOf('--format');
    const format = formatIdx !== -1 ? restArgs[formatIdx + 1] : 'yaml';
    const annotate = restArgs.includes('--annotate');
    const diff = restArgs.includes('--diff');
    const projectRoot = parseProjectRoot(restArgs);
    await cmdEffectiveOrchestration(mode, { format, annotate, diff, projectRoot });
    break;
  }

  default:
    fail(`未知命令 '${command}'`);
}
