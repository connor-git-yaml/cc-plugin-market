/**
 * F249 T048：再生脚本**脚本级**子进程实跑测试（SC-010(b) / plan R4 防守项 9）。
 *
 * 为什么纯函数真值表（T042）不够：真值表只证明"判据算得对"，不证明"脚本真的按判据行事"。
 * 中间还有一整条链——两轨重建、比较器求值、逐轨调用判据、拒绝时**不写盘**、退出码非零、
 * 文案按 `fixtureInputHash` 分流。这条链上任一环断掉（比如 catch 掉判据结果继续写盘、
 * 或 `process.exitCode` 被覆盖成 0），真值表全绿而护栏实际失效。
 *
 * 为什么拒绝场景要三分（a-only / b-only / 双轨）而不是"任意不一致即拒绝"一条：
 * 逐轨独立求值意味着有两条独立的判定路径，只测双轨同时不一致，会放过"只求值 a 轨、b 轨结果
 * 被丢弃"这类实现错误——那正是护栏双轨设计要防的盲区（`moduleDerivationScan` 只被 b 轨覆盖）。
 *
 * 一律经 `--fixture-root` 指向临时副本：入库资产在本测试全程 **MUST NOT** 被触碰。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BEHAVIOR_VERSION } from '../../src/panoramic/graph/collector-fingerprint.js';

const ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/collector-fingerprint-guardrail');
const SCRIPT = path.join(ROOT, 'scripts/regen-collector-fingerprint-fixtures.ts');
const TSX_BIN = path.join(ROOT, 'node_modules/.bin/tsx');

const GRAPH_ONLY_ASSET = 'expected-graph-only-graph.json';
const MODULE_GRAPH_ASSET = 'expected-module-graph.json';
/** F278 项③：`--init` 冷启动再生的审计留痕 sidecar（fixture 根目录，与 README.md 同级）。 */
const AUDIT_FILE = 'regen-audit.jsonl';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 把整份 fixture（src/ + 两份 pinned 资产 + README）复制到临时目录。 */
function stageFixtureRoot(): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-regen-script-'));
  tmpDirs.push(staged);
  fs.cpSync(FIXTURE_ROOT, staged, { recursive: true });
  return staged;
}

function sha256File(target: string): string {
  return createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function assetDigests(fixtureRoot: string): { graphOnly: string; moduleGraph: string } {
  return {
    graphOnly: sha256File(path.join(fixtureRoot, GRAPH_ONLY_ASSET)),
    moduleGraph: sha256File(path.join(fixtureRoot, MODULE_GRAPH_ASSET)),
  };
}

interface ScriptRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runRegenScript(fixtureRoot: string, extraArgs: string[] = []): ScriptRun {
  const result = spawnSync(TSX_BIN, [SCRIPT, '--fixture-root', fixtureRoot, ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  return {
    // status 为 null 表示被信号杀死；归一为 -1 让断言"非零"仍然成立且失败信息可读
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// 下面两个 perturb 函数直接 `JSON.parse` 临时副本里的 pinned 文件：这是**构造被测输入**
// （扮演"有人手工改了 pinned 资产"的场景），不是"消费 pinned 资产做比较"，因此不适用
// "消费方 MUST 经 typed loader 解包"这条约束（plan 决策 9 约束的是解包后喂给比较器/生产 API 的路径）。

/** 扰动 a-track pinned 期望：删一条边 → 重建产物与 pinned 不一致（指纹不变）。 */
function perturbGraphOnlyAsset(fixtureRoot: string): void {
  const assetPath = path.join(fixtureRoot, GRAPH_ONLY_ASSET);
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as {
    graph: { links: unknown[] };
  };
  expect(asset.graph.links.length).toBeGreaterThan(0);
  asset.graph.links.pop();
  fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
}

/** 把两份资产记录的 `behaviorVersion` 同时降 1：造出"结构合法但与当前不等"的指纹。 */
function downgradeBehaviorVersionInBothAssets(fixtureRoot: string): void {
  const graphOnlyPath = path.join(fixtureRoot, GRAPH_ONLY_ASSET);
  const graphOnly = JSON.parse(fs.readFileSync(graphOnlyPath, 'utf-8')) as {
    graph: { graph: { fingerprint: { behaviorVersion: number } } };
  };
  expect(graphOnly.graph.graph.fingerprint.behaviorVersion).toBe(BEHAVIOR_VERSION);
  graphOnly.graph.graph.fingerprint.behaviorVersion = BEHAVIOR_VERSION - 1;
  fs.writeFileSync(graphOnlyPath, `${JSON.stringify(graphOnly, null, 2)}\n`, 'utf-8');

  const modulePath = path.join(fixtureRoot, MODULE_GRAPH_ASSET);
  const moduleAsset = JSON.parse(fs.readFileSync(modulePath, 'utf-8')) as {
    fingerprint: { behaviorVersion: number };
  };
  moduleAsset.fingerprint.behaviorVersion = BEHAVIOR_VERSION - 1;
  fs.writeFileSync(modulePath, `${JSON.stringify(moduleAsset, null, 2)}\n`, 'utf-8');
}

/** 读出两份资产各自记录的 `behaviorVersion`（放行后应双双回到当前值）。 */
function readAssetFingerprints(fixtureRoot: string): { graphOnly: number; moduleGraph: number } {
  const graphOnly = JSON.parse(fs.readFileSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET), 'utf-8')) as {
    graph: { graph: { fingerprint: { behaviorVersion: number } } };
  };
  const moduleAsset = JSON.parse(fs.readFileSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET), 'utf-8')) as {
    fingerprint: { behaviorVersion: number };
  };
  return {
    graphOnly: graphOnly.graph.graph.fingerprint.behaviorVersion,
    moduleGraph: moduleAsset.fingerprint.behaviorVersion,
  };
}

/**
 * F272 ⑤ T-B12：在 fixture 源码里新增一个可被 AST 解析到的顶层导出函数，
 * 使 a-track 重建产物真的偏离 pinned（`aTrack.mismatch === true`），
 * 用于构造"contentMismatch=true 且被放行"的双变量场景（与仅 bump behaviorVersion
 * 的既有放行用例区分开——那条用例不改 fixture 源码，`contentMismatch` 大概率为 false）。
 */
function appendExportedFunctionToFooTs(fixtureRoot: string): void {
  const fooPath = path.join(fixtureRoot, 'src/ts/foo.ts');
  fs.appendFileSync(
    fooPath,
    '\nexport function extraPermitProbe(): string {\n  return \'extra\';\n}\n',
    'utf-8',
  );
}

/**
 * 从 pinned a-track 资产里剥掉某个 symbol 节点的 `metadata.lineRange`：构造**仅** metadata
 * 维度的漂移（节点 id multiset 与边 multiset 两个既有维度全程判绿）。
 *
 * 这正是 F271 lineRange 入库时的真实形态——当时既有两个维度对它完全失明。
 * 返回被剥字段的 node id，供调用方断到具体定位符而非泛化关键词。
 */
function stripLineRangeFromGraphOnlyAsset(fixtureRoot: string): string {
  const assetPath = path.join(fixtureRoot, GRAPH_ONLY_ASSET);
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as {
    graph: { nodes: Array<{ id: string; metadata?: Record<string, unknown> }> };
  };
  const victim = asset.graph.nodes.find((node) => node.metadata?.lineRange !== undefined);
  expect(victim).toBeDefined();
  const target = victim as { id: string; metadata: Record<string, unknown> };
  delete target.metadata.lineRange;
  fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
  return target.id;
}

/** 扰动 b-track pinned 期望：删一条 module 边 → 重建产物与 pinned 不一致（指纹不变）。 */
function perturbModuleGraphAsset(fixtureRoot: string): void {
  const assetPath = path.join(fixtureRoot, MODULE_GRAPH_ASSET);
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as {
    moduleGraph: { edges: unknown[] };
  };
  expect(asset.moduleGraph.edges.length).toBeGreaterThan(0);
  asset.moduleGraph.edges.pop();
  fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
}

describe('再生脚本 — 放行/无变更场景（活性证明）', () => {
  it('未改动的 fixture 副本：exit 0、报告无需更新、两份资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('无需更新');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  /**
   * 放行路径的端到端证据（FR-005(e) 的"指纹已变 → 正常放行再生"半边）。
   *
   * 构造方式：把**两份**资产记录的 `behaviorVersion` 同时改成 `当前值 - 1`。
   * 为什么改两份而不是一份：前置一致性校验要求两份记录的指纹彼此相等，只改一份会先被它挡下，
   * 测到的就是前置校验而不是放行判据。为什么改 `behaviorVersion` 而不是扩展面：它能在不改任何
   * 源码的前提下造出"结构合法但与当前不等"的指纹——这正是维护者 bump 版本后跑再生的真实形态。
   */
  it('pinned 指纹结构合法但与当前不等（已 bump 场景）→ exit 0、明确报告放行、两份资产被重写为当前指纹', () => {
    const fixtureRoot = stageFixtureRoot();
    const before = assetDigests(fixtureRoot);
    downgradeBehaviorVersionInBothAssets(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('放行');
    expect(run.stdout).toContain('fingerprintUnchanged=false');
    expect(run.stdout).toContain('已更新两份 pinned 资产');

    // 两份资产都被重写，且记录的 behaviorVersion 回到当前值（不是停留在被降级的旧值）
    expect(readAssetFingerprints(fixtureRoot)).toEqual({
      graphOnly: BEHAVIOR_VERSION,
      moduleGraph: BEHAVIOR_VERSION,
    });
    // 重写结果与"未改动副本"字节一致 —— 证明放行路径产出的就是正常基线，而非某种半成品
    expect(assetDigests(fixtureRoot)).toEqual(before);
    // 无 .bak / .tmp-* 残留
    expect(
      fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.bak') || name.includes('.tmp-')),
    ).toEqual([]);
    // F278 返工 A6：**常规**再生路径 MUST NOT 留痕（FR-021）。入库 fixture 里没有
    // `regen-audit.jsonl`，本次跑的是常规路径，跑完也不该造出它。
    // 鉴别力来源：删掉 `runRegen` 里 `if (init)` 这道守卫后，本次常规再生会写出一条
    // `trigger:"--init"` 的字面撒谎记录，而在补这条断言之前 16 条集成用例对此全部无感。
    expect(fs.existsSync(path.join(fixtureRoot, AUDIT_FILE))).toBe(false);
  });

  /**
   * F272 ⑤ T-B12：contentMismatch=true 且被放行的双变量场景（FR-005 放行分支打印 differences）。
   *
   * 与上一条"仅 bump behaviorVersion"用例的关键区别：上一条不改 fixture 源码，
   * `aTrack.mismatch` 大概率为 false，无法测出放行分支新增的"打印 differences"行为；
   * 本用例同时构造①fixture 源码变化（新增顶层导出函数 → a-track 重建产物真的偏离 pinned）
   * ②指纹变化（downgrade behaviorVersion → fingerprintUnchanged=false），确保二者都成立时
   * 走的仍是放行分支（`shouldRejectRegen` 只在 contentMismatch ∧ fingerprintUnchanged 时拒绝，
   * fingerprintUnchanged=false ⇒ 不拒绝），从而验证放行分支真的把已算好的 differences 打印出来。
   */
  it('contentMismatch=true 且指纹已变 → exit 0、放行、且打印具体差异文案（非空泛 differences 字样）', () => {
    const fixtureRoot = stageFixtureRoot();
    appendExportedFunctionToFooTs(fixtureRoot);
    downgradeBehaviorVersionInBothAssets(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('放行');
    expect(run.stdout).toContain('fingerprintUnchanged=false');
    // contentMismatch 必须真的为 true（否则本用例退化成上一条的复制，测不出新增的打印分支）
    expect(run.stdout).toMatch(/contentMismatch=true/);
    // 断到具体差异文案（新增导出函数产生的节点，仅存在于重建产物），而非空泛的 "differences" 字样
    expect(run.stdout).toContain('[regen]   - 节点仅存在于重建产物: src/ts/foo.ts::extraPermitProbe');
  });
});

describe('再生脚本 — 拒绝场景三分（逐轨独立求值，FR-005(e)）', () => {
  it('(a) a-track-only mismatch：仅 graph-only 轨不一致 → 非零退出 + 仅指名 a-track + 资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    perturbGraphOnlyAsset(fixtureRoot);
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝再生');
    expect(run.stderr).toContain('a-track(graph-only)');
    expect(run.stderr).not.toContain('b-track');
    // fixture 源码未动 → 走 producer 行为漂移文案
    expect(run.stderr).toContain('检测到指纹不可见的行为变更');
    expect(run.stderr).toContain('两份 pinned 资产均未写盘');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  it('(b) b-track-only mismatch：仅 module 轨不一致 → 非零退出 + 仅指名 b-track + 资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    perturbModuleGraphAsset(fixtureRoot);
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝再生');
    expect(run.stderr).toContain('b-track(module-graph)');
    expect(run.stderr).not.toContain('a-track');
    expect(run.stderr).toContain('检测到指纹不可见的行为变更');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  it('(c) 双轨 mismatch：两轨均不一致 → 非零退出 + 同时指名两轨 + 资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    perturbGraphOnlyAsset(fixtureRoot);
    perturbModuleGraphAsset(fixtureRoot);
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('a-track(graph-only)');
    expect(run.stderr).toContain('b-track(module-graph)');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  it('(d) fixture 基线变更未 bump：双轨不一致 + inputHash 已变 → 走基线变更文案（诊断分流的另一支）', () => {
    const fixtureRoot = stageFixtureRoot();
    // 新增一个 .ts 样本：a 轨多出节点、b 轨多出 module，且 fixtureInputHash 随之变化
    fs.writeFileSync(
      path.join(fixtureRoot, 'src/ts/extra.ts'),
      'export function extra(): number {\n  return 2;\n}\n',
      'utf-8',
    );
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('检测到 fixture 基线变更');
    expect(run.stderr).not.toContain('检测到指纹不可见的行为变更');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  /**
   * F278 返工 A7：metadata-only 漂移走**常规再生**的拒绝路径，端到端。
   *
   * 为什么单测（`compareGraphOnlyStructure` 的扰动注入组）不够：那只证明"比较器会报差异"，
   * 不证明这条差异真的接进了脚本的拒绝链路——中间还隔着"第三维度的 differences 被并进
   * aTrack.differences"、"aTrack.mismatch 传给 shouldRejectRegen"、"拒绝时两份资产不写盘"
   * 三个环节，任一环断掉单测全绿而护栏实际失效。
   *
   * 同时钉住 B2 新增的 metadata 维度专属处置指引：没有它，维护者按既有文案只剩
   * "做一次按权威清单为错的 bump"或"rm + --init 全绕过"两条路。
   */
  it('(e) metadata-only 漂移：pinned 少一个 lineRange → 非零退出 + 指名 metadata 维度 + 资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    const victimId = stripLineRangeFromGraphOnlyAsset(fixtureRoot);
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝再生');
    // 只有 a 轨该被指名：b 轨资产一字未动，metadata 维度只作用于 a 轨
    expect(run.stderr).toContain('a-track(graph-only)');
    expect(run.stderr).not.toContain('b-track');
    // fixture 源码未动 → inputHash 未变 → 走 producer 行为漂移文案
    expect(run.stderr).toContain('检测到指纹不可见的行为变更');
    // 断到含格子与具体 node id 的完整定位文案（pinned 缺 lineRange ⇒ 重建侧"新增"）
    expect(run.stderr).toContain(
      `metadata key 集合不一致（重建缺失 [] vs 重建新增 [lineRange]）: ${victimId}`,
    );
    // B2：metadata 维度专属处置指引（六类 bump responsibility 不覆盖节点字段集合）
    expect(run.stderr).toContain('六类 bump responsibility');
    expect(run.stderr).toContain('rm expected-graph-only-graph.json expected-module-graph.json');
    expect(run.stderr).toContain('两份 pinned 资产均未写盘');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });
});

describe('再生脚本 — 前置一致性校验（P11）', () => {
  it('两份资产的 fixtureInputHash 彼此不一致 → 非零退出、不进入重建/写盘', () => {
    const fixtureRoot = stageFixtureRoot();
    const assetPath = path.join(fixtureRoot, MODULE_GRAPH_ASSET);
    const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as {
      fixtureInputHash: string;
    };
    asset.fixtureInputHash = 'deadbeef'.repeat(8);
    fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('前置一致性校验失败');
    expect(run.stderr).toContain('fixtureInputHash 彼此不一致');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  it('pinned 资产指纹结构畸形 → 非零退出，提示人工核查', () => {
    const fixtureRoot = stageFixtureRoot();
    const assetPath = path.join(fixtureRoot, MODULE_GRAPH_ASSET);
    const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8')) as Record<string, unknown>;
    asset['fingerprint'] = {};
    fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, 'utf-8');
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('前置一致性校验失败');
    expect(run.stderr).toContain('人工核查');
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });
});

describe('再生脚本 — --init 冷启动路径', () => {
  it('pinned 资产缺席时 --init 可生成两份资产，且随后常规运行判定无需更新', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));

    const init = runRegenScript(fixtureRoot, ['--init']);
    expect(init.status).toBe(0);
    expect(fs.existsSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET))).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET))).toBe(true);

    // 幂等：紧接着的常规运行必须判"无需更新"且不写盘（证明 --init 产出的资产与常规重建自洽）
    const before = assetDigests(fixtureRoot);
    const followUp = runRegenScript(fixtureRoot);
    expect(followUp.status).toBe(0);
    expect(followUp.stdout).toContain('无需更新');
    expect(assetDigests(fixtureRoot)).toEqual(before);

    // 无 .bak / .tmp-* 残留
    expect(
      fs.readdirSync(fixtureRoot).filter((name) => name.endsWith('.bak') || name.includes('.tmp-')),
    ).toEqual([]);
  });

  it('两份资产均缺席但**未**加 --init → 非零退出并提示冷启动方式（不静默重建基线）', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('前置一致性校验失败');
    expect(run.stderr).toContain('--init');
  });

  // ── C-002：--init 会跳过全部拒绝判据，因此只允许在"两份资产均缺席"时使用 ──

  it('C-002：两份资产完整存在 + --init → 拒绝并非零退出，两份资产字节不变', () => {
    const fixtureRoot = stageFixtureRoot();
    const before = assetDigests(fixtureRoot);

    const run = runRegenScript(fixtureRoot, ['--init']);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝 --init');
    expect(run.stderr).toContain(GRAPH_ONLY_ASSET);
    expect(run.stderr).toContain(MODULE_GRAPH_ASSET);
    // 关键：不写盘。否则"护栏变红 → 跑一下 --init"就是一条一步到位的绕过路径
    expect(assetDigests(fixtureRoot)).toEqual(before);
  });

  it('C-002：仅缺一份资产 + --init → 同样拒绝（残留那份不得被静默覆写）', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    const survivorBefore = sha256File(path.join(fixtureRoot, MODULE_GRAPH_ASSET));

    const run = runRegenScript(fixtureRoot, ['--init']);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝 --init');
    expect(run.stderr).toContain(MODULE_GRAPH_ASSET);
    expect(run.stderr).toContain('手动删除');
    expect(fs.existsSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET))).toBe(false);
    expect(sha256File(path.join(fixtureRoot, MODULE_GRAPH_ASSET))).toBe(survivorBefore);
  });

  it('C-002：仅缺一份资产且未加 --init → 拒绝，且文案 MUST NOT 建议用 --init（避免有害引导）', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));

    const run = runRegenScript(fixtureRoot);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('前置一致性校验失败');
    expect(run.stderr).toContain('人工核查');
    // 单份缺失是异常状态，"用 --init 重建基线"会把异常掩盖成新基线
    expect(run.stderr).toContain('MUST NOT 用 --init');
  });

  // ── F278 项③：`--init` 冷启动再生的审计留痕（FR-018 / FR-019 / FR-020） ──

  /** 只取非空行：`appendFileSync` 每条以 `\n` 结尾，split 后末尾恒有一个空串。 */
  function readAuditLines(fixtureRoot: string): string[] {
    const auditPath = path.join(fixtureRoot, AUDIT_FILE);
    if (!fs.existsSync(auditPath)) return [];
    return fs
      .readFileSync(auditPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() !== '');
  }

  /**
   * 预置一行占位审计记录。
   *
   * A1 用它证明写入是 **append** 而非覆写（覆写会抹掉"上一次基线是谁建的"，而审计的全部价值
   * 就在历史序列）；A2 用它避免"文件本就不存在 → 断言不存在"这种恒真的空断言。
   */
  function seedAuditPlaceholder(fixtureRoot: string): string {
    const placeholder = JSON.stringify({ timestamp: '1970-01-01T00:00:00.000Z', trigger: 'seed' });
    fs.writeFileSync(path.join(fixtureRoot, AUDIT_FILE), `${placeholder}\n`, 'utf-8');
    return placeholder;
  }

  it('A1：--init 冷启动成功后写出一条审计记录（append，字段可逐一断言）', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));
    const placeholder = seedAuditPlaceholder(fixtureRoot);

    const startedAt = Date.now();
    const init = runRegenScript(fixtureRoot, ['--init']);
    const finishedAt = Date.now();
    expect(init.status).toBe(0);

    const lines = readAuditLines(fixtureRoot);
    expect(lines.length).toBe(2);
    // append 而非覆写：预置的历史条目必须原样保留
    expect(lines[0]).toBe(placeholder);

    const entry = JSON.parse(lines[1] as string) as {
      timestamp: string;
      trigger: string;
      fixtureInputHash: string;
      behaviorVersion: number;
      assets: string[];
    };
    expect(entry.trigger).toBe('--init');
    expect(entry.behaviorVersion).toBe(BEHAVIOR_VERSION);
    expect(entry.assets.sort()).toEqual([GRAPH_ONLY_ASSET, MODULE_GRAPH_ASSET].sort());

    // 时间戳必须真的来自本次运行：±2s 容差只为吸收时钟微调，仍能抓出写死/陈旧的时间戳
    const parsed = Date.parse(entry.timestamp);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThanOrEqual(startedAt - 2000);
    expect(parsed).toBeLessThanOrEqual(finishedAt + 2000);

    // fixtureInputHash 是"把磁盘上这份资产对上某条审计条目"的唯一锚点，必须与落盘资产一致
    expect(entry.fixtureInputHash).toMatch(/^[0-9a-f]{64}$/);
    const assetHash = (
      JSON.parse(fs.readFileSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET), 'utf-8')) as {
        fixtureInputHash: string;
      }
    ).fixtureInputHash;
    expect(entry.fixtureInputHash).toBe(assetHash);
  });

  it('A2：--init 被 C-002 拒绝时 MUST NOT 写审计记录（未发生再生就不得留痕）', () => {
    const fixtureRoot = stageFixtureRoot();
    seedAuditPlaceholder(fixtureRoot);
    const before = readAuditLines(fixtureRoot);
    expect(before.length).toBe(1);

    const run = runRegenScript(fixtureRoot, ['--init']);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('拒绝 --init');
    expect(readAuditLines(fixtureRoot)).toEqual(before);
  });

  /**
   * A3（F278 返工）：审计写盘失败 MUST 只降级为 warning，MUST NOT 让整体非零退出。
   *
   * 构造：把 `regen-audit.jsonl` 这个路径**预置成目录**，`appendFileSync` 对目录必抛 EISDIR。
   *
   * 为什么这条不是"锦上添花"：去掉 `appendRegenAudit` 的 `try/catch` 后 16 条既有用例全绿，
   * 而真实后果正是该函数注释里写明要避免的最坏状态——脚本报失败、但两份资产已经是新内容，
   * 维护者以为没生成而重跑，重跑必然被 C-002 拒绝（资产已存在），卡死在只能手工删资产才能
   * 脱身的坑里。这里连跑一次常规再生把"资产确实已是新内容"实测出来，而不是只看退出码。
   */
  it('A3：审计写盘失败（regen-audit.jsonl 被占为目录）→ 仍 exit 0、两份资产已更新、只出 warning', () => {
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));
    fs.mkdirSync(path.join(fixtureRoot, AUDIT_FILE));

    const init = runRegenScript(fixtureRoot, ['--init']);

    expect(init.status).toBe(0);
    expect(init.stdout).toContain('已更新两份 pinned 资产');
    expect(init.stderr).toContain('审计留痕写入失败');
    expect(fs.existsSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET))).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET))).toBe(true);

    // 资产不是半成品：紧接着的常规运行判"无需更新"，即两份资产与当前重建产物自洽
    const followUp = runRegenScript(fixtureRoot);
    expect(followUp.status).toBe(0);
    expect(followUp.stdout).toContain('无需更新');
  });

  /**
   * A4（F278 返工）：swap 失败时审计**行数不变**——留痕 MUST 发生在提交点之后。
   *
   * 为什么 A2（C-002 拒绝分支）不够：那条在两轨重建之前就 early return，对"审计调用被挪到
   * `swapPinnedAssets` 之前"这个变异毫无鉴别力（挪过去之后 A1/A2 仍全绿）。而真实后果是给
   * 一次**零产物**的失败运行留下一条完整留痕，账本从此说假话。
   *
   * 构造：把 fixture 根目录的写位摘掉。`swapPinnedAssets` 的 `writeFileSync(<tmp>)` 需要在
   * 目录里**新建**条目 → EACCES；而向**已存在**的审计文件 append 只需该文件自身的写位，
   * 不受目录位影响——这正是本用例鉴别力的来源：若留痕被挪到 swap 之前，它会写成功。
   */
  it('A4：swap 失败（fixture 根目录只读）→ 非零退出且审计行数不变（留痕 MUST 在提交点之后）', () => {
    // root 无视权限位，本用例在 root 下无鉴别力，直接标记跳过而不是假绿通过
    if (process.getuid?.() === 0) {
      expect.soft(true, 'skipped: running as root').toBe(true);
      return;
    }
    const fixtureRoot = stageFixtureRoot();
    fs.rmSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET));
    fs.rmSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET));
    seedAuditPlaceholder(fixtureRoot);
    const before = readAuditLines(fixtureRoot);
    expect(before.length).toBe(1);

    fs.chmodSync(fixtureRoot, 0o555);
    try {
      const run = runRegenScript(fixtureRoot, ['--init']);

      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain('pinned 资产写盘失败');
      // 零产物：两份资产一份都没落盘
      expect(fs.existsSync(path.join(fixtureRoot, GRAPH_ONLY_ASSET))).toBe(false);
      expect(fs.existsSync(path.join(fixtureRoot, MODULE_GRAPH_ASSET))).toBe(false);
      // 核心断言：这次失败运行 MUST NOT 在账本上留下任何痕迹
      expect(readAuditLines(fixtureRoot)).toEqual(before);
    } finally {
      // 还原写位，否则 afterEach 的 rmSync 删不掉目录内容
      fs.chmodSync(fixtureRoot, 0o755);
    }
  });
});
