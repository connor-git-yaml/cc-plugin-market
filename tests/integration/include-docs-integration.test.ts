/**
 * Feature 140 T25 — --include-docs 端到端集成测试
 *
 * 覆盖 spec FR-010：开关前后行为对比。
 *
 * **本文件实现策略**：使用临时目录 + mock LLM 提取器覆盖非 LLM 数据流。spec 中的
 * fixture-based 端到端 case（日志文本 / readmeExcerpt / 发给 LLM 的 prompt 入参，均不
 * 依赖 LLM 输出，技术上可填充）留 `it.todo()`，待有人写 mock-LLM 集成用例填充
 * （Feature 272 裁决：填充属新增测试覆盖而非清淤，已移交后续卡）。
 *
 * 验证目标：
 * 1. `--include-docs=true` → batch 末尾日志含"include-docs: 已加入 N 份"，无"跳过"
 * 2. `--include-docs=false` → 不读取 README，narrative 不含 readmeExcerpt
 * 3. extraction-pipeline + buildArchitectureNarrative 联动正确
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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
import { buildArchitectureNarrative } from '../../src/panoramic/pipelines/architecture-narrative.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'include-docs-int-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeProjectContext() {
  return {
    projectRoot: tmpDir,
    configFiles: new Map<string, string>(),
    packageManager: 'unknown' as const,
    workspaceType: 'single' as const,
    detectedLanguages: ['typescript'],
    existingSpecs: [],
  };
}

describe('Feature 140 FR-010 — --include-docs 端到端联动', () => {
  it('--include-docs=true → extraction 返回 readmeContent → narrative 含 readmeExcerpt', async () => {
    const readmeBody =
      '# Sample Project\n\n## Description\n\n本项目演示 Feature 140 FR-010 数据流。\n\n' +
      'README 全量内容会通过 extraction-pipeline 提供给 narrative pipeline，\n' +
      '让架构叙事能基于真实项目语境生成（而非依赖二次提炼的 module spec）。';
    fs.writeFileSync(path.join(tmpDir, 'README.md'), readmeBody);

    // Phase 1: extraction-pipeline 读取 README
    const extraction = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(extraction.readmeContent).toBe(readmeBody);

    // Phase 2: narrative 接收 readmeContent 并产出 readmeExcerpt
    const narrative = buildArchitectureNarrative({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      projectContext: makeProjectContext(),
      generatedDocs: [],
      readmeContent: extraction.readmeContent,
    });
    expect(narrative.readmeExcerpt).toBeDefined();
    // 完整保留（< 1000 chars）
    expect(narrative.readmeExcerpt).toBe(readmeBody);
    // 含项目特有字符串（验证不是 placeholder）
    expect(narrative.readmeExcerpt).toContain('Sample Project');
    expect(narrative.readmeExcerpt).toContain('Feature 140 FR-010');
  });

  it('--include-docs=false → extraction.readmeContent=undefined → narrative 不含 readmeExcerpt', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Should not be read');

    const extraction = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: false,
      includeImages: false,
    });
    expect(extraction.readmeContent).toBeUndefined();

    const narrative = buildArchitectureNarrative({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      projectContext: makeProjectContext(),
      generatedDocs: [],
      // 不传 readmeContent
    });
    expect(narrative.readmeExcerpt).toBeUndefined();
  });

  it('--include-docs=true 但项目无 README → narrative 不含 readmeExcerpt（不阻断）', async () => {
    // 仅创建非 README 的 .md
    fs.writeFileSync(path.join(tmpDir, 'CONTRIBUTING.md'), '# Contributing');

    const extraction = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(extraction.readmeContent).toBeUndefined();

    const narrative = buildArchitectureNarrative({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      projectContext: makeProjectContext(),
      generatedDocs: [],
    });
    expect(narrative.readmeExcerpt).toBeUndefined();
  });

  it('长 README → narrative readmeExcerpt 截断到 ~1000 chars + 省略号', async () => {
    const longReadme = '# Long\n\n' + 'X'.repeat(5_000);
    fs.writeFileSync(path.join(tmpDir, 'README.md'), longReadme);

    const extraction = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });
    expect(extraction.readmeContent!.length).toBe(longReadme.length); // extraction 不截断

    const narrative = buildArchitectureNarrative({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      projectContext: makeProjectContext(),
      generatedDocs: [],
      readmeContent: extraction.readmeContent,
    });
    expect(narrative.readmeExcerpt).toBeDefined();
    expect(narrative.readmeExcerpt!.length).toBeLessThanOrEqual(1001);
    expect(narrative.readmeExcerpt!.endsWith('…')).toBe(true);
  });

  // ============================================================================
  // 以下 fixture-based 用例技术上可填充（断言的是日志文本 / 纯截断的 readmeExcerpt /
  // 发给 LLM 的 prompt 入参，均不依赖 LLM 输出），待有人写 mock-LLM 集成用例填充；
  // 填充属新增测试覆盖而非清淤，已移交后续卡（Feature 272 裁决⑥）。
  // ============================================================================
  it.todo('fixture ky → batch 末尾日志含 "include-docs: 已加入 N 份"，不含 "跳过"');
  it.todo('fixture micrograd → narrative readmeExcerpt 反映 micrograd README');
  it.todo('fixture nanoGPT → hyperedge LLM 调用 prompt 包含 README virtual DocChunk');
});
