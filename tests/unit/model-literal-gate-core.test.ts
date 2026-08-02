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
 *
 * Codex implement 审查修复轮 W2（fail-open 修复）：required 扫描面（5 文件 + 2 skill
 * 目录）缺失或读取失败必须 fail，不再像旧实现那样把"文件不存在"和"零命中"一视同仁。
 * 因此除专门验证 fail-open 修复的用例外，其余用例统一先落地
 * `writeRequiredBaseline()` 补齐必需扫描面基线，避免因缺失必需目标而与用例本身
 * 想验证的"offender 检测/正则边界"语义混淆。
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
    evidence: {
      offenders?: Offender[];
      scannedFiles?: number;
      plannedTargets?: string[];
      actuallyReadFiles?: string[];
      missingTargets?: string[];
      readErrors?: Array<{ relPath: string; message: string }>;
    };
  }>;
  warnings: string[];
  errors: string[];
}

const REQUIRED_BASELINE_FILES = [
  'README.md',
  'plugins/spec-driver/README.md',
  'docs/configuration.md',
  'plugins/spec-driver/templates/spec-driver.config-template.yaml',
  'plugins/spec-driver/scripts/codex-skills.sh',
];

const REQUIRED_BASELINE_DIRS = [
  'plugins/spec-driver/skills',
  'plugins/spec-driver/skills-codex',
];

function writeFixtureFile(root: string, relPath: string, content: string) {
  const target = join(root, relPath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf-8');
}

/** 补齐 required 扫描面基线（无版本字面量的合法内容），供非 fail-open 专项用例复用。 */
function writeRequiredBaseline(root: string) {
  for (const relPath of REQUIRED_BASELINE_FILES) {
    writeFixtureFile(root, relPath, '基线内容，无版本字面量占位。');
  }
  for (const relDir of REQUIRED_BASELINE_DIRS) {
    mkdirSync(join(root, relDir), { recursive: true });
  }
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
    writeRequiredBaseline(fixtureRoot);
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
    writeRequiredBaseline(fixtureRoot);
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

  it('固定清单之外的路径不受门禁约束（豁免路径级机械验证）', () => {
    // 固定清单不含 tests/**，即使含具体版本字面量也不应被扫描命中。
    writeRequiredBaseline(fixtureRoot);
    writeFixtureFile(fixtureRoot, 'tests/fixtures/whatever.md', 'gpt-5.4 出现在非扫描路径');

    const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

    expect(result.status).toBe('pass');
    const check = result.checks.find((c) => c.id === 'model-literal-scan');
    expect(check!.evidence.offenders ?? []).toEqual([]);
  });

  it('glob 扫描面（skills/**/SKILL.md）能定位到嵌套目录中的命中', () => {
    writeRequiredBaseline(fixtureRoot);
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

  // Codex implement 审查修复轮 W2 — fail-open CRITICAL 修复专项用例
  describe('fail-open 修复（W2）：required 扫描面缺失/projectRoot 无效必须 fail，而非静默 pass', () => {
    it('--project-root 指向不存在目录 → status=fail（非静默 pass，杜绝路径打错的 fail-open）', () => {
      const nonexistentRoot = join(fixtureRoot, 'does-not-exist');

      const result = validateModelLiteralGate({ projectRoot: nonexistentRoot }) as GateResult;

      expect(result.status).toBe('fail');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('required 扫描面（5 文件 + 2 skill 目录）齐全，仅缺可选 .codex/skills → status=pass + warning（未 install 合法缺席）', () => {
      writeRequiredBaseline(fixtureRoot);
      // 有意不创建 .codex/skills —— 未 install 场景

      const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

      expect(result.status).toBe('pass');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('.codex/skills'))).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('required 文件缺失（如 plugins/spec-driver/README.md 未创建）→ status=fail，errors 指明缺失目标', () => {
      // 只创建除 plugins/spec-driver/README.md 外的其余必需目标
      for (const relPath of REQUIRED_BASELINE_FILES) {
        if (relPath === 'plugins/spec-driver/README.md') continue;
        writeFixtureFile(fixtureRoot, relPath, '基线内容，无版本字面量占位。');
      }
      for (const relDir of REQUIRED_BASELINE_DIRS) {
        mkdirSync(join(fixtureRoot, relDir), { recursive: true });
      }

      const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

      expect(result.status).toBe('fail');
      const check = result.checks.find((c) => c.id === 'model-literal-scan');
      expect(check!.evidence.missingTargets).toContain('plugins/spec-driver/README.md');
      expect(result.errors.some((e) => e.includes('plugins/spec-driver/README.md'))).toBe(true);
    });

    it('required skill 镜像目录缺失（plugins/spec-driver/skills-codex 未创建）→ status=fail，errors 指明该目录', () => {
      for (const relPath of REQUIRED_BASELINE_FILES) {
        writeFixtureFile(fixtureRoot, relPath, '基线内容，无版本字面量占位。');
      }
      mkdirSync(join(fixtureRoot, 'plugins/spec-driver/skills'), { recursive: true });
      // 有意不创建 plugins/spec-driver/skills-codex

      const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

      expect(result.status).toBe('fail');
      const check = result.checks.find((c) => c.id === 'model-literal-scan');
      expect(check!.evidence.missingTargets).toContain('plugins/spec-driver/skills-codex');
    });

    it('scannedFiles 语义 = 实际读取数：required 全齐无 offender 时应等于 REQUIRED_BASELINE_FILES 长度', () => {
      writeRequiredBaseline(fixtureRoot);

      const result = validateModelLiteralGate({ projectRoot: fixtureRoot }) as GateResult;

      expect(result.status).toBe('pass');
      const check = result.checks.find((c) => c.id === 'model-literal-scan');
      expect(check!.evidence.scannedFiles).toBe(REQUIRED_BASELINE_FILES.length);
      expect(check!.evidence.actuallyReadFiles).toHaveLength(REQUIRED_BASELINE_FILES.length);
    });
  });
});
