/**
 * delegation-contract.test.mjs
 * Feature 185 — spec-driver 委派契约收口测试
 *
 * 测试组：
 *   T1: lib 纯函数（extractCanonicalBlock / wrapWithMarkers / computeExpectedSkillContent）
 *   T2: validateDelegationContract（同步后无漂移 pass；改注入块一字报漂移；tmp fixture）
 *   T3: validateOrchestratorModels（5 SKILL 全 opus pass；model=sonnet fail；tmp fixture）
 *
 * 运行方式: node --test plugins/spec-driver/tests/delegation-contract.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  extractCanonicalBlock,
  wrapWithMarkers,
  computeExpectedSkillContent,
  BEGIN_MARKER,
  END_MARKER,
} from '../lib/delegation-contract.mjs';
import {
  syncDelegationContract,
  validateDelegationContract,
} from '../scripts/sync-delegation-contract.mjs';
import { validateOrchestratorModels } from '../scripts/validate-orchestrator-models.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 构造一个最小但完整的临时 plugin 树骨架（templates + 5 SKILL + .codex 5 SKILL）。 */
function makeTmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f185-'));
  const skillsDir = path.join(root, 'plugins/spec-driver/skills');
  const templatesDir = path.join(root, 'plugins/spec-driver/templates');
  const codexDir = path.join(root, '.codex/skills');
  fs.mkdirSync(templatesDir, { recursive: true });
  // 复制真实 template 作为单一事实源
  const realTemplate = fs.readFileSync(
    path.join(REPO_ROOT, 'plugins/spec-driver/templates/delegation-contract.md'),
    'utf-8',
  );
  fs.writeFileSync(path.join(templatesDir, 'delegation-contract.md'), realTemplate, 'utf-8');

  const anchors = {
    fix: '## 工作流定义',
    story: '## 工作流定义',
    feature: '## 工作流执行（动态模式）',
    implement: '## 工作流定义',
    resume: '## 恢复后执行流程',
  };
  for (const [mode, anchor] of Object.entries(anchors)) {
    const body = `---\nname: spec-driver-${mode}\nmodel: opus\n---\n\n# Skill ${mode}\n\n${anchor}\n\n正文。\n`;
    const dir = path.join(skillsDir, `spec-driver-${mode}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), body, 'utf-8');
    const cdir = path.join(codexDir, `spec-driver-${mode}`);
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, 'SKILL.md'), body, 'utf-8');
  }
  return { root, anchors, realTemplate };
}

/** 模拟 repo:sync 的 codex-wrappers 再生步骤：把 plugins 层 SKILL body 镜像到 .codex 层。 */
function mirrorPluginsToCodex(root, modes) {
  for (const mode of modes) {
    const src = path.join(root, 'plugins/spec-driver/skills', `spec-driver-${mode}`, 'SKILL.md');
    const dst = path.join(root, '.codex/skills', `spec-driver-${mode}`, 'SKILL.md');
    fs.writeFileSync(dst, fs.readFileSync(src, 'utf-8'), 'utf-8');
  }
}

describe('F185 lib 纯函数', () => {
  const TPL = [
    '前置文档头（应被丢弃）',
    '<!-- delegation-contract:block-start -->',
    '> 约束行 1',
    '> 约束行 2',
    '<!-- delegation-contract:block-end -->',
    '尾部（应被丢弃）',
  ].join('\n');

  it('extractCanonicalBlock 取 block-start/block-end 之间内容', () => {
    assert.equal(extractCanonicalBlock(TPL), '> 约束行 1\n> 约束行 2');
  });

  it('extractCanonicalBlock 缺 block-end → throw（fail-loud）', () => {
    const broken = '<!-- delegation-contract:block-start -->\n> 约束行';
    assert.throws(() => extractCanonicalBlock(broken), /block-end/);
  });

  it('extractCanonicalBlock 无 block-start → 原样返回（兼容单测直传 block）', () => {
    assert.equal(extractCanonicalBlock('> 裸块'), '> 裸块');
  });

  it('wrapWithMarkers 用 BEGIN/END 包裹并 trimEnd', () => {
    const wrapped = wrapWithMarkers('> 块\n\n');
    assert.equal(wrapped, `${BEGIN_MARKER}\n> 块\n${END_MARKER}`);
  });

  it('computeExpectedSkillContent 首次在锚点后插入', () => {
    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
    const out = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
    assert.match(out, /## 工作流定义\n\n<!-- BEGIN delegation-contract/);
    assert.match(out, /约束行 1/);
    // 锚点后、正文前
    assert.ok(out.indexOf('## 工作流定义') < out.indexOf(BEGIN_MARKER));
    assert.ok(out.indexOf(END_MARKER) < out.indexOf('正文。'));
  });

  it('computeExpectedSkillContent 幂等：二次计算结果不变', () => {
    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
    const once = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
    const twice = computeExpectedSkillContent(once, TPL, '## 工作流定义');
    assert.equal(once, twice);
  });

  it('computeExpectedSkillContent 已有 marker 时替换内容、锚点不动', () => {
    const skill = '# T\n\n## 工作流定义\n\n正文。\n';
    const injected = computeExpectedSkillContent(skill, TPL, '## 工作流定义');
    // 改 template 内容后重算应替换 marker 间
    const TPL2 = TPL.replace('约束行 1', '约束行 X');
    const re = computeExpectedSkillContent(injected, TPL2, '## 工作流定义');
    assert.match(re, /约束行 X/);
    assert.doesNotMatch(re, /约束行 1/);
    // 仅一对 marker（未重复注入）
    assert.equal(re.split(BEGIN_MARKER).length - 1, 1);
  });

  it('computeExpectedSkillContent 锚点缺失 → throw（fail-loud）', () => {
    const skill = '# T\n\n## 其他标题\n\n正文。\n';
    assert.throws(() => computeExpectedSkillContent(skill, TPL, '## 工作流定义'), /锚点未找到/);
  });

  it('孤儿 BEGIN（有 BEGIN 无 END）→ throw，禁止重复注入（codex CRITICAL）', () => {
    // 模拟上次写入中断/手动截断：BEGIN 在但 END 丢了
    const skill = `# T\n\n## 工作流定义\n\n${BEGIN_MARKER}\n> 残块\n\n正文。\n`;
    assert.throws(() => computeExpectedSkillContent(skill, TPL, '## 工作流定义'), /BEGIN.*缺 END|畸形/);
  });

  it('孤儿 BEGIN 经 validateDelegationContract → fail 而非假绿（codex CRITICAL）', () => {
    const { root, anchors } = makeTmpRepo();
    syncDelegationContract({ projectRoot: root });
    mirrorPluginsToCodex(root, Object.keys(anchors));
    const p = path.join(root, 'plugins/spec-driver/skills/spec-driver-fix/SKILL.md');
    // 把 END marker 删掉制造畸形块
    fs.writeFileSync(p, fs.readFileSync(p, 'utf-8').replace(END_MARKER, ''), 'utf-8');
    const result = validateDelegationContract({ projectRoot: root });
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some((e) => /fix/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('F185 validateDelegationContract（tmp fixture）', () => {
  it('同步后双层无漂移 → pass', () => {
    const { root, anchors } = makeTmpRepo();
    syncDelegationContract({ projectRoot: root });
    mirrorPluginsToCodex(root, Object.keys(anchors)); // 模拟 codex-wrappers 再生
    const result = validateDelegationContract({ projectRoot: root });
    assert.equal(result.status, 'pass');
    assert.equal(result.errors.length, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('改某 SKILL 注入块一字 → skill-block-sync 报漂移', () => {
    const { root, anchors } = makeTmpRepo();
    syncDelegationContract({ projectRoot: root });
    mirrorPluginsToCodex(root, Object.keys(anchors));
    const p = path.join(root, 'plugins/spec-driver/skills/spec-driver-fix/SKILL.md');
    const text = fs.readFileSync(p, 'utf-8');
    fs.writeFileSync(p, text.replace('委派硬约束', '委派软约束'), 'utf-8');
    const result = validateDelegationContract({ projectRoot: root });
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some((e) => /fix.*漂移/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('.codex wrapper stale（未含块）→ codex-wrapper-block-sync 报漂移（codex Warning-4）', () => {
    const { root } = makeTmpRepo();
    syncDelegationContract({ projectRoot: root });
    // 故意不镜像到 .codex（模拟 source 改了但 wrapper 未再生）
    const result = validateDelegationContract({ projectRoot: root });
    assert.equal(result.status, 'fail');
    const codexCheck = result.checks.find((c) => c.id === 'codex-wrapper-block-sync');
    assert.equal(codexCheck.status, 'fail');
    assert.ok(result.errors.some((e) => /\.codex.*stale wrapper/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('F185 validateOrchestratorModels（tmp fixture）', () => {
  it('5 SKILL 双层全 opus → pass（含 task-coverage 共 6 check）', () => {
    const { root } = makeTmpRepo();
    const result = validateOrchestratorModels({ projectRoot: root });
    assert.equal(result.status, 'pass');
    assert.equal(result.checks.length, 6); // 5 model + 1 coverage
    const coverage = result.checks.find((c) => c.id === 'orchestrator-task-coverage');
    assert.equal(coverage.status, 'pass');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('含 Task 但未分类的全新 SKILL 目录 → orchestrator-task-coverage 动态枚举报漏网（codex Warning-3）', () => {
    const { root } = makeTmpRepo();
    // newmode 不在任何硬编码列表（allowlist / 豁免）里，靠 skills/ 目录动态枚举发现 → 必须 fail-loud
    const dir = path.join(root, 'plugins/spec-driver/skills/spec-driver-newmode');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: spec-driver-newmode\nallowed-tools: [Read, Task]\nmodel: sonnet\n---\n\n# N\n',
      'utf-8',
    );
    const result = validateOrchestratorModels({ projectRoot: root });
    assert.equal(result.status, 'fail');
    const coverage = result.checks.find((c) => c.id === 'orchestrator-task-coverage');
    assert.equal(coverage.status, 'fail');
    assert.ok(result.errors.some((e) => /newmode.*未分类/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('某 SKILL model=sonnet → fail + 明示文件层', () => {
    const { root } = makeTmpRepo();
    const p = path.join(root, 'plugins/spec-driver/skills/spec-driver-resume/SKILL.md');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf-8').replace('model: opus', 'model: sonnet'), 'utf-8');
    const result = validateOrchestratorModels({ projectRoot: root });
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some((e) => /resume.*plugins.*sonnet/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('.codex 层 model=sonnet → 同样 fail', () => {
    const { root } = makeTmpRepo();
    const p = path.join(root, '.codex/skills/spec-driver-feature/SKILL.md');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf-8').replace('model: opus', 'model: sonnet'), 'utf-8');
    const result = validateOrchestratorModels({ projectRoot: root });
    assert.equal(result.status, 'fail');
    assert.ok(result.errors.some((e) => /feature.*\.codex.*sonnet/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });
});
