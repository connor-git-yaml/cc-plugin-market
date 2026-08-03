/**
 * pre-tool-use-guard.test.mjs
 * Feature 245 — hooks payload 嵌套取值缺陷（PreToolUse src/ 门禁恒放行）
 *
 * 被测对象：plugins/spec-driver/hooks/pre-tool-use-guard.sh
 * 覆盖 plan.md 测试矩阵 #1-#12：payload 形状（嵌套 / 扁平 / 缺字段 / 畸形）、
 * jq 与 grep 双分支、活跃判定收窄（当前分支对应 spec 目录）、warn/block 双档动作。
 *
 * 测试策略：spawnSync bash 执行 hook，stdin 喂 payload，cwd 指向 fs.mkdtempSync 建的临时 git 仓库。
 * 临时 fixture 自带 .git 与 specs/<branch>/tasks.md，**不依赖本仓库真实 specs/ 与分支状态**，
 * 否则用例结论会随仓库当前分支漂移（正是本次要消灭的"无信号"失效模式）。
 *
 * 运行方式: node --test plugins/spec-driver/tests/pre-tool-use-guard.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'hooks', 'pre-tool-use-guard.sh');

// 受限沙箱里 os.tmpdir() 可能 EPERM；沿用 ensure-gitignore.test.mjs 的 TEST_TMPDIR 覆盖约定。
const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

/** hook 以 `#!/usr/bin/env bash` 运行；测试直接用绝对路径 bash 调用，避免受限 PATH 用例解析不到解释器。 */
const BASH =
  ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'].find((p) =>
    fs.existsSync(p),
  ) ?? 'bash';

/** 无 jq 降级用例需要的外部命令白名单（脚本实际用到的全集）。 */
const FALLBACK_COMMANDS = ['bash', 'sh', 'cat', 'grep', 'sed', 'head', 'git'];

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

function mkTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(TMP_BASE, prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} 失败: ${res.stderr}`);
  return res;
}

/**
 * 建一个临时 fixture 仓库。
 * @param {{branch?: string, tasksContent?: string, specDirName?: string, git?: boolean, detached?: boolean}} opts
 */
function makeFixture(opts = {}) {
  const dir = mkTemp('pre-guard-');
  if (opts.git !== false) {
    runGit(dir, ['init', '-q']);
    if (opts.branch) {
      // 未出生分支上 checkout 即可确定分支名，无需先 commit。
      // 用 -B 而非 -b：宿主的 init.defaultBranch 可能恰好等于要建的分支名（如 master），
      // -b 撞名会失败，-B 幂等。
      runGit(dir, ['checkout', '-q', '-B', opts.branch]);
    }
    if (opts.detached) {
      // --detach 需要有一个可指向的 commit。
      runGit(dir, [
        '-c',
        'user.email=t@t',
        '-c',
        'user.name=t',
        'commit',
        '--allow-empty',
        '-q',
        '-m',
        'fixture',
      ]);
      runGit(dir, ['checkout', '-q', '--detach']);
    }
  }
  if (opts.tasksContent !== undefined) {
    const specDir = path.join(dir, 'specs', opts.specDirName ?? opts.branch);
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'tasks.md'), opts.tasksContent);
  }
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

/** 在 PATH 中定位某命令的真实可执行文件（不经 shell，避免 alias/function 干扰）。 */
function locateCommand(cmd) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // 继续找下一个
    }
  }
  return null;
}

/**
 * 构造"没有 jq"的受控 bin 目录：只软链脚本真正用到的命令。
 * 不能靠裁剪系统 PATH——ubuntu 的 jq 就躺在 /usr/bin 里，与 grep/sed 同目录。
 * @param {{omit?: string[]}} opts omit 用于故意制造"某命令不可用"的环境
 */
function makeJqLessBin({ omit = [] } = {}) {
  const dir = mkTemp('pre-guard-nojq-bin-');
  for (const cmd of FALLBACK_COMMANDS) {
    if (omit.includes(cmd)) continue;
    const real = locateCommand(cmd);
    if (cmd === 'sh' || cmd === 'bash') {
      if (real) fs.symlinkSync(real, path.join(dir, cmd));
      continue;
    }
    assert.ok(real, `测试环境缺少必需命令 ${cmd}，无法构造降级 PATH`);
    fs.symlinkSync(real, path.join(dir, cmd));
  }
  assert.equal(fs.existsSync(path.join(dir, 'jq')), false, '降级 PATH 不应包含 jq');
  for (const cmd of omit) {
    assert.equal(fs.existsSync(path.join(dir, cmd)), false, `受控 PATH 不应包含 ${cmd}`);
  }
  return dir;
}

/**
 * 执行 hook。
 * @param {string} cwd
 * @param {object|string} payload 对象会被 JSON.stringify；字符串原样送入（畸形 JSON 用例）
 */
function runHook(cwd, payload, { env = {}, pathOverride } = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = spawnSync(BASH, [SCRIPT], {
    input,
    cwd,
    env: {
      PATH: pathOverride ?? process.env.PATH,
      HOME: process.env.HOME ?? cwd,
      ...env,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(res.error, undefined, `spawn 失败: ${res.error}`);
  assert.notEqual(
    res.status,
    null,
    `hook 未正常退出（signal=${res.signal}）；stdout=${res.stdout}；stderr=${res.stderr}`,
  );
  return res;
}

const UNFINISHED_TASKS = '# tasks\n\n- [x] T001 done\n- [ ] T002 pending\n';
const FINISHED_TASKS = '# tasks\n\n- [x] T001 done\n- [x] T002 done\n';
const BRANCH = '245-fix-hook-payload-path';

const nestedEditPayload = (filePath) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
});

const flatEditPayload = (filePath) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  file_path: filePath,
});

describe('pre-tool-use-guard.sh（Feature 245 取值 + 判定收窄 + 安全默认）', () => {
  it('#1 嵌套 payload + src/ + 当前分支有未完成任务（默认档）→ exit 0 且 stderr 含 WARN', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.match(res.stderr, /\[PreToolUse WARN\]/);
    assert.doesNotMatch(res.stderr, /\[PreToolUse BLOCKED\]/);
  });

  it('#2 同 #1 + SPEC_DRIVER_SRC_GUARD=block → exit 2 且 stderr 含 BLOCKED', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'), {
      env: { SPEC_DRIVER_SRC_GUARD: 'block' },
    });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /\[PreToolUse BLOCKED\]/);
  });

  it('#3 嵌套 payload + 非 src/ 路径 → exit 0 且无任何 stderr', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('docs/design/x.md'));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#4 扁平 payload（顶层 file_path）向后兼容 → exit 0 + WARN；block 档 → exit 2', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const warnRes = runHook(repo, flatEditPayload('src/core/foo.ts'));
    assert.equal(warnRes.status, 0);
    assert.match(warnRes.stderr, /\[PreToolUse WARN\]/);

    const blockRes = runHook(repo, flatEditPayload('src/core/foo.ts'), {
      env: { SPEC_DRIVER_SRC_GUARD: 'block' },
    });
    assert.equal(blockRes.status, 2);
    assert.match(blockRes.stderr, /\[PreToolUse BLOCKED\]/);
  });

  it('#5 payload 无 file_path（Bash / NotebookEdit 形状）→ exit 0', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const bashRes = runHook(repo, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls src/' },
    });
    assert.equal(bashRes.status, 0);
    assert.equal(bashRes.stderr, '');

    const notebookRes = runHook(repo, {
      hook_event_name: 'PreToolUse',
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'src/x.ipynb' },
    });
    assert.equal(notebookRes.status, 0);
    assert.equal(notebookRes.stderr, '');
  });

  it('#6 畸形 JSON → exit 0（fail-open，不抛异常）', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, '{"tool_name": "Edit", "tool_input": {');
    assert.equal(res.status, 0);
  });

  it('#7 无 jq 降级 + Edit 嵌套 file_path → 与 jq 分支等价（exit 0 + WARN）', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'), {
      pathOverride: makeJqLessBin(),
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /\[PreToolUse WARN\]/);
  });

  it('#8 无 jq 降级 + tool_name=Bash 且 command 内含字面 "file_path" → exit 0 且不误抓', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(
      repo,
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo \'{"file_path": "src/core/foo.ts"}\' > /tmp/x.json' },
      },
      { pathOverride: makeJqLessBin() },
    );
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#9 当前分支无对应 spec 目录 → exit 0（fail-open）', () => {
    // 分支 master，未完成任务落在另一个 feature 目录下（历史残留场景）
    const repo = makeFixture({
      branch: 'master',
      specDirName: '099-some-old-feature',
      tasksContent: UNFINISHED_TASKS,
    });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#10 分支对应目录存在但任务全部完成 → exit 0 且无 WARN', () => {
    const repo = makeFixture({ branch: BRANCH, tasksContent: FINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#11 非 git 仓库 → exit 0（fail-open）', () => {
    const repo = makeFixture({
      git: false,
      specDirName: BRANCH,
      tasksContent: UNFINISHED_TASKS,
    });
    assert.equal(fs.existsSync(path.join(repo, '.git')), false);
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#12 detached HEAD → exit 0（--show-current 返回空）', () => {
    const repo = makeFixture({
      branch: BRANCH,
      tasksContent: UNFINISHED_TASKS,
      detached: true,
    });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.equal(res.stderr, '');
  });

  it('#13 PATH 中没有 cat（读不到 stdin）→ 仍 exit 0，不泄漏 127', () => {
    // 退出码是 hook 对 harness 的合同（0 放行 / 2 阻断）。`INPUT=$(cat 2>/dev/null || true)`
    // 的兜底若被去掉，set -e 会让脚本以 127 退出——harness 侧既非放行也非阻断。
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'), {
      pathOverride: makeJqLessBin({ omit: ['cat'] }),
    });
    assert.equal(res.status, 0);
  });

  it('#14 无 jq + 畸形但模式仍可匹配的文本 → 按提取值照常判定（固化已知限制，非合同保证）', () => {
    // 本用例固化的是 grep 降级分支的**现状行为**：它做纯文本模式匹配，不校验 JSON 有效性，
    // 因此「缺闭合括号但键值对完整」的输入照样能抽出 file_path 并触发判定。
    // 这不是脚本承诺的合同——只有 jq 分支才有结构化语义。写死于此是为了让未来
    // 任何改动该分支的人，能立刻看到自己是否无意中改变了这条既有行为。
    const repo = makeFixture({ branch: BRANCH, tasksContent: UNFINISHED_TASKS });
    const res = runHook(repo, '{"tool_name":"Edit","tool_input":{"file_path":"src/core/foo.ts"', {
      pathOverride: makeJqLessBin(),
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /\[PreToolUse WARN\]/);
  });

  it('#15 分支名含斜杠（feature/x）→ 映射到 specs/feature/x/tasks.md 并正常告警', () => {
    const repo = makeFixture({ branch: 'feature/x', tasksContent: UNFINISHED_TASKS });
    assert.ok(fs.existsSync(path.join(repo, 'specs', 'feature', 'x', 'tasks.md')));
    const res = runHook(repo, nestedEditPayload('src/core/foo.ts'));
    assert.equal(res.status, 0);
    assert.match(res.stderr, /specs\/feature\/x\/tasks\.md/);
  });
});
