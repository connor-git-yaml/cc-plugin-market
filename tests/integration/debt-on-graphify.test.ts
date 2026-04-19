/**
 * F3 集成测试：对 graphify 示例项目跑完整 debt-intelligence pipeline
 *
 * - 目标：`_reference/graphify/worked/example/raw/`
 * - 断言：technical-debt.md 存在、open questions ≥ 3
 * - LLM 使用 StubLLMClient 避免真实 API 依赖
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateDebtIntelligence } from '../../src/panoramic/pipelines/debt-intelligence-pipeline.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { GoLanguageAdapter } from '../../src/adapters/go-adapter.js';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';
import { StubLLMClient } from '../../src/debt-scanner/llm-clients.js';
import { resetBlameCache } from '../../src/utils/git-blame.js';

function findRepoRoot(): string {
  // 测试运行在仓库根目录；_reference/graphify 使用相对路径
  return process.cwd();
}

describe('F3 集成：graphify 示例项目', () => {
  beforeEach(() => {
    resetBlameCache();
    LanguageAdapterRegistry.resetInstance();
    const registry = LanguageAdapterRegistry.getInstance();
    registry.register(new TsJsLanguageAdapter());
    registry.register(new PythonLanguageAdapter());
    registry.register(new GoLanguageAdapter());
    registry.register(new JavaLanguageAdapter());
  });

  it('生成 technical-debt.md 并识别 ≥ 3 个 open questions', async () => {
    const repoRoot = findRepoRoot();
    const projectRoot = path.join(repoRoot, '_reference', 'graphify', 'worked', 'example', 'raw');
    if (!fs.existsSync(projectRoot)) {
      // graphify fixture 不存在时跳过（CI 环境可能无该资源）
      console.warn('graphify fixture 不存在，跳过');
      return;
    }

    const specsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-graphify-'));

    // StubLLMClient：对 LLM 候选全部判 "isOpenQuestion=true" 以尽量多保留
    const stub = new StubLLMClient((input) => {
      // 从 userPrompt 中抽取所有 "key"
      const match = /Candidates \(JSON\):\s*(\[[\s\S]*?\])/.exec(input.userPrompt);
      const results: Array<{ key: string; isOpenQuestion: boolean; topics: string[] }> = [];
      if (match?.[1]) {
        try {
          const parsed = JSON.parse(match[1]) as Array<{ id: string; key: string; text: string }>;
          for (const p of parsed) {
            results.push({ key: p.key, isOpenQuestion: true, topics: ['misc'] });
          }
        } catch {
          /* ignore */
        }
      }
      return {
        text: JSON.stringify({ results }),
        inputTokens: 100,
        outputTokens: 50,
        model: 'stub-haiku',
      };
    });

    const res = await generateDebtIntelligence({
      projectRoot,
      specsDir,
      registry: LanguageAdapterRegistry.getInstance(),
      llmClient: stub,
    });

    expect(res.generated).toBe(true);
    expect(res.openQuestionsCount).toBeGreaterThanOrEqual(3);

    const outAbs = path.join(specsDir, 'project', 'technical-debt.md');
    expect(fs.existsSync(outAbs)).toBe(true);
    const md = fs.readFileSync(outAbs, 'utf-8');
    expect(md).toContain('# 技术债清单');
    expect(md).toContain('Design-doc 开放问题');
  });
});
