/**
 * goal-loop-core.mjs
 * Feature 201 — goal_loop agent_mode 确定性 core
 *
 * 设计原则（plan §1.1）：本模块的 12 个函数均为**纯函数**（无 I/O，输入→输出），
 * 不读文件、不调 git、不调 MCP、不写日志。git/MCP 调用由编排器在 SKILL.md 散文中发起，
 * core 只负责**规划命令序列**和**解释结果**。单实例文件锁的 I/O 边界助手放在
 * goal-loop-cli.mjs，不在本纯 core 模块。
 *
 * TDD：本文件在 T011 阶段以空桩形式存在（每个函数 throw NotImplemented），
 * 配套测试 goal-loop-core.test.mjs 写真实断言，全部因桩抛错而干净红；
 * 随后 T012~T017 逐函数替换为实现转绿。
 *
 * 运行测试: node --test plugins/spec-driver/tests/goal-loop-core.test.mjs
 */

/**
 * goal_loop 循环配置路径——跨快照保留，不得被 stash/clean 触碰（F203 缺陷 1）
 *
 * goal_loop 验证态会临时写 .specify/orchestration-overrides.yaml（刻意不入 commit），
 * 早期 planSnapshotCommands 的 `git stash push -u` 与 planRollbackCommands 的 `git clean -fd`
 * 会把它当普通工作树变更卷走/删除，导致循环中途配置自毁。该常量驱动命令生成的 pathspec 排除。
 */
export const PRESERVED_CONFIG_PATHSPECS = [
  '.specify/orchestration-overrides.yaml',
];

/**
 * 分类单条命令结果（FR-009）
 * @param {{ exit_code?: number|null, skipped_reason?: string|null }} cmdResult
 * @returns {'PASS'|'FAIL'|'SKIPPED'|'UNKNOWN'}
 */
export function classifyCommand(cmdResult) {
  // skipped_reason 非 null 优先判 SKIPPED（即使填了 exit_code）
  if (cmdResult && cmdResult.skipped_reason != null) {
    return 'SKIPPED';
  }
  const code = cmdResult ? cmdResult.exit_code : undefined;
  // exit_code 缺失或非数字 → UNKNOWN（无法证明真实退出码，职责分离防 reward-hacking）
  if (typeof code !== 'number' || Number.isNaN(code)) {
    return 'UNKNOWN';
  }
  // 0 = PASS；非零（含超时如 124）= FAIL
  return code === 0 ? 'PASS' : 'FAIL';
}

/**
 * 判定本轮 report 是否达标（FR-008）
 * @param {Object} report
 * @returns {boolean}
 */
export function evaluateMetric(report) {
  if (!report || !Array.isArray(report.layer2_commands)) {
    return false;
  }
  // 防 vacuous-truth（Codex C3）：空命令集下 every(...) 返回 true，会让"零命令 + 覆盖 100 +
  // COMPLIANT"被误判达标。空 layer2_commands 表示没有任何可执行验证证据，必须不达标。
  if (report.layer2_commands.length === 0) {
    return false;
  }
  // 条件 1：所有 layer2 命令均 PASS（任何 FAIL/SKIPPED/UNKNOWN 即不达标）
  const allPass = report.layer2_commands.every((cmd) => classifyCommand(cmd) === 'PASS');
  if (!allPass) return false;
  // 条件 2：P1 FR 覆盖率 100%
  const cov = report.layer1_fr_coverage;
  if (!cov || cov.p1_coverage_pct !== 100) return false;
  // 条件 3：Layer 1.5 证据 COMPLIANT
  const evidence = report.layer1_5_evidence;
  if (!evidence || evidence.status !== 'COMPLIANT') return false;
  return true;
}

/**
 * 校验 full 报告的 PASS 命令是否覆盖全部必需 kind 类别（F204）
 *
 * 纯函数：无 I/O、无副作用、幂等。对 verify_mode:full 报告取其 PASS 命令的 kind 集合，
 * 校验是否 ⊇ requiredKinds。requiredKinds 为空 → complete:true（优雅降级到现状）。
 *
 * **保护边界（诚实说明）**：kind 由 verify 子代理自报（与 exit_code 同源、同层级）。能挡遗漏/
 * 截断（漏跑 lint、输出被截断少命令），不能挡对抗性自我误标（把 echo ok 标 kind:'test'）。
 * 后者残留与 dist_not_built 校验同层级，由人工 GATE_VERIFY + Codex 对抗审查兜底。
 *
 * **类型守卫（Codex C-3）**：requiredKinds/cmd.kind 可能畸形（payload 由编排器构造、report 由
 * 可错 LLM 产出）。非数组 requiredKinds → 视同 []；非字符串元素/非字符串 cmd.kind → 过滤、不贡献，
 * 绝不 .toLowerCase() 崩——decideStop 须 total/stable，崩溃会破坏"稳定转 GATE"的承诺。
 *
 * @param {Object} report - parseReport 解析后的有效 report 对象（非降级态、verify_mode='full'）
 * @param {string[]} requiredKinds - 期望必须出现的 kind 枚举数组，来自 config.full_required_kinds
 * @returns {{ complete: boolean, missing: string[] }}
 */
export function validateFullCommandKinds(report, requiredKinds) {
  // kind 归一化（Codex Phase3 W-3）：trim + 小写——容忍 LLM 产出的 ' build ' 等前后空白，
  // 否则 ' build '.toLowerCase() !== 'build' 会把合法命令误判缺失 → false INCOMPLETE_FULL_VERIFY。
  const normKind = (k) => k.trim().toLowerCase();
  // requiredKinds 类型守卫（C-3）：非数组→[]；仅取字符串元素，归一化、去重
  const required = new Set(
    (Array.isArray(requiredKinds) ? requiredKinds : [])
      .filter((k) => typeof k === 'string')
      .map(normKind),
  );
  // 空期望集 → 直接通过（优雅降级，AC-4），不读任何 report 字段
  if (required.size === 0) return { complete: true, missing: [] };

  // PASS 命令的 kind 集合：仅取 status===PASS 且 kind 为字符串的命令
  //   - FAIL/SKIPPED/UNKNOWN 不计入（防 reward-hacking：FAIL 命令不能"代缴"完整性）
  //   - 非字符串 kind（123/null/对象）不贡献、绝不 .toLowerCase() 崩（C-3）
  const passKinds = new Set(
    (report && Array.isArray(report.layer2_commands) ? report.layer2_commands : [])
      .filter((cmd) => classifyCommand(cmd) === 'PASS' && typeof cmd.kind === 'string')
      .map((cmd) => normKind(cmd.kind)),
  );

  const missing = [...required].filter((k) => !passKinds.has(k));
  return { complete: missing.length === 0, missing };
}

/**
 * 判定 smoke 报告是否满足 escalate_full 条件（非权威触发，F203 缺陷 2）
 *
 * 与权威门禁 evaluateMetric 的区别：smoke 轮跑全量 vitest 但不先 build，含 build 依赖的 e2e
 * 会被源头标 SKIPPED。evaluateMetric 严格要求全量 PASS（SKIPPED 即不达标），smoke 永不达标。
 * evaluateSmokeReadiness 放宽——允许 SKIPPED，只要非 SKIPPED 命令全 PASS 且至少有一条非 SKIPPED
 * 命令（vacuous-truth 防护）。满足即触发 escalate_full（升级 full verify 重判，绝非直接 REACHED_GOAL）。
 * @param {Object} report
 * @returns {boolean}
 */
export function evaluateSmokeReadiness(report) {
  if (!report || !Array.isArray(report.layer2_commands)) {
    return false;
  }
  // 条件 1：P1 FR 覆盖率 100%
  const cov = report.layer1_fr_coverage;
  if (!cov || cov.p1_coverage_pct !== 100) return false;
  // 条件 2：Layer 1.5 证据 COMPLIANT
  const evidence = report.layer1_5_evidence;
  if (!evidence || evidence.status !== 'COMPLIANT') return false;
  // 条件 3 + vacuous 防护：取非 SKIPPED 命令，要求 ≥1 条且全 PASS
  //   UNKNOWN（非 SKIPPED 且非 PASS）即不满足；FAIL 即不满足。
  const nonSkipped = report.layer2_commands.filter((cmd) => classifyCommand(cmd) !== 'SKIPPED');
  if (nonSkipped.length === 0) return false; // 全 SKIPPED → vacuous，不放行（C3）
  return nonSkipped.every((cmd) => classifyCommand(cmd) === 'PASS');
}

/**
 * 从单行 porcelain v1 输出提取受影响路径集合（F203 修订 #1，DRY helper）
 *
 * porcelain v1 固定列：前两字符 XY（X=index 列，Y=工作区列）+ 空格 + 路径。
 * 由 parsePreservedConfigStates 与 isCleanExcludingPreserved 共用，统一行→路径解析。
 *   - `??`（untracked）→ unquote(rest)
 *   - rename/copy（X='R'/'C'）→ 两端路径（from + to）
 *   - 其余 → unquote(rest)（单路径）
 * 空行返回空数组。
 * @param {string} line - 单行 porcelain 文本（不含换行符）
 * @returns {string[]}
 */
function extractPorcelainPaths(line) {
  if (!line || line.length === 0) return [];
  const xy = line.slice(0, 2);
  const rest = line.slice(3);
  const x = xy[0];
  if (xy === '??') {
    return [unquotePorcelainPath(rest)];
  }
  if (x === 'R' || x === 'C') {
    const { from, to } = splitRenameArrow(rest);
    return [unquotePorcelainPath(from), unquotePorcelainPath(to)];
  }
  return [unquotePorcelainPath(rest)];
}

/**
 * 判定"排除 preserved 路径后"工作区是否干净（F203 修订 #1 / CRITICAL-7）
 *
 * 危险场景：工作区唯一 dirty 是 untracked preserved override 时，若按全仓 porcelain 判
 * isClean=false，则 planSnapshotCommands(false) 的 stash push 排除了 override → "没有要保存的
 * 本地修改"（无新 stash）→ 随后 `git rev-parse stash@{0}` 抓到**仓库里已有的无关旧 stash** →
 * `stash apply --index` 套用无关改动污染工作区。修复：isClean 必须排除 preserved 后再判。
 *
 * 语义：解析**全仓** porcelain 文本，逐行提取路径——若存在任一行其路径**不全属于** preservedPaths
 * （rename 两端只要有一端非 preserved 即算非 preserved 变更）→ 返回 false；所有 dirty 行都是
 * preserved（或无 dirty 行）→ true。
 *
 * 输入契约：porcelainText MUST 来自 `git status --porcelain --untracked-files=all`。默认 porcelain
 * （无 -uall）会把整个 untracked 目录折叠成单行 `?? .specify/`（而非展开到 `?? .specify/orchestration-overrides.yaml`）；
 * 折叠形式下 `.specify/` ≠ preserved 文件路径 → 被判为非 preserved 变更 → 误判 false（CRITICAL-7 漏网根因）。
 * 本函数对折叠输入保守判脏（返回 false）——这是正确的防御性行为，但前提是调用方喂入 -uall 展开形式才能拿到 true。
 * @param {string} porcelainText - 全仓 `git status --porcelain --untracked-files=all` 原始 stdout
 * @param {string[]} preservedPaths - 视为可忽略的保留路径（默认 PRESERVED_CONFIG_PATHSPECS）
 * @returns {boolean}
 */
export function isCleanExcludingPreserved(porcelainText, preservedPaths = PRESERVED_CONFIG_PATHSPECS) {
  const text = typeof porcelainText === 'string' ? porcelainText : '';
  const preserved = new Set(preservedPaths || []);
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) continue;
    const paths = extractPorcelainPaths(rawLine);
    if (paths.length === 0) continue;
    // 该行只要有任一路径不属于 preserved → 存在非 preserved 变更 → 不干净
    if (paths.some((p) => !preserved.has(p))) {
      return false;
    }
  }
  return true;
}

/**
 * 解析 `git status --porcelain -- <paths>` 文本为 preserved config 状态数组（F203 精化 #2）
 *
 * porcelain v1 固定列：前两字符 XY（X=index 列，Y=工作区列）+ 空格 + 路径。
 * 把脆弱的文本解析放进可单测 core，SKILL.md 散文只负责跑命令并把原文管道给 CLI，不自行解析。
 * @param {string} porcelainText - git status --porcelain 原始 stdout
 * @param {string[]} preservedPaths - 需检查的路径（如 PRESERVED_CONFIG_PATHSPECS）
 * @returns {{ path: string, state: 'absent'|'untracked'|'tracked-clean'|'tracked-modified'|'staged' }[]}
 */
export function parsePreservedConfigStates(porcelainText, preservedPaths) {
  const text = typeof porcelainText === 'string' ? porcelainText : '';
  // path → 最强状态（staged > tracked-modified > untracked），同一路径多行时取最不安全的
  const byPath = new Map();
  const rank = { untracked: 1, 'tracked-modified': 2, staged: 3 };
  const assign = (p, state) => {
    if (!p) return;
    const prev = byPath.get(p);
    if (!prev || rank[state] > rank[prev]) byPath.set(p, state);
  };

  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) continue;
    // porcelain v1：第 0-1 字符为 XY 状态码，第 2 字符为空格，其后为路径。
    // 路径提取复用 extractPorcelainPaths（DRY，与 isCleanExcludingPreserved 同源）；
    // 本函数额外按 XY 列推断 state（untracked / staged / tracked-modified）。
    const xy = rawLine.slice(0, 2);
    const x = xy[0];
    const y = xy[1];
    const paths = extractPorcelainPaths(rawLine);

    if (xy === '??') {
      assign(paths[0], 'untracked');
      continue;
    }
    // rename/copy 行：`R  old -> new`（X='R'/'C'）—— 两端路径命中任一即归类 staged
    if (x === 'R' || x === 'C') {
      for (const p of paths) assign(p, 'staged');
      continue;
    }
    const p = paths[0];
    // index 列（X）非空非空格 → staged（含 M /A /MM/AM 等，index 有暂存即 staged 优先）
    if (x && x !== ' ' && x !== '?') {
      assign(p, 'staged');
      continue;
    }
    // 仅工作区列（Y）非空、index 列为空格 → tracked-modified（如 " M"/" D"）
    if (y && y !== ' ') {
      assign(p, 'tracked-modified');
    }
  }

  // 对每个 preserved path：命中则用解析出的 state，未命中则 absent（含 tracked-clean，统一按安全归类）
  return (preservedPaths || []).map((path) => ({
    path,
    state: byPath.get(path) ?? 'absent',
  }));
}

/**
 * 拆分 porcelain rename/copy 行的 `old -> new` 两端（F203 修订 #3）
 * @param {string} rest - 状态码之后的内容
 * @returns {{ from: string, to: string }}
 */
function splitRenameArrow(rest) {
  const idx = rest.indexOf(' -> ');
  if (idx === -1) {
    return { from: rest, to: rest };
  }
  return { from: rest.slice(0, idx), to: rest.slice(idx + 4) };
}

/**
 * 去除 porcelain 对含特殊字符路径加的双引号 + C-style 转义（F203 修订 #3）
 *
 * porcelain 对含空格/特殊字符的路径用双引号包裹并做 C-style 转义。我们的 preserved path 是简单
 * ASCII 不会被引号化，但 parser 须健壮处理引号包裹形式，避免误判 absent。
 * @param {string} raw
 * @returns {string}
 */
function unquotePorcelainPath(raw) {
  const s = (raw || '').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    // 反转义常见 C-style 序列（\" \\ \t \n 等）；八进制 \nnn 转回字节
    return inner
      .replace(/\\([\\"abfnrtv])/g, (_, c) => {
        const map = { '\\': '\\', '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
        return map[c] ?? c;
      })
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }
  return s;
}

/**
 * 检查 preserved config 路径是否处于安全状态（preflight 守护，F203 缺陷 1）
 *
 * pathspec 排除只保护 untracked 的 preserved config；staged/tracked-modified 态会被
 * `git reset --hard` 摧毁，pathspec 拦不住，故由本 preflight 提前拦截（硬失败优于静默数据丢失）。
 * @param {{ path: string, state: 'absent'|'untracked'|'tracked-clean'|'tracked-modified'|'staged' }[]} entries
 *   由编排器调 `git status --porcelain -- <paths>` 经 parsePreservedConfigStates 解析后传入
 * @returns {{ safe: boolean, unsafe: { path: string, state: string, reason: string }[] }}
 */
export function assessPreservedConfigSafety(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const UNSAFE_STATES = new Set(['staged', 'tracked-modified']);
  const unsafe = [];
  for (const entry of list) {
    if (entry && UNSAFE_STATES.has(entry.state)) {
      unsafe.push({
        path: entry.path,
        state: entry.state,
        reason: `preserved config 处于 ${entry.state} 态，会被 git reset --hard HEAD 摧毁；goal_loop 期望其 untracked，中止防数据丢失`,
      });
    }
  }
  return { safe: unsafe.length === 0, unsafe };
}

/**
 * 检测回归——只比较 verify_mode 相同的命令（FR-013）
 * @param {Object|null} prevReport
 * @param {Object} curReport
 * @returns {{ regression: boolean, commands: string[] }}
 */
export function detectRegression(prevReport, curReport) {
  // 第一轮无前轮 → 无回归
  if (prevReport === null || prevReport === undefined) {
    return { regression: false, commands: [] };
  }
  // 核心约束：只比较 verify_mode 相同的命令（smoke↔smoke / full↔full）
  // 跨模式（如上轮 smoke、本轮 full）绝不比较，避免把"smoke 未跑 lint"误判成 regression
  if (prevReport.verify_mode !== curReport.verify_mode) {
    return { regression: false, commands: [] };
  }

  // 上轮 PASS 的命令名集合
  const prevPass = new Set(
    (prevReport.layer2_commands || [])
      .filter((c) => classifyCommand(c) === 'PASS')
      .map((c) => c.name),
  );
  // 本轮 FAIL 但上轮 PASS 的命令 = regression
  const regressed = (curReport.layer2_commands || [])
    .filter((c) => classifyCommand(c) === 'FAIL' && prevPass.has(c.name))
    .map((c) => c.name);

  return { regression: regressed.length > 0, commands: regressed };
}

/**
 * 计算五维 delta 向量 + hasProgress（FR-006）
 * @param {Object|null} prevReport
 * @param {Object} curReport
 * @returns {{ delta: number[], hasProgress: boolean }}
 */
export function computeDelta(prevReport, curReport) {
  const cur = curReport.delta_inputs || {};
  // prevReport=null（第一轮）→ 以零基线比较（前值视为 0），net_loc 取本轮绝对净变更
  const prev = (prevReport && prevReport.delta_inputs) || {};
  const prevVal = (k) => (prevReport ? prev[k] ?? 0 : 0);

  // d1 layer2_pass_count、d2 p1_fr_coverage_pct、d3 layer1_5_status_score、d4 regression_count(负=改善)
  const d1 = (cur.layer2_pass_count ?? 0) - prevVal('layer2_pass_count');
  const d2 = (cur.p1_fr_coverage_pct ?? 0) - prevVal('p1_fr_coverage_pct');
  const d3 = (cur.layer1_5_status_score ?? 0) - prevVal('layer1_5_status_score');
  const d4 = (cur.regression_count ?? 0) - prevVal('regression_count');
  // d5 = 本轮净 LOC 变更（绝对值，非差分）：仅作日志/可观测信号，**不计入 hasProgress**。
  // 关键修正（Codex C1）：若把 net_loc churn 计入 hasProgress，则每轮改代码 → d5≠0 → hasProgress
  // 恒 true → NO_PROGRESS 早停 fallback 永不触发（死逻辑）。真实"无进展"应只看 metric 改善方向。
  const d5 = cur.net_loc_delta ?? 0;

  const delta = [d1, d2, d3, d4, d5];
  // hasProgress：只看四个 metric 维度的"改善方向"——
  //   d1 PASS 数增（>0）、d2 P1 覆盖增（>0）、d3 证据分增（>0）、d4 回归数减（<0）。
  // 任一维朝好的方向变化即视为有进展；d5（LOC churn）不参与判定。
  const hasProgress = d1 > 0 || d2 > 0 || d3 > 0 || d4 < 0;
  return { delta, hasProgress };
}

/**
 * 每轮 verify 后按固定优先级判定停止/处置（FR-004）
 * @param {{ report: Object, round: number, config: Object, prevReports: Object[], rollbackResult: ({ success: boolean }|null) }} params
 * @returns {{ stop: boolean, exit_reason: string|null, action: string }}
 */
export function decideStop({ report, round, config, prevReports, rollbackResult }) {
  const history = Array.isArray(prevReports) ? prevReports : [];
  const maxIterations = config.max_iterations;
  const noProgressMax = config.no_progress_max_rounds ?? 2;

  // 优先级 1：回滚失败（最高优先，FR-014）
  if (rollbackResult !== null && rollbackResult !== undefined && !rollbackResult.success) {
    return { stop: true, exit_reason: 'ROLLBACK_FAILED', action: 'goto_gate_verify' };
  }

  // 本轮是否为 infra-failure（report 降级标记），degraded 报告不参与 regression/达标判定
  const isDegraded = report && report.degraded === 'infra-failure';

  // 优先级 2：regression（内部自调 detectRegression，不信任外部传入/report 自带字段；FR-013）
  // 修正（Codex W1）：回归必须与"上一个 verify_mode 相同的轮次"比较，而非固定取最后一轮。
  // full→smoke→full 的 FAIL 序列里，若拿当前 full 与中间那轮 smoke 比，会因跨模式分桶被漏判。
  if (!isDegraded) {
    const prevSameMode = findPrevSameModeReport(history, report);
    const reg = detectRegression(prevSameMode, report);
    if (reg.regression) {
      // 预算耗尽（已到末轮）则 stop，否则视剩余预算 continue 回滚后重试
      const budgetExhausted = round >= maxIterations;
      return {
        stop: budgetExhausted,
        exit_reason: 'REGRESSION_ROLLBACK',
        action: 'rollback',
      };
    }
  }

  // 优先级 3：达标（无论是否末轮，达标优先于 max_iterations；FR-004 同轮冲突规则）
  // 修正（Codex C2 / plan §OQ-03）：达标退出前必须经过一次 full verify。
  //   - full 轮 metric 满足 → REACHED_GOAL（真正退出）
  //   - smoke 轮 metric 满足 → 不得 REACHED_GOAL；返回 escalate_full 信号，
  //     由编排器升级到 full verify 重判（tasks T022 步骤 6c）。堵死"smoke 假达标"。
  //
  // **escalate 非递归不变量（Codex C1，最高风险）**：escalate_full 只在
  // `verify_mode !== 'full'` 时返回。因此一旦 forced full verify 产出 verify_mode==='full'
  // 的报告且 metric 满足，本函数**必然**走 REACHED_GOAL 分支，**永不**再次返回 escalate_full
  // —— 从纯函数层面就不存在"full 报告 → escalate_full"的路径，无法递归升级。
  // 散文层（SKILL.md 步骤 6c）另有两道兜底：
  //   (1) forced full 后先校验 curReportFull.verify_mode === 'full'，否则按 infra-failure 转 GATE_VERIFY；
  //   (2) 重 decide 后若仍意外得到 escalate_full（契约违反），MUST NOT 再升级，直接转 GATE_VERIFY。
  //
  // **干净结构（F203 精化 #1）**：full→只调 evaluateMetric；smoke→只调 evaluateSmokeReadiness。
  //   full 权威门禁严格（全量 PASS + p1=100 + COMPLIANT，SKIPPED 即不达标，evaluateMetric 不放宽）；
  //   smoke 用 evaluateSmokeReadiness（允许 SKIPPED，非 SKIPPED 全 PASS 且 ≥1 非 SKIPPED）触发 escalate。
  if (!isDegraded) {
    if (report.verify_mode === 'full') {
      if (evaluateMetric(report)) {
        // F204：metric 满足后、REACHED_GOAL 之前校验命令集完整性（W-1：之后不是之前）。
        // requiredKinds 从 config 读（命令名/类别由项目配置，core 零硬编码命令名）；缺省/空 → 跳过。
        const requiredKinds = (config && config.full_required_kinds) || [];
        const kindCheck = validateFullCommandKinds(report, requiredKinds);
        if (!kindCheck.complete) {
          // 命令集缺必需 kind → 拒绝认证，交人工 GATE_VERIFY（fail-loud）。
          // 语义差异：REACHED_GOAL 是机器确认达标；INCOMPLETE_FULL_VERIFY 是"metric 满足但命令集
          // 缺必需类别"，由人工决定是否接受。不复用 infra-failure（那会计入 NO_PROGRESS 迭代）。
          return { stop: true, exit_reason: 'INCOMPLETE_FULL_VERIFY', action: 'goto_gate_verify' };
        }
        return { stop: true, exit_reason: 'REACHED_GOAL', action: 'goto_gate_verify' };
      }
      // full 未达标 → 落入后续优先级（绝不 escalate，C1 不变量从结构层面保证）
    } else if (report.verify_mode === 'smoke') {
      // smoke 分支（C1 不变量：escalate_full 仅此路径可能返回）。
      // 防御纵深（F203 修订 #2 / WARNING-1）：收紧为显式 'smoke' —— 非 full 非 smoke 的报告
      // 已被 parseReport 降级为 infra-failure，但此处再设一道防线，绝不让非法 verify_mode escalate。
      if (evaluateSmokeReadiness(report)) {
        return { stop: false, exit_reason: null, action: 'escalate_full' };
      }
      // smoke 未满足 → 落入后续优先级
    }
  }

  // 优先级 4：达到最大迭代轮数
  if (round >= maxIterations) {
    return { stop: true, exit_reason: 'MAX_ITERATIONS', action: 'goto_gate_verify' };
  }

  // 优先级 5：infra-failure 或连续 no_progress_max_rounds 轮无进展 → NO_PROGRESS
  if (countConsecutiveNoProgress(report, history) >= noProgressMax) {
    return { stop: true, exit_reason: 'NO_PROGRESS', action: 'goto_gate_verify' };
  }

  // 优先级 6：继续
  return { stop: false, exit_reason: null, action: 'continue' };
}

/**
 * 在历史 report 中从后向前找 verify_mode 与本轮相同的最近一条（Codex W1）
 *
 * regression 只在同模式分桶比较。decideStop 必须把"上一个同模式轮次"传给 detectRegression，
 * 否则 full→smoke→full FAIL 序列里，当前 full 与中间 smoke 跨桶比较被漏判。
 * degraded 报告（无 verify_mode 的 infra-failure）不参与同模式匹配，直接跳过。
 *
 * @param {Object[]} history - 历史 report（旧→新顺序）
 * @param {Object} curReport
 * @returns {Object|null}
 */
function findPrevSameModeReport(history, curReport) {
  const mode = curReport && curReport.verify_mode;
  if (!mode) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r && r.degraded === 'infra-failure') continue;
    if (r && r.verify_mode === mode) return r;
  }
  return null;
}

/**
 * 计算"含本轮在内、最近连续无进展轮数"
 *
 * 语义（与 no_progress_max_rounds 阈值对齐）：从最新一轮起向前回溯，统计处于
 * "卡住"状态的连续轮次数。一轮卡住的判定：
 *   - 本轮为 infra-failure（report.degraded）→ 卡住
 *   - 本轮相对**上一轮**无进展（computeDelta(prev, cur) 五维全 0）→ 本轮与上一轮均计入卡住
 * 即两轮 delta_inputs 完全相同时，这两轮都视为"无进展"（共 2 轮），以匹配
 * "连续 N 轮无进展即早停"的直觉（N=2 → 两轮指标无变化即触发）。
 *
 * @param {Object} curReport
 * @param {Object[]} history - 历史 report（旧→新顺序）
 * @returns {number}
 */
function countConsecutiveNoProgress(curReport, history) {
  // 时间序列（旧→新）
  const series = [...history, curReport];
  // 单轮是否"卡住"：infra-failure 直接卡住；否则看相对上一轮是否无进展。
  const isStuck = (idx) => {
    const cur = series[idx];
    if (cur && cur.degraded === 'infra-failure') return true;
    const prev = idx > 0 ? series[idx - 1] : null;
    if (prev === null) return false; // 首轮无基准，不单独判卡住
    return !computeDelta(prev, cur).hasProgress;
  };

  // 从最新一轮起回溯统计停滞段长度（以"轮"为单位）。
  // 当某轮相对上一轮无进展时，该轮与其比较基准上一轮共同构成停滞段：
  // 故一段连续相同指标的 K 个 transition 跨 K+1 轮。
  let consecutive = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (isStuck(i)) {
      consecutive += 1;
      // 若上一轮是序列首轮且本轮相对它无进展，把首轮也计入停滞段
      if (i - 1 === 0 && !(series[0] && series[0].degraded === 'infra-failure')) {
        consecutive += 1;
      }
    } else {
      break;
    }
  }
  return consecutive;
}

/**
 * 判定 implement phase 分派策略（FR-017）
 * @param {string} phaseId
 * @param {string} agentMode
 * @returns {{ dispatch: string, warning?: string }}
 */
export function decideDispatch(phaseId, agentMode) {
  if (agentMode === 'goal_loop') {
    if (phaseId === 'implement') {
      return { dispatch: 'goal_loop' };
    }
    // goal_loop 误配在非 implement phase → 降级 single + warning（FR-017）
    return {
      dispatch: 'single',
      warning: `agent_mode=goal_loop 仅在 implement phase 生效，phase="${phaseId}" 降级为 single`,
    };
  }
  // 其他模式透传
  return { dispatch: agentMode };
}

/**
 * 按轮次选择 verify 模式（FR-007）
 * @param {number} round
 * @param {number} maxIterations
 * @param {boolean} aboutToExit
 * @returns {'smoke'|'full'}
 */
export function selectVerifyMode(round, maxIterations, aboutToExit) {
  // 最后一轮 或 达标退出前（aboutToExit）→ full（堵死 smoke 假达标）
  if (aboutToExit || round >= maxIterations) {
    return 'full';
  }
  // 第 1 至 (N-1) 轮 → smoke（tsc --noEmit + vitest，快速反馈）
  return 'smoke';
}

/**
 * 规划建立 snapshot 的 git 命令序列（FR-013）
 * @param {boolean} isClean
 * @param {string[]} preservedPaths - 跨快照保留、不入 stash 的路径（F203 缺陷 1，默认常量；
 *   多 path 展开为多个独立 ':(exclude)<p>' token，禁止 join 成单字符串）
 * @returns {string[]}
 */
export function planSnapshotCommands(isClean, preservedPaths = PRESERVED_CONFIG_PATHSPECS) {
  // 干净工作区：无 stash entry，锚点 = HEAD，无需任何命令
  if (isClean) {
    return [];
  }
  // F203 修订 #3（WARNING-5）：preserved path 会被原样拼进 `'...'` 引号的 shell 命令，
  // 含单引号会破坏引号闭合形成注入面。与 isValidGitSha 防注入风格一致，含单引号即拒绝。
  assertNoSingleQuote(preservedPaths);
  // 非干净：全量捕获 tracked+staged+untracked → 捕获 SHA → 立即原样还原继续本轮
  // {i} / {stash_ref} 为占位符，编排器执行时替换
  // F203：每个 preserved path 展开为独立 ':(exclude)<p>' pathspec token（多 path 不 join），
  // 使 untracked preserved config 不被 stash push -u 卷走。
  const excludeTokens = (preservedPaths || []).map((p) => `':(exclude)${p}'`);
  const stashPush = ['git stash push --include-untracked -m "goal_loop-S{i}" -- .', ...excludeTokens].join(' ');
  return [
    stashPush,
    'git rev-parse stash@{0}',
    'git stash apply --index {stash_ref}',
  ];
}

/**
 * 规划回滚到 S_i 的 git 命令序列（FR-013）
 * @param {{ clean: boolean, ref: string }} S_i
 * @param {string[]} preservedPaths - 跨快照保留、不被 clean 删除的路径（F203 缺陷 1，默认常量；
 *   多 path 展开为多个独立 `-e <p>` token，禁止 join）
 * @returns {string[]}
 */
export function planRollbackCommands(S_i, preservedPaths = PRESERVED_CONFIG_PATHSPECS) {
  // F203 修订 #3（WARNING-5）：preserved path 拼入 `-e '<p>'` 引号，含单引号会破坏引号闭合。
  assertNoSingleQuote(preservedPaths);
  // base：复位 tracked+index 到 HEAD + 删全部 untracked
  // git clean -fd 安全性：不带 -x（保留 .gitignore 文件）、单 -f 非 -ff（拒删嵌套 git 仓库）
  // F203：每个 preserved path 展开为独立 `-e '<p>'` token（多 path 不 join），保护 untracked preserved config。
  const excludeTokens = (preservedPaths || []).map((p) => `-e '${p}'`);
  const cleanCmd = ['git clean -fd', ...excludeTokens].join(' ');
  const base = ['git reset --hard HEAD', cleanCmd];
  if (S_i && S_i.clean) {
    // 干净基线：reset + clean 即回到 S_i
    return base;
  }
  // 非干净：全量还原 S_i（含既有 untracked，stash 已捕获）
  // 安全（Codex W2）：S_i.ref 会被原样拼进 shell 命令字符串，必须先校验为 40 位 hex SHA-1，
  // 否则恶意/损坏的 ref（如 "x; rm -rf /"）会形成命令注入面。非法 ref → 抛错，由编排器标回滚失败。
  if (!isValidGitSha(S_i.ref)) {
    throw new Error(
      `非法 snapshot ref（非 40 位 hex SHA）: ${JSON.stringify(S_i.ref)}，拒绝拼入回滚命令`,
    );
  }
  return [...base, `git stash apply --index ${S_i.ref}`];
}

/**
 * 校验是否为 40 位十六进制 git SHA-1（FR-013 安全防线，Codex W2）
 * @param {unknown} ref
 * @returns {boolean}
 */
function isValidGitSha(ref) {
  return typeof ref === 'string' && /^[0-9a-f]{40}$/.test(ref);
}

/**
 * 校验 preserved path 列表不含单引号（F203 修订 #3 / WARNING-5 防注入）
 *
 * 默认常量安全，但 injectable 第二参可能传入含单引号的路径，会破坏 planSnapshot/planRollback
 * 生成命令里的 `'...'` 引号闭合形成 shell 注入面。含单引号即抛错，拒绝拼入命令。
 * @param {string[]} preservedPaths
 */
function assertNoSingleQuote(preservedPaths) {
  for (const p of preservedPaths || []) {
    if (typeof p === 'string' && p.includes("'")) {
      throw new Error('preserved path 含非法字符（单引号），拒绝拼入 shell 命令');
    }
  }
}

/**
 * 解析 verify 子代理产出的 JSON 文本（FR-010）
 * @param {string} jsonText
 * @returns {{ report: Object }|{ degraded: 'infra-failure', reason: string }}
 */
export function parseReport(jsonText) {
  let report;
  try {
    report = JSON.parse(jsonText);
  } catch (err) {
    return { degraded: 'infra-failure', reason: `JSON 解析失败: ${err.message}` };
  }
  // schema 必填字段校验（缺一即降级，不静默当达标）
  if (!report || typeof report !== 'object') {
    return { degraded: 'infra-failure', reason: 'report 非对象' };
  }
  if (!Array.isArray(report.layer2_commands)) {
    return { degraded: 'infra-failure', reason: 'schema 缺必填字段 layer2_commands' };
  }
  // 空命令集降级（Codex C3）：verify 子代理一条命令都没产出，说明 verify 基础设施未真正执行，
  // 不可当作"全部通过"。降级为 infra-failure，由编排器计入无进展/早停，绝不静默当达标。
  if (report.layer2_commands.length === 0) {
    return {
      degraded: 'infra-failure',
      reason: 'layer2_commands 为空：verify 未产出任何命令结果，无法证明验证已执行',
    };
  }
  if (!report.layer1_fr_coverage || !report.layer1_5_evidence) {
    return {
      degraded: 'infra-failure',
      reason: 'schema 缺必填字段 layer1_fr_coverage / layer1_5_evidence',
    };
  }
  // 任一命令缺 exit_code（且非 SKIPPED）→ 无法证明真实退出码，强制降级（职责分离）
  for (const cmd of report.layer2_commands) {
    const isSkipped = cmd && cmd.skipped_reason != null;
    if (!isSkipped && typeof cmd.exit_code !== 'number') {
      return {
        degraded: 'infra-failure',
        reason: `命令 "${cmd && cmd.name}" 缺 exit_code，无法证明真实退出码`,
      };
    }
  }
  // verify_mode 合法性校验（F203 修订 #2 / WARNING-1）：decideStop 重构后"非 full 一律走 smoke
  // readiness"，verify_mode=undefined/typo 的报告（可能带 SKIPPED）会被误 escalate。在 full 契约
  // 校验之前先拦截非法 verify_mode，降级 infra-failure，绝不进入达标/escalate 判定。
  if (report.verify_mode !== 'smoke' && report.verify_mode !== 'full') {
    return {
      degraded: 'infra-failure',
      reason: 'verify_mode 非法（须 smoke|full）',
    };
  }
  // full 轮契约校验（F203 修订 #2）：full verify 必须先 build，dist 已就位故不应出现
  // dist_not_built SKIPPED。一旦出现即 verify 契约违反——降级 infra-failure，绝不当普通 continue。
  // smoke 轮的 dist_not_built SKIPPED 是预期行为（不 build），正常放行。
  if (report.verify_mode === 'full') {
    const distSkipped = report.layer2_commands.some(
      (cmd) => cmd && cmd.skipped_reason === 'dist_not_built',
    );
    if (distSkipped) {
      return {
        degraded: 'infra-failure',
        reason: 'full verify 不应出现 dist_not_built SKIPPED（full 必须先 build）',
      };
    }
  }
  return { report };
}

/**
 * 解释 Spectra MCP impact 工具返回（FR-011/012）
 * @param {Object} mcpResult
 * @returns {{ injected: true, summary: string }|{ injected: false, skipped: true, warning: string }}
 */
export function interpretImpactResult(mcpResult) {
  // 空结果 → 跳过注入，不中止（FR-012）
  if (mcpResult == null) {
    return {
      injected: false,
      skipped: true,
      warning: 'Spectra impact 不可用：空结果，本轮跳过注入',
    };
  }
  // 错误 / graph-not-built → 跳过注入 + warning（含原因）
  if (mcpResult.error) {
    return {
      injected: false,
      skipped: true,
      warning: `Spectra impact 不可用：${mcpResult.error}，本轮跳过注入`,
    };
  }
  // 有效 impact 数据 → 注入摘要
  const affected = Array.isArray(mcpResult.affected) ? mcpResult.affected : [];
  if (affected.length === 0 && !mcpResult.summary) {
    return {
      injected: false,
      skipped: true,
      warning: 'Spectra impact 不可用：无 affected 数据，本轮跳过注入',
    };
  }
  const riskLevel = mcpResult.summary && mcpResult.summary.riskLevel;
  const summary = `Spectra impact：受影响 symbol ${affected.length} 个${
    riskLevel ? `，风险等级 ${riskLevel}` : ''
  }`;
  return { injected: true, summary };
}

/**
 * 格式化迭代日志条目为含内嵌 ```json 围栏的 markdown 块（FR-019）
 * @param {Object} entry
 * @returns {string}
 */
export function formatIterationLogEntry(entry) {
  // markdown 标题（轮次人可读）+ 内嵌 ```json 围栏（机器可解析）
  const round = entry && entry.round;
  const heading = `### 轮次 ${round}（round ${round}）`;
  const json = JSON.stringify(entry, null, 2);
  return `${heading}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
