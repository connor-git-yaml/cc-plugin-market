/**
 * F249 SC-009 五类 stale 场景的**单一定义**。
 *
 * 为什么抽成共享 helper 而不在各测试文件各写一份：SC-009 要求同一批样本在四个消费面
 * （CLI 文本 / `--json` / repo:check warning+evidence / bootstrap-status）都给出准确诊断，
 * 且 `--json` 输出还要过 schema 契约校验（T029）。若每个消费面测试各自手搓样本，"某个消费面
 * 测的其实是另一组样本"这类漂移无法被发现，五类覆盖也会悄悄退化成三类。
 *
 * 消费者：
 * - `tests/integration/graph-quality-cli.test.ts`（T030：CLI 文本 + `--json`）
 * - `tests/unit/contracts/graph-quality-report-schema.test.ts`（T029：真实 `--json` 输出过递归 schema 校验器）
 */
import {
  BEHAVIOR_VERSION,
  computeCollectorFingerprint,
  type CollectorFingerprint,
} from '../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { FreshnessStaleReason } from '../../src/panoramic/graph/quality/quality-types.js';

/**
 * schemaVersion 2.0 的最小合法图产物，默认携带**当前合法指纹**。
 *
 * 默认带指纹的理由：不带等价于"图未记录指纹"，按 FR-010 一律判 stale +
 * `collector-fingerprint-unrecorded`——绝大多数既有用例想测的不是这件事。
 */
export function baseFreshnessGraph(overrides: Partial<GraphJSON['graph']> = {}): GraphJSON {
  return {
    directed: false,
    multigraph: false,
    graph: {
      name: 'spectra-knowledge-graph',
      generatedAt: '2026-01-01T00:00:00.000Z',
      nodeCount: 0,
      edgeCount: 0,
      sources: ['unified-graph'],
      schemaVersion: '2.0',
      fingerprint: computeCollectorFingerprint(),
      ...overrides,
    },
    nodes: [],
    links: [],
  };
}

/** 仅 `behaviorVersion` 为旧值的指纹：其余字段与当前完全一致，隔离出"内容不一致"这一维度。 */
export function outdatedFingerprint(): CollectorFingerprint {
  const fingerprint = computeCollectorFingerprint();
  fingerprint.behaviorVersion = BEHAVIOR_VERSION - 1;
  return fingerprint;
}

/** 一个明显不可能等于任何真实 HEAD 的 commit SHA（构造 source-commit mismatch）。 */
export const MISMATCHED_COMMIT = 'f'.repeat(40);

/**
 * `FreshnessStaleReason` 的完整取值域，供"未命中的原因字面量不得出现在输出里"这类
 * 错配防线断言遍历（顺序与 quality-types.ts 的联合类型书写顺序一致）。
 */
export const ALL_STALE_REASONS: readonly FreshnessStaleReason[] = [
  'source-commit',
  'collector-fingerprint',
  'collector-fingerprint-unrecorded',
  'collector-fingerprint-invalid',
];

export interface FreshnessStaleScenario {
  /** 稳定标识（测试名与失败输出的锚点）。 */
  id: string;
  /** 人读说明。 */
  label: string;
  /** 该场景 MUST 产出的 `staleReasons`（顺序即断言，顺序确定性是 SC-007/SC-009 的一部分）。 */
  expectedStaleReasons: FreshnessStaleReason[];
  /**
   * 构造该场景的图产物。
   * @param currentHead 目标仓库的真实当前 HEAD——"commit 一致"类场景需要它才能构造出一致态
   */
  buildGraph(currentHead: string): GraphJSON;
}

/**
 * SC-009 五类样本：四种单一原因 + 一种多原因并存。
 *
 * 覆盖完备性理由：`staleReasons` 的取值域恰好四个（见 `FreshnessStaleReason`），四类单一原因
 * 逐一覆盖取值域，第五类覆盖"多原因并存时全部保留且顺序确定"这条独立要求（FR-009）。
 */
export const SC009_STALE_SCENARIOS: readonly FreshnessStaleScenario[] = [
  {
    id: 'source-commit',
    label: 'commit 不一致、指纹一致',
    expectedStaleReasons: ['source-commit'],
    buildGraph: () => baseFreshnessGraph({ sourceCommit: MISMATCHED_COMMIT }),
  },
  {
    id: 'collector-fingerprint',
    label: 'commit 一致、指纹结构合法但 behaviorVersion 为旧值',
    expectedStaleReasons: ['collector-fingerprint'],
    buildGraph: (currentHead) =>
      baseFreshnessGraph({ sourceCommit: currentHead, fingerprint: outdatedFingerprint() }),
  },
  {
    id: 'collector-fingerprint-unrecorded',
    label: 'commit 一致、指纹字段缺席（存量旧图）',
    expectedStaleReasons: ['collector-fingerprint-unrecorded'],
    buildGraph: (currentHead) => {
      const graph = baseFreshnessGraph({ sourceCommit: currentHead });
      // 删除字段而非置 null：这才是"本机制上线前生成的旧图"的真实形态
      delete graph.graph.fingerprint;
      return graph;
    },
  },
  {
    id: 'collector-fingerprint-invalid',
    label: 'commit 一致、指纹字段存在但结构畸形（空对象）',
    expectedStaleReasons: ['collector-fingerprint-invalid'],
    buildGraph: (currentHead) =>
      baseFreshnessGraph({
        sourceCommit: currentHead,
        // 空对象：结构上"有指纹"但一个必填子字段都没有 → invalid 而非 unrecorded
        fingerprint: {} as unknown as CollectorFingerprint,
      }),
  },
  {
    id: 'multi-reason',
    label: '多原因并存：commit 不一致 + 指纹畸形',
    expectedStaleReasons: ['source-commit', 'collector-fingerprint-invalid'],
    buildGraph: () =>
      baseFreshnessGraph({
        sourceCommit: MISMATCHED_COMMIT,
        fingerprint: { formatVersion: 99 } as unknown as CollectorFingerprint,
      }),
  },
];
