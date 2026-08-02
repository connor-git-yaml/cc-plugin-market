/**
 * goal-loop-graph-consumption-integration.test.mjs
 * Feature 241 — goal_loop 双合同接线（FR-011，SC-008）
 *
 * **新文件，刻意不碰 `goal-loop-core.test.mjs` 本体**（RG-001 硬约束：那 163+ 条断言里有
 * `interpretImpactResult` 的四条冻结用例，是多轮对抗审查加固过的资产，本 feature 零改动）。
 *
 * 覆盖三件事：
 *   1. 两个合同的**权威度差异**是机器可判的（advisory 不落权威结论字段；authoritative 才落）
 *   2. 注入闸门（哪些出口允许把 impact 喂进 prompt）只有一处定义，且拒绝态确实把 degradedReason
 *      写进 iteration log —— 「静默不注入」和「说明为什么没注入」是两回事
 *   3. `phase_start_ref` 的 last-match-wins 语义（T-W1）：goal_loop rerun 会往 trace 追加新行，
 *      读取方必须取最后一条，否则第二轮会拿第一轮的起点 ref 去算 diff
 *
 * 运行方式: node --test plugins/spec-driver/tests/goal-loop-graph-consumption-integration.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 既有 goal-loop-core 导出，零改造复用（V-2 已验证 formatIterationLogEntry 无字段白名单）
import { formatIterationLogEntry, interpretImpactResult } from '../scripts/lib/goal-loop-core.mjs';
import {
  decideGraphConsumption,
  shouldConsumeImpact,
  buildImpactInjectionBlock,
  CAVEAT_CODES,
  DEGRADED_REASONS,
} from '../scripts/lib/graph-consumption-decision.mjs';
import { resolvePhaseStartRef } from '../scripts/graph-consumption-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'scripts', 'graph-consumption-cli.mjs');
const AUDIT_REL = path.join('.specify', 'graph-consumption-audit.jsonl');
const GRAPH_REL = path.join('specs', '_meta', 'graph.json');
const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

let sandbox;

function seedProject(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export function helper(): number {\n  return 1;\n}\n');
  fs.writeFileSync(
    path.join(root, '.gitignore'),
    ['fake-spectra', 'spectra-invocations.log', '.specify/', 'specs/', 'trace.md'].join('\n') + '\n',
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
  fs.writeFileSync(path.join(root, GRAPH_REL), JSON.stringify({ graph: { sourceCommit }, nodes: [], edges: [] }));
}

function seedFakeSpectra(root) {
  const binPath = path.join(root, 'fake-spectra');
  fs.writeFileSync(
    binPath,
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "graph-quality" ]; then',
      '  printf \'{"freshness":{"state":"%s"}}\\n\' "${F241_FRESHNESS:-fresh}"',
      '  exit 0',
      'fi',
      'exit 0',
    ].join('\n'),
    { mode: 0o755 },
  );
  return binPath;
}

function runCli(args, env = {}) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: sandbox,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout ?? '');
  } catch {
    json = null;
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, json };
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
  sandbox = fs.mkdtempSync(path.join(TMP_BASE, 'goal-loop-graph-'));
});

afterEach(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
});

describe('FR-011 合同一：pre-implement advisory（goal_loop 每轮注入前）', () => {
  it('输出含 advisory:true，且权威结论字段为 null', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.writeFileSync(path.join(sandbox, 'src', 'new.ts'), 'export const n = 1;\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--phase', 'implement',
      '--refresh-policy', 'allowed', '--advisory', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.advisory, true);
    assert.equal(result.json.authoritativeOutcome, null);

    // 审计事件同样标记 advisory：事后排障要能区分"这是建议"与"这是判定"
    const [event] = readAuditEvents(sandbox).filter((entry) => entry.kind === 'decision');
    assert.equal(event.advisory, true);
  });

  it('advisory 下即便 changeClass=additive-only，verify 侧仍必须另发 authoritative 调用', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.writeFileSync(path.join(sandbox, 'src', 'new.ts'), 'export const n = 1;\n');

    const advisory = runCli([
      'decide', '--project-root', sandbox, '--phase', 'implement',
      '--refresh-policy', 'allowed', '--advisory', '--spectra-bin', bin,
    ]);
    assert.equal(advisory.json.outcome, 'skip-impact');
    assert.equal(advisory.json.authoritativeOutcome, null, 'advisory 的 skip-impact 不是权威结论');

    const authoritative = runCli([
      'decide', '--project-root', sandbox, '--phase', 'implement',
      '--refresh-policy', 'declined', '--spectra-bin', bin,
    ]);
    assert.equal(authoritative.json.advisory, false);
    assert.equal(authoritative.json.authoritativeOutcome, 'skip-impact');

    const decisions = readAuditEvents(sandbox).filter((entry) => entry.kind === 'decision');
    assert.deepEqual(decisions.map((entry) => entry.advisory), [true, false]);
  });
});

describe('FR-011 合同二：pre-verify authoritative（DECISION2）', () => {
  it('只调 decide：decision 事件已落盘，且没有回链的 caveat-annotation —— 这是正确形态，不是漏记', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--phase', 'implement',
      '--refresh-policy', 'declined', '--spectra-bin', bin,
    ]);
    assert.equal(result.status, 0, `stderr=${result.stderr}`);

    const events = readAuditEvents(sandbox);
    const decisions = events.filter((entry) => entry.kind === 'decision');
    const annotations = events.filter((entry) => entry.kind === 'caveat-annotation');

    assert.equal(decisions.length, 1, 'FR-010 由 decision 事件独立满足');
    assert.equal(annotations.length, 0);
    // pending 态可被 decisionId 反查：存在 decision、无回链注解。DECISION2 本就不消费 impact。
    assert.equal(
      annotations.some((entry) => entry.decisionId === decisions[0].decisionId),
      false,
    );
  });

  it('DECISION2 按调用方合同必须传 declined（同 phase 内 advisory 已消耗过 allowed 预算）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const result = runCli(
      ['decide', '--project-root', sandbox, '--phase', 'implement', '--refresh-policy', 'declined', '--spectra-bin', bin],
      { F241_FRESHNESS: 'stale' },
    );
    assert.equal(result.json.refreshAttempted, false);
    assert.equal(result.json.degradedReason, DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED);
  });
});

describe('FR-011 注入闸门：允许态注入 / 拒绝态不注入但留证据', () => {
  const ALLOW = [{ outcome: 'consume-impact' }];
  const REJECT = [
    { outcome: 'consume-degraded' },
    { outcome: 'skip-impact' },
    { outcome: 'unavailable' },
    { outcome: 'invalid-input' },
    // dry-run 下 refresh-then-consume 仍是终态：什么都没刷，不能注入
    { outcome: 'refresh-then-consume' },
  ];

  it('shouldConsumeImpact 是注入规则的唯一定义处，允许态只有 consume-impact', () => {
    for (const decision of ALLOW) assert.equal(shouldConsumeImpact(decision), true, decision.outcome);
    for (const decision of REJECT) assert.equal(shouldConsumeImpact(decision), false, decision.outcome);
    for (const bad of [null, undefined, {}, 'consume-impact']) assert.equal(shouldConsumeImpact(bad), false);
  });

  it('允许态：iteration log 条目带 impact 内容，且 formatIterationLogEntry 零改造即可输出', () => {
    const decision = decideGraphConsumption({
      changeClass: 'modifies-existing',
      graphAvailability: 'present',
      freshness: 'fresh',
      coverageScope: 'in-graph-scope',
      refreshPolicy: 'declined',
    });
    assert.equal(shouldConsumeImpact(decision), true);

    // 注入进 prompt 的是 interpretImpactResult 产出的 summary（该函数体本 feature 零改动）
    const impact = interpretImpactResult({ directCallers: 3, affected: ['src/b.ts::main'], riskTier: 'medium' });
    assert.equal(impact.injected, true);

    const entry = {
      round: 1,
      injection_status: 'injected',
      graphDecision: { outcome: decision.outcome, degradedReason: decision.degradedReason, matchedRule: decision.matchedRule },
      impact,
    };

    const rendered = formatIterationLogEntry(entry);
    assert.match(rendered, /### 轮次 1/);
    assert.match(rendered, /"outcome": "consume-impact"/);
    assert.match(rendered, /"injected": true/);
    assert.ok(rendered.includes(impact.summary), 'prompt 组装用的 impact 摘要必须出现在条目里');
  });

  it('拒绝态：不注入，但 iteration log 必须写清 degradedReason（静默跳过是不可接受的）', () => {
    const cases = [
      [{ changeClass: 'additive-only', graphAvailability: 'present', freshness: 'fresh', coverageScope: 'in-graph-scope', refreshPolicy: 'declined' },
        DEGRADED_REASONS.IMPACT_NOT_APPLICABLE_ADDITIVE_ONLY],
      [{ changeClass: 'modifies-existing', graphAvailability: 'present', freshness: 'fresh', coverageScope: 'out-of-graph-scope', refreshPolicy: 'declined' },
        DEGRADED_REASONS.COVERAGE_GAP_OUT_OF_GRAPH_SCOPE],
      [{ changeClass: 'modifies-existing', graphAvailability: 'missing', freshness: 'unknown-provenance', coverageScope: 'in-graph-scope', refreshPolicy: 'declined' },
        DEGRADED_REASONS.GRAPH_MISSING],
      [{ changeClass: 'modifies-existing', graphAvailability: 'present', freshness: 'stale', coverageScope: 'in-graph-scope', refreshPolicy: 'declined' },
        DEGRADED_REASONS.GRAPH_STALE_REFRESH_DECLINED],
    ];

    for (const [input, expectedReason] of cases) {
      const decision = decideGraphConsumption(input);
      assert.equal(shouldConsumeImpact(decision), false, `${expectedReason} 不应注入`);
      assert.equal(decision.degradedReason, expectedReason);

      const rendered = formatIterationLogEntry({
        round: 2,
        injection_status: 'skipped_by_graph_decision',
        graphDecision: {
          outcome: decision.outcome,
          degradedReason: decision.degradedReason,
          fallbackHint: decision.fallbackHint,
          matchedRule: decision.matchedRule,
        },
      });
      assert.match(rendered, new RegExp(`"degradedReason": "${expectedReason}"`));
      assert.match(rendered, /"injection_status": "skipped_by_graph_decision"/);
      assert.match(rendered, /"fallbackHint": ".+"/, '拒绝时必须同时给出替代动作');
    }
  });

  it('新增 graphDecision 字段不改 formatIterationLogEntry 行为：旧形态条目输出与从前一致', () => {
    const legacy = { round: 7, injection_status: 'injected', impact: { directCallers: 1 } };
    const rendered = formatIterationLogEntry(legacy);
    assert.equal(rendered, `### 轮次 7（round 7）\n\n\`\`\`json\n${JSON.stringify(legacy, null, 2)}\n\`\`\`\n`);
    assert.equal(rendered.includes('graphDecision'), false);
  });
});

describe('批 1 整改 / B1-C7 buildImpactInjectionBlock：正反两向用同一份 impactSummary 输入', () => {
  /**
   * 旧 SC-008 的"正反注入"实际只查了 iteration log 字段——那测的是**日志写没写对**，
   * 不是"prompt 里到底有没有 impact 内容"。这里把组装动作抽成纯函数后，两向断言吃的是
   * **同一份** `IMPACT_SUMMARY`：允许态的产物必须含它，拒绝态的产物必须不含它。
   */
  const IMPACT_SUMMARY = 'directCallers=3 ｜ affected: src/b.ts::main ｜ riskTier=medium';

  const FRESH_INPUT = {
    changeClass: 'modifies-existing',
    graphAvailability: 'present',
    freshness: 'fresh',
    coverageScope: 'in-graph-scope',
    refreshPolicy: 'declined',
  };

  it('允许态（consume-impact）：组装结果是字符串且含 impact 内容', () => {
    const decision = decideGraphConsumption(FRESH_INPUT);
    assert.equal(decision.outcome, 'consume-impact');

    const block = buildImpactInjectionBlock(decision, IMPACT_SUMMARY);
    assert.equal(typeof block, 'string');
    assert.ok(block.includes(IMPACT_SUMMARY), '允许态必须真的把 impact 内容组装进注入块');
  });

  it('拒绝态：同一份 impactSummary 输入，组装结果必须不含 impact 内容', () => {
    const REJECTED = ['consume-degraded', 'skip-impact', 'unavailable', 'invalid-input', 'refresh-then-consume'];
    for (const outcome of REJECTED) {
      const block = buildImpactInjectionBlock({ outcome, caveats: [] }, IMPACT_SUMMARY);
      assert.equal(block, null, `${outcome} 不得产出注入块`);
      assert.equal(String(block).includes(IMPACT_SUMMARY), false, `${outcome} 的产物不得含 impact 内容`);
    }
    for (const bad of [null, undefined, {}, 'consume-impact']) {
      assert.equal(buildImpactInjectionBlock(bad, IMPACT_SUMMARY), null);
    }
  });

  it('注入闸门与组装器共用同一判定：shouldConsumeImpact 为假则组装器必返回 null', () => {
    const inputs = [
      FRESH_INPUT,
      { ...FRESH_INPUT, changeClass: 'additive-only' },
      { ...FRESH_INPUT, coverageScope: 'out-of-graph-scope' },
      { ...FRESH_INPUT, freshness: 'stale' },
      { ...FRESH_INPUT, graphAvailability: 'missing', freshness: 'unknown-provenance' },
    ];
    for (const input of inputs) {
      const decision = decideGraphConsumption(input);
      const block = buildImpactInjectionBlock(decision, IMPACT_SUMMARY);
      assert.equal(
        block !== null,
        shouldConsumeImpact(decision),
        `${decision.outcome} 上闸门与组装器结论不一致`,
      );
    }
  });

  it('caveat 必须在注入块里可见，且措辞不得声称影响面完整（D7 红线）', () => {
    const decision = decideGraphConsumption(FRESH_INPUT);
    const withCaveat = { ...decision, caveats: [CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT] };
    const block = buildImpactInjectionBlock(withCaveat, IMPACT_SUMMARY);

    assert.ok(block.includes(CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT), 'caveat 必须随注入块一起可见');
    assert.doesNotMatch(block, /影响面完整|影响面可信|已穷尽/);
  });

  it('允许态但没有 impact 摘要 → null（不造一个空壳块冒充有证据）', () => {
    const decision = decideGraphConsumption(FRESH_INPUT);
    for (const empty of [null, undefined, '', '   ', 42]) {
      assert.equal(buildImpactInjectionBlock(decision, empty), null);
    }
  });
});

describe('FR-011 旧形态优雅降级（RG-001 回归探针）', () => {
  it('缺 freshness 字段的旧形态入参 → invalid-input，不抛错', () => {
    const legacyInput = {
      changeClass: 'modifies-existing',
      graphAvailability: 'present',
      coverageScope: 'in-graph-scope',
      refreshPolicy: 'declined',
    };
    let decision;
    assert.doesNotThrow(() => {
      decision = decideGraphConsumption(legacyInput);
    });
    assert.equal(decision.outcome, 'invalid-input');
    assert.equal(shouldConsumeImpact(decision), false, '判不出来时默认不注入，是安全方向');
  });

  it('interpretImpactResult 的既有四条形态零回归（本 feature 未改其函数体）', () => {
    assert.equal(interpretImpactResult(null).injected, false);
    assert.equal(interpretImpactResult(null).skipped, true);
    assert.equal(interpretImpactResult({ error: 'graph-not-built' }).injected, false);
    assert.equal(interpretImpactResult({ directCallers: 2, affected: ['x'] }).injected, true);
  });
});

describe('T-W1 phase_start_ref 锚点：last-match wins', () => {
  const SHA_A = '1111111111111111111111111111111111111111';
  const SHA_B = '2222222222222222222222222222222222222222';

  it('trace 内多条 phase_start_ref: implement= 时取最后一条（rerun 追加新行）', () => {
    const trace = [
      '# trace',
      `[02:25:34] phase_start_ref: implement=${SHA_A}`,
      '[02:30:00] batch_base: batch1=deadbeef',
      `[03:10:07] phase_start_ref: implement=${SHA_B}`,
      '',
    ].join('\n');
    assert.equal(resolvePhaseStartRef(trace, 'implement'), SHA_B);
  });

  it('只有一条时取那一条；一条都没有时返回 null（不猜测）', () => {
    assert.equal(resolvePhaseStartRef(`[01:00:00] phase_start_ref: implement=${SHA_A}\n`, 'implement'), SHA_A);
    assert.equal(resolvePhaseStartRef('# trace\n无锚点\n', 'implement'), null);
    assert.equal(resolvePhaseStartRef('', 'implement'), null);
    assert.equal(resolvePhaseStartRef(null, 'implement'), null);
  });

  it('按 phase 名精确取用，不串台', () => {
    const trace = [
      `[01:00:00] phase_start_ref: implement=${SHA_A}`,
      `[02:00:00] phase_start_ref: verify=${SHA_B}`,
    ].join('\n');
    assert.equal(resolvePhaseStartRef(trace, 'implement'), SHA_A);
    assert.equal(resolvePhaseStartRef(trace, 'verify'), SHA_B);
    assert.equal(resolvePhaseStartRef(trace, 'plan'), null);
  });

  it('CLI --base-ref-from-trace 走同一语义：多轮 rerun 后用最后一条起点算 diff', () => {
    const baseRef = seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);

    // 第一轮起点是一个不存在的 sha（若被误取，diff 会失败进而判 unknown）；第二轮才是真起点
    const tracePath = path.join(sandbox, 'trace.md');
    fs.writeFileSync(
      tracePath,
      [
        `[01:00:00] phase_start_ref: implement=${'9'.repeat(40)}`,
        `[02:00:00] phase_start_ref: implement=${baseRef}`,
        '',
      ].join('\n'),
    );
    fs.appendFileSync(path.join(sandbox, 'src', 'a.ts'), '// touched\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--phase', 'implement',
      '--base-ref-from-trace', tracePath,
      '--refresh-policy', 'declined', '--spectra-bin', bin,
    ]);

    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.baseRefMissing, false, '取到最后一条锚点即视为 base-ref 可用');
    assert.equal(result.json.inputs.changeClass, 'modifies-existing');
  });

  it('CLI --base-ref-from-trace 指向无锚点文件 → baseRefMissing:true（如实标注，不静默当有）', () => {
    seedProject(sandbox);
    writeGraph(sandbox);
    const bin = seedFakeSpectra(sandbox);
    const tracePath = path.join(sandbox, 'trace.md');
    fs.writeFileSync(tracePath, '# trace\n没有锚点\n');

    const result = runCli([
      'decide', '--project-root', sandbox, '--base-ref-from-trace', tracePath,
      '--refresh-policy', 'declined', '--spectra-bin', bin,
    ]);
    assert.equal(result.status, 0, `stderr=${result.stderr}`);
    assert.equal(result.json.baseRefMissing, true);
  });
});

describe('RG-001 / RG-003 零改造断言', () => {
  it('goal-loop-core.mjs 未被本 feature 触碰：不含任何 F241 / graph-consumption 引用', () => {
    const core = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'goal-loop-core.mjs'), 'utf-8');
    assert.equal(core.includes('graph-consumption'), false);
    assert.equal(core.includes('decideGraphConsumption'), false);
    assert.equal(core.includes('Feature 241'), false);
  });
});

describe('T-C1 SKILL 接线判定条件：必须用 phase.name，且与 effective orchestration 逐字一致', () => {
  const SKILL_PATH = path.join(__dirname, '..', 'skills', 'spec-driver-feature', 'SKILL.md');

  /** 从 effective orchestration 里取 feature 模式各 phase 的 {id, name}。 */
  function featurePhases() {
    const result = spawnSync(
      'node',
      [path.join(__dirname, '..', 'scripts', 'orchestrator-cli.mjs'), 'effective-orchestration', 'feature', '--format', 'json'],
      { encoding: 'utf-8', timeout: 60_000 },
    );
    assert.equal(result.status, 0, `orchestrator-cli 失败：${result.stderr}`);
    return JSON.parse(result.stdout).config.modes.feature.phases;
  }

  it('SKILL.md 引用的 "implement" / "verify" 与 orchestration 的 name 字段逐字一致', () => {
    const phases = featurePhases();
    const names = new Set(phases.map((phase) => phase.name));
    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');

    for (const name of ['implement', 'verify']) {
      assert.ok(names.has(name), `orchestration 里不存在 name="${name}" 的 phase`);
      assert.ok(
        skill.includes(`phase.name === "${name}"`),
        `SKILL.md 缺少 phase.name === "${name}" 的判定条件`,
      );
    }
  });

  it('SKILL.md 不得残留 phase.id 判定（implement 是 "6"、verify 是 "7c"，按 id 比恒 false）', () => {
    const phases = featurePhases();
    const implement = phases.find((phase) => phase.name === 'implement');
    const verify = phases.find((phase) => phase.name === 'verify');
    assert.notEqual(implement.id, 'implement', '前提：id 与 name 确实不同');
    assert.notEqual(verify.id, 'verify');

    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
    assert.equal(skill.includes('phase.id === "implement"'), false);
    assert.equal(skill.includes('phase.id === "verify"'), false);
  });

  it('两处 goal_loop 接线与两处通用循环接线都已落地', () => {
    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
    for (const marker of [
      'phase_start_ref: implement=',           // 4a 锚点写入
      'pre-verify authoritative',              // 4b 与 goal_loop 步骤 3b
      'pre-implement advisory',                // goal_loop 步骤 2 的第 0 步
      'skipped_by_advisory_decision',          // 拒绝态的 iteration log 状态
      '--base-ref-from-trace',                 // last-match-wins 由 CLI 承担
      'graph-consumption-cli.mjs',
    ]) {
      assert.ok(skill.includes(marker), `SKILL.md 缺少接线标记：${marker}`);
    }
  });

  /**
   * B1-C5：只查"标记出现过"挡不住参数漏传——`--tasks-file` 是 T027b 后补的功能，
   * SKILL 散文没回灌，于是 D3 advisory 轮 1 信号在真实编排里永远拿不到。
   * 因此这里断言**完整参数串**逐行一致，而不是单个 token 存在。
   */
  const ADVISORY_COMMAND = [
    '   DECISION=$(node "$PLUGIN_DIR/scripts/graph-consumption-cli.mjs" decide \\',
    '     --project-root {project_root} --phase implement \\',
    '     --base-ref-from-trace "{feature_dir}/trace.md" \\',
    '     --tasks-file "{feature_dir}/tasks.md" \\',
    '     --refresh-policy {轮 1 传 allowed；轮 ≥2 传 declined} --advisory)',
  ].join('\n');

  it('B1-C5 goal_loop 步骤 2 的 advisory 命令逐字含 --tasks-file（完整参数串断言）', () => {
    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
    assert.ok(
      skill.includes(ADVISORY_COMMAND),
      `SKILL.md 的 advisory 命令与预期参数串不一致，期望逐字包含：\n${ADVISORY_COMMAND}`,
    );
  });

  it('B1-C5 两个生成 wrapper 与 canonical 同步（改 SKILL 忘 repo:sync 会红）', () => {
    const REPO_ROOT = path.join(__dirname, '..', '..', '..');
    for (const wrapper of [
      path.join(REPO_ROOT, 'plugins', 'spec-driver', 'skills-codex', 'spec-driver-feature', 'SKILL.md'),
      path.join(REPO_ROOT, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md'),
    ]) {
      assert.equal(fs.existsSync(wrapper), true, `wrapper 缺失：${wrapper}`);
      assert.ok(
        fs.readFileSync(wrapper, 'utf-8').includes(ADVISORY_COMMAND),
        `${path.relative(REPO_ROOT, wrapper)} 未同步 advisory 命令——需要 npm run repo:sync`,
      );
    }
  });

  /**
   * B1-W1：`{本 phase 内首次调用传 allowed，否则 declined}` 在 goal_loop 场景下有歧义——
   * 步骤 2 与步骤 3b 都在 implement phase 里跑过 decide，外层 verify 4b 到底算第几次没有定义。
   * 处置是把预算键钉死为 `(projectRoot, phase=implement)`，并给 4b 一条无歧义的分派模式条件。
   */
  it('B1-W1 预算键钉死 + goal_loop 已跑过时外层 verify 4b 恒 declined', () => {
    const skill = fs.readFileSync(SKILL_PATH, 'utf-8');
    for (const marker of [
      '(projectRoot, phase=implement)',
      'goal_loop 已在本 phase 运行过 decide',
      '恒 declined',
    ]) {
      assert.ok(skill.includes(marker), `SKILL.md 缺少 B1-W1 预算键措辞：${marker}`);
    }
    assert.equal(
      skill.includes('--refresh-policy {本 phase 内首次调用传 allowed，否则 declined}'),
      false,
      '歧义措辞必须被替换掉，而不是并存',
    );
  });
});
