/**
 * generic-language-skeleton-collector 单测（F217 T027）
 *
 * 用 tests/fixtures/graph-quality-java/ 与 tests/fixtures/graph-quality-go/ 真实跑，覆盖：
 * ① 文件发现数量精确断言
 * ② 单文件解析失败（语法错误文件）不影响整体产出
 * ③ 直接实例化 adapter 场景下不依赖 bootstrapRuntime()/LanguageAdapterRegistry
 * ④ 忽略样本（内置忽略目录命中 + .gitignore 命中）均不进入返回的 CodeSkeleton Map
 * ⑤ contains 双轨风险实证复核：用 runGraphQualityChecks 对真实建图产物实测
 *    containsCoverage，断言 Java/Go 无 Python 式双轨 contains 缺口
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { collectGenericLanguageCodeSkeletons } from './generic-language-skeleton-collector.js';
import { JavaLanguageAdapter } from '../adapters/java-adapter.js';
import { GoLanguageAdapter } from '../adapters/go-adapter.js';
import type { LanguageAdapter } from '../adapters/language-adapter.js';
import { LanguageAdapterRegistry } from '../adapters/language-adapter-registry.js';
import { buildUnifiedGraph } from '../knowledge-graph/index.js';
import { buildKnowledgeGraph } from '../panoramic/graph/graph-builder.js';
import { runGraphQualityChecks } from '../panoramic/graph/quality/quality-engine.js';

const JAVA_FIXTURE_ROOT = path.join(process.cwd(), 'tests/fixtures/graph-quality-java');
const GO_FIXTURE_ROOT = path.join(process.cwd(), 'tests/fixtures/graph-quality-go');

describe('collectGenericLanguageCodeSkeletons', () => {
  it('③ 未 bootstrap LanguageAdapterRegistry 时仍能正常采集（不依赖 registry）', async () => {
    LanguageAdapterRegistry.resetInstance();
    try {
      expect(LanguageAdapterRegistry.getInstance().isEmpty()).toBe(true);
      const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
        new JavaLanguageAdapter(),
      ]);
      expect(skeletons.size).toBeGreaterThan(0);
    } finally {
      LanguageAdapterRegistry.resetInstance();
    }
  });

  it('① Java fixture：文件发现数量精确断言（排除忽略样本）', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    // Service.java / Processor.java / Status.java / Broken.java / ServiceTest.java = 5
    // 排除 build/Generated.java（内置忽略目录）与 generated/StubOnly.java（.gitignore）
    expect(skeletons.size).toBe(5);
  });

  it('② 语法错误文件（Broken.java）不影响整体产出：其余文件正常解析', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const serviceEntry = [...skeletons.entries()].find(([p]) => p.endsWith('Service.java'));
    expect(serviceEntry).toBeDefined();
    const [, serviceSkeleton] = serviceEntry!;
    expect(serviceSkeleton.exports.some((e) => e.name === 'Service')).toBe(true);
  });

  it('④ 内置忽略目录命中样本（build/Generated.java）不进入 skeleton map', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.includes('build') && k.endsWith('Generated.java'))).toBe(false);
  });

  it('④ .gitignore 命中样本（generated/StubOnly.java）不进入 skeleton map', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.includes('generated') && k.endsWith('StubOnly.java'))).toBe(false);
  });

  it('① Go fixture：文件发现数量精确断言（排除忽略样本）', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT, [
      new GoLanguageAdapter(),
    ]);
    // server.go / handler.go / syntax-error.go / server_test.go = 4
    // 排除 vendor/Generated.go（内置忽略目录）与 generated/stub.go（.gitignore）
    expect(skeletons.size).toBe(4);
  });

  it('④ Go 内置忽略目录（vendor/）与 .gitignore（generated/）样本均不进入 skeleton map', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT, [
      new GoLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.includes('vendor'))).toBe(false);
    expect(keys.some((k) => k.includes('generated'))).toBe(false);
  });

  it('默认 adapters 参数为 [Java, Go]（未显式传入时同时采集两种语言）', async () => {
    // 用一个只含 .go 文件的目录验证默认参数至少能识别 Go（Java 目录内无 .go 文件不受影响）
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT);
    expect(skeletons.size).toBe(4);
  });

  it('⑥（FIX-9a，Codex 对抗审查）单文件真实抛错（mock adapter.analyzeFile）不影响整体产出：其余文件正常进入返回的 Map', async () => {
    // 既有②号用例的 Broken.java 因 tree-sitter 有错误恢复能力被"容错解析"，
    // 根本没走到 catch(){} 分支——本用例用 mock adapter 让特定文件的 analyzeFile
    // 真实抛错，直接覆盖 collectGenericLanguageCodeSkeletons 内 catch 分支的
    // "单文件失败不影响整体"契约。
    const realAdapter = new JavaLanguageAdapter();
    const throwingAdapter: LanguageAdapter = {
      id: realAdapter.id,
      languages: realAdapter.languages,
      extensions: realAdapter.extensions,
      defaultIgnoreDirs: realAdapter.defaultIgnoreDirs,
      analyzeFile: (filePath, options) => {
        if (filePath.endsWith('Service.java')) {
          return Promise.reject(new Error('mock analyzeFile failure for Service.java'));
        }
        return realAdapter.analyzeFile(filePath, options);
      },
      analyzeFallback: (filePath) => realAdapter.analyzeFallback(filePath),
      getTerminology: () => realAdapter.getTerminology(),
      getTestPatterns: () => realAdapter.getTestPatterns(),
    };

    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [throwingAdapter]);

    // Service.java 因 mock 抛错被 catch 吞掉，不进入返回的 map
    expect([...skeletons.keys()].some((k) => k.endsWith('Service.java'))).toBe(false);
    // 其余文件（Processor.java / Status.java / Broken.java / ServiceTest.java）仍正常解析
    expect(skeletons.size).toBe(4);
    expect([...skeletons.keys()].some((k) => k.endsWith('Processor.java'))).toBe(true);
  });

  it('⑤ contains 双轨风险实证复核：Java/Go 真实建图后 containsCoverage 100%（无 Python 式双轨缺口）', async () => {
    const javaSkeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const goSkeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT, [
      new GoLanguageAdapter(),
    ]);
    const combined = new Map([...javaSkeletons, ...goSkeletons]);
    const unifiedGraph = buildUnifiedGraph({ projectRoot: '/combined', codeSkeletons: combined });
    const graphJson = buildKnowledgeGraph({ unifiedGraph });

    const result = runGraphQualityChecks(graphJson, {
      isIgnored: () => false,
      getTestPatterns: () => null,
    });

    expect(result.containsCoverage.status).toBe('pass');
    expect(result.containsCoverage.ratio).toBe(1);
    expect(result.containsCoverage.uncoveredIds).toEqual([]);
  });
});
