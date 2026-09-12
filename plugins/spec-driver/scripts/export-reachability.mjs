#!/usr/bin/env node
/**
 * F286（承接 F277 FR-010 ~ FR-013）— 新增导出符号生产可达性检查（**纯词法**扫描，FR-012）。
 *
 * 要拦的病：只被测试引用的死代码穿过全绿测试（F270 的 `routeNonBlock` 形态——生产零接线，单测全绿）。
 *
 * 判据（FR-010，F286 对抗复审后收紧）：本次改动**新增**的导出符号，若在生产侧没有任何**合格使用行**即报警。合格使用行 =
 *   (a) 定义文件自身的非声明、非注释、非 import 类行；或
 *   (b) **import 了定义文件**（模块说明符 basename 相同；re-export 链只追一跳）的生产文件里的非声明、非注释、非 import 类行。
 * import 类行含多行 `import { … } from` 块与 `export { … } from` 再导出块——一行（或一块）死 import 洗不白；他文件里碰巧同名的
 * 声明 / 调用不算使用（不 import 定义文件 ⇒ 与该符号无关）。
 *
 * 能力边界（FR-012，固定口径 `HONESTY_BOUNDARY` 恒随输出打印，不得只写在免责节）：词法层无法区分「引用」与「调用」，
 * 赋值 / 传参 / 成员访问同样计为使用；同 basename 的不同模块仍可能同名碰撞；`export default` 别名、字符串反射不可见。
 * 本检查**仅拦无意遗漏，不拦有意规避**。
 *
 * 契约字段（FR-010）：`--base <ref>` 必填无默认值；基线按 `git merge-base <ref> HEAD` 解析（master 领先分支时避免反向 diff 噪声）；
 * 解析结果 == HEAD 且工作树干净时 exit 2（除非 `--allow-head`）——输入是空集、检查会静默通过。比较命令与比较范围随报告输出。
 * 「零新增导出符号」的结论必须附产生它的命令与原始输出（FR-027 同标准）。
 *
 * 处置（FR-013）由 verify 子代理在报告里完成：每条报警在「接线遗漏 / 有意的预留 / 应删除」三支择一并给可核对落点；
 * 「有意的预留」须派生归属明确 Phase 的延期承诺任务，否则该处置无效。本脚本只产出报警与处置表骨架。
 *
 * 用法：node export-reachability.mjs --project-root <dir> --base <ref> [--scope src/,plugins/spec-driver/scripts/] [--format md|json]
 *       [--allow-head] [--fail-on-warning]
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';

export const HONESTY_BOUNDARY =
  '本检查仅拦无意遗漏，不拦有意规避：判据是词法层「定义文件自身、或 import 了定义文件的生产文件里，非声明 / 非注释 / 非 import 行' +
  '是否出现该符号」，无法区分引用与调用——加一行赋值 / 传参式引用即可绕过；同 basename 的不同模块仍可能同名碰撞；re-export 链只追一跳；' +
  'export default 别名与字符串反射不可见。属已知且未修复的构造面（F277 FR-012）。';

const DEFAULT_SCOPE = ['src/', 'plugins/spec-driver/scripts/', 'scripts/'];
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const TEST_PATH = /(^|\/)(tests?|__tests__|fixtures|__fixtures__|test-fixtures|testdata)\//;
const TEST_FILE = /\.(test|spec|test-d)\.[cm]?[jt]sx?$|\.typecheck\.[cm]?ts$/;
const DECL_FILE = /\.d\.[cm]?ts$/;
const IDENT = '[A-Za-z_$][\\w$]*';
/** 允许出现在 `export` 之前的同行前缀：装饰器 / 块注释 */
const EXPORT_PREFIX = '(?:@\\w+(?:\\([^)]*\\))?\\s+|/\\*.*?\\*/\\s*)*';
const DECL_KIND = '(?:function\\s*\\*?\\s*|(?:const\\s+enum|const|let|var|class|abstract\\s+class|interface|type|enum|namespace)\\s+)';
const SINGLE_EXPORT = new RegExp(`^\\s*${EXPORT_PREFIX}export\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?${DECL_KIND}(${IDENT})`);
const DESTRUCTURED_EXPORT = new RegExp(`^\\s*${EXPORT_PREFIX}export\\s+(?:declare\\s+)?(?:const|let|var)\\s*([{[])([^}\\]]*)[}\\]]`);
const EXPORT_LIST_OPEN = new RegExp(`^\\s*${EXPORT_PREFIX}export\\s*(?:type\\s*)?\\{`);
const CJS_MEMBER_EXPORT = new RegExp(`^\\s*(?:module\\.)?exports\\.(${IDENT})\\s*=`);
const CJS_OBJECT_EXPORT_OPEN = /^\s*module\.exports\s*=\s*\{/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const IDENT_ONLY = new RegExp(`^${IDENT}$`);
const AS_ALIAS = new RegExp(`\\bas\\s+(${IDENT})$`);

/**
 * 列表里的绑定名：`{ a, b as c, d: e = 1, ...rest }`。
 * keySide=false（默认，解构 / 导出列表语义）：`d: e` 取 e（绑定到的本地名 / 导出名）；
 * keySide=true（`module.exports = { k: v }` 对象字面量语义）：`k: v` 取 k（导出键）。
 */
function identifiersInList(listText, { keySide = false } = {}) {
  const names = [];
  for (const part of listText.split(',')) {
    const seg = part.trim().replace(/\/\*.*?\*\//g, '');
    if (!seg) continue;
    const asMatch = AS_ALIAS.exec(seg);
    let name = asMatch ? asMatch[1] : seg.replace(/^type\s+/, '').replace(/^\.\.\./, '').split(/[:=]/)[0].trim();
    if (!asMatch && !keySide && /:/.test(seg)) name = seg.split(':')[1].split('=')[0].trim();
    if (IDENT_ONLY.test(name) && name !== 'default') names.push(name);
  }
  return names;
}

/**
 * 从「新增行」里抽取本文件**定义**的导出符号名（词法）。
 * 计入：单行声明式 export（含 default / declare / async / const enum / 装饰器或块注释前缀 / 同行多语句）、解构 export、
 * 本地导出列表 `export { a, b as c }`（单行或多行）、CJS `exports.x =` / `module.exports.x =` / `module.exports = { … }`。
 * 不计入（登记）：`export … from` / `export * as ns from` 再导出（是接线不是定义，可达性在定义处判）、`export default <ident>` 别名、`export =`。
 */
export function extractExportedNames(addedLines) {
  const names = new Set();
  const lines = Array.isArray(addedLines) ? addedLines : [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const segment of line.split(';')) {
      const m = SINGLE_EXPORT.exec(segment);
      if (m) { names.add(m[1]); continue; }
      const d = DESTRUCTURED_EXPORT.exec(segment);
      if (d) { for (const n of identifiersInList(d[2])) names.add(n); continue; }
      const c = CJS_MEMBER_EXPORT.exec(segment);
      if (c) names.add(c[1]);
    }
    if (EXPORT_LIST_OPEN.test(line) || CJS_OBJECT_EXPORT_OPEN.test(line)) {
      // 收集到闭合 `}` 为止（单行或多行）；带 from 的是再导出，跳过
      let j = i; let text = line;
      while (!/\}/.test(text) && j + 1 < lines.length) { j += 1; text += `\n${lines[j]}`; }
      i = j;
      if (/\}\s*from\b/.test(text) || /\bfrom\s*['"]/.test(text)) continue;
      const body = text.slice(text.indexOf('{') + 1, text.indexOf('}'));
      for (const n of identifiersInList(body, { keySide: CJS_OBJECT_EXPORT_OPEN.test(line) })) names.add(n);
    }
  }
  return [...names];
}

/**
 * 逐行归类：`import`（含多行 import / re-export / 本地导出列表 / `module.exports = {…}` 块 / require / 动态 import 行）、
 * `comment`（整行注释 / 块注释内）、`code`。同时收集每个 import 类行的模块说明符。
 * @returns {{ kinds: Array<'import'|'comment'|'code'>, specifiers: string[], reexportSpecifiers: string[] }}
 */
export function classifyLines(lines) {
  const kinds = new Array(lines.length).fill('code');
  const specifiers = []; const reexportSpecifiers = [];
  let inBlockComment = false; let inImportBlock = false; let importBlockIsReexport = false;
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (inBlockComment) { kinds[i] = 'comment'; if (/\*\//.test(t)) inBlockComment = false; continue; }
    if (/^\/\*/.test(t)) { kinds[i] = 'comment'; if (!/\*\//.test(t)) inBlockComment = true; continue; }
    if (/^\/\//.test(t) || /^\*/.test(t)) { kinds[i] = 'comment'; continue; }
    const specs = [...t.matchAll(SPECIFIER)].map((m) => m[1]);
    if (inImportBlock) {
      kinds[i] = 'import';
      (importBlockIsReexport ? reexportSpecifiers : specifiers).push(...specs);
      if (/\}/.test(t)) inImportBlock = false;
      continue;
    }
    const startsImport = /^import\b/.test(t);
    const startsExportList = /^export\s*(?:type\s*)?\{/.test(t) || /^export\s*\*/.test(t) || /^module\.exports\s*=\s*\{/.test(t);
    const hasRequire = /\brequire\s*\(\s*['"]/.test(t) || /\bimport\s*\(\s*['"]/.test(t);
    if (startsImport || startsExportList) {
      kinds[i] = 'import';
      const closed = !/\{/.test(t) || /\}/.test(t);
      const isReexport = startsExportList;
      (isReexport ? reexportSpecifiers : specifiers).push(...specs);
      if (!closed) { inImportBlock = true; importBlockIsReexport = isReexport; }
      continue;
    }
    if (hasRequire) { kinds[i] = 'import'; specifiers.push(...specs); continue; }
  }
  return { kinds, specifiers, reexportSpecifiers };
}

const basenameOf = (specifierOrPath) => path.basename(specifierOrPath).replace(/\.[^.]+$/, '');
const isRelativeSpecifier = (spec) => spec.startsWith('.') || spec.startsWith('/');

function listScopedFiles(projectRoot, scope) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && SOURCE_EXT.test(e.name) && !DECL_FILE.test(e.name)) out.push(path.relative(projectRoot, full).split(path.sep).join('/'));
    }
  };
  for (const prefix of scope) walk(path.join(projectRoot, prefix));
  return out;
}

function git(projectRoot, args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export class BaseRefError extends Error {
  constructor(message) { super(message); this.name = 'BaseRefError'; }
}

const normalizeScope = (scope) => scope.map((s) => s.replace(/\\/g, '/')).map((s) => (s === '' || s.endsWith('/') ? s : `${s}/`));

/**
 * @param {{ projectRoot:string, baseRef:string, scope?:string[], allowHead?:boolean }} opts
 */
export function analyzeExportReachability({ projectRoot, baseRef, scope = DEFAULT_SCOPE, allowHead = false }) {
  if (typeof baseRef !== 'string' || baseRef.length === 0) {
    throw new BaseRefError('analyzeExportReachability: baseRef 是契约字段，必须显式给出（基线未定义时输入为空集、检查会静默通过）');
  }
  const root = path.resolve(projectRoot);
  const scopes = normalizeScope(scope);
  const compareCommands = [];
  const rawOutputs = {};
  let baseSha;
  try { baseSha = git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]).trim(); } catch { baseSha = ''; }
  if (!baseSha) throw new BaseRefError(`analyzeExportReachability: --base ${baseRef} 不是可解析的 commit`);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  let mergeBase;
  try { mergeBase = git(root, ['merge-base', baseSha, head]).trim(); } catch { mergeBase = baseSha; }
  compareCommands.push(`git merge-base ${baseRef} HEAD  # => ${mergeBase}`);
  // 改动文件 = merge-base vs 工作树（含已提交与未提交）∪ 未跟踪文件；已删除文件单列，不进候选
  const changedRaw = git(root, ['diff', '--name-only', mergeBase]);
  compareCommands.push(`git diff --name-only ${mergeBase}`);
  const untrackedRaw = git(root, ['ls-files', '--others', '--exclude-standard']);
  compareCommands.push('git ls-files --others --exclude-standard');
  rawOutputs.changedFiles = changedRaw;
  rawOutputs.untrackedFiles = untrackedRaw;
  // 基线未定义形态（对抗复审 A-W5）：基线解析后 == HEAD 且工作树干净 ⇒ 输入是空集、「零新增导出符号」会静默成立 ⇒ 拒绝；
  // == HEAD 但工作树有未提交 / 未跟踪改动是合法形态（改动尚未 commit），只在契约块打 WARN
  const baseIsHead = mergeBase === head;
  const treeDirty = changedRaw.trim().length > 0 || untrackedRaw.trim().length > 0;
  if (baseIsHead && !treeDirty && !allowHead) {
    throw new BaseRefError(`analyzeExportReachability: --base ${baseRef} 解析后等于 HEAD（${head.slice(0, 12)}）且工作树干净——输入为空集、检查会静默通过，属基线未定义形态；确需如此请显式 --allow-head`);
  }
  const contractWarnings = baseIsHead ? ['基线解析后等于 HEAD：只盘点未提交 / 未跟踪改动（已提交的改动全部落在基线内）'] : [];
  const inScope = (f) => scopes.some((p) => f.startsWith(p)) && SOURCE_EXT.test(f) && !DECL_FILE.test(f) && !TEST_PATH.test(f) && !TEST_FILE.test(f);
  const changed = changedRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  const untracked = untrackedRaw.split('\n').map((s) => s.trim()).filter(Boolean);
  const scopedChanged = [...new Set([...changed, ...untracked])].filter(inScope).sort();
  const deletedFiles = scopedChanged.filter((f) => !fs.existsSync(path.join(root, f)));
  rawOutputs.deletedFiles = deletedFiles.join('\n');
  const candidates = scopedChanged.filter((f) => !deletedFiles.includes(f));

  // 每个改动文件的「新增行」：已跟踪走 unified=0 diff 的 + 行；未跟踪整文件算新增
  const newExports = [];
  for (const file of candidates) {
    const full = path.join(root, file);
    if (untracked.includes(file)) {
      compareCommands.push(`(untracked) cat ${file}`);
      for (const name of extractExportedNames(fs.readFileSync(full, 'utf8').split('\n'))) newExports.push({ name, file });
      continue;
    }
    const diffCmd = ['diff', '--unified=0', mergeBase, '--', file];
    const diff = git(root, diffCmd);
    compareCommands.push(`git ${diffCmd.join(' ')}`);
    const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    // 「新增」= 新增行里出现、删除行里没出现的导出名：只改值 / 改签名的既有导出（-export const x = 1 / +export const x = 2）不算新增
    const removedLines = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
    const removedNames = new Set(extractExportedNames(removedLines));
    for (const name of extractExportedNames(addedLines)) if (!removedNames.has(name)) newExports.push({ name, file });
  }

  // 使用扫描：生产侧只看 scope 内；测试侧看整个项目（tests/ 通常不在 scope 里，但「只被测试引用」这一列正需要它）
  const scopedFiles = listScopedFiles(root, scopes);
  const prodFiles = scopedFiles.filter((f) => !TEST_PATH.test(f) && !TEST_FILE.test(f));
  const testFiles = listScopedFiles(root, ['']).filter((f) => TEST_PATH.test(f) || TEST_FILE.test(f));
  const fileInfo = new Map();
  const info = (f) => {
    if (!fileInfo.has(f)) {
      const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\n');
      const classified = classifyLines(lines);
      fileInfo.set(f, {
        lines,
        kinds: classified.kinds,
        imports: new Set(classified.specifiers.filter(isRelativeSpecifier).map(basenameOf)),
        reexports: new Set(classified.reexportSpecifiers.filter(isRelativeSpecifier).map(basenameOf)),
      });
    }
    return fileInfo.get(f);
  };
  /** 一跳 re-export：把 `export … from './F'` 的文件 H 视为 F 的别名，import 了 H 的文件也算 F 的 importer */
  const importsDefiningFile = (g, definingBasename) => {
    const gi = info(g);
    if (gi.imports.has(definingBasename)) return true;
    for (const h of prodFiles) {
      if (h === g) continue;
      if (info(h).reexports.has(definingBasename) && gi.imports.has(basenameOf(h))) return true;
    }
    return false;
  };
  const stripTrailingComment = (line) => line.replace(/\s+\/\/.*$/, '');
  const symbols = newExports.map(({ name, file }) => {
    const escaped = name.replace(/\$/g, '\\$');
    const re = new RegExp(`(^|[^\\w$])${escaped}(?![\\w$])`);
    const declRe = new RegExp(`^\\s*${EXPORT_PREFIX}(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?${DECL_KIND}${escaped}(?![\\w$])`);
    const cjsDeclRe = new RegExp(`^\\s*(?:module\\.)?exports\\.${escaped}\\s*=`);
    /** 声明行：自身的定义（单声明 / 解构 / CJS 成员赋值），或他文件碰巧同名的本地声明——都不算使用 */
    const isDeclaration = (code) => {
      if (declRe.test(code) || cjsDeclRe.test(code)) return true;
      const d = DESTRUCTURED_EXPORT.exec(code);
      return Boolean(d && identifiersInList(d[2]).includes(name));
    };
    const definingBasename = basenameOf(file);
    let productionUseCount = 0; let productionImportCount = 0; let testUseCount = 0;
    const useSites = [];
    const countUses = (f) => {
      const { lines, kinds } = info(f);
      lines.forEach((line, i) => {
        if (!re.test(line)) return;
        if (kinds[i] === 'comment') return;
        if (kinds[i] === 'import') { productionImportCount += 1; return; }
        const code = stripTrailingComment(line);
        if (!re.test(code)) return;
        if (isDeclaration(code)) return;
        productionUseCount += 1;
        if (useSites.length < 10) useSites.push(`${f}:${i + 1}`);
      });
    };
    for (const f of prodFiles) {
      if (f === file) { countUses(f); continue; }
      if (!importsDefiningFile(f, definingBasename)) continue;   // 不 import 定义文件 ⇒ 同名也与本符号无关（对抗复审 A-C2）
      countUses(f);
    }
    for (const f of testFiles) {
      const { lines, kinds, imports } = info(f);
      if (!imports.has(definingBasename)) continue;
      lines.forEach((line, i) => { if (kinds[i] === 'code' && re.test(stripTrailingComment(line)) && !isDeclaration(line)) testUseCount += 1; });
    }
    return { name, file, productionUseCount, productionImportCount, testUseCount, useSites, warning: productionUseCount === 0 };
  });
  const warnings = symbols.filter((s) => s.warning);
  return {
    contract: { baseRef, baseSha, mergeBase, head, compareCommands, scope: [...scopes], warnings: contractWarnings },
    changedFiles: candidates,
    deletedFiles,
    rawOutputs,
    symbols,
    warnings,
    honestyBoundary: HONESTY_BOUNDARY,
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('## Layer 1.85: 导出符号生产可达性（F277 FR-010~013 · 词法）');
  lines.push('');
  lines.push('### 契约字段');
  lines.push(`- baseRef: \`${report.contract.baseRef}\`（解析 \`${report.contract.baseSha}\`；merge-base \`${report.contract.mergeBase}\`；HEAD \`${report.contract.head}\`）`);
  lines.push(`- scope: ${report.contract.scope.map((s) => `\`${s}\``).join(', ')}`);
  lines.push('- compareCommands:');
  for (const c of report.contract.compareCommands) lines.push(`  - \`${c}\``);
  if (report.deletedFiles.length > 0) lines.push(`- 已删除（不盘点）: ${report.deletedFiles.map((f) => `\`${f}\``).join(', ')}`);
  for (const w of report.contract.warnings) lines.push(`- ⚠️ ${w}`);
  lines.push('');
  if (report.symbols.length === 0) {
    lines.push('### 结论：零新增导出符号（附命令与原始输出，无命令的空集不构成通过）');
    lines.push('```');
    lines.push(`$ git diff --name-only ${report.contract.mergeBase}`);
    lines.push(report.rawOutputs.changedFiles.trimEnd() || '(空)');
    lines.push('$ git ls-files --others --exclude-standard');
    lines.push(report.rawOutputs.untrackedFiles.trimEnd() || '(空)');
    lines.push('```');
  } else {
    lines.push('### 新增导出符号');
    lines.push('| 符号 | 定义文件 | 生产使用行 | 生产 import 行 | 测试使用行 | 使用点（≤10） | 报警 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const s of report.symbols) {
      lines.push(`| \`${s.name}\` | ${s.file} | ${s.productionUseCount} | ${s.productionImportCount} | ${s.testUseCount} | ${s.useSites.join('<br>') || '—'} | ${s.warning ? '⚠️' : '—'} |`);
    }
    lines.push('');
    lines.push(`### 报警处置表（FR-013：每条在三支择一并给可核对落点；未处置 ⇒ verify 不得判通过）— 报警 ${report.warnings.length} 条`);
    lines.push('| 符号 | 处置（接线遗漏 / 有意的预留 / 应删除） | 落点（接线位置 / 延期承诺任务 ID + Phase / 删除动作） | 理由 |');
    lines.push('|---|---|---|---|');
    for (const w of report.warnings) lines.push(`| \`${w.name}\` |  |  |  |`);
    if (report.warnings.length === 0) lines.push('| （无报警） | — | — | — |');
  }
  lines.push('');
  lines.push(`> ${report.honestyBoundary}`);
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const opts = { projectRoot: process.cwd(), baseRef: null, scope: null, format: 'md', allowHead: false, failOnWarning: false };
  const takeValue = (flag, i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} 缺值`);
    return v;
  };
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      if (a === '--project-root') opts.projectRoot = takeValue(a, i++);
      else if (a === '--base') opts.baseRef = takeValue(a, i++);
      else if (a === '--scope') opts.scope = takeValue(a, i++).split(',').map((s) => s.trim()).filter(Boolean);
      else if (a === '--format') opts.format = takeValue(a, i++);
      else if (a === '--allow-head') opts.allowHead = true;
      else if (a === '--fail-on-warning') opts.failOnWarning = true;
      else throw new Error(`未知参数 ${a}`);
    }
  } catch (err) {
    process.stderr.write(`export-reachability: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
  if (opts.format !== 'md' && opts.format !== 'json') { process.stderr.write('export-reachability: --format 只接受 md|json\n'); return null; }
  return opts;
}

export function main(argv) {
  const opts = parseArgs(argv);
  if (opts === null) return 2;
  if (!opts.baseRef) {
    process.stderr.write('export-reachability: --base <ref> 是契约字段，必须显式给出（FR-010：基线未定义时输入为空集、检查会静默通过，故禁止默认值）\n');
    return 2;
  }
  let report;
  try {
    report = analyzeExportReachability({ projectRoot: opts.projectRoot, baseRef: opts.baseRef, scope: opts.scope ?? undefined, allowHead: opts.allowHead });
  } catch (err) {
    process.stderr.write(`export-reachability: ${err instanceof Error ? err.message : String(err)}\n`);
    return err instanceof BaseRefError ? 2 : 1;
  }
  process.stdout.write(opts.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  return opts.failOnWarning && report.warnings.length > 0 ? 1 : 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
