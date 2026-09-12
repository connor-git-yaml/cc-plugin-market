/**
 * F286（承接 F277 FR-010~013）— 新增导出符号生产可达性检查（词法扫描）。
 * 红先行：脚本缺失时 import 失败即红。对抗复审（A-C1 / A-C2 / A-W1~W5）后重写：夹具覆盖多行 import 块、同名碰撞、
 * 自身文件使用、注释提及、CJS / 解构 / 多行导出列表 / const enum、merge-base、基线 == HEAD 三形态。
 */
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeExportReachability, extractExportedNames, classifyLines, renderMarkdown, HONESTY_BOUNDARY } from '../scripts/export-reachability.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../scripts/export-reachability.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f286-reach-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV }).trim();
}
function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
function runCli(args, cwd) {
  return spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
}
const byName = (report) => Object.fromEntries(report.symbols.map((s) => [s.name, s]));

let repo; let baseSha;
before(() => {
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q']);
  write(repo, 'src/a.ts', 'export function existing() { return 1; }\n');
  write(repo, 'src/old-user.ts', "import { existing } from './a.js';\nexport const v = existing();\n");
  // 同名碰撞对照：other.ts 不 import b，自己声明并调用一个 collideOnly（对抗复审 A-C2）
  write(repo, 'src/other.ts', 'function collideOnly() { return 9; }\nexport const o = collideOnly();\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'base']);
  baseSha = git(repo, ['rev-parse', 'HEAD']);
  // 本次改动（工作树未提交）：
  write(repo, 'src/b.ts', [
    'export function newOne() { return 1; }',      // 生产侧真调用 → 不报警（FR-011 阴性对照）
    'export const helperOnly = 1;',                 // 只被测试引用 → 报警
    'export function deadOnly() { return 2; }',     // 只有一行死 import → 报警（import 行不算使用）
    'export function deadMultiImport() { return 4; }', // 只出现在多行 import 块里 → 报警（A-C1）
    'export function refOnly() { return 3; }',      // 非调用引用（赋值）→ 词法层判"有使用"，已知边界
    'export function collideOnly() { return 5; }',  // 他文件同名声明 + 调用但不 import 本文件 → 报警（A-C2）
    'export function commentOnly() { return 6; }',  // 只在 importer 的注释里提到 → 报警（M4 两向钉）
    'function localUser() { return selfUsedOnly(); }', // 自身文件内的非声明行使用 → 计为生产使用（A-W2）
    'export function selfUsedOnly() { return 7; }',
    'export const enum Color { Red }',              // A-W1：抽出的名字必须是 Color 而不是 enum
    'export const { dx, dy } = { dx: 1, dy: 2 };',   // A-W1：解构导出
    'function listA() { return 1; } function listB() { return 2; }',
    'export {',                                     // A-W1：多行本地导出列表
    '  listA,',
    '  listB as listC,',
    '};',
    "export { existing as renamedExisting } from './a.js';", // 再导出：不是本文件的定义，不盘点（登记）
    '',
  ].join('\n'));
  write(repo, 'src/c.ts', [
    "import { newOne, deadOnly, refOnly, listA } from './b.js';",
    'import {',
    '  deadMultiImport,',
    "} from './b.js';",
    '// commentOnly 只在这条注释里出现',
    'const total = newOne() + listA();',
    'const keep = refOnly;',
    'console.log(total, keep);',
    '',
  ].join('\n'));
  // CJS 文件（未跟踪）：exports.x 形态必须被盘点
  write(repo, 'src/cjs-mod.cjs', "exports.cjsHelper = function () { return 1; };\nmodule.exports.cjsSecond = 2;\n");
  write(repo, 'tests/b.test.ts', "import { helperOnly } from '../src/b.js';\nconsole.log(helperOnly);\nexport const testOnlyExport = 1;\n");
  write(repo, 'src/x.test.ts', "import { helperOnly } from './b.js';\nconsole.log(helperOnly);\n");
});

describe('F286 · extractExportedNames / classifyLines（词法层）', () => {
  it('声明式 / 解构 / 多行列表 / const enum / 装饰器前缀 / 同行多语句 / CJS 都能盘点；再导出与 default 别名不盘点', () => {
    const names = extractExportedNames([
      'export const a = 1; export function b() {}',
      '@Injectable() export class Svc {}',
      '/* doc */ export async function c() {}',
      'export function *gen() {}',
      'export const enum Color { Red }',
      'export declare const d: number;',
      'export const { e1, e2: e2alias = 3, ...rest } = obj;',
      'export [', // 非法形态不应抛
      'export {',
      '  l1,',
      '  l2 as l3,',
      '}',
      "export { r1, r2 as r3 } from './x.js';",
      "export * as ns from './y.js';",
      'export default something;',
      'exports.cjs1 = 1;',
      'module.exports.cjs2 = 2;',
      'module.exports = { cjs3, cjs4: fn };',
    ]);
    assert.deepEqual([...names].sort(), ['Color', 'Svc', 'a', 'b', 'c', 'cjs1', 'cjs2', 'cjs3', 'cjs4', 'd', 'e1', 'e2alias', 'gen', 'l1', 'l3', 'rest'].sort());
  });

  it('classifyLines：多行 import 块整块记 import；再导出块记 import 且说明符归 reexport；整行注释与块注释记 comment；require / 动态 import 记 import', () => {
    const { kinds, specifiers, reexportSpecifiers } = classifyLines([
      'import {',
      '  a,',
      "} from './m.js';",
      "export { z } from './n.js';",
      "const r = require('./p.cjs');",
      "const d = await import('./q.js');",
      '/* 块注释',
      '   续行 */',
      '// 行注释',
      'const use = a + z;',
    ]);
    assert.deepEqual(kinds, ['import', 'import', 'import', 'import', 'import', 'import', 'comment', 'comment', 'comment', 'code']);
    assert.deepEqual(specifiers, ['./m.js', './p.cjs', './q.js']);
    assert.deepEqual(reexportSpecifiers, ['./n.js']);
  });
});

describe('F286 · analyzeExportReachability（判据）', () => {
  it('真调用不报警 / 仅测试引用 / 单行死 import / 多行死 import / 同名不 import / 注释提及 → 报警；自身文件使用计入；赋值引用判有使用', () => {
    const report = analyzeExportReachability({ projectRoot: repo, baseRef: baseSha });
    const s = byName(report);
    assert.equal(s.newOne.warning, false); assert.equal(s.newOne.productionUseCount, 1);
    assert.equal(s.helperOnly.warning, true); assert.equal(s.helperOnly.testUseCount, 2, '两个测试文件（tests/ 与 *.test.ts）都计');
    assert.equal(s.deadOnly.warning, true); assert.equal(s.deadOnly.productionImportCount, 1);
    assert.equal(s.deadMultiImport.warning, true, '多行 import 块里的裸标识符行不是使用（A-C1）');
    assert.equal(s.deadMultiImport.productionImportCount, 1);
    assert.equal(s.collideOnly.warning, true, 'other.ts 不 import b：同名声明与调用与本符号无关（A-C2）');
    assert.equal(s.commentOnly.warning, true, '注释里提到不算使用');
    assert.equal(s.selfUsedOnly.warning, false, '定义文件自身的非声明行使用计入（A-W2）');
    assert.equal(s.refOnly.warning, false, '赋值引用在词法层不可与调用区分（FR-012 已登记）');
    assert.equal(s.listA.warning, false); assert.equal(s.listC.warning, true);
    assert.ok(s.Color && s.dx && s.dy, 'const enum 与解构导出被盘点');
    assert.equal(s.Color.warning, true);
    assert.ok(!('renamedExisting' in s), '再导出不是本文件的定义，不盘点');
    assert.ok(!('testOnlyExport' in s), '测试文件的新增导出不进盘点（M10）');
    assert.ok(s.cjsHelper && s.cjsSecond, 'CJS exports.x / module.exports.x 被盘点');
    assert.equal(s.cjsHelper.warning, true);
    assert.equal(report.honestyBoundary, HONESTY_BOUNDARY);
  });

  it('契约字段（FR-010）：baseRef / baseSha / mergeBase / head / compareCommands / scope 齐全；changedFiles 来自比较命令原始输出；--scope 无尾斜杠按前缀目录处理', () => {
    const report = analyzeExportReachability({ projectRoot: repo, baseRef: baseSha, scope: ['src'] });
    assert.equal(report.contract.baseRef, baseSha);
    assert.equal(report.contract.baseSha, baseSha);
    assert.equal(report.contract.mergeBase, baseSha);
    assert.deepEqual(report.contract.scope, ['src/']);
    assert.ok(report.contract.compareCommands.some((c) => c.startsWith(`git diff --name-only ${baseSha}`)));
    assert.ok(report.contract.compareCommands.includes('git ls-files --others --exclude-standard'));
    assert.ok(report.rawOutputs.untrackedFiles.includes('src/b.ts'));
    assert.deepEqual(report.changedFiles, ['src/b.ts', 'src/c.ts', 'src/cjs-mod.cjs']);
    assert.ok(report.contract.warnings.some((w) => w.includes('等于 HEAD')), '基线 == HEAD 但树脏：合法形态，契约块打 WARN');
  });

  it('baseRef 缺席 → 抛错（库函数层同样禁止默认值，M2b）', () => {
    assert.throws(() => analyzeExportReachability({ projectRoot: repo }), /baseRef 是契约字段/);
  });

  it('merge-base：master 领先分支时以 merge-base 为基线，master 上新加的导出不算本分支新增（A-W3）', () => {
    const r2 = path.join(tmp, 'repo-mb');
    fs.mkdirSync(r2); git(r2, ['init', '-q', '-b', 'master']);
    write(r2, 'src/m.ts', 'export const m0 = 0;\n'); git(r2, ['add', '-A']); git(r2, ['commit', '-q', '-m', 'base']);
    git(r2, ['checkout', '-q', '-b', 'feat']);
    write(r2, 'src/f.ts', 'export const featOnly = 1;\n'); git(r2, ['add', '-A']); git(r2, ['commit', '-q', '-m', 'feat']);
    git(r2, ['checkout', '-q', 'master']);
    write(r2, 'src/m.ts', 'export const m0 = 0;\nexport const keepMe = 1;\nconst use = keepMe;\n'); git(r2, ['add', '-A']); git(r2, ['commit', '-q', '-m', 'master ahead']);
    git(r2, ['checkout', '-q', 'feat']);
    const report = analyzeExportReachability({ projectRoot: r2, baseRef: 'master' });
    const names = report.symbols.map((s) => s.name);
    assert.deepEqual(names, ['featOnly']);
    assert.ok(!names.includes('keepMe'), 'master 领先的导出不是本分支新增');
    assert.equal(report.contract.mergeBase, git(r2, ['merge-base', 'master', 'feat']));
  });

  it('零新增导出符号：结论紧跟产生它的命令与原始输出（无命令的空集不构成通过，M11）', () => {
    const r3 = path.join(tmp, 'repo-zero');
    fs.mkdirSync(r3); git(r3, ['init', '-q']);
    write(r3, 'src/z.ts', 'export const z = 1;\n'); git(r3, ['add', '-A']); git(r3, ['commit', '-q', '-m', 'base']);
    const base = git(r3, ['rev-parse', 'HEAD']);
    write(r3, 'src/z.ts', 'export const z = 2;\n');   // 只改值：不算新增
    const report = analyzeExportReachability({ projectRoot: r3, baseRef: base });
    assert.deepEqual(report.symbols, []);
    const md = renderMarkdown(report);
    const at = md.indexOf('### 结论：零新增导出符号');
    assert.ok(at > 0);
    assert.equal(md.slice(at).split('\n')[1], '```');
    assert.equal(md.slice(at).split('\n')[2], `$ git diff --name-only ${base}`, '原始输出块紧跟结论标题');
    assert.ok(md.includes('src/z.ts'), '原始输出照抄');
    assert.ok(md.includes(HONESTY_BOUNDARY));
  });
});

describe('F286 · CLI', () => {
  it('--base 缺席 → exit 2 并点名契约字段；--base 后接 flag 视为缺值 → exit 2', () => {
    const r = runCli(['--project-root', repo], repo);
    assert.equal(r.status, 2); assert.match(r.stderr, /--base <ref> 是契约字段/);
    const r2 = runCli(['--project-root', repo, '--base', '--format', 'json'], repo);
    assert.equal(r2.status, 2); assert.match(r2.stderr, /--base 缺值/);
  });

  it('基线解析 == HEAD 且工作树干净 → exit 2（空集静默通过面，A-W5）；--allow-head 放行；树脏时只打 WARN', () => {
    const r4 = path.join(tmp, 'repo-head');
    fs.mkdirSync(r4); git(r4, ['init', '-q']);
    write(r4, 'src/h.ts', 'export const h = 1;\n'); git(r4, ['add', '-A']); git(r4, ['commit', '-q', '-m', 'base']);
    const clean = runCli(['--project-root', r4, '--base', 'HEAD'], r4);
    assert.equal(clean.status, 2); assert.match(clean.stderr, /等于 HEAD/);
    const allowed = runCli(['--project-root', r4, '--base', 'HEAD', '--allow-head'], r4);
    assert.equal(allowed.status, 0); assert.ok(allowed.stdout.includes('零新增导出符号'));
    const dirty = runCli(['--project-root', repo, '--base', baseSha], repo);
    assert.equal(dirty.status, 0); assert.ok(dirty.stdout.includes('⚠️ 基线解析后等于 HEAD'));
  });

  it('md 输出含契约块、处置表骨架（三支 + 落点列）与诚实口径；--format json 可解析且同源；--fail-on-warning 有报警时 exit 1', () => {
    const md = runCli(['--project-root', repo, '--base', baseSha], repo);
    assert.equal(md.status, 0);
    assert.ok(md.stdout.includes('### 契约字段'));
    assert.ok(md.stdout.includes('| 符号 | 处置（接线遗漏 / 有意的预留 / 应删除） | 落点（接线位置 / 延期承诺任务 ID + Phase / 删除动作） | 理由 |'), '处置表表头三支 + 落点列逐字');
    assert.ok(md.stdout.includes('| `helperOnly` |  |  |  |'), '每条报警一行骨架');
    assert.ok(md.stdout.includes(`> ${HONESTY_BOUNDARY}`));
    const json = runCli(['--project-root', repo, '--base', baseSha, '--format', 'json'], repo);
    assert.equal(json.status, 0);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.honestyBoundary, HONESTY_BOUNDARY);
    assert.deepEqual(parsed.warnings.map((w) => w.name).sort(), ['Color', 'cjsHelper', 'cjsSecond', 'collideOnly', 'commentOnly', 'deadMultiImport', 'deadOnly', 'dx', 'dy', 'helperOnly', 'listC'].sort());
    const gated = runCli(['--project-root', repo, '--base', baseSha, '--fail-on-warning'], repo);
    assert.equal(gated.status, 1);
    const bad = runCli(['--project-root', repo, '--base', baseSha, '--format', 'yaml'], repo);
    assert.equal(bad.status, 2);
  });
});
