/**
 * ADR MapReduce Pipeline (Feature 140 T37-T39)
 *
 * 实现 spec FR-003 / FR-004 — ADR 候选生成从"8 个 hardcoded 关键词匹配函数"
 * 改为基于 cluster orchestrator 的 MapReduce LLM 流程：
 *
 *   Phase A: 聚类（cluster orchestrator 内置 community → directory → single fallback）
 *   Phase B Map (sonnet): per cluster 输出 ADRCandidate[]，每条需 ≥2 evidenceRefs（不同文件）
 *   Phase C Reduce (opus 优先 / sonnet 降级): 跨 cluster 语义去重 + 合并 evidenceRefs +
 *           丢弃 < 2 evidenceRefs 的 candidate
 *
 * **Codex review finding 2 修复**：cluster orchestrator 通过 FFD 装箱保证零模块丢失，
 * 不再用截断尾部静默丢弃模块。
 *
 * **设计权威**：
 * - specs/140-spectra-doc-pipeline-quality/research/02-mapreduce-architecture.md §三
 * - specs/140-spectra-doc-pipeline-quality/spec.md FR-003 / FR-004 / FR-005
 *
 * **职责边界**：本模块负责 LLM-based ADR 候选生成 + 模型选择策略；
 * evidence 真实性校验由 `adr-evidence-verifier.ts` 处理；
 * 旧 ADR supersede 由 `adr-migration.ts` 处理。
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { clusterDispatch } from '../cluster-orchestrator.js';
import type { CallTelemetry } from '../cluster-orchestrator.js';
import { createLogger } from '../utils/logger.js';
import type { StoredModuleSpecRecord } from '../stored-module-specs.js';
import { verifyEvidenceRefs, type EvidenceRefInput, type VerifiedEvidenceRef } from './adr-evidence-verifier.js';

const logger = createLogger('adr-mapreduce');

// ============================================================
// 常量
// ============================================================

/** spec FR-005：ADR 必须有 ≥2 条 verified=true 的 evidenceRefs */
const MIN_VERIFIED_EVIDENCE = 2;

/** spec FR-004：Map 阶段使用 sonnet（成本/质量平衡）*/
const DEFAULT_MAP_MODEL = 'claude-sonnet-4-6';

/** spec FR-004：Reduce 阶段优先使用 opus（关键合并质量门）*/
const DEFAULT_REDUCE_MODEL_PRIMARY = 'claude-opus-4-7';

/** spec FR-004：Reduce 失败降级时改用 sonnet + confidence: medium */
const DEFAULT_REDUCE_MODEL_FALLBACK = 'claude-sonnet-4-6';

// ============================================================
// Zod schemas (LLM output validation)
// ============================================================

/** Phase B Map 单条 ADR 候选输出 schema */
export const ADRCandidateSchema = z.object({
  candidateId: z.string().min(1),
  title: z.string().min(5).max(120),
  summary: z.string().min(20).max(500),
  decision: z.string().min(20),
  context: z.string().min(20),
  consequences: z.string().min(20),
  evidenceRefs: z
    .array(
      z.object({
        source: z.string().min(1),
        location: z.string().min(1),
        snippet: z.string().min(1),
      }),
    )
    .min(1), // Map 阶段允许 1 条；Reduce 阶段会过滤 < 2 条 verified 的
  sourceClusterId: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type ADRCandidate = z.infer<typeof ADRCandidateSchema>;

/** Phase B Map 输出（多条候选）*/
export const MapOutputSchema = z.object({
  candidates: z.array(ADRCandidateSchema).max(10),
});
export type MapOutput = z.infer<typeof MapOutputSchema>;

/** Phase C Reduce 输出（去重合并后的最终列表）*/
export const ReduceOutputSchema = z.object({
  finalCandidates: z.array(
    ADRCandidateSchema.extend({
      // Reduce 阶段每条候选可能聚合多个 cluster 的 evidence
      mergedFromClusters: z.array(z.string()).min(1),
    }),
  ),
});
export type ReduceOutput = z.infer<typeof ReduceOutputSchema>;

// ============================================================
// 公共类型
// ============================================================

export interface RunAdrMapReduceOptions {
  /** Anthropic SDK 客户端（必填，由 caller 注入便于测试 mock）*/
  anthropicClient: Anthropic;
  /** 待处理的模块 spec 列表 */
  modules: StoredModuleSpecRecord[];
  /** 项目根目录绝对路径，用于 evidence 文件存在性校验 */
  projectRoot: string;
  /** README 全量内容（来自 Step 5 extraction-pipeline，可选）*/
  readmeContent?: string;
  /** project-context 摘要（可选）*/
  projectContextSummary?: string;
  /** Map 阶段模型（默认 claude-sonnet-4-6）*/
  mapModel?: string;
  /** Reduce 阶段优先模型（默认 claude-opus-4-7）；不可用时降级到 sonnet */
  reducePrimaryModel?: string;
  /** Reduce 降级模型（默认 claude-sonnet-4-6）*/
  reduceFallbackModel?: string;
}

export interface RunAdrMapReduceResult {
  /** 通过 evidence 校验的最终 ADR 列表（可写盘）*/
  finalCandidates: Array<ADRCandidate & {
    mergedFromClusters: string[];
    /** 每条 evidenceRef 的校验结果（caller 可在 frontmatter 写入诊断）*/
    verifiedEvidenceRefs: VerifiedEvidenceRef[];
  }>;
  /** spec FR-004：实际生效的模型对（写入 frontmatter generatedByModel）*/
  generatedByModel: { map: string; reduce: string };
  /** Reduce 是否走了降级路径（true → frontmatter confidence 应标 medium）*/
  reduceFallbackTriggered: boolean;
  /** 跨阶段累计 token 使用 */
  totalTokens: { input: number; output: number };
  /** fail-closed 标志 */
  failClosed: boolean;
  failClosedReason?:
    | 'map-below-threshold'
    | 'reduce-failed'
    | 'clustering-failed'
    | 'shared-header-failed'
    | 'no-verified-evidence';
}

// ============================================================
// Prompt builders
// ============================================================

function moduleSummaryText(m: StoredModuleSpecRecord): string {
  return [m.intentSummary, m.businessSummary, m.dependencySummary]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n');
}

function buildSharedHeader(opts: {
  readmeContent?: string;
  projectContextSummary?: string;
  modules: StoredModuleSpecRecord[];
}): string {
  const parts: string[] = [];
  if (opts.readmeContent && opts.readmeContent.trim().length > 0) {
    parts.push(`## README（项目顶层叙述）\n\n${opts.readmeContent.trim()}`);
  }
  if (opts.projectContextSummary && opts.projectContextSummary.trim().length > 0) {
    parts.push(`## Project Context\n\n${opts.projectContextSummary.trim()}`);
  }
  parts.push(
    `## 全模块 Inventory\n\n${
      opts.modules
        .map((m) => `- \`${m.sourceTarget}\`: ${m.intentSummary.slice(0, 200).replace(/\n/g, ' ').trim()}`)
        .join('\n')
    }`,
  );
  return parts.join('\n\n---\n\n');
}

function buildMapPrompt(cluster: StoredModuleSpecRecord[], sharedHeader: string, clusterId: string): string {
  const clusterContent = cluster
    .map((m) => `### \`${m.sourceTarget}\`\n\n${moduleSummaryText(m).slice(0, 3000)}`)
    .join('\n\n---\n\n');
  return `你是高级架构师，从给定的项目模块 spec 中识别**真实存在的架构决策**（ADR）。

# 全局上下文

${sharedHeader}

# 当前 Cluster 模块 spec

${clusterContent}

# 任务

识别这个 cluster 体现了哪些架构决策。每条 ADR 必须：
- title 简洁（5-120 字符），描述决策本身（如"使用 Cluster Orchestrator 解耦项目规模与模型容量"）
- decision 段说明具体采取的做法
- context 段说明为什么需要这个决策
- consequences 段说明该决策带来的影响
- **必须提供 ≥ 1 条 evidenceRef**，每条 evidence 必须包含真实的：
  * source: 文件路径（相对项目根目录）
  * location: 行号范围（"L42-58" 或单行 "L42"）
  * snippet: 文件实际内容片段（用于程序化校验真实性）
- 严禁编造证据。如果证据不充分，**不要输出该 ADR**。

输出 JSON：
\`\`\`json
{
  "candidates": [
    {
      "candidateId": "唯一 ID（kebab-case）",
      "title": "...",
      "summary": "...",
      "decision": "...",
      "context": "...",
      "consequences": "...",
      "evidenceRefs": [
        { "source": "src/foo.ts", "location": "L42-58", "snippet": "..." }
      ],
      "sourceClusterId": "${clusterId}",
      "confidence": 0.85
    }
  ]
}
\`\`\`

每 cluster 最多 10 条候选。仅输出 JSON 对象。`;
}

function buildReducePrompt(mapOutputs: MapOutput[], sharedHeader: string): string {
  const allCandidates = mapOutputs.flatMap((mo) => mo.candidates);
  const candidateSummary = allCandidates
    .map(
      (c, idx) =>
        `## Candidate ${idx + 1}（cluster ${c.sourceClusterId}）\n` +
        `Title: ${c.title}\n` +
        `Summary: ${c.summary}\n` +
        `Evidence count: ${c.evidenceRefs.length}\n` +
        `Confidence: ${c.confidence}`,
    )
    .join('\n\n---\n\n');
  return `你是技术审查者，需要把多个 cluster 产出的 ADR 候选去重 + 合并。

# 全局上下文

${sharedHeader}

# 候选列表

${candidateSummary}

# 任务

1. 按 title 和 decision 语义识别**重复或近似**的候选（同一决策被多个 cluster 独立发现）
2. 合并近似候选：保留信息最完整的版本，evidenceRefs 取并集（去重 by source+location）
3. **跨 cluster 出现的 candidate** → confidence 调整为 ≥ 0.8（多源印证）
4. **单 cluster 出现的 candidate** → confidence 调整为 ≤ 0.6（待进一步验证）
5. **过滤 evidenceRefs < 2 的候选**（spec FR-005 强制要求）
6. 每条最终 candidate 标注 mergedFromClusters: 来源 cluster ID 数组

输出 JSON：
\`\`\`json
{
  "finalCandidates": [
    {
      "candidateId": "...",
      "title": "...",
      "summary": "...",
      "decision": "...",
      "context": "...",
      "consequences": "...",
      "evidenceRefs": [...],
      "sourceClusterId": "merged",
      "confidence": 0.85,
      "mergedFromClusters": ["cluster-1", "cluster-3"]
    }
  ]
}
\`\`\`

仅输出 JSON 对象。`;
}

// ============================================================
// LLM 调用助手（透传 AbortSignal）
// ============================================================

async function callLLM<T>(
  client: Anthropic,
  prompt: string,
  schema: z.ZodSchema<T>,
  model: string,
  signal?: AbortSignal,
): Promise<{ output: T; telemetry: CallTelemetry }> {
  const startMs = Date.now();
  const response = await client.messages.create(
    {
      model,
      max_tokens: 8192, // ADR 输出可能较长（multiple candidates with evidenceRefs）
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    },
    signal !== undefined ? { signal } : undefined,
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

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
// 主入口：runAdrMapReduce
// ============================================================

/**
 * 运行 ADR MapReduce pipeline。
 *
 * 阶段：
 *  A: 聚类（cluster orchestrator 内置 fallback chain）
 *  B Map (sonnet): per cluster 提取 ADR 候选 + evidenceRefs
 *  C Reduce (opus 优先 / sonnet 降级): 跨 cluster 去重合并
 *  D Evidence 校验：调用 adr-evidence-verifier 程序化验证 source+location+snippet
 *  E 过滤 gate：每条 ADR 必须 ≥ MIN_VERIFIED_EVIDENCE 条 verified=true
 *
 * fail-closed：
 *  - cluster dispatch 失败（< 50% Map 成功 / Reduce 重试仍失败）
 *  - 全部 candidate 都 < 2 条 verified evidenceRefs
 */
export async function runAdrMapReduce(
  options: RunAdrMapReduceOptions,
): Promise<RunAdrMapReduceResult> {
  const mapModel = options.mapModel ?? DEFAULT_MAP_MODEL;
  const primaryReduceModel = options.reducePrimaryModel ?? DEFAULT_REDUCE_MODEL_PRIMARY;
  const fallbackReduceModel = options.reduceFallbackModel ?? DEFAULT_REDUCE_MODEL_FALLBACK;
  const totalTokens = { input: 0, output: 0 };

  const sharedHeader = buildSharedHeader({
    ...(options.readmeContent !== undefined ? { readmeContent: options.readmeContent } : {}),
    ...(options.projectContextSummary !== undefined ? { projectContextSummary: options.projectContextSummary } : {}),
    modules: options.modules,
  });

  // 修复 Codex W-1：降级状态在每次 reduce.fn 调用前重置，避免 cluster orchestrator
  // reduce 重试时第一次 primary 失败的标记污染第二次 primary 成功的状态。
  // 用 ref 容器（数组）而非闭包变量，每次 reduce.fn 进入重置为 false/primary。
  const reduceState = { fallbackTriggered: false, actualModel: primaryReduceModel };

  // Phase A + B + C：通过 clusterDispatch 编排
  const dispatchResult = await clusterDispatch<StoredModuleSpecRecord, MapOutput, ReduceOutput>({
    inputs: options.modules,
    clusterStrategy: {
      kind: 'directory',
      getInputPath: (m) => m.sourceTarget,
    },
    sharedHeader: async () => sharedHeader,
    map: {
      fn: async (cluster, _shared, signal) => {
        const clusterId = `cluster-${cluster.map((m) => m.sourceTarget).sort().join('-').slice(0, 40)}`;
        const result = await callLLM(
          options.anthropicClient,
          buildMapPrompt(cluster, sharedHeader, clusterId),
          MapOutputSchema,
          mapModel,
          signal,
        );
        totalTokens.input += result.telemetry.inputTokens;
        totalTokens.output += result.telemetry.outputTokens;
        return result;
      },
      maxConcurrency: 4,
      model: 'sonnet',
    },
    reduce: {
      fn: async (mapOutputs, _shared, signal) => {
        // 修复 Codex W-1：每次 reduce.fn 进入时重置降级状态。
        // cluster orchestrator 会重试 reduce.fn 1 次（共 2 次 attempts），
        // 上一次 primary 失败的 fallbackTriggered 不应污染下一次 primary 成功路径。
        reduceState.fallbackTriggered = false;
        reduceState.actualModel = primaryReduceModel;
        try {
          const result = await callLLM(
            options.anthropicClient,
            buildReducePrompt(mapOutputs, sharedHeader),
            ReduceOutputSchema,
            primaryReduceModel,
            signal,
          );
          totalTokens.input += result.telemetry.inputTokens;
          totalTokens.output += result.telemetry.outputTokens;
          return result;
        } catch (primaryErr) {
          logger.warn(
            `Reduce 使用 ${primaryReduceModel} 失败，降级到 ${fallbackReduceModel}: ${String(primaryErr).slice(0, 200)}`,
          );
          reduceState.fallbackTriggered = true;
          reduceState.actualModel = fallbackReduceModel;
          const fallbackResult = await callLLM(
            options.anthropicClient,
            buildReducePrompt(mapOutputs, sharedHeader),
            ReduceOutputSchema,
            fallbackReduceModel,
            signal,
          );
          totalTokens.input += fallbackResult.telemetry.inputTokens;
          totalTokens.output += fallbackResult.telemetry.outputTokens;
          return fallbackResult;
        }
      },
      model: 'opus',
    },
  });

  if (dispatchResult.finalOutput === null) {
    const reason = dispatchResult.diagnostics.failClosedReason ?? 'map-below-threshold';
    return {
      finalCandidates: [],
      generatedByModel: { map: mapModel, reduce: reduceState.actualModel },
      reduceFallbackTriggered: reduceState.fallbackTriggered,
      totalTokens,
      failClosed: true,
      failClosedReason: reason,
    };
  }

  // Phase D + E：evidence 校验 + 过滤 gate
  const verifiedCandidates = dispatchResult.finalOutput.finalCandidates
    .map((c) => {
      const verifiedRefs = verifyEvidenceRefs(
        c.evidenceRefs as EvidenceRefInput[],
        options.projectRoot,
      );
      return {
        ...c,
        verifiedEvidenceRefs: verifiedRefs,
      };
    })
    .filter((c) => {
      // spec FR-005 强制：每条 ADR 必须 ≥ 2 条 verified=true 的 evidenceRefs
      const verifiedCount = c.verifiedEvidenceRefs.filter((r) => r.verified).length;
      if (verifiedCount < MIN_VERIFIED_EVIDENCE) {
        logger.warn(
          `ADR candidate "${c.title}" 被丢弃：仅 ${verifiedCount}/${c.verifiedEvidenceRefs.length} 条 evidence 通过验证（< ${MIN_VERIFIED_EVIDENCE} 条门槛）`,
        );
        return false;
      }
      return true;
    });

  // 全部 candidate 都被丢弃 → fail-closed
  if (verifiedCandidates.length === 0 && dispatchResult.finalOutput.finalCandidates.length > 0) {
    return {
      finalCandidates: [],
      generatedByModel: { map: mapModel, reduce: reduceState.actualModel },
      reduceFallbackTriggered: reduceState.fallbackTriggered,
      totalTokens,
      failClosed: true,
      failClosedReason: 'no-verified-evidence',
    };
  }

  return {
    finalCandidates: verifiedCandidates,
    generatedByModel: { map: mapModel, reduce: reduceState.actualModel },
    reduceFallbackTriggered: reduceState.fallbackTriggered,
    totalTokens,
    failClosed: false,
  };
}
