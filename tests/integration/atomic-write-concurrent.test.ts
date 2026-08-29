/**
 * F267 / D3 — `writeAtomicJson` 真并发写同一目标的集成验证。
 *
 * 为什么必须开真实子进程：`writeAtomicJson` 全同步（`writeFileSync` / `renameSync`），
 * 单个 Node 进程内两次调用天然串行，`Promise.all` 包起来也只是顺序执行两遍——**制造不出**
 * D3 的竞态。单元测试那侧只能断言 tmp 命名形态（进程内唯一 + 带 pid 分量），是修复点的代理
 * 指标；只有两个真实进程同时写同一个目标，才能观测 D3 本身。
 *
 * 修复前基线（`specs/267-fix-atomic-write-defects/verification/repro/d3-concurrent-tmp.mjs`，
 * 2 进程 × 40 轮）：7 次 `ENOENT`——固定名 `${target}.tmp` 被对方 rename 走了。
 *
 * ## 断言弱化是刻意的，不是妥协
 * 「哪一方的 payload 最终胜出」由内核调度决定，**没有**正确答案，断言它才是在造 flaky。
 * 原子写入承诺的是"结果必为其中一方的**完整**文档"，故这里只断言：
 * 1. 两个子进程零 `ENOENT`（D3 的直接信号）；
 * 2. 最终文件是可解析的完整 JSON，且恰是两份 payload 之一（无混合 / 无截断）；
 * 3. 目录里不留任何 `.tmp` 残渣。
 *
 * ## flaky 风险评估（本仓有预存 flaky 清单，不再新造一个）
 * 既有 flaky 的共同成因是**墙钟 perf 断言**或**满载下的紧超时**（watch/fsevents、
 * community-analysis 30s、cli-e2e 10s）。本用例三条断言全是正确实现的确定性性质，与调度
 * 顺序、机器负载均无关；工作量约 2 进程 × 30 轮同步写（本机实测 < 1s），而 integration
 * project 的 testTimeout 是 60s——余量两个数量级。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistBuilt } from '../helpers/dist-cli-guard.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ATOMIC_WRITE = path.join(PROJECT_ROOT, 'dist', 'utils', 'atomic-write.js');

/** 每个子进程写多少轮；两个进程交错写同一目标 */
const ROUNDS = 30;

/** 子进程脚本：循环写同一目标，把每次失败的 errno 打到 stdout 供父进程核对 */
const WORKER_SOURCE = [
  "const [moduleUrl, target, tag, rounds] = process.argv.slice(2);",
  "const { writeAtomicJson } = await import(moduleUrl);",
  "for (let i = 0; i < Number(rounds); i += 1) {",
  "  try {",
  "    writeAtomicJson(target, { writer: tag, round: i, filler: tag.repeat(2048) });",
  "  } catch (error) {",
  "    process.stdout.write(`WRITE-ERR ${error && error.code ? error.code : 'UNKNOWN'}\\n`);",
  "  }",
  "}",
  '',
].join('\n');

describe('F267 / D3 — 双进程并发写同一目标', () => {
  const sandboxes: string[] = [];

  beforeAll(() => {
    // 子进程只能加载编译产物；dist 的构建由 vitest globalSetup 单点负责
    assertDistBuilt();
  });

  afterEach(() => {
    for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
    sandboxes.length = 0;
  });

  it('两进程各写 30 轮：零 ENOENT，最终文件是某一方的完整 payload，且不留 tmp 残渣', () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'f267-concurrent-'));
    sandboxes.push(sandbox);
    const workerPath = path.join(sandbox, 'worker.mjs');
    const target = path.join(sandbox, 'shared.json');
    fs.writeFileSync(workerPath, WORKER_SOURCE, 'utf-8');

    const moduleUrl = new URL(`file://${DIST_ATOMIC_WRITE}`).href;
    const launch = (tag: string): string =>
      `node '${workerPath}' '${moduleUrl}' '${target}' '${tag}' ${ROUNDS}`;
    // 用 shell 的 `&` + `wait` 起两个真正同时在跑的进程；spawnSync 顺序调用只会串行执行。
    const result = spawnSync('bash', ['-c', `${launch('A')} & ${launch('B')} & wait`], {
      encoding: 'utf-8',
      timeout: 60_000,
    });

    // 🔴 刻意**不**断言 `result.status`：`bash -c '<cmd> & <cmd> & wait'` 的退出码来自 `wait`，
    // 子进程非零退出时它照样返回 0（已实测）。断言它恒真，是个永远抓不到回归的空断言。
    //
    // 🔴 刻意**不**断言 `result.stderr === ''`：那会把本测试变成 flaky 制造机——worker 被
    // SIGKILL 时 bash 自己会往 stderr 写 `Killed: 9` 作业消息（85 字节，已实测），
    // `NODE_OPTIONS=--experimental-loader=...` 也会写 360 字节的 ExperimentalWarning。
    // 两者都与被测行为无关。真正的信号在 stdout：worker 只在写入报错时打 `WRITE-ERR`。
    //
    // D3 的直接信号：修复前此处为 7 行 WRITE-ERR（见文件头基线），修复后必须为 0 行。
    expect(result.stdout).toBe('');
    // 但 stderr 里若出现 worker 自己抛的未捕获异常，仍必须失败（区别于 bash/node 的噪声行）。
    expect(result.stderr).not.toMatch(/Error:|throw|ENOENT|EEXIST/);

    const finalContent = fs.readFileSync(target, 'utf-8');
    const parsed = JSON.parse(finalContent) as { writer: string; round: number; filler: string };
    expect(['A', 'B']).toContain(parsed.writer);
    // 完整性：filler 长度对得上说明没被另一方的写入截断
    expect(parsed.filler).toBe(parsed.writer.repeat(2048));

    expect(fs.readdirSync(sandbox).filter((name) => name.includes('.tmp'))).toEqual([]);
  });
});
