/**
 * T034：C3 canonical AST 语义端到端测试（SC-001 / SC-002 / SC-005）。
 *
 * 与 T018（`tests/integration/spec-drift-cli-e2e.test.ts`）的分工：T018 验证「经公开 npm
 * 入口跑通 link → check → unlink 闭环」这一发布合同；本文件验证 **link + check 的语义合同**
 * ——同一批 T029 fixture 走真实 `linkReferences` 建锚、真实 `checkAnchors` 检测后，
 * 判定结果必须落在 spec 承诺的 fresh / stale / fingerprint-unavailable 上。
 *
 * 之所以走 core（而非再 spawn 一次 CLI）：本文件要断言的是**判定语义**，spawn 只会把同一
 * 条链路多包一层进程边界，徒增 30s 级耗时而不增加证据强度；进程边界的证据由 T018 提供。
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import { linkReferences, checkAnchors } from '../../scripts/lib/spec-drift-core.mjs';
// @ts-expect-error —— .mjs 治理脚本无类型声明
import { FINGERPRINT_VERSION, NORMALIZATION_PROFILE } from '../../scripts/lib/spec-drift-fingerprint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '../fixtures/spec-drift');

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const readFixture = (...segments: string[]) => fs.readFileSync(path.join(FIXTURES, ...segments), 'utf8');

interface Harness {
  root: string;
  lockPath: string;
  targetPath: string;
}

/** 建一个临时项目：目标源文件 + manifest + lock 路径 */
function makeHarness(sourceText: string, ref: string, fileName = 'module.ts'): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-c3-e2e-'));
  tmpDirs.push(root);
  fs.writeFileSync(path.join(root, fileName), sourceText, 'utf8');
  fs.mkdirSync(path.join(root, '.specify'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify([{ id: 'anchor-1', ref, docPath: 'docs/spec.md', line: 12 }], null, 2),
    'utf8',
  );
  return { root, lockPath: path.join(root, '.specify', 'spec-drift.lock.json'), targetPath: path.join(root, fileName) };
}

async function link(h: Harness) {
  return linkReferences({
    projectRoot: h.root,
    manifestPath: path.join(h.root, 'manifest.json'),
    lockPath: h.lockPath,
  });
}

async function check(h: Harness) {
  return checkAnchors({ projectRoot: h.root, lockPath: h.lockPath });
}

/** 建锚 → 用 after 内容覆盖源文件 → 复检，返回单锚状态 */
async function linkThenRewrite(
  before: string,
  after: string,
  ref = 'module.ts::anchored',
  fileName = 'module.ts',
) {
  const h = makeHarness(before, ref, fileName);
  const linked = await link(h);
  expect(linked.exitCode, `建锚失败：${JSON.stringify(linked.results?.[0] ?? linked)}`).toBe(0);
  fs.writeFileSync(h.targetPath, after, 'utf8');
  const report = await check(h);
  return { harness: h, report, anchor: report.anchors[0] };
}

describe('(a) SC-001 收窄语义：注释 / JSDoc / 纯格式化改动 → fresh', () => {
  it('仅改行内 / 块注释 → fresh，exitCode 0', async () => {
    const { anchor, report } = await linkThenRewrite(
      readFixture('fresh-comment-only', 'before.ts'),
      readFixture('fresh-comment-only', 'after.ts'),
    );
    expect(anchor.status).toBe('fresh');
    expect(report.exitCode).toBe(0);
  });

  it('仅改前导 JSDoc → fresh', async () => {
    const { anchor } = await linkThenRewrite(
      readFixture('fresh-jsdoc-only', 'before.ts'),
      readFixture('fresh-jsdoc-only', 'after.ts'),
    );
    expect(anchor.status).toBe('fresh');
  });

  it('仅改缩进 / 换行 / 空格 → fresh', async () => {
    const { anchor } = await linkThenRewrite(
      readFixture('fresh-format-only', 'before.ts'),
      readFixture('fresh-format-only', 'after.ts'),
    );
    expect(anchor.status).toBe('fresh');
  });

  it.each([
    ['加括号 `a+b` → `(a+b)`', 'paren'],
    ['引号风格 `"x"` → `\'x\'`', 'quote'],
    ['数字分隔符 `1000` → `1_000`', 'numsep'],
    ['BigInt 分隔符 `1000n` → `1_000n`（N-2）', 'bigint'],
  ])('语法噪声：%s → fresh', async (_label, prefix) => {
    const { anchor } = await linkThenRewrite(
      readFixture('fresh-syntactic-noise', `${prefix}-before.ts`),
      readFixture('fresh-syntactic-noise', `${prefix}-after.ts`),
    );
    expect(anchor.status).toBe('fresh');
  });
});

describe('(b) 标识符 / 字面值 / 运算符 / 控制结构改动 → stale', () => {
  it.each([
    ['stale-identifier（标识符改名）', 'stale-identifier', 'before.ts', 'after.ts'],
    ['stale-literal（字面值改变）', 'stale-literal', 'before.ts', 'after.ts'],
    ['stale-control-flow（if → while）', 'stale-control-flow', 'before.ts', 'after.ts'],
    ['stale-unary-prefix（+a → -a）', 'stale-unary-prefix', 'sign-before.ts', 'sign-after.ts'],
    ['stale-unary-prefix（++a → --a）', 'stale-unary-prefix', 'incdec-before.ts', 'incdec-after.ts'],
    ['stale-unary-postfix（a++ → a--）', 'stale-unary-postfix', 'before.ts', 'after.ts'],
    ['stale-decl-kind（const → let）', 'stale-decl-kind', 'before.ts', 'after.ts'],
    ['stale-using-vs-var（var → using，N-1）', 'stale-using-vs-var', 'before.ts', 'after.ts'],
    ['stale-await-using（using → await using，N-1）', 'stale-await-using', 'before.ts', 'after.ts'],
    ['stale-overload-second（改第二个 overload 签名）', 'stale-overload-second', 'before.ts', 'after-signature.ts'],
    ['stale-overload-second（改实现体）', 'stale-overload-second', 'before.ts', 'after-implementation.ts'],
  ])('%s → stale，exitCode 1', async (_label, dir, beforeFile, afterFile) => {
    const { anchor, report } = await linkThenRewrite(
      readFixture(dir, beforeFile),
      readFixture(dir, afterFile),
    );
    expect(anchor.status).toBe('stale');
    expect(anchor.machineCode).toBe('DRIFT_STALE');
    expect(report.exitCode).toBe(1);
  });
});

describe('(c) SC-002：sibling 不误伤 + member 粒度显式拒绝（无回退 Class span 路径）', () => {
  it('同文件另一未锚定 symbol 大改、被锚 symbol 不变 → 仍 fresh', async () => {
    const before = [
      'export function anchored(input: number): number {',
      '  return input * 3;',
      '}',
      '',
      'export function sibling(x: number): number {',
      '  return x + 1;',
      '}',
      '',
    ].join('\n');
    const after = [
      '// 前导注释令 sibling 行号平移',
      'export function anchored(input: number): number {',
      '  return input * 3;',
      '}',
      '',
      'export function sibling(x: number, y: number): string {',
      '  if (x > y) {',
      '    return `${x - y}`;',
      '  }',
      '  return String(y * 42);',
      '}',
      '',
    ].join('\n');
    const { anchor } = await linkThenRewrite(before, after);
    expect(anchor.status).toBe('fresh');
  });

  it('member 引用（Class.method）在 link 阶段即被拒绝，不写入 lock —— 因此不存在「回退整个 Class span」的误伤路径', async () => {
    const h = makeHarness(readFixture('member-rejected', 'shapes.ts'), 'module.ts::Shape.area');
    const linked = await link(h);
    const result = linked.results[0];
    expect(result.status).toBe('fingerprint-unavailable');
    expect(result.reason).toMatch(/member 粒度/);
    // 半成品（无 symbolId/fingerprint）MUST NOT 落盘
    const lock = JSON.parse(fs.readFileSync(h.lockPath, 'utf8'));
    expect(lock.anchors).toEqual([]);
  });

  it('反证：sibling method 改动不会污染同类另一 method —— member 锚根本不存在，故 check 无该锚', async () => {
    const h = makeHarness(readFixture('member-rejected', 'shapes.ts'), 'module.ts::Shape.area');
    await link(h);
    fs.writeFileSync(
      h.targetPath,
      readFixture('member-rejected', 'shapes.ts').replace('return 0;\n  }\n}', 'return 12345;\n  }\n}'),
      'utf8',
    );
    const report = await check(h);
    expect(report.anchors).toEqual([]);
    expect(report.exitCode).toBe(0);
  });
});

describe('(d) SC-005：fingerprintVersion / normalizationProfile 升级不误报批量 stale', () => {
  /** 手工把 lock 内的版本字段改成旧值，模拟工具升级后的存量锚 */
  function downgradeLock(lockPath: string, patch: Record<string, string>) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.anchors = lock.anchors.map((a: Record<string, unknown>) => ({ ...a, ...patch }));
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf8');
  }

  it('旧 normalizationProfile（C1 过渡态 source-slice-whitespace-v1）+ 源文件未变 → fingerprint-unavailable 而非 stale', async () => {
    const h = makeHarness(readFixture('fingerprint-version-mismatch', 'module.ts'), 'module.ts::anchored');
    expect((await link(h)).exitCode).toBe(0);
    downgradeLock(h.lockPath, { normalizationProfile: 'source-slice-whitespace-v1' });

    const report = await check(h);
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].status).not.toBe('stale');
    expect(report.anchors[0].reason).toMatch(/normalizationProfile/);
    expect(report.anchors[0].reason).toMatch(/refresh/);
    expect(report.exitCode).toBe(2); // 不可验证（2），而非已确认 drift（1）
    expect(report.summary.stale).toBe(0);
  });

  it('旧 fingerprintVersion + 源文件未变 → fingerprint-unavailable 且提示 --refresh', async () => {
    const h = makeHarness(readFixture('fingerprint-version-mismatch', 'module.ts'), 'module.ts::anchored');
    expect((await link(h)).exitCode).toBe(0);
    downgradeLock(h.lockPath, { fingerprintVersion: '0' });

    const report = await check(h);
    expect(report.anchors[0].status).toBe('fingerprint-unavailable');
    expect(report.anchors[0].reason).toMatch(/fingerprintVersion/);
    expect(report.summary.stale).toBe(0);
  });

  it('`drift link --refresh` 后版本字段回到当前常量，且判定恢复 fresh', async () => {
    const h = makeHarness(readFixture('fingerprint-version-mismatch', 'module.ts'), 'module.ts::anchored');
    await link(h);
    downgradeLock(h.lockPath, { normalizationProfile: 'source-slice-whitespace-v1', fingerprintVersion: '0' });

    const refreshed = await linkReferences({
      projectRoot: h.root,
      manifestPath: path.join(h.root, 'manifest.json'),
      lockPath: h.lockPath,
      refresh: true,
    });
    expect(refreshed.exitCode).toBe(0);

    const lock = JSON.parse(fs.readFileSync(h.lockPath, 'utf8'));
    expect(lock.anchors[0].normalizationProfile).toBe(NORMALIZATION_PROFILE);
    expect(lock.anchors[0].fingerprintVersion).toBe(FINGERPRINT_VERSION);

    const report = await check(h);
    expect(report.anchors[0].status).toBe('fresh');
    expect(report.exitCode).toBe(0);
  });
});

describe('(e) N-3：.mts / .cts MUST 判为受支持语言（不得误标 unsupported-language）', () => {
  it.each([
    ['sample.mts', 'anchoredMts'],
    ['sample.cts', 'anchoredCts'],
  ])('%s 建锚并检测 → fresh', async (fileName, exportName) => {
    const h = makeHarness(readFixture('lang-mts-cts', fileName), `${fileName}::${exportName}`, fileName);
    const linked = await link(h);
    expect(linked.results[0].status, JSON.stringify(linked.results[0])).toBe('ok');
    const report = await check(h);
    expect(report.anchors[0].status).toBe('fresh');
  });
});

/**
 * (f) C3 审查 CRITICAL 场景的 **link → check 端到端**通道。
 *
 * unit 层已逐组断言「两个源文本指纹不等」；本组进一步证明这些差异**真的会穿过完整
 * link/check 链路**变成用户可见的 `stale`。unit 绿而 e2e 红是可能的（例如 link 侧根本
 * 建不出锚、或 check 侧提前降级），故两条通道都必须有。
 */
describe('(f) C3 审查 CRITICAL 同哈希漏报 —— link → check 端到端 MUST 判 stale', () => {
  it.each([
    [
      'extends → implements',
      'class Bar{}\nexport class foo extends Bar{}\n',
      'interface Bar{}\nexport class foo implements Bar{}\n',
    ],
    ['keyof → readonly', 'export type foo = keyof string[]\n', 'export type foo = readonly string[]\n'],
    [
      'import(...) → typeof import(...)',
      'export type foo = import("./dep").Bar\n',
      'export type foo = typeof import("./dep").Bar\n',
    ],
    ['declare let → let', 'export declare let foo: number\n', 'export let foo: number\n'],
    ['export {} → export type {}', 'class foo{}\nexport { foo }\n', 'class foo{}\nexport type { foo }\n'],
    [
      'tagged template raw 变化',
      'const tag=(s:TemplateStringsArray)=>s.raw[0];\nexport const foo = tag`A`\n',
      'const tag=(s:TemplateStringsArray)=>s.raw[0];\nexport const foo = tag`\\x41`\n',
    ],
    [
      'for 子句位置 `for(;;a++)` → `for(;a++;)`',
      'export function foo(){ let a=0; for(;;a++){} }\n',
      'export function foo(){ let a=0; for(;a++;){} }\n',
    ],
  ])('%s → stale，exitCode 1', async (_label, before, after) => {
    const { anchor, report } = await linkThenRewrite(before, after, 'module.ts::foo');
    expect(anchor.status, JSON.stringify(anchor)).toBe('stale');
    expect(report.exitCode).toBe(1);
  });

  it.each([
    [
      '普通模板转义写法（cooked 相同）',
      'declare const x: string;\nexport const foo = `A${x}`\n',
      'declare const x: string;\nexport const foo = `\\x41${x}`\n',
    ],
    ['正则 flag 顺序 `/a/gi` → `/a/ig`', 'export const foo = /a/gi\n', 'export const foo = /a/ig\n'],
  ])('W-1 等价书写：%s → fresh，exitCode 0（MUST NOT 误报）', async (_label, before, after) => {
    const { anchor, report } = await linkThenRewrite(before, after, 'module.ts::foo');
    expect(anchor.status, JSON.stringify(anchor)).toBe('fresh');
    expect(report.exitCode).toBe(0);
  });
});

/**
 * (g) W-2：link 与 check MUST 对同一份语法损坏的文件给出**一致**结论。
 *
 * 【修复前实测的自相矛盾】link 直接分析并算指纹，对 `parser-degrade/broken.ts` 返回
 * `status:"ok"` 并把锚写入 lock；紧接着 check 对**同一个文件**判 `parser-degrade`。
 * 也就是说系统先声称"锚建好了"，下一秒又声称"这个文件根本没法解析"——写进 lock 的是
 * 一个基于错误恢复树算出来的伪锚。
 */
describe('(g) W-2：link 侧 parser-health 闸门与 check 侧共用同一判据', () => {
  it('语法损坏文件：link MUST NOT 返回 ok，MUST 判 parser-degrade', async () => {
    const h = makeHarness(readFixture('parser-degrade', 'broken.ts'), 'module.ts::brokenSymbol');
    const linked = await link(h);
    expect(linked.results[0].status, JSON.stringify(linked.results[0])).toBe('parser-degrade');
    expect(linked.results[0].fingerprint ?? null).toBeNull();
  });

  it('语法损坏文件：link 不写入任何 anchor（伪锚 MUST NOT 落盘）', async () => {
    const h = makeHarness(readFixture('parser-degrade', 'broken.ts'), 'module.ts::brokenSymbol');
    await link(h);
    const lock = JSON.parse(fs.readFileSync(h.lockPath, 'utf8'));
    expect(lock.anchors).toEqual([]);
  });

  it('反向自证：语法完好的同名文件 link 仍返回 ok（闸门没有把正常路径一起堵死）', async () => {
    const h = makeHarness('export const brokenSymbol = 1;\n', 'module.ts::brokenSymbol');
    const linked = await link(h);
    expect(linked.results[0].status, JSON.stringify(linked.results[0])).toBe('ok');
    const report = await check(h);
    expect(report.anchors[0].status).toBe('fresh');
  });

  it('先建好锚、随后文件被改坏 → check 判 parser-degrade（与 link 侧同一判据、同一状态名）', async () => {
    const h = makeHarness('export const brokenSymbol = 1;\n', 'module.ts::brokenSymbol');
    expect((await link(h)).exitCode).toBe(0);
    fs.writeFileSync(h.targetPath, readFixture('parser-degrade', 'broken.ts'), 'utf8');
    const report = await check(h);
    expect(report.anchors[0].status).toBe('parser-degrade');
    expect(report.exitCode).toBe(2);
  });
});
