/**
 * F287 卡 A（P0-A 残余卡 A）— G0 诊断码 canonical 表 + userFacing 可见面 / G3 PENDING 纯可观测量 /
 * G4 snapshot 三态专码 / K-1 入口守卫收敛。红先行：实现缺失时 import 失败即为红。
 *
 * 门禁类改动：每条断言都写"变异后应红"的方向（见 specs/287-…/plan.md 变异清单）。
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  JUDGE_DIAGNOSTICS, USER_FACING_DIAGNOSTIC_CODES, buildFeedbackText,
} from '../scripts/fix-compliance-judge.mjs';
import {
  ARTIFACT_DIAGNOSTICS, PENDING_MARK_REGEX, countPendingSections, PENDING_SCAN_MAX_CHARS,
  SNAPSHOT_STATES, buildAssistantTextSet, classifySnapshotMessage, normalizeTranscriptEntry,
  judgeCompliance, DEFERRABLE_MISSING_KEYS, FOREIGN_DIALECT_DIAGNOSTICS,
} from '../scripts/lib/fix-compliance-core.mjs';
import { STATE_STORAGE_DIAGNOSTICS, IO_DIAGNOSTICS } from '../scripts/lib/fix-compliance-io.mjs';
import { LEDGER_DIAGNOSTICS } from '../scripts/lib/ledger-reader.mjs';
import { IN_FLIGHT_DIAGNOSTICS, IN_FLIGHT_STATES } from '../scripts/lib/in-flight-verdict.mjs';
import { JUDGE_FILE_SET } from '../scripts/lib/judge-snapshot-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../scripts/fix-compliance-judge.mjs');
const JUDGE_SRC = fs.readFileSync(CLI, 'utf8');
const SCHEMA_PATH = path.resolve(HERE, '../../../specs/208-fix-mode-process-compliance/contracts/fix-compliance-verdict-event.schema.json');
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const SCHEMA_ENUM = new Set(SCHEMA.properties.diagnostics.items.enum);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f287-card-a-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ── 语料构造（与 judge-cli 测试同形：fix 展开 + Write fix-report + 委派）──
const SKILL_EXPANSION_LINE = { type: 'user', message: { role: 'user', content: '<command-name>/spec-driver:spec-driver-fix</command-name>\nBase directory for this skill: /x/plugins/spec-driver/skills/spec-driver-fix' } };
const ASSISTANT_TEXT = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const TOOL_USE = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const REPAIR_FIX_REPORT = '# 修复报告\n\n**Root Cause**: 会话超时阈值配置错误导致提前登出，已定位到 config 常量并修正。\n';

let seq = 0;
function stageRoot() {
  const root = path.join(tmp, `root-${++seq}`);
  fs.mkdirSync(path.join(root, 'specs', '301-fix-sample-bug', 'verification'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '301-fix-sample-bug', 'fix-report.md'), REPAIR_FIX_REPORT);
  return root;
}
function writeTranscript(root, lines) {
  const p = path.join(root, `t-${++seq}.jsonl`);
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return p;
}
/** 不合规（缺 verification-report + 委派）语料，末条 assistant 为文本 */
function nonCompliantTranscript(root, lastText = '最后一条助手文本\n第二行') {
  return writeTranscript(root, [
    SKILL_EXPANSION_LINE,
    TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
    ASSISTANT_TEXT(lastText),
  ]);
}
function runHook(root, transcriptPath, { sessionId = 's', extra = {} } = {}) {
  const payload = { session_id: sessionId, transcript_path: transcriptPath, stop_hook_active: false, ...extra };
  const res = spawnSync('node', [CLI, '--mode', 'hook', '--project-root', root], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { status: res.status, stderr: res.stderr, stdout: res.stdout };
}
function readEvents(root) {
  const dir = path.join(root, '.specify', 'runs');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.eventType === 'fix-compliance-verdict') out.push(e);
    }
  }
  return out;
}
function readState(root, sessionId) {
  const p = path.join(root, '.specify', 'runs', '.fix-compliance-state', `${sessionId}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
const counters = (st) => (st ? [st.blockCount, st.nonBlockStopCount, st.inFlightDeferCount] : null);

// ════════════════════════════════════════════
// G0 · canonical 表 + userFacing
// ════════════════════════════════════════════
describe('F287 G0 · JUDGE_DIAGNOSTICS canonical 表', () => {
  it('T0-U1 表冻结且非空；每条目冻结、含 code 与布尔 userFacing（零缺键）', () => {
    assert.ok(Object.isFrozen(JUDGE_DIAGNOSTICS));
    const entries = Object.values(JUDGE_DIAGNOSTICS);
    assert.ok(entries.length > 0, '空表守卫：守卫不得空转');
    for (const e of entries) {
      assert.ok(Object.isFrozen(e));
      assert.equal(typeof e.code, 'string');
      assert.equal(typeof e.userFacing, 'boolean', `${e.code} 缺 userFacing 键 = 落进未定义态`);
    }
  });

  it('T0-U2 正向：judge / core / io / ledger / in-flight 六张表的码集合 ⊆ verdict-event schema enum（抓「加新码漏登记」方向）', () => {
    const all = [
      ...Object.values(JUDGE_DIAGNOSTICS).map((e) => e.code),
      ...Object.values(ARTIFACT_DIAGNOSTICS),
      ...Object.values(STATE_STORAGE_DIAGNOSTICS),
      ...Object.values(IO_DIAGNOSTICS),
      ...Object.values(LEDGER_DIAGNOSTICS),
      ...Object.values(IN_FLIGHT_DIAGNOSTICS),
      ...Object.values(FOREIGN_DIALECT_DIAGNOSTICS),
    ];
    for (const code of all) assert.ok(SCHEMA_ENUM.has(code), `码 ${code} 未登记进 schema enum`);
  });

  it('T0-U3 反向：judge 表内每个码在 judge 源码中确有产出点（引用形态 JUDGE_DIAGNOSTICS.<key>.code），防登记死码', () => {
    for (const [key, e] of Object.entries(JUDGE_DIAGNOSTICS)) {
      const refs = JUDGE_SRC.split(`JUDGE_DIAGNOSTICS.${key}.code`).length - 1;
      assert.ok(refs >= 1, `${e.code}（${key}）在 judge 源码里没有产出点`);
    }
  });

  it('T0-U6 反向守卫（F290）：schema enum 每个码在 scripts/**/*.mjs 有 ≥1 **真实产出点**（形态①`表.键` / ②表的 key 级动态下标 / ③别名的非声明性引用），零产出码须在显式 allowlist 内且 allowlist 不得陈旧', () => {
    const SCRIPTS_ROOT = path.resolve(HERE, '../scripts');
    const sources = [];
    (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.isFile() && p.endsWith('.mjs')) sources.push(fs.readFileSync(p, 'utf8')); } })(SCRIPTS_ROOT);
    // 🔴 verify CRITICAL-新1：原 `^\s*\/\/.*$` 只剥**整行**注释，行尾注释（`code(); // 提及 表.键`）完全不剥
    //    ⟹ 删掉真实产出点后顺手留一句行尾说明即可让守卫恢复绿（实测假阴性）。本仓行尾注释是主流写法。
    //    改用状态机整体剥离（行注释 + 块注释），并在 code 态处理 `\` 转义——否则 `/^https?:\/\//` 这类
    //    正则字面量的 `\/\/` 会被误判成行注释起点而过剥（过剥方向是 fail-loud 误报，仍由下方自检兜住）。
    const stripComments = (src) => {
      let out = ''; let i = 0; let mode = 'code';
      while (i < src.length) {
        const c = src[i]; const c2 = src[i + 1];
        if (mode === 'code') {
          if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
          if (c === '/' && c2 === '/') { mode = 'line'; i += 2; continue; }
          if (c === '/' && c2 === '*') { mode = 'block'; i += 2; continue; }
          if (c === "'" || c === '"' || c === '`') { mode = c; out += c; i += 1; continue; }
          out += c; i += 1; continue;
        }
        if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
        if (mode === 'block') { if (c === '*' && c2 === '/') { mode = 'code'; i += 2; } else { if (c === '\n') out += c; i += 1; } continue; }
        // 字符串 / 模板态
        if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
        if (c === mode) { mode = 'code'; out += c; i += 1; continue; }
        out += c; i += 1;
      }
      return out;
    };
    const corpus = sources.map(stripComments).join('\n');
    // 剥离器过剥自检（fail-loud）：几个已知真实产出点在剥离后必须仍在，否则是剥离器吃了真代码
    for (const probe of ['JUDGE_DIAGNOSTICS.internalError.code', 'STATE_STORAGE_DIAGNOSTICS.lockTakenOver', 'IN_FLIGHT_DIAGNOSTICS[IN_FLIGHT_STATES.UNDETERMINED]']) {
      assert.ok(corpus.includes(probe), `剥注释过剥：已知真实产出点 ${probe} 在剥离后消失`);
    }
    const count = (needle) => corpus.split(needle).length - 1;
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ALLOWLIST_ZERO_PRODUCER = new Set(['nonblock-storage-unavailable', 'parse-timeout']);
    const tables = {
      JUDGE_DIAGNOSTICS: Object.fromEntries(Object.entries(JUDGE_DIAGNOSTICS).map(([k, v]) => [k, v.code])),
      ARTIFACT_DIAGNOSTICS, STATE_STORAGE_DIAGNOSTICS, IO_DIAGNOSTICS, LEDGER_DIAGNOSTICS, IN_FLIGHT_DIAGNOSTICS, FOREIGN_DIALECT_DIAGNOSTICS,
    };
    const KEY_LEVEL = { IN_FLIGHT_DIAGNOSTICS: { constName: 'IN_FLIGHT_STATES', values: IN_FLIGHT_STATES } };
    const TABLE_LEVEL_ONLY = new Set(['FOREIGN_DIALECT_DIAGNOSTICS']);
    const codeToEntry = new Map();
    for (const [table, obj] of Object.entries(tables)) for (const [key, code] of Object.entries(obj)) codeToEntry.set(code, { table, key });
    /** 形态③：别名的**非声明性**引用数（剔除定义行 / 纯表登记行 `key: ALIAS` / import·export 说明符行）
     *  🔴 verify CRITICAL-新2：原判据只要标识符出现 ≥2 次即算「有产出」，而「定义 + 登记进表」这两处
     *  纯声明性引用天然就有 2 次 ⟹ 把该码从所有真实 push/emit 逻辑里删干净仍判绿（实测，受影响面 =
     *  整个 LEDGER_DIAGNOSTICS 表）。现要求剔除声明性引用后仍 ≥1。 */
    const nonDeclarativeRefs = (alias, code) => corpus.split('\n').filter((line) => {
      if (!new RegExp(`\\b${alias}\\b`).test(line)) return false;
      if (new RegExp(`export\\s+const\\s+${alias}\\s*=`).test(line)) return false;            // 定义
      if (new RegExp(`^\\s*[\\w$]+\\s*:\\s*${alias}\\s*,?\\s*$`).test(line)) return false;     // 纯表登记
      if (/^\s*import\b.*\bfrom\b/.test(line) || /^\s*export\s*\{/.test(line)) return false;   // 说明符
      return true;
    }).length;
    const producedBy = ({ table, key }, code) => {
      if (/^[A-Za-z_$][\w$]*$/.test(key) && count(`${table}.${key}`) >= 1) return `${table}.${key}`;
      const kl = KEY_LEVEL[table];
      if (kl) {
        const constKey = Object.keys(kl.values).find((k) => kl.values[k] === key);
        if (constKey && count(`${table}[${kl.constName}.${constKey}]`) >= 1) return `${table}[${kl.constName}.${constKey}]`;
      } else if (TABLE_LEVEL_ONLY.has(table) && count(`${table}[`) >= 1) {
        return `${table}[…] 表级证据（运行时键控，key 级静态证据不可得——K-4 已登记）`;
      }
      const alias = corpus.match(new RegExp(`export const (\\w+) = '${escapeRe(code)}'`));
      if (alias && nonDeclarativeRefs(alias[1], code) >= 1) return `常量 ${alias[1]}（非声明性引用 ${nonDeclarativeRefs(alias[1], code)} 处）`;
      return null;
    };
    const problems = [];
    for (const code of SCHEMA_ENUM) {
      const entry = codeToEntry.get(code);
      if (!entry) {
        if (!ALLOWLIST_ZERO_PRODUCER.has(code)) { problems.push(`${code}: 已入 schema enum 但不在任何码表且不在 allowlist`); continue; }
        const literalRefs = count(`'${code}'`) + count(`"${code}"`);
        if (literalRefs > 0) problems.push(`${code} 已在源码出现字面量产出点（${literalRefs} 处），allowlist 陈旧须删`);
        continue;
      }
      const via = producedBy(entry, code);
      if (!via && !ALLOWLIST_ZERO_PRODUCER.has(code)) problems.push(`${code}（${entry.table}.${entry.key}）零真实产出点且不在 allowlist`);
      if (via && ALLOWLIST_ZERO_PRODUCER.has(code)) problems.push(`${code} 已有产出点（${via}），allowlist 陈旧须删`);
    }
    assert.deepEqual(problems, [], problems.join('\n'));
  });

  it('T0-U4 反裸字面量：judge 源码中诊断码字面量只出现在表定义块内（产出点零裸字面量、零模板串拼接）', () => {
    const tableStart = JUDGE_SRC.indexOf('export const JUDGE_DIAGNOSTICS');
    const tableEnd = JUDGE_SRC.indexOf('});', tableStart) + 3;
    assert.ok(tableStart > 0 && tableEnd > tableStart);
    // 剥掉注释（JSDoc 里用反引号提及码名是合法的），再抓单引号 / 双引号 / 反引号三种引号形态与**短前缀**
    // （绕过面 W-2：双引号字面量与 'delegation-' + 'in-flight' 拼接在旧正则下全绿）
    const outside = (JUDGE_SRC.slice(0, tableStart) + JUDGE_SRC.slice(tableEnd))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const lit = /(["'`])(transcript-|feature-dir-|state-|nonblock-|delegation-|stop-hook-|payload-|internal-|snapshot-|storage-|verification-report-)[a-z-]*\1/g;
    const hits = outside.match(lit) || [];
    assert.deepEqual(hits, [], `表外仍有裸诊断码字面量：${hits.join(', ')}`);
    assert.equal(/`(transcript|snapshot|state|delegation)-\$\{/.test(JUDGE_SRC), false, '模板串拼接会绕过合同 enum 守卫');
  });

  it('T0-U5 userFacing：本卡新增 3 码全为不可见；可见码全集 = 改动前可达 buildFeedbackText 的 11 个码（差集逐条点名 = 仅新码）', () => {
    for (const key of ['snapshotMessageAbsent', 'snapshotStale']) {
      assert.equal(JUDGE_DIAGNOSTICS[key].userFacing, false, `${key} 必须不可见`);
    }
    assert.ok(!USER_FACING_DIAGNOSTIC_CODES.includes(ARTIFACT_DIAGNOSTICS.verificationReportPending));
    const expected = [
      'stop-hook-reentry', 'delegation-in-flight', 'delegation-in-flight-budget-exhausted',
      'delegation-in-flight-entry-budget-exhausted', 'storage-unavailable-block-budget-exhausted',
      'state-storage-unavailable', 'in-flight-undetermined',
      // ledger 四码写死字面量：与实现同源派生（...Object.values(LEDGER_DIAGNOSTICS)）会让上游加码静默进可见面（绕过面 W-3）
      'ledger-entry-conflict', 'ledger-agent-id-inversion-suspected', 'ledger-window-undetermined', 'ledger-supplemented-role',
    ].sort();
    assert.deepEqual([...USER_FACING_DIAGNOSTIC_CODES].sort(), expected, '可见面集合变动必须在此逐条点名');
    assert.ok(Object.isFrozen(USER_FACING_DIAGNOSTIC_CODES));
  });

  it('T0-E2 渲染面双向钉：可见码进 stderr 文案，不可见码被过滤（防过滤器恒真 / 恒假）', () => {
    const shown = buildFeedbackText(['verification-report.md'], { diagnostics: ['stop-hook-reentry'] });
    assert.ok(shown.includes('诊断: stop-hook-reentry'));
    const hidden = buildFeedbackText(['verification-report.md'], { diagnostics: ['snapshot-stale', 'snapshot-message-absent', 'verification-report-pending'] });
    assert.ok(!hidden.includes('snapshot-'), '不可见码不得进用户文案');
    assert.ok(!hidden.includes('verification-report-pending'));
    assert.ok(!hidden.includes('诊断:'), '全部被过滤时不得留下空的「诊断:」行');
    const mixed = buildFeedbackText([], { diagnostics: ['snapshot-stale', 'delegation-in-flight'] });
    assert.ok(mixed.includes('诊断: delegation-in-flight') && !mixed.includes('snapshot-stale'));
  });
});

// ════════════════════════════════════════════
// G3 · PENDING 纯可观测量
// ════════════════════════════════════════════
describe('F287 G3 · verification-report PENDING 计数（不改判）', () => {
  it('T3-U1 四种真实形态各计 1 节；同节多行只计 1；标题行本身不计；R2-13 词法（(?<!等)待用户）', () => {
    const doc = [
      '# 报告', '前言无标记',
      '## A 表格', '| T038 | 手工计时 | ⚠️ MANUAL-PENDING |', '| T039 | 桌面 | 🔴 MANUAL-PENDING |',
      '## B checkbox', '- [ ] rebase（待用户授权后执行）',
      '## C emoji', '- ⏸️ 未 push（等用户决策）',
      '## D 加粗', '**标注：PENDING-user**',
      '## E 交付散文', '等待用户确认后 push（本行不该计）',
      '## F DEFERRED 标题', '正文无标记',
      '## G [DEFERRED-TO-API]', '- FR-022（[DEFERRED-TO-API-KEY-AVAILABLE]）',
      '## H 围栏', '```bash', '# 1. 跑前确保 PENDING 不算', 'echo DEFERRED', '```', '正文无标记',
      '## I 围栏后同节多行', '第一行 PENDING', '```', '# 假标题不切节', '```', '第二行 待回填（同节只计 1）',
    ].join('\n');
    assert.equal(countPendingSections(doc), 6);
    assert.equal(PENDING_MARK_REGEX.test('等待用户拍板'), false);
    assert.equal(PENDING_MARK_REGEX.test('留待用户决定'), true);
    assert.equal(PENDING_MARK_REGEX.test('⏸ 裸暂停符'), true);
    assert.equal(PENDING_MARK_REGEX.test('DEPENDING ON'), false, '\\b 边界：不误计 DEPENDING');
    assert.equal(countPendingSections(''), 0);
    assert.equal(countPendingSections('无标题正文 PENDING'), 1, '前言也是一节');
  });

  it('T3-U1b 未闭合围栏自开栏起按正文计（F228 同口径）；标记只在标题计 0；超限返回 null', () => {
    assert.equal(countPendingSections('## a\n```\nPENDING 在未闭合围栏里\n'), 1, '未闭合围栏 ⇒ 反掩码（否则后半篇整段吞成 0 且零诊断）');
    assert.equal(countPendingSections('## a\n```\nPENDING 在闭合围栏里\n```\n'), 0, '闭合围栏内不计');
    assert.equal(countPendingSections('## 命令输出\n```\n$ npm test\n## 项 A\n- MANUAL-PENDING x\n## 项 B\n- DEFERRED y\n'), 2, '漏关围栏后的两节仍计');
    assert.equal(countPendingSections('## MANUAL-PENDING 清单\n- 无\n'), 0, '标记只在标题行 ⇒ 0');
    assert.equal(countPendingSections('# r\n' + 'x'.repeat(PENDING_SCAN_MAX_CHARS + 1)), null, '超限未计 → null');
    assert.equal(countPendingSections('# r\n' + 'PENDING\n'.repeat(1000)), 1, '同节千行只计 1');
  });

  it('T3-U2 判据未变：judgeCompliance 收到 content 后 verification-report 判据仍是 exists && nonEmpty；pendingSectionCount 只是可观测量', () => {
    const base = {
      delegations: [{ roleClass: 'implement' }, { roleClass: 'verify' }],
      featureDir: { path: 'specs/301-fix-x', existsOnDisk: true },
      fixReport: { exists: true, content: REPAIR_FIX_REPORT },
      enforcement: 'block', configDegraded: false, diagnostics: [],
    };
    const pending = judgeCompliance({ ...base, verificationReport: { exists: true, nonEmpty: true, content: '# r\n## a\nPENDING-user\n## b\nDEFERRED\n## c\nPENDING' } });
    const clean = judgeCompliance({ ...base, verificationReport: { exists: true, nonEmpty: true, content: '# r\n全部通过' } });
    assert.equal(pending.compliant, true); assert.equal(clean.compliant, true);
    assert.deepEqual(pending.missing, clean.missing);
    assert.equal(pending.pendingSectionCount, 3); assert.equal(clean.pendingSectionCount, 0);
    assert.ok(pending.diagnostics.includes(ARTIFACT_DIAGNOSTICS.verificationReportPending));
    assert.ok(!clean.diagnostics.includes(ARTIFACT_DIAGNOSTICS.verificationReportPending));
    const absent = judgeCompliance({ ...base, verificationReport: { exists: false, nonEmpty: false, content: null } });
    assert.equal(absent.pendingSectionCount, null);
    assert.ok(absent.missing.includes('verification-report.md'));
    const blank = judgeCompliance({ ...base, verificationReport: { exists: true, nonEmpty: false, content: '   \n' } });
    assert.equal(blank.pendingSectionCount, null, '存在但空 → null（判定侧同按缺席计 missing；误伤面 W4）');
    assert.ok(blank.missing.includes('verification-report.md'));
    const huge = judgeCompliance({ ...base, verificationReport: { exists: true, nonEmpty: true, content: '# r\n' + 'x'.repeat(PENDING_SCAN_MAX_CHARS + 1) } });
    assert.equal(huge.pendingSectionCount, null, '超限未计 → null，不改判');
    assert.equal(huge.compliant, true);
    assert.ok(!huge.diagnostics.includes(ARTIFACT_DIAGNOSTICS.verificationReportPending));
  });

  it('T3-E4 合规 + PENDING 语料（委派齐全、制品齐备）：exit 0 / compliant:true / pendingSectionCount>0——把「不改判」钉在合规侧（绕过面 W-4：M3-b 只红单元）', () => {
    const root = stageRoot();
    fs.writeFileSync(path.join(root, 'specs', '301-fix-sample-bug', 'verification', 'verification-report.md'),
      '# 验证报告\n总体 PASS\n## SC-3\n- MANUAL-PENDING 待用户本地确认\n');
    const t = writeTranscript(root, [
      SKILL_EXPANSION_LINE,
      TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:implement', description: '执行代码实现' }),
      TOOL_USE('Agent', { subagent_type: 'spec-driver:verify', description: '验证修复结果' }),
      ASSISTANT_TEXT('尾'),
    ]);
    const r = runHook(root, t, { sessionId: 'g3-compliant-pending', extra: { last_assistant_message: '尾' } });
    assert.equal(r.status, 0, `合规语料应放行：${r.stderr}`);
    const evs = readEvents(root);
    assert.equal(evs.length, 1);
    assert.equal(evs[0].compliant, true, JSON.stringify(evs[0]));
    assert.equal(evs[0].pendingSectionCount, 1);
    assert.ok(evs[0].diagnostics.includes('verification-report-pending'));
    assert.ok(!r.stderr.includes('verification-report-pending') && !r.stderr.includes('PENDING'));
  });

  it('T3-U3/U4 冻结面逐字节钉：DEFERRABLE_MISSING_KEYS 未偷偷加键（FR-031 裁剪连锁）', () => {
    assert.deepEqual([...DEFERRABLE_MISSING_KEYS], ['delegation:implement', 'delegation:verify', 'delegation:noop-verify', 'verification-report.md']);
    const coreSrc = fs.readFileSync(path.resolve(HERE, '../scripts/lib/fix-compliance-core.mjs'), 'utf8');
    assert.ok(coreSrc.includes('const ANCHORED_ARTIFACT_PATH_REGEX = /^(specs\\/\\d+-fix-[a-z0-9-]+)\\/fix-report\\.md$/;'), '见证侧只查 fix-report.md 的不对称不得触碰（R-8）');
  });

  it('T3-E2/E3 端到端：3 节 PENDING ⟹ 审计 pendingSectionCount===3 + verification-report-pending；0/3/99 节退出码与三计数器完全相同；码不进 stderr', () => {
    const results = {};
    for (const [label, sections] of [['zero', 0], ['three', 3], ['many', 99]]) {
      const root = stageRoot();
      // 交付散文行：`(?<!等)` 排除面——M3-c（去掉负向后顾）在此处会让 zero 组多计 1 节（绕过面 W-4）
      const body = ['# 验证报告', '总体 PASS', '等待用户确认后再 push。'];
      for (let i = 0; i < sections; i++) body.push(`## 项 ${i}`, `- MANUAL-PENDING 待回填 ${i}`);
      fs.writeFileSync(path.join(root, 'specs', '301-fix-sample-bug', 'verification', 'verification-report.md'), body.join('\n') + '\n');
      // 缺委派 ⟹ 不合规 ⟹ block ⟹ 审计事件必写
      const t = nonCompliantTranscript(root);
      const r = runHook(root, t, { sessionId: `g3-${label}` });
      const evs = readEvents(root);
      assert.equal(evs.length, 1, `${label}: 期望 1 条审计`);
      results[label] = { status: r.status, counters: counters(readState(root, `g3-${label}`)), ev: evs[0], stderr: r.stderr };
    }
    assert.equal(results.three.ev.pendingSectionCount, 3);
    assert.ok(results.three.ev.diagnostics.includes('verification-report-pending'));
    assert.equal(results.zero.ev.pendingSectionCount, 0);
    assert.ok(!results.zero.ev.diagnostics.includes('verification-report-pending'));
    assert.equal(results.many.ev.pendingSectionCount, 99);
    // 不改判钉
    assert.equal(results.zero.status, results.three.status);
    assert.equal(results.three.status, results.many.status);
    assert.deepEqual(results.zero.counters, results.three.counters);
    assert.deepEqual(results.three.counters, results.many.counters);
    assert.deepEqual(results.zero.ev.missing, results.three.ev.missing);
    for (const r of Object.values(results)) assert.ok(!r.stderr.includes('verification-report-pending'), '纯可观测码不得进用户 stderr');
  });
});

// ════════════════════════════════════════════
// G4 · snapshot 三态专码
// ════════════════════════════════════════════
describe('F287 G4 · last_assistant_message 快照交叉校验（纯诊断码）', () => {
  it('T4-U1/U2 集合归属：join("\\n").trim() 含换行的条目命中；值来自更早消息（末条无 text 块）仍命中；裸子串不算', () => {
    // 输入是归一化后的条目（与判定器其它 transcript 判据同形态）
    const entries = [
      ASSISTANT_TEXT('第一段\n第二段'),
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '多块 A' }, { type: 'text', text: '多块 B' }] } },
      TOOL_USE('Read', { file_path: 'x' }), // 末条无 text 块
      { type: 'user', message: { role: 'user', content: '用户文本' } },
    ].map((raw, i) => normalizeTranscriptEntry(raw, i, false));
    const set = buildAssistantTextSet(entries);
    assert.ok(set.has('第一段\n第二段'));
    assert.ok(set.has('多块 A\n多块 B'));
    assert.ok(!set.has('用户文本'), '只收 assistant 条目');
    assert.equal(classifySnapshotMessage('第一段\n第二段', set), SNAPSHOT_STATES.FRESH);
    assert.equal(classifySnapshotMessage('  第一段\n第二段\n', set), SNAPSHOT_STATES.FRESH, '两侧 trim');
    assert.equal(classifySnapshotMessage('第一段', set), SNAPSHOT_STATES.STALE, '裸子串不算命中');
    assert.equal(classifySnapshotMessage('完全不在集合里', set), SNAPSHOT_STATES.STALE);
    assert.equal(classifySnapshotMessage(undefined, set), SNAPSHOT_STATES.ABSENT);
    assert.equal(classifySnapshotMessage(42, set), SNAPSHOT_STATES.ABSENT, '非字符串按缺席');
    assert.equal(classifySnapshotMessage('', set), SNAPSHOT_STATES.ABSENT, '空串按缺席：无文本 ≠ 陈旧（W-5 / I3）');
    assert.equal(classifySnapshotMessage('  \n', set), SNAPSHOT_STATES.ABSENT, '纯空白按缺席');
  });

  it('T4-E1..E5 端到端三态：键缺席→snapshot-message-absent；∈集合→无码；∉集合→snapshot-stale；退出码与三计数器完全相同；两码不进 stderr', () => {
    const cases = {
      absent: {},
      fresh: { last_assistant_message: '最后一条助手文本\n第二行' },
      stale: { last_assistant_message: '这句话不在 transcript 里' },
    };
    const results = {};
    for (const [label, extra] of Object.entries(cases)) {
      const root = stageRoot();
      const t = nonCompliantTranscript(root);
      const r = runHook(root, t, { sessionId: `g4-${label}`, extra });
      const evs = readEvents(root);
      assert.equal(evs.length, 1, label);
      results[label] = { status: r.status, counters: counters(readState(root, `g4-${label}`)), diag: evs[0].diagnostics, stderr: r.stderr };
    }
    assert.ok(results.absent.diag.includes('snapshot-message-absent') && !results.absent.diag.includes('snapshot-stale'));
    assert.ok(!results.fresh.diag.includes('snapshot-message-absent') && !results.fresh.diag.includes('snapshot-stale'));
    assert.ok(results.stale.diag.includes('snapshot-stale') && !results.stale.diag.includes('snapshot-message-absent'));
    for (const k of ['fresh', 'stale']) {
      assert.equal(results[k].status, results.absent.status, `${k}: 退出码不得变`);
      assert.deepEqual(results[k].counters, results.absent.counters, `${k}: 三计数器不得变`);
    }
    for (const r of Object.values(results)) {
      assert.ok(!r.stderr.includes('snapshot-stale') && !r.stderr.includes('snapshot-message-absent'), '两码不得进用户 stderr');
    }
  });

  it('T4-E5 源码面：两码不经 deferExtraDiagnostics（只走审计通道）；report 模式不做交叉校验（无 payload 快照）', () => {
    assert.equal(/deferExtraDiagnostics[^\n]*snapshot/.test(JUDGE_SRC), false);
    assert.ok(JUDGE_SRC.includes('last_assistant_message'), 'B-4 对照组翻转：生产消费点必须存在');
    const root = stageRoot();
    const t = nonCompliantTranscript(root);
    const res = spawnSync('node', [CLI, '--mode', 'report', '--project-root', root, '--transcript-path', t], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.ok(!res.stdout.includes('snapshot-message-absent'), 'report 模式没有 payload 快照，不得报缺席');
  });

  it('T4-E6 fail-open 早退（feature-dir-unresolvable）也保留快照可观测量', () => {
    // 裸 root：磁盘上没有任何 specs/NNN-fix-* 候选（否则 F227 磁盘兜底会把候选找回来、不走早退）
    const root = path.join(tmp, `bare-${++seq}`);
    fs.mkdirSync(root, { recursive: true });
    // 特性目录不可定位（F224/F227 通道）：制品目录被光杆 mv 搬到非规范名 → ambiguous → 有 verify 类委派 → 早退 fail-open
    const t = writeTranscript(root, [
      SKILL_EXPANSION_LINE,
      TOOL_USE('Write', { file_path: 'specs/301-fix-sample-bug/fix-report.md', content: REPAIR_FIX_REPORT }),
      TOOL_USE('Bash', { command: 'mv specs/301-fix-sample-bug tmp/stage-a' }),
      TOOL_USE('Agent', { subagent_type: 'general-purpose', description: '验证修复结果' }),
      ASSISTANT_TEXT('尾'),
    ]);
    const r = runHook(root, t, { sessionId: 'g4-failopen', extra: { last_assistant_message: '不在集合' } });
    assert.equal(r.status, 0);
    const evs = readEvents(root);
    assert.ok(evs.length >= 1);
    const diag = evs[evs.length - 1].diagnostics;
    assert.ok(diag.includes('feature-dir-unresolvable'), `语料未走到早退：${JSON.stringify(diag)}`);
    assert.ok(diag.includes('snapshot-stale'), 'fail-open 早退也应保留快照可观测量');
  });
});

describe('F287 G4 · fail-open 早退与 stdin 管道形态', () => {
  it('T4-E7 codex 方言 fail-open 早退（transcript-format-unrecognized）同样保留快照可观测量（误伤面 I2 / 绕过面 I-1）', () => {
    const root = stageRoot();
    const fixture = path.resolve(HERE, 'fixtures', 'fix-compliance', 'real-bash-transcript-codex.jsonl');
    const r = runHook(root, fixture, { sessionId: 'g4-codex', extra: { last_assistant_message: '不在集合' } });
    assert.equal(r.status, 0);
    const evs = readEvents(root);
    assert.ok(evs.length >= 1, '应有 fail-open 落盘');
    const diag = evs[evs.length - 1].diagnostics;
    assert.ok(diag.includes('transcript-format-unrecognized'), JSON.stringify(diag));
    assert.ok(diag.includes('snapshot-stale'), `早退丢了快照码：${JSON.stringify(diag)}`);
  });

  it('C-1 stdin 管道形态（wrapper 的 printf | node）：payload > 64 KB 不得退化为 payload-invalid 放行（既有 fail-open，自 F208）', () => {
    const root = stageRoot();
    const t = nonCompliantTranscript(root);
    const payload = JSON.stringify({ session_id: 'c1-pipe', transcript_path: t, stop_hook_active: false, last_assistant_message: 'x'.repeat(100 * 1024) });
    const res = spawnSync('sh', ['-c', 'printf "%s" "$0" | node "$1" --mode hook --project-root "$2"', payload, CLI, root], { encoding: 'utf8' });
    assert.equal(res.status, 2, `期望阻断而非 payload-invalid 放行：${(res.stderr || '').slice(0, 300)}`);
    const evs = readEvents(root);
    assert.ok(evs.length >= 1);
    const diag = evs[evs.length - 1].diagnostics;
    assert.ok(!diag.includes('payload-invalid') && diag.includes('snapshot-stale'), JSON.stringify(diag));
    assert.equal(evs[evs.length - 1].sessionId, 'c1-pipe', 'sessionId 不得落成 unknown');
  });
});

// ════════════════════════════════════════════
// K-1 · 入口守卫收敛
// ════════════════════════════════════════════
describe('F287 K-1 · 判定器入口守卫收敛为 isInvokedDirectly', () => {
  it('源码用共享守卫、不再手写 realpathSync 比对；lib 进 JUDGE_FILE_SET 闭包', () => {
    assert.ok(JUDGE_SRC.includes("from './lib/is-invoked-directly.mjs'"));
    assert.ok(JUDGE_SRC.includes('if (isInvokedDirectly(import.meta.url)) {'));
    assert.equal(JUDGE_SRC.includes('realpathSync(process.argv[1])'), false, '手写单侧 realpath 无 try = 理论 fail-open');
    assert.ok(JUDGE_FILE_SET.includes('scripts/lib/is-invoked-directly.mjs'));
  });

  it('经 symlink 路径直接执行仍进入 main（F246 根因：词法归一不解 symlink）', () => {
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f287-link-'));
    const link = path.join(linkDir, 'judge-link.mjs');
    fs.symlinkSync(CLI, link);
    try {
      const res = spawnSync('node', [link, '--mode', 'report', '--project-root', tmp, '--transcript-path', path.join(tmp, 'nope.jsonl')], { encoding: 'utf8' });
      assert.equal(res.status, 0);
      assert.ok(res.stdout.trim().startsWith('{'), `main 未执行（stdout 空）：${res.stdout.slice(0, 80)}`);
    } finally {
      fs.rmSync(linkDir, { recursive: true, force: true });
    }
  });
});
