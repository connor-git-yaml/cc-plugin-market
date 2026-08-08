/**
 * F261 第三轮 D3（红先行）— `scripts/graph-semantic-diff.mjs` 的 provenance banner。
 *
 * ## 为什么这条工作流必须被覆盖
 *
 * fix-report 那起事故当时的真实动作是"**把两张图拿来对比、看到 148 节点差**"。而在这条工作流里，
 * 三维 provenance（`sourceCommit` / `fingerprint` / `builder`）目前**一个字都不出现**——实测
 * （修复前）：两张 `nodes`/`links` 完全相同、builder 分属两版 build 的图，脚本输出
 * `[PASS] 全部差异归因到三类 allowlist`，全文对 builder / sourceCommit / fingerprint 的提及数为 **0**。
 * 于是"差异其实来自工具版本而非源码"这一最可能的解释，在最需要它的场景里不可见。
 *
 * ## 约束（主线程裁决 D3）
 *
 * banner 是**纯输出增量**：MUST NOT 改 exit code、MUST NOT 新增 repo:check check
 * （`spec-drift-repo-check-regression.test.ts` 把 check id 精确钉死为 7 项）、MUST NOT 改
 * `--json` schema。本文件对"不改 exit code"两个方向都下断言（PASS 场景与 FAIL 场景各一）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolve } from 'node:path';

const SCRIPT = resolve('scripts/graph-semantic-diff.mjs');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runDiff(oldPath: string, newPath: string): RunResult {
  const res = spawnSync('node', [SCRIPT, oldPath, newPath], { encoding: 'utf-8', timeout: 30_000 });
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.status ?? 1 };
}

const BUILDER_A = {
  formatVersion: 1,
  commit: 'a'.repeat(40),
  dirty: false,
  sourceDirty: false,
  distSha256: '1'.repeat(64),
};
const BUILDER_B = {
  ...BUILDER_A,
  distSha256: '2'.repeat(64),
};

/** 最小图：两个节点 + 一条 contains 边（够跑完三类归因）。 */
function graphFixture(meta: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      schemaVersion: '2.0',
      nodeCount: 2,
      edgeCount: 1,
      ...meta,
    },
    nodes: [
      { id: 'src/a.ts', kind: 'module', label: 'a.ts', metadata: {} },
      { id: 'src/a.ts::Foo', kind: 'component', label: 'Foo', metadata: {} },
    ],
    links: [{ source: 'src/a.ts', target: 'src/a.ts::Foo', relation: 'contains' }],
  };
}

describe('graph-semantic-diff — provenance banner（F261 D3）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-semdiff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, graph: unknown): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, JSON.stringify(graph, null, 2), 'utf-8');
    return p;
  }

  it('两图 provenance 完全相同 → 不打 banner（零噪声），exit 0', () => {
    const meta = { sourceCommit: 'c'.repeat(40), builder: BUILDER_A, fingerprint: { behaviorVersion: 7 } };
    const a = write('old.json', graphFixture(meta));
    const b = write('new.json', graphFixture(meta));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain('[provenance]');
  });

  it('builder 不同（节点/边完全相同）→ 打出 banner，且 exit code 仍为 0', () => {
    const a = write('old.json', graphFixture({ sourceCommit: 'c'.repeat(40), builder: BUILDER_A }));
    const b = write('new.json', graphFixture({ sourceCommit: 'c'.repeat(40), builder: BUILDER_B }));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[provenance]');
    expect(res.stdout).toContain('工具版本');
    // 两侧 dist 短值都要出现，否则读者无法判断哪一张是旧 build 建的
    expect(res.stdout).toContain(BUILDER_A.distSha256.slice(0, 12));
    expect(res.stdout).toContain(BUILDER_B.distSha256.slice(0, 12));
  });

  it('banner 出现在三类归因明细之前（先看见 provenance 才不会误读差异）', () => {
    const a = write('old.json', graphFixture({ builder: BUILDER_A }));
    const b = write('new.json', graphFixture({ builder: BUILDER_B }));

    const res = runDiff(a, b);

    expect(res.stdout.indexOf('[provenance]')).toBeGreaterThanOrEqual(0);
    expect(res.stdout.indexOf('[provenance]')).toBeLessThan(res.stdout.indexOf('[类1]'));
  });

  it('sourceCommit 不同 → banner 点名 sourceCommit 维度', () => {
    const a = write('old.json', graphFixture({ sourceCommit: 'c'.repeat(40), builder: BUILDER_A }));
    const b = write('new.json', graphFixture({ sourceCommit: 'd'.repeat(40), builder: BUILDER_A }));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('sourceCommit');
    expect(res.stdout).toContain('ccccccc');
    expect(res.stdout).toContain('ddddddd');
  });

  it('fingerprint 不同 → banner 点名 fingerprint 维度', () => {
    const a = write('old.json', graphFixture({ fingerprint: { behaviorVersion: 7 } }));
    const b = write('new.json', graphFixture({ fingerprint: { behaviorVersion: 8 } }));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[provenance]');
    expect(res.stdout).toContain('fingerprint');
  });

  it('builder 记录形态（缺失 / null / 不可识别）分别有独立措辞，且控制字符不外泄', () => {
    const esc = String.fromCharCode(27);
    const a = write('old.json', graphFixture({ builder: null }));
    const b = write(
      'new.json',
      graphFixture({ builder: { ...BUILDER_A, commit: `${esc}[2J${esc}[H` } }),
    );

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('unstamped');
    expect(res.stdout).toContain('unrecognized');
    expect(new RegExp('[\\u0000-\\u001f]').test(res.stdout.replace(/\n/g, ''))).toBe(false);
  });

  /**
   * D6 配套（第四轮）—— 保留通道让"读不懂的外来 builder"成为磁盘上的**长期常态**，
   * 因此本脚本这条消费面的值域闸口从"防御性冗余"升级为**唯一防线**。
   *
   * 第四轮之前，这类值在 `spectra community` 回写时会被 collapse 成 null（写盘侧顺带销毁证据）；
   * D6 裁决改为原样保留（旧版本无权抹掉更新版本写入的内容），于是"绝对路径 / 时间戳 / 控制字符
   * 不进终端"这条不变量**只剩消费侧**兜着。这里对**值**与**键名**两侧同时下断言。
   */
  it('D6：保留下来的不可识别 builder（路径 / 时间戳值 + 控制字符键名）在 banner 中零外泄', () => {
    const esc = String.fromCharCode(27);
    const a = write(
      'old.json',
      graphFixture({
        builder: {
          formatVersion: 2,
          commit: `${esc}[2J${esc}[H`,
          distSha256: '/Users/alice/secret',
          builtAtIso: '2026-08-08T09:00:00Z',
        },
      }),
    );
    const b = write(
      'new.json',
      graphFixture({
        builder: {
          formatVersion: 2,
          commit: '/etc/passwd',
          distSha256: '/Users/bob/x',
          [`${esc}[31mevilKey`]: 'v',
        },
      }),
    );

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('unrecognized');
    // 两侧渲染值相同 ⇒ 必须点名差异落点，但落点只能是**消毒后的键名**
    expect(res.stdout).toContain('<非常规字段名>');
    for (const leak of ['/Users/alice', '/Users/bob', '/etc/passwd', '2026-08-08', 'evilKey']) {
      expect(res.stdout).not.toContain(leak);
    }
    expect(new RegExp('[\\u0000-\\u001f]').test(res.stdout.replace(/\n/g, ''))).toBe(false);
  });

  it('fail-closed 判定不被 banner 影响：存在未归因差异时仍 exit 1', () => {
    const a = write('old.json', graphFixture({ builder: BUILDER_A }));
    const withExtra = graphFixture({ builder: BUILDER_B }) as { nodes: unknown[] };
    withExtra.nodes.push({ id: 'src/b.ts::Bar', kind: 'component', label: 'Bar', metadata: {} });
    const b = write('new.json', withExtra);

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(1);
    expect(res.stdout).toContain('[provenance]');
  });

  /**
   * banner 的判据必须只对**语义差异**触发。朴素的 `JSON.stringify(a) !== JSON.stringify(b)`
   * 是**键序敏感**的：两份字段完全相同、只是书写顺序不同的 fingerprint（手工编辑过的图、
   * 或另一个序列化器产出的图）会被判为"不同"，打出一条纯噪声的 banner。
   */
  it('键序不同但语义相同的 fingerprint → 不打 banner（键序不敏感）', () => {
    const a = write('old.json', graphFixture({ fingerprint: { behaviorVersion: 7, pipelines: { x: 1, y: 2 } } }));
    const b = write('new.json', graphFixture({ fingerprint: { pipelines: { y: 2, x: 1 }, behaviorVersion: 7 } }));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain('[provenance]');
  });

  /**
   * 对抗复审 W1：判据比对**整个对象**，渲染却只暴露一两个字段（fingerprint 只打
   * `behaviorVersion`，builder 只打 `commit`/`dist`）。差异落在未渲染字段时，banner 会声称
   * "provenance 不同"，紧接着的证据行两侧**一模一样** —— 读者最可能的反应是判定工具有 bug 并
   * 忽略整条提示，比不打 banner 更糟。
   *
   * 这不是边角形态：`CollectorFingerprint = { formatVersion, extensionSurface, behaviorVersion }`，
   * 而 F249 的设计口径就是「extensionSurface 变化自动改指纹、无需 bump behaviorVersion」
   * （F243 `.mjs/.cjs`、F250 `.pyi` 都走这条）⇒ 跨版本两图 fingerprint 不同的**最常见真实形态**
   * 恰好渲染成 `behaviorVersion=7 → behaviorVersion=7`。
   */
  it('W1：fingerprint 差异落在未展示字段 → 必须点名差异字段，不得留下"说不同、证据相同"', () => {
    const a = write(
      'old.json',
      graphFixture({ fingerprint: { behaviorVersion: 7, extensionSurface: ['.ts'] } }),
    );
    const b = write(
      'new.json',
      graphFixture({ fingerprint: { behaviorVersion: 7, extensionSurface: ['.ts', '.mjs'] } }),
    );

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[provenance]');
    expect(res.stdout).toContain('差异在未展示字段');
    expect(res.stdout).toContain('extensionSurface');
  });

  it('W1：builder 差异落在未展示字段（dirty）→ 同样点名该字段', () => {
    const a = write('old.json', graphFixture({ builder: BUILDER_A }));
    const b = write('new.json', graphFixture({ builder: { ...BUILDER_A, dirty: true } }));

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('差异在未展示字段');
    expect(res.stdout).toContain('dirty');
  });

  it('W1 对照：差异落在已展示字段时，不追加"未展示字段"括注（零噪声）', () => {
    const a = write('old.json', graphFixture({ builder: BUILDER_A }));
    const b = write('new.json', graphFixture({ builder: BUILDER_B }));

    const res = runDiff(a, b);

    expect(res.stdout).toContain('[provenance]');
    expect(res.stdout).not.toContain('差异在未展示字段');
  });

  it('W1：未展示字段名来自外部 JSON，必须过消毒（控制字符/超长名不得原样进终端）', () => {
    const esc = String.fromCharCode(27);
    const a = write('old.json', graphFixture({ fingerprint: { behaviorVersion: 7 } }));
    const b = write(
      'new.json',
      graphFixture({ fingerprint: { behaviorVersion: 7, [`${esc}[2J evil`]: 1 } }),
    );

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('差异在未展示字段');
    expect(new RegExp('[\\u0000-\\u001f]').test(res.stdout.replace(/\n/g, ''))).toBe(false);
  });

  it('两图都没有 graph.graph 元数据（极旧产物）→ 不打 banner、不崩溃', () => {
    const bare = { nodes: [], links: [] };
    const a = write('old.json', bare);
    const b = write('new.json', bare);

    const res = runDiff(a, b);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain('[provenance]');
    expect(res.stderr).toBe('');
  });
});
