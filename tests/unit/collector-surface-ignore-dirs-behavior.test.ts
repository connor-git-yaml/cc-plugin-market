/**
 * F284 对抗复审 W2（SSoT 角）：引用同一性 + 内容钉死 + 源码扫描三道守卫对「派生表」形态零守护力
 * （scanPyFiles 拷贝后多剪 `src` / javaIgnoreDirs 丢通用集 / file-scanner 派生时过滤掉三项 / TSJS 集派生时
 * 多剪 `lib`——四组变异在既有 82 用例下全绿）。本文件改用**行为哨兵**：对每个消费方，把事实源里出现过的
 * 每个目录名与一组对照名（src / lib / app / pkg / __ctrl__）各放一个探针文件，正反两向逐名断言
 * 「该剪的真剪了、不该剪的真采了」——任何派生偏差都在这里翻红，而不是靠 regex 抓源码形态。
 *
 * 各消费方的**有效**剪枝集是按实证钉的（不是按 fix-report 首稿的推演）：
 *   - #1 / #2 walk：各自 surface.ignoreDirs ∪ 点前缀目录；
 *   - #11 scanPyFiles：PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs ∪ 点前缀目录（实证：.next/.gradle 等不在集合内的点目录同样被剪）；
 *   - #3 generic（java/go）：dot ∪ JAVA ∪ GO 适配器声明集 ∪ oracle 对**目录路径**的 union 兜底
 *     （GRAPH_COLLECTOR_IGNORE_DIRS）——这就是 fix-report 首稿写反的那条：`node_modules/` 下的 java/go
 *     **会**被剪（经 oracle 兜底），不是"不按名剪枝"；
 *   - #7/#8 file-scanner：MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs ∪ registry 各适配器声明集；
 *   - oracle 按扩展名分派：.ts→#1 集、.py→#2 集（无 #11 分支：既有，M11）、.java/.go→适配器集 ∪ {node_modules,.git}、
 *     其它→union。
 *
 * 运行：npx vitest run tests/unit/collector-surface-ignore-dirs-behavior.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PY_WALK_SURFACE,
  PYTHON_ADAPTER_DECLARED_IGNORE_DIRS,
  PYTHON_SYMBOL_SCAN_SURFACE,
  TSJS_ADAPTER_DECLARED_IGNORE_DIRS,
  TSJS_SKELETON_WALK_SURFACE,
} from '../../src/collector-surface.js';
import { GRAPH_COLLECTOR_IGNORE_DIRS, createIgnoreOracle } from '../../src/panoramic/graph/quality/ignore-oracle.js';
import { walkPyFiles, walkTsJsFiles } from '../../src/batch/stages/source-discovery.js';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { collectGenericLanguageCodeSkeletons } from '../../src/batch/generic-language-skeleton-collector.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';

const CONTROL = ['src', 'lib', 'app', 'pkg', '__ctrl__'] as const;
const union = (...sets: ReadonlySet<string>[]): Set<string> => new Set(sets.flatMap((s) => [...s]));
/** 事实源里出现过的全部目录名（六面 + 两个声明集），是每个消费方都要逐名探测的输入域。 */
const ALL_NAMES = [...union(
  TSJS_SKELETON_WALK_SURFACE.ignoreDirs, PY_WALK_SURFACE.ignoreDirs, JAVA_ADAPTER_SURFACE.ignoreDirs, GO_ADAPTER_SURFACE.ignoreDirs,
  MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs, PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs,
  PYTHON_ADAPTER_DECLARED_IGNORE_DIRS, TSJS_ADAPTER_DECLARED_IGNORE_DIRS,
)].sort();
const PROBE_NAMES = [...ALL_NAMES, ...CONTROL];
const sanitize = (name: string): string => name.replace(/[^A-Za-z0-9]/g, '_');

let root = '';
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'f284-ignore-behavior-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function stage(fileName: string, body: (name: string) => string): void {
  for (const name of PROBE_NAMES) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, fileName), body(name));
  }
}
const rel = (p: string): string => (path.isAbsolute(p) ? path.relative(root, p) : p).split(path.sep).join('/');
/** 逐名对照表：{ name → 是否被采集 }，让失败信息直接点名哪个目录判错。 */
function collectedTable(collectedNames: ReadonlySet<string>): Record<string, boolean> {
  return Object.fromEntries(PROBE_NAMES.map((name) => [name, collectedNames.has(name)]));
}
function expectedTable(pruned: (name: string) => boolean): Record<string, boolean> {
  return Object.fromEntries(PROBE_NAMES.map((name) => [name, !pruned(name)]));
}

describe('F284 · 行为哨兵：每个消费方的有效剪枝集 = 事实源派生集（正反两向逐名）', () => {
  it('ignore-oracle 按扩展名分派：.ts→#1 / .py→#2 / .java|.go→适配器集∪{node_modules,.git} / 其它→union', () => {
    const oracle = createIgnoreOracle(root);
    const cases: Array<[string, ReadonlySet<string>]> = [
      ['probe.ts', TSJS_SKELETON_WALK_SURFACE.ignoreDirs],
      ['probe.py', PY_WALK_SURFACE.ignoreDirs],
      ['Probe.java', union(JAVA_ADAPTER_SURFACE.ignoreDirs, new Set(['node_modules', '.git']))],
      ['probe.go', union(GO_ADAPTER_SURFACE.ignoreDirs, new Set(['node_modules', '.git']))],
      ['probe.xyz', GRAPH_COLLECTOR_IGNORE_DIRS],
    ];
    for (const [file, set] of cases) {
      const actual = Object.fromEntries(PROBE_NAMES.map((name) => [name, oracle.isIgnored(`${name}/${file}`)]));
      const expected = Object.fromEntries(PROBE_NAMES.map((name) => [name, set.has(name)]));
      expect(actual, file).toEqual(expected);
    }
    // W1 钉：java/go 文件在 node_modules/ 下判 ignored（oracle 对 generic 的通用集）
    expect(oracle.isIgnored('node_modules/x.java')).toBe(true);
    expect(oracle.isIgnored('node_modules/x.go')).toBe(true);
    // W3 登记（既有）：#11 独有的剪枝名对 .py 不判 ignored（oracle 无 #11 分支），#2 独有的照判
    expect(oracle.isIgnored('.mypy_cache/x.py')).toBe(false);
    expect(oracle.isIgnored('coverage/x.py')).toBe(true);
  });

  it('#1 walkTsJsFiles：剪 TSJS_SKELETON_WALK_SURFACE.ignoreDirs ∪ 点前缀，对照名全采', () => {
    stage('probe.ts', (name) => `export const v_${sanitize(name)} = 1;\n`);
    const out: string[] = [];
    walkTsJsFiles(root, out, () => false, root);
    const collected = new Set(out.map(rel).map((p) => p.split('/')[0] ?? ''));
    expect(collectedTable(collected)).toEqual(expectedTable((n) => TSJS_SKELETON_WALK_SURFACE.ignoreDirs.has(n) || n.startsWith('.')));
  });

  it('#2 walkPyFiles：剪 PY_WALK_SURFACE.ignoreDirs ∪ 点前缀，对照名全采', () => {
    stage('probe.py', (name) => `def fn_${sanitize(name)}_z():\n    pass\n`);
    const out: string[] = [];
    walkPyFiles(root, out, () => false, root);
    const collected = new Set(out.map(rel).map((p) => p.split('/')[0] ?? ''));
    expect(collectedTable(collected)).toEqual(expectedTable((n) => PY_WALK_SURFACE.ignoreDirs.has(n) || n.startsWith('.')));
  });

  it('#11 PythonLanguageAdapter.scanPyFiles（经 extractSymbolNodes）：剪 PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs ∪ 点前缀，对照名全采', async () => {
    stage('probe.py', (name) => `def fn_${sanitize(name)}_z():\n    pass\n`);
    const text = JSON.stringify(await new PythonLanguageAdapter().extractSymbolNodes(root));
    const collected = new Set(PROBE_NAMES.filter((name) => text.includes(`fn_${sanitize(name)}_z`)));
    expect(collectedTable(collected)).toEqual(expectedTable((n) => PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs.has(n) || n.startsWith('.')));
  });

  it('#3 generic（java/go）：剪 点前缀 ∪ JAVA ∪ GO 声明集 ∪ oracle 目录级 union 兜底（GRAPH_COLLECTOR_IGNORE_DIRS）', async () => {
    stage('Probe.java', (name) => `public class Probe { public void run_${sanitize(name)}() {} }\n`);
    for (const name of PROBE_NAMES) fs.writeFileSync(path.join(root, name, 'probe.go'), `package probe\n\nfunc Run_${sanitize(name)}() {}\n`);
    const skeletons = await collectGenericLanguageCodeSkeletons(root);
    const collected = new Set([...skeletons.keys()].map(rel).map((p) => p.split('/')[0] ?? ''));
    const pruned = (n: string): boolean =>
      n.startsWith('.') || JAVA_ADAPTER_SURFACE.ignoreDirs.has(n) || GO_ADAPTER_SURFACE.ignoreDirs.has(n) || GRAPH_COLLECTOR_IGNORE_DIRS.has(n);
    expect(collectedTable(collected)).toEqual(expectedTable(pruned));
  });

  it('#7/#8 file-scanner.scanFiles：剪 MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs ∪ registry 四适配器声明集，对照名全采', () => {
    // file-scanner 的通用忽略集从 registry 取各适配器声明集（未注册即抛：fail-loud 方向对）
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    stage('probe.ts', (name) => `export const v_${sanitize(name)} = 1;\n`);
    const collected = new Set(scanFiles(root).files.map(rel).map((p) => p.split('/')[0] ?? ''));
    const registry = union(TSJS_ADAPTER_DECLARED_IGNORE_DIRS, PYTHON_ADAPTER_DECLARED_IGNORE_DIRS, JAVA_ADAPTER_SURFACE.ignoreDirs, GO_ADAPTER_SURFACE.ignoreDirs);
    expect(collectedTable(collected)).toEqual(expectedTable((n) => MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs.has(n) || registry.has(n)));
    LanguageAdapterRegistry.resetInstance();
  });
});
