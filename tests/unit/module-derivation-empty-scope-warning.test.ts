/**
 * F266 T008（FR-001 / FR-002）— module-derivation 的"空模块图"出声判据。
 *
 * 判据：`scannedCandidateCount > 0 && includedCount === 0` 才 warn——
 * 即"扫到了候选源文件，但全部被 includeOnly 过滤器排除"。空工程（没有候选）不 warn，
 * 因为那是"本来就没东西"，报警只是噪声。
 *
 * 观测方式沿用 module-derivation-warn.test.ts 的 `vi.spyOn(process.stderr, 'write')`：
 * logger 是模块级单例（createLogger('module-derivation')）且默认级别就是 warn → stderr，
 * 没有注入 seam，故在输出侧观测。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModuleGraphForProject } from '../../src/knowledge-graph/module-derivation.js';
import { buildAstGraphOnly } from '../../src/batch/stages/graph-assembly.js';

/** 本卡新增 warn 的稳定标识串（判据命中与否只看它，避免被其他 warn 干扰） */
const EMPTY_SCOPE_MARKER = '模块图为空';

const tmpDirs: string[] = [];

function makeTmpRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(root);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {} }), 'utf8');
  return root;
}

/** 造 lib/ 布局工程（两个互相 import 的 .ts，源码不在 src/ 下） */
function makeLibLayoutProject(): string {
  const root = makeTmpRoot('f266-lib-layout-');
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'lib', 'core.ts'), 'export const answer = 42;\n', 'utf8');
  writeFileSync(
    join(root, 'lib', 'app.ts'),
    "import { answer } from './core.js';\nexport const show = (): number => answer;\n",
    'utf8',
  );
  return root;
}

/** 收集 stderr 上命中标识串的行（默认 logger 级别是 warn，故 info 档默认不出现在这里） */
function emptyScopeWarns(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map((c) => String(c[0]))
    .filter((line) => line.includes(EMPTY_SCOPE_MARKER));
}

describe('buildModuleGraphForProject — 空模块图出声判据（F266 FR-001）', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    stderrSpy?.mockRestore();
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('扫到候选但 includeOnly 命中 0（lib/ 布局）→ warn 触发，含正则字面量与样例路径', async () => {
    const root = makeLibLayoutProject();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    const warns = emptyScopeWarns(stderrSpy);
    expect(warns.length).toBe(1);
    const line = warns[0]!;
    // 生效的 includeOnly 正则字面量
    expect(line).toContain('/^src\\//');
    // 被滤掉的候选数（lib/core.ts + lib/app.ts）
    expect(line).toContain('2 个候选源文件');
    // ≤3 条样例路径
    expect(line).toContain('lib/app.ts');
    expect(line).toContain('lib/core.ts');
    // 如实描述：默认过滤器 + 没有对外开关；且 MUST NOT 断言"本项目源码不在该目录下"
    // （对抗审查 B2：那对根级只躺着构建配置的 py/go 工程是假话）
    expect(line).toContain('默认过滤器');
    expect(line).toContain('该过滤器当前没有对外开关');
    expect(line).toContain('未在 src/ 下发现 TS/JS 源码');
    expect(line).not.toContain('本项目源码不在该目录下');
    expect(line).not.toMatch(/--include-only|includeOnly 选项|配置项/);
  });

  it('样例路径最多 3 条（不刷屏）', async () => {
    const root = makeTmpRoot('f266-lib-many-');
    mkdirSync(join(root, 'lib'), { recursive: true });
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(join(root, 'lib', `m${i}.ts`), `export const v${i} = ${i};\n`, 'utf8');
    }

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    const line = emptyScopeWarns(stderrSpy)[0]!;
    expect(line).toContain('6 个候选源文件');
    const samples = line.split('被排除样例：')[1]!.trim();
    expect(samples.split(', ').length).toBe(3);
  });

  it('扫到 0 个候选（空工程）→ 不 warn（"本来就没东西"不是布局不匹配）', async () => {
    const root = makeTmpRoot('f266-empty-proj-');

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    expect(emptyScopeWarns(stderrSpy)).toEqual([]);
  });

  it('src 布局命中 >0 → 不 warn（正常项目零噪声）', async () => {
    const root = makeTmpRoot('f266-src-layout-');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    expect(emptyScopeWarns(stderrSpy)).toEqual([]);
  });

  it('src 布局但全是测试文件 → 仍不 warn（布局匹配，只是内容全被测试过滤器排除）', async () => {
    const root = makeTmpRoot('f266-src-tests-only-');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.test.ts'), 'export const t = 1;\n', 'utf8');

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    expect(emptyScopeWarns(stderrSpy)).toEqual([]);
  });
});

describe('出声档位按结构分（对抗审查 B2：py/go 工程的根级构建配置不该每次报警）', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    stderrSpy?.mockRestore();
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('被滤候选全是扫描根顶层文件（py 工程 + 根级 eslint.config.js）→ 降为 info，默认不可见', async () => {
    const root = makeTmpRoot('f266-py-with-config-');
    writeFileSync(join(root, 'main.py'), 'x = 1\n', 'utf8');
    writeFileSync(join(root, 'eslint.config.js'), 'export default [];\n', 'utf8');
    writeFileSync(join(root, 'webpack.config.js'), 'module.exports = {};\n', 'utf8');

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    // 默认 logger 级别是 warn ⇒ info 档一行都不落 stderr（零噪声）
    expect(emptyScopeWarns(stderrSpy)).toEqual([]);
  });

  it('同一工程把日志级别调到 info → 该行可查（降档不是丢弃）', async () => {
    const root = makeTmpRoot('f266-py-with-config-verbose-');
    writeFileSync(join(root, 'main.py'), 'x = 1\n', 'utf8');
    writeFileSync(join(root, 'eslint.config.js'), 'export default [];\n', 'utf8');

    const prev = process.env['REVERSE_SPEC_LOG_LEVEL'];
    process.env['REVERSE_SPEC_LOG_LEVEL'] = 'info';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      await buildModuleGraphForProject(root);
    } finally {
      if (prev === undefined) delete process.env['REVERSE_SPEC_LOG_LEVEL'];
      else process.env['REVERSE_SPEC_LOG_LEVEL'] = prev;
    }

    const lines = emptyScopeWarns(stderrSpy);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('eslint.config.js');
  });

  it('被滤候选中存在嵌套路径（lib/ 布局）→ 维持 warn 档', async () => {
    const root = makeLibLayoutProject();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    expect(emptyScopeWarns(stderrSpy).length).toBe(1);
  });

  it('顶层配置 + 嵌套源码混合 → 只要有一个嵌套候选就 warn（不被顶层文件稀释）', async () => {
    const root = makeTmpRoot('f266-mixed-nested-');
    writeFileSync(join(root, 'eslint.config.js'), 'export default [];\n', 'utf8');
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'core.ts'), 'export const a = 1;\n', 'utf8');

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root);

    expect(emptyScopeWarns(stderrSpy).length).toBe(1);
  });

  it('自定义 includeOnly → 回显实际 regex，且不提"没有对外开关"（那句只对默认过滤器成立）', async () => {
    const root = makeLibLayoutProject();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildModuleGraphForProject(root, { includeOnly: '^packages/' });

    const line = emptyScopeWarns(stderrSpy)[0]!;
    expect(line).toContain(String(/^packages\//));
    expect(line).not.toContain('没有对外开关');
    expect(line).not.toContain('未在 src/ 下发现');
  });
});

describe('graph-only 路径不触发本 warn（F266 FR-002 回归网）', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    stderrSpy?.mockRestore();
    while (tmpDirs.length > 0) {
      const d = tmpDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it('同一 lib/ 布局工程跑 buildAstGraphOnly → 本 warn 零次（graph-only 不经模块派生）', async () => {
    const root = makeLibLayoutProject();

    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await buildAstGraphOnly(root, { outputDir: join(root, 'specs') });

    // "graph-only 不经 selectPrimaryModuleGraph" 是隐性前提，此处把它固化成显性回归网
    expect(emptyScopeWarns(stderrSpy)).toEqual([]);
  });
});
