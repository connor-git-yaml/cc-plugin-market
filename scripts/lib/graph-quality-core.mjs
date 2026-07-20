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
  if (report.overallVerdict === 'cannot-assess') {
    warnings.push(
      `图质量检测无法完成评估（${report.cannotAssessReason ?? 'unknown'}），请检查 graph.json 是否损坏或过旧后重建。`,
    );
    checks.push(
      createCheck('graph-assessable', '图产物可被 graph-quality 完整评估', 'warn', {
        cannotAssessReason: report.cannotAssessReason,
      }),
    );
    return { status: 'warn', checks, warnings, errors };
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

  // FR-010/FR-026：freshness——stale → warning；dirty MUST NOT 产生 warning（提交前工作树
  // 几乎必然 dirty，否则每次正常提交流程都会产生噪音告警）。
  checks.push(
    createCheck('freshness', '图内容与当前 HEAD 一致（commit 级）', report.freshness.state === 'stale' ? 'warn' : 'pass', {
      state: report.freshness.state,
      recordedSourceCommit: report.freshness.recordedSourceCommit,
      currentHead: report.freshness.currentHead,
    }),
  );
  if (report.freshness.state === 'stale') {
    warnings.push(
      `图产物记录的 sourceCommit（${report.freshness.recordedSourceCommit ?? 'null'}）与当前 HEAD（${report.freshness.currentHead ?? 'null'}）不一致（commit 级 stale），请重新建图。`,
    );
  }
  // 'dirty' 态刻意不产生 warning（FR-026），checks 条目仍记录 state 供人工查看。

  const status = errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass';
  return { status, checks, warnings, errors };
}
