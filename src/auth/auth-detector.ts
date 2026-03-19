/**
 * 认证检测器
 * 检测 API Key 和 Claude CLI 可用性，确定 LLM 调用方式
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveReverseSpecRuntime } from '../core/model-selection.js';

// ============================================================
// 类型定义
// ============================================================

/** 认证方式 */
export interface AuthMethod {
  /** 认证类型 */
  type: 'api-key' | 'cli-proxy';
  /** 底层提供方 */
  provider?: 'anthropic' | 'claude' | 'codex';
  /** 是否可用 */
  available: boolean;
  /** 描述信息（如 API Key 前缀、CLI 版本） */
  details: string;
}

/** 认证检测结果 */
export interface AuthDetectionResult {
  /** 检测到的所有认证方式（按优先级排序） */
  methods: AuthMethod[];
  /** 最高优先级的可用方式，无可用时为 null */
  preferred: AuthMethod | null;
  /** 诊断信息（用于 auth-status 和错误提示） */
  diagnostics: string[];
}

// ============================================================
// 内部辅助
// ============================================================

/**
 * 掩码 API Key，仅显示前缀和末尾
 */
function maskApiKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '****';
  return key.slice(0, 10) + '...' + key.slice(-4);
}

/**
 * 检测 claude CLI 是否在 PATH 中
 */
function findCliPath(command: 'claude' | 'codex'): string | null {
  try {
    const result = execSync(`which ${command}`, {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * 获取 claude CLI 版本
 */
function getCliVersion(cliPath: string): string | null {
  try {
    const result = execSync(`"${cliPath}" --version`, {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

function getHomeDir(): string {
  return process.env['HOME'] || process.env['USERPROFILE'] || '';
}

/**
 * 检测 claude CLI 是否已登录
 *
 * Claude Code v2.x 没有非交互式的 `auth status` 命令，
 * 大多数子命令需要 TTY（Ink 终端 UI）。
 *
 * 检测策略：
 * - macOS：检查 Keychain 中是否存在 "Claude Code-credentials" 条目
 * - Linux/其他：检查 ~/.claude/ 下是否存在凭证文件
 */
function isCliAuthenticated(): boolean {
  try {
    if (process.platform === 'darwin') {
      // macOS：检查 Keychain 中的 Claude Code 凭证
      execSync('security find-generic-password -s "Claude Code-credentials"', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    }

    // Linux / Windows：检查常见凭证存储路径
    const home = getHomeDir();
    if (home) {
      const credPaths = [
        join(home, '.claude', 'credentials.json'),
        join(home, '.claude', '.credentials'),
      ];
      return credPaths.some((p) => existsSync(p));
    }

    return false;
  } catch {
    return false;
  }
}

function isCodexAuthenticated(): boolean {
  const home = getHomeDir();
  if (!home) return false;
  return existsSync(join(home, '.codex', 'auth.json'));
}

function getPriorityOrder(): Array<'api-key' | 'claude-cli' | 'codex-cli'> {
  const runtime = resolveReverseSpecRuntime().runtime;
  if (runtime === 'codex') {
    return ['codex-cli', 'api-key', 'claude-cli'];
  }
  return ['api-key', 'claude-cli', 'codex-cli'];
}

function getPriorityLabel(order: Array<'api-key' | 'claude-cli' | 'codex-cli'>): string {
  return order.map((item) => {
    switch (item) {
      case 'api-key':
        return 'API Key';
      case 'claude-cli':
        return 'Claude CLI';
      case 'codex-cli':
        return 'Codex CLI';
    }
  }).join(' > ');
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 检测当前环境可用的认证方式
 *
 * 优先级：API Key > CLI Proxy
 *
 * @returns 认证检测结果
 */
export function detectAuth(): AuthDetectionResult {
  const methods: AuthMethod[] = [];
  const diagnostics: string[] = [];

  // 1. 检查 ANTHROPIC_API_KEY
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey && apiKey.trim()) {
    methods.push({
      type: 'api-key',
      provider: 'anthropic',
      available: true,
      details: `已设置 (${maskApiKey(apiKey)})`,
    });
    diagnostics.push(`ANTHROPIC_API_KEY: 已设置 (${maskApiKey(apiKey)})`);
  } else {
    methods.push({
      type: 'api-key',
      provider: 'anthropic',
      available: false,
      details: '未设置',
    });
    diagnostics.push('ANTHROPIC_API_KEY: 未设置');
  }

  // 2. 检查 Codex CLI
  const codexPath = findCliPath('codex');
  if (!codexPath) {
    methods.push({
      type: 'cli-proxy',
      provider: 'codex',
      available: false,
      details: '未安装',
    });
    diagnostics.push('Codex CLI: 未安装');
  } else {
    const version = getCliVersion(codexPath);
    const versionStr = version ? ` (${version})` : '';
    const authenticated = isCodexAuthenticated();
    if (authenticated) {
      methods.push({
        type: 'cli-proxy',
        provider: 'codex',
        available: true,
        details: `已安装${versionStr}, 已登录`,
      });
      diagnostics.push(`Codex CLI: 已安装${versionStr}, 已登录`);
    } else {
      methods.push({
        type: 'cli-proxy',
        provider: 'codex',
        available: false,
        details: `已安装${versionStr}, 未登录`,
      });
      diagnostics.push(`Codex CLI: 已安装${versionStr}, 未登录`);
    }
  }

  // 3. 检查 Claude CLI
  const claudePath = findCliPath('claude');
  if (!claudePath) {
    methods.push({
      type: 'cli-proxy',
      provider: 'claude',
      available: false,
      details: '未安装',
    });
    diagnostics.push('Claude CLI: 未安装');
  } else {
    const version = getCliVersion(claudePath);
    const versionStr = version ? ` (${version})` : '';
    const authenticated = isCliAuthenticated();
    if (authenticated) {
      methods.push({
        type: 'cli-proxy',
        provider: 'claude',
        available: true,
        details: `已安装${versionStr}, 已登录`,
      });
      diagnostics.push(`Claude CLI: 已安装${versionStr}, 已登录`);
    } else {
      methods.push({
        type: 'cli-proxy',
        provider: 'claude',
        available: false,
        details: `已安装${versionStr}, 未登录`,
      });
      diagnostics.push(`Claude CLI: 已安装${versionStr}, 未登录`);
    }
  }

  // 确定首选方式（根据当前运行时动态排序）
  const priorityOrder = getPriorityOrder();
  const preferred = priorityOrder
    .map((key) => methods.find((method) =>
      key === 'api-key'
        ? method.type === 'api-key'
        : method.type === 'cli-proxy' && method.provider === (key === 'codex-cli' ? 'codex' : 'claude'),
    ))
    .find((method) => method?.available) ?? null;

  if (!preferred) {
    diagnostics.push('未找到可用的认证方式');
  } else {
    diagnostics.push(`优先级: ${getPriorityLabel(priorityOrder)}`);
  }

  return { methods, preferred, diagnostics };
}

/**
 * 在线验证认证方式（--verify 模式）
 *
 * 实际测试连接，确认认证凭证有效
 *
 * @returns 验证后的认证结果
 */
export async function verifyAuth(): Promise<AuthDetectionResult> {
  const result = detectAuth();
  const verifiedDiagnostics: string[] = [];

  for (const method of result.methods) {
    if (!method.available) {
      verifiedDiagnostics.push(
        method.type === 'api-key'
          ? `ANTHROPIC_API_KEY: ${method.details}`
          : `${method.provider === 'codex' ? 'Codex CLI' : 'Claude CLI'}: ${method.details}`,
      );
      continue;
    }

    if (method.type === 'api-key') {
      // 验证 API Key：发送一个简单的请求
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({
          apiKey: process.env['ANTHROPIC_API_KEY'],
          timeout: 10_000,
        });
        await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
        method.details = `已设置, 已验证可用`;
        verifiedDiagnostics.push(`ANTHROPIC_API_KEY: 已设置, 已验证可用`);
      } catch (err) {
        method.available = false;
        const msg = err instanceof Error ? err.message : String(err);
        method.details = `已设置, 验证失败: ${msg}`;
        verifiedDiagnostics.push(`ANTHROPIC_API_KEY: 已设置, 验证失败: ${msg}`);
      }
    } else if (method.type === 'cli-proxy' && method.provider === 'claude') {
      // 验证 CLI：执行一个简单的 --print 调用
      try {
        execSync('claude --print "ping"', {
          encoding: 'utf-8',
          timeout: 30_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        method.details = `${method.details}, 已验证可用`;
        verifiedDiagnostics.push(`Claude CLI: ${method.details}`);
      } catch (err) {
        method.available = false;
        const msg = err instanceof Error ? err.message : String(err);
        method.details = `${method.details}, 验证失败: ${msg}`;
        verifiedDiagnostics.push(`Claude CLI: ${method.details}`);
      }
    } else if (method.type === 'cli-proxy' && method.provider === 'codex') {
      try {
        execSync(
          `printf 'Reply with exactly: pong' | codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only --color never -C /tmp -`,
          {
            encoding: 'utf-8',
            timeout: 30_000,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        method.details = `${method.details}, 已验证可用`;
        verifiedDiagnostics.push(`Codex CLI: ${method.details}`);
      } catch (err) {
        method.available = false;
        const msg = err instanceof Error ? err.message : String(err);
        method.details = `${method.details}, 验证失败: ${msg}`;
        verifiedDiagnostics.push(`Codex CLI: ${method.details}`);
      }
    }
  }

  // 重新确定首选
  const priorityOrder = getPriorityOrder();
  const preferred = priorityOrder
    .map((key) => result.methods.find((method) =>
      key === 'api-key'
        ? method.type === 'api-key'
        : method.type === 'cli-proxy' && method.provider === (key === 'codex-cli' ? 'codex' : 'claude'),
    ))
    .find((method) => method?.available) ?? null;
  verifiedDiagnostics.push(
    preferred
      ? `优先级: ${getPriorityLabel(priorityOrder)}`
      : '未找到可用的认证方式',
  );

  return {
    methods: result.methods,
    preferred,
    diagnostics: verifiedDiagnostics,
  };
}
