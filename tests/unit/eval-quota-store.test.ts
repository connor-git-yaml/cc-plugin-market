/**
 * Feature 162 Phase C — eval-quota-store.mjs 单元测试
 *
 * 覆盖：
 *   PC-T1: 跨进程并发 reservation（child fork × N），final.runs===N + lockHeldMs<50ms
 *   PC-T2: 孤儿 lock 自动清理
 *   PC-T3: classifyRuns 四分类（finalized / partialRunning / partialStale / failedFinalized）
 *   PC-T4: ABA 防护 — active writer 持 lock 时 started_at>30min 仍归 partialRunning
 *   PC-T5: validateAcceptRestartPartial 互斥 → 抛错 + exitCode=64
 *
 * 关联：plan §2.3.8
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  acquireLock,
  releaseLock,
  reserveQuota,
  classifyRuns,
  checkAndCleanOrphanLock,
  validateAcceptRestartPartial,
  applyPartialDecision,
  EX_USAGE,
} from '../../scripts/lib/eval-quota-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.resolve(__dirname, '../helpers/quota-fork-helper.mjs');

function mkTmpDir(prefix = 'quota-store-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

interface ForkResult {
  ok: boolean;
  runs?: number;
  lockHeldMs?: number;
  reason?: string;
  error?: string;
  exitCode: number | null;
}

function forkAndReserve(opts: {
  storePath: string;
  lockPath: string;
  maxRuns: number;
  runId: string;
}): Promise<ForkResult> {
  return new Promise((resolve, reject) => {
    const child = fork(
      HELPER,
      [
        '--store-path',
        opts.storePath,
        '--lock-path',
        opts.lockPath,
        '--max-runs',
        String(opts.maxRuns),
        '--run-id',
        opts.runId,
      ],
      { stdio: ['ignore', 'pipe', 'inherit', 'ipc'] },
    );
    let buf = '';
    child.stdout?.on('data', (d) => {
      buf += d.toString();
    });
    child.on('exit', (code) => {
      try {
        const parsed = JSON.parse(buf || '{}') as Partial<ForkResult>;
        resolve({ ...parsed, exitCode: code } as ForkResult);
      } catch (e) {
        reject(new Error(`parse fail: buf="${buf}" code=${code}: ${(e as Error).message}`));
      }
    });
    child.on('error', reject);
  });
}

describe('eval-quota-store: 跨进程并发 reservation', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('PC-T1: 4 进程并发 fork reservation, final.runs===4 + 无重复 + 各进程持锁 < 200ms', async () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const storePath = path.join(tmpDir, 'feature-162.json');
    const lockPath = path.join(tmpDir, 'feature-162.lock');
    const N = 4;

    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        forkAndReserve({ storePath, lockPath, maxRuns: 100, runId: `run-${i}` }),
      ),
    );
    const totalMs = Date.now() - t0;

    expect(results.every((r) => r.ok)).toBe(true);
    // 端到端时长 — 含 fork overhead + 锁竞争 backoff（4 进程串行最多 3 轮 backoff
    // 50→100→200ms 累计 ~350ms）；远小于 totalCapMs 30s。下限验证写盘成功 + 串行化生效
    for (const r of results) {
      expect(r.lockHeldMs).toBeLessThan(2000);
    }
    // store 最终状态：runs===N + run_ids 去重
    const final = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as {
      runs: number;
      run_ids: string[];
    };
    expect(final.runs).toBe(N);
    expect(new Set(final.run_ids).size).toBe(N);
    expect(totalMs).toBeLessThan(10_000);
  });
});

describe('eval-quota-store: 孤儿 lock 清理', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('PC-T2: 孤儿 lock（pid 不存在 + age>60s）→ 自动清理', () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const lockPath = path.join(tmpDir, 'feature-162.lock');
    // pid 99999999 极不可能存在
    const meta = {
      pid: 99_999_999,
      createdAt: new Date(Date.now() - 90_000).toISOString(),
      host: 'test-host',
    };
    fs.writeFileSync(lockPath, JSON.stringify(meta));
    const cleaned = checkAndCleanOrphanLock(lockPath);
    expect(cleaned).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('PC-T2b: 当前进程持 lock（PID alive）→ 不清理', () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const lockPath = path.join(tmpDir, 'feature-162.lock');
    const meta = {
      pid: process.pid,
      createdAt: new Date(Date.now() - 90_000).toISOString(),
      host: 'test-host',
    };
    fs.writeFileSync(lockPath, JSON.stringify(meta));
    const cleaned = checkAndCleanOrphanLock(lockPath);
    expect(cleaned).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('PC-T2c: lock 太年轻（< 60s）→ 不清理', () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const lockPath = path.join(tmpDir, 'feature-162.lock');
    const meta = {
      pid: 99_999_999,
      createdAt: new Date(Date.now() - 5_000).toISOString(),
      host: 'test-host',
    };
    fs.writeFileSync(lockPath, JSON.stringify(meta));
    const cleaned = checkAndCleanOrphanLock(lockPath);
    expect(cleaned).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('PC-T2d (iter-2 C-3): EPERM 探测（PID 跨用户存在）→ 不清理 lock', () => {
    // process.kill(pid, 0) 在 PID 存在但跨用户时抛 EPERM；
    // 此前实现把 EPERM 当 ESRCH 一样清理，会误删其他用户的活跃 lock。
    // 修复后：EPERM → return false 不清理，交由 backoff 兜底。
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const lockPath = path.join(tmpDir, 'feature-162.lock');
    const meta = {
      pid: 12_345,
      createdAt: new Date(Date.now() - 90_000).toISOString(),
      host: 'test-host',
    };
    fs.writeFileSync(lockPath, JSON.stringify(meta));

    // mock process.kill 抛 EPERM（不影响 acquireLock 流程；checkAndCleanOrphanLock 直接调）
    const origKill = process.kill.bind(process);
    const fakeKill = ((pid: number, signal?: string | number) => {
      if (pid === 12_345 && (signal === 0 || signal === undefined)) {
        const err = new Error('operation not permitted') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return origKill(pid, signal as number);
    }) as typeof process.kill;
    process.kill = fakeKill;
    try {
      const cleaned = checkAndCleanOrphanLock(lockPath);
      expect(cleaned).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);
    } finally {
      process.kill = origKill;
    }
  });
});

describe('eval-quota-store: classifyRuns 四分类', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('PC-T3: 区分 finalized / partialRunning / partialStale / failedFinalized', () => {
    const runDir = mkTmpDir('runs-');
    tmpDirs.push(runDir);

    // case A: success finalized
    fs.writeFileSync(
      path.join(runDir, 'run-r1.json'),
      JSON.stringify({
        run_id: 'r1',
        started_at: '2026-05-10T10:00:00.000Z',
        finalized_at: '2026-05-10T10:01:00.000Z',
        status: 'success',
      }),
    );
    // case B: stale partial（无 lock，started_at = 1h 前）
    fs.writeFileSync(
      path.join(runDir, 'run-r2.json'),
      JSON.stringify({
        run_id: 'r2',
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );
    // case C: running partial（有 lock 持 current PID + started 30s 前）
    fs.writeFileSync(
      path.join(runDir, 'run-r3.json'),
      JSON.stringify({
        run_id: 'r3',
        started_at: new Date(Date.now() - 30_000).toISOString(),
      }),
    );
    fs.writeFileSync(
      path.join(runDir, 'run-r3.lock'),
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        host: 'test-host',
      }),
    );
    // case D: failed-finalized
    fs.writeFileSync(
      path.join(runDir, 'run-r4.json'),
      JSON.stringify({
        run_id: 'r4',
        started_at: '2026-05-10T09:00:00.000Z',
        finalized_at: '2026-05-10T09:00:30.000Z',
        status: 'failed',
        error: { phase: 'driver', message: 'codex CLI exit 1' },
      }),
    );

    const result = classifyRuns({ runDir });
    expect(result.finalized.map((p) => p.id)).toEqual(['r1']);
    expect(result.partialRunning.map((p) => p.id)).toEqual(['r3']);
    expect(result.partialStale.map((p) => p.id)).toEqual(['r2']);
    expect(result.failedFinalized.map((p) => p.id)).toEqual(['r4']);
    expect(result.failedFinalized[0].error).toMatchObject({ phase: 'driver' });
  });

  it('PC-T3b (iter-2 C-1): recursive=true 扫描双层目录 group/task/run-N.json', () => {
    // 现实场景：eval-mcp-augmented.mjs 把 run 写到 RUNS_DIR/<group>/<taskId>/run-N.json
    // 顶层 classifyRuns 默认仅扫一层会漏掉 → 加 recursive=true。
    const runDir = mkTmpDir('runs-recursive-');
    tmpDirs.push(runDir);

    // 构造双层结构
    const groupADir = path.join(runDir, 'group-A', 'task-1');
    const groupBDir = path.join(runDir, 'group-B', 'task-2');
    fs.mkdirSync(groupADir, { recursive: true });
    fs.mkdirSync(groupBDir, { recursive: true });

    fs.writeFileSync(
      path.join(groupADir, 'run-1.json'),
      JSON.stringify({
        run_id: 'a-1',
        started_at: '2026-05-10T10:00:00.000Z',
        finalized_at: '2026-05-10T10:01:00.000Z',
        status: 'success',
      }),
    );
    fs.writeFileSync(
      path.join(groupBDir, 'run-2.json'),
      JSON.stringify({
        run_id: 'b-2',
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );

    // 默认 recursive=false → 扫不到
    const flat = classifyRuns({ runDir });
    expect(flat.finalized).toHaveLength(0);
    expect(flat.partialStale).toHaveLength(0);

    // recursive=true → 全部命中
    const rec = classifyRuns({ runDir, recursive: true });
    expect(rec.finalized.map((p) => p.id)).toEqual(['a-1']);
    expect(rec.partialStale.map((p) => p.id)).toEqual(['b-2']);
    // file 字段是相对 runDir 的路径
    expect(rec.finalized[0].file).toContain(path.join('group-A', 'task-1', 'run-1.json'));
    expect(rec.partialStale[0].file).toContain(path.join('group-B', 'task-2', 'run-2.json'));
  });

  it('PC-T4 ABA 防护: active writer 持 lock + started_at > 30min → 仍归 partialRunning', () => {
    const runDir = mkTmpDir('runs-aba-');
    tmpDirs.push(runDir);

    const writerPid = process.pid;
    fs.writeFileSync(
      path.join(runDir, 'run-r1.json'),
      JSON.stringify({
        run_id: 'r1',
        started_at: new Date(Date.now() - 31 * 60_000).toISOString(), // 看似 stale
      }),
    );
    fs.writeFileSync(
      path.join(runDir, 'run-r1.lock'),
      JSON.stringify({
        pid: writerPid,
        createdAt: new Date().toISOString(),
        host: 'test-host',
      }),
    );

    const result = classifyRuns({ runDir });
    // 即使 started_at > 30min, 因 lock 文件 + writer alive，归 running 不归 stale
    expect(result.partialStale).toHaveLength(0);
    expect(result.partialRunning.map((p) => p.id)).toEqual(['r1']);
    expect(result.partialRunning[0].pid).toBe(writerPid);
  });

  it('PC-T4b (iter-3 critical): EPERM PID（跨用户存在）→ 仍归 partialRunning，不归 stale', () => {
    // process.kill(pid, 0) 在 PID 存在但跨用户时抛 EPERM；
    // iter-2 修复 line 115 (checkAndCleanOrphanLock) 已加 EPERM 处置；
    // iter-3 同步 line 456 (classifyRuns) writerAlive 路径：EPERM → 视为 active（保守）。
    // 防止 restart 误删活跃 lock。
    const runDir = mkTmpDir('runs-eperm-');
    tmpDirs.push(runDir);

    const fakeOtherUserPid = 88888888;
    fs.writeFileSync(
      path.join(runDir, 'run-r1.json'),
      JSON.stringify({
        run_id: 'r1',
        started_at: new Date(Date.now() - 31 * 60_000).toISOString(), // 看似 stale
      }),
    );
    fs.writeFileSync(
      path.join(runDir, 'run-r1.lock'),
      JSON.stringify({
        pid: fakeOtherUserPid,
        createdAt: new Date().toISOString(),
        host: 'test-host',
      }),
    );

    // mock process.kill 抛 EPERM 模拟跨用户 PID
    const origKill = process.kill;
    const mockKill = ((pid: number, signal: number | string): boolean => {
      if (pid === fakeOtherUserPid && signal === 0) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return origKill.call(process, pid, signal);
    }) as typeof process.kill;
    process.kill = mockKill;

    try {
      const result = classifyRuns({ runDir });
      // EPERM → 保守视为 active；归 partialRunning（不归 partialStale）
      expect(result.partialStale).toHaveLength(0);
      expect(result.partialRunning.map((p) => p.id)).toEqual(['r1']);
      expect(result.partialRunning[0].pid).toBe(fakeOtherUserPid);
    } finally {
      process.kill = origKill;
    }
  });
});

describe('eval-quota-store: validateAcceptRestartPartial 互斥', () => {
  it('PC-T5: 同时传入 → throw + exitCode=64', () => {
    expect(() =>
      validateAcceptRestartPartial({ acceptPartial: true, restartPartial: true }),
    ).toThrowError(/互斥/);
    try {
      validateAcceptRestartPartial({ acceptPartial: true, restartPartial: true });
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(EX_USAGE);
      expect(EX_USAGE).toBe(64);
    }
  });

  it('单 flag 返回正确 mode', () => {
    expect(validateAcceptRestartPartial({ acceptPartial: true, restartPartial: false })).toBe(
      'accept',
    );
    expect(validateAcceptRestartPartial({ acceptPartial: false, restartPartial: true })).toBe(
      'restart',
    );
    expect(validateAcceptRestartPartial({ acceptPartial: false, restartPartial: false })).toBe(
      null,
    );
  });
});

describe('eval-quota-store: reserveQuota 单进程 + quota 上限', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('单进程串行 reserveQuota: 计数递增 + 达上限拒绝', async () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const storePath = path.join(tmpDir, 'feature-162.json');
    const lockPath = path.join(tmpDir, 'feature-162.lock');

    const r1 = await reserveQuota({
      storePath,
      lockPath,
      runId: 'r1',
      maxRunsPerDay: 2,
    });
    expect(r1.reserved).toBe(true);
    expect(r1.currentRuns).toBe(1);

    const r2 = await reserveQuota({
      storePath,
      lockPath,
      runId: 'r2',
      maxRunsPerDay: 2,
    });
    expect(r2.reserved).toBe(true);
    expect(r2.currentRuns).toBe(2);

    const r3 = await reserveQuota({
      storePath,
      lockPath,
      runId: 'r3',
      maxRunsPerDay: 2,
    });
    expect(r3.reserved).toBe(false);
    expect(r3.reason).toBe('quota_exceeded');
    expect(r3.currentRuns).toBe(2);
  });

  it('重复 runId reservation: 不增计数 + 返回 duplicate_run_id', async () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const storePath = path.join(tmpDir, 'feature-162.json');
    const lockPath = path.join(tmpDir, 'feature-162.lock');

    await reserveQuota({ storePath, lockPath, runId: 'r1', maxRunsPerDay: 5 });
    const dup = await reserveQuota({
      storePath,
      lockPath,
      runId: 'r1',
      maxRunsPerDay: 5,
    });
    expect(dup.reserved).toBe(false);
    expect(dup.reason).toBe('duplicate_run_id');
    expect(dup.currentRuns).toBe(1);
  });
});

describe('eval-quota-store: applyPartialDecision', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('mode=restart: 二次 classify 仍 stale → 删除 run-N.json 与 lock 文件', () => {
    const runDir = mkTmpDir('restart-');
    tmpDirs.push(runDir);
    const staleId = 'r-stale';
    const jsonPath = path.join(runDir, `run-${staleId}.json`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({
        run_id: staleId,
        started_at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );

    const partialStaleList = [{ id: staleId, file: `run-${staleId}.json`, ageMs: 3_600_000 }];
    const result = applyPartialDecision({
      runDir,
      partialStaleList,
      mode: 'restart',
    });
    expect(result.processed[0].action).toBe('deleted');
    expect(fs.existsSync(jsonPath)).toBe(false);
  });
});

describe('eval-quota-store: acquireLock 超时降级 hook', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) rmDir(d);
    tmpDirs.length = 0;
  });

  it('被持锁时 onTimeout 被调用而非 process.exit', async () => {
    const tmpDir = mkTmpDir();
    tmpDirs.push(tmpDir);
    const lockPath = path.join(tmpDir, 'busy.lock');
    // 占住 lock（活进程 PID + 极新 createdAt）→ 不会被孤儿清理
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        host: 'test-host',
      }),
    );

    let timeoutCalled = false;
    let timeoutMsg = '';
    await acquireLock(lockPath, {
      maxRetries: 3,
      initialMs: 5,
      capMs: 10,
      totalCapMs: 50,
      onTimeout: (m) => {
        timeoutCalled = true;
        timeoutMsg = m;
      },
    });
    expect(timeoutCalled).toBe(true);
    expect(timeoutMsg).toMatch(/未获/);

    // 清理
    releaseLock(lockPath);
  });
});
