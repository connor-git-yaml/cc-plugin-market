/**
 * html-sanitizer 工具函数单元测试（Feature 125）
 * 覆盖 block-level HTML 剥除、行内尖括号保留、entity 解码、details/summary 提取
 */
import { describe, expect, it } from 'vitest';
import {
  stripBlockHtml,
  decodeHtmlEntities,
  sanitizeMarkdownContent,
} from '../../../src/panoramic/utils/html-sanitizer.js';

describe('stripBlockHtml', () => {
  it('剥除行首锚定的 <p> block，保留内部文字', () => {
    const input = '<p align="center">Khoj is an AI assistant for documents.</p>';
    const result = stripBlockHtml(input);
    expect(result).toContain('Khoj is an AI assistant for documents');
    expect(result).not.toContain('<p');
    expect(result).not.toContain('</p>');
  });

  it('剥除多行 <div> block，保留内部段落', () => {
    const input = [
      '<div align="center">',
      'Welcome to our project',
      '</div>',
    ].join('\n');
    const result = stripBlockHtml(input);
    expect(result).toContain('Welcome to our project');
    expect(result).not.toContain('<div');
  });

  it('保留 TypeScript 泛型（Array<T>、Map<K, V>）', () => {
    const input = 'The function returns Array<T> and Map<string, number> types.';
    const result = stripBlockHtml(input);
    expect(result).toContain('Array<T>');
    expect(result).toContain('Map<string, number>');
  });

  it('保留 CLI 占位符（<target>、<feature-id>）', () => {
    const input = 'Run spectra generate <target> --deep and specs/<feature-id>/ will be created.';
    const result = stripBlockHtml(input);
    expect(result).toContain('<target>');
    expect(result).toContain('<feature-id>');
  });

  it('保留数值比较表达式（< 5ms、a < b）', () => {
    const input = 'Response time < 5ms. In code: if (a < b) { return c > d; }';
    const result = stripBlockHtml(input);
    expect(result).toContain('< 5ms');
    expect(result).toContain('if (a < b)');
    expect(result).toContain('c > d');
  });

  it('提取 <details><summary> 内容', () => {
    const input = '<details><summary>点击展开</summary>这是详细内容。</details>';
    const result = stripBlockHtml(input);
    expect(result).toContain('点击展开');
    expect(result).toContain('这是详细内容');
  });

  it('剥除 <img> 自闭合标签', () => {
    const input = '<img src="logo.png" alt="Logo" />';
    const result = stripBlockHtml(input);
    expect(result.trim()).toBe('');
  });

  it('剥除 <br> 和 <hr> 无内容标签', () => {
    expect(stripBlockHtml('<br>').trim()).toBe('');
    expect(stripBlockHtml('<hr>').trim()).toBe('');
  });

  it('剥除 <h1>..<h6> 标题块但保留文字', () => {
    const input = '<h2>Section Title</h2>';
    const result = stripBlockHtml(input);
    expect(result).toContain('Section Title');
    expect(result).not.toContain('<h2');
  });

  it('不处理行内 HTML（非行首锚定）', () => {
    const input = 'Some text with inline <span>highlighted</span> content.';
    const result = stripBlockHtml(input);
    // 行内 span 保留（不是 block-level）
    expect(result).toContain('<span>highlighted</span>');
  });

  it('行首为 block HTML 但有正文的混合段落', () => {
    const input = [
      '<p align="center">Logo paragraph</p>',
      '',
      'This is a normal descriptive paragraph about the project.',
      '',
      'Another paragraph with inline <code>Array<T></code> reference.',
    ].join('\n');
    const result = stripBlockHtml(input);
    expect(result).toContain('Logo paragraph');
    expect(result).toContain('This is a normal descriptive paragraph');
    expect(result).toContain('<code>Array<T></code>'); // 行内 code 保留
  });

  it('空字符串返回空', () => {
    expect(stripBlockHtml('')).toBe('');
  });
});

describe('decodeHtmlEntities', () => {
  it('解码 &lt; &gt; &amp;', () => {
    expect(decodeHtmlEntities('a &lt; b &amp;&amp; c &gt; d')).toBe('a < b && c > d');
  });

  it('解码 &quot; &apos;', () => {
    expect(decodeHtmlEntities('&quot;hello&quot; and &apos;world&apos;')).toBe(
      `"hello" and 'world'`,
    );
  });

  it('解码数字实体 &#123;', () => {
    expect(decodeHtmlEntities('&#65;&#66;&#67;')).toBe('ABC');
  });

  it('解码十六进制数字实体 &#xAB;', () => {
    expect(decodeHtmlEntities('&#x41;&#x42;')).toBe('AB');
  });

  it('解码常见命名实体 &copy; &mdash; &hellip;', () => {
    expect(decodeHtmlEntities('&copy; 2026 &mdash; some &hellip;')).toBe(
      '© 2026 — some …',
    );
  });

  it('无实体的字符串原样返回', () => {
    expect(decodeHtmlEntities('plain text')).toBe('plain text');
  });

  it('双层编码 &amp;lt; 解码为 <', () => {
    expect(decodeHtmlEntities('&amp;lt;tag&amp;gt;')).toBe('<tag>');
  });
});

describe('sanitizeMarkdownContent', () => {
  it('组合使用：block HTML 剥除 + entity 解码', () => {
    const input = [
      '<p align="center"><img src="logo.png"></p>',
      '',
      'The API response format uses &lt;tag&gt; syntax.',
      '',
      'Generic types like Array<T> are fully supported.',
    ].join('\n');

    const result = sanitizeMarkdownContent(input);
    expect(result).not.toContain('<p align');
    expect(result).not.toContain('<img');
    expect(result).toContain('<tag>'); // entity 被解码
    expect(result).toContain('Array<T>'); // 泛型保留
  });
});
