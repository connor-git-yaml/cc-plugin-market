#!/usr/bin/env node
/**
 * validate-gate-mounting.mjs
 * FR-053 —— `repo:check` 侧的门挂载与门字段**事后**守护（Feature 277）
 *
 * 与 FR-068 的运行时守卫分工不得混淆：
 *   - FR-068 是**第一道闸**，在每次编排器运行启动时判，挡的是「本次运行」；
 *   - 本守护项是**事后**守护，在提交 / CI 时判，挡的是「仓库状态」。
 *   `.specify/orchestration-overrides.yaml` 是项目本地文件，`repo:check` 不保证在
 *   某次 spec-driver 运行之前跑过——只有本项时，一次删掉挂门 phase 的运行可以从头
 *   跑到尾、事后守护项才红。两条缺一不可。
 *
 * 断言集共 12 条（核对式 6 + 1 + 1 + 1 + 3 = 12，单位：断言条）：
 *   (i)   挂载断言       强制 mode × {GATE_DESIGN, GATE_TASKS}       6
 *   (ii)  feature 下 GATE_DESIGN 的 is_hard_gate === true            1
 *   (iii) GATE_DESIGN.default_behavior ≠ skip                        1
 *   (iv)  GATE_TASKS.default_behavior ∉ {auto, skip}                 1
 *   (v)   每个强制 mode 的 diagnostics 无 error 级条目               3
 *
 * (i) **刻意保持绝对形式**，不改为 FR-068 / FR-052 (丙) 的 base 锚定相对形式
 * （`mounted_in_base === true ⇒ mounted === true`）。两条理由，缺一不可：
 *   1. 相对形式对「base 被直接编辑掉挂载」失明——那时 `mounted_in_base` 同步变假、
 *      蕴含式空洞成立，而这恰恰是 FR-068 明确登记为「第一道闸看不见、交由本条事后守护」的路径；
 *   2. 在本守护项的运行位面上，相对形式**恒真、判不出任何东西**：resolver 已在合并阶段
 *      拒绝强制 mode 的挂载违规并整份回退 base，故本项经 CLI 读到的 effective 对强制
 *      mode 恒等于 base，自锚定的相对判据永远无法为假。一个不可能为假的闸门给的 pass
 *      不是证据（F270 已登记的反模式）。
 *
 * (i) 在 Phase A 对抗修订中由「结构存在性」收紧为「**存在一个 `conditional` 为 null 的挂载锚点**」：
 * 纯存在性会被「把门改挂到 `conditional` 恒假的幽灵 phase 上」整类绕过（α-C1）。
 * 不能连 `skip_if_exists` 一起要求为 null——base 自身的 `story.specify` / `story.plan` /
 * `implement.plan` 三处 GATE_DESIGN / GATE_TASKS 锚点**全部**带 `skip_if_exists`
 * （实测），一并要求会把未改动的仓库判红。`skip_if_exists` 侧的收紧只能是相对 base 的
 * （「不得比 base 更强」），由 resolver 的 `evaluateGateMountingAgainstBase` 承担；
 * 本项对「base 里的锚点被直接加上 `skip_if_exists`」失明，见守卫散文的残余登记。
 *
 * 依赖纪律（FR-037 / FR-038）：零 npm 依赖。事实源一律现取——effective 配置、
 * diagnostics、gate 行为全部经 `orchestrator-cli.mjs` 的真实输出面取得，
 * 不内嵌 phase 序列、mode 定义或 gate 策略。
 *
 * **唯一的例外是「射程」，且这个例外是刻意的**（Phase A 对抗审查 β-C2 / β-W4）：
 * 强制 mode 清单以常量 `GATE_MOUNTING_MANDATORY_MODES` 为**下界**，再并上从
 * `hard_gate_modes` 派生的增量——派生只能扩不能缩。早前版本把整份清单交给被守护的
 * 那份配置去决定（`[...derived].filter(mode => baseModes[mode] !== undefined)`），
 * 于是从配置里删掉 `modes.implement` 整段会让本守护项的断言数从 12 静默变成 9 并报
 * `pass`（β-C2 实测），`effectiveConfig` 取不到时同样掉到 9（β-W4 实测：缺的正是
 * `feature` 的三条）。「要检查多少」不能由「被检查的那份数据」决定。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATE_MOUNTING_ENFORCED_GATES,
  resolveGateMountingEnforcedModes,
  collectGateMountAnchors,
  isModeReadable,
} from '../contracts/orchestration-schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'orchestrator-cli.mjs');

/** GATE_TASKS.default_behavior 的禁用取值——这两个抹掉暂停路径 */
const GATE_TASKS_FORBIDDEN_BEHAVIORS = ['auto', 'skip'];
/** GATE_DESIGN.default_behavior 的禁用取值 */
const GATE_DESIGN_FORBIDDEN_BEHAVIORS = ['skip'];
/** (ii) 的判定对象：唯一以 hard_gate 形式声明的 (gate, mode) 对 */
const HARD_GATE_ASSERTION = { gateId: 'GATE_DESIGN', mode: 'feature' };

/** 取数错误的归档键（只影响 detail 文案，不参与判定）*/
const FACT_EFFECTIVE_CONFIG = 'effective-config';
const FACT_HARD_GATE = 'hard-gate-behavior';
const factKeyDiagnostics = mode => `diagnostics:${mode}`;

/**
 * 跑一次 orchestrator-cli 并解析 JSON 输出。
 * @param {string[]} args
 * @param {string} projectRoot
 * @returns {object}
 */
function defaultRunCli(args, projectRoot) {
  const stdout = execFileSync(
    process.execPath,
    [CLI_PATH, ...args, '--project-root', projectRoot],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
  );
  return JSON.parse(stdout);
}

/**
 * 逐条求值 12 条断言。
 *
 * **纯函数**：输入是已取好的事实，不碰文件系统与子进程——这样 (i) 的红灯构造
 * （effective 配置里门被删掉挂载）可以被独立构造，不必先把仓库改坏。
 *
 * 判不出⇒从严：`effectiveConfig` / `gateBehaviorByMode` / `diagnosticsByMode`
 * 任一取不到，对应断言一律判 `fail`，绝不因「读不到」而默认放行。
 *
 * @param {object} input
 * @param {object} input.effectiveConfig - base + overrides 合并后的配置
 * @param {Record<string, Record<string, {is_hard_gate?: boolean}>>} input.gateBehaviorByMode
 * @param {Record<string, Array<{level?: string}>>} input.diagnosticsByMode
 * @param {Record<string, string>} [input.factErrors] - 取事实时的 CLI 错误，按事实键归档；
 *        只进 detail 文案，不参与判定（判定一律按「取不到⇒fail」）
 * @returns {Array<{id: string, kind: string, title: string, status: 'pass'|'fail', mode?: string, gateId?: string, detail: string}>}
 */
export function evaluateGateMountingAssertions({
  effectiveConfig, gateBehaviorByMode, diagnosticsByMode, factErrors,
}) {
  /** 把某个事实的取数错误追加到 detail 末尾（没有则原样返回）*/
  const withFactError = (key, detail) => {
    const message = factErrors?.[key];
    return message ? `${detail}（取数失败：${message}）` : detail;
  };
  const assertions = [];
  const configReadable = Object.prototype.toString.call(effectiveConfig) === '[object Object]';
  // 射程恒 ⊇ GATE_MOUNTING_MANDATORY_MODES：effective 取不到时传 null 拿到的仍是
  // 完整下界（三个强制 mode 各三条，逐条判 fail），不缩小射程。
  const enforcedModes = configReadable
    ? resolveGateMountingEnforcedModes(effectiveConfig)
    : resolveGateMountingEnforcedModes(null);

  const push = (id, kind, title, ok, detail, extra = {}) => {
    assertions.push({ id, kind, title, status: ok ? 'pass' : 'fail', detail, ...extra });
  };

  // ── (i) 挂载断言（绝对形式 · 收紧为「存在无条件锚点」）──────
  for (const mode of enforcedModes) {
    for (const gateId of GATE_MOUNTING_ENFORCED_GATES) {
      const modeReadable = configReadable && isModeReadable(effectiveConfig, mode);
      const anchors = modeReadable ? collectGateMountAnchors(effectiveConfig, mode, gateId) : [];
      // conditional 恒假的 phase 整体不执行，挂在它上面的门一次都不会被求值（α-C1）。
      // 故「挂着」不等于「会被求值」，判据取无条件锚点的存在性。
      const liveAnchors = anchors.filter(a => a.conditional === null);
      const mounted = liveAnchors.length > 0;
      const describe = list => list.map(a => `${a.phase}.${a.side}`).join(', ');
      push(
        `mounting:${mode}:${gateId}`, 'mounting',
        `effective 的 ${mode} 至少有一个 conditional 为 null 的 phase 挂载 ${gateId}`,
        mounted,
        mounted
          ? `${mode} 的无条件挂载锚点：${describe(liveAnchors)}`
          : !modeReadable
            ? withFactError(
              FACT_EFFECTIVE_CONFIG,
              `effective 里读不出 modes.${mode}.phases（mode 段缺席或 phases 不是数组）`
              + `——强制 mode 在配置中缺席即判本条不成立，断言不会因此消失（判不出⇒判失败）`,
            )
            : anchors.length === 0
              ? `${mode} 的 effective phase 序列中没有任何 phase 的 gates_before / gates_after 含 ${gateId}`
                + `（配置上门可能仍然完好，但执行上它一次都不会被求值）`
              : `${mode} 挂载 ${gateId} 的 phase 全部带 conditional：${describe(anchors)}`
                + `——conditional 判假时该 phase 整体不执行，门一次都不会被求值`,
        { mode, gateId },
      );
    }
  }

  // ── (ii) feature 下 GATE_DESIGN 是硬门禁 ───────────────────
  const { gateId: hardGateId, mode: hardGateMode } = HARD_GATE_ASSERTION;
  const isHardGate = gateBehaviorByMode?.[hardGateMode]?.[hardGateId]?.is_hard_gate === true;
  push(
    `is-hard-gate:${hardGateMode}:${hardGateId}`, 'is_hard_gate',
    `get-gate-behavior ${hardGateMode} ${hardGateId} 的 is_hard_gate 为 true`,
    isHardGate,
    isHardGate
      ? `${hardGateMode} ∈ ${hardGateId}.hard_gate_modes`
      : withFactError(
        FACT_HARD_GATE,
        `${hardGateMode} 已不在 ${hardGateId}.hard_gate_modes 中，或该查询取不到结果`,
      ),
    { mode: hardGateMode, gateId: hardGateId },
  );

  // ── (iii) GATE_DESIGN.default_behavior ≠ skip ──────────────
  const designBehavior = configReadable ? effectiveConfig?.gates?.GATE_DESIGN?.default_behavior : undefined;
  const designOk = typeof designBehavior === 'string'
    && !GATE_DESIGN_FORBIDDEN_BEHAVIORS.includes(designBehavior);
  push(
    'default-behavior:GATE_DESIGN', 'gate_design_behavior',
    `GATE_DESIGN.default_behavior ∉ [${GATE_DESIGN_FORBIDDEN_BEHAVIORS.join(' | ')}]`,
    designOk,
    `实际取值: ${JSON.stringify(designBehavior)}`,
    { gateId: 'GATE_DESIGN' },
  );

  // ── (iv) GATE_TASKS.default_behavior ∉ {auto, skip} ────────
  const tasksBehavior = configReadable ? effectiveConfig?.gates?.GATE_TASKS?.default_behavior : undefined;
  const tasksOk = typeof tasksBehavior === 'string'
    && !GATE_TASKS_FORBIDDEN_BEHAVIORS.includes(tasksBehavior);
  push(
    'default-behavior:GATE_TASKS', 'gate_tasks_behavior',
    `GATE_TASKS.default_behavior ∉ [${GATE_TASKS_FORBIDDEN_BEHAVIORS.join(' | ')}]`,
    tasksOk,
    `实际取值: ${JSON.stringify(tasksBehavior)}（always / on_failure 都留有暂停路径，不受限）`,
    { gateId: 'GATE_TASKS' },
  );

  // ── (v) 每个强制 mode 的 diagnostics 无 error ──────────────
  for (const mode of enforcedModes) {
    const diags = diagnosticsByMode?.[mode];
    const readable = Array.isArray(diags);
    const errorDiags = readable ? diags.filter(d => d?.level === 'error') : [];
    const ok = readable && errorDiags.length === 0;
    push(
      `diagnostics:${mode}`, 'diagnostics',
      `effective-orchestration ${mode} 的 diagnostics 无 error 级条目`,
      ok,
      readable
        ? `error 级条目数 = ${errorDiags.length}${errorDiags.length ? '：' + errorDiags.map(d => d.code).join(', ') : ''}`
        : withFactError(factKeyDiagnostics(mode), 'diagnostics 取不到（判不出⇒从严，按断言不成立处理）'),
      { mode },
    );
  }

  return assertions;
}

/**
 * `repo:check` 族入口。
 *
 * @param {object} params
 * @param {string} params.projectRoot
 * @param {Function} [params._runCli] - 测试注入用；签名 (args, projectRoot) => object
 * @returns {Promise<{status: 'pass'|'fail', checks: Array, warnings: string[], errors: string[]}>}
 */
export async function validateGateMounting({ projectRoot, _runCli }) {
  const runCli = _runCli || defaultRunCli;
  const resolvedRoot = path.resolve(projectRoot);

  // 取事实时的 CLI 失败**不上抛**：上抛会把 12 条断言坍缩成 1 条 catch 结论，
  // 而 CLI 对「mode 在配置里不存在」正是 exit 1（`orchestrator-cli.mjs` 的 FR-011 校验）。
  // 强制 mode 被从配置里删掉时，本守护项必须仍产出 12 条、并让该 mode 的三条判红，
  // 而不是缩成一条「内部错误」——那会把 β-C2 的「断言静默消失」换个形式重演。
  // 方向仍是 fail-closed：取不到的事实一律让对应断言判 fail，错误原文进 detail。
  const factErrors = {};
  const tryRunCli = (args, factKey) => {
    try {
      return runCli(args, resolvedRoot);
    } catch (err) {
      factErrors[factKey] = err instanceof Error ? err.message : String(err);
      return undefined;
    }
  };

  let assertions;
  try {
    // 先用任意一个 mode 取一次 effective 配置——resolver 与 mode 无关，
    // 但派生增量要从这份配置的 hard_gate_modes 里取，故必须先取到它。
    const bootstrap = tryRunCli(
      ['effective-orchestration', 'feature', '--format', 'json'], FACT_EFFECTIVE_CONFIG,
    );
    const effectiveConfig = bootstrap?.config;
    const enforcedModes = resolveGateMountingEnforcedModes(effectiveConfig);

    const diagnosticsByMode = {};
    const gateBehaviorByMode = {};
    for (const mode of enforcedModes) {
      // 逐 mode 单独取一次：spec 的断言 (v) 就是按「每个强制 mode 各跑一次
      // effective-orchestration <mode>」写的，不合并成一次调用。
      const perMode = tryRunCli(
        ['effective-orchestration', mode, '--format', 'json'], factKeyDiagnostics(mode),
      );
      diagnosticsByMode[mode] = perMode?.diagnostics;
    }
    const hardGate = tryRunCli(
      ['get-gate-behavior', HARD_GATE_ASSERTION.mode, HARD_GATE_ASSERTION.gateId],
      FACT_HARD_GATE,
    );
    gateBehaviorByMode[HARD_GATE_ASSERTION.mode] = { [HARD_GATE_ASSERTION.gateId]: hardGate };

    assertions = evaluateGateMountingAssertions({
      effectiveConfig, gateBehaviorByMode, diagnosticsByMode, factErrors,
    });
  } catch (err) {
    // FR-045：catch 分支禁止返回空结果或 pass。取不到事实本身就是失败信号——
    // 门禁读不出配置时默认放行，等于送一条可主动触发的绕过路径。
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      checks: [{
        id: 'effective-config',
        title: 'GATE_DESIGN / GATE_TASKS 在 effective 配置上的 12 条断言',
        status: 'fail',
        evidence: { degraded: true, reason: `门挂载守护项内部错误：${message}`, assertions: [] },
      }],
      warnings: [],
      errors: [`门挂载守护项内部错误（判不出⇒判失败，不放行）：${message}`],
    };
  }

  const failed = assertions.filter(a => a.status === 'fail');
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    checks: [{
      id: 'effective-config',
      title: 'GATE_DESIGN / GATE_TASKS 在 effective 配置上的 12 条断言',
      status: failed.length === 0 ? 'pass' : 'fail',
      evidence: {
        assertions,
        passed: assertions.length - failed.length,
        total: assertions.length,
      },
    }],
    warnings: [],
    errors: failed.map(a => `${a.id}：${a.title} —— ${a.detail}`),
  };
}
