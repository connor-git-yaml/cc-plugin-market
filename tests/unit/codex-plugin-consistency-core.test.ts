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
// Feature 238：spec-driver-refactor 的 Codex wrapper 缺口已补齐（9/9 完整），
// happy fixture 天然零缺口、零 waiver；缺口场景改用 synthesizeGap 在测试内部人工合成。
const SPEC_DRIVER_CODEX_IDS = [
  'spec-driver-constitution',
  'spec-driver-feature',
  'spec-driver-implement',
  'spec-driver-story',
  'spec-driver-fix',
  'spec-driver-resume',
  'spec-driver-sync',
  'spec-driver-doc',
  'spec-driver-refactor',
];
const SPEC_DRIVER_CANONICAL_IDS = SPEC_DRIVER_CODEX_IDS;

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

interface SyntheticWaiver {
  id: string;
  scope: string;
  missingSkillIds: string[];
  description?: string;
  tracking?: string;
  removalCondition?: string;
}

function renderWaiverBlock(waiver: SyntheticWaiver): string {
  const lines = [
    `  - id: "${waiver.id}"`,
    `    scope: "${waiver.scope}"`,
    '    missingSkillIds:',
    ...waiver.missingSkillIds.map((id) => `      - "${id}"`),
    `    description: "${waiver.description ?? 'synthetic waiver for test'}"`,
    `    tracking: "${waiver.tracking ?? 'test-only'}"`,
    `    removalCondition: "${waiver.removalCondition ?? 'test-only, removed automatically after each test'}"`,
  ];
  return lines.join('\n');
}

// Feature 238（T1.1）：在 fixture 内人工合成一个 canonical→codex 缺口 + 可选 waiver 覆盖，
// 取代此前直接依赖真实 spec-driver-refactor 缺口的做法（该缺口已随 FR-101/102 补齐）。
// (a) 从拷贝的 wrapper-source-of-truth.yaml 删除 skillId 对应 entry（制造合成缺口）
// (b) rmSync fixture 内对应 skills-codex/<skillId> 目录，防止"目录仍在但 entry 缺失"污染
//     skill-count / skills-reference 检查
// (c) 按参数把 waiverEntries 写入拷贝的 codex-plugin-consistency.yaml（空数组即"无 waiver 覆盖"）
function synthesizeGap(fixtureRoot: string, skillId: string, waiverEntries: SyntheticWaiver[] = []) {
  const wrapperContractPath = join(fixtureRoot, 'plugins/spec-driver/contracts/wrapper-source-of-truth.yaml');
  const originalWrapperContract = readFileSync(wrapperContractPath, 'utf-8');
  const entryBlockPattern = new RegExp(`\\n    - id: "${skillId}"\\n(?:      .*\\n)*`);
  const patchedWrapperContract = originalWrapperContract.replace(entryBlockPattern, '\n');
  if (patchedWrapperContract === originalWrapperContract) {
    throw new Error(`synthesizeGap: 未能在 wrapper-source-of-truth.yaml 中定位 entry "${skillId}"`);
  }
  writeFileSync(wrapperContractPath, patchedWrapperContract, 'utf-8');

  rmSync(join(fixtureRoot, 'plugins/spec-driver/skills-codex', skillId), { recursive: true, force: true });

  const contractPath = join(fixtureRoot, 'contracts/codex-plugin-consistency.yaml');
  const originalContract = readFileSync(contractPath, 'utf-8');
  // 生产合同 FR-103 落地后不含 waivers 段；waiverEntries 为空时无需写入 waivers 键。
  if (waiverEntries.length === 0) {
    return;
  }
  const waiversYaml = ['waivers:', ...waiverEntries.map(renderWaiverBlock)].join('\n');
  const withWaivers = originalContract.includes('\nwaivers:')
    ? originalContract.replace(/\nwaivers:[\s\S]*$/m, `\n${waiversYaml}\n`)
    : `${originalContract}${originalContract.endsWith('\n') ? '' : '\n'}${waiversYaml}\n`;
  writeFileSync(contractPath, withWaivers, 'utf-8');
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

  // ---- CRITICAL #6(a)：waiver 精确删除模拟（Feature 238 改为 synthesizeGap 合成缺口） ----
  it('删除 waiver → canonical-vs-codex-gap fail 且 error 指名合成 gap id', () => {
    // 人工摘除 spec-driver-doc 的 entry + 目录，制造合成缺口，且不写入任何 waiver
    synthesizeGap(root, 'spec-driver-doc', []);

    const result = run(root);
    expect(result.status).toBe('fail');
    expect(checkById(result, 'canonical-vs-codex-gap:spec-driver')?.status).toBe('fail');
    // error 消息必须明确指名合成 gap id（不接受用其他 skill id 冒充）
    expect(result.errors.join('\n')).toContain('spec-driver-doc');
  });

  it('waiver 覆盖时 canonical-vs-codex-gap pass 且 evidence 记 {skillId, waiverId} 对', () => {
    synthesizeGap(root, 'spec-driver-doc', [
      { id: 'synthetic-gap-waiver', scope: 'spec-driver', missingSkillIds: ['spec-driver-doc'] },
    ]);

    const result = run(root);
    const check = checkById(result, 'canonical-vs-codex-gap:spec-driver');
    expect(check?.status).toBe('pass');
    // W1：evidence 记 {skillId, waiverId} 对（非纯 skill id），可回溯每个缺口的豁免来源
    const waived = (check?.evidence as { waived: Array<{ skillId: string; waiverId: string }> }).waived;
    expect(waived).toContainEqual({ skillId: 'spec-driver-doc', waiverId: 'synthetic-gap-waiver' });
  });

  // ---- W1：waiver 审计负例 ----
  it('陈旧 waiver（覆盖的 skill 已不在 gap）→ warning，但 gap check 仍 pass', () => {
    // 场景：waiver 多覆盖了一个已被 Codex 适配（不在 gap 中）的 skill（如 spec-driver-implement）。
    // 该多余覆盖是"陈旧 waiver"典型形态（A2 补齐后忘删）——核心须报 warning 提示删除。
    synthesizeGap(root, 'spec-driver-doc', [
      {
        id: 'synthetic-gap-waiver',
        scope: 'spec-driver',
        missingSkillIds: ['spec-driver-doc', 'spec-driver-implement'],
      },
    ]);

    const result = run(root);
    // 真实合成缺口（spec-driver-doc）仍被覆盖 → canonical-vs-codex-gap pass；
    // 陈旧覆盖（spec-driver-implement）触发 warning
    expect(checkById(result, 'canonical-vs-codex-gap:spec-driver')?.status).toBe('pass');
    expect(result.warnings.join('\n')).toContain('陈旧 waiver');
    expect(result.warnings.join('\n')).toContain('spec-driver-implement');
    expect(result.status).toBe('warn');
  });

  it('重复 waiver id → warning', () => {
    synthesizeGap(root, 'spec-driver-doc', [
      { id: 'synthetic-gap-waiver', scope: 'spec-driver', missingSkillIds: ['spec-driver-doc'] },
      { id: 'synthetic-gap-waiver', scope: 'spec-driver', missingSkillIds: ['spec-driver-doc'] },
    ]);
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
    // Feature 238：生产合同不再含真实缺口 waiver，改为对 synthesizeGap 写入的合成 waiver
    // 做数组 shape 校验，不再断言字面量 ['spec-driver-refactor']。
    synthesizeGap(root, 'spec-driver-doc', [
      { id: 'synthetic-gap-waiver', scope: 'spec-driver', missingSkillIds: ['spec-driver-doc'] },
    ]);
    // @ts-expect-error — .mjs 无类型声明
    const { parseYamlDocument } = await import('../../plugins/spec-driver/scripts/lib/simple-yaml.mjs');
    const doc = parseYamlDocument(readFileSync(join(root, 'contracts/codex-plugin-consistency.yaml'), 'utf-8'));
    const arr = doc.waivers[0].missingSkillIds;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toEqual(['spec-driver-doc']);
  });

  // ---- Feature 238（plan §3.1 步骤5）：生产合同 waivers 为空断言 ----
  it('生产合同 contracts/codex-plugin-consistency.yaml 的 waivers 为空数组或字段不存在', async () => {
    // @ts-expect-error — .mjs 无类型声明
    const { parseYamlDocument } = await import('../../plugins/spec-driver/scripts/lib/simple-yaml.mjs');
    const doc = parseYamlDocument(readFileSync(join(REPO_ROOT, 'contracts/codex-plugin-consistency.yaml'), 'utf-8'));
    const waivers = (doc as { waivers?: unknown[] }).waivers;
    expect(waivers === undefined || (Array.isArray(waivers) && waivers.length === 0)).toBe(true);
  });
});
