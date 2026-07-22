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
import { checkAnchors, computeReportExitCode, STATE_MATRIX } from '../../scripts/lib/spec-drift-check.mjs';
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
 * W-3：状态矩阵逐列字面值合同。
 *
 * 事实源是 `specs/219-spec-drift-production/spec.md` §状态矩阵（11 行 × 8 列）。
 * 只断言「machineCode 匹配 /^DRIFT_[A-Z_]+$/、exitCode ∈ {0,1,2,3}」这类形状断言
 * 会放过绝大多数写错：把 stale 的 exitCode 写成 2、把 ambiguous 的 degraded 写成 false、
 * 把 lock-corrupt 的 repoCheckStrict 写成 warn，形状断言全都照过。故逐列取字面值相等。
 */
interface StateRow {
  scope: 'anchor' | 'report';
  machineCode: string;
  exitCode: 0 | 1 | 2 | 3;
  priority: number;
  repoCheck: 'pass' | 'warn' | 'error';
  repoCheckStrict: 'pass' | 'warn' | 'error';
  degraded: boolean;
}

const SPEC_STATE_MATRIX: Record<string, StateRow> = {
  'lock-corrupt': { scope: 'report', machineCode: 'DRIFT_LOCK_CORRUPT', exitCode: 3, priority: 1, repoCheck: 'error', repoCheckStrict: 'error', degraded: true },
  'graph-unavailable': { scope: 'report', machineCode: 'DRIFT_GRAPH_UNAVAILABLE', exitCode: 2, priority: 2, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  stale: { scope: 'anchor', machineCode: 'DRIFT_STALE', exitCode: 1, priority: 3, repoCheck: 'warn', repoCheckStrict: 'error', degraded: false },
  orphaned: { scope: 'anchor', machineCode: 'DRIFT_ORPHANED', exitCode: 1, priority: 3, repoCheck: 'warn', repoCheckStrict: 'error', degraded: false },
  ambiguous: { scope: 'anchor', machineCode: 'DRIFT_AMBIGUOUS', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  unresolved: { scope: 'anchor', machineCode: 'DRIFT_UNRESOLVED', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  'fingerprint-unavailable': { scope: 'anchor', machineCode: 'DRIFT_FINGERPRINT_UNAVAILABLE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  'graph-stale': { scope: 'anchor', machineCode: 'DRIFT_GRAPH_STALE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  'unsupported-language': { scope: 'anchor', machineCode: 'DRIFT_UNSUPPORTED_LANGUAGE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  'parser-degrade': { scope: 'anchor', machineCode: 'DRIFT_PARSER_DEGRADE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true },
  fresh: { scope: 'anchor', machineCode: 'DRIFT_FRESH', exitCode: 0, priority: 5, repoCheck: 'pass', repoCheckStrict: 'pass', degraded: false },
};

describe('STATE_MATRIX 逐列字面值合同（spec §状态矩阵为唯一权威表）', () => {
  it('状态名集合与 spec 表 11 行完全一致（多一态/少一态都失败）', () => {
    expect(Object.keys(STATE_MATRIX).sort()).toEqual(Object.keys(SPEC_STATE_MATRIX).sort());
  });

  it.each(Object.entries(SPEC_STATE_MATRIX))('%s —— 七列字面值逐一相等', (name, row) => {
    const actual = STATE_MATRIX[name] as StateRow & { nextStep?: string };
    expect(actual, `状态 ${name} 缺失`).toBeDefined();
    expect({
      scope: actual.scope,
      machineCode: actual.machineCode,
      exitCode: actual.exitCode,
      priority: actual.priority,
      repoCheck: actual.repoCheck,
      repoCheckStrict: actual.repoCheckStrict,
      degraded: actual.degraded,
    }).toEqual(row);
  });

  it.each(Object.keys(SPEC_STATE_MATRIX))('%s —— next-step 文案非空且非占位', (name) => {
    const nextStep = (STATE_MATRIX[name] as { nextStep?: unknown }).nextStep;
    expect(typeof nextStep).toBe('string');
    expect((nextStep as string).trim().length).toBeGreaterThan(0);
    expect(nextStep as string).not.toMatch(/^(TODO|TBD|N\/A)$/i);
  });

  it('单态 exitCode 与混合优先级层级互相自洽（同 priority MUST 同 exitCode）', () => {
    const byPriority = new Map<number, Set<number>>();
    for (const row of Object.values(SPEC_STATE_MATRIX)) {
      if (!byPriority.has(row.priority)) byPriority.set(row.priority, new Set());
      byPriority.get(row.priority)!.add(row.exitCode);
    }
    for (const [priority, exitCodes] of byPriority) {
      expect([...exitCodes], `priority ${priority}`).toHaveLength(1);
    }
  });

  it('--strict 只把默认 warn 提升为 error，不改变 pass 与已是 error 的档', () => {
    for (const [name, row] of Object.entries(SPEC_STATE_MATRIX)) {
      const expectedStrict = row.repoCheck === 'warn' ? 'error' : row.repoCheck;
      expect((STATE_MATRIX[name] as StateRow).repoCheckStrict, name).toBe(expectedStrict);
    }
  });
});

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
      fingerprintVersion: '1', normalizationProfile: 'source-slice-whitespace-v1',
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
      fingerprintVersion: '1', normalizationProfile: 'source-slice-whitespace-v1',
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
      fingerprintVersion: '1', normalizationProfile: 'source-slice-whitespace-v1',
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
      fingerprintVersion: '1', normalizationProfile: 'source-slice-whitespace-v1',
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

describe('C3 待补（T032）——locateExportedNodes 三态映射', () => {
  // C1 过渡态指纹基于 ExportSymbol 的行号切片，尚未引入 ts-morph Node 定位，
  // 因此 node-locate-failed / node-locate-ambiguous / reexport-unsupported
  // 三类失败在本阶段无触发路径。fixture 已就位（reexport-unsupported/），
  // 断言随 T032 切换 canonical AST 指纹时补齐。
  it.todo('node-locate-failed → fingerprint-unavailable（T032）');
  it.todo('node-locate-ambiguous → fingerprint-unavailable（T032）');
  it.todo('reexport-unsupported → fingerprint-unavailable（T032）');
});
