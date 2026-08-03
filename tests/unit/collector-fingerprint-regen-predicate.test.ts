/**
 * F249 T042：再生脚本二元拒绝判据 + 诊断文案分流的单测（SC-010(b) 判据部分）。
 *
 * 为什么真值表要逐格穷举而不是只测"典型场景"：这条判据只有 4 个输入组合，任何一格写反都是
 * 一条可被利用的绕过路径（写反 `!fingerprintUnchanged` 那格 ⇒ bump 了反而拒绝；写反
 * `!contentMismatch` 那格 ⇒ 内容一致也拒绝，护栏变成永久噪声）。4 格全钉死的成本极低。
 *
 * 诊断分流单独测、不并入真值表：`fixtureInputHash` 是纯诊断字段，**不参与**判定
 * （plan R2 否决了把它接进判据的三元方案）。把它和真值表混在一起测，会在读者心里重建
 * "它也是判据的一部分"这一已被否决的印象。
 */
import { describe, expect, it } from 'vitest';
import { shouldRejectRegen } from '../../scripts/lib/collector-fingerprint-regen-predicate.mjs';
import { selectRegenDiagnostic } from '../../scripts/regen-collector-fingerprint-fixtures.js';

describe('shouldRejectRegen — 二元判据 2×2 真值表（FR-005(e)）', () => {
  const truthTable: ReadonlyArray<{
    contentMismatch: boolean;
    fingerprintUnchanged: boolean;
    expected: boolean;
    rationale: string;
  }> = [
    {
      contentMismatch: true,
      fingerprintUnchanged: true,
      expected: true,
      rationale: '重建内容变了但指纹没变 → 指纹不可见的行为漂移，MUST 拒绝',
    },
    {
      contentMismatch: false,
      fingerprintUnchanged: true,
      expected: false,
      rationale: '内容一致 → 本次再生是 no-op，放行',
    },
    {
      contentMismatch: true,
      fingerprintUnchanged: false,
      expected: false,
      rationale: '指纹已变 → 行为变更已被显式声明，放行',
    },
    {
      contentMismatch: false,
      fingerprintUnchanged: false,
      expected: false,
      rationale: '内容一致且指纹已变（如仅扩展面变化未触及本 fixture 样本）→ 放行',
    },
  ];

  for (const row of truthTable) {
    it(`contentMismatch=${row.contentMismatch} ∧ fingerprintUnchanged=${row.fingerprintUnchanged} → ${row.expected}（${row.rationale}）`, () => {
      expect(
        shouldRejectRegen({
          contentMismatch: row.contentMismatch,
          fingerprintUnchanged: row.fingerprintUnchanged,
        }),
      ).toBe(row.expected);
    });
  }

  it('真值表恰好覆盖 2×2=4 个组合，无重复无遗漏', () => {
    const combinations = new Set(
      truthTable.map((row) => `${row.contentMismatch}|${row.fingerprintUnchanged}`),
    );
    expect(combinations.size).toBe(4);
  });

  it('唯一的拒绝格是「内容不一致 ∧ 指纹未变」——其余三格必须放行', () => {
    const rejecting = truthTable.filter((row) => row.expected);
    expect(rejecting).toHaveLength(1);
    expect(rejecting[0]?.contentMismatch).toBe(true);
    expect(rejecting[0]?.fingerprintUnchanged).toBe(true);
  });
});

describe('selectRegenDiagnostic — fixtureInputHash 诊断文案分流（不参与判定）', () => {
  it('inputHashUnchanged（fixture 未变）→ producer 行为漂移文案', () => {
    const message = selectRegenDiagnostic(false);
    expect(message).toContain('指纹不可见的行为变更');
    expect(message).toContain('bump behaviorVersion');
    // 错配防线：未命中的另一类文案的特征词不得出现
    expect(message).not.toContain('fixture 基线变更');
  });

  it('inputHashChanged（fixture 已变）→ 基线变更未声明文案', () => {
    const message = selectRegenDiagnostic(true);
    expect(message).toContain('fixture 基线变更');
    expect(message).toContain('bump behaviorVersion');
    expect(message).not.toContain('指纹不可见的行为变更');
  });

  it('两条文案彼此不同，且都给出同一个动作（bump behaviorVersion）', () => {
    expect(selectRegenDiagnostic(true)).not.toBe(selectRegenDiagnostic(false));
    for (const changed of [true, false]) {
      expect(selectRegenDiagnostic(changed)).toContain('bump behaviorVersion');
    }
  });
});
