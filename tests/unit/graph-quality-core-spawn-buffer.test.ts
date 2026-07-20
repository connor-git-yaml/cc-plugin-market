/**
 * F217 FIX-2（Codex CRITICAL）— repo:check 图质量子检查 spawnSync maxBuffer 复核。
 *
 * 无法真实构造 64MiB dist CLI 输出复现 ENOBUFS（不现实），故 mock spawnSync 在
 * mock 层验证两点契约：
 * ① spawnSync 调用需显式传 maxBuffer: 64MiB（防真实大图输出被截断）
 * ② spawn error 分支的 warning 文案追加复核运行指引（不可能真造超限输出，
 *    mock 层验证契约即可）
 *
 * 独立成文件（不并入 graph-quality-core.test.ts）：该文件大量依赖真实 dist CLI
 * spawn 行为，若在同文件内 mock node:child_process 会污染其余真实 spawn 用例。
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
// @ts-expect-error — .mjs 无类型声明，运行时可解析
import { validateGraphQuality } from '../../scripts/lib/graph-quality-core.mjs';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});

const mockedSpawnSync = vi.mocked(spawnSync);

interface CheckResult {
  status: string;
  warnings: string[];
  errors: string[];
}

describe('validateGraphQuality: spawnSync maxBuffer + 失败复核指引（FIX-2）', () => {
  it('spawnSync 返回 error（模拟 ENOBUFS）→ warning 含复核运行指引，且调用已传 maxBuffer=64MiB', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-quality-core-spawnbuf-'));
    try {
      const graphDir = path.join(projectRoot, 'specs', '_meta');
      fs.mkdirSync(graphDir, { recursive: true });
      fs.writeFileSync(path.join(graphDir, 'graph.json'), '{}', 'utf-8');
      const distCliDir = path.join(projectRoot, 'dist', 'cli');
      fs.mkdirSync(distCliDir, { recursive: true });
      fs.writeFileSync(path.join(distCliDir, 'index.js'), '// stub\n', 'utf-8');

      mockedSpawnSync.mockReturnValueOnce({
        error: Object.assign(new Error('spawnSync node ENOBUFS'), { code: 'ENOBUFS' }),
        status: null,
        signal: null,
        output: [null, null, null],
        pid: 0,
        stdout: '',
        stderr: '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = validateGraphQuality({ projectRoot }) as CheckResult;

      expect(result.status).toBe('warn');
      expect(
        result.warnings.some((w) => w.includes('复核') && w.includes('graph-quality --json')),
      ).toBe(true);

      expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
      const options = mockedSpawnSync.mock.calls[0]?.[2] as { maxBuffer?: number } | undefined;
      expect(options?.maxBuffer).toBe(64 * 1024 * 1024);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
