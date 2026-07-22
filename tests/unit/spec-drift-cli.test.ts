/**
 * T015：`scripts/spec-drift-cli.mjs` 单测（FR-014，plan §10）。
 *
 * 覆盖：子命令 dispatch、`--help`、`--format json`、`--lock` / `--project-root` 覆盖默认路径，
 * 以及三命令的退出码映射（plan §10.2：0/2/3；数值 1 仅 check 使用）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import { main } from '../../scripts/spec-drift-cli.mjs';

let root: string;
let lockPath: string;
let manifestPath: string;

const SOURCE = [
  '/** e2e 样例 */',
  'export function addNumbers(a: number, b: number): number {',
  '  const total = a + b;',
  '  return total;',
  '}',
].join('\n');

/** 捕获 CLI stdout，返回 { code, out } */
async function run(argv: string[]) {
  const chunks: string[] = [];
  const code = await main(argv, { write: (line: string) => chunks.push(line) });
  return { code, out: chunks.join('\n') };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cli-'));
  fs.writeFileSync(path.join(root, 'a.ts'), `${SOURCE}\n`, 'utf8');
  lockPath = path.join(root, 'custom.lock.json');
  manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify([{ id: 'x1', ref: 'a.ts::addNumbers', docPath: 'docs/x.md', line: 3 }]),
    'utf8',
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const base = ['--project-root', () => root, '--lock', () => lockPath];
const withPaths = (argv: string[]) => [...argv, '--project-root', root, '--lock', lockPath];
void base;

describe('--help 与 dispatch', () => {
  it('`--help` 打印用法后 exit 0', async () => {
    const { code, out } = await run(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('drift:link');
    expect(out).toContain('drift:check');
    expect(out).toContain('drift:unlink');
  });

  it('子命令 `check --help` 同样 exit 0 且打印用法', async () => {
    const { code, out } = await run(['check', '--help']);
    expect(code).toBe(0);
    expect(out).toContain('用法');
  });

  it('未知子命令 → exit 2 并打印用法', async () => {
    const { code, out } = await run(['bogus']);
    expect(code).toBe(2);
    expect(out).toContain('用法');
  });

  it('缺子命令 → exit 2', async () => {
    expect((await run([])).code).toBe(2);
  });
});

describe('link 子命令', () => {
  it('link 成功 → exit 0，lock 写到 --lock 指定路径，条目无被禁字段', async () => {
    const { code } = await run(withPaths(['link', '--manifest', manifestPath]));
    expect(code).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.schemaVersion).toBe('1');
    expect(lock.anchors).toHaveLength(1);
    expect(lock.anchors[0].symbolId).toBe('a.ts::addNumbers');
    expect(lock.anchors[0].fingerprint).toMatch(/^sha256:/);
    for (const banned of ['status', 'stale', 'fresh']) {
      expect(lock.anchors[0]).not.toHaveProperty(banned);
    }
  });

  it('同 id 未加 --refresh 重复 link → exit 2 且 lock 不变（FR-002）', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const before = fs.readFileSync(lockPath, 'utf8');
    const { code, out } = await run(withPaths(['link', '--manifest', manifestPath]));
    expect(code).toBe(2);
    expect(out).toMatch(/--refresh/);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(before);
  });

  it('--refresh 按当前代码重算指纹', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const oldFp = JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors[0].fingerprint;
    fs.writeFileSync(path.join(root, 'a.ts'), `${SOURCE.replace('a + b', 'a * b')}\n`, 'utf8');
    const { code } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh']));
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors[0].fingerprint).not.toBe(oldFp);
  });

  it('manifest 缺失 → exit 2（操作性失败，MUST NOT 用退出码 1）', async () => {
    const { code } = await run(withPaths(['link', '--manifest', path.join(root, 'nope.json')]));
    expect(code).toBe(2);
  });

  it('未解析的引用（裸 symbol 名）→ exit 2，且不写入半成品锚', async () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([{ id: 'bad', ref: 'addNumbers', docPath: 'd.md', line: 1 }]),
      'utf8',
    );
    const { code } = await run(withPaths(['link', '--manifest', manifestPath]));
    expect(code).toBe(2);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.anchors).toHaveLength(0);
  });

  it('--format json 输出结构化操作摘要', async () => {
    const { code, out } = await run(withPaths(['link', '--manifest', manifestPath, '--format', 'json']));
    expect(code).toBe(0);
    const json = JSON.parse(out);
    expect(json.command).toBe('link');
    expect(json.exitCode).toBe(0);
    expect(json.results[0]).toMatchObject({ id: 'x1', status: 'ok', machineCode: 'DRIFT_FRESH' });
  });
});

describe('check 子命令', () => {
  it('未改动 → exit 0', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    expect((await run(withPaths(['check']))).code).toBe(0);
  });

  it('改动 symbol → exit 1 且 json 报告含状态矩阵字段', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    fs.writeFileSync(path.join(root, 'a.ts'), `${SOURCE.replace('a + b', 'a * b')}\n`, 'utf8');
    const { code, out } = await run(withPaths(['check', '--format', 'json']));
    expect(code).toBe(1);
    const json = JSON.parse(out);
    expect(json.command).toBe('check');
    expect(json.reportStatus).toBe('ok');
    expect(json.anchors[0]).toMatchObject({ status: 'stale', machineCode: 'DRIFT_STALE' });
    expect(json.anchors[0].nextStep).toBeTruthy();
    expect(json.summary.stale).toBe(1);
  });

  it('lock 不存在 → 视为无锚，exit 0', async () => {
    expect((await run(withPaths(['check']))).code).toBe(0);
  });

  it('lock 损坏 → exit 3', async () => {
    fs.writeFileSync(lockPath, '{ broken json', 'utf8');
    const { code, out } = await run(withPaths(['check', '--format', 'json']));
    expect(code).toBe(3);
    expect(JSON.parse(out).reportStatus).toBe('lock-corrupt');
    expect(JSON.parse(out).machineCode).toBe('DRIFT_LOCK_CORRUPT');
  });
});

describe('unlink 子命令', () => {
  it('按 id 精确删除 → exit 0', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const { code } = await run(withPaths(['unlink', 'x1']));
    expect(code).toBe(0);
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors).toHaveLength(0);
  });

  it('id 不存在 → exit 2（操作性失败）', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const { code } = await run(withPaths(['unlink', 'no-such-id']));
    expect(code).toBe(2);
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors).toHaveLength(1);
  });

  it('缺位置参数 id → exit 2', async () => {
    expect((await run(withPaths(['unlink']))).code).toBe(2);
  });

  it('lock 损坏 → exit 3', async () => {
    fs.writeFileSync(lockPath, 'null', 'utf8');
    expect((await run(withPaths(['unlink', 'x1']))).code).toBe(3);
  });
});

describe('默认路径与覆盖', () => {
  it('不传 --lock 时默认落在 <project-root>/.specify/spec-drift.lock.json', async () => {
    const { code } = await run(['link', '--manifest', manifestPath, '--project-root', root]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, '.specify', 'spec-drift.lock.json'))).toBe(true);
  });
});

describe('W-9 参数严格校验（静默降级在 CI 里不可观测）', () => {
  it.each(['--project-root', '--lock', '--manifest', '--format'])('%s 缺值 → exit 2', async (flag) => {
    const { code, out } = await run(['check', flag]);
    expect(code).toBe(2);
    expect(out).toMatch(/需要一个取值/);
  });

  it('取值位被下一个 flag 占据（`--lock --format json`）→ exit 2，不把 flag 当路径吞掉', async () => {
    const { code, out } = await run(['check', '--lock', '--format', 'json']);
    expect(code).toBe(2);
    expect(out).toMatch(/--lock/);
  });

  it('--format 非 json（如 xml）→ exit 2，MUST NOT 静默退回文本输出', async () => {
    const { code, out } = await run(withPaths(['check', '--format', 'xml']));
    expect(code).toBe(2);
    expect(out).toMatch(/--format/);
  });

  it('check 带多余位置参数（`check junk`）→ exit 2', async () => {
    const { code, out } = await run(withPaths(['check', 'junk']));
    expect(code).toBe(2);
    expect(out).toMatch(/位置参数/);
  });

  it('unlink 带多于 1 个位置参数 → exit 2', async () => {
    const { code } = await run(withPaths(['unlink', 'a', 'b']));
    expect(code).toBe(2);
  });

  it('--id 用于非 --refresh 的 link → exit 2', async () => {
    const { code, out } = await run(withPaths(['link', '--manifest', manifestPath, '--id', 'x1']));
    expect(code).toBe(2);
    expect(out).toMatch(/--id/);
  });

  it('--id 用于 check → exit 2', async () => {
    const { code } = await run(withPaths(['check', '--id', 'x1']));
    expect(code).toBe(2);
  });

  it('`link --refresh --id <id>` 是唯一合法的 --id 用法', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const { code } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh', '--id', 'x1']));
    expect(code).toBe(0);
  });

  it('参数级失败在 --format json 下输出可解析 JSON（exitCode 2）而非用法文本', async () => {
    const { code, out } = await run(['check', '--format', 'json', '--lock']);
    expect(code).toBe(2);
    const json = JSON.parse(out);
    expect(json).toMatchObject({ ok: false, exitCode: 2 });
    expect(json.reason).toBeTruthy();
  });
});

describe('C-1 未预期异常兜底（CLI 是 CI 消费入口，绝不吐栈）', () => {
  it('内部异常 → exit 2 且 json 模式输出结构化失败对象', async () => {
    // 触发方式：把 lock 的父目录指向一个已存在的普通文件，writeLockAtomic 的
    // mkdirSync 会抛 ENOTDIR —— 这类 I/O 异常不属于任何已建模的状态。
    const badLock = path.join(root, 'a.ts', 'nested', 'lock.json');
    const { code, out } = await run([
      'link', '--manifest', manifestPath,
      '--project-root', root, '--lock', badLock, '--format', 'json',
    ]);
    expect(code).toBe(2);
    const json = JSON.parse(out);
    expect(json).toMatchObject({ ok: false, exitCode: 2, degraded: true });
    expect(json.reason).toMatch(/内部错误/);
    expect(out).not.toMatch(/at .*\.mjs:\d+/);
  });
});

describe('FR-002 refresh 语义（--refresh MUST NOT 顺带新增）', () => {
  it('--refresh 刷新 lock 中不存在的 id → exit 2，且 MUST NOT 静默建锚', async () => {
    const { code, out } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh']));
    expect(code).toBe(2);
    expect(out).toMatch(/--refresh/);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('--refresh --id 指向不存在的 id → exit 2', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([
        { id: 'x1', ref: 'a.ts::addNumbers', docPath: 'docs/x.md', line: 3 },
        { id: 'ghost', ref: 'a.ts::addNumbers', docPath: 'docs/x.md', line: 9 },
      ]),
      'utf8',
    );
    const { code } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh', '--id', 'ghost']));
    expect(code).toBe(2);
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors.map((a: { id: string }) => a.id)).toEqual(['x1']);
  });

  it('refresh 落 unresolved 时写回旧 anchor 的完整十字段原记录（持久化结果，非内存返回值）', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const before = JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors[0];

    // 把 ref 改成解析不出来的目标，同时改 docPath/line —— 若实现拼接新旧字段，
    // lock 里会出现"新 docPath/line + 旧 symbolId"的混合记录。
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([{ id: 'x1', ref: 'a.ts::noSuchSymbol', docPath: 'docs/MOVED.md', line: 999 }]),
      'utf8',
    );
    const { code } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh']));
    expect(code).toBe(2);

    const after = JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors;
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before);
    expect(after[0].docPath).toBe('docs/x.md');
    expect(after[0].line).toBe(3);
  });

  it('refresh 落 unsupported-language（非可保留态）→ 不保留旧基线，旧记录原样留在 lock', async () => {
    await run(withPaths(['link', '--manifest', manifestPath]));
    const before = JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors[0];
    fs.writeFileSync(path.join(root, 'x.py'), 'def compute():\n    return 1\n', 'utf8');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify([{ id: 'x1', ref: 'x.py::compute', docPath: 'docs/x.md', line: 3 }]),
      'utf8',
    );
    const { code, out } = await run(withPaths(['link', '--manifest', manifestPath, '--refresh', '--format', 'json']));
    expect(code).toBe(2);
    expect(JSON.parse(out).results[0]).toMatchObject({ status: 'unsupported-language' });
    expect(JSON.parse(out).results[0].preserved).toBeUndefined();
    // 未刷新成功 → lock 内仍是刷新前那条完整记录
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).anchors[0]).toEqual(before);
  });
});
