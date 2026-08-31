/**
 * ledger-writer.test.mjs
 * F270 P1 — 会话证据账本采集器单测（T101-T104）
 *
 * Tests FIRST：先于 ledger-writer.mjs 存在，import 失败即红。
 * 覆盖四组红先行：
 *   T101 多进程并发追加零撕裂（SC-006，harness-probe P-7 实验形态）
 *   T102 失败注入恒 exit 0 + 零 stdout/stderr（SC-005，C-10）
 *   T103 条目裁剪：不存 tool_response 全文，Agent 类存 subagent_type 全值（P-8/P-11/FR-002）
 *   T104 活性哨兵与体积上限（FR-043/044、FR-011）
 *
 * 运行: node --test plugins/spec-driver/tests/ledger-writer.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LEDGER_SUBDIR,
  LEDGER_MAX_BYTES,
  buildLedgerEntry,
  appendLedgerEntry,
  ledgerPathFor,
} from '../scripts/lib/ledger-writer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRITER_CLI = path.join(HERE, '..', 'scripts', 'lib', 'ledger-writer.mjs');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-writer-'));
  // F270 集成 review：采集器加了 US5 闸门（`.specify/` 不存在即零落盘）。本文件既有用例
  // 测的是「spec-driver 项目内采集器行为」，故统一预置该目录；非 spec-driver 项目的零落盘
  // 语义由末尾「US5 零落盘闸门」组专门覆盖（用另建的干净目录）。
  fs.mkdirSync(path.join(tmp, '.specify'), { recursive: true });
  // 闸门判据是「`.specify/` 里除 `.spec-driver-path` 外还有别的条目」——只建空目录不够，
  // 因为 postinstall.sh 在每个项目都会建它（对抗 D CRITICAL-1）。此处放一个流程产物代表
  // 「本项目真的跑过 spec-driver」。
  fs.writeFileSync(path.join(tmp, '.specify', 'project-context.yaml'), 'x: 1\n');
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 最小合法 Claude PostToolUse payload（形状取自 .specify/runs/f270-raw-payloads 真实样本） */
function samplePayload(overrides = {}) {
  return {
    session_id: 'sess-0001',
    transcript_path: '/tmp/x.jsonl',
    cwd: tmp,
    prompt_id: 'prompt-0001',
    permission_mode: 'default',
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hi', description: 'test' },
    tool_response: { stdout: 'hi', stderr: '', interrupted: false },
    tool_use_id: 'toolu_TEST0000000000000001',
    ...overrides,
  };
}

/** 以子进程 CLI 形态跑采集器：stdin 喂 payload，返回 {status, stdout, stderr} */
function runWriterCli(payloadText, { projectRoot = tmp, env = {} } = {}) {
  return spawnSync(process.execPath, [WRITER_CLI, '--project-root', projectRoot], {
    input: payloadText,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10_000,
  });
}

function readLedgerLines(projectRoot, sessionId) {
  const p = ledgerPathFor(projectRoot, sessionId);
  if (!fs.existsSync(p)) return null;
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);
}

// ────────────────────────────────────────
// T103 · 条目裁剪（先测纯函数面，最快红→绿）
// ────────────────────────────────────────

describe('T103 buildLedgerEntry — 裁剪', () => {
  it('普通 Bash payload：含核心字段，无 subagent_type，无 tool_response 内容', () => {
    const entry = buildLedgerEntry(samplePayload());
    assert.equal(entry.v, 1);
    assert.equal(entry.tool_use_id, 'toolu_TEST0000000000000001');
    assert.equal(entry.tool_name, 'Bash');
    assert.equal(entry.prompt_id, 'prompt-0001');
    assert.equal(entry.session_id, 'sess-0001');
    assert.equal(typeof entry.hookTs, 'string');
    assert.ok(!Number.isNaN(Date.parse(entry.hookTs)), 'hookTs 须为可解析时间串');
    assert.ok(!('subagent_type' in entry), '非委派类不得有 subagent_type 键');
    assert.ok(!('tool_response' in entry), '不得整存 tool_response');
    assert.ok(!('tool_input' in entry), '不得整存 tool_input');
  });

  it('Agent payload：subagent_type 取全值；100KB tool_response.prompt 不入条目（<1KB）', () => {
    const bigPrompt = 'x'.repeat(100 * 1024);
    const entry = buildLedgerEntry(
      samplePayload({
        tool_name: 'Agent',
        tool_input: {
          description: '实现某功能',
          prompt: bigPrompt,
          subagent_type: 'spec-driver:implement',
          model: 'opus',
        },
        tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1', prompt: bigPrompt },
      })
    );
    assert.equal(entry.subagent_type, 'spec-driver:implement');
    const serialized = JSON.stringify(entry);
    assert.ok(serialized.length < 1024, `条目须 <1KB，实际 ${serialized.length}B`);
    assert.ok(!serialized.includes('xxxxx'), '不得含 prompt 文本片段');
  });

  it('Task 别名工具同样提取 subagent_type', () => {
    const entry = buildLedgerEntry(
      samplePayload({ tool_name: 'Task', tool_input: { subagent_type: 'general-purpose' } })
    );
    assert.equal(entry.subagent_type, 'general-purpose');
  });

  it('子代理 payload：agent_id/agent_type 透传；主线程 payload：两键缺席', () => {
    const sub = buildLedgerEntry(samplePayload({ agent_id: 'a9', agent_type: 'Explore' }));
    assert.equal(sub.agent_id, 'a9');
    assert.equal(sub.agent_type, 'Explore');
    const main = buildLedgerEntry(samplePayload());
    assert.ok(!('agent_id' in main), '主线程条目不得补 agent_id 键（缺席即缺席，C-2 同族语义）');
    assert.ok(!('agent_type' in main));
  });

  it('ok 字段为布尔且非承重（畸形 tool_response 也不抛）', () => {
    const e1 = buildLedgerEntry(samplePayload({ tool_response: undefined }));
    assert.equal(typeof e1.ok, 'boolean');
    const e2 = buildLedgerEntry(samplePayload({ tool_response: 'weird-string' }));
    assert.equal(typeof e2.ok, 'boolean');
  });
});

// ────────────────────────────────────────
// T104 · 活性哨兵 + 体积上限
// ────────────────────────────────────────

describe('T104 活性哨兵与体积上限', () => {
  it('新 session 首写：文件含 ledger-open 哨兵 + 数据条（恰两行）', () => {
    const r = appendLedgerEntry(tmp, samplePayload());
    assert.equal(r.ok, true);
    const lines = readLedgerLines(tmp, 'sess-0001');
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.equal(first.type, 'ledger-open');
    assert.equal(first.session_id, 'sess-0001');
    const second = JSON.parse(lines[1]);
    assert.equal(second.tool_use_id, 'toolu_TEST0000000000000001');
  });

  it('二次写入不再补哨兵（幂等）', () => {
    appendLedgerEntry(tmp, samplePayload());
    appendLedgerEntry(tmp, samplePayload({ tool_use_id: 'toolu_TEST0000000000000002' }));
    const lines = readLedgerLines(tmp, 'sess-0001');
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).type, 'ledger-open');
  });

  it('体积 ≥ LEDGER_MAX_BYTES：不再追加，selfdiag 记 oversize，账本行数不变', () => {
    appendLedgerEntry(tmp, samplePayload());
    const ledgerPath = ledgerPathFor(tmp, 'sess-0001');
    // 撑到上限
    fs.appendFileSync(ledgerPath, 'y'.repeat(LEDGER_MAX_BYTES));
    const before = fs.readFileSync(ledgerPath, 'utf8').length;
    const r = appendLedgerEntry(tmp, samplePayload({ tool_use_id: 'toolu_TEST_OVER' }));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'oversize');
    const after = fs.readFileSync(ledgerPath, 'utf8').length;
    assert.equal(after, before, '超限后账本字节数不得增长');
    const diag = fs.readFileSync(
      path.join(path.dirname(ledgerPath), '.ledger-selfdiag.jsonl'),
      'utf8'
    );
    assert.ok(diag.includes('oversize'));
  });

  it('sanitizeSessionId 复用：路径穿越型 session_id 被清洗', () => {
    appendLedgerEntry(tmp, samplePayload({ session_id: '../../evil' }));
    const dir = path.join(tmp, '.specify', 'runs', '.fix-compliance-ledger');
    // 注意：清洗把 `/`→`_` 但保留 `.`，故文件名可为 `.._.._evil.jsonl`（点开头，
    // 与状态文件既有行为一致）——排除项须用精确 selfdiag 名，不能用点前缀通配
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl') && f !== '.ledger-selfdiag.jsonl');
    assert.equal(files.length, 1);
    assert.ok(!files[0].includes('/'), `文件名不得含路径分隔段: ${files[0]}`);
    const resolved = fs.realpathSync(path.join(dir, files[0]));
    assert.ok(resolved.startsWith(fs.realpathSync(dir)), '产物必须落在账本目录内（无穿越）');
    assert.ok(!fs.existsSync(path.join(tmp, '.specify', 'evil.jsonl')));
    assert.ok(!fs.existsSync(path.join(path.dirname(tmp), 'evil.jsonl')));
  });
});

// ────────────────────────────────────────
// T102 · CLI 形态失败注入（恒 exit 0 + 零输出）
// ────────────────────────────────────────

describe('T102 CLI 失败注入 — 恒 exit 0、零 stdout/stderr', () => {
  it('正常 payload：exit 0、零输出、账本落盘', () => {
    const r = runWriterCli(JSON.stringify(samplePayload()));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    assert.equal(readLedgerLines(tmp, 'sess-0001').length, 2);
  });

  it('空 stdin：exit 0、零输出', () => {
    const r = runWriterCli('');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  });

  it('非 JSON stdin：exit 0、零输出、selfdiag 有记录', () => {
    const r = runWriterCli('not-json{{{');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    const diagPath = path.join(
      tmp, '.specify', 'runs', '.fix-compliance-ledger', '.ledger-selfdiag.jsonl'
    );
    assert.ok(fs.existsSync(diagPath), 'selfdiag 须有记录');
  });

  it('Codex 方言形状（缺 session_id/tool_use_id）：静默跳过 exit 0，无账本文件', () => {
    const r = runWriterCli(JSON.stringify({ type: 'custom_tool_call', name: 'shell' }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
    const dir = path.join(tmp, '.specify', 'runs', '.fix-compliance-ledger');
    const dataFiles = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('.'))
      : [];
    assert.equal(dataFiles.length, 0, '方言 payload 不得产生账本数据文件');
  });

  it('目录不可写：exit 0、零输出（静默降级）', { skip: process.getuid?.() === 0 ? 'root' : false }, () => {
    const roRoot = path.join(tmp, 'ro');
    fs.mkdirSync(path.join(roRoot, '.specify', 'runs'), { recursive: true });
    fs.chmodSync(path.join(roRoot, '.specify', 'runs'), 0o500);
    try {
      const r = runWriterCli(JSON.stringify(samplePayload()), { projectRoot: roRoot });
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    } finally {
      fs.chmodSync(path.join(roRoot, '.specify', 'runs'), 0o755);
    }
  });
});

// ────────────────────────────────────────
// T101 · 多进程并发追加零撕裂（SC-006）
// ────────────────────────────────────────

describe('T101 并发追加 — 8 进程 × 150 条零撕裂', () => {
  it('总行数=哨兵+1200、逐行可解析、每写手条数正确', async () => {
    // 先建好文件（含哨兵），避免 8 进程竞争首建时哨兵计数不定
    appendLedgerEntry(tmp, samplePayload({ tool_use_id: 'toolu_SEED' }));
    const WRITERS = 8;
    const PER = 150;
    const jobs = [];
    for (let w = 0; w < WRITERS; w++) {
      const payloads = [];
      for (let i = 0; i < PER; i++) {
        payloads.push(
          JSON.stringify(
            samplePayload({ tool_use_id: `toolu_W${w}_${String(i).padStart(4, '0')}` })
          )
        );
      }
      jobs.push(
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              '-e',
              `
              const { appendLedgerEntry } = await import(${JSON.stringify('file://' + WRITER_CLI)});
              const payloads = JSON.parse(process.argv[1]);
              for (const p of payloads) appendLedgerEntry(${JSON.stringify(tmp)}, JSON.parse(p));
              `,
              JSON.stringify(payloads),
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] }
          );
          let err = '';
          child.stderr.on('data', (d) => (err += d));
          child.on('error', reject);
          child.on('close', (code) =>
            code === 0 ? resolve(null) : reject(new Error(`writer ${w} exit ${code}: ${err}`))
          );
        })
      );
    }
    await Promise.all(jobs);
    const lines = readLedgerLines(tmp, 'sess-0001');
    assert.equal(lines.length, 1 + 1 + WRITERS * PER, '哨兵+seed+1200');
    const perWriter = new Map();
    for (const l of lines) {
      const o = JSON.parse(l); // 撕裂即抛
      const m = /^toolu_W(\d+)_/.exec(o.tool_use_id ?? '');
      if (m) perWriter.set(m[1], (perWriter.get(m[1]) ?? 0) + 1);
    }
    for (let w = 0; w < WRITERS; w++) {
      assert.equal(perWriter.get(String(w)), PER, `写手 ${w} 条数`);
    }
  });
});

// ════════════════════════════════════════
// F270 集成 review · US5「健康路径零落盘」闸门
// Tests FIRST：采集器当前无任何闸门，本组先红。
//
// 病灶（集成 review CRITICAL-2，实跑复现）：hooks.json 的 `matcher: ""` 让采集器对**每一次**
// 工具调用触发，而 writer 无「是否 spec-driver 项目」判断 → 在一个从未用过 spec-driver 的
// 空目录里跑单次 Read，即产生 `.specify/runs/.fix-compliance-ledger/<sid>.jsonl`。
// F270 自己的 spec.md:600 警告过全称落盘「会在无关用户项目里创建 .specify/」，但该收窄只
// 应用到了判定器的 FR-024，没应用到同一张卡新增的采集器。F240 US5 / F208 US5 的守卫只跑
// judge，对姊妹采集器结构性失明。
//
// 闸门判据：`<projectRoot>/.specify/` **已存在**才写（spec-driver 项目标志，由 init/postinstall
// 建）。不存在即零落盘并返回 not-spec-driver-project；采集器**绝不自己创建**该目录。
// ════════════════════════════════════════

describe('F270 review · US5 零落盘闸门', () => {
  let clean;
  beforeEach(() => { clean = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-us5-')); });
  afterEach(() => { fs.rmSync(clean, { recursive: true, force: true }); });

  it('🔴 .specify/ 不存在 → 零落盘，且不得凭空创建任何文件/目录', () => {
    const r = appendLedgerEntry(clean, samplePayload());
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-spec-driver-project');
    assert.deepEqual(fs.readdirSync(clean), [], `目录必须完全干净，实得 ${JSON.stringify(fs.readdirSync(clean))}`);
  });

  it('🔴 方言 payload（Codex）在非 spec-driver 项目同样零落盘（自诊断不得穿透闸门）', () => {
    const r = appendLedgerEntry(clean, { not_a_claude_payload: true });
    assert.equal(r.ok, false);
    assert.deepEqual(fs.readdirSync(clean), [], '自诊断路径也不得建 .specify/');
  });

  it('🔴 CLI 形式（真实 hook 调用路径）在非 spec-driver 项目零落盘且恒 exit 0', () => {
    const r = spawnSync('node', [WRITER_CLI, '--project-root', clean], {
      input: JSON.stringify(samplePayload()), encoding: 'utf8',
    });
    assert.equal(r.status, 0, 'US5 闸门不得改变恒 exit 0 语义（SC-005）');
    assert.equal(`${r.stdout}${r.stderr}`, '', '零输出语义不变');
    assert.deepEqual(fs.readdirSync(clean), []);
  });

  it('.specify/ 里有流程产物 → 正常写（spec-driver 项目内采集能力不受闸门影响）', () => {
    fs.mkdirSync(path.join(clean, '.specify'), { recursive: true });
    fs.writeFileSync(path.join(clean, '.specify', 'project-context.yaml'), 'x: 1\n');
    const r = appendLedgerEntry(clean, samplePayload());
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(ledgerPathFor(clean, 'sess-0001')));
  });

  // 🔴 生产接线断言（对抗 D CRITICAL-1 / 本仓 F274 教训「参数化测试全绿≠生产接线有守护」）：
  // 初版闸门判据是「`.specify/` 存在」，而 postinstall.sh 在 SessionStart（matcher 为空＝每个
  // 项目每次会话）无条件建该目录 → 判据恒为真、闸门零效力。上面几条用 mkdtemp 干净目录直接
  // 调函数的用例**全绿也发现不了**这件事，因为它们从不执行 postinstall.sh。故必须有一条把
  // 真实前置 hook 跑起来的断言。
  it('🔴 自举向量①：畸形 stdin 走 CLI main() 的 selfdiag 路径，不得开闸（对抗 E C-2）', () => {
    // 病灶：appendSelfdiag 自己 mkdirSync，而 main() 的 parse-error 分支不经过
    // appendLedgerEntry 的闸门 → 一次非 JSON stdin 即建出 .specify/runs/，
    // 把「目录里有别的条目」型判据翻成永真且**不可逆**。
    fs.mkdirSync(path.join(clean, '.specify'), { recursive: true });   // 仅目录，无流程产物
    const r0 = spawnSync('node', [WRITER_CLI, '--project-root', clean], { input: 'not-json{{{', encoding: 'utf8' });
    assert.equal(r0.status, 0, '恒 exit 0 语义不变');
    assert.ok(!fs.existsSync(path.join(clean, '.specify', 'runs')), '自诊断不得在非 spec-driver 项目建 runs/');
    // 关键：闸门不得因此被自举打开
    assert.equal(appendLedgerEntry(clean, samplePayload()).reason, 'not-spec-driver-project');
  });

  it('🔴 自举向量②③：runs/ 与 .DS_Store 都不得被当成"跑过 spec-driver 流程"', () => {
    fs.mkdirSync(path.join(clean, '.specify', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(clean, '.specify', 'runs', '2026-08.jsonl'), '{}\n');   // 判定器 fail-open 审计的形状
    fs.writeFileSync(path.join(clean, '.specify', '.DS_Store'), '');
    fs.writeFileSync(path.join(clean, '.specify', '.spec-driver-path'), '/x');
    assert.equal(appendLedgerEntry(clean, samplePayload()).reason, 'not-spec-driver-project',
      '运行态目录/系统文件不构成 spec-driver 项目标志');
  });

  it('🔴 生产接线：跑过真实 SessionStart(postinstall.sh) 后闸门仍必须拦住', () => {
    const postinstall = path.join(HERE, '..', 'scripts', 'postinstall.sh');
    const pluginRoot = path.join(HERE, '..');
    const r0 = spawnSync('bash', [postinstall], {
      cwd: clean, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: clean, CLAUDE_PLUGIN_ROOT: pluginRoot },
    });
    assert.equal(r0.status, 0, `postinstall 应成功；stderr=${r0.stderr}`);
    assert.ok(fs.existsSync(path.join(clean, '.specify')), 'postinstall 确实建了 .specify/（前提成立才有意义）');

    const r = appendLedgerEntry(clean, samplePayload());
    assert.equal(r.ok, false, 'SessionStart 建的 .specify/ 不得让闸门失效');
    assert.equal(r.reason, 'not-spec-driver-project');
    assert.ok(!fs.existsSync(path.join(clean, '.specify', 'runs', '.fix-compliance-ledger')),
      '非 spec-driver 项目不得因 postinstall 前置而被写账本');
  });
});

// ════════════════════════════════════════
// hooks.json matcher 与消费侧口径同步守卫（对抗 E W-1：此前改 matcher 零测试变红）
// ════════════════════════════════════════

describe('F270 review · 账本 matcher 与消费侧同口径', () => {
  it('🔴 hooks.json 的账本 handler matcher 必须逐项等于 DELEGATION_TOOL_NAMES', async () => {
    const { DELEGATION_TOOL_NAMES } = await import('../scripts/lib/ledger-reader.mjs');
    const doc = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'hooks', 'hooks.json'), 'utf8'));
    const group = (doc.hooks.PostToolUse || []).find((g) =>
      (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('post-tool-use-ledger.sh')));
    assert.ok(group, '账本采集器必须注册在 PostToolUse 下');
    // 派生比对：消费侧集合改了而 matcher 没跟，或反之，都会在这里变红。
    // 空 matcher（全工具）同样会红——收窄是刻意决策，回退必须是显式的。
    assert.deepEqual(
      group.matcher.split('|').filter(Boolean).sort(),
      [...DELEGATION_TOOL_NAMES].sort(),
      `matcher(${JSON.stringify(group.matcher)}) 与消费侧 DELEGATION_TOOL_NAMES 失配 → 账本会静默漏采委派`,
    );
  });
});
