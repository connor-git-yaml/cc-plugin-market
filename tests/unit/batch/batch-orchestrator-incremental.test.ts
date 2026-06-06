/**
 * F175 Phase 1 [RED] — batch-orchestrator 默认翻转 + mode×incremental 正交矩阵
 *
 * 验证两件事（Phase 1 全部 RED）：
 *   (1) 不传 incremental 时 runBatch 实际走 DeltaRegenerator 路径
 *       → batchResult.deltaReport 应被暴露（现状 BatchResult 无此对象字段 → undefined → RED）。
 *   (2) mode × incremental 正交矩阵：3 种 mode（full/reading/code-only）×
 *       { 默认增量, full } 两种 regen 路径，断言 deltaReport 行为与 regen 轴一致。
 *
 * RED 来源：deltaReport 对象未暴露（GREEN T016）+ 默认未翻转（GREEN T013）+ full option 未实现（GREEN T016/T017）。
 * 用 vi.mock 隔离 LLM，临时项目隔离副作用，不触碰生产代码。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { DeltaReport } from '../../../src/batch/delta-regenerator.js';
import type { BatchResult, BatchOptions } from '../../../src/batch/batch-orchestrator.js';

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: 'msg_f175_unit',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: [
          '## 1. 意图',
          'F175 unit mock。',
          '## 2. 业务逻辑',
          '纯函数。',
          '## 3. 接口定义',
          '| 名称 | 类型 | 签名 |',
          '|------|------|------|',
          '| run | function | (n: number) => number |',
          '## 4. 数据结构',
          '无。',
          '## 5. 约束条件',
          '有限数值。',
          '## 6. 边界条件',
          'n=0 返回 0。',
          '## 7. 技术债务',
          '无。',
          '## 8. 测试覆盖',
          '基础。',
          '## 9. 依赖关系',
          '见 import。',
        ].join('\n\n'),
      },
    ],
    model: 'claude-sonnet-4-6-20261001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
  return { mockCreate };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { create: mocks.mockCreate } })),
  Anthropic: vi.fn().mockImplementation(() => ({ messages: { create: mocks.mockCreate } })),
}));

// BatchResult 现无 deltaReport 对象字段；BatchOptions 现无 full 字段。
// 用扩展类型读取，使 RED 表现为运行时断言失败而非编译期错误（不破坏 npm run build）。
type BatchResultWithDelta = BatchResult & { deltaReport?: DeltaReport };
type BatchOptionsWithFull = BatchOptions & { full?: boolean };

const COMMON_OPTS: BatchOptions = {
  enableDebtIntelligence: false,
  generateHtml: false,
  enableAdr: false,
  progressMode: 'silent',
};

const activeRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'spectra-f175-unit-'));
  activeRoots.push(root);
  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  };
  write('package.json', JSON.stringify({ name: 'f175-unit', version: '0.0.0' }));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020' }, include: ['src'] }));
  write('src/a/index.ts', 'export function a(n: number): number {\n  return n + 1;\n}\n');
  write('src/b/index.ts', 'export function b(n: number): number {\n  return n - 1;\n}\n');
  return root;
}

async function runBatchOn(root: string, opts: BatchOptionsWithFull = {}): Promise<BatchResultWithDelta> {
  const { runBatch } = await import('../../../src/batch/batch-orchestrator.js');
  const result = await runBatch(root, { ...COMMON_OPTS, ...(opts as BatchOptions) });
  return result as BatchResultWithDelta;
}

describe('F175 batch-orchestrator 默认翻转 + mode×incremental 正交矩阵（Phase 1 RED）', () => {
  // W-3：保存并恢复 ANTHROPIC_API_KEY，避免污染同进程其他测试
  let savedApiKey: string | undefined;

  beforeAll(async () => {
    savedApiKey = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'test-key-f175-unit';
    const { bootstrapAdapters } = await import('../../../src/adapters/index.js');
    bootstrapAdapters();
  });

  beforeEach(() => mocks.mockCreate.mockClear());

  afterAll(() => {
    if (savedApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = savedApiKey;
    for (const root of activeRoots) {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    }
  });

  it('默认翻转：不传 incremental → runBatch 走 DeltaRegenerator 路径并暴露 deltaReport', async () => {
    const root = makeProject();
    const r = await runBatchOn(root);
    // 默认即走增量路径 → deltaReport 必须被暴露在 BatchResult 上（GREEN T013+T016）
    expect(r.deltaReport, '默认参数下应走 DeltaRegenerator 并暴露 deltaReport').toBeDefined();
    // 首次运行无历史 spec → 退化全量
    expect(r.deltaReport!.mode).toBe('full');
  });

  describe('mode × regen 正交矩阵（3 mode × 2 regen 路径）', () => {
    const modes = ['full', 'reading', 'code-only'] as const;

    for (const mode of modes) {
      it(`mode=${mode} + 默认增量 → deltaReport 暴露且 mode 轴不污染 regen 轴`, async () => {
        const root = makeProject();
        // 第一轮建基线（同 mode），第二轮无改动默认增量
        await runBatchOn(root, { mode });
        mocks.mockCreate.mockClear();
        const r2 = await runBatchOn(root, { mode });

        expect(r2.deltaReport, `mode=${mode} 默认增量应暴露 deltaReport`).toBeDefined();
        // 无改动 + 同 mode → 增量路径零模块级调用
        expect(r2.deltaReport!.mode).toBe('incremental');
        expect(mocks.mockCreate.mock.calls.length).toBe(0);
      });

      it(`mode=${mode} + full=true → 绕 DeltaRegenerator 全量重生成（regen 与 mode 正交）`, async () => {
        const root = makeProject();
        const r1 = await runBatchOn(root, { mode });
        const total = r1.totalModules;
        mocks.mockCreate.mockClear();
        // full 显式逃生口：即使无改动也全量重生成（RED：full option 未实现）
        const r2 = await runBatchOn(root, { mode, full: true });
        expect(r2.successful.length, `mode=${mode} full 应全量重生成`).toBe(total);
        expect(mocks.mockCreate.mock.calls.length).toBe(total);
      });
    }
  });
});
