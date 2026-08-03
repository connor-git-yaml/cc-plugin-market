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
});
