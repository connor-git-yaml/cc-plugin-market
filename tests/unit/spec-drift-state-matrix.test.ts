/**
 * T033：11 态状态矩阵 table-driven 合同测试（SC-003）。
 *
 * 事实源是 `specs/219-spec-drift-production/spec.md` §状态矩阵（11 行）。本文件是该表在
 * 代码侧的**唯一**镜像（原先散在 `spec-drift-check.test.ts` 的同名 describe 已迁移至此，
 * 避免同一张表在两处各写一份而漂移）。
 *
 * 为什么逐列取字面值相等而非形状断言：只断言「machineCode 匹配 /^DRIFT_[A-Z_]+$/、
 * exitCode ∈ {0,1,2,3}」会放过绝大多数写错——把 stale 的 exitCode 写成 2、把 ambiguous 的
 * degraded 写成 false、把 lock-corrupt 的 repoCheckStrict 写成 warn，形状断言全都照过。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import { STATE_MATRIX, buildReport, summarize, checkAnchors } from '../../scripts/lib/spec-drift-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '../fixtures/spec-drift');

interface StateRow {
  scope: 'anchor' | 'report';
  machineCode: string;
  exitCode: 0 | 1 | 2 | 3;
  priority: number;
  repoCheck: 'pass' | 'warn' | 'error';
  repoCheckStrict: 'pass' | 'warn' | 'error';
  degraded: boolean;
  /**
   * next-step 文案**字面值**，逐字抄自 spec.md §状态矩阵最后一列。
   *
   * 【为何必须是字面值】此前只断言「非空 + 11 条互不相同」，那意味着任意一条**内容写错
   * 但仍然唯一**的文案都能通过——比如把 parser-degrade 的建议误写成 graph 重建指引，
   * 断言全绿。next-step 是用户拿到失败后唯一的可行动信息，MUST 与 spec 逐字比对。
   */
  nextStep: string;
}

const SPEC_STATE_MATRIX: Record<string, StateRow> = {
  'lock-corrupt': { scope: 'report', machineCode: 'DRIFT_LOCK_CORRUPT', exitCode: 3, priority: 1, repoCheck: 'error', repoCheckStrict: 'error', degraded: true, nextStep: 'lock 文件无法解析（JSON 语法错误 / schema 不兼容 / 缺失必需字段），先修复 `.specify/spec-drift.lock.json` 再继续' },
  'graph-unavailable': { scope: 'report', machineCode: 'DRIFT_GRAPH_UNAVAILABLE', exitCode: 2, priority: 2, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: 'AST 分析环境不可用（dist 编译产物缺失或模块加载失败），运行 `npm run build` 后重跑' },
  stale: { scope: 'anchor', machineCode: 'DRIFT_STALE', exitCode: 1, priority: 3, repoCheck: 'warn', repoCheckStrict: 'error', degraded: false, nextStep: 'AST 结构/token 已变化，确认 spec 引用是否仍准确：准确则 `drift link --refresh`，不准确则修订 spec 文案' },
  orphaned: { scope: 'anchor', machineCode: 'DRIFT_ORPHANED', exitCode: 1, priority: 3, repoCheck: 'warn', repoCheckStrict: 'error', degraded: false, nextStep: '被锚 symbol 已消失（删除/重命名，M9 不做 rename-follow），`drift unlink` 清理旧锚，如有替代 symbol 重新 `drift link`' },
  ambiguous: { scope: 'anchor', machineCode: 'DRIFT_AMBIGUOUS', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: '引用命中多个候选，在引用清单里改写为更精确的 `file::Symbol` 形式后重新 `drift link`' },
  unresolved: { scope: 'anchor', machineCode: 'DRIFT_UNRESOLVED', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: '引用未能解析到任何 symbol：裸 symbol 名需补全为 `file::Symbol` 形式；已是 file-qualified 则检查拼写或运行 `drift link --refresh`' },
  'fingerprint-unavailable': { scope: 'anchor', machineCode: 'DRIFT_FINGERPRINT_UNAVAILABLE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: 'symbol 已解析但取不到可用 span（含 member 粒度被拒绝、fingerprintVersion 不匹配两种子情形），reason 字段会指出具体原因与是否需要 relink' },
  'graph-stale': { scope: 'anchor', machineCode: 'DRIFT_GRAPH_STALE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: '消费的 graph 制品早于当前工作树，重建 graph（`spectra batch --mode graph-only`）后重跑' },
  'unsupported-language': { scope: 'anchor', machineCode: 'DRIFT_UNSUPPORTED_LANGUAGE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: '该语言本期不支持 symbol 级建锚（首发仅 TypeScript/JavaScript），等待语言支持扩展' },
  'parser-degrade': { scope: 'anchor', machineCode: 'DRIFT_PARSER_DEGRADE', exitCode: 2, priority: 4, repoCheck: 'warn', repoCheckStrict: 'error', degraded: true, nextStep: 'AST 解析失败（语法错误/编码问题），修复目标文件后重跑' },
  fresh: { scope: 'anchor', machineCode: 'DRIFT_FRESH', exitCode: 0, priority: 5, repoCheck: 'pass', repoCheckStrict: 'pass', degraded: false, nextStep: '无需操作' },
};

describe('11 态状态矩阵 —— 逐列字面值合同（SC-003）', () => {
  it('状态名集合与 spec 表 11 行完全一致（多一态 / 少一态都失败）', () => {
    expect(Object.keys(SPEC_STATE_MATRIX)).toHaveLength(11);
    expect(Object.keys(STATE_MATRIX).sort()).toEqual(Object.keys(SPEC_STATE_MATRIX).sort());
  });

  it.each(Object.entries(SPEC_STATE_MATRIX))(
    '%s —— scope / machineCode / exitCode / priority / repoCheck / repoCheckStrict / degraded 七列逐一相等',
    (name, row) => {
      const actual = STATE_MATRIX[name] as StateRow;
      expect(actual, `状态 ${name} 缺失`).toBeDefined();
      expect({
        scope: actual.scope,
        machineCode: actual.machineCode,
        exitCode: actual.exitCode,
        priority: actual.priority,
        repoCheck: actual.repoCheck,
        repoCheckStrict: actual.repoCheckStrict,
        degraded: actual.degraded,
        nextStep: actual.nextStep,
      }).toEqual(row);
    },
  );

  it('machineCode 两两互不相同（11 态各有独立机器码，FR-012）', () => {
    const codes = Object.values(STATE_MATRIX).map((row) => (row as StateRow).machineCode);
    expect(new Set(codes).size).toBe(11);
  });

  it.each(Object.entries(SPEC_STATE_MATRIX))(
    '%s —— next-step 文案与 spec 表**逐字**相等（非空 / 唯一性断言不足以挡住写错内容）',
    (name, row) => {
      const nextStep = (STATE_MATRIX[name] as { nextStep?: unknown }).nextStep;
      expect(typeof nextStep).toBe('string');
      expect(nextStep as string).toBe(row.nextStep);
    },
  );

  it('next-step 文案 MUST NOT 是占位符', () => {
    for (const row of Object.values(STATE_MATRIX)) {
      const step = (row as { nextStep: string }).nextStep;
      expect(step.trim().length).toBeGreaterThan(0);
      expect(step).not.toMatch(/^(TODO|TBD|N\/A)$/i);
    }
  });

  it('next-step 文案两两互不相同（不得退化成通用兜底文本）', () => {
    const steps = Object.values(STATE_MATRIX).map((row) => (row as { nextStep: string }).nextStep);
    expect(new Set(steps).size).toBe(11);
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

  it('--strict 只把默认 warn 提升为 error，不改变 pass 与已是 error 的档（FR-007 单一规则）', () => {
    for (const [name, row] of Object.entries(SPEC_STATE_MATRIX)) {
      const expectedStrict = row.repoCheck === 'warn' ? 'error' : row.repoCheck;
      expect((STATE_MATRIX[name] as StateRow).repoCheckStrict, name).toBe(expectedStrict);
    }
  });

  it('summarize 输出全部 10 个 anchor 级状态键（0 计数也在，消费方可无条件读数）', () => {
    const summary = summarize([]) as Record<string, number>;
    const anchorStates = Object.entries(SPEC_STATE_MATRIX)
      .filter(([, row]) => row.scope === 'anchor')
      .map(([name]) => name);
    expect(Object.keys(summary).sort()).toEqual(anchorStates.sort());
    expect(Object.values(summary).every((n) => n === 0)).toBe(true);
  });
});

/**
 * `graph-stale` 在当前版本**没有自然触发路径**（plan §9.3：drift 不消费预生成 graph 制品）。
 * 因此用合成 AnchorCheckResult 手工构造，验证类型定义 / 汇总逻辑 / JSON 序列化三者仍正确——
 * 若未来引入 graph 新鲜度判定，这条用例是它的现成接口合同。
 */
describe('graph-stale —— 合成构造验证汇总与序列化', () => {
  const syntheticAnchor = {
    id: 'gs1',
    ref: 'a.ts::anchored',
    docPath: 'docs/x.md',
    line: 7,
    symbolId: 'a.ts::anchored',
    status: 'graph-stale',
    machineCode: STATE_MATRIX['graph-stale'].machineCode,
    degraded: STATE_MATRIX['graph-stale'].degraded,
    nextStep: STATE_MATRIX['graph-stale'].nextStep,
  };

  it('汇总：summary 计入 graph-stale，report.degraded 为 true，exitCode 为 2', () => {
    const report = buildReport({ anchors: [syntheticAnchor] });
    expect(report.summary['graph-stale']).toBe(1);
    expect(report.degraded).toBe(true);
    expect(report.exitCode).toBe(2);
  });

  it('与 stale 共存：stale（priority 3）胜出 → exitCode 1', () => {
    const staleAnchor = { ...syntheticAnchor, id: 'st1', status: 'stale', degraded: false };
    expect(buildReport({ anchors: [syntheticAnchor, staleAnchor] }).exitCode).toBe(1);
  });

  it('--format json 序列化：JSON 往返后全部字段无损（含 machineCode / nextStep / summary）', () => {
    const report = buildReport({ anchors: [syntheticAnchor] });
    const roundTripped = JSON.parse(JSON.stringify(report));
    expect(roundTripped).toEqual(report);
    expect(roundTripped.anchors[0].machineCode).toBe('DRIFT_GRAPH_STALE');
    expect(roundTripped.anchors[0].nextStep).toBe(STATE_MATRIX['graph-stale'].nextStep);
  });
});

/** report 级状态的独立 fixture 验证：graph-unavailable 有自己的触发路径，不与 anchor 级混淆 */
describe('graph-unavailable —— report 级独立 fixture', () => {
  it('dist 缺失 → reportStatus=graph-unavailable，anchors 为空且 exitCode 2', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-matrix-'));
    fs.writeFileSync(
      path.join(dir, 'a.ts'),
      'export function anchored(): number {\n  return 1;\n}\n',
      'utf8',
    );
    try {
      const report = await checkAnchors(
        [
          {
            id: 'a1',
            ref: 'a.ts::anchored',
            docPath: 'docs/x.md',
            line: 1,
            symbolId: 'a.ts::anchored',
            fingerprint: `sha256:${'0'.repeat(64)}`,
            fingerprintVersion: '1',
            normalizationProfile: 'ts-morph-canonical-v1',
            resolvedFrom: 'manifest',
            matchKind: 'exact',
          },
        ],
        { projectRoot: dir, distRoot: path.join(FIXTURES, 'graph-unavailable/no-dist') },
      );
      expect(report.reportStatus).toBe('graph-unavailable');
      expect(report.machineCode).toBe('DRIFT_GRAPH_UNAVAILABLE');
      expect(report.degraded).toBe(true);
      expect(report.exitCode).toBe(2);
      expect(report.anchors).toEqual([]);
      // report 级状态 MUST NOT 被伪造进 anchor 级 summary
      expect(report.summary).not.toHaveProperty('graph-unavailable');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
