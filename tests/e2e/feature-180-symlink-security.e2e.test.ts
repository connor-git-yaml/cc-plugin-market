/**
 * Feature 180 — symlink 越界安全拦截（Story #3）
 *
 * 验证 view_file 在 stdio 子进程中对路径越界的拦截：
 *   1. 相对越界路径 ../../../etc/passwd → code='path-outside-root'
 *   2. tempRoot 内 symlink 指向 /etc → 响应 code='path-outside-root'，不泄露 /etc 内容
 *
 * 需要 dist；不需要 baseline graph（symlink 测试不依赖图谱）。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// symlink 安全测试只需要 dist，不需要 baseline graph
const SHOULD_SKIP = buildSkipCondition(false);
const SKIP_REASON = buildSkipReason(false);

describe.skipIf(SHOULD_SKIP)(
  `用户故事: view_file 越界路径和 symlink 在 stdio 子进程下返回 path-outside-root${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      // 在 tempRoot 内建 symlink 指向 /etc（macOS/Linux 均有 /etc）
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-symlink-'));
      symlinkSync('/etc', join(tempRoot, 'evil-link'));

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-005-1: 相对越界路径
    it('T-005-1: view_file 传相对越界 ../../../etc/passwd → isError=true, code=path-outside-root', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: '../../../etc/passwd',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(data.code).toBe('path-outside-root');
    }, 20_000);

    // T-005-2: symlink 越界
    it('T-005-2: view_file 传 symlink 路径（evil-link/passwd）→ isError=true, code=path-outside-root，不泄露 /etc 内容', async () => {
      const result = await handle.client.callTool({
        name: 'view_file',
        arguments: {
          path: 'evil-link/passwd',
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      const data = JSON.parse(text) as { code?: string };
      expect(data.code).toBe('path-outside-root');
      // 确认不泄露 /etc 的实际内容
      expect(text).not.toContain('root:x:');
      expect(text).not.toContain('daemon:');
    }, 20_000);
  },
);
