/**
 * F284 — 忽略目录并入采集面事实源（`CollectorPipelineSurface.ignoreDirs`）。
 *
 * 守护三件事：(1) 每个消费方引用的就是事实源上的同一对象（=== 引用同一性，不是内容相等）；
 * (2) 集合内容逐项钉死（任何增删都是行为变更，须按 BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES 的
 * ignore-dirs-pruning 手工 bump）；(3) 源码层：消费方文件里不再有第二份忽略目录字面量表。
 *
 * 运行：npx vitest run tests/unit/collector-surface-ignore-dirs.test.ts
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_PRODUCER_SURFACES,
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PY_WALK_SURFACE,
  PYTHON_ADAPTER_DECLARED_IGNORE_DIRS,
  PYTHON_SYMBOL_SCAN_SURFACE,
  TSJS_ADAPTER_DECLARED_IGNORE_DIRS,
  TSJS_SKELETON_WALK_SURFACE,
  mergeSurfaces,
} from '../../src/collector-surface.js';
import { JavaLanguageAdapter } from '../../src/adapters/java-adapter.js';
import { GoLanguageAdapter } from '../../src/adapters/go-adapter.js';
import { PythonLanguageAdapter } from '../../src/adapters/python-adapter.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { PY_SKELETON_IGNORE_DIRS, TSJS_SKELETON_IGNORE_DIRS } from '../../src/batch/stages/source-discovery.js';
import { GRAPH_COLLECTOR_IGNORE_DIRS } from '../../src/panoramic/graph/quality/ignore-oracle.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sorted = (set: ReadonlySet<string>): string[] => [...set].sort();

describe('F284 · 每条管线都声明 ignoreDirs', () => {
  it('ALL_PRODUCER_SURFACES 六面均带非空 ReadonlySet ignoreDirs', () => {
    expect(ALL_PRODUCER_SURFACES).toHaveLength(6);
    for (const surface of ALL_PRODUCER_SURFACES) {
      expect(surface.ignoreDirs).toBeInstanceOf(Set);
      expect(surface.ignoreDirs.size).toBeGreaterThan(0);
    }
  });

  it('mergeSurfaces 的 ignoreDirs 是并集（= generic collector 对适配器 defaultIgnoreDirs 取并集的既有行为）', () => {
    const merged = mergeSurfaces(JAVA_ADAPTER_SURFACE, GO_ADAPTER_SURFACE);
    expect(sorted(merged.ignoreDirs)).toEqual(sorted(new Set([...JAVA_ADAPTER_SURFACE.ignoreDirs, ...GO_ADAPTER_SURFACE.ignoreDirs])));
  });
});

describe('F284 · 消费方引用同一性（=== 而非内容相等）', () => {
  it('生产者 walk 导出常量 / 适配器 defaultIgnoreDirs 都是事实源上的同一对象', () => {
    expect(TSJS_SKELETON_IGNORE_DIRS).toBe(TSJS_SKELETON_WALK_SURFACE.ignoreDirs);
    expect(PY_SKELETON_IGNORE_DIRS).toBe(PY_WALK_SURFACE.ignoreDirs);
    expect(new JavaLanguageAdapter().defaultIgnoreDirs).toBe(JAVA_ADAPTER_SURFACE.ignoreDirs);
    expect(new GoLanguageAdapter().defaultIgnoreDirs).toBe(GO_ADAPTER_SURFACE.ignoreDirs);
    expect(new PythonLanguageAdapter().defaultIgnoreDirs).toBe(PYTHON_ADAPTER_DECLARED_IGNORE_DIRS);
    expect(new TsJsLanguageAdapter().defaultIgnoreDirs).toBe(TSJS_ADAPTER_DECLARED_IGNORE_DIRS);
  });

  it('ignore-oracle 的 union = TSJS ∪ PY（双向相等；守的是"oracle 别再手抄"，对 SSoT 侧删项由内容钉死用例兜底）；#11 剪枝集 = 声明集 ∪ Python 惯例', () => {
    expect(sorted(GRAPH_COLLECTOR_IGNORE_DIRS)).toEqual(sorted(new Set([...TSJS_SKELETON_WALK_SURFACE.ignoreDirs, ...PY_WALK_SURFACE.ignoreDirs])));
    expect(sorted(PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs)).toEqual(
      sorted(new Set([...PYTHON_ADAPTER_DECLARED_IGNORE_DIRS, 'test', 'tests', 'dist', 'node_modules', '.git'])),
    );
  });
});

describe('F284 · 集合内容逐项钉死（改动 = 行为变更，须 bump BEHAVIOR_VERSION 的 ignore-dirs-pruning 项）', () => {
  it('六面 + 两个适配器声明集的内容与迁移前字面量逐项相同', () => {
    expect(sorted(TSJS_SKELETON_WALK_SURFACE.ignoreDirs)).toEqual(sorted(new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage', 'out', 'target',
      '.next', '.nuxt', '.turbo', '.cache', 'tmp', '.tmp', '__pycache__', '.pytest_cache', '.tox',
    ])));
    expect(sorted(PY_WALK_SURFACE.ignoreDirs)).toEqual(sorted(new Set([
      'node_modules', '.git', '__pycache__', '.venv', 'venv', 'build', 'dist', 'coverage', 'out', 'target', '.tox',
    ])));
    expect(sorted(JAVA_ADAPTER_SURFACE.ignoreDirs)).toEqual(sorted(new Set(['target', 'build', 'out', '.gradle', '.idea', '.settings', '.mvn'])));
    expect(sorted(GO_ADAPTER_SURFACE.ignoreDirs)).toEqual(['vendor']);
    expect(sorted(MODULE_DERIVATION_SCAN_SURFACE.ignoreDirs)).toEqual(sorted(new Set([
      '.git', 'coverage', 'specs', 'dist', 'build', 'out', '.next', '.nuxt', 'vendor', '__pycache__', '.venv', 'venv', 'env',
      'examples', 'example', 'worked', 'fixtures', '__fixtures__', 'testdata', 'test-fixtures', '.cache', '.parcel-cache', '.turbo',
    ])));
    expect(sorted(PYTHON_ADAPTER_DECLARED_IGNORE_DIRS)).toEqual(sorted(new Set(['__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.eggs'])));
    expect(sorted(TSJS_ADAPTER_DECLARED_IGNORE_DIRS)).toEqual(sorted(new Set(['node_modules', 'dist', 'build', '.next', '.nuxt'])));
  });
});

describe('F284 · 源码层：消费方不再有第二份忽略目录字面量', () => {
  it('七个消费方文件里不存在 `IGNORE_DIRS = new Set([` / `defaultIgnoreDirs: ReadonlySet<string> = new Set([` / 手拼 ignoreNames 字面量', () => {
    const consumers = [
      'src/batch/stages/source-discovery.ts',
      'src/panoramic/graph/quality/ignore-oracle.ts',
      'src/adapters/java-adapter.ts',
      'src/adapters/go-adapter.ts',
      'src/adapters/python-adapter.ts',
      'src/adapters/ts-js-adapter.ts',
      'src/utils/file-scanner.ts',
    ];
    // 登记的唯一残留（如实，不改行为）：ignore-oracle 的 GENERIC_UNIVERSAL_IGNORE_DIRS = {node_modules, .git} 只是
    // oracle 对 java/go **文件级**判定的补集。generic walk 对目录调 oracle 走 union 兜底，故 node_modules/ dist/ coverage/
    // 等 GRAPH_COLLECTOR_IGNORE_DIRS 成员**会**被剪（对抗复审 W1 实证，首稿"不按名剪枝"写反）；oracle 文件级比 walk 窄
    // 是漏判方向。要闭合须派生为 JAVA ∪ GRAPH_COLLECTOR_IGNORE_DIRS，属行为变更 → M11；现状由 behavior 测试逐名钉住。
    const registeredResidue = /const GENERIC_UNIVERSAL_IGNORE_DIRS: ReadonlySet<string> = new Set\(\['node_modules', '\.git'\]\);/;
    for (const rel of consumers) {
      const text = fs.readFileSync(path.join(repoRoot, rel), 'utf-8').replace(registeredResidue, '');
      // 只抓以引号字面量开头的表；派生表（`new Set([...A, ...B])`）不算第二份事实源
      expect(/IGNORE_DIRS\s*(?::\s*ReadonlySet<string>)?\s*=\s*new Set\(\[\s*(?:\/\/[^\n]*\n\s*)*'/.test(text), `${rel} 仍有 *_IGNORE_DIRS 字面量`).toBe(false);
      expect(/defaultIgnoreDirs:\s*ReadonlySet<string>\s*=\s*new Set\(\[/.test(text), `${rel} 仍有 defaultIgnoreDirs 字面量`).toBe(false);
      expect(/ignoreNames\s*=\s*new Set\(\[/.test(text), `${rel} 仍手拼 ignoreNames`).toBe(false);
    }
    // 唯一允许的定义点
    const ssot = fs.readFileSync(path.join(repoRoot, 'src/collector-surface.ts'), 'utf-8');
    expect((ssot.match(/IGNORE_DIRS: ReadonlySet<string> = new Set\(\[/g) ?? []).length).toBe(8);
  });
});
