/**
 * Codex CLI 代理
 * 通过 spawn Codex CLI 子进程间接调用 LLM
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LLMResponse } from '../core/llm-client.js';
import {
  LLMRateLimitError,
  LLMResponseError,
  LLMTimeoutError,
  LLMUnavailableError,
  getTimeoutForModel,
} from '../core/llm-client.js';
import { resolveCodexExecutionConfig } from '../core/model-selection.js';

export interface CodexCLIProxyConfig {
  /** Codex 模型 ID */
  model: string;
  /** 超时时间（毫秒） */
  timeout: number;
  /** 推理强度 */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** 服务层级 */
  serviceTier?: string;
  /** Codex CLI 可执行文件路径（undefined 则自动检测） */
  cliPath?: string;
  /** Codex exec 的工作目录 */
  cwd?: string;
}

interface CodexJsonEvent {
  type: string;
  item?: {
    type?: string;
    text?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  result?: string;
  is_error?: boolean;
}

interface ParsedCodexOutput {
  content: string;
  inputTokens: number;
  outputTokens: number;
  isError: boolean;
  errorMessage?: string;
}

export function getDefaultCodexCLIProxyConfig(): CodexCLIProxyConfig {
  const resolved = resolveCodexExecutionConfig();
  return {
    model: resolved.model,
    timeout: getTimeoutForModel(resolved.model),
    reasoningEffort: resolved.reasoningEffort,
    serviceTier: resolved.serviceTier,
    cwd: process.cwd(),
  };
}

export function callLLMviaCodex(
  prompt: string,
  config: Partial<CodexCLIProxyConfig> = {},
): Promise<LLMResponse> {
  const cfg: CodexCLIProxyConfig = { ...getDefaultCodexCLIProxyConfig(), ...config };
  const cliPath = cfg.cliPath ?? 'codex';
  const outputLastMessagePath = path.join(
    os.tmpdir(),
    `reverse-spec-codex-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  return new Promise<LLMResponse>((resolve, reject) => {
    const startTime = Date.now();
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let settled = false;

    const childEnv = { ...process.env };
    delete childEnv['ANTHROPIC_API_KEY'];

    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '--color', 'never',
      '--output-last-message', outputLastMessagePath,
      '--model', cfg.model,
    ];

    if (cfg.reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${JSON.stringify(cfg.reasoningEffort)}`);
    }

    if (cfg.serviceTier) {
      args.push('-c', `service_tier=${JSON.stringify(cfg.serviceTier)}`);
    }

    args.push(
      '-C', cfg.cwd ?? process.cwd(),
      '-',
    );

    let child;
    try {
      child = spawn(cliPath, args, {
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      cleanupOutputFile(outputLastMessagePath);
      const msg = err instanceof Error ? err.message : String(err);
      reject(new LLMUnavailableError(`无法启动 Codex CLI: ${msg}`));
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 3_000);
    }, cfg.timeout);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupOutputFile(outputLastMessagePath);
      reject(new LLMUnavailableError(`Codex CLI 进程错误: ${err.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      if (timedOut) {
        cleanupOutputFile(outputLastMessagePath);
        reject(new LLMTimeoutError(`Codex CLI 超时 (${cfg.timeout}ms)`));
        return;
      }

      try {
        const parsed = parseCodexExecOutput(
          stdoutData,
          cfg.model,
          outputLastMessagePath,
        );
        cleanupOutputFile(outputLastMessagePath);

        if (parsed.isError) {
          const message = parsed.errorMessage || parsed.content || stderrData.trim() || 'Codex CLI 返回错误';
          if (/rate limit|extra usage|quota|credits/i.test(message)) {
            reject(new LLMRateLimitError(message));
            return;
          }
          reject(new LLMResponseError(message, code ?? undefined));
          return;
        }

        if (code !== 0) {
          const errorMsg = stderrData.trim() || parsed.errorMessage || `退出码 ${code}`;
          reject(new LLMResponseError(`Codex CLI 错误 (exit ${code}): ${errorMsg}`, code ?? undefined));
          return;
        }

        resolve({
          content: parsed.content,
          model: cfg.model,
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          duration,
        });
      } catch (err) {
        cleanupOutputFile(outputLastMessagePath);
        const msg = err instanceof Error ? err.message : String(err);
        reject(new LLMResponseError(`解析 Codex CLI 输出失败: ${msg}`, code ?? undefined));
      }
    });
  });
}

function parseCodexExecOutput(
  raw: string,
  fallbackModel: string,
  outputLastMessagePath: string,
): ParsedCodexOutput {
  const lines = raw.split('\n').filter((line) => line.trim());
  let content = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let isError = false;
  let errorMessage = '';

  for (const line of lines) {
    let event: CodexJsonEvent;
    try {
      event = JSON.parse(line) as CodexJsonEvent;
    } catch {
      continue;
    }

    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
      content = event.item.text;
      continue;
    }

    if (event.type === 'turn.completed' && event.usage) {
      inputTokens = event.usage.input_tokens ?? inputTokens;
      outputTokens = event.usage.output_tokens ?? outputTokens;
      continue;
    }

    if (event.type === 'result') {
      isError = event.is_error === true;
      if (event.result) {
        errorMessage = event.result;
      }
    }
  }

  const outputLastMessage = readOutputLastMessage(outputLastMessagePath);
  if (outputLastMessage) {
    content = outputLastMessage;
  }

  if (!content && !errorMessage) {
    throw new Error(`Codex CLI 输出为空 (${fallbackModel})`);
  }

  return {
    content,
    inputTokens,
    outputTokens,
    isError,
    errorMessage: errorMessage || undefined,
  };
}

function readOutputLastMessage(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function cleanupOutputFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // ignore cleanup failure
  }
}
