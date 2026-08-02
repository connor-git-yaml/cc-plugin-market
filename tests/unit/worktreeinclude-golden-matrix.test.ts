/**
 * Feature 239 — `.worktreeinclude` node ↔ bash 双解析器跨实现字节级合同测试（T002 / plan 决策 4）
 *
 * `.worktreeinclude` 有两个独立解析实现：Node 侧 `parseWorktreeInclude()`（供 repo:check 与
 * 单测消费）与 bash 侧 `read_worktreeinclude_entries()`（供 sync 脚本消费）。两者一旦语义漂移，
 * 同一份清单会被读出不同条目集合——单独测各自实现无法暴露这类问题，因此用同一份 golden 字节
 * fixture 同时驱动两侧并逐字节比对。
 *
 * bash 侧通过 `WORKTREEINCLUDE_PROBE_FILE` 探针入口驱动：设置该环境变量时脚本只解析并打印条目
 * 后 exit 0，不进入 git / 文件系统主流程（因此本测试可在非 git 临时目录内运行）。
 *
 * 钉死的 grammar 五条：
 *   1. 文件首只剥一次 UTF-8 BOM
 *   2. 每行剥单个尾部 `\r`
 *   3. 不做其他任何 trim
 *   4. `#` 仅当是行首第一个字符才是整行注释（行内 `#` 按字面处理）
 *   5. 末行无换行符必须被接受
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// @ts-expect-error — .mjs 无类型声明，运行时可解析
import * as core from '../../scripts/lib/worktree-local-state-core.mjs';

const parseWorktreeInclude = core.parseWorktreeInclude as (content: string) => string[];

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/sync-worktree-local-state.sh');

interface GoldenCase {
  name: string;
  bytes: Buffer;
  expected: string[];
}

const GOLDEN_CASES: GoldenCase[] = [
  {
    name: 'CRLF 混用（每行剥单个尾部 \\r）',
    bytes: Buffer.from('.env.local\r\nplain.env\n', 'utf-8'),
    expected: ['.env.local', 'plain.env'],
  },
  {
    name: 'UTF-8 BOM（文件首只剥一次）',
    bytes: Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('bom.env\nsecond.env\n', 'utf-8'),
    ]),
    expected: ['bom.env', 'second.env'],
  },
  {
    name: '行内 # 按字面处理，行首 # 整行注释',
    bytes: Buffer.from('path.env # inline comment\n# full-line comment\n  # indented\n', 'utf-8'),
    expected: ['path.env # inline comment', '  # indented'],
  },
  {
    name: '末行无换行符必须被接受',
    bytes: Buffer.from('first.env\nlast.env', 'utf-8'),
    expected: ['first.env', 'last.env'],
  },
  {
    name: '纯注释文件（零条目）',
    bytes: Buffer.from('# only comments\n#another\n', 'utf-8'),
    expected: [],
  },
  {
    name: '空文件（零条目）',
    bytes: Buffer.from('', 'utf-8'),
    expected: [],
  },
];

/** 通过 bash 探针入口解析 fixture，返回原始 stdout 字节。 */
function runBashProbe(fixturePath: string, cwd: string): { stdout: Buffer; status: number } {
  const result = spawnSync('bash', [SCRIPT_PATH], {
    cwd,
    env: { ...process.env, WORKTREEINCLUDE_PROBE_FILE: fixturePath },
  });
  return { stdout: result.stdout ?? Buffer.alloc(0), status: result.status ?? -1 };
}

/** Node 侧条目序列的字节形态：每条一行，与 bash `printf '%s\n'` 输出对齐。 */
function toWireBytes(entries: string[]): Buffer {
  return Buffer.from(entries.map((entry) => `${entry}\n`).join(''), 'utf-8');
}

describe('Feature 239 — .worktreeinclude golden byte matrix（node ↔ bash 逐字节一致）', () => {
  let sandbox: string;

  beforeEach(() => {
    // 非 git 临时目录：探针若误入主流程会在 `git rev-parse` 处失败，从而暴露"探针未提前退出"。
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'worktreeinclude-golden-'));
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it.each(GOLDEN_CASES)('$name', ({ bytes, expected }) => {
    const fixturePath = path.join(sandbox, 'fixture.worktreeinclude');
    fs.writeFileSync(fixturePath, bytes);

    // (a) Node 侧
    const nodeEntries = parseWorktreeInclude(bytes.toString('utf-8'));
    expect(nodeEntries).toEqual(expected);

    // (b) bash 侧（探针入口）
    const probe = runBashProbe(fixturePath, sandbox);
    expect(probe.status).toBe(0);

    // (c) 两侧逐字节一致
    expect(probe.stdout.equals(toWireBytes(nodeEntries))).toBe(true);
  });

  it('探针模式不进入主流程：非 git 目录下仍 exit 0 且不产生任何文件副作用', () => {
    const fixturePath = path.join(sandbox, 'fixture.worktreeinclude');
    fs.writeFileSync(fixturePath, '.env.local\n');
    const before = fs.readdirSync(sandbox).sort();

    const probe = runBashProbe(fixturePath, sandbox);

    expect(probe.status).toBe(0);
    expect(probe.stdout.toString('utf-8')).toBe('.env.local\n');
    expect(fs.readdirSync(sandbox).sort()).toEqual(before);
  });

  it('探针文件不存在时静默输出空条目并 exit 0（清单缺失不是错误）', () => {
    const probe = runBashProbe(path.join(sandbox, 'missing.worktreeinclude'), sandbox);
    expect(probe.status).toBe(0);
    expect(probe.stdout.length).toBe(0);
  });
});
