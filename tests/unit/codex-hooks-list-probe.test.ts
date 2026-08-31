/**
 * Feature 275 / T008-T012 — `codex-hooks-list-probe.mjs` 独立探针 helper 单测。
 *
 * 覆盖（plan §7.2b）：
 * - 硬约束 1：ENOENT 场景下 `spawn` 的 `'error'` 监听器行为，helper 不挂死（T008）
 * - own-entry 三条判据路径（`command`/`pluginId`/`sourcePath`）+ 误判防御（T009）
 * - 协议漂移防御：`trustStatus` 落在四值闭集之外 → 整体 `error`，不猜测聚合（T009）
 * - `initialize` 响应缺失/畸形 → 走 deadline 分支（T009）
 * - 硬约束 2：deadline 触发后确实以 `SIGKILL`（而非 `SIGTERM`）强杀（T009/T010）
 * - 真实子进程冒烟测试：PATH 注入假 `codex` shell stub，不调用真机 codex（T011）
 * - 硬约束 3：PATH 完全不含真实 `codex` 二进制时，本文件全部用例仍绿（T012，见下方
 *   运行说明；本文件所有场景均通过注入的假 `spawnFn`/PATH 驱动，不依赖真实 `codex`）
 *
 * 运行：
 *   npx vitest run tests/unit/codex-hooks-list-probe.test.ts
 *   PATH="$(dirname "$(command -v node)")" npx vitest run tests/unit/codex-hooks-list-probe.test.ts
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helperUrl = new URL('../../plugins/spec-driver/scripts/lib/codex-hooks-list-probe.mjs', import.meta.url);
const helperPath = fileURLToPath(helperUrl);
const probe = await import(helperUrl.href);

/** 造一个能模拟 `child_process.ChildProcess` 最小接口的假子进程双工对象。 */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

describe('F275 T008 — spawn ENOENT 场景：helper 不挂死（硬约束 1）', () => {
  it(
    'ENOENT：spawnFn 返回的子进程异步 emit error → readAppServerResponse 确定性返回 spawn-error/ENOENT，不挂起、不抛未捕获异常',
    async () => {
      const child = makeFakeChild();
      const spawnFn = vi.fn(() => {
        queueMicrotask(() => {
          const err = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
          child.emit('error', err);
        });
        return child;
      });
      const result = await probe.readAppServerResponse(spawnFn, '/tmp/f275-project', 2000);
      expect(result).toEqual({ kind: 'spawn-error', errorClass: 'ENOENT' });
    },
    5000,
  );

  it('ENOENT：spawnFn 同步抛错（另一种真实 spawn 失败形态）同样被兜住', async () => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    });
    const result = await probe.readAppServerResponse(spawnFn, '/tmp/f275-project', 2000);
    expect(result).toEqual({ kind: 'spawn-error', errorClass: 'ENOENT' });
  });
});

describe('F275 T009 — own-entry 三条判据路径 + 误判防御（经 deriveResult 全链路）', () => {
  const projectRoot = '/tmp/f275-project';

  function respond(entries: unknown[]) {
    return { data: [{ cwd: projectRoot, hooks: entries, warnings: [], errors: [] }] };
  }

  it('own-entry：仅 pluginId 命中 → 计入聚合', () => {
    const entry = {
      source: 'plugin',
      command: '/opt/othertool/not-ours.sh',
      pluginId: 'spec-driver@cc-plugin-market',
      sourcePath: '/opt/othertool/hooks.json',
      trustStatus: 'trusted',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['trusted'] });
  });

  it('own-entry：仅 sourcePath 命中 → 计入聚合', () => {
    const entry = {
      source: 'plugin',
      command: '/opt/othertool/not-ours.sh',
      sourcePath: '/Users/x/.codex/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/hooks.json',
      trustStatus: 'untrusted',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['untrusted'] });
  });

  it('F275 对抗审查后修订（假阴 C2）：source==="plugin" 且仅 command 命中（无 pluginId/sourcePath）→ 不再认领', () => {
    // 🔴 旧版对 source==='plugin' 的条目仍看 command 层，会被第三方插件的 command 字面提及
    // 我方脚本路径击穿（如 `echo /x/spec-driver/hooks/stop-task-check.sh`）。修订后
    // source==='plugin' 只认结构化的 pluginId / sourcePath 两层，不再看 command。
    const entry = {
      source: 'plugin',
      command: 'bash /Users/x/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/pre-tool-use-guard.sh',
      trustStatus: 'modified',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'absent', errorClass: null, entries: [] });
  });

  it('假阴 C2 实证形态：第三方插件条目的 command 提及我方脚本路径 → 不认领（不产生凭空 trusted）', () => {
    const entry = {
      source: 'plugin',
      pluginId: 'othertool@fakemkt',
      sourcePath: '/Users/x/.codex/plugins/cache/fakemkt/othertool/1.0/hooks/hooks.json',
      command: 'echo /opt/spec-driver/hooks/stop-task-check.sh',
      trustStatus: 'trusted',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'absent', errorClass: null, entries: [] });
  });

  it('假阴 C3 形态 b：非 plugin source（user）我方条目仅靠 command 命中 → 认领（消除硬门漏判）', () => {
    // 🔴 与上面「假阴 C2」相反的方向：非 plugin source（`user`/`project` 等，pluginId 恒为
    // null，没有结构化归属字段可用）仍保留 command 层判据，否则合并器写入路径 / 项目级
    // 我方条目会永远认不出。
    const entry = {
      source: 'user',
      pluginId: null,
      command: 'bash /Users/x/.claude/plugins/cache/cc-plugin-market/spec-driver/4.4.3/hooks/stop-fix-compliance-check.sh',
      trustStatus: 'untrusted',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['untrusted'] });
  });

  it('协议漂移防御：命中条目 trustStatus 为四值之外的第 5 个字符串 → 整体 outcome:error，不猜测聚合', () => {
    const entry = {
      source: 'plugin',
      pluginId: 'spec-driver@cc-plugin-market',
      trustStatus: 'some-unknown-fifth-value',
    };
    const result = probe.deriveResult(respond([entry]), projectRoot);
    expect(result).toEqual({ outcome: 'error', errorClass: 'parse-failed', entries: [] });
  });

  it('initialize 响应缺失/畸形（假子进程 stdout 只回一条无 id 字段的通知）→ 视为未拿到 id:2，走 deadline 分支', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 50);
    // 模拟一条无 id 字段的通知（如 configWarning），不含 id:2
    child.stdout.emit('data', Buffer.from(JSON.stringify({ method: 'configWarning', params: {} }) + '\n'));
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'timeout' });
  });

  it('deadline 触发：假子进程从不产出 id:2 → 到达 HOOKS_LIST_DEADLINE_MS 后返回超时结果，且确实调用了 kill', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const result = await probe.readAppServerResponse(spawnFn, projectRoot, 50);
    expect(result).toEqual({ kind: 'timeout' });
    expect(child.kill).toHaveBeenCalled();
  });
});

describe('F275 T010 — 强杀 SIGKILL 生效性验证（硬约束 2）', () => {
  it('deadline 到达后，helper 对假子进程调用的信号确实是 SIGKILL（而非 SIGTERM）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const start = Date.now();
    const result = await probe.readAppServerResponse(spawnFn, '/tmp/f275-project', 50);
    const elapsed = Date.now() - start;
    expect(result).toEqual({ kind: 'timeout' });
    // 假子进程"忽略 SIGTERM 但会被 SIGKILL 杀死"：若 helper 误用 SIGTERM，本断言直接失败
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.kill).not.toHaveBeenCalledWith('SIGTERM');
    // helper 自身在 deadline + 合理余量内完成返回（不挂死）
    expect(elapsed).toBeLessThan(2000);
  });

  it('命中 id:2 时同样以 SIGKILL 收尾（不等到 deadline）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, '/tmp/f275-project', 5000);
    child.stdout.emit(
      'data',
      Buffer.from(JSON.stringify({ id: 2, result: { data: [] } }) + '\n'),
    );
    const result = await resultPromise;
    expect(result.kind).toBe('ok');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('F275 T011 — 真实子进程冒烟测试（PATH 注入假 codex shell stub，不调用真机 codex）', () => {
  it('真实子进程：argv 解析、真实 spawn、JSON 打印、process.exit(0) 整条链路接得通', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f275-stub-path-'));
    const sentinelPath = path.join(tmpDir, 'stub-invoked.sentinel');
    const projectRoot = '/tmp/f275-smoke-project';
    // 🔴 canary：仅这个 stub 才会产出的可辨识 pluginId 值，用于证明确实命中了它而非真机 codex
    const canaryPluginId = 'spec-driver@f275-smoke-canary';
    const stubScript = [
      '#!/bin/sh',
      `touch "${sentinelPath}"`,
      'sleep 0.05',
      `printf '%s\\n' '{"id":1,"result":{}}'`,
      'sleep 0.05',
      `printf '%s\\n' '{"id":2,"result":{"data":[{"cwd":"${projectRoot}","hooks":[{"source":"plugin","pluginId":"${canaryPluginId}","trustStatus":"trusted"}],"warnings":[],"errors":[]}]}}'`,
      '',
    ].join('\n');
    const stubPath = path.join(tmpDir, 'codex');
    fs.writeFileSync(stubPath, stubScript, { mode: 0o755 });

    const output = execFileSync(process.execPath, [helperPath, projectRoot], {
      env: { ...process.env, PATH: `${tmpDir}${path.delimiter}${process.env.PATH ?? ''}` },
      encoding: 'utf-8',
      timeout: 10_000,
    });

    // stub 确实被调用（独立于 JSON 解析结果的第二重证据）
    expect(fs.existsSync(sentinelPath)).toBe(true);

    const parsed = JSON.parse(output);
    expect(parsed.outcome).toBe('found');
    expect(parsed.entries).toEqual(['trusted']);
  }, 15_000);
});

describe('F275 T012 — PATH 无 codex 环境下 helper 层单测仍绿（硬约束 3，本文件全量自证）', () => {
  it('本文件全部场景均通过注入的假 spawnFn / 受控 PATH 驱动，不依赖环境 PATH 上的真实 codex', () => {
    // 本用例本身即为文档性断言：真正的验证方式是用如下命令重跑本文件：
    //   PATH="$(dirname "$(command -v node)")" npx vitest run tests/unit/codex-hooks-list-probe.test.ts
    // 这里补一条运行时断言，确认当前 PATH 上即便没有 codex，helper 的纯函数导出仍可用
    // （防止 import 阶段有任何隐式依赖真实二进制的副作用）。
    expect(typeof probe.buildHooksListRequest).toBe('function');
    expect(typeof probe.isOwnPluginHookEntry).toBe('function');
    expect(typeof probe.readAppServerResponse).toBe('function');
    expect(typeof probe.deriveResult).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F275 对抗审查后修订（2026-08-31 终版裁决表）新增用例
// ─────────────────────────────────────────────────────────────────────────────

describe('F275 修订 A1 — close 早退：子进程秒退不再白等到 deadline', () => {
  const projectRoot = '/tmp/f275-project';

  it('exitCode !== 0 → exited-early → 归约为 error/non-zero-exit', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.emit('close', 7);
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'exited-early', exitCode: 7 });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'error',
      errorClass: 'non-zero-exit',
      entries: [],
    });
  });

  it('exitCode === 0 → exited-early → 归约为 error/rpc-error（进程正常退出但没谈成 RPC）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.emit('close', 0);
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'exited-early', exitCode: 0 });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'error',
      errorClass: 'rpc-error',
      entries: [],
    });
  });

  it('已拿到 id:2 后再收到 close 事件 → settle 幂等，不覆盖已定型结果', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 2, result: { data: [] } })}\n`));
    child.emit('close', 0);
    const result = await resultPromise;
    expect(result.kind).toBe('ok');
  });
});

describe('F275 修订 A2 — JSON-RPC 错误响应区分', () => {
  const projectRoot = '/tmp/f275-project';

  it('code===-32601（Method not found）→ not-executable/rpc-error（等价于旧版 Codex 无该方法）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ id: 2, error: { code: -32601, message: 'Method not found' } })}\n`),
    );
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'rpc-error-response', code: -32601 });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'not-executable',
      errorClass: 'rpc-error',
      entries: [],
    });
  });

  it('其他错误码 → error/rpc-error（保守处理，不当作二进制缺失）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ id: 2, error: { code: -32000, message: 'boom' } })}\n`),
    );
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'rpc-error-response', code: -32000 });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'error',
      errorClass: 'rpc-error',
      entries: [],
    });
  });

  it('响应既无 result 又无 error → malformed-response → error/parse-failed（不猜测兜底为原始 parsed）', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, projectRoot, 5000);
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: 2, unexpectedField: true })}\n`));
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'malformed-response' });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'error',
      errorClass: 'parse-failed',
      entries: [],
    });
  });
});

describe('F275 修订 A3 — spawn errno 类别保真透传', () => {
  const projectRoot = '/tmp/f275-project';

  it('EACCES → not-executable 且 errorClass=EACCES（不再压成 unknown）', async () => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error('spawn codex EACCES'), { code: 'EACCES' });
    });
    const result = await probe.readAppServerResponse(spawnFn, projectRoot, 2000);
    expect(result).toEqual({ kind: 'spawn-error', errorClass: 'EACCES' });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'not-executable',
      errorClass: 'EACCES',
      entries: [],
    });
  });

  it.each(['ENOTDIR', 'ELOOP'])('%s 同样归为 not-executable 且 errorClass 保真', async (code) => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error(`spawn codex ${code}`), { code });
    });
    const result = await probe.readAppServerResponse(spawnFn, projectRoot, 2000);
    expect(result).toEqual({ kind: 'spawn-error', errorClass: code });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'not-executable',
      errorClass: code,
      entries: [],
    });
  });

  it('未登记的 errno（如 EPIPE）→ error/unknown（不在四类白名单内不保真透传）', async () => {
    const spawnFn = vi.fn(() => {
      throw Object.assign(new Error('spawn codex EPIPE'), { code: 'EPIPE' });
    });
    const result = await probe.readAppServerResponse(spawnFn, projectRoot, 2000);
    expect(result).toEqual({ kind: 'spawn-error', errorClass: 'unknown' });
    expect(probe.mapReaderOutcome(result, projectRoot)).toEqual({
      outcome: 'error',
      errorClass: 'unknown',
      entries: [],
    });
  });
});

describe('F275 修订 A4 — deriveResult 的 cwd 匹配收窄', () => {
  const projectRoot = '/tmp/f275-project';

  it('data.length===0 → error/parse-failed（不再落 absent）', () => {
    const result = probe.deriveResult({ data: [] }, projectRoot);
    expect(result).toEqual({ outcome: 'error', errorClass: 'parse-failed', entries: [] });
  });

  it('data.length===1 时直接取该项，即便其 cwd 字面值与传入的 projectRoot 不完全一致', () => {
    const result = probe.deriveResult(
      {
        data: [
          {
            cwd: `${projectRoot}/`,
            hooks: [{ source: 'plugin', pluginId: 'spec-driver@x', trustStatus: 'trusted' }],
          },
        ],
      },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['trusted'] });
  });

  it('data.length>1 时按精确 cwd 匹配，命中 → 正常聚合', () => {
    const result = probe.deriveResult(
      {
        data: [
          { cwd: '/tmp/other-project', hooks: [] },
          {
            cwd: projectRoot,
            hooks: [{ source: 'plugin', pluginId: 'spec-driver@x', trustStatus: 'untrusted' }],
          },
        ],
      },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['untrusted'] });
  });

  it('data.length>1 且无一条 cwd 精确匹配 → error/parse-failed（不再静默落 absent）', () => {
    const result = probe.deriveResult(
      { data: [{ cwd: '/tmp/other-a', hooks: [] }, { cwd: '/tmp/other-b', hooks: [] }] },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'error', errorClass: 'parse-failed', entries: [] });
  });

  it('目标的 hooks 字段不是数组 → error/parse-failed', () => {
    const result = probe.deriveResult({ data: [{ cwd: projectRoot, hooks: 'not-an-array' }] }, projectRoot);
    expect(result).toEqual({ outcome: 'error', errorClass: 'parse-failed', entries: [] });
  });
});

describe('F275 修订 A5 — warnings/errors 提及我方插件的消费（不进返回值，仅影响 outcome）', () => {
  const projectRoot = '/tmp/f275-project';

  it('我方条目数为 0 且 warnings 含 spec-driver 子串 → error/rpc-error（不得读成确证没有）', () => {
    const result = probe.deriveResult(
      {
        data: [
          {
            cwd: projectRoot,
            hooks: [],
            warnings: ['failed to load hook for plugin spec-driver: bad config'],
            errors: [],
          },
        ],
      },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'error', errorClass: 'rpc-error', entries: [] });
  });

  it('我方条目数为 0 且 errors 含 spec-driver 子串 → error/rpc-error', () => {
    const result = probe.deriveResult(
      { data: [{ cwd: projectRoot, hooks: [], warnings: [], errors: ['spec-driver hook load error'] }] },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'error', errorClass: 'rpc-error', entries: [] });
  });

  it('warnings 含 spec-driver 但我方条目数 > 0 → 判定不受影响（仍走正常聚合）', () => {
    const result = probe.deriveResult(
      {
        data: [
          {
            cwd: projectRoot,
            hooks: [{ source: 'plugin', pluginId: 'spec-driver@x', trustStatus: 'trusted' }],
            warnings: ['unrelated notice mentioning spec-driver'],
            errors: [],
          },
        ],
      },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'found', errorClass: null, entries: ['trusted'] });
  });

  it('我方条目数为 0 且 warnings/errors 均不提及 spec-driver → absent（真的没有，不误升级为 error）', () => {
    const result = probe.deriveResult(
      { data: [{ cwd: projectRoot, hooks: [], warnings: ['unrelated warning'], errors: [] }] },
      projectRoot,
    );
    expect(result).toEqual({ outcome: 'absent', errorClass: null, entries: [] });
  });
});

describe('F275 修订 A7 — stdout 缓冲区 1MB 上限', () => {
  it('累计缓冲超过上限且从未见换行 → buffer-overflow → 归约为 error/parse-failed，且已强杀子进程', async () => {
    const child = makeFakeChild();
    const spawnFn = vi.fn(() => child);
    const resultPromise = probe.readAppServerResponse(spawnFn, '/tmp/f275-project', 5000);
    // 一次性喂入超过 1MB 且不含换行符的数据，触发缓冲区上限
    child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 10, 'a'));
    const result = await resultPromise;
    expect(result).toEqual({ kind: 'buffer-overflow' });
    expect(probe.mapReaderOutcome(result, '/tmp/f275-project')).toEqual({
      outcome: 'error',
      errorClass: 'parse-failed',
      entries: [],
    });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
