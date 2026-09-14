/**
 * M11 卡 C 第 2 项 — `agents-byte-budget` 候选集从守护项源码现取
 *
 * F277 R2-SC-C03：编排器在 scope 阶段把候选集口径写成「AGENTS.md 与 CLAUDE.md 的 max」传入 spec，
 * 而守护项实测只量 `['AGENTS.md', 'AGENTS.override.md']`。候选集此前是模块私有常量，任何下游想引用只能抄一份。
 * 本测试钉死：常量导出且冻结；check 的 evidence 在 pass / fail / skip 三态都自带 `candidates`，让 repo:check 的输出
 * 成为口径的唯一来源。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as core from '../../scripts/lib/worktree-local-state-core.mjs';

interface CheckResult {
  status: string;
  checks: Array<{ id: string; status: string; evidence: Record<string, unknown> }>;
}

const EXPECTED_CANDIDATES = ['AGENTS.md', 'AGENTS.override.md'];

describe('AGENTS_CANDIDATES 导出', () => {
  it('导出与 Codex 二选一读取口径一致的冻结数组', () => {
    expect(core.AGENTS_CANDIDATES).toEqual(EXPECTED_CANDIDATES);
    expect(Object.isFrozen(core.AGENTS_CANDIDATES)).toBe(true);
  });
});

describe('validateAgentsByteBudget evidence.candidates', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-byte-budget-'));
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function budgetCheck(): { status: string; evidence: Record<string, unknown> } {
    const result = core.validateAgentsByteBudget({ projectRoot }) as CheckResult;
    const check = result.checks.find((entry) => entry.id === 'agents-byte-budget');
    if (!check) throw new Error('agents-byte-budget check 缺席');
    return check;
  }

  it('pass 态：evidence.candidates 列出候选集全集（不只是在场文件）', () => {
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), 'small', 'utf-8');
    const check = budgetCheck();
    expect(check.status).toBe('pass');
    expect(check.evidence.candidates).toEqual(EXPECTED_CANDIDATES);
  });

  it('fail 态：evidence.candidates 同样在场', () => {
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.override.md'), 'x'.repeat(core.AGENTS_BYTE_BUDGET + 1), 'utf-8');
    const check = budgetCheck();
    expect(check.status).toBe('fail');
    expect(check.evidence.candidates).toEqual(EXPECTED_CANDIDATES);
  });

  it('skip 态（无候选文件）：evidence.candidates 仍在场，reason 保持 no-agents-doc', () => {
    const check = budgetCheck();
    expect(check.status).toBe('skip');
    expect(check.evidence.reason).toBe('no-agents-doc');
    expect(check.evidence.candidates).toEqual(EXPECTED_CANDIDATES);
  });
});
