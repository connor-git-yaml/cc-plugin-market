import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { validateCodexPluginConsistency } from '../../scripts/lib/codex-plugin-consistency-core.mjs';

const REPO_ROOT = resolve('.');

const SPECTRA_SKILL_IDS = ['spectra', 'spectra-batch', 'spectra-diff'];
const SPEC_DRIVER_CODEX_IDS = [
  'spec-driver-constitution',
  'spec-driver-feature',
  'spec-driver-implement',
  'spec-driver-story',
  'spec-driver-fix',
  'spec-driver-resume',
  'spec-driver-sync',
  'spec-driver-doc',
];
// canonical 比 codex 多一个 spec-driver-refactor（已知缺口，由 waiver 覆盖）
const SPEC_DRIVER_CANONICAL_IDS = [...SPEC_DRIVER_CODEX_IDS, 'spec-driver-refactor'];

interface CheckResult {
  status: string;
  checks: Array<{ id: string; title: string; status: string; evidence: Record<string, unknown> }>;
  warnings: string[];
  errors: string[];
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function writeSkillDirs(root: string, ids: string[], body = '# skill\n') {
  for (const id of ids) {
    const skillPath = join(root, id, 'SKILL.md');
    mkdirSync(join(skillPath, '..'), { recursive: true });
    writeFileSync(skillPath, body, 'utf-8');
  }
}

function copyRepoFile(root: string, relativePath: string) {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), target);
}

// 构造一份"全 pass"自包含 fixture：契约 + 两份 manifest + mcp + skills + marketplace。
function buildHappyFixture(root: string) {
  // 契约与 skill/wrapper source-of-truth 直接复制真实文件，保持 entries 与生产同步
  copyRepoFile(root, 'contracts/codex-plugin-consistency.yaml');
  copyRepoFile(root, 'plugins/spectra/contracts/skill-source-of-truth.yaml');
  copyRepoFile(root, 'plugins/spec-driver/contracts/wrapper-source-of-truth.yaml');

  // spectra
  writeJson(join(root, 'plugins/spectra/.codex-plugin/plugin.json'), {
    name: 'spectra',
    skills: './skills/',
    mcpServers: './.mcp.json',
    version: '4.3.0',
    description: 'spectra',
  });
  writeJson(join(root, 'plugins/spectra/.mcp.json'), {
    mcpServers: { spectra: { command: 'spectra', args: ['mcp-server'] } },
  });
  writeSkillDirs(join(root, 'plugins/spectra/skills'), SPECTRA_SKILL_IDS);

  // spec-driver
  writeJson(join(root, 'plugins/spec-driver/.codex-plugin/plugin.json'), {
    name: 'spec-driver',
    skills: './skills-codex/',
    version: '4.3.0',
    description: 'spec-driver',
  });
  writeSkillDirs(join(root, 'plugins/spec-driver/skills-codex'), SPEC_DRIVER_CODEX_IDS);
  writeSkillDirs(join(root, 'plugins/spec-driver/skills'), SPEC_DRIVER_CANONICAL_IDS);

  // marketplace
  writeJson(join(root, '.agents/plugins/marketplace.json'), {
    name: 'cc-plugin-market',
    interface: { displayName: 'Spectra / Spec Driver' },
    plugins: [
      { name: 'spectra', source: { source: 'local', path: './plugins/spectra' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'development' },
      { name: 'spec-driver', source: { source: 'local', path: './plugins/spec-driver' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'development' },
    ],
  });
}

function run(root: string): CheckResult {
  return validateCodexPluginConsistency({ projectRoot: root }) as CheckResult;
}

function checkById(result: CheckResult, id: string) {
  return result.checks.find((c) => c.id === id);
}

describe('validateCodexPluginConsistency', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-consistency-'));
    buildHappyFixture(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('happy path — 全部 check pass，无 error / warning', () => {
    const result = run(root);
    expect(result.status).toBe('pass');
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // 关键 check 均存在且 pass
    for (const id of [
      'manifest-exists:spectra',
      'no-hooks-field:spectra',
      'mcp-servers-reference:spectra',
      'skill-count:spectra',
      'skills-reference:spectra',
      'spectra-skill-neutrality',
      'manifest-exists:spec-driver',
      'no-hooks-field:spec-driver',
      'skill-count:spec-driver-codex-dir',
      'skills-reference:spec-driver',
      'canonical-vs-codex-gap:spec-driver',
      'marketplace-entries',
    ]) {
      expect(checkById(result, id)?.status, id).toBe('pass');
    }
  });

  it('manifest 缺失 → manifest-exists fail', () => {
    rmSync(join(root, 'plugins/spectra/.codex-plugin/plugin.json'));
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'manifest-exists:spectra')?.status).toBe('fail');
  });

  it('manifest JSON 非法 → manifest-exists fail', () => {
    writeFileSync(join(root, 'plugins/spectra/.codex-plugin/plugin.json'), '{ not json', 'utf-8');
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'manifest-exists:spectra')?.status).toBe('fail');
  });

  it('manifest 含 hooks key → no-hooks-field fail', () => {
    writeJson(join(root, 'plugins/spec-driver/.codex-plugin/plugin.json'), {
      name: 'spec-driver',
      skills: './skills-codex/',
      hooks: './hooks/hooks.json',
      version: '4.3.0',
      description: 'x',
    });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'no-hooks-field:spec-driver')?.status).toBe('fail');
  });

  it('.mcp.json 缺 spectra server → mcp-servers-reference fail', () => {
    writeJson(join(root, 'plugins/spectra/.mcp.json'), { mcpServers: {} });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'mcp-servers-reference:spectra')?.status).toBe('fail');
  });

  it('skill-count 不一致（多一个目录）→ skill-count fail', () => {
    writeSkillDirs(join(root, 'plugins/spectra/skills'), ['spectra-extra']);
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'skill-count:spectra')?.status).toBe('fail');
  });

  // ---- CRITICAL #5：skills-reference 负例族 ----
  it('skills-reference:spectra — manifest.skills 值错误 → fail（含具体 error 文本，无关 check 仍 pass）', () => {
    writeJson(join(root, 'plugins/spectra/.codex-plugin/plugin.json'), {
      name: 'spectra',
      skills: './wrong-dir/',
      mcpServers: './.mcp.json',
      version: '4.3.0',
      description: 'x',
    });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'skills-reference:spectra')?.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('manifest.skills 应为 ./skills/');
    // 无关 check 不受污染：manifest-exists / no-hooks / mcp / neutrality 仍 pass
    expect(checkById(result, 'manifest-exists:spectra')?.status).toBe('pass');
    expect(checkById(result, 'no-hooks-field:spectra')?.status).toBe('pass');
    expect(checkById(result, 'mcp-servers-reference:spectra')?.status).toBe('pass');
    expect(checkById(result, 'spectra-skill-neutrality')?.status).toBe('pass');
  });

  it('skills-reference:spec-driver — manifest.skills 值错误 → fail', () => {
    writeJson(join(root, 'plugins/spec-driver/.codex-plugin/plugin.json'), {
      name: 'spec-driver',
      skills: './skills/',
      version: '4.3.0',
      description: 'x',
    });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'skills-reference:spec-driver')?.status).toBe('fail');
  });

  it('skills-reference — 引用目录不存在 → fail', () => {
    rmSync(join(root, 'plugins/spec-driver/skills-codex'), { recursive: true, force: true });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'skills-reference:spec-driver')?.status).toBe('fail');
  });

  it('skills-reference — 目录存在但 skill 身份不符（数量相同伪造 id）→ fail', () => {
    // 删除 spec-driver-doc，换成伪造 id：数量仍为 8，但身份集合不同
    rmSync(join(root, 'plugins/spec-driver/skills-codex/spec-driver-doc'), { recursive: true, force: true });
    writeSkillDirs(join(root, 'plugins/spec-driver/skills-codex'), ['spec-driver-fake']);
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'skills-reference:spec-driver')?.status).toBe('fail');
    // skill-count 仍 pass（数量相同），证明 skills-reference 抓的是身份而非数量
    expect(checkById(result, 'skill-count:spec-driver-codex-dir')?.status).toBe('pass');
  });

  // ---- CRITICAL #6(a)：waiver 精确删除模拟 ----
  it('删除 waiver 段 → canonical-vs-codex-gap fail 且 error 指名 spec-driver-refactor', () => {
    // 从 fixture 精确删除 waivers 段（保留其余契约内容）
    const contractPath = join(root, 'contracts/codex-plugin-consistency.yaml');
    const original = readFileSync(contractPath, 'utf-8');
    const withoutWaivers = original.replace(/\nwaivers:[\s\S]*$/m, '\n');
    expect(withoutWaivers).not.toContain('waivers:');
    writeFileSync(contractPath, withoutWaivers, 'utf-8');

    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'canonical-vs-codex-gap:spec-driver')?.status).toBe('fail');
    // error 消息必须明确指名 spec-driver-refactor（不接受用其他 skill id 冒充）
    expect(result.errors.join('\n')).toContain('spec-driver-refactor');
  });

  it('waiver 覆盖时 canonical-vs-codex-gap pass 且 evidence 记 {skillId, waiverId} 对', () => {
    const result = run(root);
    const check = checkById(result, 'canonical-vs-codex-gap:spec-driver');
    expect(check?.status).toBe('pass');
    // W1：evidence 记 {skillId, waiverId} 对（非纯 skill id），可回溯每个缺口的豁免来源
    const waived = (check?.evidence as { waived: Array<{ skillId: string; waiverId: string }> }).waived;
    expect(waived).toContainEqual({ skillId: 'spec-driver-refactor', waiverId: 'spec-driver-refactor-codex-wrapper-gap' });
  });

  // ---- W1：waiver 审计负例 ----
  it('陈旧 waiver（覆盖的 skill 已不在 gap）→ warning，但 gap check 仍 pass', () => {
    // 场景：waiver 多覆盖了一个已被 Codex 适配（不在 gap 中）的 skill（如 spec-driver-implement）。
    // 该多余覆盖是"陈旧 waiver"典型形态（A2 补齐后忘删）——核心须报 warning 提示删除。
    const contractPath = join(root, 'contracts/codex-plugin-consistency.yaml');
    const original = readFileSync(contractPath, 'utf-8');
    // 在既有 waiver 的 missingSkillIds 后追加一个非 gap skill（spec-driver-implement 已被适配）
    const patched = original.replace(
      '      - "spec-driver-refactor"',
      '      - "spec-driver-refactor"\n      - "spec-driver-implement"',
    );
    expect(patched).not.toBe(original);
    writeFileSync(contractPath, patched, 'utf-8');

    const result = run(root);
    // 真实 gap（refactor）仍被覆盖 → canonical-vs-codex-gap pass；陈旧覆盖（implement）触发 warning
    expect(checkById(result, 'canonical-vs-codex-gap:spec-driver')?.status).toBe('pass');
    expect(result.warnings.join('\n')).toContain('陈旧 waiver');
    expect(result.warnings.join('\n')).toContain('spec-driver-implement');
    expect(result.status).toBe('warn');
  });

  it('重复 waiver id → warning', () => {
    const contractPath = join(root, 'contracts/codex-plugin-consistency.yaml');
    const original = readFileSync(contractPath, 'utf-8');
    // 追加一条与首条同 id 的 waiver
    writeFileSync(
      contractPath,
      `${original}  - id: "spec-driver-refactor-codex-wrapper-gap"\n    scope: "spec-driver"\n    missingSkillIds:\n      - "spec-driver-refactor"\n    description: "dup"\n    removalCondition: "x"\n`,
      'utf-8',
    );
    const result = run(root);
    expect(result.warnings.join('\n')).toContain('waiver id 重复');
  });

  // ---- W2：畸形输入不崩溃（保 {status,checks,warnings,errors} 结构）----
  it('畸形合同（缺 manifests 段）→ 结构化 fail（contract-shape），非 throw', () => {
    writeFileSync(join(root, 'contracts/codex-plugin-consistency.yaml'), 'schemaVersion: 1\nfoo: bar\n', 'utf-8');
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'contract-shape')?.status).toBe('fail');
    // 输出合约完整：四字段俱在
    expect(Array.isArray(result.checks)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('manifest 为 JSON null → manifest-exists fail（不因 `in` 崩溃）', () => {
    writeFileSync(join(root, 'plugins/spectra/.codex-plugin/plugin.json'), 'null', 'utf-8');
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'manifest-exists:spectra')?.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('顶层不是对象');
  });

  // ---- marketplace ----
  it('marketplace 条目缺失 → marketplace-entries fail', () => {
    writeJson(join(root, '.agents/plugins/marketplace.json'), {
      name: 'cc-plugin-market',
      interface: { displayName: 'x' },
      plugins: [
        { name: 'spectra', source: { source: 'local', path: './plugins/spectra' }, policy: {}, category: 'development' },
      ],
    });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'marketplace-entries')?.status).toBe('fail');
  });

  it('marketplace source.path 不匹配 → marketplace-entries fail', () => {
    writeJson(join(root, '.agents/plugins/marketplace.json'), {
      name: 'cc-plugin-market',
      interface: { displayName: 'x' },
      plugins: [
        { name: 'spectra', source: { source: 'local', path: './plugins/WRONG' }, policy: {}, category: 'development' },
        { name: 'spec-driver', source: { source: 'local', path: './plugins/spec-driver' }, policy: {}, category: 'development' },
      ],
    });
    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'marketplace-entries')?.status).toBe('fail');
  });

  // ---- spectra-skill-neutrality（warn，非 error）----
  it('spectra SKILL.md 注入 mcp__plugin_ → spectra-skill-neutrality warn（非 error）', () => {
    writeFileSync(
      join(root, 'plugins/spectra/skills/spectra/SKILL.md'),
      '# skill\n调用 mcp__plugin_spectra_spectra__context 工具\n',
      'utf-8',
    );
    const result = run(root);
    // 仅 warn，不产生 error，整体 status 为 warn
    expect(checkById(result, 'spectra-skill-neutrality')?.status).toBe('warn');
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('warn');
  });

  // ---- 合同可被 simple-yaml 完整解析守护 ----
  it('契约 waivers[].missingSkillIds 是数组（块级序列）而非字符串标量', async () => {
    // @ts-expect-error — .mjs 无类型声明
    const { parseYamlDocument } = await import('../../plugins/spec-driver/scripts/lib/simple-yaml.mjs');
    const doc = parseYamlDocument(readFileSync(join(root, 'contracts/codex-plugin-consistency.yaml'), 'utf-8'));
    const arr = doc.waivers[0].missingSkillIds;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toEqual(['spec-driver-refactor']);
  });
});
