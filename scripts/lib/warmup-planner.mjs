#!/usr/bin/env node
/**
 * @fileoverview F206 warmup 规划：按真实 env key (repo@version) 去重生成串行预热 job。
 *
 * 背景（codex C-2 修复）：
 *   SWE-bench env 镜像按 (repo, version) 缓存（harness --cache_level env）。并行 run 若同时
 *   cold-build 同一 env 镜像会 race（docker 无跨进程 build 锁）。预热合同要求"每 unique env
 *   串行建一次"，让首个并行 run 起跑时镜像已暖。
 *
 *   旧实现仅 `slice(0, 1)` 只覆盖首个 env；多 repo / 多 version 仍会并发 cold-build。
 *   本模块按 (repo, version) 去重，每个 unique env 产出 1 个代表预热 job。
 *
 *   version 不在 fixture 内（仅 swebenchMeta.instanceId），需经 buildLocalDataset 批量取官方行解析；
 *   取不到时（venv 缺 / 网络 / 外部 pool 无 swebenchMeta）降级为"按 instance_id 前缀 repo 去重"
 *   —— 覆盖多 repo，但残留"同 repo 多 version"并发 cold-build 风险（见 calibration-runbook.md）。
 */

import { buildLocalDataset } from './swebench-dataset-build.mjs';

/**
 * 从 SWE-bench instance_id（`<org>__<repo>-<num>`）解析 repo（`<org>/<repo>`）。
 * repo 名可含连字符（如 scikit-learn），故只剥离结尾的 `-<digits>`。
 * 解析失败时原样返回，保证去重 key 仍稳定。
 *
 * @param {string} instanceId
 * @returns {string}
 */
export function repoFromInstanceId(instanceId) {
  const m = /^(.+?)__(.+)-\d+$/.exec(String(instanceId ?? ''));
  if (!m) return String(instanceId ?? 'unknown');
  return `${m[1]}/${m[2]}`;
}

/**
 * 提取 fixture 的 **taskId**（= fixture 文件名 stem，如 `SWE-V001-sympy-...`）。
 * 这是 eval-task-runner `--task` 的取值，区别于 oracle 用的 swebenchMeta.instanceId。
 *
 * @param {object|string} fixture
 * @returns {string|null}
 */
export function taskIdOf(fixture) {
  if (typeof fixture === 'string') return fixture;
  return fixture?.taskId ?? fixture?.task ?? fixture?.swebenchMeta?.instanceId ?? fixture?.instance_id ?? null;
}

/**
 * 提取 fixture 的 **SWE-bench instanceId**（如 `sympy__sympy-24661`）。
 * 用于 buildLocalDataset 取官方行解析 (repo, version) env key；非 --task 取值。
 *
 * @param {object|string} fixture
 * @returns {string|null}
 */
export function instanceIdOf(fixture) {
  if (typeof fixture === 'string') return fixture;
  return fixture?.swebenchMeta?.instanceId ?? fixture?.instance_id ?? null;
}

/**
 * 默认 env key 解析：经 buildLocalDataset 批量取官方行，构建 instanceId → `${repo}@${version}`。
 * 抛错（venv 缺 / 网络 / fixture 无 swebenchMeta）由 planWarmupJobs 捕获后降级。
 *
 * @param {object[]} fixtures  -- 须含 swebenchMeta.instanceId
 * @param {object} [opts]
 * @param {string} [opts.venvPath]
 * @param {Function} [opts.fetchRows]  -- 注入官方行获取器（测试用，免跑真 venv/Python）
 * @returns {Map<string, string>}  instanceId → envKey
 */
export function resolveEnvKeysViaDataset(fixtures, opts = {}) {
  const { venvPath, fetchRows } = opts;
  const { rows } = buildLocalDataset({
    fixtures,
    venvPath: venvPath ?? 'scripts/.swebench-venv',
    ...(fetchRows ? { fetchRows } : {}),
  });
  const map = new Map();
  for (const row of rows ?? []) {
    const iid = row.instance_id ?? row.instanceId;
    if (!iid) continue;
    const repo = row.repo ?? repoFromInstanceId(iid);
    const version = row.version ?? 'unknown';
    map.set(iid, `${repo}@${version}`);
  }
  return map;
}

/**
 * 规划串行预热 job：按 unique env 去重，每 env 一个代表 job（repeatNo=0）。
 *
 * @param {(object|string)[]} fixtures  -- 目标任务 fixture 对象（或 instanceId 字符串）
 * @param {object} opts
 * @param {string} opts.cohort
 * @param {string} [opts.tool='spec-driver']
 * @param {string} [opts.fixtureDir]
 * @param {string[]} [opts.extraArgs=['--swebench-oracle']]
 * @param {Function} [opts.resolveEnvKeys]  -- (fixtures) => Map<instanceId, envKey>；默认走 dataset 批量解析
 * @param {string}  [opts.venvPath]
 * @param {Function} [opts.fetchRows]       -- 透传给默认 resolver（测试用）
 * @param {Function} [opts.onDegrade]       -- (err) => void：env 解析失败、降级 repo-only 去重时回调
 * @returns {{ task:string, tool:string, cohort:string, repeatNo:number, fixtureDir?:string, extraArgs:string[], envKey:string }[]}
 */
export function planWarmupJobs(fixtures, opts = {}) {
  const {
    cohort,
    tool = 'spec-driver',
    fixtureDir,
    extraArgs = ['--swebench-oracle'],
    resolveEnvKeys,
    venvPath,
    fetchRows,
    onDegrade,
  } = opts;

  // 1) 解析每个 instance 的 env key（repo@version）；失败则降级 repo-only
  let envByInstance = null;
  try {
    const resolved = resolveEnvKeys
      ? resolveEnvKeys(fixtures)
      : resolveEnvKeysViaDataset(fixtures, { venvPath, fetchRows });
    if (!(resolved instanceof Map)) throw new Error('resolveEnvKeys 未返回 Map');
    envByInstance = resolved;
  } catch (err) {
    // 降级：仅按 instance_id 前缀 repo 去重（覆盖多 repo；残留同 repo 多 version 风险）
    if (onDegrade) onDegrade(err);
  }

  // 2) 按 env key 去重，保留首个代表
  //    job.task 用 taskId（--task 取值）；env key 用 instanceId（repo@version）解析
  const seen = new Set();
  const jobs = [];
  for (const fx of fixtures) {
    const taskId = taskIdOf(fx);
    if (!taskId) continue;
    const iid = instanceIdOf(fx);
    // 解析成功用 repo@version；缺该实例或整体降级则退回 repo:<org/repo>（从 instanceId 解析）
    const envKey = (iid && envByInstance && envByInstance.get(iid)) || `repo:${repoFromInstanceId(iid ?? taskId)}`;
    if (seen.has(envKey)) continue;
    seen.add(envKey);
    jobs.push({
      task: taskId, tool, cohort, repeatNo: 0,
      ...(fixtureDir ? { fixtureDir } : {}),
      extraArgs: [...extraArgs],
      envKey,
    });
  }
  return jobs;
}
