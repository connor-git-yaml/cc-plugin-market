#!/usr/bin/env node
/**
 * F289 · SubagentStop 侧 sidechain fix 展开检测器（采集器，非阻断型）。
 *
 * 职责：读 SubagentStop payload → 形状守卫 → 单趟扫子代理 transcript（`agent_transcript_path`）找 `spec-driver-fix`
 * 展开 → 命中即在 `.fix-compliance-state` 家族落**会话键控标记**（session_id + agent_id）→ 主 Stop 判定器读到本会话标记
 * 即按 Tier 2 续做合同执法（检测与执法分离，用户拍板；显式否决 SubagentStop 直接 exit 2）。
 *
 * 纪律（与 ledger-writer / post-tool-use-ledger.sh 同构）：
 *   - **恒 exit 0、零 stdout/stderr**：任何路径（方言 payload / transcript 缺席 / 超限 / 抛错）都静默；失败可观测性只进同目录
 *     `.sidechain-selfdiag.jsonl`（它自己失败则彻底静默）。
 *   - **不做在途判定**（T-2 陷阱：SubagentStop 语境下 `background_tasks` 含触发者自身）。
 *   - **单趟**：`detectFixSkillExpansion` 只调一次（F257：该正则有 O(K×N) 诱饵退化前科，本 CLI 是新增扫描面）；
 *     transcript 上限沿用 `MAX_TRANSCRIPT_BYTES`（20MB），超限跳过并记 selfdiag。
 *   - 形状守卫：`session_id` / `agent_transcript_path` 非空字符串；`agent_id` 缺席或非字符串按空串（P-12 实测 `agent_type` 可为空串）。
 *     Codex / 异构 payload 不满足即静默跳过，零落盘。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { readTranscriptEntries, writeSidechainMarker, readStdinSync, sanitizeSessionId } from './fix-compliance-io.mjs';
import { detectFixSkillExpansion, resolveFeatureDirCandidate } from './fix-compliance-core.mjs';
import { isSpecDriverProject } from './ledger-writer.mjs';
import { isInvokedDirectly } from './is-invoked-directly.mjs';

const SELFDIAG_BASENAME = '.sidechain-selfdiag.jsonl';

/** payload 是否具备 Claude SubagentStop 最小形状；否则按 Codex 等方言静默跳过 */
export function isSubagentStopShape(payload) {
  return (
    payload !== null && typeof payload === 'object'
    && typeof payload.session_id === 'string' && payload.session_id.length > 0
    && typeof payload.agent_transcript_path === 'string' && payload.agent_transcript_path.length > 0
  );
}

function appendSelfdiag(projectRoot, record) {
  try {
    const dir = path.join(projectRoot, '.specify', 'runs', '.fix-compliance-state');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, SELFDIAG_BASENAME), `${JSON.stringify({ recordedAt: new Date().toISOString(), ...record })}\n`);
  } catch {
    // 自诊断自身失败 → 彻底静默
  }
}

/**
 * @returns {{ ok:boolean, reason:string, markerPath?:string|null }} —— 仅供测试 / 调用方观察，CLI 形态恒 exit 0
 */
export function recordSidechainFixMarker(projectRoot, payload) {
  if (!isSubagentStopShape(payload)) return { ok: false, reason: 'dialect-skip' };
  // 🔴 对抗复审 A-C4：项目闸置于任何 selfdiag / marker 写之前——否则每个子代理停止都会在**非 spec-driver 项目**
  // 凭空创建 .specify/runs/.fix-compliance-state/（与 F270 采集器 CRITICAL-2 同型；复用 ledger-writer 同一判据）。
  if (!isSpecDriverProject(projectRoot)) return { ok: false, reason: 'not-spec-driver-project' };
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : '';
  const { entries, diagnostics } = readTranscriptEntries(payload.agent_transcript_path);
  if (diagnostics.length > 0) {
    appendSelfdiag(projectRoot, { reason: 'agent-transcript-unavailable', diagnostics, sessionId: sanitizeSessionId(payload.session_id), agentId: sanitizeSessionId(agentId) });
    return { ok: false, reason: 'agent-transcript-unavailable' };
  }
  const anchor = detectFixSkillExpansion(entries, { requireMeta: true });   // 🔴 单趟 + requireMeta（B-C1：父 prompt 引用展开字面 isMeta=false 不算子代理真展开）
  if (anchor.latestFixLineIndex === null) return { ok: true, reason: 'no-fix-expansion' };
  const candidate = resolveFeatureDirCandidate(entries, anchor.latestFixLineIndex);
  const written = writeSidechainMarker(projectRoot, {
    sessionId: payload.session_id,
    agentId,
    agentType: typeof payload.agent_type === 'string' ? payload.agent_type : '',
    fixLineIndex: anchor.latestFixLineIndex,
    candidatePath: candidate.ambiguous ? null : candidate.path,
  });
  if (!written.ok) {
    appendSelfdiag(projectRoot, { reason: 'marker-write-failed', errors: written.errors, sessionId: sanitizeSessionId(payload.session_id) });
    return { ok: false, reason: 'marker-write-failed' };
  }
  return { ok: true, reason: 'marker-written', markerPath: written.path };
}

export function main(argv, stdinRaw) {
  let projectRoot = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--project-root' && typeof argv[i + 1] === 'string') { projectRoot = argv[i + 1]; i += 1; }
  }
  try {
    const raw = typeof stdinRaw === 'string' ? stdinRaw : readStdinSync();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { payload = null; }
    recordSidechainFixMarker(projectRoot, payload);
  } catch {
    // 任何异常都不得让 hook 产生噪声（C-10：PostToolUse/SubagentStop 非零会向 agent 上下文注入 hook blocking error）
  }
  return 0;
}

if (isInvokedDirectly(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
