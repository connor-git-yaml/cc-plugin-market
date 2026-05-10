/**
 * Feature 162 Phase B2 iter-2 (Codex C-5 + C-6 critical 修复) — 单元测试
 *
 * 验证两个修复点：
 *
 *   C-5: validateRecordsIntegrity 把 oracleFails 纳入 invalid 判定。
 *        当 15 条 record 全为 oracle 异常（method:'exception'）时必须返回 invalid，
 *        而不是因 glmFails/codexFails 都为 0 而错误地返回 valid。
 *
 *   C-6: fallback 路径 2-judge 一致同意制 (fail-closed)：
 *        - extractFallbackFailClosedPassSet 仅在 Opus + Kimi 双 pass 才计 pass
 *        - annotateFallbackConsensus 给 record.judges 加 disagreement / tieBreakResult
 *        - Opus pass + Kimi fail（或反之）→ fail-closed 不计 pass
 */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface JudgeSlotResult {
  judge: string;
  score: number | null;
  rationale?: string;
  rawResponse?: string;
  refusalDetected?: boolean;
  ok?: boolean;
}

interface JudgesMap {
  glm?: JudgeSlotResult;
  codex?: JudgeSlotResult;
  kimi?: JudgeSlotResult;
  opus?: JudgeSlotResult;
  disagreement?: boolean;
  tieBreakResult?: 'pass' | 'fail-closed' | 'n/a';
}

interface OracleResult {
  passed: boolean;
  confidence: number;
  method: string;
  similarity?: number;
}

interface CalibrationRecord {
  fixtureId: string;
  runId: number;
  startedAt?: string;
  finalizedAt?: string;
  expectedOutcome?: string;
  driverPatch?: string;
  driverTokens?: number;
  oracle: OracleResult;
  judges: JudgesMap;
  driverRefusalDetected?: boolean;
  error?: { phase: string; message: string } | null;
}

interface IntegrityResult {
  valid: boolean;
  reason?: string;
  glmFails: number;
  codexFails: number;
  oracleFails: number;
}

interface CalibrateModule {
  validateRecordsIntegrity: (
    records: CalibrationRecord[],
    opts: { expectGlm: boolean },
  ) => IntegrityResult;
  extractFallbackFailClosedPassSet: (records: CalibrationRecord[]) => Set<string>;
  annotateFallbackConsensus: (records: CalibrationRecord[]) => void;
  evaluateThresholds: (
    records: CalibrationRecord[],
    opts: { useFallbackJury: boolean },
  ) => {
    iouFallbackFailClosed: number | null;
    fallbackDisagreementCount: number | null;
    iouCodexOracle: number;
    iouRefusal: number;
    passed: boolean;
    failures: Record<string, boolean>;
  };
  JURY_PASS_THRESHOLD: number;
  EXPECTED_DATA_POINTS: number;
}

async function loadCalibrateModule(): Promise<CalibrateModule> {
  const url = pathToFileURL(resolve('scripts/calibrate-glm-judge.mjs')).href;
  return (await import(url)) as CalibrateModule;
}

/**
 * 构造 15 条 record，所有 record 共享同一 oracle 设置 + judge score 配置。
 * 用于快速测试 integrity / fallback 不同场景。
 */
function buildRecords(opts: {
  count?: number;
  oracle: Partial<OracleResult>;
  glmScore?: number | null;
  codexScore?: number | null;
  opusScore?: number | null;
  kimiScore?: number | null;
  hasError?: boolean;
}): CalibrationRecord[] {
  const records: CalibrationRecord[] = [];
  const total = opts.count ?? 15;
  for (let i = 0; i < total; i += 1) {
    const fixtureId = `SWE-L00${(i % 5) + 1}`;
    const runId = Math.floor(i / 5) + 1;
    const judges: JudgesMap = {};
    if (opts.glmScore !== undefined) {
      judges.glm = { judge: 'siliconflow:Pro/zai-org/GLM-5.1', score: opts.glmScore, ok: true };
    }
    if (opts.codexScore !== undefined) {
      judges.codex = { judge: 'codex:gpt-5.5', score: opts.codexScore, ok: true };
    }
    if (opts.opusScore !== undefined) {
      judges.opus = { judge: 'claude-cli:claude-opus-4-7', score: opts.opusScore, ok: true };
    }
    if (opts.kimiScore !== undefined) {
      judges.kimi = {
        judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6',
        score: opts.kimiScore,
        ok: true,
      };
    }
    records.push({
      fixtureId,
      runId,
      oracle: {
        passed: opts.oracle.passed ?? false,
        confidence: opts.oracle.confidence ?? 1.0,
        method: opts.oracle.method ?? 'token-jaccard',
      },
      judges,
      error: opts.hasError ? { phase: 'unknown', message: 'mock failure' } : null,
    });
  }
  return records;
}

describe('Feature 162 iter-2 C-5: validateRecordsIntegrity oracleFails 纳入 invalid', () => {
  it('15 条 record 全为 oracle 异常（method:"exception"）时返回 invalid', async () => {
    const mod = await loadCalibrateModule();
    // 构造：15 条 record，judges 完整（GLM/Codex 都有 score），但 oracle 全为 exception
    const records = buildRecords({
      oracle: { passed: false, confidence: 0, method: 'exception' },
      glmScore: 5,
      codexScore: 6,
    });
    const integrity = mod.validateRecordsIntegrity(records, { expectGlm: true });
    expect(integrity.valid).toBe(false);
    expect(integrity.oracleFails).toBe(15);
    expect(integrity.glmFails).toBe(0);
    expect(integrity.codexFails).toBe(0);
    expect(integrity.reason).toContain('oracle 异常');
    expect(integrity.reason).toContain('15');
  });

  it('15 条 record 全为 oracle confidence=0（degraded-goldpatch-missing）时返回 invalid', async () => {
    const mod = await loadCalibrateModule();
    const records = buildRecords({
      oracle: { passed: false, confidence: 0, method: 'degraded-goldpatch-missing' },
      glmScore: 5,
      codexScore: 6,
    });
    const integrity = mod.validateRecordsIntegrity(records, { expectGlm: true });
    expect(integrity.valid).toBe(false);
    expect(integrity.oracleFails).toBe(15);
  });

  it('全部 valid（oracle 正常 + judge 完整）时返回 valid', async () => {
    const mod = await loadCalibrateModule();
    const records = buildRecords({
      oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
      glmScore: 7,
      codexScore: 7,
    });
    const integrity = mod.validateRecordsIntegrity(records, { expectGlm: true });
    expect(integrity.valid).toBe(true);
    expect(integrity.oracleFails).toBe(0);
  });

  it('records.length !== 15 也返回 invalid（向后兼容）', async () => {
    const mod = await loadCalibrateModule();
    const records = buildRecords({
      count: 10,
      oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
      glmScore: 7,
      codexScore: 7,
    });
    const integrity = mod.validateRecordsIntegrity(records, { expectGlm: true });
    expect(integrity.valid).toBe(false);
    expect(integrity.reason).toContain('10');
    expect(integrity.reason).toContain('15');
  });
});

describe('Feature 162 iter-2 C-6: fallback 2-judge fail-closed 一致同意制', () => {
  it('Opus pass + Kimi fail → fail-closed（不计 pass）', async () => {
    const mod = await loadCalibrateModule();
    const records: CalibrationRecord[] = [
      {
        fixtureId: 'SWE-L001',
        runId: 1,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 7, ok: true }, // pass
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 3, ok: true }, // fail
        },
        error: null,
      },
    ];
    const passSet = mod.extractFallbackFailClosedPassSet(records);
    expect(passSet.size).toBe(0); // fail-closed：分歧时不计 pass

    mod.annotateFallbackConsensus(records);
    expect(records[0].judges.disagreement).toBe(true);
    expect(records[0].judges.tieBreakResult).toBe('fail-closed');
  });

  it('Opus fail + Kimi pass → fail-closed', async () => {
    const mod = await loadCalibrateModule();
    const records: CalibrationRecord[] = [
      {
        fixtureId: 'SWE-L001',
        runId: 1,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 3, ok: true }, // fail
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 8, ok: true }, // pass
        },
        error: null,
      },
    ];
    const passSet = mod.extractFallbackFailClosedPassSet(records);
    expect(passSet.size).toBe(0);

    mod.annotateFallbackConsensus(records);
    expect(records[0].judges.disagreement).toBe(true);
    expect(records[0].judges.tieBreakResult).toBe('fail-closed');
  });

  it('Opus pass + Kimi pass → 计入 pass set', async () => {
    const mod = await loadCalibrateModule();
    const records: CalibrationRecord[] = [
      {
        fixtureId: 'SWE-L001',
        runId: 1,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 7, ok: true },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 6, ok: true },
        },
        error: null,
      },
    ];
    const passSet = mod.extractFallbackFailClosedPassSet(records);
    expect(passSet.size).toBe(1);
    expect(passSet.has('SWE-L001|1')).toBe(true);

    mod.annotateFallbackConsensus(records);
    expect(records[0].judges.disagreement).toBe(false);
    expect(records[0].judges.tieBreakResult).toBe('pass');
  });

  it('Opus fail + Kimi fail → 不计 pass，无分歧', async () => {
    const mod = await loadCalibrateModule();
    const records: CalibrationRecord[] = [
      {
        fixtureId: 'SWE-L001',
        runId: 1,
        oracle: { passed: false, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 2, ok: true },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 4, ok: true },
        },
        error: null,
      },
    ];
    const passSet = mod.extractFallbackFailClosedPassSet(records);
    expect(passSet.size).toBe(0);

    mod.annotateFallbackConsensus(records);
    expect(records[0].judges.disagreement).toBe(false);
    expect(records[0].judges.tieBreakResult).toBe('fail-closed');
  });

  it('Opus 缺失 score → fail-closed（不计 pass）', async () => {
    const mod = await loadCalibrateModule();
    const records: CalibrationRecord[] = [
      {
        fixtureId: 'SWE-L001',
        runId: 1,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: null, ok: false },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 8, ok: true },
        },
        error: null,
      },
    ];
    const passSet = mod.extractFallbackFailClosedPassSet(records);
    expect(passSet.size).toBe(0);

    mod.annotateFallbackConsensus(records);
    expect(records[0].judges.tieBreakResult).toBe('fail-closed');
  });

  it('evaluateThresholds fallback 路径返回 iouFallbackFailClosed + disagreementCount', async () => {
    const mod = await loadCalibrateModule();
    // 构造 15 条：10 条双 pass（oracle pass），3 条双 fail（oracle fail），2 条分歧（oracle 任意）
    const records: CalibrationRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      records.push({
        fixtureId: `SWE-L00${(i % 5) + 1}`,
        runId: Math.floor(i / 5) + 1,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 8, ok: true },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 7, ok: true },
          codex: { judge: 'codex:gpt-5.5', score: 7, ok: true },
        },
        error: null,
      });
    }
    for (let i = 0; i < 3; i += 1) {
      records.push({
        fixtureId: `SWE-L00${i + 1}`,
        runId: 3,
        oracle: { passed: false, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 2, ok: true },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 3, ok: true },
          codex: { judge: 'codex:gpt-5.5', score: 3, ok: true },
        },
        error: null,
      });
    }
    // 2 条分歧（fail-closed：不计 pass，但 oracle 是 pass，会减损 IoU）
    for (let i = 0; i < 2; i += 1) {
      records.push({
        fixtureId: `SWE-L00${i + 4}`,
        runId: 3,
        oracle: { passed: true, confidence: 1.0, method: 'token-jaccard' },
        judges: {
          opus: { judge: 'claude-cli:claude-opus-4-7', score: 8, ok: true },
          kimi: { judge: 'siliconflow:Pro/moonshotai/Kimi-K2.6', score: 3, ok: true },
          codex: { judge: 'codex:gpt-5.5', score: 7, ok: true },
        },
        error: null,
      });
    }
    expect(records.length).toBe(15);
    mod.annotateFallbackConsensus(records);
    const evalRes = mod.evaluateThresholds(records, { useFallbackJury: true });
    expect(evalRes.iouFallbackFailClosed).not.toBeNull();
    expect(evalRes.fallbackDisagreementCount).toBe(2);
    // 10 条一致 pass + 2 条分歧（fail-closed 不计） + 3 条一致 fail
    // pass set = 10 oracle set = 12 → IoU = 10/12 ≈ 0.833
    expect(evalRes.iouFallbackFailClosed).toBeGreaterThan(0.7);
    expect(evalRes.iouFallbackFailClosed).toBeLessThan(1.0);
  });
});
