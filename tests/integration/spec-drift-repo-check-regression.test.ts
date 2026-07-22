/**
 * T026（C2）：`repo:check` 接入 spec drift 第 13 检查族后的零回归守护（SC-007）。
 *
 * 四项断言：
 * (a) F217 六个图质量指标**逐项** check id 断言（不接受"整体 exit 0"作为代理证据）；
 * (b) 既有各族的 check id 集合与 status 与 T021 基线快照逐项一致；
 * (c) check id 全局唯一；
 * (d) 相对基线的新增项**精确等于** `spec-drift:anchors-status`（无 lock 场景下第 13 族的唯一产出）。
 *
 * 基线为何是"必须显式更新"的静态 fixture：
 * 基线若改成运行时动态推导（例如"过滤掉 spec-drift: 前缀后与当前结果自比"），
 * 前 12 族的任何增删都会自动被吸收进新基线，本测试就再也守不住"零回归"。
 * 保持静态快照 + 显式更新，才能让前 12 族的变化在 review 时可见。
 * （注：**不能**用"否则新增 agent-docs:* 会被静默放过"来论证——那种情况在断言 (d)
 *  下同样会红；真正的理由是上面这条"动态基线自我吸收"。）
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRepository } from '../../scripts/lib/repo-maintenance-core.mjs';

interface Check {
  id: string;
  title: string;
  status: string;
  evidence: Record<string, unknown>;
}
interface ValidationResult {
  status: string;
  checks: Check[];
  warnings: string[];
  errors: string[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const BASELINE_PATH = path.join(REPO_ROOT, 'tests/fixtures/spec-drift/repo-check/repo-check-baseline.json');

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as {
  checks: Array<{ id: string; status: string }>;
};

/** F217 六指标（duplicate / dangling / contains / orphan / ignored / freshness） */
const GRAPH_QUALITY_METRIC_IDS = [
  'graph-quality:duplicate-canonical-id',
  'graph-quality:dangling-edge',
  'graph-quality:contains-coverage',
  'graph-quality:orphan-ratio',
  'graph-quality:legacy-ignored-nodes',
  'graph-quality:freshness',
];

/**
 * `graph-quality:freshness` 会因图产物 sourceCommit 落后于 HEAD 而 warn，这是仓库现状
 * （图产物随 commit 而非随工作树刷新），非本 Feature 引入。故对该项接受 pass | warn，
 * 其余五项 MUST pass。删除本断言 = 放弃 SC-007(b) 的守护，禁止。
 */
const FRESHNESS_ID = 'graph-quality:freshness';

describe('repo:check 接入第 13 族后的零回归（SC-007）', () => {
  it('F217 六指标逐项断言 + 既有 12 族与基线逐项一致 + 第 13 族追加', async () => {
    const result = (await validateRepository(REPO_ROOT)) as ValidationResult;
    const byId = new Map(result.checks.map((c) => [c.id, c]));

    // (a) F217 六指标逐项存在且逐项 pass（freshness 容许 stale warn）
    for (const id of GRAPH_QUALITY_METRIC_IDS) {
      const check = byId.get(id);
      expect(check, `缺失图质量指标 ${id}`).toBeDefined();
      if (id === FRESHNESS_ID) {
        expect(['pass', 'warn'], `${id} 期望 pass 或 warn(stale)`).toContain(check!.status);
      } else {
        expect(check!.status, `${id} 应为 pass`).toBe('pass');
      }
    }

    // (b) 既有 12 族逐项一致（id 存在 + status 相同）
    for (const expected of baseline.checks) {
      const actual = byId.get(expected.id);
      expect(actual, `基线 check ${expected.id} 已消失（前 12 族发生回归）`).toBeDefined();
      if (expected.id === FRESHNESS_ID) {
        expect(['pass', 'warn']).toContain(actual!.status);
      } else {
        expect(actual!.status, `${expected.id} status 与基线不一致`).toBe(expected.status);
      }
    }

    // (c) check id MUST 全局唯一——重复 id 会让 byId 静默丢结论，且下方"新增项"比对失真
    const allIds = result.checks.map((c) => c.id);
    const duplicated = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    expect(duplicated, `重复 check id：${duplicated.join(', ')}`).toEqual([]);

    // (d) 相对基线新增的 check MUST **精确等于**第 13 族在"无 lock"场景下的唯一产出。
    //
    // ⚠️ 口径更正：不能只断言"新增项都以 spec-drift: 开头"——那样第 13 族多吐一条、
    // 吐错一条（如 lock-integrity）或吐重复项都会照过。此处按仓库当前无
    // `.specify/spec-drift.lock.json` 的事实，钉死唯一新增项。
    // 该仓库若日后建锚，本断言会红并要求显式更新基线，这是有意为之。
    const baselineIds = new Set(baseline.checks.map((c) => c.id));
    const added = allIds.filter((id) => !baselineIds.has(id));
    expect(added).toEqual(['spec-drift:anchors-status']);
  }, 120_000);

  it('validateRepository 不传 options 时向后兼容（默认非 strict，不抛错）', async () => {
    const result = (await validateRepository(REPO_ROOT)) as ValidationResult;
    expect(['pass', 'warn']).toContain(result.status);
    expect(result.errors).toEqual([]);
  }, 120_000);
});
