/**
 * F260 P4 — 接收者类型解析分支（D2b 六条件与门，plan §5 变更 #10）。
 *
 * mapper 侧（`typescript-receiver-env.ts`）已经把「接收者表达式 → 类名」这一环补上，
 * 本模块负责 resolver 侧的另一半：**把类名定位到具体文件的具体 export 条目**，
 * 并只在六条件全部成立时产出一条 `medium` calls 边。
 *
 * ## 为什么是「与门」而不是「尽力而为」
 *
 * H2 已证明成员验证（`Cls.members.has(name)`）是**反悬空门而非反假边门**：TS 方法名分布
 * 高度集中（`run` / `parse` / `build` / `resolve`…），类名一旦解析错，同名成员命中概率接近 1。
 * 因此真正的安全性全部押在**类名定位**这一步上，六条件里有四条（②③④⑤）都在收紧它。
 * 任一条不成立就 `return null` —— 调用方据此 fallthrough 回今天的原有路径，
 * **不出任何新边**，也不产 `?::` 占位（占位是悬空边，只抬高 dangling 计数）。
 *
 * ## 与既有 stage 的边界
 *
 * 本分支只决定边的 **target** 与 tier；边的 **source** 由 F242 的 `resolveSourceId` 在
 * `resolveOne` 顶部一次性算好后传入，本模块不触碰归属回退链。
 */
import type { CodeSkeleton } from '../models/code-skeleton.js';
import type { UnifiedEdge } from './unified-graph.js';
// 类型导入在编译期擦除，不构成与 call-resolver 的运行时循环依赖。
import type { CallSiteWithFile } from './call-resolver.js';

/** 单个 export 条目的最小视图 —— 条件 ④ 看 `kind`，条件 ⑤ 看**同一条目自己的** `members`。 */
export interface ReceiverClassEntry {
  readonly kind: string;
  readonly members: ReadonlySet<string>;
}

/** 单文件的解析事实（供六条件与门查询）。 */
export interface ReceiverTypeFileFacts {
  /**
   * 名字 → 该文件的 export 条目，**first-write-wins**。
   *
   * 顺序口径必须与 `deriveNodesFromSkeletons` 逐字一致（同为 first-write-wins、同样跳过
   * `re-export`）：声明合并（同名 `export interface Foo` + `export class Foo`）下，
   * 图上 `file::Foo` 这个符号节点的 `metadata.exportKind` 取的就是**先出现**的那一条。
   * 若这里换一种选法（比如「挑出 kind==='class' 的那条」），interface 在前时会产出一条
   * 挂在 `exportKind==='interface'` 符号节点下的成员边，直接打破 §7.1 断言 2。
   *
   * ⚠️ 刻意**不复用** `buildClassMemberIndex`：那张表是 **last-write-wins**，与节点派生方向
   * 相反，同一个 `file::Foo` 在两张表里会指向两个不同条目（R-12 已登记）。
   */
  readonly exportByName: ReadonlyMap<string, ReceiverClassEntry>;
  /**
   * 由 `default import` 引入的本地绑定名（A2：新分支一律弃权）。
   *
   * `import Foo from './a.js'` 的真身可能叫 `Baz`，而 a.ts 另有具名 `export class Foo` ——
   * 拼出的 `a.ts::Foo.m` 恰好存在，是一条不悬空、能存活下游全部过滤的确定性假边。
   * 修正它需要 `ImportInfo` 的值携带「源导出名」（R-1 / R-11 同根因），本次只弃权。
   */
  readonly defaultImportAliases: ReadonlySet<string>;
}

/** file → 该文件的解析事实。 */
export type ReceiverTypeIndex = ReadonlyMap<string, ReceiverTypeFileFacts>;

/**
 * `ImportInfo` 的结构子集 —— 本模块只需要这三张表。
 *
 * 单列一个视图类型而不是导出 `ImportInfo`：一来避免把整个 import 索引的实现细节
 * 暴露成跨模块契约，二来让本模块的依赖面在签名上一眼可见。
 */
export interface ReceiverImportView {
  readonly aliasToTarget: ReadonlyMap<string, string | null>;
  readonly suppressedDynamicAliases: ReadonlySet<string>;
  readonly renamedImportAliases: ReadonlySet<string>;
}

/** 六条件与门的输入上下文。 */
export interface ReceiverResolutionContext {
  /** 边的 source（F242 归属回退链已算好，本模块只透传） */
  readonly source: string;
  readonly moduleSymbolIndex: ReadonlyMap<string, ReadonlySet<string>>;
  /** callerFile 的 import 事实；文件无 import 记录时为 undefined */
  readonly importView: ReceiverImportView | undefined;
  readonly receiverTypeIndex: ReceiverTypeIndex;
}

/**
 * 构建 file → `ReceiverTypeFileFacts` 索引（一次性，按 codeSkeletons 派生）。
 */
export function buildReceiverTypeIndex(
  codeSkeletons: ReadonlyMap<string, CodeSkeleton>,
): Map<string, ReceiverTypeFileFacts> {
  const idx = new Map<string, ReceiverTypeFileFacts>();
  for (const [filePath, sk] of codeSkeletons) {
    const exportByName = new Map<string, ReceiverClassEntry>();
    for (const exp of sk.exports) {
      // re-export 是别名门面，真身节点由目标文件贡献（与 deriveNodesFromSkeletons 同款跳过）
      if (exp.kind === 're-export') continue;
      if (exportByName.has(exp.name)) continue; // first-write-wins
      const members = new Set<string>();
      for (const m of exp.members ?? []) members.add(m.name);
      exportByName.set(exp.name, { kind: exp.kind, members });
    }
    const defaultImportAliases = new Set<string>();
    for (const imp of sk.imports) {
      if (imp.defaultImport) defaultImportAliases.add(imp.defaultImport);
    }
    idx.set(filePath, { exportByName, defaultImportAliases });
  }
  return idx;
}

/**
 * D2b 六条件与门（纯函数）。
 *
 * 六条件全部成立返回一条 `medium` calls 边，任一不成立返回 `null`（调用方 fallthrough）。
 *
 * ① `receiverType` 存在
 * ② 该名字未被 `suppressedDynamicAliases` 抑制，**且拦截前置于本模块导出查找**（H5）
 * ③ 类名可定位：本模块导出命中；**或** `receiverTypeSoleImportBinding === true`
 *    且不在 `renamedImportAliases`（D1）且不是 `defaultImport` 引入的别名（A2）
 * ④ 定位到的 export 条目 `kind === 'class'`
 * ⑤ 方法名存在于**条件 ④ 那一个条目自己的 `members`**（A6；MRO 回退未接入本分支 ——
 *    有意收窄，方向纯 recall，登记 R-18，见 plan §17-4）
 * ⑥ 置信度统一 `medium` —— 含 `new Foo().m()`（H7 已证伪「100% 确定」：
 *    「取名字确定」不等于「名字解析到哪个文件确定」）
 */
export function resolveReceiverTypeCall(
  cs: CallSiteWithFile,
  ctx: ReceiverResolutionContext,
): UnifiedEdge | null {
  // ① —— 未推断出接收者类名的调用点一律不进本分支（R12「不夺路」的结构保证）
  const receiverType = cs.receiverType;
  if (!receiverType) return null;

  const { importView, receiverTypeIndex } = ctx;

  // ② —— H5：抑制拦截必须**先于**本模块导出查找。否则
  // `const { Alpha } = await import(process.env.M!)` + caller 自己导出的同名 class
  // 会让「已知自己不知道」被一个恰好同名的本地答案顶替。
  if (importView?.suppressedDynamicAliases.has(receiverType)) return null;

  // ③ —— 类名定位
  const classFile = locateClassFile(cs, receiverType, ctx);
  if (classFile === null) return null;

  // ④⑤ —— 必须绑定到**同一个** export 条目（A6）
  const entry = receiverTypeIndex.get(classFile)?.exportByName.get(receiverType);
  if (entry?.kind !== 'class') return null;
  if (!entry.members.has(cs.calleeName)) return null;

  // ⑥
  return {
    source: ctx.source,
    target: `${classFile}::${receiverType}.${cs.calleeName}`,
    relation: 'calls',
    confidence: 'medium',
    directional: true,
  };
}

/**
 * 条件 ③ —— 把类名定位到文件；定位不到返回 `null`。
 *
 * 两条来源互斥且**本模块导出优先**：类名在 caller 自己的导出表里时，它指的必然是本模块
 * 那个符号，此时 import 别名表不适用（也不需要 A1 判据）。走 import 表则必须同时满足
 * A1（唯一绑定且来自 import）、D1（非重命名别名）、A2（非 default 别名）三道闸。
 */
function locateClassFile(
  cs: CallSiteWithFile,
  receiverType: string,
  ctx: ReceiverResolutionContext,
): string | null {
  if (ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)) return cs.callerFile;

  // A1：`undefined` 按 `false` 处理 —— 字段缺席意味着 import 表的可信度无从判断
  if (cs.receiverTypeSoleImportBinding !== true) return null;
  if (ctx.importView?.renamedImportAliases.has(receiverType)) return null;
  if (ctx.receiverTypeIndex.get(cs.callerFile)?.defaultImportAliases.has(receiverType)) return null;
  return ctx.importView?.aliasToTarget.get(receiverType) ?? null;
}
