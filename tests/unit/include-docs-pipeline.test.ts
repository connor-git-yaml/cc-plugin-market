/**
 * Feature 140 T23 — --include-docs 数据流单测
 *
 * 覆盖 spec FR-010：
 * - extraction-pipeline 在 includeDocs=true 时返回 readmeContent
 * - 不区分大小写匹配 README.md / readme.md / Readme.md
 * - 不截断（取消 v4.0.x 的 5k 上限）
 * - architecture-narrative 接受 readmeContent 并透传到 readmeExcerpt 字段
 * - --include-docs=false 时 readmeContent / readmeExcerpt 均为 undefined
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 提取器 mock — 避免真实 LLM / Vision / 缓存调用
vi.mock('../../src/extraction/markdown-extractor.js', () => ({
  extractMarkdown: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
}));
vi.mock('../../src/extraction/openapi-extractor.js', () => ({
  extractOpenApi: vi.fn().mockReturnValue({ nodes: [], edges: [] }),
}));
vi.mock('../../src/extraction/image-extractor.js', () => ({
  extractImage: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
}));
vi.mock('../../src/extraction/extraction-cache.js', () => ({
  fileExtractHash: vi.fn().mockReturnValue('mock-hash'),
  loadExtractCache: vi.fn().mockReturnValue(null),
  saveExtractCache: vi.fn().mockResolvedValue(undefined),
}));

import { runExtractionPipeline } from '../../src/extraction/extraction-pipeline.js';
import { buildArchitectureNarrative, renderArchitectureNarrative } from '../../src/panoramic/pipelines/architecture-narrative.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-docs-test-'));
  vi.clearAllMocks();
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('runExtractionPipeline — readmeContent 透传 (Feature 140 FR-010)', () => {
  it('case 1: includeDocs=true + 存在 README.md → readmeContent 含全量内容', async () => {
    const readmeBody = '# Test Project\n\nThis is the README.\n\n## Section\n\nMore content.';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readmeBody);
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(output.readmeContent).toBe(readmeBody);
  });

  it('case 2: includeDocs=true + 缺 README → readmeContent=undefined', async () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '# Other doc');
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(output.readmeContent).toBeUndefined();
  });

  it('case 3: includeDocs=false → readmeContent=undefined（即便 README 存在）', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Should not be read');
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: false,
      includeImages: false,
    });
    expect(output.readmeContent).toBeUndefined();
  });

  it('case 4: 不区分大小写 — readme.md 也能被识别', async () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# lowercase readme');
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(output.readmeContent).toBe('# lowercase readme');
  });

  // 注：原计划测试"多种大小写并存优先返回 README.md"，但在 macOS case-insensitive 文件
  // 系统上无法可靠创建多个大小写变体（同一物理文件，last write wins）。canonical 优先逻辑
  // 通过 case 4（lowercase 仍能命中）+ 源码 `canonical = candidates.find(name === 'README.md')`
  // 显式优先级保护，无需通过 fixture 测试。

  it('case 6: README 全量内容 > 5k tokens 不被截断（移除 v4.0.x 旧限制）', async () => {
    // 构造 30k 字符（约 8.5k tokens 估算）的长 README
    const longReadme = '# Long README\n' + 'A'.repeat(30_000);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), longReadme);
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(output.readmeContent).toBeDefined();
    expect(output.readmeContent!.length).toBe(longReadme.length); // 完整保留，不截断
  });

  it('case 7: 返回结构含 results + readmeContent 两个字段（向后兼容老 caller 升级）', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# r');
    const output = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(Array.isArray(output.results)).toBe(true);
    expect(typeof output.readmeContent === 'string' || output.readmeContent === undefined).toBe(true);
  });
});

describe('buildArchitectureNarrative — readmeContent 透传到 readmeExcerpt (T24)', () => {
  function makeMinimalOptions(overrides?: { readmeContent?: string }) {
    return {
      projectRoot: tmpDir,
      outputDir: tmpDir,
      // 提供完整 ProjectContext schema 字段（detectedLanguages/configFiles 必填）
      projectContext: {
        projectRoot: tmpDir,
        configFiles: new Map<string, string>(),
        packageManager: 'unknown' as const,
        workspaceType: 'single' as const,
        detectedLanguages: ['typescript'],
        existingSpecs: [],
      },
      generatedDocs: [],
      ...overrides,
    };
  }

  it('case 8: 不传 readmeContent → output 不含 readmeExcerpt 字段（向后兼容）', () => {
    const out = buildArchitectureNarrative(makeMinimalOptions());
    expect(out.readmeExcerpt).toBeUndefined();
  });

  it('case 9: 短 readmeContent (< 1000 chars) → readmeExcerpt 完整保留', () => {
    const readme = '# Short README\n\nNice content here.';
    const out = buildArchitectureNarrative(makeMinimalOptions({ readmeContent: readme }));
    expect(out.readmeExcerpt).toBe(readme);
  });

  it('case 10: 长 readmeContent (> 1000 chars) → readmeExcerpt 截断到 1000 + 省略号', () => {
    const longReadme = '# Long\n\n' + 'B'.repeat(2000);
    const out = buildArchitectureNarrative(makeMinimalOptions({ readmeContent: longReadme }));
    expect(out.readmeExcerpt).toBeDefined();
    expect(out.readmeExcerpt!.length).toBeLessThanOrEqual(1001); // 1000 + "…"
    expect(out.readmeExcerpt!.endsWith('…')).toBe(true);
  });

  it('case 11: 空白字符串 readmeContent → readmeExcerpt 不输出（避免噪声）', () => {
    const out = buildArchitectureNarrative(makeMinimalOptions({ readmeContent: '   \n\n  ' }));
    expect(out.readmeExcerpt).toBeUndefined();
  });

  it('case 12: renderArchitectureNarrative 真的把 readmeExcerpt 渲染到 markdown（修复 Codex review CRITICAL 1）', () => {
    const readme = '# Test Project README\n\n本项目的关键描述出现在这里。';
    const out = buildArchitectureNarrative(makeMinimalOptions({ readmeContent: readme }));
    const markdown = renderArchitectureNarrative(out);
    // .hbs 模板必须含 README 摘录段，且其中含 readme 原文关键串
    expect(markdown).toContain('README 摘录');
    expect(markdown).toContain('Test Project README');
    expect(markdown).toContain('本项目的关键描述');
  });

  it('case 13: 不传 readmeContent 时 markdown 不含 README 摘录段（默认行为不变）', () => {
    const out = buildArchitectureNarrative(makeMinimalOptions());
    const markdown = renderArchitectureNarrative(out);
    expect(markdown).not.toContain('README 摘录');
  });
});
