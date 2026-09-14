/**
 * R-1（Feature 277 · FR-017 连带）：`agent-docs` 族的 fail-loud 兜底外壳。
 *
 * 为什么本卡必须做：`scripts/sync-agent-docs.mjs:66` 在 marker 缺失时 throw，
 * `:104` 的 `readFileSync(section.sourcePath)` 在源文件缺失时同样 throw，而
 * `repo-maintenance-core.mjs` 对该族**无 try/catch**。本卡把 marker 分布面从
 * 「仓根 2 个必然存在的文件」扩到「4 份 agent + 12 份 SKILL 目标」，且新增
 * `sourcePath` 全是本卡新建文件——任一缺失会让 `npm run repo:check` 以未捕获
 * 异常中止，**其余全部 check 的结论一并丢失**（不是静默放行，是整份报告不可用）。
 *
 * 方向必须 fail-loud（FR-045 / C-3）：catch 分支记 `fail` + 异常消息进 `evidence`，
 * **禁止**返回空 checks 数组或 `pass`。
 *
 * 本用例刻意让异常从**生产代码** `syncSection` 真实抛出（而不是合成一个 Error），
 * 这样「兜底外壳接得住的是不是真实失败形态」也一并被测到。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../../scripts/sync-agent-docs.mjs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const syncSection = actual.syncSection as (t: string, k: string, s: string) => string;
  return {
    ...actual,
    // 真实失败形态：目标文件里那对 marker 被删掉 —— sync-agent-docs.mjs:66 抛
    // `Missing sync markers for section "<key>"`。
    validateSharedAgentDocs: () =>
      syncSection('# AGENTS.md（marker 已被删除）\n', 'behavior-rules', 'body'),
  };
});

import { validateRepository } from '../../scripts/lib/repo-maintenance-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

interface Check {
  id: string;
  status: string;
  evidence: Record<string, unknown>;
}
interface ValidationResult {
  status: string;
  checks: Check[];
  warnings: string[];
  errors: string[];
}

describe('validateRepository —— agent-docs 族异常兜底（R-1）', () => {
  it('validateSharedAgentDocs 抛错时不抛穿，该族记 fail 且其余族结论完整', async () => {
    const result = (await validateRepository(REPO_ROOT)) as ValidationResult;

    const agentDocs = result.checks.filter((c) => c.id.startsWith('agent-docs:'));
    // 不是空 checks 数组
    expect(agentDocs.length).toBeGreaterThan(0);
    // 也不是 pass
    expect(agentDocs.every((c) => c.status === 'fail')).toBe(true);

    // 异常消息必须进 evidence（否则消费方拿到一条无从下手的 fail）
    const evidenceText = JSON.stringify(agentDocs.map((c) => c.evidence));
    expect(evidenceText).toMatch(/Missing sync markers/);

    const messages = result.errors.filter((m) => m.startsWith('[agent-docs]'));
    expect(messages.join('\n')).toMatch(/Missing sync markers/);
    expect(result.status).toBe('fail');

    // 其余检查族仍完整产出（不因 agent-docs 崩溃而丢失整份报告）
    expect(result.checks.filter((c) => !c.id.startsWith('agent-docs:')).length).toBeGreaterThan(60);
  }, 180_000);
});
