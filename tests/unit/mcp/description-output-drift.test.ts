/**
 * F196 — MCP 工具 description Example Output 字段名防漂移守护
 *
 * 校验所有带 `Output: { ... }` 的 MCP 工具 description 所举的顶层字段名,
 * 都真实存在于该工具返回的顶层 key 集合中(子集断言)。F184 实测抓到 4 处
 * 字段名漂移(prepare 的 skeleton→skeletons、batch 的 generated/graphPath、
 * diff 的 drifts/newBehaviors/staleItems、panoramic 的 graph/overview),
 * 此前无任何自动化拦截层,本守护补齐该缺口。
 *
 * extractor 与 checker 均为 test-time 纯函数,co-locate 于本文件,不侵入 src/ 运行时产物。
 * 真值来源对 diff/prepare/batch 三个工具采用 producer 派生(Zod schema `.shape` +
 * 编译期 `as const satisfies (keyof T)[]`),其余 8 个工具采用 cited 手写真值列表。
 *
 * ──────────────────────────────────────────────────────────────────────────
 * KNOWN SCOPE LIMITATION (C2):
 * 本守护仅校验 description Example Output 的顶层字段名是否存在于真实返回的顶层 key 集合中。
 * 不校验:嵌套字段名、值类型、字段顺序、可选性语义。
 * 绿灯通过 ≠ 合约完全安全。嵌套 shape 一致性守护需独立的深度结构比对机制,
 * 属 out-of-scope,不在本 F196 修复范围内。
 *
 * 对 8 个 cited 手写工具(generate/panoramic-query/view_file/search_in_file/
 * list_directory/impact/context/detect_changes),本守护只可靠捕获 description 侧
 * 打错字(= F184 那 4 类历史漂移的真实形态),不可靠捕获 producer 侧改名。
 * ──────────────────────────────────────────────────────────────────────────
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  captured: [] as Array<{ name: string; description: string }>,
}));

// mock McpServer:捕获 server.tool(name, description, ...) 注册(含 graph/agent-context/file-nav 子注册)
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    constructor(..._args: unknown[]) {}
    tool(name: string, description: string): void {
      hoisted.captured.push({ name, description });
    }
  },
}));

import { createMcpServer } from '../../../src/mcp/server.js';
// producer 真值来源(只读 import,不调用、不触发副作用)
import { DriftReportSchema } from '../../../src/models/module-spec.js';
import type { PrepareResult } from '../../../src/core/single-spec-orchestrator.js';
import type { BatchResult } from '../../../src/batch/batch-orchestrator.js';

// ============================================================
// extractor:从 description 提取 Output 段顶层字段名
// ============================================================

/**
 * 提取 description 中 `Output: { ... }` 段内深度 0 的顶层 key 列表。
 *
 * 算法:从 `Output: {` 的 `{` 起逐字符扫描,用 depth/sqDepth 追踪花/方括号嵌套层,
 * 仅在 depth==1 && sqDepth==0 时收集标识符。顶层对象闭合(depth 归 0)即停止,
 * 正确忽略 panoramic 等工具 `}` 之后的尾随中文散文。
 *
 * 🔴 Codex C1:标识符匹配用 lookahead `(?=\s*[,:}\]])` 不消费分隔符 ,:}],
 * 否则末尾 key(如 `tokenUsage }`)会把闭合 `}` 一起吃掉,导致顶层闭合 STOP
 * 永不触发、扫描漏入尾随散文。匹配成功后 i 仅前进 match[1].length(只跳标识符本身),
 * 把后随分隔符留给下一轮循环交 depth/sqDepth 分支处理。
 *
 * ⚠️ 已知限制(quote-state):本 extractor 假定 Output 例子是**字段名 skeleton(无带引号的字符串值)**,
 * 不做 quote-state 解析。故 `Output: { a: "x}y", b }` 这类含字符串字面量(内部含 `}`/`{`)的写法会被
 * 字符串里的 `}` 误判为顶层闭合而解析错。当前 11 个工具的 Output 段均为纯字段 skeleton,安全;
 * 若未来引入带引号值的 Output 例子,需在扫描循环里补 quote-state 跳过引号内字符(当前无此场景,故不实现,避免过度工程)。
 */
function extractOutputTopLevelKeys(description: string): string[] {
  const marker = description.search(/Output:\s*\{/);
  if (marker === -1) return [];

  // 定位 marker 之后第一个 `{`
  const braceStart = description.indexOf('{', marker);
  if (braceStart === -1) return [];

  let depth = 0;
  let sqDepth = 0;
  const keys: string[] = [];
  const identRe = /^([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*[,:}\]])/;

  for (let i = braceStart; i < description.length; i++) {
    const char = description[i];

    if (char === '{') {
      depth++;
      continue;
    }
    if (char === '}') {
      depth--;
      if (depth === 0) break; // 顶层对象闭合,停止扫描(忽略尾随散文)
      continue;
    }
    if (char === '[') {
      sqDepth++;
      continue;
    }
    if (char === ']') {
      sqDepth--;
      continue;
    }

    // 仅在顶层对象内(非嵌套对象、非数组)收集 key
    if (depth === 1 && sqDepth === 0) {
      const match = identRe.exec(description.slice(i));
      if (match) {
        keys.push(match[1]);
        i += match[1].length - 1; // 只跳标识符本身;分隔符留给下一轮
      }
    }
  }

  return [...new Set(keys)]; // 去重
}

// ============================================================
// TRUTH 真值表(11 工具顶层 key 集合)
// ============================================================

// producer 派生 / 编译期绑定(3 个)
// 🔴 Codex C2:禁用 `{} as Record<keyof T, true>`(类型断言被擦除 → Object.keys 得空集 → 全表 false-positive)。
//    用 `[...] as const satisfies readonly (keyof T)[]`:satisfies 编译期校验每个元素是真实 keyof T。
//
// ⚠️ 守护层级说明(诚实表述,勿 over-claim):
//   1. `prepare`/`batch` 的 `as const satisfies readonly (keyof T)[]` 是**编译期断言**,理论上 producer
//      改名 → 字面量不再是 keyof T → tsc 报错。但本仓库 `build`/`lint`(根 tsconfig exclude tests)与
//      `typecheck:tests`(仅覆盖 type-tests/)**都不 type-check 本文件**,故此编译守护在 **CI 里休眠**,
//      仅 IDE / 手动 `tsc` 单独编译本文件时才生效。它是 **latent 防御 + 自文档化 producer 来源**,
//      不能宣称"producer 改名必然编译报错逼更新 TRUTH"——CI 不会拦。
//   2. **always-on 守护是 `npx vitest run` 跑的运行时子集检查**(Suite 2/3)——抓 description 侧字段名漂移
//      (= F184 那 4 类历史缺陷形态),这是 CI 真正强制的部分。
//   3. `diff` 的 `Object.keys(DriftReportSchema.shape)` 是**运行时**从 Zod schema 派生,是唯一被 CI 真正
//      强制的 producer-rename 闭合(producer 改名 → .shape 变 → TRUTH 自动跟随 → subset 立即生效)。

// src/core/single-spec-orchestrator.ts:131 (PrepareResult) — satisfies 编译期校验每个元素是真实 keyof
const PREPARE_TYPED = ['skeletons', 'mergedSkeleton'] as const satisfies readonly (keyof PrepareResult)[];
// src/batch/batch-orchestrator.ts:201 (BatchResult) — 只列 description 相关 key,无需枚举全部 20+ 字段
const BATCH_TYPED = ['successful', 'skipped', 'failed', 'indexGenerated'] as const satisfies readonly (keyof BatchResult)[];

const TRUTH: Record<string, readonly string[]> = {
  // 'detectedLanguages' 由 MCP handler 运行时附加(src/mcp/server.ts:117),不在 PrepareResult interface,单列
  prepare: [...PREPARE_TYPED, 'detectedLanguages'],
  // src/mcp/server.ts:158-164(JSON.stringify 内联字面量)
  generate: ['specPath', 'tokenUsage', 'confidence', 'warnings'],
  batch: BATCH_TYPED,
  // src/models/module-spec.ts:246(DriftReportSchema)— 运行时从 Zod schema 派生(纯 z.object,.shape 安全)
  diff: Object.keys(DriftReportSchema.shape),
  // src/panoramic/query.ts:63(natural-language 分支:answer/citations/tokenUsage/durationMs/fallbackMode)
  'panoramic-query': ['answer', 'citations', 'tokenUsage'],
  // src/mcp/file-nav-tools.ts:255-264(data 对象字段)
  view_file: ['lines', 'startLine', 'endLine', 'totalLines', 'truncated', 'nextStepHint'],
  // src/mcp/file-nav-tools.ts:314-321(data 对象字段)
  search_in_file: ['matches', 'totalMatches', 'nextStepHint'],
  // src/mcp/file-nav-tools.ts:353-360(data 对象字段)
  list_directory: ['entries', 'entryCount', 'nextStepHint'],
  // src/mcp/agent-context-tools.ts:251-265(data 对象字段)
  impact: ['affected', 'summary', 'topImpacted', 'nextStepHint'],
  // src/mcp/agent-context-tools.ts:365-408(data 对象字段)
  context: ['definition', 'callers', 'callees', 'imports', 'topRelevantCallers', 'nextStepHint'],
  // src/mcp/agent-context-tools.ts:636-651(data 对象字段)
  detect_changes: [
    'changedSymbols',
    'affectedSymbols',
    'riskSummary',
    'riskTier',
    'topImpacted',
    'nextStepHint',
  ],
};

// ============================================================
// checker + helpers
// ============================================================

function findTool(name: string): { name: string; description: string } | undefined {
  return hoisted.captured.find((t) => t.name === name);
}

/** 从 hoisted.captured 过滤出 description 含 `Output:` 的工具名(动态发现,禁止硬编码清单) */
function getOutputTools(): string[] {
  return hoisted.captured.filter((t) => t.description.includes('Output:')).map((t) => t.name);
}

/** 返回 extract(desc) 中不在 TRUTH[toolName] 的越界字段列表(空数组 = 无漂移) */
function checkSubset(toolName: string, desc: string): string[] {
  const truth = TRUTH[toolName];
  if (!truth) {
    throw new Error(`TRUTH 缺少工具 ${toolName} 的真值条目`);
  }
  const truthSet = new Set(truth);
  return extractOutputTopLevelKeys(desc).filter((k) => !truthSet.has(k));
}

beforeAll(() => {
  hoisted.captured.length = 0;
  createMcpServer();
});

// ============================================================
// Suite 1:extractor 单元测试(纯函数,不依赖 mock)
// ============================================================
describe('F196 Suite 1 — extractOutputTopLevelKeys 提取顶层字段名', () => {
  it('E-01 基本顶层 key 提取', () => {
    expect(extractOutputTopLevelKeys('Output: { answer, citations, tokenUsage }')).toEqual([
      'answer',
      'citations',
      'tokenUsage',
    ]);
  });

  it('E-02 嵌套数组对象跳过,只收顶层', () => {
    expect(
      extractOutputTopLevelKeys('Output: { matches: [{line, text}], totalMatches, nextStepHint }'),
    ).toEqual(['matches', 'totalMatches', 'nextStepHint']);
  });

  it('E-03 嵌套对象值跳过,只收顶层', () => {
    expect(extractOutputTopLevelKeys('Output: { summary: { a, b }, items }')).toEqual([
      'summary',
      'items',
    ]);
  });

  it('E-04 panoramic 尾随中文散文截止', () => {
    expect(
      extractOutputTopLevelKeys('Output: { answer, citations, tokenUsage }(其他 operation...)'),
    ).toEqual(['answer', 'citations', 'tokenUsage']);
  });

  it('E-05 无 Output 段返回空数组', () => {
    expect(extractOutputTopLevelKeys('Use this tool when you need foo. Example: bar')).toEqual([]);
  });

  it('E-06(C1 回归)顶层 } 后跟 ASCII token 不被误收', () => {
    // lookahead 不消费 },顶层闭合即 STOP;see/docs/more 必须被忽略
    expect(extractOutputTopLevelKeys('Output: { a, b }, see: docs and more')).toEqual(['a', 'b']);
  });
});

// ============================================================
// Suite 2:所有带 Output 工具 subset 断言(动态遍历,当前 description 必须全绿)
// ============================================================
// 注:不用 `it.each(getOutputTools())`——it.each 在 collection 期求值,那时 beforeAll 的
// createMcpServer() 还没跑、hoisted.captured 为空。必须在单个 it 的 test body 内(beforeAll 之后)遍历。
describe('F196 Suite 2 — 所有带 Output 工具 description ⊆ 真实返回顶层 key(动态遍历)', () => {
  it('每个动态发现的 Output 工具:Output 段可解析且顶层字段无漂移', () => {
    const outputTools = getOutputTools();
    expect(outputTools.length, '应动态发现到带 Output 的工具').toBeGreaterThan(0);
    const problems: string[] = [];
    for (const name of outputTools) {
      const tool = findTool(name);
      if (!tool) {
        problems.push(`${name}: 未注册`);
        continue;
      }
      const keys = extractOutputTopLevelKeys(tool.description);
      // 防 vacuous pass:带 Output: 但 Output 段无 {…} 结构时 extractor 返回空集 → subset 恒真 → 静默放行漂移;故强制每个 Output 工具必须解析出 ≥1 顶层 key
      if (keys.length === 0) {
        problems.push(`${name}: Output 段无法解析出顶层字段(malformed?缺 Output: {…})`);
        continue;
      }
      const offending = checkSubset(name, tool.description);
      if (offending.length > 0) {
        problems.push(`${name}: 越界字段 [${offending.join(', ')}](真值见 TRUTH['${name}'] 注释)`);
      }
    }
    expect(problems, `description Output 漂移/无法解析:\n${problems.join('\n')}`).toEqual([]);
  });
});

// ============================================================
// Suite 3:F184 历史漂移复现 fixture(证明 checker 会 flag)
// ============================================================
describe('F196 Suite 3 — F184 历史漂移 fixture 必须被 flag', () => {
  it('D-01 prepare 注入 skeleton(应为 skeletons 复数)被 flag', () => {
    const offending = checkSubset('prepare', 'Output: { skeleton, detectedLanguages }');
    expect(offending).toContain('skeleton');
  });

  it('D-02 batch 注入 generated/graphPath 被 flag', () => {
    const offending = checkSubset('batch', 'Output: { generated, skipped, graphPath }');
    expect(offending).toContain('generated');
    expect(offending).toContain('graphPath');
  });

  it('D-03 diff 注入 drifts/newBehaviors/staleItems 全部被 flag', () => {
    const offending = checkSubset('diff', 'Output: { drifts, newBehaviors, staleItems }');
    expect(offending).toContain('drifts');
    expect(offending).toContain('newBehaviors');
    expect(offending).toContain('staleItems');
  });

  it('D-04 panoramic-query 注入 graph/overview 被 flag', () => {
    const offending = checkSubset('panoramic-query', 'Output: { answer, graph, overview }');
    expect(offending).toContain('graph');
    expect(offending).toContain('overview');
  });
});

// ============================================================
// Suite 4:非误报(false-positive)fixture
// ============================================================
describe('F196 Suite 4 — 合法 description 不触发误报', () => {
  it('FP-01 嵌套数组对象不误报', () => {
    const desc = 'Output: { matches: [{line, text, before, after}], totalMatches, nextStepHint }';
    expect(checkSubset('search_in_file', desc)).toEqual([]);
  });

  it('FP-02 嵌套对象值不误报(走真实 checkSubset 路径)', () => {
    // view_file 真值含 lines/startLine/nextStepHint;顶层嵌套对象 { a, b } 的内层 a/b 应被 extractor 跳过,
    // 故 checkSubset 应返回空(若 extractor 错误收了 a/b,它们 ∉ TRUTH['view_file'] 会被 flag)
    const desc = 'Output: { lines: { a, b }, startLine, nextStepHint }';
    expect(checkSubset('view_file', desc)).toEqual([]);
  });

  it('FP-03 panoramic 真实尾随中文散文不误报', () => {
    const tool = findTool('panoramic-query');
    expect(tool, '工具 panoramic-query 应已注册').toBeDefined();
    // 真实 description 含 `}(其他 operation 返回各自结构,如 ... overview 返回分层视图)`——
    // 尾随散文里的 overview 不得被收(否则误判为漂移)
    expect(checkSubset('panoramic-query', tool!.description)).toEqual([]);
  });
});

// ============================================================
// Suite 5:完整性守护(防真值表覆盖漂移)
// ============================================================
describe('F196 Suite 5 — TRUTH 真值表完整性守护', () => {
  it('C-01 每个带 Output 的工具在 TRUTH 有条目(防漏新工具)', () => {
    const outputTools = getOutputTools();
    expect(outputTools.length, '应动态发现到带 Output 的工具').toBeGreaterThan(0);
    const missing = outputTools.filter((name) => !(name in TRUTH));
    expect(missing, `以下带 Output 的工具缺少 TRUTH 真值条目: ${missing.join(', ')}`).toEqual([]);
  });

  it('C-02 TRUTH 每条 key 对应真实带 Output 的工具(防 stale)', () => {
    const outputTools = getOutputTools();
    const stale = Object.keys(TRUTH).filter((name) => !outputTools.includes(name));
    expect(stale, `以下 TRUTH 条目对应的工具已无 Output 段(stale): ${stale.join(', ')}`).toEqual([]);
  });
});
