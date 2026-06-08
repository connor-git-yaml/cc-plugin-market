/**
 * Feature 176 — cohort 3 spike 的输入准备（codex Tasks C-2：spike 输入无前置任务）。
 *
 * spike(T-B1) 要证明「claude --print 下 spec-driver sub-agent 能调
 * mcp__plugin_spectra_spectra__*」。为让 spike 失败时能干净归因（是 plugin-MCP
 * 不传播，还是输入没建好），本模块负责把 spike 的输入备齐：
 *   1. 一个最小但有真实跨文件依赖的 wtDir（git 仓）；
 *   2. 在其中跑 spectra batch code-only 生成 specs/_meta/graph.json，
 *      让 spectra MCP 的 context/impact/graph 工具有可查询的图。
 *
 * 设计为最小自包含（不依赖 ~/.spectra-baselines clone），降低 spike 环境前提。
 * 关联：tasks T-A5，spec FR-A-007b。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from './swe-bench-verified-paths.mjs';

/** 最小 fixture 源码：两个有清晰依赖的模块 + 一个琐碎可解 task。 */
const FIXTURE_FILES = {
  'src/math.ts':
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n\n' +
    'export function multiply(a: number, b: number): number {\n  let acc = 0;\n  for (let i = 0; i < b; i++) acc = add(acc, a);\n  return acc;\n}\n',
  'src/calculator.ts':
    "import { add, multiply } from './math.js';\n\n" +
    'export class Calculator {\n' +
    '  sumThenScale(values: number[], factor: number): number {\n' +
    '    const total = values.reduce((acc, v) => add(acc, v), 0);\n' +
    '    return multiply(total, factor);\n  }\n}\n',
  'README.md': '# spike-fixture\n\nMinimal repo for F176 cohort-3 plugin-MCP spike.\n',
};

/** 给 spike 用的琐碎任务（要求改 math.ts，影响 calculator.ts —— 适合触发 impact/context 查询）。 */
export const SPIKE_TASK_PROMPT =
  '在 src/math.ts 增加一个 `subtract(a, b)` 函数（返回 a - b），' +
  '并在 src/calculator.ts 的 Calculator 类增加一个 `difference(a, b)` 方法调用它。' +
  '保持 TypeScript 风格一致。';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
  if (r.status !== 0) {
    throw new Error(`[spike-prep] ${cmd} ${args.join(' ')} 失败: exit=${r.status}\n${(r.stderr ?? '').slice(0, 600)}`);
  }
  return r;
}

/**
 * 准备 spike wtDir + spectra graph。
 * @param {object} [opts] { wtDir?, distCli? }
 * @returns {{ wtDir:string, graphPath:string, taskPrompt:string }}
 */
export function prepareSpikeFixture(opts = {}) {
  // 唯一目录（codex WARNING：固定 tmp 路径并行/残留互相删除）。可传 wtDir 覆盖（测试用）。
  const wtDir = opts.wtDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'f176-spike-fixture-'));
  const distCli = opts.distCli ?? path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
  if (!fs.existsSync(distCli)) {
    throw new Error(`[spike-prep] dist 不存在: ${distCli}；先 node scripts/build-spectra-stamped.mjs`);
  }

  // 1. 干净重建 wtDir
  fs.rmSync(wtDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(wtDir, 'src'), { recursive: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = path.join(wtDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
  }
  // 2. git init（spectra batch + eval worktree 语义需要 git 仓）
  run('git', ['init', '-q'], { cwd: wtDir });
  run('git', ['-C', wtDir, 'add', '-A']);
  run('git', ['-C', wtDir, '-c', 'user.email=spike@f176', '-c', 'user.name=spike', 'commit', '-q', '-m', 'spike fixture']);

  // 3. spectra batch code-only → specs/_meta/graph.json
  const batch = spawnSync('node', [distCli, 'batch', '--mode', 'code-only', '--no-html', '--full'], {
    cwd: wtDir, encoding: 'utf-8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
  });
  if (batch.status !== 0) {
    throw new Error(`[spike-prep] spectra batch 失败: exit=${batch.status}\n${(batch.stderr ?? '').slice(0, 800)}`);
  }
  const graphPath = path.join(wtDir, 'specs', '_meta', 'graph.json');
  if (!fs.existsSync(graphPath)) {
    throw new Error(`[spike-prep] graph.json 未生成: ${graphPath}`);
  }
  return { wtDir, graphPath, taskPrompt: SPIKE_TASK_PROMPT };
}
