/**
 * fix-compliance-core.test.mjs
 * Feature 208 — fix 模式流程依从性判定核心（纯函数）单测
 *
 * Tests FIRST（research.md D7）：本文件先于 fix-compliance-core.mjs 存在，
 * 实现缺失时 import 失败即为红；实现补齐后转绿。
 *
 * 运行: node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeTranscriptEntry,
  detectFixSkillExpansion,
  extractDelegationsAfter,
  classifyDelegationRole,
  resolveFeatureDirCandidate,
  checkArtifactSection,
  classifyClosureForm,
  judgeCompliance,
  resolveEnforcementFromConfig,
  MISSING_ACTION_TEXT,
  ENFORCEMENT_VALUES,
} from '../scripts/lib/fix-compliance-core.mjs';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/fix-compliance/', import.meta.url));

/** 读取 .jsonl fixture 并映射为 TranscriptEntry 数组（复用 core 纯转换器，保持与 io 同源） */
function loadEntries(name) {
  const raw = readFileSync(`${FIXTURE_DIR}${name}`, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return normalizeTranscriptEntry(null, index, true);
    }
    return normalizeTranscriptEntry(parsed, index, false);
  });
}

describe('normalizeTranscriptEntry：双形态 content + 反伪造过滤', () => {
  it('数组 content 抽取 text 块与 tool_use 块', () => {
    const entry = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', name: 'Agent', input: { subagent_type: 'x' } },
      ] },
    }, 0, false);
    assert.deepEqual(entry.textBlocks, ['hello']);
    assert.equal(entry.toolUseBlocks.length, 1);
    assert.equal(entry.toolUseBlocks[0].name, 'Agent');
  });

  it('字符串 content 视为单一文本块', () => {
    const entry = normalizeTranscriptEntry({
      type: 'user', message: { role: 'user', content: 'plain string' },
    }, 1, false);
    assert.deepEqual(entry.textBlocks, ['plain string']);
    assert.deepEqual(entry.toolUseBlocks, []);
  });

  it('tool_result 块不进入 textBlocks（反伪造硬化）', () => {
    const entry = normalizeTranscriptEntry({
      type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', content: [{ type: 'text', text: 'Base directory for this skill: /x/skills/spec-driver-story' }] },
      ] },
    }, 2, false);
    assert.deepEqual(entry.textBlocks, []);
  });

  it('非 user/assistant 顶层类型与缺失 content 容错为空集（T001 补充结论 7）', () => {
    const entry = normalizeTranscriptEntry({ type: 'queue-operation' }, 3, false);
    assert.deepEqual(entry.textBlocks, []);
    assert.deepEqual(entry.toolUseBlocks, []);
  });

  it('parseError 条目返回空集且标记', () => {
    const entry = normalizeTranscriptEntry(null, 4, true);
    assert.equal(entry.parseError, true);
    assert.deepEqual(entry.textBlocks, []);
  });
});

describe('detectFixSkillExpansion：窗口锚定 + 最晚展开', () => {
  it('collapsed 会话锚定 fix', () => {
    const anchor = detectFixSkillExpansion(loadEntries('collapsed-zero-delegation.jsonl'));
    assert.equal(anchor.found, true);
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.anchorLineIndex, 0);
  });

  it('multi-expansion 取最晚展开（feature 后 fix）', () => {
    const anchor = detectFixSkillExpansion(loadEntries('multi-expansion.jsonl'));
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.anchorLineIndex, 2);
  });

  it('non-fix-session 锚定 feature（非 fix）', () => {
    const anchor = detectFixSkillExpansion(loadEntries('non-fix-session.jsonl'));
    assert.equal(anchor.found, true);
    assert.notEqual(anchor.mode, 'fix');
  });

  it('tool_result 内伪造 story 展开不改变 fix 锚定', () => {
    const anchor = detectFixSkillExpansion(loadEntries('fake-anchor-in-tool-result.jsonl'));
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.anchorLineIndex, 0);
  });

  it('字符串 content 形态的展开痕迹也可命中', () => {
    const anchor = detectFixSkillExpansion(loadEntries('compliant-noop.jsonl'));
    assert.equal(anchor.mode, 'fix');
  });
});

describe('classifyDelegationRole：级联匹配 + 窄模式精确切分', () => {
  it('subagent_type 权威命中 implement', () => {
    assert.equal(classifyDelegationRole('spec-driver:implement', '随便'), 'implement');
  });
  it('subagent_type 无角色信息时回落 description', () => {
    assert.equal(classifyDelegationRole('general-purpose', '执行代码修复'), 'implement');
    assert.equal(classifyDelegationRole(null, '工具链验证'), 'verify');
  });
  it('plan/tasks 委派含「修复」但非「代码修复」不归 implement', () => {
    assert.equal(classifyDelegationRole('spec-driver:plan', '规划修复方案'), 'other');
    assert.equal(classifyDelegationRole('spec-driver:tasks', '生成修复任务'), 'other');
  });
  it('审查类归 verify', () => {
    assert.equal(classifyDelegationRole('spec-driver:spec-review', 'Spec 合规审查'), 'verify');
    assert.equal(classifyDelegationRole('spec-driver:quality-review', '代码质量审查'), 'verify');
  });
});

describe('extractDelegationsAfter：仅统计锚点后委派', () => {
  it('multi-expansion 中 fix 锚点前的 implement 委派被排除', () => {
    const entries = loadEntries('multi-expansion.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    assert.equal(dels.length, 0);
  });

  it('compliant-full 抽取三条委派并分类', () => {
    const entries = loadEntries('compliant-full.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    const roles = dels.map((d) => d.roleClass);
    assert.ok(roles.includes('implement'));
    assert.ok(roles.includes('verify'));
  });
});

describe('resolveFeatureDirCandidate：Write/Bash 提名，取最后出现', () => {
  it('从 Write file_path 提名特性目录', () => {
    const entries = loadEntries('compliant-full.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const cand = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);
    assert.equal(cand.path, 'specs/301-fix-sample-bug');
  });
  it('无制品写入时候选为 null', () => {
    const entries = loadEntries('collapsed-zero-delegation.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const cand = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);
    assert.equal(cand.path, null);
  });
});

describe('checkArtifactSection：章节 + 占位符判据', () => {
  it('判定依据章节含真实证据 → 非占位', () => {
    const content = '# 报告\n\n## 判定依据\n经复现测试确认历史 commit abc123 已修复该问题，当前代码路径无缺陷。\n';
    const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
    assert.equal(r.hasRequiredSection, true);
    assert.equal(r.placeholderResidue, false);
  });
  it('判定依据章节仅含花括号占位符 → 占位', () => {
    const content = '# 报告\n\n## 判定依据\n{为何判断问题已不存在}\n';
    const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
    assert.equal(r.hasRequiredSection, true);
    assert.equal(r.placeholderResidue, true);
  });
  it('缺章节 → hasRequiredSection false', () => {
    const r = checkArtifactSection('# 报告\n无相关章节\n', /^##\s*判定依据\s*$/m);
    assert.equal(r.hasRequiredSection, false);
  });
  it('正文过短（≤20 非空白字符）→ 占位', () => {
    const content = '## 判定依据\n无问题\n';
    const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
    assert.equal(r.placeholderResidue, true);
  });
});

describe('classifyClosureForm：互斥锚点', () => {
  it('含判定依据 → no-op', () => {
    assert.equal(classifyClosureForm('## 判定依据\n证据...'), 'no-op');
  });
  it('含 Root Cause → repair', () => {
    assert.equal(classifyClosureForm('**Root Cause**: 空指针'), 'repair');
  });
  it('二者皆无 → undetermined', () => {
    assert.equal(classifyClosureForm('# 随便的标题'), 'undetermined');
  });
});

describe('judgeCompliance：三支判据', () => {
  const okRepairReport = '# Fix Report\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量。\n';
  const okNoopReport = '# 问题核实报告（无需改动）\n\n## 判定依据\n经复现测试确认历史 commit abc123 已修复该问题，当前代码路径无缺陷。\n';

  it('collapsed（0 委派 + 无制品）→ 不合规 undetermined', () => {
    const v = judgeCompliance({
      delegations: [],
      featureDir: { path: null, existsOnDisk: false },
      fixReport: { exists: false, content: null },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.equal(v.closureForm, 'undetermined');
    assert.ok(v.missing.includes('fix-report.md'));
  });

  it('完整修复收口 → 合规 repair', () => {
    const v = judgeCompliance({
      delegations: [
        { roleClass: 'implement', subagentType: 'spec-driver:implement', description: '执行代码修复' },
        { roleClass: 'verify', subagentType: 'spec-driver:verify', description: '工具链验证' },
      ],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: okRepairReport },
      verificationReport: { exists: true, nonEmpty: true },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true);
    assert.equal(v.closureForm, 'repair');
    assert.deepEqual(v.missing, []);
  });

  it('修复收口缺 implement/verify 委派 → 不合规', () => {
    const v = judgeCompliance({
      delegations: [{ roleClass: 'other', subagentType: 'spec-driver:tech-research', description: '调研' }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: okRepairReport },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('delegation:implement'));
    assert.ok(v.missing.includes('delegation:verify'));
    assert.ok(v.missing.includes('verification-report.md'));
  });

  it('no-op 收口 + 1 核实委派 → 合规 no-op', () => {
    const v = judgeCompliance({
      delegations: [{ roleClass: 'verify', subagentType: 'spec-driver:verify', description: '交叉核实无需改动判定' }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: okNoopReport },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true);
    assert.equal(v.closureForm, 'no-op');
  });

  it('no-op 但 0 委派 → 不合规（缺 delegation:noop-verify）', () => {
    const v = judgeCompliance({
      delegations: [],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: okNoopReport },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('delegation:noop-verify'));
  });

  it('no-op 判定依据为占位空壳 → 不合规（artifact:placeholder）', () => {
    const v = judgeCompliance({
      delegations: [{ roleClass: 'verify', subagentType: 'spec-driver:verify', description: '交叉核实无需改动判定' }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: '# 报告\n\n## 判定依据\n{为何判断问题已不存在}\n' },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('artifact:placeholder'));
  });

  it('enforcement 与 configDegraded 原样透传', () => {
    const v = judgeCompliance({
      delegations: [], featureDir: { path: null, existsOnDisk: false },
      fixReport: { exists: false, content: null }, verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'warn', configDegraded: true, diagnostics: ['config-degraded'],
    });
    assert.equal(v.enforcement, 'warn');
    assert.equal(v.configDegraded, true);
    assert.deepEqual(v.delegationCounts, { implement: 0, verify: 0, other: 0 });
  });
});

describe('resolveEnforcementFromConfig：FR-015 三步判定顺序', () => {
  it('配置缺失 → block，非降级', () => {
    const r = resolveEnforcementFromConfig({ found: false, parseFailed: false, config: null });
    assert.deepEqual(r, { enforcement: 'block', configDegraded: false });
  });
  it('解析失败 → block + 降级', () => {
    const r = resolveEnforcementFromConfig({ found: true, parseFailed: true, config: null });
    assert.deepEqual(r, { enforcement: 'block', configDegraded: true });
  });
  it('合法 warn/off 直接采用', () => {
    assert.deepEqual(
      resolveEnforcementFromConfig({ found: true, parseFailed: false, config: { fix_compliance: { enforcement: 'warn' } } }),
      { enforcement: 'warn', configDegraded: false },
    );
    assert.deepEqual(
      resolveEnforcementFromConfig({ found: true, parseFailed: false, config: { fix_compliance: { enforcement: 'off' } } }),
      { enforcement: 'off', configDegraded: false },
    );
  });
  it('非法取值 → block + 降级', () => {
    const r = resolveEnforcementFromConfig({ found: true, parseFailed: false, config: { fix_compliance: { enforcement: 'bogus' } } });
    assert.deepEqual(r, { enforcement: 'block', configDegraded: true });
  });
  it('配置存在但无 fix_compliance 字段 → block，非降级（缺字段=默认）', () => {
    const r = resolveEnforcementFromConfig({ found: true, parseFailed: false, config: { preset: 'balanced' } });
    assert.deepEqual(r, { enforcement: 'block', configDegraded: false });
  });
});

// ────────────────────────────────────────
// T018：no-op 收口组合断言（fixture 委派抽取 × judge）+ SKILL.md 静态合同
// ────────────────────────────────────────

const OK_NOOP_REPORT = '# 问题核实报告（无需改动）\n\n## 判定依据\n经复现测试确认历史 commit abc123 已修复该问题，当前代码路径无缺陷。\n';
const OK_REPAIR_REPORT = '# Fix Report\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量。\n';

describe('T018(a) no-op 收口组合：canonical 委派文本 × 判据集', () => {
  it('compliant-noop.jsonl：抽取到 1 条 noopVerify 委派 → 与 no-op 报告组合合规', () => {
    const entries = loadEntries('compliant-noop.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    // canonical desc "交叉核实无需改动判定" 命中 no-op 核实类
    assert.equal(dels.filter((d) => d.noopVerify).length, 1);
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: OK_NOOP_REPORT },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true);
    assert.equal(v.closureForm, 'no-op');
  });

  it('noop-zero-delegation.jsonl：0 委派 → no-op 报告仍不合规（缺 noop-verify）', () => {
    const entries = loadEntries('noop-zero-delegation.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    assert.equal(dels.filter((d) => d.noopVerify).length, 0);
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: OK_NOOP_REPORT },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('delegation:noop-verify'));
  });
});

describe('T018(b) SKILL.md 静态合同：canonical 锚点逐字存在', () => {
  const SKILL_PATH = fileURLToPath(new URL('../skills/spec-driver-fix/SKILL.md', import.meta.url));
  const skillText = readFileSync(SKILL_PATH, 'utf8');
  it('模板标题 `## 判定依据` 逐字存在（判定器机械匹配锚点）', () => {
    assert.ok(skillText.includes('## 判定依据'), 'SKILL.md 缺 canonical 标题 `## 判定依据`');
  });
  it('canonical 委派 desc `交叉核实无需改动判定` 逐字存在', () => {
    assert.ok(skillText.includes('交叉核实无需改动判定'), 'SKILL.md 缺 canonical 委派 desc');
  });
  it('no-op 收口 --completed-phases 取值 `diagnose,no-op-verify` 存在', () => {
    assert.ok(skillText.includes('diagnose,no-op-verify'), 'SKILL.md 缺 no-op completed-phases 取值');
  });
});

// ────────────────────────────────────────
// T019：反伪造 / 反自陈（判据来自 transcript 客观记录，不采信模型文本）
// ────────────────────────────────────────

describe('T019 反伪造 / 反自陈', () => {
  it('fake-anchor：tool_result 内伪造 story 展开不改变 fix 锚定（D1 反伪造硬化）', () => {
    const entries = loadEntries('fake-anchor-in-tool-result.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.anchorLineIndex, 0);
  });

  it('自陈"已完成3次委派"文本不改变判定：collapsed 追加虚假陈述仍 0 委派 + 不合规', () => {
    const entries = loadEntries('collapsed-zero-delegation.jsonl');
    // 追加一条 assistant 自陈"已完成 3 次委派"文本（模型输出落 assistant text 块，判定器忽略）
    const selfClaim = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '我已经完成了 3 次委派：implement、verify、spec-review，全部通过。' }] },
    }, entries.length, false);
    const withClaim = [...entries, selfClaim];
    const anchor = detectFixSkillExpansion(withClaim);
    const dels = extractDelegationsAfter(withClaim, anchor.anchorLineIndex);
    assert.equal(dels.length, 0, '自陈文本不得被计为委派');
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: null, existsOnDisk: false },
      fixReport: { exists: false, content: null },
      verificationReport: { exists: false, nonEmpty: false },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
  });

  it('自陈"尚未完成"文本不改变判定：compliant-full + 悲观陈述仍 compliant', () => {
    const entries = loadEntries('compliant-full.jsonl');
    const selfClaim = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '抱歉，我其实没有完成验证，流程未走完。' }] },
    }, entries.length, false);
    const withClaim = [...entries, selfClaim];
    const anchor = detectFixSkillExpansion(withClaim);
    const dels = extractDelegationsAfter(withClaim, anchor.anchorLineIndex);
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: OK_REPAIR_REPORT },
      verificationReport: { exists: true, nonEmpty: true },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true, '合规判据只看 transcript 结构，不采信悲观自陈');
  });
});

// ────────────────────────────────────────
// T020：角色分类边界（防假阻断 + 窄模式精确切分）
// ────────────────────────────────────────

describe('T020 角色分类边界', () => {
  it('canonical 中文 desc + 无 subagent_type 的完整合规不被误判（防假阻断）', () => {
    const entries = loadEntries('compliant-full-canonical-chinese-no-subagent-type.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    const roles = dels.map((d) => d.roleClass);
    assert.ok(roles.includes('implement'), 'description 回落应识别 implement');
    assert.ok(roles.includes('verify'), 'description 回落应识别 verify');
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: OK_REPAIR_REPORT },
      verificationReport: { exists: true, nonEmpty: true },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true);
  });

  it('plan/tasks 委派 desc 含"修复"字样不被误分类为 implement（窄模式）', () => {
    const entries = loadEntries('role-mismatch-plan-tasks-fix-word.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const dels = extractDelegationsAfter(entries, anchor.anchorLineIndex);
    assert.equal(dels.filter((d) => d.roleClass === 'implement').length, 0, '"规划修复方案"/"生成修复任务"不得归 implement');
    const v = judgeCompliance({
      delegations: dels,
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: OK_REPAIR_REPORT },
      verificationReport: { exists: true, nonEmpty: true },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false, '缺真正 implement/verify 委派应不合规');
    assert.ok(v.missing.includes('delegation:implement'));
  });
});

describe('常量合同：missing 枚举 → action 文案全覆盖', () => {
  it('ENFORCEMENT_VALUES 为三档', () => {
    assert.deepEqual([...ENFORCEMENT_VALUES].sort(), ['block', 'off', 'warn']);
  });
  it('每个 missing 枚举都有 action 文案', () => {
    const enums = [
      'fix-report.md', 'verification-report.md', 'delegation:implement', 'delegation:verify',
      'delegation:noop-verify', 'noop:judgment-section', 'artifact:placeholder', 'feature-dir',
    ];
    for (const key of enums) {
      assert.equal(typeof MISSING_ACTION_TEXT[key], 'string', `${key} 应有 action 文案`);
      assert.ok(MISSING_ACTION_TEXT[key].length > 0);
    }
  });
});

// ────────────────────────────────────────
// codex implement 审查处置回归（2C/4W，2026-07-09）
// ────────────────────────────────────────

describe('codex C-2：特性目录提名必须锚定 artifact 路径 + Bash 写指示符', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  it('Bash 纯提及旧目录（echo，无写指示符）→ 不提名', () => {
    const entries = [user('x'), bash('echo specs/301-fix-old-compliant', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('Bash 提及 artifact 路径但为读形态（cat 无重定向）→ 不提名', () => {
    const entries = [user('x'), bash('cat specs/301-fix-old-compliant/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('Bash 仅目录路径 + 重定向（无 artifact 文件名）→ 不提名', () => {
    const entries = [user('x'), bash('echo hi > specs/301-fix-old-compliant/notes.txt', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('Bash heredoc 写 fix-report.md → 提名其目录（诚实 Bash 写制品兜底）', () => {
    const entries = [user('x'), bash('cat > specs/302-fix-real/fix-report.md <<EOF\n...\nEOF', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/302-fix-real');
  });

  it('Write file_path 仅目录级路径（非 artifact）→ 不提名', () => {
    const entries = [user('x'), write('specs/303-fix-dir-only/README.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('Write verification-report 路径 → 提名其特性目录前缀', () => {
    const entries = [user('x'), write('specs/304-fix-v/verification/verification-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/304-fix-v');
  });
});

describe('codex W-1：双锚点报告按修复收口取严', () => {
  it('同含 Root Cause 与 ## 判定依据 → repair（不得借 no-op 低门槛绕过）', () => {
    const both = '# 报告\n\n**Root Cause**: 某常量单位错误已在历史提交修正完毕。\n\n## 判定依据\n历史 commit abc123 已修复该问题，复现测试通过，无需再改。\n';
    assert.equal(classifyClosureForm(both), 'repair');
  });
});

describe('codex W-3：含空格插件路径的展开痕迹识别', () => {
  it('路径含空格仍锚定 fix 展开', () => {
    const entry = normalizeTranscriptEntry({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /tmp/my repo/plugins/spec-driver/skills/spec-driver-fix\n请修复' }] },
    }, 0, false);
    const anchor = detectFixSkillExpansion([entry]);
    assert.equal(anchor.found, true);
    assert.equal(anchor.mode, 'fix');
  });
});

describe('codex W-4：desc 兜底剔除裸"实现"防 verify 描述误判', () => {
  it('"验证实现正确性"（无 subagent_type）→ verify 而非 implement', () => {
    assert.equal(classifyDelegationRole(null, '验证实现正确性'), 'verify');
  });
  it('canonical "执行代码修复"（无 subagent_type）仍归 implement', () => {
    assert.equal(classifyDelegationRole(null, '执行代码修复'), 'implement');
  });
});
