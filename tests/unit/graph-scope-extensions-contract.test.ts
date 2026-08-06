/**
 * F254 立项 / F258 升级 —— 跨语言合同：plugins 侧图消费决策的静态 fallback 覆盖面 ↔ 采集面 SSoT。
 *
 * 为什么需要这条测试（fix-report 的 Why 4/5）：
 * `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` 是零 dist 依赖的纯 `.mjs`
 * （Node 直跑），**无法**在运行时引用 TS 侧的 `src/collector-surface.ts`。于是它的覆盖面只能是一份
 * 手写副本——F241 时代那份副本在 d27ba75 扩面（`.mjs`/`.cjs`）之后静默失真，而当时的防漂移断言锁的是
 * **它自己的快照**（"恰为这四项"），扩面后反而把失真固化下来，结构性地不可能报警。
 *
 * **F258 升级：从"扁平并集一致"改为逐管线逐字段锚定 + 同解真值表。**
 * 扁平并集只能锚"收哪些扩展名"，锚不住"按什么语义匹配"——而两者同等重要：`walkPyFiles` 用的是
 * 大小写敏感的 `endsWith('.py')`，`foo.PY` 根本不入图，消费侧却因为 `toLowerCase()` 比较把它判成
 * in-graph-scope。因此本文件现在断言三件事：
 *   ① id 集合两侧一致；② 每个 id 的 `extensions` 与 `matchSemantics` 两侧逐字相等；
 *   ③ **同解真值表**——一组判别性文件名上，`.mjs` 匹配器与 TS 侧 `surfaceMatchesFile` 逐条同解。
 * ③ 锚的是"两侧同解"，而 `.mjs` 侧 `surfaceMatchesFileMjs` 的 `null` 第三出口锚的是"两侧不会同错"
 * （TS 侧是 `if/else` 兜底形态，照镜复制会把未知语义静默按 case-insensitive 处理）。
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_PRODUCER_SURFACES,
  surfaceMatchesFile,
  type CollectorPipelineSurface,
} from '../../src/collector-surface.js';
import { computeCollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';

// @ts-expect-error — .mjs 无类型声明，运行时可解析（同 graph-bootstrap-status.test.ts 先例）
import * as decisionModule from '../../plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs';
// @ts-expect-error — 同上；CLI 侧只取合同测试锚点常量，模块的自调用守卫在被 import 时不会触发
import * as cliModule from '../../plugins/spec-driver/scripts/graph-consumption-cli.mjs';

interface MjsScopeSurface {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly matchSemantics: string;
}

const GRAPH_SCOPE_SURFACES = decisionModule.GRAPH_SCOPE_SURFACES as readonly MjsScopeSurface[];
const surfaceMatchesFileMjs = decisionModule.surfaceMatchesFileMjs as (
  surface: MjsScopeSurface,
  filePathOrName: string,
) => boolean | null;
const FINGERPRINT_SURFACE_KEYS = cliModule.FINGERPRINT_SURFACE_KEYS as readonly string[];
const FINGERPRINT_ENTRY_KEYS = cliModule.FINGERPRINT_ENTRY_KEYS as readonly string[];
const SUPPORTED_FINGERPRINT_FORMAT_VERSION = cliModule.SUPPORTED_FINGERPRINT_FORMAT_VERSION as number;

/**
 * 指纹的 `extensionSurface` 条目 → TS 侧 `CollectorPipelineSurface`。
 *
 * 以**指纹**（而非手写的 id→常量映射表）作为 TS 侧锚点：指纹本身由 `ALL_PRODUCER_SURFACES` 推导
 * （java/go 经 `mergeSurfaces` 合成 `genericAdapters`），因此这条通路不引入第四份手写镜像。
 */
function tsSurfaceOf(entry: { extensions: string[]; matchSemantics: string }): CollectorPipelineSurface {
  return {
    extensions: new Set(entry.extensions),
    matchSemantics: entry.matchSemantics as CollectorPipelineSurface['matchSemantics'],
  };
}

/**
 * 同解真值表的判别性样本。
 *
 * 每条都指向一个已知会把两族语义区分开的形态：
 * - `foo.PY` / `x.MTS`：大小写（本 fix 的原始 bug 形态）
 * - `.ts` / `src/.go`：纯点文件（`endsWith` 命中、`path.extname` 不命中）
 * - `f.go/`：以分隔符结尾（`endsWith('.go')` 不命中、`extname` 也不命中）
 * - `no-ext`：无扩展名
 */
const SAME_VERDICT_TRUTH_TABLE = [
  'foo.PY',
  'foo.py',
  '.ts',
  'src/.go',
  'Foo.JAVA',
  'a.mjs',
  'x.MTS',
  'f.go/',
  'no-ext',
] as const;

describe('F258 跨语言合同：plugins 侧逐管线 fallback 面 ↔ SSoT 采集面', () => {
  it('GRAPH_SCOPE_SURFACES 的 id 集合 === computeCollectorFingerprint().extensionSurface 的 key 集合', () => {
    const expected = Object.keys(computeCollectorFingerprint().extensionSurface);

    expect(GRAPH_SCOPE_SURFACES.map((surface) => surface.id).sort()).toEqual([...expected].sort());
  });

  it('每个 id 的 extensions 与 matchSemantics 两侧逐字相等（扁平并集锚不住语义维）', () => {
    const fingerprint = computeCollectorFingerprint();
    const mjsById = new Map(GRAPH_SCOPE_SURFACES.map((surface) => [surface.id, surface]));

    for (const [id, entry] of Object.entries(fingerprint.extensionSurface)) {
      const mjsSurface = mjsById.get(id);
      expect(mjsSurface, `plugins 侧缺少管线 ${id}`).toBeDefined();
      expect([...mjsSurface!.extensions].sort(), `${id} 的扩展名集合两侧不一致`).toEqual(
        [...entry.extensions].sort(),
      );
      expect(mjsSurface!.matchSemantics, `${id} 的匹配语义两侧不一致`).toBe(entry.matchSemantics);
    }
  });

  it('并集覆盖六条管线各自的全部扩展名（逐管线定位，便于一眼看出是哪条漏了）', () => {
    const fallback = new Set(GRAPH_SCOPE_SURFACES.flatMap((surface) => [...surface.extensions]));
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) {
        expect(fallback.has(extension), `fallback 覆盖面缺少 SSoT 声明的 ${extension}`).toBe(true);
      }
    }
  });

  it('fallback 不含任何 SSoT 之外的扩展名（宽于采集面会把图外改动误判为 in-scope）', () => {
    const declared = new Set<string>();
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) declared.add(extension);
    }

    const extra = GRAPH_SCOPE_SURFACES.flatMap((surface) =>
      [...surface.extensions].filter((extension) => !declared.has(extension)),
    );
    expect(extra).toEqual([]);
  });

  it('同解真值表：逐管线 × 9 个判别性文件名，两侧匹配器逐条同解', () => {
    const fingerprint = computeCollectorFingerprint();
    const mjsById = new Map(GRAPH_SCOPE_SURFACES.map((surface) => [surface.id, surface]));

    for (const [id, entry] of Object.entries(fingerprint.extensionSurface)) {
      const tsSurface = tsSurfaceOf(entry);
      const mjsSurface = mjsById.get(id)!;
      for (const name of SAME_VERDICT_TRUTH_TABLE) {
        expect(
          surfaceMatchesFileMjs(mjsSurface, name),
          `${id} 对 "${name}" 两侧判定不一致（mjs 返回 null 说明它认不出该 matchSemantics）`,
        ).toBe(surfaceMatchesFile(tsSurface, name));
      }
    }
  });

  it('真值表本身具有判别力：至少存在一个"两族给出不同答案"的样本（否则这张表证明不了什么）', () => {
    const fingerprint = computeCollectorFingerprint();
    const pyWalk = tsSurfaceOf(fingerprint.extensionSurface.pyWalk);
    const moduleScan = tsSurfaceOf(fingerprint.extensionSurface.moduleDerivationScan);

    // `.PY` 在大小写敏感面外（本 fix 的原始 bug）；`x.MTS` 在大小写不敏感面内
    expect(surfaceMatchesFile(pyWalk, 'foo.PY')).toBe(false);
    expect(surfaceMatchesFile(pyWalk, 'foo.py')).toBe(true);
    expect(surfaceMatchesFile(moduleScan, 'x.MTS')).toBe(true);
    expect(surfaceMatchesFile(moduleScan, 'src/.go')).toBe(false);
  });

  it('FINGERPRINT_SURFACE_KEYS 与 computeCollectorFingerprint().extensionSurface 的 key 集合一致', () => {
    // 第二处跨语言镜像（4b WARNING-2）：CLI 侧靠这份 key 列表逐条核验图自述指纹的结构。
    // 它漂移的失败方向是安全的（对不上 → 严格核验失败 → 整体回落静态面），但**静默**——
    // 动态面能力会永久丧失而不报任何错，因此必须由本断言锚定，不能靠"注释说了顺序对齐"。
    // SSoT 锚点取已导出的 computeCollectorFingerprint 返回值的 key，不为测试给私有常量加 export。
    const expected = Object.keys(computeCollectorFingerprint().extensionSurface);

    expect([...FINGERPRINT_SURFACE_KEYS].sort()).toEqual([...expected].sort());
  });

  it('M-6: FINGERPRINT_ENTRY_KEYS 与 computeCollectorFingerprint() 的**单条 entry** key 集合一致', () => {
    // 第四处跨语言镜像（审查修复轮 M-6）：顶层 key 早有锚，entry 级此前无锚也无严格校验——
    // entry 内多出的未知 key 被静默照单全收。漂移方向在这里**不**安全：未来 entry 新增
    // 收窄语义的字段（如 excludePatterns）而消费侧只读 extensions + matchSemantics，
    // 会算出偏**宽**的面 ⇒ 本该判范围外的改动拿到全信 impact。
    const entryKeys = Object.keys(computeCollectorFingerprint().extensionSurface.pyWalk);

    expect([...FINGERPRINT_ENTRY_KEYS].sort()).toEqual([...entryKeys].sort());
    // 五条管线的 entry 形状必须一致（否则"用 pyWalk 当代表"这个取样就不成立）
    for (const entry of Object.values(computeCollectorFingerprint().extensionSurface)) {
      expect(Object.keys(entry).sort()).toEqual([...entryKeys].sort());
    }
  });

  it('SUPPORTED_FINGERPRINT_FORMAT_VERSION 与 computeCollectorFingerprint().formatVersion 一致', () => {
    // 第三处跨语言镜像（W-3）：CLI 侧靠这个版本号决定"认不认这份指纹"。它漂移的后果同样静默——
    // 版本对不上 → 所有指纹判不认识 → 永久回落静态面，动态面能力全失而不报错。
    // 同样从已导出的 computeCollectorFingerprint 返回值取，不给 TS 侧私有常量加 export。
    expect(SUPPORTED_FINGERPRINT_FORMAT_VERSION).toBe(computeCollectorFingerprint().formatVersion);
  });

  it('形态约束：小写、带前导点、无重复、且不可变（Object.freeze）', () => {
    expect(Object.isFrozen(GRAPH_SCOPE_SURFACES)).toBe(true);
    for (const surface of GRAPH_SCOPE_SURFACES) {
      expect(Object.isFrozen(surface)).toBe(true);
      expect(Object.isFrozen(surface.extensions)).toBe(true);
      for (const extension of surface.extensions) {
        expect(extension).toBe(extension.toLowerCase());
        expect(extension.startsWith('.')).toBe(true);
      }
      expect(new Set(surface.extensions).size).toBe(surface.extensions.length);
    }
  });
});
