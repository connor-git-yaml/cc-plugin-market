import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 禁止在测试文件顶层静态 import 被测 schema 模块（否则 zodAvailable 会被首次加载固化为
// true，缺 zod 用例无法注入）。一律用例内动态 import + vi.resetModules() 防止 memoize 污染。
const ORCHESTRATION_SCHEMA_PATH = '../../plugins/spec-driver/contracts/orchestration-schema.mjs';
const LOAD_ZOD_PATH = '../../plugins/spec-driver/scripts/lib/load-zod.mjs';

// 9 个 schema 导出名（守卫化的全部 z.* schema；orchestrationMergedSchema 为别名）
const SCHEMA_EXPORT_NAMES = [
  'phaseSchema',
  'gateDefinitionSchema',
  'gateOverrideSchema',
  'modeDefinitionSchema',
  'modeOverrideSchema',
  'parallelGroupSchema',
  'parallelSchedulingSchema',
  'orchestrationBaseSchema',
  'orchestrationOverridesSchema',
  'orchestrationMergedSchema',
] as const;

interface ZodSchemaLike {
  safeParse: (input: unknown) => { success: boolean };
}

interface OrchestrationSchemaModule {
  zodAvailable: boolean;
  phaseSchema: ZodSchemaLike | null;
  gateDefinitionSchema: ZodSchemaLike | null;
  gateOverrideSchema: ZodSchemaLike | null;
  modeDefinitionSchema: ZodSchemaLike | null;
  modeOverrideSchema: ZodSchemaLike | null;
  parallelGroupSchema: ZodSchemaLike | null;
  parallelSchedulingSchema: ZodSchemaLike | null;
  orchestrationBaseSchema: ZodSchemaLike | null;
  orchestrationOverridesSchema: ZodSchemaLike | null;
  orchestrationMergedSchema: ZodSchemaLike | null;
  formatZodIssue: (issue: unknown) => string;
  BASE_RESERVED_MODE_NAMES: string[];
}

async function importOrchestrationSchema(): Promise<OrchestrationSchemaModule> {
  return (await import(ORCHESTRATION_SCHEMA_PATH)) as unknown as OrchestrationSchemaModule;
}

async function resetZodCache(): Promise<void> {
  const { __resetZodCacheForTest } = (await import(LOAD_ZOD_PATH)) as {
    __resetZodCacheForTest: () => void;
  };
  __resetZodCacheForTest();
}

describe('orchestration-schema.mjs — zod 在场（防回归）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('zodAvailable === true 且全部 9 个 schema 导出非 null', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.zodAvailable).toBe(true);
    for (const name of SCHEMA_EXPORT_NAMES) {
      expect(mod[name], `${name} 应为非 null schema`).not.toBeNull();
    }
  });

  it('formatZodIssue 可调用、BASE_RESERVED_MODE_NAMES 为非空数组', async () => {
    const mod = await importOrchestrationSchema();
    expect(typeof mod.formatZodIssue).toBe('function');
    expect(Array.isArray(mod.BASE_RESERVED_MODE_NAMES)).toBe(true);
    expect(mod.BASE_RESERVED_MODE_NAMES.length).toBeGreaterThan(0);
    expect(mod.BASE_RESERVED_MODE_NAMES).toContain('fix');
  });

  it('phaseSchema.safeParse 对合法 phase 返回 success: true（smoke）', async () => {
    const mod = await importOrchestrationSchema();
    const result = mod.phaseSchema!.safeParse({
      id: 'specify',
      name: 'specify',
      display_name: 'Specify',
      agent: null,
      agent_mode: 'single',
      gates_before: null,
      gates_after: null,
      conditional: null,
      skip_if_exists: null,
      is_critical: true,
    });
    expect(result.success).toBe(true);
  });

  it('orchestrationMergedSchema 与 orchestrationBaseSchema 为同一引用（别名）', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.orchestrationMergedSchema).toBe(mod.orchestrationBaseSchema);
  });
});

describe('orchestration-schema.mjs — 缺 zod 守卫降级（最高风险点）', () => {
  beforeEach(async () => {
    process.env.SPEC_DRIVER_FORCE_ZOD_MISSING = '1';
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('模块 import 不抛任何错（无 ReferenceError / MODULE_NOT_FOUND）', async () => {
    await expect(importOrchestrationSchema()).resolves.toBeDefined();
  });

  it('zodAvailable === false 且全部 9 个 schema 导出为 null', async () => {
    const mod = await importOrchestrationSchema();
    expect(mod.zodAvailable).toBe(false);
    for (const name of SCHEMA_EXPORT_NAMES) {
      expect(mod[name], `${name} 缺 zod 时应为 null`).toBeNull();
    }
  });

  it('formatZodIssue / BASE_RESERVED_MODE_NAMES 在缺 zod 时仍可访问（不进守卫）', async () => {
    const mod = await importOrchestrationSchema();
    expect(typeof mod.formatZodIssue).toBe('function');
    expect(Array.isArray(mod.BASE_RESERVED_MODE_NAMES)).toBe(true);
    expect(mod.BASE_RESERVED_MODE_NAMES).toContain('fix');
  });
});

describe('orchestration-schema.mjs — 导出 shape 稳定性（回归守护）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('全部预期导出名存在（无拼写错误导致的 undefined 导出）', async () => {
    const mod = await importOrchestrationSchema();
    const expectedExports = [
      ...SCHEMA_EXPORT_NAMES,
      'zodAvailable',
      'formatZodIssue',
      'BASE_RESERVED_MODE_NAMES',
    ];
    for (const name of expectedExports) {
      expect(
        Object.prototype.hasOwnProperty.call(mod, name),
        `导出 ${name} 应存在`,
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// FR-052 禁改集甲 / 乙（Feature 277 Phase A · T004）
//
// 甲：GATE_DESIGN 的 default_behavior 与 hard_gate_modes 一律不可被项目级
//     overrides 覆盖（不论覆盖成什么值）。
// 乙：GATE_TASKS.default_behavior 不得被覆盖为 auto / skip（always /
//     on_failure 仍可覆盖——二者都留有暂停路径）。
//
// 负向断言同时钉住「级别 ≥ error」：禁改集条目自带 level，resolver 据此发
// diagnostic；把 level 降为 warning 即等于让覆盖继续生效（spec FR-052 判未达成）。
// 正向断言防守护过宽：severity 与其余 gate 的三字段覆盖能力必须原样保留。
// ─────────────────────────────────────────────────────────────

interface ForbiddenGateOverrideViolation {
  gateId: string;
  field: string;
  value: unknown;
  level: string;
  message: string;
}

interface ForbiddenGateOverridesModule {
  FORBIDDEN_GATE_OVERRIDES: ReadonlyArray<{
    gateId: string;
    field: string;
    forbiddenValues: readonly string[] | null;
  }>;
  findForbiddenGateOverrides: (gatesOverride: unknown) => ForbiddenGateOverrideViolation[];
}

/** 构造一份除 gates 外全部合法的 overrides 文档 */
function buildOverridesDoc(gates: Record<string, unknown>): Record<string, unknown> {
  return { version: '1.0', gates };
}

describe('orchestration-schema.mjs — FR-052 禁改集甲/乙（负向）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  // 甲：不论覆盖成什么值都拒（F259 反模式「判据写成值枚举 ⇒ 每加一个值漏一次」）
  const forbiddenAlphaCases: Array<[string, Record<string, unknown>]> = [
    ['GATE_DESIGN.default_behavior = skip', { default_behavior: 'skip' }],
    ['GATE_DESIGN.default_behavior = auto', { default_behavior: 'auto' }],
    ['GATE_DESIGN.default_behavior = always（合法值也禁改）', { default_behavior: 'always' }],
    ['GATE_DESIGN.hard_gate_modes = []', { hard_gate_modes: [] }],
    ['GATE_DESIGN.hard_gate_modes = [story]（不含 feature）', { hard_gate_modes: ['story'] }],
    ['GATE_DESIGN.hard_gate_modes = [feature]（同值也禁改）', { hard_gate_modes: ['feature'] }],
  ];

  it.each(forbiddenAlphaCases)('甲：%s 被 overrides schema 拒绝', async (_label, gateOverride) => {
    const mod = await importOrchestrationSchema();
    const result = mod.orchestrationOverridesSchema!.safeParse(
      buildOverridesDoc({ GATE_DESIGN: gateOverride }),
    );
    expect(result.success).toBe(false);
  });

  // 乙：只禁抹掉暂停路径的两个取值
  const forbiddenBetaCases: Array<[string, string]> = [
    ['auto', 'auto'],
    ['skip', 'skip'],
  ];

  it.each(forbiddenBetaCases)('乙：GATE_TASKS.default_behavior = %s 被 overrides schema 拒绝', async (_label, value) => {
    const mod = await importOrchestrationSchema();
    const result = mod.orchestrationOverridesSchema!.safeParse(
      buildOverridesDoc({ GATE_TASKS: { default_behavior: value } }),
    );
    expect(result.success).toBe(false);
  });

  it('禁改集违规的级别为 error（不是 warning——warning 不阻断 ⇒ 覆盖仍生效）', async () => {
    const mod = (await importOrchestrationSchema()) as unknown as ForbiddenGateOverridesModule;
    const violations = mod.findForbiddenGateOverrides({
      GATE_DESIGN: { default_behavior: 'skip', hard_gate_modes: [] },
      GATE_TASKS: { default_behavior: 'auto' },
    });
    expect(violations.length).toBe(3);
    for (const v of violations) {
      expect(v.level, `${v.gateId}.${v.field} 的 diagnostic 级别必须是 error`).toBe('error');
    }
  });

  it('拒绝消息写出被拒字段路径与「改 spec 而非改覆盖」的迁移指引（宪法 XIII 留痕义务 b）', async () => {
    const mod = (await importOrchestrationSchema()) as unknown as ForbiddenGateOverridesModule;
    const [violation] = mod.findForbiddenGateOverrides({
      GATE_DESIGN: { default_behavior: 'skip' },
    });
    expect(violation).toBeDefined();
    // 字段路径必须逐字出现，用户据此定位自己 YAML 里的哪一行
    expect(violation.message).toContain('gates.GATE_DESIGN.default_behavior');
    // 迁移指引：正确做法是改 spec / base，而不是在项目级 overrides 里覆盖
    expect(violation.message).toContain('spec');
    expect(violation.message).toContain('orchestration-overrides.yaml');
  });

  it('禁改集表为 canonical 单一事实源（3 条：甲 2 + 乙 1）', async () => {
    const mod = (await importOrchestrationSchema()) as unknown as ForbiddenGateOverridesModule;
    expect(Array.isArray(mod.FORBIDDEN_GATE_OVERRIDES)).toBe(true);
    expect(mod.FORBIDDEN_GATE_OVERRIDES.length).toBe(3);
    const keys = mod.FORBIDDEN_GATE_OVERRIDES.map(e => `${e.gateId}.${e.field}`).sort();
    expect(keys).toEqual([
      'GATE_DESIGN.default_behavior',
      'GATE_DESIGN.hard_gate_modes',
      'GATE_TASKS.default_behavior',
    ]);
  });

  it('findForbiddenGateOverrides 对畸形输入不抛错（返回空清单，交由 schema 层报错）', async () => {
    const mod = (await importOrchestrationSchema()) as unknown as ForbiddenGateOverridesModule;
    for (const malformed of [null, undefined, 'str', 42, [], { GATE_DESIGN: null }, { GATE_DESIGN: 'x' }]) {
      expect(() => mod.findForbiddenGateOverrides(malformed)).not.toThrow();
      expect(mod.findForbiddenGateOverrides(malformed)).toEqual([]);
    }
  });
});

describe('orchestration-schema.mjs — FR-052 禁改集边界（正向 · 防守护过宽）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  afterEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  const allowedCases: Array<[string, Record<string, unknown>]> = [
    ['GATE_DESIGN.severity 仍可覆盖（gate 决策链上无消费方，禁改属越界收紧）',
      { GATE_DESIGN: { severity: 'critical' } }],
    ['GATE_TASKS.default_behavior = always 仍可覆盖（留有暂停路径）',
      { GATE_TASKS: { default_behavior: 'always' } }],
    ['GATE_TASKS.default_behavior = on_failure 仍可覆盖（留有暂停路径）',
      { GATE_TASKS: { default_behavior: 'on_failure' } }],
    ['GATE_TASKS.hard_gate_modes 不在禁改集（乙只禁 default_behavior 两值）',
      { GATE_TASKS: { hard_gate_modes: ['feature'] } }],
    ['其余 gate 的三字段覆盖能力不变（GATE_VERIFY 全字段覆盖）',
      { GATE_VERIFY: { default_behavior: 'skip', severity: 'info', hard_gate_modes: [] } }],
  ];

  it.each(allowedCases)('%s', async (_label, gates) => {
    const mod = await importOrchestrationSchema();
    const result = mod.orchestrationOverridesSchema!.safeParse(buildOverridesDoc(gates));
    expect(result.success).toBe(true);
  });

  it('applicable_modes 不进禁改集——它本就不在可覆盖字段内，拒绝理由仍是既有 .strict()', async () => {
    const mod = (await importOrchestrationSchema()) as unknown as ForbiddenGateOverridesModule;
    // 禁改集对它零命中：新守护没有把射程外的字段也拉进来
    expect(mod.findForbiddenGateOverrides({ GATE_DESIGN: { applicable_modes: ['feature'] } })).toEqual([]);

    // schema 仍拒绝它，但拒绝理由是 gateOverrideSchema 既有的 .strict()（unrecognized_keys），
    // 与本卡新增的禁改集无关——二者不得互相冒充。
    const schemaMod = await importOrchestrationSchema();
    const result = schemaMod.orchestrationOverridesSchema!.safeParse(
      buildOverridesDoc({ GATE_DESIGN: { applicable_modes: ['feature'] } }),
    ) as { success: boolean; error?: { issues: Array<{ code: string }> } };
    expect(result.success).toBe(false);
    expect(result.error!.issues.some(i => i.code === 'unrecognized_keys')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// base 锚定的门挂载可达性判据（Feature 277 Phase A 对抗修订 · α-C1 / α-C2 / α-C3）
//
// 修订前的判据是 isGateMountedInMode（纯结构存在性：某个 phase 的 gates_* 数组里有没有
// 这个字符串）。实测三类构造能在 resolver / FR-068 运行时守卫 / FR-053 事后守护
// 三道防线同时判绿的情况下，让门在整条流程里一次都不被求值：
//   α-C1 挂到 conditional 恒假的幽灵 phase
//   α-C2 挂到 skip_if_exists 恒真的幽灵 phase
//   α-C3 挂到序列末尾（门退化为事后追认）
// 下列用例把这三类构造逐条钉成红线。
// ═══════════════════════════════════════════════════════════════

interface MountAnchor {
  phase: string | null;
  side: string;
  index: number;
  conditional: unknown;
  skipIfExists: unknown;
  agent: unknown;
  agentMode: unknown;
}
interface MountViolation {
  kind: 'missing-anchor' | 'suppressor-added' | 'order-broken' | 'anchor-tuple-changed'
    | 'pre-anchor-phase-not-in-base' | 'mandatory-mode-missing';
  phase: string | null;
  side: string;
  detail: string;
}
interface MountEvaluation {
  mountedInBase: boolean;
  mounted: boolean;
  anchors: MountAnchor[];
  violations: MountViolation[];
}
interface GateMountingModule {
  collectGateMountAnchors: (config: unknown, mode: string, gateId: string) => MountAnchor[];
  evaluateGateMountingAgainstBase: (
    effectiveConfig: unknown, baseConfig: unknown, mode: string, gateId: string,
  ) => MountEvaluation;
  findLostGateMountings: (
    merged: unknown, base: unknown,
  ) => Array<{ mode: string; gateId: string; violations: MountViolation[] }>;
  isGateMountedInMode: (config: unknown, mode: string, gateId: string) => boolean;
  isModeReadable: (config: unknown, mode: string) => boolean;
  resolveGateMountingEnforcedModes: (config: unknown) => string[];
  findMissingMandatoryModes: (baseConfig: unknown) => string[];
  GATE_MOUNTING_MANDATORY_MODES: readonly string[];
  GATE_MOUNTING_ENFORCED_GATES: string[];
}

/** 造 phase：只写本判据关心的字段 */
function phase(
  name: string,
  mounts: { before?: string[] | null; after?: string[] | null } = {},
  suppressors: { conditional?: string | null; skip_if_exists?: string | null } = {},
  shape: { agent?: string | null; agent_mode?: string } = {},
): Record<string, unknown> {
  return {
    id: name,
    name,
    agent: shape.agent ?? null,
    agent_mode: shape.agent_mode ?? 'inline',
    gates_before: mounts.before ?? null,
    gates_after: mounts.after ?? null,
    conditional: suppressors.conditional ?? null,
    skip_if_exists: suppressors.skip_if_exists ?? null,
    is_critical: false,
  };
}

/** base 的 feature 骨架：gate_design 无条件挂 GATE_DESIGN，plan 带 skip_if_exists 也挂它 */
function buildBaseLike(): Record<string, unknown> {
  return {
    version: '1.0',
    gates: { GATE_DESIGN: { hard_gate_modes: ['feature'] }, GATE_TASKS: { hard_gate_modes: null } },
    modes: {
      feature: {
        name: 'f',
        description: 'f',
        phases: [
          phase('specify'),
          phase('gate_design', { after: ['GATE_DESIGN'] }),
          phase('plan', { before: ['GATE_DESIGN'] }, { skip_if_exists: 'plan.md' }),
          phase('tasks'),
          phase('implement', { before: ['GATE_TASKS'] }),
        ],
      },
      story: { name: 's', description: 's', phases: [phase('plan', { before: ['GATE_DESIGN'] })] },
      implement: { name: 'i', description: 'i', phases: [phase('plan', { before: ['GATE_DESIGN'] })] },
    },
  };
}

/** 深拷贝 base，供各变体就地改写 */
function cloneBase(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildBaseLike())) as Record<string, unknown>;
}

/** 取某 mode 的 phases 数组（测试内部用，避免到处写 as 断言） */
function phasesOf(config: Record<string, unknown>, mode: string): Array<Record<string, unknown>> {
  const modes = config.modes as Record<string, { phases: Array<Record<string, unknown>> }>;
  return modes[mode].phases;
}

async function importGateMounting(): Promise<GateMountingModule> {
  return (await import(ORCHESTRATION_SCHEMA_PATH)) as unknown as GateMountingModule;
}

describe('evaluateGateMountingAgainstBase — base 锚定的可达性判据', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('collectGateMountAnchors 逐 (phase.name, side) 收锚点并带上两个抑制开关快照', async () => {
    const mod = await importGateMounting();
    const anchors = mod.collectGateMountAnchors(buildBaseLike(), 'feature', 'GATE_DESIGN');
    expect(anchors.map(a => `${a.phase}.${a.side}`)).toEqual([
      'gate_design.gates_after', 'plan.gates_before',
    ]);
    // base 的 plan phase 自带 skip_if_exists —— 这是**合法锚点**，快照必须如实带上
    expect(anchors[1].skipIfExists).toBe('plan.md');
    expect(anchors[0].skipIfExists).toBeNull();
    // 判据 3（anchor-tuple-changed）要拿身份二元组与 base 逐字比对，故锚点必须带上它
    expect(anchors.map(a => [a.agent, a.agentMode])).toEqual([[null, 'inline'], [null, 'inline']]);
  });

  it('effective === base：零 violation，mounted 与 mounted_in_base 同为 true（合法覆盖不得误伤）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    for (const gateId of ['GATE_DESIGN', 'GATE_TASKS']) {
      const r = mod.evaluateGateMountingAgainstBase(cloneBase(), base, 'feature', gateId);
      expect(r.violations).toEqual([]);
      expect(r.mounted).toBe(true);
      expect(r.mountedInBase).toBe(true);
    }
  });

  it('base 的 plan phase 自带 skip_if_exists 且挂着门 —— 原样保留时不得判红（防守护过宽）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // 只确认这个前提在 fixture 里真实成立，再断言它不被判红
    expect(phasesOf(effective, 'feature')[2].skip_if_exists).toBe('plan.md');
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.violations).toEqual([]);
    expect(r.mounted).toBe(true);
  });

  it('α-C1：门改挂到 conditional 恒假的幽灵 phase → mounted=false（旧的结构存在性判据判 true）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    feature[1].gates_after = null;
    feature[2].gates_before = null;
    feature.unshift(phase('ghost_gate', { after: ['GATE_DESIGN'] }, { conditional: 'never_true_flag == true' }));

    // 旧判据（纯结构存在性）在同一份配置上判 true —— 这正是被绕过的那个抽象层次
    expect(mod.isGateMountedInMode(effective, 'feature', 'GATE_DESIGN')).toBe(true);

    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.mountedInBase).toBe(true);
    expect(r.violations.map(v => v.kind)).toEqual(['missing-anchor', 'missing-anchor']);
  });

  it('α-C1 变体：锚点 phase 原地被加上 conditional → suppressor-added', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    feature[1].conditional = 'never_true_flag == true';   // 只加抑制条件，门原样挂着
    feature[2].gates_before = null;                        // 另一个锚点摘掉，逼判据只看这一个

    expect(mod.isGateMountedInMode(effective, 'feature', 'GATE_DESIGN')).toBe(true);
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind).sort()).toEqual(['missing-anchor', 'suppressor-added']);
    expect(r.violations.find(v => v.kind === 'suppressor-added')!.phase).toBe('gate_design');
  });

  it('α-C2：锚点 phase 原地被加上 skip_if_exists → suppressor-added（抑制条件强于 base）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    feature[1].skip_if_exists = 'spec.md';
    feature[2].gates_before = null;

    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.some(v => v.kind === 'suppressor-added' && v.phase === 'gate_design')).toBe(true);
  });

  it('α-C2 反向：base 本就有 skip_if_exists 的锚点被**去掉**抑制 → 也判 suppressor-added（逐字相等，不是单向比较）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    phasesOf(effective, 'feature')[2].skip_if_exists = null;
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    // gate_design 锚点仍完好 ⇒ 整体仍 mounted，但 plan 锚点的偏离必须被如实记录
    expect(r.violations.map(v => `${v.kind}:${v.phase}`)).toEqual(['suppressor-added:plan']);
    expect(r.mounted).toBe(false);
  });

  it('α-C3：把 plan 移到 gate_design 之前 → order-broken（门必须仍在它把守的产出之前）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    const [planPhase] = feature.splice(2, 1);         // 取出 plan
    feature.unshift(planPhase);                       // 移到最前，gate_design 落到它之后

    expect(mod.isGateMountedInMode(effective, 'feature', 'GATE_DESIGN')).toBe(true);
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('order-broken');
    expect(r.violations.find(v => v.kind === 'order-broken')!.phase).toBe('gate_design');
  });

  it('α-C3 变体：门挪到序列末尾 → 锚点不在原位 ⇒ missing-anchor', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    feature[1].gates_after = null;
    feature[2].gates_before = null;
    feature[feature.length - 1].gates_after = ['GATE_DESIGN'];

    expect(mod.isGateMountedInMode(effective, 'feature', 'GATE_DESIGN')).toBe(true);
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.every(v => v.kind === 'missing-anchor')).toBe(true);
  });

  it('mountedInBase=false 时判据不适用：mounted 退回 effective 侧结构存在性，violations 为空', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    // base 的 feature 不挂 GATE_RESEARCH
    const none = mod.evaluateGateMountingAgainstBase(cloneBase(), base, 'feature', 'GATE_RESEARCH');
    expect(none.mountedInBase).toBe(false);
    expect(none.mounted).toBe(false);
    expect(none.violations).toEqual([]);

    // effective 自己加了一处挂载：诚实报 true（FR-068 的蕴含式此时前件为假，不受影响）
    const added = cloneBase();
    phasesOf(added, 'feature')[0].gates_after = ['GATE_RESEARCH'];
    const r = mod.evaluateGateMountingAgainstBase(added, base, 'feature', 'GATE_RESEARCH');
    expect(r.mountedInBase).toBe(false);
    expect(r.mounted).toBe(true);
  });

  it('取不到一律从严：phases 不是数组 / phase 缺 name 时判 violation，不得静默通过', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();

    const brokenPhases = cloneBase();
    (brokenPhases.modes as Record<string, Record<string, unknown>>).feature.phases = 'not-an-array';
    const r1 = mod.evaluateGateMountingAgainstBase(brokenPhases, base, 'feature', 'GATE_DESIGN');
    expect(r1.mounted).toBe(false);
    expect(r1.violations.length).toBeGreaterThan(0);

    const namelessBase = cloneBase();
    delete phasesOf(namelessBase, 'feature')[1].name;
    const r2 = mod.evaluateGateMountingAgainstBase(cloneBase(), namelessBase, 'feature', 'GATE_DESIGN');
    expect(r2.mounted).toBe(false);
    expect(r2.violations.some(v => v.kind === 'missing-anchor' && v.phase === null)).toBe(true);
  });

  it('findLostGateMountings 每 (mode, gate) 至多一条，且带上逐锚点的 violations 明细', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    const feature = phasesOf(effective, 'feature');
    feature[1].gates_after = null;
    feature[2].gates_before = null;

    const lost = mod.findLostGateMountings(effective, base);
    expect(lost.map(l => `${l.mode}.${l.gateId}`)).toEqual(['feature.GATE_DESIGN']);
    expect(lost[0].violations.length).toBe(2);
    expect(lost[0].violations.every(v => typeof v.detail === 'string' && v.detail.length > 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// β-C2 —— 强制 mode 清单的射程不得由被守护的那份配置决定
//
// 旧实现：`[...derived].filter(mode => baseModes[mode] !== undefined)`。
// 从 base 删掉 `modes.implement` 整段，`implement` 同时从「要检查的清单」和
// 「检查结果」里消失：resolver 少转两圈 ⇒ `violations = []`；`repo:check` 侧
// 断言数 12 → 9 且 `status = pass`（β-C2 实测）。
// ═══════════════════════════════════════════════════════════════

describe('强制 mode 射程的常量下界（β-C2 / β-W4）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  it('GATE_MOUNTING_MANDATORY_MODES 是冻结常量，恰为 feature / story / implement（FR-053 口径）', async () => {
    const mod = await importGateMounting();
    expect([...mod.GATE_MOUNTING_MANDATORY_MODES]).toEqual(['feature', 'story', 'implement']);
    expect(Object.isFrozen(mod.GATE_MOUNTING_MANDATORY_MODES)).toBe(true);
  });

  it('射程恒含三个强制 mode：传 null / 传空对象 / 传缺 mode 的配置都不缩小', async () => {
    const mod = await importGateMounting();
    const mandatory = [...mod.GATE_MOUNTING_MANDATORY_MODES].sort();
    for (const input of [null, undefined, {}, { modes: {} }, { gates: {} }]) {
      const scope = mod.resolveGateMountingEnforcedModes(input);
      expect(mandatory.every(m => scope.includes(m)), `射程缺 mode：${JSON.stringify(scope)}`).toBe(true);
    }
  });

  it('「减」方向 · base 删掉 modes.implement ⇒ 射程仍含 implement（旧实现在此静默剔除）', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    delete (base.modes as Record<string, unknown>).implement;
    expect(mod.resolveGateMountingEnforcedModes(base)).toContain('implement');
    expect(mod.findMissingMandatoryModes(base)).toEqual(['implement']);
  });

  it('「减」方向 · 三段全删 ⇒ findMissingMandatoryModes 列出三个，射程仍为三个', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    base.modes = {};
    expect(mod.findMissingMandatoryModes(base)).toEqual(['feature', 'implement', 'story']);
    expect(mod.resolveGateMountingEnforcedModes(base).sort())
      .toEqual(['feature', 'implement', 'story']);
  });

  it('派生只扩不缩：hard_gate_modes 新增的 mode 仍进射程（F259 反模式仍被覆盖）', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    (base.gates as Record<string, Record<string, unknown>>).GATE_DESIGN.hard_gate_modes = ['feature', 'refactor'];
    expect(mod.resolveGateMountingEnforcedModes(base)).toContain('refactor');
  });

  it('健康 base 的 findMissingMandatoryModes 为空（不得对干净配置误报）', async () => {
    const mod = await importGateMounting();
    expect(mod.findMissingMandatoryModes(buildBaseLike())).toEqual([]);
  });

  it('base 缺强制 mode ⇒ mountedInBase 按 true 代入 + mandatory-mode-missing 违规（不是空洞放行）', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    delete (base.modes as Record<string, unknown>).story;
    const effective = cloneBase();
    delete (effective.modes as Record<string, unknown>).story;

    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'story', 'GATE_DESIGN');
    expect(r.mountedInBase, 'FR-068 (3)：判不出一律按 true 代入，绝不按 false').toBe(true);
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toEqual(['mandatory-mode-missing']);

    // findLostGateMountings 必须把它当违规收上来（旧实现在此 continue 掉）
    const lost = mod.findLostGateMountings(effective, base);
    expect(lost.map(l => `${l.mode}.${l.gateId}`))
      .toEqual(['story.GATE_DESIGN', 'story.GATE_TASKS']);
  });

  it('β-C2 的 B8 形态 · base 删掉 story、overrides 把 story 补回来但零挂门 ⇒ 仍判违规', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    delete (base.modes as Record<string, unknown>).story;
    const effective = cloneBase();
    (effective.modes as Record<string, Record<string, unknown>>).story = {
      name: 's', description: 's', phases: [phase('implement'), phase('verify')],
    };
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'story', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toEqual(['mandatory-mode-missing']);
  });

  it('不误伤 · 非强制 mode 缺席 / 强制 mode 在场但没挂这道门 ⇒ mountedInBase=false 且零违规', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    // (a) 非强制 mode 整段缺席：resume 在 base 里根本不存在
    const a = mod.evaluateGateMountingAgainstBase(cloneBase(), base, 'resume', 'GATE_DESIGN');
    expect(a.mountedInBase).toBe(false);
    expect(a.violations).toEqual([]);
    // (b) 强制 mode 在场、但 base 本就不挂这道门（feature / GATE_RESEARCH）
    const b = mod.evaluateGateMountingAgainstBase(cloneBase(), base, 'feature', 'GATE_RESEARCH');
    expect(b.mountedInBase).toBe(false);
    expect(b.violations).toEqual([]);
    // (c) isModeReadable 分得清「段缺席」与「段在但没挂门」
    expect(mod.isModeReadable(base, 'feature')).toBe(true);
    expect(mod.isModeReadable(base, 'resume')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// δ-C1 / N-1 —— 判据不再按 phase 自身字段分类，只对照 base
//
// 第二轮的子句是「锚点之前不得出现 base **未定义名字**的**产出型** phase」，
// 其「产出型」谓词读 `name` / `agent` / `agent_mode` 三个**攻击者可写**的字段，
// 有三个逃逸口（复用 base 名字换 agent / `agent: null` 的 inline 产出 /
// `agent_mode: 'gate'` 但 agent 非空），每一个都能原样复现整条绕过。
// 现判据两条：3 锚点身份三元组相等（gates_after 侧连 agent_mode 一并钉死）；
// 4b 锚点前是 base 同段的子序列（按 (name, agent, agent_mode) 多重集，可删不可增不可改）。
// ═══════════════════════════════════════════════════════════════

describe('锚点身份与锚点前子序列（δ-C1 / 第三轮 N-1）', () => {
  beforeEach(async () => {
    delete process.env.SPEC_DRIVER_FORCE_ZOD_MISSING;
    vi.resetModules();
    await resetZodCache();
  });

  /** 在 mode 序列最前插入若干 phase */
  function prepend(config: Record<string, unknown>, mode: string, ...items: Array<Record<string, unknown>>) {
    const phases = phasesOf(config, mode);
    phases.unshift(...items);
    return config;
  }

  it('锚点之前插入 base 未定义的 phase ⇒ pre-anchor-phase-not-in-base（锚点一字未改）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = prepend(
      cloneBase(), 'feature',
      phase('plan_early', {}, {}, { agent: 'plan', agent_mode: 'single' }),
    );
    // 前提核实：锚点自身与 base 逐字相同，位序（base 名之间）也未变
    expect(phasesOf(effective, 'feature').map(p => p.name).slice(1))
      .toEqual(phasesOf(cloneBase(), 'feature').map(p => p.name));

    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
    expect(r.violations.find(v => v.kind === 'pre-anchor-phase-not-in-base')!.detail)
      .toMatch(/plan_early/);
  });

  it('F1 逃逸口已封 · 新 phase 的 agent 为 null（inline 步骤）同样判红', async () => {
    // 「inline 不产出制品」这条前提被 base 自己证伪：feature.research_synthesis /
    // online_research 都是 agent: null 且带 skip_if_exists（即自述会写出那个文件）。
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = prepend(
      cloneBase(), 'feature',
      phase('preflight_note', {}, { skip_if_exists: 'spec.md' }),
    );
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
    expect(r.violations.find(v => v.kind === 'pre-anchor-phase-not-in-base')!.detail)
      .toMatch(/preflight_note/);
  });

  it('F2 逃逸口已封 · 新 phase 的 agent_mode 为 gate 但 agent 非空，同样判红', async () => {
    // 守卫信 agent_mode、执行面读 agent —— 谓词与执行面不同源，这个不对称必须消掉。
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = prepend(
      cloneBase(), 'feature',
      phase('extra_gate', { after: ['GATE_DESIGN'] }, {}, { agent: 'plan', agent_mode: 'gate' }),
    );
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
  });

  it('S2 逃逸口已封 · 复用 base 已有名字（同名副本插到锚点前）也判红', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // specify 是 base 中该锚点之前那段里的合法成员，重数上界为 1；放两份即越界
    phasesOf(effective, 'feature').unshift(phase('specify'));
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted, '只比名字会让这条漏判').toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
  });

  it('S3 逃逸口已封 · 同名 phase 换掉 agent（名字仍在 base 里）也判红', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // base 的 specify 是 agent: null；改成 agent: plan 即换了一个东西在门之前跑
    phasesOf(effective, 'feature')[0].agent = 'plan';
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
  });

  it('判据 3 · gates_after 锚点自身的 agent 被换掉 ⇒ anchor-tuple-changed', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // gate_design 挂 gates_after：phase 体在门求值之前跑，换 agent = 门事后追认新产出
    phasesOf(effective, 'feature')[1].agent = 'plan';
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted).toBe(false);
    const v = r.violations.find(x => x.kind === 'anchor-tuple-changed');
    expect(v, JSON.stringify(r.violations)).toBeTruthy();
    expect(v!.phase).toBe('gate_design');
    expect(v!.side).toBe('gates_after');
  });

  it('判据 3 · gates_after 锚点的 agent_mode 被换掉 ⇒ 也判 anchor-tuple-changed', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    phasesOf(effective, 'feature')[1].agent_mode = 'single';
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.violations.some(v => v.kind === 'anchor-tuple-changed' && v.phase === 'gate_design')).toBe(true);
  });

  it('判据 3 的侧向不对称 · gates_before 锚点只改 agent_mode ⇒ 不判红（F201 goal_loop 的合法激活位）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // implement 挂 gates_before: [GATE_TASKS]，phase 体在该门求值之**后**才跑，
    // 改它的 agent_mode 移不动任何产出到门之前；这正是 goal-loop 模板唯一改的那个字段。
    const impl = phasesOf(effective, 'feature')[4];
    expect(impl.name).toBe('implement');
    expect(impl.gates_before).toEqual(['GATE_TASKS']);
    impl.agent_mode = 'goal_loop';
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_TASKS');
    expect(r.violations, JSON.stringify(r.violations)).toEqual([]);
    expect(r.mounted).toBe(true);
  });

  it('判据 3 · gates_before 锚点换 agent 仍判红（agent 在两侧都钉死）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    phasesOf(effective, 'feature')[4].agent = 'plan';
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_TASKS');
    expect(r.violations.some(v => v.kind === 'anchor-tuple-changed' && v.phase === 'implement')).toBe(true);
  });

  it('可删不可增 · 删掉锚点之前的 base phase（合法缩减）⇒ 零违规', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // 删掉 specify（gate_design 锚点之前唯一的 base phase）
    phasesOf(effective, 'feature').splice(0, 1);
    expect(phasesOf(effective, 'feature').map(p => p.name))
      .toEqual(['gate_design', 'plan', 'tasks', 'implement']);
    for (const gateId of ['GATE_DESIGN', 'GATE_TASKS']) {
      const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', gateId);
      expect(r.violations, `${gateId}: ${JSON.stringify(r.violations)}`).toEqual([]);
      expect(r.mounted).toBe(true);
    }
  });

  it('不误伤 · 新 phase 排在锚点之后 ⇒ 不判红（判据是「锚点之前」不是「序列里有」）', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    phasesOf(effective, 'feature').push(
      phase('extra_report', {}, {}, { agent: 'verify', agent_mode: 'single' }),
    );
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.violations).toEqual([]);
  });

  it('锚点前的新 phase 缺 name ⇒ 判不出从严，同样判红', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const nameless = phase('x', {}, {}, { agent: 'plan', agent_mode: 'single' });
    delete nameless.name;
    const effective = prepend(cloneBase(), 'feature', nameless);
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.violations.map(v => v.kind)).toContain('pre-anchor-phase-not-in-base');
  });

  it('同名重复：锚点位序取**首个**索引 —— base 后继的同名副本前移到锚点前即判 order-broken', async () => {
    const mod = await importGateMounting();
    const base = buildBaseLike();
    const effective = cloneBase();
    // base 里 tasks 位于 gate_design 之后；在序列最前放一个同名 tasks 副本
    phasesOf(effective, 'feature').unshift(phase('tasks'));
    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'feature', 'GATE_DESIGN');
    expect(r.mounted, '取最后一个索引会让这条漏判').toBe(false);
    expect(r.violations.map(v => v.kind)).toContain('order-broken');
    expect(r.violations.find(v => v.kind === 'order-broken')!.detail).toMatch(/tasks/);
  });

  it('N-3 · base 段读不出时 mounted 恒 false —— 不得回落到纯结构存在性', async () => {
    const mod = await importGateMounting();
    const base = cloneBase();
    delete (base.modes as Record<string, unknown>).story;
    const effective = cloneBase();
    // effective 把 story 补回来，并把门挂到一个 conditional 恒假的幽灵 phase 上：
    // isGateMountedInMode（纯结构存在性）对它答 true。
    (effective.modes as Record<string, Record<string, unknown>>).story = {
      name: 's',
      description: 's',
      phases: [phase('ghost', { after: ['GATE_DESIGN'] }, { conditional: 'never == true' })],
    };
    expect(mod.isGateMountedInMode(effective, 'story', 'GATE_DESIGN')).toBe(true);

    const r = mod.evaluateGateMountingAgainstBase(effective, base, 'story', 'GATE_DESIGN');
    expect(r.mountedInBase, 'FR-068 (3)：判不出按 true 代入').toBe(true);
    expect(r.mounted, '锚点无从取得 ⇒ 相对量判不出 ⇒ 不得答 true').toBe(false);
    expect(r.violations.map(v => v.kind)).toEqual(['mandatory-mode-missing']);
  });
});
