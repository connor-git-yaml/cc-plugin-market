/**
 * Feature 162 Phase A — LLM Backend Dispatcher
 *
 * 共享 backend 调度模块，统一支持 4 种 backend：
 *   - siliconflow:<model>  → OpenAI-compat SDK（SiliconFlow，使用 SILICONFLOW_API_KEY）
 *   - openai:<model>       → OpenAI-compat SDK（原生 OpenAI，使用 OPENAI_API_KEY）
 *   - claude-cli:<model>   → spawn `claude --print --output-format json ...`（Claude Max subscription）
 *   - codex:<model>        → spawn `codex exec ...`（ChatGPT Pro subscription）
 *
 * 设计意图：
 *   - eval-task-executor.mjs 中 `callExecutor` 与 eval-judge-jury.mjs 中 jury client 共享底层 backend 路径
 *   - 提供 normalize / alias / self-judge / retry-matrix / classifyError 一站式语义
 *
 * 关联 spec:
 *   - FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-027
 *   - plan §2.1 (callBackend 完整设计) + §2.2 (self-judge hard-fail)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const SILICONFLOW_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

// ============================================================
// 常量：MODEL_ALIASES + BACKEND_PREFIXES + VENDOR_ORG_PREFIXES
// ============================================================

/**
 * 模型 ID 别名映射表。
 *
 * 关键设计：所有 key 必须是 lowercase（normalize 流程已先 toLowerCase；
 * 大写 key 永远命不中）。
 *
 * 映射目标：把同一物理模型的多种写法（dot/hyphen 变体、长短形式）归一到一个 stable id，
 * 供 self-judge hard-fail 检查使用。
 *
 * 来源：plan §2.1.8（iter-2 修订 C-2）。
 */
export const MODEL_ALIASES = {
  // OpenAI 系（GPT-5.5）
  'gpt-5.5': 'gpt-5.5',
  'gpt5.5':  'gpt-5.5',
  'gpt-5-5': 'gpt-5.5',
  'gpt5-5':  'gpt-5.5',

  // Zhipu GLM 系（GLM-5.1）
  'glm-5.1': 'glm-5.1',
  'glm5.1':  'glm-5.1',
  'glm-5-1': 'glm-5.1',
  'glm5-1':  'glm-5.1',

  // Anthropic Claude Opus 4.7
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-opus-4.7': 'claude-opus-4-7',
  'opus-4-7':        'claude-opus-4-7',
  'opus-4.7':        'claude-opus-4-7',

  // Anthropic Claude Sonnet 4.6
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet-4-6':        'claude-sonnet-4-6',
  'sonnet-4.6':        'claude-sonnet-4-6',

  // Anthropic Claude Haiku 4.5
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-haiku-4.5': 'claude-haiku-4-5',
  'haiku-4-5':        'claude-haiku-4-5',
  'haiku-4.5':        'claude-haiku-4-5',

  // Anthropic Claude Haiku 4.7
  'claude-haiku-4-7': 'claude-haiku-4-7',
  'claude-haiku-4.7': 'claude-haiku-4-7',
  'haiku-4-7':        'claude-haiku-4-7',
  'haiku-4.7':        'claude-haiku-4-7',

  // Moonshot Kimi K2.6
  'kimi-k2.6': 'kimi-k2.6',
  'kimi-k2-6': 'kimi-k2.6',
};

const BACKEND_PREFIX_RE = /^(siliconflow|openai|claude-cli|codex|anthropic):/;
const VENDOR_ORG_PREFIX_RE = /^(pro\/zai-org\/|pro\/moonshotai\/|anthropic\/)/;

// ============================================================
// normalizeModelId
// ============================================================

/**
 * 把任意 model identifier 归一为稳定 id，供 self-judge hard-fail 与 alias 解析共用。
 *
 * 算法 5 步（顺序不可变，plan §2.1.7）：
 *   1. trim()
 *   2. toLowerCase()                    ← 先 case-fold（避免 `Codex:GPT-5.5` 漏剥 prefix）
 *   3. 剥 backend prefix（siliconflow/openai/claude-cli/codex/anthropic:）
 *   4. 剥 vendor org prefix（Pro/zai-org/, Pro/moonshotai/, anthropic/）
 *   5. 查 MODEL_ALIASES 表；表内不存在则原样返回
 *
 * 示例：
 *   normalizeModelId('Codex:GPT-5.5')                       → 'gpt-5.5'
 *   normalizeModelId('siliconflow:Pro/zai-org/GLM-5.1')      → 'glm-5.1'
 *   normalizeModelId('Pro/moonshotai/Kimi-K2.6')             → 'kimi-k2.6'
 *   normalizeModelId('claude-cli:claude-opus-4-7')           → 'claude-opus-4-7'
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeModelId(s) {
  if (typeof s !== 'string') {
    throw new TypeError(`normalizeModelId: expected string, got ${typeof s}`);
  }
  const step1 = s.trim();
  const step2 = step1.toLowerCase();
  const step3 = step2.replace(BACKEND_PREFIX_RE, '');
  const step4 = step3.replace(VENDOR_ORG_PREFIX_RE, '');
  const step5 = MODEL_ALIASES[step4] ?? step4;
  return step5;
}

// ============================================================
// classifyError + retry 决策矩阵识别
// ============================================================

/**
 * 错误分类（plan §2.1.6 retry matrix）：
 *
 *   transient       → retry 1 次（间隔 2s）
 *   quota           → 禁止 retry，立即 fail
 *   truncation      → 禁止 retry，标记 partial=true
 *   schema-invalid  → 禁止 retry，记录 rawResponse
 *   unknown         → 禁止 retry，记 message
 *
 * @param {Error|null} err           上层捕获到的异常（fetch / spawn / SDK 抛错）
 * @param {string|null} finishReason 'stop' | 'length' | 'error' | null
 * @param {string|null} text         模型输出文本（用于检测 schema-invalid）
 * @returns {'transient'|'quota'|'truncation'|'schema-invalid'|'unknown'}
 */
export function classifyError(err, finishReason, text) {
  // 1. truncation：finishReason='length'（与 err 无关，优先判定避免被 unknown 吞掉）
  if (finishReason === 'length') return 'truncation';

  if (err) {
    const msg = String(err.message ?? err ?? '').toLowerCase();
    const code = err.code ?? null;
    const status = err.status ?? err.response?.status ?? null;

    // 2. quota：HTTP 429 / quota_exceeded / rate_limit_exceeded / insufficient_quota
    if (status === 429) return 'quota';
    if (msg.includes('quota_exceeded')) return 'quota';
    if (msg.includes('rate_limit_exceeded')) return 'quota';
    if (msg.includes('insufficient_quota')) return 'quota';

    // 3. transient：连接级错误 / HTTP 5xx
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return 'transient';
    if (typeof status === 'number' && status >= 500 && status < 600) return 'transient';
    if (msg.includes('connection_reset') || msg.includes('connection reset')) return 'transient';

    // 4. schema-invalid：JSON parse / Zod 失败 / non-JSON 返回
    //    匹配宽泛 keyword（避免 SDK 错误消息变体导致漏报）：
    //    'unexpected token'（V8 JSON.parse 默认）/'json parse'/'non-json'/'schema'/'zod'
    if (msg.includes('json parse')
        || msg.includes('non-json')
        || msg.includes('returned non-json')
        || msg.includes('unexpected token')
        || msg.includes('schema validation')
        || msg.includes('zod')) {
      return 'schema-invalid';
    }

    return 'unknown';
  }

  // 5. 无 err 但 text 不是合法 JSON object → schema-invalid
  if (typeof text === 'string' && text.length > 0) {
    const candidate = text.trim();
    // 极简检查：必须 { 开头，} 结尾，且能 JSON.parse
    if (!candidate.startsWith('{') && !candidate.startsWith('```')) {
      return 'schema-invalid';
    }
    try {
      const m = candidate.match(/\{[\s\S]*\}/);
      if (!m) return 'schema-invalid';
      JSON.parse(m[0]);
    } catch {
      return 'schema-invalid';
    }
  }

  return 'unknown';
}

/**
 * 判断错误类别是否允许 retry。
 * @param {string} kind classifyError 的返回值
 * @returns {boolean}
 */
export function isRetryable(kind) {
  return kind === 'transient';
}

/**
 * Feature 162 Phase A iter-2 (W-1)：schema 完整性检查（success path）。
 *
 * 场景：handler 返回 success（finishReason='stop'），但 text 为空 / text 是 JSON 但只含元数据
 * 字段（rationale）缺 caller 期望的实质内容（patch / score / result）。
 *
 * 判定规则（保守，避免误伤合法输出）：
 *   1. text 为空字符串 / 仅空白 → 'empty-text'
 *   2. text 是 JSON object 但 keys 集合 ⊆ {'rationale'}（只有 rationale 这一个 metadata 键，
 *      无任何 content 字段）→ 'json-only-rationale'
 *   3. 其他场景（含纯文本 / JSON 含其他字段）→ null（不是 schema 问题）
 *
 * 关联：FR-014 retry matrix（schema-invalid 不 retry）+ codex review iter-2 W-1
 *
 * @param {object} param0
 * @param {string} param0.text
 * @param {string|null} param0.finishReason
 * @returns {string|null} 问题描述（schema-invalid）或 null（无问题）
 */
export function detectSchemaIncompleteness({ text, finishReason: _finishReason }) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'empty-text';
  }
  const trimmed = text.trim();
  // 仅 JSON object 路径才检查；纯文本 / 数组 / 其他形态由 caller 自行解析
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    parsed = JSON.parse(m[0]);
  } catch {
    // JSON parse 失败由 caller 的 parsePatchJson / parseJudgeJson 兜底分类
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  // 空 object → schema-invalid（无任何字段）
  if (keys.length === 0) return 'json-empty-object';
  // 只含 rationale 一个键 → 缺 caller 期望的内容字段（score / files / result / text 等）
  if (keys.length === 1 && keys[0] === 'rationale') return 'json-only-rationale';
  return null;
}

// ============================================================
// callBackend：主入口
// ============================================================

/**
 * 解析 model 串为 backend 类型 + 裸 model 名。
 * @param {string} model 形如 'codex:gpt-5.5' / 'siliconflow:Pro/zai-org/GLM-5.1'
 */
function parseBackend(model) {
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error(`callBackend: invalid model: ${JSON.stringify(model)}`);
  }
  if (model.startsWith('siliconflow:')) {
    return { backend: 'siliconflow', rawModel: model.slice('siliconflow:'.length) };
  }
  if (model.startsWith('openai:')) {
    return { backend: 'openai', rawModel: model.slice('openai:'.length) };
  }
  if (model.startsWith('claude-cli:')) {
    return { backend: 'claude-cli', rawModel: model.slice('claude-cli:'.length) };
  }
  if (model.startsWith('codex:')) {
    return { backend: 'codex', rawModel: model.slice('codex:'.length) };
  }
  // 没显式 prefix → 默认走 siliconflow（保持向后兼容旧 callExecutor 调用）
  return { backend: 'siliconflow', rawModel: model };
}

/**
 * 主入口：统一 4 backend 调度。
 *
 * 返回 shape（4 backend 标准化）：
 *   {
 *     ok: boolean,                                       // 是否成功（retry 策略后的最终结果）
 *     text: string,
 *     promptTokens: number | null,                        // codex CLI 不分项 → null
 *     completionTokens: number | null,
 *     finishReason: 'stop' | 'length' | 'error' | null,
 *     raw: object | null,                                 // 原始 SDK 返回，便于审计
 *     partial: boolean,                                   // finishReason='length' 且 text 截断
 *     retried: number,                                    // 实际 retry 次数
 *     error?: { code, message, retryable, rawResponse? }, // 失败时的错误结构
 *   }
 *
 * @param {object} param0
 * @param {string} param0.model
 * @param {string} param0.prompt
 * @param {object} [param0.options]
 * @param {object} [param0.deps] - 测试注入：{ fetchImpl, spawnImpl, openaiSdkLoader, fsImpl }
 */
export async function callBackend({ model, prompt, options = {}, deps = {} }) {
  const { backend, rawModel } = parseBackend(model);

  let attempt = 0;
  let lastResult = null;
  // 最多 1 retry（仅 transient）：第一次 fail + transient → 再跑一次；其他类别立即 fail
  const MAX_ATTEMPTS = 2;

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    let handlerResult;
    try {
      handlerResult = await dispatchHandler({ backend, rawModel, prompt, options, deps });
    } catch (err) {
      // 兜底：handler 内部未捕获的异常 → 转为标准失败 shape
      handlerResult = {
        text: '',
        promptTokens: null,
        completionTokens: null,
        finishReason: 'error',
        raw: null,
        _err: err,
      };
    }

    const { _err = null, text = '', finishReason = null } = handlerResult;
    // 判断成功条件：finishReason 非 'error' 且无 _err 且 text 非空
    const ok = !_err && finishReason !== 'error' && finishReason !== 'length';

    if (ok) {
      // Feature 162 Phase A iter-2 (W-1)：schema 完整性检查（fail-fast，不 retry）
      //   场景：handler 返回 success（finishReason='stop'）但 text 为空字符串，或 text 是 JSON
      //   但缺关键字段（如 `{"rationale":"x"}` 没有可被 caller 解析的 patch / score 内容）。
      //   这通常说明 backend SDK 协议异常或模型输出空载，应立即 fail（不 retry）+ 记 rawResponse。
      const schemaProblem = detectSchemaIncompleteness({ text, finishReason });
      if (schemaProblem) {
        return {
          ok: false,
          text,
          promptTokens: handlerResult.promptTokens ?? null,
          completionTokens: handlerResult.completionTokens ?? null,
          finishReason: finishReason ?? 'stop',
          raw: handlerResult.raw ?? null,
          partial: false,
          retried: attempt - 1,
          error: {
            code: 'schema-invalid',
            message: `schema-invalid (success path): ${schemaProblem}`,
            retryable: false,
            rawResponse: text.slice(0, 1000),
          },
        };
      }
      return {
        ok: true,
        text,
        promptTokens: handlerResult.promptTokens ?? null,
        completionTokens: handlerResult.completionTokens ?? null,
        finishReason: finishReason ?? 'stop',
        raw: handlerResult.raw ?? null,
        partial: false,
        retried: attempt - 1,
      };
    }

    // 错误分类
    const kind = classifyError(_err, finishReason, text);
    lastResult = {
      ok: false,
      text,
      promptTokens: handlerResult.promptTokens ?? null,
      completionTokens: handlerResult.completionTokens ?? null,
      finishReason: finishReason ?? 'error',
      raw: handlerResult.raw ?? null,
      partial: kind === 'truncation',
      retried: attempt - 1,
      error: {
        code: kind === 'truncation' ? 'truncated' : kind,
        message: _err ? String(_err.message ?? _err) : `finishReason=${finishReason}`,
        retryable: isRetryable(kind),
        rawResponse: kind === 'schema-invalid' ? text.slice(0, 1000) : undefined,
      },
    };

    // 仅 transient + 还有 retry 余量 → 等 2s 重试
    if (kind === 'transient' && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    return lastResult;
  }
  return lastResult;
}

/**
 * 路由到对应 backend handler。
 */
async function dispatchHandler({ backend, rawModel, prompt, options, deps }) {
  switch (backend) {
    case 'siliconflow':
      return await handleOpenAICompat({ rawModel, prompt, options, deps, vendor: 'siliconflow' });
    case 'openai':
      return await handleOpenAICompat({ rawModel, prompt, options, deps, vendor: 'openai' });
    case 'claude-cli':
      return await handleClaudeCli({ rawModel, prompt, options, deps });
    case 'codex':
      return await handleCodexCli({ rawModel, prompt, options, deps });
    default:
      throw new Error(`callBackend: unsupported backend '${backend}'`);
  }
}

// ============================================================
// handler: siliconflow / openai (OpenAI-compat)
// ============================================================

/**
 * SiliconFlow 与 OpenAI 共用 OpenAI-compat 接口。
 * 通过 `vendor` 区分 baseURL + apiKey env。
 */
async function handleOpenAICompat({ rawModel, prompt, options, deps, vendor }) {
  const baseURL = options.baseURL
    ?? (vendor === 'siliconflow' ? SILICONFLOW_DEFAULT_BASE_URL : OPENAI_DEFAULT_BASE_URL);
  const apiKeyEnv = vendor === 'siliconflow' ? 'SILICONFLOW_API_KEY' : 'OPENAI_API_KEY';
  const apiKey = options.apiKey ?? process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`${apiKeyEnv} not set (required for ${vendor})`);
  }

  // 测试注入：deps.openaiSdkLoader 返回一个伪 SDK；deps.openaiCreate 直接覆盖 .create()
  let createImpl;
  if (deps.openaiCreate) {
    createImpl = deps.openaiCreate;
  } else {
    const sdkLoader = deps.openaiSdkLoader ?? (async () => (await import('openai')).default);
    const OpenAI = await sdkLoader();
    const sdk = new OpenAI({ apiKey, baseURL, timeout: options.timeoutMs ?? 240000 });
    createImpl = (req) => sdk.chat.completions.create(req);
  }

  const r = await createImpl({
    model: rawModel,
    max_tokens: options.maxTokens ?? 8000,
    temperature: options.temperature ?? 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const choice = r?.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    promptTokens: r?.usage?.prompt_tokens ?? null,
    completionTokens: r?.usage?.completion_tokens ?? null,
    finishReason: choice?.finish_reason ?? null,
    raw: r,
  };
}

// ============================================================
// handler: claude-cli
// ============================================================

/**
 * spawn `claude --print --output-format json --model <m> --permission-mode plan <prompt>`
 * 输出 stdout 为 JSON 包装：{ result, usage: { input_tokens, output_tokens }, stop_reason, total_cost_usd }
 */
async function handleClaudeCli({ rawModel, prompt, options, deps }) {
  const spawnImpl = deps.spawnImpl ?? defaultSpawnAsync;
  const r = await spawnImpl('claude',
    ['--print', '--model', rawModel, '--output-format', 'json', '--permission-mode', 'plan', prompt],
    { timeoutMs: options.timeoutMs ?? 180000 });

  if (r.status !== 0 || r.killed) {
    return {
      text: '',
      promptTokens: null,
      completionTokens: null,
      finishReason: 'error',
      raw: r,
      _err: new Error(`claude CLI failed (status=${r.status}, killed=${r.killed}): ${(r.stderr || '').slice(0, 300)}`),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    return {
      text: r.stdout,
      promptTokens: null,
      completionTokens: null,
      finishReason: 'error',
      raw: r,
      _err: new Error(`claude CLI returned non-JSON: ${e.message}`),
    };
  }

  // 标准化 stop_reason → finishReason
  const stopReason = parsed.stop_reason ?? null;
  const finishReason = stopReason === 'end_turn' ? 'stop'
    : stopReason === 'max_tokens' ? 'length'
    : stopReason === null ? 'stop'
    : stopReason;

  return {
    text: parsed.result ?? '',
    promptTokens: parsed.usage?.input_tokens ?? null,
    completionTokens: parsed.usage?.output_tokens ?? null,
    finishReason,
    raw: parsed,
  };
}

// ============================================================
// handler: codex CLI
// ============================================================

/**
 * spawn `codex exec --skip-git-repo-check --sandbox read-only -c model_reasoning_effort=... -m <m>
 *   --output-last-message <tmpFile> <prompt>`
 *
 * 输出策略：
 *   - text: 读 tmpFile（CLI 把最后一条 assistant message 写到该文件）
 *   - tokens: 解析 stderr 正则 /tokens used\s*\n\s*([\d,]+)/，promptTokens 始终 null（不分项）
 *   - finishReason: 默认 'stop'；status 非 0 → 'error'
 */
async function handleCodexCli({ rawModel, prompt, options, deps }) {
  const spawnImpl = deps.spawnImpl ?? defaultSpawnAsync;
  const fsImpl = deps.fsImpl ?? fs;

  // Feature 162 Phase A iter-2 (W-3)：codex CLI 鉴权预检。
  //   默认 DEFAULT_EXECUTOR_MODEL=codex:gpt-5.5。当本地未安装 codex CLI 或未登录 ChatGPT 时，
  //   spawn 会失败抛出晦涩 ENOENT，对 ops 不友好。这里在 spawn 前用 `codex --version` 做轻量
  //   预检（< 200ms），失败时返回友好错误信息指引安装 + 登录 + 替代 backend。
  //   测试场景：deps.skipAuthPrecheck=true 跳过预检（避免 mock spawnImpl 时多余调用）。
  if (!options.skipAuthPrecheck && !deps.skipAuthPrecheck) {
    const precheck = await spawnImpl('codex', ['--version'], { timeoutMs: 5000 });
    if (precheck.status !== 0 || precheck.killed || precheck.spawnError) {
      const msg = [
        'codex CLI 未登录或未安装。',
        '解决方法：',
        '  1. 安装：npm install -g @openai/codex',
        '  2. 登录：codex login',
        `  3. 或使用 SPECTRA_EVAL_EXECUTOR 环境变量指定其他 backend（如 'siliconflow:Pro/zai-org/GLM-5.1'）`,
        precheck.stderr ? `  原始错误: ${(precheck.stderr || '').slice(0, 200)}` : '',
        precheck.spawnError ? `  spawn error: ${precheck.spawnError}` : '',
      ].filter(Boolean).join('\n');
      return {
        text: '',
        promptTokens: null,
        completionTokens: null,
        finishReason: 'error',
        raw: precheck,
        _err: new Error(msg),
      };
    }
  }

  const tmpDir = deps.tmpDir ?? os.tmpdir();
  const tmpFile = path.join(
    tmpDir,
    `codex-out-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );

  const reasoningEffort = options.reasoningEffort ?? 'medium';
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-c', `model_reasoning_effort="${reasoningEffort}"`,
    '-m', rawModel,
    '--output-last-message', tmpFile,
    prompt,
  ];

  let r;
  try {
    r = await spawnImpl('codex', args, { timeoutMs: options.timeoutMs ?? 300000 });
  } catch (err) {
    return {
      text: '',
      promptTokens: null,
      completionTokens: null,
      finishReason: 'error',
      raw: null,
      _err: err,
    };
  }

  if (r.killed) {
    return {
      text: '',
      promptTokens: null,
      completionTokens: null,
      finishReason: 'error',
      raw: r,
      _err: new Error(`codex CLI timed out (timeoutMs=${options.timeoutMs ?? 300000})`),
    };
  }

  let text = '';
  try {
    if (fsImpl.existsSync(tmpFile)) {
      text = fsImpl.readFileSync(tmpFile, 'utf-8');
    } else {
      text = r.stdout ?? '';
    }
  } finally {
    try {
      if (fsImpl.existsSync(tmpFile)) fsImpl.unlinkSync(tmpFile);
    } catch {
      // 清理失败不阻断主流程
    }
  }

  if (r.status !== 0) {
    return {
      text,
      promptTokens: null,
      completionTokens: null,
      finishReason: 'error',
      raw: r,
      _err: new Error(`codex CLI exited with status ${r.status}: ${(r.stderr || '').slice(0, 300)}`),
    };
  }

  // tokens 从 stderr 提取 "tokens used\n20,428"
  const tokenMatch = (r.stderr ?? '').match(/tokens used\s*\n\s*([\d,]+)/);
  const totalTokens = tokenMatch ? Number(tokenMatch[1].replace(/,/g, '')) : null;

  // 截断检测：stderr 含 'truncated' → 标 length
  const truncated = /truncated/i.test(r.stderr ?? '');
  const finishReason = truncated ? 'length' : 'stop';

  return {
    text,
    promptTokens: null,           // codex CLI 不返回分项
    completionTokens: totalTokens, // 全计为 completion，避免 cost 估算偏低
    finishReason,
    raw: r,
  };
}

// ============================================================
// defaultSpawnAsync helper
// ============================================================

/**
 * Promise 化 child_process.spawn，捕获 stdout/stderr/status/killed。
 */
function defaultSpawnAsync(cmd, args, { timeoutMs = 180000, stdin = null } = {}) {
  return new Promise((resolve) => {
    const stdio = stdin != null ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
    const proc = spawn(cmd, args, { stdio });
    let stdout = '';
    let stderr = '';
    let killed = false;
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    const t = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
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

// ============================================================
// self-judge hard-fail (FR-027 + plan §2.2)
// ============================================================

/**
 * Self-judge 错误类型。便于上层 catch 时类型识别。
 */
export class SelfJudgeError extends Error {
  constructor(message, { driverRaw, judgeRaw, normalized }) {
    super(message);
    this.name = 'SelfJudgeError';
    this.driverRaw = driverRaw;
    this.judgeRaw = judgeRaw;
    this.normalized = normalized;
  }
}

/**
 * driver 与 jury judge 解析为同一 model 时 hard-fail。
 *
 * 行为：
 *   - normalize driverModel + 每个 judgeModel
 *   - 任一 normalize 后 driver === judge → throw SelfJudgeError（FR-027 hard fail）
 *   - jury 内部重复（如 [opus, opus]）→ console.warn 不 throw
 *
 * 用法：在 3 处入口调用（plan §2.2.1）：
 *   - eval-mcp-augmented.mjs：parseArgs() 之后、runForTaskList() 之前
 *   - eval-judge-jury.mjs：main 函数顶部
 *   - eval-task-executor.mjs：executeOnFixture() 入口
 *
 * @param {object} param0
 * @param {string} param0.driver         driver model identifier，e.g. 'codex:gpt-5.5'
 * @param {string[]} param0.judges       jury judge identifiers，e.g. ['claude-cli:claude-opus-4-7', ...]
 * @throws {SelfJudgeError} 当 driver 与某 judge normalize 相同时
 */
export function assertNoSelfJudge({ driver, judges }) {
  if (typeof driver !== 'string') {
    throw new TypeError(`assertNoSelfJudge: driver must be string, got ${typeof driver}`);
  }
  if (!Array.isArray(judges)) {
    throw new TypeError(`assertNoSelfJudge: judges must be array, got ${typeof judges}`);
  }

  const driverNorm = normalizeModelId(driver);
  const judgeNorms = judges.map(normalizeModelId);

  // jury 内部重复 → console.warn（不阻断，用户自负风险）
  const seen = new Map();
  const duplicates = [];
  for (let i = 0; i < judgeNorms.length; i++) {
    const n = judgeNorms[i];
    if (seen.has(n)) {
      duplicates.push({ normalized: n, raw: [seen.get(n), judges[i]] });
    } else {
      seen.set(n, judges[i]);
    }
  }
  if (duplicates.length > 0) {
    const desc = duplicates.map((d) => `${d.normalized}(${d.raw.join(', ')})`).join('; ');
    console.warn(`[warn] jury 内部重复 judge: ${desc}, 用户自负风险`);
  }

  // self-judge hard-fail
  for (let i = 0; i < judgeNorms.length; i++) {
    if (judgeNorms[i] === driverNorm) {
      const msg = formatSelfJudgeError(driver, judges[i], driverNorm);
      throw new SelfJudgeError(msg, {
        driverRaw: driver,
        judgeRaw: judges[i],
        normalized: driverNorm,
      });
    }
  }
}

/**
 * 格式化 self-judge 错误信息（中文友好，便于 ops 排查）。
 */
export function formatSelfJudgeError(driverRaw, judgeRaw, normalized) {
  return [
    '[FATAL] self-judge 禁忌触发：driver 与 jury judge 解析为同一模型。',
    `  driver (raw):       ${driverRaw}`,
    `  jury judge (raw):   ${judgeRaw}`,
    `  normalized id:      ${normalized}`,
    '请检查 SPECTRA_EVAL_EXECUTOR / --judges / DEFAULT_JUDGES 配置。',
  ].join('\n');
}
