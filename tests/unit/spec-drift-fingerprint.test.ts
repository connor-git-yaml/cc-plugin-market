/**
 * T030：`scripts/lib/spec-drift-fingerprint.mjs` 单测 —— **C3 canonical AST 语义全集**。
 *
 * 本文件替换 T010 的过渡态断言范围。核心合同（plan §7.3 / spec FR-009(b)(c) / SC-001）：
 *  - fresh 组：注释 / JSDoc / 格式化 / 语法噪声（括号、引号风格、数字与 BigInt 分隔符）
 *    MUST 产生**相同**指纹；
 *  - stale 组：标识符 / 字面值 / 控制结构 MUST 产生**不同**指纹；
 *  - C-2 + N-1 强制回归组（核心资产，逐组独立断言，不合并简化）：一元前缀 / 一元后缀 /
 *    const-vs-let / var-vs-using / using-vs-await-using —— 这五组在朴素实现下 token 序列
 *    **完全相同**（实测），是「改了代码却判 fresh」的直接漏报面；
 *  - overload 聚合：改第二个 overload 签名或改实现体 MUST 产生不同指纹。
 *
 * ⚠️ JSDoc 断言方式（W-2 实测结论）：ts-morph@24 的 `forEachDescendant` 遍历不含 JSDoc
 * （trivia），`isJsDocNode` 跳过分支是**死代码**。因此本文件断言「canonical token 序列中
 * 不含任何 JSDoc 前缀 token」，MUST NOT 断言「至少命中一次 JSDoc 跳过分支」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  FINGERPRINT_VERSION,
  NORMALIZATION_PROFILE,
  createSharedProject,
  computeSymbolFingerprint,
  canonicalizeNode,
  canonicalizeDeclarationSet,
  declarationKeyword,
  hashCanonicalSequence,
  locateExportedNodes,
  hasSyntacticErrors,
} from '../../scripts/lib/spec-drift-fingerprint.mjs';

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/spec-drift',
);

interface FingerprintOk {
  ok: true;
  fingerprint: string;
  sequence: string;
}
interface FingerprintFail {
  ok: false;
  reason: string;
  detail?: string;
}
type FingerprintResult = FingerprintOk | FingerprintFail;

/**
 * 在共享 Project 上按「源文本 + 导出名」算指纹；startLine 由本地 AST 自身给出。
 *
 * `absFilePath` 默认使用**固定虚拟路径**：生产链路（resolve / check）里同一个锚在前后两次
 * 运行中走的是**同一个 absFilePath 的 overwrite**，若测试为每对 fixture 各造一个随机目录，
 * 就绕过了「同路径覆盖」这一真实语义（W-4 测试缺口）。
 */
const SHARED_VIRTUAL_PATH = path.join(os.tmpdir(), 'drift-fp-shared', 'sample.ts');

function fingerprintOf(
  sourceText: string,
  exportName: string,
  absFilePath: string = SHARED_VIRTUAL_PATH,
): FingerprintOk {
  const project = createSharedProject();
  const sourceFile = project.createSourceFile(absFilePath, sourceText, { overwrite: true });
  const declarations = sourceFile.getExportedDeclarations().get(exportName) ?? [];
  expect(declarations.length, `fixture 未导出 ${exportName}`).toBeGreaterThan(0);
  const result = computeSymbolFingerprint({
    project,
    absFilePath,
    sourceText,
    exportName,
    expStartLine: declarations[0].getStartLineNumber(),
  }) as FingerprintResult;
  expect(result.ok, `指纹计算失败：${JSON.stringify(result)}`).toBe(true);
  return result as FingerprintOk;
}

const readFixture = (...segments: string[]) =>
  fs.readFileSync(path.join(FIXTURE_ROOT, ...segments), 'utf8');

/**
 * 一对 fixture 文件 → 两个指纹。
 *
 * W-4：两次计算 MUST 落在**同一个 `absFilePath`** 上（模拟生产中「同一文件被改写」的
 * overwrite 语义），不得分别传 `before.ts` / `after.ts` 两个不同路径。
 */
function fingerprintPair(dir: string, beforeFile: string, afterFile: string, exportName: string) {
  const project = createSharedProject();
  const compute = (sourceText: string) => {
    const sourceFile = project.createSourceFile(SHARED_VIRTUAL_PATH, sourceText, {
      overwrite: true,
    });
    const declarations = sourceFile.getExportedDeclarations().get(exportName) ?? [];
    expect(declarations.length, `fixture 未导出 ${exportName}`).toBeGreaterThan(0);
    const result = computeSymbolFingerprint({
      project,
      absFilePath: SHARED_VIRTUAL_PATH,
      sourceText,
      exportName,
      expStartLine: declarations[0].getStartLineNumber(),
    }) as FingerprintResult;
    expect(result.ok, `指纹计算失败：${JSON.stringify(result)}`).toBe(true);
    return (result as FingerprintOk).fingerprint;
  };
  return [compute(readFixture(dir, beforeFile)), compute(readFixture(dir, afterFile))] as const;
}

/** 内联源码对 → 两个指纹（同一虚拟路径 overwrite，语义同 `fingerprintPair`） */
function fingerprintSourcePair(before: string, after: string, exportName = 'foo') {
  const project = createSharedProject();
  const compute = (sourceText: string) => {
    const sourceFile = project.createSourceFile(SHARED_VIRTUAL_PATH, sourceText, {
      overwrite: true,
    });
    const declarations = sourceFile.getExportedDeclarations().get(exportName) ?? [];
    expect(declarations.length, `源码未导出 ${exportName}`).toBeGreaterThan(0);
    const result = computeSymbolFingerprint({
      project,
      absFilePath: SHARED_VIRTUAL_PATH,
      sourceText,
      exportName,
      expStartLine: declarations[0].getStartLineNumber(),
    }) as FingerprintResult;
    expect(result.ok, `指纹计算失败：${JSON.stringify(result)}`).toBe(true);
    return (result as FingerprintOk).fingerprint;
  };
  return [compute(before), compute(after)] as const;
}

describe('spec-drift-fingerprint —— C3 canonical AST 指纹', () => {
  it('版本常量：FINGERPRINT_VERSION 为 "1"，NORMALIZATION_PROFILE 已 bump 为 ts-morph-canonical-v2', () => {
    expect(FINGERPRINT_VERSION).toBe('1');
    // token 流口径从 forEachChild 改为 getChildren 后指纹值整体变化，MUST bump profile，
    // 否则旧锚会与新算法混合比较（FR-009b），把「算法换代」伪装成「代码 stale」。
    expect(NORMALIZATION_PROFILE).toBe('ts-morph-canonical-v2');
  });

  it('指纹格式为 sha256:<64 位十六进制>，且同一输入多次计算稳定一致', () => {
    const source = readFixture('fresh-comment-only', 'before.ts');
    const first = fingerprintOf(source, 'anchored').fingerprint;
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprintOf(source, 'anchored').fingerprint).toBe(first);
  });

  describe('fresh 组：注释 / JSDoc / 格式化 / 语法噪声 MUST 产生相同指纹（SC-001）', () => {
    it('fresh-comment-only：仅行内 / 块注释差异 → 相同指纹', () => {
      const [before, after] = fingerprintPair('fresh-comment-only', 'before.ts', 'after.ts', 'anchored');
      expect(after).toBe(before);
    });

    it('fresh-jsdoc-only：仅前导 JSDoc 差异 → 相同指纹', () => {
      const [before, after] = fingerprintPair('fresh-jsdoc-only', 'before.ts', 'after.ts', 'anchored');
      expect(after).toBe(before);
    });

    it('fresh-format-only：仅缩进 / 换行 / 空格差异 → 相同指纹', () => {
      const [before, after] = fingerprintPair('fresh-format-only', 'before.ts', 'after.ts', 'anchored');
      expect(after).toBe(before);
    });

    it('fresh-syntactic-noise (1/4)：`a+b` → `(a+b)` 加括号 → 相同指纹', () => {
      const [before, after] = fingerprintPair(
        'fresh-syntactic-noise',
        'paren-before.ts',
        'paren-after.ts',
        'anchored',
      );
      expect(after).toBe(before);
    });

    it('fresh-syntactic-noise (2/4)：`"x"` → `\'x\'` 引号风格 → 相同指纹', () => {
      const [before, after] = fingerprintPair(
        'fresh-syntactic-noise',
        'quote-before.ts',
        'quote-after.ts',
        'anchored',
      );
      expect(after).toBe(before);
    });

    it('fresh-syntactic-noise (3/4)：`1000` → `1_000` 数字分隔符 → 相同指纹', () => {
      const [before, after] = fingerprintPair(
        'fresh-syntactic-noise',
        'numsep-before.ts',
        'numsep-after.ts',
        'anchored',
      );
      expect(after).toBe(before);
    });

    it('fresh-syntactic-noise (4/4)：`1000n` → `1_000n` BigInt 分隔符 → 相同指纹（N-2）', () => {
      const [before, after] = fingerprintPair(
        'fresh-syntactic-noise',
        'bigint-before.ts',
        'bigint-after.ts',
        'anchored',
      );
      expect(after).toBe(before);
    });

    it('JSDoc 剥离验证（W-2 正确断言方式）：canonical token 序列中不含任何 JSDoc 前缀 token', () => {
      const withJsDoc = fingerprintOf(readFixture('fresh-jsdoc-only', 'after.ts'), 'anchored');
      expect(withJsDoc.sequence).not.toMatch(/JSDoc/);
      // 反向自证：序列本身非空且确实含结构 token（避免"空序列恰好不含 JSDoc"的假通过）
      expect(withJsDoc.sequence).toContain('FunctionDeclaration');
    });
  });

  describe('stale 组：AST 结构变化 MUST 产生不同指纹', () => {
    it('stale-identifier：参数 / 局部标识符改名 → 不同指纹', () => {
      const [before, after] = fingerprintPair('stale-identifier', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    it('stale-literal：数值字面值改变 → 不同指纹', () => {
      const [before, after] = fingerprintPair('stale-literal', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    it('stale-control-flow：`if` → `while` → 不同指纹', () => {
      const [before, after] = fingerprintPair('stale-control-flow', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });
  });

  /**
   * C-2 + N-1 强制回归组：以下五组（六对）在朴素实现下 token 序列**完全相同**，
   * 即「改了代码却判 fresh」的实测漏报面。逐组独立断言，不得合并简化。
   */
  describe('C-2 + N-1 漏报回归组（核心资产）', () => {
    it('(1) stale-unary-prefix：`return +a` vs `return -a` → 不同指纹', () => {
      const [before, after] = fingerprintPair(
        'stale-unary-prefix',
        'sign-before.ts',
        'sign-after.ts',
        'anchored',
      );
      expect(after).not.toBe(before);
    });

    it('(2) stale-unary-prefix：`return ++a` vs `return --a` → 不同指纹', () => {
      const [before, after] = fingerprintPair(
        'stale-unary-prefix',
        'incdec-before.ts',
        'incdec-after.ts',
        'anchored',
      );
      expect(after).not.toBe(before);
    });

    it('(3) stale-unary-postfix：`return a++` vs `return a--` → 不同指纹', () => {
      const [before, after] = fingerprintPair('stale-unary-postfix', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    it('(4) stale-decl-kind：`export const foo=1` vs `export let foo=1` → 不同指纹', () => {
      const [before, after] = fingerprintPair('stale-decl-kind', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    it('(5) stale-using-vs-var：`var x=a()` vs `using x=a()` → 不同指纹（N-1，资源释放语义变化）', () => {
      const [before, after] = fingerprintPair('stale-using-vs-var', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    it('(6) stale-await-using：`using x=a()` vs `await using x=a()` → 不同指纹（N-1）', () => {
      const [before, after] = fingerprintPair('stale-await-using', 'before.ts', 'after.ts', 'anchored');
      expect(after).not.toBe(before);
    });

    /**
     * `NodeFlags.AwaitUsing === 6 === Using(4) | Const(2)`，位有重叠。
     * 判定顺序 MUST 为 AwaitUsing → Using → Const → Let → var，
     * 且 AwaitUsing MUST 用全等比较，否则普通 const(2 & 6 = 2，truthy) 会被误判成 await using。
     */
    it('declarationKeyword：实测 flags 逐值映射正确（位重叠陷阱直测）', () => {
      expect(declarationKeyword(0)).toBe('var');
      expect(declarationKeyword(1)).toBe('let');
      expect(declarationKeyword(2)).toBe('const');
      expect(declarationKeyword(4)).toBe('using');
      expect(declarationKeyword(65542)).toBe('await using');
      // 若 AwaitUsing 用真值判断而非全等，下面这条会退化成 'await using'
      expect(declarationKeyword(2)).not.toBe('await using');
    });
  });

  /**
   * C3 审查 CRITICAL 回归组：以下六组在「`forEachDescendant` + 逐个补洞」实现下指纹
   * **完全相同**（已实证）。根因是 `forEachChild` **不枚举 token 子节点**，所有关键字 /
   * 修饰符对指纹隐形。修复方式是改用 `getChildren()` 完整 token 流 + 父级 metadata，
   * 而非继续给一个开口的洞集补洞。逐组独立断言，不得合并简化。
   */
  describe('C3 审查 CRITICAL 同哈希漏报回归组（token 流缺失面）', () => {
    it('(1) `extends Bar` vs `implements Bar` → 不同指纹（继承 vs 契约，运行时原型链不同）', () => {
      const [before, after] = fingerprintSourcePair(
        'class Bar{}\nexport class foo extends Bar{}\n',
        'interface Bar{}\nexport class foo implements Bar{}\n',
      );
      expect(after).not.toBe(before);
    });

    it('(2) `keyof string[]` vs `readonly string[]` → 不同指纹（类型完全不同）', () => {
      const [before, after] = fingerprintSourcePair(
        'export type foo = keyof string[]\n',
        'export type foo = readonly string[]\n',
      );
      expect(after).not.toBe(before);
    });

    it('(3) `import("./dep").Bar` vs `typeof import("./dep").Bar` → 不同指纹', () => {
      const [before, after] = fingerprintSourcePair(
        'export type foo = import("./dep").Bar\n',
        'export type foo = typeof import("./dep").Bar\n',
      );
      expect(after).not.toBe(before);
    });

    it('(4) `export declare let foo` vs `export let foo` → 不同指纹（前者编译成 `export {}`，运行时无此导出）', () => {
      const [before, after] = fingerprintSourcePair(
        'export declare let foo: number\n',
        'export let foo: number\n',
      );
      expect(after).not.toBe(before);
    });

    it('(5) `export { foo }` vs `export type { foo }` → 不同指纹（后者彻底擦除运行时导出，最严重）', () => {
      const [before, after] = fingerprintSourcePair(
        'class foo{}\nexport { foo }\n',
        'class foo{}\nexport type { foo }\n',
      );
      expect(after).not.toBe(before);
    });

    it('(6) tagged template `` tag`A` `` vs `` tag`\\x41` `` → 不同指纹（strings.raw 运行时不同）', () => {
      const [before, after] = fingerprintSourcePair(
        'const tag=(s:TemplateStringsArray)=>s.raw[0];\nexport const foo = tag`A`\n',
        'const tag=(s:TemplateStringsArray)=>s.raw[0];\nexport const foo = tag`\\x41`\n',
      );
      expect(after).not.toBe(before);
    });

    it('export alias：`export { foo as bar }` 的 local 名改变 → 不同指纹', () => {
      const [before, after] = fingerprintSourcePair(
        'class a{}\nclass b{}\nexport { a as bar }\n',
        'class a{}\nclass b{}\nexport { b as bar }\n',
        'bar',
      );
      expect(after).not.toBe(before);
    });
  });

  /**
   * W-1：改用完整 token 流 / raw 文本会引入**新的误报面**，以下两组语义等价 MUST 保持同指纹。
   */
  describe('W-1 新误报面回归组（等价书写 MUST 同指纹）', () => {
    it('普通（未 tagged）模板：`` `A${x}` `` vs `` `\\x41${x}` `` → 相同指纹（只有 cooked 值可观测）', () => {
      const [before, after] = fingerprintSourcePair(
        'declare const x: string;\nexport const foo = `A${x}`\n',
        'declare const x: string;\nexport const foo = `\\x41${x}`\n',
      );
      expect(after).toBe(before);
    });

    it('正则 flag 顺序：`/a/gi` vs `/a/ig` → 相同指纹（flags 规范排序）', () => {
      const [before, after] = fingerprintSourcePair(
        'export const foo = /a/gi\n',
        'export const foo = /a/ig\n',
      );
      expect(after).toBe(before);
    });

    it('正则 pattern 本身改变 → 不同指纹（反向自证：flags 排序未把 pattern 一起抹平）', () => {
      const [before, after] = fingerprintSourcePair(
        'export const foo = /a/gi\n',
        'export const foo = /b/gi\n',
      );
      expect(after).not.toBe(before);
    });

    it('正则 flag 集合改变 → 不同指纹（`/a/g` vs `/a/gi`）', () => {
      const [before, after] = fingerprintSourcePair(
        'export const foo = /a/g\n',
        'export const foo = /a/gi\n',
      );
      expect(after).not.toBe(before);
    });
  });

  /**
   * 标点 token 剔除是保持「可选分号 / 尾随逗号」免疫的前提，但它**自带一个盲区**：
   * ForStatement 的三个子句靠分号定位，全省略时 token 流塌陷（实测 `for(;;a++)` 与
   * `for(;a++;)` 完全相同）。该盲区由 `forClauses:` 位标记封死。
   */
  describe('标点剔除引入的盲区封堵', () => {
    it('`for(;;a++)` vs `for(;a++;)` → 不同指纹（子句位置语义完全不同）', () => {
      const [before, after] = fingerprintSourcePair(
        'export function foo(){ let a=0; for(;;a++){} }\n',
        'export function foo(){ let a=0; for(;a++;){} }\n',
      );
      expect(after).not.toBe(before);
    });

    it('可选分号 / 尾随逗号仍免疫（证明剔除规则本身没被推翻）', () => {
      const [semiBefore, semiAfter] = fingerprintSourcePair(
        'export function foo(){ return 1 }\n',
        'export function foo(){ return 1; }\n',
      );
      expect(semiAfter).toBe(semiBefore);
      const [commaBefore, commaAfter] = fingerprintSourcePair(
        'export const foo = [1,2]\n',
        'export const foo = [1,2,]\n',
      );
      expect(commaAfter).toBe(commaBefore);
    });
  });

  describe('SC-002 隔离性：sibling 改动 MUST NOT 影响本 symbol', () => {
    it('同一 VariableStatement 内的 sibling declaration 改动 → 相同指纹（stmtMod 只取 statement 修饰符）', () => {
      const [before, after] = fingerprintSourcePair(
        'export const foo=1, bar=2;\n',
        'export const foo=1, bar=999;\n',
      );
      expect(after).toBe(before);
    });
  });

  describe('W-3：深嵌套 AST MUST 返回结构化失败，MUST NOT 抛异常逃出合同', () => {
    it('5000 层 property access → computeSymbolFingerprint 返回 {ok:false}，不抛 RangeError', () => {
      const project = createSharedProject();
      const deep = `declare const a: any;\nexport const foo = a${'.b'.repeat(5000)};\n`;
      const abs = path.join(os.tmpdir(), 'drift-deep', 'deep.ts');
      let result: FingerprintResult | undefined;
      expect(() => {
        result = computeSymbolFingerprint({
          project,
          absFilePath: abs,
          sourceText: deep,
          exportName: 'foo',
          expStartLine: 2,
        }) as FingerprintResult;
      }).not.toThrow();
      expect(result).toBeDefined();
      expect(result?.ok).toBe(false);
      // 分类 MUST 是「遍历超限」而非泛化的 node-locate-failed（后者语义是"导出不存在"）
      expect((result as FingerprintFail).reason).toBe('ast-traversal-limit');
    });

    it('中等深度（200 层）仍能正常算出指纹，且深度变化会改变指纹（反向自证非一律降级）', () => {
      const mk = (n: number) => `declare const a: any;\nexport const foo = a${'.b'.repeat(n)};\n`;
      const [before, after] = fingerprintSourcePair(mk(200), mk(201));
      expect(before).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(after).not.toBe(before);
    });
  });

  describe('overload 聚合（防「只取 declarations[0]」漏报）', () => {
    it('stale-overload-second：改**第二个** overload 签名 → 不同指纹', () => {
      const [before, after] = fingerprintPair(
        'stale-overload-second',
        'before.ts',
        'after-signature.ts',
        'anchored',
      );
      expect(after).not.toBe(before);
    });

    it('stale-overload-second：改实现体（第一个签名不变）→ 不同指纹', () => {
      const [before, after] = fingerprintPair(
        'stale-overload-second',
        'before.ts',
        'after-implementation.ts',
        'anchored',
      );
      expect(after).not.toBe(before);
    });

    it('canonicalizeDeclarationSet：全部声明按 startLine 升序聚合，且含实现体 token', () => {
      const project = createSharedProject();
      const source = readFixture('stale-overload-second', 'before.ts');
      const abs = path.join(os.tmpdir(), 'drift-overload', 'ov.ts');
      const sourceFile = project.createSourceFile(abs, source, { overwrite: true });
      const located = locateExportedNodes(sourceFile, 'anchored', 1) as
        | { ok: true; nodes: ReturnType<typeof sourceFile.getFunctions> }
        | { ok: false; reason: string };
      expect(located.ok).toBe(true);
      if (!located.ok) return;
      // 三个声明（两个 signature + 一个实现）全部参与序列化
      expect(located.nodes.length).toBe(3);
      const sequence = canonicalizeDeclarationSet(located.nodes) as string;
      expect(sequence.split('#').length).toBe(3);
      expect(sequence).toContain('ReturnStatement'); // 实现体确实在序列内
    });
  });

  describe('locateExportedNodes 三态（C-3：禁止 declarations[0] 静默兜底）', () => {
    const project = createSharedProject();
    const makeFile = (name: string, content: string) =>
      project.createSourceFile(path.join(os.tmpdir(), 'drift-locate', name), content, {
        overwrite: true,
      });

    it('导出名不存在 → node-locate-failed', () => {
      const sourceFile = makeFile('a.ts', 'export function present(): number { return 1; }\n');
      expect(locateExportedNodes(sourceFile, 'absent', 1)).toEqual({
        ok: false,
        reason: 'node-locate-failed',
      });
    });

    it('startLine 与 analyzeFiles 不对齐（身份分叉）→ node-locate-ambiguous，绝不猜', () => {
      const sourceFile = makeFile('b.ts', 'export function present(): number { return 1; }\n');
      expect(locateExportedNodes(sourceFile, 'present', 99)).toEqual({
        ok: false,
        reason: 'node-locate-ambiguous',
      });
    });

    it('声明全部来自其他文件（re-export）→ reexport-unsupported', () => {
      const indexPath = path.join(FIXTURE_ROOT, 'reexport-unsupported', 'index.ts');
      const localProject = createSharedProject();
      const sourceFile = localProject.createSourceFile(
        indexPath,
        fs.readFileSync(indexPath, 'utf8'),
        { overwrite: true },
      );
      expect(locateExportedNodes(sourceFile, 'reexportedSymbol', 2)).toEqual({
        ok: false,
        reason: 'reexport-unsupported',
      });
    });

    it('三元组全部对齐 → ok', () => {
      const sourceFile = makeFile('c.ts', 'export function present(): number { return 1; }\n');
      const located = locateExportedNodes(sourceFile, 'present', 1) as { ok: boolean };
      expect(located.ok).toBe(true);
    });
  });

  describe('canonicalizeNode / hashCanonicalSequence 基本性质', () => {
    it('同文件他 symbol 改动不影响本 symbol 序列（SC-002 的算法层前提）', () => {
      const base = 'export function anchored(): number { return 1; }\nexport function sibling(): number { return 2; }\n';
      const changed = 'export function anchored(): number { return 1; }\nexport function sibling(): number { return 999; }\n';
      expect(fingerprintOf(changed, 'anchored').fingerprint).toBe(
        fingerprintOf(base, 'anchored').fingerprint,
      );
    });

    it('canonicalizeNode 产出 `|` 分隔的 token 串，hashCanonicalSequence 为纯函数', () => {
      const project = createSharedProject();
      const sourceFile = project.createSourceFile(
        path.join(os.tmpdir(), 'drift-canon', 'd.ts'),
        'export const anchored = 1;\n',
        { overwrite: true },
      );
      const node = (sourceFile.getExportedDeclarations().get('anchored') ?? [])[0];
      const sequence = canonicalizeNode(node) as string;
      expect(sequence).toContain('|');
      expect(sequence).toContain('declKind:const');
      expect(hashCanonicalSequence(sequence)).toBe(hashCanonicalSequence(sequence));
      expect(hashCanonicalSequence(sequence)).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe('hasSyntacticErrors（供 check 侧 parser-health 判定，plan §9.1 步骤 4）', () => {
    const withTmpFile = (name: string, content: string, fn: (abs: string) => void) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-fp-'));
      const abs = path.join(dir, name);
      fs.writeFileSync(abs, content, 'utf8');
      try {
        fn(abs);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    it('语法完好的文件 → hasErrors 为 false', () => {
      withTmpFile('ok.ts', 'export const foo = 1;\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: false });
      });
    });

    it('语法错误的文件 → hasErrors 为 true（ts-morph 错误恢复不抛异常，必须靠语法诊断判定）', () => {
      withTmpFile('bad.ts', 'export const foo = ;\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: true });
      });
    });

    it('纯类型错误（语法完好）→ hasErrors 为 false（MUST NOT 用 getPreEmitDiagnostics 误判）', () => {
      withTmpFile('typeerr.ts', 'export const foo: number = "not a number";\n', (abs) => {
        const project = createSharedProject();
        expect(hasSyntacticErrors(project, abs)).toEqual({ ok: true, hasErrors: false });
      });
    });
  });
});
