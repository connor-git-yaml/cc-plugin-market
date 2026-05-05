/**
 * Feature 150 — extractor-helpers 单元测试
 *
 * 覆盖 4 个公开 helper：
 *   - loadTreeSitterGrammar(language)：加载 ts/go/java grammar 并返回 Parser
 *   - walkSourceFiles(root, ext, ignore)：递归遍历过滤
 *   - createWarningsArray()：typed warnings 容器 + push helper
 *   - buildMetadataHeader(input)：fixture 元数据头标准化
 *
 * 测试设计：
 *   - 每 case 独立 / fast（无 baseline workspace 依赖）
 *   - 用 inline source string + tmpdir，绝不污染共享状态
 */

import { describe, expect, it, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  SUPPORTED_LANGUAGES,
  loadTreeSitterGrammar,
  walkSourceFiles,
  createWarningsArray,
  buildMetadataHeader,
  _resetHelpersForTests,
} from '../../../scripts/lib/extractor-helpers.mjs';

// ── 测试辅助：临时目录管理 ──

const tmpDirsToClean: string[] = [];

afterEach(() => {
  for (const dir of tmpDirsToClean) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
  tmpDirsToClean.length = 0;
});

function makeTempDir(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  tmpDirsToClean.push(tmp);
  return tmp;
}

// ── loadTreeSitterGrammar ──

describe('loadTreeSitterGrammar', () => {
  it('支持的语言列表恰好是 ts/go/java', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['ts', 'go', 'java']);
  });

  // 注：tree-sitter Parser.init 是一次性 emscripten 初始化，不在 it 之间 reset
  // 多个 it 共享同一 init Promise + grammar 缓存（这是 helper 的设计语义，不是 leak）

  it('为 ts 语言加载 grammar 并返回可用的 Parser 实例', async () => {
    const { parser } = await loadTreeSitterGrammar('ts');
    expect(parser).toBeDefined();
    expect(typeof parser.parse).toBe('function');

    // 实际跑一次 parse 验证 grammar 已正确装载
    const tree = parser.parse('const x: number = 1;');
    expect(tree).toBeDefined();
    expect(tree.rootNode.type).toBe('program');
  });

  it('为 go 语言加载 grammar', async () => {
    const { parser } = await loadTreeSitterGrammar('go');
    const tree = parser.parse('package main\nfunc Foo() {}\n');
    expect(tree.rootNode.type).toBe('source_file');
  });

  it('为 java 语言加载 grammar', async () => {
    const { parser } = await loadTreeSitterGrammar('java');
    const tree = parser.parse('class A { void f() {} }');
    expect(tree.rootNode.type).toBe('program');
  });

  it('对不支持的 language 抛错并列出支持列表', async () => {
    await expect(loadTreeSitterGrammar('python' as 'ts')).rejects.toThrow(
      /不支持的 language="python"/,
    );
  });

  it('调用 _resetHelpersForTests 后能重新加载 grammar', async () => {
    _resetHelpersForTests();
    const { parser } = await loadTreeSitterGrammar('ts');
    const tree = parser.parse('const y = 2;');
    expect(tree.rootNode.type).toBe('program');
  });
});

// ── walkSourceFiles ──

describe('walkSourceFiles', () => {
  it('递归遍历目录并按扩展名过滤', () => {
    const tmp = makeTempDir('walk-basic');
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a=1;');
    fs.writeFileSync(path.join(tmp, 'b.tsx'), 'export const B=()=>null;');
    fs.writeFileSync(path.join(tmp, 'c.go'), 'package main');
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'd.ts'), '');

    const result = walkSourceFiles(tmp, ['.ts', '.tsx']);
    const basenames = result.map((p) => path.basename(p)).sort();
    expect(basenames).toEqual(['a.ts', 'b.tsx', 'd.ts']);
  });

  it('跳过默认 ignore 目录（node_modules / .git 等）', () => {
    const tmp = makeTempDir('walk-ignore');
    fs.writeFileSync(path.join(tmp, 'top.ts'), '');
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(path.join(tmp, 'node_modules', 'inside.ts'), '');
    fs.mkdirSync(path.join(tmp, '.git'));
    fs.writeFileSync(path.join(tmp, '.git', 'config.ts'), '');
    fs.mkdirSync(path.join(tmp, 'vendor'));
    fs.writeFileSync(path.join(tmp, 'vendor', 'lib.go'), '');

    const result = walkSourceFiles(tmp, ['.ts', '.go']);
    const basenames = result.map((p) => path.basename(p)).sort();
    expect(basenames).toEqual(['top.ts']);
  });

  it('支持自定义 ignoreDirs（覆盖默认）', () => {
    const tmp = makeTempDir('walk-custom-ignore');
    fs.writeFileSync(path.join(tmp, 'a.ts'), '');
    fs.mkdirSync(path.join(tmp, 'custom'));
    fs.writeFileSync(path.join(tmp, 'custom', 'b.ts'), '');
    // 默认 ignore（如 node_modules）此时应被允许，因为用户自定义只 ignore 'custom'
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(path.join(tmp, 'node_modules', 'c.ts'), '');

    const result = walkSourceFiles(tmp, ['.ts'], ['custom']);
    const basenames = result.map((p) => path.basename(p)).sort();
    expect(basenames).toEqual(['a.ts', 'c.ts']);
  });

  it('不存在的 root 抛错', () => {
    expect(() => walkSourceFiles('/non-existent-path-12345', ['.ts'])).toThrow(
      /不存在/,
    );
  });

  it('空 extensions 数组抛错', () => {
    const tmp = makeTempDir('walk-empty-ext');
    expect(() => walkSourceFiles(tmp, [])).toThrow(/extensions 必须为非空数组/);
  });

  it('root 非字符串抛错', () => {
    expect(() => walkSourceFiles('', ['.ts'])).toThrow(
      /root 必须为非空字符串/,
    );
  });
});

// ── createWarningsArray ──

describe('createWarningsArray', () => {
  it('append 后 items 包含追加的 warning', () => {
    const w = createWarningsArray();
    expect(w.items).toEqual([]);

    w.append({ file: '/a/b.ts', code: 'parse-error' });
    expect(w.items).toEqual([{ file: '/a/b.ts', code: 'parse-error' }]);
  });

  it('携带 line / message 的完整 warning 正确写入', () => {
    const w = createWarningsArray();
    w.append({
      file: '/x/y.go',
      line: 42,
      code: 'unresolved-dynamic',
      message: 'reflect.ValueOf called',
    });
    expect(w.items[0]).toEqual({
      file: '/x/y.go',
      line: 42,
      code: 'unresolved-dynamic',
      message: 'reflect.ValueOf called',
    });
  });

  it('多次 append 累积', () => {
    const w = createWarningsArray();
    w.append({ file: 'a', code: 'parse-error' });
    w.append({ file: 'b', code: 'unresolved-reflection' });
    w.append({ file: 'c', code: 'unresolved-dynamic' });
    expect(w.items.length).toBe(3);
    expect(w.items.map((x) => x.code)).toEqual([
      'parse-error',
      'unresolved-reflection',
      'unresolved-dynamic',
    ]);
  });

  it('append 校验 file / code 必填', () => {
    const w = createWarningsArray();
    expect(() => w.append({ file: '', code: 'parse-error' })).toThrow(
      /warning.file 必须为非空字符串/,
    );
    expect(() => w.append({ file: '/x', code: '' })).toThrow(
      /warning.code 必须为非空字符串/,
    );
    expect(() =>
      w.append(null as unknown as { file: string; code: string }),
    ).toThrow(/warning 必须为对象/);
  });
});

// ── buildMetadataHeader ──

describe('buildMetadataHeader', () => {
  it('完整 input 输出含 language + baseline.repo/commit/scope/generatedAt/extractorVersion', () => {
    const generatedAt = '2026-01-01T00:00:00.000Z';
    const out = buildMetadataHeader({
      language: 'java',
      baseline: {
        repo: 'brettwooldridge/HikariCP',
        commit: 'abc123',
        scope: 'src/main',
      },
      generatedAt,
      extractorVersion: '1.0.0',
    });
    expect(out).toEqual({
      language: 'java',
      baseline: {
        repo: 'brettwooldridge/HikariCP',
        commit: 'abc123',
        scope: 'src/main',
        generatedAt,
        extractorVersion: '1.0.0',
      },
    });
  });

  it('省略 generatedAt 时自动取当前 ISO 时间戳', () => {
    const before = new Date().toISOString();
    const out = buildMetadataHeader({
      language: 'go',
      baseline: { scope: 'gorm.io/gorm 顶层包' },
      extractorVersion: '0.1.0',
    });
    const after = new Date().toISOString();
    expect(out.baseline.scope).toBe('gorm.io/gorm 顶层包');
    expect(out.baseline.generatedAt >= before).toBe(true);
    expect(out.baseline.generatedAt <= after).toBe(true);
    // 没传 repo / commit → 不写入 key
    expect('repo' in out.baseline).toBe(false);
    expect('commit' in out.baseline).toBe(false);
  });

  it('language / scope / extractorVersion 缺失或非法时抛错', () => {
    expect(() =>
      buildMetadataHeader({
        language: '',
        baseline: { scope: 'x' },
        extractorVersion: '1.0',
      }),
    ).toThrow(/language 必须为非空字符串/);

    expect(() =>
      buildMetadataHeader({
        language: 'ts',
        baseline: { scope: '' },
        extractorVersion: '1.0',
      }),
    ).toThrow(/baseline.scope 必须为非空字符串/);

    expect(() =>
      buildMetadataHeader({
        language: 'ts',
        baseline: { scope: 'x' },
        extractorVersion: '',
      }),
    ).toThrow(/extractorVersion 必须为非空字符串/);

    expect(() =>
      buildMetadataHeader(
        null as unknown as Parameters<typeof buildMetadataHeader>[0],
      ),
    ).toThrow(/input 必须为对象/);

    expect(() =>
      buildMetadataHeader({
        language: 'ts',
        baseline: null as unknown as { scope: string },
        extractorVersion: '1.0',
      }),
    ).toThrow(/baseline 必须为对象/);
  });
});
