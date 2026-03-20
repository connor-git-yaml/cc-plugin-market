/**
 * batch 编排路径基准集成测试
 * 验证 runBatch(projectRoot) 在 cwd 不同场景下仍写入到 projectRoot 下的输出目录
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';

describe('runBatch 路径基准', () => {
  let projectRoot: string;
  let isolatedCwd: string;
  let previousCwd: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    previousCwd = process.cwd();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-path-project-'));
    isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-path-cwd-'));

    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'entry.ts'),
      `
export function greet(name: string): string {
  return \`hello \${name}\`;
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(isolatedCwd, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
  });

  it('cwd 与 projectRoot 不同时，输出仍写入 projectRoot/specs', async () => {
    process.chdir(isolatedCwd);
    const result = await runBatch(projectRoot, { force: false });

    expect(result.totalModules).toBeGreaterThan(0);
    expect(result.failed).toHaveLength(0);
    expect(
      result.successful.length + result.degraded.length + result.skipped.length,
    ).toBe(result.totalModules);

    // 摘要与索引都应位于 projectRoot 下，而非当前 cwd
    expect(fs.existsSync(path.join(projectRoot, result.summaryLogPath))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, result.summaryLogPath))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'specs', '_index.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, 'specs', '_index.spec.md'))).toBe(false);
  });

  it('outputDir 为相对路径时，基准应仍然是 projectRoot', async () => {
    process.chdir(isolatedCwd);
    const result = await runBatch(projectRoot, {
      force: false,
      outputDir: 'custom-specs',
    });

    expect(result.failed).toHaveLength(0);
    expect(
      result.successful.length + result.degraded.length + result.skipped.length,
    ).toBe(result.totalModules);
    expect(result.summaryLogPath.startsWith('custom-specs/')).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, result.summaryLogPath))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'custom-specs', '_index.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, 'custom-specs', '_index.spec.md'))).toBe(false);
  });
});
