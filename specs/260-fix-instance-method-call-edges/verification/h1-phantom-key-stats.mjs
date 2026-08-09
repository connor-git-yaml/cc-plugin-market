#!/usr/bin/env node
/**
 * F260 W-E — P2 §3「H1 收口爆炸半径」统计数的**可重跑重算器**。
 *
 * 裁决 P2-4 对大产物要求「sha256 + 生成命令」；plan §13 W-E 把同一要求推广到**统计数**：
 * 只写一个 32/37/24 而不写采集口径，等于一个不可复算的断言。本脚本就是那个口径的可执行形式。
 *
 * ## 采集口径（这就是 W-E 要求写清的那三件事）
 *
 * 1. **文件清单来源**：`collectTsJsCodeSkeletons(projectRoot, { extractCallSites: true })` ——
 *    与 `buildAstGraphOnly`（graph-assembly.ts）**同一个采集器、同一个入口**，因此
 *    gitignore 过滤 / 忽略目录 / 扩展名白名单全部随采集器口径走，本脚本不另设过滤。
 *    ⇒ 被 gitignore 的文件**不在**统计内；`node_modules` / `dist` 同理。
 * 2. **是否含 type-only import**：**含**。`import type { X as Y }` 照样计入
 *    `renamedSpecifiers` / `distinctPhantomKeys`，并另行分列 typeOnly 计数，
 *    使「含 / 不含」两种口径都可读出，避免下一个人再猜。
 * 3. **命令**：`npm run build && node <此文件>`（陈旧 dist 会造假信号，故先建）。
 *
 * ## 各计数的定义（逐字对齐 P2 §3 的五行）
 *
 * - `importEntriesWithBindings` —— 携带非空 `namedImportBindings` 的 import 条目数
 * - `renamedSpecifiers`         —— 其中 `imported !== local` 的说明符总数
 * - `filesWithRenamed`          —— 至少含一个重命名说明符的文件数
 * - `distinctPhantomKeys`       —— 按 `file|imported` 去重后的幽灵键数
 *                                  （= H1 收口从 `aliasToTarget` 移除的键）
 * - `distinctLocalNames`        —— 按 `file|local` 去重后的本地绑定名数
 *                                  （= 进入 `renamedImportAliases` 的名字）
 *
 * ## 额外产出：W-E 的强度更正证据（两个口径并报）
 *
 * P2 §3 原文说「其余 31 个是已经关闭的潜在假边面」。这个方向成立，但**强度被高估**：
 * 幽灵键要真的派生出边，需要同文件里恰好有别的东西叫那个 `imported` 名。
 *
 * - `sameFileNameCollisions`（宽口径，历史口径，**不改**）—— 在**原始源码文本**上按词边界
 *   数 `imported` 名，命中 > 1 即算。含注释 / 字符串字面量里的命中，也含 import 说明符自身
 *   之外的任意一次出现。
 * - `strictCollisions`（严口径，P5b-4 新增）—— 先把注释、字符串 / 模板字面量内容、
 *   以及**引入该名字的 import 语句自身**（含 `const { X: Y } = await import(...)` /
 *   `require(...)` 解构形态）整体挖空，再按词边界数；命中 > 0 才算。
 *
 * 两个口径都报、都不互相覆盖：宽口径是 plan §13 W-E 记录在案的历史数字，严口径才是
 * 「真的存在一个同名值标识符」的下界。裁决 P4b-3 已定二者接受并存。
 *
 * ### 已知能力边界（如实登记，不 over-claim）
 *
 * - **W2 —— `$` 前缀名的词边界假阴性**：判据用 `\bNAME\b`，若 `imported` 名以 `$` 或其他
 *   非 `\w` 字符开头 / 结尾，左右词边界不成立 ⇒ 该名字恒判「无碰撞」。本仓当前 0 实例
 *   （脚本会把这类名字计入 `wordBoundaryUnverifiableNames` 并单列，不再静默）。
 * - **W3 —— inline `import { type X as Y }` 归值侧**：`namedImportBindings` 的元素只有
 *   `{ imported, local }` 两个字段（见 `models/code-skeleton.ts` 的 schema），**没有**
 *   说明符级的 `isTypeOnly`。因此 typeOnly 只能按 **import 条目级**（`imp.isTypeOnly`）判定，
 *   即只认 `import type { X as Y } from '...'` 这一种写法；写成
 *   `import { type X as Y } from '...'` 的会落进 `renamedSpecifiersValueOnly`。
 *   本仓 3 : 34 的拆分碰巧正确（无 inline 写法），换一个仓库即失真。
 * - 严口径的「挖空 import 自身」用的是词法级近似（挖注释 / 字符串 / import 语句与
 *   动态 import 解构头），不是完整解析；它给的是**下界**，不是精确值。
 *
 * ## dist 新鲜度守卫（P5b-4 / W4）
 *
 * 旧版只检查 `dist/` 目录存在，陈旧 dist（P2 收口之前的产物根本不产 `namedImportBindings`）
 * 会让全部计数落 0 并 `exit 0` —— 一个「全零 = 没问题」的假绿信号。现在三道闸：
 *  1. 关键符号缺席即 fail-loud：`collectTsJsCodeSkeletons`（采集入口）与
 *     `buildNamedImportBindings`（F260 D1 的单点规则实现，P2 之前的 dist 没有它）。
 *  2. 全零即 fail-loud：`collectedFiles` 或 `importEntriesWithBindings` 为 0 一律 exit 3。
 *  3. mtime 倒挂只作**告警**并落进输出（`distStaleWarning`）—— mtime 判据本身不可靠
 *     （F251 已论证），不拿它当致命判据，但忘了 build 的最常见情形能被它当场点出。
 *
 * 用法：node h1-phantom-key-stats.mjs [projectRoot]
 * 退出码：0 = 正常；2 = dist 缺失 / 关键符号缺席；3 = 结果全零（判为陈旧 dist 或采集失效）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.argv[2] ?? path.resolve(here, '../../..'));
const distDir = path.join(projectRoot, 'dist');
if (!fs.existsSync(distDir)) {
  console.error(`未找到 ${distDir} —— 必须先 npm run build（陈旧 / 缺失 dist 会造假信号）`);
  process.exit(2);
}

// ── 闸 1：关键符号存在性（dist 陈旧 / 半成品时 fail-loud，绝不静默降级） ──
const REQUIRED_SYMBOLS = [
  ['batch/stages/source-discovery.js', 'collectTsJsCodeSkeletons'],
  ['models/code-skeleton.js', 'buildNamedImportBindings'],
];
const loaded = {};
for (const [relPath, symbol] of REQUIRED_SYMBOLS) {
  const abs = path.join(distDir, relPath);
  if (!fs.existsSync(abs)) {
    console.error(`dist 缺少 ${relPath} —— dist 陈旧或构建未完成，先跑 npm run build`);
    process.exit(2);
  }
  const mod = await import(abs);
  if (typeof mod[symbol] !== 'function') {
    console.error(
      `dist/${relPath} 里没有 ${symbol}（F260 之后的产物必须有）—— dist 陈旧，先跑 npm run build`,
    );
    process.exit(2);
  }
  loaded[symbol] = mod[symbol];
}
const { collectTsJsCodeSkeletons } = loaded;

/** mtime 倒挂告警（非致命，见文件头说明）。 */
function newestMtimeMs(dir, exts) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (exts.some((x) => e.name.endsWith(x))) {
        try {
          newest = Math.max(newest, fs.statSync(p).mtimeMs);
        } catch {
          /* 读不到就跳过：这是告警通道，不承重 */
        }
      }
    }
  };
  walk(dir);
  return newest;
}
const srcNewest = newestMtimeMs(path.join(projectRoot, 'src'), ['.ts']);
const distNewest = newestMtimeMs(distDir, ['.js']);
const distStaleWarning = srcNewest > distNewest;
if (distStaleWarning) {
  console.error('⚠ src 的最新 mtime 晚于 dist —— 可能忘了 npm run build（告警，非致命）');
}

const rel = (p) => path.relative(projectRoot, p).split(path.sep).join('/');
const skeletons = await collectTsJsCodeSkeletons(projectRoot, { extractCallSites: true });

// ── 严口径预处理：把注释 / 字符串字面量 / import 语句自身挖空 ──

/**
 * 词法级挖空：注释与字符串 / 模板字面量的**内容**替换为等长空格（保留定界符与偏移）。
 * 不是完整解析器（正则字面量、JSX 文本未处理），故严口径给的是下界。
 */
function blankCommentsAndStrings(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      blank(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      blank(i, end < 0 ? src.length : end + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === '\\') k += 2;
        else if (src[k] === c) break;
        else k++;
      }
      blank(i + 1, k); // 保留定界符本身，便于后续 import 语句正则命中
      i = k + 1;
    } else i++;
  }
  return out.join('');
}

/** 把 import 语句自身与动态 import 的解构头挖空（严口径要扣掉的「自证命中」）。 */
function blankImportSites(src) {
  return src
    .replace(/\bimport\b[\s\S]*?\bfrom\b\s*['"][^'"]*['"]/g, (m) => ' '.repeat(m.length))
    .replace(/\bimport\s+['"][^'"]*['"]/g, (m) => ' '.repeat(m.length))
    .replace(/\bimport\s+\w+\s*=\s*require\s*\([^)]*\)/g, (m) => ' '.repeat(m.length))
    .replace(
      /\{[^{}]*\}\s*=\s*(?:await\s+)?(?:import|require)\s*\([^)]*\)/g,
      (m) => ' '.repeat(m.length),
    );
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWordChar = (c) => c !== undefined && /[\w$]/.test(c);

let importEntriesWithBindings = 0;
let renamedSpecifiers = 0;
let renamedSpecifiersTypeOnly = 0;
const filesWithRenamed = new Set();
const phantomKeys = new Set();
const localNames = new Set();
/** 宽口径（历史口径）：原始文本里 `imported` 名出现 > 1 次。 */
const sameFileNameCollisions = new Set();
/** 严口径：挖掉注释 / 字符串 / import 自身后仍存在同名标识符。 */
const strictCollisions = new Set();
/** `\bNAME\b` 判据对其不成立的名字（W2 已知限制，单列不静默）。 */
const wordBoundaryUnverifiableNames = new Set();

for (const [filePath, sk] of skeletons) {
  const file = rel(filePath);
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  let strictSource = null; // 惰性算：绝大多数文件没有重命名说明符
  for (const imp of sk.imports ?? []) {
    const bindings = imp.namedImportBindings;
    if (!Array.isArray(bindings) || bindings.length === 0) continue;
    importEntriesWithBindings++;
    for (const b of bindings) {
      if (b.imported === b.local) continue;
      renamedSpecifiers++;
      // W3：说明符级没有 isTypeOnly 字段（schema 只有 imported/local），
      // 只能按 import **条目级**判定 —— inline `import { type X as Y }` 因此归值侧。
      if (imp.isTypeOnly === true) renamedSpecifiersTypeOnly++;
      filesWithRenamed.add(file);
      phantomKeys.add(`${file}|${b.imported}`);
      localNames.add(`${file}|${b.local}`);

      const name = b.imported;
      if (isWordChar(name[0]) === false || isWordChar(name[name.length - 1]) === false) {
        wordBoundaryUnverifiableNames.add(`${file}|${name}`);
      }
      const re = () => new RegExp(`\\b${escapeRe(name)}\\b`, 'g');
      // 宽口径（历史口径逐字保留）
      if ((source.match(re())?.length ?? 0) > 1) sameFileNameCollisions.add(`${file}|${name}`);
      // 严口径
      if (strictSource === null) strictSource = blankImportSites(blankCommentsAndStrings(source));
      if ((strictSource.match(re())?.length ?? 0) > 0) strictCollisions.add(`${file}|${name}`);
    }
  }
}

const stats = {
  projectRoot,
  collectedFiles: skeletons.size,
  importEntriesWithBindings,
  renamedSpecifiers,
  renamedSpecifiersTypeOnly,
  renamedSpecifiersValueOnly: renamedSpecifiers - renamedSpecifiersTypeOnly,
  filesWithRenamed: filesWithRenamed.size,
  distinctPhantomKeys: phantomKeys.size,
  distinctLocalNames: localNames.size,
  sameFileNameCollisions: sameFileNameCollisions.size,
  strictCollisions: strictCollisions.size,
  wordBoundaryUnverifiableNames: wordBoundaryUnverifiableNames.size,
  distStaleWarning,
};
console.log(JSON.stringify(stats, null, 2));

// ── 闸 2：全零一律 fail-loud（禁「陈旧 dist 全零 + exit 0」的假绿） ──
if (stats.collectedFiles === 0 || stats.importEntriesWithBindings === 0) {
  console.error(
    'collectedFiles 或 importEntriesWithBindings 为 0 —— 判为陈旧 dist / 采集失效，不当作有效统计',
  );
  process.exit(3);
}
