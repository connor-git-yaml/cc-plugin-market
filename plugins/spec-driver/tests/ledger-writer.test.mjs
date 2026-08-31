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
