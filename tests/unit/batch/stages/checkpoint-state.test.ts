/**
 * F220 B1 — checkpoint-state stage 级单测（Codex 设计审查 C4 要求随搬迁同批落地）
 *
 * 冻结 F182 修复面 4 的 replace 语义状态机：
 * - 同一 module 在每个集合最多出现一次（重复 upsert 去重）
 * - completed 与 failed 互斥（completed→failed / failed→completed 迁移时旧条目被剔除）
 * 以及 F175 FR-017/EC-009 受管目录判定（防 sibling 前缀误判 / 后缀校验）。
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';

import {
  upsertCompletedModule,
  recordFailedModule,
  isInManagedOutputDir,
} from '../../../../src/batch/stages/checkpoint-state.js';
import type { BatchState, CompletedModule, FailedModule } from '../../../../src/models/module-spec.js';

function makeState(): BatchState {
  return {
    batchId: 'batch-test',
    projectRoot: '/tmp/p',
    startedAt: '2026-07-21T00:00:00.000Z',
    lastUpdatedAt: '2026-07-21T00:00:00.000Z',
    totalModules: 2,
    processingOrder: ['src/a', 'src/b'],
    completedModules: [],
    failedModules: [],
    forceRegenerate: false,
  };
}

function completed(path: string): CompletedModule {
  return { path, specPath: `specs/modules/${path.replace(/\//g, '-')}.spec.md`, completedAt: '2026-07-21T00:00:01.000Z' };
}

function failed(path: string): FailedModule {
  return { path, error: 'boom', failedAt: '2026-07-21T00:00:02.000Z', retryCount: 1, degradedToAstOnly: false };
}

describe('F220 B1 checkpoint-state 状态机（F182 replace 语义冻结）', () => {
  it('重复 upsert 同一 module → completed 集合仅一条（去重 replace）', () => {
    const state = makeState();
    upsertCompletedModule(state, completed('src/a'));
    upsertCompletedModule(state, { ...completed('src/a'), completedAt: '2026-07-21T00:00:09.000Z' });
    expect(state.completedModules).toHaveLength(1);
    expect(state.completedModules[0]!.completedAt).toBe('2026-07-21T00:00:09.000Z');
    expect(state.failedModules).toHaveLength(0);
  });

  it('failed→completed 迁移：upsert 把同名条目从 failedModules 剔除（互斥）', () => {
    const state = makeState();
    recordFailedModule(state, failed('src/a'));
    expect(state.failedModules).toHaveLength(1);

    upsertCompletedModule(state, completed('src/a'));
    expect(state.completedModules.map((m) => m.path)).toEqual(['src/a']);
    expect(state.failedModules).toHaveLength(0);
  });

  it('completed→failed 迁移：record 把同名条目从 completedModules 剔除（互斥）', () => {
    const state = makeState();
    upsertCompletedModule(state, completed('src/a'));
    recordFailedModule(state, failed('src/a'));
    expect(state.failedModules.map((m) => m.path)).toEqual(['src/a']);
    expect(state.completedModules).toHaveLength(0);
  });

  it('重复 record 同一失败 module → failed 集合仅一条', () => {
    const state = makeState();
    recordFailedModule(state, failed('src/a'));
    recordFailedModule(state, { ...failed('src/a'), retryCount: 3 });
    expect(state.failedModules).toHaveLength(1);
    expect(state.failedModules[0]!.retryCount).toBe(3);
  });

  it('不同 module 互不影响（同集合共存）', () => {
    const state = makeState();
    upsertCompletedModule(state, completed('src/a'));
    recordFailedModule(state, failed('src/b'));
    expect(state.completedModules.map((m) => m.path)).toEqual(['src/a']);
    expect(state.failedModules.map((m) => m.path)).toEqual(['src/b']);
  });
});

describe('F220 B1 isInManagedOutputDir（F175 FR-017/EC-009 冻结）', () => {
  const modulesDir = '/proj/specs/modules';

  it('受管目录内 .spec.md → true', () => {
    expect(isInManagedOutputDir(join(modulesDir, 'a.spec.md'), modulesDir)).toBe(true);
    expect(isInManagedOutputDir(join(modulesDir, 'nested', 'b.spec.md'), modulesDir)).toBe(true);
  });

  it('sibling 目录前缀（specs/modules-old/）不得误判为受管（禁 startsWith 语义）', () => {
    expect(isInManagedOutputDir('/proj/specs/modules-old/a.spec.md', modulesDir)).toBe(false);
  });

  it('受管目录内但非 .spec.md 后缀 → false', () => {
    expect(isInManagedOutputDir(join(modulesDir, 'note.md'), modulesDir)).toBe(false);
  });

  it('目录外绝对路径 → false', () => {
    expect(isInManagedOutputDir('/elsewhere/a.spec.md', modulesDir)).toBe(false);
  });
});
