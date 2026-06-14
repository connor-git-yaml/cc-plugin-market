/**
 * F189 prototype —— 端到端可运行 demo（立项闭环的「可运行」证明）。
 *
 * 跑法：npx tsx specs/189-ast-anchored-spec-drift-detection/prototype/demo.ts
 *
 * 覆盖验收：
 *   点锚（US1/US2/FR-010）：解析+建锚 / symbol 变→stale / 空白重排→fresh /
 *     同文件他处变→本锚 fresh / symbol 删→orphaned / 多候选→ambiguous / graph 不可用→exit 2
 *   全仓（US4）：gap / uncovered / stale-ref
 *
 * 任一场景不符预期 → 退出码 1。只读复用生产 AST/解析资产，全程在 tmpdir 操作，不碰仓库。
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { link, check, type ReferenceInput } from './src/point-anchor.js';
import { classifyWholeRepo } from './src/whole-repo.js';
import type { Anchor } from './src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGINAL = readFileSync(path.join(here, 'fixtures/sample/math.ts'), 'utf8');

// add 函数体语义改动（normalized 后不同 → stale）
const ADD_MUTATED = ORIGINAL.replace('return a + b;', 'return a + b + 1;');
// add 仅空白/缩进重排（token 不变 → normalized 相同 → fresh）
const ADD_WHITESPACE = ORIGINAL.replace(
  'export function add(a: number, b: number): number {\n  return a + b;\n}',
  'export function add(a: number, b: number): number {\n\n      return a + b;\n\n}',
);
// 只改 multiply（add 不变 → add 锚保持 fresh）
const MULTIPLY_MUTATED = ORIGINAL.replace('result = result + a;', 'result = result + a + 0;');
// 删除 add（保留 multiply → add 锚 orphaned）
const ADD_DELETED = ORIGINAL.replace(
  /export function add\(a: number, b: number\): number \{\n  return a \+ b;\n\}\n\n/,
  '',
);
// 在 add 之前插入新 export（add 内容不变但行号下移 → 验证 check 按名字重解析 span，不依赖旧行号）
const PREFIXED = 'export const VERSION = 1;\n\n' + ORIGINAL;

interface Case {
  name: string;
  pass: boolean;
  detail: string;
}
const cases: Case[] = [];
function record(name: string, pass: boolean, detail: string): void {
  cases.push({ name, pass, detail });
}

async function run(): Promise<void> {
  // 变体命中守护（Codex INFO-1/2）：若任一 .replace 未命中导致变体 === ORIGINAL，
  // 测试会"没改也通过"造成假 PASS。这里先锁住所有变体确实改了。
  record('guard: ADD_MUTATED ≠ ORIGINAL', ADD_MUTATED !== ORIGINAL, 'add 体变体已命中');
  record('guard: ADD_WHITESPACE ≠ ORIGINAL', ADD_WHITESPACE !== ORIGINAL, 'add 空白变体已命中');
  record('guard: MULTIPLY_MUTATED ≠ ORIGINAL', MULTIPLY_MUTATED !== ORIGINAL, 'multiply 变体已命中');
  record('guard: ADD_DELETED 已删除 add', !/function add\b/.test(ADD_DELETED) && /function multiply\b/.test(ADD_DELETED), 'add 删除、multiply 保留');
  record('guard: PREFIXED 含 add 且行号下移', /function add\b/.test(PREFIXED) && PREFIXED.indexOf('function add') > ORIGINAL.indexOf('function add'), 'add 内容在、起始偏移变大');

  const work = mkdtempSync(path.join(tmpdir(), 'f189-'));
  const mathPath = path.join(work, 'math.ts');
  const writeMath = (content: string): void => writeFileSync(mathPath, content, 'utf8');

  const refs: ReferenceInput[] = [{ ref: 'add', docPath: 'specs/189/spec.md', line: 42 }];

  // ── 场景 0：link 建锚（US1 AC-1：裸名解析 + matchKind + 非空指纹）──
  writeMath(ORIGINAL);
  const anchors: Anchor[] = await link(refs, [mathPath], work);
  const a0 = anchors[0]!;
  record(
    'US1-AC1 link 裸名 add → 解析+指纹+matchKind',
    a0.status === 'fresh' &&
      a0.symbolId === 'math.ts::add' &&
      typeof a0.fingerprint === 'string' &&
      a0.fingerprint.length === 64 &&
      a0.matchKind === 'partial-name',
    `status=${a0.status} symbolId=${a0.symbolId} matchKind=${a0.matchKind} fp=${a0.fingerprint?.slice(0, 12)}…`,
  );

  // ── 场景 1：未改动 → fresh ──
  writeMath(ORIGINAL);
  const r1 = await check(anchors, [mathPath], work);
  record('未改动 → fresh (exit 0)', r1.anchors[0]!.status === 'fresh' && r1.exitCode === 0, `status=${r1.anchors[0]!.status} exit=${r1.exitCode}`);

  // ── 场景 2：add 函数体变 → stale (US2 AC-1) ──
  writeMath(ADD_MUTATED);
  const r2 = await check(anchors, [mathPath], work);
  const c2 = r2.anchors[0]!;
  record(
    'US2-AC1 add 体变 → stale (exit 1, expected≠actual)',
    c2.status === 'stale' && r2.exitCode === 1 && c2.expectedFingerprint !== c2.actualFingerprint && c2.actualFingerprint !== null,
    `status=${c2.status} exit=${r2.exitCode}`,
  );

  // ── 场景 3：add 仅空白重排 → fresh (US2 AC-2 空白不敏感) ──
  writeMath(ADD_WHITESPACE);
  const r3 = await check(anchors, [mathPath], work);
  record('US2-AC2 add 空白重排 → fresh (空白不敏感)', r3.anchors[0]!.status === 'fresh' && r3.exitCode === 0, `status=${r3.anchors[0]!.status} exit=${r3.exitCode}`);

  // ── 场景 4：只改 multiply，add 不变 → add 仍 fresh (US2 AC-3 symbol 级不连累) ──
  writeMath(MULTIPLY_MUTATED);
  const r4 = await check(anchors, [mathPath], work);
  record('US2-AC3 改 multiply / add 不变 → add fresh (不连累)', r4.anchors[0]!.status === 'fresh' && r4.exitCode === 0, `status=${r4.anchors[0]!.status} exit=${r4.exitCode}`);

  // ── 场景 4b：add 之前插入新 export，add 行号下移但内容不变 → add fresh ──
  // 证明 check 按 symbol 名重解析 span（不依赖 lock 旧行号），是 symbol 级「不连累」的根据
  writeMath(PREFIXED);
  const r4b = await check(anchors, [mathPath], work);
  record('行号平移 / add 内容不变 → add fresh（按名重解析 span）', r4b.anchors[0]!.status === 'fresh' && r4b.exitCode === 0, `status=${r4b.anchors[0]!.status} exit=${r4b.exitCode}`);

  // ── 场景 5：删除 add → orphaned (US2 AC-4) ──
  writeMath(ADD_DELETED);
  const r5 = await check(anchors, [mathPath], work);
  record('US2-AC4 删 add → orphaned (exit 1)', r5.anchors[0]!.status === 'orphaned' && r5.exitCode === 1, `status=${r5.anchors[0]!.status} exit=${r5.exitCode}`);

  // ── 场景 6：多候选 → ambiguous (US1 AC-2) ──
  const aPath = path.join(work, 'a.ts');
  const bPath = path.join(work, 'b.ts');
  writeFileSync(aPath, 'export function helper(): number {\n  return 1;\n}\n', 'utf8');
  writeFileSync(bPath, 'export function helper(): number {\n  return 2;\n}\n', 'utf8');
  const ambAnchors = await link([{ ref: 'helper', docPath: 'd.md', line: 1 }], [aPath, bPath], work);
  const amb = ambAnchors[0]!;
  record(
    'US1-AC2 裸名 helper 多候选 → ambiguous + top-3',
    amb.status === 'ambiguous' && (amb.candidates?.length ?? 0) === 2 && amb.symbolId === null,
    `status=${amb.status} candidates=${JSON.stringify(amb.candidates)}`,
  );

  // ── 场景 7：graph 不可用 → graph-unavailable + exit 2 (FR-010) ──
  const r7 = await check(anchors, [], work);
  record(
    'FR-010 graph 不可用 → graph-unavailable (exit 2, 非静默 0)',
    r7.anchors[0]!.status === 'graph-unavailable' && r7.exitCode === 2 && r7.degraded === true,
    `status=${r7.anchors[0]!.status} exit=${r7.exitCode} degraded=${r7.degraded}`,
  );

  // ── 全仓 demo（US4 AC-1/2/3）──
  const wr = classifyWholeRepo({
    changedFiles: ['src/auth/login.ts', 'src/new-feature.ts'],
    existingFiles: ['src/auth/login.ts', 'src/new-feature.ts'],
    mappings: [
      { domain: 'auth', specPath: 'specs/auth.md', sourceFiles: ['src/auth/login.ts', 'src/auth/deleted.ts'], specChanged: false },
    ],
  });
  record('US4-AC1 改 login.ts / auth spec 未改 → gap', wr.gap.some((g) => g.file === 'src/auth/login.ts' && g.domain === 'auth'), `gap=${JSON.stringify(wr.gap)}`);
  record('US4-AC2 new-feature.ts 无映射 → uncovered', wr.uncovered.includes('src/new-feature.ts'), `uncovered=${JSON.stringify(wr.uncovered)}`);
  record('US4-AC3 auth 映射 deleted.ts 不存在 → stale-ref', wr.staleRef.some((s) => s.missingFile === 'src/auth/deleted.ts'), `staleRef=${JSON.stringify(wr.staleRef)}`);

  // ── 输出 ──
  rmSync(work, { recursive: true, force: true });

  console.log('\n===== F189 prototype demo =====\n');
  console.log('— 点锚 lock 制品样例（场景 0 建锚）—');
  console.log(JSON.stringify(a0, null, 2));
  console.log('\n— 验收场景结果 —');
  let failed = 0;
  for (const c of cases) {
    const tag = c.pass ? '✅ PASS' : '❌ FAIL';
    if (!c.pass) failed += 1;
    console.log(`${tag}  ${c.name}\n        ${c.detail}`);
  }
  console.log(`\n合计 ${cases.length} 场景，${cases.length - failed} 通过，${failed} 失败。`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('demo 运行异常：', err);
  process.exit(1);
});
