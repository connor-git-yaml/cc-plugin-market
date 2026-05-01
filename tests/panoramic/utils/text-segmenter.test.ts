/**
 * text-segmenter 工具函数单元测试（Feature 125）
 * 覆盖 Intl.Segmenter 包装、CJK 友好截断、链接密集判定、描述性段落过滤
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  segmentText,
  truncateAtNaturalBoundary,
  isLinkHeavyParagraph,
  isDescriptiveText,
  cjkRatio,
  isMostlyChinese,
} from '../../../src/panoramic/utils/text-segmenter.js';

describe('segmentText', () => {
  it('按 word 粒度分段英文文本', () => {
    const segments = segmentText('Hello world from Spectra', 'word');
    expect(segments).toContain('Hello');
    expect(segments).toContain('world');
    // 空格也是一个 segment（非 word-like），具体内容取决于 ICU 数据，不做严格断言
    expect(segments.length).toBeGreaterThan(3);
  });

  it('按 sentence 粒度分段中英混排', () => {
    const segments = segmentText('这是第一句。This is second. 第三句！', 'sentence');
    expect(segments.length).toBeGreaterThanOrEqual(3);
  });

  it('grapheme 粒度分段 emoji 不拆字形簇', () => {
    // 一个带变体选择器的 emoji 在 grapheme 粒度下应保持完整
    const segments = segmentText('👨‍👩‍👧 family', 'grapheme');
    // 至少有 family + 空格，不会把 ZWJ 拆开
    expect(segments.some((s) => s.includes('👨'))).toBe(true);
  });

  it('空字符串返回空数组', () => {
    expect(segmentText('')).toEqual([]);
  });
});

describe('truncateAtNaturalBoundary', () => {
  it('文本未超长时原样返回（不加省略号）', () => {
    expect(truncateAtNaturalBoundary('short', 80)).toBe('short');
    expect(truncateAtNaturalBoundary('恰好二十字的中文字符串测试用例aa', 20)).toBe(
      '恰好二十字的中文字符串测试用例aa',
    );
  });

  it('英文长标题：截断点落在空格边界', () => {
    const title = 'Chat with any local or online LLM including llama3 qwen gemma mistral gpt claude gemini deepseek models';
    const truncated = truncateAtNaturalBoundary(title, 80);
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(81);
    // 截断点前一字符应为空格（被 trimEnd 去掉）或标点
    const withoutEllipsis = truncated.slice(0, -1);
    const lastChar = withoutEllipsis.slice(-1);
    expect(/[a-zA-Z0-9]/.test(lastChar)).toBe(true); // 应该是完整单词结尾，不是中间
    // 关键：不应在 "deepse" 这种单词中间截断
    expect(withoutEllipsis).not.toMatch(/ [a-z]{1,3}$/i);
  });

  it('中文长标题：截断点落在 CJK 标点边界', () => {
    const title = '这是一个很长的中文场景标题，描述了批量项目文档化的完整流程，包括产品概览、用户旅程、feature brief 三类文档的统一生成。';
    const truncated = truncateAtNaturalBoundary(title, 30);
    expect(truncated.endsWith('…')).toBe(true);
    // 中文标题应该在标点边界（，。、；）截断
    const withoutEllipsis = truncated.slice(0, -1);
    // 检查截断点前一字符（原文中）是自然边界字符
    const boundaryChars = ['，', '。', '、', '；', '：', '！', '？', ' '];
    const boundaryIdx = title.lastIndexOf(withoutEllipsis) + withoutEllipsis.length;
    if (boundaryIdx < title.length) {
      const nextChar = title[boundaryIdx];
      const isBoundary =
        (nextChar !== undefined && boundaryChars.includes(nextChar)) ||
        (withoutEllipsis.length > 0 && boundaryChars.includes(withoutEllipsis.slice(-1)!));
      expect(isBoundary).toBe(true);
    }
  });

  it('无任何自然断点时降级为 Intl word boundary 或硬截断', () => {
    // 一串纯字母无空格（极端 case）
    const title = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJK';
    const truncated = truncateAtNaturalBoundary(title, 15);
    expect(truncated.endsWith('…')).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(16);
  });

  it('空字符串原样返回', () => {
    expect(truncateAtNaturalBoundary('', 10)).toBe('');
  });

  it('maxLen 大于文本长度时原样返回', () => {
    expect(truncateAtNaturalBoundary('short', 100)).toBe('short');
  });
});

describe('isLinkHeavyParagraph', () => {
  it('英文纯链接导航行返回 true', () => {
    const text = '[View Documentation](https://docs.example.com)';
    expect(isLinkHeavyParagraph(text)).toBe(true);
  });

  it('中文长段 + 单个 markdown link：返回 false（link 占比低）', () => {
    const text = '这是一段完整的中文描述，解释了产品的核心功能与设计原则，主要面向需要理解系统架构的开发者和产品经理。详情见[文档](https://docs.example.com)。';
    expect(isLinkHeavyParagraph(text)).toBe(false);
  });

  it('纯文字段落返回 false', () => {
    expect(isLinkHeavyParagraph('This is a paragraph without any links.')).toBe(false);
  });

  it('空字符串返回 false', () => {
    expect(isLinkHeavyParagraph('')).toBe(false);
  });
});

describe('isDescriptiveText', () => {
  it('中文长段落 + markdown link 被识别为描述性', () => {
    const text = '这是一段完整的中文描述，解释了产品的核心功能与设计原则，面向需要理解系统架构的开发者。详情见[文档](url)。';
    expect(isDescriptiveText(text)).toBe(true);
  });

  it('以 HTML 开头的段落被排除', () => {
    expect(isDescriptiveText('<p align="center">something with content</p>')).toBe(false);
  });

  it('Markdown 标题行被排除', () => {
    expect(isDescriptiveText('## Features section heading line content')).toBe(false);
  });

  it('纯 badge/链接行被排除', () => {
    expect(isDescriptiveText('[![Build](img)](url)')).toBe(false);
    expect(isDescriptiveText('![logo](url)')).toBe(false);
  });

  it('Markdown 表格行被排除', () => {
    expect(isDescriptiveText('| col | value | another column with content |')).toBe(false);
  });

  it('极短段落被排除（默认 minLength = 20）', () => {
    expect(isDescriptiveText('short text here')).toBe(false);
  });

  it('英文描述性段落返回 true', () => {
    const text = 'Spectra is a reverse-engineering tool that generates product docs from source code analysis.';
    expect(isDescriptiveText(text)).toBe(true);
  });
});

describe('cjkRatio (Feature 147 bug fix: 中英混杂检测)', () => {
  it('纯英文返回 0', () => {
    expect(cjkRatio('Hello world from Spectra')).toBe(0);
  });

  it('纯中文返回 1', () => {
    expect(cjkRatio('这是一个中文段落，没有任何英文。')).toBe(1);
  });

  it('中英混合返回中间比率', () => {
    // "Hello 你好" → 5 letters + 2 CJK = 2/7 ≈ 0.286
    const ratio = cjkRatio('Hello 你好');
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.4);
  });

  it('忽略空白/标点/数字（只数 letter-like）', () => {
    // "abc 123 !@#" → 3 letters + 0 CJK = 0
    expect(cjkRatio('abc 123 !@#')).toBe(0);
    // "abc 你好 123 !@#" → 3 letters + 2 CJK = 2/5 = 0.4
    expect(cjkRatio('abc 你好 123 !@#')).toBeCloseTo(0.4, 2);
  });

  it('空字符串返回 0', () => {
    expect(cjkRatio('')).toBe(0);
  });

  it('真实英文 README 段落（micrograd）返回近 0', () => {
    const englishReadme = 'A tiny Autograd engine (with a bite!). Implements backpropagation (reverse-mode autodiff) over a dynamically built DAG.';
    expect(cjkRatio(englishReadme)).toBe(0);
  });
});

describe('isMostlyChinese', () => {
  it('纯英文返回 false', () => {
    expect(isMostlyChinese('A tiny Autograd engine')).toBe(false);
  });

  it('纯中文返回 true', () => {
    expect(isMostlyChinese('一个微小的自动求导引擎')).toBe(true);
  });

  it('中文 ≥ 30%（默认阈值）返回 true', () => {
    // "项目 spec-driver autoscale" → 2 CJK + ~17 letters = 2/19 ≈ 0.10 < 0.3 → false
    expect(isMostlyChinese('项目 spec-driver autoscale workflow')).toBe(false);
    // "中文工具 X" → 4 CJK + 1 letter = 4/5 = 0.8 → true
    expect(isMostlyChinese('中文工具 X')).toBe(true);
  });

  it('支持自定义阈值', () => {
    // "Hello 你好" CJK ratio ≈ 0.286，threshold=0.2 → true，0.5 → false
    expect(isMostlyChinese('Hello 你好', 0.2)).toBe(true);
    expect(isMostlyChinese('Hello 你好', 0.5)).toBe(false);
  });
});
