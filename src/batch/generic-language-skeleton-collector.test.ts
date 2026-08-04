/**
 * generic-language-skeleton-collector 单测（F217 T027）
 *
 * 用 tests/fixtures/graph-quality-java/ 与 tests/fixtures/graph-quality-go/ 真实跑，覆盖：
 * ① 文件发现数量精确断言
 * ② 单文件解析失败（语法错误文件）不影响整体产出
 * ③ 直接实例化 adapter 场景下不依赖 bootstrapRuntime()/LanguageAdapterRegistry
 * ④ 忽略样本：内置忽略目录命中（build/、vendor/）不进入返回的 CodeSkeleton Map；
 *    .gitignore 命中样本按 tracked 状态分轨（F255 起采集面与 git status 观测面同源）——
 *    fixture 内 generated/ 样本因 F253 `git add -f` 入库为 tracked，git 会报告其改动，
 *    故按 tracked 豁免**收录**（in-repo 用例）；untracked+ignored 的真实用户语义
 *    （F253 ④ 号用例的原始意图）迁移到「F255 真实语义锚定」describe 的临时 git 仓库用例
 * ⑤ contains 双轨风险实证复核：用 runGraphQualityChecks 对真实建图产物实测
 *    containsCoverage，断言 Java/Go 无 Python 式双轨 contains 缺口
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
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
    // + generated/StubOnly.java（F253 入库为 tracked → F255 tracked 豁免收录）= 6
    // 排除 build/Generated.java（内置忽略目录，tracked 与否均剪枝）
    expect(skeletons.size).toBe(6);
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
    // 前置守卫：样本须真实存在于磁盘，否则本断言在样本缺失时会空洞通过零信号
    // （F253 根因：该样本此前从未入库，见 fix-report.md）。
    expect(fs.existsSync(path.join(JAVA_FIXTURE_ROOT, 'build/Generated.java'))).toBe(true);
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.includes('build') && k.endsWith('Generated.java'))).toBe(false);
  });

  it('④ .gitignore 命中但已 tracked 的样本（generated/StubOnly.java）按 F255 tracked 豁免进入 skeleton map', async () => {
    // 前置守卫 1：样本须真实存在于磁盘（F253 根因：该样本此前从未入库，见其 fix-report.md）。
    expect(fs.existsSync(path.join(JAVA_FIXTURE_ROOT, 'generated/StubOnly.java'))).toBe(true);
    // 前置守卫 2：样本须处于 tracked 状态——本用例断言的是"tracked 豁免"这半边语义；
    // 若未来有人把样本移出 git 追踪，本守卫 fail-loud，防止正向断言静默倒挂回旧语义。
    expect(() =>
      execFileSync('git', ['ls-files', '--error-unmatch', 'tests/fixtures/graph-quality-java/generated/StubOnly.java'], {
        cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore'],
      }),
    ).not.toThrow();
    const skeletons = await collectGenericLanguageCodeSkeletons(JAVA_FIXTURE_ROOT, [
      new JavaLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    // F255：tracked 文件的改动 git status 会报告 → dirty 观测面可见 → 采集面必须同向收录
    // （untracked+ignored 的"不收录"语义见下方「F255 真实语义锚定」describe）
    expect(keys.some((k) => k.includes('generated') && k.endsWith('StubOnly.java'))).toBe(true);
  });

  it('① Go fixture：文件发现数量精确断言（排除忽略样本）', async () => {
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT, [
      new GoLanguageAdapter(),
    ]);
    // server.go / handler.go / syntax-error.go / server_test.go = 4
    // + generated/stub.go（F253 入库为 tracked → F255 tracked 豁免收录）= 5
    // 排除 vendor/Generated.go（内置忽略目录，tracked 与否均剪枝）
    expect(skeletons.size).toBe(5);
  });

  it('④ Go 内置忽略目录（vendor/）样本不进入 skeleton map；tracked 的 generated/ 样本按 F255 豁免收录', async () => {
    // 前置守卫：两类样本须真实存在于磁盘，否则对应断言在样本缺失时会空洞通过零信号
    // （F253 根因：generated/stub.go 此前从未入库；vendor/Generated.go 已入库仍一并复核）。
    expect(fs.existsSync(path.join(GO_FIXTURE_ROOT, 'vendor/Generated.go'))).toBe(true);
    expect(fs.existsSync(path.join(GO_FIXTURE_ROOT, 'generated/stub.go'))).toBe(true);
    // 前置守卫 2：generated/stub.go 须 tracked（正向断言的语义前提，同 Java ④ 号守卫）。
    expect(() =>
      execFileSync('git', ['ls-files', '--error-unmatch', 'tests/fixtures/graph-quality-go/generated/stub.go'], {
        cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore'],
      }),
    ).not.toThrow();
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT, [
      new GoLanguageAdapter(),
    ]);
    const keys = [...skeletons.keys()];
    // vendor/ 是 Go adapter 内置忽略目录：无论 tracked 与否都按目录名剪枝，不受 F255 影响
    expect(keys.some((k) => k.includes('vendor'))).toBe(false);
    // generated/ 仅被 .gitignore 覆盖：tracked 样本按 F255 tracked 豁免收录
    expect(keys.some((k) => k.includes('generated'))).toBe(true);
  });

  it('默认 adapters 参数为 [Java, Go]（未显式传入时同时采集两种语言）', async () => {
    // 用一个只含 .go 文件的目录验证默认参数至少能识别 Go（Java 目录内无 .go 文件不受影响）
    const skeletons = await collectGenericLanguageCodeSkeletons(GO_FIXTURE_ROOT);
    expect(skeletons.size).toBe(5);
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
    // 其余文件（Processor.java / Status.java / Broken.java / ServiceTest.java
    // + tracked 的 generated/StubOnly.java，F255 豁免收录）仍正常解析
    expect(skeletons.size).toBe(5);
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

/**
 * F255 真实语义锚定：F253 ④ 号用例的原始意图（"`.gitignore` 覆盖的路径不入图"）在
 * untracked 场景下重新锚定。
 *
 * 为什么不能继续用 in-repo fixture 锚定这半边语义：fixture 内 generated/ 样本被 F253
 * `git add -f` 入库后是本仓库的 tracked 文件，F255 起采集面与 git status 观测面同源
 * （tracked 文件的改动 git 会报告 → 必须收录）。真实用户项目里 generated/ 产物是
 * untracked+ignored——把 fixture 复制进临时 git 仓库、全部文件保持 untracked，
 * 才是该场景的忠实模拟（fixture 自带 .gitignore 规则照常生效：git 读取 worktree 内
 * `.gitignore` 不要求其 tracked）。
 */
describe('F255 真实语义锚定：untracked+ignored 样本不进入 skeleton map（临时 git 仓库）', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 把 fixture 目录复制进临时 git 仓库；不做任何 commit，全部文件保持 untracked。 */
  function stageFixtureAsUntrackedRepo(fixtureRoot: string): string {
    const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f255-untracked-'));
    tmpDirs.push(staged);
    fs.cpSync(fixtureRoot, staged, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: staged, stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('git', ['config', 'user.email', 'f255-test@example.com'], { cwd: staged, stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('git', ['config', 'user.name', 'F255 Test'], { cwd: staged, stdio: ['ignore', 'ignore', 'ignore'] });
    return staged;
  }

  it('Java：untracked 的 generated/StubOnly.java 被 .gitignore 覆盖，不进入 skeleton map（F253 原始计数恢复）', async () => {
    const staged = stageFixtureAsUntrackedRepo(JAVA_FIXTURE_ROOT);
    // 前置守卫：样本存在于磁盘且 git 判定其 ignored（check-ignore 对 untracked 文件无需 --no-index）
    expect(fs.existsSync(path.join(staged, 'generated/StubOnly.java'))).toBe(true);
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', 'generated/StubOnly.java'], {
        cwd: staged, stdio: ['ignore', 'ignore', 'ignore'],
      }),
    ).not.toThrow();

    const skeletons = await collectGenericLanguageCodeSkeletons(staged, [new JavaLanguageAdapter()]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.endsWith('StubOnly.java'))).toBe(false);
    // F253 ④ 号用例的原始精确计数在真实语义下恢复：5 个源文件，排除 build/ 与 generated/
    expect(skeletons.size).toBe(5);
  });

  it('Go：untracked 的 generated/stub.go 与 vendor/Generated.go 均不进入 skeleton map', async () => {
    const staged = stageFixtureAsUntrackedRepo(GO_FIXTURE_ROOT);
    expect(fs.existsSync(path.join(staged, 'generated/stub.go'))).toBe(true);
    expect(() =>
      execFileSync('git', ['check-ignore', '-q', 'generated/stub.go'], {
        cwd: staged, stdio: ['ignore', 'ignore', 'ignore'],
      }),
    ).not.toThrow();

    const skeletons = await collectGenericLanguageCodeSkeletons(staged, [new GoLanguageAdapter()]);
    const keys = [...skeletons.keys()];
    expect(keys.some((k) => k.includes('vendor'))).toBe(false);
    expect(keys.some((k) => k.includes('generated'))).toBe(false);
    expect(skeletons.size).toBe(4);
  });
});
