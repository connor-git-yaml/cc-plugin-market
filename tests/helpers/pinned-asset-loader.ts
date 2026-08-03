/**
 * F249 T040：两份 pinned 护栏资产的 **typed loader**（plan 决策 9 / Q9）。
 *
 * 为什么必须收窄成唯一入口：两份资产都是 `{ fixtureInputHash, ... }` 外层包装。
 * `expected-graph-only-graph.json` 因此**不再是**裸的合法 `GraphJSON`——不熟悉包装层的新消费者
 * 若直接 `JSON.parse` 后整份传给要求 `GraphJSON` 的比较器，TypeScript 不会报错（多余属性只在
 * 字面量赋值时才被检查），运行时也不抛异常，只是 `.graph`/`.nodes` 全部读到 `undefined`，
 * 于是"两份都是 undefined，判定相等"——护栏静默变成永久绿。本 loader 的存在就是为了让这条
 * 失败路径变成显式抛错。
 *
 * 因此：缺字段一律 `throw`，**MUST NOT** 静默返回 `undefined` 或做 `?? {}` 兜底。
 */
import * as fs from 'node:fs';
import type { CollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';
import { parseCollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { NormalizedModuleGraphSnapshot } from './module-graph-snapshot-normalize.js';

/** a-track pinned 资产：graph-only 重建产物 + 输入哈希诊断字段。 */
export interface PinnedGraphOnlyAsset {
  fixtureInputHash: string;
  graph: GraphJSON;
}

/** b-track pinned 资产：module 派生产物的规范化投影 + 生成时指纹 + 输入哈希诊断字段。 */
export interface PinnedModuleGraphAsset {
  fixtureInputHash: string;
  fingerprint: CollectorFingerprint;
  moduleGraph: NormalizedModuleGraphSnapshot;
}

/** 读 + 解析 JSON，把"文件不存在 / 语法错误"归一为带路径的可读错误。 */
function readJson(assetPath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(assetPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `pinned 资产读取失败: ${assetPath}（首次冷启动请跑 ` +
        `npm run fixtures:regen:collector-fingerprint -- --init）: ${String(err)}`,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`pinned 资产 JSON 解析失败: ${assetPath}: ${String(err)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 顶层包装校验：`fixtureInputHash` 必须是非空字符串，否则整份资产不可信。 */
function requireFixtureInputHash(parsed: unknown, assetPath: string): Record<string, unknown> {
  if (!isPlainObject(parsed)) {
    throw new Error(`pinned 资产顶层不是对象: ${assetPath}`);
  }
  const hash = parsed['fixtureInputHash'];
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error(
      `pinned 资产缺少合法 fixtureInputHash（应为非空字符串，实际 ${typeof hash}）: ${assetPath}`,
    );
  }
  return parsed;
}

/**
 * 解包 a-track pinned 资产（`expected-graph-only-graph.json`）。
 *
 * 校验面刻意保持在"包装层结构"这一层：`graph.graph` 存在即放行，不复刻 `validateGraphJsonShape`
 * 那样的完整图 schema 校验——后者是 `graph-quality` CLI 的职责，在此重复会让 loader 随生产 schema
 * 演进而失效，且护栏本身的严格结构比较已经覆盖了图内容的任何偏差。
 */
export function loadPinnedGraphOnlyAsset(assetPath: string): PinnedGraphOnlyAsset {
  const parsed = requireFixtureInputHash(readJson(assetPath), assetPath);
  const graph = parsed['graph'];
  if (!isPlainObject(graph) || !isPlainObject(graph['graph'])) {
    throw new Error(
      `pinned 资产缺少 graph（应为含 graph.graph 的 GraphJSON 包装体）: ${assetPath}` +
        '——注意本文件是 { fixtureInputHash, graph } 包装，不是裸 GraphJSON',
    );
  }
  return {
    fixtureInputHash: parsed['fixtureInputHash'] as string,
    graph: graph as unknown as GraphJSON,
  };
}

/**
 * 解包 b-track pinned 资产（`expected-module-graph.json`）。
 *
 * 这里额外跑 `parseCollectorFingerprint`：b-track 的 `fingerprint` 是顶层独立字段
 * （`ModuleGraph` 生产 schema 里没有指纹的位置），一旦畸形，下游的 `fingerprintsEqual` 会拿到
 * 非法结构；在唯一入口处收口比在每个调用点各判一次更可靠。用 parse 而非布尔投影，还额外
 * 获得"外部 JSON 防御性拷贝"收益——返回的是与磁盘对象物理独立的 snapshot，下游比较不会
 * 被后续代码对原 JSON 对象的意外修改影响。
 */
export function loadPinnedModuleGraphAsset(assetPath: string): PinnedModuleGraphAsset {
  const parsed = requireFixtureInputHash(readJson(assetPath), assetPath);

  const fingerprint = parseCollectorFingerprint(parsed['fingerprint']);
  if (fingerprint === null) {
    throw new Error(
      `pinned 资产的 fingerprint 结构非法（parseCollectorFingerprint 返回 null）: ${assetPath}`,
    );
  }

  const moduleGraph = parsed['moduleGraph'];
  if (
    !isPlainObject(moduleGraph) ||
    !Array.isArray(moduleGraph['modules']) ||
    !Array.isArray(moduleGraph['edges'])
  ) {
    throw new Error(
      `pinned 资产缺少 moduleGraph（应含 modules[]/edges[] 的规范化投影）: ${assetPath}` +
        '——注意本文件是 { fixtureInputHash, fingerprint, moduleGraph } 包装，不是裸 ModuleGraph',
    );
  }

  return {
    fixtureInputHash: parsed['fixtureInputHash'] as string,
    fingerprint,
    moduleGraph: moduleGraph as unknown as NormalizedModuleGraphSnapshot,
  };
}
