/**
 * Feature 180 — batch MCP 路径 + reproducibility（Story #9/#12）
 *
 * 验证 batch 工具在 stdio 链路下：
 *   T-010-3: batch { mode: 'incremental' }（非法 enum）→ SDK 拒绝（无需 LLM，必跑）
 *
 * 需要 LLM 可用时（HAS_LLM_E2E=1）额外验证：
 *   T-010-1: batch { incremental: true, languages: ['python'] } → 响应可解析，isError 合理
 *   T-010-2: batch { full: true, languages: ['python'] }（regen 逃生口）→ 响应 isError 不为 true
 *   T-010-4: 两次 batch { full: true, mode: 'full', languages: ['python'] } → graph.json 原始 Buffer deepEqual
 *   T-010-5: 若 T-010-4 原始 deepEqual 失败 → 归一化后 deepEqual 仍成立（兜底）
 *
 * 实测复核（T-011 节点）：
 *   batch LLM timeout 实测：runBatch 始终调 generateSpec → callLLM，mode='code-only' 只跳 enrichment
 *   micrograd python-only 全量跑约 3-5 分钟（不稳定，取决于 LLM 响应速度）
 *   因此 T-010-1/2/4/5 gate 在 HAS_LLM_E2E=1，缺省 skip（keyless CI 友好）
 *
 * Codex Plan-Warning-3：batch 两条正交轴
 *   (a) regen 轴：full/force/incremental 布尔（控制绕 cache）
 *   (b) 质量轴：mode='full'|'reading'|'code-only'（控制文档层级）
 *   mode='incremental' 不合法（不是 enum 成员），被 SDK/Zod 拒绝
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  spawnMcpClient,
  buildSkipCondition,
  buildSkipReason,
  MICROGRAD_SOURCE,
  type McpClientHandle,
} from './helpers/stdio-client.js';

// batch 测试需要 dist + micrograd 源 clone（copyDirShallow 从 MICROGRAD_SOURCE 拷贝到 tempRoot）
const SHOULD_SKIP = buildSkipCondition(true);
const SKIP_REASON = buildSkipReason(true);

// LLM E2E gate：HAS_LLM_E2E=1 时才跑真实 batch（依赖 LLM）
const HAS_LLM_E2E = process.env['HAS_LLM_E2E'] === '1';

/** 递归拷贝目录（浅拷贝，只拷一层子目录，够 micrograd 用） */
function copyDirShallow(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      for (const sub of readdirSync(srcPath, { withFileTypes: true })) {
        if (sub.isFile()) {
          copyFileSync(join(srcPath, sub.name), join(destPath, sub.name));
        }
      }
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ── T-010-3: mode='incremental' 非法 enum（无需 LLM，必跑）──
describe.skipIf(SHOULD_SKIP)(
  `用户故事: batch { mode: 'incremental' } 非法 enum 被 SDK 拒绝（无需 LLM，验证入参契约边界）${SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-batch-enum-'));
      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 30_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-010-3: mode='incremental' 不是合法 enum 值（合法值：full/reading/code-only）
    it('T-010-3: batch { mode: "incremental" } 非法 enum → 被拒绝（isError=true 或异常）', async () => {
      let errorMessage = '';
      let result: Awaited<ReturnType<typeof handle.client.callTool>> | null = null;
      try {
        result = await handle.client.callTool({
          name: 'batch',
          arguments: {
            mode: 'incremental',  // 非法 enum，SDK/Zod 应在 handler 前拒绝
          },
        });
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : String(e);
      }
      // 强断这是 **SDK schema 校验拒绝**（-32602 Invalid params / invalid_enum_value），
      // 而非 handler 被错误执行后返回的业务 {code} envelope（Codex Impl-C5）。
      // 实测：返回 isError=true，text="MCP error -32602: Input validation error:
      //   Invalid arguments for tool batch: [...invalid_enum_value...options:full/reading/code-only]"
      const respText =
        result?.isError === true
          ? ((result.content as Array<{ text?: string }>)[0]?.text ?? '')
          : '';
      const combined = errorMessage + respText;
      if (!combined) {
        console.log('[T-010-3 未拒绝响应]', JSON.stringify(result).slice(0, 300));
      }
      // 必须是 SDK 参数校验错误形态，不是业务错误码（如 graph-not-built 之类）
      expect(combined).toMatch(/-32602|Invalid arguments|invalid_enum_value/);
      // 反向断言：不应是 handler 业务 envelope（不含我们的 ErrorCode 形态 {"code":"..."}）
      expect(combined).not.toMatch(/"code"\s*:\s*"(internal-error|graph-not-built|invalid-input)"/);
    }, 20_000);
  },
);

// ── batch smoke + reproducibility（需要 HAS_LLM_E2E=1）──
describe.skipIf(!HAS_LLM_E2E || SHOULD_SKIP)(
  `用户故事: batch MCP 路径 smoke + reproducibility（需 HAS_LLM_E2E=1）${!HAS_LLM_E2E ? ' [skip: HAS_LLM_E2E 未设]' : SHOULD_SKIP ? ` [skip: ${SKIP_REASON}]` : ''}`,
  () => {
    let handle: McpClientHandle;
    let tempRoot: string;

    beforeAll(async () => {
      // 拷贝 micrograd 源文件到可写 tempRoot（batch 会写 spec 产物）
      tempRoot = mkdtempSync(join(tmpdir(), 'spectra-180-batch-llm-'));
      copyDirShallow(MICROGRAD_SOURCE, tempRoot);

      handle = await spawnMcpClient({ cwd: tempRoot });
    }, 60_000);

    afterAll(async () => {
      await handle.cleanup();
      if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    });

    // T-010-1: incremental batch → 响应可解析
    it('T-010-1: batch { incremental: true, languages: ["python"] } → 响应可解析，isError 合理', async () => {
      const result = await handle.client.callTool({
        name: 'batch',
        arguments: {
          incremental: true,
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(() => JSON.parse(text)).not.toThrow();
      // 不深验 deltaReport 内容语义（LLM 随机性，只验格式）
    }, 180_000);

    // T-010-2: full batch（regen 逃生口）→ isError 不为 true
    it('T-010-2: batch { full: true, languages: ["python"] }（regen 逃生口）→ isError 不为 true', async () => {
      const result = await handle.client.callTool({
        name: 'batch',
        arguments: {
          full: true,
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(() => JSON.parse(text)).not.toThrow();
    }, 180_000);

    // T-010-4: 两次 full batch → graph.json 原始 Buffer deepEqual（byte-stable，最强护栏）
    it('T-010-4: 两次 batch { full:true, mode:"full" } → graph.json 原始 Buffer deepEqual（F179 byte-stable 守卫）', async () => {
      // 第一次 full batch
      await handle.client.callTool({
        name: 'batch',
        arguments: {
          full: true,
          mode: 'full',
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      const graphPath = join(tempRoot, 'specs', '_meta', 'graph.json');
      const buf1 = readFileSync(graphPath);

      // 第二次 full batch（相同 commit，相同输入）
      await handle.client.callTool({
        name: 'batch',
        arguments: {
          full: true,
          mode: 'full',
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      const buf2 = readFileSync(graphPath);

      // 原始 Buffer deepEqual（byte-stable 最强护栏）
      expect(buf1).toEqual(buf2);
    }, 360_000);

    // T-010-5: 若 T-010-4 失败 → 归一化后 deepEqual 兜底
    it('T-010-5: 两次 full batch graph.json 归一化后 deepEqual（T-010-4 失败时兜底断言）', async () => {
      // 重跑两次（独立 it，不依赖 T-010-4 状态）
      await handle.client.callTool({
        name: 'batch',
        arguments: {
          full: true,
          mode: 'full',
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      const graphPath = join(tempRoot, 'specs', '_meta', 'graph.json');
      const normalized1 = JSON.parse(readFileSync(graphPath, 'utf-8'));

      await handle.client.callTool({
        name: 'batch',
        arguments: {
          full: true,
          mode: 'full',
          languages: ['python'],
          projectRoot: tempRoot,
        },
      });
      const normalized2 = JSON.parse(readFileSync(graphPath, 'utf-8'));

      // 归一化后语义 deepEqual（兜底：即使 key 排序等 byte 差异也应语义等价）
      expect(normalized1).toEqual(normalized2);
    }, 360_000);
  },
);
