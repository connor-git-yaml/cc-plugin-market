/**
 * graph-consumption-cli.test.mjs
 * Feature 241 — 图消费决策 CLI（FR-008/009/010，SC-002/003/004/005/007/019）
 *
 * 四段结构（T-W5 拆分）：
 *   Part 1 — CLI 契约 + dry-run 零副作用 + advisory 非权威性 + SC-004 封闭键集 + RG-006 三段静态检查
 *   Part 2 — 双事件审计模型 + SC-005 的 12 值逐值验证
 *   Part 3 — SC-019 安装态（插件整体拷出仓外仍可跑）
 *   Part 4 — SC-002/003 真实刷新（非 mock）
 *
 * 所有用例都在临时 git fixture 项目里跑：审计文件、图文件、状态文件全部落在 sandbox 内，
 * 不触碰本仓 `specs/_meta/graph.json`。
 *
 * 运行方式: node --test plugins/spec-driver/tests/graph-consumption-cli.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CAVEAT_CODES,
  DEGRADED_REASONS,
  DEGRADED_REASON_HINTS,
} from '../scripts/lib/graph-consumption-decision.mjs';
import { finalizeRefreshOutcome } from '../scripts/graph-consumption-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(PLUGIN_DIR, 'scripts');
const CLI_PATH = path.join(SCRIPTS_DIR, 'graph-consumption-cli.mjs');

/**
 * RG-006 被审集合的**下限清单**（B1-C6 之后不再是全集）。
 *
 * 原实现把这 4 个文件当成被审全集，于是 `git-change-classifier.mjs` 这个决策链成员从未被扫描过，
 * 而且任何人只要把违规逻辑挪进一个新 helper 就能整体逃逸。现在被审集合改由
 * `resolveImportClosure(CLI_PATH)` 从入口递归解析得出，本清单退化为「闭包必须 ⊇ 它」的下限断言：
 * 闭包解析若因正则漏配而漏掉某个已知成员，这条下限会立刻红。
 */
const RG006_MINIMUM_AUDITED_FILES = [
  path.join(SCRIPTS_DIR, 'graph-consumption-cli.mjs'),
  path.join(SCRIPTS_DIR, 'lib', 'graph-consumption-decision.mjs'),
  path.join(SCRIPTS_DIR, 'lib', 'graph-refresh-executor.mjs'),
  path.join(SCRIPTS_DIR, 'lib', 'tasks-path-signal.mjs'),
  path.join(SCRIPTS_DIR, 'lib', 'git-change-classifier.mjs'),
];

/**
 * 从入口文件递归解析相对 import 闭包，作用域限 `plugins/spec-driver/scripts/` 子树（B1-C6）。
 *
 * 刻意只用正则做静态扫描、不引第三方解析器：这是一条门禁断言，它自身的依赖越少越可信。
 * 过度包含是安全方向（多扫一个文件只会更严），漏扫才危险，因此正则宁可宽：
 * 静态 `import ... from './x'`、`export ... from './x'`、动态 `import('./x')` 三种形态全收。
 */
function resolveImportClosure(entryPath) {
  const visited = new Set();
  const queue = [path.resolve(entryPath)];
  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const text = fs.readFileSync(current, 'utf-8');
    const specifiers = [
      ...[...text.matchAll(/from\s+['"](\.[^'"\n]+)['"]/g)].map((match) => match[1]),
      ...[...text.matchAll(/import\(\s*['"](\.[^'"\n]+)['"]\s*\)/g)].map((match) => match[1]),
    ];
    for (const specifier of specifiers) {
      const resolved = path.resolve(path.dirname(current), specifier);
      // 越出插件 scripts 子树的相对 import 由 SC-019 的边界断言负责，这里不重复管辖
      if (!resolved.startsWith(`${SCRIPTS_DIR}${path.sep}`)) continue;
      if (!fs.existsSync(resolved)) continue;
      queue.push(resolved);
    }
  }
  return [...visited].sort();
}

/**
 * 扫描 ② 的**唯一**豁免：canonical 的 `graph-bootstrap-status.mjs`。
 *
 * RG-006 的原话是「freshness 的唯一权威计算源 = `checkFreshness`」，而 `checkFreshness` 就住在
 * 这个文件里——它必须能 spawn `graph-quality` 并读回 `currentHead`。豁免写成一个恰等断言而不是
 * 一个可增长的白名单：一旦有人往里加第二个文件，测试立刻红。
 */
const FRESHNESS_AUTHORITY_FILE = path.join(SCRIPTS_DIR, 'lib', 'graph-bootstrap-status.mjs');

/** `decide` 输出的封闭键集合（SC-004：不得混入自由文本评价字段）。 */
const DECIDE_OUTPUT_KEYS = [
  'schemaVersion',
  'decisionId',
  'ts',
  'projectRoot',
  'phase',
  'advisory',
  'dryRun',
  'inputs',
  'scopeExtensionsSource',
  'coverageUnionApplied',
  'changedFiles',
  'outcome',
  'authoritativeOutcome',
  'degradedReason',
  'fallbackHint',
  'caveats',
  'matchedRule',
  'graphSourceCommit',
  'baseRefMissing',
  'refreshAttempted',
  'refreshOk',
  'refreshDurationMs',
  'refreshDetail',
  'auditWritten',
  'plan',
].sort();

const AUDIT_REL = path.join('.specify', 'graph-consumption-audit.jsonl');
const GRAPH_REL = path.join('specs', '_meta', 'graph.json');
const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

let sandbox;

/* ------------------------------------------------------------------ fixtures */

/** 造一个最小 TS git 项目；`initialCommit` 后工作树干净。 */
function seedProject(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function helper(): number {\n  return 1;\n}\n');
  fs.writeFileSync(
    path.join(root, 'src', 'b.ts'),
    "import { helper } from './a';\nexport function main(): number {\n  return helper() + 1;\n}\n",
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'f241-cli-fixture', version: '1.0.0', private: true }, null, 2)}\n`,
  );
  // 测试脚手架自身（假 spectra、调用日志、审计与图产物）必须被 fixture 的 .gitignore 挡住，
  // 否则它们会以未跟踪文件身份混进 porcelain，把 changeClass 污染成 additive-only。
  fs.writeFileSync(
    path.join(root, '.gitignore'),
    ['fake-spectra', 'spectra-invocations.log', '.specify/', 'specs/'].join('\n') + '\n',
  );
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
}

function writeGraph(root, sourceCommit = 'a'.repeat(40)) {
  fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
  fs.writeFileSync(
    path.join(root, GRAPH_REL),
    JSON.stringify({ graph: { sourceCommit }, nodes: [{ id: 'src/a.ts' }], edges: [] }),
  );
}

/**
 * 假 spectra：把每次调用记进日志，按 env 回放 freshness 状态与构建结果。
 *
 * 有它才能在不依赖真实图状态的前提下穷举 freshness 四态与刷新四类失败，同时精确数出 spawn 次数。
 * 真实 spectra 的对照证据由 Part 4 与 `graph-refresh-executor.test.mjs` 的集成用例提供。
 *
 * env 开关：
 *   F241_FRESHNESS      —— graph-quality 回放的 freshness 状态（默认 fresh）
 *   F241_BATCH_MODE     —— ok（默认，写出可查询图）| nonzero | hang | noartifact
 *   F241_SELF_DESTRUCT  —— 置 1 时 graph-quality 调用后删掉自身，令随后的 batch spawn 真实 ENOENT
 */
function seedFakeSpectra(root) {
  const binPath = path.join(root, 'fake-spectra');
  fs.writeFileSync(
    binPath,
    [
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$F241_INVOCATION_LOG"',
      'if [ "$1" = "graph-quality" ]; then',
      '  printf \'{"freshness":{"state":"%s","recordedSourceCommit":null,"currentHead":null}}\\n\' "${F241_FRESHNESS:-fresh}"',
      '  if [ "${F241_SELF_DESTRUCT:-0}" = "1" ]; then rm -f "$0"; fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "batch" ]; then',
      '  case "${F241_BATCH_MODE:-ok}" in',
      '    nonzero) exit 3 ;;',
      '    hang) sleep 30; exit 0 ;;',
      '    noartifact) rm -f "$PWD/specs/_meta/graph.json"; exit 0 ;;',
      '    *)',
      '      mkdir -p "$PWD/specs/_meta"',
      '      printf \'%s\' "{\\"graph\\":{\\"sourceCommit\\":\\"${F241_REBUILT_COMMIT:-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}\\"},\\"nodes\\":[],\\"edges\\":[]}" > "$PWD/specs/_meta/graph.json"',
      '      exit 0 ;;',
      '  esac',
      'fi',
      'exit 2',
    ].join('\n'),
    { mode: 0o755 },
  );
  return binPath;
}

function invocationLogPath(root) {
  return path.join(root, 'spectra-invocations.log');
}

function readInvocations(root) {
  const logPath = invocationLogPath(root);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf-8').split('\n').filter((line) => line.length > 0);
}

function countBuildSpawns(root) {
  return readInvocations(root).filter((line) => line.startsWith('batch ')).length;
}

/** 跑 CLI；`env` 用于控制假 spectra 的回放行为。 */
function runCli(args, { cwd = sandbox, env = {}, expectJson = true } = {}) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 120_000,
    env: {
      ...process.env,
      F241_INVOCATION_LOG: invocationLogPath(cwd),
      ...env,
    },
  });
  const out = { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, json: null };
  if (expectJson) {
    try {
      out.json = JSON.parse(out.stdout);
    } catch {
      out.json = null;
    }
  }
  return out;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readAuditEvents(root) {
  const auditPath = path.join(root, AUDIT_REL);
  if (!fs.existsSync(auditPath)) return [];
  return fs
    .readFileSync(auditPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(TMP_BASE, 'graph-consumption-cli-'));
});

afterEach(() => {
  try {
    // 只读目录用例会把 .specify 权限收掉，先还原再删，否则 rmSync EACCES
    const specifyDir = path.join(sandbox, '.specify');
    if (fs.existsSync(specifyDir)) fs.chmodSync(specifyDir, 0o755);
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});

/* ------------------------------------------------------- Part 1：CLI 契约 */

describe('Part 1 / FR-009 (a) decide --dry-run --format json 契约与零副作用', () => {
  it('输出可 JSON.parse 且含七个必需顶层键', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const result = runCli([
      'decide',
      '--project-root', sandbox,
      '--refresh-policy', 'allowed',
      '--dry-run',
      '--format', 'json',
      '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.notEqual(result.json, null, `stdout 不可解析：${result.stdout}`);
    for (const key of ['outcome', 'degradedReason', 'caveats', 'inputs', 'advisory', 'matchedRule', 'decisionId']) {
      assert.ok(key in result.json, `缺顶层键 ${key}`);
    }
    assert.equal(typeof result.json.decisionId, 'string');
    assert.match(result.json.decisionId, /^[0-9a-f-]{36}$/);
  });

  it('dry-run 前后图文件 SHA-256 不变，且不 spawn 任何构建', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const before = sha256(path.join(sandbox, GRAPH_REL));

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'allowed', '--dry-run', '--spectra-bin', bin,
    ], { env: { F241_FRESHNESS: 'stale' } });

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(sha256(path.join(sandbox, GRAPH_REL)), before, 'dry-run 不得改动图文件');
    assert.equal(countBuildSpawns(sandbox), 0, 'dry-run 不得 spawn 构建');
    assert.equal(result.json.refreshAttempted, false);
    assert.ok(Array.isArray(result.json.plan) && result.json.plan.length > 0, 'dry-run 应打印操作计划');
  });

  it('dry-run 审计文件零新增事件', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--spectra-bin', bin]);

    assert.deepEqual(readAuditEvents(sandbox), []);
    assert.equal(fs.existsSync(path.join(sandbox, AUDIT_REL)), false, 'dry-run 连审计文件都不该创建');
  });

  it('--format text 输出人读文本（非 JSON），且含出口与人读模板', () => {
    seedProject(sandbox);
    const bin = seedFakeSpectra(sandbox);
    // 无图 + declined → unavailable / graph-missing
    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--format', 'text', '--spectra-bin', bin],
      { expectJson: false },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.match(result.stdout, /unavailable/);
    assert.match(result.stdout, /graph-missing/);
    assert.ok(
      result.stdout.includes(DEGRADED_REASON_HINTS[DEGRADED_REASONS.GRAPH_MISSING]),
      'text 输出必须渲染固定人读模板',
    );
  });

  it('缺 --project-root / 非法 --refresh-policy → 非零退出并给出明确 stderr', () => {
    const missing = runCli(['decide', '--refresh-policy', 'allowed'], { expectJson: false });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /project-root/);

    const bad = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'maybe'], { expectJson: false });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /refresh-policy/);
  });
});

describe('Part 1 / FR-011 (b) --advisory 的非权威性', () => {
  it('advisory:true 且 authoritativeOutcome 为 null —— skip-impact 不落权威结论字段', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    // 制造 additive-only：新增一个未跟踪文件
    fs.writeFileSync(path.join(sandbox, 'src', 'c.ts'), 'export const c = 1;\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory', '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.advisory, true);
    assert.equal(result.json.outcome, 'skip-impact');
    assert.equal(result.json.inputs.changeClass, 'additive-only');
    assert.equal(
      result.json.authoritativeOutcome,
      null,
      'advisory 模式下 skip-impact 不得写入权威结论字段（FR-011）',
    );
  });

  it('不带 --advisory 时 advisory:false 且 authoritativeOutcome === outcome', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.writeFileSync(path.join(sandbox, 'src', 'c.ts'), 'export const c = 1;\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.json.advisory, false);
    assert.equal(result.json.authoritativeOutcome, result.json.outcome);
  });
});

describe('Part 1 / D3 --tasks-file：advisory 轮 1 的 tasks.md 目标路径信号', () => {
  /**
   * D3 的鸡生蛋处置：goal_loop 第一轮注入发生在 implement **之前**，此刻工作树是干净的，
   * git 侧只能给出 `unknown`。轮 1 的替代信号是「tasks.md 已声明目标文件路径的存在性」——
   * 纯文件系统事实，不是 agent 自报。
   *
   * 三条红线（都在下面逐条断言）：
   *   - 仅 advisory 生效：权威判定只认 git diff
   *   - git diff 非空时 git 优先：真实改动永远压过预判
   *   - 该信号产生的 skip-impact 仍是 advisory 结论，不得出现「本改动无影响面」类权威表述
   */
  /**
   * tasks 文件必须落在 fixture 已 gitignore 的 `.specify/` 下。
   * 放在跟踪范围内会让它自己以未跟踪文件身份混进 porcelain，把"干净工作树"这个前置条件破坏掉
   * ——那样测的就不是 tasks.md 信号，而是它自身造成的 additive-only。
   */
  function writeTasksFile(root, body) {
    const tasksPath = path.join(root, '.specify', 'tasks-fixture.md');
    fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
    fs.writeFileSync(tasksPath, body);
    return tasksPath;
  }

  it('(态 1) 干净工作树 + tasks.md 路径已存在 → changeClass=modifies-existing', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 改造 `src/a.ts` 的导出\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.deepEqual(result.json.changedFiles, [], '前置：工作树必须是干净的（git 信号为空）');
    assert.equal(result.json.inputs.changeClass, 'modifies-existing');
    assert.equal(result.json.advisory, true);
    assert.equal(result.json.authoritativeOutcome, null);
  });

  it('(态 2) 干净工作树 + tasks.md 路径全不存在 → additive-only / skip-impact，且措辞仍非权威', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 新增 `src/brand-new.ts` 与 `src/also-new.ts`\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.inputs.changeClass, 'additive-only');
    assert.equal(result.json.outcome, 'skip-impact');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY);
    // 保守方向约束（D3）：advisory 产生的 skip-impact 不得升格为权威结论
    assert.equal(result.json.advisory, true);
    assert.equal(result.json.authoritativeOutcome, null);
    // 措辞红线：fallbackHint 必须沿用既有模板映射，不得新增「本改动无影响面」类自由文本
    assert.equal(result.json.fallbackHint, DEGRADED_REASON_HINTS[DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY]);
    for (const stream of [result.stdout, result.stderr]) {
      assert.doesNotMatch(stream, /无影响面|没有影响面|零影响/, '不得出现权威口吻的「无影响面」表述');
    }
  });

  it('(态 3) 干净工作树 + tasks.md 抽不出路径 → changeClass 保持 unknown', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 记录 batch base：`git rev-parse HEAD`\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.inputs.changeClass, 'unknown');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.CLASSIFICATION_UNKNOWN);
  });

  it('git diff 非空时 git 信号优先：tasks.md 说纯新增也压不过真实的既有文件改动', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 新增 `src/brand-new.ts`\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.deepEqual(result.json.changedFiles, ['src/a.ts']);
    assert.equal(result.json.inputs.changeClass, 'modifies-existing', 'git 信号非空时不得被 tasks.md 覆盖');
    assert.notEqual(result.json.outcome, 'skip-impact');
  });

  it('非 advisory 传 --tasks-file → 忽略该信号 + stderr warning（权威判定只认 git diff）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 新增 `src/brand-new.ts`\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.advisory, false);
    assert.equal(
      result.json.inputs.changeClass,
      'unknown',
      '权威合同下 tasks.md 信号必须被忽略——干净工作树就是 unknown',
    );
    assert.match(result.stderr, /--tasks-file/, 'stderr 必须显式告知该参数被忽略，不得静默吞掉');
    assert.match(result.stderr, /advisory/);
  });

  it('--tasks-file 指向不存在的文件 → 降级为 warning，决策照常输出', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', path.join(sandbox, 'no-such-tasks.md'), '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `读不到 tasks.md 不得阻断决策；stderr=${result.stderr}`);
    assert.equal(result.json.inputs.changeClass, 'unknown');
    assert.match(result.stderr, /tasks-file/);
  });

  it('B1-W2 tasks.md 声明仓外/绝对路径 → 不得据此判 modifies-existing', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    // 造一个**确实存在**的绝对路径目标：旧判据会把它当仓内路径去探测，一个存在的文件就能
    // 把结论掰成 modifies-existing。落在 fixture 已 gitignore 的 `.specify/` 下，
    // 免得它自己以未跟踪文件身份混进 porcelain，把 git 信号变成非空（那样测的就不是本条判据）。
    const outsideFile = path.join(sandbox, '.specify', 'outside-marker.ts');
    fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
    fs.writeFileSync(outsideFile, 'export const x = 1;\n');
    assert.equal(fs.existsSync(outsideFile), true, '前置：该绝对路径目标必须真实存在');
    const tasksFile = writeTasksFile(
      sandbox,
      `- [ ] T001 改 \`/etc/hosts.txt\` 与 \`${outsideFile}\` 以及 \`../../escape.ts\`\n`,
    );

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(
      result.json.inputs.changeClass,
      'unknown',
      `仓外/绝对路径必须被拒收，抽不到仓内路径就是 unknown；实得 ${result.stdout}`,
    );
  });

  it('输出顶层键集合不因 --tasks-file 而改变（SC-004 封闭性）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tasksFile = writeTasksFile(sandbox, '- [ ] T001 改造 `src/a.ts`\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--advisory',
      '--tasks-file', tasksFile, '--dry-run', '--spectra-bin', bin,
    ]);
    assert.deepEqual(Object.keys(result.json).sort(), DECIDE_OUTPUT_KEYS);
  });
});

describe('Part 1 / FR-008 (c) 进程内 single-flight', () => {
  it('单次 decide 调用内 graph-only 构建至多被 spawn 一次（EC-07 防线）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    // 改一个既有文件 → modifies-existing；freshness 回放 stale → 命中矩阵行 8 触发刷新
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'allowed', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.inputs.freshness, 'stale');
    assert.equal(result.json.refreshAttempted, true);
    assert.equal(result.json.refreshOk, true);
    assert.equal(
      countBuildSpawns(sandbox),
      1,
      '刷新成功后不得因 freshness 仍非 fresh 而二次刷新（脏工作树重建后依然 dirty）',
    );
    assert.equal(result.json.outcome, 'consume-impact', '刷新成功后按收口规则直接落 consume-impact');
  });
});

describe('Part 1 / FR-010 (g) 审计写失败不阻断决策', () => {
  it('审计目录只读 → 仍 exit 0，stderr 给 warning，决策结果照常输出', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.mkdirSync(path.join(sandbox, '.specify'), { recursive: true });
    fs.chmodSync(path.join(sandbox, '.specify'), 0o555);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.status, 0, `审计写失败不得阻断决策；stderr=${result.stderr}`);
    assert.notEqual(result.json, null);
    assert.equal(result.json.auditWritten, false);
    assert.match(result.stderr, /审计/, 'stderr 必须给出可见 warning，而非静默吞掉');
  });
});

describe('Part 1 / SC-004 输出封闭性与人读模板映射', () => {
  it('decide JSON 顶层键集合恰为封闭键集（无自由文本评价字段）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--spectra-bin', bin,
    ]);
    assert.deepEqual(Object.keys(result.json).sort(), DECIDE_OUTPUT_KEYS);
  });

  it('inputs 子对象恰为五维（不多不少）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const result = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--spectra-bin', bin,
    ]);
    assert.deepEqual(
      Object.keys(result.json.inputs).sort(),
      ['changeClass', 'coverageScope', 'freshness', 'graphAvailability', 'refreshPolicy'],
    );
  });

  it('12 个 DEGRADED_REASONS 与固定人读模板一一对应（枚举→模板映射表）', () => {
    const reasons = Object.values(DEGRADED_REASONS);
    assert.equal(reasons.length, 12);
    assert.deepEqual(Object.keys(DEGRADED_REASON_HINTS).sort(), [...reasons].sort());
    for (const reason of reasons) {
      const template = DEGRADED_REASON_HINTS[reason];
      assert.equal(typeof template, 'string', `${reason} 缺模板`);
      assert.ok(template.trim().length > 0, `${reason} 模板为空`);
    }
    // 模板互不相同：12 个 reason 共用一句话等于没有映射
    assert.equal(new Set(Object.values(DEGRADED_REASON_HINTS)).size, 12);
  });
});

describe('Part 1 / RG-006 三段静态检查（T-C6 扩展版 + B1-C6 闭包化）', () => {
  const closure = () => resolveImportClosure(CLI_PATH);
  const sources = () =>
    closure().map((filePath) => ({ filePath, text: fs.readFileSync(filePath, 'utf-8') }));

  it('⓪ 被审集合 = CLI 入口的 import 闭包，且 ⊇ 已知成员下限（helper 无法逃逸）', () => {
    const audited = closure();
    for (const required of RG006_MINIMUM_AUDITED_FILES) {
      assert.ok(
        audited.includes(required),
        `闭包漏掉已知决策链成员 ${path.relative(PLUGIN_DIR, required)}——静态解析失效`,
      );
    }
    // 闭包必须真的比固定清单更大（canonical 经 graph-refresh-executor 间接进来），
    // 否则说明递归没生效，"闭包化"只是换了个名字
    assert.ok(
      audited.includes(FRESHNESS_AUTHORITY_FILE),
      '闭包未递归到 canonical graph-bootstrap-status.mjs——递归解析没生效',
    );
    for (const filePath of audited) {
      assert.ok(filePath.startsWith(`${SCRIPTS_DIR}${path.sep}`), `闭包越界：${filePath}`);
    }
  });

  it('① 产物名扫描：闭包内不写出任何 *freshness* / *source-commit* 命名的独立状态文件', () => {
    for (const { filePath, text } of sources()) {
      const stateFileLiterals = text.match(/['"`][^'"`\n]*(freshness|source-commit)[^'"`\n]*\.(json|jsonl|txt)['"`]/gi) ?? [];
      assert.deepEqual(
        stateFileLiterals,
        [],
        `${path.basename(filePath)} 出现新的 freshness/source-commit 状态文件字面量：${stateFileLiterals.join(',')}`,
      );
    }
  });

  it('② freshness 唯一依赖扫描：只经 checkFreshness，无自读 graph.json 的 sourceCommit 与 HEAD 比对', () => {
    const cli = fs.readFileSync(CLI_PATH, 'utf-8');
    assert.match(cli, /checkFreshness/, 'CLI 必须经 canonical 的 checkFreshness 取 freshness');

    // 豁免必须恰为一个文件，且它确实是 checkFreshness 的定义处——否则豁免本身就是逃逸口
    const exempt = closure().filter((filePath) => filePath === FRESHNESS_AUTHORITY_FILE);
    assert.deepEqual(exempt, [FRESHNESS_AUTHORITY_FILE], '扫描 ② 的豁免必须恰为 canonical 一处');
    assert.match(
      fs.readFileSync(FRESHNESS_AUTHORITY_FILE, 'utf-8'),
      /export\s+async\s+function\s+checkFreshness/,
      '被豁免的文件必须就是 checkFreshness 的定义处',
    );

    for (const { filePath, text } of sources()) {
      if (filePath === FRESHNESS_AUTHORITY_FILE) continue;
      const stripped = text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const forbidden of ['rev-parse', 'currentHead', 'worktreeHead']) {
        assert.equal(
          stripped.includes(forbidden),
          false,
          `${path.basename(filePath)} 出现 ${forbidden} —— 疑似自行拿 sourceCommit 比 HEAD 复算 freshness`,
        );
      }
    }
  });

  it('③ 审计路径读取扫描：除调用方传入的 decision JSON 外，不读审计事件流本身', () => {
    const cli = fs.readFileSync(CLI_PATH, 'utf-8');
    const auditConstant = 'AUDIT_REL';
    assert.match(cli, new RegExp(`const ${auditConstant}\\s*=`), 'CLI 应把审计路径收敛为单一常量');

    // 闭包全集扫描：任何文件只要在同一行里同时出现"审计路径"与"读取 API"就判红，
    // 这样把违规逻辑挪进新 helper 也逃不掉（B1-C6）
    const offending = [];
    for (const { filePath, text } of sources()) {
      for (const line of text.split('\n')) {
        if (!line.includes(auditConstant) && !line.includes('graph-consumption-audit')) continue;
        if (!/readFileSync|readFile\(|createReadStream/.test(line)) continue;
        offending.push(`${path.basename(filePath)}: ${line.trim()}`);
      }
    }
    assert.deepEqual(
      offending,
      [],
      `审计是只写不读的观测产物，禁止把它当决策输入（W3 / RG-006）：${offending.join(' | ')}`,
    );
  });
});

/* ------------------------------- Part 1c：批 1 Codex 整改（B1-C1/C2/C3/W4） */

describe('批 1 整改 / B1-C1 availability 收紧：缺 sourceCommit 的合法 JSON 判 corrupt', () => {
  /**
   * 审查复现：`{"graph":{}}` 是合法 JSON，`readEmbeddedSourceCommit` 因此回 `ok:true, value:null`，
   * 旧实现只看 `ok` 就判 `present`——一份查不出任何 provenance 的图被当成"图在手且可消费"。
   * EC-02 要求这类"存在但不可用"一律 corrupt。
   */
  const MALFORMED = [
    ['缺 graph.sourceCommit 字段', JSON.stringify({ graph: {}, nodes: [], edges: [] })],
    ['sourceCommit 为空串', JSON.stringify({ graph: { sourceCommit: '' }, nodes: [] })],
    ['sourceCommit 非字符串', JSON.stringify({ graph: { sourceCommit: 12345 }, nodes: [] })],
    ['整个 graph 字段缺失', JSON.stringify({ nodes: [], edges: [] })],
  ];

  for (const [label, body] of MALFORMED) {
    it(`${label} → graphAvailability=corrupt（declined 下落 unavailable / graph-corrupt）`, () => {
      seedProject(sandbox);
      fs.mkdirSync(path.join(sandbox, 'specs', '_meta'), { recursive: true });
      fs.writeFileSync(path.join(sandbox, GRAPH_REL), body);
      fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
      const bin = seedFakeSpectra(sandbox);

      const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

      assert.equal(result.status, 0, `stderr=${result.stderr}`);
      assert.equal(result.json.inputs.graphAvailability, 'corrupt', `实得 ${result.stdout}`);
      assert.equal(result.json.outcome, 'unavailable');
      assert.equal(result.json.degradedReason, DEGRADED_REASONS.GRAPH_CORRUPT);
      assert.equal(result.json.graphSourceCommit, null, 'corrupt 时不得报出一个 sourceCommit');
    });
  }

  it('sourceCommit 为非空字符串才判 present（正例对照，防收紧过头）', () => {
    seedProject(sandbox);
    writeGraph(sandbox, 'f'.repeat(40));
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(result.json.inputs.graphAvailability, 'present');
    assert.equal(result.json.graphSourceCommit, 'f'.repeat(40));
  });
});

describe('批 1 整改 / B1-C2 availability 采集入口用 lstat（EC-02 硬合同）', () => {
  it('broken symlink 的 graph.json → corrupt（旧实现用 statSync 会判成 missing）', () => {
    seedProject(sandbox);
    fs.mkdirSync(path.join(sandbox, 'specs', '_meta'), { recursive: true });
    fs.symlinkSync(path.join(sandbox, 'specs', '_meta', 'nowhere.json'), path.join(sandbox, GRAPH_REL));
    assert.equal(fs.existsSync(path.join(sandbox, GRAPH_REL)), false, '前置：这确实是一条断链');
    assert.doesNotThrow(() => fs.lstatSync(path.join(sandbox, GRAPH_REL)), '前置：lstat 看得见该路径');
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(
      result.json.inputs.graphAvailability,
      'corrupt',
      `路径存在但读不出可用产物 = corrupt，不是 missing；实得 ${result.stdout}`,
    );
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.GRAPH_CORRUPT);
  });

  it('graph.json 位置是目录 → corrupt', () => {
    seedProject(sandbox);
    fs.mkdirSync(path.join(sandbox, GRAPH_REL), { recursive: true });
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(result.json.inputs.graphAvailability, 'corrupt', `实得 ${result.stdout}`);
  });

  it('路径真的不存在（lstat ENOENT）→ missing（唯一的 missing 通路）', () => {
    seedProject(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(result.json.inputs.graphAvailability, 'missing');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.GRAPH_MISSING);
  });
});

describe('批 1 整改 / B1-C3 刷新成功后必须重读产物（G2），否则 annotate 必然 snapshot-mismatch', () => {
  const G1 = 'a'.repeat(40);
  const G2 = 'e'.repeat(40);

  /** G1 stale → allowed 刷新 → 假 spectra 写出 G2。 */
  function refreshToG2({ phase = 'verify' } = {}) {
    seedProject(sandbox);
    writeGraph(sandbox, G1);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const decided = runCli(
      ['decide', '--project-root', sandbox, '--phase', phase, '--refresh-policy', 'allowed', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale', F241_REBUILT_COMMIT: G2 } },
    );
    assert.equal(decided.status, 0, `stderr=${decided.stderr}`);
    assert.equal(decided.json.refreshOk, true, `前置：刷新应成功；实得 ${decided.stdout}`);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(sandbox, GRAPH_REL), 'utf-8')).graph.sourceCommit,
      G2,
      '前置：盘上的图确实已换成 G2',
    );
    return decided;
  }

  it('decide 输出与 decision 审计事件的 graphSourceCommit 都是 G2（不是决策时读到的 G1）', () => {
    const decided = refreshToG2();

    assert.equal(decided.json.graphSourceCommit, G2, '仍报 G1 会让后续 annotate 必然 snapshot-mismatch');
    const [event] = readAuditEvents(sandbox).filter((entry) => entry.kind === 'decision');
    assert.equal(event.graphSourceCommit, G2, 'decision 事件里的快照标识必须是刷新后的 G2');
    assert.equal(decided.json.outcome, 'consume-impact');
  });

  it('全链：G1 stale → 刷新 G2 → annotate-caveat 得 completed 且 caveat 不丢', () => {
    const decided = refreshToG2();
    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));

    const annotated = runCli([
      'annotate-caveat',
      '--project-root', sandbox,
      '--decision', `@${decisionFile}`,
      '--impact-result', JSON.stringify({ summary: { directCallers: 0 } }),
      '--target', 'src/a.ts::helper',
      '--impact-status', 'completed',
    ]);

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    const [annotation] = readAuditEvents(sandbox).filter((entry) => entry.kind === 'caveat-annotation');
    assert.equal(annotation.impactStatus, 'completed', 'G2 一致时不得判 snapshot-mismatch');
    assert.equal(annotation.graphSourceCommitAtAnnotation, G2);
    assert.deepEqual(annotation.caveats, [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT]);
  });

  it('finalizeRefreshOutcome：刷新成功但产物重读失败 → 改写为 refresh-failed-artifact-unusable', () => {
    // 这条分支只在"刷新与重读之间图被并发抹掉"的竞态下可达，用纯函数做确定性断言，
    // 不靠 sleep 去碰运气——碰不上就等于没测。
    const inputs = {
      changeClass: 'modifies-existing',
      graphAvailability: 'present',
      freshness: 'stale',
      coverageScope: 'in-graph-scope',
      refreshPolicy: 'allowed',
    };
    const decision = { outcome: 'refresh-then-consume', degradedReason: null, caveats: [], matchedRule: 8 };

    for (const bad of [null, '', undefined, 42]) {
      const outcome = finalizeRefreshOutcome({
        decision,
        inputs,
        refresh: { ok: true, degradedReason: null },
        rereadSourceCommit: bad,
      });
      assert.equal(outcome.refreshOk, false, `重读拿到 ${JSON.stringify(bad)} 不得继续声称刷新成功`);
      assert.equal(outcome.decision.degradedReason, DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE);
      assert.equal(outcome.decision.outcome, 'consume-degraded', 'graphAvailability=present 时降级消费旧快照');
      assert.equal(outcome.graphSourceCommit, null);
    }

    const good = finalizeRefreshOutcome({
      decision,
      inputs,
      refresh: { ok: true, degradedReason: null },
      rereadSourceCommit: G2,
    });
    assert.equal(good.refreshOk, true);
    assert.equal(good.decision.outcome, 'consume-impact');
    assert.equal(good.graphSourceCommit, G2);
  });

  it('finalizeRefreshOutcome：刷新本就失败时原样收口，graphSourceCommit 取重读实况（可为 null）', () => {
    const inputs = {
      changeClass: 'modifies-existing',
      graphAvailability: 'missing',
      freshness: 'unknown-provenance',
      coverageScope: 'in-graph-scope',
      refreshPolicy: 'allowed',
    };
    const decision = { outcome: 'refresh-then-consume', degradedReason: null, caveats: [], matchedRule: 5 };
    const outcome = finalizeRefreshOutcome({
      decision,
      inputs,
      refresh: { ok: false, degradedReason: DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT },
      rereadSourceCommit: null,
    });
    assert.equal(outcome.refreshOk, false);
    assert.equal(outcome.decision.outcome, 'unavailable');
    assert.equal(outcome.decision.degradedReason, DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT);
    assert.equal(outcome.graphSourceCommit, null);
  });
});

describe('批 1 整改 / B1-W4 审计 append 真并发', () => {
  it('6 个子进程并发 decide → 恰 6 条 decision 事件、逐行可解析、decisionId 互不相同', async () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const CONCURRENCY = 6;

    // 同时起进程（不 await 串行），让多个 writer 真的挤在同一个 appendFileSync 窗口上。
    // 旧用例是顺序跑两次，那测的是 append-only 语义，不是并发安全。
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            'node',
            [CLI_PATH, 'decide', '--project-root', sandbox, '--phase', 'concurrent', '--refresh-policy', 'declined', '--spectra-bin', bin],
            {
              cwd: sandbox,
              stdio: 'ignore',
              env: { ...process.env, F241_INVOCATION_LOG: invocationLogPath(sandbox) },
            },
          );
          child.on('error', reject);
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`子进程 exit ${code}`))));
        }),
      ),
    );

    const raw = fs.readFileSync(path.join(sandbox, AUDIT_REL), 'utf-8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    assert.equal(lines.length, CONCURRENCY, '并发写不得丢行或产生半行');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `并发写出现被撕裂的行：${line.slice(0, 120)}`);
    }
    const events = lines.map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.kind === 'decision').length, CONCURRENCY);
    assert.equal(new Set(events.map((event) => event.decisionId)).size, CONCURRENCY, 'decisionId 必须互不相同');
  });
});

/* --------------------------------------------- Part 2：双事件审计 + SC-005 */

describe('Part 2 / FR-010 (d) 调用方合同：同 phase 跑两次', () => {
  it('第一次 allowed 触发刷新、第二次 declined 不刷新；审计恰 2 条 kind:"decision" 事件', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const first = runCli(
      ['decide', '--project-root', sandbox, '--phase', 'implement', '--refresh-policy', 'allowed', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );
    const second = runCli(
      ['decide', '--project-root', sandbox, '--phase', 'implement', '--refresh-policy', 'declined', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(first.status, 0, `stderr=${first.stderr}`);
    assert.equal(second.status, 0, `stderr=${second.stderr}`);
    assert.equal(first.json.refreshAttempted, true);
    assert.equal(second.json.refreshAttempted, false, '第二次按调用方合同传 declined，不得再刷');
    assert.equal(second.json.degradedReason, DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED);

    const events = readAuditEvents(sandbox);
    assert.equal(events.filter((event) => event.kind === 'decision').length, 2);
    assert.equal(events.filter((event) => event.kind === 'caveat-annotation').length, 0);
    assert.equal(countBuildSpawns(sandbox), 1, '两次调用合计只应刷一次');
  });

  it('decision 事件字段集合与 spec Key Entities #3(a) 一致，caveats 恒空', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    const [event] = readAuditEvents(sandbox);

    assert.deepEqual(
      Object.keys(event).sort(),
      [
        'advisory', 'caveats', 'coverageUnionApplied', 'decisionId', 'degradedReason', 'graphSourceCommit',
        'inputs', 'kind', 'outcome', 'phase', 'projectRoot', 'refreshAttempted', 'refreshDurationMs',
        'refreshOk', 'schemaVersion', 'scopeExtensionsSource', 'ts',
      ],
    );
    assert.equal(event.schemaVersion, 3);
    assert.deepEqual(event.caveats, [], 'decision 事件的 caveats 恒空——caveat 只由注解事件产生');
    assert.equal(event.phase, 'unscoped', '--phase 缺省应落 sentinel');
  });

  it('审计文件 append-only：每条事件占一整行，行内无裸换行', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    const raw = fs.readFileSync(path.join(sandbox, AUDIT_REL), 'utf-8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  });
});

describe('Part 2 / FR-010 (e) annotate-caveat 事件与回链', () => {
  /** 跑一次真实 decide（非 dry-run），返回其输出与落盘的 decision JSON 路径。 */
  function decideForAnnotation() {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const decided = runCli([
      'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin,
    ]);
    assert.equal(decided.json.outcome, 'consume-impact', `前置：应落 consume-impact，实得 ${decided.stdout}`);

    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));
    return { decided, decisionFile };
  }

  it('以真实 decide 输出为入参 → 恰追加 1 条 caveat-annotation 事件，decisionId 回链正确', () => {
    const { decided, decisionFile } = decideForAnnotation();

    const annotated = runCli([
      'annotate-caveat',
      '--project-root', sandbox,
      '--decision', `@${decisionFile}`,
      '--impact-result', JSON.stringify({ directCallers: 0 }),
      '--target', 'src/a.ts::helper',
      '--impact-status', 'completed',
    ]);

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    const events = readAuditEvents(sandbox);
    const annotations = events.filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].decisionId, decided.json.decisionId, 'decisionId 必须回链到 decision 事件');
    assert.equal(annotations[0].schemaVersion, 3);
    assert.equal(annotations[0].impactStatus, 'completed');
    assert.deepEqual(annotations[0].caveats, ['coverage-gap-known-extraction-limit']);
    assert.deepEqual(annotated.json.decision.caveats, annotations[0].caveats, '输出与事件内容必须一致');
  });

  it('directCallers 非 0 → 不产生 caveat，但事件照常落盘（可观测"注解过了、没缺口"）', () => {
    const { decisionFile } = decideForAnnotation();

    const annotated = runCli([
      'annotate-caveat',
      '--project-root', sandbox,
      '--decision', `@${decisionFile}`,
      '--impact-result', JSON.stringify({ directCallers: 4 }),
      '--target', 'src/a.ts::helper',
      '--impact-status', 'completed',
    ]);

    assert.equal(annotated.status, 0);
    const annotations = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotations.length, 1);
    assert.deepEqual(annotations[0].caveats, []);
  });

  it('(f) 注解前图被重建（graphSourceCommit 不匹配）→ snapshot-mismatch 且 caveats 置空', () => {
    const { decisionFile } = decideForAnnotation();
    // 模拟"decide 读的是 G1、impact 却跑在 G2 上"：注解之前图被并发重建
    writeGraph(sandbox, 'c'.repeat(40));

    const annotated = runCli([
      'annotate-caveat',
      '--project-root', sandbox,
      '--decision', `@${decisionFile}`,
      '--impact-result', JSON.stringify({ directCallers: 0 }),
      '--target', 'src/a.ts::helper',
      '--impact-status', 'completed',
    ]);

    assert.equal(annotated.status, 0);
    const [annotation] = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotation.impactStatus, 'snapshot-mismatch');
    assert.deepEqual(annotation.caveats, [], 'snapshot-mismatch 时不得采信该 impact 结果');
    assert.equal(annotation.graphSourceCommitAtAnnotation, 'c'.repeat(40));
  });

  it('impactStatus=failed/skipped → 不注解 caveat，事件如实记录该状态', () => {
    const { decisionFile } = decideForAnnotation();
    for (const status of ['failed', 'skipped']) {
      runCli([
        'annotate-caveat', '--project-root', sandbox, '--decision', `@${decisionFile}`,
        '--impact-status', status,
      ]);
    }
    const annotations = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.deepEqual(annotations.map((event) => event.impactStatus), ['failed', 'skipped']);
    for (const annotation of annotations) assert.deepEqual(annotation.caveats, []);
  });

  it('缺 --decision / 非法 --impact-status → 非零退出', () => {
    seedProject(sandbox);
    const missing = runCli(['annotate-caveat', '--project-root', sandbox, '--impact-status', 'completed'], { expectJson: false });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--decision/);

    const bad = runCli(
      ['annotate-caveat', '--project-root', sandbox, '--decision', '{}', '--impact-status', 'whatever'],
      { expectJson: false },
    );
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /impact-status/);
  });
});

describe('批 1 整改 / B1-C4 annotate-caveat 与真实 MCP impact 形状对齐 + --target 显式声明', () => {
  /** 与上面同款：跑一次真实 decide（非 dry-run）拿到 consume-impact 的 decision。 */
  function decideForAnnotation() {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const decided = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(decided.json.outcome, 'consume-impact', `前置：应落 consume-impact，实得 ${decided.stdout}`);
    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));
    return decisionFile;
  }

  function annotate(decisionFile, extraArgs) {
    return runCli([
      'annotate-caveat', '--project-root', sandbox, '--decision', `@${decisionFile}`,
      '--impact-status', 'completed', ...extraArgs,
    ]);
  }

  it('真实 MCP 形状 `summary.directCallers: 0` + TS target → 注解 caveat（旧实现只认合成顶层形状）', () => {
    const decisionFile = decideForAnnotation();
    // Spectra MCP impact 的真实返回把计数放在 summary 里，且**不带** target 字段
    const realPayload = {
      summary: { directCallers: 0, transitiveCallers: 0, riskTier: 'low' },
      affected: [],
      topImpacted: [],
    };

    const annotated = annotate(decisionFile, [
      '--impact-result', JSON.stringify(realPayload),
      '--target', 'src/a.ts::helper',
    ]);

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    assert.deepEqual(annotated.json.caveats, [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT]);
  });

  it('顶层 directCallers 形状仍被接受（归一化只做补位，不换契约）', () => {
    const decisionFile = decideForAnnotation();
    const annotated = annotate(decisionFile, [
      '--impact-result', JSON.stringify({ directCallers: 0 }),
      '--target', 'src/a.tsx::Comp',
    ]);
    assert.deepEqual(annotated.json.caveats, [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT]);
  });

  it('summary 优先于顶层：两处并存且 summary 非 0 → 不注解', () => {
    const decisionFile = decideForAnnotation();
    const annotated = annotate(decisionFile, [
      '--impact-result', JSON.stringify({ directCallers: 0, summary: { directCallers: 5 } }),
      '--target', 'src/a.ts::helper',
    ]);
    assert.deepEqual(annotated.json.caveats, []);
  });

  it('缺 --target → 拒绝注解（宁可漏提示也不误提示，与 D7 红线同向）', () => {
    const decisionFile = decideForAnnotation();
    const annotated = annotate(decisionFile, ['--impact-result', JSON.stringify({ summary: { directCallers: 0 } })]);

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    assert.deepEqual(
      annotated.json.caveats,
      [],
      '目标未知就断言"该目标命中已登记漏边形态"是无根据的——旧实现在这里误加了 caveat',
    );
    const [annotation] = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotation.impactStatus, 'completed', '拒绝注解不等于注解失败，事件仍如实记 completed');
    assert.deepEqual(annotation.caveats, []);
  });

  it('--target 是图覆盖范围外的扩展名 → 拒绝注解（复用同一份覆盖面判据）', () => {
    const decisionFile = decideForAnnotation();
    // F254：`.mjs` 已不再是"范围外"的例子（它本就在图内），换成真正落在采集面之外的扩展名
    for (const target of [
      'docs/design.md',
      'README.txt',
      'config/settings.yaml',
      'no-extension-at-all',
    ]) {
      const annotated = annotate(decisionFile, [
        '--impact-result', JSON.stringify({ summary: { directCallers: 0 } }),
        '--target', target,
      ]);
      assert.deepEqual(annotated.json.caveats, [], `${target} 不该被注解`);
    }
  });
});

describe('Part 2 / SC-005 12 个 degradedReason 逐值落审计（非 dry-run decision 事件）', () => {
  /**
   * 每个枚举值构造一次真实 decide 调用。
   *
   * 四个 `refresh-failed-*` 都需要"freshness 能被读到、构建却失败"：
   *   - spectra-missing：假 spectra 在 graph-quality 之后自删，随后的 batch spawn 真实 ENOENT
   *   - timeout       ：batch 挂起 + 短 deadline
   *   - nonzero-exit  ：batch exit 3
   *   - artifact-unusable：batch exit 0 但把图删掉（假成功）
   */
  const SCENARIOS = [
    {
      reason: DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY,
      setup: (root) => { writeGraph(root); fs.writeFileSync(path.join(root, 'src', 'c.ts'), 'export const c = 1;\n'); },
      args: ['--refresh-policy', 'declined'],
    },
    {
      reason: DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE,
      // F254：触发文件必须真正落在采集面之外。原用例改的是 `notes.mjs`，而 `.mjs` 早已在图内——
      // 那条断言锁的是"白名单失真"这个 bug 本身，修复后自然不再成立。
      // `writeGraph` 写的是无 fingerprint 的旧图形态，因此本用例同时覆盖 static-fallback 路径。
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'notes.md'), '<!-- touched -->\n'); },
      args: ['--refresh-policy', 'declined'],
    },
    {
      reason: DEGRADED_REASONS.GRAPH_CORRUPT,
      setup: (root) => {
        fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
        fs.writeFileSync(path.join(root, GRAPH_REL), 'this is not json');
        fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n');
      },
      args: ['--refresh-policy', 'declined'],
    },
    {
      reason: DEGRADED_REASONS.GRAPH_MISSING,
      setup: (root) => { fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'declined'],
    },
    {
      reason: DEGRADED_REASONS.CLASSIFICATION_UNKNOWN,
      setup: (root) => { writeGraph(root); },   // 工作树全干净 → 判不出类别
      args: ['--refresh-policy', 'declined'],
    },
    {
      reason: DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'declined'],
      env: { F241_FRESHNESS: 'stale' },
    },
    {
      reason: DEGRADED_REASONS.GRAPH_DIRTY_UNCOMMITTED,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'declined'],
      env: { F241_FRESHNESS: 'dirty' },
    },
    {
      reason: DEGRADED_REASONS.GRAPH_UNKNOWN_PROVENANCE,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'declined'],
      env: { F241_FRESHNESS: 'unknown-provenance' },
    },
    {
      reason: DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'allowed'],
      env: { F241_FRESHNESS: 'stale', F241_SELF_DESTRUCT: '1' },
    },
    {
      reason: DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'allowed', '--refresh-deadline-ms', '900'],
      env: { F241_FRESHNESS: 'stale', F241_BATCH_MODE: 'hang' },
    },
    {
      reason: DEGRADED_REASONS.REFRESH_FAILED_NONZERO_EXIT,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'allowed'],
      env: { F241_FRESHNESS: 'stale', F241_BATCH_MODE: 'nonzero' },
    },
    {
      reason: DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE,
      setup: (root) => { writeGraph(root); fs.appendFileSync(path.join(root, 'src', 'a.ts'), '// touched\n'); },
      args: ['--refresh-policy', 'allowed', '--refresh-deadline-ms', '900'],
      env: { F241_FRESHNESS: 'stale', F241_BATCH_MODE: 'noartifact' },
    },
  ];

  it('SC-005 场景表覆盖全部 12 个枚举值，无重复无遗漏', () => {
    const covered = SCENARIOS.map((scenario) => scenario.reason);
    assert.equal(new Set(covered).size, 12);
    assert.deepEqual([...covered].sort(), [...Object.values(DEGRADED_REASONS)].sort());
  });

  for (const scenario of SCENARIOS) {
    it(`degradedReason=${scenario.reason} 落进 kind:"decision" 审计事件`, () => {
      seedProject(sandbox);
      // 已提交的范围外文件（`.md`）：out-of-graph-scope 场景靠改它来触发
      fs.writeFileSync(path.join(sandbox, 'notes.md'), '# notes\n');
      spawnSync('git', ['add', '-A'], { cwd: sandbox });
      spawnSync('git', ['commit', '-q', '-m', 'notes'], { cwd: sandbox });

      const bin = seedFakeSpectra(sandbox);
      scenario.setup(sandbox);

      const result = runCli(
        ['decide', '--project-root', sandbox, '--phase', 'sc005', ...scenario.args, '--spectra-bin', bin],
        { env: scenario.env ?? {} },
      );

      assert.equal(result.status, 0, `stderr=${result.stderr}`);
      assert.equal(result.json.degradedReason, scenario.reason, `CLI 输出：${result.stdout}`);

      const decisions = readAuditEvents(sandbox).filter((event) => event.kind === 'decision');
      assert.equal(decisions.length, 1, '非 dry-run 必须无条件落一条 decision 事件');
      assert.equal(decisions[0].degradedReason, scenario.reason);
      assert.equal(decisions[0].phase, 'sc005');
    });
  }
});

/* ----------------------------- Part 2b：F254 fingerprint 驱动的动态覆盖面 */

describe('Part 2b / F254 覆盖面优先取图自述的 collector fingerprint', () => {
  /**
   * 造一份合法的 F249 collector fingerprint（五条管线 key 齐全）。
   *
   * 默认值取本仓库真实采集面；`overrides` 用来精简/篡改某条管线，验证"动态面既能扩大也能收窄"
   * 与"结构畸形整体回落"。
   */
  function makeFingerprint(overrides = {}) {
    return {
      formatVersion: 1,
      extensionSurface: {
        tsjsSkeletonWalk: { extensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'], matchSemantics: 'case-sensitive' },
        pyWalk: { extensions: ['.py', '.pyi'], matchSemantics: 'case-sensitive' },
        genericAdapters: { extensions: ['.go', '.java'], matchSemantics: 'case-insensitive' },
        moduleDerivationScan: { extensions: ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'], matchSemantics: 'case-insensitive' },
        pythonSymbolScan: { extensions: ['.py'], matchSemantics: 'case-sensitive' },
        ...overrides,
      },
      behaviorVersion: 1,
    };
  }

  /** 与 `writeGraph` 同款，但图内嵌 `graph.fingerprint`（F249 之后的图形态）。 */
  function writeGraphWithFingerprint(root, fingerprint, sourceCommit = 'a'.repeat(40)) {
    fs.mkdirSync(path.join(root, 'specs', '_meta'), { recursive: true });
    fs.writeFileSync(
      path.join(root, GRAPH_REL),
      JSON.stringify({ graph: { sourceCommit, fingerprint }, nodes: [{ id: 'src/a.ts' }], edges: [] }),
    );
  }

  /** 提交一个指定文件后再改动它 → 稳定构造 modifies-existing + 指定扩展名的变更集。 */
  function commitThenTouch(root, relPath, initial, appended) {
    fs.mkdirSync(path.dirname(path.join(root, relPath)), { recursive: true });
    fs.writeFileSync(path.join(root, relPath), initial);
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['commit', '-q', '-m', `add ${relPath}`], { cwd: root });
    fs.appendFileSync(path.join(root, relPath), appended);
  }

  it('(a) 旧图无 fingerprint 字段 → static-fallback，且行为与本 fix 之前一致', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'notes.md', '# notes\n', '<!-- touched -->\n');
    writeGraph(sandbox); // 无 fingerprint 的旧图形态
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.scopeExtensionsSource, 'static-fallback');
    assert.equal(result.json.inputs.coverageScope, 'out-of-graph-scope', '`.md` 在静态 fallback 下也是范围外');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE);
  });

  it('(b) 合法 fingerprint 且面内不含 `.py` → `.py` 改动判 out-of-scope（动态面能收窄）', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'scripts/tool.py', 'x = 1\n', 'y = 2\n');
    // 精简掉两条 python 管线：这份图确实没收 .py，覆盖面就该如实反映
    writeGraphWithFingerprint(
      sandbox,
      makeFingerprint({
        pyWalk: { extensions: ['.no-such-ext'], matchSemantics: 'case-sensitive' },
        pythonSymbolScan: { extensions: ['.no-such-ext'], matchSemantics: 'case-sensitive' },
      }),
    );
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.scopeExtensionsSource, 'graph-fingerprint');
    assert.equal(
      result.json.inputs.coverageScope,
      'out-of-graph-scope',
      '静态 fallback 含 .py，但这份图自述不含——必须以图为准',
    );
  });

  it('(c) 合法 fingerprint 含 `.mjs` → `.mjs` 改动判 in-scope（本 fix 的核心正面回归）', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'scripts/tool.mjs', 'export const a = 1;\n', 'export const b = 2;\n');
    writeGraphWithFingerprint(sandbox, makeFingerprint());
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.scopeExtensionsSource, 'graph-fingerprint');
    assert.deepEqual(result.json.changedFiles, ['scripts/tool.mjs']);
    assert.equal(result.json.inputs.coverageScope, 'in-graph-scope');
    assert.notEqual(
      result.json.degradedReason,
      DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE,
      '.mjs 改动不得再被判范围外——这正是 F254 要修的行为',
    );
    assert.equal(result.json.outcome, 'consume-impact');
  });

  it('(c2) 静态 fallback 下 `.mjs` 同样 in-scope（无 fingerprint 的旧图不留缺口）', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'scripts/tool.mjs', 'export const a = 1;\n', 'export const b = 2;\n');
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);

    assert.equal(result.json.scopeExtensionsSource, 'static-fallback');
    assert.equal(result.json.inputs.coverageScope, 'in-graph-scope');
  });

  it('(d) fingerprint 结构畸形 → 整体回落 static-fallback，绝不产出部分并集', () => {
    const cases = [
      { label: 'formatVersion 非 1', fingerprint: { ...makeFingerprint(), formatVersion: 2 } },
      { label: 'formatVersion 是字符串', fingerprint: { ...makeFingerprint(), formatVersion: '1' } },
      { label: 'extensionSurface 缺一条管线 key', fingerprint: (() => {
        const fingerprint = makeFingerprint();
        delete fingerprint.extensionSurface.pythonSymbolScan;
        return fingerprint;
      })() },
      { label: 'extensions 不是数组', fingerprint: makeFingerprint({
        pyWalk: { extensions: '.py', matchSemantics: 'case-sensitive' },
      }) },
      { label: 'extensions 元素非字符串', fingerprint: makeFingerprint({
        pyWalk: { extensions: ['.py', 42], matchSemantics: 'case-sensitive' },
      }) },
      { label: 'extensionSurface 是数组', fingerprint: { formatVersion: 1, extensionSurface: [], behaviorVersion: 1 } },
      // W-2：多出未知管线 key 同样判不认识（严格集合，与 TS 侧 keySetEquals 同口径）。
      // 宽容忽略会让"新增第六条管线却忘了 bump formatVersion"静默按残缺五条算出合法并集——
      // 新管线覆盖的扩展名于是被判范围外，正是本 fix 的原始 bug 形态。
      { label: '合法五 key + 多出第 6 条未知管线 key', fingerprint: (() => {
        const fingerprint = makeFingerprint();
        fingerprint.extensionSurface.rustAdapters = { extensions: ['.rs'], matchSemantics: 'case-insensitive' };
        return fingerprint;
      })() },
      { label: 'fingerprint 是数组', fingerprint: [] },
      { label: 'fingerprint 是字符串', fingerprint: 'not-a-fingerprint' },
    ];

    for (const { label, fingerprint } of cases) {
      const root = fs.mkdtempSync(path.join(TMP_BASE, 'graph-consumption-cli-fp-'));
      try {
        seedProject(root);
        // 只造一个面外文件（.md）：静态 fallback 与任何"部分并集"都不含 .md，
        // 因此 out-of-graph-scope + static-fallback 这对断言足以判定是否整体回落
        commitThenTouch(root, 'notes.md', '# notes\n', '<!-- touched -->\n');
        writeGraphWithFingerprint(root, fingerprint);
        const bin = seedFakeSpectra(root);

        const result = runCli(
          ['decide', '--project-root', root, '--refresh-policy', 'declined', '--spectra-bin', bin],
          { cwd: root },
        );

        assert.equal(result.status, 0, `[${label}] stderr=${result.stderr}`);
        assert.equal(result.json.scopeExtensionsSource, 'static-fallback', `[${label}] 必须整体回落`);
        assert.equal(result.json.inputs.coverageScope, 'out-of-graph-scope', `[${label}]`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('(e) annotate-caveat 按注解时点独立重推导覆盖面，不透传 decide 阶段的值', () => {
    seedProject(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    // decide 时：图带合法 fingerprint（动态面）
    writeGraphWithFingerprint(sandbox, makeFingerprint());
    const bin = seedFakeSpectra(sandbox);

    const decided = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(decided.json.outcome, 'consume-impact', `前置：应落 consume-impact，实得 ${decided.stdout}`);
    assert.equal(decided.json.scopeExtensionsSource, 'graph-fingerprint');

    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));

    // 注解前图被换成"同 sourceCommit、但 fingerprint 已被抹掉"的形态：
    // 快照校验仍然通过（sourceCommit 未变），覆盖面来源却必须如实变成 static-fallback
    writeGraph(sandbox);

    const annotated = runCli([
      'annotate-caveat',
      '--project-root', sandbox,
      '--decision', `@${decisionFile}`,
      '--impact-result', JSON.stringify({ summary: { directCallers: 0 } }),
      '--target', 'src/a.ts::helper',
      '--impact-status', 'completed',
    ]);

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    const [annotation] = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotation.impactStatus, 'completed', '前置：sourceCommit 未变，快照校验应通过');
    assert.equal(
      annotation.scopeExtensionsSource,
      'static-fallback',
      'annotate 阶段必须按自己读到的图重推导，不得沿用 decide 阶段的 graph-fingerprint',
    );
    // `.ts` 在两份面里都在范围内，因此注解结论本身不变——变的只有来源标识
    assert.deepEqual(annotation.caveats, [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT]);
  });

  it('(f) 合法 fingerprint 下 caveat 判据与 coverageScope 判据消费同一份面（C-002）', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'scripts/tool.mjs', 'export const a = 1;\n', 'export const b = 2;\n');
    // 这份图自述"只收 .mjs"：`.ts` 应同时在两处判据里都落到面外
    writeGraphWithFingerprint(
      sandbox,
      makeFingerprint({
        tsjsSkeletonWalk: { extensions: ['.mjs'], matchSemantics: 'case-sensitive' },
        pyWalk: { extensions: ['.mjs'], matchSemantics: 'case-sensitive' },
        genericAdapters: { extensions: ['.mjs'], matchSemantics: 'case-insensitive' },
        moduleDerivationScan: { extensions: ['.mjs'], matchSemantics: 'case-insensitive' },
        pythonSymbolScan: { extensions: ['.mjs'], matchSemantics: 'case-sensitive' },
      }),
    );
    const bin = seedFakeSpectra(sandbox);

    const decided = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(decided.json.scopeExtensionsSource, 'graph-fingerprint');
    assert.equal(decided.json.inputs.coverageScope, 'in-graph-scope', '.mjs 在这份图的面内');
    assert.equal(decided.json.outcome, 'consume-impact');

    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));

    const annotateWith = (target) =>
      runCli([
        'annotate-caveat', '--project-root', sandbox, '--decision', `@${decisionFile}`,
        '--impact-result', JSON.stringify({ summary: { directCallers: 0 } }),
        '--target', target, '--impact-status', 'completed',
      ]);

    assert.deepEqual(
      annotateWith('scripts/tool.mjs::a').json.caveats,
      [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
      '面内目标应被注解',
    );
    assert.deepEqual(
      annotateWith('src/a.ts::helper').json.caveats,
      [],
      '`.ts` 不在这份图的自述面里 → caveat 判据必须与 coverageScope 用同一份面，不得回落静态白名单',
    );
  });

  /**
   * W-1（复审沙箱证伪路径转译）：窄面旧图 + 面外扩展改动 + stale 下的自锁。
   *
   * 构造一份"扩面之前建的旧图"：指纹五 key 齐全、结构完全合法，但采集面不含 `.mjs`
   * （模拟 d27ba75 扩面之前的图）。此时改动一个 `.mjs` 文件：
   * - `declined`：这份图确实不含 `.mjs`，判 out-of-graph-scope → 行 2 早退，**现状保持**
   * - `allowed` ：重建能把 `.mjs` 纳入（当前 collector 面含它），必须放行到刷新分支，
   *               否则图永远不因这类改动被刷新，而刷新恰恰是唯一出路
   */
  function seedNarrowFingerprintMjsChange(root) {
    seedProject(root);
    commitThenTouch(root, 'scripts/tool.mjs', 'export const a = 1;\n', 'export const b = 2;\n');
    writeGraphWithFingerprint(
      root,
      makeFingerprint({
        // 扩面前的 TSJS 面：无 .mjs/.cjs
        tsjsSkeletonWalk: { extensions: ['.js', '.jsx', '.ts', '.tsx'], matchSemantics: 'case-sensitive' },
        moduleDerivationScan: { extensions: ['.js', '.jsx', '.ts', '.tsx'], matchSemantics: 'case-insensitive' },
      }),
    );
    return seedFakeSpectra(root);
  }

  it('(h) W-1：窄面旧图 + .mjs 改动 + stale × allowed → 进入刷新链（行 8），不被行 2 自锁早退', () => {
    const bin = seedNarrowFingerprintMjsChange(sandbox);

    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'allowed', '--dry-run', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.deepEqual(result.json.changedFiles, ['scripts/tool.mjs']);
    // allowed 下用「重建可达面」= union(图自述窄面, 静态面)，`.mjs` 在静态面内 → in-scope
    assert.equal(result.json.scopeExtensionsSource, 'graph-fingerprint');
    assert.equal(result.json.coverageUnionApplied, true, 'allowed + 可推导指纹 → 必须启用并集');
    assert.equal(result.json.inputs.coverageScope, 'in-graph-scope');
    // 行 8（stale × allowed）而非行 2：刷新链被打通
    assert.equal(result.json.matchedRule, 8, `应命中 stale×allowed 刷新行，实得 ${result.stdout}`);
    assert.equal(result.json.outcome, 'refresh-then-consume');
    assert.notEqual(result.json.degradedReason, DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE);
    assert.ok(
      result.json.plan.some((entry) => entry.includes('拟执行全量重建')),
      `dry-run 计划必须含重建动作，实得 ${JSON.stringify(result.json.plan)}`,
    );
  });

  it('(i) W-1 对照：同构造 + declined → 仍是行 2 consume-degraded（不重建时判范围外是正确的）', () => {
    const bin = seedNarrowFingerprintMjsChange(sandbox);

    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    // declined 下只问「手里这份图」——它确实不含 .mjs
    assert.equal(result.json.scopeExtensionsSource, 'graph-fingerprint');
    assert.equal(result.json.coverageUnionApplied, false, 'declined 不得启用并集');
    assert.equal(result.json.inputs.coverageScope, 'out-of-graph-scope');
    assert.equal(result.json.matchedRule, 2);
    assert.equal(result.json.outcome, 'consume-degraded');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE);
    assert.ok(
      result.json.plan.every((entry) => !entry.includes('拟执行全量重建')),
      'declined 下不得出现重建计划',
    );
  });

  it('(j) W-1 边界：目标落在并集之外时，allowed 下行 2 仍然早退（"重建也进不去"的论证依然成立）', () => {
    seedProject(sandbox);
    commitThenTouch(sandbox, 'notes.md', '# notes\n', '<!-- touched -->\n');
    writeGraphWithFingerprint(sandbox, makeFingerprint());
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'allowed', '--dry-run', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.coverageUnionApplied, true);
    // `.md` 既不在图自述面、也不在静态面 → 并集里也没有 → 重建确实进不去，行 2 早退是对的
    assert.equal(result.json.inputs.coverageScope, 'out-of-graph-scope');
    assert.equal(result.json.matchedRule, 2);
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE);
    assert.ok(
      result.json.plan.every((entry) => !entry.includes('拟执行全量重建')),
      '真正范围外的目标不得触发重建（行 2 的原始设计意图：不为范围外目标白花一次全量重建）',
    );
  });

  it('(k) W-1：图自述面比静态面更宽（图由更新的 collector 建）→ allowed 下并集必须保留 derived 半边', () => {
    /**
     * 守护对象：把 L508 的并集写成"allowed 只用静态面"的变异——(h)/(i)/(j) 三条**全都杀不掉它**，
     * 因为那三条里 `.mjs` / `.md` 恰好都在静态面这一侧，只用静态面也能得出相同结论。
     *
     * 本用例走另一个 skew 方向：安装的 spectra 比 plugin 新、采集面已含 `.rs`，于是它建出来的图
     * 自述面比 plugin 的静态 12-ext 更宽。此时 `.rs` 改动**只**存在于 derived 半边——并集一旦
     * 丢掉 derived，`.rs` 就会被判范围外而错过刷新，正是 W-1 自锁的同一形态。
     */
    seedProject(sandbox);
    commitThenTouch(sandbox, 'src/lib.rs', 'fn a() {}\n', 'fn b() {}\n');
    writeGraphWithFingerprint(
      sandbox,
      makeFingerprint({
        // 五 key 齐全、结构合法，只是某条管线声明了本仓静态面之外的扩展
        tsjsSkeletonWalk: {
          extensions: ['.cjs', '.js', '.jsx', '.mjs', '.rs', '.ts', '.tsx'],
          matchSemantics: 'case-sensitive',
        },
      }),
    );
    const bin = seedFakeSpectra(sandbox);

    const result = runCli(
      ['decide', '--project-root', sandbox, '--refresh-policy', 'allowed', '--dry-run', '--spectra-bin', bin],
      { env: { F241_FRESHNESS: 'stale' } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.deepEqual(result.json.changedFiles, ['src/lib.rs']);
    assert.equal(result.json.coverageUnionApplied, true);
    assert.equal(
      result.json.inputs.coverageScope,
      'in-graph-scope',
      '`.rs` 只在图自述面里——并集丢掉 derived 半边就会误判范围外',
    );
    assert.equal(result.json.matchedRule, 8, `应命中 stale×allowed 刷新行，实得 ${result.stdout}`);
    assert.equal(result.json.outcome, 'refresh-then-consume');
  });

  it('(g) 【已知现状基线·勿当 bug 修】注解时点覆盖面收窄到目标扩展名之外 → 静默不注解、无替代信号', () => {
    /**
     * F254 quality-review **WARNING-1** 登记的已知现状（编排器裁决：不改行为，只把现状钉住）。
     *
     * 现象：decide 时目标在覆盖面内（走 static-fallback，`.py` 在 12-ext 并集里）→ 落 consume-impact；
     * 到 annotate 时图换成了**同 sourceCommit 但采集面更窄**的指纹（不含 `.py`），于是 FR-010 快照校验
     * 照常通过（sourceCommit 相同），caveat 判据却已把该目标判到面外——结果是 caveat 被**静默丢弃**：
     * 输出仍是 consume-impact、caveats 为空，除了 `scopeExtensionsSource` 变成 graph-fingerprint 之外
     * 没有任何信号告诉消费方"这个目标其实已经不在图覆盖范围里了"。
     *
     * 触发条件极窄（同一个 sourceCommit 下指纹采集面发生收窄，理论上不该发生：采集面变了指纹就变了、
     * 通常伴随重建从而换 sourceCommit），因此裁决为**不改行为**。
     *
     * **本用例是基线而非期望**：未来若决定在此补一条显式信号（如新增 caveat 码或 degradedReason），
     * 要翻转的就是下面这两条断言（caveats 为空 / outcome 不变）。届时请连同本注释一并更新，
     * 不要把它当成回归 bug 顺手"修绿"。
     */
    seedProject(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');
    // decide 时：无 fingerprint 的旧图 → static-fallback（`.py` 在 12-ext 静态并集内）
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const decided = runCli(['decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--spectra-bin', bin]);
    assert.equal(decided.json.outcome, 'consume-impact', `前置：应落 consume-impact，实得 ${decided.stdout}`);
    assert.equal(decided.json.scopeExtensionsSource, 'static-fallback');

    const decisionFile = path.join(sandbox, 'decision.json');
    fs.writeFileSync(decisionFile, JSON.stringify(decided.json));

    const annotatePyTarget = () =>
      runCli([
        'annotate-caveat', '--project-root', sandbox, '--decision', `@${decisionFile}`,
        '--impact-result', JSON.stringify({ summary: { directCallers: 0 } }),
        '--target', 'src/x.py::foo', '--impact-status', 'completed',
      ]);

    // 对照组：图未换之前，同一个 `.py` 目标在 static-fallback 下**是**会被注解的——
    // 这一步确保下面的"没注解"确实源于指纹收窄，而不是别的前置条件不满足。
    assert.deepEqual(
      annotatePyTarget().json.caveats,
      [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
      '对照：static-fallback 含 .py，注解通道本应打开',
    );

    // 换成同 sourceCommit（'a'.repeat(40)，与 writeGraph 默认值一致）但采集面不含 `.py` 的窄指纹。
    // 五条管线 key 必须齐全（deriveScopeExtensionsFromFingerprint 是"全有或全无"核验），
    // 只是把两条 python 管线的 extensions 换成非 `.py`。
    writeGraphWithFingerprint(
      sandbox,
      makeFingerprint({
        pyWalk: { extensions: ['.ts'], matchSemantics: 'case-sensitive' },
        pythonSymbolScan: { extensions: ['.ts'], matchSemantics: 'case-sensitive' },
      }),
      'a'.repeat(40),
    );

    const annotated = annotatePyTarget();

    assert.equal(annotated.status, 0, `stderr=${annotated.stderr}`);
    // FR-010 快照校验通过：sourceCommit 未变，因此不是 snapshot-mismatch 那条已有的显式通道
    assert.equal(annotated.json.impactStatus, 'completed', '同 sourceCommit → 快照校验必须通过');
    assert.equal(annotated.json.scopeExtensionsSource, 'graph-fingerprint', '注解时点已改用窄的图自述面');
    // 以下两条即"静默丢弃"的现状：出口不变、caveats 为空、没有任何替代信号
    assert.equal(annotated.json.decision.outcome, 'consume-impact', '出口不变（caveat 通道不改出口）');
    assert.deepEqual(
      annotated.json.decision.caveats,
      [],
      '现状基线：目标落到窄面之外 → 不注解，且不产生任何替代信号（WARNING-1，非 bug）',
    );

    const annotations = readAuditEvents(sandbox).filter((event) => event.kind === 'caveat-annotation');
    assert.equal(annotations.length, 2, '两次注解各留一条审计事件');
    assert.deepEqual(annotations[1].caveats, [], '审计事件同样只如实记空 caveats，不含降级/警示字段');
  });
});

/* ------------------------------------------ Part 3：SC-019 安装态可达性 */

describe('Part 3 / SC-019 插件整体拷到仓外仍可运行', () => {
  it('从仓外临时目录跑 decide --dry-run --format json：exit 0 + 可解析 + 无模块解析错误', () => {
    // D8 之所以把 canonical 搬进插件，就是为了这条：已安装的 spec-driver 缓存里只有
    // plugins/spec-driver/**，任何越出该目录的相对 import 在安装态都会 ERR_MODULE_NOT_FOUND。
    const installRoot = fs.mkdtempSync(path.join(TMP_BASE, 'spec-driver-installed-'));
    try {
      fs.cpSync(PLUGIN_DIR, path.join(installRoot, 'spec-driver'), { recursive: true });
      const installedCli = path.join(installRoot, 'spec-driver', 'scripts', 'graph-consumption-cli.mjs');
      assert.equal(fs.existsSync(installedCli), true);

      seedProject(sandbox);
      writeGraph(sandbox);
      const bin = seedFakeSpectra(sandbox);

      const result = spawnSync(
        'node',
        [installedCli, 'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--format', 'json', '--spectra-bin', bin],
        {
          cwd: installRoot,
          encoding: 'utf-8',
          timeout: 120_000,
          env: { ...process.env, F241_INVOCATION_LOG: invocationLogPath(sandbox) },
        },
      );

      assert.equal(result.status, 0, `stderr=${result.stderr}`);
      assert.doesNotMatch(result.stderr ?? '', /ERR_MODULE_NOT_FOUND/);
      assert.doesNotMatch(result.stderr ?? '', /Cannot find module/);
      const payload = JSON.parse(result.stdout);
      assert.equal(typeof payload.outcome, 'string');
      assert.deepEqual(Object.keys(payload).sort(), DECIDE_OUTPUT_KEYS);
    } finally {
      fs.rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it('CLI 及其依赖链的相对 import 全部落在插件目录内（不越界回仓根）', () => {
    const files = [
      CLI_PATH,
      path.join(PLUGIN_DIR, 'scripts', 'lib', 'graph-consumption-decision.mjs'),
      path.join(PLUGIN_DIR, 'scripts', 'lib', 'graph-refresh-executor.mjs'),
      path.join(PLUGIN_DIR, 'scripts', 'lib', 'git-change-classifier.mjs'),
      path.join(PLUGIN_DIR, 'scripts', 'lib', 'graph-bootstrap-status.mjs'),
      path.join(PLUGIN_DIR, 'scripts', 'lib', 'tasks-path-signal.mjs'),
    ];
    for (const filePath of files) {
      const text = fs.readFileSync(filePath, 'utf-8');
      const escaping = [...text.matchAll(/from\s+'(\.\.\/\.\.\/[^']*)'/g)].map((match) => match[1]);
      assert.deepEqual(escaping, [], `${path.basename(filePath)} 存在越出插件目录的相对 import：${escaping.join(',')}`);
    }
  });
});

/* --------------------------------- Part 4：SC-002/003 真实刷新（非 mock） */

describe('Part 4 / SC-002 真实 stale 图上的真实刷新', () => {
  it('真实 spectra + 真实 stale：refreshOk:true、终态 consume-impact、审计恰 1 条 decision 事件', () => {
    const probe = spawnSync('spectra', ['--version'], { encoding: 'utf-8' });
    if (probe.error || probe.status !== 0) {
      assert.fail('本机 spectra CLI 不可用，SC-002 真实刷新证据无法取得——不得以 mock 冒充');
    }

    const baseRef = seedProject(sandbox);
    // 在 C1 上建真图
    const built = spawnSync('spectra', ['batch', '--mode', 'graph-only'], { cwd: sandbox, encoding: 'utf-8' });
    assert.equal(built.status, 0, `建图失败：${built.stderr}`);
    const graphPath = path.join(sandbox, GRAPH_REL);
    const commitAtBuild = JSON.parse(fs.readFileSync(graphPath, 'utf-8')).graph.sourceCommit;
    assert.equal(commitAtBuild, baseRef);

    // 推进到 C2 并保持工作树干净 → 图真实落后于 HEAD（stale，而非 dirty）
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '\nexport function extra(): number {\n  return helper();\n}\n');
    spawnSync('git', ['add', '-A'], { cwd: sandbox });
    spawnSync('git', ['commit', '-q', '-m', 'second'], { cwd: sandbox });
    const beforeSha = sha256(graphPath);

    const result = runCli([
      'decide',
      '--project-root', sandbox,
      '--phase', 'verify',
      '--base-ref', baseRef,
      '--refresh-policy', 'allowed',
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.inputs.freshness, 'stale', `真实 freshness 应为 stale，实得 ${result.stdout}`);
    assert.equal(result.json.inputs.changeClass, 'modifies-existing');
    assert.equal(result.json.refreshAttempted, true);
    assert.equal(result.json.refreshOk, true);
    assert.ok(result.json.refreshDurationMs > 0, 'refreshDurationMs 必须非空且为正');
    assert.equal(result.json.outcome, 'consume-impact', '刷新成功后按收口规则直接落 consume-impact');

    // 真实重建确实换了图（对照 SC-003 的"不该动就一字节不动"）
    assert.notEqual(sha256(graphPath), beforeSha, '真实刷新后图文件应当变化');
    const rebuilt = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    assert.notEqual(rebuilt.graph.sourceCommit, commitAtBuild);

    const decisions = readAuditEvents(sandbox).filter((event) => event.kind === 'decision');
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].refreshOk, true);
    assert.ok(decisions[0].refreshDurationMs > 0);
    assert.equal(decisions[0].phase, 'verify');
  });
});

describe('Part 4 / SC-003 additive-only 非 dry-run 下图文件零变化', () => {
  it('纯新增改动 → skip-impact，且图文件 SHA-256 全程不变（不是 dry-run 的被动跳过）', () => {
    const probe = spawnSync('spectra', ['--version'], { encoding: 'utf-8' });
    if (probe.error || probe.status !== 0) {
      assert.fail('本机 spectra CLI 不可用，SC-003 证据无法取得——不得以 mock 冒充');
    }

    const baseRef = seedProject(sandbox);
    const built = spawnSync('spectra', ['batch', '--mode', 'graph-only'], { cwd: sandbox, encoding: 'utf-8' });
    assert.equal(built.status, 0, `建图失败：${built.stderr}`);
    const graphPath = path.join(sandbox, GRAPH_REL);
    const beforeSha = sha256(graphPath);

    // 纯新增：一个未跟踪的新文件，没有任何既有文件被改
    fs.writeFileSync(path.join(sandbox, 'src', 'brand-new.ts'), 'export const brandNew = 1;\n');

    const result = runCli([
      'decide',
      '--project-root', sandbox,
      '--base-ref', baseRef,
      '--refresh-policy', 'allowed', // 刻意给 allowed：证明是矩阵行 1 主动短路，不是没预算
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.inputs.changeClass, 'additive-only');
    assert.equal(result.json.inputs.refreshPolicy, 'allowed');
    assert.equal(result.json.outcome, 'skip-impact');
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY);
    assert.equal(result.json.refreshAttempted, false);
    assert.equal(sha256(graphPath), beforeSha, '不该刷就一字节都不该动');

    const decisions = readAuditEvents(sandbox).filter((event) => event.kind === 'decision');
    assert.equal(decisions.length, 1, '非 dry-run 仍必须留下决策证据');
    assert.equal(decisions[0].outcome, 'skip-impact');
  });
});

describe('Part 3 补充 / 符号链接路径下的自调用守卫回归', () => {
  it('经符号链接路径调用 CLI 仍产出决策（守卫必须比 realpath，否则 exit 0 却静默空转）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    const linkDir = path.join(sandbox, 'link-to-scripts');
    fs.symlinkSync(path.join(PLUGIN_DIR, 'scripts'), linkDir, 'dir');
    const viaSymlink = path.join(linkDir, 'graph-consumption-cli.mjs');

    const result = spawnSync(
      'node',
      [viaSymlink, 'decide', '--project-root', sandbox, '--refresh-policy', 'declined', '--dry-run', '--format', 'json', '--spectra-bin', bin],
      { cwd: sandbox, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, F241_INVOCATION_LOG: invocationLogPath(sandbox) } },
    );

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.notEqual((result.stdout ?? '').trim(), '', 'stdout 为空 = main() 未执行 = 静默空转');
    assert.equal(typeof JSON.parse(result.stdout).outcome, 'string');
  });
});
