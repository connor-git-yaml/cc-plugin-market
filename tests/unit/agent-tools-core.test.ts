/**
 * FR-017 —— agent frontmatter 工具面守护（8 条断言）的行为契约。
 *
 * 换算式：正向 6（`specify` / `plan` / `tasks` 三份 agent × `Edit` / `Bash` 两个工具）
 *       + 护栏 1（`agents/verify.md` 的 `tools` 与冻结快照**逐字相等**）
 *       + 文本 1（协议文本对 verify 标注「不适用」且附 FR-016 (ii) 独立性口径声明）
 *       = 8，单位：断言条。与 SC-003 的分母同源。
 *
 * ⚠️ 本 Phase（A）的预期红：**文本断言的事实源 `agent-output-discipline.md`（共享块 1）
 * 由 Phase C 新建**，Phase A 时点它不存在，故 `文本断言` 用例预期红、Phase C 落地后转绿。
 * 本文件按**终态**写断言（期望绿），不写「期望它红」——否则 Phase C 落地时反而会红。
 * 该预期红已登记为偏差 D-9。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  PROTOCOL_TEXT_SOURCE,
  PROTOCOL_VERIFY_DISCLOSURE_PHRASES,
  REQUIRED_TOOLS,
  REQUIRED_TOOL_AGENTS,
  VERIFY_TOOLS_FROZEN_SNAPSHOT,
  evaluateAgentToolsAssertions,
  extractFrontmatterTools,
  validateAgentTools,
} from '../../scripts/lib/agent-tools-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

interface Assertion {
  id: string;
  kind: string;
  title: string;
  status: 'pass' | 'fail';
  detail: string;
}
interface FamilyResult {
  status: string;
  checks: Array<{ id: string; title: string; status: string; evidence: Record<string, unknown> }>;
  warnings: string[];
  errors: string[];
}

function assertionsOf(result: FamilyResult): Assertion[] {
  return (result.checks[0]?.evidence?.assertions ?? []) as Assertion[];
}

function byId(result: FamilyResult, id: string): Assertion | undefined {
  return assertionsOf(result).find((a) => a.id === id);
}

/** 用最小 frontmatter 合成一份 agent 文件 */
function writeAgent(root: string, name: string, tools: string[]) {
  const dir = path.join(root, 'plugins/spec-driver/agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}.md`),
    `---\nmodel: sonnet\ntools: [${tools.join(', ')}]\neffort: medium\n---\n\n# ${name}\n`,
    'utf-8',
  );
}

/** 合成一份满足文本断言的协议文本 */
function writeProtocolText(root: string, body?: string) {
  const target = path.join(root, PROTOCOL_TEXT_SOURCE as string);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    body ??
      [
        '# 分节输出协议',
        '',
        '## 不适用场景',
        '',
        '- `plugins/spec-driver/agents/verify.md`：协议对 verify **不适用**，且**不得为其新增任何工具项**；',
        '  verify 的 `tools` 无 `Write` / `Edit` 但**持有 `Bash`**，写能力未在工具层封闭，',
        '  只读性属**自律而非强制**，独立性一律登记为**未取得**。',
        '',
      ].join('\n'),
    'utf-8',
  );
}

/** 合成一个「除待测点外全部合格」的 scratch 项目根 */
function makeHappyRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-tools-'));
  for (const agent of REQUIRED_TOOL_AGENTS as string[]) {
    writeAgent(root, agent, ['Read', 'Write', 'Grep', 'Glob', ...(REQUIRED_TOOLS as string[])]);
  }
  writeAgent(root, 'verify', [...(VERIFY_TOOLS_FROZEN_SNAPSHOT as string[])]);
  writeProtocolText(root);
  return root;
}

describe('agent-tools-core —— 断言集构成（FR-017）', () => {
  it('恰好 8 条断言，且构成 = 正向 6 + 护栏 1 + 文本 1', () => {
    const root = makeHappyRoot();
    try {
      const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
      const assertions = assertionsOf(result);
      expect(assertions).toHaveLength(8);
      expect(assertions.filter((a) => a.kind === 'required-tool')).toHaveLength(6);
      expect(assertions.filter((a) => a.kind === 'guard')).toHaveLength(1);
      expect(assertions.filter((a) => a.kind === 'text')).toHaveLength(1);
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].id).toBe('required');
      expect(result.status).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('agent-tools-core —— 对本仓现状的 8 条断言', () => {
  let result: FamilyResult;

  beforeEach(() => {
    result = validateAgentTools({ projectRoot: REPO_ROOT }) as FamilyResult;
  });

  // 正向 6 条：T017 ~ T019 改 frontmatter 之前必须全红（T016 红灯取证的机器面）
  for (const agent of REQUIRED_TOOL_AGENTS as string[]) {
    for (const tool of REQUIRED_TOOLS as string[]) {
      it(`正向 · agents/${agent}.md 的 tools 含 ${tool}`, () => {
        const a = byId(result, `tools:${agent}:${tool}`);
        expect(a, `断言 tools:${agent}:${tool} 缺席`).toBeDefined();
        expect(a!.status, a!.detail).toBe('pass');
      });
    }
  }

  it('护栏 · agents/verify.md 的 tools 与冻结快照逐字相等（FR-016 (i)）', () => {
    const a = byId(result, 'verify:tools-frozen');
    expect(a, '护栏断言缺席').toBeDefined();
    expect(a!.status, a!.detail).toBe('pass');
  });

  // ⚠️ Phase A 预期红（偏差 D-9）：事实源 `agent-output-discipline.md` 由 Phase C 新建。
  it('文本 · 协议文本对 verify 标注「不适用」且附独立性口径声明（FR-017 (iii)）', () => {
    const a = byId(result, 'protocol:verify-not-applicable-disclosure');
    expect(a, '文本断言缺席').toBeDefined();
    expect(a!.status, a!.detail).toBe('pass');
  });
});

describe('agent-tools-core —— 变异体：每条断言各自可被打红', () => {
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  function scratch(): string {
    const root = makeHappyRoot();
    roots.push(root);
    return root;
  }

  it('变异 · specify 缺 Edit ⇒ 仅该条红，其余 7 条仍绿', () => {
    const root = scratch();
    writeAgent(root, 'specify', ['Read', 'Write', 'Grep', 'Glob', 'Bash']);
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const failed = assertionsOf(result).filter((a) => a.status === 'fail');
    expect(failed.map((a) => a.id)).toEqual(['tools:specify:Edit']);
    expect(result.status).toBe('fail');
    expect(result.errors.join('\n')).toMatch(/specify/);
  });

  it('变异 · tasks 缺 Bash ⇒ 仅该条红', () => {
    const root = scratch();
    writeAgent(root, 'tasks', ['Read', 'Write', 'Grep', 'Glob', 'Edit']);
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    expect(assertionsOf(result).filter((a) => a.status === 'fail').map((a) => a.id))
      .toEqual(['tools:tasks:Bash']);
  });

  it('变异 · agent 文件整份缺失 ⇒ 该 agent 两条红（判不出从严，不因读不到而放行）', () => {
    const root = scratch();
    rmSync(path.join(root, 'plugins/spec-driver/agents/plan.md'));
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    expect(assertionsOf(result).filter((a) => a.status === 'fail').map((a) => a.id))
      .toEqual(['tools:plan:Edit', 'tools:plan:Bash']);
  });

  it('变异 · verify.md 新增 Write ⇒ 护栏红（改前两个既有守护项都报不出的那个量）', () => {
    const root = scratch();
    writeAgent(root, 'verify', [...(VERIFY_TOOLS_FROZEN_SNAPSHOT as string[]), 'Write']);
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const a = byId(result, 'verify:tools-frozen')!;
    expect(a.status).toBe('fail');
    expect(a.detail).toMatch(/Write/);
  });

  it('变异 · verify.md 新增一个非写面工具也红（FR-017 (ii) 是「不得新增任何工具项」）', () => {
    const root = scratch();
    writeAgent(root, 'verify', [...(VERIFY_TOOLS_FROZEN_SNAPSHOT as string[]), 'WebFetch']);
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    expect(byId(result, 'verify:tools-frozen')!.status).toBe('fail');
  });

  // β-C1 口径变化：判据由「单向集合差（只判新增）」改为「与冻结快照逐字相等」。
  // 删减不再只进 detail 附注——它同时是「解析器读残」最常见的观测形态，
  // 而那正是让护栏空洞成立的那条路径。
  it('变异 · verify.md 删掉一项工具也判红（逐字相等：删减 = 失去比对基准）', () => {
    const root = scratch();
    writeAgent(root, 'verify', (VERIFY_TOOLS_FROZEN_SNAPSHOT as string[]).slice(0, 3));
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const a = byId(result, 'verify:tools-frozen')!;
    expect(a.status).toBe('fail');
    expect(a.detail).toMatch(/删减/);
  });

  it('变异 · verify.md 仅调换两项顺序也判红（逐字相等含顺序）', () => {
    const root = scratch();
    const swapped = [...(VERIFY_TOOLS_FROZEN_SNAPSHOT as string[])];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const result0 = validateAgentTools({ projectRoot: root }) as FamilyResult;
    expect(byId(result0, 'verify:tools-frozen')!.status).toBe('pass');   // 改之前是绿的
    writeAgent(root, 'verify', swapped);
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const a = byId(result, 'verify:tools-frozen')!;
    expect(a.status).toBe('fail');
    expect(a.detail).toMatch(/顺序或重复度/);
  });

  it('变异 · 协议文本缺独立性口径声明 ⇒ 文本断言红（缺声明即 FAIL）', () => {
    const root = scratch();
    writeProtocolText(
      root,
      ['# 分节输出协议', '', '## 不适用场景', '', '- `agents/verify.md`：协议对 verify 不适用。', ''].join('\n'),
    );
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const a = byId(result, 'protocol:verify-not-applicable-disclosure')!;
    expect(a.status).toBe('fail');
    expect(a.detail).toMatch(/未取得/);
  });

  it('变异 · 协议文本整份缺席 ⇒ 文本断言红且 detail 指名事实源路径', () => {
    const root = scratch();
    rmSync(path.join(root, PROTOCOL_TEXT_SOURCE as string));
    const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
    const a = byId(result, 'protocol:verify-not-applicable-disclosure')!;
    expect(a.status).toBe('fail');
    expect(a.detail).toContain(PROTOCOL_TEXT_SOURCE);
  });
});

describe('agent-tools-core —— FR-045：catch 分支不得返回空结果或 pass', () => {
  it('纯函数拿到全 undefined 输入时 8 条全红，不返回空数组', () => {
    const assertions = evaluateAgentToolsAssertions({
      toolsByAgent: undefined,
      verifyTools: undefined,
      protocolText: undefined,
    }) as Assertion[];
    expect(assertions).toHaveLength(8);
    expect(assertions.every((a) => a.status === 'fail')).toBe(true);
  });

  it('projectRoot 完全不存在时判 fail 并把原因写进 evidence，不判 pass', () => {
    const result = validateAgentTools({
      projectRoot: path.join(tmpdir(), 'agent-tools-nonexistent-root-277'),
    }) as FamilyResult;
    expect(result.status).toBe('fail');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('护栏比对源是钉入守护项源码的落地时快照，不是运行时自取（FR-016 护栏的前提）', () => {
    expect(VERIFY_TOOLS_FROZEN_SNAPSHOT).toEqual([
      'Read',
      'Bash',
      'Grep',
      'Glob',
      'mcp__plugin_spectra_spectra__detect_changes',
      'mcp__plugin_spectra_spectra__impact',
    ]);
    expect(Object.isFrozen(VERIFY_TOOLS_FROZEN_SNAPSHOT)).toBe(true);
  });

  it('文本断言的短语契约是具名导出，Phase C 有机器可读的落地目标', () => {
    expect(Array.isArray(PROTOCOL_VERIFY_DISCLOSURE_PHRASES)).toBe(true);
    expect((PROTOCOL_VERIFY_DISCLOSURE_PHRASES as string[]).length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// 重复 tools: 键的诱饵行（Phase A 对抗审查 α-W2）
//
// 取值规则原本是「行内优先、其次块状、各取第一个」，与任何符合规范的 YAML
// 语义都不同（后者要么报错、要么末键胜出），实测连文档顺序都不看。于是
// 「先放一份与冻结快照同集的行内数组当诱饵、再用块状序列把工具面扩到含
// Write / Edit」能让 verify:no-added-tools 判绿。歧义文档一律判红。
// ═══════════════════════════════════════════════════════════════

describe('agent-tools-core —— 重复 tools: 键判红（α-W2）', () => {
  /** 写一份带两个 tools: 键的 agent（诱饵行内数组在前、真实块状序列在后） */
  function writeDecoyAgent(root: string, name: string, decoy: string[], real: string[]) {
    const dir = path.join(root, 'plugins/spec-driver/agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${name}.md`),
      `---\nmodel: sonnet\ntools: [${decoy.join(', ')}]\ntools:\n`
        + real.map((t) => `  - ${t}\n`).join('')
        + `effort: medium\n---\n\n# ${name}\n`,
      'utf-8',
    );
  }

  it('verify.md 用诱饵行内数组掩护块状序列扩权 → 守护项判 fail（不得判 pass）', () => {
    const root = makeHappyRoot();
    try {
      writeDecoyAgent(
        root, 'verify',
        VERIFY_TOOLS_FROZEN_SNAPSHOT as string[],          // 诱饵：与冻结快照同集
        ['Read', 'Bash', 'Write', 'Edit'],                  // 真实声明：把写能力放进来
      );
      const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
      expect(result.status).toBe('fail');
      expect(result.errors.join('\n')).toMatch(/tools/);
      expect(result.errors.join('\n')).toMatch(/歧义|拒绝解析|不受支持/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('正向 agent 的诱饵同样判红（不是只护住 verify 一份）', () => {
    const root = makeHappyRoot();
    try {
      // 诱饵满足全部正向断言、真实声明缺 Edit / Bash：旧解析器取诱饵 ⇒ 判绿
      writeDecoyAgent(
        root, (REQUIRED_TOOL_AGENTS as string[])[0],
        ['Read', 'Write', 'Grep', 'Glob', ...(REQUIRED_TOOLS as string[])],
        ['Read'],
      );
      const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
      expect(result.status).toBe('fail');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('单个 tools: 键（行内或块状）照常解析，不得误伤', () => {
    const root = makeHappyRoot();
    try {
      const dir = path.join(root, 'plugins/spec-driver/agents');
      // 块状序列形态的 verify.md：内容与冻结快照同集
      writeFileSync(
        path.join(dir, 'verify.md'),
        '---\nmodel: sonnet\ntools:\n'
          + (VERIFY_TOOLS_FROZEN_SNAPSHOT as string[]).map((t) => `  - ${t}\n`).join('')
          + 'effort: medium\n---\n\n# verify\n',
        'utf-8',
      );
      const result = validateAgentTools({ projectRoot: root }) as FamilyResult;
      expect(result.status).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// β-C1 / α-W2 三变体 —— 「解析器读不全」不得再被消费成一个确定的观测值
//
// 旧实现：无 frontmatter / 无 tools 键 / 取值正则不匹配 ⇒ 返回 `[]`；
//         块序列遇首个不匹配行**静默截断**，其后条目丢弃。
// 旧护栏：`added = 实测 \ 冻结快照`，`added.length === 0` 即 pass ——
//         对空集与真子集**恒真**，于是「解析器失效」与「确实零新增」是同一个观测值。
// 实测（scratchpad/p_bc1.mjs，旧解析器按 `git show HEAD:` 逐字复刻）：
//         下列 12 组构造在**旧解析器 + 旧护栏**下全部 pass，其中 M4 / M4b / T1~T3 /
//         b1 / b2 的文件里逐字写着 Write / Edit。修后 16 组全部 fail，两组规范写法仍 pass。
// T4~T7 是**只有解析器 fail-loud 能挡**的一类：截断后的前缀逐字等于冻结快照，
//         逐字相等护栏对它同样判绿（变异体 M-βC1c 实证）。
// ═══════════════════════════════════════════════════════════════

describe('agent-tools-core —— 解析器读不全的 16 组构造一律判红（β-C1 / α-W2）', () => {
  const SNAP = VERIFY_TOOLS_FROZEN_SNAPSHOT as string[];
  let roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  /** 直接写 verify.md 的原始字节（绕开 writeAgent 的规范 frontmatter）*/
  function writeVerifyRaw(root: string, content: string) {
    const dir = path.join(root, 'plugins/spec-driver/agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'verify.md'), content, 'utf-8');
  }

  function verdict(content: string): FamilyResult {
    const root = makeHappyRoot();
    roots.push(root);
    writeVerifyRaw(root, content);
    return validateAgentTools({ projectRoot: root }) as FamilyResult;
  }

  const fm = (body: string) => `---\nmodel: sonnet\n${body}effort: medium\n---\n\n# verify\n`;

  const constructs: Array<[string, string]> = [
    // 第一类：旧解析器完全读不出（返回 []）
    ['M1 删掉 tools: 键', fm('model2: x\n')],
    ['M2 整个 frontmatter 删掉', '# verify\n\ntools: [Read, Write, Edit]\n'],
    ['M3 tools: []（空表 ≠ 冻结快照）', fm('tools: []\n')],
    ['M4 frontmatter 前多一个空行', `\n${fm('tools: [Read, Write, Edit, Bash, Task]\n')}`],
    ['M4b 文件带 UTF-8 BOM', `\uFEFF${fm('tools: [Read, Write, Edit, Bash, Task]\n')}`],
    ['M5 tools 写成 mapping', fm('tools:\n  Read: true\n  Write: true\n')],
    // 第二类：旧解析器静默截断（Write / Edit 落在截断之后）
    ['T1 块序列中间插空序列项', fm(`tools:\n  - Read\n  - ${SNAP[4]}\n  -\n  - Write\n  - Edit\n`)],
    ['T2 块序列中间插注释行', fm(`tools:\n  - Read\n  - ${SNAP[4]}\n  # 与冻结快照同步\n  - Write\n  - Edit\n`)],
    ['T3 块序列中间插空行', fm(`tools:\n  - Read\n  - ${SNAP[4]}\n\n  - Write\n  - Edit\n`)],
    // δ 三变体：α-W2 的重复键计数结构性覆盖不到的写法
    ['b1 tools :（冒号前一个空格）', fm(`tools: [${SNAP.join(', ')}]\ntools :\n  - Read\n  - Bash\n  - Write\n  - Edit\n`)],
    ['b2 "tools":（引号键）', fm(`tools: [${SNAP.join(', ')}]\n"tools":\n  - Read\n  - Write\n  - Edit\n`)],
    ['b3 tools: 后接行内注释（单键，无重复）', fm('tools:   # 与冻结快照保持同步\n  - Read\n  - Bash\n  - Write\n  - Edit\n')],
    // ⚠️ 第三类：**截断后的前缀恰好等于冻结快照**——只有这一类能同时骗过
    // 「逐字相等」护栏。前 6 项逐字就是快照，Write / Edit 落在 gap 之后；
    // 静默截断的解析器读到的正是快照本身 ⇒ 逐字相等成立 ⇒ pass。
    // 故「遇不可归类行即 throw」这条是独立承重的，不能由护栏兜掉。
    ['T4 截断前缀 == 冻结快照 · gap 是空行',
      fm(`tools:\n${SNAP.map((t) => `  - ${t}\n`).join('')}\n  - Write\n  - Edit\n`)],
    ['T5 截断前缀 == 冻结快照 · gap 是注释行',
      fm(`tools:\n${SNAP.map((t) => `  - ${t}\n`).join('')}  # 以下为附加工具\n  - Write\n  - Edit\n`)],
    ['T6 截断前缀 == 冻结快照 · gap 是空序列项',
      fm(`tools:\n${SNAP.map((t) => `  - ${t}\n`).join('')}  -\n  - Write\n  - Edit\n`)],
    ['T7 截断前缀 == 冻结快照 · 末项带行内注释掩护',
      fm(`tools:\n${SNAP.slice(0, -1).map((t) => `  - ${t}\n`).join('')}  - ${SNAP[SNAP.length - 1]}  # keep\n  - Write\n`)],
  ];

  for (const [name, content] of constructs) {
    it(`${name} ⇒ 守护项判 fail（旧实现在此判 pass）`, () => {
      const result = verdict(content);
      expect(result.status, `构造「${name}」被判 pass`).toBe('fail');
      expect(result.errors.length).toBeGreaterThan(0);
      // 护栏断言要么自己红，要么整族走 catch（解析器 throw）——两条都不得是 pass
      const guard = byId(result, 'verify:tools-frozen');
      if (guard) expect(guard.status).toBe('fail');
    });
  }

  it('对照 · 两种规范写法（行内 / 块序列）仍 pass，不得误伤', () => {
    const inline = verdict(fm(`tools: [${SNAP.join(', ')}]\n`));
    expect(inline.status, JSON.stringify(inline.errors)).toBe('pass');
    const blockSeq = verdict(fm(`tools:\n${SNAP.map((t) => `  - ${t}\n`).join('')}`));
    expect(blockSeq.status, JSON.stringify(blockSeq.errors)).toBe('pass');
  });

  it('解析器三分返回值：null（无 tools 键）/ 抛错（写法不受支持）/ 完整数组', () => {
    expect(extractFrontmatterTools(fm('model2: x\n'))).toBeNull();
    expect(extractFrontmatterTools('# 没有 frontmatter\n')).toBeNull();
    expect(() => extractFrontmatterTools(fm('tools:   # 注释\n  - Read\n'))).toThrow(/不受支持/);
    expect(extractFrontmatterTools(fm('tools: [Read, Bash]\n'))).toEqual(['Read', 'Bash']);
    // 读出的空表是一个确定观测值，不是「读不出」——它与 null 必须可区分
    expect(extractFrontmatterTools(fm('tools: []\n'))).toEqual([]);
  });
});
