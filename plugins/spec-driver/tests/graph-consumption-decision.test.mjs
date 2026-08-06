/**
 * graph-consumption-decision.test.mjs
 * Feature 241 — B4 图消费决策纯函数（FR-001/002/003/004/004b/006，SC-001/004/005/006）
 *
 * 本文件的断言分七组：
 *   (a) 144 组合穷举（3×3×4×2×2）—— 防御性覆盖，每组都必须有确定 outcome + matchedRule
 *   (b) 两条顺序不变量探针（missing / out-of-scope）—— 矩阵行序是安全性依赖，不是风格选择
 *   (c) 6 类 unreachable-by-construction 组合的注释存在性（源码 grep）
 *   (d) 刷新成功后的收口规则 + 「矩阵未被二次求值」的求值计数探针
 *   (e) 五维严格性：缺字段 / 未知字面量 / 第六字段被忽略
 *   (f) DEGRADED_REASONS(12) / CAVEAT_CODES(1) 封闭性与交集为空
 *   (g) annotateImpactCaveat 三条对照
 *   (h) 纯函数静态约束：模块内无 child_process / fs import
 *   (i) SC-006：刷新失败的出口改写（刷新前 present → consume-degraded；missing/corrupt → unavailable）
 *
 * 运行方式: node --test plugins/spec-driver/tests/graph-consumption-decision.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decideGraphConsumption,
  finalizeAfterRefresh,
  annotateImpactCaveat,
  DEGRADED_REASONS,
  CAVEAT_CODES,
  GRAPH_SCOPE_SURFACES,
  surfaceMatchesFileMjs,
} from '../scripts/lib/graph-consumption-decision.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.join(__dirname, '..', 'scripts', 'lib', 'graph-consumption-decision.mjs');
const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, 'utf-8');

const CHANGE_CLASSES = ['modifies-existing', 'additive-only', 'unknown'];
const AVAILABILITIES = ['present', 'missing', 'corrupt'];
const FRESHNESS_STATES = ['fresh', 'dirty', 'stale', 'unknown-provenance'];
const COVERAGE_SCOPES = ['in-graph-scope', 'out-of-graph-scope'];
const REFRESH_POLICIES = ['allowed', 'declined'];

const OUTCOMES = new Set([
  'consume-impact',
  'refresh-then-consume',
  'consume-degraded',
  'skip-impact',
  'unavailable',
]);

/**
 * 与 FR-003 v2 表格逐行对齐的独立参照实现（oracle）。
 *
 * 刻意写成顺序 if 链而不是复用被测模块的任何内部结构——这样"实现改了顺序"会被立刻抓到，
 * 而不是两边一起漂移。
 */
function expectedFor({ changeClass, graphAvailability, freshness, coverageScope, refreshPolicy }) {
  if (changeClass === 'additive-only')
    return { matchedRule: 1, outcome: 'skip-impact', degradedReason: 'impact-not-applicable-additive-only' };
  if (coverageScope === 'out-of-graph-scope')
    return { matchedRule: 2, outcome: 'consume-degraded', degradedReason: 'coverage-gap-out-of-graph-scope' };
  if (graphAvailability === 'corrupt' && refreshPolicy === 'allowed')
    return { matchedRule: 3, outcome: 'refresh-then-consume', degradedReason: null };
  if (graphAvailability === 'corrupt' && refreshPolicy === 'declined')
    return { matchedRule: 4, outcome: 'unavailable', degradedReason: 'graph-corrupt' };
  if (graphAvailability === 'missing' && refreshPolicy === 'allowed')
    return { matchedRule: 5, outcome: 'refresh-then-consume', degradedReason: null };
  if (graphAvailability === 'missing' && refreshPolicy === 'declined')
    return { matchedRule: 6, outcome: 'unavailable', degradedReason: 'graph-missing' };
  if (changeClass === 'unknown')
    return { matchedRule: 7, outcome: 'consume-degraded', degradedReason: 'classification-unknown' };
  if (freshness === 'stale' && refreshPolicy === 'allowed')
    return { matchedRule: 8, outcome: 'refresh-then-consume', degradedReason: null };
  if (freshness === 'stale' && refreshPolicy === 'declined')
    return { matchedRule: 9, outcome: 'consume-degraded', degradedReason: 'graph-stale-refresh-declined' };
  if (freshness === 'dirty' && refreshPolicy === 'allowed')
    return { matchedRule: 10, outcome: 'refresh-then-consume', degradedReason: null };
  if (freshness === 'dirty' && refreshPolicy === 'declined')
    return { matchedRule: 11, outcome: 'consume-degraded', degradedReason: 'graph-dirty-uncommitted' };
  if (freshness === 'unknown-provenance')
    return { matchedRule: 12, outcome: 'consume-degraded', degradedReason: 'graph-unknown-provenance' };
  return { matchedRule: 13, outcome: 'consume-impact', degradedReason: null };
}

function allCombinations() {
  const combos = [];
  for (const changeClass of CHANGE_CLASSES)
    for (const graphAvailability of AVAILABILITIES)
      for (const freshness of FRESHNESS_STATES)
        for (const coverageScope of COVERAGE_SCOPES)
          for (const refreshPolicy of REFRESH_POLICIES)
            combos.push({ changeClass, graphAvailability, freshness, coverageScope, refreshPolicy });
  return combos;
}

const VALID_INPUT = Object.freeze({
  changeClass: 'modifies-existing',
  graphAvailability: 'present',
  freshness: 'fresh',
  coverageScope: 'in-graph-scope',
  refreshPolicy: 'allowed',
});

describe('FR-003 (a) 决策矩阵 v2 —— 144 组合穷举', () => {
  it('每种组合都返回上表规定的 outcome/degradedReason/matchedRule，无 undefined、不 throw', () => {
    const combos = allCombinations();
    assert.equal(combos.length, 144, '组合总数必须是 3×3×4×2×2');

    for (const input of combos) {
      const label = JSON.stringify(input);
      let decision;
      assert.doesNotThrow(() => {
        decision = decideGraphConsumption(input);
      }, `组合 ${label} 不得抛异常`);

      const expected = expectedFor(input);
      assert.equal(decision.outcome, expected.outcome, `outcome 不符：${label}`);
      assert.equal(decision.matchedRule, expected.matchedRule, `matchedRule 不符：${label}`);
      assert.equal(decision.degradedReason, expected.degradedReason, `degradedReason 不符：${label}`);

      assert.ok(OUTCOMES.has(decision.outcome), `outcome 越界：${label}`);
      assert.deepEqual(decision.caveats, [], `decide 阶段 caveats 必须恒空：${label}`);
      assert.ok(
        decision.fallbackHint === null || typeof decision.fallbackHint === 'string',
        `fallbackHint 类型非法：${label}`,
      );
      for (const key of ['outcome', 'degradedReason', 'caveats', 'fallbackHint', 'matchedRule']) {
        assert.notEqual(decision[key], undefined, `${key} 为 undefined：${label}`);
      }
    }
  });

  it('出口集合恰为 5 个值（invalid-input 单列，不出现在合法五维输入的结果里）', () => {
    const seen = new Set(allCombinations().map((input) => decideGraphConsumption(input).outcome));
    for (const outcome of seen) assert.ok(OUTCOMES.has(outcome), `越界出口 ${outcome}`);
    assert.equal(seen.has('invalid-input'), false);
  });

  it('非消费出口带 fallbackHint；consume-impact 无需 hint', () => {
    const skip = decideGraphConsumption({ ...VALID_INPUT, changeClass: 'additive-only' });
    assert.equal(skip.outcome, 'skip-impact');
    assert.match(skip.fallbackHint, /context|graph_query|Grep/);

    const outOfScope = decideGraphConsumption({ ...VALID_INPUT, coverageScope: 'out-of-graph-scope' });
    assert.match(outOfScope.fallbackHint, /Grep|Read/);

    assert.equal(decideGraphConsumption(VALID_INPUT).fallbackHint, null);
  });
});

describe('FR-003 (b) 两条顺序不变量探针', () => {
  it('missing 探针：graphAvailability=missing 即便 freshness=fresh 也必须落行 5/6，而不是行 13', () => {
    for (const refreshPolicy of REFRESH_POLICIES) {
      const decision = decideGraphConsumption({
        changeClass: 'modifies-existing',
        graphAvailability: 'missing',
        freshness: 'fresh', // 人为构造：真实世界 unreachable，此处专测求值顺序
        coverageScope: 'in-graph-scope',
        refreshPolicy,
      });
      assert.ok(
        [5, 6].includes(decision.matchedRule),
        `availability 判定必须早于 freshness 判定，实得 matchedRule=${decision.matchedRule}`,
      );
      assert.notEqual(decision.outcome, 'consume-impact');
    }
  });

  it('out-of-scope 探针：out-of-graph-scope + stale + allowed 落行 2，且不触发刷新', () => {
    const decision = decideGraphConsumption({
      changeClass: 'modifies-existing',
      graphAvailability: 'present',
      freshness: 'stale',
      coverageScope: 'out-of-graph-scope',
      refreshPolicy: 'allowed',
    });
    assert.equal(decision.matchedRule, 2);
    assert.equal(decision.outcome, 'consume-degraded');
    assert.equal(decision.degradedReason, DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE);
    // 范围外的目标重建也进不了图 —— 不得为它付一次 4.4s 重建 + 一次图覆写风险
    assert.notEqual(decision.outcome, 'refresh-then-consume');
  });

  it('out-of-scope 优先于 availability：missing/corrupt + out-of-scope 一律行 2', () => {
    for (const graphAvailability of ['missing', 'corrupt']) {
      const decision = decideGraphConsumption({
        ...VALID_INPUT,
        graphAvailability,
        coverageScope: 'out-of-graph-scope',
      });
      assert.equal(decision.matchedRule, 2, `${graphAvailability} + out-of-scope 应落行 2`);
    }
  });

  it('classification-unknown 位于 availability 之后：unknown + missing + allowed 落行 5（EC-01）', () => {
    const decision = decideGraphConsumption({
      changeClass: 'unknown',
      graphAvailability: 'missing',
      freshness: 'unknown-provenance',
      coverageScope: 'in-graph-scope',
      refreshPolicy: 'allowed',
    });
    assert.equal(decision.matchedRule, 5);
    assert.equal(decision.outcome, 'refresh-then-consume');
  });
});

describe('FR-003 (c) 6 类 unreachable 组合必须在源码里显式登记', () => {
  it('源码含 6 条 unreachable-by-construction 注释，逐一点名 availability × freshness 组合', () => {
    const markers = MODULE_SOURCE.match(/unreachable-by-construction/g) ?? [];
    assert.equal(markers.length, 6, `应有 6 条 unreachable 注释，实得 ${markers.length}`);

    for (const availability of ['missing', 'corrupt']) {
      for (const freshness of ['fresh', 'dirty', 'stale']) {
        const pattern = new RegExp(
          `unreachable-by-construction[^\\n]*${availability}[^\\n]*${freshness}`,
        );
        assert.match(MODULE_SOURCE, pattern, `缺 ${availability} × ${freshness} 的不可达登记`);
      }
    }
  });
});

describe('FR-003 (d) / FR-007 刷新后收口规则（矩阵不得二次求值）', () => {
  /**
   * 求值计数探针：收口规则**只应**读 changeClass（与刷新前的 graphAvailability）。
   * 若实现偷偷重跑了矩阵，必然会去读 freshness / coverageScope / refreshPolicy——
   * 用 Proxy 记录属性读取即可证伪，无需在生产模块里埋测试专用计数器。
   */
  function probeInput(base) {
    const reads = [];
    const proxy = new Proxy({ ...base }, {
      get(target, prop) {
        if (typeof prop === 'string') reads.push(prop);
        return target[prop];
      },
    });
    return { proxy, reads };
  }

  it('刷新成功 + changeClass=modifies-existing → consume-impact', () => {
    const input = { ...VALID_INPUT, freshness: 'stale' };
    const decision = decideGraphConsumption(input);
    assert.equal(decision.outcome, 'refresh-then-consume');

    const final = finalizeAfterRefresh({ decision, input, refresh: { ok: true } });
    assert.equal(final.outcome, 'consume-impact');
    assert.equal(final.degradedReason, null);
    assert.equal(final.matchedRule, decision.matchedRule, 'matchedRule 保留触发刷新的那一行，便于排障');
  });

  it('刷新成功 + changeClass=unknown → consume-degraded/classification-unknown', () => {
    // 注意入口只能是行 3/5：矩阵里行 7（classification-unknown）排在 freshness 判定之前，
    // 因此 `unknown × stale × allowed` 根本走不到行 8，唯一能带着 unknown 进入刷新的是
    // availability 触发的 corrupt/missing × allowed（EC-01 那条路径）。
    const input = { ...VALID_INPUT, changeClass: 'unknown', graphAvailability: 'missing' };
    const decision = decideGraphConsumption(input);
    assert.equal(decision.matchedRule, 5);
    assert.equal(decision.outcome, 'refresh-then-consume', 'unknown + missing + allowed 应先走刷新');

    const final = finalizeAfterRefresh({ decision, input, refresh: { ok: true } });
    assert.equal(final.outcome, 'consume-degraded');
    assert.equal(final.degradedReason, DEGRADED_REASONS.CLASSIFICATION_UNKNOWN);
  });

  it('求值计数探针：收口时不读 freshness / coverageScope / refreshPolicy（EC-07 无限刷新防线）', () => {
    const base = { ...VALID_INPUT, freshness: 'dirty' };
    const decision = decideGraphConsumption(base);
    assert.equal(decision.outcome, 'refresh-then-consume');

    const { proxy, reads } = probeInput(base);
    finalizeAfterRefresh({ decision, input: proxy, refresh: { ok: true } });

    for (const forbidden of ['freshness', 'coverageScope', 'refreshPolicy']) {
      assert.equal(
        reads.includes(forbidden),
        false,
        `收口阶段读取了 ${forbidden} —— 说明矩阵被二次求值（脏工作树重建后仍 dirty，会无限刷新）`,
      );
    }
  });

  it('非刷新出口调用 finalizeAfterRefresh 原样返回（幂等，不误改写）', () => {
    const input = { ...VALID_INPUT, changeClass: 'additive-only' };
    const decision = decideGraphConsumption(input);
    const final = finalizeAfterRefresh({ decision, input, refresh: { ok: true } });
    assert.deepEqual(final, decision);
  });
});

describe('FR-007 / SC-006 (i) 刷新失败的出口改写', () => {
  const FAILURE_REASONS = [
    DEGRADED_REASONS.REFRESH_FAILED_SPECTRA_MISSING,
    DEGRADED_REASONS.REFRESH_FAILED_TIMEOUT,
    DEGRADED_REASONS.REFRESH_FAILED_NONZERO_EXIT,
    DEGRADED_REASONS.REFRESH_FAILED_ARTIFACT_UNUSABLE,
  ];

  it('刷新前 graphAvailability=present → consume-degraded，reason 原样透传四值', () => {
    const input = { ...VALID_INPUT, freshness: 'stale' };
    const decision = decideGraphConsumption(input);
    for (const degradedReason of FAILURE_REASONS) {
      const final = finalizeAfterRefresh({ decision, input, refresh: { ok: false, degradedReason } });
      assert.equal(final.outcome, 'consume-degraded', `reason=${degradedReason}`);
      assert.equal(final.degradedReason, degradedReason);
    }
  });

  it('刷新前 graphAvailability=missing / corrupt → unavailable', () => {
    for (const graphAvailability of ['missing', 'corrupt']) {
      const input = { ...VALID_INPUT, graphAvailability, freshness: 'unknown-provenance' };
      const decision = decideGraphConsumption(input);
      assert.equal(decision.outcome, 'refresh-then-consume');

      for (const degradedReason of FAILURE_REASONS) {
        const final = finalizeAfterRefresh({ decision, input, refresh: { ok: false, degradedReason } });
        assert.equal(final.outcome, 'unavailable', `${graphAvailability} / ${degradedReason}`);
        assert.equal(final.degradedReason, degradedReason);
      }
    }
  });
});

describe('FR-002 (e) 五维严格性', () => {
  it('缺任一字段 → invalid-input（5 条用例，不得用默认值静默补齐）', () => {
    for (const missingField of Object.keys(VALID_INPUT)) {
      const input = { ...VALID_INPUT };
      delete input[missingField];
      const decision = decideGraphConsumption(input);
      assert.equal(decision.outcome, 'invalid-input', `缺 ${missingField} 应 fail-loud`);
      assert.equal(decision.degradedReason, null);
      assert.deepEqual(decision.caveats, []);
      assert.equal(decision.matchedRule, 0);
    }
  });

  it('未知 freshness 字面量 → invalid-input', () => {
    const decision = decideGraphConsumption({ ...VALID_INPUT, freshness: 'brand-new-state' });
    assert.equal(decision.outcome, 'invalid-input');
  });

  it('每个维度的未知字面量都 fail-loud（不只 freshness）', () => {
    const bogus = {
      changeClass: 'refactor',
      graphAvailability: 'partially-there',
      coverageScope: 'maybe',
      refreshPolicy: 'sure',
    };
    for (const [field, value] of Object.entries(bogus)) {
      const decision = decideGraphConsumption({ ...VALID_INPUT, [field]: value });
      assert.equal(decision.outcome, 'invalid-input', `${field}=${value} 应 invalid-input`);
    }
  });

  it('非对象入参 → invalid-input（null / undefined / 字符串）', () => {
    for (const bad of [null, undefined, 'fresh', 42]) {
      assert.equal(decideGraphConsumption(bad).outcome, 'invalid-input');
    }
  });

  it('第六字段 impactResult 被忽略，不污染五维严格性（FR-006 走后置注解通道）', () => {
    const withSixth = decideGraphConsumption({ ...VALID_INPUT, impactResult: { directCallers: 0 } });
    const withoutSixth = decideGraphConsumption(VALID_INPUT);
    assert.deepEqual(withSixth, withoutSixth);
    assert.deepEqual(withSixth.caveats, [], 'decide 阶段不得预判 caveat');
  });
});

describe('FR-004 / FR-004b (f) 两组封闭枚举', () => {
  const EXPECTED_REASONS = [
    'impact-not-applicable-additive-only',
    'classification-unknown',
    'graph-missing',
    'graph-corrupt',
    'graph-stale-refresh-declined',
    'graph-dirty-uncommitted',
    'graph-unknown-provenance',
    'refresh-failed-spectra-missing',
    'refresh-failed-timeout',
    'refresh-failed-nonzero-exit',
    'refresh-failed-artifact-unusable',
    'coverage-gap-out-of-graph-scope',
  ];

  it('DEGRADED_REASONS 恰含 12 项且与 spec 表逐字一致', () => {
    const values = Object.values(DEGRADED_REASONS);
    assert.equal(values.length, 12);
    assert.deepEqual([...values].sort(), [...EXPECTED_REASONS].sort());
  });

  it('CAVEAT_CODES 恰含 1 项', () => {
    const values = Object.values(CAVEAT_CODES);
    assert.equal(values.length, 1);
    assert.deepEqual(values, ['coverage-gap-known-extraction-limit']);
  });

  it('两组枚举交集为空（D7 措辞红线的机器化落地）', () => {
    const reasons = new Set(Object.values(DEGRADED_REASONS));
    for (const code of Object.values(CAVEAT_CODES)) {
      assert.equal(reasons.has(code), false, `${code} 同时出现在两组枚举中`);
    }
  });

  it('两组常量被冻结，运行期不可篡改', () => {
    assert.equal(Object.isFrozen(DEGRADED_REASONS), true);
    assert.equal(Object.isFrozen(CAVEAT_CODES), true);
  });

  it('源码内 degradedReason 返回路径上无枚举之外的字符串字面量（FR-004 grep 断言）', () => {
    const literalAssignments = MODULE_SOURCE.match(/degradedReason:\s*['"`]/g) ?? [];
    assert.deepEqual(
      literalAssignments,
      [],
      'degradedReason 必须引用 DEGRADED_REASONS.*，禁止散落字符串字面量',
    );
  });

  it('144 组合产出的 degradedReason 全部落在封闭枚举内', () => {
    for (const input of allCombinations()) {
      const { degradedReason } = decideGraphConsumption(input);
      if (degradedReason === null) continue;
      assert.ok(
        Object.values(DEGRADED_REASONS).includes(degradedReason),
        `越界 reason ${degradedReason}`,
      );
    }
  });
});

describe('FR-006 (g) annotateImpactCaveat 后置注解', () => {
  const TS_TARGET = 'src/a.ts::foo';

  it('consume-impact + directCallers:0 + TS target → 追加 caveat，outcome/degradedReason 不变', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const annotated = annotateImpactCaveat(decision, { directCallers: 0 }, TS_TARGET);

    assert.deepEqual(annotated.caveats, [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT]);
    assert.equal(annotated.outcome, decision.outcome);
    assert.equal(annotated.degradedReason, decision.degradedReason);
    assert.deepEqual(decision.caveats, [], '不得就地改写入参（纯函数）');
  });

  it('consume-impact + directCallers:3 → caveats 为空', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const annotated = annotateImpactCaveat(decision, { directCallers: 3 }, TS_TARGET);
    assert.deepEqual(annotated.caveats, []);
  });

  it('consume-degraded + directCallers:0 → 非消费出口不注解', () => {
    const decision = decideGraphConsumption({ ...VALID_INPUT, coverageScope: 'out-of-graph-scope' });
    assert.equal(decision.outcome, 'consume-degraded');
    const annotated = annotateImpactCaveat(decision, { directCallers: 0 }, TS_TARGET);
    assert.deepEqual(annotated.caveats, []);
  });

  it('目标落在图覆盖面之外 → 不注解（判据与 coverageScope 共用同一份面）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    // `.md` 不属于任何图生产管线的采集面；F254 之前这里用的是 `.mjs`，而 `.mjs` 早已在图内
    for (const target of ['docs/design.md::foo', 'README.txt', 'no-extension-at-all']) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { directCallers: 0 }, target).caveats,
        [],
        `${target} 不该被注解`,
      );
    }
  });

  it('F254：`.mjs` 目标现在落在覆盖面内 → 注解（修复前被误判范围外，caveat 通道对它整体失效）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const target of [
      'plugins/spec-driver/scripts/lib/goal-loop-core.mjs::foo',
      'src/mod.cjs::bar',
      'src/mod.py::baz',
      'src/Main.java::Main',
      'src/main.go::main',
    ]) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { directCallers: 0 }, target).caveats,
        [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
        `${target} 应被注解`,
      );
    }
  });

  it('B1-C4 真实 MCP 形状：计数在 summary.directCallers 上同样被识别', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const realPayload = { summary: { directCallers: 0, transitiveCallers: 0 }, affected: [], topImpacted: [] };
    assert.deepEqual(
      annotateImpactCaveat(decision, realPayload, TS_TARGET).caveats,
      [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
    );
    // summary 优先：两处并存时以 summary 为准
    assert.deepEqual(
      annotateImpactCaveat(decision, { directCallers: 0, summary: { directCallers: 7 } }, TS_TARGET).caveats,
      [],
    );
  });

  it('B1-C4 target 缺失 → 拒绝注解（无从判断目标是否在图覆盖内，宁可漏提示不误提示）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const badTarget of [undefined, null, '', 42, {}]) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { summary: { directCallers: 0 } }, badTarget).caveats,
        [],
        `target=${JSON.stringify(badTarget)} 时不得注解`,
      );
    }
  });

  it('缺 impactResult / directCallers 非数字 → 不注解，也不抛错', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const bad of [null, undefined, {}, { directCallers: 'zero' }, { summary: {} }]) {
      assert.deepEqual(annotateImpactCaveat(decision, bad, TS_TARGET).caveats, []);
    }
  });

  it('caveats 中出现的值必须属于 CAVEAT_CODES', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const annotated = annotateImpactCaveat(decision, { directCallers: 0 }, 'src/a.tsx::foo');
    for (const code of annotated.caveats) {
      assert.ok(Object.values(CAVEAT_CODES).includes(code), `越界 caveat ${code}`);
    }
  });

  it('GRAPH_SCOPE_SURFACES 的扩展名并集恰为六条采集管线的并集（F254 / F258）', () => {
    // 与 SSoT（src/collector-surface.ts::ALL_PRODUCER_SURFACES）的**逐管线逐字段**一致性由跨语言
    // 合同测试 tests/unit/graph-scope-extensions-contract.test.ts 守护——本模块无法引用 SSoT
    const union = new Set();
    for (const surface of GRAPH_SCOPE_SURFACES) for (const extension of surface.extensions) union.add(extension);
    assert.deepEqual(
      [...union].sort(),
      ['.cjs', '.cts', '.go', '.java', '.js', '.jsx', '.mjs', '.mts', '.py', '.pyi', '.ts', '.tsx'],
    );
  });

  it('F254 注释不得再保留已失真的两句断言（"只收这四类" / "全仓唯一定义处"白名单口径）', () => {
    assert.equal(/只收这四类/.test(MODULE_SOURCE), false, '注释仍声称 walker 只收四类扩展名');
    assert.equal(
      /\*\*全仓唯一定义处\*\*/.test(MODULE_SOURCE),
      false,
      '注释仍以"全仓唯一定义处"自称权威白名单——现在图自述面才是优先判据',
    );
  });
});

describe('F254 annotateImpactCaveat 第 4 参 scopeSurfaces 参数化', () => {
  const TS_TARGET = 'src/a.ts::foo';
  const MD_SURFACES = [{ id: 'custom', extensions: ['.md'], matchSemantics: 'case-insensitive' }];

  it('不传第 4 参 ≡ 显式传入 GRAPH_SCOPE_SURFACES（默认值就是静态 fallback）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const target of [TS_TARGET, 'src/mod.mjs::foo', 'docs/design.md']) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { directCallers: 0 }, target),
        annotateImpactCaveat(decision, { directCallers: 0 }, target, GRAPH_SCOPE_SURFACES),
        `target=${target} 时默认值与显式传参必须等价`,
      );
    }
  });

  it('显式传入自定义面 → 判据随之切换（动态面能收窄，不只是扩大）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);

    // 自定义面只含 `.md`：`.ts` 反而落在面外 → 不注解
    assert.deepEqual(annotateImpactCaveat(decision, { directCallers: 0 }, TS_TARGET, MD_SURFACES).caveats, []);
    // 同一份自定义面下 `.md` 目标反而被注解
    assert.deepEqual(
      annotateImpactCaveat(decision, { directCallers: 0 }, 'docs/design.md', MD_SURFACES).caveats,
      [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
    );
    // 空面：什么都不注解（图自述面推导失败时不会走到这里，但函数本身必须是全序的）
    assert.deepEqual(annotateImpactCaveat(decision, { directCallers: 0 }, TS_TARGET, []).caveats, []);
  });

  it('纯函数不变量：不就地改写 scopeSurfaces 入参', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const scopeSurfaces = [
      { id: 'a', extensions: ['.ts'], matchSemantics: 'case-sensitive' },
      { id: 'b', extensions: ['.md'], matchSemantics: 'case-insensitive' },
    ];
    const snapshot = JSON.stringify(scopeSurfaces);

    annotateImpactCaveat(decision, { directCallers: 0 }, TS_TARGET, scopeSurfaces);
    annotateImpactCaveat(decision, { directCallers: 0 }, 'docs/design.md', scopeSurfaces);

    assert.equal(JSON.stringify(scopeSurfaces), snapshot);
    assert.equal(GRAPH_SCOPE_SURFACES.length, 5, '默认常量本身也不得被污染');
  });
});

describe('F258 缺陷 3：逐管线 matchSemantics 同解判定', () => {
  const TS_TARGET = 'src/a.ts::foo';

  it('GRAPH_SCOPE_SURFACES 是逐管线结构（5 条，各带 extensions + matchSemantics，全部 frozen）', () => {
    assert.equal(Object.isFrozen(GRAPH_SCOPE_SURFACES), true);
    assert.equal(GRAPH_SCOPE_SURFACES.length, 5);
    assert.deepEqual(
      GRAPH_SCOPE_SURFACES.map((surface) => surface.id),
      ['tsjsSkeletonWalk', 'pyWalk', 'genericAdapters', 'moduleDerivationScan', 'pythonSymbolScan'],
    );
    for (const surface of GRAPH_SCOPE_SURFACES) {
      assert.equal(Object.isFrozen(surface), true, `${surface.id} 必须 frozen`);
      assert.equal(Object.isFrozen(surface.extensions), true, `${surface.id}.extensions 必须 frozen`);
      assert.ok(surface.extensions.length > 0);
      assert.ok(
        ['case-sensitive', 'case-insensitive'].includes(surface.matchSemantics),
        `${surface.id} 的 matchSemantics 越界：${surface.matchSemantics}`,
      );
      for (const extension of surface.extensions) {
        assert.equal(extension, extension.toLowerCase(), '扩展名一律小写字面量声明');
        assert.equal(extension.startsWith('.'), true);
      }
    }
    // 扁平常量必须整体删除：留着就是留第二份真相（fix-report 缺陷 3 的 Why 4）
    assert.equal(
      /GRAPH_SCOPE_EXTENSIONS/.test(MODULE_SOURCE),
      false,
      '扁平 GRAPH_SCOPE_EXTENSIONS 必须整体删除，不留兼容别名',
    );
    const definitions = MODULE_SOURCE.match(/(?:export\s+)?const\s+GRAPH_SCOPE_SURFACES\s*=/g) ?? [];
    assert.equal(definitions.length, 1, '静态 fallback 常量必须只在本模块定义一次');
  });

  it('surfaceMatchesFileMjs：case-sensitive 面用 endsWith 求值（`.PY` 不命中，纯点文件 `.py` 命中）', () => {
    const pyWalk = GRAPH_SCOPE_SURFACES.find((surface) => surface.id === 'pyWalk');
    assert.equal(surfaceMatchesFileMjs(pyWalk, 'foo.py'), true);
    assert.equal(surfaceMatchesFileMjs(pyWalk, 'foo.PY'), false, '生产者是 endsWith(".py")，`.PY` 根本不入图');
    assert.equal(surfaceMatchesFileMjs(pyWalk, 'foo.PYI'), false);
    assert.equal(surfaceMatchesFileMjs(pyWalk, '.py'), true, '纯点文件命中，与 walkPyFiles 一致');
  });

  it('surfaceMatchesFileMjs：case-insensitive 面用 extname().toLowerCase() 求值（`src/.go` 不命中）', () => {
    const generic = GRAPH_SCOPE_SURFACES.find((surface) => surface.id === 'genericAdapters');
    assert.equal(surfaceMatchesFileMjs(generic, 'Foo.JAVA'), true);
    assert.equal(surfaceMatchesFileMjs(generic, 'src/main.go'), true);
    assert.equal(surfaceMatchesFileMjs(generic, 'src/.go'), false, 'path.extname("src/.go") === ""');
  });

  it('surfaceMatchesFileMjs：未知/缺失 matchSemantics ⇒ 显式第三出口 null（**不得** else 兜底到 case-insensitive）', () => {
    for (const semantics of ['case-folded', undefined, null, '', 'CASE-SENSITIVE']) {
      assert.equal(
        surfaceMatchesFileMjs({ id: 'x', extensions: ['.py'], matchSemantics: semantics }, 'foo.PY'),
        null,
        `matchSemantics=${JSON.stringify(semantics)} 必须判不可判，而不是静默按大小写不敏感处理`,
      );
    }
    // 结构畸形同样走第三出口，绝不抛错、也绝不给 false（false 会被读成"确定不在面内"）
    for (const badSurface of [null, undefined, [], 'pyWalk', { id: 'x', matchSemantics: 'case-sensitive' }]) {
      assert.equal(surfaceMatchesFileMjs(badSurface, 'foo.py'), null, `畸形 surface=${JSON.stringify(badSurface)}`);
    }
  });

  it('R3-2 annotateImpactCaveat：`foo.PY::bar` 落在覆盖面外 → 不注解', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const target of ['scripts/foo.PY::bar', 'scripts/foo.PY', 'scripts/foo.PYI#bar', 'src/.go']) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { summary: { directCallers: 0 } }, target).caveats,
        [],
        `${target} 不该被注解`,
      );
    }
  });

  it('R3-4 annotateImpactCaveat：`Foo.JAVA` 走大小写不敏感面 → 仍注解（防修过头）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    for (const target of ['src/Foo.JAVA::Foo', 'src/foo.py::bar', 'src/a.ts::foo']) {
      assert.deepEqual(
        annotateImpactCaveat(decision, { summary: { directCallers: 0 } }, target).caveats,
        [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT],
        `${target} 应被注解`,
      );
    }
  });

  it('annotateImpactCaveat：surface 语义不可判时按"不在面内"收口（=== true 才注解）', () => {
    const decision = decideGraphConsumption(VALID_INPUT);
    const brokenSurfaces = [{ id: 'broken', extensions: ['.ts'], matchSemantics: 'case-folded' }];
    assert.deepEqual(
      annotateImpactCaveat(decision, { summary: { directCallers: 0 } }, TS_TARGET, brokenSurfaces).caveats,
      [],
      'null 不得被当作真值',
    );
  });
});

describe('FR-001 (h) 纯函数静态约束', () => {
  it('模块内不 import child_process / fs / node:url 等 I/O 依赖', () => {
    const importLines = MODULE_SOURCE.split('\n').filter((line) => /^\s*import\s/.test(line));
    // F258 §5.2：零 import 硬约束收窄式放宽为「零 I/O + 仅 `node:path`」。断言改为**封闭等值**
    // （多一条、少一条都红）：被守护的实质是"不 spawn、不读文件"，而 `path.extname` 必须与
    // TS 侧生产者用同一个实现——自造等价 extname 才是真正的风险（Node 对 `..`/纯点文件有非直觉分支）。
    assert.deepEqual(
      importLines,
      ["import path from 'node:path';"],
      `决策模块只允许 import node:path，实得：${importLines.join(' | ')}`,
    );
    assert.equal(/require\s*\(/.test(MODULE_SOURCE), false, '不得使用 require');
    assert.equal(/child_process/.test(MODULE_SOURCE.replace(/^\s*\/\/.*$/gm, '')), false);
  });

  it('对同一输入重复调用返回等价结果（确定性）', () => {
    for (const input of allCombinations()) {
      assert.deepEqual(decideGraphConsumption(input), decideGraphConsumption(input));
    }
  });

  it('不修改入参对象', () => {
    const input = { ...VALID_INPUT };
    const snapshot = JSON.stringify(input);
    decideGraphConsumption(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});
