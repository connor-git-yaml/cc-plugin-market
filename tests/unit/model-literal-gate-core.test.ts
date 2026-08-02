/**
 * Feature 238 T5.1（FR-310）：模型字面量 grep 门禁核心模块单测。
 *
 * `validateModelLiteralGate({ projectRoot })` 对 FR-310「Grep 门禁定义」固定扫描清单
 * （README.md / plugins/spec-driver/README.md / docs/configuration.md /
 * spec-driver.config-template.yaml / skills 三处镜像 / codex-skills.sh）逐一扫描，
 * pattern 右边界（negative lookahead）杜绝 `gpt-50`/`gpt-5x` 一类非目标字面量误报。
 *
 * 测试策略：构造临时 fixtureRoot，仅在固定清单命中的相对路径下放置内容——
 * 与 codex-plugin-consistency-core.test.ts 已用的"拷贝/构造真实路径树"手法一致。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { validateModelLiteralGate } from '../../scripts/lib/model-literal-gate-core.mjs';

interface Offender {
  file: string;
  line: number;
  match: string;
}

interface GateResult {
  status: string;
  checks: Array<{
    id: string;
    title: string;
    status: string;
    evidence: { offenders?: Offender[]; scannedFiles?: number };
  }>;
  warnings: string[];
  errors: string[];
}

function writeFixtureFile(root: string, relPath: string, content: string) {
  const target = join(root, relPath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf-8');
}

describe('validateModelLiteralGate（FR-310）', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'model-literal-gate-'));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('命中 gpt-5.4 / gpt-5.6-sol / gpt-5-mini 三类字面量，offenders 精确定位到文件+行号', () => {
    writeFixtureFile(
      fixtureRoot,
      'README.md',
      ['# Demo', 'line1 无关内容', 'Codex 固定使用 gpt-5.4 模型', 'line4'].join('\n'),
    );
    writeFixtureFile(
      fixtureRoot,
      'docs/configuration.md',
      ['一些说明', '    sonnet: gpt-5.6-sol', '结尾'].join('\n'),
    );
    writeFixtureFile(
      fixtureRoot,
      'plugins/spec-driver/templates/spec-driver.config-template.yaml',
      ['defaults:', '  codex: gpt-5-mini'].join('\n'),
    );

    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('fail');
    const check = result.checks.find((c) => c.id === 'model-literal-scan');
    expect(check, '缺失 model-literal-scan check').toBeDefined();
    expect(check!.status).toBe('fail');

    const offenders = check!.evidence.offenders ?? [];
    expect(offenders.length).toBe(3);

    const byFile = new Map(offenders.map((o) => [o.file, o]));

    const readmeOffender = byFile.get('README.md');
    expect(readmeOffender, 'README.md 应命中 gpt-5.4').toBeDefined();
    expect(readmeOffender!.line).toBe(3);
    expect(readmeOffender!.match.toLowerCase()).toContain('gpt-5.4');

    const configOffender = byFile.get('docs/configuration.md');
    expect(configOffender, 'docs/configuration.md 应命中 gpt-5.6-sol').toBeDefined();
    expect(configOffender!.line).toBe(2);
    expect(configOffender!.match.toLowerCase()).toContain('gpt-5.6-sol');

    const templateOffender = byFile.get('plugins/spec-driver/templates/spec-driver.config-template.yaml');
    expect(templateOffender, 'template 应命中 gpt-5-mini').toBeDefined();
    expect(templateOffender!.line).toBe(2);
    expect(templateOffender!.match.toLowerCase()).toContain('gpt-5-mini');
  });

  it('对 gpt-50 / gpt-5x（非目标字面量，右边界断言生效）不误报', () => {
    writeFixtureFile(
      fixtureRoot,
      'README.md',
      ['这是 gpt-50 型号的说明', '另起一行 gpt-5x 变体', '结束'].join('\n'),
    );

    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('pass');
    const check = result.checks.find((c) => c.id === 'model-literal-scan');
    expect(check, '缺失 model-literal-scan check').toBeDefined();
    expect(check!.status).toBe('pass');
    expect(check!.evidence.offenders ?? []).toEqual([]);
  });

  it('固定扫描清单之外的路径不受门禁约束（豁免路径级机械验证）', () => {
    // 固定清单不含 tests/**，即使含具体版本字面量也不应被扫描命中。
    writeFixtureFile(fixtureRoot, 'tests/fixtures/whatever.md', 'gpt-5.4 出现在非扫描路径');

    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('pass');
    const check = result.checks.find((c) => c.id === 'model-literal-scan');
    expect(check!.evidence.offenders ?? []).toEqual([]);
  });

  it('glob 扫描面（skills/**/SKILL.md）能定位到嵌套目录中的命中', () => {
    writeFixtureFile(
      fixtureRoot,
      'plugins/spec-driver/skills/spec-driver-implement/SKILL.md',
      ['正文', 'Codex 下默认将 opus/sonnet/haiku 映射到 gpt-5.4', '尾行'].join('\n'),
    );

    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('fail');
    const check = result.checks.find((c) => c.id === 'model-literal-scan');
    const offenders = check!.evidence.offenders ?? [];
    expect(offenders).toHaveLength(1);
    expect(offenders[0].file).toBe('plugins/spec-driver/skills/spec-driver-implement/SKILL.md');
    expect(offenders[0].line).toBe(2);
  });

  it('固定清单中不存在的路径（如未安装 .codex/skills）不报错，正常返回 pass', () => {
    // fixtureRoot 内完全没有任何扫描面文件，验证"文件不存在"分支不抛异常。
    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('pass');
    expect(result.errors).toEqual([]);
  });
});
