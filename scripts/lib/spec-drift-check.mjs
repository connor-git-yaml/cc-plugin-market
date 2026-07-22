/**
 * Spec Drift —— `drift check`（FR-004/005/009a/011/012，plan §9）。
 *
 * 核心不变量：**只按 lock 内已持久化的 canonical symbolId 做精确匹配**，
 * MUST NOT 调用 canonicalizeSymbolId / resolveSymbolFuzzy——模糊解析只允许
 * 由 `drift link --refresh` 显式触发。否则「同名新 symbol」会被洗成 fresh、
 * 真正的 orphaned 被掩盖（FR-004）。
 *
 * 依赖方向：check → dist-loader / fingerprint（均为叶子）；
 * MUST NOT import spec-drift-resolve.mjs（防把 fuzzy 解析引回 check 链路）。
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
  locateExportedNodes,
  FINGERPRINT_VERSION,
  NORMALIZATION_PROFILE,
} from './spec-drift-fingerprint.mjs';

// `locateExportedNodes` 的实现落在 fingerprint（叶子）而非 check：它操作 ts-morph Node，
// 且 link 链路（resolve.mjs）同样需要，若放在 check 会迫使 resolve → check 产生横向 import，
// 违反 plan §6.2「check / resolve 不互相 import」。此处 re-export 以保持 T032 的对外契约。
export { locateExportedNodes };

/**
 * `locateExportedNodes` / `computeSymbolFingerprint` 的机器可读失败原因 → 人类可读说明。
 * 三者一律映射 anchor 级 `fingerprint-unavailable`（plan §7.3 C-3：禁止 declarations[0] 兜底）。
 */
const LOCATE_FAILURE_TEXT = Object.freeze({
  'node-locate-failed': '本地 AST 中找不到该导出声明（node-locate-failed），无法计算指纹',
  'node-locate-ambiguous':
    'analyzeFiles 与本地 AST 对目标声明的身份判断分叉（node-locate-ambiguous），拒绝基于错误节点产出结论',
  'reexport-unsupported':
    '该导出的全部声明都来自其他文件（reexport-unsupported），首发不定义跨文件指纹归属，请直接锚定声明所在文件',
  'parse-failed': '目标文件无法被 ts-morph 解析（parse-failed），无法计算指纹',
  'canonicalize-failed': 'canonical token 序列化过程异常（canonicalize-failed），无法计算指纹',
  'ast-traversal-limit':
    'AST 嵌套过深，遍历超出调用栈上限（ast-traversal-limit），无法计算指纹',
});

/** drift 脚本自身所在包根（dist 编译产物基准，与被检项目 projectRoot 无关） */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 首发支持的八种扩展名，MUST 与 `TsJsLanguageAdapter.extensions` 一致（N-3） */
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

/**
 * spec §状态矩阵的代码化投影（唯一权威表在 spec.md，此处逐行对齐）。
 *
 * priority：数字越小越先决定整体 exitCode（1 最高）。
 * repoCheck / repoCheckStrict：`repo:check` 两种模式下的严重度映射（C2 消费）。
 */
export const STATE_MATRIX = Object.freeze({
  'lock-corrupt': {
    machineCode: 'DRIFT_LOCK_CORRUPT',
    scope: 'report',
    exitCode: 3,
    priority: 1,
    repoCheck: 'error',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep:
      'lock 文件无法解析（JSON 语法错误 / schema 不兼容 / 缺失必需字段），先修复 `.specify/spec-drift.lock.json` 再继续',
  },
  'graph-unavailable': {
    machineCode: 'DRIFT_GRAPH_UNAVAILABLE',
    scope: 'report',
    exitCode: 2,
    priority: 2,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep: 'AST 分析环境不可用（dist 编译产物缺失或模块加载失败），运行 `npm run build` 后重跑',
  },
  stale: {
    machineCode: 'DRIFT_STALE',
    scope: 'anchor',
    exitCode: 1,
    priority: 3,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: false,
    nextStep:
      'AST 结构/token 已变化，确认 spec 引用是否仍准确：准确则 `drift link --refresh`，不准确则修订 spec 文案',
  },
  orphaned: {
    machineCode: 'DRIFT_ORPHANED',
    scope: 'anchor',
    exitCode: 1,
    priority: 3,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: false,
    nextStep:
      '被锚 symbol 已消失（删除/重命名，M9 不做 rename-follow），`drift unlink` 清理旧锚，如有替代 symbol 重新 `drift link`',
  },
  ambiguous: {
    machineCode: 'DRIFT_AMBIGUOUS',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep: '引用命中多个候选，在引用清单里改写为更精确的 `file::Symbol` 形式后重新 `drift link`',
  },
  unresolved: {
    machineCode: 'DRIFT_UNRESOLVED',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep:
      '引用未能解析到任何 symbol：裸 symbol 名需补全为 `file::Symbol` 形式；已是 file-qualified 则检查拼写或运行 `drift link --refresh`',
  },
  'fingerprint-unavailable': {
    machineCode: 'DRIFT_FINGERPRINT_UNAVAILABLE',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep:
      'symbol 已解析但取不到可用 span（含 member 粒度被拒绝、fingerprintVersion 不匹配两种子情形），reason 字段会指出具体原因与是否需要 relink',
  },
  'graph-stale': {
    machineCode: 'DRIFT_GRAPH_STALE',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep: '消费的 graph 制品早于当前工作树，重建 graph（`spectra batch --mode graph-only`）后重跑',
  },
  'unsupported-language': {
    machineCode: 'DRIFT_UNSUPPORTED_LANGUAGE',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep: '该语言本期不支持 symbol 级建锚（首发仅 TypeScript/JavaScript），等待语言支持扩展',
  },
  'parser-degrade': {
    machineCode: 'DRIFT_PARSER_DEGRADE',
    scope: 'anchor',
    exitCode: 2,
    priority: 4,
    repoCheck: 'warn',
    repoCheckStrict: 'error',
    degraded: true,
    nextStep: 'AST 解析失败（语法错误/编码问题），修复目标文件后重跑',
  },
  fresh: {
    machineCode: 'DRIFT_FRESH',
    scope: 'anchor',
    exitCode: 0,
    priority: 5,
    repoCheck: 'pass',
    repoCheckStrict: 'pass',
    degraded: false,
    nextStep: '无需操作',
  },
});

/** 把状态名填充成完整的锚级结果对象 */
function anchorResult(anchor, status, extra = {}) {
  const meta = STATE_MATRIX[status];
  return {
    id: anchor.id,
    ref: anchor.ref,
    docPath: anchor.docPath,
    line: anchor.line,
    symbolId: anchor.symbolId,
    status,
    machineCode: meta.machineCode,
    degraded: meta.degraded,
    nextStep: meta.nextStep,
    ...extra,
  };
}

/**
 * 混合优先级 exitCode（spec 状态矩阵「混合优先级计算规则」，W-4）。
 *
 * MUST 按分层顺序求值，**不得**按 anchors 数组出现顺序取首个非 fresh 项。
 * 特别地：report 级 `graph-unavailable` 优先级（2）高于 anchor 级 `stale`（3），
 * 两者共存时整体 exitCode 为 2 而非 1——不可验证优先于已确认 drift。
 */
export function computeReportExitCode(report) {
  const statuses = [];
  if (report.reportStatus && report.reportStatus !== 'ok') statuses.push(report.reportStatus);
  for (const anchor of report.anchors ?? []) statuses.push(anchor.status);

  let best = null;
  for (const status of statuses) {
    const meta = STATE_MATRIX[status];
    if (!meta) continue;
    if (best === null || meta.priority < best.priority) best = meta;
  }
  return best === null ? 0 : best.exitCode;
}

/**
 * 全状态零计数 summary（FR-015）：即使 0 条锚也 MUST 输出完整的 anchor 级状态键，
 * 消费方（`repo:check` / CI）才能无条件按固定键读数，而不必区分"空 lock"分支。
 */
export function summarize(anchors) {
  const summary = {};
  for (const status of Object.keys(STATE_MATRIX)) {
    if (STATE_MATRIX[status].scope === 'anchor') summary[status] = 0;
  }
  for (const anchor of anchors) {
    summary[anchor.status] = (summary[anchor.status] ?? 0) + 1;
  }
  return summary;
}

/**
 * 唯一的 DriftReport 构造器（W-1）。link / check / 报告级失败三条路径共用，
 * 避免各自手搓聚合字段导致 `degraded` 之类的字段被硬编码写错。
 *
 * `degraded` 语义：整份报告是否含"无法确证"的成分——报告级状态自身 degraded，
 * **或**任一锚 degraded。硬编码 false 会让 CI 误以为结论完全可信。
 */
export function buildReport({ reportStatus = 'ok', anchors = [], reason = undefined }) {
  const meta = reportStatus === 'ok' ? null : STATE_MATRIX[reportStatus];
  const report = {
    reportStatus,
    machineCode: meta?.machineCode,
    nextStep: meta?.nextStep,
    reason,
    degraded: (meta?.degraded ?? false) || anchors.some((a) => a.degraded === true),
    anchors,
    summary: summarize(anchors),
  };
  if (meta === null) {
    delete report.machineCode;
    delete report.nextStep;
  }
  if (reason === undefined) delete report.reason;
  report.exitCode = computeReportExitCode(report);
  return report;
}

function reportLevelFailure(status, reason) {
  return buildReport({ reportStatus: status, reason });
}

/** 加载 check 所需的 dist API（只需 analyzeFiles + bootstrapAdapters + parseCanonicalSymbolId） */
async function loadDistApis(distRoot) {
  const specs = [
    ['dist/core/ast-analyzer.js', ['analyzeFiles']],
    ['dist/adapters/index.js', ['bootstrapAdapters']],
    ['dist/knowledge-graph/relativize.js', ['parseCanonicalSymbolId']],
  ];
  const api = {};
  for (const [relPath, names] of specs) {
    const loaded = await loadDistModule(distRoot, relPath);
    if (!loaded.ok) return { ok: false, reason: `${loaded.reason}: ${loaded.detail}` };
    for (const name of names) {
      if (typeof loaded.mod[name] !== 'function') {
        return { ok: false, reason: `dist-load-failed: ${relPath} 未导出 ${name}` };
      }
      api[name] = loaded.mod[name];
    }
  }
  return { ok: true, api };
}

/**
 * 逐锚检测。
 *
 * @param {object[]} anchors lock.anchors
 * @param {{projectRoot:string, distRoot?:string}} options
 * @returns {Promise<object>} DriftReport
 */
export async function checkAnchors(anchors, options) {
  const { projectRoot, distRoot = PACKAGE_ROOT } = options;

  const dist = await loadDistApis(distRoot);
  if (!dist.ok) return reportLevelFailure('graph-unavailable', dist.reason);
  const { analyzeFiles, bootstrapAdapters, parseCanonicalSymbolId } = dist.api;
  bootstrapAdapters();

  // 按 symbolId 的 filePart 分组，每个唯一文件只解析一次（plan §9.1 / §11 性能）
  const groups = new Map();
  const results = [];
  const project = createSharedProject();

  for (const anchor of anchors) {
    const parts = parseCanonicalSymbolId(anchor.symbolId ?? '');
    if (parts.symbolPart === undefined || parts.filePart === '') {
      results.push(
        anchorResult(anchor, 'fingerprint-unavailable', {
          reason: `lock 内 symbolId 非 file-qualified 形式："${anchor.symbolId}"`,
        }),
      );
      continue;
    }
    const key = parts.filePart;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ anchor, parts });
  }

  for (const [filePart, members] of groups.entries()) {
    results.push(
      ...(await checkOneGroup({ filePart, members, projectRoot, analyzeFiles, project })),
    );
  }

  // 保持与输入 anchors 相同的顺序
  const order = new Map(anchors.map((a, i) => [a.id, i]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return buildReport({ anchors: results });
}

/** 竞态重读的最大尝试次数：文件在检测窗口内被持续改写时不无限重试 */
const MAX_ANALYSIS_ATTEMPTS = 3;

/**
 * 读取源码快照。
 *
 * MUST 捕获异常：analyzeFiles 之后的裸 `fs.readFileSync` 一旦抛出（并发删除 / EACCES /
 * EISDIR / I/O 错误），异常会一路穿透 checkAnchors → validateSpecDrift → repo:check，
 * 让整条治理链路吐栈而拿不到任何结构化结论。
 *
 * @returns {{ok:true, source:string} | {ok:false, missing:boolean, message:string}}
 */
function readSourceSnapshot(absFile) {
  try {
    return { ok: true, source: fs.readFileSync(absFile, 'utf8') };
  } catch (err) {
    const code = err?.code;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, missing: code === 'ENOENT', message: `${code ?? 'IO_ERROR'}: ${message}` };
  }
}

/** 组级（同一文件）检测：语言判定 → 文件存在性 → analyzeFiles → parser-health → 逐锚比对 */
async function checkOneGroup({ filePart, members, projectRoot, analyzeFiles, project }) {
  const ext = path.extname(filePart).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return members.map(({ anchor }) =>
      anchorResult(anchor, 'unsupported-language', {
        reason: `扩展名 ${ext || '(无)'} 不在首发支持集合（${SUPPORTED_EXTENSIONS.join(' / ')}）`,
      }),
    );
  }

  // lock 与引用清单同属用户可写输入：不做 containment 校验时 `../sibling/x.ts::Sym`
  // 会读到 projectRoot 之外的文件并被判 fresh。
  const contained = resolveWithinProject(projectRoot, filePart);
  if (!contained.ok) {
    return members.map(({ anchor }) =>
      anchorResult(anchor, 'fingerprint-unavailable', { reason: contained.reason }),
    );
  }

  const absFile = contained.absPath;
  if (!fs.existsSync(absFile)) {
    return members.map(({ anchor }) =>
      anchorResult(anchor, 'orphaned', { reason: `文件已删除：${filePart}` }),
    );
  }

  const outcome = await analyzeConsistentSnapshot({ absFile, filePart, analyzeFiles, project });
  if (!outcome.ok) {
    return members.map(({ anchor }) =>
      anchorResult(anchor, outcome.status, { reason: outcome.reason }),
    );
  }
  return members.map(({ anchor, parts }) =>
    checkOneAnchor({
      anchor,
      symbolName: parts.symbolPart,
      skeleton: outcome.skeleton,
      source: outcome.source,
      project,
      absFile,
    }),
  );
}

/** 快照读取失败 → 状态映射：ENOENT = 竞态删除（orphaned），其余 I/O 失败 = parser-degrade */
function snapshotFailure(snapshot, filePart) {
  return snapshot.missing
    ? { ok: false, status: 'orphaned', reason: `文件已删除（检测期竞态）：${filePart}` }
    : { ok: false, status: 'parser-degrade', reason: `读取源码失败（${snapshot.message}）：${filePart}` };
}

/**
 * 在**内容一致的快照**上完成 analyzeFiles + parser-health + 源码读取（TOCTOU 修复）。
 *
 * 问题：analyzeFiles 只接受路径、自己从磁盘读，无法注入内存快照；若随后另行
 * `readFileSync` 取源码，两次读取之间文件被改写时，**旧 skeleton 的行号 span 会被套到
 * 新源码上**，算出的指纹既非旧内容也非新内容——极端情况下甚至可能撞回 lock 里的旧指纹
 * 而误判 fresh，违反 FR-004 对"按即时解析内容判定"的一致性预期。
 *
 * 因此采用 read-before / analyze / read-after 的内容校验：前后两次读到的字节完全一致时
 * 才认为 skeleton 与 source 同源；不一致就整轮重试（有界 MAX_ANALYSIS_ATTEMPTS 次），
 * 仍不一致则显式降级为 parser-degrade，绝不用不一致的组合产出 fresh/stale 结论。
 *
 * 导出仅为让竞态用例可注入 analyzeFiles（真实竞态无法在测试里稳定复现）；
 * 生产路径只经由 checkOneGroup 调用。
 *
 * @returns {Promise<{ok:true, skeleton:object, source:string} | {ok:false, status:string, reason:string}>}
 */
export async function analyzeConsistentSnapshot({ absFile, filePart, analyzeFiles, project }) {
  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt += 1) {
    const before = readSourceSnapshot(absFile);
    if (!before.ok) return snapshotFailure(before, filePart);

    let skeleton;
    try {
      const skeletons = await analyzeFiles([absFile]);
      skeleton = skeletons[0];
    } catch (err) {
      // existsSync 之后仍可能被并发删除：ENOENT 属竞态删除而非解析失败（C-4）
      const message = err instanceof Error ? err.message : String(err);
      const isMissing = err?.code === 'ENOENT' || /not exist|ENOENT|FileNotFound/i.test(message);
      return isMissing
        ? { ok: false, status: 'orphaned', reason: `文件已删除（解析期竞态）：${filePart}` }
        : { ok: false, status: 'parser-degrade', reason: `analyzeFiles 抛出异常：${message}` };
    }
    if (!skeleton) {
      return { ok: false, status: 'parser-degrade', reason: 'analyzeFiles 未返回 skeleton' };
    }

    if (skeleton.parserUsed && skeleton.parserUsed !== 'ts-morph') {
      return {
        ok: false,
        status: 'parser-degrade',
        reason: `parser 回退至 ${skeleton.parserUsed}（非 ts-morph），无法保证 symbol span 可靠`,
      };
    }

    // 一致性闸门 MUST 紧跟 analyzeFiles：文件在此窗口内被删除时结论是 orphaned，
    // 若先做语法诊断会被 ts-morph 的 ENOENT 抢先降级成 parser-degrade（掩盖真实状态）。
    const after = readSourceSnapshot(absFile);
    if (!after.ok) return snapshotFailure(after, filePart);
    if (after.source !== before.source) continue; // 内容变了 → 整轮重来

    // 显式 parser-health 判定（plan §9.1 步骤 4）：
    // (a) 走了 tree-sitter fallback（上面已判）；(b) ts-morph 语法诊断非空。
    // ⚠️ ts-morph 采用错误恢复策略，普通语法错误**不抛异常**，因此 MUST NOT 只靠异常判定。
    // 重试轮 MUST 刷新 ts-morph 缓存，否则拿上一轮的旧文本做诊断。
    const syntax = hasSyntacticErrors(project, absFile, { refresh: attempt > 1 });
    if (!syntax.ok) {
      return { ok: false, status: 'parser-degrade', reason: `语法诊断读取失败：${syntax.reason}` };
    }
    if (syntax.hasErrors) {
      return { ok: false, status: 'parser-degrade', reason: `目标文件存在语法错误：${filePart}` };
    }

    return { ok: true, skeleton, source: after.source };
  }

  return {
    ok: false,
    status: 'parser-degrade',
    reason: `目标文件在检测期间被持续改写，${MAX_ANALYSIS_ATTEMPTS} 次重试后仍无法取得一致快照：${filePart}`,
  };
}

/**
 * 单锚比对：存在性（orphaned）→ 指纹版本可用性（fingerprint-unavailable）→ 指纹相等性（fresh/stale）。
 *
 * 判定顺序遵循 plan §9.2：先判 symbol 客观存在，存在之后才判指纹可用。
 */
export function checkOneAnchor({ anchor, symbolName, skeleton, source, project, absFile }) {
  const exp = (skeleton.exports ?? []).find((e) => e.name === symbolName);
  if (!exp) {
    return anchorResult(anchor, 'orphaned', {
      reason: `symbol ${symbolName} 已不在目标文件导出集合中（删除或重命名）`,
    });
  }

  if (anchor.fingerprintVersion !== FINGERPRINT_VERSION) {
    return anchorResult(anchor, 'fingerprint-unavailable', {
      reason: `fingerprintVersion 不匹配（lock ${anchor.fingerprintVersion} vs 当前工具 ${FINGERPRINT_VERSION}），需 drift link --refresh`,
    });
  }
  if (anchor.normalizationProfile !== NORMALIZATION_PROFILE) {
    return anchorResult(anchor, 'fingerprint-unavailable', {
      reason: `normalizationProfile 不匹配（lock ${anchor.normalizationProfile} vs 当前工具 ${NORMALIZATION_PROFILE}），需 drift link --refresh`,
    });
  }

  // canonical AST 指纹 MUST 建在与 skeleton 同源的内容快照上（source 已过 TOCTOU 一致性闸门），
  // 不让 ts-morph 自行读盘，否则会重新打开「行号来自旧内容、指纹来自新内容」的窗口。
  const computed = computeSymbolFingerprint({
    project: project ?? createSharedProject(),
    absFilePath: absFile ?? skeleton.filePath,
    sourceText: source,
    exportName: symbolName,
    expStartLine: exp.startLine,
  });
  if (!computed.ok) {
    return anchorResult(anchor, 'fingerprint-unavailable', {
      reason: LOCATE_FAILURE_TEXT[computed.reason] ?? `指纹计算失败（${computed.reason}）`,
      locateFailure: computed.reason,
    });
  }
  const actualFingerprint = computed.fingerprint;

  if (actualFingerprint === anchor.fingerprint) {
    return anchorResult(anchor, 'fresh', { expectedFingerprint: anchor.fingerprint, actualFingerprint });
  }
  return anchorResult(anchor, 'stale', {
    reason: `symbol ${symbolName} 的内容指纹已变化`,
    expectedFingerprint: anchor.fingerprint,
    actualFingerprint,
  });
}
