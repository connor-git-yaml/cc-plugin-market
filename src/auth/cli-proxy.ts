/**
 * CLI 代理
 * 通过 spawn Claude Code CLI 子进程间接调用 LLM
 * 参考 claude-max-api-proxy 方案
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LLMResponse } from '../core/llm-client.js';
import {
  LLMTimeoutError,
  LLMResponseError,
  LLMUnavailableError,
  getTimeoutForModel,
} from '../core/llm-client.js';
import { resolveReverseSpecModel } from '../core/model-selection.js';

// ============================================================
// 类型定义
// ============================================================

/** CLI 代理配置 */
export interface CLIProxyConfig {
  /** Claude 模型 ID */
  model: string;
  /** 超时时间（毫秒，默认 120000） */
  timeout: number;
  /** batch 模式最大并发进程数（默认 3） */
  maxConcurrency: number;
  /** Claude CLI 可执行文件路径（undefined 则自动检测） */
  cliPath?: string;
  /**
   * spectra 自己的系统提示（M11 卡 E）。给出时走 `--system-prompt`，stdin 只送用户内容——与 SDK 路径
   * （`system:` + 用户消息）对齐；不给出时沿用旧的「整段拼接进 stdin」方式（Claude Code 人设系统提示会叠加在前）。
   */
  systemPrompt?: string;
}

/**
 * 无头调用隔离旗标（M11 卡 E）。实测（Claude Code 2.1.270，一次只回「ok」，input 侧 = input + cache_creation + cache_read）：
 * 默认（本仓 cwd）≈ 67.6k → 隔离旗标全开但 cwd 仍在本仓 ≈ 13.7k（差值是内建工具 schema + MCP + 技能 + 插件 + hooks）
 * → cwd 移出仓库并用 `--system-prompt` 替换 Claude Code 人设 ≈ 0.6k（delta 复审实测 578 / 598 token）——全是 harness 开销，
 * 与 spectra 的 prompt 无关。spec 生成是单轮纯文本任务：不需要工具、MCP、技能、hooks，也不需要把每次调用存成会话。
 *
 * 为什么是 `--safe-mode` 而不是 `--setting-sources ''`（delta 复审 C-Δ3）：后者让 user / project / local 三层设置**整体不加载**，
 * 靠 `apiKeyHelper` / `env` 认证的用户会失去通道；把这两个键经 `--settings` 透传回去则把凭据放上 argv（`ps` 可见）、
 * 反转「删 ANTHROPIC_API_KEY 强制 OAuth」的不变量、并让被分析仓库里的 `.claude/settings.json` 拿到命令执行。
 * `--safe-mode`（帮助原文：Start with all customizations disabled——CLAUDE.md / 技能 / 插件 / hooks / MCP 全禁，
 * Auth、模型选择、内建工具、权限照常）由 Claude Code 自己读认证设置，凭据不经本进程；实测 init `tools:0 / mcp:0 / skills:0`、
 * `apiKeySource` 与 OAuth 路径一致。MCP 已由 safe-mode 禁掉，不再另带 `--strict-mcp-config`；`--tools ''` 仍要，
 * 它压掉的是内建工具 schema（safe-mode 不禁内建工具）。
 * 变参旗标（--tools）之后必须紧跟下一个旗标或 stdin，否则会把后续参数吞掉。
 */
export const HEADLESS_ISOLATION_ARGS: readonly string[] = Object.freeze([
  '--max-turns', '1',
  '--safe-mode',
  '--no-session-persistence',
  '--disable-slash-commands',
  '--tools', '',
]);

/** 本仓实测通过这组旗标的最低 Claude Code 版本（旧版本对未知旗标直接报错，见 callLLMviaCli 的错误提示） */
const MIN_TESTED_CLAUDE_CLI_VERSION = '2.1.270';

/**
 * 组装 claude CLI 参数：固定头（--print / stream-json / model）+ 隔离旗标 + 可选 --system-prompt。
 * 不带 `--settings` / `--setting-sources`：认证设置由 Claude Code 自己读，凭据不上 argv（见 HEADLESS_ISOLATION_ARGS 注释）。
 * 导出供单测钉住 argv 形态。`--tools ''` 是变参旗标，必须是最后一个参数或紧跟下一个旗标（--system-prompt 在它之后即可）。
 */
export function buildClaudeCliArgs({ model, systemPrompt }: { model: string; systemPrompt?: string }): string[] {
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--model', model,
    ...HEADLESS_ISOLATION_ARGS,
  ];
  if (typeof systemPrompt === 'string' && systemPrompt.length > 0) {
    args.push('--system-prompt', systemPrompt);
  }
  return args;
}

/**
 * 子进程 cwd：仓库之外的专用空目录。Claude Code 会把 cwd 及其祖先目录的 CLAUDE.md / .claude 设置读进系统提示
 * （本仓 CLAUDE.md + CLAUDE.local.md ≈ 13k token，每个模块调用都在付），spec 生成不需要任何项目上下文——它已经在 prompt 里。
 * 不缓存结果：macOS 会周期清理 3 天未触碰的临时目录，缓存一个已不存在的路径会让长活的 MCP server 此后每次 spawn ENOENT
 * （对抗审查 W-4）；`mkdirSync(recursive)` 本就幂等。
 */
export function resolveHeadlessCwd(): string {
  const dir = path.join(os.tmpdir(), 'spectra-headless-cwd');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 从 `dir` 向上找第一个带 `CLAUDE.md` 或 `.claude/` 的祖先目录：`os.tmpdir()` 认 `$TMPDIR`，把它设进某个仓库
 * （CI / sandbox 常见 `TMPDIR=$PWD/.tmp`）时 Claude Code 的项目上下文发现会顺 cwd 往上走回来，cwd 隔离静默失效（对抗审查 W-9）。
 * 找不到返回 null。
 */
export function findAncestorProjectMarkers(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(current, 'CLAUDE.md')) || isDirectory(path.join(current, '.claude'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

let warnedCwdLeak = false;
let warnedIsolationIneffective = false;

/** 测试钩子：两个「进程内只警告一次」标记会让用例互相污染（delta 复审 W-Δ10），beforeEach 里复位。生产不调用。 */
export function __resetHeadlessWarningsForTests(): void {
  warnedCwdLeak = false;
  warnedIsolationIneffective = false;
}

/** stream-json 输出中的消息事件 */
interface StreamMessage {
  type: string;
  subtype?: string;
  // result 类型的字段
  result?: string;
  model?: string;
  /** result 类型：Claude CLI 判定本次调用失败（error_max_turns / error_during_execution …），此时 result 字段可能缺席 */
  is_error?: boolean;
  /** result 类型：Claude Code 自报的本次调用成本（美元；已按正确的缓存 TTL 定价） */
  total_cost_usd?: number;
  // system/init 类型：CLI 自报本次会话加载了什么（隔离旗标是否生效的唯一现场证据）
  tools?: unknown[];
  mcp_servers?: unknown[];
  /**
   * Claude CLI 实际输出格式（Feature 133 P0-1 修复）:
   * type=result message 把 token 嵌套在 usage.* 下，不是顶层。
   * 顶层字段保留作向后兼容（未来 CLI 格式回退或测试 mock）。
   */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  /** 旧顶层格式（向后兼容） */
  input_tokens?: number;
  output_tokens?: number;
  // content_block_delta 类型的字段
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  // assistant 类型的消息：实测是对象 `{ role, content: [{ type: 'text', text }] }`，旧格式可能是字符串
  message?: unknown;
  content?: string;
}

// ============================================================
// 默认配置
// ============================================================

/** 获取默认 CLI 代理配置 */
export function getDefaultCLIProxyConfig(): CLIProxyConfig {
  const { model } = resolveReverseSpecModel({ provider: 'claude' });
  return {
    model,
    timeout: getTimeoutForModel(model),
    maxConcurrency: 3,
  };
}

// ============================================================
// 核心实现
// ============================================================

/**
 * 通过 Claude CLI 子进程调用 LLM
 *
 * 流程：
 * 1. spawn claude --print --output-format stream-json --model <model>
 * 2. 通过 stdin 写入 prompt
 * 3. 解析 stdout 的 JSON stream 输出
 * 4. 构造 LLMResponse
 *
 * @param prompt - 完整的 prompt 文本（含系统提示 + 用户内容）
 * @param config - CLI 代理配置
 * @returns 与 SDK 调用相同格式的 LLMResponse
 * @throws LLMTimeoutError, LLMResponseError, LLMUnavailableError
 */
export function callLLMviaCli(
  prompt: string,
  config: Partial<CLIProxyConfig> = {},
): Promise<LLMResponse> {
  const cfg: CLIProxyConfig = { ...getDefaultCLIProxyConfig(), ...config };
  const cliPath = cfg.cliPath ?? 'claude';

  return new Promise<LLMResponse>((resolve, reject) => {
    const startTime = Date.now();
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let settled = false;

    // 构造子进程环境：移除 ANTHROPIC_API_KEY，强制 CLI 使用 OAuth
    const childEnv = { ...process.env };
    delete childEnv['ANTHROPIC_API_KEY'];

    const args = buildClaudeCliArgs({ model: cfg.model, systemPrompt: cfg.systemPrompt });

    let child;
    try {
      const cwd = resolveHeadlessCwd();
      const leakedFrom = findAncestorProjectMarkers(cwd);
      if (leakedFrom !== null && !warnedCwdLeak) {
        warnedCwdLeak = true;
        console.warn(`[cli-proxy] 无头调用 cwd（${cwd}）的祖先目录 ${leakedFrom} 带 CLAUDE.md / .claude，Claude CLI 会把该项目上下文读进每次调用；请把 TMPDIR 指到仓库之外`);
      }
      child = spawn(cliPath, args, {
        cwd,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reject(new LLMUnavailableError(`无法启动 Claude CLI: ${msg}`));
      return;
    }

    // 超时处理
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      // 给进程一些时间优雅退出
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 3_000);
    }, cfg.timeout);

    // 收集 stdout
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
    });

    // 收集 stderr
    child.stderr.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    // 写入 prompt 到 stdin
    child.stdin.write(prompt);
    child.stdin.end();

    // spawn 错误（如命令不存在）
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new LLMUnavailableError(`Claude CLI 进程错误: ${err.message}`));
    });

    // 进程退出
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      if (timedOut) {
        reject(
          new LLMTimeoutError(`Claude CLI 超时 (${cfg.timeout}ms)`),
        );
        return;
      }

      if (code !== 0) {
        // 检查 stderr 是否仅包含 WARN 信息（如 Agent SDK 环境下的 Fast mode 警告）——必须**非空且**全是 WARN：
        // 空 stderr 对 `every` 恒真，曾让「exit 1 + stderr 为空 + result.is_error」的 max_turns / 执行错误被当纯 WARN 放行（对抗审查 C-2）
        const stderrLines = stderrData.trim().split('\n').filter((line) => line.trim() !== '');
        const isWarnOnly = stderrLines.length > 0 && stderrLines.every((line) => /^\[WARN\]/.test(line.trim()));
        if (isWarnOnly && stdoutData.trim().length > 0) {
          // 忽略纯 WARN stderr，继续解析 stdout
        } else {
          // stderr 为空时 stdout 里的 result.subtype（error_max_turns / error_during_execution …）是唯一的失败原因线索；
          // 执行期错误按 503 抛出（llm-client 据此重试），其余沿用退出码
          const streamError = stderrData.trim() ? null : describeStreamErrorResult(stdoutData);
          const errorMsg = stderrData.trim() || streamError?.message || `退出码 ${code}`;
          const retryable = streamError?.subtype !== null && streamError?.subtype !== undefined && RETRYABLE_RESULT_SUBTYPES.has(streamError.subtype);
          // 旧版 CLI 不认识隔离旗标时直接失败（fail-loud）：把「该升级」说清楚，而不是静默退回带 67k 开销的调用
          const unknownOption = /unknown option '?(--[a-z-]+)/i.exec(stderrData);
          const hint = unknownOption
            ? `；Claude CLI 版本过旧，不支持 ${unknownOption[1]}，请升级 Claude Code（本仓实测 ≥ ${MIN_TESTED_CLAUDE_CLI_VERSION}）`
            : '';
          reject(
            new LLMResponseError(
              `Claude CLI 错误 (exit ${code}): ${errorMsg}${hint}`,
              retryable ? 503 : (code ?? undefined),
            ),
          );
          return;
        }
      }

      // 解析 stream-json 输出
      try {
        const result = parseStreamJsonOutput(stdoutData, cfg.model, duration);
        resolve(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 执行期错误（过载 / 网络）按 503 抛出，llm-client 的 isRetryableError 据此重试
        const statusCode = err instanceof StreamResultError && err.subtype !== null && RETRYABLE_RESULT_SUBTYPES.has(err.subtype) ? 503 : undefined;
        reject(new LLMResponseError(`解析 CLI 输出失败: ${msg}`, statusCode));
      }
    });
  });
}

// ============================================================
// 输出解析
// ============================================================

/** result 行是否是 Claude CLI 判定的失败（`is_error` 或非 success 的 subtype，两者独立成立）——唯一的谓词定义点。 */
function isErrorResultMessage(msg: StreamMessage): boolean {
  return msg.type === 'result' && (msg.is_error === true || (typeof msg.subtype === 'string' && msg.subtype !== 'success'));
}

/** 过载 / 网络 / 执行期错误：与 5xx 同类，值得 llm-client 重试（而不是一次都不试就降级成 AST-only，delta 复审 W-Δ8） */
const RETRYABLE_RESULT_SUBTYPES = new Set(['error_during_execution']);

/** stream-json 解析层抛出的错误：携带 subtype 让上层决定重试与可见性 */
class StreamResultError extends Error {
  constructor(message: string, public readonly subtype: string | null) {
    super(message);
    this.name = 'StreamResultError';
  }
}

/** stream-json 里带错误标记的 result 行 → 人读原因 + subtype；没有则 null。供非零退出且 stderr 为空时补充错误信息与重试分类。 */
function describeStreamErrorResult(raw: string): { message: string; subtype: string | null } | null {
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line) as StreamMessage;
    } catch {
      continue;
    }
    if (isErrorResultMessage(msg)) {
      return { message: `Claude CLI 返回错误结果（subtype=${msg.subtype ?? 'unknown'}）`, subtype: typeof msg.subtype === 'string' ? msg.subtype : null };
    }
  }
  return null;
}

/** assistant 消息正文：对象形态取 content[].text，字符串形态原样；其余形态视为无正文（此前对象被 `+=` 成 "[object Object]"）。 */
function extractAssistantText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message === null || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block !== null && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
      ? (block as { text: string }).text
      : ''))
    .join('');
}

/**
 * 解析 claude --output-format stream-json 的输出
 *
 * stream-json 格式：每行一个 JSON 对象
 * 最终输出包含 type: "result" 的消息
 *
 * M11 卡 E 对抗审查回补（C-2）：result 的 `is_error` / 非 success 的 `subtype` 一律抛错——此前 `subtype` 只声明不读，
 * `error_max_turns` / `error_during_execution`（过载 / OAuth 过期 / 网络）形态 exit 1、stderr 为空、无 result 字段，
 * 会一路 resolve 成「[object Object]」或整段 stream-JSON 原文，被 parseLLMResponse 当成 9 个空章节的"半可信"spec。
 */
function parseStreamJsonOutput(
  raw: string,
  fallbackModel: string,
  duration: number,
): LLMResponse {
  const lines = raw.split('\n').filter((line) => line.trim());
  let content = '';
  let model = fallbackModel;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let reportedCostUsd: number | undefined;
  let sawJsonLine = false;
  let loadedTools = 0;
  let loadedMcpServers = 0;

  for (const line of lines) {
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line) as StreamMessage;
    } catch {
      // 非 JSON 行，跳过
      continue;
    }
    sawJsonLine = true;

    // system/init：CLI 自报加载了什么。隔离旗标失效（版本漂移让 `--tools ''` 不再表示全禁等）只在这里可见（对抗审查 W-10）
    if (msg.type === 'system' && msg.subtype === 'init') {
      loadedTools = Array.isArray(msg.tools) ? msg.tools.length : 0;
      loadedMcpServers = Array.isArray(msg.mcp_servers) ? msg.mcp_servers.length : 0;
      continue;
    }

    // result 类型包含最终结果
    if (msg.type === 'result') {
      if (isErrorResultMessage(msg)) {
        const detail = typeof msg.result === 'string' && msg.result.length > 0 ? `: ${msg.result.slice(0, 200)}` : '';
        throw new StreamResultError(`Claude CLI 返回错误结果（subtype=${msg.subtype ?? 'unknown'}）${detail}`, typeof msg.subtype === 'string' ? msg.subtype : null);
      }
      if (msg.result) {
        content = msg.result;
      }
      if (msg.model) {
        model = msg.model;
      }
      if (typeof msg.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd)) {
        reportedCostUsd = msg.total_cost_usd;
      }
      // Feature 133 P0-1 修复：优先从嵌套 usage 字段读取（Claude CLI 当前格式），
      // 回落到顶层字段（向后兼容）。原实现仅读顶层导致 frontmatter token 全为 0。
      // Fix 134：input 累加 cache_creation_input_tokens + cache_read_input_tokens，
      // 因 prompt caching 启用时主输入会进 cache_read_input_tokens，input_tokens
      // 主字段只剩"非 cached"增量部分（5 模块累计 input=30 vs output=35,759 异常）。
      const usage = msg.usage;
      const hasAnyInputField = usage !== undefined
        && (usage.input_tokens !== undefined
          || usage.cache_creation_input_tokens !== undefined
          || usage.cache_read_input_tokens !== undefined);
      const inputFromUsage = hasAnyInputField
        ? (usage?.input_tokens ?? 0)
          + (usage?.cache_creation_input_tokens ?? 0)
          + (usage?.cache_read_input_tokens ?? 0)
        : undefined;
      const outputFromUsage = usage?.output_tokens;
      if (inputFromUsage !== undefined) {
        inputTokens = inputFromUsage;
        // M11 卡 E：三项单价不同（缓存创建按 TTL 1.25× 或 2×——Claude Code 2.1.270 全落 1 小时档 2×；缓存读取 0.1×），单列暴露给成本口径；真值以 total_cost_usd 为准
        cacheCreationInputTokens = usage?.cache_creation_input_tokens ?? 0;
        cacheReadInputTokens = usage?.cache_read_input_tokens ?? 0;
      } else if (msg.input_tokens !== undefined) {
        inputTokens = msg.input_tokens;
      }
      if (outputFromUsage !== undefined) {
        outputTokens = outputFromUsage;
      } else if (msg.output_tokens !== undefined) {
        outputTokens = msg.output_tokens;
      }
      continue;
    }

    // content_block_delta 类型包含增量文本
    if (msg.type === 'content_block_delta' && msg.delta?.text) {
      content += msg.delta.text;
      continue;
    }

    // assistant 消息
    if (msg.type === 'assistant' && msg.message !== undefined) {
      content += extractAssistantText(msg.message);
      continue;
    }
  }

  if ((loadedTools > 0 || loadedMcpServers > 0) && !warnedIsolationIneffective) {
    warnedIsolationIneffective = true;
    console.warn(`[cli-proxy] 隔离旗标未生效：Claude CLI 仍加载了 ${loadedTools} 个工具 / ${loadedMcpServers} 个 MCP server，每次调用都在为 harness 开销付费；请核对 Claude Code 版本（本仓实测 ${MIN_TESTED_CLAUDE_CLI_VERSION}）`);
  }

  // 只有整段输出根本不是 stream-json（--print 文本模式）时才把原文当正文；解析到了 JSON 行却没有正文就是空结果
  if (!content && !sawJsonLine && raw.trim()) {
    content = raw.trim();
  }

  if (!content) {
    throw new Error(sawJsonLine ? 'CLI 输出为空（stream-json 里没有 result 正文）' : 'CLI 输出为空');
  }

  return {
    content,
    model,
    inputTokens,
    outputTokens,
    duration,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    ...(reportedCostUsd !== undefined ? { reportedCostUsd } : {}),
  };
}
