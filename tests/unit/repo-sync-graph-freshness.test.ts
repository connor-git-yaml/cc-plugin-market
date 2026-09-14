/**
 * M11 卡 D（簇⑦ 图新鲜度自动化）：`repo:sync` 顺带把 stale / 缺失 / 无法评估的图用 `batch --mode graph-only` 重建。
 *
 * 决策与执行分离：决策纯函数可穷举（白名单，未识别值不落到 noop——账本两次记过「判据写成值枚举=每加一个值漏一次」）；
 * 执行通过注入的 dist / probe / rebuild 验证接线；三个默认 seam 用假 dist 脚本真 spawn 一遍（对抗审查角 B W-3：
 * 此前只测注入 seam，生产接线任意改写不转红）。
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  decideGraphFreshnessAction,
  syncGraphFreshness,
  listRepoSyncStepIds,
  defaultProbeGraphStatus,
  defaultRebuildGraph,
  resolveDistState,
  describeRepoSyncStepResult,
  stepStatusFor,
} from '../../scripts/lib/repo-maintenance-core.mjs';

const okProbe = { failed: false, graphExists: true, graphUnusable: false, freshness: 'fresh', treeDirty: false, builtFromDirtyTree: false, gitAvailable: true, overallVerdict: 'pass' };
const dist = { exists: true, stale: false, commit: null, head: null, sourceDirty: null };
type FreshnessResult = { action: string; before?: string; after?: string; rebuilt: boolean; error?: string };

describe('decideGraphFreshnessAction（纯决策，白名单）', () => {
  it('没有 dist → skip-no-dist；dist 的 commit 不是当前 HEAD → skip-stale-dist（旧 collector 建的图指纹看不出来）', () => {
    expect(decideGraphFreshnessAction({ dist: { ...dist, exists: false }, probe: { ...okProbe, freshness: 'stale' } })).toBe('skip-no-dist');
    expect(decideGraphFreshnessAction({ dist: { ...dist, stale: true }, probe: { ...okProbe, freshness: 'stale' } })).toBe('skip-stale-dist');
  });
  it('probe 失败 → skip-probe-failed，不盲目重建也不假装 fresh', () => {
    expect(decideGraphFreshnessAction({ dist, probe: { failed: true } })).toBe('skip-probe-failed');
  });
  it('图缺失 → rebuild；图不可用（JSON 损坏 / schema 不受支持 / 空图 / 无 symbol 节点）→ rebuild，不论 freshness 占位值是什么', () => {
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphExists: false, freshness: 'unknown-provenance' } })).toBe('rebuild');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphUnusable: true, freshness: 'unknown-provenance', overallVerdict: 'cannot-assess' } })).toBe('rebuild');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphUnusable: true, freshness: 'fresh', overallVerdict: 'cannot-assess' } })).toBe('rebuild');
  });
  it('工作树有未提交源码改动 → skip-dirty，即使图同时 stale / 缺失 / 不可用（重建会把未提交状态烤进图）', () => {
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'stale', treeDirty: true } })).toBe('skip-dirty');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'dirty', treeDirty: true } })).toBe('skip-dirty');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'dirty' } })).toBe('skip-dirty');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphExists: false, freshness: 'unknown-provenance', treeDirty: true } })).toBe('skip-dirty');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphUnusable: true, freshness: 'unknown-provenance', treeDirty: true } })).toBe('skip-dirty');
  });
  it('stale 且树干净 → rebuild', () => {
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'stale' } })).toBe('rebuild');
  });
  it('unknown-provenance：git 可用 → rebuild；git 不可用 → skip-no-git（重建也写不出 sourceCommit，不做无限重建）', () => {
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'unknown-provenance' } })).toBe('rebuild');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness: 'unknown-provenance', gitAvailable: false } })).toBe('skip-no-git');
  });
  it('fresh + pass → noop；fresh + 图不可用 → rebuild（cannot-assess 的原因由 graphUnusable 白名单判，不再看 overallVerdict 黑名单）', () => {
    expect(decideGraphFreshnessAction({ dist, probe: okProbe })).toBe('noop');
    expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, graphUnusable: true, overallVerdict: 'cannot-assess' } })).toBe('rebuild');
  });
  it('未识别的 freshness 值（未来新增 / 拼错 / 空串）→ skip-unrecognized-freshness，不落到 noop', () => {
    for (const freshness of ['partially-stale', 'STALE', '', undefined]) {
      expect(decideGraphFreshnessAction({ dist, probe: { ...okProbe, freshness } })).toBe('skip-unrecognized-freshness');
    }
  });
});

describe('syncGraphFreshness（注入 dist / probe / rebuild 的接线）', () => {
  it('stale + 树干净 → 调用 rebuild 一次并复探一次，结果记录 before/after', () => {
    const probe = vi.fn().mockReturnValueOnce({ ...okProbe, freshness: 'stale' }).mockReturnValueOnce(okProbe);
    const rebuild = vi.fn().mockReturnValue({ ok: true });
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild).toHaveBeenCalledWith('/repo');
    expect(r).toMatchObject({ action: 'rebuild', before: 'stale', after: 'fresh', rebuilt: true });
  });
  it('stale + 树脏 → skip-dirty，rebuild 零调用', () => {
    const probe = vi.fn().mockReturnValue({ ...okProbe, freshness: 'stale', treeDirty: true });
    const rebuild = vi.fn();
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).not.toHaveBeenCalled();
    expect(r).toMatchObject({ action: 'skip-dirty', before: 'stale', rebuilt: false });
  });
  it('fresh → 不调用 rebuild', () => {
    const probe = vi.fn().mockReturnValue(okProbe);
    const rebuild = vi.fn();
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).not.toHaveBeenCalled();
    expect(r).toMatchObject({ action: 'noop', before: 'fresh', rebuilt: false });
  });
  it('probe 失败的真实形态（{ failed: true }）→ skip-probe-failed，rebuild 零调用', () => {
    const probe = vi.fn().mockReturnValue({ failed: true, error: 'stdout 不是 JSON' });
    const rebuild = vi.fn();
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).not.toHaveBeenCalled();
    expect(r).toMatchObject({ action: 'skip-probe-failed', rebuilt: false });
    expect(String(r.error)).toContain('stdout 不是 JSON');
  });
  it('probe 抛错（注入 seam 异常）→ 收敛为 skip-probe-failed，不逃逸', () => {
    const probe = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const rebuild = vi.fn();
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).not.toHaveBeenCalled();
    expect(r).toMatchObject({ action: 'skip-probe-failed', rebuilt: false });
    expect(String(r.error)).toContain('boom');
  });
  it('rebuild 抛错 → 结果 rebuilt:false 并携带错误信息，不让整条 repo:sync 崩掉', () => {
    const probe = vi.fn().mockReturnValue({ ...okProbe, freshness: 'stale' });
    const rebuild = vi.fn().mockImplementation(() => { throw new Error('spectra batch failed'); });
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(r).toMatchObject({ action: 'rebuild', rebuilt: false });
    expect(String(r.error)).toContain('spectra batch failed');
  });
  it('重建后复探仍 unknown-provenance → 结果带 error 说明未收敛（避免每次 sync 白烧一次全量重建而无人知晓）', () => {
    const probe = vi.fn().mockReturnValue({ ...okProbe, freshness: 'unknown-provenance' });
    const rebuild = vi.fn().mockReturnValue({ ok: true });
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(r).toMatchObject({ action: 'rebuild', before: 'unknown-provenance', after: 'unknown-provenance', rebuilt: true });
    expect(String(r.error)).toMatch(/unknown-provenance/);
  });
  it('收敛护栏对 cannot-assess 同样生效：docs-only 仓库的合法空图重建后仍 cannot-assess → error，而不是每次 sync 都静默重建', () => {
    const empty = { ...okProbe, graphUnusable: true, freshness: 'fresh', overallVerdict: 'cannot-assess' };
    const probe = vi.fn().mockReturnValue(empty);
    const rebuild = vi.fn().mockReturnValue({ ok: true });
    const r = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe, rebuild }) as FreshnessResult;
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(String(r.error)).toMatch(/未变|不会收敛/);
    // 对照：重建后变成可用 → 无 error
    const healed = vi.fn().mockReturnValueOnce(empty).mockReturnValueOnce(okProbe);
    const ok = syncGraphFreshness({ projectRoot: '/repo', distState: () => dist, probe: healed, rebuild }) as FreshnessResult;
    expect(ok.error).toBeUndefined();
  });
  it('没有 dist → 不探测也不重建，记录 skip-no-dist；dist 陈旧 → skip-stale-dist 且不探测', () => {
    const probe = vi.fn(); const rebuild = vi.fn();
    expect(syncGraphFreshness({ projectRoot: '/repo', distState: () => ({ ...dist, exists: false }), probe, rebuild }).action).toBe('skip-no-dist');
    expect(syncGraphFreshness({ projectRoot: '/repo', distState: () => ({ ...dist, stale: true, commit: 'aaa', head: 'bbb' }), probe, rebuild }).action).toBe('skip-stale-dist');
    expect(probe).not.toHaveBeenCalled(); expect(rebuild).not.toHaveBeenCalled();
  });
});

describe('默认 seam（真 spawn 假 dist 脚本）', () => {
  let projectRoot: string;

  function git(args: string[]): string {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' }).trim();
  }

  function writeFakeCli(body: string): void {
    fs.mkdirSync(path.join(projectRoot, 'dist', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'dist', 'cli', 'index.js'), body, 'utf-8');
  }

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-sync-graph-freshness-'));
    git(['init', '-q']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    fs.writeFileSync(path.join(projectRoot, 'a.ts'), 'export const a = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('defaultProbeGraphStatus：读 graph-quality --json 整份 JSON，从 freshness.dirtyFiles / builtFromDirtyTree / overallVerdict 派生决策输入；git 可用性由本进程自己判', () => {
    writeFakeCli(`
      const payload = { freshness: { state: 'stale', recordedSourceCommit: 'a'.repeat(40), currentHead: 'b'.repeat(40), staleReasons: ['source-commit'], dirtyFiles: ['x.ts'] }, overallVerdict: 'pass-with-warnings' };
      process.stdout.write(JSON.stringify(payload) + '\\n');
    `);
    expect(defaultProbeGraphStatus(projectRoot)).toEqual({
      failed: false, graphExists: true, graphUnusable: false, freshness: 'stale', treeDirty: true, builtFromDirtyTree: false, gitAvailable: true, overallVerdict: 'pass-with-warnings',
    });
  });

  it('defaultProbeGraphStatus：cannot-assess + graph-missing → graphExists:false；porcelainReadFailed 按树脏保守处理；报告里 currentHead:null 只是占位，git 可用性仍按真 git 判', () => {
    writeFakeCli(`
      process.stdout.write(JSON.stringify({ freshness: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null, porcelainReadFailed: true }, overallVerdict: 'cannot-assess', cannotAssessReason: 'graph-missing' }) + '\\n');
      process.exit(2);
    `);
    expect(defaultProbeGraphStatus(projectRoot)).toEqual({
      failed: false, graphExists: false, graphUnusable: false, freshness: 'unknown-provenance', treeDirty: true, builtFromDirtyTree: false, gitAvailable: true, overallVerdict: 'cannot-assess',
    });
  });

  it('defaultProbeGraphStatus：JSON 损坏 / schema 不受支持 / 空图 / 无 symbol 节点 → graphUnusable:true（自动重建最该动手的形态，此前被判成 skip-no-git）', () => {
    for (const reason of ['json-parse-error', 'schema-too-old', 'schema-newer-than-supported', 'empty-graph', 'no-symbol-nodes']) {
      writeFakeCli(`process.stdout.write(JSON.stringify({ freshness: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null }, overallVerdict: 'cannot-assess', cannotAssessReason: '${reason}' }) + '\\n'); process.exit(2);`);
      const r = defaultProbeGraphStatus(projectRoot);
      expect(r.graphUnusable, reason).toBe(true);
      expect(r.gitAvailable, reason).toBe(true);
      expect(decideGraphFreshnessAction({ dist, probe: r }), reason).toBe('rebuild');
    }
  });

  it('defaultProbeGraphStatus：stdout 不是 JSON（含单字符 / fatal 行 / 前导日志行）/ 进程起不来 → { failed: true, error }，绝不伪造 graphExists', () => {
    for (const body of [`process.stdout.write('not json\\n'); process.exit(1);`, `process.stdout.write('7'); process.exit(5);`, `process.stdout.write('fatal: exit code 5\\n'); process.exit(5);`, `process.stdout.write('[info] loading {graph.json}\\n' + JSON.stringify({ freshness: { state: 'fresh' }, overallVerdict: 'pass' }) + '\\n');`]) {
      writeFakeCli(body);
      const r = defaultProbeGraphStatus(projectRoot);
      expect(r.failed, body).toBe(true);
      expect(String(r.error)).not.toBe('');
    }
    fs.rmSync(path.join(projectRoot, 'dist'), { recursive: true, force: true });
    expect(defaultProbeGraphStatus(projectRoot).failed).toBe(true);
  });

  it('defaultProbeGraphStatus：非 git 目录 → gitAvailable:false（unknown-provenance 时 skip-no-git 的唯一合法来源）', () => {
    writeFakeCli(`process.stdout.write(JSON.stringify({ freshness: { state: 'unknown-provenance', recordedSourceCommit: null, currentHead: null }, overallVerdict: 'pass' }) + '\\n');`);
    fs.rmSync(path.join(projectRoot, '.git'), { recursive: true, force: true });
    const r = defaultProbeGraphStatus(projectRoot);
    expect(r.gitAvailable).toBe(false);
    expect(decideGraphFreshnessAction({ dist, probe: r })).toBe('skip-no-git');
  });

  it('defaultRebuildGraph：真 spawn dist/cli/index.js batch <root> --mode graph-only，并在 cwd=root 下运行；非零退出抛错并带 stderr', () => {
    writeFakeCli(`
      require('fs').writeFileSync(require('path').join(process.cwd(), 'argv.json'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
    `);
    defaultRebuildGraph(projectRoot);
    const recorded = JSON.parse(fs.readFileSync(path.join(projectRoot, 'argv.json'), 'utf-8'));
    expect(recorded.argv).toEqual(['batch', projectRoot, '--mode', 'graph-only']);
    expect(fs.realpathSync(recorded.cwd)).toBe(fs.realpathSync(projectRoot));

    writeFakeCli(`process.stderr.write('batch exploded\\n'); process.exit(1);`);
    expect(() => defaultRebuildGraph(projectRoot)).toThrow(/batch exploded/);
  });

  it('defaultRebuildGraph：超过墙钟上限的重建被 SIGKILL 闭合并抛错（不让整条 repo:sync 挂死）', async () => {
    writeFakeCli(`setTimeout(() => {}, 60000); process.on('SIGTERM', () => {});`);
    vi.stubEnv('SPECTRA_GRAPH_REBUILD_TIMEOUT_MS', '300');
    vi.resetModules();
    const fresh = await import('../../scripts/lib/repo-maintenance-core.mjs');
    const started = Date.now();
    expect(() => fresh.defaultRebuildGraph(projectRoot)).toThrow(/signal SIGKILL|SIGKILL|ETIMEDOUT/);
    expect(Date.now() - started).toBeLessThan(10_000);
    vi.unstubAllEnvs();
  });

  it('resolveDistState：无 dist → exists:false；build-meta commit == HEAD → stale:false；!= HEAD → stale:true；无 build-meta → 不判陈旧', () => {
    expect(resolveDistState(projectRoot)).toMatchObject({ exists: false });
    writeFakeCli('');
    expect(resolveDistState(projectRoot)).toMatchObject({ exists: true, stale: false, commit: null });
    const head = git(['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(projectRoot, 'dist', '.spectra-build-meta.json'), JSON.stringify({ commit: head, sourceDirty: false }));
    expect(resolveDistState(projectRoot)).toMatchObject({ exists: true, stale: false, commit: head, head });
    fs.writeFileSync(path.join(projectRoot, 'dist', '.spectra-build-meta.json'), JSON.stringify({ commit: 'c'.repeat(40), sourceDirty: false }));
    expect(resolveDistState(projectRoot)).toMatchObject({ exists: true, stale: true, commit: 'c'.repeat(40), head });
  });
});

describe('repo:sync 步骤表与结果可见性', () => {
  it('graph-freshness 已接入且是末步；其余 14 步的顺序不变', () => {
    const ids = listRepoSyncStepIds();
    expect(ids[ids.length - 1]).toBe('graph-freshness');
    expect(ids.slice(0, -1)).toEqual([
      'agent-docs', 'preference-rules', 'delegation-contract', 'release-contract', 'spectra-skills',
      'spec-driver-codex-wrappers', 'workflow-registry', 'product-entity-catalog', 'product-quality-reports-pass1',
      'product-scorecards-pass1', 'adoption-insights', 'product-quality-reports-pass2', 'product-scorecards-pass2',
      'project-context-suggestions',
    ]);
  });
  it('describeRepoSyncStepResult：graph-freshness 的 action / before / after / error 进人读输出（此前只打静态标题，跳过与失败不可见）；多行 error 折成单行', () => {
    expect(describeRepoSyncStepResult({ action: 'rebuild', before: 'stale', after: 'fresh', rebuilt: true })).toBe('action=rebuild before=stale after=fresh');
    expect(describeRepoSyncStepResult({ action: 'skip-dirty', before: 'stale', rebuilt: false })).toBe('action=skip-dirty before=stale');
    expect(describeRepoSyncStepResult({ action: 'rebuild', before: 'stale', rebuilt: false, error: 'batch exploded' })).toBe('action=rebuild before=stale error=batch exploded');
    expect(describeRepoSyncStepResult({ action: 'rebuild', before: 'stale', rebuilt: false, error: 'line1\n  line2\nline3' })).toBe('action=rebuild before=stale error=line1 ⏎ line2 ⏎ line3');
    expect(describeRepoSyncStepResult({ generatedAt: 'x' })).toBe('');
  });
  it('stepStatusFor：步骤自报 error ⇒ warn，否则 pass（syncRepository 用同一函数，不再硬编码 pass）', () => {
    expect(stepStatusFor({ action: 'rebuild', rebuilt: false, error: 'x' })).toBe('warn');
    expect(stepStatusFor({ action: 'noop', rebuilt: false })).toBe('pass');
    expect(stepStatusFor({ generatedAt: 'x' })).toBe('pass');
    expect(stepStatusFor(undefined)).toBe('pass');
  });
});
