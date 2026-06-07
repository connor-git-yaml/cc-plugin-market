/**
 * F175 Phase 1 [RED] — Batch Incremental Wrapper E2E
 *
 * 沿用 tests/e2e/batch-pipeline.e2e.test.ts 范式：
 *   vi.hoisted(mockCreate) → vi.mock('@anthropic-ai/sdk') → ANTHROPIC_API_KEY
 *   → bootstrapAdapters() → mkdtempSync 临时项目 + git init → 多轮 runBatch。
 *
 * 本文件 9 个场景在 Phase 1 全部预期 RED，RED 来源分两类（均为"功能未实现"，非 crash）：
 *   (A) batchResult.deltaReport 对象未暴露在 BatchResult 上（现状只有 deltaReportPath 文件路径）
 *       → 任何 deltaReport.{mode,directChanges,...} 断言因 undefined 失败。
 *   (B) 默认未翻转（runBatch incremental 默认 false）+ --full option 未实现
 *       → 默认轮不走 DeltaRegenerator、full 逃生口/孤儿删除/checkpoint 交互均未生效。
 *
 * GREEN 阶段（T013-T028）让上述功能落地后这些断言转绿，不在 Phase 1 触碰生产代码。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { join, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

import type { DeltaReport } from '../../src/batch/delta-regenerator.js';
import type { BatchResult, BatchOptions } from '../../src/batch/batch-orchestrator.js';
import { saveCheckpoint, loadCheckpoint } from '../../src/batch/checkpoint.js';
import type { BatchState } from '../../src/models/module-spec.js';

// ─── LLM Mock（hoisting 要求：必须在模块顶层声明）───────────────────────────
const mocks = vi.hoisted(() => {
  const mockSpecMarkdown = `
## 1. 意图

F175 E2E mock 模块，用于验证增量 batch 的重生成范围与产物稳定性。

## 2. 业务逻辑

模块导出若干纯函数，便于 AST skeleton-hash 比对。

## 3. 接口定义

| 名称 | 类型 | 签名 |
|------|------|------|
| run | function | (n: number) => number |

## 4. 数据结构

无复杂数据结构。

## 5. 约束条件

输入为有限数值。

## 6. 边界条件

n=0 时返回 0。

## 7. 技术债务

无。

## 8. 测试覆盖

基础覆盖。

## 9. 依赖关系

见 import 语句。
`.trim();

  const mockCreate = vi.fn().mockResolvedValue({
    id: 'msg_f175_mock',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: mockSpecMarkdown }],
    model: 'claude-sonnet-4-6-20261001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });

  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
}));

// ─── 类型辅助 ──────────────────────────────────────────────────────────────
// BatchResult 现状无 deltaReport 对象字段（仅 deltaReportPath 文件路径）。
// 用扩展类型读取，使 RED 表现为"运行时 undefined 断言失败"而非编译期错误，
// 不破坏 npm run build（GREEN T016 才在 BatchResult 上新增 deltaReport）。
type BatchResultWithDelta = BatchResult & { deltaReport?: DeltaReport };

// BatchOptions 现状无 full 字段（GREEN T016 才新增）。同样用扩展类型避免编译错误。
type BatchOptionsWithFull = BatchOptions & { full?: boolean };

const COMMON_OPTS: BatchOptions = {
  enableDebtIntelligence: false,
  generateHtml: false,
  enableAdr: false,
  progressMode: 'silent',
};

// ─── 临时项目构造工具 ────────────────────────────────────────────────────────

interface TempProject {
  root: string;
  /** 写入/覆盖一个源文件（路径相对 root） */
  write(relPath: string, content: string): void;
  /** 删除一个源文件 */
  remove(relPath: string): void;
  /** 该 project 的 modules 输出目录 */
  modulesDir(): string;
}

const activeRoots: string[] = [];

function makeTempProject(): TempProject {
  const root = mkdtempSync(join(tmpdir(), 'spectra-f175-'));
  activeRoots.push(root);

  const write = (relPath: string, content: string): void => {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  };

  // 最小 tsconfig + package.json，使适配器把它识别为 TS 项目
  write('package.json', JSON.stringify({ name: 'f175-fixture', version: '0.0.0' }, null, 2));
  write(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext' }, include: ['src'] }, null, 2),
  );

  return {
    root,
    write,
    remove: (relPath: string): void => {
      const abs = join(root, relPath);
      if (existsSync(abs)) rmSync(abs);
    },
    modulesDir: (): string => join(root, 'specs', 'modules'),
  };
}

function gitInit(root: string): void {
  // git init + 一个 baseline commit，贴合 batch-pipeline 范式与 EC-006 真实项目语义。
  // 注：DeltaRegenerator 的变更感知基于 AST skeleton-hash，不依赖 git diff；
  // git 仅用于让临时目录成为真实仓库，避免与上层工具的隐式假设冲突。
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  run(['init']);
  run(['config', 'user.email', 'f175@test.local']);
  run(['config', 'user.name', 'F175 Test']);
  run(['add', '-A']);
  run(['commit', '-m', 'baseline']);
}

async function runBatchOn(root: string, opts: BatchOptionsWithFull = {}): Promise<BatchResultWithDelta> {
  const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
  const result = await runBatch(root, { ...COMMON_OPTS, ...(opts as BatchOptions) });
  return result as BatchResultWithDelta;
}

/**
 * 列出 modules 目录下所有【模块级】*.spec.md 的 { name → mtimeMs }。
 *
 * 排除 `_` 前缀的项目级聚合文件（如 `_index.spec.md`）——它属于项目级聚合层，
 * 每轮 batch 无条件重写（OQ-5 决议：SC-002 门禁口径仅为"无模块级 LLM 调用"，
 * 项目级聚合开销不纳入 FR-005 module-level mtime 稳定性断言）。沿用仓库 README 逻辑
 * 对 `_` 前缀文件的同一区分约定。
 */
function specMtimes(modulesDir: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(modulesDir)) return out;
  for (const entry of readdirSync(modulesDir)) {
    if (entry.endsWith('.spec.md') && !entry.startsWith('_')) {
      out.set(entry, statSync(join(modulesDir, entry)).mtimeMs);
    }
  }
  return out;
}

// 一个会随版本变化的源文件内容生成器（改变函数体 → skeleton-hash 变化）
function srcModule(exportName: string, body: string, imports = ''): string {
  return `${imports}export function ${exportName}(n: number): number {\n  ${body}\n}\n`;
}

/**
 * 读取并归一化 graph.json，剥除每次运行必变的非确定性字段，供 byte-stable deepEqual 比较。
 *
 * 剥除项：
 *   - graph.generatedAt：F179 修复后，batch-orchestrator 已传 { stripTimestamps: true }，
 *     落盘侧固定为 epoch '1970-01-01T00:00:00.000Z'（真 byte-stable）。此处 delete 保留
 *     作防御兜底，对固定 epoch 的 delete 是幂等操作，不影响断言语义。
 *   - graph.inputHash：含 docGraph 派生内容，full vs incremental 两路语义等价时应一致，
 *     但保守起见不纳入断言核心（仍保留，下方仅显式剥 generatedAt + currentRun 类运行态字段）。
 *   - 节点 metadata.currentRun（C-1）：本轮运行态字段，已由 normalizeGraphForWrite 在写盘前剥除，
 *     此处兜底再剥一次，确保即便实现回归测试也能定位差异。
 */
function readNormalizedGraph(root: string): Record<string, unknown> {
  const graphPath = join(root, 'specs', '_meta', 'graph.json');
  const raw = JSON.parse(readFileSync(graphPath, 'utf-8')) as Record<string, unknown>;
  const graphMeta = raw['graph'] as Record<string, unknown> | undefined;
  if (graphMeta) {
    delete graphMeta['generatedAt'];
  }
  const nodes = raw['nodes'] as Array<{ metadata?: Record<string, unknown> }> | undefined;
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (node.metadata && typeof node.metadata === 'object') {
        delete node.metadata['currentRun'];
      }
    }
  }
  return raw;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

// 每个场景跑 1-2 次真实 batch（含首轮 transformers.js embedding 模型加载，可能 10s+），
// 默认 5000ms testTimeout 偏紧，套件级放宽至 60s（仅 timeout 调整，不改断言语义）。
describe('F175 Batch Incremental Wrapper E2E（10 场景）', { timeout: 60_000 }, () => {
  // W-3：保存并在 afterAll 恢复 ANTHROPIC_API_KEY，避免污染同进程其他测试
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    savedApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key-f175';
    const { bootstrapAdapters } = await import('../../src/adapters/index.js');
    bootstrapAdapters();
  });

  beforeEach(() => {
    mocks.mockCreate.mockClear();
  });

  afterAll(() => {
    if (savedApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedApiKey;
    for (const root of activeRoots) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  // ── 场景 1 [US1]：改 1 文件 → 仅受影响模块重生成 ──────────────────────────
  it('场景1 [US1] 改 a → 仅 a + 依赖 a 的 b 重生成，无关 c 不动（FR-005/FR-018/SC-001）', async () => {
    const proj = makeTempProject();
    // 依赖图：b import a；c 独立
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return aFn(n) + 1;', "import { a as aFn } from '../a/index.js';\n"));
    proj.write('src/c/index.ts', srcModule('c', 'return n * 2;'));
    gitInit(proj.root);

    // 第一轮：全量建立基线
    await runBatchOn(proj.root);
    const modulesDir = proj.modulesDir();
    const beforeMtimes = specMtimes(modulesDir);
    expect(beforeMtimes.has('c.spec.md'), '基线轮应生成 c.spec.md').toBe(true);

    // 间隔确保 mtime 可分辨（mtimeMs 精度足够，但保险起见改内容触发真实写）
    // 第二轮：仅改 a 的函数体（skeleton 变化），默认参数
    mocks.mockCreate.mockClear();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 100;'));
    const r2 = await runBatchOn(proj.root);

    // RED 主因：默认未翻转 → 第二轮不走 DeltaRegenerator，deltaReport 也未暴露在 BatchResult。
    expect(r2.deltaReport, 'BatchResult 应暴露 deltaReport 对象（GREEN T016）').toBeDefined();
    // 受影响集合：a（直接变更）+ b（BFS 传播），不含 c —— 用重生成模块集合独立比对（FR-018）。
    // W-1：用 successful（模块级生成集合）断言，不绑死 LLM 调用次数（1 模块可能触发主生成+enrichment 多次调用）。
    const regenModules = new Set(r2.successful);
    expect(regenModules.has('a'), 'a 必须重生成（直接变更）').toBe(true);
    expect(regenModules.has('b'), 'b 必须重生成（依赖 a，BFS 传播）').toBe(true);
    expect(regenModules.has('c'), 'c 与变更无关，不应重生成').toBe(false);
    // c 应在 skipped（cache hit），进一步确认未受影响模块被跳过
    expect(r2.skipped, 'c 应被跳过（cache hit）').toContain('c');

    // FR-005：未受影响 c 的 spec.md mtime 逐字节不变（仅看调用数不足以证明文件未被改写）
    const afterMtimes = specMtimes(modulesDir);
    expect(afterMtimes.get('c.spec.md')).toBe(beforeMtimes.get('c.spec.md'));
  });

  // ── 场景 2 [US2]：无改动 → 零模块级调用 ──────────────────────────────────
  it('场景2 [US2] 无改动 → 第二轮零模块级 generateSpec 调用（SC-002/FR-008）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    await runBatchOn(proj.root);
    const modulesDir = proj.modulesDir();
    const beforeMtimes = specMtimes(modulesDir);

    // 第二轮：不改任何文件
    mocks.mockCreate.mockClear();
    const r2 = await runBatchOn(proj.root);

    // 第二轮无模块级 LLM 调用
    expect(mocks.mockCreate.mock.calls.length).toBe(0);
    expect(r2.successful.length).toBe(0);
    // deltaReport.directChanges/propagatedChanges 应为空（RED：deltaReport undefined）
    expect(r2.deltaReport, 'BatchResult 应暴露 deltaReport 对象').toBeDefined();
    expect(r2.deltaReport!.directChanges).toEqual([]);
    expect(r2.deltaReport!.propagatedChanges).toEqual([]);

    // 所有模块级 spec.md mtime 不变
    const afterMtimes = specMtimes(modulesDir);
    for (const [name, mtime] of beforeMtimes) {
      expect(afterMtimes.get(name), `${name} mtime 应不变`).toBe(mtime);
    }
  });

  // ── 场景 9 [US1]：首次运行（无历史 spec）→ 退化全量 ─────────────────────────
  it('场景9 [US1] 全新无 spec 项目默认参数 → deltaReport.mode=full + fallbackReason=no-existing-specs（FR-012）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    mocks.mockCreate.mockClear();
    const r1 = await runBatchOn(proj.root);

    // 默认参数下首次运行应退化全量（DeltaRegenerator no-existing-specs 路径）
    expect(r1.deltaReport, 'BatchResult 应暴露 deltaReport 对象').toBeDefined();
    expect(r1.deltaReport!.mode).toBe('full');
    expect(r1.deltaReport!.fallbackReason).toBe('no-existing-specs');
    // 所有模块都被生成，不报错不空跑
    expect(r1.successful.length).toBeGreaterThan(0);
    expect(mocks.mockCreate.mock.calls.length).toBeGreaterThan(0);
  });

  // ── 场景 3 [US3/US4]：显式 --full → 全量 ─────────────────────────────────
  it('场景3 [US3/US4] 第二轮显式 full=true → 即使有 cache 也全量重生成（SC-005/FR-016）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    const r1 = await runBatchOn(proj.root);
    const totalModules = r1.totalModules;

    // 第二轮：无改动但显式 full=true（RED：full option 未实现 → 走默认路径会全 skip）
    mocks.mockCreate.mockClear();
    const r2 = await runBatchOn(proj.root, { full: true });

    // full 时所有模块重生成（用 successful 集合断言，W-1：不绑死 LLM 调用次数）
    expect(r2.successful.length).toBe(totalModules);
    expect(r2.skipped, 'full 时无模块被跳过').toHaveLength(0);
  });

  // ── 场景 4 [US1]：mode 切换 → cache miss ─────────────────────────────────
  it('场景4 [US1] 第二轮切 mode（full→reading）→ 所有模块 cache miss 重生成（FR-013/EC-003）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    const r1 = await runBatchOn(proj.root, { mode: 'full' });
    const totalModules = r1.totalModules;

    // 第二轮：源码未变但 mode 切到 reading → mode-aware cache miss
    mocks.mockCreate.mockClear();
    const r2 = await runBatchOn(proj.root, { mode: 'reading' });

    expect(r2.deltaReport, 'BatchResult 应暴露 deltaReport 对象').toBeDefined();
    // mode 变触发全部模块 cache miss → 全部重生成（用 successful 集合断言，W-1）
    expect(r2.successful.length).toBe(totalModules);
    expect(r2.skipped, 'mode 切换后无模块被跳过').toHaveLength(0);
  });

  // ── 场景 5 [US3]：孤儿删除 + ownership 边界 ────────────────────────────────
  it('场景5 [US3] 删源文件 → batch 产物孤儿被删；混入无 generatedByMode 手写 spec 不被删（FR-017/EC-009）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    await runBatchOn(proj.root);
    const modulesDir = proj.modulesDir();
    expect(existsSync(join(modulesDir, 'b.spec.md')), '基线应生成 b.spec.md').toBe(true);

    // 混入一份用户手写 spec（无 generatedByMode frontmatter），ownership 边界须保留它
    const handwrittenPath = join(modulesDir, 'handwritten.spec.md');
    writeFileSync(
      handwrittenPath,
      ['---', 'type: module-spec', 'sourceTarget: src/manual', '---', '', '# 手写 spec，不应被孤儿删除'].join('\n'),
      'utf-8',
    );

    // 删除 b 的源文件 → b.spec.md 成为 batch 产物孤儿
    proj.remove('src/b/index.ts');

    mocks.mockCreate.mockClear();
    await runBatchOn(proj.root);

    // batch 自身产物孤儿（带 generatedByMode）应被删除（RED：孤儿删除未实现）
    expect(
      existsSync(join(modulesDir, 'b.spec.md')),
      'b.spec.md（batch 孤儿）应被删除',
    ).toBe(false);
    // 无 generatedByMode 的手写 spec 必须保留（ownership 边界）
    expect(existsSync(handwrittenPath), '手写 spec 不应被删除').toBe(true);
  });

  // ── 场景 6 [US4]：含残留 checkpoint 的 full ───────────────────────────────
  it('场景6 [US4] 残留 checkpoint 命中某模块 + full=true → 该模块仍被重生成（FR-016/EC-007）', async () => {
    const proj = makeTempProject();
    proj.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    proj.write('src/b/index.ts', srcModule('b', 'return n - 1;'));
    gitInit(proj.root);

    const checkpointPath = join(proj.root, '.spectra-checkpoint.json');
    const r1 = await runBatchOn(proj.root, { checkpointPath });

    // C-1：用真实 saveCheckpoint 写合法 BatchState（完整必填字段），
    // 否则 loadCheckpoint 因 schema 校验失败返回 null，场景没有真正覆盖"checkpoint 命中"。
    // 预置残留 checkpoint：标记模块 a 已完成（模拟中途崩溃残留）。
    const nowIso = new Date().toISOString();
    const residualState: BatchState = {
      batchId: 'f175-residual-checkpoint',
      projectRoot: proj.root,
      startedAt: nowIso,
      lastUpdatedAt: nowIso,
      totalModules: r1.totalModules,
      processingOrder: ['a', 'b'],
      completedModules: [
        { path: 'a', specPath: join(proj.modulesDir(), 'a.spec.md'), completedAt: nowIso },
      ],
      failedModules: [],
      forceRegenerate: false,
    };
    saveCheckpoint(residualState, checkpointPath);
    // 前置确认 checkpoint 真的可被加载（否则测试假绿/假红）
    expect(loadCheckpoint(checkpointPath), 'checkpoint 应可被合法加载').not.toBeNull();

    mocks.mockCreate.mockClear();
    const r2 = await runBatchOn(proj.root, { full: true, checkpointPath });

    // full 必须清空 checkpoint completed → a 仍被重生成（不被残留 checkpoint 绕过）
    expect(r2.successful, 'full 时 a 必须被重生成，不被残留 checkpoint 绕过').toContain('a');
    expect(r2.skipped, 'full 时 a 不应出现在 skipped').not.toContain('a');
  });

  // ── 场景 7 [US1]：增量 target 口径端到端一致（FR-019）────────────────────────
  // C-2 说明：FR-019 的核心（DeltaRegenerator 与 processOneModule 共用同一 sourceTarget 口径，
  // 含"单文件 + dirPath 冲突"的文件级降级分支）由 resolveSourceTarget 的 oracle 单测（T004，
  // 直接构造 conflictingDirPaths 覆盖冲突分支）精确锁定。本 E2E 场景作为互补，验证端到端口径
  // 一致的可观测不变量：改一个模块 → deltaReport 标记的重生成 target 与实际重生成的模块集合自洽
  // （不出现"deltaReport 标记却被跳过"或"未标记却被生成"的错位），未改模块进 skipped。
  it('场景7 [US1] 改一个模块 → deltaReport.regenerateTargets 与实际重生成模块自洽，未改模块跳过（FR-019）', async () => {
    const proj = makeTempProject();
    // 注：模块名须避开 directory-classifier 的保留类别（如 'config' 会被归为 config 类而非 source，
    // 不进入 moduleOrder）；用 'loader'/'store' 两个 source 类目录确保聚合为 2 个独立模块。
    proj.write('src/loader/index.ts', srcModule('loader', 'return n;'));
    proj.write('src/store/index.ts', srcModule('store', 'return n + 2;'));
    gitInit(proj.root);

    await runBatchOn(proj.root);

    // 改 loader，第二轮默认增量
    mocks.mockCreate.mockClear();
    proj.write('src/loader/index.ts', srcModule('loader', 'return n + 50;'));
    const r2 = await runBatchOn(proj.root);

    expect(r2.deltaReport, 'BatchResult 应暴露 deltaReport 对象').toBeDefined();
    // 口径自洽：deltaReport 标记重生成的非空，且 loader 重生成、store 跳过（未改）。
    expect(r2.deltaReport!.regenerateTargets.length, 'regenerateTargets 不应为空').toBeGreaterThan(0);
    expect(r2.successful, 'loader 被改 → 必须重生成').toContain('loader');
    expect(r2.skipped, 'store 未改 → 必须跳过（口径正确则不误重生成）').toContain('store');
    expect(r2.successful, 'store 未改 → 不应在重生成集合').not.toContain('store');
  });

  // ── 场景 8 [US1]：BFS 传播（diamond + cycle）────────────────────────────────
  it('场景8 [US1] diamond 依赖改 a → 传播到 b/c/d；cycle X↔Y 改 x → BFS 终止且 x/y 重生成（FR-018）', async () => {
    // 8a：diamond  a←b, a←c, b←d, c←d（箭头表示"依赖"：b 依赖 a 即 b import a）
    // 这里构造 import 关系：b import a；c import a；d import b & c。改 a 应传播到 b/c/d。
    const dia = makeTempProject();
    dia.write('src/a/index.ts', srcModule('a', 'return n + 1;'));
    dia.write('src/b/index.ts', srcModule('b', 'return aFn(n);', "import { a as aFn } from '../a/index.js';\n"));
    dia.write('src/c/index.ts', srcModule('c', 'return aFn(n) + 1;', "import { a as aFn } from '../a/index.js';\n"));
    dia.write(
      'src/d/index.ts',
      srcModule('d', 'return bFn(n) + cFn(n);', "import { b as bFn } from '../b/index.js';\nimport { c as cFn } from '../c/index.js';\n"),
    );
    gitInit(dia.root);

    await runBatchOn(dia.root);
    mocks.mockCreate.mockClear();
    dia.write('src/a/index.ts', srcModule('a', 'return n + 999;'));
    const rDia = await runBatchOn(dia.root);

    expect(rDia.deltaReport, 'diamond: BatchResult 应暴露 deltaReport 对象').toBeDefined();
    // 改 a → a 直接变更 + b/c/d 传播。预期 target 集合独立比对（非仅计数）。
    const diaModules = new Set(rDia.successful);
    for (const m of ['a', 'b', 'c', 'd']) {
      expect(diaModules.has(m), `diamond: 模块 ${m} 应因改 a 传播而重生成`).toBe(true);
    }

    // 8b：cycle  x import y，y import x（循环依赖）。改 x，BFS 须终止不死循环。
    const cyc = makeTempProject();
    cyc.write('src/x/index.ts', srcModule('x', 'return n + 1;', "import { y as yFn } from '../y/index.js';\nexport const _useY = (n: number) => yFn(n);\n"));
    cyc.write('src/y/index.ts', srcModule('y', 'return n - 1;', "import { x as xFn } from '../x/index.js';\nexport const _useX = (n: number) => xFn(n);\n"));
    gitInit(cyc.root);

    await runBatchOn(cyc.root);
    mocks.mockCreate.mockClear();
    cyc.write('src/x/index.ts', srcModule('x', 'return n + 42;', "import { y as yFn } from '../y/index.js';\nexport const _useY = (n: number) => yFn(n);\n"));
    const rCyc = await runBatchOn(cyc.root);

    expect(rCyc.deltaReport, 'cycle: BatchResult 应暴露 deltaReport 对象').toBeDefined();
    const cycModules = new Set(rCyc.successful);
    expect(cycModules.has('x'), 'cycle: 改 x → x 重生成').toBe(true);
    expect(cycModules.has('y'), 'cycle: 改 x → 传播到 y 重生成').toBe(true);
  });

  // ── 场景 10 [US3]：full vs 无改动 incremental 产物 byte-stable（SC-003，捕获 C-1/C-2）──
  // P1 验收缺口补全：同一临时项目跑两次——(a) full=true 得基线产物 A；(b) 无改动默认增量得产物 B。
  // 断言：模块级 *.spec.md 字节相同（FR-005）+ graph.json 剥 generatedAt/currentRun 后 deepEqual。
  // 该场景必须在 C-1（currentRun 不入盘）+ C-2（孤儿/SpecStore 视图一致）修复后才能真正 deepEqual 通过。
  it('场景10 [US3] full 与无改动增量产物 byte-stable：模块 spec 字节相同 + graph.json deepEqual（SC-003）', async () => {
    const proj = makeTempProject();
    proj.write('src/loader/index.ts', srcModule('loader', 'return n + 1;'));
    proj.write('src/store/index.ts', srcModule('store', 'return n - 1;'));
    gitInit(proj.root);

    const modulesDir = proj.modulesDir();

    // (a) full=true 建立基线产物 A
    mocks.mockCreate.mockClear();
    await runBatchOn(proj.root, { full: true });
    const specsAfterFull = new Map<string, string>();
    for (const entry of readdirSync(modulesDir)) {
      if (entry.endsWith('.spec.md') && !entry.startsWith('_')) {
        specsAfterFull.set(entry, readFileSync(join(modulesDir, entry), 'utf-8'));
      }
    }
    expect(specsAfterFull.size, 'full 轮应至少生成 1 个模块 spec').toBeGreaterThan(0);

    // F179 落盘侧 byte-stable 护栏：raw graph.json 中 generatedAt 必须是固定 epoch
    // （batch-orchestrator 已传 stripTimestamps:true，此断言防止回归）。
    const graphRawAfterFull = JSON.parse(
      readFileSync(join(proj.root, 'specs', '_meta', 'graph.json'), 'utf-8'),
    ) as { graph?: { generatedAt?: string } };
    expect(
      graphRawAfterFull.graph?.generatedAt,
      'F179: 落盘 graph.json 的 graph.generatedAt 应为固定 epoch（byte-stable）',
    ).toBe('1970-01-01T00:00:00.000Z');

    const graphAfterFull = readNormalizedGraph(proj.root);

    // (b) 无改动默认增量得产物 B（cache-hit 路径，全部模块应 skip）
    mocks.mockCreate.mockClear();
    const rIncr = await runBatchOn(proj.root);
    expect(rIncr.successful.length, '无改动增量轮不应重生成任何模块').toBe(0);

    // (c) 模块级 *.spec.md 字节逐字相同（cache hit 不改写）
    for (const [name, fullBytes] of specsAfterFull) {
      const incrBytes = readFileSync(join(modulesDir, name), 'utf-8');
      expect(incrBytes, `${name} 在 full 与无改动增量两路应字节相同`).toBe(fullBytes);
    }

    // (d) graph.json 剥 generatedAt + currentRun 后 deepEqual（C-1/C-2 修复后成立）
    const graphAfterIncr = readNormalizedGraph(proj.root);
    expect(graphAfterIncr, 'full vs 无改动增量的 graph.json 归一化后应 deepEqual').toEqual(
      graphAfterFull,
    );
  });
});
