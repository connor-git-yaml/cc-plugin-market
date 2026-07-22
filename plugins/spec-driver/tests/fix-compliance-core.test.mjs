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
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeTranscriptEntry,
  detectFixSkillExpansion,
  extractDelegationsAfter,
  classifyDelegationRole,
  resolveFeatureDirCandidate,
  checkArtifactSection,
  stripCodeRegions,
  classifyClosureForm,
  judgeCompliance,
  resolveEnforcementFromConfig,
  MISSING_ACTION_TEXT,
  ENFORCEMENT_VALUES,
  ROOT_CAUSE_HEADING_REGEX,
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

describe('classifyClosureForm：互斥锚点（F216 正交返回 .closureForm）', () => {
  it('含判定依据 → no-op', () => {
    assert.equal(classifyClosureForm('## 判定依据\n证据...').closureForm, 'no-op');
  });
  it('含 Root Cause → repair', () => {
    assert.equal(classifyClosureForm('**Root Cause**: 空指针').closureForm, 'repair');
  });
  it('二者皆无 → undetermined', () => {
    assert.equal(classifyClosureForm('# 随便的标题').closureForm, 'undetermined');
  });
});

describe('judgeCompliance：三支判据', () => {
  const okRepairReport = '# Fix Report\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量。\n';
  // F216：合规 no-op 须携带结构化 ### 复现对账（单行 JSON）+ 匹配的真实 PASS 执行记录
  const okNoopReport = '# 问题核实报告（无需改动）\n\n## 判定依据\n经复现测试确认历史 commit abc123 已修复该问题，当前代码路径无缺陷。\n\n### 复现对账\n- {"claim":"症状已消除","command":"bash verify.sh","expected":"PASS"}\n';
  const okNoopExecs = [{ command: 'bash verify.sh', paired: true, isError: false, assertionStatus: 'PASS' }];

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

  it('no-op 收口 + 1 核实委派 + 复现证据 → 合规 no-op', () => {
    const v = judgeCompliance({
      delegations: [{ roleClass: 'verify', subagentType: 'spec-driver:verify', description: '交叉核实无需改动判定' }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: okNoopReport },
      verificationReport: { exists: false, nonEmpty: false },
      executionRecords: okNoopExecs,
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

// F216：合规 no-op 须携带结构化 ### 复现对账 + 匹配 PASS 执行记录
const OK_NOOP_REPORT = '# 问题核实报告（无需改动）\n\n## 判定依据\n经复现测试确认历史 commit abc123 已修复该问题，当前代码路径无缺陷。\n\n### 复现对账\n- {"claim":"症状已消除","command":"bash verify.sh","expected":"PASS"}\n';
const OK_NOOP_EXECS = [{ command: 'bash verify.sh', paired: true, isError: false, assertionStatus: 'PASS' }];
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
      executionRecords: OK_NOOP_EXECS,
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

  // ── F225：复合命令跨段背书劫持（负向，期望不提名）──

  it('复合命令 `;` 分隔：写段与读段跨段不再互相背书 → 不提名', () => {
    const entries = [user('x'), bash('echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('复合命令 `&&` 分隔：写段与读段跨段不再互相背书 → 不提名', () => {
    const entries = [user('x'), bash('echo x > /tmp/y && cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('复合命令 `||` 分隔：写段与读段跨段不再互相背书 → 不提名', () => {
    const entries = [user('x'), bash('echo x > /tmp/y || cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('复合命令换行分隔：写段与读段跨段不再互相背书 → 不提名', () => {
    const entries = [user('x'), bash('echo x > /tmp/y\ncat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('混合分隔符 4 段、写段与读段不相邻 → 不提名', () => {
    const entries = [user('x'), bash('echo x > /tmp/y; echo mid1; echo mid2; cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('写段在后、读段在前 → 不提名', () => {
    const entries = [user('x'), bash('cat specs/999-fix-decoy/fix-report.md && echo x > /tmp/y', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('tee 写指示符跨段（管道内 tee 与读路径分居 `;` 两侧）→ 不提名', () => {
    const entries = [user('x'), bash('cat specs/999-fix-decoy/fix-report.md; echo x | tee /tmp/y', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('heredoc 写指示符与 artifact 路径分居不同子命令段 → 不提名', () => {
    const entries = [user('x'), bash('cat <<EOF > /tmp/y\nbody\nEOF; cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  // ── F225：同段共现的合法写入必须仍被提名（正向回归防护）──

  it('同段重定向写 → 仍提名', () => {
    const entries = [user('x'), bash('echo body > specs/300-fix-real/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/300-fix-real');
  });

  it('复合命令中同段写（mkdir 前段 + heredoc 写段同段共现）→ 仍提名', () => {
    const entries = [user('x'), bash('mkdir -p specs/300-fix-real && cat > specs/300-fix-real/fix-report.md <<EOF\n内容\nEOF', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/300-fix-real');
  });

  it('前段无关写 + 后段同段真写，跨段不互相污染，取最后 → 提名后者', () => {
    const entries = [user('x'), bash('echo x > /tmp/y; echo body > specs/301-fix-later/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/301-fix-later');
  });

  it('两段各自同段写不同特性目录 → 取最后出现者（后者）', () => {
    const entries = [user('x'), bash('echo a > specs/300-fix-real/fix-report.md; echo b > specs/301-fix-later/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/301-fix-later');
  });

  it('Bash 同段写 verification-report.md → 提名其特性目录前缀', () => {
    const entries = [user('x'), bash('echo v > specs/304-fix-v/verification/verification-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/304-fix-v');
  });

  // ── F225 R-1：常见 Bash 写法不得回归（反斜杠续行 / 命令组 / 循环 / heredoc / $()）──

  it('反斜杠续行·写指示符在前路径在后（重定向目标换行）→ 仍提名', () => {
    const entries = [user('x'), bash("printf 'body' > \\\nspecs/300-fix-line/fix-report.md", 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/300-fix-line');
  });

  it('反斜杠续行·写指示符在续行之后 → 仍提名', () => {
    const entries = [user('x'), bash('echo body \\\n  > specs/300-fix-x/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/300-fix-x');
  });

  it('反斜杠续行·tee 目标换行 → 仍提名', () => {
    const entries = [user('x'), bash('printf body | tee \\\nspecs/332-fix-line/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/332-fix-line');
  });

  it('管道 tee 写 artifact（同段，正向）→ 仍提名', () => {
    const entries = [user('x'), bash('printf body | tee specs/317-fix-tee/fix-report.md >/dev/null', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/317-fix-tee');
  });

  it('命令组 `{ ...; ...; } >` 重定向写 artifact → 仍提名', () => {
    const entries = [user('x'), bash("{ printf 'a'; printf 'b'; } > specs/310-fix-group/fix-report.md", 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/310-fix-group');
  });

  it('子 shell `( ...; ... ) >` 重定向写 artifact → 仍提名', () => {
    const entries = [user('x'), bash("( printf 'a'; printf 'b' ) > specs/311-fix-subshell/fix-report.md", 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/311-fix-subshell');
  });

  it('for 循环体内追加写 artifact → 仍提名', () => {
    const entries = [user('x'), bash('for x in a b; do printf "%s\\n" "$x" >> specs/330-fix-for-body/fix-report.md; done', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/330-fix-for-body');
  });

  it('heredoc body 含 `;` 与 `&&` 干扰字符 → 仍提名（写指示符与路径同在首段）', () => {
    const entries = [user('x'), bash("cat > specs/334-fix-doc/fix-report.md <<'EOF'\na; b\nc && d\nEOF", 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/334-fix-doc');
  });

  it('`$()` 内含分隔符但重定向目标为静态路径 → 仍提名', () => {
    const entries = [user('x'), bash('printf \'%s\' "$(printf a; printf b)" > specs/314-fix-cmdsub/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/314-fix-cmdsub');
  });

  it('写 A 段在前、纯读 B 段在后 → 取写入段 A（读段不再背书）', () => {
    const entries = [user('x'), bash('echo b > specs/320-fix-real/fix-report.md; cat specs/999-fix-decoy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/320-fix-real');
  });

  it('已知限界：`$()` 动态生成重定向目标 → 当前不提名（未来做语法级解析时应改写此断言）', () => {
    const entries = [user('x'), bash('cat > "$(true; printf \'specs/315-fix-cmdsub-target/fix-report.md\')"', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('已知限界：`cp` 等未被写指示符识别的写命令 → 当前取前一个合格段（未来补全写形态时应改写此断言）', () => {
    const entries = [user('x'), bash('echo a > specs/321-fix-first/fix-report.md; cp /tmp/report specs/322-fix-copy/fix-report.md', 1)];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/321-fix-first');
  });
});

describe('codex W-1：双锚点报告按修复收口取严', () => {
  it('同含 Root Cause 与 ## 判定依据 → repair（不得借 no-op 低门槛绕过）', () => {
    const both = '# 报告\n\n**Root Cause**: 某常量单位错误已在历史提交修正完毕。\n\n## 判定依据\n历史 commit abc123 已修复该问题，复现测试通过，无需再改。\n';
    assert.equal(classifyClosureForm(both).closureForm, 'repair');
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

// ────────────────────────────────────────
// F216 T004：normalizeTranscriptEntry 保留 ExecutionRecord 字段 + flattenToolResultContent 直测
// （尚未存在的 flattenToolResultContent 用 dynamic import + 存在性断言，避免收集期崩溃）
// ────────────────────────────────────────

const CORE_MODULE_URL = new URL('../scripts/lib/fix-compliance-core.mjs', import.meta.url);

describe('F216 T004 normalizeTranscriptEntry 扩展 ExecutionRecord 字段', () => {
  it('F216 T004 toolUseBlocks[].id 被保留（缺失时为 null）', () => {
    const withId = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [
        { type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'echo hi' } },
      ] },
    }, 0, false);
    assert.equal(withId.toolUseBlocks[0].id, 'toolu_abc');
    const noId = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } },
      ] },
    }, 0, false);
    assert.equal(noId.toolUseBlocks[0].id, null);
  });

  it('F216 T004 toolResultBlocks 为独立字段，不并入 textBlocks/toolUseBlocks（AD-2 反伪造）', () => {
    const entry = normalizeTranscriptEntry({
      type: 'user',
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'toolu_abc', is_error: false, content: 'SPEC-DRIVER-REPRO: PASS' },
      ] },
    }, 0, false);
    assert.equal(entry.toolResultBlocks.length, 1);
    assert.equal(entry.toolResultBlocks[0].toolUseId, 'toolu_abc');
    assert.equal(entry.toolResultBlocks[0].isError, false);
    assert.equal(entry.toolResultBlocks[0].flattenedContent, 'SPEC-DRIVER-REPRO: PASS');
    // 展开痕迹只认 user text、委派只认 assistant tool_use——tool_result 内容不得污染这两个判定输入
    assert.deepEqual(entry.textBlocks, []);
    assert.deepEqual(entry.toolUseBlocks, []);
  });

  it('F216 T004 is_error 缺省为 false、tool_use_id 缺失为 null', () => {
    const entry = normalizeTranscriptEntry({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] },
    }, 0, false);
    assert.equal(entry.toolResultBlocks[0].isError, false);
    assert.equal(entry.toolResultBlocks[0].toolUseId, null);
  });

  it('F216 T004 所有返回分支恒带 toolResultBlocks: []（parseError/非对象/无 tool_result）', () => {
    assert.deepEqual(normalizeTranscriptEntry(null, 0, true).toolResultBlocks, []);
    assert.deepEqual(normalizeTranscriptEntry('not object', 0, false).toolResultBlocks, []);
    assert.deepEqual(normalizeTranscriptEntry({ type: 'queue-operation' }, 0, false).toolResultBlocks, []);
    assert.deepEqual(normalizeTranscriptEntry({
      type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    }, 0, false).toolResultBlocks, []);
  });
});

describe('F216 T004 flattenToolResultContent 直测（string/block-array/换行归一/无预截断）', () => {
  it('F216 T004 string content 直通', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    assert.equal(typeof flattenToolResultContent, 'function', 'flattenToolResultContent 应已导出');
    assert.equal(flattenToolResultContent('hello world'), 'hello world');
  });

  it('F216 T004 block-array 仅取顶层 text 按序 \\n 拼接、非文本块忽略', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    const out = flattenToolResultContent([
      { type: 'text', text: 'line1' },
      { type: 'image', source: {} },
      { type: 'text', text: 'line2' },
    ]);
    assert.equal(out, 'line1\nline2');
  });

  it('F216 T004 不递归 nested array（嵌套数组元素被忽略）', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    const out = flattenToolResultContent([
      { type: 'text', text: 'top' },
      [{ type: 'text', text: 'nested-should-ignore' }],
    ]);
    assert.equal(out, 'top');
  });

  it('F216 T004 CRLF 与 lone-CR 归一为 \\n', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    assert.equal(flattenToolResultContent('a\r\nb\rc'), 'a\nb\nc');
    assert.equal(flattenToolResultContent([{ type: 'text', text: 'x\r\ny' }]), 'x\ny');
  });

  it('F216 T004 输出完整、无预截断（大内容原样返回）', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    const big = 'A'.repeat(50000);
    assert.equal(flattenToolResultContent(big).length, 50000);
  });

  it('F216 T004 非 string 非 array（null/对象）→ 空字符串', async () => {
    const { flattenToolResultContent } = await import(CORE_MODULE_URL);
    assert.equal(flattenToolResultContent(null), '');
    assert.equal(flattenToolResultContent({ type: 'text', text: 'x' }), '');
  });
});

describe('F216 T004 反伪造回归：fake tool_result 不改变既有判定', () => {
  it('F216 T004 fake-anchor：新字段解析后锚点仍为 fix 且 textBlocks 不被污染', () => {
    const entries = loadEntries('fake-anchor-in-tool-result.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.anchorLineIndex, 0);
    const resultEntry = entries.find((e) => e.toolResultBlocks && e.toolResultBlocks.length > 0);
    assert.ok(resultEntry, 'tool_result 应被解析进 toolResultBlocks 独立字段');
    assert.deepEqual(resultEntry.textBlocks, [], 'tool_result 内伪造展开痕迹不得进 textBlocks');
  });
});

// ────────────────────────────────────────
// F216 T008：parseNoopReconLines + normalizeCommandConservative（红→绿）
// 新函数尚未导出时用 dynamic import + 存在性断言（避免收集期崩溃）
// ────────────────────────────────────────

/** 从 fixture 的 Write fix-report.md 抽取 input.content（Phase 2 core 判据的 fix-report 侧输入） */
function loadFixReport(name) {
  const entries = loadEntries(name);
  for (const e of entries) {
    for (const b of e.toolUseBlocks) {
      if (b.name === 'Write' && b.input && typeof b.input.file_path === 'string'
        && b.input.file_path.endsWith('fix-report.md') && typeof b.input.content === 'string') {
        return b.input.content;
      }
    }
  }
  return '';
}

describe('F216 T008 normalizeCommandConservative：仅去首尾空白，不去引号', () => {
  it('F216 T008 去首尾空白 + 折叠尾随换行，保留内部空白与引号', async () => {
    const { normalizeCommandConservative } = await import(CORE_MODULE_URL);
    assert.equal(typeof normalizeCommandConservative, 'function', 'normalizeCommandConservative 应已导出');
    assert.equal(normalizeCommandConservative('  echo   hi  \n\n'), 'echo   hi');
    // 引号不去除（引号差异 => 不等价）
    assert.equal(normalizeCommandConservative('"a b"'), '"a b"');
    assert.notEqual(normalizeCommandConservative('"a"'), normalizeCommandConservative('a'));
    // 内部换行保留（多行命令）
    assert.equal(normalizeCommandConservative('line1\nline2'), 'line1\nline2');
  });
});

describe('F216 T008 parseNoopReconLines：单行 JSON 无损 + malformed 全计数 + expected 冻结', () => {
  it('F216 T008 反引号/管道/heredoc/续行/双引号/连续反斜杠命令单行 JSON 无损', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    assert.equal(typeof parseNoopReconLines, 'function', 'parseNoopReconLines 应已导出');
    const { records, malformedCandidateCount } = parseNoopReconLines(loadFixReport('noop-cmd-with-backtick-pipe-heredoc.jsonl'));
    assert.equal(malformedCandidateCount, 0);
    assert.equal(records.length, 1);
    const cmd = records[0].command;
    assert.ok(cmd.includes('`date`'), '反引号无损');
    assert.ok(cmd.includes('|'), '管道无损');
    assert.ok(cmd.includes("<<'EOF'"), 'heredoc 无损');
    assert.ok(cmd.includes('"double quotes"'), '双引号无损');
    assert.ok(cmd.includes('\\ backslash'), '连续反斜杠无损');
    assert.ok(cmd.includes('\n'), '多行换行无损');
    assert.equal(records[0].expected, 'PASS');
  });

  it('F216 T008 malformed 枚举 7 种坏形态全部计入 malformedCandidateCount，records 为空', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const { records, malformedCandidateCount } = parseNoopReconLines(loadFixReport('noop-recon-malformed-enum.jsonl'));
    assert.equal(records.length, 0, '无任一合规声明');
    assert.equal(malformedCandidateCount, 7, '7 种坏形态逐条计入而非静默丢弃');
  });

  it('F216 T008 单条坏 JSON 候选行 → malformed 计数 ≥1', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const r = parseNoopReconLines(loadFixReport('noop-recon-malformed-row.jsonl'));
    assert.ok(r.malformedCandidateCount >= 1);
    assert.equal(r.records.length, 0);
  });

  it('F216 T008 一绿一坏：合规声明入 records 但 malformedCount>0（不静默丢坏声明）', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const r = parseNoopReconLines(loadFixReport('noop-recon-one-green-one-broken.jsonl'));
    assert.equal(r.records.length, 1, '合法 PASS 声明入 records');
    assert.ok(r.malformedCandidateCount >= 1, 'malformed 声明被计数');
  });

  it('F216 T008 区块定位至下一同级 ### 或上级 ## 标题止', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const content = [
      '## 判定依据', '证据散文……',
      '', '### 复现对账',
      '- {"claim":"a","command":"echo a","expected":"PASS"}',
      '', '## 其他章节',
      '- {"claim":"区块外不应计入","command":"echo out","expected":"PASS"}',
    ].join('\n');
    const r = parseNoopReconLines(content);
    assert.equal(r.records.length, 1, '仅收区块内 bullet');
    assert.equal(r.records[0].command, 'echo a');
    assert.equal(r.malformedCandidateCount, 0, '区块外正文不计 malformed');
  });

  it('F216 T008 expected 字面量冻结：非 "PASS" 一律 malformed', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const mk = (payload) => `## 判定依据\n证据……\n\n### 复现对账\n- ${payload}\n`;
    for (const bad of [
      '{"claim":"a","command":"echo a","expected":"FAIL"}',
      '{"claim":"a","command":"echo a","expected":"pass"}',
      '{"claim":"a","command":"echo a","expected":1}',
      '{"claim":"a","command":"echo a"}',
      '{"claim":"","command":"echo a","expected":"PASS"}',
      '{"claim":"a","command":"","expected":"PASS"}',
    ]) {
      const r = parseNoopReconLines(mk(bad));
      assert.equal(r.records.length, 0, `应 malformed: ${bad}`);
      assert.equal(r.malformedCandidateCount, 1, `应计 1 malformed: ${bad}`);
    }
  });

  it('F216 T008 缺 ### 复现对账 区块 → records 空、malformed 0（块级短路交由 classifyReproEvidence）', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const r = parseNoopReconLines('## 判定依据\n仅有散文，无结构化对账。\n');
    assert.deepEqual(r.records, []);
    assert.equal(r.malformedCandidateCount, 0);
  });
});

// ────────────────────────────────────────
// F216 T011：deriveAssertionStatus 四态 + extractExecutionRecordsAfter 逐项锁定（红→绿）
// ────────────────────────────────────────

/** 内联构造 assistant Bash tool_use entry */
const bashUseEntry = (id, command, lineIndex) => normalizeTranscriptEntry({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
}, lineIndex, false);
/** 内联构造 user tool_result entry */
const toolResultEntry = (toolUseId, content, lineIndex, isError = false) => normalizeTranscriptEntry({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
}, lineIndex, false);

describe('F216 T011 deriveAssertionStatus：sentinel 整行末行四态', () => {
  it('F216 T011 唯一合法 sentinel 且为末行非空行 → PASS/FAIL', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    assert.equal(typeof deriveAssertionStatus, 'function', 'deriveAssertionStatus 应已导出');
    assert.equal(deriveAssertionStatus('log\nSPEC-DRIVER-REPRO: PASS'), 'PASS');
    assert.equal(deriveAssertionStatus('log\nSPEC-DRIVER-REPRO: FAIL\n\n'), 'FAIL');
  });

  it('F216 T011 ≥2 合法 sentinel 或 PASS+FAIL 同现 → CONTRADICTION', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    assert.equal(deriveAssertionStatus('SPEC-DRIVER-REPRO: PASS\nSPEC-DRIVER-REPRO: PASS'), 'CONTRADICTION');
    assert.equal(deriveAssertionStatus('SPEC-DRIVER-REPRO: PASS\nSPEC-DRIVER-REPRO: FAIL'), 'CONTRADICTION');
  });

  it('F216 T011 0 合法 sentinel 或唯一 sentinel 非末行 → INCONCLUSIVE', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    assert.equal(deriveAssertionStatus('some output\nno sentinel here'), 'INCONCLUSIVE');
    assert.equal(deriveAssertionStatus('SPEC-DRIVER-REPRO: PASS\ntrailing noise line'), 'INCONCLUSIVE');
  });

  it('F216 T011 CRLF 与 lone-CR 归一为 \\n 后判定', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    assert.equal(deriveAssertionStatus('log\r\nSPEC-DRIVER-REPRO: PASS'), 'PASS');
    assert.equal(deriveAssertionStatus('log\rSPEC-DRIVER-REPRO: FAIL'), 'FAIL');
  });

  it('F216 T011 ANSI 色码装饰行拒绝识别为 sentinel（整行精确等值）', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    // 带 ANSI 前后缀 → trim 后不精确等于字面量 → 不算 sentinel → INCONCLUSIVE
    assert.equal(deriveAssertionStatus('[32mSPEC-DRIVER-REPRO: PASS[0m'), 'INCONCLUSIVE');
  });

  it('F216 T011 grep 模式串 / 源码摘录噪声不被误判为 sentinel', async () => {
    const { deriveAssertionStatus } = await import(CORE_MODULE_URL);
    // 行内包含 sentinel 子串但非整行 → 不识别
    assert.equal(deriveAssertionStatus("grep 'SPEC-DRIVER-REPRO: PASS' out.log"), 'INCONCLUSIVE');
    assert.equal(deriveAssertionStatus("printf 'SPEC-DRIVER-REPRO: PASS\\n' # 源码摘录"), 'INCONCLUSIVE');
  });
});

describe('F216 T011 extractExecutionRecordsAfter：锚点窗口/非Bash排除/ID join/未配对/定位行', () => {
  it('F216 T011 (a) 仅收 lineIndex > anchor 的 tool_use，锚点前不计入', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    assert.equal(typeof extractExecutionRecordsAfter, 'function', 'extractExecutionRecordsAfter 应已导出');
    const entries = [
      bashUseEntry('pre', 'echo before', 0),
      toolResultEntry('pre', 'SPEC-DRIVER-REPRO: PASS', 1),
      bashUseEntry('post', 'echo after', 3),
      toolResultEntry('post', 'SPEC-DRIVER-REPRO: PASS', 4),
    ];
    const recs = extractExecutionRecordsAfter(entries, 2);
    assert.equal(recs.length, 1, '锚点前的 Bash 执行被排除');
    assert.equal(recs[0].command, 'echo after');
  });

  it('F216 T011 (b) 非 Bash 工具一律不产出 ExecutionRecord', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const nonBash = normalizeTranscriptEntry({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'CustomMcpTool', input: { command: 'echo x' } }] },
    }, 1, false);
    const recs = extractExecutionRecordsAfter([nonBash], 0);
    assert.equal(recs.length, 0);
  });

  it('F216 T011 (c) tool_use.id === tool_result.tool_use_id 精确匹配才 paired:true', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const recs = extractExecutionRecordsAfter([
      bashUseEntry('id1', 'echo hi', 1),
      toolResultEntry('id1', 'SPEC-DRIVER-REPRO: PASS', 2, false),
    ], 0);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].paired, true);
    assert.equal(recs[0].isError, false);
    assert.equal(recs[0].assertionStatus, 'PASS');
    assert.equal(recs[0].id, 'id1');
    assert.equal(recs[0].name, 'Bash');
  });

  it('F216 T011 (d) 有 tool_use 无匹配 tool_result → paired:false / isError:null', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const recs = extractExecutionRecordsAfter([bashUseEntry('lonely', 'echo hi', 1)], 0);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].paired, false);
    assert.equal(recs[0].isError, null);
    assert.equal(recs[0].toolResultLineIndex, null);
  });

  it('F216 T011 (e) 定位行字段正确反映来源行号', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const recs = extractExecutionRecordsAfter([
      bashUseEntry('id9', 'echo hi', 5),
      toolResultEntry('id9', 'SPEC-DRIVER-REPRO: PASS', 6),
    ], 0);
    assert.equal(recs[0].toolUseLineIndex, 5);
    assert.equal(recs[0].toolResultLineIndex, 6);
  });

  it('F216 T011 fixture noop-result-missing：Bash 无配对 result → paired:false', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = loadEntries('noop-result-missing.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const recs = extractExecutionRecordsAfter(entries, anchor.anchorLineIndex);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].paired, false);
  });

  it('F216 T011 fixture noop-tool-error：is_error===true 被保留', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = loadEntries('noop-tool-error.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const recs = extractExecutionRecordsAfter(entries, anchor.anchorLineIndex);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].paired, true);
    assert.equal(recs[0].isError, true);
  });

  it('F216 T011 fixture noop-long-output-truncation：outputSummary 截断但 assertionStatus 用完整内容判 PASS', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = loadEntries('noop-long-output-truncation.jsonl');
    const anchor = detectFixSkillExpansion(entries);
    const recs = extractExecutionRecordsAfter(entries, anchor.anchorLineIndex);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].assertionStatus, 'PASS', '判定在完整 flattenedOutput 上算');
    assert.ok(recs[0].flattenedOutput.length > recs[0].outputSummary.length, 'outputSummary 为展示截断');
  });
});

// ────────────────────────────────────────
// F216 T014：classifyReproEvidence 条件并行决策表 + 6 键文案完整性 + closureForm 正交（红→绿）
// ────────────────────────────────────────

/** 端到端从 fixture 求复现证据 missing 键集 */
async function reproKeysFromFixture(name) {
  const { classifyReproEvidence, parseNoopReconLines, extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
  const entries = loadEntries(name);
  const anchor = detectFixSkillExpansion(entries);
  const parsed = parseNoopReconLines(loadFixReport(name));
  const execs = extractExecutionRecordsAfter(entries, anchor.anchorLineIndex);
  return classifyReproEvidence(parsed, execs);
}

const noopReportWithRecon = (command, claim = '症状消除') =>
  `# 报告\n\n## 判定依据\n经复现确认该问题已在历史提交修复，当前代码路径无缺陷。\n\n### 复现对账\n- ${JSON.stringify({ claim, command, expected: 'PASS' })}\n`;

describe('F216 T014 classifyReproEvidence：块级短路 + E 空 + 跨声明并集', () => {
  it('F216 T014 块级短路：缺 ### 复现对账（旧报告）→ noop:repro-fields（core 层判据来源，FR-011）', async () => {
    const { classifyReproEvidence, parseNoopReconLines } = await import(CORE_MODULE_URL);
    assert.equal(typeof classifyReproEvidence, 'function', 'classifyReproEvidence 应已导出');
    const legacy = '# 报告\n\n## 判定依据\n有判定依据散文但完全无结构化复现对账区块。\n';
    assert.deepEqual(classifyReproEvidence(parseNoopReconLines(legacy), []), ['noop:repro-fields']);
  });

  it('F216 T014 块级短路：malformed>0 → noop:repro-fields（一绿一坏不放行）', async () => {
    assert.deepEqual(await reproKeysFromFixture('noop-recon-malformed-enum.jsonl'), ['noop:repro-fields']);
    assert.deepEqual(await reproKeysFromFixture('noop-recon-malformed-row.jsonl'), ['noop:repro-fields']);
    assert.deepEqual(await reproKeysFromFixture('noop-recon-one-green-one-broken.jsonl'), ['noop:repro-fields']);
  });

  it('F216 T014 E 空（无匹配命令）→ 仅 noop:repro-command-mismatch', async () => {
    const { classifyReproEvidence, parseNoopReconLines } = await import(CORE_MODULE_URL);
    const parsed = parseNoopReconLines(noopReportWithRecon('bash never-run.sh'));
    assert.deepEqual(classifyReproEvidence(parsed, []), ['noop:repro-command-mismatch']);
  });

  it('F216 T014 跨声明并集去重（多缺失 MUST 合并全部列出）', async () => {
    const { classifyReproEvidence } = await import(CORE_MODULE_URL);
    const parsed = {
      records: [
        { claim: 'a', command: 'bash a.sh', expected: 'PASS' },
        { claim: 'b', command: 'bash b.sh', expected: 'PASS' },
      ],
      malformedCandidateCount: 0,
    };
    // a 无匹配 → command-mismatch；b 匹配但 is_error → tool-error
    const execs = [{ command: 'bash b.sh', paired: true, isError: true, assertionStatus: 'INCONCLUSIVE' }];
    const keys = classifyReproEvidence(parsed, execs);
    assert.ok(keys.includes('noop:repro-command-mismatch'));
    assert.ok(keys.includes('noop:repro-tool-error'));
    // 去重：两条都 command-mismatch 只出现一次
    const bothMismatch = classifyReproEvidence(parsed, []);
    assert.deepEqual(bothMismatch, ['noop:repro-command-mismatch']);
  });
});

describe('F216 T014 classifyReproEvidence：E 非空条件并行决策表（单/双/三键同现）', () => {
  it('F216 T014 单键：result-missing / tool-error / output-mismatch / contradiction 各自命中', async () => {
    assert.deepEqual(await reproKeysFromFixture('noop-result-missing.jsonl'), ['noop:repro-result-missing']);
    assert.deepEqual(await reproKeysFromFixture('noop-tool-error.jsonl'), ['noop:repro-tool-error']);
    assert.deepEqual(await reproKeysFromFixture('noop-output-no-sentinel.jsonl'), ['noop:repro-output-mismatch']);
    assert.deepEqual(await reproKeysFromFixture('noop-contradiction-fail-sentinel.jsonl'), ['noop:repro-contradiction']);
  });

  it('F216 T014 双键同现：result-missing + tool-error（排序后精确比对，杜绝杂键混入）', async () => {
    const keys = await reproKeysFromFixture('noop-multikey-missing-and-error.jsonl');
    assert.deepEqual([...keys].sort(), [
      'noop:repro-result-missing',
      'noop:repro-tool-error',
    ]);
  });

  it('F216 T014 双键同现：tool-error + output-mismatch（排序后精确比对，杜绝杂键混入）', async () => {
    const keys = await reproKeysFromFixture('noop-multikey-error-and-output-mismatch.jsonl');
    assert.deepEqual([...keys].sort(), [
      'noop:repro-output-mismatch',
      'noop:repro-tool-error',
    ]);
  });

  it('F216 T014 三键同现：result-missing + tool-error + output-mismatch（W3 排序后精确比对，杜绝多/漏键）', async () => {
    const keys = await reproKeysFromFixture('noop-multikey-triple-missing-error-mismatch.jsonl');
    // W3：从 keys.includes 松断言收紧为排序后 deepEqual——三键之外不得混入 command-mismatch/contradiction 等杂键
    assert.deepEqual([...keys].sort(), [
      'noop:repro-output-mismatch',
      'noop:repro-result-missing',
      'noop:repro-tool-error',
    ]);
  });

  it('F216 T014 绿：真实执行 + 末行 PASS + 命令匹配 → 空 missing', async () => {
    assert.deepEqual(await reproKeysFromFixture('noop-cmd-with-backtick-pipe-heredoc.jsonl'), []);
    assert.deepEqual(await reproKeysFromFixture('noop-long-output-truncation.jsonl'), []);
  });
});

describe('F216 T014 classifyReproEvidence：证据集合时序三态（C4 修正）', () => {
  it('F216 T014 FAIL→PASS / PASS→FAIL 时序 → contradiction（拒绝任一绿即绿）', async () => {
    assert.deepEqual(await reproKeysFromFixture('noop-multiexec-fail-then-pass.jsonl'), ['noop:repro-contradiction']);
    assert.deepEqual(await reproKeysFromFixture('noop-multiexec-pass-then-fail.jsonl'), ['noop:repro-contradiction']);
  });

  it('F216 T014 PASS + 无 result 时序 → result-missing（C4：unpaired 独立判，非 contradiction）', async () => {
    assert.deepEqual(await reproKeysFromFixture('noop-multiexec-pass-plus-noresult.jsonl'), ['noop:repro-result-missing']);
  });
});

describe('F216 T014 classifyClosureForm 正交返回 {closureForm, hasRepairAnchor, hasNoopAnchor}', () => {
  it('F216 T014 no-op 单锚点', () => {
    assert.deepEqual(classifyClosureForm('## 判定依据\n证据...'),
      { closureForm: 'no-op', hasRepairAnchor: false, hasNoopAnchor: true });
  });
  it('F216 T014 repair 单锚点', () => {
    assert.deepEqual(classifyClosureForm('**Root Cause**: 空指针'),
      { closureForm: 'repair', hasRepairAnchor: true, hasNoopAnchor: false });
  });
  it('F216 T014 双锚点：closureForm 取严 repair 但 hasNoopAnchor 仍 true（FR-018 可达）', () => {
    const both = '**Root Cause**: 常量错误\n\n## 判定依据\n证据...';
    assert.deepEqual(classifyClosureForm(both),
      { closureForm: 'repair', hasRepairAnchor: true, hasNoopAnchor: true });
  });
  it('F216 T014 无锚点 → undetermined', () => {
    assert.deepEqual(classifyClosureForm('# 随便的标题'),
      { closureForm: 'undetermined', hasRepairAnchor: false, hasNoopAnchor: false });
  });
});

describe('F216 T014 MISSING_ACTION_TEXT 6 键完整性 + 内嵌 JSON 示例合法（W7）', () => {
  const SIX_KEYS = [
    'noop:repro-fields', 'noop:repro-command-mismatch', 'noop:repro-result-missing',
    'noop:repro-tool-error', 'noop:repro-output-mismatch', 'noop:repro-contradiction',
  ];
  it('F216 T014 6 个 canonical repro key 逐一有文案', () => {
    for (const key of SIX_KEYS) {
      assert.equal(typeof MISSING_ACTION_TEXT[key], 'string', `${key} 应有文案`);
      assert.ok(MISSING_ACTION_TEXT[key].length > 0);
    }
  });
  it('F216 T014 每条文案内反引号包裹的 JSON 对象示例 JSON.parse 合法', () => {
    let jsonExamplesFound = 0;
    for (const key of SIX_KEYS) {
      const text = MISSING_ACTION_TEXT[key] || '';
      const matches = text.match(/`(\{[^`]*\})`/g) || [];
      for (const m of matches) {
        const inner = m.slice(1, -1); // 去掉反引号
        assert.doesNotThrow(() => JSON.parse(inner), `${key} 内 JSON 示例应合法: ${inner}`);
        jsonExamplesFound += 1;
      }
    }
    assert.ok(jsonExamplesFound >= 1, 'noop:repro-fields 至少含一个合法 JSON 示例');
  });
});

describe('F216 T014 judgeCompliance no-op 分支接入证据校验（hasNoopAnchor 正交）', () => {
  it('F216 T014 no-op + recon + 匹配 PASS 执行 + noopVerify + featureDir → 合规', () => {
    const command = 'bash verify.sh';
    const v = judgeCompliance({
      delegations: [{ roleClass: 'verify', noopVerify: true }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: noopReportWithRecon(command) },
      verificationReport: { exists: false, nonEmpty: false },
      executionRecords: [{ command, paired: true, isError: false, assertionStatus: 'PASS' }],
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, true, 'no-op 带真实复现证据应合规');
    assert.deepEqual(v.missing, []);
  });

  it('F216 T014 no-op + recon 但执行缺失 → missing 含 noop:repro-command-mismatch', () => {
    const command = 'bash verify.sh';
    const v = judgeCompliance({
      delegations: [{ roleClass: 'verify', noopVerify: true }],
      featureDir: { path: 'specs/301-fix-sample-bug', existsOnDisk: true },
      fixReport: { exists: true, content: noopReportWithRecon(command) },
      verificationReport: { exists: false, nonEmpty: false },
      executionRecords: [],
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.compliant, false);
    assert.ok(v.missing.includes('noop:repro-command-mismatch'));
  });
});

describe('F216 T023 · 三方 missing key 集合一致性（只读校验）', () => {
  // spec.md FR-019 定稿的 6 键互斥穷尽集合（硬编码为期望集，与 spec 正文逐字对齐）
  const SPEC_FR019_KEYS = [
    'noop:repro-fields',
    'noop:repro-command-mismatch',
    'noop:repro-result-missing',
    'noop:repro-tool-error',
    'noop:repro-output-mismatch',
    'noop:repro-contradiction',
  ];

  it('F216 T023 spec FR-019 6 键 ↔ MISSING_ACTION_TEXT 的 noop:repro-* 子集 双向 diff 为空', () => {
    // FR-019 定义的是 noop:repro-* 家族的 6 键；MISSING_ACTION_TEXT 另含 F208 既有 repair 键，
    // 故只读校验取实现侧 noop:repro-* 前缀子集与 spec 6 键做严格双向 diff。
    const implReproKeys = Object.keys(MISSING_ACTION_TEXT).filter((k) => k.startsWith('noop:repro-'));
    const specSet = new Set(SPEC_FR019_KEYS);
    const implSet = new Set(implReproKeys);

    // 数量一致（无多余、无遗漏的先行断言）
    assert.equal(implReproKeys.length, SPEC_FR019_KEYS.length, `实现侧 noop:repro-* 键数 ${implReproKeys.length} 应等于 spec FR-019 的 ${SPEC_FR019_KEYS.length}`);

    // spec → impl：spec 定义的每个键实现侧都有文案（无遗漏）
    const missingInImpl = SPEC_FR019_KEYS.filter((k) => !implSet.has(k));
    assert.deepEqual(missingInImpl, [], `实现侧 MISSING_ACTION_TEXT 缺失 spec 键: ${missingInImpl.join(', ')}`);

    // impl → spec：实现侧每个 noop:repro-* 键 spec 都声明了（无多余）
    const extraInImpl = implReproKeys.filter((k) => !specSet.has(k));
    assert.deepEqual(extraInImpl, [], `实现侧存在 spec FR-019 未声明的多余 repro 键: ${extraInImpl.join(', ')}`);

    // 集合相等（排序后逐一相等，锁死顺序无关的严格一致）
    assert.deepEqual([...implSet].sort(), [...specSet].sort());
  });
});

// ────────────────────────────────────────
// F216 审查修复批（codex 对抗审查 C1/C3/C4/C5/W1）——每项复现审查里的绕过/回归场景
// ────────────────────────────────────────

describe('F216 C1 · extractSectionBody 终止符还原 H1/H2（H3 子节不截空正文，防 placeholder 误报）', () => {
  it('F216 C1 含 `### 直接原因` H3 子节的完整 repair 报告 → placeholderResidue=false（不因 H3 终止而截空）', () => {
    // 审查证据场景：合法 repair 报告把根因详情放在 `### 直接原因` H3 子节下，
    // 旧实现以 `#{1,3}` 为终止符会把 Root Cause 正文截到 H3 前造成 body 过短 → placeholder 误报。
    const content = [
      '# 修复报告',
      '',
      '**Root Cause**: 单位换算错误',
      '',
      '### 直接原因',
      '配置常量 TIMEOUT_MS 被误写为秒级数值，导致会话在毫秒阈值下提前登出；已在历史提交 abc123 修正为毫秒级。',
      '',
      '## 影响范围',
      '无其他调用方受影响。',
      '',
    ].join('\n');
    const r = checkArtifactSection(content, /Root Cause/i);
    assert.equal(r.hasRequiredSection, true);
    assert.equal(r.placeholderResidue, false, 'H3 子节内的根因详情应计入 Root Cause 正文，非占位');
  });

  it('F216 C1 no-op 报告的 `### 复现对账` 单行 JSON 花括号不触发 placeholder（定向剔除子块）', () => {
    // 判定依据散文实质 + 复现对账 JSON 并存：JSON 花括号 MUST 被 stripReconSubblock 剔除，不误判占位
    const content = [
      '## 判定依据',
      '经复现确认该问题已在历史提交 abc123 修复，当前代码路径无缺陷，回归测试全绿。',
      '',
      '### 复现对账',
      '- {"claim":"症状已消除","command":"bash verify.sh","expected":"PASS"}',
      '',
    ].join('\n');
    const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
    assert.equal(r.placeholderResidue, false, '复现对账 JSON 花括号不参与散文占位扫描');
  });

  it('F216 C1 判定依据散文为空、仅有复现对账 JSON → 仍判 placeholder（散文实质性要求不被 JSON 蒙混）', () => {
    const content = [
      '## 判定依据',
      '',
      '### 复现对账',
      '- {"claim":"症状已消除","command":"bash verify.sh","expected":"PASS"}',
      '',
    ].join('\n');
    const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
    assert.equal(r.placeholderResidue, true, '剔除复现对账后散文为空 → 占位');
  });

  it('F216 C1 含 H3 子节的 repair 报告端到端 judgeCompliance → 合规（placeholder 误报不再阻断）', () => {
    const content = [
      '# 修复报告',
      '',
      '**Root Cause**: 单位换算错误',
      '',
      '### 直接原因',
      '配置常量 TIMEOUT_MS 被误写为秒级数值导致提前登出，已在历史提交 abc123 修正为毫秒级。',
      '',
      '## 修复策略',
      '改回毫秒常量并补回归测试。',
      '',
    ].join('\n');
    const v = judgeCompliance({
      delegations: [{ roleClass: 'implement' }, { roleClass: 'verify' }],
      featureDir: { path: 'specs/301-fix-unit-bug', existsOnDisk: true },
      fixReport: { exists: true, content },
      verificationReport: { exists: true, nonEmpty: true },
      executionRecords: [],
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    assert.equal(v.closureForm, 'repair');
    assert.equal(v.compliant, true, JSON.stringify(v.missing));
    assert.deepEqual(v.missing, []);
  });
});

describe('F216 C3 · parseNoopReconLines 限定 `## 判定依据` 父层级（错挂父层级不认）', () => {
  it('F216 C3 `### 复现对账` 挂在 `## 其他章节` 下（非判定依据）→ records 空', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const content = [
      '## 判定依据',
      '有判定依据散文，但复现对账被放错父层级。',
      '',
      '## 其他章节',
      '### 复现对账',
      '- {"claim":"区块错挂父层级","command":"echo out","expected":"PASS"}',
      '',
    ].join('\n');
    const r = parseNoopReconLines(content);
    assert.deepEqual(r.records, [], '判定依据范围外的同名子标题不认');
    assert.equal(r.malformedCandidateCount, 0);
  });

  it('F216 C3 错挂父层级 → classifyReproEvidence 判 noop:repro-fields（堵绕过）', async () => {
    const { parseNoopReconLines, classifyReproEvidence } = await import(CORE_MODULE_URL);
    const content = [
      '## 判定依据', '散文……',
      '## 其他章节', '### 复现对账',
      '- {"claim":"x","command":"echo out","expected":"PASS"}',
    ].join('\n');
    assert.deepEqual(classifyReproEvidence(parseNoopReconLines(content), []), ['noop:repro-fields']);
  });

  it('F216 C3 `### 复现对账` 正确挂在判定依据下仍照常解析（不误伤合法形态）', async () => {
    const { parseNoopReconLines } = await import(CORE_MODULE_URL);
    const content = [
      '## 判定依据', '散文证据……',
      '', '### 复现对账',
      '- {"claim":"a","command":"echo a","expected":"PASS"}',
    ].join('\n');
    const r = parseNoopReconLines(content);
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].command, 'echo a');
  });
});

describe('F216 C4 · fence-aware 标题识别（fenced code 内的锚点不算真实锚点）', () => {
  it('F216 C4 合规 repair 报告附录 fenced code 内含 `## 判定依据` → hasNoopAnchor=false（FR-007 保全）', () => {
    const content = [
      '# 修复报告',
      '',
      '**Root Cause**: 空指针已在历史提交修复。',
      '',
      '## 附录：no-op 模板示例',
      '',
      '```markdown',
      '## 判定依据',
      '{这是文档里演示 no-op 模板的示例文本，非真实锚点}',
      '```',
      '',
    ].join('\n');
    const c = classifyClosureForm(content);
    assert.equal(c.hasNoopAnchor, false, 'fenced code 内的 `## 判定依据` 不算 no-op 锚点');
    assert.equal(c.hasRepairAnchor, true);
    assert.equal(c.closureForm, 'repair');
  });

  it('F216 C4 fenced code 内的 `## 判定依据` 不触发 no-op 证据门（纯 repair 零介入）', () => {
    const content = [
      '**Root Cause**: 常量错误已修。',
      '',
      '```',
      '## 判定依据',
      '```',
    ].join('\n');
    const v = judgeCompliance({
      delegations: [{ roleClass: 'implement' }, { roleClass: 'verify' }],
      featureDir: { path: 'specs/301-fix-x', existsOnDisk: true },
      fixReport: { exists: true, content },
      verificationReport: { exists: true, nonEmpty: true },
      executionRecords: [],
      enforcement: 'block', configDegraded: false, diagnostics: [],
    });
    // 无 no-op 证据门介入 → 不含任何 noop:repro-* 键
    assert.ok(!v.missing.some((k) => k.startsWith('noop:repro-')), JSON.stringify(v.missing));
    assert.equal(v.compliant, true, JSON.stringify(v.missing));
  });

  it('F216 C4 computeFenceMask 标记围栏区（含开/闭围栏行），非围栏行为 false', async () => {
    const { computeFenceMask } = await import(CORE_MODULE_URL);
    const mask = computeFenceMask(['前言', '```bash', 'echo hi', '```', '尾声']);
    assert.deepEqual(mask, [false, true, true, true, false]);
  });
});

describe('F216 C5 · 反馈文案含 Bash 亲自执行指引', () => {
  it('F216 C5 noop:repro-fields 文案要求先经 Bash 执行并留执行记录', () => {
    const t = MISSING_ACTION_TEXT['noop:repro-fields'];
    assert.ok(t.includes('Bash'), '应提示经 Bash 执行');
    assert.ok(t.includes('执行记录') || t.includes('执行'), '应提示留下执行记录');
    assert.ok(t.includes('逐字一致'), '应要求命令逐字一致');
  });

  it('F216 C5 双路径 B 指引含 Bash 亲自执行复现命令的要求', async () => {
    const { DUAL_PATH_GUIDANCE } = await import(CORE_MODULE_URL);
    assert.ok(DUAL_PATH_GUIDANCE.includes('Bash'), '双路径 B 应含 Bash 执行要求');
    assert.ok(DUAL_PATH_GUIDANCE.includes('执行记录') || DUAL_PATH_GUIDANCE.includes('复现对账'));
  });
});

describe('F216 W1 · extractExecutionRecordsAfter 配对窗口约束 + 同 ID 重复歧义', () => {
  it('F216 W1 锚点前 PASS result + 锚点后同 ID use → 不配对（result 时序早于 use，判 result-missing）', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = [
      toolResultEntry('idw', 'SPEC-DRIVER-REPRO: PASS', 0), // result 在锚点前、早于 use
      bashUseEntry('idw', 'echo w', 2), // 同 ID 的 use 在锚点后
    ];
    const recs = extractExecutionRecordsAfter(entries, 1);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].paired, false, 'result.lineIndex 必须 > use.lineIndex 才配对');
    assert.equal(recs[0].ambiguous, false, '单 result 但时序不符 → 非歧义、判未配对');
    assert.equal(recs[0].toolResultLineIndex, null);
  });

  it('F216 W1 窗口未配对 → classifyReproEvidence 判 noop:repro-result-missing', async () => {
    const { extractExecutionRecordsAfter, classifyReproEvidence, parseNoopReconLines } = await import(CORE_MODULE_URL);
    const entries = [
      toolResultEntry('idw', 'SPEC-DRIVER-REPRO: PASS', 0),
      bashUseEntry('idw', 'echo w', 2),
    ];
    const execs = extractExecutionRecordsAfter(entries, 1);
    const parsed = parseNoopReconLines('## 判定依据\n散文……\n\n### 复现对账\n- {"claim":"a","command":"echo w","expected":"PASS"}\n');
    assert.deepEqual(classifyReproEvidence(parsed, execs), ['noop:repro-result-missing']);
  });

  it('F216 W1 同 ID 多 use（歧义）→ 拒绝可靠配对、ambiguous=true、paired=false', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = [
      bashUseEntry('dup', 'echo d', 1),
      bashUseEntry('dup', 'echo d', 2), // 同 ID 第二次 use
      toolResultEntry('dup', 'SPEC-DRIVER-REPRO: PASS', 3),
    ];
    const recs = extractExecutionRecordsAfter(entries, 0);
    assert.equal(recs.length, 2);
    for (const r of recs) {
      assert.equal(r.ambiguous, true, '同 ID 多 use → 歧义');
      assert.equal(r.paired, false, '歧义不产出可靠配对');
    }
  });

  it('F216 W1 同 ID 重复 → classifyReproEvidence 判 INCONCLUSIVE 语义（output-mismatch，非 result-missing）', async () => {
    const { extractExecutionRecordsAfter, classifyReproEvidence, parseNoopReconLines } = await import(CORE_MODULE_URL);
    const entries = [
      bashUseEntry('dup', 'echo d', 1),
      bashUseEntry('dup', 'echo d', 2),
      toolResultEntry('dup', 'SPEC-DRIVER-REPRO: PASS', 3),
    ];
    const execs = extractExecutionRecordsAfter(entries, 0);
    const parsed = parseNoopReconLines('## 判定依据\n散文……\n\n### 复现对账\n- {"claim":"a","command":"echo d","expected":"PASS"}\n');
    assert.deepEqual(classifyReproEvidence(parsed, execs), ['noop:repro-output-mismatch']);
  });

  it('F216 W1 窗口内多 result 撞同 ID（歧义）→ ambiguous=true、paired=false', async () => {
    const { extractExecutionRecordsAfter } = await import(CORE_MODULE_URL);
    const entries = [
      bashUseEntry('m', 'echo m', 1),
      toolResultEntry('m', 'SPEC-DRIVER-REPRO: PASS', 2),
      toolResultEntry('m', 'SPEC-DRIVER-REPRO: FAIL', 3), // 同 ID 第二个 result
    ];
    const recs = extractExecutionRecordsAfter(entries, 0);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].ambiguous, true);
    assert.equal(recs[0].paired, false);
  });
});

describe('F216 C2 · SKILL 模板 JSON 示例的 \\n 编码必须过判据（模板教的写法即合规写法）', () => {
  const SKILL_PATH = fileURLToPath(new URL('../skills/spec-driver-fix/SKILL.md', import.meta.url));
  const skillText = readFileSync(SKILL_PATH, 'utf8');

  /** 从 SKILL.md 逐字抽取 `### 复现对账` 模板 bullet（占位符原样） */
  function extractReconTemplateBullet() {
    const line = skillText.split('\n').find((l) => l.includes('症状 X 已消除') && l.includes('claim'));
    assert.ok(line, 'SKILL.md 应含 `### 复现对账` 单行 JSON 模板示例');
    return line;
  }

  it('F216 C2 模板 bullet 的 JSON 合法且 command 内 sentinel 保留字面 \\n（非真实换行）', () => {
    const bullet = extractReconTemplateBullet();
    const jsonStr = bullet.replace(/^\s*-\s+/, '');
    const parsed = JSON.parse(jsonStr); // 合法 JSON
    assert.equal(parsed.expected, 'PASS');
    // JSON.parse 后 command 内应是字面 `\n`（反斜杠+n），而非真实换行符——
    // 与实跑 Bash 命令 `printf '...\n'` 逐字节一致，才能过命令配对（C2 核心）
    assert.ok(parsed.command.includes('printf'), 'command 含 printf sentinel wrapper');
    assert.ok(parsed.command.includes('\\n'), 'sentinel \\n 保留为字面反斜杠+n');
    assert.ok(!parsed.command.includes('\n'), 'command 内不得含真实换行符（否则与 transcript 字面 \\n 不等）');
  });

  it('F216 C2 模板（占位符替换后）经 parseNoopReconLines→classifyReproEvidence 与同字面命令 ExecutionRecord 配对判绿', async () => {
    const { parseNoopReconLines, classifyReproEvidence } = await import(CORE_MODULE_URL);
    const bullet = extractReconTemplateBullet().replace(/^\s+/, '');
    // 占位符替换为具体只读断言
    const concreteBullet = bullet.replace('<只读复现断言>', 'test -f package.json');
    const parsedCmd = JSON.parse(concreteBullet.replace(/^\s*-\s+/, '')).command;
    const doc = `## 判定依据\n经复现确认问题已在历史提交修复，当前代码路径无缺陷。\n\n### 复现对账\n${concreteBullet}\n`;
    const parsed = parseNoopReconLines(doc);
    assert.equal(parsed.records.length, 1, '模板 bullet 应解析为 1 条合规声明');
    assert.equal(parsed.malformedCandidateCount, 0);
    // 模拟实跑 Bash：ExecutionRecord.command 与 JSON 解析出的命令逐字节一致、输出末行 PASS
    const execs = [{ command: parsedCmd, paired: true, isError: false, assertionStatus: 'PASS', ambiguous: false }];
    assert.deepEqual(classifyReproEvidence(parsed, execs), [], '模板教的写法必须过判据（空 missing）');
  });
});

// ────────────────────────────────────────
// F224 · 候选目录解析盲区修复（改名跟随 / 原地编辑准入 / 降级安全阀）
// ────────────────────────────────────────

/** 定锚后解析候选（F224 用例统一入口，避免每处重复取 anchorLineIndex） */
function resolveFromFixture(name) {
  const entries = loadEntries(name);
  return resolveFeatureDirCandidate(entries, detectFixSkillExpansion(entries).anchorLineIndex);
}

describe('F224 resolveFeatureDirCandidate：目录改名跟随（FR-001/US1）', () => {
  it('git mv 改名后候选跟随到新路径（复现 F223 实例）', () => {
    const cand = resolveFromFixture('resolve-rename-git-mv.jsonl');
    assert.equal(cand.path, 'specs/322-fix-new');
    assert.equal(cand.ambiguous, false);
  });

  it('裸 mv 改名与 git mv 判定一致', () => {
    const cand = resolveFromFixture('resolve-rename-mv-plain.jsonl');
    assert.equal(cand.path, 'specs/324-fix-new');
    assert.equal(cand.ambiguous, false);
  });

  it('mv -f 改名（带 flag）候选跟随到新路径', () => {
    const cand = resolveFromFixture('resolve-rename-mv-flag.jsonl');
    assert.equal(cand.path, 'specs/352-fix-new');
    assert.equal(cand.ambiguous, false);
  });

  it('git mv -f 改名（带 flag）候选跟随到新路径', () => {
    const cand = resolveFromFixture('resolve-rename-git-mv-flag.jsonl');
    assert.equal(cand.path, 'specs/354-fix-new');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F224 resolveFeatureDirCandidate：改名命令 option token 形态（Phase 5 spec-review CRITICAL 订正）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  /** 改名前候选恒为 specs/360-fix-src，dst 恒为 specs/361-fix-dst */
  const resolveWithRename = (command) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/360-fix-src/fix-report.md', 1),
    bash(command, 2),
  ], 0);

  // 订正前这四种形态会把 `-f`/`-v` 误捕获为 src，导致改名被整条忽略、候选停在已不存在的旧路径，
  // 进而触发 missing:'feature-dir' 假阻断——正是 F224 立项要消灭的形态。
  const FOLLOW_CASES = [
    ['mv -f', 'mv -f specs/360-fix-src specs/361-fix-dst'],
    ['mv -v', 'mv -v specs/360-fix-src specs/361-fix-dst'],
    ['git mv -f', 'git mv -f specs/360-fix-src specs/361-fix-dst'],
    ['多 flag mv -f -v', 'mv -f -v specs/360-fix-src specs/361-fix-dst'],
    ['合并短 flag mv -fv', 'mv -fv specs/360-fix-src specs/361-fix-dst'],
    ['长 flag mv --no-clobber', 'mv --no-clobber specs/360-fix-src specs/361-fix-dst'],
    ['git mv 多 flag', 'git mv -f -v specs/360-fix-src specs/361-fix-dst'],
  ];

  for (const [label, command] of FOLLOW_CASES) {
    it(`${label} → 候选跟随到 dst`, () => {
      const cand = resolveWithRename(command);
      assert.equal(cand.path, 'specs/361-fix-dst', `形态未被识别：${command}`);
      assert.equal(cand.ambiguous, false);
    });
  }

  it('带 flag 但 src 不等于当前候选 → 仍不采信（安全约束不得随形态放宽而失效）', () => {
    const cand = resolveWithRename('mv -f specs/399-fix-unrelated specs/400-fix-other');
    assert.equal(cand.path, 'specs/360-fix-src');
    assert.equal(cand.ambiguous, false);
  });

  it('带 flag 改名到非规范目录 → 与无 flag 形态一致地转降级（ambiguous）', () => {
    const cand = resolveWithRename('git mv -f specs/360-fix-src specs/renamed-nonstandard');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  it('超长 option 串不触发灾难性回溯（有界量词保证，10ms 量级返回）', () => {
    const flags = Array.from({ length: 200 }, (_, i) => `-a${i}`).join(' ');
    const started = Date.now();
    const cand = resolveWithRename(`mv ${flags} specs/360-fix-src specs/361-fix-dst`);
    assert.ok(Date.now() - started < 1000, '解析耗时应远低于 1s');
    // option token 段上界为 8 个 → 超界时不匹配（等价于"不识别"），安全侧退化而非误跟随
    assert.equal(cand.path, 'specs/360-fix-src');
  });
});

describe('F224 resolveFeatureDirCandidate：原地编辑命令识别（FR-002/US2）', () => {
  it('sed -i 写 fix-report.md（无重定向符）→ 提名其特性目录', () => {
    const cand = resolveFromFixture('resolve-inline-edit-sed.jsonl');
    assert.equal(cand.path, 'specs/325-fix-inline');
    assert.equal(cand.ambiguous, false);
  });

  it('perl -i 写 fix-report.md（无重定向符）→ 提名其特性目录', () => {
    const cand = resolveFromFixture('resolve-inline-edit-perl.jsonl');
    assert.equal(cand.path, 'specs/326-fix-inline2');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F224 resolveFeatureDirCandidate：降级安全阀触发面收窄（FR-004/US3）', () => {
  it('改名到非 NNN-fix-<name> 命名的 dst → 候选清空且标记 ambiguous（唯一降级触发面）', () => {
    const cand = resolveFromFixture('resolve-ambiguous-rename-nonstandard.jsonl');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  it('同形态但含 implement+verify 委派 → 候选解析结果一致（委派不影响目录维度）', () => {
    // 目录解析只看写入/改名指示符，与委派证据正交；降级与否的收窄裁决在 judge 编排层做（SC-005b）。
    const cand = resolveFromFixture('resolve-ambiguous-rename-with-delegations.jsonl');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  it('只写非制品文件（plan.md/日志）→ 不得标记 ambiguous，维持既有硬阻断语义（反向回归）', () => {
    // 这是本次修复刻意保留的严格面：目录路径可从磁盘裁决时不走 fail-open，
    // 否则"建了目录、写了 plan.md、但从未写 fix-report.md"的坍塌会被放行。
    const cand = resolveFromFixture('resolve-dir-only-plan-md.jsonl');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, false);
  });

  it('零工具调用的真坍塌 → path=null 且 ambiguous=false（不得借降级通道放行）', () => {
    const cand = resolveFromFixture('collapsed-zero-delegation.jsonl');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, false);
  });
});

describe('F224 resolveFeatureDirCandidate：多次改名/混用叠加取最终态（FR-008）', () => {
  it('链式改名两次 → 取最后一环，不停留在中间路径', () => {
    const cand = resolveFromFixture('resolve-multi-rename-chain.jsonl');
    assert.equal(cand.path, 'specs/331-fix-c');
    assert.equal(cand.ambiguous, false);
  });

  it('改名后再原地编辑 → 最终候选为改名后目录', () => {
    const cand = resolveFromFixture('resolve-mixed-rename-then-inline-edit.jsonl');
    assert.equal(cand.path, 'specs/333-fix-renamed');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F224 resolveFeatureDirCandidate：ambiguous 可恢复（FR-008，Codex 复审订正）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  /** 首个 Write 恒提名 specs/900-fix-x，后续每条命令按序叠加 */
  const resolveChain = (commands) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/900-fix-x/fix-report.md', 1),
    ...commands.map((c, i) => bash(c, i + 2)),
  ], 0);

  it('两跳 合法→非规范→合法 → 取最终态而非停在中间的 ambiguous', () => {
    // 订正前：第一跳把 candidate 置 null 后 `src === candidate` 判断失效，第二跳无法续跟 → {null, true}
    const cand = resolveChain([
      'mv specs/900-fix-x specs/renamed-nonstandard',
      'mv specs/renamed-nonstandard specs/901-fix-x',
    ]);
    assert.equal(cand.path, 'specs/901-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('三跳以上 合法→非规范→非规范→合法 → 同样取最终态', () => {
    const cand = resolveChain([
      'mv specs/900-fix-x tmp/stage-a',
      'git mv tmp/stage-a tmp/stage-b',
      'mv -f tmp/stage-b specs/902-fix-final',
    ]);
    assert.equal(cand.path, 'specs/902-fix-final');
    assert.equal(cand.ambiguous, false);
  });

  it('改名链停在非规范中间态 → 仍为 ambiguous（降级语义未被放宽）', () => {
    const cand = resolveChain([
      'mv specs/900-fix-x tmp/stage-a',
      'git mv tmp/stage-a tmp/stage-b',
    ]);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });
});

describe('F224 resolveFeatureDirCandidate：mv 异常形态保守化跳过（Codex 复审订正）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWith = (command) => resolveFeatureDirCandidate([
    user('x'), write('specs/900-fix-x/fix-report.md', 1), bash(command, 2),
  ], 0);

  // 共同期望：整条跳过 → 候选保持改名前的值、不触发降级（宁可漏跟随，不可跟错或误降级）
  const SKIP_CASES = [
    ['多操作数 mv A B C（真实语义是移入目录 C）', 'mv specs/900-fix-x specs/other specs/dest-dir'],
    ['目标在前 mv -t DIR SRC', 'mv -t specs/900-fix-x specs/renamed-nonstandard'],
    ['长形式 --target-directory', 'mv --target-directory specs/900-fix-x specs/renamed-nonstandard'],
    ['带参数 option mv -S SUFFIX SRC DST', 'mv -S .bak specs/900-fix-x specs/renamed-nonstandard'],
    ['含空格的引号路径（token 被拆散）', 'mv "specs/900-fix-x" "some dir/renamed nonstandard"'],
    ['单操作数 mv SRC', 'mv specs/900-fix-x'],
  ];

  for (const [label, command] of SKIP_CASES) {
    it(`${label} → 整条跳过`, () => {
      const cand = resolveWith(command);
      assert.equal(cand.path, 'specs/900-fix-x', `形态被误解析：${command}`);
      assert.equal(cand.ambiguous, false, `形态被误降级：${command}`);
    });
  }

  it('对照：恰好 2 操作数的常规形态仍正常跟随', () => {
    const cand = resolveWith('mv specs/900-fix-x specs/901-fix-x');
    assert.equal(cand.path, 'specs/901-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('对照：`--` 结束符后的 2 操作数仍正常跟随', () => {
    const cand = resolveWith('mv -- specs/900-fix-x specs/901-fix-x');
    assert.equal(cand.path, 'specs/901-fix-x');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F224 resolveFeatureDirCandidate：与当前候选无关的 mv 不得改变候选（FR-007 锚定）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  it('mv 的 src 不等于当前候选 → 候选原样保留', () => {
    const entries = [
      user('x'),
      write('specs/340-fix-current/fix-report.md', 1),
      bash('mv specs/399-fix-unrelated specs/400-fix-other', 2),
    ];
    const cand = resolveFeatureDirCandidate(entries, 0);
    assert.equal(cand.path, 'specs/340-fix-current');
    assert.equal(cand.ambiguous, false);
  });

  it('尚无候选时发生的改名 → 不产生任何信号（不得凭空提名）', () => {
    const entries = [user('x'), bash('git mv specs/341-fix-a specs/342-fix-b', 1)];
    const cand = resolveFeatureDirCandidate(entries, 0);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, false);
  });

  it('原地编辑准入放宽后判据不变：sed -i 命令未含制品全路径 → 不提名', () => {
    const entries = [user('x'), bash("sed -i '' 's#a#b#' specs/343-fix-x/notes.txt", 1)];
    const cand = resolveFeatureDirCandidate(entries, 0);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, false);
  });

  it('复合命令内先写制品再改名 → 同一条命令内叠加取最终路径', () => {
    const entries = [
      user('x'),
      bash('cat > specs/344-fix-a/fix-report.md <<EOF\n...\nEOF\nmv specs/344-fix-a specs/345-fix-b', 1),
    ];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/345-fix-b');
  });
});

describe('F224×F225 共存：复合命令内读形态不再劫持候选（原 F224 已知限界，由 F225 关闭）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);

  // 可追溯性：本 describe 的两条断言原是 F224 记录的「已知限界（本轮不修）」——当时写指示符门禁与
  // artifact 路径扫描都对**整条命令文本**判定，故"前段有写指示符 + 后段仅 cat 读取无关特性目录制品"
  // 会让后者被跨段背书提名为候选。该限界在 F224 改动前即存在（第二条对照组只用既有 `>` 门禁同样被劫持，
  // 证明 F224 非引入者），F225（c483485）按 `&&`/`||`/`;`/换行 切段并要求写指示符与 artifact 路径
  // **同段共现**后已关闭，故断言在此翻转为期望行为（不提名）。
  it('sed -i 前段 + cat 读取无关制品后段 → 不提名被读取的目录（F224 原地编辑准入亦受同段共现约束）', () => {
    const entries = [
      user('x'),
      bash("sed -i '' 's/x/y/' notes.txt; cat specs/999-fix-decoy/fix-report.md", 1),
    ];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });

  it('重定向前段 + cat 读取无关制品后段 → 不提名（原 F224 改动前对照组）', () => {
    // 本条完全不涉及 F224 新增的 sed/perl 准入，仅用既有 `>` 写指示符门禁。
    const entries = [
      user('x'),
      bash('echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md', 1),
    ];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, null);
  });
});

describe('F224 回归：既有 fixture 判定结果不受本次改动影响', () => {
  const NEW_FIXTURE_PREFIX = 'resolve-';
  const legacyFixtures = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.jsonl') && !f.startsWith(NEW_FIXTURE_PREFIX));

  it('存量 fixture 集合非空（防遍历失效导致本回归护栏空转）', () => {
    assert.ok(legacyFixtures.length >= 20, `存量 fixture 数=${legacyFixtures.length}`);
  });

  for (const name of legacyFixtures) {
    it(`${name} 不触达新增降级分支（ambiguous=false）`, () => {
      assert.equal(resolveFromFixture(name).ambiguous, false);
    });
  }
});

// ────────────────────────────────────────
// F228 · stripCodeRegions / checkArtifactSection 代码区豁免
// （行内 code span + fenced code 不参与占位符扫描）
// ────────────────────────────────────────

describe('F228 · stripCodeRegions / checkArtifactSection 代码区豁免（行内 code span + fenced code 不参与占位符扫描）', () => {
  describe('stripCodeRegions 单元测试', () => {
    it('1. 行内单反引号 code span 含花括号 → 返回文本不含 `{`', () => {
      const line = 'text `{x}` more';
      const result = stripCodeRegions(line);
      assert.ok(!result.includes('{'), result);
    });

    it('2. 行内双反引号 code span（内部含单个反引号）含花括号 → 正确剥离', () => {
      const line = 'shape is ``{a: `x`}`` here.';
      const result = stripCodeRegions(line);
      assert.ok(!result.includes('{'), result);
    });

    it('3. fenced（```）代码块含花括号 → 整块清空', () => {
      const text = ['prefix', '```', '{"a":1}', '```', 'suffix'].join('\n');
      const result = stripCodeRegions(text);
      assert.ok(!result.includes('{'), result);
      assert.ok(result.includes('prefix') && result.includes('suffix'));
    });

    it('4. fenced（~~~）代码块含花括号 → 整块清空（验证围栏字符切换仍走同一 computeFenceMask）', () => {
      const text = ['prefix', '~~~', '{"a":1}', '~~~', 'suffix'].join('\n');
      const result = stripCodeRegions(text);
      assert.ok(!result.includes('{'), result);
      assert.ok(result.includes('prefix') && result.includes('suffix'));
    });

    it('5. 4 个反引号围栏且内部含 3 个反引号字面量 → 按长度精确配对剥离，不误配', () => {
      // 第一个 4-反引号 run 须找长度恰为 4 的下一个 run 才闭合；中间的 3-反引号 run 长度不符须被跳过、不消费
      const line = 'x ````{a} ``` b```` y';
      const result = stripCodeRegions(line);
      assert.ok(!result.includes('{'), result);
      assert.ok(!result.includes('`'), '反引号应被完整替换，不应残留');
    });

    it('6. 未闭合反引号后紧跟花括号 → 反引号原样保留，花括号不被剥离', () => {
      const line = '`{x} more text';
      const result = stripCodeRegions(line);
      assert.equal(result, line, '未闭合反引号场景应恒等（不剥离）');
      assert.ok(result.includes('{'));
    });

    it('7. 表格行内 code span 含花括号 → 正确剥离', () => {
      const line = '| shape | `{x}` |';
      const result = stripCodeRegions(line);
      assert.ok(!result.includes('{'), result);
    });

    it('8. 跨行"code span"（反引号跨两行不闭合）→ 按行独立处理，非缺陷（已知 non-goal）', () => {
      // 第一行反引号视为未闭合（同行无闭合 run）；第二行反引号视为新的独立起点，同样在本行内未闭合。
      // 两行各自恒等保留，非跨行配对——这是文档化的 non-goal（plan.md Q3），不是缺陷。
      const text = 'a `open\nclose` b';
      const result = stripCodeRegions(text);
      assert.equal(result, text, '逐行独立扫描不做跨行配对，结果应恒等');
    });
  });

  describe('checkArtifactSection 集成测试（对应 fix-report 复现证据表 R1/A/B/C/D/E + 2 个新增边界）', () => {
    it('R1（用户硬性验收①）：还原 F227 报告写法，Root Cause Chain 正文含行内 code span 花括号描述返回值形状 → placeholderResidue=false', () => {
      // 反事实还原：作者原本自然的写法是用行内 code span 描述对象字面量返回值形状
      // （真实生产场景见 specs/227-fix-compliance-candidate-disk-filter/fix-report.md L35，
      // 作者当时被迫改写为不含花括号的 `path=null/ambiguous=true` 绕开写法）
      const content = [
        '# 问题修复报告（F227）',
        '',
        '**Root Cause**: 候选特性目录的解析是"纯文本层 last-writer-wins 的单值状态机"，磁盘核验被排在其后、且只对唯一幸存者执行。',
        '',
        '**Root Cause Chain**: 合规会话被阻断 → judge 收到 `{path: null, ambiguous: true}` → trackedDir 停在非规范名，该值来自会话自身 fixture 文本的 mv 误解析。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('A：锚点后散文里含行内 code span 花括号 → false', () => {
      const content = [
        '# 问题修复报告',
        '',
        '**Root Cause**: 候选目录解析在改名场景下返回空候选，判定器整体 fail-open 放行。',
        '',
        '**Root Cause Chain**: 合规会话被阻断 → `resolveFeatureDirCandidate` 返回 `{path: null, ambiguous: true}` → 调用方未区分两种 null 语义 → 候选目录解析静默失败。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('B：fenced code 块含花括号（同源第二形态）→ false', () => {
      const content = [
        '# 问题修复报告',
        '',
        '**Root Cause**: 判定器把示例 JSON 当成未替换模板占位符，误判制品为占位空壳，阻断合规收口。',
        '',
        '对账行形如：',
        '',
        '```json',
        '{"claim":"症状已消除","command":"npx vitest run","expected":"PASS"}',
        '```',
        '',
        '该 JSON 是真实证据而非模板残留。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('C（用户硬性验收②，回归锁定）：散文裸花括号、真实未替换占位符 → true', () => {
      const content = '# 报告\n\n**Root Cause**: {根本原因一句话总结}，此处仍是模板占位没有替换成真实内容呢。';
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    it('D（回归锁定）：正文过短（≤20 非空白字符）→ true', () => {
      const content = '# 报告\n\n**Root Cause**: 待补';
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    it('E：散文空洞但 fenced code 撑长度（既有行为）→ false', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 见下',
        '',
        '```js',
        'const evidence = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
        '```',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('新增边界 1：未闭合反引号后紧跟裸花括号（伪装成半个 code span）→ 仍判 true，证明伪装不构成绕过', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: `未闭合反引号伪装 {真实占位符未替换} 内容。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    it('新增边界 2：行内 code span 与散文裸花括号在同一章节正文中共存 → true（code span 部分豁免，裸花括号部分仍命中，二者不互相污染）', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 示例代码 `{a: 1}` 描述实现，但本节仍有真实占位符 {待补充的原因说明} 尚未替换。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });
  });

  describe('MIN_SECTION_BODY_CHARS 与代码剥离交互专项断言（分离契约：长度判据吃剥离前文本，占位符判据吃剥离后文本）', () => {
    // 本组用例锁定 F228 的核心分离契约：checkArtifactSection 内部
    //   - 长度判据（bodyChars）计算源 = proseBody（stripReconSubblock(body) 原文，逐字不变）
    //   - 占位符判据计算源 = placeholderScanText（stripCodeRegions(proseBody) 剥离后文本）
    // 若未来有人把两者误改为共用同一份输入（例如都改用剥离后文本），下面第一个用例会从
    // false 翻成 true（散文简短但有实质 fenced code 证据的合规章节被误判为占位空壳），
    // 从而暴露回归——这正是 fix-report.md「为何长度判据必须留在未剥代码的文本上」的护栏。
    it('散文不足 20 字符 + fenced code 块含大量字符但不含花括号 → false（未过短、非占位）', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 见下',
        '',
        '```js',
        'const evidence = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
        '```',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('对照组：同样散文 + 同样字符总量但用不含围栏的纯散文填充 → 效果一致（false）', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 见下，该证据已经在历史提交中被详细记录并通过完整回归测试确认修复无误无遗漏。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });
  });

  describe('R2 · Codex 对抗审查回归修复反向断言（CRITICAL-1a/1b 模板占位符代码区不豁免；CRITICAL-2 未闭合围栏不剥离）', () => {
    it('CRITICAL-1a：repair 形态模板占位符包进行内 code span → 仍判 residue=true（代码区不豁免 canonical 占位符）', () => {
      const content = [
        '# 问题修复报告',
        '',
        '**Root Cause**: `{根本原因一句话总结}`',
        '**Root Cause Chain**: `{症状} → {Why 1} → {Why 2} → {根因}`',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    it('CRITICAL-1b：no-op 形态模板占位符包进行内 code span → 仍判 residue=true', async () => {
      const { NOOP_JUDGMENT_HEADING_REGEX } = await import(CORE_MODULE_URL);
      const content = [
        '# 报告', '', '## 判定依据',
        '`{为何判断问题已不存在/无需代码改动的具体证据：如指向已生效的历史修复 commit、实际复现测试结果}`',
      ].join('\n');
      const r = checkArtifactSection(content, NOOP_JUDGMENT_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    describe('CANONICAL_PLACEHOLDER_REGEX 判别边界（表驱动，协调方复审收窄排除集为「不含 ASCII 冒号」）', () => {
      // 新增模板占位符或新增代码字面量形态时，先在此表补例——保持判别边界的单一事实源。
      // 判别原则：ASCII 冒号才是"这是代码/JSON 字面量"的可靠标志（对象字面量/JSON 必靠键值 `:` 表达结构）；
      // ASCII 引号不是可靠标志（canonical 中文占位符本身也可能含引号），故排除集不含引号。
      const canonicalPlaceholderCases = [
        // ── 应命中：canonical 中文模板占位符 ──
        { text: '{根本原因一句话总结}', shouldMatch: true },
        { text: '{症状}', shouldMatch: true },
        { text: '{根因}', shouldMatch: true },
        { text: '{理由}', shouldMatch: true },
        { text: '{为何判断问题已不存在/无需代码改动的具体证据：如指向已生效的历史修复 commit、实际复现测试结果}', shouldMatch: true },
        { text: '{spec 文件列表，或"无需更新"}', shouldMatch: true }, // 含 ASCII 引号仍应命中（协调方复审核心用例）
        { text: '{委派的子代理角色 + 核实结论摘要}', shouldMatch: true },
        { text: '{用户原始描述}', shouldMatch: true },
        // ── 应豁免：真实代码/JSON 字面量（含 ASCII 冒号，判为代码） ──
        { text: '{path: null, ambiguous: true}', shouldMatch: false },
        { text: '{"claim":"症状已消除","command":"npx vitest run","expected":"PASS"}', shouldMatch: false },
        { text: '{ ok: true }', shouldMatch: false },
        { text: '{x}', shouldMatch: false }, // 无中文表意文字，规则前置条件不满足
        { text: '{ ...rest }', shouldMatch: false }, // 无中文表意文字
        { text: '{path, ambiguous}', shouldMatch: false }, // 无中文表意文字
      ];
      for (const { text, shouldMatch } of canonicalPlaceholderCases) {
        it(`${shouldMatch ? '命中' : '豁免'}：\`${text}\``, () => {
          // 借道 checkArtifactSection 的真实消费路径验证（而非直接 import 内部未导出的正则）：
          // 用例包进行内 code span（反引号）——这样通用花括号判据（PLACEHOLDER_BRACE_REGEX，扫描
          // 剥离代码区之后的文本）不会对"应豁免"用例误报；而 canonical 判据（扫描剥离前的 proseBody）
          // 不受代码区豁免，"应命中"用例仍会被捕获——精确隔离出 CANONICAL_PLACEHOLDER_REGEX 自身的判别力。
          const content = [
            '# 报告',
            '',
            `**Root Cause**: 占位符判别边界用例 \`${text}\` 附带填充文字以越过最小长度门槛。`,
          ].join('\n');
          const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
          assert.equal(r.placeholderResidue, shouldMatch, JSON.stringify(r));
        });
      }
    });

    it('CRITICAL-2：未闭合 fence 吞掉整段（含后续 H2 与其后模板占位符）→ 仍判 residue=true', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**:',
        '```text',
        '{根本原因一句话总结}',
        '**Root Cause Chain**: {症状} → {Why 1} → {根因}',
        '## 影响范围扫描',
        '{仍未填写的模板内容}',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });

    describe('computeFenceRegions 单测（F228 R2-1 单一扫描器）', () => {
      it('全部闭合 → unclosedFrom === -1，mask 与 computeFenceMask 返回一致', async () => {
        const { computeFenceRegions, computeFenceMask } = await import(CORE_MODULE_URL);
        const lines = ['前言', '```bash', 'echo hi', '```', '尾声'];
        const { mask, unclosedFrom } = computeFenceRegions(lines);
        assert.equal(unclosedFrom, -1);
        assert.deepEqual(mask, computeFenceMask(lines));
      });

      it('未闭合围栏 → unclosedFrom 等于开围栏行下标，mask 仍与 computeFenceMask 一致', async () => {
        const { computeFenceRegions, computeFenceMask } = await import(CORE_MODULE_URL);
        const lines = ['前言', '```text', '第一行', '第二行'];
        const { mask, unclosedFrom } = computeFenceRegions(lines);
        assert.equal(unclosedFrom, 1);
        assert.deepEqual(mask, computeFenceMask(lines));
        assert.deepEqual(mask, [false, true, true, true]);
      });
    });

    describe('存量行为（非本次 F228 R2 回归，改动需另立 feature，逐条钉住不动）', () => {
      // F228 R3-4：以下三条断言为 characterization test——记录 checkArtifactSection **当前**的
      // 真实输出，不代表这是"期望的正确行为"。三者均为已知存量缺口（PLACEHOLDER_BRACE_REGEX
      // 要求闭合花括号、stripCodeRegions 不做跨行 code span 配对、computeFenceMask 不识别
      // 4 空格缩进代码块），修复需要独立评估各自的误判/漏判权衡再另立 feature 处理，
      // 本轮 R3 明确不动这三处判据本身，钉住是为了让未来任何改动都会被本测试显式感知到。
      it('存量绕过（characterization，非期望行为）：缺右花括号（`{未闭合的占位文本`）→ 当前判 residue=false', async () => {
        const { NOOP_JUDGMENT_HEADING_REGEX } = await import(CORE_MODULE_URL);
        const content = [
          '# 报告', '', '## 判定依据',
          '{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果',
        ].join('\n');
        const r = checkArtifactSection(content, NOOP_JUDGMENT_HEADING_REGEX);
        assert.equal(r.placeholderResidue, false, JSON.stringify(r));
      });

      it('存量误报（characterization，非期望行为）：跨行 code span（反引号跨两行不闭合）→ 当前判 residue=true', async () => {
        const { NOOP_JUDGMENT_HEADING_REGEX } = await import(CORE_MODULE_URL);
        const content = [
          '# 报告', '', '## 判定依据',
          '经实际复现确认返回值为 `',
          '{ path: null, ambiguous: true }',
          '`，调用方会正确走降级分支，因此当前代码路径无缺陷。',
        ].join('\n');
        const r = checkArtifactSection(content, NOOP_JUDGMENT_HEADING_REGEX);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('存量误报（characterization，非期望行为）：4 空格缩进代码块 → 当前判 residue=true', async () => {
        const { NOOP_JUDGMENT_HEADING_REGEX } = await import(CORE_MODULE_URL);
        const content = [
          '# 报告', '', '## 判定依据',
          '经实际复现得到以下输出，证明当前路径行为正确，无需任何代码改动。',
          '    const result = { ok: true };',
        ].join('\n');
        const r = checkArtifactSection(content, NOOP_JUDGMENT_HEADING_REGEX);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });
    });

    describe('F228 R3 · Codex 第二轮对抗审查修复反向断言', () => {
      it('R3-1a：中文占位符里塞 ASCII 冒号绕开 canonical 判据，再包一层 code span → 仍判 residue=true', () => {
        const content = [
          '# 报告', '', '## 判定依据',
          '`{为何判断问题已不存在/无需代码改动: 请填写真实 commit 与复现结果}`',
        ].join('\n');
        const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('R3-1b：纯 ASCII 模板字段（本不含中文，canonical 判据天然不命中）包进 code span → 仍判 residue=true', () => {
        const content = [
          '# 报告',
          '',
          '**Root Cause**: `{path} {line} {pattern} {action} {field_name}`',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('R3-2：转义反引号（Markdown 里不是 code span 定界符）包裹的模板字段 → 仍判 residue=true', () => {
        const content = [
          '# 报告',
          '',
          '**Root Cause**: \\`{path} {line} {pattern} {action} {field_name}\\`',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('R3-2：stripCodeRegions 对转义反引号恒等保留（不当作定界符消费，花括号不被剥离）', () => {
        const line = '\\`{path}\\` 后续文本';
        const result = stripCodeRegions(line);
        assert.equal(result, line, '转义反引号场景应恒等保留');
        assert.ok(result.includes('{'), '花括号不应被误判为 code span 内容而剥离');
      });

      it('R3-2 对照：转义反斜杠自身（偶数个反斜杠）后的反引号仍是真实定界符 → 正常剥离', () => {
        const line = 'text \\\\`{x}\\\\` more';
        const result = stripCodeRegions(line);
        assert.ok(!result.includes('{'), result);
      });

      it('R3-3：`### 复现对账` 子块内含未闭合围栏、其后有真实 H2 与模板占位符 → 仍判 residue=true（子块正确终止，不再吞掉后续正文）', () => {
        const content = [
          '# 报告',
          '',
          '## 判定依据',
          '',
          '散文证据充分详实，长度超过最短阈值不会触发过短判据，字数字数字数字数字数字数。',
          '',
          '### 复现对账',
          '```text',
          '未闭合围栏演示内容',
          '## 影响范围扫描',
          '{仍未填写的模板内容}',
        ].join('\n');
        const r = checkArtifactSection(content, /^##\s*判定依据\s*$/m);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('R3 回归保护：既有合法用例仍为 false —— 行内 code span 对象字面量 + 长散文', () => {
        const content = [
          '# 报告',
          '',
          '**Root Cause**: 候选目录解析在改名场景下返回空候选，判定器整体 fail-open 放行。',
          '',
          '**Root Cause Chain**: 合规会话被阻断 → `resolveFeatureDirCandidate` 返回 `{path: null, ambiguous: true}` → 调用方未区分两种 null 语义 → 候选目录解析静默失败。',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
        assert.equal(r.placeholderResidue, false, JSON.stringify(r));
      });

      it('R3 回归保护：既有合法用例仍为 false —— fenced JSON + 真实散文', () => {
        const content = [
          '# 问题修复报告',
          '',
          '**Root Cause**: 判定器把示例 JSON 当成未替换模板占位符，误判制品为占位空壳，阻断合规收口。',
          '',
          '对账行形如：',
          '',
          '```json',
          '{"claim":"症状已消除","command":"npx vitest run","expected":"PASS"}',
          '```',
          '',
          '该 JSON 是真实证据而非模板残留。',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
        assert.equal(r.placeholderResidue, false, JSON.stringify(r));
      });

      it('R3 回归保护：既有合法用例仍为 false —— 散文空洞但 fenced code 无花括号撑长度', () => {
        const content = [
          '# 报告',
          '',
          '**Root Cause**: 见下',
          '',
          '```js',
          'const evidence = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";',
          '```',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
        assert.equal(r.placeholderResidue, false, JSON.stringify(r));
      });
    });
  });
});
