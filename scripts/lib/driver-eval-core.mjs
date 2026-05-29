/**
 * driver-eval-core — F170d 共享纯函数核心（RED stub）
 *
 * 从 F170c harness (scripts/feature-170c-sc002-driver-eval.mjs) 迁移并扩展的纯函数集合，
 * 供 170d harness (薄 wrapper) 与单测复用。所有导出均为纯函数，无文件 I/O、无顶层副作用。
 *
 * RED phase：所有函数 throw，等 GREEN 实现。
 */

const RED = (name) => {
  throw new Error(`RED: driver-eval-core.${name} not implemented`);
};

// 5 个 caller-analysis / impact 评估类 task（GREEN 从 170c 迁移真实内容）
export const TASKS = [];

// 3 个 non-caller-analysis negative-control task（引导不应触发 MCP）
export const NEGATIVE_CONTROL_TASKS = [];

// Active Call 规则 (b) 字面量黑名单
export const FORBIDDEN_LITERALS = [
  'impact',
  'mcp__spectra__impact',
  'mcp__plugin_spectra_spectra__impact',
];

export function validatePrompts(_tasks) {
  return RED('validatePrompts');
}

/**
 * 通用 tool-event 解析：从 claude --output-format stream-json 的 stdout 提取
 * 按出现顺序的全部 tool_use + 对应 tool_result（不止 impact）。
 * seq 为全局事件序号（tool_use 与 tool_result 共享同一递增计数），用于判定因果顺序
 * （如 fallbackAfterImpactFailure 需 Grep.seq > 失败 impact 的 result.seq）。
 * @returns {{ toolUses: Array<{seq,id,name,input}>,
 *   resultsById: Map<string,{seq,isError,payload,raw}> }}
 */
export function parseToolEvents(_stdout) {
  return RED('parseToolEvents');
}

/**
 * 从 parseToolEvents 输出推导单 run 的三层指标 + Active Call 合规。
 * @returns {{ impactAttempt:boolean, impactResolvedSuccess:boolean,
 *   fallbackAfterImpactFailure:boolean, grepCount:number,
 *   distinctActiveCallCount:number, isCompliant:boolean, nonCompliantReasons:Array }}
 */
export function computeMetrics(_events) {
  return RED('computeMetrics');
}

export function wilsonCI(_successCount, _totalCount, _z = 1.96) {
  return RED('wilsonCI');
}

export function resolveTargetInGraph(_nodeIds, _target) {
  return RED('resolveTargetInGraph');
}

/**
 * 纯函数：按 agentTools 过滤 template 规则行，渲染「工具优先使用规则」块。
 * @param {string} templateText preference-rules.md 全文
 * @param {string[]} agentTools 形如 ['mcp__plugin_spectra_spectra__impact', ...]
 * @returns {string} 渲染后的 Markdown 块（不含 BEGIN/END marker）
 */
export function renderInjectionBlock(_templateText, _agentTools) {
  return RED('renderInjectionBlock');
}
