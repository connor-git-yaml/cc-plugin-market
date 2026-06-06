/**
 * F175 Phase 0 — regen-plan 纯函数单测
 *
 * 验证 resolveRegenPlan 三条解析规则（Phase 0 默认值=false，行为不变）
 * 与 resolveSourceTarget 提取后与 batch-orchestrator.ts:713-720 内联逻辑等价。
 */

import { describe, it, expect } from 'vitest';
import { resolveRegenPlan, resolveSourceTarget } from '../../../src/batch/regen-plan.js';
import type { ModuleGroup } from '../../../src/batch/module-grouper.js';

describe('resolveRegenPlan — 三条解析规则（Phase 0 行为不变）', () => {
  describe('规则 (1)：full / force → 全量', () => {
    it('full=true → { incremental:false, full:true, source:full }', () => {
      expect(resolveRegenPlan({ full: true })).toEqual({
        incremental: false,
        full: true,
        source: 'full',
      });
    });

    it('force=true → { incremental:false, full:true, source:full }', () => {
      expect(resolveRegenPlan({ force: true })).toEqual({
        incremental: false,
        full: true,
        source: 'full',
      });
    });

    it('full 优先于 incremental：full=true 同时 incremental=true 仍走全量', () => {
      expect(resolveRegenPlan({ full: true, incremental: true })).toEqual({
        incremental: false,
        full: true,
        source: 'full',
      });
    });
  });

  describe('规则 (2)：显式 incremental=true → 增量（任何阶段都尊重显式 opt-in）', () => {
    it('incremental=true（显式）→ { incremental:true, full:false, source:incremental-explicit }', () => {
      // 显式 opt-in 在任何阶段都返回 incremental:true（与旧 runBatch 尊重显式 incremental=true 一致）；
      // Phase 0 的"默认 false"只作用于 undefined（规则 4），不覆盖显式 true。
      expect(resolveRegenPlan({ incremental: true })).toEqual({
        incremental: true,
        full: false,
        source: 'incremental-explicit',
      });
    });
  });

  describe('规则 (3)：显式 incremental=false → 兼容路径', () => {
    it('incremental=false（未给 full/force）→ { incremental:false, full:false, source:incremental-explicit }', () => {
      expect(resolveRegenPlan({ incremental: false })).toEqual({
        incremental: false,
        full: false,
        source: 'incremental-explicit',
      });
    });
  });

  describe('规则 (4)：undefined 默认路径（Phase 0 默认 incremental=false）', () => {
    it('全 undefined → { incremental:false, full:false, source:default }（Phase 0 行为，GREEN T013 才翻 true）', () => {
      expect(resolveRegenPlan({})).toEqual({
        incremental: false,
        full: false,
        source: 'default',
      });
    });
  });
});

describe('resolveSourceTarget — 与 batch-orchestrator 内联逻辑等价', () => {
  /** 复刻 batch-orchestrator.ts:713-720 的原内联逻辑作为 oracle */
  function inlineOracle(
    group: ModuleGroup,
    conflictingDirPaths: Set<string>,
    isRoot: boolean,
  ): string {
    const normalize = (p: string): string => p.split(/[\\/]/).join('/');
    const hasDirPathConflict =
      !isRoot && group.files.length === 1 && conflictingDirPaths.has(group.dirPath);
    return hasDirPathConflict
      ? normalize(group.files[0]!)
      : normalize(group.dirPath);
  }

  it('非冲突场景（多文件目录）→ 返回 dirPath 口径', () => {
    const group: ModuleGroup = {
      name: 'agents',
      dirPath: 'src/agents',
      files: ['src/agents/a.ts', 'src/agents/b.ts'],
    };
    const conflicts = new Set<string>();
    const got = resolveSourceTarget(group, conflicts, false);
    expect(got).toBe('src/agents');
    expect(got).toBe(inlineOracle(group, conflicts, false));
  });

  it('目录冲突场景（非 root + 单文件 + dirPath 冲突）→ 返回文件路径口径', () => {
    const group: ModuleGroup = {
      name: 'config',
      dirPath: 'src/config',
      files: ['src/config/index.ts'],
    };
    const conflicts = new Set<string>(['src/config']);
    const got = resolveSourceTarget(group, conflicts, false);
    expect(got).toBe('src/config/index.ts');
    expect(got).toBe(inlineOracle(group, conflicts, false));
  });

  it('单文件但无 dirPath 冲突 → 仍走 dirPath 口径', () => {
    const group: ModuleGroup = {
      name: 'config',
      dirPath: 'src/config',
      files: ['src/config/index.ts'],
    };
    const conflicts = new Set<string>();
    const got = resolveSourceTarget(group, conflicts, false);
    expect(got).toBe('src/config');
    expect(got).toBe(inlineOracle(group, conflicts, false));
  });

  it('root 模块即使单文件 dirPath 冲突也不触发文件级降级 → dirPath 口径', () => {
    const group: ModuleGroup = {
      name: 'root',
      dirPath: 'src',
      files: ['src/index.ts'],
    };
    const conflicts = new Set<string>(['src']);
    const got = resolveSourceTarget(group, conflicts, true);
    expect(got).toBe('src');
    expect(got).toBe(inlineOracle(group, conflicts, true));
  });
});
