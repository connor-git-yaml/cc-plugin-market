/**
 * T022（C2）：`validateSpecDrift` 三段式契约单测（FR-006 / FR-007 / FR-008）。
 *
 * 覆盖面：
 * - `strict` 透传：false → warning，true → error；子 check 的 `status` 随 strict 变化（W-3）
 * - `fresh` 不受 strict 影响：全 fresh 时 `--strict` 仍 pass（FR-007，strict 不是"有锚就 fail"）
 * - `lock-corrupt` 恒 fail，不受 strict 影响（FR-007）
 * - report 级状态（graph-unavailable）先于 anchor 级处理（C-5），不得被静默吞成 pass
 * - evidence 为真实非空对象（FR-008(b)）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateSpecDrift } from '../../scripts/lib/spec-drift-core.mjs';
import { FINGERPRINT_VERSION, NORMALIZATION_PROFILE } from '../../scripts/lib/spec-drift-fingerprint.mjs';
import { LOCK_SCHEMA_VERSION } from '../../scripts/lib/spec-drift-lock-io.mjs';

interface Check {
  id: string;
  title: string;
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

let sandbox: string;

/** 构造一条 lock 锚记录（十项必需字段齐全，FR-003） */
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

function writeLock(anchors: unknown[]) {
  const lockPath = path.join(sandbox, '.specify', 'spec-drift.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors }, null, 2)}\n`);
  return lockPath;
}

/** 先跑一次 check 取得真实指纹，再写回 lock，得到"全 fresh"状态 */
async function writeFreshLock() {
  writeLock([anchorRecord(`sha256:${'0'.repeat(64)}`)]);
  const { checkAnchors } = await import('../../scripts/lib/spec-drift-check.mjs');
  const report = (await checkAnchors([anchorRecord(`sha256:${'0'.repeat(64)}`)], {
    projectRoot: sandbox,
  })) as { anchors: Array<{ actualFingerprint?: string; expectedFingerprint?: string; observed?: string }> };
  const observed =
    report.anchors[0].actualFingerprint ?? report.anchors[0].observed ?? report.anchors[0].expectedFingerprint;
  if (typeof observed !== 'string') {
    throw new Error(`无法从 check 报告取得实际指纹：${JSON.stringify(report.anchors[0])}`);
  }
  writeLock([anchorRecord(observed)]);
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-validate-'));
  fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE, 'src/target.ts'), path.join(sandbox, 'src/target.ts'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('validateSpecDrift 三段式契约（FR-006/007/008）', () => {
  it('lock 文件不存在 → pass，anchorCount 0，无 warning/error 噪声', async () => {
    const result = (await validateSpecDrift({ projectRoot: sandbox })) as ValidationResult;
    expect(result.status).toBe('pass');
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].status).toBe('pass');
    expect(result.checks[0].evidence.anchorCount).toBe(0);
  });

  it('lock 存在但 anchors 为空 → pass', async () => {
    writeLock([]);
    const result = (await validateSpecDrift({ projectRoot: sandbox })) as ValidationResult;
    expect(result.status).toBe('pass');
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // 显式放宽 timeout：writeFreshLock() 会真实 await import('dist/core/ast-analyzer.js') 并跑 AST 分析，
  // 在 `npm run build` 之后的首跑属于冷文件缓存，实测可超过默认 5s（缓存转热后仅 ~700ms）。
  // 这是 dist 冷导入的 I/O 成本，不是逻辑变慢，故只放宽时间上限、不改任何断言。
  it('全部锚 fresh → 默认 pass，且 --strict 仍 pass（FR-007：strict 不是"有锚就 fail"）', async () => {
    await writeFreshLock();

    const loose = (await validateSpecDrift({ projectRoot: sandbox, strict: false })) as ValidationResult;
    expect(loose.status).toBe('pass');
    expect(loose.warnings).toEqual([]);
    expect(loose.errors).toEqual([]);

    const strict = (await validateSpecDrift({ projectRoot: sandbox, strict: true })) as ValidationResult;
    expect(strict.status).toBe('pass');
    expect(strict.warnings).toEqual([]);
    expect(strict.errors).toEqual([]);
    expect(strict.checks.every((c) => c.status === 'pass')).toBe(true);
  }, 30000);

  it('存在 stale 锚 + 默认模式 → warn，warnings 非空且含锚 id', async () => {
    writeLock([anchorRecord(`sha256:${'a'.repeat(64)}`)]);
    const result = (await validateSpecDrift({ projectRoot: sandbox, strict: false })) as ValidationResult;

    expect(result.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join('\n')).toContain('c2-applyDiscount');
    // W-3：子 check 的 status 必须随 strict 变化，默认模式下是 warn（不是硬编码，也不是 fail）
    expect(result.checks[0].status).toBe('warn');
  });

  it('存在 stale 锚 + --strict → fail，错误进 errors 而非 warnings（严重度提升单一规则）', async () => {
    writeLock([anchorRecord(`sha256:${'a'.repeat(64)}`)]);
    const result = (await validateSpecDrift({ projectRoot: sandbox, strict: true })) as ValidationResult;

    expect(result.status).toBe('fail');
    expect(result.warnings).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join('\n')).toContain('c2-applyDiscount');
    // W-3：strict 下子 check 必须是 fail，否则外部消费 checks[] 会看到"子检查 warn 但整体 fail"的自相矛盾
    expect(result.checks[0].status).toBe('fail');
  });

  it('非 fresh 分支的 evidence 是真实非空对象（FR-008(b)：非 Promise 残影）', async () => {
    writeLock([anchorRecord(`sha256:${'a'.repeat(64)}`)]);
    const result = (await validateSpecDrift({ projectRoot: sandbox })) as ValidationResult;
    const evidence = result.checks[0].evidence;

    expect(evidence).toBeTypeOf('object');
    expect(evidence).not.toBeInstanceOf(Promise);
    expect(Object.keys(evidence).length).toBeGreaterThan(0);
    expect(evidence.anchorCount).toBe(1);
    expect(evidence.nonFreshCount).toBe(1);
    expect(evidence.summary).toBeTypeOf('object');
    expect(typeof evidence.exitCode).toBe('number');
  });

  it('lock 损坏 → 默认与 --strict 均 fail（FR-007：不受 strict 影响）', async () => {
    const lockPath = path.join(sandbox, '.specify', 'spec-drift.lock.json');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '{ this is not json');

    for (const strict of [false, true]) {
      const result = (await validateSpecDrift({ projectRoot: sandbox, strict })) as ValidationResult;
      expect(result.status, `strict=${strict}`).toBe('fail');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.checks[0].id).toBe('lock-integrity');
      expect(result.checks[0].status).toBe('fail');
    }
  });

  it('report 级 graph-unavailable 先于 anchor 级处理，MUST NOT 静默退化成 pass（C-5）', async () => {
    writeLock([anchorRecord(`sha256:${'a'.repeat(64)}`)]);
    // distRoot 指向一个没有 dist/ 的空目录 → loadDistApis 失败 → report 级 graph-unavailable
    const emptyDist = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-nodist-'));
    try {
      const loose = (await validateSpecDrift({
        projectRoot: sandbox,
        distRoot: emptyDist,
        strict: false,
      })) as ValidationResult;
      expect(loose.status).toBe('warn');
      expect(loose.warnings.length).toBeGreaterThan(0);
      expect(loose.checks[0].evidence.degraded).toBe(true);
      expect(loose.checks[0].evidence.machineCode).toBe('DRIFT_GRAPH_UNAVAILABLE');
      // MUST NOT 伪造进 anchor：report 级状态记录在专属 check 上
      expect(loose.checks[0].id).toBe('analysis-environment');

      const strict = (await validateSpecDrift({
        projectRoot: sandbox,
        distRoot: emptyDist,
        strict: true,
      })) as ValidationResult;
      expect(strict.status).toBe('fail');
      expect(strict.errors.length).toBeGreaterThan(0);
      expect(strict.warnings).toEqual([]);
      expect(strict.checks[0].status).toBe('fail');
    } finally {
      fs.rmSync(emptyDist, { recursive: true, force: true });
    }
  });
});
