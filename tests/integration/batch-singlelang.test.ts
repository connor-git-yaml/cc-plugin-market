/**
 * 单语言非 TS/JS batch 集成测试
 * 验证 runBatch() 不再对纯 Python/Go/Java 项目返回 0 个模块。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: vi.fn(() => ({
    methods: [
      { type: 'api-key', provider: 'anthropic', available: false, details: '未设置' },
      { type: 'cli-proxy', provider: 'codex', available: false, details: '测试中禁用' },
      { type: 'cli-proxy', provider: 'claude', available: false, details: '测试中禁用' },
    ],
    preferred: null,
    diagnostics: ['integration test forces AST-only fallback'],
  })),
}));

import { runBatch } from '../../src/batch/batch-orchestrator.js';
import { groupFilesByLanguage } from '../../src/batch/language-grouper.js';
import { groupFilesToModules } from '../../src/batch/module-grouper.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { buildDirectoryGraph } from '../../src/graph/directory-graph.js';

const SINGLE_LANGUAGE_FIXTURES = [
  {
    language: 'python',
    fixtureDir: path.resolve(__dirname, '../fixtures/multilang/python'),
  },
  {
    language: 'go',
    fixtureDir: path.resolve(__dirname, '../fixtures/multilang/go'),
  },
  {
    language: 'java',
    fixtureDir: path.resolve(__dirname, '../fixtures/multilang/java'),
  },
] as const;

describe('runBatch 单语言非 TS/JS 路径', () => {
  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
  });

  afterEach(() => {
    LanguageAdapterRegistry.resetInstance();
  });

  it.each(SINGLE_LANGUAGE_FIXTURES)(
    '纯 $language 项目 batch 不再返回 0 个模块',
    async ({ fixtureDir }) => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-singlelang-'));

      try {
        copyDirectoryContents(fixtureDir, projectRoot);
        const expectedModules = await deriveModuleOrder(projectRoot);

        expect(expectedModules.length).toBeGreaterThan(0);

        const result = await runBatch(projectRoot, { force: false });

        expect(result.totalModules).toBe(expectedModules.length);
        expect(result.failed).toHaveLength(0);
        expect(
          result.successful.length + result.degraded.length + result.skipped.length,
        ).toBe(expectedModules.length);
        expect(result.successful.length + result.degraded.length).toBeGreaterThan(0);
        expect(fs.existsSync(path.join(projectRoot, 'specs', '_index.spec.md'))).toBe(true);
        expect(fs.existsSync(path.join(projectRoot, result.summaryLogPath))).toBe(true);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );
});

function copyDirectoryContents(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  }
}

async function deriveModuleOrder(projectRoot: string): Promise<string[]> {
  const scanResult = scanFiles(projectRoot, { projectRoot });
  const langResult = groupFilesByLanguage(scanResult.files);

  expect(langResult.groups).toHaveLength(1);
  const langGroup = langResult.groups[0]!;

  const graph = await buildDirectoryGraph(
    langGroup.files,
    projectRoot,
    langGroup.files.map((file) => ({
      filePath: file,
      language: langGroup.languageName,
      loc: 0,
      exports: [],
      imports: [],
      hash: '0'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'tree-sitter',
    })) as any,
  );

  return groupFilesToModules(graph).moduleOrder;
}
