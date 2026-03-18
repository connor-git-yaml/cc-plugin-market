/**
 * TreeSitterAnalyzer 单元测试
 * 覆盖多语言解析端到端、边界情况、错误处理
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TreeSitterAnalyzer } from '../../src/core/tree-sitter-analyzer.js';
import { GrammarManager } from '../../src/core/grammar-manager.js';
import { CodeSkeletonSchema } from '../../src/models/code-skeleton.js';

// 测试 fixture 路径
const FIXTURES = path.resolve('tests/fixtures/multilang');

afterAll(async () => {
  // 清理单例
  await TreeSitterAnalyzer.getInstance().dispose();
  TreeSitterAnalyzer.resetInstance();
  await GrammarManager.getInstance().dispose();
  GrammarManager.resetInstance();
});

describe('TreeSitterAnalyzer', () => {
  // ── Python 解析 ──

  describe('Python', () => {
    it('解析基本 Python 文件并生成有效 CodeSkeleton', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'python/basic.py'),
        'python',
      );

      expect(result.language).toBe('python');
      expect(result.parserUsed).toBe('tree-sitter');
      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.imports.length).toBeGreaterThan(0);

      // Zod schema 验证
      const parsed = CodeSkeletonSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      // 验证关键导出
      const funcNames = result.exports.map(e => e.name);
      expect(funcNames).toContain('greet');
      expect(funcNames).toContain('User');

      // 验证关键导入
      const importModules = result.imports.map(i => i.moduleSpecifier);
      expect(importModules).toContain('os');
    });

    it('正确处理装饰器方法', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'python/decorators.py'),
        'python',
      );

      const serviceExport = result.exports.find(e => e.name === 'Service');
      expect(serviceExport).toBeDefined();
      expect(serviceExport!.kind).toBe('class');

      // 检查成员
      if (serviceExport!.members) {
        const memberNames = serviceExport!.members.map(m => m.name);
        expect(memberNames).toContain('create');
        expect(memberNames).toContain('from_config');
        expect(memberNames).toContain('name');
        expect(memberNames).toContain('process');
      }
    });

    it('空文件返回空结果', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'python/empty.py'),
        'python',
      );

      expect(result.exports).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
      expect(result.language).toBe('python');
    });
  });

  // ── Go 解析 ──

  describe('Go', () => {
    it('解析基本 Go 文件并生成有效 CodeSkeleton', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'go/basic.go'),
        'go',
      );

      expect(result.language).toBe('go');
      expect(result.parserUsed).toBe('tree-sitter');

      const parsed = CodeSkeletonSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      // 验证导出（首字母大写）
      const funcNames = result.exports.map(e => e.name);
      expect(funcNames).toContain('NewConfig');
      expect(funcNames).toContain('Process');

      // 验证 struct
      const configExport = result.exports.find(e => e.name === 'Config');
      expect(configExport).toBeDefined();
      expect(configExport!.kind).toBe('struct');

      // 验证 interface
      const greeterExport = result.exports.find(e => e.name === 'Greeter');
      expect(greeterExport).toBeDefined();
      expect(greeterExport!.kind).toBe('interface');

      // 验证 import
      expect(result.imports.length).toBeGreaterThan(0);
    });

    it('method receiver 关联到 struct', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'go/methods.go'),
        'go',
      );

      const server = result.exports.find(e => e.name === 'Server');
      expect(server).toBeDefined();
      expect(server!.members).toBeDefined();

      const memberNames = server!.members!.map(m => m.name);
      expect(memberNames).toContain('Start');
      expect(memberNames).toContain('Stop');
    });

    it('默认排除私有符号（小写开头）', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'go/visibility.go'),
        'go',
      );

      const names = result.exports.map(e => e.name);
      expect(names).toContain('PublicFunc');
      expect(names).toContain('PublicStruct');
      expect(names).not.toContain('privateFunc');
      expect(names).not.toContain('privateStruct');
    });
  });

  // ── Java 解析 ──

  describe('Java', () => {
    it('解析基本 Java 文件并生成有效 CodeSkeleton', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'java/Basic.java'),
        'java',
      );

      expect(result.language).toBe('java');
      expect(result.parserUsed).toBe('tree-sitter');

      const parsed = CodeSkeletonSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      const names = result.exports.map(e => e.name);
      expect(names).toContain('Basic');
      expect(names).toContain('Processor');
      expect(names).toContain('Status');

      // 验证 import
      expect(result.imports.length).toBeGreaterThan(0);
    });

    it('正确识别 record 类型', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'java/Record.java'),
        'java',
      );

      const point = result.exports.find(e => e.name === 'Point');
      expect(point).toBeDefined();
      expect(point!.kind).toBe('data_class');
    });

    it('正确提取泛型参数', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'java/Generics.java'),
        'java',
      );

      const container = result.exports.find(e => e.name === 'Container');
      expect(container).toBeDefined();
      expect(container!.typeParameters).toBeDefined();
    });
  });

  // ── TypeScript 解析 ──

  describe('TypeScript', () => {
    it('解析基本 TypeScript 文件并生成有效 CodeSkeleton', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'typescript/basic.ts'),
        'typescript',
      );

      expect(result.language).toBe('typescript');
      expect(result.parserUsed).toBe('tree-sitter');

      const parsed = CodeSkeletonSchema.safeParse(result);
      expect(parsed.success).toBe(true);

      const names = result.exports.map(e => e.name);
      expect(names).toContain('greet');
      expect(names).toContain('UserService');
      expect(names).toContain('User');
      expect(names).toContain('Role');
      expect(names).toContain('MAX_RETRIES');
    });

    it('正确处理 re-export', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'typescript/reexport.ts'),
        'typescript',
      );

      expect(result.exports.length).toBeGreaterThan(0);
      expect(result.imports.length).toBe(0); // re-export 不是 import
    });
  });

  // ── 边界情况 ──

  describe('边界情况', () => {
    it('文件不存在时抛出明确错误', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      await expect(
        analyzer.analyze('/nonexistent/file.py', 'python'),
      ).rejects.toThrow('无法读取文件');
    });

    it('不支持的语言抛出错误', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      await expect(
        analyzer.analyze(path.join(FIXTURES, 'python/basic.py'), 'ruby' as any),
      ).rejects.toThrow();
    });

    it('isLanguageSupported 返回正确值', () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      expect(analyzer.isLanguageSupported('python')).toBe(true);
      expect(analyzer.isLanguageSupported('go')).toBe(true);
      expect(analyzer.isLanguageSupported('java')).toBe(true);
      expect(analyzer.isLanguageSupported('typescript')).toBe(true);
      expect(analyzer.isLanguageSupported('ruby')).toBe(false);
    });

    it('getSupportedLanguages 包含核心语言', () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const supported = analyzer.getSupportedLanguages();
      expect(supported).toContain('python');
      expect(supported).toContain('go');
      expect(supported).toContain('java');
      expect(supported).toContain('typescript');
    });

    it('getLanguageFromPath 正确推断语言', () => {
      expect(TreeSitterAnalyzer.getLanguageFromPath('foo.py')).toBe('python');
      expect(TreeSitterAnalyzer.getLanguageFromPath('foo.go')).toBe('go');
      expect(TreeSitterAnalyzer.getLanguageFromPath('Foo.java')).toBe('java');
      expect(TreeSitterAnalyzer.getLanguageFromPath('foo.ts')).toBe('typescript');
      expect(TreeSitterAnalyzer.getLanguageFromPath('foo.js')).toBe('javascript');
      expect(TreeSitterAnalyzer.getLanguageFromPath('foo.xyz')).toBe(null);
    });

    it('BOM 文件正常解析', async () => {
      // 创建含 BOM 的临时文件
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-analyzer-'));
      const bomFile = path.join(tempDir, 'bom.py');
      const bom = '\uFEFF';
      fs.writeFileSync(bomFile, `${bom}def hello():\n    pass\n`, 'utf-8');

      try {
        const analyzer = TreeSitterAnalyzer.getInstance();
        const result = await analyzer.analyze(bomFile, 'python');
        expect(result.exports.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('语法错误文件可部分解析', async () => {
      const analyzer = TreeSitterAnalyzer.getInstance();
      const result = await analyzer.analyze(
        path.join(FIXTURES, 'python/syntax-error.py'),
        'python',
      );

      // 应有部分有效导出
      expect(result.exports.some(e => e.name === 'valid_function')).toBe(true);
      // 应记录解析错误
      expect(result.parseErrors).toBeDefined();
      expect(result.parseErrors!.length).toBeGreaterThan(0);
    });
  });
});
