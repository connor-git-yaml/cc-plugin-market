/**
 * Feature 151 T-007 — 4 阶段 call resolver（语言无关共享抽象，FR-2 + CL-04 + Codex C-4 修订）
 *
 * 输入：CallSite[]（含 callerFile）+ CodeSkeleton Map
 * 输出：UnifiedEdge[]（仅 calls 类型）
 *
 * 4 阶段流水线：
 * - Stage 1 (free)：calleeKind=free 且 callee 在同模块 export → high
 * - Stage 2 (member)：self.x / Class.x，必须验证 callee 在 class.members 才 high；
 *   类存在但方法在 MRO 父类 → medium；类无法定位 → medium 占位（Codex C-4 修订）
 * - Stage 3 (cross-module)：import 表查找；非通配 → medium，import * → low
 * - Stage 4 (super / unresolved)：super().method MRO 解析 ≤8 层 → low；
 *   dunder / decorator / 全部 fallthrough → low；dynamic call → 不输出（skip）
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { CallSite } from '../models/call-site.js';
import type { ConfidenceTier, UnifiedEdge } from './unified-graph.js';

// ───────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────

/**
 * 带 callerFile 上下文的 CallSite — call-resolver 的输入单元。
 *
 * 各 mapper 在 collectCallSites 阶段附加 callerFile（CodeSkeleton.filePath），
 * 让 resolver 能定位 caller 所在模块并进行 cross-module / member 解析。
 */
export interface CallSiteWithFile extends CallSite {
  callerFile: string;
}

/**
 * Stage 决策表（plan §3.2）：
 *
 * | Stage | 条件 | confidence |
 * |-------|------|-----------|
 * | 1 free | calleeKind=free 且 callee 在同模块 export | high |
 * | 2 member（双重验证）| className 在 moduleSymbol + callee 在 classMember | high |
 * | 2 member（MRO 父类命中）| 自身 members 不含但 ≤8 层 MRO 父类含 | medium |
 * | 2 member（占位）| 类可定位但 callee 既不在自身也不在 MRO | medium 占位 |
 * | 2 member（类无法定位）| className 缺失或未导出 | medium |
 * | 3 cross-module | import 表命中（非 star） | medium |
 * | 3 cross-module（import \*）| 通配 import | low |
 * | 4 super MRO | super() 且 ≤8 层 MRO 命中 | low |
 * | 4 unresolved | dunder / decorator / 全部 fallthrough | low |
 * | dynamic call | mapper 抽取层 skip，resolver 兜底 null | null（skip）|
 */
export function resolveCalls(
  callSites: ReadonlyArray<CallSiteWithFile>,
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): UnifiedEdge[] {
  // 预构建 4 个一次性索引（性能优化 + 算法清晰度）
  const moduleSymbolIndex = buildModuleSymbolIndex(codeSkeletons);
  const classMemberIndex = buildClassMemberIndex(codeSkeletons);
  const importIndex = buildImportIndex(codeSkeletons);
  const classMroIndex = buildClassMroIndex(codeSkeletons);

  const edges: UnifiedEdge[] = [];
  for (const cs of callSites) {
    const edge = resolveOne(cs, {
      moduleSymbolIndex,
      classMemberIndex,
      importIndex,
      classMroIndex,
    });
    if (edge) edges.push(edge);
  }
  return edges;
}

// ───────────────────────────────────────────────────────────
// 索引构建（一次性，按 codeSkeletons 派生）
// ───────────────────────────────────────────────────────────

interface ResolverIndices {
  /** file → Set<exportName>，含模块顶层 callable */
  moduleSymbolIndex: ReadonlyMap<string, ReadonlySet<string>>;
  /** "file::ClassName" → Set<methodName>，含类成员（method/staticmethod/classmethod 等）*/
  classMemberIndex: ReadonlyMap<string, ReadonlySet<string>>;
  /** file → ImportInfo，承载 import 解析（含 import * 标记） */
  importIndex: ReadonlyMap<string, ImportInfo>;
  /** "file::ClassName" → string[]，简化版 MRO（仅 superclass 名字，按定义序）*/
  classMroIndex: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface ImportInfo {
  /** 别名（含 default / namedImports / 通配 *）→ 解析后的 target 文件路径或 null */
  aliasToTarget: ReadonlyMap<string, string | null>;
  /** 哪些 target 文件被 import * 通配（confidence: low 兜底标记）*/
  starImportTargets: ReadonlySet<string>;
  /**
   * 哪些别名是**整模块命名空间**绑定（`import * as ns` / `const ns = await import(...)`）。
   *
   * 与 aliasToTarget 的区别在于「别名指代什么」：命名空间别名指代模块本身，
   * 因此 `ns.fn()` 是模块成员调用（target = `file::fn`），而普通 named import 别名
   * 指代具体符号，`SomeClass.staticMethod()` 才是类成员调用（target = `file::SomeClass.staticMethod`）。
   * mapper 的首字母大小写启发式无法区分二者，此集合让 resolver 用确定性事实覆盖启发式。
   */
  namespaceAliases: ReadonlySet<string>;
  /**
   * 被抑制的 dynamic 别名：**该名字存在 dynamic 绑定，但没能产出可信的 aliasToTarget 条目**。
   *
   * 存在的意义是「记住我们已经知道自己不知道」：仅仅不写入 aliasToTarget 并不够 ——
   * 调用点会继续掉进 Stage 1 本地导出、Stage 2 类启发式或 Stage 3 查表，把已知的
   * 不确定性重新伪装成确定结论（caller 恰有同名函数 / 同名类时产出 high confidence
   * 的本地假边，且 high 边能存活下游全部过滤）。resolver 在这三个 stage 的入口显式
   * 拦截该集合，让调用点落到 `?::` 占位。
   *
   * 三条入集判据见 buildImportIndex 第二遍的收敛循环：多变体歧义、唯一变体但 target
   * 未解析都入集；因静态绑定获胜而跳过的**不**入集（静态绑定是权威事实，不是未知）。
   *
   * ## 已接受的代价（scope-aware binding model follow-up）
   *
   * 本集合是**文件级**的，而 dynamic 绑定是块级作用域事实。因此它会误伤同文件里
   * 其他作用域中合法的同名调用（例如某函数内 `const M = await import(...)` 使 `M` 入集后，
   * 模块顶层引用真正本地类的 `M.run()` 也一并落 `?::`）。这是「精度优先：宁丢边不造假边」
   * 在无作用域索引下的既定取舍 —— 丢边只降 recall，假边会污染下游全部消费方。
   * 完整解法需要作用域感知的绑定模型，归 follow-up，不在本次修复范围。
   */
  suppressedDynamicAliases: ReadonlySet<string>;
}

export function buildModuleSymbolIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const [filePath, sk] of codeSkeletons) {
    const names = new Set<string>();
    for (const exp of sk.exports) {
      // re-export 名放进模块符号索引会让经 facade import 的调用解析到被图派生过滤掉的节点，
      // 造出 dangling call edge（F217 dangling 红线）；跳过后与修复前解析逐字一致，零回归。
      if (exp.kind === 're-export') continue;
      names.add(exp.name);
    }
    idx.set(filePath, names);
  }
  return idx;
}

export function buildClassMemberIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  for (const [filePath, sk] of codeSkeletons) {
    for (const exp of sk.exports) {
      if (!exp.members || exp.members.length === 0) continue;
      // 仅 class / interface / struct / data_class 等"含方法"的类型才有意义
      const classKey = `${filePath}::${exp.name}`;
      const memberNames = new Set<string>();
      for (const m of exp.members) {
        memberNames.add(m.name);
      }
      idx.set(classKey, memberNames);
    }
  }
  return idx;
}

/** 该 import 条目是否携带可用绑定名（决定是否需要 moduleSpecifier 兜底别名）。 */
function hasBindingNames(imp: CodeSkeleton['imports'][number]): boolean {
  return (
    (imp.namedImports?.length ?? 0) > 0 ||
    Boolean(imp.defaultImport) ||
    Boolean(imp.namespaceImport)
  );
}

/**
 * 无绑定名时的 moduleSpecifier 兜底别名（Python 的 `import X` / `from X import *` 路径）。
 *
 * 仅对**非 dynamic** 条目调用。该兜底成立的前提是「moduleSpecifier 的最后一段就是
 * 源码里写出来的调用名」——这对 `import numpy` / `import os.path` 成立，对 TS 的
 * dynamic specifier（路径字面量）完全不成立：`import('./b.js')` 的 lastSeg 是 `'js'`，
 * 既永远不是有意义的调用名，还会无条件 set() 覆盖同名静态绑定（`import { js } from 'lit'`）
 * 而产出确定性假边。dynamic 无绑定项因此在调用侧直接跳过，不进本函数。
 */
function registerSpecifierFallback(
  imp: CodeSkeleton['imports'][number],
  target: string | null,
  aliasToTarget: Map<string, string | null>,
): void {
  const lastSeg = imp.moduleSpecifier.split('.').pop() ?? imp.moduleSpecifier;
  aliasToTarget.set(lastSeg, target);
  aliasToTarget.set(imp.moduleSpecifier, target);
}

/**
 * dynamic 绑定别名指代的东西：`named` 指代模块导出的某个符号，`namespace` 指代模块本身。
 * 两者决定 `alias.x()` 的正确解析形态完全不同，故参与候选身份判重。
 */
type DynamicBindingKind = 'named' | 'namespace';

interface DynamicBinding {
  bindingKind: DynamicBindingKind;
  target: string | null;
}

/**
 * 候选去重键：`(bindingKind, target)` 二元组的字符串化。
 * 分隔符用 NUL —— 它是唯一在任何平台都不会出现在文件路径里的字符，
 * 避免带空格 / 冒号的路径与 kind 前缀拼接后撞出同一个键。
 */
function dynamicBindingKey(bindingKind: DynamicBindingKind, target: string | null): string {
  return `${bindingKind}\u0000${target ?? ''}`;
}

/**
 * 构建 file → ImportInfo 索引。
 *
 * ## 为什么 dynamic import 要单独两遍处理（F242 审查轮 C1）
 *
 * aliasToTarget 是**文件级**映射，而 dynamic import 的绑定是**块级作用域**事实：
 * 同一文件里 `async function f(){ const m = await import('./a.js'); m.run(); }` 与
 * `async function g(){ const m = await import('./b.js'); m.run(); }` 的两个 `m` 互不相干。
 * 一遍式 last-write-wins 会让 f 里的 `m.run()` 解析到 b.ts —— 这不是"覆盖率不足"，
 * 而是确定性的**假边**（medium confidence，能存活下游过滤）。
 *
 * 索引层没有作用域信息，无法把两个 `m` 分开，因此采取「歧义即弃权」：
 * 只有当某别名的 dynamic 候选唯一且 target 已解析时才写入；歧义时整体跳过该别名，
 * 结果回到 F242 之前的未覆盖状态（丢新增覆盖，不引入错误）。
 * 与静态绑定冲突时静态获胜，同样等于保持 F242 之前的行为。
 *
 * 候选的**身份是 `(bindingKind, target)` 二元组而非单纯 target**（复审轮修复 1）：
 * `const { M } = await import('./b.js')` 与 `const M = await import('./b.js')` 的 target
 * 相同，但 `M` 指代的东西完全不同 —— 前者 M 是 b.ts 导出的符号（`M.D()` 的正确目标是
 * `b.ts::M.D`），后者 M 是 b.ts 模块本身（正确目标是 `b.ts::D`）。只比 target 会把这种
 * 语义碰撞误判成「唯一候选」并按其中一种语义解析，同样是确定性假边。
 *
 * 弃权的别名会登记进 suppressedDynamicAliases 供 resolveOne 拦截后续 stage —— 只是不写入
 * aliasToTarget 并不足以止损，见该字段注释。
 */
export function buildImportIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, ImportInfo> {
  const idx = new Map<string, ImportInfo>();
  for (const [filePath, sk] of codeSkeletons) {
    const aliasToTarget = new Map<string, string | null>();
    const starImportTargets = new Set<string>();
    const namespaceAliases = new Set<string>();

    // ── 第一遍：非 dynamic 条目（静态 ES import / require / 无 importType 的语言）──
    // 行为与 F242 之前逐字一致，dynamic 条目的存在不影响这里的任何写入。
    for (const imp of sk.imports) {
      if (imp.importType === 'dynamic') continue;
      const target = imp.resolvedPath ?? null;
      // namedImports：每个名字单独放索引
      if (imp.namedImports && imp.namedImports.length > 0) {
        for (const name of imp.namedImports) {
          // import * 在 namedImports 中通常表现为 '*' 字符串
          if (name === '*') {
            if (target) starImportTargets.add(target);
          } else {
            aliasToTarget.set(name, target);
          }
        }
      }
      // defaultImport：作为别名直接放
      if (imp.defaultImport) {
        aliasToTarget.set(imp.defaultImport, target);
      }
      // F242：namespaceImport（`import * as ns`）同样是可用绑定名，落表让 `ns.fn()` 走
      // Stage 3 解析；同时登记为命名空间别名，让 Stage 2 不把 `NS.fn()` 当类静态方法。
      if (imp.namespaceImport) {
        aliasToTarget.set(imp.namespaceImport, target);
        namespaceAliases.add(imp.namespaceImport);
      }
      // 没有任何绑定名可用时（如 Python 的 from X import * 或 import X），
      // 把 moduleSpecifier 的最后一段 + 整个 module 作为 alias 兜底。
      // F242：绑定名存在即说明「无绑定可用」前提不成立，不再造 lastSeg 猜测别名
      // （对 './commands/scaffold-kb.js' 这类 specifier，lastSeg 是 'js' 之类的垃圾）。
      if (!hasBindingNames(imp)) {
        registerSpecifierFallback(imp, target, aliasToTarget);
      }
    }

    // ── 第二遍：dynamic 条目 —— 先收集候选，再按「唯一 + 不与静态冲突」写入 ──
    const dynamicCandidates = new Map<string, Map<string, DynamicBinding>>();
    const suppressedDynamicAliases = new Set<string>();
    const addCandidate = (
      alias: string,
      bindingKind: DynamicBindingKind,
      target: string | null,
    ): void => {
      let variants = dynamicCandidates.get(alias);
      if (!variants) {
        variants = new Map<string, DynamicBinding>();
        dynamicCandidates.set(alias, variants);
      }
      variants.set(dynamicBindingKey(bindingKind, target), { bindingKind, target });
    };
    for (const imp of sk.imports) {
      if (imp.importType !== 'dynamic') continue;
      const target = imp.resolvedPath ?? null;
      // 裸 `await import('x')` —— 无绑定名。dynamic specifier 是路径而非调用名，
      // 兜底别名只会是 'js' 之类的扩展名垃圾且会覆盖静态绑定，直接跳过。
      if (!hasBindingNames(imp)) continue;
      for (const name of imp.namedImports ?? []) {
        if (name === '*') {
          if (target) starImportTargets.add(target);
          continue;
        }
        addCandidate(name, 'named', target);
      }
      // defaultImport 与 namedImports 同属「别名指代某个导出符号」一类，归为 named
      if (imp.defaultImport) addCandidate(imp.defaultImport, 'named', target);
      if (imp.namespaceImport) addCandidate(imp.namespaceImport, 'namespace', target);
    }
    // 收敛：抑制集的判据是「有 dynamic 绑定，却没能给出可信 aliasToTarget 条目」，
    // 三条分支各自的 why 见下（确认轮统一收口，此前只覆盖第一条）。
    for (const [alias, variants] of dynamicCandidates) {
      if (variants.size !== 1) {
        // (1) 同名绑定指向多个模块，或同 target 上 named / namespace 语义碰撞 →
        //     无从判别用哪个，弃权并抑制。
        suppressedDynamicAliases.add(alias);
        continue;
      }
      const only = variants.values().next().value;
      if (!only || only.target === null) {
        // (2) 唯一变体但 target 解析不出（非项目模块 / 变量 specifier）。
        //     绑定**真实存在**，只是指向未知 —— 此时任何本地自信解释（Stage 1 本地导出、
        //     Stage 2 本地同名类）都是把「不知道」换成一个恰好同名的错误答案，故同样抑制。
        suppressedDynamicAliases.add(alias);
        continue;
      }
      if (aliasToTarget.has(alias)) {
        // (3) 别名已被静态绑定占用：同 target 无需重复写入，异 target 静态获胜。
        //     静态绑定是权威事实而非未知，**不**入抑制集 —— 否则会把原本正确解析的
        //     静态调用一并打掉（C1(a) 登记项语义在此保持不变）。
        continue;
      }
      aliasToTarget.set(alias, only.target);
      if (only.bindingKind === 'namespace') namespaceAliases.add(alias);
    }

    idx.set(filePath, {
      aliasToTarget,
      starImportTargets,
      namespaceAliases,
      suppressedDynamicAliases,
    });
  }
  return idx;
}

export function buildClassMroIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  // 简化版：从 ExportSymbol.signature 中尝试解析继承关系（如 "class Foo(Bar, Baz):"）。
  // 这里只做 best-effort 提取；更完整的 MRO 解析留给后续 Feature。
  // Codex P1 W-3 修订：用 bracket-aware split 而不是简单 split(',')，避免 `Generic[T, U]` 拆坏
  const SUPERCLASS_RE = /class\s+\w+\s*\(\s*([^)]+)\s*\)/;
  for (const [filePath, sk] of codeSkeletons) {
    for (const exp of sk.exports) {
      if (exp.kind !== 'class' && exp.kind !== 'interface') continue;
      const match = SUPERCLASS_RE.exec(exp.signature);
      if (!match || !match[1]) continue;
      const supers = bracketAwareSplit(match[1])
        .map((s) => s.trim())
        .map((s) => stripGenericParams(s)) // `Generic[T]` → `Generic`
        .filter((s) => s.length > 0 && s !== 'object');
      if (supers.length > 0) {
        idx.set(`${filePath}::${exp.name}`, supers);
      }
    }
  }
  return idx;
}

/**
 * 仅在顶层 `,` 处分割（忽略括号 / 方括号 / 尖括号 / 圆括号内的逗号）。
 * 用于解析类继承列表，避免 `Generic[T, U]` 被误拆。
 */
function bracketAwareSplit(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '[' || ch === '(' || ch === '<') depth++;
    else if (ch === ']' || ch === ')' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (buf.length > 0) out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

/** 剥离 `Generic[T, U]` 末尾的参数化部分，返回 `Generic`。 */
function stripGenericParams(name: string): string {
  const idx = name.indexOf('[');
  if (idx < 0) return name;
  return name.slice(0, idx).trim();
}

// ───────────────────────────────────────────────────────────
// resolveOne — 单个 CallSite 走 4 阶段，返回 UnifiedEdge 或 null（skip）
// ───────────────────────────────────────────────────────────

const MAX_MRO_DEPTH = 8; // EC-4：MRO 死循环兜底

function resolveOne(
  cs: CallSiteWithFile,
  indices: ResolverIndices,
): UnifiedEdge | null {
  const { moduleSymbolIndex, classMemberIndex, importIndex, classMroIndex } = indices;

  // F242：边的 source 归属在此一次性判定（同一 callSite 的 source 与命中哪个 stage 无关），
  // 各 stage 的 mkEdge 只做对象格式化。
  const source = resolveSourceId(cs, indices);

  // ─── Stage 1: free function ───
  if (cs.calleeKind === 'free') {
    const localExports = moduleSymbolIndex.get(cs.callerFile);
    // F242 确认轮：本地导出命中是 Stage 1 的**最早**出口，位于 Stage 2 / Stage 3 的
    // 抑制拦截之前。名字被 dynamic 绑定抑制时若不在此一并拦截，`const { run } = await
    // import(...)` 形态的调用会被 caller 自己的同名导出截胡，产出 high confidence 本地假边。
    // 未被抑制的普通名字短路在第一个条件，路径与拦截引入前逐字一致。
    if (
      localExports?.has(cs.calleeName) &&
      !isSuppressedDynamicAlias(cs, cs.calleeName, importIndex)
    ) {
      return mkEdge(source, `${cs.callerFile}::${cs.calleeName}`, 'high');
    }
    // 否则 fallthrough 到 Stage 3（可能是 cross-module 但 calleeKind 标错为 free）
    // 不立即返回，让后续 stage 处理
  }

  // ─── Stage 2: member（self.x / Class.x，Codex C-4 双重验证 + Codex P1 C-2 qualifier）───
  if (cs.calleeKind === 'member') {
    // F242 复审轮修复 1：qualifier 是**被抑制**的 dynamic 别名时，任何继续解析都是猜。
    // 尤其致命的是掉进下面的类启发式：caller 模块恰好导出同名类时会产出 high confidence
    // 的本地类边 —— 明知不确定却输出最高置信度，等于把已知的不确定性伪装成确定结论，
    // 且 high 边能存活下游全部过滤。直接落 `?::` 占位（悬空，下游丢弃）。
    // 注意作用域：仅拦截抑制集命中，普通未知名字沿用既有 medium 占位路径。
    if (cs.calleeQualifier && isSuppressedDynamicAlias(cs, cs.calleeQualifier, importIndex)) {
      return mkEdge(source, `?::${cs.calleeName}`, 'low');
    }

    // F242 审查轮 W3：qualifier 是命名空间绑定名时，`M.D()` 是模块成员调用而非类静态方法。
    // mapper 靠首字母大小写猜 member/cross-module，大写命名空间别名（`const M = await import(...)`
    // / `import * as M`）会被误判为类名，进类解析后产出 `b.ts::M.D` 这种错形 target。
    // 绑定表是确定性事实，优先级高于大小写启发式。
    if (cs.calleeQualifier) {
      const imports = importIndex.get(cs.callerFile);
      if (imports?.namespaceAliases.has(cs.calleeQualifier)) {
        const nsTarget = imports.aliasToTarget.get(cs.calleeQualifier);
        if (nsTarget) {
          return mkEdge(source, `${nsTarget}::${cs.calleeName}`, 'medium');
        }
      }
    }

    // Codex P1 C-2 修订：优先用 calleeQualifier 定位 className（Class.method 形式），
    // 否则回退 callerContext（self.method / cls.method 形式）
    const className = cs.calleeQualifier ?? extractClassName(cs.callerContext);
    if (className && moduleSymbolIndex.get(cs.callerFile)?.has(className)) {
      const classKey = `${cs.callerFile}::${className}`;
      // 第一重验证：自身 class.members
      if (classMemberIndex.get(classKey)?.has(cs.calleeName)) {
        return mkEdge(source, `${classKey}.${cs.calleeName}`, 'high');
      }
      // 第二重验证：MRO 父类（≤ MAX_MRO_DEPTH 层）
      const mroEdge = lookupInMro(
        classKey,
        cs.calleeName,
        classMroIndex,
        classMemberIndex,
        importIndex.get(cs.callerFile),
      );
      if (mroEdge) {
        return mkEdge(source, mroEdge, 'medium');
      }
      // 类存在但方法既不在自身也不在 MRO 父类 — medium 占位
      return mkEdge(source, `${classKey}.${cs.calleeName}`, 'medium');
    }
    // className 不在本模块 export 表 — 尝试 importIndex（Class 来自其他模块）
    if (className) {
      const imports = importIndex.get(cs.callerFile);
      const classFile = imports?.aliasToTarget.get(className);
      if (classFile) {
        const remoteClassKey = `${classFile}::${className}`;
        if (classMemberIndex.get(remoteClassKey)?.has(cs.calleeName)) {
          return mkEdge(source, `${remoteClassKey}.${cs.calleeName}`, 'medium');
        }
        // 类来自外部但 members 不可见（可能是非项目模块）— medium 占位
        return mkEdge(source, `${remoteClassKey}.${cs.calleeName}`, 'medium');
      }
    }
    // 类无法定位 — medium
    return mkEdge(source, `?::${cs.calleeName}`, 'medium');
  }

  // ─── Stage 3: cross-module ───
  // calleeKind=cross-module 显式走，或 Stage 1 free 未命中 fallthrough
  // Codex P1 C-2 修订：优先用 calleeQualifier 定位 module，否则回退 calleeName
  if (cs.calleeKind === 'cross-module' || cs.calleeKind === 'free') {
    const imports = importIndex.get(cs.callerFile);
    const lookupKey = cs.calleeQualifier ?? cs.calleeName;
    // 复审轮修复 1：该名字的 dynamic 绑定已被抑制时不查表 —— 否则同名静态兜底别名
    // 会顶替未知答案，把弃权变成一次伪装成确定结论的猜测。跳过后落既有 Stage 4 fallthrough。
    if (imports && !imports.suppressedDynamicAliases.has(lookupKey)) {
      const target = imports.aliasToTarget.get(lookupKey);
      if (target) {
        const isStar = imports.starImportTargets.has(target);
        const tier: ConfidenceTier = isStar ? 'low' : 'medium';
        return mkEdge(source, `${target}::${cs.calleeName}`, tier);
      }
    }
  }

  // ─── Stage 4: super / dunder / decorator / unresolved ───
  if (cs.calleeKind === 'super') {
    const className = extractClassName(cs.callerContext);
    if (className) {
      const classKey = `${cs.callerFile}::${className}`;
      const mroTarget = lookupInMro(
        classKey,
        cs.calleeName,
        classMroIndex,
        classMemberIndex,
        importIndex.get(cs.callerFile),
      );
      if (mroTarget) {
        return mkEdge(source, mroTarget, 'low');
      }
    }
  }

  if (
    cs.calleeKind === 'unresolved' ||
    cs.calleeKind === 'dunder' ||
    cs.calleeKind === 'decorator' ||
    cs.calleeKind === 'super' ||
    cs.calleeKind === 'free'
  ) {
    // 全部 fallthrough — low confidence 占位
    return mkEdge(source, `?::${cs.calleeName}`, 'low');
  }

  // dynamic call / 未知 calleeKind — skip（不输出，不污染 precision）
  return null;
}

// ───────────────────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────────────────

/** 该名字是否是 callerFile 里被抑制的 dynamic 绑定别名（见 ImportInfo 字段注释）。 */
function isSuppressedDynamicAlias(
  cs: CallSiteWithFile,
  name: string,
  importIndex: ResolverIndices['importIndex'],
): boolean {
  return importIndex.get(cs.callerFile)?.suppressedDynamicAliases.has(name) ?? false;
}

/**
 * 从 callerContext 字符串提取 className。
 *
 * 约定格式：
 * - "ClassName.method" → "ClassName"
 * - "method" / 无点号 → undefined（顶层函数）
 * - "Outer.Inner.method" → "Inner"（取最后一个点之前的段）
 */
export function extractClassName(callerContext: string | undefined): string | undefined {
  if (!callerContext) return undefined;
  const lastDot = callerContext.lastIndexOf('.');
  if (lastDot < 0) return undefined;
  // 取最后一个点之前的所有内容；如果还有点（嵌套），取最后一段
  const beforeMethod = callerContext.slice(0, lastDot);
  const lastDotInClass = beforeMethod.lastIndexOf('.');
  if (lastDotInClass < 0) return beforeMethod;
  return beforeMethod.slice(lastDotInClass + 1);
}

/**
 * 在 ≤ MAX_MRO_DEPTH 层 MRO 父类中查找方法。
 *
 * 返回命中时的 target ID（"file::Class.method" 形式）；未命中返回 null。
 * EC-4：硬上限防御类继承环。
 */
function lookupInMro(
  classKey: string,
  methodName: string,
  classMroIndex: ReadonlyMap<string, ReadonlyArray<string>>,
  classMemberIndex: ReadonlyMap<string, ReadonlySet<string>>,
  callerImports: ImportInfo | undefined,
): string | null {
  const visited = new Set<string>();
  const queue: Array<{ key: string; depth: number }> = [{ key: classKey, depth: 0 }];

  while (queue.length > 0) {
    const head = queue.shift();
    if (!head) break;
    const { key, depth } = head;
    if (visited.has(key) || depth >= MAX_MRO_DEPTH) continue;
    visited.add(key);

    const supers = classMroIndex.get(key);
    if (!supers) continue;

    for (const superName of supers) {
      // 优先尝试同模块
      const filePart = key.split('::')[0] ?? '';
      const sameFileKey = `${filePart}::${superName}`;
      if (classMemberIndex.get(sameFileKey)?.has(methodName)) {
        return `${sameFileKey}.${methodName}`;
      }
      // 再尝试通过 import 表定位 superclass 所在 file
      if (callerImports) {
        const targetFile = callerImports.aliasToTarget.get(superName);
        if (targetFile) {
          const importedClassKey = `${targetFile}::${superName}`;
          if (classMemberIndex.get(importedClassKey)?.has(methodName)) {
            return `${importedClassKey}.${methodName}`;
          }
          queue.push({ key: importedClassKey, depth: depth + 1 });
        }
      }
      // 加入 BFS 队列继续向上
      queue.push({ key: sameFileKey, depth: depth + 1 });
    }
  }
  return null;
}

/**
 * F242 — 上下文名是否可寻址为图节点。
 *
 * 节点域由 deriveNodesFromSkeletons 定义：module（每文件）+ symbol（仅导出）+ member。
 * 因此判定完全复用已有索引，不新建索引：
 * - 无点号（`"main"` / `"registerX"`）→ 查 moduleSymbolIndex（该模块导出集合）
 * - 点分（`"Foo.bar"`）→ 查 classMemberIndex 的 `"file::Foo"` 是否含 `"bar"`
 *
 * 匿名上下文（`<arrow:...>` / `<fn:...>` / `<gen:...>`）天然不在任何索引的 key 集合中，
 * `.has()` 返回 false —— 索引未命中即是判定依据，无需显式排除匿名前缀。
 */
export function isAddressable(
  name: string | undefined,
  file: string,
  moduleSymbolIndex: ReadonlyMap<string, ReadonlySet<string>>,
  classMemberIndex: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (!name) return false;
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx < 0) {
    return moduleSymbolIndex.get(file)?.has(name) ?? false;
  }
  const className = name.slice(0, dotIdx);
  const memberName = name.slice(dotIdx + 1);
  return classMemberIndex.get(`${file}::${className}`)?.has(memberName) ?? false;
}

/**
 * F242 — 边 source 的归属回退链（R1 修复核心）。
 *
 * 此前 mkEdge 直接拼 `callerFile::callerContext`，未验证该上下文名是否可寻址；
 * 匿名 callback、未导出函数、模块顶层三类上下文都不是图节点，边在 graph-builder
 * 悬空过滤被静默丢弃。三级回退保证 source 恒为真实节点：
 *
 * 1. `callerContext` 可寻址 → `file::callerContext`（符号级，精度最高；既有行为不变）
 * 2. `enclosingNamedContext` 可寻址 → `file::enclosingNamedContext`（跳过匿名帧的命名祖先）
 * 3. 兜底 → `file`（module 节点 id 逐字等于 filePath，必然存在）
 *
 * 语言无关：不含任何按语言分支的判断。未产出 enclosingNamedContext 的语言
 * （Python / Java / Go）第 2 级恒 false，自动落到模块兜底。
 */
export function resolveSourceId(
  cs: CallSiteWithFile,
  indices: Pick<ResolverIndices, 'moduleSymbolIndex' | 'classMemberIndex'>,
): string {
  const { moduleSymbolIndex, classMemberIndex } = indices;
  if (isAddressable(cs.callerContext, cs.callerFile, moduleSymbolIndex, classMemberIndex)) {
    return `${cs.callerFile}::${cs.callerContext}`;
  }
  if (isAddressable(cs.enclosingNamedContext, cs.callerFile, moduleSymbolIndex, classMemberIndex)) {
    return `${cs.callerFile}::${cs.enclosingNamedContext}`;
  }
  return cs.callerFile;
}

/**
 * 构造 calls 边（纯格式化）。
 *
 * F242：source 由调用方经 resolveSourceId 预计算并传入 —— 同一 callSite 的 source
 * 与命中哪个 stage 无关，不应跟着 stage 分支重复计算。
 */
function mkEdge(
  source: string,
  targetId: string,
  tier: ConfidenceTier,
): UnifiedEdge {
  return {
    source,
    target: targetId,
    relation: 'calls',
    confidence: tier,
    directional: true,
  };
}
