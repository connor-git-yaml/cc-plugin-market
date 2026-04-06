/**
 * orchestrator-fallback.mjs
 * 当 orchestration.yaml 缺失或损坏时的内置后备配置
 */

export function generateFallbackConfig() {
  return {
    version: '1.0-fallback',
    parallel_scheduling: {
      max_concurrent_tasks: 2,
      fallback_to_serial_on_failure: true,
      fallback_reason_log: true,
    },

    gates: {
      GATE_RESEARCH: { type: 'research_checkpoint', applicable_modes: ['feature'], description: '调研完整性门禁', default_behavior: 'auto', severity: 'non_critical', hard_gate_modes: [] },
      GATE_DESIGN: { type: 'design_checkpoint', applicable_modes: ['feature', 'story', 'implement', 'fix', 'resume', 'sync', 'doc'], description: '需求规范质量门禁', default_behavior: 'always', severity: 'critical', hard_gate_modes: ['feature'] },
      GATE_ANALYSIS: { type: 'quality_analysis', applicable_modes: ['feature', 'implement'], description: '设计一致性分析门禁', default_behavior: 'on_failure', severity: 'non_critical', hard_gate_modes: [] },
      GATE_TASKS: { type: 'task_generation', applicable_modes: ['feature', 'story', 'implement', 'fix', 'resume', 'sync', 'doc'], description: '任务分解完整性门禁', default_behavior: 'always', severity: 'critical', hard_gate_modes: [] },
      GATE_IMPLEMENT_MID: { type: 'implementation_checkpoint', applicable_modes: ['implement'], description: '实现中期检查门禁', default_behavior: 'on_failure', severity: 'non_critical', hard_gate_modes: [], insertion_point: 'after_task_50_percent' },
      GATE_VERIFY: { type: 'verification_checkpoint', applicable_modes: ['feature', 'story', 'implement', 'fix', 'resume', 'sync', 'doc'], description: '最终验证综合门禁', default_behavior: 'always', severity: 'critical', hard_gate_modes: [] },
    },

    parallel_groups: {
      RESEARCH_GROUP: { members: ['1a', '1b'], convergence_point: '1c', fallback_strategy: 'serial_fallback', max_concurrent: 2 },
      DESIGN_PREP_GROUP: { members: ['clarify', 'quality_checklist'], convergence_point: '3.5', fallback_strategy: 'serial_fallback', max_concurrent: 2 },
      VERIFY_GROUP: { members: ['7a', '7b'], convergence_point: '7c', fallback_strategy: 'serial_fallback', max_concurrent: 2 },
    },

    modes: {
      feature: {
        name: 'Feature Mode - Fallback', description: 'Minimal feature mode',
        phases: [
          { id: '0', name: 'constitution_check', display_name: '项目宪法检查', agent: null, agent_mode: 'inline', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: false },
          { id: '2', name: 'specify', display_name: '需求规范', agent: 'specify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_DESIGN'], conditional: null, skip_if_exists: 'spec.md', is_critical: true },
          { id: '4', name: 'plan', display_name: '技术规划', agent: 'plan', agent_mode: 'single', gates_before: ['GATE_DESIGN'], gates_after: [], conditional: null, skip_if_exists: 'plan.md', is_critical: true },
          { id: '5', name: 'tasks', display_name: '任务分解', agent: 'tasks', agent_mode: 'single', gates_before: [], gates_after: ['GATE_TASKS'], conditional: null, skip_if_exists: 'tasks.md', is_critical: true },
          { id: '6', name: 'implement', display_name: '代码实现', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '7c', name: 'verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      story: {
        name: 'Story Mode - Fallback', description: 'Minimal story mode',
        phases: [
          { id: '1', name: 'specify', display_name: '需求规范', agent: 'specify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_DESIGN'], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'tasks', display_name: '任务分解', agent: 'tasks', agent_mode: 'single', gates_before: [], gates_after: ['GATE_TASKS'], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '3', name: 'implement', display_name: '代码实现', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '4', name: 'verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      implement: {
        name: 'Implement Mode - Fallback', description: 'Minimal implement mode',
        phases: [
          { id: '1', name: 'clarify', display_name: '需求澄清', agent: 'clarify', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: false },
          { id: '2', name: 'tasks', display_name: '任务分解', agent: 'tasks', agent_mode: 'single', gates_before: [], gates_after: ['GATE_TASKS'], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '3', name: 'implement', display_name: '代码实现', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '4', name: 'verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      fix: {
        name: 'Fix Mode - Fallback', description: 'Minimal fix mode',
        phases: [
          { id: '1', name: 'implement', display_name: '代码修复', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      resume: {
        name: 'Resume Mode - Fallback', description: 'Minimal resume mode',
        phases: [
          { id: '1', name: 'implement', display_name: '代码实现', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      sync: {
        name: 'Sync Mode - Fallback', description: 'Minimal sync mode',
        phases: [
          { id: '1', name: 'sync', display_name: '制品同步', agent: 'sync', agent_mode: 'single', gates_before: [], gates_after: ['GATE_TASKS'], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'verify', display_name: '质量验证', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      doc: {
        name: 'Doc Mode - Fallback', description: 'Minimal doc mode',
        phases: [
          { id: '1', name: 'doc', display_name: '文档生成', agent: 'doc', agent_mode: 'single', gates_before: [], gates_after: ['GATE_TASKS'], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'verify', display_name: '质量验证', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
      refactor: {
        name: 'Refactor Mode - Fallback', description: 'Minimal refactor mode',
        phases: [
          { id: '1', name: 'impact_analysis', display_name: '影响分析', agent: 'refactor-plan', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '2', name: 'batch_implement', display_name: '代码重构', agent: 'implement', agent_mode: 'single', gates_before: [], gates_after: [], conditional: null, skip_if_exists: null, is_critical: true },
          { id: '3', name: 'final_verify', display_name: '验证与交付', agent: 'verify', agent_mode: 'single', gates_before: [], gates_after: ['GATE_VERIFY'], conditional: null, skip_if_exists: null, is_critical: true },
        ],
      },
    },
  };
}
