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

export function buildImportIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, ImportInfo> {
  const idx = new Map<string, ImportInfo>();
  for (const [filePath, sk] of codeSkeletons) {
    const aliasToTarget = new Map<string, string | null>();
    const starImportTargets = new Set<string>();
    for (const imp of sk.imports) {
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
      // 没有 named/default 时（如 Python 的 from X import * 或 import X），
      // 把 moduleSpecifier 的最后一段 + 整个 module 作为 alias
      if (
        (!imp.namedImports || imp.namedImports.length === 0) &&
        !imp.defaultImport
      ) {
        const lastSeg = imp.moduleSpecifier.split('.').pop() ?? imp.moduleSpecifier;
        aliasToTarget.set(lastSeg, target);
        aliasToTarget.set(imp.moduleSpecifier, target);
      }
    }
    idx.set(filePath, { aliasToTarget, starImportTargets });
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

  // ─── Stage 1: free function ───
  if (cs.calleeKind === 'free') {
    const localExports = moduleSymbolIndex.get(cs.callerFile);
    if (localExports?.has(cs.calleeName)) {
      return mkEdge(cs, `${cs.callerFile}::${cs.calleeName}`, 'high');
    }
    // 否则 fallthrough 到 Stage 3（可能是 cross-module 但 calleeKind 标错为 free）
    // 不立即返回，让后续 stage 处理
  }

  // ─── Stage 2: member（self.x / Class.x，Codex C-4 双重验证 + Codex P1 C-2 qualifier）───
  if (cs.calleeKind === 'member') {
    // Codex P1 C-2 修订：优先用 calleeQualifier 定位 className（Class.method 形式），
    // 否则回退 callerContext（self.method / cls.method 形式）
    const className = cs.calleeQualifier ?? extractClassName(cs.callerContext);
    if (className && moduleSymbolIndex.get(cs.callerFile)?.has(className)) {
      const classKey = `${cs.callerFile}::${className}`;
      // 第一重验证：自身 class.members
      if (classMemberIndex.get(classKey)?.has(cs.calleeName)) {
        return mkEdge(cs, `${classKey}.${cs.calleeName}`, 'high');
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
        return mkEdge(cs, mroEdge, 'medium');
      }
      // 类存在但方法既不在自身也不在 MRO 父类 — medium 占位
      return mkEdge(cs, `${classKey}.${cs.calleeName}`, 'medium');
    }
    // className 不在本模块 export 表 — 尝试 importIndex（Class 来自其他模块）
    if (className) {
      const imports = importIndex.get(cs.callerFile);
      const classFile = imports?.aliasToTarget.get(className);
      if (classFile) {
        const remoteClassKey = `${classFile}::${className}`;
        if (classMemberIndex.get(remoteClassKey)?.has(cs.calleeName)) {
          return mkEdge(cs, `${remoteClassKey}.${cs.calleeName}`, 'medium');
        }
        // 类来自外部但 members 不可见（可能是非项目模块）— medium 占位
        return mkEdge(cs, `${remoteClassKey}.${cs.calleeName}`, 'medium');
      }
    }
    // 类无法定位 — medium
    return mkEdge(cs, `?::${cs.calleeName}`, 'medium');
  }

  // ─── Stage 3: cross-module ───
  // calleeKind=cross-module 显式走，或 Stage 1 free 未命中 fallthrough
  // Codex P1 C-2 修订：优先用 calleeQualifier 定位 module，否则回退 calleeName
  if (cs.calleeKind === 'cross-module' || cs.calleeKind === 'free') {
    const imports = importIndex.get(cs.callerFile);
    if (imports) {
      const lookupKey = cs.calleeQualifier ?? cs.calleeName;
      const target = imports.aliasToTarget.get(lookupKey);
      if (target) {
        const isStar = imports.starImportTargets.has(target);
        const tier: ConfidenceTier = isStar ? 'low' : 'medium';
        return mkEdge(cs, `${target}::${cs.calleeName}`, tier);
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
        return mkEdge(cs, mroTarget, 'low');
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
    return mkEdge(cs, `?::${cs.calleeName}`, 'low');
  }

  // dynamic call / 未知 calleeKind — skip（不输出，不污染 precision）
  return null;
}

// ───────────────────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────────────────

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

function mkEdge(
  cs: CallSiteWithFile,
  targetId: string,
  tier: ConfidenceTier,
): UnifiedEdge {
  return {
    source: `${cs.callerFile}::${cs.callerContext ?? '<module>'}`,
    target: targetId,
    relation: 'calls',
    confidence: tier,
    directional: true,
  };
}
