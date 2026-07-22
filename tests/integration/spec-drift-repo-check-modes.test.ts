/**
 * T027（C2）：US3 全部 5 条 Acceptance Scenario 的端到端验证（FR-006/007/008、SC-004）。
 *
 * 沙箱策略：复制一份最小可通过 `repo:check` 的仓库骨架到临时目录（与
 * tests/integration/repo-maintenance-sync-check.test.ts 同构），使"整体 status"断言
 * 不被沙箱自身的缺件噪声污染——沙箱基线 status 必须先是 `pass`（见第 0 条断言）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRepository } from '../../scripts/lib/repo-maintenance-core.mjs';
import { checkAnchors } from '../../scripts/lib/spec-drift-check.mjs';
import { FINGERPRINT_VERSION, NORMALIZATION_PROFILE } from '../../scripts/lib/spec-drift-fingerprint.mjs';
import { LOCK_SCHEMA_VERSION } from '../../scripts/lib/spec-drift-lock-io.mjs';

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
}
interface ValidationResult {
  status: string;
  checks: Check[];
  warnings: string[];
  errors: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURE = path.join(REPO_ROOT, 'tests/fixtures/spec-drift/repo-check');

const COPY_TREES = [
  'contracts',
  'scripts',
  'plugins/spec-driver',
  'plugins/spectra',
  '.claude-plugin',
  '.claude',
  '.codex',
  '.specify',
  'docs/shared',
  'specs/products',
  'skills',
  'src/skills-global',
];
const COPY_FILES = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'package.json',
  'package-lock.json',
  '.gitignore',
  '.agents/plugins/marketplace.json',
];

let sandbox: string;
let lockPath: string;

function buildSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-repo-check-'));
  for (const tree of COPY_TREES) {
    fs.mkdirSync(path.dirname(path.join(root, tree)), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, tree), path.join(root, tree), { recursive: true });
  }
  for (const file of COPY_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'src/target.ts'), path.join(root, 'src/target.ts'));
  return root;
}

function anchorRecord(fingerprint: string) {
  return {
    id: 'c2-applyDiscount',
    ref: 'src/target.ts::applyDiscount',
    docPath: 'docs/pricing.md',
    line: 42,
    symbolId: 'src/target.ts::applyDiscount',
    fingerprint,
    fingerprintVersion: FINGERPRINT_VERSION,
    normalizationProfile: NORMALIZATION_PROFILE,
    resolvedFrom: 'src/target.ts::applyDiscount',
    matchKind: 'exact',
  };
}

function writeLock(content: string) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, content);
}
function writeAnchors(anchors: unknown[]) {
  writeLock(`${JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors }, null, 2)}\n`);
}
function removeLock() {
  fs.rmSync(lockPath, { force: true });
}

const STALE = () => anchorRecord(`sha256:${'a'.repeat(64)}`);

async function freshAnchor() {
  const report = (await checkAnchors([STALE()], { projectRoot: sandbox })) as {
    anchors: Array<{ actualFingerprint?: string }>;
  };
  const actual = report.anchors[0].actualFingerprint;
  if (typeof actual !== 'string') throw new Error('未能取得实际指纹');
  return anchorRecord(actual);
}

/** 经真实 CLI 入口跑 repo:check，返回解析后的 JSON 报告 */
function runRepoCheck(extraArgs: string[] = []): ValidationResult {
  const argv = ['scripts/repo-check.mjs', '--project-root', sandbox, '--json', ...extraArgs];
  try {
    return JSON.parse(execFileSync('node', argv, { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 120_000 }));
  } catch (error) {
    const execError = error as { stdout?: string };
    return JSON.parse(execError.stdout ?? '{}');
  }
}

const driftChecks = (result: ValidationResult) => result.checks.filter((c) => c.id.startsWith('spec-drift'));
const driftMessages = (list: string[]) => list.filter((m) => m.startsWith('[spec-drift]'));

beforeAll(() => {
  sandbox = buildSandbox();
  lockPath = path.join(sandbox, '.specify', 'spec-drift.lock.json');
}, 120_000);

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('US3：repo:check 两种模式的端到端行为（SC-004）', () => {
  it('前置：沙箱基线（无 lock）整体 pass —— 保证后续 status 断言不被沙箱噪声污染', () => {
    removeLock();
    const result = runRepoCheck();
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(result.status).toBe('pass');
  }, 120_000);

  it('AS1：存在非 fresh 锚 + lock 完好 + 默认模式 → 整体 warn，warnings 含具体锚信息', () => {
    writeAnchors([STALE()]);
    const result = runRepoCheck();

    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    const drift = driftChecks(result);
    expect(drift).toHaveLength(1);
    expect(drift[0].id).toBe('spec-drift:anchors-status');
    expect(drift[0].status).toBe('warn');
    const messages = driftMessages(result.warnings);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain('c2-applyDiscount');
    expect(messages.join('\n')).toContain('stale');
  }, 120_000);

  it('AS2：同场景 --strict → 整体 fail，锚信息进 errors', () => {
    writeAnchors([STALE()]);
    const result = runRepoCheck(['--strict']);

    expect(result.status).toBe('fail');
    const drift = driftChecks(result);
    expect(drift[0].status).toBe('fail');
    expect(driftMessages(result.warnings)).toEqual([]);
    const errors = driftMessages(result.errors);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain('c2-applyDiscount');
  }, 120_000);

  it('AS3：lock 损坏 → 默认与 --strict 均 fail（不受 strict 影响）', () => {
    writeLock('{ "schemaVersion": "1", "anchors": [ broken');

    for (const args of [[], ['--strict']]) {
      const result = runRepoCheck(args);
      expect(result.status, `args=${JSON.stringify(args)}`).toBe('fail');
      const drift = driftChecks(result);
      expect(drift[0].id).toBe('spec-drift:lock-integrity');
      expect(drift[0].status).toBe('fail');
      expect(driftMessages(result.errors).length).toBeGreaterThan(0);
    }
  }, 180_000);

  it('AS4：无锚 / 全 fresh → spec-drift 族贡献 pass，不产生噪声（两种模式一致）', async () => {
    const fresh = await freshAnchor();

    for (const anchors of [[], [fresh]]) {
      writeAnchors(anchors);
      for (const args of [[], ['--strict']]) {
        const result = runRepoCheck(args);
        const drift = driftChecks(result);
        expect(drift, `anchors=${anchors.length} args=${JSON.stringify(args)}`).toHaveLength(1);
        expect(drift[0].status).toBe('pass');
        expect(driftMessages(result.warnings)).toEqual([]);
        expect(driftMessages(result.errors)).toEqual([]);
        expect(result.status).toBe('pass');
      }
    }
  }, 300_000);

  it('AS5：防静默 no-op 回归防线（FR-008）—— 真实 await validateRepository 必须携带非空 warnings', async () => {
    // ⚠️ 本断言的守护点：若未来有人误删 repo-maintenance-core.mjs 里
    // `await validateSpecDrift(...)` 的 await，aggregateValidation 会拿到未展开的 Promise，
    // `result.warnings ?? []` 因 Promise 没有 warnings 属性而退化为空数组、checks 也为空，
    // 整体静默变 pass。因此这里 MUST NOT 只断言整体 status，而要断言
    // spec-drift 族确实出现在 checks 且其 warnings/errors 内容非空。
    writeAnchors([STALE()]);

    const loose = (await validateRepository(sandbox)) as ValidationResult;
    expect(loose.checks.some((c) => c.id.startsWith('spec-drift'))).toBe(true);
    expect(driftMessages(loose.warnings).length).toBeGreaterThan(0);

    const strict = (await validateRepository(sandbox, { strict: true })) as ValidationResult;
    expect(strict.checks.some((c) => c.id.startsWith('spec-drift'))).toBe(true);
    expect(driftMessages(strict.errors).length).toBeGreaterThan(0);
    expect(strict.status).toBe('fail');
  }, 180_000);
});
