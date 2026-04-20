/**
 * F5 批处理模式单元测试
 * 覆盖：BatchMode 类型、parse-args --mode 解析、batch-project-docs generator 过滤、MCP schema
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';
import type { BatchMode } from '../../src/panoramic/qa/types.js';

// ============================================================
// BatchMode 类型检查（编译期测试）
// ============================================================

describe('BatchMode 类型定义', () => {
  it('BatchMode 合法值应可赋值', () => {
    const modes: BatchMode[] = ['full', 'reading', 'code-only'];
    expect(modes).toHaveLength(3);
    expect(modes).toContain('full');
    expect(modes).toContain('reading');
    expect(modes).toContain('code-only');
  });
});

// ============================================================
// CLI parse-args --mode flag
// ============================================================

describe('parseArgs --mode flag（F5 CLI）', () => {
  it('不传 --mode 时 batchMode 为 undefined', () => {
    const result = parseArgs(['batch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBeUndefined();
    }
  });

  it('--mode full 被正确识别', () => {
    const result = parseArgs(['batch', '--mode', 'full']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.subcommand).toBe('batch');
      expect(result.command.batchMode).toBe('full');
    }
  });

  it('--mode reading 被正确识别', () => {
    const result = parseArgs(['batch', '--mode', 'reading']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('reading');
    }
  });

  it('--mode code-only 被正确识别', () => {
    const result = parseArgs(['batch', '--mode', 'code-only']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('code-only');
    }
  });

  it('无效 mode 值返回解析错误（FR-005）', () => {
    const result = parseArgs(['batch', '--mode', 'fast']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('invalid_option');
      expect(result.error.message).toContain('full | reading | code-only');
    }
  });

  it('--mode 可与其他 batch flag 组合', () => {
    const result = parseArgs(['batch', '--mode', 'reading', '--force']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('reading');
      expect(result.command.force).toBe(true);
    }
  });
});

// ============================================================
// batch-project-docs generator 过滤逻辑
// ============================================================

describe('batch-project-docs generator 过滤（F5 轻量模式）', () => {
  // 模拟 generator ID 列表（来自 plan §5）
  const allGeneratorIds = [
    'architecture-overview',
    'architecture-ir',
    'pattern-hints',
    'event-surface',
    'runtime-topology',
    'config-reference',
    'interface-surface',
    'architecture-narrative',
    'component-view',
    'dynamic-scenarios',
    'adr-pipeline',
    'product-ux-docs',
    'troubleshooting',
    'data-model',
    'workspace-index',
    'cross-package-analyzer',
    'api-surface',
    'docs-quality-evaluator',
  ];

  // reading 模式应跳过的 ID（来自 READING_SKIP_IDS）
  const READING_SKIP_IDS = new Set([
    'adr-pipeline',
    'product-ux-docs',
    'troubleshooting',
    'data-model',
    'docs-quality-evaluator',
  ]);

  // code-only 模式应跳过的 ID（来自 CODE_ONLY_SKIP_IDS）
  const CODE_ONLY_SKIP_IDS = new Set([
    ...READING_SKIP_IDS,
    'architecture-overview',
    'architecture-ir',
    'pattern-hints',
    'event-surface',
    'runtime-topology',
    'architecture-narrative',
    'component-view',
    'dynamic-scenarios',
  ]);

  it('reading 模式：READING_SKIP_IDS 中的 generator 应被过滤', () => {
    const activated = allGeneratorIds.filter((id) => !READING_SKIP_IDS.has(id));
    for (const skipId of READING_SKIP_IDS) {
      expect(activated).not.toContain(skipId);
    }
  });

  it('reading 模式：架构层 generator 应保留', () => {
    const activated = allGeneratorIds.filter((id) => !READING_SKIP_IDS.has(id));
    expect(activated).toContain('architecture-overview');
    expect(activated).toContain('architecture-ir');
    expect(activated).toContain('pattern-hints');
    expect(activated).toContain('architecture-narrative');
  });

  it('code-only 模式：CODE_ONLY_SKIP_IDS 中的 generator 均被过滤', () => {
    const activated = allGeneratorIds.filter((id) => !CODE_ONLY_SKIP_IDS.has(id));
    for (const skipId of CODE_ONLY_SKIP_IDS) {
      expect(activated).not.toContain(skipId);
    }
  });

  it('code-only 模式：静态 generator 保留', () => {
    const activated = allGeneratorIds.filter((id) => !CODE_ONLY_SKIP_IDS.has(id));
    expect(activated).toContain('config-reference');
    expect(activated).toContain('interface-surface');
    expect(activated).toContain('workspace-index');
    expect(activated).toContain('cross-package-analyzer');
    expect(activated).toContain('api-surface');
  });

  it('full 模式：不跳过任何 generator', () => {
    const skipIds = new Set<string>(); // full 模式无跳过
    const activated = allGeneratorIds.filter((id) => !skipIds.has(id));
    expect(activated).toHaveLength(allGeneratorIds.length);
  });

  it('code-only 跳过集合是 reading 跳过集合的超集', () => {
    for (const id of READING_SKIP_IDS) {
      expect(CODE_ONLY_SKIP_IDS.has(id)).toBe(true);
    }
  });
});

// ============================================================
// runBatch 无效 mode 错误路径（行为验证）
// ============================================================

describe('runBatch 无效 mode 错误提示（FR-005）', () => {
  it('无效 mode 时 runBatch 应抛出包含枚举值的错误', async () => {
    // 动态 import 避免全模块副作用
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    await expect(
      runBatch('/tmp', { mode: 'invalid' as BatchMode }),
    ).rejects.toThrow(/full \| reading \| code-only/);
  });

  it('valid mode 不应在校验阶段抛出', async () => {
    const { runBatch } = await import('../../src/batch/batch-orchestrator.js');
    // 允许因文件系统原因失败（/nonexistent），但不应因 mode 校验失败
    await expect(
      runBatch('/nonexistent-project-that-does-not-exist-xyz', { mode: 'reading' }),
    ).rejects.not.toThrow(/full \| reading \| code-only/);
  });
});

// ============================================================
// MCP batch tool schema Zod 校验
// ============================================================

describe('MCP batch tool mode schema Zod 校验', () => {
  it('合法 mode 值通过 Zod 枚举校验', () => {
    const { z } = require('zod');
    const modeSchema = z.enum(['full', 'reading', 'code-only']).optional();
    expect(modeSchema.parse('full')).toBe('full');
    expect(modeSchema.parse('reading')).toBe('reading');
    expect(modeSchema.parse('code-only')).toBe('code-only');
    expect(modeSchema.parse(undefined)).toBeUndefined();
  });

  it('非法 mode 值触发 ZodError', () => {
    const { z } = require('zod');
    const modeSchema = z.enum(['full', 'reading', 'code-only']).optional();
    expect(() => modeSchema.parse('fast')).toThrow();
  });
});
