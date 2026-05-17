#!/usr/bin/env node
/**
 * Feature 162 Phase C — subAgentMeta 双轨采集
 *
 * 用途：
 *   sub-agent spawn 流程中采集 spec-driver plugin 实际加载状态：
 *     方式 A（env 注入）：主进程 spawn 时通过 SPECTRA_PLUGIN_VERSION /
 *                         SPECTRA_PLUGIN_FRONTMATTER_TOOLS / SPECTRA_PLUGIN_LOAD_SOURCE
 *                         注入；sub-agent 在 telemetry 输出回显
 *     方式 B（first-tool-call 自报）：sub-agent prompt 末尾约定先调用
 *                         Read('plugins/spec-driver/.claude-plugin/plugin.json')
 *                         并复述 version 字段；解析 stream-json 中的首个 Read 结果
 *
 * 字段级 fallback（iter-4 W-8）：
 *   - 每字段独立选 source：self-report 优先，缺则 env，再缺则 null
 *   - confidence 状态机：根据 sourceTrack 分布决定
 *   - 冲突探测：双源都报 specDriverVersion 但不一致 → 记 collectIssues
 *
 * inheritance_status 三状态判定（iter-4 修订）：
 *   - unavailable: mcpToolCalls 含 error='tool-not-available' / version<4.1.0
 *   - available  : mcpToolCalls.length > 0 且无 unavailable 信号 / version>=4.1.0
 *   - unknown    : 既无 unavailable 也无 available 信号
 *
 * 导出：
 *   injectSubAgentMetaEnv / parseSubAgentSelfReport / mergeSubAgentMeta /
 *   deriveInheritanceStatus / compareSemver
 *
 * Spec / Plan：specs/162-codex-driver-glm-judge-eval/plan.md §2.4.5 §2.6.2
 */

const ENV_VAR_VERSION = 'SPECTRA_PLUGIN_VERSION';
const ENV_VAR_TOOLS = 'SPECTRA_PLUGIN_FRONTMATTER_TOOLS';
const ENV_VAR_LOAD_SOURCE = 'SPECTRA_PLUGIN_LOAD_SOURCE';

const META_FIELDS = ['specDriverVersion', 'frontmatterTools', 'loadSource'];

// ───────────────────────────────────────────────────────────
// semver 比较（最小实现，仅 major.minor.patch）
// ───────────────────────────────────────────────────────────

/**
 * 比较两个 semver 字符串。返回 -1 / 0 / 1。
 * 不支持 pre-release / build metadata；遇格式错误抛错。
 */
export function compareSemver(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new Error(`compareSemver 参数非 string: a=${typeof a} b=${typeof b}`);
  }
  const parse = (s) => {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s.trim());
    if (!m) throw new Error(`semver 格式异常: ${s}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const va = parse(a);
  const vb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (va[i] < vb[i]) return -1;
    if (va[i] > vb[i]) return 1;
  }
  return 0;
}

// ───────────────────────────────────────────────────────────
// 方式 A: env 注入
// ───────────────────────────────────────────────────────────

/**
 * 构建 spawn sub-agent 的环境变量补丁。
 * 调用方：const env = { ...process.env, ...injectSubAgentMetaEnv({...}) }; spawn(..., { env })
 *
 * frontmatterTools 序列化为 comma-joined 字符串（env 不能传 array）。
 */
export function injectSubAgentMetaEnv({ specDriverVersion, frontmatterTools, loadSource }) {
  const out = {};
  if (specDriverVersion != null) out[ENV_VAR_VERSION] = String(specDriverVersion);
  if (Array.isArray(frontmatterTools)) {
    out[ENV_VAR_TOOLS] = frontmatterTools.join(',');
  } else if (typeof frontmatterTools === 'string') {
    out[ENV_VAR_TOOLS] = frontmatterTools;
  }
  if (loadSource != null) out[ENV_VAR_LOAD_SOURCE] = String(loadSource);
  return out;
}

/**
 * 从 telemetry / 子进程 env 信息中读回 env-injected 元数据。
 * 输入：{ env }（通常是 sub-agent 进程的 envSnapshot 或 telemetry 字段）。
 * 不存在的字段返回 null（不是 undefined）。
 */
export function readEnvInjectedMeta({ env = process.env } = {}) {
  if (!env) return null;
  const version = env[ENV_VAR_VERSION] ?? null;
  const toolsRaw = env[ENV_VAR_TOOLS] ?? null;
  const loadSource = env[ENV_VAR_LOAD_SOURCE] ?? null;
  if (version == null && toolsRaw == null && loadSource == null) return null;
  return {
    specDriverVersion: version,
    frontmatterTools: toolsRaw ? toolsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null,
    loadSource,
  };
}

// ───────────────────────────────────────────────────────────
// 方式 B: first-tool-call self-report 解析
// ───────────────────────────────────────────────────────────

/**
 * Feature 166：从 NDJSON 格式的 sub-agent stdout 中聚合可供 self-report regex 匹配的纯文本。
 * 包含：
 *   - 所有 type:'assistant' 事件的 text / thinking content blocks（已 unescape，无 JSON-escape）
 *   - 所有 type:'user' 事件的 tool_result content（如 Read 工具回显的 plugin.json 内容）
 * 不依赖 parseClaudeStreamJson 模块（避免跨模块依赖循环）；保持轻量内联实现。
 */
function aggregateNdjsonTextForSelfReport(stdout) {
  const parts = [];
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (event.type === 'assistant') {
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text);
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          parts.push(block.thinking);
        }
      } else if (event.type === 'user') {
        if (block.type === 'tool_result') {
          // tool_result.content 可以是 string 或 Array<{type,text}>
          if (typeof block.content === 'string') {
            parts.push(block.content);
          } else if (Array.isArray(block.content)) {
            for (const sub of block.content) {
              if (sub && typeof sub.text === 'string') parts.push(sub.text);
            }
          }
        }
      }
    }
  }
  return parts.join('\n');
}

/**
 * 从 sub-agent stdout（stream-json NDJSON 或纯文本）解析 self-report。
 * 期望：
 *   sub-agent 第一个 Read 调用读 plugin.json，输出含 "version": "<x.y.z>" 的内容
 *   可选：sub-agent 复述 frontmatterTools / loadSource
 *
 * Feature 166 Codex implement review WARNING 2 修复：
 *   buildClaudeArgsWithMcp 升级到 --output-format stream-json --verbose 后，stdout 是 NDJSON 格式，
 *   plugin.json 内容会被 JSON-escape（如 `\"version\": \"4.1.0\"`），原 regex `"version":...` 命中失败。
 *   修复：检测首行是 NDJSON event → 用 parseClaudeStreamJson 提取 reasoningTrace + tool_result content
 *   作为匹配文本；否则沿用原 text 模式（向后兼容旧 fixture / 非 stream-json 路径）。
 *
 * 返回：
 *   { specDriverVersion, frontmatterTools, loadSource } 或 null（全部缺失）
 */
export function parseSubAgentSelfReport({ subAgentStdout }) {
  if (!subAgentStdout || typeof subAgentStdout !== 'string') return null;
  let text = subAgentStdout;

  // 检测 NDJSON：首个非空 trimmed 行能解析为 { type: string } event object
  const firstNonEmpty = text.split('\n').find((l) => l.trim().length > 0);
  if (firstNonEmpty) {
    try {
      const first = JSON.parse(firstNonEmpty.trim());
      if (first && typeof first === 'object' && typeof first.type === 'string') {
        // 是 NDJSON 格式：聚合 reasoningTrace + tool_result content 作为匹配文本（绕开 JSON-escape）
        text = aggregateNdjsonTextForSelfReport(subAgentStdout);
      }
    } catch {
      // 解析失败 → 按原 text 处理（pre-Feature 166 fixture / 非 stream-json 输出）
    }
  }

  // 优先尝试匹配 plugin.json 的 version 字段（被 Read 工具回显）
  let specDriverVersion = null;
  const versionJsonMatch = /"version"\s*:\s*"(\d+\.\d+\.\d+)"/.exec(text);
  if (versionJsonMatch) {
    specDriverVersion = versionJsonMatch[1];
  } else {
    // fallback：sub-agent 自然语言复述（"plugin version: 4.1.0" / "version 4.1.0"）
    const versionPlainMatch = /(?:plugin\s+)?version[:\s]+(\d+\.\d+\.\d+)/i.exec(text);
    if (versionPlainMatch) {
      specDriverVersion = versionPlainMatch[1];
    }
  }

  // 解析 sub-agent 复述（约定句式 "frontmatter-tools: a, b, c"）
  // 限制为单行匹配，避免跨行吞下后续 load-source 行
  let frontmatterTools = null;
  const toolsMatch = /frontmatter[-_]?tools\s*[:=]\s*([A-Za-z0-9_,\- \t]+)/i.exec(text);
  if (toolsMatch) {
    frontmatterTools = toolsMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // loadSource: e.g. "load-source: marketplace" / "load-source: local"
  let loadSource = null;
  const loadMatch = /load[-_]?source\s*[:=]\s*([A-Za-z0-9_\-./]+)/i.exec(text);
  if (loadMatch) {
    loadSource = loadMatch[1];
  }

  if (specDriverVersion == null && frontmatterTools == null && loadSource == null) {
    return null;
  }
  return { specDriverVersion, frontmatterTools, loadSource };
}

// ───────────────────────────────────────────────────────────
// 字段级 fallback merge（iter-4 W-8）
// ───────────────────────────────────────────────────────────

/**
 * 合并 env-injected 与 self-report meta。
 * 字段级 fallback：每字段独立优先 self-report；缺则 env；再缺则 null。
 *
 * 返回：{ meta: {specDriverVersion, frontmatterTools, loadSource, collectedVia, confidence}, collectIssues }
 */
export function mergeSubAgentMeta({ envMeta = null, selfReportMeta = null }) {
  const collectIssues = [];

  // 双源都缺 → absent
  if (!envMeta && !selfReportMeta) {
    return {
      meta: {
        specDriverVersion: null,
        frontmatterTools: null,
        loadSource: null,
        collectedVia: 'absent',
        confidence: 'absent',
      },
      collectIssues,
    };
  }

  // 字段级 fallback
  const meta = {};
  const sourceTrack = {};
  for (const f of META_FIELDS) {
    const fromSelf = selfReportMeta?.[f] ?? null;
    const fromEnv = envMeta?.[f] ?? null;
    if (fromSelf != null) {
      meta[f] = fromSelf;
      sourceTrack[f] = 'self-report';
    } else if (fromEnv != null) {
      meta[f] = fromEnv;
      sourceTrack[f] = 'env';
    } else {
      meta[f] = null;
      sourceTrack[f] = 'none';
    }
  }

  // 冲突探测：双源 version 都有但不一致 → 记 mismatch（仍取 self-report）
  if (
    envMeta?.specDriverVersion &&
    selfReportMeta?.specDriverVersion &&
    envMeta.specDriverVersion !== selfReportMeta.specDriverVersion
  ) {
    collectIssues.push({
      type: 'subAgentMeta-mismatch',
      envVersion: envMeta.specDriverVersion,
      selfReportVersion: selfReportMeta.specDriverVersion,
      chosen: 'self-report',
      reason: `版本不一致 ${envMeta.specDriverVersion} vs ${selfReportMeta.specDriverVersion}`,
    });
  }

  // confidence 状态机
  const sources = new Set(Object.values(sourceTrack).filter((s) => s !== 'none'));
  let confidence;
  let collectedVia;

  if (sources.size === 0) {
    // 双源都存在但全字段都为 null → absent
    confidence = 'absent';
    collectedVia = 'absent';
  } else if (sources.size === 1 && sources.has('self-report')) {
    // 全部字段来自 self-report
    if (envMeta) {
      // env 也存在，但 self-report 全覆盖 → 'self-report'
      confidence = 'self-report';
      collectedVia = 'first-tool-call';
      // 双源 version 一致且全部字段命中 → 'merged'
      if (
        envMeta.specDriverVersion &&
        selfReportMeta?.specDriverVersion &&
        envMeta.specDriverVersion === selfReportMeta.specDriverVersion
      ) {
        confidence = 'merged';
        collectedVia = 'merged';
      }
    } else {
      // 仅 self-report 存在
      confidence = 'self-report-only';
      collectedVia = 'first-tool-call';
    }
  } else if (sources.size === 1 && sources.has('env')) {
    confidence = 'env-only';
    collectedVia = 'env';
  } else {
    // 'self-report' + 'env' 都参与 → mixed
    confidence = 'mixed';
    collectedVia = 'first-tool-call';
  }

  return {
    meta: { ...meta, collectedVia, confidence },
    collectIssues,
  };
}

// ───────────────────────────────────────────────────────────
// inheritance_status 三状态判定（plan §2.6.2 iter-4）
// ───────────────────────────────────────────────────────────

/**
 * 推导 inheritance_status，返回 'available' / 'unavailable' / 'unknown'。
 *
 * 输入：
 *   { subAgentMeta, mcpToolCalls } — 来自 run-N.json
 *
 * 优先级：
 *   1. unavailable 信号
 *   2. available 信号
 *   3. unknown 兜底
 */
export function deriveInheritanceStatus({ subAgentMeta = null, mcpToolCalls = [] }) {
  const calls = Array.isArray(mcpToolCalls) ? mcpToolCalls : [];
  const meta = subAgentMeta;

  // 优先级 1：unavailable
  if (calls.some((c) => c && c.error === 'tool-not-available')) {
    return 'unavailable';
  }
  if (meta && meta.specDriverVersion) {
    try {
      if (compareSemver(meta.specDriverVersion, '4.1.0') < 0) {
        return 'unavailable';
      }
    } catch {
      // semver 解析失败：不视为 unavailable，继续后续判定
    }
  }

  // 优先级 2：available
  if (calls.length > 0) {
    return 'available';
  }
  if (
    meta &&
    meta.specDriverVersion &&
    meta.confidence !== 'absent'
  ) {
    try {
      if (compareSemver(meta.specDriverVersion, '4.1.0') >= 0) {
        return 'available';
      }
    } catch {
      // 解析失败 → unknown
    }
  }

  // 优先级 3：unknown
  return 'unknown';
}
