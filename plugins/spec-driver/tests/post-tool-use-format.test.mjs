/**
 * post-tool-use-format.test.mjs
 * Feature 245 — hooks payload 嵌套取值缺陷（PostToolUse prettier 格式化从未生效）
 *
 * 被测对象：plugins/spec-driver/hooks/post-tool-use-format.sh
 * 覆盖 plan.md 测试矩阵 #1-#8：payload 形状（嵌套 / 扁平 / 缺字段 / 畸形）、jq 与 grep 双分支、
 * 文件存在性、扩展名过滤、以及新增的 prettier 配置探测门槛。
 *
 * 测试策略：spawnSync bash 执行 hook，cwd 指向 fs.mkdtempSync 建的临时项目。
 * PATH 收窄到受控 bin 目录，其中 `npx` 是**记录调用的桩**——既避免真跑 npx prettier
 * （网络下载 + 版本漂移 + 秒级耗时），又能正面断言"配置探测门槛是否放行到了 npx"，
 * 比"只断言 exit 0"强得多：无门槛的旧行为与有门槛的新行为在退出码上完全同构。
 *
 * 运行方式: node --test plugins/spec-driver/tests/post-tool-use-format.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'hooks', 'post-tool-use-format.sh');

const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

const BASH =
  ['/bin/bash', '/usr/bin/bash', '/opt/homebrew/bin/bash', '/usr/local/bin/bash'].find((p) =>
    fs.existsSync(p),
  ) ?? 'bash';

/** 脚本实际用到的外部命令全集（npx 用桩替代，jq 按用例开关）。 */
const REQUIRED_COMMANDS = ['cat', 'grep', 'sed', 'head'];
const OPTIONAL_COMMANDS = ['bash', 'sh'];

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
 * 构造受控 bin 目录。
 * @param {{withJq?: boolean, withNpx?: boolean, npxExitCode?: number}} opts
 */
function makeBin({ withJq = true, withNpx = true, npxExitCode = 0 } = {}) {
  const dir = mkTemp('post-format-bin-');
  for (const cmd of REQUIRED_COMMANDS) {
    const real = locateCommand(cmd);
    assert.ok(real, `测试环境缺少必需命令 ${cmd}`);
    fs.symlinkSync(real, path.join(dir, cmd));
  }
  for (const cmd of OPTIONAL_COMMANDS) {
    const real = locateCommand(cmd);
    if (real) fs.symlinkSync(real, path.join(dir, cmd));
  }
  if (withJq) {
    const jq = locateCommand('jq');
    assert.ok(jq, '测试环境缺少 jq，无法覆盖 jq 分支用例');
    fs.symlinkSync(jq, path.join(dir, 'jq'));
  } else {
    assert.equal(fs.existsSync(path.join(dir, 'jq')), false, '降级 PATH 不应包含 jq');
  }
  if (withNpx) {
    // 记录调用的 npx 桩：**逐参**（"$@" 而非 "$*"）写入 $NPX_MARKER，不真跑 prettier。
    // 逐参是刻意的：含空格的文件名在合并成一行后就再也分不清"一个带空格的参数"
    // 和"两个参数"，而这正是引号丢失类缺陷的典型形态。
    const stub = path.join(dir, 'npx');
    fs.writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s\\n' "$@" >> "$NPX_MARKER"\nexit ${npxExitCode}\n`,
    );
    fs.chmodSync(stub, 0o755);
  }
  return dir;
}

/**
 * 建一个临时项目 fixture。
 * @param {{files?: Record<string,string>, prettierConfig?: string, packageJson?: string}} opts
 */
function makeProject(opts = {}) {
  const dir = mkTemp('post-format-');
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (opts.prettierConfig) {
    fs.writeFileSync(path.join(dir, opts.prettierConfig), '{"semi": true}\n');
  }
  if (opts.packageJson !== undefined) {
    fs.writeFileSync(path.join(dir, 'package.json'), opts.packageJson);
  }
  return dir;
}

/**
 * 执行 hook，返回 { status, stderr, npxArgs }（npxArgs 为桩记录的逐个实参）。
 */
function runHook(cwd, payload, { bin, env = {} } = {}) {
  const binDir = bin ?? makeBin();
  const marker = path.join(cwd, `.npx-invocations-${Math.random().toString(36).slice(2)}.log`);
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = spawnSync(BASH, [SCRIPT], {
    input,
    cwd,
    env: {
      PATH: binDir,
      HOME: process.env.HOME ?? cwd,
      NPX_MARKER: marker,
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
  // 桩每个参数写一行，故末尾必有一个空元素；不用 trim()/filter(Boolean)——
  // 那会连同参数自身的首尾空白一起吞掉，正是本文件要验证的那类信息。
  const raw = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  const npxArgs = raw === '' ? [] : raw.split('\n').slice(0, -1);
  return { ...res, npxArgs };
}

const TS_SOURCE = 'export const a   =    1\n';

/**
 * 期望的 prettier 调用实参序列（逐参比对）。`--` 分隔符是断言的一部分：
 * file_path 来自外部 payload，少了它，flag 形态的文件名（如 `--config`）
 * 会被 prettier 的参数解析器劫持。
 */
const PRETTIER_ARGS = ['prettier', '--write', '--', 'src/a.ts'];

const nestedPayload = (filePath, toolName = 'Edit') => ({
  hook_event_name: 'PostToolUse',
  tool_name: toolName,
  tool_input: { file_path: filePath },
});

describe('post-tool-use-format.sh（Feature 245 取值修复 + prettier 配置门槛）', () => {
  it('#1 嵌套 file_path + .ts 文件 + 项目有 .prettierrc → exit 0 且走到 prettier 调用', () => {
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      prettierConfig: '.prettierrc',
    });
    const res = runHook(project, nestedPayload('src/a.ts'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, PRETTIER_ARGS);
  });

  it('#2 嵌套 file_path 但项目无任何 prettier 配置 → exit 0 且完全不触发 npx', () => {
    const project = makeProject({ files: { 'src/a.ts': TS_SOURCE } });
    const res = runHook(project, nestedPayload('src/a.ts'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, []);
    // 无 npx 的 PATH 下同样必须 exit 0（不因缺 npx 而失败）
    const noNpx = runHook(project, nestedPayload('src/a.ts'), {
      bin: makeBin({ withNpx: false }),
    });
    assert.equal(noNpx.status, 0);
  });

  it('#3 扁平 payload（顶层 file_path）向后兼容 → exit 0 且走到 prettier 调用', () => {
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      prettierConfig: '.prettierrc.json',
    });
    const res = runHook(project, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      file_path: 'src/a.ts',
    });
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, PRETTIER_ARGS);
  });

  it('#4 目标文件不存在于磁盘 → exit 0 且不触发 npx', () => {
    const project = makeProject({ prettierConfig: '.prettierrc' });
    const res = runHook(project, nestedPayload('src/missing.ts'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, []);
  });

  it('#5 非 JS/TS/JSON 扩展名 → exit 0 且跳过配置探测与 npx', () => {
    const project = makeProject({
      files: { 'docs/a.md': '# hi\n' },
      prettierConfig: '.prettierrc',
    });
    const res = runHook(project, nestedPayload('docs/a.md'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, []);
  });

  it('#6 无 file_path / 畸形 JSON → exit 0（fail-open）', () => {
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      prettierConfig: '.prettierrc',
    });
    const noPath = runHook(project, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });
    assert.equal(noPath.status, 0);
    assert.deepEqual(noPath.npxArgs, []);

    const malformed = runHook(project, '{"tool_name": "Edit", "tool_input": {');
    assert.equal(malformed.status, 0);
    assert.deepEqual(malformed.npxArgs, []);
  });

  it('#7 无 jq 降级 + tool_name 非编辑类 → exit 0（门槛拦截，不误抓 command 内的 file_path 文本）', () => {
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      prettierConfig: '.prettierrc',
    });
    const bin = makeBin({ withJq: false });
    const res = runHook(
      project,
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo \'{"file_path": "src/a.ts"}\'' },
      },
      { bin },
    );
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, []);

    // 对照：同一无 jq 环境下，Edit 工具仍能正常取到嵌套 file_path 并走到 prettier
    const editRes = runHook(project, nestedPayload('src/a.ts'), { bin });
    assert.equal(editRes.status, 0);
    assert.deepEqual(editRes.npxArgs, PRETTIER_ARGS);
  });

  it('#8 prettier 配置以 package.json 的 "prettier" 字段形式存在 → 判定为有配置', () => {
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      packageJson: '{\n  "name": "fixture",\n  "prettier": { "semi": true }\n}\n',
    });
    const res = runHook(project, nestedPayload('src/a.ts'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, PRETTIER_ARGS);

    // 对照：package.json 存在但无 prettier 字段 → 仍判定为无配置
    const withoutField = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      packageJson: '{\n  "name": "fixture"\n}\n',
    });
    const negative = runHook(withoutField, nestedPayload('src/a.ts'));
    assert.equal(negative.status, 0);
    assert.deepEqual(negative.npxArgs, []);
  });

  it('#9 prettier 调用失败（npx 退出非零）→ 脚本仍 exit 0', () => {
    // PostToolUse hook 的合同是恒 0：格式化工具自身的失败（版本不兼容、语法错误、
    // 网络装包失败）不该把编辑动作也判成失败。固化 `|| true`。
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      prettierConfig: '.prettierrc',
    });
    const res = runHook(project, nestedPayload('src/a.ts'), {
      bin: makeBin({ npxExitCode: 3 }),
    });
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, PRETTIER_ARGS, '仍应真的调用过 npx（而非提前放行）');
  });

  it('#10 无配置文件但 devDependencies 含 prettier → 判定为有配置（宽信号定案）', () => {
    // 探测判据是「package.json 里出现完整带引号的 "prettier" token」，覆盖依赖声明：
    // 把 prettier 装进 devDependencies 本身就是采用该约定的表态。
    const project = makeProject({
      files: { 'src/a.ts': TS_SOURCE },
      packageJson: '{\n  "name": "fixture",\n  "devDependencies": { "prettier": "^3.3.0" }\n}\n',
    });
    const res = runHook(project, nestedPayload('src/a.ts'));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, PRETTIER_ARGS);
  });

  it('#11 file_path 含空格 → 作为单个参数完整传给 prettier（引号未丢）', () => {
    const filePath = 'src/my component.ts';
    const project = makeProject({
      files: { [filePath]: TS_SOURCE },
      prettierConfig: '.prettierrc',
    });
    const res = runHook(project, nestedPayload(filePath));
    assert.equal(res.status, 0);
    assert.deepEqual(res.npxArgs, ['prettier', '--write', '--', filePath]);
    // 逐参记录的价值就在这一条：若引号丢失，末参会裂成 'src/my' 与 'component.ts' 两项。
    assert.equal(res.npxArgs.at(-1), filePath);
  });
});
