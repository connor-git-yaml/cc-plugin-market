/**
 * F285 守护：发布 / CI 门补齐后的合同钉住。
 *
 * 对抗复审（角 B：22 个绕过形态 21 个成立——全是「子串存在性」断言的锅）后改为：脚本整串 `toBe` 精确钉、`continue-on-error`
 * 全文件唯一且只在 report-only 步、blocking 步 run 体无吞退出码形态（`||` / `; true` / `set +e` / `exit 0`）、coverage job 头无
 * `if`/`needs`、`test:plugins` 恰 1 行、覆盖率阈值 key 指向真实文件（glob 空匹配 = 阈值静默蒸发）、`tsconfig.tests.json` 闭包
 * 非空（空集检查 = 燃尽数坍缩）。结构切块按缩进（jobs 2 空格、steps 6 空格 `- name:`），不引入 yaml 依赖。
 *
 * 这些门都是"纸面存在、无人执行"型缺口：prepublishOnly 不跑 test:plugins / typecheck:tests；tests/ 与 scripts/ 零类型门；
 * 覆盖率阈值从未进 CI；claude-review.yml 六连败。改任何一条都应是有意的合同变更，须同步改本文件。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
const ci = read('.github/workflows/ci.yml');

/** job 块：从 `\n  <name>:\n` 到下一个 2 空格顶层 key（或 EOF）。 */
function jobBlock(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name} 缺席`).toBeGreaterThan(0);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}
/** step 块：从 `      - name: <step>` 到下一个 `      - name:`（或 job 尾）。 */
function stepBlock(job: string, step: string): string {
  const block = jobBlock(job);
  const start = block.indexOf(`      - name: ${step}\n`);
  expect(start, `step ${step} 缺席于 job ${job}`).toBeGreaterThanOrEqual(0);
  const rest = block.slice(start);
  const next = rest.slice(1).indexOf('\n      - name: ');
  return next === -1 ? rest : rest.slice(0, next + 1);
}
const nonCommentLines = (text: string): string[] => text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
/** run 体：单行 `run: X` → [X]；块 `run: |` → 后续 10 空格缩进行（剥注释）。 */
function runBody(step: string): string[] {
  const lines = nonCommentLines(step);
  const at = lines.findIndex((l) => /^\s{8}run:/.test(l));
  expect(at, 'step 无 run').toBeGreaterThanOrEqual(0);
  const head = lines[at]!.replace(/^\s{8}run:\s*/, '');
  if (head !== '|') return [head];
  const body: string[] = [];
  for (const l of lines.slice(at + 1)) { if (!/^\s{10}/.test(l)) break; body.push(l.trim()); }
  return body;
}
const SWALLOW = /\|\||;\s*(?:true|:|exit 0)\b|\bset \+e\b|\|\s*true\b/;

describe('F285 · package.json 脚本合同（整串精确钉：分隔符 / 收尾 / 参数任一改动都是合同变更）', () => {
  it('prepublishOnly 按序串联 release:check → build → repo:check → typecheck:tests → vitest → test:plugins，&& 短路、无 full 类型门', () => {
    expect(pkg.scripts.prepublishOnly).toBe(
      'npm run release:check && npm run build && npm run repo:check && npm run typecheck:tests && npx vitest run --maxWorkers=4 && npm run test:plugins',
    );
  });

  it('被引用的脚本体精确钉：test:plugins / typecheck:tests（三份类型契约）/ test:coverage / typecheck:tests:full', () => {
    expect(pkg.scripts['test:plugins']).toBe('node scripts/run-plugin-tests.mjs');
    expect(pkg.scripts['typecheck:tests']).toBe(
      'tsc -p tests/type-tests/tsconfig.json --noEmit && tsc -p tests/type-tests/f220.tsconfig.json --noEmit && tsc -p tests/type-tests/f222.tsconfig.json --noEmit',
    );
    expect(pkg.scripts['test:coverage']).toBe('vitest run --coverage');
    expect(pkg.scripts['typecheck:tests:full']).toBe('tsc -p tsconfig.tests.json --noEmit --pretty false');
  });
});

describe('F285 · tsconfig.tests.json（只报不阻断的 tests/scripts 类型门）', () => {
  const tsconfig = JSON.parse(read('tsconfig.tests.json')) as { compilerOptions: Record<string, unknown>; include: string[]; exclude: string[] };

  it('extends 根 + allowJs/!checkJs；include 覆盖 tests/ 与 scripts/；排除 type-tests（各自更严）与 fixtures（语法坏死样本让 tsc 跳过语义检查）', () => {
    expect(tsconfig.compilerOptions['allowJs']).toBe(true);
    expect(tsconfig.compilerOptions['checkJs']).toBe(false);
    expect(tsconfig.include).toEqual(['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts']);
    expect(tsconfig.exclude).toEqual(['node_modules', 'dist', 'tests/type-tests/**', 'tests/fixtures/**', '**/*.d.ts']);
  });

  it('程序闭包非空（对抗复审 B-W1：exclude 加一条 tests/** 就把燃尽数从 1022 坍缩成个位数而守护照绿）；strict 沿用根配置', () => {
    const tsc = path.join(repoRoot, 'node_modules', '.bin', 'tsc');
    const listed = execFileSync(tsc, ['-p', 'tsconfig.tests.json', '--listFilesOnly'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.relative(repoRoot, l));
    const count = (prefix: string): number => listed.filter((f) => f.startsWith(prefix)).length;
    expect(count('tests/')).toBeGreaterThanOrEqual(500);
    expect(count('src/')).toBeGreaterThanOrEqual(300);
    expect(count('scripts/')).toBeGreaterThanOrEqual(1);
    expect(listed.some((f) => f.startsWith('tests/fixtures/'))).toBe(false);
    expect(listed.some((f) => f.startsWith('tests/type-tests/'))).toBe(false);
    const shown = JSON.parse(execFileSync(tsc, ['-p', 'tsconfig.tests.json', '--showConfig'], { cwd: repoRoot, encoding: 'utf8' })) as { compilerOptions: Record<string, unknown> };
    expect(shown.compilerOptions['strict']).toBe(true);
  });
});

describe('F285 · CI 工作流（结构切块 + 不存在性断言）', () => {
  it('Test 步只跑 npx vitest run（run 体末行恰为该命令；不含 npm test / 吞退出码形态 / continue-on-error）', () => {
    const step = stepBlock('test', 'Test');
    const body = runBody(step);
    expect(body[body.length - 1]).toBe('npx vitest run');
    expect(body.join('\n')).not.toMatch(/\bnpm (run )?test\b(?!:)/);
    // 只对 npm / npx 调用行查吞退出码形态：前面的 node -e 护栏（VITEST_MAX_FORKS 校验）合法含 `||`
    for (const l of body.filter((line) => /^(?:npm|npx)\b/.test(line))) expect(l).not.toMatch(SWALLOW);
    expect(step).not.toMatch(/continue-on-error/);
  });

  it('test:plugins 在整个 ci.yml 恰好 1 行、作为独立 gate 步、if 为 always()/!cancelled()、不吞退出码', () => {
    expect(ci.match(/^\s*run: npm run test:plugins\s*$/gm)?.length).toBe(1);
    const gate = stepBlock('test', 'Test Plugins (mjs gate)');
    const ifLine = nonCommentLines(gate).find((l) => /^\s{8}if:/.test(l));
    expect(ifLine, 'gate 缺 if').toBeDefined();
    expect(ifLine!.trim()).toMatch(/^if: (?:\$\{\{\s*)?(?:always\(\)|!cancelled\(\))(?:\s*\}\})?$/);
    expect(runBody(gate)).toEqual(['npm run test:plugins']);
    expect(gate).not.toMatch(/continue-on-error/);
  });

  it('continue-on-error 全文件唯一且只在 report-only 类型门步；该步排在 Test 之后、以 exit $status 收尾、打印 exit/errors/files 并对语法坍缩打 ::warning', () => {
    expect(ci.match(/^\s*continue-on-error:/gm)?.length).toBe(1);
    const step = stepBlock('test', 'Type Check Tests (full, report-only)');
    expect(step).toMatch(/^\s{8}continue-on-error: true$/m);
    expect(ci.indexOf('      - name: Type Check Tests (full, report-only)')).toBeGreaterThan(ci.indexOf('      - name: Test\n'));
    const body = runBody(step);
    expect(body).toContain('npm run typecheck:tests:full > typecheck-tests-full.log 2>&1');
    expect(body[body.length - 1]).toBe('exit $status');
    expect(body.some((l) => l.includes('[typecheck:tests:full] exit=$status errors=$errors files=${files}'))).toBe(true);
    expect(body.some((l) => l.includes('::warning::') && l.includes('语法'))).toBe(true);
    const ifLine = nonCommentLines(step).find((l) => /^\s{8}if:/.test(l));
    expect(ifLine).toContain("steps.build.outcome == 'success'");
  });

  it('coverage job：与 test 并行（头部无 if/needs）、VITEST_MAX_FORKS=1、跑批落日志交判定器裁决，run 体逐行精确钉死防 YAML 接线空转', () => {
    const job = jobBlock('coverage');
    const header = job.slice(0, job.indexOf('    steps:'));
    expect(header).not.toMatch(/^\s{4}(?:if|needs):/m);
    const step = stepBlock('coverage', 'Coverage (thresholds enforced)');
    // F292：负向 grep 放行判据（ANSI 盲区 + 从未正向确认通过汇总/覆盖率表）已抽成可单测纯函数
    // scripts/lib/coverage-gate-core.mjs（tests/unit/coverage-gate.test.ts 承载判定行为），
    // YAML 步骤退化为「跑批落日志 → 交判定器 → 用判定器的 exit code 收尾」。
    //
    // delta 轮对抗审查（角 A fail-open）实测：旧的 `toContain` 逐行断言在下列四种变异体下
    // 全部漏放（本机逐一实跑验证，见 verification/mutation-evidence.md）：
    //   (A) `gate_status=$?` 后插一行 `gate_status=0`（强制放行）
    //   (B) 追加第二次判定调用 `node scripts/coverage-gate.mjs coverage.log "0" || true`
    //   (D) `status=$?` 后插一行 `status=0`（让判定器永远只看到 status=0）
    //   (E) 步骤级加 `if: false`（整段判定空转，job 直接绿）
    // toContain 只查子串存在，不查行序、不查有没有被后续行覆盖、更不查步骤有没有被条件
    // 跳过——改整串 `toEqual` 精确钉 6 行序列 + 步骤级 if 不存在性断言 + SWALLOW 检查。
    const body = runBody(step);
    expect(body).toEqual([
      'set +e',
      'npm run test:coverage > coverage.log 2>&1',
      'status=$?',
      'node scripts/coverage-gate.mjs coverage.log "${status}"',
      'gate_status=$?',
      'exit "${gate_status}"',
    ]);
    const ifLine = nonCommentLines(step).find((l) => /^\s{8}if:/.test(l));
    expect(ifLine, 'coverage 步不应有步骤级 if（会让整段判定空转，job 直接绿）').toBeUndefined();
    for (const l of body.filter((line) => /^(?:npm|npx|node)\b/.test(line))) expect(l).not.toMatch(SWALLOW);
    // 反向断言：旧的内联负向 grep 逻辑不得复活（防止"脚本加了但旧分支没删"的双轨制）
    expect(step).not.toMatch(/grep -qE 'does not meet/);
    expect(step).not.toMatch(/Timeout calling "onTaskUpdate"/);
    expect(step).not.toMatch(/::warning::vitest birpc/);
    expect(step).not.toMatch(/tail -n 40/);
    // coverage-gate-core.mjs 必须真的含 birpc **家族**签名正则（防止判定器把这条检查删掉、
    // 改名，或退化回钉死单个方法名字面量——delta 轮 R3 已改用家族正则容忍不同 RPC 通道/
    // 方法名，故这里不再钉 `onTaskUpdate` 字面量，改钉家族正则的判别性片段）
    const gateCore = read('scripts/lib/coverage-gate-core.mjs');
    expect(gateCore).toContain('vitest-(?:worker|pool|api)');
    expect(gateCore).toContain('Timeout calling');
    expect(step).toMatch(/^\s{10}VITEST_MAX_FORKS: ["']1["']$/m);
    expect(step).not.toMatch(/continue-on-error/);
    expect(job).toContain('run: node dist/cli/index.js batch --mode graph-only');
  });

  it('coverage job 上传 coverage.log artifact（if: always()，v4）', () => {
    const step = stepBlock('coverage', 'Upload coverage log');
    expect(step).toMatch(/^\s{8}if: always\(\)$/m);
    expect(step).toMatch(/uses: actions\/upload-artifact@v4$/m);
    expect(step).toContain('path: coverage.log');
  });

  it('覆盖率阈值 key 与 include 条目指向真实文件（对抗复审 A-W1：vitest 对 glob 空匹配静默按 100% 通过，文件改名即阈值蒸发）', () => {
    const config = read('vitest.config.ts');
    const thresholdsAt = config.indexOf('thresholds: {');
    expect(thresholdsAt).toBeGreaterThan(0);
    const thresholdsBlock = config.slice(thresholdsAt, config.indexOf('\n      },', thresholdsAt));
    const keys = [...thresholdsBlock.matchAll(/^\s+'([^']+)':\s*\{/gm)].map((m) => m[1]!);
    expect(keys.length).toBe(6);
    for (const key of keys) expect(fs.existsSync(path.join(repoRoot, key)), `阈值 key ${key} 不指向真实文件`).toBe(true);
    const includeBlock = config.slice(config.indexOf('include: ['), config.indexOf(']', config.indexOf('include: [')));
    const includes = [...includeBlock.matchAll(/'([^']+\.mjs)'/g)].map((m) => m[1]!);
    expect(includes.length).toBe(4);
    for (const rel of includes) expect(fs.existsSync(path.join(repoRoot, rel)), `coverage.include ${rel} 不存在`).toBe(true);
  });

  it('API key 型 claude-code-action 审查工作流不复活（钉性质不钉文件名；baseline-collect 的评测 API key 是另一回事，不在此列）', () => {
    const dir = path.join(repoRoot, '.github', 'workflows');
    expect(fs.existsSync(path.join(dir, 'claude-review.yml'))).toBe(false);
    for (const f of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8'), `${f} 含 claude-code-action`).not.toMatch(/claude-code-action/);
    }
  });
});
