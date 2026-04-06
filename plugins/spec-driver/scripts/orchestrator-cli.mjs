#!/usr/bin/env node

/**
 * Orchestrator CLI Wrapper
 * 提供命令行接口查询编排配置，供 SKILL.md 调用
 *
 * 用法:
 *   node orchestrator-cli.mjs get-phases <mode>
 *   node orchestrator-cli.mjs get-gate-behavior <mode> <gate-id>
 *   node orchestrator-cli.mjs get-parallel-groups <mode>
 *   node orchestrator-cli.mjs evaluate-condition <expression> --context <json>
 *   node orchestrator-cli.mjs validate-config
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Orchestrator } from './orchestrator.mjs';
import orchestratorFallback from './orchestrator-fallback.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 加载配置：orchestration.yaml 或 fallback
 */
async function loadConfig(projectRoot = '.') {
  const orchPath = path.resolve(projectRoot, 'orchestration.yaml');

  if (fs.existsSync(orchPath)) {
    try {
      const yaml = await import('yaml');
      const content = fs.readFileSync(orchPath, 'utf8');
      return yaml.parse(content);
    } catch (err) {
      console.error(`[ERROR] 加载 orchestration.yaml 失败: ${err.message}`);
      console.error('[FALLBACK] 使用内置后备配置');
      return orchestratorFallback;
    }
  }

  console.error(`[FALLBACK] orchestration.yaml 不存在，使用内置后备配置`);
  return orchestratorFallback;
}

/**
 * 命令: get-phases
 * 输出: 指定模式下的 Phase 序列
 */
async function cmdGetPhases(mode, config) {
  try {
    const orchestrator = new Orchestrator(config, mode, {});
    const phases = orchestrator.getPhases();
    console.log(JSON.stringify({
      success: true,
      mode,
      phases: phases.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        condition: p.condition || null,
        parallel_group: p.parallel_group || null
      }))
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 命令: get-gate-behavior
 * 输出: 指定 Gate 的执行行为
 */
async function cmdGetGateBehavior(mode, gateId, config) {
  try {
    const orchestrator = new Orchestrator(config, mode, {});
    const behavior = orchestrator.getGateBehavior(gateId);
    console.log(JSON.stringify({
      success: true,
      mode,
      gate_id: gateId,
      behavior: behavior.behavior,
      is_hard_gate: behavior.is_hard_gate || false,
      reason: behavior.reason || null
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 命令: get-parallel-groups
 * 输出: 指定模式下的并行组定义
 */
async function cmdGetParallelGroups(mode, config) {
  try {
    const orchestrator = new Orchestrator(config, mode, {});
    const groups = orchestrator.getParallelGroups?.() || [];
    console.log(JSON.stringify({
      success: true,
      mode,
      parallel_groups: groups.map(g => ({
        id: g.id,
        name: g.name,
        phases: g.phases || [],
        merge_point: g.merge_point || null
      }))
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 命令: evaluate-condition
 * 输出: 条件表达式求值结果
 */
async function cmdEvaluateCondition(expression, contextJson) {
  try {
    const context = contextJson ? JSON.parse(contextJson) : {};
    const orchestrator = new Orchestrator({}, 'feature', context);
    const result = orchestrator.evaluateCondition(expression);
    console.log(JSON.stringify({
      success: true,
      expression,
      result,
      context
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 命令: validate-config
 * 输出: 配置验证结果
 */
async function cmdValidateConfig(projectRoot = '.') {
  try {
    const config = await loadConfig(projectRoot);
    console.log(JSON.stringify({
      success: true,
      message: '配置有效',
      mode_count: Object.keys(config.modes || {}).length,
      gate_count: Object.keys(config.gates || {}).length,
      parallel_group_count: Object.keys(config.parallel_groups || {}).length
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      success: false,
      error: err.message
    }, null, 2));
    process.exit(1);
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('用法: orchestrator-cli <command> [options]');
    console.error('');
    console.error('命令:');
    console.error('  get-phases <mode>                    获取 Phase 序列');
    console.error('  get-gate-behavior <mode> <gate-id>   获取 Gate 行为');
    console.error('  get-parallel-groups <mode>           获取并行组定义');
    console.error('  evaluate-condition <expr> [--context <json>]  求值条件表达式');
    console.error('  validate-config                      验证配置文件');
    process.exit(1);
  }

  const command = args[0];
  const projectRoot = process.env.PROJECT_ROOT || '.';

  // 加载配置：优先使用 orchestration.yaml，fallback 到内置配置
  const config = await loadConfig(projectRoot);

  switch (command) {
    case 'get-phases':
      if (args.length < 2) {
        console.error('错误: get-phases 需要 <mode> 参数');
        process.exit(1);
      }
      await cmdGetPhases(args[1], config);
      break;

    case 'get-gate-behavior':
      if (args.length < 3) {
        console.error('错误: get-gate-behavior 需要 <mode> <gate-id> 参数');
        process.exit(1);
      }
      await cmdGetGateBehavior(args[1], args[2], config);
      break;

    case 'get-parallel-groups':
      if (args.length < 2) {
        console.error('错误: get-parallel-groups 需要 <mode> 参数');
        process.exit(1);
      }
      await cmdGetParallelGroups(args[1], config);
      break;

    case 'evaluate-condition':
      if (args.length < 2) {
        console.error('错误: evaluate-condition 需要 <expression> 参数');
        process.exit(1);
      }
      const contextIdx = args.indexOf('--context');
      const contextJson = contextIdx !== -1 ? args[contextIdx + 1] : null;
      await cmdEvaluateCondition(args[1], contextJson);
      break;

    case 'validate-config':
      await cmdValidateConfig(projectRoot);
      break;

    default:
      console.error(`错误: 未知命令 '${command}'`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
