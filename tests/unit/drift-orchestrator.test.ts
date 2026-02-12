/**
 * drift-orchestrator 单元测试
 * 验证 loadBaselineSkeleton 和 detectDrift 核心逻辑（US3）
 */
import { describe, it, expect } from 'vitest';
import { loadBaselineSkeleton } from '../../src/diff/drift-orchestrator.js';

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
