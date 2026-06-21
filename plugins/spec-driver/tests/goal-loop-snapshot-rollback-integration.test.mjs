/**
 * goal-loop-snapshot-rollback-integration.test.mjs
 * Feature 203 — snapshot/rollback 真实 git 集成测试（Codex omission #2）
 *
 * 与 goal-loop-core.test.mjs（纯函数单测）不同：本文件在真实 temp git 仓库内**实际执行**
 * planSnapshotCommands / planRollbackCommands 规划出的命令字符串，验证文件系统副作用——
 * 重点验证 preserved config（untracked）不被 stash push -u / git clean -fd 卷走/删除。
 *
 * 执行约定（F203 修订 #4，关键）：core 返回的是**给 shell 执行的命令字符串**（含
 * ':(exclude)' pathspec、引号），必须用 execSync(cmdString, {cwd, encoding}) 经 /bin/sh 解析，
 * 禁止 execFileSync('git', splitArgv)（无法安全拆带引号 pathspec）。固定命令（git init/config/
 * add/commit、断言用 ls/cat）可用 execFileSync。
 *
 * 运行方式: node --test plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import {
  planSnapshotCommands,
  planRollbackCommands,
  assessPreservedConfigSafety,
  parsePreservedConfigStates,
  isCleanExcludingPreserved,
  PRESERVED_CONFIG_PATHSPECS,
} from '../scripts/lib/goal-loop-core.mjs';

// W5（环境健壮性）：受限沙箱里 os.tmpdir() 可能 EPERM；允许 TEST_TMPDIR 覆盖落点。
const TMP_ROOT = process.env.TEST_TMPDIR || os.tmpdir();
fs.mkdirSync(TMP_ROOT, { recursive: true });

const PRESERVED = '.specify/orchestration-overrides.yaml';

/** 在 cwd 经 /bin/sh 执行 core 规划出的命令字符串（修订 #4） */
function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf-8' });
}

/** 固定 git 命令用 execFileSync（无需 shell 解析） */
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** 建立一个带初始 commit 的 temp git 仓库，返回其路径 */
function setupRepo() {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, 'goal-loop-int-'));
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'goal-loop-test'], dir);
  git(['config', 'commit.gpgsign', 'false'], dir);
  // 确定性：强制 untracked 目录折叠为默认 normal 行为，使"折叠 → 需 -uall"对照断言
  // 不受全局 status.showUntrackedFiles=all 配置干扰（F203 codex 复审 test-robustness 加固）
  git(['config', 'status.showUntrackedFiles', 'normal'], dir);
  // 初始 tracked 文件 + commit，建立 HEAD
  fs.writeFileSync(path.join(dir, 'tracked-file.js'), 'export const x = 1;\n');
  git(['add', 'tracked-file.js'], dir);
  git(['commit', '-q', '-m', 'initial'], dir);
  return dir;
}

/** 写 untracked preserved config（含目录） */
function writePreserved(dir, relPath = PRESERVED, content = 'override: true\n') {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** 把 snapshot/rollback 命令字符串中的占位符替换为可执行实值 */
function fillSnapshotPlaceholders(cmd, repoDir) {
  let out = cmd.replace(/\{i\}/g, '1');
  if (out.includes('{stash_ref}')) {
    const ref = git(['rev-parse', 'stash@{0}'], repoDir).trim();
    out = out.replace(/\{stash_ref\}/g, ref);
  }
  return out;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('goal_loop snapshot/rollback 真实 git 集成（F203 缺陷 1）', () => {
  it('untracked-X-survives-snapshot: stash push -u 后 preserved untracked 仍存在', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir);
      // 制造一个 tracked 改动使工作区非 clean（isClean=false）
      fs.appendFileSync(path.join(dir, 'tracked-file.js'), '// change\n');
      const cmds = planSnapshotCommands(false);
      for (const raw of cmds) {
        sh(fillSnapshotPlaceholders(raw, dir), dir);
      }
      // pathspec 排除生效 → preserved 未被 stash 卷走，仍在工作区
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'preserved untracked 应在 snapshot 后存活');
    } finally {
      cleanup(dir);
    }
  });

  it('tracked-staged-X-preflight-blocks: staged preserved → assess 返回 safe=false', () => {
    const dir = setupRepo();
    try {
      // 先把 preserved 纳入 tracked 并 commit，再修改 + git add → staged
      writePreserved(dir, PRESERVED, 'v1\n');
      git(['add', PRESERVED], dir);
      git(['commit', '-q', '-m', 'track preserved'], dir);
      fs.writeFileSync(path.join(dir, PRESERVED), 'v2\n');
      git(['add', PRESERVED], dir);
      // preflight：assess 返回 safe=false → 编排器不进入 stash
      const safety = assessPreservedConfigSafety([{ path: PRESERVED, state: 'staged' }]);
      assert.equal(safety.safe, false);
      assert.equal(safety.unsafe[0].state, 'staged');
      // 不执行 stash，preserved 不丢失
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)));
    } finally {
      cleanup(dir);
    }
  });

  it('new-staged-X-preflight-blocks: 新增已 add 的 preserved → assess safe=false', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir);
      git(['add', PRESERVED], dir); // 新增已暂存
      const safety = assessPreservedConfigSafety([{ path: PRESERVED, state: 'staged' }]);
      assert.equal(safety.safe, false);
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)));
    } finally {
      cleanup(dir);
    }
  });

  it('isClean-true-no-commands: 干净仓库 planSnapshotCommands(true) → [] 不出错', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir); // untracked preserved 不影响"是否执行 [] 命令"的验证
      const cmds = planSnapshotCommands(true);
      assert.deepEqual(cmds, []);
      // 执行空命令序列（无操作）→ preserved 不受影响
      for (const raw of cmds) sh(fillSnapshotPlaceholders(raw, dir), dir);
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)));
    } finally {
      cleanup(dir);
    }
  });

  it('multi-preserved-paths-both-survive: 两 preserved untracked 经 snapshot 均存活', () => {
    const dir = setupRepo();
    try {
      const p2 = '.other/keep.yaml';
      writePreserved(dir, PRESERVED);
      writePreserved(dir, p2, 'keep: yes\n');
      fs.appendFileSync(path.join(dir, 'tracked-file.js'), '// change\n');
      const cmds = planSnapshotCommands(false, [PRESERVED, p2]);
      // 验证命令含两个独立 :(exclude) token（不 join）
      assert.ok(cmds[0].includes("':(exclude).specify/orchestration-overrides.yaml'"));
      assert.ok(cmds[0].includes("':(exclude).other/keep.yaml'"));
      for (const raw of cmds) sh(fillSnapshotPlaceholders(raw, dir), dir);
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'preserved 1 应存活');
      assert.ok(fs.existsSync(path.join(dir, p2)), 'preserved 2 应存活');
    } finally {
      cleanup(dir);
    }
  });

  it('stash-apply-index-full-roundtrip: snapshot 后改代码 → rollback 还原 tracked，preserved 存活', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir);
      // 工作区非 clean（已有 untracked preserved 即非 clean，但再加 tracked 改动更真实）
      fs.appendFileSync(path.join(dir, 'tracked-file.js'), '// snapshot-time change\n');
      const snapCmds = planSnapshotCommands(false);
      for (const raw of snapCmds) sh(fillSnapshotPlaceholders(raw, dir), dir);
      const stashRef = git(['rev-parse', 'stash@{0}'], dir).trim();

      // 模拟 implement：再改 tracked file
      fs.appendFileSync(path.join(dir, 'tracked-file.js'), '// implement change\n');
      const beforeRollback = fs.readFileSync(path.join(dir, 'tracked-file.js'), 'utf-8');
      assert.ok(beforeRollback.includes('implement change'));

      // rollback 到 S_i（非 clean，含 stash apply --index）
      const rollCmds = planRollbackCommands({ clean: false, ref: stashRef });
      for (const raw of rollCmds) sh(raw, dir);

      const afterRollback = fs.readFileSync(path.join(dir, 'tracked-file.js'), 'utf-8');
      // implement change 消失（被 reset --hard + stash apply 还原到 snapshot 态）
      assert.ok(!afterRollback.includes('implement change'), 'implement 改动应被回滚');
      assert.ok(afterRollback.includes('snapshot-time change'), 'snapshot 态应被还原');
      // preserved 经 clean -fd -e 排除后存活
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'preserved 应在 rollback 后存活');
    } finally {
      cleanup(dir);
    }
  });

  it('clean-fd-minus-e-protects-X: rollback 的 clean -fd -e 不删 untracked preserved', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir);
      // 另造一个普通 untracked 文件，验证 clean 确实删它（对照组）
      fs.writeFileSync(path.join(dir, 'junk.tmp'), 'garbage\n');
      // clean 分支 rollback（不含 stash apply）
      const rollCmds = planRollbackCommands({ clean: true, ref: 'unused' });
      for (const raw of rollCmds) sh(raw, dir);
      // preserved 被 -e 排除 → 存活；junk 被删
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'preserved 应被 -e 保护存活');
      assert.ok(!fs.existsSync(path.join(dir, 'junk.tmp')), '普通 untracked 应被 clean 删除（对照）');
    } finally {
      cleanup(dir);
    }
  });

  it('multiple-minus-e-both-survive: 两 -e token rollback → 两 preserved 均存活', () => {
    const dir = setupRepo();
    try {
      const p2 = '.other/keep.yaml';
      writePreserved(dir, PRESERVED);
      writePreserved(dir, p2, 'keep: yes\n');
      fs.writeFileSync(path.join(dir, 'junk.tmp'), 'garbage\n');
      const rollCmds = planRollbackCommands({ clean: true, ref: 'unused' }, [PRESERVED, p2]);
      // 验证命令含两个独立 -e token
      const cleanCmd = rollCmds.find((c) => c.startsWith('git clean'));
      assert.ok(cleanCmd.includes("-e '.specify/orchestration-overrides.yaml'"));
      assert.ok(cleanCmd.includes("-e '.other/keep.yaml'"));
      for (const raw of rollCmds) sh(raw, dir);
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'preserved 1 应存活');
      assert.ok(fs.existsSync(path.join(dir, p2)), 'preserved 2 应存活');
      assert.ok(!fs.existsSync(path.join(dir, 'junk.tmp')), '普通 untracked 应被删（对照）');
    } finally {
      cleanup(dir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F203 CRITICAL-7：only-preserved-dirty 复现守护 —— 旧 stash 绝不被触碰
// ────────────────────────────────────────────────────────────────────────────
describe('goal_loop isClean 排除 preserved（F203 CRITICAL-7 真实复现）', () => {
  it('only-preserved-dirty: 仓库已有无关旧 stash + 唯一 dirty=untracked override → isClean=true → 不 stash → 旧 stash 不被触碰', () => {
    const dir = setupRepo();
    try {
      // 1. 先制造一个无关旧 stash（模拟 worktree 真实存在的他分支 stash）
      fs.writeFileSync(path.join(dir, 'o.txt'), 'unrelated\n');
      git(['add', 'o.txt'], dir);
      git(['stash'], dir);
      const stashListBefore = git(['stash', 'list'], dir);
      assert.ok(stashListBefore.includes('stash@{0}'), '前置：应已有一个旧 stash');
      const oldStashSha = git(['rev-parse', 'stash@{0}'], dir).trim();

      // 2. 写 untracked override 作为唯一 dirty（工作区其余干净）
      //    真实仓库 .specify/ 已有 tracked 文件，git porcelain 报完整路径而非塌缩成 "?? .specify/"。
      //    先放一个 tracked 文件进 .specify/ 复刻该前提（否则 git 会把整个新目录塌缩成目录行）。
      fs.mkdirSync(path.join(dir, '.specify'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.specify', '.keep'), '');
      git(['add', '.specify/.keep'], dir);
      git(['commit', '-q', '-m', 'track .specify dir'], dir);
      writePreserved(dir);

      // 3. 实跑全仓 git status --porcelain，喂 isCleanExcludingPreserved → 必须 true
      const porcelainAll = git(['status', '--porcelain'], dir);
      const isClean = isCleanExcludingPreserved(porcelainAll, PRESERVED_CONFIG_PATHSPECS);
      assert.equal(isClean, true, '唯一 dirty 是 preserved override → 排除后应 isClean=true');

      // 4. plan-snapshot(true) → 空命令序列 → 不执行任何 stash
      const cmds = planSnapshotCommands(true);
      assert.deepEqual(cmds, [], 'isClean=true → 无 stash 命令');
      for (const raw of cmds) sh(fillSnapshotPlaceholders(raw, dir), dir);

      // 5. 守护：override 存活 + 旧 stash 未被触碰（仍是同一个，SHA 不变）
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'override 应存活');
      const stashListAfter = git(['stash', 'list'], dir);
      assert.ok(stashListAfter.includes('stash@{0}'), '旧 stash 仍在');
      const oldStashShaAfter = git(['rev-parse', 'stash@{0}'], dir).trim();
      assert.equal(oldStashShaAfter, oldStashSha, '旧 stash SHA 未变 → 从未被 apply/drop/创建新 stash 顶替');
    } finally {
      cleanup(dir);
    }
  });

  it('untracked-dir-collapse-no-stale-stash: 整个 .specify/ untracked（折叠前提）→ -uall 展开后 isClean=true → 不 stash → 旧 stash 不被触碰', () => {
    const dir = setupRepo();
    try {
      // 1. 制造一个无关旧 stash（worktree 真实存在的他分支 stash）
      fs.writeFileSync(path.join(dir, 'o.txt'), 'unrelated\n');
      git(['add', 'o.txt'], dir);
      git(['stash'], dir);
      const oldStashSha = git(['rev-parse', 'stash@{0}'], dir).trim();

      // 2. 关键差异点（对照上一个用例）：**不** commit .specify/.keep，
      //    让整个 .specify/ 保持 untracked → 复刻默认 porcelain 折叠成 `?? .specify/` 的前提。
      writePreserved(dir);

      // 3a. 默认 porcelain（无 -uall）：git 把整个 untracked 目录折叠成 `?? .specify/`，
      //     折叠路径 `.specify/` ≠ preserved 文件路径 → 被判非 preserved 变更 → isClean 误判 false。
      //     这正是 CRITICAL-7 漏网根因，本断言证明"-uall 是必需的"。
      const porcelainCollapsed = git(['status', '--porcelain'], dir);
      assert.ok(
        porcelainCollapsed.includes('?? .specify/\n') ||
          porcelainCollapsed.trimEnd().endsWith('?? .specify/'),
        '默认 porcelain 应把 untracked 目录折叠成 `?? .specify/`（折叠前提复现）',
      );
      const isCleanCollapsed = isCleanExcludingPreserved(porcelainCollapsed, PRESERVED_CONFIG_PATHSPECS);
      assert.equal(isCleanCollapsed, false, '折叠输入下 isClean 误判 false（证明默认 porcelain 不可用，必须 -uall）');

      // 3b. 正确做法：--untracked-files=all 展开到文件级 → isClean=true。
      const porcelainAll = git(['status', '--porcelain', '--untracked-files=all'], dir);
      assert.ok(
        porcelainAll.includes('?? .specify/orchestration-overrides.yaml'),
        '-uall 应把目录展开到 `?? .specify/orchestration-overrides.yaml`',
      );
      const isClean = isCleanExcludingPreserved(porcelainAll, PRESERVED_CONFIG_PATHSPECS);
      assert.equal(isClean, true, '-uall 展开后唯一 dirty 是 preserved override → 排除后 isClean=true');

      // 4. plan-snapshot(true) → 空命令序列 → 不执行任何 stash
      const cmds = planSnapshotCommands(true);
      assert.deepEqual(cmds, [], 'isClean=true → 无 stash 命令');
      for (const raw of cmds) sh(fillSnapshotPlaceholders(raw, dir), dir);

      // 5. 守护：override 存活 + 旧 stash SHA 前后一致（从未被触碰）
      assert.ok(fs.existsSync(path.join(dir, PRESERVED)), 'override 应存活');
      const oldStashShaAfter = git(['rev-parse', 'stash@{0}'], dir).trim();
      assert.equal(oldStashShaAfter, oldStashSha, '旧 stash SHA 未变 → 从未被 apply/drop/顶替');
    } finally {
      cleanup(dir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// F203 WARNING-7：staged-X / tracked-modified 走真实 porcelain→parser→assess 链路
// ────────────────────────────────────────────────────────────────────────────
describe('preserved config 不安全态走真实 porcelain 链路（F203 WARNING-7）', () => {
  it('staged-X: git add override 后实跑 porcelain → parser → assess safe=false state=staged', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir);
      git(['add', PRESERVED], dir); // 新增已暂存 → index 列非空
      const porcelain = git(['status', '--porcelain', '--', PRESERVED], dir);
      const entries = parsePreservedConfigStates(porcelain, PRESERVED_CONFIG_PATHSPECS);
      const safety = assessPreservedConfigSafety(entries);
      assert.equal(safety.safe, false, 'staged preserved → 不安全');
      assert.equal(safety.unsafe[0].state, 'staged');
    } finally {
      cleanup(dir);
    }
  });

  it('tracked-modified: track+commit 后改文件（不 add）→ 实跑链路 → safe=false state=tracked-modified', () => {
    const dir = setupRepo();
    try {
      writePreserved(dir, PRESERVED, 'v1\n');
      git(['add', PRESERVED], dir);
      git(['commit', '-q', '-m', 'track preserved'], dir);
      fs.writeFileSync(path.join(dir, PRESERVED), 'v2\n'); // 改但不 add → 仅工作区列非空
      const porcelain = git(['status', '--porcelain', '--', PRESERVED], dir);
      const entries = parsePreservedConfigStates(porcelain, PRESERVED_CONFIG_PATHSPECS);
      const safety = assessPreservedConfigSafety(entries);
      assert.equal(safety.safe, false, 'tracked-modified preserved → 不安全');
      assert.equal(safety.unsafe[0].state, 'tracked-modified');
    } finally {
      cleanup(dir);
    }
  });
});

// sanity：默认常量正确（防 import 漂移）
describe('PRESERVED_CONFIG_PATHSPECS 默认值（集成 sanity）', () => {
  it('默认含 .specify/orchestration-overrides.yaml', () => {
    assert.ok(PRESERVED_CONFIG_PATHSPECS.includes(PRESERVED));
  });
});
