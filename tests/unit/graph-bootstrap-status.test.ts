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
import { execSync, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(__dirname, '../..');

// @ts-expect-error — .mjs 无类型声明，运行时可解析
import * as statusCore from '../../scripts/lib/graph-bootstrap-status.mjs';

interface EmbeddedCommitResult {
  ok: boolean;
  value?: string | null;
  reason?: string;
}

/** F254：`readEmbeddedGraphMeta` 的成功态同时带 sourceCommit 与 collector fingerprint。 */
interface EmbeddedGraphMetaResult {
  ok: boolean;
  value?: { sourceCommit: string | null; fingerprint: unknown };
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
  /** F249 FR-013：stale 原因透传（非 stale 或旧版本 CLI 未产出时为空数组）。 */
  staleReasons?: string[];
  /** F249 W-001：stale 态的完整 reason-aware 诊断串（bash 侧原样打印）。 */
  freshnessDiagnostic?: string;
  reason?: string;
  receivedState?: string;
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
  plan: string[];
}

const readEmbeddedSourceCommit = statusCore.readEmbeddedSourceCommit as (
  graphJsonPath: string,
) => EmbeddedCommitResult;
const readEmbeddedGraphMeta = statusCore.readEmbeddedGraphMeta as (
  graphJsonPath: string,
) => EmbeddedGraphMetaResult;
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
  options: { graphJsonPath: string; spectraBin?: string; deadlineMs?: number; graceMs?: number },
) => Promise<FreshnessVerdict>;
const buildFreshnessDiagnostic = statusCore.buildFreshnessDiagnostic as (verdict: {
  state: string;
  staleReasons?: string[];
}) => string;
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

  // W6(a)：串行两次调用在固定 `${path}.tmp` 实现下同样能过，证不了唯一 temp。
  // 改为两个**真实并发子进程**同时写同一目标路径。
  it('W6：两个真实并发进程写同一状态文件 → 终态是其中之一的完整 JSON，且无 tmp 残留', async () => {
    const helperUrl = pathToFileURL(
      path.join(REPO_ROOT, 'scripts/lib/graph-bootstrap-status.mjs'),
    ).href;
    const spawnWriter = (source: string) =>
      new Promise<number>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            '-e',
            `import(${JSON.stringify(helperUrl)}).then((m) => {
               m.writeBootstrapStatus(${JSON.stringify(sandbox.root)}, {
                 schemaVersion: 1,
                 bootstrapSource: ${JSON.stringify(source)},
                 embeddedSourceCommitAtBootstrap: null,
                 worktreeHeadAtBootstrap: null,
                 generatedAt: new Date().toISOString(),
                 assessable: false,
               });
             });`,
          ],
          { stdio: 'ignore' },
        );
        child.on('exit', (code) => resolve(code ?? -1));
      });

    const [firstCode, secondCode] = await Promise.all([
      spawnWriter('primary-copy'),
      spawnWriter('local-build'),
    ]);

    expect(firstCode).toBe(0);
    expect(secondCode).toBe(0);
    // 终态必须是某一个 writer 的**完整** JSON（rename 原子性），不得是半截内容
    const finalStatus = readStatusFile(sandbox.root);
    expect(['primary-copy', 'local-build']).toContain(finalStatus.bootstrapSource);
    expect(finalStatus.schemaVersion).toBe(1);
    // 无论谁赢，都不得留下 tmp 残渣
    const leftovers = fs
      .readdirSync(path.join(sandbox.root, 'specs', '_meta'))
      .filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
  }, 20000);

  it('W3：遗留 sidecar 是 broken symlink 时同样被清理（existsSync 对其返回 false）', () => {
    const sidecarPath = path.join(sandbox.root, LEGACY_SIDECAR_REL);
    fs.symlinkSync(path.join(sandbox.root, 'no-such-target'), sidecarPath);
    expect(fs.existsSync(sidecarPath)).toBe(false); // 正是 existsSync 的盲区
    expect(fs.lstatSync(sidecarPath).isSymbolicLink()).toBe(true);

    const outcome = writeBootstrapStatus(sandbox.root, basePayload());

    expect(outcome.removedLegacySidecar).toBe(true);
    expect(() => fs.lstatSync(sidecarPath)).toThrow();
  });

  it('W4：dry-run 输出操作计划清单，而非"拟合成"的最终状态对象', () => {
    fs.writeFileSync(path.join(sandbox.root, LEGACY_SIDECAR_REL), `${'d'.repeat(40)}\n`);

    const outcome = writeBootstrapStatus(sandbox.root, basePayload(), { dryRun: true });

    // dry-run 下 payload 是基于"尚未发生的 copy"推算的，与真实执行结果不等价，
    // 因此不再声称打印最终状态对象，只报告操作计划。
    expect(Array.isArray(outcome.plan)).toBe(true);
    expect(outcome.plan.join('\n')).toContain('拟写状态文件');
    expect(outcome.plan.join('\n')).toContain('拟删除遗留 sidecar');
  });

  it('W5：graph.json 超出体积上限 → 不读入内存，记 graph-too-large', () => {
    const graphPath = path.join(sandbox.root, GRAPH_REL);
    fs.writeFileSync(graphPath, '');
    // 稀疏文件：statSync 报告超限尺寸，但不实际占用磁盘也不会被读入
    fs.truncateSync(graphPath, statusCore.MAX_JSON_BYTES + 1);

    expect(readEmbeddedSourceCommit(graphPath)).toEqual({ ok: false, reason: 'graph-too-large' });

    const payload = buildStatusPayload({
      projectRoot: sandbox.root,
      graphCopiedThisRun: true,
      snapshotCopiedThisRun: false,
      buildAttempted: false,
      buildSucceeded: false,
    });
    expect(payload.assessable).toBe(false);
  });

  it('W5：历史状态文件超出体积上限 → 按"无历史记录"处理，不读入内存', () => {
    const statusPath = path.join(sandbox.root, STATUS_REL);
    fs.writeFileSync(statusPath, '');
    fs.truncateSync(statusPath, statusCore.MAX_JSON_BYTES + 1);

    expect(readPreviousStatus(sandbox.root)).toBeNull();
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

  describe('F254 readEmbeddedGraphMeta 泛化读取（sourceCommit + collector fingerprint）', () => {
    const graphPath = (): string => path.join(sandbox.root, GRAPH_REL);

    /** F249 指纹的最小合法形态（五条管线 key 齐全），供本组用例复用。 */
    const sampleFingerprint = {
      formatVersion: 1,
      extensionSurface: {
        tsjsSkeletonWalk: { extensions: ['.ts', '.mjs'], matchSemantics: 'case-sensitive' },
        pyWalk: { extensions: ['.py'], matchSemantics: 'case-sensitive' },
        genericAdapters: { extensions: ['.go'], matchSemantics: 'case-insensitive' },
        moduleDerivationScan: { extensions: ['.mts'], matchSemantics: 'case-insensitive' },
        pythonSymbolScan: { extensions: ['.py'], matchSemantics: 'case-sensitive' },
      },
      behaviorVersion: 1,
    };

    it('图带 fingerprint → value.fingerprint 与源 JSON 深度相等，sourceCommit 一并透传', () => {
      seedGraph(
        sandbox.root,
        JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40), fingerprint: sampleFingerprint } }),
      );

      expect(readEmbeddedGraphMeta(graphPath())).toEqual({
        ok: true,
        value: { sourceCommit: 'e'.repeat(40), fingerprint: sampleFingerprint },
      });
    });

    it('图无 fingerprint 字段（F249 之前的旧图）→ value.fingerprint 为 null', () => {
      seedGraph(sandbox.root, JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40) } }));

      expect(readEmbeddedGraphMeta(graphPath())).toEqual({
        ok: true,
        value: { sourceCommit: 'e'.repeat(40), fingerprint: null },
      });
    });

    it('三态失败分支的 reason 与 readEmbeddedSourceCommit 逐字相同（薄壳化未改契约）', () => {
      // file-missing：图根本不存在
      expect(readEmbeddedGraphMeta(graphPath())).toEqual(readEmbeddedSourceCommit(graphPath()));
      expect(readEmbeddedGraphMeta(graphPath())).toEqual({ ok: false, reason: 'file-missing' });

      // parse-error：文件在但不是 JSON
      seedGraph(sandbox.root, '{ not json');
      expect(readEmbeddedGraphMeta(graphPath())).toEqual(readEmbeddedSourceCommit(graphPath()));
      expect(readEmbeddedGraphMeta(graphPath())).toEqual({ ok: false, reason: 'parse-error' });

      // graph-too-large：稀疏文件，statSync 报超限但不实际读入
      fs.writeFileSync(graphPath(), '');
      fs.truncateSync(graphPath(), statusCore.MAX_JSON_BYTES + 1);
      expect(readEmbeddedGraphMeta(graphPath())).toEqual(readEmbeddedSourceCommit(graphPath()));
      expect(readEmbeddedGraphMeta(graphPath())).toEqual({ ok: false, reason: 'graph-too-large' });
    });

    it('薄壳投影等价：readEmbeddedSourceCommit === readEmbeddedGraphMeta 的 sourceCommit 投影', () => {
      for (const content of [
        JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40), fingerprint: sampleFingerprint } }),
        JSON.stringify({ graph: { sourceCommit: 'e'.repeat(40) } }),
        // 旧格式图：graph 字段整体缺失 → 两者都应给 ok:true + value:null（不是 parse-error）
        JSON.stringify({ nodes: [], links: [] }),
      ]) {
        seedGraph(sandbox.root, content);
        const meta = readEmbeddedGraphMeta(graphPath());
        expect(meta.ok).toBe(true);
        expect(readEmbeddedSourceCommit(graphPath())).toEqual({
          ok: true,
          value: meta.value?.sourceCommit ?? null,
        });
      }
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

  async function runWithFakeCli(body: string): Promise<FreshnessVerdict> {
    const bin = writeFakeSpectra(sandbox.root, body);
    return checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: bin,
    });
  }

  // 四态原样透传，`dirty` 绝不折叠进 `fresh`——它是"HEAD 一致但工作树有未提交改动"这一
  // 有实际意义的状态，折叠会让"图已与工作树脱节"被静默忽略。
  it.each(['fresh', 'dirty', 'stale', 'unknown-provenance'])('四态原样透传：%s', async (state) => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"pass","freshness":{"state":"${state}","recordedSourceCommit":"aa","currentHead":"bb"}}\nJSON`,
    );
    expect(verdict.state).toBe(state);
    expect(verdict.recordedSourceCommit).toBe('aa');
    expect(verdict.currentHead).toBe('bb');
  });

  // ── F249 T027/FR-013：staleReasons 透传（bootstrap-status 消费面）──

  it('F249：CLI 报告含 staleReasons 时原样透传（顺序不变，不折叠不重排）', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"pass-with-warnings","freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"bb","staleReasons":["source-commit","collector-fingerprint-invalid"]}}\nJSON`,
    );
    expect(verdict.state).toBe('stale');
    expect(verdict.staleReasons).toEqual(['source-commit', 'collector-fingerprint-invalid']);
  });

  it('F249：单一指纹型原因同样透传（不被误映射为 source-commit）', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"aa","staleReasons":["collector-fingerprint-unrecorded"]}}\nJSON`,
    );
    expect(verdict.staleReasons).toEqual(['collector-fingerprint-unrecorded']);
  });

  it('F249：CLI 报告未含 staleReasons（fresh 态 / 旧版本 CLI）→ 空数组，不为 undefined', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"fresh","recordedSourceCommit":"aa","currentHead":"aa"}}\nJSON`,
    );
    expect(verdict.staleReasons).toEqual([]);
  });

  it('F249：staleReasons 为非数组畸形值 → 归一化为空数组（不把畸形值透传给下游）', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"bb","staleReasons":"source-commit"}}\nJSON`,
    );
    expect(verdict.staleReasons).toEqual([]);
  });

  // ── F249 W-001：checkFreshness 顺带回传 reason-aware 完整诊断串（bash 侧不再自行拼装）──

  it('W-001：stale 判定回传 freshnessDiagnostic，内容按实际 staleReasons 现算', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"aa","staleReasons":["collector-fingerprint-invalid"]}}\nJSON`,
    );
    expect(verdict.freshnessDiagnostic).toContain('结构畸形');
    // 关键反例：指纹型 stale 的诊断里 MUST NOT 出现 commit 型说法
    expect(verdict.freshnessDiagnostic).not.toContain('sourceCommit');
  });

  it('W-001：非 stale 态回传空诊断串（不给 fresh/dirty 编造诊断）', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"fresh","recordedSourceCommit":"aa","currentHead":"aa"}}\nJSON`,
    );
    expect(verdict.freshnessDiagnostic).toBe('');
  });
  // FRESHNESS_STATES / ACCEPTED_FRESHNESS_EXIT_CODES 未因本需求变更这一点，由本 describe
  // 既有的行为断言承担（四态原样透传 / exit 3 判 unexpected-exit-code / 枚举外 state 判
  // unknown-state），不为此把两个模块私有常量提升为导出——只为断言而扩公共 API 是错误的交换。

  it('exit 1（强不变量违反）携带合法 JSON 时仍先取 stdout 解析', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"fail-strong-invariant","freshness":{"state":"stale","recordedSourceCommit":"aa","currentHead":"bb"}}\nJSON\nexit 1`,
    );
    expect(verdict.state).toBe('stale');
  });

  it('exit 2（cannot-assess）携带合法 JSON 时仍先取 stdout 解析', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"overallVerdict":"cannot-assess","freshness":{"state":"unknown-provenance"}}\nJSON\nexit 2`,
    );
    expect(verdict.state).toBe('unknown-provenance');
  });

  it('CLI 缺失（ENOENT）→ unknown-provenance + spectra-cli-missing', async () => {
    const verdict = await checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: path.join(sandbox.root, 'definitely-not-installed-spectra'),
    });
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('spectra-cli-missing');
  });

  it('stdout 不可解析 → unknown-provenance + unparseable-output', async () => {
    const verdict = await runWithFakeCli(`echo "not json at all"`);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('unparseable-output');
  });

  it('freshness 字段缺失 → unknown-provenance（不臆造状态）', async () => {
    const verdict = await runWithFakeCli(`cat <<'JSON'\n{"overallVerdict":"pass"}\nJSON`);
    expect(verdict.state).toBe('unknown-provenance');
  });

  it('spawn 参数以数组形式传入：子命令与 flag 不被空格拆分（§M10 毁图事故防线）', async () => {
    // 假 CLI 把收到的 argv 逐个回显；断言第一个参数精确是 `graph-quality` 而不是 `graph`。
    const argvDump = path.join(sandbox.root, 'argv.txt');
    const bin = writeFakeSpectra(
      sandbox.root,
      `printf '%s\\n' "$@" > ${JSON.stringify(argvDump)}\ncat <<'JSON'\n{"freshness":{"state":"fresh"}}\nJSON`,
      'fake-spectra-argv',
    );
    await checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: bin,
    });
    const argv = fs.readFileSync(argvDump, 'utf-8').trimEnd().split('\n');
    expect(argv[0]).toBe('graph-quality');
    expect(argv).toContain('--json');
    expect(argv).toContain('--graph');
    expect(argv).toContain(path.join(sandbox.root, GRAPH_REL));
  });

  // ── W2：接受面收窄——只认 exit ∈ {0,1,2} + 无 signal + 四态枚举内的 state ──
  it('W2：exit 3 即便携带合法 JSON 也判 unknown-provenance + unexpected-exit-code', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"fresh"}}\nJSON\nexit 3`,
    );
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('unexpected-exit-code');
  });

  it('W2：被信号杀死 → unknown-provenance + killed-by-signal', async () => {
    const verdict = await runWithFakeCli(`kill -9 $$`);
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('killed-by-signal');
  });

  it('W2：state 不在四态枚举内 → unknown-provenance + unknown-state，并回传原始值', async () => {
    const verdict = await runWithFakeCli(
      `cat <<'JSON'\n{"freshness":{"state":"definitely-ready"}}\nJSON`,
    );
    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('unknown-state');
    expect(verdict.receivedState).toBe('definitely-ready');
  });

  // ── C5：freshness 必须有界，不能无限阻塞整个 sync/hook ──
  it('C5：CLI 卡死时按 deadline 收口 → unknown-provenance + freshness-timeout（秒级返回）', async () => {
    const bin = writeFakeSpectra(sandbox.root, `trap '' TERM\nwhile true; do sleep 1; done`, 'stub-hang');

    const started = Date.now();
    const verdict = await checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: bin,
      deadlineMs: 800,
      graceMs: 300,
    });
    const elapsed = Date.now() - started;

    expect(verdict.state).toBe('unknown-provenance');
    expect(verdict.reason).toBe('freshness-timeout');
    expect(elapsed).toBeLessThan(15000);
  }, 30000);

  it('C5：freshness 默认 deadline 为 5000ms（远小于 SC-001 的 60s 预算）', () => {
    expect(statusCore.DEFAULT_FRESHNESS_DEADLINE_MS).toBe(5000);
  });

  // 真实 CLI 冒烟：本机装了全局 spectra 才跑，未装则显式 skip 并留痕（不静默跳过）。
  const hasGlobalSpectra = spawnSync('command', ['-v', 'spectra'], { shell: true }).status === 0;
  const resolvedSpectraBin = spawnSync('command', ['-v', 'spectra'], {
    shell: true,
    encoding: 'utf-8',
  }).stdout?.trim();
  const smokeIt = hasGlobalSpectra ? it : it.skip;

  // C1：此前该冒烟把 unknown-provenance 也当合法结果，于是"CLI 根本没被启动"仍判绿。
  // 现在要求传入绝对路径时 reason 不得是 spectra-cli-missing——CLI 必须真的跑起来。
  smokeIt('C1：真实全局 spectra CLI（绝对路径）必须真的被启动，reason 不得为 spectra-cli-missing', async () => {
    const verdict = await checkFreshness(sandbox.root, {
      graphJsonPath: path.join(sandbox.root, GRAPH_REL),
      spectraBin: resolvedSpectraBin,
    });
    expect(verdict.reason).not.toBe('spectra-cli-missing');
    expect(['fresh', 'dirty', 'stale', 'unknown-provenance']).toContain(verdict.state);
  }, 30000);
});

describe('F249 W-001 — buildFreshnessDiagnostic（四类单原因 + 多原因 + 退化形态）', () => {
  /** 四类单一原因各自的判别关键词（同时断言"不含其他三类的关键词"，防串台）。 */
  const SINGLE_REASON_CASES: ReadonlyArray<{
    reason: string;
    mustContain: string;
    mustNotContain: readonly string[];
  }> = [
    {
      reason: 'source-commit',
      mustContain: 'sourceCommit',
      mustNotContain: ['fingerprint'],
    },
    {
      reason: 'collector-fingerprint',
      mustContain: 'collector fingerprint 与当前采集器实现不一致',
      mustNotContain: ['sourceCommit', '未记录', '畸形'],
    },
    {
      reason: 'collector-fingerprint-unrecorded',
      mustContain: '未记录 collector fingerprint',
      mustNotContain: ['sourceCommit', '畸形'],
    },
    {
      reason: 'collector-fingerprint-invalid',
      mustContain: '结构畸形',
      mustNotContain: ['sourceCommit', '未记录'],
    },
  ];

  it.each(SINGLE_REASON_CASES)(
    '单原因 $reason：诊断串精确对应该原因，且不混入其他原因的说法',
    ({ reason, mustContain, mustNotContain }) => {
      const diagnostic = buildFreshnessDiagnostic({ state: 'stale', staleReasons: [reason] });

      expect(diagnostic).toContain('stale');
      expect(diagnostic).toContain(mustContain);
      for (const forbidden of mustNotContain) {
        expect(diagnostic).not.toContain(forbidden);
      }
      // 每条诊断都要带下一步动作，否则人看到告警不知道该做什么
      expect(diagnostic).toContain('spectra batch --mode graph-only');
    },
  );

  it('多原因并存：全部原因都出现且顺序与入参一致（不排序、不去重、不折叠）', () => {
    const diagnostic = buildFreshnessDiagnostic({
      state: 'stale',
      staleReasons: ['source-commit', 'collector-fingerprint-invalid'],
    });

    expect(diagnostic).toContain('sourceCommit');
    expect(diagnostic).toContain('结构畸形');
    expect(diagnostic.indexOf('sourceCommit')).toBeLessThan(diagnostic.indexOf('结构畸形'));

    // 反向顺序入参 → 诊断串顺序也反过来（证明确实沿用入参顺序而非内部固定顺序）
    const reversed = buildFreshnessDiagnostic({
      state: 'stale',
      staleReasons: ['collector-fingerprint-invalid', 'source-commit'],
    });
    expect(reversed.indexOf('结构畸形')).toBeLessThan(reversed.indexOf('sourceCommit'));
  });

  it('staleReasons 为空（旧版本 CLI）：诚实说明原因未提供，MUST NOT 猜成 commit 型', () => {
    const diagnostic = buildFreshnessDiagnostic({ state: 'stale', staleReasons: [] });

    expect(diagnostic).toContain('未提供具体原因');
    expect(diagnostic).not.toContain('sourceCommit');
  });

  it('未知原因值（CLI 比 helper 新）：原样回显收到的值，不静默丢弃', () => {
    const diagnostic = buildFreshnessDiagnostic({
      state: 'stale',
      staleReasons: ['some-future-reason'],
    });

    expect(diagnostic).toContain('some-future-reason');
  });

  it('非 stale 四态一律返回空串（诊断串只服务 stale 分支）', () => {
    for (const state of ['fresh', 'dirty', 'unknown-provenance']) {
      expect(buildFreshnessDiagnostic({ state, staleReasons: ['source-commit'] })).toBe('');
    }
  });

  it('诊断串不含 shell 危险字符（bash 侧要把它内插进双引号字符串）', () => {
    const samples = [
      buildFreshnessDiagnostic({ state: 'stale', staleReasons: [] }),
      buildFreshnessDiagnostic({
        state: 'stale',
        staleReasons: [
          'source-commit',
          'collector-fingerprint',
          'collector-fingerprint-unrecorded',
          'collector-fingerprint-invalid',
        ],
      }),
    ];
    for (const diagnostic of samples) {
      // 双引号/反斜杠会破坏 sed 提取；反引号与 $ 会在 shell 双引号语境触发命令替换/变量展开
      expect(diagnostic).not.toMatch(/["\\`$]/);
    }
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

  // ── C4：exit 0 不等于构建成功——必须验证产物存在、可解析、最小可查询 ──
  //
  // ⚠️ 语义翻转：本用例原先断言 `exit 0 → ok:true`，那正是审查复现的假成功
  // （`/usr/bin/true` 作 spectraBin、图根本不存在，却记 bootstrapSource=local-build）。
  it('C4：子进程 exit 0 但没产出图 → ok:false + graph-missing-after-build（不再是假成功）', async () => {
    const stub = writeFakeSpectra(sandbox.root, 'exit 0', 'stub-ok-no-graph');
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 1500,
      graceMs: 300,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('graph-missing-after-build');
  }, 20000);

  it('C4：exit 0 且产出可解析且含 graph.sourceCommit → ok:true', async () => {
    const stub = writeFakeSpectra(
      sandbox.root,
      `mkdir -p specs/_meta\nprintf '{"graph":{"sourceCommit":"%s"},"nodes":[]}' "${'c'.repeat(40)}" > specs/_meta/graph.json`,
      'stub-ok-with-graph',
    );
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 5000,
    });
    expect(outcome).toEqual({ ok: true });
  }, 20000);

  it('C4：产出存在但 JSON 损坏 → ok:false + graph-unparsable', async () => {
    const stub = writeFakeSpectra(
      sandbox.root,
      `mkdir -p specs/_meta\nprintf '{ broken' > specs/_meta/graph.json`,
      'stub-broken-graph',
    );
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 1500,
      graceMs: 300,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('graph-unparsable');
  }, 20000);

  it('C4：产出可解析但缺 graph.sourceCommit（不可查询）→ ok:false + graph-not-queryable', async () => {
    const stub = writeFakeSpectra(
      sandbox.root,
      `mkdir -p specs/_meta\nprintf '{"nodes":[],"links":[]}' > specs/_meta/graph.json`,
      'stub-unqueryable-graph',
    );
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 1500,
      graceMs: 300,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('graph-not-queryable');
  }, 20000);

  it('C4：父进程快速 exit 0、后台孙进程稍后才写出图 → 在 deadline 内等到产物即 ok:true', async () => {
    // 审查指出的盲区：孙进程测试都让父进程长活，没覆盖"父进程秒退但产物还没落盘"。
    const stub = writeFakeSpectra(
      sandbox.root,
      [
        `( sleep 0.6; mkdir -p specs/_meta; printf '{"graph":{"sourceCommit":"%s"},"nodes":[]}' "${'d'.repeat(40)}" > specs/_meta/graph.json ) &`,
        'exit 0',
      ].join('\n'),
      'stub-late-artifact',
    );
    const outcome = await attemptLocalGraphBuild({
      projectRoot: sandbox.root,
      spectraBin: stub,
      deadlineMs: 5000,
      graceMs: 300,
    });
    expect(outcome).toEqual({ ok: true });
  }, 20000);

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
