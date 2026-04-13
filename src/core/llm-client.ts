/**
 * LLM 客户端
 * LLM API 封装：callLLM、parseLLMResponse、buildSystemPrompt
 * 支持三种调用策略：Anthropic SDK、Claude CLI 代理、Codex CLI 代理
 * 参见 contracts/llm-client.md
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SpecSections } from '../models/module-spec.js';
import type { LanguageTerminology } from '../adapters/language-adapter.js';
import type { AssembledContext } from './context-assembler.js';
import { detectAuth } from '../auth/auth-detector.js';
import { callLLMviaCli as cliProxyCall } from '../auth/cli-proxy.js';
import { callLLMviaCodex as codexProxyCall } from '../auth/codex-proxy.js';
import { resolveCodexExecutionConfig, resolveReverseSpecModel } from './model-selection.js';

// ============================================================
// 配置类型
// ============================================================

export interface LLMConfig {
  /** 模型 ID（优先级: REVERSE_SPEC_MODEL > spec-driver.config.yaml > 默认值） */
  model: string;
  /** API Key（默认从 ANTHROPIC_API_KEY 环境变量获取） */
  apiKey?: string;
  /** 响应最大 token 数（默认 8192） */
  maxTokensResponse: number;
  /** 温度（默认 0.3，低温用于事实性提取） */
  temperature: number;
  /** 超时时间（毫秒，默认根据模型动态计算：Sonnet 120s, Opus 300s, Haiku 60s） */
  timeout: number;
  /** Codex 推理强度（仅 Codex CLI provider 使用） */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  /** Codex 服务层级（仅 Codex CLI provider 使用） */
  serviceTier?: string;
  /** 目标语言术语（可选，用于参数化 LLM prompt） */
  languageTerminology?: LanguageTerminology;
}

export interface LLMResponse {
  /** LLM 原始文本响应 */
  content: string;
  /** 实际使用的模型 */
  model: string;
  /** 发送的 token 数 */
  inputTokens: number;
  /** 接收的 token 数 */
  outputTokens: number;
  /** 请求耗时（毫秒） */
  duration: number;
}

// ============================================================
// 解析结果类型
// ============================================================

export interface UncertaintyMarker {
  type: '推断' | '不明确' | 'SYNTAX ERROR';
  section: string;
  rationale: string;
}

export interface ParsedSpecSections {
  sections: SpecSections;
  uncertaintyMarkers: UncertaintyMarker[];
  parseWarnings: string[];
}

// ============================================================
// 错误类型
// ============================================================

export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}

export class LLMRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMRateLimitError';
  }
}

export class LLMResponseError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'LLMResponseError';
  }
}

export class LLMTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMTimeoutError';
  }
}

// ============================================================
// 重试事件类型
// ============================================================

/** LLM 重试事件 */
export interface RetryEvent {
  /** 当前尝试次数（从 1 开始） */
  attempt: number;
  /** 最大尝试次数 */
  maxAttempts: number;
  /** 触发重试的错误类型 */
  errorType: 'timeout' | 'rate-limit' | 'server-error';
  /** 下一次尝试前的等待时间（毫秒） */
  delay: number;
}

/** 重试事件回调 */
export type RetryCallback = (event: RetryEvent) => void;

// ============================================================
// 模型超时策略
// ============================================================

/**
 * 根据模型名称返回合理的超时时间
 *
 * 基于实测数据：
 * - Opus: spec 生成通常 >120s，需要更长超时
 * - GPT-5 / Codex: 中大型模块 spec 生成实测可超过 180s
 * - Sonnet: 大模块 spec 生成可能超过 4 分钟，给 10 分钟裕量
 * - Haiku: 响应极快
 * - 未知模型: 保守默认值
 */
export function getTimeoutForModel(model: string): number {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes('opus')) return 300_000;   // 5 分钟
  if (lowerModel.startsWith('gpt-5')) return 300_000; // 5 分钟
  if (lowerModel.includes('codex')) return 300_000;  // 5 分钟
  if (lowerModel.includes('sonnet')) return 600_000;  // 10 分钟（中大型模块实测 3-8 分钟）
  if (lowerModel.includes('haiku')) return 60_000;    // 1 分钟
  return 180_000;                                      // 3 分钟（保守默认）
}

/**
 * 为 spec 生成按上下文体积扩展超时窗口。
 *
 * 质量优先策略：
 * - 小上下文保持原模型默认超时，避免日常请求变慢
 * - 超过 40k token 后，每额外 15k token 增加 2 分钟窗口
 * - 上限控制在 15 分钟，避免无限等待
 */
export function getTimeoutForSpecGeneration(model: string, contextTokenCount: number): number {
  const baseTimeout = getTimeoutForModel(model);

  if (contextTokenCount <= 40_000) {
    return baseTimeout;
  }

  const extraWindows = Math.ceil((contextTokenCount - 40_000) / 15_000);
  const expandedTimeout = baseTimeout + extraWindows * 120_000;

  return Math.min(Math.max(baseTimeout, expandedTimeout), 900_000);
}

// ============================================================
// 默认配置
// ============================================================

function getDefaultConfig(): LLMConfig {
  const { model } = resolveReverseSpecModel();
  return {
    model,
    apiKey: process.env['ANTHROPIC_API_KEY'],
    maxTokensResponse: 8192,
    temperature: 0.3,
    timeout: getTimeoutForModel(model),
  };
}

function mergeConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  const defaults = getDefaultConfig();
  return { ...defaults, ...overrides };
}

// ============================================================
// 重试逻辑
// ============================================================

/**
 * 指数退避延时
 */
function getRetryDelay(attempt: number): number {
  const base = 2000; // 2 秒
  const multiplier = 2;
  const maxDelay = 30_000; // 30 秒
  return Math.min(base * Math.pow(multiplier, attempt), maxDelay);
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(error: any): boolean {
  if (error instanceof LLMRateLimitError) return true;
  if (error instanceof LLMTimeoutError) return true;
  // 5xx 服务端错误
  if (error?.status >= 500) return true;
  if (error?.statusCode >= 500) return true;
  return false;
}

/**
 * 延时
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 将组装好的上下文发送至 Claude API
 *
 * 策略模式：根据认证检测结果自动选择调用方式
 * - API Key 可用 → 通过 Anthropic SDK 直接调用
 * - Claude CLI 可用 → 通过 spawn Claude CLI 子进程间接调用
 * - Codex CLI 可用 → 通过 spawn Codex CLI 子进程间接调用
 *
 * @param context - assembleContext() 的输出
 * @param config - 可选的配置覆盖
 * @param onRetry - 可选的重试事件回调
 * @returns LLM 响应
 * @throws LLMUnavailableError, LLMRateLimitError, LLMResponseError, LLMTimeoutError
 */
export async function callLLM(
  context: AssembledContext,
  config?: Partial<LLMConfig>,
  onRetry?: RetryCallback,
): Promise<LLMResponse> {
  const authResult = detectAuth();

  if (!authResult.preferred) {
    throw new LLMUnavailableError(
      '未找到可用的认证方式。请设置 ANTHROPIC_API_KEY，或登录 Claude Code / Codex CLI。',
    );
  }

  const providerRuntime = authResult.preferred.type === 'cli-proxy' && authResult.preferred.provider === 'codex'
    ? 'codex'
    : 'claude';
  const resolvedProviderModel = resolveReverseSpecModel({ provider: providerRuntime }).model;
  const codexExecution = providerRuntime === 'codex'
    ? resolveCodexExecutionConfig()
    : undefined;
  const effectiveModel = config?.model ?? codexExecution?.model ?? resolvedProviderModel;
  const cfg = mergeConfig({
    ...config,
    model: effectiveModel,
    timeout: config?.timeout ?? getTimeoutForSpecGeneration(effectiveModel, context.tokenCount),
    reasoningEffort: config?.reasoningEffort ?? codexExecution?.reasoningEffort,
    serviceTier: config?.serviceTier ?? codexExecution?.serviceTier,
  });

  if (authResult.preferred.type === 'api-key') {
    return callLLMviaSdk(context, cfg, onRetry);
  }

  if (authResult.preferred.provider === 'codex') {
    return callLLMviaCodexProxy(context, cfg, onRetry);
  }

  // Claude CLI proxy 策略
  return callLLMviaCliProxy(context, cfg, onRetry);
}

/**
 * 通过 Anthropic SDK 直接调用 LLM（API Key 方式）
 */
async function callLLMviaSdk(
  context: AssembledContext,
  cfg: LLMConfig,
  onRetry?: RetryCallback,
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt('spec-generation', cfg.languageTerminology);

  const client = new Anthropic({
    apiKey: cfg.apiKey,
    timeout: cfg.timeout,
  });

  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(getRetryDelay(attempt - 1));
    }

    const startTime = Date.now();

    try {
      const response = await client.messages.create({
        model: cfg.model,
        max_tokens: cfg.maxTokensResponse,
        temperature: cfg.temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: context.prompt }],
      });

      const duration = Date.now() - startTime;
      const content =
        response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('\n') || '';

      return {
        content,
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // 分类错误
      if (error?.status === 429) {
        lastError = new LLMRateLimitError(`速率限制: ${error.message}`);
      } else if (duration >= cfg.timeout || error?.code === 'ETIMEDOUT') {
        lastError = new LLMTimeoutError(`请求超时 (${cfg.timeout}ms): ${error.message}`);
      } else if (error?.status >= 500) {
        lastError = new LLMResponseError(`服务器错误 (${error.status}): ${error.message}`, error.status);
      } else {
        // 非可重试错误，立即抛出
        throw new LLMResponseError(
          `API 错误: ${error.message}`,
          error?.status,
        );
      }

      // 超时错误：最多 2 次尝试（attempt >= 1 时跳出）
      if (lastError instanceof LLMTimeoutError && attempt >= 1) {
        break;
      }

      if (!isRetryableError(lastError) || attempt === maxAttempts - 1) {
        break;
      }

      // 即将重试，触发回调
      const delay = getRetryDelay(attempt);
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        errorType: lastError instanceof LLMTimeoutError ? 'timeout'
          : lastError instanceof LLMRateLimitError ? 'rate-limit'
          : 'server-error',
        delay,
      });
    }
  }

  throw new LLMUnavailableError(
    `${maxAttempts} 次尝试后仍无法访问 API: ${lastError?.message}`,
  );
}

/**
 * 通过 Claude CLI 子进程调用 LLM（订阅用户 CLI 代理方式）
 */
async function callLLMviaCliProxy(
  context: AssembledContext,
  cfg: LLMConfig,
  onRetry?: RetryCallback,
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt('spec-generation', cfg.languageTerminology);
  // 将系统提示和用户内容组合为完整 prompt
  const fullPrompt = `${systemPrompt}\n\n---\n\n${context.prompt}`;

  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(getRetryDelay(attempt - 1));
    }

    try {
      return await cliProxyCall(fullPrompt, {
        model: cfg.model,
        timeout: cfg.timeout,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 超时错误：最多 2 次尝试（attempt >= 1 时跳出）
      if (lastError instanceof LLMTimeoutError && attempt >= 1) {
        break;
      }

      if (!isRetryableError(lastError) || attempt === maxAttempts - 1) {
        break;
      }

      // 即将重试，触发回调
      const delay = getRetryDelay(attempt);
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        errorType: lastError instanceof LLMTimeoutError ? 'timeout'
          : lastError instanceof LLMRateLimitError ? 'rate-limit'
          : 'server-error',
        delay,
      });
    }
  }

  throw new LLMUnavailableError(
    `${maxAttempts} 次尝试后仍无法访问 CLI 代理: ${lastError?.message}`,
  );
}

/**
 * 通过 Codex CLI 子进程调用 LLM（Codex 运行时代理方式）
 */
async function callLLMviaCodexProxy(
  context: AssembledContext,
  cfg: LLMConfig,
  onRetry?: RetryCallback,
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt('spec-generation', cfg.languageTerminology);
  const fullPrompt = `${systemPrompt}\n\n---\n\n${context.prompt}`;

  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(getRetryDelay(attempt - 1));
    }

    try {
      return await codexProxyCall(fullPrompt, {
        model: cfg.model,
        timeout: cfg.timeout,
        reasoningEffort: cfg.reasoningEffort,
        serviceTier: cfg.serviceTier,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError instanceof LLMTimeoutError && attempt >= 1) {
        break;
      }

      if (!isRetryableError(lastError) || attempt === maxAttempts - 1) {
        break;
      }

      const delay = getRetryDelay(attempt);
      onRetry?.({
        attempt: attempt + 1,
        maxAttempts,
        errorType: lastError instanceof LLMTimeoutError ? 'timeout'
          : lastError instanceof LLMRateLimitError ? 'rate-limit'
          : 'server-error',
        delay,
      });
    }
  }

  throw new LLMUnavailableError(
    `${maxAttempts} 次尝试后仍无法访问 Codex CLI 代理: ${lastError?.message}`,
  );
}

// ============================================================
// 响应解析
// ============================================================

/** 9 个章节的中文/英文标题映射（含常见变体，提高匹配容错性） */
const SECTION_TITLES: Array<[keyof SpecSections, string[]]> = [
  ['intent', ['意图', 'Intent', 'Purpose', '目的', '概述']],
  ['businessLogic', ['业务逻辑', 'Business Logic', '核心逻辑', '实现逻辑', '逻辑', '处理流程', '数据流', '核心流程', '管线', '工作流', '核心算法']],
  ['interfaceDefinition', ['接口定义', 'Interface', 'API', '接口', '导出接口', '公共接口', '接口与导出', '模块接口', '对外接口', '接口设计']],
  ['dataStructures', ['数据结构', 'Data Structure', '类型定义', '数据模型', '类型']],
  ['constraints', ['约束条件', 'Constraint', '约束', '限制条件', '限制']],
  ['edgeCases', ['边界条件', 'Edge Case', '边界', '异常处理', '错误处理']],
  ['technicalDebt', ['技术债务', 'Technical Debt', '技术债', '改进空间', '待改进']],
  ['testCoverage', ['测试覆盖', 'Test Coverage', '测试', '测试策略', '测试建议']],
  ['dependencies', ['依赖关系', 'Dependenc', '依赖', '模块依赖', '外部依赖']],
];

/**
 * 解析 LLM 原始响应为结构化的规格章节
 *
 * @param raw - LLM 原始响应文本
 * @returns 解析后的结构化章节
 */
export function parseLLMResponse(raw: string): ParsedSpecSections {
  const sections: Record<string, string> = {};
  const parseWarnings: string[] = [];
  const uncertaintyMarkers: UncertaintyMarker[] = [];

  // 按标题模式分割响应
  // 支持 "## 1. 意图"、"## 意图"、"# 1. 意图" 等格式
  // 先标记代码块区域，避免匹配代码块内的 ## 标题（Fix-096）
  const codeBlockRegex = /^```[\s\S]*?^```/gm;
  const codeBlockRanges: Array<{ start: number; end: number }> = [];
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockRegex.exec(raw)) !== null) {
    codeBlockRanges.push({ start: cbMatch.index, end: cbMatch.index + cbMatch[0].length });
  }

  const sectionRegex = /^#{1,3}\s*(?:\d+\.\s*)?(.+?)$/gm;
  const matches: Array<{ title: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(raw)) !== null) {
    // 跳过代码块内的标题匹配
    const inCodeBlock = codeBlockRanges.some(r => match!.index >= r.start && match!.index < r.end);
    if (inCodeBlock) continue;
    matches.push({ title: match[1]!.trim(), index: match.index });
  }

  // 提取每个章节的内容
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]!;
    const nextIndex = matches[i + 1]?.index ?? raw.length;
    const content = raw
      .slice(current.index, nextIndex)
      .replace(/^#{1,3}\s*(?:\d+\.\s*)?.*$/m, '') // 移除标题行
      .trim();

    // 匹配到对应章节
    // 策略 1：标题文本匹配（容错：忽略大小写、标点、空格）
    const normalizedTitle = current.title.toLowerCase().replace(/[.、：:，,\s]/g, '');
    let matched = false;
    for (const [key, titles] of SECTION_TITLES) {
      if (titles.some((t) => {
        const normalized = t.toLowerCase().replace(/[.、：:，,\s]/g, '');
        return normalizedTitle.includes(normalized) || normalized.includes(normalizedTitle);
      })) {
        sections[key] = content;
        matched = true;
        break;
      }
    }

    // 策略 2：按章节编号匹配（fallback，处理 LLM 使用非标准标题的情况）
    if (!matched) {
      const numberMatch = /^(\d+)/.exec(current.title.trim());
      if (numberMatch) {
        const sectionNum = parseInt(numberMatch[1]!, 10);
        if (sectionNum >= 1 && sectionNum <= SECTION_TITLES.length) {
          const [key] = SECTION_TITLES[sectionNum - 1]!;
          if (!sections[key]) {
            sections[key] = content;
          }
        }
      }
    }
  }

  // 填充缺失章节：正常 LLM 流程不注入占位符，仅记录警告 + 置空字符串
  // 仅在 generateAstOnlyContent（降级路径）中才使用有意义的降级文本
  for (const [key, titles] of SECTION_TITLES) {
    if (!sections[key] || !sections[key]!.trim()) {
      // 不注入"此章节待补充"占位符——空字符串更诚实
      sections[key] = '';
      parseWarnings.push(`章节 "${titles[0]}" 未在 LLM 响应中找到`);
    }
  }

  // 提取不确定性标记
  const markerPatterns: Array<{ type: UncertaintyMarker['type']; regex: RegExp }> = [
    { type: '推断', regex: /\[推断[：:]?\s*([^\]]*)\]/g },
    { type: '不明确', regex: /\[不明确[：:]?\s*([^\]]*)\]/g },
    { type: 'SYNTAX ERROR', regex: /\[SYNTAX ERROR[：:]?\s*([^\]]*)\]/g },
  ];

  for (const [sectionKey] of SECTION_TITLES) {
    const sectionContent = sections[sectionKey] ?? '';
    for (const { type, regex } of markerPatterns) {
      const re = new RegExp(regex.source, regex.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(sectionContent)) !== null) {
        uncertaintyMarkers.push({
          type,
          section: sectionKey,
          rationale: m[1]?.trim() || '无附加理由',
        });
      }
    }
  }

  return {
    sections: sections as SpecSections,
    uncertaintyMarkers,
    parseWarnings,
  };
}

// ============================================================
// 系统提示词
// ============================================================

/**
 * 返回给定操作模式的系统提示词
 *
 * @param mode - 操作模式
 * @param terminology - 可选的语言术语映射，用于参数化 prompt
 * @returns 系统提示词文本
 */
export function buildSystemPrompt(
  mode: 'spec-generation' | 'semantic-diff',
  terminology?: LanguageTerminology,
): string {
  // 默认使用 TypeScript 术语（向后兼容）
  const lang = terminology ?? {
    codeBlockLanguage: 'typescript',
    exportConcept: 'export 导出的函数/类/类型',
    importConcept: 'import 导入',
    typeSystemDescription: '静态类型系统 + interface/type 别名',
    interfaceConcept: 'interface 接口',
    moduleSystem: 'ES Modules / CommonJS',
  };

  if (mode === 'spec-generation') {
    return `你是一个资深代码架构分析专家，负责将源代码结构信息逆向工程为**详尽且实用**的规格文档。

## 输出要求

1. 使用中文撰写所有散文描述，代码标识符保持英文
2. **必须**输出以下 9 个章节，标题**严格**使用以下格式（包括编号）：

## 1. 意图
## 2. 接口定义
## 3. 业务逻辑
## 4. 数据结构
## 5. 约束条件
## 6. 边界条件
## 7. 技术债务
## 8. 测试覆盖
## 9. 依赖关系

3. 每个章节必须有实质性内容（至少 3-5 行），**绝不允许留空或写"无"**

## 各章节详细要求

### 1. 意图
- 列出 3-5 个核心职责（用编号列表）
- 说明该模块在系统中的定位

### 2. 业务逻辑（本 Section 要求最高的详细度）
- **必须覆盖模块的所有处理阶段**——不要只深入一个阶段而忽略其他阶段
- 对每个阶段使用以下结构（不需要 ### 子标题，用加粗段落即可）：
  **阶段 N — 名称**（\`关键函数()\` in \`文件名\`）：一段话描述输入→核心算法→输出。含特殊处理说明
- 每个阶段的描述**必须**包含：关键函数名（引用具体文件）、输入输出数据类型、核心算法步骤（2-3 步）、特殊处理（降级/缓存/语言特化）
- **必须**包含一个 Mermaid 流程图（flowchart TD）展示**完整处理管线**（涵盖所有阶段）
- 如果涉及多个子系统/函数间调用，**必须**包含一个 Mermaid 时序图展示调用链
- 关键子系统用表格列出：| 子系统 | 文件 | 功能 |
- **篇幅要求**：Section 2 应是全文信息密度最高的章节，每个阶段 3-5 行描述

### 3. 接口定义
- 列出所有${lang.exportConcept}的**完整签名**（必须来自 AST 数据）
- 用表格格式：| 名称 | 类型 | 签名 | 说明 |

### 4. 数据结构
- 列出核心类型定义（${lang.codeBlockLanguage} 代码块）
- 用表格描述关键字段：| 字段 | 类型 | 说明 |

### 5. 约束条件
- 列出硬编码常量、超时限制、大小限制等
- 格式：| 约束 | 值 | 说明 |

### 6. 边界条件
- 列出异常路径、空值处理、并发问题等
- 每条用 \`- **场景**: 处理方式\` 格式

### 7. 技术债务
- 已知问题和改进空间
- 格式：| 项目 | 严重程度 | 描述 |

### 8. 测试覆盖
- 建议的测试用例和覆盖策略
- 如已有测试文件，说明覆盖情况

### 9. 依赖关系
- 内部依赖用 Mermaid graph 或列表展示
- 外部依赖（${lang.moduleSystem} 模块）列出
- **必须**包含一个依赖关系 Mermaid 图：
\`\`\`mermaid
graph LR
  当前模块 --> 依赖模块A
  当前模块 --> 依赖模块B
\`\`\`

## 语言上下文

- 目标代码语言：**${lang.codeBlockLanguage}**
- 模块系统：${lang.moduleSystem}
- 导入方式：${lang.importConcept}
- 类型系统：${lang.typeSystemDescription}
- 接口/协议概念：${lang.interfaceConcept}

## 关键规则

- **绝不捏造接口签名**：接口定义章节只能引用 AST 提取的数据，不得添加任何 AST 中不存在的函数、类或类型
- **诚实标注不确定性**：
  - 对推断的内容使用 \`[推断: 理由]\` 标记
  - 对模糊代码使用 \`[不明确: 理由]\` 标记
  - 对语法错误区域使用 \`[SYNTAX ERROR: 描述]\` 标记
- 每个标记必须附带理由说明
- **不要偷懒**：即使某些信息在 AST 中不明显，也要根据代码结构进行合理推断并标注

## 绝对禁止

- **严禁占位符**：绝对禁止在任何章节输出"此章节待补充"、"待完善"、"暂无内容"、"TODO"、"[待补充]" 等任何形式的占位符文本
- **Section 1 意图**必须以一句话概括产品核心价值（"这个模块将 X 转化为 Y，使 Z 能够 W"），然后再展开具体能力列表。每条能力点应引用具体的源文件或函数名
- **Section 2 业务逻辑**是全文最重要的章节，必须对每个处理阶段用子标题展开，每阶段描述关键函数、输入输出、核心算法和特殊处理。篇幅应占全文 30-40%
- **Section 3 接口定义**必须包含关键函数/类的行为摘要，不仅仅是签名列表——每个导出符号至少一句话描述其语义职责
- 若上下文已提供代码切片（## 代码切片），必须基于切片中的控制流结构生成具体描述，不得忽略此信息

## 格式

每个章节使用二级标题（## N. 章节名）分隔，标题必须完全匹配上述格式。`;
  }

  // semantic-diff 模式
  return `你是一个代码变更分析专家，负责评估源代码变更对模块行为的语义影响。

## 输入

你将收到：
1. 旧版本的函数/方法体
2. 新版本的函数/方法体
3. 当前规格文档中的相关描述

## 任务

评估代码变更是否导致了行为漂移，即代码行为与规格文档描述不再一致。

## 输出格式

对每个变更，提供：
1. **变更类型**：addition（新增）/ removal（移除）/ modification（修改）
2. **影响评估**：该变更是否改变了模块的外部可观察行为
3. **严重级别**：HIGH（Breaking）/ MEDIUM（行为变化）/ LOW（内部优化）
4. **建议更新**：如果需要更新规格，建议的中文描述

## 规则

- 使用中文撰写所有评估描述
- 仅报告实质性行为变更，过滤格式和注释变更
- 对不确定的评估使用 \`[推断: 理由]\` 标记`;
}
