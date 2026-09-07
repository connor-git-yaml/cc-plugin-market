/**
 * T026（C2）：`repo:check` 接入 spec drift 第 13 检查族后的零回归守护（SC-007）。
 * F238/F239 追记：第 14 族 `model-literal-gate` 与第 15 族 `worktree-local-state` 接入后，本文件同时守护 13/14/15 三族的追加清单。
 *
 * 四项断言：
 * (a) F217 六个图质量指标**逐项** check id 断言（不接受"整体 exit 0"作为代理证据）；
 * (b) 既有各族的 check id 集合与 status 与 T021 基线快照逐项一致；
 * (c) check id 全局唯一；
 * (d) 相对基线的新增项**精确等于**第 13 族（无 lock 场景下唯一产出 `spec-drift:anchors-status`）
 *     、第 14 族（F238 `model-literal-gate:*`）与第 15 族（F239 四个 `worktree-local-state:*`）的并集。
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

describe('repo:check 接入第 13/14/15 族后的零回归（SC-007）', () => {
  it('F217 六指标逐项断言 + 既有 12 族与基线逐项一致 + 第 13/14/15 族追加', async () => {
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

    // (d) 相对基线新增的 check MUST **精确等于**第 13/14/15 族产出的并集（按追加顺序）。
    //
    // ⚠️ 口径更正：不能只断言"新增项都以某几个前缀开头"——那样任一族多吐一条、吐错一条
    // （如 lock-integrity）或吐重复项都会照过。此处按仓库当前事实钉死联合精确清单：
    //   - 第 4 族（spec-driver-wrappers）内的 F264 新增项：`codex-wrapper-runtime-namespace`——
    //     Codex wrapper 的 Claude 专属 MCP 命名空间残留扫描
    //   - 第 12 族（图质量）内的 F258 新增项：`graph-quality:ignore-undeterminable`——三态 gitignore
    //     oracle 的"判不了"诊断消费者（D4：新观测出口必须有人读）。它落在图质量族内，故按族追加
    //     顺序排在最前；基线固化的是接入它之前的快照，因此它以"新增"身份出现在此处
    //   - 第 13 族（spec drift）：仓库无 `.specify/spec-drift.lock.json`，故只产出 anchors-status
    //   - 第 14 族（F238 model-literal-gate，FR-310）：单一 model-literal-scan check
    //   - 第 15 族（F239 worktree-local-state）：`.worktreeinclude` 内容合同 3 项 + AGENTS 字节预算 1 项
    // 基线（`repo-check-baseline.json`）**保持不变**（固化"接入这些族之前"的历史快照）——
    // 若把新族也写进基线，"新增"就会变成"零新增"，本断言反而测不出接线是否真正成功。
    // 该仓库若日后建锚、或再有新族接入，本断言会红并要求显式更新基线，这是有意为之
    // （F238 与 F239 的接入正是这样被本断言拦下并在此显式落账的；两者 rebase 汇合时
    // 清单按 validateRepository 的族追加顺序取并集）。
    //
    // F277（K14）：清单由 8 项更新为**当次提交已落地的集合**。当前 = **13** 项，
    // 换算式：既有 8 + Phase A 已落地 3 + Phase C 已落地 2 = 13，单位：check id；
    // Phase A 的 3 = `agent-docs:shared-section:orchestrator-gate-mounting-guard` 1
    // + `agent-tools:required` 1 + `gate-mounting:effective-config` 1；
    // Phase C 的 2 = `agent-docs:shared-section:agent-output-discipline`（块 1） 1
    // + `agent-docs:shared-section:gate-tasks-scope-cut-acceptance`（块 3） 1。
    // **这是预期变更，不是回归**——本断言的设计意图（见上方 (d)）正是「新族接入必须被
    // 拦下并显式落账」。
    //
    // ⚠️ **本清单的更新口径 = 当次已落地集合，不是终值**（F277 implement 阶段裁定 I-1）。
    // 早前写法是在 Phase A 就写死终值 14，那会让 `npx vitest run` 从 Phase A 一路红到
    // Phase D——而仓规要求「提交前全量单测零失败」，任何中间提交都会因此违规。改为逐
    // Phase 更新后守护力不变：仍是**精确数组相等**，新族接入照样被拦下并显式落账，只是
    // 落账的时点跟着交付批次走。
    //
    // 分阶段值（每完成一个 Phase 就把下方数组更新为当次的落地集合，届时本断言转绿）：
    //   Phase A 段 A2 收口（新族 2 接线）        → 8 + 2 = 10
    //   Phase A 段 A3 收口（块 2 的 entry 落地） → 8 + 3 = 11
    //   Phase C 收口（块 1 / 块 3 两个 entry）   → 8 + 5 = 13 ← **当前值**
    //   Phase D 收口（块 4 entry，裁定 D-③）    → 8 + 6 = 14 ← 终值
    //
    // ⚠️ **族内排序契约**：`agent-docs` 族的各 id 顺序 == `sync-agent-docs.mjs` 的
    // `sectionConfigs` **数组追加顺序**。下方顺序按各块的落地 Phase 钉死，故后续 Phase
    // 新增 entry 一律 **append 到数组末尾**，不得插到已落地 entry 之前——插队即让本断言
    // 以「顺序不符」形式红，而那是排版问题不是接线问题，会污染本断言的信号。
    //
    // `tests/fixtures/spec-drift/repo-check/repo-check-baseline.json` **[禁改]**：
    // 以「同步基线」为名更新它即为把本守护项自身关掉。
    const baselineIds = new Set(baseline.checks.map((c) => c.id));
    const added = allIds.filter((id) => !baselineIds.has(id));
    expect(added).toEqual([
      // F277：`agent-docs` 是 `validateRepository` 的**第 1 族**，故新增的
      // `shared-section:*` 按族追加顺序排在全部既有新增项之前。
      'agent-docs:shared-section:orchestrator-gate-mounting-guard', // 块 2 · Phase A（T026）
      'agent-docs:shared-section:agent-output-discipline', // 块 1 · Phase C（T069）
      'agent-docs:shared-section:gate-tasks-scope-cut-acceptance', // 块 3 · Phase C（T069）
      // Phase D 落地后在此追加：'agent-docs:shared-section:gate-design-convergence-loop'（块 4 · 裁定 D-③）
      // F264：`spec-driver-wrappers` 族内新增的窄门禁——扫 Codex wrapper 是否残留 Claude 专属
      // MCP 命名空间（Codex 下该前缀恒不存在，照抄等于让它去调一个不存在的工具名）。它落在
      // 第 4 族内，故按族追加顺序排在图质量族之前。
      'spec-driver-wrappers:codex-wrapper-runtime-namespace',
      'graph-quality:ignore-undeterminable',
      'spec-drift:anchors-status',
      'model-literal-gate:model-literal-scan',
      'worktree-local-state:worktreeinclude-exists',
      'worktree-local-state:worktreeinclude-entries',
      'worktree-local-state:worktreeinclude-ignored-verified',
      'worktree-local-state:agents-byte-budget',
      // F277：第 16 / 17 族，位次由 `repo-maintenance-core.mjs` 的
      // `aggregateValidation` 插入顺序决定（两族均追加在 `worktree-local-state` 之后）。
      'agent-tools:required', // FR-017：8 条断言收敛为单个 check id
      'gate-mounting:effective-config', // FR-053：12 条断言收敛为单个 check id
    ]);
  }, 120_000);

  it('validateRepository 不传 options 时向后兼容（默认非 strict，不抛错）', async () => {
    const result = (await validateRepository(REPO_ROOT)) as ValidationResult;
    expect(['pass', 'warn']).toContain(result.status);
    expect(result.errors).toEqual([]);
  }, 120_000);
});
