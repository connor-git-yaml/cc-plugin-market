#!/usr/bin/env node
/**
 * Feature 147 Sprint 1 — Cross-LLM Jury（去 self-judge bias 的机器版"双盲"）
 *
 * 多个不同 LLM 独立评同一份 fixture，匿名化工具身份 + 对抗性 prompt（要求找问题）。
 * 取代 single self-judge 模式，让评分有 inter-rater agreement 信号。
 *
 * 用法：
 *   ANTHROPIC_API_KEY=sk-... node scripts/eval-judge-jury.mjs --fixture <path>
 *   node scripts/eval-judge-jury.mjs --task T1-... --tool spec-driver
 *   node scripts/eval-judge-jury.mjs --all
 *   node scripts/eval-judge-jury.mjs --judges claude-sonnet-4-6,claude-opus-4-7
 *   node scripts/eval-judge-jury.mjs --dry-run                         # mock score 不调 LLM
 *
 * 写回 fixture.taskExecution:
 *   juryScores: [{judge, score, rationale, issues}], juryMedian, juryMean, jurySpread,
 *   juryRunAt, juryAnonymized, juryAdversarial
 *
 * Cost (real run): ~$0.05 per judge per fixture; 2 judges × 30 fixture ≈ $3
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { anonymizeFixture } from './eval-judge.mjs';
// Feature 162 (T016 + T018)：共享 backend 语义（normalize / alias / self-judge hard-fail）
//   已迁移至 scripts/lib/llm-backend-dispatcher.mjs。jury 仍保留本地 defaultClientFactory
//   实现 anthropic SDK 路径（dispatcher 4 backend 不含原生 anthropic SDK），4 backend 公共
//   决策点改用共享 dispatcher。
import { assertNoSelfJudge } from './lib/llm-backend-dispatcher.mjs';
// Feature 162 Phase B2 (C-4 修复)：buildAdversarialPrompt 抽到共享模块，
// 让 calibration runner 与生产 jury 使用同一份 prompt，避免漂移
import { buildAdversarialPrompt as buildAdversarialPromptShared } from './lib/judge-prompt-builder.mjs';
// Feature 176：task fixture 多目录查找与 runner 同源（Verified fixture 不在 147 单目录）
import { TASK_FIXTURE_DIRS as RUNNER_TASK_FIXTURE_DIRS } from './eval-task-runner.mjs';

// ============================================================
// async spawn helper (for true parallelism with subprocess CLI calls)
// ============================================================

export function spawnAsync(cmd, args, { timeoutMs = 180000, stdin = null } = {}) {
  return new Promise((resolve) => {
    // 关键：stdio[0]='ignore' 防止 child process 卡死等 stdin（除非显式提供 stdin）
    const stdio = stdin != null ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const proc = spawn(cmd, args, { stdio });
    let stdout = '';
    let stderr = '';
    let killed = false;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    const t = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      clearTimeout(t);
      resolve({ status: code, stdout, stderr, killed });
    });
    proc.on('error', (err) => {
      clearTimeout(t);
      resolve({ status: -1, stdout, stderr: stderr + '\n' + err.message, killed, spawnError: err.message });
    });
    if (stdin != null && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_FIXTURES_DIR = path.join(PROJECT_ROOT, 'specs/147-competitor-evaluation-platform/research/task-fixtures');
const FIXTURES_ROOT = path.join(PROJECT_ROOT, 'tests/baseline/tasks');

// 默认 3 vendor 跨国家 cross-LLM jury（去 self-judge bias + 跨 vendor systemic bias）
// 'siliconflow:<model>' → SiliconFlow OpenAI-compat (https://api.siliconflow.cn/v1)
// 'openai:<model>'      → 原生 OpenAI SDK
// 'claude-cli:<model>'  → Claude CLI 子进程 (Anthropic, 用 subscription / OAuth)
// 'codex:<model>'       → Codex CLI 子进程 (OpenAI GPT-5.5, ChatGPT subscription)
// 'claude-*'            → Anthropic SDK (legacy, 需 ANTHROPIC_API_KEY)
//
// Feature 162 Phase B1（T031/T032）：default driver 已切换为 codex:gpt-5.5（DEFAULT_EXECUTOR_MODEL），
// 因此 jury 不能含 GPT-5.5（self-judge 禁忌，FR-027 + assertNoSelfJudge 启动即 hard-fail）。
// 替换 codex:gpt-5.5 → siliconflow:Pro/zai-org/GLM-5.1：
//   - GLM-5.1 与原 codex 互为对端 vendor（OpenAI 美国 vs Zhipu 中国），保留跨国家分布
//   - Phase B2 calibration 验证 GLM judge IoU ≥ 0.7 + Pearson ≥ 0.6（plan §0.1，5 fixture × 3 runs = 15 数据点）
//   - 详见 spec.md FR-020 / FR-021 + plan.md §2.5 B1
// 3 vendor 跨国家：Anthropic (US) + Zhipu (China) + Moonshot (China)
export const DEFAULT_JUDGES = [
  'claude-cli:claude-opus-4-7',                // Anthropic Opus 4.7 (美国, Claude Max subscription)
  'siliconflow:Pro/zai-org/GLM-5.1',           // Zhipu GLM-5.1 (中国, SiliconFlow API) — replaces codex:gpt-5.5 (Phase B1 T031)
  'siliconflow:Pro/moonshotai/Kimi-K2.6',      // Moonshot Kimi K2.6 (中国, SiliconFlow API)
];
const MAX_DIFF_BYTES = 30000;
const SILICONFLOW_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';

// ============================================================
// Backend dispatcher（解析 judge 名 → 选 SDK + endpoint + key）
// ============================================================

export function parseJudgeBackend(judgeModel) {
  if (judgeModel.startsWith('siliconflow:')) {
    return {
      provider: 'openai-compat',
      vendor: 'siliconflow',
      model: judgeModel.slice('siliconflow:'.length),
      baseURL: process.env.SILICONFLOW_BASE_URL ?? SILICONFLOW_DEFAULT_BASE_URL,
      apiKeyEnv: 'SILICONFLOW_API_KEY',
    };
  }
  if (judgeModel.startsWith('openai:')) {
    return {
      provider: 'openai-compat',
      vendor: 'openai',
      model: judgeModel.slice('openai:'.length),
      baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
    };
  }
  if (judgeModel.startsWith('claude-cli:')) {
    return {
      provider: 'claude-cli',
      vendor: 'anthropic',
      model: judgeModel.slice('claude-cli:'.length),
      baseURL: null,
      apiKeyEnv: null, // CLI uses subscription / OAuth, no API key needed
    };
  }
  if (judgeModel.startsWith('codex:')) {
    return {
      provider: 'codex-cli',
      vendor: 'openai',
      model: judgeModel.slice('codex:'.length),
      baseURL: null,
      apiKeyEnv: null, // CLI uses ChatGPT subscription
    };
  }
  // 默认：Anthropic native SDK（claude-* 模型，需 ANTHROPIC_API_KEY）
  return {
    provider: 'anthropic',
    vendor: 'anthropic',
    model: judgeModel,
    baseURL: null,
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  };
}

// ============================================================
// argv
// ============================================================

export function parseArgs(argv) {
  const args = {
    fixture: null,
    task: null,
    tool: null,
    all: false,
    judges: DEFAULT_JUDGES,
    dryRun: false,
    maxDiffBytes: MAX_DIFF_BYTES,
    concurrency: 3,
    vendorConcurrency: 4, // 单 vendor 同时最多 in-flight LLM 调用数（防 SiliconFlow rate limit）
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--fixture': args.fixture = argv[++i]; break;
      case '--task': args.task = argv[++i]; break;
      case '--tool': args.tool = argv[++i]; break;
      case '--all': args.all = true; break;
      case '--judges': args.judges = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--dry-run': args.dryRun = true; break;
      case '--max-diff-bytes': args.maxDiffBytes = Number(argv[++i]); break;
      case '--concurrency': args.concurrency = Number(argv[++i]); break;
      case '--vendor-concurrency': args.vendorConcurrency = Number(argv[++i]); break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.fixture && !(args.task && args.tool) && !args.all) {
    throw new Error('--fixture <path> or (--task <id> --tool <name>) or --all required');
  }
  if (args.judges.length === 0) throw new Error('--judges must include at least 1 model');
  if (args.concurrency < 1) throw new Error('--concurrency must be >= 1');
  if (args.vendorConcurrency < 1) throw new Error('--vendor-concurrency must be >= 1');
  return args;
}

// ============================================================
// Diff 提取 + 匿名化
// ============================================================

export function extractDiff({ wtDir, fallbackDiffStat, maxBytes }) {
  let diff;
  if (wtDir && fs.existsSync(wtDir)) {
    // Try HEAD~1 first, fallback to all commits ahead of master
    const r1 = spawnSync('git', ['-C', wtDir, 'diff', 'HEAD~1..HEAD'], { encoding: 'utf-8' });
    if (r1.status === 0 && r1.stdout) {
      diff = r1.stdout;
    } else {
      const r2 = spawnSync('git', ['-C', wtDir, 'diff', 'master..HEAD'], { encoding: 'utf-8' });
      diff = r2.status === 0 ? r2.stdout : (fallbackDiffStat ?? '(no diff available)');
    }
  } else {
    diff = fallbackDiffStat ?? '(no diff available; worktree no longer exists)';
  }
  if (diff.length > maxBytes) {
    diff = diff.slice(0, maxBytes) + `\n... (truncated, original ${diff.length} bytes)`;
  }
  return diff;
}

// Defense-in-depth: 即使 reverseMap 没含某 tool 名，也 strip 已知工具家族标识
// (与 eval-judge.mjs:60 TOOL_NAMES 保持同步)
const KNOWN_TOOL_NAMES = [
  'spec-driver-spectra', 'spec-driver-opus', 'spec-driver',
  'superpowers', 'gstack', 'spectra', 'graphify',
  'aider-repomap', 'aider', 'cody', 'control',
];

export function anonymizeDiff(diff, reverseMap) {
  let result = diff;
  // 1. 用 fixture 解析出的 reverseMap 替换（精确匹配真实工具值，但要 word-boundary）
  // 关键：'control' 等通用词不能拆 'uncontrolled' / 'controller'。用 lookahead/behind 限定边界。
  for (const [_anonName, real] of reverseMap.entries()) {
    if (typeof real !== 'string' || real.length < 3) continue;
    // 长 token (含 '-' 或长度 > 8) 用全局替换；通用短词加 word-boundary
    if (real.includes('-') || real.length > 8) {
      result = result.split(real).join('<TOOL>');
    } else {
      const re = new RegExp(`(?<![A-Za-z])${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'g');
      result = result.replace(re, '<TOOL>');
    }
  }
  // 2. Defense-in-depth: 用 KNOWN_TOOL_NAMES 兜底，按长度降序，short names 用 word-boundary
  const sorted = [...KNOWN_TOOL_NAMES].sort((a, b) => b.length - a.length);
  for (const tool of sorted) {
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (tool.includes('-') || tool.length > 8) {
      result = result.replace(new RegExp(escaped, 'gi'), '<TOOL>');
    } else {
      // 短通用词如 'control' / 'aider' / 'cody' / 'spectra' / 'gstack' → 加 word-boundary
      result = result.replace(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'gi'), '<TOOL>');
    }
  }
  return result;
}

// ============================================================
// Adversarial prompt
// ============================================================

// buildAdversarialPrompt 已抽到 scripts/lib/judge-prompt-builder.mjs (Feature 162 C-4)
// 此处保持 export 同名符号，向后兼容现有 caller / unit test
export const buildAdversarialPrompt = buildAdversarialPromptShared;

// ============================================================
// Multi-backend client（adapter pattern：anthropic + openai-compat 统一接口）
// ============================================================

/**
 * Default factory: 解析 judgeModel → 实例化对应 SDK adapter，返回统一 invoke() 接口的 client。
 * Tests 注入 mock factory 返回 { invoke } 即可，无需 mock 各 SDK 内部 shape。
 */
export async function defaultClientFactory(judgeModel) {
  const backend = parseJudgeBackend(judgeModel);
  // CLI backends (claude-cli / codex-cli) 用 subscription，不需要 API key
  const apiKey = backend.apiKeyEnv ? process.env[backend.apiKeyEnv] : null;
  if (backend.apiKeyEnv && !apiKey) {
    throw new Error(`${backend.apiKeyEnv} env not set (required for ${backend.vendor}); export it or use --dry-run`);
  }
  if (backend.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const sdk = new Anthropic({ apiKey, timeout: 120000 });
    return {
      backend,
      invoke: async (prompt) => {
        const r = await sdk.messages.create({
          model: backend.model,
          max_tokens: 4000,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }],
        });
        const text = (r.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const stopReason = r.stop_reason ?? null;
        return {
          text,
          promptTokens: r.usage?.input_tokens ?? null,
          completionTokens: r.usage?.output_tokens ?? null,
          finishReason: stopReason,
          truncated: stopReason === 'max_tokens',
        };
      },
    };
  }
  if (backend.provider === 'claude-cli') {
    // Claude Code CLI 子进程（用 subscription/OAuth，无 API key）
    return {
      backend,
      invoke: async (prompt) => {
        // --output-format json 返回结构化 wrapper：{ result, usage, stop_reason, total_cost_usd }
        const r = await spawnAsync('claude',
          ['--print', '--model', backend.model, '--output-format', 'json',
           '--permission-mode', 'plan', prompt],
          { timeoutMs: 180000 });
        if (r.status !== 0 || r.killed) {
          throw new Error(`claude CLI failed (status=${r.status}, killed=${r.killed}): ${(r.stderr || '').slice(0, 300)}`);
        }
        let parsed;
        try { parsed = JSON.parse(r.stdout); }
        catch (e) { throw new Error(`claude CLI returned non-JSON: ${r.stdout.slice(0, 200)}`); }
        const stopReason = parsed.stop_reason ?? null;
        return {
          text: parsed.result ?? '',
          promptTokens: parsed.usage?.input_tokens ?? null,
          completionTokens: parsed.usage?.output_tokens ?? null,
          finishReason: stopReason,
          truncated: stopReason === 'max_tokens',
          costUsd: parsed.total_cost_usd ?? null,
        };
      },
    };
  }
  if (backend.provider === 'codex-cli') {
    // Codex CLI 子进程（用 ChatGPT subscription，无 API key）
    return {
      backend,
      invoke: async (prompt) => {
        const tmpFile = path.join(os.tmpdir(), `codex-out-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
        try {
          // 覆盖 ~/.codex/config.toml 的 reasoning_effort（默认 xhigh 吃 quota 太狠）
          // 用 high 平衡评分质量 + 周配额（xhigh 比 high 多 ~3-5x token 消耗）
          const r = await spawnAsync('codex',
            ['exec', '--skip-git-repo-check', '--sandbox', 'read-only',
             '-c', 'model_reasoning_effort="high"',
             '-m', backend.model, '--output-last-message', tmpFile, prompt],
            { timeoutMs: 300000 });
          if (r.killed) throw new Error(`codex CLI timed out after 240s`);
          let text = '';
          if (fs.existsSync(tmpFile)) {
            text = fs.readFileSync(tmpFile, 'utf-8');
          } else {
            text = r.stdout ?? '';
          }
          // Tokens 从 stderr 提取: "tokens used\n20,428"
          const tokenMatch = (r.stderr ?? '').match(/tokens used\s*\n\s*([\d,]+)/);
          const totalTokens = tokenMatch ? Number(tokenMatch[1].replace(/,/g, '')) : null;
          return {
            text,
            promptTokens: null,         // Codex 不区分 input/output，只给 total
            completionTokens: totalTokens, // 全部记 completion，避免 jury cost 估算偏低
            finishReason: r.status === 0 ? 'stop' : 'error',
            truncated: false,
          };
        } finally {
          if (fs.existsSync(tmpFile)) {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
          }
        }
      },
    };
  }
  // OpenAI-compat (SiliconFlow + native OpenAI 共用)
  const { default: OpenAI } = await import('openai');
  const sdk = new OpenAI({ apiKey, baseURL: backend.baseURL, timeout: 120000 });
  return {
    backend,
    invoke: async (prompt) => {
      const r = await sdk.chat.completions.create({
        model: backend.model,
        max_tokens: 4000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      });
      const choice = r.choices?.[0];
      const finishReason = choice?.finish_reason ?? null;
      return {
        text: choice?.message?.content ?? '',
        promptTokens: r.usage?.prompt_tokens ?? null,
        completionTokens: r.usage?.completion_tokens ?? null,
        finishReason,
        truncated: finishReason === 'length',
      };
    },
  };
}

/**
 * Normalize SDK errors to capture status / type / retry-after info（不只是 message）
 * Anthropic: { status, headers, type } via APIError; OpenAI: { status, code, type, headers }
 */
export function normalizeSdkError(e) {
  if (!e || typeof e !== 'object') return { message: String(e) };
  const status = e.status ?? e.response?.status ?? null;
  const code = e.code ?? null;
  const type = e.type ?? e.error?.type ?? null;
  const requestId = e.request_id ?? e.requestID ?? e.headers?.['request-id'] ?? null;
  const retryAfter = e.headers?.['retry-after'] ?? e.response?.headers?.get?.('retry-after') ?? null;
  return {
    message: e.message ?? String(e),
    status,
    code,
    type,
    requestId,
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null,
    isRateLimit: status === 429,
    isServerError: typeof status === 'number' && status >= 500,
  };
}

export function parseJudgeJson(text) {
  // Path 1: 标准 JSON parse（首选）
  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const objMatch = candidate.match(/\{[\s\S]*\}/);
  if (!objMatch) throw new Error('no JSON object in response');
  try {
    const obj = JSON.parse(objMatch[0]);
    const score = typeof obj.score === 'number' ? obj.score : Number(obj.score);
    if (Number.isNaN(score)) throw new Error('score field missing or non-numeric');
    return {
      score,
      rationale: String(obj.rationale ?? ''),
      issues: Array.isArray(obj.issues) ? obj.issues.map(String) : [],
    };
  } catch (jsonErr) {
    // Path 2: JSON 失败时（GLM-5.1 等模型偶发 rationale 字符串内有未转义引号），
    // 用 regex 抽取 score（必需）+ rationale + issues（best-effort）
    // 关键：tight match — 只识别 top-level "score" 键（紧跟 { 或 , 之后，不在 string value 内），
    // 避免误匹配 rationale 字符串里出现的 "score: 0 不合理" 等字眼
    const scoreMatch = objMatch[0].match(/(?:^\s*\{|[,{])\s*"score"\s*:\s*(\d+(?:\.\d+)?)/);
    if (!scoreMatch) throw jsonErr; // 连 score 都提不出，真没救，抛原 JSON 错
    const rationaleMatch = objMatch[0].match(/(?:^\s*\{|[,{])\s*"rationale"\s*:\s*"((?:[^"\\]|\\.)*?)(?:"\s*[,}])/);
    const rationale = rationaleMatch ? rationaleMatch[1].replace(/\\(.)/g, '$1') : '[parse-recovered: rationale extraction failed]';
    return {
      score: Number(scoreMatch[1]),
      rationale,
      issues: [`[parse-recovered: original JSON malformed, score extracted via top-level regex; jsonErr=${jsonErr.message.slice(0, 60)}]`],
    };
  }
}

export async function callJudgeViaSdk({ model, prompt, clientFactory = defaultClientFactory }) {
  const client = await clientFactory(model);
  const invokeResult = await client.invoke(prompt);
  const { text, promptTokens, completionTokens, finishReason, truncated } = invokeResult;
  let parsed;
  try {
    parsed = parseJudgeJson(text);
  } catch (e) {
    return {
      judge: model,
      vendor: client.backend?.vendor ?? null,
      score: null,
      rationale: `[parse error: ${e.message}${truncated ? ' | truncated=true (max_tokens hit)' : ''}]`,
      issues: [],
      judgedAt: new Date().toISOString(),
      promptTokens,
      completionTokens,
      finishReason: finishReason ?? null,
      truncated: truncated ?? false,
      rawText: text.slice(0, 500),
    };
  }
  return {
    judge: model,
    vendor: client.backend?.vendor ?? null,
    score: parsed.score,
    rationale: parsed.rationale,
    issues: parsed.issues,
    judgedAt: new Date().toISOString(),
    promptTokens,
    completionTokens,
    finishReason: finishReason ?? null,
    truncated: truncated ?? false,
  };
}

// ============================================================
// Aggregation
// ============================================================

export function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function aggregateJury(scores) {
  const valid = scores.filter((s) => s != null && !Number.isNaN(s));
  if (valid.length === 0) {
    return { juryMedian: null, juryMean: null, jurySpread: null, juryAgreement: 'no-data' };
  }
  const med = median(valid);
  const mean = Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
  const spread = Math.max(...valid) - Math.min(...valid);
  let agreement;
  if (valid.length < 2) agreement = 'single-judge';
  else if (spread <= 1) agreement = 'high';
  else if (spread <= 2) agreement = 'medium';
  else agreement = 'low';
  return { juryMedian: med, juryMean: mean, jurySpread: spread, juryAgreement: agreement };
}

// ============================================================
// 主流程
// ============================================================

export async function runJuryOnFixture({
  fixturePath,
  judges = DEFAULT_JUDGES,
  dryRun = false,
  clientFactory,
  taskFixturesDir = TASK_FIXTURES_DIR,
  maxDiffBytes = MAX_DIFF_BYTES,
  vendorLimit, // optional Map<vendor, pLimit fn>，从 main 注入避免重复构造
}) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const taskId = fixture.taskExecution?.taskId ?? fixture.meta?.taskId;
  if (!taskId) throw new Error(`fixture ${fixturePath} has no taskId`);

  // Feature 176：多目录查找（与 runner TASK_FIXTURE_DIRS 同源）——Verified task 定义在
  // tests/baseline/swe-bench-verified/fixtures/，原单目录写死会 throw。显式传入非默认
  // taskFixturesDir 时尊重单目录（保持既有调用方/测试合同）。
  const candidateDirs = taskFixturesDir !== TASK_FIXTURES_DIR ? [taskFixturesDir] : RUNNER_TASK_FIXTURE_DIRS;
  const taskFixturePath = candidateDirs.map((d) => path.join(d, `${taskId}.json`)).find((p) => fs.existsSync(p));
  if (!taskFixturePath) {
    throw new Error(`task fixture not found in any of: ${candidateDirs.map((d) => path.join(d, taskId + '.json')).join(', ')}`);
  }
  const taskFx = JSON.parse(fs.readFileSync(taskFixturePath, 'utf-8'));

  const wtDir = fixture.meta?.outputDir;
  const rawDiff = extractDiff({ wtDir, fallbackDiffStat: fixture.taskExecution?.diffStat, maxBytes: maxDiffBytes });
  const { reverseMap } = anonymizeFixture(fixture);
  const anonymizedDiff = anonymizeDiff(rawDiff, reverseMap);

  const prompt = buildAdversarialPrompt({ taskPrompt: taskFx.prompt, diff: anonymizedDiff });

  // 并发跑 judges（fixture 内部 N judges 并行；fixture 之间仍 sequential 限速避免 rate limit）
  const juryScoresPromises = judges.map(async (judge) => {
    if (dryRun) {
      return {
        judge,
        score: 7,
        rationale: '[dry-run mock score; no LLM called]',
        issues: ['[dry-run] mock issue 1', '[dry-run] mock issue 2'],
        judgedAt: new Date().toISOString(),
        promptTokens: null,
        completionTokens: null,
      };
    }
    // 用 per-vendor limiter 包裹 (防 SiliconFlow rate limit)
    const { vendor } = parseJudgeBackend(judge);
    const limit = vendorLimit?.get(vendor) ?? ((fn) => fn());
    return limit(async () => {
      try {
        const r = await callJudgeViaSdk({ model: judge, prompt, clientFactory });
        console.error(`[jury] ${judge}: score=${r.score}${r.truncated ? ' (TRUNCATED!)' : ''}`);
        return r;
      } catch (e) {
        const ne = normalizeSdkError(e);
        console.error(`[jury] ${judge} FAILED: ${ne.message}${ne.status ? ` [HTTP ${ne.status}]` : ''}${ne.isRateLimit ? ' [RATE_LIMIT]' : ''}`);
        return {
          judge,
          score: null,
          rationale: `[error: ${ne.message}]`,
          issues: [],
          judgedAt: new Date().toISOString(),
          sdkError: ne,
        };
      }
    });
  });
  const juryScores = await Promise.all(juryScoresPromises);

  const validScores = juryScores.map((j) => j.score).filter((s) => s != null);
  const agg = aggregateJury(validScores);

  fixture.taskExecution = fixture.taskExecution ?? {};
  fixture.taskExecution.juryScores = juryScores;
  fixture.taskExecution.juryMedian = agg.juryMedian;
  fixture.taskExecution.juryMean = agg.juryMean;
  fixture.taskExecution.jurySpread = agg.jurySpread;
  fixture.taskExecution.juryAgreement = agg.juryAgreement;
  fixture.taskExecution.juryRunAt = new Date().toISOString();
  fixture.taskExecution.juryAnonymized = true;
  fixture.taskExecution.juryAdversarial = true;

  // Atomic write: tmp + fsync + rename，防止中途崩溃损坏 fixture json
  atomicWriteJson(fixturePath, fixture);
  return { fixturePath, juryScores, ...agg };
}

/**
 * Atomic file write via temp + rename.
 * 防止 ctrl-C / crash / 磁盘满导致 fixture 被截断成 invalid JSON。
 */
export function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  const content = JSON.stringify(obj, null, 2) + '\n';
  let fd;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeSync(fd, content, 0, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    // 验证 tmp 是合法 JSON（不应失败因为我们刚 stringify 出的，但 defensive）
    JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    fs.renameSync(tmpPath, targetPath);
  } catch (e) {
    if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
    if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    throw e;
  }
}

export function listAllFixtures() {
  if (!fs.existsSync(FIXTURES_ROOT)) return [];
  const fixtures = [];
  for (const taskDir of fs.readdirSync(FIXTURES_ROOT)) {
    const fullTaskDir = path.join(FIXTURES_ROOT, taskDir);
    if (!fs.statSync(fullTaskDir).isDirectory()) continue;
    for (const toolDir of fs.readdirSync(fullTaskDir)) {
      const fp = path.join(fullTaskDir, toolDir, 'full.json');
      if (fs.existsSync(fp)) fixtures.push(fp);
    }
  }
  return fixtures;
}

// ============================================================
// 入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Feature 162 FR-027 入口位点 2/3：jury main 启动前 self-judge hard-fail 检查
  //   driver 来源：SPECTRA_EVAL_EXECUTOR 环境变量（覆盖默认 'codex:gpt-5.5'）
  //   judges：args.judges（已包含 --judges CLI 覆盖 / DEFAULT_JUDGES 默认）
  const driverModel = process.env.SPECTRA_EVAL_EXECUTOR || 'codex:gpt-5.5';
  assertNoSelfJudge({ driver: driverModel, judges: args.judges });

  let fixturePaths;
  if (args.fixture) {
    fixturePaths = [args.fixture];
  } else if (args.task && args.tool) {
    fixturePaths = [path.join(FIXTURES_ROOT, args.task, args.tool, 'full.json')];
  } else {
    fixturePaths = listAllFixtures();
  }

  console.error(`[jury] judges: ${args.judges.join(', ')}; ${args.dryRun ? 'DRY-RUN' : 'live'}; ${fixturePaths.length} fixture(s); concurrency=${args.concurrency} vendor-concurrency=${args.vendorConcurrency}`);

  // 跨 fixture 用 p-limit 控制并发（避免 rate limit）；fixture 内 N judges 已在 runJuryOnFixture 内并行
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(args.concurrency);

  // 单 vendor 真实 in-flight 上限（防同一 gateway 被多 judge × 多 fixture 同时打爆）
  const vendorLimit = new Map();
  for (const judge of args.judges) {
    const { vendor } = parseJudgeBackend(judge);
    if (!vendorLimit.has(vendor)) vendorLimit.set(vendor, pLimit(args.vendorConcurrency));
  }
  // 警告：判官全部同 vendor 时 (如全 SiliconFlow) 跨 vendor jury 退化
  const uniqueVendors = new Set([...vendorLimit.keys()]);
  if (uniqueVendors.size === 1) {
    console.error(`[jury] ⚠️  所有 judges 都来自同一 vendor (${[...uniqueVendors][0]}) — 跨 vendor jury 价值降低；建议加入不同 provider 的 judge`);
  }

  let done = 0;
  const total = fixturePaths.length;
  await Promise.all(fixturePaths.map((fp) => limit(async () => {
    if (!fs.existsSync(fp)) {
      console.error(`[jury] SKIP missing: ${path.relative(PROJECT_ROOT, fp)}`);
      done++;
      return;
    }
    const rel = path.relative(PROJECT_ROOT, fp);
    try {
      const r = await runJuryOnFixture({
        fixturePath: fp,
        judges: args.judges,
        dryRun: args.dryRun,
        maxDiffBytes: args.maxDiffBytes,
        vendorLimit,
      });
      done++;
      console.error(`[jury ${done}/${total}] ${rel}: median=${r.juryMedian} spread=${r.jurySpread} agreement=${r.juryAgreement}`);
    } catch (e) {
      done++;
      console.error(`[jury ${done}/${total}] ${rel} FAILED: ${e.message}`);
    }
  })));
}

const isCliEntry = process.argv[1]?.endsWith('eval-judge-jury.mjs');
if (isCliEntry) {
  main().catch((err) => {
    console.error(`[jury] error: ${err.message}`);
    process.exit(1);
  });
}
