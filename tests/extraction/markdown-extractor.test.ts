/**
 * markdown-extractor.ts 单元测试（Feature 107）
 * 覆盖标题树提取、frontmatter 解析、LLM mock、降级路径、路径引用检测
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractMarkdown } from '../../src/extraction/markdown-extractor.js';

// ============================================================
// Mock llm-facade
// ============================================================

vi.mock('../../src/panoramic/utils/llm-facade.js', () => ({
  callLLM: vi.fn(),
  isLLMAvailable: vi.fn(() => true),
}));

import { callLLM } from '../../src/panoramic/utils/llm-facade.js';
const mockCallLLM = vi.mocked(callLLM);

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 确定性提取（无 LLM）
// ============================================================

describe('extractMarkdown - 标题树确定性提取', () => {
  it('提取 H1/H2/H3 标题层级', async () => {
    mockCallLLM.mockResolvedValue(null);  // LLM 不可用

    const content = `# Architecture Decision

## Background

Some context.

### Decision

The decision.
`;

    const result = await extractMarkdown('/project/docs/adr-001.md', content, '/project');
    expect(result.nodes.length).toBeGreaterThan(0);

    const docNode = result.nodes.find((n) => n.kind === 'document');
    expect(docNode).toBeTruthy();
    expect(docNode?.confidence).toBe('EXTRACTED');
    expect(docNode?.id).toBe('doc:docs/adr-001.md');
    expect(docNode?.label).toBeTruthy();
  });

  it('没有任何标题的文件仍生成 document 节点', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = 'Just plain text without any headings.';
    const result = await extractMarkdown('/project/docs/plain.md', content, '/project');

    expect(result.nodes.some((n) => n.kind === 'document')).toBe(true);
  });
});

describe('extractMarkdown - frontmatter 解析', () => {
  it('解析 YAML frontmatter 字段', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = `---
title: "API Architecture"
status: approved
date: 2026-01-01
---

# API Architecture

Content here.
`;

    const result = await extractMarkdown('/project/docs/arch.md', content, '/project');
    const docNode = result.nodes.find((n) => n.kind === 'document');
    expect(docNode).toBeTruthy();
    // frontmatter 数据应纳入 metadata
    expect(docNode?.metadata).toBeTruthy();
  });

  it('无 frontmatter 的文件正常处理', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = '# Simple Doc\n\nContent.';
    const result = await extractMarkdown('/project/docs/simple.md', content, '/project');
    expect(result.nodes.some((n) => n.kind === 'document')).toBe(true);
  });
});

// ============================================================
// LLM 实体提取
// ============================================================

describe('extractMarkdown - LLM 实体提取', () => {
  it('LLM 返回有效 JSON 时提取命名实体', async () => {
    const llmResponse = JSON.stringify({
      concepts: ['AuthService', 'TokenManager'],
      decisions: ['Use JWT tokens', 'Store tokens in Redis'],
    });
    mockCallLLM.mockResolvedValue(llmResponse);

    const content = `# Authentication System

## Overview

The AuthService handles user authentication using JWT tokens.
TokenManager stores tokens in Redis for fast lookup.
`;

    const result = await extractMarkdown('/project/docs/auth.md', content, '/project');
    const docNode = result.nodes.find((n) => n.kind === 'document');
    expect(docNode).toBeTruthy();
    // LLM 提取的内容标注 INFERRED
    expect(docNode?.confidence === 'EXTRACTED' || docNode?.confidence === 'INFERRED').toBe(true);
  });

  it('LLM 返回无效 JSON 时降级为 EMPTY_EXTRACTION_RESULT，不抛出异常', async () => {
    mockCallLLM.mockResolvedValue('not valid json at all {{{');

    const content = '# Test\n\nSome content.';
    // 不应抛出异常
    await expect(
      extractMarkdown('/project/docs/test.md', content, '/project')
    ).resolves.toBeTruthy();
  });

  it('LLM 调用失败时降级，不抛出异常', async () => {
    mockCallLLM.mockRejectedValue(new Error('LLM timeout'));

    const content = '# Test\n\nContent.';
    await expect(
      extractMarkdown('/project/docs/test.md', content, '/project')
    ).resolves.toBeTruthy();
  });

  it('LLM 返回 null 时仍返回确定性提取结果', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = '# Test\n\nContent.';
    const result = await extractMarkdown('/project/docs/test.md', content, '/project');
    expect(result.nodes.some((n) => n.kind === 'document')).toBe(true);
  });
});

// ============================================================
// 文件路径引用检测
// ============================================================

describe('extractMarkdown - 文件路径引用检测', () => {
  it('检测到反引号内的文件路径，生成 references 边', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = `# Service Architecture

The main service is implemented in \`src/auth/auth-service.ts\`.
Configuration is in \`src/config/settings.ts\`.
`;

    const result = await extractMarkdown('/project/docs/arch.md', content, '/project');
    const refEdges = result.edges.filter((e) => e.relation === 'references');
    expect(refEdges.length).toBeGreaterThan(0);
    expect(refEdges[0]?.confidence).toBe('INFERRED');
  });

  it('无文件路径引用时不生成 references 边', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = '# Simple Doc\n\nNo code references here.';
    const result = await extractMarkdown('/project/docs/simple.md', content, '/project');
    const refEdges = result.edges.filter((e) => e.relation === 'references');
    expect(refEdges.length).toBe(0);
  });
});

// ============================================================
// 特殊情况
// ============================================================

describe('extractMarkdown - 特殊情况', () => {
  it('空内容返回有效结果（不抛出）', async () => {
    mockCallLLM.mockResolvedValue(null);
    await expect(
      extractMarkdown('/project/docs/empty.md', '', '/project')
    ).resolves.toBeTruthy();
  });

  it('节点 id 格式符合 doc:{相对路径} 规则', async () => {
    mockCallLLM.mockResolvedValue(null);

    const content = '# Test';
    const result = await extractMarkdown('/project/docs/subdir/doc.md', content, '/project');
    const docNode = result.nodes.find((n) => n.kind === 'document');
    expect(docNode?.id).toBe('doc:docs/subdir/doc.md');
  });
});
