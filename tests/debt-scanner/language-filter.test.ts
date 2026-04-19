/**
 * 回归测试（Codex review Finding 3）：
 * scanProjectDebt 必须遵守 languages 过滤，否则会把 batch 本次不处理的语言也扫进去。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProjectDebt, describeScannedLanguages } from '../../src/debt-scanner/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-lang-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  return root;
}

function freshRegistry(): LanguageAdapterRegistry {
  // 复用仓内其它 debt 测试的 singleton reset 模式（测试隔离）
  LanguageAdapterRegistry.resetInstance();
  const r = LanguageAdapterRegistry.getInstance();
  r.register(new TsJsLanguageAdapter());
  r.register(new PythonLanguageAdapter());
  return r;
}

describe('scanProjectDebt — languages 过滤', () => {
  it('未传 languages 时扫描所有支持的语言', async () => {
    const root = fixture({
      'src/a.ts': '// TODO ts-debt\nexport const x = 1;\n',
      'src/b.py': '# TODO py-debt\nPI = 3\n',
    });
    const report = await scanProjectDebt({ projectRoot: root, registry: freshRegistry() });
    const kinds = report.codeEntries.map((e) => e.filePath).sort();
    expect(kinds.some((p) => p.endsWith('a.ts'))).toBe(true);
    expect(kinds.some((p) => p.endsWith('b.py'))).toBe(true);
  });

  it('languages=[python] 时只扫描 python 文件，排除 ts/js', async () => {
    const root = fixture({
      'src/a.ts': '// TODO should-be-excluded\nexport const x = 1;\n',
      'src/b.py': '# TODO python-only\nPI = 3\n',
    });
    const report = await scanProjectDebt({
      projectRoot: root,
      registry: freshRegistry(),
      languages: ['python'],
    });
    const paths = report.codeEntries.map((e) => e.filePath);
    expect(paths.some((p) => p.endsWith('b.py'))).toBe(true);
    expect(paths.some((p) => p.endsWith('a.ts'))).toBe(false);
  });

  it('describeScannedLanguages 返回的标签随过滤器收缩', () => {
    const reg = freshRegistry();
    expect(describeScannedLanguages(reg, undefined)).toContain('python');
    expect(describeScannedLanguages(reg, undefined)).toContain('typescript/javascript');
    expect(describeScannedLanguages(reg, ['python'])).toEqual(['python']);
    expect(describeScannedLanguages(reg, ['ts-js'])).toEqual(['typescript/javascript']);
  });

  it('languages 中含未注册 id 时静默忽略（不扫描任何文件）', async () => {
    const root = fixture({
      'src/a.ts': '// TODO\nexport const x = 1;\n',
    });
    const report = await scanProjectDebt({
      projectRoot: root,
      registry: freshRegistry(),
      languages: ['ruby-not-real'],
    });
    expect(report.codeEntries).toHaveLength(0);
  });
});
