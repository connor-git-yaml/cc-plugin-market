/**
 * F266 T010（FR-003）— `spectra graph` 的图信息量守卫。
 *
 * 背景：本命令只合并磁盘缓存的 architecture-ir 与已生成的 .spec.md，**不解析源码**。
 * 在没有 spec 产物的仓库里跑它，会把一张由 batch / graph-only 建出的完整图静默覆写成贫图。
 * 守卫的判据只有两个结构性计数（节点数 / 边数），严格不减，不设百分比容忍。
 *
 * 关键边界：守卫 MUST NOT 把"没有基线"误判成"退化"——旧图缺失 / 损坏 / 缺字段一律放行。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGraphCommand } from '../../src/cli/commands/graph.js';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import type { CLICommand } from '../../src/cli/utils/parse-args.js';

function graphCommand(overrides: Partial<CLICommand>): CLICommand {
  return {
    subcommand: 'graph',
    graphOperation: 'build',
    deep: false,
    force: false,
    version: false,
    help: false,
    global: false,
    remove: false,
    skillTarget: 'claude',
    ...overrides,
  };
}

/**
 * 在 outputDir 下预置一张"旧图"。
 *
 * 对抗审查 A6b：守卫现在**现数** `nodes` / `links`（含 calls 边），不再信 `graph.nodeCount`
 * 之类的自报值，故 fixture 必须给出真实数组 —— 这本身就是那条缺陷的回归网：
 * 旧实现下一张 `nodeCount: 120` 但 `nodes: []` 的图能骗到守卫。
 */
function seedGraphFile(outputDir: string, content: unknown): string {
  const graphPath = path.join(outputDir, '_meta', 'graph.json');
  fs.mkdirSync(path.dirname(graphPath), { recursive: true });
  fs.writeFileSync(graphPath, JSON.stringify(content, null, 2), 'utf-8');
  return graphPath;
}

function fakeNodes(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: 'component', label: `n${i}`, metadata: {} }));
}

/** relation 可控的边数组：calls 边与非 calls 边分开给，守卫要能分别看见 */
function fakeLinks(total: number, callsCount = 0): unknown[] {
  return Array.from({ length: total }, (_, i) => ({
    source: `n${i}`,
    target: `n${i + 1}`,
    relation: i < callsCount ? 'calls' : 'depends-on',
  }));
}

/** 预置一张有真实节点/边的旧图 */
function seedExistingGraph(
  outputDir: string,
  counts: { nodes: number; links: number; calls?: number },
  graphMeta: Record<string, unknown> = {},
): string {
  return seedGraphFile(outputDir, {
    graph: { schemaVersion: '2.0', ...graphMeta },
    nodes: fakeNodes(counts.nodes),
    links: fakeLinks(counts.links, counts.calls ?? 0),
  });
}

/** 读回磁盘上 graph.json 的原始文本（用于判断是否被覆写） */
function readRaw(outputDir: string): string {
  return fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8');
}

describe('runGraphCommand — 图信息量守卫（F266 FR-003）', () => {
  let tmpDir: string;
  let outputDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f266-graph-guard-'));
    outputDir = path.join(tmpDir, 'specs');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    errSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('新图节点数少于旧图 → 拒写 + 非零退出 + 提示改用 graph-only', async () => {
    // 本命令在空工程里产出 0 节点 0 边，故任何非零基线都会触发守卫
    seedExistingGraph(outputDir, { nodes: 120, links: 300 });
    const before = readRaw(outputDir);

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBe(1);
    // 磁盘上的旧图一字未动
    expect(readRaw(outputDir)).toBe(before);
    const message = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('拒绝覆写');
    expect(message).toContain('spectra batch --mode graph-only');
    expect(message).toContain('--force');
  });

  it('新图仅边数少于旧图（节点数持平）→ 同样拒写（两个计数各自独立判定）', async () => {
    seedExistingGraph(outputDir, { nodes: 0, links: 7 });
    const before = readRaw(outputDir);

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBe(1);
    expect(readRaw(outputDir)).toBe(before);
  });

  it('--force → 放行覆写，退出码为 0', async () => {
    seedExistingGraph(outputDir, { nodes: 120, links: 300 });
    const before = readRaw(outputDir);

    await runGraphCommand(graphCommand({ outputDir, force: true }));

    expect(process.exitCode).toBeUndefined();
    expect(readRaw(outputDir)).not.toBe(before);
  });

  it('旧图不存在 → 放行（守卫不得把"没有基线"当成"退化"）', async () => {
    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(outputDir, '_meta', 'graph.json'))).toBe(true);
  });

  it('旧图缺 nodes / links 数组 → 放行（无可信基线不等于退化）', async () => {
    seedGraphFile(outputDir, { graph: { schemaVersion: '2.0', nodeCount: 120, edgeCount: 300 } });

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(readRaw(outputDir)) as { graph: { nodeCount: number } };
    expect(written.graph.nodeCount).toBe(0);
  });

  it('旧图自报计数虚高但数组为空 → 放行（守卫现数，不信被判定对象自报的数字）', async () => {
    seedGraphFile(outputDir, {
      graph: { schemaVersion: '2.0', nodeCount: 9999, edgeCount: 9999 },
      nodes: [],
      links: [],
    });

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
  });

  it('旧图 JSON 损坏 → 放行（不可读的基线不是可信基线）', async () => {
    const graphPath = path.join(outputDir, '_meta', 'graph.json');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, '{ this is not json', 'utf-8');

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
    expect(readRaw(outputDir)).not.toContain('this is not json');
  });

  it('旧图 nodes / links 不是数组（类型不对）→ 放行，不做隐式转换', async () => {
    seedGraphFile(outputDir, { graph: { schemaVersion: '2.0' }, nodes: '120', links: '300' });

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
  });

  it('新图不低于旧图（旧图 0/0）→ 正常写入', async () => {
    seedExistingGraph(outputDir, { nodes: 0, links: 0 });

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
    const written = JSON.parse(readRaw(outputDir)) as { graph: { nodeCount: number } };
    expect(written.graph.nodeCount).toBe(0);
  });
});

describe('runGraphCommand — calls 边独立判据（对抗审查 A6b）', () => {
  let tmpDir: string;
  let outputDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f266-graph-calls-'));
    outputDir = path.join(tmpDir, 'specs');
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.exitCode = undefined;
  });

  afterEach(() => {
    errSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('"节点/总边数都不减、但 calls 边归零" → 拒写（实跑复现的洗图形态）', async () => {
    // 旧图：0 节点 0 边 …… 但有 3 条 calls 边是不可能的，故构造一张小而真实的旧图，
    // 再让本命令在空工程里产出 0/0 —— 这里要固化的是**判据本身**：三个计数任一下降即拒写。
    // 形态还原：新图 nodeCount/edgeCount 上升、calls 归零，两标量守卫会放行。
    seedExistingGraph(outputDir, { nodes: 0, links: 3, calls: 3 });
    const before = readRaw(outputDir);

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBe(1);
    expect(readRaw(outputDir)).toBe(before);
    const message = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(message).toContain('calls 边 3 → 0');
    // 逃生口文案覆盖 --directed 形态切换这类有意场景（不为它做判据特判，见 F231 教训）
    expect(message).toContain('--directed');
  });

  it('calls 边数持平（旧图 0 条）→ 不因该维度拒写', async () => {
    seedExistingGraph(outputDir, { nodes: 0, links: 0, calls: 0 });

    await runGraphCommand(graphCommand({ outputDir }));

    expect(process.exitCode).toBeUndefined();
  });

  it('calls 边下降但带 --force → 放行', async () => {
    seedExistingGraph(outputDir, { nodes: 0, links: 3, calls: 3 });
    const before = readRaw(outputDir);

    await runGraphCommand(graphCommand({ outputDir, force: true }));

    expect(process.exitCode).toBeUndefined();
    expect(readRaw(outputDir)).not.toBe(before);
  });
});

describe('parse-args — graph 子命令的 --force（F266 FR-003 逃生口）', () => {
  it('spectra graph --force → command.force === true', () => {
    const result = parseArgs(['graph', '--force']);
    expect(result.ok).toBe(true);
    expect(result.ok && result.command.force).toBe(true);
  });

  it('spectra graph（不带 --force）→ command.force === false', () => {
    const result = parseArgs(['graph']);
    expect(result.ok).toBe(true);
    expect(result.ok && result.command.force).toBe(false);
  });
});
