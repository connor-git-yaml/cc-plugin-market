/**
 * F189 prototype —— 点锚路线（Fiberplane Drift 式）：link 建锚 + check 验锚。
 *
 * link：引用 → 解析 symbol id → symbol 级指纹 → Anchor（lock 一行）
 * check：重建 graph + 重算指纹比对 → fresh/stale/orphaned/...（spec FR-004/005/010）
 */
import path from 'node:path';
import { computeSymbolFingerprint } from './fingerprint.js';
import { buildGraphFromFiles, resolveRef, type MinimalGraph } from './resolve.js';
import type { Anchor, AnchorCheckResult, AnchorStatus, DriftReport } from './types.js';

/** 引用输入（FR-011 显式契约） */
export interface ReferenceInput {
  ref: string;
  docPath: string;
  line: number;
}

function graphHasSymbols(graph: MinimalGraph): boolean {
  return graph.nodes.some((n) => n.kind === 'symbol');
}

function symbolExists(graph: MinimalGraph, symbolId: string): boolean {
  return graph.nodes.some((n) => n.id === symbolId);
}

/** link：对每条引用建锚 */
export async function link(
  references: ReferenceInput[],
  absFiles: string[],
  projectRoot: string,
): Promise<Anchor[]> {
  const graph = await buildGraphFromFiles(absFiles, projectRoot);
  const anchors: Anchor[] = [];

  for (const input of references) {
    const base: Anchor = {
      ref: input.ref,
      docPath: input.docPath,
      line: input.line,
      symbolId: null,
      resolvedFrom: input.ref,
      fingerprint: null,
      status: 'unresolved',
    };

    if (!graphHasSymbols(graph)) {
      anchors.push({ ...base, status: 'graph-unavailable', reason: 'graph 无 symbol 节点' });
      continue;
    }

    const resolved = resolveRef(input.ref, graph, projectRoot);
    if (resolved.status === 'ambiguous') {
      anchors.push({ ...base, status: 'ambiguous', candidates: resolved.candidates, reason: '多候选，不自动绑' });
      continue;
    }
    if (resolved.status === 'unresolved' || resolved.symbolId === null) {
      anchors.push({ ...base, status: 'unresolved', reason: 'symbol 未解析' });
      continue;
    }

    const relPath = resolved.symbolId.slice(0, resolved.symbolId.indexOf('::'));
    const absPath = path.join(projectRoot, relPath);
    const fp = await computeSymbolFingerprint(resolved.symbolId, absPath);
    if (fp.reason !== 'ok' || fp.fingerprint === null) {
      anchors.push({
        ...base,
        symbolId: resolved.symbolId,
        matchKind: resolved.matchKind,
        status: 'fingerprint-unavailable',
        reason: `指纹不可用：${fp.reason}`,
      });
      continue;
    }

    anchors.push({
      ...base,
      symbolId: resolved.symbolId,
      matchKind: resolved.matchKind,
      fingerprint: fp.fingerprint,
      status: 'fresh',
    });
  }

  return anchors;
}

function emptySummary(): Record<AnchorStatus, number> {
  return {
    fresh: 0,
    stale: 0,
    orphaned: 0,
    ambiguous: 0,
    unresolved: 0,
    'fingerprint-unavailable': 0,
    'graph-unavailable': 0,
  };
}

/** check：对已存锚重算指纹比对 */
export async function check(
  anchors: Anchor[],
  absFiles: string[],
  projectRoot: string,
): Promise<DriftReport> {
  const graph = await buildGraphFromFiles(absFiles, projectRoot);
  const summary = emptySummary();
  const results: AnchorCheckResult[] = [];
  const graphDown = !graphHasSymbols(graph);

  for (const anchor of anchors) {
    let status: AnchorStatus = anchor.status;
    let actualFingerprint: string | null = null;
    let reason = anchor.reason;

    if (graphDown) {
      status = 'graph-unavailable';
      reason = 'graph 整体不可用';
    } else if (anchor.symbolId === null) {
      // 建锚时就没解析的，沿用原状态（ambiguous/unresolved）
      status = anchor.status === 'fresh' ? 'unresolved' : anchor.status;
    } else if (!symbolExists(graph, anchor.symbolId)) {
      status = 'orphaned';
      reason = 'symbol 在当前 graph 中已不存在';
    } else {
      const relPath = anchor.symbolId.slice(0, anchor.symbolId.indexOf('::'));
      const absPath = path.join(projectRoot, relPath);
      const fp = await computeSymbolFingerprint(anchor.symbolId, absPath);
      if (fp.reason !== 'ok' || fp.fingerprint === null) {
        status = 'fingerprint-unavailable';
        reason = `指纹不可用：${fp.reason}`;
      } else {
        actualFingerprint = fp.fingerprint;
        if (fp.fingerprint === anchor.fingerprint) {
          status = 'fresh';
          reason = undefined;
        } else {
          status = 'stale';
          reason = '指纹失配：symbol 自身已变化';
        }
      }
    }

    summary[status] += 1;
    results.push({
      ...anchor,
      status,
      reason,
      expectedFingerprint: anchor.fingerprint,
      actualFingerprint,
    });
  }

  // 退出码（语义：2=无法验证 > 1=已确认 drift > 0=干净）：
  //   - graph-unavailable / fingerprint-unavailable → 2（「验证无法进行」，CI 不得误读为通过；Codex WARNING-3）
  //   - stale / orphaned → 1（已确认 drift，可行动）
  //   - 其余 → 0
  // 确认型 drift（stale/orphaned）优先于 can't-verify，避免被 fingerprint-unavailable 掩盖：
  //   先判 graph 整体不可用，再判确认型 drift，最后判单锚无法验证。
  const cannotVerify = summary['graph-unavailable'] > 0 || summary['fingerprint-unavailable'] > 0;
  let exitCode: 0 | 1 | 2 = 0;
  if (summary['graph-unavailable'] > 0) {
    exitCode = 2;
  } else if (summary.stale > 0 || summary.orphaned > 0) {
    exitCode = 1;
  } else if (summary['fingerprint-unavailable'] > 0) {
    exitCode = 2;
  }

  return { anchors: results, summary, degraded: graphDown || cannotVerify, exitCode };
}
