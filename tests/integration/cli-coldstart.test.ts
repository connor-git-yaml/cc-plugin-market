/**
 * F201 冷启动护栏测试
 *
 * 验证 spectra CLI 在 @sqlite.org/sqlite-wasm 不可解析时，
 * 与 KB 无关的命令（--version / --help / batch --mode graph-only 等）
 * 仍能正常启动并返回 exit 0，不被 KB 依赖污染。
 *
 * 技术方案：用 --import 注册 ESM resolve hook（经 module.register() 安装），
 * 把 @sqlite.org/sqlite-wasm 的 resolve 请求强制抛 ERR_MODULE_NOT_FOUND，模拟"缺包"环境。
 *
 * skip 条件：dist/cli/index.js 不存在（需先 npm run build）。与 mcp-server-stdio.test.ts 一致。
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve('.');
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const REGISTER_HOOK = join(PROJECT_ROOT, 'tests', 'fixtures', 'block-sqlite-wasm-register.mjs');
const CLI_SOURCE = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

const HAS_DIST = existsSync(DIST_CLI);
const SKIP_REASON = HAS_DIST ? '' : 'dist/cli/index.js 不存在（先 npm run build）';

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
}

/**
 * spawn `node [--import <register>] dist/cli/index.js <args>` 并回收输出。
 * blockSqlite=true 时注入 resolve hook 模拟缺包。
 */
function runCli(args: string[], opts: { blockSqlite: boolean; cwd?: string } = { blockSqlite: false }): SpawnResult {
  const nodeArgs = opts.blockSqlite ? ['--import', REGISTER_HOOK, DIST_CLI, ...args] : [DIST_CLI, ...args];
  const result = spawnSync('node', nodeArgs, {
    cwd: opts.cwd ?? PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return { status: result.status, stdout, stderr, combined: `${stdout}\n${stderr}` };
}

describe.skipIf(!HAS_DIST)(
  `F201 describe 1 — 冷启动护栏（缺包模拟）${SKIP_REASON ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    it('hook 自检：注入 hook 时 import 失败且错误带 F201 sentinel（证明是 hook 拦截，非自然缺包）', () => {
      const withHook = spawnSync(
        'node',
        ['--import', REGISTER_HOOK, '-e',
          `import('@sqlite.org/sqlite-wasm').then(() => process.exit(3)).catch((e) => process.exit(String(e && e.message).includes('F201_HOOK_BLOCKED') ? 0 : 4))`,
        ],
        { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 },
      );
      // 0=hook 拦截且带 sentinel；3=import 成功(hook 没生效)；4=别的错误
      expect(withHook.status).toBe(0);
    }, 30_000);

    it('hook 自检反向：不注入 hook 时 import 成功（证明包真实存在，排除自然缺包误绿）', () => {
      const noHook = spawnSync(
        'node',
        ['-e', `import('@sqlite.org/sqlite-wasm').then(() => process.exit(0)).catch(() => process.exit(5))`],
        { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 },
      );
      // 0=包存在原生 import 成功；5=包缺失(环境异常,应显式失败而非误绿)
      expect(noHook.status).toBe(0);
    }, 30_000);

    it('1a --version：缺包下 exit 0 且输出 spectra 版本号', () => {
      const result = runCli(['--version'], { blockSqlite: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/spectra v\d+\.\d+\.\d+/);
    }, 30_000);

    it('1b --help：缺包下 exit 0 且 help 含 scaffold-kb', () => {
      const result = runCli(['--help'], { blockSqlite: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('scaffold-kb');
    }, 30_000);

    it('1c batch --mode graph-only：缺包下正常建图（exit 0 + graph-only 标志）且无 sqlite-wasm 污染', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'spectra-201-coldstart-'));
      try {
        writeFileSync(join(tmp, 'sample.ts'), 'export const x = 1;\nexport function f() { return x; }\n', 'utf-8');
        const result = runCli(['batch', '--mode', 'graph-only', '--no-html', '--output-dir', tmp], {
          blockSqlite: true,
          cwd: tmp,
        });
        // 冷启动未被 KB 依赖污染
        expect(result.combined).not.toContain('@sqlite.org/sqlite-wasm');
        expect(result.combined).not.toContain('ERR_MODULE_NOT_FOUND');
        // 真实建图成功（graph-only 纯 AST 零 LLM，最小工程稳定 exit 0）
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('graph-only');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }, 60_000);
  },
);

describe('F201 describe 2 — 静态护栏（源码断言）', () => {
  it('src/cli/index.ts 不含顶层静态 import { runScaffoldKb }', () => {
    const source = readFileSync(CLI_SOURCE, 'utf-8');
    expect(source).not.toContain("import { runScaffoldKb } from './commands/scaffold-kb.js'");
  });

  it('src/cli/index.ts 含动态 await import(scaffold-kb)', () => {
    const source = readFileSync(CLI_SOURCE, 'utf-8');
    expect(source).toContain("await import('./commands/scaffold-kb.js')");
  });
});

describe.skipIf(!HAS_DIST)(
  `F201 describe 3 — scaffold-kb 动态 import dispatch 回归守卫${SKIP_REASON ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    it('scaffold-kb build（无必需参数）：正常环境 exit 1 + stderr 含用法（真正触达 runScaffoldKb 动态 import）', () => {
      const result = runCli(['scaffold-kb', 'build'], { blockSqlite: false });
      // exit 1 是关键证据：若 --help 那样在全局分支 return 则是 exit 0；exit 1 证明进入了 switch→动态 import→runScaffoldKb
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('scaffold-kb build');
    }, 30_000);
  },
);
