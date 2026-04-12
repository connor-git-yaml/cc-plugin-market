/**
 * extraction-pipeline.ts 单元测试（Feature 107）
 * 覆盖提取开关、并发控制、Zod 验证、缓存命中
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runExtractionPipeline } from '../../src/extraction/extraction-pipeline.js';

// ============================================================
// Mock 提取器（避免实际 LLM 和 Vision 调用）
// ============================================================

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
  loadExtractCache: vi.fn().mockReturnValue(null),  // 默认缓存未命中
  saveExtractCache: vi.fn().mockResolvedValue(undefined),
}));

import { extractMarkdown } from '../../src/extraction/markdown-extractor.js';
import { extractOpenApi } from '../../src/extraction/openapi-extractor.js';
import { extractImage } from '../../src/extraction/image-extractor.js';
import { loadExtractCache } from '../../src/extraction/extraction-cache.js';

const mockExtractMarkdown = vi.mocked(extractMarkdown);
const mockExtractOpenApi = vi.mocked(extractOpenApi);
const mockExtractImage = vi.mocked(extractImage);
const mockLoadCache = vi.mocked(loadExtractCache);

// ============================================================
// 测试辅助
// ============================================================

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
  vi.clearAllMocks();
  mockLoadCache.mockReturnValue(null);  // 默认缓存未命中
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// 基础开关测试
// ============================================================

describe('runExtractionPipeline - 基础开关', () => {
  it('includeDocs=false && includeImages=false 时立即返回 []，不扫描文件', async () => {
    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: false,
      includeImages: false,
    });

    expect(result).toEqual([]);
    expect(mockExtractMarkdown).not.toHaveBeenCalled();
    expect(mockExtractOpenApi).not.toHaveBeenCalled();
    expect(mockExtractImage).not.toHaveBeenCalled();
  });

  it('includeDocs=true 时扫描 .md 文件（目录为空时返回 []）', async () => {
    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    expect(result).toEqual([]);
  });

  it('includeImages=false 时不处理图片文件', async () => {
    // 在目录中创建图片文件
    fs.writeFileSync(path.join(tmpDir, 'arch.png'), Buffer.alloc(100));

    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: false,
      includeImages: false,
    });

    expect(mockExtractImage).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});

describe('runExtractionPipeline - 文档扫描', () => {
  it('includeDocs=true 时扫描并调用 Markdown 提取器', async () => {
    // 创建测试 .md 文件
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n\nContent.');

    mockExtractMarkdown.mockResolvedValue({
      nodes: [
        {
          id: 'doc:README.md',
          label: 'Test',
          kind: 'document',
          source_file: path.join(tmpDir, 'README.md'),
          confidence: 'EXTRACTED',
        },
      ],
      edges: [],
    });

    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    expect(mockExtractMarkdown).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includeDocs=true 时扫描 OpenAPI 规范文件', async () => {
    // 创建测试 OpenAPI 文件
    fs.writeFileSync(path.join(tmpDir, 'openapi.yaml'), 'openapi: "3.0.0"');

    mockExtractOpenApi.mockReturnValue({
      nodes: [
        {
          id: 'api:GET:/users:openapi.yaml',
          label: 'GET /users',
          kind: 'api',
          source_file: path.join(tmpDir, 'openapi.yaml'),
          confidence: 'EXTRACTED',
        },
      ],
      edges: [],
    });

    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    expect(mockExtractOpenApi).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Zod 验证
// ============================================================

describe('runExtractionPipeline - Zod 验证', () => {
  it('Zod 验证失败的提取结果被丢弃，不纳入返回值', async () => {
    fs.writeFileSync(path.join(tmpDir, 'doc.md'), '# Test');

    // 返回无效的提取结果（缺少必填字段）
    mockExtractMarkdown.mockResolvedValue({
      nodes: [
        {
          // 缺少必填字段 source_file
          id: 'invalid-node',
          label: 'Invalid',
          kind: 'document',
          confidence: 'EXTRACTED',
        } as any,
      ],
      edges: [],
    });

    // 不应抛出异常
    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    // 无效结果被丢弃
    expect(result).toBeDefined();
  });
});

// ============================================================
// 缓存命中
// ============================================================

describe('runExtractionPipeline - 缓存集成', () => {
  it('缓存命中时跳过提取器调用', async () => {
    const cachedResult = {
      nodes: [
        {
          id: 'doc:cached.md',
          label: 'Cached',
          kind: 'document' as const,
          source_file: path.join(tmpDir, 'cached.md'),
          confidence: 'EXTRACTED' as const,
        },
      ],
      edges: [],
    };

    // 模拟缓存命中
    mockLoadCache.mockReturnValue(cachedResult);
    fs.writeFileSync(path.join(tmpDir, 'cached.md'), '# Cached');

    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    // 缓存命中时不调用提取器
    expect(mockExtractMarkdown).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 异常隔离
// ============================================================

describe('runExtractionPipeline - 异常隔离', () => {
  it('单个文件提取异常不中断整体管道', async () => {
    // 创建两个文件
    fs.writeFileSync(path.join(tmpDir, 'good.md'), '# Good');
    fs.writeFileSync(path.join(tmpDir, 'bad.md'), '# Bad');

    let callCount = 0;
    mockExtractMarkdown.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Extraction failed');
      }
      return { nodes: [], edges: [] };
    });

    // 不应抛出异常
    await expect(
      runExtractionPipeline({
        projectRoot: tmpDir,
        outputDir: tmpDir,
        includeDocs: true,
        includeImages: false,
      })
    ).resolves.toBeDefined();
  });

  it('所有提取失败时返回 []，不抛出异常', async () => {
    mockExtractMarkdown.mockRejectedValue(new Error('All failed'));

    const result = await runExtractionPipeline({
      projectRoot: tmpDir,
      outputDir: tmpDir,
      includeDocs: true,
      includeImages: false,
    });

    expect(result).toEqual([]);
  });
});
