/**
 * drift-orchestrator 单元测试
 * 验证 loadBaselineSkeleton 和 detectDrift 核心逻辑（US3）
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { detectDrift, loadBaselineSkeleton } from '../../src/diff/drift-orchestrator.js';

describe('loadBaselineSkeleton', () => {
  it('从 HTML 注释中正确反序列化 CodeSkeleton', () => {
    const skeleton = {
      filePath: 'src/auth.ts',
      language: 'typescript',
      loc: 120,
      exports: [
        { name: 'login', kind: 'function', signature: '(user: string) => Promise<Token>', startLine: 10, endLine: 30, isDefault: false },
      ],
      imports: [
        { moduleSpecifier: './token.js', isRelative: true, namedImports: ['Token'], isTypeOnly: true },
      ],
      hash: 'b'.repeat(64),
      analyzedAt: '2025-01-01T00:00:00.000Z',
      parserUsed: 'ts-morph',
    };

    const specContent = `---
title: auth
---

# 意图

认证模块

<!-- baseline-skeleton: ${JSON.stringify(skeleton)} -->
`;

    const result = loadBaselineSkeleton(specContent);
    expect(result.filePath).toBe('src/auth.ts');
    expect(result.language).toBe('typescript');
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0]!.name).toBe('login');
    expect(result.hash).toBe('b'.repeat(64));
    expect(result.parserUsed).toBe('ts-morph');
  });

  it('无基线注释时降级为 reconstructed 骨架', () => {
    const specContent = `---
title: legacy-module
---

# 意图

旧版模块

## 接口定义

### \`processData(input: string): Result\`

处理输入数据
`;

    const result = loadBaselineSkeleton(specContent);
    expect(result.parserUsed).toBe('reconstructed');
    expect(result.filePath).toContain('reconstructed');
  });

  it('损坏 JSON 时降级为 reconstructed', () => {
    const specContent = `---
title: broken
---

# 意图

<!-- baseline-skeleton: {invalid json here} -->
`;

    const result = loadBaselineSkeleton(specContent);
    expect(result.parserUsed).toBe('reconstructed');
  });

  it('空 spec 内容时返回最小骨架', () => {
    const result = loadBaselineSkeleton('');
    expect(result.parserUsed).toBe('reconstructed');
    expect(result.exports).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
  });

  it('Zod 验证失败时降级为 reconstructed', () => {
    // 缺少必需字段的 JSON
    const incomplete = JSON.stringify({
      filePath: 'test.ts',
      // 缺少 language, loc, exports, imports, hash 等必需字段
    });

    const specContent = `<!-- baseline-skeleton: ${incomplete} -->`;

    const result = loadBaselineSkeleton(specContent);
    expect(result.parserUsed).toBe('reconstructed');
  });
});

// F221：目录级合并把 exports 按裸名压成 Map，facade 的 re-export 别名条目
// 按文件路径排序后写覆盖同名真身时会掩盖真实实现变更；合并处过滤 re-export 后不再漏报。
describe('detectDrift — re-export 别名不掩盖真身变更（F221）', () => {
  it('facade 文件排序在真身之后时，真身签名变更仍被报告', async () => {
    bootstrapAdapters();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f221-drift-'));
    try {
      // z-facade.ts 路径排序在 a-impl.ts 之后：不过滤 re-export 时后写覆盖真身条目
      fs.writeFileSync(
        path.join(tempDir, 'a-impl.ts'),
        'export function foo(x: number): number { return x; }\n',
      );
      fs.writeFileSync(path.join(tempDir, 'z-facade.ts'), "export { foo } from './a-impl.js';\n");

      const baseline = {
        filePath: 'a-impl.ts',
        language: 'typescript',
        loc: 1,
        exports: [
          {
            name: 'foo',
            kind: 'function',
            signature: 'function foo(x: string): string',
            startLine: 1,
            endLine: 1,
            isDefault: false,
          },
        ],
        imports: [],
        hash: 'a'.repeat(64),
        analyzedAt: '2026-07-22T00:00:00.000Z',
        parserUsed: 'ts-morph',
      };
      const specPath = path.join(tempDir, 'mod.spec.md');
      fs.writeFileSync(
        specPath,
        `---\nversion: v1\n---\n\n# 意图\n\n<!-- baseline-skeleton: ${JSON.stringify(baseline)} -->\n`,
      );

      const report = await detectDrift(specPath, tempDir, {
        skipSemantic: true,
        outputDir: path.join(tempDir, 'drift-out'),
      });

      const fooSignatureChange = report.items.find(
        (item) =>
          item.symbolName === 'foo' &&
          item.oldValue?.includes('string') === true &&
          item.newValue?.includes('number') === true,
      );
      expect(fooSignatureChange).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
