/**
 * F249 T003：采集面单一事实源（`src/collector-surface.ts`）三重 oracle 单测。
 *
 * 三重 oracle 的分工（plan.md R4 防守项 1/3、SC-005、SC-015）：
 * - **(a1) 运行时引用同一性**：有公开 seam 的落点（#3 java/go adapter、#7 ts-js adapter、
 *   #4 `DIRTY_SOURCE_SURFACES` re-export）用 `===` 断言消费方持有的就是 SSoT 的那一个对象，
 *   而非"值恰好相等的另一份字面量"。
 * - **(a2) ts-morph AST oracle**：无公开 seam 的落点（#1/#2 私有 walk 判定、#4 内部谓词、
 *   #5/#6 模块内常量、#8 函数内局部变量）断言两件事——① 该文件确实 import 了 SSoT；
 *   ② 该文件内**不存在**任何等于 SSoT 声明扩展名的字符串字面量（即字面量没有被重新声明一遍）。
 * - **(b) 行为探针**：在临时目录放置全扩展名 + 大小写变体样本，实跑各管线真实入口函数，
 *   断言采集/分派结果与 SSoT 声明面精确一致——抓住"引用与 AST 校验都过、但运行时行为
 *   未对齐"的假绿（例如某处仍自行 `toLowerCase()` 把 case-sensitive 面静默放宽）。
 *
 * SC-015 另有独立段落：用 ts-morph 静态解析 `collector-surface.ts` 自身的模块说明符
 * （顶层 `import` / `export…from` / `require()` / 动态 `import()` 四种语法形态），
 * 断言其 ⊆ Node `builtinModules`（裸名与 `node:` 前缀双形态）。该 oracle 自身附带
 * 自检用例（对合成源码验证四种形态都能被提取），避免"提取器什么都没找到所以恒绿"。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import { Project, SyntaxKind, type SourceFile } from 'ts-morph';

import {
  ALL_PRODUCER_SURFACES,
  DIRTY_SOURCE_SURFACES,
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PY_WALK_SURFACE,
  PYTHON_SYMBOL_SCAN_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
  mergeSurfaces,
  surfaceHasExtension,
  surfaceMatchesFile,
  type CollectorPipelineSurface,
} from '../../src/collector-surface.js';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';
import { GoLanguageAdapter } from '../../src/adapters/go-adapter.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { walkPyFiles, walkTsJsFiles } from '../../src/batch/stages/source-discovery.js';
import { createIgnoreOracle } from '../../src/panoramic/graph/quality/ignore-oracle.js';
import { scanSourceFiles } from '../../src/panoramic/cache/cache-key-builder.js';
import { buildModuleGraphForProject } from '../../src/knowledge-graph/module-derivation.js';
import { collectGenericLanguageCodeSkeletons } from '../../src/batch/generic-language-skeleton-collector.js';

const REPO_ROOT = process.cwd();

/** SSoT 声明的全部扩展名并集（a2 oracle 的"禁止本地重声明"清单）。 */
const ALL_DECLARED_EXTENSIONS: ReadonlySet<string> = new Set(
  ALL_PRODUCER_SURFACES.flatMap((surface) => [...surface.extensions]),
);

/** 提取扩展名（含前导点，保留原始大小写）；与各生产者的判定口径一致。 */
function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx < 0 ? '' : fileName.slice(idx);
}

// ============================================================
// (a1) 运行时引用同一性（`===`）——有公开 seam 的落点
// ============================================================

describe('SC-005 (a1)：消费方持有 SSoT 的同一个运行时引用', () => {
  it('#4 `DIRTY_SOURCE_SURFACES` 是 `ALL_PRODUCER_SURFACES` 的直接 re-export（同一数组对象）', () => {
    expect(DIRTY_SOURCE_SURFACES).toBe(ALL_PRODUCER_SURFACES);
  });

  it('#3 java：`new JavaLanguageAdapter().extensions === JAVA_ADAPTER_SURFACE.extensions`', () => {
    expect(new JavaLanguageAdapter().extensions).toBe(JAVA_ADAPTER_SURFACE.extensions);
  });

  it('#3 go：`new GoLanguageAdapter().extensions === GO_ADAPTER_SURFACE.extensions`', () => {
    expect(new GoLanguageAdapter().extensions).toBe(GO_ADAPTER_SURFACE.extensions);
  });

  it('#7 ts-js：`new TsJsLanguageAdapter().extensions === MODULE_DERIVATION_SCAN_SURFACE.extensions`', () => {
    expect(new TsJsLanguageAdapter().extensions).toBe(MODULE_DERIVATION_SCAN_SURFACE.extensions);
  });

  // F250：python adapter 的**声明面**引用 PY_WALK_SURFACE（`.py`+`.pyi`），其**扫描面**
  // PYTHON_SYMBOL_SCAN_SURFACE 自 F250 起扩集为同一扩展名集合——W-002 登记的两面失配已消除
  // （管线 parity 修复）。但两者仍是**两个独立常量**：分列保留各自的管线身份与指纹 key 的独立
  // 稳定性，使未来任一管线单独变化时能被独立感知。此处同时钉死"声明面引用 SSoT"与"两面集合
  // 一致但引用不同"，防止有人"顺手合并成一个常量"而丢失管线可辨识性。
  it('#11 python：`new PythonLanguageAdapter().extensions === PY_WALK_SURFACE.extensions`（声明面）', () => {
    expect(new PythonLanguageAdapter().extensions).toBe(PY_WALK_SURFACE.extensions);
  });

  it('#11 python 扫描面 PYTHON_SYMBOL_SCAN_SURFACE 含 `.py`+`.pyi`，与声明面集合一致但仍是独立引用', () => {
    // FR-006：硬编码期望值，不由被测常量自身反向推导——常量被改回 `['.py']` 时本行必红
    expect([...PYTHON_SYMBOL_SCAN_SURFACE.extensions].sort()).toEqual(['.py', '.pyi']);
    expect(PYTHON_SYMBOL_SCAN_SURFACE.matchSemantics).toBe('case-sensitive');
    expect([...PY_WALK_SURFACE.extensions].sort()).toEqual(['.py', '.pyi']);
    // 集合一致 ≠ 同一对象：两条管线仍分列，指纹按各自 key 独立追踪
    expect(PYTHON_SYMBOL_SCAN_SURFACE.extensions).not.toBe(PY_WALK_SURFACE.extensions);
  });

  it('`ALL_PRODUCER_SURFACES` 六条目均为对应管线常量本体（顺序固定，供下游确定性遍历）', () => {
    expect(ALL_PRODUCER_SURFACES).toEqual([
      TSJS_SKELETON_WALK_SURFACE,
      PY_WALK_SURFACE,
      JAVA_ADAPTER_SURFACE,
      GO_ADAPTER_SURFACE,
      MODULE_DERIVATION_SCAN_SURFACE,
      PYTHON_SYMBOL_SCAN_SURFACE,
    ]);
    expect(ALL_PRODUCER_SURFACES[0]).toBe(TSJS_SKELETON_WALK_SURFACE);
    expect(ALL_PRODUCER_SURFACES[4]).toBe(MODULE_DERIVATION_SCAN_SURFACE);
    expect(ALL_PRODUCER_SURFACES[5]).toBe(PYTHON_SYMBOL_SCAN_SURFACE);
  });
});

// ============================================================
// AST oracle 基础设施（a2 与 SC-015 共用）
// ============================================================

/** 解析真实源文件（不加载 tsconfig，避免把整仓库拖进 Project）。 */
function parseRepoFile(relativePath: string): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true },
  });
  return project.addSourceFileAtPath(path.join(REPO_ROOT, relativePath));
}

/**
 * 提取一个源文件的全部模块说明符，覆盖四种语法形态：
 * 顶层 `import ... from 'x'` / `export ... from 'x'` / `require('x')` / 动态 `import('x')`。
 *
 * 不用正则（W-07/P14）：正则在字符串字面量与注释里会误命中，ts-morph 是本仓库既有依赖。
 */
function collectModuleSpecifiers(sourceFile: SourceFile): string[] {
  const specifiers: string[] = [];

  for (const decl of sourceFile.getImportDeclarations()) {
    specifiers.push(decl.getModuleSpecifierValue());
  }
  for (const decl of sourceFile.getExportDeclarations()) {
    const value = decl.getModuleSpecifierValue();
    if (value !== undefined) specifiers.push(value);
  }
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isRequire =
      callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'require';
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamicImport) continue;
    const firstArg = call.getArguments()[0];
    if (!firstArg) continue;
    if (
      firstArg.getKind() === SyntaxKind.StringLiteral ||
      firstArg.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      specifiers.push((firstArg as unknown as { getLiteralValue(): string }).getLiteralValue());
    }
  }

  return specifiers;
}

/** 源文件内出现的全部字符串字面量值（含无插值模板字面量）。 */
function collectStringLiteralValues(sourceFile: SourceFile): string[] {
  const values: string[] = [];
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    values.push(node.getLiteralValue());
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    values.push(node.getLiteralValue());
  }
  return values;
}

// ============================================================
// (a2) AST oracle：import 边界 + 无本地扩展名字面量重声明
// ============================================================

/**
 * 无公开运行时 seam 的六个消费落点。
 *
 * `ts-js-adapter.ts`（#7）**不在**本清单：该文件为 ScriptKind 分派另有 `'.tsx'`/`'.js'`
 * 等合法字面量（与采集面无关），其收敛由上方 (a1) 的 `===` 断言覆盖，更强也更精确。
 */
const AST_ORACLE_TARGETS: readonly { readonly point: string; readonly file: string }[] = [
  { point: '#1/#2 walkTsJsFiles / walkPyFiles', file: 'src/batch/stages/source-discovery.ts' },
  { point: '#4 source-commit 内部 dirty 谓词', file: 'src/panoramic/graph/source-commit.ts' },
  { point: '#5 ignore-oracle 扩展名分派', file: 'src/panoramic/graph/quality/ignore-oracle.ts' },
  { point: '#6 cache-key-builder INCLUDED_EXTENSIONS', file: 'src/panoramic/cache/cache-key-builder.ts' },
  { point: '#8 module-derivation registry fallback', file: 'src/knowledge-graph/module-derivation.ts' },
];

describe('SC-005 (a2)：AST oracle——消费点 import SSoT 且无本地扩展名字面量重声明', () => {
  for (const target of AST_ORACLE_TARGETS) {
    it(`${target.point}（${target.file}）import 了 collector-surface`, () => {
      const sourceFile = parseRepoFile(target.file);
      const specifiers = collectModuleSpecifiers(sourceFile);
      expect(specifiers.some((s) => s.endsWith('collector-surface.js'))).toBe(true);
    });

    it(`${target.point}（${target.file}）不含任何 SSoT 已声明扩展名的字面量`, () => {
      const sourceFile = parseRepoFile(target.file);
      const redeclared = collectStringLiteralValues(sourceFile).filter((value) =>
        ALL_DECLARED_EXTENSIONS.has(value),
      );
      expect(redeclared).toEqual([]);
    });
  }
});

// ============================================================
// SC-015：collector-surface.ts 零依赖叶子模块静态 import 边界
// ============================================================

describe('SC-015：collector-surface.ts 的模块说明符 ⊆ Node builtinModules', () => {
  const NODE_BUILTINS = new Set(builtinModules);

  it('四种语法形态提取到的说明符全部为 Node 内建模块（裸名或 node: 前缀）', () => {
    const sourceFile = parseRepoFile('src/collector-surface.ts');
    const specifiers = collectModuleSpecifiers(sourceFile);
    const nonBuiltin = specifiers.filter((raw) => {
      const bare = raw.startsWith('node:') ? raw.slice('node:'.length) : raw;
      return !NODE_BUILTINS.has(bare);
    });
    expect(nonBuiltin).toEqual([]);
  });

  it('（oracle 自检）四种语法形态都能被提取器识别——防止"什么都没找到所以恒绿"', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      'probe.ts',
      [
        "import * as fsProbe from 'node:fs';",
        "export { somethingProbe } from './local-reexport.js';",
        "const requiredProbe = require('node:os');",
        "async function dyn() { return import('some-external-pkg'); }",
        'void fsProbe; void requiredProbe; void dyn;',
      ].join('\n'),
    );
    expect(collectModuleSpecifiers(sourceFile).sort()).toEqual(
      ['./local-reexport.js', 'node:fs', 'node:os', 'some-external-pkg'].sort(),
    );
  });

  it('（oracle 自检）非内建说明符会被判为违规——证明断言具备检出能力', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(
      'probe2.ts',
      "import { z } from 'zod';\nvoid z;\n",
    );
    const specifiers = collectModuleSpecifiers(sourceFile);
    const nonBuiltin = specifiers.filter((raw) => !NODE_BUILTINS.has(raw.replace(/^node:/, '')));
    expect(nonBuiltin).toEqual(['zod']);
  });
});

// ============================================================
// (b) 行为探针：临时目录实跑各管线真实入口
// ============================================================

/**
 * 样本清单：覆盖五条管线的全部声明扩展名 + 三个大小写变体 + 三个面外扩展名。
 *
 * 大小写变体的基名两两不同（`legacy.TS` 而非 `a.TS`）：macOS/Windows 文件系统大小写
 * 不敏感，同名不同壳的两个样本会被静默覆盖（与 fixture README 的 P17 禁止事项同因）。
 */
const SAMPLE_FILES: readonly string[] = [
  // #1 tsjsSkeletonWalk
  'a.ts', 'a.tsx', 'a.js', 'a.jsx',
  // #2 pyWalk
  'b.py', 'b.pyi',
  // #3 genericAdapters（含大小写变体，两者基名不同以避开大小写不敏感文件系统碰撞）
  'Alpha.java', 'Beta.JAVA', 'main.go', 'Other.GO',
  // #1 与 #7/#8 共有扩展（rebase 调和：.mjs/.cjs 经 d27ba75 已进入 tsjsSkeletonWalk 面，
  // 不再是 moduleDerivationScan 专属）+ #7/#8 仍然专属的 .mts/.cts
  'm.mjs', 'm.cjs', 'm.mts', 'm.cts',
  // 大小写变体（用于证明 case-sensitive 管线没被放宽）
  'legacy.TS', 'legacy.PY', 'upper.MJS',
  // 完全落在所有采集面之外
  'notes.md', 'data.json', 'script.rb',
];

/**
 * 期望被某条 surface 采集的样本文件名（按该 surface 自身的**真实匹配形态**求值）。
 *
 * W-004：这里必须用 `surfaceMatchesFile`（文件名口径）而非"自己提取扩展名 + surfaceHasExtension"——
 * 后者是被本轮修掉的失真写法，用它构造期望值就等于用错误口径给错误实现打掩护。
 */
function expectedSamplesFor(surface: CollectorPipelineSurface): string[] {
  return SAMPLE_FILES.filter((name) => surfaceMatchesFile(surface, name)).sort();
}

describe('SC-005 (b)：各管线真实入口函数的行为探针', () => {
  let probeDir: string;

  beforeAll(() => {
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-surface-probe-'));
    for (const name of SAMPLE_FILES) {
      fs.writeFileSync(path.join(probeDir, name), '// f243 probe sample\n');
    }
  });

  afterAll(() => {
    fs.rmSync(probeDir, { recursive: true, force: true });
  });

  it('#1 walkTsJsFiles 采集集合 === TSJS_SKELETON_WALK_SURFACE 声明面（case-sensitive，.TS 不入选）', () => {
    const out: string[] = [];
    walkTsJsFiles(probeDir, out, () => false, probeDir);
    expect(out.map((p) => path.basename(p)).sort()).toEqual(
      expectedSamplesFor(TSJS_SKELETON_WALK_SURFACE),
    );
    expect(out.map((p) => path.basename(p))).not.toContain('legacy.TS');
  });

  it('#2 walkPyFiles 采集集合 === PY_WALK_SURFACE 声明面（含 .pyi，.PY 不入选）', () => {
    const out: string[] = [];
    walkPyFiles(probeDir, out, () => false, probeDir);
    const names = out.map((p) => path.basename(p)).sort();
    expect(names).toEqual(expectedSamplesFor(PY_WALK_SURFACE));
    expect(names).toContain('b.pyi');
    expect(names).not.toContain('legacy.PY');
  });

  it('#3 generic collector（Java/Go adapter）采集集合 === JAVA ∪ GO 声明面（case-insensitive）', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(probeDir, [
      new JavaLanguageAdapter(),
      new GoLanguageAdapter(),
    ]);
    const names = [...skeletons.keys()].map((p) => path.basename(p)).sort();
    const expected = [
      ...expectedSamplesFor(JAVA_ADAPTER_SURFACE),
      ...expectedSamplesFor(GO_ADAPTER_SURFACE),
    ].sort();
    expect(names).toEqual(expected);
    // 大小写变体确实被采集（generic walk 用 extname().toLowerCase()）
    expect(names).toEqual(expect.arrayContaining(['Beta.JAVA', 'Other.GO']));
  });

  it('#6 scanSourceFiles 扫描结果的代码扩展子集 === TSJS_SKELETON_WALK_SURFACE，不含 SSoT 其他管线扩展', () => {
    const scanned = scanSourceFiles(probeDir).map((p) => path.basename(p));
    const codeExtensions = new Set(
      scanned
        .map((name) => extensionOf(name).toLowerCase())
        .filter((ext) => ALL_DECLARED_EXTENSIONS.has(ext)),
    );
    expect([...codeExtensions].sort()).toEqual([...TSJS_SKELETON_WALK_SURFACE.extensions].sort());
    // cache fallback 自有的 toLowerCase 匹配语义保持不变（`.TS` 归一化后仍入选，
    // 属该文件既有职责、FR-002 明确排除在收敛范围外），因此此处不断言大小写敏感性。
    expect(scanned).toContain('data.json');
    // rebase 调和：`m.mjs`/`m.cjs` 已随 d27ba75 扩面进入 TSJS 面，因此**应当**被 cache
    // fallback 收集（这正是 d27ba75 修的"源码改动不让 cache key 变化"缺陷）；仍在面外的
    // 是 moduleDerivationScan 专属的 `.mts`/`.cts` 与其他管线扩展。
    expect(scanned).toContain('m.mjs');
    expect(scanned).toContain('m.cjs');
    for (const outOfSurface of ['b.py', 'Alpha.java', 'main.go', 'm.mts', 'm.cts']) {
      expect(scanned).not.toContain(outOfSurface);
    }
  });
});

// ============================================================
// (b) #11 python 符号扫描面探针（W-002 新增管线）
// ============================================================

describe('SC-005 (b) #11：PythonLanguageAdapter 符号扫描面 === PYTHON_SYMBOL_SCAN_SURFACE', () => {
  let scanDir: string;

  const PY_SCAN_SAMPLES: readonly string[] = [
    'mod.py', // 声明面与扫描面都覆盖 → MUST 命中
    'mod.pyi', // 声明面与扫描面自 F250 起都覆盖 → MUST 命中（parity 修复后两面一致）
    'legacy.PY', // 大小写变体 → MUST NOT 命中（endsWith 大小写敏感）
    'notes.md', // 面外 → MUST NOT 命中
  ];

  beforeAll(() => {
    scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-py-symbol-scan-'));
    for (const name of PY_SCAN_SAMPLES) {
      fs.writeFileSync(path.join(scanDir, name), 'def probe():\n    return 1\n');
    }
  });

  afterAll(() => {
    fs.rmSync(scanDir, { recursive: true, force: true });
  });

  /** 实跑 extractSymbolNodes，返回它实际访问到的文件（module 节点 id = 相对路径）。 */
  async function scannedFiles(): Promise<string[]> {
    const adapter = new PythonLanguageAdapter();
    // 只测"扫描到哪些文件"这一采集面，AST 分析结果与本断言无关，故 stub 掉解析开销
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [],
      imports: [],
      raw: '',
    });
    const results = await adapter.extractSymbolNodes(scanDir);
    return results
      .flatMap((result) => result.nodes.filter((node) => node.kind === 'module').map((node) => node.id))
      .sort();
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('实跑采集集合与 SSoT 声明面精确一致（mod.py / mod.pyi 命中；legacy.PY 不命中）', async () => {
    const scanned = await scannedFiles();

    expect(scanned).toEqual(
      PY_SCAN_SAMPLES.filter((name) => surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, name)).sort(),
    );
    // FR-006：独立的硬编码期望值列表——常量被改回 `['.py']` 时本行必红，
    // 不允许退化为"仅由 PYTHON_SYMBOL_SCAN_SURFACE 自身反向推导"的自证断言
    expect(scanned).toEqual(['mod.py', 'mod.pyi']);
    expect(scanned).not.toContain('legacy.PY');
    expect(scanned).not.toContain('notes.md');
  });

  it('同一目录下 walkPyFiles（#2）与符号扫描面（#11）采集集合相等 —— F250 parity 修复后两面一致', async () => {
    const walked: string[] = [];
    walkPyFiles(scanDir, walked, () => false, scanDir);
    const walkedNames = walked.map((p) => path.basename(p)).sort();
    const scanned = await scannedFiles();

    // 两侧各自持有独立硬编码期望（FR-006）：任一侧单独回退都会变红，
    // 而不是仅比较两侧相等（后者在"两侧同时回退"时会假绿）
    expect(walkedNames).toEqual(['mod.py', 'mod.pyi']);
    expect(scanned).toEqual(['mod.py', 'mod.pyi']);
    expect(scanned).toEqual(walkedNames);
    // 结论：`.pyi` 同时进 skeleton 采集面与 python 符号扫描面。SSoT 仍分列两条常量，
    // 是为保留各自管线身份与指纹 key 的独立稳定性，而非因为扩展名集合不同。
  });
});

// ============================================================
// (b) W-004：纯点文件命中矩阵 —— 判定 helper 与真实 producer 逐一对拍
// ============================================================

/**
 * 为什么必须单独造纯点文件样本：两族匹配形态**只在这类文件上分叉**。
 * - endsWith 族（TSJS/PY walk、python 符号扫描）：`.ts` 的 `'.ts'.endsWith('.ts')` 为真 → 采集
 * - extname 族（Java/Go adapter、module 派生扫描）：`path.extname('.go') === ''` → 不采集
 *
 * 旧 helper 对两族一律"lastIndexOf('.') 切片 + Set.has"，对 extname 族给出的是**反向**答案
 * （把 `.go` 判成命中）。常规样本（`a.ts`/`main.go`）两种写法同解，因此只有纯点文件能把这个
 * 失真暴露出来——也正因如此，它此前一路绿到了 Codex 审查（W-004）。
 */
describe('W-004：纯点文件在各管线的命中矩阵与真实 producer 一致', () => {
  let dotDir: string;
  let srcDir: string;

  /** 纯点文件 + 每条管线一个常规对照样本（对照样本证明探针处于活性状态）。 */
  const DOT_SAMPLES: readonly string[] = ['.ts', '.go', '.java', '.mjs', '.py'];
  const CONTROL_SAMPLES: readonly string[] = ['live.ts', 'live.go', 'Live.java', 'live.mjs', 'live.py'];
  const ALL_DOT_PROBE_SAMPLES: readonly string[] = [...DOT_SAMPLES, ...CONTROL_SAMPLES];

  beforeAll(() => {
    dotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-dotfile-probe-'));
    srcDir = path.join(dotDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    for (const name of ALL_DOT_PROBE_SAMPLES) {
      // 内容对 ts/js/mjs 家族必须可被 ts-morph 解析（module 派生扫描会解析它们）
      fs.writeFileSync(path.join(srcDir, name), 'export const probe = 1;\n');
    }
  });

  afterAll(() => {
    fs.rmSync(dotDir, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    LanguageAdapterRegistry.resetInstance();
  });

  /** helper 预测：按 surface 自身匹配形态求值。 */
  function predicted(surface: CollectorPipelineSurface): string[] {
    return ALL_DOT_PROBE_SAMPLES.filter((name) => surfaceMatchesFile(surface, name)).sort();
  }

  it('#1 walkTsJsFiles（endsWith 族）：`.ts` 命中，预测与实跑一致', () => {
    const out: string[] = [];
    walkTsJsFiles(srcDir, out, () => false, srcDir);
    const actual = out.map((p) => path.basename(p)).sort();

    expect(actual).toEqual(predicted(TSJS_SKELETON_WALK_SURFACE));
    expect(actual).toContain('.ts'); // 纯点文件确实被生产者采集
    expect(actual).toContain('live.ts'); // 活性对照
  });

  it('#2 walkPyFiles（endsWith 族）：`.py` 命中，预测与实跑一致', () => {
    const out: string[] = [];
    walkPyFiles(srcDir, out, () => false, srcDir);
    const actual = out.map((p) => path.basename(p)).sort();

    expect(actual).toEqual(predicted(PY_WALK_SURFACE));
    expect(actual).toContain('.py');
    expect(actual).toContain('live.py');
  });

  it('#3 generic collector（extname 族）：`.java`/`.go` 纯点文件不命中，预测与实跑一致', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(srcDir, [
      new JavaLanguageAdapter(),
      new GoLanguageAdapter(),
    ]);
    const actual = [...skeletons.keys()].map((p) => path.basename(p)).sort();

    expect(actual).toEqual([...predicted(JAVA_ADAPTER_SURFACE), ...predicted(GO_ADAPTER_SURFACE)].sort());
    expect(actual).not.toContain('.java');
    expect(actual).not.toContain('.go');
    expect(actual).toEqual(expect.arrayContaining(['Live.java', 'live.go'])); // 活性对照
  });

  it('#7/#8 module 派生扫描（extname 族）：`.mjs`/`.ts` 纯点文件不命中，预测与实跑一致', async () => {
    const graph = await buildModuleGraphForProject(dotDir);
    const actual = graph.modules.map((module) => path.basename(module.source)).sort();

    expect(actual).toEqual(predicted(MODULE_DERIVATION_SCAN_SURFACE));
    expect(actual).not.toContain('.mjs');
    expect(actual).not.toContain('.ts');
    expect(actual).toEqual(expect.arrayContaining(['live.mjs', 'live.ts'])); // 活性对照
  });

  it('#11 python 符号扫描（endsWith 族）：`.py` 纯点文件命中，预测与实跑一致', async () => {
    const adapter = new PythonLanguageAdapter();
    vi.spyOn(adapter, 'analyzeFile').mockResolvedValue({
      language: 'python',
      filePath: '',
      parserUsed: 'tree-sitter',
      exports: [],
      imports: [],
      raw: '',
    });
    const results = await adapter.extractSymbolNodes(dotDir);
    const actual = results
      .flatMap((result) => result.nodes.filter((node) => node.kind === 'module').map((node) => node.id))
      .map((id) => path.basename(id))
      .sort();

    expect(actual).toEqual(predicted(PYTHON_SYMBOL_SCAN_SURFACE));
    expect(actual).toContain('.py');
    expect(actual).toContain('live.py');
  });

  it('两族对同一批纯点文件给出相反答案 —— 证明分派确实按 matchSemantics 生效（非恒等实现）', () => {
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, '.ts')).toBe(true);
    expect(surfaceMatchesFile(MODULE_DERIVATION_SCAN_SURFACE, '.ts')).toBe(false);
    expect(surfaceMatchesFile(PY_WALK_SURFACE, '.py')).toBe(true);
    expect(surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, '.py')).toBe(true);
    expect(surfaceMatchesFile(JAVA_ADAPTER_SURFACE, '.java')).toBe(false);
    expect(surfaceMatchesFile(GO_ADAPTER_SURFACE, '.go')).toBe(false);
    // 带目录前缀同样成立（dirty 判定拿到的是仓库相对路径，不是裸文件名）
    expect(surfaceMatchesFile(GO_ADAPTER_SURFACE, 'src/.go')).toBe(false);
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'src/.ts')).toBe(true);
  });
});

// ============================================================
// (b) #5 ignore-oracle：扩展名 → 生产者忽略集合的分派面探针
// ============================================================

/**
 * `createIgnoreOracle` 的分派目标无公开出口，用"判别性目录段"反推：
 * 四个探针段各自只属于部分生产者忽略集合，四元签名唯一确定分派目标。
 *
 * | 段 | TSJS | PY | Java | Go | union 兜底 |
 * |----|------|----|------|----|-----------|
 * | `tmp`      | ✓ | — | — | — | ✓ |
 * | `venv`     | — | ✓ | — | — | ✓ |
 * | `.gradle`  | — | — | ✓ | — | — |
 * | `vendor`   | — | — | — | ✓ | — |
 */
const DISPATCH_PROBE_SEGMENTS = ['tmp', 'venv', '.gradle', 'vendor'] as const;

const DISPATCH_SIGNATURES: Readonly<Record<string, string>> = {
  'T,F,F,F': 'tsjs',
  'F,T,F,F': 'py',
  'F,F,T,F': 'java',
  'F,F,F,T': 'go',
  'T,T,F,F': 'union-fallback',
};

describe('SC-005 (b) #5：createIgnoreOracle 的扩展名分派面与 SSoT 一致', () => {
  let oracleDir: string;
  let isIgnored: (relativePath: string) => boolean;

  beforeAll(() => {
    oracleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-ignore-oracle-'));
    isIgnored = createIgnoreOracle(oracleDir);
  });

  afterAll(() => {
    fs.rmSync(oracleDir, { recursive: true, force: true });
  });

  function classifyDispatch(extension: string): string {
    const signature = DISPATCH_PROBE_SEGMENTS.map((segment) =>
      isIgnored(`${segment}/probe${extension}`) ? 'T' : 'F',
    ).join(',');
    return DISPATCH_SIGNATURES[signature] ?? `unclassified(${signature})`;
  }

  /**
   * ignore-oracle 只消费四条**有专属忽略目录合同**的采集管线；
   * `MODULE_DERIVATION_SCAN_SURFACE` 不在其中（module 派生扫描没有自己的忽略目录合同），
   * 故其**专属**扩展名落 union 兜底——这是本文件既有设计，本需求不改变它，此处如实断言
   * 而非按"全部五管线"编造。
   *
   * rebase 调和：`.mjs`/`.cjs` 已随 d27ba75 扩面进入 TSJS 面，因此**不再是** moduleDerivationScan
   * 专属，现随 tsjs 分派（这正是 d27ba75 在 ignore-oracle 侧要修的分派脱节）；仍然专属于
   * moduleDerivationScan 的只剩 `.mts`/`.cts`。
   */
  const DISPATCHED_SURFACES: readonly { readonly label: string; readonly surface: CollectorPipelineSurface }[] = [
    { label: 'tsjs', surface: TSJS_SKELETON_WALK_SURFACE },
    { label: 'py', surface: PY_WALK_SURFACE },
    { label: 'java', surface: JAVA_ADAPTER_SURFACE },
    { label: 'go', surface: GO_ADAPTER_SURFACE },
  ];

  it('四条被分派管线的每个声明扩展名都路由到该管线自己的忽略集合', () => {
    const actual: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const { label, surface } of DISPATCHED_SURFACES) {
      for (const extension of surface.extensions) {
        actual[extension] = classifyDispatch(extension);
        expected[extension] = label;
      }
    }
    expect(actual).toEqual(expected);
  });

  it('大小写变体按各管线 matchSemantics 分派：`.JAVA`/`.GO` 命中，`.TS`/`.PY` 落 union 兜底', () => {
    expect(classifyDispatch('.JAVA')).toBe('java');
    expect(classifyDispatch('.GO')).toBe('go');
    expect(classifyDispatch('.TS')).toBe('union-fallback');
    expect(classifyDispatch('.PY')).toBe('union-fallback');
  });

  it('module 派生扫描仍然专属的扩展名与未知扩展名落 union 兜底（本文件不消费该管线，如实断言）', () => {
    for (const extension of ['.mts', '.cts', '.rb']) {
      expect(classifyDispatch(extension)).toBe('union-fallback');
    }
  });

  // rebase 调和：`.mjs`/`.cjs` 从"union 兜底"翻转为"随 tsjs 分派"，是 d27ba75 扩面经 SSoT
  // 传导到 ignore-oracle 的正确结果（生产者确实采集这两类文件，ignore 判定就必须用 TSJS
  // 的忽略目录合同而非 union 兜底）。单列一条用例把这个翻转显式钉住，而不是从上面那条
  // 用例里静默删掉两个扩展名。
  it('rebase 调和：`.mjs`/`.cjs` 随 d27ba75 扩面改由 tsjs 分派（不再落 union 兜底）', () => {
    expect(classifyDispatch('.mjs')).toBe('tsjs');
    expect(classifyDispatch('.cjs')).toBe('tsjs');
  });
});

// ============================================================
// (b) #8 module-derivation registry-fallback 分支端到端探针
// ============================================================

describe('SC-005 (b) #8：空 registry fallback 的扫描面 === MODULE_DERIVATION_SCAN_SURFACE', () => {
  let projectDir: string;

  const FALLBACK_SAMPLES: readonly string[] = [
    // MODULE_DERIVATION_SCAN_SURFACE 八扩展各一
    'a.ts', 'a.tsx', 'a.js', 'a.jsx', 'm.mjs', 'm.cjs', 'm.mts', 'm.cts',
    // 大小写变体（该管线 case-insensitive，应被采集）
    'upper.MJS',
    // 面外样本（不应产出 module 节点）
    'b.py', 'Alpha.java', 'main.go', 'notes.md',
  ];

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-module-fallback-'));
    const srcDir = path.join(projectDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    for (const name of FALLBACK_SAMPLES) {
      // 内容对全部样本统一为可被 ts-morph 解析的最小 ESM 声明（.md 同样写入，
      // 它本就不该进入扫描面，内容无关紧要）。
      fs.writeFileSync(path.join(srcDir, name), `export const value_${name.replace(/\W/g, '_')} = 1;\n`);
    }
    LanguageAdapterRegistry.resetInstance();
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // 对齐 tests/unit/batch-orchestrator.test.ts:71 既有惯例：reset-to-empty，
    // 不预先猜测下一个用例需要什么 bootstrap 状态。
    LanguageAdapterRegistry.resetInstance();
  });

  it('registry 为空时走 fallback 分支，产出模块的扩展名集合与 SSoT 声明面完全一致', async () => {
    expect(LanguageAdapterRegistry.getInstance().isEmpty()).toBe(true);

    const moduleGraph = await buildModuleGraphForProject(projectDir);
    const scannedExtensions = new Set(
      moduleGraph.modules.map((m) => extensionOf(path.basename(m.source)).toLowerCase()),
    );

    expect([...scannedExtensions].sort()).toEqual(
      [...MODULE_DERIVATION_SCAN_SURFACE.extensions].sort(),
    );
    // 面外样本没有任何 module 节点
    const sources = moduleGraph.modules.map((m) => path.basename(m.source));
    for (const outOfSurface of ['b.py', 'Alpha.java', 'main.go', 'notes.md']) {
      expect(sources).not.toContain(outOfSurface);
    }
    // 大小写变体被采集（该管线 case-insensitive）
    expect(sources).toContain('upper.MJS');
  });
});

// ============================================================
// mergeSurfaces：genericAdapters 合并语义（决策 3 / plan I-02）
// ============================================================

describe('mergeSurfaces', () => {
  it('matchSemantics 相同时合并扩展名并集，语义保持不变', () => {
    const merged = mergeSurfaces(JAVA_ADAPTER_SURFACE, GO_ADAPTER_SURFACE);
    expect([...merged.extensions].sort()).toEqual(['.go', '.java']);
    expect(merged.matchSemantics).toBe('case-insensitive');
  });

  it('matchSemantics 不一致时 throw（不静默选其一、不强行合并）', () => {
    expect(() => mergeSurfaces(TSJS_SKELETON_WALK_SURFACE, JAVA_ADAPTER_SURFACE)).toThrow(
      /matchSemantics 不一致/,
    );
  });

  it('合并产出的是新对象，不篡改任一输入 surface', () => {
    const javaBefore = [...JAVA_ADAPTER_SURFACE.extensions];
    const goBefore = [...GO_ADAPTER_SURFACE.extensions];
    mergeSurfaces(JAVA_ADAPTER_SURFACE, GO_ADAPTER_SURFACE);
    expect([...JAVA_ADAPTER_SURFACE.extensions]).toEqual(javaBefore);
    expect([...GO_ADAPTER_SURFACE.extensions]).toEqual(goBefore);
  });
});

// ============================================================
// surfaceHasExtension：语义收敛点自身的真值表
// ============================================================

describe('surfaceHasExtension', () => {
  it('case-sensitive 管线只认原样扩展名', () => {
    expect(surfaceHasExtension(TSJS_SKELETON_WALK_SURFACE, '.ts')).toBe(true);
    expect(surfaceHasExtension(TSJS_SKELETON_WALK_SURFACE, '.TS')).toBe(false);
    expect(surfaceHasExtension(PY_WALK_SURFACE, '.pyi')).toBe(true);
    expect(surfaceHasExtension(PY_WALK_SURFACE, '.PY')).toBe(false);
  });

  it('case-insensitive 管线接受大小写变体', () => {
    expect(surfaceHasExtension(JAVA_ADAPTER_SURFACE, '.JAVA')).toBe(true);
    expect(surfaceHasExtension(GO_ADAPTER_SURFACE, '.Go')).toBe(true);
    expect(surfaceHasExtension(MODULE_DERIVATION_SCAN_SURFACE, '.MJS')).toBe(true);
  });

  it('面外扩展名与空扩展名一律 false', () => {
    for (const surface of ALL_PRODUCER_SURFACES) {
      expect(surfaceHasExtension(surface, '.rb')).toBe(false);
      expect(surfaceHasExtension(surface, '')).toBe(false);
    }
  });
});

// ============================================================
// surfaceMatchesFile：文件名口径的真值表（W-004 收敛点自身）
// ============================================================

describe('surfaceMatchesFile', () => {
  it('endsWith 族：常规样本、多点样本、带目录前缀样本一致命中；大小写变体不命中', () => {
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'a.ts')).toBe(true);
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'a.d.ts')).toBe(true);
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'src/nested/a.tsx')).toBe(true);
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'a.TS')).toBe(false);
    expect(surfaceMatchesFile(PY_WALK_SURFACE, 'stub.pyi')).toBe(true);
    // F250：符号扫描面扩集后同样命中 `.pyi`（两面 parity）
    expect(surfaceMatchesFile(PYTHON_SYMBOL_SCAN_SURFACE, 'stub.pyi')).toBe(true);
  });

  it('extname 族：大小写变体命中；扩展名出现在目录段而非文件名时不命中', () => {
    expect(surfaceMatchesFile(JAVA_ADAPTER_SURFACE, 'Foo.JAVA')).toBe(true);
    expect(surfaceMatchesFile(GO_ADAPTER_SURFACE, 'pkg/main.Go')).toBe(true);
    expect(surfaceMatchesFile(MODULE_DERIVATION_SCAN_SURFACE, 'upper.MJS')).toBe(true);
    // 目录名带扩展名、文件本身无扩展名：两族都必须判不命中
    expect(surfaceMatchesFile(MODULE_DERIVATION_SCAN_SURFACE, 'dist.js/README')).toBe(false);
    expect(surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, 'dist.ts/README')).toBe(false);
  });

  it('无扩展名 / 面外扩展名 / 空串一律 false', () => {
    for (const surface of ALL_PRODUCER_SURFACES) {
      expect(surfaceMatchesFile(surface, 'Makefile')).toBe(false);
      expect(surfaceMatchesFile(surface, 'notes.rb')).toBe(false);
      expect(surfaceMatchesFile(surface, '')).toBe(false);
    }
  });

  it('extname 族的提取口径就是 `path.extname`（含 `..`/`a..` 等非直觉边界，逐例对拍）', () => {
    // 与 producer 用的是同一个函数，因此这条断言在结构上恒成立；它的价值在于把
    // "将来有人为了'零依赖'把 extname 换成手写切片"这一改动立刻变红。
    const cases = ['a.go', '.go', '..', 'a..', 'a.', 'dir.go/x', 'A.GO', 'x/y/.go'];
    for (const sample of cases) {
      expect(surfaceMatchesFile(GO_ADAPTER_SURFACE, sample)).toBe(
        GO_ADAPTER_SURFACE.extensions.has(path.extname(sample).toLowerCase()),
      );
    }
  });
});
