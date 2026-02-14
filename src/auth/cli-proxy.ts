/**
 * CLI 代理
 * 通过 spawn Claude Code CLI 子进程间接调用 LLM
 * 参考 claude-max-api-proxy 方案
 */

import { spawn } from 'node:child_process';
import type { LLMResponse } from '../core/llm-client.js';
import {
  LLMTimeoutError,
  LLMResponseError,
  LLMUnavailableError,
  getTimeoutForModel,
} from '../core/llm-client.js';

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
}

/** stream-json 输出中的消息事件 */
interface StreamMessage {
  type: string;
  subtype?: string;
  // result 类型的字段
  result?: string;
  model?: string;
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
  // assistant 类型的消息
  message?: string;
  content?: string;
}

// ============================================================
// 默认配置
// ============================================================

/** 获取默认 CLI 代理配置 */
export function getDefaultCLIProxyConfig(): CLIProxyConfig {
  const model = process.env['REVERSE_SPEC_MODEL'] ?? 'claude-sonnet-4-5-20250929';
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

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', cfg.model,
    ];

    let child;
    try {
      child = spawn(cliPath, args, {
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
        const errorMsg = stderrData.trim() || `退出码 ${code}`;
        reject(
          new LLMResponseError(
            `Claude CLI 错误 (exit ${code}): ${errorMsg}`,
            code ?? undefined,
          ),
        );
        return;
      }

      // 解析 stream-json 输出
      try {
        const result = parseStreamJsonOutput(stdoutData, cfg.model, duration);
        resolve(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new LLMResponseError(`解析 CLI 输出失败: ${msg}`));
      }
    });
  });
}

// ============================================================
// 输出解析
// ============================================================

/**
 * 解析 claude --output-format stream-json 的输出
 *
 * stream-json 格式：每行一个 JSON 对象
 * 最终输出包含 type: "result" 的消息
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

  for (const line of lines) {
    let msg: StreamMessage;
    try {
      msg = JSON.parse(line) as StreamMessage;
    } catch {
      // 非 JSON 行，跳过
      continue;
    }

    // result 类型包含最终结果
    if (msg.type === 'result') {
      if (msg.result) {
        content = msg.result;
      }
      if (msg.model) {
        model = msg.model;
      }
      if (msg.input_tokens !== undefined) {
        inputTokens = msg.input_tokens;
      }
      if (msg.output_tokens !== undefined) {
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
    if (msg.type === 'assistant' && msg.message) {
      content += msg.message;
      continue;
    }
  }

  // 如果没有通过 stream 解析到内容，尝试直接使用原始输出
  if (!content && raw.trim()) {
    // 可能输出不是 JSON stream 格式（--print 模式直接输出文本）
    content = raw.trim();
  }

  if (!content) {
    throw new Error('CLI 输出为空');
  }

  return {
    content,
    model,
    inputTokens,
    outputTokens,
    duration,
  };
}
