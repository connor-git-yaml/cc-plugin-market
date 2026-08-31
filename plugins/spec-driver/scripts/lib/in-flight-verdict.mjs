/**
 * in-flight-verdict.mjs
 * F270 P3 — 用 harness 原生 `background_tasks` 判「在途」，取代基于 transcript 派生的猜测。
 *
 * 三态（C-2 / FR-014/015，均本机实测 research/harness-field-probe.md）：
 *   - in-flight    ← `background_tasks` 存在且为**非空数组**（P-12 真实 Stop 直证：含 running 子代理）
 *   - no-in-flight ← 存在且为**空数组**（P-12 真实 Stop 直证：session_crons:[]）
 *   - undetermined ← 键**整体缺席**（B-2：`toolUseContext` 缺席时 background_tasks 与 session_crons
 *     两键同生共死消失）——**绝不可坍缩进 no-in-flight**，否则"探测不到"被读成"确证无在途" → 恢复误 block。
 *
 * 🔴 承重判据只用**结构性事实**（键是否存在、数组是否非空）。`type`/`description`/`agent_type`
 * 是**展示别名**（映射表 `local_agent→"subagent"`、`mcp_task→"MCP task"` 含空格，随 harness 版本变），
 * 只进人类可读诊断、绝不影响判定结论（C-8 / T-1）。
 *
 * 非数组取值（harness 改型为 null/{}/字符串）保守归 undetermined：与「非布尔 stop_hook_active 按
 * 非重入处理」同纪律——对上游序列化行为的假设一旦不成立，宁可落"无法判定"而非猜一个方向。
 *
 * 已知时序窗（P3 对抗 B-必答① 登记）：`background_tasks` 只收 running/pending（Gw 过滤器），
 * 「子代理**已完成**但主线程尚未消费其结果」在 harness 侧**不可见**——该瞬间的 Stop 会判
 * no-in-flight → 不推迟 → 若制品未齐则 exit 2。方向可接受：有界（blockCount 兜底）、单点
 * 瞬时（下次 Stop 主线程已消费，窗口自闭）、且相比被取代的 transcript 派生假在途（21.3%
 * 通知不达=长期无声假放行）是净收窄。如实登记，不读作"零误伤"。
 *
 * 挂载点注意（C-9 / T-2，已知边界，本迭代不实现）：本判定器挂 Stop（非 SubagentStop）。
 * 若未来增挂 SubagentStop，`background_tasks` 会**包含触发它的子代理自身**（P-12 实测 id==agent_id、
 * status:running），必须先按 agent_id 剔除自身，否则恒判在途 → 恒推迟 → 门禁静默失效。
 */

export const IN_FLIGHT_STATES = Object.freeze({
  IN_FLIGHT: 'in-flight',
  NO_IN_FLIGHT: 'no-in-flight',
  UNDETERMINED: 'undetermined',
});

/** 三态各自的诊断码（FR-015：undetermined 必须有独立码，与 no-in-flight 可区分） */
export const IN_FLIGHT_DIAGNOSTICS = Object.freeze({
  [IN_FLIGHT_STATES.IN_FLIGHT]: 'in-flight-detected',
  [IN_FLIGHT_STATES.NO_IN_FLIGHT]: 'in-flight-none',
  [IN_FLIGHT_STATES.UNDETERMINED]: 'in-flight-undetermined',
});

/** 单条任务的人类可读片段：容忍字段缺失与未知/含空格 type（仅诊断用，不承重） */
function describeTask(task) {
  if (!task || typeof task !== 'object') return '未知任务';
  const type = typeof task.type === 'string' && task.type.length > 0 ? task.type : '未知类型';
  const desc = typeof task.description === 'string' && task.description.length > 0 ? task.description : '';
  return desc ? `${type}(${desc})` : type;
}

/**
 * 从 Stop payload 判在途三态。零 I/O、纯函数、不抛。
 * @param {unknown} payload - Stop hook payload（可能非对象/字段缺席）
 * @returns {{ state:string, count:number, diagnostic:string, humanReadable:string }}
 */
export function classifyInFlightFromPayload(payload) {
  const undetermined = () => ({
    state: IN_FLIGHT_STATES.UNDETERMINED,
    count: 0,
    diagnostic: IN_FLIGHT_DIAGNOSTICS[IN_FLIGHT_STATES.UNDETERMINED],
    humanReadable: 'background_tasks 字段缺席或形状异常，无法判定在途',
  });

  if (payload === null || typeof payload !== 'object') return undetermined();
  // 键缺席（含 undefined）→ undetermined；显式非数组（null/{}/字符串等改型）→ 同样保守归 undetermined
  if (!Object.hasOwn(payload, 'background_tasks')) return undetermined();
  const tasks = payload.background_tasks;
  if (!Array.isArray(tasks)) return undetermined();

  if (tasks.length === 0) {
    return {
      state: IN_FLIGHT_STATES.NO_IN_FLIGHT,
      count: 0,
      diagnostic: IN_FLIGHT_DIAGNOSTICS[IN_FLIGHT_STATES.NO_IN_FLIGHT],
      humanReadable: '无在途后台任务',
    };
  }
  return {
    state: IN_FLIGHT_STATES.IN_FLIGHT,
    count: tasks.length,
    diagnostic: IN_FLIGHT_DIAGNOSTICS[IN_FLIGHT_STATES.IN_FLIGHT],
    humanReadable: `在等 ${tasks.length} 个后台任务：${tasks.map(describeTask).join('、')}`,
  };
}
