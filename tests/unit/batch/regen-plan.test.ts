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

  describe('规则 (4)：undefined 默认路径（默认翻转 incremental=true，FR-001）', () => {
    // C5 修订：将 T004 的"全 undefined → incremental=false"原地改写为
    // "全 undefined → incremental=true"。此断言在 Phase 1 为 RED（当前实现 default=false），
    // GREEN T013 翻转规则 (4) 后转绿。不新增第二条互斥断言并存。
    it('全 undefined → { incremental:true, full:false, source:default }（默认翻转）', () => {
      expect(resolveRegenPlan({})).toEqual({
        incremental: true,
        full: false,
        source: 'default',
      });
    });
  });

  describe('EC-001：force 与 incremental 同时传入 → force 优先（全量）', () => {
    it('force=true + incremental=true → { incremental:false, full:true, source:full }', () => {
      // force 是 full 的等义别名，优先级高于 incremental（规则 1 先于规则 2）。
      // 翻转默认值不得破坏此优先级语义（FR-011）。
      expect(resolveRegenPlan({ force: true, incremental: true })).toEqual({
        incremental: false,
        full: true,
        source: 'full',
      });
    });
  });

  describe('SC-004：三入口默认值一致矩阵（均不传 regen 轴 → incremental=true）', () => {
    // CLI / MCP / config 三入口合并后都把"未给出"表示为 undefined，
    // 进入 resolveRegenPlan 后应得到同一默认真值（incremental=true）。此为默认翻转后行为，Phase 1 RED。
    it.each([
      ['CLI（无 flag）', {}],
      ['MCP（无参数）', {}],
      ['config（未指定 incremental 字段）', {}],
    ] as const)('%s → incremental=true', (_label, input) => {
      expect(resolveRegenPlan(input)).toEqual({
        incremental: true,
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
