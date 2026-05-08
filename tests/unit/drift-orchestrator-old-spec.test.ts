/**
 * Feature 151 — drift-orchestrator 向后兼容单测（FR-4 + SC-005 + EC-6）
 *
 * 目标：旧 spec.md（CodeSkeleton 中无 callSites 字段）继续被
 * `drift-orchestrator.loadBaselineSkeleton()` 正确解析，不抛 Zod 校验错。
 *
 * 覆盖 5 种代表性 fixture：
 *  1. TypeScript 模块 — Feature 040 风格
 *  2. Python 模块（无 callSites）— Feature 150 之前的 baseline
 *  3. Java 模块 — multi-language baseline
 *  4. 含完整 members + parseErrors 的复杂 fixture
 *  5. 极简 fixture（最少必填字段）
 */
import { describe, expect, it } from 'vitest';

import { CodeSkeletonSchema } from '../../src/models/code-skeleton.js';
import { loadBaselineSkeleton } from '../../src/diff/drift-orchestrator.js';

const FIXTURE_TS_MODULE = {
  filePath: 'src/foo.ts',
  language: 'typescript',
  loc: 42,
  exports: [
    {
      name: 'Foo',
      kind: 'class',
      signature: 'class Foo',
      isDefault: false,
      startLine: 1,
      endLine: 30,
    },
  ],
  imports: [],
  hash: 'a'.repeat(64),
  analyzedAt: '2026-04-01T10:00:00.000Z',
  parserUsed: 'ts-morph',
};

const FIXTURE_PYTHON_MODULE = {
  filePath: 'src/engine.py',
  language: 'python',
  loc: 248,
  exports: [
    {
      name: 'Value',
      kind: 'class',
      signature: 'class Value:',
      isDefault: false,
      startLine: 1,
      endLine: 200,
      members: [
        { name: '__init__', kind: 'method', signature: '__init__(self, data)', isStatic: false },
      ],
    },
  ],
  imports: [],
  hash: 'b'.repeat(64),
  analyzedAt: '2026-04-15T10:00:00.000Z',
  parserUsed: 'tree-sitter',
};

const FIXTURE_JAVA_MODULE = {
  filePath: 'src/Foo.java',
  language: 'java',
  loc: 50,
  exports: [
    {
      name: 'Foo',
      kind: 'class',
      signature: 'public class Foo',
      isDefault: false,
      startLine: 1,
      endLine: 50,
    },
  ],
  imports: [
    {
      moduleSpecifier: 'java.util.List',
      isRelative: false,
      isTypeOnly: false,
    },
  ],
  hash: 'c'.repeat(64),
  analyzedAt: '2026-04-20T10:00:00.000Z',
  parserUsed: 'tree-sitter',
};

const FIXTURE_COMPLEX_WITH_PARSE_ERRORS = {
  filePath: 'src/bar.ts',
  language: 'typescript',
  loc: 100,
  exports: [
    {
      name: 'Bar',
      kind: 'interface',
      signature: 'interface Bar',
      isDefault: false,
      startLine: 1,
      endLine: 20,
    },
  ],
  imports: [
    {
      moduleSpecifier: './foo',
      isRelative: true,
      resolvedPath: 'src/foo.ts',
      namedImports: ['Foo'],
      isTypeOnly: false,
    },
  ],
  parseErrors: [{ line: 50, column: 10, message: 'unexpected token' }],
  hash: 'd'.repeat(64),
  analyzedAt: '2026-04-25T10:00:00.000Z',
  parserUsed: 'ts-morph',
  moduleDoc: '示例模块',
};

const FIXTURE_MINIMAL_TS = {
  filePath: 'src/util.ts',
  language: 'typescript',
  loc: 5,
  exports: [],
  imports: [],
  hash: 'e'.repeat(64),
  analyzedAt: '2026-04-30T10:00:00.000Z',
  parserUsed: 'baseline',
};

const FIXTURES = [
  FIXTURE_TS_MODULE,
  FIXTURE_PYTHON_MODULE,
  FIXTURE_JAVA_MODULE,
  FIXTURE_COMPLEX_WITH_PARSE_ERRORS,
  FIXTURE_MINIMAL_TS,
];

function buildSpecWithBaseline(skeleton: object): string {
  return [
    '# 旧 spec — Feature 151 之前生成',
    '',
    `<!-- baseline-skeleton: ${JSON.stringify(skeleton)} -->`,
    '',
    '## 接口定义',
    '',
  ].join('\n');
}

describe('drift-orchestrator 旧 spec.md 向后兼容（FR-4 + SC-005）', () => {
  describe('CodeSkeletonSchema.parse 直接验证 5 个 fixture（Feature 151 之前）', () => {
    for (const [idx, fixture] of FIXTURES.entries()) {
      it(`fixture ${idx + 1} (${fixture.filePath}) 解析成功，callSites === undefined`, () => {
        const parsed = CodeSkeletonSchema.parse(fixture);
        expect(parsed.callSites).toBeUndefined();
        expect(parsed.filePath).toBe(fixture.filePath);
      });
    }
  });

  describe('loadBaselineSkeleton 端到端（含 spec.md 包装）', () => {
    for (const [idx, fixture] of FIXTURES.entries()) {
      it(`fixture ${idx + 1} (${fixture.filePath}) 通过 HTML 注释解析路径不抛错`, () => {
        const specContent = buildSpecWithBaseline(fixture);
        const skeleton = loadBaselineSkeleton(specContent);
        // 旧 fixture 不含 callSites 字段
        expect(skeleton.callSites).toBeUndefined();
        expect(skeleton.filePath).toBe(fixture.filePath);
        expect(skeleton.language).toBe(fixture.language);
        // parserUsed 与 fixture 一致（说明是从 HTML 注释路径解析，不是降级到 reconstructed）
        expect(skeleton.parserUsed).toBe(fixture.parserUsed);
      });
    }
  });

  describe('Feature 151 新 fixture (含 callSites) 也能正常解析', () => {
    it('含完整 callSites 的新 fixture 解析后字段完整', () => {
      const newFixture = {
        ...FIXTURE_PYTHON_MODULE,
        callSites: [
          {
            calleeName: '__add__',
            calleeKind: 'dunder',
            line: 50,
            callerContext: 'Value.forward',
          },
          {
            calleeName: 'super',
            calleeKind: 'super',
            line: 60,
          },
        ],
      };
      const parsed = CodeSkeletonSchema.parse(newFixture);
      expect(parsed.callSites).toHaveLength(2);
      expect(parsed.callSites?.[0].calleeName).toBe('__add__');
    });
  });
});
