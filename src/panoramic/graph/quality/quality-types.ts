/**
 * 图质量门（Graph Quality Gates，F217）全套类型定义
 *
 * 对应 spec.md 的 Key Entities：GraphQualityReport / DuplicateCanonicalIdGroup /
 * DanglingEdgeRecord / OrphanExceptionCategory / GraphFreshnessVerdict。
 *
 * 纯类型模块，零 I/O、零 zod 依赖——六指标判定函数（duplicate-id-check 等）与
 * CLI 层（graph-quality.ts，P2 里程碑）共同复用这套类型作为契约。
 */

// ============================================================
// 判定状态
// ============================================================

/**
 * 单项检测的判定状态。
 * - pass：检测通过（问题数为 0）
 * - fail：检测未通过（存在问题）
 * - not-applicable：分母为 0，既非 pass 也非 fail（避免除零 / 误报 100%/0% 假象）
 */
export type CheckStatus = 'pass' | 'fail' | 'not-applicable';

// ============================================================
// FR-001/002：重复 canonical ID
// ============================================================

/**
 * 一组语义重复的问题记录。
 *
 * 归一化后的 (文件路径, symbol 名, kind) 三元组映射到一个以上不同的 canonical ID
 * 字符串时产出一条记录（涵盖遗留 `#` 分隔符与当前 `::` 分隔符共存场景）。
 */
export interface DuplicateCanonicalIdGroup {
  /** 归一化后的文件路径 */
  filePath: string;
  /** 归一化后的 symbol 名 */
  symbolName: string;
  /** 节点 kind（GraphNode.kind） */
  kind: string;
  /** 映射到同一三元组的所有 canonical ID 字符串（去重、字典序排序） */
  ids: string[];
}

// ============================================================
// FR-006：悬空边
// ============================================================

/** 一条悬空边的问题记录：source/target/relation 三元组，供定位。 */
export interface DanglingEdgeRecord {
  source: string;
  target: string;
  relation: string;
}

// ============================================================
// FR-005：orphan 例外分类
// ============================================================

/**
 * orphan 节点例外分类枚举，用于将符合例外规则的 zero-degree symbol 节点从超标分子中排除：
 * - entrypoint：文件级启发式（`main.*` / `index.*` / `__init__.py`）
 * - pure-type：纯类型声明（`metadata.exportKind === 'interface' | 'type'`）
 * - test-export：测试文件导出（复用 `LanguageAdapter.getTestPatterns()`）
 */
export type OrphanExceptionCategory = 'entrypoint' | 'pure-type' | 'test-export';

// ============================================================
// FR-009/010：freshness 四态
// ============================================================

/**
 * F249（FR-009）：`state === 'stale'` 的判别原因。
 *
 * 为什么不并入 `state` 枚举：`state` 表达"图与当前工作区的关系处于哪一态"，四态本身
 * 已完备且被下游（exit code 映射 / bootstrap-status 的 `FRESHNESS_STATES`）当作稳定契约；
 * "为什么 stale"是同一态下的多值维度（可并存），扩 `state` 会让每个新增原因都变成一次
 * 下游枚举破坏性变更。
 *
 * - source-commit：记录的 sourceCommit 与当前 HEAD 不一致（F217 既有语义）
 * - collector-fingerprint：指纹结构合法但内容与当前采集器行为不一致（FR-009）
 * - collector-fingerprint-unrecorded：指纹字段缺失或为 null（旧图 / 直连 API 未写入，FR-010）
 * - collector-fingerprint-invalid：指纹字段存在但结构畸形，不可信（FR-018）
 */
export type FreshnessStaleReason =
  | 'source-commit'
  | 'collector-fingerprint'
  | 'collector-fingerprint-unrecorded'
  | 'collector-fingerprint-invalid';

/**
 * freshness 判定的四态结果。
 * - fresh：sourceCommit 与当前 HEAD 一致、collector 指纹与当前实现一致，且工作树无未提交源码改动
 * - dirty：上述一致性均成立，但工作树存在未提交源码改动
 * - stale：sourceCommit 与当前 HEAD 不一致，或 collector 指纹不一致/缺失/畸形（原因见 staleReasons）
 * - unknown-provenance：sourceCommit 为 null / 缺失，或当前 HEAD 无法解析
 *   （currentHead 为 null 时绝不据此比较出 stale）
 */
export interface GraphFreshnessVerdict {
  state: 'fresh' | 'dirty' | 'stale' | 'unknown-provenance';
  /** 图产物记录的 sourceCommit（null=非 git 仓库/写盘失败；undefined=字段缺失，旧版本图产物） */
  recordedSourceCommit: string | null | undefined;
  /** 当前工作区 HEAD（null=非 git 仓库 / rev-parse 失败） */
  currentHead: string | null;
  /** dirty 态时列出触发判定的源码文件路径（供人读摘要展示） */
  dirtyFiles?: string[];
  /**
   * FIX-3（Codex 对抗审查）：`git status --porcelain` 读取失败（如 ENOBUFS）时，
   * 保守判定为 dirty（而非误判 fresh）并显式标注本字段为 true，供人读输出提示
   * "工作树状态读取失败，按 dirty 保守处理"。仅在 state === 'dirty' 时可能为 true。
   */
  porcelainReadFailed?: boolean;
  /**
   * F249（FR-009）：`state === 'stale'` 时的判别原因数组，多原因并存时全部保留。
   *
   * 顺序确定性由 `evaluateFreshness` 的固定 push 顺序保证（不依赖对象键遍历），
   * 下游文案渲染可直接依赖该顺序（SC-007/SC-009）。`state !== 'stale'` 时字段缺席。
   */
  staleReasons?: FreshnessStaleReason[];
}

// ============================================================
// GraphQualityReport 顶层聚合类型
// ============================================================

/** 六项质量指标 + freshness 聚合而成的一次 graph-quality 命令执行完整体检结果。 */
export interface GraphQualityReport {
  /** graph.json 的绝对路径 */
  graphPath: string;
  /** 本次检测执行时刻（ISO 8601） */
  generatedAt: string;
  /** 被检测图产物的 schemaVersion */
  schemaVersion: string;

  /** FR-001/002：语义重复 canonical ID */
  duplicateCanonicalId: {
    status: 'pass' | 'fail';
    groups: DuplicateCanonicalIdGroup[];
  };

  /** FR-003/004：symbol 节点 contains 覆盖率 */
  containsCoverage: {
    status: CheckStatus;
    total: number;
    covered: number;
    ratio: number | null;
    uncoveredIds: string[];
  };

  /** FR-005：source symbol orphan 比例 */
  orphanRatio: {
    status: CheckStatus;
    totalSymbolNodes: number;
    /** 全部 zero-degree symbol 节点数（未扣除例外分类前） */
    rawOrphanCount: number;
    /** 各例外分类命中数量 */
    exemptedByCategory: Record<OrphanExceptionCategory, number>;
    /** 超标分子占 symbol 节点总数的比例（totalSymbolNodes=0 时为 null） */
    offendingRatio: number | null;
    /** 未落入任何例外分类的 zero-degree symbol 节点 id 清单 */
    offendingIds: string[];
    /** 全节点级 zero-degree 率（信息展示，不参与本项 pass/fail 门禁判定） */
    allNodeZeroDegreeRatio: number;
  };

  /** FR-006：悬空边 */
  danglingEdges: {
    status: 'pass' | 'fail';
    edges: DanglingEdgeRecord[];
  };

  /** FR-007/008：遗留 `#` 节点 + ignored 路径节点 */
  legacyAndIgnoredNodes: {
    status: 'pass' | 'fail';
    legacyHashNodeIds: string[];
    ignoredPathNodeIds: string[];
  };

  /** FR-009/010：freshness 四态判定 */
  freshness: GraphFreshnessVerdict;

  /**
   * 总体 verdict，四态之一（FR-012）：
   * - pass：六项指标 + freshness 均无 warning 级或以上问题
   * - pass-with-warnings：无强不变量违反，但存在至少一项非强指标问题
   * - fail-strong-invariant：存在强不变量违反（重复 canonical ID / 悬空边）
   * - cannot-assess：命令无法完成评估（图产物不存在 / JSON 解析失败或结构损坏 / schemaVersion 过旧）
   */
  overallVerdict: 'pass' | 'pass-with-warnings' | 'fail-strong-invariant' | 'cannot-assess';
  /**
   * overallVerdict==='cannot-assess' 时的具体原因分类。
   * FIX-7（Codex 对抗审查）新增 'schema-newer-than-supported'：图产物 schemaVersion
   * 高于本工具当前支持的版本（如 2.1/3.0），提示升级 spectra 而非误判为陈旧/损坏。
   */
  cannotAssessReason?:
    | 'graph-missing'
    | 'json-parse-error'
    | 'schema-too-old'
    | 'schema-newer-than-supported';
  /** 面向维护者的下一步修复建议文本（SC-011） */
  nextSteps: string[];
}
