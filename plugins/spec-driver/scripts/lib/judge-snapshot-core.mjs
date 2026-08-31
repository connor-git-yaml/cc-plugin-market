/**
 * judge-snapshot-core.mjs
 * Feature 236 — 判定器快照漂移信号：纯函数层
 *
 * 零 I/O、零对 judge-snapshot-io.mjs 的依赖（保持单向依赖：doctor.mjs → {io.mjs, core.mjs}）。
 * 导出：JUDGE_FILE_SET 常量、resolveActiveSnapshot、compareFile、aggregateStatus。
 *
 * 运行相关测试: node --test plugins/spec-driver/tests/judge-snapshot-core.test.mjs
 */

/**
 * 判定器文件集合（相对 plugins/spec-driver/ 的路径）。
 * 与 FR-002b 守卫测试解析出的真实 import 闭包完全相等（见 data-model.md §1）。
 * Object.freeze 防止运行期意外改写这一事实源。
 */
export const JUDGE_FILE_SET = Object.freeze([
  'scripts/fix-compliance-judge.mjs',
  'scripts/lib/fix-compliance-core.mjs',
  'scripts/lib/fix-compliance-execution-record.mjs',
  'scripts/lib/fix-compliance-io.mjs',
  // F270 P3：background_tasks 在途三态判定进入判定器 import 闭包（FR-038）。
  // 注意：账本采集器 ledger-writer.mjs **不在**此集——它是 PostToolUse 采集侧、
  // 不被判定器 import；判定器读账本的 ledger-reader（P4）落地时才入集。
  'scripts/lib/in-flight-verdict.mjs',
  // F246：record-workflow-run.mjs 的入口守卫改用共享 helper 后，helper 进入判定器 import 闭包
  'scripts/lib/is-invoked-directly.mjs',
  'scripts/lib/simple-yaml.mjs',
  'scripts/record-workflow-run.mjs',
]);

/**
 * 从单一来源探测结果映射为 SnapshotResolutionResult 的短路判定。
 * @returns {object|null} 命中（ok/error）时返回结果，需继续 fallback 时返回 null
 */
function resolveFromSourceProbe(probe, source) {
  switch (probe.kind) {
    case 'ok':
      return { snapshotPath: probe.path, resolutionSource: source };
    case 'error':
      return {
        snapshotPath: null,
        resolutionSource: 'indeterminate',
        reason: 'source-error',
        detail: { source, errorCode: probe.errorCode },
      };
    // 'invalid'（确定性负判定）/ 'unavailable' → 继续下一优先级
    default:
      return null;
  }
}

/**
 * FR-007 四步 active-version 解析（纯函数）。
 * 优先级：CLAUDE_PLUGIN_ROOT → .spec-driver-path → installed_plugins.json。
 * error/json-parse-error 一律归为 source-error 并立即短路，禁止"取最高版本号"兜底。
 * 见 data-model.md §4 决策逻辑 + §3.6 去重/优先级边界。
 */
export function resolveActiveSnapshot(sources) {
  // 第 1 步：CLAUDE_PLUGIN_ROOT
  const fromEnv = resolveFromSourceProbe(sources.claudePluginRoot, 'claude-plugin-root');
  if (fromEnv) return fromEnv;

  // 第 2 步：.specify/.spec-driver-path
  const fromSpecPath = resolveFromSourceProbe(sources.specDriverPath, 'spec-driver-path-file');
  if (fromSpecPath) return fromSpecPath;

  // 第 3 步：installed_plugins.json
  const meta = sources.installedMetadata;
  if (meta.kind === 'error') {
    return {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: meta.errorCode },
    };
  }
  if (meta.kind === 'invalid') {
    // 文件"存在但读不懂"（json-parse-error）→ 不确定性，不可 fallback
    return {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: meta.reason },
    };
  }
  if (meta.kind === 'ok') {
    const resolved = resolveFromCandidates(meta.candidates);
    if (resolved) return resolved;
    // 候选过滤后为空 → 落到第 4 步
  }
  // meta.kind === 'absent' 或候选过滤后为空 → 第 4 步

  // 第 4 步：三路均无可用候选
  return {
    snapshotPath: null,
    resolutionSource: 'indeterminate',
    reason: 'no-active-snapshot-resolvable',
  };
}

/**
 * installed_plugins.json 候选集判定（§3.6）：
 * 候选含 error → 整体 source-error（即使另有 ok 候选）；
 * 先按 scope 优先级（project 优先）过滤，再仅保留 valid ok，再 canonicalPath 去重；
 * 去重后 0 条 → null（继续 fallback）；1 条 → 采用；≥2 条 → ambiguous。
 * @returns {object|null}
 */
function resolveFromCandidates(candidates) {
  // 候选含 error → 该来源整体不可信（"剩余几条"这个问题本身已判不了）
  const errored = candidates.find((c) => c.valid.kind === 'error');
  if (errored) {
    return {
      snapshotPath: null,
      resolutionSource: 'indeterminate',
      reason: 'source-error',
      detail: { source: 'installed-plugins-metadata', errorCode: errored.valid.errorCode },
    };
  }

  // 仅保留 valid ok
  let valid = candidates.filter((c) => c.valid.kind === 'ok');

  // scope 优先级：存在 project scope 时只保留 project
  if (valid.some((c) => c.scope === 'project')) {
    valid = valid.filter((c) => c.scope === 'project');
  }

  // canonicalPath 去重（symlink 指向同一 real path 不算歧义）
  const uniqueByCanonical = new Map();
  for (const c of valid) {
    if (!uniqueByCanonical.has(c.canonicalPath)) {
      uniqueByCanonical.set(c.canonicalPath, c);
    }
  }
  const unique = [...uniqueByCanonical.values()];

  if (unique.length === 0) return null;
  if (unique.length === 1) {
    return { snapshotPath: unique[0].canonicalPath, resolutionSource: 'installed-plugins-metadata' };
  }
  return {
    snapshotPath: null,
    resolutionSource: 'indeterminate',
    reason: 'installed-plugins-metadata-ambiguous',
  };
}

/**
 * 单文件两侧摘要比对（data-model.md §5 九组合判定表）。
 * 输入两侧 DigestResult，输出 Omit<FileComparisonEntry, 'file'>（调用方补 file 字段）。
 */
export function compareFile(repoDigest, snapshotDigest) {
  const repoErr = repoDigest.status === 'error';
  const snapErr = snapshotDigest.status === 'error';

  // error 优先：任一侧读取失败即无法判断，转 indeterminate
  if (repoErr && snapErr) {
    return { status: 'indeterminate', side: 'both', errorCode: repoDigest.errorCode };
  }
  if (repoErr) {
    return { status: 'indeterminate', side: 'repo', errorCode: repoDigest.errorCode };
  }
  if (snapErr) {
    return { status: 'indeterminate', side: 'snapshot', errorCode: snapshotDigest.errorCode };
  }

  const repoMissing = repoDigest.status === 'missing';
  const snapMissing = snapshotDigest.status === 'missing';

  if (repoMissing && snapMissing) return { status: 'missingBoth' };
  if (repoMissing) return { status: 'missingInRepo' };
  if (snapMissing) return { status: 'missingInSnapshot' };

  // 两侧均 ok → 字节级 sha256 比对
  return repoDigest.sha256 === snapshotDigest.sha256
    ? { status: 'match' }
    : { status: 'mismatch' };
}

/**
 * 汇总整体状态（三分支）：
 * 任一 indeterminate → 'indeterminate'；否则任一非 match → 'drift'；否则 'in-sync'。
 */
export function aggregateStatus(files) {
  if (files.some((f) => f.status === 'indeterminate')) return 'indeterminate';
  if (files.some((f) => f.status !== 'match')) return 'drift';
  return 'in-sync';
}
