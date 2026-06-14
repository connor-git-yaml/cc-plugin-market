/**
 * F190 T007/T008 — chunk-splitter 单元测试
 *
 * 覆盖契约：
 *   - 标题级切分（## / ###）
 *   - 超 400 token 段落再切
 *   - < 20 token 最小 chunk 合并到邻近
 *   - anchor slug 生成（小写、空格→连字符、去特殊字符）
 *   - 同 anchor 多 chunk 追加序号（#error-codes-2）
 *   - 无标题内容 chunkId 用 docId#_N
 *   - 幂等（相同输入两次产出相同 chunkId 集合）
 *   - 含中文的文档
 */

import { describe, it, expect } from 'vitest';
import { splitDocument } from '../../src/scaffold-kb/chunk-splitter.js';
import type { ParsedDoc, Chunk } from '../../src/scaffold-kb/types.js';

// ── 测试工厂 ────────────────────────────────────────────────────────────────

/** 构造最简 ParsedDoc */
function makeDoc(id: string, content: string): ParsedDoc {
  return {
    id,
    title: 'Test Doc',
    content,
    sourceUrl: 'https://example.com',
    lang: 'en',
  };
}

/** 生成指定长度的字符串（用于模拟超阈值内容） */
function repeat(text: string, times: number): string {
  return Array.from({ length: times }, () => text).join(' ');
}

// ── 标题级切分 ──────────────────────────────────────────────────────────────

describe('splitDocument — 标题级切分', () => {
  it('单个 ## 标题节产出一个 chunk', () => {
    const doc = makeDoc('doc-a', '## Introduction\n\nThis is the introduction.');
    const chunks = splitDocument(doc);

    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk).toBeDefined();
    expect(chunk!.chunkId).toBe('doc-a#introduction');
    expect(chunk!.anchor).toBe('introduction');
    expect(chunk!.docId).toBe('doc-a');
    expect(chunk!.contentRaw).toContain('Introduction');
    expect(chunk!.contentRaw).toContain('This is the introduction');
  });

  it('多个 ## 标题节各产出独立 chunk', () => {
    const doc = makeDoc(
      'doc-b',
      `## Getting Started

Install the SDK first.

## Error Codes

Refer to the error table below.`,
    );
    const chunks = splitDocument(doc);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.anchor).toBe('getting-started');
    expect(chunks[1]!.anchor).toBe('error-codes');
    expect(chunks[0]!.chunkId).toBe('doc-b#getting-started');
    expect(chunks[1]!.chunkId).toBe('doc-b#error-codes');
  });

  it('### 三级标题也能触发切分', () => {
    const doc = makeDoc(
      'doc-c',
      `### Authentication

Use Bearer token.

### Rate Limits

Max 100 req/s.`,
    );
    const chunks = splitDocument(doc);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.anchor).toBe('authentication');
    expect(chunks[1]!.anchor).toBe('rate-limits');
  });

  it('文档开头无标题的前置内容产出 #_N chunkId', () => {
    const doc = makeDoc(
      'doc-d',
      `This is a preamble without heading.

## Getting Started

Content here.`,
    );
    const chunks = splitDocument(doc);

    // 前置内容 + Getting Started = 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 找到前置内容的 chunk
    const preamble = chunks.find((c) => c.anchor === null);
    expect(preamble).toBeDefined();
    expect(preamble!.chunkId).toMatch(/^doc-d#_\d+$/);
  });
});

// ── anchor slug 生成 ────────────────────────────────────────────────────────

describe('splitDocument — anchor slug', () => {
  it('标题大写转小写', () => {
    const doc = makeDoc('doc', '## Error Codes\n\nsome content here');
    const chunks = splitDocument(doc);
    expect(chunks[0]!.anchor).toBe('error-codes');
  });

  it('标题含特殊字符只保留字母数字和连字符', () => {
    const doc = makeDoc('doc', '## API (v2.0)\n\nsome content here');
    const chunks = splitDocument(doc);
    // 特殊字符去除，连续连字符合并
    expect(chunks[0]!.anchor).toMatch(/^api/);
    expect(chunks[0]!.anchor).not.toContain('(');
    expect(chunks[0]!.anchor).not.toContain(')');
    expect(chunks[0]!.anchor).not.toContain('.');
  });

  it('中文标题保留中文字符', () => {
    const doc = makeDoc('zh-doc', '## 错误码说明\n\n错误码内容如下');
    const chunks = splitDocument(doc);
    expect(chunks[0]!.anchor).toContain('错误码');
  });

  it('同一 anchor 下多个 chunk 追加序号', () => {
    // 生成超过 400 token（1600 字符）的标题节，强制段落再切
    const longBody = repeat('This is a sentence for the error codes section.', 40);
    const doc = makeDoc(
      'doc-seq',
      `## Error Codes\n\n${longBody}`,
    );
    const chunks = splitDocument(doc);

    // 至少应产出 2 个 chunk（body 超阈值）
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // 第一个 chunk 无序号后缀
    expect(chunks[0]!.chunkId).toBe('doc-seq#error-codes');
    // 第二个 chunk 有 -2 后缀
    expect(chunks[1]!.chunkId).toBe('doc-seq#error-codes-2');
  });

  it('不同标题的 anchor 序号独立计数', () => {
    const longBody = repeat('Sentence for this section.', 65);
    const doc = makeDoc(
      'doc-multi',
      `## Section One\n\n${longBody}\n\n## Section Two\n\n${longBody}`,
    );
    const chunks = splitDocument(doc);

    const sectionOneChunks = chunks.filter((c) => c.anchor === 'section-one');
    const sectionTwoChunks = chunks.filter((c) => c.anchor === 'section-two');

    // 两个标题节各自独立计数
    expect(sectionOneChunks.length).toBeGreaterThanOrEqual(2);
    expect(sectionTwoChunks.length).toBeGreaterThanOrEqual(2);

    // section-two 的第一个 chunk 也应是无序号后缀（即 #section-two，不是 #section-two-3）
    expect(sectionTwoChunks[0]!.chunkId).toBe('doc-multi#section-two');
    expect(sectionTwoChunks[1]!.chunkId).toBe('doc-multi#section-two-2');
  });
});

// ── 段落级再切（> 400 token） ───────────────────────────────────────────────

describe('splitDocument — 超 400 token 段落再切', () => {
  it('标题节 body 超 400 token 时应产出多个 chunk', () => {
    // 1800 字符 ≈ 450 token，超过 400 token 阈值
    const body = repeat('This sentence fills up the paragraph content.', 40);
    expect(body.length).toBeGreaterThan(1600); // 确认超过阈值

    const doc = makeDoc('doc-large', `## Large Section\n\n${body}`);
    const chunks = splitDocument(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // 每个 chunk 不超过 2000 字符（500 token）
    for (const chunk of chunks) {
      expect(chunk.contentRaw.length).toBeLessThanOrEqual(2000);
    }
  });

  it('整节 ≤ 400 token 时产出单一 chunk', () => {
    const body = 'Short content.';
    const doc = makeDoc('doc-short', `## Short Section\n\n${body}`);
    const chunks = splitDocument(doc);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.contentRaw).toContain('Short Section');
    expect(chunks[0]!.contentRaw).toContain('Short content');
  });

  it('超大段落（单段落 > 400 token）按句子兜底切分', () => {
    // 无空行分隔的超长段落，需要句子级兜底
    const sentences = Array.from({ length: 50 }, (_, i) => `Sentence number ${i + 1} provides context.`);
    const singleParagraph = sentences.join(' '); // 无 \n\n，单段落
    expect(singleParagraph.length).toBeGreaterThan(1600);

    const doc = makeDoc('doc-bigpara', `## Big Para\n\n${singleParagraph}`);
    const chunks = splitDocument(doc);

    // 应切成多个，每个不超过 2000 字符
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.contentRaw.length).toBeLessThanOrEqual(2000);
    }
  });
});

// ── 最小 chunk 合并（< 20 token） ──────────────────────────────────────────

describe('splitDocument — 最小 chunk 合并', () => {
  it('过短内容（< 80 字符）不单独产出，合并到邻近', () => {
    // 大节后面跟一个非常短的段落
    const longBody = repeat('This is main content for the section body.', 40);
    const shortExtra = 'Short.'; // 6 字符，远低于 80
    const doc = makeDoc(
      'doc-merge',
      `## Main Section\n\n${longBody}\n\n${shortExtra}`,
    );
    const chunks = splitDocument(doc);

    // 不应存在 < 80 字符的独立 chunk（除非 rawTexts 只有一个）
    const tinyChunks = chunks.filter((c) => c.contentRaw.trim().length < 80);
    // 如果 rawTexts 长度 > 1，过短 chunk 被过滤
    // 过短 chunk 应合并，不应单独存在
    expect(tinyChunks.length).toBe(0);
  });

  it('单 chunk 文档即使很短也不丢弃', () => {
    // 仅有一个 chunk 时，即使过短也应保留（合并无邻居）
    const doc = makeDoc('doc-tiny', '## Hi\n\nOK');
    const chunks = splitDocument(doc);
    // 单节，即使 body 短，也应保留
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 幂等性 ──────────────────────────────────────────────────────────────────

describe('splitDocument — 幂等性', () => {
  it('相同输入两次产出相同 chunkId 集合与顺序', () => {
    const doc = makeDoc(
      'doc-idem',
      `## Introduction

Welcome to the documentation.

## API Reference

Here are the API details.

## Error Codes

Error 404 means not found.`,
    );

    const result1 = splitDocument(doc);
    const result2 = splitDocument(doc);

    expect(result1.map((c) => c.chunkId)).toEqual(result2.map((c) => c.chunkId));
    expect(result1.map((c) => c.contentRaw)).toEqual(result2.map((c) => c.contentRaw));
  });

  it('大文档多次调用产出相同结果', () => {
    const body = repeat('Content sentence for this section.', 45);
    const doc = makeDoc(
      'doc-idem-large',
      `## Section A\n\n${body}\n\n## Section B\n\n${body}`,
    );

    const ids1 = splitDocument(doc).map((c) => c.chunkId);
    const ids2 = splitDocument(doc).map((c) => c.chunkId);
    expect(ids1).toEqual(ids2);
  });
});

// ── 中文文档 ────────────────────────────────────────────────────────────────

describe('splitDocument — 中文文档', () => {
  it('中文标题正常切分并产出合理 anchor', () => {
    const doc = makeDoc(
      'zh-api',
      `## 快速开始

安装 SDK 后即可使用。

## 错误码说明

以下是完整的错误码列表：

- E001: 鉴权失败
- E002: 参数错误
- E003: 资源不存在`,
    );

    const chunks = splitDocument(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const anchors = chunks.map((c) => c.anchor);
    expect(anchors).toContain('快速开始');
    expect(anchors).toContain('错误码说明');
  });

  it('中英混合文档正常处理', () => {
    const doc = makeDoc(
      'zh-en-mixed',
      `## API 使用说明

调用 \`sdk.init()\` 初始化客户端。

### 参数说明

- \`apiKey\`: string — API 密钥
- \`timeout\`: number — 超时时间（ms）`,
    );

    const chunks = splitDocument(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // 所有 chunk 都有正确的 docId
    for (const chunk of chunks) {
      expect(chunk.docId).toBe('zh-en-mixed');
      expect(chunk.contentRaw.trim().length).toBeGreaterThan(0);
    }
  });

  it('纯中文超长文档正确切分且每个 chunk 不超上限', () => {
    // 生成中文超长段落（80 句 × ~26 字符 = ~2080 字符，超过 1600 阈值）
    const chineseSentences = Array.from(
      { length: 80 },
      (_, i) => `这是第${i + 1}句中文内容，用于测试切分逻辑是否正常运作。`,
    );
    const body = chineseSentences.join(''); // 约 2080 字符，超过 1600 阈值

    const doc = makeDoc(
      'zh-long',
      `## 详细说明\n\n${body}`,
    );

    const chunks = splitDocument(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    for (const chunk of chunks) {
      expect(chunk.contentRaw.length).toBeLessThanOrEqual(2000);
    }
  });
});

// ── 边界情况 ────────────────────────────────────────────────────────────────

describe('splitDocument — 边界情况', () => {
  it('空文档内容返回空数组', () => {
    const doc = makeDoc('doc-empty', '');
    const chunks = splitDocument(doc);
    expect(chunks).toHaveLength(0);
  });

  it('只有标题没有正文的文档', () => {
    const doc = makeDoc('doc-heading-only', '## Empty Section');
    const chunks = splitDocument(doc);
    // 标题节 body 为空，整节文本只有标题行（短），允许产出或不产出
    // 关键：不抛错
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('无标题的纯文本文档，chunkId 用 _N', () => {
    const doc = makeDoc('plain-doc', 'Simple paragraph without any heading at all.');
    const chunks = splitDocument(doc);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.anchor).toBeNull();
      expect(chunk.chunkId).toMatch(/^plain-doc#_\d+$/);
    }
  });

  it('所有 chunk 的 docId 与输入 doc.id 一致', () => {
    const doc = makeDoc(
      'my-unique-doc-id',
      `## Section A\n\nContent A.\n\n## Section B\n\nContent B.`,
    );
    const chunks = splitDocument(doc);
    for (const chunk of chunks) {
      expect(chunk.docId).toBe('my-unique-doc-id');
    }
  });

  it('chunk 内容不丢失原始文本信息', () => {
    const doc = makeDoc(
      'doc-content',
      `## Authentication

Use the Bearer token in Authorization header.`,
    );
    const chunks = splitDocument(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const allContent = chunks.map((c) => c.contentRaw).join(' ');
    expect(allContent).toContain('Bearer token');
    expect(allContent).toContain('Authorization');
  });
});

// ── Chunk 字段完整性 ────────────────────────────────────────────────────────

describe('splitDocument — Chunk 字段完整性', () => {
  it('每个 chunk 都包含 chunkId/docId/contentRaw/anchor 四个字段', () => {
    const doc = makeDoc('doc-fields', `## Section\n\nSome content here.`);
    const chunks = splitDocument(doc);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(typeof chunk.chunkId).toBe('string');
      expect(chunk.chunkId.length).toBeGreaterThan(0);
      expect(typeof chunk.docId).toBe('string');
      expect(chunk.docId).toBe('doc-fields');
      expect(typeof chunk.contentRaw).toBe('string');
      expect(chunk.contentRaw.trim().length).toBeGreaterThan(0);
      // anchor 可以是 string 或 null
      expect(chunk.anchor === null || typeof chunk.anchor === 'string').toBe(true);
    }
  });

  it('chunkId 格式为 docId#anchor 或 docId#_N', () => {
    const doc = makeDoc(
      'format-doc',
      `Preamble text here.\n\n## Named Section\n\nContent.`,
    );
    const chunks = splitDocument(doc);

    for (const chunk of chunks) {
      if (chunk.anchor !== null) {
        expect(chunk.chunkId).toBe(`format-doc#${chunk.anchor}`);
      } else {
        expect(chunk.chunkId).toMatch(/^format-doc#_\d+$/);
      }
    }
  });
});
