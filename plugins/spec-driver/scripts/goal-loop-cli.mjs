#!/usr/bin/env node

/**
 * goal-loop-cli.mjs
 * Feature 201 — goal_loop core 的薄 CLI 包装（仿 orchestrator-cli.mjs）
 *
 * 设计契约（plan §1.1 / tasks T018，修正 Codex C-02）：
 *   所有"需要复杂结构输入"的子命令一律接受**单个 JSON payload**（文件路径），
 *   输出 JSON 到 stdout；简单标量子命令用位置参数。SKILL.md 散文必须按本契约调用。
 *
 * 用法:
 *   node goal-loop-cli.mjs parse-report <reportJsonFile>
 *   node goal-loop-cli.mjs classify-command <cmdJsonFile>
 *   node goal-loop-cli.mjs decide-stop <payloadJsonFile>      # payload={report,round,config,prevReports,rollbackResult}
 *   node goal-loop-cli.mjs plan-snapshot <isClean:true|false>
 *   node goal-loop-cli.mjs plan-rollback <snapshotJsonFile>   # snapshot={clean,ref}
 *   node goal-loop-cli.mjs select-verify-mode <round> <max> <aboutToExit:true|false>
 *   node goal-loop-cli.mjs decide-dispatch <phaseId> <agentMode>
 *   node goal-loop-cli.mjs interpret-impact <mcpResultJsonFile>
 *   node goal-loop-cli.mjs acquire-lock <lockPath>
 *   node goal-loop-cli.mjs release-lock <lockPath>
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  classifyCommand,
  decideStop,
  decideDispatch,
  selectVerifyMode,
  planSnapshotCommands,
  planRollbackCommands,
  parseReport,
  interpretImpactResult,
} from './lib/goal-loop-core.mjs';

// ──────────────────────────────────────────────────────────────────────────
// I/O 边界：单实例文件锁（FR-018）—— 非纯函数，故放 CLI 不放纯 core
// ──────────────────────────────────────────────────────────────────────────

/**
 * 写锁 payload 到已打开的 fd 并关闭
 * @param {number} fd
 */
function writeLockPayload(fd) {
  const payload = JSON.stringify({ pid: process.pid, start_time: new Date().toISOString() });
  try {
    fs.writeSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 判定现有锁是否为 stale（仅当持锁进程已不存在 或 锁内容损坏）（Codex W3 / Phase B 复审修正）
 *
 * 关键不变量（FR-018 单实例保证）：**持锁 PID 存活时永不视为 stale**，无论锁多老。
 * 早期版本曾用 TTL（30min）兜底接管"超龄但存活"的锁，但真实 goal_loop 跑满
 * max_iterations × max_verify_seconds 很容易超 30min，会导致新实例强抢活锁、破坏单实例保证。
 * 因此移除 TTL 接管路径：接管只发生在"持有者证明已死"或"锁文件损坏无法证明存活"两种情况。
 *
 * 已知罕见残留：PID 复用——死 goal_loop 的 PID 被无关进程复用后，process.kill(pid,0) 误判存活，
 * 锁将无法自动接管，需人工清理 .lock 文件。我们接受这个罕见 case，不引入 TTL 接管活锁的
 * 更大风险（误杀正在跑的长任务）来换取它。
 * @param {string} lockPath
 * @returns {{ stale: boolean, holderPid: number|null, reason: string }}
 */
function inspectLock(lockPath) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
  } catch {
    // 锁内容损坏/不可解析 → 无法证明持有者存活，视为 stale 可接管
    return { stale: true, holderPid: null, reason: 'lock_payload_unreadable' };
  }
  const holderPid = typeof payload.pid === 'number' ? payload.pid : null;

  // 进程存活探测：process.kill(pid, 0) 不发信号，仅校验进程存在；ESRCH = 进程不存在
  if (holderPid !== null) {
    try {
      process.kill(holderPid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') {
        return { stale: true, holderPid, reason: 'holder_process_gone' };
      }
      // EPERM = 进程存在但无权限发信号 → 持有者存活（保守），非 stale
    }
  } else {
    // payload 缺合法 pid 字段 → 无法证明存活，视为 stale 可接管
    return { stale: true, holderPid: null, reason: 'lock_payload_unreadable' };
  }

  // 走到这里：holderPid 存活（kill 未抛 ESRCH）→ 永不接管，无论锁龄
  return { stale: false, holderPid, reason: 'holder_alive' };
}

/**
 * 单实例文件锁：以 O_EXCL 原子创建 .lock（FR-018）
 *
 * stale 恢复（Codex W3 / Phase B 复审修正）：遇 EEXIST 时校验现有锁——仅当持锁进程不存在（ESRCH）
 * 或锁文件损坏无法证明持有者存活时，原子清理 stale 锁后重试一次获取；否则（持有者存活）返回
 * lock_exists（含 holder pid）。不再用 TTL 接管"超龄但存活"的活锁（见 inspectLock 注释）。
 * @param {string} lockPath
 * @returns {{ acquired: true }|{ acquired: false, reason: string, holderPid?: number|null }}
 */
export function acquireLock(lockPath) {
  let fd;
  try {
    // 'wx' = O_CREAT | O_EXCL | O_WRONLY：文件已存在则抛 EEXIST（原子，防竞态）
    fd = fs.openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      const info = inspectLock(lockPath);
      if (!info.stale) {
        return { acquired: false, reason: 'lock_exists', holderPid: info.holderPid };
      }
      // stale 锁：原子清理后重试一次获取。
      // 用第二个 'wx' 而非先 unlink 再 open，避免清理与重建之间的竞态（仅重试一次防活锁）。
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkErr) {
        if (unlinkErr.code !== 'ENOENT') throw unlinkErr;
        // ENOENT：他人已抢先清理，继续尝试创建
      }
      try {
        fd = fs.openSync(lockPath, 'wx');
      } catch (retryErr) {
        if (retryErr.code === 'EEXIST') {
          // 清理后被其他进程抢占 → 让对方持有，返回 lock_exists
          const after = inspectLock(lockPath);
          return { acquired: false, reason: 'lock_exists', holderPid: after.holderPid };
        }
        throw retryErr;
      }
      writeLockPayload(fd);
      return { acquired: true };
    }
    throw err;
  }
  writeLockPayload(fd);
  return { acquired: true };
}

/**
 * 释放单实例文件锁（FR-018）
 * @param {string} lockPath
 * @returns {{ released: boolean }}
 */
export function releaseLock(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // 锁不存在视为已释放（幂等）
      return { released: true };
    }
    throw err;
  }
  return { released: true };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI dispatch
// ──────────────────────────────────────────────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

function fail(message) {
  console.error(JSON.stringify({ success: false, error: message }, null, 2));
  process.exit(1);
}

function readJsonFile(filePath) {
  if (!filePath) {
    fail('缺少 JSON payload 文件路径参数');
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function parseBool(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`参数 ${name} 必须为 true|false，实际为 "${value}"`);
}

function main(argv) {
  const [subcommand, ...args] = argv;

  switch (subcommand) {
    case 'parse-report': {
      // parseReport 接受原始文本（含可能非法 JSON），故直接读文本不预解析
      const filePath = args[0];
      if (!filePath) fail('parse-report 需要 <reportJsonFile>');
      const text = fs.readFileSync(filePath, 'utf-8');
      output(parseReport(text));
      break;
    }
    case 'classify-command': {
      output({ status: classifyCommand(readJsonFile(args[0])) });
      break;
    }
    case 'decide-stop': {
      const payload = readJsonFile(args[0]);
      output(
        decideStop({
          report: payload.report,
          round: payload.round,
          config: payload.config,
          prevReports: payload.prevReports ?? [],
          rollbackResult: payload.rollbackResult ?? null,
        }),
      );
      break;
    }
    case 'plan-snapshot': {
      output({ commands: planSnapshotCommands(parseBool(args[0], 'isClean')) });
      break;
    }
    case 'plan-rollback': {
      output({ commands: planRollbackCommands(readJsonFile(args[0])) });
      break;
    }
    case 'select-verify-mode': {
      const round = Number(args[0]);
      const max = Number(args[1]);
      const aboutToExit = parseBool(args[2], 'aboutToExit');
      if (Number.isNaN(round) || Number.isNaN(max)) {
        fail('select-verify-mode 需要数字 <round> <max>');
      }
      output({ mode: selectVerifyMode(round, max, aboutToExit) });
      break;
    }
    case 'decide-dispatch': {
      if (args.length < 2) fail('decide-dispatch 需要 <phaseId> <agentMode>');
      output(decideDispatch(args[0], args[1]));
      break;
    }
    case 'interpret-impact': {
      output(interpretImpactResult(readJsonFile(args[0])));
      break;
    }
    case 'acquire-lock': {
      if (!args[0]) fail('acquire-lock 需要 <lockPath>');
      output(acquireLock(args[0]));
      break;
    }
    case 'release-lock': {
      if (!args[0]) fail('release-lock 需要 <lockPath>');
      output(releaseLock(args[0]));
      break;
    }
    default:
      fail(`未知子命令: ${subcommand ?? '(空)'}`);
  }
}

// 仅当作为入口脚本直接运行时执行 dispatch（被 import 时不触发，便于单测）
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main(process.argv.slice(2));
}
