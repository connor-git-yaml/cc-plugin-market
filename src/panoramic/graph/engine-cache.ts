/**
 * 共享 GraphQueryEngine 缓存（F280）。
 *
 * why 存在：此前 `src/mcp/graph-tools.ts` 与 `src/panoramic/qa/index.ts` 各持一份模块级
 * engine 缓存，失效判据不对称——前者每次 stat graph.json 按 mtime+size 复合判据失效
 * （F155 T-002），后者**零失效**（只按 graphPath+root 建 key）。后果：MCP 同进程内 `batch`
 * 重建图后，`panoramic-query(natural-language)` 永远用旧 engine 回答（2026-09-12 架构审查 C-1）。
 * 本模块把失效判据收成一份，两侧共用；不再允许第三份 engine 缓存。
 *
 * 判据：mtime + size 复合（防"修改但 mtime 同秒"与"size 不变但 mtime 变"两种 race，与
 * graph-tools 原口径一致）。key 用 NUL 分隔 graphPath 与 projectRoot（合法路径不含 \0）。
 * 已知限制：同 mtimeMs 且同 size 的重写不可见（两侧收敛前后口径一致，非本模块引入）。
 */
import { statSync } from 'node:fs';
import { GraphQueryEngine } from './graph-query.js';
import type { LoadedGraphEvidence } from './graph-types.js';

// `LoadedGraphEvidence` 的定义在纯类型模块 graph-types.ts（避免 type-only 消费方经本模块拖进 graph-query 值依赖）；
// 此处转发导出，既有 import 面不变。
export type { LoadedGraphEvidence };

/** 缓存条目 = engine + 验证它的那次 stat */
export interface CachedEngine {
  engine: GraphQueryEngine;
  graphPath: string;
  mtimeMs: number;
  sizeBytes: number;
}

interface GraphFileStat {
  mtimeMs: number;
  size: number;
}

const engineCache = new Map<string, CachedEngine>();

/**
 * 无文件版本身份的一次性 engine 计数：每次分配一个唯一负数作 mtimeMs/sizeBytes——与真实 stat（≥ 0）永不相等、
 * 彼此也不相等，于是无论下游按 `===` 比对（honesty 缓存）还是按字符串模板建版本键
 * （`query-helpers.ts` 反向邻接表的 `${mtimeMs}::${sizeBytes}`），都必然 miss、宁可重算也不错认。
 * 不能用 NaN：`===` 上恒不等没错，但模板串里两份不同图会撞成同一个 "NaN::NaN" 键（F280 delta 对抗复审 W-A 实证）。
 */
let unidentifiedLoadSequence = 0;

/**
 * 取 engine：命中且 graph.json 的 mtime+size 未变 → 复用同一条目；否则重新 loadFromFile 并更新条目。
 * stat 先于 load：两步之间文件被重写时，条目元数据偏旧 → 下次调用判定失效自愈；反过来（load 后 stat）
 * 会把新文件的元数据钉在旧内容上、永久假新鲜，故不可颠倒。
 * graph.json 不存在时**不**由 stat 的 ENOENT 抢先——交给 `GraphQueryEngine.loadFromFile`
 * 抛它自己的用户可读错误（"需要先生成图谱"语义由它统一负责）。
 */
export function loadEngineCached(graphPath: string, projectRoot: string): CachedEngine {
  const key = `${graphPath}\0${projectRoot}`;
  const stat = tryStat(graphPath);
  if (stat === null) {
    // stat 失败通常就是缺图：交给 loadFromFile 抛它自己的用户可读错误。它若反而成功（文件不可 stat 却可 load：
    // 测试替身，或 stat→load 之间文件恰好落盘），再 stat 一次登记；仍拿不到 stat 就返回**不入缓存**的条目，
    // 身份取唯一负数（见 unidentifiedLoadSequence）。graph-tools 侧有 existsSync 前置，生产路径走不到这里。
    const engine = GraphQueryEngine.loadFromFile(graphPath, projectRoot);
    const late = tryStat(graphPath);
    if (late === null) {
      const identity = -(++unidentifiedLoadSequence);
      return { engine, graphPath, mtimeMs: identity, sizeBytes: identity };
    }
    return register(key, engine, graphPath, late);
  }
  const hit = engineCache.get(key);
  if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.sizeBytes === stat.size) {
    return hit;
  }
  return register(key, GraphQueryEngine.loadFromFile(graphPath, projectRoot), graphPath, stat);
}

function tryStat(graphPath: string): GraphFileStat | null {
  try {
    return statSync(graphPath);
  } catch {
    return null;
  }
}

function register(key: string, engine: GraphQueryEngine, graphPath: string, stat: GraphFileStat): CachedEngine {
  const entry: CachedEngine = { engine, graphPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  engineCache.set(key, entry);
  return entry;
}

/** 缓存条目的只读图视图：graphData 就是 engine 持有的那份图，元数据就是验证它的那次 stat */
export function toGraphEvidence(entry: CachedEngine): LoadedGraphEvidence {
  return {
    graphData: entry.engine.rawGraph,
    graphPath: entry.graphPath,
    mtimeMs: entry.mtimeMs,
    sizeBytes: entry.sizeBytes,
  };
}

/** 清空缓存；下次调用重新从磁盘加载（测试与"图谱更新后刷新"用） */
export function clearEngineCache(): void {
  engineCache.clear();
}
