/**
 * F221 — spec-renderer 序列化端行尾空白归一化单测（用例⑧⑨ + Codex 对抗审查补强）。
 *
 * why：LLM 段落的尾随空格历史上直通落盘触发 `git diff --check` 告警；
 * 三渲染出口（renderSpec / renderIndex / renderDriftReport）是生成文本的
 * 唯一序列化边界，在此断言归一化后不再出现行尾 space/tab，
 * 同时断言注入内容确实被渲染（证明是"清洗后保留"而非内容丢失）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderSpec,
  renderIndex,
  renderDriftReport,
  resetRenderer,
} from '../../src/generator/spec-renderer.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

const TRAILING_WS = /[ \t]+$/m;

/** 线性行尾检查（大文本断言不用正则，避免断言自身平方级回溯） */
function linesWithTrailingWhitespace(text: string): string[] {
  return text.split('\n').filter((line) => line.endsWith(' ') || line.endsWith('\t'));
}

function mkModuleSpec(): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'vitest',
      sourceTarget: 'src/demo',
      relatedFiles: ['src/demo/a.ts'],
      lastUpdated: '2026-07-22T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
    },
    sections: {
      intent: '意图段落带行尾空格   ',
      interfaceDefinition: '| 名称 | 类型 |\t',
      businessLogic: '正常行\n带尾空格的行  \n下一行',
      dataStructures: '数据结构 ',
      constraints: '约束',
      edgeCases: '边界',
      technicalDebt: '债务\t\t',
      testCoverage: '覆盖',
      dependencies: '依赖',
    },
    fileInventory: [{ path: 'src/demo/a.ts', loc: 10, purpose: '导出 foo' }],
    baselineSkeleton: {
      filePath: 'src/demo/a.ts',
      language: 'typescript',
      loc: 10,
      exports: [],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-07-22T00:00:00.000Z',
      parserUsed: 'ts-morph',
    },
    outputPath: 'specs/demo.spec.md',
  };
}

/** 从渲染产物中按标记提取 baseline-skeleton JSON（indexOf 提取，不用 `.` 正则——`.` 不匹配 U+2028 会截断） */
function extractBaselineJson(markdown: string): string {
  const startMarker = '<!-- baseline-skeleton: ';
  const startIdx = markdown.indexOf(startMarker);
  expect(startIdx).toBeGreaterThan(-1);
  const endIdx = markdown.indexOf(' -->', startIdx);
  expect(endIdx).toBeGreaterThan(startIdx);
  return markdown.slice(startIdx + startMarker.length, endIdx);
}

afterEach(() => {
  resetRenderer();
});

describe('spec-renderer 行尾空白归一化（F221）', () => {
  it('⑧ renderSpec：sections 注入行尾空格/tab 后输出零行尾空白', () => {
    const markdown = renderSpec(mkModuleSpec());
    expect(markdown).toContain('意图段落带行尾空格');
    expect(markdown).toContain('带尾空格的行');
    expect(markdown).not.toMatch(TRAILING_WS);
  });

  it('⑨ renderIndex：变量注入行尾空白后输出零行尾空白', () => {
    const index = renderIndex({
      frontmatter: {
        type: 'architecture-index',
        version: 'v1',
        generatedBy: 'vitest',
        projectRoot: '/proj',
        totalModules: 1,
        lastUpdated: '2026-07-22T00:00:00.000Z',
      },
      systemPurpose: '系统目的带尾空格   ',
      architecturePattern: '分层架构\t',
      moduleMap: [],
    });
    expect(index).toContain('系统目的带尾空格');
    expect(index).not.toMatch(TRAILING_WS);
  });

  it('⑨ renderDriftReport：行尾位置变量注入尾随空格后输出零行尾空白', () => {
    const drift = renderDriftReport({
      specPath: 'specs/demo.spec.md',
      sourcePath: 'src/demo',
      // generatedAt 渲染于行尾位置（`**生成时间**: {{generatedAt}}`），注入尾随空格验证剥离
      generatedAt: '2026-07-22T00:00:00.000Z  ',
      specVersion: 'v1',
      summary: { totalChanges: 0, high: 0, medium: 0, low: 0, additions: 0 },
    });
    expect(drift).toContain('生成时间');
    expect(drift).not.toMatch(TRAILING_WS);
  });

  it('baseline JSON 内容保真：U+2028 行界字符前的空格不被误删', () => {
    const spec = mkModuleSpec();
    // JSON.stringify 不转义 U+2028；旧正则实现的 `$`（m 模式）把它当行界会误删其前空格，
    // split('\n') 实现只认 \n，该字符串必须逐字节保真
    spec.baselineSkeleton.moduleDoc = 'keep  \u2028next';
    const markdown = renderSpec(spec);
    const parsed = JSON.parse(extractBaselineJson(markdown)) as { moduleDoc?: string };
    expect(parsed.moduleDoc).toBe('keep  \u2028next');
  });

  it('超长空格行线性处理（防正则回溯退化）且行内空格不动', () => {
    const spec = mkModuleSpec();
    const longSpaces = ' '.repeat(200_000);
    spec.sections.businessLogic = `x${longSpaces}x\n${longSpaces}`;
    const start = performance.now();
    const markdown = renderSpec(spec);
    // 旧正则实现（/[ \t]+$/gm）在此规模因平方级回溯需分钟级；线性实现毫秒级
    expect(performance.now() - start).toBeLessThan(2000);
    expect(markdown).toContain(`x${longSpaces}x`);
    expect(linesWithTrailingWhitespace(markdown)).toEqual([]);
  });
});
