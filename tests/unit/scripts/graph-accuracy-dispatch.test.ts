/**
 * Feature 150 — graph-accuracy.mjs `--language` dispatch 兼容性单测
 *
 * 验证：
 *   1. python 是缺省 language（不传 --language 行为不变 → 向后兼容硬约束 FR-021 / SC-005）
 *   2. ts / go / java 当前阶段抛 "not yet implemented" 错误（清晰错误信息，避免 silent fail）
 *   3. 未知 language 抛 "Unsupported language" 错误（FR-004）
 *   4. 受支持的 language 列表恰好是 ['python', 'ts', 'go', 'java']
 *
 * 注：本测试不跑真实 python extractor（避免依赖 python3 + baseline workspace）。
 *   仅断言 dispatch 行为：python 路径会进入 fs.existsSync 检查（缺源码即抛 source not found），
 *   而 ts/go/java 在 dispatch 早期就抛 not yet implemented，不进 fs 检查。
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeGraphAccuracy,
  SUPPORTED_LANGUAGES,
} from '../../../scripts/graph-accuracy.mjs';

describe('graph-accuracy dispatch', () => {
  it('SUPPORTED_LANGUAGES 恰好为 [python, ts, go, java]', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['python', 'ts', 'go', 'java']);
  });

  it('缺省 language 走 python 路径（向后兼容）', () => {
    // python 路径会进入 source 存在检查 — 我们传不存在路径，期望得到 "source root does not exist"
    // 而非 "Unsupported language" 或 "not yet implemented"
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/non-existent-source-path-feature-150',
        graphPath: '/non-existent-graph-path-feature-150',
      }),
    ).toThrow(/source root does not exist/);
  });

  it('显式 --language python 行为与缺省一致（向后兼容）', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/non-existent-source-path-feature-150',
        graphPath: '/non-existent-graph-path-feature-150',
        language: 'python',
      }),
    ).toThrow(/source root does not exist/);
  });

  it('--language ts (sync) 抛 not yet implemented — Phase 4D 后 ts 走 async 路径 (Codex WARNING #4 修订)', () => {
    // sync API 仅 python 实装；ts 需用 async analyzeGraphAccuracyTs 或 CLI main 异步路径
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: 'ts',
      }),
    ).toThrow(/language="ts" extractor not yet implemented/);
  });

  it('--language go 抛 not yet implemented', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: 'go',
      }),
    ).toThrow(/language="go" extractor not yet implemented/);
  });

  it('async analyzeGraphAccuracyTs 存在并接受 ts 调用 (Codex WARNING #4 新增 Phase 4D 异步路径)', async () => {
    const mod = (await import('../../../scripts/graph-accuracy.mjs')) as Record<string, unknown>;
    expect(typeof mod.analyzeGraphAccuracyTs).toBe('function');
    // sourceRoot 不存在 → 应该 reject 但不 swallow（让 CLI 层拿到 error）
    await expect(
      (mod.analyzeGraphAccuracyTs as (args: { sourceRoot: string; graphPath?: string }) => Promise<unknown>)({
        sourceRoot: '/non-existent-source-feature-150-async',
      }),
    ).rejects.toBeTruthy();
  });

  it('--language java 抛 not yet implemented', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: 'java',
      }),
    ).toThrow(/language="java" extractor not yet implemented/);
  });

  it('未知 language 抛 Unsupported language', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: 'rust',
      }),
    ).toThrow(/Unsupported language: "rust"/);
  });

  it('Unsupported language 错误信息列出全部支持的 language', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: 'cobol',
      }),
    ).toThrow(/Supported: python, ts, go, java/);
  });

  it('空字符串 language 视为未知 → 抛 Unsupported language', () => {
    expect(() =>
      analyzeGraphAccuracy({
        sourceRoot: '/any',
        graphPath: '/any',
        language: '',
      }),
    ).toThrow(/Unsupported language/);
  });
});
