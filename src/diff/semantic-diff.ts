/**
 * 基于 LLM 的语义 Diff
 * 评估函数体变更是否违反规格中声明的意图（FR-020）
 * 参见 contracts/diff-engine.md
 */
import { callLLM, buildSystemPrompt, type LLMConfig } from '../core/llm-client.js';
import { assembleContext } from '../core/context-assembler.js';
import type { DriftItem } from '../models/drift-item.js';
import type { CodeSkeleton } from '../models/code-skeleton.js';

/**
 * 委托 LLM 评估函数体变更是否导致行为漂移
 *
 * @param oldCode - 之前的函数体
 * @param newCode - 当前的函数体
 * @param specDescription - 规格中的相关描述
 * @returns DriftItem（如检测到漂移），否则 null
 */
export async function evaluateBehaviorChange(
  oldCode: string,
  newCode: string,
  specDescription: string,
): Promise<DriftItem | null> {
  const prompt = `请评估以下代码变更是否导致了行为漂移。

## 旧代码
\`\`\`typescript
${oldCode}
\`\`\`

## 新代码
\`\`\`typescript
${newCode}
\`\`\`

## 规格描述
${specDescription}

## 输出要求
如果代码变更改变了外部可观察行为，请回复以下 JSON：
\`\`\`json
{
  "hasDrift": true,
  "severity": "MEDIUM",
  "description": "变更描述",
  "proposedUpdate": "建议的规格更新"
}
\`\`\`

如果变更不影响外部行为（仅内部优化），请回复：
\`\`\`json
{
  "hasDrift": false
}
\`\`\``;

  // 构建一个简单的骨架用于 assembleContext
  const skeleton: CodeSkeleton = {
    filePath: 'semantic-diff-context',
    language: 'typescript',
    loc: prompt.split('\n').length,
    exports: [],
    imports: [],
    hash: '0'.repeat(64),
    analyzedAt: new Date().toISOString(),
    parserUsed: 'ts-morph',
  };

  const systemPrompt = buildSystemPrompt('semantic-diff');
  const context = await assembleContext(skeleton, {
    templateInstructions: systemPrompt,
    codeSnippets: [prompt],
  });

  try {
    const response = await callLLM(context);

    // 解析 LLM 响应中的 JSON
    const jsonMatch = /```json\s*([\s\S]*?)\s*```/.exec(response.content);
    if (!jsonMatch?.[1]) return null;

    const parsed = JSON.parse(jsonMatch[1]);
    if (!parsed.hasDrift) return null;

    return {
      id: `semantic-${Date.now()}`,
      severity: parsed.severity ?? 'MEDIUM',
      category: 'Behavior',
      changeType: 'modification',
      location: 'semantic-diff',
      symbolName: null,
      description: parsed.description ?? '检测到行为漂移',
      oldValue: oldCode.slice(0, 200),
      newValue: newCode.slice(0, 200),
      proposedUpdate: parsed.proposedUpdate ?? '请审查规格描述',
      detectedBy: 'semantic',
    };
  } catch {
    // LLM 不可用时返回 null（不阻塞漂移检测）
    return null;
  }
}
