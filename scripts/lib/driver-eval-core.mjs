/**
 * driver-eval-core — F170d 共享纯函数核心
 *
 * 从 F170c harness (scripts/feature-170c-sc002-driver-eval.mjs) 迁移并扩展的纯函数集合，
 * 供 170d harness (薄 wrapper) 与单测复用。所有导出均为纯函数，无文件 I/O、无顶层副作用。
 * 170c harness 保持冻结（不重构）。
 */

// ============================================================
// 5 个 caller-analysis / impact 评估类 task（从 170c 迁移，逐字一致）
// 关键约束：完全不含 `impact` / `mcp__spectra__impact` / `mcp__plugin_spectra_spectra__impact` 字面量
// ============================================================
export const TASKS = [
  {
    id: 'T1-canonicalizeSymbolId',
    target: 'src/knowledge-graph/query-helpers.ts::canonicalizeSymbolId',
    prompt: `我打算修改 \`src/knowledge-graph/query-helpers.ts\` 里的 \`canonicalizeSymbolId\` 函数：现在它对 4 种 fallback（字面相等 / 前缀剥离 / 三段容错 / 绝对路径转相对）都返回 \`{ canonicalId, reason: 'ok'|'not-found'|'invalid' }\`，我想加第 5 种 fallback——当输入是单个无 \`::\` 的 short name 时，自动调用 \`resolveSymbolFuzzy\` 取 top-1 作为 canonicalId（reason 改为 'fuzzy-matched'）。\n\n动手前想做一次修改前检查：\n- 改 reason 枚举值会不会让现有读 reason 字段的地方意外失败？\n- 静默 fuzzy fallback 可能让用户拿到不期望的 symbol，安全吗？\n- 现有依赖此函数的功能有哪些？需不需要为新 reason 加 hint？\n\n请用你认为合适的工具检查一下，给我一份 reviewable 的清单。`,
  },
  {
    id: 'T2-handleDetectChanges',
    target: 'src/mcp/agent-context-tools.ts::handleDetectChanges',
    prompt: `准备改 \`src/mcp/agent-context-tools.ts\` 里的 \`handleDetectChanges\`：现在它要求 \`diff\` 或 \`baseRef\` 二选一，并对 \`diff\` 文本走 \`parseUnifiedDiff\` 解析。我想新增第三种输入模式 \`changedFiles: string[]\`（已知改动文件名列表，跳过 diff 解析），主要用在 CI hook 场景。\n\n修改前希望做一次检查：\n- 新增可选参数 \`changedFiles\` 是否破坏现有 input schema？\n- 错误处理路径需要新增哪些 error code？\n- handler 内部的 telemetry 采样 / responseSummary 是否需要适配？\n\n请用你认为合适的工具帮我看一下，给出实施方案。`,
  },
  {
    id: 'T3-bfsTraverse',
    target: 'src/knowledge-graph/query-helpers.ts::bfsTraverse',
    prompt: `\`src/knowledge-graph/query-helpers.ts\` 里的 \`bfsTraverse\` 当前默认 \`minConfidence = 0.65\`，我想把默认下调到 \`0.5\`，让 inferred edge（confidenceScore 在 0.5-0.65 区间的）也能被遍历到。\n\n动手前想做一次修改前检查：\n- 默认值下调会不会让某些上层 caller 的 affected 列表突然变长？\n- 现有 fixture 里有多少测试用例假设了 0.65 cutoff？\n- 是否需要同步更新 \`bfsTraverse\` 的 JSDoc 说明？\n\n请用你认为合适的工具帮我审查一下，给出改动建议。`,
  },
  {
    id: 'T4-getCachedGraphData',
    target: 'src/mcp/graph-tools.ts::getCachedGraphData',
    prompt: `\`src/mcp/graph-tools.ts\` 的 \`getCachedGraphData(projectRoot)\` 当前会基于 mtime + size 判断 graph.json 是否 stale，stale 则重新加载。我想给它新增第二个可选参数 \`expectedSchemaVersion?: string\`：当 graph.json 的 \`graph.schemaVersion\` 与传入版本不匹配时，主动 reload 一次，让消费方能 pin schema version 避免 ABI 漂移。\n\n修改前做一次检查：\n- 新增参数对现有调用方是否完全向后兼容？\n- schemaVersion mismatch 时该返回 null 还是 throw？\n- 是否需要更新 cache key 计算逻辑？\n\n请用你认为合适的工具查一下相关代码，给出方案。`,
  },
  {
    id: 'T5-computeRiskTier',
    target: 'src/knowledge-graph/query-helpers.ts::computeRiskTier',
    prompt: `\`src/knowledge-graph/query-helpers.ts\` 的 \`computeRiskTier(directCallers, transitive)\` 现在返回 \`'low' | 'medium' | 'high'\`，阈值是 directCallers ≥ 10 或 transitive ≥ 50 → high。我想新增一个 \`'critical'\` 等级（transitive ≥ 200），让超大型 blast radius 有独立信号。\n\n动手前想做一次检查：\n- 返回类型扩展 \`'critical'\` 是否会让所有读 riskTier 的地方意外 fall-through 到 default 分支？\n- 现有响应字段（如 \`riskSummary.riskTier\`）的 schema 是否需要同步更新？\n- 测试 fixture 有多少 case 需要更新 expected？\n\n请用你认为合适的工具看一下相关代码，告诉我 safe 改法。`,
  },
];

// ============================================================
// 3 个 non-caller-analysis negative-control task（SC-009 over-call 负控）
// 引导**不应**让 driver 对这些纯文本/查找类任务调用 spectra MCP
// 同样不含禁止字面量
// ============================================================
export const NEGATIVE_CONTROL_TASKS = [
  {
    id: 'N1-readme-casing',
    prompt: `请把 \`README.md\` 里出现的所有小写 "spectra"（作为独立单词时）统一改成首字母大写 "Spectra"，代码块和 URL 里的不要动。先给我一份将要改动的行清单。`,
  },
  {
    id: 'N2-todo-list',
    prompt: `帮我把 \`scripts/\` 目录下所有 \`.mjs\` 文件里的 TODO / FIXME 注释列成一个清单（文件路径 + 行号 + 注释内容），我想排期清理。`,
  },
  {
    id: 'N3-version-lookup',
    prompt: `\`package.json\` 的 devDependencies 里 vitest 锁定的是哪个版本号？另外 typescript 是哪个版本？直接告诉我两个版本字符串即可。`,
  },
];

// ============================================================
// Active Call 规则 (b) 字面量黑名单
// ============================================================
export const FORBIDDEN_LITERALS = [
  'impact',
  'mcp__spectra__impact',
  'mcp__plugin_spectra_spectra__impact',
];

/** 校验 task prompt 不含禁止字面量（word-boundary，case-insensitive）。返回 error 字符串数组。 */
export function validatePrompts(tasks) {
  const errors = [];
  for (const task of tasks) {
    for (const literal of FORBIDDEN_LITERALS) {
      const re = new RegExp(`\\b${literal}\\b`, 'i');
      if (re.test(task.prompt)) {
        errors.push(`${task.id} prompt 含禁止字面量 "${literal}"`);
      }
    }
  }
  return errors;
}

// ============================================================
// 通用 tool-event 解析
// ============================================================

const IMPACT_NAME_RE = /^mcp__[a-z_]*spectra(?:_spectra)?__impact$/;

/** 判定 tool_use name 是否为 impact 调用（兼容 mcp__spectra__impact 与 production namespace）。 */
export function isImpactToolName(name) {
  return typeof name === 'string' && IMPACT_NAME_RE.test(name);
}

/**
 * 通用 tool-event 解析：从 claude --output-format stream-json 的 stdout 提取
 * 按出现顺序的全部 tool_use + 对应 tool_result（不止 impact）。
 * seq 为全局事件序号（tool_use 与 tool_result 共享同一递增计数），用于判定因果顺序
 * （如 fallbackAfterImpactFailure 需 Grep.seq > 失败 impact 的 result.seq）。
 * @returns {{ toolUses: Array<{seq,id,name,input}>,
 *   resultsById: Map<string,{seq,isError,payload,raw}> }}
 */
export function parseToolEvents(stdout) {
  const toolUses = [];
  const resultsById = new Map();
  let seq = 0;
  const lines = String(stdout ?? '').split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; }

    if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
      const content = evt.message?.content || [];
      for (const block of content) {
        if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
        toolUses.push({ seq: seq++, id: block.id, name: block.name, input: block.input || {} });
      }
    } else if (evt.type === 'user' && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
        const { payload, raw } = parseToolResultPayload(block.content);
        resultsById.set(block.tool_use_id, { seq: seq++, isError: block.is_error === true, payload, raw });
      }
    }
  }
  return { toolUses, resultsById };
}

/** 解析 tool_result content（数组/字符串）为 JSON payload；解析失败 payload=null。 */
function parseToolResultPayload(content) {
  let raw = '';
  if (Array.isArray(content)) raw = content.map((c) => c?.text || '').join('');
  else if (typeof content === 'string') raw = content;
  if (!raw) return { payload: null, raw };
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return { payload: null, raw };
  try {
    return { payload: JSON.parse(raw.slice(jsonStart)), raw };
  } catch {
    return { payload: null, raw };
  }
}

// impact success path 关键字段（spec FR + 170c Tool×Path 矩阵）
const IMPACT_SUCCESS_FIELDS = ['affected', 'summary', 'effectiveDirection', 'topImpacted', 'nextStepHint'];

/** 判定单个 impact 调用是否为合规 active call（Active Call 规则 c）。返回 {ok, reason}。 */
function evaluateImpactCall(call, resultsById) {
  const target = call.input?.target;
  if (typeof target !== 'string' || target.length === 0) {
    return { ok: false, reason: 'target 为空或非字符串' };
  }
  const result = resultsById.get(call.id);
  if (result === undefined) return { ok: false, reason: 'tool_result 缺失（stdout 截断或超时）' };
  if (result.isError === true) return { ok: false, reason: 'handler error response (isError=true)' };
  const payload = result.payload;
  if (payload === null || typeof payload !== 'object') return { ok: false, reason: 'tool_result content 无法解析为 JSON' };
  // 拒绝任何 error envelope（含 code 字段；用 'in' 避免 code:null/0 绕过）
  if ('code' in payload) return { ok: false, reason: `error envelope: code field present (=${JSON.stringify(payload.code)})` };
  const missing = [];
  if (!Array.isArray(payload.affected)) missing.push('affected');
  if (typeof payload.summary !== 'object' || payload.summary === null) missing.push('summary');
  if (typeof payload.effectiveDirection !== 'string') missing.push('effectiveDirection');
  if (!Array.isArray(payload.topImpacted)) missing.push('topImpacted');
  if (typeof payload.nextStepHint !== 'string' || payload.nextStepHint.length < 5) missing.push('nextStepHint');
  if (missing.length > 0) return { ok: false, reason: `impact success response 缺关键字段: ${missing.join(',')}` };
  return { ok: true, reason: null, target };
}

/**
 * 从 parseToolEvents 输出推导单 run 的三层指标 + Active Call 合规。
 * @param {{toolUses:Array, resultsById:Map}} events
 */
export function computeMetrics(events) {
  const { toolUses, resultsById } = events;
  const impactCalls = toolUses.filter((t) => isImpactToolName(t.name));
  const grepUses = toolUses.filter((t) => t.name === 'Grep');

  const distinctActiveTargets = new Set();
  const nonCompliantReasons = [];
  const failedImpactSeqs = []; // 失败"已知时刻"序号（result.seq 优先，否则 use.seq）

  for (const call of impactCalls) {
    const ev = evaluateImpactCall(call, resultsById);
    if (ev.ok) {
      distinctActiveTargets.add(ev.target); // (d) 按 target 去重
    } else {
      nonCompliantReasons.push({ id: call.id, target: call.input?.target, reason: ev.reason });
      const result = resultsById.get(call.id);
      failedImpactSeqs.push(result?.seq ?? call.seq);
    }
  }

  const distinctActiveCallCount = distinctActiveTargets.size;
  const impactResolvedSuccess = distinctActiveCallCount >= 1;
  // fallback：某次 impact 失败"已知"后，出现 Grep（grep.seq > 失败已知 seq）
  const fallbackAfterImpactFailure = grepUses.some(
    (g) => failedImpactSeqs.some((fs) => g.seq > fs),
  );

  return {
    impactAttempt: impactCalls.length > 0,
    impactResolvedSuccess,
    fallbackAfterImpactFailure,
    grepCount: grepUses.length,
    totalImpactCalls: impactCalls.length,
    distinctActiveCallCount,
    isCompliant: impactResolvedSuccess,
    nonCompliantReasons,
  };
}

// ============================================================
// Wilson score 95% CI（从 170c 迁移）
// ============================================================
export function wilsonCI(successCount, totalCount, z = 1.96) {
  if (totalCount === 0) return { lower: 0, upper: 1, point: 0 };
  const p = successCount / totalCount;
  const denominator = 1 + (z * z) / totalCount;
  const center = p + (z * z) / (2 * totalCount);
  const margin = z * Math.sqrt((p * (1 - p)) / totalCount + (z * z) / (4 * totalCount * totalCount));
  return {
    point: p,
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

// ============================================================
// graph target resolve（从 170c 迁移）
// ============================================================
export function resolveTargetInGraph(nodeIds, target) {
  if (nodeIds.has(target)) return target;
  for (const id of nodeIds) {
    if (typeof id !== 'string') continue;
    if (id.endsWith('/' + target) || id.endsWith(target)) return id;
  }
  return null;
}

// ============================================================
// renderInjectionBlock — 渲染逻辑 canonical source 在 plugin lib（自包含），此处 re-export
// （harness 是仓库 dev 脚本，可依赖 plugin；plugin 不反向依赖 root scripts）
// ============================================================
export {
  renderInjectionBlock,
  toolKeysFromAgentTools,
  parseFrontmatterTools,
  NS,
} from '../../plugins/spec-driver/lib/preference-rules.mjs';
