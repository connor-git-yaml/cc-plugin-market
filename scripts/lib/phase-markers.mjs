/**
 * Feature 187 — swebench harness 执行阶段（phaseReached）解析（spec FR-002-c；Codex C-3/C-6）。
 *
 * 纯函数：对捕获的 run_instance.log（+stdout/stderr）文本做事后解析，定位 harness 到达的
 * 最远执行阶段。phaseReached 直接决定 candidate vs infra 归因 → 本模块源码摘要纳入
 * oracleSpecHash（Codex C-2）。marker 文本取自 Phase 0 真实日志，升 swebench 版本需复核。
 *
 * 关键（Codex C-3 防反向污染）：marker 缺失时**不保守判 image**——若 log 含 pytest/OOM
 * 测试执行证据则判 test_exec（让烂 patch 落到 candidate fail）；真无任何证据才 unknown + 告警。
 */

/** 阶段 → 序数（取最远到达，单调不回退）。 */
const PHASE_ORDINAL = { image: 0, container_start: 1, patch_apply: 2, test_exec: 3, report_parse: 4, done: 5 };

/** 各阶段 marker（正则）。基于 Phase 0 实测 run_instance.log。顺序无关，取命中的最高序数。 */
const PHASE_MARKERS = [
  ['container_start', /Creating container for|Container for .+ (?:created|started)/],
  ['patch_apply', />>>>>+ Applied Patch|now applying to container|Applied patch .+ cleanly/],
  ['test_exec', /Eval script for .+ (?:written|copying to container)|Test runtime:\s|>>>>>+ Start Test/],
  ['report_parse', /Test output for .+ written|Grading answer for|\breport:\s*\{/],
  ['done', /Result for .+:\s*resolved:|>>>>>+ End Test/],
];

/** 测试执行证据（无 phase marker 时的 evidence-based 兜底）：证明测试确实跑过/跑挂。 */
const TEST_EXEC_EVIDENCE = /test session starts|::[\w.\[\]-]+ (?:PASSED|FAILED|ERROR)\b|\bPASSED\b|\bFAILED\b|OOMKilled|\bKilled\b|short test summary/;

/**
 * @param {string} logText 捕获的 run_instance.log + stdout/stderr 文本
 * @returns {{phaseReached: string, phaseMarkerMatched: boolean, phaseEvidence: string, markerMissing: boolean}}
 */
export function parsePhaseFromLog(logText) {
  const log = String(logText ?? '');

  // 1) 扫描 phase marker，取命中的最远阶段
  let best = null;
  let bestEvidence = '';
  for (const [phase, re] of PHASE_MARKERS) {
    const m = log.match(re);
    if (m && (best === null || PHASE_ORDINAL[phase] > PHASE_ORDINAL[best])) {
      best = phase;
      bestEvidence = m[0];
    }
  }
  if (best !== null) {
    return { phaseReached: best, phaseMarkerMatched: true, phaseEvidence: bestEvidence, markerMissing: false };
  }

  // 2) 无 phase marker：evidence-based（Codex C-3）——有测试执行证据则 test_exec，不洗成 infra
  const ev = log.match(TEST_EXEC_EVIDENCE);
  if (ev) {
    return { phaseReached: 'test_exec', phaseMarkerMatched: false, phaseEvidence: `evidence:${ev[0]}`, markerMissing: false };
  }

  // 3) 空 log = 进程尚未输出（合法地处于 image 拉取/构建阶段），非告警
  if (log.trim() === '') {
    return { phaseReached: 'image', phaseMarkerMatched: false, phaseEvidence: 'empty-log', markerMissing: false };
  }

  // 4) 非空但无任何可识别 marker/证据 → unknown + 强告警（防 marker 漂移静默累积）
  return { phaseReached: 'unknown', phaseMarkerMatched: false, phaseEvidence: 'no-recognizable-marker', markerMissing: true };
}
