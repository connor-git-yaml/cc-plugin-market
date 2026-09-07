/**
 * orchestration-schema.mjs
 * Feature 133 — orchestration 配置的 Zod 三件套 Schema 定义
 *
 * 导出：
 *   - phaseSchema                  Phase 定义 Schema（base 用）
 *   - gateDefinitionSchema         Gate 定义 Schema（base 用）
 *   - gateOverrideSchema           Gate 覆盖 Schema（overrides 用）
 *   - modeDefinitionSchema         Mode 定义 Schema（base 用）
 *   - modeOverrideSchema           Mode 覆盖 Schema（overrides 用）
 *   - parallelGroupSchema          并行组 Schema（base 用）
 *   - parallelSchedulingSchema     全局并行调度 Schema
 *   - orchestrationBaseSchema      校验 plugin base orchestration.yaml
 *   - orchestrationOverridesSchema 校验项目级 overrides 文件
 *   - orchestrationMergedSchema    校验合并后的 config（复用 base schema）
 *   - formatZodIssue               Zod issue 中文化格式辅助函数
 *   - FORBIDDEN_GATE_OVERRIDES     Gate 覆盖禁改集 canonical 表（FR-052 甲/乙）
 *   - findForbiddenGateOverrides   在 overrides.gates 中找出禁改集违规项
 *   - GATE_MOUNTING_ENFORCED_GATES 挂载不可被覆盖删除的 gate（FR-052 丙）
 *   - collectGateMountAnchors      解析 (mode, gate) 的挂载锚点（唯一一处解析 gates_before/after）
 *   - evaluateGateMountingAgainstBase
 *                                  base 锚定的门挂载**可达性**判据（resolver / Orchestrator+CLI
 *                                  / repo:check 事后守护三处共用的单一实现）
 *   - GATE_MOUNTING_MANDATORY_MODES 强制 mode 清单的**常量下界**（β-C2：射程不得由被守护的配置决定）
 *   - resolveGateMountingEnforcedModes / findLostGateMountings / findMissingMandatoryModes
 *                                  门挂载判据的共用派生函数
 *   - isModeReadable               mode 段有没有 phase 序列可读（区分「判不出」与「没挂」）
 *   - isGateMountedInMode          纯结构存在性，已降级为内部辅助（α-C1~C3 后不得单独当判据）
 */

import { loadZod } from '../scripts/lib/load-zod.mjs';

// 经共享 helper 同步加载 zod；缺失时 zodAvailable=false，模块加载不崩
// （缺 zod 时全部 9 个 schema 求值被守卫跳过，导出为 null，由两消费者降级处理）
const { z, available: zodAvailable } = loadZod();

// ─────────────────────────────────────────────────────────────
// Zod issue 中文化格式辅助
// ─────────────────────────────────────────────────────────────

/**
 * 将 Zod issue 格式化为中文可读的错误信息
 * @param {import('zod').ZodIssue} issue
 * @returns {string}
 */
export function formatZodIssue(issue) {
  const path = issue.path.length > 0 ? `字段 "${issue.path.join('.')}"` : '配置根';
  switch (issue.code) {
    case 'invalid_type':
      return `${path}：类型错误，期望 ${issue.expected}，实际为 ${issue.received}`;
    case 'invalid_enum_value':
      return `${path}：不合法的枚举值 "${issue.received}"，合法值为 [${issue.options?.join(' | ')}]`;
    case 'unrecognized_keys':
      return `${path}：包含未识别的字段 [${issue.keys?.join(', ')}]`;
    case 'too_small':
      return `${path}：值过小，最小值为 ${issue.minimum}`;
    case 'too_big':
      return `${path}：值过大，最大值为 ${issue.maximum}`;
    case 'invalid_string':
      return `${path}：字符串格式不合法`;
    default:
      return `${path}：${issue.message}`;
  }
}

// ─────────────────────────────────────────────────────────────
// Base reserved mode names（FR-007-A，CL-001）
// ─────────────────────────────────────────────────────────────

/** Base 保留 mode 名称列表（overrides schema 中做 enum 校验）*/
// 纯常量数组，不依赖 zod，保持顶层导出（不进 zodAvailable 守卫，D4）
export const BASE_RESERVED_MODE_NAMES = [
  'feature',
  'story',
  'implement',
  'fix',
  'resume',
  'sync',
  'doc',
  'refactor',
];

// ─────────────────────────────────────────────────────────────
// Gate 覆盖禁改集（FR-052 甲 / 乙 · Feature 277）
// ─────────────────────────────────────────────────────────────

/**
 * 禁改集 canonical 表——项目级 overrides 不得覆盖的 gate 字段。
 *
 * `forbiddenValues === null` 表示**该字段整体禁改**（不论覆盖成什么值）；
 * 非 null 时只禁列出的取值。刻意不写成「只禁 skip」这类单点值枚举：
 * 每加一个等效取值就漏一次（F259 已登记的反模式）。
 *
 * 甲：`GATE_DESIGN.default_behavior` / `hard_gate_modes` 整体禁改——这道门被
 *     宪法定为「不可被任何策略或配置绕过」，改 `hard_gate_modes` 即可把它从
 *     强制 mode 上摘下来，改 `default_behavior` 即可让它不暂停。
 * 乙：`GATE_TASKS.default_behavior` 只禁 `auto` / `skip`——这两个取值抹掉暂停
 *     路径，`always` / `on_failure` 都留有暂停路径，仍可覆盖。
 *
 * 不进禁改集且必须保持可覆盖的字段（防守护过宽）：`GATE_DESIGN.severity`
 * （gate 决策链上无消费方）、`GATE_TASKS.hard_gate_modes`、其余全部 gate 的三字段。
 */
// 纯常量数组，不依赖 zod，保持顶层导出（与 BASE_RESERVED_MODE_NAMES 同型）
export const FORBIDDEN_GATE_OVERRIDES = [
  { gateId: 'GATE_DESIGN', field: 'default_behavior', forbiddenValues: null },
  { gateId: 'GATE_DESIGN', field: 'hard_gate_modes', forbiddenValues: null },
  { gateId: 'GATE_TASKS', field: 'default_behavior', forbiddenValues: ['auto', 'skip'] },
];

/**
 * 组装被拒覆盖的消息文本。
 *
 * 该文本是宪法原则 XIII 留痕义务 (b) 的迁移指引落点：必须直接写出**被拒的
 * 字段路径**（用户据此定位自己 YAML 里的哪一行）与**正确做法**（改 spec /
 * base 定义，而不是在项目级 overrides 里覆盖）。`GATE_TASKS` 暂停时须一并呈现。
 *
 * @param {{ gateId: string, field: string, forbiddenValues: string[]|null }} entry
 * @param {unknown} value - 用户实际写入的值
 * @returns {string}
 */
function formatForbiddenGateOverrideMessage(entry, value) {
  const fieldPath = `gates.${entry.gateId}.${entry.field}`;
  const scope = entry.forbiddenValues === null
    ? '该字段整体不可被项目级覆盖'
    : `该字段不可被覆盖为 [${entry.forbiddenValues.join(' | ')}]（其余取值仍可覆盖）`;
  return (
    `[orchestration-overrides] 禁改字段 "${fieldPath}" 被覆盖为 ${JSON.stringify(value)}，已拒绝该覆盖：${scope}。` +
    'GATE_DESIGN / GATE_TASKS 是不可被任何策略或配置绕过的门禁，关掉它们等于关掉本流程的质量闸。' +
    `正确做法：先改 spec 与 base 定义（plugins/spec-driver/config/orchestration.yaml）并走该门自身的评审，` +
    `而不是在 .specify/orchestration-overrides.yaml 里覆盖 "${fieldPath}"；` +
    `若只是想调整暂停时机，可改用不在禁改集内的字段（如 gates.${entry.gateId}.severity）。`
  );
}

/**
 * 在 overrides 的 `gates` 块里找出全部禁改集违规项。
 *
 * 输入是**未经 Zod 校验的原始对象**，故对任意畸形输入必须不抛错：无法判读的
 * 结构一律返回空清单，由 schema 层报它自己的错——这里返回空不是放行，
 * 因为畸形结构本身就过不了 `orchestrationOverridesSchema`。
 *
 * @param {unknown} gatesOverride - overrides.gates
 * @returns {Array<{ gateId: string, field: string, value: unknown, level: 'error', message: string }>}
 */
export function findForbiddenGateOverrides(gatesOverride) {
  if (
    gatesOverride === null ||
    gatesOverride === undefined ||
    Object.prototype.toString.call(gatesOverride) !== '[object Object]'
  ) {
    return [];
  }

  const violations = [];
  for (const entry of FORBIDDEN_GATE_OVERRIDES) {
    const gateOverride = gatesOverride[entry.gateId];
    if (Object.prototype.toString.call(gateOverride) !== '[object Object]') continue;
    if (!Object.prototype.hasOwnProperty.call(gateOverride, entry.field)) continue;

    const value = gateOverride[entry.field];
    const isForbidden = entry.forbiddenValues === null
      ? true
      : entry.forbiddenValues.includes(value);
    if (!isForbidden) continue;

    violations.push({
      gateId: entry.gateId,
      field: entry.field,
      value,
      // 级别固定 error：warning 不阻断 ⇒ 覆盖仍生效 ⇒ 等于把禁改集做成一行日志
      level: 'error',
      message: formatForbiddenGateOverrideMessage(entry, value),
    });
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────
// Gate 挂载禁改（FR-052 丙 / FR-053 / FR-068 · Feature 277）
// ─────────────────────────────────────────────────────────────
//
// 三处消费方共用同一张表与同一套派生函数，不各写一套：
//   - lib/orchestration-resolver.mjs   合并后的 resolver 侧校验（发 error + 回退 base）
//   - scripts/validate-gate-mounting.mjs  repo:check 事后守护
//   - 五份编排器 SKILL 的运行时守卫（经 get-gate-behavior 的 mounted / mounted_in_base）

/** 挂载不可被项目级覆盖删除的 gate（FR-052 丙 / FR-053 (i)）*/
// 纯常量数组，不依赖 zod，保持顶层导出
export const GATE_MOUNTING_ENFORCED_GATES = ['GATE_DESIGN', 'GATE_TASKS'];

/**
 * 强制 mode 清单的**下界**（spec FR-052 (丙) 的射程 / FR-053 的 mode 维度）。
 *
 * 这三个 mode 的「强制」身份来自 spec §mode 分层矩阵第 3 行，**不是配置里的活数据**，
 * 因此必须钉成常量：射程只能由**源码**决定，不能由被守护的那份配置决定。
 *
 * 原实现把三者中的 `feature` 交给 `GATE_DESIGN.hard_gate_modes` 派生、并用
 * `baseModes[mode] !== undefined` 过滤 `story` / `implement`——于是从 base 删掉
 * `modes.implement` 整段，`implement` 同时从「要检查的清单」和「检查结果」里消失，
 * `for` 循环少转两圈、`errors` 为空、守护项报 `pass`（Phase A 对抗审查 β-C2 实测：
 * 断言数 12 → 9 而 `status = pass`；β-W4 同根：`effectiveConfig` 取不到时 12 → 9）。
 * 「要检查多少」与「检查结果」取自同一份数据，是这两条的共同根因。
 *
 * 派生只能**扩**不能**缩**：`hard_gate_modes` 里新出现的 mode 仍会被并进射程
 * （F259 登记的「写死字面量则每加一个值漏一次」反模式仍被覆盖），但本清单里的三个
 * mode 无论配置里在不在都必须产出断言——缺席时判 fail，不是让断言消失。
 */
export const GATE_MOUNTING_MANDATORY_MODES = Object.freeze(['feature', 'story', 'implement']);

/**
 * 解析「强制 mode」清单 = 常量下界 ∪ 从 `hard_gate_modes` 派生的增量。
 *
 * **不再按 `config.modes` 过滤**：配置里缺席的强制 mode 也必须留在清单里，
 * 由调用方按「判不出⇒从严」处置（见 `evaluateGateMountingAgainstBase` 的缺席支与
 * `validate-gate-mounting.mjs` 的 (i)）。传 `null` 时返回的仍是完整下界。
 *
 * @param {object} config - base 或 effective 配置（只用它的 gates.*.hard_gate_modes）
 * @returns {string[]} 排序后的 mode 名清单；恒为 `GATE_MOUNTING_MANDATORY_MODES` 的超集
 */
export function resolveGateMountingEnforcedModes(config) {
  const derived = new Set(GATE_MOUNTING_MANDATORY_MODES);
  for (const gateId of GATE_MOUNTING_ENFORCED_GATES) {
    const hardGateModes = config?.gates?.[gateId]?.hard_gate_modes;
    if (!Array.isArray(hardGateModes)) continue;
    for (const mode of hardGateModes) {
      if (typeof mode === 'string') derived.add(mode);
    }
  }
  return [...derived].sort();
}

/**
 * 某个 mode 在配置里**有没有 phase 序列可读**。
 *
 * 「mode 段整个缺席 / phases 不是数组」与「mode 在场但没挂这道门」是两个事实：
 * 前者是**判不出**，后者是一个确定的观测值。合并二者正是 β-C1 / β-C2 的同型根因。
 *
 * @param {object} config
 * @param {string} mode
 * @returns {boolean}
 */
export function isModeReadable(config, mode) {
  return Array.isArray(config?.modes?.[mode]?.phases);
}

/**
 * base 里缺席的强制 mode 清单（FR-052 丙的射程完整性检查）。
 *
 * base 是锚点的唯一来源；强制 mode 在 base 里缺席时，「effective 相对 base 失去了
 * 什么」这个相对量无从计算——那不是「没失去」，是判不出。resolver 据此发 error。
 *
 * @param {object} baseConfig
 * @returns {string[]} 排序后的缺席 mode 名清单；空数组表示射程完整
 */
export function findMissingMandatoryModes(baseConfig) {
  return GATE_MOUNTING_MANDATORY_MODES.filter(mode => !isModeReadable(baseConfig, mode)).sort();
}

/**
 * 判断 gate 是否被某 mode 的 phase 序列**结构上**挂载（`gates_before ∪ gates_after`）。
 *
 * ⚠️ **纯结构存在性判据，不得再被任何一道防线单独当判据用**（Feature 277 Phase A
 * 对抗审查 α-C1 / α-C2 / α-C3）：它只问「某个 phase 的 gates_* 数组里有没有这个
 * 字符串」，不问那个 phase 会不会被执行、也不问它站在序列的哪个位置。而同一份配置
 * 里就有两个 phase 级抑制开关（`conditional` 与 `skip_if_exists`，见
 * `lib/orchestrator.mjs` 的 `shouldExecutePhase`），把门改挂到一个
 * `conditional` 恒假或 `skip_if_exists` 恒真的幽灵 phase 上、或挂到序列末尾，
 * 本函数一律照答 `true`。
 *
 * 现存唯一用法：`evaluateGateMountingAgainstBase` 在「base 本就没有锚点」这一支里
 * 用它诚实回答「effective 结构上挂没挂」——该支不参与 FR-068 的蕴含式判据。
 *
 * **取不到一律按 `false`**（判不出⇒从严）。
 *
 * @param {object} config - base 或 effective 配置
 * @param {string} mode
 * @param {string} gateId
 * @returns {boolean}
 */
export function isGateMountedInMode(config, mode, gateId) {
  const phases = config?.modes?.[mode]?.phases;
  if (!Array.isArray(phases)) return false;
  return phases.some((phase) => {
    const before = Array.isArray(phase?.gates_before) ? phase.gates_before : [];
    const after = Array.isArray(phase?.gates_after) ? phase.gates_after : [];
    return before.includes(gateId) || after.includes(gateId);
  });
}

/** 一个 phase 上可挂门的两侧，顺序固定以保证锚点清单可复现 */
const GATE_MOUNT_SIDES = ['gates_before', 'gates_after'];

/** `undefined` 与 `null` 在抑制开关上同义（YAML 省略键 vs 显式 null）*/
function normalizeSuppressor(value) {
  return value === undefined ? null : value;
}

/** phase 是否是可读的纯对象 */
function isPlainPhase(phase) {
  return Object.prototype.toString.call(phase) === '[object Object]';
}

/** 取某 mode 的 phase 序列（取不到返回空数组，交由调用方按「判不出⇒从严」处置）*/
function readPhases(config, mode) {
  const phases = config?.modes?.[mode]?.phases;
  return Array.isArray(phases) ? phases : [];
}

/**
 * 收集 (mode, gateId) 在某份配置里的全部**挂载锚点**。
 *
 * 锚点 = `(phase.name, side)` 对，外加求值该锚点是否会发生所需的两个抑制开关快照，
 * 以及该 phase 的**身份二元组** `(agent, agent_mode)`——判据 1 要拿它与 base 逐字比对
 * （见 `evaluateGateMountingAgainstBase` 的 `anchor-tuple-changed`）。
 * 这是本模块唯一一处解析 `gates_before` / `gates_after` 的地方——resolver、
 * Orchestrator / CLI、`repo:check` 事后守护三处消费方共用它，不各写一套。
 *
 * @param {object} config
 * @param {string} mode
 * @param {string} gateId
 * @returns {Array<{ phase: string|null, side: string, index: number, conditional: unknown,
 *   skipIfExists: unknown, agent: unknown, agentMode: unknown }>}
 */
export function collectGateMountAnchors(config, mode, gateId) {
  const anchors = [];
  readPhases(config, mode).forEach((phase, index) => {
    if (!isPlainPhase(phase)) return;
    for (const side of GATE_MOUNT_SIDES) {
      const mountedGates = Array.isArray(phase[side]) ? phase[side] : [];
      if (!mountedGates.includes(gateId)) continue;
      anchors.push({
        // name 不是字符串时留 null：锚点无法按名比对 ⇒ 下游按 missing-anchor 从严处置
        phase: typeof phase.name === 'string' ? phase.name : null,
        side,
        index,
        conditional: normalizeSuppressor(phase.conditional),
        skipIfExists: normalizeSuppressor(phase.skip_if_exists),
        agent: normalizeSuppressor(phase.agent),
        agentMode: normalizeSuppressor(phase.agent_mode),
      });
    }
  });
  return anchors;
}

/** 逐 phase 取 name（非字符串留 null），用于位序比对 */
function listPhaseNames(config, mode) {
  return readPhases(config, mode)
    .map(phase => (isPlainPhase(phase) && typeof phase.name === 'string' ? phase.name : null));
}

/**
 * name → effective 中的**首个**索引；重名时取最小值。
 *
 * 「取首个」是**钉死的**判据，不是实现细节：位序规则问的是「base 的后继在 effective
 * 里有没有跑到锚点前面去」，重名时只要**任意一份**同名 phase 跑到了前面，那段产出就
 * 可能提前发生，故取最小索引才是从严。与 `evaluateGateMountingAgainstBase` 里
 * `candidates` 取**全部**同名同侧锚点、任一见证即通过（从宽）方向相反，二者都是刻意的：
 * 前者判「后继位置」（要抓提前），后者找「见证」（要证明存在一处真实可达的挂载）。
 */
function buildFirstIndexByName(config, mode) {
  const index = new Map();
  listPhaseNames(config, mode).forEach((name, i) => {
    if (name !== null && !index.has(name)) index.set(name, i);
  });
  return index;
}

/**
 * phase 的**身份三元组** `(name, agent, agent_mode)` 的可比对键。
 *
 * 判据不再按 phase **自身**的字段去分类「它是不是会产出制品」——那条路第二轮走过，
 * 三个逃逸口（复用 base 名字 / `agent: null` / `agent_mode: 'gate'`）各自都能原样
 * 复现整条绕过（Phase A 对抗审查第三轮 N-1）。根因是「要不要检查这个 phase」被交给了
 * **被检查的那份数据里攻击者可写的字段**，而 base 自己就有 `agent: null` 且带
 * `skip_if_exists` 的产出型 inline phase（`feature.research_synthesis` /
 * `feature.online_research`），谓词依赖的事实前提本身就是假的。
 *
 * 现在这个键**不做任何语义分类**：它只回答「这个 phase 与 base 同段的某个 phase 是不是
 * 同一个东西」。三个分量全部参与——只比 `name` 会被「复用 base 名字但换 `agent`」绕过
 * （S2 / S3），加上 `agent` / `agent_mode` 后，任何身份变化都落在 base 同段之外。
 *
 * `undefined` 与 `null` 归一（YAML 省略键 vs 显式 null 同义）；`agent` 允许是数组
 * （`parallel_group` 形态），故用 JSON 序列化保序比对，不做集合化。
 *
 * @param {unknown} phase
 * @returns {string} 稳定可比对的键；phase 不是纯对象时返回一个不会与任何 phase 相等的键
 */
function phaseIdentityKey(phase) {
  if (!isPlainPhase(phase)) return JSON.stringify(['\u0000not-a-phase']);
  return JSON.stringify([
    typeof phase.name === 'string' ? phase.name : null,
    normalizeSuppressor(phase.agent),
    normalizeSuppressor(phase.agent_mode),
  ]);
}

/** 身份键 → 该 phase 供人读的短描述（只进 detail 文案）*/
function describePhaseIdentity(phase) {
  const name = isPlainPhase(phase) && typeof phase.name === 'string' ? phase.name : null;
  const agent = isPlainPhase(phase) ? normalizeSuppressor(phase.agent) : null;
  const agentMode = isPlainPhase(phase) ? normalizeSuppressor(phase.agent_mode) : null;
  return `${JSON.stringify(name)}（agent ${JSON.stringify(agent)}, agent_mode ${JSON.stringify(agentMode)}）`;
}

/**
 * 统计一段 phase 序列里各身份三元组的**出现次数**（多重集）。
 *
 * 计次数而不是只算集合：S2 的构造正是「把 base 已有的 `constitution` 复制成两份」，
 * 集合语义下两份与一份无从区分。
 *
 * @param {Array} phases
 * @param {number} endExclusive - 只统计 `[0, endExclusive)` 这一段
 * @returns {Map<string, number>}
 */
function countPhaseIdentities(phases, endExclusive) {
  const counts = new Map();
  for (let i = 0; i < Math.min(endExclusive, phases.length); i += 1) {
    const key = phaseIdentityKey(phases[i]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 判据 2：**锚点前子序列**——effective 中排在锚点候选之前的那段 phase，必须是 base 中
 * 排在该锚点之前那段的**子序列**（按身份三元组的多重集比，重数不得超过 base 同段）。
 *
 * 语义是「门被求值之前跑过的东西不得变多、不得换人」：可删（少跑一些，门把守的产出
 * 不会提前发生）、不可增（新的产出会提前满足锚点的 `skip_if_exists`，让锚点整段被跳过，
 * 挂在它上面的门一次都不被求值）、不可改（同名换 `agent` 等价于换了一个新东西）。
 *
 * 判据 3（位序）与本条互补且都必要：3 抓「base 的**后继**跑到锚点前面去」，本条抓
 * 「锚点**之前**多了 base 同段没有的东西」；base 后继在 effective 中整个缺席这一形态
 * 只有 3 抓得到。
 *
 * @param {Array} basePhases
 * @param {number} baseAnchorIndex - 该锚点在 base 中的索引
 * @param {Array} effectivePhases
 * @param {number} candidateIndex  - 该锚点在 effective 中的候选索引
 * @returns {{ index: number, phase: unknown }|null} 首个越界的 effective phase；null 表示合规
 */
function findPreAnchorIntruder(basePhases, baseAnchorIndex, effectivePhases, candidateIndex) {
  const allowance = countPhaseIdentities(basePhases, baseAnchorIndex);
  const used = new Map();
  for (let i = 0; i < Math.min(candidateIndex, effectivePhases.length); i += 1) {
    const key = phaseIdentityKey(effectivePhases[i]);
    const next = (used.get(key) ?? 0) + 1;
    if (next > (allowance.get(key) ?? 0)) return { index: i, phase: effectivePhases[i] };
    used.set(key, next);
  }
  return null;
}

/**
 * 找出 base 锚点之后的哪一个 base phase 在 effective 中破坏了位序。
 *
 * 门必须仍在它把守的产出**之前**：base 中位于锚点 phase 之后的每一个 phase 名，
 * 在 effective 中的索引都必须大于该锚点候选 phase 的索引。
 * base 名在 effective 中缺席也计破坏——缺席意味着那段产出被换成了别的东西，
 * 位序无从核对（判不出⇒从严）。
 *
 * @returns {{ successor: string|null, reason: string }|null} null 表示位序完好
 */
function findOrderBreak(baseNames, baseAnchorIndex, effectiveIndexByName, candidateIndex) {
  for (let i = baseAnchorIndex + 1; i < baseNames.length; i += 1) {
    const successor = baseNames[i];
    if (successor === null) {
      return { successor: null, reason: `base 第 ${i} 个 phase 缺 name，位序无从核对` };
    }
    const effectiveIndex = effectiveIndexByName.get(successor);
    if (effectiveIndex === undefined) {
      return { successor, reason: `base 中位于该锚点之后的 phase "${successor}" 在 effective 中缺席` };
    }
    if (effectiveIndex <= candidateIndex) {
      return {
        successor,
        reason: `phase "${successor}" 在 effective 中前移到了锚点处或之前`
          + `（其 index ${effectiveIndex} ≤ 锚点 index ${candidateIndex}）`,
      };
    }
  }
  return null;
}

/**
 * **base 锚定的门挂载可达性判据**（FR-052 丙 / FR-053 / FR-068 的单一实现）。
 *
 * 取代原先的纯结构存在性判据：只问「名字还在不在配置里」会被三类构造整类绕过
 * （见 Phase A 对抗审查 α-C1 / α-C2 / α-C3），本函数问的是
 * **「base 里那几道门锚点，在 effective 里是不是仍然会被求值、且仍然站在它把守的产出之前」**。
 *
 * 锚点取自 **base**（可信基线）：`modes[mode].phases` 里每个挂载 `gateId` 的
 * `(phase.name, side)` 对。对每个锚点，effective 必须同时满足四条，否则各记一条 violation：
 *
 * 1. `missing-anchor`        —— 存在同名 phase 且该侧数组仍含 `gateId`；
 * 2. `suppressor-added`      —— 该 phase 的 `conditional` / `skip_if_exists` 与 base **逐字相等**
 *    （base 的 `plan` phase 本身带 `skip_if_exists: "plan.md"` 且 `gates_before` 挂
 *    `GATE_DESIGN`，这是**合法锚点**，不得被判红；禁的是「抑制条件比 base 更强」）；
 * 3. `anchor-tuple-changed`  —— 锚点自身的 `agent` 与 base **逐字相等**；`gates_after` 侧
 *    的锚点连 `agent_mode` 一并逐字相等（见下方「判据 3 的侧向不对称」）；
 * 4. 锚点之前与之后各一条，任一不成立即记违规：
 *    4a. `order-broken`                —— base 中位于该锚点之后的每个 phase，在 effective 中仍在其之后；
 *    4b. `pre-anchor-phase-not-in-base` —— effective 中排在锚点候选之前的那段，必须是 base
 *        中排在该锚点之前那段的**子序列**（按 `(name, agent, agent_mode)` 三元组的多重集比）。
 *
 * **3 与 4b 是 Phase A 对抗审查第三轮（N-1 / δ-C1）的收口**。第二轮曾用一条
 * 「锚点之前不得出现 base 未定义名字的**产出型** phase」的子句，其「产出型」谓词读的是
 * phase **自身**的 `name` / `agent` / `agent_mode`——这三个字段全部由被守护的那份
 * overrides 提供，于是有三个逃逸口，每一个都能把 `story` / `implement` 的两道门打到
 * **零求值**而三道防线全绿（实测）：复用 base 已有名字但换 `agent`（S2 / S3）、
 * `agent: null` 的 inline 产出型（F1，其「inline 不产出制品」的前提被 base 自己的
 * `feature.research_synthesis` / `online_research` 证伪——两者都是 `agent: null` 且带
 * `skip_if_exists`）、`agent_mode: 'gate'` 但 `agent` 非空（F2，守卫信 `agent_mode`
 * 而执行面读 `agent`）。故本轮**废除按 phase 自身字段做的任何分类**：4b 不问某个 phase
 * 会不会产出制品，只问「它在 base 的同一段里有没有对应物」——**可删、不可增、不可改**。
 *
 * **判据 3 的侧向不对称**（刻意，非疏漏）：`gates_after` 锚点的 phase 体在门被求值
 * **之前**执行，把它的 `agent` 换成别的（例：`feature.gate_design` 的 `agent: null` 改成
 * `plan`）等于「`gates_after` 之前先跑一遍 plan」，门从把守退化为事后追认，故
 * `(agent, agent_mode)` 两个分量都钉死。`gates_before` 锚点的 phase 体在该门求值
 * **之后**才执行，改它的 `agent_mode` 移不动任何产出到门之前；而 `agent_mode` 正是
 * F201 goal_loop 唯一的合法激活位（base 的 `feature.implement` 带 `gates_before:
 * [GATE_TASKS]`，`templates/goal-loop-override-template.yaml` 把它改成 `goal_loop`），
 * 一并钉死会把一条已发布的产品能力误判为攻击。`agent` 在两侧都钉死（从严且零代价）。
 * 落在别的门的 4b 段里的 `gates_before` 锚点，其 `agent_mode` 仍由那条 4b 钉住——
 * base 的三个强制 mode 里只有 `feature.implement` 一个锚点不落进任何 4b 段。
 *
 * 同名同侧存在多个候选时取「存在一个同时满足 2、3、4a、4b 的候选」即通过——那个候选就是
 * 一处真实、可达、身份未变且位序正确的挂载，用它作为通过的见证不构成绕过面。
 *
 * `mountedInBase === false` 有两支，**语义不同，不得混读**：
 *   - base 的该 mode 段**可读**但没挂这道门 ⇒ 这是一个确定的观测值（如 `resume`
 *     不挂 `GATE_DESIGN`）：`mountedInBase: false`，`mounted` 退回 effective 侧的
 *     结构存在性，诚实回答「结构上挂没挂」，不参与 FR-068 的蕴含式判据（前件为假）。
 *   - base 的该 mode 段**整个读不出来** ⇒ 这是**判不出**，不是「没挂」。强制 mode ×
 *     强制 gate 上按 FR-068 (3)「`mounted_in_base` 判不出一律按 `true` 代入」从严：
 *     返回 `mountedInBase: true`，且 `mounted` **恒为 `false`** 并记
 *     `mandatory-mode-missing`。β-C2 实测：不这样做时，从 base 删掉 `modes.story`
 *     整段会让 resolver 侧 `violations = []`、守卫放行，而那次 `story` 运行**一道门
 *     都不挂**。`mounted` 在该支下**不得**回落到 `isGateMountedInMode` 的纯结构存在性
 *     （第三轮 N-3）：锚点无从取得时「effective 相对 base 有没有失去挂载」这个相对量
 *     判不出，而结构存在性回答的是另一个量（「gates_* 数组里有没有这个字符串」），
 *     用后者充当前者会在「base 段读不出 + effective 把门挂到一个 `conditional` 恒假的
 *     幽灵 phase 上」这一组合下给出 `mounted: true` 且零违规——一句站不住的肯定性结论。
 *
 * @param {object} effectiveConfig - 合并后的 effective 配置
 * @param {object} baseConfig      - base 配置（锚点来源）
 * @param {string} mode
 * @param {string} gateId
 * @returns {{ mountedInBase: boolean, mounted: boolean, anchors: Array, violations: Array<{kind: string, phase: string|null, side: string, detail: string}> }}
 */
export function evaluateGateMountingAgainstBase(effectiveConfig, baseConfig, mode, gateId) {
  const baseAnchors = collectGateMountAnchors(baseConfig, mode, gateId);
  if (baseAnchors.length === 0) {
    // 「base 段读不出」与「base 段可读但没挂这道门」是两个事实，见函数 doc。
    const undecidable = !isModeReadable(baseConfig, mode)
      && GATE_MOUNTING_MANDATORY_MODES.includes(mode)
      && GATE_MOUNTING_ENFORCED_GATES.includes(gateId);
    if (!undecidable) {
      return {
        mountedInBase: false,
        mounted: isGateMountedInMode(effectiveConfig, mode, gateId),
        anchors: [],
        violations: [],
      };
    }
    // N-3：本支下 mounted 恒 false —— 锚点无从取得时相对量判不出，不得用结构存在性充数。
    return {
      mountedInBase: true,   // FR-068 (3)：判不出一律按 true 代入，绝不按 false
      mounted: false,
      anchors: [],
      violations: [{
        kind: 'mandatory-mode-missing',
        phase: null,
        side: '',
        detail: `强制 mode "${mode}" 在 base 中缺席（modes.${mode}.phases 读不出），`
          + `锚点无从取得——按「判不出⇒从严」代入 mounted_in_base = true；`
          + `"${mode}" 相对 base 有没有失去 ${gateId} 的挂载判不出，一律按失去处理`
          + `（effective 结构上挂没挂不参与本判定：那是另一个量）`,
      }],
    };
  }

  const effectiveAnchors = collectGateMountAnchors(effectiveConfig, mode, gateId);
  const effectiveIndexByName = buildFirstIndexByName(effectiveConfig, mode);
  const baseNames = listPhaseNames(baseConfig, mode);
  const basePhases = readPhases(baseConfig, mode);
  const effectivePhases = readPhases(effectiveConfig, mode);
  const violations = [];

  // 判据 3：`gates_after` 锚点的 phase 体在门求值之前执行 ⇒ 身份二元组整体钉死；
  // `gates_before` 锚点的 phase 体在门求值之后执行 ⇒ 只钉 agent（理由见函数 doc）。
  const anchorTupleMatches = (anchor, candidate) => (
    JSON.stringify(candidate.agent) === JSON.stringify(anchor.agent)
    && (anchor.side !== 'gates_after' || candidate.agentMode === anchor.agentMode)
  );

  for (const anchor of baseAnchors) {
    const candidates = anchor.phase === null
      ? []
      : effectiveAnchors.filter(a => a.phase === anchor.phase && a.side === anchor.side);

    if (candidates.length === 0) {
      violations.push({
        kind: 'missing-anchor',
        phase: anchor.phase,
        side: anchor.side,
        detail: anchor.phase === null
          ? `base 的挂载 phase 缺 name，锚点无法比对（判不出⇒从严）`
          : `effective 中没有名为 "${anchor.phase}" 且 ${anchor.side} 仍含 ${gateId} 的 phase`,
      });
      continue;
    }

    const suppressorMatches = candidates.filter(
      c => c.conditional === anchor.conditional && c.skipIfExists === anchor.skipIfExists,
    );
    const tupleMatches = suppressorMatches.filter(c => anchorTupleMatches(anchor, c));
    const witness = tupleMatches.find(
      c => findOrderBreak(baseNames, anchor.index, effectiveIndexByName, c.index) === null
        && findPreAnchorIntruder(basePhases, anchor.index, effectivePhases, c.index) === null,
    );
    if (witness) continue;

    if (suppressorMatches.length === 0) {
      const sample = candidates[0];
      violations.push({
        kind: 'suppressor-added',
        phase: anchor.phase,
        side: anchor.side,
        detail: `phase "${anchor.phase}" 的抑制条件强于 base：`
          + `conditional ${JSON.stringify(anchor.conditional)} → ${JSON.stringify(sample.conditional)}，`
          + `skip_if_exists ${JSON.stringify(anchor.skipIfExists)} → ${JSON.stringify(sample.skipIfExists)}`
          + `（该 phase 不被执行时，挂在它上面的 ${gateId} 一次都不会被求值）`,
      });
      continue;
    }

    if (tupleMatches.length === 0) {
      const sample = suppressorMatches[0];
      violations.push({
        kind: 'anchor-tuple-changed',
        phase: anchor.phase,
        side: anchor.side,
        detail: `锚点 phase "${anchor.phase}" 自身的身份相对 base 已改变：`
          + `agent ${JSON.stringify(anchor.agent)} → ${JSON.stringify(sample.agent)}，`
          + `agent_mode ${JSON.stringify(anchor.agentMode)} → ${JSON.stringify(sample.agentMode)}`
          + (anchor.side === 'gates_after'
            ? `（该锚点挂在 gates_after：phase 体在 ${gateId} 求值之前执行，换掉它等于让门`
              + `事后追认一段新的产出）`
            : `（该锚点挂在 gates_before：agent 换人即换掉了门放行之后要跑的那段）`),
      });
      continue;
    }

    // 到这里说明每个「抑制条件与身份都与 base 相同」的候选都栽在位序上：要么 4a、要么 4b。
    // 取首个候选归因，两条子句分别记不同 kind，排障时能直接看出是哪一类。
    const sample = tupleMatches[0];
    const orderBreak = findOrderBreak(
      baseNames, anchor.index, effectiveIndexByName, sample.index,
    );
    if (orderBreak) {
      violations.push({
        kind: 'order-broken',
        phase: anchor.phase,
        side: anchor.side,
        detail: `phase "${anchor.phase}" 上的 ${gateId} 已不在它把守的产出之前：${orderBreak.reason}`,
      });
      continue;
    }

    const intruder = findPreAnchorIntruder(basePhases, anchor.index, effectivePhases, sample.index);
    violations.push({
      kind: 'pre-anchor-phase-not-in-base',
      phase: anchor.phase,
      side: anchor.side,
      detail: `effective 在锚点 "${anchor.phase}"（index ${sample.index}）之前的 ${sample.index} 个 phase 中，`
        + `第 ${intruder?.index} 个 ${describePhaseIdentity(intruder?.phase)} 不是 base 同段`
        + `（base 中该锚点之前的 ${anchor.index} 个 phase）的子序列成员`
        + `（按 (name, agent, agent_mode) 三元组比对，重数不得超过 base 同段）`
        + `——门被求值之前跑过的东西只可删、不可增、不可改；新增或换人的前驱会提前产出制品，`
        + `从而满足锚点的 skip_if_exists，使挂在锚点上的 ${gateId} 一次都不会被求值`,
    });
  }

  return {
    mountedInBase: true,
    mounted: violations.length === 0,
    anchors: baseAnchors,
    violations,
  };
}

/**
 * 找出 effective 配置相对 base **失去**的门挂载（FR-052 丙的可执行形式）。
 *
 * 逐 (强制 mode, gate) 调用一次 `evaluateGateMountingAgainstBase`；
 * base 本来就没挂载的组合不判——「失去」是相对量。base 自身被直接编辑掉挂载
 * 这条路径本判据是盲的，由 FR-053 的 repo:check 事后守护（绝对形式）承担。
 *
 * 射程来自 `resolveGateMountingEnforcedModes`，它以常量 `GATE_MOUNTING_MANDATORY_MODES`
 * 为下界：base 里被整段删掉的强制 mode **仍在射程内**，且在被求值函数里走「判不出⇒
 * `mountedInBase` 按 true 代入」那一支，故会产出 `mandatory-mode-missing` 违规而不是
 * 悄悄少转两圈（β-C2）。
 *
 * @param {object} mergedConfig - 合并后的 effective 配置
 * @param {object} baseConfig
 * @returns {Array<{ mode: string, gateId: string, violations: Array }>} 违规清单；空数组表示通过
 */
export function findLostGateMountings(mergedConfig, baseConfig) {
  const lost = [];
  for (const mode of resolveGateMountingEnforcedModes(baseConfig)) {
    for (const gateId of GATE_MOUNTING_ENFORCED_GATES) {
      const result = evaluateGateMountingAgainstBase(mergedConfig, baseConfig, mode, gateId);
      if (!result.mountedInBase) continue;
      if (result.violations.length > 0) lost.push({ mode, gateId, violations: result.violations });
    }
  }
  return lost;
}

// ─────────────────────────────────────────────────────────────
// 共用子 Schema + 三件套 Schema（全部包进 zodAvailable 守卫）
// ─────────────────────────────────────────────────────────────
//
// schema 求值必须全部包进 zodAvailable 守卫：缺 zod 时模块体完全不触碰 z，
// 否则会从 MODULE_NOT_FOUND 退化为 ReferenceError —— 等于没修。
// ESM 语法限制 export const 不能进 if 块，故用 let 顶层声明 + 守卫内赋值 + 末尾统一 export。
// 赋值顺序严格遵循依赖关系：叶子 schema → 依赖 phaseSchema 的中层 → 顶层 → 别名。

let phaseSchema = null;
let gateDefinitionSchema = null;
let gateOverrideSchema = null;
let modeDefinitionSchema = null;    // 依赖 phaseSchema
let modeOverrideSchema = null;      // 依赖 phaseSchema
let parallelGroupSchema = null;
let parallelSchedulingSchema = null;
let orchestrationBaseSchema = null; // 依赖 parallelSchedulingSchema/gateDefinitionSchema/parallelGroupSchema/modeDefinitionSchema
let orchestrationOverridesSchema = null; // 依赖 modeOverrideSchema/gateOverrideSchema
let orchestrationMergedSchema = null;    // = orchestrationBaseSchema（别名）

if (zodAvailable) {
  // ── 1. 叶子 schema（无内部依赖）─────────────────────────────

  /**
   * Phase 定义 Schema（base orchestration.yaml 中 phases 数组元素）
   *
   * 关键观察（来自 orchestration.yaml 实际字段）：
   *   - agent: null | string | string[]（三种形态）
   *   - agent_mode: inline | single | parallel_group | gate | orchestrator_verify | batch_loop | goal_loop
   *   - gates_before / gates_after: null | string[]（nullable，非 optional）
   *   - conditional / skip_if_exists: null | string（nullable）
   *   - is_critical: boolean
   */
  phaseSchema = z.object({
    id: z.string({ required_error: 'phase id 为必填字段' }),
    name: z.string({ required_error: 'phase name 为必填字段' }),
    display_name: z.string({ required_error: 'phase display_name 为必填字段' }),
    // agent 可以是 null、string 或 string 数组（parallel_group 模式时）
    agent: z.union([
      z.null(),
      z.string(),
      z.array(z.string()),
    ]),
    // agent_mode 枚举——来自 orchestration.yaml 实际值
    // goal_loop（Feature 201）：feature mode implement phase 的可迭代闭环模式，
    // base 默认不启用（feature implement 仍为 single），仅经 overrides 整段替换激活
    agent_mode: z.enum([
      'inline',
      'single',
      'parallel_group',
      'gate',
      'orchestrator_verify',
      'batch_loop',
      'goal_loop',
    ], {
      error_map: (issue) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `agent_mode 不合法：期望 [inline|single|parallel_group|gate|orchestrator_verify|batch_loop|goal_loop]，实际为 "${issue.received}"`,
          };
        }
        return { message: issue.message };
      },
    }),
    // gates_before / gates_after：null 或 string 数组（YAML 中的 null 必须用 .nullable()）
    gates_before: z.array(z.string()).nullable(),
    gates_after: z.array(z.string()).nullable(),
    // conditional / skip_if_exists：null 或字符串表达式
    conditional: z.string().nullable(),
    skip_if_exists: z.string().nullable(),
    is_critical: z.boolean(),
  });

  /**
   * Gate 定义 Schema（base orchestration.yaml 中 gates 块）
   *
   * 关键观察：
   *   - type: string（自由文本，如 "research_checkpoint"）
   *   - applicable_modes: string[] 或不存在（非所有 gate 都有此字段）
   *   - default_behavior: "always" | "auto" | "on_failure" | "skip"（skip 表示跳过该 gate 检查点）
   *   - severity: "critical" | "non_critical"（实际值，非 spec 定义的 warning/info）
   *   - hard_gate_modes: null | string[]（nullable）
   *   - insertion_point: null | string（nullable）
   */
  gateDefinitionSchema = z.object({
    type: z.string(),
    // applicable_modes 在某些 gate 中存在（如 GATE_RESEARCH），某些不存在（如 GATE_VERIFY 有）
    // 实际上所有 gate 都有此字段，但为了健壮性设为 optional
    applicable_modes: z.array(z.string()).optional(),
    description: z.string(),
    // 实际 default_behavior 值包含 on_failure 和 skip（override 场景允许 skip 跳过 gate）
    default_behavior: z.enum(['always', 'auto', 'on_failure', 'skip'], {
      error_map: (issue) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `default_behavior 不合法：期望 [always | auto | on_failure | skip]，实际为 "${issue.received}"`,
          };
        }
        return { message: issue.message };
      },
    }),
    // 实际 severity 值为 "critical" 和 "non_critical"（非 spec 文档定义的 warning/info）
    severity: z.enum(['critical', 'non_critical', 'warning', 'info'], {
      error_map: (issue) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `severity 不合法：期望 [critical | non_critical | warning | info]，实际为 "${issue.received}"`,
          };
        }
        return { message: issue.message };
      },
    }),
    // hard_gate_modes：YAML 中显式为 null（必须用 .nullable()，不能用 .optional()）
    hard_gate_modes: z.array(z.string()).nullable(),
    // insertion_point：YAML 中显式为 null 或字符串
    insertion_point: z.string().nullable(),
  });

  /**
   * Gate 覆盖 Schema（overrides 文件中 gates 块，仅允许部分字段）
   * 只有 default_behavior / severity / hard_gate_modes 可被覆盖
   */
  gateOverrideSchema = z.object({
    // overrides 中的 default_behavior 允许 always/auto/on_failure/skip（与 gateDefinitionSchema 对齐）
    default_behavior: z.enum(['always', 'auto', 'on_failure', 'skip']).optional(),
    severity: z.enum(['critical', 'non_critical', 'warning', 'info']).optional(),
    // hard_gate_modes 整段替换，非追加
    hard_gate_modes: z.array(z.string()).optional(),
  }).strict();

  /**
   * 并行组 Schema（base orchestration.yaml 中 parallel_groups 块）
   */
  parallelGroupSchema = z.object({
    members: z.array(z.string()),
    convergence_point: z.string(),
    fallback_strategy: z.string(),
    max_concurrent: z.number().int().positive(),
    description: z.string(),
  });

  /**
   * 全局并行调度 Schema（base orchestration.yaml 中 parallel_scheduling 块）
   */
  parallelSchedulingSchema = z.object({
    max_concurrent_tasks: z.number().int().positive(),
    fallback_to_serial_on_failure: z.boolean(),
    fallback_reason_log: z.boolean(),
  });

  // ── 2. 依赖 phaseSchema 的中层 schema ──────────────────────

  /**
   * Mode 定义 Schema（base orchestration.yaml 中 modes 块）
   */
  modeDefinitionSchema = z.object({
    name: z.string(),
    description: z.string(),
    phases: z.array(phaseSchema).min(1, { message: 'phases 数组不能为空' }),
  });

  /**
   * Mode 覆盖 Schema（overrides 文件中 modes 块，整段替换语义）
   * 整段替换要求用户提供完整的 mode 定义（name/description/phases）
   * extends 字段为 MVP 预留：schema 接受但 resolver 不处理
   */
  modeOverrideSchema = z.object({
    name: z.string().optional(),         // 与 modeDefinitionSchema 保持一致（整段替换时合并进 mergedModes）
    description: z.string().optional(),  // 同上
    extends: z.string().optional(),      // 二期预留，MVP 接受但不处理
    // phases 的 agent_mode 在 override 场景下也接受额外值，或直接复用 phaseSchema
    phases: z.array(phaseSchema).min(0),
  }).strip();  // strip 未知字段（与整体 .strict() 策略一致；二期新增字段时在此处显式声明）

  // ── 3. 依赖多个子 schema 的顶层 schema ─────────────────────

  /**
   * orchestrationBaseSchema — 校验 plugin base orchestration.yaml
   *
   * 设计原则（FR-024 / R11）：先以现有 orchestration.yaml 内容为准定义 schema，
   * 确保现有文件 100% 通过 Zod 校验，再扩展为 overrides 使用。
   *
   * 字段清单（来自 orchestration.yaml 实际结构）：
   *   - version: string，必填
   *   - parallel_scheduling: 并行调度配置
   *   - gates: Record<GATE_ID, GateDefinition>
   *   - parallel_groups: Record<GROUP_ID, ParallelGroup>
   *   - modes: Record<ModeName, ModeDefinition>（所有 8 个模式）
   */
  orchestrationBaseSchema = z.object({
    version: z.string({ required_error: 'version 为必填字段' }),
    parallel_scheduling: parallelSchedulingSchema,
    gates: z.record(z.string(), gateDefinitionSchema),
    parallel_groups: z.record(z.string(), parallelGroupSchema),
    modes: z.record(z.string(), modeDefinitionSchema),
  });

  /**
   * orchestrationOverridesSchema — 校验项目级 .specify/orchestration-overrides.yaml
   *
   * 关键设计决策（GATE_DESIGN CL-001/010）：
   *   - version 必填（CL-008，resolver 比对 base version）
   *   - modes key 使用显式 z.object() 列出 8 个 mode（CL-001 enum 校验）
   *   - parallel_groups 字段：schema 接受但 transform 时 strip，发出 unsupported-field warning
   *   - $schema_version 和 modes.<m>.extends 字段：接受但 resolver 不特殊处理（FR-014）
   *
   * 注意：parallel_groups 由 resolver 步骤 6 手动检测并 strip；schema 层仅声明该字段以免被 .strict() 拒绝
   */
  orchestrationOverridesSchema = z.object({
    // 二期预留字段：schema 接受但 MVP resolver 不处理（FR-014）
    $schema_version: z.string().optional(),

    // version 必填（CL-008）——resolver 层做 base/overrides version 比对
    version: z.string({ required_error: 'overrides 文件必须包含 version 字段' }),

    // modes key 使用显式枚举——拒绝非 reserved name（CL-001，FR-007-A）
    // 非 reserved 名 → safeParse 返回 error → 触发 schema-fallback → 整体 overrides 降级到 base
    // 使用 .strict() 拒绝任何不在 8 个 reserved name 中的 mode key
    modes: z.object({
      feature: modeOverrideSchema.optional(),
      story: modeOverrideSchema.optional(),
      implement: modeOverrideSchema.optional(),
      fix: modeOverrideSchema.optional(),
      resume: modeOverrideSchema.optional(),
      sync: modeOverrideSchema.optional(),
      doc: modeOverrideSchema.optional(),
      refactor: modeOverrideSchema.optional(),
    }).strict({
      message: 'modes 字段包含非法的 mode 名称，合法值为 [feature|story|implement|fix|resume|sync|doc|refactor]',
    }).optional(),

    // gates 字段：Record<GATE_ID, GateOverride>，对象级字段合并
    // superRefine 落 FR-052 禁改集：禁改集与 gateId 绑定，而 gateOverrideSchema
    // 作为 record 的 value schema 看不到自己的 key，故校验只能挂在 record 这一层。
    gates: z.record(z.string(), gateOverrideSchema)
      .superRefine((gates, ctx) => {
        for (const violation of findForbiddenGateOverrides(gates)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [violation.gateId, violation.field],
            message: violation.message,
          });
        }
      })
      .optional(),

    // parallel_scheduling：标量覆盖
    parallel_scheduling: z.object({
      max_concurrent_tasks: z.number().int().positive().optional(),
      fallback_to_serial_on_failure: z.boolean().optional(),
      fallback_reason_log: z.boolean().optional(),
    }).optional(),

    // parallel_groups：MVP 不支持覆盖，schema 接受但 resolver 层 strip + warning
    // 不 reject 整个 overrides，其余合法字段照常生效（CL-010，FR-022）
    // 使用 z.record() 保留类型信息，同时接受任意结构；由 resolver 在 parse 前检测并 strip
    parallel_groups: z.record(z.string(), z.unknown()).optional(),
  }).strict({
    // 顶层真正未知字段使用 .strict() 策略拒绝（NFR-003）
    // 注意：parallel_groups 已显式声明，不会被 .strict() 拒绝
    message: 'overrides 文件包含未识别的顶层字段，请检查字段名称',
  });

  // ── 4. 别名（orchestrationMergedSchema === orchestrationBaseSchema）─

  /**
   * orchestrationMergedSchema — 校验合并后的 config
   *
   * 合并结果必须满足 base schema 的全部约束（FR-013）
   * 复用 orchestrationBaseSchema 实现 DRY 原则（NFR-006）
   */
  orchestrationMergedSchema = orchestrationBaseSchema;
}

// ── 末尾统一 export（ESM export const 不能进 if 块，故用末尾 export 语句）──
export {
  zodAvailable,
  phaseSchema,
  gateDefinitionSchema,
  gateOverrideSchema,
  modeDefinitionSchema,
  modeOverrideSchema,
  parallelGroupSchema,
  parallelSchedulingSchema,
  orchestrationBaseSchema,
  orchestrationOverridesSchema,
  orchestrationMergedSchema,
};
