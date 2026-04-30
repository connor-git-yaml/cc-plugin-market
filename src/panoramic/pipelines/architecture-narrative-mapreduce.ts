/**
 * Architecture Narrative MapReduce Pipeline (Feature 140 T32-T34)
 *
 * 实现 spec FR-008 / US-003 — 基于 cluster orchestrator 的 4 段 LLM narrative 生成：
 *   Phase A: 聚类（复用 cluster-orchestrator 的 community → directory → single fallback）
 *   Phase B Map (sonnet): 每 cluster 输出 mini-narrative + key abstractions
 *   Phase C Reduce (sonnet): 合并 cluster narratives 为 4-6 段项目级 narrative
 *   Phase D Critique (sonnet): 独立 LLM 调用判定通过/失败
 *   Phase E Refine (sonnet, optional): 仅 Phase D fail 时执行，最多 1 次
 *   Phase F: 程序化 domain-words 校验（≥3 个核心抽象名）
 *
 * **设计权威**：
 * - specs/140-spectra-doc-pipeline-quality/research/02-mapreduce-architecture.md §四
 * - specs/140-spectra-doc-pipeline-quality/spec.md FR-008 / FR-009 / US-003
 *
 * **职责边界**：本模块仅负责 LLM-based narrative 生成；调用方负责文件写盘 + frontmatter
 * 集成。fail-closed 时（domain-words < 3 即便 Refine 后）返回 finalOutput=null + 诊断信息，
 * caller 决定是否写 `_PIPELINE_FAILED.md` 标记（沿用 Feature 135 模式）。
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { clusterDispatch } from '../cluster-orchestrator.js';
import type { CallTelemetry } from '../cluster-orchestrator.js';
import { createLogger } from '../utils/logger.js';
import type { StoredModuleSpecRecord } from '../stored-module-specs.js';

const logger = createLogger('narrative-mapreduce');

// ============================================================
// 常量
// ============================================================

/** Phase D Critique 失败后允许的最大 Refine 次数（spec：1 次）*/
const MAX_REFINE_ATTEMPTS = 1;

/** Phase F: domain-words 校验最低门槛（spec：≥3 个核心抽象名）*/
const MIN_DOMAIN_WORDS = 3;

/** 默认 LLM 模型（spec FR-008：narrative 用 sonnet）*/
const DEFAULT_NARRATIVE_MODEL = 'claude-sonnet-4-6';

/** narrative 段落数量目标（spec：4-6 段）*/
const NARRATIVE_PARAGRAPHS_MIN = 4;
const NARRATIVE_PARAGRAPHS_MAX = 6;

// ============================================================
// Zod schemas (LLM output validation)
// ============================================================

/** Phase B Map 输出：每 cluster 的 mini-narrative + 关键抽象 */
export const MapOutputSchema = z.object({
  clusterNarrative: z.string().min(20).max(2000),
  keyAbstractions: z.array(z.string().min(1)).min(1).max(20),
});
export type MapOutput = z.infer<typeof MapOutputSchema>;

/** Phase C Reduce 输出：项目级 4-6 段 narrative */
export const ReduceOutputSchema = z.object({
  paragraphs: z.array(z.string().min(20)).min(NARRATIVE_PARAGRAPHS_MIN).max(NARRATIVE_PARAGRAPHS_MAX),
  abstractionGlossary: z.array(z.string().min(1)).min(1).max(50),
});
export type ReduceOutput = z.infer<typeof ReduceOutputSchema>;

/** Phase D Critique 输出 */
export const CritiqueOutputSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
});
export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>;

// ============================================================
// 公共类型
// ============================================================

export interface EnrichNarrativeOptions {
  /** Anthropic SDK 客户端（必填，由 caller 注入便于测试 mock）*/
  anthropicClient: Anthropic;
  /** 待 narrative 化的模块 spec 列表 */
  modules: StoredModuleSpecRecord[];
  /** README 全量内容（来自 Step 5 extraction-pipeline）*/
  readmeContent?: string;
  /** project-context.yaml 摘要（与 batch-orchestrator 入参一致）*/
  projectContextSummary?: string;
  /** LLM 模型 ID（默认 claude-sonnet-4-6）*/
  model?: string;
}

export interface CritiqueResultRecord {
  passed: boolean;
  issues: string[];
  /** Refine 是否被触发（仅 Phase D fail 时为 true）*/
  refineAttempted: boolean;
}

export interface EnrichNarrativeResult {
  /** Phase C Reduce 产出的 4-6 段 narrative；fail-closed 时为 null */
  paragraphs: string[] | null;
  /** Phase F 检测到的领域词（命中 module spec 中的核心抽象名）*/
  domainWordsFound: string[];
  /** Phase D/E critique 结果摘要 */
  critiqueResult: CritiqueResultRecord;
  /** fail-closed 标志 */
  failClosed: boolean;
  /** fail-closed 原因（仅 failClosed=true 时）— 与 cluster-orchestrator 的 union 对齐，
   * 加上 narrative 专属的 'domain-words-insufficient'（修复 Codex W-2 — 透传 dispatch 原因不再压缩）*/
  failClosedReason?:
    | 'map-below-threshold'
    | 'reduce-failed'
    | 'clustering-failed'
    | 'shared-header-failed'
    | 'domain-words-insufficient';
  /** 各阶段 LLM 调用 telemetry 累计（caller 写到 frontmatter）*/
  totalTokens: { input: number; output: number };
}

// ============================================================
// 内部辅助：从 module spec 提取领域抽象名
// ============================================================

/**
 * 从 module spec 接口段提取核心抽象名（函数名 / 类名 / 接口名）。
 * 用于 Phase F 程序化 domain-words 校验。
 *
 * 提取规则（保守正则）：
 * - 匹配 `^### .*?: <Identifier>` 类型（spec sections 接口定义段）
 * - 匹配 markdown code block 中的 export class / function / interface
 * - 仅采集大写开头的标识符（CamelCase / PascalCase 是抽象名典型特征）
 */
function moduleSummaryText(m: StoredModuleSpecRecord): string {
  // StoredModuleSpecRecord 是结构化摘要而非完整 markdown，组合 3 段供 LLM/正则消费
  return [m.intentSummary, m.businessSummary, m.dependencySummary]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n');
}

function extractDomainAbstractions(modules: StoredModuleSpecRecord[]): Set<string> {
  const abstractions = new Set<string>();
  // 标识符正则：PascalCase / lowerCamel ≥ 3 字符（修复 Codex W-3 — 部分支持 Go/Rust 项目中的
  // PascalCase 类型名；snake_case 仍需 LLM 阶段引导，本正则不强求覆盖所有命名约定）
  const identifierRe = /\b([A-Z][A-Za-z0-9]{2,})\b/g;
  // 修复 Codex W-4 — 扩充 stop words 黑名单（新增 Service / Manager / Config / Type 等高频泛词，
  // 防止 narrative 仅靠泛词凑够 3 个 domain-words 通过校验）
  const stopWords = new Set([
    'README', 'TODO', 'NOTE', 'WARNING', 'ERROR', 'INFO', 'DEBUG',
    'JSON', 'YAML', 'XML', 'HTML', 'CSS', 'API', 'URL', 'URI', 'HTTP', 'HTTPS',
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
    'MIT', 'LICENSE', 'BSD',
    // 高频通用泛词（非项目特有抽象）
    'Service', 'Services', 'Manager', 'Managers', 'Config', 'Configs',
    'Type', 'Types', 'Module', 'Modules', 'Package', 'Packages',
    'Helper', 'Helpers', 'Utility', 'Utilities', 'Util', 'Utils',
    'Component', 'Components', 'Handler', 'Handlers',
    'Result', 'Results', 'Response', 'Responses', 'Request', 'Requests',
    'Default', 'Defaults', 'Constant', 'Constants', 'Const',
    'Builder', 'Builders', 'Factory', 'Factories',
    'TEST', 'TESTS', 'Test', 'Tests',
  ]);

  for (const module of modules) {
    const content = moduleSummaryText(module);
    let match: RegExpExecArray | null;
    while ((match = identifierRe.exec(content)) !== null) {
      const name = match[1]!;
      if (!stopWords.has(name)) {
        abstractions.add(name);
      }
    }
  }
  return abstractions;
}

/**
 * Phase F: 校验 narrative 文本中是否出现 ≥ MIN_DOMAIN_WORDS 个项目特有抽象名。
 *
 * @returns 命中的领域词列表（去重）；caller 可根据 length 判定是否通过。
 */
export function validateDomainWords(
  paragraphs: string[],
  modules: StoredModuleSpecRecord[],
): string[] {
  const abstractions = extractDomainAbstractions(modules);
  const narrativeText = paragraphs.join('\n\n');
  const found = new Set<string>();
  for (const abstraction of abstractions) {
    // 用 word boundary 匹配避免子串误命中（如 'Service' 不应命中 'ServiceImpl' 内部）
    const re = new RegExp(`\\b${escapeRegex(abstraction)}\\b`);
    if (re.test(narrativeText)) {
      found.add(abstraction);
    }
  }
  return [...found];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// LLM Prompt builders
// ============================================================

interface SharedHeaderContext {
  readmeContent?: string;
  projectContextSummary?: string;
  moduleInventory: string;
}

function buildSharedHeader(ctx: SharedHeaderContext): string {
  const parts: string[] = [];
  if (ctx.readmeContent && ctx.readmeContent.trim().length > 0) {
    parts.push(`## README（项目顶层叙述）\n\n${ctx.readmeContent.trim()}`);
  }
  if (ctx.projectContextSummary && ctx.projectContextSummary.trim().length > 0) {
    parts.push(`## Project Context\n\n${ctx.projectContextSummary.trim()}`);
  }
  parts.push(`## 全模块 Inventory\n\n${ctx.moduleInventory}`);
  return parts.join('\n\n---\n\n');
}

function buildModuleInventory(modules: StoredModuleSpecRecord[]): string {
  return modules
    .map((m) => `- \`${m.sourceTarget}\`: ${m.intentSummary.slice(0, 200).replace(/\n/g, ' ').trim()}`)
    .join('\n');
}

function buildMapPrompt(cluster: StoredModuleSpecRecord[], sharedHeader: string): string {
  const clusterContent = cluster
    .map((m) => `### \`${m.sourceTarget}\`\n\n${moduleSummaryText(m).slice(0, 3000)}`)
    .join('\n\n---\n\n');
  return `你是高级架构师，需要从给定的模块 spec 中提炼这个 cluster 的核心叙述。

# 全局上下文（所有 cluster 共享）

${sharedHeader}

# 当前 Cluster 的模块 spec 内容

${clusterContent}

# 任务

输出 JSON：
\`\`\`json
{
  "clusterNarrative": "3-5 句中文叙述：这个 cluster 在项目中扮演什么角色？解决了什么核心问题？关键抽象是什么？必须提及具体的项目特有抽象名（不要泛泛而谈）。",
  "keyAbstractions": ["项目特有的抽象名1", "项目特有的抽象名2", ..., "至少 1 个，最多 20 个"]
}
\`\`\`

要求：
- clusterNarrative 长度 20-2000 字符；
- keyAbstractions 必须是该 cluster 实际出现的代码标识符（类名 / 函数名 / 接口名）；不接受 "API" / "Service" 这类泛词；
- 仅输出 JSON 对象（不含 markdown 代码块包装）。`;
}

function buildReducePrompt(mapOutputs: MapOutput[], sharedHeader: string): string {
  const clusterSummaries = mapOutputs
    .map((mo, idx) =>
      `## Cluster ${idx + 1}\n\nNarrative: ${mo.clusterNarrative}\n\n关键抽象: ${mo.keyAbstractions.join(', ')}`,
    )
    .join('\n\n---\n\n');
  return `你是高级架构师，需要将多个 cluster 的叙述合并为项目级 4-6 段 narrative。

# 全局上下文

${sharedHeader}

# Cluster 叙述（待合并）

${clusterSummaries}

# 任务

输出 JSON：
\`\`\`json
{
  "paragraphs": [
    "段落 1：项目整体定位与价值",
    "段落 2：核心架构（关键抽象间的协作）",
    "段落 3-N：各子系统重点（按 cluster 重要性）",
    "最后段：未解决问题 / 演进方向"
  ],
  "abstractionGlossary": ["项目级核心抽象名 1", "项目级核心抽象名 2", ...]
}
\`\`\`

要求：
- paragraphs 数组长度必须在 ${NARRATIVE_PARAGRAPHS_MIN}-${NARRATIVE_PARAGRAPHS_MAX} 之间；
- 每段 ≥ 20 字符；
- abstractionGlossary 至少包含 ${MIN_DOMAIN_WORDS} 个项目特有抽象名（综合所有 cluster）；
- 仅输出 JSON 对象。`;
}

function buildCritiquePrompt(reduceOutput: ReduceOutput, modules: StoredModuleSpecRecord[]): string {
  const moduleList = modules.map((m) => `- ${m.sourceTarget}`).join('\n');
  return `你是技术审查者，需要批判性审视下面的 narrative，判断是否反映了项目真实技术本质。

# Narrative

${reduceOutput.paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

# 项目模块清单

${moduleList}

# 审查要点

1. narrative 是否包含 ≥ ${MIN_DOMAIN_WORDS} 个项目特有的抽象名（如类名 / 函数名 / 概念）？泛词（API / Service / Module）不算。
2. 是否准确反映模块 spec 实际职责，而不是套用通用模板？
3. 段落间是否逻辑连贯（架构总览 → 核心机制 → 子系统重点 → 演进方向）？

# 任务

输出 JSON：
\`\`\`json
{
  "passed": true/false,
  "issues": ["如果 passed=false，列出具体问题（每条 < 100 字符）"]
}
\`\`\`

仅输出 JSON 对象。`;
}

function buildRefinePrompt(
  reduceOutput: ReduceOutput,
  critique: CritiqueOutput,
  sharedHeader: string,
): string {
  return `你是高级架构师，根据审查反馈改进 narrative。

# 上下文

${sharedHeader}

# 当前 Narrative

${reduceOutput.paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

# 审查反馈（必须解决）

${critique.issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n')}

# 任务

输出 JSON（结构同上一轮 Reduce 输出）：
\`\`\`json
{
  "paragraphs": [...],
  "abstractionGlossary": [...]
}
\`\`\`

要求同 Reduce：${NARRATIVE_PARAGRAPHS_MIN}-${NARRATIVE_PARAGRAPHS_MAX} 段，每段 ≥ 20 字符，至少 ${MIN_DOMAIN_WORDS} 个项目特有抽象名。
仅输出 JSON 对象。`;
}

// ============================================================
// LLM call wrapper
// ============================================================

async function callLLM<T>(
  client: Anthropic,
  prompt: string,
  schema: z.ZodSchema<T>,
  model: string,
  signal?: AbortSignal,
): Promise<{ output: T; telemetry: CallTelemetry }> {
  const startMs = Date.now();
  // 修复 Codex W-5 — 透传 AbortSignal 给 Anthropic SDK（cluster-orchestrator 超时时
  // 会 abort 此 signal，让底层 LLM 调用真正取消而非 background 跑完浪费 token）
  const response = await client.messages.create(
    {
      model,
      max_tokens: 4096,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    },
    signal !== undefined ? { signal } : undefined,
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  // 提取 JSON（可能被 ```json ``` 包裹）
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`LLM JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    throw new Error(
      `LLM 输出 Zod schema 校验失败: ${validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }

  return {
    output: validation.data,
    telemetry: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - startMs,
      modelId: model,
    },
  };
}

// ============================================================
// 主入口：enrichNarrativeWithLLM
// ============================================================

/**
 * 基于 cluster orchestrator 的 4 段 LLM narrative 生成。
 *
 * 阶段：
 *   A: 聚类（cluster orchestrator 内置 community → directory → single fallback）
 *   B Map: per cluster mini-narrative + key abstractions（sonnet）
 *   C Reduce: 合并为 4-6 段 narrative（sonnet）
 *   D Critique: 独立 LLM 判定通过 / 失败（sonnet）
 *   E Refine: 仅 D fail 时执行，最多 1 次（sonnet）
 *   F 程序化 domain-words 校验（≥3 个核心抽象名）
 *
 * fail-closed 触发条件：
 *   - Map < 50% 成功 → finalOutput=null
 *   - Reduce 重试 1 次仍失败 → finalOutput=null
 *   - Refine 后 domain-words 仍 < 3 → finalOutput=null（spec 锁定）
 *
 * @param options 包含 LLM 客户端、modules、可选 readme + projectContext
 * @returns paragraphs（成功时 4-6 段；fail-closed 时 null）+ critique + domain-words + telemetry
 */
export async function enrichNarrativeWithLLM(
  options: EnrichNarrativeOptions,
): Promise<EnrichNarrativeResult> {
  const model = options.model ?? DEFAULT_NARRATIVE_MODEL;
  const totalTokens = { input: 0, output: 0 };

  // Phase A + B：通过 clusterDispatch 拆 cluster + Map per cluster
  const moduleInventory = buildModuleInventory(options.modules);
  const sharedHeaderText = buildSharedHeader({
    readmeContent: options.readmeContent,
    projectContextSummary: options.projectContextSummary,
    moduleInventory,
  });

  const dispatchResult = await clusterDispatch<StoredModuleSpecRecord, MapOutput, ReduceOutput>({
    inputs: options.modules,
    // narrative 不依赖图结构，按 directory fallback chain 即可
    // （Step 2 ADR 接 orchestrator 后会改为 community；narrative 当前简化为 directory）
    clusterStrategy: {
      kind: 'directory',
      getInputPath: (m) => m.sourceTarget,
    },
    sharedHeader: async () => sharedHeaderText,
    map: {
      fn: async (cluster, _sharedHeader, signal) => {
        const result = await callLLM(
          options.anthropicClient,
          buildMapPrompt(cluster, sharedHeaderText),
          MapOutputSchema,
          model,
          signal,
        );
        totalTokens.input += result.telemetry.inputTokens;
        totalTokens.output += result.telemetry.outputTokens;
        return result;
      },
      maxConcurrency: 4,
    },
    reduce: {
      fn: async (mapOutputs, _sharedHeader, signal) => {
        const result = await callLLM(
          options.anthropicClient,
          buildReducePrompt(mapOutputs, sharedHeaderText),
          ReduceOutputSchema,
          model,
          signal,
        );
        totalTokens.input += result.telemetry.inputTokens;
        totalTokens.output += result.telemetry.outputTokens;
        return result;
      },
    },
  });

  if (dispatchResult.finalOutput === null) {
    // 修复 Codex W-2 — 透传 cluster orchestrator 的 failClosedReason union（不再压缩为 2 个值）
    const reason = dispatchResult.diagnostics.failClosedReason ?? 'map-below-threshold';
    return {
      paragraphs: null,
      domainWordsFound: [],
      critiqueResult: { passed: false, issues: [`cluster dispatch ${reason}`], refineAttempted: false },
      failClosed: true,
      failClosedReason: reason,
      totalTokens,
    };
  }

  let currentReduce = dispatchResult.finalOutput;

  // Phase D: Critique（独立 LLM 调用）
  let critique: CritiqueOutput;
  let refineAttempted = false;
  try {
    const critiqueResult = await callLLM(
      options.anthropicClient,
      buildCritiquePrompt(currentReduce, options.modules),
      CritiqueOutputSchema,
      model,
    );
    totalTokens.input += critiqueResult.telemetry.inputTokens;
    totalTokens.output += critiqueResult.telemetry.outputTokens;
    critique = critiqueResult.output;
  } catch (err) {
    // 修复 Codex C-2 — Critique 失败应显式 passed=false（fail-closed 语义而非 fail-open），
    // 让下游 caller / Refine 路径可见质量门未通过，避免无人察觉。
    // issues 含 critique-skipped 标记便于诊断。
    logger.warn(`Critique LLM 调用失败，记录为 passed=false: ${String(err)}`);
    critique = { passed: false, issues: [`critique-skipped: ${String(err).slice(0, 80)}`] };
  }

  // Phase E: Refine（仅 D fail 时执行，最多 1 次）
  // 修复 Codex W-1 — passed=false 即触发，不再要求 issues.length > 0
  // （之前的 issues=[] 边界 case 会绕过 Refine，留下"审查失败但 narrative 通过"的不一致状态）
  if (!critique.passed) {
    refineAttempted = true;
    for (let attempt = 0; attempt < MAX_REFINE_ATTEMPTS; attempt++) {
      try {
        const refineResult = await callLLM(
          options.anthropicClient,
          buildRefinePrompt(currentReduce, critique, sharedHeaderText),
          ReduceOutputSchema,
          model,
        );
        totalTokens.input += refineResult.telemetry.inputTokens;
        totalTokens.output += refineResult.telemetry.outputTokens;
        currentReduce = refineResult.output;
      } catch (err) {
        logger.warn(`Refine LLM 调用失败（attempt ${attempt + 1}），保留 critique 失败状态: ${String(err)}`);
      }
    }
  }

  // Phase F: 程序化 domain-words 校验
  const domainWordsFound = validateDomainWords(currentReduce.paragraphs, options.modules);
  if (domainWordsFound.length < MIN_DOMAIN_WORDS) {
    // 即便 Critique passed，domain-words 不达标也 fail-closed（spec 强制要求）
    return {
      paragraphs: null,
      domainWordsFound,
      critiqueResult: { passed: critique.passed, issues: critique.issues, refineAttempted },
      failClosed: true,
      failClosedReason: 'domain-words-insufficient',
      totalTokens,
    };
  }

  return {
    paragraphs: currentReduce.paragraphs,
    domainWordsFound,
    critiqueResult: { passed: critique.passed, issues: critique.issues, refineAttempted },
    failClosed: false,
    totalTokens,
  };
}
