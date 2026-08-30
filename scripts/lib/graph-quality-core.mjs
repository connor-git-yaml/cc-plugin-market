import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// F217（M9 轨道 B）— repo:check 图质量子检查薄封装。
//
// 不重复实现六指标判定逻辑（FR-020）：本模块只负责 spawn 已构建的 dist CLI
// （`node dist/cli/index.js graph-quality --json --graph <graphJsonPath>`），
// 复用同一份 `--json` 结构化契约做三态语义路由（skip/warning/error）。
//
// 选用 spawnSync 而非 execFileSync（决策 4）：CLI 契约是"输出 JSON 后以
// exit 1/2 表达强不变量违反/无法评估"，execFileSync 遇非零 exit 直接 throw
// （stdout 被裹进 error 对象），会让本应识别的强失败被静默吞掉/误判。
// spawnSync 无论 status 0/1/2 均先取 stdout。

function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}

/**
 * F258：`graph-quality` 挂在 `nextSteps` 上的"忽略判定不可判"机读前缀 token。
 *
 * 生产者是 `src/cli/commands/graph-quality.ts::IGNORE_UNDETERMINABLE_TOKEN`。两侧是**手写
 * 副本**（本文件是零 dist 依赖的 .mjs，不能 import TS），一致性由
 * `tests/unit/graph-quality-core.test.ts` 的跨侧断言守护——改任一侧而不改另一侧即测试红。
 */
export const IGNORE_UNDETERMINABLE_TOKEN = '[ignore-undeterminable]';

/**
 * F258 审查修复轮 M-1：三态 oracle **整体降级**的机读子 token。
 *
 * 生产者是 `src/cli/commands/graph-quality.ts::IGNORE_ORACLE_DEGRADED_TOKEN`，同为手写副本、
 * 同由 `tests/unit/graph-quality-core.test.ts` 跨侧双向钉住。
 *
 * 为什么这道 check 必须能识别降级：修复前 `git ls-files` 一失败，oracle 就退成二态，
 * `undeterminable` 结构性不可能产出 ⇒ `nextSteps` 无 token ⇒ 本 check 报 **pass**，
 * 标题还写着"无不可判路径（三态 oracle）"——**打坏 git 反而让门变绿**（审查实证）。
 */
export const IGNORE_ORACLE_DEGRADED_TOKEN = '[oracle-degraded]';

/**
 * F249 FR-013：单条 staleReason 的 warning 描述片段。
 *
 * 与 `src/cli/commands/graph-quality.ts` 的 `describeStaleReason` 是两套刻意分开的文案
 * （CLI 给建议、repo:check 给一句话结论），共同约束只有一条：都必须含原因字面量，使
 * "指纹型 stale 被描述成 sourceCommit 不一致"这类错配可被断言抓住。
 *
 * @param {string} reason
 * @param {{ recordedSourceCommit?: string|null, currentHead?: string|null }} freshness
 * @returns {string}
 */
function describeStaleReason(reason, freshness) {
  switch (reason) {
    case 'source-commit':
      return `source-commit：图记录的 sourceCommit（${freshness.recordedSourceCommit ?? 'null'}）与当前 HEAD（${freshness.currentHead ?? 'null'}）不一致`;
    case 'collector-fingerprint':
      return 'collector-fingerprint：图记录的 collector fingerprint 与当前采集器实现不一致（采集面或 behaviorVersion 已变更）';
    case 'collector-fingerprint-unrecorded':
      return 'collector-fingerprint-unrecorded：图未记录 collector fingerprint（旧图或直连建图 API 未写入），无法证明与当前采集器一致';
    case 'collector-fingerprint-invalid':
      return 'collector-fingerprint-invalid：图记录的 collector fingerprint 结构畸形，内容不可信';
    default:
      // 未来新增原因（本工具版本落后于产出报告的 CLI 版本）：原样回传而非静默丢弃
      return `${reason}：未识别的 stale 原因（请升级 spectra / 本仓工具链）`;
  }
}

/**
 * stale 态的完整 warning 文案：逐条原因拼接，顺序沿用 CLI 给出的确定性顺序。
 *
 * `staleReasons` 缺席时回落到 commit 级描述——那是本机制上线前 stale 的唯一语义。
 *
 * @param {{ recordedSourceCommit?: string|null, currentHead?: string|null }} freshness
 * @param {string[]} staleReasons
 * @returns {string}
 */
function describeFreshnessStale(freshness, staleReasons) {
  const reasons = staleReasons.length > 0 ? staleReasons : ['source-commit'];
  const detail = reasons.map((reason) => describeStaleReason(reason, freshness)).join('；');
  return `图产物已 stale（${reasons.join(', ')}）：${detail}。请重新运行 \`spectra batch --mode graph-only\` 重建图。`;
}

const EXIT_CODE_FOR_VERDICT = {
  pass: 0,
  'pass-with-warnings': 0,
  'fail-strong-invariant': 1,
  'cannot-assess': 2,
};

/**
 * 校验一个 repo 项目根目录下的图质量状态，供 repo-maintenance-core.mjs::validateRepository
 * 聚合为第 12 个子检查族（FR-017~020/026/027, SC-012）。
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ status: 'pass'|'warn'|'skip'|'fail', checks: Array<object>, warnings: string[], errors: string[] }}
 */
export function validateGraphQuality({ projectRoot }) {
  const resolvedRoot = path.resolve(projectRoot);
  const warnings = [];
  const errors = [];
  const checks = [];

  const graphJsonPath = path.join(resolvedRoot, 'specs', '_meta', 'graph.json');

  // FR-017：graph.json 不存在 → 优雅跳过（既非 warning 也非 error）。
  if (!fs.existsSync(graphJsonPath)) {
    checks.push(
      createCheck('graph-exists', '图产物存在（graph-quality 可评估）', 'skip', {
        graphJsonPath: path.relative(resolvedRoot, graphJsonPath).split(path.sep).join('/'),
      }),
    );
    return { status: 'skip', checks, warnings, errors };
  }

  const distCliPath = path.join(resolvedRoot, 'dist', 'cli', 'index.js');

  // 决策 4 修订：dist 未构建 → warning（不再是优雅跳过），联动 package.json
  // prepublishOnly 顺序调整（T040：build 先于 repo:check）。
  if (!fs.existsSync(distCliPath)) {
    warnings.push('图质量检测器未构建，`npm run build` 后重验。');
    checks.push(
      createCheck('dist-cli-built', 'CLI 编译产物已构建（graph-quality 可执行）', 'warn', {
        distCliPath: path.relative(resolvedRoot, distCliPath).split(path.sep).join('/'),
      }),
    );
    return { status: 'warn', checks, warnings, errors };
  }

  // FIX-2（Codex CRITICAL）：显式设 maxBuffer（Node 默认仅 1MB stdout），大图产物
  // 的 --json 输出可能超过默认上限被截断/触发 ENOBUFS，导致后续 JSON.parse 误判为
  // "检测器输出无法解析"而非真实原因。
  const MAX_SPAWN_BUFFER_BYTES = 64 * 1024 * 1024;

  const spawnResult = spawnSync(
    'node',
    [distCliPath, 'graph-quality', '--json', '--graph', graphJsonPath],
    { cwd: resolvedRoot, encoding: 'utf-8', maxBuffer: MAX_SPAWN_BUFFER_BYTES },
  );

  if (spawnResult.error) {
    const message =
      `图质量检测器子进程启动失败：${spawnResult.error.message}；输出可能超限被截断，` +
      '请直接运行 `node dist/cli/index.js graph-quality --json` 复核。';
    warnings.push(message);
    checks.push(
      createCheck('detector-invocation', 'graph-quality 检测器可正常执行', 'warn', {
        error: spawnResult.error.message,
      }),
    );
    return { status: 'warn', checks, warnings, errors };
  }

  let report;
  try {
    report = JSON.parse(spawnResult.stdout ?? '');
  } catch (parseError) {
    warnings.push(
      '图质量检测器输出无法解析（可能是图产物损坏或检测器自身异常），建议手动运行 `spectra graph-quality --json` 核实。',
    );
    checks.push(
      createCheck('detector-output-parseable', 'graph-quality 输出可被结构化解析', 'warn', {
        parseError: parseError instanceof Error ? parseError.message : String(parseError),
        stdoutPreview: (spawnResult.stdout ?? '').slice(0, 500),
        stderrPreview: (spawnResult.stderr ?? '').slice(0, 500),
        exitCode: spawnResult.status,
      }),
    );
    return { status: 'warn', checks, warnings, errors };
  }

  // 交叉校验 exit code 与 overallVerdict 是否一致——不信任不一致的信号，降级为 warning
  // 而非放大为 error（检测器自身可能有 bug，但不能证明是当前改动引入的代码级问题）。
  const expectedExitCode = EXIT_CODE_FOR_VERDICT[report.overallVerdict];
  if (expectedExitCode === undefined || spawnResult.status !== expectedExitCode) {
    warnings.push(
      `graph-quality 检测器 exit code(${spawnResult.status}) 与 overallVerdict(${report.overallVerdict}) 不一致，判定结果不可信，请手动运行 \`spectra graph-quality --json\` 核实。`,
    );
    checks.push(
      createCheck('detector-consistency', 'exit code 与 overallVerdict 判定一致', 'warn', {
        exitCode: spawnResult.status,
        overallVerdict: report.overallVerdict,
      }),
    );
    return { status: 'warn', checks, warnings, errors };
  }

  // FR-027：cannot-assess（图产物 JSON 损坏 / 结构损坏 / schemaVersion 过旧）→ warning。
  //
  // F266 第三轮对抗审查 E3：本分支**不再无条件早退**。早退在历史上是对的——那时 cannot-assess
  // 报告的六项指标一律是 `buildCannotAssessReport` 的 pass 占位，读它就是在伪造绿 check。
  // 但 D1 之后 `no-symbol-nodes` 走的是后置降级，报告体携带的是**真实测量值**；对它早退会让
  // legacy-ignored 的真发现、freshness stale、F258 的 `[ignore-undeterminable]` 诊断
  // 在消费侧整体塌陷（门禁一句都不说 = 又一处 fail-open）。
  //
  // 判据用**结构标记存在性**（`metricsPopulated === true`）而不是 `cannotAssessReason` 值枚举：
  // 值枚举每新增一个 reason 就漏判一次（F259 教训），且"真实 vs 占位"只有报告构造方知道。
  // 缺席（旧报告 / 占位报告）一律按占位处理 —— 保守方向，行为与本次改动前逐字一致。
  const metricsPopulated = report.metricsPopulated === true;
  if (report.overallVerdict === 'cannot-assess') {
    const cannotAssessReason = report.cannotAssessReason ?? 'unknown';
    const firstNextStep = (Array.isArray(report.nextSteps) ? report.nextSteps : []).find(
      (step) => typeof step === 'string' && step.length > 0,
    );
    warnings.push(
      metricsPopulated
        ? // 无 symbol 节点的图并不是"损坏或过旧"，照抄旧文案会把维护者引向错误的排查方向；
          // 透传报告自己的处方（`noSymbolNodesNextStep`）才是对成因的如实陈述。
          `图质量检测的整体结论不可采信（${cannotAssessReason}）：${firstNextStep ?? '报告体内各项指标仍为真实测量值，请按下方 checks 逐项排查。'}`
        : `图质量检测无法完成评估（${cannotAssessReason}），请检查 graph.json 是否损坏或过旧后重建。`,
    );
    checks.push(
      createCheck('graph-assessable', '图产物可被 graph-quality 完整评估', 'warn', {
        cannotAssessReason: report.cannotAssessReason,
        metricsPopulated,
      }),
    );
    // 占位报告：六项指标无信息量，继续往下读只会发出编造的 pass。真实指标报告：继续走逐维度
    // 发射路径。后者不会把 status 翻成 fail —— 强不变量违反根本不会被降级成 cannot-assess
    // （`downgradeForNoSymbolNodes` 对 `fail-strong-invariant` 原样返回），故此处只可能产出 warn。
    if (!metricsPopulated) {
      return { status: 'warn', checks, warnings, errors };
    }
  }

  // FR-018：强不变量违反（重复 canonical ID / 悬空边）→ error（阻断）。
  checks.push(
    createCheck(
      'duplicate-canonical-id',
      '图中无语义重复 canonical ID（强不变量）',
      report.duplicateCanonicalId.status,
      { groupCount: report.duplicateCanonicalId.groups.length },
    ),
  );
  if (report.duplicateCanonicalId.status === 'fail') {
    errors.push(
      `图中存在 ${report.duplicateCanonicalId.groups.length} 组语义重复 canonical ID（强不变量违反），请运行 \`spectra graph-quality\` 查看详情后修复 producer 逻辑。`,
    );
  }

  checks.push(
    createCheck('dangling-edge', '图中无悬空边（强不变量）', report.danglingEdges.status, {
      edgeCount: report.danglingEdges.edges.length,
    }),
  );
  if (report.danglingEdges.status === 'fail') {
    errors.push(
      `图中存在 ${report.danglingEdges.edges.length} 条悬空边（强不变量违反），请运行 \`spectra graph-quality\` 查看详情后修复边生成逻辑。`,
    );
  }

  // FR-019：非强不变量四项——contains 覆盖率 / orphan 比例 / legacy-ignored / freshness stale → warning。
  // 非强不变量四项在 checks 条目中统一用 'warn'（而非 'fail'）标注违规态——'fail' 在本仓库
  // checks 惯例中语义为"阻断级"，与 FR-019 "不阻断提交、仅提示" 的 warning 级别不符。
  checks.push(
    createCheck(
      'contains-coverage',
      'symbol 节点 contains 覆盖率达标',
      report.containsCoverage.status === 'fail' ? 'warn' : report.containsCoverage.status,
      {
        total: report.containsCoverage.total,
        covered: report.containsCoverage.covered,
        ratio: report.containsCoverage.ratio,
      },
    ),
  );
  if (report.containsCoverage.status === 'fail') {
    warnings.push(
      `contains 覆盖率不足（${report.containsCoverage.covered}/${report.containsCoverage.total}），${report.containsCoverage.uncoveredIds.length} 个 symbol 节点未被 contains 边覆盖。`,
    );
  }

  checks.push(
    createCheck(
      'orphan-ratio',
      'source symbol orphan 比例达标',
      report.orphanRatio.status === 'fail' ? 'warn' : report.orphanRatio.status,
      {
        offendingRatio: report.orphanRatio.offendingRatio,
        offendingCount: report.orphanRatio.offendingIds.length,
      },
    ),
  );
  if (report.orphanRatio.status === 'fail') {
    warnings.push(
      `orphan 比例超标（${report.orphanRatio.offendingIds.length}/${report.orphanRatio.totalSymbolNodes}），超过 5% 阈值。`,
    );
  }

  checks.push(
    createCheck(
      'legacy-ignored-nodes',
      '图中无遗留 # 节点 / ignored 路径节点',
      report.legacyAndIgnoredNodes.status === 'fail' ? 'warn' : report.legacyAndIgnoredNodes.status,
      {
        legacyCount: report.legacyAndIgnoredNodes.legacyHashNodeIds.length,
        ignoredCount: report.legacyAndIgnoredNodes.ignoredPathNodeIds.length,
      },
    ),
  );
  if (report.legacyAndIgnoredNodes.status === 'fail') {
    warnings.push(
      `图中存在 ${report.legacyAndIgnoredNodes.legacyHashNodeIds.length} 个遗留 \`#\` 节点 / ${report.legacyAndIgnoredNodes.ignoredPathNodeIds.length} 个 ignored 路径节点。`,
    );
  }

  // F258（D4）：三态 gitignore oracle 的"判不了"诊断消费者。
  //
  // 为什么是文本前缀匹配而不是结构化字段：`graph-quality-report.schema.json` 顶层是
  // `additionalProperties: false`，新增字段的连锁代价过大，故 CLI 侧把诊断挂在已有的
  // `nextSteps: string[]` 上。代价如实登记——这是一条**文本契约**，天然比 schema 字段脆弱，
  // 改文案即静默断链，因此 token 由 `tests/unit/graph-quality-core.test.ts` 跨侧双向钉住。
  //
  // 位置：必须在报告解析成功、且过了 exit-code 一致性与 cannot-assess 两道闸之后——
  // 那些分支下 `nextSteps` 要么不存在要么无意义，在那里读会制造假警报。
  // E3 之后 cannot-assess 不再一律早退：`metricsPopulated` 的报告会走到这里，而它的
  // `nextSteps` 正是 `buildReport` 的真实产物（只是被置顶了一条处方），读它有意义。
  const undeterminableStep = (Array.isArray(report.nextSteps) ? report.nextSteps : []).find(
    (step) => typeof step === 'string' && step.startsWith(IGNORE_UNDETERMINABLE_TOKEN),
  );
  // 审查修复轮 M-1：`degraded` 必须落成结构化 evidence，而不是让下游去猜文案措辞。
  // 该态下 pass 是**错**的答案——不是"没有不可判路径"，是"整套三态判定根本没在跑"。
  const oracleDegraded = Boolean(
    undeterminableStep && undeterminableStep.includes(IGNORE_ORACLE_DEGRADED_TOKEN),
  );
  checks.push(
    createCheck(
      'ignore-undeterminable',
      '图质量门的忽略判定无不可判路径、且三态 oracle 未降级',
      undeterminableStep ? 'warn' : 'pass',
      { detail: undeterminableStep ?? null, degraded: oracleDegraded },
    ),
  );
  if (undeterminableStep) {
    warnings.push(undeterminableStep);
  }

  // FR-010/FR-026：freshness——stale → warning；dirty MUST NOT 产生 warning（提交前工作树
  // 几乎必然 dirty，否则每次正常提交流程都会产生噪音告警）。
  // F249 FR-012/FR-013：stale 的原因（commit 不一致 / collector 指纹不一致、未记录、畸形）
  // 必须 reason-aware——文案与 evidence 两处都透传 staleReasons，缺一不可：只改人读文案会让
  // 下游按结构化字段消费的工具（CI 聚合 / 状态面板）继续拿不到原因。
  const staleReasons = report.freshness.staleReasons ?? [];
  checks.push(
    createCheck('freshness', '图内容与当前采集器/HEAD 一致（commit + collector 指纹级）', report.freshness.state === 'stale' ? 'warn' : 'pass', {
      state: report.freshness.state,
      recordedSourceCommit: report.freshness.recordedSourceCommit,
      currentHead: report.freshness.currentHead,
      staleReasons,
    }),
  );
  if (report.freshness.state === 'stale') {
    warnings.push(describeFreshnessStale(report.freshness, staleReasons));
  }
  // 'dirty' 态刻意不产生 warning（FR-026），checks 条目仍记录 state 供人工查看。

  const status = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
  return { status, checks, warnings, errors };
}
