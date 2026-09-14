#!/usr/bin/env node
/**
 * check-fr-matrix.mjs — plan.md 覆盖矩阵的两项机械核对（M11 簇④ 第 3 / 4 项；对抗审查 C-1 / C-2 / W-6 / W-7 / W-8 / I-2 / I-3 后重写）
 *
 *   constitution <plan.md> [--json]
 *     Constitution Check 一节里引用的 FR 编号必须 ∈ `## FR → Phase 覆盖矩阵` **已登记**集合（矩阵表任一行的首格编号，
 *     不论认领状态）。此前只是散文要求（agents/plan.md），引用一个矩阵里没有的 FR 无人能机械发现。
 *     章节缺席（Constitution / 矩阵）⇒ 判不出按不通过：`passed:false` + `sectionMissing` 指名——接线方按 `passed === false`
 *     判 VIOLATION，**不得**只看 `unclaimed` 非空（该分支 unclaimed 恒空，对抗审查 C-1）。
 *
 *   verify-gaps <spec.md> <plan.md> [--json]
 *     verify 的「补登」清单 = spec 抽出的 FR 集合 − 矩阵 **Phase 已认领** 集合 − 约束型行（无落点、按核验方式核）。
 *     认领读的是矩阵的认领列（表头含 `Phase` / `认领`）：`**C**` 之类是认领；`移交 F27x` 是**移交（未完成态，不是裁剪）**；
 *     `（未认领 ⇒ 裁剪）` 是裁剪；`—` 是约束型。首格允许多个编号（`FR-003 ~ FR-005` 区间展开、`[FR-006](#…)`、`FR-008 / FR-009`、
 *     `FR-010,FR-011`、反引号、`FR-007（部分）`）。只认矩阵章节里的**第一张表**，讨论用子表不算认领。
 *     本命令只产清单不判定（exit 0），判定权仍在 verify 的合并律。
 *
 * 章节标题按「去掉 `N. ` 编号前缀」后匹配：矩阵须精确 `FR → Phase 覆盖矩阵`（`… · 冻结后修订记录` 不算）；Constitution
 * 章节以 `Constitution` 开头即算（`Constitution Check（简要）` / `Constitution Re-check (Post-Design)`）。
 * 用法错误 / 文件不存在 / 不是文件 → exit 2。FR 编号语法与 sync 引擎同源（`FR_ID_SOURCE`，不再手抄）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';
import { parseSpecContent, FR_ID_SOURCE } from './sync-merge-engine.mjs';

const MATRIX_HEADING = /^FR → Phase 覆盖矩阵$/;
const CONSTITUTION_HEADING = /^Constitution\b/i;
const CUT_REGISTRY_HEADING = /^裁剪登记/;
const FR_ID_GLOBAL = new RegExp(`\\b${FR_ID_SOURCE}\\b`, 'g');
const FR_RANGE = new RegExp(`\\b(FR-)(\\d{1,3})\\s*[~～]\\s*(?:FR-)?(\\d{1,3})\\b`, 'g');

/** 去掉 `N. ` 编号前缀后的 H2 标题 */
function normalizeHeading(line) {
  const m = /^##\s+(.*?)\s*$/.exec(line);
  return m ? m[1].replace(/^\d+\.\s*/, '') : null;
}

/**
 * 取匹配 H2 章节正文（标题行到下一个 `## ` 之前）；多次命中取第一处。
 * @param {string} markdown
 * @param {RegExp} headingRe
 * @returns {string|null}
 */
function sectionBody(markdown, headingRe) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => { const h = normalizeHeading(line); return h !== null && headingRe.test(h); });
  if (start === -1) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/** 去掉 fenced code、引用块与行内代码后的正文（散文里的 FR 引用才算引用；`grep -c 'FR-0'` 这种命令原文不算） */
function proseOnly(body) {
  let inFence = false;
  const out = [];
  for (const line of body.split('\n')) {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) { inFence = !inFence; continue; }
    if (inFence || /^\s*>/.test(line)) continue;
    out.push(line.replace(/`[^`\n]*`/g, ' '));
  }
  return out.join('\n');
}

/** 单元格里的全部 FR 编号：区间展开 + 逐个匹配（链接 / 斜线 / 逗号 / 反引号 / 尾注都只是分隔） */
function idsInCell(cell) {
  const ids = new Set();
  const expanded = cell.replace(FR_RANGE, (_whole, prefix, from, to) => {
    const width = from.length;
    const a = Number(from); const b = Number(to);
    const parts = [];
    if (b >= a && b - a <= 200) for (let n = a; n <= b; n += 1) parts.push(`${prefix}${String(n).padStart(width, '0')}`);
    return parts.join(' ');
  });
  for (const m of expanded.matchAll(FR_ID_GLOBAL)) ids.add(m[0]);
  return [...ids];
}

function splitCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

const CLAIM_HEADER = /phase|认领/i;
/** 认领列取值分类 */
function classifyClaim(cell) {
  const text = cell.replace(/\*/g, '').trim();
  if (text === '' || /^[—–-]+$/.test(text) || /^n\/?a$/i.test(text)) return 'constraint';
  if (/移交/.test(text)) return 'handed-over';
  if (/未认领|裁剪/.test(text)) return 'cut';
  return 'claimed';
}

/**
 * 解析矩阵章节里的第一张表。
 * @returns {{ matrixMissing: boolean, claimColumnMissing: boolean, rows: Array<{ ids: string[], state: string, cell: string }> }}
 */
export function parseCoverageMatrix(planMarkdown) {
  const body = sectionBody(planMarkdown, MATRIX_HEADING);
  if (body === null) return { matrixMissing: true, claimColumnMissing: true, rows: [] };
  const lines = body.split('\n');
  const rows = [];
  let claimIndex = null;
  let claimColumnMissing = true;
  let inTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const isRow = /^\s*\|/.test(line);
    if (!inTable) {
      if (!isRow) continue;
      const next = lines[i + 1] ?? '';
      if (!/^\s*\|\s*:?-{2,}/.test(next)) continue;   // 表头须紧跟分隔行
      const header = splitCells(line);
      if (!/\bFR\b/i.test(header[0] ?? '')) continue;   // 首列不是 FR 的表不是矩阵
      const idx = header.findIndex((h) => CLAIM_HEADER.test(h));
      claimIndex = idx === -1 ? null : idx;
      claimColumnMissing = idx === -1;
      inTable = true;
      i += 1;   // 跳过分隔行
      continue;
    }
    if (!isRow) break;   // 第一张表结束：讨论用子表不算认领
    const cells = splitCells(line);
    const ids = idsInCell(cells[0] ?? '');
    if (ids.length === 0) continue;
    const cell = claimIndex === null ? '' : (cells[claimIndex] ?? '');
    rows.push({ ids, state: claimIndex === null ? 'claimed' : classifyClaim(cell), cell });
  }
  return { matrixMissing: false, claimColumnMissing, rows };
}

/**
 * 矩阵 **Phase 已认领** 集合（Set），附加：matrixMissing / claimColumnMissing / registered（任一行出现的编号）/
 * constraints / handedOver / cutInMatrix。
 * @param {string} planMarkdown
 */
export function collectMatrixClaimedFRs(planMarkdown) {
  const matrix = parseCoverageMatrix(planMarkdown);
  const claimed = new Set();
  const registered = new Set();
  const constraints = new Set();
  const handedOver = new Set();
  const cutInMatrix = new Set();
  for (const row of matrix.rows) {
    for (const id of row.ids) {
      registered.add(id);
      if (row.state === 'claimed') claimed.add(id);
      else if (row.state === 'constraint') constraints.add(id);
      else if (row.state === 'handed-over') handedOver.add(id);
      else if (row.state === 'cut') cutInMatrix.add(id);
    }
  }
  return Object.assign(claimed, { matrixMissing: matrix.matrixMissing, claimColumnMissing: matrix.claimColumnMissing, registered, constraints, handedOver, cutInMatrix });
}

/**
 * Constitution 一节散文里引用的全部 FR 编号（fenced code / 引用块 / 行内代码不算）；章节缺席返回 null。
 * @param {string} planMarkdown
 * @returns {Set<string>|null}
 */
export function collectConstitutionCheckFRs(planMarkdown) {
  const body = sectionBody(planMarkdown, CONSTITUTION_HEADING);
  if (body === null) return null;
  return new Set([...proseOnly(body).matchAll(FR_ID_GLOBAL)].map((m) => m[0]));
}

/**
 * @param {string} planMarkdown
 * @returns {{ passed: boolean, sectionMissing: null|'constitution'|'matrix', referenced: string[], claimed: string[], unclaimed: string[], reason: string }}
 */
export function checkConstitutionReferences(planMarkdown) {
  const referencedSet = collectConstitutionCheckFRs(planMarkdown);
  const matrix = collectMatrixClaimedFRs(planMarkdown);
  const registered = [...matrix.registered].sort();
  if (referencedSet === null) {
    return { passed: false, sectionMissing: 'constitution', referenced: [], claimed: registered, unclaimed: [], reason: 'plan.md 缺少 Constitution 章节（`## Constitution Check` 或 `## N. Constitution …`；判不出按不通过）' };
  }
  if (matrix.matrixMissing) {
    return { passed: false, sectionMissing: 'matrix', referenced: [...referencedSet].sort(), claimed: [], unclaimed: [...referencedSet].sort(), reason: 'plan.md 缺少「## FR → Phase 覆盖矩阵」章节，引用的 FR 无从核对登记' };
  }
  const unclaimed = [...referencedSet].filter((id) => !matrix.registered.has(id)).sort();
  return {
    passed: unclaimed.length === 0,
    sectionMissing: null,
    referenced: [...referencedSet].sort(),
    claimed: registered,
    unclaimed,
    reason: unclaimed.length === 0
      ? `Constitution 引用的 ${referencedSet.size} 个 FR 全部已登记在覆盖矩阵`
      : `Constitution 引用了矩阵里没有的 FR：${unclaimed.join(', ')}`,
  };
}

function collectCutRegistryFRs(planMarkdown) {
  const body = sectionBody(planMarkdown, CUT_REGISTRY_HEADING);
  return new Set(body === null ? [] : [...proseOnly(body).matchAll(FR_ID_GLOBAL)].map((m) => m[0]));
}

/**
 * @param {string} specPath spec.md 路径（抽取口径与 sync 引擎同源）
 * @param {string} planMarkdown
 */
export function computeVerifyGaps(specPath, planMarkdown) {
  const parsed = parseSpecContent(specPath);
  const specFRs = [...new Set((parsed.requirements ?? []).map((fr) => fr.id))].sort();
  const matrix = collectMatrixClaimedFRs(planMarkdown);
  const cutSet = new Set([...collectCutRegistryFRs(planMarkdown), ...matrix.cutInMatrix]);
  const gaps = specFRs.filter((id) => !matrix.has(id) && !matrix.constraints.has(id));
  return {
    matrixMissing: matrix.matrixMissing,
    claimColumnMissing: matrix.claimColumnMissing,
    // 对抗审查 W-8：spec 抽出 0 条不是「没有缺口」，是抽取面为空（文件是目录 / 空文件 / 写法不在抽取面）——显式标记
    specEmpty: specFRs.length === 0,
    specFRs,
    claimed: [...matrix].sort(),
    constraints: [...matrix.constraints].sort(),
    handedOver: specFRs.filter((id) => matrix.handedOver.has(id)),
    gaps,
    registeredAsCut: gaps.filter((id) => cutSet.has(id)),
    unclaimedAndUncut: gaps.filter((id) => !cutSet.has(id)),
  };
}

function readOrExit(filePath, label) {
  const resolved = path.resolve(filePath);
  let stat = null;
  try { stat = fs.statSync(resolved); } catch { stat = null; }
  if (stat === null || !stat.isFile()) {
    process.stderr.write(`${label} 不存在或不是文件: ${resolved}\n`);
    process.exit(2);
  }
  return resolved;
}

function usage() {
  process.stderr.write([
    '用法:',
    '  check-fr-matrix.mjs constitution <plan.md> [--json]',
    '  check-fr-matrix.mjs verify-gaps <spec.md> <plan.md> [--json]',
    '',
  ].join('\n'));
  process.exit(2);
}

function main(argv) {
  const json = argv.includes('--json');
  const positional = argv.filter((token) => !token.startsWith('--'));
  const [command, first, second] = positional;

  if (command === 'constitution' && first) {
    const planPath = readOrExit(first, 'plan.md');
    const result = checkConstitutionReferences(fs.readFileSync(planPath, 'utf-8'));
    process.stdout.write(json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${result.passed ? 'PASS' : 'FAIL'}: ${result.reason}\n`);
    process.exit(result.passed ? 0 : 1);
  }

  if (command === 'verify-gaps' && first && second) {
    const specPath = readOrExit(first, 'spec.md');
    const planPath = readOrExit(second, 'plan.md');
    const result = computeVerifyGaps(specPath, fs.readFileSync(planPath, 'utf-8'));
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const lines = [
        `spec FR ${result.specFRs.length} 个${result.specEmpty ? '（⚠️ 抽取面为空：spec 不是文件 / 空文件 / 需求不在抽取面，清单无意义）' : ''}，矩阵 Phase 已认领 ${result.claimed.length} 个、约束型 ${result.constraints.length} 个${result.matrixMissing ? '（矩阵章节缺席，全部按未认领）' : ''}${result.claimColumnMissing ? '（矩阵无认领列，按「有表行即认领」退化口径）' : ''}`,
        `补登清单（${result.gaps.length}）：${result.gaps.join(', ') || '无'}`,
        `  其中矩阵标「移交」（未完成态，不是裁剪）：${result.handedOver.join(', ') || '无'}`,
        `  其中已登记裁剪：${result.registeredAsCut.join(', ') || '无'}`,
        `  其中未认领且未登记裁剪（按合并律自动判「未实现」）：${result.unclaimedAndUncut.join(', ') || '无'}`,
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exit(0);
  }

  usage();
}

if (isInvokedDirectly(import.meta.url)) {
  main(process.argv.slice(2));
}
