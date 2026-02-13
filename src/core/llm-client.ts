/**
 * LLM 客户端
 * Claude API 封装：callLLM、parseLLMResponse、buildSystemPrompt
 * 支持两种调用策略：SDK 直接调用（API Key）和 CLI 代理（订阅用户）
 * 参见 contracts/llm-client.md
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SpecSections } from '../models/module-spec.js';
import type { AssembledContext } from './context-assembler.js';
import { detectAuth } from '../auth/auth-detector.js';
import { callLLMviaCli as cliProxyCall } from '../auth/cli-proxy.js';

// ============================================================
// 配置类型
// ============================================================

export interface LLMConfig {
  /** 模型 ID（默认 'claude-opus-4-6'） */
  model: string;
  /** API Key（默认从 ANTHROPIC_API_KEY 环境变量获取） */
  apiKey?: string;
  /** 响应最大 token 数（默认 8192） */
  maxTokensResponse: number;
  /** 温度（默认 0.3，低温用于事实性提取） */
  temperature: number;
  /** 超时时间（毫秒，默认 120_000） */
  timeout: number;
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
// 默认配置
// ============================================================

function getDefaultConfig(): LLMConfig {
  return {
    model: process.env['REVERSE_SPEC_MODEL'] ?? 'claude-opus-4-6',
    apiKey: process.env['ANTHROPIC_API_KEY'],
    maxTokensResponse: 8192,
    temperature: 0.3,
    timeout: 120_000,
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
 * - CLI 代理可用 → 通过 spawn Claude CLI 子进程间接调用
 *
 * @param context - assembleContext() 的输出
 * @param config - 可选的配置覆盖
 * @returns LLM 响应
 * @throws LLMUnavailableError, LLMRateLimitError, LLMResponseError, LLMTimeoutError
 */
export async function callLLM(
  context: AssembledContext,
  config?: Partial<LLMConfig>,
): Promise<LLMResponse> {
  const cfg = mergeConfig(config);
  const authResult = detectAuth();

  if (!authResult.preferred) {
    throw new LLMUnavailableError(
      '未找到可用的认证方式。请设置 ANTHROPIC_API_KEY 或登录 Claude Code (claude auth login)',
    );
  }

  if (authResult.preferred.type === 'api-key') {
    return callLLMviaSdk(context, cfg);
  }

  // cli-proxy 策略
  return callLLMviaCliProxy(context, cfg);
}

/**
 * 通过 Anthropic SDK 直接调用 LLM（API Key 方式）
 */
async function callLLMviaSdk(
  context: AssembledContext,
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt('spec-generation');

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

      if (!isRetryableError(lastError) || attempt === maxAttempts - 1) {
        break;
      }
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
): Promise<LLMResponse> {
  const systemPrompt = buildSystemPrompt('spec-generation');
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

      if (!isRetryableError(lastError) || attempt === maxAttempts - 1) {
        break;
      }
    }
  }

  throw lastError ?? new LLMUnavailableError('CLI 代理调用失败');
}

// ============================================================
// 响应解析
// ============================================================

/** 9 个章节的中文/英文标题映射（含常见变体，提高匹配容错性） */
const SECTION_TITLES: Array<[keyof SpecSections, string[]]> = [
  ['intent', ['意图', 'Intent', 'Purpose', '目的', '概述']],
  ['interfaceDefinition', ['接口定义', 'Interface', 'API', '接口', '导出接口', '公共接口']],
  ['businessLogic', ['业务逻辑', 'Business Logic', '核心逻辑', '实现逻辑', '逻辑']],
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
  const sectionRegex = /^#{1,3}\s*(?:\d+\.\s*)?(.+?)$/gm;
  const matches: Array<{ title: string; index: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(raw)) !== null) {
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

    // 匹配到对应章节（容错：忽略大小写、标点、空格）
    const normalizedTitle = current.title.toLowerCase().replace(/[.、：:，,\s]/g, '');
    for (const [key, titles] of SECTION_TITLES) {
      if (titles.some((t) => {
        const normalized = t.toLowerCase().replace(/[.、：:，,\s]/g, '');
        return normalizedTitle.includes(normalized) || normalized.includes(normalizedTitle);
      })) {
        sections[key] = content;
        break;
      }
    }
  }

  // 填充缺失章节（提供有意义的降级内容而非空占位符）
  for (const [key, titles] of SECTION_TITLES) {
    if (!sections[key] || !sections[key]!.trim()) {
      sections[key] = `> 此章节待补充。可通过 \`reverse-spec generate --deep\` 提供更多上下文以改善生成质量。`;
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
 * @returns 系统提示词文本
 */
export function buildSystemPrompt(mode: 'spec-generation' | 'semantic-diff'): string {
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

### 2. 接口定义
- 列出所有导出函数/类/类型的**完整签名**（必须来自 AST 数据）
- 用表格格式：| 名称 | 类型 | 签名 | 说明 |

### 3. 业务逻辑
- 描述核心处理流程
- **必须**包含一个 Mermaid 流程图（flowchart TD）展示主要处理路径：
\`\`\`mermaid
flowchart TD
  A[输入] --> B{判断}
  B -->|条件1| C[处理1]
  B -->|条件2| D[处理2]
\`\`\`
- 如果涉及多个子系统/函数间调用，**必须**包含一个 Mermaid 时序图：
\`\`\`mermaid
sequenceDiagram
  participant A as 调用方
  participant B as 被调方
  A->>B: 调用方法
  B-->>A: 返回结果
\`\`\`
- 关键子系统用表格列出：| 子系统 | 文件 | 功能 |

### 4. 数据结构
- 列出核心类型定义（TypeScript 代码块）
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
- 外部依赖（npm 包）列出
- **必须**包含一个依赖关系 Mermaid 图：
\`\`\`mermaid
graph LR
  当前模块 --> 依赖模块A
  当前模块 --> 依赖模块B
\`\`\`

## 关键规则

- **绝不捏造接口签名**：接口定义章节只能引用 AST 提取的数据，不得添加任何 AST 中不存在的函数、类或类型
- **诚实标注不确定性**：
  - 对推断的内容使用 \`[推断: 理由]\` 标记
  - 对模糊代码使用 \`[不明确: 理由]\` 标记
  - 对语法错误区域使用 \`[SYNTAX ERROR: 描述]\` 标记
- 每个标记必须附带理由说明
- **不要偷懒**：即使某些信息在 AST 中不明显，也要根据代码结构进行合理推断并标注

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
