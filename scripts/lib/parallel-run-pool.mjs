/**
 * @fileoverview F206 T-C0：并发受限的并行 run 执行器。
 *
 * 调用方式（C1/C3 使用）：
 *   const pool = new ParallelRunPool({ concurrency: 4, budgetMs: 35*60*1000, runTimeoutMs: 20*60*1000 });
 *   const results = await pool.run(jobs);  // Job[] → RunResult[]
 *
 * 🔴 Docker 安全合同（codex 5 CRITICAL）：
 *   C-1：exit 3（infra）与 exit 4（gen-timeout）语义区分（eval-task-runner T-C0a 已拆）。
 *   C-2：C0 本身不做 env 镜像预热；调用方（C1/C3）如需并行跑真 oracle，应先串行预热。
 *         本文件提供 serialWarmup(jobs, opts) 辅助函数。
 *   C-3/C-4：每个 job 必须带 uniqueKey（调用方保证），pool 生成含 seqNo 的 --repeat-index
 *             和 --fixture-suffix，防止并发容器名冲突 + fixture 互覆盖。
 *   C-5：每路 run 以 detached:true 建独立进程组；over-budget/kill 时
 *         process.kill(-pgid, 'SIGKILL') 杀整棵子树，防 claude/python/docker 游离。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(PROJECT_ROOT, 'scripts/eval-task-runner.mjs');

/** exit 3 = infra 失败（剔分母/可重跑）；exit 4 = 生成超时（能力 fail，不剔） */
export const EXIT_INFRA = 3;
export const EXIT_GEN_TIMEOUT = 4;

/**
 * 把子进程退出码 + 信号映射为 RunResult.status（纯函数，便于单测覆盖运行时分类）。
 * - SIGKILL 或 code=-1（over-budget/run-timeout kill）→ gen_timeout
 * - 0 → success；EXIT_INFRA(3) → infra；EXIT_GEN_TIMEOUT(4) → gen_timeout；其余非零 → error
 *
 * @param {number} exitCode  -- proc close 的 code，缺失按 -1
 * @param {string|null} signal -- proc close 的 signal
 * @returns {'success'|'infra'|'gen_timeout'|'error'}
 */
export function classifyExitStatus(exitCode, signal) {
  if (signal === 'SIGKILL' || exitCode === -1) return 'gen_timeout';
  if (exitCode === 0) return 'success';
  if (exitCode === EXIT_INFRA) return 'infra';
  if (exitCode === EXIT_GEN_TIMEOUT) return 'gen_timeout';
  return 'error';
}

/**
 * 单个并行 run 的 job 描述。
 * @typedef {object} RunJob
 * @property {string} task        -- eval-task-runner --task
 * @property {string} tool        -- eval-task-runner --tool
 * @property {string} cohort      -- eval-task-runner --cohort（c1/c3/…）
 * @property {number} repeatNo    -- 同 task/tool/cohort 的第几次重复（1-indexed）
 * @property {string} [fixtureDir] -- 保留字段，当前不透传给 runner（eval-task-runner 无 --fixture-dir flag，codex W-3）
 * @property {string[]} [extraArgs] -- 追加到 runner 的额外参数
 */

/**
 * 单个 run 的结果。
 * @typedef {object} RunResult
 * @property {string} task
 * @property {string} tool
 * @property {string} cohort
 * @property {number} repeatNo
 * @property {'success'|'infra'|'gen_timeout'|'error'} status
 *   - success: runner exit 0 + fixture 产出
 *   - infra: runner exit 3（OAuth/API 错误，剔分母）
 *   - gen_timeout: runner exit 4（生成超时，计入分母算 fail）
 *   - error: 其他非零退出码 / spawn 错误
 * @property {number} exitCode
 * @property {number} wallMs
 * @property {string} [fixturePath]  -- exit 0 时产出的 fixture 路径
 * @property {string} [error]        -- 错误描述
 * @property {number} seqNo          -- pool 内顺序号（0-indexed），用于 debug
 */

/**
 * 并发受限的并行 run 执行器。
 *
 * @param {object} opts
 * @param {number} [opts.concurrency=4]        -- 最大并发 run 数（docker 安全：不超过机器 cpu/2）
 * @param {number} [opts.budgetMs=35*60*1000]  -- 整批硬墙钟上限（C-5）
 * @param {number} [opts.runTimeoutMs=20*60*1000] -- 单 run 超时（传给 runner --swebench-timeout-ms）
 * @param {boolean} [opts.dryRun=false]        -- dry-run：不 spawn runner，仅返回计划
 * @param {Function} [opts.onProgress]         -- (result: RunResult, done: number, total: number) => void
 * @param {string} [opts.driverModel=DEFAULT_DRIVER_MODEL] -- driver 模型（eval 用 Sonnet 省 token）
 * @param {string} [opts.outputFormat='stream-json']      -- claude --print 输出格式（token 采集）
 */
/** 校准/验证批默认 driver 模型（单一事实源：preflight 连接门禁必须测同一模型，codex W-2） */
export const DEFAULT_DRIVER_MODEL = 'claude-sonnet-4-6';

export class ParallelRunPool {
  constructor({
    concurrency = 4,
    budgetMs = 35 * 60 * 1000,
    runTimeoutMs = 20 * 60 * 1000,
    dryRun = false,
    onProgress = null,
    driverModel = DEFAULT_DRIVER_MODEL,
    outputFormat = 'stream-json',
  } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.budgetMs = budgetMs;
    this.runTimeoutMs = runTimeoutMs;
    this.dryRun = dryRun;
    this.onProgress = onProgress;
    this.driverModel = driverModel;
    this.outputFormat = outputFormat;
  }

  /**
   * 并行跑所有 jobs，返回 RunResult[]（顺序与 jobs 一致）。
   * @param {RunJob[]} jobs
   * @returns {Promise<RunResult[]>}
   */
  async run(jobs) {
    if (this.dryRun) {
      return jobs.map((j, i) => ({
        ...j, seqNo: i, status: 'success', exitCode: 0, wallMs: 0,
        fixturePath: `[dry-run]/${j.task}/${j.tool}-${j.cohort}-r${j.repeatNo}/full.json`,
      }));
    }

    const results = new Array(jobs.length).fill(null);
    const budgetDeadline = Date.now() + this.budgetMs;
    // 追踪所有活跃子进程组（pgid = proc.pid）以便 over-budget kill
    const active = new Set(); // Set<{ seqNo, proc, pgid, exited }>
    let nextIdx = 0;
    let doneCount = 0;
    let overBudget = false;

    const tripOverBudget = () => {
      if (overBudget) return;
      overBudget = true;
      this._killAll(active, 'over-budget'); // kill 所有在飞 job 的进程组
    };

    // 预算看门狗（codex C-1 修复关键）：即使所有 worker 都阻塞在长 run 上，
    // 也能按时触发 over-budget；worker 内的 await 由 _killAll→SIGKILL→close 解除。
    const watchdog = setInterval(() => {
      if (Date.now() > budgetDeadline) tripOverBudget();
    }, 1000);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    // worker-pool 模型（替代旧的 dispatchNext 递归，消除 over-budget 死锁）：
    //   N 个 worker 共享 nextIdx 计数器，各自串行拉取 job 跑完再取下一个；
    //   over-budget 时 worker 在循环顶检测后直接 return，Promise.all 必然 resolve。
    const worker = async () => {
      while (true) {
        if (overBudget) return;
        const seqNo = nextIdx++;
        if (seqNo >= jobs.length) return;
        const res = await this._runOne(jobs[seqNo], seqNo, budgetDeadline, active);
        results[seqNo] = res;
        doneCount++;
        if (this.onProgress) this.onProgress(res, doneCount, jobs.length);
        if (Date.now() > budgetDeadline) tripOverBudget();
      }
    };

    const workerCount = Math.min(this.concurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    clearInterval(watchdog);

    // over-budget 后未启动的 job 填 error（worker 已全部 return，此处必达，不会死锁）
    for (let i = 0; i < jobs.length; i++) {
      if (results[i] === null) {
        results[i] = { ...jobs[i], seqNo: i, status: 'error', exitCode: -1, wallMs: 0, error: 'over-budget: pool stopped before this job ran' };
      }
    }
    return results;
  }

  /** 跑单个 job，返回 RunResult。内部自管理子进程组 + kill-on-timeout。保证恰好 resolve 一次。 */
  _runOne(job, seqNo, budgetDeadline, activeSet) {
    return new Promise((resolve) => {
      const uniqueSuffix = `${job.cohort}-r${job.repeatNo}`;
      const args = this._buildRunnerArgs(job, seqNo, uniqueSuffix);
      const startMs = Date.now();

      let settled = false;
      let slot = null;
      let timer = null;
      let fallbackTimer = null;
      // 单一出口：清理定时器 + 移除 active 槽 + 幂等 resolve（防 error/close/兜底 多次触发）
      const settle = (res) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (slot) activeSet.delete(slot);
        resolve(res);
      };

      let proc;
      try {
        // detached:true → 独立进程组（C-5 合同：kill(-pgid) 杀整棵子树）
        proc = spawn('node', [RUNNER, ...args], {
          cwd: PROJECT_ROOT,
          stdio: ['ignore', 'inherit', 'inherit'],
          detached: true,
        });
      } catch (err) {
        // 同步 spawn 失败（坏路径等）→ 不让异常逃出 Promise executor
        settle({ ...job, seqNo, status: 'error', exitCode: -1, wallMs: Date.now() - startMs, error: `spawn failed: ${err.message}` });
        return;
      }

      const pgid = proc.pid; // detached 下 pgid === pid
      slot = { seqNo, proc, pgid, exited: false };
      activeSet.add(slot);

      // 单 run 超时定时器（用 runTimeoutMs 和 budgetDeadline 取较小值）
      const runDeadlineMs = Math.min(this.runTimeoutMs, Math.max(0, budgetDeadline - Date.now()));
      timer = setTimeout(() => {
        this._killSlot(slot, 'run-timeout');
        // W-5 兜底：kill 后若 close 始终不来（孤儿/僵尸），10s 宽限后强制 settle，避免 worker 永久挂起
        fallbackTimer = setTimeout(() => settle({
          ...job, seqNo, status: 'gen_timeout', exitCode: -1,
          wallMs: Date.now() - startMs, error: 'killed (run-timeout); close 未在宽限期内到达',
        }), 10_000);
      }, runDeadlineMs);

      proc.on('error', (err) => {
        if (slot) slot.exited = true;
        settle({
          ...job, seqNo, status: 'error', exitCode: -1,
          wallMs: Date.now() - startMs, error: err.message,
        });
      });

      proc.on('close', (code, signal) => {
        if (slot) slot.exited = true; // W-1：标记已退出，_killSlot 据此跳过，缩小 pgid 复用误杀窗口
        const wallMs = Date.now() - startMs;
        const exitCode = code ?? -1;
        // SIGKILL = over-budget kill 或 run-timeout kill；分类逻辑抽为纯函数便于单测
        const status = classifyExitStatus(exitCode, signal);
        const fixturePath = exitCode === 0 ? this._fixturePath(job, uniqueSuffix) : undefined;
        settle({ ...job, seqNo, status, exitCode, wallMs, fixturePath });
      });
    });
  }

  /** 构建传给 eval-task-runner 的参数列表。 */
  _buildRunnerArgs(job, seqNo, uniqueSuffix) {
    // --repeat-index：影响 worktree 路径（rN）+ oracle runId（防容器名冲突，C-3/C-4）
    // F212 codex HIGH：优先用 job.repeatNo —— 原 seqNo+1 在"部分重跑"（resume 过滤后 jobs
    // 只剩 r2/r3）时会把 r2 以 repeat-index=1 跑，oracle runId 落到 …__r1 → purge/覆盖已跳过
    // r1 的 run_evaluation 现场（fixture 路径仍 r2，stats 看似正常但取证被污染）。唯一性契约
    // 移交调用方：(task,tool,repeatNo) 必须唯一（calibrate/validate/pool-rerun 均满足）。
    // 仅接受 ≥1 的 repeatNo：warmup-planner 刻意发 repeatNo:0（round-2 codex HIGH——0 会被
    // eval-task-runner 的 --repeat-index ≥1 校验拒掉，预热全断）与无 repeatNo 的 legacy job
    // 一样回退 seqNo+1 保持旧行为。
    const repeatIdx = (Number.isInteger(job.repeatNo) && job.repeatNo >= 1) ? job.repeatNo : (seqNo + 1);
    // 驱动参数与 canonical cohort-batch runOne 逐项对齐：cohort 经 job.tool 体现（不传 --cohort，
    // eval-task-runner 无此 flag），真实 skill 调用 + stdin 传 prompt + 免交互权限 + 成功即清理。
    // 缺这些会让 spec-driver cohort 退化成"提示词"模式（Task spawn=0）或卡权限确认。
    const args = [
      '--task', job.task,
      '--tool', job.tool,
      '--repeat-index', String(repeatIdx),
      '--fixture-suffix', uniqueSuffix, // 防 fixture 互覆盖（C-3）
      '--swebench-timeout-ms', String(this.runTimeoutMs),
      '--bypass-permissions',
      '--cleanup', 'on-success',
      '--prompt-via-stdin',
      '--skill-invocation',
      '--model', this.driverModel,
      '--output-format', this.outputFormat,
    ];
    // 注：不传 --fixture-dir —— eval-task-runner 无此 flag（会 unknown-flag throw）；
    // fixture 路径由 runner 按 <task>/<tool>-<suffix> 自定，job.fixtureDir 字段保留但不透传（codex W-3）。
    if (job.extraArgs) args.push(...job.extraArgs);
    return args;
  }

  /** 计算 runner 产出的 fixture 路径（exit 0 时）。 */
  _fixturePath(job, uniqueSuffix) {
    // 与 eval-task-runner line 784-785 一致：
    // tests/baseline/tasks/<task>/<tool>-<fixtureSuffix>/full.json
    return path.join(PROJECT_ROOT, 'tests/baseline/tasks', job.task,
      `${job.tool}-${uniqueSuffix}`, 'full.json');
  }

  /** kill 所有活跃槽（over-budget 时）。 */
  _killAll(activeSet, reason) {
    for (const slot of activeSet) {
      this._killSlot(slot, reason);
    }
  }

  /** kill 单个槽的整棵进程树（C-5 合同）。 */
  _killSlot(slot, reason) {
    if (slot.exited) return; // W-1：已 close，跳过 kill，避免误杀复用了同 pgid 的无关进程
    try {
      process.kill(-slot.pgid, 'SIGKILL'); // 杀整个进程组（包括 claude/python/docker）
    } catch (_) {
      // 进程已退出 / 进程组不存在，忽略
    }
  }
}

/**
 * 串行 env 预热辅助（C-2 合同）。
 * 在并行 run 之前，对每个 unique（instanceId/repo/version）串行跑一次 env 建镜像 run，
 * 确保后续并行 run 全部走暖缓存路径，无 cold-build race。
 *
 * 调用方传入 warmupJobs（通常每 unique env 仅 1 个 job），串行跑完后再起 ParallelRunPool。
 *
 * @param {RunJob[]} warmupJobs  -- 每个 unique env 一个代表 job
 * @param {object}  opts         -- 同 ParallelRunPool opts（但 concurrency 强制=1）
 * @returns {Promise<RunResult[]>}
 */
export async function serialWarmup(warmupJobs, opts = {}) {
  const pool = new ParallelRunPool({ ...opts, concurrency: 1 });
  return pool.run(warmupJobs);
}

/**
 * 从 RunResult[] 聚合 passRate 统计（C3 使用）。
 *
 * 语义（CR-3/spec FR-006）：
 *   - status='infra'   → 剔出分母（不算 pass/fail）
 *   - status='gen_timeout'/'error' → 计入分母算 fail
 *   - status='success' → oracle 结果 passed 决定 pass/fail
 *
 * ⚠️ 语义差异：校准主流程（eval-calibrate 的 aggregateRunResults）把 `error` 也剔分母
 * （error=runner 基础设施错误，非能力 fail，codex CRITICAL-2）。本 helper 保留 FR-006 原语义
 * （error 入分母）。**校准路径勿引用本 helper**；二者口径不同需有意对齐时再统一（validate 侧待评估）。
 *
 * @param {RunResult[]} results
 * @param {Function} [getOraclePassed]  -- (result: RunResult) => boolean|null
 *   null 同 infra（oracle 不可用，剔分母）；调用方从 fixture 读取
 * @returns {{ passRate: number|null, n_total: number, n_valid: number, n_pass: number, n_infra: number, n_gen_timeout: number, n_error: number, n_oracle_missing: number }}
 */
export function aggregatePassRate(results, getOraclePassed = null) {
  let n_infra = 0, n_gen_timeout = 0, n_error = 0, n_pass = 0, n_valid = 0, n_oracle_missing = 0;
  for (const r of results) {
    if (r.status === 'infra') {
      n_infra++;
      continue; // 剔分母
    }
    // gen_timeout / error / success 都入分母
    n_valid++;
    if (r.status === 'success') {
      // 从 fixture 读 oracle 结果
      const passed = getOraclePassed ? getOraclePassed(r) : null;
      if (passed === null) {
        // oracle 不可用，从 valid 分母中也剔（W-4：单独计数以便上层 fail-closed）
        n_valid--;
        n_oracle_missing++;
      } else if (passed) {
        n_pass++;
      }
    } else if (r.status === 'gen_timeout') {
      n_gen_timeout++; // 生成超时 = 能力 fail
    } else {
      n_error++; // W-6：其他非零退出/spawn 错误单独计数，不混入 gen_timeout（仍计入分母算 fail）
    }
  }
  const passRate = n_valid > 0 ? n_pass / n_valid : null;
  return { passRate, n_total: results.length, n_valid, n_pass, n_infra, n_gen_timeout, n_error, n_oracle_missing };
}
