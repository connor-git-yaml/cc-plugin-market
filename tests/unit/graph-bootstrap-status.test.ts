/**
 * Feature 239 — graph provenance 状态机单元测试（T014/T016/T017/T018 / plan 决策 5）
 *
 * 覆盖：
 * - FR-006：状态文件 schema、四事实 `bootstrapSource` 判定（C4）、唯一 temp 原子写（W1）、
 *   遗留 sidecar 迁移性删除（C10）、`--dry-run` 只报告不落盘
 * - FR-006/SC-007：`checkFreshness` adapter 对全局 `spectra graph-quality --json` 的解析/映射（C3）
 * - FR-010/SC-001：`attemptLocalGraphBuild` 的独立进程组 deadline 收口（C2）
 *
 * 假 `spectra` CLI 一律在测试沙盒内自建并以 `spectraBin` 绝对路径注入，不触碰真实全局 CLI。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// @ts-expect-error — .mjs 无类型声明，运行时可解析
import * as statusCore from '../../scripts/lib/graph-bootstrap-status.mjs';

interface EmbeddedCommitResult {
  ok: boolean;
  value?: string | null;
  reason?: string;
}

interface StatusPayload {
  schemaVersion: number;
  bootstrapSource: string;
  embeddedSourceCommitAtBootstrap: string | null;
  worktreeHeadAtBootstrap: string | null;
  generatedAt: string;
  assessable: boolean;
}

interface FreshnessVerdict {
  state: string;
  recordedSourceCommit?: string | null;
  currentHead?: string | null;
  reason?: string;
}

interface BuildOutcome {
  ok: boolean;
  reason?: string;
  code?: number | null;
  signal?: string | null;
}

interface WriteOutcome {
  written: boolean;
  statusPath: string;
  warnings: string[];
  removedLegacySidecar: boolean;
}

const readEmbeddedSourceCommit = statusCore.readEmbeddedSourceCommit as (
  graphJsonPath: string,
) => EmbeddedCommitResult;
const resolveWorktreeHead = statusCore.resolveWorktreeHead as (projectRoot: string) => string | null;
const readPreviousStatus = statusCore.readPreviousStatus as (
  projectRoot: string,
) => StatusPayload | null;
const determineBootstrapSource = statusCore.determineBootstrapSource as (facts: {
  graphCopiedThisRun: boolean;
  snapshotCopiedThisRun: boolean;
  buildAttempted: boolean;
  buildSucceeded: boolean;
  graphTargetExists: boolean;
  previousStatus: StatusPayload | null;
}) => string;
const buildStatusPayload = statusCore.buildStatusPayload as (options: {
  projectRoot: string;
  graphCopiedThisRun: boolean;
  snapshotCopiedThisRun: boolean;
  buildAttempted: boolean;
  buildSucceeded: boolean;
}) => StatusPayload;
const writeBootstrapStatus = statusCore.writeBootstrapStatus as (
  projectRoot: string,
  payload: StatusPayload,
  options?: { dryRun?: boolean },
) => WriteOutcome;
const checkFreshness = statusCore.checkFreshness as (
  projectRoot: string,
  options: { graphJsonPath: string; spectraBin?: string },
) => FreshnessVerdict;
const attemptLocalGraphBuild = statusCore.attemptLocalGraphBuild as (options: {
  projectRoot: string;
  spectraBin?: string;
  deadlineMs?: number;
  graceMs?: number;
}) => Promise<BuildOutcome>;

const STATUS_REL = 'specs/_meta/graph-bootstrap-status.json';
const LEGACY_SIDECAR_REL = 'specs/_meta/.graph-source-commit';
const GRAPH_REL = 'specs/_meta/graph.json';

interface Sandbox {
  root: string;
  cleanup: () => void;
}

function makeSandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-bootstrap-status-'));
  fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function makeGitSandbox(): Sandbox {
  const sandbox = makeSandbox();
  execSync('git init -q', { cwd: sandbox.root });
  execSync('git config user.email test@example.com', { cwd: sandbox.root });
  execSync('git config user.name Test', { cwd: sandbox.root });
  execSync('git commit -q --allow-empty -m init', { cwd: sandbox.root });
  return sandbox;
}

function seedGraph(root: string, content: string): void {
  fs.writeFileSync(path.join(root, GRAPH_REL), content);
}

function readStatusFile(root: string): StatusPayload {
  return JSON.parse(fs.readFileSync(path.join(root, STATUS_REL), 'utf-8')) as StatusPayload;
}

/** 在沙盒内自建假 `spectra` 可执行文件（绝对路径注入，不碰真实全局 CLI）。 */
function writeFakeSpectra(root: string, body: string, name = 'fake-spectra'): string {
  const binPath = path.join(root, name);
  fs.writeFileSync(binPath, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return binPath;
}

function basePayload(overrides: Partial<StatusPayload> = {}): StatusPayload {
  return {
    schemaVersion: 1,
    bootstrapSource: 'primary-copy',
    embeddedSourceCommitAtBootstrap: 'a'.repeat(40),
    worktreeHeadAtBootstrap: 'b'.repeat(40),
    generatedAt: new Date().toISOString(),
    assessable: true,
    ...overrides,
  };
}

describe('Feature 239 — graph-bootstrap-status 状态文件（FR-006）', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = makeGitSandbox();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it('schema 字段完整：schemaVersion/bootstrapSource/embedded/head/generatedAt/assessable', () => {
    seedGraph(sandbox.root, JSON.stringify({ graph: { sourceCommit: 'c'.repeat(40) } }));

    const payload = buildStatusPayload({
      projectRoot: sandbox.root,
      graphCopiedThisRun: true,
      snapshotCopiedThisRun: false,
      buildAttempted: false,
      buildSucceeded: false,
    });

    expect(Object.keys(payload).sort()).toEqual(
      [
        'assessable',
        'bootstrapSource',
        'embeddedSourceCommitAtBootstrap',
        'generatedAt',
        'schemaVersion',
        'worktreeHeadAtBootstrap',
      ].sort(),
    );
    expect(payload.schemaVersion).toBe(1);
    expect(payload.bootstrapSource).toBe('primary-copy');
    expect(payload.embeddedSourceCommitAtBootstrap).toBe('c'.repeat(40));
    expect(payload.worktreeHeadAtBootstrap).toBe(
      execSync('git rev-parse HEAD', { cwd: sandbox.root, encoding: 'utf-8' }).trim(),
    );
    expect(payload.assessable).toBe(true);
    expect(() => new Date(payload.generatedAt).toISOString()).not.toThrow();
  });

  it('原子写：落盘后无残留 temp 文件，内容可被 JSON 解析', () => {
    const outcome = writeBootstrapStatus(sandbox.root, basePayload());

    expect(outcome.written).toBe(true);
    expect(readStatusFile(sandbox.root).bootstrapSource).toBe('primary-copy');
    const leftovers = fs
      .readdirSync(path.join(sandbox.root, 'specs', '_meta'))
      .filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('唯一 temp：两个 writer 先后写同一目标路径均成功，后写内容生效（W1）', () => {
    // 固定 `${path}.tmp` 命名会让并发 writer 互相踩 tmp；唯一 temp 命名下两次调用都必须成功。
    const first = writeBootstrapStatus(sandbox.root, basePayload({ bootstrapSource: 'primary-copy' }));
    const second = writeBootstrapStatus(sandbox.root, basePayload({ bootstrapSource: 'local-build' }));

    expect(first.written).toBe(true);
    expect(second.written).toBe(true);
    expect(readStatusFile(sandbox.root).bootstrapSource).toBe('local-build');
  });

  it('落盘成功后迁移性删除遗留 sidecar（C10）', () => {
    fs.writeFileSync(path.join(sandbox.root, LEGACY_SIDECAR_REL), `${'d'.repeat(40)}\n`);

    const outcome = writeBootstrapStatus(sandbox.root, basePayload());

    expect(outcome.removedLegacySidecar).toBe(true);
    expect(fs.existsSync(path.join(sandbox.root, LEGACY_SIDECAR_REL))).toBe(false);
    expect(fs.existsSync(path.join(sandbox.root, STATUS_REL))).toBe(true);
  });

  it('--dry-run 不落盘、不删除遗留 sidecar', () => {
    fs.writeFileSync(path.join(sandbox.root, LEGACY_SIDECAR_REL), `${'d'.repeat(40)}\n`);

    const outcome = writeBootstrapStatus(sandbox.root, basePayload(), { dryRun: true });

    expect(outcome.written).toBe(false);
    expect(fs.existsSync(path.join(sandbox.root, STATUS_REL))).toBe(false);
    expect(fs.existsSync(path.join(sandbox.root, LEGACY_SIDECAR_REL))).toBe(true);
  });

  it('readPreviousStatus：无文件返回 null，有文件返回解析结果', () => {
    expect(readPreviousStatus(sandbox.root)).toBeNull();
    writeBootstrapStatus(sandbox.root, basePayload({ bootstrapSource: 'local-build' }));
    expect(readPreviousStatus(sandbox.root)?.bootstrapSource).toBe('local-build');
  });

  it('resolveWorktreeHead：git 仓库返回 40 位 HEAD，非 git 目录返回 null', () => {
    expect(resolveWorktreeHead(sandbox.root)).toMatch(/^[0-9a-f]{40}$/);
    const plain = makeSandbox();
    try {
      expect(resolveWorktreeHead(plain.root)).toBeNull();
    } finally {
      plain.cleanup();
    }
  });

  describe('readEmbeddedSourceCommit 三态', () => {
    it('文件存在且含 graph.sourceCommit → ok + value', () => {
      seedGraph(sandbox.root, JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40) } }));
      expect(readEmbeddedSourceCommit(path.join(sandbox.root, GRAPH_REL))).toEqual({
        ok: true,
        value: 'e'.repeat(40),
      });
    });

    it('文件存在但字段缺失（旧格式图）→ ok + value=null', () => {
      seedGraph(sandbox.root, JSON.stringify({ nodes: [], links: [] }));
      expect(readEmbeddedSourceCommit(path.join(sandbox.root, GRAPH_REL))).toEqual({
        ok: true,
        value: null,
      });
    });

    it('文件缺失 → ok:false + file-missing', () => {
      expect(readEmbeddedSourceCommit(path.join(sandbox.root, GRAPH_REL))).toEqual({
        ok: false,
        reason: 'file-missing',
      });
    });

    it('文件损坏 → ok:false + parse-error', () => {
      seedGraph(sandbox.root, '{ not json');
      expect(readEmbeddedSourceCommit(path.join(sandbox.root, GRAPH_REL))).toEqual({
        ok: false,
        reason: 'parse-error',
      });
    });
  });
});

describe('Feature 239 — checkFreshness adapter（C3 定案：复用全局 CLI 判定，不内联重写）', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = makeSandbox();
    seedGraph(sandbox.root, JSON.stringify({ graph: { sourceCommit: 'f'.repeat(40) } }));
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  function runWithFakeCli(body: string): FreshnessVerdict {
    const bin = writeFakeSpectra(sandbox.root, body);
    return checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: bin,
    });
  }

  // 四态原样透传，`dirty` 绝不折叠进 `fresh`——它是"HEAD 一致但工作树有未提交改动"这一
  // 有实际意义的状态，折叠会让"图已与工作树脱节"被静默忽略。
  it.each(['fresh', 'dirty', 'stale', 'unknown-provenance'])('四态原样透传：%s', (state) => {
    const verdict = runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"pass","freshness":{"state":"${state}","recordedSourceCommit":"aa","currentHead":"bb"}}\nJSON`,
    );
    expect(verdict.state).toBe(state);
    expect(verdict.recordedSourceCommit).toBe('aa');
    expect(verdict.currentHead).toBe('bb');
  });

  it('exit 1（强不变量违反）携带合法 JSON 时仍先取 stdout 解析', () => {
    const verdict = runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"fail-strong-invariant","freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"bb"}}\nJSON\nexit 1`,
    );
    expect(verdict.state).toBe('stale');
  });

  it('exit 2（cannot-assess）携带合法 JSON 时仍先取 stdout 解析', () => {
    const verdict = runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"cannot-assess","freshness":{"state":"unknown-provenance"}}\nJSON\nexit 2`,
    );
    expect(verdict.state).toBe('unknown-provenance');
  });

  it('CLI 缺失（ENOENT）→ unknown-provenance + spectra-cli-missing', () => {
    const verdict = checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: path.join(sandbox.root, 'definitely-not-installed-spectra'),
    });
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('spectra-cli-missing');
  });

  it('stdout 不可解析 → unknown-provenance + unparseable-output', () => {
    const verdict = runWithFakeCli(`echo "not json at all"`);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('unparseable-output');
  });

  it('freshness 字段缺失 → unknown-provenance（不臆造状态）', () => {
    const verdict = runWithFakeCli(`cat <<'JSON'\n{"overallVerdict":"pass"}\nJSON`);
    expect(verdict.state).toBe('unknown-provenance');
  });

  it('spawn 参数以数组形式传入：子命令与 flag 不被空格拆分（§M10 毁图事故防线）', () => {
    // 假 CLI 把收到的 argv 逐个回显；断言第一个参数精确是 `graph-quality` 而不是 `graph`。
    const argvDump = path.join(sandbox.root, 'argv.txt');
    const bin = writeFakeSpectra(
      sandbox.root,
      `printf '%s\\n' "$@" > ${JSON.stringify(argvDump)}\ncat <<'JSON'\n{"freshness":{"state":"fresh"}}\nJSON`,
      'fake-spectra-argv',
    );
    checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: bin,
    });
    const argv = fs.readFileSync(argvDump, 'utf-8').trimEnd().split('\n');
    expect(argv[0]).toBe('graph-quality');
    expect(argv).toContain('--json');
    expect(argv).toContain('--graph');
    expect(argv).toContain(path.join(sandbox.root, GRAPH_REL));
  });

  // 真实 CLI 冒烟：本机装了全局 spectra 才跑，未装则显式 skip 并留痕（不静默跳过）。
  const hasGlobalSpectra = spawnSync('command', ['-v', 'spectra'], { shell: true }).status === 0;
  const smokeIt = hasGlobalSpectra ? it : it.skip;
  smokeIt('真实全局 spectra CLI 冒烟：返回四态之一（未装全局 CLI 时 skip）', () => {
    const verdict = checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
    });
    expect(['fresh', 'dirty', 'stale', 'unknown-provenance']).toContain(verdict.state);
  });
});

describe('Feature 239 — attemptLocalGraphBuild 进程组 deadline（C2 定案）', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = makeSandbox();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  it('默认预算钉死为 45000ms deadline + 2000ms grace，总额留在 SC-001 的 50s 安全线内', () => {
    // 用常量断言替代一次真实 47 秒墙钟等待：既锁死预算，又不把长时 wall-clock 用例
    // 引入共享 runner（F233/F235 的 flaky 教训）。逃逸行为本身由下面两个 stub 用例覆盖。
    expect(statusCore.DEFAULT_DEADLINE_MS).toBe(45000);
    expect(statusCore.DEFAULT_GRACE_MS).toBe(2000);
    expect(statusCore.DEFAULT_DEADLINE_MS + statusCore.DEFAULT_GRACE_MS).toBeLessThan(50000);
  });

  it('忽略 SIGTERM 的 stub：deadline 到期后被 SIGKILL 收口，总墙钟在预算内', async () => {
    const stub = writeFakeSpectra(
      sandbox.root,
      `trap '' TERM\nwhile true; do sleep 0.05; done`,
      'stub-ignores-term',
    );

    const started = Date.now();
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 1000,
      graceMs: 500,
    });
    const elapsed = Date.now() - started;

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('timeout');
    // TERM 被忽略 → 必须走到 grace 之后的 KILL 才能收口；同时不得无限拖延
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(50000);
  }, 20000);

  it('启动后台孙进程的 stub：孙进程心跳在 deadline+grace 后停止更新（不用 pgrep）', async () => {
    const heartbeat = path.join(sandbox.root, 'heartbeat.log');
    // 直接子进程 fork 一个持续写心跳的孙进程后自身仍存活并忽略 TERM；
    // 只有对**整个进程组**发信号才能让孙进程一并消亡。
    const stub = writeFakeSpectra(
      sandbox.root,
      [
        `( while true; do date +%s%N >> ${JSON.stringify(heartbeat)}; sleep 0.1; done ) &`,
        `trap '' TERM`,
        `while true; do sleep 0.05; done`,
      ].join('\n'),
      'stub-spawns-grandchild',
    );

    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 1000,
      graceMs: 500,
    });
    expect(outcome.ok).toBe(false);

    // 判据用心跳文件停更，而非 pgrep 查宿主进程表（F232 教训：宿主进程表不可控）
    expect(fs.existsSync(heartbeat)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const afterKill = fs.readFileSync(heartbeat, 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(fs.readFileSync(heartbeat, 'utf-8')).toBe(afterKill);
  }, 20000);

  it('构建成功（exit 0）→ ok:true', async () => {
    const stub = writeFakeSpectra(sandbox.root, 'exit 0', 'stub-ok');
    await expect(
      attemptLocalGraphBuild({ projectRoot: sandbox.root, spectraBin: stub, deadlineMs: 5000 }),
    ).resolves.toEqual({ ok: true });
  });

  it('构建失败（非零退出）→ ok:false + non-zero-exit', async () => {
    const stub = writeFakeSpectra(sandbox.root, 'exit 3', 'stub-fail');
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 5000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('non-zero-exit');
    expect(outcome.code).toBe(3);
  });

  it('spectra 不存在 → ok:false + spawn-error（不抛未捕获异常）', async () => {
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: path.join(sandbox.root, 'definitely-not-installed'),
      deadlineMs: 5000,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('spawn-error');
  });
});

describe('Feature 239 — bootstrapSource 四事实状态机（C4 定案）', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = makeGitSandbox();
  });

  afterEach(() => {
    sandbox.cleanup();
  });

  const noFacts = {
    graphCopiedThisRun: false,
    snapshotCopiedThisRun: false,
    buildAttempted: false,
    buildSucceeded: false,
    graphTargetExists: true,
    previousStatus: null as StatusPayload | null,
  };

  it('graphCopiedThisRun → primary-copy（最高优先级）', () => {
    expect(determineBootstrapSource({ ...noFacts, graphCopiedThisRun: true })).toBe('primary-copy');
  });

  it('构建尝试且成功 → local-build', () => {
    expect(
      determineBootstrapSource({ ...noFacts, buildAttempted: true, buildSucceeded: true }),
    ).toBe('local-build');
  });

  it('构建尝试但失败且图不存在 → none', () => {
    expect(
      determineBootstrapSource({
        ...noFacts,
        buildAttempted: true,
        buildSucceeded: false,
        graphTargetExists: false,
      }),
    ).toBe('none');
  });

  it('(a) 首次 primary-copy 后无变化 rerun 必须继承 primary-copy，不得被覆盖为 local-build', () => {
    expect(
      determineBootstrapSource({
        ...noFacts,
        previousStatus: basePayload({ bootstrapSource: 'primary-copy' }),
      }),
    ).toBe('primary-copy');
  });

  it('(b) 仅补 snapshot 不得改变已记录的 graph 来源', () => {
    expect(
      determineBootstrapSource({
        ...noFacts,
        snapshotCopiedThisRun: true,
        previousStatus: basePayload({ bootstrapSource: 'local-build' }),
      }),
    ).toBe('local-build');
  });

  it('(d) 无历史记录且图已存在 → unknown', () => {
    expect(determineBootstrapSource({ ...noFacts, previousStatus: null })).toBe('unknown');
  });

  it('(c) graph.json 解析失败 → 原子落盘 assessable:false，而非未捕获异常退出', () => {
    seedGraph(sandbox.root, '{ corrupted');

    const payload = buildStatusPayload({
      projectRoot: sandbox.root,
      graphCopiedThisRun: true,
      snapshotCopiedThisRun: false,
      buildAttempted: false,
      buildSucceeded: false,
    });
    expect(payload.assessable).toBe(false);
    expect(payload.embeddedSourceCommitAtBootstrap).toBeNull();
    // 仍必须能落盘（bash 侧 set -u/-e 下未捕获异常会中断整条 sync）
    expect(writeBootstrapStatus(sandbox.root, payload).written).toBe(true);
    expect(readStatusFile(sandbox.root).assessable).toBe(false);
  });

  it('图不存在 → bootstrapSource=none 且 assessable:false', () => {
    const payload = buildStatusPayload({
      projectRoot: sandbox.root,
      graphCopiedThisRun: false,
      snapshotCopiedThisRun: false,
      buildAttempted: false,
      buildSucceeded: false,
    });
    expect(payload.bootstrapSource).toBe('none');
    expect(payload.assessable).toBe(false);
  });
});
