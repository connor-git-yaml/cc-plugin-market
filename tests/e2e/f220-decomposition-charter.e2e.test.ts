/**
 * F220 G2 — batch-orchestrator 拆分特征化守护（characterization test）
 *
 * 目的：在五段拆分【之前】用 vitest snapshot 冻结 runBatch 的可观测行为，
 * 拆分全程 snapshot 文件不再更新（严禁 `vitest -u`；本地裸跑会自动"新增"缺失 key —
 * 场景10a 的 key 集合断言会抓住新增/删除，见 Codex G 审查 W3）。
 *
 * 为什么需要本文件（Codex 设计审查 C4/C5 + G 层审查 C1/C2/C3）：
 * - graph-only 冻结基线（G1）只执行 skeleton 采集 + unifiedGraph 路径，不执行
 *   scanFiles / groupFilesByLanguage / 主图选择 / p-limit 调度 / checkpoint / 产物写盘
 * - 既有 F175 E2E 聚焦增量语义，不覆盖语言矩阵与 checkpoint 全链
 * - G 层审查修复：graph 从"三元组投影"升级为完整归一化 GraphJSON（抓 directional/
 *   confidence/sourceCommit/hyperedges 漂移）；summary/README/_index 内容纳入冻结
 *   （B7 搬迁目标）；补失败→checkpoint→resume 链（B1 搬迁目标）
 *
 * 口径：
 * - mock '@anthropic-ai/sdk'（零付费、零网络），concurrency: 1（调度顺序确定化）
 * - 运行态噪声结构化清洗（路径/git SHA/ISO 时间戳/duration/batchId），token 计数与
 *   统计结构保留（mock 下确定，是调度行为的真信号）
 * - F223 修复：README 首行本地化日期（`toLocaleDateString('zh-CN')`，产品既有行为）曾被当成
 *   稳定内容冻结，跨系统日期必红；scrubRuntimeNoise 补 <DATE> 规则，.snap 做外科式定点替换
 *   （9 处字面量，严禁 `vitest -u`）；生产代码零改动，详见 fix-report.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { join, basename, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import type { BatchResult, BatchOptions } from '../../src/batch/batch-orchestrator.js';
import { DEFAULT_CHECKPOINT_PATH } from '../../src/batch/checkpoint.js';

// ─── LLM Mock（沿用 F175 范式；hoisting 要求模块顶层声明）────────────────────
const mocks = vi.hoisted(() => {
  const mockSpecMarkdown = `
## 1. 意图

F220 特征化 mock 模块，用于冻结拆分前 batch 编排行为。

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

  const standardResponse = {
    id: 'msg_f220_mock',
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
  };

  const mockCreate = vi.fn();

  return { mockCreate, standardResponse };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
  Anthropic: vi.fn().mockImplementation(() => ({
    messages: { create: mocks.mockCreate },
  })),
}));

const COMMON_OPTS: BatchOptions = {
  enableDebtIntelligence: false,
  generateHtml: false,
  enableAdr: false,
  progressMode: 'silent',
  concurrency: 1,
};

// ─── 临时项目构造（沿用 F175 范式）──────────────────────────────────────────
const activeRoots: string[] = [];

function makeTempProject(prefix: string): { root: string; write(rel: string, content: string): void } {
  const root = mkdtempSync(join(tmpdir(), `spectra-f220-${prefix}-`));
  activeRoots.push(root);
  const write = (relPath: string, content: string): void => {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  };
  write('package.json', JSON.stringify({ name: `f220-${prefix}`, version: '0.0.0' }, null, 2));
  return { root, write };
}

function gitInit(root: string): void {
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  run(['init']);
  run(['config', 'user.email', 'f220@test.local']);
  run(['config', 'user.name', 'F220 Charter']);
  run(['add', '-A']);
  run(['commit', '-m', 'baseline']);
}

async function runBatchOn(root: string, opts: BatchOptions = {}): Promise<BatchResult> {
  const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
  return runBatch(root, { ...COMMON_OPTS, ...opts });
}

function checkpointPathOf(root: string): string {
  return join(root, 'specs', basename(DEFAULT_CHECKPOINT_PATH));
}

// ─── 运行态噪声清洗 ──────────────────────────────────────────────────────────

/**
 * 结构化清洗运行态噪声（既有行为特征，非本次拆分对象）：
 * - 临时根路径与其 basename（README 标题 = basename(root)，mkdtemp 随机）
 * - 40-hex git SHA（临时仓库每次 init 必变；64-hex skeletonHash 不受影响）
 * - ISO-8601 时间戳（spec frontmatter lastUpdated / analyzedAt / checkpoint *At 等）
 * - 本地化日期 `YYYY/M/D`（README 首行 `toLocaleDateString('zh-CN')` 产出，无补零；F223 新增）
 * - durationMs 数值（W1 修复：捕获组保引号结构，JSON 清洗后仍可 parse）
 * - batch-<Date.now()> 形态的 batchId 与 summary 文件名（10+ 位数字防误伤）
 * - "123ms" 形态的耗时文本（summary 人类可读行）
 */
function scrubRuntimeNoise(text: string, root: string): string {
  return text
    .replaceAll(root, '<ROOT>')
    .replaceAll(basename(root), '<PROJECT>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<ISO-TS>')
    .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}\b/g, '<DATE>') // toLocaleDateString('zh-CN') 本地化日期（F223）
    .replace(/("?durationMs"?\s*:\s*)\d+/g, '$1"<N>"')
    .replace(/\bbatch-\d{10,}\b/g, 'batch-<TS>')
    .replace(/\b\d+(?:\.\d+)?\s*ms\b/g, '<MS>')
    .replace(/\b\d+(?:\.\d+)?\s*s\b/g, '<SEC>'); // summary 人类可读行 "总耗时: 0.8s"
}

function sanitize<T>(value: T, root: string): T {
  return JSON.parse(scrubRuntimeNoise(JSON.stringify(value), root)) as T;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16);
}

// ─── 快照 payload 构造 ───────────────────────────────────────────────────────

/** modules/*.spec.md 内容摘要（清洗后取 hash；`_index` 内容单独全文冻结） */
function moduleSpecDigest(root: string): Record<string, string> {
  const modulesDir = join(root, 'specs', 'modules');
  const out: Record<string, string> = {};
  if (!existsSync(modulesDir)) return out;
  for (const entry of readdirSync(modulesDir).sort()) {
    if (!entry.endsWith('.spec.md')) continue;
    const raw = scrubRuntimeNoise(readFileSync(join(modulesDir, entry), 'utf-8'), root);
    out[entry] = entry.startsWith('_') ? `full:${sha256(raw)}` : sha256(raw);
  }
  return out;
}

/**
 * 完整归一化 GraphJSON（Codex G 审查 C1：投影不够，directional/confidence/元数据/
 * hyperedges 都是合同）。仅按字段路径剥/换真运行态值，其余全量入快照。
 */
function graphContract(root: string): Record<string, unknown> | null {
  const graphPath = join(root, 'specs', '_meta', 'graph.json');
  if (!existsSync(graphPath)) return null;
  const raw = JSON.parse(readFileSync(graphPath, 'utf-8')) as Record<string, unknown>;
  const meta = raw['graph'] as Record<string, unknown> | undefined;
  if (meta) {
    delete meta['generatedAt']; // 防御（写盘已 stripTimestamps 固定 epoch）
    if (meta['sourceCommit']) meta['sourceCommit'] = '<SHA>'; // 字段级替换（非全文正则）
    // inputHash 覆盖 docGraph 派生内容（含运行态），F175 即不纳入断言核心 —— 同口径字段级归一
    if (meta['inputHash']) meta['inputHash'] = '<HASH>';
  }
  const nodes = raw['nodes'] as Array<{ id: string; metadata?: Record<string, unknown> }> | undefined;
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      if (n.metadata && typeof n.metadata === 'object') delete n.metadata['currentRun'];
    }
    nodes.sort((a, b) => a.id.localeCompare(b.id));
  }
  const links = raw['links'] as Array<{ source?: string; target?: string; relation?: string }> | undefined;
  if (Array.isArray(links)) {
    links.sort((a, b) =>
      `${a.source}|${a.target}|${a.relation}`.localeCompare(`${b.source}|${b.target}|${b.relation}`),
    );
  }
  return sanitize(raw, root);
}

/** 项目级产物文件清单（batch-summary 文件名时间戳归一化，保留出现次数） */
function artifactFileNames(root: string): Record<string, string[]> {
  const specsDir = join(root, 'specs');
  const listDir = (rel: string): string[] => {
    const dir = rel === '' ? specsDir : join(specsDir, rel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => !f.startsWith('.'))
      .map((f) => f.replace(/^batch-summary-\d+\.md$/, 'batch-summary-<TS>.md'))
      .sort();
  };
  return {
    root: existsSync(specsDir)
      ? readdirSync(specsDir).filter((f) => !f.startsWith('.') && !f.startsWith('_')).sort()
      : [],
    modules: listDir('modules'),
    project: listDir('project'),
    _meta: listDir('_meta'),
  };
}

/**
 * B7 搬迁目标的内容冻结（Codex G 审查 C2）：README / _index.spec.md / 最新 batch-summary
 * 全文（清洗后）。空文件化 / 参数断线（moduleSpecs: [] 等）都会现形。
 */
function reportingArtifacts(root: string): Record<string, string | null> {
  const specsDir = join(root, 'specs');
  const readFull = (p: string): string | null =>
    existsSync(p) ? scrubRuntimeNoise(readFileSync(p, 'utf-8'), root) : null;

  const metaDir = join(specsDir, '_meta');
  let latestSummary: string | null = null;
  if (existsSync(metaDir)) {
    const summaries = readdirSync(metaDir)
      .filter((f) => /^batch-summary-\d+\.md$/.test(f))
      .sort(); // 13 位毫秒时间戳，字典序 = 时间序
    const last = summaries[summaries.length - 1];
    if (last) latestSummary = readFull(join(metaDir, last));
  }
  return {
    readme: readFull(join(specsDir, 'README.md')),
    indexSpec: readFull(join(specsDir, 'modules', '_index.spec.md')),
    latestSummary,
  };
}

/** checkpoint 全文归一化（Codex G 审查 C3：B1 状态机搬迁的行为合同） */
function checkpointContract(root: string): Record<string, unknown> | null {
  const p = checkpointPathOf(root);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, 'utf-8')) as {
    completedModules?: Array<{ path: string }>;
    failedModules?: Array<{ path: string }>;
  };
  raw.completedModules?.sort((a, b) => a.path.localeCompare(b.path));
  raw.failedModules?.sort((a, b) => a.path.localeCompare(b.path));
  return sanitize(raw as Record<string, unknown>, root);
}

function charterPayload(root: string, result: BatchResult, llmCalls: number): Record<string, unknown> {
  return {
    result: sanitize(
      {
        totalModules: result.totalModules,
        successful: result.successful,
        failed: result.failed.map((f) => ({ path: f.path, reason: f.reason ?? null })),
        skipped: result.skipped,
        degraded: result.degraded,
        indexGenerated: result.indexGenerated,
        detectedLanguages: result.detectedLanguages ?? null,
        languageStats: result.languageStats
          ? Object.fromEntries(
              [...result.languageStats.entries()]
                .map(([k, v]) => [k, v] as const)
                .sort((a, b) => a[0].localeCompare(b[0])),
            )
          : null,
        dryRunReportPath: result.dryRunReportPath ?? null,
      },
      root,
    ),
    llmCalls,
    moduleSpecs: moduleSpecDigest(root),
    graph: graphContract(root),
    artifacts: artifactFileNames(root),
    reporting: reportingArtifacts(root),
  };
}

// ─── 固定 fixture 内容 ───────────────────────────────────────────────────────

const TS_A = `export function alpha(n: number): number {\n  return n + 1;\n}\n`;
const TS_B = `import { alpha } from './a.js';\nexport function beta(n: number): number {\n  return alpha(n) * 2;\n}\n`;
const PY_ENGINE = `class Value:\n    def __init__(self, data):\n        self.data = data\n\n    def double(self):\n        return Value(self.data * 2)\n`;
const PY_NN = `from engine import Value\n\ndef make(n):\n    return Value(n)\n`;
const RB_MAIN = `def greet(name)\n  "hello #{name}"\nend\n`;

const TSCONFIG = JSON.stringify(
  { compilerOptions: { target: 'ES2020', module: 'ESNext' }, include: ['src'] },
  null,
  2,
);

function writeMultiLangProject(p: { write(rel: string, c: string): void }): void {
  p.write('tsconfig.json', TSCONFIG);
  p.write('src/a.ts', TS_A);
  p.write('src/b.ts', TS_B);
  p.write('py/engine.py', PY_ENGINE);
  p.write('py/nn.py', PY_NN);
}

// ─── 场景清单（场景10a 的 snapshot key 集合断言依赖此单一事实源）──────────────
const DESCRIBE_TITLE = 'F220 拆分特征化守护（语言矩阵 + checkpoint 链，mock-LLM）';
const SCENARIO_TITLES = [
  '场景1：纯 TS 项目 默认 regen 路径行为冻结',
  '场景2：纯 Python 项目 默认 regen 路径行为冻结',
  '场景3：TS+Python 多语言 默认 regen 路径行为冻结（合并拓扑）',
  '场景4：languages 过滤（多语言项目仅处理 python）行为冻结',
  '场景5：无受支持语言 fallback（仅 .rb）行为冻结',
  '场景6：增量第二轮（改一个 TS 文件）重生成范围冻结',
  '场景7：显式 full 第二轮 — cache 旁路全量重生成行为冻结',
  '场景8：失败→checkpoint 内容→resume 恢复链行为冻结',
  '场景9：dry-run 零 LLM 预估路径行为冻结',
  '场景10：mode=code-only 产物集行为冻结',
] as const;

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe(DESCRIBE_TITLE, { timeout: 180_000 }, () => {
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    savedApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key-f220';
    const { bootstrapAdapters } = await import('../../src/adapters/index.js');
    bootstrapAdapters();
  });

  beforeEach(() => {
    // mockReset 清 implementation + calls；恢复统一基线（场景8 会临时注入失败 implementation）
    mocks.mockCreate.mockReset();
    mocks.mockCreate.mockResolvedValue(mocks.standardResponse);
  });

  afterAll(() => {
    if (savedApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedApiKey;
    for (const root of activeRoots) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it(SCENARIO_TITLES[0], async () => {
    const p = makeTempProject('ts');
    p.write('tsconfig.json', TSCONFIG);
    p.write('src/a.ts', TS_A);
    p.write('src/b.ts', TS_B);
    gitInit(p.root);

    const result = await runBatchOn(p.root);
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[1], async () => {
    const p = makeTempProject('py');
    p.write('engine.py', PY_ENGINE);
    p.write('nn.py', PY_NN);
    gitInit(p.root);

    const result = await runBatchOn(p.root);
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[2], async () => {
    const p = makeTempProject('multi');
    writeMultiLangProject(p);
    gitInit(p.root);

    const result = await runBatchOn(p.root);
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[3], async () => {
    const p = makeTempProject('filter');
    writeMultiLangProject(p);
    gitInit(p.root);

    const result = await runBatchOn(p.root, { languages: ['python'] });
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[4], async () => {
    const p = makeTempProject('rb');
    p.write('lib/main.rb', RB_MAIN);
    gitInit(p.root);

    const result = await runBatchOn(p.root);
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[5], async () => {
    const p = makeTempProject('incr');
    writeMultiLangProject(p);
    gitInit(p.root);

    await runBatchOn(p.root);
    mocks.mockCreate.mockClear();

    p.write('src/a.ts', `export function alpha(n: number): number {\n  return n + 42;\n}\n`);
    const second = await runBatchOn(p.root, { incremental: true });

    const payload = charterPayload(p.root, second, mocks.mockCreate.mock.calls.length);
    payload['deltaReport'] = second.deltaReport
      ? sanitize(
          {
            mode: second.deltaReport.mode,
            directChanges: second.deltaReport.directChanges,
            propagatedChanges: second.deltaReport.propagatedChanges,
            regenerateTargets: second.deltaReport.regenerateTargets,
            fallbackReason: second.deltaReport.fallbackReason ?? null,
          },
          p.root,
        )
      : null;
    expect(payload).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[6], async () => {
    const p = makeTempProject('full2');
    writeMultiLangProject(p);
    gitInit(p.root);

    await runBatchOn(p.root);
    mocks.mockCreate.mockClear();

    // 无源码改动 + full:true → 必须旁路增量 cache 全量重生成（llmCalls 与首轮同量级）
    const second = await runBatchOn(p.root, { full: true });
    expect(existsSync(checkpointPathOf(p.root)), 'full 成功后 checkpoint 应被清理').toBe(false);
    expect(charterPayload(p.root, second, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[7], async () => {
    const p = makeTempProject('resume');
    p.write('tsconfig.json', TSCONFIG);
    p.write('src/a.ts', TS_A);
    p.write('src/b.ts', TS_B);
    gitInit(p.root);

    // 第一轮：前 3 次 LLM 调用注入失败（concurrency=1 + 拓扑序下即模块 a 的 3 次重试）
    // → a 进入 failedModules，b 正常完成 → checkpoint 保留（failed 非空不清理）
    let failRemaining = 3;
    mocks.mockCreate.mockImplementation(() => {
      if (failRemaining > 0) {
        failRemaining -= 1;
        return Promise.reject(new Error('F220 injected failure'));
      }
      return Promise.resolve(mocks.standardResponse);
    });

    const firstRun = await runBatchOn(p.root);
    const firstPayload = {
      result: sanitize(
        {
          successful: firstRun.successful,
          failed: firstRun.failed.map((f) => ({ path: f.path, reason: f.reason ?? null })),
          skipped: firstRun.skipped,
        },
        p.root,
      ),
      llmCalls: mocks.mockCreate.mock.calls.length,
      checkpoint: checkpointContract(p.root),
    };
    expect(existsSync(checkpointPathOf(p.root)), '失败后 checkpoint 应保留').toBe(true);
    expect(firstPayload).toMatchSnapshot();

    // 第二轮：恢复正常 mock → resume：已完成模块跳过、失败模块重生成、checkpoint 清理
    mocks.mockCreate.mockReset();
    mocks.mockCreate.mockResolvedValue(mocks.standardResponse);
    const secondRun = await runBatchOn(p.root);
    expect(existsSync(checkpointPathOf(p.root)), 'resume 成功后 checkpoint 应清理').toBe(false);
    expect(
      charterPayload(p.root, secondRun, mocks.mockCreate.mock.calls.length),
    ).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[8], async () => {
    const p = makeTempProject('dry');
    writeMultiLangProject(p);
    gitInit(p.root);

    const result = await runBatchOn(p.root, { dryRun: true });
    const payload = charterPayload(p.root, result, mocks.mockCreate.mock.calls.length);
    const dryReportPath = join(p.root, 'specs', '_meta', 'dry-run-estimate.md');
    payload['dryRunReport'] = existsSync(dryReportPath)
      ? scrubRuntimeNoise(readFileSync(dryReportPath, 'utf-8'), p.root)
      : null;
    expect(mocks.mockCreate.mock.calls.length, 'dry-run 不得有任何 LLM 调用').toBe(0);
    expect(payload).toMatchSnapshot();
  });

  it(SCENARIO_TITLES[9], async () => {
    const p = makeTempProject('codeonly');
    writeMultiLangProject(p);
    gitInit(p.root);

    const result = await runBatchOn(p.root, { mode: 'code-only' });
    expect(charterPayload(p.root, result, mocks.mockCreate.mock.calls.length)).toMatchSnapshot();
  });

  it('场景10a（W3 守护）：snapshot key 集合与场景清单双向一致（防本地静默新增/删除）', () => {
    const snapPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '__snapshots__',
      'f220-decomposition-charter.e2e.test.ts.snap',
    );
    const snapText = readFileSync(snapPath, 'utf-8');
    const actualKeys = [...snapText.matchAll(/^exports\[`(.+?)(?<!\\)`\]/gms)].map((m) => m[1]!);

    const expectedKeys = SCENARIO_TITLES.flatMap((title) => {
      const base = `${DESCRIBE_TITLE} > ${title}`;
      // 场景8 有两个 snapshot（首轮失败态 + resume 轮）
      return title.startsWith('场景8') ? [`${base} 1`, `${base} 2`] : [`${base} 1`];
    });
    expect(actualKeys.sort()).toEqual(expectedKeys.sort());
  });

  it('场景10b（F223 守护）：scrubRuntimeNoise 对本地化日期的清洗与系统日期无关（时间旅行防线）', () => {
    const root = '/tmp/f220-guard-root';
    const sample = (date: string): string =>
      `> 由 spectra v4.3.0 自动生成 | ${date}\n40位SHA: ${'a'.repeat(40)}\n耗时: 12.3ms / 0.8s\n`;

    // 覆盖：修复当天日期 / 跨日次日 / 跨年边界 / 补零形态 / 远古日期 —— 五个互不相同的日期变体
    const dates = ['2026/7/21', '2026/7/22', '2027/1/1', '2026/07/22', '1999/1/1'];
    const cleaned = dates.map((d) => scrubRuntimeNoise(sample(d), root));

    // 不变量：无论输入哪个日期，清洗结果必须收敛到同一字符串 —— 证明与"系统当前日期"无关
    expect(new Set(cleaned).size).toBe(1);
    expect(cleaned[0]).toContain('<DATE>');
    expect(cleaned[0]).not.toMatch(/\d{4}\/\d{1,2}\/\d{1,2}/);

    // 回归防线：既有 ISO-8601 完整形态规则不受本次改动干扰
    expect(scrubRuntimeNoise('lastUpdated: 2026-07-22T03:04:05.000Z', root)).toBe(
      'lastUpdated: <ISO-TS>',
    );

    // 负例防线：短数字（版本号/比例）不得被误伤
    const untouched = 'v4.3.0 spectra | specs/modules/_index.spec.md | 4/5 通过';
    expect(scrubRuntimeNoise(untouched, root)).toBe(untouched);
  });
});
