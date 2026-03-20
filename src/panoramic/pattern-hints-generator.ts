/**
 * PatternHintsGenerator
 *
 * 组合 045 的架构概览输出，生成规则驱动的模式提示与 explanation 附录。
 */

import Anthropic from '@anthropic-ai/sdk';
import type { DocumentGenerator, GenerateOptions, ProjectContext } from './interfaces.js';
import { ArchitectureOverviewGenerator } from './architecture-overview-generator.js';
import {
  DEFAULT_PATTERN_KNOWLEDGE_BASE,
  evaluatePatternHints,
} from './pattern-knowledge-base.js';
import {
  summarizePatternHints,
  type PatternHint,
  type PatternHintsInput,
  type PatternHintsOutput,
  type PatternKnowledgeBaseEntry,
} from './pattern-hints-model.js';
import { loadTemplate } from './utils/template-loader.js';
import { detectAuth } from '../auth/auth-detector.js';
import { callLLMviaCli } from '../auth/cli-proxy.js';
import { callLLMviaCodex } from '../auth/codex-proxy.js';
import { resolveReverseSpecModel } from '../core/model-selection.js';

const LLM_TIMEOUT_MS = 2_500;

export type PatternHintsLLMEnhancer = (
  hints: PatternHint[],
  input: PatternHintsInput,
) => Promise<PatternHint[]>;

export interface PatternHintsGeneratorDependencies {
  architectureOverviewGenerator?: ArchitectureOverviewGenerator;
  knowledgeBase?: readonly PatternKnowledgeBaseEntry[];
  llmEnhancer?: PatternHintsLLMEnhancer;
}

export class PatternHintsGenerator
  implements DocumentGenerator<PatternHintsInput, PatternHintsOutput>
{
  readonly id = 'pattern-hints' as const;
  readonly name = '架构模式提示生成器' as const;
  readonly description = '基于架构概览共享模型生成模式提示、证据链与 explanation 附录';

  private readonly architectureOverviewGenerator: ArchitectureOverviewGenerator;
  private readonly knowledgeBase: readonly PatternKnowledgeBaseEntry[];
  private readonly llmEnhancer: PatternHintsLLMEnhancer;

  constructor(dependencies: PatternHintsGeneratorDependencies = {}) {
    this.architectureOverviewGenerator = dependencies.architectureOverviewGenerator ?? new ArchitectureOverviewGenerator();
    this.knowledgeBase = dependencies.knowledgeBase ?? DEFAULT_PATTERN_KNOWLEDGE_BASE;
    this.llmEnhancer = dependencies.llmEnhancer ?? defaultPatternHintsLLMEnhancer;
  }

  isApplicable(context: ProjectContext): boolean | Promise<boolean> {
    return this.architectureOverviewGenerator.isApplicable(context);
  }

  async extract(context: ProjectContext): Promise<PatternHintsInput> {
    const architectureOverview = await this.architectureOverviewGenerator.generate(
      await this.architectureOverviewGenerator.extract(context),
    );

    return {
      architectureOverview,
      warnings: [...architectureOverview.warnings],
      weakSignals: {
        runtimeAvailable: architectureOverview.deploymentView?.available ?? false,
        docGraphAvailable: context.existingSpecs.length > 0,
      },
    };
  }

  async generate(input: PatternHintsInput, options?: GenerateOptions): Promise<PatternHintsOutput> {
    const evaluation = evaluatePatternHints(
      {
        architectureOverview: input.architectureOverview,
        weakSignals: input.weakSignals,
      },
      this.knowledgeBase,
    );

    const warnings = new Set<string>([
      ...input.warnings,
      ...input.architectureOverview.warnings,
      ...evaluation.warnings,
    ]);

    let matchedPatterns = evaluation.matchedPatterns;
    if (options?.useLLM && matchedPatterns.length > 0) {
      try {
        matchedPatterns = await this.llmEnhancer(matchedPatterns, input);
      } catch (error) {
        warnings.add(`LLM explanation 增强失败，已回退规则输出: ${String(error)}`);
      }
    }

    const normalizedWarnings = uniqueSorted([...warnings]);
    const model = {
      projectName: input.architectureOverview.model.projectName,
      matchedPatterns,
      noHighConfidenceMatch: matchedPatterns.length === 0,
      alternatives: evaluation.alternatives,
      warnings: normalizedWarnings,
      stats: summarizePatternHints(
        {
          matchedPatterns,
          warnings: normalizedWarnings,
        },
        evaluation.totalPatternsEvaluated,
      ),
    };

    return {
      title: `架构模式提示: ${model.projectName}`,
      generatedAt: input.architectureOverview.generatedAt,
      architectureOverview: input.architectureOverview,
      model,
      warnings: normalizedWarnings,
    };
  }

  render(output: PatternHintsOutput): string {
    const overviewMarkdown = this.architectureOverviewGenerator.render(output.architectureOverview).trimEnd();
    const appendixTemplate = loadTemplate('pattern-hints.hbs', import.meta.url);
    const appendixMarkdown = appendixTemplate(output).trim();
    return `${overviewMarkdown}\n\n${appendixMarkdown}\n`;
  }
}

async function defaultPatternHintsLLMEnhancer(
  hints: PatternHint[],
  input: PatternHintsInput,
): Promise<PatternHint[]> {
  if (hints.length === 0) {
    return hints;
  }

  const auth = detectAuth();
  if (!auth.preferred) {
    return hints;
  }

  const systemPrompt = [
    '你是架构文档说明增强器。',
    '你的任务不是重新判断模式，也不是修改 confidence、evidence 或 alternatives。',
    '你只能在既有结构化事实基础上，重写 explanation 和 summary 的中文表述。',
    '若输入包含 [推断] 或证据不足信息，输出必须保留这种不确定性。',
    '严格输出 JSON 数组，每个元素包含 patternId、summary、explanation 三个字段，不要输出其他内容。',
  ].join('\n');

  const userPrompt = JSON.stringify({
    projectName: input.architectureOverview.model.projectName,
    patterns: hints.map((hint) => ({
      patternId: hint.patternId,
      patternName: hint.patternName,
      summary: hint.summary,
      explanation: hint.explanation,
      matchedSignals: hint.matchedSignals,
      missingSignals: hint.missingSignals,
      alternatives: hint.competingAlternatives.map((alternative) => ({
        patternName: alternative.patternName,
        reason: alternative.reason,
      })),
      inferred: hint.inferred,
    })),
  });

  const responseText = await callPatternHintsLLM(systemPrompt, userPrompt);
  if (!responseText) {
    return hints;
  }

  const parsed = parsePatternHintsEnhancement(responseText);
  if (!parsed) {
    return hints;
  }

  const updates = new Map(parsed.map((item) => [item.patternId, item]));

  return hints.map((hint) => {
    const update = updates.get(hint.patternId);
    if (!update) {
      return hint;
    }

    const summary = normalizeInferenceMarker(update.summary?.trim() || hint.summary, hint.inferred);
    const explanation = normalizeInferenceMarker(
      update.explanation?.trim() || hint.explanation,
      hint.inferred,
    );

    return {
      ...hint,
      summary,
      explanation,
    };
  });
}

async function callPatternHintsLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const authResult = detectAuth();
  if (!authResult.preferred) {
    return null;
  }

  const providerRuntime = authResult.preferred.type === 'cli-proxy' && authResult.preferred.provider === 'codex'
    ? 'codex'
    : 'claude';
  const model = process.env['PANORAMIC_LLM_MODEL'] ?? resolveReverseSpecModel({
    provider: providerRuntime,
  }).model;

  if (authResult.preferred.type === 'api-key') {
    const client = new Anthropic({
      apiKey: process.env['ANTHROPIC_API_KEY'],
      timeout: LLM_TIMEOUT_MS,
    });

    const response = await client.messages.create({
      model,
      max_tokens: 1_024,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return text || null;
  }

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  const cliResponse = authResult.preferred.provider === 'codex'
    ? await callLLMviaCodex(fullPrompt, { model, timeout: LLM_TIMEOUT_MS })
    : await callLLMviaCli(fullPrompt, { model, timeout: LLM_TIMEOUT_MS });

  return cliResponse.content || null;
}

function parsePatternHintsEnhancement(
  text: string,
): Array<{ patternId: string; summary?: string; explanation?: string }> | null {
  try {
    const parsed = extractJsonArray(text);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => typeof item['patternId'] === 'string')
      .map((item) => ({
        patternId: String(item['patternId']),
        summary: typeof item['summary'] === 'string' ? item['summary'] : undefined,
        explanation: typeof item['explanation'] === 'string' ? item['explanation'] : undefined,
      }));
  } catch {
    return null;
  }
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]!.trim());
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  return JSON.parse(trimmed);
}

function normalizeInferenceMarker(text: string, inferred: boolean): string {
  if (!inferred || text.includes('[推断]')) {
    return text;
  }

  return `${text} [推断]`;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
