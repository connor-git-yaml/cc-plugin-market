/**
 * Spec Drift —— `drift link` 侧的引用解析（FR-001 / FR-002 / FR-009a,d，plan §6.4）。
 *
 * 流程（每条 manifest 条目）：
 *   1. parseCanonicalSymbolId(ref) 解析 file-qualified ref；非 file-qualified → unresolved
 *   2. 扩展名不在首发八种 → unsupported-language（无任何 fallback 指纹路径）
 *   3. filePart 不在磁盘 → unresolved
 *   4. member（`Class.method`）→ 显式拒绝，fingerprint-unavailable
 *   5. 按 filePart 分组去重，每组一次 analyzeFiles → buildMinimalGraph（仅含该文件节点的
 *      「满足 query helper 读取需求的最小只读视图」）→ canonicalizeSymbolId / resolveSymbolFuzzy
 *   6. 命中后按 ExportSymbol 的 startLine/endLine 切片算指纹
 *
 * 依赖方向：resolve → dist-loader / fingerprint（均为叶子），
 * MUST NOT import spec-drift-check.mjs / spec-drift-core.mjs（plan §6.2）。
 *
 * 【实测边界】最小 graph 只含 ref 指定的那一个文件，因此 `resolveSymbolFuzzy` 的
 * 跨文件兜底不可用；且 levenshtein 层置信度上限 0.75 < auto-resolve floor 0.9，
 * 故实际可自动绑定的 matchKind 只有 `exact`，其余层只产生候选（多 → ambiguous，
 * 单 → unresolved）。这是 file-qualified ref 合同（FR-001）的直接推论，非缺陷。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDistModule } from './spec-drift-dist-loader.mjs';
import { resolveWithinProject } from './spec-drift-paths.mjs';
import {
  computeSymbolFingerprint,
  createSharedProject,
  hasSyntacticErrors,
  FINGERPRINT_VERSION,
  NORMALIZATION_PROFILE,
} from './spec-drift-fingerprint.mjs';

/**
 * 首发支持的八种扩展名，MUST 与仓内 `TsJsLanguageAdapter.extensions` 完全一致（N-3）。
 * 漏列 `.mts`/`.cts` 会把 adapter 能正常解析的 TS 文件误标 unsupported-language。
 */
export const SUPPORTED_EXTENSIONS = Object.freeze([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
]);

/** drift 脚本自身所在的包根（dist 编译产物的基准，与被检项目的 projectRoot 无关） */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** manifest 条目的字符串型必需字段（均 MUST 为非空字符串） */
const MANIFEST_STRING_FIELDS = ['id', 'ref', 'docPath'];

/**
 * 解析引用清单（FR-001：独立文件形态）。
 *
 * 当前仅支持 JSON（YAML 需引入新依赖，本 Feature 零新依赖约束下不做；
 * 任何扩展名都按 JSON 解析，失败即 manifest-parse-failed）。
 *
 * @returns {{ok:true, entries:object[]} | {ok:false, reason:string, detail?:string}}
 */
export function parseManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, reason: 'manifest-missing', detail: manifestPath };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      reason: 'manifest-parse-failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const entries = Array.isArray(parsed) ? parsed : parsed?.references;
  if (!Array.isArray(entries)) {
    return { ok: false, reason: 'manifest-parse-failed', detail: 'manifest 顶层不是数组，也无 references 数组' };
  }
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'manifest-invalid-entry', detail: `第 ${i} 条不是对象` };
    }
    // 逐字段类型校验，而非仅查存在性：数值 ref 会让下游 parseCanonicalSymbolId 抛
    // TypeError（CLI 吐栈），数值 id / 对象 docPath / 负数 line 则会被原样写进 lock，
    // 下次读取即判 lock-corrupt —— 等于工具自产损坏制品。
    for (const field of MANIFEST_STRING_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) {
        return { ok: false, reason: 'manifest-invalid-entry', detail: `第 ${i} 条缺字段 ${field}` };
      }
      const value = entry[field];
      if (typeof value !== 'string' || value.trim() === '') {
        return {
          ok: false,
          reason: 'manifest-invalid-entry',
          detail: `第 ${i} 条字段 ${field} 必须是非空字符串，收到 ${JSON.stringify(value)}`,
        };
      }
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'line')) {
      return { ok: false, reason: 'manifest-invalid-entry', detail: `第 ${i} 条缺字段 line` };
    }
    if (typeof entry.line !== 'number' || !Number.isInteger(entry.line) || entry.line < 1) {
      return {
        ok: false,
        reason: 'manifest-invalid-entry',
        detail: `第 ${i} 条 line 必须是正整数，收到 ${JSON.stringify(entry.line)}`,
      };
    }
  }
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      return { ok: false, reason: 'manifest-invalid-entry', detail: `manifest 内 id 重复：${entry.id}` };
    }
    ids.add(entry.id);
  }
  return { ok: true, entries };
}

/** FR-002：refresh 失败时**唯一**允许保留刷新前基线的两种状态 */
export const PRESERVABLE_REFRESH_STATUSES = Object.freeze(new Set(['ambiguous', 'unresolved']));

/** POSIX 化的项目相对路径 */
function toRelPosix(absFile, projectRoot) {
  return path.relative(projectRoot, absFile).split(path.sep).join('/');
}

/**
 * 从 skeleton 集构造「满足 query helper 读取需求的最小只读视图」（plan §6.4 / N-5）。
 *
 * query helper 实际只读 `nodes[].id`，因此不声称构造了结构完整的 GraphJSON。
 * node id 口径与生产 `deriveNodesFromSkeletons` 一致：`relPath` / `relPath::exportName`。
 */
export function buildMinimalGraph(skeletons, projectRoot) {
  const nodes = [];
  for (const skeleton of skeletons) {
    const rel = toRelPosix(skeleton.filePath, projectRoot);
    nodes.push({ id: rel, label: rel.split('/').pop() ?? rel, kind: 'module' });
    for (const exp of skeleton.exports ?? []) {
      nodes.push({ id: `${rel}::${exp.name}`, label: exp.name, kind: 'symbol' });
    }
  }
  return { nodes, links: [], metadata: { generatedBy: 'spec-drift-resolve' } };
}

/** symbol 节点 id 恒含 `::`；module 节点不含。锚点只接受 symbol，防误绑同名 module 路径 */
function isSymbolId(id) {
  return typeof id === 'string' && id.includes('::');
}

function makeResult(entry, patch) {
  return {
    id: entry.id,
    ref: entry.ref,
    docPath: entry.docPath,
    line: entry.line,
    resolvedFrom: entry.ref,
    symbolId: null,
    matchKind: null,
    fingerprint: null,
    fingerprintVersion: FINGERPRINT_VERSION,
    normalizationProfile: NORMALIZATION_PROFILE,
    ...patch,
  };
}

/**
 * 批量解析引用 → canonical symbolId + 指纹。
 *
 * @param {object[]} entries manifest 条目
 * @param {{projectRoot:string, distRoot?:string, refresh?:boolean, existingById?:object}} options
 * @returns {Promise<{reportStatus:'ok'|'graph-unavailable', reason?:string, results:object[]}>}
 */
export async function resolveReferences(entries, options) {
  const { projectRoot, distRoot = PACKAGE_ROOT, refresh = false, existingById = {} } = options;

  const distModules = await loadDistApis(distRoot);
  if (!distModules.ok) {
    return { reportStatus: 'graph-unavailable', reason: distModules.reason, results: [] };
  }
  const { analyzeFiles, bootstrapAdapters, canonicalizeSymbolId, resolveSymbolFuzzy, parseCanonicalSymbolId } =
    distModules.api;
  bootstrapAdapters();

  // 先做纯静态分流，把需要 analyzeFiles 的条目按 filePart 分组去重（plan §6.4 步骤 3）
  const pending = [];
  const results = [];
  const groups = new Map();

  for (const entry of entries) {
    const parts = parseCanonicalSymbolId(entry.ref);
    if (parts.symbolPart === undefined || parts.filePart === '') {
      results.push(
        makeResult(entry, {
          status: 'unresolved',
          reason: `ref 必须为 file-qualified 形式 <relPath>::<symbolName>，收到裸引用 "${entry.ref}"`,
        }),
      );
      continue;
    }
    const ext = path.extname(parts.filePart).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      results.push(
        makeResult(entry, {
          status: 'unsupported-language',
          reason: `扩展名 ${ext || '(无)'} 不在首发支持集合（${SUPPORTED_EXTENSIONS.join(' / ')}）`,
        }),
      );
      continue;
    }
    const contained = resolveWithinProject(projectRoot, parts.filePart);
    if (!contained.ok) {
      results.push(makeResult(entry, { status: 'unresolved', reason: contained.reason }));
      continue;
    }
    const absFile = contained.absPath;
    if (!fs.existsSync(absFile)) {
      results.push(
        makeResult(entry, { status: 'unresolved', reason: `引用文件不存在：${parts.filePart}` }),
      );
      continue;
    }
    if (parts.symbolPart.includes('.')) {
      results.push(
        makeResult(entry, {
          status: 'fingerprint-unavailable',
          reason: 'member 粒度锚点本期不支持，请锚定 top-level symbol',
        }),
      );
      continue;
    }
    pending.push({ entry, parts, absFile });
    if (!groups.has(absFile)) groups.set(absFile, []);
    groups.get(absFile).push({ entry, parts });
  }

  // canonical AST 指纹需要一棵真实语法树：整批建锚共享同一个 ts-morph Project（性能）。
  // 该 Project 同时承担 parser-health 判定，故 MUST 在解析循环之前创建。
  const project = createSharedProject();

  // 每个唯一文件只解析一次
  const analyzed = new Map();
  for (const absFile of groups.keys()) {
    try {
      const skeletons = await analyzeFiles([absFile]);
      const skeleton = skeletons[0] ?? null;
      analyzed.set(absFile, {
        skeleton,
        graph: skeleton ? buildMinimalGraph([skeleton], projectRoot) : null,
        source: fs.readFileSync(absFile, 'utf8'),
        // W-2：link 与 check MUST 共用同一个 parser-health helper。此前 link 直接分析并
        // 算指纹，对语法损坏文件返回 status:"ok" 并把锚写入 lock，紧接着 check 又把同一
        // 文件判 parser-degrade —— 两条命令对同一输入给出互相矛盾的结论。
        syntax: hasSyntacticErrors(project, absFile, { refresh: true }),
      });
    } catch (err) {
      analyzed.set(absFile, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const { entry, parts, absFile } of pending) {
    results.push(
      resolveOne({
        entry,
        parts,
        absFile,
        analyzed,
        canonicalizeSymbolId,
        resolveSymbolFuzzy,
        projectRoot,
        project,
      }),
    );
  }

  // W1 / US1-AS5：refresh 时若重新解析落 ambiguous/unresolved，保留刷新前最后一次已知良好基线。
  //
  // 两条硬约束（FR-002）：
  //  (a) 仅 `ambiguous` / `unresolved` 允许保留；其余失败态（如 unsupported-language /
  //      parser-degrade）MUST NOT 保留，否则该锚会被"半刷新"成失败状态。
  //  (b) 保留时写回**旧 anchor 的完整十字段原记录**，不与新解析结果拼接。混合绑定
  //      （新 ref/docPath/line + 旧 symbolId/fingerprint）会让下次 check 只看旧 symbolId
  //      判 fresh，从而掩盖刷新失败。
  const finalResults = results.map((result) => {
    if (!refresh) return result;
    if (!PRESERVABLE_REFRESH_STATUSES.has(result.status)) return result;
    const baseline = existingById[result.id];
    if (!baseline || !baseline.symbolId || !baseline.fingerprint) return result;
    return {
      // 报告面（非持久化）保留新一次解析的判定与原因
      status: result.status,
      reason: result.reason,
      candidates: result.candidates,
      preserved: true,
      // 持久化面：整条沿用旧记录，绝不混合新旧字段
      id: baseline.id,
      ref: baseline.ref,
      docPath: baseline.docPath,
      line: baseline.line,
      symbolId: baseline.symbolId,
      fingerprint: baseline.fingerprint,
      fingerprintVersion: baseline.fingerprintVersion,
      normalizationProfile: baseline.normalizationProfile,
      resolvedFrom: baseline.resolvedFrom,
      matchKind: baseline.matchKind,
    };
  });

  // 保持与输入 entries 相同的顺序（分流阶段打乱了顺序）
  const order = new Map(entries.map((e, i) => [e.id, i]));
  finalResults.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { reportStatus: 'ok', results: finalResults };
}

/** 加载 drift 所需的全部 dist API；任一失败即 graph-unavailable */
async function loadDistApis(distRoot) {
  const specs = [
    ['dist/core/ast-analyzer.js', ['analyzeFiles']],
    ['dist/adapters/index.js', ['bootstrapAdapters']],
    ['dist/knowledge-graph/query-helpers.js', ['canonicalizeSymbolId', 'resolveSymbolFuzzy']],
    ['dist/knowledge-graph/relativize.js', ['parseCanonicalSymbolId']],
  ];
  const api = {};
  for (const [relPath, names] of specs) {
    const loaded = await loadDistModule(distRoot, relPath);
    if (!loaded.ok) {
      return { ok: false, reason: `${loaded.reason}: ${loaded.detail}` };
    }
    for (const name of names) {
      if (typeof loaded.mod[name] !== 'function') {
        return { ok: false, reason: `dist-load-failed: ${relPath} 未导出 ${name}` };
      }
      api[name] = loaded.mod[name];
    }
  }
  return { ok: true, api };
}

function resolveOne({ entry, parts, absFile, analyzed, canonicalizeSymbolId, resolveSymbolFuzzy, projectRoot, project }) {
  const state = analyzed.get(absFile);
  if (!state || state.error || !state.skeleton) {
    return makeResult(entry, {
      status: 'fingerprint-unavailable',
      reason: `目标文件解析失败：${state?.error ?? 'analyzeFiles 未返回 skeleton'}`,
    });
  }

  // W-2：parser-health 闸门 MUST 早于符号解析与指纹计算。语法损坏的文件上，ts-morph 的
  // 错误恢复仍会产出一棵「看起来能算」的树，link 据此写入的锚是伪锚——下一次 check 会
  // 对同一文件判 parser-degrade，形成 link/check 自相矛盾。
  const syntax = state.syntax;
  if (!syntax || !syntax.ok) {
    return makeResult(entry, {
      status: 'parser-degrade',
      reason: `语法诊断读取失败：${syntax?.reason ?? '未执行 parser-health 判定'}`,
    });
  }
  if (syntax.hasErrors) {
    return makeResult(entry, {
      status: 'parser-degrade',
      reason: `目标文件存在语法错误：${entry.ref}`,
    });
  }

  const graph = state.graph;
  let symbolId = null;
  let matchKind = null;

  const canon = canonicalizeSymbolId(entry.ref, graph, { projectRoot });
  if (canon.reason === 'ok' && isSymbolId(canon.canonicalId)) {
    symbolId = canon.canonicalId;
    matchKind = 'exact';
  } else {
    const fuzzy = resolveSymbolFuzzy(graph, entry.ref, { projectRoot });
    const top = fuzzy.candidates[0];
    if (fuzzy.autoResolved && fuzzy.candidates.length === 1 && isSymbolId(top.id)) {
      symbolId = top.id;
      matchKind = top.matchKind;
    } else if (fuzzy.candidates.length > 1) {
      return makeResult(entry, {
        status: 'ambiguous',
        reason: `引用命中多个候选（${fuzzy.candidates.length}），不自动绑定`,
        candidates: fuzzy.candidates.slice(0, 3).map((c) => c.id),
      });
    } else {
      return makeResult(entry, {
        status: 'unresolved',
        reason: '引用未能解析到唯一高置信 symbol',
        candidates: fuzzy.candidates.slice(0, 3).map((c) => c.id),
      });
    }
  }

  const symbolName = symbolId.slice(symbolId.indexOf('::') + 2);
  const exp = (state.skeleton.exports ?? []).find((e) => e.name === symbolName);
  if (!exp) {
    return makeResult(entry, {
      status: 'unresolved',
      reason: `symbol ${symbolName} 不在目标文件的导出集合中`,
    });
  }

  // 建锚与检测 MUST 走同一条 canonical AST 路径，否则新建的锚下一次 check 必判 stale
  const computed = computeSymbolFingerprint({
    project: project ?? createSharedProject(),
    absFilePath: absFile,
    sourceText: state.source,
    exportName: symbolName,
    expStartLine: exp.startLine,
  });
  if (!computed.ok) {
    return makeResult(entry, {
      status: 'fingerprint-unavailable',
      symbolId,
      matchKind,
      reason: `无法在本地 AST 上定位该导出声明并计算指纹（${computed.reason}）`,
    });
  }

  return makeResult(entry, { status: 'ok', symbolId, matchKind, fingerprint: computed.fingerprint });
}
