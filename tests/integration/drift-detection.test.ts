/**
 * 漂移检测集成测试
 * 验证端到端漂移检测流水线（US3）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadBaselineSkeleton, detectDrift } from '../../src/diff/drift-orchestrator.js';
import { compareSkeletons } from '../../src/diff/structural-diff.js';
import { filterNoise } from '../../src/diff/noise-filter.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';

// 测试临时目录
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * 辅助：创建包含基线骨架的 spec 文件
 */
function createSpecWithBaseline(skeleton: CodeSkeleton): string {
  const specPath = path.join(tmpDir, 'test.spec.md');
  const baselineJson = JSON.stringify(skeleton);
  const content = `---
type: module-spec
version: v1
---

# 意图

测试模块

## 接口定义

测试接口

<!-- baseline-skeleton: ${baselineJson} -->
`;
  fs.writeFileSync(specPath, content, 'utf-8');
  return specPath;
}

/**
 * 辅助：创建源代码文件
 */
function createSourceFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('漂移检测集成测试', () => {
  it('新增函数 → LOW 严重级别', () => {
    const oldSkeleton: CodeSkeleton = {
      filePath: path.join(tmpDir, 'example.ts'),
      language: 'typescript',
      loc: 10,
      exports: [
        { name: 'existingFn', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
      ],
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };

    const newSkeleton: CodeSkeleton = {
      ...oldSkeleton,
      exports: [
        ...oldSkeleton.exports,
        { name: 'newFunction', kind: 'function', signature: '(x: number) => string', startLine: 6, endLine: 15, isDefault: false },
      ],
    };

    const items = compareSkeletons(oldSkeleton, newSkeleton);
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe('LOW');
    expect(items[0]!.changeType).toBe('addition');
    expect(items[0]!.symbolName).toBe('newFunction');
  });

  it('修改签名 → MEDIUM 严重级别', () => {
    const oldSkeleton: CodeSkeleton = {
      filePath: path.join(tmpDir, 'example.ts'),
      language: 'typescript',
      loc: 20,
      exports: [
        { name: 'transform', kind: 'function', signature: '(input: string) => number', startLine: 1, endLine: 10, isDefault: false },
      ],
      imports: [],
      hash: 'b'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };

    const newSkeleton: CodeSkeleton = {
      ...oldSkeleton,
      exports: [
        { name: 'transform', kind: 'function', signature: '(input: string, options?: Options) => Promise<number>', startLine: 1, endLine: 15, isDefault: false },
      ],
    };

    const items = compareSkeletons(oldSkeleton, newSkeleton);
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe('MEDIUM');
    expect(items[0]!.changeType).toBe('modification');
  });

  it('删除 export → HIGH 严重级别', () => {
    const oldSkeleton: CodeSkeleton = {
      filePath: path.join(tmpDir, 'example.ts'),
      language: 'typescript',
      loc: 30,
      exports: [
        { name: 'keepMe', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
        { name: 'removeMe', kind: 'function', signature: '() => string', startLine: 6, endLine: 15, isDefault: false },
      ],
      imports: [],
      hash: 'c'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };

    const newSkeleton: CodeSkeleton = {
      ...oldSkeleton,
      exports: [
        { name: 'keepMe', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
      ],
    };

    const items = compareSkeletons(oldSkeleton, newSkeleton);
    expect(items).toHaveLength(1);
    expect(items[0]!.severity).toBe('HIGH');
    expect(items[0]!.changeType).toBe('removal');
    expect(items[0]!.symbolName).toBe('removeMe');
  });

  it('仅空白变更 → 零漂移', () => {
    const oldSkeleton: CodeSkeleton = {
      filePath: path.join(tmpDir, 'example.ts'),
      language: 'typescript',
      loc: 10,
      exports: [
        { name: 'myFn', kind: 'function', signature: '() => void', startLine: 1, endLine: 5, isDefault: false },
      ],
      imports: [],
      hash: 'd'.repeat(64),
      analyzedAt: new Date().toISOString(),
      parserUsed: 'ts-morph',
    };

    // 相同骨架 → 零结构差异
    const rawItems = compareSkeletons(oldSkeleton, oldSkeleton);
    expect(rawItems).toHaveLength(0);

    // 即使有噪声项也会被过滤
    const noiseItems = [{
      id: 'noise-ws',
      severity: 'MEDIUM' as const,
      category: 'Interface' as const,
      changeType: 'modification' as const,
      location: 'test.ts:1',
      symbolName: 'x',
      description: '空白变更',
      oldValue: 'const x  =  1;',
      newValue: 'const x = 1;',
      proposedUpdate: '无需更新',
      detectedBy: 'structural' as const,
    }];

    const { substantive } = filterNoise(noiseItems, '', '');
    expect(substantive).toHaveLength(0);
  });

  it('loadBaselineSkeleton 从完整 spec 正确加载', () => {
    const skeleton: CodeSkeleton = {
      filePath: path.join(tmpDir, 'baseline.ts'),
      language: 'typescript',
      loc: 50,
      exports: [
        { name: 'process', kind: 'function', signature: '(data: Buffer) => Result', startLine: 5, endLine: 25, isDefault: false },
        { name: 'Config', kind: 'interface', signature: 'interface Config', startLine: 30, endLine: 40, isDefault: false },
      ],
      imports: [
        { moduleSpecifier: 'node:buffer', isRelative: false, namedImports: ['Buffer'], isTypeOnly: false },
      ],
      hash: 'e'.repeat(64),
      analyzedAt: '2025-06-01T00:00:00.000Z',
      parserUsed: 'ts-morph',
    };

    const specPath = createSpecWithBaseline(skeleton);
    const specContent = fs.readFileSync(specPath, 'utf-8');
    const loaded = loadBaselineSkeleton(specContent);

    expect(loaded.filePath).toBe(skeleton.filePath);
    expect(loaded.exports).toHaveLength(2);
    expect(loaded.exports[0]!.name).toBe('process');
    expect(loaded.exports[1]!.name).toBe('Config');
    expect(loaded.parserUsed).toBe('ts-morph');
  });

  it('完整流水线：真实源文件的漂移检测', async () => {
    // 创建 "旧版" 源文件骨架
    const sourceFile = createSourceFile('real-test.ts', `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}
`);

    const oldSkeleton: CodeSkeleton = {
      filePath: sourceFile,
      language: 'typescript',
      loc: 8,
      exports: [
        { name: 'greet', kind: 'function', signature: '(name: string) => string', startLine: 2, endLine: 4, isDefault: false },
        // add 不在旧骨架中 → 检测为新增
      ],
      imports: [],
      hash: 'f'.repeat(64),
      analyzedAt: '2025-01-01T00:00:00.000Z',
      parserUsed: 'ts-morph',
    };

    // 创建带基线的 spec
    const specPath = createSpecWithBaseline(oldSkeleton);

    // 运行漂移检测（跳过语义以避免 LLM 依赖）
    const driftLogsDir = path.join(tmpDir, 'drift-logs');
    const report = await detectDrift(specPath, sourceFile, {
      skipSemantic: true,
      outputDir: driftLogsDir,
    });

    // 验证报告
    expect(report.specPath).toBe(specPath);
    expect(report.sourcePath).toBe(sourceFile);
    expect(report.items.length).toBeGreaterThanOrEqual(1);

    // 应检测到 add 函数为新增（LOW）
    const addItem = report.items.find((i) => i.symbolName === 'add');
    expect(addItem).toBeDefined();
    expect(addItem!.severity).toBe('LOW');
    expect(addItem!.changeType).toBe('addition');

    // 验证报告文件已生成
    expect(report.outputPath).toContain('drift-logs');
  });

  it('spec 未修改（只读安全性）', async () => {
    const sourceFile = createSourceFile('readonly-test.ts', `
export function hello(): string {
  return 'world';
}
`);

    const oldSkeleton: CodeSkeleton = {
      filePath: sourceFile,
      language: 'typescript',
      loc: 4,
      exports: [
        { name: 'hello', kind: 'function', signature: '() => string', startLine: 2, endLine: 4, isDefault: false },
      ],
      imports: [],
      hash: '1'.repeat(64),
      analyzedAt: '2025-01-01T00:00:00.000Z',
      parserUsed: 'ts-morph',
    };

    const specPath = createSpecWithBaseline(oldSkeleton);
    const specBefore = fs.readFileSync(specPath, 'utf-8');

    await detectDrift(specPath, sourceFile, {
      skipSemantic: true,
      outputDir: path.join(tmpDir, 'drift-logs-readonly'),
    });

    const specAfter = fs.readFileSync(specPath, 'utf-8');
    // 规格文件在漂移检测后不应被修改（Constitution IV）
    expect(specAfter).toBe(specBefore);
  });
});
