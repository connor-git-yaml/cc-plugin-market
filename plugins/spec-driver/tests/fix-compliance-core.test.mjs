/**
 * fix-compliance-core.test.mjs
 * Feature 208 — fix 模式流程依从性判定核心（纯函数）单测
 *
 * Tests FIRST（research.md D7）：本文件先于 fix-compliance-core.mjs 存在，
 * 实现缺失时 import 失败即为红；实现补齐后转绿。
 *
 * 运行: node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  normalizeTranscriptEntry,
  detectFixSkillExpansion,
  extractDelegationsAfter,
  classifyDelegationRole,
  resolveFeatureDirCandidate,
  scanRenameCommandEvents,
  parseRenameOperands,
  checkArtifactSection,
  stripCodeRegions,
  classifyClosureForm,
  judgeCompliance,
  resolveEnforcementFromConfig,
  MISSING_ACTION_TEXT,
  ENFORCEMENT_VALUES,
  ROOT_CAUSE_HEADING_REGEX,
  detectTranscriptDialect,
  CLAUDE_TRANSCRIPT_ROLES,
  CODEX_ROLLOUT_ROLES,
  FOREIGN_DIALECT_DIAGNOSTICS,
  extractFixShortName,
  FIX_DIR_NAME_REGEX,
  extractInFlightDelegationsAfter,
  DEFERRABLE_MISSING_KEYS,
  isDeferrableMissingSet,
  collectArtifactWriteWitnessDirs,
  ARTIFACT_WRITER_TOOL_NAMES,
  countAssistantEntriesSinceEarliestFixExpansion,
  countStorageUnavailableBlockFeedback,
  HOOK_FEEDBACK_PREFIX,
  STORAGE_UNAVAILABLE_FEEDBACK_TOKEN,
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
    // F231 第 9/10 轮：严格 option 白名单——裸 `mv` 只接受短选项 `-f`/`-v`/`-fv`/`-vf`；
    // 长选项是 GNU coreutils 专有（Darwin `/bin/mv --force` 实测 illegal option rc=64 无改名），
    // 故 `--force`/`--verbose` 只对 `git mv` 有效（实测 rc=0 真改名）。`--no-clobber`/`--` 一律拒绝。
    ['git mv 长 flag --force', 'git mv --force specs/360-fix-src specs/361-fix-dst'],
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

  // F231 第 9 轮翻转：`--` 不在严格 option 白名单内 → 不再跟随（旧期望 specs/901-fix-x）。
  // 理由：白名单只收「确定保持真实改名语义」的 option；`--` 本身不保证改名发生，
  // 且放行任意 option 形态曾让 dry-run / illegal option 命令被当成真实改名（第 9 轮 CRITICAL-2）。
  // 方向 fail-closed（误阻断而非误放行），缓解=改名写成 `git mv specs/old specs/new`。
  it('`--` 结束符 → 不再跟随（F231 第 9 轮：严格 option 白名单）', () => {
    const cand = resolveWith('mv -- specs/900-fix-x specs/901-fix-x');
    assert.equal(cand.path, 'specs/900-fix-x');
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

  // F231 第 5 轮：该命令含 heredoc 与两条命令 → 非光杆改名 → 改名不跟随（旧期望 specs/345-fix-b）。
  // 提名侧逐字未改：`cat > specs/344-fix-a/fix-report.md` 仍提名 specs/344-fix-a。
  // 安全方向为误阻断；缓解=把改名单独写成一条 `git mv specs/344-fix-a specs/345-fix-b`。
  it('复合命令内先写制品再改名 → 改名不跟随，提名仍成立（F231 第 5 轮）', () => {
    const entries = [
      user('x'),
      bash('cat > specs/344-fix-a/fix-report.md <<EOF\n...\nEOF\nmv specs/344-fix-a specs/345-fix-b', 1),
    ];
    assert.equal(resolveFeatureDirCandidate(entries, 0).path, 'specs/344-fix-a');
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

describe('F230 改名跟随命令位锚定：伪造 mv 一律不得跟随（差分矩阵 A/D + Codex 审查发现的 F1-F4）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  // 本组钉的是同一个安全性质：**只有真正位于命令位（段首）的 mv/git mv 才算发生过改名**。
  // 旧实现把 mv 当"段内任意位置的关键字"，于是任何把 mv 当普通文本写出来的命令都会被误读为真实改名，
  // 把候选带到非规范名 → 打开 F224 的 fail-open 降级通道（fix-report 差分矩阵 A/D）。
  // 期望一律为「候选保持原状」：path === 'specs/900-fix-x' 且 ambiguous === false，
  // 即伪造文本既不改候选、也不置降级标记。
  const FORGED_CASES = [
    ['A  注释掉的 mv（用户原始复现）', 'true # mv specs/900-fix-x specs/renamed-nonstandard'],
    ['D1 单引号包裹', "echo 'mv specs/900-fix-x specs/renamed-nonstandard'"],
    ['D2 双引号包裹', 'echo "mv specs/900-fix-x specs/renamed-nonstandard"'],
    ['F1 裸参数（既无注释也无引号）', 'echo mv specs/900-fix-x specs/renamed-nonstandard'],
    ['F2 其他命令的参数位', 'grep mv specs/900-fix-x specs/renamed-nonstandard'],
    ['F3 引号内藏分号（切段后落到后段段首，靠全命令引号跟踪拦）', "echo 'a;mv specs/900-fix-x specs/renamed-nonstandard'"],
    ['F4 引号内藏 &&（同上）', "echo 'a&&mv specs/900-fix-x specs/renamed-nonstandard'"],
    // F230 第 2 轮 Codex CRITICAL：以"引号字符出现次数奇偶"做配平判定可被转义引号凑成偶数，
    // 重新打开 fail-open 降级通道。二者均须由 shell 语义级引号跟踪拦下。
    ['F5 双引号内藏分号 + 尾部转义引号（凑偶数）', 'echo "a;mv specs/900-fix-x specs/renamed-nonstandard\\""'],
    ['F6 单引号内藏分号 + `\'\\\'\'` 拼接（凑偶数）', "echo 'a;mv specs/900-fix-x specs/renamed-nonstandard'\\''x'"],
    ['F7 引号内藏裸管道（分隔符不止 ; 与 &&）', "echo 'a|mv specs/900-fix-x specs/renamed-nonstandard'"],
    // F230 第 3 轮 Codex CRITICAL：
    // R3-C1 正则一次吞掉参数文本时，参数里的引号/转义不参与状态转移，引号内的 `;` 被当真实分隔符，
    //       凭空多识别出一条并不存在的改名 → 参数须由同一状态机继续扫描收集。
    ['F8 参数内引号藏 mv（R3-C1）', 'mv source "dest;mv specs/900-fix-x specs/renamed-nonstandard"'],
    ['F9 参数内转义分号藏 mv（R3-C1）', 'mv source dest\\;mv specs/900-fix-x specs/renamed-nonstandard'],
    // R3-C2 无 comment / redirection 状态时，注释里的 `;` 与重定向 `>&` 的 `&` 都会开启命令位。
    ['F10 注释内藏分号（R3-C2）', 'true # ; mv specs/900-fix-x specs/renamed-nonstandard'],
    ['F11 重定向 `>&` 的 & 不是控制操作符（R3-C2）', 'echo hi >& mv specs/900-fix-x specs/renamed-nonstandard'],
    // R3-C3 `\b` 不是 shell token 边界，`mv-f` 会被读成 `mv -f`。
    ['F12 mv-f 是另一个命令（R3-C3）', 'mv-f specs/900-fix-x specs/renamed-nonstandard'],
    ['F13 git mv-f 同上（R3-C3）', 'git mv-f specs/900-fix-x specs/renamed-nonstandard'],
  ];

  for (const [label, command] of FORGED_CASES) {
    it(`${label} → 候选保持原状、不进入降级通道`, () => {
      const entries = [
        user('x'),
        write('specs/900-fix-x/fix-report.md', 1),
        bash(command, 2),
      ];
      const cand = resolveFeatureDirCandidate(entries, 0);
      assert.equal(cand.path, 'specs/900-fix-x', `command=${command}`);
      assert.equal(cand.ambiguous, false, `command=${command}`);
    });
  }
});

describe('F230 命令位锚定不得误伤合法改名（防过度收紧的正向保住组）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWithCandidate = (command) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/900-fix-x/fix-report.md', 1),
    bash(command, 2),
  ], 0);

  // C1/C2 钉的是「真实改名到非规范名仍须降级」——F224 的合法 fail-open 设计意图不得被本次收窄误伤。
  it('C1 真实 mv 到非规范名 → 仍转降级（ambiguous）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/renamed-nonstandard');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  it('C2 真实 git mv 到非规范名 → 仍转降级（ambiguous）', () => {
    const cand = resolveWithCandidate('git mv specs/900-fix-x specs/renamed-nonstandard');
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  it('C3 mv -f 带 flag → 正常跟随', () => {
    const cand = resolveWithCandidate('mv -f specs/900-fix-x specs/901-fix-y');
    assert.equal(cand.path, 'specs/901-fix-y');
    assert.equal(cand.ambiguous, false);
  });

  it('C4 `&&` 条件右侧改名不跟随（F231：白名单拒绝 && / ||）', () => {
    // F231 变更：`cd . && mv …` 含 `&&` → 非「简单改名序列」子语言成员 → 白名单闸门拒绝 →
    // 零改名事件 → 候选停在改名前的 specs/900-fix-x（ambiguous=false）。
    // 方向保守（误阻断而非误放行）：真实的 `prep && mv` 链式改名会被误阻断，缓解手段是把改名
    // 单独写成一条 `git mv specs/900-fix-x specs/901-fix-y`（裸顶层命令即照常跟随，见下方 C6 等）。
    const cand = resolveWithCandidate('cd . && mv specs/900-fix-x specs/901-fix-y');
    assert.deepEqual(cand, { path: 'specs/900-fix-x', ambiguous: false, candidates: ['specs/900-fix-x'] });
  });

  // F231 第 5 轮：整条命令须为光杆改名，以下四条形态改为不跟随。
  // 旧期望分别为 specs/901-fix-y（C5）与 specs/902-fix-z（C6/C6b/C6c，多跳取最终态）。
  // 为何安全：方向是**误阻断**（候选停在提名目录、ambiguous=false、绝不放行），
  // 缓解=把改名单独写成一条 `git mv specs/old specs/new`。为何这么改：判据不再建模分隔符 /
  // heredoc / 注释——前四轮的分隔符与 heredoc 建模被 Codex 逐轮击穿，每补一个缺口就暴露下一个。
  it('C5 heredoc 之后的 mv → 不再跟随（F231 第 5 轮：整条命令须为光杆改名）', () => {
    const entries = [
      user('x'),
      bash('cat > specs/900-fix-x/fix-report.md <<EOF\nbody\nEOF\nmv specs/900-fix-x specs/901-fix-y', 1),
    ];
    const cand = resolveFeatureDirCandidate(entries, 0);
    assert.equal(cand.path, 'specs/900-fix-x', '提名仍成立，仅改名不跟随');
    assert.equal(cand.ambiguous, false);
  });

  it('C6 分号串联两跳改名 → 不再跟随（F231 第 5 轮：整条命令须为光杆改名）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/901-fix-y; mv specs/901-fix-y specs/902-fix-z');
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  // W1（Codex 第 2 轮）原 characterization：裸 `|` / `&` 也计为控制操作符，故两跳均跟随。
  // F231 第 5 轮起判据不再有「控制操作符」概念——多命令一律非光杆形态。
  it('C6b 裸管道串联两跳改名 → 不再跟随（F231 第 5 轮：整条命令须为光杆改名）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/901-fix-y | mv specs/901-fix-y specs/902-fix-z');
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('C6c 裸后台符 `&` 串联两跳改名 → 不再跟随（F231 第 5 轮：整条命令须为光杆改名）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/901-fix-y & mv specs/901-fix-y specs/902-fix-z');
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('C7 提名侧不受影响（scanArtifactPath 逐字未改，注释形态写入仍提名）', () => {
    const entries = [
      user('x'),
      bash('echo "# 修复报告" > specs/902-fix-comment/fix-report.md', 1),
    ];
    const cand = resolveFeatureDirCandidate(entries, 0);
    assert.equal(cand.path, 'specs/902-fix-comment');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F230 scanRenameCommandEvents：命令位判定的直接单测（引号/转义/注释/重定向/分隔符）', () => {
  /** 断言用投影：只看 paramText（trim 后）保序列表 */
  const params = (command) => scanRenameCommandEvents(command).map((e) => e.paramText.trim());

  it('纯 mv → 抽出一条事件，含偏移与参数文本', () => {
    assert.deepEqual(scanRenameCommandEvents('mv specs/900-fix-x specs/901-fix-y'), [
      { offset: 0, paramText: ' specs/900-fix-x specs/901-fix-y' },
    ]);
  });

  it('git mv → 同样抽出；`git\\nmv` 内部换行改为零事件（F231 第 5 轮）', () => {
    assert.deepEqual(scanRenameCommandEvents('git mv a b'), [{ offset: 0, paramText: ' a b' }]);
    // 旧期望 ['a b']（换行后的 mv 自身在命令位）。F231 第 5 轮：命令内部换行 = 多命令形态 = 非光杆。
    assert.deepEqual(params('git\nmv a b'), [], '内部换行不再是光杆改名（方向：误阻断，安全）');
  });

  it('引号内的 mv 不出现在结果中（单引号 / 双引号 / 引号内藏分隔符）', () => {
    assert.deepEqual(scanRenameCommandEvents("echo 'mv a b'"), []);
    assert.deepEqual(scanRenameCommandEvents('echo "mv a b"'), []);
    assert.deepEqual(scanRenameCommandEvents("echo 'a;mv a b'"), []);
    assert.deepEqual(scanRenameCommandEvents("echo 'a|mv a b'"), []);
  });

  it('转义引号不得让引号状态错位（字符奇偶计数会被凑成偶数的构造）', () => {
    assert.deepEqual(scanRenameCommandEvents('echo "a;mv a b\\""'), []);
    assert.deepEqual(scanRenameCommandEvents("echo 'a;mv a b'\\''x'"), []);
  });

  // R3-C1：参数文本必须由同一状态机继续收集。若让正则一次吞掉参数，
  // 参数里的开引号不参与状态转移，引号内的 `;` 会被当真实分隔符，凭空多出第二条事件。
  // R3-C1 的收口目标（参数里的 `;` 不得凭空多出第二条事件）在 F231 第 5 轮由更强的判据达成：
  // 引号与 `;` 都不在 <PATH> 字符集内，整条命令直接非光杆 → 零事件（旧期望是 1 条事件）。
  it('参数内引号包裹的 mv → 零事件（F231 第 5 轮：引号不在 <PATH> 字符集内）', () => {
    assert.deepEqual(scanRenameCommandEvents('mv src "dst;mv a b"'), []);
  });

  it('参数内转义分号 → 零事件（F231 第 5 轮：`\\` 与 `;` 不在 <PATH> 字符集内）', () => {
    assert.deepEqual(params('mv src dst\\;mv a b'), []);
  });

  // R3-C2：注释与重定向各自成状态，其中的 `;` / `&` 都不得开启命令位。
  it('注释内的分隔符不开启命令位（R3-C2）；换行后的真实 mv 亦不再跟随（F231 第 5 轮）', () => {
    assert.deepEqual(scanRenameCommandEvents('true # ; mv a b'), []);
    // 旧期望 ['c d']（注释只到行尾，下一行正常识别）。第 5 轮：多命令形态 → 零事件（误阻断方向）。
    assert.deepEqual(params('true # ; mv a b\nmv c d'), []);
  });

  it('重定向操作符中的 `&` 不是控制操作符（R3-C2）', () => {
    assert.deepEqual(scanRenameCommandEvents('echo hi >& mv a b'), []);
    assert.deepEqual(scanRenameCommandEvents('echo hi &> mv a b'), []);
  });

  // R3-C3：`\b` 不是 shell token 边界，`mv-f` 是另一个命令而非 `mv -f`。
  it('命令名须以行尾或空白终止，`mv-f` / `git mv-f` 不算 mv（R3-C3）', () => {
    assert.deepEqual(scanRenameCommandEvents('mv-f a b'), []);
    assert.deepEqual(scanRenameCommandEvents('git mv-f a b'), []);
  });

  // F231 第 5 轮：多命令一律零事件（旧期望是抽出两项、多跳取最终态）。
  // 安全方向：误阻断而非误放行；缓解=改名单独写一条 `git mv`。
  it('`;` 串联两条 mv → 零事件（F231 第 5 轮：整条命令须为光杆改名）', () => {
    assert.deepEqual(scanRenameCommandEvents('mv a b; mv b c'), []);
  });

  it('`|` 串联两条 mv → 零事件（F231 第 5 轮：整条命令须为光杆改名）', () => {
    assert.deepEqual(params('mv a b | mv b c'), []);
  });

  it('非命令位的 mv（注释 / 其他命令的参数位）→ 空结果', () => {
    assert.deepEqual(scanRenameCommandEvents('true # mv a b'), []);
    assert.deepEqual(scanRenameCommandEvents('echo mv a b'), []);
    assert.deepEqual(scanRenameCommandEvents('grep mv a b'), []);
  });
});

describe('F230 第 3 轮：改名事件按偏移归段，保持「段内先提名、再改名」的执行时序（R3-C4）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);

  // 与 HEAD 逐字一致的时序语义 characterization：改名发生在提名**之前**，
  // 此时尚无已跟踪目录（FR-001 只跟随"已知"目录），故该 mv 与本次收口无关、被整条忽略；
  // 随后同一命令后段的重定向写入才提名出候选 specs/900-fix-x。
  // 若实现改为「先跑完所有段的提名、再统一改名」，早于提名的改名会被倒灌到后来才出现的候选上，
  // 把 path 带到 specs/renamed-nonstandard 并置 ambiguous —— 相对 HEAD 凭空新增一条 fail-open。
  it('先改名后写入：改名早于提名，不得倒灌到后来才出现的候选', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      bash('mv specs/900-fix-x specs/renamed-nonstandard; printf x > specs/900-fix-x/fix-report.md', 1),
    ], 0);
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F230 第 3 轮行为变化 characterization：注释感知让「带尾注释的真实改名」被正确跟随', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWithCandidate = (command) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/900-fix-x/fix-report.md', 1),
    bash(command, 2),
  ], 0);

  // HEAD 把 `#` 与注释词当成多余操作数（3 个操作数）从而整条跳过，改名不被跟随。
  // 引入注释状态后，注释被正确剥离，这是**正确性改进**而非放宽：
  // 真实改名本就该被跟随，且目标名仍须符合 NNN-fix-<name> 规范才不触发降级（见下一条）。
  // F231 第 5 轮：`#` 不在 <PATH> 字符集内，带尾注释的命令不再是光杆形态 → 两条均改为零事件。
  // 旧期望：第一条跟随到 901-fix-y（注释被剥离）、第二条转降级 ambiguous=true。
  // 新语义在两个方向上都更严：真实改名不跟随（误阻断，缓解=改名单独一条 `git mv`），
  // 伪造改名亦不再打开降级通道（安全侧收紧）。
  it('`mv A B # 注释` → 不再跟随（F231 第 5 轮：`#` 使命令非光杆）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/901-fix-y # 迁移');
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('`mv A <非规范名> # 注释` → 不再进入降级通道（F231 第 5 轮：更严，非放宽）', () => {
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/renamed-nonstandard # 迁移');
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });
});

describe('F230 R4 · shell 词法边界与长度上界（Codex 第 4 轮对抗审查 CRITICAL）', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWithCandidate = (command) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/900-fix-x/fix-report.md', 1),
    bash(command, 2),
  ], 0);

  /**
   * F231 第 5 轮起 core 内已无长度上界常量（随参数收集状态机一并删除）。
   * 这里保留 400 只作为"足够长的空白填充"量级，用来复现 R4-4 的超长空白构造，不再对应任何生产常量。
   */
  const PARAM_MAX_LENGTH = 400;

  // 本组每条构造在真实 bash 下都**不会**产生一次到 specs/renamed-nonstandard 的改名，
  // 期望一律为「候选保持原状」：path === 'specs/900-fix-x' 且 ambiguous === false。
  const FORGED_CASES = [
    [
      'R4-1 `( : )#` 后的注释未被识别 → 注释内的 `;` 冒充命令位',
      '( : )# ; mv specs/900-fix-x specs/renamed-nonstandard',
      // 真实 shell 语义：`)` 是元字符，`#` 紧跟其后仍处于词首，整行 `# ...` 是注释，
      // 注释内的 `;` 不是命令分隔符，mv 从不执行。旧 isWordStart 字符类漏了 `)`，
      // 于是 `#` 被当普通字符、其后的 `;` 开启命令位，伪造 mv 被采信。
    ],
    [
      'R4-2 `>|` 强制覆盖重定向中的 `|` 被误当管道控制符',
      'echo hi >|mv specs/900-fix-x specs/renamed-nonstandard',
      // 真实 shell 语义：`>|` 是"忽略 noclobber 强制覆盖"的单个重定向操作符，
      // 其后的 `mv` 是**重定向目标文件名**，不是命令；只会创建一个名为 mv 的文件。
      // 旧实现只识别 `>&`/`&>`，`|` 落到通用控制操作符分支上开启了命令位。
    ],
    [
      'R4-3a 未闭合双引号 → bash 语法错误，命令根本不执行',
      'mv specs/900-fix-x specs/renamed-nonstandard"',
      // 真实 shell 语义：未闭合引号是 "unexpected EOF while looking for matching quote"，
      // 整条命令不会被执行，其中的 mv 文本不构成任何一次真实改名，不得采信。
    ],
    [
      'R4-3b 未闭合单引号 → 同上',
      "mv specs/900-fix-x specs/renamed-nonstandard'",
    ],
    [
      'R4-4 超长参数藏第三操作数：截断解析会让「多操作数整条跳过」失效',
      `mv specs/900-fix-x specs/renamed-nonstandard${' '.repeat(PARAM_MAX_LENGTH)}specs/dest-dir`,
      // 真实 shell 语义：连续空白只是分隔符，bash 收到的是 argc=3 的 `mv SRC DST DEST_DIR`，
      // 语义为"把前两者移入目录 DEST_DIR"，并非一次 SRC→DST 改名。
      // 保守化合同要求多操作数形态整条跳过；若参数先被截断到上界再解析，第三操作数被抹掉，
      // 形态退化成看似合法的二操作数改名 —— 长度上限成了绕过保守化合同的通道。
    ],
  ];

  for (const [label, command] of FORGED_CASES) {
    it(`${label} → 候选保持原状、不进入降级通道`, () => {
      const cand = resolveWithCandidate(command);
      assert.equal(cand.path, 'specs/900-fix-x', `command=${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `command=${JSON.stringify(command)}`);
    });
  }

  // ── 正向对照：防止上述收紧误伤合法形态 ──

  it('P1 未闭合引号守卫不误伤正常命令：引号配平的普通 mv 仍抽出 1 条事件', () => {
    assert.deepEqual(scanRenameCommandEvents('mv specs/900-fix-x specs/901-fix-y'), [
      { offset: 0, paramText: ' specs/900-fix-x specs/901-fix-y' },
    ]);
    const cand = resolveWithCandidate('mv specs/900-fix-x specs/901-fix-y');
    assert.equal(cand.path, 'specs/901-fix-y');
    assert.equal(cand.ambiguous, false);
  });

  // F231 第 5 轮：长度上界 RENAME_PARAM_MAX_LENGTH 随参数收集状态机一并删除。
  // R4-4 攻击（超长空白藏第三操作数）现由**锚定形态**关闭——形态只容纳恰好两个 <PATH> 操作数，
  // 第三个操作数使整条命令不匹配（见上方 R4-4 用例仍绿），不再依赖长度上限。
  // 故「大量尾随空白的两操作数改名」现在照常跟随（它在 bash 里就是一条合法光杆改名）。
  it('P2 超长尾随空白的两操作数改名 → 照常跟随（长度上界已删，锚定形态自身保证操作数个数）', () => {
    const param = ` specs/900-fix-x specs/901-fix-y${' '.repeat(PARAM_MAX_LENGTH)}`;
    const events = scanRenameCommandEvents(`mv${param}`);
    assert.equal(events.length, 1);
    // 第 6 轮起首尾空白在匹配前被剥离，故 paramText 不含尾随空白（parseRenameOperands 按空白分词，语义等价）
    assert.equal(events[0].paramText, ' specs/900-fix-x specs/901-fix-y');
    assert.deepEqual(parseRenameOperands(events[0].paramText), ['specs/900-fix-x', 'specs/901-fix-y']);
    const cand = resolveWithCandidate(`mv${param}`);
    assert.equal(cand.path, 'specs/901-fix-y');
    assert.equal(cand.ambiguous, false);
  });

  it('P2b 超长空白后藏第三操作数 → 仍零事件（锚定形态只容纳两个操作数）', () => {
    const cmd = `mv specs/900-fix-x specs/901-fix-y${' '.repeat(PARAM_MAX_LENGTH + 1)}specs/dest-dir`;
    assert.deepEqual(scanRenameCommandEvents(cmd), []);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F231 · 简单命令白名单闸门：只有整条命令是「简单改名序列」子语言成员才跟随改名
// ────────────────────────────────────────────────────────────────────────────

describe('F231 白名单闸门：藏在非简单命令（控制流/替换/前缀/heredoc 正文）里的伪造 mv 一律不跟随', () => {
  const S = 'specs/900-fix-x';
  const D = 'specs/renamed-nonstandard';
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWith = (command) => resolveFeatureDirCandidate([
    user('x'),
    write(`${S}/fix-report.md`, 1),
    bash(command, 2),
  ], 0);

  // A. 11 类 Codex 反例（对抗审查针对被否决的黑名单初稿构造；白名单结构性关闭）。
  //   注：其中 C-ST1 / C-D1 / C-D2a / C-D2b 在 HEAD（F230）上因「保留字先占掉命令位」已返回 []，
  //   属 pre-closed（本组作为永久 characterization 护栏保留，白名单以更本质的方式再关闭一次）；
  //   其余 7 条在 HEAD 上是活体绕过（events 非空 → ambiguous → fail-open）。
  const A_CASES = [
    ['C-S1 短路续行 ||', `true ||\nmv ${S} ${D}`],
    ['C-S2 |& + 短路 ||', `true || false |& mv ${S} ${D}`],
    ['C-S3 exit 前置终止内建', `exit 0; mv ${S} ${D}`],
    ['C-S4 heredoc 正文', `cat <<EOF\nmv ${S} ${D}\nEOF`],
    ['C-ST1 case done) 伪模式（HEAD 已 pre-closed）', `case x in done) mv ${S} ${D} ;; esac`],
    ['C-ST2 函数体 {}（参数位 }）', `f() { echo }\nmv ${S} ${D}\n}`],
    ['C-ST3 heredoc 伪 fi + 死 if', `if false; then cat <<EOF\nfi\nEOF\nmv ${S} ${D}\nfi`],
    ['C-ST4a 游离 closer )', `) ; mv ${S} ${D}`],
    ['C-ST4b 未闭合关键字 if', `mv ${S} ${D}; if`],
    ['C-D1 time 前缀（HEAD 已 pre-closed）', `time if false; then mv ${S} ${D}; fi`],
    ['C-D2a for(( 算术（HEAD 已 pre-closed）', `for((i=0;i<0;i++)); do mv ${S} ${D}; done`],
    ['C-D2b if</dev/null 边界（HEAD 已 pre-closed）', `if</dev/null false; then mv ${S} ${D}; fi`],
    ['C-D3 alias 展开（shopt/alias 命令位）', `shopt -s expand_aliases; alias g="if false; then"; g :; mv ${S} ${D}; fi`],
  ];

  for (const [label, command] of A_CASES) {
    it(`A ${label} → scanRenameCommandEvents=[] 且候选停在 ${S} 不 ambiguous`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `事件应为空：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选被伪造 mv 带走：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `伪造 mv 打开降级通道：${JSON.stringify(command)}`);
    });
  }

  // B. 6 类原始构造（fix-report 问题描述表；HEAD 上逐条 fail-open，本次全部关闭）。
  const B_CASES = [
    ['B1 短路 RHS true || mv', `true || mv ${S} ${D}`],
    ['B2 函数定义体（从未调用）', `f() {\nmv ${S} ${D}\n}; :`],
    ['B3 死 if 分支', `if false; then\nmv ${S} ${D}\nfi`],
    ['B4 未命中 case 分支', `case x in y)\nmv ${S} ${D}\n;; esac`],
    ['B5 命令替换内 : $(false && mv)', `: $(false && mv ${S} ${D})`],
    ['B6 零迭代循环体', `while false; do\nmv ${S} ${D}\ndone`],
  ];

  for (const [label, command] of B_CASES) {
    it(`B ${label} → scanRenameCommandEvents=[] 且候选停在 ${S} 不 ambiguous`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `事件应为空：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选被伪造 mv 带走：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `伪造 mv 打开降级通道：${JSON.stringify(command)}`);
    });
  }

  // V. `$'…'`（ANSI-C quoting）/ `$"…"`（locale 翻译）——F231 第 2 轮 CRITICAL。
  // 本状态机的引号语义是 POSIX `'…'`（单引号内无转义），而 bash 在 `$'…'` 内把 `\'` 当转义的字面引号、
  // 字符串继续。两套模型分歧使「bash 视角未闭合」的命令在扫描器看来引号已配平，绕过 F230 R4-3
  // 「未闭合引号 → 不采信」保护（同族保护面）。修法按白名单精神 fail-closed：`$'` / `$"` 一律拒绝，
  // 刻意不实现 ANSI-C 转义语义（避免与既有状态机漂移的第二套词法）。
  // 三条构造均经真实 GNU Bash 5.3.9 byte-exact 文件实测 + mv shim 双证：mv 从不执行（mv_ran=NO）。
  const V_CASES = [
    // bash -n 报 SYNTAX ERROR「寻找匹配的 `'` 时遇到了未预期的 EOF」→ 整条命令根本不执行。
    // 修复前：simple=true / events=1 / {path:null, ambiguous:true} —— fail-open 降级通道被重开。
    ['V2 $\'…\' 转义引号凑配平（bash 语法错误）', `echo $'a\\'; mv ${S} ${D}\\'b''`],
    // bash 语法 OK，但 mv 文本整体位于 ANSI-C 字符串内、从不执行。
    // 修复前恰好因末尾引号不配平而 simple=false（安全但属**偶然**）；现由判据本身保证。
    ['V1 $\'…\' 内藏 mv（bash 语法 OK 但 mv 不执行）', `echo $'a\\'; mv ${S} ${D}'`],
    // locale-translation quoting 同族：同样无法用 POSIX 引号模型可靠建模。
    ['V3 $"…" locale quoting', `echo $"a\\"; mv ${S} ${D}\\"b""`],
  ];

  for (const [label, command] of V_CASES) {
    it(`V ${label} → scanRenameCommandEvents=[] 且候选停在 ${S} 不 ambiguous`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `事件应为空：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选被伪造 mv 带走：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `伪造 mv 打开降级通道：${JSON.stringify(command)}`);
    });
  }

  // F231 第 5 轮：`mv A B # 注释` 与 `mv $OLD $NEW` 均非光杆形态（含 `#` / `$`，不在 <PATH> 字符集内）
  // → 改为不跟随。原第 2 轮这两条是「$' 判据不得吃掉注释豁免 / 裸 $VAR 仍是白名单成员」的正向护栏，
  // 在字面白名单下其护栏职责由「整条命令必须就是光杆 mv」直接承担，故翻转为反向断言。
  // 安全性：方向为误阻断（候选停在提名目录、不 ambiguous、不放行），缓解=改名单独写一条 `git mv`。
  it('V 第 5 轮翻转：`mv A B # 注释` 非光杆形态 → 不跟随', () => {
    const command = `mv ${S} specs/901-fix-y # $'x'`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    const cand = resolveWith(command);
    assert.equal(cand.path, S);
    assert.equal(cand.ambiguous, false);
  });

  it('V 第 5 轮翻转：`mv $OLD $NEW` 变量路径不在 <PATH> 字符集内 → 不跟随', () => {
    assert.deepEqual(scanRenameCommandEvents('mv $OLD $NEW'), []);
  });

  // W. heredoc **终止行**（定界词行）——F231 第 3 轮 CRITICAL。
  // 引号定界词的值可含空格，而终止行必须逐字等于定界词值，于是被保留的终止行与一条真实的
  // `mv <候选> <非规范名>` 命令**文本完全同形**：扫描器在其上扫出顶层改名事件、
  // parseRenameOperands 正常解析出 src=候选/dst=非规范名 → 重开 fail-open 降级通道。
  // 真实 bash 中终止行是 heredoc 语法构件、永不作为命令执行——四条构造均经 byte-exact 文件
  // + mv shim 实测：`bash -n` SYNTAX OK 且 **mv_ran=NO**。
  // 修法：终止行连同正文一并等长空白化（终止行任何情况下都不是可执行命令，空白化只消除误判）。
  const W_CASES = [
    ['W1 单引号定界词含空格（终止行同形于真实 mv）', `cat <<'mv ${S} ${D}'\nbody\nmv ${S} ${D}\n`],
    ['W2 双引号定界词同构', `cat <<"mv ${S} ${D}"\nbody\nmv ${S} ${D}\n`],
    ['W3 `<<-` + tab 缩进终止行', `cat <<-'mv ${S} ${D}'\nbody\n\tmv ${S} ${D}\n`],
    ['W4 终止行位于命令文本末尾（无尾随换行）', `cat <<'mv ${S} ${D}'\nbody\nmv ${S} ${D}`],
    ['W5 同行多 heredoc，各自终止行', `cat <<'mv ${S} ${D}' <<'EOF2'\nb\nmv ${S} ${D}\nx\nEOF2\n`],
  ];

  for (const [label, command] of W_CASES) {
    it(`W ${label} → scanRenameCommandEvents=[] 且候选停在 ${S} 不 ambiguous`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `事件应为空：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选被终止行伪造 mv 带走：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `终止行伪造 mv 打开降级通道：${JSON.stringify(command)}`);
    });
  }

  // F231 第 5 轮：原「终止行空白化的等长/换行不变量」直测 `blankHeredocBodies`，该 helper 已随
  // heredoc 建模整体删除（字面白名单不需要剥离 heredoc——含 heredoc 的命令必然不是光杆 mv）。
  // 等长不变量随之失去意义；其护栏职责（终止行不得被当命令）由上方 W1-W5 反向断言直接承担。
});

describe('F231 第 5 轮：多命令 / heredoc / 重定向形态一律不跟随（原第 4 轮 herestring 与注释感知用例翻转）', () => {
  const S = 'specs/900-fix-x';
  const Y = 'specs/901-fix-y';
  const D = 'specs/renamed-nonstandard';
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWith = (command) => resolveFeatureDirCandidate([
    user('x'), write(`${S}/fix-report.md`, 1), bash(command, 2),
  ], 0);

  // F231 第 5 轮：本组原是第 4 轮「herestring/注释感知修复让**真实执行**的 mv 恢复跟随」的正向用例
  // （逐条经真实 bash 实测 mv_ran=YES）。字面白名单下它们全部**不再跟随**——整条命令不是光杆 mv
  // （多命令 / 含 heredoc / 含重定向 / 含 `#`）。这是刻意的架构取舍：判据不再建模 heredoc、注释、
  // 重定向与 herestring，从而不必再追 BUG-1/BUG-2 这类「幽灵 pending」缺陷，也就没有下一个缺口。
  // 安全性：方向为**误阻断**（候选停在提名目录、`ambiguous=false`、绝不放行），
  // 缓解=把改名单独写成一条 `git mv specs/old specs/new`（不与其他命令同处一次 Bash 调用）。
  const NOT_FOLLOWED_CASES = [
    ['X1 herestring `<<< hi` 换行 mv（真实执行但非光杆）', `cat <<< hi\nmv ${S} ${Y}`],
    ['X2 注释行 `# <<EOF` 换行 mv（真实执行但非光杆）', `echo hi # <<EOF\nmv ${S} ${Y}`],
    ['X3 herestring 无空格 `<<<hi` 换行 mv', `cat <<<hi\nmv ${S} ${Y}`],
    ['X4 heredoc 引入行带尾注释 + 正文后 mv', `cat <<EOF # note\nbody\nEOF\nmv ${S} ${Y}`],
    ['X5 引号内 `#` + 换行 mv', `echo "# <<EOF"\nmv ${S} ${Y}`],
    ['X6 herestring 与 heredoc 混用 + 正文外 mv', `cat <<< hi\ncat <<EOF\nbody\nEOF\nmv ${S} ${Y}`],
    ['Y 正向翻转 `>>` 追加 + 换行 mv', `echo hi >> log\nmv ${S} ${Y}`],
    ['Y 正向翻转 `<>` 读写 + 换行 mv', `cat <> f\nmv ${S} ${Y}`],
    ['Y 正向翻转 `2>&1` + 换行 mv', `echo hi 2>&1\nmv ${S} ${Y}`],
    ['Y 正向翻转 `>|` 强制覆盖 + 换行 mv', `echo hi >| f\nmv ${S} ${Y}`],
    ['`mv A B <<< x`（mv 自带 herestring，非光杆）', `mv ${S} ${Y} <<< x`],
  ];

  for (const [label, command] of NOT_FOLLOWED_CASES) {
    it(`${label} → 零事件、候选停在 ${S}（第 5 轮翻转：整条命令须为光杆改名）`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选不应移动：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `不得进入降级通道：${JSON.stringify(command)}`);
    });
  }

  // 反向护栏（第 4 轮既有，全部继续通过）：伪造 mv 藏在注释 / heredoc 正文 / bash 语法错误命令里。
  const FORGED_CASES = [
    ['heredoc 引入行带尾注释，正文藏伪 mv', `cat <<EOF # note\nmv ${S} ${D}\nEOF`],
    ['注释内藏伪 mv', `echo hi # mv ${S} ${D}`],
    ['`a#b` 词中 `#` + heredoc 正文藏伪 mv', `echo a#b <<EOF\nmv ${S} ${D}\nEOF`],
    ['`<<<<` bash 语法错误（mv_ran=NO）', `cat <<<< x\nmv ${S} ${D}`],
    ['`>>>` bash 语法错误（mv_ran=NO）', `cat >>> x\nmv ${S} ${D}`],
    ['`><` bash 语法错误（mv_ran=NO）', `cat >< x\nmv ${S} ${D}`],
  ];

  for (const [label, command] of FORGED_CASES) {
    it(`反向护栏 ${label} → 零事件、不进入降级通道`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `伪造 mv 被采信：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `伪造 mv 打开降级通道：${JSON.stringify(command)}`);
    });
  }
});

describe('F231 第 5 轮：光杆改名照常跟随 / 多命令形态不再跟随（唯一判据的正反两面）', () => {
  const S = 'specs/900-fix-x';
  const Y = 'specs/901-fix-y';
  const Z = 'specs/902-fix-z';
  const D = 'specs/renamed-nonstandard';
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  const resolveWith = (command) => resolveFeatureDirCandidate([
    user('x'), write(`${S}/fix-report.md`, 1), bash(command, 2),
  ], 0);

  // 正向：光杆形态（唯一被采信的形态）必须照常跟随，否则每次合法收口都被误阻断。
  const FOLLOW_CASES = [
    ['mv 光杆', `mv ${S} ${Y}`],
    ['git mv 光杆', `git mv ${S} ${Y}`],
    ['mv -f 单 flag（保 C3）', `mv -f ${S} ${Y}`],
    ['git mv -f（保 F224）', `git mv -f ${S} ${Y}`],
    ['mv -f -v 多 flag', `mv -f -v ${S} ${Y}`],
    ['mv -fv 合并短 flag', `mv -fv ${S} ${Y}`],
    // F231 第 10 轮 C4：长选项是 GNU coreutils 专有，裸 mv 在 Darwin 上是 illegal option
    // → 移出正向组（见下方反向用例）；git mv 支持长选项，改列为 git 的正向。
    ['git mv --force 长 flag', `git mv --force ${S} ${Y}`],
    ['git mv --verbose 长 flag', `git mv --verbose ${S} ${Y}`],
    ['mv -fv 捆绑短 flag', `mv -fv ${S} ${Y}`],
    ['mv -vf 捆绑短 flag', `mv -vf ${S} ${Y}`],
    ['git mv -f -v', `git mv -f -v ${S} ${Y}`],
    ['前导空格', `   mv ${S} ${Y}`],
    ['尾随空格', `mv ${S} ${Y}   `],
    ['tab 分隔', `mv\t${S}\t${Y}`],
    // F231 第 10 轮 C1：仅**源**尾随 `/` 是真实的 SRC→DST 改名（dst 尾随 `/` 见反向用例）
    ['仅源尾随斜杠', `mv ${S}/ ${Y}`],
    // F231 第 6 轮：首尾空白（空格 / tab / LF）不改变 bash 语义，剥离后仍是同一条光杆改名。
    // 注意 **CRLF 不在此列**——CR 不是 bash 分隔符，已于第 9 轮翻为反向用例（见 CR_CASES）。
    // 真实 transcript 的 Bash `command` 常带尾随换行，不修会白送一次误阻断。
    ['尾随换行（第 6 轮）', `mv ${S} ${Y}\n`],
    ['前导换行（第 6 轮）', `\nmv ${S} ${Y}`],
    ['首尾混合空白 + 换行（第 6 轮）', `\n  mv ${S} ${Y} \t\n`],
    ['git mv 尾随换行（第 6 轮）', `git mv ${S} ${Y}\n`],
  ];

  for (const [label, command] of FOLLOW_CASES) {
    it(`正向 ${label} → 跟随到 ${Y}`, () => {
      assert.equal(scanRenameCommandEvents(command).length, 1, `应恰好一条事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, Y, `未跟随：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `误降级：${JSON.stringify(command)}`);
    });
  }

  // F231 第 5 轮翻转：以下形态在真实 bash 中改名**确实发生**，但整条命令不是光杆 mv，故不再跟随。
  // 逐条理由同一条：判据收敛为「整条命令必须就是一条光杆改名」，不再建模分隔符 / heredoc / 注释
  // ——正是这类建模在前四轮被 Codex 逐轮击穿（控制流 / exit / alias / ANSI-C / 赋值前缀 / 语法错误…）。
  // 安全性：方向为**误阻断**（候选停在提名目录、`ambiguous=false`、绝不放行），
  // 缓解=把改名单独写成一条 `git mv specs/old specs/new`。
  const FLIPPED_MULTI_COMMAND_CASES = [
    ['C6 `;` 分号链两跳（旧期望 902-fix-z）', `mv ${S} ${Y}; mv ${Y} ${Z}`],
    ['C6b `|` 裸管道两跳（旧期望 902-fix-z）', `mv ${S} ${Y} | mv ${Y} ${Z}`],
    ['C6c `&` 后台符两跳（旧期望 902-fix-z）', `mv ${S} ${Y} & mv ${Y} ${Z}`],
    ['`|&` 原子管道两跳（旧期望 902-fix-z）', `mv ${S} ${Y} |& mv ${Y} ${Z}`],
    ['`mv A B # 注释`（旧期望 901-fix-y）', `mv ${S} ${Y} # 迁移`],
    ['C4 `cd . && mv`（第 1 轮已翻，仍不跟随）', `cd . && mv ${S} ${Y}`],
    // 第 6 轮：首尾空白放宽后，**命令内部**换行仍一律拒绝（不变量未被削弱）
    ['内部换行两条 mv（第 6 轮反向）', `mv ${S} ${Y}\nmv ${Y} ${Z}`],
    ['内部换行 mv + rm（第 6 轮反向）', `mv ${S} ${Y}\nrm -rf x`],
    ['内部换行 mv + 注释行（第 6 轮反向）', `mv ${S} ${Y}\n# note`],
    ['3 操作数（移入目录语义）', `mv ${S} ${Y} extra`],
    ['单操作数', `mv ${S}`],
  ];

  for (const [label, command] of FLIPPED_MULTI_COMMAND_CASES) {
    it(`翻转/反向 ${label} → 零事件、候选停在 ${S}`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选不应移动：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `不得进入降级通道：${JSON.stringify(command)}`);
    });
  }

  it('C5 翻转：`cat > 制品 <<EOF … EOF` 换行 mv → 不再跟随，候选停在提名目录', () => {
    // 旧期望 specs/901-fix-y（heredoc 后顶层 mv）。含 heredoc 与两条命令 → 非光杆 → 零事件。
    // 提名侧不受影响：`cat > specs/900-fix-x/fix-report.md` 仍提名 specs/900-fix-x（scanArtifactPath 逐字未改）。
    const command = `cat > ${S}/fix-report.md <<EOF\nbody\nEOF\nmv ${S} ${Y}`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    const cand = resolveFeatureDirCandidate([user('x'), bash(command, 1)], 0);
    assert.equal(cand.path, S, '提名仍成立，仅改名不跟随');
    assert.equal(cand.ambiguous, false);
  });

  // F231 第 6 轮：offset 必须指向**原始**命令文本中命令名的真实下标（resolveFeatureDirCandidate
  // 按 offset 归段，偏移错位会破坏 F230 R3-C4 的「段内先提名、再改名」时序语义）。
  it('第 6 轮 offset：剥离前导空白后 offset 补回原文下标（`\\n   mv S Y` → 4）', () => {
    const command = `\n   mv ${S} ${Y}`;
    const events = scanRenameCommandEvents(command);
    assert.equal(events.length, 1);
    assert.equal(events[0].offset, 4, `offset 应为原文中 mv 的下标 4，实际 ${events[0].offset}`);
    assert.equal(command.slice(events[0].offset, events[0].offset + 2), 'mv', 'offset 处应恰为 mv');
    const cand = resolveWith(command);
    assert.equal(cand.path, Y, '归段后仍正确跟随');
    assert.equal(cand.ambiguous, false);
  });

  it('第 6 轮 offset：`git mv` 形态 offset 指向 `git` 起始处', () => {
    const command = `  git mv ${S} ${Y}\n`;
    const events = scanRenameCommandEvents(command);
    assert.equal(events.length, 1);
    assert.equal(events[0].offset, 2);
    assert.equal(command.slice(events[0].offset, events[0].offset + 6), 'git mv');
  });

  it('第 6 轮：真实改名到非规范名（带尾随换行）仍触发 F224 降级设计意图', () => {
    const cand = resolveWith(`git mv ${S} specs/renamed-nonstandard\n`);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });

  // ── F231 第 7 轮 CRITICAL：Unicode 空白 ≠ bash token 分隔符 ──
  //
  // 第 6 轮用 `raw.trim()` 剥首尾空白，但 JS `trim()` 剥的是**全部 Unicode 空白**，而 bash 只把
  // 空格 / tab / LF 当 token 分隔符（**CR 不是**，见第 9 轮）。于是「bash 判 command not found、mv 根本不执行」的命令
  // 被归一成一条合法光杆 mv → 候选被带到非规范名 → 重开 F224 fail-open（修复前 6 条全部
  // `{path:null, ambiguous:true}`，且 offset=0 却不指向 `mv`，归段语义同时被破坏）。
  // 修法：剥离与前导计数共用同一个 SHELL_WHITESPACE_CLASS 派生的正则，字符集由构造保证一致。
  // 教训（本 Feature 第 4 次同型缺陷）：判定器凡做「归一化 / 剥离 / 豁免」的字符集必须对齐 bash
  // 语义，不得用 JS 内建 Unicode 语义（`trim()` / `\s` / `\b`）近似 shell 语义。
  //
  // 6 个字符逐条经 GNU bash 5.3.9 + PATH `mv` shim 实测。
  const UNICODE_WHITESPACE = [
    ['VT 垂直制表 U+000B', ''],
    ['FF 换页 U+000C', ''],
    ['NBSP 不换行空格 U+00A0', ' '],
    ['LS 行分隔符 U+2028', ' '],
    ['BOM U+FEFF', '﻿'],
    ['IDEOGRAPHIC SPACE U+3000', '　'],
  ];

  // 前导：真实 bash 报 `$'<char>mv': 未找到命令`，**mv 不执行**（实测 mv_ran=NO）
  for (const [label, ch] of UNICODE_WHITESPACE) {
    it(`第 7 轮 前导 ${label} → 零事件（真实 bash：未找到命令、mv 不执行）`, () => {
      const command = `${ch}mv ${S} ${D}`;
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S, `候选被伪造 mv 带走：${JSON.stringify(command)}`);
      assert.equal(cand.ambiguous, false, `打开降级通道：${JSON.stringify(command)}`);
    });
  }

  // 尾随：真实 bash 里 mv **确实执行**（mv_ran=YES），但 dst 实测为 `specs/renamed-nonstandard<char>`
  // ——与剥离后解析出的 dst **不是同一个目录**。按错误的 dst 跟随等于记录了一个从未存在的路径，
  // 故一律不跟随（fail-closed，方向为误阻断）。
  for (const [label, ch] of UNICODE_WHITESPACE) {
    it(`第 7 轮 尾随 ${label} → 零事件（真实 bash 的 dst 带该字符，与解析结果不同）`, () => {
      const command = `mv ${S} ${D}${ch}`;
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S);
      assert.equal(cand.ambiguous, false);
    });
  }

  // `\s` / `trim()` 反例护栏：VT 同时是「JS 认为是空白、bash 不认」的最短例证。
  // 若将来有人把剥离改回 `trim()` 或把字符类写成 `\s`，本条与上面 12 条会立刻变红。
  // ── F231 第 9 轮 CRITICAL-1：CR 不是 bash 的 token 分隔符 ──
  // 第 7 轮把 `\r` 写进了剥离字符集，两个方向都错（均经 GNU bash 5.3.9 实测）：
  // - 前导 `\rmv A B` → bash 报 `$'\rmv': 未找到命令`，**mv 不执行**，却被剥成合法光杆 mv → fail-open；
  // - 尾随 `mv A B\r\n` → bash **确实执行**，但创建的目录名带 CR（`ls | cat -v` 显示 `901-fix-y^M`），
  //   剥掉 CR 会把候选记录成**并不存在**的 `901-fix-y`。
  // 修法：字符集去掉 `\r`；CR 既不参与剥离、也不在操作数字符集内 → 含 CR 的命令一律零事件。
  const CR_CASES = [
    ['前导 CR（bash：未找到命令）', `\rmv ${S} ${D}`],
    ['前导 空格+tab+CR', ` \t\rmv ${S} ${D}`],
    ['尾随 CRLF（bash 建的是带 CR 的目录名）', `mv ${S} ${Y}\r\n`],
    ['尾随裸 CR', `mv ${S} ${Y}\r`],
    ['操作数间 CR', `mv ${S}\r${Y}`],
  ];
  for (const [label, command] of CR_CASES) {
    it(`第 9 轮 CR ${label} → 零事件`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S);
      assert.equal(cand.ambiguous, false);
    });
  }

  // ── F231 第 9 轮 CRITICAL-2：严格 option 白名单 ──
  // `-[A-Za-z-]+` 放行一切 option，把「明确不改名」的命令当成真实改名（均实测）：
  // - `git mv -n` / `git mv --dry-run`：git 只打印「检查 …」，目录**未变**；
  //   注意 `-n` 对 mv 与 git mv 语义**不同**（coreutils=no-clobber，git=dry-run），
  //   说明 option 语义是命令相关的，不能按「看起来像 flag」放行；
  // - `mv -n`（coreutils）：结果**依赖 dst 是否已存在**（实测 dst 不存在时 rc=0 真改名，
  //   dst 存在时静默跳过不改名）——判定器无法知道磁盘状态，故一律拒绝；
  // - `mv --definitely-invalid` / `mv -vt` / `mv -tfoo`：实测 rc=64 `illegal option`、**无改名**，
  //   且后两者能骗过 parseRenameOperands「整 token 等于 -t/-S 才拒绝」的判据（捆绑与附参形态）。
  const REJECTED_OPTION_CASES = [
    ['git mv -n（git=dry-run，实测目录未变）', `git mv -n ${S} ${Y}`],
    ['git mv --dry-run', `git mv --dry-run ${S} ${Y}`],
    ['mv -n（coreutils no-clobber，结果依赖磁盘状态）', `mv -n ${S} ${Y}`],
    ['mv --definitely-invalid（rc=64 无改名）', `mv --definitely-invalid ${S} ${Y}`],
    ['mv -vt（illegal option，捆绑带参）', `mv -vt ${S} ${Y}`],
    ['mv -tfoo（illegal option，附参形态）', `mv -tfoo ${S} ${Y}`],
    ['mv --no-clobber（第 8 轮正向，本轮翻转）', `mv --no-clobber ${S} ${Y}`],
    ['mv --（第 8 轮正向，本轮翻转）', `mv -- ${S} ${Y}`],
    ['mv --target-directory=X（=value 形态）', `mv --target-directory=${Y} ${S} ${Y}`],
  ];
  for (const [label, command] of REJECTED_OPTION_CASES) {
    it(`第 9 轮 option ${label} → 零事件`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S);
      assert.equal(cand.ambiguous, false);
    });
  }

  // ── F231 第 9 轮 CRITICAL-3：非规范 path segment（规范化后可能与源同路径 = 实际没改名）──
  // 实测 `mv specs/230-fix-x specs/./230-fix-x` → rc=1 `Invalid argument`、目录未变，
  // 但判定器会解析出 dst=`specs/./230-fix-x`（不符合 NNN-fix-<name>）→ ambiguous → fail-open。
  const NONCANONICAL_PATH_CASES = [
    ['dst 含 `./`（实测 rc=1 Invalid argument）', 'mv specs/230-fix-x specs/./230-fix-x'],
    ['dst 含 `//`', `mv ${S} specs//901-fix-y`],
    ['dst 含 `../`', `mv ${S} specs/../specs/901-fix-y`],
    ['src 含 `./`', `mv specs/./900-fix-x ${Y}`],
    ['绝对路径 dst', `mv ${S} /tmp/901-fix-y`],
    ['操作数只是 `/`', `mv ${S} /`],
  ];
  for (const [label, command] of NONCANONICAL_PATH_CASES) {
    it(`第 9 轮 path ${label} → 零事件`, () => {
      assert.deepEqual(scanRenameCommandEvents(command), [], `应零事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, S);
      assert.equal(cand.ambiguous, false);
    });
  }

  // ── F231 第 8 轮：性能回归锚点（禁止超线性）──
  // 本判定器跑在**同步 Stop hook** 上：会话只需发一条含大段空白的 Bash 命令即可让门禁挂住数十秒
  // → 门禁不可用 / 宿主超时 → 可能异常 fail-open（与 F227 候选历史 O(N²) 同类 DoS 面）。
  // 第 8 轮前的锚定正则 `(?:[ \t]+-OPT)*[ \t]+…` 相邻空白量词歧义切分 → O(n²)：
  // 10k=43ms / 20k=164ms / 40k=622ms / 80k=2.6s / 400k=**61s**，且「可匹配」形态同样慢（200k=15s）。
  // token 化后每步都是锚定常数级判定或单趟扫描，实测三条均 < 1ms。
  // **不得删除本组断言**——它是防回溯回归的唯一锚点。
  //
  // ── 预算按量级分档（F231 第 13 轮，依据 F233 链 H）──
  // 这些锚点的目的是**捕获灾难性回溯 / 超线性回归**，不是微观性能门禁：历史事故是
  // 400KB 空白耗时 **65 秒（65000ms）**，任何一档预算相对它都有数十倍判别力。
  // F233 链 H 的教训是「墙钟 perf 断言在满载 CI runner 上不成立」——CI 是 4 vCPU 跑 487 个文件，
  // 本地"更快"的路径在满载下可能被压慢数倍。故按各用例的实测余量分档，避免 CI 假红：
  // - scanner-only 三条：本机 0.1–0.2ms，对 500ms 有 2500–4500× 余量 → 维持 500ms，足够稳。
  // - 完整 resolver 一条：本机 55–71ms，对 500ms 仅 ~7× 余量，满载放大即越界 → 单独放宽到 3000ms
  //   （相对 65 秒事故仍有 20× 判别力，回溯复发时照样立刻变红）。
  const PERF_BUDGET_MS = 500;
  const RESOLVER_PERF_BUDGET_MS = 3000;
  const measure = (command) => {
    const started = process.hrtime.bigint();
    const events = scanRenameCommandEvents(command);
    return { events, ms: Number(process.hrtime.bigint() - started) / 1e6 };
  };

  it('第 8 轮 perf：`mv` + 40 万空白 + `x`（不匹配路径）→ 零事件且有界', () => {
    const { events, ms } = measure(`mv${' '.repeat(400000)}x`);
    assert.deepEqual(events, []);
    assert.ok(ms < PERF_BUDGET_MS, `疑似回溯回归：耗时 ${ms.toFixed(1)}ms（预算 ${PERF_BUDGET_MS}ms）`);
  });

  it('第 8 轮 perf：`mv` + 20 万 tab + `x` → 零事件且有界', () => {
    const { events, ms } = measure(`mv${'\t'.repeat(200000)}x`);
    assert.deepEqual(events, []);
    assert.ok(ms < PERF_BUDGET_MS, `疑似回溯回归：耗时 ${ms.toFixed(1)}ms（预算 ${PERF_BUDGET_MS}ms）`);
  });

  it('第 8 轮 perf：`mv` + 20 万空白 + 两操作数（**可匹配**路径）→ 1 条事件且有界', () => {
    const { events, ms } = measure(`mv${' '.repeat(200000)}specs/a specs/b`);
    assert.equal(events.length, 1, '可匹配形态必须照常产出事件');
    assert.ok(ms < PERF_BUDGET_MS, `疑似回溯回归：耗时 ${ms.toFixed(1)}ms（预算 ${PERF_BUDGET_MS}ms）`);
  });

  it('第 10 轮 perf：完整 resolver + 大量 flag token（1MiB）→ 有界', () => {
    // Codex 观察：现有 perf 锚点只覆盖 scanner；resolver 走 splitCommandTextSegmentSpans 等链路，
    // 常数偏大（实测 400KB≈13.7ms、1MiB≈33ms，线性）。本条把完整链路也钉在有界区间内。
    const command = `mv ${'-f '.repeat(350000)}${S} ${Y}`;
    const started = process.hrtime.bigint();
    const cand = resolveWith(command);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // scanner 侧确实走完整条链路并产出事件（证明 perf 测的是热路径而非早退）……
    assert.equal(scanRenameCommandEvents(command).length, 1);
    // ……但候选不动：F224 的 RENAME_MAX_OPTION_TOKENS（8）上界让 parseRenameOperands 整条跳过。
    // 两道判据叠加的既有保守化语义，与本轮无关，此处只作为「跑满链路仍有界」的锚点。
    assert.equal(cand.path, S, 'option token 超上界 → parseRenameOperands 整条跳过，候选不动');
    // 用更宽的 resolver 档预算（依据见上方分档说明：本条余量最小，满载 CI 下最易假红）
    assert.ok(
      ms < RESOLVER_PERF_BUDGET_MS,
      `疑似超线性回归：耗时 ${ms.toFixed(1)}ms（预算 ${RESOLVER_PERF_BUDGET_MS}ms）`,
    );
  });

  it('第 7 轮 护栏：`\\s` 认得但 bash 不认的空白（VT）不得被当分隔符——光杆判据对 JS Unicode 空白免疫', () => {
    assert.ok(/\s/.test(''), '前提：JS `\\s` 认为 VT 是空白');
    assert.equal('mv a b'.trim(), 'mv a b', '前提：JS trim() 会把 VT 剥成合法光杆 mv');
    // 而判据必须拒绝它（与 bash「未找到命令」一致）
    assert.deepEqual(scanRenameCommandEvents('mv a b'), []);
    assert.deepEqual(scanRenameCommandEvents('mv a b'), []);
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

    it('F229 新增边界 3：散文裸花括号未闭合且花括号内为纯 ASCII 变量名 → 仍判 true', () => {
      // 注意（F229 R2 订正）：本条**不**隔离 PLACEHOLDER_OPEN_BRACE_REGEX——`{` 之后同一行即有 CJK
      // 且无 ASCII 冒号，canonical 判据的不成对分支自己就会命中，把通用判据改回 `/\{[^}]*\}/` 本条依旧绿。
      // 真正隔离通用判据的用例见下方「F229 R2 · PLACEHOLDER_OPEN_BRACE_REGEX 隔离断言」。
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 待补充字段包括 {field_name 一直没有替换成真实字段名，后续继续补充说明文字凑够长度阈值。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });
  });

  describe('F229 R2 · PLACEHOLDER_OPEN_BRACE_REGEX 隔离断言（构造成 canonical 分支不可能命中）', () => {
    it('不成对 `{` 后紧跟 ASCII 冒号（canonical 两分支均失败）→ 仅通用判据能命中，判 true', () => {
      // 隔离原理：`{` 之后紧跟 ASCII 冒号，canonical 的成对分支缺 `}`、不成对分支的 `[^}:\n]*` 撞上
      // `:` 提前停止且停止点非行尾 —— 两分支均失败；散文与剥离后散文均远超 MIN_SECTION_BODY_CHARS，
      // 长度判据与 F228 R3-1 的 strippedChars 边界判据也都不成立。故本条唯一可能的命中源就是
      // 作用在剥离后文本上的 PLACEHOLDER_OPEN_BRACE_REGEX = /\{/。
      // 反证（F229 R2 实跑）：把生产代码的 PLACEHOLDER_OPEN_BRACE_REGEX 临时还原为 /\{[^}]*\}/
      // （canonical 保持修好的新值），本条即变红；改回 /\{/ 变绿 —— 证明本条确实隔离了该常量的收窄。
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 具体成因待补充，模板字段 {reason: 尚未替换为真实内容，此处补足足够长度的中文说明以越过最小正文阈值。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, true, JSON.stringify(r));
    });
  });

  describe('F229 R1 · canonical 判据行内锚定回归（不成对分支不得跨行吞噬）', () => {
    // 溯源：F229 首版把 canonical 收口写成 `[^}:]*(?:\}|$)` 且**未带 `/m`**——`$` 于是表示
    // 整段章节末尾而非行尾，`[^}:]*` 又能吃换行，导致未闭合的 `{` 一路吞过闭合围栏与后续段落，
    // 把"引用截断代码 + 中文说明"的合法 repair 报告误判为占位空壳，违反 F228 已确立的代码区豁免。
    // 收口后判据为两分支 alternation：成对分支逐字保留旧形态（含跨行成对），不成对分支排除 `\n` 且带 `/m`。
    it('R1-a：闭合围栏内含未闭合 `{` 的代码 + 围栏后中文散文 → residue=false（代码区豁免不被跨行吞噬破坏）', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 解析器在截断输入下提前退出，证据见下方代码片段。',
        '```js',
        'function demo() {',
        '```',
        '该函数进入分支后返回默认结果，以上代码就是完整证据，无需补充。',
      ].join('\n');
      const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
      assert.equal(r.placeholderResidue, false, JSON.stringify(r));
    });

    it('R1-b：跨行**成对** canonical 占位符（`{根本原因\\n一句话总结}`）→ residue=true（成对分支未被 `\\n` 排除削弱）', () => {
      const content = [
        '# 报告',
        '',
        '**Root Cause**: 这里留有跨行的模板占位符 {根本原因',
        '一句话总结} 之后还有一段补充说明用于越过最小正文长度阈值的门槛。',
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
        // ── F229：闭合边界放宽为 `}` 或行尾后的不成对花括号边界（plan.md §4.2） ──
        { text: '{根本原因一句话总结', shouldMatch: true }, // 无右括号：canonical 占位符不闭合仍须命中（F229 repro）
        { text: '{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果', shouldMatch: true }, // 无右括号，全角冒号非 ASCII，不触发冒号排除集
        { text: '{"claim":"症状已消除","command":"npx vitest run"', shouldMatch: false }, // 无右括号但含 ASCII 冒号：`$` 出口不绕开既有冒号排除集
        { text: '{path: null, ambiguous', shouldMatch: false }, // 无右括号 + 含 ASCII 冒号 + 无 CJK：双重排除下仍豁免
      ];
      for (const { text, shouldMatch } of canonicalPlaceholderCases) {
        it(`${shouldMatch ? '命中' : '豁免'}：\`${text}\``, () => {
          // 借道 checkArtifactSection 的真实消费路径验证（而非直接 import 内部未导出的正则）：
          // 用例包进行内 code span（反引号）——这样通用花括号判据（PLACEHOLDER_OPEN_BRACE_REGEX，扫描
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
      // F228 R3-4：以下断言为 characterization test——记录 checkArtifactSection **当前**的
      // 真实输出，不代表这是"期望的正确行为"。原为三条；其中"缺右花括号 → residue=false"这条
      // 存量绕过已由 F229 修复并移出本分组（见下方 `F229 · 不成对花括号收口反向断言`），
      // 本分组现余两条**误报**方向的存量缺口（stripCodeRegions 不做跨行 code span 配对、
      // computeFenceMask 不识别 4 空格缩进代码块）——二者是"合法制品被误判为占位"，
      // 与绕过方向相反，修复需独立评估误判/漏判权衡再另立 feature 处理，本轮不动，
      // 钉住是为了让未来任何改动都会被本测试显式感知到。
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

    describe('F229 · 不成对花括号收口反向断言（specs/229-fix-placeholder-unpaired-brace/fix-report.md 5-Why Root Cause）', () => {
      // 溯源：specs/229-fix-placeholder-unpaired-brace/fix-report.md —— 两条花括号占位判据都以字面
      // `}` 收尾，把 canonical 模板占位符的**闭合形态**误当作判据的必要组成部分；占位符的真实语义
      // 标志只是"存在未替换的模板起始标记 `{`"，闭合与否与"是否已替换为真实内容"无关，
      // 故闭合要求是纯粹多余的形态约束，构成删一个字符即可通过的逃逸面。本组钉住其已被收口。
      it('F229：缺右花括号（`{未闭合的占位文本`）→ 修复后判 residue=true（原 F228 存量绕过已收口）', async () => {
        const { NOOP_JUDGMENT_HEADING_REGEX } = await import(CORE_MODULE_URL);
        const content = [
          '# 报告', '', '## 判定依据',
          '{为何判断问题已不存在/无需代码改动的具体证据：请填写真实 commit 与复现结果',
        ].join('\n');
        const r = checkArtifactSection(content, NOOP_JUDGMENT_HEADING_REGEX);
        assert.equal(r.placeholderResidue, true, JSON.stringify(r));
      });

      it('F229 characterization：散文中提及花括号语法但手误未闭合、且后续无 ASCII 冒号 → 判 residue=true（已知设计取舍，非缺陷）', () => {
        // 已知设计取舍，非缺陷——闭合与否与其是否为占位符无关，未闭合裸花括号一律计入可疑范围，
        // 作者应改用行内 code span 包裹花括号语法提及以获得代码区豁免。
        // 未来复审时勿把本条当作回归重新"修复"（对应 plan.md §3 回归风险表第三行）。
        const content = [
          '# 报告',
          '',
          '**Root Cause**: 配置项 {database 这里漏打了一个右花括号，后续详细说明数据库连接串的各字段含义与默认值，本段落故意写得足够长以越过最小长度阈值的门槛要求。',
        ].join('\n');
        const r = checkArtifactSection(content, ROOT_CAUSE_HEADING_REGEX);
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

// ────────────────────────────────────────
// F227 · 候选历史只读旁路（candidates 字段）
// ────────────────────────────────────────

describe('F227 candidates history - basic semantics', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);

  it('多次提名后重新提名旧目录 → candidates 为 move-to-end 顺序（非首次出现顺序）', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-a/fix-report.md', 1),
      write('specs/901-fix-b/fix-report.md', 2),
      write('specs/900-fix-a/verification/verification-report.md', 3),
    ], 0);
    assert.deepEqual(cand.candidates, ['specs/901-fix-b', 'specs/900-fix-a']);
    assert.equal(cand.path, 'specs/900-fix-a');
    assert.equal(cand.ambiguous, false);
  });

  it('重复提名同一目录不产生重复条目', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-a/fix-report.md', 1),
      write('specs/900-fix-a/fix-report.md', 2),
      write('specs/900-fix-a/verification/verification-report.md', 3),
    ], 0);
    assert.deepEqual(cand.candidates, ['specs/900-fix-a']);
  });

  it('path 非 null 时恒等于 candidates 末位', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-a/fix-report.md', 1),
      write('specs/901-fix-b/fix-report.md', 2),
    ], 0);
    assert.notEqual(cand.path, null);
    assert.equal(cand.path, cand.candidates[cand.candidates.length - 1]);
  });

  it('改名到非规范名（ambiguous=true）后 candidates 仍保留此前全部合法提名历史', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-a/fix-report.md', 1),
      write('specs/901-fix-b/fix-report.md', 2),
      bash('mv specs/901-fix-b tmp/stage-a', 3),
    ], 0);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
    assert.deepEqual(cand.candidates, ['specs/900-fix-a', 'specs/901-fix-b']);
  });

  it('非规范改名目标不得进入 candidates（路径穿越向量关闭：仅合法命名分支才记入）', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-a/fix-report.md', 1),
      bash('mv specs/900-fix-a ../outside', 2),
    ], 0);
    // F231 第 9 轮：`..` 是非规范 path segment → 整条不匹配光杆改名形态 → 零事件，
    // 故改名根本不被跟随（旧期望 {path:null, ambiguous:true}）。本用例要钉的**安全性质**
    // ——「`..` 穿越片段绝不进入 candidates」——在新语义下更强：`..` 连 trackedDir 都进不去。
    // 方向变化为 ambiguous:true → false，即从 fail-open 降级通道改为交严格判据裁决（更严，安全侧）。
    assert.equal(cand.path, 'specs/900-fix-a');
    assert.equal(cand.ambiguous, false);
    assert.deepEqual(cand.candidates, ['specs/900-fix-a']);
    for (const dir of cand.candidates) {
      assert.ok(!dir.includes('..'), `candidates 不得含 .. 穿越片段：${dir}`);
    }
  });

  it('零提名 → candidates 为空数组（不是 undefined）', () => {
    const cand = resolveFeatureDirCandidate([user('x')], 0);
    assert.equal(cand.path, null);
    assert.deepEqual(cand.candidates, []);
  });

  it('改名链跟随过程中的合法中间态与终态均记入 candidates', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      write('specs/900-fix-x/fix-report.md', 1),
      bash('mv specs/900-fix-x specs/901-fix-mid', 2),
      bash('mv specs/901-fix-mid specs/902-fix-final', 3),
    ], 0);
    assert.equal(cand.path, 'specs/902-fix-final');
    assert.deepEqual(cand.candidates, ['specs/900-fix-x', 'specs/901-fix-mid', 'specs/902-fix-final']);
  });
});

// ────────────────────────────────────────
// F227 · 状态机零改动强不变量（三轮否决的直接回归锚点）
// 本组不新增变体逻辑，只把 F224 既有断言的期望值原样重跑：
// 若任何一条变红，说明 scanArtifactPath/applyRename/分段循环被意外改动 → CRITICAL。
// ────────────────────────────────────────

describe('F227 state machine invariance - F224 rename semantics unchanged', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);
  const resolveChain = (commands) => resolveFeatureDirCandidate([
    user('x'),
    write('specs/900-fix-x/fix-report.md', 1),
    ...commands.map((c, i) => bash(c, i + 2)),
  ], 0);

  it('单跳改名全部形态（git mv / 裸 mv / mv -f / git mv -f）结果与改动前逐字一致', () => {
    for (const [label, expected, fixture] of [
      ['git mv', 'specs/322-fix-new', 'resolve-rename-git-mv.jsonl'],
      ['裸 mv', 'specs/324-fix-new', 'resolve-rename-mv-plain.jsonl'],
      ['mv -f', 'specs/352-fix-new', 'resolve-rename-mv-flag.jsonl'],
      ['git mv -f', 'specs/354-fix-new', 'resolve-rename-git-mv-flag.jsonl'],
    ]) {
      const cand = resolveFromFixture(fixture);
      assert.equal(cand.path, expected, label);
      assert.equal(cand.ambiguous, false, label);
    }
  });

  it('三跳链 tmp/stage-a → tmp/stage-b → specs/902-fix-final 仍解析到最终态（core:1755 锚点）', () => {
    const cand = resolveChain([
      'mv specs/900-fix-x tmp/stage-a',
      'git mv tmp/stage-a tmp/stage-b',
      'mv -f tmp/stage-b specs/902-fix-final',
    ]);
    assert.equal(cand.path, 'specs/902-fix-final');
    assert.equal(cand.ambiguous, false);
  });

  it('两跳 合法→非规范→合法 仍取最终态', () => {
    const cand = resolveChain([
      'mv specs/900-fix-x specs/renamed-nonstandard',
      'mv specs/renamed-nonstandard specs/901-fix-x',
    ]);
    assert.equal(cand.path, 'specs/901-fix-x');
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

  it('mv 异常形态保守化跳过全部 6 种：候选保持改名前值且不降级', () => {
    const SKIP_CASES = [
      'mv specs/900-fix-x specs/other specs/dest-dir',
      'mv -t specs/900-fix-x specs/renamed-nonstandard',
      'mv --target-directory specs/900-fix-x specs/renamed-nonstandard',
      'mv -S .bak specs/900-fix-x specs/renamed-nonstandard',
      'mv "specs/900-fix-x" "some dir/renamed nonstandard"',
      'mv specs/900-fix-x',
    ];
    for (const command of SKIP_CASES) {
      const cand = resolveChain([command]);
      assert.equal(cand.path, 'specs/900-fix-x', `形态被误解析：${command}`);
      assert.equal(cand.ambiguous, false, `形态误触降级：${command}`);
    }
  });

  it('无关 mv 不改变候选（src 未精确等于当前候选）', () => {
    const cand = resolveChain(['mv specs/999-fix-other specs/998-fix-elsewhere']);
    assert.equal(cand.path, 'specs/900-fix-x');
    assert.equal(cand.ambiguous, false);
  });

  it('原地编辑准入（sed -i / perl -i）仍走同一 ARTIFACT_PATH_REGEX 判据', () => {
    for (const command of [
      "sed -i '' 's/a/b/' specs/905-fix-inline/fix-report.md",
      "perl -i -pe 's/a/b/' specs/905-fix-inline/fix-report.md",
    ]) {
      const cand = resolveFeatureDirCandidate([user('x'), bash(command, 1)], 0);
      assert.equal(cand.path, 'specs/905-fix-inline', command);
      assert.equal(cand.ambiguous, false, command);
    }
  });

  it('F225 同段共现：跨段写指示符不为后段纯读形态背书', () => {
    const cand = resolveFeatureDirCandidate([
      user('x'),
      bash('echo x > /tmp/y; cat specs/999-fix-decoy/fix-report.md', 1),
    ], 0);
    assert.equal(cand.path, null);
  });
});

// ────────────────────────────────────────
// F227 · 候选历史容器复杂度回归锚点（防止把 Map 改回数组实现）
//
// `pushCandidateHistory` 的容器必须是保序 Map（`delete` + `set` = O(1) move-to-end）。
// 若改回 `indexOf` + `splice` 的数组实现，每次提名一次线性扫描，N 个互不相同的候选累计 O(N²)。
// 实测（单条 Bash 命令内放 N 个互不相同的合法 artifact 路径，体积远低于 transcript 上限）：
//   数组版 N=20,000 → 3,034ms；N=40,000（1.26MB）→ 12,004ms；Map 版两者均为个位数 ms。
// 判定器跑在**同步** Stop hook 里，几 MB 的合法 transcript 就足以把门禁推到分钟级或宿主超时，
// 结果是门禁不可用或异常 fail-open —— 因此这是可用性缺陷而非单纯的性能优化。
// 阈值取 2s（远高于 Map 版实测个位数 ms，也远低于数组版 3s），给满载机器留足余量避免 flaky。
// ────────────────────────────────────────

describe('F227 candidate history complexity - anti-regression anchor', () => {
  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);

  const N = 20000;
  const dirOf = (i) => `specs/${100000 + i}-fix-a`;

  it(`单条命令内 ${N} 个互不相同的合法候选须在 2s 内解析完，且语义与小规模用例一致`, () => {
    // 前置 `echo x > /tmp/y ` 提供同段写指示符（F225 判据），使同段内全部 artifact 路径都被提名
    const command = `echo x > /tmp/y ${Array.from({ length: N }, (_, i) => `${dirOf(i)}/fix-report.md`).join(' ')}`;
    const entries = [user('x'), bash(command, 1)];

    const startedAt = process.hrtime.bigint();
    const cand = resolveFeatureDirCandidate(entries, 0);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // 语义不变量：与小规模用例逐条同形
    assert.equal(cand.candidates.length, N, '互不相同的候选须全部记入历史（无去重误伤）');
    assert.equal(cand.candidates[0], dirOf(0));
    assert.equal(cand.candidates[N - 1], dirOf(N - 1), '末位为最后一次合法提名');
    assert.equal(cand.path, cand.candidates[cand.candidates.length - 1]);
    assert.equal(cand.ambiguous, false);

    assert.ok(
      elapsedMs < 2000,
      `候选历史解析退化为二次复杂度（${N} 候选耗时 ${elapsedMs.toFixed(0)}ms ≥ 2000ms）：`
      + '容器很可能被改回 indexOf+splice 数组实现，同步 Stop hook 会因此超时',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F231 第 10 轮 · 真实文件系统差分测试
// ────────────────────────────────────────────────────────────────────────────

describe('F231 真实文件系统差分：判定器说「改名」⟺ 真实 shell 里确实发生 SRC→DST', () => {
  // why 这组测试必须存在：本模块此前只测纯函数、从不真跑 mv/git mv，于是「我们断言它是真实改名」
  // 从未被真实工具验证过——已连栽三次（`mv S Y\r\n` 断言跟随到无 CR 的目录、`mv --force` 断言
  // 必须跟随、`mv S/ Y/` 断言跟随到 Y），全绿反而把误放行固化进回归集。
  // 本组把「判定器结论」与「磁盘事实」绑定：任何一侧漂移都会红。
  const S = 'specs/900-fix-x';
  const Y = 'specs/901-fix-y';
  /** 写入制品的已知内容：改名后据此断言"确实是同一份文件被搬过去"，防 shim 造空壳假绿 */
  const ARTIFACT_CONTENT = '# Fix\nF231-DIFF-SENTINEL\n';

  const user = (text) => normalizeTranscriptEntry(
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }, 0, false);
  const bash = (command, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } }, idx, false);
  const write = (filePath, idx) => normalizeTranscriptEntry(
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: filePath } }] } }, idx, false);
  const resolveWith = (command) => resolveFeatureDirCandidate([
    user('x'), write(`${S}/fix-report.md`, 1), bash(command, 2),
  ], 0);

  /** 沙盒登记表：`mkdtemp` 一成功就登记，避免后续步骤抛错时泄漏目录 */
  const sandboxes = [];
  after(() => {
    for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * 受控子进程环境：**不得**继承用户/CI 环境。
   * why：`BASH_ENV` / `ENV` / `SHELLOPTS` / 导出的 shell 函数（`BASH_FUNC_*`）都能让
   * `bash -c 'mv a b'` 跑到 shim 而非系统 `mv`——本组测试正是靠"真实工具行为"背书，
   * 被 shim 劫持会让误放行**假绿**。PATH 固定为系统目录，只保留必要变量。
   */
  const CONTROLLED_ENV = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: os.tmpdir(),
    LC_ALL: 'C',
    // git 隔离：全局/系统配置一律不读（本机 commit.gpgsign=true 会让 commit 失败）
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
  };

  /** 每条用例独立的隔离沙盒（`os.tmpdir()` 下，绝不碰工作区）；返回其绝对路径 */
  const sandbox = ({ git = false } = {}) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'f231-diff-'));
    sandboxes.push(dir);                       // mkdtemp 成功即登记，后续任何抛错都不泄漏
    mkdirSync(path.join(dir, S), { recursive: true });
    writeFileSync(path.join(dir, S, 'fix-report.md'), ARTIFACT_CONTENT, 'utf8');
    if (git) {
      const git0 = (...args) => spawnSync('git', [
        '-c', 'user.email=t@example.com', '-c', 'user.name=t',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
        ...args,
      ], { cwd: dir, encoding: 'utf8', env: CONTROLLED_ENV });
      // 逐步断言：init/add/commit 任一失败都必须让用例红，而不是让后续 git mv 静默走空
      for (const args of [['init', '-q', '.'], ['add', '-A'], ['commit', '-qm', 'init']]) {
        const res = git0(...args);
        assert.equal(res.status, 0, `git ${args[0]} 失败：${res.stderr || res.stdout}`);
      }
    }
    return dir;
  };

  /** 在沙盒里用真实 bash 跑命令（受控 env），返回磁盘事实 */
  const runReal = (dir, command) => {
    const res = spawnSync('bash', ['-c', command], {
      cwd: dir, encoding: 'utf8', env: CONTROLLED_ENV,
    });
    const dstReport = path.join(dir, Y, 'fix-report.md');
    return {
      status: res.status,
      srcGone: !existsSync(path.join(dir, S)),
      dstExists: existsSync(path.join(dir, Y)),
      // 内容校验：只比路径形状会被"造壳"的 shim 骗过（建个空目录就能假绿）
      dstContentIntact: existsSync(dstReport) && readFileSync(dstReport, 'utf8') === ARTIFACT_CONTENT,
      // dst 目录内是否被塞进了 basename(SRC)（DST 已是目录时 `mv` 的真实落点）
      nestedLanding: existsSync(path.join(dir, Y, '900-fix-x')),
    };
  };

  /** 运行时探测：本机文件系统是否大小写不敏感（macOS 默认是，Linux ext4 不是） */
  const caseInsensitiveFs = (() => {
    const probeDir = mkdtempSync(path.join(os.tmpdir(), 'f231-case-'));
    try {
      mkdirSync(path.join(probeDir, 'probe'));
      return existsSync(path.join(probeDir, 'PROBE'));
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  })();

  // ── 正向差分：判定器说跟随 ⟹ 磁盘上确实 SRC→DST ──
  // 只收**跨平台交集**形态（裸 mv 仅短选项 -f/-v），故在 BSD/macOS 与 GNU/Linux 上都应通过。
  const FOLLOW_CASES = [
    ['mv S Y', `mv ${S} ${Y}`, false],
    ['git mv S Y', `git mv ${S} ${Y}`, true],
    ['mv -f S Y', `mv -f ${S} ${Y}`, false],
    ['git mv -f S Y', `git mv -f ${S} ${Y}`, true],
    ['mv -f -v S Y', `mv -f -v ${S} ${Y}`, false],
    ['mv -vf S Y', `mv -vf ${S} ${Y}`, false],
    ['git mv -fv S Y', `git mv -fv ${S} ${Y}`, true],
    ['git mv -vf S Y', `git mv -vf ${S} ${Y}`, true],
    ['git mv S/ Y（仅源尾随斜杠）', `git mv ${S}/ ${Y}`, true],
    ['git mv --force S Y', `git mv --force ${S} ${Y}`, true],
    ['git mv --verbose S Y', `git mv --verbose ${S} ${Y}`, true],
    ['mv\\tS\\tY（tab 分隔）', `mv\t${S}\t${Y}`, false],
    ['mv S/ Y（仅源尾随斜杠）', `mv ${S}/ ${Y}`, false],
    ['mv S Y\\n（尾随换行）', `mv ${S} ${Y}\n`, false],
    ['\\nmv S Y（前导换行）', `\nmv ${S} ${Y}`, false],
    ['  mv S Y（前导空格）', `  mv ${S} ${Y}`, false],
    ['mv S Y  （尾随空格）', `mv ${S} ${Y}  `, false],
  ];

  for (const [label, command, needGit] of FOLLOW_CASES) {
    it(`正向差分 ${label}：判定器跟随 ⟺ 磁盘确实 SRC→DST`, () => {
      // 1) 判定器侧
      assert.equal(scanRenameCommandEvents(command).length, 1, `判定器应产出 1 条事件：${JSON.stringify(command)}`);
      const cand = resolveWith(command);
      assert.equal(cand.path, Y, `判定器应跟随到 ${Y}`);
      assert.equal(cand.ambiguous, false);
      // 2) 真实文件系统侧
      const fact = runReal(sandbox({ git: needGit }), command);
      assert.equal(fact.status, 0, `真实命令应成功（rc=${fact.status}）：${JSON.stringify(command)}`);
      assert.ok(fact.dstExists, `磁盘上 ${Y} 应存在：${JSON.stringify(command)}`);
      assert.ok(fact.srcGone, `磁盘上 ${S} 应已不存在：${JSON.stringify(command)}`);
      assert.ok(!fact.nestedLanding, `不应落成 ${Y}/900-fix-x：${JSON.stringify(command)}`);
      assert.ok(fact.dstContentIntact, `${Y}/fix-report.md 内容应与源逐字一致（防造壳假绿）`);
    });
  }

  // ── 反向差分：判定器拒绝 ⟹ 真实执行也没有产生 SRC→DST ──
  // 覆盖第 10 轮修的 4 类。平台差异见每条注释。
  it('反向差分 C1 `mv S Y/`（dst 尾随斜杠）：判定器零事件，且磁盘落点不是 SRC→DST', () => {
    const command = `mv ${S} ${Y}/`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    assert.equal(resolveWith(command).path, S);
    // dst **已存在**时（跨平台一致）真实落点是 `Y/900-fix-x`，而非 `Y` 本身——
    // 判定器若采信就会记录一个从未存在的路径。这里显式把 dst 预建出来复现该分支。
    const dir = sandbox();
    mkdirSync(path.join(dir, Y), { recursive: true });
    const fact = runReal(dir, command);
    assert.ok(fact.nestedLanding, `真实落点应是 ${Y}/900-fix-x（嵌套），实测未嵌套`);
  });

  it('反向差分 C2a `mv S specs`（dst 是 src 的父目录）：判定器零事件，且磁盘未改名', () => {
    const command = `mv ${S} specs`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    assert.equal(resolveWith(command).path, S);
    const fact = runReal(sandbox(), command);
    assert.ok(!fact.srcGone, `真实执行不应改名（实测 rc≠0 且 ${S} 仍在）`);
    assert.notEqual(fact.status, 0, '真实 mv 应报错（src/dst identical）');
  });

  it('反向差分 C2b `mv S S/child`（dst 是 src 的后代）：判定器零事件，且磁盘未改名', () => {
    const command = `mv ${S} ${S}/child`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    assert.equal(resolveWith(command).path, S);
    const dir = sandbox();
    const fact = runReal(dir, command);
    assert.ok(!fact.srcGone, `${S} 应仍在`);
    assert.ok(!existsSync(path.join(dir, S, 'child')), '后代目标不应被创建');
    assert.notEqual(fact.status, 0, '真实 mv 应报错（Invalid argument）');
  });

  it('反向差分 C3 `mv S SPECS/900-fix-x`（大小写别名）：判定器零事件；不敏感 FS 上磁盘亦未改名', (t) => {
    const command = `mv ${S} SPECS/900-fix-x`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    assert.equal(resolveWith(command).path, S);
    if (!caseInsensitiveFs) {
      // 大小写**敏感**文件系统（如 Linux ext4）上 SPECS/ 是另一个目录，语义不同；
      // 我们仍拒绝该形态属 fail-closed 取舍（最多误阻断），故此处只断言判定器侧。
      t.diagnostic('大小写敏感 FS：跳过磁盘事实断言（判定器侧已断言）');
      return;
    }
    const dir = sandbox();
    const fact = runReal(dir, command);
    assert.ok(!fact.srcGone, `大小写不敏感 FS 上 src/dst 是同一目录，${S} 应仍在`);
    assert.notEqual(fact.status, 0, '真实 mv 应报错（same file）');
  });

  it('反向差分 C4 `mv --force S Y`（裸 mv 长选项）：判定器零事件（平台差异见注释）', () => {
    const command = `mv --force ${S} ${Y}`;
    assert.deepEqual(scanRenameCommandEvents(command), []);
    assert.equal(resolveWith(command).path, S);
    // **刻意不断言磁盘事实**：长选项是 GNU coreutils 专有——Darwin `/bin/mv --force` 是
    // `illegal option` rc=64 无改名，而 GNU coreutils 支持 `--force` 会真的改名。
    // 我们统一拒绝裸 mv 的长选项是 fail-closed 取舍（跨平台交集只保短选项），与平台无关，
    // 故这里只钉判定器侧，避免测试在 GNU 平台假红。
  });

  // ── F231 第 12 轮：DST 运行时已是目录 → 真实落点是 `DST/basename(SRC)`（**已知限界**）──
  //
  // 本组是 **characterization（钉住当前行为）**，不是"反向回归/已关闭"——请勿据此以为该形态被拦下。
  // 命令文本与合法改名**逐字相同**，静态不可判定。第 11 轮曾引入注入式磁盘探针试图关闭它，
  // 第 12 轮实测**双向证伪**后整体回退（详见 specs/231-.../fix-report.md「第 12 轮」）：
  //   - 假阴：探针读单一终态快照，而终态同样在攻击者控制下——嵌套后再把痕迹搬走即探不到，
  //     fail-open 完全恢复（= F227「终态快照 ≠ 历史事件序列」，"否证方向"并不豁免）；
  //   - 假阳：合法 `A→B` 后若 A 原含同名子目录 `A/A`，终态存在 `B/A` → 真实改名被误阻断。
  // 且该形态**不提供新能力**：劫持既有规范目录纯提名即可（不需要 mv，= F227 已知限界一，用户已接受）；
  // 打开 fail-open 用真实 `git mv SRC <不存在的非规范名>` 即可（= SC-005，F224 设计意图，须保住）。
  it('已知限界 characterization：DST 预先存在为目录 → 真实嵌套落点，判定器仍按文本跟随', () => {
    const dir = sandbox();
    mkdirSync(path.join(dir, Y), { recursive: true });
    const command = `mv ${S} ${Y}`;
    const fact = runReal(dir, command);
    // 真实层面：落点确实是嵌套，这条事实不随判定器实现变化
    assert.equal(fact.status, 0, '真实 mv 成功（这正是隐蔽之处）');
    assert.ok(fact.nestedLanding, `真实落点应是 ${Y}/900-fix-x（嵌套搬入）`);
    // 判定器层面：按命令文本跟随到 Y（已知限界，非缺陷——理由见本组顶部注释）
    const cand = resolveWith(command);
    assert.equal(cand.path, Y, '当前行为：按文本跟随（已知限界）');
    assert.equal(cand.ambiguous, false);
  });

  it('已知限界 characterization：DST 是已存在的规范特性目录 → 候选跟到该目录（= F227 已知限界一，纯提名即可复现）', () => {
    const dir = sandbox();
    const decoy = 'specs/999-fix-decoy';
    mkdirSync(path.join(dir, decoy), { recursive: true });
    writeFileSync(path.join(dir, decoy, 'fix-report.md'), '# 他人的历史制品\n', 'utf8');
    const command = `mv ${S} ${decoy}`;
    const fact = runReal(dir, command);
    assert.equal(fact.status, 0);
    assert.ok(existsSync(path.join(dir, decoy, '900-fix-x')), `真实落点应是 ${decoy}/900-fix-x`);
    assert.equal(resolveWith(command).path, decoy, '当前行为：跟到 decoy（已知限界）');
    // 关键对照：**不需要任何 mv**，仅一次 Write 提名即可得到逐字相同的结果
    // ——证明本形态未提供超出 F227 已知限界一的新能力。
    const byNominationOnly = resolveFeatureDirCandidate([
      user('x'), write(`${decoy}/fix-report.md`, 1),
    ], 0);
    assert.equal(byNominationOnly.path, decoy, '纯提名路线结果与嵌套路线逐字相同');
  });

  it('已知限界 characterization：DST 是目录符号链接 → mv 跟随链接嵌套搬入', () => {
    const dir = sandbox();
    const linkName = 'specs/link-target';
    mkdirSync(path.join(dir, 'real-target'), { recursive: true });
    symlinkSync(path.join(dir, 'real-target'), path.join(dir, linkName));
    const command = `mv ${S} ${linkName}`;
    const fact = runReal(dir, command);
    assert.equal(fact.status, 0);
    assert.ok(existsSync(path.join(dir, 'real-target', '900-fix-x')), 'mv 跟随符号链接嵌套搬入 real-target');
    // 当前行为：`specs/link-target` 不符合 NNN-fix-<name> → 与「真实改名到非规范名」同一支，
    // 即 F224 SC-005 的降级设计意图（path=null / ambiguous=true），而非跟到 linkName。
    // 该结果与用真实 `git mv SRC specs/任意非规范名` 逐字相同 → 未提供新能力（已知限界）。
    const cand = resolveWith(command);
    assert.equal(cand.path, null, '当前行为：走 F224 降级支（已知限界）');
    assert.equal(cand.ambiguous, true);
  });

  it('对照：DST 不存在（SC-005 形态）→ 照常跟随并 ambiguous（F224 降级设计意图，须保住）', () => {
    const nonstandard = 'specs/renamed-nonstandard';
    const cand = resolveWith(`mv ${S} ${nonstandard}`);
    assert.equal(cand.path, null);
    assert.equal(cand.ambiguous, true);
  });
});

// ────────────────────────────────────────
// F240 T030 · FR-004：transcript 方言识别（detectTranscriptDialect）
//
// 范围声明（禁止 over-claim）：本组用例守护的是**可观测性**改进——判定能力在异构
// wire format 下失效时是否留下诊断。它**不**提供第二事实源、**不**提高合规判定强度、
// **不**改变任何放行/阻断语义。
// ────────────────────────────────────────

describe('F240 T030 detectTranscriptDialect：四结果矩阵（正向识别）', () => {
  const claudeEntry = (role) => normalizeTranscriptEntry({ type: role, message: { role, content: 'x' } }, 0, false);
  const codexEntry = (type, i = 0) => normalizeTranscriptEntry({ timestamp: '2026-08-03T00:00:00Z', type, payload: {} }, i, false);

  it('常量合同：两个角色集合 frozen；Codex 侧覆盖实扫观测到的全部 7 种顶层 type', () => {
    assert.deepEqual([...CLAUDE_TRANSCRIPT_ROLES], ['user', 'assistant', 'system', 'summary']);
    // W-1：本机全量实扫 ~/.codex/sessions 1167 份 rollout 的顶层 type 观测集合。
    // 曾只声明前 3 个，漏掉 turn_context(1001 份) / world_state(95) /
    // inter_agent_communication_metadata(33) / compacted(31)。C-1 把 unknown 收窄为静默后
    // 本清单成为承重件，漏项 = Codex 切片静默漏报，故此处按实测集合逐字钉死。
    assert.deepEqual([...CODEX_ROLLOUT_ROLES], [
      'session_meta', 'event_msg', 'response_item',
      'turn_context', 'world_state', 'compacted', 'inter_agent_communication_metadata',
    ]);
    assert.ok(Object.isFrozen(CLAUDE_TRANSCRIPT_ROLES));
    assert.ok(Object.isFrozen(CODEX_ROLLOUT_ROLES));
  });

  it('C-1 常量合同：FOREIGN_DIALECT_DIAGNOSTICS 只含正向识别成功的方言，unknown MUST NOT 入表', () => {
    assert.ok(Object.isFrozen(FOREIGN_DIALECT_DIAGNOSTICS));
    assert.deepEqual(Object.keys(FOREIGN_DIALECT_DIAGNOSTICS), ['codex-rollout']);
    assert.equal(FOREIGN_DIALECT_DIAGNOSTICS['codex-rollout'], 'dialect:codex-rollout');
    // unknown = 开放世界的否定（"我不认识"），不是"这是异构格式"的肯定断言。
    // 两份 role 清单都非穷尽，真实 Claude 会话可以落进 unknown（实扫已命中），
    // 因此它一旦入表就等于把 US5 零落盘不变量押在清单的追平速度上。
    assert.equal(Object.hasOwn(FOREIGN_DIALECT_DIAGNOSTICS, 'unknown'), false);
    assert.equal(Object.hasOwn(FOREIGN_DIALECT_DIAGNOSTICS, 'claude'), false);
    assert.equal(Object.hasOwn(FOREIGN_DIALECT_DIAGNOSTICS, 'empty'), false);
  });

  it('C-1：真实 Claude 会话元数据 envelope（白名单外的顶层 type）判 unknown 而非 claude —— 故消费方不得据 unknown 落盘', () => {
    // 实扫 ~/.claude/projects 2676 份取证：这些顶层 type 真实存在于 Claude transcript，
    // 且有 1 份规范 session 文件（<encoded-cwd>/<uuid>.jsonl）只含 ai-title + agent-name。
    // 本用例把"白名单欠包含 ⇒ 健康会话落 unknown"这一事实钉在 core 层，
    // 使 judge 侧"unknown 恒静默"的必要性不依赖阅读理解。
    for (const type of ['attachment', 'last-prompt', 'queue-operation', 'custom-title',
      'mode', 'permission-mode', 'file-history-snapshot', 'ai-title', 'agent-name', 'frame-link']) {
      assert.equal(CLAUDE_TRANSCRIPT_ROLES.includes(type), false, `${type} 已在白名单内，用例失效`);
      assert.equal(detectTranscriptDialect([normalizeTranscriptEntry({ type, sessionId: 's-1' }, 0, false)]), 'unknown', type);
    }
  });

  it('规则 1：无非 parseError 条目 → empty（空数组 / 全损坏 / 非数组入参同解）', () => {
    assert.equal(detectTranscriptDialect([]), 'empty');
    assert.equal(detectTranscriptDialect([normalizeTranscriptEntry(null, 0, true)]), 'empty');
    assert.equal(detectTranscriptDialect(null), 'empty');
    assert.equal(detectTranscriptDialect(undefined), 'empty');
    assert.equal(detectTranscriptDialect('not-an-array'), 'empty');
  });

  it('规则 2：存在任一 Claude role → claude（四种 role 逐个覆盖）', () => {
    for (const role of CLAUDE_TRANSCRIPT_ROLES) {
      assert.equal(detectTranscriptDialect([claudeEntry(role)]), 'claude', `role=${role}`);
    }
  });

  it('规则 3：全部为 Codex rollout role → codex-rollout（三种 type 逐个 + 混合）', () => {
    for (const type of CODEX_ROLLOUT_ROLES) {
      assert.equal(detectTranscriptDialect([codexEntry(type)]), 'codex-rollout', `type=${type}`);
    }
    assert.equal(
      detectTranscriptDialect(CODEX_ROLLOUT_ROLES.map((t, i) => codexEntry(t, i))),
      'codex-rollout',
    );
  });

  it('规则 4：既无 Claude role 也无 Codex role → unknown', () => {
    assert.equal(detectTranscriptDialect([normalizeTranscriptEntry({ type: 'x-custom' }, 0, false)]), 'unknown');
    // role 缺失（无 type 字段）同样落 unknown，不得误归 claude
    assert.equal(detectTranscriptDialect([normalizeTranscriptEntry({ foo: 1 }, 0, false)]), 'unknown');
  });

  it('规则 2 优先于规则 3：Claude + Codex role 混合 → claude（保守归属）', () => {
    assert.equal(detectTranscriptDialect([codexEntry('event_msg', 0), claudeEntry('user')]), 'claude');
    assert.equal(detectTranscriptDialect([claudeEntry('assistant'), codexEntry('session_meta', 1)]), 'claude');
  });

  it('parseError 条目不参与方言判定（部分损坏的 Claude transcript 仍判 claude）', () => {
    assert.equal(
      detectTranscriptDialect([normalizeTranscriptEntry(null, 0, true), claudeEntry('user')]),
      'claude',
    );
  });

  it('🔴 负向不变量：正常 Claude **非 fix** 会话 MUST 判 claude —— 禁止用「不是 fix 会话」反推方言', () => {
    // non-fix-session.jsonl 是 feature 模式展开（无 fix 锚点）的正常 Claude transcript。
    // 若实现用「无 fix 锚点」当异构信号，此处会误判 → 每个健康 Claude 会话都开始落盘诊断，
    // 直接摧毁 fix-compliance-judge.mjs「US5：健康路径不产生任何落盘」不变量。
    const entries = loadEntries('non-fix-session.jsonl');
    assert.equal(detectFixSkillExpansion(entries).mode, 'feature', '前提：该 fixture 确实不是 fix 会话');
    assert.equal(detectTranscriptDialect(entries), 'claude');
  });

  it('真实 fixture 对拍：Claude 侧 fixture 全判 claude、Codex rollout fixture 判 codex-rollout', () => {
    for (const name of ['collapsed-zero-delegation.jsonl', 'compliant-full.jsonl', 'real-bash-transcript-claude.jsonl']) {
      assert.equal(detectTranscriptDialect(loadEntries(name)), 'claude', name);
    }
    assert.equal(detectTranscriptDialect(loadEntries('real-bash-transcript-codex.jsonl')), 'codex-rollout');
  });

  it('I4 静态守卫：函数体内零 I/O —— fs. / require / import( 零命中', () => {
    const body = detectTranscriptDialect.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/\brequire\s*\(/.test(body), false, body);
    assert.equal(/\bimport\s*\(/.test(body), false, body);
  });

  it('I4 性能上界：5 万条 entries 单遍判定 < 200ms（零额外文件读取）', () => {
    const big = Array.from({ length: 50000 }, (_, i) => codexEntry('event_msg', i));
    const t0 = Date.now();
    assert.equal(detectTranscriptDialect(big), 'codex-rollout');
    assert.ok(Date.now() - t0 < 200, `耗时 ${Date.now() - t0}ms`);
  });
});

// ────────────────────────────────────────
// F256 盲区 1 · extractFixShortName（short-name 磁盘兜底的纯函数前置）
// ────────────────────────────────────────

describe('F256 T001 · extractFixShortName：合法特性目录路径的 short-name 抽取', () => {
  it('阳性：标准 specs/NNN-fix-<short> 路径抽出 <short> 段', () => {
    assert.equal(extractFixShortName('specs/256-fix-compliance-false-blocks'), 'compliance-false-blocks');
    assert.equal(extractFixShortName('specs/1-fix-a'), 'a');
    assert.equal(extractFixShortName('specs/0254-fix-graph-scope-extensions'), 'graph-scope-extensions');
  });

  it('阳性：尾随斜杠形态同样正确提取（与 FIX_DIR_NAME_REGEX 的容忍面一致）', () => {
    assert.equal(extractFixShortName('specs/256-fix-compliance-false-blocks/'), 'compliance-false-blocks');
  });

  it('阴性：缺 fix- 段 / 含大写 / 纯数字目录名 → null（不做启发式兜底）', () => {
    assert.equal(extractFixShortName('specs/256-other-thing'), null);
    assert.equal(extractFixShortName('specs/256-Fix-Foo'), null);
    assert.equal(extractFixShortName('specs/256-fix-Foo'), null);
    assert.equal(extractFixShortName('specs/256'), null);
    assert.equal(extractFixShortName('specs/256-fix-'), null);
  });

  it('阴性：非 specs/ 前缀、多层嵌套、制品文件路径 → null（整串锚定，不做子串搜索）', () => {
    assert.equal(extractFixShortName('other/256-fix-foo'), null);
    assert.equal(extractFixShortName('a/specs/256-fix-foo'), null);
    assert.equal(extractFixShortName('specs/256-fix-foo/fix-report.md'), null);
    assert.equal(extractFixShortName('specs/256-fix-foo/verification'), null);
  });

  it('阴性：非字符串输入一律 null，不抛出', () => {
    for (const bad of [null, undefined, 123, {}, [], true]) {
      assert.equal(extractFixShortName(bad), null, JSON.stringify(bad) ?? String(bad));
    }
  });

  it('与 FIX_DIR_NAME_REGEX 语义对齐：凡该正则接受的路径必有非 null short-name', () => {
    // 两者是同一命名合同的两个面（判"是否合法特性目录" vs 取"其中的 short 段"），
    // 若日后放宽/收紧其一而忘了另一，此断言变红。
    for (const p of ['specs/1-fix-a', 'specs/300-fix-alpha/', 'specs/99-fix-a-b-c-9']) {
      assert.equal(FIX_DIR_NAME_REGEX.test(p), true, p);
      assert.notEqual(extractFixShortName(p), null, p);
    }
    for (const p of ['specs/1-fixa', 'specs/x-fix-a', 'specs/1-fix-A']) {
      assert.equal(FIX_DIR_NAME_REGEX.test(p), false, p);
      assert.equal(extractFixShortName(p), null, p);
    }
  });

  it('I4 静态守卫：函数体内零 I/O（core 层纯函数契约）', () => {
    const body = extractFixShortName.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/\brequire\s*\(/.test(body), false, body);
    assert.equal(/\bimport\s*\(/.test(body), false, body);
    assert.equal(/process\.env/.test(body), false, body);
  });
});

// ────────────────────────────────────────
// F256 盲区 2 · extractInFlightDelegationsAfter（在途委派 = 判定时机未到）
// ────────────────────────────────────────

/** assistant 条目：若干 tool_use 块 + 可选同条目 tool_result 块（wire format 与真实 transcript 同构） */
const assistantEntry = (lineIndex, toolUses, toolResults = []) => normalizeTranscriptEntry({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      ...toolUses.map(({ id, name, input }) => ({ type: 'tool_use', id, name, input })),
      ...toolResults.map(({ toolUseId, isError }) => ({ type: 'tool_result', tool_use_id: toolUseId, is_error: isError === true, content: 'ok' })),
    ],
  },
}, lineIndex, false);

/** user 条目：纯文本块（harness 注入面，<task-notification> 只从这里认） */
const userTextEntry = (lineIndex, text) => normalizeTranscriptEntry({
  type: 'user',
  message: { role: 'user', content: [{ type: 'text', text }] },
}, lineIndex, false);

/** user 条目：tool_result 块（真实 wire format 中同步工具回执落在紧随的 user 条目） */
const userResultEntry = (lineIndex, toolUseId, isError = false) => normalizeTranscriptEntry({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: 'ack' }] },
}, lineIndex, false);

/** 真实 <task-notification> 文本（wire format 取自 fix-report.md 引用的 F254 transcript 实测） */
const taskNotification = (taskId, toolUseId) => [
  '<task-notification>',
  `<task-id>${taskId}</task-id>`,
  `<tool-use-id>${toolUseId}</tool-use-id>`,
  '<status>completed</status>',
  '</task-notification>',
].join('\n');

const kinds = (items) => items.map((x) => x.kind).sort();

describe('F256 T008 · extractInFlightDelegationsAfter 规则 1：尾部未消费的同步委派', () => {
  it('阳性：transcript 以裸 Agent tool_use 收尾且无配对 tool_result → 命中 sync', () => {
    const entries = [
      userTextEntry(0, '开始'),
      assistantEntry(1, [{ id: 'toolu_a', name: 'Agent', input: { subagent_type: 'spec-driver:verify' } }]),
    ];
    const items = extractInFlightDelegationsAfter(entries, 0);
    assert.deepEqual(kinds(items), ['sync']);
    assert.equal(items[0].id, 'toolu_a');
    assert.equal(items[0].lineIndex, 1);
  });

  it('阳性：Task 与 Agent 等价对待（历史/未来工具名同属委派白名单）', () => {
    const entries = [userTextEntry(0, 'x'), assistantEntry(1, [{ id: 't1', name: 'Task', input: {} }])];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, 0)), ['sync']);
  });

  it('🔴 阴性回归钉子：未配对的 Agent 之后还有任意后续条目 → 不得命中', () => {
    // 这条钉子守护 plan.md §5.1 的收窄边界。语义根据：同步 Agent/Task 会阻塞会话轮次直至
    // tool_result 返回——只要其后还有任何条目，就足以证明它已经解决。
    //
    // 若日后放宽为"扫描任意位置的未配对调用"，全仓 25 处既有 TOOL_USE('Agent', …) fixture
    // （均不附 tool_result，因为委派抽取此前从不需要它）会被集体误判为在途 →
    // 本该 exit 2 的阻断类用例集体降级 exit 0，是一次隐蔽的大规模 fail-open。
    for (const trailing of [
      userTextEntry(2, '随便一条后续用户消息'),
      normalizeTranscriptEntry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '' }] } }, 2, false),
      normalizeTranscriptEntry({ type: 'system' }, 2, false),
    ]) {
      const entries = [
        userTextEntry(0, 'x'),
        assistantEntry(1, [{ id: 'toolu_a', name: 'Agent', input: {} }]),
        trailing,
      ];
      assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), [], JSON.stringify(trailing.role));
    }
  });

  it('阴性：同条目内已有配对 tool_result → 不命中', () => {
    const entries = [
      userTextEntry(0, 'x'),
      assistantEntry(1, [{ id: 'toolu_a', name: 'Agent', input: {} }], [{ toolUseId: 'toolu_a' }]),
    ];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), []);
  });

  it('阴性：末条 Agent 在锚点之前/末条不是 assistant/末条无委派 → 不命中', () => {
    assert.deepEqual(
      extractInFlightDelegationsAfter([assistantEntry(1, [{ id: 'a', name: 'Agent', input: {} }])], 5),
      [], '锚点之后才计入',
    );
    assert.deepEqual(
      extractInFlightDelegationsAfter([userTextEntry(0, 'x'), userTextEntry(1, 'y')], 0),
      [], '末条非 assistant',
    );
    assert.deepEqual(
      extractInFlightDelegationsAfter([userTextEntry(0, 'x'), assistantEntry(1, [{ id: 'b', name: 'Bash', input: {} }])], 0),
      [], '非委派工具不计入',
    );
  });

  it('阴性：末条 Agent 缺 tool_use id → 不命中（无 id 无法配对，宁可漏判不误放行）', () => {
    const entries = [userTextEntry(0, 'x'), normalizeTranscriptEntry({
      type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Agent', input: {} }] },
    }, 1, false)];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), []);
  });

  it('空 entries / 非数组入参 → []（不抛出）', () => {
    for (const bad of [[], null, undefined, 'x', 123]) {
      assert.deepEqual(extractInFlightDelegationsAfter(bad, 0), [], String(bad));
    }
  });
});

describe('F256 T008 · extractInFlightDelegationsAfter 规则 2：后台委派未收到完成通知', () => {
  /**
   * 后台 Agent 派发 + 紧随的 ack tool_result（真实 wire format：后台派发会立刻拿到
   * "launched in the background…" 回执，完成信号才是后续的 <task-notification>）。
   * @param {{ack?:boolean, ackIsError?:boolean}} [opts] - 关掉/污染回执以覆盖有效性门槛
   */
  const backgroundDispatch = (line, id, { ack = true, ackIsError = false } = {}) => {
    const out = [assistantEntry(line, [{ id, name: 'Agent', input: { run_in_background: true } }])];
    if (ack) out.push(userResultEntry(line + 1, id, ackIsError));
    return out;
  };

  it('阳性：run_in_background:true + 正常 ack 回执 + 无匹配 <tool-use-id> 通知 → 命中 background', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...backgroundDispatch(1, 'toolu_bg'),
      userTextEntry(3, '后续消息'),
    ];
    const items = extractInFlightDelegationsAfter(entries, 0);
    assert.deepEqual(kinds(items), ['background']);
    assert.equal(items[0].id, 'toolu_bg');
  });

  it('阴性：已收到匹配 <tool-use-id> 的 task-notification → 不命中', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...backgroundDispatch(1, 'toolu_bg'),
      userTextEntry(3, taskNotification('agent-1', 'toolu_bg')),
    ];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), []);
  });

  it('阴性：通知的 tool-use-id 属于**另一个**委派 → 原委派仍在途（配对按 id，不按存在性）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...backgroundDispatch(1, 'toolu_bg'),
      userTextEntry(3, taskNotification('agent-1', 'toolu_other')),
    ];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, 0)), ['background']);
  });

  it('🔴 gaming 边界：后台派发缺少非错误 tool_result 回执时不得计入在途（与规则 3 同一道门槛）', () => {
    // CRITICAL（第 2 轮）：规则 2 原先只看"有没有完成通知"，不看该派发自身是否被受理。
    // 于是一次注定失败的后台派发（is_error）或压根没被受理的派发，就足以让门禁永久推迟——
    // 这是最廉价的自助绕过，且与规则 3 已设的门槛不对等。
    const noAck = [userTextEntry(0, 'x'), ...backgroundDispatch(1, 'bg', { ack: false }), userTextEntry(3, 'y')];
    assert.deepEqual(extractInFlightDelegationsAfter(noAck, 0), [], '无回执的后台派发不得制造在途');
    const errAck = [userTextEntry(0, 'x'), ...backgroundDispatch(1, 'bg', { ackIsError: true }), userTextEntry(3, 'y')];
    assert.deepEqual(extractInFlightDelegationsAfter(errAck, 0), [], '报错回执的后台派发不得制造在途');
  });

  it('反伪造：assistant 文本块里的 task-notification 不算完成信号（只认 harness 注入的 user 文本）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...backgroundDispatch(1, 'toolu_bg'),
      normalizeTranscriptEntry({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: taskNotification('agent-1', 'toolu_bg') }] },
      }, 3, false),
    ];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, 0)), ['background'],
      '模型自陈的完成通知不得让在途消失（那是反向的 fail-open）');
  });

  it('多个后台委派各自独立计数', () => {
    const entries = [
      userTextEntry(0, 'x'),
      assistantEntry(1, [
        { id: 'bg1', name: 'Agent', input: { run_in_background: true } },
        { id: 'bg2', name: 'Agent', input: { run_in_background: true } },
      ], [{ toolUseId: 'bg1' }, { toolUseId: 'bg2' }]),
      userTextEntry(2, taskNotification('agent-1', 'bg1')),
    ];
    const items = extractInFlightDelegationsAfter(entries, 0);
    assert.deepEqual(kinds(items), ['background']);
    assert.equal(items[0].id, 'bg2');
  });

  it('🔴 回归钉子：完成通知 id 被换行/缩进包裹时仍须正确配对（否则偏向"继续判在途"=偏向放行）', () => {
    // TASK_NOTIFICATION_PAIR_REGEX 的 `[^<]+` 会把标签内侧空白一并捕获，不 trim 就配不上真实 id。
    const padded = '<task-notification>\n<task-id>\n  agent-1\n</task-id>\n<tool-use-id>\n  toolu_bg\n</tool-use-id>\n</task-notification>';
    const entries = [userTextEntry(0, 'x'), ...backgroundDispatch(1, 'toolu_bg'), userTextEntry(3, padded)];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), [], '换行包裹的 id 必须能与 toolu_bg 配对');
  });
});

describe('F256 T008 · extractInFlightDelegationsAfter 规则 3：SendMessage 恢复后台子代理', () => {
  /** SendMessage(to) 派发 + 紧随的非错误 ack tool_result（真实 wire format） */
  const sendMessage = (line, id, to, { ack = true, ackIsError = false } = {}) => {
    const out = [assistantEntry(line, [{ id, name: 'SendMessage', input: { to, message: '继续' } }])];
    if (ack) out.push(userResultEntry(line + 1, id, ackIsError));
    return out;
  };

  it('阳性：派发晚于该 agent 最后一次 <task-id> 通知 → 命中 send-message', () => {
    const entries = [
      userTextEntry(0, 'x'),
      userTextEntry(1, taskNotification('agent-A', 'toolu_orig')),
      ...sendMessage(2, 'sm1', 'agent-A'),
      userTextEntry(4, '后续'),
    ];
    const items = extractInFlightDelegationsAfter(entries, 0);
    assert.deepEqual(kinds(items), ['send-message']);
    assert.equal(items[0].id, 'agent-A');
  });

  it('阴性：派发之后已到达该 agent 的新通知 → 不命中', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...sendMessage(1, 'sm1', 'agent-A'),
      userTextEntry(3, taskNotification('agent-A', 'toolu_orig')),
    ];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), []);
  });

  it('阴性：通知属于另一个 agent → 原 agent 仍在途（按 task-id 配对）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...sendMessage(1, 'sm1', 'agent-A'),
      userTextEntry(3, taskNotification('agent-B', 'toolu_orig')),
    ];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, 0)), ['send-message']);
  });

  it('🔴 gaming 边界：派发缺少非错误 tool_result 回执时不得计入在途', () => {
    // 若不设此门槛，向一个虚构 to 反复 SendMessage 即可让 runHook 永久判"在途"、永不进入阻断路由。
    // 门槛后攻击者至少需要一次**真实成功**的 SendMessage（harness 落地的非错误回执）。
    const noAck = [userTextEntry(0, 'x'), ...sendMessage(1, 'sm1', 'ghost-agent', { ack: false }), userTextEntry(3, 'y')];
    assert.deepEqual(extractInFlightDelegationsAfter(noAck, 0), [], '无回执的派发不得制造在途');
    const errAck = [userTextEntry(0, 'x'), ...sendMessage(1, 'sm2', 'ghost-agent', { ackIsError: true }), userTextEntry(3, 'y')];
    assert.deepEqual(extractInFlightDelegationsAfter(errAck, 0), [], '报错回执的派发不得制造在途');
  });

  it('阴性：SendMessage 缺 to 字段 / to 非字符串 → 不计入', () => {
    for (const to of [undefined, null, 123, {}]) {
      const entries = [
        userTextEntry(0, 'x'),
        assistantEntry(1, [{ id: 'sm1', name: 'SendMessage', input: { to } }]),
        userResultEntry(2, 'sm1'),
        userTextEntry(3, 'y'),
      ];
      assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), [], String(to));
    }
  });

  it('同一 agent 多次派发按最后一次派发计（取最晚派发 vs 最晚通知）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      ...sendMessage(1, 'sm1', 'agent-A'),
      userTextEntry(3, taskNotification('agent-A', 'toolu_orig')),
      ...sendMessage(4, 'sm2', 'agent-A'),
      userTextEntry(6, 'y'),
    ];
    const items = extractInFlightDelegationsAfter(entries, 0);
    assert.deepEqual(kinds(items), ['send-message'], '末次派发后无通知 → 仍在途');
    assert.equal(items[0].lineIndex, 4);
  });

  it('SendMessage 刻意不并入 DELEGATION_TOOL_NAMES：不得被 extractDelegationsAfter 计为委派', () => {
    // "派了工"（SendMessage 触发恢复）与"收了工"（子代理完成收口）是两个不同断言。
    // 把它计入委派会让「派一条消息」直接顶替「验证闭环已完成」，反而削弱合规判据。
    const entries = [userTextEntry(0, 'x'), ...sendMessage(1, 'sm1', 'agent-A'), userTextEntry(3, 'y')];
    assert.deepEqual(extractDelegationsAfter(entries, 0), []);
  });
});

describe('F256 T008 · extractInFlightDelegationsAfter：窗口/正交/性能', () => {
  it('锚点窗口：锚点之前的委派与通知一律不参与判定', () => {
    const entries = [
      assistantEntry(0, [{ id: 'old', name: 'Agent', input: { run_in_background: true } }]),
      userTextEntry(1, 'Base directory for this skill: /w/skills/spec-driver-fix'),
      userTextEntry(2, '之后'),
    ];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 1), []);
  });

  it('anchorLineIndex 非数字（null/undefined）→ 按 -1 处理，全量窗口', () => {
    const entries = [
      assistantEntry(0, [{ id: 'bg', name: 'Agent', input: { run_in_background: true } }], [{ toolUseId: 'bg' }]),
      userTextEntry(1, 'y'),
    ];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, null)), ['background']);
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, undefined)), ['background']);
  });

  it('三条规则可同时命中且互不吞并', () => {
    const entries = [
      userTextEntry(0, 'x'),
      assistantEntry(1, [{ id: 'bg', name: 'Agent', input: { run_in_background: true } }], [{ toolUseId: 'bg' }]),
      assistantEntry(2, [{ id: 'sm1', name: 'SendMessage', input: { to: 'agent-A' } }]),
      userResultEntry(3, 'sm1'),
      assistantEntry(4, [{ id: 'sync1', name: 'Agent', input: {} }]),
    ];
    assert.deepEqual(kinds(extractInFlightDelegationsAfter(entries, 0)), ['background', 'send-message', 'sync']);
  });

  it('健康会话（委派全部收口）→ 空数组：本判定对既有健康路径零介入', () => {
    const entries = [
      userTextEntry(0, 'x'),
      assistantEntry(1, [{ id: 'a1', name: 'Agent', input: { subagent_type: 'spec-driver:implement' } }]),
      userResultEntry(2, 'a1'),
      assistantEntry(3, [{ id: 'a2', name: 'Agent', input: { subagent_type: 'spec-driver:verify' } }]),
      userResultEntry(4, 'a2'),
      normalizeTranscriptEntry({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] } }, 5, false),
    ];
    assert.deepEqual(extractInFlightDelegationsAfter(entries, 0), []);
  });

  it('性能/无回溯：5 万条噪声 task-notification 文本单遍扫描 < 500ms', () => {
    // 判定器跑在同步 Stop hook 上，F227（O(N²) 候选历史）与 F231（灾难性回溯）均有 DoS 前科。
    // 通知正则 `[^<]+` 由下一个 `<` 天然止界，无嵌套量词；本用例是其线性性的回归锚点。
    const noise = `${taskNotification('agent-noise', 'toolu_noise')}\n${'<'.repeat(200)}${'x'.repeat(2000)}`;
    const entries = [userTextEntry(0, 'x')];
    for (let i = 1; i <= 50000; i += 1) entries.push(userTextEntry(i, noise));
    entries.push(assistantEntry(50001, [{ id: 'tail', name: 'Agent', input: {} }]));
    const t0 = Date.now();
    const items = extractInFlightDelegationsAfter(entries, 0);
    const cost = Date.now() - t0;
    assert.deepEqual(kinds(items), ['sync']);
    assert.ok(cost < 500, `耗时 ${cost}ms`);
  });

  it('性能/线性：5 万后台委派 × 5 万完成通知不得退化为二次扫描（< 1000ms）', () => {
    // 后台委派数与通知数**各自独立增长**，逐条 Array.some 会构成 O(委派数 × 通知数)——
    // 20MB transcript 上限下两者都可达 10^5 量级，二次扫描足以让同步 Stop hook 挂死
    // （F227 已有 O(N²) 候选历史导致 11.8s 阻塞的前科）。本用例是该线性性的回归锚点。
    //
    // N 的取值经实测校准：把 Set 查表换回 `Array.some` 后本用例必须变红才算真守卫——
    // N=2 万时二次实现耗时 ~0.76s 仍在 1s 预算内（守不住），N=5 万时二次实现约 4-5s、
    // 线性实现约 0.1s，两侧相差一个数量级，判据才有区分力。
    const N = 50000;
    const entries = [userTextEntry(0, 'x')];
    for (let i = 1; i <= N; i += 1) {
      // ack 回执与派发同条目：有效性门槛（第 2 轮 1a）要求非错误回执，否则不计在途
      entries.push(assistantEntry(i, [{ id: `bg${i}`, name: 'Agent', input: { run_in_background: true } }], [{ toolUseId: `bg${i}` }]));
    }
    // 通知全部指向另一批 id：一条都配不上 → 强制走满全部查表，杜绝"提前命中"掩盖复杂度
    for (let i = 1; i <= N; i += 1) entries.push(userTextEntry(N + i, taskNotification(`ag${i}`, `other${i}`)));
    const t0 = Date.now();
    const items = extractInFlightDelegationsAfter(entries, 0);
    const cost = Date.now() - t0;
    assert.equal(items.length, N);
    assert.ok(cost < 1000, `耗时 ${cost}ms —— 疑似退化为二次扫描`);
  });

  it('I4 静态守卫：函数体内零 I/O（core 层纯函数契约）', () => {
    const body = extractInFlightDelegationsAfter.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/\brequire\s*\(/.test(body), false, body);
    assert.equal(/process\.env/.test(body), false, body);
  });
});

// ────────────────────────────────────────
// F256 第 2 轮 · isDeferrableMissingSet（推迟的第一道闸门：缺口必须由在途工作可关闭）
// ────────────────────────────────────────

describe('F256 R2 · isDeferrableMissingSet：只有在途工作关得掉的缺口才配推迟', () => {
  it('白名单四项逐项单独出现时均可推迟（遍历常量，防日后删项无人察觉）', () => {
    assert.deepEqual([...DEFERRABLE_MISSING_KEYS].sort(), [
      'delegation:implement',
      'delegation:noop-verify',
      'delegation:verify',
      'verification-report.md',
    ]);
    for (const key of DEFERRABLE_MISSING_KEYS) {
      assert.equal(isDeferrableMissingSet([key]), true, key);
    }
  });

  it('白名单内多项组合仍可推迟 —— 含 F254 的正样本 ["verification-report.md","delegation:verify"]', () => {
    // 🔴 这是本 Feature 的正样本（F254 16:32 stop 的真实 missing），收窄闸门不得误伤它。
    assert.equal(isDeferrableMissingSet(['verification-report.md', 'delegation:verify']), true);
    assert.equal(isDeferrableMissingSet(['delegation:implement', 'delegation:verify']), true);
  });

  it('全称而非存在：混入任一非白名单项即整体不可推迟', () => {
    // 实测 174 个不合规 fix 会话中 9 个（5.2%）的 missing 是 ["feature-dir","fix-report.md"]，
    // 这两项由主线程自己产出，子代理回收再多次也不会补上 → 推迟纯属延误。
    assert.equal(isDeferrableMissingSet(['feature-dir', 'fix-report.md']), false);
    assert.equal(isDeferrableMissingSet(['verification-report.md', 'feature-dir']), false);
    assert.equal(isDeferrableMissingSet(['delegation:verify', 'artifact:placeholder']), false);
    assert.equal(isDeferrableMissingSet(['noop:judgment-section', 'delegation:noop-verify']), false);
  });

  it('MISSING_ACTION_TEXT 的其余枚举一律不可推迟（新增枚举默认 fail-closed）', () => {
    const nonDeferrable = Object.keys(MISSING_ACTION_TEXT).filter((k) => !DEFERRABLE_MISSING_KEYS.includes(k));
    assert.ok(nonDeferrable.length > 0);
    for (const key of nonDeferrable) {
      assert.equal(isDeferrableMissingSet([key]), false, key);
    }
  });

  it('空集 / 非数组 → false（不合规必有缺口，空集属上游异常，此时不推迟）', () => {
    for (const bad of [[], null, undefined, 'verification-report.md', 123, {}]) {
      assert.equal(isDeferrableMissingSet(bad), false, String(bad));
    }
  });

  it('I4 静态守卫：纯函数零 I/O', () => {
    const body = isDeferrableMissingSet.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/process\.env/.test(body), false, body);
  });
});

// ────────────────────────────────────────
// F257 缺陷 1 · collectArtifactWriteWitnessDirs（short-name 磁盘重锚定的会话归属证据源）
// ────────────────────────────────────────

describe('F257 · collectArtifactWriteWitnessDirs：只有本会话真写过的制品才发证', () => {
  const ROOT = '/repo';
  /** 带 id 的 assistant 写入条目 */
  const write = (lineIndex, id, filePath, name = 'Write') =>
    assistantEntry(lineIndex, [{ id, name, input: { file_path: filePath } }]);
  const dirs = (entries, anchor = 0, root = ROOT) => [...collectArtifactWriteWitnessDirs(entries, anchor, root)].sort();

  it('🔴 C-1a 见证制品类**只认 fix-report.md**（与 judge 的 usable() 严格同源）', () => {
    // 第 3 轮红队 CRITICAL：制品类一旦宽于 usable()，就会出现"拿到了见证但不 usable"的目录 →
    // F227 历史兜底只挑 usable 者故不选它 → 控制流落进短名分支 → 见证成立 → 重锚定到本会话
    // 从未触碰的旧目录 → compliant:true → 合规早退 → exit 2 变 exit 0 且零审计。
    // 把 verification/verification-report.md 加回 ANCHORED_ARTIFACT_PATH_REGEX 后本用例必须转红。
    const entries = [
      userTextEntry(0, '锚点'),
      write(1, 'w1', 'specs/254-fix-alpha/fix-report.md'),
      userResultEntry(2, 'w1'),
      write(3, 'w2', 'specs/255-fix-beta/verification/verification-report.md'),
      userResultEntry(4, 'w2'),
    ];
    assert.deepEqual(dirs(entries), ['specs/254-fix-alpha'], 'verification-report.md 不得发证');
  });

  it('C-1b 锚点窗口：lineIndex <= anchor 的写入不发证（上一轮展开周期的产出不算本次）', () => {
    const entries = [
      write(0, 'w0', 'specs/254-fix-alpha/fix-report.md'),
      userResultEntry(1, 'w0'),
      userTextEntry(2, '锚点在此'),
    ];
    assert.deepEqual(dirs(entries, 2), []);
    assert.deepEqual(dirs(entries, -1), ['specs/254-fix-alpha']); // 同一份数据，窗口放开即发证
  });

  it('C-1c 非 assistant envelope 里的 tool_use 不发证（被判方只能在 assistant 侧发起工具）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      normalizeTranscriptEntry({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'specs/254-fix-alpha/fix-report.md' } }] },
      }, 1, false),
      userResultEntry(2, 'w1'),
    ];
    assert.deepEqual(dirs(entries), []);
  });

  it('C-1d 回执缺席 / is_error / id 不匹配 / id 为空 一律不发证（fail-closed）', () => {
    const noReceipt = [userTextEntry(0, 'x'), write(1, 'w1', 'specs/254-fix-alpha/fix-report.md')];
    assert.deepEqual(dirs(noReceipt), [], '无回执 = 写入未被受理 / transcript 被截断，同向 fail-closed');

    const errored = [...noReceipt, userResultEntry(2, 'w1', true)];
    assert.deepEqual(dirs(errored), []);

    const mismatched = [...noReceipt, userResultEntry(2, 'other-id')];
    assert.deepEqual(dirs(mismatched), []);

    const emptyId = [
      userTextEntry(0, 'x'),
      write(1, '', 'specs/254-fix-alpha/fix-report.md'),
      userResultEntry(2, ''),
    ];
    assert.deepEqual(dirs(emptyId), [], 'id 为空串时无法可信配对');
  });

  it('C-1d2 🔴 W-A3：同一 tool_use id 的**全部**回执均非 error 才发证（id 复用击穿配对）', () => {
    // 攻击形态：Write(目标制品, id=X) 得 is_error:true → 任意无关工具复用 id=X 得成功回执。
    // 判据若写成"存在某条非 error 回执"，此处即凭空发证。
    const entries = [
      userTextEntry(0, 'x'),
      write(1, 'dup', 'specs/254-fix-alpha/fix-report.md'),
      userResultEntry(2, 'dup', true),   // Write 本身失败
      userResultEntry(3, 'dup', false),  // 无关工具复用同 id 拿到成功回执
    ];
    assert.deepEqual(dirs(entries), []);
    // 顺序反转同样不发证（Map 后写覆盖式实现会在此变红）
    const reversed = [userTextEntry(0, 'x'), write(1, 'dup', 'specs/254-fix-alpha/fix-report.md'), userResultEntry(2, 'dup', false), userResultEntry(3, 'dup', true)];
    assert.deepEqual(dirs(reversed), []);
  });

  it('C-1e 子串越界反例：alpha-retry 的写入只产出 alpha-retry，绝不产出 alpha', () => {
    const entries = [
      userTextEntry(0, 'x'),
      write(1, 'w1', 'specs/254-fix-alpha-retry/fix-report.md'),
      userResultEntry(2, 'w1'),
    ];
    assert.deepEqual(dirs(entries), ['specs/254-fix-alpha-retry']);
  });

  it('C-1f 路径形态 fail-closed 表：尾随斜杠 / 双斜杠 / 大写 / `..` 段 / 非制品文件一律不发证', () => {
    const cases = [
      'specs/254-fix-alpha/fix-report.md/',
      'specs//254-fix-alpha/fix-report.md',
      'Specs/254-fix-alpha/fix-report.md',
      'specs/254-fix-Alpha/fix-report.md',
      'specs/254-fix-alpha/../254-fix-beta/fix-report.md',
      'specs/254-fix-alpha/plan.md',
      'specs/254-fix-alpha/verification-report.md',
      // 🔴 第 3 轮 CRITICAL：verification-report.md 是**被核验制品**却**不是** usable() 的判据，
      // 收进见证即形成"有见证但不 usable"的白嫖面（见 C-1a）
      'specs/254-fix-alpha/verification/verification-report.md',
      'docs/specs/254-fix-alpha/fix-report.md',
      'specs/254-fix-alpha/fix-report.md ',
      '',
    ];
    for (const [i, fp] of cases.entries()) {
      const entries = [userTextEntry(0, 'x'), write(1, `w${i}`, fp), userResultEntry(2, `w${i}`)];
      assert.deepEqual(dirs(entries), [], fp);
    }
    // 前导 ./ 是唯一被接受的归一化形态
    const dotted = [userTextEntry(0, 'x'), write(1, 'wd', './specs/254-fix-alpha/fix-report.md'), userResultEntry(2, 'wd')];
    assert.deepEqual(dirs(dotted), ['specs/254-fix-alpha']);
  });

  it('C-1g 绝对路径按**分段级**前缀剥离：/repo 内命中，/repo-backup 不得命中', () => {
    const inside = [userTextEntry(0, 'x'), write(1, 'w1', '/repo/specs/254-fix-alpha/fix-report.md'), userResultEntry(2, 'w1')];
    assert.deepEqual(dirs(inside), ['specs/254-fix-alpha']);

    const backup = [userTextEntry(0, 'x'), write(1, 'w1', '/repo-backup/specs/254-fix-alpha/fix-report.md'), userResultEntry(2, 'w1')];
    assert.deepEqual(dirs(backup), [], '裸 startsWith(projectRoot) 会让此例命中');

    // projectRoot 带尾随斜杠时行为一致
    assert.deepEqual(dirs(inside, 0, '/repo/'), ['specs/254-fix-alpha']);
    // projectRoot 缺省 / 非字符串 → 绝对路径无从判断归属，不发证
    assert.deepEqual(dirs(inside, 0, null), []);
  });

  it('C-1h I-A2 纵深防御：assistant envelope 自带的 tool_result 不参与配对', () => {
    const entries = [
      userTextEntry(0, 'x'),
      // 同一条 assistant 里既发 tool_use 又自带成功 tool_result
      assistantEntry(1, [{ id: 'w1', name: 'Write', input: { file_path: 'specs/254-fix-alpha/fix-report.md' } }], [{ toolUseId: 'w1' }]),
    ];
    assert.deepEqual(dirs(entries), [], '真实回执只由 harness 写在非 assistant envelope 内');
  });

  it('C-1i I4：缺省 is_error 字段按**成功**处理（与真实 wire format 一致）', () => {
    const entries = [
      userTextEntry(0, 'x'),
      write(1, 'w1', 'specs/254-fix-alpha/fix-report.md'),
      normalizeTranscriptEntry({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] },
      }, 2, false),
    ];
    assert.deepEqual(dirs(entries), ['specs/254-fix-alpha'], '改成 is_error === false 会在此变红（大规模误阻断）');
  });

  it('C-1j 工具集合恰为 Write/Edit 且 frozen（唯一放宽点，增项必须是显式决策）', () => {
    assert.deepEqual([...ARTIFACT_WRITER_TOOL_NAMES].sort(), ['Edit', 'Write']);
    assert.equal(Object.isFrozen(ARTIFACT_WRITER_TOOL_NAMES), true);
    const read = [userTextEntry(0, 'x'), write(1, 'r1', 'specs/254-fix-alpha/fix-report.md', 'Read'), userResultEntry(2, 'r1')];
    assert.deepEqual(dirs(read), [], '读过 ≠ 写过');
    const edit = [userTextEntry(0, 'x'), write(1, 'e1', 'specs/254-fix-alpha/fix-report.md', 'Edit'), userResultEntry(2, 'e1')];
    assert.deepEqual(dirs(edit), ['specs/254-fix-alpha']);
  });

  it('C-1k 非法入参：entries 非数组 / anchor 非数字 → 不抛异常', () => {
    for (const bad of [null, undefined, 'x', 123, {}]) {
      assert.deepEqual([...collectArtifactWriteWitnessDirs(bad, 0, ROOT)], [], String(bad));
    }
    const entries = [write(0, 'w1', 'specs/254-fix-alpha/fix-report.md'), userResultEntry(1, 'w1')];
    assert.deepEqual([...collectArtifactWriteWitnessDirs(entries, null, ROOT)], ['specs/254-fix-alpha'], 'anchor 非数字按 -1 处理');
  });

  it('C-1l 性能/线性：2 万条写入 + 2 万条回执单遍扫描 < 500ms（同步 Stop hook 硬约束）', () => {
    const N = 20000;
    const entries = [userTextEntry(0, 'x')];
    for (let i = 1; i <= N; i += 1) entries.push(write(i, `w${i}`, `specs/${100000 + i}-fix-alpha/fix-report.md`));
    for (let i = 1; i <= N; i += 1) entries.push(userResultEntry(N + i, `w${i}`));
    const t0 = Date.now();
    const got = collectArtifactWriteWitnessDirs(entries, 0, ROOT);
    const cost = Date.now() - t0;
    assert.equal(got.size, N);
    assert.ok(cost < 500, `耗时 ${cost}ms —— 疑似退化为二次扫描`);
  });

  it('C-1m I4 静态守卫：函数体内零 I/O（core 层纯函数契约）', () => {
    const body = collectArtifactWriteWitnessDirs.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/\brequire\s*\(/.test(body), false, body);
    assert.equal(/process\.env/.test(body), false, body);
  });
});

// ────────────────────────────────────────
// F257 缺陷 2 · countAssistantEntriesSinceEarliestFixExpansion（闸门三的单调计量源）
// ────────────────────────────────────────

describe('F257 · countAssistantEntriesSinceEarliestFixExpansion：基线必须是**最早**一次 fix 展开', () => {
  const expansion = (mode) => `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}\n请处理`;
  /** 一条普通 assistant 条目（内容无关，只贡献计数） */
  const asst = (lineIndex) => assistantEntry(lineIndex, [{ id: `t${lineIndex}`, name: 'Bash', input: { command: 'ls' } }]);
  /**
   * 判定器的实际调用形态：基线由 detectFixSkillExpansion 在**同一趟**扫描里顺带产出后传入
   * （第 3 轮 WARNING：闸门三原先自己再扫一遍 SKILL_EXPANSION_REGEX，把最坏耗时翻倍）。
   */
  const countOf = (entries) =>
    countAssistantEntriesSinceEarliestFixExpansion(entries, detectFixSkillExpansion(entries).earliestFixLineIndex);

  it('C-2a 只数「基线之后」的 assistant 条目（user / tool_result 条目不计）', () => {
    const entries = [
      asst(0),                              // 基线之前，不计
      userTextEntry(1, expansion('fix')),   // 基线
      asst(2), asst(3),
      userResultEntry(4, 't2'),             // 非 assistant，不计
      userTextEntry(5, '继续'),              // 非 assistant，不计
      asst(6),
    ];
    assert.equal(countOf(entries), 3);
  });

  it('🔴 C-2b（CRITICAL-2 守护）会话内重复展开 spec-driver-fix 不得重置计数', () => {
    // 主锚点（detectFixSkillExpansion）取的是**最晚**一次展开：agent 自己再调一次
    // Skill(spec-driver-fix) 即可把它推到末尾、令锚点后计数归零，而 isFix 仍为 true。
    // 实跑证据：攻击组每轮重展开 → 30/30 全 exit 0、锚点后计数恒 4。
    // 闸门三因此必须自己找**最早**一次 fix 展开作基线——重展开只会追加条目，不改变基线。
    const entries = [];
    let line = 0;
    for (let round = 0; round < 4; round += 1) {
      entries.push(userTextEntry(line, expansion('fix'))); line += 1;
      entries.push(asst(line)); line += 1;
      entries.push(asst(line)); line += 1;
    }
    // 主锚点在最后一次展开（line 9）之后只剩 2 条 assistant；闸门三基线在 line 0，应数满 8 条
    assert.equal(detectFixSkillExpansion(entries).anchorLineIndex, 9);
    assert.equal(countOf(entries), 8);
  });

  it('C-2c 基线只认 fix 展开：更早的 sync/plan 展开不得充当基线', () => {
    const entries = [
      userTextEntry(0, expansion('sync')),
      asst(1),                                // sync 之后、fix 之前，不计
      userTextEntry(2, expansion('fix')),
      asst(3), asst(4),
    ];
    assert.equal(countOf(entries), 2);
  });

  it('C-2d 反伪造：展开痕迹只认 user 文本块（assistant 自述不得推后基线）', () => {
    // 若接受 assistant 侧文本，被判方在会话末尾自述一句展开语即可把基线推到末尾 → 计数归零（fail-open）。
    const entries = [
      userTextEntry(0, expansion('fix')),
      asst(1), asst(2),
      normalizeTranscriptEntry({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: expansion('fix') }] },
      }, 3, false),
      asst(4),
    ];
    // line 3 那条 assistant 自述不构成基线；它自己也是一条 assistant 条目，故基线 0 之后共 4 条
    assert.equal(countOf(entries), 4);
  });

  it('C-2e 无 fix 展开痕迹 → 全量计数（方向 fail-closed：更容易触顶而非更宽松）', () => {
    const entries = [asst(0), userTextEntry(1, expansion('sync')), asst(2)];
    assert.equal(countOf(entries), 2);
  });

  it('C-2f 单调性回归钉子：对同一份 transcript 的递增前缀，计数只增不减', () => {
    const entries = [];
    let line = 0;
    for (let round = 0; round < 5; round += 1) {
      entries.push(userTextEntry(line, expansion('fix'))); line += 1;      // 每轮都重展开（攻击形态）
      entries.push(asst(line)); line += 1;
      entries.push(userResultEntry(line, `t${line - 1}`)); line += 1;
    }
    let prev = -1;
    for (let cut = 1; cut <= entries.length; cut += 1) {
      const n = countOf(entries.slice(0, cut));
      assert.ok(n >= prev, `前缀长度 ${cut} 处计数回退：${prev} → ${n}`);
      prev = n;
    }
    assert.equal(prev, 5, '5 轮各 1 条 assistant');
  });

  it('C-2g 非法入参不抛异常（判定器顶层 catch 会把异常静默转成放行）', () => {
    for (const bad of [null, undefined, 'x', 123, {}]) {
      assert.equal(countOf(bad), 0, String(bad));
    }
  });

  it('C-2h 零 I/O：函数体内不触碰 fs / process.env（core 层纯函数契约）', () => {
    const body = countAssistantEntriesSinceEarliestFixExpansion.toString();
    assert.equal(/\bfs\./.test(body), false, body);
    assert.equal(/process\.env/.test(body), false, body);
  });

  it('C-2i 性能：2 万条 entries 线性单遍 < 300ms（同步 Stop hook 硬约束）', () => {
    const entries = [userTextEntry(0, expansion('fix'))];
    for (let i = 1; i <= 20000; i += 1) entries.push(asst(i));
    const t0 = Date.now();
    const n = countOf(entries);
    const cost = Date.now() - t0;
    assert.equal(n, 20000);
    assert.ok(cost < 300, `耗时 ${cost}ms —— 疑似退化为二次扫描`);
  });

  it('🔴 C-2j 单趟不变量：本函数体内不得出现 SKILL_EXPANSION_REGEX（基线只能由入参给入）', () => {
    // 第 3 轮 WARNING 的结构性钉子：把展开扫描写回本函数即恢复"全链扫两趟"，
    // 诱饵语料下最坏耗时立刻翻倍（判定器跑在同步 Stop hook 上）。
    const body = countAssistantEntriesSinceEarliestFixExpansion.toString();
    assert.equal(/SKILL_EXPANSION_REGEX/.test(body), false, body);
    assert.equal(countAssistantEntriesSinceEarliestFixExpansion.length, 2, '基线必须是显式入参');
  });

  it('C-2k 基线缺席（未传 / null / 非数字）→ 全量计数（fail-closed：更容易触顶而非更宽松）', () => {
    const entries = [asst(0), userTextEntry(1, expansion('fix')), asst(2)];
    for (const bad of [undefined, null, 'x', {}, NaN]) {
      // NaN 是 number，`lineIndex > NaN` 恒假 → 计 0，同样偏严，不构成放宽
      const n = countAssistantEntriesSinceEarliestFixExpansion(entries, bad);
      assert.ok(n === 2 || n === 0, `基线 ${String(bad)} → ${n}（只允许更严的两种取值）`);
    }
    assert.equal(countAssistantEntriesSinceEarliestFixExpansion(entries), 2, '未传 = 基线 -1 = 全量');
  });
});

// ────────────────────────────────────────
// F257 第 3 轮 WARNING · 展开扫描的诱饵前缀性能回归锚点
// ────────────────────────────────────────

describe('F257 · SKILL_EXPANSION_REGEX 诱饵前缀形态：全链只允许扫一趟', () => {
  // 退化机理：`([^\n]+?)\/skills\/` 是惰性量词。同一**行**内重复出现 `Base directory for this skill:`
  // 诱饵前缀、且该行不含 `/skills/` 时，每个诱饵起点都要把 `[^\n]+?` 扩到行尾才放弃 → O(K×N)。
  // 真展开放在**下一行**，使任何"命中即 break"的早退在诱饵位于真展开之前时完全失效。
  //
  // 红队 A/B（8.1MB transcript / 4000 诱饵 + 末尾真展开）：改动前 10188ms → 第 2 轮实现 19785ms。
  // 本机复现（K=12000）：单趟 5006ms；第 2 轮的两趟实现 10131ms → 修复后 5025ms（第二趟 5124ms→0.1ms）。
  //
  // 本组锚点捕获的是**扫描趟数回归**（超线性倍增），不是微观性能门禁：判定器跑在同步 Stop hook 上，
  // 多一趟就是最坏耗时直接翻倍。预算按 F231/F233 分档经验取宽，避免满载 CI 假红——
  // 单趟本机 ~145ms（K=2000），预算 3000ms 留 ~20× 余量；两趟实现会翻倍，仅靠预算区分不开，
  // 故**判别力来自 C-2j 的结构钉子 + 下方"计数趟耗时相对展开趟可忽略"的比例断言**。
  const DECOYS = 2000;
  const buildEntries = () => {
    const decoyLine = `Base directory for this skill: ${'x'.repeat(80)} `.repeat(DECOYS);
    const realLine = 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix';
    const list = [userTextEntry(0, `${decoyLine}\n${realLine}\n请修复`)];
    for (let i = 1; i <= 50; i += 1) list.push(assistantEntry(i, [{ id: `t${i}`, name: 'Bash', input: { command: 'ls' } }]));
    return list;
  };

  it('🔴 计数趟不得再跑一遍展开扫描：耗时须相对展开趟可忽略（< 5%）', () => {
    const entries = buildEntries();
    const t0 = process.hrtime.bigint();
    const anchor = detectFixSkillExpansion(entries);
    const t1 = process.hrtime.bigint();
    const count = countAssistantEntriesSinceEarliestFixExpansion(entries, anchor.earliestFixLineIndex);
    const t2 = process.hrtime.bigint();
    const detectMs = Number(t1 - t0) / 1e6;
    const countMs = Number(t2 - t1) / 1e6;

    // 前提核实：诱饵形态确实让展开趟成为热点，否则本断言无判别力
    assert.equal(anchor.mode, 'fix');
    assert.equal(anchor.earliestFixLineIndex, 0);
    assert.equal(count, 50);
    assert.ok(detectMs > 5, `诱饵语料未构成热点（${detectMs.toFixed(1)}ms），本用例失去判别力`);
    assert.ok(
      countMs < detectMs * 0.05,
      `计数趟 ${countMs.toFixed(1)}ms vs 展开趟 ${detectMs.toFixed(1)}ms —— 疑似把第二遍展开扫描加回来了`,
    );
  });

  it('全链（展开趟 + 计数趟）在诱饵形态下有界，且不因诱饵数翻倍而超线性倍增', () => {
    const run = () => {
      const entries = buildEntries();
      const t0 = process.hrtime.bigint();
      const anchor = detectFixSkillExpansion(entries);
      countAssistantEntriesSinceEarliestFixExpansion(entries, anchor.earliestFixLineIndex);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const ms = run();
    assert.ok(ms < 3000, `疑似扫描趟数回归：全链耗时 ${ms.toFixed(1)}ms（预算 3000ms）`);
  });
});

// ════════════════════════════════════════
// F270 P2 · 锚点三分（reverse-census §6 / spec FR-022/023/025）
// Tests FIRST：latestFixLineIndex 尚不存在，本组先红。
// ════════════════════════════════════════

describe('F270 P2 · detectFixSkillExpansion 三量：latestFixLineIndex', () => {
  const mk = (objs) => objs.map((o, i) => normalizeTranscriptEntry(o, i, false));
  const skill = (mode) => ({
    type: 'user',
    message: { role: 'user', content: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}` },
  });
  const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

  it('只有 fix：三量同行，anchorLineIndex 语义不变', () => {
    const a = detectFixSkillExpansion(mk([skill('fix'), say('开始')]));
    assert.equal(a.anchorLineIndex, 0);
    assert.equal(a.earliestFixLineIndex, 0);
    assert.equal(a.latestFixLineIndex, 0);
  });

  it('🔴 病根 iv 核心：fix→尾部 doc，latestFix 停在 fix 行、anchor 仍推到 doc 行', () => {
    const a = detectFixSkillExpansion(mk([skill('fix'), say('修'), skill('doc')]));
    assert.equal(a.mode, 'doc', 'anchor.mode 语义保持（最晚任意展开）');
    assert.equal(a.anchorLineIndex, 2, 'anchorLineIndex 语义保持');
    assert.equal(a.earliestFixLineIndex, 0);
    assert.equal(a.latestFixLineIndex, 0, 'latestFix 不被非 fix 展开推走');
  });

  it('fix→fix→doc：latestFix 取第二次 fix，earliest 取第一次（方向不对称保持）', () => {
    const a = detectFixSkillExpansion(mk([skill('fix'), say('a'), skill('fix'), say('b'), skill('doc')]));
    assert.equal(a.earliestFixLineIndex, 0);
    assert.equal(a.latestFixLineIndex, 2);
    assert.equal(a.anchorLineIndex, 4);
  });

  it('无 fix（仅 doc）：latestFix 与 earliestFix 均 null', () => {
    const a = detectFixSkillExpansion(mk([skill('doc'), say('x')]));
    assert.equal(a.earliestFixLineIndex, null);
    assert.equal(a.latestFixLineIndex, null);
    assert.equal(a.mode, 'doc');
  });

  it('零展开：三量全 null 且 found=false', () => {
    const a = detectFixSkillExpansion(mk([say('随便')]));
    assert.equal(a.found, false);
    assert.equal(a.latestFixLineIndex, null);
  });

  it('T203 回归钉：既有 fixture 上 earliestFix/anchor 取值与改动前逐位一致', () => {
    const a = detectFixSkillExpansion(loadEntries('multi-expansion.jsonl'));
    assert.equal(a.mode, 'fix');
    assert.equal(a.anchorLineIndex, 2);
    assert.equal(a.latestFixLineIndex, 2, '最晚展开本就是 fix 时，latestFix === anchor');
  });
});

describe('F270 P2 · T204 五消费点窗口切换（core 级）', () => {
  const mk = (objs) => objs.map((o, i) => normalizeTranscriptEntry(o, i, false));
  const skill = (mode) => ({
    type: 'user',
    message: { role: 'user', content: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}` },
  });
  const delegate = (id, sub, desc) => ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Task', id, input: { subagent_type: sub, description: desc } }] },
  });

  it('🔴 fix→委派→尾部 doc：以 latestFix 为界委派仍在窗内，以 anchor 为界则被切掉', () => {
    const entries = mk([
      skill('fix'),
      delegate('toolu_D1', 'spec-driver:implement', '实施修复'),
      delegate('toolu_D2', 'spec-driver:verify', '工具链验证'),
      skill('doc'),
    ]);
    const a = detectFixSkillExpansion(entries);
    const inNewWindow = extractDelegationsAfter(entries, a.latestFixLineIndex);
    assert.equal(inNewWindow.length, 2, '新窗口（latestFix）保住 fix 阶段委派');
    const inOldWindow = extractDelegationsAfter(entries, a.anchorLineIndex);
    assert.equal(inOldWindow.length, 0, '旧窗口（anchor=doc 行）把委派全切掉——病根 iv 的误伤面实证');
  });
});

// ════════════════════════════════════════
// F270 P4 · normalizeTranscriptEntry 保留 timestamp + detectFixSkillExpansion 产 latestFixTimestamp
// （账本委派 hookTs 与 latestFix 展开的 transcript timestamp 对齐用；C-14 职责切分）
// Tests FIRST：字段尚不存在，本组先红。
// ════════════════════════════════════════

describe('F270 P4 · timestamp 透传 + latestFixTimestamp', () => {
  const mk = (objs) => objs.map((o, i) => normalizeTranscriptEntry(o, i, false));
  const skillAt = (mode, ts) => ({
    type: 'user', timestamp: ts,
    message: { role: 'user', content: `Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-${mode}` },
  });

  it('normalizeTranscriptEntry 透传顶层 timestamp（缺失→null）', () => {
    const withTs = normalizeTranscriptEntry({ type: 'user', timestamp: '2026-09-01T10:00:00.000Z', message: { role: 'user', content: 'x' } }, 0, false);
    assert.equal(withTs.timestamp, '2026-09-01T10:00:00.000Z');
    const noTs = normalizeTranscriptEntry({ type: 'user', message: { role: 'user', content: 'x' } }, 0, false);
    assert.equal(noTs.timestamp, null);
  });

  it('detectFixSkillExpansion 产出 latestFixTimestamp（最晚 fix 展开那行的 timestamp）', () => {
    const a = detectFixSkillExpansion(mk([
      skillAt('fix', '2026-09-01T10:00:00.000Z'),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] } },
      skillAt('fix', '2026-09-01T10:05:00.000Z'),
      skillAt('doc', '2026-09-01T10:10:00.000Z'),
    ]));
    assert.equal(a.latestFixLineIndex, 2);
    assert.equal(a.latestFixTimestamp, '2026-09-01T10:05:00.000Z', 'doc 展开不改 latestFix 的 ts');
  });

  it('无 fix 展开 → latestFixTimestamp null', () => {
    const a = detectFixSkillExpansion(mk([skillAt('doc', '2026-09-01T10:00:00.000Z')]));
    assert.equal(a.latestFixTimestamp, null);
  });

  it('fix 展开行无 timestamp → latestFixTimestamp null（不编造）', () => {
    const a = detectFixSkillExpansion([normalizeTranscriptEntry({ type: 'user', message: { role: 'user', content: 'Base directory for this skill: /w/plugins/spec-driver/skills/spec-driver-fix' } }, 0, false)]);
    assert.equal(a.latestFixLineIndex, 0);
    assert.equal(a.latestFixTimestamp, null);
  });
});

// ════════════════════════════════════════
// F276 卡 C1 · storage-unavailable 反馈计数器（U-1 / U-2 / U-3 / U-7）
// Tests FIRST：函数尚不存在，本组先红。
//
// 该计数器是 `!saved.ok` 分支**唯一**的放行上界（plan §1）：存储写不进时判定器一律 exit 2，
// 靠数 harness 回灌的阻断反馈条目来保证有限步内收敛。它不落盘，故 `resetBlockState` 清零语义不受影响。
// ════════════════════════════════════════

describe('F276 C1 · countStorageUnavailableBlockFeedback', () => {
  /** harness 回灌的真实形状：type/isMeta/userType 见 fixture real-stop-hook-feedback-entries.jsonl */
  const feedbackEntry = (body) => ({
    type: 'user',
    isMeta: true,
    userType: 'external',
    message: { role: 'user', content: `${HOOK_FEEDBACK_PREFIX}\n[bash /w/hooks/stop-fix-compliance-check.sh]: ${body}` },
  });
  const mk = (objs) => objs.map((o, i) => normalizeTranscriptEntry(o, i, false));
  const hit = () => feedbackEntry(`${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 阻断计数无法持久化`);

  // ── U-1：真实形状计数 + 窗口下界 ──
  it('U-1 真实形状（字符串 content 单文本块）计数正确', () => {
    const entries = mk([hit(), hit(), hit()]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 3);
  });

  it('U-1 lineIndex <= baseline 的条目不计（窗口下界是 latestFixLineIndex）', () => {
    // 0,1 在基线之前/之上；2,3 在基线之后
    const entries = mk([hit(), hit(), hit(), hit()]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, 1), 2);
    assert.equal(countStorageUnavailableBlockFeedback(entries, 3), 0);
  });

  // ── U-2：反例集 ──
  it('U-2 assistant 角色即便正文含 token 也不计（反伪造：被判方产出面不得投喂计数器）', () => {
    const entries = mk([{
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: `${HOOK_FEEDBACK_PREFIX}\n${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 我自己写的` }] },
    }]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  it('U-2 两个文本块（数组 content）不计——harness 回灌恒为单块', () => {
    const entries = mk([{
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: `${HOOK_FEEDBACK_PREFIX}\n${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 第一块` },
          { type: 'text', text: '第二块' },
        ],
      },
    }]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  it('U-2 首行不是 Stop hook feedback: 但正文含 token → 不计', () => {
    const entries = mk([{
      type: 'user',
      message: { role: 'user', content: `请看这段：${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 存储不可用` },
    }]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  it('U-2 普通 [FIX-COMPLIANCE] 阻断反馈（无 token）→ 不计', () => {
    const entries = mk([feedbackEntry('[FIX-COMPLIANCE] 请补齐 fix-report.md')]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  it('U-2 tool_result 型 user 条目（textBlocks 为空）→ 不计', () => {
    const entries = mk([{
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: `${HOOK_FEEDBACK_PREFIX}\n${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN}` }],
      },
    }]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  // ── U-3：token 不被既有前缀误匹配 + startsWith 条件的承重性 ──
  it('U-3 token 不是 PREFIX_BLOCK/WARN/DEGRADED 任一渲染串的子串', () => {
    // 三条渲染前缀与 fix-compliance-judge.mjs:58-60 逐字对应（core 侧无法 import 私有常量，故字面镜像）。
    // 它们后接空格，token 后接 [STORAGE-UNAVAILABLE]，故互不包含——否则正常阻断 stderr 会白喂计数器。
    for (const prefix of ['[FIX-COMPLIANCE]', '[FIX-COMPLIANCE][WARN]', '[FIX-COMPLIANCE][GATE-DEGRADED]']) {
      assert.equal(`${prefix} 请补齐制品`.includes(STORAGE_UNAVAILABLE_FEEDBACK_TOKEN), false, prefix);
    }
  });

  // 🔴 startsWith 条件是承重项，不是防御性冗余（plan §5 U-3 / R5-14）：
  // 技能展开注入的 user 单文本块恒以 `Base directory for this skill:` 起头（本机实测），
  // 故被判方在自写 SKILL 正文里原样抄进 token，那段文本**永远不在 offset 0** ⟹ startsWith 必假。
  // 换成 includes(PREFIX) 即失去这一层：被判方在自写 SKILL 里塞 `Stop hook feedback:` 就能投喂计数器。
  //
  // 形态稳定性一手实证（plan §5 R6-6，P-1 用例已砍，实证改由本注释承载）：
  // 子代理实扫本机 324 份 jsonl / 44174 行 / 1.8s，横跨六个 harness 版本 2.1.219 → 2.1.247，
  // 命中谓词的条目形态 29/29 一致（单文本块 + `Stop hook feedback:` 起头）。
  // ⚠️ 这说明形态在可观测版本跨度内稳定，**不是**形态永不漂移的保证；漂移无自动可发现性（R7-10）。
  //
  // 触发面附记（plan §5 R6-14）：两级默认状态路径 `.specify/runs/.fix-compliance-state` 与
  // `$TMPDIR/spec-driver-fix-compliance` **均在被判方写域**，`touch` 出同名文件占位即可造出两级不可写，
  // **不需要 env 注入**；测试里用 SPEC_DRIVER_FIX_COMPLIANCE_STATE_TMP 只是复现手段。
  it('U-3 skill 展开条目（首块以 Base directory for this skill: 起头）正文含 token → 计 0', () => {
    const entries = mk([{
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [{
          type: 'text',
          text: `Base directory for this skill: /w/superpowers/skills/brainstorming\n${HOOK_FEEDBACK_PREFIX}\n${STORAGE_UNAVAILABLE_FEEDBACK_TOKEN} 注入正文`,
        }],
      },
    }]);
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 0);
  });

  // ── U-7：基线缺席方向（🔴 与 countAssistantEntriesSinceEarliestFixExpansion 相反，不得照抄 -1）──
  // 本计数器的 -1 基线 ⟹ 全量计数 ⟹ 更容易触顶 ⟹ **放行方向**，故基线缺席必须取 0（fail-closed）。
  // 🔴 当前生产不可达（isFix ⟺ latestFixLineIndex ≠ null，四个 verdict:null 早退点都在 routeBlock 之前），
  // 本条是**前瞻钉**：把纯函数的方向合同钉死，防后续卡新增调用点时照抄错方向。不得因"当前不可达"删掉。
  // 与 P-2 的分工：U-7 只管 null/undefined/非数字 ⟹ 0；数字基线（含 -1）⟹ 计其后条目由 P-2 钉。
  it('U-7 基线缺席（null/undefined/非数字）→ 一律返回 0，不是 -1 全量计数', () => {
    const entries = mk(Array.from({ length: 10 }, () => hit()));
    assert.equal(countStorageUnavailableBlockFeedback(entries, -1), 10, '前置：数字基线下确实有 10 条命中');
    assert.equal(countStorageUnavailableBlockFeedback(entries, null), 0);
    assert.equal(countStorageUnavailableBlockFeedback(entries), 0);
    assert.equal(countStorageUnavailableBlockFeedback(entries, 'x'), 0);
    assert.equal(countStorageUnavailableBlockFeedback(entries, NaN), 0);
  });

  it('非数组 entries → 0（与既有计数器同容错口径）', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      assert.equal(countStorageUnavailableBlockFeedback(bad, -1), 0, String(bad));
    }
  });
});
