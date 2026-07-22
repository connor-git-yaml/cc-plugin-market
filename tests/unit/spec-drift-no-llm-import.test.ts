/**
 * T019：零 LLM 导入边界（FR-013 / SC-007a）。
 *
 * 两层证据：
 *   L1 直接导入——静态读取全部 drift 源码，断言不含 provider 包字面量；
 *   L2 传递闭包——从 drift 动态 import 的四个 dist 入口出发，在 `dist/` 内递归解析
 *      `import` / `export ... from` 语句构建可达模块集，断言其中无 provider 包引用。
 *
 * 【诚实边界】L2 是**静态可达性分析**，不覆盖运行时 `eval` / 字符串拼接构造的动态 import。
 * 本仓 dist 产物无此模式，但本测试不对此做无根据的绝对声称。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DIST = path.join(REPO_ROOT, 'dist');

/** 已知 LLM provider 包（出现即视为违反零 LLM 约束） */
const PROVIDER_PACKAGES = [
  '@anthropic-ai/sdk',
  'openai',
  '@google/generative-ai',
  '@google/genai',
  '@mistralai/mistralai',
  'cohere-ai',
  'groq-sdk',
  '@aws-sdk/client-bedrock-runtime',
];

/** drift 自身源码文件集合 */
function driftSourceFiles(): string[] {
  const files = [path.join(REPO_ROOT, 'scripts/spec-drift-cli.mjs')];
  const libDir = path.join(REPO_ROOT, 'scripts/lib');
  for (const name of fs.readdirSync(libDir)) {
    if (name.startsWith('spec-drift-') && name.endsWith('.mjs')) files.push(path.join(libDir, name));
  }
  return files;
}

/** 从源码抽取全部 import / export-from 的 module specifier */
function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) specifiers.push(m[1]!);
  }
  return specifiers;
}

describe('L1 直接导入边界', () => {
  const files = driftSourceFiles();

  it('drift 源码文件集合非空（防"扫了个空集合"的假通过）', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('全部 drift 源码不含任何 LLM provider 包字面量', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pkg of PROVIDER_PACKAGES) {
        expect(source.includes(`'${pkg}'`) || source.includes(`"${pkg}"`), `${file} → ${pkg}`).toBe(false);
      }
    }
  });

  it('drift 源码只 import 白名单内的外部依赖（ts-morph + node: 内建）', () => {
    const allowedBare = new Set(['ts-morph']);
    for (const file of files) {
      for (const spec of extractSpecifiers(fs.readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        expect(allowedBare.has(spec), `${file} → ${spec}`).toBe(true);
      }
    }
  });
});

/**
 * W-2：check 链路的静态依赖边界。
 *
 * 行为测试抓不住这条回归——把 fuzzy 解析引回 check 后，"同名改函数体"场景 fuzzy 仍精确命中
 * → 结果仍是 stale，"改名"场景 fuzzy 置信度又低于自动绑定阈值 → 结果仍是 orphaned。
 * 两个既有行为断言都会继续通过。因此只能用静态依赖断言守这条不变量。
 */
describe('W-2 check 链路禁止依赖 fuzzy 解析', () => {
  const LIB = path.join(REPO_ROOT, 'scripts/lib');
  const FORBIDDEN_IDENTIFIERS = ['canonicalizeSymbolId', 'resolveSymbolFuzzy'];
  const FORBIDDEN_DIST_MODULES = ['dist/knowledge-graph/query-helpers.js'];

  /** 从 check 出发，在 scripts/lib 内递归收集可达的 drift 模块 */
  function checkClosure(): string[] {
    const seen = new Set<string>();
    const queue = [path.join(LIB, 'spec-drift-check.mjs')];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const spec of extractSpecifiers(fs.readFileSync(current, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(current), spec);
        if (fs.existsSync(resolved)) queue.push(resolved);
      }
    }
    return [...seen];
  }

  const closure = checkClosure();

  it('闭包非空且含 check 自身（防扫空集合假通过）', () => {
    expect(closure).toContain(path.join(LIB, 'spec-drift-check.mjs'));
    expect(closure.length).toBeGreaterThanOrEqual(4);
  });

  it('闭包内任何模块都不 import spec-drift-resolve.mjs', () => {
    for (const file of closure) {
      const specs = extractSpecifiers(fs.readFileSync(file, 'utf8'));
      for (const spec of specs) {
        expect(spec.includes('spec-drift-resolve'), `${file} → ${spec}`).toBe(false);
      }
    }
  });

  it('闭包内不请求 query-helpers 这个 dist 模块（fuzzy 解析的唯一来源）', () => {
    for (const file of closure) {
      const source = fs.readFileSync(file, 'utf8');
      for (const mod of FORBIDDEN_DIST_MODULES) {
        expect(source.includes(mod), `${file} → ${mod}`).toBe(false);
      }
    }
  });

  it('闭包内不出现 fuzzy 解析 API 的标识符', () => {
    for (const file of closure) {
      const source = fs.readFileSync(file, 'utf8');
      // 注释里说明"MUST NOT 调用 X"是合法的，故只在去掉注释后的正文里断言
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const name of FORBIDDEN_IDENTIFIERS) {
        expect(code.includes(name), `${file} → ${name}`).toBe(false);
      }
    }
  });

  it('对照组：resolve 链路确实使用 fuzzy API（证明上面的断言有区分力）', () => {
    const resolveSource = fs.readFileSync(path.join(LIB, 'spec-drift-resolve.mjs'), 'utf8');
    for (const name of FORBIDDEN_IDENTIFIERS) {
      expect(resolveSource.includes(name), name).toBe(true);
    }
    expect(resolveSource.includes(FORBIDDEN_DIST_MODULES[0]!)).toBe(true);
  });
});

describe('L2 dist 传递闭包（静态可达性）', () => {
  /** drift 动态 import 的四个 dist 入口（有界集合） */
  const ENTRIES = [
    'dist/core/ast-analyzer.js',
    'dist/adapters/index.js',
    'dist/knowledge-graph/query-helpers.js',
    'dist/knowledge-graph/relativize.js',
  ];

  function resolveRelative(fromFile: string, spec: string): string | null {
    const base = path.resolve(path.dirname(fromFile), spec);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  const reachable = new Set<string>();
  const bareSpecifiers = new Set<string>();

  for (const entry of ENTRIES) {
    const abs = path.join(REPO_ROOT, entry);
    if (!fs.existsSync(abs)) continue;
    const queue = [abs];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const spec of extractSpecifiers(fs.readFileSync(current, 'utf8'))) {
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('.')) {
          const resolved = resolveRelative(current, spec);
          if (resolved && resolved.startsWith(DIST)) queue.push(resolved);
          continue;
        }
        bareSpecifiers.add(spec);
      }
    }
  }

  it('四个 dist 入口均存在且可达集合非空（否则本层证明力为零）', () => {
    for (const entry of ENTRIES) {
      expect(fs.existsSync(path.join(REPO_ROOT, entry)), entry).toBe(true);
    }
    expect(reachable.size).toBeGreaterThan(ENTRIES.length);
  });

  it('可达闭包内无任何 LLM provider 包引用', () => {
    for (const pkg of PROVIDER_PACKAGES) {
      expect([...bareSpecifiers], `provider ${pkg} 出现在 dist 可达闭包`).not.toContain(pkg);
    }
  });
});
