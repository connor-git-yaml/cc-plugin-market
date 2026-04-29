/**
 * doc-discoverer + detectOpenQuestions 单元测试
 * Feature 145 T020：确认 discoverDesignDocs 能找到 README.md（P2 根因诊断）
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverDesignDocs } from '../../src/debt-scanner/design-docs/doc-discoverer.js';
import { detectOpenQuestions } from '../../src/debt-scanner/design-docs/index.js';

function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-doc-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return dir;
}

describe('discoverDesignDocs', () => {
  // T020: Feature 145 P2 — 确认 discoverDesignDocs 能找到 README.md
  it('T020: fixture 目录含 README.md → discoverDesignDocs 返回包含 README.md 的非空路径列表', () => {
    const root = makeTmp({
      'README.md': '# Python micrograd\n\nTODO: add more features\n',
      'src/main.py': 'def main(): pass',
    });
    const found = discoverDesignDocs(root);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some(p => p.endsWith('README.md'))).toBe(true);
  });

  it('找到根目录与一级子目录中的 README/architecture/notes/design（大小写不敏感）', () => {
    const root = makeTmp({
      'README.md': '# hi',
      'architecture.md': '# arch',
      'docs/notes.md': '# notes',
      'DESIGN.md': '# design',
      'src/foo.ts': 'const a = 1;',
      'docs/other.md': '# ignored',
      'sub/other/readme.md': '# too deep ignored', // 二级子目录不扫
    });
    const found = discoverDesignDocs(root).map((p) => p.slice(root.length + 1));
    expect(found).toContain('README.md');
    expect(found).toContain('architecture.md');
    expect(found).toContain('DESIGN.md');
    expect(found.some((p) => p.endsWith('docs/notes.md') || p.endsWith('docs\\notes.md'))).toBe(true);
    expect(found.every((p) => !p.includes('other.md'))).toBe(true);
    expect(found.every((p) => !p.includes('sub/other'))).toBe(true);
  });

  it('不存在目录返回空数组', () => {
    expect(discoverDesignDocs('/path/that/does/not/exist')).toEqual([]);
  });

  it('跳过 node_modules / dist / 隐藏目录', () => {
    const root = makeTmp({
      'README.md': '# hi',
      'node_modules/pkg/README.md': '# should skip',
      'dist/readme.md': '# should skip',
      '.hidden/readme.md': '# should skip',
    });
    const found = discoverDesignDocs(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.endsWith('README.md')).toBe(true);
  });
});

describe('detectOpenQuestions', () => {
  it('显式标记进入 confirmed（rule source）', () => {
    const root = makeTmp({
      'notes.md': [
        '# Design',
        '',
        '## Open Questions',
        '',
        'Should we use X or Y?',
        '',
        '## Other',
        '',
        'This is TBD.',
        '',
      ].join('\n'),
    });
    const r = detectOpenQuestions(root);
    expect(r.docsScanned).toBe(1);
    // "TBD" 显式命中 → confirmed
    const tbdHit = r.confirmed.find((e) => e.snippet.includes('TBD'));
    expect(tbdHit).toBeTruthy();
    // "Should we use X or Y?" 以问号结尾，由于 heading 包含 "Open Questions" 也应显式命中
    const openQuestionHit = r.confirmed.find((e) => e.snippet.includes('Should we use'));
    expect(openQuestionHit).toBeTruthy();
  });

  it('纯问号段落进入 llmCandidates', () => {
    const root = makeTmp({
      'notes.md': [
        '# Topic',
        '',
        'Is the algorithm correct?',
      ].join('\n'),
    });
    const r = detectOpenQuestions(root);
    expect(r.llmCandidates).toHaveLength(1);
    expect(r.llmCandidates[0]?.snippet).toContain('Is the algorithm correct?');
    expect(r.confirmed).toHaveLength(0);
  });

  it('中文 TBD 等显式标记也命中', () => {
    const root = makeTmp({
      'design.md': [
        '# 设计',
        '',
        '这个决策暂时待定。',
      ].join('\n'),
    });
    const r = detectOpenQuestions(root);
    expect(r.confirmed).toHaveLength(1);
    expect(r.confirmed[0]?.source).toBe('rule');
  });

  it('没有任何 design-doc 时返回 docsScanned=0', () => {
    const root = makeTmp({ 'src/a.ts': 'const a = 1;' });
    const r = detectOpenQuestions(root);
    expect(r.docsScanned).toBe(0);
    expect(r.confirmed).toHaveLength(0);
    expect(r.llmCandidates).toHaveLength(0);
  });
});
