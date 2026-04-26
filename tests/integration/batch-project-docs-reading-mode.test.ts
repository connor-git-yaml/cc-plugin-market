/**
 * generateBatchProjectDocs reading 模式行为测试（Feature 133 adversarial post-fix）
 *
 * Codex adversarial review 指出：原 P0-2 修复只过滤了 registry-backed generators
 * （`modeSkipIds`），但 batch-project-docs.ts 中无条件运行的硬编码 pipeline
 * （architecture-narrative / component-view / dynamic-scenarios / adr-pipeline /
 * product-ux-docs）仍然产出，与 SKIP_IDS 声明矛盾。
 *
 * 这个集成测试验证 reading / code-only 模式下：
 * 1. 返回值 architectureNarrative 字段为 undefined
 * 2. outputDir 中不含 architecture-narrative / component-view / dynamic-scenarios /
 *    product-overview / user-journeys / feature-briefs 等产物
 *
 * 不依赖 LLM（registry-based generators 中可能调用 LLM 的也被 SKIP 了）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { generateBatchProjectDocs } from '../../src/panoramic/batch-project-docs.js';

describe('generateBatchProjectDocs reading 模式（Feature 133 adversarial post-fix）', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-project-docs-reading-'));

    // 最小 fixture：package.json + 一个 ts 源文件
    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'reading-mode-fixture', version: '1.0.0' }),
      'utf-8',
    );
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'index.ts'),
      'export function hi(): string { return "hi"; }\n',
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reading 模式：返回值 architectureNarrative 为 undefined', async () => {
    const outputDir = path.join(projectRoot, 'specs', 'project');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await generateBatchProjectDocs({
      projectRoot,
      outputDir,
      mode: 'reading',
    });

    expect(result.architectureNarrative).toBeUndefined();
  });

  it('reading 模式：不写硬编码 pipeline 产出（architecture-narrative / component-view / 等）', async () => {
    const outputDir = path.join(projectRoot, 'specs', 'project');
    fs.mkdirSync(outputDir, { recursive: true });

    await generateBatchProjectDocs({
      projectRoot,
      outputDir,
      mode: 'reading',
    });

    const forbidden = [
      'architecture-narrative.md',
      'architecture-narrative.json',
      'component-view.md',
      'component-view.json',
      'dynamic-scenarios.md',
      'dynamic-scenarios.json',
      'product-overview.md',
      'user-journeys.md',
    ];

    for (const filename of forbidden) {
      const fullPath = path.join(outputDir, filename);
      expect(fs.existsSync(fullPath), `reading 模式不应该写出 ${filename}`).toBe(false);
    }
  });

  it('code-only 模式：与 reading 模式同样不写产品文档', async () => {
    const outputDir = path.join(projectRoot, 'specs', 'project');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await generateBatchProjectDocs({
      projectRoot,
      outputDir,
      mode: 'code-only',
    });

    expect(result.architectureNarrative).toBeUndefined();

    const forbidden = ['architecture-narrative.md', 'product-overview.md', 'component-view.md'];
    for (const filename of forbidden) {
      expect(fs.existsSync(path.join(outputDir, filename))).toBe(false);
    }
  });

  it('full 模式：仍然写出硬编码 pipeline 产出（行为不变）', async () => {
    const outputDir = path.join(projectRoot, 'specs', 'project');
    fs.mkdirSync(outputDir, { recursive: true });

    const result = await generateBatchProjectDocs({
      projectRoot,
      outputDir,
      mode: 'full',
    });

    // architecture-narrative 是硬编码（基于 architectureOverview / generatedDocs 派生），
    // 即使没有 LLM 也会有 stub 输出
    expect(result.architectureNarrative).toBeDefined();
  });
});
