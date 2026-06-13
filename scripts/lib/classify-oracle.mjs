/**
 * Feature 187 — swebench-execution oracle 三分类决策（spec「Oracle 结果统一合同」14 行决策表）。
 *
 * 纯函数，无 I/O、无 docker 依赖 → 默认跑单测全覆盖。本模块源码摘要纳入 oracleSpecHash
 * （Codex C-2：判分语义冻结），因此**任何分类逻辑改动都会触发预注册校验失败**。
 *
 * 核心不变量（用户裁决 Q1 = 分阶段判定）：
 *   - test_exec 阶段「之前」的失败 = infra/fixture → error（剔除 fail 分母）
 *   - test_exec 阶段「之中」的 timeout/OOM/crash = candidate → fail（计入分母）
 *   - exit 139 / SIGSEGV = arm64 仿真伪影 → error/infra（例外，优先级高于 Q1）
 *   - 未匹配的未知组合 fallback：phaseReached>=test_exec → fail，否则 error；绝不静默吞
 */

/** @typedef {'pass'|'fail'|'error'} OracleClass */
/** @typedef {'none'|'infra'|'candidate'|'fixture'} FailureSource */

const PRE_TEST_PHASES = new Set(['image', 'container_start', 'patch_apply', 'unknown']);
const KILL_SIGNALS = new Set(['SIGKILL', 'SIGTERM']);

/** test_exec 阶段（含其后）：候选代码已经在跑测试，失败默认归咎候选。 */
function reachedTestExec(phaseReached) {
  return phaseReached === 'test_exec' || phaseReached === 'report_parse' || phaseReached === 'done';
}

/** harness 已进入评分阶段（report_parse/done）：此时 report 缺失是真实 infra 异常，而非候选把测试跑挂。 */
function reachedGrading(phaseReached) {
  return phaseReached === 'report_parse' || phaseReached === 'done';
}

/**
 * 把一次 swebench harness 执行的原始信号判定为三分类 + 失败归因。
 *
 * @param {object} input
 * @param {number|null} [input.harnessExitCode] run_evaluation 进程退出码
 * @param {string|null}  [input.signal]         进程终止信号（SIGSEGV/SIGKILL/SIGTERM）
 * @param {boolean}      [input.timedOut]        外层 TS watchdog 是否触发
 * @param {string}       [input.phaseReached]    image|container_start|patch_apply|test_exec|report_parse|done|unknown
 * @param {string}       [input.logText]         捕获的 stdout+stderr+run_instance.log
 * @param {object|null}  [input.report]          per-instance 判定 {completed?, resolved?}
 * @param {number|null}  [input.pytestExitCode]  容器内 pytest 退出码（runner 从 log 反解）
 * @returns {{classification: OracleClass, failureSource: FailureSource, reason: string}}
 */
export function classifySwebenchResult(input = {}) {
  const {
    harnessExitCode = null,
    signal = null,
    timedOut = false,
    phaseReached = 'unknown',
    logText = '',
    report = null,
    pytestExitCode = null,
  } = input;

  const log = String(logText || '');
  const isOOM = harnessExitCode === 137 || /OOMKilled|\bKilled\b/.test(log);
  const killed = signal != null && KILL_SIGNALS.has(signal);

  // 行 1：docker daemon 不可用
  if (harnessExitCode === 125) return verdict('error', 'infra', 'exitCode=125 docker daemon 不可用');
  // 行 2：命令/可执行未找到
  if (harnessExitCode === 126 || harnessExitCode === 127) return verdict('error', 'infra', `exitCode=${harnessExitCode} 命令未找到`);
  // 行 3：镜像层失败
  if (/BuildImageError|ImagePullError/.test(log)) return verdict('error', 'infra', 'log 含镜像层失败标志');
  // 行 4：segfault（arm64/QEMU 伪影）—— 即使在 test_exec 也判 infra（高于 Q1 行 8）
  if (harnessExitCode === 139 || signal === 'SIGSEGV') return verdict('error', 'infra', 'exit139/SIGSEGV segfault（arm64 仿真伪影）');
  // 行 5：候选/test patch 无法应用（test_exec 之前）= 数据/输入层问题
  if (!reachedTestExec(phaseReached) && /patch (?:does not apply|failed)|error: patch failed|git apply.*fail/i.test(log)) {
    return verdict('error', 'fixture', 'patch apply 失败（test_exec 前）');
  }
  // 行 6：pytest 未收集到测试
  if (pytestExitCode === 5) return verdict('error', 'fixture', 'pytest exit 5 未收集到测试（node id/testPatch 错配）');
  // 行 7：测试开跑前 timeout/被杀 → infra
  if ((timedOut || killed) && PRE_TEST_PHASES.has(phaseReached)) {
    return verdict('error', 'infra', `测试开跑前中止（phase=${phaseReached}, timedOut=${timedOut}, signal=${signal}）`);
  }
  // 行 8：测试开跑后 timeout/OOM/被杀 → candidate fail（Q1 核心）
  if ((timedOut || killed || isOOM) && reachedTestExec(phaseReached)) {
    return verdict('fail', 'candidate', `测试执行中中止/OOM（候选 patch 责任，phase=${phaseReached}）`);
  }
  // 行 9/10/11：harness 正常退出，看 report
  if (harnessExitCode === 0 && report) {
    if (report.completed === true && report.resolved === true) return verdict('pass', 'none', 'harness completed + resolved');
    if (report.completed === true && report.resolved === false) return verdict('fail', 'candidate', 'harness completed 但 resolved=false（测试真实失败/passToPass 回归）');
    if (report.completed === false) return verdict('error', 'infra', 'harness completed=false（未正常完成）');
  }
  // 行 12：pytest 自身异常（中断/内部错/用法错）
  if (pytestExitCode === 2 || pytestExitCode === 3 || pytestExitCode === 4) {
    return verdict('error', 'infra', `pytest exit ${pytestExitCode}（pytest 自身异常，非候选 PASS/FAIL 信号）`);
  }
  // 行 13：harness 已进入评分阶段（done/report_parse）但 report 缺失 = 真实 infra 异常
  // （区别于"候选把测试跑挂、harness 未及评分"——那种落到行 14 归咎候选）
  if (report == null && reachedGrading(phaseReached)) return verdict('error', 'infra', 'report 缺失但已进入评分阶段（infra 异常）');
  // 行 14：fallback —— 必须 log 原始信号，绝不静默
  const raw = `exitCode=${harnessExitCode} signal=${signal} timedOut=${timedOut} phase=${phaseReached} pytestExit=${pytestExitCode}`;
  if (reachedTestExec(phaseReached)) return verdict('fail', 'candidate', `fallback: 未知组合但已到 test_exec → 归咎候选 [${raw}]`);
  return verdict('error', 'infra', `fallback: 未知组合且未到 test_exec → 归 infra [${raw}]`);
}

function verdict(classification, failureSource, reason) {
  return { classification, failureSource, reason };
}

/**
 * 排名口径（Codex C-1）：把三分类映射为完成率统计用的 tri-state。
 *   pass → true（计入分子+分母）；fail → false（计入分母）；error → null（剔除分母，不污染排名）。
 *   兼容 legacy 'unavailable'（旧 classifyOracle 值）→ null。缺失/未知 → null（保守剔除）。
 *
 * @param {{classification?: string}|null} primaryOracle
 * @returns {boolean|null}
 */
export function classifyRunForRanking(primaryOracle) {
  const c = primaryOracle?.classification;
  if (c === 'pass') return true;
  if (c === 'fail') return false;
  // 'error' / legacy 'unavailable' / 缺失 / 未知 → 剔除分母
  return null;
}
