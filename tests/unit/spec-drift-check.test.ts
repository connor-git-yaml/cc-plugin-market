/**
 * T013：`scripts/lib/spec-drift-check.mjs` 单测（FR-004/005/009a/011/012、SC-002/003）。
 *
 * 核心不变量：`drift check` **只按 lock 内 canonical symbolId 精确匹配**，
 * MUST NOT 重新 fuzzy 解析——否则「同名新 symbol」会被洗成 fresh、真正的 orphaned 被掩盖。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  checkAnchors,
  checkOneAnchor,
  computeReportExitCode,
  analyzeConsistentSnapshot,
  STATE_MATRIX,
} from '../../scripts/lib/spec-drift-check.mjs';
// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  createSharedProject,
  FINGERPRINT_VERSION,
  NORMALIZATION_PROFILE,
} from '../../scripts/lib/spec-drift-fingerprint.mjs';
// @ts-expect-error —— .mjs 治理脚本无类型声明
import { resolveReferences } from '../../scripts/lib/spec-drift-resolve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const FIXTURES = path.join(REPO_ROOT, 'tests/fixtures/spec-drift');

const tmpDirs: string[] = [];
function makeTmpProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-check-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

/** 用真实 link 链路产出一条 lock anchor（保证指纹口径与生产一致） */
async function linkAnchor(projectRoot: string, ref: string, id = 'a1') {
  const report = await resolveReferences([{ id, ref, docPath: 'docs/x.md', line: 1 }], { projectRoot });
  const r = report.results[0];
  return {
    id: r.id,
    ref: r.ref,
    docPath: r.docPath,
    line: r.line,
    symbolId: r.symbolId,
    fingerprint: r.fingerprint,
    fingerprintVersion: r.fingerprintVersion,
    normalizationProfile: r.normalizationProfile,
    resolvedFrom: r.resolvedFrom,
    matchKind: r.matchKind,
  };
}

const ORIGINAL = [
  'export function anchored(a: number, b: number): number {',
  '  return a + b;',
  '}',
  '',
  'export function sibling(x: number): number {',
  '  return x * 2;',
  '}',
].join('\n');

/**
 * 状态矩阵逐列字面值合同已迁移至 `tests/unit/spec-drift-state-matrix.test.ts`（T033），
 * 该文件是 spec §状态矩阵在代码侧的唯一镜像；此处只保留 exitCode 混合优先级求值的用例。
 */
describe('computeReportExitCode —— 混合优先级严格分层（W-4）', () => {
  const report = (reportStatus: string, statuses: string[]) => ({
    reportStatus,
    anchors: statuses.map((status, i) => ({ id: `a${i}`, status })),
  });

  it('lock-corrupt → 3（最高层）', () => {
    expect(computeReportExitCode(report('lock-corrupt', ['stale']))).toBe(3);
  });

  it('【混合优先级专项】graph-unavailable + stale 共存 → exitCode 2 而非 1', () => {
    expect(computeReportExitCode(report('graph-unavailable', ['stale', 'fresh']))).toBe(2);
  });

  it('stale/orphaned 优先于不可验证态 → 1', () => {
    expect(computeReportExitCode(report('ok', ['ambiguous', 'stale']))).toBe(1);
    expect(computeReportExitCode(report('ok', ['fresh', 'orphaned', 'unsupported-language']))).toBe(1);
  });

  it('仅不可验证态 → 2（MUST NOT 因为无 stale 就报 0）', () => {
    for (const s of ['ambiguous', 'unresolved', 'fingerprint-unavailable', 'graph-stale', 'unsupported-language', 'parser-degrade']) {
      expect(computeReportExitCode(report('ok', ['fresh', s])), s).toBe(2);
    }
  });

  it('全 fresh → 0；无锚 → 0', () => {
    expect(computeReportExitCode(report('ok', ['fresh', 'fresh']))).toBe(0);
    expect(computeReportExitCode(report('ok', []))).toBe(0);
  });

  it('不按数组出现顺序取首个非 fresh（stale 在 ambiguous 之后仍决定 exitCode）', () => {
    expect(computeReportExitCode(report('ok', ['ambiguous', 'ambiguous', 'stale']))).toBe(1);
  });
});

describe('checkAnchors —— 精确匹配语义（FR-004）', () => {
  it('未改动 → fresh，exitCode 0', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.reportStatus).toBe('ok');
    expect(report.anchors[0].status).toBe('fresh');
    expect(report.anchors[0].machineCode).toBe('DRIFT_FRESH');
    expect(report.exitCode).toBe(0);
  });

  it('symbol 体改写（同名新实现）MUST 判 stale 而非被 fuzzy 洗成 fresh，且报告含 expected/actual 指纹', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    fs.writeFileSync(
      path.join(root, 'a.ts'),
      `${ORIGINAL.replace('return a + b;', 'return a * b - 1;')}\n`,
      'utf8',
    );
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('stale');
    expect(report.anchors[0].machineCode).toBe('DRIFT_STALE');
    expect(report.anchors[0].expectedFingerprint).toBe(anchor.fingerprint);
    expect(report.anchors[0].actualFingerprint).not.toBe(anchor.fingerprint);
    expect(report.exitCode).toBe(1);
  });

  it('symbol 改名消失、同文件存在高度相似的新名字 → orphaned（MUST NOT 重新 fuzzy 绑到新 symbol）', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    fs.writeFileSync(
      path.join(root, 'a.ts'),
      `${ORIGINAL.replace('function anchored', 'function anchoredV2')}\n`,
      'utf8',
    );
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('orphaned');
    expect(report.anchors[0].machineCode).toBe('DRIFT_ORPHANED');
    expect(report.exitCode).toBe(1);
  });

  it('文件整体删除 → orphaned', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    fs.rmSync(path.join(root, 'a.ts'));
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('orphaned');
    expect(report.anchors[0].reason).toMatch(/文件/);
  });

  it('【SC-002】同文件他 symbol 变动不误伤本锚（含行号平移）', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    const shifted = [
      '// 新增前导注释，令 sibling 行号平移',
      ORIGINAL.replace('return x * 2;', 'return x * 3 + 7;'),
    ].join('\n');
    fs.writeFileSync(path.join(root, 'a.ts'), `${shifted}\n`, 'utf8');
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('fresh');
    expect(report.exitCode).toBe(0);
  });
});

describe('checkAnchors —— 不可验证态', () => {
  it('fingerprintVersion 不匹配 → fingerprint-unavailable（非 stale，SC-005）', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = { ...(await linkAnchor(root, 'a.ts::anchored')), fingerprintVersion: '0' };
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].reason).toMatch(/fingerprintVersion/);
    expect(report.exitCode).toBe(2);
  });

  it('normalizationProfile 不匹配 → fingerprint-unavailable', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = { ...(await linkAnchor(root, 'a.ts::anchored')), normalizationProfile: 'legacy-profile' };
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].reason).toMatch(/normalizationProfile/);
  });

  it('非 TS/JS 语言 → unsupported-language（规范化扩展名判据，MUST NOT 用 startLine===undefined）', async () => {
    const anchor = {
      id: 'py', ref: 'script.py::compute_total', docPath: 'd.md', line: 1,
      symbolId: 'script.py::compute_total', fingerprint: 'sha256:x',
      fingerprintVersion: FINGERPRINT_VERSION, normalizationProfile: NORMALIZATION_PROFILE,
      resolvedFrom: 'script.py::compute_total', matchKind: 'exact',
    };
    const report = await checkAnchors([anchor], { projectRoot: path.join(FIXTURES, 'resolve') });
    expect(report.anchors[0].status).toBe('unsupported-language');
    expect(report.anchors[0].machineCode).toBe('DRIFT_UNSUPPORTED_LANGUAGE');
    expect(report.exitCode).toBe(2);
  });

  it('.mts/.cts MUST 被视为受支持（N-3，不得误标 unsupported-language）', async () => {
    const root = makeTmpProject({
      'm.mts': 'export function mtsSymbol(): number {\n  return 1;\n}\n',
      'c.cts': 'export function ctsSymbol(): number {\n  return 2;\n}\n',
    });
    const anchors = [
      await linkAnchor(root, 'm.mts::mtsSymbol', 'm1'),
      await linkAnchor(root, 'c.cts::ctsSymbol', 'c1'),
    ];
    const report = await checkAnchors(anchors, { projectRoot: root });
    for (const a of report.anchors) {
      expect(a.status, JSON.stringify(a)).not.toBe('unsupported-language');
    }
  });

  it('语法错误文件 → parser-degrade（按语法诊断判据，MUST NOT 依赖 analyzeFiles 抛异常）', async () => {
    const root = makeTmpProject({ 'broken.ts': fs.readFileSync(path.join(FIXTURES, 'parser-degrade/broken.ts'), 'utf8') });
    const anchor = {
      id: 'p1', ref: 'broken.ts::brokenSymbol', docPath: 'd.md', line: 1,
      symbolId: 'broken.ts::brokenSymbol', fingerprint: 'sha256:x',
      fingerprintVersion: FINGERPRINT_VERSION, normalizationProfile: NORMALIZATION_PROFILE,
      resolvedFrom: 'broken.ts::brokenSymbol', matchKind: 'exact',
    };
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('parser-degrade');
    expect(report.anchors[0].machineCode).toBe('DRIFT_PARSER_DEGRADE');
    expect(report.exitCode).toBe(2);
  });
});

describe('W-7 check 侧路径 containment（lock 同属用户可写输入）', () => {
  it('lock 内 symbolId 用 `../` 逃出 project-root → fingerprint-unavailable，MUST NOT 读到外部文件判 fresh', async () => {
    // 外层目录里放一个真实存在、且内容与锚一致的同名文件：
    // 若实现不做 containment，它会被成功解析并判 fresh。
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-outer-'));
    tmpDirs.push(outer);
    fs.writeFileSync(path.join(outer, 'leak.ts'), `${ORIGINAL}\n`, 'utf8');
    const inner = path.join(outer, 'project');
    fs.mkdirSync(inner, { recursive: true });

    const anchor = {
      id: 'esc', ref: '../leak.ts::anchored', docPath: 'd.md', line: 1,
      symbolId: '../leak.ts::anchored', fingerprint: 'sha256:x',
      fingerprintVersion: FINGERPRINT_VERSION, normalizationProfile: NORMALIZATION_PROFILE,
      resolvedFrom: '../leak.ts::anchored', matchKind: 'exact',
    };
    const report = await checkAnchors([anchor], { projectRoot: inner });
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].reason).toMatch(/逃逸/);
    expect(report.exitCode).toBe(2);
  });

  it('lock 内 symbolId 为绝对路径 → fingerprint-unavailable', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const abs = path.join(root, 'a.ts');
    const anchor = {
      id: 'abs', ref: `${abs}::anchored`, docPath: 'd.md', line: 1,
      symbolId: `${abs}::anchored`, fingerprint: 'sha256:x',
      fingerprintVersion: FINGERPRINT_VERSION, normalizationProfile: NORMALIZATION_PROFILE,
      resolvedFrom: `${abs}::anchored`, matchKind: 'exact',
    };
    const report = await checkAnchors([anchor], { projectRoot: root });
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].reason).toMatch(/绝对路径|盘符|UNC/);
  });
});

describe('checkAnchors —— report 级 graph-unavailable（FR-011）', () => {
  it('dist 缺失 → graph-unavailable + degraded + exitCode 2', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    const report = await checkAnchors([anchor], {
      projectRoot: root,
      distRoot: path.join(FIXTURES, 'graph-unavailable/no-dist'),
    });
    expect(report.reportStatus).toBe('graph-unavailable');
    expect(report.machineCode).toBe('DRIFT_GRAPH_UNAVAILABLE');
    expect(report.degraded).toBe(true);
    expect(report.reason).toMatch(/dist-missing/);
    expect(report.exitCode).toBe(2);
  });

  it('dist 存在但加载失败 → graph-unavailable（reason 区分 dist-load-failed）', async () => {
    const root = makeTmpProject({ 'a.ts': `${ORIGINAL}\n` });
    const anchor = await linkAnchor(root, 'a.ts::anchored');
    const report = await checkAnchors([anchor], {
      projectRoot: root,
      distRoot: path.join(FIXTURES, 'graph-unavailable/broken-dist'),
    });
    expect(report.reportStatus).toBe('graph-unavailable');
    expect(report.reason).toMatch(/dist-load-failed/);
    expect(report.exitCode).toBe(2);
  });
});

/**
 * T032：`locateExportedNodes` 三类失败 → anchor 级 `fingerprint-unavailable`。
 *
 * 三态的触发条件都是「analyzeFiles 认为该导出存在，本地 ts-morph AST 却给出不一致的答案」，
 * 即两侧对目标 Node 身份的判断分叉。这种分叉在真实仓库里靠外部条件（dist 与源码版本错位、
 * 竞态改写）触发，无法用一个静态 fixture 稳定复现，故在 `checkOneAnchor` 这一**生产函数**
 * 边界上注入分叉的 skeleton 直测映射——被测的是真实映射代码，不是替身。
 *
 * ⚠️ 诚实边界：`reexport-unsupported` 在**当前生产链路上不可达**——实测 `analyzeFiles`
 * 不解析跨文件 re-export（`export { x } from './other'` 的 skeleton.exports 为空），
 * 于是 check 会先判 orphaned 而轮不到指纹计算（见本 describe 最后一条用例）。该分支仍保留
 * 为防御层：一旦上游 adapter 将来支持跨文件解析，指纹 MUST NOT 归属到错误文件。
 */
describe('T032 —— locateExportedNodes 三态映射到 fingerprint-unavailable', () => {
  const LOCAL_SOURCE = 'export function anchored(): number {\n  return 1;\n}\n';

  function anchorStub(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      ref: 'a.ts::anchored',
      docPath: 'docs/x.md',
      line: 1,
      symbolId: 'a.ts::anchored',
      fingerprint: 'sha256:' + '0'.repeat(64),
      fingerprintVersion: FINGERPRINT_VERSION,
      normalizationProfile: NORMALIZATION_PROFILE,
      resolvedFrom: 'manifest',
      matchKind: 'exact',
      ...overrides,
    };
  }

  function runCheckOneAnchor(source: string, exportSymbol: Record<string, unknown>, symbolName: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-locate-'));
    tmpDirs.push(dir);
    const absFile = path.join(dir, 'a.ts');
    fs.writeFileSync(absFile, source, 'utf8');
    return checkOneAnchor({
      anchor: anchorStub(),
      symbolName,
      skeleton: { filePath: absFile, parserUsed: 'ts-morph', exports: [exportSymbol] },
      source,
      project: createSharedProject(),
      absFile,
    });
  }

  it('node-locate-failed（skeleton 报告的导出名在本地 AST 中不存在）→ fingerprint-unavailable', () => {
    const result = runCheckOneAnchor(
      LOCAL_SOURCE,
      { name: 'ghost', startLine: 1, endLine: 3 },
      'ghost',
    );
    expect(result.status).toBe('fingerprint-unavailable');
    expect(result.machineCode).toBe('DRIFT_FINGERPRINT_UNAVAILABLE');
    expect(result.locateFailure).toBe('node-locate-failed');
    expect(result.degraded).toBe(true);
    // MUST NOT 用 declarations[0] 兜底产出一个「看似有效」的指纹
    expect(result.actualFingerprint).toBeUndefined();
  });

  it('node-locate-ambiguous（startLine 与本地 AST 分叉）→ fingerprint-unavailable，绝不猜', () => {
    const result = runCheckOneAnchor(
      LOCAL_SOURCE,
      { name: 'anchored', startLine: 99, endLine: 101 },
      'anchored',
    );
    expect(result.status).toBe('fingerprint-unavailable');
    expect(result.locateFailure).toBe('node-locate-ambiguous');
    expect(result.actualFingerprint).toBeUndefined();
  });

  it('reexport-unsupported（声明全部来自其他文件）→ fingerprint-unavailable', () => {
    const source = fs.readFileSync(path.join(FIXTURES, 'reexport-unsupported/index.ts'), 'utf8');
    const dir = path.join(FIXTURES, 'reexport-unsupported');
    const result = checkOneAnchor({
      anchor: anchorStub({ ref: 'index.ts::reexportedSymbol', symbolId: 'index.ts::reexportedSymbol' }),
      symbolName: 'reexportedSymbol',
      // 模拟「上游 adapter 已能解析跨文件 re-export」：startLine 指向 other.ts 里的声明
      skeleton: { filePath: path.join(dir, 'index.ts'), parserUsed: 'ts-morph', exports: [{ name: 'reexportedSymbol', startLine: 2, endLine: 4 }] },
      source,
      project: createSharedProject(),
      absFile: path.join(dir, 'index.ts'),
    });
    expect(result.status).toBe('fingerprint-unavailable');
    expect(result.locateFailure).toBe('reexport-unsupported');
    expect(result.reason).toMatch(/reexport-unsupported/);
  });

  // F221（spec 生成器识别 re-export）落地后，analyzeFiles 会把 `export { x } from './other'`
  // 如实返回为 `{ name: 'reexportedSymbol', kind: 're-export' }`，符号不再"查不到"。
  // 因此存在性判定不再落 orphaned，而是继续走到 locateExportedNodes——
  // 该防御分支由此从"生产链路不可达"变为**真实可达**（上游行为变更带来的改善）。
  // 本用例的守护价值：re-export 锚 MUST 落 fingerprint-unavailable(reexport-unsupported)，
  // 绝不允许退化成对其他文件的声明算出一个错误归属的指纹。
  it('生产链路端到端：re-export 锚 → fingerprint-unavailable(reexport-unsupported)，绝不产出跨文件错误归属指纹', async () => {
    const root = makeTmpProject({
      'other.ts': 'export function reexportedSymbol(): number {\n  return 1;\n}\n',
      'index.ts': "export { reexportedSymbol } from './other';\n",
    });
    const report = await checkAnchors(
      [
        {
          id: 'a1',
          ref: 'index.ts::reexportedSymbol',
          docPath: 'docs/x.md',
          line: 1,
          symbolId: 'index.ts::reexportedSymbol',
          fingerprint: 'sha256:' + '0'.repeat(64),
          fingerprintVersion: FINGERPRINT_VERSION,
          normalizationProfile: NORMALIZATION_PROFILE,
          resolvedFrom: 'manifest',
          matchKind: 'exact',
        },
      ],
      { projectRoot: root },
    );
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].locateFailure).toBe('reexport-unsupported');
    expect(report.anchors[0].reason).toMatch(/reexport-unsupported/);
    expect(report.anchors[0].actualFingerprint).toBeUndefined();
  });
});

/**
 * TOCTOU（C2 审查项）：analyzeFiles 与源码读取之间存在窗口。
 *
 * 真实竞态无法在测试里稳定复现，故通过注入 analyzeFiles 在"分析已完成、源码尚未读取"
 * 的确切时刻改动磁盘，等价复刻该窗口。
 */
describe('analyzeConsistentSnapshot —— 分析/重读竞态', () => {
  function realSkeletonStub(absFile: string) {
    return {
      filePath: absFile,
      parserUsed: 'ts-morph',
      exports: [{ name: 'anchored', startLine: 1, endLine: 3 }],
    };
  }

  it('分析完成后文件被删除 → orphaned，而不是抛异常穿透调用方', async () => {
    const root = makeTmpProject({ 'a.ts': ORIGINAL });
    const absFile = path.join(root, 'a.ts');
    const outcome = await analyzeConsistentSnapshot({
      absFile,
      filePart: 'a.ts',
      analyzeFiles: async () => {
        fs.rmSync(absFile);
        return [realSkeletonStub(absFile)];
      },
      project: createSharedProject(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('orphaned');
    expect(outcome.reason).toMatch(/竞态/);
  });

  it('分析完成后文件被持续改写 → parser-degrade（绝不把旧 span 套到新源码上）', async () => {
    const root = makeTmpProject({ 'a.ts': ORIGINAL });
    const absFile = path.join(root, 'a.ts');
    let writes = 0;
    const outcome = await analyzeConsistentSnapshot({
      absFile,
      filePart: 'a.ts',
      analyzeFiles: async () => {
        writes += 1;
        fs.writeFileSync(absFile, `${ORIGINAL}\n// mutation ${writes}\n`, 'utf8');
        return [realSkeletonStub(absFile)];
      },
      project: createSharedProject(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('parser-degrade');
    expect(outcome.reason).toMatch(/持续改写/);
    expect(writes).toBeGreaterThan(1); // 有界重试确实发生过
  });

  it('只在首轮改写时，重试后取到一致快照并正常返回', async () => {
    const root = makeTmpProject({ 'a.ts': ORIGINAL });
    const absFile = path.join(root, 'a.ts');
    let attempt = 0;
    const outcome = await analyzeConsistentSnapshot({
      absFile,
      filePart: 'a.ts',
      analyzeFiles: async () => {
        attempt += 1;
        if (attempt === 1) fs.writeFileSync(absFile, `${ORIGINAL}\n// once\n`, 'utf8');
        return [realSkeletonStub(absFile)];
      },
      project: createSharedProject(),
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.source).toBe(fs.readFileSync(absFile, 'utf8'));
  });

  it('分析完成后源码不可读（EACCES 等 I/O 失败）→ parser-degrade，不抛异常', async () => {
    const root = makeTmpProject({ 'a.ts': ORIGINAL });
    const absFile = path.join(root, 'a.ts');
    const outcome = await analyzeConsistentSnapshot({
      absFile,
      filePart: 'a.ts',
      analyzeFiles: async () => {
        // 用目录替换文件：readFileSync 抛 EISDIR，等价于非 ENOENT 的 I/O 失败
        fs.rmSync(absFile);
        fs.mkdirSync(absFile);
        return [realSkeletonStub(absFile)];
      },
      project: createSharedProject(),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.status).toBe('parser-degrade');
    expect(outcome.reason).toMatch(/读取源码失败/);
  });
});
