/**
 * F249 T044：双轨护栏 pinned 资产再生脚本（FR-005 / plan「再生脚本」一节）。
 *
 * 角色：**唯一**允许更新 `tests/fixtures/collector-fingerprint-guardrail/expected-*.json` 的入口。
 * 手工编辑那两份资产会绕过下面的二元拒绝判据——护栏的全部价值都在这条判据上，因此它必须
 * 长在写盘路径的必经之处，而不是长在一个"建议跑一下"的旁路检查里。
 *
 * 为什么用 `tsx` 直跑而非 spawn dist CLI：直接 `import` 生产函数，消除"必须先 npm run build
 * 才能重跑护栏"的前置门槛，也让本脚本与 vitest 护栏测试跑的是同一份源码（dist 陈旧导致
 * "脚本说一致、测试说不一致"这类伪冲突不会发生）。
 *
 * **F261 追加约束：这条 tsx/src 路径同时是 `expected-graph-only-graph.json` 里 `"builder": null`
 * 的成因，MUST NOT 改用 dist CLI 再生。** `builder-stamp` 跑 `src/` 时结构性定位不到
 * `.spectra-build-meta.json`（诚实降级为 null）；改走 dist 会把再生者本机的 commit / dirty /
 * distSha256 烤进 tracked 资产，而这些值跨机器必然不同 ⇒ fixture 在别人机器上永久红，
 * 且红因与被护栏保护的采集面毫无关系。详见该 fixture 的 README。
 *
 * 与护栏测试的共享面：`normalizeModuleGraphSnapshot`（b-track 归一化）、
 * `bootstrap-guardrail-registry`（registry 生命周期）、`pinned-asset-loader`（解包）三个
 * `tests/helpers/` 模块，以及本文件导出的两个比较器 + `swapPinnedAssets`。
 * **刻意让测试从本脚本 import 比较器**（而非各写一份）：一旦"生成时怎么比"与"护栏怎么比"
 * 分叉，护栏就会退化为永久绿而没人察觉。
 *
 * 用法：
 *   npm run fixtures:regen:collector-fingerprint                       # 常规再生（走全部校验）
 *   npm run fixtures:regen:collector-fingerprint -- --init             # 冷启动首次生成（仅当两份 pinned 资产均不存在）
 *   npm run fixtures:regen:collector-fingerprint -- --fixture-root <p> # 在副本上跑（测试隔离用）
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildAstGraphOnly } from '../src/batch/batch-orchestrator.js';
import { buildModuleGraphForProject } from '../src/knowledge-graph/module-derivation.js';
import {
  computeCollectorFingerprint,
  fingerprintsEqual,
  parseCollectorFingerprint,
  type CollectorFingerprint,
} from '../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../src/panoramic/graph/graph-types.js';
import { shouldRejectRegen } from './lib/collector-fingerprint-regen-predicate.mjs';
import {
  bootstrapGuardrailRegistryMain,
  resetGuardrailRegistry,
} from '../tests/helpers/bootstrap-guardrail-registry.js';
import {
  normalizeModuleGraphSnapshot,
  type NormalizedModuleGraphSnapshot,
} from '../tests/helpers/module-graph-snapshot-normalize.js';
import {
  loadPinnedGraphOnlyAsset,
  loadPinnedModuleGraphAsset,
} from '../tests/helpers/pinned-asset-loader.js';

/** 入库 fixture 根目录（相对仓库根）。`--fixture-root` 可覆盖，供脚本级测试在临时副本上实跑。 */
export const DEFAULT_FIXTURE_ROOT = 'tests/fixtures/collector-fingerprint-guardrail';

export const GRAPH_ONLY_ASSET_FILENAME = 'expected-graph-only-graph.json';
export const MODULE_GRAPH_ASSET_FILENAME = 'expected-module-graph.json';

// ============================================================
// fixtureInputHash（纯诊断字段）
// ============================================================

/** 递归收集目录下全部文件的绝对路径（顺序无关——调用方按相对路径排序）。 */
function collectFilesRecursively(root: string): string[] {
  const found: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        found.push(abs);
      }
    }
  }
  return found;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * fixture 输入哈希：逐文件定长摘要 → 按路径排序的结构化 JSON → 整体摘要（Q1 修复版）。
 *
 * 为什么不是"排序路径 + 原始字节整体拼接后 hash"：朴素拼接存在长度歧义碰撞——
 * 内容 `"ab"`/`"c"` 与 `"a"`/`"bc"` 拼接结果可能相同。先把每个文件压成固定 64 hex 的摘要，
 * 再交给 JSON 的结构化转义，歧义面被彻底消掉，且无需自造分隔符约定。
 *
 * 路径统一转 POSIX 分隔符：否则同一份 fixture 在 Windows 与 macOS/Linux 上摘要不同，
 * 而该差异与"fixture 内容是否变了"毫无关系。
 */
export function computeFixtureInputHash(srcRoot: string): string {
  const entries = collectFilesRecursively(srcRoot)
    .map((abs) => ({
      path: path.relative(srcRoot, abs).split(path.sep).join('/'),
      contentSha256: sha256(fs.readFileSync(abs)),
    }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  // canonical JSON：固定键序 path → contentSha256、无额外空白
  const canonical = JSON.stringify(
    entries.map((entry) => ({ path: entry.path, contentSha256: entry.contentSha256 })),
  );
  return sha256(canonical);
}

// ============================================================
// 诊断文案分流（拒绝路径专用；不参与放行判定）
// ============================================================

/**
 * 拒绝时的诊断文案分流（T042 直接单测本 seam）。
 *
 * 两条文案指向的是**同一条判据**的两种现实成因，给出的动作也一样（bump behaviorVersion）；
 * 分流的意义只在于让人一眼看出"我刚才动的是 producer 逻辑还是 fixture 样本"，
 * 少一次徒劳的 `git diff` 排查。
 */
export function selectRegenDiagnostic(inputHashChanged: boolean): string {
  return inputHashChanged
    ? '检测到 fixture 基线变更（护栏样本扩充/修改）但指纹未随之变化：这等同行为面变化，请 bump behaviorVersion 声明基线变化后再跑再生'
    : '检测到指纹不可见的行为变更：先 bump behaviorVersion 再跑再生';
}

/**
 * 拒绝路径的**维度专属**补充指引：差异含节点 metadata key 集合维度时才打印（F278 项②配套）。
 *
 * 为什么必须单列一条：新的 metadata 维度会拒绝一类**按权威清单判定为"不该 bump"**的改动。
 * `selectRegenDiagnostic` 的两条既有文案统一指向"先 bump behaviorVersion"，但
 * `collector-fingerprint.ts` 的六类 bump responsibility 全部是"哪些文件被计入采集面"，
 * 没有一条覆盖节点携带的字段集合（F271 给 symbol 节点加 lineRange 时的留痕明写着
 * "六类均不适用，故不 bump"）。只给那条文案，维护者就只剩两条路：做一次按清单为错的 bump，
 * 或 `rm expected-*.json && --init` 全绕过。这里补一条维度专属的处置指引来消掉这个死角。
 *
 * 判定用前缀而非关键词包含：三条 metadata 文案都以 `metadata ` 开头，b-track 的差异一律以
 * `moduleGraph` 开头，前缀判定不会把"某个 module 字段恰好叫 metadata"误算进来。
 */
function printMetadataDimensionGuidance(differences: readonly string[]): void {
  if (!differences.some((difference) => difference.startsWith('metadata '))) return;
  console.error(
    '[regen] 上述差异含**节点 metadata key 集合**维度。注意 collector-fingerprint.ts 的六类 bump ' +
      'responsibility 只覆盖"哪些文件被计入采集面"，不覆盖节点携带的字段集合——F271 给 symbol 节点新增 ' +
      'lineRange 时的留痕即写明"六类均不适用，故不 bump"。',
  );
  console.error(
    '[regen] 因此若已确认本次只是节点字段增删、采集面未变：正确处置是删除两份 pinned 资产后跑 --init ' +
      `重建基线（rm ${GRAPH_ONLY_ASSET_FILENAME} ${MODULE_GRAPH_ASSET_FILENAME}），该路径会在 ` +
      `${REGEN_AUDIT_FILENAME} 留下审计记录；MUST NOT 为了让本脚本放行而做一次按 bump responsibility ` +
      '清单判定为错的 bump。',
  );
}

// ============================================================
// 两轨比较器（护栏测试与本脚本共用，避免镜像实现）
// ============================================================

export interface StructuralComparison {
  mismatch: boolean;
  /** 人读差异摘要（拒绝文案与测试失败输出共用）。空数组 ⇔ `mismatch === false`。 */
  differences: string[];
}

/** 边的 multiset key：`source|relation|target`（plan 定义的 a-track 比较维度）。 */
function edgeKey(link: GraphJSON['links'][number]): string {
  return `${link.source}|${link.relation}|${link.target}`;
}

function countByKey(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

type GraphNodeLike = GraphJSON['nodes'][number];

/**
 * 单个节点的 metadata 形态：`signature` 负责**相等性判定**，`keys` 供富诊断分支**直接消费**。
 *
 * 为什么两者要一起产出，而不是在诊断时 `JSON.parse(signature)` 反解回 key 数组：反解会让
 * `missing`/`extra` 的正确性变成"签名恰好是规范 JSON 数组"这个实现细节的下游依赖——签名函数
 * 一旦改形（换分隔符、加前缀、丢掉 `.sort()`），差异文案就静默退化成
 * `重建缺失 [] vs 重建新增 []`：护栏变红却说不出为什么红，甚至 `JSON.parse` 直接抛异常把
 * 一次本该被读懂的差异变成脚本崩溃。分离之后 `.sort()` 只承担签名的规范化职责，
 * 诊断文案的正确性与签名格式解耦。
 */
interface NodeMetadataShape {
  /** 相等性判定的唯一依据。正常 key 列表以 `[` 开头，两种缺席态以 `<` 开头。 */
  signature: string;
  /** 已排序的 key 数组；两种缺席态（`<absent>` / `<non-object:*>`）为 `null`。 */
  keys: string[] | null;
}

/**
 * 提取节点 metadata 的形态描述（只看 key 名，全程不含任何 value）。
 *
 * 为什么 `undefined` 与 `{}` 必须是两个不同签名（FR-007）：前者代表"该节点从未产出过
 * metadata"，是比"产出了但里面没有 key"更强的退化信号；混同会丢掉这一层诊断精度。
 * 非对象取值（null / 字符串 / 数字）单列一档：图产物里出现这种形状本身就是缺陷，
 * 把它折叠进 `<absent>` 等于把一个真缺陷说成"这个节点没 metadata"。
 *
 * 为什么要 `(node as { metadata?: unknown })` 这一次运行时收窄：类型上 `metadata` 是必填
 * `Record<string, unknown>`，但本函数的两侧实参一侧来自磁盘上的 pinned JSON、另一侧来自重建
 * 产物的反序列化结果，历史资产完全可能整字段缺席。这不是绕过类型系统，而是承认类型声明
 * 覆盖不到磁盘事实——若按"必填"直接读，缺席态会在 `Object.keys(undefined)` 处抛异常，
 * 把一个本该被诊断出来的退化信号变成脚本崩溃。
 */
function describeNodeMetadata(node: GraphNodeLike): NodeMetadataShape {
  const raw = (node as { metadata?: unknown }).metadata;
  if (raw === undefined) return { signature: '<absent>', keys: null };
  if (raw === null || typeof raw !== 'object') {
    return { signature: `<non-object:${raw === null ? 'null' : typeof raw}>`, keys: null };
  }
  const keys = Object.keys(raw as Record<string, unknown>).sort();
  return { signature: JSON.stringify(keys), keys };
}

/** 按 node id 分组的形态列表：`Map<nodeId, NodeMetadataShape[]>`（列表长度即该 id 的节点数）。 */
function groupNodeMetadataShapes(
  nodes: readonly GraphNodeLike[],
): Map<string, NodeMetadataShape[]> {
  const grouped = new Map<string, NodeMetadataShape[]>();
  for (const node of nodes) {
    const bucket = grouped.get(node.id) ?? [];
    bucket.push(describeNodeMetadata(node));
    grouped.set(node.id, bucket);
  }
  return grouped;
}

/**
 * a-track 第三比较维度：按 node id 分组比较 metadata 的 **key 集合**（只比 key 名，不比 value）。
 *
 * 为什么必须按 node id 分组而不是拍平成全图 key 并集（FR-006）：pinned 基线里 22 个节点的 key
 * 集合本就逐节点不同（symbol 节点有 `lineRange`/`signature`，module 节点没有），并集档位对
 * "某一个节点丢了 lineRange、其余节点该字段仍在"零检测力——而 F271 的 lineRange 入库正是这个
 * 形态，当时既有两个维度全程判绿。
 *
 * 为什么只对"两侧 id 计数相等且都 > 0"的 id 求值：id 单侧独有或计数不等，第一维度已经报过了；
 * 在这里再报一遍会让每个真正的 metadata 差异淹没在同一事实的重复噪声里。
 *
 * 为什么不比 value（FR-008）：`confidence` 这类浮点字段的正常波动会把护栏变成噪声源，
 * 而本维度要抓的是"字段增删"这一类结构性漂移。
 */
function compareNodeMetadataKeys(rebuilt: GraphJSON, pinned: GraphJSON): string[] {
  const differences: string[] = [];
  const rebuiltGroups = groupNodeMetadataShapes(rebuilt.nodes);
  const pinnedGroups = groupNodeMetadataShapes(pinned.nodes);

  // 遍历 entries 而非 keys：后者拿到 id 之后还得 `.get(id) as NodeMetadataShape[]` 断言非空，
  // 而那个断言的成立理由（id 就是从同一个 Map 的 keys 来的）只存在于人的脑子里。
  // 排序比较器与 `[...keys()].sort()` 的默认字符串序等价（默认 sort 就是按 UTF-16 码元比较）。
  const sortedRebuiltGroups = [...rebuiltGroups.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [id, rebuiltShapes] of sortedRebuiltGroups) {
    const pinnedShapes = pinnedGroups.get(id);
    if (pinnedShapes === undefined) continue;
    if (rebuiltShapes.length !== pinnedShapes.length) continue;

    const rebuiltCounts = countByKey(rebuiltShapes.map((shape) => shape.signature));
    const pinnedCounts = countByKey(pinnedShapes.map((shape) => shape.signature));
    const signatures = [...new Set([...rebuiltCounts.keys(), ...pinnedCounts.keys()])].sort();
    const signatureCountsEqual = signatures.every(
      (signature) => (rebuiltCounts.get(signature) ?? 0) === (pinnedCounts.get(signature) ?? 0),
    );
    if (signatureCountsEqual) continue;

    // 重复 id（任一侧 ≥ 2 个同 id 节点）走通用 multiset 分支：这些节点之间没有可对应的身份，
    // 强行两两配对去算 key 级 diff 会编造出误导性的"某个 key 丢了"结论。
    if (rebuiltShapes.length !== 1) {
      for (const signature of signatures) {
        const rebuiltCount = rebuiltCounts.get(signature) ?? 0;
        const pinnedCount = pinnedCounts.get(signature) ?? 0;
        if (rebuiltCount !== pinnedCount) {
          differences.push(
            `metadata key 签名计数不一致（重建 ${rebuiltCount} vs pinned ${pinnedCount}）: ${id} @ ${signature}`,
          );
        }
      }
      continue;
    }

    // 单节点富诊断分支：现实中 100% 的场景（pinned 基线全部 id 唯一）。只报"签名计数 1 vs 1
    // 不一致"读者看不出到底是哪个 key 变了，护栏变红却说不清为什么红。
    const rebuiltShape = rebuiltShapes[0] as NodeMetadataShape;
    const pinnedShape = pinnedShapes[0] as NodeMetadataShape;
    // 提到局部 const 再判空：narrowing 必须在下面两个 `.filter` 闭包里仍然成立
    const rebuiltKeys = rebuiltShape.keys;
    const pinnedKeys = pinnedShape.keys;
    if (rebuiltKeys === null || pinnedKeys === null) {
      differences.push(
        `metadata 缺席态不一致（重建 ${rebuiltShape.signature} vs pinned ${pinnedShape.signature}）: ${id}`,
      );
      continue;
    }
    const missing = pinnedKeys.filter((key) => !rebuiltKeys.includes(key));
    const extra = rebuiltKeys.filter((key) => !pinnedKeys.includes(key));
    if (missing.length === 0 && extra.length === 0) {
      // 当前签名函数下不可达：签名是 key 集合的**规范**函数（排序后 JSON 序列化），
      // 故"签名不等"必然蕴含"key 集合不等"。保留这一支不是防御性冗余，而是让
      // "签名函数将来被改成非规范形式"这件事把自己说出来——否则它会静默退化成
      // `重建缺失 [] vs 重建新增 []` 这句什么都没说的文案（正是 B3 要根除的形态）。
      differences.push(
        `metadata key 签名不一致但 key 集合相同（重建签名 ${rebuiltShape.signature} vs pinned 签名 ${pinnedShape.signature}）: ${id}`,
      );
      continue;
    }
    differences.push(
      `metadata key 集合不一致（重建缺失 [${missing.join(', ')}] vs 重建新增 [${extra.join(', ')}]）: ${id}`,
    );
  }

  return differences;
}

/**
 * a-track 严格结构比较：节点 id **multiset** + 边 **multiset** + 按 node id 分组的
 * 节点 metadata **key 集合**（F278 第三维度，只比 key 名不比 value）三者完全相等。
 *
 * 为什么不复用 `scripts/graph-semantic-diff.mjs`：那是 F214 时代的 allowlist 式 diff，
 * 设计目标是"忽略已知可接受差异"；本护栏的目标正相反——**任何**未预期差异都必须变红。
 * 用宽松比较器守严格护栏，等于把护栏关掉但保留仪式感。
 *
 * 为什么是 multiset 而非集合：重复边（同 source/relation/target 出现两次）是真实的图内容
 * 差异，用集合比较会把"边被复制了一份"判成一致。
 */
export function compareGraphOnlyStructure(
  rebuilt: GraphJSON,
  pinned: GraphJSON,
): StructuralComparison {
  const differences: string[] = [];

  // W-007：节点侧同样按 multiset 计数比较（原实现用 Set，重复节点 id 被静默折叠）。
  // 图产物里出现同一个 id 两次是真实的结构缺陷（下游按 id 建索引会静默丢一个），
  // 用集合比较等于把这类缺陷判成"一致"——而这正是护栏该抓的东西。
  const rebuiltNodes = countByKey(rebuilt.nodes.map((node) => node.id));
  const pinnedNodes = countByKey(pinned.nodes.map((node) => node.id));
  for (const id of [...new Set([...rebuiltNodes.keys(), ...pinnedNodes.keys()])].sort()) {
    const left = rebuiltNodes.get(id) ?? 0;
    const right = pinnedNodes.get(id) ?? 0;
    if (left === right) continue;
    if (right === 0) {
      differences.push(`节点仅存在于重建产物: ${id}`);
    } else if (left === 0) {
      differences.push(`节点仅存在于 pinned 期望: ${id}`);
    } else {
      differences.push(`节点计数不一致（重建 ${left} vs pinned ${right}）: ${id}`);
    }
  }

  const rebuiltEdges = countByKey(rebuilt.links.map(edgeKey));
  const pinnedEdges = countByKey(pinned.links.map(edgeKey));
  for (const key of [...new Set([...rebuiltEdges.keys(), ...pinnedEdges.keys()])].sort()) {
    const left = rebuiltEdges.get(key) ?? 0;
    const right = pinnedEdges.get(key) ?? 0;
    if (left !== right) {
      differences.push(`边计数不一致（重建 ${left} vs pinned ${right}）: ${key}`);
    }
  }

  const metadataDifferences = compareNodeMetadataKeys(rebuilt, pinned);
  differences.push(...metadataDifferences);

  return { mismatch: differences.length > 0, differences };
}

/**
 * b-track 深度相等比较（对已归一化的投影，逐字段递归）。
 *
 * 归一化只抹掉 `projectRoot`/`analyzedAt`，其余字段（`modules[].language`、`edges[].importType`、
 * `sccs`、`topologicalOrder`、`mermaidSource`）全部参与比较——它们都是 module 派生行为的
 * 真实投影，放过任何一个就是给未来的行为漂移留一条静默通道。
 */
export function compareModuleGraphSnapshot(
  rebuilt: NormalizedModuleGraphSnapshot,
  pinned: NormalizedModuleGraphSnapshot,
): StructuralComparison {
  const differences: string[] = [];
  collectDeepDifferences(rebuilt as unknown, pinned as unknown, 'moduleGraph', differences);
  return { mismatch: differences.length > 0, differences };
}

/** 递归差异收集：数组按下标逐一比较（顺序即语义——拓扑序/SCC 编号本身就是产物的一部分）。 */
function collectDeepDifferences(
  left: unknown,
  right: unknown,
  pathLabel: string,
  differences: string[],
): void {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      differences.push(`${pathLabel}: 一侧是数组另一侧不是`);
      return;
    }
    if (left.length !== right.length) {
      differences.push(`${pathLabel}: 数组长度不一致（重建 ${left.length} vs pinned ${right.length}）`);
    }
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      collectDeepDifferences(left[index], right[index], `${pathLabel}[${index}]`, differences);
    }
    return;
  }

  const leftIsObject = typeof left === 'object' && left !== null;
  const rightIsObject = typeof right === 'object' && right !== null;
  if (leftIsObject || rightIsObject) {
    if (!leftIsObject || !rightIsObject) {
      differences.push(`${pathLabel}: 一侧是对象另一侧不是`);
      return;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      collectDeepDifferences(leftRecord[key], rightRecord[key], `${pathLabel}.${key}`, differences);
    }
    return;
  }

  if (left !== right) {
    differences.push(`${pathLabel}: 值不一致（重建 ${JSON.stringify(left)} vs pinned ${JSON.stringify(right)}）`);
  }
}

// ============================================================
// 双资产写盘：备份 → 覆盖 → 清理 / 逆序回滚（Q5）
// ============================================================

/** `swapPinnedAssets` 依赖的最小 `fs` 面（测试注入 mock 只需实现这五个方法）。 */
export interface PinnedAssetFsLike {
  existsSync(target: string): boolean;
  copyFileSync(source: string, destination: string): void;
  writeFileSync(target: string, data: string, encoding: 'utf-8'): void;
  renameSync(from: string, to: string): void;
  rmSync(target: string, options?: { force?: boolean }): void;
}

export interface PinnedAssetWrite {
  path: string;
  content: string;
}

export interface PinnedAssetSwapOutcome {
  /** 提交点之后的非致命问题（当前只有一类：`.bak` 清理失败）。空数组 = 完全干净。 */
  warnings: string[];
}

/**
 * 原子性地把多份 pinned 资产替换为新内容，语义以**提交点**为界（Q5 / C-003）。
 *
 * 为什么单个 `rename` 原子还不够：本护栏的两份资产必须**互相一致**（前置一致性校验会比较
 * 二者的 `fixtureInputHash`/`fingerprint`）。"第一份 rename 成功、第二份失败"会留下一新一旧的
 * 资产对，下次运行直接被前置校验判为"疑似手工绕过"而阻塞——一次偶发 I/O 失败演变成需要人工
 * 介入的死锁。因此先备份、失败即还原。
 *
 * **提交点 = 两份正式文件的 rename 全部成功那一刻**（C-003 修正）：
 * - 提交点**之前**任一步失败 → 逐项 best-effort 回滚 + 抛错；回滚自身若有失败，错误信息显式
 *   标注 `incomplete` 并列出未能还原的路径（**不**让二次异常淹没首因，也不谎称"已回滚"）
 * - 提交点**之后**（仅剩 `.bak` 清理）失败 → **绝不回滚**，只回传 warning。此时新内容才是
 *   正确状态：为了删不掉一个备份文件而把刚写对的两份资产退回旧内容，是把"有个垃圾文件"
 *   升级成"资产内容错误"，主次颠倒。残留 `.bak` 由人手工删除即可，不影响下次运行
 *   （前置校验只读两份正式资产，`.bak` 不参与任何判定）。
 *
 * 已知限制（如实标注）：步骤 2 与步骤 3 之间进程被强杀会残留 `.bak`。本脚本是开发者手动触发的
 * 本地 dev 脚本（非 CI 关键路径），重跑或手工删 `.bak` 即恢复，不为此引入 WAL 之类的机制。
 */
export async function swapPinnedAssets(
  pairs: PinnedAssetWrite[],
  fsImpl: PinnedAssetFsLike = fs,
): Promise<PinnedAssetSwapOutcome> {
  const tmpSuffix = `.tmp-${process.pid}`;
  /** 每份资产的备份状态：`bak === null` 表示原文件不存在（冷启动首次生成）。 */
  const backups: Array<{ path: string; bak: string | null }> = [];
  const renamedPaths = new Set<string>();
  let pendingTmp: string | null = null;
  /** 提交点标记：置 true 之后的任何失败都 MUST NOT 触发回滚。 */
  let committed = false;

  try {
    // 步骤 1：全部备份成功才进入覆盖阶段
    for (const pair of pairs) {
      if (fsImpl.existsSync(pair.path)) {
        const bak = `${pair.path}.bak`;
        fsImpl.copyFileSync(pair.path, bak);
        backups.push({ path: pair.path, bak });
      } else {
        backups.push({ path: pair.path, bak: null });
      }
    }

    // 步骤 2：逐份「写临时文件 → rename 覆盖」（单份内部不留半写状态）
    for (const pair of pairs) {
      const tmp = `${pair.path}${tmpSuffix}`;
      pendingTmp = tmp;
      fsImpl.writeFileSync(tmp, pair.content, 'utf-8');
      fsImpl.renameSync(tmp, pair.path);
      pendingTmp = null;
      renamedPaths.add(pair.path);
    }

    // ── 提交点：两份正式文件都已是新内容，此后不再回滚 ──
    committed = true;
  } catch (err) {
    // 逆序回滚：已覆盖的从 .bak 还原（原本不存在的直接删除），未覆盖的原状不动。
    // 每一步独立 try/catch：一处回滚失败不得中断其余回滚，也不得把首因异常吞掉。
    const rollbackFailures: string[] = [];
    const attempt = (label: string, action: () => void): void => {
      try {
        action();
      } catch (rollbackErr) {
        rollbackFailures.push(`${label}: ${String(rollbackErr)}`);
      }
    };

    for (const backup of [...backups].reverse()) {
      if (!renamedPaths.has(backup.path)) continue;
      if (backup.bak !== null) {
        attempt(`还原 ${backup.path}`, () => fsImpl.renameSync(backup.bak as string, backup.path));
      } else {
        attempt(`删除新建的 ${backup.path}`, () => fsImpl.rmSync(backup.path, { force: true }));
      }
    }
    // 清理残留：未 rename 成功的临时文件 + 未被回滚消费掉的备份
    if (pendingTmp !== null) {
      const tmp = pendingTmp;
      attempt(`清理临时文件 ${tmp}`, () => fsImpl.rmSync(tmp, { force: true }));
    }
    for (const backup of backups) {
      if (backup.bak !== null && !renamedPaths.has(backup.path)) {
        attempt(`清理备份 ${backup.bak}`, () => fsImpl.rmSync(backup.bak as string, { force: true }));
      }
    }

    if (rollbackFailures.length > 0) {
      throw new Error(
        `pinned 资产写盘失败，且回滚不完整（incomplete），资产可能处于混合状态，请人工核查: ${String(err)}` +
          ` | 回滚失败项: ${rollbackFailures.join('; ')}`,
      );
    }
    throw new Error(`pinned 资产写盘失败，已回滚到调用前状态: ${String(err)}`);
  }

  // 步骤 3（提交点之后）：清理备份。失败只报 warning，绝不回滚已提交的正式文件。
  const warnings: string[] = [];
  if (committed) {
    for (const backup of backups) {
      if (backup.bak === null) continue;
      try {
        fsImpl.rmSync(backup.bak, { force: true });
      } catch (cleanupErr) {
        warnings.push(
          `备份文件清理失败，残留文件可手动删除（不影响已写入的 pinned 资产）: ${backup.bak}（${String(cleanupErr)}）`,
        );
      }
    }
  }
  return { warnings };
}

// ============================================================
// 双轨重建
// ============================================================

/** 把 fixture 的 `src/` 复制到独立临时目录——两轨互不共享目录，避免一轨的写盘产物污染另一轨。 */
function stageFixture(fixtureRoot: string): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-regen-'));
  fs.cpSync(path.join(fixtureRoot, 'src'), path.join(staged, 'src'), { recursive: true });
  return staged;
}

export interface RebuiltTracks {
  graph: GraphJSON;
  moduleGraph: NormalizedModuleGraphSnapshot;
}

/**
 * 双轨重建：a-track = `buildAstGraphOnly`（写盘后回读），b-track = `buildModuleGraphForProject`。
 *
 * registry bootstrap 包 `try/finally`：本脚本进程通常执行完即退出，但显式清理让它在被其他脚本
 * `import` 复用时不泄漏进程级单例状态。
 */
export async function rebuildTracks(fixtureRoot: string): Promise<RebuiltTracks> {
  const graphStage = stageFixture(fixtureRoot);
  let graph: GraphJSON;
  try {
    const result = await buildAstGraphOnly(graphStage);
    graph = JSON.parse(fs.readFileSync(result.graphPath, 'utf-8')) as GraphJSON;
  } finally {
    fs.rmSync(graphStage, { recursive: true, force: true });
  }

  const moduleStage = stageFixture(fixtureRoot);
  let moduleGraph: NormalizedModuleGraphSnapshot;
  bootstrapGuardrailRegistryMain();
  try {
    moduleGraph = normalizeModuleGraphSnapshot(await buildModuleGraphForProject(moduleStage));
  } finally {
    resetGuardrailRegistry();
    fs.rmSync(moduleStage, { recursive: true, force: true });
  }

  return { graph, moduleGraph };
}

// ============================================================
// 主流程
// ============================================================

function serializeAsset(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `--init` 冷启动再生的审计留痕落点（fixture **根目录**，与 README.md 同级）。 */
const REGEN_AUDIT_FILENAME = 'regen-audit.jsonl';

/**
 * 向 `<fixtureRoot>/regen-audit.jsonl` **追加**一行 JSON，记录本次 `--init` 冷启动再生。
 *
 * 为什么落 fixture 根目录而不是 `<fixtureRoot>/src/`：`computeFixtureInputHash` 只递归 `src/`
 * 子目录，写进 `src/` 会让审计记录本身改变 `fixtureInputHash` 并污染两轨图产物——一个自指循环，
 * 且下一次一致性判定会因为"上一次留了痕"而失真。
 *
 * 为什么 append 而非覆写：覆写只保留最后一条，"上一次基线是谁在什么时候建的"会被永久抹掉，
 * 而审计的全部价值就在历史序列。JSONL 也让写入无需先 read→parse→push（文件损坏不会放大成整条链失败）。
 *
 * 为什么写盘失败只 warn 且仍返回成功：调用点在 `swapPinnedAssets` 的**提交点之后**，其注释已把
 * "置 true 之后的任何失败 MUST NOT 触发回滚"定为不变量；升级成非零退出还会造出"脚本报失败但两份
 * 资产已是新内容"的最坏状态——维护者以为没生成而重跑，重跑必然被 C-002 拒绝，卡死在只能手工删
 * 资产才能脱身的坑里。这也不是 fail-open：审计记录不参与任何放行/拒绝判定，缺它不会让护栏放行任何东西。
 *
 * 本账本的**诚实口径**（记的是事件、不代表磁盘现状）与 `fixtureInputHash` 字段的**自检用法**，
 * 见 `tests/fixtures/collector-fingerprint-guardrail/README.md` 禁止事项第 4 条——那里是给人看
 * 处置路径的地方，论证只留一份，避免两处漂移（漂移时没有任何检查会发现）。
 */
function appendRegenAudit(
  fixtureRoot: string,
  entry: { fixtureInputHash: string; behaviorVersion: number },
): void {
  const record = {
    timestamp: new Date().toISOString(),
    trigger: '--init',
    fixtureInputHash: entry.fixtureInputHash,
    behaviorVersion: entry.behaviorVersion,
    assets: [GRAPH_ONLY_ASSET_FILENAME, MODULE_GRAPH_ASSET_FILENAME],
  };
  const auditPath = path.join(fixtureRoot, REGEN_AUDIT_FILENAME);
  try {
    fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (err) {
    console.warn(`[regen] warning: 审计留痕写入失败（资产已正确落盘，不影响本次再生结果）：${String(err)}`);
  }
}

interface RegenOptions {
  fixtureRoot: string;
  init: boolean;
}

function parseRegenArgs(argv: string[]): RegenOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      'fixture-root': { type: 'string' },
      init: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return {
    fixtureRoot: path.resolve(values['fixture-root'] ?? DEFAULT_FIXTURE_ROOT),
    init: values.init === true,
  };
}

/**
 * 再生主流程。返回进程退出码（`0` 放行/无变更，`1` 拒绝或前置校验失败）。
 *
 * 拒绝时**两份资产均不落盘**：逐轨独立求值判据，任一轨拒绝即整体拒绝。允许"一轨写、一轨不写"
 * 会产出彼此不一致的资产对，正是 `swapPinnedAssets` 的回滚机制要避免的状态。
 */
export async function runRegen(argv: string[]): Promise<number> {
  const { fixtureRoot, init } = parseRegenArgs(argv);
  const srcRoot = path.join(fixtureRoot, 'src');
  if (!fs.existsSync(srcRoot)) {
    console.error(`[regen] fixture 源目录不存在: ${srcRoot}`);
    return 1;
  }

  const graphOnlyAssetPath = path.join(fixtureRoot, GRAPH_ONLY_ASSET_FILENAME);
  const moduleGraphAssetPath = path.join(fixtureRoot, MODULE_GRAPH_ASSET_FILENAME);

  const currentInputHash = computeFixtureInputHash(srcRoot);
  const currentFingerprint = computeCollectorFingerprint();

  let pinned: {
    inputHash: string;
    fingerprint: CollectorFingerprint;
    graph: GraphJSON;
    moduleGraph: NormalizedModuleGraphSnapshot;
  } | null = null;

  const graphOnlyExists = fs.existsSync(graphOnlyAssetPath);
  const moduleGraphExists = fs.existsSync(moduleGraphAssetPath);
  const bothAbsent = !graphOnlyExists && !moduleGraphExists;

  if (init) {
    // C-002：`--init` 会**跳过全部拒绝判据**（这是它存在的意义），因此它必须只在
    // "真的没有基线可比"这一种情形下可用。只要还有任一份 pinned 资产在，跑 --init 就等于
    // 一条命令把护栏整体绕过——而"跑一下再生就绿了"恰恰是维护者遇到护栏变红时最容易走的路。
    // 因此这里 fail-loud：要重建基线必须先显式删除资产（一个不可能手滑的动作）。
    if (!bothAbsent) {
      const present = [
        graphOnlyExists ? GRAPH_ONLY_ASSET_FILENAME : null,
        moduleGraphExists ? MODULE_GRAPH_ASSET_FILENAME : null,
      ].filter((name): name is string => name !== null);
      console.error(
        `[regen] 拒绝 --init：pinned 资产已存在（${present.join(' + ')}）。` +
          '--init 会跳过全部拒绝判据，只允许在两份资产均缺席的冷启动场景使用。',
      );
      console.error(
        '[regen] 若确认要重建基线：先手动删除这两份资产再跑 --init；' +
          '若只是想更新资产：直接跑不带 --init 的常规再生（它会执行双轨校验与拒绝判据）。',
      );
      return 1;
    }
    console.log('[regen] --init：两份 pinned 资产均缺席，冷启动首次生成（跳过前置一致性校验与拒绝判据）');
  } else {
    try {
      pinned = loadPinnedPair(graphOnlyAssetPath, moduleGraphAssetPath);
    } catch (err) {
      console.error(`[regen] 前置一致性校验失败：${String(err)}`);
      // 三分支指引。只有"两份都缺席"才提示 --init：单份缺失/内容不一致时提示 --init 是有害建议，
      // 它会让维护者用一条跳过全部判据的命令去"修"一个本该人工核查的异常状态。
      if (bothAbsent) {
        console.error('[regen] 两份 pinned 资产均缺席（冷启动场景）：确认要建立基线时用 --init。');
      } else if (pinnedFingerprintFormatUnparsable(graphOnlyAssetPath, moduleGraphAssetPath)) {
        // 指纹**格式形状**演进（例如新增一条采集管线 key）会让既有 pinned 记录的指纹按当前格式
        // 无法解析。这不是篡改，而是"资产早于当前指纹格式"，唯一正确动作就是重建基线；
        // 若这里也一律说"MUST NOT 用 --init"，维护者会陷入死路（前置校验挡住常规再生、
        // 又被禁止用唯一能重建的入口）。注意这不构成绕过：指纹形状已变 ⇒ 拒绝判据的
        // `fingerprintUnchanged` 本来就是 false ⇒ 常规路径同样会放行再生。
        console.error(
          '[regen] 诊断：pinned 记录的 fingerprint 无法按**当前**指纹格式解析（形状已演进，' +
            '例如新增/移除了一条采集管线）。这属于基线过期而非篡改。',
        );
        console.error(
          '[regen] 处置：确认代码侧的指纹形状变更是预期的之后，删除这两份 pinned 资产再跑 --init 重建基线' +
            `（rm ${GRAPH_ONLY_ASSET_FILENAME} ${MODULE_GRAPH_ASSET_FILENAME}）。`,
        );
      } else {
        console.error(
          '[regen] pinned 资产缺失或内部不一致，可能被手工绕过脚本直接编辑；' +
            '请人工核查后重新生成（本场景 MUST NOT 用 --init 绕过：它会跳过全部拒绝判据）。',
        );
      }
      return 1;
    }
  }

  const rebuilt = await rebuildTracks(fixtureRoot);

  if (pinned !== null) {
    const fingerprintUnchanged = fingerprintsEqual(pinned.fingerprint, currentFingerprint);
    const aTrack = compareGraphOnlyStructure(rebuilt.graph, pinned.graph);
    const bTrack = compareModuleGraphSnapshot(rebuilt.moduleGraph, pinned.moduleGraph);

    const aReject = shouldRejectRegen({
      contentMismatch: aTrack.mismatch,
      fingerprintUnchanged,
    });
    const bReject = shouldRejectRegen({
      contentMismatch: bTrack.mismatch,
      fingerprintUnchanged,
    });

    if (aReject || bReject) {
      const rejectedTracks = [aReject ? 'a-track(graph-only)' : null, bReject ? 'b-track(module-graph)' : null]
        .filter((track): track is string => track !== null)
        .join(' + ');
      console.error(`[regen] 拒绝再生：${rejectedTracks} 重建内容与 pinned 期望不一致，但指纹未变化`);
      console.error(`[regen] ${selectRegenDiagnostic(currentInputHash !== pinned.inputHash)}`);
      const allDifferences = [...aTrack.differences, ...bTrack.differences];
      for (const difference of allDifferences) {
        console.error(`[regen]   - ${difference}`);
      }
      printMetadataDimensionGuidance(allDifferences);
      console.error('[regen] 两份 pinned 资产均未写盘。');
      return 1;
    }

    const inputHashChanged = currentInputHash !== pinned.inputHash;
    if (!aTrack.mismatch && !bTrack.mismatch && fingerprintUnchanged && !inputHashChanged) {
      console.log('[regen] 双轨重建内容、指纹与 fixtureInputHash 均一致，无需更新（未写盘）。');
      return 0;
    }
    console.log(
      `[regen] 放行：contentMismatch=${aTrack.mismatch || bTrack.mismatch}、` +
        `fingerprintUnchanged=${fingerprintUnchanged}、inputHashChanged=${inputHashChanged}`,
    );
    // F272 ⑤：`differences` 此前已算好却被丢弃——`contentMismatch=true` 但因指纹已变化而
    // 走到放行分支时，维护者能看到"内容变了"却看不到"变了什么"。格式与拒绝分支（上方
    // 第 576-578 行）一致，便于两条路径的输出被同一套日志解析方式消费。
    if (aTrack.mismatch || bTrack.mismatch) {
      for (const difference of [...aTrack.differences, ...bTrack.differences]) {
        console.log(`[regen]   - ${difference}`);
      }
    }
  }

  const swapOutcome = await swapPinnedAssets([
    {
      path: graphOnlyAssetPath,
      content: serializeAsset({ fixtureInputHash: currentInputHash, graph: rebuilt.graph }),
    },
    {
      path: moduleGraphAssetPath,
      content: serializeAsset({
        fixtureInputHash: currentInputHash,
        fingerprint: currentFingerprint,
        moduleGraph: rebuilt.moduleGraph,
      }),
    },
  ]);

  console.log(`[regen] 已更新两份 pinned 资产（fixtureInputHash=${currentInputHash.slice(0, 12)}…）`);
  // 提交点之后的清理 warning：资产本身已正确写入，因此仍是成功（exit 0），只是提示有残留
  for (const warning of swapOutcome.warnings) {
    console.warn(`[regen] warning: ${warning}`);
  }
  // F278 项③：只有 `--init` 冷启动留痕（FR-021 常规再生路径行为不变），且必须在 swap 成功之后——
  // 写在之前会记录一次可能失败的再生，那正是"虚假留痕"。C-002 拒绝分支早已 return，走不到这里（FR-020）。
  if (init) {
    appendRegenAudit(fixtureRoot, {
      fixtureInputHash: currentInputHash,
      behaviorVersion: currentFingerprint.behaviorVersion,
    });
  }
  return 0;
}

/**
 * 纯诊断探针：两份既有资产里记录的 fingerprint 是否**都无法**按当前格式解析。
 *
 * 只用于把前置校验失败的指引分流成"基线过期（格式演进）"与"疑似手工篡改"两类，
 * **不参与任何放行/拒绝判定**（否则就成了新的绕过面）。读文件失败 / JSON 坏 / 只有一侧不可解析
 * 一律返回 false —— 那些形态更像损坏而非整体格式演进，应走"人工核查"分支。
 */
function pinnedFingerprintFormatUnparsable(
  graphOnlyAssetPath: string,
  moduleGraphAssetPath: string,
): boolean {
  const readFingerprint = (assetPath: string, pick: (parsed: unknown) => unknown): unknown => {
    try {
      return pick(JSON.parse(fs.readFileSync(assetPath, 'utf-8')));
    } catch {
      return undefined;
    }
  };

  const graphFingerprint = readFingerprint(
    graphOnlyAssetPath,
    (parsed) => (parsed as { graph?: { graph?: { fingerprint?: unknown } } })?.graph?.graph?.fingerprint,
  );
  const moduleFingerprint = readFingerprint(
    moduleGraphAssetPath,
    (parsed) => (parsed as { fingerprint?: unknown })?.fingerprint,
  );

  // 两侧都"存在但不可解析"才判为格式演进：只有一侧异常时更可能是单文件被改坏
  const unparsable = (value: unknown): boolean =>
    value !== undefined && value !== null && parseCollectorFingerprint(value) === null;
  return unparsable(graphFingerprint) && unparsable(moduleFingerprint);
}

/**
 * 前置一致性校验（P11）：两份资产的指纹结构合法、彼此相等，且 `fixtureInputHash` 彼此相等。
 *
 * 三项缺一不可：只校验"结构合法"放过一新一旧的资产对；只校验"彼此相等"放过两份同样畸形的
 * 资产。任一不满足即抛错，由调用方转成非零退出。
 */
function loadPinnedPair(
  graphOnlyAssetPath: string,
  moduleGraphAssetPath: string,
): {
  inputHash: string;
  fingerprint: CollectorFingerprint;
  graph: GraphJSON;
  moduleGraph: NormalizedModuleGraphSnapshot;
} {
  const graphOnly = loadPinnedGraphOnlyAsset(graphOnlyAssetPath);
  const moduleAsset = loadPinnedModuleGraphAsset(moduleGraphAssetPath);

  // W-005：解析成 snapshot 再比较，全程不二次读取资产原对象
  const graphFingerprint = parseCollectorFingerprint(graphOnly.graph.graph.fingerprint);
  if (graphFingerprint === null) {
    throw new Error(`${GRAPH_ONLY_ASSET_FILENAME} 的 graph.graph.fingerprint 结构非法`);
  }
  const moduleFingerprint = parseCollectorFingerprint(moduleAsset.fingerprint);
  if (moduleFingerprint === null) {
    throw new Error(`${MODULE_GRAPH_ASSET_FILENAME} 的 fingerprint 结构非法`);
  }
  if (!fingerprintsEqual(graphFingerprint, moduleFingerprint)) {
    throw new Error('两份 pinned 资产记录的 fingerprint 彼此不一致');
  }
  if (graphOnly.fixtureInputHash !== moduleAsset.fixtureInputHash) {
    throw new Error(
      `两份 pinned 资产记录的 fixtureInputHash 彼此不一致（${graphOnly.fixtureInputHash} vs ${moduleAsset.fixtureInputHash}）`,
    );
  }

  return {
    inputHash: graphOnly.fixtureInputHash,
    fingerprint: graphFingerprint,
    graph: graphOnly.graph,
    moduleGraph: moduleAsset.moduleGraph,
  };
}

// ============================================================
// CLI 入口（被 import 时不执行，供 T045 单测直接 import swapPinnedAssets）
// ============================================================

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    // `import.meta.url` 不是 file: URL（理论上仅打包/非文件加载场景）：退回文件名比较，
    // 而**不是**静默判 false——后者会让直接跑脚本退化成"exit 0 但什么都没做"的假成功。
    return path.basename(entry) === path.basename('regen-collector-fingerprint-fixtures.ts');
  }
}

if (invokedDirectly()) {
  runRegen(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`[regen] 未预期失败: ${String(err)}`);
      process.exitCode = 1;
    });
}
