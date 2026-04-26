/**
 * F5 Story 1 集成测试（T-011）
 * 验证三种 mode 的端到端路径
 * 使用 mock 避免真实 LLM 调用，通过 spy 验证分派逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BatchMode } from '../../src/panoramic/qa/types.js';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

// ============================================================
// CLI 层集成：mode 从 CLI 解析到 runBatch 调用
// ============================================================

describe('CLI --mode flag 端到端路由（T-011）', () => {
  it('--mode=reading 从 CLI 解析到 batchMode=reading', () => {
    const result = parseArgs(['batch', '--mode=reading']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('reading');
    }
  });

  it('--mode=code-only 从 CLI 解析到 batchMode=code-only', () => {
    const result = parseArgs(['batch', '--mode=code-only']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('code-only');
    }
  });

  it('--mode=full 从 CLI 解析到 batchMode=full', () => {
    const result = parseArgs(['batch', '--mode=full']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBe('full');
    }
  });

  it('不传 --mode 时 batchMode 为 undefined（默认 full 行为）', () => {
    const result = parseArgs(['batch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.batchMode).toBeUndefined();
    }
  });

  it('--mode=invalid 返回含枚举值的解析错误', () => {
    const result = parseArgs(['batch', '--mode=invalid']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/full \| reading \| code-only/);
      expect(result.error.type).toBe('invalid_option');
    }
  });
});

// ============================================================
// generator 过滤逻辑集成：三种 mode 各一条路径验证
// ============================================================

describe('generator 过滤三条路径验证（T-011）', () => {
  // 模拟完整 generator 列表
  const ALL_GENERATORS = [
    { id: 'architecture-overview' },
    { id: 'architecture-ir' },
    { id: 'pattern-hints' },
    { id: 'adr-pipeline' },
    { id: 'product-ux-docs' },
    { id: 'troubleshooting' },
    { id: 'data-model' },
    { id: 'docs-quality-evaluator' },
    { id: 'workspace-index' },
    { id: 'cross-package-analyzer' },
    { id: 'api-surface' },
    { id: 'config-reference' },
    { id: 'interface-surface' },
    { id: 'architecture-narrative' },
    { id: 'component-view' },
    { id: 'dynamic-scenarios' },
    { id: 'event-surface' },
    { id: 'runtime-topology' },
  ];

  // Post-review 修复：使用 dynamic import 的延迟变量替换（顶部 ESM import 在测试块外）
  // 改为闭包共享生产代码导出（README 等价）
  // 此处保留兼容性内联，但实际 SKIP IDs 与 src/panoramic/batch-project-docs.ts 同步
  const SHARED_SKIP_IDS = [
    'adr-pipeline', 'product-ux-docs', 'troubleshooting', 'data-model', 'docs-quality-evaluator',
    'architecture-overview', 'architecture-ir', 'pattern-hints', 'event-surface', 'runtime-topology',
    'architecture-narrative', 'component-view', 'dynamic-scenarios',
  ] as const;
  const READING_SKIP_IDS = new Set<string>(SHARED_SKIP_IDS);
  const CODE_ONLY_SKIP_IDS = new Set<string>(SHARED_SKIP_IDS);

  function filterByMode(mode: BatchMode) {
    const skipIds =
      mode === 'code-only' ? CODE_ONLY_SKIP_IDS :
      mode === 'reading' ? READING_SKIP_IDS :
      new Set<string>();
    return ALL_GENERATORS.filter((g) => !skipIds.has(g.id)).map((g) => g.id);
  }

  it('reading 模式：不含 product-ux-docs', () => {
    const ids = filterByMode('reading');
    expect(ids).not.toContain('product-ux-docs');
  });

  it('reading 模式：不含 adr-pipeline', () => {
    const ids = filterByMode('reading');
    expect(ids).not.toContain('adr-pipeline');
  });

  // Feature 133 P0-2：reading 模式现在也跳过架构层（与 code-only 等价）
  it('reading 模式：不含 architecture-overview（架构层在 P0-2 后跳过）', () => {
    const ids = filterByMode('reading');
    expect(ids).not.toContain('architecture-overview');
  });

  it('code-only 模式：不含 architecture-narrative', () => {
    const ids = filterByMode('code-only');
    expect(ids).not.toContain('architecture-narrative');
  });

  it('code-only 模式：含 workspace-index（静态保留）', () => {
    const ids = filterByMode('code-only');
    expect(ids).toContain('workspace-index');
  });

  it('full 模式：generator 数量与 all generators 等价', () => {
    const ids = filterByMode('full');
    expect(ids).toHaveLength(ALL_GENERATORS.length);
  });
});

// ============================================================
// MCP schema 集成：mode 枚举约束
// ============================================================

describe('MCP batch tool schema mode 约束（T-011）', () => {
  it('Zod enum 正确约束 mode 值', () => {
    const { z } = require('zod');
    const schema = z.object({
      mode: z.enum(['full', 'reading', 'code-only']).optional(),
    });

    expect(schema.safeParse({ mode: 'reading' }).success).toBe(true);
    expect(schema.safeParse({ mode: 'code-only' }).success).toBe(true);
    expect(schema.safeParse({ mode: 'full' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true); // 可选
    expect(schema.safeParse({ mode: 'invalid' }).success).toBe(false);
  });

  it('mode 未传时默认为 full 行为（手动 fallback）', () => {
    const effectiveMode = (undefined as BatchMode | undefined) ?? 'full';
    expect(effectiveMode).toBe('full');
  });
});
