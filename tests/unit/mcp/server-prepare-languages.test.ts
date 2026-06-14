/**
 * F186 T5 — prepare handler detectedLanguages ESM 死代码修复
 *
 * 背景：原 prepare handler 在 ESM 模块里用 `require('node:path')` / `require('node:fs')`。
 * 在真实 ESM 运行时（生产 MCP server）这会抛 `require is not defined`，被局部 try/catch
 * 静默吞掉 → detectedLanguages 永远不注入（死代码 + 假绿）。
 *
 * 测试策略：使用真实临时目录 + 真实 fs（不 mock node:fs），仅 mock scanFiles / prepareContext。
 * 这样能真实走 statSync 分支，验证：
 *   - 目录场景：detectedLanguages 正常注入（旧 require 死代码下 scanFiles 永不被调用）
 *   - 文件场景：跳过目录检测，detectedLanguages 不出现
 *
 * 为何不 mock node:fs：vitest 的 ESM 环境对 `require('node:fs')` 仍返回（可能被 mock 的）
 * 模块，无法复现生产 `require is not defined`。改用真实目录后，断言"scanFiles 被调用"
 * 才是对"statSync 分支真实执行"的可靠证据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareContext } from '../../../src/core/single-spec-orchestrator.js';
import { scanFiles } from '../../../src/utils/file-scanner.js';
import { createMcpServer } from '../../../src/mcp/server.js';
import type { ToolResult } from '../../../src/mcp/lib/tool-response.js';

vi.mock('../../../src/core/single-spec-orchestrator.js', () => ({
  prepareContext: vi.fn(),
  generateSpec: vi.fn(),
}));

vi.mock('../../../src/utils/file-scanner.js', () => ({
  scanFiles: vi.fn(),
}));

interface RegisteredToolHost {
  _registeredTools: Record<string, { handler: (args: unknown, extra?: unknown) => Promise<ToolResult> }>;
}

function getPrepareHandler(): (args: unknown, extra?: unknown) => Promise<ToolResult> {
  const server = createMcpServer() as unknown as RegisteredToolHost;
  return server._registeredTools['prepare'].handler;
}

function parseResponse(result: ToolResult): Record<string, unknown> {
  const text = result.content?.[0]?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text as string) as Record<string, unknown>;
}

describe('F186 T5 — prepare handler detectedLanguages（ESM 修复）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'spectra-prepare-'));
    vi.mocked(prepareContext).mockReset();
    vi.mocked(scanFiles).mockReset();
    vi.mocked(prepareContext).mockResolvedValue({
      skeletons: [],
      mergedSkeleton: {},
    } as unknown as Awaited<ReturnType<typeof prepareContext>>);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('目录场景：detectedLanguages 正常注入，不抛 require is not defined', async () => {
    vi.mocked(scanFiles).mockReturnValue({
      languageStats: new Map([
        ['typescript', 3],
        ['python', 1],
      ]),
    } as unknown as ReturnType<typeof scanFiles>);

    const handler = getPrepareHandler();
    // 真实临时目录 → statSync(...).isDirectory() === true，真实走 scanFiles 分支
    const result = await handler({ targetPath: tmpDir, deep: false });
    const data = parseResponse(result);

    expect(data['detectedLanguages']).toEqual(['typescript', 'python']);
    // scanFiles 真实被调用 → 证明 statSync 分支没被 `require is not defined` 短路
    expect(vi.mocked(scanFiles)).toHaveBeenCalledOnce();
  });

  it('文件场景（非目录）：detectedLanguages 不出现，跳过目录检测', async () => {
    const filePath = join(tmpDir, 'login.ts');
    writeFileSync(filePath, 'export const x = 1;\n', 'utf-8');

    const handler = getPrepareHandler();
    const result = await handler({ targetPath: filePath, deep: false });
    const data = parseResponse(result);

    expect('detectedLanguages' in data).toBe(false);
    expect(vi.mocked(scanFiles)).not.toHaveBeenCalled();
  });
});
