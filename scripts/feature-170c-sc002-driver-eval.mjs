#!/usr/bin/env node
/**
 * F170c SC-002 — Driver 主动调用 impact 工具率 ≥ 50% 验证
 *
 * 设计要点（按 spec US2 Active Call 4 条规则）：
 *   (a) source = tool_use（driver LLM 自发，非 protocol push）
 *   (b) prompt 文本不含 `impact` / `mcp__spectra__impact` / `mcp__plugin_spectra_spectra__impact` 字面量
 *   (c) target 非空 + 能由 workspace symbol index 成功 resolve + 非 invalid-target error
 *   (d) 同 task run 内重复调用 impact 仅计 1 次
 *
 * 执行环境：host shell + Claude Max OAuth + spectra dist/cli/index.js
 * 模型：claude-sonnet-4-6（按 plan W-2 决策固定）
 * 样本：N=5 task × N=2 repeat = 10 runs
 *
 * 用法：
 *   node scripts/feature-170c-sc002-driver-eval.mjs [--repeats N] [--out FILE]
 *
 * 输出：
 *   - JSON report：specs/170c-.../verification/sc-002-driver-eval-<timestamp>.json
 *   - 控制台总结：调用率 + Wilson 95% CI + 详细每 run 结果
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SPEC_DIR = path.join(PROJECT_ROOT, 'specs/170c-mcp-tool-description-response');
const VERIFICATION_DIR = path.join(SPEC_DIR, 'verification');
const DIST_CLI = path.join(PROJECT_ROOT, 'dist/cli/index.js');

// ============================================================
// 5 个 task prompt — 描述改动场景需要 driver 评估影响范围
// 关键约束：完全不含 `impact` / `mcp__spectra__impact` / `mcp__plugin_spectra_spectra__impact` 字面量
// 每个 target symbol 在 spectra 自身 graph 中真实存在（spectra dogfood）
// ============================================================

// 修订（响应 codex CRITICAL-1）：移除 prompt 中与 impact 工具描述强绑定的语义短语
// （"blast radius" / "spectra MCP" / "risk tier" / "reachable caller" 等），
// 让 driver 必须从工具描述自行判断该用哪个工具，而非被 prompt 形态暗示
// 修订（响应 SC-002 round 2 实测：driver 验证 prompt 假设后发现"前提有误"则放弃 impact）：
// 重写 5 个 prompt 引用真实代码细节，且改动场景在源码中可验证（避免被 driver Read/Grep 反驳）。
// 关键：prompt 提到的函数签名/返回结构/常量/分支真实存在于 src，driver 验证后会进入改动评估流程。
const TASKS = [
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
// Active Call 字面量黑名单（spec US2 (b)）
// ============================================================

const FORBIDDEN_LITERALS = [
  'impact',
  'mcp__spectra__impact',
  'mcp__plugin_spectra_spectra__impact',
];

function validatePrompts() {
  const errors = [];
  for (const task of TASKS) {
    for (const literal of FORBIDDEN_LITERALS) {
      // 用 lowercase + 边界匹配避免误判（如 `bypassPermissions` 不含独立 `impact`）
      const re = new RegExp(`\\b${literal}\\b`, 'i');
      if (re.test(task.prompt)) {
        errors.push(`${task.id} prompt 含禁止字面量 "${literal}"`);
      }
    }
  }
  return errors;
}

// ============================================================
// MCP config + spectra batch 准备
// ============================================================

function writeMcpConfig(wtDir) {
  if (!fs.existsSync(DIST_CLI)) {
    throw new Error(`[mcp-config] ${DIST_CLI} 不存在；请先 npm run build`);
  }
  const config = {
    mcpServers: {
      spectra: {
        command: 'node',
        args: [DIST_CLI, 'mcp-server'],
      },
    },
  };
  const cfgPath = path.join(wtDir, '.mcp.json');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return cfgPath;
}

function runSpectraBatch(wtDir, graphPath) {
  console.log(`[setup] 跑 spectra batch --mode code-only --full ...`);
  const r = spawnSync('node', [DIST_CLI, 'batch', '--mode', 'code-only', '--no-html', '--full'], {
    cwd: wtDir,
    encoding: 'utf-8',
    timeout: 600000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`[setup] spectra batch failed: exit=${r.status}\nstderr=${(r.stderr ?? '').slice(0, 500)}`);
  }
  if (!fs.existsSync(graphPath)) {
    throw new Error(`[setup] graph.json 未生成: ${graphPath}`);
  }
  console.log(`[setup] graph.json 生成完成 (${(fs.statSync(graphPath).size / 1024).toFixed(0)} KB)`);
}

// 修订（响应 codex WARNING-1 + bug fix: graph node id 用绝对路径）
// graph 中 node id 是 absolute path（如 `/Users/.../src/foo.ts::Bar`），
// 但 task.target 用 relative path（如 `src/foo.ts::Bar`），driver 引用时
// canonicalizeSymbolId 会做 path-suffix 解析。setup 阶段也用 endsWith 匹配。
function resolveTargetInGraph(nodeIds, target) {
  // 1. 完全匹配
  if (nodeIds.has(target)) return target;
  // 2. endsWith 匹配（abs path 节点 用 relative target 引用）
  for (const id of nodeIds) {
    if (typeof id !== 'string') continue;
    if (id.endsWith('/' + target) || id.endsWith(target)) return id;
  }
  return null;
}

function ensureGraphAndValidateTargets(wtDir) {
  const graphPath = path.join(wtDir, 'specs/_meta/graph.json');
  if (!fs.existsSync(graphPath)) {
    console.log('[setup] graph.json 不存在');
    runSpectraBatch(wtDir, graphPath);
  } else {
    console.log(`[setup] graph.json 已存在 (${(fs.statSync(graphPath).size / 1024).toFixed(0)} KB)`);
  }

  // 加载 graph 并验证 5 个 task target 全部可被 driver 引用
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
  const nodeIds = new Set();
  if (Array.isArray(graph.nodes)) {
    for (const n of graph.nodes) {
      if (typeof n.id === 'string') nodeIds.add(n.id);
    }
  }
  console.log(`[setup] graph 含 ${nodeIds.size} nodes`);

  const missingTargets = [];
  for (const task of TASKS) {
    const resolved = resolveTargetInGraph(nodeIds, task.target);
    if (resolved === null) {
      missingTargets.push(task);
    }
  }
  if (missingTargets.length > 0) {
    console.log(`[setup] ${missingTargets.length} 个 task target 不在 graph 中，尝试 rebuild graph ...`);
    runSpectraBatch(wtDir, graphPath);
    const graph2 = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    const nodeIds2 = new Set();
    if (Array.isArray(graph2.nodes)) {
      for (const n of graph2.nodes) {
        if (typeof n.id === 'string') nodeIds2.add(n.id);
      }
    }
    // 修订（响应 codex round 2 WARNING-1）：rebuild 后必须重新验证全部 5 个 task target
    const stillMissing = [];
    for (const task of TASKS) {
      if (resolveTargetInGraph(nodeIds2, task.target) === null) stillMissing.push(task);
    }
    if (stillMissing.length > 0) {
      throw new Error(
        `[setup] task target 在 graph 中不存在（即使 rebuild 之后）：\n${stillMissing.map((t) => `  - ${t.id}: ${t.target}`).join('\n')}\n` +
          `请检查 src/ 实际 symbol 名是否变更，或 graph 生成是否正常`,
      );
    }
  }
  console.log(`[setup] 5 个 task target 全部在 graph 中验证通过（endsWith 匹配）`);
  return graphPath;
}

// ============================================================
// claude --print harness
// ============================================================

// 关键 fix：claude CLI 的 `--allowedTools` 是 variadic，会吞掉后面的 prompt argument。
// 解决方式：prompt 通过 stdin 传入，args 中不放 prompt（避免被任何 flag 吸收）。
function buildClaudeArgs(wtDir) {
  return [
    '--print',
    '--model', 'claude-sonnet-4-6',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--mcp-config', path.join(wtDir, '.mcp.json'),
    '--allowedTools', 'mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob',
  ];
}

function spawnClaude(prompt, wtDir, timeoutMs = 300000) {
  const args = buildClaudeArgs(wtDir);
  const env = { ...process.env };
  if (env.ANTHROPIC_API_KEY === '') delete env.ANTHROPIC_API_KEY;
  const start = Date.now();
  const r = spawnSync('claude', args, {
    cwd: wtDir,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    input: prompt, // 通过 stdin 传 prompt，避免被 --allowedTools variadic 吞掉
    env,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    durationMs: Date.now() - start,
    error: r.error ? String(r.error) : null,
  };
}

// ============================================================
// stream-json parser — 提取 mcp__spectra__impact 的 active call 记录
// ============================================================

function parseRun(stdout, taskPrompt) {
  const lines = stdout.split('\n');
  // 记录 impact tool_use events + 对应 tool_result（用于判定 (c) target resolve 成功）
  const impactCalls = [];
  const toolResultsById = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(trimmed); } catch { continue; }

    // assistant turn 中的 tool_use blocks
    if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
      const content = evt.message?.content || [];
      for (const block of content) {
        if (block?.type !== 'tool_use') continue;
        if (typeof block.name !== 'string') continue;
        // 匹配 mcp__spectra__impact 或 mcp__plugin_spectra_spectra__impact 等带后缀的 impact 调用
        const isImpactCall = /^mcp__[a-z_]*spectra(?:_spectra)?__impact$/.test(block.name);
        if (!isImpactCall) continue;
        impactCalls.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
          // source = 'tool_use' 已通过类型保证（块类型即 source 信号）
        });
      }
    }
    // user turn 中的 tool_result blocks
    if (evt.type === 'user' && Array.isArray(evt.message?.content)) {
      for (const block of evt.message.content) {
        if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
        toolResultsById.set(block.tool_use_id, {
          isError: block.is_error === true,
          content: block.content,
        });
      }
    }
  }

  // 按 Active Call 4 规则判定（修订：响应 codex CRITICAL-2 — 严格 tool_result 校验）
  const distinctCallsForRule = new Set(); // (d) 重复仅计 1 次（按 target 区分）
  const nonCompliantReasons = [];
  let activeCallCount = 0;

  for (const call of impactCalls) {
    // (a) source = tool_use → 通过 block 类型已保证（stream-json 中 tool_use 块即 driver 主动）
    // (b) prompt 不含字面量 → 全局 validatePrompts() 已在跑前验证
    // (c) target 非空 + tool_result 存在 + 成功 envelope + 含 impact success 字段
    const target = call.input?.target;
    if (typeof target !== 'string' || target.length === 0) {
      nonCompliantReasons.push({ id: call.id, reason: 'target 为空或非字符串' });
      continue;
    }
    const result = toolResultsById.get(call.id);
    if (result === undefined) {
      // (c) 严格：tool_result 必须存在；缺失视为 stdout 截断/超时/丢失，不算合规
      nonCompliantReasons.push({ id: call.id, target, reason: 'tool_result 缺失（stdout 截断或超时）' });
      continue;
    }
    if (result.isError === true) {
      nonCompliantReasons.push({ id: call.id, target, reason: 'handler error response (isError=true)' });
      continue;
    }
    // 必须能解析 tool_result content；解析失败视为不合规（不放过）
    let resultPayload = null;
    let parseError = null;
    try {
      const contentStr = Array.isArray(result.content)
        ? result.content.map((c) => c.text || '').join('')
        : (typeof result.content === 'string' ? result.content : '');
      if (!contentStr) {
        parseError = 'tool_result content 为空';
      } else {
        const jsonStart = contentStr.indexOf('{');
        if (jsonStart < 0) {
          parseError = 'tool_result content 无 JSON 起始 { 字符';
        } else {
          resultPayload = JSON.parse(contentStr.slice(jsonStart));
        }
      }
    } catch (e) {
      parseError = `tool_result JSON 解析失败: ${e.message}`;
    }
    if (parseError !== null) {
      nonCompliantReasons.push({ id: call.id, target, reason: parseError });
      continue;
    }
    // 拒绝任何 error envelope（含 code 字段；修订响应 codex round 2 CRITICAL-2：用 'in' 而非 typeof 字符串，
    // 避免 code:null / code:0 / code:undefined 绕过）
    if (resultPayload !== null && typeof resultPayload === 'object' && 'code' in resultPayload) {
      nonCompliantReasons.push({ id: call.id, target, reason: `error envelope: code field present (=${JSON.stringify(resultPayload.code)})` });
      continue;
    }
    // 校验 impact success path 关键字段（spec FR-006/007 + Tool×Path 矩阵）：
    //   - affected 数组
    //   - summary 对象（含 directCallers/transitive/riskTier）
    //   - effectiveDirection
    //   - topImpacted 数组（F170c GREEN 新增；producer success path MUST 总是产出）
    //   - nextStepHint 字符串（producer 合同：success ≥ 5 字符）
    const missingFields = [];
    if (!Array.isArray(resultPayload.affected)) missingFields.push('affected');
    if (typeof resultPayload.summary !== 'object' || resultPayload.summary === null) missingFields.push('summary');
    if (typeof resultPayload.effectiveDirection !== 'string') missingFields.push('effectiveDirection');
    if (!Array.isArray(resultPayload.topImpacted)) missingFields.push('topImpacted');
    if (typeof resultPayload.nextStepHint !== 'string') missingFields.push('nextStepHint');
    if (missingFields.length > 0) {
      nonCompliantReasons.push({
        id: call.id,
        target,
        reason: `impact success response 缺关键字段: ${missingFields.join(',')}`,
      });
      continue;
    }
    // (d) 重复仅 1 次：按 target 去重
    if (distinctCallsForRule.has(target)) {
      continue;
    }
    distinctCallsForRule.add(target);
    activeCallCount++;
  }

  return {
    totalImpactCalls: impactCalls.length,
    distinctActiveCallCount: activeCallCount,
    isCompliant: activeCallCount >= 1, // 本 run 至少有 1 个合规 active call 即视为"主动调用过 impact"
    nonCompliantReasons,
  };
}

// ============================================================
// Wilson score 95% CI
// ============================================================

function wilsonCI(successCount, totalCount, z = 1.96) {
  if (totalCount === 0) return { lower: 0, upper: 1, point: 0 };
  const p = successCount / totalCount;
  const denominator = 1 + (z * z) / totalCount;
  const center = p + (z * z) / (2 * totalCount);
  const margin = z * Math.sqrt((p * (1 - p) / totalCount) + (z * z) / (4 * totalCount * totalCount));
  return {
    point: p,
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

// ============================================================
// 主流程
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  let repeats = 2;
  let outFile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repeats') repeats = parseInt(args[++i], 10);
    else if (args[i] === '--out') outFile = args[++i];
  }
  return { repeats, outFile };
}

async function main() {
  const { repeats, outFile } = parseArgs();
  const wtDir = PROJECT_ROOT;

  console.log('=== F170c SC-002 Driver E2E ===');
  console.log(`Project root: ${wtDir}`);
  console.log(`Tasks: ${TASKS.length}, Repeats: ${repeats}, Total runs: ${TASKS.length * repeats}`);
  console.log('');

  // 0. 验证 prompts 不含禁止字面量
  const promptErrors = validatePrompts();
  if (promptErrors.length > 0) {
    console.error('[FATAL] prompt validation failed:');
    promptErrors.forEach((e) => console.error(`  - ${e}`));
    process.exit(2); // 修订（响应 codex WARNING-2）：harness/setup fatal = exit(2)
  }
  console.log('[setup] prompts 通过禁止字面量验证 (a)/(b)');

  // 1. 写 .mcp.json + 确保 graph.json 存在 + 验证 5 个 target 全部 resolve
  writeMcpConfig(wtDir);
  console.log('[setup] .mcp.json 写入完成');
  ensureGraphAndValidateTargets(wtDir);

  // 2. 跑 N=tasks × repeats
  const runs = [];
  let runIndex = 0;
  const totalRuns = TASKS.length * repeats;

  for (let r = 0; r < repeats; r++) {
    for (const task of TASKS) {
      runIndex++;
      console.log(`\n[run ${runIndex}/${totalRuns}] task=${task.id} repeat=${r + 1}`);
      const result = spawnClaude(task.prompt, wtDir);
      console.log(`  duration: ${(result.durationMs / 1000).toFixed(1)}s, exit=${result.status}, stdout=${(result.stdout.length / 1024).toFixed(1)}KB`);
      // 修订（响应 codex round 2 WARNING-2）：claude 失败 + stdout 空 → harness fatal (exit 2)，
      // 不应误判为 SC primary fail (exit 1)
      if (result.error !== null) {
        throw new Error(`[harness-fatal] claude spawn error: ${result.error}`);
      }
      if (result.status !== 0 && result.stdout.trim() === '') {
        throw new Error(
          `[harness-fatal] claude exit=${result.status} 且 stdout 空（可能 OAuth/timeout/missing-binary）;` +
            ` stderr (head): ${result.stderr.slice(0, 300)}`,
        );
      }
      if (result.status !== 0) {
        console.warn(`  ⚠️ claude exit != 0 但 stdout 非空，继续解析；stderr (head): ${result.stderr.slice(0, 200)}`);
      }
      const parsed = parseRun(result.stdout, task.prompt);
      console.log(`  impact calls: total=${parsed.totalImpactCalls}, active=${parsed.distinctActiveCallCount}, compliant=${parsed.isCompliant ? '✅' : '❌'}`);
      if (parsed.nonCompliantReasons.length > 0) {
        console.log(`  non-compliant reasons: ${JSON.stringify(parsed.nonCompliantReasons)}`);
      }
      runs.push({
        runIndex,
        taskId: task.id,
        target: task.target,
        repeat: r + 1,
        durationMs: result.durationMs,
        claudeExitStatus: result.status,
        claudeError: result.error,
        ...parsed,
      });
    }
  }

  // 3. 统计 + Wilson CI
  const compliantRuns = runs.filter((r) => r.isCompliant).length;
  const ci = wilsonCI(compliantRuns, totalRuns);

  console.log('\n=== 总结 ===');
  console.log(`合规 active call runs: ${compliantRuns}/${totalRuns} (${(ci.point * 100).toFixed(1)}%)`);
  console.log(`Wilson 95% CI: [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);
  console.log(`SC-002 Primary (≥ 50%) 判定: ${ci.point >= 0.5 ? '✅ PASS' : '❌ FAIL'}`);
  if (ci.point < 0.5 && ci.point >= 0.25) {
    console.log(`Secondary (25%-50%) Limitation Record: ⚠️ DEGRADED — primary outcome not met`);
  } else if (ci.point < 0.25) {
    console.log(`Below secondary (< 25%): 🚨 description 升级未达预期，建议回归调整或追加 description 优化`);
  }

  // 4. 写 report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = outFile || path.join(VERIFICATION_DIR, `sc-002-driver-eval-${timestamp}.json`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const report = {
    feature: 'F170c',
    scenario: 'SC-002',
    timestamp: new Date().toISOString(),
    config: {
      driverModel: 'claude-sonnet-4-6',
      tasks: TASKS.length,
      repeats,
      totalRuns,
      mcpServerCommand: `node ${DIST_CLI} mcp-server`,
      allowedTools: 'mcp__spectra__impact,mcp__spectra__context,mcp__spectra__detect_changes,Read,Grep,Glob',
    },
    summary: {
      compliantRuns,
      totalRuns,
      complianceRate: ci.point,
      wilsonCI: { lower: ci.lower, upper: ci.upper, level: 0.95 },
      primaryPassGate: ci.point >= 0.5,
      degraded: ci.point >= 0.25 && ci.point < 0.5,
    },
    runs,
  };
  // 修订（响应 codex WARNING-2）：约定 exit code 三级语义
  //   0 = harness 完成 + SC-002 primary 达标 (≥ 50%)
  //   1 = harness 完成 + SC-002 primary 未达标（含 degraded 25%-50% 和 < 25%）
  //   2 = harness/setup/config fatal error（无法判定 SC 结果）
  report.summary.outcomeType = ci.point >= 0.5
    ? 'primary-pass'
    : ci.point >= 0.25 ? 'degraded' : 'below-secondary';
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  console.log(`\nReport written: ${reportFile}`);
  console.log(`outcomeType: ${report.summary.outcomeType}`);

  process.exit(ci.point >= 0.5 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(2);
});
