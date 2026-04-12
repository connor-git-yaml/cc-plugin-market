/**
 * extraction-cache.ts 单元测试
 * 覆盖哈希计算稳定性、frontmatter 剥离、缓存读写
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  fileExtractHash,
  loadExtractCache,
  saveExtractCache,
} from '../../src/extraction/extraction-cache.js';
import type { ExtractionResult } from '../../src/extraction/extraction-types.js';

// ============================================================
// 测试辅助
// ============================================================

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-cache-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleResult: ExtractionResult = {
  nodes: [
    {
      id: 'doc:docs/adr-001.md',
      label: 'ADR-001',
      kind: 'document',
      source_file: '/project/docs/adr-001.md',
      confidence: 'EXTRACTED',
    },
  ],
  edges: [],
};

// ============================================================
// 哈希计算
// ============================================================

describe('fileExtractHash - 稳定性', () => {
  it('相同内容和路径输出相同 hash', () => {
    const content = 'Hello World';
    const filePath = '/project/docs/adr-001.md';
    const h1 = fileExtractHash(filePath, content);
    const h2 = fileExtractHash(filePath, content);
    expect(h1).toBe(h2);
  });

  it('内容不同时输出不同 hash', () => {
    const filePath = '/project/docs/adr-001.md';
    const h1 = fileExtractHash(filePath, 'Content A');
    const h2 = fileExtractHash(filePath, 'Content B');
    expect(h1).not.toBe(h2);
  });

  it('路径不同时输出不同 hash（内容相同）', () => {
    const content = 'Same Content';
    const h1 = fileExtractHash('/project/docs/a.md', content);
    const h2 = fileExtractHash('/project/docs/b.md', content);
    expect(h1).not.toBe(h2);
  });

  it('hash 为 64 位十六进制字符串', () => {
    const hash = fileExtractHash('/project/test.md', 'test content');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('fileExtractHash - Markdown frontmatter 剥离', () => {
  const frontmatter = '---\ntitle: ADR-001\nlastUpdated: 2026-01-01\n---\n';
  const body = '# Background\n\nThis is the content.';

  it('不带 isMarkdown=true 时 frontmatter 变化触发不同 hash', () => {
    const filePath = '/project/docs/adr-001.md';
    const h1 = fileExtractHash(filePath, frontmatter + body, false);
    const h2 = fileExtractHash(filePath, '---\ntitle: ADR-001\nlastUpdated: 2026-03-01\n---\n' + body, false);
    // 不剥离时，frontmatter 变化导致 hash 不同
    expect(h1).not.toBe(h2);
  });

  it('isMarkdown=true 时 frontmatter 变化不影响 hash', () => {
    const filePath = '/project/docs/adr-001.md';
    const content1 = '---\ntitle: ADR-001\nlastUpdated: 2026-01-01\n---\n' + body;
    const content2 = '---\ntitle: ADR-001\nlastUpdated: 2026-03-01\n---\n' + body;
    const h1 = fileExtractHash(filePath, content1, true);
    const h2 = fileExtractHash(filePath, content2, true);
    expect(h1).toBe(h2);
  });

  it('isMarkdown=true 时 body 变化触发不同 hash', () => {
    const filePath = '/project/docs/adr-001.md';
    const content1 = frontmatter + '# Background\n\nVersion 1.';
    const content2 = frontmatter + '# Background\n\nVersion 2.';
    const h1 = fileExtractHash(filePath, content1, true);
    const h2 = fileExtractHash(filePath, content2, true);
    expect(h1).not.toBe(h2);
  });

  it('无 frontmatter 的 Markdown 文件以完整内容计算 hash', () => {
    const filePath = '/project/docs/simple.md';
    const content = '# Simple\n\nNo frontmatter here.';
    const h1 = fileExtractHash(filePath, content, true);
    const h2 = fileExtractHash(filePath, content, false);
    // 无 frontmatter 时 isMarkdown 参数不影响结果
    expect(h1).toBe(h2);
  });
});

// ============================================================
// 缓存读写
// ============================================================

describe('loadExtractCache - 缓存未命中', () => {
  it('不存在的缓存条目返回 null', () => {
    const result = loadExtractCache('nonexistent-hash', tmpDir);
    expect(result).toBeNull();
  });
});

describe('saveExtractCache + loadExtractCache - 读写往返', () => {
  it('写入后可成功读取', async () => {
    const hash = 'test-hash-abc123';
    await saveExtractCache(hash, tmpDir, sampleResult, '/project/docs/adr-001.md');

    const loaded = loadExtractCache(hash, tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.nodes).toHaveLength(1);
    expect(loaded?.nodes[0]?.id).toBe('doc:docs/adr-001.md');
    expect(loaded?.edges).toHaveLength(0);
  });

  it('缓存文件写入到正确路径', async () => {
    const hash = 'test-hash-def456';
    await saveExtractCache(hash, tmpDir, sampleResult);

    const expectedPath = path.join(tmpDir, '_meta', 'extraction-cache', `${hash}.json`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('写入后加载结果与原始数据完全一致', async () => {
    const hash = 'test-hash-ghi789';
    const fullResult: ExtractionResult = {
      nodes: [
        {
          id: 'api:GET:/users:openapi.yaml',
          label: 'GET /users',
          kind: 'api',
          source_file: '/project/openapi.yaml',
          confidence: 'EXTRACTED',
          metadata: { tags: ['users'] },
        },
      ],
      edges: [
        {
          source: 'api:GET:/users:openapi.yaml',
          target: 'schema:UserSchema:openapi.yaml',
          relation: 'uses-schema',
          confidence: 'EXTRACTED',
          weight: 1.0,
        },
      ],
    };

    await saveExtractCache(hash, tmpDir, fullResult);
    const loaded = loadExtractCache(hash, tmpDir);

    expect(loaded?.nodes[0]?.id).toBe('api:GET:/users:openapi.yaml');
    expect(loaded?.edges[0]?.relation).toBe('uses-schema');
  });

  it('损坏的缓存文件返回 null', async () => {
    // 手动写入损坏的 JSON
    const hash = 'corrupt-hash';
    const cacheDir = path.join(tmpDir, '_meta', 'extraction-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `${hash}.json`), 'invalid json {{{', 'utf-8');

    const result = loadExtractCache(hash, tmpDir);
    expect(result).toBeNull();
  });
});
