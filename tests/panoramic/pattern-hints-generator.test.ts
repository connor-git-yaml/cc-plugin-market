/**
 * PatternHintsGenerator 单元测试
 *
 * 覆盖：
 * - 045 架构概览输入到 050 模式提示附录输出
 * - evidence / why-not explanation
 * - 部分输入缺失与 useLLM 回退
 * - registry / barrel export / no-match 行为
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import * as panoramic from '../../src/panoramic/index.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';
import { PatternHintsGenerator } from '../../src/panoramic/pattern-hints-generator.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pattern-hints-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createContext(projectRoot: string, workspaceType: 'single' | 'monorepo'): ProjectContext {
  const configFiles = new Map<string, string>();

  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isFile()) {
      configFiles.set(entry.name, path.join(projectRoot, entry.name));
    }
  }

  return {
    projectRoot,
    configFiles,
    packageManager: 'unknown',
    workspaceType,
    detectedLanguages: [],
    existingSpecs: [],
  };
}

function setupCompositeFixture(projectRoot: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'pattern-hints-sample',
        workspaces: ['apps/*', 'packages/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'docker-compose.yml'),
    `services:
  gateway:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
      target: runner
    container_name: gateway-container
    ports:
      - 8080:8080
    depends_on:
      db:
        condition: service_started
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
`,
  );

  writeFile(
    path.join(projectRoot, 'apps/api/Dockerfile'),
    `FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm ci

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 8080
CMD ["node", "server.js"]
`,
  );

  writeFile(
    path.join(projectRoot, 'apps/api/package.json'),
    JSON.stringify(
      {
        name: '@repo/api',
        description: 'HTTP API service',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'apps/web/package.json'),
    JSON.stringify(
      {
        name: '@repo/web',
        description: 'Frontend application',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'packages/core/package.json'),
    JSON.stringify(
      {
        name: '@repo/core',
        description: 'Shared domain utilities',
      },
      null,
      2,
    ),
  );
}

function setupWorkspaceOnlyFixture(projectRoot: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'workspace-only-patterns',
        workspaces: ['apps/*', 'packages/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'apps/web/package.json'),
    JSON.stringify(
      {
        name: '@repo/web',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'packages/core/package.json'),
    JSON.stringify(
      {
        name: '@repo/core',
        description: 'Domain core',
      },
      null,
      2,
    ),
  );
}

function setupSparseFixture(projectRoot: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'sparse-patterns',
        workspaces: ['packages/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'packages/solo/package.json'),
    JSON.stringify(
      {
        name: '@repo/solo',
      },
      null,
      2,
    ),
  );
}

describe('PatternHintsGenerator - composite overview', () => {
  let tmpDir: string;
  let generator: PatternHintsGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new PatternHintsGenerator();
    setupCompositeFixture(tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('基于 045 输出生成模式提示附录，并保留 evidence / why-not explanation', async () => {
    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    const markdown = generator.render(output);

    expect(output.model.noHighConfidenceMatch).toBe(false);
    expect(output.model.matchedPatterns.map((hint) => hint.patternId)).toEqual(
      expect.arrayContaining(['service-oriented-runtime', 'layered-architecture']),
    );
    expect(output.model.matchedPatterns.every((hint) => hint.evidence.length > 0)).toBe(true);
    expect(output.model.matchedPatterns.some((hint) => hint.competingAlternatives.length > 0)).toBe(true);
    expect(output.model.matchedPatterns.some((hint) => hint.explanation.includes('为何判定'))).toBe(true);
    expect(output.model.matchedPatterns.some((hint) => hint.explanation.includes('为何不是其他模式'))).toBe(true);
    expect(output.model.matchedPatterns[0]).not.toHaveProperty('markdown');

    expect(markdown).toContain('# 架构概览: pattern-hints-sample');
    expect(markdown).toContain('## 架构模式提示');
    expect(markdown).toContain('#### 服务化运行时');
    expect(markdown).toContain('候选替代模式');
  });

  it('useLLM=true 时允许增强 explanation 文案，但不修改结构化事实', async () => {
    const enhancedGenerator = new PatternHintsGenerator({
      llmEnhancer: async (hints) => hints.map((hint, index) => ({
        ...hint,
        summary: index === 0 ? `增强摘要: ${hint.summary}` : hint.summary,
        explanation: index === 0 ? `增强说明: ${hint.explanation}` : hint.explanation,
      })),
    });

    const output = await enhancedGenerator.generate(
      await enhancedGenerator.extract(createContext(tmpDir, 'monorepo')),
      { useLLM: true },
    );

    expect(output.model.matchedPatterns[0]?.summary).toContain('增强摘要:');
    expect(output.model.matchedPatterns[0]?.explanation).toContain('增强说明:');
    expect(output.model.matchedPatterns[0]?.confidence).toBeGreaterThan(0.7);
  });
});

describe('PatternHintsGenerator - degradation and no-match handling', () => {
  let tmpDir: string;

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('缺少 deployment 视图且 LLM 不可用时，仍生成可审查输出并记录 warning', async () => {
    tmpDir = createTempDir();
    setupWorkspaceOnlyFixture(tmpDir);

    const generator = new PatternHintsGenerator({
      llmEnhancer: async () => {
        throw new Error('synthetic llm outage');
      },
    });

    const output = await generator.generate(
      await generator.extract(createContext(tmpDir, 'monorepo')),
      { useLLM: true },
    );
    const markdown = generator.render(output);

    expect(output.model.noHighConfidenceMatch).toBe(false);
    expect(output.model.matchedPatterns.map((hint) => hint.patternId)).toEqual(
      expect.arrayContaining(['modular-monolith', 'layered-architecture']),
    );
    expect(output.warnings.some((warning) => warning.includes('部署视图已降级'))).toBe(true);
    expect(output.warnings.some((warning) => warning.includes('LLM explanation 增强失败'))).toBe(true);
    expect(markdown).toContain('## 架构模式提示');
    expect(markdown).toContain('Warnings');
  });

  it('当没有模式达到最低阈值时，输出明确的 no-match 结论与候选模式', async () => {
    tmpDir = createTempDir();
    setupSparseFixture(tmpDir);

    const generator = new PatternHintsGenerator();
    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    const markdown = generator.render(output);

    expect(output.model.noHighConfidenceMatch).toBe(true);
    expect(output.model.matchedPatterns).toHaveLength(0);
    expect(output.model.alternatives.length).toBeGreaterThan(0);
    expect(markdown).toContain('未识别到高置信度模式');
    expect(markdown).toContain('候选模式');
  });
});

describe('PatternHintsGenerator - registry / exports 集成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    setupWorkspaceOnlyFixture(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('bootstrapGenerators 后可通过 pattern-hints id 查询，并能按上下文发现', async () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('pattern-hints');

    expect(generator).toBeInstanceOf(PatternHintsGenerator);

    const filtered = await registry.filterByContext(createContext(tmpDir, 'monorepo'));
    expect(filtered.some((item) => item.id === 'pattern-hints')).toBe(true);
  });

  it('barrel export 导出 generator、共享 helper 与知识库评估函数', () => {
    expect(panoramic.PatternHintsGenerator).toBe(PatternHintsGenerator);
    expect(typeof panoramic.evaluatePatternHints).toBe('function');
    expect(typeof panoramic.createPatternEvidenceRef).toBe('function');
    expect(Array.isArray(panoramic.DEFAULT_PATTERN_KNOWLEDGE_BASE)).toBe(true);
  });

  it('允许注入自定义知识库，而不需要修改 045 共享模型结构', async () => {
    const generator = new PatternHintsGenerator({
      knowledgeBase: [
        {
          id: 'custom-layered-signal',
          name: '自定义分层模式',
          summary: '用于验证知识库可扩展性。',
          positiveSignals: [
            {
              id: 'layered-section-available',
              description: '存在分层视图',
              sectionKind: 'layered',
              weight: 1,
            },
          ],
          negativeSignals: [],
          competingPatternIds: [],
          explanationSeed: '该模式仅用于测试自定义知识库注入。',
        },
      ],
    });

    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    expect(output.model.matchedPatterns[0]?.patternId).toBe('custom-layered-signal');
  });
});
