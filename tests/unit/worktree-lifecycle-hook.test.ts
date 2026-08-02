/**
 * Feature 239 — worktree-lifecycle hook 失败可见性测试（T029 / FR-009 / SC-008）
 *
 * hook 的 `create` 分支此前是 `bash scripts/sync-worktree-local-state.sh 2>/dev/null || true`：
 * 同步脚本的任何失败都被静默吞掉，新 worktree 会带着"看起来成功"的假象继续跑。
 * 本测试要求：失败**可见**（stderr 内容透传到 hook 输出），但**不阻断**（hook 仍 exit 0）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOK_PATH = path.join(REPO_ROOT, 'plugins/spec-driver/hooks/worktree-lifecycle.sh');
const REAL_SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts/sync-worktree-local-state.sh');
const REAL_STATUS_HELPER = path.join(REPO_ROOT, 'scripts/lib/graph-bootstrap-status.mjs');

interface HookResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** 以 create 事件驱动 hook；cwd 决定 hook 找到哪个 `scripts/sync-worktree-local-state.sh`。 */
function runHook(cwd: string, extraEnv: Record<string, string> = {}): HookResult {
  const r = spawnSync('bash', [HOOK_PATH], {
    cwd,
    encoding: 'utf-8',
    input: JSON.stringify({ action: 'create', worktree_path: cwd }),
    env: { ...process.env, ...extraEnv },
  });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 0 };
}

describe('Feature 239 — worktree-lifecycle hook create 分支失败可见性（FR-009）', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-lifecycle-hook-'));
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('(a) 同步脚本非零退出时，其 stderr 内容在 hook 输出中可见，且 hook 自身 exit 0', () => {
    // 固定 stderr 内容 + 非零退出码的 fixture：内容固定才能做精确断言，
    // 非零退出码才能触发"失败路径"而不是正常路径。
    const scriptDir = path.join(sandbox, 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptDir, 'sync-worktree-local-state.sh'),
      '#!/usr/bin/env bash\necho "SYNC-FIXTURE-FAILURE-MARKER" >&2\nexit 7\n',
      { mode: 0o755 },
    );

    const r = runHook(sandbox);

    // 失败可见
    expect(`${r.stdout}${r.stderr}`).toContain('SYNC-FIXTURE-FAILURE-MARKER');
    // 但不阻断：hook 自身仍以 0 退出
    expect(r.status).toBe(0);
  });

  it('(a2) 同步脚本以 0 退出时不追加失败注记（注记只属于失败路径）', () => {
    const scriptDir = path.join(sandbox, 'scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptDir, 'sync-worktree-local-state.sh'),
      '#!/usr/bin/env bash\necho "routine log" >&2\nexit 0\n',
      { mode: 0o755 },
    );

    const r = runHook(sandbox);

    expect(r.status).toBe(0);
    // 脚本的常规输出照常透传（降级 warning 正是靠这条通道被看见）……
    expect(`${r.stdout}${r.stderr}`).toContain('routine log');
    // ……但"以退出码 N 结束"的失败注记不得出现在成功路径上
    expect(`${r.stdout}${r.stderr}`).not.toContain('同步脚本以退出码');
  });

  it('(b) PATH 剥离 node：warning 可见 + copy 与 SYMLINK_TARGETS 步骤仍完成 + exit 0', () => {
    // 真实 worktree fixture + 真实同步脚本，端到端验证"node 缺失不致中断"
    const primaryDir = path.join(sandbox, 'primary');
    const worktreeDir = path.join(sandbox, 'worktrees', 'feature-x');
    fs.mkdirSync(primaryDir, { recursive: true });
    execSync('git init -q', { cwd: primaryDir });
    execSync('git config user.email test@example.com', { cwd: primaryDir });
    execSync('git config user.name Test', { cwd: primaryDir });
    fs.writeFileSync(path.join(primaryDir, '.gitignore'), '.env.local\n');
    fs.writeFileSync(path.join(primaryDir, '.worktreeinclude'), '.env.local\n');
    execSync('git add -A', { cwd: primaryDir });
    execSync('git commit -q -m init', { cwd: primaryDir });
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    execSync(`git worktree add -q -b feature-x "${worktreeDir}"`, { cwd: primaryDir });

    // hook 按 cwd 相对路径找同步脚本，因此把真实脚本与其 helper 放进 worktree
    const wtScriptLib = path.join(worktreeDir, 'scripts', 'lib');
    fs.mkdirSync(wtScriptLib, { recursive: true });
    fs.copyFileSync(REAL_SYNC_SCRIPT, path.join(worktreeDir, 'scripts/sync-worktree-local-state.sh'));
    fs.copyFileSync(REAL_STATUS_HELPER, path.join(wtScriptLib, 'graph-bootstrap-status.mjs'));

    fs.writeFileSync(path.join(primaryDir, '.env.local'), 'KEY=secret\n');
    fs.writeFileSync(path.join(primaryDir, 'CLAUDE.local.md'), '# 本地约定\n');

    // 最小 PATH：保留 git/bash，剔除 node 所在目录
    const r = runHook(worktreeDir, { PATH: '/usr/bin:/bin' });

    const combined = `${r.stdout}${r.stderr}`;
    expect(r.status).toBe(0);
    // node 缺失的 warning 必须可见（脚本内部已产出，此前被 hook 吞掉）
    expect(combined).toContain('node 不可用');
    // 其余步骤照常完成
    expect(fs.readFileSync(path.join(worktreeDir, '.env.local'), 'utf-8')).toBe('KEY=secret\n');
    expect(fs.lstatSync(path.join(worktreeDir, 'CLAUDE.local.md')).isSymbolicLink()).toBe(true);
  });

  it('同步脚本不存在时 hook 静默跳过并 exit 0（既有行为不回归）', () => {
    const r = runHook(sandbox);
    expect(r.status).toBe(0);
  });
});
