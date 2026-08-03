/**
 * F249 T038：`ModuleGraph` → 可 pinned 的规范化投影（plan 决策 7 / R4 防守项 4）。
 *
 * 为什么需要投影：`buildModuleGraphForProject` 产出的 `ModuleGraph` 含两个**与采集行为无关**
 * 的易变字段——`projectRoot`（绝对路径，随 `mkdtempSync` 每次变化）与 `analyzedAt`
 * （`new Date().toISOString()` 实时戳）。直接 pin 原始产物会让护栏每次都红，红的原因与
 * "采集行为是否漂移"毫无关系，护栏立刻退化为噪声并被人为忽略。
 *
 * 为什么**只**替换这两个字段、不做通用剥离：护栏的价值在于"任何未预期差异都必须变红"。
 * 每多剥一个字段就多一条盲区，因此 `modules[].language`、`edges[].importType`、`sccs`、
 * `topologicalOrder`、`mermaidSource` 一律**原样保留**——它们都是采集/派生行为的真实投影。
 *
 * 本文件是 b-track 护栏测试（T046/T047）与再生脚本（T044）**共用的唯一实现**：
 * 若两侧各写一份，"生成时归一化口径"与"比较时归一化口径"会静默分叉，产出永久假绿。
 */
import type { ModuleGraph } from '../../src/knowledge-graph/module-derivation.js';

/** `projectRoot` 的固定替换值：出现在 pinned 资产里的字面量即为本常量。 */
export const NORMALIZED_PROJECT_ROOT = '<PROJECT_ROOT>';

/**
 * `analyzedAt` 的固定替换值。
 *
 * 取 Unix epoch 而非空串：`ModuleGraphSchema` 要求该字段是合法 datetime（`z.string().datetime()`），
 * 保持可通过生产 schema 校验，使 pinned 投影仍是"结构合法、仅时间被冻结"的形态。
 */
export const NORMALIZED_ANALYZED_AT = '1970-01-01T00:00:00.000Z';

/**
 * `ModuleGraph` 的规范化投影：仅 `projectRoot`/`analyzedAt` 被替换为固定值，其余字段全保留。
 *
 * 不是生产 schema 的一部分——只存在于 `expected-module-graph.json` 与本 helper 之间。
 */
export interface NormalizedModuleGraphSnapshot extends Omit<ModuleGraph, 'projectRoot' | 'analyzedAt'> {
  projectRoot: typeof NORMALIZED_PROJECT_ROOT;
  analyzedAt: typeof NORMALIZED_ANALYZED_AT;
}

/**
 * 把 `ModuleGraph` 投影为可 pinned 的确定性快照。
 *
 * 纯函数：不改写入参（浅展开 + 覆盖两个字段；`modules`/`edges` 等数组引用被复用而非深拷贝，
 * 因为本函数的调用方随后只做读比较；需要改写产物的扰动注入用例自行深拷贝）。
 */
export function normalizeModuleGraphSnapshot(graph: ModuleGraph): NormalizedModuleGraphSnapshot {
  return {
    ...graph,
    projectRoot: NORMALIZED_PROJECT_ROOT,
    analyzedAt: NORMALIZED_ANALYZED_AT,
  };
}
